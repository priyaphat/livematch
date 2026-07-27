package main

import (
	"bytes"
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"
)

func TestSessionBillingIntegration(t *testing.T) {
	dsn := os.Getenv("LIVEMATCH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run PostgreSQL billing integration tests")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(8)
	if err := db.Ping(); err != nil {
		t.Fatal(err)
	}

	a := &app{db: db}
	adminID := "billing-test-" + randHex(8)
	email := adminID + "@example.invalid"
	today := time.Now().In(bangkokLocation).Format("2006-01-02")
	if _, err := db.Exec(`
		insert into admin_users (id, email, name, password_hash, verified_at, coins)
		values ($1, $2, 'Billing integration test', 'not-used', now(), 100)
	`, adminID, email); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(`delete from activity_logs where actor_id = $1 or target_id = $1`, adminID)
		_, _ = db.Exec(`delete from sessions where admin_id = $1`, adminID)
		_, _ = db.Exec(`delete from admin_users where id = $1`, adminID)
	}()

	baseCost, hasCost, err := a.sessionCoinCost(t.Context(), "liveMatch")
	if err != nil {
		t.Fatal(err)
	}
	if !hasCost {
		t.Skip("liveMatch session price is not configured")
	}
	netCost := effectiveSessionCost(baseCost, 10)
	if _, err := db.Exec(`insert into admin_discounts (admin_id, discount_percent, updated_by) values ($1, 10, 'integration-test')`, adminID); err != nil {
		t.Fatal(err)
	}
	subscriptionID := "subscription-test-" + randHex(8)
	if _, err := db.Exec(`
		insert into admin_subscriptions (id, admin_id, start_date, end_date, total_sessions, paid_amount_thb, note, created_by)
		values ($1, $2, $3::date, $3::date, 1, 999, 'integration test', 'integration-test')
	`, subscriptionID, adminID, today); err != nil {
		t.Fatal(err)
	}

	// Both requests lie about pricing. The backend must still consume the one
	// subscription entitlement first and charge the server-calculated price once.
	start := make(chan struct{})
	results := make(chan *httptest.ResponseRecorder, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			<-start
			body := []byte(fmt.Sprintf(`{"name":"Billing test %d","type":"liveMatch","price":0,"discountPercent":100,"remaining":999}`, index))
			req := httptest.NewRequest(http.MethodPost, "/api/admin/sessions", bytes.NewReader(body))
			recorder := httptest.NewRecorder()
			a.handleCreateOwnedSession(recorder, req, adminUser{ID: adminID, Email: email, Coins: 100, Verified: true})
			results <- recorder
		}(i)
	}
	close(start)
	wg.Wait()
	close(results)
	for recorder := range results {
		if recorder.Code != http.StatusCreated {
			t.Fatalf("create session status = %d, body = %s", recorder.Code, recorder.Body.String())
		}
	}

	var subscriptionBillings, coinBillings int
	if err := db.QueryRow(`select count(*) from session_billing where admin_id = $1 and billing_method = 'subscription'`, adminID).Scan(&subscriptionBillings); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select count(*) from session_billing where admin_id = $1 and billing_method = 'coin' and base_coin_cost = $2 and discount_percent = 10 and charged_coin_cost = $3`, adminID, baseCost, netCost).Scan(&coinBillings); err != nil {
		t.Fatal(err)
	}
	if subscriptionBillings != 1 || coinBillings != 1 {
		t.Fatalf("billing methods = subscription:%d coin:%d, want one each", subscriptionBillings, coinBillings)
	}
	var usedSessions, coins int
	if err := db.QueryRow(`select used_sessions from admin_subscriptions where id = $1`, subscriptionID).Scan(&usedSessions); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select coins from admin_users where id = $1`, adminID).Scan(&coins); err != nil {
		t.Fatal(err)
	}
	if usedSessions != 1 || coins != 100-netCost {
		t.Fatalf("usedSessions=%d coins=%d, want 1 and %d", usedSessions, coins, 100-netCost)
	}

	// A failed outer transaction must return the entitlement to its prior state.
	if _, err := db.Exec(`update admin_subscriptions set used_sessions = 0 where id = $1`, subscriptionID); err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	decision, err := consumeSessionBillingTx(t.Context(), tx, adminID, "liveMatch")
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if decision.Method != "subscription" {
		_ = tx.Rollback()
		t.Fatalf("rollback setup used %q billing, want subscription", decision.Method)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select used_sessions from admin_subscriptions where id = $1`, subscriptionID).Scan(&usedSessions); err != nil {
		t.Fatal(err)
	}
	if usedSessions != 0 {
		t.Fatalf("rolled back entitlement usage = %d, want 0", usedSessions)
	}
}

func TestIdempotentSessionCreateAndCoinRefundDeleteIntegration(t *testing.T) {
	dsn := os.Getenv("LIVEMATCH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run PostgreSQL billing integration tests")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = db.Ping(); err != nil {
		t.Fatal(err)
	}
	a := &app{db: db}
	adminID := "session-delete-test-" + randHex(8)
	email := adminID + "@example.invalid"
	if _, err = db.Exec(`insert into admin_users (id,email,name,password_hash,verified_at,coins) values ($1,$2,'Session delete test','not-used',now(),1000)`, adminID, email); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(`delete from activity_logs where actor_id = $1 or (target_type = 'session' and details->>'adminId' = $1)`, adminID)
		_, _ = db.Exec(`delete from sessions where admin_id = $1`, adminID)
		_, _ = db.Exec(`delete from admin_users where id = $1`, adminID)
	}()

	baseCost, hasCost, err := a.sessionCoinCost(t.Context(), "liveMatch")
	if err != nil {
		t.Fatal(err)
	}
	if !hasCost || baseCost <= 0 {
		t.Skip("positive liveMatch session price is required")
	}
	requestID := "request-" + randHex(8)
	start := make(chan struct{})
	responses := make(chan *httptest.ResponseRecorder, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			req := httptest.NewRequest(http.MethodPost, "/api/admin/sessions", bytes.NewReader([]byte(fmt.Sprintf(`{"name":"Idempotent session","type":"liveMatch","requestId":"%s"}`, requestID))))
			recorder := httptest.NewRecorder()
			a.handleCreateOwnedSession(recorder, req, adminUser{ID: adminID, Email: email, Coins: 1000, Verified: true})
			responses <- recorder
		}()
	}
	close(start)
	wg.Wait()
	close(responses)
	for response := range responses {
		if response.Code != http.StatusCreated && response.Code != http.StatusOK {
			t.Fatalf("idempotent create status=%d body=%s", response.Code, response.Body.String())
		}
	}

	var sessionID string
	var sessionCount, chargedCost, coins int
	if err = db.QueryRow(`select count(*), min(session_id), max(charged_coin_cost) from session_billing where admin_id=$1 and create_request_id=$2`, adminID, requestID).Scan(&sessionCount, &sessionID, &chargedCost); err != nil {
		t.Fatal(err)
	}
	if sessionCount != 1 {
		t.Fatalf("created %d sessions for one request id", sessionCount)
	}
	if err = db.QueryRow(`select coins from admin_users where id=$1`, adminID).Scan(&coins); err != nil {
		t.Fatal(err)
	}
	if coins != 1000-chargedCost {
		t.Fatalf("coins=%d want %d after one charge", coins, 1000-chargedCost)
	}
	if _, err = db.Exec(`insert into players (session_id,id,name,active,level) values ($1,1,'Setup player',true,'middle')`, sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into matches (session_id,id,phase,level,a1,a2,b1,b2) values ($1,1,'queue','middle',1,2,3,4)`, sessionID); err != nil {
		t.Fatal(err)
	}
	deleteReq := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/backoffice/admins/%s/sessions/%s?refund=true", adminID, sessionID), nil)
	deleteRecorder := httptest.NewRecorder()
	a.handleBackofficeSessionDelete(deleteRecorder, deleteReq, "integration-test")
	if deleteRecorder.Code != http.StatusOK {
		t.Fatalf("delete with refund status=%d body=%s", deleteRecorder.Code, deleteRecorder.Body.String())
	}
	if err = db.QueryRow(`select coins from admin_users where id=$1`, adminID).Scan(&coins); err != nil {
		t.Fatal(err)
	}
	if coins != 1000 {
		t.Fatalf("coins=%d want 1000 after refund", coins)
	}
	var remaining int
	if err = db.QueryRow(`select count(*) from sessions where id=$1`, sessionID).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatalf("session remaining=%d err=%v", remaining, err)
	}
	var refunds int
	if err = db.QueryRow(`select count(*) from coin_ledger where admin_id=$1 and reason='session_refund'`, adminID).Scan(&refunds); err != nil || refunds != 1 {
		t.Fatalf("refund ledger count=%d err=%v", refunds, err)
	}

	normalDeleteID := "normal-delete-session-" + randHex(6)
	if _, err = db.Exec(`insert into sessions (id,name,session_type,admin_id) values ($1,'Normal delete','liveMatch',$2)`, normalDeleteID, adminID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into session_billing (session_id,admin_id,session_type,billing_method,charged_coin_cost) values ($1,$2,'liveMatch','coin',25)`, normalDeleteID, adminID); err != nil {
		t.Fatal(err)
	}
	var coinsBeforeNormalDelete int
	if err = db.QueryRow(`select coins from admin_users where id=$1`, adminID).Scan(&coinsBeforeNormalDelete); err != nil {
		t.Fatal(err)
	}
	normalDeleteReq := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/backoffice/admins/%s/sessions/%s?refund=false", adminID, normalDeleteID), nil)
	normalDeleteRecorder := httptest.NewRecorder()
	a.handleBackofficeSessionDelete(normalDeleteRecorder, normalDeleteReq, "integration-test")
	if normalDeleteRecorder.Code != http.StatusOK {
		t.Fatalf("normal delete status=%d body=%s", normalDeleteRecorder.Code, normalDeleteRecorder.Body.String())
	}
	if err = db.QueryRow(`select coins from admin_users where id=$1`, adminID).Scan(&coins); err != nil || coins != coinsBeforeNormalDelete {
		t.Fatalf("normal delete coins=%d want %d err=%v", coins, coinsBeforeNormalDelete, err)
	}

	concurrentDeleteID := "concurrent-delete-session-" + randHex(6)
	if _, err = db.Exec(`insert into sessions (id,name,session_type,admin_id) values ($1,'Concurrent delete','liveMatch',$2)`, concurrentDeleteID, adminID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into session_billing (session_id,admin_id,session_type,billing_method,charged_coin_cost) values ($1,$2,'liveMatch','coin',25)`, concurrentDeleteID, adminID); err != nil {
		t.Fatal(err)
	}
	deleteResponses := make(chan *httptest.ResponseRecorder, 2)
	deleteStart := make(chan struct{})
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-deleteStart
			req := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/backoffice/admins/%s/sessions/%s?refund=true", adminID, concurrentDeleteID), nil)
			recorder := httptest.NewRecorder()
			a.handleBackofficeSessionDelete(recorder, req, "integration-test")
			deleteResponses <- recorder
		}()
	}
	close(deleteStart)
	wg.Wait()
	close(deleteResponses)
	deleteSuccesses := 0
	for response := range deleteResponses {
		if response.Code == http.StatusOK {
			deleteSuccesses++
		} else if response.Code != http.StatusNotFound {
			t.Fatalf("concurrent delete unexpected status=%d body=%s", response.Code, response.Body.String())
		}
	}
	if deleteSuccesses != 1 {
		t.Fatalf("concurrent delete succeeded %d times, want once", deleteSuccesses)
	}
	if err = db.QueryRow(`select count(*) from coin_ledger where admin_id=$1 and reason='session_refund'`, adminID).Scan(&refunds); err != nil || refunds != 2 {
		t.Fatalf("refund ledger after concurrent delete count=%d err=%v", refunds, err)
	}

	subscriptionID := "refund-sub-" + randHex(6)
	subscriptionSessionID := "refund-sub-session-" + randHex(6)
	if _, err = db.Exec(`insert into admin_subscriptions (id,admin_id,start_date,end_date,total_sessions,used_sessions,created_by) values ($1,$2,current_date,current_date,2,1,'integration-test')`, subscriptionID, adminID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into sessions (id,name,session_type,admin_id) values ($1,'Subscription session','liveMatch',$2)`, subscriptionSessionID, adminID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into session_billing (session_id,admin_id,session_type,billing_method,subscription_id) values ($1,$2,'liveMatch','subscription',$3)`, subscriptionSessionID, adminID, subscriptionID); err != nil {
		t.Fatal(err)
	}
	subDeleteReq := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/backoffice/admins/%s/sessions/%s?refund=true", adminID, subscriptionSessionID), nil)
	subDeleteRecorder := httptest.NewRecorder()
	a.handleBackofficeSessionDelete(subDeleteRecorder, subDeleteReq, "integration-test")
	if subDeleteRecorder.Code != http.StatusOK {
		t.Fatalf("subscription refund status=%d body=%s", subDeleteRecorder.Code, subDeleteRecorder.Body.String())
	}
	var usedSessions int
	if err = db.QueryRow(`select used_sessions from admin_subscriptions where id=$1`, subscriptionID).Scan(&usedSessions); err != nil || usedSessions != 0 {
		t.Fatalf("used sessions=%d err=%v", usedSessions, err)
	}

	usedSessionID := "used-session-" + randHex(6)
	if _, err = db.Exec(`insert into sessions (id,name,session_type,admin_id,usage_started_at) values ($1,'Used session','liveMatch',$2,now())`, usedSessionID, adminID); err != nil {
		t.Fatal(err)
	}
	blockedReq := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/backoffice/admins/%s/sessions/%s?refund=false", adminID, usedSessionID), nil)
	blockedRecorder := httptest.NewRecorder()
	a.handleBackofficeSessionDelete(blockedRecorder, blockedReq, "integration-test")
	if blockedRecorder.Code != http.StatusConflict {
		t.Fatalf("used session delete status=%d body=%s", blockedRecorder.Code, blockedRecorder.Body.String())
	}
}

func TestSubscriptionPurchaseApprovalIntegration(t *testing.T) {
	dsn := os.Getenv("LIVEMATCH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run PostgreSQL billing integration tests")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		t.Fatal(err)
	}
	a := &app{db: db}
	adminID := "subscription-shop-test-" + randHex(8)
	packageID := "subscription-package-test-" + randHex(6)
	email := adminID + "@example.invalid"
	if _, err := db.Exec(`
		insert into admin_users (id, email, name, password_hash, verified_at, coins)
		values ($1, $2, 'Subscription shop integration test', 'not-used', now(), 123)
	`, adminID, email); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(`delete from activity_logs where actor_id = $1 or target_id = $1 or target_id like 'subscription-order-test-%' or target_id like 'subscription-order-reject-%'`, adminID)
		_, _ = db.Exec(`delete from admin_users where id = $1`, adminID)
		_, _ = db.Exec(`delete from subscription_packages where id = $1`, packageID)
	}()
	if _, err := db.Exec(`insert into admin_discounts (admin_id, discount_percent, updated_by) values ($1, 75, 'integration-test')`, adminID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		insert into subscription_packages (id, name, price_thb, total_sessions, duration_days, active)
		values ($1, 'Pro 30', 999, 30, 30, true)
	`, packageID); err != nil {
		t.Fatal(err)
	}

	today, _ := validSubscriptionDate(todayBangkok())
	currentEnd := today.AddDate(0, 0, 4)
	currentID := "subscription-current-" + randHex(6)
	if _, err := db.Exec(`
		insert into admin_subscriptions (id, admin_id, start_date, end_date, total_sessions, used_sessions, paid_amount_thb, note, created_by)
		values ($1, $2, $3::date, $4::date, 5, 5, 500, 'exhausted current period', 'integration-test')
	`, currentID, adminID, today.Format("2006-01-02"), currentEnd.Format("2006-01-02")); err != nil {
		t.Fatal(err)
	}
	orderID := "subscription-order-test-" + randHex(6)
	if _, err := db.Exec(`
		insert into coin_purchase_orders (
			id, admin_id, product_type, package_id, package_name, price_thb, coins,
			total_sessions, duration_days, slip_image, status, verification_status
		) values ($1, $2, 'subscription', $3, 'Pro 30', 999, 0, 30, 30, 'test-slip', 'pending', 'manual_review')
	`, orderID, adminID, packageID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`update subscription_packages set price_thb = 1, total_sessions = 1, duration_days = 1 where id = $1`, packageID); err != nil {
		t.Fatal(err)
	}

	if err := a.reviewCoinOrder(t.Context(), orderID, "approved", "backoffice", "integration-test", "approved in integration test"); err != nil {
		t.Fatal(err)
	}
	var subscriptionID, startDate, endDate string
	var totalSessions, paidAmount, coins int
	if err := db.QueryRow(`select coalesce(subscription_id, '') from coin_purchase_orders where id = $1`, orderID).Scan(&subscriptionID); err != nil {
		t.Fatal(err)
	}
	if subscriptionID == "" {
		t.Fatal("approved subscription order did not create an entitlement")
	}
	if err := db.QueryRow(`
		select to_char(start_date, 'YYYY-MM-DD'), to_char(end_date, 'YYYY-MM-DD'), total_sessions, paid_amount_thb
		from admin_subscriptions where id = $1
	`, subscriptionID).Scan(&startDate, &endDate, &totalSessions, &paidAmount); err != nil {
		t.Fatal(err)
	}
	expectedStart := currentEnd.AddDate(0, 0, 1)
	expectedEnd := expectedStart.AddDate(0, 0, 29)
	if startDate != expectedStart.Format("2006-01-02") || endDate != expectedEnd.Format("2006-01-02") {
		t.Fatalf("subscription period = %s..%s, want %s..%s", startDate, endDate, expectedStart.Format("2006-01-02"), expectedEnd.Format("2006-01-02"))
	}
	if totalSessions != 30 || paidAmount != 999 {
		t.Fatalf("subscription snapshot = sessions:%d paid:%d, want 30 and 999", totalSessions, paidAmount)
	}
	if err := db.QueryRow(`select coins from admin_users where id = $1`, adminID).Scan(&coins); err != nil {
		t.Fatal(err)
	}
	if coins != 123 {
		t.Fatalf("subscription purchase changed coin balance to %d, want 123", coins)
	}
	eligibility, err := subscriptionPurchaseEligibilityForAdmin(t.Context(), db, adminID)
	if err != nil {
		t.Fatal(err)
	}
	if eligibility.CanPurchase || eligibility.Reason == "" {
		t.Fatalf("eligibility after queued renewal = %#v, want blocked with reason", eligibility)
	}

	rejectedOrderID := "subscription-order-reject-" + randHex(6)
	if _, err := db.Exec(`
		insert into coin_purchase_orders (
			id, admin_id, product_type, package_id, package_name, price_thb, coins,
			total_sessions, duration_days, slip_image, status, verification_status
		) values ($1, $2, 'subscription', 'pro-30', 'Pro 30', 999, 0, 30, 30, 'test-slip-2', 'pending', 'manual_review')
	`, rejectedOrderID, adminID); err != nil {
		t.Fatal(err)
	}
	if err := a.reviewCoinOrder(t.Context(), rejectedOrderID, "rejected", "backoffice", "integration-test", "rejected in integration test"); err != nil {
		t.Fatal(err)
	}
	var rejectedSubscription sql.NullString
	if err := db.QueryRow(`select subscription_id from coin_purchase_orders where id = $1`, rejectedOrderID).Scan(&rejectedSubscription); err != nil {
		t.Fatal(err)
	}
	if rejectedSubscription.Valid {
		t.Fatalf("rejected order created subscription %q", rejectedSubscription.String)
	}
}

func TestPendingSubscriptionOrderUniqueIntegration(t *testing.T) {
	dsn := os.Getenv("LIVEMATCH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run PostgreSQL billing integration tests")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adminID := "subscription-pending-test-" + randHex(8)
	if _, err := db.Exec(`
		insert into admin_users (id, email, name, password_hash, verified_at, coins)
		values ($1, $2, 'Pending subscription test', 'not-used', now(), 0)
	`, adminID, adminID+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(`delete from admin_users where id = $1`, adminID)
	}()

	start := make(chan struct{})
	errorsCh := make(chan error, 2)
	var wg sync.WaitGroup
	for index := 0; index < 2; index++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			<-start
			_, insertErr := db.Exec(`
				insert into coin_purchase_orders (
					id, admin_id, product_type, package_id, package_name, price_thb, coins,
					total_sessions, duration_days, slip_image, status, verification_status
				) values ($1, $2, 'subscription', 'pro', 'Pro', 999, 0, 30, 30, $3, 'pending', 'manual_review')
			`, fmt.Sprintf("subscription-pending-order-%s-%d", randHex(4), index), adminID, fmt.Sprintf("slip-%d", index))
			errorsCh <- insertErr
		}(index)
	}
	close(start)
	wg.Wait()
	close(errorsCh)
	successes := 0
	for insertErr := range errorsCh {
		if insertErr == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("concurrent pending subscription inserts succeeded %d times, want exactly 1", successes)
	}
	var count int
	if err := db.QueryRow(`select count(*) from coin_purchase_orders where admin_id = $1 and product_type = 'subscription' and status = 'pending'`, adminID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("pending subscription order count = %d, want 1", count)
	}
}
