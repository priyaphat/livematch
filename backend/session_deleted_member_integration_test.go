package main

import (
	"database/sql"
	"os"
	"testing"
)

func TestSessionSaveSurvivesSoftDeletedCentralMember(t *testing.T) {
	dsn := os.Getenv("LIVEMATCH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run PostgreSQL session integration tests")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	a := &app{db: db}
	if err = a.migrate(t.Context()); err != nil {
		t.Fatalf("migrate test database: %v", err)
	}
	adminID := "deleted-member-session-" + randHex(8)
	memberID := "deleted-member-" + randHex(8)
	sessionID := "deleted-member-match-" + randHex(8)
	accountID := "deleted-member-account-" + randHex(8)
	if _, err = db.Exec(`insert into admin_users(id,email,name,password_hash,verified_at) values($1,$2,'Deleted member session test','unused',now())`, adminID, adminID+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(`delete from sessions where id=$1`, sessionID)
		_, _ = db.Exec(`delete from billing_accounts where id=$1`, accountID)
		_, _ = db.Exec(`delete from members where id=$1`, memberID)
		_, _ = db.Exec(`delete from admin_users where id=$1`, adminID)
	}()
	if _, err = db.Exec(`insert into members(id,admin_id,name,phone,active,profile_token_hash,profile_token) values($1,$2,'Historical Player',$3,true,$4,$5)`, memberID, adminID, "08"+randHex(4), tokenDigest(memberID), memberID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into billing_accounts(id,admin_id,kind,member_id,display_name) values($1,$2,'member',$3,'Historical Player')`, accountID, adminID, memberID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`insert into sessions(id,name,admin_id,admin_passcode,state) values($1,'Soft-deleted member session',$2,'','{}'::jsonb)`, sessionID, adminID); err != nil {
		t.Fatal(err)
	}

	state := defaultState(sessionID, "Soft-deleted member session", "")
	state.Players = []Player{
		{ID: 1, Name: "Historical Player", MemberID: memberID, BillingAccountID: accountID, Active: true, Paid: true, SettledAmountSatang: 8500},
		{ID: 2, Name: "Player 2", Active: true},
		{ID: 3, Name: "Player 3", Active: true},
		{ID: 4, Name: "Player 4", Active: true},
		{ID: 5, Name: "Player 5", Active: true},
	}
	state.Live = []Match{{ID: 28, Court: "สนาม 1", A1: 2, A2: 3, B1: 4, B2: 5, Status: "playing", Shuttles: 1}}
	if err = a.saveStateResolved(t.Context(), &state); err != nil {
		t.Fatalf("initial session save: %v", err)
	}
	if _, err = db.Exec(`update members set active=false,deleted_at=now() where id=$1`, memberID); err != nil {
		t.Fatal(err)
	}

	found, resultErr := closeLiveWithScores(&state, 28, false, "", "A", []MatchScore{{A: 21, B: 10}, {A: 21, B: 12}}, false)
	if resultErr != nil || !found {
		t.Fatalf("finish live match: found=%v err=%v", found, resultErr)
	}
	if err = a.saveStateResolved(t.Context(), &state); err != nil {
		t.Fatalf("soft-deleted unrelated member blocked match finish: %v", err)
	}

	var phase string
	var paid bool
	var storedAccountID string
	if err = db.QueryRow(`select phase from matches where session_id=$1 and id=28`, sessionID).Scan(&phase); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`select paid,coalesce(billing_account_id,'') from players where session_id=$1 and id=1`, sessionID).Scan(&paid, &storedAccountID); err != nil {
		t.Fatal(err)
	}
	if phase != "history" || !paid || storedAccountID != accountID {
		t.Fatalf("saved state phase=%q paid=%v account=%q, want history/true/%q", phase, paid, storedAccountID, accountID)
	}
}
