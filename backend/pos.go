package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/mail"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

type posCostFilteringWriter struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
	path   string
}

func (w *posCostFilteringWriter) WriteHeader(status int)         { w.status = status }
func (w *posCostFilteringWriter) Write(body []byte) (int, error) { return w.body.Write(body) }

func redactPOSCostFields(value any, hideProcurementTotals bool) {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			lower := strings.ToLower(key)
			sensitive := strings.Contains(lower, "cost") || strings.Contains(lower, "profit") || strings.Contains(lower, "margin")
			if hideProcurementTotals && (lower == "grosstotalsatang" || lower == "discountsatang" || lower == "allocateddiscountsatang" || lower == "nettotalsatang") {
				sensitive = true
			}
			if sensitive {
				delete(typed, key)
				continue
			}
			redactPOSCostFields(child, hideProcurementTotals)
		}
	case []any:
		for _, child := range typed {
			redactPOSCostFields(child, hideProcurementTotals)
		}
	}
}

func (w *posCostFilteringWriter) flush() {
	status := w.status
	if status == 0 {
		status = http.StatusOK
	}
	body := w.body.Bytes()
	if status >= 200 && status < 300 && strings.Contains(w.Header().Get("Content-Type"), "application/json") {
		var payload any
		if json.Unmarshal(body, &payload) == nil {
			hideProcurement := strings.HasPrefix(w.path, "stock/") || w.path == "reports/purchases"
			redactPOSCostFields(payload, hideProcurement)
			if encoded, err := json.Marshal(payload); err == nil {
				body = encoded
			}
		}
	}
	w.ResponseWriter.WriteHeader(status)
	_, _ = w.ResponseWriter.Write(body)
}

type posSettingsRecord struct {
	PromptPayType               string `json:"promptPayType"`
	PromptPayID                 string `json:"promptPayId"`
	PromptPayReceiverName       string `json:"promptPayReceiverName"`
	ReceiptHeader               string `json:"receiptHeader"`
	ReceiptFooter               string `json:"receiptFooter"`
	LogoData                    string `json:"logoData,omitempty"`
	DefaultLowStock             int    `json:"defaultLowStock"`
	Theme                       string `json:"theme"`
	Language                    string `json:"language"`
	TaxRatePercent              int    `json:"taxRatePercent"`
	PricesIncludeTax            bool   `json:"pricesIncludeTax"`
	InheritBookingPromptPay     bool   `json:"inheritBookingPromptPay"`
	PaymentQRImage              string `json:"paymentQrImage,omitempty"`
	StoreTaxID                  string `json:"storeTaxId"`
	StorePhone                  string `json:"storePhone"`
	StoreEmail                  string `json:"storeEmail"`
	StoreAddress                string `json:"storeAddress"`
	NavbarTitle                 string `json:"navbarTitle"`
	NavbarIconData              string `json:"navbarIconData,omitempty"`
	CustomerDisplayTitle        string `json:"customerDisplayTitle"`
	CustomerDisplayHighlight    string `json:"customerDisplayHighlight"`
	CustomerDisplaySubtitle     string `json:"customerDisplaySubtitle"`
	CustomerDisplayCardText     string `json:"customerDisplayCardText"`
	CustomerDisplayCTAText      string `json:"customerDisplayCtaText"`
	SecondaryStockEnabled       bool   `json:"secondaryStockEnabled"`
	PrimaryStockName            string `json:"primaryStockName"`
	SecondaryStockName          string `json:"secondaryStockName"`
	SaleStockLocation           string `json:"saleStockLocation"`
	EffectivePromptPayType      string `json:"effectivePromptPayType,omitempty"`
	EffectiveReceiverName       string `json:"effectivePromptPayReceiverName,omitempty"`
	EffectivePromptPayMask      string `json:"effectivePromptPayIdMasked,omitempty"`
	EffectivePromptPaySource    string `json:"effectivePromptPaySource,omitempty"`
	EffectivePromptPayAvailable bool   `json:"effectivePromptPayAvailable"`
}

func posSettingsAuditSnapshot(value posSettingsRecord) map[string]any {
	return map[string]any{
		"receiptHeader": value.ReceiptHeader, "receiptFooter": value.ReceiptFooter,
		"defaultLowStock": value.DefaultLowStock, "theme": value.Theme, "language": value.Language,
		"taxRatePercent": value.TaxRatePercent, "pricesIncludeTax": value.PricesIncludeTax,
		"inheritBookingPromptPay": value.InheritBookingPromptPay, "promptPayType": value.PromptPayType,
		"hasPromptPay": value.PromptPayID != "", "hasPaymentQR": value.PaymentQRImage != "",
		"hasLogo": value.LogoData != "", "hasNavbarIcon": value.NavbarIconData != "",
		"hasTaxId": value.StoreTaxID != "", "hasPhone": value.StorePhone != "",
		"hasEmail": value.StoreEmail != "", "hasAddress": value.StoreAddress != "",
		"navbarTitle": value.NavbarTitle, "customerDisplayTitle": value.CustomerDisplayTitle,
		"customerDisplayHighlight": value.CustomerDisplayHighlight,
		"secondaryStockEnabled":    value.SecondaryStockEnabled, "primaryStockName": value.PrimaryStockName,
		"secondaryStockName": value.SecondaryStockName, "saleStockLocation": value.SaleStockLocation,
	}
}

func posProductAuditSnapshot(value posProductRecord) map[string]any {
	return map[string]any{"sku": value.SKU, "name": value.Name, "category": value.Category, "unit": value.Unit, "unitsPerPack": value.UnitsPerPack, "priceSatang": value.PriceSatang, "costSatang": value.CostSatang, "stockQuantity": value.StockQuantity, "secondaryStockQuantity": value.SecondaryStockQuantity, "trackStock": value.TrackStock, "lowStockThreshold": value.LowStockThreshold, "active": value.Active, "popular": value.Popular, "hasImage": value.ImageData != "", "hasBarcode": value.Barcode != ""}
}

type posProductRecord struct {
	ID                     string `json:"id"`
	SKU                    string `json:"sku"`
	Category               string `json:"category"`
	Name                   string `json:"name"`
	PriceTHB               int    `json:"priceThb"`
	PriceSatang            int64  `json:"priceSatang"`
	CostTHB                int    `json:"costThb"`
	CostSatang             int64  `json:"costSatang"`
	StockQuantity          int    `json:"stockQuantity"`
	SecondaryStockQuantity int    `json:"secondaryStockQuantity"`
	TotalStockQuantity     int    `json:"totalStockQuantity"`
	SaleStockQuantity      int    `json:"saleStockQuantity"`
	TrackStock             bool   `json:"trackStock"`
	LowStockThreshold      int    `json:"lowStockThreshold"`
	Active                 bool   `json:"active"`
	LowStock               bool   `json:"lowStock"`
	Unit                   string `json:"unit"`
	UnitsPerPack           int    `json:"unitsPerPack"`
	ImageData              string `json:"imageData,omitempty"`
	Barcode                string `json:"barcode,omitempty"`
	Description            string `json:"description,omitempty"`
	Popular                bool   `json:"popular"`
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
	ID                       string                    `json:"id"`
	Name                     string                    `json:"name"`
	Mode                     string                    `json:"mode"`
	Note                     string                    `json:"note,omitempty"`
	TotalCostTHB             int                       `json:"totalCostThb"`
	SupplierID               string                    `json:"supplierId,omitempty"`
	SupplierName             string                    `json:"supplierName,omitempty"`
	ExternalReferenceNo      string                    `json:"externalReferenceNo,omitempty"`
	DiscountType             string                    `json:"discountType"`
	DiscountRateBPS          int                       `json:"discountRateBps"`
	GrossTotalSatang         int64                     `json:"grossTotalSatang"`
	DiscountSatang           int64                     `json:"discountSatang"`
	NetTotalSatang           int64                     `json:"netTotalSatang"`
	TotalCostSatang          int64                     `json:"totalCostSatang"`
	CreatedAt                string                    `json:"createdAt"`
	ActorID                  string                    `json:"actorId"`
	ActorType                string                    `json:"actorType"`
	ActorName                string                    `json:"actorName"`
	StockLocation            string                    `json:"stockLocation"`
	SourceStockLocation      string                    `json:"sourceStockLocation,omitempty"`
	DestinationStockLocation string                    `json:"destinationStockLocation,omitempty"`
	Items                    []posStockBatchItemRecord `json:"items"`
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
	StockTracked    bool   `json:"stockTracked"`
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
	StockLocation      string              `json:"stockLocation"`
	SplitMode          string              `json:"splitMode"`
	SplitCount         int                 `json:"splitCount"`
}

func validStockLocation(value string) bool { return value == "primary" || value == "secondary" }

func productStockAt(p posProductRecord, location string) int {
	if location == "secondary" {
		return p.SecondaryStockQuantity
	}
	return p.StockQuantity
}

func applyProductStockFields(p *posProductRecord, saleLocation string) {
	p.TotalStockQuantity = p.StockQuantity + p.SecondaryStockQuantity
	p.SaleStockQuantity = productStockAt(*p, saleLocation)
	p.LowStock = p.TrackStock && p.SaleStockQuantity <= p.LowStockThreshold
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
	PaymentID        string        `json:"paymentId,omitempty"`
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
	MemberName       string        `json:"memberName,omitempty"`
	MatchDisplayName string        `json:"matchDisplayName,omitempty"`
	SearchAliases    []string      `json:"searchAliases,omitempty"`
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
	err := a.db.QueryRowContext(ctx, `select promptpay_type,promptpay_id,promptpay_receiver_name,receipt_header,receipt_footer,logo_data,default_low_stock,theme,language,tax_rate_percent,prices_include_tax,inherit_booking_promptpay,payment_qr_image,store_tax_id,store_phone,store_email,store_address,navbar_title,navbar_icon_data,customer_display_title,customer_display_highlight,customer_display_subtitle,customer_display_card_text,customer_display_cta_text,secondary_stock_enabled,primary_stock_name,secondary_stock_name,sale_stock_location from pos_settings where admin_id=$1`, adminID).Scan(
		&s.PromptPayType, &s.PromptPayID, &s.PromptPayReceiverName, &s.ReceiptHeader, &s.ReceiptFooter, &s.LogoData, &s.DefaultLowStock, &s.Theme, &s.Language, &s.TaxRatePercent, &s.PricesIncludeTax, &s.InheritBookingPromptPay, &s.PaymentQRImage, &s.StoreTaxID, &s.StorePhone, &s.StoreEmail, &s.StoreAddress, &s.NavbarTitle, &s.NavbarIconData, &s.CustomerDisplayTitle, &s.CustomerDisplayHighlight, &s.CustomerDisplaySubtitle, &s.CustomerDisplayCardText, &s.CustomerDisplayCTAText, &s.SecondaryStockEnabled, &s.PrimaryStockName, &s.SecondaryStockName, &s.SaleStockLocation,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return a.ensurePOSSettings(ctx, adminID)
	}
	if !supportedPromptPayType(s.PromptPayType) {
		s.PromptPayType = "mobile"
		s.PromptPayID = ""
	}
	return s, err
}

func (a *app) effectivePOSPromptPay(ctx context.Context, adminID string, settings posSettingsRecord) (promptPaySettings, string) {
	if !settings.InheritBookingPromptPay {
		return promptPaySettings{ID: settings.PromptPayID, Type: settings.PromptPayType, ReceiverName: settings.PromptPayReceiverName}, "pos"
	}
	var inherited promptPaySettings
	if a.db.QueryRowContext(ctx, `select promptpay_type,promptpay_id,promptpay_receiver_name from booking_settings where admin_id=$1`, adminID).Scan(&inherited.Type, &inherited.ID, &inherited.ReceiverName) == nil && inherited.ID != "" && supportedPromptPayType(inherited.Type) {
		return inherited, "booking"
	}
	return promptPaySettings{ID: settings.PromptPayID, Type: settings.PromptPayType, ReceiverName: settings.PromptPayReceiverName}, "pos"
}

func maskedPromptPayID(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 4 {
		return strings.Repeat("•", len(value))
	}
	return strings.Repeat("•", len(value)-4) + value[len(value)-4:]
}

func (a *app) settingsWithEffectivePromptPay(ctx context.Context, adminID string, settings posSettingsRecord) posSettingsRecord {
	effective, source := a.effectivePOSPromptPay(ctx, adminID, settings)
	settings.EffectivePromptPayType = effective.Type
	settings.EffectiveReceiverName = effective.ReceiverName
	settings.EffectivePromptPayMask = maskedPromptPayID(effective.ID)
	settings.EffectivePromptPaySource = source
	settings.EffectivePromptPayAvailable = strings.TrimSpace(effective.ID) != ""
	return settings
}

func (a *app) handleAdminPOS(w http.ResponseWriter, r *http.Request, user adminUser, action string) {
	w.Header().Set("Cache-Control", "no-store")
	path := strings.Trim(strings.TrimPrefix(action, "pos"), "/")
	if !a.requireFeature(w, r, user.ID, "pos") {
		return
	}
	if !authorizePOSPath(w, user, r.Method, path) {
		return
	}
	if r.Method == http.MethodGet && !hasPOSPermission(user, "view_costs") {
		filtered := &posCostFilteringWriter{ResponseWriter: w, path: path}
		defer filtered.flush()
		w = filtered
	}
	if r.Method == http.MethodGet && (path == "reports" || strings.HasPrefix(path, "reports/")) {
		reportType := r.URL.Query().Get("reportType")
		if reportType == "" {
			switch path {
			case "reports":
				reportType = "overview"
			case "reports/sold-products":
				reportType = "sold_products"
			case "reports/purchases":
				reportType = "purchases"
			case "reports/inventory":
				reportType = "inventory"
			case "reports/transfers":
				reportType = "transfers"
			case "reports/special":
				reportType = "special"
			}
		}
		if reportType != "" && !requirePOSReportPermission(w, user, reportType) {
			return
		}
	}
	switch {
	case r.Method == http.MethodGet && path == "monitoring":
		a.writePOSMonitoring(w, r, user)
	case r.Method == http.MethodGet && path == "access":
		a.writePOSAccessSettings(w, r, user)
	case r.Method == http.MethodGet && path == "access/activity":
		a.writePOSActivity(w, r, user)
	case r.Method == http.MethodPatch && path == "access/owner":
		a.updatePOSOwner(w, r, user)
	case r.Method == http.MethodPost && path == "staff":
		a.createPOSStaff(w, r, user)
	case r.Method == http.MethodPatch && strings.HasPrefix(path, "staff/") && !strings.HasSuffix(path, "/reset-pin"):
		a.updatePOSStaff(w, r, user, strings.TrimPrefix(path, "staff/"))
	case r.Method == http.MethodPost && strings.HasPrefix(path, "staff/") && strings.HasSuffix(path, "/reset-pin"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "staff/"), "/reset-pin")
		a.resetPOSStaffPIN(w, r, user, id)
	case r.Method == http.MethodPost && strings.HasPrefix(path, "staff/") && strings.HasSuffix(path, "/logout"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "staff/"), "/logout")
		a.forceLogoutPOSStaff(w, r, user, id)
	case r.Method == http.MethodPut && path == "permissions":
		a.savePOSPermissions(w, r, user)
	case r.Method == http.MethodGet && (path == "" || path == "overview"):
		a.writePOSOverview(w, r, user.ID)
	case r.Method == http.MethodGet && path == "dashboard":
		a.writePOSDashboard(w, r, user.ID)
	case r.Method == http.MethodGet && path == "reports":
		a.writePOSReports(w, r, user.ID)
	case r.Method == http.MethodGet && path == "reports/sold-products":
		a.writePOSSoldProductsReport(w, r, user.ID)
	case r.Method == http.MethodGet && path == "reports/purchases":
		a.writePOSPurchasesReport(w, r, user.ID)
	case r.Method == http.MethodGet && path == "reports/inventory":
		a.writePOSInventoryReport(w, r, user.ID, hasPOSPermission(user, "report_inventory_values"))
	case r.Method == http.MethodGet && path == "reports/transfers":
		a.writePOSStockTransfersReport(w, r, user.ID)
	case r.Method == http.MethodGet && path == "reports/special":
		a.writePOSSpecialReport(w, r, user.ID)
	case r.Method == http.MethodPost && path == "reports/export-authorize":
		var body struct {
			Operation     string `json:"operation"`
			ReportType    string `json:"reportType"`
			StockLocation string `json:"stockLocation"`
		}
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body)
		if !requirePOSReportPermission(w, user, body.ReportType) {
			return
		}
		action := "export_pos_report"
		if body.Operation == "print" {
			action = "print_pos_report"
		}
		stockLocation := body.StockLocation
		if !validStockLocation(stockLocation) {
			stockLocation = "all"
		}
		a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), action, "pos_report", user.ID, map[string]any{"reportType": body.ReportType, "stockLocation": stockLocation})
		writeJSON(w, http.StatusOK, map[string]bool{"allowed": true})
	case r.Method == http.MethodGet && path == "products":
		a.writePOSProducts(w, r, user.ID)
	case r.Method == http.MethodGet && path == "categories":
		items, err := a.listPOSCategories(r.Context(), user.ID)
		if err != nil {
			writePOSInternalError(w, r, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items})
	case r.Method == http.MethodGet && path == "units":
		items, err := a.listPOSUnits(r.Context(), user.ID)
		if err != nil {
			writePOSInternalError(w, r, err)
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
			writePOSInternalError(w, r, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if hasPOSPermission(user, "settings") {
			writeJSON(w, 200, a.settingsWithEffectivePromptPay(r.Context(), user.ID, settings))
			return
		}
		writeJSON(w, 200, map[string]any{
			"promptPayType": "", "promptPayId": "", "promptPayReceiverName": "",
			"receiptHeader": settings.ReceiptHeader, "receiptFooter": settings.ReceiptFooter,
			"logoData": "", "defaultLowStock": settings.DefaultLowStock,
			"theme": settings.Theme, "language": settings.Language,
			"taxRatePercent": settings.TaxRatePercent, "pricesIncludeTax": settings.PricesIncludeTax,
			"inheritBookingPromptPay": settings.InheritBookingPromptPay, "paymentQrImage": "",
			"storeTaxId": "", "storePhone": "", "storeEmail": "", "storeAddress": "",
			"navbarTitle": settings.NavbarTitle, "navbarIconData": settings.NavbarIconData,
			"customerDisplayTitle": settings.CustomerDisplayTitle, "customerDisplayHighlight": settings.CustomerDisplayHighlight,
			"customerDisplaySubtitle": settings.CustomerDisplaySubtitle, "customerDisplayCardText": settings.CustomerDisplayCardText,
			"customerDisplayCtaText": settings.CustomerDisplayCTAText,
			"secondaryStockEnabled":  settings.SecondaryStockEnabled, "primaryStockName": settings.PrimaryStockName,
			"secondaryStockName": settings.SecondaryStockName, "saleStockLocation": settings.SaleStockLocation,
		})
	case r.Method == http.MethodGet && path == "members":
		a.writePOSMembers(w, r, user.ID)
	case r.Method == http.MethodPost && path == "members":
		a.createPOSMember(w, r, user)
	case r.Method == http.MethodGet && path == "member-types":
		items, err := a.memberTypesForAdmin(r.Context(), user.ID, false)
		if err != nil {
			writePOSInternalError(w, r, err)
			return
		}
		activeItems := make([]MemberType, 0, len(items))
		for _, item := range items {
			if item.Active {
				activeItems = append(activeItems, item)
			}
		}
		writeJSON(w, 200, map[string]any{"items": activeItems})
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
	settings, _ := a.ensurePOSSettings(ctx, adminID)
	rows, err := a.db.QueryContext(ctx, `select id,sku,category,name,price_thb,price_satang,cost_thb,cost_satang,stock_quantity,secondary_stock_quantity,track_stock,low_stock_threshold,active,unit,units_per_pack,image_data,barcode,description,is_popular from pos_products where admin_id=$1 and deleted_at is null order by active desc,is_popular desc,category,name`, adminID)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	for rows.Next() {
		var p posProductRecord
		if err = rows.Scan(&p.ID, &p.SKU, &p.Category, &p.Name, &p.PriceTHB, &p.PriceSatang, &p.CostTHB, &p.CostSatang, &p.StockQuantity, &p.SecondaryStockQuantity, &p.TrackStock, &p.LowStockThreshold, &p.Active, &p.Unit, &p.UnitsPerPack, &p.ImageData, &p.Barcode, &p.Description, &p.Popular); err != nil {
			return items, err
		}
		applyProductStockFields(&p, settings.SaleStockLocation)
		items = append(items, p)
	}
	return items, rows.Err()
}

func (a *app) writePOSProducts(w http.ResponseWriter, r *http.Request, adminID string) {
	settings, _ := a.ensurePOSSettings(r.Context(), adminID)
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
		and ($2='' or id ilike '%%'||$2||'%%' or name ilike '%%'||$2||'%%' or sku ilike '%%'||$2||'%%' or barcode ilike '%%'||$2||'%%')
		and ($3='' or lower(category)=lower($3))
		and ($4='all' or active=($4='active'))`
	if err := a.db.QueryRowContext(r.Context(), `select count(*) from pos_products where `+filter, adminID, search, category, status).Scan(&total); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	items := []posProductRecord{}
	rows, err := a.db.QueryContext(r.Context(), `select id,sku,category,name,price_thb,price_satang,cost_thb,cost_satang,stock_quantity,secondary_stock_quantity,track_stock,low_stock_threshold,active,unit,units_per_pack,image_data,barcode,description,is_popular from pos_products where `+filter+` order by active desc,is_popular desc,lower(name),id limit $5 offset $6`, adminID, search, category, status, pageSize, (page-1)*pageSize)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var p posProductRecord
		if err = rows.Scan(&p.ID, &p.SKU, &p.Category, &p.Name, &p.PriceTHB, &p.PriceSatang, &p.CostTHB, &p.CostSatang, &p.StockQuantity, &p.SecondaryStockQuantity, &p.TrackStock, &p.LowStockThreshold, &p.Active, &p.Unit, &p.UnitsPerPack, &p.ImageData, &p.Barcode, &p.Description, &p.Popular); err != nil {
			writePOSInternalError(w, r, err)
			return
		}
		applyProductStockFields(&p, settings.SaleStockLocation)
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
	rows, err := a.db.QueryContext(ctx, `select s.id,coalesce(s.billing_account_id,''),s.buyer_name,s.status,s.total_thb,s.cost_thb,s.cost_satang,coalesce(s.payment_id,''),s.note,to_char(s.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),s.created_by,s.created_by_type,s.created_by_name,s.subtotal_satang,s.discount_type,s.discount_rate_bps,s.discount_satang,s.net_before_vat_satang,s.vat_rate_bps,s.vat_satang,s.prices_include_tax,s.total_satang,coalesce(bp.method,''),coalesce(bp.cash_received_satang,0),coalesce(bp.change_satang,0),coalesce(bp.reference_number,''),s.stock_location,s.split_mode,s.split_count from pos_sales s left join billing_payments bp on bp.id=s.payment_id where s.admin_id=$1 and ($2='' or $2='all' or s.status=$2) order by s.created_at desc limit $3 offset $4`, adminID, status, limit, offset)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	byID := map[string]int{}
	for rows.Next() {
		var sale posSaleRecord
		sale.Items = []posSaleItemRecord{}
		if err = rows.Scan(&sale.ID, &sale.BillingAccountID, &sale.BuyerName, &sale.Status, &sale.TotalTHB, &sale.CostTHB, &sale.CostSatang, &sale.PaymentID, &sale.Note, &sale.CreatedAt, &sale.CreatedBy, &sale.CreatedByType, &sale.CreatedByName, &sale.SubtotalSatang, &sale.DiscountType, &sale.DiscountRateBPS, &sale.DiscountSatang, &sale.NetBeforeVATSatang, &sale.VATRateBPS, &sale.VATSatang, &sale.PricesIncludeTax, &sale.TotalSatang, &sale.PaymentMethod, &sale.CashReceivedSatang, &sale.ChangeSatang, &sale.ReferenceNumber, &sale.StockLocation, &sale.SplitMode, &sale.SplitCount); err != nil {
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
		writePOSInternalError(w, r, err)
		return
	}
	var total int
	if err = a.db.QueryRowContext(r.Context(), `select count(*) from pos_sales where admin_id=$1 and ($2='' or $2='all' or status=$2)`, adminID, status).Scan(&total); err != nil {
		writePOSInternalError(w, r, err)
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
		writePOSInternalError(w, r, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, name, phone, accountID string
		if err = rows.Scan(&id, &name, &phone, &accountID); err != nil {
			writePOSInternalError(w, r, err)
			return
		}
		items = append(items, map[string]any{"id": id, "name": name, "phone": displayPhone(phone), "billingAccountId": accountID})
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (a *app) createPOSMember(w http.ResponseWriter, r *http.Request, user adminUser) {
	var body struct {
		Name         string `json:"name"`
		Phone        string `json:"phone"`
		MemberTypeID string `json:"memberTypeId"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&body) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ข้อมูลสมาชิกไม่ถูกต้อง"})
		return
	}
	member, err := a.createMember(r.Context(), user.ID, body.Name, body.Phone, body.MemberTypeID, posActorType(user), posActorID(user))
	if err != nil {
		message := err.Error()
		if message == "กรุณากรอกชื่อและเบอร์โทรให้ถูกต้อง" || message == "ประเภทสมาชิกไม่ถูกต้องหรือปิดใช้งานแล้ว" || message == "เบอร์โทรนี้มีอยู่แล้ว" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": message})
			return
		}
		writePOSInternalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": member.ID, "name": member.Name, "phone": member.Phone,
		"billingAccountId": "", "memberTypeId": member.MemberTypeID,
	})
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
	rows, err := a.db.QueryContext(ctx, `select m.id,m.product_id,p.name,p.sku,m.delta,m.balance,m.reason,m.note,coalesce(m.sale_id,''),coalesce(m.batch_id,''),coalesce(b.name,''),coalesce(b.supplier_name,''),coalesce(b.mode,''),m.unit_cost_satang,m.gross_total_satang,m.allocated_discount_satang,m.net_total_satang,m.previous_cost_satang,m.resulting_cost_satang,to_char(m.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),m.actor_id,m.actor_type,m.actor_name,m.stock_location from pos_stock_movements m join pos_products p on p.id=m.product_id left join pos_stock_batches b on b.id=m.batch_id where m.admin_id=$1 order by m.created_at desc,m.id desc limit $2`, adminID, limit)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var productID, productName, sku, reason, note, saleID, batchID, referenceNo, supplierName, batchMode, createdAt, actorID, actorType, actorName, stockLocation string
		var delta, balance int
		var unitCostSatang, grossTotalSatang, allocatedDiscountSatang, netTotalSatang, previousCostSatang, resultingCostSatang int64
		if err = rows.Scan(&id, &productID, &productName, &sku, &delta, &balance, &reason, &note, &saleID, &batchID, &referenceNo, &supplierName, &batchMode, &unitCostSatang, &grossTotalSatang, &allocatedDiscountSatang, &netTotalSatang, &previousCostSatang, &resultingCostSatang, &createdAt, &actorID, &actorType, &actorName, &stockLocation); err != nil {
			return items, err
		}
		movementType := batchMode
		if movementType == "" && (reason == "restock" || reason == "void") {
			movementType = "in"
		} else if movementType == "" && reason == "sale" {
			movementType = "out"
		} else if movementType == "" {
			movementType = "adjust"
		}
		items = append(items, map[string]any{"id": id, "referenceNo": referenceNo, "batchId": batchID, "productId": productID, "productName": productName, "productSku": sku, "type": movementType, "quantity": delta, "beforeStock": balance - delta, "afterStock": balance, "delta": delta, "balance": balance, "reason": reason, "note": note, "supplierName": supplierName, "saleId": saleID, "stockLocation": stockLocation, "unitCostSatang": unitCostSatang, "grossTotalSatang": grossTotalSatang, "allocatedDiscountSatang": allocatedDiscountSatang, "netTotalSatang": netTotalSatang, "previousCostSatang": previousCostSatang, "resultingCostSatang": resultingCostSatang, "createdAt": createdAt, "actorId": actorID, "actorType": actorType, "actorName": actorName})
	}
	return items, rows.Err()
}

func (a *app) listPOSStockBatches(ctx context.Context, adminID string, limit int) ([]posStockBatchRecord, error) {
	if limit < 1 || limit > 200 {
		limit = 100
	}
	items := []posStockBatchRecord{}
	rows, err := a.db.QueryContext(ctx, `select id,name,mode,note,total_cost_thb,coalesce(supplier_id,''),supplier_name,external_reference_no,discount_type,discount_rate_bps,gross_total_satang,discount_satang,net_total_satang,total_cost_satang,to_char(created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),actor_id,actor_type,actor_name,stock_location,coalesce(source_stock_location,''),coalesce(destination_stock_location,'') from pos_stock_batches where admin_id=$1 order by created_at desc,id desc limit $2`, adminID, limit)
	if err != nil {
		return items, err
	}
	defer rows.Close()
	for rows.Next() {
		var item posStockBatchRecord
		if err = rows.Scan(&item.ID, &item.Name, &item.Mode, &item.Note, &item.TotalCostTHB, &item.SupplierID, &item.SupplierName, &item.ExternalReferenceNo, &item.DiscountType, &item.DiscountRateBPS, &item.GrossTotalSatang, &item.DiscountSatang, &item.NetTotalSatang, &item.TotalCostSatang, &item.CreatedAt, &item.ActorID, &item.ActorType, &item.ActorName, &item.StockLocation, &item.SourceStockLocation, &item.DestinationStockLocation); err != nil {
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
			if item.Mode == "transfer" && movement.Delta < 0 {
				continue
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
		writePOSInternalError(w, r, err)
		return
	}
	location := strings.TrimSpace(r.URL.Query().Get("stockLocation"))
	if validStockLocation(location) {
		filtered := items[:0]
		for _, item := range items {
			if item.StockLocation == location || item.SourceStockLocation == location || item.DestinationStockLocation == location {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (a *app) writePOSStockMovements(w http.ResponseWriter, r *http.Request, adminID string) {
	items, err := a.listPOSStockMovements(r.Context(), adminID, stockListLimit(r))
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	location := strings.TrimSpace(r.URL.Query().Get("stockLocation"))
	if validStockLocation(location) {
		filtered := items[:0]
		for _, item := range items {
			if item["stockLocation"] == location {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (a *app) writePOSStockSummary(w http.ResponseWriter, r *http.Request, adminID string) {
	var productCount, totalUnits, lowStockCount, outOfStockCount, batchCount, movementCount int
	var inventoryCostSatang, inventoryRetailSatang int64
	location := r.URL.Query().Get("stockLocation")
	if !validStockLocation(location) {
		settings, _ := a.ensurePOSSettings(r.Context(), adminID)
		location = settings.SaleStockLocation
	}
	stockExpression := "stock_quantity"
	if location == "secondary" {
		stockExpression = "secondary_stock_quantity"
	}
	err := a.db.QueryRowContext(r.Context(), `select count(*),coalesce(sum(`+stockExpression+`),0),coalesce(sum(`+stockExpression+`*cost_satang),0),coalesce(sum(`+stockExpression+`*price_satang),0),count(*) filter (where `+stockExpression+`>0 and `+stockExpression+`<=low_stock_threshold),count(*) filter (where `+stockExpression+`<=0) from pos_products where admin_id=$1 and deleted_at is null and track_stock`, adminID).Scan(&productCount, &totalUnits, &inventoryCostSatang, &inventoryRetailSatang, &lowStockCount, &outOfStockCount)
	if err == nil {
		err = a.db.QueryRowContext(r.Context(), `select (select count(*) from pos_stock_batches where admin_id=$1),(select count(*) from pos_stock_movements where admin_id=$1)`, adminID).Scan(&batchCount, &movementCount)
	}
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"productCount": productCount, "totalUnits": totalUnits, "inventoryCostSatang": inventoryCostSatang, "inventoryRetailSatang": inventoryRetailSatang, "lowStockCount": lowStockCount, "outOfStockCount": outOfStockCount, "batchCount": batchCount, "movementCount": movementCount})
}

func (a *app) posReport(ctx context.Context, adminID string) (map[string]any, error) {
	result := map[string]any{"salesThb": 0, "costThb": 0, "grossProfitThb": 0, "costSatang": int64(0), "grossProfitSatang": int64(0), "cashThb": 0, "promptPayThb": 0, "outstandingThb": 0, "lowStockCount": 0}
	var sales, cash, promptpay, outstanding, low int
	var costSatang int64
	settings, _ := a.ensurePOSSettings(ctx, adminID)
	stockExpression := "stock_quantity"
	if settings.SaleStockLocation == "secondary" && settings.SecondaryStockEnabled {
		stockExpression = "secondary_stock_quantity"
	}
	err := a.db.QueryRowContext(ctx, `
		select
			coalesce(sum(s.total_thb) filter (where s.status='paid' and s.created_at >= date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'),0),
			coalesce(sum(s.cost_satang) filter (where s.status='paid' and s.created_at >= date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'),0),
			coalesce((select sum(amount_thb) from billing_payments where admin_id=$1 and status='paid' and method='cash' and created_at >= date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'),0),
			coalesce((select sum(amount_thb) from billing_payments where admin_id=$1 and status='paid' and method='promptpay' and created_at >= date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'),0),
			coalesce((select sum(total_thb) from pos_sales where admin_id=$1 and status='open'),0),
			(select count(*) from pos_products where admin_id=$1 and active and track_stock and `+stockExpression+`<=low_stock_threshold)
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
		writePOSInternalError(w, r, err)
		return
	}
	products, err := a.listPOSProducts(r.Context(), adminID)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	sales, err := a.listPOSSales(r.Context(), adminID, "", 100, 0)
	if err != nil {
		writePOSInternalError(w, r, err)
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

func (a *app) writePOSDashboard(w http.ResponseWriter, r *http.Request, adminID string) {
	settings, _ := a.ensurePOSSettings(r.Context(), adminID)
	stockExpression := "stock_quantity"
	if settings.SaleStockLocation == "secondary" && settings.SecondaryStockEnabled {
		stockExpression = "secondary_stock_quantity"
	}
	rangeKey := strings.TrimSpace(r.URL.Query().Get("range"))
	days := 1
	if rangeKey == "1w" {
		days = 7
	} else if rangeKey == "1m" {
		days = 30
	} else {
		rangeKey = "1d"
	}
	location, err := time.LoadLocation("Asia/Bangkok")
	if err != nil {
		location = time.FixedZone("Asia/Bangkok", 7*60*60)
	}
	now := time.Now().In(location)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, location)
	start := today.AddDate(0, 0, -(days - 1))
	end := now
	previousStart := start.AddDate(0, 0, -days)
	previousEnd := previousStart.Add(end.Sub(start))

	var salesSatang, previousSalesSatang, costSatang int64
	var completedBills int
	err = a.db.QueryRowContext(r.Context(), `
		with scoped as (
			select s.total_satang,s.cost_satang,coalesce(bp.created_at,s.updated_at,s.created_at) paid_at
			from pos_sales s left join billing_payments bp on bp.id=s.payment_id
			where s.admin_id=$1 and s.status='paid'
		)
		select coalesce(sum(total_satang) filter(where paid_at >= $2 and paid_at <= $3),0),
			coalesce(sum(cost_satang) filter(where paid_at >= $2 and paid_at <= $3),0),
			count(*) filter(where paid_at >= $2 and paid_at <= $3),
			coalesce(sum(total_satang) filter(where paid_at >= $4 and paid_at < $5),0)
		from scoped`, adminID, start, end, previousStart, previousEnd).Scan(&salesSatang, &costSatang, &completedBills, &previousSalesSatang)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}

	var heldCount, lowStockCount int
	err = a.db.QueryRowContext(r.Context(), `
		select
			(select count(*) from billing_accounts ba join members m on m.id=ba.member_id
			 where ba.admin_id=$1 and ba.kind='member' and ba.active and m.active and m.deleted_at is null
			 and (exists(select 1 from pos_sales ps where ps.billing_account_id=ba.id and ps.status='open')
			 or exists(select 1 from players p join sessions s on s.id=p.session_id where s.admin_id=ba.admin_id and p.active and not p.paid and (p.billing_account_id=ba.id or p.member_id=ba.member_id)))),
			(select count(*) from pos_products where admin_id=$1 and active and track_stock and deleted_at is null and `+stockExpression+`<=low_stock_threshold)`, adminID).Scan(&heldCount, &lowStockCount)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}

	lowStockItems := []map[string]any{}
	rows, err := a.db.QueryContext(r.Context(), `select id,name,sku,`+stockExpression+`,low_stock_threshold,unit,image_data from pos_products where admin_id=$1 and active and track_stock and deleted_at is null and `+stockExpression+`<=low_stock_threshold order by `+stockExpression+`,lower(name) limit 20`, adminID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, name, sku, unit, imageData string
			var stock, threshold int
			if rows.Scan(&id, &name, &sku, &stock, &threshold, &unit, &imageData) == nil {
				lowStockItems = append(lowStockItems, map[string]any{"id": id, "name": name, "sku": sku, "stock": stock, "lowStockThreshold": threshold, "unit": unit, "imageData": imageData})
			}
		}
	}

	timelineCount, bucketHours := days, 24
	if days == 1 {
		timelineCount, bucketHours = 12, 2
	}
	timelineValues := make([]int64, timelineCount)
	timelineRows, queryErr := a.db.QueryContext(r.Context(), `select coalesce(bp.created_at,s.updated_at,s.created_at),s.total_satang from pos_sales s left join billing_payments bp on bp.id=s.payment_id where s.admin_id=$1 and s.status='paid' and coalesce(bp.created_at,s.updated_at,s.created_at) >= $2 and coalesce(bp.created_at,s.updated_at,s.created_at) <= $3 order by 1`, adminID, start, end)
	if queryErr == nil {
		defer timelineRows.Close()
		for timelineRows.Next() {
			var paidAt time.Time
			var total int64
			if timelineRows.Scan(&paidAt, &total) != nil {
				continue
			}
			localPaidAt := paidAt.In(location)
			index := int(localPaidAt.Sub(start).Hours()) / bucketHours
			if days > 1 {
				index = int(localPaidAt.Sub(start).Hours()) / 24
			}
			if index >= 0 && index < len(timelineValues) {
				timelineValues[index] += total
			}
		}
	}
	timeline := make([]map[string]any, 0, timelineCount)
	peakLabel, peakSatang := "-", int64(0)
	for index, amount := range timelineValues {
		point := start.Add(time.Duration(index*bucketHours) * time.Hour)
		label := point.Format("15:04")
		if days > 1 {
			label = point.Format("02/01")
		}
		timeline = append(timeline, map[string]any{"label": label, "amountSatang": amount})
		if amount > peakSatang {
			peakSatang, peakLabel = amount, label
		}
	}

	categories := []map[string]any{}
	categoryRows, queryErr := a.db.QueryContext(r.Context(), `
		select coalesce(nullif(c.name,''),nullif(p.category,''),'ไม่ระบุหมวดหมู่'),
			coalesce(sum(round(i.line_total_satang::numeric*s.total_satang/nullif(s.subtotal_satang,0))),0)::bigint,
			coalesce(sum(i.quantity),0)::bigint
		from pos_sales s
		join pos_sale_items i on i.sale_id=s.id
		left join pos_products p on p.id=i.product_id
		left join pos_categories c on c.admin_id=s.admin_id and (c.id=p.category or lower(c.name)=lower(p.category))
		left join billing_payments bp on bp.id=s.payment_id
		where s.admin_id=$1 and s.status='paid' and coalesce(bp.created_at,s.updated_at,s.created_at) >= $2 and coalesce(bp.created_at,s.updated_at,s.created_at) <= $3
		group by 1 order by 2 desc,1 limit 5`, adminID, start, end)
	if queryErr == nil {
		defer categoryRows.Close()
		for categoryRows.Next() {
			var name string
			var total, quantity int64
			if categoryRows.Scan(&name, &total, &quantity) == nil {
				categories = append(categories, map[string]any{"name": name, "totalSatang": total, "quantity": quantity})
			}
		}
	}

	recentSales := []map[string]any{}
	recentRows, queryErr := a.db.QueryContext(r.Context(), `
		select s.id,coalesce(s.payment_id,''),s.buyer_name,s.total_satang,coalesce(bp.method,'cash'),s.created_by_name,
			coalesce(sum(i.quantity),0)::bigint,to_char(coalesce(bp.created_at,s.updated_at,s.created_at) at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI')
		from pos_sales s left join billing_payments bp on bp.id=s.payment_id left join pos_sale_items i on i.sale_id=s.id
		where s.admin_id=$1 and s.status='paid' and coalesce(bp.created_at,s.updated_at,s.created_at) >= $2 and coalesce(bp.created_at,s.updated_at,s.created_at) <= $3
		group by s.id,bp.method,bp.created_at order by coalesce(bp.created_at,s.updated_at,s.created_at) desc,s.id desc limit 5`, adminID, start, end)
	if queryErr == nil {
		defer recentRows.Close()
		for recentRows.Next() {
			var id, paymentID, buyerName, method, actorName, createdAt string
			var totalSatang, itemCount int64
			if recentRows.Scan(&id, &paymentID, &buyerName, &totalSatang, &method, &actorName, &itemCount, &createdAt) == nil {
				recentSales = append(recentSales, map[string]any{"id": id, "paymentId": paymentID, "buyerName": buyerName, "totalSatang": totalSatang, "method": method, "actorName": actorName, "itemCount": itemCount, "createdAt": createdAt})
			}
		}
	}

	changePercent := float64(0)
	if previousSalesSatang > 0 {
		changePercent = float64(salesSatang-previousSalesSatang) * 100 / float64(previousSalesSatang)
	} else if salesSatang > 0 {
		changePercent = 100
	}
	averageBillSatang := int64(0)
	if completedBills > 0 {
		averageBillSatang = (salesSatang + int64(completedBills)/2) / int64(completedBills)
	}
	writeJSON(w, 200, map[string]any{
		"range": rangeKey, "from": start.Format(time.RFC3339), "to": end.Format(time.RFC3339),
		"salesSatang": salesSatang, "previousSalesSatang": previousSalesSatang, "salesChangePercent": changePercent,
		"costSatang": costSatang, "grossProfitSatang": salesSatang - costSatang,
		"completedBills": completedBills, "averageBillSatang": averageBillSatang,
		"heldCount": heldCount, "lowStockCount": lowStockCount, "lowStockItems": lowStockItems,
		"timeline": timeline, "peakLabel": peakLabel, "categories": categories, "recentSales": recentSales,
	})
}

func posReportPeriod(values url.Values) (string, time.Time, time.Time, string, string, error) {
	location, err := time.LoadLocation("Asia/Bangkok")
	if err != nil {
		location = time.FixedZone("Asia/Bangkok", 7*60*60)
	}
	now := time.Now().In(location)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, location)
	rangeKey := strings.TrimSpace(values.Get("range"))
	start, end := today, now
	startDate, endDate := today.Format("2006-01-02"), today.Format("2006-01-02")
	switch rangeKey {
	case "week":
		weekday := (int(today.Weekday()) + 6) % 7
		start = today.AddDate(0, 0, -weekday)
		startDate = start.Format("2006-01-02")
	case "month":
		start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, location)
		startDate = start.Format("2006-01-02")
	case "custom":
		startDate, endDate = strings.TrimSpace(values.Get("startDate")), strings.TrimSpace(values.Get("endDate"))
		start, err = time.ParseInLocation("2006-01-02", startDate, location)
		if err != nil {
			return "", time.Time{}, time.Time{}, "", "", errors.New("วันที่เริ่มต้นไม่ถูกต้อง")
		}
		endDay, parseErr := time.ParseInLocation("2006-01-02", endDate, location)
		if parseErr != nil {
			return "", time.Time{}, time.Time{}, "", "", errors.New("วันที่สิ้นสุดไม่ถูกต้อง")
		}
		if endDay.Before(start) {
			return "", time.Time{}, time.Time{}, "", "", errors.New("วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น")
		}
		end = endDay.AddDate(0, 0, 1)
	default:
		rangeKey = "day"
	}
	return rangeKey, start, end, startDate, endDate, nil
}

func (a *app) writePOSReports(w http.ResponseWriter, r *http.Request, adminID string) {
	rangeKey, start, end, startDate, endDate, err := posReportPeriod(r.URL.Query())
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	topPage, _ := strconv.Atoi(r.URL.Query().Get("topPage"))
	vatPage, _ := strconv.Atoi(r.URL.Query().Get("vatPage"))
	if topPage < 1 {
		topPage = 1
	}
	if vatPage < 1 {
		vatPage = 1
	}
	topPageSize, vatPageSize := 20, 25
	if r.URL.Query().Get("exportAll") == "1" {
		topPage, vatPage, topPageSize, vatPageSize = 1, 1, 1_000_000, 1_000_000
	}
	stockLocation := reportStockLocation(r.URL.Query())
	stockClause := reportSaleStockClause("s", stockLocation)
	topSearch := strings.TrimSpace(r.URL.Query().Get("topSearch"))
	vatSearch := strings.TrimSpace(r.URL.Query().Get("vatSearch"))
	var totalSales, totalSubtotal, totalDiscount, totalVAT, totalCOGS int64
	var completedBills int
	err = a.db.QueryRowContext(r.Context(), `
		select coalesce(sum(s.total_satang),0),coalesce(sum(s.subtotal_satang),0),coalesce(sum(s.discount_satang),0),
			coalesce(sum(s.vat_satang),0),coalesce(sum(s.cost_satang),0),count(*)
		from pos_sales s left join billing_payments bp on bp.id=s.payment_id
		where s.admin_id=$1 and s.status='paid' and coalesce(bp.created_at,s.updated_at,s.created_at)>=$2 and coalesce(bp.created_at,s.updated_at,s.created_at)<$3`+stockClause, adminID, start, end).Scan(&totalSales, &totalSubtotal, &totalDiscount, &totalVAT, &totalCOGS, &completedBills)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}

	var topSellersTotal int
	err = a.db.QueryRowContext(r.Context(), `select count(*) from (
		select 1 from pos_sales s join pos_sale_items i on i.sale_id=s.id left join billing_payments bp on bp.id=s.payment_id
		where s.admin_id=$1 and s.status='paid' and coalesce(bp.created_at,s.updated_at,s.created_at)>=$2 and coalesce(bp.created_at,s.updated_at,s.created_at)<$3
		and ($4='' or i.product_name ilike '%%'||$4||'%%' or i.sku ilike '%%'||$4||'%%')`+stockClause+`
		group by i.product_id,i.product_name,i.sku) ranked`, adminID, start, end, topSearch).Scan(&topSellersTotal)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	topSellers := []map[string]any{}
	rows, err := a.db.QueryContext(r.Context(), `
		select coalesce(i.product_id,''),i.product_name,i.sku,coalesce(sum(i.quantity),0)::bigint,
			coalesce(sum(i.line_total_satang),0)::bigint,coalesce(sum(i.unit_cost_satang*i.quantity),0)::bigint
		from pos_sales s join pos_sale_items i on i.sale_id=s.id left join billing_payments bp on bp.id=s.payment_id
		where s.admin_id=$1 and s.status='paid' and coalesce(bp.created_at,s.updated_at,s.created_at)>=$2 and coalesce(bp.created_at,s.updated_at,s.created_at)<$3
		and ($4='' or i.product_name ilike '%%'||$4||'%%' or i.sku ilike '%%'||$4||'%%')`+stockClause+`
		group by i.product_id,i.product_name,i.sku order by 4 desc,5 desc,lower(i.product_name) limit $5 offset $6`, adminID, start, end, topSearch, topPageSize, (topPage-1)*topPageSize)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	for rows.Next() {
		var id, name, sku string
		var quantity, revenue, cost int64
		if err = rows.Scan(&id, &name, &sku, &quantity, &revenue, &cost); err != nil {
			writePOSInternalError(w, r, err)
			return
		}
		topSellers = append(topSellers, map[string]any{"id": id, "name": name, "sku": sku, "quantity": quantity, "revenueSatang": revenue, "costSatang": cost, "profitSatang": revenue - cost})
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		writePOSInternalError(w, r, err)
		return
	}
	rows.Close()

	paymentStats := map[string]int64{"cashSatang": 0, "promptPaySatang": 0}
	var cashSatang, promptPaySatang int64
	err = a.db.QueryRowContext(r.Context(), `
		select coalesce(sum(s.total_satang) filter(where coalesce(bp.method,'cash')='cash'),0),coalesce(sum(s.total_satang) filter(where bp.method='promptpay'),0)
		from pos_sales s left join billing_payments bp on bp.id=s.payment_id
		where s.admin_id=$1 and s.status='paid' and (bp.id is null or bp.status='paid') and coalesce(bp.created_at,s.updated_at,s.created_at)>=$2 and coalesce(bp.created_at,s.updated_at,s.created_at)<$3`+stockClause, adminID, start, end).Scan(&cashSatang, &promptPaySatang)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	paymentStats["cashSatang"], paymentStats["promptPaySatang"] = cashSatang, promptPaySatang

	var vatSalesTotal int
	err = a.db.QueryRowContext(r.Context(), `select count(*) from pos_sales s left join billing_payments bp on bp.id=s.payment_id
		where s.admin_id=$1 and s.status='paid' and coalesce(bp.created_at,s.updated_at,s.created_at)>=$2 and coalesce(bp.created_at,s.updated_at,s.created_at)<$3
		and ($4='' or s.buyer_name ilike '%%'||$4||'%%' or s.created_by_name ilike '%%'||$4||'%%')`+stockClause, adminID, start, end, vatSearch).Scan(&vatSalesTotal)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	salesRows := []map[string]any{}
	saleRows, err := a.db.QueryContext(r.Context(), `
		select s.id,coalesce(s.payment_id,''),to_char(coalesce(bp.created_at,s.updated_at,s.created_at) at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),
			s.subtotal_satang,s.discount_satang,s.net_before_vat_satang,s.vat_satang,s.total_satang,s.vat_rate_bps,s.prices_include_tax,
			coalesce(bp.method,'cash'),coalesce(sum(i.quantity),0)::bigint,s.created_by_name,s.buyer_name
		from pos_sales s left join billing_payments bp on bp.id=s.payment_id left join pos_sale_items i on i.sale_id=s.id
		where s.admin_id=$1 and s.status='paid' and coalesce(bp.created_at,s.updated_at,s.created_at)>=$2 and coalesce(bp.created_at,s.updated_at,s.created_at)<$3
		and ($4='' or s.buyer_name ilike '%%'||$4||'%%' or s.created_by_name ilike '%%'||$4||'%%')`+stockClause+`
		group by s.id,bp.created_at,bp.method order by coalesce(bp.created_at,s.updated_at,s.created_at),s.id limit $5 offset $6`, adminID, start, end, vatSearch, vatPageSize, (vatPage-1)*vatPageSize)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	for saleRows.Next() {
		var id, paymentID, createdAt, method, actorName, buyerName string
		var subtotal, discount, netBeforeVAT, vat, total, itemCount int64
		var vatRateBPS int
		var pricesIncludeTax bool
		if err = saleRows.Scan(&id, &paymentID, &createdAt, &subtotal, &discount, &netBeforeVAT, &vat, &total, &vatRateBPS, &pricesIncludeTax, &method, &itemCount, &actorName, &buyerName); err != nil {
			writePOSInternalError(w, r, err)
			return
		}
		salesRows = append(salesRows, map[string]any{"id": id, "paymentId": paymentID, "createdAt": createdAt, "subtotalSatang": subtotal, "discountSatang": discount, "netBeforeVatSatang": netBeforeVAT, "vatSatang": vat, "totalSatang": total, "vatRateBps": vatRateBPS, "pricesIncludeTax": pricesIncludeTax, "method": method, "itemCount": itemCount, "actorName": actorName, "buyerName": buyerName})
	}
	if err = saleRows.Err(); err != nil {
		saleRows.Close()
		writePOSInternalError(w, r, err)
		return
	}
	saleRows.Close()

	averageBill := int64(0)
	if completedBills > 0 {
		averageBill = (totalSales + int64(completedBills)/2) / int64(completedBills)
	}
	profit := totalSales - totalCOGS
	writeJSON(w, 200, map[string]any{
		"range": rangeKey, "startDate": startDate, "endDate": endDate, "stockLocation": stockLocation,
		"summary":    map[string]any{"totalSalesSatang": totalSales, "totalSubtotalSatang": totalSubtotal, "totalDiscountSatang": totalDiscount, "totalVatSatang": totalVAT, "totalCogsSatang": totalCOGS, "grossProfitSatang": profit, "completedBills": completedBills, "averageBillSatang": averageBill},
		"topSellers": topSellers, "paymentStats": paymentStats, "sales": salesRows,
		"topSellersPagination": map[string]any{"page": topPage, "pageSize": topPageSize, "total": topSellersTotal, "totalPages": (topSellersTotal + topPageSize - 1) / topPageSize},
		"salesPagination":      map[string]any{"page": vatPage, "pageSize": vatPageSize, "total": vatSalesTotal, "totalPages": (vatSalesTotal + vatPageSize - 1) / vatPageSize},
	})
}

func posReportPagination(values url.Values, pageKey string, defaultSize int) (int, int) {
	page, _ := strconv.Atoi(values.Get(pageKey))
	pageSize, _ := strconv.Atoi(values.Get("pageSize"))
	if page < 1 {
		page = 1
	}
	if pageSize < 5 || pageSize > 100 {
		pageSize = defaultSize
	}
	if values.Get("exportAll") == "1" {
		return 1, 1_000_000
	}
	return page, pageSize
}

func reportStockLocation(values url.Values) string {
	value := strings.TrimSpace(values.Get("stockLocation"))
	if validStockLocation(value) {
		return value
	}
	return "all"
}

func reportSaleStockClause(alias, location string) string {
	if location == "primary" {
		return " and " + alias + ".stock_location='primary'"
	}
	if location == "secondary" {
		return " and " + alias + ".stock_location='secondary'"
	}
	return ""
}

func (a *app) writePOSSoldProductsReport(w http.ResponseWriter, r *http.Request, adminID string) {
	rangeKey, start, end, startDate, endDate, err := posReportPeriod(r.URL.Query())
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	page, pageSize := posReportPagination(r.URL.Query(), "page", 25)
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	stockLocation := reportStockLocation(r.URL.Query())
	base := `from pos_sales s join pos_sale_items i on i.sale_id=s.id left join billing_payments bp on bp.id=s.payment_id
		where s.admin_id=$1 and s.status='paid' and coalesce(bp.created_at,s.updated_at,s.created_at)>=$2 and coalesce(bp.created_at,s.updated_at,s.created_at)<$3
		and ($4='' or i.product_name ilike '%%'||$4||'%%' or i.sku ilike '%%'||$4||'%%')` + reportSaleStockClause("s", stockLocation)
	var total int
	if err = a.db.QueryRowContext(r.Context(), `select count(*) from (select 1 `+base+` group by i.product_id,i.product_name) q`, adminID, start, end, search).Scan(&total); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	items := []map[string]any{}
	rows, err := a.db.QueryContext(r.Context(), `select coalesce(i.product_id,''),i.product_name,sum(i.quantity)::bigint,count(distinct s.id)::bigint,coalesce(sum(round(i.line_total_satang::numeric*s.total_satang/nullif(s.subtotal_satang,0))),0)::bigint `+base+`
		group by i.product_id,i.product_name order by sum(i.quantity) desc,5 desc,lower(i.product_name) limit $5 offset $6`, adminID, start, end, search, pageSize, (page-1)*pageSize)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id, name string
		var quantity, billCount, revenue int64
		if err = rows.Scan(&id, &name, &quantity, &billCount, &revenue); err != nil {
			writePOSInternalError(w, r, err)
			return
		}
		items = append(items, map[string]any{"productId": id, "name": name, "quantity": quantity, "billCount": billCount, "revenueSatang": revenue})
	}
	if err = rows.Err(); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	var totalQuantity, totalRevenue int64
	if err = a.db.QueryRowContext(r.Context(), `select coalesce(sum(i.quantity),0)::bigint,coalesce(sum(round(i.line_total_satang::numeric*s.total_satang/nullif(s.subtotal_satang,0))),0)::bigint `+base, adminID, start, end, search).Scan(&totalQuantity, &totalRevenue); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"range": rangeKey, "startDate": startDate, "endDate": endDate, "stockLocation": stockLocation, "items": items,
		"summary":    map[string]any{"totalQuantity": totalQuantity, "totalRevenueSatang": totalRevenue},
		"pagination": map[string]any{"page": page, "pageSize": pageSize, "total": total, "totalPages": (total + pageSize - 1) / pageSize},
	})
}

func (a *app) writePOSPurchasesReport(w http.ResponseWriter, r *http.Request, adminID string) {
	rangeKey, start, end, startDate, endDate, err := posReportPeriod(r.URL.Query())
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	page, pageSize := posReportPagination(r.URL.Query(), "page", 25)
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	supplierID := strings.TrimSpace(r.URL.Query().Get("supplierId"))
	stockLocation := reportStockLocation(r.URL.Query())
	base := `from pos_stock_batches b
		left join pos_suppliers s on s.id=b.supplier_id and s.admin_id=b.admin_id
		where b.admin_id=$1 and b.mode='in' and b.supplier_name<>'' and b.created_at>=$2 and b.created_at<$3
		and ($4='' or b.name ilike '%%'||$4||'%%' or b.external_reference_no ilike '%%'||$4||'%%' or b.supplier_name ilike '%%'||$4||'%%' or coalesce(s.code,'') ilike '%%'||$4||'%%' or b.actor_name ilike '%%'||$4||'%%'
			or exists(select 1 from pos_stock_movements sm join pos_products sp on sp.id=sm.product_id where sm.batch_id=b.id and (sp.name ilike '%%'||$4||'%%' or sp.sku ilike '%%'||$4||'%%')))
		and ($5='' or b.supplier_id=$5)`
	if validStockLocation(stockLocation) {
		base += " and b.stock_location='" + stockLocation + "'"
	}
	var total int
	if err = a.db.QueryRowContext(r.Context(), `select count(*) `+base, adminID, start, end, search, supplierID).Scan(&total); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	items := []map[string]any{}
	rows, err := a.db.QueryContext(r.Context(), `
		select b.id,b.name,coalesce(b.supplier_id,''),coalesce(s.code,''),b.supplier_name,b.external_reference_no,b.note,
			coalesce((select count(*) from pos_stock_movements m where m.batch_id=b.id),0),
			coalesce((select sum(greatest(m.delta,0)) from pos_stock_movements m where m.batch_id=b.id),0)::bigint,
			case when b.gross_total_satang=0 then b.total_cost_satang else b.gross_total_satang end,
			b.discount_satang,case when b.net_total_satang=0 then b.total_cost_satang else b.net_total_satang end,
			to_char(b.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),b.actor_name,
			coalesce((select string_agg(p.name||' × '||greatest(m.delta,0)::text, ', ' order by lower(p.name)) from pos_stock_movements m join pos_products p on p.id=m.product_id where m.batch_id=b.id),''),
			coalesce((select jsonb_agg(jsonb_build_object(
				'productId',m.product_id,'productName',p.name,'productSku',p.sku,'quantity',greatest(m.delta,0),
				'unitCostSatang',m.unit_cost_satang,'grossTotalSatang',m.gross_total_satang,
				'discountSatang',m.allocated_discount_satang,'netTotalSatang',m.net_total_satang
			) order by m.id) from pos_stock_movements m join pos_products p on p.id=m.product_id where m.batch_id=b.id),'[]'::jsonb)
		`+base+` order by b.created_at desc,b.id desc limit $6 offset $7`, adminID, start, end, search, supplierID, pageSize, (page-1)*pageSize)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id, referenceNo, rowSupplierID, supplierCode, supplierName, externalReferenceNo, note, createdAt, actorName, products string
		var lines json.RawMessage
		var itemCount int
		var totalQuantity, grossTotal, discount, netTotal int64
		if err = rows.Scan(&id, &referenceNo, &rowSupplierID, &supplierCode, &supplierName, &externalReferenceNo, &note, &itemCount, &totalQuantity, &grossTotal, &discount, &netTotal, &createdAt, &actorName, &products, &lines); err != nil {
			writePOSInternalError(w, r, err)
			return
		}
		items = append(items, map[string]any{"id": id, "referenceNo": referenceNo, "supplierId": rowSupplierID, "supplierCode": supplierCode, "supplierName": supplierName, "externalReferenceNo": externalReferenceNo, "note": note, "itemCount": itemCount, "totalQuantity": totalQuantity, "grossTotalSatang": grossTotal, "discountSatang": discount, "netTotalSatang": netTotal, "createdAt": createdAt, "actorName": actorName, "products": products, "lines": lines})
	}
	if err = rows.Err(); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	var totalQuantity, grossTotal, discountTotal, netTotal int64
	if err = a.db.QueryRowContext(r.Context(), `select coalesce(sum(total_quantity),0)::bigint,coalesce(sum(gross_total),0)::bigint,coalesce(sum(discount),0)::bigint,coalesce(sum(net_total),0)::bigint from (
		select coalesce((select sum(greatest(m.delta,0)) from pos_stock_movements m where m.batch_id=b.id),0)::bigint total_quantity,
			case when b.gross_total_satang=0 then b.total_cost_satang else b.gross_total_satang end gross_total,
			b.discount_satang discount,case when b.net_total_satang=0 then b.total_cost_satang else b.net_total_satang end net_total `+base+`
	) totals`, adminID, start, end, search, supplierID).Scan(&totalQuantity, &grossTotal, &discountTotal, &netTotal); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"range": rangeKey, "startDate": startDate, "endDate": endDate, "stockLocation": stockLocation, "items": items,
		"summary":    map[string]any{"purchaseCount": total, "totalQuantity": totalQuantity, "grossTotalSatang": grossTotal, "discountSatang": discountTotal, "netTotalSatang": netTotal},
		"pagination": map[string]any{"page": page, "pageSize": pageSize, "total": total, "totalPages": (total + pageSize - 1) / pageSize},
	})
}

func (a *app) writePOSInventoryReport(w http.ResponseWriter, r *http.Request, adminID string, includeValues bool) {
	page, pageSize := posReportPagination(r.URL.Query(), "page", 25)
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	category := strings.TrimSpace(r.URL.Query().Get("category"))
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	stockStatus := strings.TrimSpace(r.URL.Query().Get("stockStatus"))
	packStatus := strings.TrimSpace(r.URL.Query().Get("packStatus"))
	stockLocation := reportStockLocation(r.URL.Query())
	stockExpression := "(p.stock_quantity+p.secondary_stock_quantity)"
	if stockLocation == "primary" {
		stockExpression = "p.stock_quantity"
	}
	if stockLocation == "secondary" {
		stockExpression = "p.secondary_stock_quantity"
	}
	if status != "active" && status != "inactive" {
		status = "all"
	}
	if stockStatus != "normal" && stockStatus != "low" && stockStatus != "out" {
		stockStatus = "all"
	}
	if packStatus != "configured" && packStatus != "unconfigured" {
		packStatus = "all"
	}
	filter := `p.admin_id=$1 and p.deleted_at is null and p.track_stock
		and ($2='' or p.name ilike '%%'||$2||'%%' or p.sku ilike '%%'||$2||'%%' or p.barcode ilike '%%'||$2||'%%')
		and ($3='' or lower(coalesce(nullif(c.name,''),p.category))=lower($3) or p.category=$3) and ($4='all' or p.active=($4='active'))
		and ($5='all' or ($5='out' and ` + stockExpression + `=0) or ($5='low' and ` + stockExpression + `>0 and ` + stockExpression + `<=p.low_stock_threshold) or ($5='normal' and ` + stockExpression + `>p.low_stock_threshold))
		and ($6='all' or ($6='configured' and p.units_per_pack>0) or ($6='unconfigured' and p.units_per_pack=0))`
	args := []any{adminID, search, category, status, stockStatus, packStatus}
	var total int
	if err := a.db.QueryRowContext(r.Context(), `select count(*) from pos_products p left join pos_categories c on c.admin_id=p.admin_id and (c.id=p.category or lower(c.name)=lower(p.category)) where `+filter, args...).Scan(&total); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	items := []map[string]any{}
	rows, err := a.db.QueryContext(r.Context(), `select p.id,p.name,coalesce(nullif(c.name,''),p.category),coalesce(nullif(u.name,''),p.unit),p.active,`+stockExpression+`,p.low_stock_threshold,p.units_per_pack,p.cost_satang,p.price_satang
		from pos_products p left join pos_categories c on c.admin_id=p.admin_id and (c.id=p.category or lower(c.name)=lower(p.category)) left join pos_units u on u.admin_id=p.admin_id and (u.id=p.unit or lower(u.name)=lower(p.unit)) where `+filter+` order by p.active desc,lower(p.name),p.id limit $7 offset $8`, append(args, pageSize, (page-1)*pageSize)...)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id, name, itemCategory, unit string
		var active bool
		var stock, low, pack int
		var cost, price int64
		if err = rows.Scan(&id, &name, &itemCategory, &unit, &active, &stock, &low, &pack, &cost, &price); err != nil {
			writePOSInternalError(w, r, err)
			return
		}
		var fullPacks, remainder any
		if packs, units, configured := posPackBreakdown(stock, pack); configured {
			fullPacks, remainder = packs, units
		}
		stockLabel := "normal"
		if stock == 0 {
			stockLabel = "out"
		} else if stock <= low {
			stockLabel = "low"
		}
		item := map[string]any{
			"productId": id, "name": name, "category": itemCategory, "unit": unit, "active": active,
			"stockQuantity": stock, "stockStatus": stockLabel, "unitsPerPack": pack, "fullPacks": fullPacks, "remainderUnits": remainder,
		}
		if includeValues {
			item["costSatang"] = cost
			item["costValueSatang"] = int64(stock) * cost
			item["priceSatang"] = price
			item["retailValueSatang"] = int64(stock) * price
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"asOf": time.Now().In(time.FixedZone("Asia/Bangkok", 7*60*60)).Format(time.RFC3339), "stockLocation": stockLocation, "items": items,
		"pagination": map[string]any{"page": page, "pageSize": pageSize, "total": total, "totalPages": (total + pageSize - 1) / pageSize},
	})
}

func (a *app) writePOSStockTransfersReport(w http.ResponseWriter, r *http.Request, adminID string) {
	rangeKey, start, end, startDate, endDate, err := posReportPeriod(r.URL.Query())
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	page, pageSize := posReportPagination(r.URL.Query(), "page", 25)
	search, location := strings.TrimSpace(r.URL.Query().Get("search")), reportStockLocation(r.URL.Query())
	filter := `b.admin_id=$1 and b.mode='transfer' and b.created_at>=$2 and b.created_at<$3 and ($4='' or b.name ilike '%%'||$4||'%%' or b.note ilike '%%'||$4||'%%' or b.actor_name ilike '%%'||$4||'%%'
		or exists(select 1 from pos_stock_movements sm join pos_products sp on sp.id=sm.product_id where sm.batch_id=b.id and (sp.name ilike '%%'||$4||'%%' or sp.sku ilike '%%'||$4||'%%')))`
	if validStockLocation(location) {
		filter += " and (b.source_stock_location='" + location + "' or b.destination_stock_location='" + location + "')"
	}
	var total int
	if err = a.db.QueryRowContext(r.Context(), `select count(*) from pos_stock_batches b where `+filter, adminID, start, end, search).Scan(&total); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	rows, err := a.db.QueryContext(r.Context(), `select b.id,b.name,b.note,b.source_stock_location,b.destination_stock_location,to_char(b.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),b.actor_name,coalesce((select sum(m.delta) from pos_stock_movements m where m.batch_id=b.id and m.reason='transfer_in'),0)::bigint,coalesce((select jsonb_agg(jsonb_build_object('productId',m.product_id,'productName',p.name,'productSku',p.sku,'quantity',m.delta) order by m.id) from pos_stock_movements m join pos_products p on p.id=m.product_id where m.batch_id=b.id and m.reason='transfer_in'),'[]'::jsonb) from pos_stock_batches b where `+filter+` order by b.created_at desc,b.id desc limit $5 offset $6`, adminID, start, end, search, pageSize, (page-1)*pageSize)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	var totalQuantity int64
	for rows.Next() {
		var id, name, note, source, destination, createdAt, actor string
		var quantity int64
		var lines json.RawMessage
		if err = rows.Scan(&id, &name, &note, &source, &destination, &createdAt, &actor, &quantity, &lines); err != nil {
			writePOSInternalError(w, r, err)
			return
		}
		totalQuantity += quantity
		items = append(items, map[string]any{"id": id, "referenceNo": name, "note": note, "sourceStockLocation": source, "destinationStockLocation": destination, "createdAt": createdAt, "actorName": actor, "totalQuantity": quantity, "lines": lines})
	}
	_ = a.db.QueryRowContext(r.Context(), `select coalesce(sum(m.delta),0)::bigint from pos_stock_batches b join pos_stock_movements m on m.batch_id=b.id and m.reason='transfer_in' where `+filter, adminID, start, end, search).Scan(&totalQuantity)
	writeJSON(w, 200, map[string]any{"range": rangeKey, "startDate": startDate, "endDate": endDate, "stockLocation": location, "summary": map[string]any{"transferCount": total, "totalQuantity": totalQuantity}, "items": items, "pagination": map[string]any{"page": page, "pageSize": pageSize, "total": total, "totalPages": max(1, (total+pageSize-1)/pageSize)}})
}

func posPackBreakdown(stockQuantity, unitsPerPack int) (int, int, bool) {
	if unitsPerPack <= 0 {
		return 0, 0, false
	}
	return stockQuantity / unitsPerPack, stockQuantity % unitsPerPack, true
}

func specialMemberTypeName(state SessionState, player Player) string {
	if strings.TrimSpace(player.MemberTypeName) != "" {
		return player.MemberTypeName
	}
	for _, memberType := range state.MemberTypes {
		if memberType.ID == player.MemberTypeID {
			return memberType.Name
		}
	}
	if player.ClubMember {
		return "สมาชิกชมรม"
	}
	return "สมาชิกทั่วไป"
}

func specialShuttleBrandName(state SessionState, match Match, brandID string) string {
	normalized := normalizedBrandID(brandID)
	for _, brand := range match.ShuttlePriceSnapshot {
		if normalizedBrandID(brand.ID) == normalized && strings.TrimSpace(brand.Name) != "" {
			return brand.Name
		}
	}
	for _, brand := range state.Settings.ShuttleBrands {
		if normalizedBrandID(brand.ID) == normalized && strings.TrimSpace(brand.Name) != "" {
			return brand.Name
		}
	}
	return defaultShuttleBrandName
}

func buildPOSSpecialSession(state SessionState, occurredAt time.Time) map[string]any {
	entryGroups := map[string]map[string]any{}
	var entryTotal int64
	for _, player := range state.Players {
		feeSatang := int64(playerEntryFee(state, player)) * 100
		name := specialMemberTypeName(state, player)
		key := name + ":" + strconv.FormatInt(feeSatang, 10)
		group := entryGroups[key]
		if group == nil {
			group = map[string]any{"memberTypeId": player.MemberTypeID, "memberTypeName": name, "quantity": 0, "unitPriceSatang": feeSatang, "totalSatang": int64(0)}
			entryGroups[key] = group
		}
		quantity := group["quantity"].(int) + 1
		group["quantity"] = quantity
		group["totalSatang"] = int64(quantity) * feeSatang
		entryTotal += feeSatang
	}
	entryFees := make([]map[string]any, 0, len(entryGroups))
	for _, group := range entryGroups {
		entryFees = append(entryFees, group)
	}
	sort.Slice(entryFees, func(i, j int) bool {
		return fmt.Sprint(entryFees[i]["memberTypeName"]) < fmt.Sprint(entryFees[j]["memberTypeName"])
	})

	shuttleGroups := map[string]map[string]any{}
	shuttleTotal, shuttleQuantity := int64(0), 0
	matches := append(append([]Match{}, state.Live...), state.History...)
	for _, match := range matches {
		if isCancelledMatch(match) && match.ShuttleReturned {
			continue
		}
		items := normalizedShuttleSeqItems(match, state)
		if len(items) == 0 && match.Shuttles > 0 {
			for number := 1; number <= match.Shuttles; number++ {
				items = append(items, ShuttleSeqItem{BrandID: defaultShuttleBrandID, Number: number})
			}
		}
		for _, item := range items {
			priceSatang := shuttleItemPriceSatang(state, match, item)
			name := specialShuttleBrandName(state, match, item.BrandID)
			if strings.TrimSpace(item.ProductName) != "" {
				name = strings.TrimSpace(item.ProductName)
			}
			key := normalizedBrandID(item.BrandID) + ":" + strconv.FormatInt(priceSatang, 10) + ":" + name
			group := shuttleGroups[key]
			if group == nil {
				group = map[string]any{"brandId": normalizedBrandID(item.BrandID), "brandName": name, "quantity": 0, "unitPriceSatang": priceSatang, "totalSatang": int64(0)}
				shuttleGroups[key] = group
			}
			quantity := group["quantity"].(int) + 1
			group["quantity"] = quantity
			group["totalSatang"] = int64(quantity) * priceSatang
			shuttleQuantity++
			shuttleTotal += priceSatang
		}
	}
	shuttles := make([]map[string]any, 0, len(shuttleGroups))
	for _, group := range shuttleGroups {
		shuttles = append(shuttles, group)
	}
	sort.Slice(shuttles, func(i, j int) bool {
		return fmt.Sprint(shuttles[i]["brandName"]) < fmt.Sprint(shuttles[j]["brandName"])
	})
	return map[string]any{
		"id": state.Session.ID, "name": state.Session.Name, "occurredAt": occurredAt.In(time.FixedZone("Asia/Bangkok", 7*60*60)).Format(time.RFC3339),
		"gameCount": len(state.Live) + len(state.History), "playerCount": len(state.Players), "entryFees": entryFees, "shuttles": shuttles,
		"shuttleQuantity": shuttleQuantity, "entryFeeTotalSatang": entryTotal, "shuttleTotalSatang": shuttleTotal, "totalSatang": entryTotal + shuttleTotal,
	}
}

func (a *app) writePOSSpecialReport(w http.ResponseWriter, r *http.Request, adminID string) {
	rangeKey, start, end, startDate, endDate, err := posReportPeriod(r.URL.Query())
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	posPage, pageSize := posReportPagination(r.URL.Query(), "posPage", 20)
	sessionPage, sessionPageSize := posReportPagination(r.URL.Query(), "sessionPage", 10)
	if r.URL.Query().Get("exportAll") == "1" {
		posPage, sessionPage = 1, 1
	}
	stockLocation := reportStockLocation(r.URL.Query())
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	base := `from pos_sales s join pos_sale_items i on i.sale_id=s.id left join billing_payments bp on bp.id=s.payment_id
		where s.admin_id=$1 and s.status='paid' and coalesce(bp.created_at,s.updated_at,s.created_at)>=$2 and coalesce(bp.created_at,s.updated_at,s.created_at)<$3
		and ($4='' or i.product_name ilike '%%'||$4||'%%' or i.sku ilike '%%'||$4||'%%')` + reportSaleStockClause("s", stockLocation)
	var posTotal int
	if err = a.db.QueryRowContext(r.Context(), `select count(*) from (select 1 `+base+` group by i.product_id,i.product_name) q`, adminID, start, end, search).Scan(&posTotal); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	posItems := []map[string]any{}
	rows, err := a.db.QueryContext(r.Context(), `select coalesce(i.product_id,''),i.product_name,sum(i.quantity)::bigint,count(distinct s.id)::bigint,coalesce(sum(round(i.line_total_satang::numeric*s.total_satang/nullif(s.subtotal_satang,0))),0)::bigint `+base+`
		group by i.product_id,i.product_name order by sum(i.quantity) desc,lower(i.product_name) limit $5 offset $6`, adminID, start, end, search, pageSize, (posPage-1)*pageSize)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	for rows.Next() {
		var id, name string
		var quantity, bills, revenue int64
		if err = rows.Scan(&id, &name, &quantity, &bills, &revenue); err != nil {
			rows.Close()
			writePOSInternalError(w, r, err)
			return
		}
		posItems = append(posItems, map[string]any{"productId": id, "name": name, "quantity": quantity, "billCount": bills, "revenueSatang": revenue})
	}
	rows.Close()
	var posQuantity, posRevenue int64
	if err = a.db.QueryRowContext(r.Context(), `select coalesce(sum(i.quantity),0)::bigint `+base, adminID, start, end, search).Scan(&posQuantity); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	if err = a.db.QueryRowContext(r.Context(), `select coalesce(sum(s.total_satang),0)::bigint from pos_sales s left join billing_payments bp on bp.id=s.payment_id where s.admin_id=$1 and s.status='paid' and coalesce(bp.created_at,s.updated_at,s.created_at)>=$2 and coalesce(bp.created_at,s.updated_at,s.created_at)<$3`+reportSaleStockClause("s", stockLocation), adminID, start, end).Scan(&posRevenue); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	var cashReceived, promptPayReceived int64
	if cashReceived, promptPayReceived, err = a.posSpecialPaymentTotals(r.Context(), adminID, start, end, stockLocation); err != nil {
		writePOSInternalError(w, r, err)
		return
	}

	type sessionRef struct {
		id         string
		occurredAt time.Time
	}
	refs := []sessionRef{}
	sessionRows, err := a.db.QueryContext(r.Context(), `select id,coalesce(usage_started_at,created_at) from sessions where admin_id=$1 and coalesce(session_type,'liveMatch')='liveMatch' and coalesce(usage_started_at,created_at)>=$2 and coalesce(usage_started_at,created_at)<$3 and ($4='' or name ilike '%%'||$4||'%%') order by coalesce(usage_started_at,created_at),id`, adminID, start, end, search)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	for sessionRows.Next() {
		var ref sessionRef
		if err = sessionRows.Scan(&ref.id, &ref.occurredAt); err != nil {
			sessionRows.Close()
			writePOSInternalError(w, r, err)
			return
		}
		refs = append(refs, ref)
	}
	sessionRows.Close()
	allSessions := make([]map[string]any, 0, len(refs))
	var matchEntry, matchShuttle int64
	matchPlayers, matchShuttleQuantity := 0, 0
	for _, ref := range refs {
		state, loadErr := a.loadState(r.Context(), ref.id)
		if loadErr != nil {
			writePOSInternalError(w, r, loadErr)
			return
		}
		item := buildPOSSpecialSession(state, ref.occurredAt)
		allSessions = append(allSessions, item)
		matchPlayers += item["playerCount"].(int)
		matchShuttleQuantity += item["shuttleQuantity"].(int)
		matchEntry += item["entryFeeTotalSatang"].(int64)
		matchShuttle += item["shuttleTotalSatang"].(int64)
	}
	sessions := []map[string]any{}
	if len(allSessions) > 0 {
		from := min((sessionPage-1)*sessionPageSize, len(allSessions))
		to := min(from+sessionPageSize, len(allSessions))
		sessions = allSessions[from:to]
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"range": rangeKey, "startDate": startDate, "endDate": endDate, "stockLocation": stockLocation, "posItems": posItems, "sessions": sessions,
		"summary":           map[string]any{"posQuantity": posQuantity, "posRevenueSatang": posRevenue, "matchPlayerCount": matchPlayers, "matchEntryFeeSatang": matchEntry, "matchShuttleQuantity": matchShuttleQuantity, "matchShuttleSatang": matchShuttle, "sessionCount": len(allSessions), "totalSatang": posRevenue + matchEntry + matchShuttle, "cashReceivedSatang": cashReceived, "promptPayReceivedSatang": promptPayReceived},
		"posPagination":     map[string]any{"page": posPage, "pageSize": pageSize, "total": posTotal, "totalPages": (posTotal + pageSize - 1) / pageSize},
		"sessionPagination": map[string]any{"page": sessionPage, "pageSize": sessionPageSize, "total": len(allSessions), "totalPages": (len(allSessions) + sessionPageSize - 1) / sessionPageSize},
	})
}

// posSpecialPaymentTotals reports money actually received for POS and Match.
// Allocation amounts are used instead of the payment total so a combined payment
// is counted once without including any unrelated source. Legacy Match payment
// events are included only when they have not been migrated to billing_payments.
func (a *app) posSpecialPaymentTotals(ctx context.Context, adminID string, start, end time.Time, stockLocation string) (int64, int64, error) {
	locationFilter := ""
	if stockLocation == "primary" || stockLocation == "secondary" {
		locationFilter = ` and (allocation.source_type='match' or exists(
			select 1 from pos_sales allocated_sale
			where allocated_sale.id=allocation.source_id and allocated_sale.admin_id=payment.admin_id and allocated_sale.stock_location=$4
		))`
	}
	query := `with received as (
		select payment.method,allocation.amount_satang
		from billing_payments payment
		join billing_payment_allocations allocation on allocation.payment_id=payment.id
		where payment.admin_id=$1 and payment.status='paid'
		  and payment.created_at >= $2 and payment.created_at < $3
		  and allocation.source_type in ('pos','match')` + locationFilter + `
		union all
		select coalesce(payment.method,'cash'),sale.total_satang
		from pos_sales sale
		left join billing_payments payment on payment.id=sale.payment_id
		where sale.admin_id=$1 and sale.status='paid'
		  and (payment.id is null or payment.status='paid')
		  and coalesce(payment.created_at,sale.updated_at,sale.created_at) >= $2
		  and coalesce(payment.created_at,sale.updated_at,sale.created_at) < $3
		  and not exists(
			select 1 from billing_payment_allocations allocated
			where allocated.payment_id=sale.payment_id and allocated.source_type='pos' and allocated.source_id=sale.id
		  )` + reportSaleStockClause("sale", stockLocation) + `
		union all
		select event.payment_method,event.amount_satang
		from player_payment_events event
		join sessions session on session.id=event.session_id
		where session.admin_id=$1 and event.paid and event.billing_payment_id is null
		  and event.created_at >= $2 and event.created_at < $3
	)
	select coalesce(sum(amount_satang) filter(where method='cash'),0)::bigint,
	       coalesce(sum(amount_satang) filter(where method='promptpay'),0)::bigint
	from received`
	args := []any{adminID, start, end}
	if locationFilter != "" {
		args = append(args, stockLocation)
	}
	var cash, promptPay int64
	err := a.db.QueryRowContext(ctx, query, args...).Scan(&cash, &promptPay)
	return cash, promptPay, err
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
	selectFields := `c.id,c.name,c.active,(select count(*) from pos_products p where p.admin_id=c.admin_id and p.deleted_at is null and (p.%s=c.id or lower(p.%s)=lower(c.name))),'',''`
	if kind == "category" {
		selectFields = `c.id,c.name,c.active,(select count(*) from pos_products p where p.admin_id=c.admin_id and p.deleted_at is null and (p.%s=c.id or lower(p.%s)=lower(c.name))),c.icon,c.color`
	}
	query := fmt.Sprintf(`select `+selectFields+` from %s c where c.admin_id=$1 order by c.active desc,lower(c.name)`, productColumn, productColumn, table)
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
		writePOSInternalError(w, r, err)
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
		writePOSInternalError(w, r, err)
		return
	}
	defer rows.Close()
	items := []posSupplierRecord{}
	for rows.Next() {
		var item posSupplierRecord
		if err = rows.Scan(&item.ID, &item.Code, &item.Name, &item.ContactPerson, &item.Phone, &item.Email, &item.Address, &item.Active, &item.ProductsCount); err != nil {
			writePOSInternalError(w, r, err)
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
		writePOSInternalError(w, r, err)
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
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer tx.Rollback()
	var used bool
	err = tx.QueryRowContext(r.Context(), `select exists(select 1 from pos_stock_batches where admin_id=$1 and supplier_id=$2)`, user.ID, id).Scan(&used)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	if used {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "ลบไม่ได้ เนื่องจากซัพพลายเออร์นี้มีประวัติรับสินค้าแล้ว", "code": "SUPPLIER_IN_USE"})
		return
	}
	result, err := tx.ExecContext(r.Context(), `update pos_suppliers set active=false,updated_at=now() where id=$1 and admin_id=$2 and active`, id, user.ID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "ลบซัพพลายเออร์ไม่สำเร็จ"})
		return
	}
	if count, _ := result.RowsAffected(); count == 0 {
		writeJSON(w, 404, map[string]string{"error": "ไม่พบซัพพลายเออร์"})
		return
	}
	if err = tx.Commit(); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	a.insertActivityLog(r.Context(), posActorType(user), posActorID(user), "disable_pos_supplier", "pos_supplier", id, map[string]any{"adminId": user.ID})
	writeJSON(w, 200, map[string]bool{"deleted": true})
}

func posSettingsFieldsInclude(fields map[string]json.RawMessage, keys ...string) bool {
	for _, key := range keys {
		if _, present := fields[key]; present {
			return true
		}
	}
	return false
}

func (a *app) savePOSSettings(w http.ResponseWriter, r *http.Request, user adminUser) {
	previous, err := a.ensurePOSSettings(r.Context(), user.ID)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	var raw json.RawMessage
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 6<<20)).Decode(&raw) != nil {
		writeJSON(w, 400, map[string]string{"error": "ข้อมูลตั้งค่าไม่ถูกต้อง"})
		return
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || len(fields) == 0 {
		writeJSON(w, 400, map[string]string{"error": "ข้อมูลตั้งค่าไม่ถูกต้อง"})
		return
	}
	b := previous
	if json.Unmarshal(raw, &b) != nil {
		writeJSON(w, 400, map[string]string{"error": "ข้อมูลตั้งค่าไม่ถูกต้อง"})
		return
	}
	storeTouched := posSettingsFieldsInclude(fields, "promptPayType", "promptPayId", "promptPayReceiverName", "receiptHeader", "logoData", "defaultLowStock", "inheritBookingPromptPay", "paymentQrImage", "storeTaxId", "storePhone", "storeEmail", "storeAddress", "navbarTitle", "navbarIconData")
	stockTouched := posSettingsFieldsInclude(fields, "secondaryStockEnabled", "primaryStockName", "secondaryStockName", "saleStockLocation")
	displayTouched := posSettingsFieldsInclude(fields, "customerDisplayTitle", "customerDisplayHighlight", "customerDisplaySubtitle", "customerDisplayCardText", "customerDisplayCtaText")
	printerTouched := posSettingsFieldsInclude(fields, "receiptFooter")
	taxTouched := posSettingsFieldsInclude(fields, "taxRatePercent", "pricesIncludeTax")
	promptPayTouched := posSettingsFieldsInclude(fields, "promptPayType", "promptPayId", "promptPayReceiverName", "inheritBookingPromptPay", "paymentQrImage")
	themeTouched := posSettingsFieldsInclude(fields, "theme", "language")

	if storeTouched {
		b.ReceiptHeader = strings.TrimSpace(b.ReceiptHeader)
		b.StoreTaxID, b.StorePhone = strings.TrimSpace(b.StoreTaxID), strings.TrimSpace(b.StorePhone)
		b.StoreEmail, b.StoreAddress = strings.ToLower(strings.TrimSpace(b.StoreEmail)), strings.TrimSpace(b.StoreAddress)
		b.NavbarTitle = strings.TrimSpace(b.NavbarTitle)
	}
	if printerTouched {
		b.ReceiptFooter = strings.TrimSpace(b.ReceiptFooter)
	}
	if stockTouched {
		b.PrimaryStockName, b.SecondaryStockName = strings.TrimSpace(b.PrimaryStockName), strings.TrimSpace(b.SecondaryStockName)
		if b.PrimaryStockName == "" {
			b.PrimaryStockName = "สต็อกหลัก"
		}
		if b.SecondaryStockName == "" {
			b.SecondaryStockName = "สต็อกที่ 2"
		}
		if !validStockLocation(b.SaleStockLocation) || !b.SecondaryStockEnabled {
			b.SaleStockLocation = "primary"
		}
	}
	if displayTouched {
		b.CustomerDisplayTitle, b.CustomerDisplayHighlight = strings.TrimSpace(b.CustomerDisplayTitle), strings.TrimSpace(b.CustomerDisplayHighlight)
		b.CustomerDisplaySubtitle, b.CustomerDisplayCardText, b.CustomerDisplayCTAText = strings.TrimSpace(b.CustomerDisplaySubtitle), strings.TrimSpace(b.CustomerDisplayCardText), strings.TrimSpace(b.CustomerDisplayCTAText)
		if b.CustomerDisplayTitle == "" {
			b.CustomerDisplayTitle = "พร้อมเสิร์ฟความอร่อย"
		}
		if b.CustomerDisplayHighlight == "" {
			b.CustomerDisplayHighlight = "เครื่องดื่ม & เบเกอรี่สดใหม่"
		}
		if b.CustomerDisplaySubtitle == "" {
			b.CustomerDisplaySubtitle = "เชิญสั่งรายการเครื่องดื่ม กาแฟสด และเบเกอรี่ได้ที่เคาน์เตอร์\nหน้าจอจะแสดงรายการสินค้าและยอดเงินชำระแบบเรียลไทม์"
		}
		if b.CustomerDisplayCardText == "" {
			b.CustomerDisplayCardText = "คัดสรรวัตถุดิบคุณภาพเพื่อรสชาติที่ดีที่สุด"
		}
		if b.CustomerDisplayCTAText == "" {
			b.CustomerDisplayCTAText = "สั่งรายการได้ที่พนักงานแคชเชียร์"
		}
	}
	validEmail := true
	if storeTouched && b.StoreEmail != "" {
		parsed, err := mail.ParseAddress(b.StoreEmail)
		validEmail = err == nil && strings.EqualFold(parsed.Address, b.StoreEmail)
	}
	validTaxID := b.StoreTaxID == ""
	if storeTouched && len(b.StoreTaxID) == 13 {
		validTaxID = true
		for _, c := range b.StoreTaxID {
			if c < '0' || c > '9' {
				validTaxID = false
				break
			}
		}
	}
	invalidStockSettings := stockTouched && (len(b.PrimaryStockName) > 80 || len(b.SecondaryStockName) > 80)
	invalidStoreSettings := storeTouched && (b.ReceiptHeader == "" || b.DefaultLowStock < 0 || b.DefaultLowStock > 1_000_000 || len(b.ReceiptHeader) > 200 || len(b.NavbarTitle) > 80 || len(b.PromptPayReceiverName) > 200 || len(b.StorePhone) > 30 || len(b.StoreEmail) > 254 || len(b.StoreAddress) > 500 || !validEmail || !validTaxID || !posImageWithinLimit(b.LogoData, 2*1024*1024) || !validImageData(b.LogoData, true) || !posImageWithinLimit(b.NavbarIconData, 2*1024*1024) || !validImageData(b.NavbarIconData, true) || !posImageWithinLimit(b.PaymentQRImage, 2*1024*1024) || !validImageData(b.PaymentQRImage, true))
	invalidDisplaySettings := displayTouched && (len(b.CustomerDisplayTitle) > 120 || len(b.CustomerDisplayHighlight) > 120 || len(b.CustomerDisplaySubtitle) > 300 || len(b.CustomerDisplayCardText) > 300 || len(b.CustomerDisplayCTAText) > 160)
	invalidPrinterSettings := printerTouched && len(b.ReceiptFooter) > 500
	invalidTaxSettings := taxTouched && (b.TaxRatePercent < 0 || b.TaxRatePercent > 100)
	if invalidStoreSettings {
		writeJSON(w, 400, map[string]string{"error": "กรุณาตรวจข้อมูลร้าน อีเมล เลขผู้เสียภาษี และรูปภาพอีกครั้ง"})
		return
	}
	if invalidStockSettings {
		writeJSON(w, 400, map[string]string{"error": "กรุณาตรวจชื่อและการตั้งค่าคลังสินค้าอีกครั้ง"})
		return
	}
	if invalidDisplaySettings {
		writeJSON(w, 400, map[string]string{"error": "กรุณาตรวจข้อความจอลูกค้าอีกครั้ง"})
		return
	}
	if invalidPrinterSettings {
		writeJSON(w, 400, map[string]string{"error": "ข้อความท้ายใบเสร็จยาวเกิน 500 ตัวอักษร"})
		return
	}
	if invalidTaxSettings {
		writeJSON(w, 400, map[string]string{"error": "อัตราภาษีต้องอยู่ระหว่าง 0 ถึง 100"})
		return
	}
	if promptPayTouched {
		b.PromptPayType, b.PromptPayID, b.PromptPayReceiverName = strings.TrimSpace(b.PromptPayType), strings.TrimSpace(b.PromptPayID), strings.TrimSpace(b.PromptPayReceiverName)
		if b.PromptPayType == "" {
			b.PromptPayType = "mobile"
		}
		if b.PromptPayType != "mobile" && b.PromptPayType != "national_id" && b.PromptPayType != "ewallet" {
			writeJSON(w, 400, map[string]string{"error": "ประเภท PromptPay ไม่ถูกต้อง"})
			return
		}
		if b.PromptPayID != "" {
			if _, _, err := normalizePromptPayTarget(promptPaySettings{ID: b.PromptPayID, Type: b.PromptPayType}); err != nil {
				writeJSON(w, 400, map[string]string{"error": "PromptPay setting ไม่ถูกต้อง"})
				return
			}
		}
	}
	if themeTouched {
		if b.Theme != "dark" {
			b.Theme = "light"
		}
		if b.Language != "en" {
			b.Language = "th"
		}
	}
	if previous.SecondaryStockEnabled && !b.SecondaryStockEnabled {
		var remaining int64
		if err := a.db.QueryRowContext(r.Context(), `select coalesce(sum(secondary_stock_quantity),0) from pos_products where admin_id=$1 and deleted_at is null and track_stock`, user.ID).Scan(&remaining); err != nil {
			writePOSInternalError(w, r, err)
			return
		}
		if remaining != 0 {
			writeJSON(w, http.StatusConflict, map[string]any{"error": fmt.Sprintf("ยังปิดสต็อกที่ 2 ไม่ได้: คงเหลือ %d ชิ้น กรุณาโอนกลับสต็อกหลักให้หมดก่อน", remaining), "remainingSecondaryStockQuantity": remaining})
			return
		}
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(r.Context(), `insert into pos_settings (admin_id,promptpay_type,promptpay_id,promptpay_receiver_name,receipt_header,receipt_footer,logo_data,default_low_stock,theme,language,tax_rate_percent,prices_include_tax,inherit_booking_promptpay,payment_qr_image,store_tax_id,store_phone,store_email,store_address,navbar_title,navbar_icon_data,customer_display_title,customer_display_highlight,customer_display_subtitle,customer_display_card_text,customer_display_cta_text,secondary_stock_enabled,primary_stock_name,secondary_stock_name,sale_stock_location) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29) on conflict (admin_id) do update set promptpay_type=excluded.promptpay_type,promptpay_id=excluded.promptpay_id,promptpay_receiver_name=excluded.promptpay_receiver_name,receipt_header=excluded.receipt_header,receipt_footer=excluded.receipt_footer,logo_data=excluded.logo_data,default_low_stock=excluded.default_low_stock,theme=excluded.theme,language=excluded.language,tax_rate_percent=excluded.tax_rate_percent,prices_include_tax=excluded.prices_include_tax,inherit_booking_promptpay=excluded.inherit_booking_promptpay,payment_qr_image=excluded.payment_qr_image,store_tax_id=excluded.store_tax_id,store_phone=excluded.store_phone,store_email=excluded.store_email,store_address=excluded.store_address,navbar_title=excluded.navbar_title,navbar_icon_data=excluded.navbar_icon_data,customer_display_title=excluded.customer_display_title,customer_display_highlight=excluded.customer_display_highlight,customer_display_subtitle=excluded.customer_display_subtitle,customer_display_card_text=excluded.customer_display_card_text,customer_display_cta_text=excluded.customer_display_cta_text,secondary_stock_enabled=excluded.secondary_stock_enabled,primary_stock_name=excluded.primary_stock_name,secondary_stock_name=excluded.secondary_stock_name,sale_stock_location=excluded.sale_stock_location,updated_at=now()`, user.ID, b.PromptPayType, b.PromptPayID, b.PromptPayReceiverName, b.ReceiptHeader, b.ReceiptFooter, b.LogoData, b.DefaultLowStock, b.Theme, b.Language, b.TaxRatePercent, b.PricesIncludeTax, b.InheritBookingPromptPay, b.PaymentQRImage, b.StoreTaxID, b.StorePhone, b.StoreEmail, b.StoreAddress, b.NavbarTitle, b.NavbarIconData, b.CustomerDisplayTitle, b.CustomerDisplayHighlight, b.CustomerDisplaySubtitle, b.CustomerDisplayCardText, b.CustomerDisplayCTAText, b.SecondaryStockEnabled, b.PrimaryStockName, b.SecondaryStockName, b.SaleStockLocation)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	if err = a.insertActivityLogTx(r.Context(), tx, posActorType(user), posActorID(user), "update_pos_settings", "pos_settings", user.ID, map[string]any{"adminId": user.ID, "before": posSettingsAuditSnapshot(previous), "after": posSettingsAuditSnapshot(b)}); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]string{"status": "settings_updated"})
}

func decodePOSProduct(w http.ResponseWriter, r *http.Request) (posProductRecord, bool) {
	var p posProductRecord
	var raw json.RawMessage
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 3<<20)).Decode(&raw) != nil || json.Unmarshal(raw, &p) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid product"})
		return p, false
	}
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(raw, &fields)
	if _, present := fields["trackStock"]; !present {
		p.TrackStock = true
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
	if !p.TrackStock {
		p.StockQuantity = 0
		p.SecondaryStockQuantity = 0
		p.LowStockThreshold = 0
		p.UnitsPerPack = 0
	}
	if p.SKU == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "กรุณากรอกรหัส SKU", "code": "sku_required"})
		return p, false
	}
	if p.Name == "" || len(p.Name) > 160 || len(p.SKU) > 80 || len(p.Barcode) > 100 || len(p.Description) > 1000 || len(p.Category) > 100 || len(p.Unit) > 40 || !posImageWithinLimit(p.ImageData, 2*1024*1024) || !validImageData(p.ImageData, true) || p.PriceSatang < 0 || p.PriceSatang > 1_000_000_000 || p.CostSatang < 0 || p.CostSatang > 1_000_000_000 || p.StockQuantity < 0 || p.SecondaryStockQuantity < 0 || (!p.TrackStock && (p.StockQuantity != 0 || p.SecondaryStockQuantity != 0)) || p.LowStockThreshold < 0 || p.UnitsPerPack < 0 || p.UnitsPerPack > 1_000_000 {
		writeJSON(w, 400, map[string]string{"error": "invalid product"})
		return p, false
	}
	return p, true
}

func posProductConflict(err error) (message, code string, ok bool) {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		return "", "", false
	}
	switch pgErr.ConstraintName {
	case "idx_pos_products_sku":
		return "รหัส SKU นี้ถูกใช้แล้ว กรุณาใช้รหัสอื่น", "duplicate_sku", true
	case "idx_pos_products_barcode":
		return "บาร์โค้ดนี้ถูกใช้กับสินค้าอื่นแล้ว", "duplicate_barcode", true
	default:
		return "ข้อมูลสินค้าซ้ำกับรายการเดิม", "duplicate_product", true
	}
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
	if p.TrackStock && p.LowStockThreshold == 0 {
		settings, _ := a.ensurePOSSettings(r.Context(), user.ID)
		p.LowStockThreshold = settings.DefaultLowStock
	}
	p.ID = "product-" + randHex(8)
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(r.Context(), `insert into pos_products (id,admin_id,sku,category,name,price_thb,price_satang,cost_thb,cost_satang,stock_quantity,secondary_stock_quantity,track_stock,low_stock_threshold,active,unit,units_per_pack,image_data,barcode,description,is_popular) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`, p.ID, user.ID, p.SKU, p.Category, p.Name, p.PriceTHB, p.PriceSatang, p.CostTHB, p.CostSatang, p.StockQuantity, p.SecondaryStockQuantity, p.TrackStock, p.LowStockThreshold, p.Active, p.Unit, p.UnitsPerPack, p.ImageData, p.Barcode, p.Description, p.Popular)
	if err != nil {
		if message, code, conflict := posProductConflict(err); conflict {
			writeJSON(w, http.StatusConflict, map[string]string{"error": message, "code": code})
		} else {
			writePOSInternalError(w, r, err)
		}
		return
	}
	for _, initial := range []struct {
		location string
		quantity int
	}{{"primary", p.StockQuantity}, {"secondary", p.SecondaryStockQuantity}} {
		if p.TrackStock && initial.quantity > 0 {
			if _, err = tx.ExecContext(r.Context(), `insert into pos_stock_movements (admin_id,product_id,delta,balance,reason,note,actor_id,actor_type,actor_name,unit_cost_thb,total_cost_thb,previous_cost_thb,resulting_cost_thb,unit_cost_satang,gross_total_satang,net_total_satang,resulting_cost_satang,stock_location) values ($1,$2,$3,$3,'restock','สต็อกเริ่มต้น',$4,$5,$6,$7,$8,0,$7,$9,$10,$10,$9,$11)`, user.ID, p.ID, initial.quantity, posActorID(user), posActorType(user), posActorName(user), p.CostTHB, initial.quantity*p.CostTHB, p.CostSatang, int64(initial.quantity)*p.CostSatang, initial.location); err != nil {
				writePOSInternalError(w, r, err)
				return
			}
		}
	}
	if err = a.insertActivityLogTx(r.Context(), tx, posActorType(user), posActorID(user), "create_pos_product", "pos_product", p.ID, map[string]any{"adminId": user.ID, "after": posProductAuditSnapshot(p)}); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	writeJSON(w, 201, p)
}

func (a *app) patchPOSProduct(w http.ResponseWriter, r *http.Request, user adminUser, id string) {
	p, ok := decodePOSProduct(w, r)
	if !ok {
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer tx.Rollback()
	var previous posProductRecord
	if err = tx.QueryRowContext(r.Context(), `select sku,category,name,price_satang,cost_satang,stock_quantity,secondary_stock_quantity,track_stock,low_stock_threshold,active,unit,units_per_pack,image_data,barcode,description,is_popular from pos_products where id=$1 and admin_id=$2 and deleted_at is null for update`, id, user.ID).Scan(&previous.SKU, &previous.Category, &previous.Name, &previous.PriceSatang, &previous.CostSatang, &previous.StockQuantity, &previous.SecondaryStockQuantity, &previous.TrackStock, &previous.LowStockThreshold, &previous.Active, &previous.Unit, &previous.UnitsPerPack, &previous.ImageData, &previous.Barcode, &previous.Description, &previous.Popular); err != nil {
		writeJSON(w, 404, map[string]string{"error": "product not found"})
		return
	}
	if previous.TrackStock && !p.TrackStock && (previous.StockQuantity != 0 || previous.SecondaryStockQuantity != 0) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "กรุณาปรับยอดทั้งสองสต็อกเป็นศูนย์ก่อนปิดการติดตามสต็อก"})
		return
	}
	if !hasPOSPermission(user, "view_costs") {
		// Hidden/default client values must not overwrite the stored average cost.
		p.CostSatang = previous.CostSatang
		p.CostTHB = roundedBaht(previous.CostSatang)
	}
	result, err := tx.ExecContext(r.Context(), `update pos_products set category=$3,name=$4,price_thb=$5,price_satang=$6,cost_thb=$7,cost_satang=$8,track_stock=$9,low_stock_threshold=$10,active=$11,unit=$12,units_per_pack=$13,image_data=$14,barcode=$15,description=$16,is_popular=$17,updated_at=now() where id=$1 and admin_id=$2 and deleted_at is null`, id, user.ID, p.Category, p.Name, p.PriceTHB, p.PriceSatang, p.CostTHB, p.CostSatang, p.TrackStock, p.LowStockThreshold, p.Active, p.Unit, p.UnitsPerPack, p.ImageData, p.Barcode, p.Description, p.Popular)
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": "SKU ซ้ำหรือข้อมูลสินค้าไม่ถูกต้อง"})
		return
	}
	if count, _ := result.RowsAffected(); count == 0 {
		writeJSON(w, 404, map[string]string{"error": "product not found"})
		return
	}
	p.SKU, p.StockQuantity, p.SecondaryStockQuantity = previous.SKU, previous.StockQuantity, previous.SecondaryStockQuantity
	if err = a.insertActivityLogTx(r.Context(), tx, posActorType(user), posActorID(user), "update_pos_product", "pos_product", id, map[string]any{"adminId": user.ID, "before": posProductAuditSnapshot(previous), "after": posProductAuditSnapshot(p)}); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "product_updated"})
}

func (a *app) deletePOSProduct(w http.ResponseWriter, r *http.Request, user adminUser, id string) {
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer tx.Rollback()
	var name, sku string
	var stock int
	if err = tx.QueryRowContext(r.Context(), `select name,sku,stock_quantity from pos_products where id=$1 and admin_id=$2 and deleted_at is null for update`, id, user.ID).Scan(&name, &sku, &stock); err != nil {
		writeJSON(w, 404, map[string]string{"error": "product not found"})
		return
	}
	result, err := tx.ExecContext(r.Context(), `update pos_products set active=false,deleted_at=now(),updated_at=now() where id=$1 and admin_id=$2 and deleted_at is null`, id, user.ID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "ปิดการขายสินค้าไม่สำเร็จ"})
		return
	}
	if count, _ := result.RowsAffected(); count == 0 {
		writeJSON(w, 404, map[string]string{"error": "product not found"})
		return
	}
	if err = a.insertActivityLogTx(r.Context(), tx, posActorType(user), posActorID(user), "disable_pos_product", "pos_product", id, map[string]any{"adminId": user.ID, "name": name, "sku": sku, "stockQuantity": stock, "beforeActive": true, "afterActive": false}); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
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
		writePOSInternalError(w, r, err)
		return
	}
	defer tx.Rollback()
	var previousBalance int
	var previousCostSatang int64
	var trackStock bool
	if err = tx.QueryRowContext(r.Context(), `select stock_quantity,cost_satang,track_stock from pos_products where id=$1 and admin_id=$2 and deleted_at is null for update`, id, user.ID).Scan(&previousBalance, &previousCostSatang, &trackStock); err != nil {
		writeJSON(w, 404, map[string]string{"error": "product not found"})
		return
	}
	if !trackStock {
		writeJSON(w, 409, map[string]string{"error": "สินค้านี้ไม่ติดตามสต็อก"})
		return
	}
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
		_, err = tx.ExecContext(r.Context(), `insert into pos_stock_movements (admin_id,product_id,delta,balance,reason,note,actor_id,actor_type,actor_name,stock_location) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'primary')`, user.ID, id, b.Delta, balance, reason, strings.TrimSpace(b.Note), posActorID(user), posActorType(user), posActorName(user))
	}
	resultingCostSatang := previousCostSatang
	if b.CostSatang != nil {
		resultingCostSatang = *b.CostSatang
	}
	if err == nil {
		err = a.insertActivityLogTx(r.Context(), tx, posActorType(user), posActorID(user), "adjust_pos_stock", "pos_product", id, map[string]any{
			"adminId": user.ID, "delta": b.Delta, "beforeQuantity": previousBalance, "afterQuantity": balance,
			"beforeCostSatang": previousCostSatang, "afterCostSatang": resultingCostSatang, "hasNote": strings.TrimSpace(b.Note) != "",
		})
	}
	if err != nil || tx.Commit() != nil {
		writeJSON(w, 500, map[string]string{"error": "บันทึกสต็อกไม่สำเร็จ"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "stock_adjusted"})
}

type posStockBatchRequest struct {
	Name                     string                   `json:"name"`
	Mode                     string                   `json:"mode"`
	Note                     string                   `json:"note"`
	SupplierID               string                   `json:"supplierId"`
	ExternalReferenceNo      string                   `json:"externalReferenceNo"`
	DiscountType             string                   `json:"discountType"`
	DiscountAmountSatang     int64                    `json:"discountAmountSatang"`
	DiscountRateBPS          int                      `json:"discountRateBps"`
	StockLocation            string                   `json:"stockLocation"`
	SourceStockLocation      string                   `json:"sourceStockLocation"`
	DestinationStockLocation string                   `json:"destinationStockLocation"`
	Items                    []posStockBatchItemInput `json:"items"`
}

type posStockBatchItemInput struct {
	ProductID        string `json:"productId"`
	Quantity         int    `json:"quantity"`
	TargetQuantity   int    `json:"targetQuantity"`
	CostTHB          *int   `json:"costThb"`
	CostSatang       *int64 `json:"costSatang"`
	TotalValueSatang *int64 `json:"totalValueSatang"`
	Note             string `json:"note"`
}

func weightedAverageCostSatang(currentQuantity int, currentCostSatang int64, incomingQuantity int, incomingNetSatang int64) int64 {
	newQuantity := currentQuantity + incomingQuantity
	if newQuantity <= 0 {
		return currentCostSatang
	}
	total := int64(currentQuantity)*currentCostSatang + incomingNetSatang
	return (total + int64(newQuantity)/2) / int64(newQuantity)
}

func unitCostFromLineTotalSatang(lineTotalSatang int64, quantity int) int64 {
	if lineTotalSatang < 0 || quantity <= 0 {
		return 0
	}
	return (lineTotalSatang + int64(quantity)/2) / int64(quantity)
}

func stockDiscountSatang(grossSatang int64, discountType string, amountSatang int64, rateBPS int) int64 {
	if discountType == "percent" {
		rate := int64(rateBPS)
		return (grossSatang/10000)*rate + ((grossSatang%10000)*rate+5000)/10000
	}
	return amountSatang
}

func allocateStockDiscount(unitCosts []int64, quantities []int, discountSatang int64) ([]int64, error) {
	if len(unitCosts) != len(quantities) || discountSatang < 0 {
		return nil, errors.New("invalid discount")
	}
	lineTotals := make([]int64, len(unitCosts))
	for index := range unitCosts {
		if unitCosts[index] < 0 || quantities[index] <= 0 {
			return nil, errors.New("invalid discount item")
		}
		lineTotals[index] = unitCosts[index] * int64(quantities[index])
	}
	return allocateStockDiscountByLineTotals(lineTotals, quantities, discountSatang)
}

func allocateStockDiscountByLineTotals(lineTotals []int64, quantities []int, discountSatang int64) ([]int64, error) {
	allocated := make([]int64, len(lineTotals))
	if len(lineTotals) != len(quantities) || discountSatang < 0 {
		return nil, errors.New("invalid discount")
	}
	capacities := append([]int64(nil), lineTotals...)
	var gross int64
	for index := range capacities {
		if capacities[index] < 0 || quantities[index] <= 0 || gross > math.MaxInt64-capacities[index] {
			return nil, errors.New("invalid discount item")
		}
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
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10)).Decode(&b) != nil || (b.Mode != "in" && b.Mode != "out" && b.Mode != "adjust" && b.Mode != "transfer") || len(b.Items) == 0 || len(b.Items) > 200 || len(b.Note) > 300 {
		writeJSON(w, 400, map[string]string{"error": "invalid stock batch"})
		return
	}
	b.Name, b.Note, b.SupplierID, b.ExternalReferenceNo = strings.TrimSpace(b.Name), strings.TrimSpace(b.Note), strings.TrimSpace(b.SupplierID), strings.TrimSpace(b.ExternalReferenceNo)
	if b.StockLocation == "" {
		b.StockLocation = "primary"
	}
	settings, _ := a.ensurePOSSettings(r.Context(), user.ID)
	if !validStockLocation(b.StockLocation) || (b.StockLocation == "secondary" && !settings.SecondaryStockEnabled) {
		writeJSON(w, 400, map[string]string{"error": "สต็อกที่เลือกไม่ถูกต้อง"})
		return
	}
	if b.Mode == "transfer" {
		if !settings.SecondaryStockEnabled || !validStockLocation(b.SourceStockLocation) || !validStockLocation(b.DestinationStockLocation) || b.SourceStockLocation == b.DestinationStockLocation {
			writeJSON(w, 400, map[string]string{"error": "ต้นทางหรือปลายทางการโอนไม่ถูกต้อง"})
			return
		}
		b.StockLocation = b.SourceStockLocation
	}
	if b.DiscountType == "" {
		b.DiscountType = "amount"
	}
	if b.Mode != "in" {
		b.SupplierID, b.ExternalReferenceNo, b.DiscountType, b.DiscountAmountSatang, b.DiscountRateBPS = "", "", "amount", 0, 0
	}
	if b.Name == "" || len(b.Name) > 160 {
		writeJSON(w, 400, map[string]string{"error": "กรุณาระบุชื่อรายการไม่เกิน 160 ตัวอักษร"})
		return
	}
	if len(b.ExternalReferenceNo) > 120 {
		writeJSON(w, 400, map[string]string{"error": "เลขที่ใบส่งของหรือเลขบิลต้องไม่เกิน 120 ตัวอักษร"})
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
		// Backward compatibility: older clients send costSatang per unit.
		if b.Mode == "in" && item.TotalValueSatang == nil && item.CostSatang != nil && item.Quantity > 0 && *item.CostSatang <= math.MaxInt64/int64(item.Quantity) {
			value := *item.CostSatang * int64(item.Quantity)
			item.TotalValueSatang = &value
		}
		if item.ProductID == "" || seen[item.ProductID] || item.Quantity > 1_000_000 || item.TargetQuantity > 1_000_000 || len(item.Note) > 300 || (b.Mode != "adjust" && item.Quantity <= 0) || (b.Mode == "adjust" && item.TargetQuantity < 0) || (item.CostSatang != nil && (*item.CostSatang < 0 || *item.CostSatang > 1_000_000_000)) || (item.TotalValueSatang != nil && (*item.TotalValueSatang < 0 || *item.TotalValueSatang > 1_000_000_000_000_000)) || (b.Mode == "in" && item.TotalValueSatang == nil) {
			writeJSON(w, 400, map[string]string{"error": "ข้อมูลสินค้าในรายการไม่ถูกต้อง"})
			return
		}
		seen[item.ProductID] = true
		ids = append(ids, item.ProductID)
	}
	sort.Strings(ids)
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writePOSInternalError(w, r, err)
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
		primaryStock   int
		secondaryStock int
		trackStock     bool
		costSatang     int64
		name           string
	}
	locked := map[string]lockedProduct{}
	for _, id := range ids {
		var p lockedProduct
		if err = tx.QueryRowContext(r.Context(), `select stock_quantity,secondary_stock_quantity,track_stock,cost_satang,name from pos_products where id=$1 and admin_id=$2 and deleted_at is null for update`, id, user.ID).Scan(&p.primaryStock, &p.secondaryStock, &p.trackStock, &p.costSatang, &p.name); err != nil {
			writeJSON(w, 404, map[string]string{"error": "ไม่พบสินค้าในรายการ"})
			return
		}
		if !p.trackStock {
			writeJSON(w, 400, map[string]string{"error": "สินค้าที่ไม่ติดตามสต็อกไม่สามารถทำรายการสต็อกได้"})
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
	lineTotals := make([]int64, len(b.Items))
	quantities := make([]int, len(b.Items))
	var grossTotalSatang int64
	if b.Mode == "in" {
		for index, item := range b.Items {
			lineTotals[index], quantities[index] = *item.TotalValueSatang, item.Quantity
			if grossTotalSatang > math.MaxInt64-lineTotals[index] {
				writeJSON(w, 400, map[string]string{"error": "มูลค่ารวมสินค้าเกินขอบเขตที่รองรับ"})
				return
			}
			grossTotalSatang += lineTotals[index]
		}
	}
	discountSatang := stockDiscountSatang(grossTotalSatang, b.DiscountType, b.DiscountAmountSatang, b.DiscountRateBPS)
	allocatedDiscounts, allocationErr := allocateStockDiscountByLineTotals(lineTotals, quantities, discountSatang)
	if b.Mode != "in" {
		allocatedDiscounts = make([]int64, len(b.Items))
		allocationErr = nil
	}
	if allocationErr != nil {
		writeJSON(w, 400, map[string]string{"error": "ส่วนลดเกินมูลค่าสินค้า"})
		return
	}
	batchID := "stock-" + randHex(8)
	if _, err = tx.ExecContext(r.Context(), `insert into pos_stock_batches (id,admin_id,name,mode,note,actor_id,actor_type,actor_name,supplier_id,supplier_name,external_reference_no,discount_type,discount_rate_bps,gross_total_satang,discount_satang,net_total_satang,total_cost_satang,total_cost_thb,stock_location,source_stock_location,destination_stock_location) values ($1,$2,$3,$4,$5,$6,$7,$8,nullif($9,''),$10,$11,$12,$13,$14,$15,$16,$16,$17,$18,nullif($19,''),nullif($20,''))`, batchID, user.ID, b.Name, b.Mode, b.Note, posActorID(user), posActorType(user), posActorName(user), b.SupplierID, supplierName, b.ExternalReferenceNo, b.DiscountType, b.DiscountRateBPS, grossTotalSatang, discountSatang, grossTotalSatang-discountSatang, roundedBaht(grossTotalSatang-discountSatang), b.StockLocation, b.SourceStockLocation, b.DestinationStockLocation); err != nil {
		writeJSON(w, 500, map[string]string{"error": "สร้างเอกสารสต็อกไม่สำเร็จ"})
		return
	}
	var totalBatchCostSatang int64
	auditItems := make([]map[string]any, 0, len(b.Items))
	for index, item := range b.Items {
		product := locked[item.ProductID]
		current := product.primaryStock
		if b.StockLocation == "secondary" {
			current = product.secondaryStock
		}
		delta := item.Quantity
		if b.Mode == "out" {
			delta = -item.Quantity
		}
		if b.Mode == "adjust" {
			delta = item.TargetQuantity - current
		}
		if b.Mode == "transfer" {
			delta = -item.Quantity
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
			grossLineSatang = *item.TotalValueSatang
			unitCostSatang = unitCostFromLineTotalSatang(grossLineSatang, item.Quantity)
			allocatedDiscountSatang = allocatedDiscounts[index]
			netLineSatang = grossLineSatang - allocatedDiscountSatang
			resultingCostSatang = weightedAverageCostSatang(product.primaryStock+product.secondaryStock, product.costSatang, item.Quantity, netLineSatang)
		}
		totalBatchCostSatang += netLineSatang
		auditItems = append(auditItems, map[string]any{"productId": item.ProductID, "delta": delta, "beforeQuantity": current, "afterQuantity": balance, "beforeCostSatang": product.costSatang, "afterCostSatang": resultingCostSatang, "grossSatang": grossLineSatang, "discountSatang": allocatedDiscountSatang, "netSatang": netLineSatang})
		if b.Mode == "transfer" {
			if b.SourceStockLocation == "primary" {
				_, err = tx.ExecContext(r.Context(), `update pos_products set stock_quantity=$3,secondary_stock_quantity=secondary_stock_quantity+$4,updated_at=now() where id=$1 and admin_id=$2`, item.ProductID, user.ID, balance, item.Quantity)
			} else {
				_, err = tx.ExecContext(r.Context(), `update pos_products set secondary_stock_quantity=$3,stock_quantity=stock_quantity+$4,updated_at=now() where id=$1 and admin_id=$2`, item.ProductID, user.ID, balance, item.Quantity)
			}
		} else if b.StockLocation == "secondary" {
			_, err = tx.ExecContext(r.Context(), `update pos_products set secondary_stock_quantity=$3,cost_satang=$4,cost_thb=$5,updated_at=now() where id=$1 and admin_id=$2`, item.ProductID, user.ID, balance, resultingCostSatang, roundedBaht(resultingCostSatang))
		} else {
			_, err = tx.ExecContext(r.Context(), `update pos_products set stock_quantity=$3,cost_satang=$4,cost_thb=$5,updated_at=now() where id=$1 and admin_id=$2`, item.ProductID, user.ID, balance, resultingCostSatang, roundedBaht(resultingCostSatang))
		}
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": "บันทึกรายการสต็อกไม่สำเร็จ"})
			return
		}
		if delta != 0 || b.Mode == "adjust" {
			reason := "adjustment"
			if b.Mode == "in" {
				reason = "restock"
			}
			if b.Mode == "transfer" {
				reason = "transfer_out"
			}
			movementNote := b.Note
			if item.Note != "" {
				if movementNote != "" {
					movementNote += " • "
				}
				movementNote += item.Note
			}
			if _, err = tx.ExecContext(r.Context(), `insert into pos_stock_movements (admin_id,product_id,batch_id,delta,balance,reason,note,actor_id,actor_type,actor_name,unit_cost_thb,total_cost_thb,previous_cost_thb,resulting_cost_thb,unit_cost_satang,gross_total_satang,allocated_discount_satang,net_total_satang,previous_cost_satang,resulting_cost_satang,stock_location) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`, user.ID, item.ProductID, batchID, delta, balance, reason, movementNote, posActorID(user), posActorType(user), posActorName(user), roundedBaht(unitCostSatang), roundedBaht(netLineSatang), roundedBaht(product.costSatang), roundedBaht(resultingCostSatang), unitCostSatang, grossLineSatang, allocatedDiscountSatang, netLineSatang, product.costSatang, resultingCostSatang, b.StockLocation); err != nil {
				writeJSON(w, 500, map[string]string{"error": "บันทึกประวัติสต็อกไม่สำเร็จ"})
				return
			}
			if b.Mode == "transfer" {
				destinationBalance := product.secondaryStock + item.Quantity
				if b.DestinationStockLocation == "primary" {
					destinationBalance = product.primaryStock + item.Quantity
				}
				if _, err = tx.ExecContext(r.Context(), `insert into pos_stock_movements (admin_id,product_id,batch_id,delta,balance,reason,note,actor_id,actor_type,actor_name,unit_cost_satang,gross_total_satang,net_total_satang,previous_cost_satang,resulting_cost_satang,stock_location) values ($1,$2,$3,$4,$5,'transfer_in',$6,$7,$8,$9,$10,$11,$11,$10,$10,$12)`, user.ID, item.ProductID, batchID, item.Quantity, destinationBalance, movementNote, posActorID(user), posActorType(user), posActorName(user), product.costSatang, netLineSatang, b.DestinationStockLocation); err != nil {
					writePOSInternalError(w, r, err)
					return
				}
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
	if err = a.insertActivityLogTx(r.Context(), tx, posActorType(user), posActorID(user), "adjust_pos_stock_batch", "pos_stock_batch", batchID, map[string]any{"adminId": user.ID, "mode": b.Mode, "name": b.Name, "externalReferenceNo": b.ExternalReferenceNo, "supplierId": b.SupplierID, "items": auditItems, "grossTotalSatang": grossTotalSatang, "discountSatang": discountSatang, "netTotalSatang": totalBatchCostSatang}); err != nil {
		writeJSON(w, 500, map[string]string{"error": "บันทึก audit สต็อกไม่สำเร็จ"})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": "บันทึกรายการสต็อกไม่สำเร็จ"})
		return
	}
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
		writePOSInternalError(w, r, err)
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
	RequestID            string   `json:"requestId"`
	BuyerType            string   `json:"buyerType"`
	BuyerID              string   `json:"buyerId"`
	BuyerName            string   `json:"buyerName"`
	BuyerIDs             []string `json:"buyerIds"`
	SplitMode            string   `json:"splitMode"`
	Phone                string   `json:"phone"`
	Action               string   `json:"action"`
	Method               string   `json:"method"`
	Note                 string   `json:"note"`
	ExpectedTotalTHB     int      `json:"expectedTotalThb"`
	ExpectedTotalSatang  int64    `json:"expectedTotalSatang"`
	DiscountType         string   `json:"discountType"`
	DiscountAmountSatang int64    `json:"discountAmountSatang"`
	DiscountRateBPS      int      `json:"discountRateBps"`
	CashReceivedSatang   int64    `json:"cashReceivedSatang"`
	ReferenceNumber      string   `json:"referenceNumber"`
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

func equalSplitShares(total int64, count int) []int64 {
	if total < 0 || count < 1 {
		return []int64{}
	}
	shares := make([]int64, count)
	base, remainder := total/int64(count), total%int64(count)
	for index := range shares {
		shares[index] = base
		if int64(index) < remainder {
			shares[index]++
		}
	}
	return shares
}

func (a *app) createPOSSale(w http.ResponseWriter, r *http.Request, user adminUser) {
	var b posSaleRequest
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10)).Decode(&b) != nil || len(b.Items) == 0 || len(b.Items) > 100 || len(b.Note) > 500 {
		writeJSON(w, 400, map[string]string{"error": "invalid sale"})
		return
	}
	b.RequestID, b.BuyerType, b.BuyerID, b.BuyerName, b.Action, b.Method, b.SplitMode = strings.TrimSpace(b.RequestID), strings.TrimSpace(b.BuyerType), strings.TrimSpace(b.BuyerID), strings.TrimSpace(b.BuyerName), strings.TrimSpace(b.Action), strings.TrimSpace(b.Method), strings.TrimSpace(b.SplitMode)
	if b.Action == "open" {
		b.Action = "hold"
	}
	if b.Action != "hold" && b.Action != "pay" {
		writeJSON(w, 400, map[string]string{"error": "invalid sale action"})
		return
	}
	isSplit := b.Action == "hold" && b.SplitMode == "equal"
	if b.SplitMode != "" && b.SplitMode != "none" && b.SplitMode != "equal" {
		writeJSON(w, 400, map[string]string{"error": "รูปแบบการหารบิลไม่ถูกต้อง"})
		return
	}
	if isSplit && (b.BuyerType != "member" || len(b.BuyerIDs) < 2 || len(b.BuyerIDs) > 50) {
		writeJSON(w, 400, map[string]string{"error": "บิลหารต้องเลือกสมาชิกอย่างน้อย 2 คน"})
		return
	}
	if b.Action == "hold" && !isSplit && (b.BuyerType != "member" || b.BuyerID == "") {
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
	if (b.DiscountAmountSatang > 0 || b.DiscountRateBPS > 0) && !requirePOSPermission(w, user, "discounts") {
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer tx.Rollback()
	settings, _ := a.ensurePOSSettings(r.Context(), user.ID)
	saleStockLocation := settings.SaleStockLocation
	if !settings.SecondaryStockEnabled || !validStockLocation(saleStockLocation) {
		saleStockLocation = "primary"
	}
	if b.RequestID != "" {
		if _, err = tx.ExecContext(r.Context(), `select pg_advisory_xact_lock(hashtextextended($1,0))`, user.ID+":sale:"+b.RequestID); err != nil {
			writePOSInternalError(w, r, err)
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
	splitAccountIDs := []string{}
	splitNames := []string{}
	if isSplit {
		seen := map[string]bool{}
		for _, rawID := range b.BuyerIDs {
			memberID := strings.TrimSpace(rawID)
			if memberID == "" || seen[memberID] {
				err = errors.New("duplicate split member")
				break
			}
			seen[memberID] = true
			var splitAccountID string
			splitAccountID, err = ensureBillingAccountTx(r.Context(), tx, user.ID, "member", memberID, "", "")
			if err != nil {
				break
			}
			var splitName string
			_ = tx.QueryRowContext(r.Context(), `select display_name from billing_accounts where id=$1`, splitAccountID).Scan(&splitName)
			splitAccountIDs = append(splitAccountIDs, splitAccountID)
			splitNames = append(splitNames, splitName)
		}
		buyerName = "หารร่วม · " + strings.Join(splitNames, ", ")
	} else if b.BuyerType == "member" {
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
		err = tx.QueryRowContext(r.Context(), `select id,sku,name,price_thb,price_satang,cost_thb,cost_satang,stock_quantity,secondary_stock_quantity,track_stock from pos_products where id=$1 and admin_id=$2 and active and deleted_at is null for update`, productID, user.ID).Scan(&p.ID, &p.SKU, &p.Name, &p.PriceTHB, &p.PriceSatang, &p.CostTHB, &p.CostSatang, &p.StockQuantity, &p.SecondaryStockQuantity, &p.TrackStock)
		available := productStockAt(p, saleStockLocation)
		if err != nil || (p.TrackStock && available < requestedTotals[productID]) {
			writeJSON(w, http.StatusConflict, map[string]any{"error": "สต็อกสินค้าไม่เพียงพอ", "productId": productID, "available": available, "stockLocation": saleStockLocation})
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
		line := posSaleItemRecord{ProductID: p.ID, ProductName: p.Name, SKU: p.SKU, Quantity: requested.Quantity, UnitPrice: p.PriceTHB, UnitPriceSatang: p.PriceSatang, UnitCostSatang: p.CostSatang, LineTotal: roundedBaht(lineTotalSatang), LineTotalSatang: lineTotalSatang, Note: strings.TrimSpace(requested.Note), StockTracked: p.TrackStock}
		subtotalSatang += lineTotalSatang
		costSatang += p.CostSatang * int64(requested.Quantity)
		items = append(items, line)
	}
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
		splitMode, splitCount := "none", 1
		if isSplit {
			splitMode, splitCount = "equal", len(splitAccountIDs)
		}
		_, err = tx.ExecContext(r.Context(), `insert into pos_sales (id,admin_id,billing_account_id,buyer_name,status,total_thb,cost_thb,cost_satang,payment_id,note,created_by,created_by_type,created_by_name,request_id,subtotal_satang,discount_type,discount_rate_bps,discount_satang,net_before_vat_satang,vat_rate_bps,vat_satang,prices_include_tax,total_satang,stock_location,split_mode,split_count) values ($1,$2,nullif($3,''),$4,$5,$6,$7,$8,nullif($9,''),$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`, saleID, user.ID, accountID, buyerName, status, roundedBaht(totalSatang), roundedBaht(costSatang), costSatang, paymentID, strings.TrimSpace(b.Note), posActorID(user), posActorType(user), posActorName(user), b.RequestID, subtotalSatang, b.DiscountType, b.DiscountRateBPS, discountSatang, netBeforeVATSatang, vatRateBPS, vatSatang, settings.PricesIncludeTax, totalSatang, saleStockLocation, splitMode, splitCount)
	}
	if err == nil && paymentID != "" {
		snapshot, _ := json.Marshal(map[string]any{"saleId": saleID, "buyerName": buyerName, "subtotalSatang": subtotalSatang, "discountSatang": discountSatang, "vatSatang": vatSatang, "totalSatang": totalSatang, "pricesIncludeTax": settings.PricesIncludeTax, "items": items})
		_, err = tx.ExecContext(r.Context(), `insert into billing_payment_allocations (payment_id,source_type,source_id,amount_thb,amount_satang,label,snapshot) values ($1,'pos',$2,$3,$4,$5,$6)`, paymentID, saleID, roundedBaht(totalSatang), totalSatang, "สินค้า · "+saleID, snapshot)
	}
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	for _, item := range items {
		_, err = tx.ExecContext(r.Context(), `insert into pos_sale_items (sale_id,product_id,product_name,sku,quantity,unit_price_thb,unit_cost_thb,unit_cost_satang,line_total_thb,unit_price_satang,line_total_satang,note,stock_tracked) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, saleID, item.ProductID, item.ProductName, item.SKU, item.Quantity, item.UnitPrice, roundedBaht(item.UnitCostSatang), item.UnitCostSatang, item.LineTotal, item.UnitPriceSatang, item.LineTotalSatang, item.Note, item.StockTracked)
		if err != nil {
			writePOSInternalError(w, r, err)
			return
		}
		if !item.StockTracked {
			continue
		}
		var balance int
		if saleStockLocation == "secondary" {
			err = tx.QueryRowContext(r.Context(), `update pos_products set secondary_stock_quantity=secondary_stock_quantity-$3,updated_at=now() where id=$1 and admin_id=$2 and secondary_stock_quantity>=$3 returning secondary_stock_quantity`, item.ProductID, user.ID, item.Quantity).Scan(&balance)
		} else {
			err = tx.QueryRowContext(r.Context(), `update pos_products set stock_quantity=stock_quantity-$3,updated_at=now() where id=$1 and admin_id=$2 and stock_quantity>=$3 returning stock_quantity`, item.ProductID, user.ID, item.Quantity).Scan(&balance)
		}
		if err == nil {
			lineCostSatang := item.UnitCostSatang * int64(item.Quantity)
			_, err = tx.ExecContext(r.Context(), `insert into pos_stock_movements (admin_id,product_id,sale_id,delta,balance,reason,note,actor_id,actor_type,actor_name,unit_cost_thb,total_cost_thb,previous_cost_thb,resulting_cost_thb,unit_cost_satang,gross_total_satang,net_total_satang,previous_cost_satang,resulting_cost_satang,stock_location) values ($1,$2,$3,$4,$5,'sale',$6,$7,$8,$9,$10,$11,$10,$10,$12,$13,$13,$12,$12,$14)`, user.ID, item.ProductID, saleID, -item.Quantity, balance, "ขายสินค้า", posActorID(user), posActorType(user), posActorName(user), roundedBaht(item.UnitCostSatang), roundedBaht(lineCostSatang), item.UnitCostSatang, lineCostSatang, saleStockLocation)
		}
		if err != nil {
			writePOSInternalError(w, r, err)
			return
		}
	}
	if err == nil && isSplit {
		shares := equalSplitShares(totalSatang, len(splitAccountIDs))
		for index, splitAccountID := range splitAccountIDs {
			share := shares[index]
			_, err = tx.ExecContext(r.Context(), `insert into pos_sale_splits (id,sale_id,billing_account_id,position,share_satang) values ($1,$2,$3,$4,$5)`, "split-"+randHex(8), saleID, splitAccountID, index, share)
			if err != nil {
				break
			}
		}
	}
	auditSaleItems := make([]map[string]any, 0, len(items))
	for _, item := range items {
		auditSaleItems = append(auditSaleItems, map[string]any{"productId": item.ProductID, "quantity": item.Quantity, "unitPriceSatang": item.UnitPriceSatang, "unitCostSatang": item.UnitCostSatang, "lineTotalSatang": item.LineTotalSatang})
	}
	if err = a.insertActivityLogTx(r.Context(), tx, posActorType(user), posActorID(user), "create_pos_sale", "pos_sale", saleID, map[string]any{
		"adminId": user.ID, "billingAccountId": accountID, "buyerType": b.BuyerType, "status": status,
		"subtotalSatang": subtotalSatang, "discountType": b.DiscountType, "discountRateBps": b.DiscountRateBPS,
		"discountSatang": discountSatang, "vatRateBps": vatRateBPS, "vatSatang": vatSatang,
		"pricesIncludeTax": settings.PricesIncludeTax, "totalSatang": totalSatang, "costSatang": costSatang,
		"paymentMethod": b.Method, "paymentId": paymentID, "cashReceivedSatang": b.CashReceivedSatang,
		"hasReference": strings.TrimSpace(b.ReferenceNumber) != "", "items": auditSaleItems,
		"splitMode": b.SplitMode, "splitCount": len(splitAccountIDs),
	}); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	writeJSON(w, 201, map[string]any{"saleId": saleID, "status": status, "totalThb": roundedBaht(totalSatang), "totalSatang": totalSatang, "paymentId": paymentID, "billingAccountId": accountID, "splitMode": b.SplitMode, "splitCount": len(splitAccountIDs)})
}

func (a *app) voidPOSSale(w http.ResponseWriter, r *http.Request, user adminUser, saleID string) {
	var b struct {
		Note string `json:"note"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&b)
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer tx.Rollback()
	var status, stockLocation string
	err = tx.QueryRowContext(r.Context(), `select status,stock_location from pos_sales where id=$1 and admin_id=$2 for update`, saleID, user.ID).Scan(&status, &stockLocation)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, 404, map[string]string{"error": "sale not found"})
		return
	}
	if err != nil || status != "open" {
		writeJSON(w, 409, map[string]string{"error": "ยกเลิกได้เฉพาะบิลที่ยังไม่ชำระ"})
		return
	}
	var splitCount, paidSplitCount int
	splitRows, splitErr := tx.QueryContext(r.Context(), `select status from pos_sale_splits where sale_id=$1 for update`, saleID)
	if splitErr != nil {
		writePOSInternalError(w, r, splitErr)
		return
	}
	for splitRows.Next() {
		var splitStatus string
		if err = splitRows.Scan(&splitStatus); err != nil {
			splitRows.Close()
			writePOSInternalError(w, r, err)
			return
		}
		splitCount++
		if splitStatus == "paid" {
			paidSplitCount++
		}
	}
	err = splitRows.Err()
	splitRows.Close()
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	if paidSplitCount > 0 {
		writeJSON(w, 409, map[string]string{"error": "บิลหารมีสมาชิกชำระแล้ว ต้องคืนเงินก่อนยกเลิกทั้งชุด"})
		return
	}
	rows, err := tx.QueryContext(r.Context(), `select product_id,quantity,unit_cost_satang,stock_tracked from pos_sale_items where sale_id=$1 and product_id is not null for update`, saleID)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	type returned struct {
		id             string
		quantity       int
		unitCostSatang int64
		stockTracked   bool
	}
	returns := []returned{}
	for rows.Next() {
		var item returned
		_ = rows.Scan(&item.id, &item.quantity, &item.unitCostSatang, &item.stockTracked)
		returns = append(returns, item)
	}
	rows.Close()
	for _, item := range returns {
		if !item.stockTracked {
			continue
		}
		var balance int
		if stockLocation == "secondary" {
			err = tx.QueryRowContext(r.Context(), `update pos_products set secondary_stock_quantity=secondary_stock_quantity+$3,updated_at=now() where id=$1 and admin_id=$2 returning secondary_stock_quantity`, item.id, user.ID, item.quantity).Scan(&balance)
		} else {
			err = tx.QueryRowContext(r.Context(), `update pos_products set stock_quantity=stock_quantity+$3,updated_at=now() where id=$1 and admin_id=$2 returning stock_quantity`, item.id, user.ID, item.quantity).Scan(&balance)
		}
		if err != nil {
			writePOSInternalError(w, r, err)
			return
		}
		lineCostSatang := item.unitCostSatang * int64(item.quantity)
		_, err = tx.ExecContext(r.Context(), `insert into pos_stock_movements (admin_id,product_id,sale_id,delta,balance,reason,note,actor_id,actor_type,actor_name,unit_cost_thb,total_cost_thb,previous_cost_thb,resulting_cost_thb,unit_cost_satang,gross_total_satang,net_total_satang,previous_cost_satang,resulting_cost_satang,stock_location) values ($1,$2,$3,$4,$5,'void',$6,$7,$8,$9,$10,$11,$10,$10,$12,$13,$13,$12,$12,$14)`, user.ID, item.id, saleID, item.quantity, balance, strings.TrimSpace(b.Note), posActorID(user), posActorType(user), posActorName(user), roundedBaht(item.unitCostSatang), roundedBaht(lineCostSatang), item.unitCostSatang, lineCostSatang, stockLocation)
		if err != nil {
			writePOSInternalError(w, r, err)
			return
		}
	}
	_, err = tx.ExecContext(r.Context(), `update pos_sales set status='void',note=case when $3='' then note else $3 end,voided_at=now(),updated_at=now() where id=$1 and admin_id=$2`, saleID, user.ID, strings.TrimSpace(b.Note))
	if err == nil && splitCount > 0 {
		_, err = tx.ExecContext(r.Context(), `update pos_sale_splits set status='void',updated_at=now() where sale_id=$1 and status='open'`, saleID)
	}
	returnItems := make([]map[string]any, 0, len(returns))
	for _, item := range returns {
		returnItems = append(returnItems, map[string]any{"productId": item.id, "quantityReturned": item.quantity, "unitCostSatang": item.unitCostSatang})
	}
	if err == nil {
		err = a.insertActivityLogTx(r.Context(), tx, posActorType(user), posActorID(user), "void_pos_sale", "pos_sale", saleID, map[string]any{"adminId": user.ID, "beforeStatus": status, "afterStatus": "void", "hasNote": strings.TrimSpace(b.Note) != "", "returnedItems": returnItems})
	}
	if err != nil || tx.Commit() != nil {
		writeJSON(w, 500, map[string]string{"error": "ยกเลิกบิลไม่สำเร็จ"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "sale_voided"})
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

func splitPOSSourceID(splitID string) string { return "split:" + splitID }

func parseSplitPOSSourceID(sourceID string) (string, bool) {
	if !strings.HasPrefix(sourceID, "split:") {
		return "", false
	}
	id := strings.TrimSpace(strings.TrimPrefix(sourceID, "split:"))
	return id, id != ""
}

func splitPOSBillingSnapshot(raw json.RawMessage, splitID string, position, count, paidCount int, share int64) json.RawMessage {
	value := map[string]any{}
	_ = json.Unmarshal(raw, &value)
	value["splitId"] = splitID
	value["splitMode"] = "equal"
	value["splitPosition"] = position + 1
	value["splitCount"] = count
	value["splitPaidCount"] = paidCount
	value["shareSatang"] = share
	encoded, _ := json.Marshal(value)
	return encoded
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
		splitRows, queryErr := a.db.QueryContext(ctx, `select sp.id,sp.sale_id,sp.position,sp.share_satang,s.split_count,(select count(*) from pos_sale_splits paid where paid.sale_id=sp.sale_id and paid.status='paid') from pos_sale_splits sp join pos_sales s on s.id=sp.sale_id where s.admin_id=$1 and sp.billing_account_id=$2 and sp.status='open' and s.status='open' order by s.created_at,sp.position`, adminID, accountID)
		if queryErr != nil {
			return result, queryErr
		}
		for splitRows.Next() {
			var splitID, saleID string
			var position, count, paidCount int
			var share int64
			if err = splitRows.Scan(&splitID, &saleID, &position, &share, &count, &paidCount); err != nil {
				splitRows.Close()
				return result, err
			}
			raw := a.posSaleBillingSnapshot(ctx, adminID, saleID)
			result.POSTotalSatang += share
			result.Lines = append(result.Lines, billingLine{SourceType: "pos", SourceID: splitPOSSourceID(splitID), Label: fmt.Sprintf("สินค้าแบ่งจ่าย · %s · ส่วนที่ %d/%d", saleID, position+1, count), AmountTHB: roundedBaht(share), AmountSatang: share, Snapshot: splitPOSBillingSnapshot(raw, splitID, position, count, paidCount, share)})
		}
		splitRows.Close()
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
	filter := `ba.admin_id=$1 and ba.kind='member' and ba.active and m.active and m.deleted_at is null and ($2='' or ba.display_name ilike '%%'||$2||'%%' or m.name ilike '%%'||$2||'%%' or m.phone ilike '%%'||$2||'%%' or exists(select 1 from players search_player join sessions search_session on search_session.id=search_player.session_id where search_session.admin_id=ba.admin_id and search_player.active and not search_player.paid and (search_player.billing_account_id=ba.id or search_player.member_id=ba.member_id) and search_player.name ilike '%%'||$2||'%%')) and (exists(select 1 from pos_sales ps where ps.billing_account_id=ba.id and ps.status='open') or exists(select 1 from pos_sale_splits sp join pos_sales ps on ps.id=sp.sale_id where sp.billing_account_id=ba.id and sp.status='open' and ps.status='open') or exists(select 1 from players p join sessions s on s.id=p.session_id where s.admin_id=ba.admin_id and p.active and not p.paid and (p.billing_account_id=ba.id or p.member_id=ba.member_id)))`
	var total int
	if err := a.db.QueryRowContext(r.Context(), `select count(*) from billing_accounts ba join members m on m.id=ba.member_id where `+filter, adminID, search).Scan(&total); err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	rows, err := a.db.QueryContext(r.Context(), `select ba.id,ba.member_id,ba.display_name,m.name,m.phone,coalesce((select p.name from players p join sessions s on s.id=p.session_id where s.admin_id=ba.admin_id and p.active and not p.paid and (p.billing_account_id=ba.id or p.member_id=ba.member_id) order by s.updated_at desc,p.id desc limit 1),'') from billing_accounts ba join members m on m.id=ba.member_id where `+filter+` order by lower(m.name),ba.id limit $3 offset $4`, adminID, search, pageSize, (page-1)*pageSize)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	defer rows.Close()
	items := []billingReceivable{}
	for rows.Next() {
		var item billingReceivable
		var billingName string
		if err = rows.Scan(&item.BillingAccountID, &item.MemberID, &billingName, &item.MemberName, &item.Phone, &item.MatchDisplayName); err != nil {
			break
		}
		item.DisplayName = item.MemberName
		if item.MatchDisplayName != "" {
			item.DisplayName = item.MatchDisplayName
			if !strings.EqualFold(item.MatchDisplayName, item.MemberName) {
				item.DisplayName += " (สมาชิก: " + item.MemberName + ")"
			}
		}
		item.SearchAliases = []string{item.MatchDisplayName, item.MemberName, billingName}
		summary, summaryErr := a.billingSummaryForAccount(r.Context(), adminID, item.BillingAccountID, true)
		if summaryErr != nil || summary.TotalSatang <= 0 {
			continue
		}
		item.MatchTotalSatang, item.POSTotalSatang, item.TotalSatang = summary.MatchTotalSatang, summary.POSTotalSatang, summary.TotalSatang
		item.Lines, item.LineCount, item.CalculatedAt = summary.Lines, len(summary.Lines), summary.CalculatedAt
		items = append(items, item)
	}
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	totalPages := (total + pageSize - 1) / pageSize
	if totalPages == 0 {
		totalPages = 1
	}
	writeJSON(w, 200, map[string]any{"items": items, "page": page, "pageSize": pageSize, "total": total, "totalPages": totalPages, "calculatedAt": time.Now().UTC()})
}

func (a *app) listBillingPaymentHistory(ctx context.Context, adminID, sessionID string, page, pageSize int) ([]billingPaymentHistory, int, error) {
	return a.listBillingPaymentHistoryFiltered(ctx, adminID, sessionID, "", "", page, pageSize)
}

func (a *app) listBillingPaymentHistoryFiltered(ctx context.Context, adminID, sessionID, search, method string, page, pageSize int) ([]billingPaymentHistory, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}
	search = strings.TrimSpace(strings.ToLower(search))
	searchLike := "%" + search + "%"
	if method != "cash" && method != "promptpay" {
		method = ""
	}
	filter := `bp.admin_id=$1 and bp.status='paid' and ($2='' or exists(select 1 from billing_payment_allocations session_allocation where session_allocation.payment_id=bp.id and session_allocation.source_type='match' and split_part(session_allocation.source_id,':',1)=$2)) and ($3='' or lower(bp.id) like $4 or lower(coalesce(ba.display_name,'')) like $4 or lower(coalesce(bp.received_by_name,'')) like $4 or lower(coalesce(bp.reference_number,'')) like $4 or exists(select 1 from billing_payment_allocations bpa where bpa.payment_id=bp.id and lower(coalesce(bpa.label,'')) like $4)) and ($5='' or bp.method=$5)`
	var total int
	if err := a.db.QueryRowContext(ctx, `select count(*) from billing_payments bp left join billing_accounts ba on ba.id=bp.billing_account_id where `+filter, adminID, sessionID, search, searchLike, method).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := a.db.QueryContext(ctx, `select bp.id,coalesce(bp.billing_account_id,''),coalesce(ba.member_id,''),coalesce(ba.display_name,'ลูกค้าหน้าร้าน'),bp.origin_system,bp.method,bp.amount_satang,bp.cash_received_satang,bp.change_satang,bp.reference_number,bp.received_by_type,bp.received_by_name,to_char(bp.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI'),coalesce(sum(a.amount_satang) filter(where a.source_type='match'),0),coalesce(sum(a.amount_satang) filter(where a.source_type='pos'),0) from billing_payments bp left join billing_accounts ba on ba.id=bp.billing_account_id left join billing_payment_allocations a on a.payment_id=bp.id where `+filter+` group by bp.id,ba.member_id,ba.display_name order by bp.created_at desc,bp.id desc limit $6 offset $7`, adminID, sessionID, search, searchLike, method, pageSize, (page-1)*pageSize)
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
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}
	status := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("status")))
	if status == "refunded" {
		writeJSON(w, 200, map[string]any{"items": []billingPaymentHistory{}, "page": page, "pageSize": pageSize, "total": 0, "totalPages": 1})
		return
	}
	items, total, err := a.listBillingPaymentHistoryFiltered(r.Context(), adminID, "", r.URL.Query().Get("search"), r.URL.Query().Get("method"), page, pageSize)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
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
	rows, err := a.db.QueryContext(ctx, `select e.id,e.player_id,coalesce(p.name,''),e.paid,e.amount_satang,e.payment_method,to_char(e.created_at at time zone 'Asia/Bangkok','DD/MM/YYYY HH24:MI') from player_payment_events e left join players p on p.session_id=e.session_id and p.id=e.player_id where e.session_id=$1 and e.billing_payment_id is null order by e.created_at desc,e.id desc limit 100`, state.Session.ID)
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
		writePOSInternalError(w, r, err)
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
		writePOSInternalError(w, r, err)
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
			if splitID, split := parseSplitPOSSourceID(line.SourceID); split {
				err = tx.QueryRowContext(ctx, `select sp.status from pos_sale_splits sp join pos_sales s on s.id=sp.sale_id where sp.id=$1 and s.admin_id=$2 and s.status='open' for update of sp,s`, splitID, user.ID).Scan(&status)
			} else {
				err = tx.QueryRowContext(ctx, `select status from pos_sales where id=$1 and admin_id=$2 for update`, line.SourceID, user.ID).Scan(&status)
			}
			if err != nil || status != "open" {
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
			if splitID, split := parseSplitPOSSourceID(line.SourceID); split {
				var saleID string
				err = tx.QueryRowContext(ctx, `update pos_sale_splits set status='paid',payment_id=$2,updated_at=now() where id=$1 and status='open' returning sale_id`, splitID, paymentID).Scan(&saleID)
				if err == nil {
					_, err = tx.ExecContext(ctx, `update pos_sales set status='paid',payment_id=$2,updated_at=now() where id=$1 and status='open' and not exists(select 1 from pos_sale_splits where sale_id=$1 and status='open')`, saleID, paymentID)
				}
			} else {
				_, err = tx.ExecContext(ctx, `update pos_sales set status='paid',payment_id=$2,updated_at=now() where id=$1 and status='open'`, line.SourceID, paymentID)
			}
		} else {
			parts := strings.Split(line.SourceID, ":")
			playerID, _ := strconv.Atoi(parts[1])
			_, err = tx.ExecContext(ctx, `update players set paid=true,coupon=false,settled_amount_satang=settled_amount_satang+$3 where session_id=$1 and id=$2 and not paid`, parts[0], playerID, line.AmountSatang)
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
	allocationSources := make([]map[string]any, 0, len(summary.Lines))
	for _, line := range summary.Lines {
		allocationSources = append(allocationSources, map[string]any{"sourceType": line.SourceType, "sourceId": line.SourceID, "amountSatang": line.AmountSatang})
	}
	if err = a.insertActivityLogTx(ctx, tx, posActorType(user), posActorID(user), "settle_combined_bill", "billing_payment", paymentID, map[string]any{
		"adminId": user.ID, "billingAccountId": accountID, "amountSatang": summary.TotalSatang,
		"method": method, "originSystem": originSystem, "matchSatang": summary.MatchTotalSatang,
		"posSatang": summary.POSTotalSatang, "cashReceivedSatang": cashReceivedSatang,
		"changeSatang": changeSatang, "hasReference": strings.TrimSpace(referenceNumber) != "", "allocations": allocationSources,
	}); err != nil {
		return summary, err
	}
	if err = tx.Commit(); err != nil {
		return summary, err
	}
	summary.PaymentID = paymentID
	return summary, nil
}

func writePOSSettlementError(w http.ResponseWriter, r *http.Request, summary billingSummary, err error) {
	message := err.Error()
	publicMessages := map[string]bool{
		"invalid payment method": true, "invalid payment origin": true,
		"ไม่มียอดค้างชำระ": true, "ยอด POS เปลี่ยนแปลง กรุณาลองใหม่": true,
		"invalid match reference": true, "ยอด Match เปลี่ยนแปลง กรุณาลองใหม่": true,
		"ยอดชำระเปลี่ยนแปลง กรุณาตรวจสอบยอดล่าสุด": true, "ยอดเงินสดไม่เพียงพอ": true,
	}
	if publicMessages[message] {
		writeJSON(w, http.StatusConflict, map[string]any{"error": message, "summary": summary})
		return
	}
	writePOSInternalError(w, r, err)
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
		writePOSSettlementError(w, r, summary, err)
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
		writePOSInternalError(w, r, err)
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
		"fullTotalThb": base.FullTotalTHB, "fullTotalSatang": base.FullTotalSatang,
		"settledAmountThb": base.SettledAmountTHB, "settledAmountSatang": base.SettledAmountSatang,
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
		writePOSInternalError(w, r, err)
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
		writePOSInternalError(w, r, err)
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
		writePOSSettlementError(w, r, summary, err)
		return
	}
	nextState, err := a.loadState(r.Context(), state.Session.ID)
	if err != nil {
		writePOSInternalError(w, r, err)
		return
	}
	nextState.Session.Unlocked = true
	writeJSON(w, http.StatusOK, map[string]any{"state": nextState, "summary": summary})
}
