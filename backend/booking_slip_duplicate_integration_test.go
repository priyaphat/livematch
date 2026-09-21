package main

import (
	"database/sql"
	"os"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestBookingSlipAliasesRejectProviderTimeoutDuplicateIntegration(t *testing.T) {
	dsn := os.Getenv("LIVEMATCH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run PostgreSQL booking duplicate-slip tests")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	adminID := "slip-duplicate-admin-" + randHex(8)
	courtID := "slip-duplicate-court-" + randHex(8)
	firstBookingID := "slip-duplicate-booking-a-" + randHex(8)
	secondBookingID := "slip-duplicate-booking-b-" + randHex(8)
	firstPaymentID := "slip-duplicate-payment-a-" + randHex(8)
	secondPaymentID := "slip-duplicate-payment-b-" + randHex(8)
	if _, err = db.Exec(`insert into admin_users(id,email,name,password_hash,verified_at) values($1,$2,'Duplicate Slip QA','unused',now())`, adminID, adminID+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = db.Exec(`delete from admin_users where id=$1`, adminID) }()
	if _, err = db.Exec(`insert into booking_courts(id,admin_id,name,price_per_interval) values($1,$2,'สนาม Duplicate',100)`, courtID, adminID); err != nil {
		t.Fatal(err)
	}
	start := time.Now().Add(time.Hour)
	end := start.Add(time.Hour)
	for index, bookingID := range []string{firstBookingID, secondBookingID} {
		bookingStart := start.Add(time.Duration(index) * time.Hour)
		bookingEnd := end.Add(time.Duration(index) * time.Hour)
		if _, err = db.Exec(`insert into bookings(id,admin_id,court_id,booker_name,start_at,end_at,interval_minutes,unit_price_thb,total_price_thb,status,payment_status,hold_expires_at) values($1,$2,$3,'Duplicate User',$4,$5,60,100,100,'pending_review','pending',$5)`, bookingID, adminID, courtID, bookingStart, bookingEnd); err != nil {
			t.Fatal(err)
		}
	}
	for index, paymentID := range []string{firstPaymentID, secondPaymentID} {
		bookingID := firstBookingID
		if index == 1 {
			bookingID = secondBookingID
		}
		if _, err = db.Exec(`insert into booking_payments(id,admin_id,booking_id,amount_thb,status,verification_status) values($1,$2,$3,100,'pending','manual_review')`, paymentID, adminID, bookingID); err != nil {
			t.Fatal(err)
		}
	}

	const slipSHA = "132bcdbb52f211a6e9a98d06740ca3aa474edce104fe7fdbf9c95c99d0aaaaf0"
	const qrPayload = "0041000600000101030040220016260082840BPP008075102TH9104CB7C"
	firstTx, err := db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	duplicateID, err := reserveBookingSlipAliasesTx(t.Context(), firstTx, adminID, firstPaymentID, "", "016260082840BPP00807", slipSHA, qrPayload)
	if err != nil || duplicateID != "" {
		_ = firstTx.Rollback()
		t.Fatalf("first slip reserve duplicate=%q err=%v", duplicateID, err)
	}
	if err = firstTx.Commit(); err != nil {
		t.Fatal(err)
	}

	secondTx, err := db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	// This models the production incident: SlipOK timed out, so the second
	// submission has a local qrhash instead of the first provider transRef.
	duplicateID, err = reserveBookingSlipAliasesTx(t.Context(), secondTx, adminID, secondPaymentID, "", "qrhash-"+shortHash(qrPayload), slipSHA, qrPayload)
	if err != nil {
		_ = secondTx.Rollback()
		t.Fatal(err)
	}
	if duplicateID != firstPaymentID {
		_ = secondTx.Rollback()
		t.Fatalf("duplicate owner=%q want=%q", duplicateID, firstPaymentID)
	}
	if err = secondTx.Commit(); err != nil {
		t.Fatal(err)
	}
	var secondAliasCount int
	if err = db.QueryRow(`select count(*) from booking_slip_refs where admin_id=$1 and payment_id=$2`, adminID, secondPaymentID).Scan(&secondAliasCount); err != nil {
		t.Fatal(err)
	}
	if secondAliasCount != 0 {
		t.Fatalf("rejected duplicate retained %d fingerprint aliases", secondAliasCount)
	}
}
