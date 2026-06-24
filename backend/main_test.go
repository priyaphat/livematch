package main

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"
)

func TestRandomMatchCreatesAllPossiblePendingMatches(t *testing.T) {
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
	if got := len(state.Pending); got != 2 {
		t.Fatalf("expected 2 pending matches, got %d: %#v", got, state.Pending)
	}
	if state.Pending[0].ID >= 0 || state.NextIDs.Match != 0 {
		t.Fatalf("expected pending draft ids not to consume match ids, got pending=%#v next=%#v", state.Pending, state.NextIDs)
	}
	if state.Pending[0].A1 != 6 || state.Pending[0].A2 != 7 {
		t.Fatalf("expected couple 6/7 to stay together in first team, got %#v", state.Pending[0])
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
	if levelFirst.Pending[0].Level != "light" {
		t.Fatalf("expected level priority to keep level order first, got %q", levelFirst.Pending[0].Level)
	}

	gamesFirst := SessionState{
		Settings: Settings{Levels: []string{"light", "middle"}, RandomPriority: "games"},
		Players:  append([]Player{}, basePlayers...),
	}
	if err := randomMatch(&gamesFirst); err != nil {
		t.Fatalf("games-first randomMatch returned error: %v", err)
	}
	if gamesFirst.Pending[0].Level != "middle" {
		t.Fatalf("expected games priority to choose lower-games group first, got %q", gamesFirst.Pending[0].Level)
	}
}

func TestCloseLiveStoresWinnerStatsAndShuttleSequence(t *testing.T) {
	state := SessionState{
		Players: []Player{
			{ID: 1, Name: "a1"},
			{ID: 2, Name: "a2"},
			{ID: 3, Name: "b1"},
			{ID: 4, Name: "b2"},
		},
		Live: []Match{{ID: 1, A1: 1, A2: 2, B1: 3, B2: 4, Shuttles: 3, ShuttleSeq: "1-3"}},
	}

	if !closeLive(&state, 1, false, "", "B") {
		t.Fatal("expected closeLive to close match")
	}
	if got := state.History[0].Winner; got != "B" {
		t.Fatalf("expected winner B, got %q", got)
	}
	if got := state.History[0].ShuttleSeq; got != "1-3" {
		t.Fatalf("expected shuttle sequence 1-3, got %q", got)
	}
	if state.Players[0].Losses != 1 || state.Players[1].Losses != 1 || state.Players[2].Wins != 1 || state.Players[3].Wins != 1 {
		t.Fatalf("unexpected player stats: %#v", state.Players)
	}
}

func TestStartMatchUsesInitialShuttleWhenSettingEnabled(t *testing.T) {
	state := SessionState{
		Settings: Settings{Levels: []string{"light", "middle", "heavy"}, StartMatchWithShuttle: true},
		Players: []Player{
			{ID: 1, Level: "middle"},
			{ID: 2, Level: "middle"},
			{ID: 3, Level: "middle"},
			{ID: 4, Level: "middle"},
		},
		Queue: []Match{{ID: 1, A1: 1, A2: 2, B1: 3, B2: 4}},
	}

	if !startMatch(&state, 1, "สนาม 1") {
		t.Fatal("expected match to start")
	}
	if len(state.Live) != 1 {
		t.Fatalf("expected one live match, got %d", len(state.Live))
	}
	if state.Live[0].Shuttles != 1 {
		t.Fatalf("expected initial shuttle count 1, got %d", state.Live[0].Shuttles)
	}
	if state.Live[0].ShuttleSeq == "" {
		t.Fatal("expected initial shuttle sequence")
	}
}

func TestStartMatchUsesNoInitialShuttleWhenSettingDisabled(t *testing.T) {
	state := SessionState{
		Settings: Settings{Levels: []string{"light", "middle", "heavy"}, StartMatchWithShuttle: false},
		Players: []Player{
			{ID: 1, Level: "middle"},
			{ID: 2, Level: "middle"},
			{ID: 3, Level: "middle"},
			{ID: 4, Level: "middle"},
		},
		Queue: []Match{{ID: 1, A1: 1, A2: 2, B1: 3, B2: 4}},
	}

	if !startMatch(&state, 1, "สนาม 1") {
		t.Fatal("expected match to start")
	}
	if len(state.Live) != 1 {
		t.Fatalf("expected one live match, got %d", len(state.Live))
	}
	if state.Live[0].Shuttles != 0 {
		t.Fatalf("expected initial shuttle count 0, got %d", state.Live[0].Shuttles)
	}
	if state.Live[0].ShuttleSeq != "" {
		t.Fatalf("expected empty shuttle sequence, got %q", state.Live[0].ShuttleSeq)
	}
}

func TestConfirmPendingMatchCreatesStableSequentialQueueIDs(t *testing.T) {
	state := SessionState{
		NextIDs: NextIDs{Match: 7, Pending: 2},
		Pending: []Match{
			{ID: -1, A1: 1, A2: 2, B1: 3, B2: 4, Level: "middle"},
			{ID: -2, A1: 5, A2: 6, B1: 7, B2: 8, Level: "middle"},
		},
	}

	if !cancelPendingMatch(&state, -1) {
		t.Fatal("expected pending match to cancel")
	}
	if state.NextIDs.Match != 7 {
		t.Fatalf("expected cancel not to consume match id, got %d", state.NextIDs.Match)
	}
	if !confirmPendingMatch(&state, -2) {
		t.Fatal("expected pending match to confirm")
	}
	if len(state.Queue) != 1 || state.Queue[0].ID != 8 {
		t.Fatalf("expected confirmed queue game id 8, got %#v", state.Queue)
	}
}

func TestStartMatchRejectsNonAdjacentLevels(t *testing.T) {
	state := SessionState{
		Settings: Settings{Levels: []string{"light", "middle", "heavy"}, AllowCrossLevel: true},
		Players: []Player{
			{ID: 1, Level: "light"},
			{ID: 2, Level: "light"},
			{ID: 3, Level: "heavy"},
			{ID: 4, Level: "heavy"},
		},
		Queue: []Match{{ID: 1, A1: 1, A2: 2, B1: 3, B2: 4}},
	}

	if startMatch(&state, 1, "court 1") {
		t.Fatal("expected non-adjacent level match to be rejected")
	}
	if len(state.Queue) != 1 || len(state.Live) != 0 {
		t.Fatalf("expected invalid match to stay queued and not start, queue=%#v live=%#v", state.Queue, state.Live)
	}
}

func TestCloseLiveWithoutWinnerDoesNotStoreWinLoss(t *testing.T) {
	state := SessionState{
		Players: []Player{
			{ID: 1, Name: "a1"},
			{ID: 2, Name: "a2"},
			{ID: 3, Name: "b1"},
			{ID: 4, Name: "b2"},
		},
		Live: []Match{{ID: 1, A1: 1, A2: 2, B1: 3, B2: 4, Shuttles: 1}},
	}

	if !closeLive(&state, 1, false, "", "") {
		t.Fatal("expected closeLive to close match")
	}
	if got := state.History[0].Winner; got != "" {
		t.Fatalf("expected empty winner, got %q", got)
	}
	for _, player := range state.Players {
		if player.Games != 1 || player.Shuttles != 1 {
			t.Fatalf("expected games/shuttles to be counted, got %#v", player)
		}
		if player.Wins != 0 || player.Losses != 0 {
			t.Fatalf("expected win/loss to stay zero, got %#v", player)
		}
	}
}

func TestCloseLiveWithDrawStoresResultAndDrawStats(t *testing.T) {
	state := SessionState{
		Players: []Player{
			{ID: 1, Name: "a1"},
			{ID: 2, Name: "a2"},
			{ID: 3, Name: "b1"},
			{ID: 4, Name: "b2"},
		},
		Live: []Match{{ID: 1, A1: 1, A2: 2, B1: 3, B2: 4, Shuttles: 2}},
	}

	if !closeLive(&state, 1, false, "", "draw") {
		t.Fatal("expected closeLive to close match")
	}
	if got := state.History[0].Winner; got != "draw" {
		t.Fatalf("expected draw winner marker, got %q", got)
	}
	for _, player := range state.Players {
		if player.Games != 1 || player.Shuttles != 2 {
			t.Fatalf("expected games/shuttles to be counted, got %#v", player)
		}
		if player.Draws != 1 {
			t.Fatalf("expected draw to be counted, got %#v", player)
		}
		if player.Wins != 0 || player.Losses != 0 {
			t.Fatalf("expected draw not to count win/loss, got %#v", player)
		}
	}
}

func TestCloseLiveResetsPlayerReadinessAfterFinishOnly(t *testing.T) {
	state := SessionState{
		Settings: Settings{ResetPlayersAfterFinish: true},
		Players: []Player{
			{ID: 1, Name: "a1", Coupon: true},
			{ID: 2, Name: "a2", Coupon: true},
			{ID: 3, Name: "b1", Coupon: true},
			{ID: 4, Name: "b2", Coupon: true},
			{ID: 5, Name: "waiting", Coupon: true},
		},
		Live: []Match{{ID: 1, A1: 1, A2: 2, B1: 3, B2: 4}},
	}

	if !closeLive(&state, 1, false, "", "") {
		t.Fatal("expected closeLive to finish match")
	}
	for _, player := range state.Players[:4] {
		if player.Coupon {
			t.Fatalf("expected match player %d to be not ready", player.ID)
		}
	}
	if !state.Players[4].Coupon {
		t.Fatal("expected waiting player to remain ready")
	}

	cancelState := SessionState{
		Settings: Settings{ResetPlayersAfterFinish: true},
		Players:  []Player{{ID: 1, Coupon: true}, {ID: 2, Coupon: true}, {ID: 3, Coupon: true}, {ID: 4, Coupon: true}},
		Live:     []Match{{ID: 1, A1: 1, A2: 2, B1: 3, B2: 4}},
	}
	if !closeLive(&cancelState, 1, true, "", "") {
		t.Fatal("expected closeLive to cancel match")
	}
	for _, player := range cancelState.Players {
		if !player.Coupon {
			t.Fatalf("expected cancelled match player %d to remain ready", player.ID)
		}
	}
}

func TestCoupledPlayersShareRandomStatus(t *testing.T) {
	state := SessionState{
		Players: []Player{
			{ID: 1, Level: "middle", Coupon: true},
			{ID: 2, Level: "heavy", Coupon: false},
		},
		Couples: []Couple{{ID: 1, A: 1, B: 2}},
	}

	syncNewCouple(&state, 1, 2)
	if state.Players[1].Level != "middle" || !state.Players[1].Coupon {
		t.Fatalf("expected new couple to sync from player 1, got %#v", state.Players[1])
	}

	state.Players[1].Level = "light"
	state.Players[1].Coupon = false
	syncCoupledPlayerStatus(&state, 2)
	if state.Players[0].Level != "light" || state.Players[0].Coupon {
		t.Fatalf("expected coupled status to sync back to player 1, got %#v", state.Players[0])
	}
}

func TestCrossLevelOnlyUsesAdjacentConfiguredLevels(t *testing.T) {
	state := SessionState{
		Settings: Settings{
			Levels:          []string{"light", "middle", "heavy"},
			AllowCrossLevel: true,
			CrossLevelRange: 5,
		},
		Players: []Player{
			{ID: 1, Active: true, Coupon: true, Level: "light"},
			{ID: 2, Active: true, Coupon: true, Level: "light"},
			{ID: 3, Active: true, Coupon: true, Level: "heavy"},
			{ID: 4, Active: true, Coupon: true, Level: "heavy"},
		},
	}

	if err := randomMatch(&state); err == nil {
		t.Fatalf("expected non-adjacent levels to wait, queued %#v", state.Queue)
	}
}

func TestCrossLevelCanBacktrackToFitCoupleGroup(t *testing.T) {
	state := SessionState{
		Settings: Settings{
			Levels:          []string{"light", "middle", "heavy"},
			AllowCrossLevel: true,
		},
		Couples: []Couple{{ID: 1, A: 1, B: 2}},
		Players: []Player{
			{ID: 1, Games: 8, Active: true, Coupon: true, Level: "middle"},
			{ID: 2, Games: 8, Active: true, Coupon: true, Level: "middle"},
			{ID: 3, Games: 1, Active: true, Coupon: true, Level: "middle"},
			{ID: 4, Games: 2, Active: true, Coupon: true, Level: "light"},
			{ID: 5, Games: 3, Active: true, Coupon: true, Level: "light"},
		},
	}

	if err := randomMatch(&state); err != nil {
		t.Fatalf("expected adjacent cross-level match with a couple to be created: %v", err)
	}
	if len(state.Pending) != 1 {
		t.Fatalf("expected one pending match, got %#v", state.Pending)
	}
	selected := matchPlayers(state.Pending[0])
	if !slices.Contains(selected, 1) || !slices.Contains(selected, 2) {
		t.Fatalf("expected couple to stay in selected match, got %#v", state.Pending[0])
	}
}

func TestAdjustShuttlesAssignsGlobalSequenceOnAdd(t *testing.T) {
	state := SessionState{
		Live: []Match{
			{ID: 1, A1: 1, A2: 2, B1: 3, B2: 4},
			{ID: 2, A1: 5, A2: 6, B1: 7, B2: 8},
		},
	}

	adjustShuttles(&state, 1, 1)
	adjustShuttles(&state, 2, 1)
	adjustShuttles(&state, 1, 1)
	adjustShuttles(&state, 1, -1)

	if state.Live[0].Shuttles != 2 || state.Live[0].ShuttleSeq != "1,3" {
		t.Fatalf("expected match 1 sequence 1,3, got %#v", state.Live[0])
	}
	if state.Live[1].Shuttles != 1 || state.Live[1].ShuttleSeq != "2" {
		t.Fatalf("expected match 2 sequence 2, got %#v", state.Live[1])
	}
}

func TestDeletePlayerHardDeletesUnreferencedPlayer(t *testing.T) {
	state := SessionState{
		Players: []Player{
			{ID: 1, Name: "new", Active: true},
			{ID: 2, Name: "kept", Active: true},
		},
	}

	if err := deletePlayer(&state, 1); err != nil {
		t.Fatalf("expected player delete to succeed: %v", err)
	}
	if len(state.Players) != 1 || state.Players[0].ID != 2 {
		t.Fatalf("expected unreferenced player to be removed, got %#v", state.Players)
	}
}

func TestDeletePlayerRejectsReferencedPlayer(t *testing.T) {
	state := SessionState{
		Players: []Player{{ID: 1, Name: "referenced", Active: true, Coupon: true}},
		History: []Match{
			{ID: 9, A1: 1, A2: 2, B1: 3, B2: 4},
		},
	}

	if err := deletePlayer(&state, 1); err == nil {
		t.Fatal("expected referenced player delete to be rejected")
	}
	if len(state.Players) != 1 || !state.Players[0].Active || !state.Players[0].Coupon {
		t.Fatalf("expected referenced player to remain unchanged, got %#v", state.Players)
	}
	reasons := playerDeleteBlockReasons(state, 1)
	if len(reasons) != 1 || reasons[0] != "history" {
		t.Fatalf("expected history delete block reason, got %#v", reasons)
	}
}

func TestCancelQueuedMatchMovesToCancelledHistory(t *testing.T) {
	state := SessionState{
		Players: []Player{
			{ID: 1, Games: 2, Wins: 1, Shuttles: 3},
			{ID: 2, Games: 2, Wins: 1, Shuttles: 3},
			{ID: 3, Games: 2, Losses: 1, Shuttles: 3},
			{ID: 4, Games: 2, Losses: 1, Shuttles: 3},
		},
		Queue: []Match{{ID: 14, Court: "-", Level: "middle", A1: 1, A2: 2, B1: 3, B2: 4}},
	}

	if !cancelQueuedMatch(&state, 14) {
		t.Fatal("expected queued match to cancel")
	}
	if len(state.Queue) != 0 || len(state.History) != 1 {
		t.Fatalf("expected queue to move into history, queue=%#v history=%#v", state.Queue, state.History)
	}
	cancelled := state.History[0]
	if cancelled.ID != 14 || cancelled.Status != "cancelled" || cancelled.Winner != "" || cancelled.Note != "ยกเลิกคิว" {
		t.Fatalf("unexpected cancelled history match: %#v", cancelled)
	}
	for _, player := range state.Players {
		if player.Games != 2 || player.Shuttles != 3 {
			t.Fatalf("expected cancelled queue not to change player stats, got %#v", player)
		}
	}
}

func TestUpdateHistoryWinnerRecalculatesPlayerResultStats(t *testing.T) {
	state := SessionState{
		Players: []Player{
			{ID: 1, Wins: 1},
			{ID: 2, Wins: 1},
			{ID: 3, Losses: 1},
			{ID: 4, Losses: 1},
		},
		History: []Match{{ID: 7, A1: 1, A2: 2, B1: 3, B2: 4, Winner: "A"}},
	}

	if !updateHistoryWinner(&state, 7, "draw") {
		t.Fatal("expected history winner update to succeed")
	}
	for _, player := range state.Players {
		if player.Draws != 1 || player.Wins != 0 || player.Losses != 0 {
			t.Fatalf("expected draw stats after result edit, got %#v", state.Players)
		}
	}
	if state.History[0].Winner != "draw" {
		t.Fatalf("expected history winner draw, got %q", state.History[0].Winner)
	}
}

func TestUpdateHistoryWinnerLeavesCancelledMatchNonScoring(t *testing.T) {
	state := SessionState{
		Players: []Player{{ID: 1}, {ID: 2}, {ID: 3}, {ID: 4}},
		History: []Match{{ID: 14, A1: 1, A2: 2, B1: 3, B2: 4, Status: "cancelled"}},
	}

	if !updateHistoryWinner(&state, 14, "A") {
		t.Fatal("expected cancelled history match to be found")
	}
	if state.History[0].Winner != "" {
		t.Fatalf("expected cancelled match winner to remain empty, got %q", state.History[0].Winner)
	}
	for _, player := range state.Players {
		if player.Wins != 0 || player.Draws != 0 || player.Losses != 0 {
			t.Fatalf("expected cancelled match not to score players, got %#v", state.Players)
		}
	}
}

func TestRealRecordedMatchCountExcludesCancelledHistory(t *testing.T) {
	state := SessionState{
		Queue: []Match{{ID: 15}},
		Live:  []Match{{ID: 16}},
		History: []Match{
			{ID: 13, Status: "finished"},
			{ID: 14, Status: "cancelled"},
		},
	}

	if got := realRecordedMatchCount(state); got != 2 {
		t.Fatalf("expected live + non-cancelled history count 2, got %d", got)
	}
}

func TestDashboardPayloadIncludesMenuSummaryOnly(t *testing.T) {
	state := SessionState{
		Settings: Settings{EntryFee: 100, ShuttleFee: 50, CourtNames: []string{"1", "2"}},
		Players: []Player{
			{ID: 1, Active: true, Games: 2, Shuttles: 3, Paid: true},
			{ID: 2, Active: true, Games: 0, Shuttles: 0, Paid: false},
		},
		Live: []Match{{ID: 12, Shuttles: 1}},
		History: []Match{
			{ID: 10, Shuttles: 2, Status: "finished"},
			{ID: 11, Status: "cancelled"},
		},
	}

	payload := dashboardPayload(state)
	summary := payload["summary"].(map[string]any)
	if summary["recordedMatches"] != 2 || summary["cancelledMatches"] != 1 {
		t.Fatalf("unexpected dashboard match summary: %#v", summary)
	}
	if summary["totalShuttles"] != 3 {
		t.Fatalf("expected live + real history shuttles 3, got %#v", summary["totalShuttles"])
	}
	if _, exists := payload["pending"]; exists {
		t.Fatal("dashboard payload should not include pending matches")
	}
}

func TestQueuePayloadIncludesPendingQueueAndCourtAvailability(t *testing.T) {
	state := SessionState{
		Settings: Settings{CourtNames: []string{"1", "2"}},
		Pending:  []Match{{ID: -1}},
		Queue:    []Match{{ID: 1}},
		Live:     []Match{{ID: 2, Court: "1"}},
		History:  []Match{{ID: 3}},
	}

	payload := queuePayload(state)
	if len(payload["pending"].([]Match)) != 1 || len(payload["queue"].([]Match)) != 1 {
		t.Fatalf("unexpected queue payload: %#v", payload)
	}
	available := payload["availableCourtNames"].([]string)
	if len(available) != 1 || available[0] != "2" {
		t.Fatalf("expected only court 2 available, got %#v", available)
	}
	if _, exists := payload["history"]; exists {
		t.Fatal("queue payload should not include history")
	}
}

func TestSessionValidityExpiresAfterThreeDays(t *testing.T) {
	state := defaultState("session-test", "test", "")
	applySessionValidity(&state, time.Now().UTC().Add(-73*time.Hour))
	if !state.Session.Expired {
		t.Fatal("expected session older than 72 hours to be expired")
	}

	applySessionValidity(&state, time.Now().UTC().Add(-71*time.Hour))
	if state.Session.Expired {
		t.Fatal("expected session younger than 72 hours to remain active")
	}
	if state.Session.CreatedAt == "" || state.Session.ExpiresAt == "" {
		t.Fatalf("expected created/expires labels to be set, got %#v", state.Session)
	}
}

func TestSupervisorRoutesReturnGone(t *testing.T) {
	a := &app{}
	req := httptest.NewRequest(http.MethodPost, "/api/supervisor/summary", nil)
	rec := httptest.NewRecorder()

	a.handleSupervisorSummary(rec, req)

	if rec.Code != http.StatusGone {
		t.Fatalf("expected supervisor summary to return 410, got %d", rec.Code)
	}
}
