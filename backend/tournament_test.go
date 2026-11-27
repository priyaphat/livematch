package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestCapacityCoinCost(t *testing.T) {
	for _, tc := range []struct{ capacity, free, per, want int }{{10, 20, 10, 0}, {20, 20, 10, 0}, {21, 20, 10, 10}, {40, 20, 10, 200}} {
		if got := capacityCoinCost(tc.capacity, tc.free, tc.per); got != tc.want {
			t.Fatalf("capacityCoinCost(%d,%d,%d)=%d want %d", tc.capacity, tc.free, tc.per, got, tc.want)
		}
	}
}

func TestTournamentDashboardPage(t *testing.T) {
	tests := []struct {
		page, size         string
		wantPage, wantSize int
	}{
		{"", "", 1, 5},
		{"0", "0", 1, 5},
		{"3", "20", 3, 20},
		{"2", "999", 2, 100},
	}
	for _, tc := range tests {
		page, size := tournamentDashboardPage(tc.page, tc.size)
		if page != tc.wantPage || size != tc.wantSize {
			t.Fatalf("tournamentDashboardPage(%q,%q)=(%d,%d) want (%d,%d)", tc.page, tc.size, page, size, tc.wantPage, tc.wantSize)
		}
	}
}

func TestTournamentRegistrationListPage(t *testing.T) {
	tests := []struct {
		page, size         string
		wantPage, wantSize int
	}{
		{"", "", 1, 10},
		{"0", "-1", 1, 10},
		{"3", "20", 3, 20},
		{"2", "999", 2, 100},
	}
	for _, tc := range tests {
		page, size := registrationListPage(tc.page, tc.size)
		if page != tc.wantPage || size != tc.wantSize {
			t.Fatalf("registrationListPage(%q,%q)=(%d,%d) want (%d,%d)", tc.page, tc.size, page, size, tc.wantPage, tc.wantSize)
		}
	}
}

func TestTournamentDashboardYear(t *testing.T) {
	for input, want := range map[string]int{"": 0, "all": 0, "1999": 0, "2026": 2026, "2201": 0} {
		if got := tournamentDashboardYear(input); got != want {
			t.Fatalf("tournamentDashboardYear(%q)=%d want %d", input, got, want)
		}
	}
}

func TestTournamentStaffPermissions(t *testing.T) {
	if !validTournamentStaffRole("score_staff") || validTournamentStaffRole("owner") {
		t.Fatal("staff role validation is incorrect")
	}
	permissions := tournamentStaffPermissions("registration_staff", map[string]bool{
		"checkIn":           false,
		"scoreMatch":        true,
		"manageSubAccounts": true,
		"unknown":           true,
	})
	if permissions["checkIn"] || !permissions["scoreMatch"] {
		t.Fatal("permission overrides were not applied")
	}
	if permissions["manageSubAccounts"] {
		t.Fatal("staff must not be allowed to manage sub-accounts")
	}
	if _, exists := permissions["unknown"]; exists {
		t.Fatal("unknown permission must be ignored")
	}
}

func TestTournamentScheduleTimes(t *testing.T) {
	startAt, endAt, err := tournamentScheduleTimes(map[string]any{
		"startDate": "2027-01-12", "startTime": "08:30",
		"endDate": "2027-01-13", "endTime": "20:45",
	})
	if err != nil {
		t.Fatal(err)
	}
	if startAt == nil || startAt.Format("2006-01-02 15:04 -0700") != "2027-01-12 08:30 +0700" {
		t.Fatalf("unexpected startAt: %v", startAt)
	}
	if endAt == nil || endAt.Format("2006-01-02 15:04 -0700") != "2027-01-13 20:45 +0700" {
		t.Fatalf("unexpected endAt: %v", endAt)
	}
	if _, _, err = tournamentScheduleTimes(map[string]any{
		"startDate": "2027-01-13", "startTime": "08:30",
		"endDate": "2027-01-12", "endTime": "20:45",
	}); err == nil {
		t.Fatal("end date before start date must be rejected")
	}
	if _, _, err = tournamentScheduleTimes(map[string]any{"startDate": "12/01/2027"}); err == nil {
		t.Fatal("invalid date must be rejected")
	}
}

func TestApplyTournamentScoreEvent(t *testing.T) {
	state := map[string]any{"sets": []any{map[string]any{"setNumber": 1, "scoreA": 20, "scoreB": 19}}}
	applyTournamentScoreEvent(state, "point", map[string]any{"team": "A"}, "Director")
	set := state["sets"].([]any)[0].(map[string]any)
	if set["scoreA"] != 21 {
		t.Fatalf("scoreA=%v want 21", set["scoreA"])
	}
	applyTournamentScoreEvent(state, "undo", map[string]any{"team": "A"}, "Director")
	if set["scoreA"] != 20 {
		t.Fatalf("undo scoreA=%v want 20", set["scoreA"])
	}
	applyTournamentScoreEvent(state, "correction_serve", map[string]any{"team": "B", "playerIndex": 0, "reason": "แก้ลำดับเริ่มต้น"}, "Director")
	if state["servingTeam"] != "B" {
		t.Fatalf("servingTeam=%v", state["servingTeam"])
	}
}

func TestTournamentDoublesServiceRotation(t *testing.T) {
	state := map[string]any{
		"status": "live", "currentSet": 1, "servingTeam": "A", "servingPlayerIndex": 0,
		"teamAPlayers": []any{"A1", "A2"}, "teamBPlayers": []any{"B1", "B2"},
		"courtPositions": map[string]any{"A": []any{0, 1}, "B": []any{0, 1}},
		"sets":           []any{map[string]any{"setNumber": 1, "scoreA": 0, "scoreB": 0}}, "timeline": []any{},
	}
	applyTournamentScoreEvent(state, "point_A", nil, "Director")
	if state["servingTeam"] != "A" || intValueForTournament(state["servingPlayerIndex"], -1) != 0 {
		t.Fatalf("after first service point server=%v/%v", state["servingTeam"], state["servingPlayerIndex"])
	}
	applyTournamentScoreEvent(state, "point_B", nil, "Director")
	if state["servingTeam"] != "B" || intValueForTournament(state["servingPlayerIndex"], -1) != 1 {
		t.Fatalf("service over must move to B right-court player, got %v/%v", state["servingTeam"], state["servingPlayerIndex"])
	}
	applyTournamentScoreEvent(state, "point_B", nil, "Director")
	if intValueForTournament(state["servingPlayerIndex"], -1) != 1 {
		t.Fatalf("B serving player must remain the same while winning consecutive rally, got %v", state["servingPlayerIndex"])
	}
	applyTournamentScoreEvent(state, "undo", nil, "Director")
	set := state["sets"].([]any)[0].(map[string]any)
	if intValueForTournament(set["scoreB"], -1) != 1 {
		t.Fatalf("undo must restore scoreB=1, got %v", set["scoreB"])
	}
}

func TestTournamentSinglesServiceAlwaysUsesOnlyPlayer(t *testing.T) {
	state := map[string]any{
		"format": "singles", "status": "scheduled", "currentSet": 1, "servingTeam": "A", "servingPlayerIndex": 0,
		"teamAPlayers": []any{"A1"}, "teamBPlayers": []any{"B1"},
		"courtPositions": map[string]any{"A": []any{0, 1}, "B": []any{0, 1}},
		"sets":           []any{map[string]any{"setNumber": 1, "scoreA": 0, "scoreB": 0}}, "timeline": []any{},
	}
	applyTournamentScoreEvent(state, "start_match", map[string]any{"serverTeam": "A", "serverPlayerIndex": 1}, "Director")
	if got := intValueForTournament(state["servingPlayerIndex"], -1); got != 0 {
		t.Fatalf("singles start must force player index 0, got %d", got)
	}
	applyTournamentScoreEvent(state, "point_B", nil, "Director")
	if state["servingTeam"] != "B" || intValueForTournament(state["servingPlayerIndex"], -1) != 0 {
		t.Fatalf("singles service-over must use B's only player: %+v", state)
	}
	applyTournamentScoreEvent(state, "point_B", nil, "Director")
	if intValueForTournament(state["servingPlayerIndex"], -1) != 0 {
		t.Fatalf("singles consecutive point changed to nonexistent player: %+v", state)
	}
	applyTournamentScoreEvent(state, "toggle_server", map[string]any{"team": "A"}, "Director")
	if state["servingTeam"] != "A" || intValueForTournament(state["servingPlayerIndex"], -1) != 0 {
		t.Fatalf("manual singles service toggle selected nonexistent player: %+v", state)
	}
}

func TestTournamentSinglesServeTimelineAndUndo(t *testing.T) {
	state := map[string]any{
		"format": "singles", "status": "scheduled", "currentSet": 1,
		"servingTeam": "A", "servingPlayerIndex": 1,
		"teamAName": "Team A", "teamBName": "Team B",
		"teamAPlayers": []any{"A1", "STALE A2"}, "teamBPlayers": []any{"B1", "STALE B2"},
		"courtPositions": map[string]any{"A": []any{1, 0}, "B": []any{1, 0}},
		"sets":           []any{map[string]any{"setNumber": 1, "scoreA": 0, "scoreB": 0}}, "timeline": []any{},
	}
	if got := tournamentTeamPlayerCount(state, "A"); got != 1 {
		t.Fatalf("singles format must be authoritative, player count=%d", got)
	}
	applyTournamentScoreEvent(state, "start_match", map[string]any{"serverTeam": "A", "serverPlayerIndex": 1}, "Director")
	if got := tournamentServeTimelineDetail(state); !strings.Contains(got, "ผู้เสิร์ฟ: A1 (ทีม A · ขวา · คู่)") || !strings.Contains(got, "ผู้รับ: B1 (ทีม B · ขวา · คู่)") {
		t.Fatalf("unexpected initial serve detail: %s", got)
	}
	if got := len(state["teamAPlayers"].([]any)); got != 1 {
		t.Fatalf("stale singles players were not normalized: %d", got)
	}

	applyTournamentScoreEvent(state, "point_A", nil, "Director")
	if got := tournamentServeTimelineDetail(state); !strings.Contains(got, "A1 (ทีม A · ซ้าย · คี่)") || !strings.Contains(got, "B1 (ทีม B · ซ้าย · คี่)") {
		t.Fatalf("1-0 must serve and receive from the odd court: %s", got)
	}
	applyTournamentScoreEvent(state, "point_B", nil, "Director")
	if got := tournamentServeTimelineDetail(state); !strings.Contains(got, "ผู้เสิร์ฟ: B1 (ทีม B · ซ้าย · คี่)") {
		t.Fatalf("1-1 service-over must move serve to B: %s", got)
	}
	applyTournamentScoreEvent(state, "point_A", nil, "Director")
	if got := tournamentServeTimelineDetail(state); !strings.Contains(got, "ผู้เสิร์ฟ: A1 (ทีม A · ขวา · คู่)") {
		t.Fatalf("2-1 service-over must move serve to A right court: %s", got)
	}

	applyTournamentScoreEvent(state, "toggle_server", map[string]any{"team": "B"}, "Director")
	if got := tournamentServeTimelineDetail(state); !strings.Contains(got, "ผู้เสิร์ฟ: B1 (ทีม B · ซ้าย · คี่)") {
		t.Fatalf("manual toggle must use B current score parity: %s", got)
	}
	applyTournamentScoreEvent(state, "undo", nil, "Director")
	if got := tournamentServeTimelineDetail(state); !strings.Contains(got, "ผู้เสิร์ฟ: A1 (ทีม A · ขวา · คู่)") {
		t.Fatalf("undo did not restore A serve: %s", got)
	}
	set := state["sets"].([]any)[0].(map[string]any)
	if intValueForTournament(set["scoreA"], -1) != 2 || intValueForTournament(set["scoreB"], -1) != 1 {
		t.Fatalf("undo of manual serve toggle must preserve score 2-1: %+v", set)
	}
	timeline := state["timeline"].([]any)
	latest := timeline[0].(map[string]any)
	if detail := stringValue(latest["detail"], ""); !strings.Contains(detail, "ผู้เสิร์ฟ:") || !strings.Contains(detail, "ผู้รับ:") {
		t.Fatalf("timeline must record server and receiver: %s", detail)
	}
}

func TestTournamentStartMatchUsesSelectedInitialServer(t *testing.T) {
	state := map[string]any{
		"status": "scheduled", "servingTeam": "A", "servingPlayerIndex": 0,
		"teamAPlayers": []any{"A1", "A2"}, "teamBPlayers": []any{"B1", "B2"},
		"courtPositions": map[string]any{"A": []any{0, 1}, "B": []any{0, 1}},
		"sets":           []any{map[string]any{"setNumber": 1, "scoreA": 0, "scoreB": 0}}, "timeline": []any{},
	}
	applyTournamentScoreEvent(state, "start_match", map[string]any{"serverTeam": "B", "serverPlayerIndex": 1}, "Director")
	if state["status"] != "live" || state["servingTeam"] != "B" || intValueForTournament(state["servingPlayerIndex"], -1) != 1 {
		t.Fatalf("selected initial server was not applied: %+v", state)
	}
	positions := tournamentCourtPositions(state)
	if positions["B"][0] != 1 {
		t.Fatalf("selected server must begin in the right service court, positions=%v", positions["B"])
	}
}

func TestTournamentManualServerSwapPersistsAfterFirstPoint(t *testing.T) {
	state := map[string]any{
		"stage": "group", "status": "live", "currentSet": 1,
		"servingTeam": "A", "servingPlayerIndex": 0,
		"teamAPlayers": []any{"A1", "A2"}, "teamBPlayers": []any{"B1", "B2"},
		"courtPositions": map[string]any{"A": []any{0, 1}, "B": []any{0, 1}},
		"sets":           []any{map[string]any{"setNumber": 1, "scoreA": 0, "scoreB": 0}}, "timeline": []any{},
	}
	applyTournamentScoreEvent(state, "toggle_server_player", map[string]any{"team": "A"}, "Director")
	if got := intValueForTournament(state["servingPlayerIndex"], -1); got != 1 {
		t.Fatalf("manual swap must select A2 before scoring, got index %d", got)
	}
	applyTournamentScoreEvent(state, "point_A", nil, "Director")
	if got := intValueForTournament(state["servingPlayerIndex"], -1); got != 1 {
		t.Fatalf("the manually selected server must keep serving after the first point, got index %d", got)
	}
	positions := tournamentCourtPositions(state)
	if positions["A"] != [2]int{0, 1} {
		t.Fatalf("court rotation after the point is inconsistent: %v", positions["A"])
	}
}

func TestTournamentReceiverSwapDoesNotChangeCurrentServer(t *testing.T) {
	state := map[string]any{
		"stage": "group", "status": "live", "currentSet": 1,
		"servingTeam": "A", "servingPlayerIndex": 0,
		"teamAPlayers": []any{"A1", "A2"}, "teamBPlayers": []any{"B1", "B2"},
		"courtPositions": map[string]any{"A": []any{0, 1}, "B": []any{0, 1}},
		"sets":           []any{map[string]any{"setNumber": 1, "scoreA": 0, "scoreB": 0}}, "timeline": []any{},
	}
	applyTournamentScoreEvent(state, "toggle_server_player", map[string]any{"team": "B"}, "Director")
	if state["servingTeam"] != "A" || intValueForTournament(state["servingPlayerIndex"], -1) != 0 {
		t.Fatalf("swapping receivers must not change the serving team/player: %+v", state)
	}
	if got := tournamentCourtPositions(state)["B"]; got != [2]int{1, 0} {
		t.Fatalf("receiver positions were not swapped: %v", got)
	}
}

func TestTournamentSetWinnerDeuceAndCap(t *testing.T) {
	match := map[string]any{"scoringRules": map[string]any{"pointsPerSet": 21, "maxCapPoint": 30, "winByTwo": true}}
	for _, tc := range []struct {
		a, b int
		want string
	}{{21, 20, ""}, {22, 20, "A"}, {29, 29, ""}, {30, 29, "A"}, {28, 30, "B"}} {
		if got := tournamentSetWinner(tc.a, tc.b, match); got != tc.want {
			t.Fatalf("tournamentSetWinner(%d,%d)=%q want %q", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestTournamentMatchWinnerUsesBestOfSets(t *testing.T) {
	match := map[string]any{
		"scoringRules": map[string]any{"bestOfSets": 3},
		"sets": []any{
			map[string]any{"setNumber": 1, "winner": "A"},
			map[string]any{"setNumber": 2, "winner": "B"},
			map[string]any{"setNumber": 3, "winner": "A"},
		},
	}
	if got := tournamentMatchWinnerFromSets(match); got != "A" {
		t.Fatalf("winner=%q want A", got)
	}
	match["scoringRules"] = map[string]any{"bestOfSets": 5}
	if got := tournamentMatchWinnerFromSets(match); got != "" {
		t.Fatalf("best-of-five must require three wins, got %q", got)
	}
	match["scoringRules"] = map[string]any{"bestOfSets": 2}
	match["stage"] = "group"
	match["sets"] = []any{
		map[string]any{"winner": "A", "scoreA": 21, "scoreB": 10},
		map[string]any{"winner": "B", "scoreA": 18, "scoreB": 21},
	}
	if got := tournamentMatchWinnerFromSets(match); got != "draw" {
		t.Fatalf("two-set format must keep a 1-1 result as a draw regardless of total points, got %q", got)
	}
}

func TestTournamentTwoSetDrawOnlyAllowedInGroupStage(t *testing.T) {
	group := map[string]any{"stage": "group"}
	if !tournamentMatchAllowsDraw(group) {
		t.Fatal("group-stage match must allow a draw")
	}
	knockout := map[string]any{"stage": "QF"}
	if tournamentMatchAllowsDraw(knockout) {
		t.Fatal("knockout match must not allow a draw")
	}
}

func TestTournamentTwoSetKnockoutCreatesDecidingSet(t *testing.T) {
	state := map[string]any{
		"stage": "QF", "status": "live", "currentSet": 2,
		"scoringRules": map[string]any{"bestOfSets": 2, "pointsPerSet": 21, "winByTwo": true, "maxCapPoint": 30},
		"sets": []any{
			map[string]any{"setNumber": 1, "scoreA": 21, "scoreB": 12, "winner": "A", "completed": true},
			map[string]any{"setNumber": 2, "scoreA": 15, "scoreB": 21},
		},
		"timeline": []any{},
	}
	applyTournamentScoreEvent(state, "end_set", nil, "Director")
	sets := state["sets"].([]any)
	if len(sets) != 3 || intValueForTournament(state["currentSet"], 0) != 3 || state["status"] != "live" {
		t.Fatalf("1-1 knockout result must create deciding set 3: %+v", state)
	}
}

func TestTournamentEndSetStopsCreatingSetsAfterMatchWon(t *testing.T) {
	state := map[string]any{
		"status": "live", "currentSet": 2,
		"scoringRules": map[string]any{"bestOfSets": 3},
		"sets": []any{
			map[string]any{"setNumber": 1, "scoreA": 21, "scoreB": 10, "winner": "A", "completed": true},
			map[string]any{"setNumber": 2, "scoreA": 21, "scoreB": 12},
		},
		"timeline": []any{},
	}
	applyTournamentScoreEvent(state, "end_set", nil, "Director")
	if len(state["sets"].([]any)) != 2 || state["status"] != "awaiting_confirmation" {
		t.Fatalf("winning set must await match confirmation without creating another set: %+v", state)
	}
}

func TestTournamentEndSetCreatesNextSetAfterFirstSet(t *testing.T) {
	state := map[string]any{
		"status": "live", "currentSet": 1,
		"scoringRules": map[string]any{"bestOfSets": 3, "pointsPerSet": 21, "winByTwo": true, "maxCapPoint": 30},
		"sets": []any{
			map[string]any{"setNumber": 1, "scoreA": 21, "scoreB": 18},
		},
		"timeline": []any{},
	}
	applyTournamentScoreEvent(state, "end_set", nil, "Director")
	sets := state["sets"].([]any)
	if len(sets) != 2 || intValueForTournament(state["currentSet"], 0) != 2 {
		t.Fatalf("first completed set must create and activate set 2: %+v", state)
	}
	first := sets[0].(map[string]any)
	second := sets[1].(map[string]any)
	if first["winner"] != "A" || second["scoreA"] != 0 || second["scoreB"] != 0 {
		t.Fatalf("unexpected set state after advancing: %+v", sets)
	}
}

func TestTournamentShuttleUsageNeverBecomesNegative(t *testing.T) {
	state := map[string]any{
		"status": "live", "currentSet": 1, "shuttlesUsed": 0,
		"sets":     []any{map[string]any{"setNumber": 1, "scoreA": 0, "scoreB": 0}},
		"timeline": []any{},
	}
	applyTournamentScoreEvent(state, "shuttle_remove", nil, "Director")
	if got := intValueForTournament(state["shuttlesUsed"], -1); got != 0 {
		t.Fatalf("shuttle count after removing from zero = %d, want 0", got)
	}
	applyTournamentScoreEvent(state, "shuttle_add", nil, "Director")
	applyTournamentScoreEvent(state, "shuttle_add", nil, "Director")
	applyTournamentScoreEvent(state, "shuttle_remove", nil, "Director")
	if got := intValueForTournament(state["shuttlesUsed"], -1); got != 1 {
		t.Fatalf("shuttle count = %d, want 1", got)
	}
}

func TestPublicTournamentSettingsUseAllowList(t *testing.T) {
	public := scrubPublicTournamentSettings(map[string]any{
		"name": "Open", "courts": []any{}, "paymentConfig": map[string]any{"slipOKKey": "secret"},
		"notificationConfig": map[string]any{"lineToken": "secret"}, "registrationConfig": map[string]any{"internal": true},
		"divisions": []any{
			map[string]any{"id": "open", "enabled": true},
			map[string]any{"id": "closed", "enabled": false},
		},
	})
	if public["name"] != "Open" {
		t.Fatal("public tournament name is missing")
	}
	for _, secret := range []string{"notificationConfig"} {
		if _, exists := public[secret]; exists {
			t.Fatalf("%s must not be exposed by public live APIs", secret)
		}
	}
	payment, _ := public["paymentConfig"].(map[string]any)
	if _, exposed := payment["slipOKKey"]; exposed {
		t.Fatal("payment provider credential must not be exposed")
	}
	divisions, _ := public["divisions"].([]any)
	if len(divisions) != 1 || stringValue(divisions[0].(map[string]any)["id"], "") != "open" {
		t.Fatalf("public APIs must expose enabled divisions only: %+v", divisions)
	}
}

func TestTournamentDrawSeedIsReproducible(t *testing.T) {
	teams := []tournamentDrawTeam{{ID: "1", Name: "A"}, {ID: "2", Name: "B"}, {ID: "3", Name: "C"}, {ID: "4", Name: "D"}}
	one := buildTournamentDrawSnapshot("t", "d", "single_elimination", "same-seed", teams, map[string]any{}, map[string]any{})
	two := buildTournamentDrawSnapshot("t", "d", "single_elimination", "same-seed", teams, map[string]any{}, map[string]any{})
	oneJSON, _ := json.Marshal(one["groups"])
	twoJSON, _ := json.Marshal(two["groups"])
	if string(oneJSON) != string(twoJSON) {
		t.Fatalf("same seed produced different team order: %s != %s", oneJSON, twoJSON)
	}
}

func TestTournamentRoundRobinPreviewKeepsAllThirtyTeams(t *testing.T) {
	teams := make([]tournamentDrawTeam, 0, 30)
	for index := 1; index <= 30; index++ {
		id := fmt.Sprintf("team-%02d", index)
		teams = append(teams, tournamentDrawTeam{
			ID: id, Name: id, Format: "doubles", Players: []string{id + "-A", id + "-B"},
			Payload: map[string]any{"id": id, "teamName": id},
		})
	}
	snapshot := buildTournamentDrawSnapshot("t", "d", "round_robin", "thirty-teams", teams, map[string]any{}, map[string]any{})
	groups, _ := snapshot["groups"].([]any)
	if len(groups) != 1 {
		t.Fatalf("round robin must create one group, got %d", len(groups))
	}
	group := groups[0].(map[string]any)
	if got := len(group["teams"].([]any)); got != 30 {
		t.Fatalf("preview lost teams: got %d want 30", got)
	}
	matches := snapshot["matches"].([]any)
	if got, want := len(matches), 30*29/2; got != want {
		t.Fatalf("round robin match count=%d want %d", got, want)
	}
	for _, raw := range matches {
		if stringValue(raw.(map[string]any)["format"], "") != "doubles" {
			t.Fatal("published doubles match must remain doubles")
		}
	}
}

func TestTournamentDivisionQuota(t *testing.T) {
	settings := map[string]any{"divisions": []any{
		map[string]any{"id": "limited", "enabled": true, "formats": []any{"doubles"}, "quotaDoubles": 16},
		map[string]any{"id": "open", "enabled": true, "formats": []any{"singles"}, "quotaSingles": "unlimited"},
	}}
	quota, unlimited, err := tournamentDivisionQuota(settings, "limited", "doubles")
	if err != nil || quota != 16 || unlimited {
		t.Fatalf("limited quota mismatch: quota=%d unlimited=%v err=%v", quota, unlimited, err)
	}
	_, unlimited, err = tournamentDivisionQuota(settings, "open", "singles")
	if err != nil || !unlimited {
		t.Fatalf("unlimited quota rejected: unlimited=%v err=%v", unlimited, err)
	}
	if _, _, err = tournamentDivisionQuota(settings, "limited", "singles"); err == nil {
		t.Fatal("format outside the division must be rejected")
	}
}

func TestTournamentSingleEliminationOnlyFirstRoundCanBeBye(t *testing.T) {
	teams := []tournamentDrawTeam{{ID: "1"}, {ID: "2"}, {ID: "3"}, {ID: "4"}, {ID: "5"}}
	matches := buildEliminationMatches("t", "d", teams, false)
	for _, raw := range matches {
		match := raw.(map[string]any)
		if match["isBye"] == true && stringValue(match["stage"], "") != "QF" {
			t.Fatalf("later round %v must wait for winners, not be marked as a BYE", match["stage"])
		}
	}
}

func TestTournamentExpectedQualifierCountUsesGroupsNotClientList(t *testing.T) {
	groups := map[string]map[string]bool{
		"A": {"a1": true, "a2": true, "a3": true, "a4": true},
		"B": {"b1": true, "b2": true, "b3": true, "b4": true},
		"C": {"c1": true, "c2": true, "c3": true, "c4": true},
		"D": {"d1": true, "d2": true, "d3": true, "d4": true},
	}
	if got, want := tournamentExpectedQualifierCount(groups, 1), 4; got != want {
		t.Fatalf("one qualifier from four groups = %d, want %d", got, want)
	}
	if got, want := tournamentExpectedQualifierCount(groups, 2), 8; got != want {
		t.Fatalf("two qualifiers from four groups = %d, want %d", got, want)
	}
}

func TestTournamentFourTeamKnockoutDoesNotCreateFifthEntrant(t *testing.T) {
	teams := []tournamentDrawTeam{{ID: "1"}, {ID: "2"}, {ID: "3"}, {ID: "4"}}
	matches := buildEliminationMatches("t", "four-team", teams, false)
	realEntrants := map[string]bool{}
	for _, raw := range matches {
		match := raw.(map[string]any)
		for _, key := range []string{"teamAId", "teamBId"} {
			id := stringValue(match[key], "")
			if id != "" {
				realEntrants[id] = true
			}
		}
	}
	if got, want := len(realEntrants), 4; got != want {
		t.Fatalf("knockout entrants = %d, want %d", got, want)
	}
}

func TestTournamentSinglesKnockoutKeepsFormatInFutureRounds(t *testing.T) {
	teams := []tournamentDrawTeam{
		{ID: "1", Format: "singles"},
		{ID: "2", Format: "singles"},
		{ID: "3", Format: "singles"},
		{ID: "4", Format: "singles"},
		{ID: "5", Format: "singles"},
		{ID: "6", Format: "singles"},
		{ID: "7", Format: "singles"},
		{ID: "8", Format: "singles"},
	}
	matches := buildEliminationMatches("t", "singles-eight", teams, false)
	stageCounts := map[string]int{}
	for _, raw := range matches {
		match := raw.(map[string]any)
		if got := stringValue(match["format"], ""); got != "singles" {
			t.Fatalf("%s format = %q, want singles", stringValue(match["matchCode"], ""), got)
		}
		stageCounts[stringValue(match["stage"], "")]++
	}
	if stageCounts["QF"] != 4 || stageCounts["SF"] != 2 || stageCounts["F"] != 1 {
		t.Fatalf("unexpected singles bracket stages: %#v", stageCounts)
	}
}

func TestTournamentSingleEliminationDistributesFiveTeamByes(t *testing.T) {
	teams := []tournamentDrawTeam{{ID: "1"}, {ID: "2"}, {ID: "3"}, {ID: "4"}, {ID: "5"}}
	matches := buildEliminationMatches("t", "d-five", teams, false)
	firstRound, byes := 0, 0
	for _, raw := range matches {
		match := raw.(map[string]any)
		if stringValue(match["stage"], "") != "QF" {
			continue
		}
		firstRound++
		aID, bID := stringValue(match["teamAId"], ""), stringValue(match["teamBId"], "")
		if aID == "" && bID == "" {
			t.Fatalf("first round contains an empty-vs-empty branch: %#v", match)
		}
		if aID == "" || bID == "" {
			byes++
		}
	}
	if firstRound != 4 || byes != 3 {
		t.Fatalf("first round/byes = %d/%d, want 4/3", firstRound, byes)
	}
}

func TestTournamentThirdPlaceMatchRoutesSemifinalLosers(t *testing.T) {
	teams := []tournamentDrawTeam{{ID: "1"}, {ID: "2"}, {ID: "3"}, {ID: "4"}}
	matches, added := addTournamentThirdPlaceMatch("t", "d-bronze", buildEliminationMatches("t", "d-bronze", teams, false))
	if !added {
		t.Fatal("expected third-place match to be added")
	}
	bronzeID := ""
	for _, raw := range matches {
		match := raw.(map[string]any)
		if stringValue(match["stage"], "") == "P3" {
			bronzeID = stringValue(match["id"], "")
		}
	}
	if bronzeID == "" {
		t.Fatal("third-place match missing")
	}
	semifinalRoutes := 0
	for _, raw := range matches {
		match := raw.(map[string]any)
		if stringValue(match["stage"], "") == "SF" && stringValue(match["nextLoserMatchId"], "") == bronzeID {
			semifinalRoutes++
		}
	}
	if semifinalRoutes != 2 {
		t.Fatalf("semifinal loser routes = %d, want 2", semifinalRoutes)
	}
}

func TestTournamentDoubleEliminationHasWinnerLoserAndResetRoutes(t *testing.T) {
	teams := []tournamentDrawTeam{{ID: "1"}, {ID: "2"}, {ID: "3"}, {ID: "4"}, {ID: "5"}, {ID: "6"}, {ID: "7"}, {ID: "8"}}
	matches := buildEliminationMatches("t", "d", teams, true)
	byStage := map[string][]map[string]any{}
	for _, raw := range matches {
		match := raw.(map[string]any)
		byStage[stringValue(match["stage"], "")] = append(byStage[stringValue(match["stage"], "")], match)
	}
	if len(byStage["GF"]) != 1 || len(byStage["GF_RESET"]) != 1 {
		t.Fatalf("double elimination must include grand final and conditional reset")
	}
	for _, quarterFinal := range byStage["QF"] {
		if stringValue(quarterFinal["nextMatchId"], "") == "" || stringValue(quarterFinal["nextLoserMatchId"], "") == "" {
			t.Fatalf("winners-bracket match must route both winner and loser: %+v", quarterFinal)
		}
	}
	grandFinal := byStage["GF"][0]
	if stringValue(grandFinal["resetMatchId"], "") != stringValue(byStage["GF_RESET"][0]["id"], "") {
		t.Fatalf("grand final reset link is missing")
	}
}

func TestValidatePublicTournamentRegistration(t *testing.T) {
	settings := map[string]any{
		"status":  "เปิดรับสมัคร",
		"endDate": "2027-01-15",
		"registrationConfig": map[string]any{
			"isOpen":            true,
			"openAt":            "2027-01-01T08:00",
			"closeAt":           "2027-01-10T20:00",
			"enableWaitingList": true,
		},
		"divisions": []any{map[string]any{
			"id": "open-double", "enabled": true, "formats": []any{"doubles"},
		}},
	}
	entry := map[string]any{"divisionId": "open-double", "format": "doubles", "pdpaConsent": true}
	now := time.Date(2027, 1, 5, 12, 0, 0, 0, time.FixedZone("Asia/Bangkok", 7*60*60))
	waiting, err := validatePublicTournamentRegistration(settings, entry, now)
	if err != nil || !waiting {
		t.Fatalf("valid registration rejected: waiting=%v err=%+v", waiting, err)
	}

	withoutConsent := map[string]any{"divisionId": "open-double", "format": "doubles", "pdpaConsent": false}
	if _, err = validatePublicTournamentRegistration(settings, withoutConsent, now); err == nil || err.Code != "pdpa_consent_required" {
		t.Fatalf("missing PDPA consent must be rejected, got %+v", err)
	}

	if _, err = validatePublicTournamentRegistration(settings, entry, now.AddDate(0, 0, 6)); err == nil || err.Code != "registration_closed" {
		t.Fatalf("late registration must be rejected, got %+v", err)
	}

	badDivision := map[string]any{"divisionId": "missing", "format": "doubles", "pdpaConsent": true}
	if _, err = validatePublicTournamentRegistration(settings, badDivision, now); err == nil || err.Code != "invalid_division" {
		t.Fatalf("invalid division must be rejected, got %+v", err)
	}
}

func TestNormalizeTournamentEntryMembersMatchesFormat(t *testing.T) {
	member := func(role string, consent bool) map[string]any {
		return map[string]any{
			"role": role, "firstName": "สมชาย", "lastName": "ใจดี", "phone": "0812345678", "pdpaConsent": consent,
		}
	}
	tests := []struct {
		name        string
		format      string
		members     []any
		wantCount   int
		wantErrCode string
	}{
		{name: "singles one person", format: "singles", members: []any{member("primary", true)}, wantCount: 1},
		{name: "singles rejects two people", format: "singles", members: []any{member("primary", true), member("partner", true)}, wantErrCode: "invalid_member_count"},
		{name: "doubles two people", format: "doubles", members: []any{member("primary", true), member("partner", true)}, wantCount: 2},
		{name: "doubles rejects one person", format: "doubles", members: []any{member("primary", true)}, wantErrCode: "invalid_member_count"},
		{name: "each person needs consent", format: "doubles", members: []any{member("primary", true), member("partner", false)}, wantErrCode: "member_pdpa_consent_required"},
		{name: "phone must contain ten digits", format: "singles", members: []any{map[string]any{"role": "primary", "firstName": "สมชาย", "lastName": "ใจดี", "phone": "08123", "pdpaConsent": true}}, wantErrCode: "member_phone_invalid"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			entry := map[string]any{"format": tc.format, "members": tc.members}
			members, err := normalizeTournamentEntryMembers(entry)
			if tc.wantErrCode != "" {
				if err == nil || err.Code != tc.wantErrCode {
					t.Fatalf("error=%+v want code %s", err, tc.wantErrCode)
				}
				return
			}
			if err != nil || len(members) != tc.wantCount {
				t.Fatalf("members=%d error=%+v want %d", len(members), err, tc.wantCount)
			}
		})
	}
}

func TestTournamentDirectorApplicationAvailability(t *testing.T) {
	zone := time.FixedZone("Asia/Bangkok", 7*60*60)
	now := time.Date(2026, 11, 26, 10, 0, 0, 0, zone)
	open := tournamentDirectorApplicationAvailability(map[string]any{
		"status": "เปิดรับสมัคร", "endDate": "2026-12-05", "endTime": "18:00",
	}, now)
	if open["isOpen"] != true {
		t.Fatalf("active tournament should accept director applications: %+v", open)
	}

	closed := tournamentDirectorApplicationAvailability(map[string]any{
		"status": "แข่งขันเสร็จแล้ว", "endDate": "2026-12-05",
	}, now)
	if closed["isOpen"] != false {
		t.Fatalf("finished tournament should reject director applications: %+v", closed)
	}

	past := tournamentDirectorApplicationAvailability(map[string]any{
		"status": "เปิดรับสมัคร", "endDate": "2026-11-25", "endTime": "23:59",
	}, now)
	if past["isOpen"] != false {
		t.Fatalf("past tournament should reject director applications: %+v", past)
	}
}

func TestTournamentCertificationLabel(t *testing.T) {
	if got := tournamentCertificationLabel("badminton_asia"); got != "Badminton Asia" {
		t.Fatalf("unexpected certification label: %q", got)
	}
	if got := tournamentCertificationLabel("made_up"); got != "" {
		t.Fatalf("unknown certification level must be rejected, got %q", got)
	}
}

func TestPublicTournamentMemberExposesRosterFieldsWithoutPII(t *testing.T) {
	eventDate := time.Date(2026, 11, 27, 0, 0, 0, 0, time.FixedZone("Asia/Bangkok", 7*60*60))
	member := publicTournamentMember(map[string]any{
		"firstName": "สมชาย", "lastName": "ใจดี", "nickname": "ชาย",
		"birthDate": "2000-12-01", "photoUrl": "/photo.jpg", "club": "สโมสรทดสอบ", "province": "เชียงใหม่",
		"phone": "0812345678", "email": "private@example.com", "healthInfo": "private",
	}, eventDate)
	if member["age"] != 25 {
		t.Fatalf("age=%v want 25 before birthday", member["age"])
	}
	for _, key := range []string{"phone", "email", "birthDate", "healthInfo"} {
		if _, exists := member[key]; exists {
			t.Fatalf("public roster exposed %s", key)
		}
	}
	if member["club"] != "สโมสรทดสอบ" || member["province"] != "เชียงใหม่" {
		t.Fatalf("public roster fields missing: %+v", member)
	}
}
