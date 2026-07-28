package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

type authSessionKind string

const (
	adminSessionKind      authSessionKind = "admin"
	backofficeSessionKind authSessionKind = "backoffice"
	publicSessionKind     authSessionKind = "public"
	sessionRotateAfter                    = 30 * time.Minute
	sessionPreviousGrace                  = 30 * time.Second
)

type authSessionConfig struct {
	table, ownerColumn, legacyCookie, productionCookie string
	idle, absolute                                     time.Duration
	sameSite                                           http.SameSite
}

type authFailureMap map[authSessionKind]string

const authFailureContextKey requestContextKey = "auth_failure"

func sessionConfig(kind authSessionKind) authSessionConfig {
	switch kind {
	case backofficeSessionKind:
		return authSessionConfig{"backoffice_sessions", "username", backofficeCookieName, "__Host-livematch_backoffice_session", 30 * time.Minute, 12 * time.Hour, http.SameSiteStrictMode}
	case publicSessionKind:
		return authSessionConfig{"public_user_sessions", "public_user_id", publicCookieName, "__Host-livematch_public_session", 3 * 24 * time.Hour, 7 * 24 * time.Hour, http.SameSiteLaxMode}
	default:
		return authSessionConfig{"admin_sessions", "admin_id", adminCookieName, "__Host-livematch_admin_session", 2 * time.Hour, 24 * time.Hour, http.SameSiteStrictMode}
	}
}

func productionCookies() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("APP_ENV")), "production")
}

func authCookieName(kind authSessionKind) string {
	cfg := sessionConfig(kind)
	if productionCookies() {
		return cfg.productionCookie
	}
	return cfg.legacyCookie
}

func readSessionCookie(r *http.Request, kind authSessionKind) (string, bool) {
	cfg := sessionConfig(kind)
	for _, name := range []string{authCookieName(kind), cfg.legacyCookie} {
		cookie, err := r.Cookie(name)
		if err == nil && strings.TrimSpace(cookie.Value) != "" {
			return cookie.Value, true
		}
	}
	return "", false
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, kind authSessionKind, token string) {
	cfg := sessionConfig(kind)
	secure := r.TLS != nil || strings.EqualFold(os.Getenv("COOKIE_SECURE"), "true")
	http.SetCookie(w, &http.Cookie{Name: authCookieName(kind), Value: token, Path: "/", HttpOnly: true, Secure: secure, SameSite: cfg.sameSite, MaxAge: int(cfg.absolute.Seconds())})
}

func clearSessionCookies(w http.ResponseWriter, r *http.Request, kind authSessionKind) {
	cfg := sessionConfig(kind)
	secure := r.TLS != nil || strings.EqualFold(os.Getenv("COOKIE_SECURE"), "true")
	names := map[string]bool{cfg.legacyCookie: true, cfg.productionCookie: true, authCookieName(kind): true}
	for name := range names {
		http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", HttpOnly: true, Secure: secure, SameSite: cfg.sameSite, MaxAge: -1})
	}
}

func clearLegacySessionCookie(w http.ResponseWriter, r *http.Request, kind authSessionKind) {
	cfg := sessionConfig(kind)
	if cfg.legacyCookie == authCookieName(kind) {
		return
	}
	secure := r.TLS != nil || strings.EqualFold(os.Getenv("COOKIE_SECURE"), "true")
	http.SetCookie(w, &http.Cookie{Name: cfg.legacyCookie, Value: "", Path: "/", HttpOnly: true, Secure: secure, SameSite: cfg.sameSite, MaxAge: -1})
}

func insertAuthSession(ctx context.Context, q interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, kind authSessionKind, ownerID, token string) error {
	cfg := sessionConfig(kind)
	now := time.Now().UTC()
	idleExpiry := now.Add(cfg.idle)
	absoluteExpiry := now.Add(cfg.absolute)
	_, err := q.ExecContext(ctx, fmt.Sprintf(`insert into %s (session_id,token_hash,%s,created_at,last_seen_at,idle_expires_at,absolute_expires_at,rotate_after,expires_at) values ($1,$2,$3,$4,$4,$5,$6,$7,$5)`, cfg.table, cfg.ownerColumn), "auth-"+randHex(12), tokenDigest(token), ownerID, now, idleExpiry, absoluteExpiry, now.Add(sessionRotateAfter))
	return err
}

type rotateResult struct {
	newToken string
	failure  string
	ownerID  string
	session  string
}

func (a *app) rotateAuthSession(ctx context.Context, kind authSessionKind, rawToken string) rotateResult {
	cfg := sessionConfig(kind)
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return rotateResult{}
	}
	defer tx.Rollback()
	hash := tokenDigest(rawToken)
	query := fmt.Sprintf(`select session_id,%s,token_hash,previous_token_hash,previous_valid_until,idle_expires_at,absolute_expires_at,rotate_after,revoked_at from %s where token_hash=$1 or previous_token_hash=$1 for update`, cfg.ownerColumn, cfg.table)
	var sessionID, ownerID, currentHash, previousHash string
	var previousUntil, idleExpiry, absoluteExpiry, rotateAfter, revokedAt sql.NullTime
	if err = tx.QueryRowContext(ctx, query, hash).Scan(&sessionID, &ownerID, &currentHash, &previousHash, &previousUntil, &idleExpiry, &absoluteExpiry, &rotateAfter, &revokedAt); err != nil {
		return rotateResult{}
	}
	now := time.Now().UTC()
	result := rotateResult{ownerID: ownerID, session: sessionID}
	if revokedAt.Valid {
		result.failure = "session_revoked"
		return result
	}
	if kind == backofficeSessionKind {
		var active bool
		if err = tx.QueryRowContext(ctx, `select active from backoffice_users where username=$1`, ownerID).Scan(&active); err != nil || !active {
			result.failure = "session_revoked"
			_, _ = tx.ExecContext(ctx, `update backoffice_sessions set revoked_at=coalesce(revoked_at,now()) where username=$1`, ownerID)
			_ = tx.Commit()
			return result
		}
	}
	if absoluteExpiry.Valid && !absoluteExpiry.Time.After(now) {
		result.failure = "session_absolute_expired"
		_, _ = tx.ExecContext(ctx, fmt.Sprintf(`update %s set revoked_at=coalesce(revoked_at,now()) where session_id=$1`, cfg.table), sessionID)
		_ = tx.Commit()
		return result
	}
	if idleExpiry.Valid && !idleExpiry.Time.After(now) {
		result.failure = "session_idle_expired"
		_, _ = tx.ExecContext(ctx, fmt.Sprintf(`update %s set revoked_at=coalesce(revoked_at,now()) where session_id=$1`, cfg.table), sessionID)
		_ = tx.Commit()
		return result
	}
	usingPrevious := hash == previousHash && hash != currentHash
	if usingPrevious && (!previousUntil.Valid || !previousUntil.Time.After(now)) {
		result.failure = "session_reuse_detected"
		_, _ = tx.ExecContext(ctx, fmt.Sprintf(`update %s set revoked_at=now(),reuse_detected_at=now() where session_id=$1`, cfg.table), sessionID)
		if err = tx.Commit(); err == nil {
			a.insertActivityLog(ctx, string(kind), ownerID, "session_token_reuse_detected", "auth_session", sessionID, map[string]any{"sessionKind": kind})
		}
		return result
	}
	newIdle := now.Add(cfg.idle)
	if absoluteExpiry.Valid && newIdle.After(absoluteExpiry.Time) {
		newIdle = absoluteExpiry.Time
	}
	if !usingPrevious && (!rotateAfter.Valid || !rotateAfter.Time.After(now)) {
		result.newToken = randHex(24)
		newRotate := now.Add(sessionRotateAfter)
		if absoluteExpiry.Valid && newRotate.After(absoluteExpiry.Time) {
			newRotate = absoluteExpiry.Time
		}
		_, err = tx.ExecContext(ctx, fmt.Sprintf(`update %s set token_hash=$2,previous_token_hash=$3,previous_valid_until=$4,last_seen_at=$5,idle_expires_at=$6,expires_at=$6,rotate_after=$7 where session_id=$1`, cfg.table), sessionID, tokenDigest(result.newToken), currentHash, now.Add(sessionPreviousGrace), now, newIdle, newRotate)
	} else {
		_, err = tx.ExecContext(ctx, fmt.Sprintf(`update %s set last_seen_at=$2,idle_expires_at=$3,expires_at=$3 where session_id=$1`, cfg.table), sessionID, now, newIdle)
	}
	if err != nil || tx.Commit() != nil {
		return rotateResult{}
	}
	return result
}

func (a *app) refreshRequestSessions(w http.ResponseWriter, r *http.Request) *http.Request {
	failures := authFailureMap{}
	for _, kind := range []authSessionKind{adminSessionKind, backofficeSessionKind, publicSessionKind} {
		token, ok := readSessionCookie(r, kind)
		if !ok {
			continue
		}
		result := a.rotateAuthSession(r.Context(), kind, token)
		if result.failure != "" {
			failures[kind] = result.failure
			clearSessionCookies(w, r, kind)
			continue
		}
		if result.newToken != "" {
			setSessionCookie(w, r, kind, result.newToken)
			r.Header.Set("Cookie", replaceRequestCookie(r, kind, authCookieName(kind), result.newToken))
		} else if productionCookies() && result.session != "" {
			// Seamlessly migrate a valid legacy production cookie to the __Host- name.
			setSessionCookie(w, r, kind, token)
			r.Header.Set("Cookie", replaceRequestCookie(r, kind, authCookieName(kind), token))
		}
		if productionCookies() && result.session != "" {
			clearLegacySessionCookie(w, r, kind)
		}
	}
	return r.WithContext(context.WithValue(r.Context(), authFailureContextKey, failures))
}

func replaceRequestCookie(r *http.Request, kind authSessionKind, name, value string) string {
	parts := []string{}
	cfg := sessionConfig(kind)
	for _, cookie := range r.Cookies() {
		if cookie.Name != name && cookie.Name != cfg.legacyCookie && cookie.Name != cfg.productionCookie {
			parts = append(parts, cookie.Name+"="+cookie.Value)
		}
	}
	parts = append(parts, name+"="+value)
	return strings.Join(parts, "; ")
}

func authFailure(r *http.Request, kind authSessionKind) string {
	if failures, ok := r.Context().Value(authFailureContextKey).(authFailureMap); ok {
		return failures[kind]
	}
	return ""
}

func writeAuthFailure(w http.ResponseWriter, r *http.Request, kind authSessionKind) {
	code := authFailure(r, kind)
	if code == "" {
		code = "not_logged_in"
	}
	writeJSON(w, http.StatusUnauthorized, map[string]string{"error": code, "code": code})
}
