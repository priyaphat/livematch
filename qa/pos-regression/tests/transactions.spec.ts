import { expect, test, type APIRequestContext } from '@playwright/test';
import { csrfHeaders, ownerApi } from './helpers';

test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;
let headers: Record<string, string>;
let weightedProductId = '';
let allocationProductAId = '';
let allocationProductBId = '';
let saleProductId = '';
let percentProductId = '';
let fullDiscountProductId = '';
let zeroOutProductId = '';
let zeroAdjustProductId = '';
let concurrentProductId = '';
let duplicateProductId = '';
let tinySatangProductAId = '';
let tinySatangProductBId = '';
let halfUpProductId = '';
let originalSettings: Record<string, unknown>;

async function createProduct(input: {
  sku: string;
  name: string;
  priceSatang: number;
  costSatang: number;
  stockQuantity: number;
}) {
  const response = await api.post('/api/admin/pos/products', {
    headers,
    data: {
      sku: input.sku,
      barcode: '',
      category: 'qa-category-snack-a',
      name: input.name,
      priceThb: Math.round(input.priceSatang / 100),
      priceSatang: input.priceSatang,
      costThb: Math.round(input.costSatang / 100),
      costSatang: input.costSatang,
      stockQuantity: input.stockQuantity,
      lowStockThreshold: 1,
      unitsPerPack: 0,
      active: true,
      unit: 'ชิ้น',
      imageData: '',
      description: 'POS regression transaction fixture',
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<{ id: string }>;
}

async function product(id: string) {
  const response = await api.get('/api/admin/pos/products?page=1&pageSize=100&status=all');
  expect(response.ok()).toBeTruthy();
  const found = (await response.json()).items.find((item: { id: string }) => item.id === id);
  expect(found, `product ${id} is missing`).toBeTruthy();
  return found as { id: string; stockQuantity: number; costSatang: number };
}

async function saveSettings(changes: Record<string, unknown>) {
  const response = await api.put('/api/admin/pos/settings', {
    headers,
    data: { ...originalSettings, ...changes },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

test.beforeAll(async () => {
  api = await ownerApi();
  headers = await csrfHeaders(api);
  const settings = await api.get('/api/admin/pos/settings');
  expect(settings.ok()).toBeTruthy();
  originalSettings = await settings.json();

  weightedProductId = (await createProduct({
    sku: 'QA-TXN-WEIGHTED', name: 'QA ต้นทุนเฉลี่ย', priceSatang: 12000, costSatang: 10000, stockQuantity: 10,
  })).id;
  allocationProductAId = (await createProduct({
    sku: 'QA-TXN-ALLOC-A', name: 'QA กระจายส่วนลด A', priceSatang: 1000, costSatang: 500, stockQuantity: 5,
  })).id;
  allocationProductBId = (await createProduct({
    sku: 'QA-TXN-ALLOC-B', name: 'QA กระจายส่วนลด B', priceSatang: 1000, costSatang: 500, stockQuantity: 2,
  })).id;
  saleProductId = (await createProduct({
    sku: 'QA-TXN-SALE', name: 'QA VAT และเงินสด', priceSatang: 10000, costSatang: 4000, stockQuantity: 20,
  })).id;
  percentProductId = (await createProduct({
    sku: 'QA-TXN-PERCENT', name: 'QA ส่วนลดเปอร์เซ็นต์', priceSatang: 500, costSatang: 0, stockQuantity: 0,
  })).id;
  fullDiscountProductId = (await createProduct({
    sku: 'QA-TXN-FULL-DISCOUNT', name: 'QA ส่วนลดเต็มยอด', priceSatang: 500, costSatang: 0, stockQuantity: 0,
  })).id;
  zeroOutProductId = (await createProduct({
    sku: 'QA-TXN-ZERO-OUT', name: 'QA จ่ายออกเหลือศูนย์', priceSatang: 1000, costSatang: 333, stockQuantity: 3,
  })).id;
  zeroAdjustProductId = (await createProduct({
    sku: 'QA-TXN-ZERO-ADJUST', name: 'QA ปรับศูนย์ไปมา', priceSatang: 1000, costSatang: 250, stockQuantity: 0,
  })).id;
  concurrentProductId = (await createProduct({
    sku: 'QA-TXN-CONCURRENT', name: 'QA จ่ายออกพร้อมกัน', priceSatang: 1000, costSatang: 100, stockQuantity: 5,
  })).id;
  duplicateProductId = (await createProduct({
    sku: 'QA-TXN-DUPLICATE', name: 'QA เอกสารซ้ำ', priceSatang: 1000, costSatang: 100, stockQuantity: 5,
  })).id;
  tinySatangProductAId = (await createProduct({
    sku: 'QA-TXN-TINY-A', name: 'QA หนึ่งสตางค์ A', priceSatang: 100, costSatang: 0, stockQuantity: 0,
  })).id;
  tinySatangProductBId = (await createProduct({
    sku: 'QA-TXN-TINY-B', name: 'QA หนึ่งสตางค์ B', priceSatang: 100, costSatang: 0, stockQuantity: 0,
  })).id;
  halfUpProductId = (await createProduct({
    sku: 'QA-TXN-HALF-UP', name: 'QA ปัดครึ่งขึ้น', priceSatang: 100, costSatang: 1, stockQuantity: 1,
  })).id;
});

test.afterAll(async () => {
  if (api) {
    if (originalSettings) await saveSettings({});
    await api.dispose();
  }
});

test('POS-STOCK-001 รับเข้าหลายรายการ กระจายส่วนลดครบทุกสตางค์และไม่ติดลบ', async () => {
  const response = await api.post('/api/admin/pos/stock/batch', {
    headers,
    data: {
      name: 'QA-STOCK-ALLOC-001', mode: 'in', note: 'ตรวจการกระจายเศษสตางค์',
      supplierId: 'qa-supplier-a', discountType: 'amount', discountAmountSatang: 5,
      items: [
        { productId: allocationProductAId, quantity: 2, costSatang: 100 },
        { productId: allocationProductBId, quantity: 1, costSatang: 100 },
      ],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  expect(await response.json()).toMatchObject({ grossTotalSatang: 300, discountSatang: 5, netTotalSatang: 295 });

  const batches = await api.get('/api/admin/pos/stock/batches?limit=200');
  const batch = (await batches.json()).items.find((item: { name: string }) => item.name === 'QA-STOCK-ALLOC-001');
  expect(batch.items).toHaveLength(2);
  expect(batch.items.reduce((sum: number, item: { allocatedDiscountSatang: number }) => sum + item.allocatedDiscountSatang, 0)).toBe(5);
  expect(batch.items.every((item: { netTotalSatang: number }) => item.netTotalSatang >= 0)).toBeTruthy();
});

test('POS-STOCK-002 รับ 10 ชิ้นมูลค่ารวม 800 บาท ลด 100 บาทแล้ว weighted average เท่ากับ 85 บาท', async () => {
  const response = await api.post('/api/admin/pos/stock/batch', {
    headers,
    data: {
      name: 'QA-STOCK-WEIGHTED-001', mode: 'in', note: 'ตรวจต้นทุนเฉลี่ย', externalReferenceNo: 'INV-QA-0002',
      discountType: 'amount', discountAmountSatang: 10000,
      items: [{ productId: weightedProductId, quantity: 10, totalValueSatang: 80000 }],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  expect(await response.json()).toMatchObject({ grossTotalSatang: 80000, discountSatang: 10000, netTotalSatang: 70000 });
  expect(await product(weightedProductId)).toMatchObject({ stockQuantity: 20, costSatang: 8500 });
  const batches = await api.get('/api/admin/pos/stock/batches?limit=200');
  const batch = (await batches.json()).items.find((item: { name: string }) => item.name === 'QA-STOCK-WEIGHTED-001');
  expect(batch).toMatchObject({ externalReferenceNo: 'INV-QA-0002', grossTotalSatang: 80000 });
  expect(batch.items[0]).toMatchObject({
    delta: 10,
    balance: 20,
    unitCostSatang: 8000,
    grossTotalSatang: 80000,
    allocatedDiscountSatang: 10000,
    netTotalSatang: 70000,
    previousCostSatang: 10000,
    resultingCostSatang: 8500,
  });
});

test('POS-STOCK-003 จ่ายออกเกินคงเหลือ rollback ทั้งเอกสารและทุกสินค้า', async () => {
  const beforeA = await product(allocationProductAId);
  const beforeB = await product(allocationProductBId);
  const response = await api.post('/api/admin/pos/stock/batch', {
    headers,
    data: {
      name: 'QA-STOCK-ROLLBACK-001', mode: 'out', note: 'รายการที่สองเกินสต็อก',
      items: [
        { productId: allocationProductAId, quantity: 1 },
        { productId: allocationProductBId, quantity: beforeB.stockQuantity + 1 },
      ],
    },
  });
  expect(response.status()).toBe(409);
  expect((await product(allocationProductAId)).stockQuantity).toBe(beforeA.stockQuantity);
  expect((await product(allocationProductBId)).stockQuantity).toBe(beforeB.stockQuantity);
  const batches = await api.get('/api/admin/pos/stock/batches?limit=200');
  expect((await batches.json()).items.some((item: { name: string }) => item.name === 'QA-STOCK-ROLLBACK-001')).toBeFalsy();
});

test('POS-STOCK-004 ปรับยอดบันทึกจำนวนและมูลค่าก่อนหลังครบ', async () => {
  const before = await product(allocationProductAId);
  const target = before.stockQuantity + 3;
  const response = await api.post('/api/admin/pos/stock/batch', {
    headers,
    data: {
      name: 'QA-STOCK-ADJUST-001', mode: 'adjust', note: 'ตรวจนับจริง',
      items: [{ productId: allocationProductAId, quantity: 0, targetQuantity: target }],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const movements = await api.get('/api/admin/pos/stock/movements?limit=200');
  const movement = (await movements.json()).items.find((item: { referenceNo: string }) => item.referenceNo === 'QA-STOCK-ADJUST-001');
  expect(movement).toMatchObject({ type: 'adjust', quantity: 3, beforeStock: before.stockQuantity, afterStock: target });
  expect(movement.grossTotalSatang).toBe(before.costSatang * 3);
});

test('POS-STOCK-007 ส่วนลด 12.34% ปัดครึ่งขึ้นระดับสตางค์ถูกต้อง', async () => {
  const response = await api.post('/api/admin/pos/stock/batch', {
    headers,
    data: {
      name: 'QA-STOCK-PERCENT-1234', mode: 'in', note: '101 สตางค์ × 12.34% = ส่วนลด 12 สตางค์',
      discountType: 'percent', discountRateBps: 1234,
      items: [{ productId: percentProductId, quantity: 1, costSatang: 101 }],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  expect(await response.json()).toMatchObject({ grossTotalSatang: 101, discountSatang: 12, netTotalSatang: 89 });
  expect(await product(percentProductId)).toMatchObject({ stockQuantity: 1, costSatang: 89 });
});

test('POS-STOCK-008 ส่วนลดเต็มยอดทำให้ต้นทุนสุทธิเป็นศูนย์แต่สต็อกยังเพิ่มครบ', async () => {
  const response = await api.post('/api/admin/pos/stock/batch', {
    headers,
    data: {
      name: 'QA-STOCK-FULL-DISCOUNT', mode: 'in', note: 'ส่วนลด 100%',
      discountType: 'percent', discountRateBps: 10000,
      items: [{ productId: fullDiscountProductId, quantity: 2, costSatang: 50 }],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  expect(await response.json()).toMatchObject({ grossTotalSatang: 100, discountSatang: 100, netTotalSatang: 0 });
  expect(await product(fullDiscountProductId)).toMatchObject({ stockQuantity: 2, costSatang: 0 });
  const batches = await api.get('/api/admin/pos/stock/batches?limit=200');
  const batch = (await batches.json()).items.find((item: { name: string }) => item.name === 'QA-STOCK-FULL-DISCOUNT');
  expect(batch.items.every((item: { netTotalSatang: number }) => item.netTotalSatang === 0)).toBeTruthy();
});

test('POS-STOCK-009 จ่ายออกปกติจนเหลือศูนย์ใช้ต้นทุนเฉลี่ยปัจจุบันครบทุกสตางค์', async () => {
  const response = await api.post('/api/admin/pos/stock/batch', {
    headers,
    data: {
      name: 'QA-STOCK-OUT-TO-ZERO', mode: 'out', note: 'จ่ายออกครบ 3 ชิ้น',
      items: [{ productId: zeroOutProductId, quantity: 3 }],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  expect(await response.json()).toMatchObject({ grossTotalSatang: 999, discountSatang: 0, netTotalSatang: 999 });
  expect(await product(zeroOutProductId)).toMatchObject({ stockQuantity: 0, costSatang: 333 });
  const movements = await api.get('/api/admin/pos/stock/movements?limit=200');
  const movement = (await movements.json()).items.find((item: { referenceNo: string }) => item.referenceNo === 'QA-STOCK-OUT-TO-ZERO');
  expect(movement).toMatchObject({ type: 'out', quantity: -3, beforeStock: 3, afterStock: 0, unitCostSatang: 333, grossTotalSatang: 999, netTotalSatang: 999 });
});

test('POS-STOCK-010 ปรับยอด 0→10, 10→0 และ 0→0 บันทึกมูลค่าก่อนหลังถูก', async () => {
  const cases = [
    { name: 'QA-STOCK-ADJUST-0-10', target: 10, before: 0, delta: 10, value: 2500 },
    { name: 'QA-STOCK-ADJUST-10-0', target: 0, before: 10, delta: -10, value: 2500 },
    { name: 'QA-STOCK-ADJUST-0-0', target: 0, before: 0, delta: 0, value: 0 },
  ];
  for (const item of cases) {
    const response = await api.post('/api/admin/pos/stock/batch', {
      headers,
      data: {
        name: item.name, mode: 'adjust', note: 'edge case ปรับยอด',
        items: [{ productId: zeroAdjustProductId, quantity: 0, targetQuantity: item.target }],
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    expect(await response.json()).toMatchObject({ grossTotalSatang: item.value, netTotalSatang: item.value });
    const movements = await api.get('/api/admin/pos/stock/movements?limit=200');
    const movement = (await movements.json()).items.find((entry: { referenceNo: string }) => entry.referenceNo === item.name);
    expect(movement).toMatchObject({ reason: 'adjustment', quantity: item.delta, beforeStock: item.before, afterStock: item.target, grossTotalSatang: item.value });
  }
});

test('POS-STOCK-011 สองเครื่องจ่ายออกพร้อมกันและเอกสารซ้ำต้องไม่ตัดสต็อกเกิน', async () => {
  const concurrentRequests = [1, 2].map((index) => api.post('/api/admin/pos/stock/batch', {
    headers,
    data: {
      name: `QA-STOCK-CONCURRENT-${index}`, mode: 'out', note: 'ยิงพร้อมกัน',
      items: [{ productId: concurrentProductId, quantity: 4 }],
    },
  }));
  const concurrentResponses = await Promise.all(concurrentRequests);
  expect(concurrentResponses.map((response) => response.status()).sort()).toEqual([201, 409]);
  expect((await product(concurrentProductId)).stockQuantity).toBe(1);

  const duplicatePayload = {
    name: 'QA-STOCK-DUPLICATE-DOCUMENT', mode: 'out', note: 'กดบันทึกซ้ำ',
    items: [{ productId: duplicateProductId, quantity: 1 }],
  };
  const first = await api.post('/api/admin/pos/stock/batch', { headers, data: duplicatePayload });
  const duplicate = await api.post('/api/admin/pos/stock/batch', { headers, data: duplicatePayload });
  expect(first.status(), await first.text()).toBe(201);
  expect(duplicate.status()).toBe(409);
  expect((await product(duplicateProductId)).stockQuantity).toBe(4);
});

test('POS-STOCK-012 ปรับยอดลงต้องยังแสดงประเภทเป็นปรับยอด', async () => {
  test.fail(true, 'Known P2: movement mapper classifies every negative delta as stock-out even when reason is adjustment');
  const up = await api.post('/api/admin/pos/stock/batch', {
    headers,
    data: {
      name: 'QA-STOCK-ADJUST-TYPE-UP', mode: 'adjust', note: 'เตรียมตรวจประเภท',
      items: [{ productId: zeroAdjustProductId, quantity: 0, targetQuantity: 2 }],
    },
  });
  expect(up.status(), await up.text()).toBe(201);
  const down = await api.post('/api/admin/pos/stock/batch', {
    headers,
    data: {
      name: 'QA-STOCK-ADJUST-TYPE-DOWN', mode: 'adjust', note: 'ต้องเป็นปรับยอดแม้ delta ติดลบ',
      items: [{ productId: zeroAdjustProductId, quantity: 0, targetQuantity: 1 }],
    },
  });
  expect(down.status(), await down.text()).toBe(201);
  const movements = await api.get('/api/admin/pos/stock/movements?limit=200');
  const movement = (await movements.json()).items.find((item: { referenceNo: string }) => item.referenceNo === 'QA-STOCK-ADJUST-TYPE-DOWN');
  expect(movement).toMatchObject({ reason: 'adjustment', type: 'adjust', quantity: -1, beforeStock: 2, afterStock: 1 });
});

test('POS-STOCK-013 สินค้าหน่วยละหนึ่งสตางค์กระจายส่วนลดแล้วผลรวมตรงทุกสตางค์', async () => {
  const response = await api.post('/api/admin/pos/stock/batch', {
    headers,
    data: {
      name: 'QA-STOCK-TINY-SATANG', mode: 'in', note: 'ยอดรวม 5 สตางค์ ลด 3 สตางค์',
      discountType: 'amount', discountAmountSatang: 3,
      items: [
        { productId: tinySatangProductAId, quantity: 2, costSatang: 1 },
        { productId: tinySatangProductBId, quantity: 3, costSatang: 1 },
      ],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  expect(await response.json()).toMatchObject({ grossTotalSatang: 5, discountSatang: 3, netTotalSatang: 2 });
  const batches = await api.get('/api/admin/pos/stock/batches?limit=200');
  const batch = (await batches.json()).items.find((item: { name: string }) => item.name === 'QA-STOCK-TINY-SATANG');
  expect(batch.items.reduce((sum: number, item: { allocatedDiscountSatang: number }) => sum + item.allocatedDiscountSatang, 0)).toBe(3);
  expect(batch.items.reduce((sum: number, item: { netTotalSatang: number }) => sum + item.netTotalSatang, 0)).toBe(2);
  expect(batch.items.every((item: { netTotalSatang: number }) => item.netTotalSatang >= 0)).toBeTruthy();
});

test('POS-STOCK-014 ต้นทุนเฉลี่ยครึ่งสตางค์ปัดครึ่งขึ้น', async () => {
  const response = await api.post('/api/admin/pos/stock/batch', {
    headers,
    data: {
      name: 'QA-STOCK-WEIGHTED-HALF-UP', mode: 'in', note: 'เดิม 1@1 รับ 1@2 เฉลี่ย 1.5 ต้องเป็น 2',
      discountType: 'amount', discountAmountSatang: 0,
      items: [{ productId: halfUpProductId, quantity: 1, costSatang: 2 }],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  expect(await product(halfUpProductId)).toMatchObject({ stockQuantity: 2, costSatang: 2 });
});

test('POS-STOCK-015 ส่วนลดเกินยอดต้องถูกปฏิเสธและไม่เปลี่ยนสต็อก', async () => {
  const before = await product(tinySatangProductAId);
  const response = await api.post('/api/admin/pos/stock/batch', {
    headers,
    data: {
      name: 'QA-STOCK-DISCOUNT-OVER-GROSS', mode: 'in', note: 'ส่วนลดเกินยอด',
      discountType: 'amount', discountAmountSatang: 2,
      items: [{ productId: tinySatangProductAId, quantity: 1, costSatang: 1 }],
    },
  });
  expect(response.status()).toBe(400);
  expect(await product(tinySatangProductAId)).toMatchObject({ stockQuantity: before.stockQuantity, costSatang: before.costSatang });
  const batches = await api.get('/api/admin/pos/stock/batches?limit=200');
  expect((await batches.json()).items.some((item: { name: string }) => item.name === 'QA-STOCK-DISCOUNT-OVER-GROSS')).toBeFalsy();
});

test('POS-SALE-002 ขายคำนวณ VAT ปิด/รวม/แยกนอกและส่วนลดถึงสตางค์', async () => {
  const cases = [
    { requestId: 'qa-sale-vat-included', taxRatePercent: 7, pricesIncludeTax: true, discountType: 'amount', discountAmountSatang: 100, discountRateBps: 0, total: 9900, vat: 648 },
    { requestId: 'qa-sale-vat-excluded', taxRatePercent: 7, pricesIncludeTax: false, discountType: 'amount', discountAmountSatang: 100, discountRateBps: 0, total: 10593, vat: 693 },
    { requestId: 'qa-sale-vat-off', taxRatePercent: 0, pricesIncludeTax: false, discountType: 'percent', discountAmountSatang: 0, discountRateBps: 1234, total: 8766, vat: 0 },
  ];
  for (const item of cases) {
    await saveSettings({ taxRatePercent: item.taxRatePercent, pricesIncludeTax: item.pricesIncludeTax });
    const response = await api.post('/api/admin/pos/sales', {
      headers,
      data: {
        requestId: item.requestId, action: 'pay', buyerType: 'anonymous', method: 'promptpay',
        discountType: item.discountType, discountAmountSatang: item.discountAmountSatang,
        discountRateBps: item.discountRateBps, expectedTotalSatang: item.total,
        referenceNumber: `REF-${item.requestId}`, items: [{ productId: saleProductId, quantity: 1 }],
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    expect((await response.json()).totalSatang).toBe(item.total);
  }
  const sales = await api.get('/api/admin/pos/sales?status=paid&page=1&pageSize=100');
  const items = (await sales.json()).items;
  for (const expected of cases) {
    const sale = items.find((item: { referenceNumber?: string }) => item.referenceNumber === `REF-${expected.requestId}`);
    expect(sale).toMatchObject({ totalSatang: expected.total, vatSatang: expected.vat, pricesIncludeTax: expected.pricesIncludeTax });
  }
});

test('POS-SALE-004 เงินสดไม่พอไม่ตัดสต็อก และเงินเกินบันทึกเงินรับ/เงินทอนถูก', async () => {
  await saveSettings({ taxRatePercent: 7, pricesIncludeTax: true });
  const before = await product(saleProductId);
  const insufficient = await api.post('/api/admin/pos/sales', {
    headers,
    data: {
      requestId: 'qa-sale-cash-insufficient', action: 'pay', buyerType: 'anonymous', method: 'cash',
      discountType: 'amount', discountAmountSatang: 100, discountRateBps: 0,
      expectedTotalSatang: 9900, cashReceivedSatang: 9899,
      items: [{ productId: saleProductId, quantity: 1 }],
    },
  });
  expect(insufficient.status()).toBe(400);
  expect((await product(saleProductId)).stockQuantity).toBe(before.stockQuantity);

  const paid = await api.post('/api/admin/pos/sales', {
    headers,
    data: {
      requestId: 'qa-sale-cash-change', action: 'pay', buyerType: 'anonymous', method: 'cash',
      discountType: 'amount', discountAmountSatang: 100, discountRateBps: 0,
      expectedTotalSatang: 9900, cashReceivedSatang: 20000,
      items: [{ productId: saleProductId, quantity: 1 }],
    },
  });
  expect(paid.status(), await paid.text()).toBe(201);
  const saleId = (await paid.json()).saleId;
  const sales = await api.get('/api/admin/pos/sales?status=paid&page=1&pageSize=100');
  const sale = (await sales.json()).items.find((item: { id: string }) => item.id === saleId);
  expect(sale).toMatchObject({ paymentMethod: 'cash', cashReceivedSatang: 20000, changeSatang: 10100, totalSatang: 9900 });
});

test('POS-SALE-006 stale total ได้ 409 และ request ซ้ำไม่ตัด stock ซ้ำ', async () => {
  await saveSettings({ taxRatePercent: 7, pricesIncludeTax: true });
  const before = await product(saleProductId);
  const stale = await api.post('/api/admin/pos/sales', {
    headers,
    data: {
      requestId: 'qa-sale-stale-total', action: 'pay', buyerType: 'anonymous', method: 'promptpay',
      discountType: 'amount', discountAmountSatang: 0, discountRateBps: 0,
      expectedTotalSatang: 9999, items: [{ productId: saleProductId, quantity: 1 }],
    },
  });
  expect(stale.status()).toBe(409);
  expect((await product(saleProductId)).stockQuantity).toBe(before.stockQuantity);

  const payload = {
    requestId: 'qa-sale-idempotent', action: 'pay', buyerType: 'anonymous', method: 'promptpay',
    discountType: 'amount', discountAmountSatang: 0, discountRateBps: 0,
    expectedTotalSatang: 10000, items: [{ productId: saleProductId, quantity: 1 }],
  };
  const first = await api.post('/api/admin/pos/sales', { headers, data: payload });
  expect(first.status(), await first.text()).toBe(201);
  const afterFirst = await product(saleProductId);
  const duplicate = await api.post('/api/admin/pos/sales', { headers, data: payload });
  expect(duplicate.status(), await duplicate.text()).toBe(200);
  expect((await duplicate.json()).duplicate).toBeTruthy();
  expect((await product(saleProductId)).stockQuantity).toBe(afterFirst.stockQuantity);
});

test('POS-PAY-002 ยกเลิก Hold คืนสต็อกและเก็บสถานะ void ในประวัติ', async () => {
  await saveSettings({ taxRatePercent: 7, pricesIncludeTax: true });
  const before = await product(saleProductId);
  const hold = await api.post('/api/admin/pos/sales', {
    headers,
    data: {
      requestId: 'qa-sale-hold-void', action: 'hold', buyerType: 'member', buyerId: 'qa-member-a-3',
      discountType: 'amount', discountAmountSatang: 0, discountRateBps: 0,
      expectedTotalSatang: 20000, items: [{ productId: saleProductId, quantity: 2 }],
    },
  });
  expect(hold.status(), await hold.text()).toBe(201);
  const saleId = (await hold.json()).saleId;
  expect((await product(saleProductId)).stockQuantity).toBe(before.stockQuantity - 2);
  const voided = await api.post(`/api/admin/pos/sales/${saleId}/void`, { headers, data: { note: 'QA void test' } });
  expect(voided.ok(), await voided.text()).toBeTruthy();
  expect((await product(saleProductId)).stockQuantity).toBe(before.stockQuantity);
  const sales = await api.get('/api/admin/pos/sales?status=void&page=1&pageSize=100');
  expect((await sales.json()).items.find((item: { id: string }) => item.id === saleId)?.status).toBe('void');
});

test('POS-DASH-001 ช่วง 1d/1w/1m และการ์ด dashboard ตรงยอดขายจริง', async () => {
  test.fail(true, 'Known P2: averageBillSatang uses truncation instead of half-up rounding');
  const salesResponse = await api.get('/api/admin/pos/sales?status=paid&page=1&pageSize=100');
  const paidSales = (await salesResponse.json()).items as Array<{ totalSatang: number }>;
  const expectedSales = paidSales.reduce((sum, sale) => sum + sale.totalSatang, 0);
  for (const range of ['1d', '1w', '1m']) {
    const response = await api.get(`/api/admin/pos/dashboard?range=${range}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    const dashboard = await response.json();
    expect(dashboard.range).toBe(range);
    expect(Date.parse(dashboard.from)).not.toBeNaN();
    expect(Date.parse(dashboard.to)).not.toBeNaN();
    expect(dashboard.salesSatang).toBe(expectedSales);
    expect(dashboard.completedBills).toBe(paidSales.length);
    expect(dashboard.averageBillSatang).toBe(Math.round(expectedSales / paidSales.length));
    expect(dashboard.lowStockItems.every((item: { name: string; sku: string }) => item.name && item.sku)).toBeTruthy();
  }
});

test('POS-RPT-001 รายงานวัน/สัปดาห์/เดือน/custom ยอด VAT และวิธีชำระตรงประวัติ', async () => {
  const salesResponse = await api.get('/api/admin/pos/sales?status=paid&page=1&pageSize=100');
  const paidSales = (await salesResponse.json()).items as Array<{ totalSatang: number; vatSatang: number }>;
  const expectedSales = paidSales.reduce((sum, sale) => sum + sale.totalSatang, 0);
  const expectedVat = paidSales.reduce((sum, sale) => sum + sale.vatSatang, 0);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
  const queries = [
    'range=day', 'range=week', 'range=month',
    `range=custom&startDate=${today}&endDate=${today}`,
  ];
  for (const query of queries) {
    const response = await api.get(`/api/admin/pos/reports?${query}&topPage=1&vatPage=1&exportAll=1`);
    expect(response.ok(), await response.text()).toBeTruthy();
    const report = await response.json();
    expect(report.summary.totalSalesSatang).toBe(expectedSales);
    expect(report.summary.totalVatSatang).toBe(expectedVat);
    expect(report.summary.completedBills).toBe(paidSales.length);
    expect(report.paymentStats.cashSatang + report.paymentStats.promptPaySatang).toBe(expectedSales);
    expect(report.topSellers.every((item: { name: string }) => item.name && !item.name.startsWith('qa-product-'))).toBeTruthy();
    expect(report.salesPagination.total).toBe(paidSales.length);
  }
});

test('POS-CAT-008 จำนวนในแพ็ครับเฉพาะจำนวนเต็มในขอบเขตและคืนค่าจาก API', async () => {
  const valid = await api.post('/api/admin/pos/products', {
    headers,
    data: {
      sku: 'QA-PACK-VALID', barcode: '', category: 'qa-category-snack-a', name: 'QA แพ็ค 12',
      priceThb: 10, priceSatang: 1000, costThb: 5, costSatang: 500, stockQuantity: 101,
      lowStockThreshold: 5, unitsPerPack: 12, active: true, unit: 'ชิ้น', imageData: '', description: '',
    },
  });
  expect(valid.status(), await valid.text()).toBe(201);
  const created = await valid.json();
  expect(created.unitsPerPack).toBe(12);
  expect(await product(created.id)).toMatchObject({ stockQuantity: 101 });

  for (const unitsPerPack of [-1, 1_000_001, 1.5]) {
    const invalid = await api.post('/api/admin/pos/products', {
      headers,
      data: { sku: `QA-PACK-BAD-${String(unitsPerPack)}`, barcode: '', category: 'ของว่าง', name: 'QA แพ็คผิด', priceSatang: 100, costSatang: 0, stockQuantity: 0, lowStockThreshold: 0, unitsPerPack, active: true, unit: 'ชิ้น', imageData: '', description: '' },
    });
    expect(invalid.status()).toBe(400);
  }
});

test('POS-RPT-003 สินค้าที่ขายแสดงเฉพาะ paid พร้อม pagination', async () => {
  await saveSettings({ taxRatePercent: 7, pricesIncludeTax: true });
  const paid = await api.post('/api/admin/pos/sales', {
    headers,
    data: { requestId: 'qa-report-paid-product', action: 'pay', buyerType: 'anonymous', method: 'promptpay', discountType: 'amount', discountAmountSatang: 0, discountRateBps: 0, expectedTotalSatang: 10000, items: [{ productId: saleProductId, quantity: 1 }] },
  });
  expect([200, 201]).toContain(paid.status());
  const response = await api.get('/api/admin/pos/reports/sold-products?range=day&page=1&pageSize=5');
  expect(response.ok(), await response.text()).toBeTruthy();
  const report = await response.json();
  expect(report.pagination.pageSize).toBe(5);
  expect(report.items.every((item: { name: string; quantity: number; billCount: number }) => item.name && item.quantity > 0 && item.billCount > 0)).toBeTruthy();
  expect(report.summary.totalQuantity).toBeGreaterThan(0);
  expect(report.summary.totalRevenueSatang).toBeGreaterThan(0);
});

test('POS-RPT-004 สินค้าคงเหลือคำนวณแพ็ค เศษ filter และไม่แสดง category code', async () => {
  const response = await api.get('/api/admin/pos/reports/inventory?page=1&pageSize=100&packStatus=configured&status=all&stockStatus=all');
  expect(response.ok(), await response.text()).toBeTruthy();
  const report = await response.json();
  const coffee = report.items.find((item: { productId: string }) => item.productId === 'qa-product-coffee-a');
  expect(coffee).toMatchObject({ category: 'เครื่องดื่ม', unitsPerPack: 12, fullPacks: 3, remainderUnits: 4 });
  expect(report.items.some((item: { productId: string }) => item.productId === 'qa-product-b')).toBeFalsy();
});

test('POS-RPT-005 Special แยก LiveMatch Session วันเดียวกันและนับลูกจริง', async () => {
  const response = await api.get('/api/admin/pos/reports/special?range=day&posPage=1&sessionPage=1&exportAll=1');
  expect(response.ok(), await response.text()).toBeTruthy();
  const report = await response.json();
  expect(report.summary.sessionCount).toBe(2);
  expect(report.sessions.map((session: { name: string }) => session.name).sort()).toEqual(['QA Cross-system Session', 'QA Same-day Session 2'].sort());
  expect(report.sessions.find((session: { id: string }) => session.id === 'qa-session-a').shuttleQuantity).toBe(2);
  expect(report.sessions.find((session: { id: string }) => session.id === 'qa-session-a-2').playerCount).toBe(1);
  expect(report.summary.totalSatang).toBe(report.summary.posRevenueSatang + report.summary.matchEntryFeeSatang + report.summary.matchShuttleSatang);
});

test('POS-STOCK-006 ประวัติใช้สีรับเข้าเขียว จ่ายออกแดง และปรับยอดส้ม', async ({ page }) => {
  test.fail(true, 'Known P2: stock movement badge colors do not match the approved mapping');
  await page.goto('/');
  await page.getByRole('button', { name: /จัดการสต็อก/ }).click();
  await page.getByRole('button', { name: /ประวัติเคลื่อนไหวรายชิ้น/ }).click();
  const classes = async (label: string) => page.getByText(label, { exact: true }).first().getAttribute('class');
  expect(await classes('รับเข้า')).toMatch(/green|emerald/);
  expect(await classes('จ่ายออก')).toMatch(/red/);
  expect(await classes('ปรับยอด')).toMatch(/orange|amber/);
});

test('POS-STOCK-016 @smoke ยิงบาร์โค้ดเลือกสินค้าใน modal รับเข้า จ่ายออก และปรับยอด', async ({ page }) => {
  const modes = [
    { button: '#stock-in-batch-btn', heading: 'บันทึกรับสินค้าเข้าสต็อก (แบบรวมหลายรายการ)' },
    { button: '#stock-out-batch-btn', heading: 'บันทึกจ่ายสินค้าออกจากคลัง (แบบรวมหลายรายการ)' },
    { button: '#adjust-stock-batch-btn', heading: 'บันทึกตรวจนับและปรับปรุงยอดสต็อกจริง' },
  ];
  for (const mode of modes) {
    await page.goto('/');
    await page.getByRole('button', { name: /จัดการสต็อก/ }).click();
    await page.locator(mode.button).click();
    const search = page.locator('#stock-batch-product-search');
    await search.fill('8850000000001');
    await search.press('Enter');
    await expect(search).toHaveValue('');
    await expect(page.getByRole('heading', { name: mode.heading })).toBeVisible();
    await expect(page.getByText('กาแฟ QA', { exact: true }).last()).toBeVisible();
  }
});
