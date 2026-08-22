import React from 'react';
import { usePos } from '../context/PosContext';
import { formatCurrency, formatThaiDateTime, formatThaiTime } from '../utils/formatters';
import {
  TrendingUp,
  ShoppingBag,
  PauseCircle,
  AlertTriangle,
  ArrowUpRight,
  Receipt,
  Package,
  Calendar,
  Clock,
  ExternalLink,
  PlusCircle,
  CheckCircle2,
} from 'lucide-react';

export const DashboardView: React.FC = () => {
  const {
    orders,
    heldOrders,
    products,
    settings,
    setActiveTab,
    setSelectedOrderForReceipt,
  } = usePos();

  // Calculate today's metrics
  const completedOrders = orders.filter((o) => o.status === 'completed');
  const todayTotalSales = completedOrders.reduce((sum, o) => sum + o.total, 0);
  const totalBillsCount = completedOrders.length;
  const lowStockProducts = products.filter((p) => p.stock <= p.minStockAlert);

  // Category sales breakdown
  const categorySalesMap: Record<string, { name: string; total: number; count: number }> = {
    coffee: { name: 'กาแฟ & เครื่องดื่ม', total: 0, count: 0 },
    bakery: { name: 'เบเกอรี่ & เค้ก', total: 0, count: 0 },
    food: { name: 'อาหารจานเดียว', total: 0, count: 0 },
    snack: { name: 'ของทานเล่น', total: 0, count: 0 },
    dessert: { name: 'ของหวาน', total: 0, count: 0 },
  };

  completedOrders.forEach((order) => {
    order.items.forEach((item) => {
      const prod = products.find((p) => p.id === item.productId);
      const catKey = prod?.category || 'coffee';
      if (categorySalesMap[catKey]) {
        categorySalesMap[catKey].total += item.total;
        categorySalesMap[catKey].count += item.quantity;
      }
    });
  });

  const categoryList = Object.values(categorySalesMap).sort((a, b) => b.total - a.total);
  const totalCatSales = categoryList.reduce((sum, c) => sum + c.total, 0) || 1;

  // Hourly simulated sales for visual chart
  const hourlyData = [
    { hour: '08:00', amount: 1850 },
    { hour: '09:00', amount: 3400 },
    { hour: '10:00', amount: 5120 },
    { hour: '11:00', amount: 7200 },
    { hour: '12:00', amount: 9800 },
    { hour: '13:00', amount: 8400 },
    { hour: '14:00', amount: 4900 },
    { hour: '15:00', amount: 3800 },
    { hour: '16:00', amount: 4200 },
    { hour: '17:00', amount: 6100 },
    { hour: '18:00', amount: 5500 },
    { hour: '19:00', amount: 3200 },
  ];
  const maxHourly = Math.max(...hourlyData.map((d) => d.amount));

  return (
    <div className="flex-1 w-full p-4 sm:p-6 space-y-6 pb-24 overflow-y-auto bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
            <span>ภาพรวมการขายวันนี้</span>
            <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-semibold">
              Live Real-Time
            </span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            สรุปยอดขาย กิจกรรม และความเคลื่อนไหวสต็อกประจำวัน
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('pos')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
          >
            <ShoppingBag className="w-4 h-4" />
            <span>ไปที่หน้าการขาย (POS)</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Today Sales */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 flex flex-col justify-between shadow-sm dark:shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">ยอดขายวันนี้</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl sm:text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(todayTotalSales, settings.currencySymbol, settings.decimalPlaces)}
            </div>
            <div className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 font-medium">
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>+12.8% จากเมื่อวาน</span>
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
                totalBillsCount > 0 ? todayTotalSales / totalBillsCount : 0,
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
              {heldOrders.length}{' '}
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
              {lowStockProducts.length}{' '}
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
                <span>กราฟแนวโน้มยอดขายรายชั่วโมง</span>
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                ข้อมูลการขายของวันนี้ แยกตามช่วงเวลา
              </span>
            </div>
            <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              ยอดพีค: 12:00 น.
            </span>
          </div>

          {/* Bar Chart Visualizer */}
          <div className="h-56 flex items-end justify-between gap-1.5 sm:gap-2 pt-6 px-1">
            {hourlyData.map((item, idx) => {
              const heightPercent = Math.max(12, (item.amount / maxHourly) * 100);
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
                        item.amount === maxHourly
                          ? 'bg-gradient-to-t from-emerald-600 to-emerald-400 shadow-lg shadow-emerald-500/20'
                          : 'bg-gradient-to-t from-slate-400 dark:from-slate-700 to-teal-500/80'
                      }`}
                    />
                  </div>

                  {/* X Axis Label */}
                  <span className="text-[9px] sm:text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                    {item.hour.slice(0, 2)}
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
              const percent = Math.round((cat.total / totalCatSales) * 100);
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
                <span>รายการสินค้าสต็อกใกล้หมด ({lowStockProducts.length})</span>
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
                      src={prod.image}
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
                      เตือนที่ {prod.minStockAlert}
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
            {orders.slice(0, 5).map((order) => (
              <div
                key={order.id}
                onClick={() => setSelectedOrderForReceipt(order)}
                className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 hover:border-slate-400 dark:hover:border-slate-700 rounded-2xl p-3 flex items-center justify-between gap-3 cursor-pointer transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-xs text-slate-900 dark:text-white">
                      {order.orderNumber}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.2 rounded-md font-bold ${
                        order.status === 'completed'
                          ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30'
                          : 'bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30'
                      }`}
                    >
                      {order.status === 'completed' ? 'สำเร็จ' : 'คืนเงินแล้ว'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    <span>{formatThaiTime(order.createdAt)} น.</span>
                    <span className="mx-1">•</span>
                    <span>{order.items.length} รายการ</span>
                    <span className="mx-1">•</span>
                    <span className="capitalize">
                      {order.paymentMethod === 'promptpay'
                        ? 'PromptPay'
                        : order.paymentMethod === 'cash'
                        ? 'เงินสด'
                        : 'บัตรเครดิต'}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 font-mono">
                    {formatCurrency(order.total, settings.currencySymbol, settings.decimalPlaces)}
                  </span>
                  <span className="block text-[10px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
                    ดูใบเสร็จ ↗
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
