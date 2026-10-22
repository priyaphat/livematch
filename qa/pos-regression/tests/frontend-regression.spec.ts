import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const suiteRoot = path.resolve(currentDir, '..');
const frontendURL = process.env.MATCH_QA_BASE_URL || 'http://localhost:5273';

test.use({ storageState: path.join(suiteRoot, '.auth/match-owner-a.json') });

test('POS-QC-001 @smoke @webkit Backoffice login supports bootstrap and legacy summary contracts', async ({ page, request }) => {
  const unexpected: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/') && [404, 500, 502, 503].includes(response.status())) unexpected.push(`${response.status()} ${response.url()}`);
  });
  const authorization = `Basic ${Buffer.from('qa-superadmin:qa-superadmin-only').toString('base64')}`;
  const bootstrap = await request.get(`${frontendURL}/api/backoffice/bootstrap`, { headers: { Authorization: authorization } });
  expect(bootstrap.ok()).toBeTruthy();
  expect(await bootstrap.json()).not.toHaveProperty('users');
  const summary = await request.get(`${frontendURL}/api/backoffice/summary`, { headers: { Authorization: authorization } });
  expect(summary.ok()).toBeTruthy();
  expect(await summary.json()).toHaveProperty('users');

  await page.goto(`${frontendURL}/backoffice`);
  await page.getByPlaceholder('superadmin').fill('qa-superadmin');
  await page.locator('input[type="password"]').fill('qa-superadmin-only');
  await page.getByRole('button', { name: 'เข้าสู่หลังบ้าน' }).click();
  await expect(page.getByText('ตั้งค่าภาพรวม')).toBeVisible();
  expect(unexpected).toEqual([]);
});

test('POS-QC-002 @smoke @webkit Match history can reach records older than 100 games and search on the server', async ({ page }) => {
  const unexpected: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/') && [404, 500, 502, 503].includes(response.status())) unexpected.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`${frontendURL}/?session=qa-session-history&tab=history`);
  await expect(page.getByText('125 รายการ')).toBeVisible();
  await expect(page.getByTestId('match-history-item')).toHaveCount(20);
  await expect(page.getByText('หน้า 1 / 7')).toBeVisible();
  for (let pageNumber = 2; pageNumber <= 7; pageNumber += 1) {
    await page.getByRole('button', { name: 'ถัดไป' }).click();
    await expect(page.getByText(`หน้า ${pageNumber} / 7`)).toBeVisible();
  }
  await expect(page.getByTestId('match-history-item').first()).toContainText(/เกมที่\s*1/);
  await page.getByLabel('กรองประวัติด้วยชื่อ').fill('oldest-history-marker');
  await expect(page.getByText('1 รายการ')).toBeVisible();
  await expect(page.getByTestId('match-history-item')).toHaveCount(1);
  expect(unexpected).toEqual([]);
});

test('POS-QC-003 Match read-only menus load without unexpected API failures', async ({ page }) => {
  const unexpected: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/') && [404, 500, 502, 503].includes(response.status())) unexpected.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`${frontendURL}/?session=qa-session-a&tab=dashboard`);
  for (const label of ['สมาชิก', 'จัดคู่', 'รอคิว', 'แข่งอยู่', 'ประวัติ', 'ตั้งค่า', 'วิธีใช้']) {
    await page.getByRole('button', { name: label, exact: true }).first().click();
    await expect(page.getByRole('button', { name: label, exact: true }).first()).toBeVisible();
  }
  expect(unexpected).toEqual([]);
});

test('POS-QC-004 @smoke Backoffice defers every data section until its tab opens', async ({ page }) => {
  const requested: string[] = [];
  const unexpected: string[] = [];
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/backoffice/')) requested.push(url);
    if (url.includes('/api/') && [404, 500, 502, 503].includes(response.status())) unexpected.push(`${response.status()} ${url}`);
  });

  await page.goto(`${frontendURL}/backoffice`);
  await page.getByPlaceholder('superadmin').fill('qa-superadmin');
  await page.locator('input[type="password"]').fill('qa-superadmin-only');
  await page.getByRole('button', { name: 'เข้าสู่หลังบ้าน' }).click();
  await expect(page.getByText('ตั้งค่าภาพรวม')).toBeVisible();

  for (const deferredPath of ['/admins?', '/coin-orders?', '/support-issues?', '/slipok-logs?', '/activity-logs?']) {
    expect(requested.some((url) => url.includes(deferredPath)), `${deferredPath} loaded before its tab opened`).toBeFalsy();
  }

  for (const label of ['บริการเชื่อมต่อ', 'จัดการ Coin', 'แพ็กเกจขาย', 'รายการชำระเงิน', 'สมาชิก admin', 'แจ้งปัญหา', 'OKSlip log', 'Activity log']) {
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).first().click();
    await page.waitForTimeout(150);
  }

  for (const expectedPath of ['/admins?', '/coin-orders?', '/support-issues?', '/slipok-logs?', '/activity-logs?']) {
    expect(requested.some((url) => url.includes(expectedPath)), `${expectedPath} was not loaded after opening its tab`).toBeTruthy();
  }
  expect(unexpected).toEqual([]);
});

test('POS-QC-006 รายละเอียด Admin แบ่งหน้า Session รายการซื้อ และ Coin ledger จาก server', async ({ page }) => {
  await page.goto(`${frontendURL}/backoffice`);
  await page.getByPlaceholder('superadmin').fill('qa-superadmin');
  await page.locator('input[type="password"]').fill('qa-superadmin-only');
  await page.getByRole('button', { name: 'เข้าสู่หลังบ้าน' }).click();
  await page.getByRole('button', { name: /^สมาชิก admin/ }).click();
  await page.getByPlaceholder('ค้นหาชื่อ อีเมล หรือ Admin No.').fill('qa.owner.a@example.invalid');
  await page.getByRole('button', { name: 'ค้นหา', exact: true }).click();
  const adminRow = page.getByText('qa.owner.a@example.invalid', { exact: true }).locator('xpath=../..');
  await adminRow.getByRole('button', { name: /Admin DB Preview/ }).click();
  await expect(page.getByRole('heading', { name: 'QA Owner A' })).toBeVisible();

  const cases = [
    { label: 'จำนวน Session ต่อหน้า', prefix: 'session' },
    { label: 'จำนวนรายการซื้อ Coin ต่อหน้า', prefix: 'order' },
    { label: 'จำนวน Coin ledger ต่อหน้าในรายละเอียด Admin', prefix: 'ledger' },
  ];
  for (const item of cases) {
    const select = page.getByLabel(item.label);
    await expect(select).toHaveValue('10');
    const pager = item.prefix === 'session' ? select.locator('xpath=..') : select.locator('xpath=../..');
    await expect(pager).toContainText('หน้า 1 / 3');
    const requestPromise = page.waitForRequest((request) => {
      if (!request.url().includes('/api/backoffice/admins/qa-admin-a?')) return false;
      return new URL(request.url()).searchParams.get(`${item.prefix}Page`) === '2';
    });
    await pager.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    const request = await requestPromise;
    expect(new URL(request.url()).searchParams.get(`${item.prefix}PageSize`)).toBe('10');
    await expect(page.getByLabel(item.label).locator(item.prefix === 'session' ? 'xpath=..' : 'xpath=../..')).toContainText('หน้า 2 / 3');
  }
});

test('POS-QC-005 @smoke Booking and member admin pages lazy-load their menus without API failures', async ({ page }) => {
  const requested: string[] = [];
  const unexpected: string[] = [];
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/admin/booking/')) requested.push(url);
    if (url.includes('/api/') && [404, 500, 502, 503].includes(response.status())) unexpected.push(`${response.status()} ${url}`);
  });

  await page.goto(`${frontendURL}/admin/booking`);
  await expect(page.getByRole('navigation', { name: 'เมนูระบบจองสนาม' })).toBeVisible();
  expect(requested.some((url) => url.includes('/history?')), 'history loaded before opening its tab').toBeFalsy();
  expect(requested.some((url) => url.includes('/blacklist?')), 'blacklist loaded before opening its tab').toBeFalsy();

  for (const label of ['ประวัติการจอง', 'Blacklist', 'รายงาน', 'ตั้งค่า', 'รอตรวจสอบ']) {
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).first().click();
    await page.waitForTimeout(150);
  }
  expect(requested.some((url) => url.includes('/history?'))).toBeTruthy();
  expect(requested.some((url) => url.includes('/blacklist?'))).toBeTruthy();

  await page.goto(`${frontendURL}/admin/members`);
  await expect(page.getByRole('heading', { name: 'ระบบสมาชิก' })).toBeVisible();
  await expect(page.getByText('รายชื่อสมาชิก')).toBeVisible();
  expect(unexpected).toEqual([]);
});
