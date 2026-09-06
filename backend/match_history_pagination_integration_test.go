package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestMatchHistoryServerPaginationIntegration(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("LIVEMATCH_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run PostgreSQL match history integration tests")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	sessionID := "history-page-" + randHex(8)
	if _, err = db.Exec(`insert into sessions(id,name,session_type,admin_passcode,state) values($1,'History pagination','liveMatch','',null)`, sessionID); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = db.Exec(`delete from sessions where id=$1`, sessionID) }()
	if _, err = db.Exec(`insert into session_settings(session_id) values($1)`, sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`
		insert into players(session_id,id,name,level)
		values($1,1,'Alice Legacy','middle'),($1,2,'Partner','middle'),($1,3,'Opponent A','middle'),($1,4,'Opponent B','middle')
	`, sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`
		insert into matches(session_id,id,phase,court,level,a1,a2,b1,b2,status,note,shuttles)
		select $1,n,'history','สนาม 1','middle',1,2,3,4,'finished',case when n=1 then 'legacy-search-marker' else '' end,1
		from generate_series(1,125) n
	`, sessionID); err != nil {
		t.Fatal(err)
	}

	a := &app{db: db}
	request := httptest.NewRequest(http.MethodGet, "/api/sessions/"+sessionID+"/history?page=7&pageSize=20", nil)
	recorder := httptest.NewRecorder()
	a.writeSessionHistoryPage(recorder, request, sessionID)
	if recorder.Code != http.StatusOK {
		t.Fatalf("history page returned %d: %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		History    []Match        `json:"history"`
		Players    []Player       `json:"players"`
		Pagination map[string]int `json:"pagination"`
	}
	if err = json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.History) != 5 || payload.History[0].ID != 5 || payload.History[4].ID != 1 {
		t.Fatalf("oldest page was not returned correctly: %#v", payload.History)
	}
	if payload.Pagination["total"] != 125 || payload.Pagination["totalPages"] != 7 || len(payload.Players) != 4 {
		t.Fatalf("invalid page metadata or related players: pagination=%#v players=%d", payload.Pagination, len(payload.Players))
	}

	searchRequest := httptest.NewRequest(http.MethodGet, "/api/sessions/"+sessionID+"/history?page=1&pageSize=20&search=legacy-search-marker", nil)
	searchRecorder := httptest.NewRecorder()
	a.writeSessionHistoryPage(searchRecorder, searchRequest, sessionID)
	if searchRecorder.Code != http.StatusOK {
		t.Fatalf("history search returned %d: %s", searchRecorder.Code, searchRecorder.Body.String())
	}
	var searchPayload struct {
		History []Match `json:"history"`
		Total   int     `json:"total"`
	}
	if err = json.Unmarshal(searchRecorder.Body.Bytes(), &searchPayload); err != nil {
		t.Fatal(err)
	}
	if searchPayload.Total != 1 || len(searchPayload.History) != 1 || searchPayload.History[0].ID != 1 {
		t.Fatalf("server search did not include legacy history: %#v", searchPayload)
	}
}
