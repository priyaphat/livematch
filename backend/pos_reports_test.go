package main

import (
	"testing"
	"time"
)

func TestPOSReportPackBreakdown(t *testing.T) {
	tests := []struct {
		name            string
		stock, pack     int
		full, remainder int
		configured      bool
	}{
		{name: "101 units in packs of 12", stock: 101, pack: 12, full: 8, remainder: 5, configured: true},
		{name: "pack of one", stock: 7, pack: 1, full: 7, remainder: 0, configured: true},
		{name: "zero stock", stock: 0, pack: 12, full: 0, remainder: 0, configured: true},
		{name: "pack disabled", stock: 101, pack: 0, full: 0, remainder: 0, configured: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			full, remainder, configured := posPackBreakdown(test.stock, test.pack)
			if full != test.full || remainder != test.remainder || configured != test.configured {
				t.Fatalf("got (%d,%d,%v), want (%d,%d,%v)", full, remainder, configured, test.full, test.remainder, test.configured)
			}
		})
	}
}

func TestPOSSpecialSessionCountsActualMatchUsage(t *testing.T) {
	state := SessionState{
		Session: SessionInfo{ID: "session-a", Name: "รอบเช้า"},
		Settings: Settings{
			EntryFee:        100,
			MemberEntryFees: map[string]int{"student": 60, "general": 100},
			ShuttleFee:      50,
			ShuttleBrands:   []ShuttleBrand{{ID: "gold", Name: "Gold", Price: 75, Active: true}},
		},
		Players: []Player{
			{ID: 1, Name: "หนึ่ง", Active: true, MemberTypeID: "student", MemberTypeName: "นักเรียน"},
			{ID: 2, Name: "สอง", Active: false},
			{ID: 3, Name: "สาม", Active: true, MemberTypeID: "general", MemberTypeName: "สมาชิกทั่วไป"},
		},
		Live: []Match{{ID: 1, Shuttles: 1, ShuttleSeqItems: []ShuttleSeqItem{{BrandID: "gold", Number: 1}}, ShuttlePriceSnapshot: []ShuttleBrand{{ID: "gold", Name: "Gold Snapshot", Price: 70}}}},
		History: []Match{
			{ID: 2, Status: "cancelled", ShuttleReturned: true, Shuttles: 1, ShuttleSeqItems: []ShuttleSeqItem{{BrandID: "gold", Number: 2}}},
			{ID: 3, Status: "cancelled", ShuttleReturned: false, Shuttles: 1, ShuttleSeqItems: []ShuttleSeqItem{{BrandID: "gold", Number: 3}}, ShuttlePriceSnapshot: []ShuttleBrand{{ID: "gold", Name: "Gold", Price: 80}}},
		},
	}
	report := buildPOSSpecialSession(state, time.Date(2026, 8, 26, 9, 0, 0, 0, time.UTC))
	if report["playerCount"].(int) != 3 || report["entryFeeTotalSatang"].(int64) != 26000 || len(report["entryFees"].([]map[string]any)) != 2 {
		t.Fatalf("entry fee report mismatch: %#v", report)
	}
	if report["gameCount"].(int) != 3 || report["shuttleQuantity"].(int) != 2 || report["shuttleTotalSatang"].(int64) != 15000 {
		t.Fatalf("actual shuttle report mismatch: %#v", report)
	}
}
