package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestValidPOSPIN(t *testing.T) {
	tests := map[string]bool{"123456": true, "1234": false, "123": false, "1234567": false, "12a456": false, "": false}
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
	for _, permission := range []string{"discounts", "void_sales", "stock_adjust", "product_pricing", "report_export"} {
		if hasPOSPermission(cashier, permission) {
			t.Fatalf("cashier should not receive %s by default", permission)
		}
	}
	if !hasPOSPermission(cashier, "member_create") {
		t.Fatal("cashier should be able to add a core member by default")
	}
	if hasPOSPermission(adminUser{}, "sales") {
		t.Fatal("an empty POS role must never inherit owner permissions")
	}

	response := httptest.NewRecorder()
	if authorizePOSPath(response, cashier, http.MethodPost, "stock/batch") {
		t.Fatal("cashier stock write should be denied")
	}
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", response.Code)
	}
	for _, path := range []string{"dashboard", "reports"} {
		response = httptest.NewRecorder()
		if authorizePOSPath(response, cashier, http.MethodGet, path) {
			t.Fatalf("cashier sales permission must not grant %s access", path)
		}
	}
	manager := adminUser{POSRole: "manager", POSPermissions: map[string]bool{"settings": true}}
	for _, path := range []string{"access", "permissions", "staff/pos-staff-other/reset-pin"} {
		response = httptest.NewRecorder()
		if authorizePOSPath(response, manager, http.MethodGet, path) {
			t.Fatalf("non-owner must not manage POS access through %s", path)
		}
	}

	owner := adminUser{POSRole: "owner", POSPermissions: allPOSPermissions()}
	if !authorizePOSPath(httptest.NewRecorder(), owner, http.MethodPut, "permissions") {
		t.Fatal("owner should be allowed to update permissions")
	}
	manager = adminUser{POSRole: "manager", POSPermissions: defaultPOSPermissions("manager")}
	for _, request := range []struct{ method, path string }{{http.MethodPost, "stock/batch"}, {http.MethodPatch, "products/product-1"}, {http.MethodPost, "reports/export-authorize"}, {http.MethodPost, "sales/sale-1/void"}} {
		if !authorizePOSPath(httptest.NewRecorder(), manager, request.method, request.path) {
			t.Fatalf("manager default permissions should allow %s %s", request.method, request.path)
		}
	}
}

func TestPOSAccessHandlerRequiresOwnerBeforeDatabase(t *testing.T) {
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/admin/pos/access", nil)
	(&app{}).writePOSAccessSettings(response, request, adminUser{POSRole: "manager"})
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403 before any database access, got %d", response.Code)
	}
}

func TestPOSSettlementErrorDoesNotLeakDatabaseDetails(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/admin/pos/settlements", nil)
	response := httptest.NewRecorder()
	writePOSSettlementError(response, request, billingSummary{}, errors.New("sql: private schema detail"))
	if response.Code != http.StatusInternalServerError || strings.Contains(response.Body.String(), "private schema") {
		t.Fatalf("internal settlement error leaked: status=%d body=%s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	writePOSSettlementError(response, request, billingSummary{}, errors.New("ยอดเงินสดไม่เพียงพอ"))
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "ยอดเงินสดไม่เพียงพอ") {
		t.Fatalf("safe business error was not returned: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestNormalizePOSPermissionsDropsUnknownKeys(t *testing.T) {
	normalized := normalizePOSPermissions(map[string]bool{"sales": true, "unknown": true})
	if !normalized["sales"] || normalized["unknown"] || len(normalized) != len(posPermissionKeys) {
		t.Fatalf("unexpected normalized permissions: %#v", normalized)
	}
}

func TestNormalizePOSPermissionsMigratesAndEnforcesReportChildren(t *testing.T) {
	legacy := normalizePOSPermissions(map[string]bool{"reports": true})
	for _, permission := range posReportPermissionKeys {
		if !legacy[permission] {
			t.Fatalf("legacy reports permission should enable %s", permission)
		}
	}

	disabled := normalizePOSPermissions(map[string]bool{"reports": false, "report_inventory": true})
	if disabled["report_inventory"] {
		t.Fatal("report child must be disabled when the reports menu is disabled")
	}
}

func TestRequirePOSReportPermission(t *testing.T) {
	user := adminUser{POSRole: "manager", POSPermissions: map[string]bool{"reports": true, "report_inventory": true}}
	if !requirePOSReportPermission(httptest.NewRecorder(), user, "inventory") {
		t.Fatal("inventory report permission should allow inventory")
	}
	response := httptest.NewRecorder()
	if requirePOSReportPermission(response, user, "purchases") || response.Code != http.StatusForbidden {
		t.Fatalf("purchases report should be denied, got %d", response.Code)
	}
	response = httptest.NewRecorder()
	if requirePOSReportPermission(response, user, "unknown") || response.Code != http.StatusBadRequest {
		t.Fatalf("unknown report type should be rejected, got %d", response.Code)
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
	createBody, _ := json.Marshal(map[string]any{"name": "Cashier One", "email": staffEmail, "role": "cashier", "pin": "246824"})
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
	loginRecorder := login(staffNumber, "246824")
	if loginRecorder.Code != http.StatusOK {
		t.Fatalf("staff number login status=%d body=%s", loginRecorder.Code, loginRecorder.Body.String())
	}
	emailLoginRecorder := login(strings.ToUpper(staffEmail), "246824")
	if emailLoginRecorder.Code != http.StatusOK {
		t.Fatalf("staff email login status=%d body=%s", emailLoginRecorder.Code, emailLoginRecorder.Body.String())
	}
	wrongPINRecorder := login(staffEmail, "000000")
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

	duplicateBody, _ := json.Marshal(map[string]any{"name": "Duplicate Email", "email": strings.ToUpper(staffEmail), "role": "cashier", "pin": "135713"})
	duplicateReq := httptest.NewRequest(http.MethodPost, "/api/admin/pos/staff", bytes.NewReader(duplicateBody))
	duplicateRecorder := httptest.NewRecorder()
	a.createPOSStaff(duplicateRecorder, duplicateReq, secondOwner)
	if duplicateRecorder.Code != http.StatusConflict {
		t.Fatalf("cross-admin duplicate staff email status=%d body=%s", duplicateRecorder.Code, duplicateRecorder.Body.String())
	}

	ownerCollisionBody, _ := json.Marshal(map[string]any{"name": "Owner Collision", "email": strings.ToUpper(secondAdminEmail), "role": "manager", "pin": "135713"})
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

	blankEmailBody, _ := json.Marshal(map[string]any{"name": "Manager Without Email", "email": "", "role": "manager", "pin": "864286"})
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
	if recorder := login(blankEmailStaffNumber, "864286"); recorder.Code != http.StatusOK {
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

	// A validation problem in the store tab must not block an unrelated tab.
	// Partial saves merge with the current settings and validate only the fields
	// owned by the submitted tab.
	if _, err = db.Exec(`update pos_settings set store_email='not-an-email' where admin_id=$1`, adminID); err != nil {
		t.Fatal(err)
	}
	taxSettingsRecorder := httptest.NewRecorder()
	a.savePOSSettings(taxSettingsRecorder, httptest.NewRequest(http.MethodPut, "/api/admin/pos/settings", strings.NewReader(`{"taxRatePercent":10,"pricesIncludeTax":true}`)), owner)
	if taxSettingsRecorder.Code != http.StatusOK {
		t.Fatalf("tax-only settings save was blocked by store validation: status=%d body=%s", taxSettingsRecorder.Code, taxSettingsRecorder.Body.String())
	}
	var savedTaxRate float64
	var savedStoreEmail string
	if err = db.QueryRow(`select tax_rate_percent,store_email from pos_settings where admin_id=$1`, adminID).Scan(&savedTaxRate, &savedStoreEmail); err != nil {
		t.Fatal(err)
	}
	if savedTaxRate != 10 || savedStoreEmail != "not-an-email" {
		t.Fatalf("partial settings save changed unrelated fields: tax=%v email=%q", savedTaxRate, savedStoreEmail)
	}
	invalidStoreRecorder := httptest.NewRecorder()
	a.savePOSSettings(invalidStoreRecorder, httptest.NewRequest(http.MethodPut, "/api/admin/pos/settings", strings.NewReader(`{"storeEmail":"still-not-an-email"}`)), owner)
	if invalidStoreRecorder.Code != http.StatusBadRequest {
		t.Fatalf("store settings validation was skipped: status=%d body=%s", invalidStoreRecorder.Code, invalidStoreRecorder.Body.String())
	}
	if _, err = db.Exec(`update pos_settings set store_email='',tax_rate_percent=7,prices_include_tax=false where admin_id=$1`, adminID); err != nil {
		t.Fatal(err)
	}

	duplicateProductBody, _ := json.Marshal(map[string]any{
		"sku": " sale-1 ", "name": "Duplicate SKU", "priceSatang": 1000, "costSatang": 500,
		"stockQuantity": 1, "trackStock": true, "lowStockThreshold": 1, "active": true,
	})
	duplicateProductRecorder := httptest.NewRecorder()
	a.createPOSProduct(duplicateProductRecorder, httptest.NewRequest(http.MethodPost, "/api/admin/pos/products", bytes.NewReader(duplicateProductBody)), owner)
	if duplicateProductRecorder.Code != http.StatusConflict || !strings.Contains(duplicateProductRecorder.Body.String(), `"code":"duplicate_sku"`) || !strings.Contains(duplicateProductRecorder.Body.String(), "รหัส SKU นี้ถูกใช้แล้ว") {
		t.Fatalf("duplicate SKU response status=%d body=%s", duplicateProductRecorder.Code, duplicateProductRecorder.Body.String())
	}

	// Match shuttle usage and returns share the POS stock ledger. Saving the
	// same state twice must be idempotent.
	stockSessionID := "match-stock-" + randHex(8)
	if _, err = db.Exec(`insert into sessions(id,name,admin_id,admin_passcode,state) values($1,'Match stock',$2,'','{}'::jsonb)`, stockSessionID, adminID); err != nil {
		t.Fatal(err)
	}
	stockState := defaultState(stockSessionID, "Match stock", "")
	stockState.Settings.ShuttleBrands = []ShuttleBrand{{ID: "linked", Name: "Linked shuttle", Price: 85, Active: true, POSProductID: productID}}
	stockState.Live = []Match{{ID: 1, Court: "สนาม 1", Status: "playing", Shuttles: 1, ShuttleSeq: "1", ShuttleSeqItems: []ShuttleSeqItem{{BrandID: "linked", Number: 1}}}}
	if err = a.saveState(t.Context(), stockState); err != nil {
		t.Fatal(err)
	}
	var stock int
	if err = db.QueryRow(`select stock_quantity from pos_products where id=$1`, productID).Scan(&stock); err != nil || stock != 9 {
		t.Fatalf("match stock after first use=%d err=%v", stock, err)
	}
	if err = a.saveState(t.Context(), stockState); err != nil {
		t.Fatal(err)
	}
	_ = db.QueryRow(`select stock_quantity from pos_products where id=$1`, productID).Scan(&stock)
	if stock != 9 {
		t.Fatalf("duplicate match state deducted stock again: %d", stock)
	}
	returnedMatch := stockState.Live[0]
	returnedMatch.Status = "cancelled"
	returnedMatch.ShuttleReturned = true
	stockState.Live = nil
	stockState.History = []Match{returnedMatch}
	if err = a.saveState(t.Context(), stockState); err != nil {
		t.Fatal(err)
	}
	_ = db.QueryRow(`select stock_quantity from pos_products where id=$1`, productID).Scan(&stock)
	if stock != 10 {
		t.Fatalf("cancelled match did not restore stock: %d", stock)
	}
	var matchMovementCount int
	if err = db.QueryRow(`select count(*) from pos_stock_movements where admin_id=$1 and product_id=$2 and reason in ('match_use','match_return')`, adminID, productID).Scan(&matchMovementCount); err != nil || matchMovementCount != 2 {
		t.Fatalf("match stock ledger rows=%d err=%v", matchMovementCount, err)
	}

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
	var activityDetails string
	if err = db.QueryRow(`select details::text from activity_logs where action='settle_combined_bill' and target_id=$1`, paymentID).Scan(&activityDetails); err != nil {
		t.Fatalf("POS-AUDIT-001 settlement activity missing: %v", err)
	}
	var settlementDetails struct {
		CashReceivedSatang int64            `json:"cashReceivedSatang"`
		ChangeSatang       int64            `json:"changeSatang"`
		Allocations        []map[string]any `json:"allocations"`
	}
	if err = json.Unmarshal([]byte(activityDetails), &settlementDetails); err != nil || settlementDetails.CashReceivedSatang != 4000 || settlementDetails.ChangeSatang != 897 || len(settlementDetails.Allocations) == 0 {
		t.Fatalf("POS-AUDIT-001 settlement details incomplete: %s", activityDetails)
	}
	if strings.Contains(activityDetails, "CASH-TEST") {
		t.Fatalf("POS-AUDIT-002 payment reference leaked into activity details: %s", activityDetails)
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
	sessionHistory, sessionHistoryTotal, err := a.listBillingPaymentHistory(t.Context(), adminID, matchSessionID, 1, 20)
	if err != nil || sessionHistoryTotal != 0 || len(sessionHistory) != 0 {
		t.Fatalf("session payment history leaked unrelated POS payment: total=%d items=%#v err=%v", sessionHistoryTotal, sessionHistory, err)
	}
	filteredHistory, filteredTotal, err := a.listBillingPaymentHistoryFiltered(t.Context(), adminID, "", "cash-test", "cash", 1, 20)
	if err != nil || filteredTotal != 1 || len(filteredHistory) != 1 || filteredHistory[0].PaymentID != paymentID {
		t.Fatalf("filtered history total=%d items=%#v err=%v", filteredTotal, filteredHistory, err)
	}
	filteredHistory, filteredTotal, err = a.listBillingPaymentHistoryFiltered(t.Context(), adminID, "", "cash-test", "promptpay", 1, 20)
	if err != nil || filteredTotal != 0 || len(filteredHistory) != 0 {
		t.Fatalf("payment method filter total=%d items=%#v err=%v", filteredTotal, filteredHistory, err)
	}

	// One physical sale can be split equally across several member ledgers while
	// stock is deducted exactly once.
	splitMemberIDs := []string{memberID}
	for index := 0; index < 2; index++ {
		id := "split-member-" + randHex(8)
		if _, err = db.Exec(`insert into members(id,admin_id,name,phone,active,profile_token_hash,profile_token) values($1,$2,$3,$4,true,$5,$6)`, id, adminID, fmt.Sprintf("Split Member %d", index+2), "09"+randHex(4), tokenDigest(id), id); err != nil {
			t.Fatal(err)
		}
		splitMemberIDs = append(splitMemberIDs, id)
	}
	splitResponse := requestSale(map[string]any{"requestId": "split-request-" + randHex(8), "action": "hold", "buyerType": "member", "splitMode": "equal", "buyerIds": splitMemberIDs, "discountType": "amount", "expectedTotalSatang": 1070, "items": []map[string]any{{"productId": productID, "quantity": 1}}})
	if splitResponse.Code != http.StatusCreated {
		t.Fatalf("split hold status=%d body=%s", splitResponse.Code, splitResponse.Body.String())
	}
	var splitPayload struct {
		SaleID string `json:"saleId"`
	}
	if err = json.NewDecoder(splitResponse.Body).Decode(&splitPayload); err != nil {
		t.Fatal(err)
	}
	var splitSum int64
	var splitRows int
	if err = db.QueryRow(`select count(*),coalesce(sum(share_satang),0) from pos_sale_splits where sale_id=$1`, splitPayload.SaleID).Scan(&splitRows, &splitSum); err != nil || splitRows != 3 || splitSum != 1070 {
		t.Fatalf("split rows=%d sum=%d err=%v", splitRows, splitSum, err)
	}
	_ = db.QueryRow(`select stock_quantity from pos_products where id=$1`, productID).Scan(&stock)
	if stock != 6 {
		t.Fatalf("split sale deducted stock more than once: %d", stock)
	}
	accountRows, err := db.Query(`select billing_account_id,share_satang from pos_sale_splits where sale_id=$1 order by position`, splitPayload.SaleID)
	if err != nil {
		t.Fatal(err)
	}
	type splitAccount struct {
		id    string
		share int64
	}
	splitAccounts := []splitAccount{}
	for accountRows.Next() {
		var item splitAccount
		_ = accountRows.Scan(&item.id, &item.share)
		splitAccounts = append(splitAccounts, item)
	}
	accountRows.Close()
	for _, item := range splitAccounts {
		if _, err = a.settleBillingAccount(t.Context(), owner, item.id, "cash", item.share, item.share, "", true, "pos"); err != nil {
			t.Fatal(err)
		}
	}
	var splitStatus string
	if err = db.QueryRow(`select status from pos_sales where id=$1`, splitPayload.SaleID).Scan(&splitStatus); err != nil || splitStatus != "paid" {
		t.Fatalf("split parent status=%q err=%v", splitStatus, err)
	}
	var firstSplitID string
	var firstSplitShare int64
	if err = db.QueryRow(`select sp.id,sp.share_satang from pos_sale_splits sp join billing_accounts ba on ba.id=sp.billing_account_id where sp.sale_id=$1 and ba.member_id=$2`, splitPayload.SaleID, splitMemberIDs[0]).Scan(&firstSplitID, &firstSplitShare); err != nil {
		t.Fatal(err)
	}
	memberItems := a.memberPaymentDetailItems(t.Context(), adminID, splitMemberIDs[0], "pos_split", firstSplitID)
	var memberItemTotal int64
	for _, detail := range memberItems {
		memberItemTotal += detail["amountSatang"].(int64)
	}
	if len(memberItems) == 0 || memberItemTotal != firstSplitShare {
		t.Fatalf("member split detail total=%d share=%d items=%#v", memberItemTotal, firstSplitShare, memberItems)
	}
	if leaked := a.memberPaymentDetailItems(t.Context(), adminID, splitMemberIDs[1], "pos_split", firstSplitID); len(leaked) != 0 {
		t.Fatalf("split payment detail leaked to another member: %#v", leaked)
	}

	voidSale := func(saleID string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/admin/pos/sales/"+saleID+"/void", bytes.NewReader([]byte(`{"note":"integration test"}`)))
		recorder := httptest.NewRecorder()
		a.voidPOSSale(recorder, req, owner, saleID)
		return recorder
	}
	voidableSplit := requestSale(map[string]any{"requestId": "split-void-" + randHex(8), "action": "hold", "buyerType": "member", "splitMode": "equal", "buyerIds": splitMemberIDs, "expectedTotalSatang": 1070, "items": []map[string]any{{"productId": productID, "quantity": 1}}})
	if voidableSplit.Code != http.StatusCreated {
		t.Fatalf("voidable split status=%d body=%s", voidableSplit.Code, voidableSplit.Body.String())
	}
	var voidablePayload struct {
		SaleID string `json:"saleId"`
	}
	_ = json.NewDecoder(voidableSplit.Body).Decode(&voidablePayload)
	if recorder := voidSale(voidablePayload.SaleID); recorder.Code != http.StatusOK {
		t.Fatalf("void split status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	_ = db.QueryRow(`select stock_quantity from pos_products where id=$1`, productID).Scan(&stock)
	if stock != 6 {
		t.Fatalf("void split did not restore stock exactly once: %d", stock)
	}

	partiallyPaid := requestSale(map[string]any{"requestId": "split-partial-" + randHex(8), "action": "hold", "buyerType": "member", "splitMode": "equal", "buyerIds": splitMemberIDs, "expectedTotalSatang": 1070, "items": []map[string]any{{"productId": productID, "quantity": 1}}})
	if partiallyPaid.Code != http.StatusCreated {
		t.Fatalf("partial split status=%d body=%s", partiallyPaid.Code, partiallyPaid.Body.String())
	}
	var partialPayload struct {
		SaleID string `json:"saleId"`
	}
	_ = json.NewDecoder(partiallyPaid.Body).Decode(&partialPayload)
	var partialAccount string
	var partialShare int64
	if err = db.QueryRow(`select billing_account_id,share_satang from pos_sale_splits where sale_id=$1 order by position limit 1`, partialPayload.SaleID).Scan(&partialAccount, &partialShare); err != nil {
		t.Fatal(err)
	}
	if _, err = a.settleBillingAccount(t.Context(), owner, partialAccount, "cash", partialShare, partialShare, "", true, "pos"); err != nil {
		t.Fatal(err)
	}
	if recorder := voidSale(partialPayload.SaleID); recorder.Code != http.StatusConflict {
		t.Fatalf("partially paid split void status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	_ = db.QueryRow(`select stock_quantity from pos_products where id=$1`, productID).Scan(&stock)
	if stock != 5 {
		t.Fatalf("blocked split void changed stock: %d", stock)
	}

	insufficient := requestSale(map[string]any{"requestId": "sale-request-" + randHex(8), "action": "pay", "buyerType": "anonymous", "method": "cash", "discountType": "amount", "expectedTotalSatang": 10700, "cashReceivedSatang": 10700, "items": []map[string]any{{"productId": productID, "quantity": 10}}})
	if insufficient.Code != http.StatusConflict {
		t.Fatalf("insufficient status=%d body=%s", insufficient.Code, insufficient.Body.String())
	}
	_ = db.QueryRow(`select stock_quantity from pos_products where id=$1`, productID).Scan(&stock)
	if stock != 5 {
		t.Fatalf("failed sale changed stock: %d", stock)
	}
}
