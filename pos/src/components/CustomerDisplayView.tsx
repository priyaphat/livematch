import React, { useState, useEffect, useRef, useMemo } from 'react';
import { usePos } from '../context/PosContext';
import { formatCurrency } from '../utils/formatters';
import { generatePromptPayPayload } from '../utils/promptpay';
import QRCode from 'qrcode';
import confetti from 'canvas-confetti';
import {
  ShoppingBag,
  QrCode,
  CheckCircle2,
  Clock,
  Sparkles,
  Maximize2,
  Minimize2,
  ExternalLink,
  Store,
  CreditCard,
  Banknote,
  ArrowRight,
  Coffee,
  X,
  Receipt,
  ShieldCheck,
  Check,
  Percent,
} from 'lucide-react';
import { Order, CartItem } from '../types';

interface CustomerDisplayViewProps {
  isStandaloneWindow?: boolean;
}

export const CustomerDisplayView: React.FC<CustomerDisplayViewProps> = ({ isStandaloneWindow = false }) => {
  const {
    settings,
    cart,
    discount,
    discountType,
    orders,
    setActiveTab,
  } = usePos();

  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Cached state tracking refs to prevent re-render loops and flickering
  const cartJsonRef = useRef<string>('');
  const modalJsonRef = useRef<string>('');

  // Live Cart items (synced via memory, BroadcastChannel, window.opener, or localStorage)
  const [displayCart, setDisplayCart] = useState<CartItem[]>(() => {
    try {
      const initialWin =
        (window as any).__SIAMPURE_INITIAL_STATE__ ||
        (window.opener as any)?.__SIAMPURE_INITIAL_STATE__;
      if (initialWin?.cart) {
        cartJsonRef.current = JSON.stringify(initialWin.cart);
        return initialWin.cart;
      }
      const saved = localStorage.getItem('siampure_cart');
      if (saved) {
        cartJsonRef.current = saved;
        return JSON.parse(saved);
      }
      cartJsonRef.current = JSON.stringify(cart);
      return cart;
    } catch {
      return cart;
    }
  });

  const [displayDiscount, setDisplayDiscount] = useState<number>(() => {
    try {
      const initialWin =
        (window as any).__SIAMPURE_INITIAL_STATE__ ||
        (window.opener as any)?.__SIAMPURE_INITIAL_STATE__;
      if (initialWin?.discount !== undefined) return initialWin.discount;
      const saved = localStorage.getItem('siampure_discount');
      return saved !== null ? JSON.parse(saved) : discount;
    } catch {
      return discount;
    }
  });

  const [displayDiscountType, setDisplayDiscountType] = useState<'percent' | 'amount'>(() => {
    try {
      const initialWin =
        (window as any).__SIAMPURE_INITIAL_STATE__ ||
        (window.opener as any)?.__SIAMPURE_INITIAL_STATE__;
      if (initialWin?.discountType) return initialWin.discountType;
      const saved = localStorage.getItem('siampure_discount_type');
      return saved === 'percent' || saved === 'amount' ? saved : discountType;
    } catch {
      return discountType;
    }
  });

  // Real-time calculated totals based on displayCart
  const displayTotals = useMemo(() => {
    const itemCount = displayCart.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = displayCart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

    let discountAmount = 0;
    if (displayDiscountType === 'percent') {
      discountAmount = (subtotal * displayDiscount) / 100;
    } else {
      discountAmount = displayDiscount;
    }
    discountAmount = Math.min(discountAmount, subtotal);

    const netBeforeVat = subtotal - discountAmount;
    let vatAmount = 0;
    let total = netBeforeVat;

    if (settings.vatEnabled && settings.vatType === 'included') {
      vatAmount = (netBeforeVat * settings.vatRate) / (100 + settings.vatRate);
      total = netBeforeVat;
    } else if (settings.vatEnabled) {
      vatAmount = (netBeforeVat * settings.vatRate) / 100;
      total = netBeforeVat + vatAmount;
    }

    return {
      itemCount,
      subtotal,
      discountAmount,
      netBeforeVat,
      vatAmount,
      total,
    };
  }, [displayCart, displayDiscount, displayDiscountType, settings.vatEnabled, settings.vatRate, settings.vatType]);

  // Real-time synced payment modal state
  const [activePaymentModal, setActivePaymentModal] = useState<{
    isOpen: boolean;
    method: 'cash' | 'promptpay';
    totalDue: number;
    cashReceived?: number;
    change?: number;
  }>(() => {
    try {
      const saved = localStorage.getItem('siampure_active_payment_modal');
      if (saved) {
        modalJsonRef.current = saved;
        return JSON.parse(saved);
      }
      return { isOpen: false, method: 'cash', totalDue: 0 };
    } catch {
      return { isOpen: false, method: 'cash', totalDue: 0 };
    }
  });

  const [lastCompletedOrder, setLastCompletedOrder] = useState<Order | null>(null);
  const [showThankYouBanner, setShowThankYouBanner] = useState<boolean>(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [countdown, setCountdown] = useState<number>(120);

  // Sync with local context cart when changed in the same React tree
  useEffect(() => {
    const currentJson = JSON.stringify(cart);
    if (currentJson !== cartJsonRef.current) {
      cartJsonRef.current = currentJson;
      setDisplayCart(cart);
    }
    setDisplayDiscount(discount);
    setDisplayDiscountType(discountType);
  }, [cart, discount, discountType]);

  // Live clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
      setCurrentDate(
        now.toLocaleDateString('th-TH', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Safe State updater that checks serialized values to avoid infinite render loops
  const updateCartSafely = (newCart: CartItem[]) => {
    if (!Array.isArray(newCart)) return;
    const newJson = JSON.stringify(newCart);
    if (newJson !== cartJsonRef.current) {
      cartJsonRef.current = newJson;
      setDisplayCart(newCart);
    }
  };

  const updateModalSafely = (modalState: any) => {
    if (!modalState) return;
    const newJson = JSON.stringify(modalState);
    if (newJson !== modalJsonRef.current) {
      modalJsonRef.current = newJson;
      setActivePaymentModal({
        isOpen: Boolean(modalState.isOpen),
        method: modalState.method === 'promptpay' ? 'promptpay' : 'cash',
        totalDue: Number(modalState.totalDue) || 0,
        cashReceived: modalState.cashReceived ? Number(modalState.cashReceived) : undefined,
        change: modalState.change ? Number(modalState.change) : undefined,
      });
    }
  };

  // Unified Event Handler for BroadcastChannel, StorageEvent, and Window postMessage
  useEffect(() => {
    const handleIncomingEvent = (type: string, payload: any) => {
      if (type === 'CART_UPDATE') {
        if (payload?.cart !== undefined) {
          updateCartSafely(payload.cart);
        }
        if (payload?.discount !== undefined) {
          setDisplayDiscount(payload.discount);
        }
        if (payload?.discountType) {
          setDisplayDiscountType(payload.discountType);
        }
      } else if (type === 'PAYMENT_MODAL_STATE') {
        if (payload) {
          updateModalSafely(payload);
        }
      } else if (type === 'ORDER_COMPLETED') {
        if (payload?.order) {
          setLastCompletedOrder(payload.order);
          setShowThankYouBanner(true);
          updateModalSafely({ isOpen: false, method: 'cash', totalDue: 0 });
          try {
            confetti({
              particleCount: 120,
              spread: 80,
              origin: { y: 0.5 },
            });
          } catch {
            // ignore
          }
        }
      } else if (type === 'CLEAR_THANK_YOU') {
        setShowThankYouBanner(false);
        setLastCompletedOrder(null);
      }
    };

    // 1. Window postMessage Listener
    const handleWindowPostMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;
      const { type, payload } = event.data;
      if (
        type === 'CART_UPDATE' ||
        type === 'PAYMENT_MODAL_STATE' ||
        type === 'ORDER_COMPLETED' ||
        type === 'CLEAR_THANK_YOU'
      ) {
        handleIncomingEvent(type, payload);
      }
    };
    window.addEventListener('message', handleWindowPostMessage);

    // 2. BroadcastChannel
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('siampure_pos_customer_display');
      bc.onmessage = (event) => {
        const { type, payload } = event.data || {};
        handleIncomingEvent(type, payload);
      };
      // Send single initial handshake request on mount
      bc.postMessage({ type: 'REQUEST_CURRENT_STATE' });
      bc.postMessage({ type: 'CUSTOMER_DISPLAY_MOUNTED' });
    } catch (e) {
      console.warn('BroadcastChannel not supported:', e);
    }

    // 3. Initial ping to Opener & Parent frames (Single fire upon mount)
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'REQUEST_CURRENT_STATE' }, '*');
        window.opener.postMessage({ type: 'CUSTOMER_DISPLAY_MOUNTED' }, '*');
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'REQUEST_CURRENT_STATE' }, '*');
        window.parent.postMessage({ type: 'CUSTOMER_DISPLAY_MOUNTED' }, '*');
      }
    } catch {
      // ignore
    }

    // 4. CustomEvent listener (for same-window event dispatch)
    const handleCustomEvent = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { type, payload } = customEvent.detail || {};
      handleIncomingEvent(type, payload);
    };
    window.addEventListener('siampure_customer_event', handleCustomEvent);

    // 5. Storage event fallback (cross-tab sync)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'siampure_cart') {
        try {
          const newCart = e.newValue ? JSON.parse(e.newValue) : [];
          updateCartSafely(newCart);
        } catch (err) {
          console.error(err);
        }
      } else if (e.key === 'siampure_discount') {
        try {
          const d = e.newValue ? JSON.parse(e.newValue) : 0;
          setDisplayDiscount(d);
        } catch (err) {
          console.error(err);
        }
      } else if (e.key === 'siampure_discount_type') {
        if (e.newValue === 'percent' || e.newValue === 'amount') {
          setDisplayDiscountType(e.newValue);
        }
      } else if (e.key === 'siampure_active_payment_modal') {
        try {
          const modalState = e.newValue ? JSON.parse(e.newValue) : null;
          if (modalState) {
            updateModalSafely(modalState);
          }
        } catch (err) {
          console.error(err);
        }
      } else if (e.key === 'siampure_customer_payment_event') {
        try {
          const eventData = e.newValue ? JSON.parse(e.newValue) : null;
          if (eventData) {
            handleIncomingEvent(eventData.type, eventData);
          }
        } catch (err) {
          console.error(err);
        }
      }
    };
    window.addEventListener('storage', handleStorageChange);

    // 6. Light heartbeat poll (every 2.5s) to guard against stale state without causing flickers
    const heartbeatTimer = setInterval(() => {
      try {
        const savedCart = localStorage.getItem('siampure_cart');
        if (savedCart && savedCart !== cartJsonRef.current) {
          updateCartSafely(JSON.parse(savedCart));
        }
        const savedModal = localStorage.getItem('siampure_active_payment_modal');
        if (savedModal && savedModal !== modalJsonRef.current) {
          updateModalSafely(JSON.parse(savedModal));
        }
      } catch {
        // ignore
      }
    }, 2500);

    return () => {
      if (bc) bc.close();
      window.removeEventListener('message', handleWindowPostMessage);
      window.removeEventListener('siampure_customer_event', handleCustomEvent);
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(heartbeatTimer);
    };
  }, []);

  // When a new order completes in current session
  useEffect(() => {
    if (orders.length > 0) {
      const latestOrder = orders[0];
      const orderTime = new Date(latestOrder.createdAt).getTime();
      // If completed within last 4 seconds
      if (Date.now() - orderTime < 4000) {
        setLastCompletedOrder(latestOrder);
        setShowThankYouBanner(true);
      }
    }
  }, [orders]);

  // Auto-dismiss thank you banner after 10s
  useEffect(() => {
    if (showThankYouBanner) {
      const timer = setTimeout(() => {
        setShowThankYouBanner(false);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [showThankYouBanner]);

  // Generate PromptPay QR code ONLY when PromptPay payment modal is active
  const isPromptPayModalActive =
    activePaymentModal.isOpen && activePaymentModal.method === 'promptpay';
  const currentTotalDue = activePaymentModal.isOpen
    ? activePaymentModal.totalDue
    : displayTotals.total;

  useEffect(() => {
    if (!isPromptPayModalActive) {
      setQrDataUrl('');
      return;
    }

    let isCancelled = false;
    const generateQr = async () => {
      try {
        const promptPayId = settings.promptPayId || '0812345678';
        const payload = generatePromptPayPayload(
          promptPayId,
          currentTotalDue > 0 ? currentTotalDue : undefined
        );

        const url = await QRCode.toDataURL(payload, {
          width: 360,
          margin: 2,
          color: {
            dark: '#002B49',
            light: '#FFFFFF',
          },
          errorCorrectionLevel: 'M',
        });

        if (!isCancelled) {
          setQrDataUrl(url);
        }
      } catch (err) {
        console.error('Failed to generate PromptPay QR:', err);
      }
    };

    generateQr();

    return () => {
      isCancelled = true;
    };
  }, [isPromptPayModalActive, settings.promptPayId, currentTotalDue]);

  // PromptPay countdown timer
  useEffect(() => {
    if (!isPromptPayModalActive) return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 120));
    }, 1000);
    return () => clearInterval(timer);
  }, [isPromptPayModalActive]);

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(console.error);
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(console.error);
      setIsFullscreen(false);
    }
  };

  // Open secondary standalone window
  const openSecondaryWindow = () => {
    const url = `${window.location.origin}${window.location.pathname}?display=customer`;
    window.open(
      url,
      'siampure_pos_customer_window',
      'width=1024,height=768,menubar=no,toolbar=no,location=no,status=no,resizable=yes'
    );
  };

  return (
    <div
      id="siampure-customer-display"
      className="flex-1 w-full h-full bg-slate-50 text-slate-900 flex flex-col overflow-hidden relative font-sans selection:bg-amber-400 selection:text-slate-950"
    >
      {/* 1. TOP HEADER - CLEAN WHITE MODE */}
      <header className="px-6 py-3.5 bg-white border-b border-slate-200/90 flex items-center justify-between shrink-0 shadow-xs z-20">
        {/* Store Brand & Info */}
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-amber-500 text-slate-950 flex items-center justify-center font-black shadow-sm">
            <Store className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-black tracking-tight text-slate-900">
                {settings.storeName}
              </h1>
              <span className="text-[11px] font-bold tracking-wide px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                จอแสดงผลลูกค้า
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              {settings.branchName} • แคชเชียร์: {settings.cashierName}
            </p>
          </div>
        </div>

        {/* Live Clock & Screen Controls */}
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex flex-col text-right">
            <div className="text-sm font-black font-mono text-amber-700 flex items-center justify-end gap-1.5">
              <Clock className="w-4 h-4 text-amber-600" />
              <span>{currentTime}</span>
            </div>
            <span className="text-[11px] text-slate-500 font-medium">{currentDate}</span>
          </div>

          <div className="flex items-center gap-2">
            {!isStandaloneWindow && (
              <button
                type="button"
                onClick={openSecondaryWindow}
                className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 border border-slate-200 transition-colors"
                title="เปิดจอฝั่งลูกค้าในหน้าต่างใหม่ (แยก 2 จอ)"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 border border-slate-200 transition-colors"
              title="สลับโหมดเต็มหน้าจอ (Fullscreen)"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            {!isStandaloneWindow && (
              <button
                type="button"
                onClick={() => setActiveTab('pos')}
                className="flex items-center gap-1 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 border border-slate-200 text-xs font-bold transition-colors"
              >
                <span>กลับหน้าร้าน</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 2. MAIN DISPLAY BODY */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden relative">
        {/* CASE A: IDLE / WELCOME STATE (Cart is empty & no active payment) */}
        {displayCart.length === 0 && !showThankYouBanner && (
          <div className="flex-1 flex flex-col lg:flex-row items-center justify-between p-6 sm:p-12 overflow-y-auto gap-8 bg-slate-50">
            {/* Left Hero Welcome */}
            <div className="flex-1 space-y-6 max-w-xl text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-100 border border-amber-300 text-amber-900 text-xs font-bold shadow-2xs">
                <Sparkles className="w-4 h-4 text-amber-600" />
                <span>ยินดีต้อนรับสู่ {settings.storeName}</span>
              </div>

              <h2 className="text-3xl sm:text-5xl font-black text-slate-900 tracking-tight leading-tight">
                พร้อมเสิร์ฟความอร่อย <br />
                <span className="text-amber-600">
                  เครื่องดื่ม & เบเกอรี่สดใหม่
                </span>
              </h2>

              <p className="text-slate-600 text-sm sm:text-base leading-relaxed">
                เชิญสั่งรายการเครื่องดื่ม กาแฟสด และเบเกอรี่ได้ที่เคาน์เตอร์ <br className="hidden sm:inline" />
                หน้าจอจะแสดงรายการสินค้าและยอดเงินชำระแบบเรียลไทม์
              </p>

              {/* Store Service Badges */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
                <div className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-xs">
                  <span className="text-xs text-slate-500 block">ระบบคิดเงิน</span>
                  <span className="text-sm font-bold text-slate-900">Real-time Live Display</span>
                </div>
                {settings.vatEnabled && <div className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-xs">
                  <span className="text-xs text-slate-500 block">อัตราภาษี</span>
                  <span className="text-sm font-bold text-slate-900 font-mono">
                    VAT {settings.vatRate}% ({settings.vatType === 'included' ? 'รวมในราคา' : 'แยกนอก'})
                  </span>
                </div>}
                <div className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-xs col-span-2 sm:col-span-1">
                  <span className="text-xs text-slate-500 block">การชำระเงิน</span>
                  <span className="text-sm font-bold text-amber-700">เงินสด & พร้อมเพย์</span>
                </div>
              </div>
            </div>

            {/* Right: Friendly Store Greeting Card (NO QR CODE when idle) */}
            <div className="bg-white border border-slate-200/90 rounded-3xl p-8 shadow-sm flex flex-col items-center max-w-sm w-full text-center space-y-5">
              <div className="w-20 h-20 rounded-3xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shadow-xs">
                <Coffee className="w-10 h-10" />
              </div>

              <div className="space-y-1.5">
                <h3 className="text-lg font-black text-slate-900">
                  {settings.storeName}
                </h3>
                <p className="text-xs text-slate-500">
                  {settings.storeAddress || 'คัดสรรวัตถุดิบคุณภาพเพื่อรสชาติที่ดีที่สุด'}
                </p>
              </div>

              <div className="w-full bg-slate-50 p-4 rounded-2xl border border-slate-200/80 space-y-2 text-left">
                <div className="flex items-center gap-2 text-xs text-slate-700">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>สั่งทำสดใหม่ทุกแก้วตามสั่ง</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-700">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>รองรับส่วนลดคูปอง & โปรโมชั่น</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-700">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>มีใบเสร็จรับเงินครบถ้วน</span>
                </div>
              </div>

              <div className="text-xs text-amber-800 bg-amber-50/80 px-4 py-2 rounded-xl border border-amber-200/80 font-medium">
                ✨ สั่งรายการได้ที่พนักงานแคชเชียร์
              </div>
            </div>
          </div>
        )}

        {/* CASE B: ACTIVE CART (Items in cart) */}
        {displayCart.length > 0 && (
          <>
            {/* Left Pane: Items List - Clean White Cards */}
            <div className="flex-1 flex flex-col min-h-0 bg-slate-50 border-r border-slate-200">
              {/* Table Header */}
              <div className="px-6 py-3.5 bg-white border-b border-slate-200 flex items-center justify-between text-xs font-bold text-slate-600 uppercase tracking-wider shadow-2xs">
                <div className="flex items-center gap-2 text-slate-900">
                  <ShoppingBag className="w-4 h-4 text-amber-600" />
                  <span>รายการสินค้า ({displayTotals.itemCount} ชิ้น)</span>
                </div>
                <div className="grid grid-cols-12 gap-4 text-right w-1/2">
                  <span className="col-span-4">ราคา/หน่วย</span>
                  <span className="col-span-3 text-center">จำนวน</span>
                  <span className="col-span-5">รวมเงิน</span>
                </div>
              </div>

              {/* Items List Scroll */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 custom-scrollbar">
                {displayCart.map((item, idx) => (
                  <div
                    key={`${item.product.id}-${idx}`}
                    className="flex items-center justify-between p-3.5 sm:p-4 rounded-2xl bg-white hover:border-slate-300 border border-slate-200/90 transition-all shadow-xs"
                  >
                    {/* Item Info */}
                    <div className="flex items-center gap-3.5 min-w-0 flex-1 pr-4">
                      <img
                        src={item.product.image}
                        alt={item.product.name}
                        className="w-14 h-14 rounded-xl object-cover border border-slate-200 shrink-0 bg-slate-100"
                        referrerPolicy="no-referrer"
                      />
                      <div className="min-w-0">
                        <h3 className="text-base font-bold text-slate-900 tracking-tight truncate">
                          {item.product.name}
                        </h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-slate-500 font-mono">
                            SKU: {item.product.sku}
                          </span>
                          <span className="text-xs text-slate-500">
                            • {item.product.unit}
                          </span>
                        </div>
                        {item.note && (
                          <div className="mt-1 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold">
                            <span>📝</span>
                            <span>{item.note}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Pricing & Qty Columns */}
                    <div className="grid grid-cols-12 gap-4 items-center text-right w-1/2 shrink-0">
                      <div className="col-span-4 text-sm font-mono text-slate-600">
                        {formatCurrency(item.product.price, settings.currencySymbol, settings.decimalPlaces)}
                      </div>
                      <div className="col-span-3 text-center">
                        <span className="inline-block px-3 py-1 rounded-xl bg-amber-500 text-slate-950 font-black text-sm font-mono shadow-xs">
                          x{item.quantity}
                        </span>
                      </div>
                      <div className="col-span-5 text-base sm:text-lg font-black text-slate-950 font-mono">
                        {formatCurrency(item.product.price * item.quantity, settings.currencySymbol, settings.decimalPlaces)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Pane: Summary & Status (NO QR CODE yet if payment not chosen) */}
            <div className="w-full lg:w-[420px] xl:w-[460px] bg-white p-6 flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-slate-200 shadow-xs shrink-0 overflow-y-auto">
              <div className="space-y-5">
                <div className="border-b border-slate-200 pb-3 flex items-center justify-between">
                  <h2 className="text-base font-black text-slate-900 tracking-tight">สรุปยอดคำสั่งซื้อ</h2>
                  <span className="text-xs text-amber-900 font-bold bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-300">
                    Live Calculation
                  </span>
                </div>

                {/* Subtotals & Discounts Breakdown */}
                <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200 text-sm">
                  {/* 1. Subtotal */}
                  <div className="flex justify-between items-center text-slate-700">
                    <span className="font-medium">ยอดรวมสินค้า ({displayTotals.itemCount} ชิ้น):</span>
                    <span className="font-mono text-slate-900 font-bold text-base">
                      {formatCurrency(displayTotals.subtotal, settings.currencySymbol, settings.decimalPlaces)}
                    </span>
                  </div>

                  {/* 2. Discount / Coupon */}
                  <div className="flex justify-between items-center py-2 border-t border-b border-slate-200">
                    <span className="font-medium text-slate-700 flex items-center gap-1.5">
                      <span>ส่วนลด / คูปอง:</span>
                    </span>
                    {displayTotals.discountAmount > 0 ? (
                      <span className="font-mono font-bold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-lg border border-emerald-300 flex items-center gap-1">
                        <span>-{formatCurrency(displayTotals.discountAmount, settings.currencySymbol, settings.decimalPlaces)}</span>
                        <span className="text-xs text-emerald-700 font-normal">
                          ({displayDiscountType === 'percent' ? `${displayDiscount}%` : 'ส่วนลดเงินสด'})
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-500 text-xs font-medium bg-white px-2.5 py-0.5 rounded-lg border border-slate-200">
                        ไม่มีส่วนลด
                      </span>
                    )}
                  </div>

                  {/* 3. VAT */}
                  {settings.vatEnabled && <div className="flex justify-between items-center text-xs text-slate-500">
                    <span>
                      ภาษีมูลค่าเพิ่ม (VAT {settings.vatRate}% {settings.vatType === 'included' ? 'รวมในราคา' : 'คิดแยกนอก'}):
                    </span>
                    <span className="font-mono text-slate-700 font-semibold">
                      {formatCurrency(displayTotals.vatAmount, settings.currencySymbol, settings.decimalPlaces)}
                    </span>
                  </div>}
                </div>

                {/* Grand Total Highlight Box */}
                <div className="bg-gradient-to-br from-amber-500 to-amber-600 p-5 rounded-3xl text-slate-950 shadow-md shadow-amber-500/20 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase tracking-wider text-slate-900">
                      ยอดชำระสุทธิ (Net Total)
                    </span>
                    <span className="text-[11px] font-bold bg-white/30 px-2.5 py-0.5 rounded-full text-slate-950">
                      {displayTotals.itemCount} ชิ้น
                    </span>
                  </div>
                  <div className="text-3xl sm:text-4xl font-black tracking-tight font-mono">
                    {formatCurrency(displayTotals.total, settings.currencySymbol, settings.decimalPlaces)}
                  </div>
                </div>

                {/* Status Box: Awaiting Cashier Payment Selection (NO QR CODE HERE) */}
                <div className="bg-slate-50 border border-slate-200 rounded-3xl p-5 text-center space-y-3.5 shadow-xs">
                  <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto border border-amber-300">
                    <CreditCard className="w-6 h-6" />
                  </div>

                  <div className="space-y-1">
                    <h3 className="text-sm font-black text-slate-900">
                      รอแคชเชียร์เลือกวิธีชำระเงิน
                    </h3>
                    <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
                      กรุณาตรวจสอบรายการสินค้าและยอดเงินให้ถูกต้อง เมื่อแคชเชียร์เริ่มรับชำระ หน้าจอจะแสดง QR Code หรือสรุปการรับเงินสดโดยอัตโนมัติ
                    </p>
                  </div>

                  <div className="flex items-center justify-center gap-2 pt-1">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-semibold">
                      <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                      <span>เงินสด</span>
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-semibold">
                      <QrCode className="w-3.5 h-3.5 text-blue-600" />
                      <span>PromptPay QR</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Footer Note */}
              <div className="pt-4 text-center text-xs text-slate-500">
                {settings.receiptFooterMessage || 'ขอบคุณที่ใช้บริการ Siam Pure Cafe & Bistro'}
              </div>
            </div>
          </>
        )}
      </div>

      {/* 3. PROMPTPAY QR CODE MODAL - APPEARS ONLY WHEN CASHIER CHOOSES PROMPTPAY */}
      {isPromptPayModalActive && (
        <div
          id="customer-promptpay-modal"
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in"
        >
          <div className="bg-white border-2 border-amber-500 rounded-3xl max-w-4xl w-full p-4 sm:p-6 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden relative text-slate-900">
            {/* PromptPay Header */}
            <div className="w-full bg-[#003B71] text-white py-3 px-5 rounded-2xl font-bold text-sm tracking-wider flex items-center justify-between shadow-sm shrink-0 mb-4">
              <div className="flex items-center gap-2.5">
                <QrCode className="w-5 h-5 text-amber-300" />
                <span>THAI QR PAYMENT • พร้อมเพย์</span>
              </div>
              <span className="text-xs bg-white/20 px-3 py-1 rounded-full font-mono text-amber-200 font-bold">
                นับถอยหลัง {countdown}s
              </span>
            </div>

            {/* Modal Body: Split view (Items List on left, QR on right) */}
            <div className="flex-1 flex flex-col md:flex-row gap-5 min-h-0 overflow-y-auto">
              {/* Left Column: Order Items & Breakdown */}
              <div className="flex-1 flex flex-col min-h-0 bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <ShoppingBag className="w-4 h-4 text-amber-600" />
                    <span>รายการสินค้าในบิล ({displayTotals.itemCount} ชิ้น)</span>
                  </span>
                </div>

                {/* Items scroll */}
                <div className="flex-1 overflow-y-auto space-y-2 max-h-52 md:max-h-64 pr-1 custom-scrollbar">
                  {displayCart.map((item, idx) => (
                    <div
                      key={`modal-item-${item.product.id}-${idx}`}
                      className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200 text-xs shadow-2xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <img
                          src={item.product.image}
                          alt={item.product.name}
                          className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0 bg-slate-100"
                          referrerPolicy="no-referrer"
                        />
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 truncate">{item.product.name}</div>
                          {item.note && (
                            <div className="text-[11px] text-amber-800 truncate">
                              📝 {item.note}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 pl-2">
                        <span className="text-slate-500 font-mono">x{item.quantity}</span>
                        <div className="font-bold font-mono text-slate-900">
                          {formatCurrency(item.product.price * item.quantity, settings.currencySymbol, settings.decimalPlaces)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Financial Summary */}
                <div className="border-t border-slate-200 pt-2.5 space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>ยอดรวมสินค้า:</span>
                    <span className="font-mono text-slate-900 font-bold">
                      {formatCurrency(displayTotals.subtotal, settings.currencySymbol, settings.decimalPlaces)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center py-1 border-t border-b border-slate-200">
                    <span className="text-slate-600">ส่วนลด / คูปอง:</span>
                    {displayTotals.discountAmount > 0 ? (
                      <span className="font-mono font-bold text-emerald-700">
                        -{formatCurrency(displayTotals.discountAmount, settings.currencySymbol, settings.decimalPlaces)}
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[11px] bg-white px-2 py-0.5 rounded border border-slate-200">
                        ไม่มีส่วนลด
                      </span>
                    )}
                  </div>

                  {settings.vatEnabled && <div className="flex justify-between text-slate-500 text-[11px]">
                    <span>ภาษีมูลค่าเพิ่ม (VAT {settings.vatRate}% {settings.vatType === 'included' ? 'รวมในราคา' : 'คิดแยกนอก'}):</span>
                    <span className="font-mono text-slate-700">
                      {formatCurrency(displayTotals.vatAmount, settings.currencySymbol, settings.decimalPlaces)}
                    </span>
                  </div>}
                </div>
              </div>

              {/* Right Column: PromptPay QR Code & Amount */}
              <div className="w-full md:w-[330px] flex flex-col items-center justify-between bg-white p-5 rounded-2xl border border-slate-200 text-center space-y-3.5 shrink-0 shadow-xs">
                <div>
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                    ยอดชำระสุทธิ (Net Total)
                  </span>
                  <div className="text-3xl font-black text-amber-600 font-mono mt-0.5">
                    {formatCurrency(currentTotalDue, settings.currencySymbol, settings.decimalPlaces)}
                  </div>
                </div>

                {/* Big Scannable QR Code */}
                <div className="bg-white p-3 rounded-2xl shadow-md border-2 border-slate-900 relative">
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="PromptPay QR Code"
                      className="w-48 h-48 object-contain rounded-lg"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-48 h-48 flex items-center justify-center text-slate-400">
                      <QrCode className="w-16 h-16 animate-pulse" />
                    </div>
                  )}
                </div>

                {/* PromptPay Details */}
                <div className="space-y-0.5 bg-slate-50 py-2.5 px-3.5 rounded-xl border border-slate-200 w-full text-xs">
                  <div className="text-slate-700">
                    ร้านค้า: <span className="text-slate-900 font-bold">{settings.storeName}</span>
                  </div>
                  <div className="text-slate-600">
                    PromptPay: <span className="font-mono text-amber-700 font-bold">{settings.promptPayId}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-bold">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                  <span>กรุณาสแกนจ่ายผ่าน Mobile Banking ทุกธนาคาร</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. CASH PAYMENT MODAL - APPEARS WHEN CASHIER RECEIVES CASH */}
      {activePaymentModal.isOpen && activePaymentModal.method === 'cash' && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in">
          <div className="bg-white border-2 border-emerald-500 rounded-3xl max-w-3xl w-full p-4 sm:p-6 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center border border-emerald-300">
                  <Banknote className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">กำลังชำระด้วยเงินสด (Cash Payment)</h3>
                  <p className="text-xs text-slate-500">แคชเชียร์กำลังรับเงินและคำนวณเงินทอน</p>
                </div>
              </div>
            </div>

            <div className="flex-1 flex flex-col md:flex-row gap-5 min-h-0 overflow-y-auto">
              {/* Left Column: Order Items Summary */}
              <div className="flex-1 bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3 min-h-0 flex flex-col">
                <span className="text-xs font-bold text-slate-800">
                  รายการสินค้าในบิล ({displayTotals.itemCount} ชิ้น)
                </span>

                <div className="flex-1 overflow-y-auto space-y-2 max-h-48 md:max-h-56 pr-1 custom-scrollbar">
                  {displayCart.map((item, idx) => (
                    <div
                      key={`cash-item-${item.product.id}-${idx}`}
                      className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200 text-xs shadow-2xs"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <img
                          src={item.product.image}
                          alt={item.product.name}
                          className="w-9 h-9 rounded-lg object-cover border border-slate-200 shrink-0 bg-slate-100"
                          referrerPolicy="no-referrer"
                        />
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 truncate">{item.product.name}</div>
                          {item.note && (
                            <div className="text-[10px] text-amber-800 truncate">📝 {item.note}</div>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 pl-2">
                        <span className="text-slate-500 font-mono">x{item.quantity}</span>
                        <div className="font-bold font-mono text-slate-900">
                          {formatCurrency(item.product.price * item.quantity, settings.currencySymbol, settings.decimalPlaces)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-slate-200 pt-2 space-y-1 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>ยอดรวมสินค้า:</span>
                    <span className="font-mono text-slate-900 font-bold">
                      {formatCurrency(displayTotals.subtotal, settings.currencySymbol, settings.decimalPlaces)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>ส่วนลด / คูปอง:</span>
                    {displayTotals.discountAmount > 0 ? (
                      <span className="font-mono font-bold text-emerald-700">
                        -{formatCurrency(displayTotals.discountAmount, settings.currencySymbol, settings.decimalPlaces)}
                      </span>
                    ) : (
                      <span className="text-slate-500">ไม่มีส่วนลด</span>
                    )}
                  </div>
                  {settings.vatEnabled && <div className="flex justify-between text-slate-500 text-[11px]">
                    <span>ภาษีมูลค่าเพิ่ม (VAT {settings.vatRate}% {settings.vatType === 'included' ? 'รวมในราคา' : 'คิดแยกนอก'}):</span>
                    <span className="font-mono text-slate-700">
                      {formatCurrency(displayTotals.vatAmount, settings.currencySymbol, settings.decimalPlaces)}
                    </span>
                  </div>}
                </div>
              </div>

              {/* Right Column: Cash Received & Change */}
              <div className="w-full md:w-[320px] bg-slate-50 p-5 rounded-2xl border border-slate-200 flex flex-col justify-between space-y-4 shrink-0">
                <div>
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                    ยอดชำระสุทธิ (Net Total)
                  </span>
                  <div className="text-3xl font-black text-slate-900 font-mono mt-0.5">
                    {formatCurrency(activePaymentModal.totalDue, settings.currencySymbol, settings.decimalPlaces)}
                  </div>
                </div>

                <div className="w-full bg-white p-4 rounded-2xl border border-slate-200 space-y-3 shadow-xs">
                  <div className="flex justify-between items-center text-sm text-slate-700">
                    <span>รับเงินสดมา:</span>
                    <span className="font-mono text-xl text-slate-900 font-black">
                      {formatCurrency(activePaymentModal.cashReceived || 0, settings.currencySymbol, settings.decimalPlaces)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-base font-bold text-emerald-700 border-t border-slate-200 pt-3">
                    <span>เงินทอน:</span>
                    <span className="font-mono text-2xl font-black">
                      {formatCurrency(activePaymentModal.change || 0, settings.currencySymbol, settings.decimalPlaces)}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-slate-500 text-center font-medium">
                  กรุณารับเงินทอนและใบเสร็จรับเงิน
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. THANK YOU & RECEIPT SUMMARY BANNER */}
      {showThankYouBanner && lastCompletedOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in zoom-in-95">
          <div className="bg-white border-2 border-amber-500 rounded-3xl max-w-xl w-full p-6 sm:p-8 shadow-2xl flex flex-col items-center text-center space-y-5 relative max-h-[92vh] overflow-y-auto text-slate-900">
            <button
              type="button"
              onClick={() => setShowThankYouBanner(false)}
              className="absolute right-4 top-4 p-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-18 h-18 rounded-3xl bg-emerald-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <div className="space-y-1">
              <h2 className="text-2xl sm:text-3xl font-black text-slate-900">
                ชำระเงินเรียบร้อยแล้ว
              </h2>
              <p className="text-sm text-amber-700 font-bold">
                ขอบคุณที่ใช้บริการ {settings.storeName}!
              </p>
            </div>

            {/* Order Details Card */}
            <div className="w-full bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2.5 text-left text-xs sm:text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">เลขที่ใบเสร็จ:</span>
                <span className="font-mono font-bold text-slate-900">{lastCompletedOrder.orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">จำนวนสินค้า:</span>
                <span className="font-mono text-slate-700">{lastCompletedOrder.items.length} รายการ</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">ยอดรวมสินค้า:</span>
                <span className="font-mono text-slate-700">
                  {formatCurrency(lastCompletedOrder.subtotal, settings.currencySymbol, settings.decimalPlaces)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">ส่วนลด / คูปอง:</span>
                {lastCompletedOrder.discountAmount > 0 ? (
                  <span className="font-mono font-bold text-emerald-700">
                    -{formatCurrency(lastCompletedOrder.discountAmount, settings.currencySymbol, settings.decimalPlaces)}
                  </span>
                ) : (
                  <span className="text-slate-500">ไม่มีส่วนลด</span>
                )}
              </div>
              {lastCompletedOrder.vatRate > 0 && <div className="flex justify-between">
                <span className="text-slate-500">
                  ภาษีมูลค่าเพิ่ม (VAT {lastCompletedOrder.vatRate}% {lastCompletedOrder.isVatIncluded ? 'รวมในราคา' : 'คิดแยกนอก'}):
                </span>
                <span className="font-mono text-slate-700">
                  {formatCurrency(lastCompletedOrder.vatAmount, settings.currencySymbol, settings.decimalPlaces)}
                </span>
              </div>}
              <div className="flex justify-between border-t border-slate-200 pt-2">
                <span className="text-slate-700 font-bold">ยอดชำระสุทธิ:</span>
                <span className="font-mono font-black text-amber-700 text-base">
                  {formatCurrency(lastCompletedOrder.total, settings.currencySymbol, settings.decimalPlaces)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">วิธีชำระเงิน:</span>
                <span className="font-bold text-slate-800">
                  {lastCompletedOrder.paymentMethod === 'cash' ? 'เงินสด (Cash)' : 'PromptPay QR'}
                </span>
              </div>

              {lastCompletedOrder.paymentMethod === 'cash' &&
                lastCompletedOrder.change !== undefined &&
                lastCompletedOrder.change > 0 && (
                  <div className="flex justify-between border-t border-slate-200 pt-2 text-emerald-700 font-bold">
                    <span>เงินทอน:</span>
                    <span className="font-mono text-lg">
                      {formatCurrency(lastCompletedOrder.change, settings.currencySymbol, settings.decimalPlaces)}
                    </span>
                  </div>
                )}
            </div>

            <button
              type="button"
              onClick={() => setShowThankYouBanner(false)}
              className="w-full py-3.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm shadow-md shadow-amber-500/20 transition-all cursor-pointer"
            >
              ยินดีให้บริการครับ / ค่ะ
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
