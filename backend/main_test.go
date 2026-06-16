package main

import "testing"

func TestRandomMatchCreatesAllPossibleQueuedMatches(t *testing.T) {
	state := SessionState{
		Settings: Settings{
			Levels:          []string{"light", "middle", "heavy"},
			AllowCrossLevel: true,
			CrossLevelRange: 1,
		},
		Players: []Player{
			{ID: 6, Name: "เบิร์ด", Active: true, Coupon: true, Level: "light"},
			{ID: 7, Name: "ปุ้ย", Active: true, Coupon: true, Level: "light"},
			{ID: 8, Name: "อิน", Active: true, Coupon: true, Level: "light"},
			{ID: 9, Name: "ออน", Active: true, Coupon: true, Level: "light"},
			{ID: 10, Name: "โอ", Active: true, Coupon: true, Level: "light"},
			{ID: 11, Name: "ยู", Active: true, Coupon: true, Level: "middle"},
			{ID: 12, Name: "นะ", Active: true, Coupon: true, Level: "middle"},
			{ID: 13, Name: "กร", Active: true, Coupon: true, Level: "middle"},
		},
		Couples: []Couple{{ID: 1, A: 6, B: 7}},
	}

	if err := randomMatch(&state); err != nil {
		t.Fatalf("randomMatch returned error: %v", err)
	}
	if got := len(state.Queue); got != 2 {
		t.Fatalf("expected 2 queued matches, got %d: %#v", got, state.Queue)
	}
	if state.Queue[0].A1 != 6 || state.Queue[0].A2 != 7 {
		t.Fatalf("expected couple 6/7 to stay together in first team, got %#v", state.Queue[0])
	}
}

func TestRandomPriorityCanPreferLowestGamesOverLevelOrder(t *testing.T) {
	basePlayers := []Player{
		{ID: 1, Name: "l1", Games: 5, Active: true, Coupon: true, Level: "light"},
		{ID: 2, Name: "l2", Games: 5, Active: true, Coupon: true, Level: "light"},
		{ID: 3, Name: "l3", Games: 5, Active: true, Coupon: true, Level: "light"},
		{ID: 4, Name: "l4", Games: 5, Active: true, Coupon: true, Level: "light"},
		{ID: 5, Name: "m1", Games: 0, Active: true, Coupon: true, Level: "middle"},
		{ID: 6, Name: "m2", Games: 0, Active: true, Coupon: true, Level: "middle"},
		{ID: 7, Name: "m3", Games: 0, Active: true, Coupon: true, Level: "middle"},
		{ID: 8, Name: "m4", Games: 0, Active: true, Coupon: true, Level: "middle"},
	}

	levelFirst := SessionState{
		Settings: Settings{Levels: []string{"light", "middle"}, RandomPriority: "level"},
		Players:  append([]Player{}, basePlayers...),
	}
	if err := randomMatch(&levelFirst); err != nil {
		t.Fatalf("level-first randomMatch returned error: %v", err)
	}
	if levelFirst.Queue[0].Level != "light" {
		t.Fatalf("expected level priority to keep level order first, got %q", levelFirst.Queue[0].Level)
	}

	gamesFirst := SessionState{
		Settings: Settings{Levels: []string{"light", "middle"}, RandomPriority: "games"},
		Players:  append([]Player{}, basePlayers...),
	}
	if err := randomMatch(&gamesFirst); err != nil {
		t.Fatalf("games-first randomMatch returned error: %v", err)
	}
	if gamesFirst.Queue[0].Level != "middle" {
		t.Fatalf("expected games priority to choose lower-games group first, got %q", gamesFirst.Queue[0].Level)
	}
}
