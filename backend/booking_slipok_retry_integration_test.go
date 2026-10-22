package main

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestBookingSlipOKRetryConfirmsWithoutBlockingIntegration(t *testing.T) {
	dsn := os.Getenv("LIVEMATCH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run PostgreSQL booking SlipOK retry tests")
	}
	t.Setenv("APP_ENCRYPTION_KEY", strings.Repeat("r", 32))
	t.Setenv("BOOKING_SLIP_STORAGE_DIR", t.TempDir())

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &app{db: db}

	adminID := "slipok-retry-admin-" + randHex(8)
	courtID := "slipok-retry-court-" + randHex(8)
	bookingID := "slipok-retry-booking-" + randHex(8)
	paymentID := "slipok-retry-payment-" + randHex(8)
	if _, err = db.Exec(`insert into admin_users(id,email,name,password_hash,verified_at) values($1,$2,'SlipOK Retry QA','unused',now())`, adminID, adminID+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(`delete from slipok_logs where admin_id=$1`, adminID)
		_, _ = db.Exec(`delete from admin_users where id=$1`, adminID)
	}()
	encryptedKey, err := encryptSecret("retry-secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into booking_settings(admin_id,public_token_hash,public_token,slipok_enabled,slipok_branch_id,slipok_api_key,slipok_limit_enabled) values($1,$2,$3,true,'retry-branch',$4,false)`, adminID, tokenDigest(adminID), adminID, encryptedKey); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into booking_courts(id,admin_id,name,price_per_interval) values($1,$2,'สนาม Retry',100)`, courtID, adminID); err != nil {
		t.Fatal(err)
	}
	start := time.Now().Add(time.Hour)
	end := start.Add(time.Hour)
	if _, err = db.Exec(`insert into bookings(id,admin_id,court_id,booker_name,start_at,end_at,interval_minutes,unit_price_thb,total_price_thb,status,payment_status,hold_expires_at) values($1,$2,$3,'Retry User',$4,$5,60,100,100,'pending_review','pending',$5)`, bookingID, adminID, courtID, start, end); err != nil {
		t.Fatal(err)
	}
	stored, err := storeBookingSlip(adminID, paymentID, testPNG(t))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into booking_payments(id,admin_id,booking_id,amount_thb,status,slip_file_key,slip_mime_type,slip_size_bytes,slip_sha256,verification_provider,verification_status,verification_note,provider_error_code,provider_retry_at) values($1,$2,$3,100,'pending',$4,$5,$6,$7,'slipok','pending_retry','รอตรวจซ้ำ',1010,now())`, paymentID, adminID, bookingID, stored.Key, stored.MIME, stored.Size, stored.SHA256); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-authorization") != "retry-secret" {
			t.Fatalf("unexpected authorization header")
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"success": true,
			"data": map[string]any{
				"success": true, "transRef": "SCB-RETRY-OK", "amount": 100,
				"transTimestamp": "2026-09-10T10:00:00+07:00",
				"receiver":       map[string]any{"displayName": "สนาม Retry"},
			},
		})
	}))
	defer server.Close()
	previousBaseURL := slipOKAPIBaseURL
	slipOKAPIBaseURL = server.URL
	defer func() { slipOKAPIBaseURL = previousBaseURL }()

	job := bookingSlipOKRetryJob{PaymentID: paymentID, AdminID: adminID, BookingID: bookingID, AmountTHB: 100}
	if err = a.processBookingSlipOKRetry(t.Context(), job); err != nil {
		t.Fatal(err)
	}

	var bookingStatus, bookingPaymentStatus, decisionSource, paymentStatus, verificationStatus, transRef string
	var retryAt, claimedAt sql.NullTime
	var retryCount, incidentCount, usage int
	if err = db.QueryRow(`select status,payment_status,decision_source from bookings where id=$1`, bookingID).Scan(&bookingStatus, &bookingPaymentStatus, &decisionSource); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`select status,verification_status,trans_ref,provider_retry_count,provider_retry_at,provider_retry_claimed_at from booking_payments where id=$1`, paymentID).Scan(&paymentStatus, &verificationStatus, &transRef, &retryCount, &retryAt, &claimedAt); err != nil {
		t.Fatal(err)
	}
	_ = db.QueryRow(`select count(*) from booking_security_incidents where payment_id=$1`, paymentID).Scan(&incidentCount)
	_ = db.QueryRow(`select coalesce(sum(used),0) from slipok_monthly_usage where admin_id=$1 and source_system='booking'`, adminID).Scan(&usage)
	if bookingStatus != "confirmed" || bookingPaymentStatus != "paid" || decisionSource != "auto_slip" || paymentStatus != "approved" || verificationStatus != "passed" || transRef != "SCB-RETRY-OK" || retryCount != 1 || retryAt.Valid || claimedAt.Valid || incidentCount != 0 || usage != 1 {
		t.Fatalf("retry result booking=%s/%s source=%s payment=%s/%s ref=%s retries=%d retryAt=%v claimedAt=%v incidents=%d usage=%d", bookingStatus, bookingPaymentStatus, decisionSource, paymentStatus, verificationStatus, transRef, retryCount, retryAt.Valid, claimedAt.Valid, incidentCount, usage)
	}
}
