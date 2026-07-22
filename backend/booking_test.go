package main

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestNormalizePhoneProducesTenantSafeE164Value(t *testing.T) {
	tests := map[string]string{
		"081-234-5678":    "+66812345678",
		"+66 81 234 5678": "+66812345678",
		"66812345678":     "+66812345678",
	}
	for input, want := range tests {
		got, err := normalizePhone(input)
		if err != nil {
			t.Fatalf("normalizePhone(%q): %v", input, err)
		}
		if got != want {
			t.Fatalf("normalizePhone(%q)=%q, want %q", input, got, want)
		}
	}
	for _, input := range []string{"", "12345", "not-a-phone"} {
		if _, err := normalizePhone(input); err == nil {
			t.Fatalf("normalizePhone(%q) should fail", input)
		}
	}
}

func TestPhoneSearchDigits(t *testing.T) {
	tests := map[string]string{
		"0882250419":      "0882250419",
		"088-225-0419":    "0882250419",
		"+66 88 225 0419": "66882250419",
		"member name":     "",
	}
	for input, want := range tests {
		if got := phoneSearchDigits(input); got != want {
			t.Fatalf("phoneSearchDigits(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestClosureOccurrencesRepeatTheSameHoursEveryDay(t *testing.T) {
	start := time.Date(2026, 7, 22, 20, 0, 0, 0, bangkokLocation)
	end := time.Date(2026, 7, 30, 21, 0, 0, 0, bangkokLocation)
	occurrences, err := closureOccurrences(start, end, 60)
	if err != nil {
		t.Fatalf("closureOccurrences: %v", err)
	}
	if len(occurrences) != 9 {
		t.Fatalf("got %d occurrences, want 9", len(occurrences))
	}
	for i, occurrence := range occurrences {
		if occurrence.Start.Hour() != 20 || occurrence.End.Hour() != 21 || occurrence.End.Sub(occurrence.Start) != time.Hour {
			t.Fatalf("occurrence %d is %v-%v, want 20:00-21:00", i, occurrence.Start, occurrence.End)
		}
	}
	if occurrences[0].Start.Day() != 22 || occurrences[len(occurrences)-1].Start.Day() != 30 {
		t.Fatalf("unexpected inclusive date range: %v through %v", occurrences[0].Start, occurrences[len(occurrences)-1].Start)
	}
	if _, err = closureOccurrences(start, time.Date(2026, 7, 30, 20, 45, 0, 0, bangkokLocation), 60); err == nil {
		t.Fatal("closure duration must align with the configured interval")
	}
	if _, err = closureOccurrences(start, time.Date(2027, 7, 23, 21, 0, 0, 0, bangkokLocation), 60); err == nil {
		t.Fatal("closure longer than 366 inclusive days should be rejected")
	}
}

func TestBookingImageUploadAllowlist(t *testing.T) {
	for _, value := range []string{
		"data:image/jpeg;base64,/9j/",
		"data:image/png;base64,iVBORw0KGgo=",
		"data:image/webp;base64,UklGRgAAAABXRUJQ",
	} {
		if !validImageData(value, false) {
			t.Fatalf("expected %q to be accepted", value)
		}
	}
	for _, value := range []string{"", "data:image/svg+xml;base64,AA==", "data:text/html;base64,AA=="} {
		if validImageData(value, false) {
			t.Fatalf("expected %q to be rejected", value)
		}
	}
}

func TestBookingRateLimitUsesRemoteIPAndScope(t *testing.T) {
	requestRates.Lock()
	requestRates.items = make(map[string]requestRateBucket)
	requestRates.Unlock()
	r := httptest.NewRequest("POST", "/api/public-booking/example/hold", nil)
	r.RemoteAddr = "203.0.113.8:12000"
	if !allowBookingRequest(r, "hold", 2, time.Minute) || !allowBookingRequest(r, "hold", 2, time.Minute) {
		t.Fatal("first two requests should be allowed")
	}
	if allowBookingRequest(r, "hold", 2, time.Minute) {
		t.Fatal("third request should be rate limited")
	}
	if !allowBookingRequest(r, "slip", 2, time.Minute) {
		t.Fatal("a separate scope should have a separate bucket")
	}
}

func TestPublicBookingDateFollowsAllowOvernightSetting(t *testing.T) {
	now := time.Date(2026, 7, 23, 10, 0, 0, 0, bangkokLocation)
	todayStart := time.Date(2026, 7, 23, 16, 0, 0, 0, bangkokLocation)
	todayEnd := todayStart.Add(time.Hour)
	tomorrowStart := todayStart.AddDate(0, 0, 1)

	locked := bookingSettingsRecord{AllowOvernight: false}
	if !publicBookingDateAllowed(locked, todayStart, todayEnd, now) {
		t.Fatal("today must remain bookable when changing booking date is disabled")
	}
	if publicBookingDateAllowed(locked, tomorrowStart, tomorrowStart.Add(time.Hour), now) {
		t.Fatal("another day must not be bookable when allowOvernight is false")
	}

	unlocked := bookingSettingsRecord{AllowOvernight: true}
	if !publicBookingDateAllowed(unlocked, tomorrowStart, tomorrowStart.Add(time.Hour), now) {
		t.Fatal("another day must be bookable when allowOvernight is true")
	}
}
