import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  getPOSBillingSummary,
  getPOSPaymentQR,
  listPOSPaymentHistoryPage,
  POSBillingSummary,
  POSPaymentHistory,
} from '../api/posSales';
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
  Banknote,
  QrCode,
  Layers,
  ArrowRight,
  X,
  Check,
  Eye,
} from 'lucide-react';
import type { Order } from '../types';

const HISTORY_PAGE_SIZE = 20;

const paymentHistoryToOrder = (payment: POSPaymentHistory): Order => {
  const items: Order['items'] = [];
  payment.lines.forEach((line) => {
    const snapshot = line.snapshot || {};
    const snapshotItems = Array.isArray(snapshot.items) ? snapshot.items : [];
    if (snapshotItems.length === 0) {
      items.push({ productId: line.sourceId, name: line.label, sku: '', price: line.amountSatang / 100, cost: 0, quantity: 1, total: line.amountSatang / 100 });
      return;
    }
    snapshotItems.forEach((entry: Record<string, unknown>, index: number) => {
      const quantity = Number(entry.quantity || 1);
      const amountSatang = Number(entry.amountSatang ?? entry.lineTotalSatang ?? 0);
      items.push({
        productId: String(entry.productId || `${line.sourceId}-${index}`),
        name: String(entry.name || entry.productName || entry.label || line.label),
        sku: String(entry.sku || ''),
        price: Number(entry.unitPriceSatang ?? entry.unitAmountSatang ?? (quantity > 0 ? amountSatang / quantity : amountSatang)) / 100,
        cost: Number(entry.unitCostSatang || 0) / 100,
        quantity,
        total: amountSatang / 100,
        note: entry.note ? String(entry.note) : undefined,
      });
    });
  });
  return {
    id: payment.paymentId,
    orderNumber: payment.paymentId,
    items,
    subtotal: payment.amountSatang / 100,
    discount: 0,
    discountType: 'amount',
    vatAmount: 0,
    vatRate: 0,
    isVatIncluded: true,
    total: payment.amountSatang / 100,
    paymentMethod: payment.method,
    cashReceived: (payment.cashReceivedSatang || 0) / 100,
    change: (payment.changeSatang || 0) / 100,
    status: 'completed',
    createdAt: payment.createdAt,
    cashierName: payment.receivedByName || 'Admin',
    customerNote: payment.displayName,
    referenceNumber: payment.referenceNumber,
    paymentId: payment.paymentId,
    originSystem: payment.originSystem,
    matchTotal: payment.matchTotalSatang / 100,
    posTotal: payment.posTotalSatang / 100,
    billingLines: payment.lines,
  };
};

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
    broadcastCustomerDisplay,
  } = usePos();

  const [activeSegment, setActiveSegment] = useState<'held' | 'history'>('held');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [heldSearchQuery, setHeldSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'refunded'>('all');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'cash' | 'promptpay'>('all');
  const [selectedOrderForRefund, setSelectedOrderForRefund] = useState<string | null>(null);
  const [selectedHistoryDetail, setSelectedHistoryDetail] = useState<Order | null>(null);
  const [refundReason, setRefundReason] = useState<string>('');
  const [historyOrders, setHistoryOrders] = useState<Order[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyBadgeTotal, setHistoryBadgeTotal] = useState(0);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyLoadError, setHistoryLoadError] = useState('');

  // Multi-selection state for Held Orders
  const [selectedHeldIds, setSelectedHeldIds] = useState<string[]>([]);
  const [isBatchPayModalOpen, setIsBatchPayModalOpen] = useState<boolean>(false);
  const [isBatchPaying, setIsBatchPaying] = useState(false);
  const [batchPayMethod, setBatchPayMethod] = useState<'cash' | 'promptpay'>('cash');
  const [batchCashInput, setBatchCashInput] = useState<string>('');
  const [batchRefNumber, setBatchRefNumber] = useState<string>('');
  const [batchCustomerNote, setBatchCustomerNote] = useState<string>('');
  const [billingSummary, setBillingSummary] = useState<POSBillingSummary | null>(null);
  const [batchLiveTotal, setBatchLiveTotal] = useState<number | null>(null);
  const [batchQrDataUrl, setBatchQrDataUrl] = useState('');

  const filteredOrders = historyOrders;

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
  const paymentTotal = batchLiveTotal ?? (billingSummary ? billingSummary.totalSatang / 100 : selectedTotalAmount);
  const selectedTotalItemsCount = selectedHeldObjects.reduce(
    (sum, h) => sum + h.items.reduce((s, it) => s + it.quantity, 0),
    0
  );

  useEffect(() => {
    if (!selectedHistoryDetail) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedHistoryDetail(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedHistoryDetail]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsHistoryLoading(true);
      setHistoryLoadError('');
      try {
        const result = await listPOSPaymentHistoryPage({
          page: historyPage,
          pageSize: HISTORY_PAGE_SIZE,
          search: searchQuery,
          status: statusFilter,
          method: paymentFilter,
        });
        if (cancelled) return;
        if (historyPage > result.totalPages) {
          setHistoryPage(Math.max(1, result.totalPages));
          return;
        }
        setHistoryOrders(result.items.map(paymentHistoryToOrder));
        setHistoryTotal(result.total);
        setHistoryTotalPages(Math.max(1, result.totalPages));
        if (!searchQuery.trim() && statusFilter === 'all' && paymentFilter === 'all') {
          setHistoryBadgeTotal(result.total);
        }
      } catch {
        if (!cancelled) {
          setHistoryOrders([]);
          setHistoryLoadError('โหลดประวัติการขายไม่สำเร็จ กรุณาลองใหม่');
        }
      } finally {
        if (!cancelled) setIsHistoryLoading(false);
      }
    }, searchQuery.trim() ? 350 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeSegment, historyPage, searchQuery, statusFilter, paymentFilter, orders.length, orders[0]?.paymentId]);

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
    setBatchLiveTotal(null);
    const targets = heldOrders.filter((item) => targetIds.includes(item.id));
    const accountIDs: string[] = Array.from(new Set<string>(targets.flatMap((item) => item.billingAccountId ? [item.billingAccountId] : [])));
    if (accountIDs.length > 0) {
      try {
        const summaries = await Promise.all(accountIDs.map((accountID) => getPOSBillingSummary(accountID)));
        setBatchLiveTotal(summaries.reduce((sum, item) => sum + item.totalSatang, 0) / 100);
        setBillingSummary(summaries.length === 1 ? summaries[0] : null);
      } catch {
        setBillingSummary(null);
        setBatchLiveTotal(null);
      }
    }
    setIsBatchPayModalOpen(true);
  };

  const closeBatchPayModal = () => {
    setIsBatchPayModalOpen(false);
    const closedPaymentState = { isOpen: false, method: 'cash' as const, totalDue: 0 };
    localStorage.setItem('siampure_active_payment_modal', JSON.stringify(closedPaymentState));
    broadcastCustomerDisplay({ type: 'PAYMENT_MODAL_STATE', payload: closedPaymentState });
  };

  // Execute Batch Payment
  const handleConfirmBatchPayment = async () => {
    if (selectedHeldIds.length === 0 || isBatchPaying) return;

    const cashGiven = parseFloat(batchCashInput) || 0;
    if (batchPayMethod === 'cash' && cashGiven < paymentTotal) {
      return;
    }

    setIsBatchPaying(true);
    const completed = await processBatchHeldPayment({
      heldIds: selectedHeldIds,
      paymentMethod: batchPayMethod,
      cashReceived: batchPayMethod === 'cash' ? cashGiven : undefined,
      referenceNumber: batchRefNumber || undefined,
      customerNote: batchCustomerNote || undefined,
    });
    setIsBatchPaying(false);

    if (!completed) {
      const accountIDs: string[] = Array.from(new Set<string>(selectedHeldObjects.flatMap((item) => item.billingAccountId ? [item.billingAccountId] : [])));
      if (accountIDs.length > 0) {
        try {
          const summaries = await Promise.all(accountIDs.map((accountID) => getPOSBillingSummary(accountID)));
          setBatchLiveTotal(summaries.reduce((sum, item) => sum + item.totalSatang, 0) / 100);
          setBillingSummary(summaries.length === 1 ? summaries[0] : null);
        } catch { /* Keep the payment modal open with the last visible total. */ }
      }
      return;
    }

    closeBatchPayModal();
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

  useEffect(() => {
    if (!isBatchPayModalOpen) return;

    const billCart = selectedHeldObjects.flatMap((held) => held.items);
    const paymentState = {
      isOpen: true,
      method: batchPayMethod,
      totalDue: paymentTotal,
      cashReceived: batchPayMethod === 'cash' ? batchCashGiven : undefined,
      change: batchPayMethod === 'cash' ? batchChange : undefined,
      items: billCart,
      totals: {
        itemCount: selectedTotalItemsCount,
        subtotal: paymentTotal,
        discountAmount: 0,
        netBeforeVat: paymentTotal,
        vatAmount: 0,
        total: paymentTotal,
      },
    };

    localStorage.setItem('siampure_active_payment_modal', JSON.stringify(paymentState));
    broadcastCustomerDisplay({ type: 'PAYMENT_MODAL_STATE', payload: paymentState });
  }, [isBatchPayModalOpen, batchPayMethod, batchCashGiven, batchChange, paymentTotal, heldOrders, selectedHeldIds]);

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
              {historyBadgeTotal}
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
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setHistoryPage(1);
                  }}
                  placeholder="ค้นหาตามเลขที่บิล, แคชเชียร์, หมายเหตุ..."
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700/80 rounded-2xl pl-10 pr-4 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Status Filter */}
              <div className="md:col-span-3">
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as 'all' | 'completed' | 'refunded');
                    setHistoryPage(1);
                  }}
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
                  onChange={(e) => {
                    setPaymentFilter(e.target.value as 'all' | 'cash' | 'promptpay');
                    setHistoryPage(1);
                  }}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700/80 rounded-2xl px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="all">วิธีชำระทั้งหมด</option>
                  <option value="cash">เงินสด (Cash)</option>
                  <option value="promptpay">PromptPay QR</option>
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
                        {isHistoryLoading ? 'กำลังโหลดประวัติการขาย...' : historyLoadError || 'ไม่พบประวัติการขายที่ตรงกับเงื่อนไข'}
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
                            {order.paymentMethod === 'promptpay' ? 'PromptPay QR' : 'เงินสด'}
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
                              type="button"
                              onClick={() => setSelectedHistoryDetail(order)}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] font-bold text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
                              title="ดูรายละเอียดการชำระเงิน"
                              aria-label={`ดูรายละเอียดบิล ${order.orderNumber}`}
                            >
                              <Eye className="h-4 w-4" />
                              <span>ดูรายละเอียด</span>
                            </button>
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
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs dark:border-slate-800">
              <span className="text-slate-500 dark:text-slate-400">
                {historyTotal > 0
                  ? `แสดง ${(historyPage - 1) * HISTORY_PAGE_SIZE + 1}–${Math.min(historyPage * HISTORY_PAGE_SIZE, historyTotal)} จากทั้งหมด ${historyTotal.toLocaleString('th-TH')} รายการ · หน้า ${historyPage}/${historyTotalPages}`
                  : `ทั้งหมด 0 รายการ · หน้า 1/${historyTotalPages}`}
                {isHistoryLoading && <span className="ml-2 font-bold text-amber-600 dark:text-amber-400">กำลังโหลด...</span>}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={historyPage <= 1 || isHistoryLoading}
                  onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  ก่อนหน้า
                </button>
                <button
                  type="button"
                  disabled={historyPage >= historyTotalPages || isHistoryLoading || historyTotal === 0}
                  onClick={() => setHistoryPage((page) => Math.min(historyTotalPages, page + 1))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  ถัดไป
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PAYMENT HISTORY DETAIL MODAL */}
      {selectedHistoryDetail && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/75 p-3 backdrop-blur-xs sm:p-4"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelectedHistoryDetail(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-history-detail-title"
            className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6">
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                    Payment Detail
                  </span>
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-black ${selectedHistoryDetail.originSystem === 'match' ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'}`}>
                    รับชำระที่ {selectedHistoryDetail.originSystem === 'match' ? 'Match' : 'POS'}
                  </span>
                </div>
                <h2 id="payment-history-detail-title" className="text-lg font-black text-slate-900 dark:text-white sm:text-xl">
                  รายละเอียดการชำระเงิน
                </h2>
                <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  เลขที่บิล {selectedHistoryDetail.orderNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedHistoryDetail(null)}
                className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-white"
                aria-label="ปิดรายละเอียดการชำระเงิน"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5 overflow-y-auto p-5 sm:p-6">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-950/60">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">ลูกค้า / สมาชิก</p>
                  <p className="mt-1 truncate text-sm font-black text-slate-900 dark:text-white">{selectedHistoryDetail.customerNote || 'ลูกค้าทั่วไป'}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-950/60">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">วันและเวลา</p>
                  <p className="mt-1 text-sm font-black text-slate-900 dark:text-white">{formatThaiDateTime(selectedHistoryDetail.createdAt)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-950/60">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">ผู้รับชำระ</p>
                  <p className="mt-1 truncate text-sm font-black text-slate-900 dark:text-white">{selectedHistoryDetail.cashierName || 'Admin'}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-950/60">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">ช่องทางชำระ</p>
                  <p className="mt-1 text-sm font-black text-slate-900 dark:text-white">{selectedHistoryDetail.paymentMethod === 'promptpay' ? 'PromptPay QR' : 'เงินสด'}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-500/25 dark:bg-sky-500/10">
                  <p className="text-[11px] font-bold text-sky-700 dark:text-sky-300">ยอดจาก Match</p>
                  <p className="mt-1 font-mono text-xl font-black text-sky-800 dark:text-sky-200">{formatCurrency(selectedHistoryDetail.matchTotal || 0, settings.currencySymbol, 2)}</p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/25 dark:bg-amber-500/10">
                  <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300">ยอดจาก POS</p>
                  <p className="mt-1 font-mono text-xl font-black text-amber-800 dark:text-amber-200">{formatCurrency(selectedHistoryDetail.posTotal ?? selectedHistoryDetail.total, settings.currencySymbol, 2)}</p>
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/25 dark:bg-emerald-500/10">
                  <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">ยอดชำระรวม</p>
                  <p className="mt-1 font-mono text-xl font-black text-emerald-700 dark:text-emerald-300">{formatCurrency(selectedHistoryDetail.total, settings.currencySymbol, 2)}</p>
                </div>
              </div>

              <section>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
                    <Layers className="h-4 w-4 text-amber-500" />
                    รายการที่ชำระ
                  </h3>
                  <span className="text-[11px] font-semibold text-slate-400">{selectedHistoryDetail.items.reduce((sum, item) => sum + item.quantity, 0)} รายการสินค้า</span>
                </div>

                <div className="space-y-3">
                  {selectedHistoryDetail.billingLines && selectedHistoryDetail.billingLines.length > 0 ? (
                    selectedHistoryDetail.billingLines.map((line, lineIndex) => {
                      const snapshotItems = Array.isArray(line.snapshot?.items) ? line.snapshot.items : [];
                      return (
                        <article key={`${line.sourceType}-${line.sourceId}-${lineIndex}`} className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
                          <div className="flex items-start justify-between gap-3 bg-slate-50 px-4 py-3 dark:bg-slate-800/70">
                            <div className="min-w-0">
                              <span className={`mr-2 inline-flex rounded-md px-2 py-0.5 text-[10px] font-black ${line.sourceType === 'match' ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'}`}>
                                {line.sourceType === 'match' ? 'MATCH' : 'POS'}
                              </span>
                              <span className="text-xs font-bold text-slate-900 dark:text-white">{line.label}</span>
                            </div>
                            <span className="shrink-0 font-mono text-sm font-black text-slate-900 dark:text-white">{formatCurrency(line.amountSatang / 100, settings.currencySymbol, 2)}</span>
                          </div>
                          {snapshotItems.length > 0 && (
                            <div className="divide-y divide-slate-100 px-4 dark:divide-slate-800">
                              {snapshotItems.map((item: Record<string, unknown>, itemIndex: number) => {
                                const quantity = Number(item.quantity || 1);
                                const lineTotalSatang = Number(item.amountSatang ?? item.lineTotalSatang ?? 0);
                                const unitPriceSatang = Number(item.unitPriceSatang ?? item.unitAmountSatang ?? (quantity > 0 ? lineTotalSatang / quantity : lineTotalSatang));
                                return (
                                  <div key={`${line.sourceId}-item-${itemIndex}`} className="grid grid-cols-[1fr_auto] gap-3 py-2.5 text-xs">
                                    <div className="min-w-0">
                                      <p className="font-bold text-slate-800 dark:text-slate-200">{String(item.name || item.productName || item.label || line.label)}</p>
                                      <p className="mt-0.5 text-[10px] text-slate-400">{quantity} × {formatCurrency(unitPriceSatang / 100, settings.currencySymbol, 2)}</p>
                                    </div>
                                    <p className="self-center font-mono font-bold text-slate-700 dark:text-slate-300">{formatCurrency(lineTotalSatang / 100, settings.currencySymbol, 2)}</p>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </article>
                      );
                    })
                  ) : (
                    <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 px-4 dark:divide-slate-800 dark:border-slate-700">
                      {selectedHistoryDetail.items.map((item, itemIndex) => (
                        <div key={`${item.productId}-${itemIndex}`} className="grid grid-cols-[1fr_auto] gap-3 py-3 text-xs">
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 dark:text-white">{item.name}</p>
                            <p className="mt-0.5 text-[10px] text-slate-400">{item.quantity} × {formatCurrency(item.price, settings.currencySymbol, 2)}{item.sku ? ` · SKU ${item.sku}` : ''}</p>
                          </div>
                          <p className="self-center font-mono font-black text-slate-800 dark:text-slate-200">{formatCurrency(item.total, settings.currencySymbol, 2)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
                    {selectedHistoryDetail.paymentMethod === 'promptpay' ? <QrCode className="h-4 w-4 text-sky-500" /> : <Banknote className="h-4 w-4 text-emerald-500" />}
                    รายละเอียดรับชำระ
                  </h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between gap-3"><span className="text-slate-500">ช่องทาง</span><span className="font-bold text-slate-900 dark:text-white">{selectedHistoryDetail.paymentMethod === 'promptpay' ? 'PromptPay QR' : 'เงินสด'}</span></div>
                    {selectedHistoryDetail.paymentMethod === 'cash' && (
                      <>
                        <div className="flex justify-between gap-3"><span className="text-slate-500">รับเงินมา</span><span className="font-mono font-bold text-slate-900 dark:text-white">{formatCurrency(selectedHistoryDetail.cashReceived || 0, settings.currencySymbol, 2)}</span></div>
                        <div className="flex justify-between gap-3"><span className="text-slate-500">เงินทอน</span><span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(selectedHistoryDetail.change || 0, settings.currencySymbol, 2)}</span></div>
                      </>
                    )}
                    {selectedHistoryDetail.referenceNumber && <div className="flex justify-between gap-3"><span className="text-slate-500">เลขอ้างอิง</span><span className="break-all text-right font-mono font-bold text-slate-900 dark:text-white">{selectedHistoryDetail.referenceNumber}</span></div>}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/60">
                  <h3 className="mb-3 text-sm font-black text-slate-900 dark:text-white">สรุปยอดบิล</h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between gap-3"><span className="text-slate-500">ยอดก่อนส่วนลด</span><span className="font-mono font-bold text-slate-900 dark:text-white">{formatCurrency(selectedHistoryDetail.subtotal, settings.currencySymbol, 2)}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-slate-500">ส่วนลด</span><span className="font-mono font-bold text-rose-600 dark:text-rose-400">{selectedHistoryDetail.discount > 0 ? '-' : ''}{formatCurrency(selectedHistoryDetail.discount, settings.currencySymbol, 2)}</span></div>
                    {selectedHistoryDetail.vatAmount > 0 && <div className="flex justify-between gap-3"><span className="text-slate-500">VAT {selectedHistoryDetail.vatRate}%</span><span className="font-mono font-bold text-slate-900 dark:text-white">{formatCurrency(selectedHistoryDetail.vatAmount, settings.currencySymbol, 2)}</span></div>}
                    <div className="mt-2 flex justify-between gap-3 border-t border-slate-200 pt-2 dark:border-slate-700"><span className="font-black text-slate-900 dark:text-white">ยอดสุทธิ</span><span className="font-mono text-lg font-black text-emerald-600 dark:text-emerald-400">{formatCurrency(selectedHistoryDetail.total, settings.currencySymbol, 2)}</span></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/50 sm:px-6">
              <button
                type="button"
                onClick={() => setSelectedHistoryDetail(null)}
                className="rounded-xl bg-slate-200 px-4 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                ปิด
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedOrderForReceipt(selectedHistoryDetail);
                  setSelectedHistoryDetail(null);
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 shadow-lg shadow-amber-500/20 transition-colors hover:bg-amber-400"
              >
                <Printer className="h-4 w-4" />
                ดูใบเสร็จ / พิมพ์
              </button>
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
                onClick={closeBatchPayModal}
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
                <div className="grid grid-cols-2 gap-2">
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
                onClick={closeBatchPayModal}
                className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                ยกเลิก
              </button>

              <button
                type="button"
                disabled={isBatchPaying || (batchPayMethod === 'cash' && !isBatchCashSufficient)}
                onClick={handleConfirmBatchPayment}
                className={`flex-1 flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black shadow-lg transition-all ${
                  isBatchPaying || (batchPayMethod === 'cash' && !isBatchCashSufficient)
                    ? 'bg-slate-300 dark:bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/25'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {isBatchPaying ? 'กำลังบันทึกการชำระ...' : `ยืนยันชำระเงินรวม (${formatCurrency(paymentTotal, settings.currencySymbol, settings.decimalPlaces)})`}
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
