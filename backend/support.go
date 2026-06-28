package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	maxSupportImages    = 5
	maxSupportImageSize = 3 << 20
	maxSupportBodySize  = 18 << 20
)

type supportIssue struct {
	ID              string   `json:"id"`
	Title           string   `json:"title"`
	Details         string   `json:"details"`
	Contact         string   `json:"contact"`
	Images          []string `json:"images,omitempty"`
	ImageCount      int      `json:"imageCount"`
	Status          string   `json:"status"`
	SupervisorReply string   `json:"supervisorReply"`
	CreatedAt       string   `json:"createdAt"`
	UpdatedAt       string   `json:"updatedAt"`
}

type supportRateEntry struct {
	windowStart time.Time
	count       int
}

var supportRateLimit = struct {
	sync.Mutex
	entries map[string]supportRateEntry
}{entries: map[string]supportRateEntry{}}

func supportClientIP(r *http.Request) string {
	if value := strings.TrimSpace(r.Header.Get("X-Real-IP")); value != "" {
		return value
	}
	if value := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]); value != "" {
		return value
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

func allowSupportSubmission(ip string, now time.Time) bool {
	supportRateLimit.Lock()
	defer supportRateLimit.Unlock()
	entry := supportRateLimit.entries[ip]
	if entry.windowStart.IsZero() || now.Sub(entry.windowStart) >= time.Hour {
		supportRateLimit.entries[ip] = supportRateEntry{windowStart: now, count: 1}
		return true
	}
	if entry.count >= 5 {
		return false
	}
	entry.count++
	supportRateLimit.entries[ip] = entry
	return true
}

func (a *app) handleSupportIssues(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	if !allowSupportSubmission(supportClientIP(r), time.Now()) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "ส่งรายการถี่เกินไป กรุณาลองใหม่ภายหลัง"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSupportBodySize)
	if err := r.ParseMultipartForm(maxSupportBodySize); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ข้อมูลหรือรูปภาพมีขนาดใหญ่เกินกำหนด"})
		return
	}
	title := strings.TrimSpace(r.FormValue("title"))
	details := strings.TrimSpace(r.FormValue("details"))
	contact := strings.TrimSpace(r.FormValue("contact"))
	if title == "" || details == "" || contact == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "กรุณากรอกชื่อปัญหา รายละเอียด และช่องทางติดต่อกลับ"})
		return
	}
	if len([]rune(title)) > 200 || len([]rune(details)) > 5000 || len([]rune(contact)) > 500 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ข้อความยาวเกินกำหนด"})
		return
	}

	files := r.MultipartForm.File["images"]
	if len(files) > maxSupportImages {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "แนบรูปได้สูงสุด 5 รูป"})
		return
	}
	images := make([]string, 0, len(files))
	for _, header := range files {
		file, err := header.Open()
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "อ่านรูปภาพไม่สำเร็จ"})
			return
		}
		raw, readErr := io.ReadAll(io.LimitReader(file, maxSupportImageSize+1))
		file.Close()
		if readErr != nil || len(raw) > maxSupportImageSize {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "รูปแต่ละไฟล์ต้องมีขนาดไม่เกิน 3MB"})
			return
		}
		mimeType := http.DetectContentType(raw)
		if mimeType != "image/jpeg" && mimeType != "image/png" && mimeType != "image/webp" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "รองรับเฉพาะรูป JPG, PNG และ WebP"})
			return
		}
		images = append(images, fmt.Sprintf("data:%s;base64,%s", mimeType, base64.StdEncoding.EncodeToString(raw)))
	}
	imagesJSON, _ := json.Marshal(images)
	id := "issue-" + randHex(6)
	if _, err := a.db.ExecContext(r.Context(), `
		insert into support_issues (id, title, details, contact, images)
		values ($1, $2, $3, $4, $5)
	`, id, title, details, contact, imagesJSON); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	a.insertActivityLog(r.Context(), "public", "anonymous", "submit_support_issue", "support_issue", id, map[string]any{"title": title, "imageCount": len(images)})
	a.notifyTelegramSupportIssue(r.Context(), supportIssue{
		ID:         id,
		Title:      title,
		Details:    details,
		Contact:    contact,
		Images:     images,
		ImageCount: len(images),
		Status:     "new",
	})
	writeJSON(w, http.StatusCreated, map[string]string{"id": id, "status": "new"})
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "..."
}

func supportTelegramText(issue supportIssue) string {
	return fmt.Sprintf(
		"LiveMatch แจ้งปัญหาใหม่\nเลขรายการ: %s\nชื่อปัญหา: %s\nติดต่อกลับ: %s\nรูปแนบ: %d รูป\n\nรายละเอียด:\n%s",
		issue.ID,
		issue.Title,
		issue.Contact,
		issue.ImageCount,
		truncateRunes(issue.Details, 2500),
	)
}

func supportTelegramKeyboard() map[string]any {
	return map[string]any{
		"inline_keyboard": [][]map[string]string{{
			{"text": "เปิด Backoffice", "url": strings.TrimRight(publicAppBaseURL(), "/") + "/backoffice"},
		}},
	}
}

func (a *app) notifyTelegramSupportIssue(ctx context.Context, issue supportIssue) {
	settings := a.telegramNotifySettings(ctx)
	if !settings.enabled() {
		return
	}
	client := &http.Client{Timeout: 12 * time.Second}
	messagePayload, _ := json.Marshal(map[string]any{
		"chat_id":      settings.ChatID,
		"text":         supportTelegramText(issue),
		"reply_markup": supportTelegramKeyboard(),
	})
	messageURL := "https://api.telegram.org/bot" + settings.BotToken + "/sendMessage"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, messageURL, bytes.NewReader(messagePayload))
	if err == nil {
		request.Header.Set("Content-Type", "application/json")
		var response *http.Response
		response, err = client.Do(request)
		if response != nil {
			defer response.Body.Close()
			if response.StatusCode < 200 || response.StatusCode >= 300 {
				body, _ := io.ReadAll(io.LimitReader(response.Body, 512))
				a.insertActivityLog(ctx, "system", "telegram", "telegram_support_notification_failed", "support_issue", issue.ID, map[string]any{"status": response.StatusCode, "body": string(body)})
			}
		}
	}
	if err != nil {
		a.insertActivityLog(ctx, "system", "telegram", "telegram_support_notification_failed", "support_issue", issue.ID, map[string]any{"error": err.Error()})
		return
	}
	if len(issue.Images) == 0 {
		return
	}
	if err := sendTelegramSupportMedia(ctx, client, settings, issue.Images); err != nil {
		a.insertActivityLog(ctx, "system", "telegram", "telegram_support_media_failed", "support_issue", issue.ID, map[string]any{"error": err.Error(), "imageCount": len(issue.Images)})
	}
}

func sendTelegramSupportMedia(ctx context.Context, client *http.Client, settings telegramNotifySettings, images []string) error {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("chat_id", settings.ChatID)
	media := make([]map[string]string, 0, len(images))
	for index, image := range images {
		raw, err := decodeDataURL(image)
		if err != nil {
			return err
		}
		attachment := fmt.Sprintf("image%d", index)
		media = append(media, map[string]string{"type": "photo", "media": "attach://" + attachment})
		part, err := writer.CreateFormFile(attachment, attachment+".jpg")
		if err != nil {
			return err
		}
		if _, err := part.Write(raw); err != nil {
			return err
		}
	}
	rawMedia, _ := json.Marshal(media)
	_ = writer.WriteField("media", string(rawMedia))
	if err := writer.Close(); err != nil {
		return err
	}
	url := "https://api.telegram.org/bot" + settings.BotToken + "/sendMediaGroup"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, url, &body)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		responseBody, _ := io.ReadAll(io.LimitReader(response.Body, 512))
		return fmt.Errorf("telegram media status %d: %s", response.StatusCode, string(responseBody))
	}
	return nil
}

func normalizeSupportStatus(value string) string {
	switch value {
	case "new", "in_progress", "resolved":
		return value
	default:
		return ""
	}
}

func (a *app) handleBackofficeSupportIssues(w http.ResponseWriter, r *http.Request, actor string) {
	action := strings.TrimPrefix(r.URL.Path, "/api/backoffice/support-issues")
	if action == "" || action == "/" {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		a.listBackofficeSupportIssues(w, r)
		return
	}
	id := strings.Trim(strings.TrimPrefix(action, "/"), " ")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing issue id"})
		return
	}
	switch r.Method {
	case http.MethodGet:
		a.getBackofficeSupportIssue(w, r, id)
	case http.MethodPut:
		a.updateBackofficeSupportIssue(w, r, id, actor)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (a *app) listBackofficeSupportIssues(w http.ResponseWriter, r *http.Request) {
	page, pageSize, offset := paginationParams(r, 20, 100)
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	conditions := []string{}
	args := []any{}
	if status != "" {
		status = normalizeSupportStatus(status)
		if status == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid status"})
			return
		}
		args = append(args, status)
		conditions = append(conditions, fmt.Sprintf("status = $%d", len(args)))
	}
	if search != "" {
		args = append(args, "%"+search+"%")
		placeholder := fmt.Sprintf("$%d", len(args))
		conditions = append(conditions, fmt.Sprintf("(id ilike %s or title ilike %s or contact ilike %s)", placeholder, placeholder, placeholder))
	}
	where := ""
	if len(conditions) > 0 {
		where = "where " + strings.Join(conditions, " and ")
	}
	var total int
	if err := a.db.QueryRowContext(r.Context(), "select count(*) from support_issues "+where, args...).Scan(&total); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	args = append(args, pageSize, offset)
	rows, err := a.db.QueryContext(r.Context(), fmt.Sprintf(`
		select id, title, details, contact, jsonb_array_length(images), status, supervisor_reply,
			to_char(created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI'),
			to_char(updated_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI')
		from support_issues
		%s
		order by created_at desc
		limit $%d offset $%d
	`, where, len(args)-1, len(args)), args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	items := []supportIssue{}
	for rows.Next() {
		var item supportIssue
		if err := rows.Scan(&item.ID, &item.Title, &item.Details, &item.Contact, &item.ImageCount, &item.Status, &item.SupervisorReply, &item.CreatedAt, &item.UpdatedAt); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		items = append(items, item)
	}
	var newCount int
	_ = a.db.QueryRowContext(r.Context(), `select count(*) from support_issues where status = 'new'`).Scan(&newCount)
	writeJSON(w, http.StatusOK, map[string]any{
		"issues":     items,
		"newCount":   newCount,
		"pagination": paginationPayload(page, pageSize, total),
	})
}

func (a *app) getBackofficeSupportIssue(w http.ResponseWriter, r *http.Request, id string) {
	var item supportIssue
	var imagesJSON []byte
	err := a.db.QueryRowContext(r.Context(), `
		select id, title, details, contact, images, jsonb_array_length(images), status, supervisor_reply,
			to_char(created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI'),
			to_char(updated_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI')
		from support_issues
		where id = $1
	`, id).Scan(&item.ID, &item.Title, &item.Details, &item.Contact, &imagesJSON, &item.ImageCount, &item.Status, &item.SupervisorReply, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "issue not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	_ = json.Unmarshal(imagesJSON, &item.Images)
	writeJSON(w, http.StatusOK, item)
}

func (a *app) updateBackofficeSupportIssue(w http.ResponseWriter, r *http.Request, id, actor string) {
	var body struct {
		Status          string `json:"status"`
		SupervisorReply string `json:"supervisorReply"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	body.Status = normalizeSupportStatus(strings.TrimSpace(body.Status))
	body.SupervisorReply = strings.TrimSpace(body.SupervisorReply)
	if body.Status == "" || len([]rune(body.SupervisorReply)) > 5000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid status or reply"})
		return
	}
	result, err := a.db.ExecContext(r.Context(), `
		update support_issues
		set status = $2, supervisor_reply = $3, updated_at = now()
		where id = $1
	`, id, body.Status, body.SupervisorReply)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "issue not found"})
		return
	}
	a.insertActivityLog(r.Context(), "backoffice", actor, "update_support_issue", "support_issue", id, map[string]any{"status": body.Status, "hasReply": body.SupervisorReply != ""})
	a.getBackofficeSupportIssue(w, r, id)
}
