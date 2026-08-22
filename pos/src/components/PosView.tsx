import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { usePos } from "../context/PosContext";
import { Product } from "../types";
import { INITIAL_CATEGORIES } from "../data/mockData";
import { formatCurrency } from "../utils/formatters";
import { PaymentModal } from "./PaymentModal";
import { CustomerCombobox, CustomerSuggestion } from "./CustomerCombobox";
import { listPOSMembers } from "../api/posSales";
import {
  Search,
  Plus,
  Minus,
  Trash2,
  PauseCircle,
  CreditCard,
  Tag,
  MessageSquare,
  ShoppingBag,
  Coffee,
  Croissant,
  Utensils,
  Cookie,
  IceCream,
  LayoutGrid,
  ArrowRight,
  ListOrdered,
  Tv,
  ExternalLink,
  Calculator,
  Hash,
  Delete,
} from "lucide-react";

export const PosView: React.FC = () => {
  const {
    products,
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
    holdCurrentCart,
    members,
    categories,
    noteOptions,
    settings,
    openCustomerDisplayWindow,
  } = usePos();

  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [mobileTab, setMobileTab] = useState<"menu" | "cart">("menu");
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState<boolean>(false);
  const [isHoldModalOpen, setIsHoldModalOpen] = useState<boolean>(false);
  const [holdCustomerName, setHoldCustomerName] = useState<string>("");
  const [holdMemberId, setHoldMemberId] = useState<string>("");
  const [holdMemberSuggestions, setHoldMemberSuggestions] = useState<CustomerSuggestion[]>([]);
  const [isHoldMemberLoading, setIsHoldMemberLoading] = useState(false);
  const holdMemberRequestRef = useRef(0);
  const [activeNoteProductId, setActiveNoteProductId] = useState<string | null>(
    null,
  );
  const [tempNoteText, setTempNoteText] = useState<string>("");
  const [isDiscountModalOpen, setIsDiscountModalOpen] =
    useState<boolean>(false);
  const [tempDiscountVal, setTempDiscountVal] = useState<number>(0);
  const [tempDiscountType, setTempDiscountType] = useState<
    "amount" | "percent"
  >("amount");

  // Quick Quantity Selector & Numpad State
  const [quantityModalItem, setQuantityModalItem] = useState<{
    product: Product;
    currentQty: number;
    isAddingNew?: boolean;
  } | null>(null);
  const [tempQuantityStr, setTempQuantityStr] = useState<string>("1");

  const cartListEndRef = useRef<HTMLDivElement>(null);
  const prevCartLengthRef = useRef<number>(cart.length);

  // Auto-scroll cart when new item is added
  useEffect(() => {
    if (cart.length > prevCartLengthRef.current) {
      cartListEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevCartLengthRef.current = cart.length;
  }, [cart.length]);

  // Filter products by category and search
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (p.status !== "active") return false;
      const matchCat =
        selectedCategory === "all" || p.category === selectedCategory;
      const matchSearch =
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.barcode && p.barcode.includes(searchQuery));
      return matchCat && matchSearch;
    });
  }, [products, selectedCategory, searchQuery]);

  // Quick note presets
  const notePresets = [
    "หวานน้อย 50%",
    "ไม่ใส่น้ำตาล 0%",
    "หวาน 100%",
    "ไม่ใส่ถั่วงอก",
    "เผ็ดน้อย",
    "แยกน้ำแข็ง",
    "เพิ่มช็อตกาแฟ (+15฿)",
    "อุ่นร้อน",
  ];

  const handleOpenQuantityModal = (
    product: Product,
    currentQty = 1,
    isAddingNew = false,
  ) => {
    setQuantityModalItem({
      product,
      currentQty,
      isAddingNew,
    });
    setTempQuantityStr(String(currentQty > 0 ? currentQty : 1));
  };

  const handleSaveQuantityModal = () => {
    if (!quantityModalItem) return;
    const parsed = parseInt(tempQuantityStr, 10);
    const safeQty = isNaN(parsed) || parsed <= 0 ? 1 : parsed;

    if (quantityModalItem.isAddingNew) {
      addToCart(quantityModalItem.product, safeQty);
    } else {
      updateCartQuantity(quantityModalItem.product.id, safeQty);
    }
    setQuantityModalItem(null);
  };

  const handleNumpadInput = (val: string) => {
    if (val === "C") {
      setTempQuantityStr("0");
      return;
    }
    if (val === "DEL") {
      setTempQuantityStr((prev) => (prev.length > 1 ? prev.slice(0, -1) : "0"));
      return;
    }
    setTempQuantityStr((prev) => {
      if (prev === "0" || prev === "") {
        return val === "00" ? "0" : val;
      }
      const nextVal = prev + val;
      // Cap length to 5 digits (99,999)
      return nextVal.length <= 5 ? nextVal : prev;
    });
  };

  const handleAddPresetDelta = (delta: number) => {
    const parsed = parseInt(tempQuantityStr, 10) || 0;
    const nextVal = Math.max(1, parsed + delta);
    setTempQuantityStr(String(nextVal));
  };

  const handleSetPresetExact = (qty: number) => {
    setTempQuantityStr(String(qty));
  };

  const handleOpenNoteModal = (productId: string, currentNote = "") => {
    setActiveNoteProductId(productId);
    setTempNoteText(currentNote || "");
  };

  const handleSaveNote = () => {
    if (activeNoteProductId) {
      updateCartItemNote(activeNoteProductId, tempNoteText);
      setActiveNoteProductId(null);
    }
  };

  const handleOpenDiscountModal = () => {
    setTempDiscountVal(discount);
    setTempDiscountType(discountType);
    setIsDiscountModalOpen(true);
  };

  const handleApplyDiscount = () => {
    setDiscount(tempDiscountVal, tempDiscountType);
    setIsDiscountModalOpen(false);
  };

  const handleHoldOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await holdCurrentCart(holdMemberId, holdCustomerName);
    if (success) {
      setIsHoldModalOpen(false);
      setHoldCustomerName("");
      setHoldMemberId("");
    }
  };

  const searchHoldMembers = useCallback(async (query: string) => {
    const requestId = ++holdMemberRequestRef.current;
    setIsHoldMemberLoading(true);
    try {
      const results = await listPOSMembers(query);
      if (requestId !== holdMemberRequestRef.current) return;
      setHoldMemberSuggestions(results.map((member) => ({
        id: member.id,
        name: member.name,
        category: "member",
        categoryLabel: "สมาชิก",
        detail: member.phone || "สมาชิกของระบบ",
      })));
    } catch {
      if (requestId === holdMemberRequestRef.current) setHoldMemberSuggestions([]);
    } finally {
      if (requestId === holdMemberRequestRef.current) setIsHoldMemberLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isHoldModalOpen) return;
    setHoldMemberSuggestions(members.map((member) => ({
      id: member.id,
      name: member.name,
      category: "member",
      categoryLabel: "สมาชิก",
      detail: member.phone || "สมาชิกของระบบ",
    })));
  }, [isHoldModalOpen, members]);

  const getCategoryIcon = (iconName: string) => {
    switch (iconName) {
      case "Coffee":
        return <Coffee className="w-4 h-4" />;
      case "Croissant":
        return <Croissant className="w-4 h-4" />;
      case "Utensils":
        return <Utensils className="w-4 h-4" />;
      case "Cookie":
        return <Cookie className="w-4 h-4" />;
      case "IceCream":
        return <IceCream className="w-4 h-4" />;
      default:
        return <LayoutGrid className="w-4 h-4" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden relative pb-16 lg:pb-0">
      {/* Mobile Top View Switcher (Only visible on screens < lg) */}
      <div className="lg:hidden shrink-0 bg-slate-900 border-b border-slate-800 p-2 flex items-center gap-2">
        <button
          id="mobile-tab-menu-btn"
          onClick={() => setMobileTab("menu")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition-all ${
            mobileTab === "menu"
              ? "bg-red-600 text-white shadow-md shadow-red-600/20"
              : "bg-slate-950 text-slate-400 border border-slate-800 hover:text-white"
          }`}
        >
          <ShoppingBag className="w-4 h-4" />
          <span>เมนูสินค้า ({filteredProducts.length})</span>
        </button>

        <button
          id="mobile-tab-cart-btn"
          onClick={() => setMobileTab("cart")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition-all ${
            mobileTab === "cart"
              ? "bg-red-600 text-white shadow-md shadow-red-600/20"
              : "bg-slate-950 text-slate-400 border border-slate-800 hover:text-white"
          }`}
        >
          <ListOrdered className="w-4 h-4" />
          <span>ตะกร้า</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-900 text-yellow-400 border border-slate-700 font-bold">
            {cartTotals.itemCount}
          </span>
        </button>
      </div>

      {/* Main Content Layout: Side-by-side on lg+, Toggled or Contained on mobile */}
      <div className="flex-1 flex flex-col lg:flex-row h-full min-h-0 overflow-hidden">
        {/* LEFT PANE: PRODUCTS CATALOG (Contains its own independent scrollbar) */}
        <div
          className={`flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-slate-100/60 dark:bg-slate-950/40 ${
            mobileTab === "cart" ? "hidden lg:flex" : "flex"
          }`}
        >
          {/* Top Controls: Search & Category Filter (Fixed at top of left pane) */}
          <div className="p-3 sm:p-4 bg-white dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800/80 space-y-3 shrink-0 shadow-xs">
            {/* Search bar */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  id="pos-search-input"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ค้นหาสินค้า (พิมพ์ชื่อ, รหัส SKU, หรือเลือกหมวดหมู่)..."
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700/80 rounded-2xl pl-10 pr-10 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-red-500 transition-colors font-medium shadow-xs"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900 text-xs bg-slate-200 dark:bg-slate-800 p-1 rounded-full"
                  >
                    ล้าง
                  </button>
                )}
              </div>
            </div>

            {/* Category Scroller */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar">
              {/* All Category */}
              <button
                id="cat-filter-all"
                onClick={() => setSelectedCategory("all")}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border shrink-0 ${
                  selectedCategory === "all"
                    ? "bg-red-600 text-white border-red-500 font-bold shadow-md shadow-red-600/20 scale-[1.02]"
                    : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/70 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
                <span>ทั้งหมด (All)</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    selectedCategory === "all"
                      ? "bg-white/20 text-white font-black"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {products.filter((p) => p.status === "active").length}
                </span>
              </button>

              {/* Dynamic Categories */}
              {categories.map((cat) => {
                const isActive = selectedCategory === cat.id;
                const count = products.filter(
                  (p) => p.status === "active" && p.category === cat.id,
                ).length;

                return (
                  <button
                    key={cat.id}
                    id={`cat-filter-${cat.id}`}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border shrink-0 ${
                      isActive
                        ? "bg-red-600 text-white border-red-500 font-bold shadow-md shadow-red-600/20 scale-[1.02]"
                        : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/70 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    {getCategoryIcon(cat.icon || cat.id)}
                    <span>{cat.name}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                        isActive
                          ? "bg-white/20 text-white font-black"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Product Cards Grid (Contained with independent vertical scrollbar) */}
          <div className="flex-1 p-3 sm:p-4 overflow-y-auto min-h-0 custom-scrollbar">
            {filteredProducts.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-center p-6 text-slate-500">
                <ShoppingBag className="w-12 h-12 stroke-[1.2] mb-3 text-slate-400 dark:text-slate-600" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-400">
                  ไม่พบรายการสินค้าที่ค้นหา
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  ลองเปลี่ยนคำค้นหา หรือเลือกหมวดหมู่อื่น
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 pb-4">
                {filteredProducts.map((product) => {
                  const isOutOfStock = product.stock <= 0;
                  const isLowStock =
                    product.stock <= product.minStockAlert && !isOutOfStock;
                  const inCartItem = cart.find(
                    (it) => it.product.id === product.id,
                  );

                  return (
                    <div
                      key={product.id}
                      id={`pos-product-${product.id}`}
                      onClick={() => !isOutOfStock && addToCart(product)}
                      className={`group relative bg-white dark:bg-slate-900 border rounded-2xl p-3 flex flex-col justify-between transition-all select-none shadow-xs ${
                        isOutOfStock
                          ? "opacity-50 border-slate-200 dark:border-slate-800 cursor-not-allowed"
                          : "border-slate-200 dark:border-slate-800/90 hover:border-red-500 dark:hover:border-yellow-500/60 hover:shadow-lg cursor-pointer active:scale-[0.98]"
                      }`}
                    >
                      {/* Top Image & Badges */}
                      <div className="relative aspect-4/3 w-full rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-950 mb-2.5">
                        <img
                          src={product.image}
                          alt={product.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />

                        {/* Stock Badge */}
                        <div className="absolute top-2 left-2 flex flex-col gap-1">
                          {isOutOfStock ? (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-600 text-white shadow-xs">
                              สินค้าหมด
                            </span>
                          ) : isLowStock ? (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-yellow-100 dark:bg-yellow-950/90 border border-yellow-300 dark:border-yellow-500/60 text-yellow-800 dark:text-yellow-300 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-ping"></span>
                              เหลือ {product.stock} {product.unit}
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-white/90 dark:bg-slate-950/80 backdrop-blur border border-slate-200 dark:border-slate-700/60 text-slate-700 dark:text-slate-300 shadow-xs">
                              คงเหลือ {product.stock}
                            </span>
                          )}
                        </div>

                        {/* In Cart Indicator */}
                        {inCartItem && (
                          <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-600 text-white font-black text-xs flex items-center justify-center shadow-lg animate-scale">
                            {inCartItem.quantity}
                          </div>
                        )}
                      </div>

                      {/* Product Info */}
                      <div className="flex-1 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5">
                            <span className="font-mono">{product.sku}</span>
                            <span className="capitalize">
                              {categories.find((category) => category.id === product.category)?.name || product.category}
                            </span>
                          </div>
                          <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 line-clamp-2 leading-snug">
                            {product.name}
                          </h3>
                        </div>

                        {/* Price & Action */}
                        <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-1">
                          <div className="min-w-0">
                            <span className="text-[10px] text-slate-400 block">
                              ราคาขาย
                            </span>
                            <span className="text-sm sm:text-base font-black text-red-600 dark:text-yellow-400 font-mono truncate block">
                              {formatCurrency(
                                product.price,
                                settings.currencySymbol,
                                settings.decimalPlaces,
                              )}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {/* Specify quantity button (For ordering in bulk/large quantities) */}
                            <button
                              type="button"
                              disabled={isOutOfStock}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenQuantityModal(
                                  product,
                                  inCartItem ? inCartItem.quantity : 1,
                                  !inCartItem,
                                );
                              }}
                              title="ระบุจำนวนที่ต้องการสั่งซื้อ (พิมพ์ตัวเลขหรือใช้แป้นตัวเลข)"
                              className={`p-1.5 sm:px-2 sm:py-1 rounded-xl text-[11px] font-bold flex items-center gap-1 transition-all ${
                                isOutOfStock
                                  ? "opacity-40 cursor-not-allowed text-slate-400 bg-slate-100 dark:bg-slate-800"
                                  : "text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-yellow-400 bg-slate-100 dark:bg-slate-800/90 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95"
                              }`}
                            >
                              <Hash className="w-3.5 h-3.5" />
                              <span className="hidden xl:inline text-[10px]">
                                ระบุจำนวน
                              </span>
                            </button>

                            <button
                              disabled={isOutOfStock}
                              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                                isOutOfStock
                                  ? "bg-slate-100 dark:bg-slate-800 text-slate-400"
                                  : "bg-red-50 dark:bg-red-600/20 group-hover:bg-red-600 text-red-600 group-hover:text-white dark:text-red-400"
                              }`}
                            >
                              <Plus className="w-4 h-4 stroke-[2.5]" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Floating Mobile Cart Bar (When on mobile and items in cart) */}
          {cart.length > 0 && mobileTab === "menu" && (
            <div className="lg:hidden p-3 bg-slate-900 border-t border-slate-800 flex items-center justify-between shrink-0">
              <div>
                <span className="text-[11px] text-slate-400 block">
                  {cartTotals.itemCount} ชิ้นในตะกร้า
                </span>
                <span className="text-base font-black text-yellow-400 font-mono">
                  {formatCurrency(
                    cartTotals.total,
                    settings.currencySymbol,
                    settings.decimalPlaces,
                  )}
                </span>
              </div>
              <button
                onClick={() => setMobileTab("cart")}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 text-white font-bold text-xs shadow-lg shadow-red-600/20"
              >
                <span>ดูตะกร้า & ชำระเงิน</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* RIGHT PANE: ORDER CART SIDEBAR (Contains its own independent scrollbar) */}
        <div
          id="pos-cart-sidebar"
          className={`w-full lg:w-[380px] xl:w-[430px] bg-white dark:bg-slate-900 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 flex flex-col h-full min-h-0 shadow-lg dark:shadow-2xl z-20 overflow-hidden shrink-0 ${
            mobileTab === "menu" ? "hidden lg:flex" : "flex"
          }`}
        >
          {/* Cart Header (Fixed at top of cart sidebar) */}
          <div className="p-3 sm:p-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/95 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl bg-red-100 dark:bg-yellow-500/20 border border-red-300 dark:border-yellow-500/30 flex items-center justify-center text-red-600 dark:text-yellow-400 font-black text-xs">
                {cartTotals.itemCount}
              </div>
              <div>
                <h2 className="text-xs font-black text-slate-900 dark:text-white">
                  รายการคำสั่งซื้อ
                </h2>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  {cart.length} รายการ ({cartTotals.itemCount} ชิ้น)
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {cart.length > 0 && (
                <button
                  id="clear-cart-btn"
                  onClick={clearCart}
                  className="text-[11px] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 border border-red-200 dark:border-red-900/50 px-2 py-1 rounded-lg transition-colors flex items-center gap-1 font-bold"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>ล้าง</span>
                </button>
              )}
            </div>
          </div>

          {/* Cart Items List (Independent Contained Scrollbar) */}
          <div
            id="pos-cart-items-container"
            className="flex-1 p-3 overflow-y-auto space-y-2 min-h-0 custom-scrollbar bg-slate-50/50 dark:bg-transparent"
          >
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400 dark:text-slate-500 space-y-2">
                <ShoppingBag className="w-12 h-12 stroke-[1.2] text-slate-300 dark:text-slate-700" />
                <p className="text-sm font-bold text-slate-700 dark:text-slate-400">
                  ยังไม่มีสินค้าในตะกร้า
                </p>
                <p className="text-xs text-slate-400 max-w-[200px]">
                  คลิกที่รายการสินค้าทางซ้าย เพื่อเพิ่มลงในคำสั่งซื้อ
                </p>
                <button
                  onClick={() => setMobileTab("menu")}
                  className="lg:hidden mt-2 text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white font-bold"
                >
                  เลือกรายการสินค้า
                </button>
              </div>
            ) : (
              <>
                {cart.map((item) => (
                  <div
                    key={item.product.id}
                    id={`cart-item-${item.product.id}`}
                    className="bg-white dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800/90 rounded-2xl p-2.5 flex flex-col gap-2 hover:border-slate-300 dark:hover:border-slate-700 transition-colors shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <img
                          src={item.product.image}
                          alt={item.product.name}
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded-lg object-cover bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                            {item.product.name}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                            {formatCurrency(
                              item.product.price,
                              settings.currencySymbol,
                              settings.decimalPlaces,
                            )}{" "}
                            / {item.product.unit}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => removeFromCart(item.product.id)}
                        className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-slate-800 rounded-lg transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Item Note Display */}
                    {item.note && (
                      <div className="text-[10px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 px-2 py-1 rounded-lg flex items-center justify-between">
                        <span>* {item.note}</span>
                        <button
                          onClick={() =>
                            handleOpenNoteModal(item.product.id, item.note)
                          }
                          className="text-amber-800 dark:text-amber-300 font-bold hover:underline"
                        >
                          แก้ไข
                        </button>
                      </div>
                    )}

                    {/* Quantity Controls & Line Total */}
                    <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-900">
                      <button
                        onClick={() =>
                          handleOpenNoteModal(item.product.id, item.note)
                        }
                        className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 flex items-center gap-1 hover:underline"
                      >
                        <MessageSquare className="w-3 h-3 text-slate-400" />
                        <span>{item.note ? "แก้โน้ต" : "เพิ่มโน้ต"}</span>
                      </button>

                      <div className="flex items-center gap-1.5 sm:gap-2">
                        {/* Stepper with Direct Editable Input */}
                        <div className="flex items-center bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-xl p-0.5 shadow-2xs">
                          <button
                            type="button"
                            onClick={() =>
                              updateCartQuantity(
                                item.product.id,
                                item.quantity - 1,
                              )
                            }
                            title="ลดจำนวน 1"
                            className="w-6 h-6 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center active:scale-95 transition-all shadow-xs shrink-0"
                          >
                            <Minus className="w-3 h-3" />
                          </button>

                          {/* Interactive Number Input - user can click and type any quantity */}
                          <input
                            type="number"
                            min="1"
                            max={item.product.stock || 99999}
                            value={item.quantity}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              if (!isNaN(val)) {
                                const safeVal = Math.max(
                                  1,
                                  Math.min(item.product.stock || 99999, val),
                                );
                                updateCartQuantity(item.product.id, safeVal);
                              }
                            }}
                            onFocus={(e) => e.target.select()}
                            className="w-10 sm:w-12 text-center text-xs font-black font-mono text-slate-900 dark:text-white bg-transparent border-0 focus:outline-none focus:bg-amber-100/80 dark:focus:bg-amber-950/60 rounded py-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            title="คลิกเพื่อพิมพ์ตัวเลขระบุจำนวนได้โดยตรง"
                          />

                          <button
                            type="button"
                            onClick={() =>
                              updateCartQuantity(
                                item.product.id,
                                item.quantity + 1,
                              )
                            }
                            title="เพิ่มจำนวน 1"
                            className="w-6 h-6 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center active:scale-95 transition-all shadow-xs shrink-0"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>

                        {/* Quick Quantity / Numpad Modal trigger */}
                        <button
                          type="button"
                          onClick={() =>
                            handleOpenQuantityModal(
                              item.product,
                              item.quantity,
                              false,
                            )
                          }
                          title="เปิดแป้นพิมพ์ตัวเลขระบุจำนวน (สั่งจำนวนมาก)"
                          className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-yellow-400 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
                        >
                          <Calculator className="w-3.5 h-3.5" />
                        </button>

                        {/* Subtotal for line */}
                        <span className="text-xs font-black text-red-600 dark:text-yellow-400 font-mono min-w-[60px] sm:min-w-[65px] text-right">
                          {formatCurrency(
                            item.product.price * item.quantity,
                            settings.currencySymbol,
                            settings.decimalPlaces,
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={cartListEndRef} />
              </>
            )}
          </div>

          {/* Financial Summary & Actions (Fixed at bottom of cart sidebar) */}
          <div className="p-3.5 sm:p-4 bg-white dark:bg-slate-950/95 border-t border-slate-200 dark:border-slate-800 space-y-2.5 shrink-0 shadow-md">
            {/* Discount Trigger */}
            <div className="flex items-center justify-between text-xs">
              <button
                id="pos-discount-btn"
                onClick={handleOpenDiscountModal}
                className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-yellow-400 font-medium transition-colors"
              >
                <Tag className="w-3.5 h-3.5" />
                <span>
                  ส่วนลด / คูปอง{" "}
                  {discount > 0 &&
                    `(${discountType === "percent" ? `${discount}%` : `-${discount}฿`})`}
                </span>
              </button>
              {discount > 0 ? (
                <span className="font-bold text-red-600">
                  -
                  {formatCurrency(
                    cartTotals.discountAmount,
                    settings.currencySymbol,
                    settings.decimalPlaces,
                  )}
                </span>
              ) : (
                <span className="text-slate-400 text-[11px]">ไม่มีส่วนลด</span>
              )}
            </div>

            {/* Subtotal & VAT */}
            <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400 pt-1.5 border-t border-slate-200 dark:border-slate-800/80">
              <div className="flex justify-between">
                <span>ยอดรวมสินค้า:</span>
                <span className="text-slate-800 dark:text-slate-200 font-mono font-bold">
                  {formatCurrency(
                    cartTotals.subtotal,
                    settings.currencySymbol,
                    settings.decimalPlaces,
                  )}
                </span>
              </div>
              {settings.vatEnabled && (
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>
                    ภาษีมูลค่าเพิ่ม (VAT {settings.vatRate}%{" "}
                    {settings.vatType === "included" ? "รวมในราคา" : "แยกนอก"}):
                  </span>
                  <span className="font-mono">
                    {formatCurrency(
                      cartTotals.vatAmount,
                      settings.currencySymbol,
                      settings.decimalPlaces,
                    )}
                  </span>
                </div>
              )}
            </div>

            {/* Grand Total Bar */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider block font-bold">
                  ยอดชำระสุทธิ (Net Total)
                </span>
                <span className="text-xl sm:text-2xl font-black text-red-600 dark:text-yellow-400 tracking-tight font-mono">
                  {formatCurrency(
                    cartTotals.total,
                    settings.currencySymbol,
                    settings.decimalPlaces,
                  )}
                </span>
              </div>

              <span className="text-[11px] px-2.5 py-1 rounded-full bg-red-100 dark:bg-yellow-500/15 text-red-700 dark:text-yellow-300 border border-red-200 dark:border-yellow-500/30 font-bold">
                {cartTotals.itemCount} ชิ้น
              </span>
            </div>

            {/* Checkout & Hold Buttons */}
            <div className="grid grid-cols-12 gap-2 pt-1">
              <button
                id="pos-hold-bill-btn"
                disabled={cart.length === 0}
                onClick={() => setIsHoldModalOpen(true)}
                className="col-span-4 flex items-center justify-center gap-1.5 py-2.5 sm:py-3 rounded-2xl bg-yellow-100 dark:bg-yellow-500/15 hover:bg-yellow-200 dark:hover:bg-yellow-500/25 border border-yellow-300 dark:border-yellow-500/40 text-yellow-800 dark:text-yellow-400 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
              >
                <PauseCircle className="w-4 h-4" />
                <span>พักยอด</span>
              </button>

              <button
                id="pos-pay-btn"
                disabled={cart.length === 0}
                onClick={() => setIsPaymentModalOpen(true)}
                className="col-span-8 flex items-center justify-center gap-2 py-2.5 sm:py-3 rounded-2xl bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-600 text-white font-black text-sm shadow-md shadow-red-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.99]"
              >
                <CreditCard className="w-5 h-5 text-white" />
                <span>ชำระเงิน</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL 1: PAYMENT */}
      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
      />

      {/* MODAL 2: HOLD ORDER MODAL */}
      {isHoldModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
                  <PauseCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    พักยอดคำสั่งซื้อ (Hold Order)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    ค้นหาและเลือกสมาชิกเพื่อเรียกบิลคืน
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsHoldModalOpen(false)}
                className="p-1 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleHoldOrderSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                  <span>ชื่อลูกค้า *</span>
                </label>
                <CustomerCombobox
                  required
                  autoFocus
                  value={holdCustomerName}
                  onChange={(value) => {
                    setHoldCustomerName(value);
                    const selected = holdMemberSuggestions.find((item) => item.id === holdMemberId);
                    if (!selected || selected.name !== value) setHoldMemberId("");
                  }}
                  onSelect={(member) => {
                    setHoldMemberId(member.id);
                    setHoldCustomerName(member.name);
                  }}
                  onSearch={searchHoldMembers}
                  suggestions={holdMemberSuggestions}
                  isLoading={isHoldMemberLoading}
                  delayMs={500}
                  allowCustom={false}
                  placeholder="พิมพ์ชื่อหรือเบอร์โทรสมาชิก..."
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsHoldModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={!holdMemberId}
                  className="px-5 py-2.5 rounded-xl bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 text-xs font-black shadow-md shadow-yellow-500/20 transition-all"
                >
                  บันทึกการพักยอด
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: ITEM NOTE MODAL */}
      {activeNoteProductId &&
        (() => {
          const activeProduct =
            products.find((p) => p.id === activeNoteProductId) ||
            cart.find((i) => i.product.id === activeNoteProductId)?.product;
          const boundOptionIds = activeProduct?.noteOptionIds || [];
          const boundOptions = noteOptions.filter((n) =>
            boundOptionIds.includes(n.id),
          );
          const otherOptions = noteOptions.filter(
            (n) => !boundOptionIds.includes(n.id),
          );

          const appendOrToggleNote = (text: string) => {
            if (!tempNoteText.trim()) {
              setTempNoteText(text);
            } else {
              const currentParts = tempNoteText.split(",").map((s) => s.trim());
              if (currentParts.includes(text)) {
                const remaining = currentParts.filter((s) => s !== text);
                setTempNoteText(remaining.join(", "));
              } else {
                setTempNoteText(`${tempNoteText}, ${text}`);
              }
            }
          };

          return (
            <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto custom-scrollbar">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-red-600 dark:text-yellow-400" />
                    <div>
                      <h3 className="text-base font-black text-slate-900 dark:text-white">
                        โน้ต & ตัวเลือกเสริม:{" "}
                        {activeProduct?.name || "รายการสินค้า"}
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        เลือกตัวเลือกที่ผูกไว้กับสินค้า หรือพิมพ์ระบุเพิ่มเติม
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveNoteProductId(null)}
                    className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
                  >
                    ✕
                  </button>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      ข้อความโน้ตคำสั่งซื้อ
                    </label>
                    {tempNoteText && (
                      <button
                        type="button"
                        onClick={() => setTempNoteText("")}
                        className="text-[11px] text-red-500 hover:underline font-bold"
                      >
                        ล้างข้อความ
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={tempNoteText}
                    onChange={(e) => setTempNoteText(e.target.value)}
                    placeholder="พิมพ์ข้อความโน้ต หรือกดเลือกจากปุ่มด้านล่าง..."
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-red-500 dark:focus:border-yellow-400"
                  />
                </div>

                {/* Bound Options for this specific product */}
                {boundOptions.length > 0 && (
                  <div className="p-3 bg-red-50/60 dark:bg-yellow-500/10 rounded-2xl border border-red-200 dark:border-yellow-500/30 space-y-1.5">
                    <span className="text-xs font-black text-red-700 dark:text-yellow-400 flex items-center gap-1.5">
                      <span>
                        ★ ตัวเลือกที่ผูกกับสินค้านี้ ({boundOptions.length})
                      </span>
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {boundOptions.map((opt) => {
                        const labelText =
                          opt.priceAdjustment && opt.priceAdjustment > 0
                            ? `${opt.name} (+${opt.priceAdjustment}฿)`
                            : opt.name;
                        const isApplied = tempNoteText.includes(opt.name);
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => appendOrToggleNote(labelText)}
                            className={`text-xs px-3 py-1.5 rounded-xl border font-bold transition-all ${
                              isApplied
                                ? "bg-red-600 dark:bg-yellow-500 text-white dark:text-slate-950 border-transparent shadow-xs"
                                : "bg-white dark:bg-slate-900 border-red-200 dark:border-yellow-500/40 text-slate-800 dark:text-slate-200 hover:border-red-400"
                            }`}
                          >
                            {labelText}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Other System Note Options */}
                {otherOptions.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400 block">
                      ตัวเลือกอื่นๆ ในระบบ:
                    </span>
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                      {otherOptions.map((opt) => {
                        const labelText =
                          opt.priceAdjustment && opt.priceAdjustment > 0
                            ? `${opt.name} (+${opt.priceAdjustment}฿)`
                            : opt.name;
                        const isApplied = tempNoteText.includes(opt.name);
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => appendOrToggleNote(labelText)}
                            className={`text-[11px] px-2.5 py-1 rounded-lg border transition-all ${
                              isApplied
                                ? "bg-slate-800 text-white border-slate-700 font-bold"
                                : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                            }`}
                          >
                            {labelText}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="pt-2 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setActiveNoteProductId(null)}
                    className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveNote}
                    className="px-6 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black shadow-md shadow-red-600/30"
                  >
                    บันทึกโน้ต
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* MODAL 4: DISCOUNT MODAL */}
      {isDiscountModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tag className="w-5 h-5 text-red-600 dark:text-yellow-400" />
                <h3 className="text-base font-black text-slate-900 dark:text-white">
                  กำหนดส่วนลดคำสั่งซื้อ
                </h3>
              </div>
              <button
                onClick={() => setIsDiscountModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Type selector */}
            <div className="grid grid-cols-2 bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setTempDiscountType("amount")}
                className={`py-2 rounded-lg font-black transition-colors ${
                  tempDiscountType === "amount"
                    ? "bg-red-600 text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                จำนวนเงิน (฿)
              </button>
              <button
                type="button"
                onClick={() => setTempDiscountType("percent")}
                className={`py-2 rounded-lg font-black transition-colors ${
                  tempDiscountType === "percent"
                    ? "bg-red-600 text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                เปอร์เซ็นต์ (%)
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                มูลค่าส่วนลด
              </label>
              <input
                type="number"
                min="0"
                value={tempDiscountVal}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) =>
                  setTempDiscountVal(parseFloat(e.target.value) || 0)
                }
                className="w-full text-xl font-black bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-red-600 dark:text-yellow-400 focus:outline-none focus:border-red-500 font-mono"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDiscount(0, "amount");
                  setIsDiscountModalOpen(false);
                }}
                className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-red-600"
              >
                ลบส่วนลด
              </button>
              <button
                type="button"
                onClick={handleApplyDiscount}
                className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black"
              >
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: QUANTITY SELECTOR & NUMPAD (ระบุจำนวนสินค้า / สั่งจำนวนมาก) */}
      {quantityModalItem && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4 text-slate-900 dark:text-white">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={quantityModalItem.product.image}
                  alt={quantityModalItem.product.name}
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-xl object-cover border border-slate-200 dark:border-slate-800 shrink-0 bg-slate-100 dark:bg-slate-950"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-black text-slate-900 dark:text-white truncate">
                      {quantityModalItem.product.name}
                    </h3>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2">
                    <span className="font-mono text-amber-600 dark:text-yellow-400 font-bold">
                      {formatCurrency(
                        quantityModalItem.product.price,
                        settings.currencySymbol,
                        settings.decimalPlaces,
                      )}
                    </span>
                    <span>/ {quantityModalItem.product.unit}</span>
                    <span>• สต็อก: {quantityModalItem.product.stock}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setQuantityModalItem(null)}
                className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors shrink-0"
              >
                ✕
              </button>
            </div>

            {/* Input & Real-time Total Preview */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-400">
                <label htmlFor="modal-qty-input">
                  พิมพ์จำนวน หรือกดแป้นตัวเลขด้านล่าง:
                </label>
                <span className="text-slate-400 font-normal">
                  หน่วย: {quantityModalItem.product.unit}
                </span>
              </div>

              <div className="relative">
                <input
                  id="modal-qty-input"
                  type="number"
                  min="1"
                  max={quantityModalItem.product.stock || 99999}
                  value={tempQuantityStr}
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setTempQuantityStr(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSaveQuantityModal();
                    }
                  }}
                  className="w-full text-3xl sm:text-4xl font-black text-center bg-slate-50 dark:bg-slate-950 border-2 border-red-500 dark:border-yellow-500 rounded-2xl py-3 text-red-600 dark:text-yellow-400 font-mono focus:outline-none focus:ring-4 focus:ring-red-500/20 shadow-inner"
                />

                {tempQuantityStr && tempQuantityStr !== "0" && (
                  <button
                    type="button"
                    onClick={() => setTempQuantityStr("0")}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700"
                  >
                    ล้าง
                  </button>
                )}
              </div>

              {/* Subtotal preview banner */}
              <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-amber-50 dark:bg-yellow-950/30 border border-amber-200 dark:border-yellow-500/40 text-xs">
                <span className="text-amber-900 dark:text-yellow-300 font-medium">
                  รวม ({tempQuantityStr || 0} {quantityModalItem.product.unit} ×{" "}
                  {formatCurrency(
                    quantityModalItem.product.price,
                    settings.currencySymbol,
                    settings.decimalPlaces,
                  )}
                  ):
                </span>
                <span className="text-base font-black font-mono text-amber-700 dark:text-yellow-400">
                  {formatCurrency(
                    quantityModalItem.product.price *
                      (parseInt(tempQuantityStr, 10) || 0),
                    settings.currencySymbol,
                    settings.decimalPlaces,
                  )}
                </span>
              </div>
            </div>

            {/* Quick Preset Buttons (Add Delta) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
                <span>ปุ่มลัดเพิ่มจำนวนเร็ว (+):</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {[1, 5, 10, 20, 50].map((delta) => (
                  <button
                    key={`plus-${delta}`}
                    type="button"
                    onClick={() => handleAddPresetDelta(delta)}
                    className="py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-red-50 hover:text-red-600 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold font-mono transition-colors border border-slate-200 dark:border-slate-700 active:scale-95"
                  >
                    +{delta}
                  </button>
                ))}
              </div>
            </div>

            {/* Exact Preset Buttons */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
                <span>หรือเลือกจำนวนตามชุดสำเร็จ:</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {[1, 10, 20, 50, 100].map((qty) => (
                  <button
                    key={`exact-${qty}`}
                    type="button"
                    onClick={() => handleSetPresetExact(qty)}
                    className={`py-1.5 rounded-xl text-xs font-bold font-mono transition-colors border active:scale-95 ${
                      parseInt(tempQuantityStr, 10) === qty
                        ? "bg-red-600 dark:bg-yellow-500 text-white dark:text-slate-950 border-transparent shadow-xs"
                        : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    {qty}
                  </button>
                ))}
              </div>
            </div>

            {/* Touch Numpad Grid */}
            <div className="grid grid-cols-3 gap-1.5 pt-1">
              {[
                "1",
                "2",
                "3",
                "4",
                "5",
                "6",
                "7",
                "8",
                "9",
                "C",
                "0",
                "DEL",
              ].map((key) => {
                const isAction = key === "C" || key === "DEL";
                return (
                  <button
                    key={`numpad-${key}`}
                    type="button"
                    onClick={() => handleNumpadInput(key)}
                    className={`py-2.5 rounded-xl text-base font-black font-mono transition-all active:scale-95 ${
                      isAction
                        ? "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700"
                        : "bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs"
                    }`}
                  >
                    {key === "DEL" ? "⌫" : key}
                  </button>
                );
              })}
            </div>

            {/* Action Buttons */}
            <div className="pt-2 flex justify-end gap-2.5 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setQuantityModalItem(null)}
                className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleSaveQuantityModal}
                className="flex-1 px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 dark:bg-yellow-500 dark:hover:bg-yellow-400 text-white dark:text-slate-950 text-xs font-black shadow-md shadow-red-600/30 flex items-center justify-center gap-2"
              >
                <span>ยืนยันจำนวน ({tempQuantityStr || 0} ชิ้น)</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
