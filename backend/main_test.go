package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/makiuchi-d/gozxing"
	qrwriter "github.com/makiuchi-d/gozxing/qrcode"
)

func supportMultipartRequest(t *testing.T, fields map[string]string, files map[string][]byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatal(err)
		}
	}
	for name, content := range files {
		part, err := writer.CreateFormFile("images", name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/support-issues", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return request
}

func TestSlipOKQuotaAndVerification(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-authorization") != "secret-key" {
			t.Fatalf("missing SlipOK authorization header")
		}
		if strings.HasSuffix(r.URL.Path, "/quota") {
			writeJSON(w, http.StatusOK, map[string]any{
				"success": true,
				"data":    map[string]any{"quota": 80, "overQuota": 0},
			})
			return
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatal(err)
		}
		if r.FormValue("log") != "true" || r.FormValue("amount") != "100" {
			t.Fatalf("expected log and amount fields, got %#v", r.Form)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"success": true,
			"data": map[string]any{
				"success":        true,
				"message":        "OK",
				"transRef":       "TX-123",
				"transTimestamp": "2026-06-29T10:00:00.000Z",
				"amount":         100,
				"receiver":       map[string]any{"displayName": "LiveMatch"},
			},
		})
	}))
	defer server.Close()
	previous := slipOKAPIBaseURL
	slipOKAPIBaseURL = server.URL
	defer func() { slipOKAPIBaseURL = previous }()

	app := &app{}
	settings := slipOKSettings{Enabled: true, BranchID: "branch-1", APIKey: "secret-key", MonthlyCap: 100}
	quota := app.fetchSlipOKQuota(t.Context(), settings)
	if !quota.Available || quota.Used != 20 || quota.Remaining != 80 || quota.CapReached {
		t.Fatalf("unexpected SlipOK quota: %#v", quota)
	}
	result := app.checkSlipOK(t.Context(), settings, "data:image/png;base64,aGVsbG8=", 100)
	if !result.Passed || result.TransRef != "TX-123" || result.AmountTHB == nil || *result.AmountTHB != 100 {
		t.Fatalf("unexpected SlipOK result: %#v", result)
	}
}

func TestMaskSecret(t *testing.T) {
	if got := maskSecret("1234567890abcdef"); got != "1234••••••••cdef" {
		t.Fatalf("unexpected masked secret %q", got)
	}
	if got := maskSecret("short"); got != "••••••••" {
		t.Fatalf("short secret must be fully masked, got %q", got)
	}
}

func TestNormalizeSlipOKBranchID(t *testing.T) {
	for input, expected := range map[string]string{
		"70006": "70006",
		"https://api.slipok.com/api/line/apikey/70006":  "70006",
		"https://api.slipok.com/api/line/apikey/70006/": "70006",
	} {
		if got := normalizeSlipOKBranchID(input); got != expected {
			t.Fatalf("normalizeSlipOKBranchID(%q) = %q, want %q", input, got, expected)
		}
	}
}

func TestValidTelegramWebhookURLRequiresHTTPS(t *testing.T) {
	if validTelegramWebhookURL("http://localhost:5173/api/telegram/webhook/test") {
		t.Fatal("HTTP webhook URL must be rejected")
	}
	if !validTelegramWebhookURL("https://livematch.vibestudio.work/api/telegram/webhook/test") {
		t.Fatal("valid HTTPS webhook URL must be accepted")
	}
}

func TestSupportIssueValidation(t *testing.T) {
	app := &app{}
	tests := []struct {
		name   string
		fields map[string]string
		files  map[string][]byte
	}{
		{
			name:   "required fields",
			fields: map[string]string{"title": "", "details": "detail", "contact": "line"},
		},
		{
			name:   "too many images",
			fields: map[string]string{"title": "title", "details": "detail", "contact": "line"},
			files:  map[string][]byte{"1.png": {1}, "2.png": {1}, "3.png": {1}, "4.png": {1}, "5.png": {1}, "6.png": {1}},
		},
		{
			name:   "unsupported image",
			fields: map[string]string{"title": "title", "details": "detail", "contact": "line"},
			files:  map[string][]byte{"note.txt": []byte("not an image")},
		},
	}
	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := supportMultipartRequest(t, test.fields, test.files)
			request.RemoteAddr = fmt.Sprintf("192.0.2.%d:1234", index+1)
			response := httptest.NewRecorder()
			app.handleSupportIssues(response, request)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestSupportIssueRateLimit(t *testing.T) {
	ip := "198.51.100.10"
	now := time.Now()
	supportRateLimit.Lock()
	delete(supportRateLimit.entries, ip)
	supportRateLimit.Unlock()
	for attempt := 1; attempt <= 5; attempt++ {
		if !allowSupportSubmission(ip, now) {
			t.Fatalf("attempt %d should be allowed", attempt)
		}
	}
	if allowSupportSubmission(ip, now) {
		t.Fatal("sixth attempt should be rate limited")
	}
}

func TestSupportTelegramMessageIncludesIssueDetails(t *testing.T) {
	issue := supportIssue{
		ID:         "issue-123",
		Title:      "บันทึกไม่ได้",
		Details:    "หน้า setting ไม่ตอบสนอง",
		Contact:    "line: tester",
		ImageCount: 2,
	}
	text := supportTelegramText(issue)
	for _, expected := range []string{"issue-123", "บันทึกไม่ได้", "line: tester", "2 รูป", "หน้า setting ไม่ตอบสนอง"} {
		if !strings.Contains(text, expected) {
			t.Fatalf("expected Telegram message to contain %q, got %q", expected, text)
		}
	}
	keyboard := supportTelegramKeyboard()
	if keyboard["inline_keyboard"] == nil {
		t.Fatal("expected Backoffice inline keyboard")
	}
}

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

	if !closeLive(&state, 1, false, "", "B", false) {
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

	if !closeLive(&state, 1, false, "", "", false) {
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

	if !closeLive(&state, 1, false, "", "draw", false) {
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

	if !closeLive(&state, 1, false, "", "", false) {
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
	if !closeLive(&cancelState, 1, true, "", "", false) {
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

func TestReturnedShuttleIsReusedOnceBeforeNewNumbers(t *testing.T) {
	state := SessionState{
		Live: []Match{
			{ID: 3, Shuttles: 1, ShuttleSeq: "3"},
			{ID: 4},
		},
		History: []Match{
			{ID: 1, Shuttles: 1, ShuttleSeq: "1", Status: "finished"},
			{ID: 2, Shuttles: 1, ShuttleSeq: "2", Status: "cancelled", ShuttleReturned: true},
		},
	}

	adjustShuttles(&state, 4, 4)

	if got := state.Live[1].ShuttleSeq; got != "2,4,5,6" {
		t.Fatalf("expected returned shuttle 2 then new numbers 4,5,6, got %q", got)
	}
}

func TestReturnLatestShuttleReusesItBeforeContinuingSequence(t *testing.T) {
	state := SessionState{
		Live: []Match{
			{ID: 5, Shuttles: 2, ShuttleSeq: "5,6"},
			{ID: 6, Shuttles: 3, ShuttleSeq: "7,8,9"},
			{ID: 7},
		},
		History: []Match{{ID: 1, Shuttles: 4, ShuttleSeq: "1-4", Status: "finished"}},
	}

	number, ok := returnLatestShuttle(&state, 5)
	if !ok || number != 6 {
		t.Fatalf("expected shuttle 6 to return, got number=%d ok=%v", number, ok)
	}
	if state.Live[0].Shuttles != 1 || state.Live[0].ShuttleSeq != "5" {
		t.Fatalf("expected game 5 to retain shuttle 5, got %#v", state.Live[0])
	}
	adjustShuttles(&state, 7, 2)
	if got := state.Live[2].ShuttleSeq; got != "6,10" {
		t.Fatalf("expected game 7 sequence 6,10, got %q", got)
	}
	if _, ok := returnLatestShuttle(&state, 5); ok {
		t.Fatal("expected a game with one shuttle not to return another")
	}
}

func TestPaidPlayersAreExcludedFromAvailableGroups(t *testing.T) {
	state := SessionState{
		Players: []Player{
			{ID: 1, Active: true, Coupon: true, Paid: true},
			{ID: 2, Active: true, Coupon: true},
		},
	}
	groups := buildAvailableGroups(state, map[int]bool{})
	if len(groups) != 1 || len(groups[0].ids) != 1 || groups[0].ids[0] != 2 {
		t.Fatalf("expected only unpaid player 2, got %#v", groups)
	}
}

func TestReusedShuttleCanBeReturnedAgain(t *testing.T) {
	state := SessionState{
		Players: []Player{{ID: 1}, {ID: 2}, {ID: 3}, {ID: 4}},
		Live:    []Match{{ID: 4, A1: 1, A2: 2, B1: 3, B2: 4, Shuttles: 1, ShuttleSeq: "2"}},
		History: []Match{
			{ID: 2, Shuttles: 1, ShuttleSeq: "2", Status: "cancelled", ShuttleReturned: true},
			{ID: 3, Shuttles: 1, ShuttleSeq: "3", Status: "finished"},
		},
	}

	if !closeLive(&state, 4, true, "", "", true) {
		t.Fatal("expected live match to cancel")
	}
	state.Live = []Match{{ID: 5}}
	adjustShuttles(&state, 5, 1)

	if got := state.Live[0].ShuttleSeq; got != "2" {
		t.Fatalf("expected shuttle 2 to be available again, got %q", got)
	}
}

func TestCancelledMatchWithoutReturnChargesShuttleButNotGame(t *testing.T) {
	state := SessionState{
		Players: []Player{{ID: 1}, {ID: 2}, {ID: 3}, {ID: 4}},
		Live:    []Match{{ID: 1, A1: 1, A2: 2, B1: 3, B2: 4, Shuttles: 1, ShuttleSeq: "1"}},
	}

	if !closeLive(&state, 1, true, "", "", false) {
		t.Fatal("expected live match to cancel")
	}

	for _, player := range state.Players {
		if player.Games != 0 || player.Shuttles != 1 {
			t.Fatalf("expected player to receive shuttle charge without a game, got %#v", player)
		}
	}
	if got := totalRealShuttles(state); got != 1 {
		t.Fatalf("expected cancelled non-returned shuttle in total, got %d", got)
	}
}

func TestCancelledMatchWithReturnDoesNotChargeShuttle(t *testing.T) {
	state := SessionState{
		Players: []Player{{ID: 1}, {ID: 2}, {ID: 3}, {ID: 4}},
		Live:    []Match{{ID: 1, A1: 1, A2: 2, B1: 3, B2: 4, Shuttles: 1, ShuttleSeq: "1"}},
	}

	if !closeLive(&state, 1, true, "", "", true) {
		t.Fatal("expected live match to cancel")
	}

	for _, player := range state.Players {
		if player.Games != 0 || player.Shuttles != 0 {
			t.Fatalf("expected returned shuttle not to affect player, got %#v", player)
		}
	}
	if got := totalRealShuttles(state); got != 0 {
		t.Fatalf("expected returned shuttle excluded from total, got %d", got)
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
	if !state.Session.Expired || !state.Session.ReadOnly || state.Session.ReadOnlyReason != "three_days" {
		t.Fatalf("expected session older than 72 hours to be readonly by three_days, got %#v", state.Session)
	}

	applySessionValidity(&state, time.Now().UTC().Add(-71*time.Hour))
	if state.Session.Expired || state.Session.ReadOnly {
		t.Fatalf("expected session younger than 72 hours to remain active, got %#v", state.Session)
	}
	if state.Session.CreatedAt == "" || state.Session.ExpiresAt == "" {
		t.Fatalf("expected created/expires labels to be set, got %#v", state.Session)
	}
}

func TestSessionReadOnlyAfterPaidCompleteOneDay(t *testing.T) {
	state := defaultState("session-test", "test", "")
	state.Players = []Player{
		{ID: 1, Active: true, Paid: true},
		{ID: 2, Active: true, Paid: true},
		{ID: 3, Active: false, Paid: false},
	}
	applySessionReadOnly(&state, time.Now().UTC().Add(-25*time.Hour))
	if !state.Session.ReadOnly || !state.Session.Expired || state.Session.ReadOnlyReason != "paid_complete_24h" {
		t.Fatalf("expected all-paid session older than 24 hours to be readonly, got %#v", state.Session)
	}
}

func TestSessionStaysWritableBeforePaidCompleteOneDay(t *testing.T) {
	state := defaultState("session-test", "test", "")
	state.Players = []Player{
		{ID: 1, Active: true, Paid: true},
		{ID: 2, Active: true, Paid: true},
	}
	applySessionReadOnly(&state, time.Now().UTC().Add(-23*time.Hour))
	if state.Session.ReadOnly || state.Session.Expired {
		t.Fatalf("expected all-paid session younger than 24 hours to stay writable, got %#v", state.Session)
	}
}

func TestSessionStaysWritableAfterOneDayWithUnpaidPlayers(t *testing.T) {
	state := defaultState("session-test", "test", "")
	state.Players = []Player{
		{ID: 1, Active: true, Paid: true},
		{ID: 2, Active: true, Paid: false},
	}
	applySessionReadOnly(&state, time.Now().UTC().Add(-25*time.Hour))
	if state.Session.ReadOnly || state.Session.Expired {
		t.Fatalf("expected unpaid session older than 24 hours to stay writable, got %#v", state.Session)
	}
}

func TestSessionPaidCompleteRequiresActivePlayers(t *testing.T) {
	state := defaultState("session-test", "test", "")
	state.Players = []Player{{ID: 1, Active: false, Paid: true}}
	applySessionReadOnly(&state, time.Now().UTC().Add(-25*time.Hour))
	if state.Session.ReadOnly || state.Session.Expired {
		t.Fatalf("expected session without active players to stay writable before 72 hours, got %#v", state.Session)
	}
}

func TestTelegramWebhookURLUsesPublicBaseURL(t *testing.T) {
	t.Setenv("APP_BASE_URL", "https://livematch.vibestudio.work/")
	got := telegramWebhookURL(telegramNotifySettings{WebhookSecret: "secret-123"})
	want := "https://livematch.vibestudio.work/api/telegram/webhook/secret-123"
	if got != want {
		t.Fatalf("expected webhook URL %q, got %q", want, got)
	}
}

func TestParseTelegramOrderActionKeepsApprovalFormat(t *testing.T) {
	status, orderID, ok := parseTelegramOrderAction("coin:approved:order-123")
	if !ok || status != "approved" || orderID != "order-123" {
		t.Fatalf("expected approved callback to parse, got status=%q orderID=%q ok=%v", status, orderID, ok)
	}
	if _, _, ok := parseTelegramOrderAction("coin:paid:order-123"); ok {
		t.Fatal("expected unknown callback action to be rejected")
	}
}

func TestTelegramCoinOrderTextIncludesVerificationReason(t *testing.T) {
	t.Setenv("APP_BASE_URL", "https://livematch.example")
	text := telegramCoinOrderText(coinPurchaseOrder{
		ID:                 "order-1",
		PackageID:          "starter",
		PriceTHB:           100,
		Coins:              120,
		TransRef:           "REF123",
		VerificationStatus: "warning",
		VerificationNote:   "ยอดเงินไม่ตรงกับแพ็กเกจ",
		Note:               "ตรวจสอบกับลูกค้าแล้ว",
		Status:             "pending",
	}, adminUser{Email: "admin@example.com"})

	for _, expected := range []string{"Reason: ยอดเงินไม่ตรงกับแพ็กเกจ", "Review note: ตรวจสอบกับลูกค้าแล้ว"} {
		if !strings.Contains(text, expected) {
			t.Fatalf("expected Telegram message to contain %q, got %q", expected, text)
		}
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

func TestPromptPayPayloadIncludesAmountAndValidCRC(t *testing.T) {
	payload, err := promptPayPayload(promptPaySettings{ID: "0812345678", Type: "mobile"}, 149)
	if err != nil {
		t.Fatalf("promptPayPayload returned error: %v", err)
	}
	if !strings.Contains(payload, "5406149.00") {
		t.Fatalf("expected payload to contain THB amount 149.00, got %q", payload)
	}
	if !strings.HasSuffix(payload[:len(payload)-4], "6304") {
		t.Fatalf("expected payload to contain CRC tag, got %q", payload)
	}
	expectedCRC := crc16CCITT(payload[:len(payload)-4])
	if got := payload[len(payload)-4:]; got != expectedCRC {
		t.Fatalf("expected CRC %s, got %s in %q", expectedCRC, got, payload)
	}
}

func TestParseSlipQRPayloadExtractsAmountAndTransRef(t *testing.T) {
	payload := "00020101021229370016A0000006770101110113006681234567853037645406100.005802TH transRef=ABCDEF1234567890"
	parsed := parseSlipQRPayload(payload)
	if parsed.AmountTHB == nil || *parsed.AmountTHB != 100 {
		t.Fatalf("expected amount 100, got %#v", parsed.AmountTHB)
	}
	if parsed.TransRef != "ABCDEF1234567890" {
		t.Fatalf("expected transRef ABCDEF1234567890, got %q", parsed.TransRef)
	}
	if parsed.Receiver == "" {
		t.Fatal("expected receiver to be parsed from merchant tag")
	}
}

func TestParseThaiSlipQRPayloadExtractsNestedTransRef(t *testing.T) {
	payload := "0046000600000101030340225MPI00119399536174058767155102TH9104A954"
	parsed := parseSlipQRPayload(payload)
	if parsed.TransRef != "MPI0011939953617405876715" {
		t.Fatalf("expected nested MPI transRef, got %q", parsed.TransRef)
	}
	if parsed.AmountTHB != nil {
		t.Fatalf("expected no amount because this slip QR has no amount tag, got %#v", parsed.AmountTHB)
	}
}

func TestInspectSlipVerificationFlagsAmountMismatch(t *testing.T) {
	payload := "00020101021229370016A000000677010111011300668123456785303764540580.005802TH transRef=ABCDEF1234567890"
	check := inspectSlipImage(qrDataURL(t, payload), 100, promptPaySettings{ID: "0812345678", Type: "mobile"}, time.Now())
	if check.VerificationStatus != "warning" || !strings.Contains(check.VerificationNote, "ไม่ตรง") {
		t.Fatalf("expected warning mismatch verification, got %#v", check)
	}
	if check.TransRef != "ABCDEF1234567890" {
		t.Fatalf("expected decoded transRef, got %q", check.TransRef)
	}
}

func qrDataURL(t *testing.T, payload string) string {
	t.Helper()
	matrix, err := qrwriter.NewQRCodeWriter().Encode(payload, gozxing.BarcodeFormat_QR_CODE, 240, 240, nil)
	if err != nil {
		t.Fatalf("encode QR: %v", err)
	}
	img := image.NewRGBA(image.Rect(0, 0, matrix.GetWidth(), matrix.GetHeight()))
	for y := 0; y < matrix.GetHeight(); y++ {
		for x := 0; x < matrix.GetWidth(); x++ {
			if matrix.Get(x, y) {
				img.Set(x, y, color.Black)
			} else {
				img.Set(x, y, color.White)
			}
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode PNG: %v", err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}
