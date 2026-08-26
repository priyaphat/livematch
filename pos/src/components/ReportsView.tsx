import React, { useEffect, useState } from 'react';
import { usePos } from '../context/PosContext';
import { formatCurrency, formatThaiDateShort } from '../utils/formatters';
import { authorizePOSReportExport, getPOSReports, POSReportData, POSReportRange } from '../api/posReports';
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
  const { settings, showToast } = usePos();

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const [dateRange, setDateRange] = useState<POSReportRange>('month');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reportType, setReportType] = useState<'overview' | 'top_sellers' | 'vat' | 'payments'>('overview');
  const [report, setReport] = useState<POSReportData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [topPage, setTopPage] = useState(1);
  const [vatPage, setVatPage] = useState(1);

  useEffect(() => { setTopPage(1); setVatPage(1); }, [dateRange, startDate, endDate]);

  useEffect(() => {
    if (dateRange === 'custom' && (!startDate || !endDate || startDate > endDate)) {
      setLoadError(startDate > endDate ? 'วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น' : 'กรุณาเลือกวันที่เริ่มต้นและวันที่สิ้นสุด');
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setLoadError('');
    void getPOSReports(dateRange, startDate, endDate, topPage, vatPage).then((result) => {
      if (!cancelled) setReport(result);
    }).catch((error) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : 'โหลดรายงานไม่สำเร็จ');
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [dateRange, startDate, endDate, topPage, vatPage]);

  const summary = report?.summary;
  const totalSales = (summary?.totalSalesSatang || 0) / 100;
  const totalSubtotal = (summary?.totalSubtotalSatang || 0) / 100;
  const totalDiscounts = (summary?.totalDiscountSatang || 0) / 100;
  const totalVat = (summary?.totalVatSatang || 0) / 100;
  const totalCogs = (summary?.totalCogsSatang || 0) / 100;
  const grossProfit = (summary?.grossProfitSatang || 0) / 100;
  const profitMarginPercent = totalSales > 0 ? Math.round((grossProfit / totalSales) * 100) : 0;
  const avgOrderValue = (summary?.averageBillSatang || 0) / 100;
  const topSellers = (report?.topSellers || []).map((item) => ({ id: item.id || `${item.sku}:${item.name}`, name: item.name, sku: item.sku, qty: item.quantity, revenue: item.revenueSatang / 100, cost: item.costSatang / 100 }));
  const completedOrders = report?.sales || [];
  const topPagination = report?.topSellersPagination || { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const vatPagination = report?.salesPagination || { page: 1, pageSize: 25, total: 0, totalPages: 0 };
  const paymentStats = { promptpay: (report?.paymentStats.promptPaySatang || 0) / 100, cash: (report?.paymentStats.cashSatang || 0) / 100, card: 0, transfer: 0 };

  const reportNames = {
    overview: 'สรุปภาพรวมรายได้',
    top_sellers: 'อันดับสินค้าขายดี',
    vat: 'รายงานภาษีขาย',
    payments: 'สัดส่วนช่องทางชำระเงิน',
  } as const;

  const formatCSVDate = (value: string) => new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(`${value}T00:00:00+07:00`));

  const formatCSVDateTime = (value: string) => {
    const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}:00+07:00`;
    return new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Bangkok',
    }).format(new Date(normalized));
  };

  const paymentName = (method: string) => method === 'promptpay' ? 'พร้อมเพย์ QR' : 'เงินสด';

  const shortBillNumber = (id: string) => {
    const value = id.replace(/^sale-/i, '').replace(/[^a-z0-9]/gi, '').toUpperCase();
    return `POS-${value.slice(-8) || id}`;
  };

  const paginationBar = (page: number, totalPages: number, total: number, onChange: (page: number) => void) => (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs dark:border-slate-800">
      <span className="text-slate-500">ทั้งหมด {total.toLocaleString('th-TH')} รายการ · หน้า {totalPages > 0 ? page : 0}/{totalPages}</span>
      <div className="flex items-center gap-2">
        <button type="button" disabled={page <= 1 || isLoading} onClick={() => onChange(page - 1)} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-bold disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900">ก่อนหน้า</button>
        <button type="button" disabled={page >= totalPages || totalPages === 0 || isLoading} onClick={() => onChange(page + 1)} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-bold disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900">ถัดไป</button>
      </div>
    </div>
  );

  const handleExportCSV = async () => {
    if (isExporting) return;
    if (!report) {
      showToast('ยังไม่มีข้อมูลรายงานสำหรับส่งออก', 'warning');
      return;
    }

    setIsExporting(true);

    try {
      await authorizePOSReportExport();
    } catch (error) {
      setIsExporting(false);
      showToast(error instanceof Error ? error.message : 'ไม่มีสิทธิ์ส่งออกรายงาน', 'error');
      return;
    }

    let exportReport: POSReportData;
    try {
      exportReport = await getPOSReports(dateRange, startDate, endDate, 1, 1, true);
    } catch (error) {
      setIsExporting(false);
      showToast(error instanceof Error ? error.message : 'โหลดข้อมูลทั้งหมดสำหรับ Excel ไม่สำเร็จ', 'error');
      return;
    }

    const exportTopSellers = exportReport.topSellers.map((item) => ({ name: item.name, sku: item.sku, qty: item.quantity, revenue: item.revenueSatang / 100, cost: item.costSatang / 100 }));
    const exportCompletedOrders = exportReport.sales;
    const exportTotalSales = exportReport.summary.totalSalesSatang / 100;
    const exportPaymentStats = { cash: exportReport.paymentStats.cashSatang / 100, promptpay: exportReport.paymentStats.promptPaySatang / 100 };

    let ExcelJS: typeof import('exceljs');
    try {
      ExcelJS = await import('exceljs');
    } catch {
      setIsExporting(false);
      showToast('ไม่สามารถเปิดระบบสร้างไฟล์ Excel ได้', 'error');
      return;
    }

    let headers: Array<string | number> = [];
    let rows: Array<Array<string | number>> = [];

    if (reportType === 'overview') {
      headers = ['หัวข้อ', 'จำนวนเงิน (บาท)', 'รายละเอียด'];
      rows = [
        ['ยอดขายก่อนหักส่วนลด', totalSubtotal, 'ยอดรวมราคาสินค้าก่อนส่วนลด'],
        ['ส่วนลดทั้งหมด', totalDiscounts, 'ส่วนลดที่มอบให้ลูกค้า'],
        ['ภาษีมูลค่าเพิ่ม', totalVat, `VAT ${settings.vatRate}%`],
        ['ยอดขายสุทธิ', totalSales, `${summary?.completedBills || 0} บิล`],
        ['ต้นทุนขายรวม', totalCogs, 'ต้นทุนสินค้าที่ขายจริง'],
        ['กำไรขั้นต้น', grossProfit, `อัตรากำไร ${profitMarginPercent}%`],
        ['ยอดขายเฉลี่ยต่อบิล', avgOrderValue, 'ค่าเฉลี่ยจากบิลที่สำเร็จ'],
      ];
    } else if (reportType === 'top_sellers') {
      headers = ['อันดับ', 'สินค้า', 'SKU', 'จำนวนขาย', 'ยอดขาย (บาท)', 'ต้นทุน (บาท)', 'กำไร (บาท)'];
      rows = exportTopSellers.map((item, index) => [index + 1, item.name, item.sku || '-', item.qty, item.revenue, item.cost, item.revenue - item.cost]);
    } else if (reportType === 'vat') {
      headers = ['ลำดับ', 'เลขบิล', 'วันที่ชำระ', 'ลูกค้า', 'ราคาสินค้า (บาท)', 'ส่วนลด (บาท)', 'หลังส่วนลด (บาท)', 'VAT (บาท)', 'ยอดสุทธิ (บาท)', 'วิธีชำระ'];
      rows = exportCompletedOrders.map((sale, index) => [
        index + 1,
        shortBillNumber(sale.id),
        formatCSVDateTime(sale.createdAt),
        sale.buyerName || 'ลูกค้าหน้าร้าน',
        sale.subtotalSatang / 100,
        sale.discountSatang / 100,
        sale.netBeforeVatSatang / 100,
        sale.vatSatang / 100,
        sale.totalSatang / 100,
        paymentName(sale.method),
      ]);
    } else {
      const paymentRows = [
        { name: 'เงินสด', method: 'cash', amount: exportPaymentStats.cash },
        { name: 'พร้อมเพย์ QR', method: 'promptpay', amount: exportPaymentStats.promptpay },
      ];
      headers = ['วิธีชำระ', 'จำนวนบิล', 'ยอดรวม (บาท)', 'สัดส่วน'];
      rows = paymentRows.map((item) => {
        const billCount = exportCompletedOrders.filter((sale) => sale.method === item.method).length;
        const percent = exportTotalSales > 0 ? (item.amount / exportTotalSales) * 100 : 0;
        return [item.name, billCount, item.amount, `${percent.toFixed(1)}%`];
      });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'LiveMatch POS';
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet(reportNames[reportType], {
      views: [{ state: 'frozen', ySplit: 5 }],
      pageSetup: { orientation: headers.length > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1 },
    });
    const columnCount = Math.max(1, headers.length);
    worksheet.mergeCells(1, 1, 1, columnCount);
    worksheet.getCell(1, 1).value = `รายงาน POS — ${reportNames[reportType]}`;
    worksheet.getCell(1, 1).font = { name: 'Tahoma', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } };
    worksheet.getCell(1, 1).alignment = { horizontal: 'left', vertical: 'middle' };
    worksheet.getRow(1).height = 30;

    worksheet.mergeCells(2, 1, 2, columnCount);
    worksheet.getCell(2, 1).value = `ช่วงข้อมูล: ${formatCSVDate(report.startDate)} ถึง ${formatCSVDate(report.endDate)}`;
    worksheet.mergeCells(3, 1, 3, columnCount);
    worksheet.getCell(3, 1).value = `วันที่จัดทำ: ${new Intl.DateTimeFormat('th-TH', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date())}`;
    [2, 3].forEach((rowNumber) => {
      const cell = worksheet.getCell(rowNumber, 1);
      cell.font = { name: 'Tahoma', size: 11, bold: rowNumber === 2, color: { argb: 'FF334155' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
      cell.alignment = { vertical: 'middle' };
      worksheet.getRow(rowNumber).height = 21;
    });

    const headerRow = worksheet.getRow(5);
    headerRow.values = headers;
    headerRow.height = 25;
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Tahoma', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: { style: 'thin', color: { argb: 'FFCBD5E1' } }, bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } }, left: { style: 'thin', color: { argb: 'FFCBD5E1' } }, right: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
    });

    rows.forEach((values, index) => {
      const row = worksheet.addRow(values);
      row.height = 21;
      row.eachCell((cell) => {
        cell.font = { name: 'Tahoma', size: 10, color: { argb: 'FF1E293B' } };
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC' } };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
      });
    });

    const integerColumns: number[] = [];
    const moneyColumns: number[] = [];
    if (reportType === 'overview') moneyColumns.push(2);
    if (reportType === 'top_sellers') { integerColumns.push(1, 4); moneyColumns.push(5, 6, 7); }
    if (reportType === 'vat') { integerColumns.push(1); moneyColumns.push(5, 6, 7, 8, 9); }
    if (reportType === 'payments') { integerColumns.push(2); moneyColumns.push(3); }
    for (let rowNumber = 6; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      integerColumns.forEach((column) => { worksheet.getCell(rowNumber, column).numFmt = '#,##0'; });
      moneyColumns.forEach((column) => { worksheet.getCell(rowNumber, column).numFmt = '#,##0.00'; });
    }
    worksheet.columns.forEach((column, columnIndex) => {
      let width = String(headers[columnIndex] || '').length + 4;
      rows.forEach((row) => { width = Math.max(width, String(row[columnIndex] ?? '').length + 2); });
      column.width = Math.min(36, Math.max(12, width));
    });
    if (rows.length > 0) worksheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: columnCount } };

    let workbookBuffer: Awaited<ReturnType<typeof workbook.xlsx.writeBuffer>>;
    try {
      workbookBuffer = await workbook.xlsx.writeBuffer();
    } catch {
      setIsExporting(false);
      showToast('ไม่สามารถสร้างไฟล์ Excel ได้', 'error');
      return;
    }
    const fileName = `pos-${reportType}-${report.startDate}-${report.endDate}.xlsx`;
    const blob = new Blob([workbookBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const fallbackDownload = () => {
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      link.rel = 'noopener';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    };

    try {
      const pickerWindow = window as Window & {
        showSaveFilePicker?: (options: {
          suggestedName: string;
          types: Array<{ description: string; accept: Record<string, string[]> }>;
        }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;
      };
      if (pickerWindow.showSaveFilePicker) {
        try {
          const fileHandle = await pickerWindow.showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description: 'ไฟล์รายงาน Excel', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }],
          });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
        } catch (pickerError) {
          if (pickerError instanceof DOMException && pickerError.name === 'AbortError') return;
          fallbackDownload();
        }
      } else {
        fallbackDownload();
      }
      showToast(`บันทึก Excel: ${reportNames[reportType]} สำเร็จ`, 'success');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        showToast(error instanceof Error ? error.message : 'ไม่สามารถบันทึกไฟล์ Excel ได้', 'error');
      }
    } finally {
      setIsExporting(false);
    }
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
              onClick={() => setDateRange('day')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-colors ${
                dateRange === 'day'
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
              onClick={() => setDateRange('custom')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-colors ${
                dateRange === 'custom'
                  ? 'bg-emerald-500 text-slate-950 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              กำหนดเอง
            </button>
          </div>

          {dateRange === 'custom' && (
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 text-xs shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <label className="flex items-center gap-1.5 px-1 font-semibold text-slate-500 dark:text-slate-400">
                <span>เริ่ม</span>
                <input type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-800 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200" />
              </label>
              <span className="text-slate-300 dark:text-slate-700">–</span>
              <label className="flex items-center gap-1.5 px-1 font-semibold text-slate-500 dark:text-slate-400">
                <span>สิ้นสุด</span>
                <input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-800 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200" />
              </label>
            </div>
          )}

          <button
            id="export-csv-btn"
            onClick={handleExportCSV}
            disabled={isLoading || isExporting || !report}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold transition-all shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-emerald-600 dark:text-cyan-400" />
            <span>{isExporting ? 'กำลังสร้าง Excel...' : 'ส่งออกแท็บนี้ Excel'}</span>
          </button>
        </div>
      </div>

      {loadError && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">{loadError}</div>}

      {/* KPI Cards (High Precision) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-md">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">ยอดขายรวมสุทธิ</span>
          <div className="text-xl sm:text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 font-mono mt-1">
            {formatCurrency(totalSales, settings.currencySymbol, settings.decimalPlaces)}
          </div>
          <div className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            <span>{summary?.completedBills || 0} บิลที่สำเร็จ</span>
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
          อันดับสินค้าขายดี ({topPagination.total})
        </button>
        <button
          onClick={() => setReportType('vat')}
          className={`px-3.5 py-1.5 rounded-xl font-bold transition-all ${
            reportType === 'vat'
              ? 'bg-emerald-500 text-slate-950 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          รายงานภาษีขาย (VAT {settings.vatRate}%)
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
                        {(topPagination.page - 1) * topPagination.pageSize + idx + 1}
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
          {paginationBar(topPagination.page, topPagination.totalPages, topPagination.total, setTopPage)}
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
                  <td className="p-3 font-bold text-slate-900 dark:text-white">{o.id}</td>
                  <td className="p-3 text-slate-500 dark:text-slate-400">{formatThaiDateShort(o.createdAt)}</td>
                  <td className="p-3 text-right">{formatCurrency(o.subtotalSatang / 100, '', settings.decimalPlaces)}</td>
                  <td className="p-3 text-right text-rose-600 dark:text-rose-400">
                    {o.discountSatang > 0 ? `-${formatCurrency(o.discountSatang / 100, '', settings.decimalPlaces)}` : '0.00'}
                  </td>
                  <td className="p-3 text-right">{formatCurrency(o.netBeforeVatSatang / 100, '', settings.decimalPlaces)}</td>
                  <td className="p-3 text-right text-emerald-600 dark:text-emerald-400 font-bold">
                    {formatCurrency(o.vatSatang / 100, '', settings.decimalPlaces)}
                  </td>
                  <td className="p-3 text-right font-bold text-slate-900 dark:text-white">
                    {formatCurrency(o.totalSatang / 100, '', settings.decimalPlaces)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {paginationBar(vatPagination.page, vatPagination.totalPages, vatPagination.total, setVatPage)}
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
