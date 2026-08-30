import { expect, test } from '@playwright/test';
import { csrfHeaders, ownerApi } from './helpers';

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

test('POS-SALE-008 @smoke ยิงบาร์โค้ดได้โดยไม่ focus ช่องค้นหาและไม่ขึ้นกับภาษาแป้นพิมพ์', async ({ page }) => {
  const api = await ownerApi();
  const response = await api.post('/api/admin/pos/products', {
    headers: await csrfHeaders(api),
    data: {
      sku: 'QA-SCANNER-ALPHA-001',
      barcode: '260824896099PX',
      category: 'qa-category-snack-a',
      name: 'กล่องทดสอบเครื่องยิง QA',
      priceThb: 25,
      priceSatang: 2500,
      costThb: 10,
      costSatang: 1000,
      stockQuantity: 30,
      lowStockThreshold: 1,
      unitsPerPack: 0,
      active: true,
      unit: 'ชิ้น',
      imageData: '',
      description: 'scanner regression fixture',
    },
  });
  expect(response.ok()).toBeTruthy();
  const alphaProduct = await response.json();
  await api.dispose();

  await page.goto('/');
	await expect(page.locator('#pos-product-qa-product-coffee-a')).toBeVisible();
  const search = page.locator('#pos-search-input');
  const scannerCapture = page.locator('#pos-barcode-capture-input');
  await expect(scannerCapture).toBeFocused();
  await search.fill('8850000000001');
  await search.press('Enter');
  const item = page.locator('#cart-item-qa-product-coffee-a');
  await expect(item).toBeVisible();
  await expect(item.locator('input[type="number"]')).toHaveValue('1');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(search).not.toBeFocused();
  await page.evaluate(() => {
    const thaiKeys: Record<string, string> = {
      '0': 'จ',
      '1': 'ๅ',
      '5': 'ถ',
      '8': 'ค',
    };
    for (const digit of '8850000000001') {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: thaiKeys[digit],
        code: 'Unidentified',
        bubbles: true,
      }));
    }
  });
  await expect(item.locator('input[type="number"]')).toHaveValue('2');
  await expect(search).toHaveValue('');

  await page.evaluate(() => {
    const capture = document.querySelector<HTMLInputElement>('#pos-barcode-capture-input');
    if (!capture) throw new Error('scanner capture input not found');
    capture.value = `คคถ${'จ'.repeat(9)}ๅ`;
    capture.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: capture.value }));
  });
  await expect(item.locator('input[type="number"]')).toHaveValue('3');

  await page.evaluate(() => {
    const capture = document.querySelector<HTMLInputElement>('#pos-barcode-capture-input');
    if (!capture) throw new Error('scanner capture input not found');
    capture.value = '/ุจค/ภคตุจตตยป';
    capture.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: capture.value }));
  });
  await expect(page.locator(`#cart-item-${alphaProduct.id}`)).toContainText('กล่องทดสอบเครื่องยิง QA');

  await page.evaluate(() => {
    const dispatch = (key: string, code: string, shiftKey = false) => window.dispatchEvent(new KeyboardEvent('keydown', {
      key,
      code,
      shiftKey,
      bubbles: true,
    }));
    for (const digit of '260824896099') dispatch(digit, `Digit${digit}`);
    dispatch('Shift', 'ShiftLeft', true);
    dispatch('P', 'KeyP', true);
    dispatch('Shift', 'ShiftLeft', true);
    dispatch('X', 'KeyX', true);
    dispatch('Enter', 'Enter');
  });
  await expect(page.locator(`#cart-item-${alphaProduct.id}`).locator('input[type="number"]')).toHaveValue('2');
});

test('POS-SALE-009 ไม่โหลด catalog จำลองจาก localStorage', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('siampure_products', JSON.stringify([{ id: 'legacy-demo-product', name: 'สินค้าจำลองห้ามขาย' }]));
    localStorage.setItem('siampure_categories', JSON.stringify([{ id: 'legacy-demo-category', name: 'หมวดจำลอง' }]));
    localStorage.setItem('siampure_units', JSON.stringify([{ id: 'legacy-demo-unit', name: 'หน่วยจำลอง' }]));
  });
  await page.goto('/');
  await expect(page.locator('#pos-product-qa-product-coffee-a')).toBeVisible();
  await expect(page.getByText('สินค้าจำลองห้ามขาย', { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => [
    localStorage.getItem('siampure_products'),
    localStorage.getItem('siampure_categories'),
    localStorage.getItem('siampure_units'),
  ])).toEqual([null, null, null]);
});

test('POS-SALE-010 PromptPay API ล้มเหลวแล้วไม่สร้าง QR สำรอง', async ({ page }) => {
  await page.route('**/api/admin/pos/qr**', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'ยังไม่ได้ตั้งค่า PromptPay' }),
  }));
  await page.goto('/');
  await page.locator('#pos-product-qa-product-coffee-a').click();
  await page.getByRole('button', { name: 'ชำระเงิน' }).click();
  await page.getByRole('button', { name: /PromptPay QR/ }).click();
  await expect(page.getByText(/ยังไม่ได้ตั้งค่า PromptPay/)).toBeVisible();
  await expect(page.getByAltText('PromptPay QR Code')).toHaveCount(0);
  await expect(page.locator('#confirm-checkout-btn')).toBeDisabled();
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

test('POS-DISP-002 Presentation API เชื่อมจอลูกค้าและไม่เปิด popup ซ้ำ', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__presentationSent = [];
    (window as any).__popupCount = 0;
    window.open = (() => { (window as any).__popupCount += 1; return null; }) as typeof window.open;
    class FakePresentationRequest {
      constructor(_url: string) {}
      async start() {
        const connection = new EventTarget() as EventTarget & { state: string; send: (data: string) => void; close: () => void; terminate: () => void };
        connection.state = 'connected';
        connection.send = (data: string) => (window as any).__presentationSent.push(JSON.parse(data));
        connection.close = () => undefined;
        connection.terminate = () => undefined;
        return connection;
      }
    }
    (window as any).PresentationRequest = FakePresentationRequest;
  });
  await page.goto('/');
  await page.locator('#nav-customer-display-btn').click();
  await expect(page.locator('#nav-customer-display-btn')).toHaveAttribute('title', 'จอลูกค้าเชื่อมต่อแล้ว');
  expect(await page.evaluate(() => (window as any).__popupCount)).toBe(0);
  expect(await page.evaluate(() => (window as any).__presentationSent.some((message: any) => message.type === 'CART_UPDATE'))).toBeTruthy();
});

test('POS-DISP-003 fallback เป็น popup เมื่อ Presentation API ไม่รองรับ', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).PresentationRequest = undefined;
    (window as any).__popupCount = 0;
    window.open = (() => {
      (window as any).__popupCount += 1;
      return { closed: false, postMessage: () => undefined } as unknown as Window;
    }) as typeof window.open;
  });
  await page.goto('/');
  await page.locator('#nav-customer-display-btn').click();
  await expect(page.locator('#nav-customer-display-btn')).toHaveAttribute('title', 'Presentation API ไม่รองรับ — ใช้หน้าต่างสำรอง');
  expect(await page.evaluate(() => (window as any).__popupCount)).toBe(1);
});

test('POS-HW-001 Android สลับโหมดคีย์บอร์ด USB และคืน inputmode เดิม', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (Linux; Android 13; W POS) AppleWebKit/537.36 Chrome/125 Safari/537.36' });
  });
  await page.goto('/');
  const toggle = page.locator('#nav-hardware-keyboard-toggle-btn');
  const search = page.locator('#pos-search-input');
  await expect(toggle).toBeVisible();
  await expect(search).not.toHaveAttribute('inputmode', 'none');
  await toggle.click();
  await expect(search).toHaveAttribute('inputmode', 'none');
  await page.evaluate(() => {
    const dynamicInput = document.createElement('input');
    dynamicInput.id = 'dynamic-hardware-input';
    dynamicInput.inputMode = 'numeric';
    document.body.appendChild(dynamicInput);
  });
  await expect(page.locator('#dynamic-hardware-input')).toHaveAttribute('inputmode', 'none');
  await search.fill('USB-KEYBOARD');
  await expect(search).toHaveValue('USB-KEYBOARD');
  await toggle.click();
  await expect(search).not.toHaveAttribute('inputmode', 'none');
});

test('POS-HW-002 ปุ่มคีย์บอร์ดแสดงแม้ firmware รายงาน platform ไม่ใช่ Android', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/125 Safari/537.36' });
  });
  await page.goto('/');
  const toggle = page.locator('#nav-hardware-keyboard-toggle-btn');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator('#pos-search-input')).toHaveAttribute('inputmode', 'none');
});

test('POS-PRINT-001 เปิด Android Print Dialog ด้วยเอกสารในหน้าเดิม', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__printCalls = 0;
    window.print = () => { (window as any).__printCalls += 1; };
  });
  await page.goto('/');
  await page.locator('#nav-tab-settings').click();
  await page.getByRole('button', { name: 'เครื่องพิมพ์' }).click();
  await page.locator('#discover-printer-btn').click();
  await expect(page.locator('#printer-test-document')).toContainText('ค้นหา / เลือกเครื่องพิมพ์ Android');
  await expect.poll(() => page.evaluate(() => (window as any).__printCalls)).toBe(1);
  await expect(page.locator('#printer-test-document')).toHaveClass(/printer-test-80mm/);
  await page.getByRole('button', { name: /ขนาด 58 mm/ }).click();
  await page.locator('#test-printer-btn').click();
  await expect(page.locator('#printer-test-document')).toContainText('ทดสอบเครื่องพิมพ์ POS');
  await expect(page.locator('#printer-test-document')).toHaveClass(/printer-test-58mm/);
  await expect.poll(() => page.evaluate(() => (window as any).__printCalls)).toBe(2);
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
