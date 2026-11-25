package main

import (
	"encoding/json"
	"fmt"
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
			"role": role, "firstName": "สมชาย", "lastName": "ใจดี", "pdpaConsent": consent,
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
