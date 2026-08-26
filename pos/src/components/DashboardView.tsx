import React, { useEffect, useMemo, useState } from 'react';
import { usePos } from '../context/PosContext';
import { formatCurrency, formatThaiTime } from '../utils/formatters';
import { getPOSDashboard, POSDashboardData, POSDashboardRange } from '../api/posDashboard';
import { DEFAULT_PRODUCT_IMAGE } from '../constants/product';
import {
  TrendingUp,
  ShoppingBag,
  PauseCircle,
  AlertTriangle,
  ArrowUpRight,
  Receipt,
  Clock,
  CheckCircle2,
} from 'lucide-react';

export const DashboardView: React.FC = () => {
  const {
    orders,
    settings,
    setActiveTab,
    setSelectedOrderForReceipt,
  } = usePos();

  const [range, setRange] = useState<POSDashboardRange>('1d');
  const [dashboard, setDashboard] = useState<POSDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError('');
    void getPOSDashboard(range).then((result) => {
      if (!cancelled) setDashboard(result);
    }).catch((error) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : 'โหลด Dashboard ไม่สำเร็จ');
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [range]);

  const rangeText = range === '1d' ? 'วันนี้' : range === '1w' ? '7 วันล่าสุด' : '30 วันล่าสุด';
  const salesTotal = (dashboard?.salesSatang || 0) / 100;
  const totalBillsCount = dashboard?.completedBills || 0;
  const lowStockProducts = dashboard?.lowStockItems || [];
  const categoryList = useMemo(() => (dashboard?.categories || []).map((item) => ({ name: item.name, total: item.totalSatang / 100, count: item.quantity })), [dashboard]);
  const totalCatSales = categoryList.reduce((sum, category) => sum + category.total, 0);
  const timelineData = (dashboard?.timeline || []).map((item) => ({ label: item.label, amount: item.amountSatang / 100 }));
  const maxTimeline = Math.max(1, ...timelineData.map((item) => item.amount));

  return (
    <div className="flex-1 w-full p-4 sm:p-6 space-y-6 pb-24 overflow-y-auto bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
            <span>ภาพรวมการขาย {rangeText}</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            สรุปยอดขาย กิจกรรม และความเคลื่อนไหวสต็อกตามช่วงเวลา
          </p>
          {loadError && <p className="mt-1 text-xs font-bold text-rose-500">{loadError}</p>}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 shadow-sm">
            {(['1d', '1w', '1m'] as POSDashboardRange[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setRange(item)}
                disabled={isLoading && item === range}
                className={`min-w-10 rounded-lg px-2.5 py-1.5 text-xs font-black transition-colors ${range === item ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'}`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Today Sales */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 flex flex-col justify-between shadow-sm dark:shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">ยอดขาย {rangeText}</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl sm:text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(salesTotal, settings.currencySymbol, settings.decimalPlaces)}
            </div>
            <div className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 font-medium">
              <ArrowUpRight className={`w-3.5 h-3.5 ${(dashboard?.salesChangePercent || 0) < 0 ? 'rotate-90' : ''}`} />
              <span>{(dashboard?.salesChangePercent || 0) >= 0 ? '+' : ''}{(dashboard?.salesChangePercent || 0).toFixed(1)}% จากช่วงก่อนหน้า</span>
            </div>
          </div>
        </div>

        {/* Card 2: Total Bills */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 flex flex-col justify-between shadow-sm dark:shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">จำนวนบิลที่สำเร็จ</span>
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Receipt className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
              {totalBillsCount}{' '}
              <span className="text-sm font-normal text-slate-500 dark:text-slate-400">บิล</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              เฉลี่ย{' '}
              {formatCurrency(
                (dashboard?.averageBillSatang || 0) / 100,
                settings.currencySymbol,
                0
              )}
              /บิล
            </p>
          </div>
        </div>

        {/* Card 3: Held Orders */}
        <div
          onClick={() => setActiveTab('bills')}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-amber-500 rounded-3xl p-4 sm:p-5 flex flex-col justify-between shadow-sm dark:shadow-xl cursor-pointer transition-all group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">รายการพักยอด</span>
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400 group-hover:scale-110 transition-transform">
              <PauseCircle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl sm:text-2xl font-extrabold text-amber-600 dark:text-amber-400">
              {dashboard?.heldCount || 0}{' '}
              <span className="text-sm font-normal text-slate-500 dark:text-slate-400">รายการ</span>
            </div>
            <p className="text-[11px] text-amber-600 dark:text-amber-400/80 mt-1 flex items-center gap-1 group-hover:underline">
              <span>คลิกเพื่อดูรายการค้าง</span>
              <ArrowUpRight className="w-3 h-3" />
            </p>
          </div>
        </div>

        {/* Card 4: Low Stock Alert */}
        <div
          onClick={() => setActiveTab('stock')}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-rose-500 rounded-3xl p-4 sm:p-5 flex flex-col justify-between shadow-sm dark:shadow-xl cursor-pointer transition-all group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">สินค้าสต็อกต่ำ</span>
            <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-600 dark:text-rose-400 group-hover:scale-110 transition-transform">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl sm:text-2xl font-extrabold text-rose-600 dark:text-rose-400">
              {dashboard?.lowStockCount || 0}{' '}
              <span className="text-sm font-normal text-slate-500 dark:text-slate-400">รายการ</span>
            </div>
            <p className="text-[11px] text-rose-600 dark:text-rose-400/80 mt-1 flex items-center gap-1 group-hover:underline">
              <span>ต้องสั่งซื้อเติมสต็อก</span>
              <ArrowUpRight className="w-3 h-3" />
            </p>
          </div>
        </div>
      </div>

      {/* Main Charts & Analytics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Hourly Sales Chart */}
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm dark:shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>กราฟแนวโน้มยอดขาย</span>
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                ข้อมูลจริงของ {rangeText} แยกตามช่วงเวลา
              </span>
            </div>
            <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              ยอดพีค: {dashboard?.peakLabel || '-'}{range === '1d' && dashboard?.peakLabel !== '-' ? ' น.' : ''}
            </span>
          </div>

          {/* Bar Chart Visualizer */}
          <div className="h-56 flex items-end justify-between gap-1.5 sm:gap-2 pt-6 px-1">
            {timelineData.map((item, idx) => {
              const heightPercent = item.amount > 0 ? Math.max(4, (item.amount / maxTimeline) * 100) : 0;
              return (
                <div
                  key={idx}
                  className="flex-1 flex flex-col items-center gap-2 group relative h-full justify-end"
                >
                  {/* Tooltip on hover */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-8 px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-[10px] text-white font-mono whitespace-nowrap z-10 pointer-events-none shadow-lg">
                    {formatCurrency(item.amount, settings.currencySymbol, 0)}
                  </div>

                  {/* Bar */}
                  <div className="w-full bg-slate-100 dark:bg-slate-800/80 rounded-t-lg overflow-hidden flex items-end h-full">
                    <div
                      style={{ height: `${heightPercent}%` }}
                      className={`w-full rounded-t-lg transition-all duration-500 group-hover:brightness-110 ${
                        item.amount === maxTimeline && item.amount > 0
                          ? 'bg-gradient-to-t from-emerald-600 to-emerald-400 shadow-lg shadow-emerald-500/20'
                          : 'bg-gradient-to-t from-slate-400 dark:from-slate-700 to-teal-500/80'
                      }`}
                    />
                  </div>

                  {/* X Axis Label */}
                  <span className="text-[9px] sm:text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                    {range === '1m' && idx % 5 !== 0 && idx !== timelineData.length - 1
                      ? ''
                      : range === '1d' ? item.label.slice(0, 2) : item.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: 5 Top Selling Categories */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm dark:shadow-xl flex flex-col justify-between">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>สัดส่วนยอดขายตามหมวดหมู่</span>
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">5 หมวดหมู่หลัก</span>
          </div>

          <div className="space-y-3.5 my-auto">
            {categoryList.map((cat, index) => {
              const percent = totalCatSales > 0 ? Math.round((cat.total / totalCatSales) * 100) : 0;
              const colorClasses = [
                'bg-emerald-500',
                'bg-cyan-500',
                'bg-amber-500',
                'bg-purple-500',
                'bg-rose-500',
              ];

              return (
                <div key={index} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-200 font-semibold">{cat.name}</span>
                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                        {formatCurrency(cat.total, settings.currencySymbol, 0)}
                      </span>
                      <span className="font-bold text-slate-900 dark:text-white text-xs">{percent}%</span>
                    </div>
                  </div>
                  {/* Progress Bar */}
                  <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${percent}%` }}
                      className={`h-full rounded-full ${colorClasses[index % colorClasses.length]}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
            <span>รวมหมวดหมู่ทั้งหมด</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
              {formatCurrency(totalCatSales, settings.currencySymbol, settings.decimalPlaces)}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Grid: Low Stock Alert Table & Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Low Stock Items List */}
        <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm dark:shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-500 dark:text-rose-400" />
                <span>รายการสินค้าสต็อกใกล้หมด ({dashboard?.lowStockCount || 0})</span>
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                สินค้าที่จำนวนเหลือน้อยกว่าเกณฑ์แจ้งเตือน
              </span>
            </div>
            <button
              onClick={() => setActiveTab('stock')}
              className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline font-bold"
            >
              จัดการสต็อกทั้งหมด →
            </button>
          </div>

          <div className="space-y-2.5 max-h-72 overflow-y-auto">
            {lowStockProducts.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-xs flex flex-col items-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2" />
                <span>สินค้าทุกรายการมีสต็อกเพียงพอ</span>
              </div>
            ) : (
              lowStockProducts.map((prod) => (
                <div
                  key={prod.id}
                  className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 rounded-2xl p-3 flex items-center justify-between gap-3 hover:border-slate-400 dark:hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={prod.imageData || DEFAULT_PRODUCT_IMAGE}
                      alt={prod.name}
                      referrerPolicy="no-referrer"
                      className="w-11 h-11 rounded-xl object-cover bg-slate-200 dark:bg-slate-900 shrink-0"
                    />
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {prod.name}
                      </h4>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        SKU: {prod.sku}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30">
                      เหลือ {prod.stock} {prod.unit}
                    </span>
                    <span className="block text-[10px] text-slate-500 mt-0.5">
                      เตือนที่ {prod.lowStockThreshold}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: Recent Completed Orders */}
        <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm dark:shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Receipt className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>บิลการขายล่าสุด</span>
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">รายการขายที่ทำรายการสำเร็จ</span>
            </div>
            <button
              onClick={() => setActiveTab('bills')}
              className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline font-bold"
            >
              ดูประวัติบิลทั้งหมด →
            </button>
          </div>

          <div className="space-y-2.5 max-h-72 overflow-y-auto">
            {(dashboard?.recentSales || []).map((sale) => {
              const order = orders.find((item) => item.paymentId === sale.paymentId);
              return (
              <div
                key={sale.id}
                onClick={() => order && setSelectedOrderForReceipt(order)}
                className={`bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 hover:border-slate-400 dark:hover:border-slate-700 rounded-2xl p-3 flex items-center justify-between gap-3 transition-colors ${order ? 'cursor-pointer' : ''}`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-xs text-slate-900 dark:text-white">
                      {sale.id}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.2 rounded-md font-bold ${
                        'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30'
                      }`}
                    >
                      สำเร็จ
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    <span>{formatThaiTime(sale.createdAt)} น.</span>
                    <span className="mx-1">•</span>
                    <span>{sale.itemCount} ชิ้น</span>
                    <span className="mx-1">•</span>
                    <span className="capitalize">
                      {sale.method === 'promptpay' ? 'PromptPay' : 'เงินสด'}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 font-mono">
                    {formatCurrency(sale.totalSatang / 100, settings.currencySymbol, settings.decimalPlaces)}
                  </span>
                  <span className="block text-[10px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
                    {order ? 'ดูใบเสร็จ ↗' : sale.actorName}
                  </span>
                </div>
              </div>
            );})}
          </div>
        </div>
      </div>
    </div>
  );
};
