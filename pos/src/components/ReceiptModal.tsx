import React, { useEffect, useState } from 'react';
import { usePos } from '../context/PosContext';
import { formatCurrency, formatThaiDateTime } from '../utils/formatters';
import { Printer, X, Check, Copy, ChevronLeft, ChevronRight, Files, QrCode, LoaderCircle } from 'lucide-react';
import QRCode from 'qrcode';
import { toPng } from 'html-to-image';
import { getPOSPaymentQR } from '../api/posSales';
import { printIminBitmap } from '../utils/iminPrinter';

const receiptText = (order: any, settings: any) => [
  settings.storeName,
  order.vatRate > 0 && settings.taxId ? `เลขประจำตัวผู้เสียภาษี: ${settings.taxId}` : '',
  settings.phone ? `โทร: ${settings.phone}` : '',
  '--------------------------------',
  order.vatRate > 0 ? 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ' : 'ใบเสร็จรับเงิน',
  `เลขที่: ${order.orderNumber}`,
  `วันที่: ${formatThaiDateTime(order.createdAt)}`,
  `พนักงานขาย: ${order.cashierName || '-'}`,
  order.customerNote ? `ลูกค้า: ${order.customerNote}` : '',
  order.referenceNumber ? `เลขอ้างอิง: ${order.referenceNumber}` : '',
  '--------------------------------',
  ...(order.items || []).flatMap((item: any) => [
    `${item.name} x ${item.quantity}`,
    `  ${formatCurrency(item.price, settings.currencySymbol, settings.decimalPlaces)} = ${formatCurrency(item.total, settings.currencySymbol, settings.decimalPlaces)}`,
  ]),
  '--------------------------------',
  `รวม: ${formatCurrency(order.subtotal, settings.currencySymbol, settings.decimalPlaces)}`,
  order.discount > 0 ? `ส่วนลด: -${formatCurrency(order.discount, settings.currencySymbol, settings.decimalPlaces)}` : '',
  order.vatRate > 0 ? `VAT ${order.vatRate}%: ${formatCurrency(order.vatAmount, settings.currencySymbol, settings.decimalPlaces)}` : '',
  `ยอดสุทธิ: ${formatCurrency(order.total, settings.currencySymbol, settings.decimalPlaces)}`,
  `วิธีชำระ: ${order.paymentMethod === 'cash' ? 'เงินสด' : order.paymentMethod === 'promptpay' ? 'PromptPay QR' : order.paymentMethod === 'card' ? 'บัตรเครดิต' : 'โอนเงิน'}`,
  order.cashReceived ? `รับเงิน: ${formatCurrency(order.cashReceived, settings.currencySymbol, settings.decimalPlaces)}` : '',
  order.change !== undefined ? `เงินทอน: ${formatCurrency(order.change, settings.currencySymbol, settings.decimalPlaces)}` : '',
  '--------------------------------',
  settings.receiptFooterMessage || '',
  '\n\n',
].filter(Boolean).join('\n');

const waitForReceiptLayout = () => new Promise<void>((resolve) => {
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
});

const assertReceiptBitmapHasContent = (dataUrl: string) => new Promise<void>((resolve, reject) => {
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      reject(new Error('ตรวจสอบภาพใบเสร็จก่อนพิมพ์ไม่สำเร็จ'));
      return;
    }
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let inkSamples = 0;
    const sampleStep = 24;
    for (let index = 0; index < pixels.length; index += 4 * sampleStep) {
      if (pixels[index + 3] > 20 && (pixels[index] < 240 || pixels[index + 1] < 240 || pixels[index + 2] < 240)) {
        inkSamples += 1;
        if (inkSamples >= 24) {
          resolve();
          return;
        }
      }
    }
    reject(new Error('ภาพใบเสร็จว่างเปล่า ระบบยกเลิกการพิมพ์ กรุณาลองใหม่'));
  };
  image.onerror = () => reject(new Error('เปิดภาพใบเสร็จก่อนพิมพ์ไม่สำเร็จ'));
  image.src = dataUrl;
});

const renderReceiptBitmap = async (paperWidth: '58mm' | '80mm') => {
  const receipt = document.getElementById('printable-receipt');
  if (!(receipt instanceof HTMLElement)) throw new Error('ไม่พบใบเสร็จสำหรับพิมพ์');
  await document.fonts?.ready;
  await Promise.all(Array.from(receipt.querySelectorAll('img')).map(async (image) => {
    if (image.complete) return;
    try { await image.decode(); } catch { /* The renderer will report an unusable image below. */ }
  }));
  const widthDots = paperWidth === '58mm' ? 384 : 576;
  const renderedWidth = Math.max(1, receipt.getBoundingClientRect().width);
  const image = await toPng(receipt, {
    backgroundColor: '#ffffff',
    cacheBust: true,
    pixelRatio: widthDots / renderedWidth,
  });
  if (!image.startsWith('data:image/png;base64,') || image.length < 2000) {
    throw new Error('สร้างภาพใบเสร็จสำหรับเครื่องพิมพ์ไม่สำเร็จ');
  }
  await assertReceiptBitmapHasContent(image);
  return image;
};

export const ReceiptModal: React.FC = () => {
  const { selectedOrderForReceipt, setSelectedOrderForReceipt, receiptBatch, setReceiptBatch, settings, showToast } = usePos();
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>(() => settings.printerType === 'thermal_58mm' ? '58mm' : '80mm');
  const [copied, setCopied] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [receiptQrDataUrl, setReceiptQrDataUrl] = useState('');
  const [receiptQrAmountSatang, setReceiptQrAmountSatang] = useState(0);
  const [receiptQrError, setReceiptQrError] = useState('');
  const [printWithQr, setPrintWithQr] = useState(false);

  useEffect(() => {
    setReceiptQrDataUrl('');
    setReceiptQrAmountSatang(0);
    setReceiptQrError('');
    setPrintWithQr(false);
  }, [selectedOrderForReceipt?.id]);

  if (!selectedOrderForReceipt) return null;

  const order = selectedOrderForReceipt;
  const activeBatch = receiptBatch.length > 1 && receiptBatch.some((item) => item.id === order.id) ? receiptBatch : [];
  const receiptIndex = activeBatch.findIndex((item) => item.id === order.id);

  const closeReceipt = () => {
    setSelectedOrderForReceipt(null);
    setReceiptBatch([]);
  };

  const generateLockedReceiptQr = async () => {
    const amountSatang = Math.round(order.total * 100);
    if (amountSatang <= 0) throw new Error('ยอดใบเสร็จต้องมากกว่า 0 บาทจึงจะสร้าง QR ได้');
    if (receiptQrDataUrl && receiptQrAmountSatang === amountSatang) return receiptQrDataUrl;

    setIsGeneratingQr(true);
    setReceiptQrError('');
    try {
      const result = await getPOSPaymentQR(amountSatang);
      if (Number(result.amountSatang) !== amountSatang) throw new Error('ยอด QR ไม่ตรงกับยอดในใบเสร็จ ระบบยกเลิกการพิมพ์เพื่อความปลอดภัย');
      if (!result.promptPayPayload) throw new Error('ต้องตั้งค่า PromptPay สำหรับสร้าง QR แบบล็อกยอดก่อน');
      const image = await QRCode.toDataURL(result.promptPayPayload, { width: 360, margin: 1, errorCorrectionLevel: 'M' });
      setReceiptQrDataUrl(image);
      setReceiptQrAmountSatang(amountSatang);
      return image;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'สร้าง QR สำหรับใบเสร็จไม่สำเร็จ';
      setReceiptQrError(message);
      throw new Error(message);
    } finally {
      setIsGeneratingQr(false);
    }
  };

  const handlePrintAll = async () => {
    if (activeBatch.length < 2) {
      void handlePrint();
      return;
    }
    const isAndroid = /Android/i.test(navigator.userAgent);
    const printWindow = isAndroid ? null : window.open('', '_blank', 'width=720,height=900');
    if (!isAndroid && !printWindow) {
      showToast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ทั้งหมด กรุณาอนุญาต Pop-up', 'warning');
      return;
    }
    const original = order;
    setIsPrinting(true);
    setPrintWithQr(false);
    try {
      const images: string[] = [];
      for (const receipt of activeBatch) {
        setSelectedOrderForReceipt(receipt);
        await waitForReceiptLayout();
        images.push(await renderReceiptBitmap(paperWidth));
      }
      setSelectedOrderForReceipt(original);
      if (isAndroid) {
        for (const image of images) await printIminBitmap(image, paperWidth);
        showToast(`พิมพ์ใบเสร็จ ${images.length} ใบผ่าน iMin InnerPrinter แล้ว`, 'success');
      } else if (printWindow) {
        printWindow.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ใบเสร็จทั้งหมด</title><style>@page{size:${paperWidth} auto;margin:0}html,body{margin:0;background:#fff}.receipt{display:block;width:100%;height:auto;page-break-after:always}.receipt:last-child{page-break-after:auto}</style></head><body>${images.map((image) => `<img class="receipt" src="${image}" alt="ใบเสร็จ">`).join('')}<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}<\/script></body></html>`);
        printWindow.document.close();
      }
    } catch (error) {
      printWindow?.close();
      setSelectedOrderForReceipt(original);
      showToast(error instanceof Error ? error.message : 'พิมพ์ใบเสร็จทั้งหมดไม่สำเร็จ', 'error');
    } finally {
      setIsPrinting(false);
    }
  };

  const handlePrint = async (withQr = false) => {
    if (isPrinting) return;
    setIsPrinting(true);
    try {
      if (withQr) await generateLockedReceiptQr();
      setPrintWithQr(withQr);
      await waitForReceiptLayout();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'สร้าง QR สำหรับใบเสร็จไม่สำเร็จ', 'error');
      setIsPrinting(false);
      return;
    }
    if (/Android/i.test(navigator.userAgent)) {
      try {
        await printIminBitmap(await renderReceiptBitmap(paperWidth), paperWidth);
        showToast(withQr ? 'พิมพ์ใบเสร็จพร้อม QR ล็อกยอดผ่าน iMin แล้ว' : 'พิมพ์ใบเสร็จผ่าน iMin InnerPrinter แล้ว', 'success');
        setIsPrinting(false);
        return;
      } catch (error) {
        showToast(`${error instanceof Error ? error.message : 'เชื่อมต่อ InnerPrinter ไม่สำเร็จ'} · เปิด Android Print Dialog แทน`, 'warning');
      }
    }
    window.print();
    setIsPrinting(false);
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(receiptText(order, settings));
    setCopied(true);
    showToast('คัดลอกข้อความใบเสร็จแล้ว', 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      id="receipt-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
    >
      <div
        id="receipt-modal-container"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
      >
        {/* Header toolbar */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Printer className="w-5 h-5 text-red-600 dark:text-yellow-400" />
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {order.vatRate > 0 ? 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ' : 'ใบเสร็จรับเงิน'}
            </h3>
            {activeBatch.length > 1 && <span className="rounded-full bg-yellow-100 px-2 py-1 text-[10px] font-black text-yellow-800">{receiptIndex + 1}/{activeBatch.length}</span>}
          </div>

          <div className="flex items-center gap-2">
            {/* Paper Size selector */}
            <div className="flex bg-slate-200 dark:bg-slate-950 p-1 rounded-xl border border-slate-300 dark:border-slate-800 text-xs">
              <button
                onClick={() => setPaperWidth('80mm')}
                className={`px-2.5 py-1 rounded-lg transition-colors ${
                  paperWidth === '80mm'
                    ? 'bg-red-600 dark:bg-yellow-400 text-white dark:text-slate-950 font-bold shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                80 mm
              </button>
              <button
                onClick={() => setPaperWidth('58mm')}
                className={`px-2.5 py-1 rounded-lg transition-colors ${
                  paperWidth === '58mm'
                    ? 'bg-red-600 dark:bg-yellow-400 text-white dark:text-slate-950 font-bold shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                58 mm
              </button>
            </div>

            <button
              id="close-receipt-modal-btn"
              onClick={closeReceipt}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Receipt Body Preview */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 min-h-0 bg-slate-100 dark:bg-slate-950/70 flex justify-center items-start custom-scrollbar">
          <div
            id="printable-receipt"
            className={`bg-white text-slate-900 p-5 sm:p-6 rounded-2xl shadow-xl font-mono text-xs transition-all shrink-0 my-auto mb-6 sm:mb-8 border border-slate-200/80 ${
              paperWidth === '80mm' ? 'w-full max-w-[340px] print-80mm' : 'w-full max-w-[270px] print-58mm'
            }`}
          >
            {/* Store Header */}
            <div className="text-center space-y-1 pb-3 border-b border-dashed border-slate-300">
              {settings.logoData ? <img src={settings.logoData} alt="โลโก้ร้าน" className="mx-auto mb-2 h-14 w-14 object-contain" /> : null}
              <div className="font-sans font-extrabold text-base text-slate-900 tracking-tight">
                {settings.storeName}
              </div>
              <div className="text-[10px] text-slate-500">{settings.address}</div>
              {settings.email ? <div className="text-[10px] text-slate-500">{settings.email}</div> : null}
              <div className="text-[10px] text-slate-600 font-sans">
                {order.vatRate > 0 && <>Tax ID: <span className="font-mono">{settings.taxId}</span> | </>}Tel:{' '}
                <span className="font-mono">{settings.phone}</span>
              </div>
              <div className="pt-1 text-[11px] font-bold">
                {order.vatRate > 0 ? 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ' : 'ใบเสร็จรับเงิน'}
              </div>
            </div>

            {/* Receipt Meta */}
            <div className="py-2.5 border-b border-dashed border-slate-300 text-[11px] space-y-0.5">
              <div className="flex justify-between">
                <span className="text-slate-500">เลขที่บิล:</span>
                <span className="font-bold text-slate-800">{order.orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">วันที่-เวลา:</span>
                <span>{formatThaiDateTime(order.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">แคชเชียร์:</span>
                <span>{order.cashierName}</span>
              </div>
			  {order.originSystem && (
				<div className="flex justify-between"><span className="text-slate-500">รับชำระที่:</span><span className="font-bold">{order.originSystem === 'match' ? 'Match' : 'POS'}</span></div>
			  )}
              {order.referenceNumber && (
                <div className="flex justify-between">
                  <span className="text-slate-500">เลขอ้างอิง:</span>
                  <span className="font-mono text-[10px]">{order.referenceNumber}</span>
                </div>
              )}
              {order.customerNote && <div className="flex justify-between"><span className="text-slate-500">ลูกค้า:</span><span>{order.customerNote}</span></div>}
            </div>

            {/* Items table */}
            <div className="py-2.5 border-b border-dashed border-slate-300">
              <div className="flex justify-between text-[11px] font-bold text-slate-700 pb-1.5 border-b border-slate-200">
                <span>รายการ</span>
                <span>จำนวน / รวม</span>
              </div>
              <div className="space-y-2 mt-2">
                {order.items.map((item, idx) => (
                  <div key={idx} className="text-[11px]">
                    <div className="font-sans font-medium text-slate-900 leading-tight">
                      {item.name}
                    </div>
                    {item.note && (
                      <div className="text-[10px] text-amber-700 italic">
                        * {item.note}
                      </div>
                    )}
                    <div className="flex justify-between text-slate-600 text-[10px] mt-0.5">
                      <span>
                        {item.quantity} x {formatCurrency(item.price, '', settings.decimalPlaces)}
                      </span>
                      <span className="font-bold text-slate-800">
                        {formatCurrency(item.total, '', settings.decimalPlaces)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Calculations & Totals */}
            <div className="py-2.5 border-b border-dashed border-slate-300 space-y-1 text-[11px]">
			  {(order.matchTotal !== undefined || order.posTotal !== undefined) && <>
				<div className="flex justify-between text-slate-600"><span>ยอด Match:</span><span>{formatCurrency(order.matchTotal || 0, settings.currencySymbol, settings.decimalPlaces)}</span></div>
				<div className="flex justify-between text-slate-600"><span>ยอด POS:</span><span>{formatCurrency(order.posTotal || 0, settings.currencySymbol, settings.decimalPlaces)}</span></div>
			  </>}
              <div className="flex justify-between text-slate-600">
                <span>ยอดรวมสินค้า:</span>
                <span>{formatCurrency(order.subtotal, settings.currencySymbol, settings.decimalPlaces)}</span>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between text-rose-600">
                  <span>ส่วนลด ({order.discountType === 'percent' ? `${order.discountRate ?? 0}%` : 'จำนวนเงิน'}):</span>
                  <span>-{formatCurrency(order.discount, settings.currencySymbol, settings.decimalPlaces)}</span>
                </div>
              )}
              {order.vatRate > 0 && <div className="flex justify-between text-slate-500 text-[10px]">
                <span>
                  VAT ({order.vatRate}% {order.isVatIncluded ? 'รวมในยอด' : 'แยกนอก'}):
                </span>
                <span>{formatCurrency(order.vatAmount, settings.currencySymbol, settings.decimalPlaces)}</span>
              </div>}

              <div className="flex justify-between text-sm font-bold text-slate-950 pt-1.5 border-t border-slate-200">
                <span>ยอดสุทธิ (Total):</span>
                <span>{formatCurrency(order.total, settings.currencySymbol, settings.decimalPlaces)}</span>
              </div>
            </div>

            {/* Payment detail */}
            <div className="py-2 border-b border-dashed border-slate-300 text-[11px] space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">วิธีชำระเงิน:</span>
                <span className="font-semibold text-slate-800">
                  {order.paymentMethod === 'cash'
                    ? 'เงินสด (Cash)'
                    : order.paymentMethod === 'promptpay'
                    ? 'Thai QR PromptPay'
                    : order.paymentMethod === 'card'
                    ? 'บัตรเครดิต/เดบิต'
                    : 'โอนเงิน'}
                </span>
              </div>
              {order.cashReceived && (
                <div className="flex justify-between text-slate-600">
                  <span>รับเงินมา:</span>
                  <span>{formatCurrency(order.cashReceived, settings.currencySymbol, settings.decimalPlaces)}</span>
                </div>
              )}
              {order.change !== undefined && order.change > 0 && (
                <div className="flex justify-between font-bold text-emerald-700">
                  <span>เงินทอน:</span>
                  <span>{formatCurrency(order.change, settings.currencySymbol, settings.decimalPlaces)}</span>
                </div>
              )}
            </div>

            {printWithQr && receiptQrDataUrl && (
              <div className="border-b border-dashed border-slate-300 py-3 text-center">
                <p className="font-sans text-[11px] font-bold text-slate-900">สแกนชำระยอดตามใบเสร็จนี้</p>
                <img src={receiptQrDataUrl} alt="QR PromptPay ล็อกยอดตามใบเสร็จ" className="mx-auto mt-2 h-36 w-36 object-contain" />
                <p className="mt-1 font-sans text-[10px] font-semibold text-slate-600">ยอดล็อก {formatCurrency(receiptQrAmountSatang / 100, settings.currencySymbol, settings.decimalPlaces)}</p>
                <p className="font-sans text-[9px] text-slate-500">อ้างอิงจากยอดสุทธิของใบเสร็จ {order.orderNumber}</p>
              </div>
            )}

            {/* Footer barcode & text */}
            <div className="pt-3 text-center space-y-2">
              {/* Barcode simulation */}
              <div className="flex flex-col items-center justify-center">
                <div className="h-9 w-40 flex items-center justify-between px-1">
                  {Array.from({ length: 34 }).map((_, i) => (
                    <div
                      key={i}
                      className={`h-full bg-black ${
                        i % 4 === 0 ? 'w-1' : i % 3 === 0 ? 'w-0.5' : 'w-[1.5px]'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-[9px] tracking-widest text-slate-500 font-mono mt-0.5">
                  *{order.orderNumber}*
                </span>
              </div>

              <p className="text-[10px] text-slate-500 font-sans italic px-2">
                {settings.receiptFooterMessage}
              </p>
            </div>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700/60 dark:bg-slate-800/80 sm:px-6">
          {activeBatch.length > 1 && (
            <div className="mb-2 flex items-center justify-end gap-2">
              <button type="button" aria-label="ใบเสร็จก่อนหน้า" disabled={receiptIndex <= 0} onClick={() => setSelectedOrderForReceipt(activeBatch[receiptIndex - 1])} className="rounded-xl border border-slate-300 p-2 disabled:opacity-30 dark:border-slate-600"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" aria-label="ใบเสร็จถัดไป" disabled={receiptIndex >= activeBatch.length - 1} onClick={() => setSelectedOrderForReceipt(activeBatch[receiptIndex + 1])} className="rounded-xl border border-slate-300 p-2 disabled:opacity-30 dark:border-slate-600"><ChevronRight className="h-4 w-4" /></button>
              <button type="button" onClick={handlePrintAll} className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-xs font-black dark:border-slate-600"><Files className="h-4 w-4" />พิมพ์ทั้งหมด</button>
            </div>
          )}

          <div className="flex items-center gap-2 whitespace-nowrap">
            <button
              id="copy-receipt-btn"
              onClick={handleCopyText}
              aria-label={copied ? 'คัดลอกข้อความแล้ว' : 'คัดลอกข้อความใบเสร็จ'}
              title={copied ? 'คัดลอกแล้ว' : 'คัดลอกข้อความ'}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-800 transition-colors hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            </button>
            <div className="min-w-0 flex-1" />
            <button
              id="print-receipt-qr-btn"
              onClick={() => void handlePrint(true)}
              disabled={isPrinting || isGeneratingQr}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-sky-600 px-3 text-xs font-black text-white shadow-md shadow-sky-600/20 transition-all hover:bg-sky-500 disabled:cursor-wait disabled:opacity-60 sm:px-4"
            >
              {isGeneratingQr ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
              <span>{isGeneratingQr ? 'กำลังสร้าง…' : <><span className="sm:hidden">พิมพ์ QR</span><span className="hidden sm:inline">พิมพ์ใบเสร็จ (QR)</span></>}</span>
            </button>
            <button
              id="print-receipt-btn"
              onClick={() => void handlePrint()}
              disabled={isPrinting}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-red-600 px-3 text-xs font-black text-white shadow-md shadow-red-600/20 transition-all hover:bg-red-500 disabled:cursor-wait disabled:opacity-60 sm:px-4"
            >
              <Printer className="w-4 h-4" />
              <span>{isPrinting ? 'กำลังพิมพ์…' : <><span className="sm:hidden">พิมพ์</span><span className="hidden sm:inline">พิมพ์ใบเสร็จ</span></>}</span>
            </button>
            <button
              id="close-receipt-action-btn"
              type="button"
              onClick={closeReceipt}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <X className="h-4 w-4" />
              <span>ปิด</span>
            </button>
          </div>
        </div>
        {receiptQrError && <p className="bg-rose-50 px-6 py-2 text-xs font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{receiptQrError}</p>}
      </div>
    </div>
  );
};
