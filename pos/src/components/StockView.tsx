import React, { useState, useMemo } from 'react';
import { usePos } from '../context/PosContext';
import { Product, StockMovement, Supplier, StockBatchSummary } from '../types';
import { formatCurrency, formatThaiDateTime } from '../utils/formatters';
import { DEFAULT_PRODUCT_IMAGE } from '../constants/product';
import {
  PlusCircle,
  MinusCircle,
  Sliders,
  Building2,
  Search,
  CheckCircle2,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Package,
  Boxes,
  FileText,
  History,
  Trash2,
  Plus,
  Minus,
  X,
  Eye,
  Tag,
  Coins,
  ChevronRight,
  ExternalLink,
  Layers,
} from 'lucide-react';

const normalizeWholeNumberInput = (value: string) => {
  if (value === '') return '';
  return value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
};

const normalizeDecimalInput = (value: string) => {
  if (value === '') return '';
  const [wholePart = '', ...decimalParts] = value.split('.');
  const whole = wholePart.replace(/\D/g, '').replace(/^0+(?=\d)/, '') || '0';
  if (!value.includes('.')) return whole;
  const decimal = decimalParts.join('').replace(/\D/g, '').slice(0, 2);
  return `${whole}.${decimal}`;
};

export const StockView: React.FC = () => {
  const {
    products,
    categories: catalogCategories,
    stockMovements,
    stockBatches,
    stockSummary,
    batchStockOperation,
    suppliers,
    addSupplier,
    settings,
    showToast,
  } = usePos();

  // Navigation & View Mode inside Stock Management
  const [activeMainTab, setActiveMainTab] = useState<'master' | 'batches' | 'movements' | 'suppliers'>('master');
  const [movementFilterTab, setMovementFilterTab] = useState<'all' | 'in' | 'out' | 'adjust'>('all');
  const [stockStatusFilter, setStockStatusFilter] = useState<'all' | 'low' | 'out' | 'normal'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Batch Operation Modal state
  const [batchModalMode, setBatchModalMode] = useState<'in' | 'out' | 'adjust' | null>(null);
  const [batchDocRef, setBatchDocRef] = useState<string>('');
  const [batchSupplier, setBatchSupplier] = useState<string>('');
  const [batchReason, setBatchReason] = useState<string>('');
  const [batchDiscountType, setBatchDiscountType] = useState<'amount' | 'percent'>('amount');
  const [batchDiscountInput, setBatchDiscountInput] = useState<string>('0');
  const [isSavingBatch, setIsSavingBatch] = useState<boolean>(false);
  const [batchItems, setBatchItems] = useState<
    Array<{
      productId: string;
      product: Product;
      quantity: number;
      cost: number;
      note?: string;
    }>
  >([]);

  // Product Picker within Batch Modal
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);
  const [pickerSearch, setPickerSearch] = useState<string>('');
  const [pickerCategory, setPickerCategory] = useState<string>('all');

  // View Batch Details Modal
  const [selectedBatchForDetails, setSelectedBatchForDetails] = useState<StockBatchSummary | null>(null);

  // Supplier Modal States
  const [isAddSupplierModalOpen, setIsAddSupplierModalOpen] = useState<boolean>(false);
  const [newSupplierData, setNewSupplierData] = useState<Omit<Supplier, 'id' | 'productsCount'>>({
    code: `SUP-00${suppliers.length + 1}`,
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
  });

  // Calculate Metrics
  const totalStockUnits = stockSummary.totalUnits;
  const totalInventoryCost = stockSummary.inventoryCostValue;
  const totalInventoryRetail = stockSummary.inventoryRetailValue;
  const lowStockCount = stockSummary.lowStockCount;
  const outOfStockCount = stockSummary.outOfStockCount;

  // Extract Categories
  const categoryIds = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => set.add(p.category));
    return ['all', ...Array.from(set)];
  }, [products]);

  const categoryName = (categoryId: string) =>
    catalogCategories.find((category) => category.id === categoryId)?.name || categoryId;

  const batchSummaries = stockBatches;

  // Filter Master Products
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchCat = selectedCategory === 'all' || p.category === selectedCategory;
      const matchSearch =
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.barcode && p.barcode.includes(searchQuery));

      let matchStatus = true;
      if (stockStatusFilter === 'low') {
        matchStatus = p.stock > 0 && p.stock <= p.minStockAlert;
      } else if (stockStatusFilter === 'out') {
        matchStatus = p.stock <= 0;
      } else if (stockStatusFilter === 'normal') {
        matchStatus = p.stock > p.minStockAlert;
      }

      return matchCat && matchSearch && matchStatus;
    });
  }, [products, selectedCategory, searchQuery, stockStatusFilter]);

  // Filter Detailed Movements
  const filteredMovements = useMemo(() => {
    return stockMovements.filter((m) => {
      const matchTab = movementFilterTab === 'all' || m.type === movementFilterTab;
      const matchSearch =
        m.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.productSku.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.referenceNo.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.reason.toLowerCase().includes(searchQuery.toLowerCase());
      return matchTab && matchSearch;
    });
  }, [stockMovements, movementFilterTab, searchQuery]);

  // Filter Batches
  const filteredBatches = useMemo(() => {
    return batchSummaries.filter((b) => {
      const matchSearch =
        b.referenceNo.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.reason.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (b.supplierName && b.supplierName.toLowerCase().includes(searchQuery.toLowerCase())) ||
        b.performedBy.toLowerCase().includes(searchQuery.toLowerCase());
      return matchSearch;
    });
  }, [batchSummaries, searchQuery]);

  // Open Modal Helpers
  const handleOpenBatchModal = (mode: 'in' | 'out' | 'adjust', initialProduct?: Product, supplierId?: string) => {
    if (mode === 'out' && initialProduct && initialProduct.stock <= 0) {
      showToast(`สินค้า "${initialProduct.name}" ไม่มีสต็อกคงเหลือ`, 'warning');
      return;
    }
    const timestamp = Date.now().toString().slice(-6);
    const prefix = mode === 'in' ? 'RCV' : mode === 'out' ? 'OUT' : 'ADJ';
    setBatchDocRef(`${prefix}-${timestamp}`);
    setBatchModalMode(mode);
    setBatchSupplier(supplierId || suppliers[0]?.id || '');
    setBatchDiscountType('amount');
    setBatchDiscountInput('0');
    setBatchReason(
      mode === 'in'
        ? 'สั่งซื้อสินค้าเข้าสต็อกประจำงวด'
        : mode === 'out'
        ? 'เบิกใช้หน้าร้าน / สินค้าชำรุดเสียหาย'
        : 'ตรวจนับสต็อกจริงสิ้นวัน'
    );

    if (initialProduct) {
      setBatchItems([
        {
          productId: initialProduct.id,
          product: initialProduct,
          quantity: mode === 'adjust' ? initialProduct.stock : mode === 'in' ? 10 : 1,
          cost: initialProduct.cost,
          note: '',
        },
      ]);
    } else {
      setBatchItems([]);
    }
    setIsPickerOpen(true); // Open product selector so user immediately sees choices
  };

  // Add Product to Batch Line Items
  const handleAddProductToBatch = (product: Product) => {
    if (batchModalMode === 'out' && product.stock <= 0) {
      showToast(`สินค้า "${product.name}" ไม่มีสต็อกคงเหลือ`, 'warning');
      return;
    }
    setBatchItems((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      if (existing) {
        // Increase qty
        return prev.map((item) =>
          item.productId === product.id
            ? {
                ...item,
                quantity:
                  batchModalMode === 'adjust'
                    ? item.quantity
                    : batchModalMode === 'out'
                    ? Math.min(item.product.stock, item.quantity + 1)
                    : item.quantity + 1,
              }
            : item
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          product,
          quantity: batchModalMode === 'adjust' ? product.stock : batchModalMode === 'in' ? 10 : 1,
          cost: product.cost,
          note: '',
        },
      ];
    });
  };

  // Remove Item from Batch
  const handleRemoveBatchItem = (productId: string) => {
    setBatchItems((prev) => prev.filter((item) => item.productId !== productId));
  };

  // Update Item in Batch
  const handleUpdateBatchItem = (
    productId: string,
    updates: Partial<{ quantity: number; cost: number; note: string }>
  ) => {
    setBatchItems((prev) =>
      prev.map((item) => (item.productId === productId ? { ...item, ...updates } : item))
    );
  };

  // Submit Batch Document
  const handleSubmitBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchModalMode || batchItems.length === 0 || isSavingBatch) return;

    setIsSavingBatch(true);
    const saved = await batchStockOperation({
      type: batchModalMode,
      items: batchItems.map((it) => ({
        productId: it.productId,
        quantity: it.quantity,
        cost: it.cost,
        note: it.note,
      })),
      supplierId: batchModalMode === 'in' ? batchSupplier : undefined,
      supplierName: batchModalMode === 'in' ? suppliers.find((supplier) => supplier.id === batchSupplier)?.name : undefined,
      reason: batchReason,
      referenceNo: batchDocRef,
      discountType: batchModalMode === 'in' ? batchDiscountType : 'amount',
      discountAmountSatang: batchModalMode === 'in' && batchDiscountType === 'amount' ? discountSatang : 0,
      discountRateBps: batchModalMode === 'in' && batchDiscountType === 'percent' ? Math.round(discountNumber * 100) : 0,
    });
    setIsSavingBatch(false);
    if (saved) {
      setBatchModalMode(null);
      setBatchItems([]);
    }
  };

  // Add Supplier
  const handleAddSupplierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const saved = await addSupplier(newSupplierData);
    if (!saved) return;
    setIsAddSupplierModalOpen(false);
    setNewSupplierData({
      code: `SUP-00${suppliers.length + 2}`,
      name: '',
      contactPerson: '',
      phone: '',
      email: '',
      address: '',
    });
  };

  // Products available in Picker (filtered)
  const pickerFilteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchCat = pickerCategory === 'all' || p.category === pickerCategory;
      const matchSearch =
        p.name.toLowerCase().includes(pickerSearch.toLowerCase()) ||
        p.sku.toLowerCase().includes(pickerSearch.toLowerCase()) ||
        (p.barcode && p.barcode.includes(pickerSearch));
      return matchCat && matchSearch;
    });
  }, [products, pickerCategory, pickerSearch]);

  // Batch Totals Calculation inside Modal
  const batchTotalUnits = batchItems.reduce((sum, it) => sum + (batchModalMode === 'adjust' ? 1 : it.quantity), 0);
  const batchGrossSatang = batchItems.reduce((sum, it) => sum + it.quantity * Math.round(it.cost * 100), 0);
  const batchTotalValue = batchGrossSatang / 100;
  const discountNumber = Math.max(0, Number.parseFloat(batchDiscountInput) || 0);
  const discountSatang = batchModalMode === 'in'
    ? batchDiscountType === 'percent'
      ? Math.round(batchGrossSatang * discountNumber / 100)
      : Math.round(discountNumber * 100)
    : 0;
  const batchNetValue = (batchGrossSatang - discountSatang) / 100;
  const discountInvalid = batchModalMode === 'in' && (discountNumber > (batchDiscountType === 'percent' ? 100 : batchTotalValue));
  const adjustmentBeforeUnits = batchItems.reduce((sum, it) => sum + it.product.stock, 0);
  const adjustmentAfterUnits = batchItems.reduce((sum, it) => sum + it.quantity, 0);
  const adjustmentUnitDelta = adjustmentAfterUnits - adjustmentBeforeUnits;
  const adjustmentBeforeValue = batchItems.reduce(
    (sum, it) => sum + it.product.stock * it.cost,
    0
  );
  const adjustmentAfterValue = batchItems.reduce(
    (sum, it) => sum + it.quantity * it.cost,
    0
  );
  const adjustmentValueDelta = adjustmentAfterValue - adjustmentBeforeValue;
  const detailBeforeValue = selectedBatchForDetails?.items.reduce(
    (sum, item) => sum + item.beforeStock * (item.previousCostPerUnit ?? item.costPerUnit ?? 0),
    0
  ) ?? 0;
  const detailAfterValue = selectedBatchForDetails?.items.reduce(
    (sum, item) => sum + item.afterStock * (item.resultingCostPerUnit ?? item.costPerUnit ?? 0),
    0
  ) ?? 0;
  const detailQuantityDelta = selectedBatchForDetails?.items.reduce(
    (sum, item) => sum + item.quantity,
    0
  ) ?? 0;

  return (
    <div className="flex-1 w-full p-4 sm:p-6 space-y-6 pb-24 overflow-y-auto custom-scrollbar bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Header Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1">
            จัดการคลังสินค้า & รายการสต็อกรวม
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            บันทึกรับเข้า จ่ายออก ปรับยอดสต็อกแบบรวมหลายรายการ และตรวจสอบประวัติความเคลื่อนไหว
          </p>
        </div>

        {/* Major Action Buttons (Red, Yellow, White theme) */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            id="stock-in-batch-btn"
            onClick={() => handleOpenBatchModal('in')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-500 text-white font-extrabold text-xs shadow-md shadow-red-600/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <PlusCircle className="w-4 h-4 text-yellow-300 stroke-[2.5]" />
            <span>รับสินค้าเข้า (Stock In)</span>
          </button>

          <button
            id="stock-out-batch-btn"
            onClick={() => handleOpenBatchModal('out')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-xs shadow-md shadow-yellow-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <MinusCircle className="w-4 h-4 stroke-[2.5]" />
            <span>จ่ายออก / เบิกใช้ (Stock Out)</span>
          </button>

          <button
            id="adjust-stock-batch-btn"
            onClick={() => handleOpenBatchModal('adjust')}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-white border border-slate-300 dark:border-slate-700 font-bold text-xs shadow-xs transition-all hover:border-yellow-500"
          >
            <Sliders className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
            <span>ปรับปรุงสต็อก (Adjust)</span>
          </button>

          <button
            id="manage-suppliers-btn"
            onClick={() => setActiveMainTab('suppliers')}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-800 font-medium text-xs shadow-xs transition-all"
          >
            <Building2 className="w-4 h-4 text-red-500 dark:text-red-400" />
            <span>ซัพพลายเออร์ ({suppliers.length})</span>
          </button>
        </div>
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1 */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xs relative overflow-hidden group hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">สินค้าในคลังทั้งหมด</span>
            <div className="w-8 h-8 rounded-xl bg-red-50 dark:bg-red-600/20 border border-red-200 dark:border-red-500/30 flex items-center justify-center text-red-600 dark:text-red-400">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white mt-2">
            {totalStockUnits.toLocaleString()} <span className="text-xs font-normal text-slate-500 dark:text-slate-400">ชิ้น</span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
            <span>จำนวน {stockSummary.productCount} รายการ</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">พร้อมขาย</span>
          </div>
        </div>

        {/* Card 2 */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xs relative overflow-hidden group hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">มูลค่าสต็อกรวม (ทุน)</span>
            <div className="w-8 h-8 rounded-xl bg-yellow-50 dark:bg-yellow-500/20 border border-yellow-200 dark:border-yellow-500/30 flex items-center justify-center text-yellow-600 dark:text-yellow-400">
              <Coins className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-yellow-600 dark:text-yellow-400 font-mono mt-2">
            {formatCurrency(totalInventoryCost, settings.currencySymbol, settings.decimalPlaces)}
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
            <span>มูลค่าขายปลีก:</span>
            <span className="text-slate-900 dark:text-white font-mono font-bold">
              {formatCurrency(totalInventoryRetail, settings.currencySymbol, 0)}
            </span>
          </div>
        </div>

        {/* Card 3 */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xs relative overflow-hidden group hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">เตือนสต็อกใกล้หมด / หมด</span>
            <div className="w-8 h-8 rounded-xl bg-red-50 dark:bg-red-500/20 border border-red-200 dark:border-red-500/30 flex items-center justify-center text-red-600 dark:text-red-400">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-red-600 dark:text-red-400 mt-2 flex items-baseline gap-2">
            <span>{lowStockCount + outOfStockCount}</span>
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">รายการ</span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
            <span className="text-yellow-600 dark:text-yellow-400 font-semibold">ใกล้หมด: {lowStockCount}</span>
            <span className="text-red-600 dark:text-red-500 font-bold">หมดแล้ว: {outOfStockCount}</span>
          </div>
        </div>

        {/* Card 4 */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xs relative overflow-hidden group hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">เอกสารสต็อก / เคลื่อนไหว</span>
            <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300">
              <FileText className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white mt-2">
            {stockSummary.batchCount}{' '}
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">เอกสารรวม</span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
            <span>รายการย่อย {stockSummary.movementCount} แถว</span>
            <span className="text-slate-700 dark:text-slate-300 font-medium">บันทึกครบถ้วน</span>
          </div>
        </div>
      </div>

      {/* Main View Container with Navigation Tabs */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-6 shadow-sm space-y-5">
        {/* Navigation Tabs Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div className="flex flex-wrap bg-slate-100 dark:bg-slate-950 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 gap-1">
            <button
              id="tab-master-stock-btn"
              onClick={() => setActiveMainTab('master')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeMainTab === 'master'
                  ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-800/50'
              }`}
            >
              <Boxes className="w-4 h-4" />
              <span>สรุปสต็อกสินค้าทั้งหมด ({stockSummary.productCount})</span>
            </button>

            <button
              id="tab-batch-documents-btn"
              onClick={() => setActiveMainTab('batches')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeMainTab === 'batches'
                  ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-800/50'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>รายการเอกสารรวม ({stockSummary.batchCount})</span>
            </button>

            <button
              id="tab-detailed-movements-btn"
              onClick={() => setActiveMainTab('movements')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeMainTab === 'movements'
                  ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-800/50'
              }`}
            >
              <History className="w-4 h-4" />
              <span>ประวัติเคลื่อนไหวรายชิ้น ({stockSummary.movementCount})</span>
            </button>

            <button
              id="tab-suppliers-btn"
              onClick={() => setActiveMainTab('suppliers')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeMainTab === 'suppliers'
                  ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-800/50'
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span>ซัพพลายเออร์ ({suppliers.length})</span>
            </button>
          </div>

          {/* Search bar */}
          <div className="relative max-w-sm w-full">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาชื่อสินค้า, รหัส SKU, เลขที่เอกสาร..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl pl-9 pr-3.5 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500"
            />
          </div>
        </div>

        {/* TAB 1: MASTER STOCK LIST */}
        {activeMainTab === 'master' && (
          <div className="space-y-4">
            {/* Filter Sub-bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              {/* Category selector */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
                <span className="text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">หมวดหมู่:</span>
                {categoryIds.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                      selectedCategory === cat
                        ? 'bg-yellow-500 text-slate-950 font-bold shadow-xs'
                        : 'bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    {cat === 'all' ? 'ทุกหมวดหมู่' : categoryName(cat)}
                  </button>
                ))}
              </div>

              {/* Status Filter */}
              <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
                <button
                  onClick={() => setStockStatusFilter('all')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                    stockStatusFilter === 'all'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-bold shadow-xs'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  ทั้งหมด ({stockSummary.productCount})
                </button>
                <button
                  onClick={() => setStockStatusFilter('low')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                    stockStatusFilter === 'low'
                      ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-800 dark:text-yellow-400 font-bold border border-yellow-300 dark:border-yellow-500/30'
                      : 'text-slate-500 dark:text-slate-400 hover:text-yellow-600 dark:hover:text-yellow-400'
                  }`}
                >
                  ใกล้หมด ({lowStockCount})
                </button>
                <button
                  onClick={() => setStockStatusFilter('out')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                    stockStatusFilter === 'out'
                      ? 'bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-400 font-bold border border-red-300 dark:border-red-500/30'
                      : 'text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400'
                  }`}
                >
                  หมดสต็อก ({outOfStockCount})
                </button>
              </div>
            </div>

            {/* Master Table */}
            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="p-3.5">สินค้า / รหัส SKU</th>
                    <th className="p-3.5">หมวดหมู่</th>
                    <th className="p-3.5 text-right">ราคาขาย</th>
                    <th className="p-3.5 text-right">ราคาทุน</th>
                    <th className="p-3.5 text-center">คงเหลือในคลัง</th>
                    <th className="p-3.5 text-right">มูลค่ารวม (ทุน)</th>
                    <th className="p-3.5 text-center">สถานะ</th>
                    <th className="p-3.5 text-center">ทำรายการด่วน</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900/50">
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-400 dark:text-slate-500">
                        ไม่พบรายการสินค้าที่ตรงกับเงื่อนไขการค้นหา
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map((p) => {
                      const isLow = p.stock > 0 && p.stock <= p.minStockAlert;
                      const isOut = p.stock <= 0;
                      const totalLineCost = p.stock * p.cost;

                      return (
                        <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="p-3.5">
                            <div className="flex items-center gap-3">
                              <img
                                src={p.image}
                                alt={p.name}
                                referrerPolicy="no-referrer"
                                className="w-10 h-10 rounded-xl object-cover bg-slate-100 dark:bg-slate-950 shrink-0 border border-slate-200 dark:border-slate-800"
                              />
                              <div>
                                <div className="font-bold text-slate-900 dark:text-white text-sm">{p.name}</div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                                  SKU: {p.sku} {p.barcode ? `• Barcode: ${p.barcode}` : ''}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="p-3.5">
                            <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">
                              {categoryName(p.category)}
                            </span>
                          </td>
                          <td className="p-3.5 text-right font-mono font-bold text-slate-900 dark:text-white">
                            {formatCurrency(p.price, settings.currencySymbol, settings.decimalPlaces)}
                          </td>
                          <td className="p-3.5 text-right font-mono text-slate-500 dark:text-slate-400">
                            {formatCurrency(p.cost, settings.currencySymbol, settings.decimalPlaces)}
                          </td>
                          <td className="p-3.5 text-center">
                            <span
                              className={`text-sm font-black font-mono px-3 py-1 rounded-xl ${
                                isOut
                                  ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400 border border-red-300 dark:border-red-500/30'
                                  : isLow
                                  ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-800 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-500/30'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
                              }`}
                            >
                              {p.stock} {p.unit}
                            </span>
                          </td>
                          <td className="p-3.5 text-right font-mono font-bold text-yellow-600 dark:text-yellow-400">
                            {formatCurrency(
                              totalLineCost,
                              settings.currencySymbol,
                              settings.decimalPlaces
                            )}
                          </td>
                          <td className="p-3.5 text-center">
                            {isOut ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 dark:bg-red-950/80 text-red-700 dark:text-red-400 border border-red-300 dark:border-red-700/50">
                                สินค้าหมด
                              </span>
                            ) : isLow ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-yellow-100 dark:bg-yellow-950/80 text-yellow-800 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-700/50">
                                ใกล้หมด (≤{p.minStockAlert})
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700/50">
                                ปกติ
                              </span>
                            )}
                          </td>
                          <td className="p-3.5 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => handleOpenBatchModal('in', p)}
                                title="รับสินค้านี้เข้าคลัง"
                                className="p-1.5 rounded-xl bg-red-100 dark:bg-red-600/20 hover:bg-red-600 text-red-600 dark:text-red-400 hover:text-white border border-red-300 dark:border-red-500/30 transition-colors"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleOpenBatchModal('out', p)}
                                title="จ่ายออก / เบิกใช้สินค้านี้"
                                className="p-1.5 rounded-xl bg-yellow-100 dark:bg-yellow-500/20 hover:bg-yellow-500 text-yellow-700 dark:text-yellow-400 hover:text-slate-950 border border-yellow-300 dark:border-yellow-500/30 transition-colors"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleOpenBatchModal('adjust', p)}
                                title="ปรับยอดสต็อกสินค้านี้"
                                className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-700 transition-colors"
                              >
                                <Sliders className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: BATCH DOCUMENTS LIST (รายการรวม) */}
        {activeMainTab === 'batches' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <p>
                แสดงรายการเอกสารสรุปรวมทั้งหมดที่ทำรายการผ่านระบบ (คลิกเพื่อดูรายการสินค้าย่อยในแต่ละใบ)
              </p>
              <span className="font-bold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-950 px-3 py-1 rounded-xl border border-slate-200 dark:border-slate-800">
                รวม {filteredBatches.length} เอกสาร
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {filteredBatches.length === 0 ? (
                <div className="p-10 bg-slate-50 dark:bg-slate-950/60 rounded-3xl border border-slate-200 dark:border-slate-800 text-center text-slate-400 dark:text-slate-500">
                  ไม่มีเอกสารสต็อกรวมในประวัติ
                </div>
              ) : (
                filteredBatches.map((batch) => {
                  const isStockIn = batch.type === 'in';
                  const isStockOut = batch.type === 'out';
                  const isAdjust = batch.type === 'adjust';

                  return (
                    <div
                      key={batch.referenceNo}
                      className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 hover:border-slate-300 dark:hover:border-slate-700 shadow-xs transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="space-y-2 flex-1">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="font-mono font-black text-sm text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-900 px-3 py-1 rounded-xl border border-slate-200 dark:border-slate-800">
                            {batch.referenceNo}
                          </span>

                          <span
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                              isStockIn
                                ? 'bg-red-100 dark:bg-red-600/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/40'
                                : isStockOut
                                ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-800 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-500/40'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            {isStockIn ? (
                              <>
                                <ArrowDownLeft className="w-3.5 h-3.5" />
                                รับสินค้าเข้า (Stock In)
                              </>
                            ) : isStockOut ? (
                              <>
                                <ArrowUpRight className="w-3.5 h-3.5" />
                                จ่ายออก (Stock Out)
                              </>
                            ) : (
                              <>
                                <Sliders className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400" />
                                ตรวจนับ & ปรับปรุง (Adjust)
                              </>
                            )}
                          </span>

                          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                            {formatThaiDateTime(batch.createdAt)}
                          </span>
                        </div>

                        <div className="text-xs text-slate-700 dark:text-slate-300">
                          <span className="text-slate-500 dark:text-slate-400">เหตุผล / หมายเหตุ: </span>
                          <span className="font-semibold text-slate-900 dark:text-white">{batch.reason}</span>
                          {batch.supplierName && (
                            <span className="text-yellow-700 dark:text-yellow-400 ml-2 font-medium">
                              • ซัพพลายเออร์: {batch.supplierName}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                          <span>
                            ผู้ทำรายการ: <strong className="text-slate-900 dark:text-white">{batch.performedBy}</strong>
                          </span>
                          <span>•</span>
                          <span>
                            จำนวนรายการสินค้า:{' '}
                            <strong className="text-yellow-700 dark:text-yellow-400 font-bold">
                              {batch.itemsCount} รายการ
                            </strong>
                          </span>
                          <span>•</span>
                          <span>
                            ยอดรวมจำนวนชิ้น:{' '}
                            <strong className="text-slate-900 dark:text-white font-mono">{batch.totalQuantity} ชิ้น</strong>
                          </span>
                        </div>
                      </div>

                      {/* Right Action & Value */}
                      <div className="flex items-center justify-between md:flex-col md:items-end gap-3 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800/80">
                        <div className="text-right">
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 block">มูลค่ารวมรายการ</span>
                          <span className="text-base sm:text-lg font-black text-yellow-600 dark:text-yellow-400 font-mono">
                            {formatCurrency(
                              batch.totalCostValue,
                              settings.currencySymbol,
                              settings.decimalPlaces
                            )}
                          </span>
                        </div>

                        <button
                          onClick={() => setSelectedBatchForDetails(batch)}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white text-xs font-bold border border-slate-200 dark:border-slate-700 transition-colors shadow-xs"
                        >
                          <Eye className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400" />
                          <span>ดูรายการสินค้าข้างใน ({batch.itemsCount})</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 3: DETAILED MOVEMENTS */}
        {activeMainTab === 'movements' && (
          <div className="space-y-4">
            {/* Filter Tabs */}
            <div className="flex items-center gap-2">
              <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs">
                <button
                  onClick={() => setMovementFilterTab('all')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-colors ${
                    movementFilterTab === 'all'
                      ? 'bg-red-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  ทั้งหมด ({stockSummary.movementCount})
                </button>
                <button
                  onClick={() => setMovementFilterTab('in')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-colors ${
                    movementFilterTab === 'in'
                      ? 'bg-red-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  รับเข้า (In)
                </button>
                <button
                  onClick={() => setMovementFilterTab('out')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-colors ${
                    movementFilterTab === 'out'
                      ? 'bg-yellow-500 text-slate-950 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  จ่ายออก (Out)
                </button>
                <button
                  onClick={() => setMovementFilterTab('adjust')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-colors ${
                    movementFilterTab === 'adjust'
                      ? 'bg-slate-800 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  ปรับปรุง (Adjust)
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="p-3.5">เลขอ้างอิง</th>
                    <th className="p-3.5">วันที่ - เวลา</th>
                    <th className="p-3.5">สินค้า / รหัส SKU</th>
                    <th className="p-3.5 text-center">ประเภท</th>
                    <th className="p-3.5 text-right">จำนวน</th>
                    <th className="p-3.5 text-center">ก่อน → หลัง</th>
                    <th className="p-3.5">เหตุผล / ซัพพลายเออร์</th>
                    <th className="p-3.5 text-right">ผู้ทำรายการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900/50">
                  {filteredMovements.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-400 dark:text-slate-500">
                        ไม่มีรายการเคลื่อนไหวสต็อกในเงื่อนไขนี้
                      </td>
                    </tr>
                  ) : (
                    filteredMovements.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="p-3.5 font-mono font-bold text-slate-900 dark:text-white">{m.referenceNo}</td>
                        <td className="p-3.5 text-slate-500 dark:text-slate-400 font-mono">
                          {formatThaiDateTime(m.createdAt)}
                        </td>
                        <td className="p-3.5">
                          <div className="font-bold text-slate-900 dark:text-white">{m.productName}</div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{m.productSku}</div>
                        </td>
                        <td className="p-3.5 text-center">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                              m.type === 'in'
                                ? 'bg-red-100 dark:bg-red-600/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/30'
                                : m.type === 'out'
                                ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-800 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-500/30'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            {m.type === 'in' ? 'รับเข้า' : m.type === 'out' ? 'จ่ายออก' : 'ปรับยอด'}
                          </span>
                        </td>
                        <td className="p-3.5 text-right font-mono font-black text-sm">
                          <span
                            className={
                              m.type === 'in'
                                ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                                : m.type === 'out'
                                ? 'text-red-600 dark:text-red-400 font-bold'
                                : 'text-orange-600 dark:text-orange-400 font-bold'
                            }
                          >
                            {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                          </span>
                        </td>
                        <td className="p-3.5 text-center font-mono text-slate-500 dark:text-slate-400">
                          <span>{m.beforeStock}</span>
                          <span className="mx-1 text-slate-400 dark:text-slate-600">→</span>
                          <span className="font-bold text-slate-900 dark:text-white">{m.afterStock}</span>
                        </td>
                        <td className="p-3.5 max-w-[220px]">
                          <div className="truncate text-slate-800 dark:text-slate-200">{m.reason}</div>
                          {m.supplierName && (
                            <div className="text-[10px] text-yellow-700 dark:text-yellow-400/90 truncate">
                              🏢 {m.supplierName}
                            </div>
                          )}
                        </td>
                        <td className="p-3.5 text-right text-slate-500 dark:text-slate-400 font-medium">
                          {m.performedBy}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: SUPPLIERS */}
        {activeMainTab === 'suppliers' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                จัดการข้อมูลคู่ค้า / ซัพพลายเออร์ที่จัดส่งสินค้าเข้าคลัง
              </span>
              <button
                onClick={() => setIsAddSupplierModalOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-md shadow-red-600/20"
              >
                <PlusCircle className="w-4 h-4 text-yellow-300" />
                <span>เพิ่มซัพพลายเออร์ใหม่</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {suppliers.map((sup) => (
                <div
                  key={sup.id}
                  className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 flex flex-col justify-between gap-3 hover:border-slate-300 dark:hover:border-slate-700 shadow-xs transition-colors"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-bold text-yellow-800 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-400/10 px-2.5 py-0.5 rounded-full border border-yellow-300 dark:border-yellow-400/20">
                        {sup.code}
                      </span>
                      <span className="text-xs text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 px-2.5 py-0.5 rounded-lg border border-slate-200 dark:border-slate-800">
                        {sup.productsCount} รายการสินค้า
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">{sup.name}</h3>
                    <div className="text-xs text-slate-500 dark:text-slate-400 space-y-0.5 pt-1">
                      <p>ผู้ติดต่อ: <span className="text-slate-800 dark:text-slate-200 font-medium">{sup.contactPerson}</span></p>
                      <p>เบอร์โทรศัพท์: <span className="text-slate-800 dark:text-slate-200 font-mono font-medium">{sup.phone}</span></p>
                      {sup.email && <p>อีเมล: <span className="text-slate-800 dark:text-slate-200 font-medium">{sup.email}</span></p>}
                      <p className="text-slate-500">{sup.address}</p>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                    <button
                      onClick={() => handleOpenBatchModal('in', undefined, sup.id)}
                      className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-bold flex items-center gap-1"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>เปิดใบรับสินค้าจากเจ้านี้</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL: BATCH STOCK OPERATION (รับเข้า / จ่ายออก / ปรับปรุง แบบเลือกเพิ่มสินค้าข้างใน) */}
      {/* ========================================================================= */}
      {batchModalMode && (
        <div className="fixed inset-0 z-50 bg-black/70 dark:bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-3xl max-w-6xl w-full p-5 sm:p-6 shadow-2xl space-y-5 max-h-[92vh] flex flex-col text-slate-900 dark:text-slate-100">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg ${
                    batchModalMode === 'in'
                      ? 'bg-red-600 text-white shadow-red-600/30'
                      : batchModalMode === 'out'
                      ? 'bg-yellow-500 text-slate-950 shadow-yellow-500/20'
                      : 'bg-slate-100 dark:bg-slate-800 text-yellow-600 dark:text-yellow-400 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {batchModalMode === 'in' ? (
                    <PlusCircle className="w-6 h-6 stroke-[2.5]" />
                  ) : batchModalMode === 'out' ? (
                    <MinusCircle className="w-6 h-6 stroke-[2.5]" />
                  ) : (
                    <Sliders className="w-6 h-6" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        batchModalMode === 'in'
                          ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/30'
                          : batchModalMode === 'out'
                          ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-800 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-500/30'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {batchModalMode === 'in'
                        ? 'เอกสารรับสินค้าเข้าคลัง (STOCK IN)'
                        : batchModalMode === 'out'
                        ? 'เอกสารจ่ายออก / เบิกใช้ (STOCK OUT)'
                        : 'เอกสารตรวจนับ & ปรับปรุงสต็อก (STOCK ADJUST)'}
                    </span>
                    <span className="text-xs font-mono font-bold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-800">
                      เลขที่: {batchDocRef}
                    </span>
                  </div>
                  <h2 className="text-lg font-black text-slate-900 dark:text-white mt-0.5">
                    {batchModalMode === 'in'
                      ? 'บันทึกรับสินค้าเข้าสต็อก (แบบรวมหลายรายการ)'
                      : batchModalMode === 'out'
                      ? 'บันทึกจ่ายสินค้าออกจากคลัง (แบบรวมหลายรายการ)'
                      : 'บันทึกตรวจนับและปรับปรุงยอดสต็อกจริง'}
                  </h2>
                </div>
              </div>

              <button
                onClick={() => setBatchModalMode(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Document Details Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shrink-0">
              {batchModalMode === 'in' && (
                <div className="sm:col-span-4">
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    ซัพพลายเออร์ / ผู้จัดส่งคู่ค้า
                  </label>
                  <select
                    value={batchSupplier}
                    onChange={(e) => setBatchSupplier(e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-yellow-500"
                  >
                    <option value="">-- ไม่ระบุซัพพลายเออร์ --</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className={batchModalMode === 'in' ? 'sm:col-span-4' : 'sm:col-span-12'}>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  เหตุผลการทำรายการ / หมายเลขอ้างอิง PO / หมายเหตุ
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    value={batchReason}
                    onChange={(e) => setBatchReason(e.target.value)}
                    placeholder="เช่น สั่งซื้อประจำงวด PO-992, เบิกใช้งานหน้าร้าน, ตรวจนับสิ้นวัน"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-yellow-500"
                  />
                </div>
              </div>

              {batchModalMode === 'in' && (
                <div className="sm:col-span-4">
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    ส่วนลดท้ายเอกสาร
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={batchDiscountType}
                      onChange={(e) => setBatchDiscountType(e.target.value as 'amount' | 'percent')}
                      className="w-24 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-2 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-yellow-500"
                    >
                      <option value="amount">บาท</option>
                      <option value="percent">เปอร์เซ็นต์</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      max={batchDiscountType === 'percent' ? '100' : undefined}
                      step="0.01"
                      value={batchDiscountInput}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => {
                        const normalized = normalizeDecimalInput(e.currentTarget.value);
                        if (e.currentTarget.value !== normalized) e.currentTarget.value = normalized;
                        setBatchDiscountInput(normalized);
                      }}
                      onBlur={() => {
                        if (batchDiscountInput === '' || batchDiscountInput.endsWith('.')) {
                          setBatchDiscountInput(String(Number.parseFloat(batchDiscountInput) || 0));
                        }
                      }}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono text-right focus:outline-none focus:border-yellow-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Content Container (Split / Stack Layout) */}
            <div className="flex-1 overflow-y-auto space-y-4 min-h-0 custom-scrollbar pr-1">
              {/* BUTTON & DRAWER TO SELECT & ADD PRODUCTS */}
              <div className="bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-yellow-700 dark:text-yellow-400">
                      + เลือกเพิ่มสินค้าเข้าเอกสารนี้:
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      (คลิกที่การ์ดสินค้าเพื่อเพิ่มลงในรายการ)
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsPickerOpen(!isPickerOpen)}
                    className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-white border border-slate-300 dark:border-slate-700 flex items-center gap-1.5 transition-colors shadow-xs"
                  >
                    <span>{isPickerOpen ? 'ซ่อนรายการเลือก' : 'แสดงรายการเลือกสินค้า'}</span>
                    <ChevronRight
                      className={`w-3.5 h-3.5 transition-transform ${isPickerOpen ? 'rotate-90' : ''}`}
                    />
                  </button>
                </div>

                {isPickerOpen && (
                  <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800/80">
                    {/* Picker Search & Category bar */}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          value={pickerSearch}
                          onChange={(e) => setPickerSearch(e.target.value)}
                          placeholder="ค้นหาชื่อสินค้า, SKU, บาร์โค้ดเพื่อเลือก..."
                          className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-yellow-500"
                        />
                      </div>

                      <select
                        value={pickerCategory}
                        onChange={(e) => setPickerCategory(e.target.value)}
                        className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-yellow-500"
                      >
                        {categoryIds.map((c) => (
                          <option key={c} value={c}>
                            {c === 'all' ? 'ทุกหมวดหมู่' : categoryName(c)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Product Cards Grid in Picker */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-48 overflow-y-auto p-1 custom-scrollbar">
                      {pickerFilteredProducts.map((prod) => {
                        const inBatch = batchItems.find((b) => b.productId === prod.id);

                        return (
                          <button
                            type="button"
                            key={prod.id}
                            onClick={() => handleAddProductToBatch(prod)}
                            className={`p-2 rounded-xl border text-left flex items-center gap-2 transition-all hover:scale-[1.01] active:scale-95 ${
                              inBatch
                                ? 'bg-red-50 dark:bg-red-600/15 border-red-300 dark:border-red-500/60 ring-1 ring-red-400 dark:ring-red-500/40'
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600'
                            }`}
                          >
                            <img
                              src={prod.image}
                              alt={prod.name}
                              referrerPolicy="no-referrer"
                              className="w-9 h-9 rounded-lg object-cover bg-slate-100 dark:bg-slate-950 shrink-0 border border-slate-200 dark:border-slate-800"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                {prod.name}
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
                                <span>คงเหลือ: {prod.stock}</span>
                                {inBatch && (
                                  <span className="text-yellow-700 dark:text-yellow-400 font-bold">
                                    ✓ {inBatch.quantity}
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* LIST OF SELECTED LINE ITEMS IN BATCH */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                  <span>
                    รายการสินค้าที่เลือกไว้ในเอกสาร ({batchItems.length} รายการ):
                  </span>
                  {batchItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setBatchItems([])}
                      className="text-red-600 dark:text-red-400 hover:underline text-[11px]"
                    >
                      ล้างรายการทั้งหมด
                    </button>
                  )}
                </div>

                {batchItems.length === 0 ? (
                  <div className="p-8 text-center bg-slate-50 dark:bg-slate-950 rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 text-slate-500 space-y-1">
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-400">ยังไม่ได้เลือกสินค้าในเอกสารนี้</p>
                    <p className="text-[11px]">
                      กรุณากดเลือกสินค้าจากกล่องด้านบน เพื่อเพิ่มรายการลงในเอกสาร
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {batchItems.map((item, index) => {
                      const beforeStock = item.product.stock;
                      let afterStock = beforeStock;
                      if (batchModalMode === 'in') afterStock = beforeStock + item.quantity;
                      if (batchModalMode === 'out')
                        afterStock = Math.max(0, beforeStock - item.quantity);
                      if (batchModalMode === 'adjust') afterStock = item.quantity;
                      const stockDelta = afterStock - beforeStock;
                      const beforeValue = beforeStock * item.cost;
                      const afterValue = afterStock * item.cost;

                      return (
                        <div
                          key={item.productId}
                          className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                        >
                          {/* Left: Product Info */}
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <span className="text-xs font-mono text-slate-400 dark:text-slate-500 w-5">
                              #{index + 1}
                            </span>
                            <img
                              src={item.product.image}
                              alt={item.product.name}
                              referrerPolicy="no-referrer"
                              className="w-11 h-11 rounded-xl object-cover bg-slate-100 dark:bg-slate-900 shrink-0 border border-slate-200 dark:border-slate-800"
                            />
                            <div className="min-w-0">
                              <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                                {item.product.name}
                              </h4>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono flex items-center gap-2">
                                <span>SKU: {item.product.sku}</span>
                                <span>•</span>
                                <span className="text-slate-700 dark:text-slate-300">
                                  สต็อกเดิม: <strong>{beforeStock}</strong> {item.product.unit}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Center: Stepper / Input Control */}
                          <div className="flex items-center gap-3 flex-wrap">
                            {/* Quantity Stepper */}
                            <div>
                              <span className="text-[10px] text-slate-500 dark:text-slate-400 block mb-0.5">
                                {batchModalMode === 'in'
                                  ? 'จำนวนรับเข้า'
                                  : batchModalMode === 'out'
                                  ? 'จำนวนจ่ายออก'
                                  : 'ยอดนับได้จริง (New)'}
                              </span>
                              <div className="flex items-center bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-0.5 shadow-xs">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateBatchItem(item.productId, {
                                      quantity: Math.max(
                                        batchModalMode === 'adjust' ? 0 : 1,
                                        item.quantity - 1
                                      ),
                                    })
                                  }
                                  className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center font-bold"
                                >
                                  -
                                </button>
                                <input
                                  type="number"
                                  min={batchModalMode === 'adjust' ? '0' : '1'}
                                  max={batchModalMode === 'out' ? item.product.stock : undefined}
                                  value={item.quantity}
                                  onFocus={(e) => e.currentTarget.select()}
                                  onChange={(e) => {
                                    const normalized = normalizeWholeNumberInput(e.currentTarget.value);
                                    if (e.currentTarget.value !== normalized) e.currentTarget.value = normalized;
                                    const parsed = normalized === '' ? Number.NaN : Number.parseInt(normalized, 10);
                                    const nextQuantity = batchModalMode === 'out'
                                      ? Math.min(item.product.stock, parsed || 1)
                                      : parsed || (batchModalMode === 'adjust' ? 0 : 1);
                                    if (normalized !== '' && e.currentTarget.value !== String(nextQuantity)) {
                                      e.currentTarget.value = String(nextQuantity);
                                    }
                                    handleUpdateBatchItem(item.productId, {
                                      quantity: nextQuantity,
                                    });
                                  }}
                                  className="w-14 text-center font-mono font-black text-sm bg-transparent text-slate-900 dark:text-yellow-400 focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateBatchItem(item.productId, {
                                      quantity:
                                        batchModalMode === 'out'
                                          ? Math.min(item.product.stock, item.quantity + 1)
                                          : item.quantity + 1,
                                    })
                                  }
                                  className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center font-bold"
                                >
                                  +
                                </button>
                              </div>
                            </div>

                            {/* Cost Input for Stock In */}
                            {batchModalMode === 'in' && (
                              <div>
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 block mb-0.5">
                                  ต้นทุน/หน่วย (฿)
                                </span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={item.cost}
                                  onFocus={(e) => e.currentTarget.select()}
                                  onChange={(e) => {
                                    const normalized = normalizeDecimalInput(e.currentTarget.value);
                                    if (e.currentTarget.value !== normalized) e.currentTarget.value = normalized;
                                    handleUpdateBatchItem(item.productId, {
                                      cost: Number.parseFloat(normalized) || 0,
                                    });
                                  }}
                                  className="w-20 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-2 py-1.5 text-xs text-slate-900 dark:text-white font-mono text-right focus:outline-none focus:border-yellow-500"
                                />
                              </div>
                            )}

                            {/* Stock After Delta Indicator */}
                            <div className="text-right min-w-[85px]">
                              <span className="text-[10px] text-slate-500 dark:text-slate-400 block">สต็อกหลังทำ</span>
                              <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">
                                {afterStock} {item.product.unit}
                              </span>
                            </div>

                            {batchModalMode === 'adjust' && (
                              <div className="text-right min-w-[92px]">
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 block">
                                  ยอดเพิ่ม/ลด
                                </span>
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-black font-mono ${
                                    stockDelta > 0
                                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                                      : stockDelta < 0
                                      ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400'
                                      : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                  }`}
                                >
                                  {stockDelta > 0
                                    ? `เพิ่ม +${stockDelta}`
                                    : stockDelta < 0
                                    ? `ลด ${stockDelta}`
                                    : 'ไม่เปลี่ยน'}
                                </span>
                              </div>
                            )}

                            {/* Line Total */}
                            {batchModalMode === 'adjust' ? (
                              <div className="grid min-w-[190px] grid-cols-2 gap-2 rounded-xl bg-white px-2.5 py-1.5 text-right dark:bg-slate-900">
                                <div>
                                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block">
                                    มูลค่าก่อน
                                  </span>
                                  <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                                    {formatCurrency(
                                      beforeValue,
                                      settings.currencySymbol,
                                      settings.decimalPlaces
                                    )}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block">
                                    มูลค่าหลัง
                                  </span>
                                  <span className="text-xs font-mono font-black text-yellow-600 dark:text-yellow-400">
                                    {formatCurrency(
                                      afterValue,
                                      settings.currencySymbol,
                                      settings.decimalPlaces
                                    )}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div className="text-right min-w-[90px]">
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 block">มูลค่ารวม</span>
                                <span className="text-xs font-mono font-black text-yellow-600 dark:text-yellow-400">
                                  {formatCurrency(
                                    item.quantity * item.cost,
                                    settings.currencySymbol,
                                    settings.decimalPlaces
                                  )}
                                </span>
                              </div>
                            )}

                            {/* Delete Button */}
                            <button
                              type="button"
                              onClick={() => handleRemoveBatchItem(item.productId)}
                              className="p-2 text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-slate-200 dark:hover:bg-slate-900 rounded-xl transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Footer Summary & Confirmation */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0 bg-white dark:bg-slate-900">
              {/* Stats Banner */}
              {batchModalMode === 'adjust' ? (
                <div className="grid w-full flex-1 grid-cols-2 gap-2 text-xs lg:grid-cols-4">
                  <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950">
                    <span className="text-slate-500 dark:text-slate-400 block">รายการรวม</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white">
                      {batchItems.length} รายการ
                    </span>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950">
                    <span className="text-slate-500 dark:text-slate-400 block">จำนวนก่อน → หลัง</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white font-mono">
                      {adjustmentBeforeUnits} → {adjustmentAfterUnits} ชิ้น
                    </span>
                    <span
                      className={`block text-[11px] font-bold font-mono ${
                        adjustmentUnitDelta > 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : adjustmentUnitDelta < 0
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-slate-500'
                      }`}
                    >
                      {adjustmentUnitDelta > 0
                        ? `เพิ่มขึ้น +${adjustmentUnitDelta}`
                        : adjustmentUnitDelta < 0
                        ? `ลดลง ${adjustmentUnitDelta}`
                        : 'ยอดคงเดิม'}
                    </span>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950">
                    <span className="text-slate-500 dark:text-slate-400 block">มูลค่าก่อนปรับ</span>
                    <span className="text-sm font-black text-slate-900 dark:text-white font-mono">
                      {formatCurrency(
                        adjustmentBeforeValue,
                        settings.currencySymbol,
                        settings.decimalPlaces
                      )}
                    </span>
                  </div>
                  <div className="rounded-xl border border-yellow-300 bg-yellow-50 px-3 py-2 dark:border-yellow-500/30 dark:bg-yellow-500/10">
                    <span className="text-yellow-700 dark:text-yellow-400 block">มูลค่าหลังปรับ</span>
                    <span className="text-base font-black text-yellow-700 dark:text-yellow-400 font-mono">
                      {formatCurrency(
                        adjustmentAfterValue,
                        settings.currencySymbol,
                        settings.decimalPlaces
                      )}
                    </span>
                    <span
                      className={`block text-[11px] font-bold font-mono ${
                        adjustmentValueDelta > 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : adjustmentValueDelta < 0
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-slate-500'
                      }`}
                    >
                      {adjustmentValueDelta > 0 ? '+' : ''}
                      {formatCurrency(
                        adjustmentValueDelta,
                        settings.currencySymbol,
                        settings.decimalPlaces
                      )}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4 text-xs">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 block">รายการรวม:</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white">
                      {batchItems.length} รายการ
                    </span>
                  </div>
                  <div className="border-l border-slate-200 dark:border-slate-800 pl-4">
                    <span className="text-slate-500 dark:text-slate-400 block">ยอดรวมจำนวนชิ้น:</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white font-mono">
                      {batchTotalUnits} ชิ้น
                    </span>
                  </div>
                  {batchModalMode === 'in' ? (
                    <>
                      <div className="border-l border-slate-200 dark:border-slate-800 pl-4">
                        <span className="text-slate-500 dark:text-slate-400 block">ยอดก่อนส่วนลด:</span>
                        <span className="text-sm font-bold text-slate-900 dark:text-white font-mono">
                          {formatCurrency(batchTotalValue, settings.currencySymbol, 2)}
                        </span>
                      </div>
                      <div className="border-l border-slate-200 dark:border-slate-800 pl-4">
                        <span className="text-slate-500 dark:text-slate-400 block">ส่วนลด:</span>
                        <span className={`text-sm font-bold font-mono ${discountInvalid ? 'text-red-600 dark:text-red-400' : 'text-red-500'}`}>
                          -{formatCurrency(discountSatang / 100, settings.currencySymbol, 2)}
                        </span>
                      </div>
                      <div className="border-l border-slate-200 dark:border-slate-800 pl-4">
                        <span className="text-slate-500 dark:text-slate-400 block">ยอดสุทธิ:</span>
                        <span className="text-base font-black text-yellow-600 dark:text-yellow-400 font-mono">
                          {formatCurrency(batchNetValue, settings.currencySymbol, 2)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="border-l border-slate-200 dark:border-slate-800 pl-4">
                      <span className="text-slate-500 dark:text-slate-400 block">มูลค่ารวมทั้งสิ้น:</span>
                      <span className="text-base font-black text-yellow-600 dark:text-yellow-400 font-mono">
                        {formatCurrency(batchTotalValue, settings.currencySymbol, settings.decimalPlaces)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setBatchModalMode(null)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold"
                >
                  ยกเลิก
                </button>

                <button
                  type="button"
                  id="confirm-save-batch-btn"
                  disabled={batchItems.length === 0 || isSavingBatch || discountInvalid}
                  onClick={handleSubmitBatch}
                  className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-extrabold text-xs shadow-md transition-all ${
                    batchItems.length === 0 || isSavingBatch || discountInvalid
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-200 dark:border-slate-700'
                      : batchModalMode === 'in'
                      ? 'bg-gradient-to-r from-red-600 via-red-500 to-red-600 text-white shadow-red-600/30 active:scale-95'
                      : 'bg-yellow-500 hover:bg-yellow-400 text-slate-950 shadow-yellow-500/20 active:scale-95'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4 text-yellow-300 stroke-[2.5]" />
                  <span>
                    {isSavingBatch ? 'กำลังบันทึก...' : `บันทึกเอกสารสต็อกรวม (${batchItems.length} รายการ)`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: VIEW BATCH DETAILS */}
      {/* ========================================================================= */}
      {selectedBatchForDetails && (
        <div className="fixed inset-0 z-50 bg-black/70 dark:bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-3xl max-w-6xl w-full p-5 sm:p-6 shadow-2xl space-y-4 max-h-[92vh] flex flex-col text-slate-900 dark:text-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg ${
                  selectedBatchForDetails.type === 'in'
                    ? 'bg-red-600 text-white shadow-red-600/30'
                    : selectedBatchForDetails.type === 'out'
                    ? 'bg-yellow-500 text-slate-950 shadow-yellow-500/20'
                    : 'bg-slate-100 dark:bg-slate-800 text-orange-600 dark:text-orange-400 border border-slate-200 dark:border-slate-700'
                }`}>
                  {selectedBatchForDetails.type === 'in' ? (
                    <PlusCircle className="w-6 h-6 stroke-[2.5]" />
                  ) : selectedBatchForDetails.type === 'out' ? (
                    <MinusCircle className="w-6 h-6 stroke-[2.5]" />
                  ) : (
                    <Sliders className="w-6 h-6" />
                  )}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                      selectedBatchForDetails.type === 'in'
                        ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/30'
                        : selectedBatchForDetails.type === 'out'
                        ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-800 dark:text-yellow-400 border-yellow-300 dark:border-yellow-500/30'
                        : 'bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/30'
                    }`}>
                      {selectedBatchForDetails.type === 'in'
                        ? 'เอกสารรับสินค้าเข้าคลัง (STOCK IN)'
                        : selectedBatchForDetails.type === 'out'
                        ? 'เอกสารจ่ายออก / เบิกใช้ (STOCK OUT)'
                        : 'เอกสารตรวจนับ & ปรับปรุงสต็อก (STOCK ADJUST)'}
                    </span>
                    <span className="text-xs font-mono font-bold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-800">
                      เลขที่: {selectedBatchForDetails.referenceNo}
                    </span>
                  </div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white mt-0.5">
                    {selectedBatchForDetails.type === 'in'
                      ? 'รายละเอียดการรับสินค้าเข้าสต็อก'
                      : selectedBatchForDetails.type === 'out'
                      ? 'รายละเอียดการจ่ายสินค้าออกจากคลัง'
                      : 'รายละเอียดการตรวจนับและปรับปรุงยอดสต็อกจริง'}
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setSelectedBatchForDetails(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 dark:bg-slate-950 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs shrink-0">
              <div>
                <span className="text-slate-500 dark:text-slate-400 block text-[11px]">รายการสินค้า:</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  {selectedBatchForDetails.itemsCount} รายการ
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block text-[11px]">วันที่บันทึก:</span>
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  {formatThaiDateTime(selectedBatchForDetails.createdAt)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block text-[11px]">ผู้ทำรายการ:</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  {selectedBatchForDetails.performedBy}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block text-[11px]">
                  {selectedBatchForDetails.type === 'in' ? 'ยอดสุทธิ:' : 'มูลค่ารายการ:'}
                </span>
                <span className="font-black text-yellow-600 dark:text-yellow-400 font-mono">
                  {formatCurrency(selectedBatchForDetails.netTotalValue ?? selectedBatchForDetails.totalCostValue, settings.currencySymbol, 2)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs shrink-0">
              {selectedBatchForDetails.type === 'in' && (
                <div className="sm:col-span-4">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">ซัพพลายเออร์ / ผู้จัดส่งคู่ค้า</span>
                  <span className="font-bold text-slate-900 dark:text-white">{selectedBatchForDetails.supplierName || 'ไม่ระบุซัพพลายเออร์'}</span>
                </div>
              )}
              <div className={selectedBatchForDetails.type === 'in' ? 'sm:col-span-8' : 'sm:col-span-12'}>
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">เหตุผลการทำรายการ / หมายเหตุ</span>
                <span className="font-medium text-slate-900 dark:text-white">{selectedBatchForDetails.reason || '-'}</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 min-h-0 custom-scrollbar pr-1">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                <span>รายการสินค้าในเอกสาร ({selectedBatchForDetails.items.length} รายการ):</span>
              </div>
              {selectedBatchForDetails.items.map((item, index) => {
                const previousCost = item.previousCostPerUnit ?? item.costPerUnit ?? 0;
                const resultingCost = item.resultingCostPerUnit ?? item.costPerUnit ?? 0;
                const beforeValue = item.beforeStock * previousCost;
                const afterValue = item.afterStock * resultingCost;
                const valueDelta = afterValue - beforeValue;
                const productImage = products.find((product) => product.id === item.productId)?.image || DEFAULT_PRODUCT_IMAGE;
                return (
                  <div key={item.id} className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="text-xs font-mono text-slate-400 dark:text-slate-500 w-5">#{index + 1}</span>
                      <img src={productImage} alt={item.productName} className="w-11 h-11 rounded-xl object-cover bg-slate-100 dark:bg-slate-900 shrink-0 border border-slate-200 dark:border-slate-800" />
                      <div className="min-w-0">
                        <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">{item.productName}</h4>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">SKU: {item.productSku || '-'}</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-3 flex-wrap">
                      <div className="text-right min-w-[82px]">
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 block">
                          {selectedBatchForDetails.type === 'in' ? 'จำนวนรับเข้า' : selectedBatchForDetails.type === 'out' ? 'จำนวนจ่ายออก' : 'ยอดเพิ่ม/ลด'}
                        </span>
                        <span className={`text-sm font-mono font-black ${
                          selectedBatchForDetails.type === 'in'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : selectedBatchForDetails.type === 'out'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-orange-600 dark:text-orange-400'
                        }`}>
                          {selectedBatchForDetails.type === 'out' ? Math.abs(item.quantity) : item.quantity > 0 ? `+${item.quantity}` : item.quantity}
                        </span>
                      </div>
                      <div className="text-right min-w-[105px]">
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 block">สต็อกก่อน → หลัง</span>
                        <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">{item.beforeStock} → {item.afterStock}</span>
                      </div>

                      {selectedBatchForDetails.type === 'in' && (
                        <>
                          <div className="text-right min-w-[95px]">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block">ต้นทุนรับ/หน่วย</span>
                            <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">{formatCurrency(item.costPerUnit || 0, settings.currencySymbol, 2)}</span>
                          </div>
                          <div className="grid min-w-[190px] grid-cols-2 gap-2 rounded-xl bg-white px-2.5 py-1.5 text-right dark:bg-slate-900">
                            <div>
                              <span className="text-[10px] text-slate-500 dark:text-slate-400 block">ก่อนลด</span>
                              <span className="text-xs font-mono font-bold">{formatCurrency(item.grossTotalValue || 0, settings.currencySymbol, 2)}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 dark:text-slate-400 block">ส่วนลด / สุทธิ</span>
                              <span className="text-[10px] font-mono text-red-500">-{formatCurrency(item.allocatedDiscountValue || 0, settings.currencySymbol, 2)}</span>
                              <span className="block text-xs font-mono font-black text-yellow-600 dark:text-yellow-400">{formatCurrency(item.netTotalValue || 0, settings.currencySymbol, 2)}</span>
                            </div>
                          </div>
                          <div className="text-right min-w-[125px]">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block">ต้นทุนเฉลี่ย ก่อน → หลัง</span>
                            <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">{formatCurrency(previousCost, settings.currencySymbol, 2)} → {formatCurrency(resultingCost, settings.currencySymbol, 2)}</span>
                          </div>
                        </>
                      )}

                      {selectedBatchForDetails.type === 'out' && (
                        <>
                          <div className="text-right min-w-[100px]">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block">ต้นทุนเฉลี่ย/หน่วย</span>
                            <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">{formatCurrency(item.costPerUnit || 0, settings.currencySymbol, 2)}</span>
                          </div>
                          <div className="text-right min-w-[100px]">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block">มูลค่าจ่ายออก</span>
                            <span className="text-xs font-mono font-black text-yellow-600 dark:text-yellow-400">{formatCurrency(item.netTotalValue || 0, settings.currencySymbol, 2)}</span>
                          </div>
                        </>
                      )}

                      {selectedBatchForDetails.type === 'adjust' && (
                        <div className="grid min-w-[270px] grid-cols-3 gap-2 rounded-xl bg-white px-2.5 py-1.5 text-right dark:bg-slate-900">
                          <div>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block">มูลค่าก่อน</span>
                            <span className="text-xs font-mono font-bold">{formatCurrency(beforeValue, settings.currencySymbol, 2)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block">มูลค่าหลัง</span>
                            <span className="text-xs font-mono font-black text-yellow-600 dark:text-yellow-400">{formatCurrency(afterValue, settings.currencySymbol, 2)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block">ผลต่าง</span>
                            <span className={`text-xs font-mono font-black ${valueDelta > 0 ? 'text-emerald-600 dark:text-emerald-400' : valueDelta < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500'}`}>
                              {valueDelta > 0 ? '+' : ''}{formatCurrency(valueDelta, settings.currencySymbol, 2)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
              {selectedBatchForDetails.type === 'in' ? (
                <div className="flex items-center gap-4 text-xs">
                  <div><span className="text-slate-500 block">ยอดก่อนลด</span><strong className="font-mono">{formatCurrency(selectedBatchForDetails.grossTotalValue || 0, settings.currencySymbol, 2)}</strong></div>
                  <div className="border-l border-slate-200 dark:border-slate-800 pl-4"><span className="text-slate-500 block">ส่วนลด</span><strong className="font-mono text-red-500">-{formatCurrency(selectedBatchForDetails.discountValue || 0, settings.currencySymbol, 2)}</strong></div>
                  <div className="border-l border-slate-200 dark:border-slate-800 pl-4"><span className="text-slate-500 block">ยอดสุทธิ</span><strong className="text-base font-mono text-yellow-600 dark:text-yellow-400">{formatCurrency(selectedBatchForDetails.netTotalValue || 0, settings.currencySymbol, 2)}</strong></div>
                </div>
              ) : selectedBatchForDetails.type === 'adjust' ? (
                <div className="grid grid-cols-3 gap-2 text-xs flex-1 w-full">
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-950 px-3 py-2"><span className="text-slate-500 block">จำนวนเพิ่ม/ลด</span><strong className="font-mono text-orange-600 dark:text-orange-400">{detailQuantityDelta > 0 ? '+' : ''}{detailQuantityDelta}</strong></div>
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-950 px-3 py-2"><span className="text-slate-500 block">มูลค่าก่อน</span><strong className="font-mono">{formatCurrency(detailBeforeValue, settings.currencySymbol, 2)}</strong></div>
                  <div className="rounded-xl bg-yellow-50 dark:bg-yellow-500/10 px-3 py-2"><span className="text-yellow-700 dark:text-yellow-400 block">มูลค่าหลัง</span><strong className="font-mono text-yellow-700 dark:text-yellow-400">{formatCurrency(detailAfterValue, settings.currencySymbol, 2)}</strong></div>
                </div>
              ) : (
                <div className="text-xs"><span className="text-slate-500 block">มูลค่าจ่ายออกรวม</span><strong className="text-base font-mono text-yellow-600 dark:text-yellow-400">{formatCurrency(selectedBatchForDetails.totalCostValue, settings.currencySymbol, 2)}</strong></div>
              )}
              <button
                onClick={() => setSelectedBatchForDetails(null)}
                className="px-5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-800 dark:text-white"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD SUPPLIER */}
      {/* ========================================================================= */}
      {isAddSupplierModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 dark:bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-slate-900 dark:text-slate-100">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-red-600 dark:text-red-500 uppercase tracking-wider">
                  เพิ่มคู่ค้าใหม่
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">เพิ่มซัพพลายเออร์ใหม่</h3>
              </div>
              <button
                onClick={() => setIsAddSupplierModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSupplierSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  ชื่อบริษัท / ร้านค้าคู่ค้า *
                </label>
                <input
                  type="text"
                  required
                  value={newSupplierData.name}
                  onChange={(e) =>
                    setNewSupplierData({ ...newSupplierData, name: e.target.value })
                  }
                  placeholder="เช่น บจก. สยาม โพรดิวส์ แอนด์ ซัพพลาย"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-yellow-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    ผู้ติดต่อ
                  </label>
                  <input
                    type="text"
                    value={newSupplierData.contactPerson}
                    onChange={(e) =>
                      setNewSupplierData({
                        ...newSupplierData,
                        contactPerson: e.target.value,
                      })
                    }
                    placeholder="คุณวิชัย"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-yellow-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    เบอร์โทรศัพท์ *
                  </label>
                  <input
                    type="text"
                    required
                    value={newSupplierData.phone}
                    onChange={(e) =>
                      setNewSupplierData({ ...newSupplierData, phone: e.target.value })
                    }
                    placeholder="081-xxx-xxxx"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-yellow-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  ที่อยู่สำนักงาน / คลังจัดส่ง
                </label>
                <input
                  type="text"
                  value={newSupplierData.address}
                  onChange={(e) =>
                    setNewSupplierData({ ...newSupplierData, address: e.target.value })
                  }
                  placeholder="เขต/อำเภอ, จังหวัด"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-yellow-500"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddSupplierModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-500 text-white text-xs font-bold shadow-md shadow-red-600/30"
                >
                  บันทึกซัพพลายเออร์
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
