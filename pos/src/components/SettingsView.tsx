import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { usePos } from '../context/PosContext';
import { StoreSettings } from '../types';
import { AdminUser } from '../api/auth';
import {
  createPOSStaff,
  forceLogoutPOSStaff,
  getPOSActivity,
  getPOSAccessSettings,
  POSPermissionKey,
  POSPermissions,
  POS_REPORT_PERMISSION_KEYS,
  POSRole,
  POSStaffMember,
  resetPOSStaffPIN,
  savePOSRolePermissions,
  updatePOSStaff,
  updatePOSOwner,
  POSActivityItem,
} from '../api/posAccess';
import { getPOSPaymentQR } from '../api/posSales';
import { printIminText, probeIminPrinter } from '../utils/iminPrinter';
import { SystemSelect } from './SystemSelect';
import {
  Settings,
  Store,
  Monitor,
  Printer,
  DollarSign,
  Save,
  LoaderCircle,
  CircleCheck,
  ShieldCheck,
  Users,
  UserPlus,
  KeyRound,
  Power,
  LogOut,
  LockKeyhole,
  History,
  Image as ImageIcon,
  TestTube2,
  Search,
  ShieldAlert,
  MonitorSmartphone,
} from 'lucide-react';

type SettingsTab = 'store' | 'stock' | 'customer-display' | 'printer' | 'tax' | 'permissions' | 'members' | 'activity';
type MemberRole = POSRole;

const PERMISSION_LABELS = [
  ['sales', 'ขายสินค้า'],
  ['bills', 'บิลและประวัติ'],
  ['products', 'จัดการสินค้า'],
  ['stock', 'จัดการสต็อก'],
  ['reports', 'ดูรายงาน'],
  ['settings', 'ตั้งค่าระบบ'],
  ['discounts', 'ให้ส่วนลด'],
  ['void_sales', 'ยกเลิก / คืนบิล'],
  ['stock_adjust', 'ปรับยอดสต็อก'],
  ['product_pricing', 'แก้ไขราคาสินค้า'],
  ['report_export', 'ส่งออกรายงาน'],
  ['member_create', 'เพิ่มสมาชิกหลัก'],
] as const;

const REPORT_PERMISSION_LABELS = [
  ['report_overview', 'สรุปภาพรวมรายได้'],
  ['report_top_sellers', 'อันดับสินค้าขายดี'],
  ['report_vat', 'รายงานภาษีขาย (VAT)'],
  ['report_payments', 'สัดส่วนช่องทางชำระเงิน'],
  ['report_sold_products', 'สินค้าที่ขาย'],
  ['report_purchases', 'ซื้อจากซัพพลายเออร์'],
  ['report_inventory', 'สินค้าคงเหลือ'],
  ['report_transfers', 'โอนย้ายสต็อก'],
  ['report_special', 'POS + LiveMatch'],
] as const;

const DEFAULT_PERMISSIONS: Record<MemberRole, POSPermissions> = {
  owner: { sales: true, bills: true, products: true, stock: true, view_costs: true, reports: true, report_overview: true, report_top_sellers: true, report_vat: true, report_payments: true, report_sold_products: true, report_purchases: true, report_inventory: true, report_inventory_values: true, report_transfers: true, report_special: true, settings: true, discounts: true, void_sales: true, stock_adjust: true, product_pricing: true, report_export: true, member_create: true },
  manager: { sales: true, bills: true, products: true, stock: true, view_costs: true, reports: true, report_overview: true, report_top_sellers: true, report_vat: true, report_payments: true, report_sold_products: true, report_purchases: true, report_inventory: true, report_inventory_values: true, report_transfers: true, report_special: true, settings: false, discounts: true, void_sales: true, stock_adjust: true, product_pricing: true, report_export: true, member_create: true },
  cashier: { sales: true, bills: true, products: false, stock: false, view_costs: false, reports: false, report_overview: false, report_top_sellers: false, report_vat: false, report_payments: false, report_sold_products: false, report_purchases: false, report_inventory: false, report_inventory_values: false, report_transfers: false, report_special: false, settings: false, discounts: false, void_sales: false, stock_adjust: false, product_pricing: false, report_export: false, member_create: true },
};

const STAFF_ROLE_OPTIONS: Array<{ value: Exclude<MemberRole, 'owner'>; label: string }> = [
  { value: 'manager', label: 'ผู้จัดการ' },
  { value: 'cashier', label: 'แคชเชียร์' },
];
const OWNER_ROLE_OPTIONS: Array<{ value: MemberRole; label: string }> = [{ value: 'owner', label: 'เจ้าของระบบ' }];

interface SettingsViewProps {
  currentUser: AdminUser;
}

async function resizeQRImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('รองรับเฉพาะ PNG, JPEG และ WebP');
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('อ่านรูปไม่สำเร็จ')); reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const item = new Image(); item.onload = () => resolve(item); item.onerror = () => reject(new Error('รูปไม่ถูกต้อง')); item.src = source;
  });
  const scale = Math.min(1, 1400 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  const output = canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.86);
  const bytes = Math.ceil((output.split(',')[1]?.length || 0) * 3 / 4);
  if (bytes > 2 * 1024 * 1024) throw new Error('รูป QR ต้องไม่เกิน 2 MB หลังลดขนาด');
  return output;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ currentUser }) => {
  const { settings, updateSettings, showToast, playBeep } = usePos();
  const [activeTab, setActiveTab] = useState<SettingsTab>('store');
  const [formData, setFormData] = useState<StoreSettings>({ ...settings });
  const [members, setMembers] = useState<POSStaffMember[]>([]);
  const [maxMembers, setMaxMembers] = useState(0);
  const [permissions, setPermissions] = useState<Record<MemberRole, POSPermissions>>(DEFAULT_PERMISSIONS);
  const [memberDraft, setMemberDraft] = useState({ name: '', email: '', pin: '', role: 'cashier' as Exclude<MemberRole, 'owner'> });
  const [memberEdits, setMemberEdits] = useState<Record<string, { name: string; email: string }>>({});
  const [memberSaveState, setMemberSaveState] = useState<Record<string, 'saving' | 'success'>>({});
  const [activity, setActivity] = useState<POSActivityItem[]>([]);
  const [testQR, setTestQR] = useState('');
  const [isFormDirty, setIsFormDirty] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [printerDocumentMode, setPrinterDocumentMode] = useState<'discover' | 'test' | null>(null);
  const [iminPrinterState, setIminPrinterState] = useState<'idle' | 'checking' | 'connected' | 'unavailable' | 'error'>('idle');
  const [iminPrinterMessage, setIminPrinterMessage] = useState('ยังไม่ได้ตรวจสอบ InnerPrinter');
  const isOwner = currentUser.role === 'owner';
  const isAndroid = /Android/i.test(navigator.userAgent);
  const browserLabel = /EdgA\//i.test(navigator.userAgent) ? 'Microsoft Edge Android' : /Chrome\//i.test(navigator.userAgent) ? 'Chrome / Chromium' : navigator.userAgent.split(' ').slice(-1)[0] || 'ไม่ทราบ';

  const settingsPayloadForTab = (tab: Exclude<SettingsTab, 'permissions' | 'members' | 'activity'>): Partial<StoreSettings> => {
    switch (tab) {
      case 'store':
        return {
          storeName: formData.storeName, navbarTitle: formData.navbarTitle, navbarIconData: formData.navbarIconData,
          inheritBookingPromptPay: formData.inheritBookingPromptPay, promptPayType: formData.promptPayType,
          promptPayId: formData.promptPayId, promptPayReceiverName: formData.promptPayReceiverName,
          paymentQrImage: formData.paymentQrImage, email: formData.email, taxId: formData.taxId,
          phone: formData.phone, defaultLowStock: formData.defaultLowStock, address: formData.address, logoData: formData.logoData,
        };
      case 'stock':
        return {
          secondaryStockEnabled: formData.secondaryStockEnabled, primaryStockName: formData.primaryStockName,
          secondaryStockName: formData.secondaryStockName, saleStockLocation: formData.saleStockLocation,
        };
      case 'customer-display':
        return {
          customerDisplayTitle: formData.customerDisplayTitle, customerDisplayHighlight: formData.customerDisplayHighlight,
          customerDisplaySubtitle: formData.customerDisplaySubtitle, customerDisplayCardText: formData.customerDisplayCardText,
          customerDisplayCtaText: formData.customerDisplayCtaText,
        };
      case 'printer':
        return {
          printerType: formData.printerType, autoPrintReceipt: formData.autoPrintReceipt,
          receiptFooterMessage: formData.receiptFooterMessage,
        };
      case 'tax':
        return { vatEnabled: formData.vatEnabled, vatRate: formData.vatRate, vatType: formData.vatType };
    }
  };

  const applyAccessSettings = (payload: Awaited<ReturnType<typeof getPOSAccessSettings>>) => {
    setMembers(payload.items);
    setMaxMembers(payload.maxMembers);
    setPermissions(payload.permissions);
    setMemberEdits(Object.fromEntries(payload.items.map((item) => [item.id, { name: item.name, email: item.email }] )));
  };

  useEffect(() => {
    if (!isOwner) return;
    void getPOSAccessSettings()
      .then(applyAccessSettings)
      .catch((error) => showToast(error instanceof Error ? error.message : 'โหลดสมาชิก POS ไม่สำเร็จ', 'error'));
  }, [isOwner]);

  useEffect(() => {
    if (!isFormDirty) setFormData({ ...settings });
  }, [settings, isFormDirty]);

  useEffect(() => {
    if (!isOwner || activeTab !== 'activity') return;
    void getPOSActivity().then(setActivity).catch((error) => showToast(error instanceof Error ? error.message : 'โหลดประวัติไม่สำเร็จ', 'error'));
  }, [activeTab, isOwner]);

  const testPromptPay = async () => {
    if (!(await updateSettings(settingsPayloadForTab('store'), 'บันทึกข้อมูลร้านแล้ว', 'store'))) return;
    try {
      const result = await getPOSPaymentQR(10000);
      if (result.promptPayPayload) setTestQR(await QRCode.toDataURL(result.promptPayPayload, { width: 240, margin: 1 }));
      else if (result.fallbackImage) setTestQR(result.fallbackImage);
      else throw new Error('ยังไม่ได้ตั้งค่า PromptPay หรือ QR สำรอง');
    } catch (error) { showToast(error instanceof Error ? error.message : 'ทดสอบ QR ไม่สำเร็จ', 'error'); }
  };

  useEffect(() => {
    if (!printerDocumentMode) return;
    const handleAfterPrint = () => setPrinterDocumentMode(null);
    window.addEventListener('afterprint', handleAfterPrint, { once: true });
    const timer = window.setTimeout(() => {
      try {
        window.print();
        showToast(printerDocumentMode === 'discover' ? 'เปิดหน้าต่างค้นหา/เลือกเครื่องพิมพ์ของ Android แล้ว' : 'ส่งใบทดสอบไปยังหน้าต่างพิมพ์แล้ว', 'info');
        window.setTimeout(() => setPrinterDocumentMode(null), 5000);
      } catch {
        setPrinterDocumentMode(null);
        showToast('เบราว์เซอร์นี้ไม่สามารถเปิดหน้าต่างพิมพ์ได้', 'error');
      }
    }, 120);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, [printerDocumentMode]);

  const openPrinterDialog = async (mode: 'discover' | 'test') => {
    if (isAndroid) {
      setIminPrinterState('checking');
      setIminPrinterMessage('กำลังเชื่อมต่อ iMin Web Print…');
      try {
        let status = await probeIminPrinter();
        if (status.available && status.ready && mode === 'test') {
          status = await printIminText([
              formData.storeName,
              'ทดสอบเครื่องพิมพ์ iMin InnerPrinter',
              'iMin Web Print / LiveMatch POS',
              '--------------------------------',
              'ภาษาไทย: ทดสอบพิมพ์สำเร็จ',
              'English: Printer test successful',
              `Paper: ${formData.printerType === 'thermal_58mm' ? '58 mm' : '80 mm'}`,
              new Date().toLocaleString('th-TH'),
            ].join('\n'), formData.printerType === 'thermal_58mm' ? '58mm' : '80mm');
        }

        if (status.available) {
          setIminPrinterState(status.ready ? 'connected' : 'error');
          setIminPrinterMessage(`InnerPrinter · ${status.connectionType || '-'} · ${status.message}`);
          showToast(status.ready
            ? (mode === 'test' ? 'พิมพ์ใบทดสอบผ่าน iMin InnerPrinter แล้ว' : 'เชื่อมต่อ iMin InnerPrinter สำเร็จ')
            : status.message,
          status.ready ? 'success' : 'error');
          return;
        }
        setIminPrinterState('unavailable');
        setIminPrinterMessage(status.message);
      } catch (error) {
        setIminPrinterState('error');
        setIminPrinterMessage(error instanceof Error ? error.message : 'เชื่อมต่อ InnerPrinter ไม่สำเร็จ');
        showToast(error instanceof Error ? error.message : 'เชื่อมต่อ InnerPrinter ไม่สำเร็จ', 'error');
        return;
      }
    }

    if (typeof window.print !== 'function') {
      showToast('เบราว์เซอร์นี้ไม่รองรับ Android Print Dialog', 'error');
      return;
    }
    setPrinterDocumentMode(null);
    window.setTimeout(() => setPrinterDocumentMode(mode), 0);
  };

  const forceLogout = async (member: POSStaffMember) => {
    if (!window.confirm(`ให้ออกจากระบบทุกอุปกรณ์ของ ${member.name} ใช่ไหม`)) return;
    try { await forceLogoutPOSStaff(member.id); showToast('ออกจากระบบทุกอุปกรณ์แล้ว', 'success'); }
    catch (error) { showToast(error instanceof Error ? error.message : 'ออกจากระบบไม่สำเร็จ', 'error'); }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingSettings) return;
    setIsSavingSettings(true);
    try {
      if (activeTab === 'permissions') {
        if (!isOwner) throw new Error('เฉพาะเจ้าของระบบเท่านั้นที่บันทึกสิทธิ์ได้');
        applyAccessSettings(await savePOSRolePermissions({ manager: permissions.manager, cashier: permissions.cashier }));
        showToast('บันทึกสิทธิ์การใช้งานเรียบร้อยแล้ว', 'success');
      } else if (activeTab !== 'members' && activeTab !== 'activity') {
        const labels: Record<typeof activeTab, string> = {
          store: 'ข้อมูลร้าน', stock: 'การตั้งค่าสต็อก', 'customer-display': 'จอลูกค้า', printer: 'เครื่องพิมพ์', tax: 'ภาษี',
        };
        if (!(await updateSettings(settingsPayloadForTab(activeTab), `บันทึก${labels[activeTab]}เรียบร้อยแล้ว`, activeTab))) return;
      }
      setIsFormDirty(false);
      playBeep('success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'บันทึกสิทธิ์ไม่สำเร็จ', 'error');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const addMember = async () => {
    if (members.length >= maxMembers) {
      showToast('เพิ่มสมาชิกได้สูงสุด 3 คน', 'warning');
      return;
    }
    if (!memberDraft.name.trim() || !/^\d{6}$/.test(memberDraft.pin)) {
      showToast('กรุณากรอกชื่อและ PIN ตัวเลข 6 หลัก', 'warning');
      return;
    }
    if (memberDraft.email && members.some((member) => member.email.toLowerCase() === memberDraft.email.trim().toLowerCase())) {
      showToast('อีเมลนี้อยู่ในรายชื่อแล้ว', 'warning');
      return;
    }
    try {
      applyAccessSettings(await createPOSStaff({ name: memberDraft.name.trim(), email: memberDraft.email.trim(), role: memberDraft.role, pin: memberDraft.pin }));
      setMemberDraft({ name: '', email: '', pin: '', role: 'cashier' });
      showToast('เพิ่มสมาชิกและสร้าง Staff Number แล้ว', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'เพิ่มสมาชิกไม่สำเร็จ', 'error');
    }
  };

  const saveMember = async (member: POSStaffMember, changes: Partial<POSStaffMember>, withButtonFeedback = false) => {
    if (withButtonFeedback && memberSaveState[member.id]) return;
    const next = { ...member, ...changes };
    if (withButtonFeedback) setMemberSaveState((current) => ({ ...current, [member.id]: 'saving' }));
    try {
      if (next.role === 'owner') {
        applyAccessSettings(await updatePOSOwner({ name: next.name.trim(), email: next.email.trim() }));
        window.dispatchEvent(new CustomEvent('livematch:pos-owner-updated', { detail: { name: next.name.trim(), email: next.email.trim() } }));
        showToast('อัปเดตข้อมูลเจ้าของระบบแล้ว', 'success');
      } else {
        applyAccessSettings(await updatePOSStaff(next.id, { name: next.name, email: next.email, role: next.role, active: next.active }));
        showToast('อัปเดตสมาชิกแล้ว', 'success');
      }
      if (withButtonFeedback) {
        playBeep('success');
        setMemberSaveState((current) => ({ ...current, [member.id]: 'success' }));
        window.setTimeout(() => setMemberSaveState((current) => {
          const updated = { ...current };
          delete updated[member.id];
          return updated;
        }), 1400);
      }
    } catch (error) {
      if (withButtonFeedback) setMemberSaveState((current) => {
        const updated = { ...current };
        delete updated[member.id];
        return updated;
      });
      showToast(error instanceof Error ? error.message : 'อัปเดตสมาชิกไม่สำเร็จ', 'error');
    }
  };

  const resetMemberPIN = async (member: POSStaffMember) => {
    const entered = window.prompt('กรอก PIN ใหม่ 6 หลัก หรือเว้นว่างเพื่อให้ระบบสร้างให้');
    if (entered === null) return;
    try {
      const result = await resetPOSStaffPIN(member.id, entered.trim());
      window.alert(`PIN ใหม่ของ ${member.name}: ${result.pin}\nโปรดส่งให้เจ้าตัวและเก็บไว้ในที่ปลอดภัย`);
      showToast('รีเซ็ต PIN และออกจากระบบทุกอุปกรณ์แล้ว', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'รีเซ็ต PIN ไม่สำเร็จ', 'error');
    }
  };

  const togglePermission = (role: Exclude<MemberRole, 'owner'>, permission: POSPermissionKey) => {
    setPermissions((current) => {
      const enabled = !current[role][permission];
      const next = { ...current[role], [permission]: enabled };
      if (permission === 'stock' && !enabled) next.view_costs = false;
      if (permission === 'reports') POS_REPORT_PERMISSION_KEYS.forEach((key) => { next[key] = enabled; });
      if (permission === 'report_inventory' && !enabled) next.report_inventory_values = false;
      if (permission.startsWith('report_') && permission !== 'report_export') {
        next.reports = enabled || POS_REPORT_PERMISSION_KEYS.some((key) => key !== permission && key !== 'report_inventory_values' && next[key]);
      }
      return { ...current, [role]: next };
    });
  };

  return (
    <div className="flex-1 w-full p-4 sm:p-6 space-y-6 pb-24 overflow-y-auto bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Settings className="w-6 h-6 text-emerald-500" />
            <span>ตั้งค่าระบบ LiveMatch POS</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            กำหนดข้อมูลร้านค้า ใบเสร็จ ภาษี สิทธิ์ และสมาชิกผู้ใช้งาน
          </p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs overflow-x-auto gap-1 shadow-xs">
        <button
          onClick={() => setActiveTab('store')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold whitespace-nowrap transition-all ${
            activeTab === 'store'
              ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Store className="w-4 h-4" />
          <span>ข้อมูลร้านค้า (Store Info)</span>
        </button>

        <button
          onClick={() => setActiveTab('stock')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold whitespace-nowrap transition-all ${activeTab === 'stock' ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
        >
          <Store className="w-4 h-4" />
          <span>ตั้งค่าสต็อก</span>
        </button>

        <button
          onClick={() => setActiveTab('customer-display')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold whitespace-nowrap transition-all ${
            activeTab === 'customer-display'
              ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Monitor className="w-4 h-4" />
          <span>จอลูกค้า</span>
        </button>

        <button
          onClick={() => setActiveTab('printer')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold whitespace-nowrap transition-all ${
            activeTab === 'printer'
              ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Printer className="w-4 h-4" />
          <span>เครื่องพิมพ์ & ใบเสร็จ</span>
        </button>

        <button
          onClick={() => setActiveTab('tax')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold whitespace-nowrap transition-all ${
            activeTab === 'tax'
              ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <DollarSign className="w-4 h-4" />
          <span>ภาษี & การเงิน (VAT / Decimal)</span>
        </button>

        {isOwner && (
          <>
            <button
              onClick={() => setActiveTab('permissions')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold whitespace-nowrap transition-all ${
                activeTab === 'permissions'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>สิทธิ์การใช้งาน</span>
            </button>

            <button
              onClick={() => setActiveTab('members')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold whitespace-nowrap transition-all ${
                activeTab === 'members'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>เพิ่มสมาชิก ({members.length}/{maxMembers || '—'})</span>
            </button>
            <button
              onClick={() => setActiveTab('activity')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold whitespace-nowrap transition-all ${activeTab === 'activity' ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
            >
              <History className="w-4 h-4" />
              <span>ประวัติความปลอดภัย</span>
            </button>
          </>
        )}
      </div>

      {/* TAB CONTENTS */}
      <form data-pos-editing={isFormDirty ? 'true' : 'false'} onSubmit={handleSave} onChangeCapture={() => setIsFormDirty(true)} onClickCapture={(event) => { if ((event.target as HTMLElement).closest('button[type="button"]')) setIsFormDirty(true); }} className="space-y-6">
        {/* TAB 1: STORE INFO */}
        {activeTab === 'store' && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-md space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-3 flex items-center gap-2">
              <Store className="w-4 h-4 text-emerald-500" />
              <span>ข้อมูลประจำร้านค้า</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  ชื่อร้านค้า (Store Name) *
                </label>
                <input
                  type="text"
                  required
                  value={formData.storeName}
                  onChange={(e) => setFormData({ ...formData, storeName: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">ข้อความหัวระบบบน Navbar</label>
                <input type="text" maxLength={80} value={formData.navbarTitle} onChange={(event) => setFormData({ ...formData, navbarTitle: event.target.value })} placeholder="เช่น REVIEW (เว้นว่างเพื่อใช้ชื่อ Admin)" className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500" />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">ไอคอนหัวระบบบน Navbar (PNG/JPEG/WebP ไม่เกิน 2 MB)</label>
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-tr from-red-600 via-red-500 to-yellow-500 text-white">
                    {formData.navbarIconData ? <img src={formData.navbarIconData} alt="ไอคอนหัวระบบ" className="h-full w-full object-cover" /> : <Store className="h-5 w-5" />}
                  </div>
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { const navbarIconData = await resizeQRImage(file); setFormData((current) => ({ ...current, navbarIconData })); } catch (error) { showToast(error instanceof Error ? error.message : 'อัปโหลดไอคอนไม่สำเร็จ', 'error'); } event.target.value=''; }} className="min-w-0 flex-1 text-xs" />
                  {formData.navbarIconData ? <button type="button" onClick={() => setFormData({ ...formData, navbarIconData: '' })} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600">ใช้ไอคอนเดิม</button> : null}
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={formData.inheritBookingPromptPay !== false} onChange={(e) => setFormData({ ...formData, inheritBookingPromptPay: e.target.checked })} className="h-4 w-4 accent-emerald-500" />
                ใช้ PromptPay จากระบบจองสนาม (หากปิดจะใช้ค่าของ POS)
              </label>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">ชื่อบัญชีผู้รับ PromptPay</label>
                <input type="text" value={formData.promptPayReceiverName || ''} onChange={(e) => setFormData({ ...formData, promptPayReceiverName: e.target.value })} disabled={formData.inheritBookingPromptPay !== false} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs disabled:opacity-50" />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">QR รับเงินสำรอง (ไม่เกิน 2 MB)</label>
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                  {formData.paymentQrImage ? <img src={formData.paymentQrImage} alt="QR รับเงินสำรอง" className="h-20 w-20 rounded-lg bg-white object-contain p-1" /> : null}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => {
                    const file = event.target.files?.[0]; if (!file) return;
                    try { const paymentQrImage = await resizeQRImage(file); setFormData((current) => ({ ...current, paymentQrImage })); } catch (error) { showToast(error instanceof Error ? error.message : 'อัปโหลด QR ไม่สำเร็จ', 'error'); }
                    event.target.value = '';
                  }} className="min-w-0 flex-1 text-xs" />
                  {formData.paymentQrImage ? <button type="button" onClick={() => setFormData({ ...formData, paymentQrImage: '' })} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600">ลบ</button> : null}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  อีเมลร้านค้า
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  เลขประจำตัวผู้เสียภาษี (Tax ID 13 หลัก)
                </label>
                <input
                  type="text"
                  value={formData.taxId}
                  onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  เบอร์โทรศัพท์ติดต่อร้าน
                </label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  PromptPay ID (เบอร์โทร / เลขนิติบุคคล สำหรับสร้าง QR)
                </label>
                <select value={formData.promptPayType || 'mobile'} onChange={(e) => setFormData({ ...formData, promptPayType: e.target.value as StoreSettings['promptPayType'] })} disabled={formData.inheritBookingPromptPay !== false} className="mb-2 w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2 text-xs disabled:opacity-50">
                  <option value="mobile">เบอร์โทร</option><option value="national_id">บัตรประชาชน / เลขผู้เสียภาษี</option><option value="ewallet">e-Wallet</option>
                </select>
                <input
                  type="text"
                  value={formData.promptPayId}
                  onChange={(e) => setFormData({ ...formData, promptPayId: e.target.value })}
                  disabled={formData.inheritBookingPromptPay !== false}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  จำนวนแจ้งเตือนสต็อกต่ำเริ่มต้น
                </label>
                <input
                  type="number" min="0" step="1"
                  value={formData.defaultLowStock}
                  onChange={(e) => setFormData({ ...formData, defaultLowStock: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  ที่อยู่ร้านค้า (แสดงบนหัวใบเสร็จรับเงิน)
                </label>
                <textarea
                  rows={2}
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">โลโก้ร้านบนใบเสร็จ (ไม่เกิน 2 MB)</label>
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  {formData.logoData ? <img src={formData.logoData} alt="โลโก้ร้าน" className="h-20 w-20 rounded-lg object-contain" /> : <ImageIcon className="h-8 w-8 text-slate-400" />}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { const logoData = await resizeQRImage(file); setFormData((current) => ({ ...current, logoData })); } catch (error) { showToast(error instanceof Error ? error.message : 'อัปโหลดโลโก้ไม่สำเร็จ', 'error'); } event.target.value=''; }} className="min-w-0 flex-1 text-xs" />
                  {formData.logoData ? <button type="button" onClick={() => setFormData({ ...formData, logoData: '' })} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600">ลบ</button> : null}
                </div>
              </div>

              <div className="md:col-span-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs dark:border-emerald-500/20 dark:bg-emerald-500/10">
                <div className="font-bold">PromptPay ที่ระบบจะใช้จริง</div>
                <div className="mt-1 text-slate-600 dark:text-slate-300">แหล่งที่มา: {formData.effectivePromptPaySource === 'booking' ? 'ระบบจองสนาม' : 'POS'} · ผู้รับ: {formData.effectivePromptPayReceiverName || '-'} · ID: {formData.effectivePromptPayIdMasked || '-'}</div>
                <button type="button" onClick={() => void testPromptPay()} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 font-bold text-slate-950"><TestTube2 className="h-4 w-4" />บันทึกและทดสอบ QR ฿100</button>
                {testQR ? <img src={testQR} alt="QR ทดสอบ" className="mt-3 h-40 w-40 rounded-xl bg-white p-2" /> : null}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'stock' && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-sm font-black">คลังสินค้าและการตัดสต็อก</h3>
              <p className="mt-1 text-xs text-slate-500">ยอดเดิมทั้งหมดอยู่ในสต็อกหลัก การเปลี่ยนคลังขายมีผลกับบิลใหม่เท่านั้น</p>
              <label className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <span><b className="block text-xs">เปิดใช้งานสต็อกที่ 2</b><small className="text-slate-500">ต้องโอนยอดในสต็อกที่ 2 ให้เป็นศูนย์ก่อนปิด</small></span>
                <input type="checkbox" checked={formData.secondaryStockEnabled} onChange={(e) => setFormData({ ...formData, secondaryStockEnabled: e.target.checked, saleStockLocation: e.target.checked ? formData.saleStockLocation : 'primary' })} className="h-5 w-5 accent-emerald-500" />
              </label>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-xs font-bold">ชื่อสต็อกหลัก<input value={formData.primaryStockName} onChange={(e) => setFormData({ ...formData, primaryStockName: e.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-950" /></label>
                <label className="text-xs font-bold">ชื่อสต็อกที่ 2<input disabled={!formData.secondaryStockEnabled} value={formData.secondaryStockName} onChange={(e) => setFormData({ ...formData, secondaryStockName: e.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950" /></label>
              </div>
              <label className="mt-4 block text-xs font-bold">สต็อกที่ใช้ตัดเมื่อขาย
                <select value={formData.saleStockLocation} onChange={(e) => setFormData({ ...formData, saleStockLocation: e.target.value as StoreSettings['saleStockLocation'] })} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-950">
                  <option value="primary">{formData.primaryStockName || 'สต็อกหลัก'}</option>
                  {formData.secondaryStockEnabled && <option value="secondary">{formData.secondaryStockName || 'สต็อกที่ 2'}</option>}
                </select>
              </label>
            </div>
          </div>
        )}

        {activeTab === 'customer-display' && (
          <div className="grid gap-5 xl:grid-cols-[1fr_1.1fr]">
            <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-md dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-200 pb-3 dark:border-slate-800">
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><Monitor className="h-4 w-4 text-emerald-500" />ข้อความหน้า Index จอลูกค้า</h3>
                <p className="mt-1 text-[11px] text-slate-500">แสดงบน <span className="font-mono">display=customer</span> เมื่อตะกร้ายังไม่มีสินค้า</p>
              </div>
              <label className="grid gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">ข้อความหัวเรื่อง
                <input maxLength={120} value={formData.customerDisplayTitle} onChange={(event) => setFormData({ ...formData, customerDisplayTitle: event.target.value })} className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950" />
              </label>
              <label className="grid gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">ข้อความสีส้ม
                <input maxLength={120} value={formData.customerDisplayHighlight} onChange={(event) => setFormData({ ...formData, customerDisplayHighlight: event.target.value })} className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950" />
              </label>
              <label className="grid gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">ข้อความอธิบาย
                <textarea rows={3} maxLength={300} value={formData.customerDisplaySubtitle} onChange={(event) => setFormData({ ...formData, customerDisplaySubtitle: event.target.value })} className="resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950" />
              </label>
              <label className="grid gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">ข้อความใต้ชื่อร้านในการ์ด
                <textarea rows={2} maxLength={300} value={formData.customerDisplayCardText} onChange={(event) => setFormData({ ...formData, customerDisplayCardText: event.target.value })} className="resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950" />
              </label>
              <label className="grid gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">ข้อความปุ่มแนะนำด้านล่าง
                <input maxLength={160} value={formData.customerDisplayCtaText} onChange={(event) => setFormData({ ...formData, customerDisplayCtaText: event.target.value })} className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950" />
              </label>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-md dark:border-slate-800 dark:bg-slate-950">
              <div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-black">ตัวอย่างหน้า Index</h3><span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-800">Live Preview</span></div>
              <div className="grid min-h-[430px] gap-5 rounded-2xl border border-slate-200 bg-white p-6 lg:grid-cols-[1.2fr_.8fr] lg:items-center dark:border-slate-700 dark:bg-slate-900">
                <div>
                  <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[10px] font-bold text-amber-800">✨ ยินดีต้อนรับสู่ {formData.storeName}</span>
                  <h4 className="mt-5 whitespace-pre-line text-3xl font-black leading-tight text-slate-900 dark:text-white">{formData.customerDisplayTitle || 'ยินดีต้อนรับ'}<br /><span className="text-amber-600">{formData.customerDisplayHighlight || 'กรุณาตรวจสอบรายการและยอดชำระ'}</span></h4>
                  <p className="mt-4 whitespace-pre-line text-xs leading-relaxed text-slate-500">{formData.customerDisplaySubtitle}</p>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-center dark:border-slate-700 dark:bg-slate-950">
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-amber-300 bg-amber-50 text-amber-600"><Store className="h-7 w-7" /></div>
                  <div className="mt-3 text-sm font-black">{formData.storeName}</div>
                  <p className="mt-1 text-[10px] text-slate-500">{formData.customerDisplayCardText}</p>
                  <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-800">✨ {formData.customerDisplayCtaText}</div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* TAB 2: PRINTER SETTINGS */}
        {activeTab === 'printer' && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-md space-y-5">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-3 flex items-center gap-2">
              <Printer className="w-4 h-4 text-emerald-500" />
              <span>เครื่องพิมพ์ความร้อน & ใบเสร็จ</span>
            </h3>
            <p className="text-[11px] text-slate-500">ขนาดกระดาษและการเปิดใบเสร็จอัตโนมัติบันทึกเฉพาะ browser เครื่องนี้ ส่วนข้อความท้ายใบเสร็จบันทึกในบัญชีร้าน</p>

            <section className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-500/20 dark:bg-sky-500/5" aria-labelledby="printer-device-status-title">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 id="printer-device-status-title" className="flex items-center gap-2 text-xs font-black text-slate-900 dark:text-white"><MonitorSmartphone className="h-4 w-4 text-sky-600" />สถานะการพิมพ์บนอุปกรณ์นี้</h4>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-500">บน W POS ระบบจะตรวจ iMin InnerPrinter ผ่าน Web Print ก่อน หากไม่รองรับจึงเปิด Android Print Dialog เป็น fallback</p>
                </div>
                <span id="imin-printer-status-badge" className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black ${iminPrinterState === 'connected' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : iminPrinterState === 'checking' ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300' : iminPrinterState === 'error' ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{iminPrinterState === 'connected' ? 'InnerPrinter พร้อมใช้' : iminPrinterState === 'checking' ? 'กำลังตรวจสอบ' : iminPrinterState === 'error' ? 'InnerPrinter มีปัญหา' : 'Android Print fallback'}</span>
              </div>
              <p id="imin-printer-status-message" className="mt-2 text-[10px] font-bold text-slate-600 dark:text-slate-300">{iminPrinterMessage}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
                <div className="rounded-xl bg-white/80 p-2.5 dark:bg-slate-950/60"><dt className="font-bold text-slate-400">ระบบ</dt><dd className="mt-0.5 font-black">{isAndroid ? 'Android' : 'Desktop / Other'}</dd></div>
                <div className="rounded-xl bg-white/80 p-2.5 dark:bg-slate-950/60"><dt className="font-bold text-slate-400">Browser</dt><dd className="mt-0.5 truncate font-black" title={browserLabel}>{browserLabel}</dd></div>
                <div className="rounded-xl bg-white/80 p-2.5 dark:bg-slate-950/60"><dt className="font-bold text-slate-400">การเชื่อมต่อ</dt><dd className={`mt-0.5 font-black ${window.isSecureContext ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>{window.isSecureContext ? 'HTTPS / Secure' : 'ไม่ใช่ HTTPS'}</dd></div>
                <div className="rounded-xl bg-white/80 p-2.5 dark:bg-slate-950/60"><dt className="font-bold text-slate-400">กระดาษ</dt><dd className="mt-0.5 font-black">{formData.printerType === 'thermal_58mm' ? '58 mm' : '80 mm'}</dd></div>
              </dl>
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                  ขนาดหน้ากว้างกระดาษเครื่องพิมพ์ (Paper Width)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, printerType: 'thermal_80mm' })}
                    className={`p-3 rounded-2xl border text-xs font-bold transition-all ${
                      formData.printerType === 'thermal_80mm'
                        ? 'bg-emerald-50 dark:bg-emerald-500/20 border-emerald-500 text-emerald-700 dark:text-emerald-400 shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <div>ขนาด 80 mm</div>
                    <div className="text-[10px] font-normal text-slate-500 mt-0.5">
                      มาตรฐานตั้งโต๊ะ ESC/POS
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, printerType: 'thermal_58mm' })}
                    className={`p-3 rounded-2xl border text-xs font-bold transition-all ${
                      formData.printerType === 'thermal_58mm'
                        ? 'bg-emerald-50 dark:bg-emerald-500/20 border-emerald-500 text-emerald-700 dark:text-emerald-400 shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <div>ขนาด 58 mm</div>
                    <div className="text-[10px] font-normal text-slate-500 mt-0.5">
                      พกพา / บลูทูธไร้สาย
                    </div>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                  การพิมพ์อัตโนมัติ
                </label>
                <label className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.autoPrintReceipt}
                    onChange={(e) =>
                      setFormData({ ...formData, autoPrintReceipt: e.target.checked })
                    }
                    className="w-4 h-4 rounded text-emerald-500 focus:ring-0 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700"
                  />
                  <div>
                    <span className="text-xs font-semibold text-slate-900 dark:text-white block">
                      เปิดหน้าต่างใบเสร็จอัตโนมัติเมื่อชำระเงินเสร็จ
                    </span>
                    <span className="text-[10px] text-slate-500">
                      แสดง Receipt Preview พร้อมปุ่มพิมพ์ทันที
                    </span>
                  </div>
                </label>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  ข้อความท้ายใบเสร็จ (Receipt Footer Note)
                </label>
                <input
                  type="text"
                  value={formData.receiptFooterMessage}
                  onChange={(e) =>
                    setFormData({ ...formData, receiptFooterMessage: e.target.value })
                  }
                  placeholder="ขอบคุณที่ใช้บริการ / Thank you"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="md:col-span-2">
                <div className="flex flex-wrap gap-2">
                  <button id="discover-printer-btn" type="button" disabled={iminPrinterState === 'checking'} onClick={() => void openPrinterDialog('discover')} className="inline-flex items-center gap-2 rounded-xl border border-sky-300 bg-sky-50 px-4 py-2.5 text-xs font-bold text-sky-700 disabled:opacity-60 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300"><Search className="h-4 w-4" />ตรวจหา InnerPrinter / Android</button>
                  <button id="test-printer-btn" type="button" disabled={iminPrinterState === 'checking'} onClick={() => void openPrinterDialog('test')} className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-700 disabled:opacity-60 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"><Printer className="h-4 w-4" />ทดสอบพิมพ์ InnerPrinter</button>
                </div>
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] leading-relaxed text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/5 dark:text-amber-300">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>รองรับ iMin H5 Web Print ที่ <b>127.0.0.1:8081</b> โดยตรง ไม่ต้องให้ InnerPrinter ปรากฏใน Android Print Dialog หาก Web Print ใช้ไม่ได้ ระบบจะกลับไปใช้ Print Service ตามเดิม</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: TAX & FINANCIALS */}
        {activeTab === 'tax' && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-md space-y-5">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-3 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-500" />
              <span>อัตราภาษี & การแสดงผลทศนิยม</span>
            </h3>

            <label className={`flex cursor-pointer items-center justify-between gap-4 rounded-2xl border p-4 transition-colors ${formData.vatEnabled ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10' : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950'}`}>
              <span>
                <span className="block text-sm font-bold text-slate-900 dark:text-white">ใช้งานภาษีมูลค่าเพิ่ม (VAT)</span>
                <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">
                  เมื่อปิด ระบบจะไม่คำนวณ VAT และไม่แสดงรายการ VAT บนใบเสร็จ
                </span>
              </span>
              <span className="relative shrink-0">
                <input
                  type="checkbox"
                  checked={formData.vatEnabled}
                  onChange={(event) => setFormData({ ...formData, vatEnabled: event.target.checked })}
                  className="peer sr-only"
                />
                <span className="block h-7 w-12 rounded-full bg-slate-300 transition peer-checked:bg-emerald-500 dark:bg-slate-700" />
                <span className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
              </span>
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  อัตราภาษีมูลค่าเพิ่ม (VAT %)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    disabled={!formData.vatEnabled}
                    value={formData.vatRate}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) =>
                      setFormData({ ...formData, vatRate: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-emerald-600 dark:text-emerald-400 font-bold focus:outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                    %
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  รูปแบบการคำนวณ VAT
                </label>
                <select
                  disabled={!formData.vatEnabled}
                  value={formData.vatType}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      vatType: e.target.value as 'included' | 'excluded',
                    })
                  }
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <option value="included">รวมในราคาสินค้าแล้ว (VAT Included 7%)</option>
                  <option value="excluded">คิดแยกนอกยอดรวม (VAT Excluded +7%)</option>
                </select>
              </div>

              <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-800 dark:bg-slate-950">
                ระบบใช้เงินบาท (฿) และคำนวณเป็นหน่วยสตางค์ 2 ตำแหน่งเสมอ เพื่อให้ยอดขาย ภาษี ต้นทุน และรายงานตรงกันทุกหน้า
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: PERMISSIONS */}
        {activeTab === 'permissions' && (
          <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-md dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  สิทธิ์การใช้งานตามบทบาท
                </h3>
                <p className="mt-1 text-[11px] text-slate-500">กำหนดเมนูที่ผู้จัดการและแคชเชียร์สามารถเข้าใช้งานได้</p>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">API Enforced</span>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              {(['owner', 'manager', 'cashier'] as MemberRole[]).map((role) => (
                <section key={role} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
                  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                    <div>
                      <h4 className="text-sm font-bold">{role === 'owner' ? 'เจ้าของระบบ' : role === 'manager' ? 'ผู้จัดการ' : 'แคชเชียร์'}</h4>
                      <p className="text-[10px] text-slate-500">{role === 'owner' ? 'เข้าถึงทุกเมนูเสมอ' : role === 'manager' ? 'ดูแลการดำเนินงาน' : 'ใช้งานหน้าขายเป็นหลัก'}</p>
                    </div>
                    <span className={`h-2.5 w-2.5 rounded-full ${role === 'owner' ? 'bg-amber-400' : role === 'manager' ? 'bg-sky-500' : 'bg-emerald-500'}`} />
                  </div>
                  <div className="grid gap-1.5 p-3">
                    {PERMISSION_LABELS.map(([key, label]) => {
                      const enabled = permissions[role][key];
                      return (
                        <React.Fragment key={key}>
                          <label className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${enabled ? 'border-emerald-200 bg-white dark:border-emerald-500/20 dark:bg-slate-900' : 'border-slate-200 bg-slate-100 opacity-65 dark:border-slate-800 dark:bg-slate-900/50'}`}>
                            <span className="text-xs font-semibold">{label}</span>
                            <input
                              type="checkbox"
                              checked={enabled}
                              disabled={role === 'owner' || !isOwner}
                              onChange={() => role !== 'owner' && togglePermission(role, key)}
                              className="h-4 w-4 rounded border-slate-300 accent-emerald-500 disabled:cursor-not-allowed"
                            />
                          </label>
                          {key === 'stock' && (
                            <label className={`ml-3 flex items-center justify-between rounded-lg border border-dashed px-2.5 py-2 ${permissions[role].view_costs ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100' : 'border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-800 dark:bg-slate-900'}`}>
                              <span>
                                <span className="block text-[10px] font-semibold">แสดงราคาต้นทุนและกำไร</span>
                                <span className="block text-[9px] opacity-70">ปิดแล้ว API จะไม่ส่งข้อมูลต้นทุน</span>
                              </span>
                              <input type="checkbox" checked={permissions[role].view_costs} disabled={role === 'owner' || !isOwner || !enabled} onChange={() => role !== 'owner' && togglePermission(role, 'view_costs')} className="h-3.5 w-3.5 rounded border-slate-300 accent-amber-500 disabled:cursor-not-allowed" />
                            </label>
                          )}
                          {key === 'reports' && (
                            <div className={`ml-3 grid gap-1.5 border-l-2 py-1 pl-3 ${enabled ? 'border-emerald-200 dark:border-emerald-500/20' : 'border-slate-200 dark:border-slate-800'}`}>
                              <p className="px-2 text-[10px] font-black uppercase tracking-wide text-slate-400">เมนูรายงานย่อย</p>
                              {REPORT_PERMISSION_LABELS.map(([reportKey, reportLabel]) => {
                                const reportEnabled = permissions[role][reportKey];
                                return (
                                  <React.Fragment key={reportKey}>
                                  <label className={`flex items-center justify-between rounded-lg px-2.5 py-2 ${reportEnabled ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100' : 'bg-slate-100 text-slate-500 dark:bg-slate-900'}`}>
                                    <span className="text-[11px] font-semibold">{reportLabel}</span>
                                    <input type="checkbox" checked={reportEnabled} disabled={role === 'owner' || !isOwner} onChange={() => role !== 'owner' && togglePermission(role, reportKey)} className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-500 disabled:cursor-not-allowed" />
                                  </label>
                                  {reportKey === 'report_inventory' && (
                                    <label className={`ml-3 flex items-center justify-between rounded-lg border border-dashed px-2.5 py-2 ${permissions[role].report_inventory_values ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100' : 'border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-800 dark:bg-slate-900'}`}>
                                      <span className="text-[10px] font-semibold">แสดงต้นทุนและราคาขาย</span>
                                      <input type="checkbox" checked={permissions[role].report_inventory_values} disabled={role === 'owner' || !isOwner || !reportEnabled} onChange={() => role !== 'owner' && togglePermission(role, 'report_inventory_values')} className="h-3.5 w-3.5 rounded border-slate-300 accent-amber-500 disabled:cursor-not-allowed" />
                                    </label>
                                  )}
                                  </React.Fragment>
                                );
                              })}
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: MEMBERS */}
        {activeTab === 'members' && (
          <div className="space-y-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-md dark:border-slate-800 dark:bg-slate-900 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                  <Users className="h-4 w-4 text-emerald-500" />
                  สมาชิกผู้ใช้งาน POS
                </h3>
                <p className="mt-1 text-[11px] text-slate-500">เพิ่มผู้ดูแล ผู้จัดการ หรือแคชเชียร์ได้สูงสุด 3 คน</p>
              </div>
              <span className={`rounded-full px-3 py-1.5 text-xs font-black ${members.length >= maxMembers ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'}`}>
                {members.length} / {maxMembers} คน
              </span>
            </div>

            <section className={`rounded-2xl border border-dashed p-4 ${members.length >= maxMembers || !isOwner ? 'border-slate-300 bg-slate-100 opacity-60 dark:border-slate-700 dark:bg-slate-950' : 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-500/30 dark:bg-emerald-500/5'}`}>
              <div className="flex items-center justify-between gap-3"><div><h4 className="flex items-center gap-2 text-sm font-black"><UserPlus className="h-4 w-4 text-emerald-500" />เพิ่มสมาชิก Staff</h4><p className="mt-1 text-[10px] text-slate-500">อีเมลไม่บังคับ สมาชิกสามารถใช้ Staff Number และ PIN เข้าสู่ระบบได้</p></div></div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1.2fr_.7fr_.8fr_auto] xl:items-end">
                <label className="grid gap-1.5 text-[10px] font-bold text-slate-500">ชื่อสมาชิก
                  <input value={memberDraft.name} disabled={members.length >= maxMembers || !isOwner} onChange={(event) => setMemberDraft({ ...memberDraft, name: event.target.value })} placeholder="ชื่อสมาชิก" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900" />
                </label>
                <label className="grid gap-1.5 text-[10px] font-bold text-slate-500">อีเมลเข้าสู่ระบบ
                  <input value={memberDraft.email} disabled={members.length >= maxMembers || !isOwner} onChange={(event) => setMemberDraft({ ...memberDraft, email: event.target.value })} type="email" placeholder="อีเมลเข้าสู่ระบบ" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900" />
                </label>
                <label className="grid gap-1.5 text-[10px] font-bold text-slate-500">PIN
                  <input value={memberDraft.pin} disabled={members.length >= maxMembers || !isOwner} onChange={(event) => setMemberDraft({ ...memberDraft, pin: event.target.value.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" placeholder="PIN 6 หลัก" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-mono outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900" />
                </label>
                <label className="grid gap-1.5 text-[10px] font-bold text-slate-500">บทบาท
                  <SystemSelect value={memberDraft.role} options={STAFF_ROLE_OPTIONS} onChange={(role) => setMemberDraft({ ...memberDraft, role })} disabled={members.length >= maxMembers || !isOwner} className="h-10" ariaLabel="บทบาทสมาชิกใหม่" />
                </label>
                <button type="button" disabled={members.length >= maxMembers || !isOwner} onClick={() => void addMember()} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-black text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-300">
                  <UserPlus className="h-4 w-4" /> เพิ่มสมาชิก
                </button>
              </div>
              {members.length >= maxMembers && <p className="mt-3 text-[11px] font-bold text-rose-600">ครบจำนวนสูงสุด 3 คนแล้ว สามารถปิดใช้งานสมาชิกเดิมได้ แต่จำนวนบัญชียังคงนับรวม</p>}
            </section>

            {members.filter((member) => member.role === 'owner').map((member) => (
              <section key={member.id} className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/40 dark:border-amber-500/20 dark:bg-amber-500/5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200/70 px-4 py-4 dark:border-amber-500/20 sm:px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-300 to-orange-500 text-base font-black text-slate-950 shadow-sm">
                      {member.name.trim().slice(0, 1).toUpperCase() || 'A'}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="truncate text-sm font-black text-slate-900 dark:text-white">Root Admin</h4>
                        <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[9px] font-black text-amber-900 dark:bg-amber-400/20 dark:text-amber-200">เจ้าของระบบ</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-500">บัญชีหลักของร้าน · Admin No. <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{member.staffNumber}</span></p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> เปิดใช้งาน
                  </span>
                </div>

                <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-[1fr_1.25fr_.75fr_auto] xl:items-end">
                  <label className="grid gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    ชื่อที่แสดง
                    <input value={memberEdits[member.id]?.name ?? member.name} disabled={!isOwner} onChange={(event) => setMemberEdits((current) => ({ ...current, [member.id]: { name: event.target.value, email: member.email } }))} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:disabled:bg-slate-950" />
                  </label>
                  <label className="grid gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    อีเมลเข้าสู่ระบบ
                    <span className="relative">
                      <input type="email" value={member.email} disabled className="h-10 w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-3 pr-9 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-950" aria-label="อีเมล Root Admin (แก้ไขไม่ได้)" />
                      <LockKeyhole className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    </span>
                  </label>
                  <label className="grid gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    บทบาท
                    <SystemSelect value="owner" options={OWNER_ROLE_OPTIONS} onChange={() => undefined} disabled className="h-10" ariaLabel="บทบาทเจ้าของระบบ" />
                  </label>
                  {isOwner ? <button type="button" disabled={Boolean(memberSaveState[member.id])} onClick={() => void saveMember(member, { name: memberEdits[member.id]?.name ?? member.name, email: member.email }, true)} className={`inline-flex h-10 min-w-32 items-center justify-center gap-2 rounded-xl px-4 text-xs font-black shadow-sm transition active:scale-[.98] disabled:cursor-wait ${memberSaveState[member.id] === 'success' ? 'bg-emerald-600 text-white' : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'}`}>
                    {memberSaveState[member.id] === 'saving' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : memberSaveState[member.id] === 'success' ? <CircleCheck className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                    {memberSaveState[member.id] === 'saving' ? 'กำลังบันทึก...' : memberSaveState[member.id] === 'success' ? 'บันทึกสำเร็จ' : 'บันทึกชื่อ'}
                  </button> : null}
                </div>
                <div className="border-t border-amber-200/70 px-4 py-3 text-[10px] text-slate-500 dark:border-amber-500/20 sm:px-5">
                  อีเมล Admin หลักถูกล็อกและเปลี่ยนจากระบบ POS ไม่ได้ · เข้าใช้ล่าสุด: {member.lastLoginAt || 'ยังไม่เคย'}
                </div>
              </section>
            ))}

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-black text-slate-900 dark:text-white">สมาชิก Staff</h4>
                  <p className="mt-0.5 text-[10px] text-slate-500">จัดการข้อมูล บทบาท PIN และสถานะการเข้าใช้งาน</p>
                </div>
                <span className="text-[10px] font-bold text-slate-500">{members.filter((member) => member.role !== 'owner').length} บัญชี</span>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {members.filter((member) => member.role !== 'owner').map((member) => (
                  <article key={member.id} className={`overflow-hidden rounded-2xl border ${member.active ? 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950' : 'border-rose-200 bg-rose-50/50 dark:border-rose-500/20 dark:bg-rose-500/5'}`}>
                    <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 dark:border-slate-800">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-sm font-black text-slate-950">{member.name.trim().slice(0, 1).toUpperCase() || 'U'}</span>
                        <div className="min-w-0">
                          <h5 className="truncate text-sm font-black">{member.name}</h5>
                          <p className="truncate font-mono text-[10px] font-bold text-slate-500">{member.staffNumber}</p>
                        </div>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[9px] font-black ${member.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'}`}>{member.active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span>
                    </div>
                    <div className="grid gap-3 p-4 sm:grid-cols-2">
                      <label className="grid gap-1.5 text-[10px] font-bold text-slate-500">ชื่อสมาชิก
                        <input value={memberEdits[member.id]?.name ?? member.name} disabled={!isOwner} onChange={(event) => setMemberEdits((current) => ({ ...current, [member.id]: { name: event.target.value, email: current[member.id]?.email ?? member.email } }))} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900" />
                      </label>
                      <label className="grid gap-1.5 text-[10px] font-bold text-slate-500">อีเมลเข้าสู่ระบบ
                        <input type="email" value={memberEdits[member.id]?.email ?? member.email} disabled={!isOwner} onChange={(event) => setMemberEdits((current) => ({ ...current, [member.id]: { name: current[member.id]?.name ?? member.name, email: event.target.value } }))} placeholder="ไม่บังคับ" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900" />
                      </label>
                      <label className="grid gap-1.5 text-[10px] font-bold text-slate-500 sm:col-span-2">บทบาท
                        <SystemSelect value={member.role} options={STAFF_ROLE_OPTIONS} onChange={(role) => void saveMember(member, { role })} disabled={!isOwner} className="h-10" ariaLabel="บทบาทสมาชิก" />
                      </label>
                    </div>
                    <div className="border-t border-slate-200 px-4 py-3 text-[10px] text-slate-500 dark:border-slate-800">เข้าใช้ล่าสุด: {member.lastLoginAt || 'ยังไม่เคย'} · เข้าผิดสะสม: <span className={member.failedLoginCount ? 'font-black text-rose-600' : 'font-bold'}>{member.failedLoginCount || 0}</span></div>
                    {isOwner ? <div className="grid grid-cols-2 gap-2 border-t border-slate-200 p-3 dark:border-slate-800 sm:grid-cols-4">
                      <button type="button" disabled={Boolean(memberSaveState[member.id])} onClick={() => void saveMember(member, memberEdits[member.id] || {}, true)} className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-3 text-[10px] font-black transition disabled:cursor-wait ${memberSaveState[member.id] === 'success' ? 'bg-emerald-600 text-white' : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'}`}>
                        {memberSaveState[member.id] === 'saving' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : memberSaveState[member.id] === 'success' ? <CircleCheck className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                        {memberSaveState[member.id] === 'saving' ? 'กำลังบันทึก' : memberSaveState[member.id] === 'success' ? 'สำเร็จ' : 'บันทึก'}
                      </button>
                      <button type="button" onClick={() => void resetMemberPIN(member)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 text-[10px] font-black text-amber-700 transition hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"><KeyRound className="h-3.5 w-3.5" />รีเซ็ต PIN</button>
                      <button type="button" onClick={() => void forceLogout(member)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 text-[10px] font-black text-sky-700 transition hover:bg-sky-100 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300"><LogOut className="h-3.5 w-3.5" />ออกระบบ</button>
                      <button type="button" onClick={() => void saveMember(member, { active: !member.active })} className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border px-3 text-[10px] font-black transition ${member.active ? 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 dark:border-rose-500/20 dark:bg-rose-500/10' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/20 dark:bg-emerald-500/10'}`}><Power className="h-3.5 w-3.5" />{member.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
                    </div> : null}
                  </article>
                ))}
                {!members.some((member) => member.role !== 'owner') ? <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500 dark:border-slate-700 xl:col-span-2">ยังไม่มีสมาชิก Staff</div> : null}
              </div>
            </section>

          </div>
        )}

        {activeTab === 'activity' && isOwner && (
          <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-md dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
              <h3 className="flex items-center gap-2 text-sm font-bold"><History className="h-4 w-4 text-emerald-500" />ประวัติการใช้งานและความปลอดภัย</h3>
              <p className="mt-1 text-[11px] text-slate-500">แสดงผู้ทำรายการ เวลา และการเปลี่ยนแปลงล่าสุดของบัญชีร้านนี้</p>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
              <table className="w-full min-w-[700px] text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 dark:bg-slate-950"><tr><th className="p-3">เวลา</th><th className="p-3">ผู้ทำรายการ</th><th className="p-3">เหตุการณ์</th><th className="p-3">เป้าหมาย</th></tr></thead>
                <tbody>{activity.map((item) => <tr key={item.id} className="border-t border-slate-100 dark:border-slate-800"><td className="p-3 whitespace-nowrap">{item.createdAt}</td><td className="p-3 font-bold">{item.actorName || item.actorType}</td><td className="p-3">{item.action.replaceAll('_', ' ')}</td><td className="p-3 font-mono text-[10px]">{item.targetType}{item.targetId ? ` · ${item.targetId}` : ''}</td></tr>)}</tbody>
              </table>
              {!activity.length ? <div className="p-8 text-center text-xs text-slate-500">ยังไม่มีประวัติ</div> : null}
            </div>
          </div>
        )}

        {/* Save Button Bar */}
        {activeTab !== 'members' && activeTab !== 'activity' ? <div className="flex justify-end gap-3 pt-2">
          <button
            type="submit"
            id="save-settings-btn"
            disabled={isSavingSettings}
            aria-busy={isSavingSettings}
            className="flex min-w-[210px] items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 transition-all scale-[1.01] active:scale-[0.99] disabled:cursor-wait disabled:opacity-70"
          >
            {isSavingSettings ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>{isSavingSettings ? (activeTab === 'stock' ? 'กำลังบันทึกสต็อก...' : 'กำลังบันทึก...') : 'บันทึกการตั้งค่า (Save Settings)'}</span>
          </button>
        </div> : null}
      </form>
      {printerDocumentMode && (
        <section id="printer-test-document" className={formData.printerType === 'thermal_58mm' ? 'printer-test-58mm' : 'printer-test-80mm'} aria-hidden="true">
          <h1>{formData.storeName || 'LiveMatch POS'}</h1>
          <p>{printerDocumentMode === 'discover' ? 'ค้นหา / เลือกเครื่องพิมพ์ Android' : 'ทดสอบเครื่องพิมพ์ POS'}</p>
          <p>Printer test · ทดสอบภาษาไทย</p>
          <p>{new Date().toLocaleString('th-TH')}</p>
          <div className="printer-test-rule">--------------------------------</div>
          {printerDocumentMode === 'test' ? <><p className="printer-test-row"><span>รายการทดสอบ</span><b>1 × ฿10.00</b></p><p className="printer-test-row"><span>ยอดรวม</span><b>฿10.00</b></p><div className="printer-test-rule">--------------------------------</div></> : null}
          <p>{formData.receiptFooterMessage || 'ขอบคุณที่ใช้บริการ / Thank you!'}</p>
          <p className="printer-test-small">Paper: {formData.printerType === 'thermal_58mm' ? '58 mm' : '80 mm'} · LiveMatch POS Web/PWA</p>
        </section>
      )}
    </div>
  );
};
