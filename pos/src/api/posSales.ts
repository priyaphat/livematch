import { posRequest } from './posCatalog';

export interface POSMember {
  id: string;
  name: string;
  phone: string;
  billingAccountId: string;
}

export interface POSSaleItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPriceSatang: number;
  unitCostSatang: number;
  lineTotalSatang: number;
  note?: string;
}

export interface POSSale {
  id: string;
  billingAccountId?: string;
  buyerName: string;
  status: 'open' | 'paid' | 'void';
  paymentId?: string;
  createdAt: string;
  createdByName: string;
  subtotalSatang: number;
  discountType: 'amount' | 'percent';
  discountRateBps: number;
  discountSatang: number;
  netBeforeVatSatang: number;
  vatRateBps: number;
  vatSatang: number;
  pricesIncludeTax: boolean;
  totalSatang: number;
  items: POSSaleItem[];
  paymentMethod?: 'cash' | 'promptpay';
  cashReceivedSatang?: number;
  changeSatang?: number;
  referenceNumber?: string;
}

export interface POSSettingsRecord {
  promptPayType: string;
  promptPayId: string;
  promptPayReceiverName: string;
  receiptHeader: string;
  receiptFooter: string;
  logoData?: string;
  defaultLowStock: number;
  theme: 'light' | 'dark';
  language: 'th' | 'en';
  taxRatePercent: number;
  pricesIncludeTax: boolean;
  inheritBookingPromptPay: boolean;
  paymentQrImage?: string;
}

export interface POSBillingSummary {
  billingAccountId: string;
  memberId: string;
  displayName: string;
  matchTotalSatang: number;
  posTotalSatang: number;
  totalSatang: number;
  promptPayPayload?: string;
  receiverName?: string;
  lines?: POSBillingLine[];
}

export interface POSBillingLine {
  sourceType: 'match' | 'pos';
  sourceId: string;
  label: string;
  amountSatang: number;
  snapshot?: Record<string, any>;
}

export interface POSReceivable {
  billingAccountId: string;
  memberId: string;
  displayName: string;
  phone?: string;
  matchTotalSatang: number;
  posTotalSatang: number;
  totalSatang: number;
  lineCount: number;
  lines: POSBillingLine[];
  calculatedAt: string;
}

export interface POSPaymentHistory {
  paymentId: string;
  billingAccountId?: string;
  memberId?: string;
  displayName: string;
  originSystem: 'match' | 'pos';
  method: 'cash' | 'promptpay';
  amountSatang: number;
  matchTotalSatang: number;
  posTotalSatang: number;
  cashReceivedSatang?: number;
  changeSatang?: number;
  referenceNumber?: string;
  receivedByType: string;
  receivedByName: string;
  createdAt: string;
  lines: POSBillingLine[];
}

export function listPOSMembers(search = '') {
  return posRequest<{ items: POSMember[] }>(`/api/admin/pos/members?search=${encodeURIComponent(search)}`).then((result) => result.items);
}

export function listPOSSales(status = 'all') {
  return posRequest<{ items: POSSale[]; total: number }>(`/api/admin/pos/sales?status=${encodeURIComponent(status)}`).then((result) => result.items);
}

export function createPOSSale(input: {
  requestId: string;
  action: 'hold' | 'pay';
  buyerType: 'member' | 'anonymous';
  buyerId?: string;
  method?: 'cash' | 'promptpay';
  discountType: 'amount' | 'percent';
  discountAmountSatang: number;
  discountRateBps: number;
  expectedTotalSatang: number;
  cashReceivedSatang?: number;
  referenceNumber?: string;
  items: Array<{ productId: string; quantity: number; note?: string }>;
}) {
  return posRequest<{ saleId: string; status: string; totalSatang: number; paymentId?: string; billingAccountId?: string }>('/api/admin/pos/sales', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function voidPOSSale(id: string, note = '') {
  return posRequest<unknown>(`/api/admin/pos/sales/${encodeURIComponent(id)}/void`, { method: 'POST', body: JSON.stringify({ note }) });
}

export function getPOSBillingSummary(accountId: string) {
  return posRequest<POSBillingSummary>(`/api/admin/pos/billing-summary?accountId=${encodeURIComponent(accountId)}`);
}

export function listPOSReceivables(search = '') {
  return posRequest<{ items: POSReceivable[] }>(`/api/admin/pos/receivables?page=1&pageSize=100&search=${encodeURIComponent(search)}`).then((result) => result.items);
}

export function listPOSPaymentHistory() {
  return posRequest<{ items: POSPaymentHistory[] }>('/api/admin/pos/payment-history?page=1&pageSize=100').then((result) => result.items);
}

export function settlePOSAccount(input: { billingAccountId: string; method: 'cash' | 'promptpay'; expectedTotalSatang: number; cashReceivedSatang?: number; referenceNumber?: string }) {
  return posRequest<{ status: string; summary: POSBillingSummary }>('/api/admin/pos/settlements', { method: 'POST', body: JSON.stringify(input) });
}

export function getPOSSettings() {
  return posRequest<POSSettingsRecord>('/api/admin/pos/settings');
}

export function savePOSSettings(input: POSSettingsRecord) {
  return posRequest<unknown>('/api/admin/pos/settings', { method: 'PUT', body: JSON.stringify(input) });
}

export function getPOSPaymentQR(amountSatang: number) {
  return posRequest<{ promptPayPayload: string; receiverName: string; amountSatang: number; source: string; fallbackImage?: string }>(`/api/admin/pos/qr?amountSatang=${amountSatang}`);
}
