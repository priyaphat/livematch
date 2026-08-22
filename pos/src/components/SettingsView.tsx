import React, { useEffect, useState } from 'react';
import { usePos } from '../context/PosContext';
import { StoreSettings } from '../types';
import { AdminUser } from '../api/auth';
import {
  createPOSStaff,
  getPOSAccessSettings,
  POSPermissions,
  POSRole,
  POSStaffMember,
  resetPOSStaffPIN,
  savePOSRolePermissions,
  updatePOSStaff,
} from '../api/posAccess';
import {
  Settings,
  Store,
  Printer,
  DollarSign,
  Save,
  ShieldCheck,
  Users,
  UserPlus,
  KeyRound,
  Power,
} from 'lucide-react';

type SettingsTab = 'store' | 'printer' | 'tax' | 'permissions' | 'members';
type MemberRole = POSRole;

const MAX_MEMBERS = 3;
const PERMISSION_LABELS = [
  ['sales', 'ขายสินค้า'],
  ['bills', 'บิลและประวัติ'],
  ['products', 'จัดการสินค้า'],
  ['stock', 'จัดการสต็อก'],
  ['reports', 'ดูรายงาน'],
  ['settings', 'ตั้งค่าระบบ'],
] as const;

const DEFAULT_PERMISSIONS: Record<MemberRole, POSPermissions> = {
  owner: { sales: true, bills: true, products: true, stock: true, reports: true, settings: true },
  manager: { sales: true, bills: true, products: true, stock: true, reports: true, settings: false },
  cashier: { sales: true, bills: true, products: false, stock: false, reports: false, settings: false },
};

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
  const [maxMembers, setMaxMembers] = useState(MAX_MEMBERS);
  const [permissions, setPermissions] = useState<Record<MemberRole, POSPermissions>>(DEFAULT_PERMISSIONS);
  const [memberDraft, setMemberDraft] = useState({ name: '', email: '', pin: '', role: 'cashier' as Exclude<MemberRole, 'owner'> });
  const isOwner = currentUser.role === 'owner';

  const applyAccessSettings = (payload: Awaited<ReturnType<typeof getPOSAccessSettings>>) => {
    setMembers(payload.items);
    setMaxMembers(payload.maxMembers);
    setPermissions(payload.permissions);
  };

  useEffect(() => {
    void getPOSAccessSettings()
      .then(applyAccessSettings)
      .catch((error) => showToast(error instanceof Error ? error.message : 'โหลดสมาชิก POS ไม่สำเร็จ', 'error'));
  }, []);

  useEffect(() => setFormData({ ...settings }), [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(await updateSettings(formData))) return;
    if (isOwner) {
      try {
        applyAccessSettings(await savePOSRolePermissions({ manager: permissions.manager, cashier: permissions.cashier }));
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'บันทึกสิทธิ์ไม่สำเร็จ', 'error');
        return;
      }
    }
    playBeep('success');
    showToast('บันทึกการตั้งค่าเรียบร้อยแล้ว', 'success');
  };

  const addMember = async () => {
    if (members.length >= maxMembers) {
      showToast('เพิ่มสมาชิกได้สูงสุด 3 คน', 'warning');
      return;
    }
    if (!memberDraft.name.trim() || !/^\d{4,6}$/.test(memberDraft.pin)) {
      showToast('กรุณากรอกชื่อและ PIN ตัวเลข 4-6 หลัก', 'warning');
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

  const saveMember = async (member: POSStaffMember, changes: Partial<POSStaffMember>) => {
    const next = { ...member, ...changes };
    if (next.role === 'owner') return;
    try {
      applyAccessSettings(await updatePOSStaff(next.id, { name: next.name, email: next.email, role: next.role, active: next.active }));
      showToast('อัปเดตสมาชิกแล้ว', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'อัปเดตสมาชิกไม่สำเร็จ', 'error');
    }
  };

  const resetMemberPIN = async (member: POSStaffMember) => {
    const entered = window.prompt('กรอก PIN ใหม่ 4-6 หลัก หรือเว้นว่างเพื่อให้ระบบสร้างให้');
    if (entered === null) return;
    try {
      const result = await resetPOSStaffPIN(member.id, entered.trim());
      window.alert(`PIN ใหม่ของ ${member.name}: ${result.pin}\nโปรดส่งให้เจ้าตัวและเก็บไว้ในที่ปลอดภัย`);
      showToast('รีเซ็ต PIN และออกจากระบบทุกอุปกรณ์แล้ว', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'รีเซ็ต PIN ไม่สำเร็จ', 'error');
    }
  };

  const togglePermission = (role: Exclude<MemberRole, 'owner'>, permission: string) => {
    setPermissions((current) => ({
      ...current,
      [role]: { ...current[role], [permission]: !current[role][permission] },
    }));
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
          <span>เพิ่มสมาชิก ({members.length}/{MAX_MEMBERS})</span>
        </button>
      </div>

      {/* TAB CONTENTS */}
      <form onSubmit={handleSave} className="space-y-6">
        {/* TAB 1: STORE INFO */}
        {activeTab === 'store' && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-md space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-3 flex items-center gap-2">
              <Store className="w-4 h-4 text-emerald-500" />
              <span>ข้อมูลประจำร้านค้า & สาขา</span>
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
                  ชื่อสาขา (Branch Name)
                </label>
                <input
                  type="text"
                  value={formData.branchName}
                  onChange={(e) => setFormData({ ...formData, branchName: e.target.value })}
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
                  ชื่อพนักงานแคชเชียร์ปัจจุบัน
                </label>
                <input
                  type="text"
                  value={formData.cashierName}
                  onChange={(e) => setFormData({ ...formData, cashierName: e.target.value })}
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
            </div>
          </div>
        )}

        {/* TAB 2: PRINTER SETTINGS */}
        {activeTab === 'printer' && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-md space-y-5">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-3 flex items-center gap-2">
              <Printer className="w-4 h-4 text-emerald-500" />
              <span>เครื่องพิมพ์ความร้อน & ใบเสร็จ</span>
            </h3>

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

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  จำนวนตำแหน่งทศนิยมราคา (Decimal Places)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[0, 2, 3].map((dec) => (
                    <button
                      key={dec}
                      type="button"
                      onClick={() => setFormData({ ...formData, decimalPlaces: dec })}
                      className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
                        formData.decimalPlaces === dec
                          ? 'bg-emerald-50 dark:bg-emerald-500/20 border-emerald-500 text-emerald-700 dark:text-emerald-400 shadow-xs'
                          : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <div>{dec} ตำแหน่ง</div>
                      <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                        {dec === 0 ? '฿120' : dec === 2 ? '฿120.00' : '฿120.000'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  สัญลักษณ์สกุลเงิน (Currency Symbol)
                </label>
                <input
                  type="text"
                  value={formData.currencySymbol}
                  onChange={(e) =>
                    setFormData({ ...formData, currencySymbol: e.target.value })
                  }
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:border-emerald-500"
                />
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
              <span className="rounded-full bg-amber-50 px-3 py-1 text-[10px] font-bold text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">UI Preview</span>
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
                        <label key={key} className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${enabled ? 'border-emerald-200 bg-white dark:border-emerald-500/20 dark:bg-slate-900' : 'border-slate-200 bg-slate-100 opacity-65 dark:border-slate-800 dark:bg-slate-900/50'}`}>
                          <span className="text-xs font-semibold">{label}</span>
                          <input
                            type="checkbox"
                            checked={enabled}
                            disabled={role === 'owner' || !isOwner}
                            onChange={() => role !== 'owner' && togglePermission(role, key)}
                            className="h-4 w-4 rounded border-slate-300 accent-emerald-500 disabled:cursor-not-allowed"
                          />
                        </label>
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
          <div className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-md dark:border-slate-800 dark:bg-slate-900">
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

            <div className="grid gap-3">
              {members.map((member) => (
                <article key={member.id} className={`grid gap-3 rounded-2xl border p-4 dark:bg-slate-950 sm:grid-cols-[auto_1fr_auto] sm:items-center ${member.active ? 'border-slate-200 bg-slate-50 dark:border-slate-800' : 'border-rose-200 bg-rose-50/40 opacity-70 dark:border-rose-500/20'}`}>
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-sm font-black text-slate-950">
                    {member.name.trim().slice(0, 1).toUpperCase() || 'U'}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-sm font-bold">{member.name}</h4>
                      {member.role === 'owner' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black text-amber-700">OWNER</span>}
                    </div>
                    <p className="truncate text-[11px] text-slate-500">{member.email || 'ไม่ระบุอีเมล'} · <span className="font-mono font-bold">{member.staffNumber}</span></p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={member.role}
                      disabled={member.role === 'owner' || !isOwner}
                      onChange={(event) => void saveMember(member, { role: event.target.value as MemberRole })}
                      className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-900 disabled:opacity-60"
                    >
                      <option value="owner">เจ้าของระบบ</option>
                      <option value="manager">ผู้จัดการ</option>
                      <option value="cashier">แคชเชียร์</option>
                    </select>
                    {member.role !== 'owner' && isOwner && <>
                      <button type="button" onClick={() => void resetMemberPIN(member)} className="grid h-9 w-9 place-items-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10" title="รีเซ็ต PIN">
                        <KeyRound className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => void saveMember(member, { active: !member.active })} className="grid h-9 w-9 place-items-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 dark:border-rose-500/20 dark:bg-rose-500/10" title={member.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}>
                        <Power className="h-4 w-4" />
                      </button>
                    </>}
                  </div>
                </article>
              ))}
            </div>

            <section className={`rounded-2xl border border-dashed p-4 ${members.length >= maxMembers || !isOwner ? 'border-slate-300 bg-slate-100 opacity-60 dark:border-slate-700 dark:bg-slate-950' : 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-500/30 dark:bg-emerald-500/5'}`}>
              <h4 className="flex items-center gap-2 text-sm font-bold"><UserPlus className="h-4 w-4 text-emerald-500" />เพิ่มสมาชิกใหม่</h4>
              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1.2fr_.7fr_.8fr_auto]">
                <input
                  value={memberDraft.name}
                  disabled={members.length >= maxMembers || !isOwner}
                  onChange={(event) => setMemberDraft({ ...memberDraft, name: event.target.value })}
                  placeholder="ชื่อสมาชิก"
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900"
                />
                <input
                  value={memberDraft.email}
                  disabled={members.length >= maxMembers || !isOwner}
                  onChange={(event) => setMemberDraft({ ...memberDraft, email: event.target.value })}
                  type="email"
                  placeholder="อีเมลเข้าสู่ระบบ"
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900"
                />
                <input
                  value={memberDraft.pin}
                  disabled={members.length >= maxMembers || !isOwner}
                  onChange={(event) => setMemberDraft({ ...memberDraft, pin: event.target.value.replace(/\D/g, '').slice(0, 6) })}
                  inputMode="numeric"
                  placeholder="PIN 4-6 หลัก"
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-mono outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900"
                />
                <select
                  value={memberDraft.role}
                  disabled={members.length >= maxMembers || !isOwner}
                  onChange={(event) => setMemberDraft({ ...memberDraft, role: event.target.value as Exclude<MemberRole, 'owner'> })}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-900"
                >
                  <option value="manager">ผู้จัดการ</option>
                  <option value="cashier">แคชเชียร์</option>
                </select>
                <button type="button" disabled={members.length >= maxMembers || !isOwner} onClick={() => void addMember()} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-black text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-300">
                  <UserPlus className="h-4 w-4" />
                  เพิ่มสมาชิก
                </button>
              </div>
              {members.length >= maxMembers && <p className="mt-3 text-[11px] font-bold text-rose-600">ครบจำนวนสูงสุด 3 คนแล้ว สามารถปิดใช้งานสมาชิกเดิมได้ แต่จำนวนบัญชียังคงนับรวม</p>}
            </section>
          </div>
        )}

        {/* Save Button Bar */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="submit"
            id="save-settings-btn"
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 transition-all scale-[1.01] active:scale-[0.99]"
          >
            <Save className="w-4 h-4" />
            <span>บันทึกการตั้งค่า (Save Settings)</span>
          </button>
        </div>
      </form>
    </div>
  );
};
