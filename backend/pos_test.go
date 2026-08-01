package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

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

func TestWeightedAverageCost(t *testing.T) {
	tests := []struct {
		name                           string
		currentQuantity, currentCost   int
		incomingQuantity, incomingCost int
		want                           int
	}{
		{name: "mixed purchase prices", currentQuantity: 10, currentCost: 20, incomingQuantity: 5, incomingCost: 30, want: 23},
		{name: "first receipt", currentQuantity: 0, currentCost: 0, incomingQuantity: 8, incomingCost: 17, want: 17},
		{name: "round to nearest baht", currentQuantity: 1, currentCost: 10, incomingQuantity: 1, incomingCost: 11, want: 11},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := weightedAverageCost(tt.currentQuantity, tt.currentCost, tt.incomingQuantity, tt.incomingCost)
			if got != tt.want {
				t.Fatalf("weightedAverageCost()=%d, want %d", got, tt.want)
			}
		})
	}
}
