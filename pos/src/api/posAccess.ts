import { posRequest } from './posCatalog';

export type POSRole = 'owner' | 'manager' | 'cashier';
export type POSPermissionKey = 'sales' | 'bills' | 'products' | 'stock' | 'reports' | 'settings';
export type POSPermissions = Record<POSPermissionKey, boolean>;

export interface POSStaffMember {
  id: string;
  staffNumber: string;
  name: string;
  email: string;
  role: POSRole;
  active: boolean;
  isOwner: boolean;
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

export function resetPOSStaffPIN(id: string, pin = '') {
  return posRequest<{ status: string; pin: string }>(`/api/admin/pos/staff/${encodeURIComponent(id)}/reset-pin`, { method: 'POST', body: JSON.stringify({ pin }) });
}

export function savePOSRolePermissions(permissions: Pick<Record<POSRole, POSPermissions>, 'manager' | 'cashier'>) {
  return posRequest<POSAccessSettings>('/api/admin/pos/permissions', { method: 'PUT', body: JSON.stringify(permissions) });
}
