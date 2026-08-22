package main

import (
	"context"
	cryptorand "crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const maxPOSIdentities = 3

var posPermissionKeys = []string{"sales", "bills", "products", "stock", "reports", "settings"}

type posPrincipal struct {
	User        adminUser
	StaffNumber string
}

type posStaffRecord struct {
	ID          string `json:"id"`
	StaffNumber string `json:"staffNumber"`
	Name        string `json:"name"`
	Email       string `json:"email"`
	Role        string `json:"role"`
	Active      bool   `json:"active"`
	IsOwner     bool   `json:"isOwner"`
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
	if role == "manager" {
		return map[string]bool{"sales": true, "bills": true, "products": true, "stock": true, "reports": true, "settings": false}
	}
	return map[string]bool{"sales": true, "bills": true, "products": false, "stock": false, "reports": false, "settings": false}
}

func normalizePOSPermissions(input map[string]bool) map[string]bool {
	result := map[string]bool{}
	for _, key := range posPermissionKeys {
		result[key] = input[key]
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
			result = normalizePOSPermissions(stored)
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
	remember := body.Remember == nil || *body.Remember
	user, passwordHash, adminErr := a.adminByPOSIdentifier(r.Context(), identifier)
	if adminErr == nil && bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(body.Password)) == nil {
		if !user.Verified {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "email not verified", "code": "email not verified"})
			return
		}
		if !a.features(r.Context(), user.ID).POSEnabled {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน POS กรุณาติดต่อผู้ดูแลระบบ", "code": "pos_not_enabled"})
			return
		}
		token := randHex(24)
		if err := insertAuthSessionWithPersistence(r.Context(), a.db, adminSessionKind, user.ID, token, remember); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		clearSessionCookies(w, r, posStaffSessionKind)
		setSessionCookiePersistence(w, r, adminSessionKind, token, remember)
		user.POSActorID, user.POSActorName, user.POSActorType, user.POSRole = user.ID, user.Name, "admin", "owner"
		user.POSPermissions = allPOSPermissions()
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
	if err != nil || bcrypt.CompareHashAndPassword([]byte(pinHash), []byte(body.Password)) != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "รหัสผู้ใช้หรือ PIN ไม่ถูกต้อง", "code": "invalid_login"})
		return
	}
	if !active || !enabled {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน POS กรุณาติดต่อผู้ดูแลระบบ", "code": "pos_not_enabled"})
		return
	}
	token := randHex(24)
	if err = insertAuthSessionWithPersistence(r.Context(), a.db, posStaffSessionKind, staffID, token, remember); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	clearSessionCookies(w, r, adminSessionKind)
	setSessionCookiePersistence(w, r, posStaffSessionKind, token, remember)
	principal, ok := a.currentPOSPrincipalForStaff(r.Context(), staffID)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "ไม่สามารถโหลดข้อมูลผู้ใช้ POS ได้"})
		return
	}
	a.writePOSMe(w, principal)
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
	if token, ok := readSessionCookie(r, posStaffSessionKind); ok {
		_, _ = a.db.ExecContext(r.Context(), `update pos_staff_sessions set revoked_at=coalesce(revoked_at,now()) where token_hash=$1 or previous_token_hash=$1`, tokenDigest(token))
	}
	if token, ok := readSessionCookie(r, adminSessionKind); ok {
		_, _ = a.db.ExecContext(r.Context(), `update admin_sessions set revoked_at=coalesce(revoked_at,now()) where token_hash=$1 or previous_token_hash=$1`, tokenDigest(token))
	}
	clearSessionCookies(w, r, posStaffSessionKind)
	clearSessionCookies(w, r, adminSessionKind)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func validPOSPIN(pin string) bool {
	if len(pin) < 4 || len(pin) > 6 {
		return false
	}
	for _, char := range pin {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func randomPOSPIN() string {
	value, err := cryptorand.Int(cryptorand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return fmt.Sprintf("%06d", timeNowUnix()%1_000_000)
	}
	return fmt.Sprintf("%06d", value.Int64())
}

func timeNowUnix() int64 { return timeNow().UnixNano() }

var timeNow = func() time.Time { return time.Now() }

func (a *app) listPOSStaff(ctx context.Context, user adminUser) ([]posStaffRecord, error) {
	items := []posStaffRecord{{ID: user.ID, StaffNumber: strconv.FormatInt(user.POSAdminNumber, 10), Name: user.Name, Email: user.Email, Role: "owner", Active: true, IsOwner: true}}
	rows, err := a.db.QueryContext(ctx, `select id,staff_number,name,email,role,active from pos_staff where admin_id=$1 order by created_at,id`, user.ID)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	for rows.Next() {
		var item posStaffRecord
		if err = rows.Scan(&item.ID, &item.StaffNumber, &item.Name, &item.Email, &item.Role, &item.Active); err != nil {
			return items, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (a *app) writePOSAccessSettings(w http.ResponseWriter, r *http.Request, user adminUser) {
	items, err := a.listPOSStaff(r.Context(), user)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "maxMembers": maxPOSIdentities, "permissions": map[string]any{"owner": allPOSPermissions(), "manager": a.posPermissions(r.Context(), user.ID, "manager"), "cashier": a.posPermissions(r.Context(), user.ID, "cashier")}})
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
		writeJSON(w, 400, map[string]string{"error": "กรุณากรอกชื่อ บทบาท และ PIN ตัวเลข 4-6 หลัก"})
		return
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(body.PIN), bcrypt.DefaultCost)
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), `select pg_advisory_xact_lock(hashtext($1))`, "pos-staff:"+user.ID); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	if body.Email != "" {
		if _, err = tx.ExecContext(r.Context(), `select pg_advisory_xact_lock(hashtext($1))`, "pos-login-email:"+body.Email); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		var inUse bool
		if inUse, err = posLoginEmailInUse(r.Context(), tx, body.Email, ""); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		if inUse {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "อีเมลนี้ถูกใช้เข้าสู่ระบบแล้ว", "code": "email_in_use"})
			return
		}
	}
	var count int
	if err = tx.QueryRowContext(r.Context(), `select count(*) from pos_staff where admin_id=$1`, user.ID).Scan(&count); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
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
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), "create_pos_staff", "pos_staff", id, map[string]any{"staffNumber": staffNumber, "role": body.Role})
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
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	if body.Email != "" {
		if _, err = tx.ExecContext(r.Context(), `select pg_advisory_xact_lock(hashtext($1))`, "pos-login-email:"+body.Email); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		var inUse bool
		if inUse, err = posLoginEmailInUse(r.Context(), tx, body.Email, staffID); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
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
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), "update_pos_staff", "pos_staff", staffID, map[string]any{"role": body.Role, "active": active})
	a.writePOSAccessSettings(w, r, user)
}

func (a *app) resetPOSStaffPIN(w http.ResponseWriter, r *http.Request, user adminUser, staffID string) {
	if !requirePOSOwner(w, user) {
		return
	}
	var body struct {
		PIN string `json:"pin"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body)
	body.PIN = strings.TrimSpace(body.PIN)
	if body.PIN == "" {
		body.PIN = randomPOSPIN()
	}
	if !validPOSPIN(body.PIN) {
		writeJSON(w, 400, map[string]string{"error": "PIN ต้องเป็นตัวเลข 4-6 หลัก"})
		return
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(body.PIN), bcrypt.DefaultCost)
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(r.Context(), `update pos_staff set pin_hash=$3,updated_at=now() where id=$1 and admin_id=$2`, staffID, user.ID, string(hash))
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		writeJSON(w, 404, map[string]string{"error": "ไม่พบสมาชิก"})
		return
	}
	_, _ = tx.ExecContext(r.Context(), `update pos_staff_sessions set revoked_at=coalesce(revoked_at,now()) where staff_id=$1`, staffID)
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), "reset_pos_staff_pin", "pos_staff", staffID, nil)
	writeJSON(w, 200, map[string]any{"status": "pin_reset", "pin": body.PIN})
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
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	for role, permissions := range map[string]map[string]bool{"manager": normalizePOSPermissions(body.Manager), "cashier": normalizePOSPermissions(body.Cashier)} {
		raw, _ := json.Marshal(permissions)
		if _, err = tx.ExecContext(r.Context(), `insert into pos_role_permissions(admin_id,role,permissions,updated_by) values($1,$2,$3,$4) on conflict(admin_id,role) do update set permissions=excluded.permissions,updated_by=excluded.updated_by,updated_at=now()`, user.ID, role, raw, posActorID(user)); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), "update_pos_permissions", "admin_user", user.ID, nil)
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
	if user.POSRole == "owner" || user.POSRole == "" {
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

func authorizePOSPath(w http.ResponseWriter, user adminUser, method, path string) bool {
	if path == "settings" && method == http.MethodGet && hasPOSPermission(user, "sales") {
		return true
	}
	if path == "access" || path == "permissions" || strings.HasPrefix(path, "staff") || path == "settings" {
		return requirePOSPermission(w, user, "settings")
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
		return requirePOSPermission(w, user, "products")
	}
	if path == "overview" || path == "" {
		if hasPOSPermission(user, "reports") || hasPOSPermission(user, "sales") {
			return true
		}
		return requirePOSPermission(w, user, "reports")
	}
	if strings.HasPrefix(path, "sales/") && strings.HasSuffix(path, "/void") {
		return requirePOSPermission(w, user, "bills")
	}
	if path == "receivables" || path == "payment-history" || path == "billing-summary" || path == "settlements" {
		if hasPOSPermission(user, "bills") || hasPOSPermission(user, "sales") {
			return true
		}
		return requirePOSPermission(w, user, "bills")
	}
	return requirePOSPermission(w, user, "sales")
}
