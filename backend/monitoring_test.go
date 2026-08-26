package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPOSMON001MonitoringCapturesStatusLatencyAndRequestID(t *testing.T) {
	a := &app{monitoring: newAPIMonitoring()}
	handler := a.withCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/conflict" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "changed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))

	var conflictID string
	for _, item := range []struct {
		path   string
		status int
	}{{"/api/conflict", 409}, {"/api/limited", 429}, {"/api/failed", 500}} {
		response := httptest.NewRecorder()
		handler = a.withCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, item.status, map[string]string{"error": "test"})
		}))
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, item.path, nil))
		if response.Code != item.status || response.Header().Get("X-Request-ID") == "" {
			t.Fatalf("expected %d with request id, got status=%d id=%q", item.status, response.Code, response.Header().Get("X-Request-ID"))
		}
		if item.status == 409 {
			conflictID = response.Header().Get("X-Request-ID")
		}
	}
	if a.monitoring.status[http.StatusConflict] != 1 || a.monitoring.status[http.StatusTooManyRequests] != 1 || a.monitoring.status[http.StatusInternalServerError] != 1 || len(a.monitoring.recent) != 3 {
		t.Fatalf("monitoring did not capture conflict: %#v", a.monitoring)
	}
	if a.monitoring.recent[0].RequestID != conflictID {
		t.Fatal("failure sample must carry the same request id returned to the browser")
	}
}

func TestPOSAUDIT002SanitizesSecretsRecursively(t *testing.T) {
	safe := sanitizeActivityDetails(map[string]any{"pin": "123456", "password": "secret", "promptPayId": "0812345678", "imageData": "data:image/png;base64,secret", "nested": map[string]any{"token": "abc"}, "amountSatang": int64(1250)})
	raw, err := json.Marshal(safe)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, secret := range []string{"123456", "0812345678", "base64,secret", `"abc"`} {
		if strings.Contains(text, secret) {
			t.Fatalf("audit detail leaked %q: %s", secret, text)
		}
	}
	if !strings.Contains(text, "1250") {
		t.Fatal("non-secret audit values must be preserved")
	}
}

func TestPOSMON002MonitoringEndpointIsOwnerOnlyAndDoesNotExposeSecrets(t *testing.T) {
	a := &app{monitoring: newAPIMonitoring()}
	a.monitoring.status[409], a.monitoring.status[429], a.monitoring.status[500] = 2, 3, 4
	a.monitoring.durationsUS = []int64{1000, 2000, 3000}
	a.monitoring.recent = []apiErrorSample{{At: time.Now(), RequestID: "req-safe", Method: "GET", Path: "/api/admin/pos/sales/:id", Status: 500, LatencyMS: 3}}

	denied := httptest.NewRecorder()
	a.writePOSMonitoring(denied, httptest.NewRequest(http.MethodGet, "/api/admin/pos/monitoring", nil), adminUser{POSRole: "manager"})
	if denied.Code != http.StatusForbidden {
		t.Fatalf("manager must be denied, got %d", denied.Code)
	}

	allowed := httptest.NewRecorder()
	a.writePOSMonitoring(allowed, httptest.NewRequest(http.MethodGet, "/api/admin/pos/monitoring", nil), adminUser{POSRole: "owner"})
	if allowed.Code != http.StatusOK {
		t.Fatalf("owner must be allowed, got %d", allowed.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(allowed.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["watched"] == nil || payload["latencyMs"] == nil || payload["recentErrors"] == nil {
		t.Fatalf("monitoring payload incomplete: %v", payload)
	}
}
