import { posRequest } from './posCatalog';

export type POSReportRange = 'day' | 'week' | 'month' | 'custom';

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
