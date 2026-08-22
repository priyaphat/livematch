import React, { useEffect, useState, useRef } from 'react';
import { usePos } from '../context/PosContext';
import { Product, Category, UnitItem, NoteOption } from '../types';
import { formatCurrency } from '../utils/formatters';
import { DEFAULT_PRODUCT_IMAGE } from '../constants/product';
import {
  Package,
  Plus,
  Search,
  Edit2,
  Trash2,
  AlertTriangle,
  UploadCloud,
  Layers,
  Sparkles,
  Check,
  X,
  Scale,
  Coffee,
  Croissant,
  Utensils,
  Cookie,
  IceCream,
  FolderPlus,
  Tag,
  Grid,
  MessageSquare,
  MessageSquarePlus,
  CheckSquare,
  Square,
} from 'lucide-react';

const MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_PRODUCT_IMAGE_DIMENSION = 1280;

const normalizeNumberInput = (value: string, allowDecimal: boolean) => {
  if (value === '') return '';
  const normalized = value.replace(',', '.');
  const pattern = allowDecimal ? /^\d*(?:\.\d*)?$/ : /^\d*$/;
  if (!pattern.test(normalized)) return null;
  const [integer = '', decimal] = normalized.split('.');
  const normalizedInteger = integer.replace(/^0+(?=\d)/, '') || '0';
  return decimal === undefined ? normalizedInteger : `${normalizedInteger}.${decimal}`;
};

const canvasToBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('ไม่สามารถประมวลผลรูปภาพได้'))),
      'image/webp',
      quality,
    );
  });

const blobToDataURL = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
    reader.readAsDataURL(blob);
  });

const resizeProductImage = async (file: File) => {
  const sourceURL = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('ไฟล์รูปภาพไม่ถูกต้องหรือไม่รองรับ'));
      element.src = sourceURL;
    });
    const scale = Math.min(
      1,
      MAX_PRODUCT_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('เบราว์เซอร์ไม่รองรับการย่อรูปภาพ');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    let quality = 0.86;
    let result = await canvasToBlob(canvas, quality);
    while (result.size > MAX_PRODUCT_IMAGE_BYTES && quality > 0.46) {
      quality -= 0.08;
      result = await canvasToBlob(canvas, quality);
    }
    if (result.size > MAX_PRODUCT_IMAGE_BYTES) {
      throw new Error('รูปภาพหลังย่อยังมีขนาดเกิน 2 MB กรุณาเลือกรูปอื่น');
    }
    return blobToDataURL(result);
  } finally {
    URL.revokeObjectURL(sourceURL);
  }
};

export const ProductsView: React.FC = () => {
  const {
    products,
    addProduct,
    updateProduct,
    deleteProduct,
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
    settings,
  } = usePos();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Modals for Category, Unit, and Note management
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryForm, setCategoryForm] = useState<{ name: string; icon: string; color: string }>({
    name: '',
    icon: 'Package',
    color: '#EF4444',
  });

  const [isUnitModalOpen, setIsUnitModalOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<UnitItem | null>(null);
  const [unitFormName, setUnitFormName] = useState('');

  // Note Options management modal state
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<NoteOption | null>(null);
  const [noteForm, setNoteForm] = useState<{ name: string; category: string; priceAdjustment: number }>({
    name: '',
    category: 'ความหวาน',
    priceAdjustment: 0,
  });
  const [noteFilterCategory, setNoteFilterCategory] = useState<string>('all');

  // Quick inline add states inside product modal
  const [showInlineAddCategory, setShowInlineAddCategory] = useState(false);
  const [inlineCategoryName, setInlineCategoryName] = useState('');
  const [showInlineAddUnit, setShowInlineAddUnit] = useState(false);
  const [inlineUnitName, setInlineUnitName] = useState('');
  const [showInlineAddNote, setShowInlineAddNote] = useState(false);
  const [inlineNoteName, setInlineNoteName] = useState('');
  const [inlineNotePrice, setInlineNotePrice] = useState<number>(0);
  const [inlineNoteCategory, setInlineNoteCategory] = useState<string>('ทั่วไป');
  const [priceInput, setPriceInput] = useState('80');
  const [costInput, setCostInput] = useState('30');
  const [stockInput, setStockInput] = useState('20');
  const [minStockInput, setMinStockInput] = useState('10');

  // File upload ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form State for Add / Edit Product
  const [formData, setFormData] = useState<Omit<Product, 'id'>>({
    sku: '',
    barcode: '',
    name: '',
    category: categories[0]?.id || 'coffee',
    price: 80,
    cost: 30,
    stock: 20,
    minStockAlert: 10,
    unit: units[0]?.name || 'แก้ว',
    status: 'active',
    image: DEFAULT_PRODUCT_IMAGE,
    description: '',
    noteOptionIds: [],
  });

  // Preset stock images library
  const presetImages = [
    { label: 'กาแฟสดเย็น', url: 'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=500&auto=format&fit=crop&q=80' },
    { label: 'มัทฉะลาเต้', url: 'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=500&auto=format&fit=crop&q=80' },
    { label: 'ชาไทยเย็น', url: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=500&auto=format&fit=crop&q=80' },
    { label: 'ครัวซองต์', url: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=500&auto=format&fit=crop&q=80' },
    { label: 'เค้กช็อกโกแลต', url: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=500&auto=format&fit=crop&q=80' },
    { label: 'ผัดไทยกุ้งสด', url: 'https://images.unsplash.com/photo-1559847844-5315695dadae?w=500&auto=format&fit=crop&q=80' },
    { label: 'กะเพราเนื้อไข่ดาว', url: 'https://images.unsplash.com/photo-1569058242253-92a9c755a0ec?w=500&auto=format&fit=crop&q=80' },
    { label: 'เฟรนช์ฟรายส์', url: 'https://images.unsplash.com/photo-1576107232684-1279f3908594?w=500&auto=format&fit=crop&q=80' },
    { label: 'ไอศกรีม', url: 'https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=500&auto=format&fit=crop&q=80' },
    { label: 'น้ำส้มคั้นสด', url: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?w=500&auto=format&fit=crop&q=80' },
  ];

  // Helper icon renderer
  const renderCategoryIcon = (iconName?: string) => {
    switch (iconName?.toLowerCase()) {
      case 'coffee':
        return <Coffee className="w-4 h-4" />;
      case 'croissant':
      case 'bakery':
        return <Croissant className="w-4 h-4" />;
      case 'utensils':
      case 'food':
        return <Utensils className="w-4 h-4" />;
      case 'cookie':
      case 'snack':
        return <Cookie className="w-4 h-4" />;
      case 'icecream':
      case 'dessert':
        return <IceCream className="w-4 h-4" />;
      default:
        return <Tag className="w-4 h-4" />;
    }
  };

  // Filter products
  const filteredProducts = products.filter((p) => {
    const matchCat = selectedCategory === 'all' || p.category === selectedCategory;
    const matchSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.barcode && p.barcode.includes(searchQuery));
    return matchCat && matchSearch;
  });

  const productsPerPage = 10;
  const totalProductPages = Math.max(1, Math.ceil(filteredProducts.length / productsPerPage));
  const firstProductIndex = (currentPage - 1) * productsPerPage;
  const paginatedProducts = filteredProducts.slice(
    firstProductIndex,
    firstProductIndex + productsPerPage,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedCategory]);

  useEffect(() => {
    if (currentPage > totalProductPages) {
      setCurrentPage(totalProductPages);
    }
  }, [currentPage, totalProductPages]);

  // Handle image upload from computer file
  const handleImageFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
      alert('ขนาดไฟล์ภาพต้นฉบับต้องไม่เกิน 2 MB');
      return;
    }
    try {
      const resizedImage = await resizeProductImage(file);
      setFormData((prev) => ({ ...prev, image: resizedImage }));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'ไม่สามารถประมวลผลรูปภาพได้');
    }
  };

  // Open add product
  const handleOpenAdd = () => {
    const nextSeq = String(products.length + 1).padStart(3, '0');
    setFormData({
      sku: `PROD-${nextSeq}`,
      barcode: `885012345${nextSeq}`,
      name: '',
      category: categories[0]?.id || 'coffee',
      price: 80,
      cost: 25,
      stock: 30,
      minStockAlert: 10,
      unit: units[0]?.name || 'แก้ว',
      status: 'active',
      image: DEFAULT_PRODUCT_IMAGE,
      description: '',
      noteOptionIds: noteOptions.slice(0, 4).map((n) => n.id), // Default to first few common note options
    });
    setEditingProduct(null);
    setPriceInput('80');
    setCostInput('25');
    setStockInput('30');
    setMinStockInput('10');
    setShowInlineAddCategory(false);
    setShowInlineAddUnit(false);
    setShowInlineAddNote(false);
    setIsAddProductModalOpen(true);
  };

  // Open edit product
  const handleOpenEdit = (p: Product) => {
    setEditingProduct(p);
    setFormData({
      sku: p.sku,
      barcode: p.barcode || '',
      name: p.name,
      category: p.category,
      price: p.price,
      cost: p.cost,
      stock: p.stock,
      minStockAlert: p.minStockAlert,
      unit: p.unit,
      status: p.status,
      image: p.image,
      description: p.description || '',
      noteOptionIds: p.noteOptionIds || [],
    });
    setShowInlineAddCategory(false);
    setShowInlineAddUnit(false);
    setShowInlineAddNote(false);
    setPriceInput(String(p.price));
    setCostInput(String(p.cost));
    setStockInput(String(p.stock));
    setMinStockInput(String(p.minStockAlert));
    setIsAddProductModalOpen(true);
  };

  const handleSubmitProduct = (e: React.FormEvent) => {
    e.preventDefault();
    const productData: Omit<Product, 'id'> = {
      ...formData,
      price: Number(priceInput) || 0,
      cost: Number(costInput) || 0,
      stock: Number.parseInt(stockInput, 10) || 0,
      minStockAlert: Number.parseInt(minStockInput, 10) || 0,
    };
    if (editingProduct) {
      updateProduct(editingProduct.id, productData);
    } else {
      addProduct(productData);
    }
    setIsAddProductModalOpen(false);
  };

  // Toggle single note option binding on product
  const handleToggleNoteOption = (noteId: string) => {
    setFormData((prev) => {
      const current = prev.noteOptionIds || [];
      if (current.includes(noteId)) {
        return { ...prev, noteOptionIds: current.filter((id) => id !== noteId) };
      } else {
        return { ...prev, noteOptionIds: [...current, noteId] };
      }
    });
  };

  // Select all / clear all notes for product
  const handleSelectAllNotes = (noteList: NoteOption[]) => {
    const ids = noteList.map((n) => n.id);
    setFormData((prev) => ({
      ...prev,
      noteOptionIds: Array.from(new Set([...(prev.noteOptionIds || []), ...ids])),
    }));
  };

  const handleClearAllNotes = () => {
    setFormData((prev) => ({
      ...prev,
      noteOptionIds: [],
    }));
  };

  // Handle Category modal
  const handleOpenCategoryModal = (cat?: Category) => {
    if (cat) {
      setEditingCategory(cat);
      setCategoryForm({ name: cat.name, icon: cat.icon || 'Tag', color: cat.color || '#EF4444' });
    } else {
      setEditingCategory(null);
      setCategoryForm({ name: '', icon: 'Package', color: '#EF4444' });
    }
    setIsCategoryModalOpen(true);
  };

  const handleSubmitCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryForm.name.trim()) return;

    if (editingCategory) {
      updateCategory(editingCategory.id, categoryForm);
    } else {
      addCategory(categoryForm);
    }
    setEditingCategory(null);
    setCategoryForm({ name: '', icon: 'Package', color: '#EF4444' });
  };

  // Handle Unit modal
  const handleOpenUnitModal = (unit?: UnitItem) => {
    if (unit) {
      setEditingUnit(unit);
      setUnitFormName(unit.name);
    } else {
      setEditingUnit(null);
      setUnitFormName('');
    }
    setIsUnitModalOpen(true);
  };

  const handleSubmitUnit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!unitFormName.trim()) return;

    if (editingUnit) {
      updateUnit(editingUnit.id, unitFormName.trim());
    } else {
      addUnit(unitFormName.trim());
    }
    setEditingUnit(null);
    setUnitFormName('');
  };

  // Handle Note Options modal (หน้าต่างจัดการตัวเลือกโน้ต & ส่วนผสม)
  const handleOpenNoteModal = (note?: NoteOption) => {
    if (note) {
      setEditingNote(note);
      setNoteForm({
        name: note.name,
        category: note.category || 'ความหวาน',
        priceAdjustment: note.priceAdjustment || 0,
      });
    } else {
      setEditingNote(null);
      setNoteForm({
        name: '',
        category: 'ความหวาน',
        priceAdjustment: 0,
      });
    }
    setIsNoteModalOpen(true);
  };

  const handleSubmitNoteOption = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteForm.name.trim()) return;

    if (editingNote) {
      updateNoteOption(editingNote.id, {
        name: noteForm.name.trim(),
        category: noteForm.category,
        priceAdjustment: Number(noteForm.priceAdjustment) || 0,
      });
    } else {
      addNoteOption({
        name: noteForm.name.trim(),
        category: noteForm.category,
        priceAdjustment: Number(noteForm.priceAdjustment) || 0,
      });
    }
    setEditingNote(null);
    setNoteForm({ name: '', category: 'ความหวาน', priceAdjustment: 0 });
  };

  // Quick inline add category
  const handleQuickAddCategory = () => {
    if (!inlineCategoryName.trim()) return;
    const newCat = addCategory({ name: inlineCategoryName.trim(), icon: 'Tag', color: '#F59E0B' });
    setFormData((prev) => ({ ...prev, category: newCat.id }));
    setInlineCategoryName('');
    setShowInlineAddCategory(false);
  };

  // Quick inline add unit
  const handleQuickAddUnit = () => {
    if (!inlineUnitName.trim()) return;
    const newUnit = addUnit(inlineUnitName.trim());
    setFormData((prev) => ({ ...prev, unit: newUnit.name }));
    setInlineUnitName('');
    setShowInlineAddUnit(false);
  };

  // Quick inline add note option
  const handleQuickAddNote = () => {
    if (!inlineNoteName.trim()) return;
    const createdNote = addNoteOption({
      name: inlineNoteName.trim(),
      category: inlineNoteCategory,
      priceAdjustment: Number(inlineNotePrice) || 0,
    });
    // Auto bind to current product formData
    setFormData((prev) => ({
      ...prev,
      noteOptionIds: [...(prev.noteOptionIds || []), createdNote.id],
    }));
    setInlineNoteName('');
    setInlineNotePrice(0);
    setShowInlineAddNote(false);
  };

  const calculateMargin = (price: number, cost: number) => {
    if (!price || price <= 0) return 0;
    return Math.round(((price - cost) / price) * 100);
  };

  // Count products by category
  const getProductCountByCategory = (catId: string) => {
    if (catId === 'all') return products.length;
    return products.filter((p) => p.category === catId).length;
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-950 overflow-hidden text-slate-900 dark:text-slate-100">
      {/* Top Header Bar */}
      <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/95 shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
            <Package className="w-6 h-6 text-red-600 dark:text-yellow-400" />
            <span>จัดการสินค้า & แคตตาล็อก</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            มีสินค้าทั้งหมด {products.length} รายการ ใน {categories.length} หมวดหมู่
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Manage Categories Button */}
          <button
            id="manage-categories-btn"
            onClick={() => handleOpenCategoryModal()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 text-xs font-bold transition-all"
            title="เพิ่ม/แก้ไข หมวดหมู่สินค้า"
          >
            <FolderPlus className="w-4 h-4 text-red-600 dark:text-yellow-400" />
            <span>หมวดหมู่ ({categories.length})</span>
          </button>

          {/* Manage Units Button */}
          <button
            id="manage-units-btn"
            onClick={() => handleOpenUnitModal()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 text-xs font-bold transition-all"
            title="เพิ่ม/แก้ไข หน่วยนับสินค้า"
          >
            <Scale className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
            <span>หน่วยนับ ({units.length})</span>
          </button>

          {/* Manage Note Options Button (การตั้งค่าโน้ต & ส่วนผสม) */}
          {false && <button
            id="manage-notes-btn"
            onClick={() => handleOpenNoteModal()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 text-xs font-bold transition-all"
            title="จัดการรายการโน้ต & ตัวเลือกเสริม เช่น ความหวาน, ประเภทเครื่องดื่ม"
          >
            <MessageSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span>ตัวเลือกโน้ต ({noteOptions.length})</span>
          </button>}

          {/* Add Product Button */}
          <button
            id="add-product-btn"
            onClick={handleOpenAdd}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-600 text-white font-black text-xs shadow-md shadow-red-600/25 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>เพิ่มสินค้าใหม่</span>
          </button>
        </div>
      </div>

      {/* Main Content Area: Left Sidebar (Categories) + Right Table */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* LEFT SIDEBAR: Categories Navigation */}
        <aside className="w-full lg:w-64 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-3 sm:p-4 flex flex-col shrink-0 overflow-y-auto custom-scrollbar">
          <div className="flex items-center justify-between mb-3 px-1">
            <span className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-red-600 dark:text-yellow-400" />
              หมวดหมู่สินค้า
            </span>
            <button
              onClick={() => handleOpenCategoryModal()}
              className="text-[11px] font-bold text-red-600 dark:text-yellow-400 hover:underline flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              เพิ่มหมวด
            </button>
          </div>

          {/* Categories List */}
          <div className="flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0">
            {/* All Category Button */}
            <button
              onClick={() => setSelectedCategory('all')}
              className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-left shrink-0 lg:shrink ${
                selectedCategory === 'all'
                  ? 'bg-red-600 text-white shadow-sm shadow-red-600/20'
                  : 'bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <Grid className="w-4 h-4" />
                <span>สินค้าทั้งหมด (All)</span>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                  selectedCategory === 'all'
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                {products.length}
              </span>
            </button>

            {/* Individual Categories */}
            {categories.map((cat) => {
              const count = getProductCountByCategory(cat.id);
              const isActive = selectedCategory === cat.id;

              return (
                <div
                  key={cat.id}
                  className="group relative flex items-center shrink-0 lg:shrink"
                >
                  <button
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-left ${
                      isActive
                        ? 'bg-red-600 text-white shadow-sm shadow-red-600/20'
                        : 'bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      {renderCategoryIcon(cat.icon || cat.id)}
                      <span className="truncate">{cat.name}</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-black shrink-0 ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

        </aside>

        {/* RIGHT MAIN AREA: Search Bar & Products Table */}
        <section className="flex-1 flex flex-col min-h-0 p-3 sm:p-5 overflow-y-auto custom-scrollbar space-y-4">
          {/* Search & Stats Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาสินค้า (ชื่อ, SKU, บาร์โค้ด)..."
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-red-500 dark:focus:border-yellow-400 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
              <span>
                แสดง <strong>{filteredProducts.length}</strong> จาก {products.length} รายการ
              </span>
            </div>
          </div>

          {/* Products Table Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800 uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="p-3.5">รูป & ชื่อสินค้า</th>
                    <th className="p-3.5">รหัส SKU / บาร์โค้ด</th>
                    <th className="p-3.5">หมวดหมู่</th>
                    <th className="p-3.5 text-right">ราคาขาย</th>
                    <th className="p-3.5 text-right">ต้นทุน</th>
                    <th className="p-3.5 text-center">มาร์จิ้น</th>
                    <th className="p-3.5 text-center">คงเหลือ</th>
                    <th className="p-3.5 text-center">สถานะ</th>
                    <th className="p-3.5 text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-12 text-center text-slate-400">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Package className="w-8 h-8 text-slate-300 dark:text-slate-700" />
                          <p className="font-semibold text-sm">ไม่พบรายการสินค้าที่ตรงกับเงื่อนไข</p>
                          <button
                            onClick={handleOpenAdd}
                            className="mt-2 px-3 py-1.5 rounded-lg bg-red-600 text-white font-bold text-xs"
                          >
                            + เพิ่มสินค้าใหม่
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedProducts.map((prod) => {
                      const isLow = prod.stock <= prod.minStockAlert;
                      const margin = calculateMargin(prod.price, prod.cost);
                      const catObj = categories.find((c) => c.id === prod.category);

                      return (
                        <tr
                          key={prod.id}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          {/* Name & Image */}
                          <td className="p-3.5">
                            <div className="flex items-center gap-3">
                              <img
                                src={prod.image}
                                alt={prod.name}
                                referrerPolicy="no-referrer"
                                className="w-11 h-11 rounded-xl object-cover bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shrink-0"
                              />
                              <div className="min-w-0">
                                <span className="font-bold text-slate-900 dark:text-white block truncate max-w-[200px]">
                                  {prod.name}
                                </span>
                                <span className="text-[10px] text-slate-400 block">
                                  หน่วย: {prod.unit}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* SKU & Barcode */}
                          <td className="p-3.5 font-mono">
                            <div className="font-bold text-slate-800 dark:text-slate-200">{prod.sku}</div>
                            <div className="text-[10px] text-slate-400">{prod.barcode || '-'}</div>
                          </td>

                          {/* Category */}
                          <td className="p-3.5">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                              {catObj ? catObj.name : prod.category}
                            </span>
                          </td>

                          {/* Price */}
                          <td className="p-3.5 text-right font-mono font-black text-red-600 dark:text-yellow-400 text-sm">
                            {formatCurrency(
                              prod.price,
                              settings.currencySymbol,
                              settings.decimalPlaces
                            )}
                          </td>

                          {/* Cost */}
                          <td className="p-3.5 text-right font-mono text-slate-500 dark:text-slate-400">
                            {formatCurrency(
                              prod.cost,
                              settings.currencySymbol,
                              settings.decimalPlaces
                            )}
                          </td>

                          {/* Margin % */}
                          <td className="p-3.5 text-center">
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border border-yellow-500/30">
                              {margin}%
                            </span>
                          </td>

                          {/* Stock */}
                          <td className="p-3.5 text-center font-mono">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                                isLow
                                  ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-500/40'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                              }`}
                            >
                              {isLow && <AlertTriangle className="w-3 h-3 text-red-600 dark:text-red-400" />}
                              {prod.stock} {prod.unit}
                            </span>
                          </td>

                          {/* Status */}
                          <td className="p-3.5 text-center">
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                prod.status === 'active'
                                  ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-500/30'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              {prod.status === 'active' ? 'วางขาย' : 'ปิดการขาย'}
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="p-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleOpenEdit(prod)}
                                className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700 transition-colors"
                                title="แก้ไขข้อมูลสินค้า"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  if (window.confirm(`ต้องการลบสินค้า "${prod.name}" หรือไม่?`)) {
                                    deleteProduct(prod.id);
                                  }
                                }}
                                className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-red-100 dark:hover:bg-red-950/40 text-slate-400 hover:text-red-600 border border-slate-200 dark:border-slate-700 transition-colors"
                                title="ลบสินค้า"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
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
            {filteredProducts.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-4 border-t border-slate-200 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  แสดง {firstProductIndex + 1}–
                  {Math.min(firstProductIndex + productsPerPage, filteredProducts.length)} จาก{' '}
                  {filteredProducts.length} รายการ
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    ก่อนหน้า
                  </button>
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    หน้า {currentPage} / {totalProductPages}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setCurrentPage((page) => Math.min(totalProductPages, page + 1))
                    }
                    disabled={currentPage === totalProductPages}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    ถัดไป
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ================= MODAL 1: ADD / EDIT PRODUCT ================= */}
      {isAddProductModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-xl w-full p-5 sm:p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto custom-scrollbar">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 text-red-600 dark:text-yellow-400 font-bold">
                <Package className="w-5 h-5" />
                <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                  {editingProduct ? 'แก้ไขข้อมูลสินค้า' : 'เพิ่มสินค้าใหม่'}
                </h3>
              </div>
              <button
                onClick={() => setIsAddProductModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitProduct} className="space-y-4 text-xs">
              {/* Product Name */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  ชื่อสินค้า (Product Name) *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="เช่น ชาเขียวมัทฉะลาเต้เย็น, เค้กเรดเวลเวท"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-red-500 dark:focus:border-yellow-400"
                />
              </div>

              {/* SKU, Barcode, Unit */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    รหัส SKU *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.sku}
                    disabled={Boolean(editingProduct)}
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-red-500 dark:focus:border-yellow-400 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    บาร์โค้ด (ถ้ามี)
                  </label>
                  <input
                    type="text"
                    value={formData.barcode}
                    onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                    placeholder="885..."
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-red-500 dark:focus:border-yellow-400"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-bold text-slate-700 dark:text-slate-300">
                      หน่วยนับ *
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowInlineAddUnit(!showInlineAddUnit)}
                      className="text-[10px] text-red-600 dark:text-yellow-400 font-bold hover:underline"
                    >
                      + เพิ่มหน่วย
                    </button>
                  </div>
                  <select
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-red-500 dark:focus:border-yellow-400"
                  >
                    {units.map((u) => (
                      <option key={u.id} value={u.name}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Inline Add Unit Box */}
              {showInlineAddUnit && (
                <div className="p-2.5 rounded-xl bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-300 dark:border-yellow-500/40 flex items-center gap-2">
                  <input
                    type="text"
                    value={inlineUnitName}
                    onChange={(e) => setInlineUnitName(e.target.value)}
                    placeholder="พิมพ์ชื่อหน่วยใหม่ เช่น แพ็ค, ขวด, กล่อง"
                    className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleQuickAddUnit}
                    className="px-3 py-1.5 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-slate-950 font-bold text-xs shrink-0"
                  >
                    บันทึกหน่วย
                  </button>
                </div>
              )}

              {/* Category & Status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-bold text-slate-700 dark:text-slate-300">
                      หมวดหมู่สินค้า *
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowInlineAddCategory(!showInlineAddCategory)}
                      className="text-[10px] text-red-600 dark:text-yellow-400 font-bold hover:underline"
                    >
                      + เพิ่มหมวดหมู่
                    </button>
                  </div>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-red-500 dark:focus:border-yellow-400"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    สถานะสินค้า
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        status: e.target.value as 'active' | 'inactive',
                      })
                    }
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-red-500 dark:focus:border-yellow-400"
                  >
                    <option value="active">เปิดขายตามปกติ (Active)</option>
                    <option value="inactive">ปิดการขายชั่วคราว (Inactive)</option>
                  </select>
                </div>
              </div>

              {/* Inline Add Category Box */}
              {showInlineAddCategory && (
                <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-500/40 flex items-center gap-2">
                  <input
                    type="text"
                    value={inlineCategoryName}
                    onChange={(e) => setInlineCategoryName(e.target.value)}
                    placeholder="พิมพ์ชื่อหมวดหมู่ใหม่ เช่น อาหารจานหลัก, สลัด"
                    className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleQuickAddCategory}
                    className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-xs shrink-0"
                  >
                    บันทึกหมวด
                  </button>
                </div>
              )}

              {/* Pricing, Cost & Margin Box */}
              <div className="p-3.5 bg-slate-100 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      ราคาขาย (Price) *
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      step="any"
                      value={priceInput}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => {
                        const value = normalizeNumberInput(e.target.value, true);
                        if (value !== null) setPriceInput(value);
                      }}
                      onBlur={() => setPriceInput((value) => value || '0')}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-red-600 dark:text-yellow-400 font-black focus:outline-none focus:border-red-500 dark:focus:border-yellow-400"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      ต้นทุนต่อหน่วย (Cost) *
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      step="any"
                      value={costInput}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => {
                        const value = normalizeNumberInput(e.target.value, true);
                        if (value !== null) setCostInput(value);
                      }}
                      onBlur={() => setCostInput((value) => value || '0')}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-slate-300 font-bold focus:outline-none focus:border-red-500 dark:focus:border-yellow-400"
                    />
                  </div>
                </div>

                <div className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-800 font-medium">
                  <span>
                    กำไรต่อชิ้น:{' '}
                    <strong className="text-red-600 dark:text-yellow-400 font-black font-mono">
                      {formatCurrency(
                        (Number(priceInput) || 0) - (Number(costInput) || 0),
                        settings.currencySymbol,
                        settings.decimalPlaces
                      )}
                    </strong>
                  </span>
                  <span>
                    มาร์จิ้นกำไร:{' '}
                    <strong className="text-red-600 dark:text-yellow-400 font-black font-mono">
                      {calculateMargin(Number(priceInput) || 0, Number(costInput) || 0)}%
                    </strong>
                  </span>
                </div>
              </div>

              {/* Stock & Alert Level */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    จำนวนสต็อกเริ่มต้น
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={stockInput}
                    disabled={Boolean(editingProduct)}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => {
                      const value = normalizeNumberInput(e.target.value, false);
                      if (value !== null) setStockInput(value);
                    }}
                    onBlur={() => setStockInput((value) => value || '0')}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-red-500 dark:focus:border-yellow-400 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    เตือนเมื่อสต็อกต่ำกว่า
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={minStockInput}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => {
                      const value = normalizeNumberInput(e.target.value, false);
                      if (value !== null) setMinStockInput(value);
                    }}
                    onBlur={() => setMinStockInput((value) => value || '0')}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-red-500 dark:focus:border-yellow-400"
                  />
                </div>
              </div>

              {/* IMAGE UPLOAD SECTION (No URL field) */}
              <div className="space-y-2">
                <label className="block font-bold text-slate-700 dark:text-slate-300">
                  รูปภาพสินค้า (อัปโหลดรูปจากเครื่อง) *
                </label>

                {/* Upload Box with Drag & Drop & Click */}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageFileUpload}
                  accept="image/png, image/jpeg, image/webp, image/gif, image/svg+xml"
                  className="hidden"
                />

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                  {/* Current Image Preview */}
                  <div className="sm:col-span-4 flex flex-col items-center justify-center p-2 rounded-2xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <img
                      src={formData.image}
                      alt="Product preview"
                      referrerPolicy="no-referrer"
                      className="w-24 h-24 object-cover rounded-xl shadow-xs border border-slate-300 dark:border-slate-700"
                    />
                    <span className="text-[10px] text-slate-500 mt-1">รูปปัจจุบัน</span>
                  </div>

                  {/* Upload Actions */}
                  <div className="sm:col-span-8 space-y-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-red-300 dark:border-yellow-500/40 hover:border-red-500 dark:hover:border-yellow-400 bg-red-50/50 dark:bg-yellow-500/5 hover:bg-red-50 dark:hover:bg-yellow-500/10 rounded-2xl p-3.5 flex flex-col items-center justify-center gap-1.5 transition-all text-slate-700 dark:text-slate-200 cursor-pointer"
                    >
                      <UploadCloud className="w-6 h-6 text-red-600 dark:text-yellow-400" />
                      <span className="font-bold text-xs">คลิกเพื่อเลือกไฟล์รูปภาพจากอุปกรณ์</span>
                      <span className="text-[10px] text-slate-400">รองรับไฟล์ JPG, PNG, WEBP, GIF (สูงสุด 2MB และย่ออัตโนมัติ)</span>
                    </button>
                  </div>
                </div>

                {/* Quick Presets Suggestions */}
                {false && <div className="pt-2">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block mb-1.5 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-yellow-500" />
                    หรือเลือกรูปสำเร็จรูปยอดนิยม:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {presetImages.map((preset, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setFormData({ ...formData, image: preset.url })}
                        className={`text-[10px] px-2.5 py-1 rounded-lg border transition-all ${
                          formData.image === preset.url
                            ? 'bg-red-600 text-white border-red-600 font-bold'
                            : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>}
              </div>

              {/* ================= ATTACHED NOTE OPTIONS SECTION (ผูกกับสินค้า) ================= */}
              {false && <div className="p-4 bg-slate-100/70 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-1.5">
                      <MessageSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <span>ผูกตัวเลือกโน้ต & ตัวเลือกเสริมกับสินค้านี้</span>
                    </span>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      เลือกตัวเลือกที่จะให้แคชเชียร์เลือกกดได้เมื่อสั่งสินค้านี้ (เลือกแล้ว {(formData.noteOptionIds || []).length} รายการ)
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSelectAllNotes(noteOptions)}
                      className="text-[10px] text-blue-600 dark:text-blue-400 font-bold hover:underline"
                    >
                      เลือกทั้งหมด
                    </button>
                    <span className="text-slate-300 dark:text-slate-700">|</span>
                    <button
                      type="button"
                      onClick={handleClearAllNotes}
                      className="text-[10px] text-slate-500 hover:text-red-500 dark:hover:text-red-400 font-bold hover:underline"
                    >
                      ล้างการเลือก
                    </button>
                    <span className="text-slate-300 dark:text-slate-700">|</span>
                    <button
                      type="button"
                      onClick={() => setShowInlineAddNote(!showInlineAddNote)}
                      className="text-[10px] text-red-600 dark:text-yellow-400 font-bold hover:underline flex items-center gap-0.5"
                    >
                      <Plus className="w-3 h-3" />
                      <span>สร้างโน้ตใหม่</span>
                    </button>
                  </div>
                </div>

                {/* Inline Quick Add Note Option Box */}
                {showInlineAddNote && (
                  <div className="p-3 bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 rounded-xl space-y-2">
                    <span className="text-xs font-bold text-blue-900 dark:text-blue-200 block">
                      + สร้างตัวเลือกโน้ตใหม่และผูกทันที
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                      <input
                        type="text"
                        value={inlineNoteName}
                        onChange={(e) => setInlineNoteName(e.target.value)}
                        placeholder="ชื่อตัวเลือก เช่น ช็อตพิเศษ, หวาน 0%"
                        className="sm:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none"
                      />
                      <select
                        value={inlineNoteCategory}
                        onChange={(e) => setInlineNoteCategory(e.target.value)}
                        className="sm:col-span-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none"
                      >
                        <option value="ความหวาน">ความหวาน</option>
                        <option value="เครื่องดื่ม">เครื่องดื่ม</option>
                        <option value="อาหาร">อาหาร</option>
                        <option value="เบเกอรี่">เบเกอรี่</option>
                        <option value="ทั่วไป">ทั่วไป</option>
                      </select>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={inlineNotePrice}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => setInlineNotePrice(parseFloat(e.target.value) || 0)}
                        placeholder="+ราคา (บาท)"
                        className="sm:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleQuickAddNote}
                        className="sm:col-span-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors"
                      >
                        บันทึก & ผูก
                      </button>
                    </div>
                  </div>
                )}

                {/* Available Note Options Chips Grouped */}
                <div className="space-y-2.5 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                  {['ความหวาน', 'เครื่องดื่ม', 'อาหาร', 'เบเกอรี่', 'ทั่วไป'].map((catName) => {
                    const notesInCat = noteOptions.filter((n) => (n.category || 'ทั่วไป') === catName);
                    if (notesInCat.length === 0) return null;
                    return (
                      <div key={catName} className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
                          <span>{catName} ({notesInCat.length})</span>
                          <button
                            type="button"
                            onClick={() => handleSelectAllNotes(notesInCat)}
                            className="hover:underline text-blue-600 dark:text-blue-400"
                          >
                            เลือกหมวดนี้
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {notesInCat.map((note) => {
                            const isSelected = (formData.noteOptionIds || []).includes(note.id);
                            return (
                              <button
                                key={note.id}
                                type="button"
                                onClick={() => handleToggleNoteOption(note.id)}
                                className={`text-xs px-2.5 py-1.5 rounded-xl border flex items-center gap-1.5 transition-all ${
                                  isSelected
                                    ? 'bg-blue-600 border-blue-500 text-white font-bold shadow-xs'
                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                                }`}
                              >
                                {isSelected ? (
                                  <CheckSquare className="w-3.5 h-3.5 shrink-0" />
                                ) : (
                                  <Square className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                )}
                                <span>{note.name}</span>
                                {note.priceAdjustment && note.priceAdjustment > 0 ? (
                                  <span
                                    className={`text-[10px] px-1 py-0.2 rounded font-mono ${
                                      isSelected
                                        ? 'bg-blue-700 text-yellow-300'
                                        : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400'
                                    }`}
                                  >
                                    +{note.priceAdjustment}฿
                                  </span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>}

              {/* Action Buttons */}
              <div className="pt-4 flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddProductModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-600 text-white text-xs font-black shadow-md shadow-red-600/30 transition-all active:scale-95"
                >
                  {editingProduct ? 'บันทึกการแก้ไข' : 'ยืนยันเพิ่มสินค้า'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL 2: CATEGORIES MANAGEMENT ================= */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto custom-scrollbar">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 text-red-600 dark:text-yellow-400 font-bold">
                <FolderPlus className="w-5 h-5" />
                <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                  จัดการหมวดหมู่สินค้า (Categories)
                </h3>
              </div>
              <button
                onClick={() => setIsCategoryModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Add / Edit Category Form */}
            <form onSubmit={handleSubmitCategory} className="p-3.5 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                {editingCategory ? 'แก้ไขหมวดหมู่' : '+ เพิ่มหมวดหมู่ใหม่'}
              </span>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  required
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  placeholder="ชื่อหมวดหมู่ เช่น อาหารจานด่วน, ขนมไทย"
                  className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-red-500 dark:focus:border-yellow-400"
                />
                <select
                  value={categoryForm.icon}
                  onChange={(e) => setCategoryForm({ ...categoryForm, icon: e.target.value })}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
                >
                  <option value="Coffee">ไอคอน กาแฟ</option>
                  <option value="Croissant">ไอคอน เบเกอรี่</option>
                  <option value="Utensils">ไอคอน อาหาร</option>
                  <option value="Cookie">ไอคอน ของทานเล่น</option>
                  <option value="IceCream">ไอคอน ของหวาน</option>
                  <option value="Tag">ไอคอน ทั่วไป</option>
                </select>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black shrink-0 transition-all"
                >
                  {editingCategory ? 'บันทึก' : 'เพิ่ม'}
                </button>
              </div>
            </form>

            {/* List of current categories */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 block">
                หมวดหมู่ปัจจุบัน ({categories.length})
              </span>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden max-h-60 overflow-y-auto">
                {categories.map((c) => {
                  const pCount = getProductCountByCategory(c.id);
                  return (
                    <div
                      key={c.id}
                      className="p-3 flex items-center justify-between bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-yellow-400 flex items-center justify-center">
                          {renderCategoryIcon(c.icon || c.id)}
                        </div>
                        <div>
                          <span className="font-bold text-xs text-slate-800 dark:text-slate-200 block">
                            {c.name}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {pCount} รายการสินค้า
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCategory(c);
                            setCategoryForm({ name: c.name, icon: c.icon || 'Tag', color: c.color || '#EF4444' });
                          }}
                          className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                          title="แก้ไข"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteCategory(c.id)}
                          className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-red-600"
                          title="ลบหมวดหมู่"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 3: UNITS MANAGEMENT ================= */}
      {isUnitModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto custom-scrollbar">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400 font-bold">
                <Scale className="w-5 h-5" />
                <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                  จัดการหน่วยนับสินค้า (Units)
                </h3>
              </div>
              <button
                onClick={() => setIsUnitModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Add / Edit Unit Form */}
            <form onSubmit={handleSubmitUnit} className="p-3.5 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                {editingUnit ? 'แก้ไขหน่วยนับ' : '+ เพิ่มหน่วยนับใหม่'}
              </span>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  value={unitFormName}
                  onChange={(e) => setUnitFormName(e.target.value)}
                  placeholder="พิมพ์ชื่อหน่วย เช่น จาน, ขวด, ถุง, ชุด, แพ็ค"
                  className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-yellow-500"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-yellow-500 hover:bg-yellow-600 text-slate-950 text-xs font-black shrink-0 transition-all"
                >
                  {editingUnit ? 'บันทึก' : 'เพิ่ม'}
                </button>
              </div>
            </form>

            {/* List of current units */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 block">
                หน่วยนับทั้งหมด ({units.length})
              </span>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden max-h-60 overflow-y-auto">
                {units.map((u) => (
                  <div
                    key={u.id}
                    className="p-3 flex items-center justify-between bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <span className="font-bold text-xs text-slate-800 dark:text-slate-200">
                      {u.name}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingUnit(u);
                          setUnitFormName(u.name);
                        }}
                        className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                        title="แก้ไข"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteUnit(u.id)}
                        className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-red-600"
                        title="ลบหน่วยนับ"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 4: NOTE OPTIONS MANAGEMENT (จัดการตัวเลือกโน้ต & ส่วนผสม) ================= */}
      {false && isNoteModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto custom-scrollbar">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-bold">
                <MessageSquarePlus className="w-5 h-5" />
                <div>
                  <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                    จัดการตัวเลือกโน้ต & ส่วนผสม (Product Note Options)
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    กำหนดตัวเลือกเช่น ระดับความหวาน, การชง, เพิ่มท็อปปิ้ง และผูกกับสินค้าแต่ละรายการ
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsNoteModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Add / Edit Note Form */}
            <form onSubmit={handleSubmitNoteOption} className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                {editingNote ? 'แก้ไขตัวเลือกโน้ต' : '+ เพิ่มตัวเลือกโน้ต / ส่วนผสมใหม่'}
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                <div className="sm:col-span-5">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">ชื่อตัวเลือกโน้ต *</label>
                  <input
                    type="text"
                    required
                    value={noteForm.name}
                    onChange={(e) => setNoteForm({ ...noteForm, name: e.target.value })}
                    placeholder="เช่น หวาน 25%, เพิ่มช็อตกาแฟ, ไม่ใส่ผัก"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="sm:col-span-4">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">หมวดหมู่ตัวเลือก</label>
                  <select
                    value={noteForm.category}
                    onChange={(e) => setNoteForm({ ...noteForm, category: e.target.value })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
                  >
                    <option value="ความหวาน">ความหวาน (Sweetness)</option>
                    <option value="เครื่องดื่ม">เครื่องดื่ม (Beverage Type)</option>
                    <option value="อาหาร">อาหาร (Food / Cooking)</option>
                    <option value="เบเกอรี่">เบเกอรี่ (Bakery)</option>
                    <option value="ทั่วไป">ทั่วไป (General Notes)</option>
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">ราคาบวกเพิ่ม (฿)</label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={noteForm.priceAdjustment}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setNoteForm({ ...noteForm, priceAdjustment: parseFloat(e.target.value) || 0 })}
                      placeholder="0"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black shrink-0 transition-all shadow-xs"
                    >
                      {editingNote ? 'บันทึก' : 'เพิ่ม'}
                    </button>
                  </div>
                </div>
              </div>
              {editingNote && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingNote(null);
                      setNoteForm({ name: '', category: 'ความหวาน', priceAdjustment: 0 });
                    }}
                    className="text-[11px] text-slate-400 hover:underline"
                  >
                    ยกเลิกการแก้ไข (สร้างใหม่)
                  </button>
                </div>
              )}
            </form>

            {/* Filter by Category */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                รายการตัวเลือกทั้งหมด ({noteOptions.length})
              </span>
              <div className="flex gap-1">
                {['all', 'ความหวาน', 'เครื่องดื่ม', 'อาหาร', 'เบเกอรี่', 'ทั่วไป'].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setNoteFilterCategory(cat)}
                    className={`text-[10px] px-2 py-0.5 rounded-lg border transition-all ${
                      noteFilterCategory === cat
                        ? 'bg-blue-600 text-white border-blue-600 font-bold'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {cat === 'all' ? 'ทั้งหมด' : cat}
                  </button>
                ))}
              </div>
            </div>

            {/* List of note options */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden max-h-72 overflow-y-auto custom-scrollbar">
              {noteOptions
                .filter((n) => noteFilterCategory === 'all' || (n.category || 'ทั่วไป') === noteFilterCategory)
                .map((n) => {
                  // Find how many products are bound to this note
                  const boundProductsCount = products.filter((p) => (p.noteOptionIds || []).includes(n.id)).length;
                  return (
                    <div
                      key={n.id}
                      className="p-3 flex items-center justify-between bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          {n.category || 'ทั่วไป'}
                        </span>
                        <div>
                          <span className="font-bold text-xs text-slate-900 dark:text-white block">
                            {n.name}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            ผูกกับสินค้า {boundProductsCount} รายการ
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {n.priceAdjustment && n.priceAdjustment > 0 ? (
                          <span className="text-xs font-mono font-bold text-amber-600 dark:text-yellow-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-lg border border-amber-200 dark:border-amber-900/40">
                            +{n.priceAdjustment} ฿
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">ไม่มีค่าบริการ</span>
                        )}

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingNote(n);
                              setNoteForm({
                                name: n.name,
                                category: n.category || 'ความหวาน',
                                priceAdjustment: n.priceAdjustment || 0,
                              });
                            }}
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                            title="แก้ไข"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteNoteOption(n.id)}
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-red-600"
                            title="ลบตัวเลือกนี้"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
