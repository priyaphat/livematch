import { posRequest } from './posCatalog';

export type POSDashboardRange = '1d' | '1w' | '1m';

export interface POSDashboardData {
  range: POSDashboardRange;
  from: string;
  to: string;
  salesSatang: number;
  previousSalesSatang: number;
  salesChangePercent: number;
  costSatang: number;
  grossProfitSatang: number;
  completedBills: number;
  averageBillSatang: number;
  heldCount: number;
  lowStockCount: number;
  peakLabel: string;
  timeline: Array<{ label: string; amountSatang: number }>;
  categories: Array<{ name: string; totalSatang: number; quantity: number }>;
  lowStockItems: Array<{
    id: string;
    name: string;
    sku: string;
    stock: number;
    lowStockThreshold: number;
    unit: string;
    imageData?: string;
  }>;
  recentSales: Array<{
    id: string;
    paymentId?: string;
    buyerName?: string;
    totalSatang: number;
    method: 'cash' | 'promptpay';
    actorName: string;
    itemCount: number;
    createdAt: string;
  }>;
}

export function getPOSDashboard(range: POSDashboardRange) {
  return posRequest<POSDashboardData>(`/api/admin/pos/dashboard?range=${range}`);
}
