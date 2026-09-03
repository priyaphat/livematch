export interface Category {
  id: string;
  name: string;
  icon?: string;
  color?: string;
}

export interface UnitItem {
  id: string;
  name: string;
}

export interface NoteOption {
  id: string;
  name: string;
  category?: string; // e.g. 'ระดับความหวาน', 'ตัวเลือกเครื่องดื่ม', 'ตัวเลือกอาหาร', 'ตัวเลือกทั่วไป'
  priceAdjustment?: number; // e.g. 0, 10, 15
}

export interface Product {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  primaryStock: number;
  secondaryStock: number;
  totalStock: number;
  trackStock: boolean;
  minStockAlert: number;
  unitsPerPack?: number;
  image: string;
  description?: string;
  unit: string;
  status: 'active' | 'inactive';
  isPopular?: boolean;
  noteOptionIds?: string[]; // IDs of bound NoteOptions
}

export interface CartItem {
  product: Product;
  quantity: number;
  note?: string;
  discount?: number; // percentage or fixed
  allocatedTotal?: number;
  splitAllocation?: { count: number; position: number; paidCount: number; share: number };
}

export interface OrderItem {
  productId: string;
  name: string;
  sku: string;
  price: number;
  cost: number;
  quantity: number;
  total: number;
  note?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  discountType: 'amount' | 'percent';
  discountRate?: number;
  vatAmount: number;
  vatRate: number;
  isVatIncluded: boolean;
  total: number;
  paymentMethod: 'cash' | 'promptpay' | 'card' | 'transfer';
  cashReceived?: number;
  change?: number;
  status: 'completed' | 'refunded' | 'cancelled';
  createdAt: string;
  cashierName: string;
  customerNote?: string;
  referenceNumber?: string;
  paymentId?: string;
  originSystem?: 'match' | 'pos';
  matchTotal?: number;
  posTotal?: number;
  billingLines?: Array<{ sourceType: 'match' | 'pos'; sourceId: string; label: string; amountSatang: number; snapshot?: Record<string, any> }>;
}

export interface HeldOrder {
  id: string;
  heldNumber: string;
  customerName?: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  discountType: 'amount' | 'percent';
  note?: string;
  createdAt: string;
  total: number;
  memberId?: string;
  billingAccountId?: string;
  sourceSaleIds?: string[];
  matchTotal?: number;
  posTotal?: number;
  splitAllocations?: Array<{ saleId: string; count: number; position: number; paidCount: number; share: number }>;
}

export interface StockMovement {
  id: string;
  referenceNo: string;
  batchId?: string;
  productId: string;
  productName: string;
  productSku: string;
  type: 'in' | 'out' | 'adjust' | 'transfer';
  stockLocation?: 'primary' | 'secondary';
  quantity: number;
  beforeStock: number;
  afterStock: number;
  reason: string;
  supplierName?: string;
  costPerUnit?: number;
  performedBy: string;
  createdAt: string;
  note?: string;
  grossTotalValue?: number;
  allocatedDiscountValue?: number;
  netTotalValue?: number;
  previousCostPerUnit?: number;
  resultingCostPerUnit?: number;
}

export interface BatchStockOperationItem {
  productId: string;
  quantity: number; // for in/out: quantity, for adjust: target new stock level
  cost?: number;
  totalValue?: number;
  note?: string;
}

export interface StockBatchSummary {
  id?: string;
  referenceNo: string;
  type: 'in' | 'out' | 'adjust' | 'transfer';
  stockLocation?: 'primary' | 'secondary';
  sourceStockLocation?: 'primary' | 'secondary';
  destinationStockLocation?: 'primary' | 'secondary';
  itemsCount: number;
  totalQuantity: number;
  totalCostValue: number;
  reason: string;
  supplierName?: string;
  externalReferenceNo?: string;
  performedBy: string;
  createdAt: string;
  items: StockMovement[];
  grossTotalValue?: number;
  discountValue?: number;
  netTotalValue?: number;
  discountType?: 'none' | 'amount' | 'percent';
  discountRate?: number;
}

export interface StockSummary {
  productCount: number;
  totalUnits: number;
  inventoryCostValue: number;
  inventoryRetailValue: number;
  lowStockCount: number;
  outOfStockCount: number;
  batchCount: number;
  movementCount: number;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  productsCount: number;
}

export interface StoreSettings {
  storeName: string;
  taxId: string;
  phone: string;
  email: string;
  address: string;
  promptPayId: string;
  promptPayType?: 'mobile' | 'national_id' | 'ewallet';
  promptPayReceiverName?: string;
  inheritBookingPromptPay?: boolean;
  paymentQrImage?: string;
  logoData?: string;
  navbarTitle: string;
  navbarIconData?: string;
  customerDisplayTitle: string;
  customerDisplayHighlight: string;
  customerDisplaySubtitle: string;
  customerDisplayCardText: string;
  customerDisplayCtaText: string;
  defaultLowStock: number;
  effectivePromptPayType?: string;
  effectivePromptPayReceiverName?: string;
  effectivePromptPayIdMasked?: string;
  effectivePromptPaySource?: string;
  effectivePromptPayAvailable?: boolean;
  currencySymbol: string;
  decimalPlaces: number; // 0, 2, 3
  vatEnabled: boolean;
  vatRate: number; // 7
  vatType: 'included' | 'excluded'; // รวมในราคาสินค้า หรือ แยกนอก
  receiptFooterMessage: string;
  printerType: 'thermal_80mm' | 'thermal_58mm';
  autoPrintReceipt: boolean;
  enableSoundEffects: boolean;
  hardwareKeyboardMode: boolean;
  secondaryStockEnabled: boolean;
  primaryStockName: string;
  secondaryStockName: string;
  saleStockLocation: 'primary' | 'secondary';
  cashierName: string;
  theme?: 'light' | 'dark';
}
