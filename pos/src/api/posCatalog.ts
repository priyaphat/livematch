export interface POSCatalogItem {
  id: string;
  name: string;
  active: boolean;
  usedCount: number;
  icon?: string;
  color?: string;
}

export interface POSProductRecord {
  id: string;
  sku: string;
  barcode?: string;
  category: string;
  name: string;
  priceThb: number;
  priceSatang: number;
  costThb: number;
  costSatang: number;
  stockQuantity: number;
  lowStockThreshold: number;
  active: boolean;
  lowStock: boolean;
  unit: string;
  imageData?: string;
  description?: string;
}

export interface POSProductPage {
  items: POSProductRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type POSProductInput = Omit<POSProductRecord, 'id' | 'lowStock'>;

export class POSApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'POSApiError';
    this.status = status;
  }
}

function csrfToken() {
  const item = document.cookie.split('; ').find((cookie) => cookie.startsWith('livematch_csrf='));
  return item ? decodeURIComponent(item.split('=').slice(1).join('=')) : '';
}

export async function posRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = csrfToken();
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { 'X-CSRF-Token': token } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || (response.status === 403 && payload.code === 'pos_not_enabled')) {
      window.dispatchEvent(new Event('livematch:pos-unauthorized'));
    }
    throw new POSApiError(payload.error || 'ไม่สามารถเชื่อมต่อ POS API ได้', response.status);
  }
  return payload as T;
}

export function listPOSProducts(params: { page: number; pageSize: number; search?: string; category?: string; status?: string }) {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    search: params.search || '',
    category: params.category || '',
    status: params.status || 'all',
  });
  return posRequest<POSProductPage>(`/api/admin/pos/products?${query}`);
}

export async function listPOSCategories() {
  return (await posRequest<{ items: POSCatalogItem[] }>('/api/admin/pos/categories')).items;
}

export async function listPOSUnits() {
  return (await posRequest<{ items: POSCatalogItem[] }>('/api/admin/pos/units')).items;
}

export function createPOSProduct(input: POSProductInput) {
  return posRequest<POSProductRecord>('/api/admin/pos/products', { method: 'POST', body: JSON.stringify(input) });
}

export function updatePOSProduct(id: string, input: POSProductInput) {
  return posRequest<unknown>(`/api/admin/pos/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deactivatePOSProduct(id: string) {
  return posRequest<{ deleted: boolean }>(`/api/admin/pos/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

function catalogPath(kind: 'categories' | 'units', id?: string) {
  return `/api/admin/pos/${kind}${id ? `/${encodeURIComponent(id)}` : ''}`;
}

export function createPOSCatalog(kind: 'categories' | 'units', name: string, extra: { icon?: string; color?: string } = {}) {
  return posRequest<POSCatalogItem>(catalogPath(kind), { method: 'POST', body: JSON.stringify({ name, active: true, ...extra }) });
}

export function updatePOSCatalog(kind: 'categories' | 'units', id: string, input: { name: string; active: boolean; icon?: string; color?: string }) {
  return posRequest<POSCatalogItem>(catalogPath(kind, id), { method: 'PATCH', body: JSON.stringify(input) });
}

export function deletePOSCatalog(kind: 'categories' | 'units', id: string) {
  return posRequest<{ deleted: boolean }>(catalogPath(kind, id), { method: 'DELETE' });
}
