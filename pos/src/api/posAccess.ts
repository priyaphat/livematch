import { posRequest } from './posCatalog';

export type POSRole = 'owner' | 'manager' | 'cashier';
export type POSReportPermissionKey = 'report_overview' | 'report_top_sellers' | 'report_vat' | 'report_payments' | 'report_sold_products' | 'report_purchases' | 'report_inventory' | 'report_inventory_values' | 'report_transfers' | 'report_special';
export type POSPermissionKey = 'sales' | 'bills' | 'products' | 'stock' | 'reports' | POSReportPermissionKey | 'settings' | 'discounts' | 'void_sales' | 'stock_adjust' | 'product_pricing' | 'report_export' | 'member_create';
export type POSPermissions = Record<POSPermissionKey, boolean>;

export const POS_REPORT_PERMISSION_KEYS: POSReportPermissionKey[] = ['report_overview', 'report_top_sellers', 'report_vat', 'report_payments', 'report_sold_products', 'report_purchases', 'report_inventory', 'report_inventory_values', 'report_transfers', 'report_special'];

export interface POSStaffMember {
  id: string;
  staffNumber: string;
  name: string;
  email: string;
  role: POSRole;
  active: boolean;
  isOwner: boolean;
  lastLoginAt?: string;
  failedLoginCount: number;
  lastFailedLoginAt?: string;
}

export interface POSAccessSettings {
  items: POSStaffMember[];
  maxMembers: number;
  permissions: Record<POSRole, POSPermissions>;
}

export function getPOSAccessSettings() {
  return posRequest<POSAccessSettings>('/api/admin/pos/access');
}

export function createPOSStaff(input: { name: string; email: string; role: Exclude<POSRole, 'owner'>; pin: string }) {
  return posRequest<POSAccessSettings>('/api/admin/pos/staff', { method: 'POST', body: JSON.stringify(input) });
}

export function updatePOSStaff(id: string, input: { name: string; email: string; role: Exclude<POSRole, 'owner'>; active: boolean }) {
  return posRequest<POSAccessSettings>(`/api/admin/pos/staff/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function updatePOSOwner(input: { name: string; email: string }) {
  return posRequest<POSAccessSettings>('/api/admin/pos/access/owner', { method: 'PATCH', body: JSON.stringify(input) });
}

export function resetPOSStaffPIN(id: string, pin = '') {
  return posRequest<{ status: string; pin: string }>(`/api/admin/pos/staff/${encodeURIComponent(id)}/reset-pin`, { method: 'POST', body: JSON.stringify({ pin }) });
}

export function forceLogoutPOSStaff(id: string) {
  return posRequest<{ status: string }>(`/api/admin/pos/staff/${encodeURIComponent(id)}/logout`, { method: 'POST', body: '{}' });
}

export interface POSActivityItem {
  id: number; actorType: string; actorId: string; actorName: string; action: string;
  targetType: string; targetId: string; details: Record<string, unknown>; createdAt: string;
}

export function getPOSActivity(limit = 50) {
  return posRequest<{ items: POSActivityItem[] }>(`/api/admin/pos/access/activity?limit=${limit}`).then((result) => result.items);
}

export function savePOSRolePermissions(permissions: Pick<Record<POSRole, POSPermissions>, 'manager' | 'cashier'>) {
  return posRequest<POSAccessSettings>('/api/admin/pos/permissions', { method: 'PUT', body: JSON.stringify(permissions) });
}
