package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type tournamentRealtimeEvent struct {
	ID           int64
	AdminID      string
	TournamentID string
	MatchID      string
	Type         string
	Payload      json.RawMessage
}

type tournamentRealtimeSubscription struct {
	adminID, tournamentID, directorID string
	public                            bool
	showUmpire                        bool
	channel                           chan tournamentRealtimeEvent
}

type tournamentRealtimeHub struct {
	db          *sql.DB
	mu          sync.RWMutex
	subscribers map[*tournamentRealtimeSubscription]struct{}
	lastID      int64
}

func newTournamentRealtimeHub(db *sql.DB) *tournamentRealtimeHub {
	h := &tournamentRealtimeHub{db: db, subscribers: map[*tournamentRealtimeSubscription]struct{}{}}
	_ = db.QueryRow(`select coalesce(max(id),0) from tournament_realtime_events`).Scan(&h.lastID)
	return h
}

func (h *tournamentRealtimeHub) run(ctx context.Context) {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.poll(ctx)
		}
	}
}

func (h *tournamentRealtimeHub) poll(ctx context.Context) {
	rows, err := h.db.QueryContext(ctx, `select id,admin_id,tournament_id,match_id,event_type,payload from tournament_realtime_events where id>$1 order by id limit 500`, h.lastID)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var event tournamentRealtimeEvent
		if rows.Scan(&event.ID, &event.AdminID, &event.TournamentID, &event.MatchID, &event.Type, &event.Payload) != nil {
			continue
		}
		if event.ID > h.lastID {
			h.lastID = event.ID
		}
		h.broadcast(event)
	}
}

func (h *tournamentRealtimeHub) broadcast(event tournamentRealtimeEvent) {
	h.mu.RLock()
	slow := []*tournamentRealtimeSubscription{}
	for sub := range h.subscribers {
		if sub.adminID != event.AdminID || (sub.tournamentID != "" && sub.tournamentID != event.TournamentID) {
			continue
		}
		if sub.directorID != "" {
			var payload map[string]any
			_ = json.Unmarshal(event.Payload, &payload)
			match, _ := payload["match"].(map[string]any)
			if stringValue(match["umpireId"], "") != sub.directorID {
				continue
			}
		}
		select {
		case sub.channel <- event:
		default:
			slow = append(slow, sub)
		}
	}
	h.mu.RUnlock()
	if len(slow) == 0 {
		return
	}
	// Disconnect slow clients instead of allowing stale scoreboards. EventSource
	// reconnects with Last-Event-ID and the durable catch-up query fills the gap.
	h.mu.Lock()
	for _, sub := range slow {
		if _, exists := h.subscribers[sub]; exists {
			delete(h.subscribers, sub)
			close(sub.channel)
		}
	}
	h.mu.Unlock()
}

func (h *tournamentRealtimeHub) subscribe(sub *tournamentRealtimeSubscription) func() {
	h.mu.Lock()
	h.subscribers[sub] = struct{}{}
	h.mu.Unlock()
	return func() {
		h.mu.Lock()
		if _, exists := h.subscribers[sub]; exists {
			delete(h.subscribers, sub)
			close(sub.channel)
		}
		h.mu.Unlock()
	}
}

func insertTournamentRealtimeEventTx(ctx context.Context, tx *sql.Tx, adminID, tournamentID, matchID, eventType string, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `insert into tournament_realtime_events(admin_id,tournament_id,match_id,event_type,payload) values($1,$2,$3,$4,$5)`, adminID, tournamentID, matchID, eventType, raw)
	return err
}

func tournamentLastEventID(r *http.Request) int64 {
	raw := strings.TrimSpace(r.Header.Get("Last-Event-ID"))
	if raw == "" {
		raw = strings.TrimSpace(r.URL.Query().Get("cursor"))
	}
	id, _ := strconv.ParseInt(raw, 10, 64)
	return max(0, id)
}

func writeTournamentSSEEvent(w http.ResponseWriter, flusher http.Flusher, event tournamentRealtimeEvent) {
	fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", event.ID, event.Type, event.Payload)
	flusher.Flush()
}

func tournamentEventForSubscription(event tournamentRealtimeEvent, sub *tournamentRealtimeSubscription) tournamentRealtimeEvent {
	if !sub.public || event.Type != "match_update" {
		return event
	}
	payload := map[string]any{}
	_ = json.Unmarshal(event.Payload, &payload)
	match, _ := payload["match"].(map[string]any)
	delete(match, "umpireId")
	delete(match, "version")
	if !sub.showUmpire {
		delete(match, "umpireName")
		if timeline, ok := match["timeline"].([]any); ok {
			for _, raw := range timeline {
				if item, ok := raw.(map[string]any); ok {
					item["actor"] = "กรรมการ"
				}
			}
		}
	}
	payload["match"] = match
	event.Payload, _ = json.Marshal(payload)
	return event
}

func writePublicTournamentManifest(w http.ResponseWriter, token, appKind string) {
	labels := map[string][2]string{
		"center":  {"LiveMatch Match Center", "LM Center"},
		"live":    {"LiveMatch Live Score", "LM Score"},
		"bracket": {"LiveMatch Bracket", "LM Bracket"},
		"venue":   {"LiveMatch Venue TV", "LM Venue"},
		"players": {"LiveMatch Players", "LM Players"},
		"rules":   {"LiveMatch Rules", "LM Rules"},
	}
	label, valid := labels[appKind]
	if !valid {
		appKind, label = "center", labels["center"]
	}
	manifest := map[string]any{
		"id":   "/pwa/public/" + tournamentSecretDigest(token)[:16] + "/" + appKind,
		"name": label[0], "short_name": label[1], "display": "standalone",
		"orientation": map[bool]string{true: "landscape", false: "any"}[appKind == "venue"],
		"theme_color": "#142642", "background_color": "#0B121C", "scope": "/",
		"start_url": "/?mode=public&tournament=" + token + "&tab=" + appKind + "&kiosk=1&pwa=1",
		"icons": []any{
			map[string]any{"src": "/pwa-192x192.png", "sizes": "192x192", "type": "image/png"},
			map[string]any{"src": "/pwa-512x512.png", "sizes": "512x512", "type": "image/png"},
			map[string]any{"src": "/pwa-maskable-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
		},
	}
	raw, _ := json.Marshal(manifest)
	w.Header().Set("Content-Type", "application/manifest+json")
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

func (a *app) serveTournamentRealtime(w http.ResponseWriter, r *http.Request, sub *tournamentRealtimeSubscription) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, 501, map[string]string{"error": "stream unsupported"})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	fmt.Fprint(w, "retry: 3000\nevent: connected\ndata: {}\n\n")
	flusher.Flush()

	cursor := tournamentLastEventID(r)
	if cursor > 0 {
		rows, err := a.db.QueryContext(r.Context(), `select id,admin_id,tournament_id,match_id,event_type,payload from tournament_realtime_events where admin_id=$1 and ($2='' or tournament_id=$2) and id>$3 order by id limit 1000`, sub.adminID, sub.tournamentID, cursor)
		if err == nil {
			for rows.Next() {
				var event tournamentRealtimeEvent
				if rows.Scan(&event.ID, &event.AdminID, &event.TournamentID, &event.MatchID, &event.Type, &event.Payload) == nil {
					if sub.directorID != "" {
						var payload map[string]any
						_ = json.Unmarshal(event.Payload, &payload)
						match, _ := payload["match"].(map[string]any)
						if stringValue(match["umpireId"], "") != sub.directorID {
							continue
						}
					}
					writeTournamentSSEEvent(w, flusher, tournamentEventForSubscription(event, sub))
				}
			}
			rows.Close()
		}
	}

	unsub := a.tournamentHub.subscribe(sub)
	defer unsub()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			fmt.Fprint(w, ": heartbeat\n\n")
			flusher.Flush()
		case event, ok := <-sub.channel:
			if !ok {
				return
			}
			writeTournamentSSEEvent(w, flusher, tournamentEventForSubscription(event, sub))
		}
	}
}
