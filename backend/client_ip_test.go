package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientIPOnlyTrustsConfiguredProxy(t *testing.T) {
	t.Setenv("APP_TRUSTED_PROXY_CIDRS", "10.0.0.0/8")
	untrusted := httptest.NewRequest("GET", "/", nil)
	untrusted.RemoteAddr = "203.0.113.9:1234"
	untrusted.Header.Set("X-Forwarded-For", "198.51.100.7")
	if got := clientIP(untrusted); got != "203.0.113.9" {
		t.Fatalf("untrusted proxy spoofed client IP: %s", got)
	}

	trusted := httptest.NewRequest("GET", "/", nil)
	trusted.RemoteAddr = "10.2.3.4:1234"
	trusted.Header.Set("X-Forwarded-For", "198.51.100.7, 10.1.1.1")
	if got := clientIP(trusted); got != "198.51.100.7" {
		t.Fatalf("trusted proxy client IP = %s", got)
	}
}

func TestProductionConfigValidation(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	t.Setenv("APP_BASE_URL", "https://example.com")
	if err := validateProductionConfig(); err != nil {
		t.Fatalf("development config must remain permissive: %v", err)
	}

	t.Setenv("APP_ENV", "production")
	t.Setenv("APP_ALLOWED_ORIGINS", "")
	if err := validateProductionConfig(); err == nil || !strings.Contains(err.Error(), "APP_ALLOWED_ORIGINS") {
		t.Fatalf("expected clear production configuration error, got %v", err)
	}
}

func TestCancellableBookingStatuses(t *testing.T) {
	for _, status := range []string{"hold", "pending_review", "confirmed", "cancelled"} {
		if !cancellableBookingStatus(status) {
			t.Fatalf("expected %s to be cancellable", status)
		}
	}
	for _, status := range []string{"expired", "rejected"} {
		if cancellableBookingStatus(status) {
			t.Fatalf("expected %s not to be cancellable", status)
		}
	}
}

func TestBookingSlipConflictMessages(t *testing.T) {
	if got := bookingSlipConflictMessage("cancelled"); !strings.Contains(got, "ผู้ดูแลยกเลิก") {
		t.Fatalf("cancelled upload message = %q", got)
	}
	if got := bookingSlipConflictMessage("pending_review"); !strings.Contains(got, "รอผู้ดูแลตรวจสอบ") {
		t.Fatalf("pending upload message = %q", got)
	}
}
