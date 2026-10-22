import { expect, test } from '@playwright/test';
import { csrfHeaders, ownerApi } from './helpers';

test('POS-AUTH-001 @smoke @webkit Owner login ด้วยอีเมลเข้าสู่ POS ได้', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/');
  await page.getByPlaceholder('admin@example.com หรือ 1001-01').fill('QA.OWNER.A@EXAMPLE.INVALID');
  await page.getByPlaceholder('กรอกรหัสผ่าน หรือ PIN').fill('QaPass123!');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.locator('#pos-search-input')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('POS-AUTH-008 @smoke token ที่ยังไม่หมดอายุเข้า POS อัตโนมัติโดยไม่เห็นหน้า Login', async ({ page }) => {
  const meResponse = page.waitForResponse((response) => response.url().includes('/api/auth/pos/me'));
  await page.goto('/');
  expect((await meResponse).ok()).toBeTruthy();
  await expect(page.locator('#pos-search-input')).toBeVisible();
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ' })).toHaveCount(0);
});

test('POS-SEC-001 @smoke Admin A แก้สินค้า Admin B ไม่ได้', async () => {
  const api = await ownerApi('a');
  const headers = await csrfHeaders(api);
  const response = await api.patch('/api/admin/pos/products/qa-product-b', {
    headers,
    data: {
      sku: 'QA-B-001', category: 'qa-category-b', name: 'tenant breach',
      priceThb: 99, priceSatang: 9900, costThb: 50, costSatang: 5000,
      stockQuantity: 99, lowStockThreshold: 5, active: true, unit: 'กล่อง', imageData: '', description: '',
    },
  });
  expect([403, 404]).toContain(response.status());
  await api.dispose();

  const ownerB = await ownerApi('b');
  const products = await ownerB.get('/api/admin/pos/products?page=1&pageSize=20&status=all');
  expect(products.ok()).toBeTruthy();
  expect((await products.json()).items.find((item: { id: string }) => item.id === 'qa-product-b').name).toBe('สินค้า Tenant B');
  await ownerB.dispose();
});

test('POS-SEC-002 mutation ที่ไม่มี CSRF ถูกปฏิเสธ', async () => {
  const api = await ownerApi();
  const response = await api.post('/api/admin/pos/categories', { data: { name: 'CSRF should fail', active: true } });
  expect([401, 403]).toContain(response.status());
  await api.dispose();
});

test('POS-SEC-003 @smoke API ส่วนตัว no-store และ error ไม่รั่ว SQL', async () => {
  const api = await ownerApi();
  const response = await api.get('/api/admin/pos/settings');
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['cache-control']).toContain('no-store');
  const missing = await api.get('/api/admin/pos/products/not-a-real-product');
  const body = await missing.text();
  expect(body.toLowerCase()).not.toContain('sql:');
  expect(body.toLowerCase()).not.toContain('postgres');
  await api.dispose();
});

test('POS-SEC-005 ข้อมูลสำคัญแยกตามร้านทั้ง POS สมาชิก Match และจองสนาม', async () => {
  const ownerA = await ownerApi('a');
  const ownerB = await ownerApi('b');

  const [productsA, productsB, movementsA, movementsB, membersA, membersB, inventoryA, inventoryB] = await Promise.all([
    ownerA.get('/api/admin/pos/products?page=1&pageSize=100&status=all'),
    ownerB.get('/api/admin/pos/products?page=1&pageSize=100&status=all'),
    ownerA.get('/api/admin/pos/stock/movements?limit=200'),
    ownerB.get('/api/admin/pos/stock/movements?limit=200'),
    ownerA.get('/api/admin/pos/members?search='),
    ownerB.get('/api/admin/pos/members?search='),
    ownerA.get('/api/admin/pos/reports/inventory?page=1&pageSize=100&stockLocation=all'),
    ownerB.get('/api/admin/pos/reports/inventory?page=1&pageSize=100&stockLocation=all'),
  ]);
  for (const response of [productsA, productsB, movementsA, movementsB, membersA, membersB, inventoryA, inventoryB]) {
    expect(response.ok(), await response.text()).toBeTruthy();
  }

  const textProductsA = JSON.stringify(await productsA.json());
  const textProductsB = JSON.stringify(await productsB.json());
  const textMovementsA = JSON.stringify(await movementsA.json());
  const textMovementsB = JSON.stringify(await movementsB.json());
  const textMembersA = JSON.stringify(await membersA.json());
  const textMembersB = JSON.stringify(await membersB.json());
  const textInventoryA = JSON.stringify(await inventoryA.json());
  const textInventoryB = JSON.stringify(await inventoryB.json());

  expect(textProductsA).not.toContain('qa-product-b');
  expect(textProductsB).not.toContain('qa-product-coffee-a');
  expect(textMovementsA).not.toContain('qa-product-b');
  expect(textMovementsB).not.toContain('qa-product-coffee-a');
  expect(textMembersA).not.toContain('qa-member-b-1');
  expect(textMembersB).not.toContain('qa-member-a-1');
  expect(textInventoryA).not.toContain('qa-product-b');
  expect(textInventoryB).not.toContain('qa-product-coffee-a');

  const [settingsA, settingsB, supervisorB, bookingHistoryB] = await Promise.all([
    ownerA.get('/api/admin/pos/settings'),
    ownerB.get('/api/admin/pos/settings'),
    ownerB.get('/api/admin/supervisor'),
    ownerB.get('/api/admin/booking/history?page=1&pageSize=100'),
  ]);
  for (const response of [settingsA, settingsB, supervisorB, bookingHistoryB]) {
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  expect((await settingsA.json()).receiptHeader).toBe('QA POS Receipt');
  expect((await settingsB.json()).receiptHeader).not.toBe('QA POS Receipt');
  expect(JSON.stringify(await supervisorB.json())).not.toContain('qa-session-a');
  expect(JSON.stringify(await bookingHistoryB.json())).not.toContain('qa-booking-paid-a');

  const forbiddenReads = await Promise.all([
    ownerB.get('/api/admin/members/qa-member-a-1'),
    ownerB.get('/api/admin/pos/billing-summary?accountId=qa-billing-a-1'),
    ownerB.get('/api/sessions/qa-session-a/billing-sync'),
    ownerB.get('/api/admin/booking/payments/qa-booking-payment-a/slip'),
  ]);
  for (const response of forbiddenReads) {
    expect([403, 404], `${response.url()} returned ${response.status()}: ${await response.text()}`).toContain(response.status());
  }

  const headersB = await csrfHeaders(ownerB);
  const forbiddenMemberUpdate = await ownerB.patch('/api/admin/members/qa-member-a-1', {
    headers: headersB,
    data: { name: 'tenant breach', phone: '0899999999', email: '', memberTypeId: 'qa-member-type-b-general', active: true },
  });
  expect([403, 404]).toContain(forbiddenMemberUpdate.status());

  await ownerA.dispose();
  await ownerB.dispose();
});
