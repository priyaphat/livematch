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
	saleOneID := "sale-one-" + randHex(8)
	legacySaleID := "legacy-sale-" + randHex(8)
	splitSaleID := "split-sale-" + randHex(8)
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
	insertAllocation(cashID, "pos", saleOneID, 1000)
	insertAllocation(cashID, "match", sessionID+":1", 500)
	if _, err = db.Exec(`insert into pos_sales(id,admin_id,status,total_thb,total_satang,payment_id) values($1,$2,'paid',10,1000,$3),($4,$2,'paid',4,400,null)`, saleOneID, adminID, cashID, legacySaleID); err != nil {
		t.Fatal(err)
	}

	qrID := "payment-qr-" + randHex(8)
	insertPayment(qrID, "promptpay", "paid", 700)
	insertAllocation(qrID, "match", sessionID+":2", 700)

	// A 99.50 baht sale split four ways must be reported from the four
	// independently paid shares, never as one legacy cash sale plus four shares.
	if _, err = db.Exec(`insert into pos_sales(id,admin_id,status,total_thb,total_satang,split_mode,split_count) values($1,$2,'paid',100,9950,'equal',4)`, splitSaleID, adminID); err != nil {
		t.Fatal(err)
	}
	splitShares := []struct {
		method string
		amount int64
	}{
		{method: "cash", amount: 2488},
		{method: "promptpay", amount: 2488},
		{method: "cash", amount: 2487},
		{method: "promptpay", amount: 2487},
	}
	for index, share := range splitShares {
		splitID := "split-report-" + randHex(8)
		accountID := "split-account-" + randHex(8)
		paymentID := "payment-split-" + randHex(8)
		if _, err = db.Exec(`insert into billing_accounts(id,admin_id,kind,display_name) values($1,$2,'guest',$3)`, accountID, adminID, "Split payer"); err != nil {
			t.Fatal(err)
		}
		insertPayment(paymentID, share.method, "paid", share.amount)
		insertAllocation(paymentID, "pos", "split:"+splitID, share.amount)
		if _, err = db.Exec(`insert into pos_sale_splits(id,sale_id,billing_account_id,position,share_satang,status,payment_id) values($1,$2,$3,$4,$5,'paid',$6)`, splitID, splitSaleID, accountID, index, share.amount, paymentID); err != nil {
			t.Fatal(err)
		}
	}

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
	if cash != 6875 || promptPay != 5975 {
		t.Fatalf("payment totals cash=%d promptpay=%d; want cash=6875 promptpay=5975", cash, promptPay)
	}

	cash, promptPay, err = a.posSpecialPaymentTotals(t.Context(), adminID, now.Add(-time.Minute), now.Add(time.Minute), "secondary")
	if err != nil {
		t.Fatal(err)
	}
	if cash != 500 || promptPay != 1000 {
		t.Fatalf("secondary totals cash=%d promptpay=%d; want Match-only cash=500 promptpay=1000", cash, promptPay)
	}
}

func TestPOSSpecialReportSplitHasNoPhantomSaleIntegration(t *testing.T) {
	dsn := os.Getenv("LIVEMATCH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run PostgreSQL POS split report tests")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &app{db: db}
	adminID := "pos-no-phantom-" + randHex(8)
	saleID := "no-phantom-sale-" + randHex(8)
	if _, err = db.Exec(`insert into admin_users(id,email,name,password_hash,verified_at) values($1,$2,'No Phantom Bill QA','unused',now())`, adminID, adminID+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = db.Exec(`delete from admin_users where id=$1`, adminID) }()
	if _, err = db.Exec(`insert into pos_sales(id,admin_id,status,total_thb,total_satang,split_mode,split_count) values($1,$2,'paid',100,9950,'equal',4)`, saleID, adminID); err != nil {
		t.Fatal(err)
	}

	now := time.Now()
	shares := []struct {
		method string
		amount int64
	}{{"cash", 2488}, {"promptpay", 2488}, {"cash", 2487}, {"promptpay", 2487}}
	paymentIDs := make([]string, 0, len(shares))
	for index, share := range shares {
		accountID := "no-phantom-account-" + randHex(8)
		paymentID := "no-phantom-payment-" + randHex(8)
		paymentIDs = append(paymentIDs, paymentID)
		splitID := "no-phantom-split-" + randHex(8)
		if _, err = db.Exec(`insert into billing_accounts(id,admin_id,kind,display_name) values($1,$2,'guest',$3)`, accountID, adminID, "Payer"); err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(`insert into billing_payments(id,admin_id,amount_thb,amount_satang,method,status,created_at) values($1,$2,$3,$4,$5,'paid',$6)`, paymentID, adminID, share.amount/100, share.amount, share.method, now); err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(`insert into pos_sale_splits(id,sale_id,billing_account_id,position,share_satang,status,payment_id) values($1,$2,$3,$4,$5,'paid',$6)`, splitID, saleID, accountID, index, share.amount, paymentID); err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(`insert into billing_payment_allocations(payment_id,source_type,source_id,amount_thb,amount_satang) values($1,'pos',$2,$3,$4)`, paymentID, "split:"+splitID, share.amount/100, share.amount); err != nil {
			t.Fatal(err)
		}
	}

	cash, qr, err := a.posSpecialPaymentTotals(t.Context(), adminID, now.Add(-time.Minute), now.Add(time.Minute), "all")
	if err != nil {
		t.Fatal(err)
	}
	if cash != 4975 || qr != 4975 || cash+qr != 9950 {
		t.Fatalf("phantom split sale detected: cash=%d qr=%d combined=%d; want 4975/4975/9950", cash, qr, cash+qr)
	}

	// Receipt totals belong to the day each split member actually paid. If the
	// first three shares were received yesterday, today's report contains only
	// the fourth share and never pulls the other shares forward with the main sale.
	if _, err = db.Exec(`update billing_payments set created_at=$1 where id=any($2)`, now.Add(-24*time.Hour), paymentIDs[:3]); err != nil {
		t.Fatal(err)
	}
	cash, qr, err = a.posSpecialPaymentTotals(t.Context(), adminID, now.Add(-time.Minute), now.Add(time.Minute), "all")
	if err != nil {
		t.Fatal(err)
	}
	if cash != 0 || qr != 2487 {
		t.Fatalf("cross-day split receipts cash=%d qr=%d; want cash=0 qr=2487", cash, qr)
	}
}
