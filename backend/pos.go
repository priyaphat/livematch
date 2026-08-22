package main

import (
	"context"
	"database/sql"
	"encoding/base64"
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
	PromptPayType           string `json:"promptPayType"`
	PromptPayID             string `json:"promptPayId"`
	PromptPayReceiverName   string `json:"promptPayReceiverName"`
	ReceiptHeader           string `json:"receiptHeader"`
	ReceiptFooter           string `json:"receiptFooter"`
	LogoData                string `json:"logoData,omitempty"`
	DefaultLowStock         int    `json:"defaultLowStock"`
	Theme                   string `json:"theme"`
	Language                string `json:"language"`
	TaxRatePercent          int    `json:"taxRatePercent"`
	PricesIncludeTax        bool   `json:"pricesIncludeTax"`
	InheritBookingPromptPay bool   `json:"inheritBookingPromptPay"`
	PaymentQRImage          string `json:"paymentQrImage,omitempty"`
}

type posProductRecord struct {
	ID                string `json:"id"`
	SKU               string `json:"sku"`
	Category          string `json:"category"`
	Name              string `json:"name"`
	PriceTHB          int    `json:"priceThb"`
	PriceSatang       int64  `json:"priceSatang"`
	CostTHB           int    `json:"costThb"`
	CostSatang        int64  `json:"costSatang"`
	StockQuantity     int    `json:"stockQuantity"`
	LowStockThreshold int    `json:"lowStockThreshold"`
	Active            bool   `json:"active"`
	LowStock          bool   `json:"lowStock"`
	Unit              string `json:"unit"`
	ImageData         string `json:"imageData,omitempty"`
	Barcode           string `json:"barcode,omitempty"`
	Description       string `json:"description,omitempty"`
}

type posProductPage struct {
	Items      []posProductRecord `json:"items"`
	Page       int                `json:"page"`
	PageSize   int                `json:"pageSize"`
	Total      int                `json:"total"`
	TotalPages int                `json:"totalPages"`
}

type posCatalogRecord struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Active    bool   `json:"active"`
	UsedCount int    `json:"usedCount"`
	Icon      string `json:"icon,omitempty"`
	Color     string `json:"color,omitempty"`
}

type posStockBatchItemRecord struct {
	ID                      int64  `json:"id"`
	ProductID               string `json:"productId"`
	ProductName             string `json:"productName"`
	ProductSKU              string `json:"productSku"`
	Delta                   int    `json:"delta"`
	Balance                 int    `json:"balance"`
	UnitCostTHB             int    `json:"unitCostThb"`
	TotalCostTHB            int    `json:"totalCostThb"`
	PreviousCostTHB         int    `json:"previousCostThb"`
	ResultingCostTHB        int    `json:"resultingCostThb"`
	UnitCostSatang          int64  `json:"unitCostSatang"`
	GrossTotalSatang        int64  `json:"grossTotalSatang"`
	AllocatedDiscountSatang int64  `json:"allocatedDiscountSatang"`
	NetTotalSatang          int64  `json:"netTotalSatang"`
	PreviousCostSatang      int64  `json:"previousCostSatang"`
	ResultingCostSatang     int64  `json:"resultingCostSatang"`
}

type posStockBatchRecord struct {
	ID               string                    `json:"id"`
	Name             string                    `json:"name"`
	Mode             string                    `json:"mode"`
	Note             string                    `json:"note,omitempty"`
	TotalCostTHB     int                       `json:"totalCostThb"`
	SupplierID       string                    `json:"supplierId,omitempty"`
	SupplierName     string                    `json:"supplierName,omitempty"`
	DiscountType     string                    `json:"discountType"`
	DiscountRateBPS  int                       `json:"discountRateBps"`
	GrossTotalSatang int64                     `json:"grossTotalSatang"`
	DiscountSatang   int64                     `json:"discountSatang"`
	NetTotalSatang   int64                     `json:"netTotalSatang"`
	TotalCostSatang  int64                     `json:"totalCostSatang"`
	CreatedAt        string                    `json:"createdAt"`
	ActorID          string                    `json:"actorId"`
	ActorType        string                    `json:"actorType"`
	ActorName        string                    `json:"actorName"`
	Items            []posStockBatchItemRecord `json:"items"`
}

type posSupplierRecord struct {
	ID            string `json:"id"`
	Code          string `json:"code"`
	Name          string `json:"name"`
	ContactPerson string `json:"contactPerson"`
	Phone         string `json:"phone"`
	Email         string `json:"email"`
	Address       string `json:"address"`
	Active        bool   `json:"active"`
	ProductsCount int    `json:"productsCount"`
}

type posSaleItemRecord struct {
	ProductID       string `json:"productId"`
	ProductName     string `json:"productName"`
	SKU             string `json:"sku"`
	Quantity        int    `json:"quantity"`
	UnitPrice       int    `json:"unitPriceThb"`
	UnitCostSatang  int64  `json:"unitCostSatang"`
	LineTotal       int    `json:"lineTotalThb"`
	UnitPriceSatang int64  `json:"unitPriceSatang"`
	LineTotalSatang int64  `json:"lineTotalSatang"`
	Note            string `json:"note,omitempty"`
}

type posSaleRecord struct {
	ID                 string              `json:"id"`
	BillingAccountID   string              `json:"billingAccountId,omitempty"`
	BuyerName          string              `json:"buyerName"`
	Status             string              `json:"status"`
	TotalTHB           int                 `json:"totalThb"`
	CostTHB            int                 `json:"costThb"`
	CostSatang         int64               `json:"costSatang"`
	PaymentID          string              `json:"paymentId,omitempty"`
	Note               string              `json:"note,omitempty"`
	CreatedAt          string              `json:"createdAt"`
	CreatedBy          string              `json:"createdBy"`
	CreatedByType      string              `json:"createdByType"`
	CreatedByName      string              `json:"createdByName"`
	Items              []posSaleItemRecord `json:"items"`
	SubtotalSatang     int64               `json:"subtotalSatang"`
	DiscountType       string              `json:"discountType"`
	DiscountRateBPS    int                 `json:"discountRateBps"`
	DiscountSatang     int64               `json:"discountSatang"`
	NetBeforeVATSatang int64               `json:"netBeforeVatSatang"`
	VATRateBPS         int                 `json:"vatRateBps"`
	VATSatang          int64               `json:"vatSatang"`
	PricesIncludeTax   bool                `json:"pricesIncludeTax"`
	TotalSatang        int64               `json:"totalSatang"`
	PaymentMethod      string              `json:"paymentMethod,omitempty"`
	CashReceivedSatang int64               `json:"cashReceivedSatang,omitempty"`
	ChangeSatang       int64               `json:"changeSatang,omitempty"`
	ReferenceNumber    string              `json:"referenceNumber,omitempty"`
}

type billingLine struct {
	SourceType   string          `json:"sourceType"`
	SourceID     string          `json:"sourceId"`
	Label        string          `json:"label"`
	AmountTHB    int             `json:"amountThb"`
	AmountSatang int64           `json:"amountSatang"`
	Snapshot     json.RawMessage `json:"snapshot,omitempty"`
}

type billingSummary struct {
	BillingAccountID string        `json:"billingAccountId,omitempty"`
	MemberID         string        `json:"memberId,omitempty"`
	DisplayName      string        `json:"displayName"`
	MatchTotalTHB    int           `json:"matchTotalThb"`
	POSTotalTHB      int           `json:"posTotalThb"`
	TotalTHB         int           `json:"totalThb"`
	MatchTotalSatang int64         `json:"matchTotalSatang"`
	POSTotalSatang   int64         `json:"posTotalSatang"`
	TotalSatang      int64         `json:"totalSatang"`
	POSEnabled       bool          `json:"posEnabled"`
	PromptPayPayload string        `json:"promptPayPayload,omitempty"`
	ReceiverName     string        `json:"receiverName,omitempty"`
	Lines            []billingLine `json:"lines"`
	CalculatedAt     time.Time     `json:"calculatedAt"`
}

type billingReceivable struct {
	BillingAccountID string        `json:"billingAccountId"`
	MemberID         string        `json:"memberId"`
	DisplayName      string        `json:"displayName"`
	Phone            string        `json:"phone,omitempty"`
	MatchTotalSatang int64         `json:"matchTotalSatang"`
	POSTotalSatang   int64         `json:"posTotalSatang"`
	TotalSatang      int64         `json:"totalSatang"`
	LineCount        int           `json:"lineCount"`
	Lines            []billingLine `json:"lines"`
	CalculatedAt     time.Time     `json:"calculatedAt"`
}

type billingPaymentHistory struct {
	PaymentID          string        `json:"paymentId"`
	BillingAccountID   string        `json:"billingAccountId,omitempty"`
	MemberID           string        `json:"memberId,omitempty"`
	DisplayName        string        `json:"displayName"`
	OriginSystem       string        `json:"originSystem"`
	Method             string        `json:"method"`
	AmountSatang       int64         `json:"amountSatang"`
	MatchTotalSatang   int64         `json:"matchTotalSatang"`
	POSTotalSatang     int64         `json:"posTotalSatang"`
	CashReceivedSatang int64         `json:"cashReceivedSatang,omitempty"`
	ChangeSatang       int64         `json:"changeSatang,omitempty"`
	ReferenceNumber    string        `json:"referenceNumber,omitempty"`
	ReceivedByType     string        `json:"receivedByType"`
	ReceivedByName     string        `json:"receivedByName"`
	CreatedAt          string        `json:"createdAt"`
	Lines              []billingLine `json:"lines"`
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
	err := a.db.QueryRowContext(ctx, `select promptpay_type,promptpay_id,promptpay_receiver_name,receipt_header,receipt_footer,logo_data,default_low_stock,theme,language,tax_rate_percent,prices_include_tax,inherit_booking_promptpay,payment_qr_image from pos_settings where admin_id=$1`, adminID).Scan(
		&s.PromptPayType, &s.PromptPayID, &s.PromptPayReceiverName, &s.ReceiptHeader, &s.ReceiptFooter, &s.LogoData, &s.DefaultLowStock, &s.Theme, &s.Language, &s.TaxRatePercent, &s.PricesIncludeTax, &s.InheritBookingPromptPay, &s.PaymentQRImage,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return a.ensurePOSSettings(ctx, adminID)
	}
	return s, err
}

func (a *app) effectivePOSPromptPay(ctx context.Context, adminID string, settings posSettingsRecord) (promptPaySettings, string) {
	if !settings.InheritBookingPromptPay {
		return promptPaySettings{ID: settings.PromptPayID, Type: settings.PromptPayType, ReceiverName: settings.PromptPayReceiverName}, "pos"
	}
	var inherited promptPaySettings
	if a.db.QueryRowContext(ctx, `select promptpay_type,promptpay_id,promptpay_receiver_name from booking_settings where admin_id=$1`, adminID).Scan(&inherited.Type, &inherited.ID, &inherited.ReceiverName) == nil && inherited.ID != "" {
		return inherited, "booking"
	}
	return promptPaySettings{ID: settings.PromptPayID, Type: settings.PromptPayType, ReceiverName: settings.PromptPayReceiverName}, "pos"
}

func (a *app) handleAdminPOS(w http.ResponseWriter, r *http.Request, user adminUser, action string) {
	path := strings.Trim(strings.TrimPrefix(action, "pos"), "/")
	if !a.requireFeature(w, r, user.ID, "pos") {
		return
	}
	if !authorizePOSPath(w, user, r.Method, path) {
		return
	}
	switch {
	case r.Method == http.MethodGet && path == "access":
		a.writePOSAccessSettings(w, r, user)
	case r.Method == http.MethodPost && path == "staff":
		a.createPOSStaff(w, r, user)
	case r.Method == http.MethodPatch && strings.HasPrefix(path, "staff/") && !strings.HasSuffix(path, "/reset-pin"):
		a.updatePOSStaff(w, r, user, strings.TrimPrefix(path, "staff/"))
	case r.Method == http.MethodPost && strings.HasPrefix(path, "staff/") && strings.HasSuffix(path, "/reset-pin"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "staff/"), "/reset-pin")
		a.resetPOSStaffPIN(w, r, user, id)
	case r.Method == http.MethodPut && path == "permissions":
		a.savePOSPermissions(w, r, user)
	case r.Method == http.MethodGet && (path == "" || path == "overview"):
		a.writePOSOverview(w, r, user.ID)
	case r.Method == http.MethodGet && path == "products":
		a.writePOSProducts(w, r, user.ID)
	case r.Method == http.MethodGet && path == "categories":
		items, err := a.listPOSCategories(r.Context(), user.ID)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"items": items})
	case r.Method == http.MethodGet && path == "units":
		items, err := a.listPOSUnits(r.Context(), user.ID)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"items": items})
	case r.Method == http.MethodGet && path == "suppliers":
		a.writePOSSuppliers(w, r, user.ID)
	case r.Method == http.MethodPost && path == "suppliers":
		a.createPOSSupplier(w, r, user)
	case r.Method == http.MethodPatch && strings.HasPrefix(path, "suppliers/"):
		a.patchPOSSupplier(w, r, user, strings.TrimPrefix(path, "suppliers/"))
	case r.Method == http.MethodDelete && strings.HasPrefix(path, "suppliers/"):
		a.deletePOSSupplier(w, r, user, strings.TrimPrefix(path, "suppliers/"))
	case r.Method == http.MethodGet && path == "stock/summary":
		a.writePOSStockSummary(w, r, user.ID)
	case r.Method == http.MethodGet && path == "stock/batches":
		a.writePOSStockBatches(w, r, user.ID)
	case r.Method == http.MethodGet && path == "stock/movements":
		a.writePOSStockMovements(w, r, user.ID)
	case r.Method == http.MethodGet && path == "qr":
		a.writePOSQR(w, r, user.ID)
	case r.Method == http.MethodGet && path == "settings":
		settings, err := a.ensurePOSSettings(r.Context(), user.ID)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, settings)
	case r.Method == http.MethodGet && path == "members":
		a.writePOSMembers(w, r, user.ID)
	case r.Method == http.MethodGet && path == "sales":
		a.writePOSSales(w, r, user.ID)
	case r.Method == http.MethodGet && path == "receivables":
		a.writePOSReceivables(w, r, user.ID)
	case r.Method == http.MethodGet && path == "payment-history":
		a.writePOSPaymentHistory(w, r, user.ID)
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
	case r.Method == http.MethodDelete && strings.HasPrefix(path, "products/"):
		a.deletePOSProduct(w, r, user, strings.TrimPrefix(path, "products/"))
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
	rows, err := a.db.QueryContext(ctx, `select id,sku,category,name,price_thb,price_satang,cost_thb,cost_satang,stock_quantity,low_stock_threshold,active,unit,image_data,barcode,description from pos_products where admin_id=$1 and deleted_at is null order by active desc,category,name`, adminID)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	for rows.Next() {
		var p posProductRecord
		if err = rows.Scan(&p.ID, &p.SKU, &p.Category, &p.Name, &p.PriceTHB, &p.PriceSatang, &p.CostTHB, &p.CostSatang, &p.StockQuantity, &p.LowStockThreshold, &p.Active, &p.Unit, &p.ImageData, &p.Barcode, &p.Description); err != nil {
			return items, err
		}
		p.LowStock = p.StockQuantity <= p.LowStockThreshold
		items = append(items, p)
	}
	return items, rows.Err()
}

func (a *app) writePOSProducts(w http.ResponseWriter, r *http.Request, adminID string) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	if page < 1 {
		page = 1
	}
	if pageSize < 5 || pageSize > 100 {
		pageSize = 20
	}
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	category := strings.TrimSpace(r.URL.Query().Get("category"))
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "active" && status != "inactive" {
		status = "all"
	}

	var total int
	filter := `admin_id=$1 and deleted_at is null
		and ($2='' or name ilike '%%'||$2||'%%' or sku ilike '%%'||$2||'%%' or barcode ilike '%%'||$2||'%%')
		and ($3='' or lower(category)=lower($3))
		and ($4='all' or active=($4='active'))`
	if err := a.db.QueryRowContext(r.Context(), `select count(*) from pos_products where `+filter, adminID, search, category, status).Scan(&total); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	items := []posProductRecord{}
	rows, err := a.db.QueryContext(r.Context(), `select id,sku,category,name,price_thb,price_satang,cost_thb,cost_satang,stock_quantity,low_stock_threshold,active,unit,image_data,barcode,description from pos_products where `+filter+` order by active desc,lower(name),id limit $5 offset $6`, adminID, search, category, status, pageSize, (page-1)*pageSize)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var p posProductRecord
		if err = rows.Scan(&p.ID, &p.SKU, &p.Category, &p.Name, &p.PriceTHB, &p.PriceSatang, &p.CostTHB, &p.CostSatang, &p.StockQuantity, &p.LowStockThreshold, &p.Active, &p.Unit, &p.ImageData, &p.Barcode, &p.Description); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		p.LowStock = p.StockQuantity <= p.LowStockThreshold
		items = append(items, p)
	}
	totalPages := (total + pageSize - 1) / pageSize
	if totalPages == 0 {
		totalPages = 1
	}
	writeJSON(w, 200, posProductPage{Items: items, Page: page, PageSize: pageSize, Total: total, TotalPages: totalPages})
}

func (a *app) listPOSSales(ctx context.Context, adminID, status string, limit, offset int) ([]posSaleRecord, error) {
	if limit < 1 || limit > 200 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	items := []posSaleRecord{}
	rows, err := a.db.QueryContext(ctx, `select s.id,coalesce(s.billing_account_id,''),s.buyer_name,s.status,s.total_thb,s.cost_thb,s.cost_satang,coalesce(s.payment_id,''),s.note,to_char(s.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),s.created_by,s.created_by_type,s.created_by_name,s.subtotal_satang,s.discount_type,s.discount_rate_bps,s.discount_satang,s.net_before_vat_satang,s.vat_rate_bps,s.vat_satang,s.prices_include_tax,s.total_satang,coalesce(bp.method,''),coalesce(bp.cash_received_satang,0),coalesce(bp.change_satang,0),coalesce(bp.reference_number,'') from pos_sales s left join billing_payments bp on bp.id=s.payment_id where s.admin_id=$1 and ($2='' or $2='all' or s.status=$2) order by s.created_at desc limit $3 offset $4`, adminID, status, limit, offset)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	byID := map[string]int{}
	for rows.Next() {
		var sale posSaleRecord
		sale.Items = []posSaleItemRecord{}
		if err = rows.Scan(&sale.ID, &sale.BillingAccountID, &sale.BuyerName, &sale.Status, &sale.TotalTHB, &sale.CostTHB, &sale.CostSatang, &sale.PaymentID, &sale.Note, &sale.CreatedAt, &sale.CreatedBy, &sale.CreatedByType, &sale.CreatedByName, &sale.SubtotalSatang, &sale.DiscountType, &sale.DiscountRateBPS, &sale.DiscountSatang, &sale.NetBeforeVATSatang, &sale.VATRateBPS, &sale.VATSatang, &sale.PricesIncludeTax, &sale.TotalSatang, &sale.PaymentMethod, &sale.CashReceivedSatang, &sale.ChangeSatang, &sale.ReferenceNumber); err != nil {
			return items, err
		}
		items = append(items, sale)
		byID[sale.ID] = len(items) - 1
	}
	if err = rows.Err(); err != nil || len(items) == 0 {
		return items, err
	}
	ids := make([]string, 0, len(items))
	for _, sale := range items {
		ids = append(ids, sale.ID)
	}
	itemRows, err := a.db.QueryContext(ctx, `select sale_id,coalesce(product_id,''),product_name,sku,quantity,unit_price_thb,unit_cost_satang,line_total_thb,unit_price_satang,line_total_satang,note from pos_sale_items where sale_id=any($1) order by id`, ids)
	if err != nil {
		return items, err
	}
	defer itemRows.Close()
	for itemRows.Next() {
		var saleID string
		var item posSaleItemRecord
		if err = itemRows.Scan(&saleID, &item.ProductID, &item.ProductName, &item.SKU, &item.Quantity, &item.UnitPrice, &item.UnitCostSatang, &item.LineTotal, &item.UnitPriceSatang, &item.LineTotalSatang, &item.Note); err != nil {
			return items, err
		}
		if index, ok := byID[saleID]; ok {
			items[index].Items = append(items[index].Items, item)
		}
	}
	return items, itemRows.Err()
}

func (a *app) writePOSSales(w http.ResponseWriter, r *http.Request, adminID string) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 200 {
		pageSize = 50
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	items, err := a.listPOSSales(r.Context(), adminID, status, pageSize, (page-1)*pageSize)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	var total int
	if err = a.db.QueryRowContext(r.Context(), `select count(*) from pos_sales where admin_id=$1 and ($2='' or $2='all' or status=$2)`, adminID, status).Scan(&total); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	totalPages := (total + pageSize - 1) / pageSize
	if totalPages == 0 {
		totalPages = 1
	}
	writeJSON(w, 200, map[string]any{"items": items, "page": page, "pageSize": pageSize, "total": total, "totalPages": totalPages})
}

func (a *app) writePOSMembers(w http.ResponseWriter, r *http.Request, adminID string) {
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	rows, err := a.db.QueryContext(r.Context(), `select m.id,m.name,m.phone,coalesce(ba.id,'') from members m left join billing_accounts ba on ba.admin_id=m.admin_id and ba.member_id=m.id where m.admin_id=$1 and m.active and m.deleted_at is null and ($2='' or m.name ilike '%%'||$2||'%%' or m.phone ilike '%%'||$2||'%%') order by lower(m.name),m.id limit 100`, adminID, search)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, name, phone, accountID string
		if err = rows.Scan(&id, &name, &phone, &accountID); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		items = append(items, map[string]any{"id": id, "name": name, "phone": displayPhone(phone), "billingAccountId": accountID})
	}
	writeJSON(w, 200, map[string]any{"items": items})
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
	rows, err := a.db.QueryContext(ctx, `select m.id,m.product_id,p.name,p.sku,m.delta,m.balance,m.reason,m.note,coalesce(m.sale_id,''),coalesce(m.batch_id,''),coalesce(b.name,''),coalesce(b.supplier_name,''),m.unit_cost_satang,m.gross_total_satang,m.allocated_discount_satang,m.net_total_satang,m.previous_cost_satang,m.resulting_cost_satang,to_char(m.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),m.actor_id,m.actor_type,m.actor_name from pos_stock_movements m join pos_products p on p.id=m.product_id left join pos_stock_batches b on b.id=m.batch_id where m.admin_id=$1 order by m.created_at desc,m.id desc limit $2`, adminID, limit)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var productID, productName, sku, reason, note, saleID, batchID, referenceNo, supplierName, createdAt, actorID, actorType, actorName string
		var delta, balance int
		var unitCostSatang, grossTotalSatang, allocatedDiscountSatang, netTotalSatang, previousCostSatang, resultingCostSatang int64
		if err = rows.Scan(&id, &productID, &productName, &sku, &delta, &balance, &reason, &note, &saleID, &batchID, &referenceNo, &supplierName, &unitCostSatang, &grossTotalSatang, &allocatedDiscountSatang, &netTotalSatang, &previousCostSatang, &resultingCostSatang, &createdAt, &actorID, &actorType, &actorName); err != nil {
			return items, err
		}
		movementType := "adjust"
		if reason == "restock" {
			movementType = "in"
		} else if reason == "sale" || delta < 0 {
			movementType = "out"
		}
		items = append(items, map[string]any{"id": id, "referenceNo": referenceNo, "batchId": batchID, "productId": productID, "productName": productName, "productSku": sku, "type": movementType, "quantity": delta, "beforeStock": balance - delta, "afterStock": balance, "delta": delta, "balance": balance, "reason": reason, "note": note, "supplierName": supplierName, "saleId": saleID, "unitCostSatang": unitCostSatang, "grossTotalSatang": grossTotalSatang, "allocatedDiscountSatang": allocatedDiscountSatang, "netTotalSatang": netTotalSatang, "previousCostSatang": previousCostSatang, "resultingCostSatang": resultingCostSatang, "createdAt": createdAt, "actorId": actorID, "actorType": actorType, "actorName": actorName})
	}
	return items, rows.Err()
}

func (a *app) listPOSStockBatches(ctx context.Context, adminID string, limit int) ([]posStockBatchRecord, error) {
	if limit < 1 || limit > 200 {
		limit = 100
	}
	items := []posStockBatchRecord{}
	rows, err := a.db.QueryContext(ctx, `select id,name,mode,note,total_cost_thb,coalesce(supplier_id,''),supplier_name,discount_type,discount_rate_bps,gross_total_satang,discount_satang,net_total_satang,total_cost_satang,to_char(created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),actor_id,actor_type,actor_name from pos_stock_batches where admin_id=$1 order by created_at desc,id desc limit $2`, adminID, limit)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	for rows.Next() {
		var item posStockBatchRecord
		if err = rows.Scan(&item.ID, &item.Name, &item.Mode, &item.Note, &item.TotalCostTHB, &item.SupplierID, &item.SupplierName, &item.DiscountType, &item.DiscountRateBPS, &item.GrossTotalSatang, &item.DiscountSatang, &item.NetTotalSatang, &item.TotalCostSatang, &item.CreatedAt, &item.ActorID, &item.ActorType, &item.ActorName); err != nil {
			return items, err
		}
		item.Items = []posStockBatchItemRecord{}
		movementRows, queryErr := a.db.QueryContext(ctx, `select m.id,m.product_id,p.name,p.sku,m.delta,m.balance,m.unit_cost_thb,m.total_cost_thb,m.previous_cost_thb,m.resulting_cost_thb,m.unit_cost_satang,m.gross_total_satang,m.allocated_discount_satang,m.net_total_satang,m.previous_cost_satang,m.resulting_cost_satang from pos_stock_movements m join pos_products p on p.id=m.product_id where m.batch_id=$1 order by m.id`, item.ID)
		if queryErr != nil {
			return items, queryErr
		}
		for movementRows.Next() {
			var movement posStockBatchItemRecord
			if queryErr = movementRows.Scan(&movement.ID, &movement.ProductID, &movement.ProductName, &movement.ProductSKU, &movement.Delta, &movement.Balance, &movement.UnitCostTHB, &movement.TotalCostTHB, &movement.PreviousCostTHB, &movement.ResultingCostTHB, &movement.UnitCostSatang, &movement.GrossTotalSatang, &movement.AllocatedDiscountSatang, &movement.NetTotalSatang, &movement.PreviousCostSatang, &movement.ResultingCostSatang); queryErr != nil {
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

func stockListLimit(r *http.Request) int {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 200 {
		return 100
	}
	return limit
}

func (a *app) writePOSStockBatches(w http.ResponseWriter, r *http.Request, adminID string) {
	items, err := a.listPOSStockBatches(r.Context(), adminID, stockListLimit(r))
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (a *app) writePOSStockMovements(w http.ResponseWriter, r *http.Request, adminID string) {
	items, err := a.listPOSStockMovements(r.Context(), adminID, stockListLimit(r))
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (a *app) writePOSStockSummary(w http.ResponseWriter, r *http.Request, adminID string) {
	var productCount, totalUnits, lowStockCount, outOfStockCount, batchCount, movementCount int
	var inventoryCostSatang, inventoryRetailSatang int64
	err := a.db.QueryRowContext(r.Context(), `
		select count(*),coalesce(sum(stock_quantity),0),coalesce(sum(stock_quantity*cost_satang),0),coalesce(sum(stock_quantity*price_thb::bigint*100),0),
			count(*) filter (where stock_quantity>0 and stock_quantity<=low_stock_threshold),count(*) filter (where stock_quantity<=0)
		from pos_products where admin_id=$1 and deleted_at is null`, adminID).Scan(&productCount, &totalUnits, &inventoryCostSatang, &inventoryRetailSatang, &lowStockCount, &outOfStockCount)
	if err == nil {
		err = a.db.QueryRowContext(r.Context(), `select (select count(*) from pos_stock_batches where admin_id=$1),(select count(*) from pos_stock_movements where admin_id=$1)`, adminID).Scan(&batchCount, &movementCount)
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"productCount": productCount, "totalUnits": totalUnits, "inventoryCostSatang": inventoryCostSatang, "inventoryRetailSatang": inventoryRetailSatang, "lowStockCount": lowStockCount, "outOfStockCount": outOfStockCount, "batchCount": batchCount, "movementCount": movementCount})
}

func (a *app) posReport(ctx context.Context, adminID string) (map[string]any, error) {
	result := map[string]any{"salesThb": 0, "costThb": 0, "grossProfitThb": 0, "costSatang": int64(0), "grossProfitSatang": int64(0), "cashThb": 0, "promptPayThb": 0, "outstandingThb": 0, "lowStockCount": 0}
	var sales, cash, promptpay, outstanding, low int
	var costSatang int64
	err := a.db.QueryRowContext(ctx, `
		select
			coalesce(sum(s.total_thb) filter (where s.status='paid' and s.created_at >= date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'),0),
			coalesce(sum(s.cost_satang) filter (where s.status='paid' and s.created_at >= date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'),0),
			coalesce((select sum(amount_thb) from billing_payments where admin_id=$1 and status='paid' and method='cash' and created_at >= date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'),0),
			coalesce((select sum(amount_thb) from billing_payments where admin_id=$1 and status='paid' and method='promptpay' and created_at >= date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'),0),
			coalesce((select sum(total_thb) from pos_sales where admin_id=$1 and status='open'),0),
			(select count(*) from pos_products where admin_id=$1 and active and stock_quantity<=low_stock_threshold)
		from pos_sales s
		where s.admin_id=$1`, adminID).Scan(&sales, &costSatang, &cash, &promptpay, &outstanding, &low)
	if err != nil {
		return result, err
	}
	grossProfitSatang := int64(sales)*100 - costSatang
	result["salesThb"], result["costThb"], result["grossProfitThb"] = sales, roundedBaht(costSatang), roundedBaht(grossProfitSatang)
	result["costSatang"], result["grossProfitSatang"] = costSatang, grossProfitSatang
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
	sales, err := a.listPOSSales(r.Context(), adminID, "", 100, 0)
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
	selectFields := `c.id,c.name,c.active,(select count(*) from pos_products p where p.admin_id=c.admin_id and p.deleted_at is null and lower(p.%s)=lower(c.name)),'',''`
	if kind == "category" {
		selectFields = `c.id,c.name,c.active,(select count(*) from pos_products p where p.admin_id=c.admin_id and p.deleted_at is null and lower(p.%s)=lower(c.name)),c.icon,c.color`
	}
	query := fmt.Sprintf(`select `+selectFields+` from %s c where c.admin_id=$1 order by c.active desc,lower(c.name)`, productColumn, table)
	rows, err := a.db.QueryContext(ctx, query, adminID)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	for rows.Next() {
		var item posCatalogRecord
		if err = rows.Scan(&item.ID, &item.Name, &item.Active, &item.UsedCount, &item.Icon, &item.Color); err != nil {
			return items, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func decodePOSCatalog(w http.ResponseWriter, r *http.Request) (string, bool, string, string, bool) {
	var b struct {
		Name   string `json:"name"`
		Active *bool  `json:"active"`
		Icon   string `json:"icon"`
		Color  string `json:"color"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid catalog"})
		return "", false, "", "", false
	}
	b.Name = strings.TrimSpace(b.Name)
	if b.Name == "" || len(b.Name) > 100 {
		writeJSON(w, 400, map[string]string{"error": "กรุณาระบุชื่อไม่เกิน 100 ตัวอักษร"})
		return "", false, "", "", false
	}
	active := true
	if b.Active != nil {
		active = *b.Active
	}
	b.Icon, b.Color = strings.TrimSpace(b.Icon), strings.TrimSpace(b.Color)
	if b.Icon == "" {
		b.Icon = "Package"
	}
	if b.Color == "" {
		b.Color = "#EF4444"
	}
	if len(b.Icon) > 40 || len(b.Color) > 20 {
		writeJSON(w, 400, map[string]string{"error": "ข้อมูลรูปแบบหมวดหมู่ไม่ถูกต้อง"})
		return "", false, "", "", false
	}
	return b.Name, active, b.Icon, b.Color, true
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
	name, active, icon, color, ok := decodePOSCatalog(w, r)
	if !ok {
		return
	}
	table, prefix := "pos_categories", "category-"
	if kind == "unit" {
		table, prefix = "pos_units", "unit-"
	}
	id := prefix + randHex(8)
	query := fmt.Sprintf(`insert into %s (id,admin_id,name,active%s) values ($1,$2,$3,$4%s)`, table, map[bool]string{true: ",icon,color"}[kind == "category"], map[bool]string{true: ",$5,$6"}[kind == "category"])
	args := []any{id, user.ID, name, active}
	if kind == "category" {
		args = append(args, icon, color)
	}
	if _, err := a.db.ExecContext(r.Context(), query, args...); err != nil {
		writeJSON(w, 409, map[string]string{"error": "มีชื่อนี้แล้ว"})
		return
	}
	a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), "create_pos_"+kind, "pos_"+kind, id, map[string]any{"adminId": user.ID, "name": name})
	writeJSON(w, 201, posCatalogRecord{ID: id, Name: name, Active: active, Icon: icon, Color: color})
}

func (a *app) patchPOSCatalog(w http.ResponseWriter, r *http.Request, user adminUser, id, kind string) {
	name, active, icon, color, ok := decodePOSCatalog(w, r)
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
	updateQuery := fmt.Sprintf(`update %s set name=$3,active=$4 where id=$1 and admin_id=$2`, table)
	updateArgs := []any{id, user.ID, name, active}
	if kind == "category" {
		updateQuery = fmt.Sprintf(`update %s set name=$3,active=$4,icon=$5,color=$6 where id=$1 and admin_id=$2`, table)
		updateArgs = append(updateArgs, icon, color)
	}
	if _, err = tx.ExecContext(r.Context(), updateQuery, updateArgs...); err == nil {
		_, err = tx.ExecContext(r.Context(), fmt.Sprintf(`update pos_products set %s=$3,updated_at=now() where admin_id=$1 and lower(%s)=lower($2)`, column, column), user.ID, oldName, name)
	}
	if err != nil || tx.Commit() != nil {
		writeJSON(w, 409, map[string]string{"error": "ชื่อซ้ำหรือแก้ไขไม่สำเร็จ"})
		return
	}
	a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), "update_pos_"+kind, "pos_"+kind, id, map[string]any{"adminId": user.ID, "name": name})
	writeJSON(w, 200, posCatalogRecord{ID: id, Name: name, Active: active, Icon: icon, Color: color})
}

func (a *app) deletePOSCatalog(w http.ResponseWriter, r *http.Request, user adminUser, id, kind string) {
	table, column := "pos_categories", "category"
	if kind == "unit" {
		table, column = "pos_units", "unit"
	}
	var used int
	query := fmt.Sprintf(`select (select count(*) from pos_products p where p.admin_id=c.admin_id and p.deleted_at is null and lower(p.%s)=lower(c.name)) from %s c where c.id=$1 and c.admin_id=$2`, column, table)
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
	a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), "delete_pos_"+kind, "pos_"+kind, id, map[string]any{"adminId": user.ID})
	writeJSON(w, 200, map[string]bool{"deleted": true})
}

func decodePOSSupplier(w http.ResponseWriter, r *http.Request) (posSupplierRecord, bool) {
	var supplier posSupplierRecord
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&supplier) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ข้อมูลซัพพลายเออร์ไม่ถูกต้อง"})
		return supplier, false
	}
	supplier.Name = strings.TrimSpace(supplier.Name)
	supplier.ContactPerson = strings.TrimSpace(supplier.ContactPerson)
	supplier.Phone = strings.TrimSpace(supplier.Phone)
	supplier.Email = strings.TrimSpace(supplier.Email)
	supplier.Address = strings.TrimSpace(supplier.Address)
	if supplier.Name == "" || supplier.Phone == "" || len(supplier.Name) > 160 || len(supplier.ContactPerson) > 120 || len(supplier.Phone) > 40 || len(supplier.Email) > 160 || len(supplier.Address) > 500 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "กรุณาระบุชื่อและเบอร์โทรศัพท์ซัพพลายเออร์"})
		return supplier, false
	}
	return supplier, true
}

func (a *app) writePOSSuppliers(w http.ResponseWriter, r *http.Request, adminID string) {
	rows, err := a.db.QueryContext(r.Context(), `
		select s.id,s.code,s.name,s.contact_person,s.phone,s.email,s.address,s.active,
			(select count(distinct m.product_id) from pos_stock_batches b join pos_stock_movements m on m.batch_id=b.id where b.supplier_id=s.id)
		from pos_suppliers s where s.admin_id=$1 and s.active order by lower(s.name),s.id`, adminID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	items := []posSupplierRecord{}
	for rows.Next() {
		var item posSupplierRecord
		if err = rows.Scan(&item.ID, &item.Code, &item.Name, &item.ContactPerson, &item.Phone, &item.Email, &item.Address, &item.Active, &item.ProductsCount); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		items = append(items, item)
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (a *app) createPOSSupplier(w http.ResponseWriter, r *http.Request, user adminUser) {
	supplier, ok := decodePOSSupplier(w, r)
	if !ok {
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), `select pg_advisory_xact_lock(hashtext($1))`, "pos-supplier:"+user.ID); err != nil {
		writeJSON(w, 500, map[string]string{"error": "สร้างรหัสซัพพลายเออร์ไม่สำเร็จ"})
		return
	}
	var sequence int
	if err = tx.QueryRowContext(r.Context(), `select coalesce(max(nullif(regexp_replace(code,'\D','','g'),'')::int),0)+1 from pos_suppliers where admin_id=$1`, user.ID).Scan(&sequence); err != nil {
		writeJSON(w, 500, map[string]string{"error": "สร้างรหัสซัพพลายเออร์ไม่สำเร็จ"})
		return
	}
	supplier.ID = "supplier-" + randHex(8)
	supplier.Code = fmt.Sprintf("SUP-%04d", sequence)
	supplier.Active = true
	if _, err = tx.ExecContext(r.Context(), `insert into pos_suppliers (id,admin_id,code,name,contact_person,phone,email,address) values ($1,$2,$3,$4,$5,$6,$7,$8)`, supplier.ID, user.ID, supplier.Code, supplier.Name, supplier.ContactPerson, supplier.Phone, supplier.Email, supplier.Address); err != nil || tx.Commit() != nil {
		writeJSON(w, 409, map[string]string{"error": "เพิ่มซัพพลายเออร์ไม่สำเร็จ"})
		return
	}
	a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), "create_pos_supplier", "pos_supplier", supplier.ID, map[string]any{"code": supplier.Code, "adminId": user.ID})
	writeJSON(w, http.StatusCreated, supplier)
}

func (a *app) patchPOSSupplier(w http.ResponseWriter, r *http.Request, user adminUser, id string) {
	supplier, ok := decodePOSSupplier(w, r)
	if !ok {
		return
	}
	var saved posSupplierRecord
	err := a.db.QueryRowContext(r.Context(), `update pos_suppliers set name=$3,contact_person=$4,phone=$5,email=$6,address=$7,updated_at=now() where id=$1 and admin_id=$2 and active returning id,code,name,contact_person,phone,email,address,active`, id, user.ID, supplier.Name, supplier.ContactPerson, supplier.Phone, supplier.Email, supplier.Address).Scan(&saved.ID, &saved.Code, &saved.Name, &saved.ContactPerson, &saved.Phone, &saved.Email, &saved.Address, &saved.Active)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, 409, map[string]string{"error": "แก้ไขซัพพลายเออร์ไม่สำเร็จ"})
		return
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, 404, map[string]string{"error": "ไม่พบซัพพลายเออร์"})
		return
	}
	a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), "update_pos_supplier", "pos_supplier", id, map[string]any{"adminId": user.ID})
	writeJSON(w, 200, saved)
}

func (a *app) deletePOSSupplier(w http.ResponseWriter, r *http.Request, user adminUser, id string) {
	result, err := a.db.ExecContext(r.Context(), `update pos_suppliers set active=false,updated_at=now() where id=$1 and admin_id=$2 and active`, id, user.ID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "ลบซัพพลายเออร์ไม่สำเร็จ"})
		return
	}
	if count, _ := result.RowsAffected(); count == 0 {
		writeJSON(w, 404, map[string]string{"error": "ไม่พบซัพพลายเออร์"})
		return
	}
	a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), "disable_pos_supplier", "pos_supplier", id, map[string]any{"adminId": user.ID})
	writeJSON(w, 200, map[string]bool{"deleted": true})
}

func (a *app) savePOSSettings(w http.ResponseWriter, r *http.Request, user adminUser) {
	var b posSettingsRecord
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 6<<20)).Decode(&b) != nil || b.DefaultLowStock < 0 || b.TaxRatePercent < 0 || b.TaxRatePercent > 100 || len(b.ReceiptHeader) > 500 || len(b.ReceiptFooter) > 500 || len(b.LogoData) > 2_800_000 || !validImageData(b.LogoData, true) || !posImageWithinLimit(b.PaymentQRImage, 2*1024*1024) || !validImageData(b.PaymentQRImage, true) {
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
	_, err := a.db.ExecContext(r.Context(), `insert into pos_settings (admin_id,promptpay_type,promptpay_id,promptpay_receiver_name,receipt_header,receipt_footer,logo_data,default_low_stock,theme,language,tax_rate_percent,prices_include_tax,inherit_booking_promptpay,payment_qr_image) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict (admin_id) do update set promptpay_type=excluded.promptpay_type,promptpay_id=excluded.promptpay_id,promptpay_receiver_name=excluded.promptpay_receiver_name,receipt_header=excluded.receipt_header,receipt_footer=excluded.receipt_footer,logo_data=excluded.logo_data,default_low_stock=excluded.default_low_stock,theme=excluded.theme,language=excluded.language,tax_rate_percent=excluded.tax_rate_percent,prices_include_tax=excluded.prices_include_tax,inherit_booking_promptpay=excluded.inherit_booking_promptpay,payment_qr_image=excluded.payment_qr_image,updated_at=now()`, user.ID, b.PromptPayType, b.PromptPayID, b.PromptPayReceiverName, strings.TrimSpace(b.ReceiptHeader), strings.TrimSpace(b.ReceiptFooter), b.LogoData, b.DefaultLowStock, b.Theme, b.Language, b.TaxRatePercent, b.PricesIncludeTax, b.InheritBookingPromptPay, b.PaymentQRImage)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), "update_pos_settings", "pos_settings", user.ID, map[string]any{"hasPromptPay": b.PromptPayID != ""})
	a.writePOSOverview(w, r, user.ID)
}

func decodePOSProduct(w http.ResponseWriter, r *http.Request) (posProductRecord, bool) {
	var p posProductRecord
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 3<<20)).Decode(&p) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid product"})
		return p, false
	}
	p.SKU, p.Category, p.Name, p.Unit = strings.TrimSpace(p.SKU), strings.TrimSpace(p.Category), strings.TrimSpace(p.Name), strings.TrimSpace(p.Unit)
	p.Barcode, p.Description = strings.TrimSpace(p.Barcode), strings.TrimSpace(p.Description)
	if p.CostSatang == 0 && p.CostTHB > 0 {
		p.CostSatang = int64(p.CostTHB) * 100
	}
	if p.PriceSatang == 0 && p.PriceTHB > 0 {
		p.PriceSatang = int64(p.PriceTHB) * 100
	}
	p.CostTHB = roundedBaht(p.CostSatang)
	p.PriceTHB = roundedBaht(p.PriceSatang)
	if p.Name == "" || len(p.Name) > 160 || len(p.SKU) > 80 || len(p.Barcode) > 100 || len(p.Description) > 1000 || len(p.Category) > 100 || len(p.Unit) > 40 || !posImageWithinLimit(p.ImageData, 2*1024*1024) || !validImageData(p.ImageData, true) || p.PriceSatang < 0 || p.PriceSatang > 1_000_000_000 || p.CostSatang < 0 || p.CostSatang > 1_000_000_000 || p.StockQuantity < 0 || p.LowStockThreshold < 0 {
		writeJSON(w, 400, map[string]string{"error": "invalid product"})
		return p, false
	}
	return p, true
}

func roundedBaht(satang int64) int {
	return int((satang + 50) / 100)
}

func posImageWithinLimit(data string, maxBytes int) bool {
	if data == "" {
		return true
	}
	comma := strings.IndexByte(data, ',')
	if comma < 0 {
		return false
	}
	raw, err := base64.StdEncoding.DecodeString(data[comma+1:])
	return err == nil && len(raw) <= maxBytes
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
	_, err := a.db.ExecContext(r.Context(), `insert into pos_products (id,admin_id,sku,category,name,price_thb,price_satang,cost_thb,cost_satang,stock_quantity,low_stock_threshold,active,unit,image_data,barcode,description) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, p.ID, user.ID, p.SKU, p.Category, p.Name, p.PriceTHB, p.PriceSatang, p.CostTHB, p.CostSatang, p.StockQuantity, p.LowStockThreshold, p.Active, p.Unit, p.ImageData, p.Barcode, p.Description)
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": "SKU ซ้ำหรือข้อมูลสินค้าไม่ถูกต้อง"})
		return
	}
	if p.StockQuantity > 0 {
		_, _ = a.db.ExecContext(r.Context(), `insert into pos_stock_movements (admin_id,product_id,delta,balance,reason,note,actor_id,actor_type,actor_name,unit_cost_thb,total_cost_thb,previous_cost_thb,resulting_cost_thb,unit_cost_satang,gross_total_satang,net_total_satang,resulting_cost_satang) values ($1,$2,$3,$3,'restock','สต็อกเริ่มต้น',$4,$5,$6,$7,$8,0,$7,$9,$10,$10,$9)`, user.ID, p.ID, p.StockQuantity, posActorID(user), posActorType(user), posActorName(user), p.CostTHB, p.StockQuantity*p.CostTHB, p.CostSatang, int64(p.StockQuantity)*p.CostSatang)
	}
	a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), "create_pos_product", "pos_product", p.ID, map[string]any{"adminId": user.ID, "sku": p.SKU})
	writeJSON(w, 201, p)
}

func (a *app) patchPOSProduct(w http.ResponseWriter, r *http.Request, user adminUser, id string) {
	p, ok := decodePOSProduct(w, r)
	if !ok {
		return
	}
	result, err := a.db.ExecContext(r.Context(), `update pos_products set category=$3,name=$4,price_thb=$5,price_satang=$6,cost_thb=$7,cost_satang=$8,low_stock_threshold=$9,active=$10,unit=$11,image_data=$12,barcode=$13,description=$14,updated_at=now() where id=$1 and admin_id=$2 and deleted_at is null`, id, user.ID, p.Category, p.Name, p.PriceTHB, p.PriceSatang, p.CostTHB, p.CostSatang, p.LowStockThreshold, p.Active, p.Unit, p.ImageData, p.Barcode, p.Description)
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": "SKU ซ้ำหรือข้อมูลสินค้าไม่ถูกต้อง"})
		return
	}
	if count, _ := result.RowsAffected(); count == 0 {
		writeJSON(w, 404, map[string]string{"error": "product not found"})
		return
	}
	a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), "update_pos_product", "pos_product", id, map[string]any{"adminId": user.ID})
	a.writePOSOverview(w, r, user.ID)
}

func (a *app) deletePOSProduct(w http.ResponseWriter, r *http.Request, user adminUser, id string) {
	result, err := a.db.ExecContext(r.Context(), `update pos_products set active=false,deleted_at=now(),updated_at=now() where id=$1 and admin_id=$2 and deleted_at is null`, id, user.ID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "ปิดการขายสินค้าไม่สำเร็จ"})
		return
	}
	if count, _ := result.RowsAffected(); count == 0 {
		writeJSON(w, 404, map[string]string{"error": "product not found"})
		return
	}
	a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), "disable_pos_product", "pos_product", id, map[string]any{"adminId": user.ID})
	writeJSON(w, 200, map[string]bool{"deleted": true})
}

func (a *app) adjustPOSStock(w http.ResponseWriter, r *http.Request, user adminUser, id string) {
	var b struct {
		Delta      int    `json:"delta"`
		CostTHB    *int   `json:"costThb"`
		CostSatang *int64 `json:"costSatang"`
		Note       string `json:"note"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid stock adjustment"})
		return
	}
	if b.CostSatang == nil && b.CostTHB != nil {
		value := int64(*b.CostTHB) * 100
		b.CostSatang = &value
	}
	if (b.Delta == 0 && b.CostTHB == nil && b.CostSatang == nil) || (b.CostTHB != nil && *b.CostTHB < 0) || (b.CostSatang != nil && *b.CostSatang < 0) || len(b.Note) > 300 {
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
	var costTHB *int
	if b.CostSatang != nil {
		value := roundedBaht(*b.CostSatang)
		costTHB = &value
	}
	if err = tx.QueryRowContext(r.Context(), `update pos_products set stock_quantity=stock_quantity+$3,cost_thb=coalesce($4,cost_thb),cost_satang=coalesce($5,cost_satang),updated_at=now() where id=$1 and admin_id=$2 and deleted_at is null and stock_quantity+$3>=0 returning stock_quantity`, id, user.ID, b.Delta, costTHB, b.CostSatang).Scan(&balance); err != nil {
		writeJSON(w, 409, map[string]string{"error": "สต็อกไม่เพียงพอหรือไม่พบสินค้า"})
		return
	}
	if b.Delta != 0 {
		reason := "adjustment"
		if b.Delta > 0 {
			reason = "restock"
		}
		_, err = tx.ExecContext(r.Context(), `insert into pos_stock_movements (admin_id,product_id,delta,balance,reason,note,actor_id,actor_type,actor_name) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, user.ID, id, b.Delta, balance, reason, strings.TrimSpace(b.Note), posActorID(user), posActorType(user), posActorName(user))
	}
	if err != nil || tx.Commit() != nil {
		writeJSON(w, 500, map[string]string{"error": "บันทึกสต็อกไม่สำเร็จ"})
		return
	}
	a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), "adjust_pos_stock", "pos_product", id, map[string]any{"adminId": user.ID, "delta": b.Delta})
	a.writePOSOverview(w, r, user.ID)
}

type posStockBatchRequest struct {
	Name                 string                   `json:"name"`
	Mode                 string                   `json:"mode"`
	Note                 string                   `json:"note"`
	SupplierID           string                   `json:"supplierId"`
	DiscountType         string                   `json:"discountType"`
	DiscountAmountSatang int64                    `json:"discountAmountSatang"`
	DiscountRateBPS      int                      `json:"discountRateBps"`
	Items                []posStockBatchItemInput `json:"items"`
}

type posStockBatchItemInput struct {
	ProductID      string `json:"productId"`
	Quantity       int    `json:"quantity"`
	TargetQuantity int    `json:"targetQuantity"`
	CostTHB        *int   `json:"costThb"`
	CostSatang     *int64 `json:"costSatang"`
	Note           string `json:"note"`
}

func weightedAverageCostSatang(currentQuantity int, currentCostSatang int64, incomingQuantity int, incomingNetSatang int64) int64 {
	newQuantity := currentQuantity + incomingQuantity
	if newQuantity <= 0 {
		return currentCostSatang
	}
	total := int64(currentQuantity)*currentCostSatang + incomingNetSatang
	return (total + int64(newQuantity)/2) / int64(newQuantity)
}

func stockDiscountSatang(grossSatang int64, discountType string, amountSatang int64, rateBPS int) int64 {
	if discountType == "percent" {
		rate := int64(rateBPS)
		return (grossSatang/10000)*rate + ((grossSatang%10000)*rate+5000)/10000
	}
	return amountSatang
}

func allocateStockDiscount(unitCosts []int64, quantities []int, discountSatang int64) ([]int64, error) {
	allocated := make([]int64, len(unitCosts))
	if len(unitCosts) != len(quantities) || discountSatang < 0 {
		return nil, errors.New("invalid discount")
	}
	capacities := make([]int64, len(unitCosts))
	var gross int64
	for index := range unitCosts {
		if unitCosts[index] < 0 || quantities[index] <= 0 {
			return nil, errors.New("invalid discount item")
		}
		capacities[index] = unitCosts[index] * int64(quantities[index])
		gross += capacities[index]
	}
	if discountSatang > gross {
		return nil, errors.New("discount exceeds gross total")
	}
	remaining := discountSatang
	for remaining > 0 {
		activeUnits := int64(0)
		for index := range capacities {
			if allocated[index] < capacities[index] {
				activeUnits += int64(quantities[index])
			}
		}
		if activeUnits == 0 {
			return nil, errors.New("discount cannot be allocated")
		}
		perUnit := remaining / activeUnits
		progress := int64(0)
		if perUnit > 0 {
			for index := range capacities {
				capacityLeft := capacities[index] - allocated[index]
				if capacityLeft <= 0 {
					continue
				}
				share := perUnit * int64(quantities[index])
				if share > capacityLeft {
					share = capacityLeft
				}
				if share > remaining-progress {
					share = remaining - progress
				}
				allocated[index] += share
				progress += share
			}
		}
		remaining -= progress
		if remaining == 0 {
			break
		}
		progress = 0
		for index := range capacities {
			capacityLeft := capacities[index] - allocated[index]
			if capacityLeft <= 0 {
				continue
			}
			share := int64(quantities[index])
			if share > capacityLeft {
				share = capacityLeft
			}
			if share > remaining-progress {
				share = remaining - progress
			}
			allocated[index] += share
			progress += share
			if progress == remaining {
				break
			}
		}
		if progress == 0 {
			return nil, errors.New("discount cannot be allocated")
		}
		remaining -= progress
	}
	return allocated, nil
}

func (a *app) adjustPOSStockBatch(w http.ResponseWriter, r *http.Request, user adminUser) {
	var b posStockBatchRequest
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10)).Decode(&b) != nil || (b.Mode != "in" && b.Mode != "out" && b.Mode != "adjust") || len(b.Items) == 0 || len(b.Items) > 200 || len(b.Note) > 300 {
		writeJSON(w, 400, map[string]string{"error": "invalid stock batch"})
		return
	}
	b.Name, b.Note, b.SupplierID = strings.TrimSpace(b.Name), strings.TrimSpace(b.Note), strings.TrimSpace(b.SupplierID)
	if b.DiscountType == "" {
		b.DiscountType = "amount"
	}
	if b.Mode != "in" {
		b.SupplierID, b.DiscountType, b.DiscountAmountSatang, b.DiscountRateBPS = "", "amount", 0, 0
	}
	if b.Name == "" || len(b.Name) > 160 {
		writeJSON(w, 400, map[string]string{"error": "กรุณาระบุชื่อรายการไม่เกิน 160 ตัวอักษร"})
		return
	}
	if (b.DiscountType != "amount" && b.DiscountType != "percent") || b.DiscountAmountSatang < 0 || b.DiscountRateBPS < 0 || b.DiscountRateBPS > 10000 {
		writeJSON(w, 400, map[string]string{"error": "ส่วนลดไม่ถูกต้อง"})
		return
	}
	ids := make([]string, 0, len(b.Items))
	seen := map[string]bool{}
	for index := range b.Items {
		item := &b.Items[index]
		item.ProductID, item.Note = strings.TrimSpace(item.ProductID), strings.TrimSpace(item.Note)
		if item.CostSatang == nil && item.CostTHB != nil {
			value := int64(*item.CostTHB) * 100
			item.CostSatang = &value
		}
		if item.ProductID == "" || seen[item.ProductID] || item.Quantity > 1_000_000 || item.TargetQuantity > 1_000_000 || len(item.Note) > 300 || (b.Mode != "adjust" && item.Quantity <= 0) || (b.Mode == "adjust" && item.TargetQuantity < 0) || (item.CostSatang != nil && (*item.CostSatang < 0 || *item.CostSatang > 1_000_000_000)) || (b.Mode == "in" && item.CostSatang == nil) {
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
	if _, err = tx.ExecContext(r.Context(), `select pg_advisory_xact_lock(hashtext($1))`, "pos-stock-batch:"+user.ID+":"+strings.ToLower(b.Name)); err != nil {
		writeJSON(w, 500, map[string]string{"error": "ล็อกเอกสารสต็อกไม่สำเร็จ"})
		return
	}
	var duplicate bool
	if err = tx.QueryRowContext(r.Context(), `select exists(select 1 from pos_stock_batches where admin_id=$1 and lower(name)=lower($2))`, user.ID, b.Name).Scan(&duplicate); err != nil {
		writeJSON(w, 500, map[string]string{"error": "ตรวจสอบเลขที่เอกสารไม่สำเร็จ"})
		return
	}
	if duplicate {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "เลขที่เอกสารนี้ถูกบันทึกแล้ว"})
		return
	}
	type lockedProduct struct {
		stock      int
		costSatang int64
		name       string
	}
	locked := map[string]lockedProduct{}
	for _, id := range ids {
		var p lockedProduct
		if err = tx.QueryRowContext(r.Context(), `select stock_quantity,cost_satang,name from pos_products where id=$1 and admin_id=$2 and deleted_at is null for update`, id, user.ID).Scan(&p.stock, &p.costSatang, &p.name); err != nil {
			writeJSON(w, 404, map[string]string{"error": "ไม่พบสินค้าในรายการ"})
			return
		}
		locked[id] = p
	}
	supplierName := ""
	if b.SupplierID != "" {
		if err = tx.QueryRowContext(r.Context(), `select name from pos_suppliers where id=$1 and admin_id=$2 and active`, b.SupplierID, user.ID).Scan(&supplierName); err != nil {
			writeJSON(w, 400, map[string]string{"error": "ไม่พบซัพพลายเออร์"})
			return
		}
	}
	unitCosts := make([]int64, len(b.Items))
	quantities := make([]int, len(b.Items))
	var grossTotalSatang int64
	if b.Mode == "in" {
		for index, item := range b.Items {
			unitCosts[index], quantities[index] = *item.CostSatang, item.Quantity
			grossTotalSatang += unitCosts[index] * int64(item.Quantity)
		}
	}
	discountSatang := stockDiscountSatang(grossTotalSatang, b.DiscountType, b.DiscountAmountSatang, b.DiscountRateBPS)
	allocatedDiscounts, allocationErr := allocateStockDiscount(unitCosts, quantities, discountSatang)
	if b.Mode != "in" {
		allocatedDiscounts = make([]int64, len(b.Items))
		allocationErr = nil
	}
	if allocationErr != nil {
		writeJSON(w, 400, map[string]string{"error": "ส่วนลดเกินมูลค่าสินค้า"})
		return
	}
	batchID := "stock-" + randHex(8)
	if _, err = tx.ExecContext(r.Context(), `insert into pos_stock_batches (id,admin_id,name,mode,note,actor_id,actor_type,actor_name,supplier_id,supplier_name,discount_type,discount_rate_bps,gross_total_satang,discount_satang,net_total_satang,total_cost_satang,total_cost_thb) values ($1,$2,$3,$4,$5,$6,$7,$8,nullif($9,''),$10,$11,$12,$13,$14,$15,$15,$16)`, batchID, user.ID, b.Name, b.Mode, b.Note, posActorID(user), posActorType(user), posActorName(user), b.SupplierID, supplierName, b.DiscountType, b.DiscountRateBPS, grossTotalSatang, discountSatang, grossTotalSatang-discountSatang, roundedBaht(grossTotalSatang-discountSatang)); err != nil {
		writeJSON(w, 500, map[string]string{"error": "สร้างเอกสารสต็อกไม่สำเร็จ"})
		return
	}
	var totalBatchCostSatang int64
	for index, item := range b.Items {
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
		unitCostSatang := product.costSatang
		resultingCostSatang := product.costSatang
		grossLineSatang := int64(delta) * unitCostSatang
		if grossLineSatang < 0 {
			grossLineSatang = -grossLineSatang
		}
		allocatedDiscountSatang := int64(0)
		netLineSatang := grossLineSatang
		if b.Mode == "in" {
			unitCostSatang = *item.CostSatang
			grossLineSatang = int64(item.Quantity) * unitCostSatang
			allocatedDiscountSatang = allocatedDiscounts[index]
			netLineSatang = grossLineSatang - allocatedDiscountSatang
			resultingCostSatang = weightedAverageCostSatang(current, product.costSatang, item.Quantity, netLineSatang)
		}
		totalBatchCostSatang += netLineSatang
		if _, err = tx.ExecContext(r.Context(), `update pos_products set stock_quantity=$3,cost_satang=$4,cost_thb=$5,updated_at=now() where id=$1 and admin_id=$2`, item.ProductID, user.ID, balance, resultingCostSatang, roundedBaht(resultingCostSatang)); err != nil {
			writeJSON(w, 500, map[string]string{"error": "บันทึกรายการสต็อกไม่สำเร็จ"})
			return
		}
		if delta != 0 || b.Mode == "adjust" {
			reason := "adjustment"
			if b.Mode == "in" {
				reason = "restock"
			}
			movementNote := b.Note
			if item.Note != "" {
				if movementNote != "" {
					movementNote += " • "
				}
				movementNote += item.Note
			}
			if _, err = tx.ExecContext(r.Context(), `insert into pos_stock_movements (admin_id,product_id,batch_id,delta,balance,reason,note,actor_id,actor_type,actor_name,unit_cost_thb,total_cost_thb,previous_cost_thb,resulting_cost_thb,unit_cost_satang,gross_total_satang,allocated_discount_satang,net_total_satang,previous_cost_satang,resulting_cost_satang) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`, user.ID, item.ProductID, batchID, delta, balance, reason, movementNote, posActorID(user), posActorType(user), posActorName(user), roundedBaht(unitCostSatang), roundedBaht(netLineSatang), roundedBaht(product.costSatang), roundedBaht(resultingCostSatang), unitCostSatang, grossLineSatang, allocatedDiscountSatang, netLineSatang, product.costSatang, resultingCostSatang); err != nil {
				writeJSON(w, 500, map[string]string{"error": "บันทึกประวัติสต็อกไม่สำเร็จ"})
				return
			}
		}
	}
	if b.Mode != "in" {
		grossTotalSatang, discountSatang = totalBatchCostSatang, 0
	}
	if _, err = tx.ExecContext(r.Context(), `update pos_stock_batches set gross_total_satang=$2,discount_satang=$3,net_total_satang=$4,total_cost_satang=$4,total_cost_thb=$5 where id=$1`, batchID, grossTotalSatang, discountSatang, totalBatchCostSatang, roundedBaht(totalBatchCostSatang)); err != nil {
		writeJSON(w, 500, map[string]string{"error": "สรุปต้นทุนเอกสารไม่สำเร็จ"})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": "บันทึกรายการสต็อกไม่สำเร็จ"})
		return
	}
	a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), "adjust_pos_stock_batch", "pos_stock_batch", batchID, map[string]any{"adminId": user.ID, "mode": b.Mode, "name": b.Name, "items": len(b.Items), "grossTotalSatang": grossTotalSatang, "discountSatang": discountSatang, "netTotalSatang": totalBatchCostSatang})
	writeJSON(w, http.StatusCreated, map[string]any{"id": batchID, "grossTotalSatang": grossTotalSatang, "discountSatang": discountSatang, "netTotalSatang": totalBatchCostSatang})
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
	RequestID            string `json:"requestId"`
	BuyerType            string `json:"buyerType"`
	BuyerID              string `json:"buyerId"`
	BuyerName            string `json:"buyerName"`
	Phone                string `json:"phone"`
	Action               string `json:"action"`
	Method               string `json:"method"`
	Note                 string `json:"note"`
	ExpectedTotalTHB     int    `json:"expectedTotalThb"`
	ExpectedTotalSatang  int64  `json:"expectedTotalSatang"`
	DiscountType         string `json:"discountType"`
	DiscountAmountSatang int64  `json:"discountAmountSatang"`
	DiscountRateBPS      int    `json:"discountRateBps"`
	CashReceivedSatang   int64  `json:"cashReceivedSatang"`
	ReferenceNumber      string `json:"referenceNumber"`
	Items                []struct {
		ProductID string `json:"productId"`
		Quantity  int    `json:"quantity"`
		Note      string `json:"note"`
	} `json:"items"`
}

func validPaymentMethod(value string) bool { return value == "cash" || value == "promptpay" }

func roundDivHalfUp(value, divisor int64) int64 {
	if divisor <= 0 || value <= 0 {
		return 0
	}
	return (value + divisor/2) / divisor
}

func (a *app) createPOSSale(w http.ResponseWriter, r *http.Request, user adminUser) {
	var b posSaleRequest
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10)).Decode(&b) != nil || len(b.Items) == 0 || len(b.Items) > 100 || len(b.Note) > 500 {
		writeJSON(w, 400, map[string]string{"error": "invalid sale"})
		return
	}
	b.RequestID, b.BuyerType, b.BuyerID, b.BuyerName, b.Action, b.Method = strings.TrimSpace(b.RequestID), strings.TrimSpace(b.BuyerType), strings.TrimSpace(b.BuyerID), strings.TrimSpace(b.BuyerName), strings.TrimSpace(b.Action), strings.TrimSpace(b.Method)
	if b.Action == "open" {
		b.Action = "hold"
	}
	if b.Action != "hold" && b.Action != "pay" {
		writeJSON(w, 400, map[string]string{"error": "invalid sale action"})
		return
	}
	if b.Action == "hold" && (b.BuyerType != "member" || b.BuyerID == "") {
		writeJSON(w, 400, map[string]string{"error": "บิลพักยอดต้องเลือกสมาชิกในระบบ"})
		return
	}
	if b.Action == "pay" && !validPaymentMethod(b.Method) {
		writeJSON(w, 400, map[string]string{"error": "invalid payment method"})
		return
	}
	if b.DiscountType == "" {
		b.DiscountType = "amount"
	}
	if (b.DiscountType != "amount" && b.DiscountType != "percent") || b.DiscountAmountSatang < 0 || b.DiscountRateBPS < 0 || b.DiscountRateBPS > 10000 || len(b.RequestID) > 120 || len(b.ReferenceNumber) > 160 {
		writeJSON(w, 400, map[string]string{"error": "ข้อมูลส่วนลดหรือการชำระเงินไม่ถูกต้อง"})
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	if b.RequestID != "" {
		if _, err = tx.ExecContext(r.Context(), `select pg_advisory_xact_lock(hashtextextended($1,0))`, user.ID+":sale:"+b.RequestID); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		var existingID, existingStatus string
		var existingTotal int64
		if tx.QueryRowContext(r.Context(), `select id,status,total_satang from pos_sales where admin_id=$1 and request_id=$2`, user.ID, b.RequestID).Scan(&existingID, &existingStatus, &existingTotal) == nil {
			writeJSON(w, 200, map[string]any{"saleId": existingID, "status": existingStatus, "totalSatang": existingTotal, "duplicate": true})
			return
		}
	}
	accountID, buyerName := "", b.BuyerName
	if b.BuyerType == "member" {
		accountID, err = ensureBillingAccountTx(r.Context(), tx, user.ID, "member", b.BuyerID, "", "")
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
	type lockedProduct struct{ record posProductRecord }
	requestedTotals := map[string]int{}
	for _, item := range b.Items {
		if item.Quantity <= 0 || item.Quantity > 1000 || len(item.Note) > 500 {
			writeJSON(w, 400, map[string]string{"error": "จำนวนสินค้าหรือหมายเหตุไม่ถูกต้อง"})
			return
		}
		requestedTotals[item.ProductID] += item.Quantity
	}
	productIDs := make([]string, 0, len(requestedTotals))
	for id := range requestedTotals {
		productIDs = append(productIDs, id)
	}
	sort.Strings(productIDs)
	locked := map[string]lockedProduct{}
	for _, productID := range productIDs {
		var p posProductRecord
		err = tx.QueryRowContext(r.Context(), `select id,sku,name,price_thb,price_satang,cost_thb,cost_satang,stock_quantity from pos_products where id=$1 and admin_id=$2 and active and deleted_at is null for update`, productID, user.ID).Scan(&p.ID, &p.SKU, &p.Name, &p.PriceTHB, &p.PriceSatang, &p.CostTHB, &p.CostSatang, &p.StockQuantity)
		if err != nil || p.StockQuantity < requestedTotals[productID] {
			writeJSON(w, http.StatusConflict, map[string]any{"error": "สต็อกสินค้าไม่เพียงพอ", "productId": productID, "available": p.StockQuantity})
			return
		}
		locked[productID] = lockedProduct{record: p}
	}
	var subtotalSatang int64
	var costSatang int64
	items := make([]posSaleItemRecord, 0, len(b.Items))
	for _, requested := range b.Items {
		p := locked[requested.ProductID].record
		lineTotalSatang := p.PriceSatang * int64(requested.Quantity)
		line := posSaleItemRecord{ProductID: p.ID, ProductName: p.Name, SKU: p.SKU, Quantity: requested.Quantity, UnitPrice: p.PriceTHB, UnitPriceSatang: p.PriceSatang, UnitCostSatang: p.CostSatang, LineTotal: roundedBaht(lineTotalSatang), LineTotalSatang: lineTotalSatang, Note: strings.TrimSpace(requested.Note)}
		subtotalSatang += lineTotalSatang
		costSatang += p.CostSatang * int64(requested.Quantity)
		items = append(items, line)
	}
	settings, _ := a.ensurePOSSettings(r.Context(), user.ID)
	discountSatang := b.DiscountAmountSatang
	if b.DiscountType == "percent" {
		discountSatang = roundDivHalfUp(subtotalSatang*int64(b.DiscountRateBPS), 10000)
	}
	if discountSatang > subtotalSatang {
		discountSatang = subtotalSatang
	}
	netBeforeVATSatang := subtotalSatang - discountSatang
	vatRateBPS, vatSatang, totalSatang := settings.TaxRatePercent*100, int64(0), netBeforeVATSatang
	if settings.TaxRatePercent > 0 {
		if settings.PricesIncludeTax {
			vatSatang = roundDivHalfUp(netBeforeVATSatang*int64(vatRateBPS), int64(10000+vatRateBPS))
		} else {
			vatSatang = roundDivHalfUp(netBeforeVATSatang*int64(vatRateBPS), 10000)
			totalSatang += vatSatang
		}
	}
	if b.ExpectedTotalSatang == 0 && b.ExpectedTotalTHB > 0 {
		b.ExpectedTotalSatang = int64(b.ExpectedTotalTHB) * 100
	}
	if b.ExpectedTotalSatang > 0 && b.ExpectedTotalSatang != totalSatang {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "ยอดชำระเปลี่ยนแปลง กรุณาตรวจสอบยอดล่าสุด", "totalSatang": totalSatang})
		return
	}
	if b.Action == "pay" && b.Method == "cash" && b.CashReceivedSatang < totalSatang {
		writeJSON(w, 400, map[string]any{"error": "ยอดเงินสดไม่เพียงพอ", "totalSatang": totalSatang})
		return
	}
	status := "open"
	paymentID := ""
	if b.Action == "pay" {
		status, paymentID = "paid", "payment-"+randHex(8)
		effective, _ := a.effectivePOSPromptPay(r.Context(), user.ID, settings)
		changeSatang := int64(0)
		if b.Method == "cash" {
			changeSatang = b.CashReceivedSatang - totalSatang
		}
		_, err = tx.ExecContext(r.Context(), `insert into billing_payments (id,admin_id,billing_account_id,amount_thb,amount_satang,method,received_by,received_by_type,received_by_name,cash_received_satang,change_satang,reference_number,receiver_name,origin_system) values ($1,$2,nullif($3,''),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pos')`, paymentID, user.ID, accountID, roundedBaht(totalSatang), totalSatang, b.Method, posActorID(user), posActorType(user), posActorName(user), b.CashReceivedSatang, changeSatang, strings.TrimSpace(b.ReferenceNumber), effective.ReceiverName)
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), `insert into pos_sales (id,admin_id,billing_account_id,buyer_name,status,total_thb,cost_thb,cost_satang,payment_id,note,created_by,created_by_type,created_by_name,request_id,subtotal_satang,discount_type,discount_rate_bps,discount_satang,net_before_vat_satang,vat_rate_bps,vat_satang,prices_include_tax,total_satang) values ($1,$2,nullif($3,''),$4,$5,$6,$7,$8,nullif($9,''),$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`, saleID, user.ID, accountID, buyerName, status, roundedBaht(totalSatang), roundedBaht(costSatang), costSatang, paymentID, strings.TrimSpace(b.Note), posActorID(user), posActorType(user), posActorName(user), b.RequestID, subtotalSatang, b.DiscountType, b.DiscountRateBPS, discountSatang, netBeforeVATSatang, vatRateBPS, vatSatang, settings.PricesIncludeTax, totalSatang)
	}
	if err == nil && paymentID != "" {
		snapshot, _ := json.Marshal(map[string]any{"saleId": saleID, "buyerName": buyerName, "subtotalSatang": subtotalSatang, "discountSatang": discountSatang, "vatSatang": vatSatang, "totalSatang": totalSatang, "pricesIncludeTax": settings.PricesIncludeTax, "items": items})
		_, err = tx.ExecContext(r.Context(), `insert into billing_payment_allocations (payment_id,source_type,source_id,amount_thb,amount_satang,label,snapshot) values ($1,'pos',$2,$3,$4,$5,$6)`, paymentID, saleID, roundedBaht(totalSatang), totalSatang, "สินค้า · "+saleID, snapshot)
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	for _, item := range items {
		_, err = tx.ExecContext(r.Context(), `insert into pos_sale_items (sale_id,product_id,product_name,sku,quantity,unit_price_thb,unit_cost_thb,unit_cost_satang,line_total_thb,unit_price_satang,line_total_satang,note) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, saleID, item.ProductID, item.ProductName, item.SKU, item.Quantity, item.UnitPrice, roundedBaht(item.UnitCostSatang), item.UnitCostSatang, item.LineTotal, item.UnitPriceSatang, item.LineTotalSatang, item.Note)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		var balance int
		err = tx.QueryRowContext(r.Context(), `update pos_products set stock_quantity=stock_quantity-$3,updated_at=now() where id=$1 and admin_id=$2 and stock_quantity>=$3 returning stock_quantity`, item.ProductID, user.ID, item.Quantity).Scan(&balance)
		if err == nil {
			lineCostSatang := item.UnitCostSatang * int64(item.Quantity)
			_, err = tx.ExecContext(r.Context(), `insert into pos_stock_movements (admin_id,product_id,sale_id,delta,balance,reason,note,actor_id,actor_type,actor_name,unit_cost_thb,total_cost_thb,previous_cost_thb,resulting_cost_thb,unit_cost_satang,gross_total_satang,net_total_satang,previous_cost_satang,resulting_cost_satang) values ($1,$2,$3,$4,$5,'sale',$6,$7,$8,$9,$10,$11,$10,$10,$12,$13,$13,$12,$12)`, user.ID, item.ProductID, saleID, -item.Quantity, balance, "ขายสินค้า", posActorID(user), posActorType(user), posActorName(user), roundedBaht(item.UnitCostSatang), roundedBaht(lineCostSatang), item.UnitCostSatang, lineCostSatang)
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
	a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), "create_pos_sale", "pos_sale", saleID, map[string]any{"adminId": user.ID, "status": status, "totalSatang": totalSatang, "paymentId": paymentID})
	writeJSON(w, 201, map[string]any{"saleId": saleID, "status": status, "totalThb": roundedBaht(totalSatang), "totalSatang": totalSatang, "paymentId": paymentID, "billingAccountId": accountID})
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
	rows, err := tx.QueryContext(r.Context(), `select product_id,quantity,unit_cost_satang from pos_sale_items where sale_id=$1 and product_id is not null for update`, saleID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	type returned struct {
		id             string
		quantity       int
		unitCostSatang int64
	}
	returns := []returned{}
	for rows.Next() {
		var item returned
		_ = rows.Scan(&item.id, &item.quantity, &item.unitCostSatang)
		returns = append(returns, item)
	}
	rows.Close()
	for _, item := range returns {
		var balance int
		if err = tx.QueryRowContext(r.Context(), `update pos_products set stock_quantity=stock_quantity+$3,updated_at=now() where id=$1 and admin_id=$2 returning stock_quantity`, item.id, user.ID, item.quantity).Scan(&balance); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		lineCostSatang := item.unitCostSatang * int64(item.quantity)
		_, err = tx.ExecContext(r.Context(), `insert into pos_stock_movements (admin_id,product_id,sale_id,delta,balance,reason,note,actor_id,actor_type,actor_name,unit_cost_thb,total_cost_thb,previous_cost_thb,resulting_cost_thb,unit_cost_satang,gross_total_satang,net_total_satang,previous_cost_satang,resulting_cost_satang) values ($1,$2,$3,$4,$5,'void',$6,$7,$8,$9,$10,$11,$10,$10,$12,$13,$13,$12,$12)`, user.ID, item.id, saleID, item.quantity, balance, strings.TrimSpace(b.Note), posActorID(user), posActorType(user), posActorName(user), roundedBaht(item.unitCostSatang), roundedBaht(lineCostSatang), item.unitCostSatang, lineCostSatang)
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
	a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), "void_pos_sale", "pos_sale", saleID, map[string]any{"adminId": user.ID})
	a.writePOSOverview(w, r, user.ID)
}

func (a *app) billingAccountIdentity(ctx context.Context, adminID, accountID string) (string, string, string, error) {
	var memberID, name string
	err := a.db.QueryRowContext(ctx, `select coalesce(member_id,''),display_name from billing_accounts where id=$1 and admin_id=$2 and active`, accountID, adminID).Scan(&memberID, &name)
	return accountID, memberID, name, err
}

func (a *app) posSaleBillingSnapshot(ctx context.Context, adminID, saleID string) json.RawMessage {
	var sale struct {
		ID               string `json:"saleId"`
		BuyerName        string `json:"buyerName"`
		SubtotalSatang   int64  `json:"subtotalSatang"`
		DiscountSatang   int64  `json:"discountSatang"`
		VATSatang        int64  `json:"vatSatang"`
		TotalSatang      int64  `json:"totalSatang"`
		PricesIncludeTax bool   `json:"pricesIncludeTax"`
		CreatedAt        string `json:"createdAt"`
		Items            []any  `json:"items"`
	}
	sale.Items = []any{}
	if a.db.QueryRowContext(ctx, `select id,buyer_name,subtotal_satang,discount_satang,vat_satang,total_satang,prices_include_tax,to_char(created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') from pos_sales where id=$1 and admin_id=$2`, saleID, adminID).Scan(&sale.ID, &sale.BuyerName, &sale.SubtotalSatang, &sale.DiscountSatang, &sale.VATSatang, &sale.TotalSatang, &sale.PricesIncludeTax, &sale.CreatedAt) != nil {
		return json.RawMessage(`{}`)
	}
	rows, err := a.db.QueryContext(ctx, `select product_name,sku,quantity,unit_price_satang,line_total_satang,note from pos_sale_items where sale_id=$1 order by id`, saleID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var name, sku, note string
			var quantity int
			var unitPrice, lineTotal int64
			if rows.Scan(&name, &sku, &quantity, &unitPrice, &lineTotal, &note) == nil {
				sale.Items = append(sale.Items, map[string]any{"name": name, "sku": sku, "quantity": quantity, "unitPriceSatang": unitPrice, "amountSatang": lineTotal, "note": note})
			}
		}
	}
	raw, _ := json.Marshal(sale)
	return raw
}

func billingLinePaymentLabel(line billingLine) (string, string) {
	if line.SourceType != "pos" || len(line.Snapshot) == 0 {
		return line.Label, ""
	}
	var snapshot struct {
		Items []struct {
			Name        string `json:"name"`
			ProductName string `json:"productName"`
		} `json:"items"`
	}
	if json.Unmarshal(line.Snapshot, &snapshot) != nil {
		return line.Label, ""
	}
	names := make([]string, 0, len(snapshot.Items))
	seen := map[string]bool{}
	for _, item := range snapshot.Items {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			name = strings.TrimSpace(item.ProductName)
		}
		if name != "" && !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
	}
	if len(names) == 0 {
		return line.Label, ""
	}
	return "สินค้า · " + strings.Join(names, ", "), "เลขที่ " + line.SourceID
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
					detail := playerPaymentSummary(state, player)
					snapshot, _ := json.Marshal(map[string]any{"sessionId": sessionID, "sessionName": sessionName, "playerId": playerID, "playerName": player.Name, "items": detail.Items, "matchHistory": detail.MatchHistory, "amountSatang": detail.TotalSatang})
					result.MatchTotalSatang += detail.TotalSatang
					result.Lines = append(result.Lines, billingLine{SourceType: "match", SourceID: fmt.Sprintf("%s:%d", sessionID, playerID), Label: "ค่าแข่งขัน · " + sessionName, AmountTHB: roundedBaht(detail.TotalSatang), AmountSatang: detail.TotalSatang, Snapshot: snapshot})
				}
			}
		}
		rows.Close()
	}
	if includePOS && result.POSEnabled {
		rows, queryErr := a.db.QueryContext(ctx, `select id,total_thb,total_satang from pos_sales where admin_id=$1 and billing_account_id=$2 and status='open' order by created_at`, adminID, accountID)
		if queryErr != nil {
			return result, queryErr
		}
		for rows.Next() {
			var id string
			var amount int
			var amountSatang int64
			if err = rows.Scan(&id, &amount, &amountSatang); err != nil {
				rows.Close()
				return result, err
			}
			result.POSTotalSatang += amountSatang
			result.Lines = append(result.Lines, billingLine{SourceType: "pos", SourceID: id, Label: "สินค้า · " + id, AmountTHB: amount, AmountSatang: amountSatang, Snapshot: a.posSaleBillingSnapshot(ctx, adminID, id)})
		}
		rows.Close()
	}
	result.TotalSatang = result.MatchTotalSatang + result.POSTotalSatang
	result.MatchTotalTHB = roundedBaht(result.MatchTotalSatang)
	result.POSTotalTHB = roundedBaht(result.POSTotalSatang)
	result.TotalTHB = roundedBaht(result.TotalSatang)
	if result.TotalSatang > 0 && includePOS && result.POSEnabled {
		settings, _ := a.ensurePOSSettings(ctx, adminID)
		effective, _ := a.effectivePOSPromptPay(ctx, adminID, settings)
		result.ReceiverName = effective.ReceiverName
		result.PromptPayPayload, _ = promptPayPayloadSatang(effective, result.TotalSatang)
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

func (a *app) writePOSReceivables(w http.ResponseWriter, r *http.Request, adminID string) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	filter := `ba.admin_id=$1 and ba.kind='member' and ba.active and m.active and m.deleted_at is null and ($2='' or ba.display_name ilike '%%'||$2||'%%' or m.phone ilike '%%'||$2||'%%') and (exists(select 1 from pos_sales ps where ps.billing_account_id=ba.id and ps.status='open') or exists(select 1 from players p join sessions s on s.id=p.session_id where s.admin_id=ba.admin_id and p.active and not p.paid and (p.billing_account_id=ba.id or p.member_id=ba.member_id)))`
	var total int
	if err := a.db.QueryRowContext(r.Context(), `select count(*) from billing_accounts ba join members m on m.id=ba.member_id where `+filter, adminID, search).Scan(&total); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	rows, err := a.db.QueryContext(r.Context(), `select ba.id,ba.member_id,ba.display_name,m.phone from billing_accounts ba join members m on m.id=ba.member_id where `+filter+` order by lower(ba.display_name),ba.id limit $3 offset $4`, adminID, search, pageSize, (page-1)*pageSize)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	items := []billingReceivable{}
	for rows.Next() {
		var item billingReceivable
		if err = rows.Scan(&item.BillingAccountID, &item.MemberID, &item.DisplayName, &item.Phone); err != nil {
			break
		}
		summary, summaryErr := a.billingSummaryForAccount(r.Context(), adminID, item.BillingAccountID, true)
		if summaryErr != nil || summary.TotalSatang <= 0 {
			continue
		}
		item.MatchTotalSatang, item.POSTotalSatang, item.TotalSatang = summary.MatchTotalSatang, summary.POSTotalSatang, summary.TotalSatang
		item.Lines, item.LineCount, item.CalculatedAt = summary.Lines, len(summary.Lines), summary.CalculatedAt
		items = append(items, item)
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	totalPages := (total + pageSize - 1) / pageSize
	if totalPages == 0 {
		totalPages = 1
	}
	writeJSON(w, 200, map[string]any{"items": items, "page": page, "pageSize": pageSize, "total": total, "totalPages": totalPages, "calculatedAt": time.Now().UTC()})
}

func (a *app) listBillingPaymentHistory(ctx context.Context, adminID, sessionID string, page, pageSize int) ([]billingPaymentHistory, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}
	filter := `bp.admin_id=$1 and bp.status='paid' and ($2='' or exists(select 1 from players sp where sp.session_id=$2 and sp.member_id=ba.member_id))`
	var total int
	if err := a.db.QueryRowContext(ctx, `select count(*) from billing_payments bp left join billing_accounts ba on ba.id=bp.billing_account_id where `+filter, adminID, sessionID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := a.db.QueryContext(ctx, `select bp.id,coalesce(bp.billing_account_id,''),coalesce(ba.member_id,''),coalesce(ba.display_name,'ลูกค้าหน้าร้าน'),bp.origin_system,bp.method,bp.amount_satang,bp.cash_received_satang,bp.change_satang,bp.reference_number,bp.received_by_type,bp.received_by_name,to_char(bp.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),coalesce(sum(a.amount_satang) filter(where a.source_type='match'),0),coalesce(sum(a.amount_satang) filter(where a.source_type='pos'),0) from billing_payments bp left join billing_accounts ba on ba.id=bp.billing_account_id left join billing_payment_allocations a on a.payment_id=bp.id where `+filter+` group by bp.id,ba.member_id,ba.display_name order by bp.created_at desc,bp.id desc limit $3 offset $4`, adminID, sessionID, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := []billingPaymentHistory{}
	for rows.Next() {
		var item billingPaymentHistory
		if err = rows.Scan(&item.PaymentID, &item.BillingAccountID, &item.MemberID, &item.DisplayName, &item.OriginSystem, &item.Method, &item.AmountSatang, &item.CashReceivedSatang, &item.ChangeSatang, &item.ReferenceNumber, &item.ReceivedByType, &item.ReceivedByName, &item.CreatedAt, &item.MatchTotalSatang, &item.POSTotalSatang); err != nil {
			return nil, 0, err
		}
		item.Lines = []billingLine{}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return nil, 0, err
	}
	for index := range items {
		lineRows, lineErr := a.db.QueryContext(ctx, `select source_type,source_id,label,amount_thb,amount_satang,snapshot from billing_payment_allocations where payment_id=$1 order by id`, items[index].PaymentID)
		if lineErr != nil {
			return nil, 0, lineErr
		}
		for lineRows.Next() {
			var line billingLine
			var snapshot []byte
			if lineRows.Scan(&line.SourceType, &line.SourceID, &line.Label, &line.AmountTHB, &line.AmountSatang, &snapshot) == nil {
				line.Snapshot = json.RawMessage(snapshot)
				items[index].Lines = append(items[index].Lines, line)
			}
		}
		lineRows.Close()
	}
	return items, total, nil
}

func (a *app) writePOSPaymentHistory(w http.ResponseWriter, r *http.Request, adminID string) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	items, total, err := a.listBillingPaymentHistory(r.Context(), adminID, "", page, pageSize)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}
	writeJSON(w, 200, map[string]any{"items": items, "page": page, "pageSize": pageSize, "total": total, "totalPages": max(1, (total+pageSize-1)/pageSize)})
}

func (a *app) sessionPaymentHistory(ctx context.Context, state SessionState) ([]map[string]any, error) {
	var adminID string
	if err := a.db.QueryRowContext(ctx, `select coalesce(admin_id,'') from sessions where id=$1`, state.Session.ID).Scan(&adminID); err != nil {
		return nil, err
	}
	payments, _, err := a.listBillingPaymentHistory(ctx, adminID, state.Session.ID, 1, 100)
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for _, payment := range payments {
		items = append(items, map[string]any{"id": payment.PaymentID, "paymentId": payment.PaymentID, "playerName": payment.DisplayName, "paid": true, "amount": thbFromSatang(payment.AmountSatang), "amountThb": thbFromSatang(payment.AmountSatang), "amountSatang": payment.AmountSatang, "matchTotalSatang": payment.MatchTotalSatang, "posTotalSatang": payment.POSTotalSatang, "paymentMethod": payment.Method, "originSystem": payment.OriginSystem, "receivedByName": payment.ReceivedByName, "createdAt": payment.CreatedAt, "lines": payment.Lines})
	}
	rows, err := a.db.QueryContext(ctx, `select e.id,e.player_id,coalesce(p.name,''),e.paid,e.amount_satang,e.payment_method,to_char(e.created_at at time zone 'Asia/Bangkok','DD/MM/YYYY HH24:MI') from player_payment_events e left join players p on p.session_id=e.session_id and p.id=e.player_id where e.session_id=$1 and e.billing_payment_id is null order by e.created_at desc,e.id desc`, state.Session.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, amountSatang int64
		var playerID int
		var name, method, createdAt string
		var paid bool
		if err = rows.Scan(&id, &playerID, &name, &paid, &amountSatang, &method, &createdAt); err != nil {
			return nil, err
		}
		if name == "" {
			name = fmt.Sprintf("ผู้เล่น #%d", playerID)
		}
		items = append(items, map[string]any{"id": fmt.Sprintf("legacy-%d", id), "playerId": playerID, "playerName": name, "paid": paid, "amount": thbFromSatang(amountSatang), "amountThb": thbFromSatang(amountSatang), "amountSatang": amountSatang, "paymentMethod": method, "originSystem": "match", "createdAt": createdAt, "lines": []billingLine{}})
	}
	return items, rows.Err()
}

func (a *app) writeSessionPaymentEvents(w http.ResponseWriter, r *http.Request, state SessionState) {
	items, err := a.sessionPaymentHistory(r.Context(), state)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	if r.URL.Query().Get("all") == "1" || r.URL.Query().Get("all") == "true" {
		writeJSON(w, 200, map[string]any{"items": items, "total": len(items), "page": 1, "pageSize": len(items)})
		return
	}
	paged, page, pageSize := paginate(items, r)
	writeJSON(w, 200, map[string]any{"items": paged, "total": len(items), "page": page, "pageSize": pageSize})
}

func (a *app) writeSessionBillingSync(w http.ResponseWriter, r *http.Request, state SessionState) {
	var adminID string
	if err := a.db.QueryRowContext(r.Context(), `select coalesce(admin_id,'') from sessions where id=$1`, state.Session.ID).Scan(&adminID); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	players := []map[string]any{}
	for _, player := range state.Players {
		if !player.Active || player.MemberID == "" || player.BillingAccountID == "" {
			continue
		}
		summary, err := a.billingSummaryForAccount(r.Context(), adminID, player.BillingAccountID, true)
		if err != nil {
			continue
		}
		players = append(players, map[string]any{"playerId": player.ID, "memberId": player.MemberID, "billingAccountId": player.BillingAccountID, "paid": player.Paid, "matchTotalSatang": summary.MatchTotalSatang, "posTotalSatang": summary.POSTotalSatang, "totalSatang": summary.TotalSatang, "calculatedAt": summary.CalculatedAt})
	}
	history, _ := a.sessionPaymentHistory(r.Context(), state)
	writeJSON(w, 200, map[string]any{"players": players, "paymentHistory": history, "serverTime": time.Now().UTC()})
}

func (a *app) settleBillingAccount(ctx context.Context, user adminUser, accountID, method string, expectedTotalSatang, cashReceivedSatang int64, referenceNumber string, includePOS bool, originSystem string) (billingSummary, error) {
	if !validPaymentMethod(method) {
		return billingSummary{}, errors.New("invalid payment method")
	}
	if originSystem != "match" && originSystem != "pos" {
		return billingSummary{}, errors.New("invalid payment origin")
	}
	summary := billingSummary{}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return summary, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended($1,0))`, user.ID+":"+accountID); err != nil {
		return summary, err
	}
	if err = tx.QueryRowContext(ctx, `select id from billing_accounts where id=$1 and admin_id=$2 and active for update`, accountID, user.ID).Scan(&accountID); err != nil {
		return summary, err
	}
	summary, err = a.billingSummaryForAccount(ctx, user.ID, accountID, includePOS)
	if err != nil {
		return summary, err
	}
	if summary.TotalSatang <= 0 {
		return summary, errors.New("ไม่มียอดค้างชำระ")
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
	// Recalculate after all source rows are locked. The total shown by the browser is
	// only an optimistic snapshot; this value is authoritative for the payment.
	summary, err = a.billingSummaryForAccount(ctx, user.ID, accountID, includePOS)
	if err != nil {
		return summary, err
	}
	if expectedTotalSatang > 0 && expectedTotalSatang != summary.TotalSatang {
		return summary, errors.New("ยอดชำระเปลี่ยนแปลง กรุณาตรวจสอบยอดล่าสุด")
	}
	if method == "cash" && cashReceivedSatang < summary.TotalSatang {
		return summary, errors.New("ยอดเงินสดไม่เพียงพอ")
	}
	paymentID := "payment-" + randHex(8)
	settings, _ := a.ensurePOSSettings(ctx, user.ID)
	effective, _ := a.effectivePOSPromptPay(ctx, user.ID, settings)
	changeSatang := int64(0)
	if method == "cash" {
		changeSatang = cashReceivedSatang - summary.TotalSatang
	}
	_, err = tx.ExecContext(ctx, `insert into billing_payments (id,admin_id,billing_account_id,amount_thb,amount_satang,method,received_by,received_by_type,received_by_name,cash_received_satang,change_satang,reference_number,receiver_name,origin_system) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, paymentID, user.ID, accountID, roundedBaht(summary.TotalSatang), summary.TotalSatang, method, posActorID(user), posActorType(user), posActorName(user), cashReceivedSatang, changeSatang, strings.TrimSpace(referenceNumber), effective.ReceiverName, originSystem)
	if err != nil {
		return summary, err
	}
	for _, line := range summary.Lines {
		_, err = tx.ExecContext(ctx, `insert into billing_payment_allocations (payment_id,source_type,source_id,amount_thb,amount_satang,label,snapshot) values ($1,$2,$3,$4,$5,$6,$7)`, paymentID, line.SourceType, line.SourceID, line.AmountTHB, line.AmountSatang, line.Label, []byte(line.Snapshot))
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
				_, err = tx.ExecContext(ctx, `insert into player_payment_events (session_id,player_id,member_id,paid,amount_thb,amount_satang,payment_method,actor_id,billing_payment_id) select $1,$2,p.member_id,true,$3,$4,$5,$6,$7 from players p where p.session_id=$1 and p.id=$2`, parts[0], playerID, line.AmountTHB, line.AmountSatang, method, posActorID(user), paymentID)
			}
		}
		if err != nil {
			return summary, err
		}
	}
	if err = tx.Commit(); err != nil {
		return summary, err
	}
	a.insertActivityLog(ctx, posActorType(user), posActorID(user), "settle_combined_bill", "billing_payment", paymentID, map[string]any{"adminId": user.ID, "amountSatang": summary.TotalSatang, "method": method, "originSystem": originSystem, "matchSatang": summary.MatchTotalSatang, "posSatang": summary.POSTotalSatang})
	return summary, nil
}

func (a *app) handlePOSSettlement(w http.ResponseWriter, r *http.Request, user adminUser) {
	var b struct {
		BillingAccountID    string `json:"billingAccountId"`
		Method              string `json:"method"`
		ExpectedTotal       int    `json:"expectedTotalThb"`
		ExpectedTotalSatang int64  `json:"expectedTotalSatang"`
		CashReceivedSatang  int64  `json:"cashReceivedSatang"`
		ReferenceNumber     string `json:"referenceNumber"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&b) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid settlement"})
		return
	}
	if b.ExpectedTotalSatang == 0 && b.ExpectedTotal > 0 {
		b.ExpectedTotalSatang = int64(b.ExpectedTotal) * 100
	}
	summary, err := a.settleBillingAccount(r.Context(), user, strings.TrimSpace(b.BillingAccountID), strings.TrimSpace(b.Method), b.ExpectedTotalSatang, b.CashReceivedSatang, b.ReferenceNumber, true, "pos")
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error(), "summary": summary})
		return
	}
	writeJSON(w, 200, map[string]any{"status": "paid", "summary": summary})
}

func (a *app) writePOSQR(w http.ResponseWriter, r *http.Request, adminID string) {
	amountSatang, _ := strconv.ParseInt(r.URL.Query().Get("amountSatang"), 10, 64)
	if amountSatang <= 0 {
		amount, _ := strconv.Atoi(r.URL.Query().Get("amount"))
		amountSatang = int64(amount) * 100
	}
	if amountSatang <= 0 {
		writeJSON(w, 400, map[string]string{"error": "invalid amount"})
		return
	}
	settings, err := a.ensurePOSSettings(r.Context(), adminID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	effective, source := a.effectivePOSPromptPay(r.Context(), adminID, settings)
	payload, err := promptPayPayloadSatang(effective, amountSatang)
	if err != nil {
		if settings.PaymentQRImage != "" {
			writeJSON(w, 200, map[string]any{"promptPayPayload": "", "receiverName": effective.ReceiverName, "amountSatang": amountSatang, "source": "image", "fallbackImage": settings.PaymentQRImage})
			return
		}
		writeJSON(w, 409, map[string]string{"error": "ยังไม่ได้ตั้งค่า PromptPay หรือ QR สำหรับ POS"})
		return
	}
	writeJSON(w, 200, map[string]any{"promptPayPayload": payload, "receiverName": effective.ReceiverName, "amountThb": float64(amountSatang) / 100, "amountSatang": amountSatang, "source": source, "fallbackImage": settings.PaymentQRImage})
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
		label, description := billingLinePaymentLabel(line)
		items = append(items, paymentItem(fmt.Sprintf("%s-%d", line.SourceType, index), label, description, 1, line.AmountSatang, line.AmountSatang))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"playerId": player.ID, "playerName": player.Name, "sessionType": state.Session.Type,
		"paid": player.Paid, "items": items, "totalThb": thbFromSatang(summary.TotalSatang), "totalSatang": summary.TotalSatang, "matchTotalThb": thbFromSatang(summary.MatchTotalSatang), "matchTotalSatang": summary.MatchTotalSatang,
		"posTotalThb": thbFromSatang(summary.POSTotalSatang), "posTotalSatang": summary.POSTotalSatang, "billingAccountId": accountID, "posEnabled": true,
		"promptPayPayload": summary.PromptPayPayload, "receiverName": summary.ReceiverName, "calculatedAt": summary.CalculatedAt,
		"matchHistory": base.MatchHistory, "matchBreakdownItems": base.Items,
	})
}

func (a *app) settlePlayerCombinedBill(w http.ResponseWriter, r *http.Request, state SessionState, player Player) {
	user, ok := a.currentAdmin(r.Context(), r)
	if !ok {
		writeAuthFailure(w, r, adminSessionKind)
		return
	}
	var b struct {
		Method              string `json:"method"`
		ExpectedTotal       int    `json:"expectedTotalThb"`
		ExpectedTotalSatang int64  `json:"expectedTotalSatang"`
		CashReceivedSatang  int64  `json:"cashReceivedSatang"`
		ReferenceNumber     string `json:"referenceNumber"`
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
	if b.ExpectedTotalSatang == 0 {
		b.ExpectedTotalSatang = int64(b.ExpectedTotal) * 100
	}
	if b.Method == "cash" && b.CashReceivedSatang == 0 {
		b.CashReceivedSatang = b.ExpectedTotalSatang
	}
	summary, err := a.settleBillingAccount(r.Context(), user, accountID, strings.TrimSpace(b.Method), b.ExpectedTotalSatang, b.CashReceivedSatang, b.ReferenceNumber, true, "match")
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
