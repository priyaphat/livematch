package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestPOSProductConflictReportsDuplicateFields(t *testing.T) {
	tests := []struct {
		constraint string
		wantCode   string
		wantText   string
	}{
		{"idx_pos_products_sku", "duplicate_sku", "รหัส SKU นี้ถูกใช้แล้ว กรุณาใช้รหัสอื่น"},
		{"idx_pos_products_barcode", "duplicate_barcode", "บาร์โค้ดนี้ถูกใช้กับสินค้าอื่นแล้ว"},
	}
	for _, test := range tests {
		message, code, ok := posProductConflict(&pgconn.PgError{Code: "23505", ConstraintName: test.constraint})
		if !ok || code != test.wantCode || message != test.wantText {
			t.Fatalf("constraint %s = %q/%q/%v, want %q/%q/true", test.constraint, message, code, ok, test.wantText, test.wantCode)
		}
	}
	if _, _, ok := posProductConflict(&pgconn.PgError{Code: "23514", ConstraintName: "stock_check"}); ok {
		t.Fatal("a non-unique database error must not be reported as duplicate product data")
	}
}

func TestBillingLinePaymentLabelUsesProductNames(t *testing.T) {
	label, description := billingLinePaymentLabel(billingLine{
		SourceType: "pos",
		SourceID:   "sale-123",
		Label:      "สินค้า · sale-123",
		Snapshot:   json.RawMessage(`{"items":[{"name":"ลูกแบด"},{"name":"น้ำดื่ม"},{"name":"ลูกแบด"}]}`),
	})
	if label != "สินค้า · ลูกแบด, น้ำดื่ม" || description != "เลขที่ sale-123" {
		t.Fatalf("label=%q description=%q", label, description)
	}
}

func TestValidPOSPaymentMethod(t *testing.T) {
	for _, method := range []string{"cash", "promptpay"} {
		if !validPaymentMethod(method) {
			t.Fatalf("expected %q to be valid", method)
		}
	}
	for _, method := range []string{"", "card", "transfer", "CASH"} {
		if validPaymentMethod(method) {
			t.Fatalf("expected %q to be invalid", method)
		}
	}
}

func TestEqualSplitSharesPreservesEverySatang(t *testing.T) {
	shares := equalSplitShares(10000, 3)
	want := []int64{3334, 3333, 3333}
	var total int64
	for index, share := range shares {
		if share != want[index] {
			t.Fatalf("share %d=%d want %d", index, share, want[index])
		}
		total += share
	}
	if total != 10000 {
		t.Fatalf("split total=%d want 10000", total)
	}
	if got := equalSplitShares(100, 0); len(got) != 0 {
		t.Fatalf("invalid count returned %#v", got)
	}
}

func TestPromptPayPayloadSatangIncludesDecimalAmount(t *testing.T) {
	payload, err := promptPayPayloadSatang(promptPaySettings{ID: "0812345678", Type: "mobile"}, 2033)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(payload, "540520.33") {
		t.Fatalf("payload does not contain 20.33: %q", payload)
	}
	if got := payload[len(payload)-4:]; got != crc16CCITT(payload[:len(payload)-4]) {
		t.Fatalf("invalid CRC: %s", got)
	}
}

func TestDecodePOSProductRejectsNegativeStock(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/admin/pos/products", strings.NewReader(`{"sku":"W-NEG","name":"Water","priceThb":20,"costThb":10,"stockQuantity":-1,"lowStockThreshold":5,"active":true}`))
	recorder := httptest.NewRecorder()
	if _, ok := decodePOSProduct(recorder, req); ok {
		t.Fatal("negative stock should be rejected")
	}
	if recorder.Code != 400 {
		t.Fatalf("status=%d, want 400", recorder.Code)
	}
}

func TestProductStockFieldsRespectSaleLocationAndTracking(t *testing.T) {
	product := posProductRecord{StockQuantity: 7, SecondaryStockQuantity: 3, TrackStock: true, LowStockThreshold: 3}
	applyProductStockFields(&product, "secondary")
	if product.TotalStockQuantity != 10 || product.SaleStockQuantity != 3 || !product.LowStock {
		t.Fatalf("unexpected stock fields: %+v", product)
	}
	product.TrackStock = false
	applyProductStockFields(&product, "primary")
	if product.LowStock {
		t.Fatal("untracked product must not be low stock")
	}
}

func TestDecodePOSProductNormalizesText(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/admin/pos/products", strings.NewReader(`{"sku":" W-01 ","category":" Drinks ","name":" Water ","priceThb":20,"costThb":10,"stockQuantity":4,"lowStockThreshold":2,"active":true}`))
	recorder := httptest.NewRecorder()
	product, ok := decodePOSProduct(recorder, req)
	if !ok {
		t.Fatalf("valid product rejected: %s", recorder.Body.String())
	}
	if product.SKU != "W-01" || product.Category != "Drinks" || product.Name != "Water" {
		t.Fatalf("product was not normalized: %#v", product)
	}
}

func TestDecodePOSProductClearsStockOnlySettings(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/admin/pos/products", strings.NewReader(`{"sku":"SERVICE-01","name":"Service","priceThb":100,"costThb":20,"stockQuantity":9,"secondaryStockQuantity":4,"trackStock":false,"lowStockThreshold":7,"unitsPerPack":12,"active":true}`))
	recorder := httptest.NewRecorder()
	product, ok := decodePOSProduct(recorder, req)
	if !ok {
		t.Fatalf("non-stock product should be accepted: %s", recorder.Body.String())
	}
	if product.StockQuantity != 0 || product.SecondaryStockQuantity != 0 || product.LowStockThreshold != 0 || product.UnitsPerPack != 0 {
		t.Fatalf("stock-only values were not cleared: %#v", product)
	}
}

func TestDecodePOSProductAcceptsResizedImagePayload(t *testing.T) {
	raw := make([]byte, 70*1024)
	copy(raw, []byte("\x89PNG\r\n\x1a\n"))
	imageData := "data:image/png;base64," + base64.StdEncoding.EncodeToString(raw)
	body := `{"sku":"W-IMAGE","name":"Water","priceThb":20,"costThb":10,"stockQuantity":1,"lowStockThreshold":1,"active":true,"imageData":"` + imageData + `"}`
	req := httptest.NewRequest("POST", "/api/admin/pos/products", strings.NewReader(body))
	recorder := httptest.NewRecorder()
	product, ok := decodePOSProduct(recorder, req)
	if !ok {
		t.Fatalf("valid resized image payload rejected: %s", recorder.Body.String())
	}
	if product.ImageData != imageData {
		t.Fatal("image payload was not preserved")
	}
}

func TestDecodePOSProductRejectsImageLargerThanTwoMegabytes(t *testing.T) {
	raw := make([]byte, 2*1024*1024+1)
	copy(raw, []byte("\x89PNG\r\n\x1a\n"))
	imageData := "data:image/png;base64," + base64.StdEncoding.EncodeToString(raw)
	body := `{"sku":"W-LARGE","name":"Water","priceThb":20,"costThb":10,"stockQuantity":1,"lowStockThreshold":1,"active":true,"imageData":"` + imageData + `"}`
	req := httptest.NewRequest("POST", "/api/admin/pos/products", strings.NewReader(body))
	recorder := httptest.NewRecorder()
	if _, ok := decodePOSProduct(recorder, req); ok {
		t.Fatal("image larger than 2 MB should be rejected")
	}
	if recorder.Code != 400 {
		t.Fatalf("status=%d, want 400", recorder.Code)
	}
}

func TestWeightedAverageCost(t *testing.T) {
	tests := []struct {
		name                              string
		currentQuantity, incomingQuantity int
		currentCostSatang, incomingNet    int64
		want                              int64
	}{
		{name: "discounted receipt", currentQuantity: 10, currentCostSatang: 10000, incomingQuantity: 10, incomingNet: 70000, want: 8500},
		{name: "first receipt", currentQuantity: 0, currentCostSatang: 0, incomingQuantity: 8, incomingNet: 13600, want: 1700},
		{name: "round half up to satang", currentQuantity: 1, currentCostSatang: 1000, incomingQuantity: 1, incomingNet: 1001, want: 1001},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := weightedAverageCostSatang(tt.currentQuantity, tt.currentCostSatang, tt.incomingQuantity, tt.incomingNet)
			if got != tt.want {
				t.Fatalf("weightedAverageCostSatang()=%d, want %d", got, tt.want)
			}
		})
	}
}

func TestStockReceiptRegressionKeepsOriginalCostFormula(t *testing.T) {
	// Existing product: 6 units in primary + 4 in secondary at 100.00 each.
	// Receipt: 5 units, gross 600.00, discount 10% => net 540.00.
	// Weighted average = (10*100.00 + 540.00) / 15 = 102.666..., rounded to 102.67.
	grossSatang := int64(60000)
	discount := stockDiscountSatang(grossSatang, "percent", 0, 1000)
	if discount != 6000 {
		t.Fatalf("discount=%d, want 6000", discount)
	}
	netSatang := grossSatang - discount
	average := weightedAverageCostSatang(6+4, 10000, 5, netSatang)
	if average != 10267 {
		t.Fatalf("weighted average=%d, want 10267", average)
	}
	if stockValue := int64(15) * average; stockValue != 154005 {
		t.Fatalf("post-receipt stock value=%d, want 154005", stockValue)
	}
	if unitReceiptCost := unitCostFromLineTotalSatang(grossSatang, 5); unitReceiptCost != 12000 {
		t.Fatalf("receipt unit cost=%d, want 12000", unitReceiptCost)
	}
}

func TestUnitCostFromLineTotalSatang(t *testing.T) {
	tests := []struct {
		name       string
		lineTotal  int64
		quantity   int
		wantSatang int64
	}{
		{name: "800 baht divided by 10", lineTotal: 80000, quantity: 10, wantSatang: 8000},
		{name: "half satang rounds up", lineTotal: 5, quantity: 2, wantSatang: 3},
		{name: "below half rounds down", lineTotal: 4, quantity: 3, wantSatang: 1},
		{name: "invalid zero quantity", lineTotal: 100, quantity: 0, wantSatang: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := unitCostFromLineTotalSatang(tt.lineTotal, tt.quantity); got != tt.wantSatang {
				t.Fatalf("unitCostFromLineTotalSatang(%d,%d)=%d, want %d", tt.lineTotal, tt.quantity, got, tt.wantSatang)
			}
		})
	}
}

func TestAllocateStockDiscount(t *testing.T) {
	tests := []struct {
		name       string
		unitCosts  []int64
		quantities []int
		discount   int64
		want       []int64
	}{
		{name: "equal per total unit", unitCosts: []int64{10000, 5000}, quantities: []int{2, 3}, discount: 5000, want: []int64{2000, 3000}},
		{name: "stable satang remainder", unitCosts: []int64{100, 100}, quantities: []int{1, 1}, discount: 1, want: []int64{1, 0}},
		{name: "cap cheap line and redistribute", unitCosts: []int64{1, 100}, quantities: []int{2, 1}, discount: 5, want: []int64{2, 3}},
		{name: "full discount", unitCosts: []int64{1234, 5678}, quantities: []int{2, 1}, discount: 8146, want: []int64{2468, 5678}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := allocateStockDiscount(tt.unitCosts, tt.quantities, tt.discount)
			if err != nil {
				t.Fatalf("allocateStockDiscount() error: %v", err)
			}
			for index := range tt.want {
				if got[index] != tt.want[index] {
					t.Fatalf("allocation[%d]=%d, want %d (all=%v)", index, got[index], tt.want[index], got)
				}
			}
		})
	}
}

func TestAllocateStockDiscountRejectsExcess(t *testing.T) {
	if _, err := allocateStockDiscount([]int64{100}, []int{1}, 101); err == nil {
		t.Fatal("discount exceeding gross total should be rejected")
	}
}

func TestAllocateStockDiscountByExactLineTotals(t *testing.T) {
	got, err := allocateStockDiscountByLineTotals([]int64{100, 250}, []int{3, 2}, 5)
	if err != nil {
		t.Fatalf("allocateStockDiscountByLineTotals() error: %v", err)
	}
	if got[0] != 3 || got[1] != 2 {
		t.Fatalf("allocation=%v, want [3 2]", got)
	}
}

func TestStockDiscountSatang(t *testing.T) {
	if got := stockDiscountSatang(12345, "amount", 678, 0); got != 678 {
		t.Fatalf("amount discount=%d, want 678", got)
	}
	if got := stockDiscountSatang(10001, "percent", 0, 2550); got != 2550 {
		t.Fatalf("percent discount=%d, want 2550", got)
	}
	if got := stockDiscountSatang(9999, "percent", 0, 0); got != 0 {
		t.Fatalf("zero discount=%d, want 0", got)
	}
}
