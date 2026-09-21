import { printIminBitmap, printIminRichReceipt } from './iminPrinter';

export interface PaymentQrSlipLine {
  name: string;
  quantity: number;
  amount: number;
}

export interface PaymentQrSlipData {
  storeName: string;
  phone?: string;
  logoData?: string;
  customerName?: string;
  reference?: string;
  receiverName?: string;
  lines: PaymentQrSlipLine[];
  subtotal: number;
  discount: number;
  total: number;
  currencySymbol: string;
  decimalPlaces: number;
  qrDataUrl: string;
  qrPayload?: string;
  paperWidth: '58mm' | '80mm';
}

const money = (value: number, data: PaymentQrSlipData) => `${data.currencySymbol}${Number(value || 0).toFixed(data.decimalPlaces)}`;
const safe = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));

export const paymentQrSlipText = (data: PaymentQrSlipData) => {
  const rows = [
    data.storeName || 'POS',
    data.phone ? `โทร ${data.phone}` : '',
    'ใบแจ้งชำระ PromptPay',
    'สถานะ: ยังไม่ชำระ',
    '--------------------------------',
    `ลูกค้า: ${data.customerName || 'ลูกค้าทั่วไป'}`,
    data.reference ? `อ้างอิง: ${data.reference}` : '',
    `เวลา: ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`,
    '--------------------------------',
    ...data.lines.flatMap((line) => [
      `${line.name}`,
      `  ${Math.max(1, Number(line.quantity || 1))} รายการ  ${money(line.amount, data)}`,
    ]),
    '--------------------------------',
    `ยอดก่อนลด: ${money(data.subtotal, data)}`,
    data.discount > 0 ? `ส่วนลด: -${money(data.discount, data)}` : '',
    `ยอดที่ต้องชำระ: ${money(data.total, data)}`,
    data.receiverName ? `ผู้รับ: ${data.receiverName}` : '',
    'สแกน QR ด้านล่างเพื่อชำระเงิน',
    'ใบนี้ไม่ใช่ใบเสร็จรับเงิน',
  ];
  return rows.filter(Boolean).join('\n');
};

export const printPaymentQrSlip = async (data: PaymentQrSlipData) => {
  const text = paymentQrSlipText(data);
  if (/Android/i.test(navigator.userAgent)) {
    await printIminRichReceipt({ text, logoData: data.logoData, qrPayload: data.qrPayload }, data.paperWidth);
    if (!data.qrPayload) await printIminBitmap(data.qrDataUrl, data.paperWidth);
    return;
  }

  const popup = window.open('', '_blank', 'width=460,height=760');
  if (!popup) throw new Error('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up');
  const lineRows = data.lines.map((line) => `<tr><td>${safe(line.name)}<small>${Math.max(1, Number(line.quantity || 1))} รายการ</small></td><td>${safe(money(line.amount, data))}</td></tr>`).join('');
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>ใบแจ้งชำระ PromptPay</title><style>@page{margin:6mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;max-width:360px;margin:auto}header{text-align:center}.logo{max-width:72px;max-height:72px;object-fit:contain}h1{font-size:18px;margin:6px 0}.pending{font-weight:800}hr{border:0;border-top:1px dashed #999;margin:12px 0}.meta{font-size:12px;line-height:1.6}table{width:100%;border-collapse:collapse;font-size:13px}td{padding:6px 0;border-bottom:1px dashed #ddd;vertical-align:top}td:last-child{text-align:right;font-weight:700}small{display:block;color:#555;margin-top:2px}.totals{font-size:13px;line-height:1.8}.total{font-size:19px;font-weight:900;display:flex;justify-content:space-between}.qr{display:block;width:250px;height:250px;margin:12px auto}.note{text-align:center;font-size:11px;color:#555}</style></head><body><header>${data.logoData ? `<img class="logo" src="${safe(data.logoData)}">` : ''}<h1>${safe(data.storeName || 'POS')}</h1>${data.phone ? `<div>${safe(data.phone)}</div>` : ''}<div class="pending">ใบแจ้งชำระ PromptPay · ยังไม่ชำระ</div></header><hr><div class="meta">ลูกค้า: ${safe(data.customerName || 'ลูกค้าทั่วไป')}<br>${data.reference ? `อ้างอิง: ${safe(data.reference)}<br>` : ''}เวลา: ${safe(new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }))}</div><hr><table>${lineRows}</table><div class="totals">ยอดก่อนลด: ${safe(money(data.subtotal, data))}<br>${data.discount > 0 ? `ส่วนลด: -${safe(money(data.discount, data))}<br>` : ''}</div><div class="total"><span>ยอดที่ต้องชำระ</span><span>${safe(money(data.total, data))}</span></div>${data.receiverName ? `<div class="note">ผู้รับ: ${safe(data.receiverName)}</div>` : ''}<img class="qr" src="${safe(data.qrDataUrl)}"><div class="note">สแกน QR เพื่อชำระเงิน<br>ใบนี้ไม่ใช่ใบเสร็จรับเงิน</div><script>onload=()=>{print();onafterprint=()=>close()}<\/script></body></html>`);
  popup.document.close();
};
