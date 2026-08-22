import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  Product,
  CartItem,
  Order,
  OrderItem,
  HeldOrder,
  StockMovement,
  StockBatchSummary,
  StockSummary,
  Supplier,
  StoreSettings,
  Category,
  UnitItem,
  NoteOption,
} from '../types';
import {
  INITIAL_SETTINGS,
  INITIAL_PRODUCTS,
  INITIAL_CATEGORIES,
  INITIAL_UNITS,
  INITIAL_NOTE_OPTIONS,
} from '../data/mockData';
import confetti from 'canvas-confetti';
import { DEFAULT_PRODUCT_IMAGE } from '../constants/product';
import {
  createPOSCatalog,
  createPOSProduct,
  deactivatePOSProduct,
  deletePOSCatalog,
  listPOSCategories,
  listPOSProducts,
  listPOSUnits,
  POSApiError,
  POSCatalogItem,
  POSProductRecord,
  updatePOSCatalog,
  updatePOSProduct,
} from '../api/posCatalog';
import {
  createPOSSupplier,
  createPOSStockBatch,
  deletePOSSupplier,
  getPOSStockSummary,
  listPOSStockBatches,
  listPOSStockMovements,
  listPOSSuppliers,
  POSStockBatchInput,
  POSStockBatchRecord,
  POSStockMovementRecord,
  POSSupplierRecord,
  updatePOSSupplier,
} from '../api/posStock';
import {
  createPOSSale,
  getPOSBillingSummary,
  getPOSSettings,
  listPOSMembers,
  listPOSPaymentHistory,
  listPOSReceivables,
  listPOSSales,
  POSMember,
  POSSale,
  savePOSSettings,
  settlePOSAccount,
  voidPOSSale,
} from '../api/posSales';

interface PosContextType {
  activeTab: 'dashboard' | 'pos' | 'bills' | 'products' | 'stock' | 'reports' | 'settings' | 'customer-display';
  setActiveTab: (tab: 'dashboard' | 'pos' | 'bills' | 'products' | 'stock' | 'reports' | 'settings' | 'customer-display') => void;
  
  // Theme
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;

  // Settings
  settings: StoreSettings;
  updateSettings: (newSettings: Partial<StoreSettings>) => Promise<boolean>;
  members: POSMember[];

  // Categories & Units
  categories: Category[];
  addCategory: (category: Omit<Category, 'id'>) => Category;
  updateCategory: (id: string, updated: Partial<Category>) => void;
  deleteCategory: (id: string) => void;

  units: UnitItem[];
  addUnit: (name: string) => UnitItem;
  updateUnit: (id: string, name: string) => void;
  deleteUnit: (id: string) => void;

  // Note Options (ตัวเลือกโน้ต & ส่วนผสม)
  noteOptions: NoteOption[];
  addNoteOption: (note: Omit<NoteOption, 'id'>) => NoteOption;
  updateNoteOption: (id: string, updated: Partial<NoteOption>) => void;
  deleteNoteOption: (id: string) => void;

  // Products
  products: Product[];
  addProduct: (product: Omit<Product, 'id'>) => void;
  updateProduct: (id: string, updated: Partial<Product>) => void;
  deleteProduct: (id: string) => void;

  // Cart
  cart: CartItem[];
  addToCart: (product: Product, quantity?: number, note?: string) => void;
  updateCartQuantity: (productId: string, quantity: number) => void;
  updateCartItemNote: (productId: string, note: string) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;
  discount: number;
  discountType: 'amount' | 'percent';
  setDiscount: (amount: number, type?: 'amount' | 'percent') => void;
  cartTotals: {
    itemCount: number;
    subtotal: number;
    discountAmount: number;
    netBeforeVat: number;
    vatAmount: number;
    total: number;
  };

  // Customer Display synchronization helper
  broadcastCustomerDisplay: (data: {
    type: 'CART_UPDATE' | 'PAYMENT_MODAL_STATE' | 'ORDER_COMPLETED' | 'CLEAR_THANK_YOU';
    payload: any;
  }) => void;
  openCustomerDisplayWindow: () => void;

  // Held Orders
  heldOrders: HeldOrder[];
  holdCurrentCart: (memberId: string, customerName: string) => Promise<boolean>;
  resumeHeldOrder: (heldId: string) => void;
  deleteHeldOrder: (heldId: string) => void;
  batchDeleteHeldOrders: (heldIds: string[]) => void;
  mergeHeldOrdersIntoCart: (heldIds: string[]) => void;
  processBatchHeldPayment: (params: {
    heldIds: string[];
    paymentMethod: 'cash' | 'promptpay' | 'card' | 'transfer';
    cashReceived?: number;
    referenceNumber?: string;
    customerNote?: string;
  }) => Promise<Order | null>;

  // Orders
  orders: Order[];
  processPayment: (params: {
    paymentMethod: 'cash' | 'promptpay' | 'card' | 'transfer';
    cashReceived?: number;
    referenceNumber?: string;
    customerNote?: string;
  }) => Promise<Order | null>;
  refundOrder: (orderId: string, reason?: string) => void;
  cancelOrder: (orderId: string) => void;

  // Stock Management
  stockMovements: StockMovement[];
  stockBatches: StockBatchSummary[];
  stockSummary: StockSummary;
  stockIn: (productId: string, quantity: number, supplierName: string, reason: string, cost?: number) => void;
  stockOut: (productId: string, quantity: number, reason: string) => void;
  adjustStock: (productId: string, newStock: number, reason: string) => void;
  batchStockOperation: (params: {
    type: 'in' | 'out' | 'adjust';
    items: Array<{
      productId: string;
      quantity: number; // for adjust: target stock count, for in/out: quantity delta
      cost?: number;
      note?: string;
    }>;
    supplierName?: string;
    supplierId?: string;
    reason: string;
    referenceNo?: string;
    discountType?: 'none' | 'amount' | 'percent';
    discountAmountSatang?: number;
    discountRateBps?: number;
  }) => Promise<boolean>;

  // Suppliers
  suppliers: Supplier[];
  addSupplier: (supplier: Omit<Supplier, 'id' | 'productsCount'>) => Promise<boolean>;
  updateSupplier: (id: string, supplier: Partial<Supplier>) => Promise<boolean>;
  deleteSupplier: (id: string) => Promise<boolean>;

  // Receipt Modal State
  selectedOrderForReceipt: Order | null;
  setSelectedOrderForReceipt: (order: Order | null) => void;

  // Audio & Toast Helpers
  playBeep: (type?: 'beep' | 'success' | 'alert' | 'info') => void;
  toast: { message: string; type: 'success' | 'info' | 'error' | 'warning' } | null;
  showToast: (message: string, type?: 'success' | 'info' | 'error' | 'warning') => void;
}

const PosContext = createContext<PosContextType | undefined>(undefined);

// Web Audio API Sound Synthesizer
const playAudioTone = (type: 'beep' | 'success' | 'alert' | 'info' = 'beep') => {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'beep' || type === 'info') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } else if (type === 'success') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.08); // A5
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } else if (type === 'alert') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(330, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    }
  } catch (e) {
    console.debug('Audio not supported or blocked:', e);
  }
};

export const PosProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'pos' | 'bills' | 'products' | 'stock' | 'reports' | 'settings'>('pos');
  
  // Local storage synced states with fallback
  const [settings, setSettings] = useState<StoreSettings>(() => {
    const saved = localStorage.getItem('siampure_settings');
    return saved ? { ...INITIAL_SETTINGS, ...JSON.parse(saved) } : INITIAL_SETTINGS;
  });

  const [theme, setThemeState] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('siampure_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return 'light';
  });

  const [categories, setCategories] = useState<Category[]>(() => {
    const saved = localStorage.getItem('siampure_categories');
    return saved ? JSON.parse(saved) : INITIAL_CATEGORIES;
  });

  const [units, setUnits] = useState<UnitItem[]>(() => {
    const saved = localStorage.getItem('siampure_units');
    return saved ? JSON.parse(saved) : INITIAL_UNITS;
  });

  const [noteOptions, setNoteOptions] = useState<NoteOption[]>(() => {
    const saved = localStorage.getItem('siampure_note_options');
    return saved ? JSON.parse(saved) : INITIAL_NOTE_OPTIONS;
  });

  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem('siampure_products');
    const initialProducts: Product[] = saved ? JSON.parse(saved) : INITIAL_PRODUCTS;
    return initialProducts.map((product) => ({
      ...product,
      image: product.image || DEFAULT_PRODUCT_IMAGE,
    }));
  });

  const [cart, setCart] = useState<CartItem[]>(() => {
    const saved = localStorage.getItem('siampure_cart');
    return saved ? JSON.parse(saved) : [];
  });

  const [discount, setDiscountState] = useState<number>(() => {
    const saved = localStorage.getItem('siampure_discount');
    return saved ? JSON.parse(saved) : 0;
  });
  const [discountType, setDiscountTypeState] = useState<'amount' | 'percent'>(() => {
    const saved = localStorage.getItem('siampure_discount_type');
    return (saved === 'percent' || saved === 'amount') ? saved : 'amount';
  });

  const [heldOrders, setHeldOrders] = useState<HeldOrder[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [members, setMembers] = useState<POSMember[]>([]);
  const [isBillingPollingActive, setIsBillingPollingActive] = useState(false);

  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [stockBatches, setStockBatches] = useState<StockBatchSummary[]>([]);
  const [stockSummary, setStockSummary] = useState<StockSummary>({
    productCount: 0,
    totalUnits: 0,
    inventoryCostValue: 0,
    inventoryRetailValue: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
    batchCount: 0,
    movementCount: 0,
  });
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const [selectedOrderForReceipt, setSelectedOrderForReceipt] = useState<Order | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' | 'warning' } | null>(null);
  const checkoutRequestIDRef = useRef('');
  const holdRequestIDRef = useRef('');

  // Sync to local storage
  useEffect(() => {
    localStorage.setItem('siampure_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('siampure_theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const setTheme = (newTheme: 'light' | 'dark') => {
    setThemeState(newTheme);
    setSettings((prev) => ({ ...prev, theme: newTheme }));
  };

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    showToast(`สลับเป็นโหมด${next === 'dark' ? 'มืด (Dark Mode)' : 'สว่าง (White Mode)'}`, 'info');
  };

  useEffect(() => {
    localStorage.setItem('siampure_categories', JSON.stringify(categories));
  }, [categories]);

  useEffect(() => {
    localStorage.setItem('siampure_units', JSON.stringify(units));
  }, [units]);

  useEffect(() => {
    localStorage.setItem('siampure_note_options', JSON.stringify(noteOptions));
  }, [noteOptions]);

  useEffect(() => {
    localStorage.setItem('siampure_products', JSON.stringify(products));
  }, [products]);

  const isDisplayCustomerUrl = typeof window !== 'undefined' && (
    window.location.search.includes('display=customer') ||
    window.location.search.includes('display=front') ||
    window.location.search.includes('view=customer-display') ||
    window.location.search.includes('view=customer') ||
    window.location.search.includes('mode=customer')
  );

  useEffect(() => {
    if (!isDisplayCustomerUrl) {
      localStorage.setItem('siampure_cart', JSON.stringify(cart));
    }
  }, [cart, isDisplayCustomerUrl]);

  useEffect(() => {
    if (!isDisplayCustomerUrl) {
      localStorage.setItem('siampure_discount', JSON.stringify(discount));
      localStorage.setItem('siampure_discount_type', discountType);
    }
  }, [discount, discountType, isDisplayCustomerUrl]);

  // Cross-tab / Cross-window state synchronization
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (!e.newValue) return;
      try {
        if (e.key === 'siampure_cart') {
          setCart(JSON.parse(e.newValue));
        } else if (e.key === 'siampure_discount') {
          setDiscountState(JSON.parse(e.newValue));
        } else if (e.key === 'siampure_discount_type') {
          if (e.newValue === 'percent' || e.newValue === 'amount') {
            setDiscountTypeState(e.newValue);
          }
        } else if (e.key === 'siampure_products') {
          setProducts(JSON.parse(e.newValue));
        } else if (e.key === 'siampure_categories') {
          setCategories(JSON.parse(e.newValue));
        } else if (e.key === 'siampure_settings') {
          setSettings(JSON.parse(e.newValue));
        }
      } catch (err) {
        console.error('Storage sync error:', err);
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const showToast = (message: string, type: 'success' | 'info' | 'error' | 'warning' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  const playBeep = (type: 'beep' | 'success' | 'alert' | 'info' = 'beep') => {
    if (settings.enableSoundEffects) {
      playAudioTone(type);
    }
  };

  const catalogCategory = (item: POSCatalogItem): Category => ({
    id: item.id,
    name: item.name,
    icon: item.icon || 'Package',
    color: item.color || '#EF4444',
  });

  const apiProduct = (item: POSProductRecord, catalog: POSCatalogItem[]): Product => ({
    id: item.id,
    sku: item.sku,
    barcode: item.barcode || '',
    name: item.name,
    category: catalog.find((category) => category.name.toLowerCase() === item.category.toLowerCase())?.id || item.category,
    price: item.priceSatang / 100,
    cost: item.costSatang / 100,
    stock: item.stockQuantity,
    minStockAlert: item.lowStockThreshold,
    image: item.imageData || DEFAULT_PRODUCT_IMAGE,
    description: item.description || '',
    unit: item.unit,
    status: item.active ? 'active' : 'inactive',
    noteOptionIds: [],
  });

  const productPayload = (item: Omit<Product, 'id'> | Product) => ({
    sku: item.sku,
    barcode: item.barcode || '',
    category: categories.find((category) => category.id === item.category)?.name || item.category,
    name: item.name,
    priceThb: item.price,
    priceSatang: Math.round(item.price * 100),
    costThb: Math.round(item.cost),
    costSatang: Math.round(item.cost * 100),
    stockQuantity: item.stock,
    lowStockThreshold: item.minStockAlert,
    active: item.status === 'active',
    unit: item.unit,
    imageData: item.image.startsWith('data:image/') ? item.image : '',
    description: item.description || '',
  });

  const saleItemProduct = (item: POSSale['items'][number]): Product => {
    const current = products.find((product) => product.id === item.productId);
    return current || {
      id: item.productId,
      sku: item.sku,
      name: item.productName,
      category: '',
      price: item.unitPriceSatang / 100,
      cost: item.unitCostSatang / 100,
      stock: 0,
      minStockAlert: 0,
      image: DEFAULT_PRODUCT_IMAGE,
      unit: 'ชิ้น',
      status: 'inactive',
    };
  };

  const saleToHeldOrder = (sale: POSSale): HeldOrder => ({
    id: sale.id,
    heldNumber: sale.id,
    customerName: sale.buyerName,
    memberId: members.find((member) => member.billingAccountId === sale.billingAccountId)?.id,
    billingAccountId: sale.billingAccountId,
    items: sale.items.map((item) => ({ product: saleItemProduct(item), quantity: item.quantity, note: item.note })),
    subtotal: sale.subtotalSatang / 100,
    discount: sale.discountType === 'percent' ? sale.discountRateBps / 100 : sale.discountSatang / 100,
    discountType: sale.discountType,
    createdAt: sale.createdAt,
    total: sale.totalSatang / 100,
  });

  const saleToOrder = (sale: POSSale): Order => ({
    id: sale.id,
    orderNumber: sale.id,
    items: sale.items.map((item) => ({ productId: item.productId, name: item.productName, sku: item.sku, price: item.unitPriceSatang / 100, cost: item.unitCostSatang / 100, quantity: item.quantity, total: item.lineTotalSatang / 100, note: item.note })),
    subtotal: sale.subtotalSatang / 100,
    discount: sale.discountSatang / 100,
    discountType: sale.discountType,
    vatAmount: sale.vatSatang / 100,
    vatRate: sale.vatRateBps / 100,
    isVatIncluded: sale.pricesIncludeTax,
    total: sale.totalSatang / 100,
    paymentMethod: sale.paymentMethod || 'cash',
    cashReceived: (sale.cashReceivedSatang || 0) / 100,
    change: (sale.changeSatang || 0) / 100,
    status: sale.status === 'void' ? 'cancelled' : 'completed',
    createdAt: sale.createdAt,
    cashierName: sale.createdByName || 'Admin',
    customerNote: sale.buyerName || undefined,
    referenceNumber: sale.referenceNumber,
    paymentId: sale.paymentId,
  });

  const refreshPOSSales = async () => {
    const [apiMembers, apiSales, apiSettings, apiReceivables, apiPayments] = await Promise.all([listPOSMembers(), listPOSSales(), getPOSSettings(), listPOSReceivables(), listPOSPaymentHistory()]);
    setMembers(apiMembers);
    const openSales = apiSales.filter((sale) => sale.status === 'open');
    setHeldOrders(apiReceivables.map((receivable) => {
      const accountSales = openSales.filter((sale) => sale.billingAccountId === receivable.billingAccountId);
      const posItems = accountSales.flatMap((sale) => sale.items.map((item) => ({ product: saleItemProduct(item), quantity: item.quantity, note: item.note })));
      const matchItems = receivable.lines.filter((line) => line.sourceType === 'match').map((line) => ({
        product: { id: `billing-match-${line.sourceId}`, sku: '', name: line.label, category: '', price: line.amountSatang / 100, cost: 0, stock: 0, minStockAlert: 0, image: DEFAULT_PRODUCT_IMAGE, unit: 'รายการ', status: 'inactive' as const },
        quantity: 1,
      }));
      return {
        id: receivable.billingAccountId,
        heldNumber: `รวม ${receivable.lineCount} รายการ`,
        customerName: receivable.displayName,
        memberId: receivable.memberId,
        billingAccountId: receivable.billingAccountId,
        sourceSaleIds: accountSales.map((sale) => sale.id),
        items: [...matchItems, ...posItems],
        subtotal: receivable.totalSatang / 100,
        discount: 0,
        discountType: 'amount' as const,
        note: `Match ${(receivable.matchTotalSatang / 100).toFixed(2)} · POS ${(receivable.posTotalSatang / 100).toFixed(2)}`,
        createdAt: receivable.calculatedAt,
        total: receivable.totalSatang / 100,
        matchTotal: receivable.matchTotalSatang / 100,
        posTotal: receivable.posTotalSatang / 100,
      } satisfies HeldOrder;
    }));
    setOrders(apiPayments.map((payment) => {
      const items: OrderItem[] = [];
      payment.lines.forEach((line) => {
        const snapshot = line.snapshot || {};
        const snapshotItems = Array.isArray(snapshot.items) ? snapshot.items : [];
        if (snapshotItems.length === 0) {
          items.push({ productId: line.sourceId, name: line.label, sku: '', price: line.amountSatang / 100, cost: 0, quantity: 1, total: line.amountSatang / 100 });
          return;
        }
        snapshotItems.forEach((entry: any, index: number) => {
          const quantity = Number(entry.quantity || 1);
          const amountSatang = Number(entry.amountSatang ?? entry.lineTotalSatang ?? 0);
          items.push({ productId: String(entry.productId || `${line.sourceId}-${index}`), name: String(entry.name || entry.productName || entry.label || line.label), sku: String(entry.sku || ''), price: Number(entry.unitPriceSatang ?? entry.unitAmountSatang ?? (quantity > 0 ? amountSatang / quantity : amountSatang)) / 100, cost: Number(entry.unitCostSatang || 0) / 100, quantity, total: amountSatang / 100, note: entry.note });
        });
      });
      return { id: payment.paymentId, orderNumber: payment.paymentId, items, subtotal: payment.amountSatang / 100, discount: 0, discountType: 'amount' as const, vatAmount: 0, vatRate: 0, isVatIncluded: true, total: payment.amountSatang / 100, paymentMethod: payment.method, cashReceived: (payment.cashReceivedSatang || 0) / 100, change: (payment.changeSatang || 0) / 100, status: 'completed' as const, createdAt: payment.createdAt, cashierName: payment.receivedByName || 'Admin', customerNote: payment.displayName, referenceNumber: payment.referenceNumber, paymentId: payment.paymentId, originSystem: payment.originSystem, matchTotal: payment.matchTotalSatang / 100, posTotal: payment.posTotalSatang / 100, billingLines: payment.lines };
    }));
    setSettings((current) => ({
      ...current,
      promptPayId: apiSettings.promptPayId,
      promptPayType: (apiSettings.promptPayType || 'mobile') as StoreSettings['promptPayType'],
      promptPayReceiverName: apiSettings.promptPayReceiverName,
      inheritBookingPromptPay: apiSettings.inheritBookingPromptPay,
      paymentQrImage: apiSettings.paymentQrImage || '',
      vatEnabled: apiSettings.taxRatePercent > 0,
      vatRate: apiSettings.taxRatePercent || current.vatRate,
      vatType: apiSettings.pricesIncludeTax ? 'included' : 'excluded',
      receiptFooterMessage: apiSettings.receiptFooter || current.receiptFooterMessage,
      theme: apiSettings.theme,
    }));
  };

  const refreshPOSCatalog = async () => {
    try {
      const [apiCategories, apiUnits] = await Promise.all([listPOSCategories(), listPOSUnits()]);
      const firstPage = await listPOSProducts({ page: 1, pageSize: 100, status: 'all' });
      const allProducts = [...firstPage.items];
      for (let nextPage = 2; nextPage <= firstPage.totalPages; nextPage += 1) {
        const result = await listPOSProducts({ page: nextPage, pageSize: 100, status: 'all' });
        allProducts.push(...result.items);
      }
      setCategories(apiCategories.map(catalogCategory));
      setUnits(apiUnits.map((item) => ({ id: item.id, name: item.name })));
      setProducts(allProducts.map((item) => apiProduct(item, apiCategories)));
    } catch (requestError) {
      if (requestError instanceof POSApiError && requestError.status !== 401) {
        showToast(requestError.message, 'error');
      }
    }
  };

  const supplierFromAPI = (item: POSSupplierRecord): Supplier => ({
    id: item.id,
    code: item.code,
    name: item.name,
    contactPerson: item.contactPerson || '',
    phone: item.phone || '',
    email: item.email || '',
    address: item.address || '',
    productsCount: item.productsCount || 0,
  });

  const movementFromAPI = (item: POSStockMovementRecord): StockMovement => ({
    id: String(item.id),
    referenceNo: item.referenceNo || item.batchId || `MOV-${item.id}`,
    batchId: item.batchId,
    productId: item.productId,
    productName: item.productName,
    productSku: item.productSku,
    type: item.type,
    quantity: item.quantity,
    beforeStock: item.beforeStock,
    afterStock: item.afterStock,
    reason: item.reason || 'ทำรายการสต็อก',
    supplierName: item.supplierName,
    costPerUnit: item.unitCostSatang / 100,
    performedBy: item.actorName || 'Admin',
    createdAt: item.createdAt,
    note: item.note,
    grossTotalValue: item.grossTotalSatang / 100,
    allocatedDiscountValue: item.allocatedDiscountSatang / 100,
    netTotalValue: item.netTotalSatang / 100,
    previousCostPerUnit: item.previousCostSatang / 100,
    resultingCostPerUnit: item.resultingCostSatang / 100,
  });

  const batchFromAPI = (item: POSStockBatchRecord): StockBatchSummary => {
    const movements = item.items.map((line) => {
      const product = products.find((candidate) => candidate.id === line.productId);
      return {
        id: String(line.id),
        referenceNo: item.name || item.id,
        batchId: item.id,
        productId: line.productId,
        productName: line.productName,
        productSku: line.productSku || product?.sku || '',
        type: item.mode,
        quantity: line.delta,
        beforeStock: line.balance - line.delta,
        afterStock: line.balance,
        reason: item.note || 'ทำรายการสต็อก',
        supplierName: item.supplierName,
        costPerUnit: line.unitCostSatang / 100,
        performedBy: item.actorName || 'Admin',
        createdAt: item.createdAt,
        grossTotalValue: line.grossTotalSatang / 100,
        allocatedDiscountValue: line.allocatedDiscountSatang / 100,
        netTotalValue: line.netTotalSatang / 100,
        previousCostPerUnit: line.previousCostSatang / 100,
        resultingCostPerUnit: line.resultingCostSatang / 100,
      } satisfies StockMovement;
    });
    return {
      id: item.id,
      referenceNo: item.name || item.id,
      type: item.mode,
      itemsCount: movements.length,
      totalQuantity: movements.reduce((sum, movement) => sum + Math.abs(movement.quantity), 0),
      totalCostValue: item.totalCostSatang / 100,
      grossTotalValue: item.grossTotalSatang / 100,
      discountValue: item.discountSatang / 100,
      netTotalValue: item.netTotalSatang / 100,
      discountType: item.discountType,
      discountRate: item.discountRateBps / 100,
      reason: item.note || 'ทำรายการสต็อก',
      supplierName: item.supplierName,
      performedBy: item.actorName || 'Admin',
      createdAt: item.createdAt,
      items: movements,
    };
  };

  const refreshPOSStock = async () => {
    try {
      const [summary, apiMovements, apiBatches, apiSuppliers] = await Promise.all([
        getPOSStockSummary(),
        listPOSStockMovements(),
        listPOSStockBatches(),
        listPOSSuppliers(),
      ]);
      setStockSummary({
        productCount: summary.productCount,
        totalUnits: summary.totalUnits,
        inventoryCostValue: summary.inventoryCostSatang / 100,
        inventoryRetailValue: summary.inventoryRetailSatang / 100,
        lowStockCount: summary.lowStockCount,
        outOfStockCount: summary.outOfStockCount,
        batchCount: summary.batchCount,
        movementCount: summary.movementCount,
      });
      setStockMovements(apiMovements.map(movementFromAPI));
      setStockBatches(apiBatches.map(batchFromAPI));
      setSuppliers(apiSuppliers.map(supplierFromAPI));
    } catch (requestError) {
      if (requestError instanceof POSApiError && requestError.status !== 401) {
        showToast(requestError.message, 'error');
      }
    }
  };

  useEffect(() => {
    const refresh = (event: Event) => {
      const permissions = (event as CustomEvent<{ permissions?: Record<string, boolean> }>).detail?.permissions;
      const tasks: Array<Promise<void>> = [];
      if (!permissions || permissions.sales || permissions.products || permissions.stock) tasks.push(refreshPOSCatalog());
      if (!permissions || permissions.stock) tasks.push(refreshPOSStock());
      if (!permissions || permissions.sales || permissions.bills || permissions.settings) tasks.push(refreshPOSSales());
	  setIsBillingPollingActive(true);
      void Promise.all(tasks);
    };
	const stop = () => setIsBillingPollingActive(false);
    window.addEventListener('livematch:pos-authenticated', refresh);
	window.addEventListener('livematch:pos-logged-out', stop);
	window.addEventListener('livematch:pos-unauthorized', stop);
	return () => {
	  window.removeEventListener('livematch:pos-authenticated', refresh);
	  window.removeEventListener('livematch:pos-logged-out', stop);
	  window.removeEventListener('livematch:pos-unauthorized', stop);
	};
  }, []);

  useEffect(() => {
	if (!isBillingPollingActive) return;
	const refreshVisible = () => { if (document.visibilityState === 'visible') void refreshPOSSales().catch(() => undefined); };
	const timer = window.setInterval(refreshVisible, 10_000);
	document.addEventListener('visibilitychange', refreshVisible);
	window.addEventListener('focus', refreshVisible);
	return () => {
	  window.clearInterval(timer);
	  document.removeEventListener('visibilitychange', refreshVisible);
	  window.removeEventListener('focus', refreshVisible);
	};
  }, [isBillingPollingActive]);

  const updateSettings = async (newSettings: Partial<StoreSettings>): Promise<boolean> => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
    if (newSettings.theme) {
      setThemeState(newSettings.theme);
    }
    try {
      const merged = { ...settings, ...newSettings };
      await savePOSSettings({
        promptPayType: merged.promptPayType || 'mobile', promptPayId: merged.promptPayId, promptPayReceiverName: merged.promptPayReceiverName || '',
        receiptHeader: merged.storeName, receiptFooter: merged.receiptFooterMessage, logoData: '', defaultLowStock: 5,
        theme: merged.theme || 'light', language: 'th', taxRatePercent: merged.vatEnabled ? merged.vatRate : 0,
        pricesIncludeTax: merged.vatType === 'included', inheritBookingPromptPay: merged.inheritBookingPromptPay !== false,
        paymentQrImage: merged.paymentQrImage || '',
      });
      showToast('บันทึกการตั้งค่าเรียบร้อยแล้ว', 'success');
      return true;
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : 'บันทึกการตั้งค่าไม่สำเร็จ', 'error');
      await refreshPOSSales().catch(() => undefined);
      return false;
    }
  };

  // Categories CRUD
  const addCategory = (catData: Omit<Category, 'id'>): Category => {
    const newCat: Category = {
      ...catData,
      id: catData.name.toLowerCase().replace(/[^a-z0-9]/g, '-') || `cat-${Date.now()}`,
    };
    // Ensure unique id
    if (categories.some((c) => c.id === newCat.id)) {
      newCat.id = `${newCat.id}-${Date.now().toString().slice(-4)}`;
    }
    setCategories((prev) => [...prev, newCat]);
    showToast(`เพิ่มหมวดหมู่ "${newCat.name}" สำเร็จ`, 'success');
    void createPOSCatalog('categories', newCat.name, { icon: newCat.icon, color: newCat.color })
      .then(refreshPOSCatalog)
      .catch((requestError) => {
        showToast(requestError instanceof Error ? requestError.message : 'เพิ่มหมวดหมู่ไม่สำเร็จ', 'error');
        void refreshPOSCatalog();
      });
    return newCat;
  };

  const updateCategory = (id: string, updated: Partial<Category>) => {
    setCategories((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updated } : c))
    );
    showToast('อัปเดตหมวดหมู่สำเร็จ', 'success');
    const current = categories.find((category) => category.id === id);
    if (current) {
      const next = { ...current, ...updated };
      void updatePOSCatalog('categories', id, { name: next.name, active: true, icon: next.icon, color: next.color })
        .then(refreshPOSCatalog)
        .catch((requestError) => showToast(requestError instanceof Error ? requestError.message : 'อัปเดตหมวดหมู่ไม่สำเร็จ', 'error'));
    }
  };

  const deleteCategory = (id: string) => {
    const isUsed = products.some((p) => p.category === id);
    if (isUsed) {
      showToast('ไม่สามารถลบหมวดหมู่นี้ได้เนื่องจากมีสินค้าใช้งานอยู่', 'warning');
      return;
    }
    setCategories((prev) => prev.filter((c) => c.id !== id));
    showToast('ลบหมวดหมู่เรียบร้อยแล้ว', 'info');
    void deletePOSCatalog('categories', id)
      .then(refreshPOSCatalog)
      .catch((requestError) => {
        showToast(requestError instanceof Error ? requestError.message : 'ลบหมวดหมู่ไม่สำเร็จ', 'error');
        void refreshPOSCatalog();
      });
  };

  // Units CRUD
  const addUnit = (name: string): UnitItem => {
    const trimmed = name.trim();
    const existing = units.find((u) => u.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;

    const newUnit: UnitItem = {
      id: `unit-${Date.now()}`,
      name: trimmed,
    };
    setUnits((prev) => [...prev, newUnit]);
    showToast(`เพิ่มหน่วยนับ "${trimmed}" สำเร็จ`, 'success');
    void createPOSCatalog('units', trimmed)
      .then(refreshPOSCatalog)
      .catch((requestError) => {
        showToast(requestError instanceof Error ? requestError.message : 'เพิ่มหน่วยนับไม่สำเร็จ', 'error');
        void refreshPOSCatalog();
      });
    return newUnit;
  };

  const updateUnit = (id: string, name: string) => {
    setUnits((prev) =>
      prev.map((u) => (u.id === id ? { ...u, name: name.trim() } : u))
    );
    showToast('อัปเดตหน่วยนับสำเร็จ', 'success');
    void updatePOSCatalog('units', id, { name: name.trim(), active: true })
      .then(refreshPOSCatalog)
      .catch((requestError) => showToast(requestError instanceof Error ? requestError.message : 'อัปเดตหน่วยนับไม่สำเร็จ', 'error'));
  };

  const deleteUnit = (id: string) => {
    const targetUnit = units.find((u) => u.id === id);
    if (targetUnit && products.some((p) => p.unit === targetUnit.name)) {
      showToast('ไม่สามารถลบหน่วยนี้ได้เนื่องจากมีสินค้าใช้งานอยู่', 'warning');
      return;
    }
    setUnits((prev) => prev.filter((u) => u.id !== id));
    showToast('ลบหน่วยนับเรียบร้อยแล้ว', 'info');
    void deletePOSCatalog('units', id)
      .then(refreshPOSCatalog)
      .catch((requestError) => {
        showToast(requestError instanceof Error ? requestError.message : 'ลบหน่วยนับไม่สำเร็จ', 'error');
        void refreshPOSCatalog();
      });
  };

  // Note Options CRUD (การจัดการโน้ต & ตัวเลือกเพิ่มเติม)
  const addNoteOption = (noteData: Omit<NoteOption, 'id'>): NoteOption => {
    const newNote: NoteOption = {
      ...noteData,
      id: `note-${Date.now()}`,
    };
    setNoteOptions((prev) => [...prev, newNote]);
    showToast(`เพิ่มตัวเลือกโน้ต "${newNote.name}" สำเร็จ`, 'success');
    return newNote;
  };

  const updateNoteOption = (id: string, updated: Partial<NoteOption>) => {
    setNoteOptions((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...updated } : n))
    );
    showToast('อัปเดตตัวเลือกโน้ตสำเร็จ', 'success');
  };

  const deleteNoteOption = (id: string) => {
    // Also unbind from any products that currently have this noteOptionId
    setProducts((prev) =>
      prev.map((p) => ({
        ...p,
        noteOptionIds: (p.noteOptionIds || []).filter((nid) => nid !== id),
      }))
    );
    setNoteOptions((prev) => prev.filter((n) => n.id !== id));
    showToast('ลบตัวเลือกโน้ตเรียบร้อยแล้ว', 'info');
  };

  // Cart Calculations
  const cartTotals = React.useMemo(() => {
    const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    
    let discountAmount = 0;
    if (discountType === 'percent') {
      discountAmount = (subtotal * discount) / 100;
    } else {
      discountAmount = discount;
    }
    discountAmount = Math.min(discountAmount, subtotal);

    const netBeforeVat = subtotal - discountAmount;
    let vatAmount = 0;
    let total = netBeforeVat;

    if (settings.vatEnabled && settings.vatType === 'included') {
      // VAT is already in price: total = netBeforeVat, VAT = netBeforeVat * 7 / 107
      vatAmount = (netBeforeVat * settings.vatRate) / (100 + settings.vatRate);
      total = netBeforeVat;
    } else if (settings.vatEnabled) {
      // VAT is added on top
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
  }, [cart, discount, discountType, settings.vatEnabled, settings.vatRate, settings.vatType]);

  // Customer Display Multi-Layer Synchronization Helper
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const customerWindowsRef = useRef<Window[]>([]);

  // Function to open standalone Customer Display Window
  const openCustomerDisplayWindow = () => {
    const url = `${window.location.origin}${window.location.pathname}?display=customer`;
    const popup = window.open(
      url,
      'siampure_pos_customer_window',
      'width=1024,height=768,menubar=no,toolbar=no,location=no,status=no,resizable=yes'
    );
    if (popup) {
      try {
        (popup as any).__SIAMPURE_INITIAL_STATE__ = {
          cart,
          cartTotals,
          discount,
          discountType,
          settings,
        };
        customerWindowsRef.current.push(popup);
      } catch (e) {
        // ignore
      }
    } else {
      setActiveTab('customer-display');
    }
  };

  // BroadcastChannel Handshake
  useEffect(() => {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        const bc = new BroadcastChannel('siampure_pos_customer_display');
        bc.onmessage = (event) => {
          if (event.data?.type === 'REQUEST_CURRENT_STATE' || event.data?.type === 'CUSTOMER_DISPLAY_MOUNTED') {
            // Respond with current cart state
            bc.postMessage({
              type: 'CART_UPDATE',
              payload: {
                cart,
                cartTotals,
                discount,
                discountType,
                settings,
              },
            });
          }
        };
        broadcastChannelRef.current = bc;
      } catch (e) {
        console.warn('BroadcastChannel error:', e);
      }
    }
    return () => {
      if (broadcastChannelRef.current) {
        try {
          broadcastChannelRef.current.close();
        } catch (e) {
          // ignore
        }
      }
    };
  }, [cart, cartTotals, discount, discountType, settings]);

  // Window postMessage listener (Solves Chrome iframe partition isolation)
  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;
      const { type } = event.data;

      if (type === 'REQUEST_CURRENT_STATE' || type === 'CUSTOMER_DISPLAY_MOUNTED') {
        const payload = {
          cart,
          cartTotals,
          discount,
          discountType,
          settings,
        };

        if (event.source && 'postMessage' in event.source) {
          try {
            (event.source as Window).postMessage(
              {
                type: 'CART_UPDATE',
                payload,
              },
              '*'
            );
          } catch (e) {
            // ignore
          }
        }

        if (event.source && typeof (event.source as Window).closed !== 'undefined') {
          const win = event.source as Window;
          if (!customerWindowsRef.current.includes(win)) {
            customerWindowsRef.current.push(win);
          }
        }
      }
    };

    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, [cart, cartTotals, discount, discountType, settings]);

  const broadcastCustomerDisplay = (data: {
    type: 'CART_UPDATE' | 'PAYMENT_MODAL_STATE' | 'ORDER_COMPLETED' | 'CLEAR_THANK_YOU';
    payload: any;
  }) => {
    try {
      // 1. BroadcastChannel for cross-tab/cross-window
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.postMessage(data);
      }
      // 2. CustomEvent for same-window component listeners
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('siampure_customer_event', { detail: data }));
      }
      // 3. LocalStorage for fallback storage event
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('siampure_customer_payment_event', JSON.stringify({
          type: data.type,
          ...data.payload,
          _timestamp: Date.now(),
        }));
      }
      // 4. Direct window postMessage to all tracked customer popups
      customerWindowsRef.current = customerWindowsRef.current.filter((w) => {
        try {
          return !w.closed;
        } catch {
          return false;
        }
      });
      customerWindowsRef.current.forEach((w) => {
        try {
          w.postMessage(data, '*');
          (w as any).__SIAMPURE_LATEST_STATE__ = data;
        } catch (e) {
          // ignore
        }
      });
    } catch (e) {
      console.warn('BroadcastCustomerDisplay error:', e);
    }
  };

  // Products CRUD
  const addProduct = (productData: Omit<Product, 'id'>) => {
    const newProduct: Product = {
      ...productData,
      image: productData.image || DEFAULT_PRODUCT_IMAGE,
      id: 'prod-' + Date.now(),
    };
    setProducts((prev) => [newProduct, ...prev]);
    showToast(`เพิ่มสินค้า "${newProduct.name}" สำเร็จ`, 'success');
    playBeep('success');
    void createPOSProduct(productPayload(productData))
      .then(refreshPOSCatalog)
      .catch((requestError) => {
        showToast(requestError instanceof Error ? requestError.message : 'เพิ่มสินค้าไม่สำเร็จ', 'error');
        void refreshPOSCatalog();
      });
  };

  const updateProduct = (id: string, updated: Partial<Product>) => {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updated } : p))
    );
    showToast('อัปเดตข้อมูลสินค้าสำเร็จ', 'success');
    const current = products.find((product) => product.id === id);
    if (current) {
      void updatePOSProduct(id, productPayload({ ...current, ...updated }))
        .then(refreshPOSCatalog)
        .catch((requestError) => showToast(requestError instanceof Error ? requestError.message : 'อัปเดตสินค้าไม่สำเร็จ', 'error'));
    }
  };

  const deleteProduct = (id: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    showToast('ลบสินค้าออกจากระบบแล้ว', 'info');
    void deactivatePOSProduct(id)
      .then(refreshPOSCatalog)
      .catch((requestError) => {
        showToast(requestError instanceof Error ? requestError.message : 'ปิดการขายสินค้าไม่สำเร็จ', 'error');
        void refreshPOSCatalog();
      });
  };

  // Cart operations
  const addToCart = (product: Product, quantity = 1, note = '') => {
    if (product.stock <= 0) {
      showToast(`สินค้า "${product.name}" หมดสต็อกแล้ว!`, 'error');
      playBeep('alert');
      return;
    }

    setCart((prevCart) => {
      const existingIndex = prevCart.findIndex(
        (item) => item.product.id === product.id && (item.note || '') === (note || '')
      );

      if (existingIndex > -1) {
        const updated = [...prevCart];
        const newQty = updated[existingIndex].quantity + quantity;
        if (newQty > product.stock) {
          showToast(`สินค้าในสต็อกมีเพียง ${product.stock} ${product.unit}`, 'warning');
          return prevCart;
        }
        updated[existingIndex].quantity = newQty;
        return updated;
      } else {
        return [...prevCart, { product, quantity, note }];
      }
    });

    playBeep('beep');
    showToast(`เพิ่ม "${product.name}" ลงตะกร้าแล้ว`, 'info');
  };

  const updateCartQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }

    setCart((prevCart) =>
      prevCart.map((item) => {
        if (item.product.id === productId) {
          if (quantity > item.product.stock) {
            showToast(`สต็อกไม่เพียงพอ (คงเหลือ ${item.product.stock})`, 'warning');
            return item;
          }
          return { ...item, quantity };
        }
        return item;
      })
    );
    playBeep('beep');
  };

  const updateCartItemNote = (productId: string, note: string) => {
    setCart((prevCart) =>
      prevCart.map((item) =>
        item.product.id === productId ? { ...item, note } : item
      )
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prevCart) => prevCart.filter((item) => item.product.id !== productId));
    playBeep('alert');
  };

  const clearCart = () => {
    setCart([]);
    setDiscountState(0);
  };

  const setDiscount = (amount: number, type: 'amount' | 'percent' = 'amount') => {
    setDiscountState(amount);
    setDiscountTypeState(type);
  };

  // Real-time broadcast cart & totals to Customer Display
  useEffect(() => {
    broadcastCustomerDisplay({
      type: 'CART_UPDATE',
      payload: {
        cart,
        cartTotals,
        discount,
        discountType,
      },
    });
  }, [cart, cartTotals, discount, discountType]);

  // Held Orders (พักยอดบิล)
  const holdCurrentCart = async (memberId: string, customerName: string): Promise<boolean> => {
    if (cart.length === 0) {
      showToast('ไม่มีสินค้าในตะกร้าสำหรับพักยอด', 'warning');
      return false;
    }
    if (!memberId) {
      showToast('กรุณาเลือกสมาชิกจากระบบ', 'warning');
      return false;
    }
    try {
      const requestId = holdRequestIDRef.current || crypto.randomUUID(); holdRequestIDRef.current = requestId;
      const result = await createPOSSale({
        requestId, action: 'hold', buyerType: 'member', buyerId: memberId,
        discountType, discountAmountSatang: discountType === 'amount' ? Math.round(discount * 100) : 0,
        discountRateBps: discountType === 'percent' ? Math.round(discount * 100) : 0,
        expectedTotalSatang: Math.round(cartTotals.total * 100),
        items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity, note: item.note })),
      });
      clearCart();
      holdRequestIDRef.current = '';
      await Promise.all([refreshPOSCatalog(), refreshPOSSales(), refreshPOSStock()]);
      playBeep('success');
      showToast(`พักยอดของ ${customerName} เรียบร้อยแล้ว (${result.saleId})`, 'success');
      return true;
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : 'พักยอดไม่สำเร็จ', 'error');
      return false;
    }
  };

  const resumeHeldOrder = (heldId: string) => {
    const found = heldOrders.find((h) => h.id === heldId);
    if (!found) return;
    if (cart.length > 0 && !window.confirm('มีสินค้าอยู่ในตะกร้า ต้องการแทนที่ด้วยรายการพักยอดนี้หรือไม่?')) return;
    void (async () => {
      try {
		const saleIds = found.sourceSaleIds || [];
		if (saleIds.length === 0) { showToast('ยอด Match เรียกกลับไปแก้ไขในหน้าขายไม่ได้', 'warning'); return; }
		await Promise.all(saleIds.map((id) => voidPOSSale(id, 'เรียกบิลกลับเข้าตะกร้า')));
		setCart(found.items.filter((item) => !item.product.id.startsWith('billing-match-'))); setDiscountState(found.discount); setDiscountTypeState(found.discountType); setActiveTab('pos');
        await Promise.all([refreshPOSCatalog(), refreshPOSStock(), refreshPOSSales()]);
        showToast(`ดึงรายการพักยอด ${found.heldNumber} กลับมาขายแล้ว`, 'success');
      } catch (requestError) { showToast(requestError instanceof Error ? requestError.message : 'เรียกบิลไม่สำเร็จ', 'error'); }
    })();
  };

  const deleteHeldOrder = (heldId: string) => {
	const found = heldOrders.find((item) => item.id === heldId);
	const saleIds = found?.sourceSaleIds || [];
	if (saleIds.length === 0) { showToast('ค่าสนามจาก Match ต้องจัดการที่ระบบ Match', 'warning'); return; }
	void Promise.all(saleIds.map((id) => voidPOSSale(id, 'ยกเลิกรายการพักยอด'))).then(async () => {
      await Promise.all([refreshPOSCatalog(), refreshPOSStock(), refreshPOSSales()]);
      showToast('ลบรายการพักยอดและคืนสต็อกแล้ว', 'info');
    }).catch((requestError) => showToast(requestError instanceof Error ? requestError.message : 'ลบรายการพักยอดไม่สำเร็จ', 'error'));
  };

  const batchDeleteHeldOrders = (heldIds: string[]) => {
    if (heldIds.length === 0) return;
	const saleIds = heldOrders.filter((item) => heldIds.includes(item.id)).flatMap((item) => item.sourceSaleIds || []);
	if (saleIds.length === 0) { showToast('รายการที่เลือกมีเฉพาะยอด Match', 'warning'); return; }
	void Promise.all(saleIds.map((id) => voidPOSSale(id, 'ยกเลิกรายการพักยอดหลายรายการ'))).then(async () => {
      await Promise.all([refreshPOSCatalog(), refreshPOSStock(), refreshPOSSales()]);
      showToast(`ลบรายการพักยอดจำนวน ${heldIds.length} รายการและคืนสต็อกแล้ว`, 'info');
    }).catch((requestError) => showToast(requestError instanceof Error ? requestError.message : 'ลบรายการพักยอดไม่สำเร็จ', 'error'));
  };

  const mergeHeldOrdersIntoCart = (heldIds: string[]) => {
    const targets = heldOrders.filter((h) => heldIds.includes(h.id));
    if (targets.length === 0) return;
    void (async () => {
      try {
		const saleIds = targets.flatMap((item) => item.sourceSaleIds || []);
		if (saleIds.length === 0) { showToast('รายการที่เลือกมีเฉพาะยอด Match', 'warning'); return; }
		await Promise.all(saleIds.map((id) => voidPOSSale(id, 'รวมกลับเข้าตะกร้า')));
		setCart(targets.flatMap((item) => item.items).filter((item) => !item.product.id.startsWith('billing-match-'))); setDiscountState(0); setDiscountTypeState('amount'); setActiveTab('pos');
        await Promise.all([refreshPOSCatalog(), refreshPOSStock(), refreshPOSSales()]);
        showToast(`รวม ${targets.length} รายการพักยอดเข้าสู่ตะกร้าเรียบร้อยแล้ว`, 'success');
      } catch (requestError) { showToast(requestError instanceof Error ? requestError.message : 'รวมรายการพักยอดไม่สำเร็จ', 'error'); }
    })();
  };

  const processBatchHeldPayment = async ({
    heldIds,
    paymentMethod,
    cashReceived,
    referenceNumber,
    customerNote,
  }: {
    heldIds: string[];
    paymentMethod: 'cash' | 'promptpay' | 'card' | 'transfer';
    cashReceived?: number;
    referenceNumber?: string;
    customerNote?: string;
  }): Promise<Order | null> => {
    const targets = heldOrders.filter((h) => heldIds.includes(h.id));
    if (targets.length === 0) {
      showToast('ไม่พบรายการพักยอดที่เลือก', 'error');
      return null;
    }

    const accountID = targets[0].billingAccountId;
    if (!accountID || targets.some((item) => item.billingAccountId !== accountID)) {
      showToast('กรุณาเลือกบิลพักยอดของสมาชิกคนเดียวกัน', 'warning');
      return null;
    }
    try {
      const summary = await getPOSBillingSummary(accountID);
      const receivedSatang = Math.round((cashReceived || 0) * 100);
      if (paymentMethod === 'cash' && receivedSatang < summary.totalSatang) {
        showToast('ยอดเงินสดไม่เพียงพอสำหรับยอดรวม Match และ POS', 'warning');
        return null;
      }
      await settlePOSAccount({ billingAccountId: accountID, method: paymentMethod === 'promptpay' ? 'promptpay' : 'cash', expectedTotalSatang: summary.totalSatang, cashReceivedSatang: receivedSatang, referenceNumber });
      await refreshPOSSales();
      showToast(`รับชำระยอดรวมของ ${summary.displayName} เรียบร้อยแล้ว`, 'success');
      return { id: `payment-${Date.now()}`, orderNumber: `PAY-${Date.now()}`, items: [], subtotal: summary.totalSatang / 100, discount: 0, discountType: 'amount', vatAmount: 0, vatRate: 0, isVatIncluded: true, total: summary.totalSatang / 100, paymentMethod: paymentMethod === 'promptpay' ? 'promptpay' : 'cash', cashReceived, change: Math.max(0, (cashReceived || 0) - summary.totalSatang / 100), status: 'completed', createdAt: new Date().toISOString(), cashierName: settings.cashierName, customerNote: `ชำระยอดรวม Match + POS · ${summary.displayName}`, referenceNumber };
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : 'รับชำระยอดรวมไม่สำเร็จ', 'error');
      return null;
    }

    /* Legacy local aggregation retained below as a UI calculation reference. */

    // Consolidate all items
    const rawItems: OrderItem[] = [];
    let subtotal = 0;
    let totalDiscountAmount = 0;

    targets.forEach((h) => {
      // Calculate discount for each held order
      let dAmt = 0;
      if (h.discountType === 'percent') {
        dAmt = (h.subtotal * h.discount) / 100;
      } else {
        dAmt = h.discount || 0;
      }
      totalDiscountAmount += Math.min(dAmt, h.subtotal);

      h.items.forEach((item) => {
        const itemLineTotal = item.product.price * item.quantity;
        subtotal += itemLineTotal;
        rawItems.push({
          productId: item.product.id,
          name: item.product.name,
          sku: item.product.sku,
          price: item.product.price,
          cost: item.product.cost,
          quantity: item.quantity,
          total: itemLineTotal,
          note: item.note ? `${item.note} [${h.heldNumber}]` : `[${h.heldNumber}]`,
        });
      });
    });

    // Compute Tax & Final Total
    const netBeforeVat = Math.max(0, subtotal - totalDiscountAmount);
    let vatAmount = 0;
    let total = netBeforeVat;

    if (settings.vatEnabled && settings.vatType === 'included') {
      vatAmount = (netBeforeVat * settings.vatRate) / (100 + settings.vatRate);
      total = netBeforeVat;
    } else if (settings.vatEnabled) {
      vatAmount = (netBeforeVat * settings.vatRate) / 100;
      total = netBeforeVat + vatAmount;
    }

    const orderSeq = String(orders.length + 1).padStart(4, '0');
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const orderNumber = `INV-${datePrefix}-${orderSeq}`;

    const change = cashReceived ? Math.max(0, cashReceived - total) : 0;

    const heldRefTags = targets.map((h) => `${h.heldNumber}${h.customerName ? ` (${h.customerName})` : ''}`).join(', ');
    const finalNote = [
      `ชำระรวม ${targets.length} รายการพักยอด: ${heldRefTags}`,
      customerNote,
    ]
      .filter(Boolean)
      .join(' • ');

    const newOrder: Order = {
      id: 'ord-' + Date.now(),
      orderNumber,
      items: rawItems,
      subtotal,
      discount: totalDiscountAmount,
      discountType: 'amount',
      vatRate: settings.vatEnabled ? settings.vatRate : 0,
      vatAmount,
      isVatIncluded: settings.vatEnabled && settings.vatType === 'included',
      total,
      paymentMethod,
      cashReceived,
      change,
      status: 'completed',
      createdAt: new Date().toISOString(),
      cashierName: settings.cashierName,
      customerNote: finalNote,
      referenceNumber: referenceNumber || (paymentMethod === 'promptpay' ? `PP-${Date.now().toString().slice(-8)}` : undefined),
    };

    // Deduct stock for all items
    setProducts((prevProducts) =>
      prevProducts.map((prod) => {
        const itemQuantitySum = rawItems
          .filter((it) => it.productId === prod.id)
          .reduce((sum, it) => sum + it.quantity, 0);
        if (itemQuantitySum > 0) {
          const newStock = Math.max(0, prod.stock - itemQuantitySum);
          return { ...prod, stock: newStock };
        }
        return prod;
      })
    );

    // Remove from held orders
    setHeldOrders((prev) => prev.filter((h) => !heldIds.includes(h.id)));

    // Save order
    setOrders((prev) => [newOrder, ...prev]);

    // Celebration & Audio
    playBeep('success');
    confetti({
      particleCount: 90,
      spread: 75,
      origin: { y: 0.6 },
    });

    // Broadcast order completed to Customer Display
    broadcastCustomerDisplay({
      type: 'ORDER_COMPLETED',
      payload: {
        order: newOrder,
      },
    });

    showToast(`ชำระเงินรวมสำเร็จ ${targets.length} บิล (${orderNumber})`, 'success');

    // Auto open receipt
    setSelectedOrderForReceipt(newOrder);

    return newOrder;
  };

  // Payment Processing & Checkout
  const processPayment = async ({
    paymentMethod,
    cashReceived,
    referenceNumber,
    customerNote,
  }: {
    paymentMethod: 'cash' | 'promptpay' | 'card' | 'transfer';
    cashReceived?: number;
    referenceNumber?: string;
    customerNote?: string;
  }): Promise<Order | null> => {
    try {
      const requestId = checkoutRequestIDRef.current || crypto.randomUUID(); checkoutRequestIDRef.current = requestId;
      const result = await createPOSSale({
        requestId, action: 'pay', buyerType: 'anonymous', method: paymentMethod === 'promptpay' ? 'promptpay' : 'cash',
        discountType, discountAmountSatang: discountType === 'amount' ? Math.round(discount * 100) : 0,
        discountRateBps: discountType === 'percent' ? Math.round(discount * 100) : 0,
        expectedTotalSatang: Math.round(cartTotals.total * 100),
        cashReceivedSatang: Math.round((cashReceived || 0) * 100), referenceNumber,
        items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity, note: item.note })),
      });
      const apiSales = await listPOSSales();
      const completedSale = apiSales.find((sale) => sale.id === result.saleId);
      const completedOrder = completedSale ? saleToOrder(completedSale) : null;
      setHeldOrders(apiSales.filter((sale) => sale.status === 'open').map(saleToHeldOrder));
      setOrders(apiSales.filter((sale) => sale.status !== 'open').map(saleToOrder));
      clearCart();
      checkoutRequestIDRef.current = '';
      await Promise.all([refreshPOSCatalog(), refreshPOSStock()]);
      playBeep('success');
      confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
      if (completedOrder) {
        broadcastCustomerDisplay({ type: 'ORDER_COMPLETED', payload: { order: completedOrder } });
        setSelectedOrderForReceipt(completedOrder);
      }
      showToast(`ชำระเงินสำเร็จ บิลเลขที่ ${result.saleId}`, 'success');
      return completedOrder;
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : 'ชำระเงินไม่สำเร็จ', 'error');
      return null;
    }

    /* Legacy local calculation retained below only as a readable UI model; API return above is authoritative. */
    const orderSeq = String(orders.length + 1).padStart(4, '0');
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const orderNumber = `INV-${datePrefix}-${orderSeq}`;

    const orderItems = cart.map((item) => ({
      productId: item.product.id,
      name: item.product.name,
      sku: item.product.sku,
      price: item.product.price,
      cost: item.product.cost,
      quantity: item.quantity,
      total: item.product.price * item.quantity,
      note: item.note,
    }));

    const change = cashReceived ? Math.max(0, cashReceived - cartTotals.total) : 0;

    const newOrder: Order = {
      id: 'ord-' + Date.now(),
      orderNumber,
      items: orderItems,
      subtotal: cartTotals.subtotal,
      discount: cartTotals.discountAmount,
      discountType,
      vatRate: settings.vatEnabled ? settings.vatRate : 0,
      vatAmount: cartTotals.vatAmount,
      isVatIncluded: settings.vatEnabled && settings.vatType === 'included',
      total: cartTotals.total,
      paymentMethod,
      cashReceived,
      change,
      status: 'completed',
      createdAt: new Date().toISOString(),
      cashierName: settings.cashierName,
      customerNote,
      referenceNumber: referenceNumber || (paymentMethod === 'promptpay' ? `PP-${Date.now().toString().slice(-8)}` : undefined),
    };

    // Deduct stock for each product
    setProducts((prevProducts) =>
      prevProducts.map((prod) => {
        const cartMatch = cart.find((item) => item.product.id === prod.id);
        if (cartMatch) {
          const newStock = Math.max(0, prod.stock - cartMatch.quantity);
          return { ...prod, stock: newStock };
        }
        return prod;
      })
    );

    // Save order
    setOrders((prev) => [newOrder, ...prev]);

    // Clear cart
    clearCart();

    // Celebration & Audio
    playBeep('success');
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 },
    });

    // Broadcast order completed to Customer Display
    broadcastCustomerDisplay({
      type: 'ORDER_COMPLETED',
      payload: {
        order: newOrder,
      },
    });

    showToast(`ชำระเงินสำเร็จ บิลเลขที่ ${orderNumber}`, 'success');

    // Auto open receipt if enabled
    setSelectedOrderForReceipt(newOrder);

    return newOrder;
  };

  const refundOrder = (orderId: string, reason?: string) => {
    const targetOrder = orders.find((o) => o.id === orderId);
    if (!targetOrder || targetOrder.status === 'refunded') return;

    // Restore stock
    setProducts((prevProducts) =>
      prevProducts.map((prod) => {
        const itemMatch = targetOrder.items.find((item) => item.productId === prod.id);
        if (itemMatch) {
          return { ...prod, stock: prod.stock + itemMatch.quantity };
        }
        return prod;
      })
    );

    // Update order status
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? {
              ...o,
              status: 'refunded',
              customerNote: reason ? `[คืนเงิน] ${reason}` : o.customerNote,
            }
          : o
      )
    );

    playBeep('alert');
    showToast(`คืนเงินบิล ${targetOrder.orderNumber} และคืนสต็อกสำเร็จ`, 'info');
  };

  const cancelOrder = (orderId: string) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: 'cancelled' } : o))
    );
    showToast('ยกเลิกบิลเรียบร้อยแล้ว', 'info');
  };

  // Stock In / Out / Adjust
  const stockIn = (productId: string, quantity: number, supplierName: string, reason: string, cost?: number) => {
    const supplierId = suppliers.find((supplier) => supplier.name === supplierName)?.id;
    void batchStockOperation({ type: 'in', items: [{ productId, quantity, cost }], supplierId, supplierName, reason });
  };

  const stockOut = (productId: string, quantity: number, reason: string) => {
    void batchStockOperation({ type: 'out', items: [{ productId, quantity }], reason });
  };

  const adjustStock = (productId: string, newStock: number, reason: string) => {
    void batchStockOperation({ type: 'adjust', items: [{ productId, quantity: newStock }], reason });
  };

  // Batch Multi-Product Stock Operation (รับเข้า / เบิกออก / ปรับปรุงสต็อก แบบหลายรายการ)
  const batchStockOperation = ({
    type,
    items,
    supplierName,
    supplierId,
    reason,
    referenceNo,
    discountType = 'amount',
    discountAmountSatang = 0,
    discountRateBps = 0,
  }: {
    type: 'in' | 'out' | 'adjust';
    items: Array<{
      productId: string;
      quantity: number;
      cost?: number;
      note?: string;
    }>;
    supplierName?: string;
    supplierId?: string;
    reason: string;
    referenceNo?: string;
    discountType?: 'none' | 'amount' | 'percent';
    discountAmountSatang?: number;
    discountRateBps?: number;
  }): Promise<boolean> => {
    if (!items || items.length === 0) {
      showToast('กรุณาเลือกรายการสินค้าอย่างน้อย 1 รายการ', 'warning');
      return Promise.resolve(false);
    }
    const docRef = referenceNo || `${type === 'in' ? 'RCV' : type === 'out' ? 'OUT' : 'ADJ'}-${Date.now().toString().slice(-8)}`;
    const input: POSStockBatchInput = {
      name: docRef,
      mode: type,
      note: reason,
      supplierId: type === 'in' ? (supplierId || suppliers.find((supplier) => supplier.name === supplierName)?.id) : undefined,
      discountType: discountType === 'none' ? 'amount' : discountType,
      discountAmountSatang: type === 'in' ? discountAmountSatang : 0,
      discountRateBps: type === 'in' ? discountRateBps : 0,
      items: items.map((item) => ({
        productId: item.productId,
        quantity: type === 'adjust' ? 0 : item.quantity,
        targetQuantity: type === 'adjust' ? item.quantity : undefined,
        costSatang: type === 'in' ? Math.round((item.cost || 0) * 100) : undefined,
        note: item.note,
      })),
    };
    return createPOSStockBatch(input)
      .then(async () => {
        await Promise.all([refreshPOSCatalog(), refreshPOSStock()]);
        const typeLabel = type === 'in' ? 'รับเข้า' : type === 'out' ? 'เบิกจ่ายออก' : 'ปรับยอด';
        playBeep('success');
        showToast(`บันทึกเอกสาร ${docRef} (${typeLabel} ${items.length} รายการ) สำเร็จ`, 'success');
        return true;
      })
      .catch((requestError) => {
        showToast(requestError instanceof Error ? requestError.message : 'บันทึกเอกสารสต็อกไม่สำเร็จ', 'error');
        return false;
      });
  };

  // Suppliers CRUD
  const addSupplier = async (supplierData: Omit<Supplier, 'id' | 'productsCount'>): Promise<boolean> => {
    try {
      const created = await createPOSSupplier({
        name: supplierData.name,
        contactPerson: supplierData.contactPerson,
        phone: supplierData.phone,
        email: supplierData.email,
        address: supplierData.address,
      });
      setSuppliers((prev) => [supplierFromAPI(created), ...prev]);
      showToast(`เพิ่มซัพพลายเออร์ "${created.name}" สำเร็จ`, 'success');
      return true;
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : 'เพิ่มซัพพลายเออร์ไม่สำเร็จ', 'error');
      return false;
    }
  };

  const updateSupplier = async (id: string, updated: Partial<Supplier>): Promise<boolean> => {
    const current = suppliers.find((supplier) => supplier.id === id);
    if (!current) return false;
    try {
      const saved = await updatePOSSupplier(id, { ...current, ...updated });
      setSuppliers((prev) => prev.map((supplier) => supplier.id === id ? supplierFromAPI(saved) : supplier));
      showToast('อัปเดตข้อมูลซัพพลายเออร์สำเร็จ', 'success');
      return true;
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : 'อัปเดตซัพพลายเออร์ไม่สำเร็จ', 'error');
      return false;
    }
  };

  const deleteSupplier = async (id: string): Promise<boolean> => {
    try {
      await deletePOSSupplier(id);
      setSuppliers((prev) => prev.filter((supplier) => supplier.id !== id));
      showToast('ลบซัพพลายเออร์แล้ว', 'info');
      return true;
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : 'ลบซัพพลายเออร์ไม่สำเร็จ', 'error');
      return false;
    }
  };

  return (
    <PosContext.Provider
      value={{
        activeTab,
        setActiveTab,
        theme,
        setTheme,
        toggleTheme,
        settings,
        updateSettings,
        members,
        categories,
        addCategory,
        updateCategory,
        deleteCategory,
        units,
        addUnit,
        updateUnit,
        deleteUnit,
        noteOptions,
        addNoteOption,
        updateNoteOption,
        deleteNoteOption,
        broadcastCustomerDisplay,
        openCustomerDisplayWindow,
        products,
        addProduct,
        updateProduct,
        deleteProduct,
        cart,
        addToCart,
        updateCartQuantity,
        updateCartItemNote,
        removeFromCart,
        clearCart,
        discount,
        discountType,
        setDiscount,
        cartTotals,
        heldOrders,
        holdCurrentCart,
        resumeHeldOrder,
        deleteHeldOrder,
        batchDeleteHeldOrders,
        mergeHeldOrdersIntoCart,
        processBatchHeldPayment,
        orders,
        processPayment,
        refundOrder,
        cancelOrder,
        stockMovements,
        stockBatches,
        stockSummary,
        stockIn,
        stockOut,
        adjustStock,
        batchStockOperation,
        suppliers,
        addSupplier,
        updateSupplier,
        deleteSupplier,
        selectedOrderForReceipt,
        setSelectedOrderForReceipt,
        playBeep,
        toast,
        showToast,
      }}
    >
      {children}
    </PosContext.Provider>
  );
};

export const usePos = () => {
  const context = useContext(PosContext);
  if (!context) {
    throw new Error('usePos must be used within a PosProvider');
  }
  return context;
};
