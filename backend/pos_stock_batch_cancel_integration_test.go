package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
)

func TestPOSStockBatchCancellationReversesLedgerAtomically(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("LIVEMATCH_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run PostgreSQL stock cancellation integration tests")
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

	adminID := "stock-cancel-" + randHex(8)
	if _, err = db.Exec(`insert into admin_users(id,email,name,password_hash,verified_at) values($1,$2,'Stock cancel test','unused',now())`, adminID, adminID+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = db.Exec(`delete from admin_users where id=$1`, adminID) }()
	user := adminUser{ID: adminID, Name: "Owner", POSRole: "owner", POSPermissions: allPOSPermissions()}

	createProduct := func(id, sku string, stock int, cost int64) {
		t.Helper()
		if _, createErr := db.Exec(`insert into pos_products(id,admin_id,sku,name,price_thb,price_satang,cost_thb,cost_satang,stock_quantity,secondary_stock_quantity,track_stock,active) values($1,$2,$3,$4,150,15000,$5,$6,$7,0,true,true)`, id, adminID, sku, "Product "+sku, roundedBaht(cost), cost, stock); createErr != nil {
			t.Fatal(createErr)
		}
	}
	createBatch := func(body string) string {
		t.Helper()
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/admin/pos/stock/batch", strings.NewReader(body))
		a.adjustPOSStockBatch(recorder, request, user)
		if recorder.Code != http.StatusCreated {
			t.Fatalf("create batch status=%d body=%s", recorder.Code, recorder.Body.String())
		}
		var response struct {
			ID string `json:"id"`
		}
		if decodeErr := json.Unmarshal(recorder.Body.Bytes(), &response); decodeErr != nil || response.ID == "" {
			t.Fatalf("decode batch response: %v body=%s", decodeErr, recorder.Body.String())
		}
		return response.ID
	}
	cancelBatch := func(id, reason string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/admin/pos/stock/batches/"+id+"/cancel", strings.NewReader(`{"reason":"`+reason+`"}`))
		a.cancelPOSStockBatch(recorder, request, user, id)
		return recorder
	}

	productID := "cancel-in-" + randHex(6)
	createProduct(productID, "CIN-"+randHex(3), 10, 10000)
	supplierID := "supplier-" + randHex(6)
	if _, err = db.Exec(`insert into pos_suppliers(id,admin_id,code,name,active) values($1,$2,$3,'Cancellation supplier',true)`, supplierID, adminID, "SUP-"+randHex(3)); err != nil {
		t.Fatal(err)
	}
	batchID := createBatch(`{"name":"RCV-CANCEL","mode":"in","stockLocation":"primary","supplierId":"` + supplierID + `","discountType":"percent","discountRateBps":1000,"items":[{"productId":"` + productID + `","quantity":5,"totalValueSatang":60000}]}`)
	otherAdminID := "stock-cancel-other-" + randHex(6)
	if _, err = db.Exec(`insert into admin_users(id,email,name,password_hash,verified_at) values($1,$2,'Other tenant','unused',now())`, otherAdminID, otherAdminID+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = db.Exec(`delete from admin_users where id=$1`, otherAdminID) }()
	otherRecorder := httptest.NewRecorder()
	otherRequest := httptest.NewRequest(http.MethodPost, "/api/admin/pos/stock/batches/"+batchID+"/cancel", strings.NewReader(`{"reason":"ข้าม tenant"}`))
	a.cancelPOSStockBatch(otherRecorder, otherRequest, adminUser{ID: otherAdminID, Name: "Other", POSRole: "owner", POSPermissions: allPOSPermissions()}, batchID)
	if otherRecorder.Code != http.StatusNotFound {
		t.Fatalf("cross-tenant cancellation status=%d body=%s", otherRecorder.Code, otherRecorder.Body.String())
	}
	recorder := cancelBatch(batchID, "รับจำนวนผิด")
	if recorder.Code != http.StatusOK {
		t.Fatalf("cancel stock in status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var stock int
	var cost int64
	if err = db.QueryRow(`select stock_quantity,cost_satang from pos_products where id=$1`, productID).Scan(&stock, &cost); err != nil {
		t.Fatal(err)
	}
	if stock != 10 || cost != 10000 {
		t.Fatalf("stock in reversal stock=%d cost=%d, want 10/10000", stock, cost)
	}
	var status, cancelReason, reversalReason string
	var reversalDelta, reversalBalance int
	var reversalOf int64
	if err = db.QueryRow(`select status,cancel_reason from pos_stock_batches where id=$1`, batchID).Scan(&status, &cancelReason); err != nil {
		t.Fatal(err)
	}
	if status != "cancelled" || cancelReason != "รับจำนวนผิด" {
		t.Fatalf("unexpected cancellation status=%s reason=%s", status, cancelReason)
	}
	if err = db.QueryRow(`select reason,delta,balance,reversal_of_movement_id from pos_stock_movements where batch_id=$1 and reversal_of_movement_id is not null`, batchID).Scan(&reversalReason, &reversalDelta, &reversalBalance, &reversalOf); err != nil {
		t.Fatal(err)
	}
	if reversalReason != "restock_cancel" || reversalDelta != -5 || reversalBalance != 10 || reversalOf == 0 {
		t.Fatalf("unexpected stock in reversal reason=%s delta=%d balance=%d original=%d", reversalReason, reversalDelta, reversalBalance, reversalOf)
	}
	movementPage, movementTotal, movementErr := a.listPOSStockMovementsPage(t.Context(), adminID, posStockMovementFilters{Page: 1, PageSize: 10, ProductID: productID})
	if movementErr != nil || movementTotal != 2 || len(movementPage) != 2 {
		t.Fatalf("movement ledger total=%d rows=%d err=%v", movementTotal, len(movementPage), movementErr)
	}
	if movementPage[0]["type"] != "out" || movementPage[0]["reversalOfMovementId"] != reversalOf || movementPage[1]["reversedByMovementId"] != movementPage[0]["id"] {
		t.Fatalf("movement reversal references or direction are incorrect: %#v", movementPage)
	}
	_, movementOutTotal, movementErr := a.listPOSStockMovementsPage(t.Context(), adminID, posStockMovementFilters{Page: 1, PageSize: 10, ProductID: productID, MovementType: "out"})
	if movementErr != nil || movementOutTotal != 1 {
		t.Fatalf("out movement filter must include the stock-in reversal: total=%d err=%v", movementOutTotal, movementErr)
	}
	if second := cancelBatch(batchID, "กดซ้ำ"); second.Code != http.StatusConflict || !strings.Contains(second.Body.String(), "STOCK_BATCH_ALREADY_CANCELLED") {
		t.Fatalf("second cancellation status=%d body=%s", second.Code, second.Body.String())
	}
	batches, err := a.listPOSStockBatches(t.Context(), adminID, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(batches) != 1 || len(batches[0].Items) != 1 || batches[0].Status != "cancelled" || batches[0].CanCancel {
		t.Fatalf("cancelled batch response must retain one original item: %#v", batches)
	}
	reportRecorder := httptest.NewRecorder()
	reportRequest := httptest.NewRequest(http.MethodGet, "/api/admin/pos/reports/purchases?range=custom&startDate=2020-01-01&endDate=2099-12-31", nil)
	a.writePOSPurchasesReport(reportRecorder, reportRequest, adminID)
	if reportRecorder.Code != http.StatusOK {
		t.Fatalf("purchases report status=%d body=%s", reportRecorder.Code, reportRecorder.Body.String())
	}
	var report struct {
		Summary struct {
			PurchaseCount int `json:"purchaseCount"`
		} `json:"summary"`
	}
	if err = json.Unmarshal(reportRecorder.Body.Bytes(), &report); err != nil || report.Summary.PurchaseCount != 0 {
		t.Fatalf("cancelled receipt must be excluded from purchases report: count=%d err=%v body=%s", report.Summary.PurchaseCount, err, reportRecorder.Body.String())
	}

	outProductID := "cancel-out-" + randHex(6)
	createProduct(outProductID, "COUT-"+randHex(3), 10, 10000)
	outBatchID := createBatch(`{"name":"OUT-CANCEL","mode":"out","stockLocation":"primary","items":[{"productId":"` + outProductID + `","quantity":3}]}`)
	createBatch(`{"name":"RCV-AFTER-OUT","mode":"in","stockLocation":"primary","items":[{"productId":"` + outProductID + `","quantity":2,"totalValueSatang":40000}]}`)
	recorder = cancelBatch(outBatchID, "เบิกผิด")
	if recorder.Code != http.StatusOK {
		t.Fatalf("cancel stock out status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if err = db.QueryRow(`select stock_quantity,cost_satang from pos_products where id=$1`, outProductID).Scan(&stock, &cost); err != nil {
		t.Fatal(err)
	}
	if stock != 12 || cost != 11667 {
		t.Fatalf("stock out compensating reversal stock=%d cost=%d, want 12/11667", stock, cost)
	}

	historicalInProductID := "cancel-old-in-" + randHex(5)
	createProduct(historicalInProductID, "OLD-IN-"+randHex(2), 10, 10000)
	historicalInBatchID := createBatch(`{"name":"RCV-OLD-CANCEL","mode":"in","stockLocation":"primary","items":[{"productId":"` + historicalInProductID + `","quantity":5,"totalValueSatang":60000}]}`)
	createBatch(`{"name":"OUT-AFTER-OLD-IN","mode":"out","stockLocation":"primary","items":[{"productId":"` + historicalInProductID + `","quantity":2}]}`)
	createBatch(`{"name":"RCV-AFTER-OLD-IN","mode":"in","stockLocation":"primary","items":[{"productId":"` + historicalInProductID + `","quantity":2,"totalValueSatang":40000}]}`)
	if historicalRecorder := cancelBatch(historicalInBatchID, "ยกเลิกรับเข้าเก่าหลังมีรายการต่อท้าย"); historicalRecorder.Code != http.StatusOK {
		t.Fatalf("cancel historical stock in status=%d body=%s", historicalRecorder.Code, historicalRecorder.Body.String())
	}
	if err = db.QueryRow(`select stock_quantity,cost_satang from pos_products where id=$1`, historicalInProductID).Scan(&stock, &cost); err != nil {
		t.Fatal(err)
	}
	if stock != 10 || cost != 11867 {
		t.Fatalf("historical stock in compensating reversal stock=%d cost=%d, want 10/11867", stock, cost)
	}

	secondaryProductID := "cancel-secondary-" + randHex(5)
	createProduct(secondaryProductID, "SEC-"+randHex(2), 4, 5000)
	if _, err = db.Exec(`insert into pos_settings(admin_id,secondary_stock_enabled) values($1,true) on conflict(admin_id) do update set secondary_stock_enabled=true`, adminID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`update pos_products set secondary_stock_quantity=6 where id=$1`, secondaryProductID); err != nil {
		t.Fatal(err)
	}
	secondaryBatchID := createBatch(`{"name":"OUT-SECONDARY","mode":"out","stockLocation":"secondary","items":[{"productId":"` + secondaryProductID + `","quantity":2}]}`)
	if secondaryRecorder := cancelBatch(secondaryBatchID, "คืนคลังรอง"); secondaryRecorder.Code != http.StatusOK {
		t.Fatalf("cancel secondary stock out status=%d body=%s", secondaryRecorder.Code, secondaryRecorder.Body.String())
	}
	var primary, secondary int
	if err = db.QueryRow(`select stock_quantity,secondary_stock_quantity from pos_products where id=$1`, secondaryProductID).Scan(&primary, &secondary); err != nil || primary != 4 || secondary != 6 {
		t.Fatalf("secondary cancellation primary=%d secondary=%d err=%v", primary, secondary, err)
	}

	adjustBatchID := "adjust-not-cancellable-" + randHex(5)
	if _, err = db.Exec(`insert into pos_stock_batches(id,admin_id,name,mode,status) values($1,$2,'ADJ-NO-CANCEL','adjust','active')`, adjustBatchID, adminID); err != nil {
		t.Fatal(err)
	}
	if adjustRecorder := cancelBatch(adjustBatchID, "ไม่ควรยกเลิกได้"); adjustRecorder.Code != http.StatusConflict || !strings.Contains(adjustRecorder.Body.String(), "STOCK_BATCH_TYPE_NOT_CANCELLABLE") {
		t.Fatalf("adjust cancellation status=%d body=%s", adjustRecorder.Code, adjustRecorder.Body.String())
	}

	atomicA, atomicZ := "atomic-a-"+randHex(5), "atomic-z-"+randHex(5)
	createProduct(atomicA, "ATM-A-"+randHex(2), 10, 10000)
	createProduct(atomicZ, "ATM-Z-"+randHex(2), 10, 10000)
	atomicBatchID := createBatch(`{"name":"RCV-ATOMIC","mode":"in","stockLocation":"primary","items":[{"productId":"` + atomicA + `","quantity":5,"totalValueSatang":50000},{"productId":"` + atomicZ + `","quantity":5,"totalValueSatang":50000}]}`)
	if _, err = db.Exec(`update pos_products set stock_quantity=2 where id=$1`, atomicZ); err != nil {
		t.Fatal(err)
	}
	recorder = cancelBatch(atomicBatchID, "ต้อง rollback")
	if recorder.Code != http.StatusConflict || !strings.Contains(recorder.Body.String(), "STOCK_BATCH_CANCEL_INSUFFICIENT_STOCK") {
		t.Fatalf("insufficient cancellation status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if err = db.QueryRow(`select stock_quantity from pos_products where id=$1`, atomicA).Scan(&stock); err != nil || stock != 15 {
		t.Fatalf("first product must rollback, stock=%d err=%v", stock, err)
	}
	if err = db.QueryRow(`select status from pos_stock_batches where id=$1`, atomicBatchID).Scan(&status); err != nil || status != "active" {
		t.Fatalf("failed cancellation must keep batch active, status=%s err=%v", status, err)
	}

	concurrentProductID := "concurrent-" + randHex(5)
	createProduct(concurrentProductID, "CON-"+randHex(2), 5, 10000)
	concurrentBatchID := createBatch(`{"name":"OUT-CONCURRENT","mode":"out","stockLocation":"primary","items":[{"productId":"` + concurrentProductID + `","quantity":1}]}`)
	statuses := make(chan int, 2)
	var wait sync.WaitGroup
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			statuses <- cancelBatch(concurrentBatchID, "ทดสอบพร้อมกัน").Code
		}()
	}
	wait.Wait()
	close(statuses)
	counts := map[int]int{}
	for code := range statuses {
		counts[code]++
	}
	if counts[http.StatusOK] != 1 || counts[http.StatusConflict] != 1 {
		t.Fatalf("concurrent cancellation statuses=%v, want one 200 and one 409", counts)
	}
	var reversals int
	if err = db.QueryRow(`select count(*) from pos_stock_movements where batch_id=$1 and reversal_of_movement_id is not null`, concurrentBatchID).Scan(&reversals); err != nil || reversals != 1 {
		t.Fatalf("concurrent cancellation reversals=%d err=%v", reversals, err)
	}
}
