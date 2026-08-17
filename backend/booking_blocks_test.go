package main

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestBookingIPProtectionIsStableAndMasked(t *testing.T) {
	t.Setenv("APP_ENCRYPTION_KEY", strings.Repeat("k", 32))
	first, encrypted, masked := bookingIPProtection("203.0.113.42")
	second := bookingIPHash("203.0.113.42")
	if first == "" || first != second || encrypted == "" || masked != "203.0.113.xxx" {
		t.Fatalf("unexpected IP protection: %q %q %q", first, encrypted, masked)
	}
	if first == bookingIPHash("203.0.113.43") {
		t.Fatal("different IPs must not share a lookup hash")
	}
}

func TestWriteBookingBlockedUsesLockedContract(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeBookingBlocked(recorder, bookingBlockStatus{BlockedUntil: time.Now().Add(10 * time.Minute), RemainingSeconds: 600, Targets: []string{"account", "ip"}})
	if recorder.Code != 423 || recorder.Header().Get("Retry-After") != "600" {
		t.Fatalf("unexpected response: %d %s", recorder.Code, recorder.Body.String())
	}
	if body := recorder.Body.String(); !strings.Contains(body, "booking_blacklisted") || !strings.Contains(body, "blockedUntil") {
		t.Fatalf("missing block contract: %s", body)
	}
}
