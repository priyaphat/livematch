import { expect, test } from '@playwright/test';
import { ownerApi } from './helpers';

test('POS-NF-001 @responsive critical page ไม่มี horizontal overflow และ nav ไม่ทับ viewport', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#pos-search-input')).toBeVisible();
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
});

test('POS-NF-002 API read ทั่วไปไม่เกิน 1 วินาทีใน Local QA', async () => {
  const api = await ownerApi();
  const started = performance.now();
  const response = await api.get('/api/admin/pos/products?page=1&pageSize=20&status=all');
  const elapsed = performance.now() - started;
  expect(response.ok()).toBeTruthy();
  expect(elapsed).toBeLessThan(1_000);
  await api.dispose();
});

test('POS-CAT-006 modal หมวดหมู่และหน่วยนับไม่ล้นกรอบบน Desktop/Mobile', async ({ page }) => {
  for (const viewport of [{ width: 700, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByRole('button', { name: 'จัดการสินค้า' }).click();

    for (const modal of [
      { trigger: '#manage-categories-btn', name: 'จัดการหมวดหมู่สินค้า (Categories)' },
      { trigger: '#manage-units-btn', name: 'จัดการหน่วยนับสินค้า (Units)' },
    ]) {
      await page.locator(modal.trigger).click();
      const dialog = page.getByRole('dialog', { name: modal.name });
      await expect(dialog).toBeVisible();
      const fits = await dialog.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const controls = Array.from(element.querySelectorAll('form input, form select, form button'));
        return controls.every((control) => {
          const box = control.getBoundingClientRect();
          return box.left >= bounds.left - 1 && box.right <= bounds.right + 1;
        });
      });
      expect(fits).toBeTruthy();
      await dialog.getByRole('button', { name: /ปิดหน้าต่าง/ }).click();
    }
  }
});
