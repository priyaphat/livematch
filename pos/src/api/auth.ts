export interface AdminUser {
  id: string;
  email: string;
  name: string;
  posAdminNumber: number;
  verified: boolean;
  coins: number;
  createdAt: string;
  role: 'owner' | 'manager' | 'cashier';
  staffNumber: string;
  actorType: 'admin' | 'pos_staff';
  ownerId: string;
  ownerName: string;
}

export interface AdminAuthPayload {
  user: AdminUser;
  features?: {
    memberEnabled?: boolean;
    bookingEnabled?: boolean;
    posEnabled?: boolean;
  };
  permissions?: Record<'sales' | 'bills' | 'products' | 'stock' | 'reports' | 'settings', boolean>;
}

export interface LoginCredentials {
  email: string;
  password: string;
  remember: boolean;
}

export class AuthApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = '') {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
    this.code = code;
  }
}

function csrfToken() {
  const item = document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith('livematch_csrf='));
  return item ? decodeURIComponent(item.split('=').slice(1).join('=')) : '';
}

async function authRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    throw new AuthApiError(
      payload.error || 'ไม่สามารถเชื่อมต่อระบบเข้าสู่ระบบได้',
      response.status,
      payload.code || payload.error || ''
    );
  }
  return payload as T;
}

export function loginAdmin(credentials: LoginCredentials) {
  return authRequest<AdminAuthPayload>('/api/auth/pos/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

export function getCurrentAdmin() {
  return authRequest<AdminAuthPayload>('/api/auth/pos/me');
}

export function logoutAdmin() {
  return authRequest<{ status: string }>('/api/auth/pos/logout', { method: 'POST' });
}
