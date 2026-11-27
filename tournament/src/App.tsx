import React, { useEffect, useState } from 'react';
import {
  ChevronLeft,
  Coins,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  LogIn,
  LogOut,
  Mail,
  MoreHorizontal,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  QrCode,
  Radio,
  Sun,
  Trophy,
  X,
} from 'lucide-react';
import loginCourtImage from './assets/images/tournament-login-court.png';
import { ConfirmModal, QRCodeMatrix, ToastStack } from './components/common/UIPrimitives';
import { DirectorPortal } from './components/director/DirectorPortal';
import { TournamentCoinShopModal } from './components/level1/TournamentCoinShopModal';
import { TournamentListView } from './components/level1/TournamentListView';
import { TournamentShell } from './components/level2/TournamentShell';
import { PublicLiveScoreView } from './components/public/PublicLiveScoreView';
import { PublicPlayerStatusPage } from './components/public/PublicPlayerStatusPage';
import { PublicRegistrationPage } from './components/public/PublicRegistrationPage';
import { PublicDirectorApplicationPage } from './components/public/PublicDirectorApplicationPage';
import { AppProvider, useApp } from './context/AppContext';
import { apiFetch } from './services/api';

const TournamentLogin: React.FC<{
  onSuccess: () => Promise<void>;
  onDirector: () => void;
}> = ({ onSuccess, onDirector }) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <main className="min-h-[100dvh] bg-[#F7F6F2] text-[#142642] lg:grid lg:grid-cols-[minmax(0,1.04fr)_minmax(560px,0.96fr)]">
      <section className="relative min-h-[230px] overflow-hidden lg:min-h-[100dvh]" aria-label="LiveMatch Tournament">
        <img
          src={loginCourtImage}
          alt="สนามแบดมินตันในร่ม"
          className="absolute inset-0 h-full w-full object-cover object-[center_58%] lg:object-center"
        />
        <div className="relative flex min-h-[230px] items-start p-5 sm:p-8 lg:min-h-[100dvh] lg:items-center lg:px-[clamp(3rem,6vw,7rem)]">
          <div className="mt-1 max-w-[620px] rounded-xl bg-[#F7F6F2]/88 px-5 py-4 shadow-[0_14px_35px_rgba(20,38,66,0.08)] backdrop-blur-[2px] sm:px-7 sm:py-5 lg:mt-[-5vh] lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none">
            <div className="flex items-center gap-4 lg:gap-6">
              <Trophy className="h-12 w-12 shrink-0 text-[#156143] lg:h-[72px] lg:w-[72px]" strokeWidth={1.7} />
              <div className="border-l-[3px] border-[#D99116] pl-4 lg:pl-6">
                <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-[#142642] sm:text-3xl lg:text-[clamp(2.1rem,3vw,3.55rem)] lg:leading-[1.08]">
                  LiveMatch Tournament
                </h1>
                <p className="mt-1 text-sm font-medium text-[#5D6674] sm:text-base lg:mt-3 lg:text-[clamp(1.05rem,1.35vw,1.45rem)]">
                  ระบบจัดการแข่งขันแบดมินตัน
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="flex min-h-[calc(100dvh-230px)] items-center bg-[#FBFAF7] px-5 py-10 sm:px-10 lg:min-h-[100dvh] lg:px-[clamp(3.5rem,7vw,8rem)] lg:py-14">
        <div className="mx-auto w-full max-w-[560px]">
          <header className="mb-8 lg:mb-10">
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#156143]">Tournament control</p>
            <h2 className="w-fit border-b-4 border-[#D99116] pb-3 font-display text-[2.15rem] font-bold leading-tight tracking-[-0.025em] text-[#142642] sm:text-[2.65rem] lg:text-[3.4rem]">
              เข้าสู่ระบบ
            </h2>
            <p className="mt-5 text-[15px] leading-6 text-[#667085]">ใช้บัญชี Owner หรือ Tournament Staff เพื่อจัดการรายการแข่งขัน</p>
          </header>

          <form onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setMessage('');
            try {
              await apiFetch('/api/auth/tournament/login', {
                method: 'POST',
                body: JSON.stringify({ identifier, password, remember }),
              });
              await onSuccess();
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'เข้าสู่ระบบไม่สำเร็จ');
            } finally {
              setSaving(false);
            }
          }}>
            <label className="block text-[15px] font-bold text-[#142642]">
              อีเมล / Admin No. / Staff Number
              <span className="relative mt-2 block">
                <Mail aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#717B89]" strokeWidth={1.8} />
                <input
                  autoFocus
                  required
                  autoComplete="username"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder="เช่น owner@email.com หรือ 1001-T01"
                  className="h-[54px] w-full rounded-xl border border-[#BFC5CC] bg-white pl-12 pr-4 text-base font-medium text-[#142642] shadow-[0_1px_2px_rgba(20,38,66,0.04)] transition placeholder:text-[#A2A8B0] hover:border-[#7C8794] focus:border-[#156143] focus:outline-none focus:ring-4 focus:ring-[#156143]/12"
                />
              </span>
            </label>

            <label className="mt-5 block text-[15px] font-bold text-[#142642]">
              รหัสผ่าน / PIN
              <span className="relative mt-2 block">
                <LockKeyhole aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#717B89]" strokeWidth={1.8} />
                <input
                  required
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-[54px] w-full rounded-xl border border-[#BFC5CC] bg-white pl-12 pr-12 text-base font-medium text-[#142642] shadow-[0_1px_2px_rgba(20,38,66,0.04)] transition hover:border-[#7C8794] focus:border-[#156143] focus:outline-none focus:ring-4 focus:ring-[#156143]/12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-lg text-[#667085] transition hover:bg-[#EFECE4] hover:text-[#142642] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#156143]"
                  aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </span>
            </label>

            <div className="mt-4 flex items-center justify-between gap-4">
              <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-[#394457]">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                จดจำการเข้าสู่ระบบ
              </label>
              <a href={`${import.meta.env.VITE_MAIN_APP_URL || 'http://localhost:5173'}/?view=forgot-password`} className="text-sm font-bold text-[#156143] underline-offset-4 hover:underline">
                ลืมรหัสผ่าน?
              </a>
            </div>

            <div className="min-h-12 pt-4">
              {message && (
                <p role="alert" className="rounded-lg border border-[#F2C2C2] bg-[#FFF1F1] px-3 py-2 text-sm font-semibold text-[#A92323]">
                  {message}
                </p>
              )}
            </div>

            <button
              disabled={saving}
              className="flex h-[56px] w-full items-center justify-center gap-2.5 rounded-xl bg-[#156143] px-5 text-base font-bold text-white shadow-[0_7px_18px_rgba(21,97,67,0.18)] transition hover:bg-[#104D35] hover:shadow-[0_9px_22px_rgba(21,97,67,0.22)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#156143] active:translate-y-px disabled:cursor-wait disabled:opacity-60"
            >
              <LogIn className="h-5 w-5" />
              {saving ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
            </button>
          </form>

          <div className="mt-9 flex items-center gap-4" aria-hidden="true">
            <span className="h-px flex-1 bg-[#D8D5CC]" />
            <KeyRound className="h-5 w-5 text-[#156143]" />
            <span className="h-px flex-1 bg-[#D8D5CC]" />
          </div>
          <button
            type="button"
            onClick={onDirector}
            className="group mt-4 flex w-full items-center justify-center gap-3 rounded-xl px-4 py-3 text-[#142642] transition hover:bg-[#EFECE4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#156143]"
          >
            <span className="text-left">
              <span className="block text-base font-bold group-hover:text-[#156143]">สำหรับกรรมการสนาม</span>
              <span className="mt-0.5 block text-sm text-[#667085]">เข้าสู่ระบบกรรมการด้วยรหัส 12 หลัก</span>
            </span>
            <ChevronLeft className="h-5 w-5 rotate-180 text-[#156143] transition group-hover:translate-x-1" />
          </button>

          <p className="mt-8 text-center text-xs text-[#8A919C]">การเข้าสู่ระบบได้รับการปกป้องด้วย Secure Session</p>
        </div>
      </section>
    </main>
  );
};

const MainWorkspace: React.FC = () => {
  const {
    state,
    theme,
    toggleTheme,
    portalMode,
    setPortalMode,
    sidebarOpen,
    toggleSidebar,
    selectedTournamentId,
    setSelectedTournamentId,
    isPublicKiosk,
    switchRole,
    notify,
    loading,
    error,
    refreshState,
  } = useApp();

  const [showUmpireQrModal, setShowUmpireQrModal] = useState(false);
  const [showCoinShopModal, setShowCoinShopModal] = useState(false);
  const [showUtilityMenu, setShowUtilityMenu] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    // Director sessions are intentionally limited to the standalone umpire
    // portal. Do not leave a director inside the admin shell with silently
    // disabled controls such as Draw/Publish.
    if (
      portalMode === 'tournament_system' &&
      !loading &&
      !error &&
      state.activeUserRole === 'director'
    ) {
      setPortalMode('director_portal');
    }
  }, [error, loading, portalMode, setPortalMode, state.activeUserRole]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await apiFetch('/api/auth/tournament/logout', { method: 'POST' });
      setSelectedTournamentId(null);
      setPortalMode('tournament_system');
      await refreshState();
    } catch (logoutError) {
      notify(
        'error',
        logoutError instanceof Error ? logoutError.message : 'ออกจากระบบไม่สำเร็จ',
      );
    } finally {
      setLoggingOut(false);
    }
  };

  if (portalMode === 'tournament_system' && !loading && error) {
    return <TournamentLogin onSuccess={refreshState} onDirector={() => setPortalMode('director_portal')} />;
  }

  const umpireAppUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?mode=umpire`
      : 'https://livematch.th/?mode=umpire';
  // Standalone Fullscreen Umpire PWA — Completely separated from Main Web
  if (portalMode === 'director_portal') {
    return (
      <div className="min-h-[100dvh] bg-[#F7F6F2] dark:bg-[#0B121C] text-[#141D2B] dark:text-[#F3F5F8]">
        <DirectorPortal />
        <ConfirmModal />
        <ToastStack />
      </div>
    );
  }

  // Standalone Public Online Registration Page
  if (portalMode === 'public_register') {
    return (
      <div className="min-h-[100dvh] bg-[#F7F6F2] dark:bg-[#0B121C] text-[#141D2B] dark:text-[#F3F5F8]">
        <PublicRegistrationPage />
        <ToastStack />
      </div>
    );
  }

  if (portalMode === 'public_director') {
    return (
      <div className="min-h-[100dvh] bg-[#F7F6F2] dark:bg-[#0B121C] text-[#141D2B] dark:text-[#F3F5F8]">
        <PublicDirectorApplicationPage />
        <ToastStack />
      </div>
    );
  }

  // Standalone Public Player Status & Bracket Portal
  if (portalMode === 'public_status') {
    return (
      <div className="min-h-[100dvh] bg-[#F7F6F2] dark:bg-[#0B121C] text-[#141D2B] dark:text-[#F3F5F8]">
        <PublicPlayerStatusPage />
        <ToastStack />
      </div>
    );
  }

  // Standalone Chromeless Fullscreen Public Live Score PWA (No Header/Logo Chrome)
  if (portalMode === 'public_live' && isPublicKiosk) {
    return (
      <div className="min-h-[100dvh] bg-[#F7F6F2] dark:bg-[#0B121C] text-[#141D2B] dark:text-[#F3F5F8]">
        <PublicLiveScoreView />
        <ToastStack />
      </div>
    );
  }

  const selectedTournament =
    state.tournaments.find((t) => t.id === selectedTournamentId) || null;

  const isInsideTournament = portalMode === 'tournament_system' && selectedTournament !== null;

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F6F2] dark:bg-[#0B121C] text-[#141D2B] dark:text-[#F3F5F8] transition-colors">
      {/* Top Application Bar */}
      <header className="sticky top-0 z-40 h-14 bg-white/95 dark:bg-[#131E2E]/95 backdrop-blur-md border-b border-[#E2DFD5] dark:border-[#25354C] px-2.5 sm:px-5 lg:px-7 xl:px-8 no-print">
        <div className="relative w-full h-full flex items-center justify-between gap-1.5 sm:gap-4">
          {/* Zone 1: Left Navigation & Active Context */}
          <div className="flex flex-1 items-center gap-1 sm:gap-2.5 min-w-0">
            {isInsideTournament ? (
              <>
                {/* Sleek Desktop Sidebar Toggle */}
                <button
                  type="button"
                  onClick={toggleSidebar}
                  title={sidebarOpen ? 'ซ่อนแถบเมนู' : 'แสดงแถบเมนู'}
                  aria-label={sidebarOpen ? 'ซ่อนแถบเมนูด้านข้าง' : 'แสดงแถบเมนูด้านข้าง'}
                  className={`hidden xl:inline-flex items-center justify-center w-9 h-9 rounded-lg transition-colors shrink-0 ${
                    sidebarOpen
                      ? 'bg-[#156143]/10 text-[#156143] dark:bg-[#229A6B]/15 dark:text-[#4ADE80] hover:bg-[#156143]/15'
                      : 'text-[#525C6B] dark:text-[#9AA8BC] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D] hover:text-[#141D2B] dark:hover:text-white'
                  }`}
                >
                  {sidebarOpen ? (
                    <PanelLeftClose className="w-[18px] h-[18px]" />
                  ) : (
                    <PanelLeftOpen className="w-[18px] h-[18px]" />
                  )}
                </button>

                <span
                  aria-hidden="true"
                  className="hidden xl:block h-5 w-px bg-[#E2DFD5] dark:bg-[#25354C] shrink-0"
                />

                {/* Sleek Borderless Back Breadcrumb */}
                <button
                  type="button"
                  onClick={() => setSelectedTournamentId(null)}
                  className="group h-9 px-1 sm:px-2 -ml-1 lg:ml-0 rounded-lg text-xs font-semibold text-[#525C6B] dark:text-[#9AA8BC] hover:text-[#141D2B] dark:hover:text-white hover:bg-[#EFECE4]/80 dark:hover:bg-[#1B293D]/80 inline-flex items-center gap-1 transition-colors shrink-0"
                  aria-label="กลับหน้ารวมรายการแข่งขัน"
                >
                  <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
                  <span className="hidden sm:inline">รายการทั้งหมด</span>
                </button>

                <span
                  aria-hidden="true"
                  className="hidden sm:inline text-[#C9C4B5] dark:text-[#344966] text-sm select-none shrink-0"
                >
                  /
                </span>

                {/* Tournament Logo & Name replacing LiveMatch Tournament */}
                <div className="flex items-center gap-2 min-w-0 pl-0.5">
                  <img
                    src={selectedTournament.emblemUrl}
                    alt={selectedTournament.name}
                    referrerPolicy="no-referrer"
                    className="hidden sm:block w-8 h-8 rounded-lg object-cover ring-1 ring-black/10 dark:ring-white/10 shrink-0 bg-[#F7F6F2] dark:bg-[#0B121C]"
                  />
                  <span className="text-sm sm:text-base font-bold tracking-tight text-[#141D2B] dark:text-[#F3F5F8] truncate">
                    {selectedTournament.name}
                  </span>
                </div>
              </>
            ) : portalMode === 'public_live' ? (
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setPortalMode('tournament_system')}
                  className="group h-9 px-2.5 rounded-lg text-xs font-semibold text-[#525C6B] dark:text-[#9AA8BC] hover:text-[#141D2B] dark:hover:text-white hover:bg-[#EFECE4]/80 dark:hover:bg-[#1B293D]/80 inline-flex items-center gap-1 transition-colors shrink-0"
                >
                  <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
                  <span>กลับระบบจัดแข่ง</span>
                </button>
                <span aria-hidden="true" className="text-[#C9C4B5] dark:text-[#344966]">
                  /
                </span>
                <span className="text-sm sm:text-base font-bold tracking-tight truncate">
                  Public Live Score
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPortalMode('tournament_system');
                  setSelectedTournamentId(null);
                }}
                className="flex items-center gap-2 text-base sm:text-lg font-bold tracking-tight text-[#141D2B] dark:text-[#F3F5F8] whitespace-nowrap shrink-0"
              >
                <Trophy className="w-5 h-5 text-[#156143] dark:text-[#229A6B] shrink-0" />
                <span className="hidden sm:inline">LiveMatch Tournament</span>
              </button>
            )}
          </div>

          {/* Zone 3: Compact Utility Actions */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {isInsideTournament && (
              <>
                <span className="hidden xl:inline text-xs font-semibold text-[#667085] max-w-32 truncate">{state.activeUserName}</span>

                <button
                  type="button"
                  onClick={() => setPortalMode('public_live')}
                  title="Public Live Score"
                  aria-label="เปิด Public Live Score"
                  className="hidden lg:inline-flex min-h-[36px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D] text-xs font-semibold items-center gap-1.5"
                >
                  <Radio className="w-3.5 h-3.5 text-[#156143] dark:text-[#229A6B]" />
                  <span className="hidden md:inline">Live Score</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowUmpireQrModal(true)}
                  title="QR แอปกรรมการ (PWA)"
                  aria-label="QR แอปกรรมการ"
                  className="hidden lg:inline-flex min-h-[36px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D] text-xs font-semibold items-center gap-1.5"
                >
                  <QrCode className="w-3.5 h-3.5 text-[#156143] dark:text-[#229A6B]" />
                  <span className="hidden md:inline">QR กรรมการ</span>
                </button>
              </>
            )}

            {portalMode === 'tournament_system' && (
              <div
                title="ยอด Coin คงเหลือสำหรับสร้างรายการและขยายจำนวนผู้สมัคร"
                aria-label={`ยอดคงเหลือ ${(state.coinBalance ?? 0).toLocaleString()} Coin`}
                className="min-h-[36px] px-2 sm:px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap"
              >
                <Coins className="w-3.5 h-3.5 text-[#B45309] dark:text-[#FBBF24] shrink-0" />
                <span className="font-mono tabular-nums text-[#141D2B] dark:text-[#F3F5F8]">
                  {(state.coinBalance ?? 0).toLocaleString()}
                </span>
                <span className="hidden sm:inline text-[11px] font-medium text-[#525C6B] dark:text-[#9AA8BC]">
                  Coin
                </span>
              </div>
            )}
            {portalMode === 'tournament_system' && state.activeUserRole === 'owner' && (
              <button type="button" onClick={() => setShowCoinShopModal(true)} className="hidden lg:inline-flex min-h-[36px] px-2.5 rounded-lg bg-[#B45309] hover:bg-[#92400E] text-white items-center gap-1.5 text-xs font-bold" title="เติม Coin">
                <Coins className="w-3.5 h-3.5"/><span className="hidden sm:inline">เติม Coin</span>
              </button>
            )}

            <button
              onClick={toggleTheme}
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
              aria-label={theme === 'light' ? 'สลับเป็นโหมดกลางคืน' : 'สลับเป็นโหมดกลางวัน'}
              title={theme === 'light' ? 'Dark Mode' : 'Light Mode'}
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>

            {portalMode === 'tournament_system' && (
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="hidden lg:flex min-h-[36px] min-w-[36px] px-2.5 items-center justify-center gap-1.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] text-xs font-semibold text-[#525C6B] dark:text-[#9AA8BC] hover:border-[#B91C1C]/40 hover:bg-[#FEF2F2] hover:text-[#B91C1C] dark:hover:bg-[#361215] dark:hover:text-[#FCA5A5] disabled:cursor-wait disabled:opacity-60"
                aria-label="ออกจากระบบ"
                title="ออกจากระบบ"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span className="hidden md:inline">{loggingOut ? 'กำลังออก…' : 'ออกจากระบบ'}</span>
              </button>
            )}

            {portalMode === 'tournament_system' && (
              <button
                type="button"
                onClick={() => setShowUtilityMenu((open) => !open)}
                className="lg:hidden min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
                aria-label="เปิดเมนูเพิ่มเติม"
                aria-expanded={showUtilityMenu}
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            )}
          </div>

          {showUtilityMenu && portalMode === 'tournament_system' && (
            <div className="lg:hidden absolute right-0 top-14 z-[70] w-64 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-2 shadow-xl space-y-1">
              <div className="px-3 py-2 border-b border-[#E2DFD5] dark:border-[#25354C] mb-1">
                <div className="text-xs font-semibold truncate">{state.activeUserName}</div>
                <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">{state.activeUserRole}</div>
              </div>
              {isInsideTournament && (
                <>
                  <button type="button" onClick={() => { setShowUtilityMenu(false); setPortalMode('public_live'); }} className="topbar-menu-item"><Radio className="w-4 h-4" />Public Live Score</button>
                  <button type="button" onClick={() => { setShowUtilityMenu(false); setShowUmpireQrModal(true); }} className="topbar-menu-item"><QrCode className="w-4 h-4" />QR แอปกรรมการ</button>
                </>
              )}
              {state.activeUserRole === 'owner' && <button type="button" onClick={() => { setShowUtilityMenu(false); setShowCoinShopModal(true); }} className="topbar-menu-item"><Coins className="w-4 h-4" />เติม Coin</button>}
              <button type="button" onClick={() => { setShowUtilityMenu(false); void handleLogout(); }} disabled={loggingOut} className="topbar-menu-item text-[#B91C1C] dark:text-[#FCA5A5]"><LogOut className="w-4 h-4" />{loggingOut ? 'กำลังออกจากระบบ…' : 'ออกจากระบบ'}</button>
            </div>
          )}
        </div>
      </header>

      {/* Main View Router */}
      <div className="flex-1">
        {portalMode === 'public_live' && <PublicLiveScoreView />}
        {portalMode === 'tournament_system' &&
          (selectedTournament ? (
            <TournamentShell tournament={selectedTournament} />
          ) : (
            <TournamentListView />
          ))}
      </div>

      {showCoinShopModal && (
        <TournamentCoinShopModal
          onClose={() => setShowCoinShopModal(false)}
          onUpdated={refreshState}
        />
      )}

      {/* Standalone Umpire PWA QR Modal */}
      {showUmpireQrModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] shadow-xl p-6 space-y-4 text-center">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">สแกน QR เข้าแอปกรรมการ (PWA แยก)</h3>
              <button
                onClick={() => setShowUmpireQrModal(false)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
                aria-label="ปิด"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
              สแกนด้วยมือถือหรือแท็บเล็ตเพื่อเปิดเว็บแอปกรรมการแบบเต็มจอแยกออกจากระบบจัดการหลัก (ติดตั้งลงหน้าจอโฮมได้)
            </p>
            <div className="flex justify-center">
              <QRCodeMatrix value={umpireAppUrl} size={168} />
            </div>
            <div className="p-2.5 rounded-lg bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] text-[11px] font-mono truncate">
              {umpireAppUrl}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(umpireAppUrl);
                  notify('success', 'คัดลอกลิงก์แอปกรรมการแล้ว');
                }}
                className="flex-1 min-h-[44px] rounded-xl border border-[#E2DFD5] dark:border-[#25354C] text-xs font-semibold"
              >
                คัดลอกลิงก์
              </button>
              <a
                href="/?mode=umpire"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setShowUmpireQrModal(false)}
                className="flex-1 min-h-[44px] rounded-xl bg-[#156143] hover:bg-[#104D35] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
              >
                <ExternalLink className="w-4 h-4" />
                <span>เปิดเว็บแยก</span>
              </a>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal />
      <ToastStack />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainWorkspace />
    </AppProvider>
  );
}
