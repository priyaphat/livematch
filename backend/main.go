package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type app struct {
	db *sql.DB
}

type HealthResponse struct {
	Status    string    `json:"status"`
	Service   string    `json:"service"`
	Timestamp time.Time `json:"timestamp"`
}

type SessionRecord struct {
	ID            string       `json:"id"`
	Name          string       `json:"name"`
	AdminPasscode string       `json:"adminPasscode"`
	State         SessionState `json:"state"`
}

type SessionState struct {
	Tab       string      `json:"tab"`
	Theme     string      `json:"theme"`
	Session   SessionInfo `json:"session"`
	Settings  Settings    `json:"settings"`
	Players   []Player    `json:"players"`
	Couples   []Couple    `json:"couples"`
	Queue     []Match     `json:"queue"`
	Live      []Match     `json:"live"`
	History   []Match     `json:"history"`
	NextIDs   NextIDs     `json:"nextIds"`
	UpdatedAt time.Time   `json:"updatedAt"`
}

type SessionInfo struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	AdminPasscode string `json:"adminPasscode"`
	Unlocked      bool   `json:"unlocked"`
}

type Settings struct {
	EntryFee           int      `json:"entryFee"`
	ShuttleFee         int      `json:"shuttleFee"`
	CourtCount         int      `json:"courtCount"`
	CourtNames         []string `json:"courtNames"`
	Levels             []string `json:"levels"`
	AllowCrossLevel    bool     `json:"allowCrossLevel"`
	CrossLevelRange    int      `json:"crossLevelRange"`
	RandomPriority     string   `json:"randomPriority"`
	ShowPaymentOnShare bool     `json:"showPaymentOnShare"`
}

type Player struct {
	ID       int    `json:"id"`
	Name     string `json:"name"`
	Games    int    `json:"games"`
	Wins     int    `json:"wins"`
	Losses   int    `json:"losses"`
	Shuttles int    `json:"shuttles"`
	Paid     bool   `json:"paid"`
	Active   bool   `json:"active"`
	Level    string `json:"level"`
	Coupon   bool   `json:"coupon"`
}

type Couple struct {
	ID int `json:"id"`
	A  int `json:"a"`
	B  int `json:"b"`
}

type Match struct {
	ID         int    `json:"id"`
	Court      string `json:"court"`
	Level      string `json:"level"`
	A1         int    `json:"a1"`
	A2         int    `json:"a2"`
	B1         int    `json:"b1"`
	B2         int    `json:"b2"`
	Shuttles   int    `json:"shuttles"`
	Winner     string `json:"winner"`
	ShuttleSeq string `json:"shuttleSequence"`
	Status     string `json:"status"`
	StartedAt  string `json:"startedAt"`
	EndedAt    string `json:"endedAt"`
	Note       string `json:"note"`
}

type NextIDs struct {
	Player int `json:"player"`
	Couple int `json:"couple"`
	Match  int `json:"match"`
}

func main() {
	db, err := openDB()
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	a := &app{db: db}
	if err := a.migrate(context.Background()); err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", a.handleHealth)
	mux.HandleFunc("/api/supervisor/summary", a.handleSupervisorSummary)
	mux.HandleFunc("/api/supervisor/session-detail", a.handleSupervisorSessionDetail)
	mux.HandleFunc("/api/sessions/unlock", a.handleUnlockByPasscode)
	mux.HandleFunc("/api/sessions", a.handleSessions)
	mux.HandleFunc("/api/sessions/", a.handleSessionRoutes)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("LiveMatch backend listening on :%s", port)
	if err := http.ListenAndServe(":"+port, withCORS(mux)); err != nil {
		log.Fatal(err)
	}
}

func openDB() (*sql.DB, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://livematch:livematch@localhost:5432/livematch?sslmode=disable"
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return db, db.PingContext(ctx)
}

func (a *app) migrate(ctx context.Context) error {
	_, err := a.db.ExecContext(ctx, `
		create table if not exists sessions (
			id text primary key,
			name text not null,
			admin_passcode text not null,
			state jsonb not null,
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now()
		);
		alter table sessions add column if not exists name text;
		alter table sessions add column if not exists admin_passcode text;
		alter table sessions add column if not exists state jsonb;
		alter table sessions add column if not exists created_at timestamptz not null default now();
		alter table sessions add column if not exists updated_at timestamptz not null default now();
		alter table sessions alter column name drop not null;
		alter table sessions alter column admin_passcode drop not null;
		alter table sessions alter column state drop not null;
		do $$
		begin
			if exists (
				select 1 from information_schema.columns
				where table_name = 'sessions' and column_name = 'venue_name'
			) then
				alter table sessions alter column venue_name drop not null;
			end if;
		end $$;
		create table if not exists session_settings (
			session_id text primary key references sessions(id) on delete cascade,
			entry_fee integer not null default 120,
			shuttle_fee integer not null default 85,
			court_count integer not null default 4,
			court_names jsonb not null default '["สนาม 1","สนาม 2","สนาม 3","สนาม 4"]'::jsonb,
			levels jsonb not null default '["light","middle","heavy"]'::jsonb,
			allow_cross_level boolean not null default true,
			cross_level_range integer not null default 1,
			random_priority text not null default 'level',
			show_payment_on_share boolean not null default true
		);
		alter table session_settings add column if not exists random_priority text not null default 'level';
		alter table session_settings add column if not exists show_payment_on_share boolean not null default true;
		create table if not exists players (
			session_id text not null references sessions(id) on delete cascade,
			id integer not null,
			name text not null,
			games integer not null default 0,
			wins integer not null default 0,
			losses integer not null default 0,
			shuttles integer not null default 0,
			paid boolean not null default false,
			active boolean not null default true,
			level text not null default 'middle',
			coupon boolean not null default false,
			primary key (session_id, id)
		);
		alter table players add column if not exists wins integer not null default 0;
		alter table players add column if not exists losses integer not null default 0;
		alter table players alter column coupon set default false;
		create table if not exists couples (
			session_id text not null references sessions(id) on delete cascade,
			id integer not null,
			player_a integer not null,
			player_b integer not null,
			primary key (session_id, id)
		);
		create table if not exists matches (
			session_id text not null references sessions(id) on delete cascade,
			id integer not null,
			phase text not null check (phase in ('queue', 'live', 'history')),
			court text not null default '-',
			level text not null,
			a1 integer not null,
			a2 integer not null,
			b1 integer not null,
			b2 integer not null,
			shuttles integer not null default 0,
			winner text not null default '',
			shuttle_sequence text not null default '',
			status text not null default '',
			started_at text not null default '',
			ended_at text not null default '',
			note text not null default '',
			primary key (session_id, id)
		);
		alter table matches add column if not exists winner text not null default '';
		alter table matches add column if not exists shuttle_sequence text not null default '';
		create index if not exists idx_players_session on players(session_id);
		create index if not exists idx_couples_session on couples(session_id);
		create index if not exists idx_matches_session_phase on matches(session_id, phase);
	`)
	if err != nil {
		return err
	}
	return a.backfillJSONStates(ctx)
}

func (a *app) backfillJSONStates(ctx context.Context) error {
	rows, err := a.db.QueryContext(ctx, `
		select id, state
		from sessions
		where state is not null
		and not exists (
			select 1 from session_settings where session_settings.session_id = sessions.id
		)
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	var states []SessionState
	for rows.Next() {
		var id string
		var raw []byte
		if err := rows.Scan(&id, &raw); err != nil {
			return err
		}
		var state SessionState
		if err := json.Unmarshal(raw, &state); err != nil {
			continue
		}
		if state.Session.ID == "" {
			state.Session.ID = id
		}
		states = append(states, state)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, state := range states {
		if err := a.saveState(ctx, state); err != nil {
			return err
		}
	}
	return nil
}

func (a *app) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, HealthResponse{
		Status:    "ok",
		Service:   "livematch-backend",
		Timestamp: time.Now().UTC(),
	})
}

func (a *app) handleSessions(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		body.Name = "แบดวันนี้"
	}

	id := "session-" + randHex(6)
	passcode := "LM-" + time.Now().Format("150405")
	state := defaultState(id, body.Name, passcode)
	if err := a.saveState(r.Context(), state); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusCreated, SessionRecord{ID: id, Name: body.Name, AdminPasscode: passcode, State: state})
}

func (a *app) handleUnlockByPasscode(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	var body struct {
		Passcode string `json:"passcode"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	passcode := strings.TrimSpace(body.Passcode)
	if passcode == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "passcode required"})
		return
	}

	var id string
	err := a.db.QueryRowContext(r.Context(), `
		select id
		from sessions
		where admin_passcode = $1
		order by updated_at desc
		limit 1
	`, passcode).Scan(&id)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, sql.ErrNoRows) {
			status = http.StatusUnauthorized
		}
		writeJSON(w, status, map[string]string{"error": "invalid passcode"})
		return
	}

	state, err := a.loadState(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	state.Session.Unlocked = true
	writeJSON(w, http.StatusOK, state)
}

func (a *app) handleSupervisorSummary(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Username != "superadmin" || body.Password != "12345678" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid supervisor login"})
		return
	}

	type supervisorWinner struct {
		SessionID   string `json:"sessionId"`
		SessionName string `json:"sessionName"`
		ID          int    `json:"id"`
		Name        string `json:"name"`
		Wins        int    `json:"wins"`
		Losses      int    `json:"losses"`
	}
	type supervisorSession struct {
		ID             string `json:"id"`
		Name           string `json:"name"`
		Players        int    `json:"players"`
		PaidPlayers    int    `json:"paidPlayers"`
		UnpaidPlayers  int    `json:"unpaidPlayers"`
		Matches        int    `json:"matches"`
		QueueMatches   int    `json:"queueMatches"`
		LiveMatches    int    `json:"liveMatches"`
		HistoryMatches int    `json:"historyMatches"`
		Shuttles       int    `json:"shuttles"`
		Revenue        int    `json:"revenue"`
		UpdatedAt      string `json:"updatedAt"`
	}
	summary := struct {
		TotalSessions  int                 `json:"totalSessions"`
		TotalPlayers   int                 `json:"totalPlayers"`
		TotalMatches   int                 `json:"totalMatches"`
		QueueMatches   int                 `json:"queueMatches"`
		LiveMatches    int                 `json:"liveMatches"`
		HistoryMatches int                 `json:"historyMatches"`
		TotalShuttles  int                 `json:"totalShuttles"`
		TotalWins      int                 `json:"totalWins"`
		AverageGames   float64             `json:"averageGames"`
		TotalRevenue   int                 `json:"totalRevenue"`
		PaidRevenue    int                 `json:"paidRevenue"`
		UnpaidRevenue  int                 `json:"unpaidRevenue"`
		TopWinners     []supervisorWinner  `json:"topWinners"`
		Sessions       []supervisorSession `json:"sessions"`
	}{TopWinners: []supervisorWinner{}, Sessions: []supervisorSession{}}

	_ = a.db.QueryRowContext(r.Context(), `select count(*) from sessions`).Scan(&summary.TotalSessions)
	_ = a.db.QueryRowContext(r.Context(), `select count(*) from players where active`).Scan(&summary.TotalPlayers)
	_ = a.db.QueryRowContext(r.Context(), `select count(*) from matches`).Scan(&summary.TotalMatches)
	_ = a.db.QueryRowContext(r.Context(), `select count(*) from matches where phase = 'queue'`).Scan(&summary.QueueMatches)
	_ = a.db.QueryRowContext(r.Context(), `select count(*) from matches where phase = 'live'`).Scan(&summary.LiveMatches)
	_ = a.db.QueryRowContext(r.Context(), `select count(*) from matches where phase = 'history'`).Scan(&summary.HistoryMatches)
	_ = a.db.QueryRowContext(r.Context(), `select coalesce(sum(shuttles), 0) from matches`).Scan(&summary.TotalShuttles)
	_ = a.db.QueryRowContext(r.Context(), `select coalesce(sum(wins), 0) from players where active`).Scan(&summary.TotalWins)
	_ = a.db.QueryRowContext(r.Context(), `select coalesce(avg(games), 0) from players where active`).Scan(&summary.AverageGames)
	_ = a.db.QueryRowContext(r.Context(), `
		select coalesce(sum(ss.entry_fee + p.shuttles * ss.shuttle_fee), 0)
		from players p
		join session_settings ss on ss.session_id = p.session_id
		where p.active
	`).Scan(&summary.TotalRevenue)
	_ = a.db.QueryRowContext(r.Context(), `
		select coalesce(sum(ss.entry_fee + p.shuttles * ss.shuttle_fee), 0)
		from players p
		join session_settings ss on ss.session_id = p.session_id
		where p.active and p.paid
	`).Scan(&summary.PaidRevenue)
	summary.UnpaidRevenue = summary.TotalRevenue - summary.PaidRevenue

	rows, err := a.db.QueryContext(r.Context(), `
		select p.session_id, coalesce(s.name, p.session_id), p.id, p.name, p.wins, p.losses
		from players p
		join sessions s on s.id = p.session_id
		where p.active
		order by p.wins desc, p.losses asc, p.games desc, p.id asc
		limit 5
	`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var item supervisorWinner
		if err := rows.Scan(&item.SessionID, &item.SessionName, &item.ID, &item.Name, &item.Wins, &item.Losses); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		summary.TopWinners = append(summary.TopWinners, item)
	}

	rows, err = a.db.QueryContext(r.Context(), `
		select s.id, coalesce(s.name, s.id),
			(select count(*) from players p where p.session_id = s.id and p.active) as players,
			(select count(*) from players p where p.session_id = s.id and p.active and p.paid) as paid_players,
			(select count(*) from players p where p.session_id = s.id and p.active and not p.paid) as unpaid_players,
			(select count(*) from matches m where m.session_id = s.id) as matches,
			(select count(*) from matches m where m.session_id = s.id and m.phase = 'queue') as queue_matches,
			(select count(*) from matches m where m.session_id = s.id and m.phase = 'live') as live_matches,
			(select count(*) from matches m where m.session_id = s.id and m.phase = 'history') as history_matches,
			(select coalesce(sum(m.shuttles), 0) from matches m where m.session_id = s.id) as shuttles,
			(
				select coalesce(sum(ss.entry_fee + p.shuttles * ss.shuttle_fee), 0)
				from players p
				join session_settings ss on ss.session_id = p.session_id
				where p.session_id = s.id and p.active
			) as revenue,
			to_char(s.updated_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') as updated_at
		from sessions s
		order by s.updated_at desc
		limit 12
	`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var item supervisorSession
		if err := rows.Scan(&item.ID, &item.Name, &item.Players, &item.PaidPlayers, &item.UnpaidPlayers, &item.Matches, &item.QueueMatches, &item.LiveMatches, &item.HistoryMatches, &item.Shuttles, &item.Revenue, &item.UpdatedAt); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		summary.Sessions = append(summary.Sessions, item)
	}

	writeJSON(w, http.StatusOK, summary)
}

func (a *app) handleSupervisorSessionDetail(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	var body struct {
		Username  string `json:"username"`
		Password  string `json:"password"`
		SessionID string `json:"sessionId"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Username != "superadmin" || body.Password != "12345678" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid supervisor login"})
		return
	}
	if strings.TrimSpace(body.SessionID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "session id required"})
		return
	}

	type paymentPlayer struct {
		ID       int    `json:"id"`
		Name     string `json:"name"`
		Games    int    `json:"games"`
		Wins     int    `json:"wins"`
		Losses   int    `json:"losses"`
		Shuttles int    `json:"shuttles"`
		Paid     bool   `json:"paid"`
		Active   bool   `json:"active"`
		Cost     int    `json:"cost"`
	}
	type historyMatch struct {
		ID         int    `json:"id"`
		Court      string `json:"court"`
		Level      string `json:"level"`
		A1         int    `json:"a1"`
		A2         int    `json:"a2"`
		B1         int    `json:"b1"`
		B2         int    `json:"b2"`
		A1Name     string `json:"a1Name"`
		A2Name     string `json:"a2Name"`
		B1Name     string `json:"b1Name"`
		B2Name     string `json:"b2Name"`
		Shuttles   int    `json:"shuttles"`
		Winner     string `json:"winner"`
		StartedAt  string `json:"startedAt"`
		EndedAt    string `json:"endedAt"`
		Note       string `json:"note"`
		ShuttleSeq string `json:"shuttleSequence"`
	}
	detail := struct {
		SessionID     string          `json:"sessionId"`
		SessionName   string          `json:"sessionName"`
		EntryFee      int             `json:"entryFee"`
		ShuttleFee    int             `json:"shuttleFee"`
		Players       []paymentPlayer `json:"players"`
		History       []historyMatch  `json:"history"`
		TotalRevenue  int             `json:"totalRevenue"`
		PaidRevenue   int             `json:"paidRevenue"`
		UnpaidRevenue int             `json:"unpaidRevenue"`
	}{Players: []paymentPlayer{}, History: []historyMatch{}}

	if err := a.db.QueryRowContext(r.Context(), `
		select s.id, coalesce(s.name, s.id), ss.entry_fee, ss.shuttle_fee
		from sessions s
		join session_settings ss on ss.session_id = s.id
		where s.id = $1
	`, body.SessionID).Scan(&detail.SessionID, &detail.SessionName, &detail.EntryFee, &detail.ShuttleFee); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, sql.ErrNoRows) {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}

	rows, err := a.db.QueryContext(r.Context(), `
		select id, name, games, wins, losses, shuttles, paid, active,
			$2 + shuttles * $3 as cost
		from players
		where session_id = $1
		order by active desc, paid asc, id asc
	`, detail.SessionID, detail.EntryFee, detail.ShuttleFee)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var player paymentPlayer
		if err := rows.Scan(&player.ID, &player.Name, &player.Games, &player.Wins, &player.Losses, &player.Shuttles, &player.Paid, &player.Active, &player.Cost); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		detail.Players = append(detail.Players, player)
		detail.TotalRevenue += player.Cost
		if player.Paid {
			detail.PaidRevenue += player.Cost
		}
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	detail.UnpaidRevenue = detail.TotalRevenue - detail.PaidRevenue

	rows, err = a.db.QueryContext(r.Context(), `
		select m.id, m.court, m.level, m.a1, m.a2, m.b1, m.b2,
			coalesce(a1.name, '-'), coalesce(a2.name, '-'), coalesce(b1.name, '-'), coalesce(b2.name, '-'),
			m.shuttles, m.winner, m.started_at, m.ended_at, m.note, m.shuttle_sequence
		from matches m
		left join players a1 on a1.session_id = m.session_id and a1.id = m.a1
		left join players a2 on a2.session_id = m.session_id and a2.id = m.a2
		left join players b1 on b1.session_id = m.session_id and b1.id = m.b1
		left join players b2 on b2.session_id = m.session_id and b2.id = m.b2
		where m.session_id = $1 and m.phase = 'history'
		order by m.id asc
	`, detail.SessionID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var match historyMatch
		if err := rows.Scan(&match.ID, &match.Court, &match.Level, &match.A1, &match.A2, &match.B1, &match.B2, &match.A1Name, &match.A2Name, &match.B1Name, &match.B2Name, &match.Shuttles, &match.Winner, &match.StartedAt, &match.EndedAt, &match.Note, &match.ShuttleSeq); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		detail.History = append(detail.History, match)
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, detail)
}

func (a *app) handleSessionRoutes(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/sessions/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	id := parts[0]

	state, err := a.loadState(r.Context(), id)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, sql.ErrNoRows) {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}

	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	switch {
	case r.Method == http.MethodPost && action == "unlock":
		var body struct {
			Passcode string `json:"passcode"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.Passcode != state.Session.AdminPasscode {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid passcode"})
			return
		}
		state.Session.Unlocked = true
		writeJSON(w, http.StatusOK, state)
	case r.Method == http.MethodGet && action == "state":
		writeJSON(w, http.StatusOK, state)
	case r.Method == http.MethodGet && action == "players":
		items := state.Players
		search := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("search")))
		if search != "" {
			items = slices.DeleteFunc(slices.Clone(items), func(player Player) bool {
				return !strings.Contains(strings.ToLower(player.Name), search) && !strings.Contains(strconv.Itoa(player.ID), search)
			})
		}
		paged, page, pageSize := paginate(items, r)
		writeJSON(w, http.StatusOK, map[string]any{"items": paged, "total": len(items), "page": page, "pageSize": pageSize})
	case r.Method == http.MethodPost && action == "players":
		var body struct {
			Name   string `json:"name"`
			Level  string `json:"level"`
			Coupon *bool  `json:"coupon"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Name) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid player"})
			return
		}
		if body.Level == "" {
			body.Level = firstLevel(state)
		}
		coupon := false
		if body.Coupon != nil {
			coupon = *body.Coupon
		}
		state.NextIDs.Player++
		state.Players = append(state.Players, Player{ID: state.NextIDs.Player, Name: body.Name, Active: true, Level: body.Level, Coupon: coupon})
		a.respondSaved(w, r, state)
	case r.Method == http.MethodPatch && action == "players" && len(parts) >= 3:
		playerID, _ := strconv.Atoi(parts[2])
		var body struct {
			Paid   *bool   `json:"paid"`
			Level  *string `json:"level"`
			Coupon *bool   `json:"coupon"`
			Active *bool   `json:"active"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		for i := range state.Players {
			if state.Players[i].ID == playerID {
				if body.Paid != nil {
					state.Players[i].Paid = *body.Paid
				}
				if body.Level != nil {
					state.Players[i].Level = *body.Level
				}
				if body.Coupon != nil {
					state.Players[i].Coupon = *body.Coupon
				}
				if body.Active != nil {
					state.Players[i].Active = *body.Active
				}
			}
		}
		a.respondSaved(w, r, state)
	case r.Method == http.MethodPut && action == "settings":
		var settings Settings
		if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid settings"})
			return
		}
		normalizeSettings(&settings)
		state.Settings = settings
		a.respondSaved(w, r, state)
	case r.Method == http.MethodPost && action == "couples":
		var body struct {
			A int `json:"a"`
			B int `json:"b"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.A == 0 || body.B == 0 || body.A == body.B {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid couple"})
			return
		}
		state.Couples = removeCouplesForPlayers(state.Couples, body.A, body.B)
		state.NextIDs.Couple++
		state.Couples = append(state.Couples, Couple{ID: state.NextIDs.Couple, A: body.A, B: body.B})
		a.respondSaved(w, r, state)
	case r.Method == http.MethodGet && action == "couples":
		paged, page, pageSize := paginate(state.Couples, r)
		writeJSON(w, http.StatusOK, map[string]any{"items": paged, "total": len(state.Couples), "page": page, "pageSize": pageSize})
	case r.Method == http.MethodDelete && action == "couples" && len(parts) >= 3:
		coupleID, _ := strconv.Atoi(parts[2])
		state.Couples = slices.DeleteFunc(state.Couples, func(c Couple) bool { return c.ID == coupleID })
		a.respondSaved(w, r, state)
	case r.Method == http.MethodPost && action == "random":
		if err := randomMatch(&state); err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
			return
		}
		a.respondSaved(w, r, state)
	case r.Method == http.MethodGet && action == "coupons":
		busy := map[int]bool{}
		for _, match := range append(append([]Match{}, state.Queue...), state.Live...) {
			for _, id := range matchPlayers(match) {
				busy[id] = true
			}
		}
		groups := buildAvailableGroups(state, busy)
		items := []map[string]any{}
		for _, group := range groups {
			names := []string{}
			for _, id := range group.ids {
				for _, player := range state.Players {
					if player.ID == id {
						names = append(names, player.Name)
					}
				}
			}
			items = append(items, map[string]any{
				"ids":   group.ids,
				"name":  strings.Join(names, " + "),
				"level": group.level,
				"games": group.games,
			})
		}
		search := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("search")))
		if search != "" {
			items = slices.DeleteFunc(slices.Clone(items), func(item map[string]any) bool {
				return !strings.Contains(strings.ToLower(fmt.Sprint(item["name"])), search) && !strings.Contains(fmt.Sprint(item["ids"]), search)
			})
		}
		paged, page, pageSize := paginate(items, r)
		writeJSON(w, http.StatusOK, map[string]any{"items": paged, "total": len(items), "page": page, "pageSize": pageSize})
	case r.Method == http.MethodPost && action == "queue" && len(parts) >= 4 && parts[3] == "start":
		matchID, _ := strconv.Atoi(parts[2])
		var body struct {
			Court string `json:"court"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.Court == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "court is required"})
			return
		}
		if !startMatch(&state, matchID, body.Court) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "match not found"})
			return
		}
		a.respondSaved(w, r, state)
	case r.Method == http.MethodDelete && action == "queue" && len(parts) >= 3:
		matchID, _ := strconv.Atoi(parts[2])
		if !cancelQueuedMatch(&state, matchID) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "match not found"})
			return
		}
		a.respondSaved(w, r, state)
	case r.Method == http.MethodPatch && action == "live" && len(parts) >= 4 && parts[3] == "shuttles":
		matchID, _ := strconv.Atoi(parts[2])
		var body struct {
			Delta int `json:"delta"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		adjustShuttles(&state, matchID, body.Delta)
		a.respondSaved(w, r, state)
	case r.Method == http.MethodPost && action == "live" && len(parts) >= 4 && (parts[3] == "finish" || parts[3] == "cancel"):
		matchID, _ := strconv.Atoi(parts[2])
		var body struct {
			Note   string `json:"note"`
			Winner string `json:"winner"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if !closeLive(&state, matchID, parts[3] == "cancel", body.Note, body.Winner) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "match not found"})
			return
		}
		a.respondSaved(w, r, state)
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	}
}

func (a *app) respondSaved(w http.ResponseWriter, r *http.Request, state SessionState) {
	if err := a.saveState(r.Context(), state); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (a *app) saveState(ctx context.Context, state SessionState) error {
	state.UpdatedAt = time.Now().UTC()
	courtNames, err := json.Marshal(state.Settings.CourtNames)
	if err != nil {
		return err
	}
	levels, err := json.Marshal(state.Settings.Levels)
	if err != nil {
		return err
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.ExecContext(ctx, `
		insert into sessions (id, name, admin_passcode, updated_at)
		values ($1, $2, $3, now())
		on conflict (id) do update set
			name = excluded.name,
			admin_passcode = excluded.admin_passcode,
			updated_at = now()
	`, state.Session.ID, state.Session.Name, state.Session.AdminPasscode); err != nil {
		return err
	}

	if _, err = tx.ExecContext(ctx, `
		insert into session_settings (
			session_id, entry_fee, shuttle_fee, court_count, court_names, levels, allow_cross_level, cross_level_range, random_priority, show_payment_on_share
		)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		on conflict (session_id) do update set
			entry_fee = excluded.entry_fee,
			shuttle_fee = excluded.shuttle_fee,
			court_count = excluded.court_count,
			court_names = excluded.court_names,
			levels = excluded.levels,
			allow_cross_level = excluded.allow_cross_level,
			cross_level_range = excluded.cross_level_range,
			random_priority = excluded.random_priority,
			show_payment_on_share = excluded.show_payment_on_share
	`, state.Session.ID, state.Settings.EntryFee, state.Settings.ShuttleFee, state.Settings.CourtCount, courtNames, levels, state.Settings.AllowCrossLevel, state.Settings.CrossLevelRange, state.Settings.RandomPriority, state.Settings.ShowPaymentOnShare); err != nil {
		return err
	}

	for _, table := range []string{"players", "couples", "matches"} {
		if _, err = tx.ExecContext(ctx, "delete from "+table+" where session_id = $1", state.Session.ID); err != nil {
			return err
		}
	}

	for _, player := range state.Players {
		if _, err = tx.ExecContext(ctx, `
			insert into players (session_id, id, name, games, wins, losses, shuttles, paid, active, level, coupon)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		`, state.Session.ID, player.ID, player.Name, player.Games, player.Wins, player.Losses, player.Shuttles, player.Paid, player.Active, player.Level, player.Coupon); err != nil {
			return err
		}
	}

	for _, couple := range state.Couples {
		if _, err = tx.ExecContext(ctx, `
			insert into couples (session_id, id, player_a, player_b)
			values ($1, $2, $3, $4)
		`, state.Session.ID, couple.ID, couple.A, couple.B); err != nil {
			return err
		}
	}

	insertMatch := func(phase string, match Match) error {
		_, err := tx.ExecContext(ctx, `
			insert into matches (
				session_id, id, phase, court, level, a1, a2, b1, b2, shuttles, winner, shuttle_sequence, status, started_at, ended_at, note
			)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		`, state.Session.ID, match.ID, phase, match.Court, match.Level, match.A1, match.A2, match.B1, match.B2, match.Shuttles, match.Winner, match.ShuttleSeq, match.Status, match.StartedAt, match.EndedAt, match.Note)
		return err
	}
	for _, match := range state.Queue {
		if err = insertMatch("queue", match); err != nil {
			return err
		}
	}
	for _, match := range state.Live {
		if err = insertMatch("live", match); err != nil {
			return err
		}
	}
	for _, match := range state.History {
		if err = insertMatch("history", match); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (a *app) loadState(ctx context.Context, id string) (SessionState, error) {
	var name, passcode string
	var updatedAt time.Time
	if err := a.db.QueryRowContext(ctx, `
		select name, admin_passcode, updated_at from sessions where id = $1
	`, id).Scan(&name, &passcode, &updatedAt); err != nil {
		return SessionState{}, err
	}

	state := defaultState(id, name, passcode)
	state.Session.Unlocked = true
	state.UpdatedAt = updatedAt

	var courtNamesRaw, levelsRaw []byte
	err := a.db.QueryRowContext(ctx, `
		select entry_fee, shuttle_fee, court_count, court_names, levels, allow_cross_level, cross_level_range, random_priority, show_payment_on_share
		from session_settings
		where session_id = $1
	`, id).Scan(
		&state.Settings.EntryFee,
		&state.Settings.ShuttleFee,
		&state.Settings.CourtCount,
		&courtNamesRaw,
		&levelsRaw,
		&state.Settings.AllowCrossLevel,
		&state.Settings.CrossLevelRange,
		&state.Settings.RandomPriority,
		&state.Settings.ShowPaymentOnShare,
	)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return SessionState{}, err
	}
	if len(courtNamesRaw) > 0 {
		_ = json.Unmarshal(courtNamesRaw, &state.Settings.CourtNames)
	}
	if len(levelsRaw) > 0 {
		_ = json.Unmarshal(levelsRaw, &state.Settings.Levels)
	}
	normalizeSettings(&state.Settings)

	rows, err := a.db.QueryContext(ctx, `
		select id, name, games, wins, losses, shuttles, paid, active, level, coupon
		from players
		where session_id = $1
		order by id
	`, id)
	if err != nil {
		return SessionState{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var player Player
		if err := rows.Scan(&player.ID, &player.Name, &player.Games, &player.Wins, &player.Losses, &player.Shuttles, &player.Paid, &player.Active, &player.Level, &player.Coupon); err != nil {
			return SessionState{}, err
		}
		state.Players = append(state.Players, player)
		if player.ID > state.NextIDs.Player {
			state.NextIDs.Player = player.ID
		}
	}
	if err := rows.Err(); err != nil {
		return SessionState{}, err
	}

	rows, err = a.db.QueryContext(ctx, `
		select id, player_a, player_b
		from couples
		where session_id = $1
		order by id
	`, id)
	if err != nil {
		return SessionState{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var couple Couple
		if err := rows.Scan(&couple.ID, &couple.A, &couple.B); err != nil {
			return SessionState{}, err
		}
		state.Couples = append(state.Couples, couple)
		if couple.ID > state.NextIDs.Couple {
			state.NextIDs.Couple = couple.ID
		}
	}
	if err := rows.Err(); err != nil {
		return SessionState{}, err
	}

	rows, err = a.db.QueryContext(ctx, `
		select id, phase, court, level, a1, a2, b1, b2, shuttles, winner, shuttle_sequence, status, started_at, ended_at, note
		from matches
		where session_id = $1
		order by id
	`, id)
	if err != nil {
		return SessionState{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var phase string
		var match Match
		if err := rows.Scan(&match.ID, &phase, &match.Court, &match.Level, &match.A1, &match.A2, &match.B1, &match.B2, &match.Shuttles, &match.Winner, &match.ShuttleSeq, &match.Status, &match.StartedAt, &match.EndedAt, &match.Note); err != nil {
			return SessionState{}, err
		}
		switch phase {
		case "queue":
			state.Queue = append(state.Queue, match)
		case "live":
			state.Live = append(state.Live, match)
		case "history":
			state.History = append([]Match{match}, state.History...)
		}
		if match.ID > state.NextIDs.Match {
			state.NextIDs.Match = match.ID
		}
	}
	if err := rows.Err(); err != nil {
		return SessionState{}, err
	}

	return state, nil
}

func defaultState(id, name, passcode string) SessionState {
	return SessionState{
		Tab:   "home",
		Theme: "light",
		Session: SessionInfo{
			ID:            id,
			Name:          name,
			AdminPasscode: passcode,
			Unlocked:      false,
		},
		Settings: Settings{
			EntryFee:           120,
			ShuttleFee:         85,
			CourtCount:         4,
			CourtNames:         []string{"สนาม 1", "สนาม 2", "สนาม 3", "สนาม 4"},
			Levels:             []string{"light", "middle", "heavy"},
			AllowCrossLevel:    true,
			CrossLevelRange:    1,
			RandomPriority:     "level",
			ShowPaymentOnShare: true,
		},
		Players: []Player{},
		Couples: []Couple{},
		Queue:   []Match{},
		Live:    []Match{},
		History: []Match{},
		NextIDs: NextIDs{Player: 0, Couple: 0, Match: 0},
	}
}

func randomMatch(state *SessionState) error {
	busy := map[int]bool{}
	for _, match := range append(append([]Match{}, state.Queue...), state.Live...) {
		for _, id := range matchPlayers(match) {
			busy[id] = true
		}
	}

	levelIndex := map[string]int{}
	for i, level := range state.Settings.Levels {
		levelIndex[level] = i
	}

	created := 0
	for {
		groups := buildAvailableGroups(*state, busy)
		selected, level := pickRandomMatch(groups, state.Settings, levelIndex)
		if len(selected) < 4 {
			break
		}

		teams := keepCouplesTogether(selected, state.Couples)
		state.NextIDs.Match++
		state.Queue = append(state.Queue, Match{
			ID:    state.NextIDs.Match,
			Court: "-",
			Level: level,
			A1:    teams[0],
			A2:    teams[1],
			B1:    teams[2],
			B2:    teams[3],
		})
		for _, id := range selected {
			busy[id] = true
		}
		created++
	}
	if created == 0 {
		return errors.New("ผู้เล่นว่างที่พร้อมสุ่มไม่พอสำหรับจัดคู่")
	}
	return nil
}

type group struct {
	ids   []int
	level string
	games int
}

func buildAvailableGroups(state SessionState, busy map[int]bool) []group {
	playersByID := map[int]Player{}
	for _, p := range state.Players {
		playersByID[p.ID] = p
	}
	used := map[int]bool{}
	var groups []group
	for _, p := range state.Players {
		if used[p.ID] || !p.Active || !p.Coupon || busy[p.ID] {
			continue
		}
		if c, ok := coupleForPlayer(state.Couples, p.ID); ok {
			mateID := c.A
			if mateID == p.ID {
				mateID = c.B
			}
			mate, exists := playersByID[mateID]
			if exists && mate.Active && mate.Coupon && !busy[mateID] {
				groups = append(groups, group{ids: []int{p.ID, mateID}, level: p.Level, games: p.Games + mate.Games})
				used[p.ID], used[mateID] = true, true
				continue
			}
		}
		groups = append(groups, group{ids: []int{p.ID}, level: p.Level, games: p.Games})
		used[p.ID] = true
	}
	slices.SortFunc(groups, func(a, b group) int {
		if a.games != b.games {
			return a.games - b.games
		}
		return len(b.ids) - len(a.ids)
	})
	return groups
}

func pickFour(groups []group) []int {
	var selected []int
	for _, g := range groups {
		if len(selected)+len(g.ids) <= 4 {
			selected = append(selected, g.ids...)
		}
		if len(selected) == 4 {
			return selected
		}
	}
	return selected
}

func pickRandomMatch(groups []group, settings Settings, levelIndex map[string]int) ([]int, string) {
	if settings.RandomPriority == "games" {
		return pickRandomMatchByGames(groups, settings, levelIndex)
	}
	return pickRandomMatchByLevel(groups, settings, levelIndex)
}

func pickRandomMatchByLevel(groups []group, settings Settings, levelIndex map[string]int) ([]int, string) {
	for _, base := range settings.Levels {
		pool := []group{}
		for _, g := range groups {
			if g.level == base {
				pool = append(pool, g)
			}
		}
		selected := pickFour(pool)
		if len(selected) == 4 {
			return selected, base
		}
	}
	if settings.AllowCrossLevel {
		for _, base := range settings.Levels {
			pool := []group{}
			for _, g := range groups {
				if g.level == base || abs(levelIndex[g.level]-levelIndex[base]) <= settings.CrossLevelRange {
					pool = append(pool, g)
				}
			}
			selected := pickFour(pool)
			if len(selected) == 4 {
				return selected, base
			}
		}
	}
	return nil, ""
}

func pickRandomMatchByGames(groups []group, settings Settings, levelIndex map[string]int) ([]int, string) {
	if selected, level := bestMatchForLevels(groups, settings.Levels); len(selected) == 4 {
		return selected, level
	}
	if settings.AllowCrossLevel {
		var best []int
		bestLevel := ""
		bestGames := int(^uint(0) >> 1)
		for _, base := range settings.Levels {
			pool := []group{}
			for _, g := range groups {
				if g.level == base || abs(levelIndex[g.level]-levelIndex[base]) <= settings.CrossLevelRange {
					pool = append(pool, g)
				}
			}
			if selected := pickFour(pool); len(selected) == 4 {
				games := selectedGroupGames(pool, selected)
				if games < bestGames {
					best = selected
					bestLevel = base
					bestGames = games
				}
			}
		}
		if len(best) == 4 {
			return best, bestLevel
		}
	}
	return nil, ""
}

func bestMatchForLevels(groups []group, levels []string) ([]int, string) {
	var best []int
	bestLevel := ""
	bestGames := int(^uint(0) >> 1)
	for _, level := range levels {
		pool := []group{}
		for _, g := range groups {
			if g.level == level {
				pool = append(pool, g)
			}
		}
		selected := pickFour(pool)
		if len(selected) != 4 {
			continue
		}
		games := selectedGroupGames(pool, selected)
		if games < bestGames {
			best = selected
			bestLevel = level
			bestGames = games
		}
	}
	return best, bestLevel
}

func selectedGroupGames(groups []group, selected []int) int {
	selectedSet := map[int]bool{}
	for _, id := range selected {
		selectedSet[id] = true
	}
	total := 0
	for _, g := range groups {
		for _, id := range g.ids {
			if selectedSet[id] {
				total += g.games
				break
			}
		}
	}
	return total
}

func keepCouplesTogether(ids []int, couples []Couple) []int {
	for _, c := range couples {
		if slices.Contains(ids, c.A) && slices.Contains(ids, c.B) {
			rest := []int{}
			for _, id := range ids {
				if id != c.A && id != c.B {
					rest = append(rest, id)
				}
			}
			return []int{c.A, c.B, rest[0], rest[1]}
		}
	}
	return ids
}

func startMatch(state *SessionState, matchID int, court string) bool {
	for i, match := range state.Queue {
		if match.ID == matchID {
			state.Queue = append(state.Queue[:i], state.Queue[i+1:]...)
			match.Court = court
			match.Shuttles = 1
			match.Status = "กำลังเล่น"
			match.StartedAt = nowHHMM()
			state.Live = append(state.Live, match)
			return true
		}
	}
	return false
}

func cancelQueuedMatch(state *SessionState, matchID int) bool {
	for i, match := range state.Queue {
		if match.ID == matchID {
			state.Queue = append(state.Queue[:i], state.Queue[i+1:]...)
			return true
		}
	}
	return false
}

func adjustShuttles(state *SessionState, matchID, delta int) {
	for i := range state.Live {
		if state.Live[i].ID == matchID {
			state.Live[i].Shuttles += delta
			if state.Live[i].Shuttles < 0 {
				state.Live[i].Shuttles = 0
			}
		}
	}
}

func closeLive(state *SessionState, matchID int, cancelled bool, note string, winner string) bool {
	for i, match := range state.Live {
		if match.ID != matchID {
			continue
		}
		state.Live = append(state.Live[:i], state.Live[i+1:]...)
		match.EndedAt = nowHHMM()
		if note != "" {
			match.Note = note
		} else if cancelled {
			match.Note = "ยกเลิกการแข่งขัน"
		} else {
			match.Note = "จบการแข่งขัน"
		}
		if !cancelled {
			if winner != "A" && winner != "B" {
				winner = ""
			}
			match.Winner = winner
			match.ShuttleSeq = nextShuttleSequence(*state, match.Shuttles)
		}
		for j := range state.Players {
			if !cancelled && slices.Contains(matchPlayers(match), state.Players[j].ID) {
				state.Players[j].Games++
				state.Players[j].Shuttles += match.Shuttles
				if winner == "A" && (state.Players[j].ID == match.A1 || state.Players[j].ID == match.A2) {
					state.Players[j].Wins++
				} else if winner == "B" && (state.Players[j].ID == match.B1 || state.Players[j].ID == match.B2) {
					state.Players[j].Wins++
				} else if winner != "" {
					state.Players[j].Losses++
				}
			}
		}
		state.History = append([]Match{match}, state.History...)
		return true
	}
	return false
}

func nextShuttleSequence(state SessionState, used int) string {
	if used <= 0 {
		return ""
	}
	start := 1
	for _, match := range state.History {
		start += match.Shuttles
	}
	end := start + used - 1
	if start == end {
		return strconv.Itoa(start)
	}
	return fmt.Sprintf("%d-%d", start, end)
}

func matchPlayers(match Match) []int {
	return []int{match.A1, match.A2, match.B1, match.B2}
}

func coupleForPlayer(couples []Couple, id int) (Couple, bool) {
	for _, c := range couples {
		if c.A == id || c.B == id {
			return c, true
		}
	}
	return Couple{}, false
}

func removeCouplesForPlayers(couples []Couple, a, b int) []Couple {
	return slices.DeleteFunc(couples, func(c Couple) bool {
		return c.A == a || c.A == b || c.B == a || c.B == b
	})
}

func normalizeSettings(settings *Settings) {
	if settings.EntryFee < 0 {
		settings.EntryFee = 0
	}
	if settings.ShuttleFee < 0 {
		settings.ShuttleFee = 0
	}
	if len(settings.CourtNames) == 0 {
		settings.CourtNames = []string{"สนาม 1"}
	}
	settings.CourtCount = len(settings.CourtNames)
	if len(settings.Levels) == 0 {
		settings.Levels = []string{"light", "middle", "heavy"}
	}
	if settings.CrossLevelRange < 0 {
		settings.CrossLevelRange = 0
	}
	if settings.RandomPriority != "games" {
		settings.RandomPriority = "level"
	}
}

func firstLevel(state SessionState) string {
	if len(state.Settings.Levels) == 0 {
		return "middle"
	}
	return state.Settings.Levels[0]
}

func paginate[T any](items []T, r *http.Request) ([]T, int, int) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	start := (page - 1) * pageSize
	if start >= len(items) {
		return []T{}, page, pageSize
	}
	end := start + pageSize
	if end > len(items) {
		end = len(items)
	}
	return items[start:end], page, pageSize
}

func firstCourt(state SessionState) string {
	if len(state.Settings.CourtNames) == 0 {
		return "สนาม 1"
	}
	return state.Settings.CourtNames[0]
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func nowHHMM() string {
	location, err := time.LoadLocation("Asia/Bangkok")
	if err != nil {
		return time.Now().UTC().Add(7 * time.Hour).Format("15:04")
	}
	return time.Now().In(location).Format("15:04")
}

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return hex.EncodeToString(b)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("write json: %v", err)
	}
}
