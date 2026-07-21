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
	"net/url"
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

type slipOKSettings struct {
	Enabled    bool   `json:"enabled"`
	BranchID   string `json:"branchId"`
	APIKey     string `json:"-"`
	MonthlyCap int    `json:"monthlyCap"`
}

type slipOKQuota struct {
	Available  bool   `json:"available"`
	Remaining  int    `json:"remaining"`
	Used       int    `json:"used"`
	Limit      int    `json:"limit"`
	OverQuota  int    `json:"overQuota"`
	CapReached bool   `json:"capReached"`
	Error      string `json:"error,omitempty"`
}

type slipOKResult struct {
	Passed    bool
	Status    string
	ErrorCode int
	Note      string
	TransRef  string
	AmountTHB *int
	PaidAt    string
	Receiver  string
}

var slipOKAPIBaseURL = "https://api.slipok.com"

func (a *app) slipOKSettings(ctx context.Context) slipOKSettings {
	enabled, _ := a.systemSetting(ctx, "slipOKEnabled")
	branchID, _ := a.systemSetting(ctx, "slipOKBranchId")
	apiKey, _ := a.systemSetting(ctx, "slipOKApiKey")
	capValue, _ := a.systemSetting(ctx, "slipOKMonthlyCap")
	if strings.TrimSpace(branchID) == "" {
		branchID = os.Getenv("SLIPOK_BRANCH_ID")
	}
	if strings.TrimSpace(apiKey) == "" {
		apiKey = os.Getenv("SLIPOK_API_KEY")
	}
	if strings.TrimSpace(capValue) == "" {
		capValue = os.Getenv("SLIPOK_MONTHLY_CAP")
	}
	monthlyCap, _ := strconv.Atoi(strings.TrimSpace(capValue))
	return slipOKSettings{
		Enabled:    strings.EqualFold(strings.TrimSpace(enabled), "true"),
		BranchID:   normalizeSlipOKBranchID(branchID),
		APIKey:     strings.TrimSpace(apiKey),
		MonthlyCap: max(0, monthlyCap),
	}
}

func normalizeSlipOKBranchID(value string) string {
	value = strings.TrimSpace(strings.TrimRight(value, "/"))
	if parsed, err := url.Parse(value); err == nil && parsed.Host != "" {
		value = strings.Trim(strings.TrimSpace(parsed.Path), "/")
	}
	const prefix = "api/line/apikey/"
	if index := strings.LastIndex(strings.ToLower(value), prefix); index >= 0 {
		value = value[index+len(prefix):]
	}
	if slash := strings.LastIndex(value, "/"); slash >= 0 {
		value = value[slash+1:]
	}
	return strings.TrimSpace(value)
}

func (settings slipOKSettings) ready() bool {
	return settings.Enabled && settings.BranchID != "" && settings.APIKey != "" && settings.MonthlyCap > 0
}

func maskSecret(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if len(value) <= 8 {
		return "••••••••"
	}
	return value[:4] + "••••••••" + value[len(value)-4:]
}

func (a *app) fetchSlipOKQuota(ctx context.Context, settings slipOKSettings) slipOKQuota {
	result := slipOKQuota{Limit: settings.MonthlyCap}
	if settings.BranchID == "" || settings.APIKey == "" {
		result.Error = "SlipOK Branch ID หรือ API Key ยังไม่พร้อม"
		return result
	}
	url := strings.TrimRight(slipOKAPIBaseURL, "/") + "/api/line/apikey/" + settings.BranchID + "/quota"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	req.Header.Set("x-authorization", settings.APIKey)
	resp, err := (&http.Client{Timeout: 12 * time.Second}).Do(req)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Quota     int `json:"quota"`
			OverQuota int `json:"overQuota"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		result.Error = "อ่านผล SlipOK quota ไม่สำเร็จ"
		return result
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !payload.Success {
		result.Error = strings.TrimSpace(payload.Message)
		if result.Error == "" {
			result.Error = fmt.Sprintf("SlipOK quota HTTP %d", resp.StatusCode)
		}
		return result
	}
	result.Available = true
	result.Remaining = max(0, payload.Data.Quota)
	result.OverQuota = max(0, payload.Data.OverQuota)
	result.Used = max(0, settings.MonthlyCap-result.Remaining)
	result.CapReached = result.Used >= settings.MonthlyCap
	return result
}

func (a *app) checkSlipOK(ctx context.Context, settings slipOKSettings, slipDataURL string, expectedAmount int) slipOKResult {
	result := slipOKResult{Status: "manual_review"}
	raw, err := decodeDataURL(slipDataURL)
	if err != nil {
		result.Note = "แปลงรูปสลิปเพื่อส่ง SlipOK ไม่สำเร็จ"
		return result
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("log", "true")
	_ = writer.WriteField("amount", strconv.Itoa(expectedAmount))
	part, err := writer.CreateFormFile("files", "slip.png")
	if err != nil {
		result.Note = err.Error()
		return result
	}
	if _, err = part.Write(raw); err != nil {
		result.Note = err.Error()
		return result
	}
	if err = writer.Close(); err != nil {
		result.Note = err.Error()
		return result
	}
	url := strings.TrimRight(slipOKAPIBaseURL, "/") + "/api/line/apikey/" + settings.BranchID
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, &body)
	if err != nil {
		result.Note = err.Error()
		return result
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("x-authorization", settings.APIKey)
	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		result.Note = "เรียก SlipOK ไม่สำเร็จ: " + err.Error()
		return result
	}
	defer resp.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	var payload struct {
		Success bool   `json:"success"`
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			Success        bool    `json:"success"`
			Message        string  `json:"message"`
			TransRef       string  `json:"transRef"`
			TransTimestamp string  `json:"transTimestamp"`
			Amount         float64 `json:"amount"`
			Receiver       struct {
				DisplayName string `json:"displayName"`
				Name        string `json:"name"`
			} `json:"receiver"`
		} `json:"data"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		result.Note = fmt.Sprintf("อ่านผล SlipOK ไม่สำเร็จ (HTTP %d)", resp.StatusCode)
		return result
	}
	result.ErrorCode = payload.Code
	result.TransRef = strings.TrimSpace(payload.Data.TransRef)
	if payload.Data.Amount > 0 {
		amount := int(payload.Data.Amount + 0.5)
		result.AmountTHB = &amount
	}
	result.PaidAt = strings.TrimSpace(payload.Data.TransTimestamp)
	result.Receiver = strings.TrimSpace(payload.Data.Receiver.DisplayName)
	if result.Receiver == "" {
		result.Receiver = strings.TrimSpace(payload.Data.Receiver.Name)
	}
	result.Passed = resp.StatusCode >= 200 && resp.StatusCode < 300 && payload.Success && payload.Data.Success
	if result.Passed {
		result.Status = "passed"
		result.Note = "SlipOK ตรวจสอบสลิป ยอดเงิน และบัญชีผู้รับผ่าน"
		return result
	}
	result.Status = "manual_review"
	result.Note = strings.TrimSpace(payload.Message)
	if result.Note == "" {
		result.Note = strings.TrimSpace(payload.Data.Message)
	}
	if result.Note == "" {
		result.Note = fmt.Sprintf("SlipOK ไม่ผ่าน (code %d)", payload.Code)
	}
	return result
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

func (a *app) ensureTelegramWebhookSecret(ctx context.Context) string {
	settings := a.telegramNotifySettings(ctx)
	if settings.WebhookSecret != "" {
		return settings.WebhookSecret
	}
	secret := "tg-" + randHex(24)
	_, _ = a.db.ExecContext(ctx, `
		insert into system_settings (key, value)
		values ('telegramWebhookSecret', $1)
		on conflict (key) do update set value = excluded.value, updated_at = now()
	`, secret)
	return secret
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

func promptPayPayloadsForSubscriptionPackages(settings promptPaySettings, packages []subscriptionPackage) map[string]string {
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

func telegramCoinOrderText(order coinPurchaseOrder, user adminUser) string {
	product := "Coin"
	benefit := fmt.Sprintf("Coins: %d", order.Coins)
	if order.ProductType == "subscription" {
		product = "Subscription"
		benefit = fmt.Sprintf("Sessions: %d\nDuration: %d days\nSubscription: %s", order.TotalSessions, order.DurationDays, emptyDash(order.SubscriptionID))
	}
	return fmt.Sprintf(
		"LiveMatch payment order\nAdmin: %s\nProduct: %s\nPackage: %s\nAmount: %d THB\n%s\ntransRef: %s\nVerification: %s\nReason: %s\nReview note: %s\nStatus: %s\n%s/backoffice",
		user.Email,
		product,
		firstNonEmpty(order.PackageName, order.PackageID),
		order.PriceTHB,
		benefit,
		emptyDash(order.TransRef),
		order.VerificationStatus,
		emptyDash(order.VerificationNote),
		emptyDash(order.Note),
		order.Status,
		publicAppBaseURL(),
	)
}

func (a *app) notifyTelegramCoinOrder(ctx context.Context, order coinPurchaseOrder, user adminUser) error {
	settings := a.telegramNotifySettings(ctx)
	if !settings.enabled() {
		return errors.New("Telegram notification is not configured")
	}
	text := telegramCoinOrderText(order, user)
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
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		a.insertActivityLog(ctx, "system", "telegram", "telegram_payment_notification_failed", "coin_purchase_order", order.ID, map[string]any{"status": resp.StatusCode, "body": string(body)})
		return fmt.Errorf("Telegram returned status %d", resp.StatusCode)
	}
	return nil
}

func postTelegramMessage(ctx context.Context, client *http.Client, settings telegramNotifySettings, order coinPurchaseOrder, text string) (*http.Response, error) {
	var keyboard any
	if order.Status == "pending" {
		keyboard = telegramOrderKeyboard(order.ID)
	}
	payload, _ := json.Marshal(map[string]any{
		"chat_id":      settings.ChatID,
		"text":         text,
		"reply_markup": keyboard,
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
	if order.Status == "pending" {
		rawKeyboard, _ := json.Marshal(telegramOrderKeyboard(order.ID))
		_ = writer.WriteField("reply_markup", string(rawKeyboard))
	}
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
		} else if errors.Is(err, errSubscriptionPurchaseBlocked) {
			message = "บัญชีนี้มีรอบล่วงหน้าหรือรายการแพ็กเกจที่รอตรวจอยู่แล้ว"
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

func telegramWebhookURL(settings telegramNotifySettings) string {
	if strings.TrimSpace(settings.WebhookSecret) == "" {
		return ""
	}
	return publicAppBaseURL() + "/api/telegram/webhook/" + strings.TrimSpace(settings.WebhookSecret)
}

func validTelegramWebhookURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && parsed.Scheme == "https" && parsed.Host != ""
}

func (a *app) handleBackofficeTelegramWebhookSetup(w http.ResponseWriter, r *http.Request, actor string) {
	settings := a.telegramNotifySettings(r.Context())
	if settings.WebhookSecret == "" {
		settings.WebhookSecret = a.ensureTelegramWebhookSecret(r.Context())
	}
	webhookURL := telegramWebhookURL(settings)
	if strings.TrimSpace(settings.BotToken) == "" || webhookURL == "" {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "Telegram bot token หรือ webhook secret ยังไม่พร้อม", "webhookUrl": webhookURL})
		return
	}
	if !validTelegramWebhookURL(webhookURL) {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":      "Telegram webhook ต้องใช้ HTTPS กรุณาตั้ง APP_BASE_URL เป็นโดเมน HTTPS แล้ว restart backend",
			"webhookUrl": webhookURL,
		})
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"url":                  webhookURL,
		"drop_pending_updates": false,
	})
	url := "https://api.telegram.org/bot" + settings.BotToken + "/setWebhook"
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 12 * time.Second}).Do(req)
	if err != nil {
		a.insertActivityLog(r.Context(), "backoffice", actor, "telegram_set_webhook_failed", "telegram", "webhook", map[string]any{"error": err.Error(), "webhookUrl": webhookURL})
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error(), "webhookUrl": webhookURL})
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	var parsed map[string]any
	_ = json.Unmarshal(body, &parsed)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || parsed["ok"] == false {
		message := string(body)
		if description, ok := parsed["description"].(string); ok && description != "" {
			message = description
		}
		a.insertActivityLog(r.Context(), "backoffice", actor, "telegram_set_webhook_failed", "telegram", "webhook", map[string]any{"status": resp.StatusCode, "body": string(body), "webhookUrl": webhookURL})
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": message, "webhookUrl": webhookURL})
		return
	}
	a.insertActivityLog(r.Context(), "backoffice", actor, "telegram_set_webhook", "telegram", "webhook", map[string]any{"webhookUrl": webhookURL})
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "webhookUrl": webhookURL, "telegram": parsed})
}

func emptyDash(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "-"
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return "-"
}

func publicAppBaseURL() string {
	for _, key := range []string{"APP_BASE_URL", "FRONTEND_BASE_URL", "PUBLIC_APP_URL"} {
		if value := strings.TrimRight(strings.TrimSpace(os.Getenv(key)), "/"); value != "" {
			return value
		}
	}
	return "http://localhost:5173"
}
