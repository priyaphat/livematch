import React, { useState } from 'react';
import { usePos } from '../context/PosContext';
import { formatCurrency, formatThaiDateShort } from '../utils/formatters';
import {
  BarChart3,
  Calendar,
  Download,
  Printer,
  TrendingUp,
  DollarSign,
  PieChart,
  ShoppingBag,
  Percent,
  ArrowUpRight,
  Sparkles,
} from 'lucide-react';

export const ReportsView: React.FC = () => {
  const { orders, products, settings, showToast } = usePos();

  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'all'>('month');
  const [reportType, setReportType] = useState<'overview' | 'top_sellers' | 'vat' | 'payments'>('overview');

  // Filter completed orders
  const completedOrders = orders.filter((o) => o.status === 'completed');

  // Calculate Aggregates
  const totalSales = completedOrders.reduce((sum, o) => sum + o.total, 0);
  const totalSubtotal = completedOrders.reduce((sum, o) => sum + o.subtotal, 0);
  const totalDiscounts = completedOrders.reduce((sum, o) => sum + o.discount, 0);
  const totalVat = completedOrders.reduce((sum, o) => sum + o.vatAmount, 0);

  // Approximate COGS from completed order items
  let totalCogs = 0;
  completedOrders.forEach((o) => {
    o.items.forEach((item) => {
      totalCogs += item.cost * item.quantity;
    });
  });

  const grossProfit = Math.max(0, totalSales - totalCogs);
  const profitMarginPercent = totalSales > 0 ? Math.round((grossProfit / totalSales) * 100) : 0;
  const avgOrderValue = completedOrders.length > 0 ? totalSales / completedOrders.length : 0;

  // Best Selling Items aggregation
  const productSalesMap: Record<
    string,
    { id: string; name: string; sku: string; qty: number; revenue: number; cost: number }
  > = {};

  completedOrders.forEach((o) => {
    o.items.forEach((item) => {
      if (!productSalesMap[item.productId]) {
        productSalesMap[item.productId] = {
          id: item.productId,
          name: item.name,
          sku: item.sku,
          qty: 0,
          revenue: 0,
          cost: 0,
        };
      }
      productSalesMap[item.productId].qty += item.quantity;
      productSalesMap[item.productId].revenue += item.total;
      productSalesMap[item.productId].cost += item.cost * item.quantity;
    });
  });

  const topSellers = Object.values(productSalesMap).sort((a, b) => b.qty - a.qty);

  // Payment Breakdown
  const paymentStats = {
    promptpay: completedOrders.filter((o) => o.paymentMethod === 'promptpay').reduce((s, o) => s + o.total, 0),
    cash: completedOrders.filter((o) => o.paymentMethod === 'cash').reduce((s, o) => s + o.total, 0),
    card: completedOrders.filter((o) => o.paymentMethod === 'card').reduce((s, o) => s + o.total, 0),
    transfer: completedOrders.filter((o) => o.paymentMethod === 'transfer').reduce((s, o) => s + o.total, 0),
  };

  const handleExportCSV = () => {
    const headers = ['Order Number', 'Date', 'Items Count', 'Payment Method', 'Subtotal', 'Discount', 'VAT', 'Total'];
    const rows = completedOrders.map((o) => [
      o.orderNumber,
      o.createdAt,
      o.items.reduce((s, it) => s + it.quantity, 0),
      o.paymentMethod,
      o.subtotal,
      o.discount,
      o.vatAmount,
      o.total,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `sales-report-${dateRange}-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('ดาวน์โหลดรายงาน CSV สำเร็จ', 'success');
  };

  return (
    <div className="flex-1 w-full p-4 sm:p-6 space-y-6 pb-24 overflow-y-auto bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            รายงานการเงิน & วิเคราะห์ยอดขาย
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            สรุปผลประกอบการ กำไรขั้นต้น ภาษี และสินค้าขายดี
          </p>
        </div>

        {/* Date Selector & Export Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Date tabs */}
          <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs shadow-xs">
            <button
              onClick={() => setDateRange('today')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-colors ${
                dateRange === 'today'
                  ? 'bg-emerald-500 text-slate-950 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              วันนี้
            </button>
            <button
              onClick={() => setDateRange('week')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-colors ${
                dateRange === 'week'
                  ? 'bg-emerald-500 text-slate-950 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              สัปดาห์นี้
            </button>
            <button
              onClick={() => setDateRange('month')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-colors ${
                dateRange === 'month'
                  ? 'bg-emerald-500 text-slate-950 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              เดือนนี้
            </button>
            <button
              onClick={() => setDateRange('all')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-colors ${
                dateRange === 'all'
                  ? 'bg-emerald-500 text-slate-950 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              ทั้งหมด
            </button>
          </div>

          <button
            id="export-csv-btn"
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold transition-all shadow-xs"
          >
            <Download className="w-4 h-4 text-emerald-600 dark:text-cyan-400" />
            <span>ส่งออก CSV</span>
          </button>
        </div>
      </div>

      {/* KPI Cards (High Precision) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-md">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">ยอดขายรวมสุทธิ</span>
          <div className="text-xl sm:text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 font-mono mt-1">
            {formatCurrency(totalSales, settings.currencySymbol, settings.decimalPlaces)}
          </div>
          <div className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            <span>{completedOrders.length} บิลที่สำเร็จ</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-md">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">กำไรขั้นต้น (Gross Profit)</span>
          <div className="text-xl sm:text-2xl font-extrabold text-teal-600 dark:text-teal-300 font-mono mt-1">
            {formatCurrency(grossProfit, settings.currencySymbol, settings.decimalPlaces)}
          </div>
          <div className="flex items-center gap-1 text-[11px] text-teal-600 dark:text-teal-400 mt-1 font-semibold">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>มาร์จิ้นกำไรเฉลี่ย {profitMarginPercent}%</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-md">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">ต้นทุนขายรวม (COGS)</span>
          <div className="text-xl sm:text-2xl font-extrabold text-slate-800 dark:text-slate-300 font-mono mt-1">
            {formatCurrency(totalCogs, settings.currencySymbol, settings.decimalPlaces)}
          </div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            คิดเป็น {totalSales > 0 ? Math.round((totalCogs / totalSales) * 100) : 0}% ของยอดขาย
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-md">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">ยอดขายเฉลี่ยต่อบิล</span>
          <div className="text-xl sm:text-2xl font-extrabold text-cyan-600 dark:text-cyan-400 font-mono mt-1">
            {formatCurrency(avgOrderValue, settings.currencySymbol, 0)}
          </div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            ภาษีมูลค่าเพิ่มสะสม: {formatCurrency(totalVat, settings.currencySymbol, 0)}
          </div>
        </div>
      </div>

      {/* Report Segment Tabs */}
      <div className="flex bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs self-start max-w-fit shadow-xs">
        <button
          onClick={() => setReportType('overview')}
          className={`px-3.5 py-1.5 rounded-xl font-bold transition-all ${
            reportType === 'overview'
              ? 'bg-emerald-500 text-slate-950 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          สรุปภาพรวมรายได้
        </button>
        <button
          onClick={() => setReportType('top_sellers')}
          className={`px-3.5 py-1.5 rounded-xl font-bold transition-all ${
            reportType === 'top_sellers'
              ? 'bg-emerald-500 text-slate-950 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          อันดับสินค้าขายดี ({topSellers.length})
        </button>
        <button
          onClick={() => setReportType('vat')}
          className={`px-3.5 py-1.5 rounded-xl font-bold transition-all ${
            reportType === 'vat'
              ? 'bg-emerald-500 text-slate-950 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          รายงานภาษีขาย (VAT 7%)
        </button>
        <button
          onClick={() => setReportType('payments')}
          className={`px-3.5 py-1.5 rounded-xl font-bold transition-all ${
            reportType === 'payments'
              ? 'bg-emerald-500 text-slate-950 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          สัดส่วนช่องทางชำระเงิน
        </button>
      </div>

      {/* TAB 1: OVERVIEW */}
      {reportType === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Revenue Breakdown */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-md space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-500" />
              <span>โครงสร้างรายได้และกำไร</span>
            </h3>

            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-950/70 rounded-2xl border border-slate-200 dark:border-slate-800">
                <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">ยอดขายก่อนหักส่วนลด</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white text-sm">
                  {formatCurrency(totalSubtotal, settings.currencySymbol, settings.decimalPlaces)}
                </span>
              </div>

              <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-950/70 rounded-2xl border border-slate-200 dark:border-slate-800">
                <span className="text-xs text-rose-700 dark:text-rose-300 font-medium">ส่วนลดโปรโมชันที่มอบให้ลูกค้า</span>
                <span className="font-mono font-bold text-rose-600 dark:text-rose-400 text-sm">
                  -{formatCurrency(totalDiscounts, settings.currencySymbol, settings.decimalPlaces)}
                </span>
              </div>

              <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-950/70 rounded-2xl border border-slate-200 dark:border-slate-800">
                <span className="text-xs text-slate-600 dark:text-slate-400">
                  ภาษีมูลค่าเพิ่ม ({settings.vatRate}% {settings.vatType === 'included' ? 'รวมในราคา' : 'แยกนอก'})
                </span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-300 text-sm">
                  {formatCurrency(totalVat, settings.currencySymbol, settings.decimalPlaces)}
                </span>
              </div>

              <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-950/70 rounded-2xl border border-slate-200 dark:border-slate-800">
                <span className="text-xs text-slate-600 dark:text-slate-400">ต้นทุนสินค้าทั้งหมด (COGS)</span>
                <span className="font-mono font-bold text-slate-600 dark:text-slate-400 text-sm">
                  -{formatCurrency(totalCogs, settings.currencySymbol, settings.decimalPlaces)}
                </span>
              </div>

              <div className="flex justify-between items-center p-4 bg-emerald-50 dark:bg-emerald-950/30 rounded-2xl border border-emerald-200 dark:border-emerald-500/40">
                <div>
                  <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 block">
                    กำไรสุทธิจากการดำเนินงาน (Net Gross Margin)
                  </span>
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400/80 font-medium">
                    หักต้นทุนสินค้าเรียบร้อย
                  </span>
                </div>
                <span className="font-mono font-extrabold text-emerald-600 dark:text-emerald-400 text-xl">
                  {formatCurrency(grossProfit, settings.currencySymbol, settings.decimalPlaces)}
                </span>
              </div>
            </div>
          </div>

          {/* Payment Methods Breakdown */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-md space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <PieChart className="w-4 h-4 text-emerald-500" />
              <span>สรุปยอดตามช่องทางชำระเงิน</span>
            </h3>

            <div className="space-y-3">
              {[
                { name: 'PromptPay QR', amount: paymentStats.promptpay, color: 'bg-blue-500', barColor: 'bg-blue-500' },
                { name: 'เงินสด (Cash)', amount: paymentStats.cash, color: 'bg-emerald-500', barColor: 'bg-emerald-500' },
                { name: 'บัตรเครดิต (Card)', amount: paymentStats.card, color: 'bg-purple-500', barColor: 'bg-purple-500' },
                { name: 'โอนเงิน (Transfer)', amount: paymentStats.transfer, color: 'bg-cyan-500', barColor: 'bg-cyan-500' },
              ].map((p, idx) => {
                const percent = totalSales > 0 ? Math.round((p.amount / totalSales) * 100) : 0;
                return (
                  <div key={idx} className="p-3 bg-slate-50 dark:bg-slate-950/70 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{p.name}</span>
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-slate-500 dark:text-slate-400">
                          {formatCurrency(p.amount, settings.currencySymbol, 0)}
                        </span>
                        <span className="font-bold text-slate-900 dark:text-white">{percent}%</span>
                      </div>
                    </div>
                    <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div style={{ width: `${percent}%` }} className={`h-full rounded-full ${p.barColor}`} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: TOP SELLERS */}
      {reportType === 'top_sellers' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-md">
          <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
            <thead className="bg-slate-100 dark:bg-slate-950/80 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="p-4 text-center">อันดับ</th>
                <th className="p-4">รายการสินค้า</th>
                <th className="p-4">รหัส SKU</th>
                <th className="p-4 text-right">จำนวนที่ขายได้</th>
                <th className="p-4 text-right">ยอดขายรวม</th>
                <th className="p-4 text-right">ต้นทุนรวม</th>
                <th className="p-4 text-right">กำไรสุทธิ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {topSellers.map((item, idx) => {
                const profit = item.revenue - item.cost;
                return (
                  <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="p-4 text-center">
                      <span
                        className={`w-6 h-6 rounded-full inline-flex items-center justify-center font-bold text-xs ${
                          idx === 0
                            ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                            : idx === 1
                            ? 'bg-slate-200 dark:bg-slate-300 text-slate-900'
                            : idx === 2
                            ? 'bg-amber-700 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {idx + 1}
                      </span>
                    </td>
                    <td className="p-4 font-semibold text-slate-900 dark:text-white">{item.name}</td>
                    <td className="p-4 font-mono text-slate-500 dark:text-slate-400">{item.sku}</td>
                    <td className="p-4 text-right font-mono font-bold text-slate-900 dark:text-slate-200">
                      {item.qty}
                    </td>
                    <td className="p-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(item.revenue, settings.currencySymbol, settings.decimalPlaces)}
                    </td>
                    <td className="p-4 text-right font-mono text-slate-500 dark:text-slate-400">
                      {formatCurrency(item.cost, settings.currencySymbol, settings.decimalPlaces)}
                    </td>
                    <td className="p-4 text-right font-mono font-extrabold text-teal-600 dark:text-teal-300">
                      {formatCurrency(profit, settings.currencySymbol, settings.decimalPlaces)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 3: VAT REPORT */}
      {reportType === 'vat' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-md space-y-4">
          <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                รายงานภาษีขาย (Sales VAT Output Summary)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                เลขประจำตัวผู้เสียภาษีอากร: {settings.taxId} | อัตราภาษี: {settings.vatRate}%
              </p>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-500 dark:text-slate-400 block">ภาษีขายรวมทั้งสิ้น</span>
              <span className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                {formatCurrency(totalVat, settings.currencySymbol, settings.decimalPlaces)}
              </span>
            </div>
          </div>

          <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
            <thead className="bg-slate-100 dark:bg-slate-950/80 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="p-3">เลขที่ใบกำกับ/บิล</th>
                <th className="p-3">วันที่</th>
                <th className="p-3 text-right">มูลค่าสินค้า</th>
                <th className="p-3 text-right">ส่วนลด</th>
                <th className="p-3 text-right">มูลค่าก่อนภาษี</th>
                <th className="p-3 text-right">ภาษีมูลค่าเพิ่ม ({settings.vatRate}%)</th>
                <th className="p-3 text-right">ยอดรวมสุทธิ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono">
              {completedOrders.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="p-3 font-bold text-slate-900 dark:text-white">{o.orderNumber}</td>
                  <td className="p-3 text-slate-500 dark:text-slate-400">{formatThaiDateShort(o.createdAt)}</td>
                  <td className="p-3 text-right">{formatCurrency(o.subtotal, '', settings.decimalPlaces)}</td>
                  <td className="p-3 text-right text-rose-600 dark:text-rose-400">
                    {o.discount > 0 ? `-${formatCurrency(o.discount, '', settings.decimalPlaces)}` : '0.00'}
                  </td>
                  <td className="p-3 text-right">{formatCurrency(o.subtotal - o.discount, '', settings.decimalPlaces)}</td>
                  <td className="p-3 text-right text-emerald-600 dark:text-emerald-400 font-bold">
                    {formatCurrency(o.vatAmount, '', settings.decimalPlaces)}
                  </td>
                  <td className="p-3 text-right font-bold text-slate-900 dark:text-white">
                    {formatCurrency(o.total, '', settings.decimalPlaces)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 4: PAYMENTS */}
      {reportType === 'payments' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-md space-y-2">
            <span className="text-xs text-blue-600 dark:text-blue-400 font-semibold">Thai QR PromptPay</span>
            <div className="text-xl font-bold font-mono text-slate-900 dark:text-white">
              {formatCurrency(paymentStats.promptpay, settings.currencySymbol, settings.decimalPlaces)}
            </div>
            <p className="text-[11px] text-slate-500">สแกนจ่ายผ่าน Mobile Banking</p>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-md space-y-2">
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">เงินสด (Cash)</span>
            <div className="text-xl font-bold font-mono text-slate-900 dark:text-white">
              {formatCurrency(paymentStats.cash, settings.currencySymbol, settings.decimalPlaces)}
            </div>
            <p className="text-[11px] text-slate-500">ชำระด้วยธนบัตรและเหรียญ</p>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-md space-y-2">
            <span className="text-xs text-purple-600 dark:text-purple-400 font-semibold">บัตรเครดิต (Credit Card)</span>
            <div className="text-xl font-bold font-mono text-slate-900 dark:text-white">
              {formatCurrency(paymentStats.card, settings.currencySymbol, settings.decimalPlaces)}
            </div>
            <p className="text-[11px] text-slate-500">รูดผ่านเครื่อง EDC</p>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-md space-y-2">
            <span className="text-xs text-cyan-600 dark:text-cyan-400 font-semibold">โอนเงินธนาคาร</span>
            <div className="text-xl font-bold font-mono text-slate-900 dark:text-white">
              {formatCurrency(paymentStats.transfer, settings.currencySymbol, settings.decimalPlaces)}
            </div>
            <p className="text-[11px] text-slate-500">แนบสลิปโอนเงินเข้าบัญชีร้าน</p>
          </div>
        </div>
      )}
    </div>
  );
};
