import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  User,
  Search,
  ChevronDown,
  Check,
  Clock,
  Loader2,
  Sparkles,
  ShoppingBag,
  X,
  Store,
  Users,
} from 'lucide-react';

export interface CustomerSuggestion {
  id: string;
  name: string;
  category: 'table' | 'service' | 'recent' | 'member';
  categoryLabel: string;
  detail?: string;
}

interface CustomerComboboxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  recentCustomerNames?: string[];
  delayMs?: number;
  suggestions?: CustomerSuggestion[];
  onSearch?: (query: string) => void;
  onSelect?: (suggestion: CustomerSuggestion) => void;
  isLoading?: boolean;
  allowCustom?: boolean;
  required?: boolean;
  autoFocus?: boolean;
}

// Built-in presets for quick service & table management
const DEFAULT_PRESETS: CustomerSuggestion[] = [
  { id: 't-1', name: 'โต๊ะ 1', category: 'table', categoryLabel: 'โต๊ะในร้าน', detail: 'โซนห้องแอร์' },
  { id: 't-2', name: 'โต๊ะ 2', category: 'table', categoryLabel: 'โต๊ะในร้าน', detail: 'โซนห้องแอร์' },
  { id: 't-3', name: 'โต๊ะ 3', category: 'table', categoryLabel: 'โต๊ะในร้าน', detail: 'โซนห้องแอร์' },
  { id: 't-4', name: 'โต๊ะ 4', category: 'table', categoryLabel: 'โต๊ะในร้าน', detail: 'โซนริมกระจก' },
  { id: 't-5', name: 'โต๊ะ 5', category: 'table', categoryLabel: 'โต๊ะในร้าน', detail: 'โซนริมกระจก' },
  { id: 't-6', name: 'โต๊ะ 6', category: 'table', categoryLabel: 'โต๊ะในร้าน', detail: 'โซนกลางร้าน' },
  { id: 't-7', name: 'โต๊ะ 7', category: 'table', categoryLabel: 'โต๊ะในร้าน', detail: 'โซนกลางร้าน' },
  { id: 't-8', name: 'โต๊ะ 8', category: 'table', categoryLabel: 'โต๊ะในร้าน', detail: 'โซนระเบียง (Outdoor)' },
  { id: 't-vip1', name: 'โต๊ะ VIP 1', category: 'table', categoryLabel: 'โต๊ะในร้าน', detail: 'ห้องประชุม / รับรอง' },
  { id: 't-vip2', name: 'โต๊ะ VIP 2', category: 'table', categoryLabel: 'โต๊ะในร้าน', detail: 'ห้องประชุม / รับรอง' },
  { id: 's-takeaway', name: 'สั่งกลับบ้าน (Take Away)', category: 'service', categoryLabel: 'บริการภายนอก', detail: 'แพ็กใส่ถุง' },
  { id: 's-delivery-lineman', name: 'Delivery - LINE MAN', category: 'service', categoryLabel: 'บริการภายนอก', detail: 'ไรเดอร์รับหน้าร้าน' },
  { id: 's-delivery-grab', name: 'Delivery - GrabFood', category: 'service', categoryLabel: 'บริการภายนอก', detail: 'ไรเดอร์รับหน้าร้าน' },
  { id: 's-delivery-shopee', name: 'Delivery - ShopeeFood', category: 'service', categoryLabel: 'บริการภายนอก', detail: 'ไรเดอร์รับหน้าร้าน' },
  { id: 's-walkin', name: 'ลูกค้าหน้าร้าน (Walk-in)', category: 'service', categoryLabel: 'บริการภายนอก', detail: 'รอรับหน้าบาร์' },
  { id: 'm-1', name: 'คุณสมชาย (ลูกค้าประจำ VIP)', category: 'member', categoryLabel: 'ลูกค้าประจำ', detail: 'เบอร์ 081-xxx-5678' },
  { id: 'm-2', name: 'คุณวิภา (ลูกค้าประจำ)', category: 'member', categoryLabel: 'ลูกค้าประจำ', detail: 'เบอร์ 089-xxx-1234' },
  { id: 'm-3', name: 'คุณธนา (ลูกค้าประจำ)', category: 'member', categoryLabel: 'ลูกค้าประจำ', detail: 'เบอร์ 086-xxx-9988' },
];

export const CustomerCombobox: React.FC<CustomerComboboxProps> = ({
  value,
  onChange,
  placeholder = 'พิมพ์ชื่อลูกค้า, โต๊ะ หรือเลือกจากรายการ...',
  recentCustomerNames = [],
  delayMs = 500,
  suggestions,
  onSearch,
  onSelect,
  isLoading = false,
  allowCustom = true,
  required = false,
  autoFocus = true,
}) => {
  const [inputValue, setInputValue] = useState<string>(value);
  const [debouncedQuery, setDebouncedQuery] = useState<string>(value);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);

  // Sync external value
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  // Debounce before filtering locally and requesting remote suggestions.
  useEffect(() => {
    setIsSearching(true);
    const handler = setTimeout(() => {
      setDebouncedQuery(inputValue);
      onSearch?.(inputValue.trim());
      setIsSearching(false);
    }, delayMs);

    return () => {
      clearTimeout(handler);
    };
  }, [inputValue, delayMs, onSearch]);

  // Combine default presets with dynamic recent customers passed from props
  const allSuggestions = useMemo(() => {
    if (suggestions) return suggestions;
    const combined: CustomerSuggestion[] = [...DEFAULT_PRESETS];

    // Add unique recent customers from past held orders or context
    recentCustomerNames.forEach((name, idx) => {
      const trimmed = name.trim();
      if (trimmed && !combined.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) {
        combined.unshift({
          id: `recent-${idx}`,
          name: trimmed,
          category: 'recent',
          categoryLabel: 'ประวัติล่าสุด',
          detail: 'เคยบันทึกไว้ในระบบ',
        });
      }
    });

    return combined;
  }, [recentCustomerNames, suggestions]);

  // Filtered suggestions based on the debounced search query.
  const filteredSuggestions = useMemo(() => {
    const query = debouncedQuery.trim().toLowerCase();
    if (!query) {
      return allSuggestions;
    }

    return allSuggestions.filter((item) => {
      const matchName = item.name.toLowerCase().includes(query);
      const matchDetail = item.detail?.toLowerCase().includes(query);
      const matchCategory = item.categoryLabel.toLowerCase().includes(query);
      return matchName || matchDetail || matchCategory;
    });
  }, [allSuggestions, debouncedQuery]);

  // Check if current input matches an exact item
  const exactMatch = useMemo(() => {
    return allSuggestions.find(
      (item) => item.name.trim().toLowerCase() === inputValue.trim().toLowerCase()
    );
  }, [allSuggestions, inputValue]);

  // Handle outside click to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSelect = (suggestion: CustomerSuggestion) => {
    setInputValue(suggestion.name);
    setDebouncedQuery(suggestion.name);
    onChange(suggestion.name);
    onSelect?.(suggestion);
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleCustomSelect = (selectedName: string) => {
    setInputValue(selectedName);
    setDebouncedQuery(selectedName);
    onChange(selectedName);
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setInputValue(newVal);
    onChange(newVal);
    setIsOpen(true);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setIsOpen(true);
        return;
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < filteredSuggestions.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredSuggestions.length - 1
      );
    } else if (e.key === 'Enter') {
      if (isOpen && highlightedIndex >= 0 && highlightedIndex < filteredSuggestions.length) {
        e.preventDefault();
        handleSelect(filteredSuggestions[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const clearInput = () => {
    setInputValue('');
    setDebouncedQuery('');
    onChange('');
    inputRef.current?.focus();
  };

  const getCategoryIcon = (cat: CustomerSuggestion['category']) => {
    switch (cat) {
      case 'table':
        return <Store className="w-3.5 h-3.5 text-blue-500" />;
      case 'service':
        return <ShoppingBag className="w-3.5 h-3.5 text-amber-500" />;
      case 'recent':
        return <Clock className="w-3.5 h-3.5 text-emerald-500" />;
      case 'member':
        return <Users className="w-3.5 h-3.5 text-purple-500" />;
      default:
        return <User className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  return (
    <div ref={containerRef} className="relative w-full space-y-2">
      {/* Combobox Main Input Container */}
      <div className="relative flex items-center">
        {/* Leading Icon */}
        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none flex items-center">
          <User className="w-4 h-4 text-amber-600 dark:text-yellow-400" />
        </div>

        {/* Text / Combobox Input */}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          autoFocus={autoFocus}
          required={required}
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-20 py-2.5 text-sm text-slate-900 dark:text-white font-medium placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 dark:focus:border-yellow-400 transition-all shadow-2xs"
        />

        {/* Trailing Status & Controls */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {/* Debounce / remote-search indicator */}
          {(isSearching || isLoading) && (
            <div
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-yellow-950/40 text-[10px] text-amber-700 dark:text-yellow-400 font-mono border border-amber-200 dark:border-yellow-500/30 animate-pulse"
              title={`ระบบกำลังค้นหาหลังหน่วงเวลา ${delayMs}ms`}
            >
              <Loader2 className="w-3 h-3 animate-spin" />
              <span className="hidden sm:inline">{delayMs}ms</span>
            </div>
          )}

          {/* Clear Button */}
          {inputValue && (
            <button
              type="button"
              onClick={clearInput}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
              title="ล้างข้อความ"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Dropdown Toggle Button */}
          <button
            type="button"
            onClick={() => {
              setIsOpen((prev) => !prev);
              inputRef.current?.focus();
            }}
            className={`p-1.5 rounded-lg transition-colors ${
              isOpen
                ? 'bg-amber-100 dark:bg-slate-800 text-amber-700 dark:text-yellow-400 rotate-180'
                : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="เปิด/ปิด รายการตัวเลือก"
          >
            <ChevronDown className="w-4 h-4 transition-transform duration-200" />
          </button>
        </div>
      </div>

      {/* Dropdown Popover Listbox */}
      {isOpen && (
        <div
          ref={listboxRef}
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-1.5 space-y-1 custom-scrollbar animate-in fade-in zoom-in-95 duration-100"
        >
          {/* Header Bar inside dropdown */}
          <div className="px-3 py-1.5 flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
            <span className="font-bold">
              ผลการค้นหา {isSearching ? '(กำลังพิมพ์...)' : `(${filteredSuggestions.length} รายการ)`}
            </span>
            <span className="font-mono text-[10px]">Delay: {delayMs}ms</span>
          </div>

          {/* Option to use custom typed text if not strictly existing */}
          {allowCustom && inputValue.trim() && !exactMatch && (
            <button
              type="button"
              onClick={() => handleCustomSelect(inputValue.trim())}
              className="w-full text-left px-3 py-2 rounded-xl bg-amber-50/80 dark:bg-yellow-950/40 border border-amber-200 dark:border-yellow-500/30 hover:bg-amber-100 dark:hover:bg-yellow-900/40 transition-colors flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-600 dark:text-yellow-400 shrink-0" />
                <span className="text-slate-900 dark:text-white font-bold">
                  ใช้ชื่อนี้: &ldquo;{inputValue.trim()}&rdquo;
                </span>
              </div>
              <span className="text-[10px] text-amber-800 dark:text-yellow-300 font-medium bg-white/70 dark:bg-slate-900 px-2 py-0.5 rounded">
                กดเพื่อระบุ
              </span>
            </button>
          )}

          {/* Filtered suggestions list */}
          {filteredSuggestions.length > 0 ? (
            filteredSuggestions.map((item, idx) => {
              const isSelected =
                inputValue.trim().toLowerCase() === item.name.toLowerCase();
              const isHighlighted = idx === highlightedIndex;

              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  className={`w-full text-left px-3 py-2 rounded-xl transition-all flex items-center justify-between text-xs ${
                    isHighlighted || isSelected
                      ? 'bg-amber-50 dark:bg-slate-800/90 text-slate-900 dark:text-white'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0">
                      {getCategoryIcon(item.category)}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold truncate text-slate-900 dark:text-white">
                        {item.name}
                      </div>
                      {item.detail && (
                        <div className="text-[11px] text-slate-400 dark:text-slate-400 truncate">
                          {item.detail} • {item.categoryLabel}
                        </div>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <Check className="w-4 h-4 text-amber-600 dark:text-yellow-400 shrink-0" />
                  )}
                </button>
              );
            })
          ) : (
            <div className="p-4 text-center text-xs text-slate-400 space-y-1">
              <Search className="w-5 h-5 mx-auto text-slate-300 dark:text-slate-600" />
              <p>{allowCustom ? `ไม่พบรายการที่ตรงกับ “${debouncedQuery}”` : 'ไม่พบสมาชิกที่ตรงกับคำค้นหา'}</p>
              {allowCustom && (
                <button
                  type="button"
                  onClick={() => handleCustomSelect(inputValue.trim())}
                  className="mt-1 text-amber-600 dark:text-yellow-400 font-bold hover:underline"
                >
                  กดใช้ &ldquo;{inputValue.trim()}&rdquo; เป็นชื่อใหม่
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
