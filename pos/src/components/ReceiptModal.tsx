import React, { useState } from 'react';
import { usePos } from '../context/PosContext';
import { formatCurrency, formatThaiDateTime } from '../utils/formatters';
import { Printer, X, Check, Copy, Share2 } from 'lucide-react';

export const ReceiptModal: React.FC = () => {
  const { selectedOrderForReceipt, setSelectedOrderForReceipt, settings, showToast } = usePos();
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>('80mm');
  const [copied, setCopied] = useState(false);

  if (!selectedOrderForReceipt) return null;

  const order = selectedOrderForReceipt;

  const handlePrint = () => {
    window.print();
  };

  const handleCopyText = () => {
    const textLines = [
      `================================`,
      `${settings.storeName}`,
      `${settings.branchName}`,
      order.vatRate > 0 ? `เลขประจำตัวผู้เสียภาษี: ${settings.taxId}` : '',
      `โทร: ${settings.phone}`,
      `--------------------------------`,
      order.vatRate > 0 ? `ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ` : `ใบเสร็จรับเงิน`,
      `เลขที่: ${order.orderNumber}`,
      `วันที่: ${formatThaiDateTime(order.createdAt)}`,
      `พนักงานขาย: ${order.cashierName}`,
      `--------------------------------`,
      ...order.items.map(
        (it) =>
          `${it.name}\n  ${it.quantity} x ${formatCurrency(it.price, settings.currencySymbol, settings.decimalPlaces)} = ${formatCurrency(it.total, settings.currencySymbol, settings.decimalPlaces)}`
      ),
      `--------------------------------`,
      `รวมเงิน (Subtotal): ${formatCurrency(order.subtotal, settings.currencySymbol, settings.decimalPlaces)}`,
      order.discount > 0
        ? `ส่วนลด (Discount): -${formatCurrency(order.discount, settings.currencySymbol, settings.decimalPlaces)}`
        : '',
      order.vatRate > 0 ? `ภาษีมูลค่าเพิ่ม (VAT ${order.vatRate}%): ${formatCurrency(order.vatAmount, settings.currencySymbol, settings.decimalPlaces)} (${order.isVatIncluded ? 'รวมในราคาสินค้า' : 'แยกนอก'})` : '',
      `ยอดสุทธิ (Total): ${formatCurrency(order.total, settings.currencySymbol, settings.decimalPlaces)}`,
      `วิธีชำระ: ${order.paymentMethod === 'cash' ? 'เงินสด' : order.paymentMethod === 'promptpay' ? 'PromptPay QR' : order.paymentMethod === 'card' ? 'บัตรเครดิต' : 'โอนเงิน'}`,
      order.cashReceived
        ? `รับเงิน: ${formatCurrency(order.cashReceived, settings.currencySymbol, settings.decimalPlaces)}`
        : '',
      order.change !== undefined
        ? `เงินทอน: ${formatCurrency(order.change, settings.currencySymbol, settings.decimalPlaces)}`
        : '',
      `================================`,
      `${settings.receiptFooterMessage}`,
    ]
      .filter(Boolean)
      .join('\n');

    navigator.clipboard.writeText(textLines);
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
              onClick={() => setSelectedOrderForReceipt(null)}
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
              <div className="font-sans font-extrabold text-base text-slate-900 tracking-tight">
                {settings.storeName}
              </div>
              <div className="text-[11px] text-slate-600">{settings.branchName}</div>
              <div className="text-[10px] text-slate-500">{settings.address}</div>
              <div className="text-[10px] text-slate-600 font-sans">
                {order.vatRate > 0 && <>Tax ID: <span className="font-mono">{settings.taxId}</span> | </>}Tel:{' '}
                <span className="font-mono">{settings.phone}</span>
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
                  <span>ส่วนลด ({order.discountType === 'percent' ? `${order.discount}%` : 'คูปอง'}):</span>
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
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700/60 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              id="copy-receipt-btn"
              onClick={handleCopyText}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 text-xs font-bold transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'คัดลอกแล้ว' : 'คัดลอกข้อความ'}</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="print-receipt-btn"
              onClick={handlePrint}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-black transition-all shadow-md shadow-red-600/20"
            >
              <Printer className="w-4 h-4" />
              <span>พิมพ์ใบเสร็จ (Print)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
