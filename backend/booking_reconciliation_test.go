package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"
)

func TestBookingLedgerReconciliationIntegration(t *testing.T) {
	dsn := os.Getenv("LIVEMATCH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run PostgreSQL booking reconciliation tests")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(8)
	if err = db.Ping(); err != nil {
		t.Fatal(err)
	}

	a := &app{db: db}
	adminID := "booking-ledger-" + randHex(8)
	memberID := "booking-member-" + randHex(8)
	courtA := "booking-court-a-" + randHex(6)
	courtB := "booking-court-b-" + randHex(6)
	email := adminID + "@example.invalid"
	publicToken := "booking-token-" + randHex(12)
	if _, err = db.Exec(`insert into admin_users(id,email,name,password_hash,verified_at) values($1,$2,'Booking Ledger QA','unused',now())`, adminID, email); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(`delete from activity_logs where actor_id=$1 or target_id=$1 or details::text like '%'||$1||'%'`, adminID)
		_, _ = db.Exec(`delete from admin_users where id=$1`, adminID)
	}()
	if _, err = db.Exec(`insert into admin_features(admin_id,member_enabled,booking_enabled) values($1,true,true)`, adminID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into member_types(id,admin_id,code,name,system,active) values($1,$2,'general','สมาชิกทั่วไป',true,true)`, "booking-type-"+randHex(6), adminID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into members(id,admin_id,name,phone,active,profile_token_hash,profile_token) values($1,$2,'สมาชิก Booking Ledger',$3,true,$4,$5)`, memberID, adminID, "08"+randHex(4), tokenDigest(memberID), memberID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into booking_settings(admin_id,public_token_hash,public_token,open_time,close_time,interval_minutes,allow_overnight,use_same_price,promptpay_type,promptpay_id,promptpay_receiver_name) values($1,$2,$3,'16:00','22:00',30,true,true,'mobile','0812345678','Booking Ledger QA')`, adminID, tokenDigest(publicToken), publicToken); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into booking_courts(id,admin_id,name,price_per_interval,sort_order,active) values($1,$3,'สนาม A',120,1,true),($2,$3,'สนาม B',150,2,true)`, courtA, courtB, adminID); err != nil {
		t.Fatal(err)
	}

	owner := adminUser{ID: adminID, Email: email, Name: "Booking Ledger QA", Verified: true}
	day := time.Now().In(bangkokLocation).AddDate(0, 0, 2)
	at := func(hour, minute int) time.Time {
		return time.Date(day.Year(), day.Month(), day.Day(), hour, minute, 0, 0, bangkokLocation)
	}
	requestBatch := func(items []map[string]string) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(map[string]any{"memberId": memberID, "items": items})
		req := httptest.NewRequest(http.MethodPost, "/api/admin/booking/bookings", bytes.NewReader(raw))
		recorder := httptest.NewRecorder()
		a.createAdminBooking(recorder, req, owner)
		return recorder
	}
	item := func(courtID string, start, end time.Time) map[string]string {
		return map[string]string{"courtId": courtID, "startAt": start.Format("2006-01-02T15:04"), "endAt": end.Format("2006-01-02T15:04")}
	}

	created := requestBatch([]map[string]string{
		item(courtA, at(18, 0), at(19, 0)),  // 2 x 120 = 240
		item(courtB, at(18, 0), at(18, 30)), // 1 x 150 = 150
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create batch status=%d body=%s", created.Code, created.Body.String())
	}
	var payload struct {
		BatchID       string          `json:"batchId"`
		Bookings      []bookingRecord `json:"bookings"`
		TotalPriceTHB int             `json:"totalPriceThb"`
	}
	if err = json.NewDecoder(created.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Bookings) != 2 || payload.TotalPriceTHB != 390 || payload.Bookings[0].TotalPrice != 240 || payload.Bookings[1].TotalPrice != 150 {
		t.Fatalf("batch pricing mismatch: %#v", payload)
	}
	var bookingCount, occupancyCount, total int
	if err = db.QueryRow(`select count(*),sum(total_price_thb) from bookings where admin_id=$1 and booking_batch_id=$2`, adminID, payload.BatchID).Scan(&bookingCount, &total); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`select count(*) from booking_occupancies where admin_id=$1 and booking_id=any($2) and active`, adminID, []string{payload.Bookings[0].ID, payload.Bookings[1].ID}).Scan(&occupancyCount); err != nil {
		t.Fatal(err)
	}
	if bookingCount != 2 || occupancyCount != 2 || total != 390 {
		t.Fatalf("persisted batch count=%d occupancy=%d total=%d", bookingCount, occupancyCount, total)
	}

	// One overlapping line must roll back the whole document, including its first free line.
	rollback := requestBatch([]map[string]string{
		item(courtA, at(19, 0), at(19, 30)),
		item(courtA, at(18, 30), at(19, 0)),
	})
	if rollback.Code != http.StatusConflict {
		t.Fatalf("overlap batch status=%d body=%s", rollback.Code, rollback.Body.String())
	}
	if err = db.QueryRow(`select count(*) from bookings where admin_id=$1 and court_id=$2 and start_at=$3`, adminID, courtA, at(19, 0)).Scan(&bookingCount); err != nil || bookingCount != 0 {
		t.Fatalf("rolled back batch leaked booking count=%d err=%v", bookingCount, err)
	}

	// Two simultaneous requests for the same range: exactly one may own the slot.
	start := make(chan struct{})
	errorsByRequest := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, createErr := a.createBookingTx(t.Context(), adminID, courtA, memberID, "admin", "สมาชิก Booking Ledger", at(20, 0), at(20, 30), "confirmed")
			errorsByRequest <- createErr
		}()
	}
	close(start)
	wg.Wait()
	close(errorsByRequest)
	successes := 0
	for createErr := range errorsByRequest {
		if createErr == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("concurrent booking successes=%d, want 1", successes)
	}
	if err = db.QueryRow(`select count(*) from booking_occupancies where admin_id=$1 and court_id=$2 and active and occupied_range=tstzrange($3,$4,'[)')`, adminID, courtA, at(20, 0), at(20, 30)).Scan(&occupancyCount); err != nil || occupancyCount != 1 {
		t.Fatalf("concurrent occupancy=%d err=%v", occupancyCount, err)
	}

	// Cancelling a batch releases every slot once and is idempotent.
	if _, err = a.reviewBooking(t.Context(), adminID, payload.Bookings[0].ID, "cancel", "ยกเลิกทดสอบ", "admin", adminID); err != nil {
		t.Fatal(err)
	}
	if _, err = a.reviewBooking(t.Context(), adminID, payload.Bookings[0].ID, "cancel", "ยกเลิกซ้ำ", "admin", adminID); err != nil {
		t.Fatalf("idempotent cancel failed: %v", err)
	}
	if err = db.QueryRow(`select count(*) from bookings where admin_id=$1 and booking_batch_id=$2 and status='cancelled'`, adminID, payload.BatchID).Scan(&bookingCount); err != nil || bookingCount != 2 {
		t.Fatalf("cancelled batch count=%d err=%v", bookingCount, err)
	}
	if err = db.QueryRow(`select count(*) from booking_occupancies where admin_id=$1 and booking_id=any($2) and active`, adminID, []string{payload.Bookings[0].ID, payload.Bookings[1].ID}).Scan(&occupancyCount); err != nil || occupancyCount != 0 {
		t.Fatalf("cancelled batch active occupancy=%d err=%v", occupancyCount, err)
	}
	if _, err = a.createBookingTx(t.Context(), adminID, courtA, memberID, "admin", "สมาชิก Booking Ledger", at(18, 0), at(19, 0), "confirmed"); err != nil {
		t.Fatalf("released slot could not be booked again: %v", err)
	}

	// Reproduce the post-upload state and verify approve/reject transitions and payment totals.
	pending, err := a.createBookingTx(t.Context(), adminID, courtB, memberID, "member", "สมาชิก Booking Ledger", at(19, 0), at(19, 30), "hold")
	if err != nil {
		t.Fatal(err)
	}
	paymentID := "booking-payment-" + randHex(8)
	if _, err = db.Exec(`insert into booking_payments(id,admin_id,booking_id,member_id,amount_thb,status) values($1,$2,$3,$4,150,'pending')`, paymentID, adminID, pending.ID, memberID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`update bookings set status='pending_review',payment_status='pending' where id=$1`, pending.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = a.reviewBooking(t.Context(), adminID, pending.ID, "approve", "ยอดถูกต้อง", "admin", adminID); err != nil {
		t.Fatal(err)
	}
	if _, err = a.reviewBooking(t.Context(), adminID, pending.ID, "approve", "อนุมัติซ้ำ", "admin", adminID); err != nil {
		t.Fatalf("idempotent approve failed: %v", err)
	}
	var bookingStatus, paymentStatus, paymentReviewStatus string
	var bookingTotal, paymentTotal int
	if err = db.QueryRow(`select b.status,b.payment_status,b.total_price_thb,p.status,p.amount_thb from bookings b join booking_payments p on p.booking_id=b.id where b.id=$1`, pending.ID).Scan(&bookingStatus, &paymentStatus, &bookingTotal, &paymentReviewStatus, &paymentTotal); err != nil {
		t.Fatal(err)
	}
	if bookingStatus != "confirmed" || paymentStatus != "paid" || paymentReviewStatus != "approved" || bookingTotal != 150 || paymentTotal != 150 {
		t.Fatalf("approved state booking=%s/%s/%d payment=%s/%d", bookingStatus, paymentStatus, bookingTotal, paymentReviewStatus, paymentTotal)
	}
	if _, err = db.Exec(`update booking_payments set slip_data='data:image/png;base64,aGVsbG8=',slip_mime_type='image/png' where id=$1`, paymentID); err != nil {
		t.Fatal(err)
	}
	historyURL := "/api/admin/booking/history?startDate=" + day.Format("2006-01-02") + "&endDate=" + day.Format("2006-01-02")
	historyRecorder := httptest.NewRecorder()
	a.writeBookingHistory(historyRecorder, httptest.NewRequest(http.MethodGet, historyURL, nil), adminID)
	if historyRecorder.Code != http.StatusOK {
		t.Fatalf("booking history status=%d body=%s", historyRecorder.Code, historyRecorder.Body.String())
	}
	var historyPayload struct {
		Items []struct {
			ID      string `json:"id"`
			SlipURL string `json:"slipUrl"`
		} `json:"items"`
	}
	if err = json.NewDecoder(historyRecorder.Body).Decode(&historyPayload); err != nil {
		t.Fatal(err)
	}
	foundSlip := false
	for _, item := range historyPayload.Items {
		if item.ID == pending.ID && item.SlipURL == "/api/admin/booking/payments/"+paymentID+"/slip" {
			foundSlip = true
		}
	}
	if !foundSlip {
		t.Fatalf("booking history did not expose the uploaded slip URL: %s", historyRecorder.Body.String())
	}

	rejected, err := a.createBookingTx(t.Context(), adminID, courtB, memberID, "member", "สมาชิก Booking Ledger", at(20, 0), at(20, 30), "hold")
	if err != nil {
		t.Fatal(err)
	}
	rejectedPaymentID := "booking-payment-" + randHex(8)
	if _, err = db.Exec(`insert into booking_payments(id,admin_id,booking_id,member_id,amount_thb,status) values($1,$2,$3,$4,150,'pending')`, rejectedPaymentID, adminID, rejected.ID, memberID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`update bookings set status='pending_review',payment_status='pending' where id=$1`, rejected.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = a.reviewBooking(t.Context(), adminID, rejected.ID, "reject", "สลิปไม่ถูกต้อง", "admin", adminID); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`select count(*) from booking_occupancies where booking_id=$1 and active`, rejected.ID).Scan(&occupancyCount); err != nil || occupancyCount != 0 {
		t.Fatalf("rejected booking occupancy=%d err=%v", occupancyCount, err)
	}

	paidBatchRecorder := requestBatch([]map[string]string{
		item(courtA, at(20, 30), at(21, 0)), // 120
		item(courtB, at(20, 30), at(21, 0)), // 150
	})
	if paidBatchRecorder.Code != http.StatusCreated {
		t.Fatalf("payment batch status=%d body=%s", paidBatchRecorder.Code, paidBatchRecorder.Body.String())
	}
	var paidBatch struct {
		BatchID       string          `json:"batchId"`
		Bookings      []bookingRecord `json:"bookings"`
		TotalPriceTHB int             `json:"totalPriceThb"`
	}
	if err = json.NewDecoder(paidBatchRecorder.Body).Decode(&paidBatch); err != nil {
		t.Fatal(err)
	}
	if paidBatch.TotalPriceTHB != 270 || len(paidBatch.Bookings) != 2 {
		t.Fatalf("unexpected payment batch: %#v", paidBatch)
	}
	batchPaymentID := "booking-payment-" + randHex(8)
	if _, err = db.Exec(`insert into booking_payments(id,admin_id,booking_id,member_id,amount_thb,status) values($1,$2,$3,$4,270,'pending')`, batchPaymentID, adminID, paidBatch.Bookings[0].ID, memberID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`update bookings set status='pending_review',payment_status='pending' where admin_id=$1 and booking_batch_id=$2`, adminID, paidBatch.BatchID); err != nil {
		t.Fatal(err)
	}
	if _, err = a.reviewBooking(t.Context(), adminID, paidBatch.Bookings[1].ID, "approve", "อนุมัติทั้งชุด", "admin", adminID); err != nil {
		t.Fatal(err)
	}

	// API export must reproduce source values and never include slip image data.
	exportURL := "/api/admin/booking/export?startDate=" + day.Format("2006-01-02") + "&endDate=" + day.Format("2006-01-02") + "&status=all"
	exportRecorder := httptest.NewRecorder()
	a.writeBookingExport(exportRecorder, httptest.NewRequest(http.MethodGet, exportURL, nil), adminID)
	if exportRecorder.Code != http.StatusOK {
		t.Fatalf("export status=%d body=%s", exportRecorder.Code, exportRecorder.Body.String())
	}
	var exported struct {
		Items []struct {
			BookingID          string `json:"bookingId"`
			BatchID            string `json:"batchId"`
			TotalPriceTHB      int    `json:"totalPriceThb"`
			PaymentAmountTHB   int    `json:"paymentAmountThb"`
			BookingStatus      string `json:"bookingStatus"`
			PaymentStatus      string `json:"paymentStatus"`
			PaymentReviewState string `json:"paymentReviewStatus"`
		} `json:"items"`
	}
	if err = json.NewDecoder(exportRecorder.Body).Decode(&exported); err != nil {
		t.Fatal(err)
	}
	foundApproved := false
	batchBookingTotal, batchPaymentTotal, batchRows := 0, 0, 0
	for _, row := range exported.Items {
		if row.BookingID == pending.ID {
			foundApproved = row.TotalPriceTHB == 150 && row.PaymentAmountTHB == 150 && row.BookingStatus == "confirmed" && row.PaymentStatus == "paid" && row.PaymentReviewState == "approved"
		}
		if row.BatchID == paidBatch.BatchID {
			batchRows++
			batchBookingTotal += row.TotalPriceTHB
			batchPaymentTotal += row.PaymentAmountTHB
		}
	}
	if !foundApproved || batchRows != 2 || batchBookingTotal != 270 || batchPaymentTotal != 270 || bytes.Contains(exportRecorder.Body.Bytes(), []byte("slipData")) {
		t.Fatalf("export did not reconcile approved booking or leaked slip data: %s", exportRecorder.Body.String())
	}
}
