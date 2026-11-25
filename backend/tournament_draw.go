package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"fmt"
	mathrand "math/rand"
	"net/http"
	"sort"
	"strings"
	"time"
)

type tournamentDrawTeam struct {
	ID, Name, Club, Format string
	Players                []string
	Payload                map[string]any
}

func (a *app) tournamentDrawPreview(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireTournamentPrincipal(w, r, "drawBracket")
	if !ok {
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]string{"error": "method not allowed"})
		return
	}
	var body map[string]any
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid json"})
		return
	}
	tournamentID := stringValue(body["tournamentId"], "")
	divisionID := stringValue(body["divisionId"], "")
	if tournamentID == "" || divisionID == "" {
		writeJSON(w, 400, map[string]string{"error": "tournamentId และ divisionId จำเป็น"})
		return
	}
	var settingsRaw []byte
	if a.db.QueryRowContext(r.Context(), `select settings from tournaments where id=$1 and admin_id=$2 and archived_at is null`, tournamentID, p.AdminID).Scan(&settingsRaw) != nil {
		writeJSON(w, 404, map[string]string{"error": "ไม่พบรายการแข่งขัน"})
		return
	}
	settings := map[string]any{}
	_ = json.Unmarshal(settingsRaw, &settings)
	drawSystem := stringValue(body["drawSystem"], stringValue(settings["drawSystem"], "group_then_knockout"))
	seed := stringValue(body["seed"], randHex(16))
	teams, fingerprint, err := a.tournamentEligibleDrawTeams(r.Context(), p.AdminID, tournamentID, divisionID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	if len(teams) < 2 {
		writeJSON(w, 409, map[string]string{"error": "ต้องมีผู้สมัครที่ผ่านเงื่อนไขอย่างน้อย 2 ทีม", "code": "insufficient_entrants"})
		return
	}
	snapshot := buildTournamentDrawSnapshot(tournamentID, divisionID, drawSystem, seed, teams, body, settings)
	previewID := "draw-preview-" + randHex(10)
	raw, _ := json.Marshal(snapshot)
	if _, err = a.db.ExecContext(r.Context(), `insert into tournament_draw_previews(id,tournament_id,admin_id,division_id,draw_system,random_seed,entrants_fingerprint,snapshot,created_by,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '30 minutes')`, previewID, tournamentID, p.AdminID, divisionID, drawSystem, seed, fingerprint, raw, p.ActorID); err != nil {
		writeJSON(w, 500, map[string]string{"error": "สร้างตัวอย่างสายไม่สำเร็จ"})
		return
	}
	snapshot["previewId"], snapshot["expiresAt"] = previewID, time.Now().Add(30*time.Minute).UTC().Format(time.RFC3339)
	writeJSON(w, 200, snapshot)
}

func (a *app) tournamentDrawPublishPreview(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireTournamentPrincipal(w, r, "drawBracket")
	if !ok {
		return
	}
	var body map[string]any
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&body) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid json"})
		return
	}
	previewID := stringValue(body["previewId"], "")
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var tournamentID, divisionID, seed, fingerprint string
	var snapshotRaw []byte
	if tx.QueryRowContext(r.Context(), `select tournament_id,division_id,random_seed,entrants_fingerprint,snapshot from tournament_draw_previews where id=$1 and admin_id=$2 and expires_at>now() for update`, previewID, p.AdminID).Scan(&tournamentID, &divisionID, &seed, &fingerprint, &snapshotRaw) != nil {
		writeJSON(w, 409, map[string]string{"error": "ตัวอย่างสายหมดอายุหรือไม่พบ", "code": "preview_expired"})
		return
	}
	_, currentFingerprint, _ := a.tournamentEligibleDrawTeams(r.Context(), p.AdminID, tournamentID, divisionID)
	if currentFingerprint != fingerprint {
		writeJSON(w, 409, map[string]string{"error": "รายชื่อผู้สมัครเปลี่ยนหลังจาก Preview กรุณาสุ่มใหม่", "code": "entrants_changed"})
		return
	}
	var started bool
	_ = tx.QueryRowContext(r.Context(), `select exists(select 1 from tournament_matches where tournament_id=$1 and admin_id=$2 and status in ('live','finished','walkover','retired'))`, tournamentID, p.AdminID).Scan(&started)
	if started {
		writeJSON(w, 409, map[string]string{"error": "มีการแข่งขันเริ่มแล้ว ไม่สามารถ Publish สายใหม่", "code": "match_already_started"})
		return
	}
	snapshot := map[string]any{}
	_ = json.Unmarshal(snapshotRaw, &snapshot)
	var version int
	_ = tx.QueryRowContext(r.Context(), `select coalesce(max(version),0)+1 from tournament_draw_revisions where tournament_id=$1 and admin_id=$2 and coalesce(division_id,'')=$3`, tournamentID, p.AdminID, divisionID).Scan(&version)
	locked, _ := body["lockAfterPublish"].(bool)
	if _, err = tx.ExecContext(r.Context(), `insert into tournament_draw_revisions(tournament_id,admin_id,division_id,version,random_seed,snapshot,locked,created_by,published_at) values($1,$2,$3,$4,$5,$6,$7,$8,now())`, tournamentID, p.AdminID, divisionID, version, seed, snapshotRaw, locked, p.ActorID); err != nil {
		writeJSON(w, 409, map[string]string{"error": err.Error()})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `delete from tournament_matches where tournament_id=$1 and admin_id=$2 and division_id=$3`, tournamentID, p.AdminID, divisionID); err != nil {
		writeJSON(w, 500, map[string]string{"error": "ล้างสายเดิมไม่สำเร็จ"})
		return
	}
	matches, _ := snapshot["matches"].([]any)
	for _, rawMatch := range matches {
		match, _ := rawMatch.(map[string]any)
		id := stringValue(match["id"], "match-"+randHex(8))
		payload, _ := json.Marshal(match)
		if _, err = tx.ExecContext(r.Context(), `insert into tournament_matches(id,tournament_id,admin_id,division_id,match_code,stage,status,next_match_id,next_match_slot,payload,locked) values($1,$2,$3,$4,$5,$6,$7,nullif($8,''),nullif($9,''),$10,$11)`, id, tournamentID, p.AdminID, divisionID, stringValue(match["matchCode"], id), stringValue(match["stage"], "group"), stringValue(match["status"], "scheduled"), stringValue(match["nextMatchId"], ""), stringValue(match["nextMatchSlot"], ""), payload, locked); err != nil {
			writeJSON(w, 409, map[string]string{"error": err.Error()})
			return
		}
	}
	// Resolve first-round BYEs only after every match exists, so advancement is
	// performed through the same transactional path as a completed match.
	for _, rawMatch := range matches {
		match, _ := rawMatch.(map[string]any)
		isBye, _ := match["isBye"].(bool)
		if !isBye {
			continue
		}
		aID, bID := stringValue(match["teamAId"], ""), stringValue(match["teamBId"], "")
		if (aID == "") == (bID == "") {
			continue
		}
		if aID != "" {
			match["winner"] = "A"
		} else {
			match["winner"] = "B"
		}
		match["locked"] = true
		byeRaw, _ := json.Marshal(match)
		if _, err = tx.ExecContext(r.Context(), `update tournament_matches set payload=$2,status='walkover',locked=true,ended_at=now(),version=version+1,updated_at=now() where id=$1`, stringValue(match["id"], ""), byeRaw); err != nil {
			writeJSON(w, 500, map[string]string{"error": "เลื่อนทีมที่ได้ BYE ไม่สำเร็จ"})
			return
		}
		if err = advanceTournamentMatchTx(r.Context(), tx, p.AdminID, tournamentID, match); err != nil {
			writeJSON(w, 500, map[string]string{"error": "เชื่อมสาย BYE ไม่สำเร็จ"})
			return
		}
	}
	if assignments, ok := snapshot["groupAssignments"].([]any); ok {
		for _, rawAssignment := range assignments {
			assignment, _ := rawAssignment.(map[string]any)
			entryID := stringValue(assignment["playerId"], "")
			var entryRaw []byte
			if tx.QueryRowContext(r.Context(), `select payload from tournament_entries where id=$1 and admin_id=$2 for update`, entryID, p.AdminID).Scan(&entryRaw) == nil {
				entry := map[string]any{}
				_ = json.Unmarshal(entryRaw, &entry)
				entry["groupName"] = assignment["groupName"]
				delete(entry, "seed")
				next, _ := json.Marshal(entry)
				_, _ = tx.ExecContext(r.Context(), `update tournament_entries set payload=$3,seed=null,group_name=$4,version=version+1,updated_at=now() where id=$1 and admin_id=$2`, entryID, p.AdminID, next, assignment["groupName"])
			}
		}
	}
	_, _ = tx.ExecContext(r.Context(), `delete from tournament_draw_previews where id=$1`, previewID)
	_ = insertTournamentRealtimeEventTx(r.Context(), tx, p.AdminID, tournamentID, "", "draw_published", map[string]any{"tournamentId": tournamentID, "divisionId": divisionID, "version": version})
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": "Publish สายไม่สำเร็จ"})
		return
	}
	a.tournamentAudit(r.Context(), p, tournamentID, "PUBLISH_DRAW", "draw", divisionID, "", map[string]any{"version": version, "seed": seed, "previewId": previewID})
	writeJSON(w, 201, map[string]any{"version": version, "seed": seed, "status": "published", "matchCount": len(matches)})
}

func (a *app) tournamentDrawAdvanceKnockout(w http.ResponseWriter, r *http.Request) {
	p, ok := a.requireTournamentPrincipal(w, r, "drawBracket")
	if !ok {
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]string{"error": "method not allowed"})
		return
	}
	var body struct {
		TournamentID string   `json:"tournamentId"`
		DivisionID   string   `json:"divisionId"`
		TeamIDs      []string `json:"teamIds"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&body) != nil || body.TournamentID == "" || body.DivisionID == "" {
		writeJSON(w, 400, map[string]string{"error": "ข้อมูลสร้างสาย Knockout ไม่ถูกต้อง"})
		return
	}
	seen := map[string]bool{}
	requested := []string{}
	for _, id := range body.TeamIDs {
		id = strings.TrimSpace(id)
		if id != "" && !seen[id] {
			seen[id] = true
			requested = append(requested, id)
		}
	}
	if len(requested) < 2 {
		writeJSON(w, 409, map[string]string{"error": "ต้องมีทีมผ่านเข้ารอบอย่างน้อย 2 ทีม", "code": "insufficient_qualifiers"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(r.Context(), `select payload,status from tournament_matches where admin_id=$1 and tournament_id=$2 and division_id=$3 and stage='group' for update`, p.AdminID, body.TournamentID, body.DivisionID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "อ่านผลรอบแบ่งกลุ่มไม่สำเร็จ"})
		return
	}
	available := map[string]tournamentDrawTeam{}
	unfinished := 0
	for rows.Next() {
		var raw []byte
		var status string
		if rows.Scan(&raw, &status) != nil {
			continue
		}
		if status != "finished" && status != "walkover" && status != "retired" && status != "disqualified" {
			unfinished++
		}
		match := map[string]any{}
		_ = json.Unmarshal(raw, &match)
		for _, side := range []string{"A", "B"} {
			prefix := "team" + side
			id := stringValue(match[prefix+"Id"], "")
			if id == "" {
				continue
			}
			players := []string{}
			if list, ok := match[prefix+"Players"].([]any); ok {
				for _, player := range list {
					players = append(players, fmt.Sprint(player))
				}
			}
			available[id] = tournamentDrawTeam{ID: id, Name: stringValue(match[prefix+"Name"], id), Club: stringValue(match[prefix+"Club"], "อิสระ"), Players: players}
		}
	}
	rows.Close()
	if unfinished > 0 {
		writeJSON(w, 409, map[string]any{"error": "รอบแบ่งกลุ่มยังแข่งขันไม่ครบ", "code": "group_matches_incomplete", "unfinishedMatches": unfinished})
		return
	}
	qualified := make([]tournamentDrawTeam, 0, len(requested))
	for _, id := range requested {
		team, exists := available[id]
		if !exists {
			writeJSON(w, 409, map[string]string{"error": "พบทีมที่ไม่ได้อยู่ในรอบแบ่งกลุ่ม", "code": "invalid_qualifier"})
			return
		}
		qualified = append(qualified, team)
	}
	var knockoutStarted bool
	_ = tx.QueryRowContext(r.Context(), `select exists(select 1 from tournament_matches where admin_id=$1 and tournament_id=$2 and division_id=$3 and stage<>'group' and status in ('live','finished','walkover','retired','disqualified'))`, p.AdminID, body.TournamentID, body.DivisionID).Scan(&knockoutStarted)
	if knockoutStarted {
		writeJSON(w, 409, map[string]string{"error": "สาย Knockout เริ่มแข่งขันแล้ว ไม่สามารถสร้างใหม่", "code": "knockout_already_started"})
		return
	}
	seed := randHex(16)
	matches := buildEliminationMatches(body.TournamentID, body.DivisionID, qualified, false)
	snapshot := map[string]any{"tournamentId": body.TournamentID, "divisionId": body.DivisionID, "drawSystem": "group_then_knockout", "stageType": "knockout", "seed": seed, "qualifiedTeamIds": requested, "matches": matches}
	snapshotRaw, _ := json.Marshal(snapshot)
	var version int
	_ = tx.QueryRowContext(r.Context(), `select coalesce(max(version),0)+1 from tournament_draw_revisions where tournament_id=$1 and admin_id=$2 and coalesce(division_id,'')=$3`, body.TournamentID, p.AdminID, body.DivisionID).Scan(&version)
	if _, err = tx.ExecContext(r.Context(), `insert into tournament_draw_revisions(tournament_id,admin_id,division_id,version,random_seed,snapshot,locked,created_by,published_at) values($1,$2,$3,$4,$5,$6,false,$7,now())`, body.TournamentID, p.AdminID, body.DivisionID, version, seed, snapshotRaw, p.ActorID); err != nil {
		writeJSON(w, 409, map[string]string{"error": "บันทึก Revision ไม่สำเร็จ"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `delete from tournament_matches where admin_id=$1 and tournament_id=$2 and division_id=$3 and stage<>'group'`, p.AdminID, body.TournamentID, body.DivisionID); err != nil {
		writeJSON(w, 500, map[string]string{"error": "ล้างสาย Knockout เดิมไม่สำเร็จ"})
		return
	}
	for _, rawMatch := range matches {
		match := rawMatch.(map[string]any)
		payload, _ := json.Marshal(match)
		if _, err = tx.ExecContext(r.Context(), `insert into tournament_matches(id,tournament_id,admin_id,division_id,match_code,stage,status,next_match_id,next_match_slot,payload) values($1,$2,$3,$4,$5,$6,$7,nullif($8,''),nullif($9,''),$10)`, stringValue(match["id"], ""), body.TournamentID, p.AdminID, body.DivisionID, stringValue(match["matchCode"], ""), stringValue(match["stage"], "R16"), stringValue(match["status"], "scheduled"), stringValue(match["nextMatchId"], ""), stringValue(match["nextMatchSlot"], ""), payload); err != nil {
			writeJSON(w, 409, map[string]string{"error": "สร้างคู่ Knockout ไม่สำเร็จ"})
			return
		}
	}
	for _, rawMatch := range matches {
		match := rawMatch.(map[string]any)
		if match["isBye"] != true {
			continue
		}
		aID, bID := stringValue(match["teamAId"], ""), stringValue(match["teamBId"], "")
		if (aID == "") == (bID == "") {
			continue
		}
		if aID != "" {
			match["winner"] = "A"
		} else {
			match["winner"] = "B"
		}
		match["locked"] = true
		payload, _ := json.Marshal(match)
		if _, err = tx.ExecContext(r.Context(), `update tournament_matches set payload=$2,status='walkover',locked=true,ended_at=now(),version=version+1,updated_at=now() where id=$1`, stringValue(match["id"], ""), payload); err != nil {
			writeJSON(w, 500, map[string]string{"error": "เลื่อนทีมที่ได้ BYE ไม่สำเร็จ"})
			return
		}
		if err = advanceTournamentMatchTx(r.Context(), tx, p.AdminID, body.TournamentID, match); err != nil {
			writeJSON(w, 500, map[string]string{"error": "เชื่อมสาย BYE ไม่สำเร็จ"})
			return
		}
	}
	if err = insertTournamentRealtimeEventTx(r.Context(), tx, p.AdminID, body.TournamentID, "", "draw_published", map[string]any{"tournamentId": body.TournamentID, "divisionId": body.DivisionID, "version": version, "stageType": "knockout"}); err != nil || tx.Commit() != nil {
		writeJSON(w, 500, map[string]string{"error": "สร้างสาย Knockout ไม่สำเร็จ"})
		return
	}
	a.tournamentAudit(r.Context(), p, body.TournamentID, "ADVANCE_KNOCKOUT", "draw", body.DivisionID, "", map[string]any{"version": version, "seed": seed, "qualifiers": requested})
	writeJSON(w, 201, map[string]any{"version": version, "seed": seed, "matchCount": len(matches)})
}

func (a *app) tournamentEligibleDrawTeams(ctx context.Context, adminID, tournamentID, divisionID string) ([]tournamentDrawTeam, string, error) {
	rows, err := a.db.QueryContext(ctx, `select id,payload,format from tournament_entries where admin_id=$1 and tournament_id=$2 and division_id=$3 and withdrawn_at is null and not waiting_list order by created_at,id`, adminID, tournamentID, divisionID)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	teams := []tournamentDrawTeam{}
	ids := []string{}
	for rows.Next() {
		var id string
		var raw []byte
		var format string
		if rows.Scan(&id, &raw, &format) != nil {
			continue
		}
		payload := map[string]any{}
		_ = json.Unmarshal(raw, &payload)
		players := []string{}
		if members, ok := payload["members"].([]any); ok {
			for _, rawMember := range members {
				member, _ := rawMember.(map[string]any)
				name := strings.TrimSpace(stringValue(member["firstName"], "") + " " + stringValue(member["lastName"], ""))
				if name != "" {
					players = append(players, name)
				}
			}
		}
		if len(players) == 0 {
			players = append(players, strings.TrimSpace(stringValue(payload["firstName"], "")+" "+stringValue(payload["lastName"], "")))
			if partner := strings.TrimSpace(stringValue(payload["partnerName"], "")); partner != "" {
				players = append(players, partner)
			}
		}
		teams = append(teams, tournamentDrawTeam{ID: id, Name: stringValue(payload["teamName"], id), Club: stringValue(payload["club"], "อิสระ"), Format: format, Players: players, Payload: payload})
		ids = append(ids, id)
	}
	fingerprint := fmt.Sprintf("%x", sha256.Sum256([]byte(strings.Join(ids, "|"))))
	return teams, fingerprint, rows.Err()
}

func buildTournamentDrawSnapshot(tournamentID, divisionID, system, seed string, teams []tournamentDrawTeam, options, settings map[string]any) map[string]any {
	sum := sha256.Sum256([]byte(seed))
	rng := mathrand.New(mathrand.NewSource(int64(binary.LittleEndian.Uint64(sum[:8]))))
	ordered := append([]tournamentDrawTeam(nil), teams...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].ID < ordered[j].ID })
	rng.Shuffle(len(ordered), func(i, j int) {
		ordered[i], ordered[j] = ordered[j], ordered[i]
	})
	teamsPerGroup := intValueForTournament(options["teamsPerGroup"], intValueForTournament(settings["teamsPerGroup"], 4))
	if teamsPerGroup < 2 {
		teamsPerGroup = 4
	}
	groupsCount := 1
	if system == "group_then_knockout" {
		groupsCount = (len(ordered) + teamsPerGroup - 1) / teamsPerGroup
	}
	groups := make([][]tournamentDrawTeam, groupsCount)
	for index, team := range ordered {
		groups[index%groupsCount] = append(groups[index%groupsCount], team)
	}
	groupPayload, assignments, matches := []any{}, []any{}, []any{}
	matchIndex := 1
	if system == "round_robin" || system == "group_then_knockout" {
		for groupIndex, group := range groups {
			groupName := fmt.Sprintf("กลุ่ม %c", 'A'+groupIndex)
			publicTeams := []any{}
			for index, team := range group {
				publicTeams = append(publicTeams, team.Payload)
				assignments = append(assignments, map[string]any{"playerId": team.ID, "groupName": groupName, "order": index + 1})
			}
			groupPayload = append(groupPayload, map[string]any{"groupName": groupName, "teams": publicTeams})
			for i := 0; i < len(group); i++ {
				for j := i + 1; j < len(group); j++ {
					matches = append(matches, tournamentDrawMatch(tournamentID, divisionID, fmt.Sprintf("G%d-%02d", groupIndex+1, matchIndex), "group", groupName, group[i], group[j]))
					matchIndex++
				}
			}
		}
	} else {
		groupPayload = append(groupPayload, map[string]any{"groupName": "สายหลัก", "teams": func() []any {
			result := []any{}
			for _, team := range ordered {
				result = append(result, team.Payload)
			}
			return result
		}()})
		matches = buildEliminationMatches(tournamentID, divisionID, ordered, system == "double_elimination")
	}
	return map[string]any{"tournamentId": tournamentID, "divisionId": divisionID, "drawSystem": system, "seed": seed, "groups": groupPayload, "groupAssignments": assignments, "matches": matches, "warnings": []any{}}
}

func tournamentDrawMatch(tournamentID, divisionID, code, stage, group string, a, b tournamentDrawTeam) map[string]any {
	format := a.Format
	if format == "" {
		format = b.Format
	}
	if format != "singles" {
		format = "doubles"
	}
	return map[string]any{"id": drawStableMatchID(tournamentID, divisionID, code), "tournamentId": tournamentID, "divisionId": divisionID, "matchCode": code, "format": format, "stage": stage, "groupName": group, "teamAId": a.ID, "teamAName": a.Name, "teamAClub": a.Club, "teamAPlayers": a.Players, "teamBId": b.ID, "teamBName": b.Name, "teamBClub": b.Club, "teamBPlayers": b.Players, "status": "scheduled", "currentSet": 1, "sets": []any{map[string]any{"setNumber": 1, "scoreA": 0, "scoreB": 0}}, "servingTeam": "A", "servingPlayerIndex": 0, "courtPositions": map[string]any{"A": []any{0, 1}, "B": []any{0, 1}}, "endsSwapped": false, "locked": false, "cards": []any{}, "timeoutsUsed": map[string]any{"A": 0, "B": 0}, "timeline": []any{}}
}

func drawStableMatchID(tournamentID, divisionID, code string) string {
	sum := sha256.Sum256([]byte(tournamentID + "|" + divisionID + "|" + code))
	return fmt.Sprintf("match-%x", sum[:8])
}

func buildEliminationMatches(tournamentID, divisionID string, teams []tournamentDrawTeam, double bool) []any {
	size := 2
	for size < len(teams) {
		size *= 2
	}
	rounds := 0
	for n := size; n > 1; n /= 2 {
		rounds++
	}
	result := []any{}
	byID := map[string]map[string]any{}
	roundIDs := make([][]string, rounds)
	for round := 0; round < rounds; round++ {
		count := size >> (round + 1)
		roundIDs[round] = make([]string, count)
		for i := 0; i < count; i++ {
			roundIDs[round][i] = drawStableMatchID(tournamentID, divisionID, fmt.Sprintf("WB-%d-%d", round, i))
		}
	}
	for round := 0; round < rounds; round++ {
		stage := fmt.Sprintf("R%d", size>>round)
		if size>>round == 2 {
			stage = "F"
		} else if size>>round == 4 {
			stage = "SF"
		} else if size>>round == 8 {
			stage = "QF"
		}
		for i, id := range roundIDs[round] {
			empty := tournamentDrawTeam{}
			a, b := empty, empty
			if round == 0 {
				if i*2 < len(teams) {
					a = teams[i*2]
				}
				if i*2+1 < len(teams) {
					b = teams[i*2+1]
				}
			}
			match := tournamentDrawMatch(tournamentID, divisionID, fmt.Sprintf("WB-%s-%02d", stage, i+1), stage, "", a, b)
			match["id"], match["bracketSide"], match["bracketOrder"] = id, "winners", i+1
			if round+1 < rounds {
				match["nextMatchId"], match["nextMatchSlot"] = roundIDs[round+1][i/2], map[bool]string{true: "B", false: "A"}[i%2 == 1]
			}
			if round == 0 && (a.ID == "" || b.ID == "") {
				match["isBye"], match["status"] = true, "walkover"
			}
			result = append(result, match)
			byID[id] = match
		}
	}
	if double {
		if rounds == 1 {
			gf := tournamentDrawMatch(tournamentID, divisionID, "GF-01", "GF", "", tournamentDrawTeam{}, tournamentDrawTeam{})
			gf["id"], gf["bracketSide"] = drawStableMatchID(tournamentID, divisionID, "GF-01"), "final"
			reset := tournamentDrawMatch(tournamentID, divisionID, "GF-RESET", "GF_RESET", "", tournamentDrawTeam{}, tournamentDrawTeam{})
			reset["id"], reset["bracketSide"], reset["conditional"] = drawStableMatchID(tournamentID, divisionID, "GF-RESET"), "final", true
			gf["resetMatchId"], gf["resetRequiredWhenWinner"] = reset["id"], "B"
			final := byID[roundIDs[0][0]]
			final["nextMatchId"], final["nextMatchSlot"] = gf["id"], "A"
			final["nextLoserMatchId"], final["nextLoserMatchSlot"] = gf["id"], "B"
			return append(result, gf, reset)
		}
		loserRounds := max(1, 2*(rounds-1))
		loserRoundIDs := make([][]string, loserRounds)
		for round := 1; round <= loserRounds; round++ {
			count := max(1, size>>(2+(round-1)/2))
			current := make([]string, count)
			for i := 0; i < count; i++ {
				id := drawStableMatchID(tournamentID, divisionID, fmt.Sprintf("LB-%d-%d", round, i))
				current[i] = id
				m := tournamentDrawMatch(tournamentID, divisionID, fmt.Sprintf("LB-R%d-%02d", round, i+1), fmt.Sprintf("LB%d", round), "", tournamentDrawTeam{}, tournamentDrawTeam{})
				m["id"], m["bracketSide"], m["bracketOrder"] = id, "losers", i+1
				result = append(result, m)
				byID[id] = m
			}
			loserRoundIDs[round-1] = current
		}
		// Losers bracket alternates between consolidation rounds and rounds that
		// receive a loser from the next winners-bracket round.
		for wbRound, ids := range roundIDs {
			if wbRound == rounds-1 {
				continue
			}
			lbIndex := 0
			if wbRound > 0 {
				lbIndex = 2*wbRound - 1
			}
			for i, id := range ids {
				targets := loserRoundIDs[min(lbIndex, len(loserRoundIDs)-1)]
				byID[id]["nextLoserMatchId"] = targets[min(i/2, len(targets)-1)]
				if wbRound == 0 {
					byID[id]["nextLoserMatchSlot"] = map[bool]string{true: "B", false: "A"}[i%2 == 1]
				} else {
					byID[id]["nextLoserMatchSlot"] = "B"
				}
			}
		}
		for roundIndex, ids := range loserRoundIDs {
			if roundIndex == len(loserRoundIDs)-1 {
				continue
			}
			nextIDs := loserRoundIDs[roundIndex+1]
			for i, id := range ids {
				byID[id]["nextMatchId"] = nextIDs[min(i/2, len(nextIDs)-1)]
				if roundIndex%2 == 0 {
					byID[id]["nextMatchSlot"] = "A"
				} else {
					byID[id]["nextMatchSlot"] = map[bool]string{true: "B", false: "A"}[i%2 == 1]
				}
			}
		}
		gf := tournamentDrawMatch(tournamentID, divisionID, "GF-01", "GF", "", tournamentDrawTeam{}, tournamentDrawTeam{})
		gf["id"], gf["bracketSide"] = drawStableMatchID(tournamentID, divisionID, "GF-01"), "final"
		reset := tournamentDrawMatch(tournamentID, divisionID, "GF-RESET", "GF_RESET", "", tournamentDrawTeam{}, tournamentDrawTeam{})
		reset["id"], reset["bracketSide"], reset["conditional"] = drawStableMatchID(tournamentID, divisionID, "GF-RESET"), "final", true
		gf["resetMatchId"] = reset["id"]
		gf["resetRequiredWhenWinner"] = "B"
		byID[roundIDs[len(roundIDs)-1][0]]["nextMatchId"], byID[roundIDs[len(roundIDs)-1][0]]["nextMatchSlot"] = gf["id"], "A"
		byID[roundIDs[len(roundIDs)-1][0]]["nextLoserMatchId"], byID[roundIDs[len(roundIDs)-1][0]]["nextLoserMatchSlot"] = loserRoundIDs[len(loserRoundIDs)-1][0], "B"
		byID[loserRoundIDs[len(loserRoundIDs)-1][0]]["nextMatchId"], byID[loserRoundIDs[len(loserRoundIDs)-1][0]]["nextMatchSlot"] = gf["id"], "B"
		result = append(result, gf, reset)
	}
	return result
}

func tournamentDrawRevisionAction(ctx context.Context, tx *sql.Tx, adminID, tournamentID, divisionID string, lock bool, actor, reason string) error {
	if !lock && strings.TrimSpace(reason) == "" {
		return fmt.Errorf("ต้องระบุเหตุผลการปลดล็อก")
	}
	_, err := tx.ExecContext(ctx, `update tournament_draw_revisions set locked=$4,locked_at=case when $4 then now() else null end,locked_by=case when $4 then $5 else '' end where id=(select id from tournament_draw_revisions where admin_id=$1 and tournament_id=$2 and division_id=$3 order by version desc limit 1)`, adminID, tournamentID, divisionID, lock, actor)
	return err
}

func (a *app) tournamentDrawLock(w http.ResponseWriter, r *http.Request, lock bool) {
	p, ok := a.requireTournamentPrincipal(w, r, "lockBracket")
	if !ok {
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]string{"error": "method not allowed"})
		return
	}
	if !lock && p.Role != "owner" {
		writeJSON(w, 403, map[string]string{"error": "เฉพาะ Owner ที่ปลดล็อกสายได้"})
		return
	}
	var body map[string]any
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid json"})
		return
	}
	tournamentID, divisionID := stringValue(body["tournamentId"], ""), stringValue(body["divisionId"], "")
	reason := strings.TrimSpace(stringValue(body["reason"], ""))
	if !lock && reason == "" {
		writeJSON(w, 400, map[string]string{"error": "ต้องระบุเหตุผลการปลดล็อก"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	if err = tournamentDrawRevisionAction(r.Context(), tx, p.AdminID, tournamentID, divisionID, lock, p.ActorID, reason); err == nil {
		_, err = tx.ExecContext(r.Context(), `update tournament_matches set locked=$4,payload=jsonb_set(payload,'{locked}',to_jsonb($4::boolean),true),version=version+1,updated_at=now() where admin_id=$1 and tournament_id=$2 and division_id=$3 and status not in ('live','finished','walkover','retired')`, p.AdminID, tournamentID, divisionID, lock)
	}
	if err == nil {
		err = insertTournamentRealtimeEventTx(r.Context(), tx, p.AdminID, tournamentID, "", "draw_lock_changed", map[string]any{"divisionId": divisionID, "locked": lock})
	}
	if err != nil || tx.Commit() != nil {
		writeJSON(w, 500, map[string]string{"error": "เปลี่ยนสถานะล็อกสายไม่สำเร็จ"})
		return
	}
	a.tournamentAudit(r.Context(), p, tournamentID, map[bool]string{true: "LOCK_DRAW", false: "UNLOCK_DRAW"}[lock], "draw", divisionID, reason, nil)
	writeJSON(w, 200, map[string]any{"locked": lock})
}

func advanceTournamentMatchTx(ctx context.Context, tx *sql.Tx, adminID, tournamentID string, completed map[string]any) error {
	winner := stringValue(completed["winner"], "")
	if winner != "A" && winner != "B" {
		return nil
	}
	route := func(nextID, slot, sourcePrefix string) error {
		if nextID == "" || stringValue(completed[sourcePrefix+"Id"], "") == "" {
			return nil
		}
		var raw []byte
		var version int64
		if err := tx.QueryRowContext(ctx, `select payload,version from tournament_matches where id=$1 and admin_id=$2 and tournament_id=$3 for update`, nextID, adminID, tournamentID).Scan(&raw, &version); err != nil {
			return err
		}
		next := map[string]any{}
		_ = json.Unmarshal(raw, &next)
		targetPrefix := "teamA"
		if slot == "B" {
			targetPrefix = "teamB"
		}
		for _, suffix := range []string{"Id", "Name", "Club", "Players"} {
			next[targetPrefix+suffix] = completed[sourcePrefix+suffix]
		}
		nextRaw, _ := json.Marshal(next)
		if _, err := tx.ExecContext(ctx, `update tournament_matches set payload=$3,version=version+1,updated_at=now() where id=$1 and admin_id=$2`, nextID, adminID, nextRaw); err != nil {
			return err
		}
		next["id"], next["version"] = nextID, version+1
		return insertTournamentRealtimeEventTx(ctx, tx, adminID, tournamentID, nextID, "match_update", map[string]any{"match": next})
	}
	winnerPrefix, loserPrefix := "teamA", "teamB"
	if winner == "B" {
		winnerPrefix, loserPrefix = "teamB", "teamA"
	}
	if err := route(stringValue(completed["nextMatchId"], ""), stringValue(completed["nextMatchSlot"], "A"), winnerPrefix); err != nil {
		return err
	}
	if err := route(stringValue(completed["nextLoserMatchId"], ""), stringValue(completed["nextLoserMatchSlot"], "A"), loserPrefix); err != nil {
		return err
	}
	// In double elimination, a losers-bracket team winning the first grand
	// final forces the conditional reset match. A winners-bracket victory ends
	// the tournament and leaves the reset hidden as not required.
	if stringValue(completed["stage"], "") == "GF" {
		resetID := stringValue(completed["resetMatchId"], "")
		if winner == stringValue(completed["resetRequiredWhenWinner"], "B") {
			if err := route(resetID, "A", "teamA"); err != nil {
				return err
			}
			if err := route(resetID, "B", "teamB"); err != nil {
				return err
			}
		} else if resetID != "" {
			_, _ = tx.ExecContext(ctx, `update tournament_matches set status='not_required',payload=jsonb_set(payload,'{status}','"not_required"'::jsonb,true),locked=true,version=version+1,updated_at=now() where id=$1 and admin_id=$2`, resetID, adminID)
		}
	}
	return nil
}
