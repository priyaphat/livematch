import { expect, test, type APIRequestContext } from '@playwright/test';
import ExcelJS from 'exceljs';
import { csrfHeaders, ownerApi } from './helpers';

test.describe.configure({ mode: 'serial' });

const sku = 'QA-LEDGER-2STOCK';
const productName = 'QA Ledger สองสต็อก';
let api: APIRequestContext;
let headers: Record<string, string>;
let originalSettings: Record<string, unknown>;
let productId = '';
let paidSaleId = '';
let memberName = '';

async function saveSettings(changes: Record<string, unknown>) {
  const response = await api.put('/api/admin/pos/settings', { headers, data: { ...originalSettings, ...changes } });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function currentProduct() {
  const response = await api.get(`/api/admin/pos/products?page=1&pageSize=100&status=all&search=${encodeURIComponent(sku)}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const item = (await response.json()).items.find((entry: { id: string }) => entry.id === productId);
  expect(item, `missing ledger product ${productId}`).toBeTruthy();
  return item as { stockQuantity: number; secondaryStockQuantity: number; totalStockQuantity: number; saleStockQuantity: number; costSatang: number; priceSatang: number; unitsPerPack: number };
}

async function stockBatch(data: Record<string, unknown>) {
  const response = await api.post('/api/admin/pos/stock/batch', { headers, data });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

async function createHold(requestId: string, memberId: string, quantity: number) {
  const response = await api.post('/api/admin/pos/sales', {
    headers,
    data: {
      requestId, action: 'hold', buyerType: 'member', buyerId: memberId,
      discountType: 'amount', discountAmountSatang: 0, discountRateBps: 0,
      expectedTotalSatang: quantity * 5000, items: [{ productId, quantity }],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json() as Promise<{ saleId: string; billingAccountId: string; totalSatang: number }>;
}

test.beforeAll(async () => {
  api = await ownerApi();
  headers = await csrfHeaders(api);
  const settings = await api.get('/api/admin/pos/settings');
  expect(settings.ok()).toBeTruthy();
  originalSettings = await settings.json();
});

test.afterAll(async () => {
  if (api) {
    if (productId) {
      const response = await api.get(`/api/admin/pos/products?page=1&pageSize=100&status=all&search=${encodeURIComponent(sku)}`);
      if (response.ok()) {
        const item = (await response.json()).items.find((entry: { id: string }) => entry.id === productId) as { secondaryStockQuantity?: number } | undefined;
        if ((item?.secondaryStockQuantity || 0) > 0) {
          await api.post('/api/admin/pos/stock/batch', { headers, data: { name: 'QA-LEDGER-CLEANUP', mode: 'transfer', stockLocation: 'secondary', sourceStockLocation: 'secondary', destinationStockLocation: 'primary', note: 'คืนยอดหลังจบ test', items: [{ productId, quantity: item!.secondaryStockQuantity }] } });
        }
      }
    }
    if (originalSettings) await api.put('/api/admin/pos/settings', { headers, data: originalSettings });
    await api.dispose();
  }
});

test('POS-STOCK-019 ledger สองสต็อกเดินยอดต่อเนื่องและ reconcile ถึงหน่วย/สตางค์', async () => {
  await saveSettings({
    secondaryStockEnabled: true, primaryStockName: 'หน้าร้าน', secondaryStockName: 'หลังร้าน',
    saleStockLocation: 'secondary', taxRatePercent: 0, pricesIncludeTax: true,
  });

  const created = await api.post('/api/admin/pos/products', {
    headers,
    data: {
      sku, barcode: 'QALEDGER2001', category: 'qa-category-snack-a', name: productName,
      priceThb: 50, priceSatang: 5000, costThb: 25, costSatang: 2500,
      stockQuantity: 100, secondaryStockQuantity: 40, trackStock: true,
      lowStockThreshold: 10, unitsPerPack: 12, active: true, unit: 'ชิ้น', imageData: '', description: 'QA ledger reconciliation',
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  productId = (await created.json()).id;
  expect(await currentProduct()).toMatchObject({ stockQuantity: 100, secondaryStockQuantity: 40, totalStockQuantity: 140, costSatang: 2500, priceSatang: 5000, unitsPerPack: 12 });

  const purchase = await stockBatch({
    name: 'QA-LEDGER-PURCHASE', mode: 'in', stockLocation: 'primary', supplierId: 'qa-supplier-a',
    externalReferenceNo: 'QA-LEDGER-SUP-001', note: 'ซื้อเข้าเพื่อ reconcile', discountType: 'amount', discountAmountSatang: 10000,
    items: [{ productId, quantity: 20, costSatang: 3000 }],
  });
  expect(purchase).toMatchObject({ grossTotalSatang: 60000, discountSatang: 10000, netTotalSatang: 50000 });
  expect(await currentProduct()).toMatchObject({ stockQuantity: 120, secondaryStockQuantity: 40, costSatang: 2500 });

  await stockBatch({
    name: 'QA-LEDGER-TRANSFER', mode: 'transfer', stockLocation: 'primary', sourceStockLocation: 'primary', destinationStockLocation: 'secondary',
    note: 'โอนเข้าหลังร้าน', items: [{ productId, quantity: 30 }],
  });
  expect(await currentProduct()).toMatchObject({ stockQuantity: 90, secondaryStockQuantity: 70, costSatang: 2500 });

  await stockBatch({ name: 'QA-LEDGER-OUT', mode: 'out', stockLocation: 'secondary', note: 'นำออกทดสอบ', items: [{ productId, quantity: 5 }] });
  expect(await currentProduct()).toMatchObject({ stockQuantity: 90, secondaryStockQuantity: 65 });

  await stockBatch({ name: 'QA-LEDGER-ADJUST', mode: 'adjust', stockLocation: 'primary', note: 'ตรวจนับลดสองชิ้น', items: [{ productId, quantity: 0, targetQuantity: 88 }] });
  expect(await currentProduct()).toMatchObject({ stockQuantity: 88, secondaryStockQuantity: 65 });

  memberName = `QA Ledger Member ${Date.now()}`;
  const memberResponse = await api.post('/api/admin/pos/members', {
    headers,
    data: { name: memberName, phone: `09${String(Date.now()).slice(-8)}`, memberTypeId: 'qa-member-type-a-general' },
  });
  expect(memberResponse.status(), await memberResponse.text()).toBe(201);
  const memberId = (await memberResponse.json()).id as string;

  const paidHold = await createHold('qa-ledger-hold-paid', memberId, 4);
  paidSaleId = paidHold.saleId;
  expect(paidHold.totalSatang).toBe(20000);
  expect(await currentProduct()).toMatchObject({ stockQuantity: 88, secondaryStockQuantity: 61 });
  const beforeSettlementMovements = await api.get('/api/admin/pos/stock/movements?limit=200&stockLocation=secondary');
  const saleMovementCount = (await beforeSettlementMovements.json()).items.filter((item: { saleId?: string; reason: string }) => item.saleId === paidSaleId && item.reason === 'sale').length;
  expect(saleMovementCount).toBe(1);

  const settlement = await api.post('/api/admin/pos/settlements', {
    headers,
    data: { billingAccountId: paidHold.billingAccountId, method: 'cash', expectedTotalSatang: 20000, cashReceivedSatang: 20000 },
  });
  expect(settlement.status(), await settlement.text()).toBe(200);
  expect(await currentProduct()).toMatchObject({ stockQuantity: 88, secondaryStockQuantity: 61 });
  const afterSettlementMovements = await api.get('/api/admin/pos/stock/movements?limit=200&stockLocation=secondary');
  expect((await afterSettlementMovements.json()).items.filter((item: { saleId?: string; reason: string }) => item.saleId === paidSaleId && item.reason === 'sale')).toHaveLength(1);

  const secondaryVoid = await createHold('qa-ledger-sale-void-secondary', memberId, 3);
  expect(await currentProduct()).toMatchObject({ secondaryStockQuantity: 58 });
  const voidSecondary = await api.post(`/api/admin/pos/sales/${secondaryVoid.saleId}/void`, { headers, data: { note: 'คืนหลังร้าน' } });
  expect(voidSecondary.status(), await voidSecondary.text()).toBe(200);
  expect(await currentProduct()).toMatchObject({ secondaryStockQuantity: 61 });

  await saveSettings({ secondaryStockEnabled: true, primaryStockName: 'หน้าร้าน', secondaryStockName: 'หลังร้าน', saleStockLocation: 'primary', taxRatePercent: 0, pricesIncludeTax: true });
  const primaryVoid = await createHold('qa-ledger-sale-void-primary', memberId, 2);
  expect(await currentProduct()).toMatchObject({ stockQuantity: 86, secondaryStockQuantity: 61 });
  await saveSettings({ secondaryStockEnabled: true, primaryStockName: 'หน้าร้าน', secondaryStockName: 'หลังร้าน', saleStockLocation: 'secondary', taxRatePercent: 0, pricesIncludeTax: true });
  const voidPrimary = await api.post(`/api/admin/pos/sales/${primaryVoid.saleId}/void`, { headers, data: { note: 'ต้องคืนหน้าร้านเดิม' } });
  expect(voidPrimary.status(), await voidPrimary.text()).toBe(200);

  expect(await currentProduct()).toMatchObject({ stockQuantity: 88, secondaryStockQuantity: 61, totalStockQuantity: 149, saleStockQuantity: 61, costSatang: 2500, priceSatang: 5000 });

  const movementResponse = await api.get('/api/admin/pos/stock/movements?limit=200');
  const movements = (await movementResponse.json()).items
    .filter((item: { productId: string }) => item.productId === productId)
    .sort((a: { id: number }, b: { id: number }) => a.id - b.id) as Array<{ id: number; batchId?: string; saleId?: string; stockLocation: 'primary' | 'secondary'; quantity: number; beforeStock: number; afterStock: number; reason: string; unitCostSatang: number; grossTotalSatang: number }>;
  expect(movements).toHaveLength(12);
  for (const location of ['primary', 'secondary'] as const) {
    const locationMovements = movements.filter((item) => item.stockLocation === location);
    expect(locationMovements[0].beforeStock).toBe(0);
    for (let index = 1; index < locationMovements.length; index += 1) {
      expect(locationMovements[index].beforeStock, `${location} chain breaks at movement ${locationMovements[index].id}`).toBe(locationMovements[index - 1].afterStock);
    }
    const expected = location === 'primary' ? 88 : 61;
    expect(locationMovements.reduce((sum, item) => sum + item.quantity, 0)).toBe(expected);
    expect(locationMovements.at(-1)?.afterStock).toBe(expected);
    expect(locationMovements.every((item) => item.reason === 'restock' && item.quantity === 20 ? item.unitCostSatang === 3000 : item.unitCostSatang === 2500)).toBeTruthy();
  }
  const transferMovements = movements.filter((item) => item.reason.startsWith('transfer_'));
  expect(transferMovements).toHaveLength(2);
  expect(transferMovements[0].batchId).toBe(transferMovements[1].batchId);
  expect(transferMovements.reduce((sum, item) => sum + item.quantity, 0)).toBe(0);
  expect(transferMovements.map((item) => item.quantity).sort((a, b) => a - b)).toEqual([-30, 30]);
  expect(movements.filter((item) => item.saleId === paidSaleId && item.reason === 'sale')).toHaveLength(1);
  expect(movements.filter((item) => item.saleId === secondaryVoid.saleId).map((item) => item.quantity).sort((a, b) => a - b)).toEqual([-3, 3]);
  expect(movements.filter((item) => item.saleId === primaryVoid.saleId).map((item) => item.quantity).sort((a, b) => a - b)).toEqual([-2, 2]);

  const paidSales = await api.get('/api/admin/pos/sales?status=paid&page=1&pageSize=200');
  const paidSale = (await paidSales.json()).items.find((item: { id: string }) => item.id === paidSaleId);
  expect(paidSale).toMatchObject({ status: 'paid', subtotalSatang: 20000, totalSatang: 20000, costSatang: 10000, stockLocation: 'secondary' });
  expect(paidSale.items[0]).toMatchObject({ productId, quantity: 4, unitPriceSatang: 5000, unitCostSatang: 2500, lineTotalSatang: 20000 });

  const history = await api.get('/api/admin/pos/payment-history?page=1&pageSize=100');
  const payment = (await history.json()).items.find((item: { lines: Array<{ sourceId: string }> }) => item.lines.some((line) => line.sourceId === paidSaleId));
  expect(payment).toMatchObject({ amountSatang: 20000, posTotalSatang: 20000, method: 'cash' });
  expect(payment.lines.find((line: { sourceId: string }) => line.sourceId === paidSaleId)).toMatchObject({ amountSatang: 20000 });

  const report = await api.get('/api/admin/pos/reports?range=day&topPage=1&vatPage=1&exportAll=1&stockLocation=secondary&reportType=top_sellers');
  expect(report.status(), await report.text()).toBe(200);
  const reportBody = await report.json();
  expect(reportBody.topSellers.find((item: { id: string }) => item.id === productId)).toMatchObject({ quantity: 4, revenueSatang: 20000, costSatang: 10000, profitSatang: 10000 });

  const sold = await api.get('/api/admin/pos/reports/sold-products?range=day&page=1&exportAll=1&stockLocation=secondary');
  expect((await sold.json()).items.find((item: { productId: string }) => item.productId === productId)).toMatchObject({ quantity: 4, billCount: 1, revenueSatang: 20000 });

  for (const [location, quantity, packs, remainder] of [['primary', 88, 7, 4], ['secondary', 61, 5, 1], ['all', 149, 12, 5]] as const) {
    const inventory = await api.get(`/api/admin/pos/reports/inventory?page=1&pageSize=100&status=all&stockStatus=all&packStatus=all&search=${encodeURIComponent(sku)}&stockLocation=${location}`);
    expect(inventory.status(), await inventory.text()).toBe(200);
    expect((await inventory.json()).items.find((item: { productId: string }) => item.productId === productId)).toMatchObject({ stockQuantity: quantity, unitsPerPack: 12, fullPacks: packs, remainderUnits: remainder, costSatang: 2500, costValueSatang: quantity * 2500, priceSatang: 5000, retailValueSatang: quantity * 5000 });
  }

  const purchases = await api.get(`/api/admin/pos/reports/purchases?range=day&page=1&exportAll=1&search=${encodeURIComponent('QA-LEDGER-SUP-001')}&stockLocation=primary`);
  expect((await purchases.json()).items.find((item: { referenceNo: string }) => item.referenceNo === 'QA-LEDGER-PURCHASE')).toMatchObject({ totalQuantity: 20, grossTotalSatang: 60000, discountSatang: 10000, netTotalSatang: 50000 });
  const transfers = await api.get(`/api/admin/pos/reports/transfers?range=day&page=1&exportAll=1&search=${encodeURIComponent('QA-LEDGER-TRANSFER')}&stockLocation=all`);
  expect((await transfers.json()).items.find((item: { referenceNo: string }) => item.referenceNo === 'QA-LEDGER-TRANSFER')).toMatchObject({ sourceStockLocation: 'primary', destinationStockLocation: 'secondary', totalQuantity: 30 });
});

test('POS-STOCK-021 UI ราคา ประวัติ รายงานแพ็ค และ Excel ตรง ledger', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /จัดการสินค้า/ }).click();
  await page.getByPlaceholder('ค้นหาสินค้า (ชื่อ, SKU, บาร์โค้ด)...').fill(sku);
  const productRow = page.getByText(productName, { exact: true }).locator('xpath=ancestor::tr');
  await expect(productRow).toContainText('฿50.00');
  await expect(productRow).toContainText('61 ชิ้น');

  await page.getByRole('button', { name: /บิล & ประวัติ/ }).click();
  await page.getByRole('button', { name: /ประวัติการขาย/ }).click();
  await page.getByPlaceholder('ค้นหาตามเลขที่บิล, แคชเชียร์, หมายเหตุ...').fill(memberName);
  const historyRow = page.getByText(productName, { exact: false }).first().locator('xpath=ancestor::tr');
  await expect(historyRow).toContainText('4 ชิ้น');
  await expect(historyRow).toContainText('฿200.00');
  await historyRow.getByRole('button', { name: /ดูรายละเอียดบิล/ }).click();
  const paymentDialog = page.getByLabel('รายละเอียดการชำระเงิน', { exact: true });
  await expect(paymentDialog.getByText('ยอดสุทธิ', { exact: true })).toBeVisible();
  await expect(paymentDialog.getByText('฿200.00', { exact: true }).last()).toBeVisible();
  await paymentDialog.getByRole('button', { name: 'ดูใบเสร็จ / พิมพ์', exact: true }).click();
  await expect(page.getByText(productName, { exact: true })).toBeVisible();
  await expect(page.getByText('฿200.00', { exact: true }).last()).toBeVisible();
  await page.locator('#close-receipt-modal-btn').click();

  await page.getByRole('button', { name: /รายงาน/ }).click();
  await page.getByRole('button', { name: 'สินค้าคงเหลือ', exact: true }).click();
  await page.getByLabel('กรองรายงานตามสต็อก').selectOption('secondary');
  await page.getByPlaceholder('ค้นหาชื่อ SKU หรือบาร์โค้ด').fill(sku);
  const inventoryRow = page.getByText(productName, { exact: true }).locator('xpath=ancestor::tr');
  await expect(inventoryRow).toContainText('61');
  await expect(inventoryRow).toContainText('5 แพ็ค + เศษ 1 ชิ้น');

  await page.evaluate(() => { Reflect.deleteProperty(window, 'showSaveFilePicker'); });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ส่งออกแท็บนี้ Excel', exact: true }).click();
  const download = await downloadPromise;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await download.path() as string);
  const worksheet = workbook.worksheets[0];
  const row = worksheet.getRows(1, worksheet.rowCount)?.find((candidate) => candidate.getCell(2).value === productName);
  expect(row, 'inventory Excel row is missing').toBeTruthy();
  expect(row!.getCell(6).value).toBe(61);
  expect(row!.getCell(7).value).toBe(12);
  expect(row!.getCell(8).value).toBe(5);
  expect(row!.getCell(9).value).toBe(1);
  expect(row!.getCell(10).value).toBe(25);
  expect(row!.getCell(11).value).toBe(1525);
  expect(row!.getCell(12).value).toBe(50);
  expect(row!.getCell(13).value).toBe(3050);
});
