import { StoreSettings } from '../types';

// Safe application defaults only. Catalog, customer, order and stock data must
// always come from the authenticated API (or be explicitly created by a user).
export const INITIAL_SETTINGS: StoreSettings = {
  storeName: 'LiveMatch POS',
  taxId: '',
  phone: '',
  email: '',
  address: '',
  promptPayId: '',
  currencySymbol: '฿',
  decimalPlaces: 2,
  vatEnabled: false,
  vatRate: 0,
  vatType: 'included',
  receiptFooterMessage: 'ขอบคุณที่ใช้บริการ / Thank you!',
  printerType: 'thermal_80mm',
  autoPrintReceipt: true,
  enableSoundEffects: true,
  hardwareKeyboardMode: false,
  cashierName: '',
  logoData: '',
  navbarTitle: '',
  navbarIconData: '',
  customerDisplayTitle: 'ยินดีต้อนรับ',
  customerDisplayHighlight: 'กรุณาตรวจสอบรายการและยอดชำระ',
  customerDisplaySubtitle: 'รายการสินค้าและยอดเงินจะแสดงบนหน้าจอนี้แบบเรียลไทม์',
  customerDisplayCardText: 'ตรวจสอบรายการให้ถูกต้องก่อนชำระเงิน',
  customerDisplayCtaText: 'กรุณาติดต่อพนักงานหากต้องการแก้ไขรายการ',
  defaultLowStock: 0,
  theme: 'light',
};
