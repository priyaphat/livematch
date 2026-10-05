package main

import (
	"database/sql"
	"os"
	"strings"
	"testing"
)

func TestPOSStockMovementPaginationSearchesBeyondLatestRows(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("LIVEMATCH_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run PostgreSQL stock pagination tests")
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

	adminID := "stock-page-" + randHex(8)
	targetID := "stock-target-" + randHex(8)
	otherID := "stock-other-" + randHex(8)
	if _, err = db.Exec(`insert into admin_users(id,email,name,password_hash,verified_at) values($1,$2,'Stock pagination test','unused',now())`, adminID, adminID+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = db.Exec(`delete from admin_users where id=$1`, adminID) }()
	if _, err = db.Exec(`insert into pos_products(id,admin_id,sku,name,price_thb) values($1,$3,$4,'Young แดง',60),($2,$3,$5,'Recent product',10)`, targetID, otherID, adminID, "TARGET-"+randHex(3), "OTHER-"+randHex(3)); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into pos_stock_movements(admin_id,product_id,delta,balance,reason,note,created_at)
		select $1,$2,-1,100,'sale','old target sale',now()-interval '30 days'+n*interval '1 minute' from generate_series(1,12) n`, adminID, targetID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into pos_stock_movements(admin_id,product_id,delta,balance,reason,note,created_at)
		select $1,$2,1,n,'restock','new unrelated movement',now()-interval '1 day'+n*interval '1 minute' from generate_series(1,220) n`, adminID, otherID); err != nil {
		t.Fatal(err)
	}

	items, total, err := a.listPOSStockMovementsPage(t.Context(), adminID, posStockMovementFilters{
		Page: 1, PageSize: 5, Search: "Young แดง", MovementType: "out", StockLocation: "primary",
	})
	if err != nil {
		t.Fatal(err)
	}
	if total != 12 || len(items) != 5 {
		t.Fatalf("first page total=%d items=%d, want 12/5", total, len(items))
	}
	for _, item := range items {
		if item["productId"] != targetID || item["type"] != "out" {
			t.Fatalf("unexpected filtered movement: %#v", item)
		}
	}
	items, total, err = a.listPOSStockMovementsPage(t.Context(), adminID, posStockMovementFilters{
		Page: 3, PageSize: 5, ProductID: targetID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if total != 12 || len(items) != 2 {
		t.Fatalf("last page total=%d items=%d, want 12/2", total, len(items))
	}
}
