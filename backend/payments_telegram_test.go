package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEditTelegramOrderResultEditsCaptionWithoutSendingPhoto(t *testing.T) {
	originalBase := telegramAPIBaseURL
	defer func() { telegramAPIBaseURL = originalBase }()
	var methodPath, body string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methodPath = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		body = string(raw)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	telegramAPIBaseURL = server.URL
	callback := &telegramCallbackQuery{Message: &struct {
		Chat struct {
			ID int64 `json:"id"`
		} `json:"chat"`
		MessageID int    `json:"message_id"`
		Text      string `json:"text"`
		Caption   string `json:"caption"`
	}{MessageID: 42, Caption: "รายการซื้อ coin"}}
	callback.Message.Chat.ID = 123
	if err := (&app{}).editTelegramOrderResult(context.Background(), telegramNotifySettings{BotToken: "1:test", ChatID: "123"}, callback, "อนุมัติแล้ว", "reviewer"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(methodPath, "/editMessageCaption") || strings.Contains(methodPath, "sendPhoto") {
		t.Fatalf("unexpected Telegram method: %s", methodPath)
	}
	if !strings.Contains(body, "อนุมัติแล้ว") || !strings.Contains(body, "inline_keyboard") {
		t.Fatalf("missing edited result: %s", body)
	}
}
