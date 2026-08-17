package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type bookingBlockStatus struct {
	BlockedUntil     time.Time
	Targets          []string
	RemainingSeconds int
}

func bookingIPHash(ip string) string {
	key := []byte(strings.TrimSpace(os.Getenv("APP_ENCRYPTION_KEY")))
	if len(key) == 0 {
		key = []byte("livematch-booking-ip-lookup")
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(strings.TrimSpace(ip)))
	return hex.EncodeToString(mac.Sum(nil))
}

func maskBookingIP(value string) string {
	ip := net.ParseIP(strings.TrimSpace(value))
	if ip == nil {
		return "-"
	}
	if v4 := ip.To4(); v4 != nil {
		return v4.String()[:strings.LastIndex(v4.String(), ".")+1] + "xxx"
	}
	parts := strings.Split(ip.String(), ":")
	if len(parts) > 3 {
		return strings.Join(parts[:3], ":") + ":…"
	}
	return ip.String()
}

func bookingIPProtection(ip string) (hash, encrypted, masked string) {
	ip = strings.TrimSpace(ip)
	if net.ParseIP(ip) == nil {
		return "", "", ""
	}
	hash = bookingIPHash(ip)
	encrypted, _ = encryptSecret(ip)
	masked = maskBookingIP(ip)
	return
}

func (a *app) activeBookingBlock(ctx context.Context, adminID, publicUserID, ip string) (bookingBlockStatus, bool) {
	ipHash := ""
	if net.ParseIP(strings.TrimSpace(ip)) != nil {
		ipHash = bookingIPHash(ip)
	}
	rows, err := a.db.QueryContext(ctx, `select target_type,expires_at from booking_blocks where admin_id=$1 and revoked_at is null and expires_at>now() and ((target_type='account' and public_user_id=$2) or (target_type='ip' and ip_hash=$3)) order by expires_at desc`, adminID, publicUserID, ipHash)
	if err != nil {
		return bookingBlockStatus{}, false
	}
	defer rows.Close()
	status := bookingBlockStatus{}
	seen := map[string]bool{}
	for rows.Next() {
		var target string
		var expires time.Time
		if rows.Scan(&target, &expires) != nil {
			continue
		}
		if expires.After(status.BlockedUntil) {
			status.BlockedUntil = expires
		}
		if !seen[target] {
			seen[target] = true
			status.Targets = append(status.Targets, target)
		}
	}
	if status.BlockedUntil.IsZero() {
		return status, false
	}
	status.RemainingSeconds = max(1, int(time.Until(status.BlockedUntil).Seconds()+0.999))
	return status, true
}

func writeBookingBlocked(w http.ResponseWriter, status bookingBlockStatus) {
	w.Header().Set("Retry-After", strconv.Itoa(status.RemainingSeconds))
	writeJSON(w, http.StatusLocked, map[string]any{
		"error": "บัญชีหรือเครือข่ายนี้ถูกระงับการจองชั่วคราว",
		"code":  "booking_blacklisted", "blockedUntil": status.BlockedUntil.Format(time.RFC3339),
		"remainingSeconds": status.RemainingSeconds, "targets": status.Targets,
	})
}

func (a *app) requireNoBookingBlock(w http.ResponseWriter, r *http.Request, adminID string) bool {
	publicUserID := ""
	if user, ok := a.currentPublicUser(r.Context(), r); ok {
		publicUserID = user.ID
	}
	if status, blocked := a.activeBookingBlock(r.Context(), adminID, publicUserID, clientIP(r)); blocked {
		writeBookingBlocked(w, status)
		return false
	}
	return true
}

func (a *app) createAutomaticBookingBlocks(ctx context.Context, tx *sql.Tx, settings bookingSettingsRecord, incidentID int64, publicUserID, ip, reason string) error {
	expires := time.Now().Add(time.Duration(settings.BlockDurationMinutes) * time.Minute)
	if settings.BlockAccountEnabled && publicUserID != "" {
		result, err := tx.ExecContext(ctx, `update booking_blocks set incident_id=$2,reason=$4,expires_at=greatest(expires_at,$5),updated_at=now() where admin_id=$1 and target_type='account' and public_user_id=$3 and revoked_at is null and expires_at>now()`, settings.AdminID, incidentID, publicUserID, reason, expires)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			if _, err = tx.ExecContext(ctx, `insert into booking_blocks (admin_id,incident_id,public_user_id,target_type,reason,expires_at) values ($1,$2,$3,'account',$4,$5)`, settings.AdminID, incidentID, publicUserID, reason, expires); err != nil {
				return err
			}
		}
	}
	if settings.BlockIPEnabled {
		hash, encrypted, masked := bookingIPProtection(ip)
		if hash != "" {
			result, err := tx.ExecContext(ctx, `update booking_blocks set incident_id=$2,ip_encrypted=$4,ip_masked=$5,reason=$6,expires_at=greatest(expires_at,$7),updated_at=now() where admin_id=$1 and target_type='ip' and ip_hash=$3 and revoked_at is null and expires_at>now()`, settings.AdminID, incidentID, hash, encrypted, masked, reason, expires)
			if err != nil {
				return err
			}
			if count, _ := result.RowsAffected(); count == 0 {
				if _, err = tx.ExecContext(ctx, `insert into booking_blocks (admin_id,incident_id,target_type,ip_hash,ip_encrypted,ip_masked,reason,expires_at) values ($1,$2,'ip',$3,$4,$5,$6,$7)`, settings.AdminID, incidentID, hash, encrypted, masked, reason, expires); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func (a *app) changeBookingBlock(w http.ResponseWriter, r *http.Request, adminID, rawID string) {
	id, err := strconv.ParseInt(strings.TrimSpace(rawID), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid block"})
		return
	}
	if r.Method == http.MethodDelete {
		result, execErr := a.db.ExecContext(r.Context(), `update booking_blocks set revoked_at=coalesce(revoked_at,now()),updated_at=now() where id=$1 and admin_id=$2 and revoked_at is null`, id, adminID)
		if execErr != nil {
			writeJSON(w, 500, map[string]string{"error": execErr.Error()})
			return
		}
		if count, _ := result.RowsAffected(); count == 0 {
			writeJSON(w, 404, map[string]string{"error": "block not found"})
			return
		}
		writeJSON(w, 200, map[string]string{"status": "revoked"})
		return
	}
	var body struct {
		ExpiresAt string `json:"expiresAt"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid block"})
		return
	}
	expires, parseErr := time.Parse(time.RFC3339, body.ExpiresAt)
	if parseErr != nil || expires.Before(time.Now()) || expires.After(time.Now().Add(30*24*time.Hour)) {
		writeJSON(w, 400, map[string]string{"error": "เวลาสิ้นสุดไม่ถูกต้อง"})
		return
	}
	result, execErr := a.db.ExecContext(r.Context(), `update booking_blocks set expires_at=$3,updated_at=now() where id=$1 and admin_id=$2 and revoked_at is null`, id, adminID, expires)
	if execErr != nil {
		writeJSON(w, 500, map[string]string{"error": execErr.Error()})
		return
	}
	if count, _ := result.RowsAffected(); count == 0 {
		writeJSON(w, 404, map[string]string{"error": "block not found"})
		return
	}
	writeJSON(w, 200, map[string]any{"status": "updated", "blockedUntil": expires.Format(time.RFC3339)})
}

func (a *app) createIncidentBlocks(w http.ResponseWriter, r *http.Request, adminID, rawID string) {
	incidentID, err := strconv.ParseInt(strings.TrimSpace(rawID), 10, 64)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid incident"})
		return
	}
	var body struct {
		BlockAccount    bool `json:"blockAccount"`
		BlockIP         bool `json:"blockIp"`
		DurationMinutes int  `json:"durationMinutes"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body) != nil || (!body.BlockAccount && !body.BlockIP) || body.DurationMinutes < 1 || body.DurationMinutes > 43200 {
		writeJSON(w, 400, map[string]string{"error": "ข้อมูลการบล็อกไม่ถูกต้อง"})
		return
	}
	var publicUserID sql.NullString
	var encryptedIP, reason string
	if err = a.db.QueryRowContext(r.Context(), `select public_user_id,client_ip_encrypted,reason from booking_security_incidents where id=$1 and admin_id=$2`, incidentID, adminID).Scan(&publicUserID, &encryptedIP, &reason); err != nil {
		writeJSON(w, 404, map[string]string{"error": "incident not found"})
		return
	}
	ip := ""
	if encryptedIP != "" {
		ip, _ = decryptSecret(encryptedIP)
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	settings := bookingSettingsRecord{AdminID: adminID, BlockAccountEnabled: body.BlockAccount, BlockIPEnabled: body.BlockIP, BlockDurationMinutes: body.DurationMinutes}
	if err = a.createAutomaticBookingBlocks(r.Context(), tx, settings, incidentID, publicUserID.String, ip, reason); err != nil || tx.Commit() != nil {
		writeJSON(w, 500, map[string]string{"error": "สร้างรายการบล็อกไม่สำเร็จ"})
		return
	}
	writeJSON(w, 201, map[string]string{"status": "blocked"})
}

func (a *app) bookingBlocksForIncident(ctx context.Context, adminID string, incidentID int64) []map[string]any {
	rows, err := a.db.QueryContext(ctx, `select id,target_type,ip_masked,expires_at,revoked_at from booking_blocks where admin_id=$1 and incident_id=$2 order by created_at desc`, adminID, incidentID)
	if err != nil {
		return []map[string]any{}
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id int64
		var target, masked string
		var expires time.Time
		var revoked sql.NullTime
		if rows.Scan(&id, &target, &masked, &expires, &revoked) == nil {
			items = append(items, map[string]any{"id": id, "target": target, "ipMasked": masked, "blockedUntil": expires.Format(time.RFC3339), "active": !revoked.Valid && expires.After(time.Now())})
		}
	}
	return items
}
