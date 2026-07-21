package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

var (
	errSessionPriceUnset = errors.New("session coin price is not configured")
	errInsufficientCoins = errors.New("insufficient coins")
)

var bangkokLocation = time.FixedZone("Asia/Bangkok", 7*60*60)

type sessionPriceQuote struct {
	BaseCost        int `json:"baseCost"`
	DiscountPercent int `json:"discountPercent"`
	FinalCost       int `json:"finalCost"`
}

type adminSubscription struct {
	ID            string `json:"id"`
	AdminID       string `json:"adminId,omitempty"`
	StartDate     string `json:"startDate"`
	EndDate       string `json:"endDate"`
	TotalSessions int    `json:"totalSessions"`
	UsedSessions  int    `json:"usedSessions"`
	Remaining     int    `json:"remaining"`
	PaidAmountTHB int    `json:"paidAmountThb"`
	Note          string `json:"note"`
	Status        string `json:"status"`
	CreatedBy     string `json:"createdBy,omitempty"`
	CancelledBy   string `json:"cancelledBy,omitempty"`
	CancelledAt   string `json:"cancelledAt,omitempty"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

type adminBenefits struct {
	DiscountPercent int                          `json:"discountPercent"`
	Pricing         map[string]sessionPriceQuote `json:"pricing"`
	Subscription    *adminSubscription           `json:"subscription"`
	Upcoming        *adminSubscription           `json:"upcomingSubscription,omitempty"`
	History         []adminSubscription          `json:"subscriptionHistory,omitempty"`
}

type sessionBillingDecision struct {
	Method          string
	BaseCost        int
	DiscountPercent int
	ChargedCost     int
	NewCoinBalance  int
	SubscriptionID  string
	Remaining       int
}

func effectiveSessionCost(baseCost, discountPercent int) int {
	baseCost = max(0, baseCost)
	discountPercent = max(0, min(100, discountPercent))
	return (baseCost*(100-discountPercent) + 50) / 100
}

func subscriptionStatus(item adminSubscription, today string) string {
	if item.CancelledAt != "" {
		return "cancelled"
	}
	if today < item.StartDate {
		return "upcoming"
	}
	if today > item.EndDate {
		return "expired"
	}
	if item.Remaining <= 0 {
		return "exhausted"
	}
	return "active"
}

func todayBangkok() string {
	return time.Now().In(bangkokLocation).Format("2006-01-02")
}

func validSubscriptionDate(value string) (time.Time, error) {
	return time.ParseInLocation("2006-01-02", strings.TrimSpace(value), bangkokLocation)
}

func (a *app) adminDiscountPercent(ctx context.Context, adminID string) (int, error) {
	var discount int
	err := a.db.QueryRowContext(ctx, `
		select coalesce((select discount_percent from admin_discounts where admin_id = $1), 0)
	`, adminID).Scan(&discount)
	return max(0, min(100, discount)), err
}

func (a *app) sessionPricing(ctx context.Context, adminID string) (map[string]sessionPriceQuote, int, error) {
	discount, err := a.adminDiscountPercent(ctx, adminID)
	if err != nil {
		return nil, 0, err
	}
	pricing := map[string]sessionPriceQuote{}
	for _, sessionType := range []string{"liveMatch", "liveShare"} {
		baseCost, hasCost, err := a.sessionCoinCost(ctx, sessionType)
		if err != nil {
			return nil, 0, err
		}
		if !hasCost {
			continue
		}
		pricing[sessionType] = sessionPriceQuote{BaseCost: baseCost, DiscountPercent: discount, FinalCost: effectiveSessionCost(baseCost, discount)}
	}
	return pricing, discount, nil
}

func (a *app) adminSubscriptions(ctx context.Context, adminID string) ([]adminSubscription, error) {
	items := []adminSubscription{}
	rows, err := a.db.QueryContext(ctx, `
		select id, admin_id, to_char(start_date, 'YYYY-MM-DD'), to_char(end_date, 'YYYY-MM-DD'),
			total_sessions, used_sessions, paid_amount_thb, note, created_by, cancelled_by,
			coalesce(to_char(cancelled_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI'), ''),
			to_char(created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI'),
			to_char(updated_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI')
		from admin_subscriptions
		where admin_id = $1
		order by start_date desc, created_at desc
	`, adminID)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	today := todayBangkok()
	for rows.Next() {
		var item adminSubscription
		if err := rows.Scan(&item.ID, &item.AdminID, &item.StartDate, &item.EndDate, &item.TotalSessions, &item.UsedSessions, &item.PaidAmountTHB, &item.Note, &item.CreatedBy, &item.CancelledBy, &item.CancelledAt, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return items, err
		}
		item.Remaining = max(0, item.TotalSessions-item.UsedSessions)
		item.Status = subscriptionStatus(item, today)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (a *app) adminBenefits(ctx context.Context, adminID string, includeHistory bool) (adminBenefits, error) {
	pricing, discount, err := a.sessionPricing(ctx, adminID)
	if err != nil {
		return adminBenefits{}, err
	}
	history, err := a.adminSubscriptions(ctx, adminID)
	if err != nil {
		return adminBenefits{}, err
	}
	benefits := adminBenefits{DiscountPercent: discount, Pricing: pricing}
	for i := range history {
		if history[i].Status == "active" {
			item := history[i]
			benefits.Subscription = &item
			break
		}
	}
	if benefits.Subscription == nil {
		for i := range history {
			if history[i].Status == "exhausted" {
				item := history[i]
				benefits.Subscription = &item
				break
			}
		}
	}
	for i := range history {
		if history[i].Status == "upcoming" {
			item := history[i]
			benefits.Upcoming = &item
			if benefits.Subscription == nil {
				benefits.Subscription = &item
			}
			break
		}
	}
	if includeHistory {
		benefits.History = history
	}
	return benefits, nil
}

func sessionCostSettingKey(sessionType string) string {
	if normalizeSessionType(sessionType) == "liveShare" {
		return "liveShareSessionCoinCost"
	}
	return "liveMatchSessionCoinCost"
}

func consumeSessionBillingTx(ctx context.Context, tx *sql.Tx, adminID, sessionType string) (sessionBillingDecision, error) {
	var currentCoins int
	if err := tx.QueryRowContext(ctx, `select coins from admin_users where id = $1 for update`, adminID).Scan(&currentCoins); err != nil {
		return sessionBillingDecision{}, err
	}
	var rawCost string
	if err := tx.QueryRowContext(ctx, `select value from system_settings where key = $1`, sessionCostSettingKey(sessionType)).Scan(&rawCost); errors.Is(err, sql.ErrNoRows) {
		return sessionBillingDecision{}, errSessionPriceUnset
	} else if err != nil {
		return sessionBillingDecision{}, err
	}
	baseCost, err := strconv.Atoi(rawCost)
	if err != nil || baseCost < 0 {
		return sessionBillingDecision{}, fmt.Errorf("invalid session coin price")
	}
	var discount int
	if err = tx.QueryRowContext(ctx, `select coalesce((select discount_percent from admin_discounts where admin_id = $1), 0)`, adminID).Scan(&discount); err != nil {
		return sessionBillingDecision{}, err
	}
	discount = max(0, min(100, discount))

	today := todayBangkok()
	var subscriptionID string
	var totalSessions, usedSessions int
	err = tx.QueryRowContext(ctx, `
		select id, total_sessions, used_sessions
		from admin_subscriptions
		where admin_id = $1 and cancelled_at is null
			and start_date <= $2::date and end_date >= $2::date
			and used_sessions < total_sessions
		order by start_date desc
		limit 1
		for update
	`, adminID, today).Scan(&subscriptionID, &totalSessions, &usedSessions)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return sessionBillingDecision{}, err
	}
	if err == nil && usedSessions < totalSessions {
		usedSessions++
		if _, err = tx.ExecContext(ctx, `update admin_subscriptions set used_sessions = $2, updated_at = now() where id = $1`, subscriptionID, usedSessions); err != nil {
			return sessionBillingDecision{}, err
		}
		return sessionBillingDecision{
			Method: "subscription", BaseCost: baseCost, DiscountPercent: discount, ChargedCost: 0,
			NewCoinBalance: currentCoins, SubscriptionID: subscriptionID, Remaining: totalSessions - usedSessions,
		}, nil
	}

	chargedCost := effectiveSessionCost(baseCost, discount)
	if currentCoins < chargedCost {
		return sessionBillingDecision{}, errInsufficientCoins
	}
	newBalance := currentCoins - chargedCost
	if chargedCost > 0 {
		if _, err = tx.ExecContext(ctx, `update admin_users set coins = $2, updated_at = now() where id = $1`, adminID, newBalance); err != nil {
			return sessionBillingDecision{}, err
		}
	}
	return sessionBillingDecision{
		Method: "coin", BaseCost: baseCost, DiscountPercent: discount, ChargedCost: chargedCost, NewCoinBalance: newBalance,
	}, nil
}

func subscriptionPurchaseEligibilityForAdmin(ctx context.Context, db *sql.DB, adminID string) (subscriptionPurchaseEligibility, error) {
	today := todayBangkok()
	eligibility := subscriptionPurchaseEligibility{CanPurchase: true, EstimatedStart: today}
	var pendingID string
	err := db.QueryRowContext(ctx, `
		select id from coin_purchase_orders
		where admin_id = $1 and product_type = 'subscription' and status = 'pending'
		order by created_at desc limit 1
	`, adminID).Scan(&pendingID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return eligibility, err
	}
	if err == nil {
		eligibility.CanPurchase = false
		eligibility.Reason = "มีรายการซื้อแพ็กเกจที่รอตรวจสอบอยู่แล้ว"
		eligibility.PendingOrderID = pendingID
		return eligibility, nil
	}
	var upcomingID string
	err = db.QueryRowContext(ctx, `
		select id from admin_subscriptions
		where admin_id = $1 and cancelled_at is null and start_date > $2::date
		order by start_date limit 1
	`, adminID, today).Scan(&upcomingID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return eligibility, err
	}
	if err == nil {
		eligibility.CanPurchase = false
		eligibility.Reason = "มีแพ็กเกจรอบล่วงหน้าอยู่แล้ว"
		return eligibility, nil
	}
	var currentEnd sql.NullString
	if err = db.QueryRowContext(ctx, `
		select to_char(max(end_date), 'YYYY-MM-DD') from admin_subscriptions
		where admin_id = $1 and cancelled_at is null and end_date >= $2::date
	`, adminID, today).Scan(&currentEnd); err != nil {
		return eligibility, err
	}
	if currentEnd.Valid && currentEnd.String != "" {
		end, _ := validSubscriptionDate(currentEnd.String)
		eligibility.Renewal = true
		eligibility.CurrentEndDate = currentEnd.String
		eligibility.EstimatedStart = end.AddDate(0, 0, 1).Format("2006-01-02")
	}
	return eligibility, nil
}

func subscriptionRenewalWindowTx(ctx context.Context, tx *sql.Tx, adminID, excludeOrderID string) (subscriptionPurchaseEligibility, error) {
	today := todayBangkok()
	eligibility := subscriptionPurchaseEligibility{CanPurchase: true, EstimatedStart: today}
	var exists bool
	if err := tx.QueryRowContext(ctx, `select true from admin_users where id = $1 for update`, adminID).Scan(&exists); err != nil {
		return eligibility, err
	}
	var pendingID string
	err := tx.QueryRowContext(ctx, `
		select id from coin_purchase_orders
		where admin_id = $1 and product_type = 'subscription' and status = 'pending' and id <> $2
		order by created_at desc limit 1
	`, adminID, excludeOrderID).Scan(&pendingID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return eligibility, err
	}
	if err == nil {
		eligibility.CanPurchase = false
		eligibility.Reason = "มีรายการซื้อแพ็กเกจที่รอตรวจสอบอยู่แล้ว"
		eligibility.PendingOrderID = pendingID
		return eligibility, nil
	}
	var upcomingID string
	err = tx.QueryRowContext(ctx, `
		select id from admin_subscriptions
		where admin_id = $1 and cancelled_at is null and start_date > $2::date
		order by start_date limit 1
	`, adminID, today).Scan(&upcomingID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return eligibility, err
	}
	if err == nil {
		eligibility.CanPurchase = false
		eligibility.Reason = "มีแพ็กเกจรอบล่วงหน้าอยู่แล้ว"
		return eligibility, nil
	}
	var currentEnd sql.NullString
	if err = tx.QueryRowContext(ctx, `
		select to_char(max(end_date), 'YYYY-MM-DD') from admin_subscriptions
		where admin_id = $1 and cancelled_at is null and end_date >= $2::date
	`, adminID, today).Scan(&currentEnd); err != nil {
		return eligibility, err
	}
	if currentEnd.Valid && currentEnd.String != "" {
		end, _ := validSubscriptionDate(currentEnd.String)
		eligibility.Renewal = true
		eligibility.CurrentEndDate = currentEnd.String
		eligibility.EstimatedStart = end.AddDate(0, 0, 1).Format("2006-01-02")
	}
	return eligibility, nil
}

func activateSubscriptionOrderTx(ctx context.Context, tx *sql.Tx, order *coinPurchaseOrder, actor string) (adminSubscription, error) {
	if order == nil || order.ProductType != "subscription" || order.TotalSessions <= 0 || order.DurationDays <= 0 {
		return adminSubscription{}, errors.New("invalid subscription order")
	}
	if order.SubscriptionID != "" {
		return adminSubscription{}, errCoinOrderReviewed
	}
	eligibility, err := subscriptionRenewalWindowTx(ctx, tx, order.AdminID, order.ID)
	if err != nil {
		return adminSubscription{}, err
	}
	if !eligibility.CanPurchase {
		return adminSubscription{}, fmt.Errorf("%w: %s", errSubscriptionPurchaseBlocked, eligibility.Reason)
	}
	start, err := validSubscriptionDate(eligibility.EstimatedStart)
	if err != nil {
		return adminSubscription{}, err
	}
	end := start.AddDate(0, 0, order.DurationDays-1)
	subscriptionID := "subscription-" + randHex(8)
	note := fmt.Sprintf("ซื้อ %s · order %s", strings.TrimSpace(order.PackageName), order.ID)
	if _, err = tx.ExecContext(ctx, `
		insert into admin_subscriptions (id, admin_id, start_date, end_date, total_sessions, paid_amount_thb, note, created_by)
		values ($1, $2, $3::date, $4::date, $5, $6, $7, $8)
	`, subscriptionID, order.AdminID, start.Format("2006-01-02"), end.Format("2006-01-02"), order.TotalSessions, order.PriceTHB, note, actor); err != nil {
		return adminSubscription{}, err
	}
	if _, err = tx.ExecContext(ctx, `update coin_purchase_orders set subscription_id = $2, updated_at = now() where id = $1`, order.ID, subscriptionID); err != nil {
		return adminSubscription{}, err
	}
	order.SubscriptionID = subscriptionID
	return adminSubscription{
		ID: subscriptionID, AdminID: order.AdminID, StartDate: start.Format("2006-01-02"), EndDate: end.Format("2006-01-02"),
		TotalSessions: order.TotalSessions, Remaining: order.TotalSessions, PaidAmountTHB: order.PriceTHB, Note: note,
		Status: "upcoming", CreatedBy: actor,
	}, nil
}

type subscriptionInput struct {
	StartDate     string `json:"startDate"`
	EndDate       string `json:"endDate"`
	TotalSessions int    `json:"totalSessions"`
	PaidAmountTHB int    `json:"paidAmountThb"`
	Note          string `json:"note"`
}

func validateSubscriptionInput(body subscriptionInput) error {
	start, err := validSubscriptionDate(body.StartDate)
	if err != nil {
		return errors.New("กรุณาระบุวันที่เริ่มให้ถูกต้อง")
	}
	end, err := validSubscriptionDate(body.EndDate)
	if err != nil {
		return errors.New("กรุณาระบุวันที่สิ้นสุดให้ถูกต้อง")
	}
	if end.Before(start) {
		return errors.New("วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่ม")
	}
	if body.TotalSessions <= 0 {
		return errors.New("จำนวน session ต้องมากกว่า 0")
	}
	if body.PaidAmountTHB < 0 {
		return errors.New("ยอดชำระต้องไม่ติดลบ")
	}
	return nil
}

func parseAdminSubscriptionPath(path string) (string, string) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(path, "/api/backoffice/admins/"), "/"), "/")
	if len(parts) < 3 || parts[1] != "subscriptions" {
		return "", ""
	}
	return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[2])
}

func (a *app) handleBackofficeAdminDiscount(w http.ResponseWriter, r *http.Request, actor string) {
	adminID := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/backoffice/admins/"), "/discount"))
	var body struct {
		DiscountPercent int `json:"discountPercent"`
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil || adminID == "" || body.DiscountPercent < 0 || body.DiscountPercent > 100 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ส่วนลดต้องอยู่ระหว่าง 0–100%"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var exists bool
	if err = tx.QueryRowContext(r.Context(), `select exists(select 1 from admin_users where id = $1)`, adminID).Scan(&exists); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !exists {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "admin not found"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `
		insert into admin_discounts (admin_id, discount_percent, updated_by)
		values ($1, $2, $3)
		on conflict (admin_id) do update set discount_percent = excluded.discount_percent, updated_by = excluded.updated_by, updated_at = now()
	`, adminID, body.DiscountPercent, actor); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = a.insertActivityLogTx(r.Context(), tx, "backoffice", actor, "update_admin_discount", "admin_user", adminID, map[string]any{"discountPercent": body.DiscountPercent}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	a.writeBackofficeAdminDetail(w, r, adminID)
}

func (a *app) handleBackofficeAdminSubscriptionCreate(w http.ResponseWriter, r *http.Request, actor string) {
	adminID := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/backoffice/admins/"), "/subscriptions"))
	var body subscriptionInput
	if json.NewDecoder(r.Body).Decode(&body) != nil || adminID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ข้อมูลแพ็กเกจไม่ถูกต้อง"})
		return
	}
	body.StartDate = strings.TrimSpace(body.StartDate)
	body.EndDate = strings.TrimSpace(body.EndDate)
	body.Note = strings.TrimSpace(body.Note)
	if err := validateSubscriptionInput(body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if body.EndDate < todayBangkok() {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ไม่สามารถสร้างแพ็กเกจที่หมดอายุแล้ว"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var exists bool
	if err = tx.QueryRowContext(r.Context(), `select true from admin_users where id = $1 for update`, adminID).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "admin not found"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	var openCount int
	if err = tx.QueryRowContext(r.Context(), `
		select count(*) from admin_subscriptions
		where admin_id = $1 and cancelled_at is null and end_date >= $2::date
	`, adminID, todayBangkok()).Scan(&openCount); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if openCount > 0 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "บัญชีนี้มีแพ็กเกจปัจจุบันหรือรอเริ่มอยู่แล้ว"})
		return
	}
	id := "subscription-" + randHex(8)
	if _, err = tx.ExecContext(r.Context(), `
		insert into admin_subscriptions (id, admin_id, start_date, end_date, total_sessions, paid_amount_thb, note, created_by)
		values ($1, $2, $3::date, $4::date, $5, $6, $7, $8)
	`, id, adminID, body.StartDate, body.EndDate, body.TotalSessions, body.PaidAmountTHB, body.Note, actor); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = a.insertActivityLogTx(r.Context(), tx, "backoffice", actor, "create_admin_subscription", "admin_subscription", id, map[string]any{"adminId": adminID, "startDate": body.StartDate, "endDate": body.EndDate, "totalSessions": body.TotalSessions, "paidAmountThb": body.PaidAmountTHB, "note": body.Note}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	a.writeBackofficeAdminDetail(w, r, adminID)
}

func (a *app) handleBackofficeAdminSubscriptionUpdate(w http.ResponseWriter, r *http.Request, actor string) {
	adminID, subscriptionID := parseAdminSubscriptionPath(r.URL.Path)
	var body subscriptionInput
	if json.NewDecoder(r.Body).Decode(&body) != nil || adminID == "" || subscriptionID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ข้อมูลแพ็กเกจไม่ถูกต้อง"})
		return
	}
	body.StartDate = strings.TrimSpace(body.StartDate)
	body.EndDate = strings.TrimSpace(body.EndDate)
	body.Note = strings.TrimSpace(body.Note)
	if err := validateSubscriptionInput(body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var adminExists bool
	if err = tx.QueryRowContext(r.Context(), `select true from admin_users where id = $1 for update`, adminID).Scan(&adminExists); errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "admin not found"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	var usedSessions int
	var cancelledAt sql.NullTime
	if err = tx.QueryRowContext(r.Context(), `
		select used_sessions, cancelled_at from admin_subscriptions where id = $1 and admin_id = $2 for update
	`, subscriptionID, adminID).Scan(&usedSessions, &cancelledAt); errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "subscription not found"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if cancelledAt.Valid {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "แพ็กเกจที่ยกเลิกแล้วแก้ไขไม่ได้"})
		return
	}
	if body.TotalSessions < usedSessions {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "จำนวนทั้งหมดห้ามต่ำกว่าจำนวนที่ใช้แล้ว"})
		return
	}
	var firstUsed, lastUsed sql.NullString
	if err = tx.QueryRowContext(r.Context(), `
		select min(to_char(created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD')), max(to_char(created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD'))
		from session_billing where subscription_id = $1
	`, subscriptionID).Scan(&firstUsed, &lastUsed); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if firstUsed.Valid && (body.StartDate > firstUsed.String || body.EndDate < lastUsed.String) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "ช่วงวันที่ใหม่ต้องครอบคลุม session ที่ใช้สิทธิ์ไปแล้ว"})
		return
	}
	var overlapCount int
	if err = tx.QueryRowContext(r.Context(), `
		select count(*) from admin_subscriptions
		where admin_id = $1 and id <> $2 and cancelled_at is null
			and start_date <= $4::date and end_date >= $3::date
	`, adminID, subscriptionID, body.StartDate, body.EndDate).Scan(&overlapCount); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if overlapCount > 0 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "ช่วงวันที่แพ็กเกจซ้อนกับรอบอื่น"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `
		update admin_subscriptions set start_date = $3::date, end_date = $4::date, total_sessions = $5,
			paid_amount_thb = $6, note = $7, updated_at = now()
		where id = $1 and admin_id = $2
	`, subscriptionID, adminID, body.StartDate, body.EndDate, body.TotalSessions, body.PaidAmountTHB, body.Note); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = a.insertActivityLogTx(r.Context(), tx, "backoffice", actor, "update_admin_subscription", "admin_subscription", subscriptionID, map[string]any{"adminId": adminID, "startDate": body.StartDate, "endDate": body.EndDate, "totalSessions": body.TotalSessions, "usedSessions": usedSessions, "paidAmountThb": body.PaidAmountTHB, "note": body.Note}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	a.writeBackofficeAdminDetail(w, r, adminID)
}

func (a *app) handleBackofficeAdminSubscriptionCancel(w http.ResponseWriter, r *http.Request, actor string) {
	adminID, subscriptionID := parseAdminSubscriptionPath(strings.TrimSuffix(r.URL.Path, "/cancel"))
	var body struct {
		Note string `json:"note"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if adminID == "" || subscriptionID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ข้อมูลแพ็กเกจไม่ถูกต้อง"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var adminExists bool
	if err = tx.QueryRowContext(r.Context(), `select true from admin_users where id = $1 for update`, adminID).Scan(&adminExists); errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "admin not found"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	result, err := tx.ExecContext(r.Context(), `
		update admin_subscriptions set cancelled_at = now(), cancelled_by = $3, updated_at = now()
		where id = $1 and admin_id = $2 and cancelled_at is null
	`, subscriptionID, adminID, actor)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "subscription not found or already cancelled"})
		return
	}
	if err = a.insertActivityLogTx(r.Context(), tx, "backoffice", actor, "cancel_admin_subscription", "admin_subscription", subscriptionID, map[string]any{"adminId": adminID, "note": strings.TrimSpace(body.Note)}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	a.writeBackofficeAdminDetail(w, r, adminID)
}
