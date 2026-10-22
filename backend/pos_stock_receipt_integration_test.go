package main

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestPOSStockReceiptPersistsWeightedAverageAndLedger(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("LIVEMATCH_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run PostgreSQL stock receipt integration tests")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &app{db: db}
	if err = a.migrate(t.Context()); err != nil {
		t.Fatalf("migrate test database: %v", err)
	}

	adminID := "stock-receipt-" + randHex(8)
	productID := "receipt-product-" + randHex(8)
	if _, err = db.Exec(`insert into admin_users(id,email,name,password_hash,verified_at) values($1,$2,'Stock receipt test','unused',now())`, adminID, adminID+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = db.Exec(`delete from admin_users where id=$1`, adminID) }()
	if _, err = db.Exec(`insert into pos_products(id,admin_id,sku,name,price_thb,price_satang,cost_thb,cost_satang,stock_quantity,secondary_stock_quantity,track_stock,active) values($1,$2,$3,'Receipt product',150,15000,100,10000,6,4,true,true)`, productID, adminID, "RCV-"+randHex(4)); err != nil {
		t.Fatal(err)
	}

	body := `{"name":"RCV-TEST","mode":"in","stockLocation":"primary","discountType":"percent","discountRateBps":1000,"items":[{"productId":"` + productID + `","quantity":5,"totalValueSatang":60000}]}`
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/admin/pos/stock/batch", strings.NewReader(body))
	user := adminUser{ID: adminID, Name: "Owner", POSRole: "owner", POSPermissions: allPOSPermissions()}
	a.adjustPOSStockBatch(recorder, request, user)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("receipt status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	var primary, secondary int
	var averageCost int64
	if err = db.QueryRow(`select stock_quantity,secondary_stock_quantity,cost_satang from pos_products where id=$1`, productID).Scan(&primary, &secondary, &averageCost); err != nil {
		t.Fatal(err)
	}
	if primary != 11 || secondary != 4 || averageCost != 10267 {
		t.Fatalf("product after receipt primary=%d secondary=%d average=%d, want 11,4,10267", primary, secondary, averageCost)
	}

	var gross, discount, net int64
	if err = db.QueryRow(`select gross_total_satang,discount_satang,net_total_satang from pos_stock_batches where admin_id=$1 and name='RCV-TEST'`, adminID).Scan(&gross, &discount, &net); err != nil {
		t.Fatal(err)
	}
	if gross != 60000 || discount != 6000 || net != 54000 {
		t.Fatalf("batch totals gross=%d discount=%d net=%d, want 60000,6000,54000", gross, discount, net)
	}

	var delta, balance int
	var unitCost, lineGross, allocatedDiscount, lineNet, previousCost, resultingCost int64
	if err = db.QueryRow(`select delta,balance,unit_cost_satang,gross_total_satang,allocated_discount_satang,net_total_satang,previous_cost_satang,resulting_cost_satang from pos_stock_movements where admin_id=$1 and product_id=$2 and reason='restock' order by id desc limit 1`, adminID, productID).Scan(&delta, &balance, &unitCost, &lineGross, &allocatedDiscount, &lineNet, &previousCost, &resultingCost); err != nil {
		t.Fatal(err)
	}
	if delta != 5 || balance != 11 || unitCost != 12000 || lineGross != 60000 || allocatedDiscount != 6000 || lineNet != 54000 || previousCost != 10000 || resultingCost != 10267 {
		t.Fatalf("unexpected stock ledger delta=%d balance=%d unit=%d gross=%d discount=%d net=%d previous=%d resulting=%d", delta, balance, unitCost, lineGross, allocatedDiscount, lineNet, previousCost, resultingCost)
	}
}
