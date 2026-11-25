package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const maxTournamentStaff = 5

func tournamentSecretDigest(value string) string {
	key := strings.TrimSpace(os.Getenv("APP_ENCRYPTION_KEY"))
	if key == "" {
		key = "livematch-tournament-development-key"
	}
	mac := hmac.New(sha256.New, []byte(key))
	_, _ = mac.Write([]byte(value))
	return fmt.Sprintf("%x", mac.Sum(nil))
}

var tournamentPermissionDefaults = map[string]map[string]bool{
	"owner":              {"createTournament": true, "editSettings": true, "drawBracket": true, "lockBracket": true, "approveRegistration": true, "checkIn": true, "verifyPayment": true, "assignUmpire": true, "scoreMatch": true, "overrideLockedResult": true, "viewHealthData": true, "manageSubAccounts": true, "exportReport": true},
	"tournament_admin":   {"createTournament": true, "editSettings": true, "drawBracket": true, "lockBracket": true, "approveRegistration": true, "checkIn": true, "verifyPayment": true, "assignUmpire": true, "scoreMatch": true, "overrideLockedResult": true, "viewHealthData": true, "manageSubAccounts": false, "exportReport": true},
	"registration_staff": {"createTournament": false, "editSettings": false, "drawBracket": false, "lockBracket": false, "approveRegistration": true, "checkIn": true, "verifyPayment": true, "assignUmpire": false, "scoreMatch": false, "overrideLockedResult": false, "viewHealthData": false, "manageSubAccounts": false, "exportReport": false},
	"score_staff":        {"createTournament": false, "editSettings": false, "drawBracket": false, "lockBracket": false, "approveRegistration": false, "checkIn": false, "verifyPayment": false, "assignUmpire": true, "scoreMatch": true, "overrideLockedResult": false, "viewHealthData": false, "manageSubAccounts": false, "exportReport": true},
	"director":           {"scoreMatch": true},
}

type tournamentPrincipal struct {
	AdminID, ActorID, Name, Email, Role, StaffNumber string
	TournamentID                                     string
	Coins, AdminNumber                               int
	Permissions                                      map[string]bool
}

func tournamentRandomDigits(n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		v, _ := rand.Int(rand.Reader, big.NewInt(10))
		b.WriteByte(byte('0' + v.Int64()))
	}
	return b.String()
}

func (a *app) currentTournamentPrincipal(ctx context.Context, r *http.Request) (tournamentPrincipal, bool) {
	if user, ok := a.currentAdmin(ctx, r); ok && a.features(ctx, user.ID).TournamentEnabled {
		return tournamentPrincipal{AdminID: user.ID, ActorID: user.ID, Name: user.Name, Email: user.Email, Role: "owner", AdminNumber: int(user.POSAdminNumber), Coins: user.Coins, StaffNumber: strconv.FormatInt(user.POSAdminNumber, 10), Permissions: tournamentPermissionDefaults["owner"]}, true
	}
	token, ok := readSessionCookie(r, tournamentStaffSessionKind)
	if !ok {
		if directorToken, directorOK := readSessionCookie(r, tournamentDirectorSessionKind); directorOK {
			var p tournamentPrincipal
			err := a.db.QueryRowContext(ctx, `select o.admin_id,o.id,trim(o.first_name||' '||o.last_name),o.email,u.pos_admin_number,u.coins from tournament_director_sessions ds join tournament_officials o on o.id=ds.official_id and o.active join admin_users u on u.id=o.admin_id join admin_features af on af.admin_id=o.admin_id and af.tournament_enabled where (ds.token_hash=$1 or (ds.previous_token_hash=$1 and ds.previous_valid_until>now())) and ds.revoked_at is null and ds.idle_expires_at>now() and ds.absolute_expires_at>now()`, tokenDigest(directorToken)).Scan(&p.AdminID, &p.ActorID, &p.Name, &p.Email, &p.AdminNumber, &p.Coins)
			if err == nil {
				p.Role = "director"
				p.StaffNumber = p.ActorID
				p.Permissions = tournamentPermissionDefaults["director"]
				return p, true
			}
		}
		return tournamentPrincipal{}, false
	}
	var p tournamentPrincipal
	var raw []byte
	err := a.db.QueryRowContext(ctx, `select s.admin_id,s.id,s.name,s.email,s.role,s.staff_number,u.pos_admin_number,u.coins,s.permissions from tournament_staff_sessions ss join tournament_staff s on s.id=ss.staff_id and s.active join admin_users u on u.id=s.admin_id join admin_features af on af.admin_id=s.admin_id and af.tournament_enabled where (ss.token_hash=$1 or (ss.previous_token_hash=$1 and ss.previous_valid_until>now())) and ss.revoked_at is null and ss.idle_expires_at>now() and ss.absolute_expires_at>now()`, tokenDigest(token)).Scan(&p.AdminID, &p.ActorID, &p.Name, &p.Email, &p.Role, &p.StaffNumber, &p.AdminNumber, &p.Coins, &raw)
	if err != nil {
		return tournamentPrincipal{}, false
	}
	p.Permissions = map[string]bool{}
	_ = json.Unmarshal(raw, &p.Permissions)
	for k, v := range tournamentPermissionDefaults[p.Role] {
		if _, exists := p.Permissions[k]; !exists {
			p.Permissions[k] = v
		}
	}
	return p, true
}

// currentTournamentDirectorPrincipal deliberately resolves only the Director
// cookie. A tournament owner can keep the admin dashboard open in the same
// browser as the umpire portal, so choosing the admin cookie first would turn
// the Director into an Owner after a refresh and hide all assigned matches.
func (a *app) currentTournamentDirectorPrincipal(ctx context.Context, r *http.Request) (tournamentPrincipal, bool) {
	directorToken, ok := readSessionCookie(r, tournamentDirectorSessionKind)
	if !ok {
		return tournamentPrincipal{}, false
	}
	var p tournamentPrincipal
	err := a.db.QueryRowContext(ctx, `select o.admin_id,o.id,trim(o.first_name||' '||o.last_name),o.email,u.pos_admin_number,u.coins from tournament_director_sessions ds join tournament_officials o on o.id=ds.official_id and o.active join admin_users u on u.id=o.admin_id join admin_features af on af.admin_id=o.admin_id and af.tournament_enabled where (ds.token_hash=$1 or (ds.previous_token_hash=$1 and ds.previous_valid_until>now())) and ds.revoked_at is null and ds.idle_expires_at>now() and ds.absolute_expires_at>now()`, tokenDigest(directorToken)).Scan(&p.AdminID, &p.ActorID, &p.Name, &p.Email, &p.AdminNumber, &p.Coins)
	if err != nil {
		return tournamentPrincipal{}, false
	}
	p.Role = "director"
	p.StaffNumber = p.ActorID
	p.Permissions = tournamentPermissionDefaults["director"]
	return p, true
}

func (a *app) handleTournamentDirectorLogin(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Code      string `json:"code"`
		LoginCode string `json:"loginCode"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid json"})
		return
	}
	code := strings.TrimSpace(b.LoginCode)
	if code == "" {
		code = strings.TrimSpace(b.Code)
	}
	if len(code) != 12 {
		writeJSON(w, 401, map[string]string{"error": "รหัสกรรมการไม่ถูกต้อง"})
		return
	}
	if !a.requireRequestRate(w, r, "director-login:"+tournamentSecretDigest(code), 20, 10*time.Minute) {
		return
	}
	var id, adminID, approvalStatus string
	var active bool
	var expiresAt sql.NullTime
	var payload []byte
	err := a.db.QueryRowContext(r.Context(), `select o.id,o.admin_id,o.payload,o.approval_status,o.active,o.code_expires_at from tournament_officials o join admin_features af on af.admin_id=o.admin_id and af.tournament_enabled where o.login_code_hash=$1`, tournamentSecretDigest(code)).Scan(&id, &adminID, &payload, &approvalStatus, &active, &expiresAt)
	if err != nil {
		writeJSON(w, 401, map[string]string{"error": "รหัสกรรมการไม่ถูกต้อง"})
		return
	}
	if approvalStatus == "pending" {
		writeJSON(w, 403, map[string]string{"error": "ใบสมัครกรรมการอยู่ระหว่างรออนุมัติ ยังไม่สามารถเข้าสู่ระบบได้", "code": "director_pending_approval"})
		return
	}
	if approvalStatus == "rejected" {
		writeJSON(w, 403, map[string]string{"error": "ใบสมัครกรรมการไม่ผ่านการอนุมัติ กรุณาติดต่อผู้จัดรายการ", "code": "director_application_rejected"})
		return
	}
	if !active {
		writeJSON(w, 403, map[string]string{"error": "รหัสกรรมการถูกระงับ กรุณาติดต่อผู้จัดรายการ", "code": "director_inactive"})
		return
	}
	if expiresAt.Valid && expiresAt.Time.Before(time.Now()) {
		writeJSON(w, 403, map[string]string{"error": "รหัสกรรมการหมดอายุแล้ว", "code": "director_code_expired"})
		return
	}
	token := randHex(24)
	if insertAuthSessionWithPersistence(r.Context(), a.db, tournamentDirectorSessionKind, id, token, true) != nil {
		writeJSON(w, 500, map[string]string{"error": "สร้าง session ไม่สำเร็จ"})
		return
	}
	setSessionCookiePersistence(w, r, tournamentDirectorSessionKind, token, true)
	var umpire map[string]any
	_ = json.Unmarshal(payload, &umpire)
	umpire["id"] = id
	delete(umpire, "loginCode")
	writeJSON(w, 200, map[string]any{"umpire": umpire})
}

func (a *app) handleTournamentDirectorLogout(w http.ResponseWriter, r *http.Request) {
	if token, ok := readSessionCookie(r, tournamentDirectorSessionKind); ok {
		_, _ = a.db.ExecContext(r.Context(), `update tournament_director_sessions set revoked_at=coalesce(revoked_at,now()) where token_hash=$1 or previous_token_hash=$1`, tokenDigest(token))
	}
	clearSessionCookies(w, r, tournamentDirectorSessionKind)
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

func (a *app) handleTournamentDirectorMe(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireTournamentPrincipal(w, r, "scoreMatch")
	if !ok || p.Role != "director" {
		if ok {
			writeJSON(w, 403, map[string]string{"error": "director session required"})
		}
		return
	}
	var raw []byte
	if a.db.QueryRowContext(r.Context(), `select payload from tournament_officials where id=$1 and admin_id=$2 and active`, p.ActorID, p.AdminID).Scan(&raw) != nil {
		writeJSON(w, 401, map[string]string{"error": "director session expired"})
		return
	}
	var umpire map[string]any
	_ = json.Unmarshal(raw, &umpire)
	umpire["id"] = p.ActorID
	delete(umpire, "loginCode12")
	writeJSON(w, 200, map[string]any{"umpire": umpire})
}

func (a *app) handleTournamentDirectorBootstrap(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireTournamentPrincipal(w, r, "scoreMatch")
	if !ok || p.Role != "director" {
		if ok {
			writeJSON(w, 403, map[string]string{"error": "director session required"})
		}
		return
	}
	matches, err := a.tournamentPayloadRows(r.Context(), `select id,payload||jsonb_build_object('version',version) from tournament_matches where admin_id=$1 and payload->>'umpireId'='`+strings.ReplaceAll(p.ActorID, "'", "")+`' order by coalesce(payload->>'scheduledTime',''),created_at`, p.AdminID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "โหลดคู่แข่งขันไม่สำเร็จ"})
		return
	}
	allTournaments, _ := a.tournamentSummaries(r.Context(), p.AdminID)
	assignedTournamentIDs := map[string]bool{}
	for _, match := range matches {
		assignedTournamentIDs[stringValue(match["tournamentId"], "")] = true
	}
	tournaments := make([]map[string]any, 0)
	for _, tournament := range allTournaments {
		if assignedTournamentIDs[stringValue(tournament["id"], "")] {
			tournaments = append(tournaments, tournament)
		}
	}
	var officialRaw []byte
	_ = a.db.QueryRowContext(r.Context(), `select payload from tournament_officials where id=$1 and admin_id=$2`, p.ActorID, p.AdminID).Scan(&officialRaw)
	official := map[string]any{}
	_ = json.Unmarshal(officialRaw, &official)
	official["id"] = p.ActorID
	delete(official, "loginCode12")
	writeJSON(w, 200, map[string]any{
		"liveMatchFeatureEnabled": true, "activeUserRole": "director", "activeUserName": p.Name,
		"coinBalance": 0, "tournaments": tournaments, "players": []any{}, "umpires": []any{official},
		"matches": matches, "drawRevisions": []any{}, "subAccounts": []any{},
		"rolePermissions": tournamentPermissionDefaults, "auditLogs": []any{}, "incidents": []any{},
	})
}

func (a *app) requireTournamentPrincipal(w http.ResponseWriter, r *http.Request, permission string) (tournamentPrincipal, bool) {
	var p tournamentPrincipal
	var ok bool
	failureKind := tournamentStaffSessionKind
	if strings.HasPrefix(r.URL.Path, "/api/auth/tournament/director/") {
		p, ok = a.currentTournamentDirectorPrincipal(r.Context(), r)
		failureKind = tournamentDirectorSessionKind
	} else {
		p, ok = a.currentTournamentPrincipal(r.Context(), r)
	}
	if !ok {
		writeAuthFailure(w, r, failureKind)
		return p, false
	}
	if permission != "" && !p.Permissions[permission] {
		writeJSON(w, 403, map[string]string{"error": "ไม่มีสิทธิ์ดำเนินการ", "code": "permission_denied"})
		return p, false
	}
	return p, true
}

func (a *app) handleTournamentLogin(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Email, Identifier, Password string
		Remember                    *bool `json:"remember"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "ข้อมูลเข้าสู่ระบบไม่ถูกต้อง"})
		return
	}
	id := strings.ToLower(strings.TrimSpace(b.Identifier))
	if id == "" {
		id = strings.ToLower(strings.TrimSpace(b.Email))
	}
	if !a.requireRequestRate(w, r, "tournament-login:"+tokenDigest(id), 20, 10*time.Minute) {
		return
	}
	remember := b.Remember == nil || *b.Remember
	user, hash, err := a.adminByPOSIdentifier(r.Context(), id)
	if err == nil && bcrypt.CompareHashAndPassword([]byte(hash), []byte(b.Password)) == nil {
		if !user.Verified {
			writeJSON(w, 403, map[string]string{"error": "email not verified"})
			return
		}
		if !a.features(r.Context(), user.ID).TournamentEnabled {
			writeJSON(w, 403, map[string]string{"error": "บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งานระบบจัดแข่ง", "code": "tournament_not_enabled"})
			return
		}
		token := randHex(24)
		if insertAuthSessionWithPersistence(r.Context(), a.db, adminSessionKind, user.ID, token, remember) != nil {
			writeJSON(w, 500, map[string]string{"error": "สร้าง session ไม่สำเร็จ"})
			return
		}
		clearSessionCookies(w, r, tournamentStaffSessionKind)
		clearSessionCookies(w, r, tournamentDirectorSessionKind)
		setSessionCookiePersistence(w, r, adminSessionKind, token, remember)
		a.writeTournamentAuth(w, tournamentPrincipal{AdminID: user.ID, ActorID: user.ID, Name: user.Name, Email: user.Email, Role: "owner", StaffNumber: strconv.FormatInt(user.POSAdminNumber, 10), AdminNumber: int(user.POSAdminNumber), Coins: user.Coins, Permissions: tournamentPermissionDefaults["owner"]})
		return
	}
	var staffID, adminID, name, email, role, number, pin string
	var active, enabled bool
	var rawPermissions []byte
	err = a.db.QueryRowContext(r.Context(), `select s.id,s.admin_id,s.name,s.email,s.role,s.staff_number,s.pin_hash,s.active,coalesce(af.tournament_enabled,false),s.permissions from tournament_staff s left join admin_features af on af.admin_id=s.admin_id where lower(s.staff_number)=lower($1) or (s.email<>'' and lower(s.email)=lower($1))`, id).Scan(&staffID, &adminID, &name, &email, &role, &number, &pin, &active, &enabled, &rawPermissions)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(pin), []byte(b.Password)) != nil {
		writeJSON(w, 401, map[string]string{"error": "รหัสผู้ใช้หรือ PIN ไม่ถูกต้อง", "code": "invalid_login"})
		return
	}
	if !active || !enabled {
		writeJSON(w, 403, map[string]string{"error": "บัญชีถูกระงับหรือระบบจัดแข่งยังไม่เปิด", "code": "tournament_not_enabled"})
		return
	}
	token := randHex(24)
	if insertAuthSessionWithPersistence(r.Context(), a.db, tournamentStaffSessionKind, staffID, token, remember) != nil {
		writeJSON(w, 500, map[string]string{"error": "สร้าง session ไม่สำเร็จ"})
		return
	}
	_, _ = a.db.ExecContext(r.Context(), `update tournament_staff set last_login_at=now(),failed_login_count=0 where id=$1`, staffID)
	clearSessionCookies(w, r, adminSessionKind)
	clearSessionCookies(w, r, tournamentDirectorSessionKind)
	setSessionCookiePersistence(w, r, tournamentStaffSessionKind, token, remember)
	var coins, adminNumber int
	_ = a.db.QueryRowContext(r.Context(), `select coins,pos_admin_number from admin_users where id=$1`, adminID).Scan(&coins, &adminNumber)
	permissions := map[string]bool{}
	_ = json.Unmarshal(rawPermissions, &permissions)
	for k, v := range tournamentPermissionDefaults[role] {
		if _, exists := permissions[k]; !exists {
			permissions[k] = v
		}
	}
	a.writeTournamentAuth(w, tournamentPrincipal{AdminID: adminID, ActorID: staffID, Name: name, Email: email, Role: role, StaffNumber: number, AdminNumber: adminNumber, Coins: coins, Permissions: permissions})
}

func (a *app) handleTournamentLogout(w http.ResponseWriter, r *http.Request) {
	if token, ok := readSessionCookie(r, tournamentStaffSessionKind); ok {
		_, _ = a.db.ExecContext(r.Context(), `update tournament_staff_sessions set revoked_at=coalesce(revoked_at,now()) where token_hash=$1 or previous_token_hash=$1`, tokenDigest(token))
	}
	clearSessionCookies(w, r, tournamentStaffSessionKind)
	clearSessionCookies(w, r, tournamentDirectorSessionKind)
	clearSessionCookies(w, r, adminSessionKind)
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

func (a *app) handleTournamentMe(w http.ResponseWriter, r *http.Request) {
	p, ok := a.currentTournamentPrincipal(r.Context(), r)
	if !ok {
		writeAuthFailure(w, r, tournamentStaffSessionKind)
		return
	}
	a.writeTournamentAuth(w, p)
}

func (a *app) writeTournamentAuth(w http.ResponseWriter, p tournamentPrincipal) {
	writeJSON(w, 200, map[string]any{"user": map[string]any{"id": p.ActorID, "ownerId": p.AdminID, "name": p.Name, "email": p.Email, "role": p.Role, "staffNumber": p.StaffNumber, "coins": p.Coins, "posAdminNumber": p.AdminNumber}, "features": map[string]bool{"tournamentEnabled": true}, "permissions": p.Permissions})
}

func (a *app) tournamentAudit(ctx context.Context, p tournamentPrincipal, tournamentID, action, targetType, targetID, reason string, details any) {
	raw, _ := json.Marshal(details)
	_, _ = a.db.ExecContext(ctx, `insert into tournament_audit_logs(admin_id,tournament_id,actor_type,actor_id,actor_name,action,target_type,target_id,reason,details) values($1,nullif($2,''),$3,$4,$5,$6,$7,$8,$9,$10)`, p.AdminID, tournamentID, p.Role, p.ActorID, p.Name, action, targetType, targetID, reason, raw)
}

func (a *app) tournamentPricing(ctx context.Context) (int, int) {
	free, price := 20, 10
	_ = a.db.QueryRowContext(ctx, `select value::int from system_settings where key='tournamentFreeParticipants'`).Scan(&free)
	_ = a.db.QueryRowContext(ctx, `select value::int from system_settings where key='tournamentCoinPerParticipant'`).Scan(&price)
	return free, price
}

func (a *app) handleTournamentRoutes(w http.ResponseWriter, r *http.Request) {
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/tournament/"), "/")
	if path == "bootstrap" && r.Method == http.MethodGet {
		a.tournamentBootstrap(w, r)
		return
	}
	if path == "state" && r.Method == http.MethodGet {
		a.tournamentLegacyState(w, r)
		return
	}
	if path == "dashboard" && r.Method == http.MethodGet {
		a.tournamentDashboard(w, r)
		return
	}
	if path == "coin-shop" && r.Method == http.MethodGet {
		a.tournamentCoinShop(w, r)
		return
	}
	if path == "coin-orders" && r.Method == http.MethodPost {
		a.tournamentCreateCoinOrder(w, r)
		return
	}
	if path == "global-settings" && r.Method == http.MethodGet {
		a.tournamentGlobalSettings(w, r)
		return
	}
	if strings.HasPrefix(path, "access/staff") {
		a.tournamentStaffRoutes(w, r, path)
		return
	}
	if strings.HasPrefix(path, "sub-accounts") {
		a.tournamentStaffRoutes(w, r, strings.Replace(path, "sub-accounts", "access/staff", 1))
		return
	}
	if path == "tournaments" {
		if r.Method == http.MethodGet {
			a.listTournaments(w, r)
			return
		}
		if r.Method == http.MethodPost {
			a.createTournament(w, r)
			return
		}
	}
	if strings.HasPrefix(path, "tournaments/") {
		a.tournamentItemRoutes(w, r, path)
		return
	}
	if strings.HasPrefix(path, "players") {
		a.tournamentEntryRoutes(w, r, path)
		return
	}
	if path == "registrations" && r.Method == http.MethodGet {
		a.tournamentRegistrationList(w, r)
		return
	}
	if strings.HasPrefix(path, "umpires") {
		a.tournamentOfficialRoutes(w, r, path)
		return
	}
	if path == "draw/preview" {
		a.tournamentDrawPreview(w, r)
		return
	}
	if path == "draw/publish" {
		a.tournamentDrawPublishPreview(w, r)
		return
	}
	if path == "draw/advance-knockout" {
		a.tournamentDrawAdvanceKnockout(w, r)
		return
	}
	if path == "draw/lock" || path == "draw/unlock" {
		a.tournamentDrawLock(w, r, path == "draw/lock")
		return
	}
	if path == "events" && r.Method == http.MethodGet {
		a.tournamentEvents(w, r)
		return
	}
	if path == "backup" && r.Method == http.MethodGet {
		a.tournamentBackup(w, r)
		return
	}
	if path == "reports" && r.Method == http.MethodGet {
		a.tournamentReports(w, r)
		return
	}
	if path == "files/stage" && r.Method == http.MethodPost {
		p, ok := a.requireTournamentPrincipal(w, r, "")
		if !ok {
			return
		}
		a.stageTournamentFile(w, r, p.AdminID, r.URL.Query().Get("tournamentId"))
		return
	}
	if strings.HasPrefix(path, "files/") && r.Method == http.MethodGet {
		a.downloadTournamentFile(w, r, strings.TrimPrefix(path, "files/"))
		return
	}
	if strings.HasPrefix(path, "matches/") {
		a.tournamentMatchRoutes(w, r, path)
		return
	}
	writeJSON(w, 404, map[string]string{"error": "not found"})
}

func (a *app) tournamentBootstrap(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireTournamentPrincipal(w, r, "")
	if !ok {
		return
	}
	free, price := a.tournamentPricing(r.Context())
	items, _ := a.tournamentSummaries(r.Context(), p.AdminID)
	writeJSON(w, 200, map[string]any{"user": p, "permissions": p.Permissions, "coinBalance": p.Coins, "pricing": map[string]int{"freeParticipants": free, "coinPerParticipant": price}, "tournaments": items})
}

func tournamentDashboardPage(queryPage, queryPageSize string) (int, int) {
	page, _ := strconv.Atoi(queryPage)
	pageSize, _ := strconv.Atoi(queryPageSize)
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 5
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}

func tournamentDashboardYear(value string) int {
	year, _ := strconv.Atoi(strings.TrimSpace(value))
	if year < 2000 || year > 2200 {
		return 0
	}
	return year
}

func (a *app) tournamentDashboard(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireTournamentPrincipal(w, r, "")
	if !ok {
		return
	}

	page, pageSize := tournamentDashboardPage(r.URL.Query().Get("page"), r.URL.Query().Get("pageSize"))
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	year := tournamentDashboardYear(r.URL.Query().Get("year"))

	const effectiveYearSQL = `coalesce(extract(year from t.start_at)::int, case when t.settings->>'year' ~ '^[0-9]{4}$' then (t.settings->>'year')::int else 0 end)`
	filterSQL := ` from tournaments t where t.admin_id=$1 and t.archived_at is null
		and ($2='' or t.name ilike '%'||$2||'%' or t.venue ilike '%'||$2||'%' or t.organizer ilike '%'||$2||'%')
		and ($3=0 or ` + effectiveYearSQL + `=$3)`

	var total int
	if err := a.db.QueryRowContext(r.Context(), `select count(*)`+filterSQL, p.AdminID, search, year).Scan(&total); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	totalPages := 0
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
		if page > totalPages {
			page = totalPages
		}
	}
	offset := (page - 1) * pageSize

	rows, err := a.db.QueryContext(r.Context(), `select
		t.id,t.name,t.status,t.description,t.organizer,t.venue,
		coalesce(to_char(t.start_at at time zone 'Asia/Bangkok','YYYY-MM-DD'),t.settings->>'startDate',''),
		coalesce(to_char(t.end_at at time zone 'Asia/Bangkok','YYYY-MM-DD'),t.settings->>'endDate',''),
		t.max_participants,t.version,t.public_token,t.settings,
		(select count(*) from tournament_entries e where e.admin_id=t.admin_id and e.tournament_id=t.id and e.withdrawn_at is null) applicant_count,
		(select count(*) from tournament_matches m where m.admin_id=t.admin_id and m.tournament_id=t.id) match_count,
		(select count(*) from tournament_matches m where m.admin_id=t.admin_id and m.tournament_id=t.id and coalesce(m.payload->>'status',m.status) in ('finished','walkover','retired','disqualified')) finished_match_count
		`+filterSQL+`
		order by t.updated_at desc,t.id desc limit $4 offset $5`, p.AdminID, search, year, pageSize, offset)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, name, status, desc, org, venue, start, end, encryptedToken string
		var raw []byte
		var maxParticipants, applicantCount, matchCount, finishedMatchCount int
		var version int64
		if err = rows.Scan(&id, &name, &status, &desc, &org, &venue, &start, &end, &maxParticipants, &version, &encryptedToken, &raw, &applicantCount, &matchCount, &finishedMatchCount); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		item := map[string]any{}
		_ = json.Unmarshal(raw, &item)
		item["id"], item["name"], item["status"] = id, name, status
		item["description"], item["organizer"], item["venue"] = desc, org, venue
		item["startDate"], item["endDate"], item["maxParticipants"] = start, end, maxParticipants
		item["version"], item["applicantCount"] = version, applicantCount
		progress := 0
		if matchCount > 0 {
			progress = finishedMatchCount * 100 / matchCount
		}
		item["progress"] = progress
		if token, decryptErr := decryptSecret(encryptedToken); decryptErr == nil {
			item["publicToken"] = token
		} else {
			item["publicToken"] = ""
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	var summaryTotal, openRegistration, ongoing, finished, participantCount int64
	var pendingAmountSatang int64
	err = a.db.QueryRowContext(r.Context(), `select
		count(*),
		count(*) filter(where status='เปิดรับสมัคร'),
		count(*) filter(where status='กำลังแข่งขัน'),
		count(*) filter(where status='แข่งขันเสร็จแล้ว'),
		coalesce((select sum(case when e.format='doubles' then 2 else 1 end) from tournament_entries e where e.admin_id=$1 and e.withdrawn_at is null),0),
		coalesce((select sum(greatest(e.amount_due_satang-e.amount_paid_satang,0)) from tournament_entries e where e.admin_id=$1 and e.withdrawn_at is null),0)
		from tournaments t where t.admin_id=$1 and t.archived_at is null`, p.AdminID).Scan(&summaryTotal, &openRegistration, &ongoing, &finished, &participantCount, &pendingAmountSatang)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	yearRows, err := a.db.QueryContext(r.Context(), `select distinct `+effectiveYearSQL+` as event_year
		from tournaments t where t.admin_id=$1 and t.archived_at is null and `+effectiveYearSQL+`>0 order by event_year desc`, p.AdminID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer yearRows.Close()
	years := []int{}
	for yearRows.Next() {
		var itemYear int
		if yearRows.Scan(&itemYear) == nil {
			years = append(years, itemYear)
		}
	}

	writeJSON(w, 200, map[string]any{
		"summary": map[string]any{
			"total": summaryTotal, "openRegistration": openRegistration, "ongoing": ongoing,
			"finished": finished, "participantCount": participantCount, "pendingAmountSatang": pendingAmountSatang,
		},
		"items":      items,
		"years":      years,
		"pagination": map[string]any{"page": page, "pageSize": pageSize, "total": total, "totalPages": totalPages},
	})
}

func (a *app) tournamentOwner(w http.ResponseWriter, r *http.Request) (tournamentPrincipal, adminUser, bool) {
	p, ok := a.requireTournamentPrincipal(w, r, "")
	if !ok {
		return p, adminUser{}, false
	}
	if p.Role != "owner" {
		writeJSON(w, 403, map[string]string{"error": "เฉพาะ Owner เท่านั้นที่เติม Coin ได้", "code": "owner_required"})
		return p, adminUser{}, false
	}
	return p, adminUser{ID: p.AdminID, Email: p.Email, Name: p.Name, POSAdminNumber: int64(p.AdminNumber), Verified: true, Coins: p.Coins}, true
}

func (a *app) tournamentCoinShop(w http.ResponseWriter, r *http.Request) {
	p, user, ok := a.tournamentOwner(w, r)
	if !ok {
		return
	}
	packages, err := a.coinPackages(r.Context(), true)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	subscriptionPackages, err := a.subscriptionPackages(r.Context(), true)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	orders, err := a.coinPurchaseOrders(r.Context(), user.ID, true, 20)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	ledger, err := a.coinLedger(r.Context(), user.ID, 30)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	qrImage, _ := a.systemSetting(r.Context(), "coinPaymentQrImage")
	promptPay := a.promptPaySettings(r.Context())
	eligibility, err := subscriptionPurchaseEligibilityForAdmin(r.Context(), a.db, user.ID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{
		"coinBalance":                   p.Coins,
		"packages":                      packages,
		"subscriptionPackages":          subscriptionPackages,
		"subscriptionEligibility":       eligibility,
		"paymentQrImage":                qrImage,
		"promptPayId":                   promptPay.ID,
		"promptPayType":                 promptPay.Type,
		"promptPayReceiverName":         promptPay.ReceiverName,
		"promptPayPayloads":             promptPayPayloadsForPackages(promptPay, packages),
		"subscriptionPromptPayPayloads": promptPayPayloadsForSubscriptionPackages(promptPay, subscriptionPackages),
		"orders":                        orders,
		"coinLedger":                    ledger,
	})
}

func (a *app) tournamentCreateCoinOrder(w http.ResponseWriter, r *http.Request) {
	_, user, ok := a.tournamentOwner(w, r)
	if !ok {
		return
	}
	a.handleCreateCoinOrder(w, r, user)
}

func (a *app) tournamentGlobalSettings(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireTournamentPrincipal(w, r, "manageSubAccounts")
	if !ok {
		return
	}
	if p.Role != "owner" {
		writeJSON(w, 403, map[string]string{"error": "เฉพาะ Owner", "code": "owner_required"})
		return
	}

	auditPage, auditPageSize := tournamentDashboardPage(r.URL.Query().Get("auditPage"), r.URL.Query().Get("auditPageSize"))
	if r.URL.Query().Get("auditPageSize") == "" {
		auditPageSize = 20
	}
	var auditTotal int
	if err := a.db.QueryRowContext(r.Context(), `select count(*) from tournament_audit_logs where admin_id=$1`, p.AdminID).Scan(&auditTotal); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	auditTotalPages := 0
	if auditTotal > 0 {
		auditTotalPages = (auditTotal + auditPageSize - 1) / auditPageSize
		if auditPage > auditTotalPages {
			auditPage = auditTotalPages
		}
	}
	auditRows, err := a.db.QueryContext(r.Context(), `select id::text,coalesce(tournament_id,''),actor_name,actor_type,action,target_type,target_id,reason,to_char(created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI:SS') from tournament_audit_logs where admin_id=$1 order by created_at desc limit $2 offset $3`, p.AdminID, auditPageSize, (auditPage-1)*auditPageSize)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer auditRows.Close()
	audits := []map[string]any{}
	for auditRows.Next() {
		var id, tournamentID, actor, actorRole, action, targetType, targetID, reason, timestamp string
		if err = auditRows.Scan(&id, &tournamentID, &actor, &actorRole, &action, &targetType, &targetID, &reason, &timestamp); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		audits = append(audits, map[string]any{"id": id, "tournamentId": tournamentID, "actor": actor, "actorRole": actorRole, "action": action, "targetType": targetType, "targetId": targetID, "reason": reason, "timestamp": timestamp})
	}

	accounts, err := a.tournamentStaffItems(r.Context(), p.AdminID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	features := a.features(r.Context(), p.AdminID)
	var bookingPaymentConfigured bool
	_ = a.db.QueryRowContext(r.Context(), `select exists(select 1 from booking_settings where admin_id=$1 and (promptpay_id<>'' or payment_qr_image<>'' or bank_account_number<>''))`, p.AdminID).Scan(&bookingPaymentConfigured)
	var activeCoinPackages int
	_ = a.db.QueryRowContext(r.Context(), `select count(*) from coin_packages where active`).Scan(&activeCoinPackages)
	freeParticipants, coinPerParticipant := a.tournamentPricing(r.Context())

	writeJSON(w, 200, map[string]any{
		"accounts":        accounts,
		"maxAccounts":     maxTournamentStaff,
		"rolePermissions": tournamentPermissionDefaults,
		"integration": map[string]any{
			"posEnabled": features.POSEnabled, "bookingEnabled": features.BookingEnabled,
			"bookingPaymentConfigured": bookingPaymentConfigured, "activeCoinPackages": activeCoinPackages,
			"freeParticipants": freeParticipants, "coinPerParticipant": coinPerParticipant,
		},
		"audits":          audits,
		"auditPagination": map[string]any{"page": auditPage, "pageSize": auditPageSize, "total": auditTotal, "totalPages": auditTotalPages},
	})
}

func (a *app) tournamentSummaries(ctx context.Context, adminID string) ([]map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, `select id,name,status,description,organizer,venue,coalesce(to_char(start_at at time zone 'Asia/Bangkok','YYYY-MM-DD'),settings->>'startDate',''),coalesce(to_char(end_at at time zone 'Asia/Bangkok','YYYY-MM-DD'),settings->>'endDate',''),max_participants,version,public_token,settings from tournaments where admin_id=$1 and archived_at is null order by updated_at desc`, adminID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name, status, desc, org, venue, start, end, token string
		var raw []byte
		var max int
		var version int64
		if err = rows.Scan(&id, &name, &status, &desc, &org, &venue, &start, &end, &max, &version, &token, &raw); err != nil {
			return nil, err
		}
		item := map[string]any{}
		_ = json.Unmarshal(raw, &item)
		item["id"], item["name"], item["status"] = id, name, status
		item["description"], item["organizer"], item["venue"] = desc, org, venue
		item["startDate"], item["endDate"], item["maxParticipants"] = start, end, max
		item["version"], item["publicToken"] = version, token
		if plain, decryptErr := decryptSecret(token); decryptErr == nil {
			item["publicToken"] = plain
		} else {
			item["publicToken"] = ""
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (a *app) listTournaments(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireTournamentPrincipal(w, r, "")
	if !ok {
		return
	}
	items, err := a.tournamentSummaries(r.Context(), p.AdminID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "pagination": map[string]any{"page": 1, "pageSize": len(items), "total": len(items), "totalPages": 1}})
}

func (a *app) createTournament(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireTournamentPrincipal(w, r, "createTournament")
	if !ok {
		return
	}
	var b map[string]any
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "ข้อมูลไม่ถูกต้อง"})
		return
	}
	name := strings.TrimSpace(fmt.Sprint(b["name"]))
	maxP, _ := strconv.Atoi(fmt.Sprint(b["maxParticipants"]))
	if name == "" || maxP < 1 {
		writeJSON(w, 400, map[string]string{"error": "ชื่อและจำนวนผู้สมัครไม่ถูกต้อง"})
		return
	}
	startAt, endAt, scheduleErr := tournamentScheduleTimes(b)
	if scheduleErr != nil {
		writeJSON(w, 400, map[string]string{"error": scheduleErr.Error()})
		return
	}
	free, price := a.tournamentPricing(r.Context())
	cost := max(0, maxP-free) * price
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var coins int
	if err = tx.QueryRowContext(r.Context(), `select coins from admin_users where id=$1 for update`, p.AdminID).Scan(&coins); err != nil || coins < cost {
		writeJSON(w, 409, map[string]string{"error": "coin ไม่พอ"})
		return
	}
	id := "trn-" + randHex(8)
	token := randHex(24)
	encryptedToken, encryptErr := encryptSecret(token)
	if encryptErr != nil {
		writeJSON(w, 500, map[string]string{"error": "สร้าง public token ไม่สำเร็จ"})
		return
	}
	raw, _ := json.Marshal(b)
	if _, err = tx.ExecContext(r.Context(), `insert into tournaments(id,admin_id,name,status,description,organizer,venue,start_at,end_at,public_token_hash,public_token,max_participants,pricing_free_snapshot,pricing_per_participant_snapshot,charged_coin,settings,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, id, p.AdminID, name, stringValue(b["status"], "Draft"), stringValue(b["description"], ""), stringValue(b["organizer"], ""), stringValue(b["venue"], ""), startAt, endAt, tournamentSecretDigest(token), encryptedToken, maxP, free, price, cost, raw, p.ActorID); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	if cost > 0 {
		next := coins - cost
		_, err = tx.ExecContext(r.Context(), `update admin_users set coins=$2 where id=$1`, p.AdminID, next)
		if err == nil {
			_, err = tx.ExecContext(r.Context(), `insert into coin_ledger(admin_id,delta,balance,reason,note) values($1,$2,$3,'tournament_capacity',$4)`, p.AdminID, -cost, next, "create "+id)
		}
	}
	if err != nil || tx.Commit() != nil {
		writeJSON(w, 500, map[string]string{"error": "บันทึกรายการแข่งขันไม่สำเร็จ"})
		return
	}
	a.tournamentAudit(r.Context(), p, id, "CREATE_TOURNAMENT", "tournament", id, "", map[string]any{"maxParticipants": maxP, "chargedCoin": cost})
	b["id"] = id
	b["publicToken"] = token
	b["maxParticipants"] = maxP
	writeJSON(w, 201, b)
}

func stringValue(v any, fallback string) string {
	s := strings.TrimSpace(fmt.Sprint(v))
	if s == "" || s == "<nil>" {
		return fallback
	}
	return s
}

func tournamentScheduleTimes(values map[string]any) (*time.Time, *time.Time, error) {
	// Thailand has used UTC+7 without daylight-saving transitions since 1920.
	// FixedZone keeps tournament date parsing deterministic in minimal Alpine images
	// that intentionally do not ship the system tzdata database.
	location := time.FixedZone("Asia/Bangkok", 7*60*60)
	parse := func(dateKey, timeKey string) (*time.Time, error) {
		dateValue := stringValue(values[dateKey], "")
		if dateValue == "" {
			return nil, nil
		}
		timeValue := stringValue(values[timeKey], "00:00")
		parsed, parseErr := time.ParseInLocation("2006-01-02 15:04", dateValue+" "+timeValue, location)
		if parseErr != nil {
			return nil, fmt.Errorf("วันที่หรือเวลาไม่ถูกต้อง")
		}
		return &parsed, nil
	}
	startAt, err := parse("startDate", "startTime")
	if err != nil {
		return nil, nil, err
	}
	endAt, err := parse("endDate", "endTime")
	if err != nil {
		return nil, nil, err
	}
	if startAt != nil && endAt != nil && endAt.Before(*startAt) {
		return nil, nil, fmt.Errorf("วันสิ้นสุดต้องไม่ก่อนวันเริ่มจัดงาน")
	}
	return startAt, endAt, nil
}

func (a *app) tournamentItemRoutes(w http.ResponseWriter, r *http.Request, path string) {
	parts := strings.Split(path, "/")
	if len(parts) < 2 {
		writeJSON(w, 404, map[string]string{"error": "not found"})
		return
	}
	id := parts[1]
	if len(parts) == 3 && parts[2] == "expand-capacity" && r.Method == http.MethodPost {
		a.expandTournamentCapacity(w, r, id)
		return
	}
	if len(parts) == 4 && parts[2] == "divisions" && r.Method == http.MethodDelete {
		a.deleteTournamentDivision(w, r, id, parts[3])
		return
	}
	if len(parts) == 3 && parts[2] == "archive" && r.Method == http.MethodPost {
		p, ok := a.requireTournamentPrincipal(w, r, "editSettings")
		if !ok {
			return
		}
		res, err := a.db.ExecContext(r.Context(), `update tournaments set archived_at=now(),version=version+1 where id=$1 and admin_id=$2 and archived_at is null`, id, p.AdminID)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			writeJSON(w, 404, map[string]string{"error": "not found"})
			return
		}
		a.tournamentAudit(r.Context(), p, id, "ARCHIVE_TOURNAMENT", "tournament", id, "", nil)
		writeJSON(w, 200, map[string]string{"status": "archived"})
		return
	}
	p, ok := a.requireTournamentPrincipal(w, r, map[bool]string{true: "editSettings", false: ""}[r.Method != http.MethodGet])
	if !ok {
		return
	}
	var raw []byte
	var version int64
	err := a.db.QueryRowContext(r.Context(), `select settings,version from tournaments where id=$1 and admin_id=$2`, id, p.AdminID).Scan(&raw, &version)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "ไม่พบรายการแข่งขัน"})
		return
	}
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	out["id"] = id
	out["version"] = version
	if r.Method == http.MethodGet {
		writeJSON(w, 200, out)
		return
	}
	if r.Method == http.MethodPatch {
		var patch map[string]any
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&patch) != nil {
			writeJSON(w, 400, map[string]string{"error": "ข้อมูลไม่ถูกต้อง"})
			return
		}
		for k, v := range patch {
			if k != "id" && k != "maxParticipants" && k != "version" && k != "_auditReason" {
				out[k] = v
			}
		}
		startAt, endAt, scheduleErr := tournamentScheduleTimes(out)
		if scheduleErr != nil {
			writeJSON(w, 400, map[string]string{"error": scheduleErr.Error()})
			return
		}
		delete(out, "version")
		next, _ := json.Marshal(out)
		res, err := a.db.ExecContext(r.Context(), `update tournaments set settings=$3,name=coalesce(nullif($4,''),name),status=coalesce(nullif($5,''),status),description=$6,organizer=$7,venue=$8,start_at=$9,end_at=$10,version=version+1,updated_at=now() where id=$1 and admin_id=$2 and version=$11`, id, p.AdminID, next, stringValue(out["name"], ""), stringValue(out["status"], ""), stringValue(out["description"], ""), stringValue(out["organizer"], ""), stringValue(out["venue"], ""), startAt, endAt, version)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			writeJSON(w, 409, map[string]string{"error": "ข้อมูลถูกแก้ไขจากอุปกรณ์อื่น", "code": "version_conflict"})
			return
		}
		out["version"] = version + 1
		a.tournamentAudit(r.Context(), p, id, "UPDATE_TOURNAMENT", "tournament", id, stringValue(patch["_auditReason"], ""), nil)
		writeJSON(w, 200, out)
		return
	}
	writeJSON(w, 405, map[string]string{"error": "method not allowed"})
}

func (a *app) deleteTournamentDivision(w http.ResponseWriter, r *http.Request, tournamentID, divisionID string) {
	p, ok := a.requireTournamentPrincipal(w, r, "editSettings")
	if !ok {
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()

	var raw []byte
	var version int64
	if err = tx.QueryRowContext(r.Context(), `select settings,version from tournaments where id=$1 and admin_id=$2 and archived_at is null for update`, tournamentID, p.AdminID).Scan(&raw, &version); err != nil {
		writeJSON(w, 404, map[string]string{"error": "ไม่พบรายการแข่งขัน"})
		return
	}
	var registrations int
	if err = tx.QueryRowContext(r.Context(), `select count(*)::int from tournament_entries where tournament_id=$1 and admin_id=$2 and division_id=$3`, tournamentID, p.AdminID, divisionID).Scan(&registrations); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	if registrations > 0 {
		writeJSON(w, 409, map[string]any{
			"error":         "ลบระดับมือไม่ได้ เนื่องจากมีผู้สมัครในระดับนี้แล้ว",
			"code":          "division_has_registrations",
			"registrations": registrations,
		})
		return
	}

	settings := map[string]any{}
	if err = json.Unmarshal(raw, &settings); err != nil {
		writeJSON(w, 500, map[string]string{"error": "ข้อมูลตั้งค่ารายการไม่ถูกต้อง"})
		return
	}
	items, _ := settings["divisions"].([]any)
	filtered := make([]any, 0, len(items))
	found := false
	for _, item := range items {
		division, _ := item.(map[string]any)
		if stringValue(division["id"], "") == divisionID {
			found = true
			continue
		}
		filtered = append(filtered, item)
	}
	if !found {
		writeJSON(w, 404, map[string]string{"error": "ไม่พบระดับมือ"})
		return
	}
	settings["divisions"] = filtered
	next, _ := json.Marshal(settings)
	if _, err = tx.ExecContext(r.Context(), `update tournaments set settings=$3,version=version+1,updated_at=now() where id=$1 and admin_id=$2`, tournamentID, p.AdminID, next); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `delete from tournament_divisions where id=$1 and tournament_id=$2 and admin_id=$3`, divisionID, tournamentID, p.AdminID); err != nil {
		writeJSON(w, 500, map[string]string{"error": "ลบข้อมูลระดับมือไม่สำเร็จ"})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": "ลบระดับมือไม่สำเร็จ"})
		return
	}
	a.tournamentAudit(r.Context(), p, tournamentID, "DELETE_DIVISION", "division", divisionID, "ยืนยันลบระดับมือที่ยังไม่มีผู้สมัคร", nil)
	writeJSON(w, 200, map[string]any{"status": "deleted", "version": version + 1})
}

func capacityCoinCost(capacity, free, per int) int { return max(0, capacity-free) * per }

func (a *app) expandTournamentCapacity(w http.ResponseWriter, r *http.Request, id string) {
	p, ok := a.requireTournamentPrincipal(w, r, "editSettings")
	if !ok {
		return
	}
	var b struct {
		MaxParticipants        int   `json:"maxParticipants"`
		AdditionalParticipants int   `json:"additionalParticipants"`
		Version                int64 `json:"version"`
	}
	if json.NewDecoder(r.Body).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid json"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var current, free, per, charged int
	var version int64
	if err = tx.QueryRowContext(r.Context(), `select max_participants,pricing_free_snapshot,pricing_per_participant_snapshot,charged_coin,version from tournaments where id=$1 and admin_id=$2 for update`, id, p.AdminID).Scan(&current, &free, &per, &charged, &version); err != nil {
		writeJSON(w, 404, map[string]string{"error": "not found"})
		return
	}
	next := b.MaxParticipants
	if next == 0 {
		next = current + b.AdditionalParticipants
	}
	if next <= current {
		writeJSON(w, 400, map[string]string{"error": "capacity ใหม่ต้องมากกว่าเดิม"})
		return
	}
	if b.Version > 0 && b.Version != version {
		writeJSON(w, 409, map[string]string{"error": "ข้อมูลถูกแก้ไขจากอุปกรณ์อื่น", "code": "version_conflict"})
		return
	}
	extra := capacityCoinCost(next, free, per) - charged
	var coins int
	if err = tx.QueryRowContext(r.Context(), `select coins from admin_users where id=$1 for update`, p.AdminID).Scan(&coins); err != nil || coins < extra {
		writeJSON(w, 409, map[string]string{"error": "coin ไม่พอ"})
		return
	}
	balance := coins - extra
	if _, err = tx.ExecContext(r.Context(), `update tournaments set max_participants=$3,charged_coin=charged_coin+$4,version=version+1,updated_at=now() where id=$1 and admin_id=$2`, id, p.AdminID, next, extra); err == nil {
		_, err = tx.ExecContext(r.Context(), `update admin_users set coins=$2 where id=$1`, p.AdminID, balance)
	}
	if err == nil && extra > 0 {
		_, err = tx.ExecContext(r.Context(), `insert into coin_ledger(admin_id,delta,balance,reason,note) values($1,$2,$3,'tournament_capacity',$4)`, p.AdminID, -extra, balance, "expand "+id)
	}
	if err != nil || tx.Commit() != nil {
		writeJSON(w, 500, map[string]string{"error": "ขยาย capacity ไม่สำเร็จ"})
		return
	}
	a.tournamentAudit(r.Context(), p, id, "EXPAND_CAPACITY", "tournament", id, "", map[string]any{"from": current, "to": next, "chargedCoin": extra})
	writeJSON(w, 200, map[string]any{"maxParticipants": next, "chargedCoin": charged + extra, "coinBalance": balance, "version": version + 1})
}

func (a *app) tournamentLegacyState(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireTournamentPrincipal(w, r, "")
	if !ok {
		return
	}
	items, _ := a.tournamentSummaries(r.Context(), p.AdminID)
	players, _ := a.tournamentPayloadRows(r.Context(), `select id,payload from tournament_entries where admin_id=$1 and withdrawn_at is null order by created_at`, p.AdminID)
	a.attachTournamentSlipURLs(r.Context(), p.AdminID, players)
	umpires, _ := a.tournamentPayloadRows(r.Context(), `select id,payload from tournament_officials where admin_id=$1 order by created_at`, p.AdminID)
	matchQuery := `select id,payload||jsonb_build_object('version',version) from tournament_matches where admin_id=$1 order by created_at`
	if p.Role == "director" {
		matchQuery = `select id,payload||jsonb_build_object('version',version) from tournament_matches where admin_id=$1 and payload->>'umpireId'='` + strings.ReplaceAll(p.ActorID, "'", "") + `' order by created_at`
	}
	matches, _ := a.tournamentPayloadRows(r.Context(), matchQuery, p.AdminID)
	draws, _ := a.tournamentPayloadRows(r.Context(), `select id::text,snapshot from tournament_draw_revisions where admin_id=$1 order by created_at`, p.AdminID)
	staff, _ := a.tournamentStaffItems(r.Context(), p.AdminID)
	incidents, _ := a.tournamentIncidentItems(r.Context(), p.AdminID)
	audits, _ := a.tournamentAuditItems(r.Context(), p.AdminID)
	writeJSON(w, 200, map[string]any{"liveMatchFeatureEnabled": true, "activeUserRole": p.Role, "activeUserName": p.Name, "coinBalance": p.Coins, "tournaments": items, "players": players, "umpires": umpires, "matches": matches, "drawRevisions": draws, "subAccounts": staff, "rolePermissions": tournamentPermissionDefaults, "auditLogs": audits, "incidents": incidents})
}

func (a *app) tournamentPayloadRows(ctx context.Context, query, adminID string) ([]map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, query, adminID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id string
		var raw []byte
		if err = rows.Scan(&id, &raw); err != nil {
			return nil, err
		}
		item := map[string]any{}
		_ = json.Unmarshal(raw, &item)
		item["id"] = id
		items = append(items, item)
	}
	return items, rows.Err()
}

func (a *app) attachTournamentSlipURLs(ctx context.Context, adminID string, items []map[string]any) {
	for _, item := range items {
		fileID := strings.TrimSpace(stringValue(item["slipFileId"], ""))
		if fileID == "" {
			delete(item, "slipImageUrl")
			continue
		}
		var exists bool
		_ = a.db.QueryRowContext(ctx, `select exists(select 1 from tournament_files where id=$1 and admin_id=$2 and kind='payment_slip' and not staged)`, fileID, adminID).Scan(&exists)
		if exists {
			item["slipImageUrl"] = "/api/tournament/files/" + url.PathEscape(fileID)
		} else {
			delete(item, "slipImageUrl")
		}
	}
}

func (a *app) tournamentStaffItems(ctx context.Context, adminID string) ([]map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, `select id,staff_number,name,email,phone,role,active,permissions,coalesce(to_char(last_login_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),'') from tournament_staff where admin_id=$1 order by created_at`, adminID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, num, name, email, phone, role, lastLogin string
		var active bool
		var raw []byte
		if err = rows.Scan(&id, &num, &name, &email, &phone, &role, &active, &raw, &lastLogin); err != nil {
			return nil, err
		}
		perms := map[string]bool{}
		_ = json.Unmarshal(raw, &perms)
		for key, value := range tournamentPermissionDefaults[role] {
			if _, exists := perms[key]; !exists {
				perms[key] = value
			}
		}
		items = append(items, map[string]any{"id": id, "staffNumber": num, "name": name, "email": email, "phone": phone, "role": role, "active": active, "permissions": perms, "lastLogin": lastLogin})
	}
	return items, rows.Err()
}

func (a *app) tournamentIncidentItems(ctx context.Context, adminID string) ([]map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, `select id,tournament_id,coalesce(match_id,''),incident_type,description,status,reported_by,to_char(created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from tournament_incidents where admin_id=$1 order by created_at desc`, adminID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, tid, mid, typ, desc, status, by, at string
		if err = rows.Scan(&id, &tid, &mid, &typ, &desc, &status, &by, &at); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"id": id, "tournamentId": tid, "matchId": mid, "type": typ, "description": desc, "status": status, "reportedBy": by, "timestamp": at})
	}
	return items, rows.Err()
}

func (a *app) tournamentAuditItems(ctx context.Context, adminID string) ([]map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, `select id::text,coalesce(tournament_id,''),actor_name,action,target_type,target_id,reason,to_char(created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI:SS') from tournament_audit_logs where admin_id=$1 order by created_at desc limit 200`, adminID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, tid, actor, action, typ, target, reason, at string
		if err = rows.Scan(&id, &tid, &actor, &action, &typ, &target, &reason, &at); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"id": id, "tournamentId": tid, "actor": actor, "action": action, "targetType": typ, "targetId": target, "reason": reason, "timestamp": at})
	}
	return items, rows.Err()
}

func validTournamentStaffRole(role string) bool {
	return role == "tournament_admin" || role == "registration_staff" || role == "score_staff"
}

func tournamentStaffPermissions(role string, requested map[string]bool) map[string]bool {
	permissions := map[string]bool{}
	for key, value := range tournamentPermissionDefaults[role] {
		permissions[key] = value
	}
	for key, value := range requested {
		if _, known := tournamentPermissionDefaults["owner"][key]; known {
			permissions[key] = value
		}
	}
	permissions["manageSubAccounts"] = false
	return permissions
}

func (a *app) tournamentStaffRoutes(w http.ResponseWriter, r *http.Request, path string) {
	p, ok := a.requireTournamentPrincipal(w, r, "manageSubAccounts")
	if !ok {
		return
	}
	if p.Role != "owner" {
		writeJSON(w, 403, map[string]string{"error": "เฉพาะ Owner"})
		return
	}
	parts := strings.Split(path, "/")
	if len(parts) == 2 && r.Method == http.MethodGet {
		items, err := a.tournamentStaffItems(r.Context(), p.AdminID)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "maxMembers": 5})
		return
	}
	if len(parts) == 2 && r.Method == http.MethodPost {
		var b struct {
			Name, Email, Phone, Role, PIN string
			Permissions                   map[string]bool
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&b) != nil || strings.TrimSpace(b.Name) == "" {
			writeJSON(w, 400, map[string]string{"error": "ข้อมูลไม่ถูกต้อง"})
			return
		}
		var count int
		_ = a.db.QueryRowContext(r.Context(), `select count(*) from tournament_staff where admin_id=$1`, p.AdminID).Scan(&count)
		if count >= maxTournamentStaff {
			writeJSON(w, 409, map[string]string{"error": "สร้างบัญชีผู้ใช้งานรองได้สูงสุด 5 บัญชี"})
			return
		}
		if b.PIN == "" {
			b.PIN = tournamentRandomDigits(6)
		}
		if b.Role == "" {
			b.Role = "tournament_admin"
		}
		if !validTournamentStaffRole(b.Role) {
			writeJSON(w, 400, map[string]string{"error": "Role ไม่ถูกต้อง"})
			return
		}
		if len(b.PIN) != 6 || strings.Trim(b.PIN, "0123456789") != "" {
			writeJSON(w, 400, map[string]string{"error": "PIN ต้องเป็นตัวเลข 6 หลัก"})
			return
		}
		hash, _ := bcrypt.GenerateFromPassword([]byte(b.PIN), bcrypt.DefaultCost)
		num := fmt.Sprintf("%d-T%02d", p.AdminNumber, count+1)
		id := "tstaff-" + randHex(8)
		permissions := tournamentStaffPermissions(b.Role, b.Permissions)
		raw, _ := json.Marshal(permissions)
		_, err := a.db.ExecContext(r.Context(), `insert into tournament_staff(id,admin_id,staff_number,name,email,phone,role,pin_hash,permissions) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, id, p.AdminID, num, strings.TrimSpace(b.Name), normalizeEmail(b.Email), strings.TrimSpace(b.Phone), b.Role, string(hash), raw)
		if err != nil {
			writeJSON(w, 409, map[string]string{"error": "สร้างบัญชีไม่สำเร็จ"})
			return
		}
		a.tournamentAudit(r.Context(), p, "", "CREATE_STAFF", "tournament_staff", id, "", map[string]any{"staffNumber": num, "role": b.Role})
		writeJSON(w, 201, map[string]any{"id": id, "staffNumber": num, "pin": b.PIN})
		return
	}
	if len(parts) >= 3 {
		staffID := parts[2]
		if r.Method == http.MethodPatch {
			var b map[string]any
			_ = json.NewDecoder(r.Body).Decode(&b)
			name := stringValue(b["name"], "")
			email := normalizeEmail(stringValue(b["email"], ""))
			phone := stringValue(b["phone"], "")
			role := stringValue(b["role"], "")
			if role != "" && !validTournamentStaffRole(role) {
				writeJSON(w, 400, map[string]string{"error": "Role ไม่ถูกต้อง"})
				return
			}
			var active any
			if activeValue, exists := b["active"].(bool); exists {
				active = activeValue
			}
			var permissionsJSON any
			if requested, exists := b["permissions"].(map[string]any); exists {
				currentRole := role
				if currentRole == "" {
					_ = a.db.QueryRowContext(r.Context(), `select role from tournament_staff where id=$1 and admin_id=$2`, staffID, p.AdminID).Scan(&currentRole)
				}
				requestedPermissions := map[string]bool{}
				for key, value := range requested {
					if enabled, ok := value.(bool); ok {
						requestedPermissions[key] = enabled
					}
				}
				encoded, _ := json.Marshal(tournamentStaffPermissions(currentRole, requestedPermissions))
				permissionsJSON = string(encoded)
			}
			res, err := a.db.ExecContext(r.Context(), `update tournament_staff set name=coalesce(nullif($3,''),name),email=case when $4='' then email else $4 end,phone=case when $5='' then phone else $5 end,role=coalesce(nullif($6,''),role),active=coalesce($7::boolean,active),permissions=coalesce($8::jsonb,permissions),updated_at=now() where id=$1 and admin_id=$2`, staffID, p.AdminID, name, email, phone, role, active, permissionsJSON)
			if err != nil {
				writeJSON(w, 409, map[string]string{"error": err.Error()})
				return
			}
			n, _ := res.RowsAffected()
			if n == 0 {
				writeJSON(w, 404, map[string]string{"error": "not found"})
				return
			}
			if activeValue, exists := active.(bool); exists && !activeValue {
				_, _ = a.db.ExecContext(r.Context(), `update tournament_staff_sessions set revoked_at=coalesce(revoked_at,now()) where staff_id=$1`, staffID)
			}
			a.tournamentAudit(r.Context(), p, "", "UPDATE_STAFF", "tournament_staff", staffID, "", map[string]any{"role": role, "active": active})
			writeJSON(w, 200, map[string]string{"status": "ok"})
			return
		}
		if r.Method == http.MethodDelete {
			_, _ = a.db.ExecContext(r.Context(), `update tournament_staff set active=false,updated_at=now() where id=$1 and admin_id=$2`, staffID, p.AdminID)
			_, _ = a.db.ExecContext(r.Context(), `update tournament_staff_sessions set revoked_at=coalesce(revoked_at,now()) where staff_id=$1`, staffID)
			a.tournamentAudit(r.Context(), p, "", "DEACTIVATE_STAFF", "tournament_staff", staffID, "", nil)
			writeJSON(w, 200, map[string]string{"status": "deactivated"})
			return
		}
		if len(parts) == 4 && parts[3] == "reset-pin" && r.Method == http.MethodPost {
			pin := tournamentRandomDigits(6)
			hash, _ := bcrypt.GenerateFromPassword([]byte(pin), bcrypt.DefaultCost)
			res, _ := a.db.ExecContext(r.Context(), `update tournament_staff set pin_hash=$3,updated_at=now() where id=$1 and admin_id=$2`, staffID, p.AdminID, string(hash))
			n, _ := res.RowsAffected()
			if n == 0 {
				writeJSON(w, 404, map[string]string{"error": "not found"})
				return
			}
			_, _ = a.db.ExecContext(r.Context(), `update tournament_staff_sessions set revoked_at=coalesce(revoked_at,now()) where staff_id=$1`, staffID)
			a.tournamentAudit(r.Context(), p, "", "RESET_STAFF_PIN", "tournament_staff", staffID, "", nil)
			writeJSON(w, 200, map[string]string{"pin": pin})
			return
		}
		if len(parts) == 4 && parts[3] == "revoke-sessions" && r.Method == http.MethodPost {
			res, err := a.db.ExecContext(r.Context(), `update tournament_staff_sessions set revoked_at=coalesce(revoked_at,now()) where staff_id=$1 and revoked_at is null and exists(select 1 from tournament_staff where id=$1 and admin_id=$2)`, staffID, p.AdminID)
			if err != nil {
				writeJSON(w, 500, map[string]string{"error": err.Error()})
				return
			}
			revoked, _ := res.RowsAffected()
			a.tournamentAudit(r.Context(), p, "", "REVOKE_STAFF_SESSIONS", "tournament_staff", staffID, "", map[string]any{"revoked": revoked})
			writeJSON(w, 200, map[string]any{"status": "ok", "revokedSessions": revoked})
			return
		}
	}
	writeJSON(w, 404, map[string]string{"error": "not found"})
}

func registrationListPage(queryPage, queryPageSize string) (int, int) {
	page, _ := strconv.Atoi(queryPage)
	pageSize, _ := strconv.Atoi(queryPageSize)
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 10
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}

func (a *app) tournamentRegistrationList(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireTournamentPrincipal(w, r, "")
	if !ok {
		return
	}
	tournamentID := strings.TrimSpace(r.URL.Query().Get("tournamentId"))
	if tournamentID == "" {
		writeJSON(w, 400, map[string]string{"error": "tournamentId required"})
		return
	}
	page, pageSize := registrationListPage(r.URL.Query().Get("page"), r.URL.Query().Get("pageSize"))
	offset := (page - 1) * pageSize
	kind := stringValue(r.URL.Query().Get("kind"), "players")
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	status := stringValue(r.URL.Query().Get("status"), "all")
	source := stringValue(r.URL.Query().Get("source"), "all")

	var rows *sql.Rows
	var total int
	var err error
	if kind == "directors" {
		query := ` from tournament_officials where admin_id=$1 and tournament_id=$2
			and ($3='all' or approval_status=$3)
			and ($4='all' or coalesce(payload->>'applicationSource','staff')=$4)
			and ($5='' or first_name ilike '%'||$5||'%' or last_name ilike '%'||$5||'%' or code ilike '%'||$5||'%' or coalesce(payload->>'clubAffiliation','') ilike '%'||$5||'%')`
		if err = a.db.QueryRowContext(r.Context(), `select count(*)`+query, p.AdminID, tournamentID, status, source, search).Scan(&total); err == nil {
			rows, err = a.db.QueryContext(r.Context(), `select id,payload || jsonb_build_object(
				'approvalStatus',approval_status,'active',active,
				'codeExpiresAt',coalesce(to_char(code_expires_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),'')
			)`+query+` order by created_at desc,id desc limit $6 offset $7`, p.AdminID, tournamentID, status, source, search, pageSize, offset)
		}
	} else {
		division := stringValue(r.URL.Query().Get("division"), "all")
		payment := stringValue(r.URL.Query().Get("payment"), "all")
		checkIn := stringValue(r.URL.Query().Get("checkIn"), "all")
		base := ` from tournament_entries where admin_id=$1 and tournament_id=$2 and withdrawn_at is null
			and ($3='' or team_name ilike '%'||$3||'%' or registration_code ilike '%'||$3||'%' or coalesce(payload->>'firstName','') ilike '%'||$3||'%' or coalesce(payload->>'lastName','') ilike '%'||$3||'%' or coalesce(payload->>'club','') ilike '%'||$3||'%' or coalesce(payload->>'slipTransferRef','') ilike '%'||$3||'%')
			and ($4='all' or division_id=$4)
			and ($5='all' or payment_status=$5 or ($5='rejected' and (payload->>'slipStatus'='rejected')))
			and ($6='all' or ($6='yes' and coalesce((payload->>'checkedIn')::boolean,false)) or ($6='no' and not coalesce((payload->>'checkedIn')::boolean,false)))
			and ($7='all' or document_status=$7)
			and ($8='all' or ($8='online' and source in ('online','public')) or source=$8)`
		if kind == "payments" {
			base += ` and source in ('online','public')`
		}
		if err = a.db.QueryRowContext(r.Context(), `select count(*)`+base, p.AdminID, tournamentID, search, division, payment, checkIn, status, source).Scan(&total); err == nil {
			rows, err = a.db.QueryContext(r.Context(), `select id,payload`+base+` order by created_at desc,id desc limit $9 offset $10`, p.AdminID, tournamentID, search, division, payment, checkIn, status, source, pageSize, offset)
		}
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id string
		var raw []byte
		if err = rows.Scan(&id, &raw); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		item := map[string]any{}
		_ = json.Unmarshal(raw, &item)
		item["id"] = id
		items = append(items, item)
	}
	if kind != "directors" {
		a.attachTournamentSlipURLs(r.Context(), p.AdminID, items)
	}
	totalPages := 0
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	writeJSON(w, 200, map[string]any{"items": items, "pagination": map[string]any{"page": page, "pageSize": pageSize, "total": total, "totalPages": totalPages}})
}

func (a *app) tournamentEntryRoutes(w http.ResponseWriter, r *http.Request, path string) {
	p, ok := a.requireTournamentPrincipal(w, r, map[bool]string{true: "approveRegistration", false: ""}[r.Method != http.MethodGet])
	if !ok {
		return
	}
	parts := strings.Split(path, "/")
	if path == "players/merge" && r.Method == http.MethodPost {
		var b struct {
			PrimaryID   string `json:"primaryId"`
			DuplicateID string `json:"duplicateId"`
		}
		if json.NewDecoder(r.Body).Decode(&b) != nil || b.PrimaryID == "" || b.DuplicateID == "" || b.PrimaryID == b.DuplicateID {
			writeJSON(w, 400, map[string]string{"error": "invalid merge"})
			return
		}
		tx, err := a.db.BeginTx(r.Context(), nil)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		defer tx.Rollback()
		var tid string
		if err = tx.QueryRowContext(r.Context(), `select tournament_id from tournament_entries where id=$1 and admin_id=$2 for update`, b.PrimaryID, p.AdminID).Scan(&tid); err != nil {
			writeJSON(w, 404, map[string]string{"error": "primary not found"})
			return
		}
		res, err := tx.ExecContext(r.Context(), `update tournament_entries set withdrawn_at=now(),payload=payload||jsonb_build_object('mergedInto',$3),version=version+1 where id=$1 and admin_id=$2 and tournament_id=$4`, b.DuplicateID, p.AdminID, b.PrimaryID, tid)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			writeJSON(w, 404, map[string]string{"error": "duplicate not found"})
			return
		}
		if err = tx.Commit(); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		a.tournamentAudit(r.Context(), p, tid, "MERGE_ENTRY", "entry", b.DuplicateID, "", map[string]string{"primaryId": b.PrimaryID})
		writeJSON(w, 200, map[string]string{"status": "merged"})
		return
	}
	if path == "players" && r.Method == http.MethodPost {
		a.createTournamentEntry(w, r, p, "staff")
		return
	}
	if path == "players/bulk" && (r.Method == http.MethodPatch || r.Method == http.MethodPost) {
		var b struct {
			IDs    []string       `json:"ids"`
			Patch  map[string]any `json:"patch"`
			Action string         `json:"action"`
		}
		if json.NewDecoder(r.Body).Decode(&b) != nil {
			writeJSON(w, 400, map[string]string{"error": "invalid json"})
			return
		}
		if b.Patch == nil {
			b.Patch = map[string]any{}
		}
		if b.Action == "approve" {
			b.Patch["documentStatus"] = "approved"
		}
		if b.Action == "checkin" {
			b.Patch["checkedIn"] = true
			b.Patch["checkInTime"] = time.Now().In(time.FixedZone("Asia/Bangkok", 7*60*60)).Format("2006-01-02 15:04")
		}
		for _, id := range b.IDs {
			_ = a.patchTournamentPayload(r.Context(), "tournament_entries", id, p.AdminID, b.Patch)
			if status := stringValue(b.Patch["documentStatus"], ""); status != "" {
				_, _ = a.db.ExecContext(r.Context(), `update tournament_entries set document_status=$3,version=version+1,updated_at=now() where id=$1 and admin_id=$2`, id, p.AdminID, status)
			}
		}
		writeJSON(w, 200, map[string]string{"status": "ok"})
		return
	}
	if len(parts) == 3 && r.Method == http.MethodPost && parts[2] == "upload-slip" {
		if !p.Permissions["verifyPayment"] {
			writeJSON(w, 403, map[string]string{"error": "ไม่มีสิทธิ์แนบสลิป", "code": "permission_denied"})
			return
		}
		id := parts[1]
		var b map[string]any
		if json.NewDecoder(r.Body).Decode(&b) != nil || strings.TrimSpace(stringValue(b["slipFileId"], "")) == "" {
			writeJSON(w, 400, map[string]string{"error": "กรุณาแนบไฟล์สลิป", "code": "payment_slip_required"})
			return
		}
		tx, err := a.db.BeginTx(r.Context(), nil)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		defer tx.Rollback()
		var tid string
		var raw []byte
		if err = tx.QueryRowContext(r.Context(), `select tournament_id,payload from tournament_entries where id=$1 and admin_id=$2 for update`, id, p.AdminID).Scan(&tid, &raw); err != nil {
			writeJSON(w, 404, map[string]string{"error": "ไม่พบผู้สมัคร"})
			return
		}
		fileID := strings.TrimSpace(stringValue(b["slipFileId"], ""))
		res, err := tx.ExecContext(r.Context(), `update tournament_files set staged=false,expires_at=null where id=$1 and admin_id=$2 and tournament_id=$3 and staged and kind='payment_slip'`, fileID, p.AdminID, tid)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": "ผูกไฟล์สลิปไม่สำเร็จ"})
			return
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			writeJSON(w, 400, map[string]string{"error": "ไฟล์สลิปไม่ถูกต้องหรือหมดอายุ"})
			return
		}
		item := map[string]any{}
		_ = json.Unmarshal(raw, &item)
		item["slipFileId"] = fileID
		item["slipStatus"] = "pending"
		item["paymentStatus"] = "pending_verify"
		item["slipUploadedAt"] = time.Now().In(time.FixedZone("Asia/Bangkok", 7*60*60)).Format(time.RFC3339)
		for _, key := range []string{"slipTransferBank", "slipTransferAmount", "slipTransferRef"} {
			if value, exists := b[key]; exists {
				item[key] = value
			}
		}
		delete(item, "slipImageUrl")
		next, _ := json.Marshal(item)
		if _, err = tx.ExecContext(r.Context(), `update tournament_entries set payment_status='pending_verify',payload=$3,version=version+1,updated_at=now() where id=$1 and admin_id=$2`, id, p.AdminID, next); err != nil || tx.Commit() != nil {
			writeJSON(w, 500, map[string]string{"error": "บันทึกสลิปไม่สำเร็จ"})
			return
		}
		a.tournamentAudit(r.Context(), p, tid, "UPLOAD_PAYMENT_SLIP", "entry", id, "", map[string]any{"fileId": fileID})
		writeJSON(w, 200, map[string]any{"status": "pending_verify", "slipFileId": fileID, "slipImageUrl": "/api/tournament/files/" + url.PathEscape(fileID)})
		return
	}
	if len(parts) == 3 && r.Method == http.MethodPost && parts[2] == "regenerate-verification-code" {
		code := tournamentRandomDigits(6)
		var tournamentID string
		var raw []byte
		if err := a.db.QueryRowContext(r.Context(), `select tournament_id,payload from tournament_entries where id=$1 and admin_id=$2`, parts[1], p.AdminID).Scan(&tournamentID, &raw); err != nil {
			writeJSON(w, 404, map[string]string{"error": "ไม่พบผู้สมัคร"})
			return
		}
		item := map[string]any{}
		_ = json.Unmarshal(raw, &item)
		item["verificationCodeLast4"] = code[2:]
		next, _ := json.Marshal(item)
		if _, err := a.db.ExecContext(r.Context(), `update tournament_entries set verification_code_hash=$3,payload=$4,version=version+1,updated_at=now() where id=$1 and admin_id=$2`, parts[1], p.AdminID, tournamentSecretDigest(code), next); err != nil {
			writeJSON(w, 500, map[string]string{"error": "สร้างรหัสดูสถานะไม่สำเร็จ"})
			return
		}
		a.tournamentAudit(r.Context(), p, tournamentID, "REGENERATE_ENTRY_VERIFICATION_CODE", "entry", parts[1], "", nil)
		writeJSON(w, 200, map[string]string{"verificationCode": code})
		return
	}
	if len(parts) == 3 && r.Method == http.MethodPost && (parts[2] == "review-payment" || parts[2] == "review-approval") {
		id := parts[1]
		var b map[string]any
		if json.NewDecoder(r.Body).Decode(&b) != nil {
			writeJSON(w, 400, map[string]string{"error": "invalid json"})
			return
		}
		tx, err := a.db.BeginTx(r.Context(), nil)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		defer tx.Rollback()
		var tid string
		var raw []byte
		if err = tx.QueryRowContext(r.Context(), `select tournament_id,payload from tournament_entries where id=$1 and admin_id=$2 for update`, id, p.AdminID).Scan(&tid, &raw); err != nil {
			writeJSON(w, 404, map[string]string{"error": "not found"})
			return
		}
		item := map[string]any{}
		_ = json.Unmarshal(raw, &item)
		if parts[2] == "review-payment" {
			decision := stringValue(b["decision"], "pending")
			status := map[string]string{"approved": "paid", "rejected": "unpaid", "partial": "partial"}[decision]
			if status == "" {
				status = stringValue(b["paymentStatus"], stringValue(b["status"], "pending_verify"))
			}
			amount := int64(0)
			amountValue := b["paidAmount"]
			if amountValue == nil {
				amountValue = b["amountPaid"]
			}
			if decision == "approved" && amountValue == nil {
				amountValue = item["amountDue"]
			}
			if v, e := strconv.ParseFloat(fmt.Sprint(amountValue), 64); e == nil {
				amount = int64(v * 100)
			}
			if amount < 0 {
				writeJSON(w, 400, map[string]string{"error": "ยอดชำระต้องไม่ติดลบ"})
				return
			}
			item["paymentStatus"] = status
			item["slipStatus"] = map[bool]string{true: "rejected", false: "approved"}[decision == "rejected"]
			item["amountPaid"] = float64(amount) / 100
			if status == "paid" {
				item["amountDue"] = 0
			} else if status == "partial" {
				originalDue, _ := strconv.ParseFloat(fmt.Sprint(item["amountDue"]), 64)
				item["amountDue"] = math.Max(0, originalDue-float64(amount)/100)
			}
			if reason := stringValue(b["reason"], ""); reason != "" {
				item["paymentRejectReason"] = reason
			}
			item["paymentVerifiedBy"] = p.Name
			item["paymentVerifiedAt"] = time.Now().In(time.FixedZone("Asia/Bangkok", 7*60*60)).Format(time.RFC3339)
			next, _ := json.Marshal(item)
			paymentID := "tpayment-" + randHex(8)
			_, err = tx.ExecContext(r.Context(), `insert into tournament_payments(id,entry_id,tournament_id,admin_id,amount_satang,method,status,provider,reference_number,received_by) values($1,$2,$3,$4,$5,$6,$7,'manual',$8,$9)`, paymentID, id, tid, p.AdminID, amount, stringValue(b["method"], "manual"), status, stringValue(b["referenceNumber"], ""), p.ActorID)
			if err == nil {
				_, err = tx.ExecContext(r.Context(), `update tournament_entries set payment_status=$3,amount_paid_satang=$4,payload=$5,version=version+1,updated_at=now() where id=$1 and admin_id=$2`, id, p.AdminID, status, amount, next)
			}
		} else {
			status := stringValue(b["decision"], stringValue(b["documentStatus"], stringValue(b["status"], "approved")))
			item["documentStatus"] = status
			item["approvalNote"] = stringValue(b["reason"], "")
			item["approvedBy"] = p.Name
			item["approvedAt"] = time.Now().In(time.FixedZone("Asia/Bangkok", 7*60*60)).Format(time.RFC3339)
			next, _ := json.Marshal(item)
			_, err = tx.ExecContext(r.Context(), `update tournament_entries set document_status=$3,payload=$4,version=version+1,updated_at=now() where id=$1 and admin_id=$2`, id, p.AdminID, status, next)
		}
		if err != nil || tx.Commit() != nil {
			writeJSON(w, 500, map[string]string{"error": "บันทึกผลตรวจสอบไม่สำเร็จ"})
			return
		}
		a.tournamentAudit(r.Context(), p, tid, strings.ToUpper(strings.ReplaceAll(parts[2], "-", "_")), "entry", id, stringValue(b["reason"], ""), nil)
		writeJSON(w, 200, map[string]string{"status": "ok"})
		return
	}
	if len(parts) == 2 {
		id := parts[1]
		if r.Method == http.MethodPatch {
			var patch map[string]any
			if json.NewDecoder(r.Body).Decode(&patch) != nil {
				writeJSON(w, 400, map[string]string{"error": "invalid json"})
				return
			}
			if err := a.patchTournamentPayload(r.Context(), "tournament_entries", id, p.AdminID, patch); err != nil {
				writeJSON(w, 404, map[string]string{"error": "ไม่พบผู้สมัคร"})
				return
			}
			if teamName := strings.TrimSpace(stringValue(patch["teamName"], "")); teamName != "" {
				_, _ = a.db.ExecContext(r.Context(), `update tournament_entries set team_name=$3,version=version+1,updated_at=now() where id=$1 and admin_id=$2`, id, p.AdminID, teamName)
			}
			if paymentStatus := strings.TrimSpace(stringValue(patch["paymentStatus"], "")); paymentStatus != "" {
				_, _ = a.db.ExecContext(r.Context(), `update tournament_entries set payment_status=$3,version=version+1,updated_at=now() where id=$1 and admin_id=$2`, id, p.AdminID, paymentStatus)
			}
			if rawMembers, ok := patch["members"].([]any); ok {
				for index, rawMember := range rawMembers {
					member, _ := rawMember.(map[string]any)
					if member == nil {
						continue
					}
					memberRaw, _ := json.Marshal(member)
					_, _ = a.db.ExecContext(r.Context(), `update tournament_people set first_name=$4,last_name=$5,nickname=$6,phone=$7,email=$8,club=$9,province=$10,payload=$11 where admin_id=$1 and id=(select person_id from tournament_entry_members where entry_id=$2 and slot=$3)`,
						p.AdminID, id, index+1, stringValue(member["firstName"], ""), stringValue(member["lastName"], ""), stringValue(member["nickname"], ""), stringValue(member["phone"], ""), normalizeEmail(stringValue(member["email"], "")), stringValue(member["club"], ""), stringValue(member["province"], ""), memberRaw)
				}
			}
			writeJSON(w, 200, map[string]string{"status": "ok"})
			return
		}
		if r.Method == http.MethodDelete {
			tx, err := a.db.BeginTx(r.Context(), nil)
			if err != nil {
				writeJSON(w, 500, map[string]string{"error": err.Error()})
				return
			}
			defer tx.Rollback()
			var tid string
			if err = tx.QueryRowContext(r.Context(), `update tournament_entries set withdrawn_at=now(),version=version+1 where id=$1 and admin_id=$2 and withdrawn_at is null returning tournament_id`, id, p.AdminID).Scan(&tid); err != nil {
				writeJSON(w, 500, map[string]string{"error": err.Error()})
				return
			}
			var promoted string
			_ = tx.QueryRowContext(r.Context(), `update tournament_entries set waiting_list=false,waiting_position=null,version=version+1,updated_at=now() where id=(select id from tournament_entries where tournament_id=$1 and waiting_list and withdrawn_at is null order by waiting_position,created_at for update skip locked limit 1) returning id`, tid).Scan(&promoted)
			if err = tx.Commit(); err != nil {
				writeJSON(w, 500, map[string]string{"error": err.Error()})
				return
			}
			writeJSON(w, 200, map[string]any{"status": "withdrawn", "promotedPlayerId": promoted})
			return
		}
	}
	writeJSON(w, 404, map[string]string{"error": "not found"})
}

func (a *app) createTournamentEntry(w http.ResponseWriter, r *http.Request, p tournamentPrincipal, source string) {
	var b map[string]any
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid json"})
		return
	}
	tid := stringValue(b["tournamentId"], "")
	if tid == "" {
		writeJSON(w, 400, map[string]string{"error": "tournamentId required"})
		return
	}
	if consent, _ := b["pdpaConsent"].(bool); !consent {
		writeJSON(w, 400, map[string]string{"error": "ต้องยอมรับความยินยอม PDPA ก่อนส่งใบสมัคร", "code": "pdpa_consent_required"})
		return
	}
	if source == "public" && stringValue(b["paymentStatus"], "unpaid") == "pending_verify" && strings.TrimSpace(stringValue(b["slipFileId"], "")) == "" {
		writeJSON(w, 400, map[string]string{"error": "กรุณาแนบไฟล์สลิปก่อนส่งตรวจสอบ", "code": "payment_slip_required"})
		return
	}
	members, memberErr := normalizeTournamentEntryMembers(b)
	if memberErr != nil {
		writeJSON(w, memberErr.Status, map[string]string{"error": memberErr.Message, "code": memberErr.Code})
		return
	}
	if source == "public" && p.TournamentID != "" && tid != p.TournamentID {
		writeJSON(w, 403, map[string]string{"error": "ลิงก์รับสมัครไม่ตรงกับรายการแข่งขัน", "code": "public_token_tournament_mismatch"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var maxParticipants, registeredPeople int
	var registrationConfig []byte
	if err = tx.QueryRowContext(r.Context(), `select max_participants,settings from tournaments where id=$1 and admin_id=$2 and archived_at is null for update`, tid, p.AdminID).Scan(&maxParticipants, &registrationConfig); err != nil {
		writeJSON(w, 404, map[string]string{"error": "ไม่พบรายการแข่งขัน"})
		return
	}
	settings := map[string]any{}
	if err = json.Unmarshal(registrationConfig, &settings); err != nil {
		writeJSON(w, 500, map[string]string{"error": "ข้อมูลตั้งค่ารายการไม่ถูกต้อง"})
		return
	}
	waitingListEnabled := true
	if source == "public" {
		var validationErr *tournamentRegistrationError
		waitingListEnabled, validationErr = validatePublicTournamentRegistration(settings, b, time.Now())
		if validationErr != nil {
			writeJSON(w, validationErr.Status, map[string]string{"error": validationErr.Message, "code": validationErr.Code})
			return
		}
	}
	_ = tx.QueryRowContext(r.Context(), `select coalesce(sum(case when format='doubles' then 2 else 1 end),0)::int from tournament_entries where tournament_id=$1 and withdrawn_at is null and waiting_list=false`, tid).Scan(&registeredPeople)
	people := len(members)
	waiting := registeredPeople+people > maxParticipants
	if waiting && !waitingListEnabled {
		writeJSON(w, 409, map[string]string{"error": "ผู้สมัครเต็มจำนวนและรายการนี้ไม่ได้เปิด Waiting List", "code": "registration_full"})
		return
	}
	divisionID := stringValue(b["divisionId"], "")
	if divisionID != "" {
		if err = ensureTournamentDivision(r.Context(), tx, tid, p.AdminID, divisionID, settings); err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error(), "code": "invalid_division"})
			return
		}
		format := stringValue(b["format"], "doubles")
		quota, unlimited, quotaErr := tournamentDivisionQuota(settings, divisionID, format)
		if quotaErr != nil {
			writeJSON(w, 400, map[string]string{"error": quotaErr.Error(), "code": "invalid_division"})
			return
		}
		if !unlimited {
			var registeredTeams int
			if err = tx.QueryRowContext(r.Context(), `select count(*) from tournament_entries where tournament_id=$1 and admin_id=$2 and division_id=$3 and format=$4 and withdrawn_at is null and waiting_list=false`, tid, p.AdminID, divisionID, format).Scan(&registeredTeams); err != nil {
				writeJSON(w, 500, map[string]string{"error": "ตรวจสอบจำนวนผู้สมัครไม่สำเร็จ"})
				return
			}
			if registeredTeams >= quota {
				writeJSON(w, 409, map[string]any{
					"error": "ระดับมือและประเภทนี้มีผู้สมัครครบแล้ว กรุณาติดต่อผู้จัดรายการ",
					"code":  "division_full", "quota": quota, "registered": registeredTeams, "remaining": 0,
				})
				return
			}
		}
	}
	b["waitingList"] = waiting
	id := "entry-" + randHex(8)
	code := strings.ToUpper(tournamentRandomDigits(8))
	verify := tournamentRandomDigits(6)
	b["id"], b["registrationCode"], b["verificationCode"], b["createdAt"] = id, code, verify, time.Now().In(time.FixedZone("Asia/Bangkok", 7*3600)).Format(time.RFC3339)
	persisted := map[string]any{}
	for k, v := range b {
		if k != "verificationCode" {
			persisted[k] = v
		}
	}
	persisted["verificationCodeLast4"] = verify[2:]
	persistedMembers := make([]any, 0, len(members))
	for _, member := range members {
		storedMember := make(map[string]any, len(member)+1)
		for key, value := range member {
			storedMember[key] = value
		}
		if health := strings.TrimSpace(stringValue(storedMember["healthInfo"], "")); health != "" {
			cipher, encryptErr := encryptSecret(health)
			if encryptErr != nil {
				writeJSON(w, 500, map[string]string{"error": "เข้ารหัสข้อมูลสุขภาพไม่สำเร็จ"})
				return
			}
			storedMember["healthEncrypted"] = cipher
			delete(storedMember, "healthInfo")
		}
		persistedMembers = append(persistedMembers, storedMember)
	}
	persisted["members"] = persistedMembers
	delete(persisted, "healthInfo")
	raw, _ := json.Marshal(persisted)
	due := int64(0)
	if v, err := strconv.ParseFloat(fmt.Sprint(b["amountDue"]), 64); err == nil {
		due = int64(v * 100)
	}
	_, err = tx.ExecContext(r.Context(), `insert into tournament_entries(id,tournament_id,admin_id,division_id,registration_code,verification_code_hash,team_name,format,source,document_status,payment_status,waiting_list,waiting_position,amount_due_satang,payload) values($1,$2,$3,nullif($4,''),$5,$6,$7,$8,$9,$10,$11,$12,case when $12 then (select count(*)+1 from tournament_entries where tournament_id=$2 and waiting_list and withdrawn_at is null) else null end,$13,$14)`, id, tid, p.AdminID, stringValue(b["divisionId"], ""), code, tournamentSecretDigest(verify), stringValue(b["teamName"], stringValue(b["name"], "ผู้สมัคร")), stringValue(b["format"], "doubles"), source, stringValue(b["documentStatus"], "pending"), stringValue(b["paymentStatus"], "unpaid"), waiting, due, raw)
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": err.Error()})
		return
	}
	for index, member := range persistedMembers {
		memberMap := member.(map[string]any)
		personID := "person-" + randHex(8)
		memberRaw, _ := json.Marshal(memberMap)
		_, err = tx.ExecContext(r.Context(), `insert into tournament_people(id,admin_id,first_name,last_name,nickname,gender,birth_date,phone,email,club,province,health_ciphertext,pdpa_consent,payload) values($1,$2,$3,$4,$5,$6,nullif($7,'')::date,$8,$9,$10,$11,$12,$13,$14)`,
			personID, p.AdminID, stringValue(memberMap["firstName"], ""), stringValue(memberMap["lastName"], ""), stringValue(memberMap["nickname"], ""), stringValue(memberMap["gender"], ""), stringValue(memberMap["birthDate"], ""), stringValue(memberMap["phone"], ""), stringValue(memberMap["email"], ""), stringValue(memberMap["club"], ""), stringValue(memberMap["province"], ""), stringValue(memberMap["healthEncrypted"], ""), true, memberRaw)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": "บันทึกข้อมูลนักกีฬาไม่สำเร็จ"})
			return
		}
		if _, err = tx.ExecContext(r.Context(), `insert into tournament_entry_members(entry_id,person_id,slot) values($1,$2,$3)`, id, personID, index+1); err != nil {
			writeJSON(w, 500, map[string]string{"error": "เชื่อมข้อมูลนักกีฬาเข้ากับใบสมัครไม่สำเร็จ"})
			return
		}
	}
	if fileID := strings.TrimSpace(stringValue(b["slipFileId"], "")); fileID != "" {
		res, fileErr := tx.ExecContext(r.Context(), `update tournament_files set staged=false,expires_at=null where id=$1 and admin_id=$2 and tournament_id=$3 and staged and kind='payment_slip'`, fileID, p.AdminID, tid)
		if fileErr != nil {
			writeJSON(w, 500, map[string]string{"error": "ผูกไฟล์สลิปไม่สำเร็จ"})
			return
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			writeJSON(w, 400, map[string]string{"error": "ไฟล์สลิปไม่ถูกต้องหรือหมดอายุ"})
			return
		}
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": "บันทึกใบสมัครไม่สำเร็จ"})
		return
	}
	a.tournamentAudit(r.Context(), p, tid, "CREATE_ENTRY", "entry", id, "", nil)
	if source == "public" {
		writeJSON(w, 201, map[string]any{
			"id": id, "tournamentId": tid, "registrationCode": code, "verificationCode": verify,
			"teamName": b["teamName"], "format": b["format"], "waitingList": waiting,
			"documentStatus": b["documentStatus"], "paymentStatus": b["paymentStatus"],
		})
		return
	}
	writeJSON(w, 201, b)
}

func normalizeTournamentEntryMembers(entry map[string]any) ([]map[string]any, *tournamentRegistrationError) {
	format := stringValue(entry["format"], "doubles")
	expected := 1
	if format == "doubles" {
		expected = 2
	} else if format != "singles" {
		return nil, &tournamentRegistrationError{Status: 400, Code: "invalid_format", Message: "ประเภทการแข่งขันไม่ถูกต้อง"}
	}

	members := []map[string]any{}
	if rawMembers, ok := entry["members"].([]any); ok {
		for _, raw := range rawMembers {
			if member, ok := raw.(map[string]any); ok {
				members = append(members, member)
			}
		}
	}
	if len(members) == 0 {
		members = append(members, map[string]any{
			"role": "primary", "firstName": entry["firstName"], "lastName": entry["lastName"], "nickname": entry["nickname"],
			"gender": entry["gender"], "birthDate": entry["birthDate"], "nationality": entry["nationality"], "idDocumentNo": entry["idDocumentNo"],
			"address": entry["address"], "phone": entry["phone"], "email": entry["email"], "club": entry["club"], "province": entry["province"],
			"photoUrl": entry["photoUrl"], "emergencyContact": entry["emergencyContact"], "healthInfo": entry["healthInfo"],
			"healthConsent": entry["healthConsent"], "pdpaConsent": entry["pdpaConsent"],
		})
		if expected == 2 {
			members = append(members, map[string]any{
				"role": "partner", "firstName": entry["partnerFirstName"], "lastName": entry["partnerLastName"], "nickname": entry["partnerNickname"],
				"gender": entry["partnerGender"], "birthDate": entry["partnerBirthDate"], "nationality": entry["partnerNationality"], "idDocumentNo": entry["partnerIdDocumentNo"],
				"address": entry["partnerAddress"], "phone": entry["partnerPhone"], "email": entry["partnerEmail"], "club": entry["club"], "province": entry["province"],
				"photoUrl": entry["partnerPhotoUrl"], "emergencyContact": entry["partnerEmergencyContact"], "healthInfo": entry["partnerHealthInfo"],
				"healthConsent": entry["partnerHealthConsent"], "pdpaConsent": entry["partnerPdpaConsent"],
			})
		}
	}
	if len(members) != expected {
		return nil, &tournamentRegistrationError{Status: 400, Code: "invalid_member_count", Message: fmt.Sprintf("ประเภท%sต้องมีข้อมูลนักกีฬา %d คน", map[bool]string{true: "คู่", false: "เดี่ยว"}[format == "doubles"], expected)}
	}
	for index, member := range members {
		if strings.TrimSpace(stringValue(member["firstName"], "")) == "" || strings.TrimSpace(stringValue(member["lastName"], "")) == "" {
			return nil, &tournamentRegistrationError{Status: 400, Code: "member_name_required", Message: fmt.Sprintf("กรุณากรอกชื่อและนามสกุลนักกีฬาคนที่ %d", index+1)}
		}
		consent, _ := member["pdpaConsent"].(bool)
		if !consent {
			return nil, &tournamentRegistrationError{Status: 400, Code: "member_pdpa_consent_required", Message: fmt.Sprintf("นักกีฬาคนที่ %d ต้องยอมรับความยินยอม PDPA", index+1)}
		}
	}
	entry["members"] = members
	return members, nil
}

func ensureTournamentDivision(ctx context.Context, tx *sql.Tx, tournamentID, adminID, divisionID string, settings map[string]any) error {
	items, _ := settings["divisions"].([]any)
	for index, raw := range items {
		division, _ := raw.(map[string]any)
		if stringValue(division["id"], "") != divisionID {
			continue
		}
		enabled, _ := division["enabled"].(bool)
		if !enabled {
			return fmt.Errorf("ระดับมือนี้ปิดรับสมัครอยู่")
		}
		formats, _ := division["formats"].([]any)
		format := "doubles"
		if len(formats) > 0 {
			format = stringValue(formats[0], format)
		}
		quotaKey := "quotaDoubles"
		if format == "singles" {
			quotaKey = "quotaSingles"
		}
		quota, _ := strconv.Atoi(fmt.Sprint(division[quotaKey]))
		playersPerTeam, _ := strconv.Atoi(fmt.Sprint(division["playersPerTeam"]))
		if playersPerTeam < 1 {
			if format == "singles" {
				playersPerTeam = 1
			} else {
				playersPerTeam = 2
			}
		}
		encoded, _ := json.Marshal(division)
		result, err := tx.ExecContext(ctx, `insert into tournament_divisions(id,tournament_id,admin_id,code,name_th,name_en,format,quota,players_per_team,sort_order,settings)
			values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
			on conflict(id) do update set code=excluded.code,name_th=excluded.name_th,name_en=excluded.name_en,format=excluded.format,quota=excluded.quota,players_per_team=excluded.players_per_team,sort_order=excluded.sort_order,settings=excluded.settings
			where tournament_divisions.tournament_id=excluded.tournament_id and tournament_divisions.admin_id=excluded.admin_id`,
			divisionID, tournamentID, adminID, stringValue(division["code"], divisionID), stringValue(division["nameTh"], divisionID), stringValue(division["nameEn"], ""), format, quota, playersPerTeam, index, encoded)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return fmt.Errorf("ระดับมือไม่ตรงกับรายการแข่งขัน")
		}
		return nil
	}
	return fmt.Errorf("ไม่พบระดับมือที่เลือก")
}

func tournamentDivisionQuota(settings map[string]any, divisionID, format string) (int, bool, error) {
	divisions, _ := settings["divisions"].([]any)
	for _, raw := range divisions {
		division, _ := raw.(map[string]any)
		if stringValue(division["id"], "") != divisionID {
			continue
		}
		enabled, _ := division["enabled"].(bool)
		if !enabled {
			return 0, false, fmt.Errorf("ระดับมือนี้ปิดรับสมัครอยู่")
		}
		formatAllowed := false
		if formats, ok := division["formats"].([]any); ok {
			for _, value := range formats {
				if stringValue(value, "") == format {
					formatAllowed = true
					break
				}
			}
		}
		if !formatAllowed {
			return 0, false, fmt.Errorf("ประเภทการแข่งขันไม่ตรงกับระดับมือ")
		}
		quotaValue := division[map[bool]string{true: "quotaSingles", false: "quotaDoubles"}[format == "singles"]]
		if strings.EqualFold(strings.TrimSpace(fmt.Sprint(quotaValue)), "unlimited") {
			return 0, true, nil
		}
		quota, err := strconv.Atoi(fmt.Sprint(quotaValue))
		if err != nil || quota < 0 {
			return 0, false, fmt.Errorf("จำนวนที่รับสมัครของระดับมือไม่ถูกต้อง")
		}
		return quota, false, nil
	}
	return 0, false, fmt.Errorf("ไม่พบระดับมือที่เลือก")
}

func (a *app) tournamentRegistrationAvailability(ctx context.Context, adminID, tournamentID string, settings map[string]any) map[string]any {
	counts := map[string]int{}
	rows, err := a.db.QueryContext(ctx, `select division_id,format,count(*) from tournament_entries where admin_id=$1 and tournament_id=$2 and withdrawn_at is null and waiting_list=false group by division_id,format`, adminID, tournamentID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var divisionID, format string
			var count int
			if rows.Scan(&divisionID, &format, &count) == nil {
				counts[divisionID+"|"+format] = count
			}
		}
	}
	result := map[string]any{}
	if divisions, ok := settings["divisions"].([]any); ok {
		for _, raw := range divisions {
			division, _ := raw.(map[string]any)
			divisionID := stringValue(division["id"], "")
			enabled, _ := division["enabled"].(bool)
			if divisionID == "" || !enabled {
				continue
			}
			formats, _ := division["formats"].([]any)
			for _, rawFormat := range formats {
				format := stringValue(rawFormat, "")
				quota, unlimited, quotaErr := tournamentDivisionQuota(settings, divisionID, format)
				if quotaErr != nil {
					continue
				}
				registered := counts[divisionID+"|"+format]
				remaining := max(0, quota-registered)
				if unlimited {
					remaining = -1
				}
				result[divisionID+"|"+format] = map[string]any{"quota": quota, "registered": registered, "remaining": remaining, "unlimited": unlimited, "full": !unlimited && remaining == 0}
			}
		}
	}
	return result
}

type tournamentRegistrationError struct {
	Status  int
	Code    string
	Message string
}

func validatePublicTournamentRegistration(settings, entry map[string]any, now time.Time) (bool, *tournamentRegistrationError) {
	fail := func(status int, code, message string) (bool, *tournamentRegistrationError) {
		return false, &tournamentRegistrationError{Status: status, Code: code, Message: message}
	}
	registration, _ := settings["registrationConfig"].(map[string]any)
	isOpen, _ := registration["isOpen"].(bool)
	if !isOpen {
		return fail(409, "registration_closed", "ผู้จัดปิดรับสมัครออนไลน์")
	}
	status := stringValue(settings["status"], "")
	for _, closed := range []string{"ปิดรับสมัคร", "ยกเลิก", "แข่งขันเสร็จแล้ว", "Archived"} {
		if status == closed {
			return fail(409, "registration_closed", "สถานะรายการไม่เปิดรับสมัคร")
		}
	}
	location := time.FixedZone("Asia/Bangkok", 7*60*60)
	now = now.In(location)
	parseLocal := func(value string) (time.Time, bool) {
		value = strings.TrimSpace(strings.ReplaceAll(value, " ", "T"))
		for _, layout := range []string{"2006-01-02T15:04", time.RFC3339} {
			if parsed, err := time.ParseInLocation(layout, value, location); err == nil {
				return parsed, true
			}
		}
		return time.Time{}, false
	}
	if openAt, ok := parseLocal(stringValue(registration["openAt"], "")); ok && now.Before(openAt) {
		return fail(409, "registration_not_started", "ยังไม่ถึงกำหนดเปิดรับสมัคร")
	}
	if closeAt, ok := parseLocal(stringValue(registration["closeAt"], "")); ok && now.After(closeAt) {
		return fail(409, "registration_closed", "เลยกำหนดปิดรับสมัครแล้ว")
	}
	if endDate := stringValue(settings["endDate"], ""); endDate != "" {
		if eventEnd, err := time.ParseInLocation("2006-01-02 15:04:05", endDate+" 23:59:59", location); err == nil && now.After(eventEnd) {
			return fail(409, "event_ended", "พ้นวันจัดการแข่งขันแล้ว")
		}
	}
	pdpaConsent, _ := entry["pdpaConsent"].(bool)
	if !pdpaConsent {
		return fail(400, "pdpa_consent_required", "ต้องยอมรับความยินยอม PDPA ก่อนส่งใบสมัคร")
	}

	divisionID := stringValue(entry["divisionId"], "")
	format := stringValue(entry["format"], "doubles")
	foundDivision := false
	if divisions, ok := settings["divisions"].([]any); ok {
		for _, raw := range divisions {
			division, _ := raw.(map[string]any)
			if stringValue(division["id"], "") != divisionID {
				continue
			}
			enabled, _ := division["enabled"].(bool)
			if !enabled {
				return fail(409, "division_closed", "ระดับมือนี้ปิดรับสมัคร")
			}
			formats, _ := division["formats"].([]any)
			for _, item := range formats {
				if stringValue(item, "") == format {
					foundDivision = true
					break
				}
			}
			break
		}
	}
	if !foundDivision {
		return fail(400, "invalid_division", "ระดับมือหรือประเภทการแข่งขันไม่ถูกต้อง")
	}
	waitingListEnabled, _ := registration["enableWaitingList"].(bool)
	return waitingListEnabled, nil
}

func (a *app) patchTournamentPayload(ctx context.Context, table, id, adminID string, patch map[string]any) error {
	if table != "tournament_entries" && table != "tournament_officials" && table != "tournament_matches" {
		return fmt.Errorf("invalid table")
	}
	var raw []byte
	if err := a.db.QueryRowContext(ctx, fmt.Sprintf(`select payload from %s where id=$1 and admin_id=$2`, table), id, adminID).Scan(&raw); err != nil {
		return err
	}
	item := map[string]any{}
	_ = json.Unmarshal(raw, &item)
	for k, v := range patch {
		if k != "id" {
			item[k] = v
		}
	}
	next, _ := json.Marshal(item)
	_, err := a.db.ExecContext(ctx, fmt.Sprintf(`update %s set payload=$3,updated_at=now() where id=$1 and admin_id=$2`, table), id, adminID, next)
	return err
}

func (a *app) tournamentOfficialRoutes(w http.ResponseWriter, r *http.Request, path string) {
	p, ok := a.requireTournamentPrincipal(w, r, "assignUmpire")
	if !ok {
		return
	}
	parts := strings.Split(path, "/")
	if (path == "umpires" || path == "umpires/apply") && r.Method == http.MethodPost {
		var b map[string]any
		if json.NewDecoder(r.Body).Decode(&b) != nil {
			writeJSON(w, 400, map[string]string{"error": "invalid json"})
			return
		}
		pdpaConsent, _ := b["pdpaConsent"].(bool)
		if !pdpaConsent {
			writeJSON(w, 400, map[string]string{"error": "ต้องยอมรับความยินยอม PDPA ก่อนลงทะเบียนกรรมการ", "code": "pdpa_consent_required"})
			return
		}
		tid := stringValue(b["tournamentId"], "")
		id := "official-" + randHex(8)
		code := stringValue(b["code"], strings.ToUpper("DIR-"+randHex(3)))
		login := tournamentRandomDigits(12)
		b["id"], b["code"], b["loginCodeLast4"] = id, code, login[8:]
		approval := "approved"
		if path == "umpires/apply" {
			approval = "pending"
		}
		b["approvalStatus"] = approval
		b["active"] = approval == "approved"
		raw, _ := json.Marshal(b)
		_, err := a.db.ExecContext(r.Context(), `insert into tournament_officials(id,tournament_id,admin_id,code,first_name,last_name,nickname,phone,email,login_code_hash,login_code_last4,code_expires_at,approval_status,active,payload) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()+interval '90 days',$12,$13,$14)`, id, tid, p.AdminID, code, stringValue(b["firstName"], stringValue(b["name"], "กรรมการ")), stringValue(b["lastName"], ""), stringValue(b["nickname"], ""), stringValue(b["phone"], ""), stringValue(b["email"], ""), tournamentSecretDigest(login), login[8:], approval, approval == "approved", raw)
		if err != nil {
			writeJSON(w, 409, map[string]string{"error": err.Error()})
			return
		}
		b["loginCode"], b["loginCode12"] = login, login
		writeJSON(w, 201, b)
		return
	}
	if len(parts) >= 2 {
		if len(parts) == 3 && parts[2] == "review" && r.Method == http.MethodPost {
			var b map[string]any
			_ = json.NewDecoder(r.Body).Decode(&b)
			decision := stringValue(b["decision"], "pending")
			if decision == "approve" {
				decision = "approved"
			}
			if decision == "reject" {
				decision = "rejected"
			}
			var raw []byte
			if err := a.db.QueryRowContext(r.Context(), `select payload from tournament_officials where id=$1 and admin_id=$2`, parts[1], p.AdminID).Scan(&raw); err != nil {
				writeJSON(w, 404, map[string]string{"error": "not found"})
				return
			}
			item := map[string]any{}
			_ = json.Unmarshal(raw, &item)
			item["approvalStatus"] = decision
			item["approvalNote"] = stringValue(b["reason"], "")
			item["approvedBy"] = p.Name
			item["approvedAt"] = time.Now().In(time.FixedZone("Asia/Bangkok", 7*60*60)).Format(time.RFC3339)
			item["active"] = decision == "approved"
			next, _ := json.Marshal(item)
			res, err := a.db.ExecContext(r.Context(), `update tournament_officials set approval_status=$3,active=$4,payload=$5,updated_at=now() where id=$1 and admin_id=$2`, parts[1], p.AdminID, decision, decision == "approved", next)
			if err != nil {
				writeJSON(w, 500, map[string]string{"error": err.Error()})
				return
			}
			n, _ := res.RowsAffected()
			if n == 0 {
				writeJSON(w, 404, map[string]string{"error": "not found"})
				return
			}
			writeJSON(w, 200, map[string]string{"status": decision})
			return
		}
		if r.Method == http.MethodPatch {
			var patch map[string]any
			if json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&patch) != nil {
				writeJSON(w, 400, map[string]string{"error": "ข้อมูลไม่ถูกต้อง"})
				return
			}
			allowed := map[string]bool{
				"firstName": true, "lastName": true, "nickname": true, "phone": true, "email": true,
				"photoUrl": true, "certification": true, "clubAffiliation": true,
				"experienceNote": true, "address": true, "emergencyContact": true, "lineId": true,
				"pdpaConsent": true, "active": true,
			}
			cleanPatch := map[string]any{}
			changedFields := make([]string, 0, len(patch))
			for key, value := range patch {
				if allowed[key] {
					cleanPatch[key] = value
					changedFields = append(changedFields, key)
				}
			}
			if len(cleanPatch) == 0 {
				writeJSON(w, 400, map[string]string{"error": "ไม่มีข้อมูลที่แก้ไขได้"})
				return
			}
			var raw []byte
			var currentActive bool
			var tournamentID string
			if err := a.db.QueryRowContext(r.Context(), `select payload,active,tournament_id from tournament_officials where id=$1 and admin_id=$2`, parts[1], p.AdminID).Scan(&raw, &currentActive, &tournamentID); err != nil {
				writeJSON(w, 404, map[string]string{"error": "not found"})
				return
			}
			item := map[string]any{}
			_ = json.Unmarshal(raw, &item)
			for key, value := range cleanPatch {
				item[key] = value
			}
			if strings.TrimSpace(stringValue(item["firstName"], "")) == "" || strings.TrimSpace(stringValue(item["lastName"], "")) == "" || strings.TrimSpace(stringValue(item["phone"], "")) == "" {
				writeJSON(w, 400, map[string]string{"error": "กรุณากรอกชื่อ นามสกุล และเบอร์โทรให้ครบ"})
				return
			}
			active := currentActive
			if requested, exists := cleanPatch["active"].(bool); exists {
				active = requested
			}
			item["active"] = active
			next, _ := json.Marshal(item)
			res, err := a.db.ExecContext(r.Context(), `update tournament_officials set first_name=$3,last_name=$4,nickname=$5,phone=$6,email=$7,active=$8,payload=$9,updated_at=now() where id=$1 and admin_id=$2`,
				parts[1], p.AdminID, stringValue(item["firstName"], ""), stringValue(item["lastName"], ""), stringValue(item["nickname"], ""), stringValue(item["phone"], ""), normalizeEmail(stringValue(item["email"], "")), active, next)
			if err != nil {
				writeJSON(w, 500, map[string]string{"error": "บันทึกข้อมูลกรรมการไม่สำเร็จ"})
				return
			}
			n, _ := res.RowsAffected()
			if n == 0 {
				writeJSON(w, 404, map[string]string{"error": "not found"})
				return
			}
			if !active {
				_, _ = a.db.ExecContext(r.Context(), `update tournament_director_sessions set revoked_at=coalesce(revoked_at,now()) where official_id=$1`, parts[1])
			}
			a.tournamentAudit(r.Context(), p, tournamentID, "UPDATE_OFFICIAL", "official", parts[1], "", map[string]any{"fields": changedFields})
			writeJSON(w, 200, map[string]string{"status": "ok"})
			return
		}
		if len(parts) == 3 && parts[2] == "regenerate-code" && r.Method == http.MethodPost {
			login := tournamentRandomDigits(12)
			res, _ := a.db.ExecContext(r.Context(), `update tournament_officials set login_code_hash=$3,login_code_last4=$4,code_expires_at=now()+interval '90 days' where id=$1 and admin_id=$2`, parts[1], p.AdminID, tournamentSecretDigest(login), login[8:])
			n, _ := res.RowsAffected()
			if n == 0 {
				writeJSON(w, 404, map[string]string{"error": "not found"})
				return
			}
			_, _ = a.db.ExecContext(r.Context(), `update tournament_director_sessions set revoked_at=coalesce(revoked_at,now()) where official_id=$1`, parts[1])
			writeJSON(w, 200, map[string]string{"loginCode": login})
			return
		}
	}
	writeJSON(w, 404, map[string]string{"error": "not found"})
}

func (a *app) tournamentMatchRoutes(w http.ResponseWriter, r *http.Request, path string) {
	p, ok := a.requireTournamentPrincipal(w, r, "scoreMatch")
	if !ok {
		return
	}
	parts := strings.Split(path, "/")
	if len(parts) == 2 && r.Method == http.MethodPatch {
		var patch map[string]any
		_ = json.NewDecoder(r.Body).Decode(&patch)
		var beforeRaw []byte
		if err := a.db.QueryRowContext(r.Context(), `select payload from tournament_matches where id=$1 and admin_id=$2`, parts[1], p.AdminID).Scan(&beforeRaw); err != nil {
			writeJSON(w, 404, map[string]string{"error": "not found"})
			return
		}
		var before map[string]any
		_ = json.Unmarshal(beforeRaw, &before)
		if p.Role == "director" {
			if stringValue(before["umpireId"], "") != p.ActorID {
				writeJSON(w, 403, map[string]string{"error": "คู่นี้ไม่ได้มอบหมายให้กรรมการคนนี้", "code": "match_not_assigned"})
				return
			}
			for key := range patch {
				if key != "courtId" {
					writeJSON(w, 403, map[string]string{"error": "กรรมการแก้ไขได้เฉพาะสนามก่อนเริ่มแข่งขัน"})
					return
				}
			}
		}
		candidate := map[string]any{}
		for key, value := range before {
			candidate[key] = value
		}
		for key, value := range patch {
			candidate[key] = value
		}
		courtID, umpireID, scheduledTime := stringValue(candidate["courtId"], ""), stringValue(candidate["umpireId"], ""), stringValue(candidate["scheduledTime"], "")
		if courtID != "" && scheduledTime != "" {
			var conflict bool
			_ = a.db.QueryRowContext(r.Context(), `select exists(select 1 from tournament_matches where admin_id=$1 and id<>$2 and tournament_id=$3 and payload->>'courtId'=$4 and payload->>'scheduledTime'=$5 and status not in ('finished','walkover','retired','disqualified'))`, p.AdminID, parts[1], stringValue(candidate["tournamentId"], ""), courtID, scheduledTime).Scan(&conflict)
			if conflict {
				writeJSON(w, 409, map[string]string{"error": "สนามนี้มีคู่แข่งขันในเวลาเดียวกัน", "code": "court_schedule_conflict"})
				return
			}
		}
		if umpireID != "" && scheduledTime != "" {
			var conflict bool
			_ = a.db.QueryRowContext(r.Context(), `select exists(select 1 from tournament_matches where admin_id=$1 and id<>$2 and tournament_id=$3 and payload->>'umpireId'=$4 and payload->>'scheduledTime'=$5 and status not in ('finished','walkover','retired','disqualified'))`, p.AdminID, parts[1], stringValue(candidate["tournamentId"], ""), umpireID, scheduledTime).Scan(&conflict)
			if conflict {
				writeJSON(w, 409, map[string]string{"error": "กรรมการคนนี้มีคู่แข่งขันในเวลาเดียวกัน", "code": "umpire_schedule_conflict"})
				return
			}
		}
		if err := a.patchTournamentPayload(r.Context(), "tournament_matches", parts[1], p.AdminID, patch); err != nil {
			writeJSON(w, 404, map[string]string{"error": "not found"})
			return
		}
		var raw []byte
		var version int64
		_ = a.db.QueryRowContext(r.Context(), `select payload,version from tournament_matches where id=$1 and admin_id=$2`, parts[1], p.AdminID).Scan(&raw, &version)
		var match map[string]any
		_ = json.Unmarshal(raw, &match)
		match["id"], match["version"] = parts[1], version
		_, _ = a.db.ExecContext(r.Context(), `update tournament_matches set court_id=nullif($3,''),official_id=nullif($4,'') where id=$1 and admin_id=$2`, parts[1], p.AdminID, stringValue(match["courtId"], ""), stringValue(match["umpireId"], ""))
		tx, _ := a.db.BeginTx(r.Context(), nil)
		if tx != nil {
			_ = insertTournamentRealtimeEventTx(r.Context(), tx, p.AdminID, stringValue(match["tournamentId"], ""), parts[1], "match_update", map[string]any{"match": match})
			_ = tx.Commit()
		}
		writeJSON(w, 200, map[string]any{"match": match})
		return
	}
	if len(parts) >= 3 && (parts[2] == "quick-score" || parts[2] == "override") && r.Method == http.MethodPost {
		var patch map[string]any
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&patch) != nil {
			writeJSON(w, 400, map[string]string{"error": "ข้อมูลคะแนนไม่ถูกต้อง", "code": "invalid_score_payload"})
			return
		}
		if parts[2] == "override" && strings.TrimSpace(stringValue(patch["reason"], "")) == "" {
			writeJSON(w, 400, map[string]string{"error": "ต้องระบุเหตุผล"})
			return
		}
		tx, err := a.db.BeginTx(r.Context(), nil)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": "เริ่มบันทึกคะแนนไม่สำเร็จ"})
			return
		}
		defer tx.Rollback()
		var tournamentID string
		var raw []byte
		var version int64
		if err = tx.QueryRowContext(r.Context(), `select tournament_id,payload,version from tournament_matches where id=$1 and admin_id=$2 for update`, parts[1], p.AdminID).Scan(&tournamentID, &raw, &version); err != nil {
			writeJSON(w, 404, map[string]string{"error": "not found"})
			return
		}
		state := map[string]any{}
		_ = json.Unmarshal(raw, &state)
		if _, exists := state["scoringRules"]; !exists {
			var tournamentSettingsRaw []byte
			if tx.QueryRowContext(r.Context(), `select settings from tournaments where id=$1 and admin_id=$2`, tournamentID, p.AdminID).Scan(&tournamentSettingsRaw) == nil {
				tournamentSettings := map[string]any{}
				_ = json.Unmarshal(tournamentSettingsRaw, &tournamentSettings)
				state["scoringRules"] = tournamentSettings["scoringRules"]
			}
		}
		for key, value := range patch {
			if key != "id" && key != "version" && key != "winner" {
				state[key] = value
			}
		}
		if sets, ok := state["sets"].([]any); ok {
			for _, rawSet := range sets {
				set, _ := rawSet.(map[string]any)
				winner := tournamentSetWinner(intValueForTournament(set["scoreA"], 0), intValueForTournament(set["scoreB"], 0), state)
				if winner == "" {
					delete(set, "winner")
					delete(set, "completed")
				} else {
					set["winner"], set["completed"] = winner, true
				}
			}
		}
		status := stringValue(state["status"], "scheduled")
		if status == "finished" {
			outcome := tournamentMatchWinnerFromSets(state)
			if outcome == "" {
				writeJSON(w, 409, map[string]string{"error": "คะแนนยังไม่ครบตามกติกา", "code": "match_not_finished"})
				return
			}
			if outcome == "draw" && !tournamentMatchAllowsDraw(state) {
				writeJSON(w, 409, map[string]string{"error": "รอบแพ้คัดออกต้องมีผู้ชนะ กรุณาเพิ่มเซตตัดสิน", "code": "draw_not_allowed"})
				return
			}
			state["winner"], state["locked"] = outcome, true
			state["actualEnd"] = time.Now().In(time.FixedZone("Asia/Bangkok", 7*60*60)).Format(time.RFC3339)
		} else {
			delete(state, "winner")
		}
		next, _ := json.Marshal(state)
		_, err = tx.ExecContext(r.Context(), `update tournament_matches set payload=$3,status=$4,locked=$5,court_id=nullif($6,''),official_id=nullif($7,''),started_at=case when $4 in ('live','finished') then coalesce(started_at,now()) else started_at end,ended_at=case when $4='finished' then coalesce(ended_at,now()) else null end,version=version+1,updated_at=now() where id=$1 and admin_id=$2`, parts[1], p.AdminID, next, status, state["locked"] == true, stringValue(state["courtId"], ""), stringValue(state["umpireId"], ""))
		state["id"], state["version"] = parts[1], version+1
		if err == nil {
			err = insertTournamentRealtimeEventTx(r.Context(), tx, p.AdminID, tournamentID, parts[1], "match_update", map[string]any{"match": state})
		}
		if err != nil || tx.Commit() != nil {
			writeJSON(w, 500, map[string]string{"error": "บันทึกคะแนนไม่สำเร็จ"})
			return
		}
		action := "QUICK_SCORE"
		if parts[2] == "override" {
			action = "OVERRIDE_SCORE"
		}
		a.tournamentAudit(r.Context(), p, tournamentID, action, "match", parts[1], stringValue(patch["reason"], ""), map[string]any{"status": status, "winner": state["winner"]})
		writeJSON(w, 200, map[string]any{"match": state, "status": "ok"})
		return
	}
	if len(parts) < 3 || parts[2] != "event" || r.Method != http.MethodPost {
		writeJSON(w, 404, map[string]string{"error": "not found"})
		return
	}
	matchID := parts[1]
	var b struct {
		EventID, Type   string
		Payload         map[string]any
		ExpectedVersion int64 `json:"expectedVersion"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&b) != nil || b.EventID == "" {
		writeJSON(w, 400, map[string]string{"error": "event ไม่ถูกต้อง"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var tournamentID string
	var raw []byte
	var version int64
	if err = tx.QueryRowContext(r.Context(), `select tournament_id,payload,version from tournament_matches where id=$1 and admin_id=$2 for update`, matchID, p.AdminID).Scan(&tournamentID, &raw, &version); err != nil {
		writeJSON(w, 404, map[string]string{"error": "ไม่พบคู่แข่งขัน"})
		return
	}
	var state map[string]any
	_ = json.Unmarshal(raw, &state)
	if _, exists := state["scoringRules"]; !exists {
		var tournamentSettingsRaw []byte
		if tx.QueryRowContext(r.Context(), `select settings from tournaments where id=$1 and admin_id=$2`, tournamentID, p.AdminID).Scan(&tournamentSettingsRaw) == nil {
			tournamentSettings := map[string]any{}
			_ = json.Unmarshal(tournamentSettingsRaw, &tournamentSettings)
			state["scoringRules"] = tournamentSettings["scoringRules"]
		}
	}
	if p.Role == "director" && stringValue(state["umpireId"], "") != p.ActorID {
		writeJSON(w, 403, map[string]string{"error": "คู่นี้ไม่ได้มอบหมายให้กรรมการคนนี้", "code": "match_not_assigned"})
		return
	}
	if b.ExpectedVersion > 0 && b.ExpectedVersion != version {
		state["id"], state["version"] = matchID, version
		writeJSON(w, 409, map[string]any{"error": "ข้อมูลคะแนนเปลี่ยนแปลงจากอุปกรณ์อื่น", "code": "version_conflict", "match": state})
		return
	}
	allowedEvents := map[string]bool{
		"start_match": true, "point_A": true, "point_B": true, "point": true, "undo": true,
		"end_set": true, "end_match": true, "interval": true, "timeout_A": true, "timeout_B": true,
		"medical_timeout": true, "card": true, "suspend": true, "resume": true, "change_ends": true,
		"correction_serve": true, "shuttle_add": true, "shuttle_remove": true,
	}
	if !allowedEvents[b.Type] {
		writeJSON(w, 400, map[string]string{"error": "ประเภทเหตุการณ์คะแนนไม่ถูกต้อง", "code": "invalid_score_event"})
		return
	}
	if locked, _ := state["locked"].(bool); locked && b.Type != "undo" {
		writeJSON(w, 409, map[string]string{"error": "ผลการแข่งขันถูกล็อกแล้ว", "code": "match_locked"})
		return
	}
	if b.Type == "correction_serve" && strings.TrimSpace(stringValue(b.Payload["reason"], "")) == "" {
		writeJSON(w, 400, map[string]string{"error": "Correction ต้องระบุเหตุผล", "code": "correction_reason_required"})
		return
	}
	if b.Type == "end_set" {
		sets, _ := state["sets"].([]any)
		if len(sets) == 0 {
			writeJSON(w, 409, map[string]string{"error": "ยังไม่มีคะแนนในเซต", "code": "set_not_finished"})
			return
		}
		current := max(1, min(len(sets), intValueForTournament(state["currentSet"], len(sets))))
		set, _ := sets[current-1].(map[string]any)
		if tournamentSetWinner(intValueForTournament(set["scoreA"], 0), intValueForTournament(set["scoreB"], 0), state) == "" {
			writeJSON(w, 409, map[string]string{"error": "คะแนนยังไม่ครบตามกติกา ไม่สามารถจบเซตได้", "code": "set_not_finished"})
			return
		}
	}
	if b.Type == "end_match" {
		status := stringValue(b.Payload["status"], "finished")
		if status == "finished" {
			winner := tournamentMatchWinnerFromSets(state)
			if winner == "" {
				writeJSON(w, 409, map[string]string{"error": "ยังไม่มีทีมชนะครบตามจำนวนเซต", "code": "match_not_finished"})
				return
			}
			if winner == "draw" && !tournamentMatchAllowsDraw(state) {
				writeJSON(w, 409, map[string]string{"error": "รอบแพ้คัดออกต้องมีผู้ชนะ กรุณาแข่งขันเซตตัดสิน", "code": "draw_not_allowed"})
				return
			}
			requested := strings.ToLower(stringValue(b.Payload["winner"], winner))
			if requested == "a" || requested == "b" {
				requested = strings.ToUpper(requested)
			}
			if requested != winner {
				writeJSON(w, 409, map[string]string{"error": "ผู้ชนะไม่ตรงกับผลคะแนนที่บันทึก", "code": "winner_mismatch"})
				return
			}
			b.Payload["winner"] = winner
		} else if strings.TrimSpace(stringValue(b.Payload["reason"], stringValue(b.Payload["note"], ""))) == "" {
			writeJSON(w, 400, map[string]string{"error": "การจบแมตช์แบบพิเศษต้องระบุเหตุผล", "code": "end_reason_required"})
			return
		}
	}
	payload, _ := json.Marshal(b.Payload)
	inserted, err := tx.ExecContext(r.Context(), `insert into tournament_match_events(match_id,tournament_id,admin_id,event_id,event_type,payload,actor_type,actor_id) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(match_id,event_id) do nothing`, matchID, tournamentID, p.AdminID, b.EventID, b.Type, payload, p.Role, p.ActorID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	rows, _ := inserted.RowsAffected()
	if rows == 0 {
		_ = tx.Commit()
		var current map[string]any
		_ = json.Unmarshal(raw, &current)
		current["id"] = matchID
		current["version"] = version
		writeJSON(w, 200, map[string]any{"match": current, "replayed": true})
		return
	}
	applyTournamentScoreEvent(state, b.Type, b.Payload, p.Name)
	next, _ := json.Marshal(state)
	_, err = tx.ExecContext(r.Context(), `update tournament_matches set payload=$2,status=$3,locked=$4,started_at=case when $3='live' then coalesce(started_at,now()) else started_at end,ended_at=case when $3 in ('finished','walkover','retired','disqualified') then coalesce(ended_at,now()) else ended_at end,version=version+1,updated_at=now() where id=$1`, matchID, next, stringValue(state["status"], "scheduled"), state["locked"] == true)
	if err == nil && b.Type == "end_match" {
		err = advanceTournamentMatchTx(r.Context(), tx, p.AdminID, tournamentID, state)
	}
	state["id"], state["version"] = matchID, version+1
	if err == nil {
		err = insertTournamentRealtimeEventTx(r.Context(), tx, p.AdminID, tournamentID, matchID, "match_update", map[string]any{"match": state})
	}
	if err != nil || tx.Commit() != nil {
		writeJSON(w, 500, map[string]string{"error": "บันทึกคะแนนไม่สำเร็จ"})
		return
	}
	writeJSON(w, 200, map[string]any{"match": state})
}

func (a *app) tournamentDrawPublish(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireTournamentPrincipal(w, r, "drawBracket")
	if !ok {
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]string{"error": "method not allowed"})
		return
	}
	var b map[string]any
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid json"})
		return
	}
	tid := stringValue(b["tournamentId"], "")
	division := stringValue(b["divisionId"], "")
	seed := stringValue(b["seed"], randHex(12))
	raw, _ := json.Marshal(b)
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var started bool
	_ = tx.QueryRowContext(r.Context(), `select exists(select 1 from tournament_matches where tournament_id=$1 and admin_id=$2 and status in ('live','finished'))`, tid, p.AdminID).Scan(&started)
	if started {
		writeJSON(w, 409, map[string]string{"error": "มีการแข่งขันเริ่มแล้ว ไม่สามารถ publish สายใหม่", "code": "match_already_started"})
		return
	}
	var version int
	_ = tx.QueryRowContext(r.Context(), `select coalesce(max(version),0)+1 from tournament_draw_revisions where tournament_id=$1 and admin_id=$2 and coalesce(division_id,'')=$3`, tid, p.AdminID, division).Scan(&version)
	_, err = tx.ExecContext(r.Context(), `insert into tournament_draw_revisions(tournament_id,admin_id,division_id,version,random_seed,snapshot,locked,created_by) values($1,$2,nullif($3,''),$4,$5,$6,$7,$8)`, tid, p.AdminID, division, version, seed, raw, b["locked"] == true, p.ActorID)
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": err.Error()})
		return
	}
	if matches, yes := b["matches"].([]any); yes {
		for _, v := range matches {
			m, _ := v.(map[string]any)
			id := stringValue(m["id"], "match-"+randHex(8))
			code := stringValue(m["matchCode"], stringValue(m["code"], id))
			payload, _ := json.Marshal(m)
			_, err = tx.ExecContext(r.Context(), `insert into tournament_matches(id,tournament_id,admin_id,division_id,match_code,stage,status,payload) values($1,$2,$3,nullif($4,''),$5,$6,$7,$8) on conflict(id) do update set payload=excluded.payload,version=tournament_matches.version+1,updated_at=now()`, id, tid, p.AdminID, division, code, stringValue(m["stage"], "knockout"), stringValue(m["status"], "scheduled"), payload)
			if err != nil {
				writeJSON(w, 409, map[string]string{"error": err.Error()})
				return
			}
		}
	}
	if err = insertTournamentRealtimeEventTx(r.Context(), tx, p.AdminID, tid, "", "draw_published", map[string]any{"tournamentId": tid, "divisionId": division, "version": version}); err != nil {
		writeJSON(w, 500, map[string]string{"error": "ส่งสถานะสายการแข่งขันไม่สำเร็จ"})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	a.tournamentAudit(r.Context(), p, tid, "PUBLISH_DRAW", "draw", division, "", map[string]any{"version": version, "seed": seed})
	writeJSON(w, 201, map[string]any{"version": version, "seed": seed, "status": "published"})
}

func (a *app) tournamentEvents(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireTournamentPrincipal(w, r, "")
	if !ok {
		return
	}
	sub := &tournamentRealtimeSubscription{
		adminID: p.AdminID, tournamentID: strings.TrimSpace(r.URL.Query().Get("tournamentId")),
		channel: make(chan tournamentRealtimeEvent, 128),
	}
	if p.Role == "director" {
		sub.directorID = p.ActorID
	}
	a.serveTournamentRealtime(w, r, sub)
}

func (a *app) tournamentBackup(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireTournamentPrincipal(w, r, "")
	if !ok {
		return
	}
	if p.Role != "owner" {
		writeJSON(w, 403, map[string]string{"error": "เฉพาะ Owner"})
		return
	}
	state := map[string]any{}
	items, _ := a.tournamentSummaries(r.Context(), p.AdminID)
	state["tournaments"] = items
	state["entries"], _ = a.tournamentPayloadRows(r.Context(), `select id,payload from tournament_entries where admin_id=$1 order by created_at`, p.AdminID)
	state["officials"], _ = a.tournamentPayloadRows(r.Context(), `select id,payload from tournament_officials where admin_id=$1 order by created_at`, p.AdminID)
	state["matches"], _ = a.tournamentPayloadRows(r.Context(), `select id,payload from tournament_matches where admin_id=$1 order by created_at`, p.AdminID)
	state["drawRevisions"], _ = a.tournamentPayloadRows(r.Context(), `select id::text,snapshot from tournament_draw_revisions where admin_id=$1 order by created_at`, p.AdminID)
	state["payments"], _ = a.tournamentPayloadRows(r.Context(), `select id,jsonb_build_object('entryId',entry_id,'tournamentId',tournament_id,'amountSatang',amount_satang,'method',method,'status',status,'provider',provider,'referenceNumber',reference_number,'verification',verification) from tournament_payments where admin_id=$1 order by created_at`, p.AdminID)
	state["incidents"], _ = a.tournamentIncidentItems(r.Context(), p.AdminID)
	state["schemaVersion"] = "2026-11-23"
	state["createdAt"] = time.Now().UTC().Format(time.RFC3339)
	raw, _ := json.Marshal(state)
	state["checksum"] = fmt.Sprintf("%x", sha256.Sum256(raw))
	a.tournamentAudit(r.Context(), p, "", "EXPORT_BACKUP", "backup", "", "", nil)
	writeJSON(w, 200, state)
}

func (a *app) tournamentReports(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireTournamentPrincipal(w, r, "exportReport")
	if !ok {
		return
	}
	tid := r.URL.Query().Get("tournamentId")
	var registrations, matches, officials, incidents int
	var due, paid int64
	_ = a.db.QueryRowContext(r.Context(), `select count(*),coalesce(sum(amount_due_satang),0),coalesce(sum(amount_paid_satang),0) from tournament_entries where admin_id=$1 and ($2='' or tournament_id=$2) and withdrawn_at is null`, p.AdminID, tid).Scan(&registrations, &due, &paid)
	_ = a.db.QueryRowContext(r.Context(), `select count(*) from tournament_matches where admin_id=$1 and ($2='' or tournament_id=$2)`, p.AdminID, tid).Scan(&matches)
	_ = a.db.QueryRowContext(r.Context(), `select count(*) from tournament_officials where admin_id=$1 and ($2='' or tournament_id=$2)`, p.AdminID, tid).Scan(&officials)
	_ = a.db.QueryRowContext(r.Context(), `select count(*) from tournament_incidents where admin_id=$1 and ($2='' or tournament_id=$2)`, p.AdminID, tid).Scan(&incidents)
	writeJSON(w, 200, map[string]any{"registrations": map[string]any{"count": registrations}, "finance": map[string]any{"dueSatang": due, "paidSatang": paid}, "results": map[string]any{"matches": matches}, "courtsSchedule": map[string]any{"matches": matches}, "officialsIncidents": map[string]any{"officials": officials, "incidents": incidents}})
}

func applyTournamentScoreEvent(m map[string]any, event string, payload map[string]any, actor string) {
	intOf := func(v any, fallback int) int {
		n, err := strconv.Atoi(fmt.Sprint(v))
		if err != nil {
			return fallback
		}
		return n
	}
	sets, _ := m["sets"].([]any)
	if len(sets) == 0 {
		sets = []any{map[string]any{"setNumber": 1, "scoreA": 0, "scoreB": 0}}
	}
	currentSet := intOf(m["currentSet"], len(sets))
	if currentSet < 1 || currentSet > len(sets) {
		currentSet = len(sets)
	}
	set, _ := sets[currentSet-1].(map[string]any)
	if set == nil {
		set = map[string]any{"setNumber": currentSet, "scoreA": 0, "scoreB": 0}
		sets[currentSet-1] = set
	}
	timeline, _ := m["timeline"].([]any)
	snapshot := map[string]any{
		"status": m["status"], "scoreA": intOf(set["scoreA"], 0), "scoreB": intOf(set["scoreB"], 0),
		"servingTeam": stringValue(m["servingTeam"], "A"), "servingPlayerIndex": intOf(m["servingPlayerIndex"], 0),
		"courtPositions": m["courtPositions"], "endsSwapped": m["endsSwapped"],
	}
	appendTimeline := func(kind, detail string) {
		item := map[string]any{
			"id": "srv-" + randHex(8), "timestamp": time.Now().In(time.FixedZone("Asia/Bangkok", 7*60*60)).Format("15:04:05"),
			"setNumber": currentSet, "type": kind, "scoreSnapshot": fmt.Sprintf("%d - %d", intOf(set["scoreA"], 0), intOf(set["scoreB"], 0)),
			"actor": actor, "detail": detail, "undoSnapshot": snapshot,
		}
		timeline = append([]any{item}, timeline...)
	}

	if event == "start_match" {
		m["status"] = "live"
		serverTeam := strings.ToUpper(stringValue(payload["serverTeam"], stringValue(m["servingTeam"], "A")))
		if serverTeam != "B" {
			serverTeam = "A"
		}
		serverPlayer := intOf(payload["serverPlayerIndex"], intOf(m["servingPlayerIndex"], 0))
		if serverPlayer != 1 {
			serverPlayer = 0
		}
		positions := tournamentCourtPositions(m)
		positions[serverTeam] = [2]int{serverPlayer, 1 - serverPlayer}
		m["servingTeam"], m["servingPlayerIndex"] = serverTeam, serverPlayer
		m["courtPositions"] = map[string]any{"A": []any{positions["A"][0], positions["A"][1]}, "B": []any{positions["B"][0], positions["B"][1]}}
		if stringValue(m["actualStart"], "") == "" {
			m["actualStart"] = time.Now().In(time.FixedZone("Asia/Bangkok", 7*60*60)).Format(time.RFC3339)
		}
		appendTimeline(event, fmt.Sprintf("เริ่มการแข่งขัน ทีม %s ผู้เล่นคนที่ %d เป็นฝ่ายเสิร์ฟ", serverTeam, serverPlayer+1))
	}
	if event == "point_A" || event == "point_B" || event == "point" {
		team := strings.ToUpper(stringValue(payload["team"], "A"))
		if event == "point_A" {
			team = "A"
		} else if event == "point_B" {
			team = "B"
		}
		if team != "B" {
			team = "A"
		}
		previousServer := stringValue(m["servingTeam"], "A")
		key := "scoreA"
		playersKey := "teamAPlayers"
		if team == "B" {
			key, playersKey = "scoreB", "teamBPlayers"
		}
		set[key] = intOf(set[key], 0) + 1
		m["status"], m["servingTeam"] = "live", team
		positions := tournamentCourtPositions(m)
		players, _ := m[playersKey].([]any)
		if previousServer == team && len(players) > 1 {
			teamPositions := positions[team]
			teamPositions[0], teamPositions[1] = teamPositions[1], teamPositions[0]
			positions[team] = teamPositions
		}
		m["courtPositions"] = map[string]any{"A": []any{positions["A"][0], positions["A"][1]}, "B": []any{positions["B"][0], positions["B"][1]}}
		score := intOf(set[key], 0)
		if len(players) > 1 {
			m["servingPlayerIndex"] = positions[team][score%2]
		} else {
			m["servingPlayerIndex"] = 0
		}
		court := "ขวา"
		if score%2 == 1 {
			court = "ซ้าย"
		}
		appendTimeline(event, fmt.Sprintf("ทีม %s ได้คะแนนและเป็นฝ่ายเสิร์ฟจากคอร์ท%s", team, court))
	}
	if event == "undo" && len(timeline) > 0 {
		last, _ := timeline[0].(map[string]any)
		undo, _ := last["undoSnapshot"].(map[string]any)
		if undo != nil {
			set["scoreA"], set["scoreB"] = undo["scoreA"], undo["scoreB"]
			m["status"], m["servingTeam"], m["servingPlayerIndex"] = undo["status"], undo["servingTeam"], undo["servingPlayerIndex"]
			m["courtPositions"], m["endsSwapped"] = undo["courtPositions"], undo["endsSwapped"]
			timeline = timeline[1:]
		}
	}
	if event == "correction_serve" || event == "toggle_server" || event == "toggle_server_player" {
		team := strings.ToUpper(stringValue(payload["team"], stringValue(m["servingTeam"], "A")))
		if team != "B" {
			team = "A"
		}
		m["servingTeam"] = team
		m["servingPlayerIndex"] = intOf(payload["playerIndex"], (intOf(m["servingPlayerIndex"], 0)+1)%2)
		appendTimeline("serve_change", "แก้ไขผู้เสิร์ฟ: "+stringValue(payload["reason"], "กรรมการแก้ไขลำดับการเสิร์ฟ"))
	}
	if event == "change_ends" {
		current, _ := m["endsSwapped"].(bool)
		m["endsSwapped"] = !current
		appendTimeline(event, "สลับฝั่งสนาม")
	}
	if event == "interval" || strings.HasPrefix(event, "timeout") || event == "medical_timeout" || event == "card" {
		m["lastEvent"], m["lastEventPayload"] = event, payload
		appendTimeline(event, stringValue(payload["reason"], event))
	}
	if event == "shuttle_add" || event == "shuttle_remove" {
		count := intOf(m["shuttlesUsed"], 0)
		if event == "shuttle_add" {
			count++
		} else if count > 0 {
			count--
		}
		m["shuttlesUsed"] = count
		detail := fmt.Sprintf("เพิ่มลูกแบดที่ใช้ รวม %d ลูก", count)
		if event == "shuttle_remove" {
			detail = fmt.Sprintf("ลดลูกแบดที่ใช้ เหลือ %d ลูก", count)
		}
		appendTimeline(event, detail)
	}
	if event == "end_set" {
		winner := tournamentSetWinner(intOf(set["scoreA"], 0), intOf(set["scoreB"], 0), m)
		if winner != "" {
			set["winner"], set["completed"] = winner, true
			m["sets"] = sets
			outcome := tournamentMatchWinnerFromSets(m)
			if outcome == "" || (outcome == "draw" && !tournamentMatchAllowsDraw(m)) {
				sets = append(sets, map[string]any{"setNumber": len(sets) + 1, "scoreA": 0, "scoreB": 0})
				m["currentSet"], m["servingTeam"], m["servingPlayerIndex"] = len(sets), winner, 0
				m["courtPositions"], m["endsSwapped"] = map[string]any{"A": []any{0, 1}, "B": []any{0, 1}}, true
			} else {
				m["status"] = "awaiting_confirmation"
			}
			appendTimeline(event, "จบเซต ผู้ชนะทีม "+winner)
		}
	}
	if event == "suspend" {
		m["status"] = "suspended"
	}
	if event == "resume" {
		m["status"] = "live"
	}
	if event == "end_match" {
		m["status"], m["winner"], m["locked"] = stringValue(payload["status"], "finished"), stringValue(payload["winner"], ""), true
		m["actualEnd"] = time.Now().In(time.FixedZone("Asia/Bangkok", 7*60*60)).Format(time.RFC3339)
		m["umpireConfirmedAt"], m["umpireNote"] = m["actualEnd"], stringValue(payload["note"], "")
		appendTimeline(event, "ยืนยันผลการแข่งขัน")
	}
	m["sets"], m["timeline"], m["updatedBy"] = sets, timeline, actor
}

func tournamentCourtPositions(m map[string]any) map[string][2]int {
	result := map[string][2]int{"A": {0, 1}, "B": {0, 1}}
	raw, _ := m["courtPositions"].(map[string]any)
	for _, team := range []string{"A", "B"} {
		items, _ := raw[team].([]any)
		if len(items) == 2 {
			a, _ := strconv.Atoi(fmt.Sprint(items[0]))
			b, _ := strconv.Atoi(fmt.Sprint(items[1]))
			result[team] = [2]int{a, b}
		}
	}
	return result
}

func intValueForTournament(value any, fallback int) int {
	n, err := strconv.Atoi(fmt.Sprint(value))
	if err != nil {
		return fallback
	}
	return n
}

func tournamentSetWinner(scoreA, scoreB int, match map[string]any) string {
	target, capPoint, winByTwo := 21, 30, true
	if rules, ok := match["scoringRules"].(map[string]any); ok {
		if value, err := strconv.Atoi(fmt.Sprint(rules["pointsPerSet"])); err == nil && value > 0 {
			target = value
		}
		if value, err := strconv.Atoi(fmt.Sprint(rules["maxCapPoint"])); err == nil && value >= target {
			capPoint = value
		}
		if value, ok := rules["winByTwo"].(bool); ok {
			winByTwo = value
		}
	}
	if scoreA == scoreB {
		return ""
	}
	hi, lo, winner := scoreA, scoreB, "A"
	if scoreB > scoreA {
		hi, lo, winner = scoreB, scoreA, "B"
	}
	if hi >= capPoint || (hi >= target && (!winByTwo || hi-lo >= 2)) {
		return winner
	}
	return ""
}

func tournamentMatchWinnerFromSets(match map[string]any) string {
	bestOf := 3
	if rules, ok := match["scoringRules"].(map[string]any); ok {
		if value := intValueForTournament(rules["bestOfSets"], bestOf); value >= 1 && value <= 5 {
			bestOf = value
		}
	}
	wins := map[string]int{"A": 0, "B": 0}
	completed := 0
	sets, _ := match["sets"].([]any)
	for _, rawSet := range sets {
		set, _ := rawSet.(map[string]any)
		winner := strings.ToUpper(stringValue(set["winner"], ""))
		if winner == "A" || winner == "B" {
			wins[winner]++
			completed++
		}
	}
	if bestOf%2 == 1 {
		required := bestOf/2 + 1
		if wins["A"] >= required {
			return "A"
		}
		if wins["B"] >= required {
			return "B"
		}
		return ""
	}
	if completed < bestOf {
		return ""
	}
	if wins["A"] > wins["B"] {
		return "A"
	}
	if wins["B"] > wins["A"] {
		return "B"
	}
	return "draw"
}

func tournamentMatchAllowsDraw(match map[string]any) bool {
	return strings.EqualFold(stringValue(match["stage"], ""), "group")
}

func (a *app) handlePublicTournamentRoutes(w http.ResponseWriter, r *http.Request) {
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/public-tournament/"), "/")
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if token == "" {
		token = strings.TrimSpace(r.URL.Query().Get("tournament"))
	}
	var tid, adminID string
	var settings []byte
	err := a.db.QueryRowContext(r.Context(), `select id,admin_id,settings from tournaments where public_token_hash=$1 and archived_at is null`, tournamentSecretDigest(token)).Scan(&tid, &adminID, &settings)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "ไม่พบรายการแข่งขัน"})
		return
	}
	allTournamentSettings := map[string]any{}
	_ = json.Unmarshal(settings, &allTournamentSettings)
	publicTournament := scrubPublicTournamentSettings(allTournamentSettings)
	publicConfig, _ := publicTournament["publicViewConfig"].(map[string]any)
	publicEnabled, _ := publicConfig["enabled"].(bool)
	if path == "manifest.webmanifest" && r.Method == http.MethodGet {
		writePublicTournamentManifest(w, token, strings.TrimSpace(r.URL.Query().Get("app")))
		return
	}
	if path == "events" && r.Method == http.MethodGet {
		showLive, _ := publicConfig["showLiveScore"].(bool)
		if !publicEnabled || !showLive {
			writeJSON(w, 403, map[string]string{"error": "ผู้จัดปิดการแสดงคะแนนสด", "code": "public_live_disabled"})
			return
		}
		showUmpire, _ := publicConfig["showUmpireName"].(bool)
		a.serveTournamentRealtime(w, r, &tournamentRealtimeSubscription{adminID: adminID, tournamentID: tid, public: true, showUmpire: showUmpire, channel: make(chan tournamentRealtimeEvent, 128)})
		return
	}
	if (path == "state" || path == "bootstrap" || path == "") && r.Method == http.MethodGet {
		tournament := publicTournament
		if !publicEnabled {
			writeJSON(w, 403, map[string]string{"error": "ผู้จัดปิดหน้า Public View", "code": "public_view_disabled"})
			return
		}
		tournament["id"] = tid
		tournament["registrationAvailability"] = a.tournamentRegistrationAvailability(r.Context(), adminID, tid, allTournamentSettings)
		matches, _ := a.tournamentPayloadRows(r.Context(), `select id,payload||jsonb_build_object('version',version) from tournament_matches where admin_id=$1 and tournament_id='`+strings.ReplaceAll(tid, "'", "")+`' order by created_at`, adminID)
		showUmpire, _ := publicConfig["showUmpireName"].(bool)
		for _, m := range matches {
			delete(m, "phone")
			delete(m, "email")
			delete(m, "birthDate")
			delete(m, "health")
			delete(m, "slipImage")
			delete(m, "umpireId")
			delete(m, "version")
			if !showUmpire {
				delete(m, "umpireName")
				if timeline, ok := m["timeline"].([]any); ok {
					for _, raw := range timeline {
						if item, ok := raw.(map[string]any); ok {
							item["actor"] = "กรรมการ"
						}
					}
				}
			}
		}
		var cursor int64
		_ = a.db.QueryRowContext(r.Context(), `select coalesce(max(id),0) from tournament_realtime_events where admin_id=$1 and tournament_id=$2`, adminID, tid).Scan(&cursor)
		writeJSON(w, 200, map[string]any{"tournaments": []any{tournament}, "matches": matches, "teams": []any{}, "serverTime": time.Now().UTC().Format(time.RFC3339), "streamCursor": cursor})
		return
	}
	if path == "player-status" && r.Method == http.MethodGet {
		code := strings.TrimSpace(r.URL.Query().Get("code"))
		verify := strings.TrimSpace(r.URL.Query().Get("verification"))
		var id string
		var raw []byte
		var hash string
		err := a.db.QueryRowContext(r.Context(), `select id,payload,verification_code_hash from tournament_entries where tournament_id=$1 and registration_code=$2`, tid, code).Scan(&id, &raw, &hash)
		if err != nil || hash != tournamentSecretDigest(verify) {
			writeJSON(w, 404, map[string]string{"error": "ไม่พบข้อมูลหรือรหัสยืนยันไม่ถูกต้อง"})
			return
		}
		var player map[string]any
		_ = json.Unmarshal(raw, &player)
		for _, key := range []string{
			"phone", "email", "birthDate", "nationality", "idDocumentNo", "address", "emergencyContact", "health", "healthInfo",
			"partnerPhone", "partnerEmail", "partnerBirthDate", "partnerNationality", "partnerIdDocumentNo", "partnerAddress", "partnerEmergencyContact", "partnerHealthInfo",
			"slipImage", "slipImageUrl", "slipFileId", "verificationCode", "verificationCodeLast4",
		} {
			delete(player, key)
		}
		if rawMembers, ok := player["members"].([]any); ok {
			safeMembers := make([]any, 0, len(rawMembers))
			for _, rawMember := range rawMembers {
				member, _ := rawMember.(map[string]any)
				safeMembers = append(safeMembers, map[string]any{
					"role": member["role"], "firstName": member["firstName"], "lastName": member["lastName"], "nickname": member["nickname"], "photoUrl": member["photoUrl"],
				})
			}
			player["members"] = safeMembers
		}
		player["id"] = id
		playerTournament := publicTournament
		playerTournament["id"] = tid
		divisionID := stringValue(player["divisionId"], "")
		matchQuery := `select id,payload from tournament_matches where admin_id=$1 and tournament_id='` + strings.ReplaceAll(tid, "'", "") + `'`
		if divisionID != "" {
			matchQuery += ` and division_id='` + strings.ReplaceAll(divisionID, "'", "") + `'`
		}
		matches, _ := a.tournamentPayloadRows(r.Context(), matchQuery+` order by created_at`, adminID)
		teamMatches := make([]map[string]any, 0)
		for _, match := range matches {
			for _, key := range []string{"phone", "email", "birthDate", "health", "slipImage", "umpireId"} {
				delete(match, key)
			}
			if stringValue(match["teamAId"], "") == id || stringValue(match["teamBId"], "") == id {
				teamMatches = append(teamMatches, match)
			}
		}
		writeJSON(w, 200, map[string]any{"tournament": playerTournament, "player": player, "teamMatches": teamMatches, "divisionMatches": matches})
		return
	}
	if path == "player-status/upload-slip" && r.Method == http.MethodPost {
		var b map[string]any
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&b) != nil {
			writeJSON(w, 400, map[string]string{"error": "ข้อมูลอัปโหลดสลิปไม่ถูกต้อง"})
			return
		}
		code := strings.TrimSpace(stringValue(b["code"], ""))
		verify := strings.TrimSpace(stringValue(b["verification"], ""))
		fileID := strings.TrimSpace(stringValue(b["slipFileId"], ""))
		if code == "" || verify == "" || fileID == "" {
			writeJSON(w, 400, map[string]string{"error": "กรุณาระบุเลขที่สมัคร รหัสยืนยัน และไฟล์สลิป", "code": "payment_slip_required"})
			return
		}

		tx, err := a.db.BeginTx(r.Context(), nil)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": "เริ่มบันทึกสลิปไม่สำเร็จ"})
			return
		}
		defer tx.Rollback()
		var entryID, verificationHash string
		var raw []byte
		err = tx.QueryRowContext(r.Context(), `select id,payload,verification_code_hash from tournament_entries where admin_id=$1 and tournament_id=$2 and registration_code=$3 for update`, adminID, tid, code).Scan(&entryID, &raw, &verificationHash)
		if err != nil || verificationHash != tournamentSecretDigest(verify) {
			writeJSON(w, 404, map[string]string{"error": "ไม่พบข้อมูลหรือรหัสยืนยันไม่ถูกต้อง"})
			return
		}
		res, err := tx.ExecContext(r.Context(), `update tournament_files set staged=false,expires_at=null where id=$1 and admin_id=$2 and tournament_id=$3 and staged and kind='payment_slip'`, fileID, adminID, tid)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": "ผูกไฟล์สลิปไม่สำเร็จ"})
			return
		}
		if affected, _ := res.RowsAffected(); affected == 0 {
			writeJSON(w, 400, map[string]string{"error": "ไฟล์สลิปไม่ถูกต้องหรือหมดอายุ"})
			return
		}
		player := map[string]any{}
		_ = json.Unmarshal(raw, &player)
		player["slipFileId"] = fileID
		player["slipStatus"] = "pending"
		player["paymentStatus"] = "pending_verify"
		player["slipUploadedAt"] = time.Now().In(time.FixedZone("Asia/Bangkok", 7*60*60)).Format(time.RFC3339)
		for _, key := range []string{"slipTransferBank", "slipTransferAmount", "slipTransferRef"} {
			if value, exists := b[key]; exists {
				player[key] = value
			}
		}
		delete(player, "slipImageUrl")
		next, _ := json.Marshal(player)
		if _, err = tx.ExecContext(r.Context(), `update tournament_entries set payment_status='pending_verify',payload=$4,version=version+1,updated_at=now() where id=$1 and admin_id=$2 and tournament_id=$3`, entryID, adminID, tid, next); err != nil {
			writeJSON(w, 500, map[string]string{"error": "บันทึกสลิปไม่สำเร็จ"})
			return
		}
		if err = tx.Commit(); err != nil {
			writeJSON(w, 500, map[string]string{"error": "บันทึกสลิปไม่สำเร็จ"})
			return
		}
		publicPrincipal := tournamentPrincipal{AdminID: adminID, ActorID: "public:" + entryID, Name: "public player", Role: "public", TournamentID: tid, Permissions: map[string]bool{}}
		a.tournamentAudit(r.Context(), publicPrincipal, tid, "PUBLIC_REUPLOAD_PAYMENT_SLIP", "entry", entryID, "", map[string]any{"fileId": fileID})
		writeJSON(w, 200, map[string]any{"status": "pending_verify", "slipFileId": fileID})
		return
	}
	if path == "director-apply" && r.Method == http.MethodPost {
		a.createPublicTournamentOfficial(w, r, tid, adminID)
		return
	}
	if path == "register" && r.Method == http.MethodPost {
		p := tournamentPrincipal{AdminID: adminID, ActorID: "public", Name: "public", Role: "public", TournamentID: tid, Permissions: map[string]bool{}}
		a.createTournamentEntry(w, r, p, "public")
		return
	}
	if path == "files/stage" && r.Method == http.MethodPost {
		a.stageTournamentFile(w, r, adminID, tid)
		return
	}
	writeJSON(w, 404, map[string]string{"error": "not found"})
}

func scrubPublicTournamentSettings(settings map[string]any) map[string]any {
	// Keep this allow-list intentionally narrow. Tournament settings can also
	// contain payment credentials, notification gateways and internal policies.
	allowed := []string{
		"name", "description", "organizer", "contact", "venue", "startDate", "endDate",
		"startTime", "endTime", "timezone", "year", "status", "bannerUrl", "emblemUrl",
		"sponsors", "rulesText", "divisions", "drawSystem", "teamsPerGroup", "qualifiersPerGroup",
		"tieBreakOrder", "scoringRules", "courts", "publicViewConfig", "emergencyPaused", "emergencyReason",
	}
	result := make(map[string]any, len(allowed))
	for _, key := range allowed {
		if value, exists := settings[key]; exists {
			result[key] = value
		}
	}
	if registration, ok := settings["registrationConfig"].(map[string]any); ok {
		publicRegistration := map[string]any{}
		for _, key := range []string{"isOpen", "openAt", "closeAt", "pdpaConsentText", "enableWaitingList", "autoApprove"} {
			if value, exists := registration[key]; exists {
				publicRegistration[key] = value
			}
		}
		result["registrationConfig"] = publicRegistration
	}
	if payment, ok := settings["paymentConfig"].(map[string]any); ok {
		publicPayment := map[string]any{}
		for _, key := range []string{"feeEnabled", "promptPayId", "bankName", "bankAccountNo", "bankAccountName", "currency"} {
			if value, exists := payment[key]; exists {
				publicPayment[key] = value
			}
		}
		result["paymentConfig"] = publicPayment
	}
	if divisions, ok := result["divisions"].([]any); ok {
		enabledDivisions := make([]any, 0, len(divisions))
		for _, rawDivision := range divisions {
			division, _ := rawDivision.(map[string]any)
			enabled, _ := division["enabled"].(bool)
			if enabled {
				enabledDivisions = append(enabledDivisions, rawDivision)
			}
		}
		result["divisions"] = enabledDivisions
	}
	return result
}

func (a *app) createPublicTournamentOfficial(w http.ResponseWriter, r *http.Request, tournamentID, adminID string) {
	var b map[string]any
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "ข้อมูลใบสมัครไม่ถูกต้อง"})
		return
	}
	consent, _ := b["pdpaConsent"].(bool)
	if !consent {
		writeJSON(w, 400, map[string]string{"error": "ต้องยอมรับความยินยอม PDPA ก่อนส่งใบสมัคร", "code": "pdpa_consent_required"})
		return
	}
	firstName := stringValue(b["firstName"], "")
	lastName := stringValue(b["lastName"], "")
	phone := stringValue(b["phone"], "")
	if firstName == "" || lastName == "" || phone == "" {
		writeJSON(w, 400, map[string]string{"error": "กรุณากรอกชื่อ นามสกุล และเบอร์โทรให้ครบ"})
		return
	}
	id := "official-" + randHex(8)
	code := strings.ToUpper("DIR-" + randHex(3))
	login := tournamentRandomDigits(12)
	b["id"] = id
	b["tournamentId"] = tournamentID
	b["code"] = code
	b["loginCodeLast4"] = login[8:]
	b["applicationSource"] = "online"
	b["approvalStatus"] = "pending"
	b["active"] = false
	b["paymentRequired"] = false
	b["appliedAt"] = time.Now().In(time.FixedZone("Asia/Bangkok", 7*60*60)).Format(time.RFC3339)
	if _, exists := b["capableDivisions"]; !exists {
		b["capableDivisions"] = []any{}
	}
	b["assignedMatches"], b["completedMatches"], b["hoursWorked"] = 0, 0, 0
	b["history"] = []any{}
	raw, _ := json.Marshal(b)

	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(r.Context(), `insert into tournament_officials(id,tournament_id,admin_id,code,first_name,last_name,nickname,phone,email,login_code_hash,login_code_last4,code_expires_at,active,approval_status,payload) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()+interval '90 days',false,'pending',$12)`, id, tournamentID, adminID, code, firstName, lastName, stringValue(b["nickname"], ""), phone, normalizeEmail(stringValue(b["email"], "")), tournamentSecretDigest(login), login[8:], raw)
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": "ส่งใบสมัครกรรมการไม่สำเร็จ"})
		return
	}
	if fileID := stringValue(b["documentFileId"], ""); fileID != "" {
		res, fileErr := tx.ExecContext(r.Context(), `update tournament_files set staged=false,expires_at=null where id=$1 and admin_id=$2 and tournament_id=$3 and staged and kind='director_document'`, fileID, adminID, tournamentID)
		if fileErr != nil {
			writeJSON(w, 500, map[string]string{"error": "ผูกเอกสารกรรมการไม่สำเร็จ"})
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			writeJSON(w, 400, map[string]string{"error": "เอกสารแนบไม่ถูกต้องหรือหมดอายุ"})
			return
		}
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": "บันทึกใบสมัครกรรมการไม่สำเร็จ"})
		return
	}
	b["loginCode12"] = login
	writeJSON(w, 201, map[string]any{
		"id": id, "code": code, "loginCode": login, "approvalStatus": "pending",
		"message": "ได้รับรหัสเข้าสู่ระบบแล้ว กรุณารอผู้จัดอนุมัติก่อนเข้าสู่ระบบ",
	})
}

func tournamentFileStorageDir() string {
	if v := strings.TrimSpace(os.Getenv("TOURNAMENT_FILE_STORAGE_DIR")); v != "" {
		return v
	}
	return "/var/lib/livematch/tournament-files"
}

func (a *app) downloadTournamentFile(w http.ResponseWriter, r *http.Request, fileID string) {
	p, ok := a.requireTournamentPrincipal(w, r, "")
	if !ok {
		return
	}
	var storageKey, mime, kind string
	if err := a.db.QueryRowContext(r.Context(), `select storage_key,mime_type,kind from tournament_files where id=$1 and admin_id=$2 and not staged`, fileID, p.AdminID).Scan(&storageKey, &mime, &kind); err != nil {
		writeJSON(w, 404, map[string]string{"error": "ไม่พบเอกสาร"})
		return
	}
	requiredPermission := "assignUmpire"
	if kind == "payment_slip" {
		requiredPermission = "verifyPayment"
	}
	if !p.Permissions[requiredPermission] {
		writeJSON(w, 403, map[string]string{"error": "ไม่มีสิทธิ์ดูเอกสารนี้", "code": "permission_denied"})
		return
	}
	root, err := filepath.Abs(tournamentFileStorageDir())
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "storage unavailable"})
		return
	}
	target, err := filepath.Abs(filepath.Join(root, filepath.FromSlash(storageKey)))
	if err != nil || !strings.HasPrefix(target, root+string(os.PathSeparator)) {
		writeJSON(w, 400, map[string]string{"error": "invalid file path"})
		return
	}
	file, err := os.Open(target)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "ไม่พบไฟล์เอกสาร"})
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "อ่านไฟล์ไม่สำเร็จ"})
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Disposition", `inline; filename="`+fileID+filepath.Ext(target)+`"`)
	http.ServeContent(w, r, fileID+filepath.Ext(target), info.ModTime(), file)
}

func (a *app) stageTournamentFile(w http.ResponseWriter, r *http.Request, adminID, tournamentID string) {
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeJSON(w, 400, map[string]string{"error": "ไฟล์ใหญ่เกิน 8 MB"})
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "กรุณาแนบไฟล์"})
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, (8<<20)+1))
	if err != nil || len(raw) == 0 || len(raw) > 8<<20 {
		writeJSON(w, 400, map[string]string{"error": "ไฟล์ไม่ถูกต้องหรือใหญ่เกิน 8 MB"})
		return
	}
	mime := http.DetectContentType(raw)
	allowed := map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf"}
	ext, ok := allowed[mime]
	if !ok {
		writeJSON(w, 415, map[string]string{"error": "รองรับ JPEG, PNG, WebP และ PDF เท่านั้น"})
		return
	}
	id := "tfile-" + randHex(10)
	digest := sha256.Sum256(raw)
	key := filepath.ToSlash(filepath.Join(safeSlipSegment(adminID), safeSlipSegment(tournamentID), id+ext))
	root, err := filepath.Abs(tournamentFileStorageDir())
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "storage unavailable"})
		return
	}
	target, err := filepath.Abs(filepath.Join(root, filepath.FromSlash(key)))
	if err != nil || !strings.HasPrefix(target, root+string(os.PathSeparator)) {
		writeJSON(w, 400, map[string]string{"error": "invalid file path"})
		return
	}
	if err = os.MkdirAll(filepath.Dir(target), 0o750); err == nil {
		err = os.WriteFile(target, raw, 0o640)
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "บันทึกไฟล์ไม่สำเร็จ"})
		return
	}
	expires := time.Now().UTC().Add(24 * time.Hour)
	_, err = a.db.ExecContext(r.Context(), `insert into tournament_files(id,admin_id,tournament_id,kind,storage_key,mime_type,size_bytes,sha256,staged,expires_at) values($1,$2,nullif($3,''),$4,$5,$6,$7,$8,true,$9)`, id, adminID, tournamentID, stringValue(r.FormValue("kind"), "document"), key, mime, int64(len(raw)), fmt.Sprintf("%x", digest[:]), expires)
	if err != nil {
		_ = os.Remove(target)
		writeJSON(w, 500, map[string]string{"error": "บันทึกข้อมูลไฟล์ไม่สำเร็จ"})
		return
	}
	writeJSON(w, 201, map[string]any{"fileId": id, "mimeType": mime, "sizeBytes": len(raw), "sha256": fmt.Sprintf("%x", digest[:]), "expiresAt": expires.Format(time.RFC3339)})
}

var _ = errors.Is
var _ = sql.ErrNoRows
