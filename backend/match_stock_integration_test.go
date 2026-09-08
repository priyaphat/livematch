package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// TestMatchShuttlePOSStockIntegration verifies the complete contract between a
// Match shuttle brand and its linked POS product. It intentionally uses a real
// PostgreSQL transaction because the advisory lock, guarded stock update,
// unique usage reference, and rollback behavior cannot be proven with mocks.
func TestMatchShuttlePOSStockIntegration(t *testing.T) {
	dsn := os.Getenv("LIVEMATCH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run Match/POS stock integration tests")
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
	adminID := "match-stock-contract-" + randHex(8)
	if _, err = db.Exec(`insert into admin_users(id,email,name,password_hash,verified_at) values($1,$2,'Match stock contract','unused',now())`, adminID, adminID+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(`delete from activity_logs where actor_id=$1 or details like '%'||$1||'%'`, adminID)
		_, _ = db.Exec(`delete from sessions where admin_id=$1`, adminID)
		_, _ = db.Exec(`delete from admin_users where id=$1`, adminID)
	}()
	if _, err = db.Exec(`insert into pos_settings(admin_id,secondary_stock_enabled,sale_stock_location) values($1,true,'primary')`, adminID); err != nil {
		t.Fatal(err)
	}

	productA := "shuttle-a-" + randHex(8)
	productB := "shuttle-b-" + randHex(8)
	productEmpty := "shuttle-empty-" + randHex(8)
	productZero := "shuttle-zero-" + randHex(8)
	productSecondary := "shuttle-secondary-" + randHex(8)
	insertProduct := func(id, sku, name string, priceSatang int64, primary, secondary int) {
		t.Helper()
		if _, insertErr := db.Exec(`insert into pos_products(id,admin_id,sku,name,price_thb,price_satang,cost_thb,cost_satang,stock_quantity,secondary_stock_quantity,track_stock,active) values($1,$2,$3,$4,$5,$6,45,4500,$7,$8,true,true)`, id, adminID, sku, name, roundedBaht(priceSatang), priceSatang, primary, secondary); insertErr != nil {
			t.Fatal(insertErr)
		}
	}
	insertProduct(productA, "A-"+randHex(4), "Shuttle A", 10000, 3, 0)
	insertProduct(productB, "B-"+randHex(4), "Shuttle B", 9950, 5, 0)
	insertProduct(productEmpty, "EMPTY-"+randHex(4), "Shuttle out of stock", 5000, 0, 0)
	insertProduct(productZero, "ZERO-"+randHex(4), "Shuttle free", 0, 2, 0)
	insertProduct(productSecondary, "SECONDARY-"+randHex(4), "Shuttle secondary", 9950, 9, 2)
	availability := a.sessionShuttleStockAvailability(t.Context(), adminID, []ShuttleBrand{
		{ID: "available", POSProductID: productA},
		{ID: "empty", POSProductID: productEmpty},
		{ID: "unlinked"},
	})
	if len(availability) != 3 || !availability[0].Selectable || availability[0].AvailableQuantity != 3 || availability[1].Selectable || availability[1].Code != "POS_SHUTTLE_OUT_OF_STOCK" || !availability[2].Selectable || availability[2].Linked {
		t.Fatalf("unexpected shuttle availability payload: %#v", availability)
	}

	// The server, rather than a stale or forged client value, owns the price in
	// saved admin defaults whenever a POS product is linked.
	linkedDefaults := Settings{ShuttleBrands: []ShuttleBrand{{ID: "brand-1", Name: "ลูกแบดทดสอบ", Price: 85, PriceSatang: 8500, Active: true, POSProductID: productA}}}
	if err = a.hydrateLinkedShuttleBrandPrices(t.Context(), adminID, &linkedDefaults, true); err != nil {
		t.Fatalf("hydrate linked default price: %v", err)
	}
	if got := linkedDefaults.ShuttleBrands[0].PriceSatang; got != 10000 {
		t.Fatalf("server-owned linked default price=%d, want 10000", got)
	}
	stock := func(productID, location string) int {
		t.Helper()
		column := "stock_quantity"
		if location == "secondary" {
			column = "secondary_stock_quantity"
		}
		var quantity int
		if queryErr := db.QueryRow(`select `+column+` from pos_products where id=$1`, productID).Scan(&quantity); queryErr != nil {
			t.Fatal(queryErr)
		}
		return quantity
	}
	movementCount := func(productID, reason string) int {
		t.Helper()
		var count int
		if queryErr := db.QueryRow(`select count(*) from pos_stock_movements where admin_id=$1 and product_id=$2 and reason=$3`, adminID, productID, reason).Scan(&count); queryErr != nil {
			t.Fatal(queryErr)
		}
		return count
	}
	createSession := func(name string) (string, SessionState) {
		t.Helper()
		id := "match-stock-" + randHex(8)
		if _, insertErr := db.Exec(`insert into sessions(id,name,admin_id,admin_passcode,state) values($1,$2,$3,'','{}'::jsonb)`, id, name, adminID); insertErr != nil {
			t.Fatal(insertErr)
		}
		return id, defaultState(id, name, "")
	}
	matchWithShuttles := func(count int) Match {
		items := make([]ShuttleSeqItem, 0, count)
		for number := 1; number <= count; number++ {
			items = append(items, ShuttleSeqItem{BrandID: "brand-1", Number: number})
		}
		return Match{ID: 1, Court: "สนาม 1", A1: 1, A2: 2, B1: 3, B2: 4, Status: "playing", ShuttlePricingMode: shuttlePricingSplit, Shuttles: count, ShuttleSeqItems: items}
	}

	_, state := createSession("Primary stock contract")
	state.Settings.ShuttleBrands = []ShuttleBrand{{ID: "brand-1", Name: "ลูกแบดทดสอบ", Price: 85, Active: true, POSProductID: productA}}
	state.Live = []Match{matchWithShuttles(1)}
	if err = a.saveStateResolved(t.Context(), &state); err != nil {
		t.Fatalf("deduct first linked shuttle: %v", err)
	}
	if got := stock(productA, "primary"); got != 2 {
		t.Fatalf("stock A after first shuttle = %d, want 2", got)
	}
	if item := state.Live[0].ShuttleSeqItems[0]; item.PriceSource != "pos" || item.UnitPriceSatang != 10000 || item.POSProductID != productA {
		t.Fatalf("first POS price snapshot=%#v", item)
	}
	if got := matchShuttleTotalSatang(state, state.Live[0]); got != 10000 || playerMatchShuttleCostSatang(state, state.Live[0], 1) != 2500 {
		t.Fatalf("first shuttle total/share=%d/%d, want 10000/2500", got, playerMatchShuttleCostSatang(state, state.Live[0], 1))
	}

	if _, err = db.Exec(`update pos_products set price_thb=105,price_satang=10500 where id=$1`, productA); err != nil {
		t.Fatal(err)
	}
	state.Live[0] = matchWithShuttles(2)
	if err = a.saveStateResolved(t.Context(), &state); err != nil {
		t.Fatalf("deduct second linked shuttle: %v", err)
	}
	if got := stock(productA, "primary"); got != 1 {
		t.Fatalf("stock A after second shuttle = %d, want 1", got)
	}
	if items := state.Live[0].ShuttleSeqItems; items[0].UnitPriceSatang != 10000 || items[1].UnitPriceSatang != 10500 || matchShuttleTotalSatang(state, state.Live[0]) != 20500 {
		t.Fatalf("price change must only affect new shuttle: %#v total=%d", items, matchShuttleTotalSatang(state, state.Live[0]))
	}
	if err = a.saveState(t.Context(), state); err != nil {
		t.Fatalf("repeat identical state: %v", err)
	}
	if got := stock(productA, "primary"); got != 1 || movementCount(productA, "match_use") != 2 {
		t.Fatalf("repeated state was not idempotent: stock=%d use movements=%d", got, movementCount(productA, "match_use"))
	}

	// Changing the link only affects newly used shuttles. Existing usage must
	// remain attached to the product that was actually deducted. Two concurrent
	// saves model a duplicated request and must still deduct the new shuttle once.
	state.Settings.ShuttleBrands[0].POSProductID = productB
	state.Live[0] = matchWithShuttles(3)
	duplicateSaveErrors := make(chan error, 2)
	testContext := t.Context()
	for range 2 {
		go func() { duplicateSaveErrors <- a.saveState(testContext, state) }()
	}
	for range 2 {
		if saveErr := <-duplicateSaveErrors; saveErr != nil {
			t.Fatalf("concurrent save after changing linked product: %v", saveErr)
		}
	}
	if gotA, gotB := stock(productA, "primary"), stock(productB, "primary"); gotA != 1 || gotB != 4 {
		t.Fatalf("stock after relink = A:%d B:%d, want A:1 B:4", gotA, gotB)
	}
	var aUsages, bUsages int
	if err = db.QueryRow(`select count(*) filter(where product_id=$2),count(*) filter(where product_id=$3) from match_shuttle_stock_usage where session_id=$1 and active`, state.Session.ID, productA, productB).Scan(&aUsages, &bUsages); err != nil {
		t.Fatal(err)
	}
	if aUsages != 2 || bUsages != 1 {
		t.Fatalf("usage snapshot after relink = A:%d B:%d, want A:2 B:1", aUsages, bUsages)
	}
	loadedAfterRelink, loadErr := a.loadState(t.Context(), state.Session.ID)
	if loadErr != nil {
		t.Fatal(loadErr)
	}
	if items := loadedAfterRelink.Live[0].ShuttleSeqItems; len(items) != 3 || items[0].UnitPriceSatang != 10000 || items[1].UnitPriceSatang != 10500 || items[2].UnitPriceSatang != 9950 || matchShuttleTotalSatang(loadedAfterRelink, loadedAfterRelink.Live[0]) != 30450 {
		t.Fatalf("relinked price snapshots=%#v total=%d", items, matchShuttleTotalSatang(loadedAfterRelink, loadedAfterRelink.Live[0]))
	}
	wantShares := []int64{7613, 7613, 7612, 7612}
	for index, playerID := range []int{1, 2, 3, 4} {
		if got := playerMatchShuttleCostSatang(loadedAfterRelink, loadedAfterRelink.Live[0], playerID); got != wantShares[index] {
			t.Fatalf("player %d share=%d want %d", playerID, got, wantShares[index])
		}
	}
	specialSnapshot := buildPOSSpecialSession(loadedAfterRelink, time.Now())
	if specialSnapshot["shuttleTotalSatang"] != int64(30450) || len(specialSnapshot["shuttles"].([]map[string]any)) != 3 {
		t.Fatalf("POS Match report did not separate snapshotted prices: %#v", specialSnapshot["shuttles"])
	}
	paymentSummary := playerPaymentSummary(loadedAfterRelink, Player{ID: 1, Name: "Player 1"})
	if len(paymentSummary.Items) < 2 || len(paymentSummary.Items[1].Details) != 3 || paymentSummary.Items[1].AmountSatang != 7613 {
		t.Fatalf("member payment details did not use exact snapshots: %#v", paymentSummary.Items)
	}

	// Returning the latest shuttle restores the recorded product, not the old
	// or current link selected in settings.
	state.Live[0] = matchWithShuttles(2)
	if err = a.saveState(t.Context(), state); err != nil {
		t.Fatalf("return latest shuttle: %v", err)
	}
	if got := stock(productB, "primary"); got != 5 || movementCount(productB, "match_return") != 1 {
		t.Fatalf("latest shuttle return = stock:%d return movements:%d, want 5 and 1", got, movementCount(productB, "match_return"))
	}

	// Inventory and summary endpoints must report the same committed balances.
	inventoryRecorder := httptest.NewRecorder()
	a.writePOSInventoryReport(inventoryRecorder, httptest.NewRequest(http.MethodGet, "/api/admin/pos/reports/inventory?stockLocation=primary&page=1&pageSize=25", nil), adminID, true)
	if inventoryRecorder.Code != http.StatusOK {
		t.Fatalf("inventory report status=%d body=%s", inventoryRecorder.Code, inventoryRecorder.Body.String())
	}
	var inventory struct {
		Items []struct {
			ProductID     string `json:"productId"`
			StockQuantity int    `json:"stockQuantity"`
		} `json:"items"`
	}
	if err = json.NewDecoder(inventoryRecorder.Body).Decode(&inventory); err != nil {
		t.Fatal(err)
	}
	reported := map[string]int{}
	for _, item := range inventory.Items {
		reported[item.ProductID] = item.StockQuantity
	}
	if reported[productA] != 1 || reported[productB] != 5 || reported[productEmpty] != 0 {
		t.Fatalf("inventory report balances = A:%d B:%d empty:%d, want 1,5,0", reported[productA], reported[productB], reported[productEmpty])
	}
	hiddenInventoryRecorder := httptest.NewRecorder()
	a.writePOSInventoryReport(hiddenInventoryRecorder, httptest.NewRequest(http.MethodGet, "/api/admin/pos/reports/inventory?stockLocation=primary&page=1&pageSize=25", nil), adminID, false)
	hiddenBody := hiddenInventoryRecorder.Body.String()
	for _, privateField := range []string{"costSatang", "costValueSatang", "priceSatang", "retailValueSatang"} {
		if strings.Contains(hiddenBody, `"`+privateField+`"`) {
			t.Fatalf("inventory response exposed hidden field %s: %s", privateField, hiddenBody)
		}
	}
	summaryRecorder := httptest.NewRecorder()
	a.writePOSStockSummary(summaryRecorder, httptest.NewRequest(http.MethodGet, "/api/admin/pos/stock/summary?stockLocation=primary", nil), adminID)
	var summary struct {
		TotalUnits    int `json:"totalUnits"`
		MovementCount int `json:"movementCount"`
	}
	if summaryRecorder.Code != http.StatusOK {
		t.Fatalf("stock summary status=%d body=%s", summaryRecorder.Code, summaryRecorder.Body.String())
	}
	if err = json.NewDecoder(summaryRecorder.Body).Decode(&summary); err != nil {
		t.Fatal(err)
	}
	if summary.TotalUnits != 17 || summary.MovementCount != 4 { // 1+5+0+2+9, A use x2, B use+return
		t.Fatalf("stock summary = units:%d movements:%d, want 17 and 4", summary.TotalUnits, summary.MovementCount)
	}

	// A zero POS price is authoritative and must not fall back to the Match price.
	state.Settings.ShuttleBrands[0].POSProductID = productZero
	state.Live[0] = matchWithShuttles(3)
	if err = a.saveState(t.Context(), state); err != nil {
		t.Fatalf("deduct zero-price shuttle: %v", err)
	}
	zeroPriceState, loadErr := a.loadState(t.Context(), state.Session.ID)
	if loadErr != nil {
		t.Fatal(loadErr)
	}
	if item := zeroPriceState.Live[0].ShuttleSeqItems[2]; item.PriceSource != "pos" || item.UnitPriceSatang != 0 || stock(productZero, "primary") != 1 {
		t.Fatalf("zero-price POS snapshot=%#v stock=%d", item, stock(productZero, "primary"))
	}
	state.Live[0] = matchWithShuttles(2)
	if err = a.saveState(t.Context(), state); err != nil || stock(productZero, "primary") != 2 {
		t.Fatalf("return zero-price shuttle err=%v stock=%d", err, stock(productZero, "primary"))
	}

	// An out-of-stock link must reject and roll back the entire state save.
	state.Settings.ShuttleBrands[0].POSProductID = productEmpty
	state.Live[0] = matchWithShuttles(3)
	err = a.saveState(t.Context(), state)
	var stockProblem *shuttleStockError
	if err == nil || !strings.Contains(err.Error(), "ไม่เพียงพอ") || !errors.As(err, &stockProblem) || stockProblem.Code != "POS_SHUTTLE_OUT_OF_STOCK" || stockProblem.AvailableQuantity != 0 {
		t.Fatalf("out-of-stock save error = %v, want insufficient stock error", err)
	}
	errorRecorder := httptest.NewRecorder()
	a.writeStateSaveError(errorRecorder, stockProblem)
	var errorPayload struct {
		Code              string `json:"code"`
		AvailableQuantity int    `json:"availableQuantity"`
	}
	if errorRecorder.Code != http.StatusConflict || json.NewDecoder(errorRecorder.Body).Decode(&errorPayload) != nil || errorPayload.Code != "POS_SHUTTLE_OUT_OF_STOCK" || errorPayload.AvailableQuantity != 0 {
		t.Fatalf("structured stock error status=%d payload=%#v", errorRecorder.Code, errorPayload)
	}
	if got := stock(productEmpty, "primary"); got != 0 || movementCount(productEmpty, "match_use") != 0 {
		t.Fatalf("out-of-stock save changed stock/ledger: stock=%d movements=%d", got, movementCount(productEmpty, "match_use"))
	}
	assertProductProblem := func(productID, code string) {
		t.Helper()
		candidate := state
		candidate.Settings.ShuttleBrands[0].POSProductID = productID
		candidate.Live[0] = matchWithShuttles(3)
		problemErr := a.saveState(t.Context(), candidate)
		var problem *shuttleStockError
		if !errors.As(problemErr, &problem) || problem.Code != code {
			t.Fatalf("product %s error=%v problem=%#v, want %s", productID, problemErr, problem, code)
		}
	}
	if _, err = db.Exec(`update pos_products set stock_quantity=1,active=false where id=$1`, productEmpty); err != nil {
		t.Fatal(err)
	}
	assertProductProblem(productEmpty, "POS_SHUTTLE_PRODUCT_INACTIVE")
	if _, err = db.Exec(`update pos_products set active=true,track_stock=false where id=$1`, productEmpty); err != nil {
		t.Fatal(err)
	}
	assertProductProblem(productEmpty, "POS_SHUTTLE_TRACKING_DISABLED")
	assertProductProblem("missing-"+randHex(8), "POS_SHUTTLE_PRODUCT_NOT_FOUND")
	var activeUsages int
	if err = db.QueryRow(`select count(*) from match_shuttle_stock_usage where session_id=$1 and active`, state.Session.ID).Scan(&activeUsages); err != nil || activeUsages != 2 {
		t.Fatalf("out-of-stock save changed active usages: count=%d err=%v", activeUsages, err)
	}
	loaded, loadErr := a.loadState(t.Context(), state.Session.ID)
	if loadErr != nil || len(loaded.Live) != 1 || loaded.Live[0].Shuttles != 2 {
		t.Fatalf("out-of-stock state was not rolled back: live=%#v err=%v", loaded.Live, loadErr)
	}

	// Unlinking does not lose the old usage snapshot; cancelling with a return
	// restores both old A units exactly once.
	state = loaded
	state.Settings.ShuttleBrands[0].POSProductID = ""
	returned := state.Live[0]
	returned.Status = "cancelled"
	returned.ShuttleReturned = true
	state.Live = nil
	state.History = []Match{returned}
	if err = a.saveState(t.Context(), state); err != nil {
		t.Fatalf("cancel and restore after unlink: %v", err)
	}
	if got := stock(productA, "primary"); got != 3 || movementCount(productA, "match_return") != 2 {
		t.Fatalf("old linked stock restore = stock:%d returns:%d, want 3 and 2", got, movementCount(productA, "match_return"))
	}

	// The configured secondary sale location is honored and its ledger retains
	// that location for a later return.
	if _, err = db.Exec(`update pos_settings set sale_stock_location='secondary' where admin_id=$1`, adminID); err != nil {
		t.Fatal(err)
	}
	_, secondaryState := createSession("Secondary stock contract")
	secondaryState.Settings.ShuttleBrands = []ShuttleBrand{{ID: "brand-1", Name: "ลูกแบดคลังสอง", Price: 85, Active: true, POSProductID: productSecondary}}
	secondaryState.Live = []Match{matchWithShuttles(1)}
	if err = a.saveState(t.Context(), secondaryState); err != nil {
		t.Fatalf("deduct secondary stock: %v", err)
	}
	if primary, secondary := stock(productSecondary, "primary"), stock(productSecondary, "secondary"); primary != 9 || secondary != 1 {
		t.Fatalf("secondary deduction = primary:%d secondary:%d, want 9 and 1", primary, secondary)
	}
	var secondaryLedgerRows int
	if err = db.QueryRow(`select count(*) from pos_stock_movements where admin_id=$1 and product_id=$2 and reason='match_use' and stock_location='secondary'`, adminID, productSecondary).Scan(&secondaryLedgerRows); err != nil || secondaryLedgerRows != 1 {
		t.Fatalf("secondary ledger rows=%d err=%v", secondaryLedgerRows, err)
	}
	secondaryReturned := secondaryState.Live[0]
	secondaryReturned.Status = "cancelled"
	secondaryReturned.ShuttleReturned = true
	secondaryState.Live = nil
	secondaryState.History = []Match{secondaryReturned}
	if err = a.saveState(t.Context(), secondaryState); err != nil {
		t.Fatalf("restore secondary stock: %v", err)
	}
	if got := stock(productSecondary, "secondary"); got != 2 {
		t.Fatalf("secondary stock after return = %d, want 2", got)
	}

	// A historical match that never had a usage row must not consume stock just
	// because an administrator links a product later.
	_, historicalState := createSession("Historical non-retroactive contract")
	historicalState.Settings.ShuttleBrands = []ShuttleBrand{{ID: "brand-1", Name: "ลูกแบดย้อนหลัง", Price: 85, Active: true, POSProductID: productB}}
	historical := matchWithShuttles(1)
	historical.Status = "finished"
	historicalState.History = []Match{historical}
	if err = a.saveState(t.Context(), historicalState); err != nil {
		t.Fatalf("save historical linked match: %v", err)
	}
	if got := stock(productB, "primary"); got != 5 || movementCount(productB, "match_use") != 1 {
		t.Fatalf("historical link deducted retroactively: stock=%d use movements=%d", got, movementCount(productB, "match_use"))
	}

	// Migration locks the amount that old Match data displayed before this
	// feature; a linked POS product must not reprice historical data.
	legacySessionID, _ := createSession("Legacy price backfill")
	legacyBrands, _ := json.Marshal([]ShuttleBrand{{ID: "brand-1", Name: "ราคาเดิม", Price: 85, Active: true, POSProductID: productB}})
	if _, err = db.Exec(`insert into session_settings(session_id,shuttle_fee,shuttle_brands) values($1,85,$2)`, legacySessionID, legacyBrands); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into matches(session_id,id,phase,court,level,a1,a2,b1,b2,shuttles,shuttle_sequence_items,status,shuttle_pricing_mode) values($1,1,'history','สนาม 1','middle',1,2,3,4,1,'[{"brandId":"brand-1","number":1}]'::jsonb,'finished','split_per_match')`, legacySessionID); err != nil {
		t.Fatal(err)
	}
	if err = a.backfillMatchShuttlePriceSnapshots(t.Context()); err != nil {
		t.Fatal(err)
	}
	legacyState, err := a.loadState(t.Context(), legacySessionID)
	if err != nil {
		t.Fatal(err)
	}
	legacyItem := legacyState.History[0].ShuttleSeqItems[0]
	if legacyItem.PriceSource != "legacy" || legacyItem.UnitPriceSatang != 8500 || matchShuttleTotalSatang(legacyState, legacyState.History[0]) != 8500 {
		t.Fatalf("legacy price was repriced during backfill: %#v", legacyItem)
	}
}
