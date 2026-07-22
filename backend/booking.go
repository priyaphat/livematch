package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/idtoken"
)

const publicCookieName = "livematch_public_session"

type requestRateBucket struct {
	count int
	reset time.Time
}

var requestRates = struct {
	sync.Mutex
	items map[string]requestRateBucket
}{items: make(map[string]requestRateBucket)}

func allowBookingRequest(r *http.Request, scope string, limit int, window time.Duration) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	key := scope + ":" + host
	now := time.Now()
	requestRates.Lock()
	defer requestRates.Unlock()
	bucket := requestRates.items[key]
	if bucket.reset.Before(now) {
		bucket = requestRateBucket{reset: now.Add(window)}
	}
	if bucket.count >= limit {
		return false
	}
	bucket.count++
	requestRates.items[key] = bucket
	return true
}

func requireBookingRate(w http.ResponseWriter, r *http.Request, scope string, limit int, window time.Duration) bool {
	if allowBookingRequest(r, scope, limit, window) {
		return true
	}
	w.Header().Set("Retry-After", strconv.Itoa(int(window.Seconds())))
	writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many requests"})
	return false
}

type adminFeatures struct {
	MemberEnabled  bool `json:"memberEnabled"`
	BookingEnabled bool `json:"bookingEnabled"`
}

func randUUID() string {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return fmt.Sprintf("00000000-0000-4000-8000-%012x", time.Now().UnixNano()&0xffffffffffff)
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", value[0:4], value[4:6], value[6:8], value[8:10], value[10:16])
}

type memberRecord struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Phone        string `json:"phone"`
	Email        string `json:"email"`
	MemberType   string `json:"memberType"`
	Active       bool   `json:"active"`
	Linked       bool   `json:"linked"`
	ProfileToken string `json:"profileToken,omitempty"`
	CreatedAt    string `json:"createdAt"`
}

type bookingSettingsRecord struct {
	AdminID               string `json:"-"`
	PublicToken           string `json:"publicToken"`
	OpenTime              string `json:"openTime"`
	CloseTime             string `json:"closeTime"`
	IntervalMinutes       int    `json:"intervalMinutes"`
	AllowOvernight        bool   `json:"allowOvernight"`
	UseSamePrice          bool   `json:"useSamePrice"`
	PromptPayType         string `json:"promptPayType"`
	PromptPayID           string `json:"promptPayId"`
	PromptPayReceiverName string `json:"promptPayReceiverName"`
	LogoData              string `json:"logoData,omitempty"`
	TelegramChatID        string `json:"telegramChatId"`
	TelegramConfigured    bool   `json:"telegramConfigured"`
	TelegramWebhookURL    string `json:"telegramWebhookUrl"`
}

func publicBookingDateAllowed(settings bookingSettingsRecord, start, end, now time.Time) bool {
	if settings.AllowOvernight {
		return true
	}
	today := now.In(bangkokLocation).Format("2006-01-02")
	return start.In(bangkokLocation).Format("2006-01-02") == today &&
		end.Add(-time.Nanosecond).In(bangkokLocation).Format("2006-01-02") == today
}

type bookingCourt struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Price  int    `json:"pricePerInterval"`
	Active bool   `json:"active"`
	Sort   int    `json:"sortOrder"`
}

type bookingRecord struct {
	ID            string `json:"id"`
	CourtID       string `json:"courtId"`
	CourtName     string `json:"courtName"`
	MemberID      string `json:"memberId,omitempty"`
	BookerName    string `json:"bookerName"`
	BookedBy      string `json:"bookedBy"`
	StartAt       string `json:"startAt"`
	EndAt         string `json:"endAt"`
	Interval      int    `json:"intervalMinutes"`
	UnitPrice     int    `json:"unitPriceThb"`
	TotalPrice    int    `json:"totalPriceThb"`
	Status        string `json:"status"`
	PaymentStatus string `json:"paymentStatus"`
	HoldExpiresAt string `json:"holdExpiresAt,omitempty"`
	Note          string `json:"note,omitempty"`
	SlipData      string `json:"slipData,omitempty"`
	CreatedAt     string `json:"createdAt"`
}

type publicBookingQueue struct {
	ID               string   `json:"id"`
	Status           string   `json:"status"`
	HoldExpiresAt    string   `json:"holdExpiresAt,omitempty"`
	TotalPriceTHB    int      `json:"totalPriceThb"`
	StartAt          string   `json:"startAt"`
	EndAt            string   `json:"endAt"`
	CourtNames       []string `json:"courtNames"`
	PromptPayPayload string   `json:"promptPayPayload,omitempty"`
}

func (a *app) features(ctx context.Context, adminID string) adminFeatures {
	var f adminFeatures
	_ = a.db.QueryRowContext(ctx, `select member_enabled, booking_enabled from admin_features where admin_id = $1`, adminID).Scan(&f.MemberEnabled, &f.BookingEnabled)
	return f
}

func (a *app) requireFeature(w http.ResponseWriter, r *http.Request, adminID, feature string) bool {
	f := a.features(r.Context(), adminID)
	enabled := f.MemberEnabled
	if feature == "booking" {
		enabled = f.BookingEnabled
	}
	if !enabled {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "feature is not enabled"})
	}
	return enabled
}

func (a *app) handleBackofficeAdminFeatures(w http.ResponseWriter, r *http.Request, actor string) {
	path := strings.TrimPrefix(r.URL.Path, "/api/backoffice/admins/")
	adminID := strings.TrimSuffix(path, "/features")
	var body adminFeatures
	if adminID == "" || json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid features"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), `insert into admin_features (admin_id, member_enabled, booking_enabled, updated_by) values ($1,$2,$3,$4) on conflict (admin_id) do update set member_enabled=excluded.member_enabled, booking_enabled=excluded.booking_enabled, updated_by=excluded.updated_by, updated_at=now()`, adminID, body.MemberEnabled, body.BookingEnabled, actor); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	_ = a.insertActivityLogTx(r.Context(), tx, "backoffice", actor, "update_admin_features", "admin_user", adminID, map[string]any{"memberEnabled": body.MemberEnabled, "bookingEnabled": body.BookingEnabled})
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	a.writeBackofficeAdminDetail(w, r, adminID)
}

func normalizePhone(raw string) (string, error) {
	digits := strings.NewReplacer(" ", "", "-", "", "(", "", ")", "").Replace(strings.TrimSpace(raw))
	if strings.HasPrefix(digits, "+66") {
		digits = "0" + strings.TrimPrefix(digits, "+66")
	}
	if strings.HasPrefix(digits, "66") && len(digits) >= 11 {
		digits = "0" + strings.TrimPrefix(digits, "66")
	}
	for _, c := range digits {
		if c < '0' || c > '9' {
			return "", errors.New("invalid phone")
		}
	}
	if len(digits) < 9 || len(digits) > 10 || digits[0] != '0' {
		return "", errors.New("invalid phone")
	}
	return "+66" + digits[1:], nil
}

func displayPhone(phone string) string {
	if strings.HasPrefix(phone, "+66") {
		return "0" + strings.TrimPrefix(phone, "+66")
	}
	return phone
}

func phoneSearchDigits(raw string) string {
	var digits strings.Builder
	for _, char := range raw {
		if char >= '0' && char <= '9' {
			digits.WriteRune(char)
		}
	}
	return digits.String()
}

func (a *app) listMembers(ctx context.Context, adminID, search string, page, pageSize int, activeOnly bool) ([]memberRecord, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	search = strings.TrimSpace(search)
	like := "%" + strings.ToLower(search) + "%"
	phoneSearch := phoneSearchDigits(search)
	phoneLike := "%" + phoneSearch + "%"
	var total int
	err := a.db.QueryRowContext(ctx, `select count(*) from members m where m.admin_id=$1 and m.deleted_at is null and (not $6 or m.active) and ($2='' or lower(m.name) like $3 or lower(coalesce(nullif(m.contact_email,''),(select email from public_users where id=m.public_user_id))) like $3 or ($4<>'' and (m.phone like $5 or replace(m.phone,'+66','0') like $5)))`, adminID, search, like, phoneSearch, phoneLike, activeOnly).Scan(&total)
	if err != nil {
		return nil, 0, err
	}
	rows, err := a.db.QueryContext(ctx, `select m.id,m.name,m.phone,coalesce(nullif(m.contact_email,''),u.email,''),m.member_type,m.active,m.public_user_id is not null,m.profile_token_hash,to_char(m.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from members m left join public_users u on u.id=m.public_user_id where m.admin_id=$1 and m.deleted_at is null and (not $6 or m.active) and ($2='' or lower(m.name) like $3 or lower(coalesce(nullif(m.contact_email,''),u.email,'')) like $3 or ($4<>'' and (m.phone like $5 or replace(m.phone,'+66','0') like $5))) order by m.created_at desc limit $7 offset $8`, adminID, search, like, phoneSearch, phoneLike, activeOnly, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := []memberRecord{}
	for rows.Next() {
		var m memberRecord
		var phone, tokenHash string
		if err = rows.Scan(&m.ID, &m.Name, &phone, &m.Email, &m.MemberType, &m.Active, &m.Linked, &tokenHash, &m.CreatedAt); err != nil {
			return nil, 0, err
		}
		m.Phone = displayPhone(phone)
		items = append(items, m)
	}
	return items, total, rows.Err()
}

func (a *app) createMember(ctx context.Context, adminID, name, phone, memberType, actorType, actorID string) (memberRecord, error) {
	name = strings.TrimSpace(name)
	normalized, err := normalizePhone(phone)
	if err != nil || name == "" {
		return memberRecord{}, errors.New("กรุณากรอกชื่อและเบอร์โทรให้ถูกต้อง")
	}
	if memberType != "club" {
		memberType = "general"
	}
	id, token := randUUID(), randHex(24)
	_, err = a.db.ExecContext(ctx, `insert into members (id,admin_id,name,phone,member_type,profile_token_hash,profile_token) values ($1,$2,$3,$4,$5,$6,$7)`, id, adminID, name, normalized, memberType, tokenDigest(token), token)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return memberRecord{}, errors.New("เบอร์โทรนี้มีอยู่แล้ว")
		}
		return memberRecord{}, err
	}
	a.insertActivityLog(ctx, actorType, actorID, "create_member", "member", id, map[string]any{"adminId": adminID, "name": name, "phone": maskPhone(normalized), "memberType": memberType})
	return memberRecord{ID: id, Name: name, Phone: displayPhone(normalized), MemberType: memberType, Active: true, ProfileToken: token}, nil
}

func maskPhone(phone string) string {
	if len(phone) < 6 {
		return "***"
	}
	return phone[:3] + "****" + phone[len(phone)-3:]
}

func (a *app) handleAdminMembers(w http.ResponseWriter, r *http.Request, user adminUser, action string) {
	path := strings.TrimPrefix(action, "members")
	features := a.features(r.Context(), user.ID)
	if !features.MemberEnabled && !(path == "/search" && features.BookingEnabled) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "feature disabled"})
		return
	}
	switch {
	case r.Method == http.MethodGet && (path == "" || path == "/"):
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		size, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
		items, total, err := a.listMembers(r.Context(), user.ID, r.URL.Query().Get("search"), page, size, false)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total, "page": max(1, page), "pageSize": max(1, size)})
	case r.Method == http.MethodGet && path == "/search":
		q := strings.TrimSpace(r.URL.Query().Get("phone"))
		if len(phoneSearchDigits(q)) <= 5 {
			writeJSON(w, 200, map[string]any{"items": []memberRecord{}})
			return
		}
		items, _, err := a.listMembers(r.Context(), user.ID, q, 1, 12, true)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"items": items})
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/"):
		a.writeAdminMemberDetail(w, r, user.ID, strings.TrimPrefix(path, "/"))
	case r.Method == http.MethodPost && (path == "" || path == "/"):
		var b struct{ Name, Phone, MemberType string }
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&b) != nil {
			writeJSON(w, 400, map[string]string{"error": "invalid member"})
			return
		}
		m, err := a.createMember(r.Context(), user.ID, b.Name, b.Phone, b.MemberType, "admin", user.ID)
		if err != nil {
			writeJSON(w, 409, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 201, m)
	case r.Method == http.MethodPatch && strings.HasPrefix(path, "/"):
		a.patchMember(w, r, user.ID, strings.TrimPrefix(path, "/"), "admin", user.ID, true)
	case r.Method == http.MethodDelete && strings.HasPrefix(path, "/"):
		a.deleteMember(w, r, user.ID, strings.TrimPrefix(path, "/"), user.ID)
	default:
		writeJSON(w, 404, map[string]string{"error": "not found"})
	}
}

func (a *app) writeAdminMemberDetail(w http.ResponseWriter, r *http.Request, adminID, memberID string) {
	var m memberRecord
	var phone string
	if err := a.db.QueryRowContext(r.Context(), `select m.id,m.name,m.phone,coalesce(nullif(m.contact_email,''),u.email,''),m.member_type,m.active,m.public_user_id is not null,to_char(m.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from members m left join public_users u on u.id=m.public_user_id where m.id=$1 and m.admin_id=$2 and m.deleted_at is null`, memberID, adminID).Scan(&m.ID, &m.Name, &phone, &m.Email, &m.MemberType, &m.Active, &m.Linked, &m.CreatedAt); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "member not found"})
		return
	}
	m.Phone = displayPhone(phone)

	bookings := []bookingRecord{}
	rows, _ := a.db.QueryContext(r.Context(), `select b.id,b.court_id,c.name,b.booker_name,b.booked_by,b.start_at,b.end_at,b.interval_minutes,b.unit_price_thb,b.total_price_thb,b.status,b.payment_status,b.hold_expires_at,b.note,to_char(b.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from bookings b join booking_courts c on c.id=b.court_id where b.member_id=$1 and b.admin_id=$2 order by b.start_at desc limit 100`, memberID, adminID)
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var b bookingRecord
			var start, end time.Time
			var holdExpiresAt sql.NullTime
			if rows.Scan(&b.ID, &b.CourtID, &b.CourtName, &b.BookerName, &b.BookedBy, &start, &end, &b.Interval, &b.UnitPrice, &b.TotalPrice, &b.Status, &b.PaymentStatus, &holdExpiresAt, &b.Note, &b.CreatedAt) == nil {
				b.StartAt = start.Format(time.RFC3339)
				b.EndAt = end.Format(time.RFC3339)
				if holdExpiresAt.Valid {
					b.HoldExpiresAt = holdExpiresAt.Time.Format(time.RFC3339)
				}
				bookings = append(bookings, b)
			}
		}
	}

	payments := []map[string]any{}
	paymentRows, _ := a.db.QueryContext(r.Context(), `select 'booking',p.booking_id,p.amount_thb,p.status,to_char(p.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from booking_payments p join bookings b on b.id=p.booking_id where p.member_id=$1 and b.admin_id=$2 union all select 'match',e.session_id,e.amount_thb,case when e.paid then 'paid' else 'unpaid' end,to_char(e.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from player_payment_events e join sessions s on s.id=e.session_id where e.member_id=$1 and s.admin_id=$2 order by 5 desc`, memberID, adminID)
	if paymentRows != nil {
		defer paymentRows.Close()
		for paymentRows.Next() {
			var kind, id, status, created string
			var amount int
			if paymentRows.Scan(&kind, &id, &amount, &status, &created) == nil {
				payments = append(payments, map[string]any{"kind": kind, "id": id, "amountThb": amount, "status": status, "createdAt": created})
			}
		}
	}

	matches := []map[string]any{}
	matchRows, _ := a.db.QueryContext(r.Context(), `select s.name,mt.id,mt.court,mt.started_at,mt.ended_at,mt.status,mt.winner,p.id from players p join sessions s on s.id=p.session_id join matches mt on mt.session_id=p.session_id and p.id in (mt.a1,mt.a2,mt.b1,mt.b2) where p.member_id=$1 and s.admin_id=$2 and mt.phase='history' order by s.updated_at desc,mt.id desc limit 100`, memberID, adminID)
	if matchRows != nil {
		defer matchRows.Close()
		for matchRows.Next() {
			var session, court, started, ended, status, winner string
			var matchID, playerID int
			if matchRows.Scan(&session, &matchID, &court, &started, &ended, &status, &winner, &playerID) == nil {
				matches = append(matches, map[string]any{"sessionName": session, "matchId": matchID, "court": court, "startedAt": started, "endedAt": ended, "status": status, "winner": winner, "playerId": playerID})
			}
		}
	}

	players := []map[string]any{}
	playerRows, _ := a.db.QueryContext(r.Context(), `select p.id,s.id,s.name,p.name,p.games,p.wins,p.draws,p.losses,p.paid,p.active from players p join sessions s on s.id=p.session_id where p.member_id=$1 and s.admin_id=$2 order by s.updated_at desc`, memberID, adminID)
	if playerRows != nil {
		defer playerRows.Close()
		for playerRows.Next() {
			var playerID, games, wins, draws, losses int
			var sessionID, sessionName, playerName string
			var paid, active bool
			if playerRows.Scan(&playerID, &sessionID, &sessionName, &playerName, &games, &wins, &draws, &losses, &paid, &active) == nil {
				players = append(players, map[string]any{"id": playerID, "sessionId": sessionID, "sessionName": sessionName, "name": playerName, "games": games, "wins": wins, "draws": draws, "losses": losses, "paid": paid, "active": active})
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"member": m, "bookings": bookings, "payments": payments, "matches": matches, "players": players})
}

func (a *app) patchMember(w http.ResponseWriter, r *http.Request, adminID, memberID, actorType, actorID string, admin bool) {
	var b struct {
		Name, Phone, MemberType string
		Active                  *bool
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid member"})
		return
	}
	var current memberRecord
	var oldPhone string
	if err := a.db.QueryRowContext(r.Context(), `select name,phone,member_type,active from members where id=$1 and admin_id=$2 and deleted_at is null`, memberID, adminID).Scan(&current.Name, &oldPhone, &current.MemberType, &current.Active); err != nil {
		writeJSON(w, 404, map[string]string{"error": "member not found"})
		return
	}
	name := strings.TrimSpace(b.Name)
	if name == "" {
		name = current.Name
	}
	phone := oldPhone
	var err error
	if strings.TrimSpace(b.Phone) != "" {
		phone, err = normalizePhone(b.Phone)
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": "invalid phone"})
			return
		}
	}
	memberType := current.MemberType
	active := current.Active
	if admin {
		if b.MemberType == "club" || b.MemberType == "general" {
			memberType = b.MemberType
		}
		if b.Active != nil {
			active = *b.Active
		}
	}
	if _, err = a.db.ExecContext(r.Context(), `update members set name=$3,phone=$4,member_type=$5,active=$6,updated_at=now() where id=$1 and admin_id=$2`, memberID, adminID, name, phone, memberType, active); err != nil {
		writeJSON(w, 409, map[string]string{"error": "เบอร์โทรนี้มีอยู่แล้ว"})
		return
	}
	a.insertActivityLog(r.Context(), actorType, actorID, "update_member", "member", memberID, map[string]any{"adminId": adminID, "name": name, "phone": maskPhone(phone), "memberType": memberType, "active": active})
	writeJSON(w, 200, map[string]any{"status": "ok"})
}

func (a *app) deleteMember(w http.ResponseWriter, r *http.Request, adminID, memberID, actor string) {
	var refs int
	_ = a.db.QueryRowContext(r.Context(), `select (select count(*) from players where member_id=$1)+(select count(*) from bookings where member_id=$1)+(select count(*) from booking_payments where member_id=$1)`, memberID).Scan(&refs)
	var res sql.Result
	var err error
	if refs > 0 {
		res, err = a.db.ExecContext(r.Context(), `update members set active=false,deleted_at=now(),updated_at=now() where id=$1 and admin_id=$2`, memberID, adminID)
	} else {
		res, err = a.db.ExecContext(r.Context(), `delete from members where id=$1 and admin_id=$2`, memberID, adminID)
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeJSON(w, 404, map[string]string{"error": "member not found"})
		return
	}
	a.insertActivityLog(r.Context(), "admin", actor, "delete_member", "member", memberID, map[string]any{"adminId": adminID, "softDelete": refs > 0})
	writeJSON(w, 200, map[string]any{"softDeleted": refs > 0})
}

func (a *app) ensureBookingSettings(ctx context.Context, adminID string) (bookingSettingsRecord, error) {
	var s bookingSettingsRecord
	var open, close string
	var tokenHash, botToken, webhookID, secretHash string
	err := a.db.QueryRowContext(ctx, `select public_token_hash,public_token,to_char(open_time,'HH24:MI'),to_char(close_time,'HH24:MI'),interval_minutes,allow_overnight,use_same_price,promptpay_type,promptpay_id,promptpay_receiver_name,logo_data,telegram_bot_token,telegram_chat_id,telegram_webhook_id,telegram_secret_hash from booking_settings where admin_id=$1`, adminID).Scan(&tokenHash, &s.PublicToken, &open, &close, &s.IntervalMinutes, &s.AllowOvernight, &s.UseSamePrice, &s.PromptPayType, &s.PromptPayID, &s.PromptPayReceiverName, &s.LogoData, &botToken, &s.TelegramChatID, &webhookID, &secretHash)
	if errors.Is(err, sql.ErrNoRows) {
		token := randHex(24)
		_, err = a.db.ExecContext(ctx, `insert into booking_settings (admin_id,public_token_hash,public_token) values ($1,$2,$3)`, adminID, tokenDigest(token), token)
		if err != nil {
			return s, err
		}
		return a.ensureBookingSettings(ctx, adminID)
	}
	if err != nil {
		return s, err
	}
	if s.PublicToken == "" {
		token := randHex(24)
		if _, err = a.db.ExecContext(ctx, `update booking_settings set public_token_hash=$2,public_token=$3,updated_at=now() where admin_id=$1`, adminID, tokenDigest(token), token); err != nil {
			return s, err
		}
		return a.ensureBookingSettings(ctx, adminID)
	}
	s.AdminID = adminID
	s.OpenTime = open
	s.CloseTime = close
	s.TelegramConfigured = botToken != "" && s.TelegramChatID != ""
	if webhookID != "" {
		s.TelegramWebhookURL = strings.TrimRight(os.Getenv("APP_BASE_URL"), "/") + "/api/booking-telegram/webhook/" + webhookID
	}
	return s, nil
}

func (a *app) bookingCourts(ctx context.Context, adminID string, activeOnly bool) ([]bookingCourt, error) {
	where := ""
	if activeOnly {
		where = "and active and deleted_at is null"
	}
	rows, err := a.db.QueryContext(ctx, `select id,name,price_per_interval,active,sort_order from booking_courts where admin_id=$1 `+where+` order by sort_order,id`, adminID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []bookingCourt{}
	for rows.Next() {
		var c bookingCourt
		if err = rows.Scan(&c.ID, &c.Name, &c.Price, &c.Active, &c.Sort); err != nil {
			return nil, err
		}
		items = append(items, c)
	}
	return items, rows.Err()
}

func (a *app) handleAdminBooking(w http.ResponseWriter, r *http.Request, user adminUser, action string) {
	if !a.requireFeature(w, r, user.ID, "booking") {
		return
	}
	path := strings.TrimPrefix(action, "booking")
	switch {
	case r.Method == http.MethodGet && (path == "" || path == "/overview"):
		a.writeBookingOverview(w, r, user.ID, true)
	case r.Method == http.MethodGet && path == "/history":
		a.writeBookingHistory(w, r, user.ID)
	case r.Method == http.MethodPut && path == "/settings":
		a.saveBookingSettings(w, r, user)
	case r.Method == http.MethodPost && path == "/courts":
		a.createBookingCourt(w, r, user)
	case (r.Method == http.MethodPatch || r.Method == http.MethodDelete) && strings.HasPrefix(path, "/courts/"):
		a.changeBookingCourt(w, r, user, strings.TrimPrefix(path, "/courts/"))
	case r.Method == http.MethodPost && path == "/bookings":
		a.createAdminBooking(w, r, user)
	case r.Method == http.MethodPost && path == "/closures":
		a.createClosure(w, r, user)
	case r.Method == http.MethodDelete && strings.HasPrefix(path, "/closures/"):
		a.deleteClosure(w, r, user, strings.TrimPrefix(path, "/closures/"))
	case r.Method == http.MethodPost && strings.HasPrefix(path, "/bookings/") && strings.HasSuffix(path, "/review"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/bookings/"), "/review")
		a.reviewBookingHTTP(w, r, user.ID, id, "admin", user.ID)
	default:
		writeJSON(w, 404, map[string]string{"error": "not found"})
	}
}

func (a *app) writeBookingHistory(w http.ResponseWriter, r *http.Request, adminID string) {
	startText := strings.TrimSpace(r.URL.Query().Get("startDate"))
	endText := strings.TrimSpace(r.URL.Query().Get("endDate"))
	today := time.Now().In(bangkokLocation).Format("2006-01-02")
	if startText == "" {
		startText = today
	}
	if endText == "" {
		endText = today
	}
	start, err := time.ParseInLocation("2006-01-02", startText, bangkokLocation)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid start date"})
		return
	}
	end, err := time.ParseInLocation("2006-01-02", endText, bangkokLocation)
	if err != nil || end.Before(start) || end.Sub(start) > 366*24*time.Hour {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid date range"})
		return
	}
	courtID := strings.TrimSpace(r.URL.Query().Get("courtId"))
	phone := phoneSearchDigits(r.URL.Query().Get("phone"))
	if strings.HasPrefix(phone, "0") {
		phone = strings.TrimPrefix(phone, "0")
	}
	rows, err := a.db.QueryContext(r.Context(), `
		select b.id,b.court_id,c.name,coalesce(b.member_id,''),b.booker_name,b.booked_by,
			b.start_at,b.end_at,b.interval_minutes,b.unit_price_thb,b.total_price_thb,
			b.status,b.payment_status,coalesce(to_char(b.hold_expires_at,'YYYY-MM-DD"T"HH24:MI:SSOF'),''),
			b.note,coalesce(m.phone,''),to_char(b.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI')
		from bookings b
		join booking_courts c on c.id=b.court_id and c.admin_id=b.admin_id
		left join members m on m.id=b.member_id and m.admin_id=b.admin_id
		where b.admin_id=$1 and b.start_at >= $2 and b.start_at < $3
			and ($4='' or b.court_id=$4)
			and ($5='' or regexp_replace(coalesce(m.phone,''),'[^0-9]','','g') like '%' || $5 || '%')
		order by b.start_at desc,b.created_at desc limit 500`, adminID, start, end.AddDate(0, 0, 1), courtID, phone)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var rec bookingRecord
		var startAt, endAt time.Time
		var phoneValue string
		if err = rows.Scan(&rec.ID, &rec.CourtID, &rec.CourtName, &rec.MemberID, &rec.BookerName, &rec.BookedBy, &startAt, &endAt, &rec.Interval, &rec.UnitPrice, &rec.TotalPrice, &rec.Status, &rec.PaymentStatus, &rec.HoldExpiresAt, &rec.Note, &phoneValue, &rec.CreatedAt); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		items = append(items, map[string]any{
			"id": rec.ID, "courtId": rec.CourtID, "courtName": rec.CourtName,
			"memberId": rec.MemberID, "bookerName": rec.BookerName, "bookedBy": rec.BookedBy,
			"phone": displayPhone(phoneValue), "startAt": startAt.Format(time.RFC3339), "endAt": endAt.Format(time.RFC3339),
			"intervalMinutes": rec.Interval, "unitPriceThb": rec.UnitPrice, "totalPriceThb": rec.TotalPrice,
			"status": rec.Status, "paymentStatus": rec.PaymentStatus, "note": rec.Note, "createdAt": rec.CreatedAt,
		})
	}
	if err = rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "startDate": startText, "endDate": endText})
}

func (a *app) saveBookingSettings(w http.ResponseWriter, r *http.Request, user adminUser) {
	current, err := a.ensureBookingSettings(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	var b struct {
		OpenTime, CloseTime                                                                           string
		IntervalMinutes                                                                               int
		AllowOvernight, UseSamePrice                                                                  bool
		PromptPayType, PromptPayID, PromptPayReceiverName, LogoData, TelegramBotToken, TelegramChatID string
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 3<<20)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid settings"})
		return
	}
	if _, err = time.Parse("15:04", b.OpenTime); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid open time"})
		return
	}
	if _, err = time.Parse("15:04", b.CloseTime); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid close time"})
		return
	}
	if !b.AllowOvernight && b.CloseTime <= b.OpenTime {
		writeJSON(w, 400, map[string]string{"error": "เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม หรือเปิดการจองข้ามวัน"})
		return
	}
	if b.IntervalMinutes <= 0 || b.IntervalMinutes%10 != 0 {
		writeJSON(w, 400, map[string]string{"error": "ช่วงเวลาต้องเพิ่มทีละ 10 นาที"})
		return
	}
	if len(b.LogoData) > 2_800_000 || !validImageData(b.LogoData, true) {
		writeJSON(w, 400, map[string]string{"error": "invalid logo"})
		return
	}
	botEncrypted := ""
	botFingerprint := ""
	webhookID := ""
	secretHash := ""
	plainSecret := ""
	if strings.TrimSpace(b.TelegramBotToken) != "" {
		if systemToken, _ := a.systemSetting(r.Context(), "telegramBotToken"); systemToken != "" && systemToken == strings.TrimSpace(b.TelegramBotToken) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "ห้ามใช้ Telegram bot เดียวกับ Backoffice"})
			return
		}
		botEncrypted, err = encryptSecret(b.TelegramBotToken)
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
		webhookID = randHex(12)
		plainSecret = randHex(20)
		secretHash = tokenDigest(plainSecret)
		botFingerprint = tokenDigest(strings.TrimSpace(b.TelegramBotToken))
	} else if current.TelegramConfigured {
		_ = a.db.QueryRowContext(r.Context(), `select telegram_bot_token,telegram_bot_fingerprint,telegram_webhook_id,telegram_secret_hash from booking_settings where admin_id=$1`, user.ID).Scan(&botEncrypted, &botFingerprint, &webhookID, &secretHash)
	}
	_, err = a.db.ExecContext(r.Context(), `update booking_settings set open_time=$2,close_time=$3,interval_minutes=$4,allow_overnight=$5,use_same_price=$6,promptpay_type=$7,promptpay_id=$8,promptpay_receiver_name=$9,logo_data=$10,telegram_bot_token=$11,telegram_chat_id=$12,telegram_webhook_id=$13,telegram_secret_hash=$14,telegram_bot_fingerprint=$15,updated_at=now() where admin_id=$1`, user.ID, b.OpenTime, b.CloseTime, b.IntervalMinutes, b.AllowOvernight, b.UseSamePrice, b.PromptPayType, strings.TrimSpace(b.PromptPayID), strings.TrimSpace(b.PromptPayReceiverName), b.LogoData, botEncrypted, strings.TrimSpace(b.TelegramChatID), webhookID, secretHash, botFingerprint)
	if err != nil {
		if strings.Contains(err.Error(), "idx_booking_settings_telegram_bot") {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "Telegram bot นี้ถูกใช้กับ admin อื่นแล้ว"})
			return
		}
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	if b.UseSamePrice {
		var price int
		_ = a.db.QueryRowContext(r.Context(), `select price_per_interval from booking_courts where admin_id=$1 and deleted_at is null order by sort_order limit 1`, user.ID).Scan(&price)
		if price >= 0 {
			_, _ = a.db.ExecContext(r.Context(), `update booking_courts set price_per_interval=$2,updated_at=now() where admin_id=$1 and deleted_at is null`, user.ID, price)
		}
	}
	a.insertActivityLog(r.Context(), "admin", user.ID, "update_booking_settings", "booking_settings", user.ID, map[string]any{"intervalMinutes": b.IntervalMinutes, "allowOvernight": b.AllowOvernight, "useSamePrice": b.UseSamePrice, "telegramConfigured": botEncrypted != ""})
	if plainSecret != "" {
		_ = a.setAdminTelegramWebhook(r.Context(), b.TelegramBotToken, webhookID, plainSecret)
	}
	a.writeBookingOverview(w, r, user.ID, true)
}

func validImageData(data string, allowEmpty bool) bool {
	if data == "" {
		return allowEmpty
	}
	comma := strings.IndexByte(data, ',')
	if comma < 0 {
		return false
	}
	mime := data[:comma]
	raw, err := base64.StdEncoding.DecodeString(data[comma+1:])
	if err != nil {
		return false
	}
	switch mime {
	case "data:image/png;base64":
		return len(raw) >= 8 && string(raw[:8]) == "\x89PNG\r\n\x1a\n"
	case "data:image/jpeg;base64":
		return len(raw) >= 3 && raw[0] == 0xff && raw[1] == 0xd8 && raw[2] == 0xff
	case "data:image/webp;base64":
		return len(raw) >= 12 && string(raw[:4]) == "RIFF" && string(raw[8:12]) == "WEBP"
	default:
		return false
	}
}

func (a *app) createBookingCourt(w http.ResponseWriter, r *http.Request, user adminUser) {
	var b struct {
		Name             string
		PricePerInterval int
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&b) != nil || strings.TrimSpace(b.Name) == "" || b.PricePerInterval < 0 {
		writeJSON(w, 400, map[string]string{"error": "invalid court"})
		return
	}
	s, _ := a.ensureBookingSettings(r.Context(), user.ID)
	if s.UseSamePrice {
		_ = a.db.QueryRowContext(r.Context(), `select price_per_interval from booking_courts where admin_id=$1 and deleted_at is null order by sort_order limit 1`, user.ID).Scan(&b.PricePerInterval)
	}
	id := randUUID()
	_, err := a.db.ExecContext(r.Context(), `insert into booking_courts (id,admin_id,name,price_per_interval,sort_order) values ($1,$2,$3,$4,(select count(*) from booking_courts where admin_id=$2))`, id, user.ID, strings.TrimSpace(b.Name), b.PricePerInterval)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	a.insertActivityLog(r.Context(), "admin", user.ID, "create_booking_court", "booking_court", id, map[string]any{"name": b.Name, "price": b.PricePerInterval})
	a.writeBookingOverview(w, r, user.ID, true)
}

func (a *app) changeBookingCourt(w http.ResponseWriter, r *http.Request, user adminUser, id string) {
	if r.Method == http.MethodDelete {
		_, err := a.db.ExecContext(r.Context(), `update booking_courts set active=false,deleted_at=now(),updated_at=now() where id=$1 and admin_id=$2`, id, user.ID)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
	} else {
		var b struct {
			Name             string
			PricePerInterval int
			Active           *bool
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&b) != nil {
			writeJSON(w, 400, map[string]string{"error": "invalid court"})
			return
		}
		var active bool
		_ = a.db.QueryRowContext(r.Context(), `select active from booking_courts where id=$1 and admin_id=$2`, id, user.ID).Scan(&active)
		if b.Active != nil {
			active = *b.Active
		}
		_, err := a.db.ExecContext(r.Context(), `update booking_courts set name=coalesce(nullif($3,''),name),price_per_interval=$4,active=$5,updated_at=now() where id=$1 and admin_id=$2`, id, user.ID, strings.TrimSpace(b.Name), max(0, b.PricePerInterval), active)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		s, _ := a.ensureBookingSettings(r.Context(), user.ID)
		if s.UseSamePrice {
			_, _ = a.db.ExecContext(r.Context(), `update booking_courts set price_per_interval=$2,updated_at=now() where admin_id=$1 and deleted_at is null`, user.ID, max(0, b.PricePerInterval))
		}
	}
	a.insertActivityLog(r.Context(), "admin", user.ID, "update_booking_court", "booking_court", id, map[string]any{})
	a.writeBookingOverview(w, r, user.ID, true)
}

func parseBookingTime(value string) (time.Time, error) {
	return time.ParseInLocation("2006-01-02T15:04", value, bangkokLocation)
}

type closureOccurrence struct {
	Start time.Time
	End   time.Time
}

func closureOccurrences(start, end time.Time, intervalMinutes int) ([]closureOccurrence, error) {
	if intervalMinutes <= 0 {
		return nil, errors.New("invalid interval")
	}
	start = start.In(bangkokLocation)
	end = end.In(bangkokLocation)
	startDay := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, bangkokLocation)
	endDay := time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, bangkokLocation)
	if endDay.Before(startDay) {
		return nil, errors.New("end date is before start date")
	}
	durationMinutes := (end.Hour()*60 + end.Minute()) - (start.Hour()*60 + start.Minute())
	if durationMinutes <= 0 || durationMinutes%intervalMinutes != 0 {
		return nil, errors.New("daily closure time must be positive and align with interval")
	}

	occurrences := make([]closureOccurrence, 0, 31)
	for day := startDay; !day.After(endDay); day = day.AddDate(0, 0, 1) {
		if len(occurrences) >= 366 {
			return nil, errors.New("date range is longer than 366 days")
		}
		occurrenceStart := time.Date(day.Year(), day.Month(), day.Day(), start.Hour(), start.Minute(), 0, 0, bangkokLocation)
		occurrenceEnd := time.Date(day.Year(), day.Month(), day.Day(), end.Hour(), end.Minute(), 0, 0, bangkokLocation)
		occurrences = append(occurrences, closureOccurrence{Start: occurrenceStart, End: occurrenceEnd})
	}
	return occurrences, nil
}

func (a *app) expireHolds(ctx context.Context, adminID string) {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return
	}
	defer tx.Rollback()
	if a.deleteExpiredHoldsTx(ctx, tx, adminID) == nil {
		_ = tx.Commit()
	}
}

func (a *app) runExpiredBookingHoldCleanup(ctx context.Context) {
	cleanup := func() {
		rows, err := a.db.QueryContext(ctx, `select distinct admin_id from bookings where status='hold' and hold_expires_at<=now()`)
		if err != nil {
			return
		}
		adminIDs := make([]string, 0)
		for rows.Next() {
			var adminID string
			if rows.Scan(&adminID) == nil {
				adminIDs = append(adminIDs, adminID)
			}
		}
		_ = rows.Close()
		for _, adminID := range adminIDs {
			a.expireHolds(ctx, adminID)
		}
	}
	cleanup()
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cleanup()
		}
	}
}

func (a *app) deleteExpiredHoldsTx(ctx context.Context, tx *sql.Tx, adminID string) error {
	rows, err := tx.QueryContext(ctx, `select id from bookings where admin_id=$1 and status='hold' and hold_expires_at<=now() for update`, adminID)
	if err != nil {
		return err
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err = rows.Close(); err != nil {
		return err
	}
	if err = rows.Err(); err != nil {
		return err
	}
	for _, id := range ids {
		if err = a.insertActivityLogTx(ctx, tx, "system", adminID, "delete_expired_booking_hold", "booking", id, map[string]any{"adminId": adminID, "reason": "payment_timeout"}); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `delete from bookings where admin_id=$1 and status='hold' and hold_expires_at<=now()`, adminID)
	return err
}

func (a *app) createBookingTx(ctx context.Context, adminID, courtID, memberID, bookedBy, bookerName string, start, end time.Time, status string) (bookingRecord, error) {
	s, err := a.ensureBookingSettings(ctx, adminID)
	if err != nil {
		return bookingRecord{}, err
	}
	if start.Before(time.Now().Add(-time.Minute)) {
		return bookingRecord{}, errors.New("ไม่สามารถจองเวลาที่ผ่านไปแล้ว")
	}
	duration := end.Sub(start)
	if duration <= 0 || int(duration.Minutes())%s.IntervalMinutes != 0 {
		return bookingRecord{}, errors.New("ช่วงเวลาไม่ถูกต้อง")
	}
	if !s.AllowOvernight && start.In(bangkokLocation).Format("2006-01-02") != end.Add(-time.Second).In(bangkokLocation).Format("2006-01-02") {
		return bookingRecord{}, errors.New("ยังไม่เปิดการจองข้ามวัน")
	}
	openParts := strings.Split(s.OpenTime, ":")
	closeParts := strings.Split(s.CloseTime, ":")
	openHour, _ := strconv.Atoi(openParts[0])
	openMinute, _ := strconv.Atoi(openParts[1])
	closeHour, _ := strconv.Atoi(closeParts[0])
	closeMinute, _ := strconv.Atoi(closeParts[1])
	localStart := start.In(bangkokLocation)
	anchor := time.Date(localStart.Year(), localStart.Month(), localStart.Day(), openHour, openMinute, 0, 0, bangkokLocation)
	closeAt := time.Date(localStart.Year(), localStart.Month(), localStart.Day(), closeHour, closeMinute, 0, 0, bangkokLocation)
	if s.AllowOvernight && !closeAt.After(anchor) {
		if localStart.Before(closeAt) {
			anchor = anchor.AddDate(0, 0, -1)
		}
		closeAt = anchor.Add(time.Duration((24*60-(openHour*60+openMinute))+(closeHour*60+closeMinute)) * time.Minute)
	}
	if start.Before(anchor) || end.After(closeAt) {
		return bookingRecord{}, errors.New("ช่วงจองอยู่นอกเวลาเปิดให้บริการ")
	}
	if int(start.Sub(anchor).Minutes())%s.IntervalMinutes != 0 {
		return bookingRecord{}, errors.New("เวลาเริ่มต้องตรงกับช่วงเวลาที่กำหนด")
	}
	var court bookingCourt
	if err = a.db.QueryRowContext(ctx, `select id,name,price_per_interval,active,sort_order from booking_courts where id=$1 and admin_id=$2 and active and deleted_at is null`, courtID, adminID).Scan(&court.ID, &court.Name, &court.Price, &court.Active, &court.Sort); err != nil {
		return bookingRecord{}, errors.New("ไม่พบสนาม")
	}
	slots := int(duration.Minutes()) / s.IntervalMinutes
	total := slots * court.Price
	id := randUUID()
	payment := "unpaid"
	var expires any = nil
	if status == "hold" {
		expires = time.Now().Add(5 * time.Minute)
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return bookingRecord{}, err
	}
	defer tx.Rollback()
	if err = a.deleteExpiredHoldsTx(ctx, tx, adminID); err != nil {
		return bookingRecord{}, err
	}
	_, err = tx.ExecContext(ctx, `insert into bookings (id,admin_id,court_id,member_id,booked_by,booker_name,start_at,end_at,interval_minutes,unit_price_thb,total_price_thb,status,payment_status,hold_expires_at) values ($1,$2,$3,nullif($4,''),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, id, adminID, courtID, memberID, bookedBy, bookerName, start, end, s.IntervalMinutes, court.Price, total, status, payment, expires)
	if err != nil {
		return bookingRecord{}, err
	}
	_, err = tx.ExecContext(ctx, `insert into booking_occupancies (admin_id,court_id,booking_id,kind,occupied_range) values ($1,$2,$3,'booking',tstzrange($4,$5,'[)'))`, adminID, courtID, id, start, end)
	if err != nil {
		if strings.Contains(err.Error(), "booking_occupancies_no_overlap") {
			return bookingRecord{}, errors.New("ช่วงเวลานี้ไม่ว่างแล้ว")
		}
		return bookingRecord{}, err
	}
	if err = tx.Commit(); err != nil {
		return bookingRecord{}, err
	}
	record := bookingRecord{ID: id, CourtID: court.ID, CourtName: court.Name, MemberID: memberID, BookerName: bookerName, BookedBy: bookedBy, StartAt: start.Format(time.RFC3339), EndAt: end.Format(time.RFC3339), Interval: s.IntervalMinutes, UnitPrice: court.Price, TotalPrice: total, Status: status, PaymentStatus: payment}
	if t, ok := expires.(time.Time); ok {
		record.HoldExpiresAt = t.Format(time.RFC3339)
	}
	return record, nil
}

func (a *app) createAdminBooking(w http.ResponseWriter, r *http.Request, user adminUser) {
	var b struct{ CourtID, MemberID, StartAt, EndAt string }
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid booking"})
		return
	}
	start, err := parseBookingTime(b.StartAt)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid start"})
		return
	}
	end, err := parseBookingTime(b.EndAt)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid end"})
		return
	}
	name := user.Name
	if b.MemberID != "" {
		if err = a.db.QueryRowContext(r.Context(), `select name from members where id=$1 and admin_id=$2 and active and deleted_at is null`, b.MemberID, user.ID).Scan(&name); err != nil {
			writeJSON(w, 400, map[string]string{"error": "member not found"})
			return
		}
	}
	rec, err := a.createBookingTx(r.Context(), user.ID, b.CourtID, b.MemberID, "admin", name, start, end, "confirmed")
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": err.Error()})
		return
	}
	a.insertActivityLog(r.Context(), "admin", user.ID, "create_admin_booking", "booking", rec.ID, map[string]any{"courtId": b.CourtID, "memberId": b.MemberID, "total": rec.TotalPrice})
	writeJSON(w, 201, rec)
}

func (a *app) createClosure(w http.ResponseWriter, r *http.Request, user adminUser) {
	var b struct{ CourtID, StartAt, EndAt, Note string }
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid closure"})
		return
	}
	start, err := parseBookingTime(b.StartAt)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid start"})
		return
	}
	end, err := parseBookingTime(b.EndAt)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid end"})
		return
	}
	settings, err := a.ensureBookingSettings(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "cannot load booking settings"})
		return
	}
	occurrences, err := closureOccurrences(start, end, settings.IntervalMinutes)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ช่วงเวลาปิดสนามไม่ถูกต้อง"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var courtExists bool
	if err = tx.QueryRowContext(r.Context(), `select exists(select 1 from booking_courts where id=$1 and admin_id=$2 and active and deleted_at is null)`, b.CourtID, user.ID).Scan(&courtExists); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !courtExists {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "court not found"})
		return
	}
	if err = a.deleteExpiredHoldsTx(r.Context(), tx, user.ID); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	for _, occurrence := range occurrences {
		_, err = tx.ExecContext(r.Context(), `insert into booking_occupancies (admin_id,court_id,kind,occupied_range,note) values ($1,$2,'closure',tstzrange($3,$4,'[)'),$5)`, user.ID, b.CourtID, occurrence.Start, occurrence.End, strings.TrimSpace(b.Note))
		if err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "มีรายการจองหรือปิดสนามทับซ้อนในช่วงวันที่เลือก"})
			return
		}
	}
	if err = a.insertActivityLogTx(r.Context(), tx, "admin", user.ID, "close_booking_slot", "booking_court", b.CourtID, map[string]any{"startAt": start, "endAt": end, "occurrences": len(occurrences)}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 201, map[string]any{"status": "closed", "occurrences": len(occurrences)})
}

func (a *app) deleteClosure(w http.ResponseWriter, r *http.Request, user adminUser, closureID string) {
	result, err := a.db.ExecContext(r.Context(), `update booking_occupancies set active=false where id=$1 and admin_id=$2 and kind='closure' and active`, closureID, user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	changed, _ := result.RowsAffected()
	if changed == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "closure not found"})
		return
	}
	a.insertActivityLog(r.Context(), "admin", user.ID, "reopen_booking_slot", "booking_closure", closureID, map[string]any{"adminId": user.ID})
	writeJSON(w, http.StatusOK, map[string]any{"status": "open"})
}

func (a *app) writeBookingOverview(w http.ResponseWriter, r *http.Request, adminID string, admin bool) {
	a.expireHolds(r.Context(), adminID)
	s, err := a.ensureBookingSettings(r.Context(), adminID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	courts, err := a.bookingCourts(r.Context(), adminID, !admin)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	date := r.URL.Query().Get("date")
	if date == "" {
		date = time.Now().In(bangkokLocation).Format("2006-01-02")
	}
	dayStart, err := time.ParseInLocation("2006-01-02", date, bangkokLocation)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid date"})
		return
	}
	if !admin && !s.AllowOvernight && date != time.Now().In(bangkokLocation).Format("2006-01-02") {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "ระบบเปิดให้จองได้เฉพาะวันนี้"})
		return
	}
	dayEnd := dayStart.Add(48 * time.Hour)
	rows, err := a.db.QueryContext(r.Context(), `select b.id,b.court_id,c.name,coalesce(b.member_id,''),case when $4 then b.booker_name else '' end,b.booked_by,b.start_at,b.end_at,b.interval_minutes,b.unit_price_thb,b.total_price_thb,b.status,b.payment_status,b.hold_expires_at,case when $4 then b.note else '' end,case when $4 then coalesce((select p.slip_data from booking_payments p join bookings paid_booking on paid_booking.id=p.booking_id where p.booking_id=b.id or (b.booking_batch_id is not null and paid_booking.booking_batch_id=b.booking_batch_id) order by p.created_at desc limit 1),'') else '' end,to_char(b.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from bookings b join booking_courts c on c.id=b.court_id where b.admin_id=$1 and b.start_at<$3 and b.end_at>$2 and b.status<>'expired' and ($4 or b.status in ('hold','pending_review','confirmed')) order by b.start_at,c.sort_order`, adminID, dayStart, dayEnd, admin)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	bookings := []bookingRecord{}
	for rows.Next() {
		var b bookingRecord
		var start, end time.Time
		var holdExpiresAt sql.NullTime
		if err = rows.Scan(&b.ID, &b.CourtID, &b.CourtName, &b.MemberID, &b.BookerName, &b.BookedBy, &start, &end, &b.Interval, &b.UnitPrice, &b.TotalPrice, &b.Status, &b.PaymentStatus, &holdExpiresAt, &b.Note, &b.SlipData, &b.CreatedAt); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		b.StartAt = start.Format(time.RFC3339)
		b.EndAt = end.Format(time.RFC3339)
		if holdExpiresAt.Valid {
			b.HoldExpiresAt = holdExpiresAt.Time.Format(time.RFC3339)
		}
		if !admin {
			b.ID = ""
			b.MemberID = ""
			b.BookerName = ""
			b.BookedBy = ""
			b.PaymentStatus = ""
			b.Note = ""
			b.SlipData = ""
			b.CreatedAt = ""
		}
		bookings = append(bookings, b)
	}
	closures := []map[string]any{}
	cr, _ := a.db.QueryContext(r.Context(), `select id,court_id,lower(occupied_range),upper(occupied_range),note from booking_occupancies where admin_id=$1 and kind='closure' and active and occupied_range && tstzrange($2,$3,'[)')`, adminID, dayStart, dayEnd)
	if cr != nil {
		defer cr.Close()
		for cr.Next() {
			var id, court, note string
			var start, end time.Time
			_ = cr.Scan(&id, &court, &start, &end, &note)
			closures = append(closures, map[string]any{"id": id, "courtId": court, "startAt": start.Format(time.RFC3339), "endAt": end.Format(time.RFC3339), "note": note})
		}
	}
	payload := map[string]any{"settings": s, "courts": courts, "bookings": bookings, "closures": closures, "date": date}
	if !admin {
		s.PublicToken = ""
		s.PromptPayID = ""
		s.TelegramChatID = ""
		s.TelegramConfigured = false
		s.TelegramWebhookURL = ""
		payload["settings"] = s
	}
	writeJSON(w, 200, payload)
}

func (a *app) writePublicBookingQueues(w http.ResponseWriter, r *http.Request, adminID string) {
	u, ok := a.currentPublicUser(r.Context(), r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "login required"})
		return
	}
	a.expireHolds(r.Context(), adminID)
	s, err := a.ensureBookingSettings(r.Context(), adminID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	rows, err := a.db.QueryContext(r.Context(), `
		select b.id,coalesce(b.booking_batch_id,''),c.name,b.start_at,b.end_at,
			b.total_price_thb,b.status,b.hold_expires_at
		from bookings b
		join booking_courts c on c.id=b.court_id
		join members m on m.id=b.member_id
		where b.admin_id=$1 and m.public_user_id=$2
			and b.status='hold'
		order by b.created_at,b.start_at,c.sort_order
	`, adminID, u.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	items := []publicBookingQueue{}
	indexes := map[string]int{}
	for rows.Next() {
		var bookingID, batchID, courtName, status string
		var start, end time.Time
		var expires sql.NullTime
		var total int
		if err = rows.Scan(&bookingID, &batchID, &courtName, &start, &end, &total, &status, &expires); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		key := batchID
		if key == "" {
			key = bookingID
		}
		index, exists := indexes[key]
		if !exists {
			item := publicBookingQueue{ID: key, Status: status, TotalPriceTHB: total, StartAt: start.Format(time.RFC3339), EndAt: end.Format(time.RFC3339), CourtNames: []string{courtName}}
			if expires.Valid {
				item.HoldExpiresAt = expires.Time.Format(time.RFC3339)
			}
			items = append(items, item)
			index = len(items) - 1
			indexes[key] = index
		} else {
			items[index].TotalPriceTHB += total
			if start.Before(mustBookingTime(items[index].StartAt)) {
				items[index].StartAt = start.Format(time.RFC3339)
			}
			if end.After(mustBookingTime(items[index].EndAt)) {
				items[index].EndAt = end.Format(time.RFC3339)
			}
			if !slices.Contains(items[index].CourtNames, courtName) {
				items[index].CourtNames = append(items[index].CourtNames, courtName)
			}
		}
	}
	if err = rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	for i := range items {
		if items[i].Status == "hold" {
			items[i].PromptPayPayload, _ = promptPayPayload(promptPaySettings{ID: s.PromptPayID, Type: s.PromptPayType, ReceiverName: s.PromptPayReceiverName}, items[i].TotalPriceTHB)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func mustBookingTime(value string) time.Time {
	parsed, _ := time.Parse(time.RFC3339, value)
	return parsed
}

func (a *app) reviewBookingHTTP(w http.ResponseWriter, r *http.Request, adminID, bookingID, actorType, actorID string) {
	var b struct{ Action, Note string }
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid review"})
		return
	}
	if (b.Action == "reject" || b.Action == "cancel") && strings.TrimSpace(b.Note) == "" {
		writeJSON(w, 400, map[string]string{"error": "กรุณาระบุเหตุผล"})
		return
	}
	if err := a.reviewBooking(r.Context(), adminID, bookingID, b.Action, b.Note, actorType, actorID); err != nil {
		writeJSON(w, 409, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"status": "ok"})
}

func (a *app) reviewBooking(ctx context.Context, adminID, bookingID, action, note, actorType, actorID string) error {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var status, payment string
	if err = tx.QueryRowContext(ctx, `select status,payment_status from bookings where id=$1 and admin_id=$2 for update`, bookingID, adminID).Scan(&status, &payment); err != nil {
		return errors.New("booking not found")
	}
	nextStatus, nextPayment := status, payment
	active := true
	switch action {
	case "approve":
		if status == "confirmed" && payment == "paid" {
			return nil
		}
		if status != "pending_review" {
			return errors.New("รายการนี้ไม่ได้รอตรวจสอบ")
		}
		nextStatus = "confirmed"
		nextPayment = "paid"
	case "reject":
		if status == "rejected" {
			return nil
		}
		if status != "pending_review" {
			return errors.New("รายการนี้ไม่ได้รอตรวจสอบ")
		}
		nextStatus = "rejected"
		nextPayment = "rejected"
		active = false
	case "cancel":
		if status == "cancelled" {
			return nil
		}
		if status != "confirmed" && status != "pending_review" {
			return errors.New("ไม่สามารถยกเลิกรายการนี้")
		}
		nextStatus = "cancelled"
		active = false
	case "paid":
		if status != "confirmed" {
			return errors.New("booking ยังไม่ยืนยัน")
		}
		nextPayment = "paid"
	default:
		return errors.New("invalid action")
	}
	_, err = tx.ExecContext(ctx, `update bookings set status=$3,payment_status=$4,note=$5,updated_at=now() where id=$1 and admin_id=$2`, bookingID, adminID, nextStatus, nextPayment, strings.TrimSpace(note))
	if err != nil {
		return err
	}
	if !active {
		_, err = tx.ExecContext(ctx, `update booking_occupancies set active=false where booking_id=$1`, bookingID)
		if err != nil {
			return err
		}
	}
	if action == "approve" || action == "reject" || action == "paid" {
		payStatus := map[string]string{"approve": "approved", "reject": "rejected", "paid": "manual_paid"}[action]
		_, err = tx.ExecContext(ctx, `update booking_payments set status=$2,note=$3,reviewed_by=$4,reviewed_at=now() where id=(select id from booking_payments where booking_id=$1 order by created_at desc limit 1)`, bookingID, payStatus, note, actorID)
		if err != nil {
			return err
		}
	}
	if err = a.insertActivityLogTx(ctx, tx, actorType, actorID, action+"_booking", "booking", bookingID, map[string]any{"adminId": adminID, "fromStatus": status, "toStatus": nextStatus, "paymentStatus": nextPayment, "note": note}); err != nil {
		return err
	}
	return tx.Commit()
}

func (a *app) handlePublicBooking(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/public-booking/"), "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeJSON(w, 404, map[string]string{"error": "not found"})
		return
	}
	token := parts[0]
	var adminID string
	if err := a.db.QueryRowContext(r.Context(), `select admin_id from booking_settings where public_token_hash=$1`, tokenDigest(token)).Scan(&adminID); err != nil {
		writeJSON(w, 404, map[string]string{"error": "booking page not found"})
		return
	}
	if !a.requireFeature(w, r, adminID, "booking") {
		return
	}
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}
	switch {
	case r.Method == http.MethodGet && (action == "" || action == "availability"):
		a.writeBookingOverview(w, r, adminID, false)
	case r.Method == http.MethodGet && action == "mine":
		a.writePublicBookingQueues(w, r, adminID)
	case r.Method == http.MethodPost && action == "hold":
		a.createPublicHold(w, r, adminID, token)
	case r.Method == http.MethodPost && action == "slip" && len(parts) > 2:
		a.uploadBookingSlip(w, r, adminID, parts[2])
	default:
		writeJSON(w, 404, map[string]string{"error": "not found"})
	}
}

func (a *app) createPublicHold(w http.ResponseWriter, r *http.Request, adminID, tenantToken string) {
	if !requireBookingRate(w, r, "booking-hold:"+adminID, 20, 10*time.Minute) {
		return
	}
	u, ok := a.currentPublicUser(r.Context(), r)
	if !ok {
		writeJSON(w, 401, map[string]string{"error": "google login required"})
		return
	}
	var memberID, name string
	if err := a.db.QueryRowContext(r.Context(), `select id,name from members where admin_id=$1 and public_user_id=$2 and active and deleted_at is null`, adminID, u.ID).Scan(&memberID, &name); err != nil {
		writeJSON(w, 403, map[string]string{"error": "member profile required"})
		return
	}
	type holdItem struct{ CourtID, StartAt, EndAt string }
	var b struct {
		CourtID, StartAt, EndAt string
		Items                   []holdItem `json:"items"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid booking"})
		return
	}
	if len(b.Items) == 0 && b.CourtID != "" {
		b.Items = []holdItem{{CourtID: b.CourtID, StartAt: b.StartAt, EndAt: b.EndAt}}
	}
	if len(b.Items) == 0 || len(b.Items) > 24 {
		writeJSON(w, 400, map[string]string{"error": "กรุณาเลือกช่วงเวลาจอง 1-24 รายการ"})
		return
	}

	s, err := a.ensureBookingSettings(r.Context(), adminID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	batchID := randUUID()
	expires := time.Now().Add(5 * time.Minute)
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	if err = a.deleteExpiredHoldsTx(r.Context(), tx, adminID); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	records := make([]bookingRecord, 0, len(b.Items))
	totalAmount := 0
	for _, item := range b.Items {
		start, parseErr := parseBookingTime(item.StartAt)
		if parseErr != nil {
			writeJSON(w, 400, map[string]string{"error": "เวลาเริ่มไม่ถูกต้อง"})
			return
		}
		end, parseErr := parseBookingTime(item.EndAt)
		if parseErr != nil || !end.After(start) || start.Before(time.Now().Add(-time.Minute)) {
			writeJSON(w, 400, map[string]string{"error": "ช่วงเวลาจองไม่ถูกต้อง"})
			return
		}
		if !publicBookingDateAllowed(s, start, end, time.Now()) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "ระบบเปิดให้จองได้เฉพาะวันนี้"})
			return
		}
		durationMinutes := int(end.Sub(start).Minutes())
		if durationMinutes%s.IntervalMinutes != 0 {
			writeJSON(w, 400, map[string]string{"error": "ช่วงเวลาต้องตรงกับตัวคั่นเวลาที่ตั้งไว้"})
			return
		}
		openParts := strings.Split(s.OpenTime, ":")
		closeParts := strings.Split(s.CloseTime, ":")
		openHour, _ := strconv.Atoi(openParts[0])
		openMinute, _ := strconv.Atoi(openParts[1])
		closeHour, _ := strconv.Atoi(closeParts[0])
		closeMinute, _ := strconv.Atoi(closeParts[1])
		localStart := start.In(bangkokLocation)
		anchor := time.Date(localStart.Year(), localStart.Month(), localStart.Day(), openHour, openMinute, 0, 0, bangkokLocation)
		closeAt := time.Date(localStart.Year(), localStart.Month(), localStart.Day(), closeHour, closeMinute, 0, 0, bangkokLocation)
		if s.AllowOvernight && !closeAt.After(anchor) {
			if localStart.Before(closeAt) {
				anchor = anchor.AddDate(0, 0, -1)
			}
			closeAt = anchor.Add(time.Duration((24*60-(openHour*60+openMinute))+(closeHour*60+closeMinute)) * time.Minute)
		}
		if (!s.AllowOvernight && start.In(bangkokLocation).Format("2006-01-02") != end.Add(-time.Second).In(bangkokLocation).Format("2006-01-02")) || start.Before(anchor) || end.After(closeAt) || int(start.Sub(anchor).Minutes())%s.IntervalMinutes != 0 {
			writeJSON(w, 400, map[string]string{"error": "ช่วงจองอยู่นอกเวลาเปิดให้บริการ"})
			return
		}
		var court bookingCourt
		if err = tx.QueryRowContext(r.Context(), `select id,name,price_per_interval,active,sort_order from booking_courts where id=$1 and admin_id=$2 and active and deleted_at is null`, item.CourtID, adminID).Scan(&court.ID, &court.Name, &court.Price, &court.Active, &court.Sort); err != nil {
			writeJSON(w, 400, map[string]string{"error": "ไม่พบสนาม"})
			return
		}
		itemTotal := durationMinutes / s.IntervalMinutes * court.Price
		bookingID := randUUID()
		_, err = tx.ExecContext(r.Context(), `insert into bookings (id,admin_id,court_id,member_id,booked_by,booker_name,start_at,end_at,interval_minutes,unit_price_thb,total_price_thb,status,payment_status,hold_expires_at,booking_batch_id) values ($1,$2,$3,$4,'member',$5,$6,$7,$8,$9,$10,'hold','unpaid',$11,$12)`, bookingID, adminID, item.CourtID, memberID, name, start, end, s.IntervalMinutes, court.Price, itemTotal, expires, batchID)
		if err == nil {
			_, err = tx.ExecContext(r.Context(), `insert into booking_occupancies (admin_id,court_id,booking_id,kind,occupied_range) values ($1,$2,$3,'booking',tstzrange($4,$5,'[)'))`, adminID, item.CourtID, bookingID, start, end)
		}
		if err != nil {
			if strings.Contains(err.Error(), "booking_occupancies_no_overlap") {
				writeJSON(w, 409, map[string]string{"error": "มีช่วงเวลาที่ถูกจองหรือล็อกไปแล้ว กรุณาเลือกใหม่"})
				return
			}
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		records = append(records, bookingRecord{ID: bookingID, CourtID: court.ID, CourtName: court.Name, MemberID: memberID, BookerName: name, BookedBy: "member", StartAt: start.Format(time.RFC3339), EndAt: end.Format(time.RFC3339), Interval: s.IntervalMinutes, UnitPrice: court.Price, TotalPrice: itemTotal, Status: "hold", PaymentStatus: "unpaid", HoldExpiresAt: expires.Format(time.RFC3339)})
		totalAmount += itemTotal
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	payload, _ := promptPayPayload(promptPaySettings{ID: s.PromptPayID, Type: s.PromptPayType, ReceiverName: s.PromptPayReceiverName}, totalAmount)
	a.insertActivityLog(r.Context(), "public_user", u.ID, "create_booking_hold", "booking_batch", batchID, map[string]any{"adminId": adminID, "items": len(records), "total": totalAmount})
	writeJSON(w, 201, map[string]any{"batchId": batchID, "bookings": records, "totalPriceThb": totalAmount, "promptPayPayload": payload, "receiverName": s.PromptPayReceiverName})
}

func (a *app) uploadBookingSlip(w http.ResponseWriter, r *http.Request, adminID, bookingID string) {
	if !requireBookingRate(w, r, "booking-slip:"+adminID, 10, 10*time.Minute) {
		return
	}
	u, ok := a.currentPublicUser(r.Context(), r)
	if !ok {
		writeJSON(w, 401, map[string]string{"error": "login required"})
		return
	}
	var b struct {
		SlipData string `json:"slipData"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 7<<20)).Decode(&b) != nil || len(b.SlipData) > 6_800_000 || !validImageData(b.SlipData, false) {
		writeJSON(w, 400, map[string]string{"error": "รองรับสลิป JPEG/PNG/WebP ไม่เกิน 5 MB"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var memberID, status, batchID string
	var expires time.Time
	var amount int
	if err = tx.QueryRowContext(r.Context(), `select b.member_id,b.status,b.hold_expires_at,coalesce((select sum(x.total_price_thb) from bookings x where x.admin_id=b.admin_id and x.booking_batch_id=b.booking_batch_id),b.total_price_thb),coalesce(b.booking_batch_id,'') from bookings b join members m on m.id=b.member_id where (b.id=$1 or b.booking_batch_id=$1) and b.admin_id=$2 and m.public_user_id=$3 order by b.created_at limit 1 for update`, bookingID, adminID, u.ID).Scan(&memberID, &status, &expires, &amount, &batchID); err != nil {
		writeJSON(w, 404, map[string]string{"error": "booking not found"})
		return
	}
	if status != "hold" || time.Now().After(expires) {
		_ = a.insertActivityLogTx(r.Context(), tx, "system", adminID, "delete_expired_booking_hold", "booking_batch", bookingID, map[string]any{"adminId": adminID, "batchId": batchID, "reason": "payment_timeout"})
		_, _ = tx.ExecContext(r.Context(), `delete from bookings where admin_id=$3 and (id=$1 or ($2<>'' and booking_batch_id=$2)) and status='hold'`, bookingID, batchID, adminID)
		_ = tx.Commit()
		writeJSON(w, 409, map[string]string{"error": "เวลาชำระเงินหมดแล้ว รายการจองถูกลบ กรุณาเลือกเวลาใหม่"})
		return
	}
	paymentID := randUUID()
	var primaryBookingID string
	if err = tx.QueryRowContext(r.Context(), `select id from bookings where id=$1 or ($2<>'' and booking_batch_id=$2) order by created_at limit 1`, bookingID, batchID).Scan(&primaryBookingID); err != nil {
		writeJSON(w, 404, map[string]string{"error": "booking not found"})
		return
	}
	_, err = tx.ExecContext(r.Context(), `insert into booking_payments (id,booking_id,member_id,amount_thb,slip_data,status) values ($1,$2,$3,$4,$5,'pending')`, paymentID, primaryBookingID, memberID, amount, b.SlipData)
	if err == nil {
		_, err = tx.ExecContext(r.Context(), `update bookings set status='pending_review',payment_status='pending',updated_at=now() where id=$1 or ($2<>'' and booking_batch_id=$2)`, bookingID, batchID)
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	_ = a.insertActivityLogTx(r.Context(), tx, "public_user", u.ID, "upload_booking_slip", "booking", primaryBookingID, map[string]any{"adminId": adminID, "batchId": batchID, "amount": amount})
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	go a.notifyAdminBooking(context.Background(), adminID, primaryBookingID)
	writeJSON(w, 200, map[string]any{"status": "pending_review"})
}

type publicUser struct{ ID, Email, Name string }

func (a *app) currentPublicUser(ctx context.Context, r *http.Request) (publicUser, bool) {
	c, err := r.Cookie(publicCookieName)
	if err != nil || c.Value == "" {
		return publicUser{}, false
	}
	var u publicUser
	err = a.db.QueryRowContext(ctx, `select u.id,u.email,u.google_name from public_user_sessions s join public_users u on u.id=s.public_user_id where s.token_hash=$1 and s.expires_at>now()`, tokenDigest(c.Value)).Scan(&u.ID, &u.Email, &u.Name)
	return u, err == nil
}
func setPublicCookie(w http.ResponseWriter, r *http.Request, token string) {
	secure := r.TLS != nil || strings.EqualFold(os.Getenv("COOKIE_SECURE"), "true")
	http.SetCookie(w, &http.Cookie{Name: publicCookieName, Value: token, Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, MaxAge: int((7 * 24 * time.Hour).Seconds())})
}

func googleOAuthConfig() *oauth2.Config {
	return &oauth2.Config{ClientID: os.Getenv("GOOGLE_CLIENT_ID"), ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"), RedirectURL: os.Getenv("GOOGLE_REDIRECT_URL"), Scopes: []string{"openid", "email", "profile"}, Endpoint: google.Endpoint}
}
func (a *app) handlePublicAuth(w http.ResponseWriter, r *http.Request) {
	action := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/public-auth/"), "/")
	switch {
	case r.Method == http.MethodGet && action == "google/start":
		a.startGoogleLogin(w, r)
	case r.Method == http.MethodGet && action == "google/callback":
		a.finishGoogleLogin(w, r)
	case r.Method == http.MethodGet && action == "me":
		a.publicMe(w, r)
	case r.Method == http.MethodPost && action == "claim":
		a.claimMember(w, r)
	case r.Method == http.MethodPost && action == "logout":
		if c, err := r.Cookie(publicCookieName); err == nil {
			_, _ = a.db.ExecContext(r.Context(), `delete from public_user_sessions where token_hash=$1`, tokenDigest(c.Value))
		}
		secure := r.TLS != nil || strings.EqualFold(os.Getenv("COOKIE_SECURE"), "true")
		http.SetCookie(w, &http.Cookie{Name: publicCookieName, Path: "/", MaxAge: -1, HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode})
		writeJSON(w, 200, map[string]string{"status": "ok"})
	default:
		writeJSON(w, 404, map[string]string{"error": "not found"})
	}
}

func (a *app) startGoogleLogin(w http.ResponseWriter, r *http.Request) {
	if !requireBookingRate(w, r, "google-start", 20, 10*time.Minute) {
		return
	}
	tenant := strings.TrimSpace(r.URL.Query().Get("tenant"))
	var adminID string
	if err := a.db.QueryRowContext(r.Context(), `select admin_id from booking_settings where public_token_hash=$1`, tokenDigest(tenant)).Scan(&adminID); err != nil || !a.features(r.Context(), adminID).BookingEnabled {
		writeJSON(w, 404, map[string]string{"error": "booking page not found"})
		return
	}
	cfg := googleOAuthConfig()
	if cfg.ClientID == "" || cfg.ClientSecret == "" || cfg.RedirectURL == "" {
		writeJSON(w, 503, map[string]string{"error": "Google login is not configured"})
		return
	}
	state, nonce := randHex(24), randHex(20)
	_, err := a.db.ExecContext(r.Context(), `insert into oauth_login_states (state_hash,nonce,admin_id,return_path,expires_at) values ($1,$2,$3,$4,now()+interval '10 minutes')`, tokenDigest(state), nonce, adminID, tenant)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	http.Redirect(w, r, cfg.AuthCodeURL(state, oauth2.SetAuthURLParam("nonce", nonce), oauth2.AccessTypeOnline), http.StatusFound)
}

func (a *app) finishGoogleLogin(w http.ResponseWriter, r *http.Request) {
	if !requireBookingRate(w, r, "google-callback", 30, 10*time.Minute) {
		return
	}
	state := r.URL.Query().Get("state")
	var nonce, adminID, tenant string
	if err := a.db.QueryRowContext(r.Context(), `delete from oauth_login_states where state_hash=$1 and expires_at>now() returning nonce,admin_id,return_path`, tokenDigest(state)).Scan(&nonce, &adminID, &tenant); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid oauth state"})
		return
	}
	cfg := googleOAuthConfig()
	tok, err := cfg.Exchange(r.Context(), r.URL.Query().Get("code"))
	if err != nil {
		writeJSON(w, 401, map[string]string{"error": "google login failed"})
		return
	}
	raw, _ := tok.Extra("id_token").(string)
	payload, err := idtoken.Validate(r.Context(), raw, cfg.ClientID)
	if err != nil || payload.Claims["email_verified"] != true || fmt.Sprint(payload.Claims["nonce"]) != nonce {
		writeJSON(w, 401, map[string]string{"error": "invalid google identity"})
		return
	}
	email := normalizeEmail(fmt.Sprint(payload.Claims["email"]))
	name := strings.TrimSpace(fmt.Sprint(payload.Claims["name"]))
	if name == "" {
		name = email
	}
	uid := randUUID()
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	err = tx.QueryRowContext(r.Context(), `insert into public_users (id,google_sub,email,google_name) values ($1,$2,$3,$4) on conflict (google_sub) do update set email=excluded.email,google_name=excluded.google_name,updated_at=now() returning id`, uid, payload.Subject, email, name).Scan(&uid)
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": "email is already linked"})
		return
	}
	sessionToken := randHex(24)
	_, err = tx.ExecContext(r.Context(), `insert into public_user_sessions (token_hash,public_user_id,expires_at) values ($1,$2,now()+interval '7 days')`, tokenDigest(sessionToken), uid)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	_ = a.insertActivityLogTx(r.Context(), tx, "public_user", uid, "google_login", "admin_user", adminID, map[string]any{"email": email})
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	setPublicCookie(w, r, sessionToken)
	http.Redirect(w, r, "/booking/"+tenant, http.StatusFound)
}

func (a *app) publicMe(w http.ResponseWriter, r *http.Request) {
	u, ok := a.currentPublicUser(r.Context(), r)
	if !ok {
		writeJSON(w, 401, map[string]string{"error": "not logged in"})
		return
	}
	tenant := r.URL.Query().Get("tenant")
	var adminID string
	if err := a.db.QueryRowContext(r.Context(), `select admin_id from booking_settings where public_token_hash=$1`, tokenDigest(tenant)).Scan(&adminID); err != nil {
		writeJSON(w, 404, map[string]string{"error": "tenant not found"})
		return
	}
	if !a.features(r.Context(), adminID).BookingEnabled {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "feature disabled"})
		return
	}
	var m memberRecord
	var phone, tokenHash string
	err := a.db.QueryRowContext(r.Context(), `select id,name,phone,member_type,active,profile_token_hash,profile_token from members where admin_id=$1 and public_user_id=$2 and deleted_at is null`, adminID, u.ID).Scan(&m.ID, &m.Name, &phone, &m.MemberType, &m.Active, &tokenHash, &m.ProfileToken)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, 200, map[string]any{"user": u, "member": nil})
		return
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	m.Phone = displayPhone(phone)
	m.Email = u.Email
	m.Linked = true
	writeJSON(w, 200, map[string]any{"user": u, "member": m})
}

func (a *app) claimMember(w http.ResponseWriter, r *http.Request) {
	if !requireBookingRate(w, r, "member-claim", 10, 10*time.Minute) {
		return
	}
	u, ok := a.currentPublicUser(r.Context(), r)
	if !ok {
		writeJSON(w, 401, map[string]string{"error": "not logged in"})
		return
	}
	var b struct{ Tenant, Name, Phone string }
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid profile"})
		return
	}
	phone, err := normalizePhone(b.Phone)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid phone"})
		return
	}
	var adminID string
	if err = a.db.QueryRowContext(r.Context(), `select admin_id from booking_settings where public_token_hash=$1`, tokenDigest(b.Tenant)).Scan(&adminID); err != nil {
		writeJSON(w, 404, map[string]string{"error": "tenant not found"})
		return
	}
	if !a.features(r.Context(), adminID).BookingEnabled {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "feature disabled"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var memberID string
	var existingUser sql.NullString
	err = tx.QueryRowContext(r.Context(), `select id,public_user_id from members where admin_id=$1 and phone=$2 and deleted_at is null for update`, adminID, phone).Scan(&memberID, &existingUser)
	name := strings.TrimSpace(b.Name)
	if name == "" {
		name = u.Name
	}
	if err == sql.ErrNoRows {
		memberID = randUUID()
		token := randHex(24)
		_, err = tx.ExecContext(r.Context(), `insert into members (id,admin_id,public_user_id,name,phone,contact_email,profile_token_hash,profile_token) values ($1,$2,$3,$4,$5,$6,$7,$8)`, memberID, adminID, u.ID, name, phone, u.Email, tokenDigest(token), token)
	} else if err == nil {
		if existingUser.Valid && existingUser.String != u.ID {
			writeJSON(w, 409, map[string]string{"error": "เบอร์โทรนี้เชื่อมกับอีเมลอื่นแล้ว"})
			return
		}
		_, err = tx.ExecContext(r.Context(), `update members set public_user_id=$3,name=$4,contact_email=$5,active=true,updated_at=now() where id=$1 and admin_id=$2`, memberID, adminID, u.ID, name, u.Email)
	}
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": "ไม่สามารถเชื่อมสมาชิกได้"})
		return
	}
	_ = a.insertActivityLogTx(r.Context(), tx, "public_user", u.ID, "claim_member", "member", memberID, map[string]any{"adminId": adminID, "phone": maskPhone(phone)})
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"status": "ok", "memberId": memberID})
}

func (a *app) handleProfile(w http.ResponseWriter, r *http.Request) {
	if !requireBookingRate(w, r, "profile", 120, 10*time.Minute) {
		return
	}
	token := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/profile/"), "/")
	u, ok := a.currentPublicUser(r.Context(), r)
	if !ok {
		writeJSON(w, 401, map[string]string{"error": "login required"})
		return
	}
	var m memberRecord
	var adminID, phone string
	err := a.db.QueryRowContext(r.Context(), `select m.id,m.admin_id,m.name,m.phone,u.email,m.member_type,m.active from members m join public_users u on u.id=m.public_user_id where m.profile_token_hash=$1 and m.public_user_id=$2 and m.deleted_at is null`, tokenDigest(token), u.ID).Scan(&m.ID, &adminID, &m.Name, &phone, &m.Email, &m.MemberType, &m.Active)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "profile not found"})
		return
	}
	features := a.features(r.Context(), adminID)
	if !features.MemberEnabled && !features.BookingEnabled {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "feature disabled"})
		return
	}
	if r.Method == http.MethodPatch {
		a.patchMember(w, r, adminID, m.ID, "public_user", u.ID, false)
		return
	}
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	m.Phone = displayPhone(phone)
	a.expireHolds(r.Context(), adminID)
	bookingToken := ""
	if features.BookingEnabled {
		_ = a.db.QueryRowContext(r.Context(), `select public_token from booking_settings where admin_id=$1`, adminID).Scan(&bookingToken)
	}
	bookings := []bookingRecord{}
	rows, _ := a.db.QueryContext(r.Context(), `select b.id,b.court_id,c.name,b.booker_name,b.booked_by,b.start_at,b.end_at,b.interval_minutes,b.unit_price_thb,b.total_price_thb,b.status,b.payment_status,b.hold_expires_at,b.note,to_char(b.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from bookings b join booking_courts c on c.id=b.court_id where b.member_id=$1 order by b.start_at desc limit 100`, m.ID)
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var b bookingRecord
			var start, end time.Time
			var holdExpiresAt sql.NullTime
			_ = rows.Scan(&b.ID, &b.CourtID, &b.CourtName, &b.BookerName, &b.BookedBy, &start, &end, &b.Interval, &b.UnitPrice, &b.TotalPrice, &b.Status, &b.PaymentStatus, &holdExpiresAt, &b.Note, &b.CreatedAt)
			b.StartAt = start.Format(time.RFC3339)
			b.EndAt = end.Format(time.RFC3339)
			if holdExpiresAt.Valid {
				b.HoldExpiresAt = holdExpiresAt.Time.Format(time.RFC3339)
			}
			bookings = append(bookings, b)
		}
	}
	payments := []map[string]any{}
	pr, _ := a.db.QueryContext(r.Context(), `select 'booking',p.booking_id,p.amount_thb,p.status,to_char(p.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from booking_payments p where p.member_id=$1 union all select 'match',e.session_id,e.amount_thb,case when e.paid then 'paid' else 'unpaid' end,to_char(e.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from player_payment_events e where e.member_id=$1 order by 5 desc`, m.ID)
	if pr != nil {
		defer pr.Close()
		for pr.Next() {
			var kind, id, status, created string
			var amount int
			_ = pr.Scan(&kind, &id, &amount, &status, &created)
			payments = append(payments, map[string]any{"kind": kind, "id": id, "amountThb": amount, "status": status, "createdAt": created})
		}
	}
	matches := []map[string]any{}
	mr, _ := a.db.QueryContext(r.Context(), `select s.name,mt.id,mt.court,mt.started_at,mt.ended_at,mt.status,mt.winner,p.id from players p join sessions s on s.id=p.session_id join matches mt on mt.session_id=p.session_id and p.id in (mt.a1,mt.a2,mt.b1,mt.b2) where p.member_id=$1 and mt.phase='history' order by s.updated_at desc,mt.id desc limit 100`, m.ID)
	if mr != nil {
		defer mr.Close()
		for mr.Next() {
			var session, court, started, ended, status, winner string
			var matchID, playerID int
			_ = mr.Scan(&session, &matchID, &court, &started, &ended, &status, &winner, &playerID)
			matches = append(matches, map[string]any{"sessionName": session, "matchId": matchID, "court": court, "startedAt": started, "endedAt": ended, "status": status, "winner": winner, "playerId": playerID})
		}
	}
	writeJSON(w, 200, map[string]any{"member": m, "bookingToken": bookingToken, "bookings": bookings, "payments": payments, "matches": matches})
}

func encryptionKey() ([]byte, error) {
	raw := strings.TrimSpace(os.Getenv("APP_ENCRYPTION_KEY"))
	if raw == "" {
		return nil, errors.New("APP_ENCRYPTION_KEY is required for Telegram")
	}
	sum := sha256.Sum256([]byte(raw))
	return sum[:], nil
}
func encryptSecret(value string) (string, error) {
	key, err := encryptionKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	out := gcm.Seal(nonce, nonce, []byte(value), nil)
	return base64.RawURLEncoding.EncodeToString(out), nil
}
func decryptSecret(value string) (string, error) {
	key, err := encryptionKey()
	if err != nil {
		return "", err
	}
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil || len(raw) < gcm.NonceSize() {
		return "", errors.New("invalid encrypted secret")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	return string(plain), err
}

func (a *app) setAdminTelegramWebhook(ctx context.Context, botToken, webhookID, secret string) error {
	base := strings.TrimRight(os.Getenv("APP_BASE_URL"), "/")
	if !strings.HasPrefix(base, "https://") {
		return nil
	}
	values := url.Values{"url": {base + "/api/booking-telegram/webhook/" + webhookID}, "secret_token": {secret}, "allowed_updates": {`["callback_query"]`}}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.telegram.org/bot"+botToken+"/setWebhook", strings.NewReader(values.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("telegram setWebhook: %s", resp.Status)
	}
	return nil
}
func (a *app) notifyAdminBooking(ctx context.Context, adminID, bookingID string) {
	var encrypted, chatID string
	if a.db.QueryRowContext(ctx, `select telegram_bot_token,telegram_chat_id from booking_settings where admin_id=$1`, adminID).Scan(&encrypted, &chatID) != nil || encrypted == "" || chatID == "" {
		return
	}
	token, err := decryptSecret(encrypted)
	if err != nil {
		return
	}
	var name, court, start, end, slipData string
	var amount int
	if a.db.QueryRowContext(ctx, `select booker_name,c.name,to_char(start_at at time zone 'Asia/Bangkok','DD/MM/YYYY HH24:MI'),to_char(end_at at time zone 'Asia/Bangkok','DD/MM/YYYY HH24:MI'),total_price_thb,coalesce((select slip_data from booking_payments where booking_id=b.id order by created_at desc limit 1),'') from bookings b join booking_courts c on c.id=b.court_id where b.id=$1 and b.admin_id=$2`, bookingID, adminID).Scan(&name, &court, &start, &end, &amount, &slipData) != nil {
		return
	}
	keyboard, _ := json.Marshal(map[string]any{"inline_keyboard": [][]map[string]string{{{"text": "อนุมัติ", "callback_data": "booking:approve:" + bookingID}, {"text": "ปฏิเสธ", "callback_data": "booking:reject:" + bookingID}}}})
	message := fmt.Sprintf("จองสนามใหม่\n%s\n%s\n%s - %s\nยอด %d บาท", name, court, start, end, amount)
	if validImageData(slipData, false) {
		comma := strings.IndexByte(slipData, ',')
		raw, decodeErr := base64.StdEncoding.DecodeString(slipData[comma+1:])
		if decodeErr == nil {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			_ = writer.WriteField("chat_id", chatID)
			_ = writer.WriteField("caption", message)
			_ = writer.WriteField("reply_markup", string(keyboard))
			part, partErr := writer.CreateFormFile("photo", "slip.jpg")
			if partErr == nil {
				_, _ = part.Write(raw)
			}
			_ = writer.Close()
			req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.telegram.org/bot"+token+"/sendPhoto", &body)
			req.Header.Set("Content-Type", writer.FormDataContentType())
			if resp, sendErr := http.DefaultClient.Do(req); sendErr == nil {
				resp.Body.Close()
				if resp.StatusCode < 300 {
					return
				}
			}
		}
	}
	values := url.Values{"chat_id": {chatID}, "text": {message}, "reply_markup": {string(keyboard)}}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.telegram.org/bot"+token+"/sendMessage", strings.NewReader(values.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err == nil {
		resp.Body.Close()
	}
}
func (a *app) handleBookingTelegramWebhook(w http.ResponseWriter, r *http.Request) {
	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/booking-telegram/webhook/"), "/")
	var adminID, encrypted, chatID, secretHash string
	if a.db.QueryRowContext(r.Context(), `select admin_id,telegram_bot_token,telegram_chat_id,telegram_secret_hash from booking_settings where telegram_webhook_id=$1`, id).Scan(&adminID, &encrypted, &chatID, &secretHash) != nil {
		writeJSON(w, 404, map[string]string{"error": "not found"})
		return
	}
	if tokenDigest(r.Header.Get("X-Telegram-Bot-Api-Secret-Token")) != secretHash {
		writeJSON(w, 401, map[string]string{"error": "invalid secret"})
		return
	}
	var update struct {
		CallbackQuery *struct {
			ID   string `json:"id"`
			Data string `json:"data"`
			From struct {
				ID int64 `json:"id"`
			} `json:"from"`
			Message struct {
				Chat struct {
					ID int64 `json:"id"`
				} `json:"chat"`
			} `json:"message"`
		} `json:"callback_query"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&update) != nil || update.CallbackQuery == nil {
		writeJSON(w, 200, map[string]string{"status": "ignored"})
		return
	}
	q := update.CallbackQuery
	if strconv.FormatInt(q.Message.Chat.ID, 10) != chatID {
		writeJSON(w, 403, map[string]string{"error": "chat not allowed"})
		return
	}
	parts := strings.Split(q.Data, ":")
	if len(parts) != 3 || parts[0] != "booking" {
		writeJSON(w, 200, map[string]string{"status": "ignored"})
		return
	}
	note := ""
	if parts[1] == "reject" {
		note = "ปฏิเสธผ่าน Telegram"
	}
	err := a.reviewBooking(r.Context(), adminID, parts[2], parts[1], note, "telegram", strconv.FormatInt(q.From.ID, 10))
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}
