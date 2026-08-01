package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type posSettingsRecord struct {
	PromptPayType         string `json:"promptPayType"`
	PromptPayID           string `json:"promptPayId"`
	PromptPayReceiverName string `json:"promptPayReceiverName"`
	ReceiptHeader         string `json:"receiptHeader"`
	ReceiptFooter         string `json:"receiptFooter"`
	LogoData              string `json:"logoData,omitempty"`
	DefaultLowStock       int    `json:"defaultLowStock"`
	Theme                 string `json:"theme"`
	Language              string `json:"language"`
	TaxRatePercent        int    `json:"taxRatePercent"`
	PricesIncludeTax      bool   `json:"pricesIncludeTax"`
}

type posProductRecord struct {
	ID                string `json:"id"`
	SKU               string `json:"sku"`
	Category          string `json:"category"`
	Name              string `json:"name"`
	PriceTHB          int    `json:"priceThb"`
	CostTHB           int    `json:"costThb"`
	StockQuantity     int    `json:"stockQuantity"`
	LowStockThreshold int    `json:"lowStockThreshold"`
	Active            bool   `json:"active"`
	LowStock          bool   `json:"lowStock"`
	Unit              string `json:"unit"`
	ImageData         string `json:"imageData,omitempty"`
}

type posCatalogRecord struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Active    bool   `json:"active"`
	UsedCount int    `json:"usedCount"`
}

type posStockBatchItemRecord struct {
	ID               int64  `json:"id"`
	ProductID        string `json:"productId"`
	ProductName      string `json:"productName"`
	Delta            int    `json:"delta"`
	Balance          int    `json:"balance"`
	UnitCostTHB      int    `json:"unitCostThb"`
	TotalCostTHB     int    `json:"totalCostThb"`
	PreviousCostTHB  int    `json:"previousCostThb"`
	ResultingCostTHB int    `json:"resultingCostThb"`
}

type posStockBatchRecord struct {
	ID           string                    `json:"id"`
	Name         string                    `json:"name"`
	Mode         string                    `json:"mode"`
	Note         string                    `json:"note,omitempty"`
	TotalCostTHB int                       `json:"totalCostThb"`
	CreatedAt    string                    `json:"createdAt"`
	Items        []posStockBatchItemRecord `json:"items"`
}

type posSaleItemRecord struct {
	ProductID   string `json:"productId"`
	ProductName string `json:"productName"`
	SKU         string `json:"sku"`
	Quantity    int    `json:"quantity"`
	UnitPrice   int    `json:"unitPriceThb"`
	LineTotal   int    `json:"lineTotalThb"`
}

type posSaleRecord struct {
	ID               string              `json:"id"`
	BillingAccountID string              `json:"billingAccountId,omitempty"`
	BuyerName        string              `json:"buyerName"`
	Status           string              `json:"status"`
	TotalTHB         int                 `json:"totalThb"`
	CostTHB          int                 `json:"costThb"`
	PaymentID        string              `json:"paymentId,omitempty"`
	Note             string              `json:"note,omitempty"`
	CreatedAt        string              `json:"createdAt"`
	Items            []posSaleItemRecord `json:"items"`
}

type billingLine struct {
	SourceType string `json:"sourceType"`
	SourceID   string `json:"sourceId"`
	Label      string `json:"label"`
	AmountTHB  int    `json:"amountThb"`
}

type billingSummary struct {
	BillingAccountID string        `json:"billingAccountId,omitempty"`
	MemberID         string        `json:"memberId,omitempty"`
	DisplayName      string        `json:"displayName"`
	MatchTotalTHB    int           `json:"matchTotalThb"`
	POSTotalTHB      int           `json:"posTotalThb"`
	TotalTHB         int           `json:"totalThb"`
	POSEnabled       bool          `json:"posEnabled"`
	PromptPayPayload string        `json:"promptPayPayload,omitempty"`
	ReceiverName     string        `json:"receiverName,omitempty"`
	Lines            []billingLine `json:"lines"`
	CalculatedAt     time.Time     `json:"calculatedAt"`
}

func (a *app) ensurePOSSettings(ctx context.Context, adminID string) (posSettingsRecord, error) {
	_, err := a.db.ExecContext(ctx, `insert into pos_settings (admin_id) values ($1) on conflict (admin_id) do nothing`, adminID)
	if err != nil {
		return posSettingsRecord{}, err
	}
	return a.posSettings(ctx, adminID)
}

func (a *app) posSettings(ctx context.Context, adminID string) (posSettingsRecord, error) {
	var s posSettingsRecord
	err := a.db.QueryRowContext(ctx, `select promptpay_type,promptpay_id,promptpay_receiver_name,receipt_header,receipt_footer,logo_data,default_low_stock,theme,language,tax_rate_percent,prices_include_tax from pos_settings where admin_id=$1`, adminID).Scan(
		&s.PromptPayType, &s.PromptPayID, &s.PromptPayReceiverName, &s.ReceiptHeader, &s.ReceiptFooter, &s.LogoData, &s.DefaultLowStock, &s.Theme, &s.Language, &s.TaxRatePercent, &s.PricesIncludeTax,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return a.ensurePOSSettings(ctx, adminID)
	}
	return s, err
}

func (a *app) handleAdminPOS(w http.ResponseWriter, r *http.Request, user adminUser, action string) {
	path := strings.Trim(strings.TrimPrefix(action, "pos"), "/")
	readOnly := r.Method == http.MethodGet
	operationalRead := path == "qr" || path == "billing-summary"
	if (!readOnly || operationalRead) && !a.requireFeature(w, r, user.ID, "pos") {
		return
	}
	switch {
	case r.Method == http.MethodGet && (path == "" || path == "overview"):
		a.writePOSOverview(w, r, user.ID)
	case r.Method == http.MethodGet && path == "qr":
		a.writePOSQR(w, r, user.ID)
	case r.Method == http.MethodPut && path == "settings":
		a.savePOSSettings(w, r, user)
	case r.Method == http.MethodPost && path == "products":
		a.createPOSProduct(w, r, user)
	case r.Method == http.MethodPost && path == "categories":
		a.createPOSCategory(w, r, user)
	case r.Method == http.MethodPatch && strings.HasPrefix(path, "categories/"):
		a.patchPOSCategory(w, r, user, strings.TrimPrefix(path, "categories/"))
	case r.Method == http.MethodDelete && strings.HasPrefix(path, "categories/"):
		a.deletePOSCategory(w, r, user, strings.TrimPrefix(path, "categories/"))
	case r.Method == http.MethodPost && path == "units":
		a.createPOSUnit(w, r, user)
	case r.Method == http.MethodPatch && strings.HasPrefix(path, "units/"):
		a.patchPOSUnit(w, r, user, strings.TrimPrefix(path, "units/"))
	case r.Method == http.MethodDelete && strings.HasPrefix(path, "units/"):
		a.deletePOSUnit(w, r, user, strings.TrimPrefix(path, "units/"))
	case r.Method == http.MethodPost && path == "stock/batch":
		a.adjustPOSStockBatch(w, r, user)
	case r.Method == http.MethodPatch && strings.HasPrefix(path, "products/") && !strings.HasSuffix(path, "/stock"):
		a.patchPOSProduct(w, r, user, strings.TrimPrefix(path, "products/"))
	case r.Method == http.MethodPost && strings.HasPrefix(path, "products/") && strings.HasSuffix(path, "/stock"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "products/"), "/stock")
		a.adjustPOSStock(w, r, user, id)
	case r.Method == http.MethodPost && path == "guests":
		a.createPOSGuest(w, r, user)
	case r.Method == http.MethodPost && path == "sales":
		a.createPOSSale(w, r, user)
	case r.Method == http.MethodPost && strings.HasPrefix(path, "sales/") && strings.HasSuffix(path, "/void"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "sales/"), "/void")
		a.voidPOSSale(w, r, user, id)
	case r.Method == http.MethodGet && path == "billing-summary":
		a.writePOSBillingSummary(w, r, user)
	case r.Method == http.MethodPost && path == "settlements":
		a.handlePOSSettlement(w, r, user)
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	}
}

func (a *app) listPOSProducts(ctx context.Context, adminID string) ([]posProductRecord, error) {
	items := []posProductRecord{}
	rows, err := a.db.QueryContext(ctx, `select id,sku,category,name,price_thb,cost_thb,stock_quantity,low_stock_threshold,active,unit,image_data from pos_products where admin_id=$1 order by active desc,category,name`, adminID)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	for rows.Next() {
		var p posProductRecord
		if err = rows.Scan(&p.ID, &p.SKU, &p.Category, &p.Name, &p.PriceTHB, &p.CostTHB, &p.StockQuantity, &p.LowStockThreshold, &p.Active, &p.Unit, &p.ImageData); err != nil {
			return items, err
		}
		p.LowStock = p.StockQuantity <= p.LowStockThreshold
		items = append(items, p)
	}
	return items, rows.Err()
}

func (a *app) listPOSSales(ctx context.Context, adminID string, limit int) ([]posSaleRecord, error) {
	if limit < 1 || limit > 200 {
		limit = 100
	}
	items := []posSaleRecord{}
	rows, err := a.db.QueryContext(ctx, `select id,coalesce(billing_account_id,''),buyer_name,status,total_thb,cost_thb,coalesce(payment_id,''),note,to_char(created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from pos_sales where admin_id=$1 order by created_at desc limit $2`, adminID, limit)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	byID := map[string]*posSaleRecord{}
	for rows.Next() {
		var sale posSaleRecord
		sale.Items = []posSaleItemRecord{}
		if err = rows.Scan(&sale.ID, &sale.BillingAccountID, &sale.BuyerName, &sale.Status, &sale.TotalTHB, &sale.CostTHB, &sale.PaymentID, &sale.Note, &sale.CreatedAt); err != nil {
			return items, err
		}
		items = append(items, sale)
		byID[sale.ID] = &items[len(items)-1]
	}
	if err = rows.Err(); err != nil || len(items) == 0 {
		return items, err
	}
	ids := make([]string, 0, len(items))
	for _, sale := range items {
		ids = append(ids, sale.ID)
	}
	itemRows, err := a.db.QueryContext(ctx, `select sale_id,coalesce(product_id,''),product_name,sku,quantity,unit_price_thb,line_total_thb from pos_sale_items where sale_id=any($1) order by id`, ids)
	if err != nil {
		return items, err
	}
	defer itemRows.Close()
	for itemRows.Next() {
		var saleID string
		var item posSaleItemRecord
		if err = itemRows.Scan(&saleID, &item.ProductID, &item.ProductName, &item.SKU, &item.Quantity, &item.UnitPrice, &item.LineTotal); err != nil {
			return items, err
		}
		if sale := byID[saleID]; sale != nil {
			sale.Items = append(sale.Items, item)
		}
	}
	return items, itemRows.Err()
}

func (a *app) listPOSCustomers(ctx context.Context, adminID string) ([]map[string]any, error) {
	items := []map[string]any{}
	rows, err := a.db.QueryContext(ctx, `
		select 'member',m.id,m.name,m.phone,coalesce(ba.id,''),''
		from members m left join billing_accounts ba on ba.admin_id=m.admin_id and ba.member_id=m.id
		where m.admin_id=$1 and m.deleted_at is null and m.active
		union all
		select 'guest',ba.id,ba.display_name,ba.phone,ba.id,'' from billing_accounts ba
		where ba.admin_id=$1 and ba.kind='guest' and ba.active
		union all
		select 'player',p.session_id||':'||p.id::text,p.name,'',coalesce(p.billing_account_id,''),coalesce(s.name,p.session_id)
		from players p join sessions s on s.id=p.session_id
		where s.admin_id=$1 and p.active and p.member_id is null
		  and coalesce(s.usage_started_at,s.created_at) >= date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'
		order by 3`, adminID)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	for rows.Next() {
		var kind, id, name, phone, accountID, sessionName string
		if err = rows.Scan(&kind, &id, &name, &phone, &accountID, &sessionName); err != nil {
			return items, err
		}
		items = append(items, map[string]any{"kind": kind, "id": id, "name": name, "phone": displayPhone(phone), "billingAccountId": accountID, "sessionName": sessionName})
	}
	return items, rows.Err()
}

func (a *app) listPOSStockMovements(ctx context.Context, adminID string, limit int) ([]map[string]any, error) {
	if limit < 1 || limit > 200 {
		limit = 100
	}
	items := []map[string]any{}
	rows, err := a.db.QueryContext(ctx, `select m.id,m.product_id,p.name,m.delta,m.balance,m.reason,m.note,coalesce(m.sale_id,''),to_char(m.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from pos_stock_movements m join pos_products p on p.id=m.product_id where m.admin_id=$1 order by m.created_at desc,m.id desc limit $2`, adminID, limit)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var productID, productName, reason, note, saleID, createdAt string
		var delta, balance int
		if err = rows.Scan(&id, &productID, &productName, &delta, &balance, &reason, &note, &saleID, &createdAt); err != nil {
			return items, err
		}
		items = append(items, map[string]any{"id": id, "productId": productID, "productName": productName, "delta": delta, "balance": balance, "reason": reason, "note": note, "saleId": saleID, "createdAt": createdAt})
	}
	return items, rows.Err()
}

func (a *app) listPOSStockBatches(ctx context.Context, adminID string, limit int) ([]posStockBatchRecord, error) {
	if limit < 1 || limit > 200 {
		limit = 100
	}
	items := []posStockBatchRecord{}
	rows, err := a.db.QueryContext(ctx, `select id,name,mode,note,total_cost_thb,to_char(created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from pos_stock_batches where admin_id=$1 order by created_at desc,id desc limit $2`, adminID, limit)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	for rows.Next() {
		var item posStockBatchRecord
		if err = rows.Scan(&item.ID, &item.Name, &item.Mode, &item.Note, &item.TotalCostTHB, &item.CreatedAt); err != nil {
			return items, err
		}
		item.Items = []posStockBatchItemRecord{}
		movementRows, queryErr := a.db.QueryContext(ctx, `select m.id,m.product_id,p.name,m.delta,m.balance,m.unit_cost_thb,m.total_cost_thb,m.previous_cost_thb,m.resulting_cost_thb from pos_stock_movements m join pos_products p on p.id=m.product_id where m.batch_id=$1 order by m.id`, item.ID)
		if queryErr != nil {
			return items, queryErr
		}
		for movementRows.Next() {
			var movement posStockBatchItemRecord
			if queryErr = movementRows.Scan(&movement.ID, &movement.ProductID, &movement.ProductName, &movement.Delta, &movement.Balance, &movement.UnitCostTHB, &movement.TotalCostTHB, &movement.PreviousCostTHB, &movement.ResultingCostTHB); queryErr != nil {
				movementRows.Close()
				return items, queryErr
			}
			item.Items = append(item.Items, movement)
		}
		queryErr = movementRows.Err()
		movementRows.Close()
		if queryErr != nil {
			return items, queryErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (a *app) posReport(ctx context.Context, adminID string) (map[string]any, error) {
	result := map[string]any{"salesThb": 0, "costThb": 0, "grossProfitThb": 0, "cashThb": 0, "promptPayThb": 0, "outstandingThb": 0, "lowStockCount": 0}
	var sales, cost, cash, promptpay, outstanding, low int
	err := a.db.QueryRowContext(ctx, `
		select
			coalesce(sum(s.total_thb) filter (where s.status='paid' and s.created_at >= date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'),0),
			coalesce(sum(s.cost_thb) filter (where s.status='paid' and s.created_at >= date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'),0),
			coalesce((select sum(amount_thb) from billing_payments where admin_id=$1 and status='paid' and method='cash' and created_at >= date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'),0),
			coalesce((select sum(amount_thb) from billing_payments where admin_id=$1 and status='paid' and method='promptpay' and created_at >= date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'),0),
			coalesce((select sum(total_thb) from pos_sales where admin_id=$1 and status='open'),0),
			(select count(*) from pos_products where admin_id=$1 and active and stock_quantity<=low_stock_threshold)
		from pos_sales s
		where s.admin_id=$1`, adminID).Scan(&sales, &cost, &cash, &promptpay, &outstanding, &low)
	if err != nil {
		return result, err
	}
	result["salesThb"], result["costThb"], result["grossProfitThb"] = sales, cost, sales-cost
	result["cashThb"], result["promptPayThb"], result["outstandingThb"], result["lowStockCount"] = cash, promptpay, outstanding, low
	return result, nil
}

func (a *app) writePOSOverview(w http.ResponseWriter, r *http.Request, adminID string) {
	settings, err := a.ensurePOSSettings(r.Context(), adminID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	products, err := a.listPOSProducts(r.Context(), adminID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	sales, err := a.listPOSSales(r.Context(), adminID, 100)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	customers, _ := a.listPOSCustomers(r.Context(), adminID)
	movements, _ := a.listPOSStockMovements(r.Context(), adminID, 100)
	stockBatches, _ := a.listPOSStockBatches(r.Context(), adminID, 100)
	report, _ := a.posReport(r.Context(), adminID)
	categories, _ := a.listPOSCategories(r.Context(), adminID)
	units, _ := a.listPOSUnits(r.Context(), adminID)
	writeJSON(w, 200, map[string]any{"enabled": a.features(r.Context(), adminID).POSEnabled, "settings": settings, "products": products, "categories": categories, "units": units, "sales": sales, "customers": customers, "stockMovements": movements, "stockBatches": stockBatches, "report": report})
}

func (a *app) listPOSCategories(ctx context.Context, adminID string) ([]posCatalogRecord, error) {
	return a.listPOSCatalog(ctx, adminID, "category")
}

func (a *app) listPOSUnits(ctx context.Context, adminID string) ([]posCatalogRecord, error) {
	return a.listPOSCatalog(ctx, adminID, "unit")
}

func (a *app) listPOSCatalog(ctx context.Context, adminID, kind string) ([]posCatalogRecord, error) {
	items := []posCatalogRecord{}
	table, productColumn := "pos_categories", "category"
	if kind == "unit" {
		table, productColumn = "pos_units", "unit"
	}
	query := fmt.Sprintf(`select c.id,c.name,c.active,(select count(*) from pos_products p where p.admin_id=c.admin_id and lower(p.%s)=lower(c.name)) from %s c where c.admin_id=$1 order by c.active desc,lower(c.name)`, productColumn, table)
	rows, err := a.db.QueryContext(ctx, query, adminID)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	for rows.Next() {
		var item posCatalogRecord
		if err = rows.Scan(&item.ID, &item.Name, &item.Active, &item.UsedCount); err != nil {
			return items, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func decodePOSCatalog(w http.ResponseWriter, r *http.Request) (string, bool, bool) {
	var b struct {
		Name   string `json:"name"`
		Active *bool  `json:"active"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid catalog"})
		return "", false, false
	}
	b.Name = strings.TrimSpace(b.Name)
	if b.Name == "" || len(b.Name) > 100 {
		writeJSON(w, 400, map[string]string{"error": "กรุณาระบุชื่อไม่เกิน 100 ตัวอักษร"})
		return "", false, false
	}
	active := true
	if b.Active != nil {
		active = *b.Active
	}
	return b.Name, active, true
}

func (a *app) createPOSCategory(w http.ResponseWriter, r *http.Request, user adminUser) {
	a.createPOSCatalog(w, r, user, "category")
}
func (a *app) createPOSUnit(w http.ResponseWriter, r *http.Request, user adminUser) {
	a.createPOSCatalog(w, r, user, "unit")
}
func (a *app) patchPOSCategory(w http.ResponseWriter, r *http.Request, user adminUser, id string) {
	a.patchPOSCatalog(w, r, user, id, "category")
}
func (a *app) patchPOSUnit(w http.ResponseWriter, r *http.Request, user adminUser, id string) {
	a.patchPOSCatalog(w, r, user, id, "unit")
}
func (a *app) deletePOSCategory(w http.ResponseWriter, r *http.Request, user adminUser, id string) {
	a.deletePOSCatalog(w, r, user, id, "category")
}
func (a *app) deletePOSUnit(w http.ResponseWriter, r *http.Request, user adminUser, id string) {
	a.deletePOSCatalog(w, r, user, id, "unit")
}

func (a *app) createPOSCatalog(w http.ResponseWriter, r *http.Request, user adminUser, kind string) {
	name, active, ok := decodePOSCatalog(w, r)
	if !ok {
		return
	}
	table, prefix := "pos_categories", "category-"
	if kind == "unit" {
		table, prefix = "pos_units", "unit-"
	}
	id := prefix + randHex(8)
	query := fmt.Sprintf(`insert into %s (id,admin_id,name,active) values ($1,$2,$3,$4)`, table)
	if _, err := a.db.ExecContext(r.Context(), query, id, user.ID, name, active); err != nil {
		writeJSON(w, 409, map[string]string{"error": "มีชื่อนี้แล้ว"})
		return
	}
	writeJSON(w, 201, posCatalogRecord{ID: id, Name: name, Active: active})
}

func (a *app) patchPOSCatalog(w http.ResponseWriter, r *http.Request, user adminUser, id, kind string) {
	name, active, ok := decodePOSCatalog(w, r)
	if !ok {
		return
	}
	table, column := "pos_categories", "category"
	if kind == "unit" {
		table, column = "pos_units", "unit"
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var oldName string
	if err = tx.QueryRowContext(r.Context(), fmt.Sprintf(`select name from %s where id=$1 and admin_id=$2 for update`, table), id, user.ID).Scan(&oldName); err != nil {
		writeJSON(w, 404, map[string]string{"error": "not found"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), fmt.Sprintf(`update %s set name=$3,active=$4 where id=$1 and admin_id=$2`, table), id, user.ID, name, active); err == nil {
		_, err = tx.ExecContext(r.Context(), fmt.Sprintf(`update pos_products set %s=$3,updated_at=now() where admin_id=$1 and lower(%s)=lower($2)`, column, column), user.ID, oldName, name)
	}
	if err != nil || tx.Commit() != nil {
		writeJSON(w, 409, map[string]string{"error": "ชื่อซ้ำหรือแก้ไขไม่สำเร็จ"})
		return
	}
	writeJSON(w, 200, posCatalogRecord{ID: id, Name: name, Active: active})
}

func (a *app) deletePOSCatalog(w http.ResponseWriter, r *http.Request, user adminUser, id, kind string) {
	table, column := "pos_categories", "category"
	if kind == "unit" {
		table, column = "pos_units", "unit"
	}
	var used int
	query := fmt.Sprintf(`select (select count(*) from pos_products p where p.admin_id=c.admin_id and lower(p.%s)=lower(c.name)) from %s c where c.id=$1 and c.admin_id=$2`, column, table)
	if err := a.db.QueryRowContext(r.Context(), query, id, user.ID).Scan(&used); err != nil {
		writeJSON(w, 404, map[string]string{"error": "not found"})
		return
	}
	if used > 0 {
		writeJSON(w, 409, map[string]string{"error": "ลบไม่ได้ เนื่องจากมีสินค้าใช้งานรายการนี้อยู่"})
		return
	}
	if _, err := a.db.ExecContext(r.Context(), fmt.Sprintf(`delete from %s where id=$1 and admin_id=$2`, table), id, user.ID); err != nil {
		writeJSON(w, 500, map[string]string{"error": "ลบไม่สำเร็จ"})
		return
	}
	writeJSON(w, 200, map[string]bool{"deleted": true})
}

func (a *app) savePOSSettings(w http.ResponseWriter, r *http.Request, user adminUser) {
	var b posSettingsRecord
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 3<<20)).Decode(&b) != nil || b.DefaultLowStock < 0 || b.TaxRatePercent < 0 || b.TaxRatePercent > 100 || len(b.ReceiptHeader) > 500 || len(b.ReceiptFooter) > 500 || len(b.LogoData) > 2_800_000 || !validImageData(b.LogoData, true) {
		writeJSON(w, 400, map[string]string{"error": "invalid POS settings"})
		return
	}
	b.PromptPayType, b.PromptPayID, b.PromptPayReceiverName = strings.TrimSpace(b.PromptPayType), strings.TrimSpace(b.PromptPayID), strings.TrimSpace(b.PromptPayReceiverName)
	if b.PromptPayType == "" {
		b.PromptPayType = "mobile"
	}
	if b.PromptPayID != "" {
		if _, _, err := normalizePromptPayTarget(promptPaySettings{ID: b.PromptPayID, Type: b.PromptPayType}); err != nil {
			writeJSON(w, 400, map[string]string{"error": "PromptPay setting ไม่ถูกต้อง"})
			return
		}
	}
	if b.Theme != "dark" {
		b.Theme = "light"
	}
	if b.Language != "en" {
		b.Language = "th"
	}
	_, err := a.db.ExecContext(r.Context(), `insert into pos_settings (admin_id,promptpay_type,promptpay_id,promptpay_receiver_name,receipt_header,receipt_footer,logo_data,default_low_stock,theme,language,tax_rate_percent,prices_include_tax) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (admin_id) do update set promptpay_type=excluded.promptpay_type,promptpay_id=excluded.promptpay_id,promptpay_receiver_name=excluded.promptpay_receiver_name,receipt_header=excluded.receipt_header,receipt_footer=excluded.receipt_footer,logo_data=excluded.logo_data,default_low_stock=excluded.default_low_stock,theme=excluded.theme,language=excluded.language,tax_rate_percent=excluded.tax_rate_percent,prices_include_tax=excluded.prices_include_tax,updated_at=now()`, user.ID, b.PromptPayType, b.PromptPayID, b.PromptPayReceiverName, strings.TrimSpace(b.ReceiptHeader), strings.TrimSpace(b.ReceiptFooter), b.LogoData, b.DefaultLowStock, b.Theme, b.Language, b.TaxRatePercent, b.PricesIncludeTax)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	a.insertActivityLog(r.Context(), "admin", user.ID, "update_pos_settings", "pos_settings", user.ID, map[string]any{"hasPromptPay": b.PromptPayID != ""})
	a.writePOSOverview(w, r, user.ID)
}

func decodePOSProduct(w http.ResponseWriter, r *http.Request) (posProductRecord, bool) {
	var p posProductRecord
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&p) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid product"})
		return p, false
	}
	p.SKU, p.Category, p.Name, p.Unit = strings.TrimSpace(p.SKU), strings.TrimSpace(p.Category), strings.TrimSpace(p.Name), strings.TrimSpace(p.Unit)
	if p.Name == "" || len(p.Name) > 160 || len(p.SKU) > 80 || len(p.Category) > 100 || len(p.Unit) > 40 || len(p.ImageData) > 2_800_000 || !validImageData(p.ImageData, true) || p.PriceTHB < 0 || p.CostTHB < 0 || p.StockQuantity < 0 || p.LowStockThreshold < 0 {
		writeJSON(w, 400, map[string]string{"error": "invalid product"})
		return p, false
	}
	return p, true
}

func (a *app) createPOSProduct(w http.ResponseWriter, r *http.Request, user adminUser) {
	p, ok := decodePOSProduct(w, r)
	if !ok {
		return
	}
	if p.LowStockThreshold == 0 {
		settings, _ := a.ensurePOSSettings(r.Context(), user.ID)
		p.LowStockThreshold = settings.DefaultLowStock
	}
	p.ID = "product-" + randHex(8)
	_, err := a.db.ExecContext(r.Context(), `insert into pos_products (id,admin_id,sku,category,name,price_thb,cost_thb,stock_quantity,low_stock_threshold,active,unit,image_data) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, p.ID, user.ID, p.SKU, p.Category, p.Name, p.PriceTHB, p.CostTHB, p.StockQuantity, p.LowStockThreshold, p.Active, p.Unit, p.ImageData)
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": "SKU ซ้ำหรือข้อมูลสินค้าไม่ถูกต้อง"})
		return
	}
	if p.StockQuantity > 0 {
		_, _ = a.db.ExecContext(r.Context(), `insert into pos_stock_movements (admin_id,product_id,delta,balance,reason,note,actor_id) values ($1,$2,$3,$3,'restock','สต็อกเริ่มต้น',$4)`, user.ID, p.ID, p.StockQuantity, user.ID)
	}
	writeJSON(w, 201, p)
}

func (a *app) patchPOSProduct(w http.ResponseWriter, r *http.Request, user adminUser, id string) {
	p, ok := decodePOSProduct(w, r)
	if !ok {
		return
	}
	result, err := a.db.ExecContext(r.Context(), `update pos_products set sku=$3,category=$4,name=$5,price_thb=$6,cost_thb=$7,low_stock_threshold=$8,active=$9,unit=$10,image_data=$11,updated_at=now() where id=$1 and admin_id=$2`, id, user.ID, p.SKU, p.Category, p.Name, p.PriceTHB, p.CostTHB, p.LowStockThreshold, p.Active, p.Unit, p.ImageData)
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": "SKU ซ้ำหรือข้อมูลสินค้าไม่ถูกต้อง"})
		return
	}
	if count, _ := result.RowsAffected(); count == 0 {
		writeJSON(w, 404, map[string]string{"error": "product not found"})
		return
	}
	a.writePOSOverview(w, r, user.ID)
}

func (a *app) adjustPOSStock(w http.ResponseWriter, r *http.Request, user adminUser, id string) {
	var b struct {
		Delta   int    `json:"delta"`
		CostTHB *int   `json:"costThb"`
		Note    string `json:"note"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&b) != nil || (b.Delta == 0 && b.CostTHB == nil) || (b.CostTHB != nil && *b.CostTHB < 0) || len(b.Note) > 300 {
		writeJSON(w, 400, map[string]string{"error": "invalid stock adjustment"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var balance int
	if err = tx.QueryRowContext(r.Context(), `update pos_products set stock_quantity=stock_quantity+$3,cost_thb=coalesce($4,cost_thb),updated_at=now() where id=$1 and admin_id=$2 and stock_quantity+$3>=0 returning stock_quantity`, id, user.ID, b.Delta, b.CostTHB).Scan(&balance); err != nil {
		writeJSON(w, 409, map[string]string{"error": "สต็อกไม่เพียงพอหรือไม่พบสินค้า"})
		return
	}
	if b.Delta != 0 {
		reason := "adjustment"
		if b.Delta > 0 {
			reason = "restock"
		}
		_, err = tx.ExecContext(r.Context(), `insert into pos_stock_movements (admin_id,product_id,delta,balance,reason,note,actor_id) values ($1,$2,$3,$4,$5,$6,$7)`, user.ID, id, b.Delta, balance, reason, strings.TrimSpace(b.Note), user.ID)
	}
	if err != nil || tx.Commit() != nil {
		writeJSON(w, 500, map[string]string{"error": "บันทึกสต็อกไม่สำเร็จ"})
		return
	}
	a.writePOSOverview(w, r, user.ID)
}

type posStockBatchRequest struct {
	Name  string `json:"name"`
	Mode  string `json:"mode"`
	Note  string `json:"note"`
	Items []struct {
		ProductID      string `json:"productId"`
		Quantity       int    `json:"quantity"`
		TargetQuantity int    `json:"targetQuantity"`
		CostTHB        *int   `json:"costThb"`
	} `json:"items"`
}

func weightedAverageCost(currentQuantity, currentCost, incomingQuantity, incomingCost int) int {
	newQuantity := currentQuantity + incomingQuantity
	if newQuantity <= 0 {
		return currentCost
	}
	total := int64(currentQuantity)*int64(currentCost) + int64(incomingQuantity)*int64(incomingCost)
	return int((total + int64(newQuantity)/2) / int64(newQuantity))
}

func (a *app) adjustPOSStockBatch(w http.ResponseWriter, r *http.Request, user adminUser) {
	var b posStockBatchRequest
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10)).Decode(&b) != nil || (b.Mode != "in" && b.Mode != "out" && b.Mode != "adjust") || len(b.Items) == 0 || len(b.Items) > 200 || len(b.Note) > 300 {
		writeJSON(w, 400, map[string]string{"error": "invalid stock batch"})
		return
	}
	b.Name, b.Note = strings.TrimSpace(b.Name), strings.TrimSpace(b.Note)
	if b.Name == "" || len(b.Name) > 160 {
		writeJSON(w, 400, map[string]string{"error": "กรุณาระบุชื่อรายการไม่เกิน 160 ตัวอักษร"})
		return
	}
	ids := make([]string, 0, len(b.Items))
	seen := map[string]bool{}
	for index := range b.Items {
		item := &b.Items[index]
		item.ProductID = strings.TrimSpace(item.ProductID)
		if item.ProductID == "" || seen[item.ProductID] || (b.Mode != "adjust" && item.Quantity <= 0) || (b.Mode == "adjust" && item.TargetQuantity < 0) || (item.CostTHB != nil && *item.CostTHB < 0) || (b.Mode == "in" && item.CostTHB == nil) {
			writeJSON(w, 400, map[string]string{"error": "ข้อมูลสินค้าในรายการไม่ถูกต้อง"})
			return
		}
		seen[item.ProductID] = true
		ids = append(ids, item.ProductID)
	}
	sort.Strings(ids)
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	type lockedProduct struct {
		stock int
		cost  int
		name  string
	}
	locked := map[string]lockedProduct{}
	for _, id := range ids {
		var p lockedProduct
		if err = tx.QueryRowContext(r.Context(), `select stock_quantity,cost_thb,name from pos_products where id=$1 and admin_id=$2 for update`, id, user.ID).Scan(&p.stock, &p.cost, &p.name); err != nil {
			writeJSON(w, 404, map[string]string{"error": "ไม่พบสินค้าในรายการ"})
			return
		}
		locked[id] = p
	}
	batchID := "stock-" + randHex(8)
	if _, err = tx.ExecContext(r.Context(), `insert into pos_stock_batches (id,admin_id,name,mode,note,actor_id) values ($1,$2,$3,$4,$5,$6)`, batchID, user.ID, b.Name, b.Mode, b.Note, user.ID); err != nil {
		writeJSON(w, 500, map[string]string{"error": "สร้างเอกสารสต็อกไม่สำเร็จ"})
		return
	}
	totalBatchCost := 0
	for _, item := range b.Items {
		product := locked[item.ProductID]
		current := product.stock
		delta := item.Quantity
		if b.Mode == "out" {
			delta = -item.Quantity
		}
		if b.Mode == "adjust" {
			delta = item.TargetQuantity - current
		}
		if current+delta < 0 {
			writeJSON(w, http.StatusConflict, map[string]any{"error": "สต็อกสินค้าไม่เพียงพอ", "productId": item.ProductID, "available": current})
			return
		}
		balance := current + delta
		movementUnitCost := product.cost
		resultingCost := product.cost
		if delta > 0 {
			incomingCost := product.cost
			if item.CostTHB != nil {
				incomingCost = *item.CostTHB
			}
			movementUnitCost = incomingCost
			resultingCost = weightedAverageCost(current, product.cost, delta, incomingCost)
		}
		totalCost := delta * movementUnitCost
		if totalCost < 0 {
			totalCost = -totalCost
		}
		totalBatchCost += totalCost
		if _, err = tx.ExecContext(r.Context(), `update pos_products set stock_quantity=$3,cost_thb=$4,updated_at=now() where id=$1 and admin_id=$2`, item.ProductID, user.ID, balance, resultingCost); err != nil {
			writeJSON(w, 500, map[string]string{"error": "บันทึกรายการสต็อกไม่สำเร็จ"})
			return
		}
		if delta != 0 {
			reason := "adjustment"
			if b.Mode == "in" {
				reason = "restock"
			}
			if _, err = tx.ExecContext(r.Context(), `insert into pos_stock_movements (admin_id,product_id,batch_id,delta,balance,reason,note,actor_id,unit_cost_thb,total_cost_thb,previous_cost_thb,resulting_cost_thb) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, user.ID, item.ProductID, batchID, delta, balance, reason, b.Note, user.ID, movementUnitCost, totalCost, product.cost, resultingCost); err != nil {
				writeJSON(w, 500, map[string]string{"error": "บันทึกประวัติสต็อกไม่สำเร็จ"})
				return
			}
		}
	}
	if _, err = tx.ExecContext(r.Context(), `update pos_stock_batches set total_cost_thb=$2 where id=$1`, batchID, totalBatchCost); err != nil {
		writeJSON(w, 500, map[string]string{"error": "สรุปต้นทุนเอกสารไม่สำเร็จ"})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": "บันทึกรายการสต็อกไม่สำเร็จ"})
		return
	}
	a.insertActivityLog(r.Context(), "admin", user.ID, "adjust_pos_stock_batch", "pos_stock_batch", batchID, map[string]any{"mode": b.Mode, "name": b.Name, "items": len(b.Items), "totalCostThb": totalBatchCost})
	a.writePOSOverview(w, r, user.ID)
}

func ensureBillingAccountTx(ctx context.Context, tx *sql.Tx, adminID, kind, sourceID, name, phone string) (string, error) {
	if kind == "member" {
		var id, memberName, memberPhone string
		err := tx.QueryRowContext(ctx, `select coalesce((select id from billing_accounts where admin_id=$1 and member_id=m.id),''),m.name,m.phone from members m where m.id=$2 and m.admin_id=$1 and m.deleted_at is null`, adminID, sourceID).Scan(&id, &memberName, &memberPhone)
		if err != nil {
			return "", err
		}
		if id != "" {
			return id, nil
		}
		id = "account-" + randHex(8)
		_, err = tx.ExecContext(ctx, `insert into billing_accounts (id,admin_id,kind,member_id,display_name,phone) values ($1,$2,'member',$3,$4,$5) on conflict (admin_id,member_id) where member_id is not null do update set display_name=excluded.display_name,phone=excluded.phone,updated_at=now()`, id, adminID, sourceID, memberName, memberPhone)
		if err != nil {
			return "", err
		}
		_ = tx.QueryRowContext(ctx, `select id from billing_accounts where admin_id=$1 and member_id=$2`, adminID, sourceID).Scan(&id)
		_, _ = tx.ExecContext(ctx, `update players p set billing_account_id=$3 from sessions s where p.session_id=s.id and s.admin_id=$1 and p.member_id=$2`, adminID, sourceID, id)
		return id, nil
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("guest name is required")
	}
	id := "account-" + randHex(8)
	_, err := tx.ExecContext(ctx, `insert into billing_accounts (id,admin_id,kind,display_name,phone) values ($1,$2,'guest',$3,$4)`, id, adminID, name, strings.TrimSpace(phone))
	return id, err
}

func (a *app) createPOSGuest(w http.ResponseWriter, r *http.Request, user adminUser) {
	var b struct{ Name, Phone string }
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&b) != nil || strings.TrimSpace(b.Name) == "" || len(b.Name) > 160 {
		writeJSON(w, 400, map[string]string{"error": "กรุณาระบุชื่อขาจร"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	id, err := ensureBillingAccountTx(r.Context(), tx, user.ID, "guest", "", b.Name, b.Phone)
	if err != nil || tx.Commit() != nil {
		writeJSON(w, 500, map[string]string{"error": "สร้างขาจรไม่สำเร็จ"})
		return
	}
	writeJSON(w, 201, map[string]any{"id": id, "kind": "guest", "name": strings.TrimSpace(b.Name), "phone": strings.TrimSpace(b.Phone), "billingAccountId": id})
}

type posSaleRequest struct {
	BuyerType        string `json:"buyerType"`
	BuyerID          string `json:"buyerId"`
	BuyerName        string `json:"buyerName"`
	Phone            string `json:"phone"`
	Action           string `json:"action"`
	Method           string `json:"method"`
	Note             string `json:"note"`
	ExpectedTotalTHB int    `json:"expectedTotalThb"`
	Items            []struct {
		ProductID string `json:"productId"`
		Quantity  int    `json:"quantity"`
	} `json:"items"`
}

func validPaymentMethod(value string) bool { return value == "cash" || value == "promptpay" }

func (a *app) createPOSSale(w http.ResponseWriter, r *http.Request, user adminUser) {
	var b posSaleRequest
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10)).Decode(&b) != nil || len(b.Items) == 0 || len(b.Items) > 100 || len(b.Note) > 500 {
		writeJSON(w, 400, map[string]string{"error": "invalid sale"})
		return
	}
	b.BuyerType, b.BuyerID, b.BuyerName, b.Action, b.Method = strings.TrimSpace(b.BuyerType), strings.TrimSpace(b.BuyerID), strings.TrimSpace(b.BuyerName), strings.TrimSpace(b.Action), strings.TrimSpace(b.Method)
	if b.Action != "open" && b.Action != "pay" {
		writeJSON(w, 400, map[string]string{"error": "invalid sale action"})
		return
	}
	if b.Action == "open" && b.BuyerType == "anonymous" {
		writeJSON(w, 400, map[string]string{"error": "บิลพักยอดต้องระบุสมาชิกหรือขาจร"})
		return
	}
	if b.Action == "pay" && !validPaymentMethod(b.Method) {
		writeJSON(w, 400, map[string]string{"error": "invalid payment method"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	accountID, buyerName := "", b.BuyerName
	if b.BuyerType == "member" {
		accountID, err = ensureBillingAccountTx(r.Context(), tx, user.ID, "member", b.BuyerID, "", "")
	} else if b.BuyerType == "guest" {
		if strings.HasPrefix(b.BuyerID, "account-") {
			err = tx.QueryRowContext(r.Context(), `select display_name from billing_accounts where id=$1 and admin_id=$2 and kind='guest' and active`, b.BuyerID, user.ID).Scan(&buyerName)
			accountID = b.BuyerID
		} else {
			accountID, err = ensureBillingAccountTx(r.Context(), tx, user.ID, "guest", "", b.BuyerName, b.Phone)
			buyerName = strings.TrimSpace(b.BuyerName)
		}
	} else if b.BuyerType == "player" {
		parts := strings.Split(b.BuyerID, ":")
		var playerID int
		if len(parts) == 2 {
			playerID, _ = strconv.Atoi(parts[1])
		}
		if len(parts) != 2 || playerID <= 0 {
			err = errors.New("invalid player")
		} else {
			err = tx.QueryRowContext(r.Context(), `select p.name,coalesce(p.billing_account_id,'') from players p join sessions s on s.id=p.session_id where p.session_id=$1 and p.id=$2 and s.admin_id=$3 and p.active and p.member_id is null for update`, parts[0], playerID, user.ID).Scan(&buyerName, &accountID)
			if err == nil && accountID == "" {
				accountID, err = ensureBillingAccountTx(r.Context(), tx, user.ID, "guest", "", buyerName, "")
			}
			if err == nil {
				_, err = tx.ExecContext(r.Context(), `update players set billing_account_id=$3 where session_id=$1 and id=$2`, parts[0], playerID, accountID)
			}
		}
	} else if b.BuyerType != "anonymous" {
		err = errors.New("invalid buyer")
	}
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "ไม่พบผู้ซื้อหรือข้อมูลผู้ซื้อไม่ถูกต้อง"})
		return
	}
	if accountID != "" && buyerName == "" {
		_ = tx.QueryRowContext(r.Context(), `select display_name from billing_accounts where id=$1`, accountID).Scan(&buyerName)
	}
	saleID := "sale-" + randHex(8)
	total, cost := 0, 0
	items := make([]posSaleItemRecord, 0, len(b.Items))
	for _, requested := range b.Items {
		if requested.Quantity <= 0 || requested.Quantity > 1000 {
			writeJSON(w, 400, map[string]string{"error": "จำนวนสินค้าไม่ถูกต้อง"})
			return
		}
		var p posProductRecord
		err = tx.QueryRowContext(r.Context(), `select id,sku,name,price_thb,cost_thb,stock_quantity from pos_products where id=$1 and admin_id=$2 and active for update`, requested.ProductID, user.ID).Scan(&p.ID, &p.SKU, &p.Name, &p.PriceTHB, &p.CostTHB, &p.StockQuantity)
		if err != nil || p.StockQuantity < requested.Quantity {
			writeJSON(w, http.StatusConflict, map[string]any{"error": "สต็อกสินค้าไม่เพียงพอ", "productId": requested.ProductID, "available": p.StockQuantity})
			return
		}
		line := posSaleItemRecord{ProductID: p.ID, ProductName: p.Name, SKU: p.SKU, Quantity: requested.Quantity, UnitPrice: p.PriceTHB, LineTotal: p.PriceTHB * requested.Quantity}
		total += line.LineTotal
		cost += p.CostTHB * requested.Quantity
		items = append(items, line)
	}
	settings, _ := a.ensurePOSSettings(r.Context(), user.ID)
	if settings.TaxRatePercent > 0 && !settings.PricesIncludeTax {
		total += (total*settings.TaxRatePercent + 50) / 100
	}
	status := "open"
	paymentID := ""
	if b.Action == "pay" && accountID == "" {
		if b.ExpectedTotalTHB > 0 && b.ExpectedTotalTHB != total {
			writeJSON(w, http.StatusConflict, map[string]any{"error": "ยอดชำระเปลี่ยนแปลง กรุณาตรวจสอบยอดล่าสุด", "totalThb": total})
			return
		}
		status, paymentID = "paid", "payment-"+randHex(8)
		_, err = tx.ExecContext(r.Context(), `insert into billing_payments (id,admin_id,amount_thb,method,received_by) values ($1,$2,$3,$4,$5)`, paymentID, user.ID, total, b.Method, user.ID)
		if err == nil {
			_, err = tx.ExecContext(r.Context(), `insert into billing_payment_allocations (payment_id,source_type,source_id,amount_thb) values ($1,'pos',$2,$3)`, paymentID, saleID, total)
		}
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), `insert into pos_sales (id,admin_id,billing_account_id,buyer_name,status,total_thb,cost_thb,payment_id,note,created_by) values ($1,$2,nullif($3,''),$4,$5,$6,$7,nullif($8,''),$9,$10)`, saleID, user.ID, accountID, buyerName, status, total, cost, paymentID, strings.TrimSpace(b.Note), user.ID)
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	for index, item := range items {
		unitCost := b.Items[index].Quantity
		_ = unitCost
		var costTHB int
		_ = tx.QueryRowContext(r.Context(), `select cost_thb from pos_products where id=$1`, item.ProductID).Scan(&costTHB)
		_, err = tx.ExecContext(r.Context(), `insert into pos_sale_items (sale_id,product_id,product_name,sku,quantity,unit_price_thb,unit_cost_thb,line_total_thb) values ($1,$2,$3,$4,$5,$6,$7,$8)`, saleID, item.ProductID, item.ProductName, item.SKU, item.Quantity, item.UnitPrice, costTHB, item.LineTotal)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		var balance int
		err = tx.QueryRowContext(r.Context(), `update pos_products set stock_quantity=stock_quantity-$3,updated_at=now() where id=$1 and admin_id=$2 returning stock_quantity`, item.ProductID, user.ID, item.Quantity).Scan(&balance)
		if err == nil {
			_, err = tx.ExecContext(r.Context(), `insert into pos_stock_movements (admin_id,product_id,sale_id,delta,balance,reason,note,actor_id) values ($1,$2,$3,$4,$5,'sale',$6,$7)`, user.ID, item.ProductID, saleID, -item.Quantity, balance, "ขายสินค้า", user.ID)
		}
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	if b.Action == "pay" && accountID != "" {
		summary, settleErr := a.settleBillingAccount(r.Context(), user, accountID, b.Method, b.ExpectedTotalTHB, true)
		if settleErr != nil {
			writeJSON(w, http.StatusConflict, map[string]any{"error": settleErr.Error(), "saleId": saleID})
			return
		}
		writeJSON(w, 201, map[string]any{"saleId": saleID, "settlement": summary})
		return
	}
	writeJSON(w, 201, map[string]any{"saleId": saleID, "status": status, "totalThb": total})
}

func (a *app) voidPOSSale(w http.ResponseWriter, r *http.Request, user adminUser, saleID string) {
	var b struct {
		Note string `json:"note"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&b)
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	var status string
	err = tx.QueryRowContext(r.Context(), `select status from pos_sales where id=$1 and admin_id=$2 for update`, saleID, user.ID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, 404, map[string]string{"error": "sale not found"})
		return
	}
	if err != nil || status != "open" {
		writeJSON(w, 409, map[string]string{"error": "ยกเลิกได้เฉพาะบิลที่ยังไม่ชำระ"})
		return
	}
	rows, err := tx.QueryContext(r.Context(), `select product_id,quantity from pos_sale_items where sale_id=$1 and product_id is not null for update`, saleID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	type returned struct {
		id       string
		quantity int
	}
	returns := []returned{}
	for rows.Next() {
		var item returned
		_ = rows.Scan(&item.id, &item.quantity)
		returns = append(returns, item)
	}
	rows.Close()
	for _, item := range returns {
		var balance int
		if err = tx.QueryRowContext(r.Context(), `update pos_products set stock_quantity=stock_quantity+$3,updated_at=now() where id=$1 and admin_id=$2 returning stock_quantity`, item.id, user.ID, item.quantity).Scan(&balance); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		_, err = tx.ExecContext(r.Context(), `insert into pos_stock_movements (admin_id,product_id,sale_id,delta,balance,reason,note,actor_id) values ($1,$2,$3,$4,$5,'void',$6,$7)`, user.ID, item.id, saleID, item.quantity, balance, strings.TrimSpace(b.Note), user.ID)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
	}
	_, err = tx.ExecContext(r.Context(), `update pos_sales set status='void',note=case when $3='' then note else $3 end,voided_at=now(),updated_at=now() where id=$1 and admin_id=$2`, saleID, user.ID, strings.TrimSpace(b.Note))
	if err != nil || tx.Commit() != nil {
		writeJSON(w, 500, map[string]string{"error": "ยกเลิกบิลไม่สำเร็จ"})
		return
	}
	a.writePOSOverview(w, r, user.ID)
}

func (a *app) billingAccountIdentity(ctx context.Context, adminID, accountID string) (string, string, string, error) {
	var memberID, name string
	err := a.db.QueryRowContext(ctx, `select coalesce(member_id,''),display_name from billing_accounts where id=$1 and admin_id=$2 and active`, accountID, adminID).Scan(&memberID, &name)
	return accountID, memberID, name, err
}

func (a *app) billingSummaryForAccount(ctx context.Context, adminID, accountID string, includePOS bool) (billingSummary, error) {
	accountID, memberID, name, err := a.billingAccountIdentity(ctx, adminID, accountID)
	if err != nil {
		return billingSummary{}, err
	}
	result := billingSummary{BillingAccountID: accountID, MemberID: memberID, DisplayName: name, POSEnabled: a.features(ctx, adminID).POSEnabled, Lines: []billingLine{}, CalculatedAt: time.Now().UTC()}
	{
		rows, queryErr := a.db.QueryContext(ctx, `select p.session_id,p.id,coalesce(s.name,p.session_id) from players p join sessions s on s.id=p.session_id where s.admin_id=$1 and ((nullif($2,'') is not null and p.member_id=$2) or p.billing_account_id=$3) and p.active and not p.paid order by s.updated_at`, adminID, memberID, accountID)
		if queryErr != nil {
			return result, queryErr
		}
		for rows.Next() {
			var sessionID, sessionName string
			var playerID int
			if err = rows.Scan(&sessionID, &playerID, &sessionName); err != nil {
				rows.Close()
				return result, err
			}
			state, loadErr := a.loadState(ctx, sessionID)
			if loadErr != nil {
				continue
			}
			for _, player := range state.Players {
				if player.ID == playerID && player.Active && !player.Paid {
					amount := playerPaymentSummary(state, player).Total
					result.MatchTotalTHB += amount
					result.Lines = append(result.Lines, billingLine{SourceType: "match", SourceID: fmt.Sprintf("%s:%d", sessionID, playerID), Label: "ค่าแข่งขัน · " + sessionName, AmountTHB: amount})
				}
			}
		}
		rows.Close()
	}
	if includePOS && result.POSEnabled {
		rows, queryErr := a.db.QueryContext(ctx, `select id,total_thb from pos_sales where admin_id=$1 and billing_account_id=$2 and status='open' order by created_at`, adminID, accountID)
		if queryErr != nil {
			return result, queryErr
		}
		for rows.Next() {
			var id string
			var amount int
			if err = rows.Scan(&id, &amount); err != nil {
				rows.Close()
				return result, err
			}
			result.POSTotalTHB += amount
			result.Lines = append(result.Lines, billingLine{SourceType: "pos", SourceID: id, Label: "สินค้า · " + id, AmountTHB: amount})
		}
		rows.Close()
	}
	result.TotalTHB = result.MatchTotalTHB + result.POSTotalTHB
	if result.TotalTHB > 0 && includePOS && result.POSEnabled {
		settings, _ := a.ensurePOSSettings(ctx, adminID)
		result.ReceiverName = settings.PromptPayReceiverName
		result.PromptPayPayload, _ = promptPayPayload(promptPaySettings{ID: settings.PromptPayID, Type: settings.PromptPayType, ReceiverName: settings.PromptPayReceiverName}, result.TotalTHB)
	}
	return result, nil
}

func (a *app) writePOSBillingSummary(w http.ResponseWriter, r *http.Request, user adminUser) {
	accountID := strings.TrimSpace(r.URL.Query().Get("accountId"))
	if accountID == "" {
		memberID := strings.TrimSpace(r.URL.Query().Get("memberId"))
		playerRef := strings.TrimSpace(r.URL.Query().Get("playerRef"))
		tx, err := a.db.BeginTx(r.Context(), nil)
		if err == nil {
			if memberID != "" {
				accountID, err = ensureBillingAccountTx(r.Context(), tx, user.ID, "member", memberID, "", "")
			} else {
				parts := strings.Split(playerRef, ":")
				playerID := 0
				if len(parts) == 2 {
					playerID, _ = strconv.Atoi(parts[1])
				}
				var name string
				if len(parts) != 2 || playerID <= 0 {
					err = errors.New("invalid player")
				} else {
					err = tx.QueryRowContext(r.Context(), `select p.name,coalesce(p.billing_account_id,'') from players p join sessions s on s.id=p.session_id where p.session_id=$1 and p.id=$2 and s.admin_id=$3 and p.active for update`, parts[0], playerID, user.ID).Scan(&name, &accountID)
				}
				if err == nil && accountID == "" {
					accountID, err = ensureBillingAccountTx(r.Context(), tx, user.ID, "guest", "", name, "")
				}
				if err == nil {
					_, err = tx.ExecContext(r.Context(), `update players set billing_account_id=$3 where session_id=$1 and id=$2`, parts[0], playerID, accountID)
				}
			}
			if err == nil {
				err = tx.Commit()
			}
		}
		if err != nil {
			writeJSON(w, 404, map[string]string{"error": "billing account not found"})
			return
		}
	}
	summary, err := a.billingSummaryForAccount(r.Context(), user.ID, accountID, true)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "billing account not found"})
		return
	}
	writeJSON(w, 200, summary)
}

func (a *app) settleBillingAccount(ctx context.Context, user adminUser, accountID, method string, expectedTotal int, includePOS bool) (billingSummary, error) {
	if !validPaymentMethod(method) {
		return billingSummary{}, errors.New("invalid payment method")
	}
	summary, err := a.billingSummaryForAccount(ctx, user.ID, accountID, includePOS)
	if err != nil {
		return summary, err
	}
	if summary.TotalTHB <= 0 {
		return summary, errors.New("ไม่มียอดค้างชำระ")
	}
	if expectedTotal > 0 && expectedTotal != summary.TotalTHB {
		return summary, errors.New("ยอดชำระเปลี่ยนแปลง กรุณาตรวจสอบยอดล่าสุด")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return summary, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended($1,0))`, user.ID+":"+accountID); err != nil {
		return summary, err
	}
	for _, line := range summary.Lines {
		if line.SourceType == "pos" {
			var status string
			if err = tx.QueryRowContext(ctx, `select status from pos_sales where id=$1 and admin_id=$2 for update`, line.SourceID, user.ID).Scan(&status); err != nil || status != "open" {
				return summary, errors.New("ยอด POS เปลี่ยนแปลง กรุณาลองใหม่")
			}
		} else {
			parts := strings.Split(line.SourceID, ":")
			if len(parts) != 2 {
				return summary, errors.New("invalid match reference")
			}
			playerID, _ := strconv.Atoi(parts[1])
			var paid bool
			if err = tx.QueryRowContext(ctx, `select paid from players where session_id=$1 and id=$2 for update`, parts[0], playerID).Scan(&paid); err != nil || paid {
				return summary, errors.New("ยอด Match เปลี่ยนแปลง กรุณาลองใหม่")
			}
		}
	}
	paymentID := "payment-" + randHex(8)
	_, err = tx.ExecContext(ctx, `insert into billing_payments (id,admin_id,billing_account_id,amount_thb,method,received_by) values ($1,$2,$3,$4,$5,$6)`, paymentID, user.ID, accountID, summary.TotalTHB, method, user.ID)
	if err != nil {
		return summary, err
	}
	for _, line := range summary.Lines {
		_, err = tx.ExecContext(ctx, `insert into billing_payment_allocations (payment_id,source_type,source_id,amount_thb) values ($1,$2,$3,$4)`, paymentID, line.SourceType, line.SourceID, line.AmountTHB)
		if err != nil {
			return summary, err
		}
		if line.SourceType == "pos" {
			_, err = tx.ExecContext(ctx, `update pos_sales set status='paid',payment_id=$2,updated_at=now() where id=$1 and status='open'`, line.SourceID, paymentID)
		} else {
			parts := strings.Split(line.SourceID, ":")
			playerID, _ := strconv.Atoi(parts[1])
			_, err = tx.ExecContext(ctx, `update players set paid=true,coupon=false where session_id=$1 and id=$2 and not paid`, parts[0], playerID)
			if err == nil {
				_, err = tx.ExecContext(ctx, `delete from couples where session_id=$1 and (player_a=$2 or player_b=$2)`, parts[0], playerID)
			}
			if err == nil {
				_, err = tx.ExecContext(ctx, `insert into player_payment_events (session_id,player_id,member_id,paid,amount_thb,amount_satang,actor_id) select $1,$2,p.member_id,true,$3,$3::bigint*100,$4 from players p where p.session_id=$1 and p.id=$2`, parts[0], playerID, line.AmountTHB, user.ID)
			}
		}
		if err != nil {
			return summary, err
		}
	}
	if err = tx.Commit(); err != nil {
		return summary, err
	}
	a.insertActivityLog(ctx, "admin", user.ID, "settle_combined_bill", "billing_payment", paymentID, map[string]any{"amountThb": summary.TotalTHB, "method": method, "matchThb": summary.MatchTotalTHB, "posThb": summary.POSTotalTHB})
	return summary, nil
}

func (a *app) handlePOSSettlement(w http.ResponseWriter, r *http.Request, user adminUser) {
	var b struct {
		BillingAccountID string `json:"billingAccountId"`
		Method           string `json:"method"`
		ExpectedTotal    int    `json:"expectedTotalThb"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid settlement"})
		return
	}
	summary, err := a.settleBillingAccount(r.Context(), user, strings.TrimSpace(b.BillingAccountID), strings.TrimSpace(b.Method), b.ExpectedTotal, true)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error(), "summary": summary})
		return
	}
	writeJSON(w, 200, map[string]any{"status": "paid", "summary": summary})
}

func (a *app) writePOSQR(w http.ResponseWriter, r *http.Request, adminID string) {
	amount, _ := strconv.Atoi(r.URL.Query().Get("amount"))
	if amount <= 0 {
		writeJSON(w, 400, map[string]string{"error": "invalid amount"})
		return
	}
	settings, err := a.ensurePOSSettings(r.Context(), adminID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	payload, err := promptPayPayload(promptPaySettings{ID: settings.PromptPayID, Type: settings.PromptPayType, ReceiverName: settings.PromptPayReceiverName}, amount)
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": "ยังไม่ได้ตั้งค่า PromptPay สำหรับ POS"})
		return
	}
	writeJSON(w, 200, map[string]any{"promptPayPayload": payload, "receiverName": settings.PromptPayReceiverName, "amountThb": amount})
}

func (a *app) writeCombinedPlayerPaymentSummary(w http.ResponseWriter, r *http.Request, state SessionState, player Player) {
	base := playerPaymentSummary(state, player)
	var adminID string
	if err := a.db.QueryRowContext(r.Context(), `select coalesce(admin_id,'') from sessions where id=$1`, state.Session.ID).Scan(&adminID); err != nil || adminID == "" {
		writeJSON(w, http.StatusOK, base)
		return
	}
	features := a.features(r.Context(), adminID)
	if !features.POSEnabled {
		writeJSON(w, http.StatusOK, base)
		return
	}
	var accountID string
	_ = a.db.QueryRowContext(r.Context(), `select coalesce(billing_account_id,'') from players where session_id=$1 and id=$2`, state.Session.ID, player.ID).Scan(&accountID)
	if accountID == "" && player.MemberID == "" {
		writeJSON(w, http.StatusOK, base)
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusOK, base)
		return
	}
	if accountID == "" {
		accountID, err = ensureBillingAccountTx(r.Context(), tx, adminID, "member", player.MemberID, "", "")
	}
	if err == nil {
		err = tx.Commit()
	} else {
		_ = tx.Rollback()
	}
	if err != nil {
		writeJSON(w, http.StatusOK, base)
		return
	}
	summary, err := a.billingSummaryForAccount(r.Context(), adminID, accountID, true)
	if err != nil {
		writeJSON(w, http.StatusOK, base)
		return
	}
	items := make([]PlayerPaymentItem, 0, len(summary.Lines))
	for index, line := range summary.Lines {
		items = append(items, paymentItem(fmt.Sprintf("%s-%d", line.SourceType, index), line.Label, "", 1, int64(line.AmountTHB)*100, int64(line.AmountTHB)*100))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"playerId": player.ID, "playerName": player.Name, "sessionType": state.Session.Type,
		"paid": player.Paid, "items": items, "totalThb": summary.TotalTHB, "matchTotalThb": summary.MatchTotalTHB,
		"posTotalThb": summary.POSTotalTHB, "billingAccountId": accountID, "posEnabled": true,
		"promptPayPayload": summary.PromptPayPayload, "receiverName": summary.ReceiverName, "calculatedAt": summary.CalculatedAt,
	})
}

func (a *app) settlePlayerCombinedBill(w http.ResponseWriter, r *http.Request, state SessionState, player Player) {
	user, ok := a.currentAdmin(r.Context(), r)
	if !ok {
		writeAuthFailure(w, r, adminSessionKind)
		return
	}
	var b struct {
		Method        string `json:"method"`
		ExpectedTotal int    `json:"expectedTotalThb"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&b) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid settlement"})
		return
	}
	if !a.features(r.Context(), user.ID).POSEnabled {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "POS combined payment is unavailable"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	var accountID string
	_ = tx.QueryRowContext(r.Context(), `select coalesce(billing_account_id,'') from players where session_id=$1 and id=$2`, state.Session.ID, player.ID).Scan(&accountID)
	if accountID == "" && player.MemberID != "" {
		accountID, err = ensureBillingAccountTx(r.Context(), tx, user.ID, "member", player.MemberID, "", "")
	} else if accountID == "" {
		err = errors.New("billing account is unavailable")
	}
	if err == nil {
		err = tx.Commit()
	} else {
		_ = tx.Rollback()
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	summary, err := a.settleBillingAccount(r.Context(), user, accountID, strings.TrimSpace(b.Method), b.ExpectedTotal, true)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error(), "summary": summary})
		return
	}
	nextState, err := a.loadState(r.Context(), state.Session.ID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	nextState.Session.Unlocked = true
	writeJSON(w, http.StatusOK, map[string]any{"state": nextState, "summary": summary})
}
