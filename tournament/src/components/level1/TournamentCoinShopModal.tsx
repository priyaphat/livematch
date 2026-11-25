import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ClipboardList,
  Coins,
  History,
  LoaderCircle,
  Upload,
  X,
} from 'lucide-react';
import QRCode from 'qrcode';
import { apiFetch } from '../../services/api';

interface CoinPackage {
  id: string;
  name: string;
  priceThb: number;
  coins: number;
  bonusText?: string;
}

interface SubscriptionPackage {
  id: string;
  name: string;
  priceThb: number;
  totalSessions: number;
  durationDays: number;
  bonusText?: string;
}

interface CoinOrder {
  id: string;
  productType: 'coin' | 'subscription';
  packageId: string;
  packageName: string;
  priceThb: number;
  coins: number;
  totalSessions: number;
  status: string;
  note?: string;
  createdAt: string;
}

interface CoinLedgerItem {
  id: number;
  delta: number;
  balance: number;
  reason: string;
  note?: string;
  createdAt: string;
}

interface CoinShopPayload {
  coinBalance: number;
  packages: CoinPackage[];
  subscriptionPackages: SubscriptionPackage[];
  subscriptionEligibility?: {
    canPurchase: boolean;
    reason?: string;
    renewal?: boolean;
    estimatedStartDate?: string;
    currentEndDate?: string;
  };
  paymentQrImage?: string;
  promptPayReceiverName?: string;
  promptPayPayloads: Record<string, string>;
  subscriptionPromptPayPayloads: Record<string, string>;
  orders: CoinOrder[];
  coinLedger: CoinLedgerItem[];
}

const emptyPayload: CoinShopPayload = {
  coinBalance: 0,
  packages: [],
  subscriptionPackages: [],
  promptPayPayloads: {},
  subscriptionPromptPayPayloads: {},
  orders: [],
  coinLedger: [],
};

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('อ่านไฟล์สลิปไม่สำเร็จ'));
    reader.readAsDataURL(file);
  });
}

function orderStatusLabel(status: string) {
  if (status === 'approved') return 'อนุมัติแล้ว';
  if (status === 'rejected') return 'ไม่อนุมัติ';
  return 'รอตรวจสอบ';
}

function orderStatusClass(status: string) {
  if (status === 'approved') return 'bg-[#E8F5EE] text-[#156143] dark:bg-[#123A2B] dark:text-[#86E0B4]';
  if (status === 'rejected') return 'bg-[#FEF2F2] text-[#B91C1C] dark:bg-[#361215] dark:text-[#FCA5A5]';
  return 'bg-[#FFF7E6] text-[#9A5A08] dark:bg-[#382509] dark:text-[#FCD38D]';
}

function ledgerReason(item: CoinLedgerItem) {
  const labels: Record<string, string> = {
    coin_purchase: 'เติม Coin',
    tournament_capacity: 'ใช้ Coin สำหรับระบบจัดแข่ง',
    create_session: 'สร้าง Session',
    backoffice_adjustment: 'ปรับยอดโดย Backoffice',
  };
  return labels[item.reason] || item.note || item.reason || 'รายการ Coin';
}

export const TournamentCoinShopModal: React.FC<{
  onClose: () => void;
  onUpdated: () => Promise<void>;
}> = ({ onClose, onUpdated }) => {
  const [mode, setMode] = useState<'shop' | 'orders' | 'history'>('shop');
  const [productType, setProductType] = useState<'coin' | 'subscription'>('coin');
  const [payload, setPayload] = useState<CoinShopPayload>(emptyPayload);
  const [selectedCoinId, setSelectedCoinId] = useState('');
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState('');
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState('');
  const [paymentQr, setPaymentQr] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const next = await apiFetch<CoinShopPayload>('/api/coin-shop');
      setPayload({ ...emptyPayload, ...next });
      setSelectedCoinId((current) => current || next.packages?.[0]?.id || '');
      setSelectedSubscriptionId((current) => current || next.subscriptionPackages?.[0]?.id || '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'โหลดข้อมูลเติม Coin ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!slipFile) {
      setSlipPreview('');
      return;
    }
    const url = URL.createObjectURL(slipFile);
    setSlipPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [slipFile]);

  const selectedPackage = useMemo(() => {
    if (productType === 'subscription') {
      return payload.subscriptionPackages.find((item) => item.id === selectedSubscriptionId) || null;
    }
    return payload.packages.find((item) => item.id === selectedCoinId) || null;
  }, [payload.packages, payload.subscriptionPackages, productType, selectedCoinId, selectedSubscriptionId]);

  const promptPayPayload = productType === 'subscription'
    ? payload.subscriptionPromptPayPayloads?.[selectedSubscriptionId] || ''
    : payload.promptPayPayloads?.[selectedCoinId] || '';

  useEffect(() => {
    let active = true;
    if (!promptPayPayload) {
      setPaymentQr('');
      return;
    }
    QRCode.toDataURL(promptPayPayload, {
      margin: 1,
      width: 256,
      color: { dark: '#142642', light: '#FFFFFF' },
    }).then((url) => {
      if (active) setPaymentQr(url);
    }).catch(() => {
      if (active) setPaymentQr('');
    });
    return () => {
      active = false;
    };
  }, [promptPayPayload]);

  const canSubmit = Boolean(
    selectedPackage &&
    slipFile &&
    (paymentQr || payload.paymentQrImage) &&
    !submitting &&
    (productType === 'coin' || payload.subscriptionEligibility?.canPurchase !== false)
  );

  const submitOrder = async () => {
    if (!canSubmit || !selectedPackage || !slipFile) return;
    if (slipFile.size > 1_800_000) {
      setError('ไฟล์สลิปต้องมีขนาดไม่เกิน 1.8 MB');
      return;
    }
    setSubmitting(true);
    setError('');
    setMessage('กำลังส่งสลิปและตรวจสอบ กรุณารอสักครู่…');
    try {
      const slipImage = await fileToDataUrl(slipFile);
      await apiFetch('/api/coin-orders', {
        method: 'POST',
        body: JSON.stringify({ productType, packageId: selectedPackage.id, slipImage }),
      });
      setSlipFile(null);
      setMessage('ส่งรายการชำระเงินแล้ว ระบบกำลังอัปเดตสถานะ');
      await load();
      await onUpdated();
      setMode('orders');
    } catch (submitError) {
      setMessage('');
      setError(submitError instanceof Error ? submitError.message : 'ส่งสลิปไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  const tabs = [
    { id: 'shop' as const, label: 'ซื้อแพ็กเกจ', icon: Coins },
    { id: 'orders' as const, label: 'รายการชำระ', icon: ClipboardList },
    { id: 'history' as const, label: 'ประวัติ Coin', icon: History },
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/55 backdrop-blur-sm sm:place-items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="tournament-coin-shop-title">
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#F7F6F2] text-[#141D2B] shadow-2xl dark:bg-[#0B121C] dark:text-[#F3F5F8] sm:h-auto sm:max-h-[92vh] sm:max-w-6xl sm:rounded-2xl sm:border sm:border-[#E2DFD5] dark:sm:border-[#25354C]">
        <header className="shrink-0 border-b border-[#E2DFD5] bg-white px-4 py-4 dark:border-[#25354C] dark:bg-[#131E2E] sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#D99116] text-white"><Coins className="h-5 w-5" /></span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#156143]">Tournament Wallet</p>
                <h2 id="tournament-coin-shop-title" className="truncate text-xl font-bold">Coin และแพ็กเกจ</h2>
                <p className="mt-0.5 text-xs text-[#525C6B] dark:text-[#9AA8BC]">เลือกแพ็กเกจ ชำระเงิน และส่งสลิปในที่เดียว</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden rounded-lg bg-[#F7F6F2] px-3 py-2 text-right dark:bg-[#0B121C] sm:block">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#8A919C]">Coin คงเหลือ</p>
                <p className="font-mono text-lg font-bold tabular-nums">{payload.coinBalance.toLocaleString()}</p>
              </div>
              <button type="button" disabled={submitting} onClick={onClose} className="grid h-10 w-10 place-items-center rounded-lg border border-[#E2DFD5] text-[#525C6B] hover:bg-[#EFECE4] disabled:opacity-40 dark:border-[#25354C] dark:hover:bg-[#1B293D]" aria-label="ปิด modal"><X className="h-4 w-4" /></button>
            </div>
          </div>
          <nav className="mt-4 grid grid-cols-3 gap-1 rounded-lg bg-[#EFECE4] p-1 dark:bg-[#1B293D]" aria-label="เมนู Coin และแพ็กเกจ">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return <button key={tab.id} type="button" onClick={() => setMode(tab.id)} className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-md text-xs font-bold transition sm:text-sm ${mode === tab.id ? 'bg-white text-[#142642] shadow-sm dark:bg-[#25354C] dark:text-white' : 'text-[#667085]'}`}><Icon className="h-4 w-4" />{tab.label}</button>;
            })}
          </nav>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {loading && <div className="grid min-h-64 place-items-center"><LoaderCircle className="h-8 w-8 animate-spin text-[#156143]" /></div>}
          {!loading && error && <div role="alert" className="mb-4 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm font-semibold text-[#B91C1C] dark:border-[#5E2025] dark:bg-[#361215] dark:text-[#FCA5A5]">{error}</div>}

          {!loading && mode === 'shop' && (
            <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="min-w-0">
                <div className="mb-4 grid grid-cols-3 gap-2 text-center text-[11px] font-bold text-[#667085]">
                  {['เลือกแพ็กเกจ', 'สแกนจ่าย', 'ส่งสลิป'].map((label, index) => <div key={label} className="rounded-lg bg-white px-2 py-2 dark:bg-[#131E2E]"><span className="mr-1 text-[#156143]">{index + 1}</span>{label}</div>)}
                </div>
                <div className="rounded-xl border border-[#E2DFD5] bg-white p-3 dark:border-[#25354C] dark:bg-[#131E2E]">
                  <nav className="grid grid-cols-2 gap-1 rounded-lg bg-[#F7F6F2] p-1 dark:bg-[#0B121C]">
                    <button type="button" onClick={() => setProductType('coin')} className={`h-11 rounded-md text-sm font-bold ${productType === 'coin' ? 'bg-white text-[#142642] shadow-sm dark:bg-[#25354C] dark:text-white' : 'text-[#667085]'}`}>เติม Coin</button>
                    <button type="button" onClick={() => setProductType('subscription')} className={`h-11 rounded-md text-sm font-bold ${productType === 'subscription' ? 'bg-white text-[#142642] shadow-sm dark:bg-[#25354C] dark:text-white' : 'text-[#667085]'}`}>แพ็กเกจรายเดือน</button>
                  </nav>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {(productType === 'coin' ? payload.packages : payload.subscriptionPackages).map((item) => {
                      const selected = item.id === (productType === 'coin' ? selectedCoinId : selectedSubscriptionId);
                      const coinItem = item as CoinPackage;
                      const subscriptionItem = item as SubscriptionPackage;
                      return <button key={item.id} type="button" onClick={() => productType === 'coin' ? setSelectedCoinId(item.id) : setSelectedSubscriptionId(item.id)} className={`relative min-h-40 rounded-xl border p-4 text-left transition ${selected ? 'border-[#156143] bg-[#156143]/5 ring-2 ring-[#156143]/10' : 'border-[#E2DFD5] hover:border-[#B8B1A1] hover:bg-[#F7F6F2] dark:border-[#25354C] dark:hover:bg-[#1B293D]'}`}>
                        {selected && <span className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-[#156143] text-white"><Check className="h-3.5 w-3.5" /></span>}
                        <p className="pr-8 font-bold">{item.name}</p>
                        <p className="mt-3 font-mono text-2xl font-bold tabular-nums">฿{Number(item.priceThb || 0).toLocaleString()}</p>
                        <p className="mt-3 text-sm font-bold text-[#156143] dark:text-[#86E0B4]">{productType === 'coin' ? `รับ ${Number(coinItem.coins || 0).toLocaleString()} Coin` : `${Number(subscriptionItem.totalSessions || 0).toLocaleString()} Session · ${Number(subscriptionItem.durationDays || 0).toLocaleString()} วัน`}</p>
                        {item.bonusText && <span className="mt-2 inline-flex rounded-md bg-[#D99116]/10 px-2 py-1 text-[11px] font-bold text-[#9A5A08] dark:text-[#FCD38D]">{item.bonusText}</span>}
                      </button>;
                    })}
                  </div>
                  {(productType === 'coin' ? payload.packages : payload.subscriptionPackages).length === 0 && <p className="mt-3 rounded-lg bg-[#F7F6F2] p-5 text-center text-sm text-[#667085] dark:bg-[#0B121C]">ยังไม่มีแพ็กเกจเปิดขาย</p>}
                </div>
                {productType === 'subscription' && payload.subscriptionEligibility?.canPurchase === false && <p className="mt-3 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm font-semibold text-[#B91C1C] dark:border-[#5E2025] dark:bg-[#361215] dark:text-[#FCA5A5]">{payload.subscriptionEligibility.reason || 'ยังไม่สามารถซื้อแพ็กเกจรายเดือนได้'}</p>}
              </div>

              <aside className="h-max rounded-xl border border-[#E2DFD5] bg-white p-4 dark:border-[#25354C] dark:bg-[#131E2E] lg:sticky lg:top-0">
                <div className="flex items-start justify-between gap-3 border-b border-[#E2DFD5] pb-3 dark:border-[#25354C]">
                  <div><p className="text-xs font-bold text-[#8A919C]">ยอดชำระ</p><p className="mt-1 font-mono text-3xl font-bold tabular-nums">฿{Number(selectedPackage?.priceThb || 0).toLocaleString()}</p></div>
                  <span className="rounded-md bg-[#F7F6F2] px-2 py-1 text-xs font-bold text-[#667085] dark:bg-[#0B121C]">{productType === 'coin' ? 'Coin' : 'รายเดือน'}</span>
                </div>
                <p className="mt-3 font-bold">{selectedPackage?.name || 'กรุณาเลือกแพ็กเกจ'}</p>
                {payload.promptPayReceiverName && <p className="mt-1 text-xs text-[#667085]">ผู้รับเงิน: {payload.promptPayReceiverName}</p>}
                <div className="mt-4 grid min-h-52 place-items-center rounded-xl bg-[#F7F6F2] p-3 dark:bg-[#0B121C]">
                  {paymentQr ? <img src={paymentQr} alt="PromptPay QR ตามยอด" className="h-48 w-48 rounded-lg bg-white object-contain p-2" /> : payload.paymentQrImage ? <img src={payload.paymentQrImage} alt="QR ชำระเงินสำรอง" className="h-48 w-48 rounded-lg bg-white object-contain p-2" /> : <p className="max-w-48 text-center text-sm font-semibold text-[#667085]">Backoffice ยังไม่ได้ตั้ง PromptPay หรือ QR สำรอง</p>}
                </div>
                <label className="mt-4 flex min-h-20 cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed border-[#C2BCAC] px-3 text-center text-sm font-bold transition hover:border-[#156143] hover:bg-[#156143]/5 dark:border-[#3D5270]">
                  <Upload className="h-5 w-5 text-[#156143]" /><span>{slipFile ? 'เปลี่ยนรูปสลิป' : 'เลือกรูปสลิป'}</span>
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={submitting} onChange={(event) => setSlipFile(event.target.files?.[0] || null)} />
                </label>
                {slipPreview && <img src={slipPreview} alt="สลิปที่เลือก" className="mt-3 h-28 w-full rounded-lg border border-[#E2DFD5] bg-[#F7F6F2] object-contain dark:border-[#25354C] dark:bg-[#0B121C]" />}
                <button type="button" onClick={submitOrder} disabled={!canSubmit} className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#156143] px-4 font-bold text-white transition hover:bg-[#104D35] disabled:cursor-not-allowed disabled:opacity-40">{submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}{submitting ? 'กำลังส่งและตรวจสอบ…' : 'ส่งสลิปตรวจสอบ'}</button>
                {message && <p className="mt-3 rounded-lg bg-[#F7F6F2] px-3 py-2 text-sm font-semibold text-[#525C6B] dark:bg-[#0B121C] dark:text-[#9AA8BC]">{message}</p>}
              </aside>
            </section>
          )}

          {!loading && mode === 'orders' && <section className="mx-auto grid max-w-3xl gap-3">
            <div className="mb-1 flex items-end justify-between gap-3"><div><h3 className="text-lg font-bold">รายการชำระเงิน</h3><p className="mt-1 text-sm text-[#667085]">ตรวจสอบสถานะสลิปและสิทธิ์ที่ได้รับ</p></div><span className="rounded-md bg-white px-3 py-1 text-xs font-bold dark:bg-[#131E2E]">{payload.orders.length} รายการ</span></div>
            {payload.orders.map((order) => <article key={order.id} className="rounded-xl border border-[#E2DFD5] bg-white p-4 dark:border-[#25354C] dark:bg-[#131E2E]">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-bold">{order.packageName || order.packageId}</p><p className="mt-1 text-xs text-[#667085]">{order.createdAt} · {order.productType === 'subscription' ? 'แพ็กเกจรายเดือน' : 'เติม Coin'}</p></div><span className={`shrink-0 rounded-md px-2 py-1 text-xs font-bold ${orderStatusClass(order.status)}`}>{orderStatusLabel(order.status)}</span></div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3"><div className="rounded-lg bg-[#F7F6F2] p-3 dark:bg-[#0B121C]"><p className="text-[10px] font-bold text-[#8A919C]">ยอดชำระ</p><p className="mt-1 font-bold">฿{Number(order.priceThb || 0).toLocaleString()}</p></div><div className="rounded-lg bg-[#F7F6F2] p-3 dark:bg-[#0B121C]"><p className="text-[10px] font-bold text-[#8A919C]">ได้รับ</p><p className="mt-1 font-bold text-[#156143] dark:text-[#86E0B4]">{order.productType === 'subscription' ? `${Number(order.totalSessions || 0).toLocaleString()} Session` : `${Number(order.coins || 0).toLocaleString()} Coin`}</p></div><div className="col-span-2 rounded-lg bg-[#F7F6F2] p-3 dark:bg-[#0B121C] sm:col-span-1"><p className="text-[10px] font-bold text-[#8A919C]">เลขรายการ</p><p className="mt-1 truncate font-mono text-xs font-bold">{order.id}</p></div></div>
            </article>)}
            {payload.orders.length === 0 && <p className="rounded-xl bg-white p-8 text-center text-sm text-[#667085] dark:bg-[#131E2E]">ยังไม่มีรายการชำระเงิน</p>}
          </section>}

          {!loading && mode === 'history' && <section className="mx-auto grid max-w-3xl gap-3">
            <div className="mb-1 flex items-end justify-between gap-3"><div><h3 className="text-lg font-bold">ประวัติ Coin</h3><p className="mt-1 text-sm text-[#667085]">รายการเติมและใช้ Coin ของบัญชีนี้</p></div><span className="rounded-lg bg-[#D99116] px-3 py-2 text-sm font-bold text-white">คงเหลือ {payload.coinBalance.toLocaleString()}</span></div>
            {payload.coinLedger.map((item) => <article key={item.id} className="flex items-center justify-between gap-4 rounded-xl border border-[#E2DFD5] bg-white p-4 dark:border-[#25354C] dark:bg-[#131E2E]"><div className="min-w-0"><p className={`font-bold ${item.delta > 0 ? 'text-[#156143] dark:text-[#86E0B4]' : 'text-[#B91C1C] dark:text-[#FCA5A5]'}`}>{ledgerReason(item)}</p><p className="mt-1 text-xs text-[#667085]">{item.createdAt} · คงเหลือ {Number(item.balance || 0).toLocaleString()}</p></div><p className={`shrink-0 font-mono text-lg font-bold tabular-nums ${item.delta > 0 ? 'text-[#156143] dark:text-[#86E0B4]' : 'text-[#B91C1C] dark:text-[#FCA5A5]'}`}>{item.delta > 0 ? '+' : ''}{item.delta.toLocaleString()}</p></article>)}
            {payload.coinLedger.length === 0 && <p className="rounded-xl bg-white p-8 text-center text-sm text-[#667085] dark:bg-[#131E2E]">ยังไม่มีประวัติ Coin</p>}
          </section>}
        </main>
      </div>
    </div>
  );
};
