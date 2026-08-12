package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
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

func TestMemberSearchQuerySearchesFromFirstCharacter(t *testing.T) {
	tests := []struct {
		values url.Values
		query  string
		ok     bool
	}{
		{url.Values{"q": {"ป"}}, "ป", true},
		{url.Values{"q": {"ปรี"}}, "ปรี", true},
		{url.Values{"phone": {"0"}}, "0", true},
		{url.Values{"phone": {"08822"}}, "08822", true},
		{url.Values{"phone": {"088225"}}, "088225", true},
		{url.Values{"q": {"สมชาย"}, "phone": {"088225"}}, "สมชาย", true},
	}
	for _, test := range tests {
		query, ok := memberSearchQuery(test.values)
		if query != test.query || ok != test.ok {
			t.Fatalf("memberSearchQuery(%v) = %q, %v; want %q, %v", test.values, query, ok, test.query, test.ok)
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

func TestFetchTelegramUpdatesReturnsJSONWithoutExposingTokenInURLResponse(t *testing.T) {
	token := "123456789:secret-token-value"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/bot"+token+"/getUpdates" {
			t.Fatalf("unexpected Telegram path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"result":[{"update_id":42}]}`))
	}))
	defer server.Close()
	previous := telegramAPIBaseURL
	telegramAPIBaseURL = server.URL
	defer func() { telegramAPIBaseURL = previous }()

	result, status, err := fetchTelegramUpdates(t.Context(), token)
	if err != nil || status != http.StatusOK || !strings.Contains(string(result), `"update_id":42`) {
		t.Fatalf("unexpected Telegram check result: status=%d result=%s err=%v", status, result, err)
	}
	if strings.Contains(string(result), token) {
		t.Fatal("Telegram check response must not expose the bot token")
	}
	for _, invalid := range []string{"", "abc", "123:bad/token", "123:bad token"} {
		if _, _, err = fetchTelegramUpdates(t.Context(), invalid); err == nil {
			t.Fatalf("invalid token %q should be rejected before the request", invalid)
		}
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

func TestGoogleOAuthRedirectUsesOnlyConfiguredCurrentDomain(t *testing.T) {
	t.Setenv("GOOGLE_REDIRECT_URL", "https://one.example/api/public-auth/google/callback")
	t.Setenv("GOOGLE_REDIRECT_URLS", "https://one.example/api/public-auth/google/callback, https://two.example/api/public-auth/google/callback,https://three.example/api/public-auth/google/callback")

	redirect, origin, ok := googleRedirectForOrigin("https://two.example")
	if !ok || redirect != "https://two.example/api/public-auth/google/callback" || origin != "https://two.example" {
		t.Fatalf("unexpected domain-specific redirect: %q %q %v", redirect, origin, ok)
	}
	for _, malicious := range []string{
		"https://evil.example",
		"https://two.example.evil.example",
		"https://two.example@evil.example",
		"https://two.example/path",
		"https://two.example?next=https://evil.example",
	} {
		if redirect, origin, ok = googleRedirectForOrigin(malicious); ok || redirect != "" || origin != "" {
			t.Fatalf("unconfigured OAuth origin %q must be rejected", malicious)
		}
	}
}

func TestPublicBookingServerValidationRejectsTamperedPayloadTimes(t *testing.T) {
	now := time.Date(2026, 8, 12, 10, 0, 0, 0, bangkokLocation)
	settings := bookingSettingsRecord{
		OpenTime:        "16:00",
		CloseTime:       "22:00",
		IntervalMinutes: 60,
		AllowOvernight:  false,
	}
	validStart := time.Date(2026, 8, 12, 16, 0, 0, 0, bangkokLocation)
	if err := validatePublicBookingWindow(settings, validStart, validStart.Add(time.Hour), now); err != nil {
		t.Fatalf("valid server-side booking was rejected: %v", err)
	}

	tests := []struct {
		name  string
		start time.Time
		end   time.Time
	}{
		{"past time", now.Add(-2 * time.Hour), now.Add(-time.Hour)},
		{"outside opening hours", validStart.Add(-time.Hour), validStart},
		{"off interval grid", validStart.Add(30 * time.Minute), validStart.Add(90 * time.Minute)},
		{"invalid duration", validStart, validStart.Add(45 * time.Minute)},
		{"reversed time", validStart.Add(time.Hour), validStart},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := validatePublicBookingWindow(settings, test.start, test.end, now); err == nil {
				t.Fatal("crafted public booking payload should be rejected by the backend")
			}
		})
	}

	tomorrow := validStart.AddDate(0, 0, 1)
	if err := validatePublicBookingWindow(settings, tomorrow, tomorrow.Add(time.Hour), now); !errors.Is(err, errPublicBookingDateNotAllowed) {
		t.Fatalf("future date bypass should be rejected, got %v", err)
	}

	settings.AllowOvernight = true
	settings.SingleSlotPurchaseEnabled = true
	if err := validatePublicBookingWindow(settings, tomorrow, tomorrow.Add(2*time.Hour), now); !errors.Is(err, errPublicSingleSlotOnly) {
		t.Fatalf("multi-slot bypass should be rejected, got %v", err)
	}
}

func TestAdminBookingCanCrossDaysWhenPublicAdvanceBookingIsDisabled(t *testing.T) {
	settings := bookingSettingsRecord{
		OpenTime:        "16:00",
		CloseTime:       "22:00",
		IntervalMinutes: 60,
		AllowOvernight:  false,
	}
	now := time.Now().In(bangkokLocation)
	start := time.Date(now.Year(), now.Month(), now.Day()+1, 20, 0, 0, 0, bangkokLocation)
	end := start.Add(25 * time.Hour)

	if err := validateAdminBookingWindow(settings, start, end); err != nil {
		t.Fatalf("admin cross-day booking should not depend on allowOvernight: %v", err)
	}
	if err := validateBookingWindow(settings, start, end); err == nil {
		t.Fatal("the public booking validator must still reject a cross-day booking")
	}
}

func TestValidBookingExportStatus(t *testing.T) {
	for _, status := range []string{"", "all", "hold", "pending_review", "confirmed", "rejected", "cancelled", "expired"} {
		if !validBookingExportStatus(status) {
			t.Fatalf("expected %q to be a valid export status", status)
		}
	}
	for _, status := range []string{"paid", "pending", "unknown"} {
		if validBookingExportStatus(status) {
			t.Fatalf("expected %q to be rejected", status)
		}
	}
}

func TestTelegramReviewTextConfirmsTheSelectedAction(t *testing.T) {
	items := []telegramBookingItem{
		{Court: "สนาม 1", Start: "23/07/2026 18:00", End: "19:00", Amount: 100},
		{Court: "สนาม 2", Start: "23/07/2026 19:00", End: "20:00", Amount: 120},
	}
	short, message := telegramReviewText("approve", "ผู้จอง", items)
	if short != "อนุมัติแล้ว" || !strings.Contains(message, "✅ อนุมัติการจองแล้ว") || !strings.Contains(message, "จำนวน: 2 ช่วง") || !strings.Contains(message, "สนาม 2") || !strings.Contains(message, "ยอดรวม: 220 บาท") {
		t.Fatalf("unexpected approve confirmation: %q / %q", short, message)
	}
	short, message = telegramReviewText("reject", "ผู้จอง", items[:1])
	if short != "ปฏิเสธแล้ว" || !strings.Contains(message, "❌ ปฏิเสธการจองแล้ว") {
		t.Fatalf("unexpected reject confirmation: %q / %q", short, message)
	}
}

func TestTelegramBookingMessageShowsEveryBookedSlot(t *testing.T) {
	message := telegramBookingMessage("🏸 จองสนามใหม่", "สมชาย", []telegramBookingItem{
		{Court: "สนาม 1", Start: "05/08/2026 16:00", End: "17:00", Amount: 100},
		{Court: "สนาม 1", Start: "05/08/2026 17:00", End: "18:00", Amount: 100},
		{Court: "สนาม 2", Start: "05/08/2026 18:00", End: "19:00", Amount: 120},
	})
	for _, expected := range []string{"จำนวน: 3 ช่วง", "1. สนาม 1", "2. สนาม 1", "3. สนาม 2", "ยอดรวม: 320 บาท"} {
		if !strings.Contains(message, expected) {
			t.Fatalf("telegram message missing %q: %s", expected, message)
		}
	}
}
