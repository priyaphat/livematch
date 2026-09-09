package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestSlipOKAuditLogIntegration(t *testing.T) {
	dsn := os.Getenv("LIVEMATCH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set LIVEMATCH_TEST_DATABASE_URL to run OKSlip log integration tests")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	a := &app{db: db}
	adminID := "slipok-log-test-" + randHex(8)
	otherAdminID := "slipok-log-other-" + randHex(8)
	for _, user := range []struct{ id, email string }{{adminID, adminID + "@example.invalid"}, {otherAdminID, otherAdminID + "@example.invalid"}} {
		if _, err = db.Exec(`insert into admin_users(id,email,name,password_hash,verified_at) values($1,$2,'SlipOK log test','unused',now())`, user.id, user.email); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		_, _ = db.Exec(`delete from slipok_logs where admin_id in ($1,$2)`, adminID, otherAdminID)
		_, _ = db.Exec(`delete from admin_users where id in ($1,$2)`, adminID, otherAdminID)
	}()

	// The local monthly limit must be reserved atomically, even when several
	// booking uploads arrive at the same time.
	limited := slipOKSettings{Enabled: true, BranchID: "branch-test", APIKey: "key", MonthlyCap: 3, LimitEnabled: true}
	start := make(chan struct{})
	results := make(chan bool, 10)
	var wg sync.WaitGroup
	for range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			reserved, _, reserveErr := a.reserveSlipOKUsage(t.Context(), adminID, "booking", limited)
			if reserveErr != nil {
				t.Errorf("reserve usage: %v", reserveErr)
			}
			results <- reserved
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	reservedCount := 0
	for reserved := range results {
		if reserved {
			reservedCount++
		}
	}
	usage := a.slipOKUsage(t.Context(), adminID, "booking", limited, false)
	if reservedCount != 3 || usage.Used != 3 || !usage.CapReached || usage.Remaining == nil || *usage.Remaining != 0 {
		t.Fatalf("atomic monthly limit reserved=%d usage=%#v", reservedCount, usage)
	}

	settings := slipOKSettings{Enabled: true, BranchID: "branch-test", APIKey: "must-not-be-logged", MonthlyCap: 100}
	meta := slipOKLogMeta{AdminID: adminID, SourceSystem: "booking", ReferenceID: "booking-ref-1"}
	a.recordSlipOKDecision(meta, settings, 120, "disabled", "ไม่ได้ส่งตรวจ: ปิดใช้งาน", map[string]any{"enabled": false})
	a.recordSlipOKDecision(slipOKLogMeta{AdminID: adminID, SourceSystem: "coin_shop", ReferenceID: "coin-ref-1"}, settings, 500, "config_not_ready", "ตั้งค่าไม่ครบ", map[string]any{"hasApiKey": false})
	a.recordSlipOKDecision(slipOKLogMeta{AdminID: adminID, SourceSystem: "booking", ReferenceID: "booking-ref-2"}, settings, 240, "quota_error", "ตรวจสอบโควตาไม่สำเร็จ", map[string]any{"error": "provider unavailable"})
	a.recordSlipOKDecision(slipOKLogMeta{AdminID: otherAdminID, SourceSystem: "booking", ReferenceID: "other-ref-1"}, settings, 300, "cap_reached", "โควตาเต็ม", map[string]any{"limit": 100, "used": 100})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-authorization") != settings.APIKey {
			t.Errorf("missing OKSlip authorization header")
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"success": true,
			"data": map[string]any{
				"success":        true,
				"message":        "OK",
				"transRef":       "AUDIT-TX-1",
				"transTimestamp": "2026-09-03T08:00:00.000Z",
				"amount":         120,
				"receiver":       map[string]any{"displayName": "LiveMatch"},
			},
		})
	}))
	defer server.Close()
	previousBaseURL := slipOKAPIBaseURL
	slipOKAPIBaseURL = server.URL
	defer func() { slipOKAPIBaseURL = previousBaseURL }()
	checked := a.checkSlipOK(t.Context(), settings, "data:image/png;base64,aGVsbG8=", 120, slipOKLogMeta{AdminID: adminID, SourceSystem: "booking", ReferenceID: "booking-ref-3"})
	if !checked.Passed || checked.TransRef != "AUDIT-TX-1" {
		t.Fatalf("unexpected OKSlip check result: %#v", checked)
	}

	var total int
	if err = db.QueryRow(`select count(*) from slipok_logs where admin_id in ($1,$2)`, adminID, otherAdminID).Scan(&total); err != nil || total != 5 {
		t.Fatalf("audit log rows=%d err=%v, want 5", total, err)
	}
	var secretLeaks, imageLeaks int
	if err = db.QueryRow(`select count(*) filter(where request_payload like '%must-not-be-logged%' or response_payload like '%must-not-be-logged%'),count(*) filter(where request_payload like '%aGVsbG8=%') from slipok_logs where admin_id in ($1,$2)`, adminID, otherAdminID).Scan(&secretLeaks, &imageLeaks); err != nil {
		t.Fatal(err)
	}
	if secretLeaks != 0 || imageLeaks != 0 {
		t.Fatalf("sensitive OKSlip data leaked into audit log: secret=%d image=%d", secretLeaks, imageLeaks)
	}
	var precheckMethods, quotaMethods, postMethods int
	if err = db.QueryRow(`select count(*) filter(where request_method='PRECHECK'),count(*) filter(where request_method='GET' and request_url like '%/quota'),count(*) filter(where request_method='POST') from slipok_logs where admin_id in ($1,$2)`, adminID, otherAdminID).Scan(&precheckMethods, &quotaMethods, &postMethods); err != nil {
		t.Fatal(err)
	}
	if precheckMethods != 2 || quotaMethods != 2 || postMethods != 1 {
		t.Fatalf("audit request methods = precheck:%d quota:%d post:%d, want 2,2,1", precheckMethods, quotaMethods, postMethods)
	}

	type logItem struct {
		AdminID      string `json:"adminId"`
		SourceSystem string `json:"sourceSystem"`
		ReferenceID  string `json:"referenceId"`
		ResultStatus string `json:"resultStatus"`
		TransRef     string `json:"transRef"`
	}
	type logResponse struct {
		Items      []logItem `json:"items"`
		Pagination struct {
			Page       int `json:"page"`
			PageSize   int `json:"pageSize"`
			Total      int `json:"total"`
			TotalPages int `json:"totalPages"`
		} `json:"pagination"`
	}
	requestLogs := func(rawQuery string) logResponse {
		t.Helper()
		recorder := httptest.NewRecorder()
		a.handleBackofficeSlipOKLogs(recorder, httptest.NewRequest(http.MethodGet, "/api/backoffice/slipok-logs?"+rawQuery, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("list logs status=%d body=%s", recorder.Code, recorder.Body.String())
		}
		var payload logResponse
		if decodeErr := json.NewDecoder(recorder.Body).Decode(&payload); decodeErr != nil {
			t.Fatal(decodeErr)
		}
		return payload
	}

	firstPage := requestLogs("userId=" + adminID + "&page=1&pageSize=2")
	if len(firstPage.Items) != 2 || firstPage.Pagination.Total != 4 || firstPage.Pagination.TotalPages != 2 {
		t.Fatalf("user pagination=%#v items=%#v", firstPage.Pagination, firstPage.Items)
	}
	secondPage := requestLogs("userId=" + adminID + "&page=2&pageSize=2")
	if len(secondPage.Items) != 2 || secondPage.Pagination.Page != 2 {
		t.Fatalf("second page=%#v items=%#v", secondPage.Pagination, secondPage.Items)
	}
	filtered := requestLogs("userId=" + adminID + "&system=booking&status=quota_error&search=provider%20unavailable")
	if len(filtered.Items) != 1 || filtered.Items[0].ReferenceID != "booking-ref-2" || filtered.Items[0].ResultStatus != "quota_error" {
		t.Fatalf("combined filters returned %#v", filtered.Items)
	}
	passed := requestLogs("userId=" + adminID + "&status=passed&search=AUDIT-TX-1")
	if len(passed.Items) != 1 || passed.Items[0].TransRef != "AUDIT-TX-1" {
		t.Fatalf("provider response log returned %#v", passed.Items)
	}
	for _, item := range append(firstPage.Items, secondPage.Items...) {
		if item.AdminID != adminID || strings.TrimSpace(item.SourceSystem) == "" {
			t.Fatalf("user isolation/source metadata failed: %#v", item)
		}
	}

	previousMonth := slipOKMonthStart(time.Now()).AddDate(0, -1, 0)
	if _, err = db.Exec(`insert into slipok_monthly_usage(admin_id,source_system,month_start,used) values($1,'booking',$2,7) on conflict(admin_id,source_system,month_start) do update set used=excluded.used`, adminID, previousMonth.Format("2006-01-02")); err != nil {
		t.Fatal(err)
	}
	usageRecorder := httptest.NewRecorder()
	usageRequest := httptest.NewRequest(http.MethodGet, "/api/backoffice/admins/"+adminID+"/slipok-usage?month="+previousMonth.Format("2006-01")+"&includeProvider=0", nil)
	a.handleBackofficeAdminSlipOKUsage(usageRecorder, usageRequest)
	if usageRecorder.Code != http.StatusOK {
		t.Fatalf("admin SlipOK usage status=%d body=%s", usageRecorder.Code, usageRecorder.Body.String())
	}
	var usagePayload struct {
		Month     string           `json:"month"`
		Used      int              `json:"used"`
		TotalUsed int              `json:"totalUsed"`
		History   []map[string]any `json:"history"`
		Provider  json.RawMessage  `json:"provider"`
	}
	if err = json.NewDecoder(usageRecorder.Body).Decode(&usagePayload); err != nil {
		t.Fatal(err)
	}
	if usagePayload.Month != previousMonth.Format("2006-01") || usagePayload.Used != 7 || usagePayload.TotalUsed < 10 || len(usagePayload.History) < 2 || len(usagePayload.Provider) != 0 {
		t.Fatalf("unexpected historical usage payload: %#v body=%s", usagePayload, usageRecorder.Body.String())
	}
}
