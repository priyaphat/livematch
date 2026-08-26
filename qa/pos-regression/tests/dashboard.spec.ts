import { expect, test, type APIRequestContext } from '@playwright/test';
import { csrfHeaders, ownerApi } from './helpers';

test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await ownerApi();
  const headers = await csrfHeaders(api);
  const response = await api.post('/api/admin/pos/sales', {
    headers,
    data: {
      requestId: 'qa-dashboard-sale-001', action: 'pay', buyerType: 'anonymous', method: 'promptpay',
      discountType: 'amount', discountAmountSatang: 0, discountRateBps: 0,
      expectedTotalSatang: 4500, referenceNumber: 'QA-DASHBOARD',
      items: [{ productId: 'qa-product-coffee-a', quantity: 1 }],
    },
  });
  expect([200, 201]).toContain(response.status());
});

test.afterAll(async () => {
  await api?.dispose();
});

test('POS-DASH-002 ช่วง 1d/1w/1m อัปเดตหัวข้อและการ์ดด้วยข้อมูล API จริง', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'แดชบอร์ด' }).click();
  for (const range of [
    { key: '1d', heading: 'ภาพรวมการขาย วันนี้' },
    { key: '1w', heading: 'ภาพรวมการขาย 7 วันล่าสุด' },
    { key: '1m', heading: 'ภาพรวมการขาย 30 วันล่าสุด' },
  ]) {
    const response = await api.get(`/api/admin/pos/dashboard?range=${range.key}`);
    expect(response.ok()).toBeTruthy();
    const dashboard = await response.json();
    await page.getByRole('button', { name: range.key, exact: true }).click();
    await expect(page.getByRole('heading', { name: range.heading })).toBeVisible();
    await expect(page.getByText(`${dashboard.completedBills} บิล`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${dashboard.heldCount} รายการ`, { exact: true }).first()).toBeVisible();
  }
});

test('POS-DASH-003 ค่าเฉลี่ยต่อบิลแสดงสตางค์และจำนวนหมวดหมู่ไม่ hardcode', async ({ page }) => {
  test.fail(true, 'Known P2: dashboard truncates average display and hardcodes category count to 5');
  const response = await api.get('/api/admin/pos/dashboard?range=1d');
  const dashboard = await response.json();
  await page.goto('/');
  await page.getByRole('button', { name: 'แดชบอร์ด' }).click();
  const expectedAverage = `เฉลี่ย ฿${(dashboard.averageBillSatang / 100).toFixed(2)}/บิล`;
  await expect(page.getByText(expectedAverage, { exact: true })).toBeVisible();
  await expect(page.getByText(`${dashboard.categories.length} หมวดหมู่หลัก`, { exact: true })).toBeVisible();
});

test('POS-DASH-004 ทางลัด Dashboard เปิดหน้าสต็อกและประวัติบิลได้', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'แดชบอร์ด' }).click();
  await page.getByRole('button', { name: 'จัดการสต็อกทั้งหมด →' }).click();
  await expect(page.getByRole('heading', { name: 'จัดการคลังสินค้า & รายการสต็อกรวม' })).toBeVisible();
  await page.getByRole('button', { name: 'แดชบอร์ด' }).click();
  await page.getByRole('button', { name: 'ดูประวัติบิลทั้งหมด →' }).click();
  await expect(page.getByRole('heading', { name: 'จัดการบิล & ประวัติการขาย' })).toBeVisible();
});

test('POS-BILL-001 ประวัติการขายเปิดดูรายละเอียดการชำระและรายการสินค้าได้', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'บิล & ประวัติ' }).click();
  await page.getByRole('button', { name: /ประวัติการขาย/ }).click();
  await page.getByRole('button', { name: /ดูรายละเอียดบิล/ }).first().click();

  const dialog = page.getByRole('dialog', { name: 'รายละเอียดการชำระเงิน' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('กาแฟ QA')).toBeVisible();
  await expect(dialog.getByText('PromptPay QR', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('ยอดชำระรวม')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'ดูใบเสร็จ / พิมพ์' })).toBeVisible();
});

test('POS-BILL-002 ประวัติการขายแบ่งหน้าและค้นหาจากข้อมูลทั้งหมดผ่าน API', async ({ page }) => {
  const headers = await csrfHeaders(api);
  for (let index = 1; index <= 21; index += 1) {
    const response = await api.post('/api/admin/pos/sales', {
      headers,
      data: {
        requestId: `qa-bill-page-${String(index).padStart(2, '0')}`,
        action: 'pay', buyerType: 'anonymous', method: 'promptpay',
        discountType: 'amount', discountAmountSatang: 0, discountRateBps: 0,
        expectedTotalSatang: 4500, referenceNumber: `QA-PAGE-${String(index).padStart(2, '0')}`,
        items: [{ productId: 'qa-product-coffee-a', quantity: 1 }],
      },
    });
    expect([200, 201]).toContain(response.status());
  }

  await page.goto('/');
  await page.getByRole('button', { name: 'บิล & ประวัติ' }).click();
  await page.getByRole('button', { name: /ประวัติการขาย/ }).click();
  await page.getByPlaceholder('ค้นหาตามเลขที่บิล, แคชเชียร์, หมายเหตุ...').fill('QA-PAGE');
  await expect(page.getByText('แสดง 1–20 จากทั้งหมด 21 รายการ · หน้า 1/2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ถัดไป' }).click();
  await expect(page.getByText('แสดง 21–21 จากทั้งหมด 21 รายการ · หน้า 2/2', { exact: true })).toBeVisible();
  await expect(page.getByText('Ref: QA-PAGE-01', { exact: true })).toBeVisible();

  await page.getByRole('combobox').nth(1).selectOption('cash');
  await expect(page.getByText('ทั้งหมด 0 รายการ · หน้า 1/1', { exact: true })).toBeVisible();
  await page.getByRole('combobox').nth(1).selectOption('promptpay');
  await expect(page.getByText('แสดง 1–20 จากทั้งหมด 21 รายการ · หน้า 1/2', { exact: true })).toBeVisible();
  await page.getByRole('combobox').first().selectOption('refunded');
  await expect(page.getByText('ทั้งหมด 0 รายการ · หน้า 1/1', { exact: true })).toBeVisible();
});

test('POS-DASH-005 @responsive Dashboard มือถือไม่มี horizontal overflow และปุ่มช่วงเวลายังใช้งานได้', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'แดชบอร์ด' }).click();
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  for (const range of ['1d', '1w', '1m']) {
    await expect(page.getByRole('button', { name: range, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'บิลการขายล่าสุด' })).toBeVisible();
});

test('POS-DASH-006 การ์ดพักยอด สต็อกต่ำ และบิลล่าสุดใช้งานด้วย keyboard ได้', async ({ page }) => {
  test.fail(true, 'Known P3: clickable dashboard cards and recent-sale rows are divs without button/link semantics');
  await page.goto('/');
  await page.getByRole('button', { name: 'แดชบอร์ด' }).click();
  await expect(page.getByRole('button', { name: /รายการพักยอด/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /สินค้าสต็อกต่ำ/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /ดูใบเสร็จ/ }).first()).toBeVisible();
});
