package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestValidPOSPIN(t *testing.T) {
	tests := map[string]bool{"1234": true, "123456": true, "123": false, "1234567": false, "12a4": false, "": false}
	for pin, expected := range tests {
		if actual := validPOSPIN(pin); actual != expected {
			t.Fatalf("validPOSPIN(%q)=%v, want %v", pin, actual, expected)
		}
	}
}

func TestPOSPermissionsEnforceRole(t *testing.T) {
	cashier := adminUser{POSRole: "cashier", POSPermissions: defaultPOSPermissions("cashier")}
	if !hasPOSPermission(cashier, "sales") {
		t.Fatal("cashier should be allowed to sell")
	}
	if hasPOSPermission(cashier, "stock") {
		t.Fatal("cashier should not be allowed to manage stock by default")
	}

	response := httptest.NewRecorder()
	if authorizePOSPath(response, cashier, http.MethodPost, "stock/batch") {
		t.Fatal("cashier stock write should be denied")
	}
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", response.Code)
	}

	owner := adminUser{POSRole: "owner", POSPermissions: allPOSPermissions()}
	if !authorizePOSPath(httptest.NewRecorder(), owner, http.MethodPut, "permissions") {
		t.Fatal("owner should be allowed to update permissions")
	}
}

func TestNormalizePOSPermissionsDropsUnknownKeys(t *testing.T) {
	normalized := normalizePOSPermissions(map[string]bool{"sales": true, "unknown": true})
	if !normalized["sales"] || normalized["unknown"] || len(normalized) != len(posPermissionKeys) {
		t.Fatalf("unexpected normalized permissions: %#v", normalized)
	}
}

func TestPOSStaffIntegration(t *testing.T) {
	dsn := os.Getenv("LIVEMATCH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run PostgreSQL POS staff integration tests")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &app{db: db}
	adminID := "pos-staff-test-" + randHex(8)
	email := adminID + "@example.invalid"
	password := "TestPass123!"
	passwordHash, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if _, err = db.Exec(`insert into admin_users(id,email,name,password_hash,verified_at) values($1,$2,'POS Staff Test',$3,now())`, adminID, email, string(passwordHash)); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(`delete from activity_logs where actor_id=$1 or details like '%'||$1||'%'`, adminID)
		_, _ = db.Exec(`delete from admin_users where id=$1`, adminID)
	}()
	if _, err = db.Exec(`insert into admin_features(admin_id,pos_enabled) values($1,true)`, adminID); err != nil {
		t.Fatal(err)
	}
	var adminNumber int64
	if err = db.QueryRow(`select pos_admin_number from admin_users where id=$1`, adminID).Scan(&adminNumber); err != nil {
		t.Fatal(err)
	}
	owner := adminUser{ID: adminID, Email: email, Name: "POS Staff Test", POSAdminNumber: adminNumber, POSRole: "owner", POSActorID: adminID, POSActorName: "POS Staff Test", POSActorType: "admin", POSPermissions: allPOSPermissions()}

	staffEmail := adminID + "-cashier@example.invalid"
	createBody, _ := json.Marshal(map[string]any{"name": "Cashier One", "email": staffEmail, "role": "cashier", "pin": "2468"})
	createReq := httptest.NewRequest(http.MethodPost, "/api/admin/pos/staff", bytes.NewReader(createBody))
	createRecorder := httptest.NewRecorder()
	a.createPOSStaff(createRecorder, createReq, owner)
	if createRecorder.Code != http.StatusOK {
		t.Fatalf("create staff status=%d body=%s", createRecorder.Code, createRecorder.Body.String())
	}
	var staffID, staffNumber string
	if err = db.QueryRow(`select id,staff_number from pos_staff where admin_id=$1`, adminID).Scan(&staffID, &staffNumber); err != nil {
		t.Fatal(err)
	}
	if staffNumber == "" {
		t.Fatal("staff number was not generated")
	}

	login := func(identifier, pin string) *httptest.ResponseRecorder {
		loginBody, _ := json.Marshal(map[string]any{"identifier": identifier, "password": pin, "remember": false})
		loginReq := httptest.NewRequest(http.MethodPost, "/api/auth/pos/login", bytes.NewReader(loginBody))
		loginRecorder := httptest.NewRecorder()
		a.handlePOSLogin(loginRecorder, loginReq)
		return loginRecorder
	}
	loginRecorder := login(staffNumber, "2468")
	if loginRecorder.Code != http.StatusOK {
		t.Fatalf("staff number login status=%d body=%s", loginRecorder.Code, loginRecorder.Body.String())
	}
	emailLoginRecorder := login(strings.ToUpper(staffEmail), "2468")
	if emailLoginRecorder.Code != http.StatusOK {
		t.Fatalf("staff email login status=%d body=%s", emailLoginRecorder.Code, emailLoginRecorder.Body.String())
	}
	wrongPINRecorder := login(staffEmail, "0000")
	if wrongPINRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("wrong PIN status=%d body=%s", wrongPINRecorder.Code, wrongPINRecorder.Body.String())
	}
	var staffCookie *http.Cookie
	for _, cookie := range loginRecorder.Result().Cookies() {
		if cookie.Name == authCookieName(posStaffSessionKind) && cookie.Value != "" {
			staffCookie = cookie
		}
	}
	if staffCookie == nil {
		t.Fatal("POS staff session cookie was not issued")
	}
	meReq := httptest.NewRequest(http.MethodGet, "/api/auth/pos/me", nil)
	meReq.AddCookie(staffCookie)
	principal, ok := a.currentPOSPrincipal(t.Context(), meReq)
	if !ok || principal.User.POSActorID != staffID || principal.User.POSRole != "cashier" {
		t.Fatalf("unexpected staff principal: %#v ok=%v", principal, ok)
	}
	if hasPOSPermission(principal.User, "stock") {
		t.Fatal("cashier unexpectedly has stock permission")
	}

	secondAdminID := "pos-staff-test-" + randHex(8)
	secondAdminEmail := secondAdminID + "@example.invalid"
	if _, err = db.Exec(`insert into admin_users(id,email,name,password_hash,verified_at) values($1,$2,'Second POS Owner',$3,now())`, secondAdminID, secondAdminEmail, string(passwordHash)); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = db.Exec(`delete from admin_users where id=$1`, secondAdminID) }()
	if _, err = db.Exec(`insert into admin_features(admin_id,pos_enabled) values($1,true)`, secondAdminID); err != nil {
		t.Fatal(err)
	}
	var secondAdminNumber int64
	if err = db.QueryRow(`select pos_admin_number from admin_users where id=$1`, secondAdminID).Scan(&secondAdminNumber); err != nil {
		t.Fatal(err)
	}
	secondOwner := adminUser{ID: secondAdminID, Email: secondAdminEmail, Name: "Second POS Owner", POSAdminNumber: secondAdminNumber, POSRole: "owner", POSActorID: secondAdminID, POSActorName: "Second POS Owner", POSActorType: "admin", POSPermissions: allPOSPermissions()}

	duplicateBody, _ := json.Marshal(map[string]any{"name": "Duplicate Email", "email": strings.ToUpper(staffEmail), "role": "cashier", "pin": "1357"})
	duplicateReq := httptest.NewRequest(http.MethodPost, "/api/admin/pos/staff", bytes.NewReader(duplicateBody))
	duplicateRecorder := httptest.NewRecorder()
	a.createPOSStaff(duplicateRecorder, duplicateReq, secondOwner)
	if duplicateRecorder.Code != http.StatusConflict {
		t.Fatalf("cross-admin duplicate staff email status=%d body=%s", duplicateRecorder.Code, duplicateRecorder.Body.String())
	}

	ownerCollisionBody, _ := json.Marshal(map[string]any{"name": "Owner Collision", "email": strings.ToUpper(secondAdminEmail), "role": "manager", "pin": "1357"})
	ownerCollisionReq := httptest.NewRequest(http.MethodPost, "/api/admin/pos/staff", bytes.NewReader(ownerCollisionBody))
	ownerCollisionRecorder := httptest.NewRecorder()
	a.createPOSStaff(ownerCollisionRecorder, ownerCollisionReq, owner)
	if ownerCollisionRecorder.Code != http.StatusConflict {
		t.Fatalf("owner email collision status=%d body=%s", ownerCollisionRecorder.Code, ownerCollisionRecorder.Body.String())
	}

	registerBody, _ := json.Marshal(map[string]any{"name": "Staff Email Owner", "email": strings.ToUpper(staffEmail), "password": "TestPass123!"})
	registerReq := httptest.NewRequest(http.MethodPost, "/api/auth/register", bytes.NewReader(registerBody))
	registerRecorder := httptest.NewRecorder()
	a.handleAdminRegister(registerRecorder, registerReq)
	if registerRecorder.Code != http.StatusConflict {
		t.Fatalf("owner registration with staff email status=%d body=%s", registerRecorder.Code, registerRecorder.Body.String())
	}

	blankEmailBody, _ := json.Marshal(map[string]any{"name": "Manager Without Email", "email": "", "role": "manager", "pin": "8642"})
	blankEmailReq := httptest.NewRequest(http.MethodPost, "/api/admin/pos/staff", bytes.NewReader(blankEmailBody))
	blankEmailRecorder := httptest.NewRecorder()
	a.createPOSStaff(blankEmailRecorder, blankEmailReq, owner)
	if blankEmailRecorder.Code != http.StatusOK {
		t.Fatalf("blank staff email status=%d body=%s", blankEmailRecorder.Code, blankEmailRecorder.Body.String())
	}
	var blankEmailStaffNumber string
	if err = db.QueryRow(`select staff_number from pos_staff where admin_id=$1 and email=''`, adminID).Scan(&blankEmailStaffNumber); err != nil {
		t.Fatal(err)
	}
	if recorder := login(blankEmailStaffNumber, "8642"); recorder.Code != http.StatusOK {
		t.Fatalf("blank email staff number login status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	if _, err = db.Exec(`update admin_features set pos_enabled=false where admin_id=$1`, adminID); err != nil {
		t.Fatal(err)
	}
	if _, ok = a.currentPOSPrincipal(t.Context(), meReq); ok {
		t.Fatal("staff session must stop working when Backoffice disables POS")
	}
}

func TestPOSSaleIntegration(t *testing.T) {
	dsn := os.Getenv("LIVEMATCH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run PostgreSQL POS sale integration tests")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &app{db: db}
	adminID := "pos-sale-test-" + randHex(8)
	email := adminID + "@example.invalid"
	if _, err = db.Exec(`insert into admin_users(id,email,name,password_hash,verified_at) values($1,$2,'POS Sale Test','unused',now())`, adminID, email); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(`delete from activity_logs where actor_id=$1 or details like '%'||$1||'%'`, adminID)
		_, _ = db.Exec(`delete from admin_users where id=$1`, adminID)
	}()
	if _, err = db.Exec(`insert into admin_features(admin_id,pos_enabled) values($1,true)`, adminID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into pos_settings(admin_id,tax_rate_percent,prices_include_tax,inherit_booking_promptpay) values($1,7,false,false)`, adminID); err != nil {
		t.Fatal(err)
	}
	productID := "product-" + randHex(8)
	if _, err = db.Exec(`insert into pos_products(id,admin_id,sku,name,price_thb,price_satang,cost_thb,cost_satang,stock_quantity,active) values($1,$2,'SALE-1','Sale Product',10,1000,5,500,10,true)`, productID, adminID); err != nil {
		t.Fatal(err)
	}
	memberID := "member-" + randHex(8)
	if _, err = db.Exec(`insert into members(id,admin_id,name,phone,active,profile_token_hash,profile_token) values($1,$2,'Sale Member',$3,true,$4,$5)`, memberID, adminID, "08"+randHex(4), tokenDigest(memberID), memberID); err != nil {
		t.Fatal(err)
	}
	owner := adminUser{ID: adminID, Name: "POS Sale Test", POSRole: "owner", POSActorID: adminID, POSActorName: "POS Sale Test", POSActorType: "admin", POSPermissions: allPOSPermissions()}

	// A registered member with Match charges must appear in POS receivables even
	// when the member has never held or purchased a POS product.
	matchSessionID := "match-receivable-" + randHex(8)
	if _, err = db.Exec(`insert into sessions(id,name,admin_id,admin_passcode,state) values($1,'Match-only receivable',$2,'','{}'::jsonb)`, matchSessionID, adminID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into session_settings(session_id,entry_fee,club_entry_fee) values($1,120,120)`, matchSessionID); err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	matchAccountID, err := ensureBillingAccountTx(t.Context(), tx, adminID, "member", memberID, "", "")
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if _, err = tx.Exec(`insert into players(session_id,id,name,member_id,billing_account_id,paid,active) values($1,1,'Sale Member',$2,$3,false,true)`, matchSessionID, memberID, matchAccountID); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	loadedMatchState, loadMatchErr := a.loadState(t.Context(), matchSessionID)
	if loadMatchErr != nil {
		t.Fatalf("load match-only state: %v", loadMatchErr)
	}
	if len(loadedMatchState.Players) != 1 {
		t.Fatalf("match-only players=%#v", loadedMatchState.Players)
	}
	matchOnlySummary, err := a.billingSummaryForAccount(t.Context(), adminID, matchAccountID, true)
	if err != nil {
		t.Fatal(err)
	}
	if matchOnlySummary.MatchTotalSatang != 12000 {
		t.Fatalf("match-only summary=%#v", matchOnlySummary)
	}
	receivableRecorder := httptest.NewRecorder()
	a.writePOSReceivables(receivableRecorder, httptest.NewRequest(http.MethodGet, "/api/admin/pos/receivables", nil), adminID)
	if receivableRecorder.Code != http.StatusOK {
		t.Fatalf("match-only receivable status=%d body=%s", receivableRecorder.Code, receivableRecorder.Body.String())
	}
	var receivablePayload struct {
		Items []billingReceivable `json:"items"`
	}
	if err = json.NewDecoder(receivableRecorder.Body).Decode(&receivablePayload); err != nil {
		t.Fatal(err)
	}
	if len(receivablePayload.Items) != 1 || receivablePayload.Items[0].BillingAccountID != matchAccountID || receivablePayload.Items[0].MatchTotalSatang != 12000 || receivablePayload.Items[0].POSTotalSatang != 0 {
		t.Fatalf("match-only receivables=%#v", receivablePayload.Items)
	}
	if _, err = db.Exec(`update players set paid=true where session_id=$1 and id=1`, matchSessionID); err != nil {
		t.Fatal(err)
	}

	requestSale := func(body map[string]any) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/api/admin/pos/sales", bytes.NewReader(raw))
		recorder := httptest.NewRecorder()
		a.createPOSSale(recorder, req, owner)
		return recorder
	}
	requestID := "sale-request-" + randHex(8)
	first := requestSale(map[string]any{"requestId": requestID, "action": "hold", "buyerType": "member", "buyerId": memberID, "discountType": "amount", "discountAmountSatang": 100, "expectedTotalSatang": 2033, "items": []map[string]any{{"productId": productID, "quantity": 2, "note": "first"}}})
	if first.Code != http.StatusCreated {
		t.Fatalf("first hold status=%d body=%s", first.Code, first.Body.String())
	}
	var stock int
	if err = db.QueryRow(`select stock_quantity from pos_products where id=$1`, productID).Scan(&stock); err != nil || stock != 8 {
		t.Fatalf("stock after hold=%d err=%v", stock, err)
	}
	duplicate := requestSale(map[string]any{"requestId": requestID, "action": "hold", "buyerType": "member", "buyerId": memberID, "discountType": "amount", "discountAmountSatang": 100, "expectedTotalSatang": 2033, "items": []map[string]any{{"productId": productID, "quantity": 2}}})
	if duplicate.Code != http.StatusOK {
		t.Fatalf("duplicate status=%d body=%s", duplicate.Code, duplicate.Body.String())
	}
	_ = db.QueryRow(`select stock_quantity from pos_products where id=$1`, productID).Scan(&stock)
	if stock != 8 {
		t.Fatalf("duplicate deducted stock: %d", stock)
	}
	second := requestSale(map[string]any{"requestId": "sale-request-" + randHex(8), "action": "hold", "buyerType": "member", "buyerId": memberID, "discountType": "percent", "discountRateBps": 0, "expectedTotalSatang": 1070, "items": []map[string]any{{"productId": productID, "quantity": 1}}})
	if second.Code != http.StatusCreated {
		t.Fatalf("second hold status=%d body=%s", second.Code, second.Body.String())
	}
	var accountID string
	if err = db.QueryRow(`select billing_account_id from pos_sales where admin_id=$1 and status='open' limit 1`, adminID).Scan(&accountID); err != nil {
		t.Fatal(err)
	}
	summary, err := a.billingSummaryForAccount(t.Context(), adminID, accountID, true)
	if err != nil {
		t.Fatal(err)
	}
	if summary.POSTotalSatang != 3103 || summary.TotalSatang != 3103 {
		t.Fatalf("summary=%#v", summary)
	}
	paid, err := a.settleBillingAccount(t.Context(), owner, accountID, "cash", 3103, 4000, "CASH-TEST", true, "pos")
	if err != nil {
		t.Fatal(err)
	}
	if paid.TotalSatang != 3103 {
		t.Fatalf("paid total=%d", paid.TotalSatang)
	}
	var openCount, allocationCount int
	if err = db.QueryRow(`select count(*) from pos_sales where admin_id=$1 and status='open'`, adminID).Scan(&openCount); err != nil || openCount != 0 {
		t.Fatalf("open sales=%d err=%v", openCount, err)
	}
	if err = db.QueryRow(`select count(*) from billing_payment_allocations a join billing_payments p on p.id=a.payment_id where p.admin_id=$1 and a.source_type='pos'`, adminID).Scan(&allocationCount); err != nil || allocationCount != 2 {
		t.Fatalf("allocations=%d err=%v", allocationCount, err)
	}
	var paymentID, originSystem, allocationLabel, allocationSnapshot string
	if err = db.QueryRow(`
		select p.id, p.origin_system, coalesce(a.label,''), a.snapshot::text
		from billing_payments p
		join billing_payment_allocations a on a.payment_id=p.id
		where p.admin_id=$1 and p.billing_account_id=$2
		order by a.created_at, a.id
		limit 1`, adminID, accountID).Scan(&paymentID, &originSystem, &allocationLabel, &allocationSnapshot); err != nil {
		t.Fatal(err)
	}
	if originSystem != "pos" || allocationLabel == "" || !json.Valid([]byte(allocationSnapshot)) {
		t.Fatalf("payment audit origin=%q label=%q snapshot=%q", originSystem, allocationLabel, allocationSnapshot)
	}
	if _, err = a.settleBillingAccount(t.Context(), owner, accountID, "cash", 3103, 4000, "CASH-RETRY", true, "pos"); err == nil {
		t.Fatal("settled billing account must not be paid twice")
	}
	history, historyTotal, err := a.listBillingPaymentHistory(t.Context(), adminID, "", 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	if historyTotal != 1 || len(history) != 1 || history[0].PaymentID != paymentID || history[0].OriginSystem != "pos" || history[0].POSTotalSatang != 3103 {
		t.Fatalf("history total=%d items=%#v", historyTotal, history)
	}

	insufficient := requestSale(map[string]any{"requestId": "sale-request-" + randHex(8), "action": "pay", "buyerType": "anonymous", "method": "cash", "discountType": "amount", "expectedTotalSatang": 10700, "cashReceivedSatang": 10700, "items": []map[string]any{{"productId": productID, "quantity": 10}}})
	if insufficient.Code != http.StatusConflict {
		t.Fatalf("insufficient status=%d body=%s", insufficient.Code, insufficient.Body.String())
	}
	_ = db.QueryRow(`select stock_quantity from pos_products where id=$1`, productID).Scan(&stock)
	if stock != 7 {
		t.Fatalf("failed sale changed stock: %d", stock)
	}
}
