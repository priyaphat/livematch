package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

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
	req := httptest.NewRequest("POST", "/api/admin/pos/products", strings.NewReader(`{"name":"Water","priceThb":20,"costThb":10,"stockQuantity":-1,"lowStockThreshold":5,"active":true}`))
	recorder := httptest.NewRecorder()
	if _, ok := decodePOSProduct(recorder, req); ok {
		t.Fatal("negative stock should be rejected")
	}
	if recorder.Code != 400 {
		t.Fatalf("status=%d, want 400", recorder.Code)
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

func TestDecodePOSProductAcceptsResizedImagePayload(t *testing.T) {
	raw := make([]byte, 70*1024)
	copy(raw, []byte("\x89PNG\r\n\x1a\n"))
	imageData := "data:image/png;base64," + base64.StdEncoding.EncodeToString(raw)
	body := `{"name":"Water","priceThb":20,"costThb":10,"stockQuantity":1,"lowStockThreshold":1,"active":true,"imageData":"` + imageData + `"}`
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
	body := `{"name":"Water","priceThb":20,"costThb":10,"stockQuantity":1,"lowStockThreshold":1,"active":true,"imageData":"` + imageData + `"}`
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
