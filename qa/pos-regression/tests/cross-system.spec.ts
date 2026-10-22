import { expect, test } from '@playwright/test';
import { csrfHeaders, ownerApi } from './helpers';

test.describe.configure({ mode: 'serial' });

test('POS-XMATCH-001 @smoke @cross-system POS เห็นสมาชิก Match-only แม้ยอด POS เป็นศูนย์', async () => {
  const api = await ownerApi();
  const response = await api.get('/api/admin/pos/receivables?page=1&pageSize=100');
  expect(response.ok()).toBeTruthy();
  const item = (await response.json()).items.find((entry: { memberId: string }) => entry.memberId === 'qa-member-a-1');
  expect(item).toBeTruthy();
  expect(item.matchTotalSatang).toBeGreaterThan(0);
  expect(item.posTotalSatang).toBe(0);
  await api.dispose();
});

test('POS-XMATCH-002 @cross-system สมาชิก Match ที่ผูก Member ID มาครบและ guest ไม่รวม', async () => {
  const api = await ownerApi();
  const response = await api.get('/api/admin/pos/receivables?page=1&pageSize=100');
  const items = (await response.json()).items;
  expect(items.filter((entry: { memberId: string }) => entry.memberId.startsWith('qa-member-a-'))).toHaveLength(3);
  expect(items.some((entry: { displayName: string }) => entry.displayName === 'ผู้เล่นขาจร QA')).toBeFalsy();
  await api.dispose();
});

test('POS-XMATCH-004 @smoke @cross-system POS Hold ใช้ billing account เดิมและ Match summary เห็นยอด POS', async () => {
  const api = await ownerApi();
  const headers = await csrfHeaders(api);
  const hold = await api.post('/api/admin/pos/sales', {
    headers,
    data: {
      requestId: 'qa-e2e-cross-hold-001', action: 'hold', buyerType: 'member', buyerId: 'qa-member-a-2',
      discountType: 'amount', discountAmountSatang: 0, discountRateBps: 0,
      expectedTotalSatang: 4500, items: [{ productId: 'qa-product-coffee-a', quantity: 1 }],
    },
  });
  expect(hold.ok(), await hold.text()).toBeTruthy();
  expect((await hold.json()).billingAccountId).toBe('qa-billing-a-2');
  const summary = await api.get('/api/admin/pos/billing-summary?accountId=qa-billing-a-2');
  expect(summary.ok()).toBeTruthy();
  expect((await summary.json()).posTotalSatang).toBe(4500);
  await api.dispose();
});

test('POS-XMATCH-008 @cross-system ชำระแล้วกลับมาเล่นและสั่ง POS ต้องมียอดเพิ่มใน Match sync', async () => {
  const api = await ownerApi();
  const headers = await csrfHeaders(api);
  const beforeSettlement = await api.get('/api/admin/pos/billing-summary?accountId=qa-billing-a-3');
  const initial = await beforeSettlement.json();
  const settlement = await api.post('/api/admin/pos/settlements', {
    headers,
    data: { billingAccountId: 'qa-billing-a-3', method: 'cash', expectedTotalSatang: initial.totalSatang, cashReceivedSatang: initial.totalSatang },
  });
  expect(settlement.ok(), await settlement.text()).toBeTruthy();
  const resume = await api.post('/api/sessions/qa-session-a/players/3/resume', { headers, data: {} });
  expect(resume.ok(), await resume.text()).toBeTruthy();
  const hold = await api.post('/api/admin/pos/sales', {
    headers,
    data: {
      requestId: 'qa-resume-pos-hold-001', action: 'hold', buyerType: 'member', buyerId: 'qa-member-a-3',
      discountType: 'amount', discountAmountSatang: 0, discountRateBps: 0,
      expectedTotalSatang: 4500, items: [{ productId: 'qa-product-coffee-a', quantity: 1 }],
    },
  });
  expect(hold.ok(), await hold.text()).toBeTruthy();
  const sync = await api.get('/api/sessions/qa-session-a/billing-sync');
  expect(sync.ok(), await sync.text()).toBeTruthy();
  const player = (await sync.json()).players.find((item: { playerId: number }) => item.playerId === 3);
  expect(player).toMatchObject({ paid: false, posTotalSatang: 4500, totalSatang: 4500 });
  await api.dispose();
});

test('POS-XMEM-001 @smoke @cross-system ค้นสมาชิกได้เฉพาะ active member ของ Admin เดียวกัน', async () => {
  const api = await ownerApi();
  const response = await api.get('/api/admin/pos/members?search=สมาชิก%20QA');
  expect(response.ok()).toBeTruthy();
  const items = (await response.json()).items;
  expect(items.some((item: { id: string }) => item.id === 'qa-member-a-1')).toBeTruthy();
  expect(items.some((item: { id: string }) => item.id === 'qa-member-a-inactive')).toBeFalsy();
  expect(items.some((item: { id: string }) => item.id === 'qa-member-b-1')).toBeFalsy();
  await api.dispose();
});

test('POS-XMEM-002 @cross-system เพิ่มสมาชิกจาก POS แล้วอยู่ใน tenant เดิม', async () => {
  const api = await ownerApi();
  const headers = await csrfHeaders(api);
  const response = await api.post('/api/admin/pos/members', {
    headers,
    data: { name: 'สมาชิกสร้างจาก POS QA', phone: '0819999999', memberTypeId: 'qa-member-type-a-general' },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const created = await response.json();
  const search = await api.get(`/api/admin/pos/members?search=${encodeURIComponent('สมาชิกสร้างจาก POS QA')}`);
  expect((await search.json()).items.some((item: { id: string }) => item.id === created.id)).toBeTruthy();

  const ownerB = await ownerApi('b');
  const crossTenant = await ownerB.get('/api/admin/pos/members?search=0819999999');
  expect((await crossTenant.json()).items).toHaveLength(0);
  await ownerB.dispose();
  await api.dispose();
});
