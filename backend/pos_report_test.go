package main

import (
	"net/url"
	"testing"
	"time"
)

func TestPOSReportPeriodCustomUsesInclusiveThaiDates(t *testing.T) {
	rangeKey, start, end, startDate, endDate, err := posReportPeriod(url.Values{
		"range":     {"custom"},
		"startDate": {"2026-08-01"},
		"endDate":   {"2026-08-03"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if rangeKey != "custom" || startDate != "2026-08-01" || endDate != "2026-08-03" {
		t.Fatalf("unexpected period: %s %s %s", rangeKey, startDate, endDate)
	}
	if start.Format(time.RFC3339) != "2026-08-01T00:00:00+07:00" || end.Format(time.RFC3339) != "2026-08-04T00:00:00+07:00" {
		t.Fatalf("custom range must include the full end date: %s - %s", start, end)
	}
}

func TestPOSReportPeriodRejectsReverseCustomRange(t *testing.T) {
	_, _, _, _, _, err := posReportPeriod(url.Values{
		"range":     {"custom"},
		"startDate": {"2026-08-04"},
		"endDate":   {"2026-08-03"},
	})
	if err == nil {
		t.Fatal("expected reverse custom date range to be rejected")
	}
}
