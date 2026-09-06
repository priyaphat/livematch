import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { csrfHeaders, ownerApi, posBaseURL } from './helpers';

test('POS-RPT-009 ซ่อนต้นทุนและราคาขายทั้ง UI Network และ Excel', async ({ browser }) => {
  const owner = await ownerApi();
  const headers = await csrfHeaders(owner);
  const accessResponse = await owner.get('/api/admin/pos/access');
  expect(accessResponse.ok(), await accessResponse.text()).toBeTruthy();
  const access = await accessResponse.json();
  const original = JSON.parse(JSON.stringify({ manager: access.permissions.manager, cashier: access.permissions.cashier }));

  try {
    const restricted = JSON.parse(JSON.stringify(original));
    restricted.manager.reports = true;
    restricted.manager.report_inventory = true;
    restricted.manager.report_inventory_values = false;
    restricted.manager.report_export = true;
    const saveResponse = await owner.put('/api/admin/pos/permissions', { headers, data: restricted });
    expect(saveResponse.ok(), await saveResponse.text()).toBeTruthy();

    const context = await browser.newContext({ baseURL: posBaseURL });
    await context.clearCookies();
    const loginPage = await context.newPage();
    await loginPage.goto('/');
    await loginPage.getByPlaceholder('admin@example.com หรือ 1001-01').fill('qa.manager.a@example.invalid');
    await loginPage.getByPlaceholder('กรอกรหัสผ่าน หรือ PIN').fill('246824');
    await loginPage.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
    await expect(loginPage.locator('#pos-search-input')).toBeVisible();
    const directReport = await context.request.get('/api/admin/pos/reports/inventory?page=1&pageSize=20&status=all&stockStatus=all&packStatus=all');
    expect(directReport.ok(), await directReport.text()).toBeTruthy();
    const directBody = await directReport.json();
    expect(directBody.items.length).toBeGreaterThan(0);
    for (const item of directBody.items) {
      expect(item).not.toHaveProperty('costSatang');
      expect(item).not.toHaveProperty('costValueSatang');
      expect(item).not.toHaveProperty('priceSatang');
      expect(item).not.toHaveProperty('retailValueSatang');
    }

    const page = loginPage;
    const exposedResponses: string[] = [];
    page.on('response', async (response) => {
      if (!response.url().includes('/api/admin/pos/reports/inventory?') || !response.ok()) return;
      const text = await response.text();
      for (const field of ['costSatang', 'costValueSatang', 'priceSatang', 'retailValueSatang']) {
        if (text.includes(`"${field}"`)) exposedResponses.push(field);
      }
    });
    await page.goto('/');
    await page.getByRole('button', { name: /รายงาน/ }).first().click();
    await page.getByRole('button', { name: 'สินค้าคงเหลือ', exact: true }).click();
    const row = page.getByText('กาแฟ QA', { exact: true }).locator('xpath=ancestor::tr');
    await expect(row).toContainText('***');
    await expect(row).not.toContainText('฿20.00');
    expect(exposedResponses).toEqual([]);

    await page.evaluate(() => { Reflect.deleteProperty(window, 'showSaveFilePicker'); });
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'ส่งออกแท็บนี้ Excel', exact: true }).click();
    const download = await downloadPromise;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(await download.path() as string);
    const worksheet = workbook.worksheets[0];
    const excelRow = worksheet.getRows(1, worksheet.rowCount)?.find((candidate) => candidate.getCell(2).value === 'กาแฟ QA');
    expect(excelRow, 'inventory Excel row is missing').toBeTruthy();
    for (const column of [10, 11, 12, 13]) expect(excelRow!.getCell(column).value).toBe('***');
    await context.close();
  } finally {
    const restore = await owner.put('/api/admin/pos/permissions', { headers, data: original });
    expect(restore.ok(), await restore.text()).toBeTruthy();
    await owner.dispose();
  }
});
