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
	"unicode/utf8"

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

var telegramAPIBaseURL = "https://api.telegram.org"

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

func (a *app) requireRequestRate(w http.ResponseWriter, r *http.Request, scope string, limit int, window time.Duration) bool {
	key := scope + ":" + clientIP(r)
	var count int
	var reset time.Time
	err := a.db.QueryRowContext(r.Context(), `
		insert into request_rate_limits (rate_key, window_start, reset_at, request_count)
		values ($1, now(), now() + make_interval(secs => $2), 1)
		on conflict (rate_key) do update set
			window_start = case when request_rate_limits.reset_at <= now() then now() else request_rate_limits.window_start end,
			reset_at = case when request_rate_limits.reset_at <= now() then now() + make_interval(secs => $2) else request_rate_limits.reset_at end,
			request_count = case when request_rate_limits.reset_at <= now() then 1 else request_rate_limits.request_count + 1 end
		returning request_count, reset_at
	`, key, int(window.Seconds())).Scan(&count, &reset)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "rate limit unavailable"})
		return false
	}
	if count <= limit {
		return true
	}
	retry := int(time.Until(reset).Seconds())
	if retry < 1 {
		retry = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(retry))
	writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many requests"})
	return false
}

func (a *app) runRateLimitCleanup(ctx context.Context) {
	cleanup := func() {
		_, _ = a.db.ExecContext(ctx, `delete from request_rate_limits where reset_at < now() - interval '1 day'`)
	}
	cleanup()
	ticker := time.NewTicker(time.Hour)
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

type adminFeatures struct {
	MemberEnabled  bool `json:"memberEnabled"`
	BookingEnabled bool `json:"bookingEnabled"`
	POSEnabled     bool `json:"posEnabled"`
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
	AdminID                    string `json:"-"`
	PublicToken                string `json:"publicToken"`
	OpenTime                   string `json:"openTime"`
	CloseTime                  string `json:"closeTime"`
	IntervalMinutes            int    `json:"intervalMinutes"`
	AllowOvernight             bool   `json:"allowOvernight"`
	UseSamePrice               bool   `json:"useSamePrice"`
	PromptPayType              string `json:"promptPayType"`
	PromptPayID                string `json:"promptPayId"`
	PromptPayReceiverName      string `json:"promptPayReceiverName"`
	LogoData                   string `json:"logoData,omitempty"`
	TelegramChatID             string `json:"telegramChatId"`
	TelegramConfigured         bool   `json:"telegramConfigured"`
	TelegramWebhookURL         string `json:"telegramWebhookUrl"`
	BookingAcceptanceEnabled   bool   `json:"bookingAcceptanceEnabled"`
	BookingAcceptanceOpenTime  string `json:"bookingAcceptanceOpenTime"`
	BookingAcceptanceCloseTime string `json:"bookingAcceptanceCloseTime"`
	SingleSlotPurchaseEnabled  bool   `json:"singleSlotPurchaseEnabled"`
	PopupEnabled               bool   `json:"popupEnabled"`
	PopupImage                 string `json:"popupImage,omitempty"`
	PopupRevision              string `json:"popupRevision"`
	SlipOKEnabled              bool   `json:"slipOKEnabled"`
	SlipOKBranchID             string `json:"slipOKBranchId"`
	SlipOKAPIKeyMasked         string `json:"slipOKApiKeyMasked,omitempty"`
	SlipOKMonthlyCap           int    `json:"slipOKMonthlyCap"`
}

func publicBookingDateAllowed(settings bookingSettingsRecord, start, end, now time.Time) bool {
	if settings.AllowOvernight {
		return true
	}
	today := now.In(bangkokLocation).Format("2006-01-02")
	return start.In(bangkokLocation).Format("2006-01-02") == today &&
		end.Add(-time.Nanosecond).In(bangkokLocation).Format("2006-01-02") == today
}

var (
	errPublicBookingDateNotAllowed = errors.New("ระบบเปิดให้จองได้เฉพาะวันที่อนุญาต")
	errPublicSingleSlotOnly        = errors.New("ระบบกำหนดให้จองได้ครั้งละ 1 ช่วงเวลา")
)

// validatePublicBookingWindow is the server-side authority for public booking
// time rules. The frontend may mirror these checks for UX, but API callers
// cannot bypass them by changing the DOM or crafting their own payload.
func validatePublicBookingWindow(settings bookingSettingsRecord, start, end, now time.Time) error {
	if !publicBookingDateAllowed(settings, start, end, now) {
		return errPublicBookingDateNotAllowed
	}
	if settings.SingleSlotPurchaseEnabled && end.Sub(start) != time.Duration(settings.IntervalMinutes)*time.Minute {
		return errPublicSingleSlotOnly
	}
	return validateBookingWindowAt(settings, start, end, now)
}

func bookingAcceptanceOpen(settings bookingSettingsRecord, now time.Time) bool {
	if !settings.BookingAcceptanceEnabled {
		return true
	}
	open, openErr := time.Parse("15:04", settings.BookingAcceptanceOpenTime)
	closeAt, closeErr := time.Parse("15:04", settings.BookingAcceptanceCloseTime)
	if openErr != nil || closeErr != nil {
		return false
	}
	local := now.In(bangkokLocation)
	minute := local.Hour()*60 + local.Minute()
	openMinute := open.Hour()*60 + open.Minute()
	closeMinute := closeAt.Hour()*60 + closeAt.Minute()
	if openMinute == closeMinute {
		return true
	}
	if closeMinute > openMinute {
		return minute >= openMinute && minute < closeMinute
	}
	return minute >= openMinute || minute < closeMinute
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
	BatchID       string `json:"batchId,omitempty"`
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
	_ = a.db.QueryRowContext(ctx, `select member_enabled, booking_enabled, pos_enabled from admin_features where admin_id = $1`, adminID).Scan(&f.MemberEnabled, &f.BookingEnabled, &f.POSEnabled)
	return f
}

func (a *app) requireFeature(w http.ResponseWriter, r *http.Request, adminID, feature string) bool {
	f := a.features(r.Context(), adminID)
	enabled := f.MemberEnabled
	if feature == "booking" {
		enabled = f.BookingEnabled
	} else if feature == "pos" {
		enabled = f.POSEnabled
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
	if _, err = tx.ExecContext(r.Context(), `insert into admin_features (admin_id, member_enabled, booking_enabled, pos_enabled, updated_by) values ($1,$2,$3,$4,$5) on conflict (admin_id) do update set member_enabled=excluded.member_enabled, booking_enabled=excluded.booking_enabled, pos_enabled=excluded.pos_enabled, updated_by=excluded.updated_by, updated_at=now()`, adminID, body.MemberEnabled, body.BookingEnabled, body.POSEnabled, actor); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	_ = a.insertActivityLogTx(r.Context(), tx, "backoffice", actor, "update_admin_features", "admin_user", adminID, map[string]any{"memberEnabled": body.MemberEnabled, "bookingEnabled": body.BookingEnabled, "posEnabled": body.POSEnabled})
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

func requestPage(r *http.Request, pageKey, sizeKey string, defaultSize, maxSize int) (int, int) {
	page, _ := strconv.Atoi(r.URL.Query().Get(pageKey))
	size, _ := strconv.Atoi(r.URL.Query().Get(sizeKey))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > maxSize {
		size = defaultSize
	}
	return page, size
}

func pageMeta(page, pageSize, total int) map[string]int {
	return map[string]int{"page": page, "pageSize": pageSize, "total": total}
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

func memberSearchQuery(values url.Values) (string, bool) {
	nameQuery := strings.TrimSpace(values.Get("q"))
	if nameQuery != "" {
		return nameQuery, utf8.RuneCountInString(nameQuery) >= 1
	}
	phoneQuery := strings.TrimSpace(values.Get("phone"))
	return phoneQuery, len(phoneSearchDigits(phoneQuery)) >= 1
}

func (a *app) listMembers(ctx context.Context, adminID, search, memberType string, page, pageSize int, activeOnly bool) ([]memberRecord, int, error) {
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
	if memberType != "club" && memberType != "general" {
		memberType = ""
	}
	var total int
	err := a.db.QueryRowContext(ctx, `select count(*) from members m where m.admin_id=$1 and m.deleted_at is null and (not $6 or m.active) and ($7='' or m.member_type=$7) and ($2='' or lower(m.name) like $3 or lower(coalesce(nullif(m.contact_email,''),(select email from public_users where id=m.public_user_id))) like $3 or ($4<>'' and (m.phone like $5 or replace(m.phone,'+66','0') like $5)))`, adminID, search, like, phoneSearch, phoneLike, activeOnly, memberType).Scan(&total)
	if err != nil {
		return nil, 0, err
	}
	rows, err := a.db.QueryContext(ctx, `select m.id,m.name,m.phone,coalesce(nullif(m.contact_email,''),u.email,''),m.member_type,m.active,m.public_user_id is not null,m.profile_token_hash,to_char(m.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from members m left join public_users u on u.id=m.public_user_id where m.admin_id=$1 and m.deleted_at is null and (not $6 or m.active) and ($7='' or m.member_type=$7) and ($2='' or lower(m.name) like $3 or lower(coalesce(nullif(m.contact_email,''),u.email,'')) like $3 or ($4<>'' and (m.phone like $5 or replace(m.phone,'+66','0') like $5))) order by m.created_at desc limit $8 offset $9`, adminID, search, like, phoneSearch, phoneLike, activeOnly, memberType, pageSize, (page-1)*pageSize)
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
		items, total, err := a.listMembers(r.Context(), user.ID, r.URL.Query().Get("search"), r.URL.Query().Get("memberType"), page, size, false)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total, "page": max(1, page), "pageSize": max(1, size)})
	case r.Method == http.MethodGet && path == "/export":
		a.writeAdminMembersExport(w, r, user.ID)
	case r.Method == http.MethodGet && path == "/search":
		query, searchable := memberSearchQuery(r.URL.Query())
		if !searchable {
			writeJSON(w, 200, map[string]any{"items": []memberRecord{}})
			return
		}
		if !a.requireRequestRate(w, r, "member-phone-search:"+user.ID, 60, 10*time.Minute) {
			return
		}
		items, _, err := a.listMembers(r.Context(), user.ID, query, "", 1, 12, true)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"items": items})
	case r.Method == http.MethodPut && path == "/bulk-membership":
		a.bulkUpdateMemberTypes(w, r, user.ID)
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

func (a *app) bulkUpdateMemberTypes(w http.ResponseWriter, r *http.Request, adminID string) {
	var body struct {
		Updates []struct {
			ID         string `json:"id"`
			MemberType string `json:"memberType"`
		} `json:"updates"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&body) != nil || len(body.Updates) > 2000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "รายการสมาชิกไม่ถูกต้อง"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	changed := 0
	seen := map[string]bool{}
	for _, update := range body.Updates {
		id := strings.TrimSpace(update.ID)
		if id == "" || seen[id] || (update.MemberType != "club" && update.MemberType != "general") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ข้อมูลประเภทสมาชิกไม่ถูกต้อง"})
			return
		}
		seen[id] = true
		result, execErr := tx.ExecContext(r.Context(), `update members set member_type=$3,updated_at=now() where id=$1 and admin_id=$2 and deleted_at is null and member_type<>$3`, id, adminID, update.MemberType)
		if execErr != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": execErr.Error()})
			return
		}
		rows, _ := result.RowsAffected()
		changed += int(rows)
	}
	if err = a.insertActivityLogTx(r.Context(), tx, "admin", adminID, "bulk_update_member_types", "member", "", map[string]any{"submitted": len(body.Updates), "changed": changed}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "changed": changed})
}

func (a *app) writeAdminMembersExport(w http.ResponseWriter, r *http.Request, adminID string) {
	members := make([]map[string]any, 0)
	rows, err := a.db.QueryContext(r.Context(), `
		select m.id,m.name,m.phone,coalesce(nullif(m.contact_email,''),u.email,''),
			m.member_type,m.active,m.public_user_id is not null,
			to_char(m.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),
			to_char(m.updated_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),
			(select count(*) from players p join sessions s on s.id=p.session_id where p.member_id=m.id and s.admin_id=m.admin_id),
			(select count(*) from bookings b where b.member_id=m.id and b.admin_id=m.admin_id),
			(select count(*) from booking_payments bp join bookings b on b.id=bp.booking_id where bp.member_id=m.id and b.admin_id=m.admin_id),
			coalesce((select sum(bp.amount_thb) from booking_payments bp join bookings b on b.id=bp.booking_id where bp.member_id=m.id and b.admin_id=m.admin_id and bp.status in ('approved','manual_paid')),0)
		from members m
		left join public_users u on u.id=m.public_user_id
		where m.admin_id=$1 and m.deleted_at is null
		order by m.created_at,m.name`, adminID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	for rows.Next() {
		var id, name, phone, email, memberType, createdAt, updatedAt string
		var active, linked bool
		var playerCount, bookingCount, paymentCount, approvedAmount int
		if err = rows.Scan(&id, &name, &phone, &email, &memberType, &active, &linked, &createdAt, &updatedAt, &playerCount, &bookingCount, &paymentCount, &approvedAmount); err != nil {
			rows.Close()
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		members = append(members, map[string]any{
			"id": id, "name": name, "phone": displayPhone(phone), "email": email,
			"memberType": memberType, "active": active, "linked": linked,
			"createdAt": createdAt, "updatedAt": updatedAt, "playerCount": playerCount,
			"bookingCount": bookingCount, "paymentCount": paymentCount, "approvedAmountThb": approvedAmount,
		})
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	bookings := make([]map[string]any, 0)
	rows, err = a.db.QueryContext(r.Context(), `
		select b.id,coalesce(b.booking_batch_id,''),coalesce(b.member_id,''),coalesce(m.name,b.booker_name),
			coalesce(m.phone,''),coalesce(nullif(m.contact_email,''),u.email,''),c.name,b.booked_by,
			to_char(b.start_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),
			to_char(b.end_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),
			b.interval_minutes,b.unit_price_thb,b.total_price_thb,b.status,b.payment_status,b.note,
			to_char(b.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI')
		from bookings b
		join booking_courts c on c.id=b.court_id and c.admin_id=b.admin_id
		left join members m on m.id=b.member_id and m.admin_id=b.admin_id
		left join public_users u on u.id=m.public_user_id
		where b.admin_id=$1
		order by b.start_at desc,b.created_at desc`, adminID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	for rows.Next() {
		var id, batchID, memberID, name, phone, email, court, bookedBy, startAt, endAt, status, paymentStatus, note, createdAt string
		var interval, unitPrice, totalPrice int
		if err = rows.Scan(&id, &batchID, &memberID, &name, &phone, &email, &court, &bookedBy, &startAt, &endAt, &interval, &unitPrice, &totalPrice, &status, &paymentStatus, &note, &createdAt); err != nil {
			rows.Close()
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		bookings = append(bookings, map[string]any{
			"id": id, "batchId": batchID, "memberId": memberID, "memberName": name,
			"phone": displayPhone(phone), "email": email, "courtName": court, "bookedBy": bookedBy,
			"startAt": startAt, "endAt": endAt, "intervalMinutes": interval,
			"unitPriceThb": unitPrice, "totalPriceThb": totalPrice, "status": status,
			"paymentStatus": paymentStatus, "note": note, "createdAt": createdAt,
		})
	}
	rows.Close()

	payments := make([]map[string]any, 0)
	rows, err = a.db.QueryContext(r.Context(), `
		select kind,reference_id,coalesce(member_id,''),member_name,phone,email,amount_thb,status,note,reviewed_by,created_at,reviewed_at
		from (
			select 'booking' as kind,bp.booking_id as reference_id,bp.member_id,
				coalesce(m.name,b.booker_name) as member_name,coalesce(m.phone,'') as phone,
				coalesce(nullif(m.contact_email,''),u.email,'') as email,bp.amount_thb,bp.status,bp.note,bp.reviewed_by,
				to_char(bp.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') as created_at,
				coalesce(to_char(bp.reviewed_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),'') as reviewed_at,
				bp.created_at as sort_at
			from booking_payments bp
			join bookings b on b.id=bp.booking_id
			left join members m on m.id=bp.member_id and m.admin_id=b.admin_id
			left join public_users u on u.id=m.public_user_id
			where b.admin_id=$1
			union all
			select 'match',e.session_id,e.member_id,coalesce(m.name,p.name),coalesce(m.phone,''),
				coalesce(nullif(m.contact_email,''),u.email,''),e.amount_thb,
				case when e.paid then 'paid' else 'unpaid' end,'',e.actor_id,
				to_char(e.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),'',
				e.created_at
			from player_payment_events e
			join sessions s on s.id=e.session_id
			left join players p on p.session_id=e.session_id and p.id=e.player_id
			left join members m on m.id=e.member_id and m.admin_id=s.admin_id
			left join public_users u on u.id=m.public_user_id
			where s.admin_id=$1
		) events
		order by sort_at desc`, adminID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	for rows.Next() {
		var kind, referenceID, memberID, name, phone, email, status, note, reviewedBy, createdAt, reviewedAt string
		var amount int
		if err = rows.Scan(&kind, &referenceID, &memberID, &name, &phone, &email, &amount, &status, &note, &reviewedBy, &createdAt, &reviewedAt); err != nil {
			rows.Close()
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		payments = append(payments, map[string]any{
			"kind": kind, "referenceId": referenceID, "memberId": memberID, "memberName": name,
			"phone": displayPhone(phone), "email": email, "amountThb": amount, "status": status,
			"note": note, "reviewedBy": reviewedBy, "createdAt": createdAt, "reviewedAt": reviewedAt,
		})
	}
	rows.Close()

	matches := make([]map[string]any, 0)
	rows, err = a.db.QueryContext(r.Context(), `
		select p.name,coalesce(p.member_id,''),coalesce(mem.name,p.name),coalesce(mem.phone,''),
			s.id,s.name,mt.id,mt.court,mt.started_at,mt.ended_at,mt.status,mt.winner,p.games,p.wins,p.draws,p.losses,p.paid
		from players p
		join sessions s on s.id=p.session_id
		join matches mt on mt.session_id=p.session_id and p.id in (mt.a1,mt.a2,mt.b1,mt.b2)
		left join members mem on mem.id=p.member_id and mem.admin_id=s.admin_id
		where s.admin_id=$1 and mt.phase='history'
		order by s.updated_at desc,mt.id desc,p.id`, adminID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	for rows.Next() {
		var playerName, memberID, memberName, phone, sessionID, sessionName, court, startedAt, endedAt, status, winner string
		var matchID, games, wins, draws, losses int
		var paid bool
		if err = rows.Scan(&playerName, &memberID, &memberName, &phone, &sessionID, &sessionName, &matchID, &court, &startedAt, &endedAt, &status, &winner, &games, &wins, &draws, &losses, &paid); err != nil {
			rows.Close()
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		matches = append(matches, map[string]any{
			"memberId": memberID, "memberName": memberName, "phone": displayPhone(phone),
			"playerName": playerName, "sessionId": sessionID, "sessionName": sessionName,
			"matchId": matchID, "court": court, "startedAt": startedAt, "endedAt": endedAt,
			"status": status, "winner": winner, "games": games, "wins": wins,
			"draws": draws, "losses": losses, "paid": paid,
		})
	}
	rows.Close()

	a.insertActivityLog(r.Context(), "admin", adminID, "export_members", "member", "", map[string]any{"memberCount": len(members)})
	writeJSON(w, http.StatusOK, map[string]any{
		"generatedAt": time.Now().In(bangkokLocation).Format(time.RFC3339),
		"members":     members, "bookings": bookings, "payments": payments, "matches": matches,
	})
}

func (a *app) writeAdminMemberDetail(w http.ResponseWriter, r *http.Request, adminID, memberID string) {
	bookingPage, pageSize := requestPage(r, "bookingPage", "pageSize", 6, 50)
	paymentPage, _ := requestPage(r, "paymentPage", "pageSize", 6, 50)
	matchPage, _ := requestPage(r, "matchPage", "pageSize", 6, 50)
	var m memberRecord
	var phone string
	if err := a.db.QueryRowContext(r.Context(), `select m.id,m.name,m.phone,coalesce(nullif(m.contact_email,''),u.email,''),m.member_type,m.active,m.public_user_id is not null,to_char(m.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from members m left join public_users u on u.id=m.public_user_id where m.id=$1 and m.admin_id=$2 and m.deleted_at is null`, memberID, adminID).Scan(&m.ID, &m.Name, &phone, &m.Email, &m.MemberType, &m.Active, &m.Linked, &m.CreatedAt); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "member not found"})
		return
	}
	m.Phone = displayPhone(phone)

	var bookingTotal, paymentTotal, matchTotal int
	_ = a.db.QueryRowContext(r.Context(), `select count(*) from bookings where member_id=$1 and admin_id=$2`, memberID, adminID).Scan(&bookingTotal)
	bookings := []bookingRecord{}
	rows, _ := a.db.QueryContext(r.Context(), `select b.id,b.court_id,c.name,b.booker_name,b.booked_by,b.start_at,b.end_at,b.interval_minutes,b.unit_price_thb,b.total_price_thb,b.status,b.payment_status,b.hold_expires_at,b.note,to_char(b.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from bookings b join booking_courts c on c.id=b.court_id where b.member_id=$1 and b.admin_id=$2 order by b.start_at desc limit $3 offset $4`, memberID, adminID, pageSize, (bookingPage-1)*pageSize)
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
	_ = a.db.QueryRowContext(r.Context(), `select (select count(*) from booking_payments p join bookings b on b.id=p.booking_id where p.member_id=$1 and b.admin_id=$2)+(select count(*) from player_payment_events e join sessions s on s.id=e.session_id where e.member_id=$1 and s.admin_id=$2)+(select count(*) from pos_sales ps join billing_accounts ba on ba.id=ps.billing_account_id where ba.member_id=$1 and ps.admin_id=$2)`, memberID, adminID).Scan(&paymentTotal)
	paymentRows, _ := a.db.QueryContext(r.Context(), `select kind,id,amount_thb,status,created_at,session_name from (select 'booking' as kind,p.id,p.amount_thb,p.status,to_char(p.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') as created_at,'' as session_name from booking_payments p join bookings b on b.id=p.booking_id where p.member_id=$1 and b.admin_id=$2 union all select 'match',e.id::text,e.amount_thb,case when e.paid then 'paid' else 'unpaid' end,to_char(e.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),s.name from player_payment_events e join sessions s on s.id=e.session_id where e.member_id=$1 and s.admin_id=$2 union all select 'pos',ps.id,ps.total_thb,ps.status,to_char(ps.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),'' from pos_sales ps join billing_accounts ba on ba.id=ps.billing_account_id where ba.member_id=$1 and ps.admin_id=$2) events order by created_at desc, id desc limit $3 offset $4`, memberID, adminID, pageSize, (paymentPage-1)*pageSize)
	if paymentRows != nil {
		defer paymentRows.Close()
		for paymentRows.Next() {
			var kind, id, status, created, sessionName string
			var amount int
			if paymentRows.Scan(&kind, &id, &amount, &status, &created, &sessionName) == nil {
				payments = append(payments, map[string]any{"kind": kind, "id": id, "amountThb": amount, "status": status, "createdAt": created, "sessionName": sessionName})
			}
		}
	}

	matches := []map[string]any{}
	_ = a.db.QueryRowContext(r.Context(), `select count(*) from players p join sessions s on s.id=p.session_id join matches mt on mt.session_id=p.session_id and p.id in (mt.a1,mt.a2,mt.b1,mt.b2) where p.member_id=$1 and s.admin_id=$2 and mt.phase='history'`, memberID, adminID).Scan(&matchTotal)
	matchRows, _ := a.db.QueryContext(r.Context(), `select s.name,mt.id,mt.court,mt.started_at,mt.ended_at,mt.status,mt.winner,p.id from players p join sessions s on s.id=p.session_id join matches mt on mt.session_id=p.session_id and p.id in (mt.a1,mt.a2,mt.b1,mt.b2) where p.member_id=$1 and s.admin_id=$2 and mt.phase='history' order by s.updated_at desc,mt.id desc limit $3 offset $4`, memberID, adminID, pageSize, (matchPage-1)*pageSize)
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
	playerRows, _ := a.db.QueryContext(r.Context(), `select p.id,s.id,s.name,p.name,p.games,p.wins,p.draws,p.losses,p.paid,p.active from players p join sessions s on s.id=p.session_id where p.member_id=$1 and s.admin_id=$2 order by s.updated_at desc limit 100`, memberID, adminID)
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

	writeJSON(w, http.StatusOK, map[string]any{
		"member": m, "bookings": bookings, "payments": payments, "matches": matches, "players": players,
		"pagination": map[string]any{
			"bookings": pageMeta(bookingPage, pageSize, bookingTotal),
			"payments": pageMeta(paymentPage, pageSize, paymentTotal),
			"matches":  pageMeta(matchPage, pageSize, matchTotal),
		},
	})
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
	var tokenHash, botToken, webhookID, secretHash, acceptanceOpen, acceptanceClose, slipKey string
	err := a.db.QueryRowContext(ctx, `select public_token_hash,public_token,to_char(open_time,'HH24:MI'),to_char(close_time,'HH24:MI'),interval_minutes,allow_overnight,use_same_price,promptpay_type,promptpay_id,promptpay_receiver_name,logo_data,telegram_bot_token,telegram_chat_id,telegram_webhook_id,telegram_secret_hash,booking_acceptance_enabled,coalesce(to_char(booking_acceptance_open_time,'HH24:MI'),''),coalesce(to_char(booking_acceptance_close_time,'HH24:MI'),''),single_slot_purchase_enabled,popup_enabled,popup_image,popup_revision,slipok_enabled,slipok_branch_id,slipok_api_key,slipok_monthly_cap from booking_settings where admin_id=$1`, adminID).Scan(&tokenHash, &s.PublicToken, &open, &close, &s.IntervalMinutes, &s.AllowOvernight, &s.UseSamePrice, &s.PromptPayType, &s.PromptPayID, &s.PromptPayReceiverName, &s.LogoData, &botToken, &s.TelegramChatID, &webhookID, &secretHash, &s.BookingAcceptanceEnabled, &acceptanceOpen, &acceptanceClose, &s.SingleSlotPurchaseEnabled, &s.PopupEnabled, &s.PopupImage, &s.PopupRevision, &s.SlipOKEnabled, &s.SlipOKBranchID, &slipKey, &s.SlipOKMonthlyCap)
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
	s.BookingAcceptanceOpenTime = acceptanceOpen
	s.BookingAcceptanceCloseTime = acceptanceClose
	if slipKey != "" {
		if plain, decryptErr := decryptSecret(slipKey); decryptErr == nil {
			s.SlipOKAPIKeyMasked = maskSecret(plain)
		}
	}
	s.TelegramConfigured = botToken != "" && s.TelegramChatID != ""
	if webhookID != "" {
		s.TelegramWebhookURL = strings.TrimRight(os.Getenv("APP_BASE_URL"), "/") + "/api/booking-telegram/webhook/" + webhookID
	}
	return s, nil
}

func (a *app) bookingSlipOKSettings(ctx context.Context, adminID string) slipOKSettings {
	var enabled bool
	var branchID, encrypted string
	var monthlyCap int
	if a.db.QueryRowContext(ctx, `select slipok_enabled,slipok_branch_id,slipok_api_key,slipok_monthly_cap from booking_settings where admin_id=$1`, adminID).Scan(&enabled, &branchID, &encrypted, &monthlyCap) != nil {
		return slipOKSettings{}
	}
	apiKey := ""
	if encrypted != "" {
		apiKey, _ = decryptSecret(encrypted)
	}
	return slipOKSettings{Enabled: enabled, BranchID: normalizeSlipOKBranchID(branchID), APIKey: strings.TrimSpace(apiKey), MonthlyCap: max(0, monthlyCap)}
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
	case r.Method == http.MethodGet && path == "/export":
		a.writeBookingExport(w, r, user.ID)
	case r.Method == http.MethodPut && path == "/settings":
		a.saveBookingSettings(w, r, user)
	case r.Method == http.MethodPost && path == "/telegram-check":
		a.checkBookingTelegram(w, r, user)
	case r.Method == http.MethodGet && path == "/slipok-quota":
		writeJSON(w, http.StatusOK, a.fetchSlipOKQuota(r.Context(), a.bookingSlipOKSettings(r.Context(), user.ID)))
	case r.Method == http.MethodGet && path == "/blacklist":
		a.writeBookingIncidents(w, r, user.ID)
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
	page, pageSize := requestPage(r, "page", "pageSize", 20, 100)
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
	var total int
	if err = a.db.QueryRowContext(r.Context(), `
		select count(distinct coalesce(nullif(b.booking_batch_id,''),b.id))
		from bookings b
		left join members m on m.id=b.member_id and m.admin_id=b.admin_id
		where b.admin_id=$1 and b.start_at >= $2 and b.start_at < $3
			and ($4='' or b.court_id=$4)
			and ($5='' or regexp_replace(coalesce(m.phone,''),'[^0-9]','','g') like '%' || $5 || '%')`,
		adminID, start, end.AddDate(0, 0, 1), courtID, phone).Scan(&total); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	rows, err := a.db.QueryContext(r.Context(), `
		with filtered as (
			select b.*,c.name as court_name,coalesce(m.phone,'') as member_phone,
				coalesce(nullif(b.booking_batch_id,''),b.id) as group_id
			from bookings b
			join booking_courts c on c.id=b.court_id and c.admin_id=b.admin_id
			left join members m on m.id=b.member_id and m.admin_id=b.admin_id
			where b.admin_id=$1 and b.start_at >= $2 and b.start_at < $3
				and ($4='' or b.court_id=$4)
				and ($5='' or regexp_replace(coalesce(m.phone,''),'[^0-9]','','g') like '%' || $5 || '%')
		)
		select group_id,min(court_id),string_agg(distinct court_name,', ' order by court_name),
			min(coalesce(member_id,'')),min(booker_name),min(booked_by),min(start_at),max(end_at),
			min(interval_minutes),min(unit_price_thb),sum(total_price_thb),min(status),
			case when bool_and(payment_status='paid') then 'paid' when bool_or(payment_status='rejected') then 'rejected' when bool_or(payment_status='pending') then 'pending' else 'unpaid' end,
			coalesce(to_char(max(hold_expires_at),'YYYY-MM-DD"T"HH24:MI:SSOF'),''),
			coalesce(string_agg(distinct nullif(note,''),' · '),''),min(member_phone),
			to_char(max(created_at) at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),count(*),
			json_agg(json_build_object('id',id,'courtId',court_id,'courtName',court_name,'startAt',start_at,'endAt',end_at,'totalPriceThb',total_price_thb) order by start_at,court_name)::text
		from filtered
		group by group_id
		order by min(start_at) desc,max(created_at) desc limit $6 offset $7`,
		adminID, start, end.AddDate(0, 0, 1), courtID, phone, pageSize, (page-1)*pageSize)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var rec bookingRecord
		var startAt, endAt time.Time
		var phoneValue, detailsText string
		var bookingCount int
		if err = rows.Scan(&rec.ID, &rec.CourtID, &rec.CourtName, &rec.MemberID, &rec.BookerName, &rec.BookedBy, &startAt, &endAt, &rec.Interval, &rec.UnitPrice, &rec.TotalPrice, &rec.Status, &rec.PaymentStatus, &rec.HoldExpiresAt, &rec.Note, &phoneValue, &rec.CreatedAt, &bookingCount, &detailsText); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		items = append(items, map[string]any{
			"id": rec.ID, "courtId": rec.CourtID, "courtName": rec.CourtName,
			"memberId": rec.MemberID, "bookerName": rec.BookerName, "bookedBy": rec.BookedBy,
			"phone": displayPhone(phoneValue), "startAt": startAt.Format(time.RFC3339), "endAt": endAt.Format(time.RFC3339),
			"intervalMinutes": rec.Interval, "unitPriceThb": rec.UnitPrice, "totalPriceThb": rec.TotalPrice,
			"status": rec.Status, "paymentStatus": rec.PaymentStatus, "note": rec.Note, "createdAt": rec.CreatedAt,
			"batchId": rec.ID, "bookingCount": bookingCount, "items": json.RawMessage(detailsText),
		})
	}
	if err = rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items, "startDate": startText, "endDate": endText,
		"page": page, "pageSize": pageSize, "total": total,
	})
}

func (a *app) writeBookingIncidents(w http.ResponseWriter, r *http.Request, adminID string) {
	page, pageSize := requestPage(r, "page", "pageSize", 20, 100)
	search := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("search")))
	like := "%" + search + "%"
	incidentType := strings.TrimSpace(r.URL.Query().Get("type"))
	if incidentType != "duplicate" && incidentType != "verification_failed" {
		incidentType = ""
	}
	var total int
	if err := a.db.QueryRowContext(r.Context(), `select count(*) from booking_security_incidents i left join members m on m.id=i.member_id where i.admin_id=$1 and ($2='' or i.incident_type=$2) and ($3='' or lower(coalesce(m.name,'')) like $4 or lower(coalesce(m.phone,'')) like $4 or lower(i.trans_ref) like $4)`, adminID, incidentType, search, like).Scan(&total); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	rows, err := a.db.QueryContext(r.Context(), `
		select i.id,i.incident_type,i.trans_ref,i.reason,i.booking_id,coalesce(i.payment_id,''),
			coalesce(m.name,''),coalesce(m.phone,''),to_char(i.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),
			coalesce(dm.name,''),coalesce(dm.phone,''),coalesce(to_char(sr.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),''),
			coalesce(sr.payment_id,'')
		from booking_security_incidents i
		left join members m on m.id=i.member_id
		left join booking_slip_refs sr on sr.admin_id=i.admin_id and sr.payment_id=i.duplicate_payment_id
		left join members dm on dm.id=sr.member_id
		where i.admin_id=$1 and ($2='' or i.incident_type=$2)
			and ($3='' or lower(coalesce(m.name,'')) like $4 or lower(coalesce(m.phone,'')) like $4 or lower(i.trans_ref) like $4)
		order by i.created_at desc limit $5 offset $6`, adminID, incidentType, search, like, pageSize, (page-1)*pageSize)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id int64
		var kind, transRef, reason, bookingID, paymentID, name, phone, createdAt, duplicateName, duplicatePhone, duplicateAt, duplicatePaymentID string
		if err = rows.Scan(&id, &kind, &transRef, &reason, &bookingID, &paymentID, &name, &phone, &createdAt, &duplicateName, &duplicatePhone, &duplicateAt, &duplicatePaymentID); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		items = append(items, map[string]any{"id": id, "type": kind, "transRef": transRef, "reason": reason, "bookingId": bookingID, "paymentId": paymentID, "memberName": name, "phone": displayPhone(phone), "createdAt": createdAt, "duplicateMemberName": duplicateName, "duplicatePhone": displayPhone(duplicatePhone), "duplicateAt": duplicateAt, "duplicatePaymentId": duplicatePaymentID})
	}
	totalPages := max(1, (total+pageSize-1)/pageSize)
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "page": page, "pageSize": pageSize, "total": total, "totalPages": totalPages})
}

func bookingExportDateRange(r *http.Request) (time.Time, time.Time, string, string, error) {
	today := time.Now().In(bangkokLocation).Format("2006-01-02")
	startText := strings.TrimSpace(r.URL.Query().Get("startDate"))
	endText := strings.TrimSpace(r.URL.Query().Get("endDate"))
	if startText == "" {
		startText = today
	}
	if endText == "" {
		endText = today
	}
	start, err := time.ParseInLocation("2006-01-02", startText, bangkokLocation)
	if err != nil {
		return time.Time{}, time.Time{}, "", "", errors.New("invalid start date")
	}
	end, err := time.ParseInLocation("2006-01-02", endText, bangkokLocation)
	if err != nil || end.Before(start) || end.Sub(start) > 366*24*time.Hour {
		return time.Time{}, time.Time{}, "", "", errors.New("invalid date range")
	}
	return start, end.AddDate(0, 0, 1), startText, endText, nil
}

func validBookingExportStatus(status string) bool {
	switch status {
	case "", "all", "hold", "pending_review", "confirmed", "rejected", "cancelled", "expired":
		return true
	default:
		return false
	}
}

func (a *app) writeBookingExport(w http.ResponseWriter, r *http.Request, adminID string) {
	start, endExclusive, startText, endText, err := bookingExportDateRange(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status == "" {
		status = "all"
	}
	if !validBookingExportStatus(status) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid booking status"})
		return
	}

	// Deliberately do not select booking_payments.slip_data. Export responses must
	// contain payment metadata only, never the uploaded receipt image.
	rows, err := a.db.QueryContext(r.Context(), `
		select b.id,coalesce(b.booking_batch_id,''),coalesce(b.member_id,''),
			coalesce(m.name,b.booker_name),coalesce(m.phone,''),
			coalesce(nullif(m.contact_email,''),u.email,''),b.booked_by,c.id,c.name,
			to_char(b.start_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),
			to_char(b.end_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),
			b.interval_minutes,b.unit_price_thb,b.total_price_thb,b.status,b.payment_status,b.note,
			to_char(b.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),
			to_char(b.updated_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),
			coalesce(pay.id,''),coalesce(pay.amount_thb,0),coalesce(pay.status,''),
			coalesce(pay.note,''),coalesce(pay.reviewed_by,''),
			coalesce(to_char(pay.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),''),
			coalesce(to_char(pay.reviewed_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),'')
		from bookings b
		join booking_courts c on c.id=b.court_id and c.admin_id=b.admin_id
		left join members m on m.id=b.member_id and m.admin_id=b.admin_id
		left join public_users u on u.id=m.public_user_id
		left join lateral (
			select bp.id,bp.amount_thb,bp.status,bp.note,bp.reviewed_by,bp.created_at,bp.reviewed_at
			from booking_payments bp
			join bookings paid_booking on paid_booking.id=bp.booking_id and paid_booking.admin_id=b.admin_id
			where bp.booking_id=b.id
				or (b.booking_batch_id is not null and paid_booking.booking_batch_id=b.booking_batch_id)
			order by bp.created_at desc
			limit 1
		) pay on true
		where b.admin_id=$1 and b.start_at >= $2 and b.start_at < $3
			and ($4='all' or b.status=$4)
		order by b.start_at,c.sort_order,b.created_at`, adminID, start, endExclusive, status)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()

	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, batchID, memberID, name, phone, email, bookedBy, courtID, courtName string
		var startAt, endAt, bookingStatus, paymentStatus, note, createdAt, updatedAt string
		var paymentID, paymentReviewStatus, paymentNote, reviewedBy, transferredAt, approvedAt string
		var interval, unitPrice, totalPrice, paymentAmount int
		if err = rows.Scan(
			&id, &batchID, &memberID, &name, &phone, &email, &bookedBy, &courtID, &courtName,
			&startAt, &endAt, &interval, &unitPrice, &totalPrice, &bookingStatus, &paymentStatus,
			&note, &createdAt, &updatedAt, &paymentID, &paymentAmount, &paymentReviewStatus,
			&paymentNote, &reviewedBy, &transferredAt, &approvedAt,
		); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		items = append(items, map[string]any{
			"bookingId": id, "batchId": batchID, "memberId": memberID, "bookerName": name,
			"phone": displayPhone(phone), "email": email, "bookedBy": bookedBy,
			"courtId": courtID, "courtName": courtName, "startAt": startAt, "endAt": endAt,
			"intervalMinutes": interval, "unitPriceThb": unitPrice, "totalPriceThb": totalPrice,
			"bookingStatus": bookingStatus, "paymentStatus": paymentStatus, "bookingNote": note,
			"bookingCreatedAt": createdAt, "bookingUpdatedAt": updatedAt,
			"paymentId": paymentID, "paymentAmountThb": paymentAmount,
			"paymentReviewStatus": paymentReviewStatus, "paymentNote": paymentNote,
			"reviewedBy": reviewedBy, "transferredAt": transferredAt, "approvedAt": approvedAt,
		})
	}
	if err = rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	incidents := []map[string]any{}
	incidentRows, _ := a.db.QueryContext(r.Context(), `select i.incident_type,i.trans_ref,i.reason,i.booking_id,coalesce(m.name,''),coalesce(m.phone,''),to_char(i.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),coalesce(dm.name,''),coalesce(to_char(sr.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),'') from booking_security_incidents i left join members m on m.id=i.member_id left join booking_slip_refs sr on sr.admin_id=i.admin_id and sr.payment_id=i.duplicate_payment_id left join members dm on dm.id=sr.member_id where i.admin_id=$1 and i.created_at >= $2 and i.created_at < $3 order by i.created_at desc`, adminID, start, endExclusive)
	if incidentRows != nil {
		defer incidentRows.Close()
		for incidentRows.Next() {
			var kind, transRef, reason, bookingID, name, phone, createdAt, duplicateName, duplicateAt string
			if incidentRows.Scan(&kind, &transRef, &reason, &bookingID, &name, &phone, &createdAt, &duplicateName, &duplicateAt) == nil {
				incidents = append(incidents, map[string]any{"type": kind, "transRef": transRef, "reason": reason, "bookingId": bookingID, "memberName": name, "phone": displayPhone(phone), "createdAt": createdAt, "duplicateMemberName": duplicateName, "duplicateAt": duplicateAt})
			}
		}
	}
	a.insertActivityLog(r.Context(), "admin", adminID, "export_bookings", "booking", "", map[string]any{
		"startDate": startText, "endDate": endText, "status": status, "count": len(items),
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"generatedAt": time.Now().In(bangkokLocation).Format(time.RFC3339),
		"startDate":   startText, "endDate": endText, "status": status, "items": items, "incidents": incidents,
	})
}

func (a *app) saveBookingSettings(w http.ResponseWriter, r *http.Request, user adminUser) {
	current, err := a.ensureBookingSettings(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	var b struct {
		OpenTime, CloseTime                                                                                            string
		IntervalMinutes                                                                                                int
		AllowOvernight, UseSamePrice, BookingAcceptanceEnabled, SingleSlotPurchaseEnabled, PopupEnabled, SlipOKEnabled bool
		PromptPayType, PromptPayID, PromptPayReceiverName, LogoData, TelegramBotToken, TelegramChatID                  string
		BookingAcceptanceOpenTime, BookingAcceptanceCloseTime, PopupImage, PopupRevision                               string
		SlipOKBranchID, SlipOKAPIKey                                                                                   string
		SlipOKMonthlyCap                                                                                               int
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 6<<20)).Decode(&b) != nil {
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
	if b.BookingAcceptanceEnabled {
		if _, parseErr := time.Parse("15:04", b.BookingAcceptanceOpenTime); parseErr != nil {
			writeJSON(w, 400, map[string]string{"error": "กรุณากรอกเวลาเปิดรับการจองให้ถูกต้อง"})
			return
		}
		if _, parseErr := time.Parse("15:04", b.BookingAcceptanceCloseTime); parseErr != nil {
			writeJSON(w, 400, map[string]string{"error": "กรุณากรอกเวลาปิดรับการจองให้ถูกต้อง"})
			return
		}
	}
	if len(b.PopupImage) > 2_800_000 || !validImageData(b.PopupImage, true) {
		writeJSON(w, 400, map[string]string{"error": "รูป Popup ต้องเป็น PNG/JPEG/WebP ไม่เกิน 2 MB"})
		return
	}
	if b.PopupEnabled && b.PopupImage == "" {
		writeJSON(w, 400, map[string]string{"error": "กรุณาอัปโหลดรูป Popup ก่อนเปิดใช้งาน"})
		return
	}
	currentSlipOK := a.bookingSlipOKSettings(r.Context(), user.ID)
	slipOKAPIKey := strings.TrimSpace(b.SlipOKAPIKey)
	if slipOKAPIKey == "" {
		slipOKAPIKey = currentSlipOK.APIKey
	}
	if b.SlipOKMonthlyCap < 0 || (b.SlipOKEnabled && (normalizeSlipOKBranchID(b.SlipOKBranchID) == "" || slipOKAPIKey == "" || b.SlipOKMonthlyCap <= 0)) {
		writeJSON(w, 400, map[string]string{"error": "เปิด Auto Slip ต้องกรอก Branch ID, API Key และ Monthly cap"})
		return
	}
	slipOKEncrypted := ""
	if slipOKAPIKey != "" {
		slipOKEncrypted, err = encryptSecret(slipOKAPIKey)
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
	}
	popupRevision := current.PopupRevision
	if b.PopupImage != current.PopupImage || popupRevision == "" {
		popupRevision = shortHash(b.PopupImage + time.Now().String())
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
	if plainSecret != "" {
		if err = a.setAdminTelegramWebhook(r.Context(), b.TelegramBotToken, webhookID, plainSecret); err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "ตั้งค่า Telegram webhook ไม่สำเร็จ กรุณาตรวจสอบ Bot Token และลองใหม่"})
			return
		}
	}
	_, err = a.db.ExecContext(r.Context(), `update booking_settings set open_time=$2,close_time=$3,interval_minutes=$4,allow_overnight=$5,use_same_price=$6,promptpay_type=$7,promptpay_id=$8,promptpay_receiver_name=$9,logo_data=$10,telegram_bot_token=$11,telegram_chat_id=$12,telegram_webhook_id=$13,telegram_secret_hash=$14,telegram_bot_fingerprint=$15,booking_acceptance_enabled=$16,booking_acceptance_open_time=nullif($17,'')::time,booking_acceptance_close_time=nullif($18,'')::time,single_slot_purchase_enabled=$19,popup_enabled=$20,popup_image=$21,popup_revision=$22,slipok_enabled=$23,slipok_branch_id=$24,slipok_api_key=$25,slipok_monthly_cap=$26,updated_at=now() where admin_id=$1`, user.ID, b.OpenTime, b.CloseTime, b.IntervalMinutes, b.AllowOvernight, b.UseSamePrice, b.PromptPayType, strings.TrimSpace(b.PromptPayID), strings.TrimSpace(b.PromptPayReceiverName), b.LogoData, botEncrypted, strings.TrimSpace(b.TelegramChatID), webhookID, secretHash, botFingerprint, b.BookingAcceptanceEnabled, strings.TrimSpace(b.BookingAcceptanceOpenTime), strings.TrimSpace(b.BookingAcceptanceCloseTime), b.SingleSlotPurchaseEnabled, b.PopupEnabled, b.PopupImage, popupRevision, b.SlipOKEnabled, normalizeSlipOKBranchID(b.SlipOKBranchID), slipOKEncrypted, b.SlipOKMonthlyCap)
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
	a.writeBookingOverview(w, r, user.ID, true)
}

func validTelegramBotToken(token string) bool {
	token = strings.TrimSpace(token)
	if token == "" || len(token) > 256 || strings.ContainsAny(token, "/\\?#& \t\r\n") {
		return false
	}
	parts := strings.Split(token, ":")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return false
	}
	_, err := strconv.ParseInt(parts[0], 10, 64)
	return err == nil
}

func fetchTelegramUpdates(ctx context.Context, token string) (json.RawMessage, int, error) {
	if !validTelegramBotToken(token) {
		return nil, 0, errors.New("Bot Token ไม่ถูกต้อง")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(telegramAPIBaseURL, "/")+"/bot"+token+"/getUpdates", nil)
	if err != nil {
		return nil, 0, err
	}
	resp, err := (&http.Client{Timeout: 12 * time.Second}).Do(req)
	if err != nil {
		return nil, 0, errors.New("เชื่อมต่อ Telegram ไม่สำเร็จ")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil || !json.Valid(body) {
		return nil, resp.StatusCode, errors.New("Telegram ส่งข้อมูลที่อ่านไม่ได้")
	}
	return json.RawMessage(body), resp.StatusCode, nil
}

func (a *app) checkBookingTelegram(w http.ResponseWriter, r *http.Request, user adminUser) {
	var body struct {
		BotToken string `json:"botToken"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	token := strings.TrimSpace(body.BotToken)
	if token == "" {
		var encrypted string
		if err := a.db.QueryRowContext(r.Context(), `select telegram_bot_token from booking_settings where admin_id=$1`, user.ID).Scan(&encrypted); err == nil && encrypted != "" {
			token, _ = decryptSecret(encrypted)
		}
	}
	result, status, err := fetchTelegramUpdates(r.Context(), token)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	a.insertActivityLog(r.Context(), "admin", user.ID, "check_booking_telegram", "booking_settings", user.ID, map[string]any{"telegramStatus": status})
	writeJSON(w, http.StatusOK, map[string]any{"httpStatus": status, "response": result})
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
		var refs int
		if err := a.db.QueryRowContext(r.Context(), `select (select count(*) from bookings where court_id=$1 and admin_id=$2)+(select count(*) from booking_occupancies where court_id=$1 and admin_id=$2)`, id, user.ID).Scan(&refs); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		var result sql.Result
		var err error
		hardDeleted := refs == 0
		if hardDeleted {
			result, err = a.db.ExecContext(r.Context(), `delete from booking_courts where id=$1 and admin_id=$2`, id, user.ID)
		} else {
			result, err = a.db.ExecContext(r.Context(), `update booking_courts set active=false,deleted_at=now(),updated_at=now() where id=$1 and admin_id=$2`, id, user.ID)
		}
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		changed, _ := result.RowsAffected()
		if changed == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "court not found"})
			return
		}
		action := "disable_booking_court"
		if hardDeleted {
			action = "delete_booking_court"
		}
		a.insertActivityLog(r.Context(), "admin", user.ID, action, "booking_court", id, map[string]any{"hardDeleted": hardDeleted, "references": refs})
		writeJSON(w, http.StatusOK, map[string]any{"hardDeleted": hardDeleted, "active": false})
		return
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
		_, err := a.db.ExecContext(r.Context(), `update booking_courts set name=coalesce(nullif($3,''),name),price_per_interval=$4,active=$5,deleted_at=case when $5 then null else deleted_at end,updated_at=now() where id=$1 and admin_id=$2`, id, user.ID, strings.TrimSpace(b.Name), max(0, b.PricePerInterval), active)
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
	type bookingItem struct{ CourtID, StartAt, EndAt string }
	var b struct {
		CourtID, MemberID, StartAt, EndAt string
		Items                             []bookingItem `json:"items"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid booking"})
		return
	}
	if len(b.Items) == 0 && b.CourtID != "" {
		b.Items = []bookingItem{{CourtID: b.CourtID, StartAt: b.StartAt, EndAt: b.EndAt}}
	}
	if len(b.Items) == 0 || len(b.Items) > 1000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "กรุณาเลือกช่วงเวลาจอง 1-1,000 รายการ"})
		return
	}
	settings, err := a.ensureBookingSettings(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "ไม่สามารถโหลดการตั้งค่าการจองได้"})
		return
	}
	name := user.Name
	if b.MemberID != "" {
		if err = a.db.QueryRowContext(r.Context(), `select name from members where id=$1 and admin_id=$2 and active and deleted_at is null`, b.MemberID, user.ID).Scan(&name); err != nil {
			writeJSON(w, 400, map[string]string{"error": "ไม่พบสมาชิกที่เลือก"})
			return
		}
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	if err = a.deleteExpiredHoldsTx(r.Context(), tx, user.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	batchID := randUUID()
	records := make([]bookingRecord, 0, len(b.Items))
	totalAmount := 0
	for _, item := range b.Items {
		start, startErr := parseBookingTime(item.StartAt)
		end, endErr := parseBookingTime(item.EndAt)
		if startErr != nil || endErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "วันหรือเวลาที่เลือกไม่ถูกต้อง"})
			return
		}
		if err = validateAdminBookingWindow(settings, start, end); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		var court bookingCourt
		if err = tx.QueryRowContext(r.Context(), `select id,name,price_per_interval,active,sort_order from booking_courts where id=$1 and admin_id=$2 and active and deleted_at is null`, item.CourtID, user.ID).Scan(&court.ID, &court.Name, &court.Price, &court.Active, &court.Sort); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ไม่พบสนามที่เลือก"})
			return
		}
		bookingID := randUUID()
		itemTotal := int(end.Sub(start).Minutes()) / settings.IntervalMinutes * court.Price
		_, err = tx.ExecContext(r.Context(), `insert into bookings (id,admin_id,court_id,member_id,booked_by,booker_name,start_at,end_at,interval_minutes,unit_price_thb,total_price_thb,status,payment_status,booking_batch_id) values ($1,$2,$3,nullif($4,''),'admin',$5,$6,$7,$8,$9,$10,'confirmed','unpaid',$11)`, bookingID, user.ID, item.CourtID, b.MemberID, name, start, end, settings.IntervalMinutes, court.Price, itemTotal, batchID)
		if err == nil {
			_, err = tx.ExecContext(r.Context(), `insert into booking_occupancies (admin_id,court_id,booking_id,kind,occupied_range) values ($1,$2,$3,'booking',tstzrange($4,$5,'[)'))`, user.ID, item.CourtID, bookingID, start, end)
		}
		if err != nil {
			if strings.Contains(err.Error(), "booking_occupancies_no_overlap") {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "มีบางช่วงเวลาที่ไม่ว่างแล้ว กรุณาเลือกใหม่"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		records = append(records, bookingRecord{ID: bookingID, CourtID: court.ID, CourtName: court.Name, MemberID: b.MemberID, BookerName: name, BookedBy: "admin", StartAt: start.Format(time.RFC3339), EndAt: end.Format(time.RFC3339), Interval: settings.IntervalMinutes, UnitPrice: court.Price, TotalPrice: itemTotal, Status: "confirmed", PaymentStatus: "unpaid"})
		totalAmount += itemTotal
	}
	if err = a.insertActivityLogTx(r.Context(), tx, "admin", user.ID, "create_admin_booking_batch", "booking_batch", batchID, map[string]any{"memberId": b.MemberID, "items": len(records), "total": totalAmount}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"batchId": batchID, "bookings": records, "totalPriceThb": totalAmount})
}

func validateAdminBookingWindow(s bookingSettingsRecord, start, end time.Time) error {
	if start.Before(time.Now().Add(-time.Minute)) {
		return errors.New("ไม่สามารถจองเวลาที่ผ่านไปแล้ว")
	}
	duration := end.Sub(start)
	if duration <= 0 || int(duration.Minutes())%s.IntervalMinutes != 0 {
		return errors.New("ช่วงเวลาไม่ถูกต้อง")
	}
	startDate := start.In(bangkokLocation).Format("2006-01-02")
	endDate := end.Add(-time.Second).In(bangkokLocation).Format("2006-01-02")
	if startDate != endDate {
		return nil
	}
	return validateBookingWindow(s, start, end)
}

func validateBookingWindow(s bookingSettingsRecord, start, end time.Time) error {
	return validateBookingWindowAt(s, start, end, time.Now())
}

func validateBookingWindowAt(s bookingSettingsRecord, start, end, now time.Time) error {
	if start.Before(now.Add(-time.Minute)) {
		return errors.New("ไม่สามารถจองเวลาที่ผ่านไปแล้ว")
	}
	duration := end.Sub(start)
	if duration <= 0 || int(duration.Minutes())%s.IntervalMinutes != 0 {
		return errors.New("ช่วงเวลาไม่ถูกต้อง")
	}
	if !s.AllowOvernight && start.In(bangkokLocation).Format("2006-01-02") != end.Add(-time.Second).In(bangkokLocation).Format("2006-01-02") {
		return errors.New("ยังไม่เปิดการจองข้ามวัน")
	}
	openParts, closeParts := strings.Split(s.OpenTime, ":"), strings.Split(s.CloseTime, ":")
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
	if start.Before(anchor) || end.After(closeAt) || int(start.Sub(anchor).Minutes())%s.IntervalMinutes != 0 {
		return errors.New("ช่วงจองอยู่นอกเวลาเปิดให้บริการ")
	}
	return nil
}

func (a *app) createClosure(w http.ResponseWriter, r *http.Request, user adminUser) {
	type closureItem struct{ CourtID, StartAt, EndAt string }
	var b struct {
		CourtID, StartAt, EndAt, Note string
		CourtIDs                      []string      `json:"courtIds"`
		Items                         []closureItem `json:"items"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid closure"})
		return
	}
	settings, err := a.ensureBookingSettings(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "cannot load booking settings"})
		return
	}
	type closureTarget struct {
		CourtID    string
		Start, End time.Time
	}
	targets := make([]closureTarget, 0)
	if len(b.Items) > 1000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "เลือกปิดได้ไม่เกิน 1,000 ช่วงต่อครั้ง"})
		return
	}
	if len(b.Items) > 0 {
		for _, item := range b.Items {
			start, startErr := parseBookingTime(item.StartAt)
			end, endErr := parseBookingTime(item.EndAt)
			if startErr != nil || endErr != nil || !end.After(start) || int(end.Sub(start).Minutes())%settings.IntervalMinutes != 0 {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ช่วงเวลาปิดสนามไม่ถูกต้อง"})
				return
			}
			targets = append(targets, closureTarget{CourtID: item.CourtID, Start: start, End: end})
		}
	} else {
		start, startErr := parseBookingTime(b.StartAt)
		end, endErr := parseBookingTime(b.EndAt)
		if startErr != nil || endErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ช่วงเวลาปิดสนามไม่ถูกต้อง"})
			return
		}
		occurrences, occurrenceErr := closureOccurrences(start, end, settings.IntervalMinutes)
		if occurrenceErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ช่วงเวลาปิดสนามไม่ถูกต้อง"})
			return
		}
		courtIDs := append([]string(nil), b.CourtIDs...)
		if len(courtIDs) == 0 && b.CourtID != "" {
			courtIDs = append(courtIDs, b.CourtID)
		}
		uniqueCourtIDs := make([]string, 0, len(courtIDs))
		seenCourtIDs := make(map[string]bool, len(courtIDs))
		for _, courtID := range courtIDs {
			courtID = strings.TrimSpace(courtID)
			if courtID != "" && !seenCourtIDs[courtID] {
				seenCourtIDs[courtID] = true
				uniqueCourtIDs = append(uniqueCourtIDs, courtID)
			}
		}
		if len(uniqueCourtIDs) == 0 || len(uniqueCourtIDs) > 48 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "กรุณาเลือกสนาม 1-48 สนาม"})
			return
		}
		for _, courtID := range uniqueCourtIDs {
			for _, occurrence := range occurrences {
				targets = append(targets, closureTarget{CourtID: courtID, Start: occurrence.Start, End: occurrence.End})
			}
		}
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	if err = a.deleteExpiredHoldsTx(r.Context(), tx, user.ID); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	for _, target := range targets {
		var courtExists bool
		if err = tx.QueryRowContext(r.Context(), `select exists(select 1 from booking_courts where id=$1 and admin_id=$2 and active and deleted_at is null)`, target.CourtID, user.ID).Scan(&courtExists); err != nil || !courtExists {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ไม่พบสนามที่เลือก"})
			return
		}
		_, err = tx.ExecContext(r.Context(), `insert into booking_occupancies (admin_id,court_id,kind,occupied_range,note) values ($1,$2,'closure',tstzrange($3,$4,'[)'),$5)`, user.ID, target.CourtID, target.Start, target.End, strings.TrimSpace(b.Note))
		if err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "มีรายการจองหรือปิดสนามทับซ้อนในช่วงวันที่เลือก"})
			return
		}
	}
	activityCourtID := b.CourtID
	if activityCourtID == "" && len(targets) > 0 {
		activityCourtID = targets[0].CourtID
	}
	if err = a.insertActivityLogTx(r.Context(), tx, "admin", user.ID, "close_booking_slots", "booking_court", activityCourtID, map[string]any{"slots": len(targets)}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 201, map[string]any{"status": "closed", "occurrences": len(targets)})
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
	dayEnd := dayStart.Add(48 * time.Hour)
	rows, err := a.db.QueryContext(r.Context(), `select b.id,coalesce(b.booking_batch_id,''),b.court_id,c.name,coalesce(b.member_id,''),case when $4 then b.booker_name else '' end,b.booked_by,b.start_at,b.end_at,b.interval_minutes,b.unit_price_thb,b.total_price_thb,b.status,b.payment_status,b.hold_expires_at,case when $4 then b.note else '' end,case when $4 then coalesce((select p.slip_data from booking_payments p join bookings paid_booking on paid_booking.id=p.booking_id where p.booking_id=b.id or (b.booking_batch_id is not null and paid_booking.booking_batch_id=b.booking_batch_id) order by p.created_at desc limit 1),'') else '' end,to_char(b.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from bookings b join booking_courts c on c.id=b.court_id where b.admin_id=$1 and b.start_at<$3 and b.end_at>$2 and b.status<>'expired' and ($4 or b.status in ('hold','pending_review','confirmed')) order by b.start_at,c.sort_order`, adminID, dayStart, dayEnd, admin)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	bookings, err := scanBookingRows(rows, admin)
	if closeErr := rows.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	pendingReviews := []bookingRecord{}
	if admin {
		pendingRows, queryErr := a.db.QueryContext(r.Context(), `select b.id,coalesce(b.booking_batch_id,''),b.court_id,c.name,coalesce(b.member_id,''),b.booker_name,b.booked_by,b.start_at,b.end_at,b.interval_minutes,b.unit_price_thb,b.total_price_thb,b.status,b.payment_status,b.hold_expires_at,b.note,coalesce((select p.slip_data from booking_payments p join bookings paid_booking on paid_booking.id=p.booking_id where p.booking_id=b.id or (b.booking_batch_id is not null and paid_booking.booking_batch_id=b.booking_batch_id) order by p.created_at desc limit 1),''),to_char(b.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from bookings b join booking_courts c on c.id=b.court_id where b.admin_id=$1 and b.status='pending_review' order by b.created_at,b.start_at,c.sort_order`, adminID)
		if queryErr != nil {
			writeJSON(w, 500, map[string]string{"error": queryErr.Error()})
			return
		}
		pendingReviews, err = scanBookingRows(pendingRows, true)
		if closeErr := pendingRows.Close(); err == nil {
			err = closeErr
		}
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
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
	today := time.Now().In(bangkokLocation).Format("2006-01-02")
	payload := map[string]any{"settings": s, "courts": courts, "bookings": bookings, "closures": closures, "date": date, "serverNow": time.Now().Format(time.RFC3339), "bookingDateAllowed": s.AllowOvernight || date == today, "bookingAcceptanceOpen": bookingAcceptanceOpen(s, time.Now())}
	if admin {
		payload["pendingReviews"] = pendingReviews
	}
	if !admin {
		s.PublicToken = ""
		s.PromptPayID = ""
		s.TelegramChatID = ""
		s.TelegramConfigured = false
		s.TelegramWebhookURL = ""
		s.PopupImage = ""
		s.SlipOKBranchID = ""
		s.SlipOKAPIKeyMasked = ""
		s.SlipOKMonthlyCap = 0
		payload["settings"] = s
	}
	writeJSON(w, 200, payload)
}

func scanBookingRows(rows *sql.Rows, admin bool) ([]bookingRecord, error) {
	bookings := []bookingRecord{}
	for rows.Next() {
		var b bookingRecord
		var start, end time.Time
		var holdExpiresAt sql.NullTime
		if err := rows.Scan(&b.ID, &b.BatchID, &b.CourtID, &b.CourtName, &b.MemberID, &b.BookerName, &b.BookedBy, &start, &end, &b.Interval, &b.UnitPrice, &b.TotalPrice, &b.Status, &b.PaymentStatus, &holdExpiresAt, &b.Note, &b.SlipData, &b.CreatedAt); err != nil {
			return nil, err
		}
		b.StartAt = start.Format(time.RFC3339)
		b.EndAt = end.Format(time.RFC3339)
		if holdExpiresAt.Valid {
			b.HoldExpiresAt = holdExpiresAt.Time.Format(time.RFC3339)
		}
		if !admin {
			b.ID = ""
			b.BatchID = ""
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
	return bookings, rows.Err()
}

func (a *app) writePublicBookingQueues(w http.ResponseWriter, r *http.Request, adminID string) {
	u, ok := a.currentPublicUser(r.Context(), r)
	if !ok {
		writeAuthFailure(w, r, publicSessionKind)
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
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "serverNow": time.Now().Format(time.RFC3339)})
}

func mustBookingTime(value string) time.Time {
	parsed, _ := time.Parse(time.RFC3339, value)
	return parsed
}

type bookingReviewResult struct {
	BatchID    string   `json:"batchId,omitempty"`
	BookingIDs []string `json:"bookingIds"`
}

func cancellableBookingStatus(status string) bool {
	return status == "hold" || status == "pending_review" || status == "confirmed" || status == "cancelled"
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
	result, err := a.reviewBooking(r.Context(), adminID, bookingID, b.Action, b.Note, actorType, actorID)
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"status": "ok", "batchId": result.BatchID, "bookingIds": result.BookingIDs})
}

func (a *app) reviewBooking(ctx context.Context, adminID, bookingID, action, note, actorType, actorID string) (bookingReviewResult, error) {
	result := bookingReviewResult{BookingIDs: []string{}}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	var batchID sql.NullString
	if err = tx.QueryRowContext(ctx, `select booking_batch_id from bookings where id=$1 and admin_id=$2`, bookingID, adminID).Scan(&batchID); err != nil {
		return result, errors.New("booking not found")
	}
	result.BatchID = batchID.String
	rows, err := tx.QueryContext(ctx, `
		select id,status,payment_status from bookings
		where admin_id=$1 and (id=$2 or ($3<>'' and booking_batch_id=$3))
		order by id for update
	`, adminID, bookingID, result.BatchID)
	if err != nil {
		return result, err
	}
	type reviewRow struct{ id, status, payment string }
	items := []reviewRow{}
	for rows.Next() {
		var item reviewRow
		if err = rows.Scan(&item.id, &item.status, &item.payment); err != nil {
			_ = rows.Close()
			return result, err
		}
		items = append(items, item)
		result.BookingIDs = append(result.BookingIDs, item.id)
	}
	_ = rows.Close()
	if len(items) == 0 {
		return result, errors.New("booking not found")
	}
	status, payment := items[0].status, items[0].payment
	nextStatus, nextPayment := status, payment
	active := true
	switch action {
	case "approve":
		allDone := true
		for _, item := range items {
			if item.status != "confirmed" || item.payment != "paid" {
				allDone = false
			}
			if item.status != "pending_review" && !(item.status == "confirmed" && item.payment == "paid") {
				return result, errors.New("รายการในชุดนี้ไม่ได้รอตรวจสอบ")
			}
		}
		if allDone {
			return result, nil
		}
		nextStatus = "confirmed"
		nextPayment = "paid"
	case "reject":
		allDone := true
		for _, item := range items {
			if item.status != "rejected" {
				allDone = false
			}
			if item.status != "pending_review" && item.status != "rejected" {
				return result, errors.New("รายการในชุดนี้ไม่ได้รอตรวจสอบ")
			}
		}
		if allDone {
			return result, nil
		}
		nextStatus = "rejected"
		nextPayment = "rejected"
		active = false
	case "cancel":
		allDone := true
		for _, item := range items {
			if item.status != "cancelled" {
				allDone = false
			}
			if !cancellableBookingStatus(item.status) {
				return result, errors.New("ไม่สามารถยกเลิกรายการในชุดนี้")
			}
		}
		if allDone {
			return result, nil
		}
		nextStatus = "cancelled"
		active = false
	case "paid":
		for _, item := range items {
			if item.status != "confirmed" {
				return result, errors.New("booking ยังไม่ยืนยัน")
			}
		}
		nextPayment = "paid"
	default:
		return result, errors.New("invalid action")
	}
	_, err = tx.ExecContext(ctx, `update bookings set status=$4,payment_status=$5,note=$6,updated_at=now() where admin_id=$1 and (id=$2 or ($3<>'' and booking_batch_id=$3))`, adminID, bookingID, result.BatchID, nextStatus, nextPayment, strings.TrimSpace(note))
	if err != nil {
		return result, err
	}
	if !active {
		_, err = tx.ExecContext(ctx, `
			update booking_occupancies set active=false
			where booking_id in (
				select id from bookings where admin_id=$1 and (id=$2 or ($3<>'' and booking_batch_id=$3))
			)
		`, adminID, bookingID, result.BatchID)
		if err != nil {
			return result, err
		}
	}
	if action == "approve" || action == "reject" || action == "paid" {
		payStatus := map[string]string{"approve": "approved", "reject": "rejected", "paid": "manual_paid"}[action]
		_, err = tx.ExecContext(ctx, `
			update booking_payments set status=$4,note=$5,reviewed_by=$6,reviewed_at=now()
			where id=(
				select p.id from booking_payments p
				join bookings b on b.id=p.booking_id
				where b.admin_id=$1 and (b.id=$2 or ($3<>'' and b.booking_batch_id=$3))
				order by p.created_at desc limit 1
			)
		`, adminID, bookingID, result.BatchID, payStatus, note, actorID)
		if err != nil {
			return result, err
		}
	}
	targetID := bookingID
	if result.BatchID != "" {
		targetID = result.BatchID
	}
	if err = a.insertActivityLogTx(ctx, tx, actorType, actorID, action+"_booking_batch", "booking_batch", targetID, map[string]any{"adminId": adminID, "bookingIds": result.BookingIDs, "fromStatus": status, "toStatus": nextStatus, "paymentStatus": nextPayment, "note": note}); err != nil {
		return result, err
	}
	return result, tx.Commit()
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
	case r.Method == http.MethodGet && action == "popup":
		s, err := a.ensureBookingSettings(r.Context(), adminID)
		if err != nil || !s.PopupEnabled || s.PopupImage == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "popup not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"image": s.PopupImage, "revision": s.PopupRevision})
	case r.Method == http.MethodPost && action == "slip" && len(parts) > 2:
		a.uploadBookingSlip(w, r, adminID, parts[2])
	default:
		writeJSON(w, 404, map[string]string{"error": "not found"})
	}
}

func (a *app) createPublicHold(w http.ResponseWriter, r *http.Request, adminID, tenantToken string) {
	if !a.requireRequestRate(w, r, "booking-hold:"+adminID, 20, 10*time.Minute) {
		return
	}
	u, ok := a.currentPublicUser(r.Context(), r)
	if !ok {
		writeAuthFailure(w, r, publicSessionKind)
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
	if !bookingAcceptanceOpen(s, time.Now()) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "ขณะนี้อยู่นอกเวลาเปิดรับการจอง"})
		return
	}
	if s.SingleSlotPurchaseEnabled && len(b.Items) != 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ระบบกำหนดให้จองได้ครั้งละ 1 ช่วงเวลา"})
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
		if parseErr != nil {
			writeJSON(w, 400, map[string]string{"error": "ช่วงเวลาจองไม่ถูกต้อง"})
			return
		}
		if validationErr := validatePublicBookingWindow(s, start, end, time.Now()); validationErr != nil {
			status := http.StatusBadRequest
			if errors.Is(validationErr, errPublicBookingDateNotAllowed) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]string{"error": validationErr.Error()})
			return
		}
		durationMinutes := int(end.Sub(start).Minutes())
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
	if !a.requireRequestRate(w, r, "booking-slip:"+adminID, 10, 10*time.Minute) {
		return
	}
	u, ok := a.currentPublicUser(r.Context(), r)
	if !ok {
		writeAuthFailure(w, r, publicSessionKind)
		return
	}
	var b struct {
		SlipData string `json:"slipData"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 7<<20)).Decode(&b) != nil || len(b.SlipData) > 6_800_000 || !validImageData(b.SlipData, false) {
		writeJSON(w, 400, map[string]string{"error": "รองรับสลิป JPEG/PNG/WebP ไม่เกิน 5 MB"})
		return
	}
	var memberID, status, batchID, primaryBookingID string
	var expires time.Time
	var amount int
	if err := a.db.QueryRowContext(r.Context(), `select b.id,b.member_id,b.status,b.hold_expires_at,coalesce((select sum(x.total_price_thb) from bookings x where x.admin_id=b.admin_id and x.booking_batch_id=b.booking_batch_id),b.total_price_thb),coalesce(b.booking_batch_id,'') from bookings b join members m on m.id=b.member_id where (b.id=$1 or b.booking_batch_id=$1) and b.admin_id=$2 and m.public_user_id=$3 order by b.created_at limit 1`, bookingID, adminID, u.ID).Scan(&primaryBookingID, &memberID, &status, &expires, &amount, &batchID); err != nil {
		writeJSON(w, 404, map[string]string{"error": "booking not found"})
		return
	}
	if status != "hold" {
		message := bookingSlipConflictMessage(status)
		a.insertActivityLog(r.Context(), "public_user", u.ID, "upload_slip_after_booking_changed", "booking_batch", bookingID, map[string]any{"adminId": adminID, "batchId": batchID, "status": status})
		writeJSON(w, 409, map[string]string{"error": message})
		return
	}
	if time.Now().After(expires) {
		_, _ = a.db.ExecContext(r.Context(), `delete from bookings where admin_id=$3 and (id=$1 or ($2<>'' and booking_batch_id=$2)) and status='hold'`, bookingID, batchID, adminID)
		writeJSON(w, 409, map[string]string{"error": "เวลาชำระเงินหมดแล้ว รายการจองถูกลบ กรุณาเลือกเวลาใหม่"})
		return
	}

	settings, _ := a.ensureBookingSettings(r.Context(), adminID)
	localCheck := inspectSlipImage(b.SlipData, amount, promptPaySettings{ID: settings.PromptPayID, Type: settings.PromptPayType, ReceiverName: settings.PromptPayReceiverName}, time.Now())
	provider, verificationStatus, verificationNote := "local", "manual_review", localCheck.VerificationNote
	transRef := localCheck.TransRef
	detectedAmount, detectedPaidAt, detectedReceiver := localCheck.DetectedAmountTHB, localCheck.DetectedPaidAt, localCheck.DetectedReceiver
	providerErrorCode := 0
	autoApproved, definitiveFailure := false, false
	slipSettings := a.bookingSlipOKSettings(r.Context(), adminID)
	if slipSettings.ready() {
		quota := a.fetchSlipOKQuota(r.Context(), slipSettings)
		if quota.Available && !quota.CapReached {
			checked := a.checkSlipOK(r.Context(), slipSettings, b.SlipData, amount)
			provider = "slipok"
			providerErrorCode = checked.ErrorCode
			if checked.TransRef != "" {
				transRef = checked.TransRef
			}
			if checked.AmountTHB != nil {
				detectedAmount = checked.AmountTHB
			}
			if checked.PaidAt != "" {
				detectedPaidAt = checked.PaidAt
			}
			if checked.Receiver != "" {
				detectedReceiver = checked.Receiver
			}
			verificationStatus, verificationNote = checked.Status, checked.Note
			autoApproved = checked.Passed
			definitiveFailure = !checked.Passed && checked.Definitive
		} else {
			provider = "slipok"
			verificationNote = "Auto Slip ใช้งานไม่ได้หรือโควตาหมด ส่งให้ผู้ดูแลตรวจสอบเอง"
		}
	}

	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var lockedStatus string
	if err = tx.QueryRowContext(r.Context(), `select status from bookings where id=$1 and admin_id=$2 for update`, primaryBookingID, adminID).Scan(&lockedStatus); err != nil || lockedStatus != "hold" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": bookingSlipConflictMessage(lockedStatus)})
		return
	}
	paymentID := randUUID()
	paymentStatus := "pending"
	bookingStatus, bookingPaymentStatus := "pending_review", "pending"
	if autoApproved {
		paymentStatus, bookingStatus, bookingPaymentStatus = "approved", "confirmed", "paid"
	}
	if definitiveFailure {
		paymentStatus, bookingStatus, bookingPaymentStatus = "rejected", "rejected", "rejected"
	}
	_, err = tx.ExecContext(r.Context(), `insert into booking_payments (id,admin_id,booking_id,member_id,amount_thb,slip_data,status,trans_ref,slip_qr_payload,detected_amount_thb,detected_paid_at,detected_receiver,verification_provider,verification_status,verification_note,provider_error_code,checked_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,case when $13='slipok' then now() else null end)`, paymentID, adminID, primaryBookingID, memberID, amount, b.SlipData, paymentStatus, transRef, localCheck.QRPayload, detectedAmount, detectedPaidAt, detectedReceiver, provider, verificationStatus, verificationNote, providerErrorCode)
	var duplicatePaymentID string
	if err == nil && transRef != "" {
		var inserted string
		refErr := tx.QueryRowContext(r.Context(), `insert into booking_slip_refs (admin_id,trans_ref,payment_id,member_id) values ($1,$2,$3,$4) on conflict do nothing returning payment_id`, adminID, transRef, paymentID, memberID).Scan(&inserted)
		if errors.Is(refErr, sql.ErrNoRows) {
			_ = tx.QueryRowContext(r.Context(), `select payment_id from booking_slip_refs where admin_id=$1 and trans_ref=$2`, adminID, transRef).Scan(&duplicatePaymentID)
			if duplicatePaymentID != paymentID {
				paymentStatus, bookingStatus, bookingPaymentStatus = "rejected", "rejected", "rejected"
				verificationStatus = "duplicate"
				verificationNote = "พบสลิปซ้ำกับรายการเดิม"
			}
		} else if refErr != nil {
			err = refErr
		}
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), `update booking_payments set status=$2,verification_status=$3,verification_note=$4 where id=$1`, paymentID, paymentStatus, verificationStatus, verificationNote)
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), `update bookings set status=$4,payment_status=$5,updated_at=now() where admin_id=$3 and (id=$1 or ($2<>'' and booking_batch_id=$2))`, bookingID, batchID, adminID, bookingStatus, bookingPaymentStatus)
	}
	securityIncident := duplicatePaymentID != "" || definitiveFailure
	if err == nil && (bookingStatus == "rejected") {
		_, err = tx.ExecContext(r.Context(), `update booking_occupancies set active=false where booking_id in (select id from bookings where admin_id=$1 and (id=$2 or ($3<>'' and booking_batch_id=$3)))`, adminID, bookingID, batchID)
	}
	if err == nil && securityIncident {
		kind := "verification_failed"
		if duplicatePaymentID != "" {
			kind = "duplicate"
		}
		_, err = tx.ExecContext(r.Context(), `insert into booking_security_incidents (admin_id,public_user_id,member_id,booking_id,payment_id,incident_type,trans_ref,reason,duplicate_payment_id) values ($1,$2,$3,$4,$5,$6,$7,$8,nullif($9,''))`, adminID, u.ID, memberID, primaryBookingID, paymentID, kind, transRef, verificationNote, duplicatePaymentID)
		if err == nil {
			_, err = tx.ExecContext(r.Context(), `update public_user_sessions set revoked_at=coalesce(revoked_at,now()) where public_user_id=$1`, u.ID)
		}
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	_ = a.insertActivityLogTx(r.Context(), tx, "public_user", u.ID, "upload_booking_slip", "booking", primaryBookingID, map[string]any{"adminId": adminID, "batchId": batchID, "amount": amount, "verificationStatus": verificationStatus, "provider": provider})
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	go a.notifyAdminBooking(context.Background(), adminID, primaryBookingID)
	if securityIncident {
		clearSessionCookies(w, r, publicSessionKind)
		writeJSON(w, http.StatusForbidden, map[string]any{"error": verificationNote, "code": "booking_slip_rejected_logout", "status": "rejected"})
		return
	}
	writeJSON(w, 200, map[string]any{"status": bookingStatus, "verificationStatus": verificationStatus})
}

func bookingSlipConflictMessage(status string) string {
	switch status {
	case "cancelled":
		return "รายการจองนี้ถูกผู้ดูแลยกเลิกแล้ว กรุณาเลือกเวลาใหม่"
	case "rejected":
		return "รายการจองนี้ไม่ได้รับอนุมัติ กรุณาเลือกเวลาใหม่"
	case "pending_review":
		return "ส่งสลิปแล้วและกำลังรอผู้ดูแลตรวจสอบ"
	case "confirmed":
		return "รายการจองนี้ได้รับการยืนยันแล้ว"
	case "expired":
		return "เวลาชำระเงินหมดแล้ว รายการจองถูกยกเลิก กรุณาเลือกเวลาใหม่"
	default:
		return "สถานะรายการจองเปลี่ยนแปลงแล้ว กรุณารีเฟรชและตรวจสอบอีกครั้ง"
	}
}

type publicUser struct{ ID, Email, Name string }

func (a *app) currentPublicUser(ctx context.Context, r *http.Request) (publicUser, bool) {
	token, ok := readSessionCookie(r, publicSessionKind)
	if !ok {
		return publicUser{}, false
	}
	var u publicUser
	err := a.db.QueryRowContext(ctx, `select u.id,u.email,u.google_name from public_user_sessions s join public_users u on u.id=s.public_user_id where (s.token_hash=$1 or (s.previous_token_hash=$1 and s.previous_valid_until>now())) and s.revoked_at is null and s.idle_expires_at>now() and s.absolute_expires_at>now()`, tokenDigest(token)).Scan(&u.ID, &u.Email, &u.Name)
	return u, err == nil
}
func setPublicCookie(w http.ResponseWriter, r *http.Request, token string) {
	setSessionCookie(w, r, publicSessionKind, token)
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
		if token, ok := readSessionCookie(r, publicSessionKind); ok {
			_, _ = a.db.ExecContext(r.Context(), `update public_user_sessions set revoked_at=coalesce(revoked_at,now()) where token_hash=$1 or previous_token_hash=$1`, tokenDigest(token))
		}
		clearSessionCookies(w, r, publicSessionKind)
		writeJSON(w, 200, map[string]string{"status": "ok"})
	default:
		writeJSON(w, 404, map[string]string{"error": "not found"})
	}
}

func (a *app) startGoogleLogin(w http.ResponseWriter, r *http.Request) {
	if !a.requireRequestRate(w, r, "google-start", 20, 10*time.Minute) {
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
	if !a.requireRequestRate(w, r, "google-callback", 30, 10*time.Minute) {
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
	err = insertAuthSession(r.Context(), tx, publicSessionKind, uid, sessionToken)
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
		writeAuthFailure(w, r, publicSessionKind)
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
	if !a.requireRequestRate(w, r, "member-claim", 10, 10*time.Minute) {
		return
	}
	u, ok := a.currentPublicUser(r.Context(), r)
	if !ok {
		writeAuthFailure(w, r, publicSessionKind)
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
	if !a.requireRequestRate(w, r, "profile", 120, 10*time.Minute) {
		return
	}
	token := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/profile/"), "/")
	u, ok := a.currentPublicUser(r.Context(), r)
	if !ok {
		writeAuthFailure(w, r, publicSessionKind)
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
	bookingPage, pageSize := requestPage(r, "bookingPage", "pageSize", 10, 50)
	paymentPage, _ := requestPage(r, "paymentPage", "pageSize", 10, 50)
	matchPage, _ := requestPage(r, "matchPage", "pageSize", 10, 50)
	m.Phone = displayPhone(phone)
	a.expireHolds(r.Context(), adminID)
	bookingToken := ""
	if features.BookingEnabled {
		_ = a.db.QueryRowContext(r.Context(), `select public_token from booking_settings where admin_id=$1`, adminID).Scan(&bookingToken)
	}
	var bookingTotal, paymentTotal, matchTotal, upcomingTotal int
	_ = a.db.QueryRowContext(r.Context(), `select count(*),count(*) filter (where status in ('hold','pending_review','confirmed')) from bookings where member_id=$1 and admin_id=$2`, m.ID, adminID).Scan(&bookingTotal, &upcomingTotal)
	bookings := []bookingRecord{}
	rows, _ := a.db.QueryContext(r.Context(), `select b.id,b.court_id,c.name,b.booker_name,b.booked_by,b.start_at,b.end_at,b.interval_minutes,b.unit_price_thb,b.total_price_thb,b.status,b.payment_status,b.hold_expires_at,b.note,to_char(b.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from bookings b join booking_courts c on c.id=b.court_id where b.member_id=$1 and b.admin_id=$2 order by b.start_at desc limit $3 offset $4`, m.ID, adminID, pageSize, (bookingPage-1)*pageSize)
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
	_ = a.db.QueryRowContext(r.Context(), `select (select count(*) from booking_payments p join bookings b on b.id=p.booking_id where p.member_id=$1 and b.admin_id=$2)+(select count(*) from player_payment_events e join sessions s on s.id=e.session_id where e.member_id=$1 and s.admin_id=$2)`, m.ID, adminID).Scan(&paymentTotal)
	pr, _ := a.db.QueryContext(r.Context(), `select kind,id,amount_thb,status,created_at,session_name from (select 'booking' as kind,p.id,p.amount_thb,p.status,to_char(p.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') as created_at,'' as session_name from booking_payments p join bookings b on b.id=p.booking_id where p.member_id=$1 and b.admin_id=$2 union all select 'match',e.id::text,e.amount_thb,case when e.paid then 'paid' else 'unpaid' end,to_char(e.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),s.name from player_payment_events e join sessions s on s.id=e.session_id where e.member_id=$1 and s.admin_id=$2) events order by created_at desc, id desc limit $3 offset $4`, m.ID, adminID, pageSize, (paymentPage-1)*pageSize)
	if pr != nil {
		defer pr.Close()
		for pr.Next() {
			var kind, id, status, created, sessionName string
			var amount int
			_ = pr.Scan(&kind, &id, &amount, &status, &created, &sessionName)
			payments = append(payments, map[string]any{"kind": kind, "id": id, "amountThb": amount, "status": status, "createdAt": created, "sessionName": sessionName})
		}
	}
	matches := []map[string]any{}
	_ = a.db.QueryRowContext(r.Context(), `select count(*) from players p join sessions s on s.id=p.session_id join matches mt on mt.session_id=p.session_id and p.id in (mt.a1,mt.a2,mt.b1,mt.b2) where p.member_id=$1 and s.admin_id=$2 and mt.phase='history'`, m.ID, adminID).Scan(&matchTotal)
	mr, _ := a.db.QueryContext(r.Context(), `select s.name,mt.id,mt.court,mt.started_at,mt.ended_at,mt.status,mt.winner,p.id from players p join sessions s on s.id=p.session_id join matches mt on mt.session_id=p.session_id and p.id in (mt.a1,mt.a2,mt.b1,mt.b2) where p.member_id=$1 and s.admin_id=$2 and mt.phase='history' order by s.updated_at desc,mt.id desc limit $3 offset $4`, m.ID, adminID, pageSize, (matchPage-1)*pageSize)
	if mr != nil {
		defer mr.Close()
		for mr.Next() {
			var session, court, started, ended, status, winner string
			var matchID, playerID int
			_ = mr.Scan(&session, &matchID, &court, &started, &ended, &status, &winner, &playerID)
			matches = append(matches, map[string]any{"sessionName": session, "matchId": matchID, "court": court, "startedAt": started, "endedAt": ended, "status": status, "winner": winner, "playerId": playerID})
		}
	}
	writeJSON(w, 200, map[string]any{
		"member": m, "bookingToken": bookingToken, "bookings": bookings, "payments": payments, "matches": matches,
		"upcomingCount": upcomingTotal, "serverNow": time.Now().Format(time.RFC3339),
		"pagination": map[string]any{
			"bookings": pageMeta(bookingPage, pageSize, bookingTotal),
			"payments": pageMeta(paymentPage, pageSize, paymentTotal),
			"matches":  pageMeta(matchPage, pageSize, matchTotal),
		},
	})
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

func (a *app) refreshAdminTelegramWebhooks(ctx context.Context) {
	rows, err := a.db.QueryContext(ctx, `select admin_id,telegram_bot_token from booking_settings where telegram_bot_token<>'' and telegram_chat_id<>''`)
	if err != nil {
		return
	}
	type configuredBot struct{ adminID, encrypted string }
	bots := make([]configuredBot, 0)
	for rows.Next() {
		var bot configuredBot
		if rows.Scan(&bot.adminID, &bot.encrypted) == nil {
			bots = append(bots, bot)
		}
	}
	_ = rows.Close()
	for _, bot := range bots {
		token, decryptErr := decryptSecret(bot.encrypted)
		if decryptErr != nil {
			continue
		}
		webhookID, secret := randHex(12), randHex(20)
		if webhookErr := a.setAdminTelegramWebhook(ctx, token, webhookID, secret); webhookErr != nil {
			a.insertActivityLog(ctx, "system", "telegram", "refresh_booking_telegram_webhook_failed", "booking_settings", bot.adminID, map[string]any{"error": webhookErr.Error()})
			continue
		}
		if _, updateErr := a.db.ExecContext(ctx, `update booking_settings set telegram_webhook_id=$2,telegram_secret_hash=$3,updated_at=now() where admin_id=$1 and telegram_bot_token=$4`, bot.adminID, webhookID, tokenDigest(secret), bot.encrypted); updateErr != nil {
			a.insertActivityLog(ctx, "system", "telegram", "refresh_booking_telegram_webhook_failed", "booking_settings", bot.adminID, map[string]any{"error": updateErr.Error()})
			continue
		}
		a.insertActivityLog(ctx, "system", "telegram", "refresh_booking_telegram_webhook", "booking_settings", bot.adminID, map[string]any{})
	}
}

type telegramBookingItem struct {
	Court  string
	Start  string
	End    string
	Amount int
}

func telegramBookingMessage(title, name string, items []telegramBookingItem) string {
	var details strings.Builder
	total := 0
	for index, item := range items {
		total += item.Amount
		fmt.Fprintf(&details, "\n%d. %s\n%s–%s น. · %d บาท\n", index+1, item.Court, item.Start, item.End, item.Amount)
	}
	return fmt.Sprintf("%s\nผู้จอง: %s\nจำนวน: %d ช่วง%s\nยอดรวม: %d บาท", title, name, len(items), details.String(), total)
}

func (a *app) telegramBookingDetails(ctx context.Context, adminID, bookingID string) (string, string, []telegramBookingItem, error) {
	var batchID, name, slipData string
	err := a.db.QueryRowContext(ctx, `select coalesce(b.booking_batch_id,''),b.booker_name,coalesce((select p.slip_data from booking_payments p join bookings paid_booking on paid_booking.id=p.booking_id where p.booking_id=b.id or (b.booking_batch_id is not null and paid_booking.booking_batch_id=b.booking_batch_id) order by p.created_at desc limit 1),'') from bookings b where b.id=$1 and b.admin_id=$2`, bookingID, adminID).Scan(&batchID, &name, &slipData)
	if err != nil {
		return "", "", nil, err
	}
	rows, err := a.db.QueryContext(ctx, `select c.name,to_char(b.start_at at time zone 'Asia/Bangkok','DD/MM/YYYY HH24:MI'),to_char(b.end_at at time zone 'Asia/Bangkok','HH24:MI'),b.total_price_thb from bookings b join booking_courts c on c.id=b.court_id where b.admin_id=$2 and (b.id=$1 or ($3<>'' and b.booking_batch_id=$3)) order by b.start_at,c.sort_order`, bookingID, adminID, batchID)
	if err != nil {
		return "", "", nil, err
	}
	defer rows.Close()
	items := make([]telegramBookingItem, 0)
	for rows.Next() {
		var item telegramBookingItem
		if err = rows.Scan(&item.Court, &item.Start, &item.End, &item.Amount); err != nil {
			return "", "", nil, err
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil || len(items) == 0 {
		if err == nil {
			err = sql.ErrNoRows
		}
		return "", "", nil, err
	}
	return name, slipData, items, nil
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
	name, slipData, items, err := a.telegramBookingDetails(ctx, adminID, bookingID)
	if err != nil {
		return
	}
	var bookingStatus, verificationStatus, verificationNote string
	_ = a.db.QueryRowContext(ctx, `select b.status,coalesce(p.verification_status,'manual_review'),coalesce(p.verification_note,'') from bookings b left join booking_payments p on p.booking_id=b.id where b.id=$1 and b.admin_id=$2 order by p.created_at desc limit 1`, bookingID, adminID).Scan(&bookingStatus, &verificationStatus, &verificationNote)
	title := "🏸 จองสนามใหม่ · รอตรวจสอบ"
	keyboardRows := [][]map[string]string{{{"text": "อนุมัติ", "callback_data": "booking:approve:" + bookingID}, {"text": "ปฏิเสธ", "callback_data": "booking:reject:" + bookingID}}}
	if bookingStatus == "confirmed" && verificationStatus == "passed" {
		title = "✅ อนุมัติแล้ว · ผ่านการตรวจสอบ Auto Slip"
		keyboardRows = [][]map[string]string{}
	} else if bookingStatus == "rejected" {
		title = "❌ ปฏิเสธการจองอัตโนมัติ · " + verificationNote
		keyboardRows = [][]map[string]string{}
	}
	keyboard, _ := json.Marshal(map[string]any{"inline_keyboard": keyboardRows})
	message := telegramBookingMessage(title, name, items)
	if validImageData(slipData, false) {
		comma := strings.IndexByte(slipData, ',')
		raw, decodeErr := base64.StdEncoding.DecodeString(slipData[comma+1:])
		if decodeErr == nil {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			_ = writer.WriteField("chat_id", chatID)
			total := 0
			for _, item := range items {
				total += item.Amount
			}
			_ = writer.WriteField("caption", fmt.Sprintf("สลิปการจองสนาม\nผู้จอง: %s\nจำนวน %d ช่วง · ยอดรวม %d บาท", name, len(items), total))
			part, partErr := writer.CreateFormFile("photo", "slip.jpg")
			if partErr == nil {
				_, _ = part.Write(raw)
			}
			_ = writer.Close()
			req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.telegram.org/bot"+token+"/sendPhoto", &body)
			req.Header.Set("Content-Type", writer.FormDataContentType())
			if resp, sendErr := http.DefaultClient.Do(req); sendErr == nil {
				resp.Body.Close()
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

func telegramBotForm(ctx context.Context, token, method string, values url.Values) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.telegram.org/bot"+token+"/"+method, strings.NewReader(values.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("telegram %s: %s", method, resp.Status)
	}
	return nil
}

func telegramReviewText(action, name string, items []telegramBookingItem) (string, string) {
	short := "อนุมัติแล้ว"
	title := "✅ อนุมัติการจองแล้ว"
	if action == "reject" {
		short = "ปฏิเสธแล้ว"
		title = "❌ ปฏิเสธการจองแล้ว"
	}
	return short, telegramBookingMessage(title, name, items)
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
				ID   int64 `json:"message_id"`
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
	if len(parts) != 3 || parts[0] != "booking" || (parts[1] != "approve" && parts[1] != "reject") {
		writeJSON(w, 200, map[string]string{"status": "ignored"})
		return
	}
	note := ""
	if parts[1] == "reject" {
		note = "ปฏิเสธผ่าน Telegram"
	}
	_, err := a.reviewBooking(r.Context(), adminID, parts[2], parts[1], note, "telegram", strconv.FormatInt(q.From.ID, 10))
	token, tokenErr := decryptSecret(encrypted)
	if err != nil {
		if tokenErr == nil {
			message := "ดำเนินการไม่สำเร็จ: " + err.Error()
			_ = telegramBotForm(r.Context(), token, "answerCallbackQuery", url.Values{
				"callback_query_id": {q.ID},
				"text":              {message},
				"show_alert":        {"true"},
			})
			_ = telegramBotForm(r.Context(), token, "sendMessage", url.Values{"chat_id": {chatID}, "text": {message}})
		}
		writeJSON(w, 200, map[string]string{"status": "error", "error": err.Error()})
		return
	}
	name, _, items, queryErr := a.telegramBookingDetails(r.Context(), adminID, parts[2])
	if queryErr != nil {
		name = "-"
		items = []telegramBookingItem{{Court: "-", Start: "-", End: "-"}}
	}
	if tokenErr == nil {
		short, message := telegramReviewText(parts[1], name, items)
		_ = telegramBotForm(r.Context(), token, "answerCallbackQuery", url.Values{
			"callback_query_id": {q.ID},
			"text":              {short},
		})
		emptyKeyboard, _ := json.Marshal(map[string]any{"inline_keyboard": [][]map[string]string{}})
		_ = telegramBotForm(r.Context(), token, "editMessageReplyMarkup", url.Values{
			"chat_id":      {chatID},
			"message_id":   {strconv.FormatInt(q.Message.ID, 10)},
			"reply_markup": {string(emptyKeyboard)},
		})
		_ = telegramBotForm(r.Context(), token, "sendMessage", url.Values{"chat_id": {chatID}, "text": {message}})
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}
