import { posRequest } from './posCatalog';

export type POSReportRange = 'day' | 'week' | 'month' | 'custom';
export interface POSPagination { page: number; pageSize: number; total: number; totalPages: number }
export interface POSSoldProductsReport {
  range: POSReportRange; startDate: string; endDate: string;
  summary: { totalQuantity: number; totalRevenueSatang: number };
  items: Array<{ productId: string; name: string; quantity: number; billCount: number; revenueSatang: number }>;
  pagination: POSPagination;
}
export interface POSInventoryReport {
  asOf: string;
  items: Array<{ productId: string; name: string; category: string; unit: string; active: boolean; stockQuantity: number; stockStatus: 'normal' | 'low' | 'out'; unitsPerPack: number; fullPacks: number | null; remainderUnits: number | null; costSatang: number; costValueSatang: number; priceSatang: number; retailValueSatang: number }>;
  pagination: POSPagination;
}
export interface POSSpecialReport {
  range: POSReportRange; startDate: string; endDate: string;
  summary: { posQuantity: number; posRevenueSatang: number; matchPlayerCount: number; matchEntryFeeSatang: number; matchShuttleQuantity: number; matchShuttleSatang: number; sessionCount: number; totalSatang: number };
  posItems: Array<{ productId: string; name: string; quantity: number; billCount: number; revenueSatang: number }>;
  sessions: Array<{ id: string; name: string; occurredAt: string; gameCount: number; playerCount: number; shuttleQuantity: number; entryFeeTotalSatang: number; shuttleTotalSatang: number; totalSatang: number; entryFees: Array<{ memberTypeId: string; memberTypeName: string; quantity: number; unitPriceSatang: number; totalSatang: number }>; shuttles: Array<{ brandId: string; brandName: string; quantity: number; unitPriceSatang: number; totalSatang: number }> }>;
  posPagination: POSPagination; sessionPagination: POSPagination;
}
export interface POSInventoryFilters { search?: string; category?: string; status?: 'all' | 'active' | 'inactive'; stockStatus?: 'all' | 'normal' | 'low' | 'out'; packStatus?: 'all' | 'configured' | 'unconfigured' }

export interface POSReportData {
  range: POSReportRange;
  startDate: string;
  endDate: string;
  summary: {
    totalSalesSatang: number;
    totalSubtotalSatang: number;
    totalDiscountSatang: number;
    totalVatSatang: number;
    totalCogsSatang: number;
    grossProfitSatang: number;
    completedBills: number;
    averageBillSatang: number;
  };
  topSellers: Array<{
    id: string;
    name: string;
    sku: string;
    quantity: number;
    revenueSatang: number;
    costSatang: number;
    profitSatang: number;
  }>;
  paymentStats: { cashSatang: number; promptPaySatang: number };
  sales: Array<{
    id: string;
    paymentId?: string;
    createdAt: string;
    subtotalSatang: number;
    discountSatang: number;
    netBeforeVatSatang: number;
    vatSatang: number;
    totalSatang: number;
    vatRateBps: number;
    pricesIncludeTax: boolean;
    method: 'cash' | 'promptpay';
    itemCount: number;
    actorName: string;
    buyerName: string;
  }>;
  topSellersPagination: { page: number; pageSize: number; total: number; totalPages: number };
  salesPagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export function getPOSReports(range: POSReportRange, startDate = '', endDate = '', topPage = 1, vatPage = 1, exportAll = false) {
  const query = new URLSearchParams({ range });
  if (range === 'custom') {
    query.set('startDate', startDate);
    query.set('endDate', endDate);
  }
  query.set('topPage', String(topPage));
  query.set('vatPage', String(vatPage));
  if (exportAll) query.set('exportAll', '1');
  return posRequest<POSReportData>(`/api/admin/pos/reports?${query}`);
}

export function authorizePOSReportExport() {
  return posRequest<{ allowed: boolean }>('/api/admin/pos/reports/export-authorize', { method: 'POST', body: '{}' });
}

function reportRangeQuery(range: POSReportRange, startDate: string, endDate: string) {
  const query = new URLSearchParams({ range });
  if (range === 'custom') { query.set('startDate', startDate); query.set('endDate', endDate); }
  return query;
}

export function getPOSSoldProductsReport(range: POSReportRange, startDate = '', endDate = '', page = 1, exportAll = false) {
  const query = reportRangeQuery(range, startDate, endDate);
  query.set('page', String(page));
  if (exportAll) query.set('exportAll', '1');
  return posRequest<POSSoldProductsReport>(`/api/admin/pos/reports/sold-products?${query}`);
}

export function getPOSInventoryReport(filters: POSInventoryFilters, page = 1, exportAll = false) {
  const query = new URLSearchParams({ page: String(page), status: filters.status || 'all', stockStatus: filters.stockStatus || 'all', packStatus: filters.packStatus || 'all' });
  if (filters.search) query.set('search', filters.search);
  if (filters.category) query.set('category', filters.category);
  if (exportAll) query.set('exportAll', '1');
  return posRequest<POSInventoryReport>(`/api/admin/pos/reports/inventory?${query}`);
}

export function getPOSSpecialReport(range: POSReportRange, startDate = '', endDate = '', posPage = 1, sessionPage = 1, exportAll = false) {
  const query = reportRangeQuery(range, startDate, endDate);
  query.set('posPage', String(posPage)); query.set('sessionPage', String(sessionPage));
  if (exportAll) query.set('exportAll', '1');
  return posRequest<POSSpecialReport>(`/api/admin/pos/reports/special?${query}`);
}
