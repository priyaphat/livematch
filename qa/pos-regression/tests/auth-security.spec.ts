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
