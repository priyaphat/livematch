import React, { useState, useEffect } from 'react';
import { usePos } from '../context/PosContext';
import { formatCurrency } from '../utils/formatters';
import QRCode from 'qrcode';
import { getPOSPaymentQR } from '../api/posSales';
import {
  X,
  Banknote,
  QrCode,
  Delete,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from 'lucide-react';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({ isOpen, onClose }) => {
  const { cartTotals, settings, processPayment, broadcastCustomerDisplay } = usePos();
  const [method, setMethod] = useState<'cash' | 'promptpay'>('cash');
  const [cashInput, setCashInput] = useState<string>('');
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [customerNote, setCustomerNote] = useState<string>('');
  const [qrGeneratedTime, setQrGeneratedTime] = useState<number>(120);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isQrLoading, setIsQrLoading] = useState<boolean>(false);
  const [qrError, setQrError] = useState<string>('');
  const [qrReceiverName, setQrReceiverName] = useState<string>('');
  const [isCompleting, setIsCompleting] = useState(false);

  const totalDue = cartTotals.total;
  const cashGiven = parseFloat(cashInput) || 0;
  const change = Math.max(0, cashGiven - totalDue);
  const isCashSufficient = cashGiven >= totalDue;

  // Initialize cash input with exact total on open
  useEffect(() => {
    if (isOpen) {
      setCashInput('');
      setReferenceNumber('');
      setCustomerNote('');
      setMethod('cash');
      setQrGeneratedTime(120);

      const modalPayload = {
        isOpen: true,
        method: 'cash',
        totalDue,
        cashReceived: 0,
        change: 0,
      };

      try {
        localStorage.setItem('siampure_active_payment_modal', JSON.stringify(modalPayload));
      } catch (e) {
        // ignore
      }

      // Broadcast to customer display
      broadcastCustomerDisplay({
        type: 'PAYMENT_MODAL_STATE',
        payload: modalPayload,
      });
    } else {
      const closedPayload = {
        isOpen: false,
        method: 'cash',
        totalDue: 0,
      };

      try {
        localStorage.setItem('siampure_active_payment_modal', JSON.stringify(closedPayload));
      } catch (e) {
        // ignore
      }

      broadcastCustomerDisplay({
        type: 'PAYMENT_MODAL_STATE',
        payload: closedPayload,
      });
    }
  }, [isOpen, totalDue]);

  // Sync method change and cash input to customer display
  useEffect(() => {
    if (!isOpen) return;
    const modalPayload = {
      isOpen: true,
      method,
      totalDue,
      cashReceived: method === 'cash' ? cashGiven : undefined,
      change: method === 'cash' ? change : undefined,
    };

    try {
      localStorage.setItem('siampure_active_payment_modal', JSON.stringify(modalPayload));
    } catch (e) {
      // ignore
    }

    broadcastCustomerDisplay({
      type: 'PAYMENT_MODAL_STATE',
      payload: modalPayload,
    });
  }, [isOpen, method, cashGiven, change, totalDue]);

  // Generate dynamic EMVCo PromptPay QR Code
  useEffect(() => {
    if (method !== 'promptpay') return;
    let isCancelled = false;

    const generateQr = async () => {
      try {
        setIsQrLoading(true);
        setQrError('');
        const result = await getPOSPaymentQR(Math.round(totalDue * 100));
        setQrReceiverName(result.receiverName || settings.promptPayReceiver || settings.storeName);
        if (!result.promptPayPayload && result.fallbackImage) {
          setQrDataUrl(result.fallbackImage);
          setIsQrLoading(false);
          return;
        }
        const url = await QRCode.toDataURL(result.promptPayPayload, {
          width: 320,
          margin: 1.5,
          color: {
            dark: '#002B49',
            light: '#FFFFFF',
          },
          errorCorrectionLevel: 'M',
        });

        if (!isCancelled) {
          setQrDataUrl(url);
          setIsQrLoading(false);
        }
      } catch (err) {
        console.error('Error generating QR code:', err);
        setQrDataUrl('');
        setQrError(err instanceof Error ? err.message : 'ไม่สามารถสร้าง QR ได้');
        setIsQrLoading(false);
      }
    };

    generateQr();

    return () => {
      isCancelled = true;
    };
  }, [method, totalDue]);

  // PromptPay Countdown timer
  useEffect(() => {
    if (method !== 'promptpay') return;
    const timer = setInterval(() => {
      setQrGeneratedTime((prev) => (prev > 0 ? prev - 1 : 120));
    }, 1000);
    return () => clearInterval(timer);
  }, [method]);

  if (!isOpen) return null;

  // Quick cash buttons
  const handleSetCash = (val: number) => {
    setCashInput(val.toString());
  };

  const handleAddCash = (increment: number) => {
    const current = parseFloat(cashInput) || 0;
    setCashInput((current + increment).toString());
  };

  const handleNumpadPress = (char: string) => {
    if (char === 'C') {
      setCashInput('');
    } else if (char === 'DEL') {
      setCashInput((prev) => prev.slice(0, -1));
    } else if (char === '.') {
      if (!cashInput.includes('.')) {
        setCashInput((prev) => (prev ? prev + '.' : '0.'));
      }
    } else {
      setCashInput((prev) => prev + char);
    }
  };

  const handleComplete = async () => {
    if (method === 'cash' && !isCashSufficient) {
      return;
    }

    setIsCompleting(true);
    const completedOrder = await processPayment({
      paymentMethod: method,
      cashReceived: method === 'cash' ? cashGiven : undefined,
      referenceNumber: referenceNumber || undefined,
      customerNote: customerNote || undefined,
    });

    setIsCompleting(false);
    if (!completedOrder) return;
    onClose();
  };

  return (
    <div
      id="payment-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
    >
      <div
        id="payment-modal-container"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-2xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-red-600 uppercase tracking-wider bg-red-100 dark:bg-red-500/10 px-2.5 py-0.5 rounded-full border border-red-200 dark:border-red-500/20">
              ขั้นตอนชำระเงิน • CHECKOUT
            </span>
            <h2 className="text-lg font-black text-slate-900 dark:text-white mt-1">เลือกช่องทางการชำระเงิน</h2>
          </div>
          <button
            id="close-payment-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Total Banner */}
        <div className="bg-slate-100/70 dark:bg-slate-950 px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">ยอดที่ต้องชำระสุทธิ (Total Due)</span>
            <div className="text-2xl sm:text-3xl font-black text-red-600 dark:text-yellow-400 tracking-tight font-mono">
              {formatCurrency(totalDue, settings.currencySymbol, settings.decimalPlaces)}
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-500 dark:text-slate-400">จำนวนสินค้าในตะกร้า</span>
            <div className="text-sm font-bold text-slate-800 dark:text-white bg-white dark:bg-slate-800 px-3 py-1 rounded-xl border border-slate-200 dark:border-slate-700 mt-0.5 shadow-xs">
              {cartTotals.itemCount} รายการ
            </div>
          </div>
        </div>

        {/* Payment Methods Nav (Only Cash and PromptPay QR) */}
        <div className="p-4 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800">
          <div className="grid grid-cols-2 gap-3">
            <button
              id="pay-method-cash-btn"
              onClick={() => setMethod('cash')}
              className={`flex items-center justify-center gap-3 p-3.5 rounded-2xl border transition-all ${
                method === 'cash'
                  ? 'bg-red-600 border-red-500 text-white shadow-lg shadow-red-600/30'
                  : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Banknote className={`w-6 h-6 ${method === 'cash' ? 'text-yellow-300' : 'text-slate-500 dark:text-slate-400'}`} />
              <div className="text-left">
                <span className="text-sm font-bold block">เงินสด (Cash)</span>
                <span className={`text-[11px] ${method === 'cash' ? 'text-red-100' : 'text-slate-500 dark:text-slate-400'}`}>
                  รับเงินสด & คำนวณเงินทอน
                </span>
              </div>
            </button>

            <button
              id="pay-method-promptpay-btn"
              onClick={() => setMethod('promptpay')}
              className={`flex items-center justify-center gap-3 p-3.5 rounded-2xl border transition-all ${
                method === 'promptpay'
                  ? 'bg-red-600 border-red-500 text-white shadow-lg shadow-red-600/30'
                  : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <QrCode className={`w-6 h-6 ${method === 'promptpay' ? 'text-yellow-300' : 'text-slate-500 dark:text-slate-400'}`} />
              <div className="text-left">
                <span className="text-sm font-bold block">PromptPay QR</span>
                <span className={`text-[11px] ${method === 'promptpay' ? 'text-red-100' : 'text-slate-500 dark:text-slate-400'}`}>
                  สแกนจ่ายผ่าน Mobile Banking
                </span>
              </div>
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1">
          {/* TAB 1: CASH */}
          {method === 'cash' && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              {/* Left: Input & Summary */}
              <div className="md:col-span-5 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    จำนวนเงินที่รับมา (Cash Received)
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      readOnly
                      value={cashInput}
                      placeholder="0.00"
                      className="w-full text-2xl font-black bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 text-red-600 dark:text-yellow-400 focus:outline-none font-mono"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
                      ฿
                    </span>
                  </div>
                </div>

                {/* Quick amount presets */}
                <div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 block font-bold">ปุ่มลัดรับเงิน:</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleSetCash(totalDue)}
                      className="px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 flex items-center justify-center gap-1 transition-colors"
                    >
                      <span>พอดี</span>
                      <span className="text-red-600 dark:text-yellow-400 font-mono">
                        ({formatCurrency(totalDue, '', 0)})
                      </span>
                    </button>
                    <button
                      onClick={() => handleSetCash(1000)}
                      className="px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
                    >
                      1,000 บาท
                    </button>
                    <button
                      onClick={() => handleSetCash(500)}
                      className="px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
                    >
                      500 บาท
                    </button>
                    <button
                      onClick={() => handleSetCash(100)}
                      className="px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
                    >
                      100 บาท
                    </button>
                    <button
                      onClick={() => handleAddCash(100)}
                      className="px-3 py-2.5 rounded-xl bg-yellow-100 dark:bg-slate-800 hover:bg-yellow-200 dark:hover:bg-slate-700 text-xs font-bold text-yellow-800 dark:text-yellow-400 border border-yellow-300 dark:border-slate-700 transition-colors"
                    >
                      +100 ฿
                    </button>
                    <button
                      onClick={() => handleAddCash(500)}
                      className="px-3 py-2.5 rounded-xl bg-yellow-100 dark:bg-slate-800 hover:bg-yellow-200 dark:hover:bg-slate-700 text-xs font-bold text-yellow-800 dark:text-yellow-400 border border-yellow-300 dark:border-slate-700 transition-colors"
                    >
                      +500 ฿
                    </button>
                  </div>
                </div>

                {/* Change Display Card */}
                <div
                  className={`p-4 rounded-2xl border transition-all ${
                    isCashSufficient
                      ? 'bg-slate-50 dark:bg-slate-950 border-slate-300 dark:border-yellow-500/40 shadow-xs'
                      : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-500/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {isCashSufficient ? 'เงินทอน (Change):' : 'ยังขาดอีก:'}
                    </span>
                    {isCashSufficient ? (
                      <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                        {formatCurrency(change, settings.currencySymbol, settings.decimalPlaces)}
                      </span>
                    ) : (
                      <span className="text-lg font-bold text-red-600 dark:text-red-400 font-mono">
                        {formatCurrency(
                          totalDue - cashGiven,
                          settings.currencySymbol,
                          settings.decimalPlaces
                        )}
                      </span>
                    )}
                  </div>
                  {!isCashSufficient && (
                    <p className="text-[11px] text-red-600 dark:text-red-400 mt-1.5 flex items-center gap-1 font-medium">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      กรุณากรอกยอดเงินให้เท่ากับหรือมากกว่ายอดที่ต้องชำระ
                    </p>
                  )}
                </div>

                {qrError && <p className="mt-2 text-xs font-bold text-red-600">{qrError}</p>}
              </div>

              {/* Right: Numeric Numpad */}
              <div className="md:col-span-7 bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
                <div className="grid grid-cols-3 gap-2.5">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '00'].map((key) => (
                    <button
                      key={key}
                      onClick={() => handleNumpadPress(key)}
                      className="h-13 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 text-xl font-bold text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 shadow-xs transition-all flex items-center justify-center"
                    >
                      {key}
                    </button>
                  ))}
                  <button
                    onClick={() => handleNumpadPress('C')}
                    className="h-12 rounded-xl bg-red-100 dark:bg-red-950/50 hover:bg-red-200 dark:hover:bg-red-900/60 active:scale-95 text-sm font-bold text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700/50 transition-all flex items-center justify-center col-span-1"
                  >
                    ล้างค่า (C)
                  </button>
                  <button
                    onClick={() => handleNumpadPress('DEL')}
                    className="h-12 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 active:scale-95 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 transition-all flex items-center justify-center col-span-2 hover:text-slate-900 dark:hover:text-white font-bold text-xs"
                  >
                    <Delete className="w-5 h-5 mr-1" />
                    <span>ลบ (Backspace)</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PROMPTPAY QR */}
          {method === 'promptpay' && (
            <div className="flex flex-col items-center text-center space-y-4 py-2">
              <div className="bg-white p-5 rounded-3xl shadow-xl w-68 flex flex-col items-center border-2 border-red-500 dark:border-yellow-500/50 text-slate-900">
                {/* PromptPay Header */}
                <div className="w-full bg-[#003B71] text-white py-1.5 px-3 rounded-lg text-center font-bold text-xs tracking-wider mb-3">
                  THAI QR PAYMENT • พร้อมเพย์
                </div>

                {/* Dynamic EMVCo QR Code */}
                <div className="p-2 border-2 border-slate-900 rounded-xl bg-white relative flex items-center justify-center min-h-[176px]">
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="PromptPay QR Code"
                      className="w-44 h-44 object-contain rounded-lg"
                    />
                  ) : (
                    <div className="w-44 h-44 flex flex-col items-center justify-center text-slate-400 gap-2">
                      <QrCode className="w-12 h-12 animate-pulse" />
                      <span className="text-[10px]">กำลังสร้าง QR พร้อมเพย์...</span>
                    </div>
                  )}
                </div>

                <div className="mt-3 text-center">
                  <div className="font-bold text-sm text-slate-900">{qrReceiverName || settings.storeName}</div>
                  <div className="text-xs text-slate-500 font-mono">
                    QR พร้อมยอดชำระ {formatCurrency(totalDue, settings.currencySymbol, settings.decimalPlaces)}
                  </div>
                  <div className="text-xl font-black text-red-600 mt-1 font-mono">
                    {formatCurrency(totalDue, settings.currencySymbol, settings.decimalPlaces)}
                  </div>
                </div>
              </div>

              <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                <p className="text-slate-800 dark:text-white font-bold">สแกนผ่าน Mobile Banking ได้ทุกธนาคาร</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  QR Code จะหมดอายุใน{' '}
                  <span className="font-mono text-red-600 dark:text-yellow-400 font-bold">
                    {Math.floor(qrGeneratedTime / 60)}:
                    {String(qrGeneratedTime % 60).padStart(2, '0')}
                  </span>
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm font-bold transition-colors"
          >
            ยกเลิก (Cancel)
          </button>

          <button
            id="confirm-checkout-btn"
            disabled={isCompleting || (method === 'cash' && !isCashSufficient) || (method === 'promptpay' && (!!qrError || isQrLoading))}
            onClick={handleComplete}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-black text-sm shadow-md transition-all ${
              isCompleting || (method === 'cash' && !isCashSufficient) || (method === 'promptpay' && (!!qrError || isQrLoading))
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-300 dark:border-slate-700'
                : 'bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-600 text-white shadow-red-600/30 scale-[1.01] active:scale-[0.99]'
            }`}
          >
            <CheckCircle2 className="w-5 h-5 text-yellow-300" />
            <span>
              ยืนยันการรับชำระเงิน{' '}
              {formatCurrency(totalDue, settings.currencySymbol, settings.decimalPlaces)}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
