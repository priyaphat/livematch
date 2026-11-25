import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  CreditCard,
  History,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Shield,
  ShieldOff,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { apiFetch } from '../../services/api';
import { PermissionKey, RolePermissions, SubAccount } from '../../types/tournament';
import { StatusIndicator } from '../common/UIPrimitives';

type StaffAccount = SubAccount & { staffNumber: string };

interface AuditItem {
  id: string;
  timestamp: string;
  actor: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface GlobalSettingsResponse {
  accounts: StaffAccount[];
  maxAccounts: number;
  rolePermissions: RolePermissions;
  integration: {
    posEnabled: boolean;
    bookingEnabled: boolean;
    bookingPaymentConfigured: boolean;
    activeCoinPackages: number;
    freeParticipants: number;
    coinPerParticipant: number;
  };
  audits: AuditItem[];
  auditPagination: Pagination;
}

interface OneTimeCredential {
  staffNumber: string;
  pin: string;
  title: string;
}

const EMPTY_PAGINATION: Pagination = { page: 1, pageSize: 20, total: 0, totalPages: 0 };
const INPUT_CLASS = 'w-full min-h-[42px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] text-sm';
const PAGER_CLASS = 'min-h-[38px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] text-xs font-medium inline-flex items-center gap-1 disabled:opacity-40';

const PERMISSION_LABELS: { key: PermissionKey; label: string }[] = [
  { key: 'createTournament', label: 'สร้าง/คัดลอกรายการ' },
  { key: 'editSettings', label: 'แก้ไขตั้งค่ารายการ' },
  { key: 'drawBracket', label: 'จัดสาย/สุ่มสาย' },
  { key: 'lockBracket', label: 'ล็อกสายหลังประกาศ' },
  { key: 'approveRegistration', label: 'อนุมัติผู้สมัคร' },
  { key: 'checkIn', label: 'Check-in นักกีฬา' },
  { key: 'verifyPayment', label: 'ตรวจสลิป/การชำระเงิน' },
  { key: 'assignUmpire', label: 'มอบหมายกรรมการ' },
  { key: 'scoreMatch', label: 'บันทึกคะแนน' },
  { key: 'overrideLockedResult', label: 'แก้ผลที่ล็อกแล้ว' },
  { key: 'viewHealthData', label: 'ดูข้อมูลสุขภาพ' },
  { key: 'manageSubAccounts', label: 'จัดการผู้ใช้งานรอง' },
  { key: 'exportReport', label: 'ส่งออกรายงาน' },
];

const ROLE_LABELS: Record<StaffAccount['role'], string> = {
  tournament_admin: 'Tournament Admin',
  registration_staff: 'Registration Staff',
  score_staff: 'Score Staff',
};

export const GlobalSettingsView: React.FC<{ accountsOnly?: boolean }> = ({ accountsOnly = false }) => {
  const { hasPermission, notify, requestConfirm } = useApp();
  const [subTab, setSubTab] = useState<'accounts' | 'roles' | 'payment' | 'audit'>('accounts');
  const [data, setData] = useState<GlobalSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [credential, setCredential] = useState<OneTimeCredential | null>(null);
  const [editing, setEditing] = useState<StaffAccount | null>(null);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRole, setNewRole] = useState<StaffAccount['role']>('registration_staff');

  const canManage = hasPermission('manageSubAccounts');

  const loadSettings = useCallback(async (page = auditPage, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await apiFetch<GlobalSettingsResponse>(
        `/api/global-settings?auditPage=${page}&auditPageSize=20`,
      );
      setData(response);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'โหลดตั้งค่าส่วนกลางไม่สำเร็จ');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [auditPage, notify]);

  useEffect(() => {
    void loadSettings(auditPage);
  }, [auditPage, loadSettings]);

  const refresh = async () => loadSettings(auditPage, true);

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!data || !canManage || data.accounts.length >= data.maxAccounts) return;
    setSavingId('new');
    try {
      const created = await apiFetch<{ staffNumber: string; pin: string }>('/api/access/staff', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim(), email: newEmail.trim(), phone: newPhone.trim(), role: newRole }),
      });
      setCredential({ ...created, title: 'สร้างผู้ใช้งานรองสำเร็จ' });
      setNewName('');
      setNewEmail('');
      setNewPhone('');
      await refresh();
      notify('success', 'สร้างบัญชีเรียบร้อย โปรดบันทึก PIN ก่อนปิดหน้าต่าง');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'สร้างบัญชีไม่สำเร็จ');
    } finally {
      setSavingId(null);
    }
  };

  const updateStaff = async (id: string, patch: Record<string, unknown>, message: string) => {
    setSavingId(id);
    try {
      await apiFetch(`/api/access/staff/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      await refresh();
      notify('success', message);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSavingId(null);
    }
  };

  const resetPin = async (account: StaffAccount) => {
    setSavingId(account.id);
    try {
      const result = await apiFetch<{ pin: string }>(`/api/access/staff/${account.id}/reset-pin`, { method: 'POST' });
      setCredential({ staffNumber: account.staffNumber, pin: result.pin, title: `รีเซ็ต PIN ของ ${account.name}` });
      await refresh();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'รีเซ็ต PIN ไม่สำเร็จ');
    } finally {
      setSavingId(null);
    }
  };

  const revokeSessions = async (account: StaffAccount) => {
    setSavingId(account.id);
    try {
      const result = await apiFetch<{ revokedSessions: number }>(`/api/access/staff/${account.id}/revoke-sessions`, { method: 'POST' });
      await refresh();
      notify('success', `ออกจากระบบทุกอุปกรณ์แล้ว (${result.revokedSessions} session)`);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'เพิกถอน session ไม่สำเร็จ');
    } finally {
      setSavingId(null);
    }
  };

  const deactivate = (account: StaffAccount) => requestConfirm({
    title: `ปิดใช้งาน ${account.name}?`,
    description: 'บัญชีนี้จะเข้าสู่ระบบไม่ได้ และ session ที่เปิดอยู่จะถูกยกเลิกทันที',
    confirmLabel: 'ปิดใช้งานบัญชี',
    destructive: true,
    onConfirm: async () => updateStaff(account.id, { active: false }, 'ปิดใช้งานบัญชีแล้ว'),
  });

  const pagination = data?.auditPagination ?? EMPTY_PAGINATION;
  const navItems = [
    { id: 'accounts' as const, label: `ผู้ใช้งานรอง (${data?.accounts.length ?? 0}/${data?.maxAccounts ?? 5})`, icon: Users },
    { id: 'roles' as const, label: 'Role และ Permission', icon: Shield },
    { id: 'payment' as const, label: 'การเชื่อม LiveMatch/POS', icon: CreditCard },
    { id: 'audit' as const, label: 'Audit Log ส่วนกลาง', icon: History },
  ];

  if (loading && !data) {
    return <div className="min-h-[320px] grid place-items-center"><Loader2 className="w-7 h-7 animate-spin text-[#156143]" /></div>;
  }

  return (
    <div className={accountsOnly ? 'block' : 'grid grid-cols-1 lg:grid-cols-12 gap-6'}>
      {!accountsOnly && <aside className="lg:col-span-3 space-y-1">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setSubTab(id)} className={`w-full min-h-[44px] px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2.5 text-left transition-colors ${subTab === id ? 'bg-[#156143] text-white' : 'bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]'}`}>
            <Icon className="w-4 h-4" /><span>{label}</span>
          </button>
        ))}
      </aside>}

      <section className={`${accountsOnly ? 'w-full' : 'lg:col-span-9'} rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-5`}>
        {(accountsOnly || subTab === 'accounts') && data && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E2DFD5] dark:border-[#25354C] pb-4">
              <div><h2 className="text-lg font-bold">ผู้ใช้งานรอง Tournament</h2><p className="text-xs text-[#525C6B] dark:text-[#9AA8BC] mt-1">Owner สร้างได้สูงสุด 5 บัญชี แยกจาก POS Staff</p></div>
              <StatusIndicator tone={data.accounts.length >= data.maxAccounts ? 'warning' : 'success'} label={`${data.accounts.length} / ${data.maxAccounts} บัญชี`} />
            </div>

            {canManage && data.accounts.length < data.maxAccounts && (
              <form onSubmit={handleAdd} className="p-4 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 items-end">
                <Field label="ชื่อ-นามสกุล *"><input required value={newName} onChange={(e) => setNewName(e.target.value)} className={INPUT_CLASS} /></Field>
                <Field label="อีเมล"><input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className={INPUT_CLASS} /></Field>
                <Field label="เบอร์โทร"><input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className={INPUT_CLASS} /></Field>
                <Field label="บทบาท"><select value={newRole} onChange={(e) => setNewRole(e.target.value as StaffAccount['role'])} className={INPUT_CLASS}><option value="tournament_admin">Tournament Admin</option><option value="registration_staff">Registration Staff</option><option value="score_staff">Score Staff</option></select></Field>
                <button disabled={savingId === 'new'} className="min-h-[42px] px-4 rounded-lg bg-[#156143] hover:bg-[#104D35] disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2">{savingId === 'new' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}เพิ่มบัญชี</button>
              </form>
            )}

            <div className="space-y-3">
              {data.accounts.length === 0 && <EmptyState text="ยังไม่มีผู้ใช้งานรอง" />}
              {data.accounts.map((account) => (
                <article key={account.id} className="p-4 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] space-y-3">
                  <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{account.name}</span><StatusIndicator tone={account.active ? 'success' : 'neutral'} label={account.active ? 'ใช้งานอยู่' : 'ปิดใช้งาน'} compact /></div>
                      <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC] mt-1">{account.staffNumber} · {ROLE_LABELS[account.role]}{account.email ? ` · ${account.email}` : ''}{account.lastLogin ? ` · ล่าสุด ${account.lastLogin}` : ' · ยังไม่เคยเข้าสู่ระบบ'}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <ActionButton onClick={() => setEditing(editing?.id === account.id ? null : account)} icon={Shield} label="แก้ไข / กำหนดสิทธิ์" />
                      <ActionButton onClick={() => void resetPin(account)} icon={KeyRound} label="รีเซ็ต PIN" disabled={savingId === account.id} />
                      <ActionButton onClick={() => void revokeSessions(account)} icon={ShieldOff} label="ออกทุกอุปกรณ์" disabled={savingId === account.id} />
                      {account.active ? <ActionButton onClick={() => deactivate(account)} icon={X} label="ลบ / ปิดใช้งาน" danger /> : <ActionButton onClick={() => void updateStaff(account.id, { active: true }, 'เปิดใช้งานบัญชีแล้ว')} icon={Check} label="เปิดใช้งาน" />}
                    </div>
                  </div>
                  {editing?.id === account.id && (
                    <PermissionEditor account={editing} saving={savingId === account.id} onChange={setEditing} onSave={async () => { await updateStaff(account.id, { name: editing.name, email: editing.email, phone: editing.phone, role: editing.role, permissions: editing.permissions }, 'บันทึกข้อมูลและสิทธิ์แล้ว'); setEditing(null); }} />
                  )}
                </article>
              ))}
            </div>
          </div>
        )}

        {!accountsOnly && subTab === 'roles' && data && (
          <div className="space-y-4">
            <div><h2 className="text-lg font-bold">สิทธิ์เริ่มต้นตามบทบาท</h2><p className="text-xs text-[#525C6B] dark:text-[#9AA8BC] mt-1">สิทธิ์จริงถูกตรวจซ้ำที่ backend ทุกครั้ง และ Owner ปรับรายบัญชีได้</p></div>
            <div className="overflow-x-auto border border-[#E2DFD5] dark:border-[#25354C] rounded-xl">
              <table className="w-full text-xs text-left"><thead className="bg-[#F7F6F2] dark:bg-[#0B121C]"><tr><th className="p-3">สิทธิ์</th>{(['owner', 'tournament_admin', 'registration_staff', 'score_staff', 'director'] as const).map((role) => <th key={role} className="p-3 text-center whitespace-nowrap">{role}</th>)}</tr></thead>
                <tbody className="divide-y divide-[#E2DFD5] dark:divide-[#25354C]">{PERMISSION_LABELS.map((permission) => <tr key={permission.key}><td className="p-3 font-medium">{permission.label}</td>{(['owner', 'tournament_admin', 'registration_staff', 'score_staff', 'director'] as const).map((role) => <td key={role} className="p-3 text-center">{data.rolePermissions[role]?.[permission.key] ? <Check className="w-4 h-4 mx-auto text-[#156143]" /> : '—'}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </div>
        )}

        {!accountsOnly && subTab === 'payment' && data && (
          <div className="space-y-5">
            <div><h2 className="text-lg font-bold">การเชื่อม LiveMatch และ POS</h2><p className="text-xs text-[#525C6B] dark:text-[#9AA8BC] mt-1">สถานะทั้งหมดอ่านจาก backend ของบัญชี Owner ปัจจุบัน</p></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <IntegrationCard title="LiveMatch POS" active={data.integration.posEnabled} detail={data.integration.posEnabled ? 'เปิดใช้งานสำหรับบัญชีนี้' : 'ยังไม่ได้เปิดใช้งาน'} />
              <IntegrationCard title="ระบบจองสนาม" active={data.integration.bookingEnabled} detail={data.integration.bookingEnabled ? 'พร้อมใช้ข้อมูลตั้งค่าร่วมกัน' : 'ยังไม่ได้เปิดใช้งาน'} />
              <IntegrationCard title="ข้อมูลรับชำระจากระบบจอง" active={data.integration.bookingPaymentConfigured} detail={data.integration.bookingPaymentConfigured ? 'พบ PromptPay / QR / บัญชีธนาคาร' : 'ยังไม่มีข้อมูลรับชำระให้สืบทอด'} />
              <IntegrationCard title="แพ็กเกจ Coin" active={data.integration.activeCoinPackages > 0} detail={`${data.integration.activeCoinPackages} แพ็กเกจที่เปิดขาย`} />
            </div>
            <div className="rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] p-4 text-sm"><span className="font-semibold">อัตราคิด Coin ปัจจุบัน:</span> ฟรี {data.integration.freeParticipants} คนแรก · คนที่เกินคิด {data.integration.coinPerParticipant} Coin/คน</div>
          </div>
        )}

        {!accountsOnly && subTab === 'audit' && data && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Audit Log ส่วนกลาง</h2><p className="text-xs text-[#525C6B] dark:text-[#9AA8BC] mt-1">ทั้งหมด {pagination.total} รายการ · เรียงจากล่าสุด</p></div><button onClick={() => void refresh()} className="p-2 rounded-lg border border-[#E2DFD5] dark:border-[#25354C]" title="รีเฟรช"><RefreshCw className="w-4 h-4" /></button></div>
            <div className="divide-y divide-[#E2DFD5] dark:divide-[#25354C] border border-[#E2DFD5] dark:border-[#25354C] rounded-xl overflow-hidden">
              {data.audits.length === 0 && <EmptyState text="ยังไม่มี Audit Log" />}
              {data.audits.map((item) => <div key={item.id} className="p-3.5 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><span className="font-mono font-semibold text-[#156143] dark:text-[#229A6B]">{item.action}</span><span className="mx-1.5">·</span><span className="font-medium">{item.targetType} {item.targetId}</span>{item.reason && <p className="text-[#525C6B] dark:text-[#9AA8BC] mt-1">เหตุผล: {item.reason}</p>}</div><div className="text-[#525C6B] dark:text-[#9AA8BC] shrink-0">{item.actor} ({item.actorRole}) · {item.timestamp}</div></div>)}
            </div>
            <div className="flex items-center justify-between gap-3"><span className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">หน้า {pagination.totalPages === 0 ? 0 : pagination.page} / {pagination.totalPages}</span><div className="flex gap-2"><button disabled={pagination.page <= 1} onClick={() => setAuditPage((page) => page - 1)} className={PAGER_CLASS}><ChevronLeft className="w-4 h-4" />ก่อนหน้า</button><button disabled={pagination.page >= pagination.totalPages} onClick={() => setAuditPage((page) => page + 1)} className={PAGER_CLASS}>ถัดไป<ChevronRight className="w-4 h-4" /></button></div></div>
          </div>
        )}
      </section>

      {credential && <CredentialModal credential={credential} onClose={() => setCredential(null)} notify={notify} />}
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => <label className="block"><span className="block text-xs font-medium mb-1">{label}</span>{children}</label>;

const ActionButton: React.FC<{ icon: React.ElementType; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }> = ({ icon: Icon, label, onClick, disabled, danger }) => <button type="button" onClick={onClick} disabled={disabled} className={`min-h-[36px] px-2.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-40 ${danger ? 'border-[#FECACA] dark:border-[#5E2025] text-[#B91C1C] dark:text-[#F87171]' : 'border-[#E2DFD5] dark:border-[#25354C]'}`}><Icon className="w-3.5 h-3.5" />{label}</button>;

const EmptyState: React.FC<{ text: string }> = ({ text }) => <div className="p-8 text-center text-sm text-[#525C6B] dark:text-[#9AA8BC]">{text}</div>;

const IntegrationCard: React.FC<{ title: string; active: boolean; detail: string }> = ({ title, active, detail }) => <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] p-4 space-y-2"><div className="flex items-center justify-between gap-2"><h3 className="font-semibold text-sm">{title}</h3><StatusIndicator tone={active ? 'success' : 'neutral'} label={active ? 'พร้อมใช้งาน' : 'ยังไม่พร้อม'} compact /></div><p className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">{detail}</p></div>;

const PermissionEditor: React.FC<{ account: StaffAccount; saving: boolean; onChange: (account: StaffAccount) => void; onSave: () => Promise<void> }> = ({ account, saving, onChange, onSave }) => <div className="rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] p-4 space-y-4"><div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3"><Field label="ชื่อ-นามสกุล"><input value={account.name} onChange={(event) => onChange({ ...account, name: event.target.value })} className={INPUT_CLASS} /></Field><Field label="อีเมล"><input type="email" value={account.email} onChange={(event) => onChange({ ...account, email: event.target.value })} className={INPUT_CLASS} /></Field><Field label="เบอร์โทร"><input value={account.phone} onChange={(event) => onChange({ ...account, phone: event.target.value })} className={INPUT_CLASS} /></Field><Field label="บทบาท"><select value={account.role} onChange={(event) => onChange({ ...account, role: event.target.value as StaffAccount['role'] })} className={INPUT_CLASS}><option value="tournament_admin">Tournament Admin</option><option value="registration_staff">Registration Staff</option><option value="score_staff">Score Staff</option></select></Field></div><div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{PERMISSION_LABELS.filter(({ key }) => key !== 'manageSubAccounts').map(({ key, label }) => <label key={key} className="flex items-center gap-2 text-xs p-2 rounded-lg bg-white dark:bg-[#131E2E]"><input type="checkbox" checked={account.permissions[key]} onChange={(event) => onChange({ ...account, permissions: { ...account.permissions, [key]: event.target.checked } })} className="accent-[#156143]" />{label}</label>)}</div><div className="flex items-center justify-between gap-3"><p className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">สิทธิ์จัดการผู้ใช้งานรองสงวนไว้สำหรับ Owner เท่านั้น</p><button onClick={() => void onSave()} disabled={saving || !account.name.trim()} className="min-h-[42px] px-4 rounded-lg bg-[#156143] text-white text-sm font-semibold disabled:opacity-50">บันทึกข้อมูลและสิทธิ์</button></div></div>;

const CredentialModal: React.FC<{ credential: OneTimeCredential; onClose: () => void; notify: (type: 'success' | 'error' | 'warning' | 'info', text: string) => void }> = ({ credential, onClose, notify }) => {
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); notify('success', 'คัดลอกแล้ว'); };
  return <div className="fixed inset-0 z-[90] bg-[#07110D]/70 backdrop-blur-sm p-4 grid place-items-center"><div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] shadow-2xl p-6 space-y-5"><div><h3 className="text-lg font-bold">{credential.title}</h3><p className="text-xs text-[#B45309] dark:text-[#FBBF24] mt-1">PIN จะแสดงเฉพาะครั้งนี้ กรุณาบันทึกก่อนปิดหน้าต่าง</p></div><CredentialBox label="Staff Number" value={credential.staffNumber} onCopy={copy} /><CredentialBox label="PIN 6 หลัก" value={credential.pin} onCopy={copy} /><button onClick={onClose} className="w-full min-h-[44px] rounded-lg bg-[#156143] text-white font-semibold">ฉันบันทึกข้อมูลแล้ว</button></div></div>;
};

const CredentialBox: React.FC<{ label: string; value: string; onCopy: (value: string) => Promise<void> }> = ({ label, value, onCopy }) => <div><div className="text-xs font-medium mb-1">{label}</div><div className="flex items-center gap-2 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] p-3"><code className="text-lg font-bold tracking-wider flex-1">{value}</code><button onClick={() => void onCopy(value)} className="p-2 rounded-lg hover:bg-white dark:hover:bg-[#1B293D]" title="คัดลอก"><Copy className="w-4 h-4" /></button></div></div>;
