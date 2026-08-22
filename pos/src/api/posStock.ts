import { posRequest } from './posCatalog';

export interface POSStockSummary {
  productCount: number;
  totalUnits: number;
  inventoryCostSatang: number;
  inventoryRetailSatang: number;
  lowStockCount: number;
  outOfStockCount: number;
  batchCount: number;
  movementCount: number;
}

export interface POSSupplierRecord {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  active: boolean;
  productsCount: number;
}

export interface POSStockMovementRecord {
  id: number;
  referenceNo: string;
  batchId?: string;
  productId: string;
  productName: string;
  productSku: string;
  type: 'in' | 'out' | 'adjust';
  quantity: number;
  beforeStock: number;
  afterStock: number;
  reason: string;
  note?: string;
  supplierName?: string;
  unitCostSatang: number;
  grossTotalSatang: number;
  allocatedDiscountSatang: number;
  netTotalSatang: number;
  previousCostSatang: number;
  resultingCostSatang: number;
  createdAt: string;
  actorId: string;
  actorType: string;
  actorName: string;
}

export interface POSStockBatchRecord {
  id: string;
  name: string;
  mode: 'in' | 'out' | 'adjust';
  note: string;
  supplierId?: string;
  supplierName?: string;
  discountType: 'none' | 'amount' | 'percent';
  discountRateBps: number;
  grossTotalSatang: number;
  discountSatang: number;
  netTotalSatang: number;
  totalCostSatang: number;
  createdAt: string;
  actorId: string;
  actorType: string;
  actorName: string;
  items: Array<{
    id: number;
    productId: string;
    productName: string;
    productSku: string;
    delta: number;
    balance: number;
    unitCostSatang: number;
    grossTotalSatang: number;
    allocatedDiscountSatang: number;
    netTotalSatang: number;
    previousCostSatang: number;
    resultingCostSatang: number;
  }>;
}

export interface POSStockBatchInput {
  name: string;
  mode: 'in' | 'out' | 'adjust';
  note: string;
  supplierId?: string;
  discountType?: 'none' | 'amount' | 'percent';
  discountAmountSatang?: number;
  discountRateBps?: number;
  items: Array<{
    productId: string;
    quantity: number;
    targetQuantity?: number;
    costSatang?: number;
    note?: string;
  }>;
}

export async function getPOSStockSummary() {
  return posRequest<POSStockSummary>('/api/admin/pos/stock/summary');
}

export async function listPOSStockBatches() {
  return (await posRequest<{ items: POSStockBatchRecord[] }>('/api/admin/pos/stock/batches?limit=200')).items;
}

export async function listPOSStockMovements() {
  return (await posRequest<{ items: POSStockMovementRecord[] }>('/api/admin/pos/stock/movements?limit=200')).items;
}

export function createPOSStockBatch(input: POSStockBatchInput) {
  return posRequest<POSStockBatchRecord>('/api/admin/pos/stock/batch', { method: 'POST', body: JSON.stringify(input) });
}

export async function listPOSSuppliers() {
  return (await posRequest<{ items: POSSupplierRecord[] }>('/api/admin/pos/suppliers')).items;
}

export function createPOSSupplier(input: Omit<POSSupplierRecord, 'id' | 'code' | 'active' | 'productsCount'>) {
  return posRequest<POSSupplierRecord>('/api/admin/pos/suppliers', { method: 'POST', body: JSON.stringify(input) });
}

export function updatePOSSupplier(id: string, input: Partial<POSSupplierRecord>) {
  return posRequest<POSSupplierRecord>(`/api/admin/pos/suppliers/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deletePOSSupplier(id: string) {
  return posRequest<{ deleted: boolean }>(`/api/admin/pos/suppliers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
