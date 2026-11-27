import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Calendar,
  Coins,
  CreditCard,
  Globe,
  Image as ImageIcon,
  Layers,
  Plus,
  RotateCcw,
  Save,
  Shield,
  Sliders,
  Trash2,
  Trophy,
  Upload,
  UserCheck,
  Users,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { apiFetch } from '../../services/api';
import {
  CourtConfig,
  DivisionConfig,
  MatchFormatType,
  TieBreakCriterion,
  Tournament,
  TournamentStatus,
} from '../../types/tournament';
import {
  calculateExpandParticipantsCost,
  getDivisionFormat,
  getDivisionParticipantsCount,
  getRegistrationWindowStatus,
  getTournamentAllocatedParticipants,
  normalizeDateTimeLocal,
} from '../../utils/registration';
import { StatusIndicator } from '../common/UIPrimitives';
import { GlobalSettingsView } from '../level1/GlobalSettingsView';

const TIE_BREAK_LABELS: Record<TieBreakCriterion, string> = {
  matches_won: 'จำนวนแมตช์ที่ชนะ',
  head_to_head: 'ผลการพบกันโดยตรง (Head-to-Head)',
  set_diff: 'ผลต่างเซต (ได้-เสีย)',
  point_diff: 'ผลต่างคะแนน (ได้-เสีย)',
  points_for: 'คะแนนได้รวม',
  coin_toss: 'จับสลาก',
};

export const TournamentSettingView: React.FC<{ tournament: Tournament }> = ({ tournament }) => {
  const { state, refreshState, hasPermission, notify, requestConfirm } = useApp();
  const [section, setSection] = useState<number>(() => {
    if (typeof window === 'undefined') return 1;
    const value = Number(new URLSearchParams(window.location.search).get('settingSection'));
    return value >= 1 && value <= 10 ? value : 1;
  });
  const [draft, setDraft] = useState<Tournament>(() => structuredClone(tournament));
  const [saving, setSaving] = useState(false);

  const changeSection = (nextSection: number) => {
    setSection(nextSection);
    const params = new URLSearchParams(window.location.search);
    params.set('view', 'setting');
    params.set('settingSection', String(nextSection));
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
  };

  useEffect(() => {
    setDraft(structuredClone(tournament));
  }, [tournament]);

  // Resize uploaded logo/banner cleanly on client canvas so state & JSON stay lightweight
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      notify('error', 'กรุณาเลือกไฟล์รูปภาพ (PNG, JPG, WebP, SVG)');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = async () => {
        const maxSide = 384;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/png');
        const next = { ...draft, emblemUrl: dataUrl };
        setDraft(next);
        await saveDraft(next, 'อัปโหลดโลโก้รายการแข่งขันเรียบร้อย');
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Add Division inline state (strictly separated Singles vs Doubles, finite quota only)
  const [newDivName, setNewDivName] = useState('');
  const [newDivCode, setNewDivCode] = useState('');
  const [newDivFormat, setNewDivFormat] = useState<MatchFormatType>('doubles');
  const [newDivQuota, setNewDivQuota] = useState<number | ''>(4);
  const [newDivFee, setNewDivFee] = useState<number | ''>(800);

  // Capacity expansion inline state
  const [expandParticipantsBy, setExpandParticipantsBy] = useState<number | ''>(10);
  const [expandingCapacity, setExpandingCapacity] = useState(false);

  // Add Court inline state
  const [newCourtName, setNewCourtName] = useState('');
  const [newCourtOpen, setNewCourtOpen] = useState(draft.startTime || '08:30');
  const [newCourtClose, setNewCourtClose] = useState(draft.endTime || '20:30');
  const [newCourtRest, setNewCourtRest] = useState<number | ''>(20);

  const canEdit = hasPermission('editSettings');

  const maxParticipantsCap = draft.maxParticipants ?? 20;
  const pricingFreeParticipants = Math.max(
    0,
    draft.pricingFreeParticipants ?? state.pricing?.freeParticipants ?? 20
  );
  const pricingCoinPerParticipant = Math.max(
    0,
    draft.pricingCoinPerParticipant ?? state.pricing?.coinPerParticipant ?? 10
  );
  const allocatedPeople = getTournamentAllocatedParticipants(draft.divisions);
  const remainingPeopleSlots = maxParticipantsCap - allocatedPeople;
  const isOverParticipantsCap = allocatedPeople > maxParticipantsCap;

  const safeExpandAdd = Math.max(0, Math.floor(Number(expandParticipantsBy) || 0));
  const expandCostCoins = calculateExpandParticipantsCost(
    maxParticipantsCap,
    safeExpandAdd,
    pricingFreeParticipants,
    pricingCoinPerParticipant
  );
  const availableCoinBalance = state.coinBalance ?? 0;
  const canAffordExpand = safeExpandAdd >= 1 && availableCoinBalance >= expandCostCoins;

  const saveDraft = async (next: Tournament = draft, msg = 'บันทึกการตั้งค่ารายการเรียบร้อย') => {
    if (!canEdit) return;
    const nextMax = next.maxParticipants ?? 20;
    const nextAllocated = getTournamentAllocatedParticipants(next.divisions);
    if (nextAllocated > nextMax) {
      notify(
        'error',
        `โควตารวม (${nextAllocated} คน) เกินจำนวนที่กำหนดไว้ (${nextMax} คน) กรุณาลดโควตาหรือซื้อจำนวนคนเพิ่มด้วย Coin`
      );
      return;
    }
    const registrationOpen = normalizeDateTimeLocal(next.registrationConfig.openAt);
    const registrationClose = normalizeDateTimeLocal(next.registrationConfig.closeAt);
    if (registrationOpen && registrationClose && new Date(registrationClose) <= new Date(registrationOpen)) {
      notify('error', 'วันเวลาปิดรับสมัครต้องอยู่หลังวันเวลาเปิดรับสมัคร');
      return;
    }
    if (next.registrationConfig.isOpen && !next.registrationConfig.pdpaConsentText.trim()) {
      notify('error', 'กรุณาระบุข้อความขอความยินยอม PDPA ก่อนเปิดรับสมัครออนไลน์');
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/tournaments/${tournament.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...next, _auditReason: `แก้ไขตั้งค่าหมวดที่ ${section}` }),
      });
      await refreshState();
      notify('success', msg);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const handleExpandCapacity = async () => {
    if (!canEdit || safeExpandAdd < 1) return;
    if (!canAffordExpand) {
      notify(
        'error',
        `ยอด Coin ไม่เพียงพอ (ต้องใช้ ${expandCostCoins.toLocaleString()} Coin · คงเหลือ ${availableCoinBalance.toLocaleString()} Coin)`
      );
      return;
    }
    setExpandingCapacity(true);
    try {
      const res = await apiFetch<{
        maxParticipants: number;
        coinBalance: number;
        chargedCoin: number;
        version: number;
      }>(`/api/tournaments/${tournament.id}/expand-capacity`, {
        method: 'POST',
        body: JSON.stringify({ additionalParticipants: safeExpandAdd }),
      });
      setDraft((prev) => ({
        ...prev,
        maxParticipants: res.maxParticipants,
      }));
      await refreshState();
      notify(
        'success',
        expandCostCoins > 0
          ? `ขยายจำนวนรับสมัคร +${safeExpandAdd} คน (รวม ${res.maxParticipants.toLocaleString()} คน) · ชำระ ${expandCostCoins.toLocaleString()} Coin`
          : `ขยายจำนวนรับสมัคร +${safeExpandAdd} คน (รวม ${res.maxParticipants.toLocaleString()} คน) สำเร็จ`
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'ขยายจำนวนคนไม่สำเร็จ');
    } finally {
      setExpandingCapacity(false);
    }
  };

  const handleAddDivision = () => {
    if (!newDivName.trim()) {
      notify('error', 'กรุณาระบุชื่อระดับมือ');
      return;
    }
    const isDoubles = newDivFormat === 'doubles';
    const safeQuota = Math.max(1, Math.floor(Number(newDivQuota) || 1));
    const addedPeople = isDoubles ? safeQuota * 2 : safeQuota;
    if (allocatedPeople + addedPeople > maxParticipantsCap) {
      notify(
        'error',
        `โควตาที่เพิ่ม (${addedPeople} คน) ทำให้ยอดรวม (${allocatedPeople + addedPeople} คน) เกินจำนวนที่กำหนดไว้ (${maxParticipantsCap} คน) กรุณาซื้อจำนวนคนเพิ่มด้วย Coin ก่อน`
      );
      return;
    }

    const newDiv: DivisionConfig = {
      id: `div-${Date.now()}`,
      code: newDivCode.trim() || `LV-${draft.divisions.length + 1}`,
      nameTh: newDivName.trim(),
      nameEn: newDivName.trim(),
      color: isDoubles ? '#156143' : '#1D4ED8',
      enabled: true,
      gender: 'open',
      formats: [newDivFormat],
      playersPerTeam: isDoubles ? 2 : 1,
      quotaDoubles: isDoubles ? safeQuota : 0,
      quotaSingles: !isDoubles ? safeQuota : 0,
      minTeamsToOpen: 4,
      maxEventsPerPlayer: 2,
      preventDuplicatePartner: true,
      entryFeeDoubles: isDoubles ? Math.max(0, Number(newDivFee) || 0) : 0,
      entryFeeSingles: !isDoubles ? Math.max(0, Number(newDivFee) || 0) : 0,
    };
    const next = { ...draft, divisions: [...draft.divisions, newDiv] };
    setDraft(next);
    setNewDivName('');
    setNewDivCode('');
    saveDraft(
      next,
      `เพิ่มระดับมือ "${newDiv.nameTh}" (${isDoubles ? `${safeQuota} คู่ = ${addedPeople} คน` : `${safeQuota} คน`}) แล้ว`
    );
  };

  const handleDeleteDivision = (division: DivisionConfig, registrations: number) => {
    if (!canEdit) return;
    if (registrations > 0) {
      notify('error', `ลบ "${division.nameTh}" ไม่ได้ เพราะมีผู้สมัครแล้ว ${registrations} รายการ`);
      return;
    }
    requestConfirm({
      title: `ลบระดับมือ "${division.nameTh}"?`,
      description: 'ยืนยันการลบ (Y/N) การดำเนินการนี้ทำได้เฉพาะระดับที่ไม่เคยมีผู้สมัคร และไม่สามารถย้อนกลับได้',
      confirmLabel: 'ใช่, ลบระดับมือ',
      cancelLabel: 'ไม่ลบ',
      destructive: true,
      onConfirm: async () => {
        try {
          await apiFetch(`/api/tournaments/${tournament.id}/divisions/${encodeURIComponent(division.id)}`, {
            method: 'DELETE',
          });
          setDraft((current) => ({
            ...current,
            divisions: current.divisions.filter((item) => item.id !== division.id),
          }));
          await refreshState();
          notify('success', `ลบระดับมือ "${division.nameTh}" แล้ว`);
        } catch (error) {
          notify('error', error instanceof Error ? error.message : 'ลบระดับมือไม่สำเร็จ');
        }
      },
    });
  };

  const handleAddCourt = () => {
    const label = newCourtName.trim() || `สนาม ${draft.courts.length + 1}`;
    const newCourt: CourtConfig = {
      id: `crt-${Date.now()}`,
      name: label,
      openTime: newCourtOpen || draft.startTime || '08:30',
      closeTime: newCourtClose || draft.endTime || '20:30',
      avgMatchMinutes: 30,
      bufferMinutes: 5,
      minRestMinutes: Math.max(5, Number(newCourtRest) || 20),
      status: 'available',
    };
    const next = { ...draft, courts: [...draft.courts, newCourt] };
    setDraft(next);
    setNewCourtName('');
    saveDraft(next, `เพิ่มสนาม "${label}" เรียบร้อย`);
  };

  const moveTieBreak = (idx: number, dir: -1 | 1) => {
    const arr = [...draft.tieBreakOrder];
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= arr.length) return;
    [arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]];
    setDraft({ ...draft, tieBreakOrder: arr });
  };

  const sections = [
    { id: 1, label: '1. ข้อมูลทั่วไป & วันจัดงาน', icon: <Sliders className="w-4 h-4" /> },
    { id: 2, label: '2. ระดับมือ (เดี่ยว / คู่)', icon: <Layers className="w-4 h-4" /> },
    { id: 3, label: '3. ระบบการแข่งขัน & Tie-break', icon: <Trophy className="w-4 h-4" /> },
    { id: 4, label: '4. รูปแบบคะแนน', icon: <Sliders className="w-4 h-4" /> },
    { id: 5, label: '5. กำหนดวันรับสมัคร & PDPA', icon: <UserCheck className="w-4 h-4" /> },
    { id: 6, label: '6. การชำระเงิน & POS', icon: <CreditCard className="w-4 h-4" /> },
    { id: 7, label: '7. สนามและตารางเวลา', icon: <Calendar className="w-4 h-4" /> },
    { id: 8, label: '8. กติกาและรหัสกรรมการ', icon: <Users className="w-4 h-4" /> },
    { id: 9, label: '9. Public View & Live Score', icon: <Globe className="w-4 h-4" /> },
    { id: 10, label: '10. ผู้ใช้งานและสิทธิ์', icon: <Shield className="w-4 h-4" /> },
  ];

  const activeSection = sections.find((item) => item.id === section) ?? sections[0];

  return (
    <div className="space-y-4 min-w-0">
      <header className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[#156143] dark:text-[#4ADE80]">
            <Sliders className="w-4 h-4" />
            <span className="text-[11px] font-bold uppercase tracking-[0.14em]">Tournament configuration</span>
          </div>
          <h1 className="text-lg sm:text-xl font-bold mt-1">ตั้งค่ารายการแข่งขัน</h1>
          <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC] mt-1 truncate sm:whitespace-normal">
            {tournament.name} · หมวด {section} จาก {sections.length}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusIndicator tone={canEdit ? 'success' : 'warning'} label={canEdit ? 'พร้อมแก้ไข' : 'อ่านอย่างเดียว'} compact />
          <span className="px-2.5 py-1.5 rounded-lg bg-[#F7F6F2] dark:bg-[#0B121C] font-mono text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">สาย v{draft.bracketVersion}</span>
        </div>
      </header>

      <div className="lg:hidden rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-3 sticky top-[116px] z-20 shadow-sm">
        <label className="block text-[11px] font-semibold text-[#525C6B] dark:text-[#9AA8BC] mb-1.5">หมวดการตั้งค่า</label>
        <select
          value={section}
          onChange={(event) => changeSection(Number(event.target.value))}
          className="w-full min-h-[42px] px-3 rounded-lg border border-[#C2BCAC] dark:border-[#3D5270] bg-[#F7F6F2] dark:bg-[#0B121C] text-sm font-semibold"
          aria-label="เลือกหมวดการตั้งค่า"
        >
          {sections.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-5 items-start min-w-0">
        <aside className="hidden lg:block lg:sticky lg:top-[76px] rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-2.5 max-h-[calc(100dvh-92px)] overflow-y-auto overscroll-contain">
          <div className="px-2.5 pt-1 pb-2.5 mb-1 border-b border-[#E2DFD5] dark:border-[#25354C]">
            <div className="text-xs font-bold">หมวดการตั้งค่า</div>
            <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC] mt-0.5">เลือกแก้ไขทีละส่วน</div>
          </div>
          <nav className="space-y-1" aria-label="หมวดการตั้งค่ารายการ">
            {sections.map((item) => (
              <button
                key={item.id}
                onClick={() => changeSection(item.id)}
                aria-current={section === item.id ? 'step' : undefined}
                className={`w-full min-h-[42px] px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 text-left transition-colors ${
                  section === item.id
                    ? 'bg-[#156143] text-white shadow-sm'
                    : 'text-[#141D2B] dark:text-[#F3F5F8] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]'
                }`}
              >
                <span className={`w-7 h-7 rounded-md inline-flex items-center justify-center shrink-0 ${section === item.id ? 'bg-white/15' : 'bg-[#EFECE4] dark:bg-[#1B293D] text-[#156143] dark:text-[#4ADE80]'}`}>{item.icon}</span>
                <span className="truncate">{item.label.replace(/^\d+\.\s*/, '')}</span>
              </button>
            ))}
          </nav>
        </aside>

        <section className="min-w-0 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 sm:p-5 space-y-5 text-xs overflow-hidden">
        <div className="flex items-center gap-2 pb-3 border-b border-[#E2DFD5] dark:border-[#25354C]">
          <span className="w-8 h-8 rounded-lg bg-[#156143]/10 dark:bg-[#229A6B]/15 text-[#156143] dark:text-[#4ADE80] inline-flex items-center justify-center shrink-0">{activeSection.icon}</span>
          <div className="min-w-0"><div className="font-bold text-sm truncate">{activeSection.label}</div><div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">การเปลี่ยนแปลงจะมีผลหลังจากกดบันทึก</div></div>
        </div>
        {!canEdit && (
          <StatusIndicator
            tone="warning"
            label="โหมดอ่านอย่างเดียว (บทบาทของคุณไม่มีสิทธิ์แก้ไขการตั้งค่า)"
          />
        )}

        {section === 1 && (
          <div className="space-y-4">
            <h2 className="text-base font-bold">1. ข้อมูลทั่วไปของรายการแข่งขัน</h2>

            {/* Tournament Logo Upload Card */}
            <div className="p-4 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="relative w-20 h-20 rounded-xl overflow-hidden border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] flex items-center justify-center shrink-0">
                {draft.emblemUrl ? (
                  <img
                    src={draft.emblemUrl}
                    alt="โลโก้รายการแข่งขัน"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImageIcon className="w-7 h-7 text-[#525C6B]" />
                )}
              </div>

              <div className="flex-1 min-w-0 space-y-2">
                <div>
                  <div className="text-sm font-bold text-[#141D2B] dark:text-[#F3F5F8]">
                    โลโก้รายการแข่งขัน (Logo / Emblem)
                  </div>
                  <p className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
                    แสดงบน Topbar, หน้า Dashboard และหน้า Public Live Score (รองรับ PNG, JPG, WebP)
                  </p>
                </div>

                {canEdit && (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="min-h-[38px] px-3.5 rounded-lg bg-[#156143] hover:bg-[#104D35] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      <span>อัปโหลดโลโก้ใหม่</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onChange={handleLogoUpload}
                        className="sr-only"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={async () => {
                        const defaultLogo = '/src/assets/images/phrae_tournament_emblem_1795282541424.jpg';
                        const next = { ...draft, emblemUrl: defaultLogo };
                        setDraft(next);
                        await saveDraft(next, 'คืนค่าโลโก้เริ่มต้นเรียบร้อย');
                      }}
                      className="min-h-[38px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D] text-xs font-medium inline-flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>ใช้โลโก้เริ่มต้น</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium mb-1">ชื่อรายการแข่งขัน</label>
                <input
                  disabled={!canEdit}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">สถานที่แข่งขัน</label>
                <input
                  disabled={!canEdit}
                  value={draft.venue}
                  onChange={(e) => setDraft({ ...draft, venue: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">ผู้จัด / ช่องทางติดต่อ</label>
                <input
                  disabled={!canEdit}
                  value={draft.organizer}
                  onChange={(e) => setDraft({ ...draft, organizer: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">สถานะรายการแข่งขัน</label>
                <select
                  disabled={!canEdit}
                  value={draft.status}
                  onChange={(e) =>
                    setDraft({ ...draft, status: e.target.value as TournamentStatus })
                  }
                  className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                >
                  {(
                    [
                      'Draft',
                      'เปิดรับสมัคร',
                      'ปิดรับสมัคร',
                      'เตรียมจัดสาย',
                      'กำลังแข่งขัน',
                      'พักการแข่งขัน',
                      'แข่งขันเสร็จแล้ว',
                      'ยกเลิก',
                    ] as TournamentStatus[]
                  ).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">วันที่เริ่มจัดงาน *</label>
                <input
                  type="date"
                  disabled={!canEdit}
                  value={draft.startDate}
                  onChange={(e) => {
                    const startDate = e.target.value;
                    const parsedYear = Number(startDate.slice(0, 4));
                    setDraft({
                      ...draft,
                      startDate,
                      endDate: draft.endDate && draft.endDate < startDate ? startDate : draft.endDate,
                      year: parsedYear > 2000 ? parsedYear : draft.year,
                    });
                  }}
                  className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] font-mono"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">วันที่สิ้นสุดจัดงาน *</label>
                <input
                  type="date"
                  disabled={!canEdit}
                  value={draft.endDate}
                  min={draft.startDate}
                  onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] font-mono"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">เวลาเริ่มแข่งขัน</label>
                <input
                  type="time"
                  disabled={!canEdit}
                  value={draft.startTime}
                  onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] font-mono"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">เวลาสิ้นสุดโดยประมาณ</label>
                <input
                  type="time"
                  disabled={!canEdit}
                  value={draft.endTime}
                  onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block font-medium mb-1">ระเบียบการและเงื่อนไขการแข่งขัน</label>
              <textarea
                rows={3}
                disabled={!canEdit}
                value={draft.rulesText}
                onChange={(e) => setDraft({ ...draft, rulesText: e.target.value })}
                className="w-full p-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">กรณีพิเศษและแนวทางตัดสิน</label>
              <textarea
                rows={4}
                disabled={!canEdit}
                value={draft.competitionCasesText || ''}
                onChange={(e) => setDraft({ ...draft, competitionCasesText: e.target.value })}
                placeholder={'ตัวอย่าง: มาสายเกิน 15 นาทีให้ปรับแพ้บาย\nบาดเจ็บระหว่างแข่งขันให้กรรมการบันทึก Retired\nกรณีคะแนนหรือผลการแข่งขันมีข้อโต้แย้งให้ติดต่อผู้ชี้ขาด'}
                className="w-full p-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
              />
              <p className="mt-1 text-[11px] text-[#667085] dark:text-[#9AA8BC]">ข้อความนี้จะแสดงใน Tab “กติกา & กรณีต่างๆ” ของ Public Live Score</p>
            </div>
          </div>
        )}

        {section === 2 && (
          <div className="space-y-4">
            <h2 className="text-base font-bold">2. ระดับมือและแยกประเภท (เดี่ยว / คู่)</h2>
            <p className="text-[#525C6B] dark:text-[#9AA8BC]">
              ระบุให้ชัดเจนว่าแต่ละระดับมือเป็น <strong>ประเภทเดี่ยว (นักกีฬา 1 คน)</strong> หรือ{' '}
              <strong>ประเภทคู่ (นักกีฬา 2 คน)</strong> โดยโควตานับรวมทุกประเภทต้องไม่เกิน{' '}
              <strong className="font-mono tabular-nums text-[#141D2B] dark:text-[#F3F5F8]">
                {maxParticipantsCap.toLocaleString()} คน
              </strong>{' '}
              ที่กำหนดไว้
            </p>

            {/* Participant Capacity Meter & Expand with Coin */}
            <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-[#141D2B] dark:text-[#F3F5F8]">
                    โควตานักกีฬารวมทุกประเภท (1 คู่ = 2 คน · 1 เดี่ยว = 1 คน)
                  </div>
                  <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC] mt-0.5">
                    จัดสรรไปแล้ว{' '}
                    <strong
                      className={`font-mono tabular-nums ${
                        isOverParticipantsCap
                          ? 'text-[#B91C1C] dark:text-[#FCA5A5]'
                          : 'text-[#156143] dark:text-[#4ADE80]'
                      }`}
                    >
                      {allocatedPeople.toLocaleString()}
                    </strong>{' '}
                    /{' '}
                    <strong className="font-mono tabular-nums text-[#141D2B] dark:text-[#F3F5F8]">
                      {maxParticipantsCap.toLocaleString()}
                    </strong>{' '}
                    คน ·{' '}
                    {remainingPeopleSlots >= 0 ? (
                      <span>
                        คงเหลือ{' '}
                        <strong className="font-mono tabular-nums text-[#141D2B] dark:text-[#F3F5F8]">
                          {remainingPeopleSlots.toLocaleString()}
                        </strong>{' '}
                        คน
                      </span>
                    ) : (
                      <span className="font-semibold text-[#B91C1C] dark:text-[#FCA5A5]">
                        เกินโควตา {Math.abs(remainingPeopleSlots).toLocaleString()} คน
                      </span>
                    )}
                  </div>
                </div>
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#141D2B] dark:text-[#F3F5F8]">
                  <Coins className="w-4 h-4 text-[#B45309] dark:text-[#FBBF24]" />
                  <span>คงเหลือ:</span>
                  <span className="font-mono tabular-nums">
                    {availableCoinBalance.toLocaleString()} Coin
                  </span>
                </div>
              </div>

              <div className="w-full h-2.5 rounded-full bg-[#E2DFD5] dark:bg-[#1B293D] overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    isOverParticipantsCap
                      ? 'bg-[#B91C1C] dark:bg-[#EF4444]'
                      : 'bg-[#156143] dark:bg-[#229A6B]'
                  }`}
                  style={{
                    width: `${Math.min(100, maxParticipantsCap > 0 ? Math.round((allocatedPeople / maxParticipantsCap) * 100) : 100)}%`,
                  }}
                />
              </div>

              {isOverParticipantsCap && (
                <div className="flex items-start gap-2 rounded-lg border border-[#FECACA] dark:border-[#7F1D1D] bg-[#FEF2F2] dark:bg-[#361215] px-3 py-2 text-xs text-[#B91C1C] dark:text-[#FCA5A5]">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    โควตา (คู่/คน) รวมเกินจำนวนที่กำหนดไว้ ({allocatedPeople.toLocaleString()} /{' '}
                    {maxParticipantsCap.toLocaleString()} คน) กรุณาลดโควตาหรือซื้อจำนวนคนเพิ่มด้วย Coin ด้านล่างก่อนบันทึก
                  </span>
                </div>
              )}

              {canEdit && (
                <div className="pt-2.5 border-t border-[#E2DFD5] dark:border-[#25354C] flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="font-semibold text-xs text-[#141D2B] dark:text-[#F3F5F8]">
                      ขยายจำนวนคนรับสมัคร (ชำระ Coin เพิ่ม)
                    </div>
                    <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
                      ฟรี {pricingFreeParticipants.toLocaleString()} คนแรก · ตั้งแต่นักกีฬาคนที่{' '}
                      {(pricingFreeParticipants + 1).toLocaleString()} ขึ้นไป คนละ{' '}
                      {pricingCoinPerParticipant.toLocaleString()} Coin
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={expandParticipantsBy}
                      onChange={(e) => setExpandParticipantsBy(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                      aria-label="จำนวนคนที่ต้องการขยายเพิ่ม"
                      className="w-20 min-h-[38px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] font-mono tabular-nums font-bold"
                    />
                    {[10, 20, 50].map((inc) => (
                      <button
                        key={inc}
                        type="button"
                        onClick={() => setExpandParticipantsBy(inc)}
                        className={`min-h-[38px] px-2.5 rounded-lg border font-mono text-xs font-semibold ${
                          safeExpandAdd === inc
                            ? 'bg-[#156143] text-white border-[#156143]'
                            : 'bg-white dark:bg-[#131E2E] border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]'
                        }`}
                      >
                        +{inc}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={expandingCapacity || !canAffordExpand}
                      onClick={handleExpandCapacity}
                      className="min-h-[38px] px-3.5 rounded-lg bg-[#B45309] hover:bg-[#92400E] disabled:opacity-45 disabled:cursor-not-allowed text-white font-semibold inline-flex items-center gap-1.5"
                    >
                      <Coins className="w-3.5 h-3.5" />
                      <span>
                        {expandingCapacity
                          ? 'กำลังขยาย...'
                          : expandCostCoins > 0
                          ? `ซื้อเพิ่ม +${safeExpandAdd} คน (-${expandCostCoins.toLocaleString()} Coin)`
                          : `ขยาย +${safeExpandAdd} คน (ฟรี)`}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {canEdit && (
              <div className="p-4 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] space-y-3">
                <div className="font-bold text-xs text-[#156143] dark:text-[#4ADE80]">
                  + เพิ่มระดับมือใหม่
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-end">
                  <div className="lg:col-span-2">
                    <label className="block font-medium mb-1">ชื่อระดับมือใหม่ (ไทย) *</label>
                    <input
                      value={newDivName}
                      onChange={(e) => setNewDivName(e.target.value)}
                      placeholder="เช่น มือพิเศษ คู่ผสม หรือ มือใหม่ ชายเดี่ยว"
                      className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E]"
                    />
                  </div>
                  <div>
                    <label className="block font-medium mb-1">รหัสระดับมือ</label>
                    <input
                      value={newDivCode}
                      onChange={(e) => setNewDivCode(e.target.value)}
                      placeholder="SP-XD"
                      className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E]"
                    />
                  </div>
                  <div>
                    <label className="block font-medium mb-1">ประเภทการแข่ง *</label>
                    <select
                      value={newDivFormat}
                      onChange={(e) => {
                        const fmt = e.target.value as MatchFormatType;
                        setNewDivFormat(fmt);
                        setNewDivFee(fmt === 'doubles' ? 800 : 500);
                      }}
                      className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] font-semibold"
                    >
                      <option value="doubles">ประเภทคู่ (2 คน/ทีม)</option>
                      <option value="singles">ประเภทเดี่ยว (1 คน)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium mb-1">ค่าสมัคร (บาท)</label>
                    <input
                      type="number"
                      min={0}
                      value={newDivFee}
                      onChange={(e) => setNewDivFee(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                      className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-medium mb-1">
                      โควตา ({newDivFormat === 'doubles' ? 'คู่' : 'คน'})
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        value={newDivQuota}
                        onChange={(e) => setNewDivQuota(e.target.value === '' ? '' : Math.max(1, Number(e.target.value)))}
                        className="w-20 min-h-[40px] px-2 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] font-mono tabular-nums"
                      />
                      <span className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC] font-mono tabular-nums whitespace-nowrap">
                        = {(Math.max(1, Number(newDivQuota) || 1) * (newDivFormat === 'doubles' ? 2 : 1)).toLocaleString()} คน
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
                    โควตาคงเหลือที่เปิดเพิ่มได้:{' '}
                    <strong className="font-mono tabular-nums text-[#141D2B] dark:text-[#F3F5F8]">
                      {Math.max(0, remainingPeopleSlots).toLocaleString()} คน
                    </strong>
                  </span>
                  <button
                    type="button"
                    onClick={handleAddDivision}
                    className="min-h-[40px] px-4 rounded-lg bg-[#156143] hover:bg-[#104D35] text-white font-semibold inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>เพิ่มระดับมือ ({newDivFormat === 'doubles' ? 'คู่ · 2 คน' : 'เดี่ยว · 1 คน'})</span>
                  </button>
                </div>
              </div>
            )}

            <div className="divide-y divide-[#E2DFD5] dark:divide-[#25354C] border border-[#E2DFD5] dark:border-[#25354C] rounded-xl">
              {draft.divisions.map((div, idx) => {
                const divFmt = getDivisionFormat(div);
                const isDoubles = divFmt === 'doubles';
                const currentFee = isDoubles ? div.entryFeeDoubles : div.entryFeeSingles;
                const rawQuota = isDoubles ? div.quotaDoubles : div.quotaSingles;
                const numericQuota = typeof rawQuota === 'number' ? rawQuota : 0;
                const peopleUsed = getDivisionParticipantsCount(div);
                const registrations = state.players.filter(
                  (player) => player.tournamentId === tournament.id && player.divisionId === div.id
                ).length;
                return (
                  <div
                    key={div.id}
                    className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="font-bold text-sm flex flex-wrap items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-sm shrink-0"
                          style={{ backgroundColor: div.color }}
                        />
                        <input
                          disabled={!canEdit}
                          value={div.nameTh}
                          onChange={(event) => {
                            const copy = [...draft.divisions];
                            copy[idx] = { ...copy[idx], nameTh: event.target.value };
                            setDraft({ ...draft, divisions: copy });
                          }}
                          aria-label={`ชื่อระดับมือ ${div.code}`}
                          className="min-h-[36px] w-full sm:w-52 px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] font-bold text-sm"
                        />
                        <span className="font-mono text-xs text-[#525C6B]">({div.code})</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                            isDoubles
                              ? 'bg-[#ECFDF3] text-[#156143] dark:bg-[#0E2E1D] dark:text-[#4ADE80]'
                              : 'bg-[#EFF6FF] text-[#1D4ED8] dark:bg-[#162742] dark:text-[#93C5FD]'
                          }`}
                        >
                          {isDoubles ? 'ประเภทคู่ · นักกีฬา 2 คน' : 'ประเภทเดี่ยว · นักกีฬา 1 คน'}
                        </span>
                      </div>
                      <div className="text-[#525C6B] dark:text-[#9AA8BC] font-mono tabular-nums">
                        รับ {numericQuota} {isDoubles ? 'คู่' : 'คน'} ({div.enabled ? `ใช้ ${peopleUsed} คน` : 'ปิดใช้งานอยู่'}) · ค่าสมัคร ฿{currentFee.toLocaleString()} · ผู้สมัคร {registrations} รายการ
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        disabled={!canEdit}
                        value={divFmt}
                        onChange={(e) => {
                          const nextFmt = e.target.value as MatchFormatType;
                          const copy = [...draft.divisions];
                          const prevFee = isDoubles ? copy[idx].entryFeeDoubles : copy[idx].entryFeeSingles;
                          const prevQuota = typeof rawQuota === 'number' && rawQuota > 0 ? rawQuota : 4;
                          copy[idx] = {
                            ...copy[idx],
                            formats: [nextFmt],
                            playersPerTeam: nextFmt === 'doubles' ? 2 : 1,
                            quotaDoubles: nextFmt === 'doubles' ? prevQuota : 0,
                            quotaSingles: nextFmt === 'singles' ? prevQuota : 0,
                            entryFeeDoubles: nextFmt === 'doubles' ? (prevFee || 800) : 0,
                            entryFeeSingles: nextFmt === 'singles' ? (prevFee || 500) : 0,
                          };
                          setDraft({ ...draft, divisions: copy });
                        }}
                        className="min-h-[36px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs font-semibold"
                      >
                        <option value="doubles">ประเภทคู่ (2 คน)</option>
                        <option value="singles">ประเภทเดี่ยว (1 คน)</option>
                      </select>

                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">โควตา</span>
                        <EditableNumberInput
                          min={0}
                          disabled={!canEdit}
                          value={numericQuota}
                          onCommit={(val) => {
                            const copy = [...draft.divisions];
                            if (isDoubles) copy[idx] = { ...copy[idx], quotaDoubles: val };
                            else copy[idx] = { ...copy[idx], quotaSingles: val };
                            setDraft({ ...draft, divisions: copy });
                          }}
                          aria-label={`โควตา ${div.nameTh}`}
                          className="w-16 min-h-[36px] px-2 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] font-mono tabular-nums text-xs"
                        />
                        <span className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
                          {isDoubles ? 'คู่' : 'คน'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">฿</span>
                        <EditableNumberInput
                          min={0}
                          disabled={!canEdit}
                          value={currentFee}
                          onCommit={(val) => {
                            const copy = [...draft.divisions];
                            if (isDoubles) copy[idx] = { ...copy[idx], entryFeeDoubles: val };
                            else copy[idx] = { ...copy[idx], entryFeeSingles: val };
                            setDraft({ ...draft, divisions: copy });
                          }}
                          aria-label={`ค่าสมัคร ${div.nameTh}`}
                          className="w-20 min-h-[36px] px-2 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] font-mono text-xs"
                        />
                      </div>

                      <label className="flex items-center gap-1.5 font-semibold px-2">
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={div.enabled}
                          onChange={(e) => {
                            const copy = [...draft.divisions];
                            copy[idx] = { ...copy[idx], enabled: e.target.checked };
                            setDraft({ ...draft, divisions: copy });
                          }}
                        />
                        <span>{div.enabled ? 'เปิดใช้' : 'ปิด'}</span>
                      </label>
                      {canEdit && (
                        <button
                          type="button"
                          disabled={registrations > 0}
                          onClick={() => handleDeleteDivision(div, registrations)}
                          aria-label={`ลบระดับมือ ${div.nameTh}`}
                          title={registrations > 0 ? `ลบไม่ได้ เพราะมีผู้สมัครแล้ว ${registrations} รายการ` : 'ลบระดับมือ'}
                          className="min-h-[36px] min-w-[36px] rounded-lg border border-[#FECACA] dark:border-[#5E2025] text-[#B91C1C] dark:text-[#F87171] hover:bg-[#FEF2F2] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {section === 3 && (
          <div className="space-y-4">
            <h2 className="text-base font-bold">3. ระบบการแข่งขันและลำดับ Tie-break</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium mb-1">รูปแบบการแข่งขันหลัก</label>
                <select
                  disabled={!canEdit}
                  value={draft.drawSystem}
                  onChange={(e) =>
                    setDraft({ ...draft, drawSystem: e.target.value as Tournament['drawSystem'] })
                  }
                  className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                >
                  <option value="group_then_knockout">รอบแบ่งกลุ่มพบกันหมด + Knockout</option>
                  <option value="single_elimination">Single Elimination</option>
                  <option value="double_elimination">Double Elimination</option>
                  <option value="round_robin">พบกันหมดทั้งสาย (Round Robin)</option>
                </select>
              </div>
              <label className="flex items-center gap-2 p-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C]">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={draft.bracketLocked}
                  onChange={(e) => setDraft({ ...draft, bracketLocked: e.target.checked })}
                />
                <span>ล็อกสายการแข่งขันหลังประกาศ (ต้องแก้ผ่าน Revision)</span>
              </label>

              {(draft.drawSystem === 'group_then_knockout' || draft.drawSystem === 'round_robin') && (
                <>
                  {draft.drawSystem === 'group_then_knockout' && (
                    <div>
                      <label className="block font-medium mb-1">จำนวนทีมต่อสาย (กลุ่ม)</label>
                      <select
                        disabled={!canEdit}
                        value={draft.teamsPerGroup || 4}
                        onChange={(e) => {
                          const teams = Number(e.target.value);
                          setDraft({
                            ...draft,
                            teamsPerGroup: teams,
                            qualifiersPerGroup: Math.min(draft.qualifiersPerGroup, teams - 1),
                          });
                        }}
                        className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                      >
                        {[3, 4, 5, 6].map((n) => (
                          <option key={n} value={n}>
                            {n} ทีม / สาย (วนแข่ง { (n * (n - 1)) / 2 } แมตช์/กลุ่ม)
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block font-medium mb-1">จำนวนทีมผ่านเข้ารอบต่อสาย</label>
                    <select
                      disabled={!canEdit}
                      value={draft.qualifiersPerGroup || 2}
                      onChange={(e) => setDraft({ ...draft, qualifiersPerGroup: Number(e.target.value) })}
                      className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                    >
                      {[1, 2, 3, 4].filter((n) => n < (draft.teamsPerGroup || 4)).map((n) => (
                        <option key={n} value={n}>
                          {n} อันดับแรก
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              <label className="flex items-center gap-2 p-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C]">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={draft.separateSameClub}
                  onChange={(e) => setDraft({ ...draft, separateSameClub: e.target.checked })}
                />
                <span>แยกทีมจากสโมสรเดียวกันไม่ให้อยู่สายเดียวกันในรอบแรก</span>
              </label>
            </div>

            <div>
              <h3 className="font-bold mb-2">ลำดับเกณฑ์ Tie-break รอบแบ่งกลุ่ม (กดเลื่อนขึ้น/ลงได้)</h3>
              <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC] mb-2">
                ระบบเรียงคะแนนสะสมก่อนเสมอ: ชนะ 2 คะแนน · เสมอ 1 คะแนน · แพ้ 0 คะแนน แล้วจึงใช้เกณฑ์ด้านล่างตามลำดับ
              </p>
              <div className="divide-y divide-[#E2DFD5] dark:divide-[#25354C] border border-[#E2DFD5] dark:border-[#25354C] rounded-xl">
                {draft.tieBreakOrder.map((crit, idx) => (
                  <div key={crit} className="px-3.5 py-2.5 flex items-center justify-between">
                    <span>
                      <strong className="font-mono mr-2">{idx + 1}.</strong>
                      {TIE_BREAK_LABELS[crit]}
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        disabled={!canEdit || idx === 0}
                        onClick={() => moveTieBreak(idx, -1)}
                        aria-label={`เลื่อน ${TIE_BREAK_LABELS[crit]} ขึ้น`}
                        className="p-1.5 rounded border border-[#E2DFD5] disabled:opacity-30"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={!canEdit || idx === draft.tieBreakOrder.length - 1}
                        onClick={() => moveTieBreak(idx, 1)}
                        aria-label={`เลื่อน ${TIE_BREAK_LABELS[crit]} ลง`}
                        className="p-1.5 rounded border border-[#E2DFD5] disabled:opacity-30"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {section === 4 && (
          <div className="space-y-4">
            <h2 className="text-base font-bold">4. รูปแบบคะแนน (Scoring Rules)</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-medium mb-1">จำนวนเซต</label>
                <select
                  disabled={!canEdit}
                  value={draft.scoringRules.bestOfSets}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      scoringRules: {
                        ...draft.scoringRules,
                        bestOfSets: Number(e.target.value) as 1 | 2 | 3,
                      },
                    })
                  }
                  className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                >
                  <option value={3}>3 เซต (ชนะ 2 ใน 3)</option>
                  <option value={2}>2 เซต (แข่ง 2 เซต / นับผล 2 เซต)</option>
                  <option value={1}>1 เซตเดียว</option>
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">คะแนนต่อเซต</label>
                <select
                  disabled={!canEdit}
                  value={draft.scoringRules.pointsPerSet}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      scoringRules: { ...draft.scoringRules, pointsPerSet: Number(e.target.value) as 15 | 21 },
                    })
                  }
                  className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                >
                  <option value={21}>21 คะแนน (สากล)</option>
                  <option value={15}>15 คะแนน</option>
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">คะแนนสูงสุด (Setting Cap)</label>
                <EditableNumberInput
                  min={1}
                  disabled={!canEdit}
                  value={draft.scoringRules.maxCapPoint}
                  onCommit={(value) =>
                    setDraft({
                      ...draft,
                      scoringRules: { ...draft.scoringRules, maxCapPoint: value },
                    })
                  }
                  className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.scoringRules.winByTwo}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      scoringRules: { ...draft.scoringRules, winByTwo: e.target.checked },
                    })
                  }
                />
                <span>ต้องชนะห่าง 2 คะแนน (Setting 21 คะแนน)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.scoringRules.goldenPoint}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      scoringRules: { ...draft.scoringRules, goldenPoint: e.target.checked },
                    })
                  }
                />
                <span>ใช้ Golden Point (แต้มตัดสินสุดท้าย)</span>
              </label>
            </div>
          </div>
        )}

        {section === 5 && (() => {
          const regWin = getRegistrationWindowStatus(draft);
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-bold">5. กำหนดวันรับสมัครออนไลน์ & PDPA Consent</h2>
                <StatusIndicator
                  tone={regWin.isOpen ? 'success' : 'danger'}
                  label={regWin.isOpen ? 'ระบบรับสมัครออนไลน์: เปิดอยู่' : `ปิดอัตโนมัติ · ${regWin.reason}`}
                  compact
                />
              </div>

              <div className="p-3.5 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] space-y-3">
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 font-semibold">
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={draft.registrationConfig.isOpen}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          registrationConfig: {
                            ...draft.registrationConfig,
                            isOpen: e.target.checked,
                          },
                        })
                      }
                    />
                    <span>เปิดรับสมัครออนไลน์ (สวิตช์หลัก)</span>
                  </label>
                  <label className="flex items-center gap-2 font-semibold">
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={draft.registrationConfig.enableWaitingList}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          registrationConfig: {
                            ...draft.registrationConfig,
                            enableWaitingList: e.target.checked,
                          },
                        })
                      }
                    />
                    <span>เปิด Waiting List เมื่อเต็มโควตา</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block font-medium mb-1">วันเวลาเปิดรับสมัครออนไลน์</label>
                    <input
                      type="datetime-local"
                      disabled={!canEdit}
                      value={normalizeDateTimeLocal(draft.registrationConfig.openAt)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          registrationConfig: {
                            ...draft.registrationConfig,
                            openAt: e.target.value,
                          },
                        })
                      }
                      className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-medium mb-1">
                      วันเวลาปิดรับสมัครออนไลน์ (เลยเวลาแล้วระบบจะปิดรับสมัครอัตโนมัติ)
                    </label>
                    <input
                      type="datetime-local"
                      disabled={!canEdit}
                      value={normalizeDateTimeLocal(draft.registrationConfig.closeAt)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          registrationConfig: {
                            ...draft.registrationConfig,
                            closeAt: e.target.value,
                          },
                        })
                      }
                      className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] font-mono"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
                  ช่วงวันจัดงานปัจจุบัน: <span className="font-mono font-semibold">{draft.startDate} – {draft.endDate}</span> · ระบบจะปิดฟอร์มรับสมัครออนไลน์อัตโนมัติเมื่ออยู่นอกช่วงวันเวลาเปิด-ปิดรับสมัคร หรือพ้นวันจัดงาน
                </p>
              </div>

              <div>
                <label className="block font-medium mb-1">ข้อความ PDPA Consent</label>
                <textarea
                  rows={2}
                  disabled={!canEdit}
                  value={draft.registrationConfig.pdpaConsentText}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      registrationConfig: {
                        ...draft.registrationConfig,
                        pdpaConsentText: e.target.value,
                      },
                    })
                  }
                  className="w-full p-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                />
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-[#BFDBFE] dark:border-[#24476F] bg-[#EFF6FF] dark:bg-[#12243C] p-3 text-xs text-[#1E3A8A] dark:text-[#BFDBFE]">
                  <Shield className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>
                    PDPA Consent คือข้อความที่แจ้งวัตถุประสงค์และขอความยินยอมให้นำข้อมูลในใบสมัครไปใช้จัดการแข่งขัน ผู้สมัครต้องติ๊กยอมรับด้วยตนเองก่อนส่งฟอร์ม ระบบตรวจซ้ำที่ API และไม่เปิดเผยเบอร์โทร อีเมล วันเกิด ข้อมูลสุขภาพ หรือหลักฐานชำระเงินในหน้า Public
                  </p>
                </div>
              </div>
            </div>
          );
        })()}

        {section === 6 && (
          <div className="space-y-4">
            <h2 className="text-base font-bold">6. การชำระเงิน (LiveMatch POS หรือ ตั้งค่าใน Tournament)</h2>
            <label className="flex items-center gap-2 font-semibold">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={draft.paymentConfig.useLiveMatchPos}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    paymentConfig: { ...draft.paymentConfig, useLiveMatchPos: e.target.checked },
                  })
                }
              />
              <span>เชื่อมข้อมูลชำระเงินจาก LiveMatch/POS (หากปิด ระบบจะบังคับใช้บัญชี PromptPay/โอนใน Tournament)</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium mb-1">PromptPay ID / เลขบัญชีรับเงิน</label>
                <input
                  value={draft.paymentConfig.promptPayId}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      paymentConfig: { ...draft.paymentConfig, promptPayId: e.target.value },
                    })
                  }
                  className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">ธนาคาร / ชื่อบัญชี</label>
                <input
                  value={`${draft.paymentConfig.bankName} · ${draft.paymentConfig.bankAccountNo}`}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      paymentConfig: { ...draft.paymentConfig, bankName: e.target.value },
                    })
                  }
                  className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                />
              </div>
            </div>
          </div>
        )}

        {section === 7 && (
          <div className="space-y-4">
            <h2 className="text-base font-bold">7. สนามและตารางเวลา ({draft.courts.length} สนาม)</h2>

            {canEdit && (
              <div className="p-3.5 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 items-end">
                <div className="lg:col-span-2">
                  <label className="block font-medium mb-1">ชื่อสนามใหม่</label>
                  <input
                    value={newCourtName}
                    onChange={(e) => setNewCourtName(e.target.value)}
                    placeholder={`เช่น สนาม ${draft.courts.length + 1}`}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E]"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">เวลาเปิด–ปิด</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="time"
                      value={newCourtOpen}
                      onChange={(e) => setNewCourtOpen(e.target.value)}
                      className="w-full min-h-[40px] px-2 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] font-mono"
                    />
                    <input
                      type="time"
                      value={newCourtClose}
                      onChange={(e) => setNewCourtClose(e.target.value)}
                      className="w-full min-h-[40px] px-2 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block font-medium mb-1">พักขั้นต่ำ (นาที)</label>
                  <input
                    type="number"
                    min={5}
                    value={newCourtRest}
                    onChange={(e) => setNewCourtRest(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                    className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] font-mono"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddCourt}
                  className="min-h-[40px] px-4 rounded-lg bg-[#156143] hover:bg-[#104D35] text-white font-semibold inline-flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>เพิ่มสนาม</span>
                </button>
              </div>
            )}

            <div className="divide-y divide-[#E2DFD5] dark:divide-[#25354C] border border-[#E2DFD5] dark:border-[#25354C] rounded-xl">
              {draft.courts.map((c, idx) => (
                <div key={c.id} className="p-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-bold">{c.name}</span>
                    <span className="mx-2 text-[#525C6B] dark:text-[#9AA8BC]">
                      {c.openTime} – {c.closeTime} · พักนักกีฬาขั้นต่ำ {c.minRestMinutes} นาที
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      disabled={!canEdit}
                      value={c.status}
                      onChange={(e) => {
                        const copy = [...draft.courts];
                        copy[idx] = {
                          ...copy[idx],
                          status: e.target.value as CourtConfig['status'],
                        };
                        setDraft({ ...draft, courts: copy });
                      }}
                      className="min-h-[34px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs font-medium"
                    >
                      <option value="available">พร้อมใช้งาน</option>
                      <option value="in_use">กำลังแข่งขัน</option>
                      <option value="break">พักสนาม</option>
                      <option value="maintenance">ปิดปรับปรุง</option>
                    </select>
                    <StatusIndicator
                      tone={
                        c.status === 'in_use'
                          ? 'live'
                          : c.status === 'maintenance'
                          ? 'danger'
                          : c.status === 'break'
                          ? 'warning'
                          : 'success'
                      }
                      label={
                        c.status === 'in_use'
                          ? 'กำลังแข่งขัน'
                          : c.status === 'maintenance'
                          ? 'ปิดปรับปรุง'
                          : c.status === 'break'
                          ? 'พักสนาม'
                          : 'พร้อมใช้งาน'
                      }
                      compact
                    />
                    {canEdit && draft.courts.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = {
                            ...draft,
                            courts: draft.courts.filter((x) => x.id !== c.id),
                          };
                          setDraft(next);
                        }}
                        aria-label={`ลบ ${c.name}`}
                        className="min-h-[34px] min-w-[34px] rounded-lg border border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2] inline-flex items-center justify-center"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {section === 8 && (
          <div className="space-y-3">
            <h2 className="text-base font-bold">8. นโยบายกรรมการและรหัส Login 12 หลัก</h2>
            <p className="text-[#525C6B] dark:text-[#9AA8BC]">
              ระบบป้องกันไม่ให้กรรมการตัดสินทีมจากสโมสรเดียวกันโดยอัตโนมัติ และจำกัดการกรอกรหัสผิดไม่เกิน 5 ครั้งก่อนล็อกชั่วคราว
            </p>
            <StatusIndicator tone="success" label="เปิดใช้งาน Anti-Conflict & 12-Digit Rate Limit" />
          </div>
        )}

        {section === 9 && (
          <div className="space-y-4">
            <h2 className="text-base font-bold">9. Public View และ Live Score</h2>
            <div className="space-y-2">
              {[
                { key: 'enabled' as const, label: 'เปิดใช้งานหน้า Public View (ไม่ต้อง Login)' },
                { key: 'showLiveScore' as const, label: 'แสดงคะแนนสดแบบ Real-time' },
                { key: 'showUmpireName' as const, label: 'แสดงชื่อกรรมการประจำสนาม' },
                { key: 'hidePersonalData' as const, label: 'ซ่อนเบอร์โทร อีเมล วันเกิด ข้อมูลสุขภาพ และการเงิน (PDPA)' },
              ].map((opt) => (
                <label key={opt.key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.publicViewConfig[opt.key]}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        publicViewConfig: {
                          ...draft.publicViewConfig,
                          [opt.key]: e.target.checked,
                        },
                      })
                    }
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {section === 10 && (
          <div className="space-y-3">
            <h2 className="text-base font-bold">10. ผู้ใช้งานและสิทธิ์ (ประจำรายการ)</h2>
            <p className="text-[#525C6B] dark:text-[#9AA8BC]">
              Owner สามารถเพิ่ม แก้ไข กำหนดสิทธิ์ รีเซ็ต PIN และลบ/ปิดใช้งานบัญชีรองได้จากหน้านี้ (สูงสุด 5 บัญชี) การลบเป็นการปิดใช้งานเพื่อเก็บ Audit Log
            </p>
            <GlobalSettingsView accountsOnly />
          </div>
        )}

        {canEdit && (
          <div className="sticky bottom-3 z-20 mt-6 p-3 sm:p-4 rounded-xl border border-[#C8D8CF] dark:border-[#2F5B49] bg-white/95 dark:bg-[#131E2E]/95 backdrop-blur-md shadow-lg flex flex-wrap items-center justify-between gap-3">
            {isOverParticipantsCap ? (
              <span className="text-xs font-semibold text-[#B91C1C] dark:text-[#FCA5A5]">
                โควตารวม ({allocatedPeople.toLocaleString()} คน) เกินจำนวนที่กำหนด ({maxParticipantsCap.toLocaleString()} คน) กรุณาลดโควตาหรือขยายจำนวนคน
              </span>
            ) : (
              <span />
            )}
            <button
              type="button"
              disabled={saving || isOverParticipantsCap}
              onClick={() => saveDraft()}
              className="min-h-[44px] px-5 rounded-lg bg-[#156143] hover:bg-[#104D35] disabled:opacity-45 disabled:cursor-not-allowed text-white text-sm font-semibold inline-flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่ารายการ'}</span>
            </button>
          </div>
        )}
        </section>
      </div>
    </div>
  );
};

const EditableNumberInput: React.FC<{
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}> = ({ value, onCommit, min = 0, max, disabled, className = '', 'aria-label': ariaLabel }) => {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(text);
    const normalized = Number.isFinite(parsed)
      ? Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, Math.floor(parsed)))
      : min;
    setText(String(normalized));
    if (normalized !== value) onCommit(normalized);
  };

  return (
    <input
      type="number"
      min={min}
      max={max}
      disabled={disabled}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      aria-label={ariaLabel}
      className={className}
    />
  );
};
