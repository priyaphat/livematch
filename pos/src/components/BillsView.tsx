import React, { useState } from 'react';
import { useEffect } from 'react';
import QRCode from 'qrcode';
import { getPOSBillingSummary, getPOSPaymentQR, POSBillingSummary } from '../api/posSales';
import { usePos } from '../context/PosContext';
import { formatCurrency, formatThaiDateTime } from '../utils/formatters';
import {
  PauseCircle,
  Receipt,
  Search,
  RotateCcw,
  Trash2,
  Printer,
  ShoppingBag,
  Clock,
  User,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Filter,
  CheckSquare,
  Square,
  Zap,
  CreditCard,
  Banknote,
  QrCode,
  Layers,
  ArrowRight,
  X,
  Sparkles,
  Check,
} from 'lucide-react';

export const BillsView: React.FC = () => {
  const {
    heldOrders,
    resumeHeldOrder,
    deleteHeldOrder,
    batchDeleteHeldOrders,
    mergeHeldOrdersIntoCart,
    processBatchHeldPayment,
    orders,
    refundOrder,
    cancelOrder,
    setSelectedOrderForReceipt,
    settings,
  } = usePos();

  const [activeSegment, setActiveSegment] = useState<'held' | 'history'>('held');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [heldSearchQuery, setHeldSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'refunded'>('all');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'cash' | 'promptpay' | 'card'>('all');
  const [selectedOrderForRefund, setSelectedOrderForRefund] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState<string>('');

  // Multi-selection state for Held Orders
  const [selectedHeldIds, setSelectedHeldIds] = useState<string[]>([]);
  const [isBatchPayModalOpen, setIsBatchPayModalOpen] = useState<boolean>(false);
  const [batchPayMethod, setBatchPayMethod] = useState<'cash' | 'promptpay' | 'card' | 'transfer'>('cash');
  const [batchCashInput, setBatchCashInput] = useState<string>('');
  const [batchRefNumber, setBatchRefNumber] = useState<string>('');
  const [batchCustomerNote, setBatchCustomerNote] = useState<string>('');
  const [billingSummary, setBillingSummary] = useState<POSBillingSummary | null>(null);
  const [batchQrDataUrl, setBatchQrDataUrl] = useState('');

  // Filter sales history
  const filteredOrders = orders.filter((o) => {
    const matchSearch =
      o.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.cashierName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (o.customerNote && o.customerNote.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (o.referenceNumber && o.referenceNumber.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchStatus = statusFilter === 'all' || o.status === statusFilter;
    const matchPayment = paymentFilter === 'all' || o.paymentMethod === paymentFilter;

    return matchSearch && matchStatus && matchPayment;
  });

  // Filter held orders
  const filteredHeldOrders = heldOrders.filter((h) => {
    if (!heldSearchQuery.trim()) return true;
    const q = heldSearchQuery.toLowerCase();
    return (
      h.heldNumber.toLowerCase().includes(q) ||
      (h.customerName && h.customerName.toLowerCase().includes(q)) ||
      (h.note && h.note.toLowerCase().includes(q)) ||
      h.items.some((it) => it.product.name.toLowerCase().includes(q))
    );
  });

  // Toggle single held order selection
  const handleToggleSelectHeld = (id: string) => {
    setSelectedHeldIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Toggle select all
  const handleToggleSelectAllHeld = () => {
    if (selectedHeldIds.length === filteredHeldOrders.length) {
      setSelectedHeldIds([]);
    } else {
      setSelectedHeldIds(filteredHeldOrders.map((h) => h.id));
    }
  };

  // Selected held orders objects & calculations
  const selectedHeldObjects = heldOrders.filter((h) => selectedHeldIds.includes(h.id));
  const selectedTotalAmount = selectedHeldObjects.reduce((sum, h) => sum + h.total, 0);
  const paymentTotal = billingSummary ? billingSummary.totalSatang / 100 : selectedTotalAmount;
  const selectedTotalItemsCount = selectedHeldObjects.reduce(
    (sum, h) => sum + h.items.reduce((s, it) => s + it.quantity, 0),
    0
  );

  // Open Batch Pay Modal
  const handleOpenBatchPay = async (idsToPay?: string[]) => {
    const targetIds = idsToPay || selectedHeldIds;
    if (targetIds.length === 0) return;
    if (idsToPay) {
      setSelectedHeldIds(idsToPay);
    }
    setBatchPayMethod('cash');
    setBatchCashInput('');
    setBatchRefNumber('');
    setBatchCustomerNote('');
    setBillingSummary(null);
    const targets = heldOrders.filter((item) => targetIds.includes(item.id));
    const accountID = targets[0]?.billingAccountId;
    if (accountID && targets.every((item) => item.billingAccountId === accountID)) {
      try { setBillingSummary(await getPOSBillingSummary(accountID)); } catch { setBillingSummary(null); }
    }
    setIsBatchPayModalOpen(true);
  };

  // Execute Batch Payment
  const handleConfirmBatchPayment = async () => {
    if (selectedHeldIds.length === 0) return;

    const cashGiven = parseFloat(batchCashInput) || 0;
    if (batchPayMethod === 'cash' && cashGiven < paymentTotal) {
      return;
    }

    const completed = await processBatchHeldPayment({
      heldIds: selectedHeldIds,
      paymentMethod: batchPayMethod,
      cashReceived: batchPayMethod === 'cash' ? cashGiven : undefined,
      referenceNumber: batchRefNumber || undefined,
      customerNote: batchCustomerNote || undefined,
    });

	if (!completed) {
	  const accountID = selectedHeldObjects[0]?.billingAccountId;
	  if (accountID) {
		try { setBillingSummary(await getPOSBillingSummary(accountID)); } catch { /* Keep the payment modal open with the last visible total. */ }
	  }
	  return;
	}

    setIsBatchPayModalOpen(false);
    setSelectedHeldIds([]);
  };

  // Batch delete handler
  const handleConfirmBatchDelete = () => {
    if (selectedHeldIds.length === 0) return;
    if (window.confirm(`ยืนยันการลบรายการพักยอดที่เลือก ${selectedHeldIds.length} รายการ?`)) {
      batchDeleteHeldOrders(selectedHeldIds);
      setSelectedHeldIds([]);
    }
  };

  // Batch merge into cart handler
  const handleConfirmBatchMerge = () => {
    if (selectedHeldIds.length === 0) return;
    mergeHeldOrdersIntoCart(selectedHeldIds);
    setSelectedHeldIds([]);
  };

  const handleConfirmRefund = () => {
    if (selectedOrderForRefund) {
      refundOrder(selectedOrderForRefund, refundReason);
      setSelectedOrderForRefund(null);
      setRefundReason('');
    }
  };

  const batchCashGiven = parseFloat(batchCashInput) || 0;
  const batchChange = Math.max(0, batchCashGiven - paymentTotal);
  const isBatchCashSufficient = batchCashGiven >= paymentTotal;

  useEffect(() => {
    if (!isBatchPayModalOpen || batchPayMethod !== 'promptpay' || paymentTotal <= 0) { setBatchQrDataUrl(''); return; }
    let cancelled = false;
    void getPOSPaymentQR(Math.round(paymentTotal * 100)).then(async (result) => {
      const image = result.promptPayPayload ? await QRCode.toDataURL(result.promptPayPayload, { width: 260, margin: 1 }) : result.fallbackImage || '';
      if (!cancelled) setBatchQrDataUrl(image);
    }).catch(() => { if (!cancelled) setBatchQrDataUrl(''); });
    return () => { cancelled = true; };
  }, [isBatchPayModalOpen, batchPayMethod, paymentTotal]);

  return (
    <div className="flex-1 w-full p-4 sm:p-6 space-y-6 pb-44 sm:pb-48 overflow-y-auto bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Header & Segmented control */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            จัดการบิล & ประวัติการขาย
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            เลือกชำระรายการพักยอดหลายบิลพร้อมกัน หรือค้นหาประวัติการทำรายการย้อนหลัง
          </p>
        </div>

        {/* Segmented Switcher */}
        <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-200 dark:border-slate-800 self-start sm:self-auto shadow-xs">
          <button
            id="tab-held-bills-btn"
            onClick={() => setActiveSegment('held')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeSegment === 'held'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <PauseCircle className="w-4 h-4" />
            <span>รายการพักยอด</span>
            {heldOrders.length > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  activeSegment === 'held'
                    ? 'bg-slate-950 text-amber-400'
                    : 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400'
                }`}
              >
                {heldOrders.length}
              </span>
            )}
          </button>

          <button
            id="tab-history-bills-btn"
            onClick={() => setActiveSegment('history')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeSegment === 'history'
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>ประวัติการขาย</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                activeSegment === 'history'
                  ? 'bg-slate-950 text-emerald-400'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {orders.length}
            </span>
          </button>
        </div>
      </div>

      {/* VIEW 1: HELD ORDERS */}
      {activeSegment === 'held' && (
        <div className="space-y-4">
          {/* Top Bar for Held Orders: Filter, Select All, Summary */}
          {heldOrders.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 flex-1 max-w-md">
                <div className="relative w-full">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={heldSearchQuery}
                    onChange={(e) => setHeldSearchQuery(e.target.value)}
                    placeholder="ค้นหาเลขที่พักยอด, ชื่อลูกค้า, สินค้า..."
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700/80 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {/* Multi-selection Toggle Buttons */}
              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                <button
                  onClick={handleToggleSelectAllHeld}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                    selectedHeldIds.length === filteredHeldOrders.length && filteredHeldOrders.length > 0
                      ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-300 dark:border-amber-500/40 text-amber-800 dark:text-amber-300'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {selectedHeldIds.length === filteredHeldOrders.length && filteredHeldOrders.length > 0 ? (
                    <CheckSquare className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-400" />
                  )}
                  <span>
                    {selectedHeldIds.length === filteredHeldOrders.length && filteredHeldOrders.length > 0
                      ? 'ยกเลิกเลือกทั้งหมด'
                      : `เลือกทั้งหมด (${filteredHeldOrders.length})`}
                  </span>
                </button>

                {selectedHeldIds.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleOpenBatchPay()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-sm transition-all"
                    >
                      <Zap className="w-3.5 h-3.5 fill-slate-950" />
                      <span>ชำระรวม ({selectedHeldIds.length})</span>
                    </button>
                    <button
                      onClick={() => setSelectedHeldIds([])}
                      className="px-2 py-1.5 rounded-xl text-xs text-slate-500 hover:text-slate-800 dark:hover:text-white"
                    >
                      ล้าง
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {heldOrders.length === 0 ? (
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-3xl p-12 text-center flex flex-col items-center justify-center space-y-3 shadow-xs">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500">
                <PauseCircle className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-300">ไม่มีรายการพักยอดในขณะนี้</h3>
              <p className="text-xs text-slate-500 max-w-sm">
                เมื่อคุณกดปุ่ม &quot;พักยอด&quot; ในหน้าขาย รายการคำสั่งซื้อจะมาแสดงที่นี่เพื่อรอการเรียกกลับไปชำระเงิน หรือเลือกชำระเงินพร้อมกันหลายบิล
              </p>
            </div>
          ) : filteredHeldOrders.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center text-slate-500 text-xs">
              ไม่พบรายการพักยอดที่ตรงกับคำค้นหา &quot;{heldSearchQuery}&quot;
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredHeldOrders.map((held) => {
                const isSelected = selectedHeldIds.includes(held.id);
                return (
                  <div
                    key={held.id}
                    id={`held-card-${held.id}`}
                    onClick={() => handleToggleSelectHeld(held.id)}
                    className={`bg-white dark:bg-slate-900 border rounded-3xl p-5 shadow-sm hover:shadow-md flex flex-col justify-between transition-all cursor-pointer select-none ${
                      isSelected
                        ? 'border-amber-500 ring-2 ring-amber-500/20 bg-amber-50/20 dark:bg-amber-500/5'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-3">
                      {/* Header with Checkbox */}
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleSelectHeld(held.id);
                            }}
                            className={`w-6 h-6 rounded-lg flex items-center justify-center border transition-all ${
                              isSelected
                                ? 'bg-amber-500 border-amber-600 text-slate-950 shadow-xs'
                                : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-transparent hover:border-amber-400'
                            }`}
                          >
                            <Check className="w-4 h-4 stroke-[3]" />
                          </button>

                          <div>
                            <span className="px-2.5 py-0.5 rounded-lg text-xs font-bold font-mono bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30">
                              {held.heldNumber}
                            </span>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-1 flex items-center gap-1.5">
                              <User className="w-3.5 h-3.5 text-slate-400" />
                              <span className="truncate">{held.customerName || 'ไม่ระบุชื่อ'}</span>
                            </h3>
                          </div>
                        </div>

                        <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 font-mono">
                          <Clock className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                          <span>{formatThaiDateTime(held.createdAt).slice(-8)}</span>
                        </span>
                      </div>

                      {/* Note if any */}
                      {held.note && (
                        <div className="text-xs text-amber-800 dark:text-amber-300/90 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 p-2 rounded-xl italic">
                          &quot;{held.note}&quot;
                        </div>
                      )}

                      {/* Items List Preview */}
                      <div className="bg-slate-50 dark:bg-slate-950/60 rounded-2xl p-3 border border-slate-200 dark:border-slate-800/80 space-y-1.5 max-h-36 overflow-y-auto custom-scrollbar">
                        {held.items.map((item, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300"
                          >
                            <span className="truncate pr-2 font-medium">
                              {item.quantity}x {item.product.name}
                            </span>
                            <span className="font-mono text-slate-600 dark:text-slate-400 shrink-0">
                              {formatCurrency(
                                item.product.price * item.quantity,
                                settings.currencySymbol,
                                settings.decimalPlaces
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Total & Action Buttons */}
                    <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 block">ยอดรวมบิลนี้</span>
                        <span className="text-lg font-black text-amber-600 dark:text-amber-400 font-mono">
                          {formatCurrency(held.total, settings.currencySymbol, settings.decimalPlaces)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => deleteHeldOrder(held.id)}
						  disabled={!held.sourceSaleIds?.length}
						  className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-rose-100 dark:hover:bg-rose-950/50 text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 border border-slate-200 dark:border-slate-700 transition-colors disabled:cursor-not-allowed disabled:opacity-35"
						  title={held.sourceSaleIds?.length ? 'ลบรายการพักยอด POS' : 'ยอด Match ต้องจัดการที่ระบบ Match'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => resumeHeldOrder(held.id)}
						  disabled={!held.sourceSaleIds?.length}
						  className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors disabled:cursor-not-allowed disabled:opacity-35"
						  title={held.sourceSaleIds?.length ? 'ดึงรายการ POS กลับไปแก้ไขในหน้าขาย' : 'ไม่มีสินค้า POS ในยอดนี้'}
                        >
                          <ShoppingBag className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => handleOpenBatchPay([held.id])}
                          className="flex items-center gap-1 px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md shadow-amber-500/20 transition-all"
                          title="ชำระเงินทันที"
                        >
                          <Zap className="w-3.5 h-3.5 fill-slate-950" />
                          <span>ชำระทันที</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Sticky Floating Multi-Select Action Toolbar */}
          {selectedHeldIds.length > 0 && (
            <div className="fixed bottom-24 sm:bottom-24 left-1/2 -translate-x-1/2 w-[calc(100%-1.5rem)] sm:w-[calc(100%-2rem)] max-w-2xl z-30 bg-white/95 dark:bg-slate-900/95 border-2 border-amber-500 rounded-3xl p-3 sm:p-4 shadow-2xl backdrop-blur-xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500 text-slate-950 flex items-center justify-center font-black text-base shadow-md shadow-amber-500/30 shrink-0">
                  {selectedHeldIds.length}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">
                    เลือก {selectedHeldIds.length} บิล ({selectedTotalItemsCount} ชิ้น)
                  </div>
                  <div className="text-base sm:text-lg font-black text-amber-600 dark:text-amber-400 font-mono truncate">
                    ยอดรวม {formatCurrency(selectedTotalAmount, settings.currencySymbol, settings.decimalPlaces)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap justify-end">
                <button
                  onClick={handleConfirmBatchDelete}
                  className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 transition-colors shrink-0"
                  title="ลบรายการที่เลือก"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                <button
                  onClick={handleConfirmBatchMerge}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold border border-slate-200 dark:border-slate-700 transition-colors whitespace-nowrap"
                  title="รวมสินค้าทั้งหมดเข้าสู่ตะกร้าหน้าร้าน"
                >
                  <ShoppingBag className="w-4 h-4" />
                  <span>รวมเข้าตะกร้า</span>
                </button>

                <button
                  id="batch-pay-submit-btn"
                  onClick={() => handleOpenBatchPay()}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 text-xs font-black shadow-lg shadow-amber-500/25 transition-all whitespace-nowrap"
                >
                  <Zap className="w-4 h-4 fill-slate-950" />
                  <span>ชำระรวมทันที ({selectedHeldIds.length} บิล)</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: SALES HISTORY */}
      {activeSegment === 'history' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 space-y-3 shadow-md">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              {/* Search */}
              <div className="md:col-span-6 relative">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ค้นหาตามเลขที่บิล, แคชเชียร์, หมายเหตุ..."
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700/80 rounded-2xl pl-10 pr-4 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Status Filter */}
              <div className="md:col-span-3">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'all' | 'completed' | 'refunded')}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700/80 rounded-2xl px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="all">สถานะบิลทั้งหมด</option>
                  <option value="completed">ชำระสำเร็จ</option>
                  <option value="refunded">คืนเงินแล้ว</option>
                </select>
              </div>

              {/* Payment Method Filter */}
              <div className="md:col-span-3">
                <select
                  value={paymentFilter}
                  onChange={(e) => setPaymentFilter(e.target.value as 'all' | 'cash' | 'promptpay' | 'card')}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700/80 rounded-2xl px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="all">วิธีชำระทั้งหมด</option>
                  <option value="cash">เงินสด (Cash)</option>
                  <option value="promptpay">PromptPay QR</option>
                  <option value="card">บัตรเครดิต</option>
                </select>
              </div>
            </div>
          </div>

          {/* Sales History Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-md">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                <thead className="bg-slate-100/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 font-bold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="p-4">เลขที่บิล</th>
                    <th className="p-4">วัน-เวลา / แคชเชียร์</th>
                    <th className="p-4">รายการสินค้า</th>
                    <th className="p-4">ช่องทางชำระ</th>
                    <th className="p-4 text-right">ยอดสุทธิ</th>
                    <th className="p-4 text-center">สถานะ</th>
                    <th className="p-4 text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400 dark:text-slate-500">
                        ไม่พบประวัติการขายที่ตรงกับเงื่อนไข
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((order) => (
                      <tr
                        key={order.id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="p-4 font-mono font-bold text-slate-900 dark:text-white">
                          <div>{order.orderNumber}</div>
						  <span className={`mt-1 inline-flex rounded-md px-2 py-0.5 text-[10px] font-black ${order.originSystem === 'match' ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'}`}>
							รับชำระที่ {order.originSystem === 'match' ? 'Match' : 'POS'}
						  </span>
                          {order.referenceNumber && (
                            <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                              Ref: {order.referenceNumber}
                            </div>
                          )}
                        </td>
                        <td className="p-4 text-slate-600 dark:text-slate-400">
                          <div>{formatThaiDateTime(order.createdAt)}</div>
                          <div className="text-[10px] text-slate-400 dark:text-slate-500">{order.cashierName}</div>
                        </td>
                        <td className="p-4">
                          <div className="max-w-[220px] truncate text-slate-800 dark:text-slate-200 font-medium">
                            {order.items.map((it) => `${it.name} (${it.quantity})`).join(', ')}
                          </div>
                          <div className="text-[10px] text-slate-400 dark:text-slate-500">
                            {order.items.reduce((s, it) => s + it.quantity, 0)} ชิ้น
                          </div>
                        </td>
                        <td className="p-4">
                          <span className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            {order.paymentMethod === 'promptpay'
                              ? 'PromptPay QR'
                              : order.paymentMethod === 'cash'
                              ? 'เงินสด'
                              : order.paymentMethod === 'card'
                              ? 'บัตรเครดิต'
                              : 'โอนเงิน'}
                          </span>
                        </td>
                        <td className="p-4 text-right font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(
                            order.total,
                            settings.currencySymbol,
                            settings.decimalPlaces
                          )}
						  <div className="mt-1 text-[10px] font-semibold text-slate-400">Match {formatCurrency(order.matchTotal || 0, settings.currencySymbol, 2)} · POS {formatCurrency(order.posTotal || 0, settings.currencySymbol, 2)}</div>
                        </td>
                        <td className="p-4 text-center">
                          {order.status === 'completed' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-500/30">
                              <CheckCircle2 className="w-3 h-3" />
                              สำเร็จ
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-500/30">
                              <RotateCcw className="w-3 h-3" />
                              คืนเงินแล้ว
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setSelectedOrderForReceipt(order)}
                              className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700 transition-colors"
                              title="ดูและพิมพ์ใบเสร็จ"
                            >
                              <Printer className="w-4 h-4" />
                            </button>

						{order.status === 'completed' && !order.paymentId && (
                              <button
                                onClick={() => setSelectedOrderForRefund(order.id)}
                                className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-rose-100 dark:hover:bg-rose-950/40 text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 border border-slate-200 dark:border-slate-700 transition-colors"
                                title="คืนเงิน / ยกเลิกบิล"
                              >
                                <RotateCcw className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* BATCH PAYMENT MODAL */}
      {isBatchPayModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl space-y-4 max-h-[92vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wider bg-amber-100 dark:bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-200 dark:border-amber-500/20">
                  ชำระเงินรวม • BATCH CHECKOUT
                </span>
                <h2 className="text-lg font-black text-slate-900 dark:text-white mt-1">
                  ชำระเงินรวมรายการพักยอด ({selectedHeldObjects.length} บิล)
                </h2>
              </div>
              <button
                onClick={() => setIsBatchPayModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1 custom-scrollbar">
              {/* Selected Held Bills Summary */}
              <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-amber-500" />
                    <span>รายการบิลที่รวมชำระ ({selectedHeldObjects.length} บิล)</span>
                  </span>
                  <span className="font-mono text-slate-500">รวม {selectedTotalItemsCount} ชิ้น</span>
                </div>

                <div className="divide-y divide-slate-200/60 dark:divide-slate-800/60 max-h-32 overflow-y-auto custom-scrollbar">
                  {selectedHeldObjects.map((held) => (
                    <div key={held.id} className="py-1.5 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                          {held.heldNumber}
                        </span>
                        <span className="text-slate-600 dark:text-slate-400">
                          {held.customerName || 'ไม่ระบุชื่อ'}
                        </span>
                        {held.note && (
                          <span className="text-[10px] text-slate-400 italic">({held.note})</span>
                        )}
                      </div>
                      <span className="font-mono font-semibold text-slate-900 dark:text-white">
                        {formatCurrency(held.total, settings.currencySymbol, settings.decimalPlaces)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">ยอดรวมทั้งสิ้นที่ต้องชำระ</span>
                  <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
                    {formatCurrency(paymentTotal, settings.currencySymbol, settings.decimalPlaces)}
                  </span>
                </div>
                {billingSummary && billingSummary.matchTotalSatang > 0 && <p className="text-[11px] font-semibold text-slate-500">POS {formatCurrency(billingSummary.posTotalSatang / 100, settings.currencySymbol, 2)} + Match {formatCurrency(billingSummary.matchTotalSatang / 100, settings.currencySymbol, 2)}</p>}
              </div>

              {/* Payment Methods */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                  เลือกช่องทางการชำระเงิน
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => setBatchPayMethod('cash')}
                    className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all ${
                      batchPayMethod === 'cash'
                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                    }`}
                  >
                    <Banknote className="w-5 h-5" />
                    <span className="text-xs">เงินสด (Cash)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBatchPayMethod('promptpay')}
                    className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all ${
                      batchPayMethod === 'promptpay'
                        ? 'bg-blue-500/10 border-blue-500 text-blue-600 dark:text-blue-400 font-bold shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                    }`}
                  >
                    <QrCode className="w-5 h-5" />
                    <span className="text-xs">PromptPay QR</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBatchPayMethod('card')}
                    className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all ${
                      batchPayMethod === 'card'
                        ? 'bg-purple-500/10 border-purple-500 text-purple-600 dark:text-purple-400 font-bold shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                    }`}
                  >
                    <CreditCard className="w-5 h-5" />
                    <span className="text-xs">บัตรเครดิต</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBatchPayMethod('transfer')}
                    className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all ${
                      batchPayMethod === 'transfer'
                        ? 'bg-indigo-500/10 border-indigo-500 text-indigo-600 dark:text-indigo-400 font-bold shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                    }`}
                  >
                    <Sparkles className="w-5 h-5" />
                    <span className="text-xs">โอนเงิน</span>
                  </button>
                </div>
              </div>

              {/* Method Detail */}
              {batchPayMethod === 'cash' && (
                <div className="space-y-3 bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      จำนวนเงินสดที่รับจากลูกค้า
                    </label>
                    {batchCashGiven > 0 && (
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                          isBatchCashSufficient
                            ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                            : 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400'
                        }`}
                      >
                        {isBatchCashSufficient ? 'เงินครบถ้วน' : 'ยอดเงินไม่พอ'}
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      value={batchCashInput}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setBatchCashInput(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-lg font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  {/* Quick Cash Buttons */}
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setBatchCashInput(paymentTotal.toString())}
                      className="px-3 py-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-xs font-bold border border-emerald-300 dark:border-emerald-500/30"
                    >
                      พอดี (฿{paymentTotal.toLocaleString()})
                    </button>
                    {[100, 500, 1000, 2000].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setBatchCashInput(val.toString())}
                        className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-mono font-semibold border border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                      >
                        ฿{val}
                      </button>
                    ))}
                    {[+20, +50, +100, +500].map((val) => (
                      <button
                        key={`plus-${val}`}
                        type="button"
                        onClick={() => {
                          const cur = parseFloat(batchCashInput) || 0;
                          setBatchCashInput((cur + val).toString());
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs font-mono font-semibold border border-amber-200 dark:border-amber-500/20"
                      >
                        +{val}
                      </button>
                    ))}
                  </div>

                  {/* Change calculation */}
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <span className="text-xs text-slate-500 dark:text-slate-400">เงินทอน (Change)</span>
                    <span
                      className={`text-base font-black font-mono ${
                        isBatchCashSufficient
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {formatCurrency(batchChange, settings.currencySymbol, settings.decimalPlaces)}
                    </span>
                  </div>
                </div>
              )}

              {batchPayMethod === 'promptpay' && (
                <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col items-center text-center space-y-3">
                  <div className="p-3 bg-white rounded-2xl shadow-sm border border-slate-200 inline-block">
                    {batchQrDataUrl ? <img src={batchQrDataUrl} alt="PromptPay QR" className="w-36 h-36 object-contain" /> : <QrCode className="w-36 h-36 text-slate-900" />}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">
                      พร้อมเพย์: {settings.promptPayId || '0812345678'} ({settings.storeName})
                    </p>
                    <p className="text-xs text-slate-500">สแกนเพื่อชำระยอดรวม {formatCurrency(paymentTotal, settings.currencySymbol, settings.decimalPlaces)}</p>
                  </div>
                  <input
                    type="text"
                    value={batchRefNumber}
                    onChange={(e) => setBatchRefNumber(e.target.value)}
                    placeholder="เลขอ้างอิงสลิป / Ref (ถ้ามี)"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-white"
                  />
                </div>
              )}

              {batchPayMethod === 'card' && (
                <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    เลขอ้างอิง EDC / Approval Code
                  </label>
                  <input
                    type="text"
                    value={batchRefNumber}
                    onChange={(e) => setBatchRefNumber(e.target.value)}
                    placeholder="เช่น APPROVAL-8910"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-white"
                  />
                </div>
              )}

              {batchPayMethod === 'transfer' && (
                <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    บันทึกการโอนเงิน / หมายเลขอ้างอิงสลิป
                  </label>
                  <input
                    type="text"
                    value={batchRefNumber}
                    onChange={(e) => setBatchRefNumber(e.target.value)}
                    placeholder="เช่น โอนเข้า ธ.กสิกรไทย 123-xxx"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-white"
                  />
                </div>
              )}

              {/* Extra Note */}
              <div>
                <input
                  type="text"
                  value={batchCustomerNote}
                  onChange={(e) => setBatchCustomerNote(e.target.value)}
                  placeholder="หมายเหตุเพิ่มเติมในใบเสร็จ (ถ้ามี)..."
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {/* Footer buttons */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setIsBatchPayModalOpen(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                ยกเลิก
              </button>

              <button
                type="button"
                disabled={batchPayMethod === 'cash' && !isBatchCashSufficient}
                onClick={handleConfirmBatchPayment}
                className={`flex-1 flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black shadow-lg transition-all ${
                  batchPayMethod === 'cash' && !isBatchCashSufficient
                    ? 'bg-slate-300 dark:bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/25'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  ยืนยันชำระเงินรวม ({formatCurrency(paymentTotal, settings.currencySymbol, settings.decimalPlaces)})
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REFUND MODAL */}
      {selectedOrderForRefund && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                <RotateCcw className="w-5 h-5" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">ยืนยันการคืนเงิน / ยกเลิกบิล</h3>
              </div>
              <button
                onClick={() => setSelectedOrderForRefund(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 p-3.5 rounded-2xl text-xs text-rose-800 dark:text-rose-300 space-y-1">
              <p className="font-semibold">⚠️ ข้อควรทราบ:</p>
              <p>ระบบจะปรับสถานะบิลเป็น &quot;คืนเงินแล้ว&quot; และทำการคืนจำนวนสินค้ากลับเข้าสต็อกคงคลังอัตโนมัติ</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                เหตุผลการคืนเงิน (Refund Reason)
              </label>
              <input
                type="text"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="เช่น ลูกค้าขอเปลี่ยนเมนู, อาหารมีปัญหา, คืนเงินสด"
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedOrderForRefund(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmRefund}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/20"
              >
                ยืนยันการคืนเงิน
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
