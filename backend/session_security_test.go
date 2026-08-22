package main

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestSessionCookieProfiles(t *testing.T) {
	tests := []struct {
		kind     authSessionKind
		idle     time.Duration
		absolute time.Duration
		sameSite http.SameSite
	}{
		{adminSessionKind, 2 * time.Hour, 24 * time.Hour, http.SameSiteStrictMode},
		{backofficeSessionKind, 30 * time.Minute, 12 * time.Hour, http.SameSiteStrictMode},
		{publicSessionKind, 3 * 24 * time.Hour, 7 * 24 * time.Hour, http.SameSiteLaxMode},
	}
	for _, tt := range tests {
		cfg := sessionConfig(tt.kind)
		if cfg.idle != tt.idle || cfg.absolute != tt.absolute || cfg.sameSite != tt.sameSite {
			t.Fatalf("unexpected %s session profile: %#v", tt.kind, cfg)
		}
	}
}

func TestProductionSessionCookieUsesHostPrefix(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("COOKIE_SECURE", "true")
	req := httptest.NewRequest(http.MethodGet, "https://example.test/api/auth/me", nil)
	rec := httptest.NewRecorder()
	setSessionCookie(rec, req, adminSessionKind, "opaque-token")
	cookie := rec.Result().Cookies()[0]
	if cookie.Name != "__Host-livematch_admin_session" || !cookie.HttpOnly || !cookie.Secure || cookie.Path != "/" || cookie.Domain != "" || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("unsafe production cookie: %#v", cookie)
	}
}

func TestSessionCookieCanFollowRememberPreference(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "http://example.test/api/auth/login", nil)
	persistentRecorder := httptest.NewRecorder()
	setSessionCookiePersistence(persistentRecorder, req, adminSessionKind, "remembered-token", true)
	if cookie := persistentRecorder.Result().Cookies()[0]; cookie.MaxAge <= 0 {
		t.Fatalf("remembered login must set a persistent cookie: %#v", cookie)
	}

	sessionRecorder := httptest.NewRecorder()
	setSessionCookiePersistence(sessionRecorder, req, adminSessionKind, "session-token", false)
	if cookie := sessionRecorder.Result().Cookies()[0]; cookie.MaxAge != 0 {
		t.Fatalf("login without remember must set a browser-session cookie: %#v", cookie)
	}
}

func TestLegacyCookieCanBeReadDuringMigration(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	req := httptest.NewRequest(http.MethodGet, "https://example.test/api/auth/me", nil)
	req.AddCookie(&http.Cookie{Name: adminCookieName, Value: "legacy-token"})
	if token, ok := readSessionCookie(req, adminSessionKind); !ok || token != "legacy-token" {
		t.Fatalf("legacy cookie was not accepted: %q %v", token, ok)
	}
}

func TestRotatingSessionIntegration(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("LIVEMATCH_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run PostgreSQL session integration tests")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &app{db: db}
	adminID := "session-security-" + randHex(8)
	if _, err = db.Exec(`insert into admin_users (id,email,name,password_hash,verified_at) values ($1,$2,'Session security test','unused',now())`, adminID, adminID+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(`delete from activity_logs where actor_id=$1`, adminID)
		_, _ = db.Exec(`delete from admin_users where id=$1`, adminID)
	}()

	raw := randHex(24)
	if err = insertAuthSession(t.Context(), db, adminSessionKind, adminID, raw); err != nil {
		t.Fatal(err)
	}
	authRequest := httptest.NewRequest(http.MethodGet, "http://localhost/api/auth/me", nil)
	authRequest.AddCookie(&http.Cookie{Name: authCookieName(adminSessionKind), Value: raw})
	if user, ok := a.currentAdmin(t.Context(), authRequest); !ok || user.ID != adminID || user.POSAdminNumber == 0 {
		t.Fatalf("new admin session was not readable through currentAdmin: user=%#v ok=%v", user, ok)
	}
	if _, err = db.Exec(`update admin_sessions set rotate_after=now()-interval '1 second' where admin_id=$1`, adminID); err != nil {
		t.Fatal(err)
	}
	rotated := a.rotateAuthSession(t.Context(), adminSessionKind, raw)
	if rotated.failure != "" || rotated.newToken == "" {
		t.Fatalf("rotation failed: %#v", rotated)
	}
	grace := a.rotateAuthSession(t.Context(), adminSessionKind, raw)
	if grace.failure != "" {
		t.Fatalf("previous token should work during grace: %#v", grace)
	}
	if _, err = db.Exec(`update admin_sessions set previous_valid_until=now()-interval '1 second' where admin_id=$1`, adminID); err != nil {
		t.Fatal(err)
	}
	reused := a.rotateAuthSession(t.Context(), adminSessionKind, raw)
	if reused.failure != "session_reuse_detected" {
		t.Fatalf("expected reuse detection, got %#v", reused)
	}
	var revoked, detected bool
	if err = db.QueryRow(`select revoked_at is not null,reuse_detected_at is not null from admin_sessions where admin_id=$1`, adminID).Scan(&revoked, &detected); err != nil || !revoked || !detected {
		t.Fatalf("session family was not revoked: revoked=%v detected=%v err=%v", revoked, detected, err)
	}

	idleToken := randHex(24)
	if err = insertAuthSession(t.Context(), db, adminSessionKind, adminID, idleToken); err != nil {
		t.Fatal(err)
	}
	_, _ = db.Exec(`update admin_sessions set idle_expires_at=now()-interval '1 second' where token_hash=$1`, tokenDigest(idleToken))
	if expired := a.rotateAuthSession(t.Context(), adminSessionKind, idleToken); expired.failure != "session_idle_expired" {
		t.Fatalf("expected idle expiry code, got %#v", expired)
	}

	absoluteToken := randHex(24)
	if err = insertAuthSession(t.Context(), db, adminSessionKind, adminID, absoluteToken); err != nil {
		t.Fatal(err)
	}
	_, _ = db.Exec(`update admin_sessions set absolute_expires_at=now()-interval '1 second' where token_hash=$1`, tokenDigest(absoluteToken))
	if expired := a.rotateAuthSession(t.Context(), adminSessionKind, absoluteToken); expired.failure != "session_absolute_expired" {
		t.Fatalf("expected absolute expiry code, got %#v", expired)
	}
}
