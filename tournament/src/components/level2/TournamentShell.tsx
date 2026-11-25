import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  GitBranch,
  Home,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Tournament } from '../../types/tournament';
import { StatusIndicator } from '../common/UIPrimitives';
import { getStatusTone } from '../level1/TournamentListView';
import { ApprovalAndPaymentView } from './ApprovalAndPaymentView';
import { MemberView } from './MemberView';
import { ReportView } from './ReportView';
import { TournamentDrawView } from './TournamentDrawView';
import { TournamentHomeView } from './TournamentHomeView';
import { TournamentSettingView } from './TournamentSettingView';

export type Level2Tab = 'home' | 'tournament' | 'member' | 'approval' | 'report' | 'setting';

const LEVEL_2_TABS: Level2Tab[] = ['home', 'tournament', 'member', 'approval', 'report', 'setting'];

function tabFromUrl(): Level2Tab {
  if (typeof window === 'undefined') return 'home';
  const value = new URLSearchParams(window.location.search).get('view') as Level2Tab | null;
  return value && LEVEL_2_TABS.includes(value) ? value : 'home';
}

export const TournamentShell: React.FC<{ tournament: Tournament }> = ({ tournament }) => {
  const { state, sidebarOpen } = useApp();

  const [tab, setTab] = useState<Level2Tab>(tabFromUrl);

  const navigate = useCallback((nextTab: Level2Tab) => {
    setTab(nextTab);
    const params = new URLSearchParams(window.location.search);
    params.set('view', nextTab);
    if (nextTab !== 'setting') params.delete('settingSection');
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
  }, []);

  useEffect(() => {
    setTab(tabFromUrl());
  }, [tournament.id]);

  const applicantCount = state.players.filter(
    (p) => p.tournamentId === tournament.id && !p.withdrawn
  ).length;

  const pendingPlayersCount = state.players.filter(
    (p) => p.tournamentId === tournament.id && !p.withdrawn && p.documentStatus === 'pending'
  ).length;
  const pendingDirectorsCount = state.umpires.filter(
    (u) => u.tournamentId === tournament.id && (u.approvalStatus || 'approved') === 'pending'
  ).length;
  const pendingPaymentsCount = state.players.filter(
    (p) =>
      p.tournamentId === tournament.id &&
      !p.withdrawn &&
      p.registrationSource === 'online' &&
      p.paymentStatus === 'pending_verify'
  ).length;
  const totalApprovalBadge = pendingPlayersCount + pendingDirectorsCount + pendingPaymentsCount;

  const navItems: {
    id: Level2Tab;
    label: string;
    shortLabel: string;
    icon: React.ReactNode;
    badge?: number;
  }[] = [
    { id: 'home', label: 'หน้าหลัก (Home)', shortLabel: 'Home', icon: <Home className="w-4 h-4" /> },
    {
      id: 'tournament',
      label: 'สายแข่งขัน (Tournament)',
      shortLabel: 'สายแข่ง',
      icon: <GitBranch className="w-4 h-4" />,
    },
    { id: 'member', label: 'สมาชิก & กรรมการ', shortLabel: 'สมาชิก', icon: <Users className="w-4 h-4" /> },
    {
      id: 'approval',
      label: 'อนุมัติ & ตรวจชำระเงิน',
      shortLabel: 'อนุมัติ',
      icon: <ShieldCheck className="w-4 h-4" />,
      badge: totalApprovalBadge,
    },
    { id: 'report', label: 'รายงาน (Report)', shortLabel: 'รายงาน', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'setting', label: 'ตั้งค่ารายการ', shortLabel: 'ตั้งค่า', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-[calc(100dvh-56px)] flex flex-col xl:flex-row">
      {/* Desktop Sidebar */}
      <aside
        aria-hidden={!sidebarOpen}
        className={`hidden xl:flex xl:flex-col xl:sticky xl:top-14 xl:h-[calc(100dvh-56px)] xl:shrink-0 bg-white dark:bg-[#131E2E] overflow-hidden transition-[width,opacity,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          sidebarOpen
            ? 'xl:w-64 opacity-100 border-r border-[#E2DFD5] dark:border-[#25354C]'
            : 'xl:w-0 opacity-0 border-r-0 pointer-events-none'
        }`}
      >
        <div
          className={`w-64 h-full min-h-0 flex flex-col justify-between p-3.5 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            sidebarOpen ? 'translate-x-0 opacity-100' : '-translate-x-4 opacity-0'
          }`}
        >
          <nav className="space-y-1 overflow-y-auto overscroll-contain pr-1" aria-label="เมนูภายในรายการแข่งขัน">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => navigate(item.id)}
                className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-lg text-sm font-medium flex items-center justify-between gap-2 transition-colors ${
                  tab === item.id
                    ? 'bg-[#156143] text-white'
                    : 'text-[#141D2B] dark:text-[#F3F5F8] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </span>
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span
                    className={`px-1.5 py-0.5 rounded font-mono text-[11px] font-bold shrink-0 ${
                      tab === item.id
                        ? 'bg-white/20 text-white'
                        : 'bg-[#FEF9C3] text-[#713F12] dark:bg-[#332409] dark:text-[#FACC15]'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="pt-4 border-t border-[#E2DFD5] dark:border-[#25354C] space-y-2 text-xs text-[#525C6B] dark:text-[#9AA8BC]">
            <StatusIndicator tone={getStatusTone(tournament.status)} label={tournament.status} compact />
            <div>รุ่นที่เปิด: {tournament.divisions.filter((d) => d.enabled).length} ระดับมือ</div>
            <div>ผู้สมัคร: {applicantCount} ทีม/คน</div>
            <div>สายเวอร์ชัน: v{tournament.bracketVersion}</div>
          </div>
        </div>
      </aside>

      {/* Mobile navigation stays below the topbar and never covers page actions. */}
      <nav
        className="xl:hidden sticky top-14 z-30 min-h-[52px] bg-white/95 dark:bg-[#131E2E]/95 backdrop-blur-md border-b border-[#E2DFD5] dark:border-[#25354C] overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="เมนูภายในรายการแข่งขัน"
      >
        <div className="flex min-w-max px-3 py-1.5 gap-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              aria-current={tab === item.id ? 'page' : undefined}
              className={`relative min-h-[40px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                tab === item.id
                  ? 'bg-[#156143] text-white shadow-sm'
                  : 'text-[#525C6B] dark:text-[#9AA8BC] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]'
              }`}
            >
              <span className="relative">
                {item.icon}
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span className="absolute -top-2 -right-2 min-w-[15px] h-[15px] px-1 rounded-full bg-[#D97706] text-white font-mono text-[9px] flex items-center justify-center">
                    {item.badge}
                  </span>
                )}
              </span>
              <span>{item.shortLabel}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Main Content Column */}
      <div className="flex-1 min-w-0 flex flex-col pb-[max(1.5rem,env(safe-area-inset-bottom))] xl:pb-8">
        {/* Active Level 2 Page */}
        <main className="flex-1 w-full min-w-0 px-3 sm:px-5 lg:px-7 xl:px-8 py-4 sm:py-5 overflow-x-clip">
          {tab === 'home' && <TournamentHomeView tournament={tournament} onNavigate={navigate} />}
          {tab === 'tournament' && <TournamentDrawView tournament={tournament} />}
          {tab === 'member' && <MemberView tournament={tournament} />}
          {tab === 'approval' && <ApprovalAndPaymentView tournament={tournament} />}
          {tab === 'report' && <ReportView tournament={tournament} />}
          {tab === 'setting' && <TournamentSettingView tournament={tournament} />}
        </main>
      </div>

    </div>
  );
};
