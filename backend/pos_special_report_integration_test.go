package main

import (
	"database/sql"
	"os"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestPOSSpecialPaymentTotalsIntegration(t *testing.T) {
	dsn := os.Getenv("LIVEMATCH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run PostgreSQL POS special report integration tests")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	a := &app{db: db}
	adminID := "pos-special-report-" + randHex(8)
	if _, err = db.Exec(`insert into admin_users(id,email,name,password_hash,verified_at) values($1,$2,'POS Special Report Test','unused',now())`, adminID, adminID+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = db.Exec(`delete from admin_users where id=$1`, adminID) }()

	sessionID := "pos-special-session-" + randHex(8)
	if _, err = db.Exec(`insert into sessions(id,name,admin_id,admin_passcode,state) values($1,'Special report session',$2,'','{}'::jsonb)`, sessionID, adminID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into players(session_id,id,name) values($1,1,'Legacy payer')`, sessionID); err != nil {
		t.Fatal(err)
	}

	now := time.Now()
	insertPayment := func(id, method, status string, amount int64) {
		t.Helper()
		if _, insertErr := db.Exec(`insert into billing_payments(id,admin_id,amount_thb,amount_satang,method,status,created_at) values($1,$2,$3,$4,$5,$6,$7)`, id, adminID, amount/100, amount, method, status, now); insertErr != nil {
			t.Fatal(insertErr)
		}
	}
	insertAllocation := func(paymentID, sourceType, sourceID string, amount int64) {
		t.Helper()
		if _, insertErr := db.Exec(`insert into billing_payment_allocations(payment_id,source_type,source_id,amount_thb,amount_satang) values($1,$2,$3,$4,$5)`, paymentID, sourceType, sourceID, amount/100, amount); insertErr != nil {
			t.Fatal(insertErr)
		}
	}

	cashID := "payment-cash-" + randHex(8)
	insertPayment(cashID, "cash", "paid", 1500)
	insertAllocation(cashID, "pos", "sale-one", 1000)
	insertAllocation(cashID, "match", sessionID+":1", 500)
	if _, err = db.Exec(`insert into pos_sales(id,admin_id,status,total_thb,total_satang,payment_id) values('sale-one',$1,'paid',10,1000,$2),('legacy-sale',$1,'paid',4,400,null)`, adminID, cashID); err != nil {
		t.Fatal(err)
	}

	qrID := "payment-qr-" + randHex(8)
	insertPayment(qrID, "promptpay", "paid", 700)
	insertAllocation(qrID, "match", sessionID+":2", 700)

	voidID := "payment-void-" + randHex(8)
	insertPayment(voidID, "cash", "void", 900)
	insertAllocation(voidID, "pos", "void-sale", 900)

	if _, err = db.Exec(`insert into player_payment_events(session_id,player_id,paid,amount_thb,amount_satang,payment_method,created_at) values($1,1,true,3,300,'promptpay',$2),($1,1,false,5,500,'cash',$2)`, sessionID, now); err != nil {
		t.Fatal(err)
	}

	cash, promptPay, err := a.posSpecialPaymentTotals(t.Context(), adminID, now.Add(-time.Minute), now.Add(time.Minute), "all")
	if err != nil {
		t.Fatal(err)
	}
	if cash != 1900 || promptPay != 1000 {
		t.Fatalf("payment totals cash=%d promptpay=%d; want cash=1900 promptpay=1000", cash, promptPay)
	}

	cash, promptPay, err = a.posSpecialPaymentTotals(t.Context(), adminID, now.Add(-time.Minute), now.Add(time.Minute), "secondary")
	if err != nil {
		t.Fatal(err)
	}
	if cash != 500 || promptPay != 1000 {
		t.Fatalf("secondary totals cash=%d promptpay=%d; want Match-only cash=500 promptpay=1000", cash, promptPay)
	}
}
