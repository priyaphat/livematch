import { expect, test } from '@playwright/test';
import { formatInventorySlipLine } from '../../../pos/src/utils/reportSlip';

test('POS-RPT-008 สลิปย่อสินค้าคงเหลือแสดงแพ็ก เศษ และจำนวนรวม', () => {
  expect(formatInventorySlipLine({
    name: 'น้ำดื่ม QA', unit: 'ขวด', stockQuantity: 29,
    unitsPerPack: 12, fullPacks: 2, remainderUnits: 5,
  })).toBe('น้ำดื่ม QA\n  2 แพ็ค + เศษ 5 ขวด · รวม 29 ขวด');

  expect(formatInventorySlipLine({
    name: 'เค้ก QA', unit: 'ชิ้น', stockQuantity: 7,
    unitsPerPack: 0, fullPacks: null, remainderUnits: null,
  })).toBe('เค้ก QA  7 ชิ้น');
});
