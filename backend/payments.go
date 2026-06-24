package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/makiuchi-d/gozxing"
	"github.com/makiuchi-d/gozxing/qrcode"
)

type promptPaySettings struct {
	ID           string `json:"promptPayId"`
	Type         string `json:"promptPayType"`
	ReceiverName string `json:"promptPayReceiverName"`
}

type telegramNotifySettings struct {
	BotToken      string `json:"telegramBotToken"`
	ChatID        string `json:"telegramChatId"`
	WebhookSecret string `json:"telegramWebhookSecret"`
}

type slipVerification struct {
	TransRef           string
	QRPayload          string
	DetectedAmountTHB  *int
	DetectedPaidAt     string
	DetectedReceiver   string
	VerificationStatus string
	VerificationNote   string
}

func (a *app) promptPaySettings(ctx context.Context) promptPaySettings {
	promptPayID, _ := a.systemSetting(ctx, "promptPayId")
	promptPayType, _ := a.systemSetting(ctx, "promptPayType")
	receiverName, _ := a.systemSetting(ctx, "promptPayReceiverName")
	promptPayType = strings.TrimSpace(promptPayType)
	if promptPayType == "" {
		promptPayType = "mobile"
	}
	return promptPaySettings{
		ID:           strings.TrimSpace(promptPayID),
		Type:         promptPayType,
		ReceiverName: strings.TrimSpace(receiverName),
	}
}

func (a *app) telegramNotifySettings(ctx context.Context) telegramNotifySettings {
	token, _ := a.systemSetting(ctx, "telegramBotToken")
	chatID, _ := a.systemSetting(ctx, "telegramChatId")
	secret, _ := a.systemSetting(ctx, "telegramWebhookSecret")
	if strings.TrimSpace(token) == "" {
		token = os.Getenv("TELEGRAM_BOT_TOKEN")
	}
	if strings.TrimSpace(chatID) == "" {
		chatID = os.Getenv("TELEGRAM_CHAT_ID")
	}
	if strings.TrimSpace(secret) == "" {
		secret = os.Getenv("TELEGRAM_WEBHOOK_SECRET")
	}
	return telegramNotifySettings{
		BotToken:      strings.TrimSpace(token),
		ChatID:        strings.TrimSpace(chatID),
		WebhookSecret: strings.TrimSpace(secret),
	}
}

func (settings telegramNotifySettings) enabled() bool {
	return strings.TrimSpace(settings.BotToken) != "" && strings.TrimSpace(settings.ChatID) != ""
}

func promptPayPayloadsForPackages(settings promptPaySettings, packages []coinPackage) map[string]string {
	payloads := map[string]string{}
	if strings.TrimSpace(settings.ID) == "" {
		return payloads
	}
	for _, pkg := range packages {
		payload, err := promptPayPayload(settings, pkg.PriceTHB)
		if err == nil && payload != "" {
			payloads[pkg.ID] = payload
		}
	}
	return payloads
}

func promptPayPayload(settings promptPaySettings, amountTHB int) (string, error) {
	if amountTHB <= 0 {
		return "", errors.New("amount must be positive")
	}
	target, tag, err := normalizePromptPayTarget(settings)
	if err != nil {
		return "", err
	}
	merchantAccount := emv("00", "A000000677010111") + emv(tag, target)
	payload := emv("00", "01") +
		emv("01", "12") +
		emv("29", merchantAccount) +
		emv("53", "764") +
		emv("54", fmt.Sprintf("%.2f", float64(amountTHB))) +
		emv("58", "TH")
	return payload + "6304" + crc16CCITT(payload+"6304"), nil
}

func normalizePromptPayTarget(settings promptPaySettings) (string, string, error) {
	raw := strings.TrimSpace(settings.ID)
	digits := onlyDigits(raw)
	switch strings.TrimSpace(settings.Type) {
	case "", "mobile":
		if strings.HasPrefix(digits, "0") && len(digits) == 10 {
			return "0066" + digits[1:], "01", nil
		}
		if strings.HasPrefix(digits, "66") && len(digits) == 11 {
			return "00" + digits, "01", nil
		}
		if strings.HasPrefix(digits, "0066") && len(digits) == 13 {
			return digits, "01", nil
		}
		return "", "", errors.New("invalid PromptPay mobile")
	case "national_id":
		if len(digits) != 13 {
			return "", "", errors.New("invalid PromptPay national id")
		}
		return digits, "01", nil
	case "ewallet":
		if len(digits) < 10 || len(digits) > 15 {
			return "", "", errors.New("invalid PromptPay e-wallet")
		}
		return digits, "02", nil
	default:
		return "", "", errors.New("invalid PromptPay type")
	}
}

func emv(tag, value string) string {
	return fmt.Sprintf("%s%02d%s", tag, len(value), value)
}

func crc16CCITT(payload string) string {
	var crc uint16 = 0xFFFF
	for _, b := range []byte(payload) {
		crc ^= uint16(b) << 8
		for i := 0; i < 8; i++ {
			if crc&0x8000 != 0 {
				crc = (crc << 1) ^ 0x1021
			} else {
				crc <<= 1
			}
		}
	}
	return fmt.Sprintf("%04X", crc)
}

func inspectSlipImage(slipDataURL string, expectedAmountTHB int, settings promptPaySettings, now time.Time) slipVerification {
	result := slipVerification{VerificationStatus: "manual_review"}
	payload, err := decodeSlipQRCode(slipDataURL)
	if err != nil || strings.TrimSpace(payload) == "" {
		result.VerificationNote = "อ่าน QR จากสลิปไม่ได้ ต้องตรวจเอง"
		return result
	}
	result.QRPayload = payload
	parsed := parseSlipQRPayload(payload)
	result.TransRef = parsed.TransRef
	result.DetectedAmountTHB = parsed.AmountTHB
	result.DetectedPaidAt = parsed.PaidAt
	result.DetectedReceiver = parsed.Receiver
	notes := []string{}
	if result.TransRef == "" {
		result.TransRef = "qrhash-" + shortHash(payload)
		notes = append(notes, "ไม่พบ transRef ชัดเจน ใช้ hash ของ QR กันสลิปซ้ำ")
	}
	if result.DetectedAmountTHB == nil {
		notes = append(notes, "QR สลิปนี้ไม่มีข้อมูลยอดเงิน ต้องตรวจยอดจากภาพสลิปเอง")
	} else if *result.DetectedAmountTHB != expectedAmountTHB {
		notes = append(notes, fmt.Sprintf("ยอดในสลิป %d บาท ไม่ตรงกับแพ็กเกจ %d บาท", *result.DetectedAmountTHB, expectedAmountTHB))
	}
	if result.DetectedReceiver != "" && settings.ID != "" && !receiverLooksExpected(result.DetectedReceiver, settings) {
		notes = append(notes, "บัญชีผู้รับที่อ่านได้ไม่ตรงกับ PromptPay setting")
	}
	if result.DetectedPaidAt != "" && paidAtLooksFuture(result.DetectedPaidAt, now) {
		notes = append(notes, "เวลาชำระอยู่ในอนาคตผิดปกติ")
	}
	switch {
	case len(notes) == 0:
		result.VerificationStatus = "passed"
		result.VerificationNote = "อ่าน QR สลิปแล้วข้อมูลเบื้องต้นตรง"
	case result.DetectedAmountTHB != nil:
		result.VerificationStatus = "warning"
		result.VerificationNote = strings.Join(notes, " | ")
	default:
		result.VerificationStatus = "manual_review"
		result.VerificationNote = strings.Join(notes, " | ")
	}
	return result
}

type parsedSlipQR struct {
	TransRef  string
	AmountTHB *int
	PaidAt    string
	Receiver  string
}

func parseSlipQRPayload(payload string) parsedSlipQR {
	payload = strings.TrimSpace(payload)
	result := parsedSlipQR{}
	tags := parseEMVTags(payload)
	if amountRaw := tags["54"]; amountRaw != "" {
		if amount, err := strconv.ParseFloat(amountRaw, 64); err == nil {
			amountInt := int(amount + 0.5)
			result.AmountTHB = &amountInt
		}
	}
	if merchantRaw := tags["29"]; merchantRaw != "" {
		merchantTags := parseEMVTags(merchantRaw)
		if receiver := merchantTags["01"]; receiver != "" {
			result.Receiver = receiver
		}
		if receiver := merchantTags["02"]; receiver != "" {
			result.Receiver = receiver
		}
	}
	if ref := extractSlipTransRef(payload, tags); ref != "" {
		result.TransRef = ref
	}
	refPatterns := []*regexp.Regexp{
		regexp.MustCompile(`(?i)(?:transRef|trans_ref|reference|ref1|txn|trace|transaction)[=:| ]+([A-Z0-9-]{10,64})`),
		regexp.MustCompile(`(?i)\b[A-Z0-9]{18,64}\b`),
	}
	if result.TransRef == "" {
		for _, pattern := range refPatterns {
			if match := pattern.FindStringSubmatch(payload); len(match) > 1 {
				result.TransRef = strings.Trim(match[1], "-:| ")
				break
			} else if match := pattern.FindString(payload); match != "" && match != payload {
				result.TransRef = strings.Trim(match, "-:| ")
				break
			}
		}
	}
	if match := regexp.MustCompile(`\b(20\d{2}[-/]?\d{2}[-/]?\d{2})(?:[ T]?(\d{2}:?\d{2}:?\d{2})?)?\b`).FindString(payload); match != "" {
		result.PaidAt = match
	}
	return result
}

func extractSlipTransRef(payload string, tags map[string]string) string {
	refPattern := regexp.MustCompile(`(?i)^[A-Z]{2,6}[A-Z0-9]{10,64}$`)
	if match := regexp.MustCompile(`(?i)\b[A-Z]{2,6}[A-Z0-9]{10,64}\b`).FindString(payload); match != "" && match != payload {
		return match
	}
	for _, value := range collectEMVValues(tags, 0) {
		value = strings.TrimSpace(value)
		if refPattern.MatchString(value) {
			return value
		}
	}
	return ""
}

func collectEMVValues(tags map[string]string, depth int) []string {
	if depth > 3 {
		return nil
	}
	values := []string{}
	for _, value := range tags {
		values = append(values, value)
		nested := parseEMVTags(value)
		if len(nested) > 0 {
			values = append(values, collectEMVValues(nested, depth+1)...)
		}
	}
	return values
}

func parseEMVTags(payload string) map[string]string {
	tags := map[string]string{}
	for index := 0; index+4 <= len(payload); {
		tag := payload[index : index+2]
		length, err := strconv.Atoi(payload[index+2 : index+4])
		if err != nil || length < 0 || index+4+length > len(payload) {
			break
		}
		tags[tag] = payload[index+4 : index+4+length]
		index += 4 + length
	}
	return tags
}

func decodeSlipQRCode(dataURL string) (string, error) {
	raw, err := decodeDataURL(dataURL)
	if err != nil {
		return "", err
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	bitmap, err := gozxing.NewBinaryBitmapFromImage(img)
	if err != nil {
		return "", err
	}
	reader := qrcode.NewQRCodeReader()
	result, err := reader.Decode(bitmap, nil)
	if err != nil {
		result, err = reader.Decode(bitmap, map[gozxing.DecodeHintType]interface{}{
			gozxing.DecodeHintType_PURE_BARCODE: true,
		})
	}
	if err != nil {
		return "", err
	}
	return result.GetText(), nil
}

func decodeDataURL(dataURL string) ([]byte, error) {
	raw := strings.TrimSpace(dataURL)
	if comma := strings.Index(raw, ","); comma >= 0 && strings.Contains(raw[:comma], "base64") {
		raw = raw[comma+1:]
	}
	return base64.StdEncoding.DecodeString(raw)
}

func receiverLooksExpected(receiver string, settings promptPaySettings) bool {
	receiverDigits := onlyDigits(receiver)
	expectedDigits := onlyDigits(settings.ID)
	if expectedDigits != "" && strings.Contains(receiverDigits, expectedDigits) {
		return true
	}
	target, _, err := normalizePromptPayTarget(settings)
	if err == nil && target != "" && strings.Contains(receiverDigits, onlyDigits(target)) {
		return true
	}
	if settings.ReceiverName != "" && strings.Contains(strings.ToLower(receiver), strings.ToLower(settings.ReceiverName)) {
		return true
	}
	return false
}

func paidAtLooksFuture(value string, now time.Time) bool {
	candidates := []string{
		"2006-01-02 15:04:05",
		"2006-01-02 15:04",
		"20060102 150405",
		"20060102",
		"2006-01-02",
		"2006/01/02",
	}
	clean := strings.ReplaceAll(strings.TrimSpace(value), "T", " ")
	for _, layout := range candidates {
		parsed, err := time.ParseInLocation(layout, clean, time.FixedZone("Asia/Bangkok", 7*60*60))
		if err == nil {
			return parsed.After(now.Add(10 * time.Minute))
		}
	}
	return false
}

func onlyDigits(value string) string {
	var builder strings.Builder
	for _, char := range value {
		if char >= '0' && char <= '9' {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

func shortHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])[:24]
}

func (a *app) notifyTelegramCoinOrder(ctx context.Context, order coinPurchaseOrder, user adminUser) {
	settings := a.telegramNotifySettings(ctx)
	if !settings.enabled() {
		return
	}
	text := fmt.Sprintf(
		"LiveMatch coin order\nAdmin: %s\nPackage: %s\nAmount: %d THB\nCoins: %d\ntransRef: %s\nStatus: %s\n%s/backoffice",
		user.Email,
		order.PackageID,
		order.PriceTHB,
		order.Coins,
		emptyDash(order.TransRef),
		order.VerificationStatus,
		publicAppBaseURL(),
	)
	var err error
	var resp *http.Response
	client := &http.Client{Timeout: 12 * time.Second}
	if order.SlipImage != "" {
		resp, err = postTelegramPhoto(ctx, client, settings, order, text)
	} else {
		resp, err = postTelegramMessage(ctx, client, settings, order, text)
	}
	if err != nil {
		a.insertActivityLog(ctx, "system", "telegram", "telegram_payment_notification_failed", "coin_purchase_order", order.ID, map[string]any{"error": err.Error()})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		a.insertActivityLog(ctx, "system", "telegram", "telegram_payment_notification_failed", "coin_purchase_order", order.ID, map[string]any{"status": resp.StatusCode, "body": string(body)})
	}
}

func postTelegramMessage(ctx context.Context, client *http.Client, settings telegramNotifySettings, order coinPurchaseOrder, text string) (*http.Response, error) {
	payload, _ := json.Marshal(map[string]any{
		"chat_id":      settings.ChatID,
		"text":         text,
		"reply_markup": telegramOrderKeyboard(order.ID),
	})
	url := "https://api.telegram.org/bot" + settings.BotToken + "/sendMessage"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	return client.Do(req)
}

func postTelegramPhoto(ctx context.Context, client *http.Client, settings telegramNotifySettings, order coinPurchaseOrder, caption string) (*http.Response, error) {
	raw, err := decodeDataURL(order.SlipImage)
	if err != nil {
		return nil, err
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("chat_id", settings.ChatID)
	_ = writer.WriteField("caption", caption)
	rawKeyboard, _ := json.Marshal(telegramOrderKeyboard(order.ID))
	_ = writer.WriteField("reply_markup", string(rawKeyboard))
	part, err := writer.CreateFormFile("photo", "slip.png")
	if err != nil {
		return nil, err
	}
	if _, err = part.Write(raw); err != nil {
		return nil, err
	}
	if err = writer.Close(); err != nil {
		return nil, err
	}
	url := "https://api.telegram.org/bot" + settings.BotToken + "/sendPhoto"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, &body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return client.Do(req)
}

func telegramOrderKeyboard(orderID string) map[string]any {
	return map[string]any{
		"inline_keyboard": [][]map[string]string{
			{
				{"text": "อนุมัติ", "callback_data": "coin:approved:" + orderID},
				{"text": "ปฏิเสธ", "callback_data": "coin:rejected:" + orderID},
			},
		},
	}
}

type telegramUpdate struct {
	CallbackQuery *telegramCallbackQuery `json:"callback_query"`
}

type telegramCallbackQuery struct {
	ID      string               `json:"id"`
	Data    string               `json:"data"`
	From    telegramCallbackFrom `json:"from"`
	Message *struct {
		Chat struct {
			ID int64 `json:"id"`
		} `json:"chat"`
		MessageID int `json:"message_id"`
	} `json:"message"`
}

type telegramCallbackFrom struct {
	ID        int64  `json:"id"`
	Username  string `json:"username"`
	FirstName string `json:"first_name"`
}

func (a *app) handleTelegramWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	settings := a.telegramNotifySettings(r.Context())
	secret := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/api/telegram/webhook/"))
	if settings.WebhookSecret == "" || secret == "" || secret != settings.WebhookSecret {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	var update telegramUpdate
	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if update.CallbackQuery == nil {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ignored"})
		return
	}
	status, orderID, ok := parseTelegramOrderAction(update.CallbackQuery.Data)
	if !ok {
		a.answerTelegramCallback(r.Context(), settings, update.CallbackQuery.ID, "คำสั่งไม่ถูกต้อง")
		writeJSON(w, http.StatusOK, map[string]string{"status": "ignored"})
		return
	}
	actor := fmt.Sprintf("%d", update.CallbackQuery.From.ID)
	if update.CallbackQuery.From.Username != "" {
		actor = update.CallbackQuery.From.Username
	}
	note := "reviewed from telegram"
	err := a.reviewCoinOrder(r.Context(), orderID, status, "telegram", actor, note)
	if err != nil {
		message := "อัปเดตรายการไม่สำเร็จ"
		if errors.Is(err, errCoinOrderReviewed) {
			message = "รายการนี้ถูกตรวจแล้ว"
		} else if errors.Is(err, errCoinOrderNotFound) {
			message = "ไม่พบรายการซื้อ"
		}
		a.answerTelegramCallback(r.Context(), settings, update.CallbackQuery.ID, message)
		writeJSON(w, http.StatusOK, map[string]string{"status": "failed"})
		return
	}
	label := "อนุมัติแล้ว"
	if status == "rejected" {
		label = "ปฏิเสธแล้ว"
	}
	a.answerTelegramCallback(r.Context(), settings, update.CallbackQuery.ID, label)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func parseTelegramOrderAction(data string) (string, string, bool) {
	parts := strings.SplitN(strings.TrimSpace(data), ":", 3)
	if len(parts) != 3 || parts[0] != "coin" {
		return "", "", false
	}
	if parts[1] != "approved" && parts[1] != "rejected" {
		return "", "", false
	}
	if strings.TrimSpace(parts[2]) == "" {
		return "", "", false
	}
	return parts[1], parts[2], true
}

func (a *app) answerTelegramCallback(ctx context.Context, settings telegramNotifySettings, callbackID, text string) {
	if callbackID == "" || !settings.enabled() {
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"callback_query_id": callbackID,
		"text":              text,
		"show_alert":        false,
	})
	url := "https://api.telegram.org/bot" + settings.BotToken + "/answerCallbackQuery"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 8 * time.Second}).Do(req)
	if err == nil && resp != nil {
		_ = resp.Body.Close()
	}
}

func emptyDash(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "-"
	}
	return value
}

func publicAppBaseURL() string {
	for _, key := range []string{"APP_BASE_URL", "FRONTEND_BASE_URL", "PUBLIC_APP_URL"} {
		if value := strings.TrimRight(strings.TrimSpace(os.Getenv(key)), "/"); value != "" {
			return value
		}
	}
	return "http://localhost:5173"
}
