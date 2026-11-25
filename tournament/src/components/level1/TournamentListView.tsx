import React, { useEffect, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Coins,
  ExternalLink,
  MapPin,
  Plus,
  Search,
  Settings,
  Share2,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { INITIAL_TOURNAMENTS } from '../../data/mockData';
import { apiFetch } from '../../services/api';
import { Tournament, TournamentStatus } from '../../types/tournament';
import {
  EXTRA_PARTICIPANT_COST,
  FREE_PARTICIPANTS_LIMIT,
  calculateParticipantExtraCost,
} from '../../utils/registration';
import {
  EmptyStateCard,
  ErrorStateBanner,
  LoadingSkeletonRows,
  QRCodeMatrix,
  SemanticTone,
} from '../common/UIPrimitives';
import { GlobalSettingsView } from './GlobalSettingsView';

export function getStatusTone(status: TournamentStatus): SemanticTone {
  switch (status) {
    case 'กำลังแข่งขัน':
      return 'live';
    case 'เปิดรับสมัคร':
      return 'success';
    case 'เตรียมจัดสาย':
    case 'พักการแข่งขัน':
      return 'warning';
    case 'ยกเลิก':
      return 'danger';
    case 'แข่งขันเสร็จแล้ว':
      return 'info';
    default:
      return 'neutral';
  }
}

interface DashboardTournament extends Tournament {
  applicantCount: number;
  progress: number;
}

interface TournamentDashboardPayload {
  summary: {
    total: number;
    openRegistration: number;
    ongoing: number;
    finished: number;
    participantCount: number;
    pendingAmountSatang: number;
  };
  items: DashboardTournament[];
  years: number[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

const emptyDashboard: TournamentDashboardPayload = {
  summary: {
    total: 0,
    openRegistration: 0,
    ongoing: 0,
    finished: 0,
    participantCount: 0,
    pendingAmountSatang: 0,
  },
  items: [],
  years: [],
  pagination: { page: 1, pageSize: 5, total: 0, totalPages: 0 },
};

export const TournamentListView: React.FC = () => {
  const {
    state,
    refreshState,
    hasPermission,
    setSelectedTournamentId,
    notify,
    requestConfirm,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'list' | 'global_settings'>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === 'global-settings'
      ? 'global_settings'
      : 'list'
  );
  const changeActiveTab = (next: 'list' | 'global_settings') => {
    setActiveTab(next);
    const params = new URLSearchParams(window.location.search);
    if (next === 'global_settings') params.set('view', 'global-settings');
    else params.delete('view');
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [filterYear, setFilterYear] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [dashboard, setDashboard] = useState<TournamentDashboardPayload>(emptyDashboard);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState('');
  const [dashboardReload, setDashboardReload] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [shareTournament, setShareTournament] = useState<Tournament | null>(null);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newVenue, setNewVenue] = useState('สนามแบดมินตันจังหวัดแพร่');
  const [newStartDate, setNewStartDate] = useState('2026-12-20');
  const [newEndDate, setNewEndDate] = useState('2026-12-21');
  const [newOrganizer, setNewOrganizer] = useState('ชมรมแบดมินตันจังหวัดแพร่');
  const [newDesc, setNewDesc] = useState('');
  const [newMaxParticipants, setNewMaxParticipants] = useState<number | ''>(20);
  const [creating, setCreating] = useState(false);

  const safeMaxParticipants = Math.max(1, Math.floor(Number(newMaxParticipants) || 0));
  const extraParticipantsCount = Math.max(0, safeMaxParticipants - FREE_PARTICIPANTS_LIMIT);
  const createCostCoins = calculateParticipantExtraCost(safeMaxParticipants);
  const availableCoins = state.coinBalance ?? 0;
  const hasEnoughCoinsForCreate = availableCoins >= createCostCoins;

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setDashboardLoading(true);
      setDashboardError('');
      try {
        const params = new URLSearchParams({
          page: String(currentPage),
          pageSize: String(pageSize),
        });
        if (searchQuery.trim()) params.set('search', searchQuery.trim());
        if (filterYear !== 'all') params.set('year', filterYear);
        const next = await apiFetch<TournamentDashboardPayload>(`/api/dashboard?${params.toString()}`, {
          signal: controller.signal,
        });
        setDashboard(next);
        if (next.pagination.page !== currentPage) setCurrentPage(next.pagination.page);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setDashboardError(loadError instanceof Error ? loadError.message : 'โหลดข้อมูล Dashboard ไม่สำเร็จ');
      } finally {
        if (!controller.signal.aborted) setDashboardLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [currentPage, pageSize, searchQuery, filterYear, dashboardReload]);

  const totalPages = dashboard.pagination.totalPages;
  const safePage = dashboard.pagination.page;
  const startIndex = dashboard.pagination.total === 0 ? 0 : (safePage - 1) * dashboard.pagination.pageSize + 1;
  const endIndex = Math.min(safePage * dashboard.pagination.pageSize, dashboard.pagination.total);
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1).filter(
    (page) => totalPages <= 7 || page === 1 || page === totalPages || Math.abs(page - safePage) <= 1
  );
  const sharePublicUrl = shareTournament && typeof window !== 'undefined'
    ? `${window.location.origin}/?mode=public&tournament=${encodeURIComponent(
        shareTournament.publicToken || shareTournament.id
      )}&tab=center`
    : '';

  const handleArchive = (t: Tournament) => {
    requestConfirm({
      title: `จัดเก็บรายการ "${t.name}" เข้าคลัง (Archive)?`,
      description: 'รายการจะถูกย้ายไปสถานะ Archived และซ่อนจากรายการปัจจุบัน แต่ข้อมูลรายงานทั้งหมดยังอยู่ครบ',
      confirmLabel: 'ยืนยัน Archive',
      destructive: true,
      requireReason: true,
      onConfirm: async (reason) => {
        await apiFetch(`/api/tournaments/${t.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'Archived', _auditReason: reason }),
        });
        await refreshState();
        setDashboardReload((value) => value + 1);
        notify('success', `ย้าย "${t.name}" ไปคลังแล้ว`);
      },
    });
  };

  const handleCreateTournament = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    if (safeMaxParticipants < 1) {
      notify('error', 'กรุณาระบุจำนวนคนที่ต้องลงสมัครอย่างน้อย 1 คน');
      return;
    }
    if (!hasEnoughCoinsForCreate) {
      notify(
        'error',
        `Coin ไม่เพียงพอ (ต้องใช้ ${createCostCoins.toLocaleString()} Coin · คงเหลือ ${availableCoins.toLocaleString()} Coin)`
      );
      return;
    }
    setCreating(true);
    try {
      const template = structuredClone(INITIAL_TOURNAMENTS[0]);
      // Scale starter divisions cleanly so enabled divisions never exceed maxParticipants
      const scaledDivisions = template.divisions.map((div, index) => {
        if (index === 0) {
          if (safeMaxParticipants >= 2) {
            return {
              ...div,
              enabled: true,
              formats: ['doubles'] as Tournament['divisions'][number]['formats'],
              playersPerTeam: 2,
              quotaDoubles: Math.floor(safeMaxParticipants / 2),
              quotaSingles: 0,
            };
          }
          return {
            ...div,
            enabled: true,
            formats: ['singles'] as Tournament['divisions'][number]['formats'],
            playersPerTeam: 1,
            quotaDoubles: 0,
            quotaSingles: safeMaxParticipants,
          };
        }
        return {
          ...div,
          enabled: false,
          quotaDoubles: 0,
          quotaSingles: 0,
        };
      });

      const created: Tournament = {
        ...template,
        id: `trn-${Date.now()}`,
        name: newName.trim(),
        description: newDesc.trim() || 'รายการแข่งขันแบดมินตันมาตรฐาน',
        organizer: newOrganizer.trim() || 'LiveMatch Arena',
        venue: newVenue.trim(),
        startDate: newStartDate,
        endDate: newEndDate,
        year: Number(newStartDate.slice(0, 4)) || 2026,
        status: 'Draft',
        divisions: scaledDivisions,
        maxParticipants: safeMaxParticipants,
        bracketLocked: false,
        bracketVersion: 1,
      };
      await apiFetch('/api/tournaments', {
        method: 'POST',
        body: JSON.stringify(created),
      });
      await refreshState();
      setDashboardReload((value) => value + 1);
      setShowCreateModal(false);
      setNewName('');
      setNewDesc('');
      setNewMaxParticipants(20);
      notify(
        'success',
        createCostCoins > 0
          ? `สร้างรายการ "${created.name}" (${safeMaxParticipants} คน) · หัก ${createCostCoins.toLocaleString()} Coin`
          : `สร้างรายการ "${created.name}" (${safeMaxParticipants} คน · ฟรี) แล้ว`
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'สร้างรายการไม่สำเร็จ');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5 space-y-5">
      {activeTab === 'global_settings' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => changeActiveTab('list')}
              className="min-h-[40px] px-3.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4 text-[#156143] dark:text-[#229A6B]" />
              <span>กลับหน้ารายการแข่งขัน</span>
            </button>
            <h1 className="text-base sm:text-lg font-bold">
              ตั้งค่าส่วนกลาง (ผู้ใช้งานรอง 5 คน / POS / Audit)
            </h1>
          </div>
          <GlobalSettingsView />
        </div>
      ) : (
        <>
          {/* Clean Responsive Dashboard Header (No bulky top menu bar) */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-[#141D2B] dark:text-[#F3F5F8]">
                แดชบอร์ดรายการแข่งขัน
              </h1>
              <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC] mt-0.5">
                จัดการรายการแข่งขันทั้งหมด ({dashboard.pagination.total} รายการ)
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => changeActiveTab('global_settings')}
                disabled={!hasPermission('manageSubAccounts')}
                title={!hasPermission('manageSubAccounts') ? 'เฉพาะ Owner ที่เข้าถึงตั้งค่าส่วนกลางได้' : undefined}
                className="min-h-[42px] px-3.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D] disabled:opacity-45 disabled:cursor-not-allowed text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Settings className="w-4 h-4 text-[#525C6B] dark:text-[#9AA8BC]" />
                <span>ตั้งค่าส่วนกลาง</span>
              </button>

              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                disabled={!hasPermission('createTournament')}
                title={!hasPermission('createTournament') ? 'เฉพาะ Owner เท่านั้นที่สร้างรายการแข่งขันได้' : undefined}
                className="flex-1 sm:flex-none min-h-[42px] px-4 py-2 rounded-lg bg-[#156143] hover:bg-[#104D35] disabled:opacity-45 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>สร้างรายการแข่งขัน</span>
              </button>
            </div>
          </div>

          {/* 6 Summary KPIs — Responsive 2 -> 3 -> 6 cols */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5 sm:gap-3">
            {[
              { label: 'รายการแข่งขันทั้งหมด', value: dashboard.summary.total, unit: 'รายการ' },
              { label: 'กำลังเปิดรับสมัคร', value: dashboard.summary.openRegistration, unit: 'รายการ' },
              { label: 'กำลังแข่งขัน', value: dashboard.summary.ongoing, unit: 'รายการ' },
              { label: 'แข่งขันเสร็จแล้ว', value: dashboard.summary.finished, unit: 'รายการ' },
              { label: 'นักกีฬาที่สมัครทั้งหมด', value: dashboard.summary.participantCount, unit: 'คน' },
              {
                label: 'ยอดค้างชำระรวม',
                value: `฿${(dashboard.summary.pendingAmountSatang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                unit: 'รอตรวจ/ยังไม่ชำระ',
              },
            ].map((kpi) => (
              <div
                key={kpi.label}
                className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-3.5 sm:p-4 min-w-0"
              >
                <div className="text-[11px] sm:text-xs text-[#525C6B] dark:text-[#9AA8BC] truncate">
                  {kpi.label}
                </div>
                <div className="mt-1 text-xl sm:text-2xl font-bold font-mono tabular-nums text-[#141D2B] dark:text-[#F3F5F8] truncate">
                  {kpi.value}
                </div>
                <div className="mt-0.5 text-[11px] text-[#525C6B] dark:text-[#9AA8BC] truncate">
                  {kpi.unit}
                </div>
              </div>
            ))}
          </div>

          {/* Clean Filters: Name & Year only */}
          <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-3.5 sm:p-4 grid grid-cols-1 sm:grid-cols-4 gap-2.5">
            <div className="relative sm:col-span-3">
              <Search className="w-4 h-4 text-[#525C6B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="ค้นหาชื่อรายการแข่งขัน..."
                className="w-full min-h-[42px] pl-9 pr-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-sm text-[#141D2B] dark:text-[#F3F5F8]"
              />
            </div>

            <select
              value={filterYear}
              onChange={(e) => {
                setFilterYear(e.target.value);
                setCurrentPage(1);
              }}
              aria-label="กรองตามปี"
              className="w-full min-h-[42px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs sm:text-sm text-[#141D2B] dark:text-[#F3F5F8]"
            >
              <option value="all">ทุกปี</option>
              {dashboard.years.map((y) => (
                <option key={y} value={y}>
                  ปี {y}
                </option>
              ))}
            </select>
          </div>

          {dashboardError && <ErrorStateBanner message={dashboardError} onRetry={() => setDashboardReload((value) => value + 1)} />}
          {dashboardLoading && <LoadingSkeletonRows rows={4} />}

          {!dashboardLoading && !dashboardError && dashboard.items.length === 0 && (
            <EmptyStateCard
              title="ไม่พบรายการแข่งขันที่ตรงตามตัวกรอง"
              description="ลองล้างคำค้นหา หรือสร้างรายการแข่งขันใหม่เพื่อเริ่มต้นจัดสายและรับสมัครนักกีฬา"
              actionLabel="ล้างตัวกรอง"
              onAction={() => {
                setSearchQuery('');
                setFilterYear('all');
              }}
            />
          )}

          {/* Desktop Hybrid Table + Mobile/Tablet Responsive Cards */}
          {!dashboardLoading && !dashboardError && dashboard.items.length > 0 && (
            <>
              {/* Desktop Table */}
              <div className="hidden lg:block rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs font-semibold text-[#525C6B] dark:text-[#9AA8BC]">
                      <th className="py-3.5 px-4">ชื่อรายการแข่งขัน / สถานที่</th>
                      <th className="py-3.5 px-4">วันที่แข่งขัน</th>
                      <th className="py-3.5 px-4 text-right">ประเภท</th>
                      <th className="py-3.5 px-4 text-right">ผู้สมัคร</th>
                      <th className="py-3.5 px-4">ความคืบหน้า</th>
                      <th className="py-3.5 px-4 text-right">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2DFD5] dark:divide-[#25354C] text-sm">
                    {dashboard.items.map((t) => {
                      const applicantCount = t.applicantCount;
                      const progress = t.progress;
                      return (
                        <tr
                          key={t.id}
                          className="hover:bg-[#F7F6F2]/70 dark:hover:bg-[#1B293D]/60 transition-colors"
                        >
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-3">
                              <img
                                src={t.emblemUrl}
                                alt={t.name}
                                referrerPolicy="no-referrer"
                                className="w-10 h-10 rounded-lg object-cover border border-[#E2DFD5] dark:border-[#25354C] shrink-0"
                              />
                              <div className="min-w-0">
                                <button
                                  onClick={() => setSelectedTournamentId(t.id)}
                                  className="font-semibold text-[#141D2B] dark:text-[#F3F5F8] hover:text-[#156143] dark:hover:text-[#229A6B] text-left"
                                >
                                  {t.name}
                                </button>
                                <div className="text-xs text-[#525C6B] dark:text-[#9AA8BC] flex items-center gap-1.5 mt-0.5">
                                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                                  <span>{t.venue}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{t.organizer}</span>
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-4 font-mono tabular-nums text-xs text-[#141D2B] dark:text-[#F3F5F8] whitespace-nowrap">
                            {t.startDate} – {t.endDate}
                          </td>
                          <td className="py-4 px-4 text-right font-mono tabular-nums">
                            {t.divisions.filter((d) => d.enabled).length} ระดับ
                          </td>
                          <td className="py-4 px-4 text-right font-mono tabular-nums font-semibold">
                            <div>{applicantCount} ทีม</div>
                            <div className="text-[11px] font-normal text-[#525C6B] dark:text-[#9AA8BC]">
                              รับสูงสุด {(t.maxParticipants || 20).toLocaleString()} คน
                            </div>
                          </td>
                          <td className="py-4 px-4 w-48">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 rounded-full bg-[#EFECE4] dark:bg-[#1B293D] overflow-hidden">
                                <div
                                  className="h-full bg-[#156143] dark:bg-[#229A6B]"
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                              <span className="text-xs font-mono tabular-nums w-9 text-right">
                                {progress}%
                              </span>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => setSelectedTournamentId(t.id)}
                                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#156143] hover:bg-[#104D35] text-white text-xs font-semibold whitespace-nowrap"
                              >
                                เข้าสู่รายการ
                              </button>
                              <button
                                onClick={() => setShareTournament(t)}
                                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
                                title="แชร์หน้าสาธารณะ"
                                aria-label="แชร์หน้าสาธารณะ"
                              >
                                <Share2 className="w-4 h-4" />
                              </button>
                              {hasPermission('editSettings') && t.status !== 'Archived' && (
                                <button
                                  onClick={() => handleArchive(t)}
                                  className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#FEF2F2] hover:text-[#B91C1C] dark:hover:bg-[#361215]"
                                  title="จัดเก็บเข้าคลัง (Archive)"
                                  aria-label="จัดเก็บเข้าคลัง"
                                >
                                  <Archive className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile & Tablet Responsive Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 lg:hidden">
                {dashboard.items.map((t) => {
                  const applicantCount = t.applicantCount;
                  const progress = t.progress;
                  return (
                    <div
                      key={t.id}
                      className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 space-y-3 min-w-0"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <img
                          src={t.emblemUrl}
                          alt={t.name}
                          referrerPolicy="no-referrer"
                          className="w-11 h-11 rounded-lg object-cover border border-[#E2DFD5] dark:border-[#25354C] shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm sm:text-base font-semibold text-[#141D2B] dark:text-[#F3F5F8] leading-snug line-clamp-2">
                            {t.name}
                          </h3>
                          <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC] mt-0.5 truncate">
                            {t.venue} · {t.startDate}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                        <span className="font-mono tabular-nums">
                          {t.divisions.filter((d) => d.enabled).length} ระดับ · {applicantCount} ผู้สมัคร · สูงสุด{' '}
                          {(t.maxParticipants || 20).toLocaleString()} คน
                        </span>
                        <span className="font-mono tabular-nums font-semibold text-[#141D2B] dark:text-[#F3F5F8]">
                          ความคืบหน้า {progress}%
                        </span>
                      </div>

                      <div className="w-full h-2 rounded-full bg-[#EFECE4] dark:bg-[#1B293D] overflow-hidden">
                        <div
                          className="h-full bg-[#156143] dark:bg-[#229A6B]"
                          style={{ width: `${progress}%` }}
                        />
                      </div>

                      <div className="pt-2 border-t border-[#E2DFD5] dark:border-[#25354C] flex flex-wrap gap-2">
                        <button
                          onClick={() => setSelectedTournamentId(t.id)}
                          className="flex-1 min-h-[42px] px-4 py-2 rounded-lg bg-[#156143] text-white text-xs sm:text-sm font-semibold whitespace-nowrap"
                        >
                          เข้าสู่รายการ
                        </button>
                        <button
                          onClick={() => setShareTournament(t)}
                          className="min-h-[42px] px-3 py-2 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] text-xs font-medium inline-flex items-center gap-1.5"
                        >
                          <Share2 className="w-4 h-4" />
                          <span>แชร์</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Responsive Pagination Bar */}
              <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center justify-between sm:justify-start gap-3 text-[#525C6B] dark:text-[#9AA8BC]">
                  <span className="font-mono tabular-nums">
                    แสดง <strong className="text-[#141D2B] dark:text-[#F3F5F8]">{startIndex}–{endIndex}</strong>{' '}
                    จาก <strong className="text-[#141D2B] dark:text-[#F3F5F8]">{dashboard.pagination.total}</strong> รายการ
                  </span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    aria-label="จำนวนรายการต่อหน้า"
                    className="min-h-[36px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs font-medium text-[#141D2B] dark:text-[#F3F5F8]"
                  >
                    <option value={5}>5 รายการ / หน้า</option>
                    <option value={10}>10 รายการ / หน้า</option>
                    <option value={20}>20 รายการ / หน้า</option>
                  </select>
                </div>

                <div className="flex items-center justify-center sm:justify-end gap-1.5">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="min-h-[38px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] disabled:opacity-40 inline-flex items-center gap-1 font-semibold hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>ก่อนหน้า</span>
                  </button>

                  {pageNumbers.map((pageNum, index) => (
                    <React.Fragment key={pageNum}>
                    {index > 0 && pageNum - pageNumbers[index - 1] > 1 && <span className="px-1 text-[#8A919C]">…</span>}
                    <button
                      type="button"
                      onClick={() => setCurrentPage(pageNum)}
                      className={`min-h-[38px] min-w-[38px] px-2 rounded-lg font-mono font-bold transition-colors ${
                        safePage === pageNum
                          ? 'bg-[#156143] text-white'
                          : 'border border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]'
                      }`}
                    >
                      {pageNum}
                    </button>
                    </React.Fragment>
                  ))}

                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="min-h-[38px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] disabled:opacity-40 inline-flex items-center gap-1 font-semibold hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
                  >
                    <span>ถัดไป</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* Create Tournament Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleCreateTournament}
            className="w-full max-w-lg max-h-[92vh] flex flex-col rounded-xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] shadow-xl overflow-hidden"
          >
            <div className="p-5 border-b border-[#E2DFD5] dark:border-[#25354C] flex items-center justify-between shrink-0">
              <h2 className="text-lg font-bold text-[#141D2B] dark:text-[#F3F5F8]">
                สร้างรายการแข่งขันใหม่
              </h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium mb-1">
                  ชื่อรายการแข่งขัน <span className="text-[#B91C1C]">*</span>
                </label>
                <input
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="เช่น แพร่ วินเทอร์ คัพ 2026"
                  className="w-full min-h-[44px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-sm"
                />
              </div>

              {/* Participant Capacity & Pricing Rule */}
              <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="create-max-participants" className="text-sm font-semibold">
                    จำนวนคนที่ต้องลงสมัคร <span className="text-[#B91C1C]">*</span>
                  </label>
                  <span className="text-[11px] font-medium text-[#156143] dark:text-[#4ADE80]">
                    ฟรี {FREE_PARTICIPANTS_LIMIT} คนแรก · คนที่ 21+ คนละ {EXTRA_PARTICIPANT_COST} บาท (Coin)
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="create-max-participants"
                    type="number"
                    required
                    min={1}
                    max={2000}
                    value={newMaxParticipants}
                    onChange={(e) => setNewMaxParticipants(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                    className="w-28 min-h-[42px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] font-mono tabular-nums text-sm font-bold"
                  />
                  <span className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">คน</span>
                  <div className="flex flex-wrap items-center gap-1.5 ml-auto">
                    {[20, 40, 60, 100].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setNewMaxParticipants(preset)}
                        className={`min-h-[34px] px-2.5 rounded-lg text-xs font-mono font-semibold border transition-colors ${
                          safeMaxParticipants === preset
                            ? 'bg-[#156143] text-white border-[#156143]'
                            : 'bg-white dark:bg-[#131E2E] border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]'
                        }`}
                      >
                        {preset} คน
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-2.5 border-t border-[#E2DFD5] dark:border-[#25354C] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="text-[#525C6B] dark:text-[#9AA8BC] space-y-0.5">
                    <div>
                      สิทธิ์ฟรี:{' '}
                      <strong className="font-mono tabular-nums text-[#141D2B] dark:text-[#F3F5F8]">
                        {Math.min(safeMaxParticipants, FREE_PARTICIPANTS_LIMIT)}
                      </strong>{' '}
                      คน · ส่วนเกิน:{' '}
                      <strong className="font-mono tabular-nums text-[#141D2B] dark:text-[#F3F5F8]">
                        {extraParticipantsCount.toLocaleString()}
                      </strong>{' '}
                      คน
                    </div>
                    <div className="inline-flex items-center gap-1">
                      <Coins className="w-3.5 h-3.5 text-[#B45309] dark:text-[#FBBF24]" />
                      <span>Coin คงเหลือ:</span>
                      <strong className="font-mono tabular-nums text-[#141D2B] dark:text-[#F3F5F8]">
                        {availableCoins.toLocaleString()} Coin
                      </strong>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">ค่าใช้จ่ายในการสร้าง</div>
                    <div
                      className={`text-sm font-bold font-mono tabular-nums ${
                        !hasEnoughCoinsForCreate
                          ? 'text-[#B91C1C] dark:text-[#FCA5A5]'
                          : createCostCoins === 0
                          ? 'text-[#156143] dark:text-[#4ADE80]'
                          : 'text-[#B45309] dark:text-[#FBBF24]'
                      }`}
                    >
                      {createCostCoins === 0
                        ? 'ฟรี (0 บาท / 0 Coin)'
                        : `${createCostCoins.toLocaleString()} บาท (${createCostCoins.toLocaleString()} Coin)`}
                    </div>
                  </div>
                </div>

                {!hasEnoughCoinsForCreate && (
                  <p className="text-xs font-semibold text-[#B91C1C] dark:text-[#FCA5A5]">
                    ยอด Coin ไม่เพียงพอสำหรับ {safeMaxParticipants.toLocaleString()} คน กรุณาลดจำนวนคนลง
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">สถานที่แข่งขัน</label>
                  <input
                    required
                    value={newVenue}
                    onChange={(e) => setNewVenue(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">ผู้จัดการแข่งขัน</label>
                  <input
                    value={newOrganizer}
                    onChange={(e) => setNewOrganizer(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">วันเริ่มแข่ง</label>
                  <input
                    type="date"
                    value={newStartDate}
                    onChange={(e) => setNewStartDate(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">วันสิ้นสุด</label>
                  <input
                    type="date"
                    value={newEndDate}
                    onChange={(e) => setNewEndDate(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">รายละเอียดเพิ่มเติม</label>
                <textarea
                  rows={2}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="ระบุรายละเอียดหรือหมายเหตุของรายการ"
                  className="w-full px-3 py-2 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-sm"
                />
              </div>
            </div>
            <div className="px-5 py-4 bg-[#F7F6F2] dark:bg-[#0B121C] border-t border-[#E2DFD5] dark:border-[#25354C] flex justify-end gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="min-h-[44px] px-4 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] text-sm font-medium"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={creating || !hasEnoughCoinsForCreate || safeMaxParticipants < 1}
                className="min-h-[44px] px-5 rounded-lg bg-[#156143] hover:bg-[#104D35] disabled:opacity-45 disabled:cursor-not-allowed text-white text-sm font-semibold"
              >
                {creating
                  ? 'กำลังสร้าง...'
                  : createCostCoins > 0
                  ? `สร้างรายการ (-${createCostCoins.toLocaleString()} Coin)`
                  : 'บันทึกสร้างรายการ'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Share Public Page Modal */}
      {shareTournament && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] shadow-xl p-6 space-y-4 text-center">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#141D2B] dark:text-[#F3F5F8]">
                แชร์หน้าสาธารณะ (Public View)
              </h3>
              <button
                onClick={() => setShareTournament(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm font-medium text-[#141D2B] dark:text-[#F3F5F8]">
              {shareTournament.name}
            </p>
            <div className="flex justify-center">
              <QRCodeMatrix value={sharePublicUrl} size={156} />
            </div>
            <div className="p-2.5 rounded-lg bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] text-xs font-mono break-all text-left">
              {sharePublicUrl}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(sharePublicUrl);
                  notify('success', 'คัดลอกลิงก์หน้าสาธารณะแล้ว');
                }}
                className="flex-1 min-h-[44px] rounded-lg border border-[#E2DFD5] dark:border-[#25354C] text-sm font-medium"
              >
                คัดลอกลิงก์
              </button>
              <button
                onClick={() => {
                  setShareTournament(null);
                  window.open(sharePublicUrl, '_blank', 'noopener,noreferrer');
                }}
                className="flex-1 min-h-[44px] rounded-lg bg-[#156143] text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5"
              >
                <ExternalLink className="w-4 h-4" />
                <span>เปิด Public View</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
