import { expect, test } from '@playwright/test';
import { ownerApi } from './helpers';

test('POS-CAT-001 @smoke หน้าขายแสดงชื่อหมวดหมู่แทน ID/code', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /เครื่องดื่ม/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /ของว่าง/ })).toBeVisible();
  await expect(page.getByText('qa-category-drink-a', { exact: true })).toHaveCount(0);
});

test('POS-SALE-007 หน้าการขาย Desktop แสดงสินค้า 5 คอลัมน์และไม่แสดง SKU', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const grid = page.locator('#pos-product-grid');
  await expect(grid).toBeVisible();
  const columnCount = await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length);
  expect(columnCount).toBe(5);
  await expect(page.locator('#pos-product-qa-product-coffee-a')).not.toContainText('QA-COFFEE-001');
  const hasCardOverflow = await grid.locator('[id^="pos-product-"]').evaluateAll((cards) => cards.some((card) => card.scrollWidth > card.clientWidth + 1));
  expect(hasCardOverflow).toBeFalsy();
});

test('POS-SALE-001 @smoke @webkit โหลดสินค้า active ราคาและ stock จริง', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#pos-product-qa-product-coffee-a')).toContainText('กาแฟ QA');
  await expect(page.locator('#pos-product-qa-product-coffee-a')).toContainText('45');
  await expect(page.locator('#pos-product-qa-product-inactive-a')).toHaveCount(0);
});

test('POS-SALE-003 @smoke ไม่มีปุ่มหรือ modal เพิ่มโน้ตในรายการคำสั่งซื้อ', async ({ page }) => {
  await page.goto('/');
  await page.locator('#pos-product-qa-product-coffee-a').click();
  await expect(page.locator('#cart-item-qa-product-coffee-a')).toContainText('กาแฟ QA');
  await expect(page.getByText(/เพิ่มโน้ต|เพิ่มโน๊ต/)).toHaveCount(0);
});

test('POS-SALE-008 @smoke ยิงบาร์โค้ดเพิ่มสินค้าลงตะกร้าและยิงซ้ำเพิ่มจำนวน', async ({ page }) => {
  await page.goto('/');
	await expect(page.locator('#pos-product-qa-product-coffee-a')).toBeVisible();
  const search = page.locator('#pos-search-input');
  await search.fill('8850000000001');
  await search.press('Enter');
  const item = page.locator('#cart-item-qa-product-coffee-a');
  await expect(item).toBeVisible();
  await expect(item.locator('input[type="number"]')).toHaveValue('1');
  await search.focus();
  await page.keyboard.type('8850000000001', { delay: 10 });
  await page.keyboard.press('Enter');
  await expect(item.locator('input[type="number"]')).toHaveValue('2');
  await expect(search).toHaveValue('');
});

test('POS-CAT-007 @smoke Enter จากเครื่องยิง barcode ใน modal สินค้าไม่ submit form', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'จัดการสินค้า' }).click();
  await page.locator('#add-product-btn').click();
  await page.getByPlaceholder('เช่น ชาเขียวมัทฉะลาเต้เย็น, เค้กเรดเวลเวท').fill('สินค้าทดสอบ Scanner');
  const barcode = page.locator('#product-barcode-input');
  await barcode.focus();
  await page.keyboard.type('8859999999999', { delay: 10 });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'เพิ่มสินค้าใหม่' })).toBeVisible();
  await expect(barcode).toHaveValue('8859999999999');
  await expect(page.getByRole('button', { name: 'ยืนยันเพิ่มสินค้า' })).toBeVisible();
});

test('POS-SALE-005 @smoke PromptPay API คืน payload ยอด receiver และ POS override ถูก', async () => {
  const api = await ownerApi();
  const response = await api.get('/api/admin/pos/qr?amountSatang=12345');
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.amountSatang).toBe(12345);
  expect(body.receiverName).toBe('QA Receiver');
  expect(body.source).toBe('pos');
  expect(body.promptPayPayload).toMatch(/^000201/);
  await api.dispose();
});

test('POS-DISP-001 @smoke @webkit Customer Display index ใช้ setting และไม่มีสาขา', async ({ page }) => {
  await page.goto('/?display=customer');
  await expect(page.getByText('พร้อมทดสอบระบบ')).toBeVisible();
  await expect(page.getByText(/สาขาหลัก|สาขา/)).toHaveCount(0);
});

test('POS-PWA-001 @smoke PWA manifest มี icon และ standalone start URL', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/manifest.webmanifest');
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
});
