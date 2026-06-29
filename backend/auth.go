package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net"
	"net/http"
	"net/smtp"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const adminCookieName = "livematch_admin_session"

var (
	errCoinOrderNotFound = errors.New("coin order not found")
	errCoinOrderReviewed = errors.New("coin order reviewed already")
)

type adminUser struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Verified  bool   `json:"verified"`
	Coins     int    `json:"coins"`
	CreatedAt string `json:"createdAt"`
}

type adminSessionItem struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Type           string `json:"type"`
	Players        int    `json:"players"`
	PaidPlayers    int    `json:"paidPlayers"`
	UnpaidPlayers  int    `json:"unpaidPlayers"`
	Matches        int    `json:"matches"`
	QueueMatches   int    `json:"queueMatches"`
	LiveMatches    int    `json:"liveMatches"`
	HistoryMatches int    `json:"historyMatches"`
	Shuttles       int    `json:"shuttles"`
	Revenue        int    `json:"revenue"`
	UpdatedAt      string `json:"updatedAt"`
}

type coinLedgerItem struct {
	ID         int    `json:"id"`
	AdminID    string `json:"adminId"`
	AdminEmail string `json:"adminEmail,omitempty"`
	Delta      int    `json:"delta"`
	Balance    int    `json:"balance"`
	Reason     string `json:"reason"`
	Note       string `json:"note"`
	CreatedAt  string `json:"createdAt"`
}

type coinPackage struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	PriceTHB  int    `json:"priceThb"`
	Coins     int    `json:"coins"`
	BonusText string `json:"bonusText"`
	Active    bool   `json:"active"`
	SortOrder int    `json:"sortOrder"`
}

type coinPurchaseOrder struct {
	ID                   string `json:"id"`
	AdminID              string `json:"adminId"`
	AdminEmail           string `json:"adminEmail,omitempty"`
	PackageID            string `json:"packageId"`
	PriceTHB             int    `json:"priceThb"`
	Coins                int    `json:"coins"`
	SlipImage            string `json:"slipImage,omitempty"`
	Status               string `json:"status"`
	Note                 string `json:"note"`
	TransRef             string `json:"transRef"`
	SlipQRPayload        string `json:"slipQrPayload,omitempty"`
	DetectedAmountTHB    *int   `json:"detectedAmountThb,omitempty"`
	DetectedPaidAt       string `json:"detectedPaidAt,omitempty"`
	DetectedReceiver     string `json:"detectedReceiver,omitempty"`
	VerificationStatus   string `json:"verificationStatus"`
	VerificationNote     string `json:"verificationNote"`
	VerificationProvider string `json:"verificationProvider"`
	ProviderStatus       string `json:"providerStatus"`
	ProviderErrorCode    int    `json:"providerErrorCode,omitempty"`
	ProviderCheckedAt    string `json:"providerCheckedAt,omitempty"`
	CreatedAt            string `json:"createdAt"`
	ReviewedAt           string `json:"reviewedAt,omitempty"`
}

type activityLogItem struct {
	ID         int64  `json:"id"`
	ActorType  string `json:"actorType"`
	ActorID    string `json:"actorId"`
	Action     string `json:"action"`
	TargetType string `json:"targetType"`
	TargetID   string `json:"targetId"`
	Details    string `json:"details"`
	CreatedAt  string `json:"createdAt"`
}

func (a *app) handleAuthRoutes(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	action := strings.TrimPrefix(r.URL.Path, "/api/auth/")
	switch {
	case r.Method == http.MethodPost && action == "register":
		a.handleAdminRegister(w, r)
	case r.Method == http.MethodPost && action == "login":
		a.handleAdminLogin(w, r)
	case r.Method == http.MethodPost && action == "logout":
		a.handleAdminLogout(w, r)
	case r.Method == http.MethodGet && action == "me":
		a.handleAdminMe(w, r)
	case r.Method == http.MethodGet && action == "verify-email":
		a.handleVerifyEmail(w, r)
	case r.Method == http.MethodPost && action == "forgot-password":
		a.handleForgotPassword(w, r)
	case r.Method == http.MethodPost && action == "reset-password":
		a.handleResetPassword(w, r)
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	}
}

func (a *app) handleAdminRegister(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	email := normalizeEmail(body.Email)
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = email
	}
	if email == "" || len(body.Password) < 8 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email and password are required"})
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	adminID := "admin-" + randHex(8)
	token := randHex(24)
	tokenHash := tokenDigest(token)
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()

	if _, err = tx.ExecContext(r.Context(), `
		insert into admin_users (id, email, name, password_hash)
		values ($1, $2, $3, $4)
	`, adminID, email, name, string(hash)); err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "email already registered"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `
		insert into email_verification_tokens (token_hash, admin_id, expires_at)
		values ($1, $2, now() + interval '24 hours')
	`, tokenHash, adminID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = sendAppEmail(email, "ยืนยันอีเมล LiveMatch", verifyEmailText(r, token), verifyEmailHTML(r, token)); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "send verification email failed"})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"status": "verification_sent"})
}

func (a *app) handleAdminLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	user, passwordHash, err := a.adminByEmail(r.Context(), normalizeEmail(body.Email))
	if err != nil || bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(body.Password)) != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid login"})
		return
	}
	if !user.Verified {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "email not verified"})
		return
	}
	token := randHex(24)
	if _, err = a.db.ExecContext(r.Context(), `
		insert into admin_sessions (token_hash, admin_id, expires_at)
		values ($1, $2, now() + interval '30 days')
	`, tokenDigest(token), user.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	setAdminCookie(w, r, token)
	a.writeAdminMe(w, r, user)
}

func (a *app) handleAdminLogout(w http.ResponseWriter, r *http.Request) {
	if token, ok := readAdminCookie(r); ok {
		_, _ = a.db.ExecContext(r.Context(), `delete from admin_sessions where token_hash = $1`, tokenDigest(token))
	}
	clearAdminCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *app) handleAdminMe(w http.ResponseWriter, r *http.Request) {
	user, ok := a.currentAdmin(r.Context(), r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not logged in"})
		return
	}
	a.writeAdminMe(w, r, user)
}

func (a *app) writeAdminMe(w http.ResponseWriter, r *http.Request, user adminUser) {
	sessions, _ := a.adminSessions(r.Context(), user.ID)
	ledger, _ := a.coinLedger(r.Context(), user.ID, 8)
	liveMatchCost, hasLiveMatchCost, _ := a.liveMatchCost(r.Context())
	liveShareCost, hasLiveShareCost, _ := a.liveShareCost(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"user":                 user,
		"sessions":             sessions,
		"coinLedger":           ledger,
		"liveMatchSessionCost": nullableCost(liveMatchCost, hasLiveMatchCost),
		"liveShareSessionCost": nullableCost(liveShareCost, hasLiveShareCost),
	})
}

func (a *app) handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if prefersHTML(r) {
		target := "/verify-email"
		if token != "" {
			target += "?token=" + token
		}
		http.Redirect(w, r, target, http.StatusFound)
		return
	}
	if token == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "token required"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var adminID string
	err = tx.QueryRowContext(r.Context(), `
		select admin_id from email_verification_tokens
		where token_hash = $1 and used_at is null and expires_at > now()
	`, tokenDigest(token)).Scan(&adminID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid token"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `update admin_users set verified_at = now() where id = $1`, adminID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `update email_verification_tokens set used_at = now() where token_hash = $1`, tokenDigest(token)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "verified"})
}

func (a *app) handleForgotPassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	user, _, err := a.adminByEmail(r.Context(), normalizeEmail(body.Email))
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]string{"status": "reset_sent"})
		return
	}
	token := randHex(24)
	if _, err = a.db.ExecContext(r.Context(), `
		insert into password_reset_tokens (token_hash, admin_id, expires_at)
		values ($1, $2, now() + interval '2 hours')
	`, tokenDigest(token), user.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = sendAppEmail(user.Email, "รีเซ็ตรหัสผ่าน LiveMatch", resetPasswordText(r, token), resetPasswordHTML(r, token)); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "send reset email failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "reset_sent"})
}

func (a *app) handleResetPassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if strings.TrimSpace(body.Token) == "" || len(body.Password) < 8 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid reset"})
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var adminID string
	if err = tx.QueryRowContext(r.Context(), `
		select admin_id from password_reset_tokens
		where token_hash = $1 and used_at is null and expires_at > now()
	`, tokenDigest(body.Token)).Scan(&adminID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid token"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `update admin_users set password_hash = $2 where id = $1`, adminID, string(hash)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `update password_reset_tokens set used_at = now() where token_hash = $1`, tokenDigest(body.Token)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "password_reset"})
}

func (a *app) handleAdminSupervisorRoutes(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	user, ok := a.currentAdmin(r.Context(), r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not logged in"})
		return
	}
	action := strings.TrimPrefix(r.URL.Path, "/api/admin/")
	switch {
	case r.Method == http.MethodGet && action == "supervisor":
		a.writeAdminMe(w, r, user)
	case r.Method == http.MethodPost && action == "sessions":
		a.handleCreateOwnedSession(w, r, user)
	case r.Method == http.MethodGet && action == "coin-shop":
		a.handleAdminCoinShop(w, r, user)
	case r.Method == http.MethodGet && action == "coin-orders":
		a.handleAdminCoinOrders(w, r, user)
	case r.Method == http.MethodPost && action == "coin-orders":
		a.handleCreateCoinOrder(w, r, user)
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	}
}

func (a *app) handleCreateOwnedSession(w http.ResponseWriter, r *http.Request, user adminUser) {
	var body struct {
		Name string `json:"name"`
		Type string `json:"type"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	sessionType := strings.TrimSpace(body.Type)
	if sessionType == "" {
		sessionType = "liveMatch"
	}
	sessionType = normalizeSessionType(sessionType)
	cost, hasCost, err := a.sessionCoinCost(r.Context(), sessionType)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !hasCost {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "ยังไม่ได้ตั้งราคา coin"})
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = "แบดวันนี้"
	}
	id := "session-" + randHex(6)
	state := defaultState(id, name, "")
	state.Session.Type = sessionType
	if sessionType == "liveShare" {
		state.Settings.StartMatchWithShuttle = false
	}
	state.Session.Unlocked = true
	stateJSON, _ := json.Marshal(state)
	courtNames, _ := json.Marshal(state.Settings.CourtNames)
	levels, _ := json.Marshal(state.Settings.Levels)

	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var currentCoins int
	if err = tx.QueryRowContext(r.Context(), `select coins from admin_users where id = $1 for update`, user.ID).Scan(&currentCoins); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if currentCoins < cost {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "coin ไม่พอ"})
		return
	}
	newBalance := currentCoins - cost
	if _, err = tx.ExecContext(r.Context(), `update admin_users set coins = $2 where id = $1`, user.ID, newBalance); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `
		insert into sessions (id, name, session_type, admin_passcode, state, admin_id, updated_at)
		values ($1, $2, $3, '', $4, $5, now())
	`, id, name, sessionType, stateJSON, user.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `
		insert into session_settings (
			session_id, entry_fee, court_fee_per_hour, shuttle_fee, session_fee, court_count, court_names, levels, allow_cross_level, cross_level_range, random_priority, show_payment_on_share, reset_players_after_finish, start_match_with_shuttle
		) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
	`, id, state.Settings.EntryFee, state.Settings.CourtFeePerHour, state.Settings.ShuttleFee, state.Settings.SessionFee, state.Settings.CourtCount, courtNames, levels, state.Settings.AllowCrossLevel, state.Settings.CrossLevelRange, state.Settings.RandomPriority, state.Settings.ShowPaymentOnShare, state.Settings.ResetPlayersAfterFinish, state.Settings.StartMatchWithShuttle); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `
		insert into coin_ledger (admin_id, delta, balance, reason, note)
		values ($1, $2, $3, 'create_session', $4)
	`, user.ID, -cost, newBalance, sessionType+" "+id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = a.insertActivityLogTx(r.Context(), tx, "admin", user.ID, "create_session_spend_coin", "session", id, map[string]any{"cost": cost, "balance": newBalance, "name": name, "type": sessionType}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	nextState, err := a.loadState(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	nextState.Session.Unlocked = true
	writeJSON(w, http.StatusCreated, SessionRecord{ID: id, Name: name, State: nextState})
}

func (a *app) handleAdminCoinShop(w http.ResponseWriter, r *http.Request, user adminUser) {
	packages, err := a.coinPackages(r.Context(), true)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	orders, err := a.coinPurchaseOrders(r.Context(), user.ID, true, 20)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	qrImage, _ := a.systemSetting(r.Context(), "coinPaymentQrImage")
	promptPay := a.promptPaySettings(r.Context())
	promptPayPayloads := promptPayPayloadsForPackages(promptPay, packages)
	writeJSON(w, http.StatusOK, map[string]any{
		"packages":              packages,
		"paymentQrImage":        qrImage,
		"promptPayId":           promptPay.ID,
		"promptPayType":         promptPay.Type,
		"promptPayReceiverName": promptPay.ReceiverName,
		"promptPayPayloads":     promptPayPayloads,
		"promptPayAvailable":    len(promptPayPayloads) > 0,
		"orders":                orders,
	})
}

func (a *app) handleCreateCoinOrder(w http.ResponseWriter, r *http.Request, user adminUser) {
	var body struct {
		PackageID string `json:"packageId"`
		SlipImage string `json:"slipImage"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	body.PackageID = strings.TrimSpace(body.PackageID)
	body.SlipImage = strings.TrimSpace(body.SlipImage)
	if body.PackageID == "" || body.SlipImage == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "กรุณาเลือกโปรโมชันและอัปโหลดสลิป"})
		return
	}
	if len(body.SlipImage) > 2_500_000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "รูปสลิปใหญ่เกินไป"})
		return
	}
	var pkg coinPackage
	err := a.db.QueryRowContext(r.Context(), `
		select id, name, price_thb, coins, bonus_text, active, sort_order
		from coin_packages
		where id = $1 and active
	`, body.PackageID).Scan(&pkg.ID, &pkg.Name, &pkg.PriceTHB, &pkg.Coins, &pkg.BonusText, &pkg.Active, &pkg.SortOrder)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "ไม่พบโปรโมชันนี้"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	promptPay := a.promptPaySettings(r.Context())
	slipCheck := inspectSlipImage(body.SlipImage, pkg.PriceTHB, promptPay, time.Now())
	orderStatus := "pending"
	provider := "local"
	providerStatus := "not_checked"
	providerErrorCode := 0
	slipOK := a.slipOKSettings(r.Context())
	if slipOK.ready() {
		quota := a.fetchSlipOKQuota(r.Context(), slipOK)
		if quota.Available && !quota.CapReached {
			checked := a.checkSlipOK(r.Context(), slipOK, body.SlipImage, pkg.PriceTHB)
			provider = "slipok"
			providerStatus = checked.Status
			providerErrorCode = checked.ErrorCode
			if checked.TransRef != "" {
				slipCheck.TransRef = checked.TransRef
			}
			if checked.AmountTHB != nil {
				slipCheck.DetectedAmountTHB = checked.AmountTHB
			}
			if checked.PaidAt != "" {
				slipCheck.DetectedPaidAt = checked.PaidAt
			}
			if checked.Receiver != "" {
				slipCheck.DetectedReceiver = checked.Receiver
			}
			slipCheck.VerificationStatus = checked.Status
			slipCheck.VerificationNote = checked.Note
			if checked.Passed {
				orderStatus = "approved"
			}
		} else if quota.CapReached {
			provider = "slipok"
			providerStatus = "cap_reached"
			slipCheck.VerificationStatus = "manual_review"
			slipCheck.VerificationNote = "SlipOK ถึงขีดจำกัดรายเดือน ใช้การตรวจสอบด้วยผู้ดูแล"
		} else {
			provider = "slipok"
			providerStatus = "quota_unavailable"
			slipCheck.VerificationStatus = "manual_review"
			slipCheck.VerificationNote = "ตรวจสอบโควตา SlipOK ไม่สำเร็จ: " + quota.Error
		}
	}
	if slipCheck.TransRef != "" {
		var existingID string
		err = a.db.QueryRowContext(r.Context(), `
			select id from coin_purchase_orders
			where trans_ref = $1
			limit 1
		`, slipCheck.TransRef).Scan(&existingID)
		if err == nil {
			a.insertActivityLog(r.Context(), "admin", user.ID, "duplicate_coin_purchase_slip", "coin_purchase_order", existingID, map[string]any{"transRef": slipCheck.TransRef, "packageId": pkg.ID})
			if provider == "slipok" && orderStatus == "pending" {
				slipCheck.VerificationStatus = "duplicate"
				slipCheck.VerificationNote += " | transRef ซ้ำกับรายการ " + existingID
				slipCheck.TransRef = ""
				err = sql.ErrNoRows
			} else {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "สลิปนี้เคยถูกส่งเข้าระบบแล้ว"})
				return
			}
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
	}
	id := "coin-order-" + randHex(8)
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), `
		insert into coin_purchase_orders (
			id, admin_id, package_id, price_thb, coins, slip_image, status,
			trans_ref, slip_qr_payload, detected_amount_thb, detected_paid_at, detected_receiver,
			verification_status, verification_note, verification_provider, provider_status,
			provider_error_code, provider_checked_at, reviewed_at
		)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
			case when $15 = 'slipok' then now() else null end,
			case when $7 = 'approved' then now() else null end)
	`, id, user.ID, pkg.ID, pkg.PriceTHB, pkg.Coins, body.SlipImage, orderStatus, slipCheck.TransRef, slipCheck.QRPayload, slipCheck.DetectedAmountTHB, slipCheck.DetectedPaidAt, slipCheck.DetectedReceiver, slipCheck.VerificationStatus, slipCheck.VerificationNote, provider, providerStatus, providerErrorCode); err != nil {
		if strings.Contains(err.Error(), "idx_coin_purchase_orders_trans_ref") || strings.Contains(err.Error(), "duplicate key") {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "สลิปนี้เคยถูกส่งเข้าระบบแล้ว"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if orderStatus == "approved" {
		var current int
		if err = tx.QueryRowContext(r.Context(), `select coins from admin_users where id = $1 for update`, user.ID).Scan(&current); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		next := current + pkg.Coins
		if _, err = tx.ExecContext(r.Context(), `update admin_users set coins = $2, updated_at = now() where id = $1`, user.ID, next); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if _, err = tx.ExecContext(r.Context(), `
			insert into coin_ledger (admin_id, delta, balance, reason, note)
			values ($1, $2, $3, 'coin_purchase', $4)
		`, user.ID, pkg.Coins, next, "SlipOK auto-approved order "+id); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
	}
	if err = a.insertActivityLogTx(r.Context(), tx, "admin", user.ID, "submit_coin_purchase", "coin_purchase_order", id, map[string]any{"packageId": pkg.ID, "priceThb": pkg.PriceTHB, "coins": pkg.Coins, "transRef": slipCheck.TransRef, "verificationStatus": slipCheck.VerificationStatus, "verificationNote": slipCheck.VerificationNote}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	a.notifyTelegramCoinOrder(r.Context(), coinPurchaseOrder{
		ID:                 id,
		AdminID:            user.ID,
		AdminEmail:         user.Email,
		PackageID:          pkg.ID,
		PriceTHB:           pkg.PriceTHB,
		Coins:              pkg.Coins,
		SlipImage:          body.SlipImage,
		TransRef:           slipCheck.TransRef,
		VerificationStatus: slipCheck.VerificationStatus,
		VerificationNote:   slipCheck.VerificationNote,
		Status:             orderStatus,
	}, user)
	a.handleAdminCoinShop(w, r, user)
}

func (a *app) handleBackofficeRoutes(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	backofficeUser, ok := a.authenticateBackoffice(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid backoffice login"})
		return
	}
	action := strings.TrimPrefix(r.URL.Path, "/api/backoffice/")
	switch {
	case r.Method == http.MethodGet && action == "summary":
		a.handleBackofficeSummary(w, r)
	case r.Method == http.MethodGet && action == "activity-logs":
		a.handleBackofficeActivityLogs(w, r)
	case r.Method == http.MethodGet && action == "coin-orders":
		a.handleBackofficeCoinOrders(w, r)
	case strings.HasPrefix(action, "support-issues"):
		a.handleBackofficeSupportIssues(w, r, backofficeUser)
	case r.Method == http.MethodGet && strings.HasPrefix(action, "admins/"):
		a.handleBackofficeAdminDetail(w, r)
	case r.Method == http.MethodPut && action == "settings":
		a.handleBackofficeSettings(w, r, backofficeUser)
	case r.Method == http.MethodPut && action == "coin-shop":
		a.handleBackofficeCoinShop(w, r, backofficeUser)
	case r.Method == http.MethodPost && action == "telegram-webhook":
		a.handleBackofficeTelegramWebhookSetup(w, r, backofficeUser)
	case r.Method == http.MethodGet && action == "slipok-quota":
		a.handleBackofficeSlipOKQuota(w, r)
	case r.Method == http.MethodPost && action == "coins":
		a.handleBackofficeCoinAdjust(w, r, backofficeUser)
	case r.Method == http.MethodPost && strings.HasPrefix(action, "coin-orders/") && strings.HasSuffix(action, "/approve"):
		a.handleBackofficeCoinOrderReview(w, r, "approved", backofficeUser)
	case r.Method == http.MethodPost && strings.HasPrefix(action, "coin-orders/") && strings.HasSuffix(action, "/reject"):
		a.handleBackofficeCoinOrderReview(w, r, "rejected", backofficeUser)
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	}
}

func paginationParams(r *http.Request, defaultSize, maxSize int) (int, int, int) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = defaultSize
	}
	if pageSize > maxSize {
		pageSize = maxSize
	}
	return page, pageSize, (page - 1) * pageSize
}

func paginationPayload(page, pageSize, total int) map[string]int {
	totalPages := 0
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	return map[string]int{
		"page":       page,
		"pageSize":   pageSize,
		"total":      total,
		"totalPages": totalPages,
	}
}

func (a *app) handleAdminCoinOrders(w http.ResponseWriter, r *http.Request, user adminUser) {
	page, pageSize, _ := paginationParams(r, 10, 50)
	orders, total, err := a.coinPurchaseOrdersPage(r.Context(), user.ID, true, page, pageSize)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"orders":     orders,
		"pagination": paginationPayload(page, pageSize, total),
	})
}

func (a *app) handleBackofficeCoinOrders(w http.ResponseWriter, r *http.Request) {
	page, pageSize, _ := paginationParams(r, 10, 50)
	orders, total, err := a.coinPurchaseOrdersPage(r.Context(), "", true, page, pageSize)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"orders":     orders,
		"pagination": paginationPayload(page, pageSize, total),
	})
}

func (a *app) handleBackofficeActivityLogs(w http.ResponseWriter, r *http.Request) {
	page, pageSize, _ := paginationParams(r, 20, 100)
	userID := strings.TrimSpace(r.URL.Query().Get("userId"))
	sessionID := strings.TrimSpace(r.URL.Query().Get("sessionId"))
	logs, total, err := a.activityLogsPage(r.Context(), page, pageSize, userID, sessionID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	sessionOptions := []map[string]any{}
	if userID != "" {
		sessionOptions, _ = a.activitySessionOptions(r.Context(), userID)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"logs":           logs,
		"sessionOptions": sessionOptions,
		"pagination":     paginationPayload(page, pageSize, total),
	})
}

func (a *app) activitySessionOptions(ctx context.Context, adminID string) ([]map[string]any, error) {
	items := []map[string]any{}
	rows, err := a.db.QueryContext(ctx, `
		select s.id, coalesce(s.name, s.id)
		from sessions s
		where s.admin_id = $1
		order by s.updated_at desc
	`, adminID)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	for rows.Next() {
		var sessionID, sessionName string
		if err := rows.Scan(&sessionID, &sessionName); err != nil {
			return items, err
		}
		items = append(items, map[string]any{
			"id":    sessionID,
			"label": sessionName,
		})
	}
	return items, rows.Err()
}

func (a *app) handleBackofficeAdminDetail(w http.ResponseWriter, r *http.Request) {
	adminID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/api/backoffice/admins/"))
	if adminID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing admin id"})
		return
	}
	var user adminUser
	err := a.db.QueryRowContext(r.Context(), `
		select id, email, name, verified_at is not null, coins,
			to_char(created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI')
		from admin_users
		where id = $1
	`, adminID).Scan(&user.ID, &user.Email, &user.Name, &user.Verified, &user.Coins, &user.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "admin not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	sessions, _ := a.adminSessions(r.Context(), adminID)
	ledger, _ := a.coinLedger(r.Context(), adminID, 20)
	orders, _ := a.coinPurchaseOrders(r.Context(), adminID, true, 20)
	writeJSON(w, http.StatusOK, map[string]any{
		"user":       user,
		"sessions":   sessions,
		"coinLedger": ledger,
		"orders":     orders,
	})
}

func (a *app) handleBackofficeSummary(w http.ResponseWriter, r *http.Request) {
	users := []map[string]any{}
	rows, err := a.db.QueryContext(r.Context(), `
		select u.id, u.email, u.name, u.verified_at is not null, u.coins,
			(select count(*) from sessions s where s.admin_id = u.id),
			to_char(u.created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI')
		from admin_users u
		order by u.created_at desc
	`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id, email, name, createdAt string
		var verified bool
		var coins, sessions int
		if err := rows.Scan(&id, &email, &name, &verified, &coins, &sessions, &createdAt); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		users = append(users, map[string]any{"id": id, "email": email, "name": name, "verified": verified, "coins": coins, "sessions": sessions, "createdAt": createdAt})
	}
	ledger, _ := a.coinLedger(r.Context(), "", 30)
	liveMatchCost, hasLiveMatchCost, _ := a.liveMatchCost(r.Context())
	liveShareCost, hasLiveShareCost, _ := a.liveShareCost(r.Context())
	packages, _ := a.coinPackages(r.Context(), false)
	orders, _ := a.coinPurchaseOrders(r.Context(), "", true, 50)
	logs, _ := a.activityLogs(r.Context(), 80)
	qrImage, _ := a.systemSetting(r.Context(), "coinPaymentQrImage")
	promptPay := a.promptPaySettings(r.Context())
	telegramSettings := a.telegramNotifySettings(r.Context())
	slipOKSettings := a.slipOKSettings(r.Context())
	slipOKQuota := a.fetchSlipOKQuota(r.Context(), slipOKSettings)
	if telegramSettings.WebhookSecret == "" {
		telegramSettings.WebhookSecret = a.ensureTelegramWebhookSecret(r.Context())
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"users":                 users,
		"coinLedger":            ledger,
		"liveMatchSessionCost":  nullableCost(liveMatchCost, hasLiveMatchCost),
		"liveShareSessionCost":  nullableCost(liveShareCost, hasLiveShareCost),
		"coinPackages":          packages,
		"coinPaymentQrImage":    qrImage,
		"promptPayId":           promptPay.ID,
		"promptPayType":         promptPay.Type,
		"promptPayReceiverName": promptPay.ReceiverName,
		"promptPayPayloads":     promptPayPayloadsForPackages(promptPay, packages),
		"telegramBotToken":      telegramSettings.BotToken,
		"telegramChatId":        telegramSettings.ChatID,
		"telegramWebhookSecret": telegramSettings.WebhookSecret,
		"telegramWebhookUrl":    telegramWebhookURL(telegramSettings),
		"telegramNotifyEnabled": telegramSettings.enabled(),
		"slipOKEnabled":         slipOKSettings.Enabled,
		"slipOKBranchId":        slipOKSettings.BranchID,
		"slipOKApiKeyMasked":    maskSecret(slipOKSettings.APIKey),
		"slipOKMonthlyCap":      slipOKSettings.MonthlyCap,
		"slipOKQuota":           slipOKQuota,
		"coinPurchaseOrders":    orders,
		"activityLogs":          logs,
	})
}

func (a *app) handleBackofficeSettings(w http.ResponseWriter, r *http.Request, actor string) {
	var body struct {
		LiveMatchSessionCost *int `json:"liveMatchSessionCost"`
		LiveShareSessionCost *int `json:"liveShareSessionCost"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.LiveMatchSessionCost == nil || *body.LiveMatchSessionCost < 0 || body.LiveShareSessionCost == nil || *body.LiveShareSessionCost < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid coin price"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(), `
		insert into system_settings (key, value)
		values ('liveMatchSessionCoinCost', $1)
		on conflict (key) do update set value = excluded.value, updated_at = now()
	`, strconv.Itoa(*body.LiveMatchSessionCost)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if _, err := tx.ExecContext(r.Context(), `
		insert into system_settings (key, value)
		values ('liveShareSessionCoinCost', $1)
		on conflict (key) do update set value = excluded.value, updated_at = now()
	`, strconv.Itoa(*body.LiveShareSessionCost)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err := a.insertActivityLogTx(r.Context(), tx, "backoffice", actor, "update_session_coin_cost", "system_settings", "sessionCoinCost", map[string]any{"liveMatchCost": *body.LiveMatchSessionCost, "liveShareCost": *body.LiveShareSessionCost}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err := tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	a.handleBackofficeSummary(w, r)
}

func (a *app) handleBackofficeCoinShop(w http.ResponseWriter, r *http.Request, actor string) {
	var body struct {
		Packages              []coinPackage `json:"packages"`
		PaymentQrImage        string        `json:"paymentQrImage"`
		PromptPayID           string        `json:"promptPayId"`
		PromptPayType         string        `json:"promptPayType"`
		PromptPayReceiverName string        `json:"promptPayReceiverName"`
		TelegramBotToken      string        `json:"telegramBotToken"`
		TelegramChatID        string        `json:"telegramChatId"`
		TelegramWebhookSecret string        `json:"telegramWebhookSecret"`
		SlipOKEnabled         bool          `json:"slipOKEnabled"`
		SlipOKBranchID        string        `json:"slipOKBranchId"`
		SlipOKAPIKey          string        `json:"slipOKApiKey"`
		SlipOKMonthlyCap      int           `json:"slipOKMonthlyCap"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if len(body.Packages) > 12 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "too many packages"})
		return
	}
	if body.SlipOKMonthlyCap < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "SlipOK monthly cap ต้องไม่น้อยกว่า 0"})
		return
	}
	currentSlipOK := a.slipOKSettings(r.Context())
	slipOKAPIKey := strings.TrimSpace(body.SlipOKAPIKey)
	if slipOKAPIKey == "" {
		slipOKAPIKey = currentSlipOK.APIKey
	}
	promptPayID := strings.TrimSpace(body.PromptPayID)
	promptPayType := strings.TrimSpace(body.PromptPayType)
	if promptPayType == "" {
		promptPayType = "mobile"
	}
	if promptPayID != "" {
		if _, _, err := normalizePromptPayTarget(promptPaySettings{ID: promptPayID, Type: promptPayType}); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "PromptPay setting ไม่ถูกต้อง"})
			return
		}
	}
	telegramWebhookSecret := strings.TrimSpace(body.TelegramWebhookSecret)
	if telegramWebhookSecret == "" {
		telegramWebhookSecret = a.ensureTelegramWebhookSecret(r.Context())
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), `
		insert into system_settings (key, value)
		values ('coinPaymentQrImage', $1)
		on conflict (key) do update set value = excluded.value, updated_at = now()
	`, strings.TrimSpace(body.PaymentQrImage)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	for key, value := range map[string]string{
		"promptPayId":           promptPayID,
		"promptPayType":         promptPayType,
		"promptPayReceiverName": strings.TrimSpace(body.PromptPayReceiverName),
		"telegramBotToken":      strings.TrimSpace(body.TelegramBotToken),
		"telegramChatId":        strings.TrimSpace(body.TelegramChatID),
		"telegramWebhookSecret": telegramWebhookSecret,
		"slipOKEnabled":         strconv.FormatBool(body.SlipOKEnabled),
		"slipOKBranchId":        normalizeSlipOKBranchID(body.SlipOKBranchID),
		"slipOKApiKey":          slipOKAPIKey,
		"slipOKMonthlyCap":      strconv.Itoa(body.SlipOKMonthlyCap),
	} {
		if _, err = tx.ExecContext(r.Context(), `
			insert into system_settings (key, value)
			values ($1, $2)
			on conflict (key) do update set value = excluded.value, updated_at = now()
		`, key, value); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
	}
	if _, err = tx.ExecContext(r.Context(), `update coin_packages set active = false, updated_at = now()`); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	for index, pkg := range body.Packages {
		pkg.ID = strings.TrimSpace(pkg.ID)
		pkg.Name = strings.TrimSpace(pkg.Name)
		pkg.BonusText = strings.TrimSpace(pkg.BonusText)
		if pkg.ID == "" {
			pkg.ID = "coin-package-" + randHex(6)
		}
		if pkg.Name == "" || pkg.PriceTHB <= 0 || pkg.Coins <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid coin package"})
			return
		}
		sortOrder := pkg.SortOrder
		if sortOrder == 0 {
			sortOrder = index + 1
		}
		if _, err = tx.ExecContext(r.Context(), `
			insert into coin_packages (id, name, price_thb, coins, bonus_text, active, sort_order)
			values ($1, $2, $3, $4, $5, $6, $7)
			on conflict (id) do update set
				name = excluded.name,
				price_thb = excluded.price_thb,
				coins = excluded.coins,
				bonus_text = excluded.bonus_text,
				active = excluded.active,
				sort_order = excluded.sort_order,
				updated_at = now()
		`, pkg.ID, pkg.Name, pkg.PriceTHB, pkg.Coins, pkg.BonusText, pkg.Active, sortOrder); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
	}
	if err = a.insertActivityLogTx(r.Context(), tx, "backoffice", actor, "update_coin_shop", "coin_shop", "coin_packages", map[string]any{"packageCount": len(body.Packages), "hasQr": strings.TrimSpace(body.PaymentQrImage) != "", "hasPromptPay": promptPayID != "", "promptPayType": promptPayType, "telegramNotifyEnabled": strings.TrimSpace(body.TelegramBotToken) != "" && strings.TrimSpace(body.TelegramChatID) != ""}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	a.handleBackofficeSummary(w, r)
}

func (a *app) handleBackofficeSlipOKQuota(w http.ResponseWriter, r *http.Request) {
	settings := a.slipOKSettings(r.Context())
	quota := a.fetchSlipOKQuota(r.Context(), settings)
	if !quota.Available {
		writeJSON(w, http.StatusBadGateway, quota)
		return
	}
	writeJSON(w, http.StatusOK, quota)
}

func (a *app) handleBackofficeCoinAdjust(w http.ResponseWriter, r *http.Request, actor string) {
	var body struct {
		AdminID string `json:"adminId"`
		Delta   int    `json:"delta"`
		Note    string `json:"note"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if strings.TrimSpace(body.AdminID) == "" || body.Delta == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid coin adjustment"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var current int
	if err = tx.QueryRowContext(r.Context(), `select coins from admin_users where id = $1 for update`, body.AdminID).Scan(&current); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "admin not found"})
		return
	}
	next := current + body.Delta
	if next < 0 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "coin balance cannot be negative"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `update admin_users set coins = $2 where id = $1`, body.AdminID, next); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `
		insert into coin_ledger (admin_id, delta, balance, reason, note)
		values ($1, $2, $3, 'manual_adjustment', $4)
	`, body.AdminID, body.Delta, next, strings.TrimSpace(body.Note)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = a.insertActivityLogTx(r.Context(), tx, "backoffice", actor, "manual_coin_adjustment", "admin_user", body.AdminID, map[string]any{"delta": body.Delta, "balance": next, "note": strings.TrimSpace(body.Note)}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	a.handleBackofficeSummary(w, r)
}

func (a *app) handleBackofficeCoinOrderReview(w http.ResponseWriter, r *http.Request, status string, actor string) {
	action := strings.TrimPrefix(r.URL.Path, "/api/backoffice/coin-orders/")
	action = strings.TrimSuffix(action, "/approve")
	action = strings.TrimSuffix(action, "/reject")
	orderID := strings.TrimSpace(action)
	var body struct {
		Note string `json:"note"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if orderID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing order id"})
		return
	}
	if err := a.reviewCoinOrder(r.Context(), orderID, status, "backoffice", actor, strings.TrimSpace(body.Note)); errors.Is(err, errCoinOrderNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "order not found"})
		return
	} else if errors.Is(err, errCoinOrderReviewed) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "order reviewed already"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	a.handleBackofficeSummary(w, r)
}

func (a *app) reviewCoinOrder(ctx context.Context, orderID, status, actorType, actorID, note string) error {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var order coinPurchaseOrder
	if err = tx.QueryRowContext(ctx, `
		select id, admin_id, package_id, price_thb, coins, status
		from coin_purchase_orders
		where id = $1
		for update
	`, orderID).Scan(&order.ID, &order.AdminID, &order.PackageID, &order.PriceTHB, &order.Coins, &order.Status); errors.Is(err, sql.ErrNoRows) {
		return errCoinOrderNotFound
	} else if err != nil {
		return err
	}
	if order.Status != "pending" {
		return errCoinOrderReviewed
	}
	note = strings.TrimSpace(note)
	if status == "approved" {
		var current int
		if err = tx.QueryRowContext(ctx, `select coins from admin_users where id = $1 for update`, order.AdminID).Scan(&current); err != nil {
			return err
		}
		next := current + order.Coins
		if _, err = tx.ExecContext(ctx, `update admin_users set coins = $2 where id = $1`, order.AdminID, next); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `
			insert into coin_ledger (admin_id, delta, balance, reason, note)
			values ($1, $2, $3, 'coin_purchase', $4)
		`, order.AdminID, order.Coins, next, "order "+order.ID); err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, `
		update coin_purchase_orders
		set status = $2, note = $3, updated_at = now(), reviewed_at = now()
		where id = $1
	`, order.ID, status, note); err != nil {
		return err
	}
	actionName := "reject_coin_purchase"
	if status == "approved" {
		actionName = "approve_coin_purchase"
	}
	if err = a.insertActivityLogTx(ctx, tx, actorType, actorID, actionName, "coin_purchase_order", order.ID, map[string]any{"adminId": order.AdminID, "priceThb": order.PriceTHB, "coins": order.Coins, "note": note}); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return nil
}

func (a *app) currentAdmin(ctx context.Context, r *http.Request) (adminUser, bool) {
	token, ok := readAdminCookie(r)
	if !ok {
		return adminUser{}, false
	}
	var user adminUser
	err := a.db.QueryRowContext(ctx, `
		select u.id, u.email, u.name, u.verified_at is not null, u.coins,
			to_char(u.created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI')
		from admin_sessions s
		join admin_users u on u.id = s.admin_id
		where s.token_hash = $1 and s.expires_at > now()
	`, tokenDigest(token)).Scan(&user.ID, &user.Email, &user.Name, &user.Verified, &user.Coins, &user.CreatedAt)
	return user, err == nil
}

func (a *app) adminByEmail(ctx context.Context, email string) (adminUser, string, error) {
	var user adminUser
	var passwordHash string
	err := a.db.QueryRowContext(ctx, `
		select id, email, name, password_hash, verified_at is not null, coins,
			to_char(created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI')
		from admin_users
		where email = $1
	`, email).Scan(&user.ID, &user.Email, &user.Name, &passwordHash, &user.Verified, &user.Coins, &user.CreatedAt)
	return user, passwordHash, err
}

func (a *app) adminSessions(ctx context.Context, adminID string) ([]adminSessionItem, error) {
	items := []adminSessionItem{}
	rows, err := a.db.QueryContext(ctx, `
		select s.id, coalesce(s.name, s.id), coalesce(s.session_type, 'liveMatch'),
			(select count(*) from players p where p.session_id = s.id and p.active) as players,
			(select count(*) from players p where p.session_id = s.id and p.active and p.paid) as paid_players,
			(select count(*) from players p where p.session_id = s.id and p.active and not p.paid) as unpaid_players,
			(select count(*) from matches m where m.session_id = s.id and m.phase in ('live', 'history') and m.status <> 'cancelled') as matches,
			(select count(*) from matches m where m.session_id = s.id and m.phase = 'queue') as queue_matches,
			(select count(*) from matches m where m.session_id = s.id and m.phase = 'live') as live_matches,
			(select count(*) from matches m where m.session_id = s.id and m.phase = 'history' and m.status <> 'cancelled') as history_matches,
			case when coalesce(s.session_type, 'liveMatch') = 'liveShare' then
				(select coalesce(sum(h.quantity), 0) from live_share_hours h where h.session_id = s.id and h.kind = 'shuttle')
			else
				(select coalesce(sum(m.shuttles), 0) from matches m where m.session_id = s.id and m.status <> 'cancelled')
			end as shuttles,
			case when coalesce(s.session_type, 'liveMatch') = 'liveShare' then
				(
					(select count(*) from live_share_hours h where h.session_id = s.id and h.kind = 'court') * coalesce((select ss.court_fee_per_hour from session_settings ss where ss.session_id = s.id), 0)
				) + (
					(select coalesce(sum(h.quantity), 0) from live_share_hours h where h.session_id = s.id and h.kind = 'shuttle') * coalesce((select ss.shuttle_fee from session_settings ss where ss.session_id = s.id), 0)
				) + (
					coalesce((select ss.session_fee from session_settings ss where ss.session_id = s.id), 0)
				)
			else (
				select coalesce(sum(ss.entry_fee + p.shuttles * ss.shuttle_fee + ceiling(ss.session_fee::numeric / nullif((select count(*) from players ap where ap.session_id = p.session_id and ap.active), 0))::int), 0)
				from players p
				join session_settings ss on ss.session_id = p.session_id
				where p.session_id = s.id and p.active
			) end as revenue,
			to_char(s.updated_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') as updated_at
		from sessions s
		where s.admin_id = $1
		order by s.updated_at desc
	`, adminID)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	for rows.Next() {
		var item adminSessionItem
		if err := rows.Scan(&item.ID, &item.Name, &item.Type, &item.Players, &item.PaidPlayers, &item.UnpaidPlayers, &item.Matches, &item.QueueMatches, &item.LiveMatches, &item.HistoryMatches, &item.Shuttles, &item.Revenue, &item.UpdatedAt); err != nil {
			return items, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (a *app) coinLedger(ctx context.Context, adminID string, limit int) ([]coinLedgerItem, error) {
	items := []coinLedgerItem{}
	where := ""
	args := []any{limit}
	if adminID != "" {
		where = "where l.admin_id = $2"
		args = append(args, adminID)
	}
	rows, err := a.db.QueryContext(ctx, fmt.Sprintf(`
		select l.id, l.admin_id, coalesce(u.email, ''), l.delta, l.balance, l.reason, l.note,
			to_char(l.created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI')
		from coin_ledger l
		left join admin_users u on u.id = l.admin_id
		%s
		order by l.id desc
		limit $1
	`, where), args...)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	for rows.Next() {
		var item coinLedgerItem
		if err := rows.Scan(&item.ID, &item.AdminID, &item.AdminEmail, &item.Delta, &item.Balance, &item.Reason, &item.Note, &item.CreatedAt); err != nil {
			return items, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (a *app) coinPackages(ctx context.Context, activeOnly bool) ([]coinPackage, error) {
	items := []coinPackage{}
	where := ""
	if activeOnly {
		where = "where active"
	}
	rows, err := a.db.QueryContext(ctx, fmt.Sprintf(`
		select id, name, price_thb, coins, bonus_text, active, sort_order
		from coin_packages
		%s
		order by sort_order, price_thb, created_at
	`, where))
	if err != nil {
		return items, err
	}
	defer rows.Close()
	for rows.Next() {
		var item coinPackage
		if err := rows.Scan(&item.ID, &item.Name, &item.PriceTHB, &item.Coins, &item.BonusText, &item.Active, &item.SortOrder); err != nil {
			return items, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (a *app) coinPurchaseOrders(ctx context.Context, adminID string, includeSlip bool, limit int) ([]coinPurchaseOrder, error) {
	items, _, err := a.coinPurchaseOrdersPage(ctx, adminID, includeSlip, 1, limit)
	return items, err
}

func (a *app) coinPurchaseOrdersPage(ctx context.Context, adminID string, includeSlip bool, page, pageSize int) ([]coinPurchaseOrder, int, error) {
	items := []coinPurchaseOrder{}
	where := ""
	filterArgs := []any{}
	if adminID != "" {
		where = "where o.admin_id = $1"
		filterArgs = append(filterArgs, adminID)
	}
	var total int
	if err := a.db.QueryRowContext(ctx, `
		select count(*)
		from coin_purchase_orders o
		`+where, filterArgs...).Scan(&total); err != nil {
		return items, 0, err
	}
	slipSelect := "''"
	if includeSlip {
		slipSelect = "o.slip_image"
	}
	args := append([]any{}, filterArgs...)
	limitPlaceholder := len(args) + 1
	offsetPlaceholder := len(args) + 2
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := a.db.QueryContext(ctx, fmt.Sprintf(`
		select o.id, o.admin_id, coalesce(u.email, ''), o.package_id, o.price_thb, o.coins, %s,
			o.status, o.note, o.trans_ref, o.slip_qr_payload, o.detected_amount_thb,
			o.detected_paid_at, o.detected_receiver, o.verification_status, o.verification_note,
			o.verification_provider, o.provider_status, o.provider_error_code,
			coalesce(to_char(o.provider_checked_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI'), ''),
			to_char(o.created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI'),
			coalesce(to_char(o.reviewed_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI'), '')
		from coin_purchase_orders o
		left join admin_users u on u.id = o.admin_id
		%s
		order by o.created_at desc
		limit $%d offset $%d
	`, slipSelect, where, limitPlaceholder, offsetPlaceholder), args...)
	if err != nil {
		return items, 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var item coinPurchaseOrder
		var detectedAmount sql.NullInt64
		if err := rows.Scan(&item.ID, &item.AdminID, &item.AdminEmail, &item.PackageID, &item.PriceTHB, &item.Coins, &item.SlipImage, &item.Status, &item.Note, &item.TransRef, &item.SlipQRPayload, &detectedAmount, &item.DetectedPaidAt, &item.DetectedReceiver, &item.VerificationStatus, &item.VerificationNote, &item.VerificationProvider, &item.ProviderStatus, &item.ProviderErrorCode, &item.ProviderCheckedAt, &item.CreatedAt, &item.ReviewedAt); err != nil {
			return items, 0, err
		}
		if detectedAmount.Valid {
			amount := int(detectedAmount.Int64)
			item.DetectedAmountTHB = &amount
		}
		items = append(items, item)
	}
	return items, total, rows.Err()
}

func (a *app) systemSetting(ctx context.Context, key string) (string, error) {
	var value string
	err := a.db.QueryRowContext(ctx, `select value from system_settings where key = $1`, key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return value, err
}

func (a *app) insertActivityLogTx(ctx context.Context, tx *sql.Tx, actorType, actorID, action, targetType, targetID string, details map[string]any) error {
	rawDetails, err := json.Marshal(details)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		insert into activity_logs (actor_type, actor_id, action, target_type, target_id, details)
		values ($1, $2, $3, $4, $5, $6)
	`, actorType, actorID, action, targetType, targetID, string(rawDetails))
	return err
}

func (a *app) insertActivityLog(ctx context.Context, actorType, actorID, action, targetType, targetID string, details map[string]any) {
	rawDetails, err := json.Marshal(details)
	if err != nil {
		return
	}
	_, _ = a.db.ExecContext(ctx, `
		insert into activity_logs (actor_type, actor_id, action, target_type, target_id, details)
		values ($1, $2, $3, $4, $5, $6)
	`, actorType, actorID, action, targetType, targetID, string(rawDetails))
}

func (a *app) activityLogs(ctx context.Context, limit int) ([]activityLogItem, error) {
	items, _, err := a.activityLogsPage(ctx, 1, limit, "", "")
	return items, err
}

func (a *app) activityLogsPage(ctx context.Context, page, pageSize int, userID, sessionID string) ([]activityLogItem, int, error) {
	items := []activityLogItem{}
	conditions := []string{}
	args := []any{}
	if userID != "" {
		args = append(args, userID)
		placeholder := fmt.Sprintf("$%d", len(args))
		conditions = append(conditions, fmt.Sprintf("((actor_type = 'admin' and actor_id = %s) or (target_type = 'admin_user' and target_id = %s))", placeholder, placeholder))
	}
	if sessionID != "" {
		args = append(args, sessionID)
		placeholder := fmt.Sprintf("$%d", len(args))
		conditions = append(conditions, fmt.Sprintf("((target_type = 'session' and target_id = %s) or (details::jsonb ->> 'sessionId') = %s)", placeholder, placeholder))
	}
	where := ""
	if len(conditions) > 0 {
		where = "where " + strings.Join(conditions, " and ")
	}
	var total int
	if err := a.db.QueryRowContext(ctx, "select count(*) from activity_logs "+where, args...).Scan(&total); err != nil {
		return items, 0, err
	}
	limitPlaceholder := len(args) + 1
	offsetPlaceholder := len(args) + 2
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := a.db.QueryContext(ctx, fmt.Sprintf(`
		select id, actor_type, actor_id, action, target_type, target_id, details,
			to_char(created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI')
		from activity_logs
		%s
		order by id desc
		limit $%d offset $%d
	`, where, limitPlaceholder, offsetPlaceholder), args...)
	if err != nil {
		return items, 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var item activityLogItem
		if err := rows.Scan(&item.ID, &item.ActorType, &item.ActorID, &item.Action, &item.TargetType, &item.TargetID, &item.Details, &item.CreatedAt); err != nil {
			return items, 0, err
		}
		items = append(items, item)
	}
	return items, total, rows.Err()
}

func (a *app) liveMatchCost(ctx context.Context) (int, bool, error) {
	return a.systemIntSetting(ctx, "liveMatchSessionCoinCost")
}

func (a *app) liveShareCost(ctx context.Context) (int, bool, error) {
	return a.systemIntSetting(ctx, "liveShareSessionCoinCost")
}

func (a *app) sessionCoinCost(ctx context.Context, sessionType string) (int, bool, error) {
	if normalizeSessionType(sessionType) == "liveShare" {
		return a.liveShareCost(ctx)
	}
	return a.liveMatchCost(ctx)
}

func (a *app) systemIntSetting(ctx context.Context, key string) (int, bool, error) {
	var raw string
	err := a.db.QueryRowContext(ctx, `select value from system_settings where key = $1`, key).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	cost, err := strconv.Atoi(raw)
	return cost, err == nil, err
}

func (a *app) sessionOwnedBy(ctx context.Context, sessionID, adminID string) (bool, error) {
	var owner sql.NullString
	err := a.db.QueryRowContext(ctx, `select admin_id from sessions where id = $1`, sessionID).Scan(&owner)
	if err != nil {
		return false, err
	}
	return owner.Valid && owner.String == adminID, nil
}

func (a *app) authenticateBackoffice(r *http.Request) (string, bool) {
	username, password, ok := r.BasicAuth()
	if !ok {
		return "", false
	}
	username = strings.TrimSpace(username)
	var passwordHash string
	var active bool
	err := a.db.QueryRowContext(r.Context(), `
		select password_hash, active
		from backoffice_users
		where username = $1
	`, username).Scan(&passwordHash, &active)
	if err != nil || !active || bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)) != nil {
		return "", false
	}
	return username, true
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func tokenDigest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func nullableCost(cost int, ok bool) any {
	if !ok {
		return nil
	}
	return cost
}

func readAdminCookie(r *http.Request) (string, bool) {
	cookie, err := r.Cookie(adminCookieName)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		return "", false
	}
	return cookie.Value, true
}

func setAdminCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     adminCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil,
		MaxAge:   int((30 * 24 * time.Hour).Seconds()),
	})
}

func clearAdminCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     adminCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil,
		MaxAge:   -1,
	})
}

func sendAppEmail(to, subject, textBody, htmlBody string) error {
	host := os.Getenv("SMTP_HOST")
	port := os.Getenv("SMTP_PORT")
	from := os.Getenv("SMTP_FROM")
	fromName := strings.TrimSpace(os.Getenv("SMTP_FROM_NAME"))
	username := os.Getenv("SMTP_USERNAME")
	password := os.Getenv("SMTP_PASSWORD")
	if host == "" || port == "" || from == "" {
		return errors.New("smtp is not configured")
	}
	addr := net.JoinHostPort(host, port)
	var auth smtp.Auth
	if username != "" || password != "" {
		auth = smtp.PlainAuth("", username, password, host)
	}
	boundary := "livematch-" + randHex(8)
	message := strings.Join([]string{
		"From: " + formatEmailFrom(fromName, from),
		"To: " + to,
		"Subject: " + mime.QEncoding.Encode("utf-8", subject),
		"MIME-Version: 1.0",
		"Content-Type: multipart/alternative; boundary=\"" + boundary + "\"",
		"",
		"--" + boundary,
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
		"",
		textBody,
		"",
		"--" + boundary,
		"Content-Type: text/html; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
		"",
		htmlBody,
		"",
		"--" + boundary + "--",
	}, "\r\n")
	return smtp.SendMail(addr, auth, from, []string{to}, []byte(message))
}

func formatEmailFrom(name, address string) string {
	if strings.TrimSpace(name) == "" {
		return address
	}
	return mime.QEncoding.Encode("utf-8", name) + " <" + address + ">"
}

func prefersHTML(r *http.Request) bool {
	accept := r.Header.Get("Accept")
	return strings.Contains(accept, "text/html") && !strings.Contains(accept, "application/json")
}

func verifyEmailText(r *http.Request, token string) string {
	link := appBaseURL(r) + "/verify-email?token=" + token
	return "ยืนยันอีเมล LiveMatch\n\nกดลิงก์นี้เพื่อยืนยันอีเมล:\n" + link + "\n\nลิงก์นี้ใช้ได้ 24 ชั่วโมง"
}

func resetPasswordText(r *http.Request, token string) string {
	link := appBaseURL(r) + "/reset-password?token=" + token
	return "รีเซ็ตรหัสผ่าน LiveMatch\n\nกดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่:\n" + link + "\n\nลิงก์นี้ใช้ได้ 2 ชั่วโมง"
}

func verifyEmailHTML(r *http.Request, token string) string {
	link := appBaseURL(r) + "/verify-email?token=" + token
	return emailHTML(
		"ยืนยันอีเมลของคุณ",
		"ยินดีต้อนรับสู่ LiveMatch",
		"กดปุ่มด้านล่างเพื่อยืนยันอีเมลและเปิดใช้งานบัญชี admin ของคุณ",
		"ยืนยันอีเมล",
		link,
		"ลิงก์นี้ใช้ได้ 24 ชั่วโมง หากคุณไม่ได้สมัคร LiveMatch สามารถละเว้นอีเมลนี้ได้",
	)
}

func resetPasswordHTML(r *http.Request, token string) string {
	link := appBaseURL(r) + "/reset-password?token=" + token
	return emailHTML(
		"ตั้งรหัสผ่านใหม่",
		"รีเซ็ตรหัสผ่าน LiveMatch",
		"เราได้รับคำขอรีเซ็ตรหัสผ่าน กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่",
		"ตั้งรหัสผ่านใหม่",
		link,
		"ลิงก์นี้ใช้ได้ 2 ชั่วโมง หากคุณไม่ได้ขอรีเซ็ตรหัสผ่าน สามารถละเว้นอีเมลนี้ได้",
	)
}

func emailHTML(preheader, title, message, buttonText, link, footer string) string {
	return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>` + htmlEscape(title) + `</title>
  </head>
  <body style="margin:0;background:#f7f4ea;font-family:Arial,'Noto Sans Thai',sans-serif;color:#1c1917;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">` + htmlEscape(preheader) + `</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ea;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf7;border:1px solid #e7dfcf;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#138f79;padding:22px 24px;color:#ffffff;">
                <div style="font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">LiveMatch</div>
                <div style="margin-top:6px;font-size:24px;font-weight:900;line-height:1.25;">` + htmlEscape(title) + `</div>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 24px;">
                <p style="margin:0 0 18px;font-size:16px;line-height:1.7;color:#44403c;">` + htmlEscape(message) + `</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;">
                  <tr>
                    <td style="border-radius:8px;background:#138f79;">
                      <a href="` + htmlEscape(link) + `" style="display:inline-block;padding:13px 20px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:800;border-radius:8px;">` + htmlEscape(buttonText) + `</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#78716c;">ถ้าปุ่มกดไม่ได้ ให้เปิดลิงก์นี้:</p>
                <p style="margin:0;word-break:break-all;font-size:13px;line-height:1.6;color:#0f766e;">
                  <a href="` + htmlEscape(link) + `" style="color:#0f766e;">` + htmlEscape(link) + `</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #eee6d7;padding:18px 24px;background:#fbfaf4;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#78716c;">` + htmlEscape(footer) + `</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

func htmlEscape(value string) string {
	replacer := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		"'", "&#39;",
	)
	return replacer.Replace(value)
}

func appBaseURL(r *http.Request) string {
	if value := strings.TrimRight(os.Getenv("APP_BASE_URL"), "/"); value != "" {
		return value
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}
