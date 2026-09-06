package main

import (
	"context"
	cryptorand "crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const maxPOSIdentities = 3

const (
	posLoginIdentifierLimit = 10
	posLoginRateWindow      = 10 * time.Minute
)

var dummyPOSCredentialHash = func() string {
	hash, err := bcrypt.GenerateFromPassword([]byte("livematch-invalid-pos-credential"), bcrypt.DefaultCost)
	if err != nil {
		panic("cannot initialize POS credential verifier")
	}
	return string(hash)
}()

var posReportPermissionKeys = []string{"report_overview", "report_top_sellers", "report_vat", "report_payments", "report_sold_products", "report_purchases", "report_inventory", "report_inventory_values", "report_transfers", "report_special"}

var posPermissionKeys = []string{"sales", "bills", "products", "stock", "reports", "report_overview", "report_top_sellers", "report_vat", "report_payments", "report_sold_products", "report_purchases", "report_inventory", "report_inventory_values", "report_transfers", "report_special", "settings", "discounts", "void_sales", "stock_adjust", "product_pricing", "report_export", "member_create"}

type posPrincipal struct {
	User        adminUser
	StaffNumber string
}

type posStaffRecord struct {
	ID                string `json:"id"`
	StaffNumber       string `json:"staffNumber"`
	Name              string `json:"name"`
	Email             string `json:"email"`
	Role              string `json:"role"`
	Active            bool   `json:"active"`
	IsOwner           bool   `json:"isOwner"`
	LastLoginAt       string `json:"lastLoginAt,omitempty"`
	FailedLoginCount  int    `json:"failedLoginCount"`
	LastFailedLoginAt string `json:"lastFailedLoginAt,omitempty"`
}

type posEmailQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func posLoginEmailInUse(ctx context.Context, queryer posEmailQueryer, email, excludedStaffID string) (bool, error) {
	if email == "" {
		return false, nil
	}
	var inUse bool
	err := queryer.QueryRowContext(ctx, `
		select exists (
			select 1 from admin_users where lower(email)=lower($1)
			union all
			select 1 from pos_staff where email<>'' and lower(email)=lower($1) and id<>$2
		)
	`, email, excludedStaffID).Scan(&inUse)
	return inUse, err
}

func allPOSPermissions() map[string]bool {
	result := map[string]bool{}
	for _, key := range posPermissionKeys {
		result[key] = true
	}
	return result
}

func defaultPOSPermissions(role string) map[string]bool {
	reportAccess := role == "manager"
	if role == "manager" {
		result := map[string]bool{"sales": true, "bills": true, "products": true, "stock": true, "reports": true, "settings": false, "discounts": true, "void_sales": true, "stock_adjust": true, "product_pricing": true, "report_export": true, "member_create": true}
		for _, key := range posReportPermissionKeys {
			result[key] = reportAccess
		}
		return result
	}
	result := map[string]bool{"sales": true, "bills": true, "products": false, "stock": false, "reports": false, "settings": false, "discounts": false, "void_sales": false, "stock_adjust": false, "product_pricing": false, "report_export": false, "member_create": true}
	for _, key := range posReportPermissionKeys {
		result[key] = reportAccess
	}
	return result
}

func normalizePOSPermissions(input map[string]bool) map[string]bool {
	result := map[string]bool{}
	for _, key := range posPermissionKeys {
		value, exists := input[key]
		if !exists && strings.HasPrefix(key, "report_") && key != "report_export" {
			value = input["reports"]
		}
		result[key] = value
	}
	if !result["reports"] {
		for _, key := range posReportPermissionKeys {
			result[key] = false
		}
	}
	return result
}

func (a *app) posPermissions(ctx context.Context, adminID, role string) map[string]bool {
	if role == "owner" {
		return allPOSPermissions()
	}
	result := defaultPOSPermissions(role)
	var raw []byte
	if err := a.db.QueryRowContext(ctx, `select permissions from pos_role_permissions where admin_id=$1 and role=$2`, adminID, role).Scan(&raw); err == nil {
		var stored map[string]bool
		if json.Unmarshal(raw, &stored) == nil {
			for _, key := range posPermissionKeys {
				if value, ok := stored[key]; ok {
					result[key] = value
				} else if strings.HasPrefix(key, "report_") && key != "report_export" {
					result[key] = result["reports"]
				}
			}
			if !result["reports"] {
				for _, key := range posReportPermissionKeys {
					result[key] = false
				}
			}
		}
	}
	return result
}

func (a *app) currentPOSPrincipal(ctx context.Context, r *http.Request) (posPrincipal, bool) {
	if user, ok := a.currentAdmin(ctx, r); ok {
		if !a.features(ctx, user.ID).POSEnabled {
			return posPrincipal{}, false
		}
		user.POSActorID = user.ID
		user.POSActorName = user.Name
		user.POSActorType = "admin"
		user.POSRole = "owner"
		user.POSPermissions = allPOSPermissions()
		return posPrincipal{User: user, StaffNumber: strconv.FormatInt(user.POSAdminNumber, 10)}, true
	}
	token, ok := readSessionCookie(r, posStaffSessionKind)
	if !ok {
		return posPrincipal{}, false
	}
	var user adminUser
	var staffID, staffNumber, staffName, staffEmail, role string
	err := a.db.QueryRowContext(ctx, `
		select u.id,u.email,u.name,u.pos_admin_number,u.verified_at is not null,u.coins,
			to_char(u.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),
			ps.id,ps.staff_number,ps.name,ps.email,ps.role
		from pos_staff_sessions s
		join pos_staff ps on ps.id=s.staff_id and ps.active
		join admin_users u on u.id=ps.admin_id
		join admin_features af on af.admin_id=u.id and af.pos_enabled
		where (s.token_hash=$1 or (s.previous_token_hash=$1 and s.previous_valid_until>now()))
			and s.revoked_at is null and s.idle_expires_at>now() and s.absolute_expires_at>now()
	`, tokenDigest(token)).Scan(&user.ID, &user.Email, &user.Name, &user.POSAdminNumber, &user.Verified, &user.Coins, &user.CreatedAt, &staffID, &staffNumber, &staffName, &staffEmail, &role)
	if err != nil {
		return posPrincipal{}, false
	}
	user.POSActorID = staffID
	user.POSActorName = staffName
	user.POSActorType = "pos_staff"
	user.POSRole = role
	user.POSPermissions = a.posPermissions(ctx, user.ID, role)
	return posPrincipal{User: user, StaffNumber: staffNumber}, true
}

func (a *app) writePOSAuthFailure(w http.ResponseWriter, r *http.Request) {
	if code := authFailure(r, posStaffSessionKind); code != "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": code, "code": code})
		return
	}
	if _, ok := readSessionCookie(r, adminSessionKind); ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน POS กรุณาติดต่อผู้ดูแลระบบ", "code": "pos_not_enabled"})
		return
	}
	writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not_logged_in", "code": "not_logged_in"})
}

func (a *app) adminByPOSIdentifier(ctx context.Context, identifier string) (adminUser, string, error) {
	identifier = strings.TrimSpace(identifier)
	if strings.Contains(identifier, "@") {
		return a.adminByEmail(ctx, normalizeEmail(identifier))
	}
	var user adminUser
	var passwordHash string
	err := a.db.QueryRowContext(ctx, `
		select id,email,name,pos_admin_number,password_hash,verified_at is not null,coins,
			to_char(created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI')
		from admin_users where pos_admin_number::text=$1
	`, identifier).Scan(&user.ID, &user.Email, &user.Name, &user.POSAdminNumber, &passwordHash, &user.Verified, &user.Coins, &user.CreatedAt)
	return user, passwordHash, err
}

func (a *app) handlePOSLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var body struct {
		Email      string `json:"email"`
		Identifier string `json:"identifier"`
		Password   string `json:"password"`
		Remember   *bool  `json:"remember,omitempty"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ข้อมูลเข้าสู่ระบบไม่ถูกต้อง", "code": "invalid_login"})
		return
	}
	identifier := strings.TrimSpace(body.Identifier)
	if identifier == "" {
		identifier = strings.TrimSpace(body.Email)
	}
	identifier = strings.ToLower(identifier)
	// Scope the limiter to this login identifier and client IP. This prevents one
	// cashier (or one reverse-proxy IP) from causing 429 responses for every POS user.
	loginRateScope := "pos-login-identifier:" + tokenDigest(identifier)
	if !a.requireRequestRate(w, r, loginRateScope, posLoginIdentifierLimit, posLoginRateWindow) {
		a.insertActivityLog(r.Context(), "anonymous", "pos-login", "pos_login_rate_limited", "pos_login", tokenDigest(identifier), map[string]any{"identifierHash": tokenDigest(identifier), "result": "rate_limited"})
		return
	}
	remember := body.Remember == nil || *body.Remember
	user, passwordHash, adminErr := a.adminByPOSIdentifier(r.Context(), identifier)
	adminPasswordOK := bcrypt.CompareHashAndPassword([]byte(func() string {
		if passwordHash == "" {
			return dummyPOSCredentialHash
		}
		return passwordHash
	}()), []byte(body.Password)) == nil
	if adminErr == nil && adminPasswordOK {
		if !user.Verified {
			a.insertActivityLog(r.Context(), "admin", user.ID, "pos_login_blocked", "admin_user", user.ID, map[string]any{"reason": "email_not_verified"})
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "email not verified", "code": "email not verified"})
			return
		}
		if !a.features(r.Context(), user.ID).POSEnabled {
			a.insertActivityLog(r.Context(), "admin", user.ID, "pos_login_blocked", "admin_user", user.ID, map[string]any{"reason": "pos_not_enabled"})
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน POS กรุณาติดต่อผู้ดูแลระบบ", "code": "pos_not_enabled"})
			return
		}
		token := randHex(24)
		if err := insertAuthSessionWithPersistence(r.Context(), a.db, adminSessionKind, user.ID, token, remember); err != nil {
			writePOSInternalError(w, r, err)
			return
		}
		clearSessionCookies(w, r, posStaffSessionKind)
		setSessionCookiePersistence(w, r, adminSessionKind, token, remember)
		a.clearPOSLoginRate(r.Context(), r, loginRateScope)
		user.POSActorID, user.POSActorName, user.POSActorType, user.POSRole = user.ID, user.Name, "admin", "owner"
		user.POSPermissions = allPOSPermissions()
		a.insertActivityLog(r.Context(), "admin", user.ID, "pos_login_success", "admin_user", user.ID, map[string]any{"role": "owner", "remember": remember})
		a.writePOSMe(w, posPrincipal{User: user, StaffNumber: strconv.FormatInt(user.POSAdminNumber, 10)})
		return
	}

	var staffID, adminID, staffNumber, staffName, staffEmail, role, pinHash string
	var active, enabled bool
	err := a.db.QueryRowContext(r.Context(), `
		select ps.id,ps.admin_id,ps.staff_number,ps.name,ps.email,ps.role,ps.pin_hash,ps.active,coalesce(af.pos_enabled,false)
		from pos_staff ps left join admin_features af on af.admin_id=ps.admin_id
		where lower(ps.staff_number)=lower($1)
			or (ps.email<>'' and lower(ps.email)=lower($1))
	`, identifier).Scan(&staffID, &adminID, &staffNumber, &staffName, &staffEmail, &role, &pinHash, &active, &enabled)
	staffPINOK := bcrypt.CompareHashAndPassword([]byte(func() string {
		if pinHash == "" {
			return dummyPOSCredentialHash
		}
		return pinHash
	}()), []byte(body.Password)) == nil
	if err != nil || !staffPINOK {
		if err == nil {
			_, _ = a.db.ExecContext(r.Context(), `update pos_staff set failed_login_count=failed_login_count+1,last_failed_login_at=now() where id=$1`, staffID)
		}
		targetID := tokenDigest(identifier)
		actorType := "anonymous"
		if staffID != "" {
			targetID, actorType = staffID, "pos_staff"
		}
		a.insertActivityLog(r.Context(), actorType, targetID, "pos_login_failed", "pos_login", targetID, map[string]any{"identifierHash": tokenDigest(identifier), "reason": "invalid_credential"})
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "รหัสผู้ใช้หรือ PIN ไม่ถูกต้อง", "code": "invalid_login"})
		return
	}
	if !active || !enabled {
		a.insertActivityLog(r.Context(), "pos_staff", staffID, "pos_login_blocked", "pos_staff", staffID, map[string]any{"reason": "pos_not_enabled_or_inactive", "staffActive": active, "ownerPOSEnabled": enabled})
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน POS กรุณาติดต่อผู้ดูแลระบบ", "code": "pos_not_enabled"})
		return
	}
	token := randHex(24)
	if err = insertAuthSessionWithPersistence(r.Context(), a.db, posStaffSessionKind, staffID, token, remember); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	_, _ = a.db.ExecContext(r.Context(), `update pos_staff set last_login_at=now(),failed_login_count=0 where id=$1`, staffID)
	clearSessionCookies(w, r, adminSessionKind)
	setSessionCookiePersistence(w, r, posStaffSessionKind, token, remember)
	a.clearPOSLoginRate(r.Context(), r, loginRateScope)
	principal, ok := a.currentPOSPrincipalForStaff(r.Context(), staffID)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "ไม่สามารถโหลดข้อมูลผู้ใช้ POS ได้"})
		return
	}
	a.insertActivityLog(r.Context(), "pos_staff", staffID, "pos_login_success", "pos_staff", staffID, map[string]any{"role": role, "remember": remember})
	a.writePOSMe(w, principal)
}

func (a *app) clearPOSLoginRate(ctx context.Context, r *http.Request, scope string) {
	_, _ = a.db.ExecContext(ctx, `delete from request_rate_limits where rate_key=$1`, scope+":"+clientIP(r))
}

func (a *app) currentPOSPrincipalForStaff(ctx context.Context, staffID string) (posPrincipal, bool) {
	var user adminUser
	var number, name, email, role string
	err := a.db.QueryRowContext(ctx, `
		select u.id,u.email,u.name,u.pos_admin_number,u.verified_at is not null,u.coins,
			to_char(u.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),ps.staff_number,ps.name,ps.email,ps.role
		from pos_staff ps join admin_users u on u.id=ps.admin_id join admin_features af on af.admin_id=u.id and af.pos_enabled
		where ps.id=$1 and ps.active
	`, staffID).Scan(&user.ID, &user.Email, &user.Name, &user.POSAdminNumber, &user.Verified, &user.Coins, &user.CreatedAt, &number, &name, &email, &role)
	if err != nil {
		return posPrincipal{}, false
	}
	user.POSActorID, user.POSActorName, user.POSActorType, user.POSRole = staffID, name, "pos_staff", role
	user.POSPermissions = a.posPermissions(ctx, user.ID, role)
	return posPrincipal{User: user, StaffNumber: number}, true
}

func (a *app) writePOSMe(w http.ResponseWriter, principal posPrincipal) {
	w.Header().Set("Cache-Control", "no-store")
	u := principal.User
	writeJSON(w, http.StatusOK, map[string]any{
		"user": map[string]any{
			"id": u.POSActorID, "email": func() string {
				if u.POSActorType == "admin" {
					return u.Email
				}
				return ""
			}(),
			"name": u.POSActorName, "posAdminNumber": u.POSAdminNumber, "verified": u.Verified, "coins": u.Coins,
			"createdAt": u.CreatedAt, "role": u.POSRole, "staffNumber": principal.StaffNumber,
			"actorType": u.POSActorType, "ownerId": u.ID, "ownerName": u.Name,
		},
		"features": map[string]bool{"posEnabled": true}, "permissions": u.POSPermissions,
	})
}

func (a *app) handlePOSLogout(w http.ResponseWriter, r *http.Request) {
	principal, authenticated := a.currentPOSPrincipal(r.Context(), r)
	if token, ok := readSessionCookie(r, posStaffSessionKind); ok {
		_, _ = a.db.ExecContext(r.Context(), `update pos_staff_sessions set revoked_at=coalesce(revoked_at,now()) where token_hash=$1 or previous_token_hash=$1`, tokenDigest(token))
	}
	if token, ok := readSessionCookie(r, adminSessionKind); ok {
		_, _ = a.db.ExecContext(r.Context(), `update admin_sessions set revoked_at=coalesce(revoked_at,now()) where token_hash=$1 or previous_token_hash=$1`, tokenDigest(token))
	}
	clearSessionCookies(w, r, posStaffSessionKind)
	clearSessionCookies(w, r, adminSessionKind)
	if authenticated {
		a.insertActivityLog(r.Context(), posActorType(principal.User), posActorID(principal.User), "pos_logout", "admin_user", principal.User.ID, map[string]any{"role": principal.User.POSRole})
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func validPOSPIN(pin string) bool {
	if len(pin) != 6 {
		return false
	}
	for _, char := range pin {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func randomPOSPIN() (string, error) {
	value, err := cryptorand.Int(cryptorand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", value.Int64()), nil
}

func (a *app) listPOSStaff(ctx context.Context, user adminUser) ([]posStaffRecord, error) {
	owner := posStaffRecord{ID: user.ID, StaffNumber: strconv.FormatInt(user.POSAdminNumber, 10), Name: user.Name, Email: user.Email, Role: "owner", Active: true, IsOwner: true}
	_ = a.db.QueryRowContext(ctx, `select coalesce(to_char(max(last_seen_at) at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),'') from admin_sessions where admin_id=$1`, user.ID).Scan(&owner.LastLoginAt)
	items := []posStaffRecord{owner}
	rows, err := a.db.QueryContext(ctx, `select id,staff_number,name,email,role,active,coalesce(to_char(last_login_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),''),failed_login_count,coalesce(to_char(last_failed_login_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),'') from pos_staff where admin_id=$1 order by created_at,id`, user.ID)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	for rows.Next() {
		var item posStaffRecord
		if err = rows.Scan(&item.ID, &item.StaffNumber, &item.Name, &item.Email, &item.Role, &item.Active, &item.LastLoginAt, &item.FailedLoginCount, &item.LastFailedLoginAt); err != nil {
			return items, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (a *app) writePOSAccessSettings(w http.ResponseWriter, r *http.Request, user adminUser) {
	w.Header().Set("Cache-Control", "no-store")
	if !requirePOSOwner(w, user) {
		return
	}
	items, err := a.listPOSStaff(r.Context(), user)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "maxMembers": maxPOSIdentities, "permissions": map[string]any{"owner": allPOSPermissions(), "manager": a.posPermissions(r.Context(), user.ID, "manager"), "cashier": a.posPermissions(r.Context(), user.ID, "cashier")}})
}

func (a *app) updatePOSOwner(w http.ResponseWriter, r *http.Request, user adminUser) {
	if !requirePOSOwner(w, user) {
		return
	}
	var body struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ข้อมูลเจ้าของระบบไม่ถูกต้อง"})
		return
	}
	body.Name, body.Email = strings.TrimSpace(body.Name), normalizeEmail(body.Email)
	if !strings.EqualFold(body.Email, user.Email) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "อีเมลของ Root Admin ไม่สามารถเปลี่ยนจากระบบ POS ได้", "code": "owner_email_locked"})
		return
	}
	parsed, emailErr := mail.ParseAddress(body.Email)
	if body.Name == "" || len(body.Name) > 100 || body.Email == "" || len(body.Email) > 254 || emailErr != nil || !strings.EqualFold(parsed.Address, body.Email) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "กรุณากรอกชื่อและอีเมลให้ถูกต้อง"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), `update admin_users set name=$2,updated_at=now() where id=$1`, user.ID, body.Name); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	if err = a.insertActivityLogTx(r.Context(), tx, posActorType(user), posActorID(user), "update_pos_owner_profile", "admin_user", user.ID, map[string]any{"adminId": user.ID, "beforeName": user.Name, "afterName": body.Name, "emailChanged": false}); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	user.Name, user.POSActorName = body.Name, body.Name
	a.writePOSAccessSettings(w, r, user)
}

func (a *app) writePOSActivity(w http.ResponseWriter, r *http.Request, user adminUser) {
	if !requirePOSOwner(w, user) {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 200 {
		limit = 50
	}
	rows, err := a.db.QueryContext(r.Context(), `
		select l.id,l.actor_type,l.actor_id,
			coalesce(case when l.actor_type='pos_staff' then ps.name else au.name end,''),
			l.action,l.target_type,l.target_id,l.details,
			to_char(l.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI:SS')
		from activity_logs l
		left join pos_staff ps on ps.id=l.actor_id
		left join admin_users au on au.id=l.actor_id
		where ((l.actor_type='admin' and l.actor_id=$1)
			or (l.actor_type='pos_staff' and exists(select 1 from pos_staff owned where owned.id=l.actor_id and owned.admin_id=$1)))
			and (l.action like '%pos%' or l.action in ('settle_combined_bill','create_member','export_pos_report'))
		order by l.created_at desc,l.id desc limit $2`, user.ID, limit)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var actorType, actorID, actorName, action, targetType, targetID, details, createdAt string
		if err = rows.Scan(&id, &actorType, &actorID, &actorName, &action, &targetType, &targetID, &details, &createdAt); err != nil {
			writePOSInternalError(w, r, err)
			return
		}
		var decoded any = map[string]any{}
		_ = json.Unmarshal([]byte(details), &decoded)
		items = append(items, map[string]any{"id": id, "actorType": actorType, "actorId": actorID, "actorName": actorName, "action": action, "targetType": targetType, "targetId": targetID, "details": decoded, "createdAt": createdAt})
	}
	if err = rows.Err(); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func requirePOSOwner(w http.ResponseWriter, user adminUser) bool {
	if user.POSRole != "owner" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "เฉพาะเจ้าของระบบเท่านั้นที่จัดการสมาชิกและสิทธิ์ได้", "code": "owner_required"})
		return false
	}
	return true
}

func (a *app) createPOSStaff(w http.ResponseWriter, r *http.Request, user adminUser) {
	if !requirePOSOwner(w, user) {
		return
	}
	var body struct{ Name, Email, Role, PIN string }
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body) != nil {
		writeJSON(w, 400, map[string]string{"error": "ข้อมูลสมาชิกไม่ถูกต้อง"})
		return
	}
	body.Name, body.Email, body.Role = strings.TrimSpace(body.Name), normalizeEmail(body.Email), strings.ToLower(strings.TrimSpace(body.Role))
	if body.Name == "" || len(body.Name) > 100 || (body.Role != "manager" && body.Role != "cashier") || !validPOSPIN(body.PIN) {
		writeJSON(w, 400, map[string]string{"error": "กรุณากรอกชื่อ บทบาท และ PIN ตัวเลข 6 หลัก"})
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.PIN), bcrypt.DefaultCost)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), `select pg_advisory_xact_lock(hashtext($1))`, "pos-staff:"+user.ID); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	if body.Email != "" {
		if _, err = tx.ExecContext(r.Context(), `select pg_advisory_xact_lock(hashtext($1))`, "pos-login-email:"+body.Email); err != nil {
			writePOSInternalError(w, r, err)
			return
		}
		var inUse bool
		if inUse, err = posLoginEmailInUse(r.Context(), tx, body.Email, ""); err != nil {
			writePOSInternalError(w, r, err)
			return
		}
		if inUse {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "อีเมลนี้ถูกใช้เข้าสู่ระบบแล้ว", "code": "email_in_use"})
			return
		}
	}
	var count int
	if err = tx.QueryRowContext(r.Context(), `select count(*) from pos_staff where admin_id=$1`, user.ID).Scan(&count); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	if count+1 >= maxPOSIdentities {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "สมาชิก POS ครบจำนวนสูงสุด 3 คนแล้ว"})
		return
	}
	used := map[string]bool{}
	rows, _ := tx.QueryContext(r.Context(), `select staff_number from pos_staff where admin_id=$1`, user.ID)
	if rows != nil {
		for rows.Next() {
			var n string
			_ = rows.Scan(&n)
			used[n] = true
		}
		rows.Close()
	}
	staffNumber := ""
	for slot := 1; slot <= 99; slot++ {
		candidate := fmt.Sprintf("%d-%02d", user.POSAdminNumber, slot)
		if !used[candidate] {
			staffNumber = candidate
			break
		}
	}
	if staffNumber == "" {
		writeJSON(w, 500, map[string]string{"error": "ไม่สามารถสร้าง Staff Number ได้"})
		return
	}
	id := "pos-staff-" + randHex(8)
	if _, err = tx.ExecContext(r.Context(), `insert into pos_staff(id,admin_id,staff_number,name,email,role,pin_hash) values($1,$2,$3,$4,$5,$6,$7)`, id, user.ID, staffNumber, body.Name, body.Email, body.Role, string(hash)); err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "อีเมลหรือ Staff Number ซ้ำ"})
		return
	}
	if err = a.insertActivityLogTx(r.Context(), tx, posActorType(user), posActorID(user), "create_pos_staff", "pos_staff", id, map[string]any{"adminId": user.ID, "staffNumber": staffNumber, "role": body.Role, "hasEmail": body.Email != "", "active": true}); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	a.writePOSAccessSettings(w, r, user)
}

func (a *app) updatePOSStaff(w http.ResponseWriter, r *http.Request, user adminUser, staffID string) {
	if !requirePOSOwner(w, user) {
		return
	}
	var body struct {
		Name, Email, Role string
		Active            *bool `json:"active"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body) != nil {
		writeJSON(w, 400, map[string]string{"error": "ข้อมูลสมาชิกไม่ถูกต้อง"})
		return
	}
	body.Name, body.Email, body.Role = strings.TrimSpace(body.Name), normalizeEmail(body.Email), strings.ToLower(strings.TrimSpace(body.Role))
	if body.Name == "" || (body.Role != "manager" && body.Role != "cashier") {
		writeJSON(w, 400, map[string]string{"error": "ชื่อหรือบทบาทไม่ถูกต้อง"})
		return
	}
	active := true
	if body.Active != nil {
		active = *body.Active
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer tx.Rollback()
	var previousName, previousEmail, previousRole string
	var previousActive bool
	if err = tx.QueryRowContext(r.Context(), `select name,email,role,active from pos_staff where id=$1 and admin_id=$2 for update`, staffID, user.ID).Scan(&previousName, &previousEmail, &previousRole, &previousActive); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, 404, map[string]string{"error": "ไม่พบสมาชิก"})
			return
		}
		writePOSInternalError(w, r, err)
		return
	}
	if body.Email != "" {
		if _, err = tx.ExecContext(r.Context(), `select pg_advisory_xact_lock(hashtext($1))`, "pos-login-email:"+body.Email); err != nil {
			writePOSInternalError(w, r, err)
			return
		}
		var inUse bool
		if inUse, err = posLoginEmailInUse(r.Context(), tx, body.Email, staffID); err != nil {
			writePOSInternalError(w, r, err)
			return
		}
		if inUse {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "อีเมลนี้ถูกใช้เข้าสู่ระบบแล้ว", "code": "email_in_use"})
			return
		}
	}
	result, err := tx.ExecContext(r.Context(), `update pos_staff set name=$3,email=$4,role=$5,active=$6,updated_at=now() where id=$1 and admin_id=$2`, staffID, user.ID, body.Name, body.Email, body.Role, active)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "อีเมลนี้ถูกใช้เข้าสู่ระบบแล้ว", "code": "email_in_use"})
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		writeJSON(w, 404, map[string]string{"error": "ไม่พบสมาชิก"})
		return
	}
	if !active {
		_, _ = tx.ExecContext(r.Context(), `update pos_staff_sessions set revoked_at=coalesce(revoked_at,now()) where staff_id=$1`, staffID)
	}
	if err = a.insertActivityLogTx(r.Context(), tx, posActorType(user), posActorID(user), "update_pos_staff", "pos_staff", staffID, map[string]any{
		"adminId": user.ID,
		"before":  map[string]any{"name": previousName, "hasEmail": previousEmail != "", "role": previousRole, "active": previousActive},
		"after":   map[string]any{"name": body.Name, "hasEmail": body.Email != "", "role": body.Role, "active": active},
	}); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	a.writePOSAccessSettings(w, r, user)
}

func (a *app) resetPOSStaffPIN(w http.ResponseWriter, r *http.Request, user adminUser, staffID string) {
	w.Header().Set("Cache-Control", "no-store")
	if !requirePOSOwner(w, user) {
		return
	}
	var body struct {
		PIN string `json:"pin"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body)
	body.PIN = strings.TrimSpace(body.PIN)
	if body.PIN == "" {
		var err error
		body.PIN, err = randomPOSPIN()
		if err != nil {
			writePOSInternalError(w, r, err)
			return
		}
	}
	if !validPOSPIN(body.PIN) {
		writeJSON(w, 400, map[string]string{"error": "PIN ต้องเป็นตัวเลข 6 หลัก"})
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.PIN), bcrypt.DefaultCost)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(r.Context(), `update pos_staff set pin_hash=$3,updated_at=now() where id=$1 and admin_id=$2`, staffID, user.ID, string(hash))
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		writeJSON(w, 404, map[string]string{"error": "ไม่พบสมาชิก"})
		return
	}
	_, _ = tx.ExecContext(r.Context(), `update pos_staff_sessions set revoked_at=coalesce(revoked_at,now()) where staff_id=$1`, staffID)
	if err = a.insertActivityLogTx(r.Context(), tx, posActorType(user), posActorID(user), "reset_pos_staff_pin", "pos_staff", staffID, map[string]any{"adminId": user.ID, "sessionsRevoked": true}); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"status": "pin_reset", "pin": body.PIN})
}

func (a *app) forceLogoutPOSStaff(w http.ResponseWriter, r *http.Request, user adminUser, staffID string) {
	if !requirePOSOwner(w, user) {
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer tx.Rollback()
	var staffName string
	if err = tx.QueryRowContext(r.Context(), `select name from pos_staff where id=$1 and admin_id=$2 for update`, staffID, user.ID).Scan(&staffName); err != nil {
		writeJSON(w, 404, map[string]string{"error": "ไม่พบสมาชิก"})
		return
	}
	result, err := tx.ExecContext(r.Context(), `update pos_staff_sessions set revoked_at=coalesce(revoked_at,now()) where staff_id=$1`, staffID)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	revoked, _ := result.RowsAffected()
	if err = a.insertActivityLogTx(r.Context(), tx, posActorType(user), posActorID(user), "force_logout_pos_staff", "pos_staff", staffID, map[string]any{"adminId": user.ID, "staffName": staffName, "sessionsRevoked": revoked}); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "logged_out"})
}

func (a *app) savePOSPermissions(w http.ResponseWriter, r *http.Request, user adminUser) {
	if !requirePOSOwner(w, user) {
		return
	}
	var body struct {
		Manager map[string]bool `json:"manager"`
		Cashier map[string]bool `json:"cashier"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body) != nil {
		writeJSON(w, 400, map[string]string{"error": "ข้อมูลสิทธิ์ไม่ถูกต้อง"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer tx.Rollback()
	for role, permissions := range map[string]map[string]bool{"manager": normalizePOSPermissions(body.Manager), "cashier": normalizePOSPermissions(body.Cashier)} {
		raw, _ := json.Marshal(permissions)
		if _, err = tx.ExecContext(r.Context(), `insert into pos_role_permissions(admin_id,role,permissions,updated_by) values($1,$2,$3,$4) on conflict(admin_id,role) do update set permissions=excluded.permissions,updated_by=excluded.updated_by,updated_at=now()`, user.ID, role, raw, posActorID(user)); err != nil {
			writePOSInternalError(w, r, err)
			return
		}
	}
	if err = a.insertActivityLogTx(r.Context(), tx, posActorType(user), posActorID(user), "update_pos_permissions", "admin_user", user.ID, map[string]any{"adminId": user.ID, "manager": normalizePOSPermissions(body.Manager), "cashier": normalizePOSPermissions(body.Cashier)}); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	a.writePOSAccessSettings(w, r, user)
}

func posActorID(user adminUser) string {
	if user.POSActorID != "" {
		return user.POSActorID
	}
	return user.ID
}
func posActorName(user adminUser) string {
	if user.POSActorName != "" {
		return user.POSActorName
	}
	return user.Name
}
func posActorType(user adminUser) string {
	if user.POSActorType != "" {
		return user.POSActorType
	}
	return "admin"
}

func hasPOSPermission(user adminUser, permission string) bool {
	if user.POSRole == "owner" {
		return true
	}
	return user.POSPermissions[permission]
}

func requirePOSPermission(w http.ResponseWriter, user adminUser, permission string) bool {
	if !hasPOSPermission(user, permission) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "ไม่มีสิทธิ์ใช้งานเมนูนี้", "code": "pos_permission_denied"})
		return false
	}
	return true
}

func posReportPermission(reportType string) string {
	switch strings.TrimSpace(reportType) {
	case "overview":
		return "report_overview"
	case "top_sellers":
		return "report_top_sellers"
	case "vat":
		return "report_vat"
	case "payments":
		return "report_payments"
	case "sold_products":
		return "report_sold_products"
	case "purchases":
		return "report_purchases"
	case "inventory":
		return "report_inventory"
	case "transfers":
		return "report_transfers"
	case "special":
		return "report_special"
	default:
		return ""
	}
}

func requirePOSReportPermission(w http.ResponseWriter, user adminUser, reportType string) bool {
	permission := posReportPermission(reportType)
	if permission == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ประเภทรายงานไม่ถูกต้อง", "code": "invalid_report_type"})
		return false
	}
	return requirePOSPermission(w, user, "reports") && requirePOSPermission(w, user, permission)
}

func authorizePOSPath(w http.ResponseWriter, user adminUser, method, path string) bool {
	if path == "monitoring" {
		return requirePOSOwner(w, user)
	}
	if strings.HasPrefix(path, "access") || path == "permissions" || strings.HasPrefix(path, "staff") {
		return requirePOSOwner(w, user)
	}
	if path == "settings" {
		if method == http.MethodGet && (hasPOSPermission(user, "settings") || hasPOSPermission(user, "sales") || hasPOSPermission(user, "bills")) {
			return true
		}
		return requirePOSPermission(w, user, "settings")
	}
	if method == http.MethodPost && (path == "stock/batch" || (strings.HasPrefix(path, "products/") && strings.HasSuffix(path, "/stock"))) {
		return requirePOSPermission(w, user, "stock") && requirePOSPermission(w, user, "stock_adjust")
	}
	if strings.HasPrefix(path, "stock") || strings.HasPrefix(path, "suppliers") {
		return requirePOSPermission(w, user, "stock")
	}
	if strings.HasPrefix(path, "products") || strings.HasPrefix(path, "categories") || strings.HasPrefix(path, "units") {
		if method == http.MethodGet {
			if hasPOSPermission(user, "sales") || hasPOSPermission(user, "products") || hasPOSPermission(user, "stock") {
				return true
			}
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "ไม่มีสิทธิ์ดูข้อมูลสินค้า", "code": "pos_permission_denied"})
			return false
		}
		if strings.HasPrefix(path, "products") && (method == http.MethodPost || method == http.MethodPatch) {
			return requirePOSPermission(w, user, "products") && requirePOSPermission(w, user, "product_pricing")
		}
		return requirePOSPermission(w, user, "products")
	}
	if path == "overview" || path == "" {
		return requirePOSOwner(w, user)
	}
	if path == "reports/export-authorize" {
		return requirePOSPermission(w, user, "reports") && requirePOSPermission(w, user, "report_export")
	}
	if path == "dashboard" || path == "reports" || strings.HasPrefix(path, "reports/") {
		return requirePOSPermission(w, user, "reports")
	}
	if strings.HasPrefix(path, "sales/") && strings.HasSuffix(path, "/void") {
		return requirePOSPermission(w, user, "bills") && requirePOSPermission(w, user, "void_sales")
	}
	if method == http.MethodPost && path == "members" {
		return requirePOSPermission(w, user, "sales") && requirePOSPermission(w, user, "member_create")
	}
	if path == "receivables" || path == "payment-history" || path == "billing-summary" || path == "settlements" {
		if hasPOSPermission(user, "bills") || hasPOSPermission(user, "sales") {
			return true
		}
		return requirePOSPermission(w, user, "bills")
	}
	return requirePOSPermission(w, user, "sales")
}

func writePOSInternalError(w http.ResponseWriter, r *http.Request, err error) {
	w.Header().Set("Cache-Control", "no-store")
	requestID, _ := r.Context().Value(requestIDContextKey).(string)
	log.Printf("POS request failed request_id=%s: %v", requestID, err)
	writeJSON(w, http.StatusInternalServerError, map[string]string{
		"error": "ระบบขัดข้องชั่วคราว กรุณาลองใหม่",
		"code":  "internal_error",
	})
}
