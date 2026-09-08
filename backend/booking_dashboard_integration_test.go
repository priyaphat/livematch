package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestBookingDashboardAggregatesTenantDataInPostgres(t *testing.T) {
	dsn := os.Getenv("LIVEMATCH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run booking dashboard integration tests")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &app{db: db}
	if err = a.migrate(t.Context()); err != nil {
		t.Fatal(err)
	}

	adminID := "booking-dashboard-" + randHex(6)
	courtA, courtB := "court-a-"+randHex(5), "court-b-"+randHex(5)
	oldMember, newMember := "member-old-"+randHex(5), "member-new-"+randHex(5)
	if _, err = db.Exec(`insert into admin_users(id,email,name,password_hash,verified_at) values($1,$2,'Dashboard test','unused',now())`, adminID, adminID+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	defer db.Exec(`delete from admin_users where id=$1`, adminID)
	if _, err = db.Exec(`insert into booking_courts(id,admin_id,name,price_per_interval,sort_order) values($1,$3,'สนาม 1',100,1),($2,$3,'สนาม 2',100,2)`, courtA, courtB, adminID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into members(id,admin_id,name,phone,profile_token_hash,created_at) values($1,$3,'ลูกค้าเก่า',$4,$5,now()-interval '30 days'),($2,$3,'ลูกค้าใหม่',$6,$7,now())`, oldMember, newMember, adminID, "+669"+randHex(4), randHex(32), "+668"+randHex(4), randHex(32)); err != nil {
		t.Fatal(err)
	}

	now := time.Now().In(bangkokLocation)
	current := time.Date(now.Year(), now.Month(), now.Day(), 18, 0, 0, 0, bangkokLocation)
	insertBooking := func(id, court, member string, start time.Time, total int, payment string) {
		t.Helper()
		_, insertErr := db.Exec(`insert into bookings(id,admin_id,court_id,member_id,booker_name,start_at,end_at,interval_minutes,unit_price_thb,total_price_thb,status,payment_status) values($1,$2,$3,$4,'ผู้จอง',$5::timestamptz,$5::timestamptz+interval '1 hour',60,$6,$6,'confirmed',$7)`, id, adminID, court, member, start, total, payment)
		if insertErr != nil {
			t.Fatal(insertErr)
		}
	}
	for i := 0; i < 3; i++ {
		insertBooking("old-"+randHex(6), courtA, oldMember, current.AddDate(0, 0, -10-i), 100, "paid")
	}
	insertBooking("current-old-"+randHex(4), courtA, oldMember, current, 300, "paid")
	insertBooking("current-new-"+randHex(4), courtB, newMember, current.Add(time.Hour), 200, "unpaid")

	req := httptest.NewRequest(http.MethodGet, "/api/admin/booking/dashboard?period=day", nil)
	rec := httptest.NewRecorder()
	a.writeBookingDashboard(rec, req, adminID)
	if rec.Code != http.StatusOK {
		t.Fatalf("dashboard returned %d: %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Summary struct {
			ConfirmedBookings  int `json:"confirmedBookings"`
			PaidRevenueTHB     int `json:"paidRevenueThb"`
			OutstandingTHB     int `json:"outstandingRevenueThb"`
			NewCustomers       int `json:"newCustomers"`
			ReturningCustomers int `json:"returningCustomers"`
			MaxRepeatBookings  int `json:"maxRepeatBookings"`
		} `json:"summary"`
		Courts []map[string]any `json:"courts"`
	}
	if err = json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Summary.ConfirmedBookings != 2 || payload.Summary.PaidRevenueTHB != 300 || payload.Summary.OutstandingTHB != 200 || payload.Summary.NewCustomers != 1 || payload.Summary.ReturningCustomers != 1 || payload.Summary.MaxRepeatBookings != 4 {
		t.Fatalf("unexpected dashboard summary: %+v", payload.Summary)
	}
	if len(payload.Courts) != 2 {
		t.Fatalf("expected 2 court metrics, got %d", len(payload.Courts))
	}
}
