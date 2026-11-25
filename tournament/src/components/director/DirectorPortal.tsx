import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  Award,
  CheckCircle2,
  ChevronRight,
  Clock,
  Flag,
  HeartPulse,
  KeyRound,
  Lock,
  LogOut,
  Maximize2,
  Minimize2,
  Minus,
  Moon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  Sun,
  Trophy,
  UserCheck,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { PWAInstallButton } from '../../hooks/usePWAInstall';
import {
  ApiError,
  apiFetch,
  flushOfflineScoreQueue,
  getOfflineScoreQueue,
  pushOfflineScoreAction,
} from '../../services/api';
import { DirectorUmpire, MatchRecord } from '../../types/tournament';
import {
  applyBadmintonPoint,
  applyManualServerPlayerSwap,
  applyManualTeamServeToggle,
  createSnapshotForUndo,
  getActiveCourtState,
  getMatchOutcomeByRules,
  getSetWinnerByRules,
} from '../../utils/badmintonRules';
import { buildTeamLogoMap, EmptyStateCard, StatusIndicator, TeamLogoBadge } from '../common/UIPrimitives';

export const DirectorPortal: React.FC = () => {
  const { state, theme, toggleTheme, refreshState, applyOptimisticMatch, notify } = useApp();
  const teamLogos = useMemo(() => buildTeamLogoMap(state.players), [state.players]);
  const getTeamLogo = (teamId: string, teamName: string) =>
    teamLogos[teamId] || teamLogos[teamName];

  // Pre-fill ?code=... from scanned per-umpire QR without exposing tournament data before login
  const [codeInput, setCodeInput] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const qCode = params.get('code');
      if (qCode) return qCode.replace(/\D/g, '').slice(0, 12);
    }
    return '';
  });
  const [hasQrCodeParam] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return Boolean(new URLSearchParams(window.location.search).get('code'));
    }
    return false;
  });

  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [authedUmpire, setAuthedUmpire] = useState<DirectorUmpire | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  // Assigned list filters
  const [dateFilter, setDateFilter] = useState(() =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  );
  const [statusFilter, setStatusFilter] = useState<'all' | 'upcoming' | 'live' | 'finished'>('all');
  const [activeMatchId, setActiveMatchId] = useState<string | null>(() =>
    localStorage.getItem('lm_director_active_match')
  );

  // Native Fullscreen toggle
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Network & Offline Queue
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [simOffline, setSimOffline] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'online' | 'offline' | 'syncing'>('online');
  const [pendingCount, setPendingCount] = useState<number>(() => getOfflineScoreQueue().length);
  const lastTapRef = useRef<number>(0);

  // Bottom Sheet Drawer for Secondary Court Events & Timeline
  const [showToolsSheet, setShowToolsSheet] = useState(false);

  // Modals for Card / End Match Confirmation
  const [showCardModal, setShowCardModal] = useState(false);
  const [cardTeam, setCardTeam] = useState<'A' | 'B'>('A');
  const [cardType, setCardType] = useState<'yellow' | 'red' | 'black'>('yellow');
  const [cardReason, setCardReason] = useState('ถ่วงเวลาการแข่งขัน');

  const [showEndSetModal, setShowEndSetModal] = useState(false);
  const [endSetSubmitting, setEndSetSubmitting] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [finishSpecialStatus, setFinishSpecialStatus] = useState<
    'finished' | 'walkover' | 'retired'
  >('finished');
  const [finishWinner, setFinishWinner] = useState<'A' | 'B' | 'draw'>('A');
  const [umpireNote, setUmpireNote] = useState('');

  // Prompt Court Selection when match has no courtId assigned
  const [courtPromptMatch, setCourtPromptMatch] = useState<MatchRecord | null>(null);
  const [courtPromptId, setCourtPromptId] = useState<string>('');
  const [courtPromptSaving, setCourtPromptSaving] = useState(false);

  // Generic Confirmation Modal for ALL non-point actions in Umpire Scoring View
  const [pendingActionConfirm, setPendingActionConfirm] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    tone?: 'primary' | 'warning' | 'danger';
    onConfirm: () => Promise<unknown> | void;
  } | null>(null);

  const effectiveOnline = isOnline && !simOffline;

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, []);

  useEffect(() => {
    apiFetch<{ umpire: DirectorUmpire }>('/api/director/me')
      .then(async ({ umpire }) => {
        setAuthedUmpire(umpire);
        await refreshState();
      })
      .catch(() => setAuthedUmpire(null))
      .finally(() => setCheckingSession(false));
  }, [refreshState]);

  useEffect(() => {
    if (!authedUmpire) return;
    const stream = new EventSource('/api/auth/tournament/director/events', { withCredentials: true });
    stream.addEventListener('match_update', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { match: MatchRecord };
        applyOptimisticMatch(payload.match);
      } catch {
        // Ignore malformed frames and continue receiving the stream.
      }
    });
    return () => stream.close();
  }, [authedUmpire, applyOptimisticMatch]);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // iOS Safari standalone PWA already runs fullscreen; ignore unsupported desktop API calls
    }
  };

  // Auto-flush offline queue when back online
  useEffect(() => {
    if (!effectiveOnline) {
      setSyncStatus('offline');
      return;
    }
    const queue = getOfflineScoreQueue();
    if (queue.length > 0) {
      setSyncStatus('syncing');
      flushOfflineScoreQueue()
        .then(async (flushed) => {
          setPendingCount(getOfflineScoreQueue().length);
          setSyncStatus('online');
          if (flushed > 0) {
            await refreshState();
            notify('success', `ซิงค์คะแนนที่ค้างอยู่ในเครื่องสำเร็จ (${flushed} เหตุการณ์)`);
          }
        })
        .catch(() => setSyncStatus('offline'));
    } else {
      setSyncStatus('online');
    }
  }, [effectiveOnline, refreshState, notify]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const res = await apiFetch<{ umpire: DirectorUmpire }>('/api/auth/tournament/director/login', {
        method: 'POST',
        body: JSON.stringify({ code: codeInput }),
      });
      setAuthedUmpire(res.umpire);
      await refreshState();
      notify('success', `เข้าสู่ระบบกรรมการ: ${res.umpire.firstName} ${res.umpire.lastName}`);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/tournament/director/logout', { method: 'POST' });
    } catch {
      // Clear local state even when the server session already expired.
    }
    setAuthedUmpire(null);
    setActiveMatchId(null);
    localStorage.removeItem('lm_director_active_match');
  };

  const assignedMatches = useMemo(() => {
    if (!authedUmpire) return [];
    return state.matches.filter((m) => {
      if (m.umpireId !== authedUmpire.id) return false;
      // คู่ที่ยังไม่ได้กำหนดวันต้องแสดงให้กรรมการเห็นเสมอ ไม่ควรนำวันเริ่มรายการ
      // มาแทน เพราะจะทำให้งานที่เพิ่งมอบหมายหายไปจากตัวกรอง "วันนี้"
      if (dateFilter && m.scheduledDate && m.scheduledDate !== dateFilter) return false;
      if (statusFilter === 'upcoming' && m.status !== 'scheduled' && m.status !== 'calling')
        return false;
      if (
        statusFilter === 'live' &&
        m.status !== 'live' &&
        m.status !== 'interval' &&
        m.status !== 'suspended'
      )
        return false;
      if (
        statusFilter === 'finished' &&
        m.status !== 'finished' &&
        m.status !== 'walkover' &&
        m.status !== 'retired'
      )
        return false;
      return true;
    });
  }, [authedUmpire, state.matches, state.tournaments, statusFilter, dateFilter]);

  const activeMatch = useMemo(
    () => state.matches.find((m) => m.id === activeMatchId) || null,
    [state.matches, activeMatchId]
  );

  // Send score/match event with double-tap guard + optimistic UI + offline fallback
  const dispatchMatchEvent = async (
    match: MatchRecord,
    type: string,
    payload?: Record<string, unknown>
  ): Promise<boolean> => {
    const now = Date.now();
    if ((type === 'point_A' || type === 'point_B') && now - lastTapRef.current < 220) {
      return false;
    }
    lastTapRef.current = now;

    let apiType = type;
    let apiPayload: Record<string, unknown> | undefined = payload ? { ...payload } : undefined;
    if (type === 'toggle_server' || type === 'toggle_server_player') {
      const reason = window.prompt('ระบุเหตุผลที่ต้องแก้ไขลำดับการเสิร์ฟ (Correction Audit)');
      if (!reason?.trim()) {
        notify('warning', 'ยกเลิกการแก้ไขผู้เสิร์ฟ เนื่องจากไม่ได้ระบุเหตุผล');
        return false;
      }
      const nextTeam = type === 'toggle_server'
        ? (match.servingTeam === 'A' ? 'B' : 'A')
        : (payload?.team === 'B' ? 'B' : payload?.team === 'A' ? 'A' : match.servingTeam);
      apiType = 'correction_serve';
      apiPayload = {
        team: nextTeam,
        playerIndex: type === 'toggle_server_player' ? (match.servingPlayerIndex === 0 ? 1 : 0) : match.servingPlayerIndex,
        reason: reason.trim(),
      };
    }

    const eventId = `ev-${now}-${Math.random().toString(36).slice(2, 6)}`;
    const actorName = authedUmpire
      ? `${authedUmpire.firstName} ${authedUmpire.lastName}`
      : 'Umpire';
    const timeStr = new Date().toTimeString().slice(0, 8);
    const tourney = state.tournaments.find((t) => t.id === match.tournamentId);

    const optimistic = structuredClone(match);
    if (optimistic.sets.length === 0) {
      optimistic.sets = [{ setNumber: 1, scoreA: 0, scoreB: 0 }];
      optimistic.currentSet = 1;
    }
    const activeSet = optimistic.sets[optimistic.currentSet - 1] || optimistic.sets[0];

    if (type === 'point_A' || type === 'point_B') {
      const scoringTeam: 'A' | 'B' = type === 'point_A' ? 'A' : 'B';
      const teamName = scoringTeam === 'A' ? optimistic.teamAName : optimistic.teamBName;
      const undoSnapshot = createSnapshotForUndo(optimistic);
      const info = applyBadmintonPoint(optimistic, scoringTeam);
      const boxLabel = info.serviceBox === 'right' ? 'คอร์ทขวา' : 'คอร์ทซ้าย';
      optimistic.timeline = [
        {
          id: eventId,
          timestamp: timeStr,
          setNumber: optimistic.currentSet,
          type,
          scoreSnapshot: `${activeSet.scoreA} - ${activeSet.scoreB}`,
          detail: `+1 ${teamName} (${info.wasServiceOver ? 'ได้เสิร์ฟใหม่' : 'รักษาเสิร์ฟ'} · ${boxLabel}${info.serverName ? ` · ${info.serverName}` : ''})`,
          actor: actorName,
          undoSnapshot,
        },
        ...optimistic.timeline,
      ];
    } else if (type === 'undo') {
      const idx = optimistic.timeline.findIndex(
        (ev) =>
          ev.setNumber === optimistic.currentSet &&
          (ev.type === 'point_A' || ev.type === 'point_B' || ev.type === 'serve_change')
      );
      if (idx >= 0) {
        const targetEv = optimistic.timeline[idx];
        if (targetEv.undoSnapshot) {
          optimistic.status = targetEv.undoSnapshot.status;
          activeSet.scoreA = targetEv.undoSnapshot.scoreA;
          activeSet.scoreB = targetEv.undoSnapshot.scoreB;
          optimistic.servingTeam = targetEv.undoSnapshot.servingTeam;
          optimistic.servingPlayerIndex = targetEv.undoSnapshot.servingPlayerIndex;
          optimistic.courtPositions = {
            A: [...targetEv.undoSnapshot.courtPositions.A] as [0 | 1, 0 | 1],
            B: [...targetEv.undoSnapshot.courtPositions.B] as [0 | 1, 0 | 1],
          };
          optimistic.manualServerSwaps = structuredClone(
            targetEv.undoSnapshot.manualServerSwaps
          );
        } else if (targetEv.type === 'point_A' && activeSet.scoreA > 0) {
          activeSet.scoreA -= 1;
        } else if (targetEv.type === 'point_B' && activeSet.scoreB > 0) {
          activeSet.scoreB -= 1;
        }
        optimistic.timeline.splice(idx, 1);
      }
    } else if (type === 'change_ends') {
      optimistic.endsSwapped = !optimistic.endsSwapped;
    } else if (type === 'shuttle_add') {
      optimistic.shuttlesUsed = (optimistic.shuttlesUsed || 0) + 1;
    } else if (type === 'shuttle_remove') {
      optimistic.shuttlesUsed = Math.max(0, (optimistic.shuttlesUsed || 0) - 1);
    } else if (type === 'toggle_server') {
      const undoSnapshot = createSnapshotForUndo(optimistic);
      applyManualTeamServeToggle(optimistic);
      optimistic.timeline = [
        {
          id: eventId,
          timestamp: timeStr,
          setNumber: optimistic.currentSet,
          type: 'serve_change',
          scoreSnapshot: `${activeSet.scoreA} - ${activeSet.scoreB}`,
          detail: `สลับทีมเสิร์ฟเป็นทีม ${optimistic.servingTeam}`,
          actor: actorName,
          undoSnapshot,
        },
        ...optimistic.timeline,
      ];
    } else if (type === 'toggle_server_player') {
      const undoSnapshot = createSnapshotForUndo(optimistic);
      const targetTeam = payload?.team === 'A' || payload?.team === 'B' ? payload.team : undefined;
      const swapRes = applyManualServerPlayerSwap(optimistic, targetTeam);
      if (!swapRes.ok) {
        notify('warning', swapRes.error);
        return false;
      }
      optimistic.timeline = [
        {
          id: eventId,
          timestamp: timeStr,
          setNumber: optimistic.currentSet,
          type: 'serve_change',
          scoreSnapshot: `${activeSet.scoreA} - ${activeSet.scoreB}`,
          detail: `สลับคนเสิร์ฟทีม ${swapRes.swappedTeam} (${swapRes.serverName}) · ใช้สิทธิ์ 1/1 ของเซต ${optimistic.currentSet}`,
          actor: actorName,
          undoSnapshot,
        },
        ...optimistic.timeline,
      ];
    } else if (type === 'end_set') {
      const setWinner = getSetWinnerByRules(
        activeSet.scoreA,
        activeSet.scoreB,
        tourney?.scoringRules
      );
      if (!setWinner) {
        notify(
          'warning',
          `คะแนน ${activeSet.scoreA}–${activeSet.scoreB} ยังไม่ครบเงื่อนไขจบเซตตามกติกาที่ตั้งไว้`
        );
        return false;
      }
      activeSet.winner = setWinner;
      const bestOfSets = tourney?.scoringRules.bestOfSets || 3;
      const optWinsA = optimistic.sets.filter((s) => s.winner === 'A').length;
      const optWinsB = optimistic.sets.filter((s) => s.winner === 'B').length;
      const completedSetCount = optimistic.sets.filter((s) => Boolean(s.winner)).length;
      const shouldAdvanceSet =
        bestOfSets === 2
          ? completedSetCount < 2 ||
            (completedSetCount === 2 && optWinsA === optWinsB && optimistic.stage !== 'group')
          : bestOfSets === 3
          ? optWinsA < 2 && optWinsB < 2
          : false;
      if (shouldAdvanceSet) {
        optimistic.currentSet += 1;
        if (!optimistic.sets[optimistic.currentSet - 1]) {
          optimistic.sets.push({
            setNumber: optimistic.currentSet,
            scoreA: 0,
            scoreB: 0,
          });
        }
        optimistic.endsSwapped = !optimistic.endsSwapped;
        if (activeSet.winner) {
          optimistic.servingTeam = activeSet.winner;
        }
        optimistic.servingPlayerIndex = 0;
        optimistic.courtPositions = { A: [0, 1], B: [0, 1] };
        optimistic.manualServerSwaps = {
          ...(optimistic.manualServerSwaps || {}),
          [String(optimistic.currentSet)]: { A: false, B: false },
        };
      }
    }

    applyOptimisticMatch(optimistic);

    if (!effectiveOnline) {
      pushOfflineScoreAction({
        matchId: match.id,
        eventId,
        type: apiType,
        payload: apiPayload,
        createdAt: new Date().toISOString(),
        expectedVersion: match.version,
      });
      setPendingCount(getOfflineScoreQueue().length);
      setSyncStatus('offline');
      return true;
    }

    try {
      const res = await apiFetch<{ match: MatchRecord }>(`/api/director/matches/${match.id}/event`, {
        method: 'POST',
        body: JSON.stringify({ eventId, type: apiType, payload: apiPayload, expectedVersion: match.version }),
      });
      applyOptimisticMatch(res.match);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        if (err.status === 409 && err.data.code === 'version_conflict' && err.data.match) {
          applyOptimisticMatch(err.data.match as MatchRecord);
          notify('warning', 'คะแนนเปลี่ยนจากอุปกรณ์อื่น ระบบโหลดสถานะล่าสุดแล้ว กรุณาตรวจสอบก่อนบันทึกอีกครั้ง');
          return false;
        }
        // Revert optimistic update cleanly on deterministic validation rejection (e.g. 409)
        applyOptimisticMatch(match);
        notify('warning', err.message);
        return false;
      }
      pushOfflineScoreAction({
        matchId: match.id,
        eventId,
        type: apiType,
        payload: apiPayload,
        createdAt: new Date().toISOString(),
        expectedVersion: match.version,
      });
      setPendingCount(getOfflineScoreQueue().length);
      notify('warning', err instanceof Error ? err.message : 'บันทึกคิวออฟไลน์ชั่วคราว');
      return true;
    }
  };

  const startAssignedMatch = async (match: MatchRecord) => {
    const enteredTeam = window.prompt(
      `ทีมใดเป็นฝ่ายเสิร์ฟก่อน?\nA = ${match.teamAName}\nB = ${match.teamBName}`,
      'A'
    );
    if (enteredTeam === null) return;
    const serverTeam = enteredTeam.trim().toUpperCase();
    if (serverTeam !== 'A' && serverTeam !== 'B') {
      notify('warning', 'กรุณาระบุ A หรือ B สำหรับฝ่ายเสิร์ฟก่อน');
      return;
    }
    const players = serverTeam === 'A' ? match.teamAPlayers : match.teamBPlayers;
    let serverPlayerIndex: 0 | 1 = 0;
    if (players.length > 1) {
      const enteredPlayer = window.prompt(
        `เลือกผู้เสิร์ฟคนแรกของทีม ${serverTeam}\n1 = ${players[0]}\n2 = ${players[1]}`,
        '1'
      );
      if (enteredPlayer === null) return;
      if (enteredPlayer.trim() !== '1' && enteredPlayer.trim() !== '2') {
        notify('warning', 'กรุณาระบุหมายเลขผู้เสิร์ฟ 1 หรือ 2');
        return;
      }
      serverPlayerIndex = enteredPlayer.trim() === '2' ? 1 : 0;
    }
    await dispatchMatchEvent(match, 'start_match', { serverTeam, serverPlayerIndex });
  };

  // =====================================================================
  // VIEW 1: PRE-AUTH FULLSCREEN MOBILE APP LOGIN (No tournament leak)
  // =====================================================================
  if (checkingSession) {
    return <div className="min-h-[100dvh] flex items-center justify-center bg-[#F7F6F2] dark:bg-[#0B121C] text-sm font-semibold">กำลังตรวจสอบ session กรรมการ...</div>;
  }

  if (!authedUmpire) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-[#F7F6F2] dark:bg-[#0B121C] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        {/* Native Mobile App Header */}
        <header className="h-[52px] px-4 bg-[#142642] text-white flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#156143] flex items-center justify-center shrink-0">
              <Trophy className="w-4 h-4 text-[#FACC15]" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold leading-tight truncate">LM Umpire</div>
              <div className="text-[10px] text-white/75 truncate">แอปกรรมการสนาม (Standalone PWA)</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <PWAInstallButton compact />
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label="เต็มจอ"
              className="min-h-[36px] min-w-[36px] rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="สลับธีม"
              className="min-h-[36px] min-w-[36px] rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center"
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Centered Mobile Login Card */}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] shadow-lg p-6 space-y-5">
            <div className="flex items-center gap-3.5">
              <div className="p-3.5 rounded-2xl bg-[#156143] text-white shrink-0">
                <KeyRound className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-lg font-bold">เข้าสู่ระบบกรรมการตัดสิน</h1>
                <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC] mt-0.5">
                  กรอกรหัสประจำตัวกรรมการ 12 หลัก หรือสแกน QR ประจำตัว
                </p>
              </div>
            </div>

            {hasQrCodeParam && codeInput.length === 12 && (
              <div className="p-3 rounded-xl bg-[#ECFDF5] dark:bg-[#0D2E20] border border-[#A7F3D0] dark:border-[#1E5C40] text-xs text-[#156143] dark:text-[#4ADE80] flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>สแกน QR สำเร็จ — กรุณากดยืนยันรหัสเพื่อปลดล็อกตารางตัดสินของคุณ</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="director-code-12" className="block text-xs font-semibold mb-1.5">
                  รหัสเข้าสู่ระบบ 12 หลัก
                </label>
                <input
                  id="director-code-12"
                  type="text"
                  inputMode="numeric"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.replace(/[^\d-]/g, '').slice(0, 14))}
                  placeholder="กรอกรหัสตัวเลข 12 หลัก"
                  className="w-full min-h-[58px] px-4 rounded-xl border-2 border-[#E2DFD5] dark:border-[#25354C] focus:border-[#156143] bg-[#F7F6F2] dark:bg-[#0B121C] font-mono text-xl font-bold tracking-[0.18em] text-center outline-none"
                />
              </div>

              {loginError && (
                <div className="p-3 rounded-xl bg-[#FEF2F2] dark:bg-[#361215] border border-[#FECACA] dark:border-[#5E2025] text-xs text-[#B91C1C] dark:text-[#F87171] flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>{loginError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loginLoading || codeInput.replace(/\D/g, '').length < 12}
                className="w-full min-h-[54px] rounded-xl bg-[#156143] hover:bg-[#104D35] active:scale-[0.99] text-white text-base font-bold disabled:opacity-45 transition-transform shadow-sm"
              >
                {loginLoading ? 'กำลังตรวจสอบสิทธิ์...' : 'ยืนยันรหัสเข้าสู่ระบบ'}
              </button>
            </form>

            {import.meta.env.VITE_SHOW_DEMO_CREDENTIALS === 'true' && (
            <div className="pt-4 border-t border-[#E2DFD5] dark:border-[#25354C] space-y-2.5">
              <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
                รหัสทดสอบสำหรับกรรมการ (คลิกเพื่อกรอก):
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCodeInput('482910374651')}
                  className="min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] font-mono text-xs font-semibold hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
                >
                  #1 · 482910374651
                </button>
                <button
                  type="button"
                  onClick={() => setCodeInput('910283746512')}
                  className="min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] font-mono text-xs font-semibold hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
                >
                  #2 · 910283746512
                </button>
              </div>
            </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =====================================================================
  // VIEW 2: FULLSCREEN MOBILE-APP LIVE SCORING VIEW (100dvh, Thumb-First)
  // =====================================================================
  if (activeMatch) {
    const activeSet = activeMatch.sets[activeMatch.currentSet - 1] || {
      setNumber: activeMatch.currentSet || 1,
      scoreA: 0,
      scoreB: 0,
    };
    const winsA = activeMatch.sets.filter((s) => s.winner === 'A').length;
    const winsB = activeMatch.sets.filter((s) => s.winner === 'B').length;
    const tourney = state.tournaments.find((t) => t.id === activeMatch.tournamentId);
    const courtName =
      tourney?.courts.find((c) => c.id === activeMatch.courtId)?.name ||
      activeMatch.courtId ||
      'ไม่ระบุสนาม';
    const divName = tourney?.divisions.find((d) => d.id === activeMatch.divisionId)?.nameTh || '';
    const bestOfSets = tourney?.scoringRules.bestOfSets || 3;
    const effectiveSetLimit = bestOfSets === 2 && activeMatch.stage !== 'group' ? 3 : bestOfSets;
    const completedSets = activeMatch.sets.filter((set) => Boolean(set.winner));
    const normalOutcome: 'A' | 'B' | 'draw' | '' =
      getMatchOutcomeByRules(activeMatch.sets, tourney?.scoringRules, activeMatch.stage) || '';
    const canFinishNormally = normalOutcome !== '';
    const intervalAt = tourney?.scoringRules.intervalAt || 11;

    const courtState = getActiveCourtState(activeMatch);
    const suggestedSetWinner = getSetWinnerByRules(
      activeSet.scoreA,
      activeSet.scoreB,
      tourney?.scoringRules
    );
    const servingSwapUsed = courtState.swapsInCurrentSet[courtState.servingTeam];
    const servingPlayers =
      courtState.servingTeam === 'A' ? activeMatch.teamAPlayers : activeMatch.teamBPlayers;

    const leftSide: 'A' | 'B' = activeMatch.endsSwapped ? 'B' : 'A';
    const rightSide: 'A' | 'B' = activeMatch.endsSwapped ? 'A' : 'B';

    const renderCourtPanel = (side: 'A' | 'B', positionLabel: string) => {
      const isA = side === 'A';
      const name = isA ? activeMatch.teamAName : activeMatch.teamBName;
      const players = isA ? activeMatch.teamAPlayers : activeMatch.teamBPlayers;
      const score = isA ? activeSet.scoreA : activeSet.scoreB;
      const setsWon = isA ? winsA : winsB;
      const isServing = courtState.servingTeam === side;
      const isDoubles = players.length > 1;
      const sideSwapUsed = courtState.swapsInCurrentSet[side];
      const boxOrder = courtState.courtPositions[side];
      const isLeadingSetWinner = suggestedSetWinner === side;

      const renderServiceSlot = (box: 'right' | 'left', playerIndex: 0 | 1) => {
        const playerName = players[playerIndex] || players[0] || name;
        const isServerHere = isServing && courtState.serviceBox === box;
        const isReceiverHere = !isServing && courtState.serviceBox === box;
        const boxTag = box === 'right' ? 'ขวา · คู่' : 'ซ้าย · คี่';

        return (
          <div
            key={box}
            className={`rounded-xl px-2 py-1 lg:py-1.5 border transition-colors min-w-0 ${
              isServerHere
                ? 'bg-[#FEF3C7] dark:bg-[#3A280A] border-[#D97706] dark:border-[#FACC15]'
                : isReceiverHere
                ? 'bg-[#ECFDF5] dark:bg-[#0D2E20] border-[#156143]/50 dark:border-[#229A6B]/60'
                : 'bg-[#F7F6F2] dark:bg-[#0B121C] border-[#E2DFD5] dark:border-[#25354C]'
            }`}
          >
            <div className="flex items-center justify-between gap-1 text-[10px] leading-tight">
              <span className="font-mono text-[#525C6B] dark:text-[#9AA8BC] truncate">{boxTag}</span>
              {isServerHere && (
                <span className="font-bold text-[#92400E] dark:text-[#FACC15] shrink-0">
                  เสิร์ฟ
                </span>
              )}
              {isReceiverHere && (
                <span className="font-bold text-[#156143] dark:text-[#4ADE80] shrink-0">
                  รับเสิร์ฟ
                </span>
              )}
            </div>
            <div
              className={`mt-0.5 text-[11px] sm:text-xs truncate ${
                isServerHere
                  ? 'font-bold text-[#141D2B] dark:text-[#FEF3C7]'
                  : 'font-semibold text-[#141D2B] dark:text-[#E5E9F0]'
              }`}
            >
              {playerName}
            </div>
          </div>
        );
      };

      return (
        <section
          aria-label={`ฝั่ง${positionLabel} ทีม ${side}`}
          className={`rounded-2xl border-2 p-2 sm:p-3 lg:p-4 flex flex-col justify-between gap-1.5 sm:gap-2 transition-colors min-h-0 min-w-0 ${
            isServing
              ? 'border-[#D97706] dark:border-[#FACC15] bg-white dark:bg-[#131E2E] shadow-sm'
              : 'border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E]'
          }`}
        >
          {/* Team Identity & Set Counter */}
          <div className="space-y-0.5 sm:space-y-1 min-w-0">
            <div className="flex items-center justify-between gap-1 text-[10px] sm:text-[11px]">
              <span className="font-mono font-semibold text-[#525C6B] dark:text-[#9AA8BC] truncate">
                {positionLabel} · ทีม {side}
              </span>
              <span className="inline-flex items-center gap-1 shrink-0" aria-label={`ชนะ ${setsWon} เซต`}>
                {Array.from({ length: bestOfSets === 1 ? 1 : 2 }).map((_, idx) => (
                  <span
                    key={idx}
                    className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-sm border ${
                      idx < setsWon
                        ? 'bg-[#156143] border-[#156143] dark:bg-[#229A6B] dark:border-[#229A6B]'
                        : 'border-[#C9C4B5] dark:border-[#344966]'
                    }`}
                  />
                ))}
                <span className="ml-0.5 font-mono font-bold text-[#141D2B] dark:text-[#F3F5F8] tabular-nums">
                  {setsWon}
                </span>
              </span>
            </div>

            <div className="flex items-center justify-between gap-1.5 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <TeamLogoBadge
                  teamName={name}
                  logoUrl={getTeamLogo(isA ? activeMatch.teamAId : activeMatch.teamBId, name)}
                  size="sm"
                  highlight={isServing}
                />
                <h2 className="text-xs sm:text-sm lg:text-base font-bold text-[#141D2B] dark:text-[#F3F5F8] truncate">
                  {name}
                </h2>
              </div>
              {isServing && (
                <span className="text-[10px] sm:text-[11px] font-bold text-[#B45309] dark:text-[#FACC15] shrink-0 whitespace-nowrap">
                  เสิร์ฟ
                </span>
              )}
            </div>
          </div>

          {/* Responsive Core Split:
              - Portrait mobile (< sm): vertical stack inside horizontal half-court card
              - Landscape phone/tablet (sm..lg): horizontal inner split (service boxes left | score + +1 right)
              - Desktop (lg+): spacious vertical stack (service boxes top | giant score + +1 bottom) */}
          <div className="flex flex-col sm:flex-row lg:flex-col items-stretch justify-between gap-2 flex-1 min-h-0">
            {/* Physical Court Service Boxes */}
            <div className="order-2 sm:order-1 sm:flex-1 lg:flex-none min-w-0 flex flex-col justify-center">
              {isDoubles ? (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-1 sm:gap-1.5">
                    {renderServiceSlot('right', boxOrder[0])}
                    {renderServiceSlot('left', boxOrder[1])}
                  </div>
                  <button
                    type="button"
                    disabled={activeMatch.locked || sideSwapUsed}
                    onClick={() =>
                      setPendingActionConfirm({
                        title: `ยืนยันสลับคนเสิร์ฟทีม ${side}?`,
                        description: `สลับตำแหน่งคู่เสิร์ฟของ ${name} (ใช้สิทธิ์ 1/1 สำหรับเซตที่ ${activeMatch.currentSet})`,
                        confirmLabel: `ยืนยันสลับทีม ${side}`,
                        tone: 'warning',
                        onConfirm: () =>
                          dispatchMatchEvent(activeMatch, 'toggle_server_player', { team: side }),
                      })
                    }
                    className={`w-full min-h-[36px] sm:min-h-[38px] px-2 rounded-xl border text-[10px] sm:text-[11px] font-semibold inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${
                      sideSwapUsed
                        ? 'border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-[#525C6B]/60 dark:text-[#9AA8BC]/60 cursor-not-allowed'
                        : 'border-[#D97706]/50 dark:border-[#FACC15]/40 bg-[#FFFBEB] dark:bg-[#261B07] text-[#92400E] dark:text-[#FACC15] hover:bg-[#FEF3C7] dark:hover:bg-[#3A280A] active:scale-[0.98]'
                    } disabled:opacity-70`}
                  >
                    <UserCheck className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      {sideSwapUsed ? 'สลับแล้ว (0/1)' : `สลับคนเสิร์ฟ ${side} (1/1)`}
                    </span>
                  </button>
                </div>
              ) : (
                renderServiceSlot(score % 2 === 0 ? 'right' : 'left', 0)
              )}
            </div>

            {/* Score Readout + Primary Thumb CTA (+1 Point - NO confirm needed for rapid scoring) */}
            <div className="order-1 sm:order-2 lg:flex-1 flex flex-col items-center justify-between gap-1.5 sm:gap-2 shrink-0 sm:min-w-[116px] lg:w-full">
              <div className="flex-1 flex flex-col items-center justify-center min-h-0 py-0.5">
                <div className="text-4xl sm:text-5xl lg:text-7xl font-extrabold font-mono tabular-nums tracking-tight text-[#141D2B] dark:text-[#F3F5F8] select-none leading-none">
                  {score}
                </div>
                {isLeadingSetWinner && !activeMatch.locked && (
                  <div className="mt-1 text-[10px] sm:text-[11px] font-bold text-[#156143] dark:text-[#4ADE80] whitespace-nowrap">
                    ครบแต้มปิดเซต {activeMatch.currentSet}
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={activeMatch.locked || activeMatch.status === 'suspended'}
                onClick={() => dispatchMatchEvent(activeMatch, isA ? 'point_A' : 'point_B')}
                className="w-full min-h-[54px] sm:min-h-[64px] lg:min-h-[88px] px-2.5 sm:px-3 rounded-xl bg-[#156143] hover:bg-[#104D35] active:scale-[0.97] active:bg-[#0D3E2B] disabled:opacity-40 text-white flex flex-col items-center justify-center gap-0.5 transition-transform shadow-sm select-none touch-manipulation"
              >
                <Plus className="w-5 h-5 sm:w-5 sm:h-5 lg:w-7 lg:h-7 stroke-[2.75]" />
                <span className="text-xs sm:text-sm lg:text-base font-bold whitespace-nowrap">
                  +1 แต้ม · {side}
                </span>
              </button>
            </div>
          </div>
        </section>
      );
    };

    return (
      <div className="min-h-[100dvh] lg:h-[100dvh] flex flex-col overflow-y-auto lg:overflow-hidden bg-[#F7F6F2] dark:bg-[#0B121C] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        {/* Top App Bar (44px compact on landscape mobile, 52px on lg) */}
        <header className="sticky top-0 z-30 h-[44px] lg:h-[52px] px-2.5 sm:px-3 bg-[#142642] text-white flex items-center justify-between gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() =>
              setPendingActionConfirm({
                title: 'กลับไปหน้ารายการคู่แข่งขัน?',
                description: 'ข้อมูลคะแนนปัจจุบันจะถูกบันทึกไว้ สามารถกลับเข้ามาตัดสินต่อได้ตลอดเวลา',
                confirmLabel: 'กลับรายการคู่',
                onConfirm: () => {
                  setActiveMatchId(null);
                  localStorage.removeItem('lm_director_active_match');
                },
              })
            }
            className="min-h-[38px] px-2 sm:px-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold inline-flex items-center gap-1 shrink-0 whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden xs:inline sm:inline">รายการคู่</span>
          </button>

          <div className="min-w-0 text-center flex-1">
            <div className="text-xs font-bold truncate">
              {courtName} · {activeMatch.matchCode}
            </div>
            <div className="text-[10px] text-white/75 truncate">
              เซต {activeMatch.currentSet}/{effectiveSetLimit} · {divName}
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                setPendingActionConfirm({
                  title: simOffline ? 'กลับสู่โหมด Online?' : 'สลับเป็นโหมดทดสอบ Offline?',
                  description: simOffline
                    ? 'ระบบจะกลับมาเชื่อมต่อและซิงค์คะแนนขึ้นเซิร์ฟเวอร์ตามปกติ'
                    : 'คะแนนที่บันทึกต่อจากนี้จะเก็บในเครื่องชั่วคราวจนกว่าจะเปิดโหมด Online',
                  confirmLabel: simOffline ? 'เปิด Online' : 'ใช้โหมด Offline',
                  tone: 'warning',
                  onConfirm: () => setSimOffline((v) => !v),
                })
              }
              title="สลับโหมด Online / ทดสอบ Offline"
              className={`min-h-[38px] px-2 sm:px-2.5 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap ${
                syncStatus === 'online'
                  ? 'bg-[#156143] text-white'
                  : syncStatus === 'syncing'
                  ? 'bg-[#2563EB] text-white'
                  : 'bg-[#EAB308] text-[#142642]'
              }`}
            >
              {effectiveOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">
                {syncStatus === 'online'
                  ? 'Online'
                  : syncStatus === 'syncing'
                  ? 'Sync...'
                  : `ค้าง ${pendingCount}`}
              </span>
              {!effectiveOnline && pendingCount > 0 && <span className="sm:hidden">{pendingCount}</span>}
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label="สลับธีมมืด/สว่าง"
              title={theme === 'light' ? 'เปลี่ยนเป็นโหมดมืด' : 'เปลี่ยนเป็นโหมดสว่าง'}
              className="min-h-[38px] min-w-[38px] rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center"
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4 text-[#FACC15]" />}
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label="เต็มจอ"
              className="min-h-[38px] min-w-[38px] rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Sub-Strip: Previous Sets & Active BWF Rule Context */}
        <div className="px-3 py-1 bg-white dark:bg-[#131E2E] border-b border-[#E2DFD5] dark:border-[#25354C] flex items-center justify-between gap-2 text-[11px] shrink-0">
          <div className="font-mono text-[#525C6B] dark:text-[#9AA8BC] truncate">
            เซตก่อนหน้า:{' '}
            <strong className="text-[#141D2B] dark:text-[#F3F5F8] tabular-nums">
              {activeMatch.sets
                .slice(0, activeMatch.currentSet - 1)
                .map((s) => `${s.scoreA}-${s.scoreB}`)
                .join(' · ') || 'เซตแรก'}
            </strong>
          </div>
          <div className="flex items-center gap-2 shrink-0 text-[#525C6B] dark:text-[#9AA8BC] font-medium">
            <span className="hidden sm:inline">
              {courtState.serviceBox === 'right' ? 'คอร์ทขวา (แต้มคู่)' : 'คอร์ทซ้าย (แต้มคี่)'}
            </span>
            <span className="hidden sm:inline">·</span>
            <span
              className={`font-bold ${
                activeMatch.locked
                  ? 'text-[#2563EB] dark:text-[#60A5FA]'
                  : activeMatch.status === 'suspended'
                  ? 'text-[#B45309] dark:text-[#FACC15]'
                  : 'text-[#156143] dark:text-[#4ADE80]'
              }`}
            >
              {activeMatch.locked
                ? 'ล็อกผลแล้ว'
                : activeMatch.status === 'suspended'
                ? 'พักชั่วคราว'
                : `เซต ${activeMatch.currentSet} · สลับเสิร์ฟออโต้`}
            </span>
          </div>
        </div>

        {/* Main Split Court Scoreboard (Always horizontal Left vs Right side-by-side) */}
        <main className="flex-1 min-h-0 p-1.5 sm:p-2.5 lg:p-4 grid grid-cols-2 gap-1.5 sm:gap-2.5 lg:gap-4 max-w-6xl w-full mx-auto">
          {renderCourtPanel(leftSide, 'ซ้าย')}
          {renderCourtPanel(rightSide, 'ขวา')}
        </main>

        {/* Ergonomic Bottom Thumb Dock (Horizontal single-row controls on landscape sm+, ALL non-point buttons require confirmation) */}
        <footer className="sticky bottom-0 z-20 sm:static bg-white dark:bg-[#131E2E] border-t border-[#E2DFD5] dark:border-[#25354C] px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 space-y-1.5 shrink-0">
          <div className="max-w-6xl mx-auto space-y-1.5">
            {/* Row 1: All Court, Serve, Interval, Card & Extra Tools (4+3 on portrait, 7-across single horizontal row on landscape sm+) */}
            <div className="grid grid-cols-12 sm:grid-cols-7 gap-1 sm:gap-1.5">
              <button
                type="button"
                disabled={activeMatch.locked}
                onClick={() =>
                  setPendingActionConfirm({
                    title: 'ยืนยันย้อนกลับ (Undo)?',
                    description: `ย้อนกลับแต้มหรือเหตุการณ์ล่าสุดในเซตที่ ${activeMatch.currentSet}`,
                    confirmLabel: 'ยืนยัน Undo',
                    tone: 'warning',
                    onConfirm: () => dispatchMatchEvent(activeMatch, 'undo'),
                  })
                }
                className="col-span-3 sm:col-span-1 min-h-[38px] lg:min-h-[44px] px-1.5 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] active:scale-[0.97] text-[10px] sm:text-[11px] lg:text-xs font-bold flex items-center justify-center gap-1 disabled:opacity-40 whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                <span>Undo</span>
              </button>
              <button
                type="button"
                disabled={activeMatch.locked}
                onClick={() =>
                  setPendingActionConfirm({
                    title: 'ยืนยันสลับทีมเสิร์ฟ?',
                    description: `เปลี่ยนสิทธิ์เสิร์ฟจากทีม ${courtState.servingTeam} ไปยังทีม ${
                      courtState.servingTeam === 'A' ? 'B' : 'A'
                    }`,
                    confirmLabel: 'ยืนยันสลับทีมเสิร์ฟ',
                    tone: 'warning',
                    onConfirm: () => dispatchMatchEvent(activeMatch, 'toggle_server'),
                  })
                }
                className="col-span-3 sm:col-span-1 min-h-[38px] lg:min-h-[44px] px-1.5 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] active:scale-[0.97] text-[10px] sm:text-[11px] lg:text-xs font-bold flex items-center justify-center gap-1 disabled:opacity-40 whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">สลับเสิร์ฟ</span>
              </button>
              <button
                type="button"
                disabled={
                  activeMatch.locked || servingPlayers.length < 2 || servingSwapUsed
                }
                onClick={() =>
                  setPendingActionConfirm({
                    title: `ยืนยันสลับคนเสิร์ฟทีม ${courtState.servingTeam}?`,
                    description: `ใช้สิทธิ์สลับตำแหน่งผู้เล่นคู่ของทีม ${courtState.servingTeam} (1/1 ในเซตที่ ${activeMatch.currentSet})`,
                    confirmLabel: 'ยืนยันสลับคนเสิร์ฟ',
                    tone: 'warning',
                    onConfirm: () =>
                      dispatchMatchEvent(activeMatch, 'toggle_server_player', {
                        team: courtState.servingTeam,
                      }),
                  })
                }
                className="col-span-3 sm:col-span-1 min-h-[38px] lg:min-h-[44px] px-1.5 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] active:scale-[0.97] text-[10px] sm:text-[11px] lg:text-xs font-bold flex items-center justify-center gap-1 disabled:opacity-40 whitespace-nowrap"
              >
                <UserCheck className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {servingPlayers.length < 2
                    ? 'เดี่ยว'
                    : servingSwapUsed
                    ? 'คนเสิร์ฟ 0/1'
                    : 'คนเสิร์ฟ 1/1'}
                </span>
              </button>
              <button
                type="button"
                disabled={activeMatch.locked}
                onClick={() =>
                  setPendingActionConfirm({
                    title: 'ยืนยันสลับแดน (ซ้าย–ขวา)?',
                    description: 'สลับฝั่งสนามระหว่างทีมซ้ายและทีมขวาบนหน้าจอกรรมการ',
                    confirmLabel: 'ยืนยันสลับแดน',
                    onConfirm: () => dispatchMatchEvent(activeMatch, 'change_ends'),
                  })
                }
                className="col-span-3 sm:col-span-1 min-h-[38px] lg:min-h-[44px] px-1.5 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] active:scale-[0.97] text-[10px] sm:text-[11px] lg:text-xs font-bold flex items-center justify-center gap-1 disabled:opacity-40 whitespace-nowrap"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
                <span>สลับแดน</span>
              </button>
              <button
                type="button"
                disabled={activeMatch.locked}
                onClick={() =>
                  setPendingActionConfirm({
                    title: `ยืนยันพัก ${intervalAt} แต้ม (Interval)?`,
                    description: `บันทึกช่วงพักครึ่งเซตที่ ${intervalAt} แต้มลงใน Timeline ของแมตช์`,
                    confirmLabel: 'ยืนยันพักครึ่งเซต',
                    onConfirm: () => dispatchMatchEvent(activeMatch, 'interval'),
                  })
                }
                className="col-span-4 sm:col-span-1 min-h-[38px] lg:min-h-[44px] px-1.5 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] active:scale-[0.97] text-[10px] sm:text-[11px] lg:text-xs font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-40 whitespace-nowrap"
              >
                <Clock className="w-3.5 h-3.5 shrink-0 text-[#156143] dark:text-[#229A6B]" />
                <span>พัก {intervalAt}</span>
              </button>
              <button
                type="button"
                disabled={activeMatch.locked}
                onClick={() => setShowCardModal(true)}
                className="col-span-4 sm:col-span-1 min-h-[38px] lg:min-h-[44px] px-1.5 rounded-xl border border-[#FDE047] bg-[#FEF9C3] dark:bg-[#332409] text-[#713F12] dark:text-[#FACC15] active:scale-[0.97] text-[10px] sm:text-[11px] lg:text-xs font-bold inline-flex items-center justify-center gap-1 disabled:opacity-40 whitespace-nowrap"
              >
                <Flag className="w-3.5 h-3.5 shrink-0" />
                <span>ใบเตือน</span>
              </button>
              <button
                type="button"
                onClick={() => setShowToolsSheet(true)}
                className="col-span-4 sm:col-span-1 min-h-[38px] lg:min-h-[44px] px-1.5 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] active:scale-[0.97] text-[10px] sm:text-[11px] lg:text-xs font-semibold inline-flex items-center justify-center gap-1 whitespace-nowrap"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
                <span>เพิ่มเติม ({activeMatch.timeline.length})</span>
              </button>
            </div>

            {/* Row 2: End Set Confirmation Modal Trigger & End Match */}
            {!activeMatch.locked && (
              <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => setShowEndSetModal(true)}
                  className={`min-h-[40px] lg:min-h-[46px] rounded-xl bg-[#142642] hover:bg-[#1E355C] active:scale-[0.98] text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-1.5 transition-transform ${
                    suggestedSetWinner ? 'ring-2 ring-[#EAB308]' : ''
                  }`}
                >
                  <span>จบเซตที่ {activeMatch.currentSet}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFinishWinner(normalOutcome || (winsA >= winsB ? 'A' : 'B'));
                    setShowFinishModal(true);
                  }}
                  className="min-h-[40px] lg:min-h-[46px] rounded-xl bg-[#EAB308] hover:bg-[#CA8A04] active:scale-[0.98] text-[#142642] text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-1.5 transition-transform"
                >
                  <Lock className="w-4 h-4 shrink-0" />
                  <span>จบแมตช์ & ยืนยัน</span>
                </button>
              </div>
            )}
          </div>
        </footer>

        {/* Bottom Sheet Drawer: Timeouts, Medical, Suspend & Point-by-Point Timeline */}
        {showToolsSheet && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 backdrop-blur-xs"
            role="dialog"
            aria-modal="true"
            onClick={() => setShowToolsSheet(false)}
          >
            <div
              className="w-full max-w-2xl rounded-t-3xl bg-white dark:bg-[#131E2E] border-t border-[#E2DFD5] dark:border-[#25354C] px-5 pt-2 pb-7 space-y-4 max-h-[82dvh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1.5 bg-[#D5D0C3] dark:bg-[#344966] rounded-full mx-auto my-1.5 shrink-0" />
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold">คำสั่งเสริม & ประวัติคะแนน</h3>
                <button
                  type="button"
                  onClick={() => setShowToolsSheet(false)}
                  className="min-h-[44px] min-w-[44px] rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#BBDCCF] bg-[#F1FAF6] p-3 dark:border-[#24533F] dark:bg-[#10291E]">
                <div>
                  <div className="text-xs font-bold">จำนวนลูกแบดที่ใช้ในคู่นี้</div>
                  <div className="mt-0.5 text-[11px] text-[#526071] dark:text-[#B9C4D3]">บันทึกแบบ realtime พร้อมชื่อกรรมการใน Timeline</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={activeMatch.locked || (activeMatch.shuttlesUsed || 0) <= 0}
                    onClick={() => void dispatchMatchEvent(activeMatch, 'shuttle_remove')}
                    aria-label="ลดจำนวนลูกแบด"
                    className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#BBDCCF] bg-white text-[#156143] disabled:opacity-35 dark:border-[#24533F] dark:bg-[#131E2E] dark:text-[#4ADE80]"
                  >
                    <Minus className="h-5 w-5" />
                  </button>
                  <div className="min-w-14 text-center font-mono text-2xl font-extrabold tabular-nums">{activeMatch.shuttlesUsed || 0}</div>
                  <button
                    type="button"
                    disabled={activeMatch.locked}
                    onClick={() => void dispatchMatchEvent(activeMatch, 'shuttle_add')}
                    aria-label="เพิ่มจำนวนลูกแบด"
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#156143] text-white disabled:opacity-35"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Timeout / Medical / Suspend Grid (All require confirmation) */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  disabled={activeMatch.locked}
                  onClick={() =>
                    setPendingActionConfirm({
                      title: 'ยืนยันบันทึก Timeout ทีม A?',
                      description: `บันทึกการใช้ Timeout ของ ${activeMatch.teamAName} (ใช้ไปแล้ว ${activeMatch.timeoutsUsed.A})`,
                      confirmLabel: 'ยืนยัน Timeout A',
                      onConfirm: () => {
                        dispatchMatchEvent(activeMatch, 'timeout_A');
                        setShowToolsSheet(false);
                      },
                    })
                  }
                  className="min-h-[46px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] font-semibold disabled:opacity-40"
                >
                  Timeout ทีม A ({activeMatch.timeoutsUsed.A})
                </button>
                <button
                  type="button"
                  disabled={activeMatch.locked}
                  onClick={() =>
                    setPendingActionConfirm({
                      title: 'ยืนยันบันทึก Timeout ทีม B?',
                      description: `บันทึกการใช้ Timeout ของ ${activeMatch.teamBName} (ใช้ไปแล้ว ${activeMatch.timeoutsUsed.B})`,
                      confirmLabel: 'ยืนยัน Timeout B',
                      onConfirm: () => {
                        dispatchMatchEvent(activeMatch, 'timeout_B');
                        setShowToolsSheet(false);
                      },
                    })
                  }
                  className="min-h-[46px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] font-semibold disabled:opacity-40"
                >
                  Timeout ทีม B ({activeMatch.timeoutsUsed.B})
                </button>
                <button
                  type="button"
                  disabled={activeMatch.locked}
                  onClick={() =>
                    setPendingActionConfirm({
                      title: 'ยืนยันเรียกปฐมพยาบาล (Medical Timeout)?',
                      description: 'บันทึกเหตุการณ์หยุดเวลาปฐมพยาบาลนักกีฬาในสนามลงใน Timeline',
                      confirmLabel: 'ยืนยัน Medical Timeout',
                      tone: 'warning',
                      onConfirm: () => {
                        dispatchMatchEvent(activeMatch, 'medical_timeout', {
                          detail: 'ปฐมพยาบาลในสนาม (Medical Timeout)',
                        });
                        setShowToolsSheet(false);
                      },
                    })
                  }
                  className="min-h-[46px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  <HeartPulse className="w-4 h-4 text-[#B91C1C]" />
                  <span>ปฐมพยาบาล (Medical)</span>
                </button>
                <button
                  type="button"
                  disabled={activeMatch.locked}
                  onClick={() => {
                    const isSuspended = activeMatch.status === 'suspended';
                    setPendingActionConfirm({
                      title: isSuspended
                        ? 'ยืนยันกลับมาแข่งขันต่อ (Resume)?'
                        : 'ยืนยันพักการแข่งขันชั่วคราว (Suspend)?',
                      description: isSuspended
                        ? 'เปลี่ยนสถานะแมตช์กลับเป็นกำลังแข่งขัน (Live) เพื่อนับคะแนนต่อ'
                        : 'หยุดนับคะแนนชั่วคราวสำหรับคู่นี้ (ปุ่มเพิ่มแต้มจะถูกปิดใช้งานชั่วคราว)',
                      confirmLabel: isSuspended ? 'ยืนยันแข่งต่อ' : 'ยืนยันพักชั่วคราว',
                      tone: 'warning',
                      onConfirm: () => {
                        dispatchMatchEvent(
                          activeMatch,
                          isSuspended ? 'resume' : 'suspend',
                          { reason: 'พักการแข่งขันชั่วคราว' }
                        );
                        setShowToolsSheet(false);
                      },
                    });
                  }}
                  className="min-h-[46px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  {activeMatch.status === 'suspended' ? (
                    <>
                      <Play className="w-4 h-4 text-[#156143]" />
                      <span>แข่งต่อ (Resume)</span>
                    </>
                  ) : (
                    <>
                      <Pause className="w-4 h-4 text-[#B45309]" />
                      <span>พักชั่วคราว (Suspend)</span>
                    </>
                  )}
                </button>
              </div>

              {/* Timeline History */}
              <div className="flex-1 min-h-0 flex flex-col border-t border-[#E2DFD5] dark:border-[#25354C] pt-3">
                <div className="text-xs font-bold mb-2">
                  Timeline เหตุการณ์คะแนน ({activeMatch.timeline.length})
                </div>
                {activeMatch.timeline.length === 0 ? (
                  <p className="text-xs text-[#525C6B] py-4 text-center">ยังไม่มีบันทึกคะแนนในคู่นี้</p>
                ) : (
                  <div className="flex-1 overflow-y-auto divide-y divide-[#E2DFD5] dark:divide-[#25354C] text-xs">
                    {activeMatch.timeline.map((ev) => (
                      <div key={ev.id} className="py-2.5 flex items-center justify-between gap-2">
                        <span>
                          <strong className="font-mono mr-1.5">S{ev.setNumber}</strong>
                          <span>{ev.detail || ev.type}</span>
                        </span>
                        <span className="font-mono text-[#525C6B] dark:text-[#9AA8BC] shrink-0 tabular-nums">
                          {ev.scoreSnapshot} · {ev.timestamp}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* End-of-Set Confirmation Modal */}
        {showEndSetModal && (() => {
          const projectedWinner = suggestedSetWinner;
          const projWinsA = winsA + (projectedWinner === 'A' && !activeSet.winner ? 1 : 0);
          const projWinsB = winsB + (projectedWinner === 'B' && !activeSet.winner ? 1 : 0);
          const projectedCompletedSets = completedSets.length + (projectedWinner && !activeSet.winner ? 1 : 0);
          const willAdvanceSet =
            bestOfSets === 2
              ? projectedCompletedSets < 2 ||
                (projectedCompletedSets === 2 &&
                  projWinsA === projWinsB &&
                  activeMatch.stage !== 'group')
              : bestOfSets === 3
              ? projWinsA < 2 && projWinsB < 2
              : false;

          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
              role="dialog"
              aria-modal="true"
              onClick={() => setShowEndSetModal(false)}
            >
              <div
                className="w-full max-w-md rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-5 space-y-4 text-xs shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-[#156143] dark:text-[#4ADE80] shrink-0" />
                    <h3 className="text-base font-bold">
                      ยืนยันจบเซตที่ {activeMatch.currentSet}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowEndSetModal(false)}
                    aria-label="ปิดหน้าต่าง"
                    className="min-h-[40px] min-w-[40px] rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Current Set Score Summary */}
                <div className="p-4 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div className="min-w-0 flex items-center gap-2 text-left">
                    <TeamLogoBadge
                      teamName={activeMatch.teamAName}
                      logoUrl={getTeamLogo(activeMatch.teamAId, activeMatch.teamAName)}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono text-[#525C6B] dark:text-[#9AA8BC]">ทีม A</div>
                      <div className="text-xs font-bold truncate">{activeMatch.teamAName}</div>
                    </div>
                  </div>
                  <div className="text-2xl font-extrabold font-mono tabular-nums tracking-tight text-center">
                    {activeSet.scoreA} – {activeSet.scoreB}
                  </div>
                  <div className="min-w-0 flex items-center justify-end gap-2 text-right">
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono text-[#525C6B] dark:text-[#9AA8BC]">ทีม B</div>
                      <div className="text-xs font-bold truncate">{activeMatch.teamBName}</div>
                    </div>
                    <TeamLogoBadge
                      teamName={activeMatch.teamBName}
                      logoUrl={getTeamLogo(activeMatch.teamBId, activeMatch.teamBName)}
                      size="sm"
                    />
                  </div>
                </div>

                {!projectedWinner ? (
                  <div className="p-3 rounded-xl bg-[#FEF2F2] dark:bg-[#361215] border border-[#FECACA] dark:border-[#5E2025] text-[#B91C1C] dark:text-[#F87171] flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      คะแนน {activeSet.scoreA}–{activeSet.scoreB} ยังไม่ครบเงื่อนไขจบเซต
                      ตามกติกา {tourney?.scoringRules.pointsPerSet || 21} แต้ม
                      {tourney?.scoringRules.winByTwo ? ' และต้องชนะห่าง 2 แต้ม' : ''}
                    </span>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-[#ECFDF5] dark:bg-[#0D2E20] border border-[#A7F3D0] dark:border-[#1E5C40] text-[#156143] dark:text-[#4ADE80] font-medium">
                    ผู้ชนะเซตที่ {activeMatch.currentSet}:{' '}
                    <strong>
                      {activeSet.scoreA > activeSet.scoreB
                        ? activeMatch.teamAName
                        : activeMatch.teamBName}
                    </strong>{' '}
                    ({Math.max(activeSet.scoreA, activeSet.scoreB)}–{Math.min(activeSet.scoreA, activeSet.scoreB)})
                  </div>
                )}

                <p className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC] leading-relaxed">
                  {willAdvanceSet
                    ? `เมื่อยืนยันแล้ว ระบบจะบันทึกผลเซตที่ ${activeMatch.currentSet} สลับแดนอัตโนมัติ เริ่มเซตที่ ${activeMatch.currentSet + 1} และรีเซ็ตสิทธิ์สลับคนเสิร์ฟเป็น 1/1 ต่อทีม`
                    : `บันทึกผลเซตที่ ${activeMatch.currentSet} แล้ว พร้อมสรุปผลแมตช์ กรุณากด “จบแมตช์ & ยืนยัน” เพื่อปิดและล็อกผลการแข่งขัน`}
                </p>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowEndSetModal(false)}
                    className="flex-1 min-h-[46px] rounded-xl border border-[#E2DFD5] dark:border-[#25354C] font-semibold"
                  >
                    กลับไปแก้ไข
                  </button>
                  <button
                    type="button"
                    disabled={!projectedWinner || endSetSubmitting}
                    onClick={async () => {
                      setEndSetSubmitting(true);
                      try {
                        const saved = await dispatchMatchEvent(activeMatch, 'end_set');
                        if (!saved) return;
                        setShowEndSetModal(false);
                        notify(
                          'success',
                          willAdvanceSet
                            ? `บันทึกเซตที่ ${activeMatch.currentSet} แล้ว เริ่มเซตที่ ${activeMatch.currentSet + 1}`
                            : `บันทึกคะแนนเซตที่ ${activeMatch.currentSet} เรียบร้อย`
                        );
                      } finally {
                        setEndSetSubmitting(false);
                      }
                    }}
                    className="flex-1 min-h-[46px] rounded-xl bg-[#142642] hover:bg-[#1E355C] text-white font-bold inline-flex items-center justify-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{endSetSubmitting ? 'กำลังบันทึก...' : `ยืนยันจบเซตที่ ${activeMatch.currentSet}`}</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Card / Penalty Modal */}
        {showCardModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" role="dialog">
            <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-5 space-y-3 text-xs">
              <h3 className="text-sm font-bold">บันทึกใบเตือน / ทำโทษ</h3>
              <select
                value={cardTeam}
                onChange={(e) => setCardTeam(e.target.value as 'A' | 'B')}
                className="w-full min-h-[44px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
              >
                <option value="A">ทีม A: {activeMatch.teamAName}</option>
                <option value="B">ทีม B: {activeMatch.teamBName}</option>
              </select>
              <select
                value={cardType}
                onChange={(e) => setCardType(e.target.value as 'yellow' | 'red' | 'black')}
                className="w-full min-h-[44px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
              >
                <option value="yellow">ใบเหลือง (เตือน)</option>
                <option value="red">ใบแดง (เสียแต้มให้คู่แข่ง +1)</option>
                <option value="black">ใบดำ (ปรับแพ้ Disqualified)</option>
              </select>
              <input
                value={cardReason}
                onChange={(e) => setCardReason(e.target.value)}
                placeholder="ระบุสาเหตุ"
                className="w-full min-h-[44px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
              />
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCardModal(false)}
                  className="flex-1 min-h-[44px] rounded-xl border border-[#E2DFD5] dark:border-[#25354C] font-semibold"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={() => {
                    dispatchMatchEvent(activeMatch, 'card', {
                      team: cardTeam,
                      cardType,
                      reason: cardReason,
                    });
                    setShowCardModal(false);
                  }}
                  className="flex-1 min-h-[44px] rounded-xl bg-[#156143] text-white font-bold"
                >
                  บันทึกใบโทษ
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Finish & Digital Confirmation Lock Modal */}
        {showFinishModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" role="dialog">
            <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-5 space-y-4 text-xs">
              <div className="flex items-center gap-2">
                <Award className="w-5 h-5 text-[#156143]" />
                <h3 className="text-base font-bold">ยืนยันจบแมตช์และล็อกผลการแข่งขัน</h3>
              </div>
              <div className="p-3 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] space-y-1 font-mono">
                {activeMatch.sets.map((s) => (
                  <div key={s.setNumber}>
                    เซต {s.setNumber}: {activeMatch.teamAName} ({s.scoreA}) – ({s.scoreB}){' '}
                    {activeMatch.teamBName}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium mb-1">ประเภทการจบแมตช์</label>
                  <select
                    value={finishSpecialStatus}
                    onChange={(e) =>
                      setFinishSpecialStatus(e.target.value as 'finished' | 'walkover' | 'retired')
                    }
                    className="w-full min-h-[44px] px-2.5 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                  >
                    <option value="finished">แข่งจบปกติ (Finished)</option>
                    <option value="retired">ขอถอนตัวระหว่างแข่ง (Retired)</option>
                    <option value="walkover">ชนะบาย (Walkover)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium mb-1">ผลการแข่งขัน</label>
                  {finishSpecialStatus === 'finished' && normalOutcome === 'draw' ? (
                    <div className="min-h-[44px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] flex items-center font-bold text-[#156143] dark:text-[#4ADE80]">
                      เสมอ 1–1 เซต
                    </div>
                  ) : (
                    <select
                      value={finishWinner === 'draw' ? 'A' : finishWinner}
                      onChange={(e) => setFinishWinner(e.target.value as 'A' | 'B')}
                      className="w-full min-h-[44px] px-2.5 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                    >
                      <option value="A">{activeMatch.teamAName}</option>
                      <option value="B">{activeMatch.teamBName}</option>
                    </select>
                  )}
                </div>
              </div>
              <div>
                <label className="block font-medium mb-1">หมายเหตุกรรมการ (Digital Confirmation)</label>
                <input
                  value={umpireNote}
                  onChange={(e) => setUmpireNote(e.target.value)}
                  placeholder="ยืนยันคะแนนถูกต้องตรงตามใบบันทึก"
                  className="w-full min-h-[44px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                />
              </div>
              <p className="text-[11px] text-[#B45309] dark:text-[#FACC15] flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {finishSpecialStatus === 'finished' && !canFinishNormally
                    ? 'คะแนนยังไม่ครบตามกติกา กรุณาจบเซตให้เรียบร้อยก่อนยืนยันผลปกติ'
                    : 'เมื่อกดยืนยันแล้ว ผลจะถูกล็อกทันที (หากแก้ไขภายหลังต้องใช้สิทธิ์ Admin)'}
                </span>
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowFinishModal(false)}
                  className="flex-1 min-h-[46px] rounded-xl border border-[#E2DFD5] dark:border-[#25354C] font-semibold"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  disabled={
                    (finishSpecialStatus === 'finished' && !canFinishNormally) ||
                    (finishSpecialStatus !== 'finished' && !umpireNote.trim())
                  }
                  onClick={async () => {
                    await dispatchMatchEvent(activeMatch, 'end_match', {
                      status: finishSpecialStatus,
                      winner:
                        finishSpecialStatus === 'finished' && normalOutcome === 'draw'
                          ? 'draw'
                          : finishWinner === 'draw'
                            ? 'A'
                            : finishWinner,
                      note: umpireNote,
                      lock: true,
                    });
                    setShowFinishModal(false);
                    notify('success', 'ยืนยันผลและล็อกแมตช์เรียบร้อย');
                  }}
                  className="flex-1 min-h-[46px] rounded-xl bg-[#156143] disabled:opacity-45 disabled:cursor-not-allowed text-white font-bold inline-flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>ยืนยันและล็อกผล</span>
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Confirmation Modal for all non-point Umpire Scoring actions */}
        {pendingActionConfirm && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
            role="dialog"
            aria-modal="true"
            onClick={() => setPendingActionConfirm(null)}
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-5 space-y-4 text-xs shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className={`p-2 rounded-xl shrink-0 ${
                    pendingActionConfirm.tone === 'warning'
                      ? 'bg-[#FEF3C7] text-[#B45309] dark:bg-[#3A280A] dark:text-[#FACC15]'
                      : pendingActionConfirm.tone === 'danger'
                      ? 'bg-[#FEF2F2] text-[#B91C1C] dark:bg-[#361215] dark:text-[#F87171]'
                      : 'bg-[#ECFDF5] text-[#156143] dark:bg-[#0D2E20] dark:text-[#4ADE80]'
                  }`}
                >
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold leading-snug text-[#141D2B] dark:text-[#F3F5F8]">
                    {pendingActionConfirm.title}
                  </h3>
                  <p className="mt-1 text-xs text-[#525C6B] dark:text-[#9AA8BC] leading-relaxed">
                    {pendingActionConfirm.description}
                  </p>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPendingActionConfirm(null)}
                  className="flex-1 min-h-[48px] rounded-xl border border-[#E2DFD5] dark:border-[#25354C] font-semibold hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const fn = pendingActionConfirm.onConfirm;
                    setPendingActionConfirm(null);
                    await fn();
                  }}
                  className={`flex-1 min-h-[48px] rounded-xl text-white font-bold inline-flex items-center justify-center gap-1.5 ${
                    pendingActionConfirm.tone === 'danger'
                      ? 'bg-[#B91C1C] hover:bg-[#991B1B]'
                      : pendingActionConfirm.tone === 'warning'
                      ? 'bg-[#D97706] hover:bg-[#B45309]'
                      : 'bg-[#156143] hover:bg-[#104D35]'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{pendingActionConfirm.confirmLabel}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =====================================================================
  // VIEW 3: POST-AUTH ASSIGNED MATCHES LOBBY (Mobile App Shell)
  // =====================================================================
  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#F7F6F2] dark:bg-[#0B121C] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      {/* App Header */}
      <header className="sticky top-0 z-30 h-[54px] px-4 bg-[#142642] text-white flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {authedUmpire.photoUrl ? (
            <img
              src={authedUmpire.photoUrl}
              alt={authedUmpire.firstName}
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded-lg object-cover border border-white/25 shrink-0"
            />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
              <UserCheck className="w-4 h-4 text-[#FACC15]" />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-bold truncate">
              {authedUmpire.firstName} {authedUmpire.lastName}
            </div>
            <div className="text-[10px] font-mono text-[#FACC15] truncate">
              {authedUmpire.code} · {authedUmpire.certification}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <PWAInstallButton compact />
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label="เต็มจอ"
            className="min-h-[36px] min-w-[36px] rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="สลับธีม"
            className="min-h-[36px] min-w-[36px] rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center"
          >
            {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="ออกจากระบบกรรมการ"
            className="min-h-[36px] px-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold inline-flex items-center gap-1"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">ออก</span>
          </button>
        </div>
      </header>

      {/* Main Scrollable Match Lobby */}
      <div className="flex-1 max-w-5xl w-full mx-auto px-4 py-4 space-y-4">
        {/* Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#EFECE4] dark:bg-[#1B293D] overflow-x-auto max-w-full">
            {[
              { id: 'all' as const, label: 'ทั้งหมด' },
              { id: 'upcoming' as const, label: 'รอแข่ง' },
              { id: 'live' as const, label: 'กำลังแข่ง' },
              { id: 'finished' as const, label: 'เสร็จแล้ว' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                className={`min-h-[38px] px-3.5 rounded-lg text-xs font-bold whitespace-nowrap ${
                  statusFilter === f.id
                    ? 'bg-white dark:bg-[#131E2E] shadow-sm text-[#141D2B] dark:text-[#F3F5F8]'
                    : 'text-[#525C6B] dark:text-[#9AA8BC]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="min-h-[40px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] text-xs font-mono"
          />
        </div>

        {assignedMatches.length === 0 ? (
          <EmptyStateCard
            title="ไม่มีคู่แข่งขันที่ได้รับมอบหมายในตัวกรองนี้"
            description="ลองเลือกตัวกรอง “ทั้งหมด” หรือติดต่อผู้จัดรายการ"
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {assignedMatches.map((m) => {
              const tourney = state.tournaments.find((t) => t.id === m.tournamentId);
              const courtName =
                tourney?.courts.find((c) => c.id === m.courtId)?.name ||
                m.courtId ||
                'ยังไม่ได้กำหนดสนาม';
              const divName = tourney?.divisions.find((d) => d.id === m.divisionId)?.nameTh || '';
              const activeSet = m.sets[m.currentSet - 1];
              const needsCourtBeforeStart =
                !m.locked &&
                m.status !== 'finished' &&
                m.status !== 'walkover' &&
                m.status !== 'retired' &&
                !m.courtId;
              return (
                <div
                  key={m.id}
                  className="rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-4 flex flex-col justify-between gap-3.5 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono font-bold text-[#156143] dark:text-[#229A6B]">
                      {courtName} · {m.matchCode} · {m.scheduledTime}
                    </span>
                    <StatusIndicator
                      tone={
                        m.status === 'live'
                          ? 'live'
                          : m.status === 'finished'
                          ? 'success'
                          : 'neutral'
                      }
                      label={m.status === 'live' ? 'กำลังแข่ง' : m.status === 'finished' ? 'เสร็จแล้ว' : 'รอแข่งขัน'}
                      compact
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">{divName}</div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <TeamLogoBadge
                          teamName={m.teamAName}
                          logoUrl={getTeamLogo(m.teamAId, m.teamAName)}
                          size="sm"
                        />
                        <span className="text-sm font-bold truncate">{m.teamAName}</span>
                      </div>
                      <div className="flex items-center gap-2 min-w-0">
                        <TeamLogoBadge
                          teamName={m.teamBName}
                          logoUrl={getTeamLogo(m.teamBId, m.teamBName)}
                          size="sm"
                        />
                        <span className="text-sm font-bold truncate">{m.teamBName}</span>
                      </div>
                    </div>
                    {activeSet && (
                      <div className="text-xs font-mono text-[#525C6B] dark:text-[#9AA8BC] tabular-nums">
                        เซต {m.currentSet}: {activeSet.scoreA} – {activeSet.scoreB}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (needsCourtBeforeStart) {
                        setCourtPromptMatch(m);
                        setCourtPromptId('');
                        return;
                      }
                      setActiveMatchId(m.id);
                      localStorage.setItem('lm_director_active_match', m.id);
                      if (m.status === 'scheduled' || m.status === 'calling') {
                        void startAssignedMatch(m);
                      }
                    }}
                    className="w-full min-h-[50px] rounded-xl bg-[#156143] hover:bg-[#104D35] active:scale-[0.98] text-white text-sm font-bold inline-flex items-center justify-center gap-1.5 transition-transform"
                  >
                    <span>
                      {m.locked ? 'ดูบันทึกคะแนน' : m.status === 'live' ? 'เปิดหน้าบันทึกคะแนน' : 'เริ่มตัดสินคู่นี้'}
                    </span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Required Court Number Prompt Modal when starting a match without a court */}
      {courtPromptMatch && (() => {
        const tourney = state.tournaments.find((t) => t.id === courtPromptMatch.tournamentId);
        const courts = tourney?.courts || [];
        const handleConfirmCourt = async (e: React.FormEvent) => {
          e.preventDefault();
          const chosen = courtPromptId.trim();
          if (!chosen) {
            notify('warning', 'กรุณาเลือกหรือระบุหมายเลขสนามแข่งก่อนเริ่ม');
            return;
          }
          setCourtPromptSaving(true);
          try {
            const res = await apiFetch<{ match: MatchRecord }>(`/api/director/matches/${courtPromptMatch.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ courtId: chosen }),
            });
            applyOptimisticMatch(res.match);
            setCourtPromptMatch(null);
            setActiveMatchId(res.match.id);
            localStorage.setItem('lm_director_active_match', res.match.id);
            if (res.match.status === 'scheduled' || res.match.status === 'calling') {
              await startAssignedMatch(res.match);
            }
          } catch (err) {
            notify('error', err instanceof Error ? err.message : 'บันทึกสนามไม่สำเร็จ');
          } finally {
            setCourtPromptSaving(false);
          }
        };

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
            role="dialog"
            aria-modal="true"
          >
            <form
              onSubmit={handleConfirmCourt}
              className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] shadow-xl p-5 space-y-4 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-bold">ระบุหมายเลขสนามแข่งก่อนเริ่ม</h3>
                <button
                  type="button"
                  onClick={() => setCourtPromptMatch(null)}
                  className="min-h-[36px] min-w-[36px] rounded-lg hover:bg-[#EFECE4] dark:hover:bg-[#1B293D] flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[#525C6B] dark:text-[#9AA8BC]">
                คู่แข่งขัน <strong>{courtPromptMatch.matchCode}</strong> ({courtPromptMatch.teamAName} vs{' '}
                {courtPromptMatch.teamBName}) ยังไม่ได้กำหนดสนาม กรุณาเลือกหรือกรอกหมายเลขสนามที่จะทำการแข่งขัน
              </p>

              {courts.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {courts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCourtPromptId(c.id)}
                      className={`min-h-[42px] px-3 rounded-xl border text-xs font-bold transition-colors ${
                        courtPromptId === c.id
                          ? 'border-[#156143] bg-[#ECFDF3] text-[#156143] dark:bg-[#0E2E1D] dark:text-[#4ADE80]'
                          : 'border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]'
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}

              <div>
                <label className="block font-semibold mb-1">หรือพิมพ์หมายเลขสนามเอง *</label>
                <input
                  value={
                    courts.find((c) => c.id === courtPromptId)?.name || courtPromptId
                  }
                  onChange={(e) => setCourtPromptId(e.target.value)}
                  placeholder="เช่น สนาม 1 หรือ คอร์ท 5"
                  className="w-full min-h-[44px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCourtPromptMatch(null)}
                  className="flex-1 min-h-[44px] rounded-xl border border-[#E2DFD5] dark:border-[#25354C] font-semibold"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={!courtPromptId.trim() || courtPromptSaving}
                  className="flex-1 min-h-[44px] rounded-xl bg-[#156143] hover:bg-[#104D35] text-white font-bold disabled:opacity-45"
                >
                  {courtPromptSaving ? 'กำลังบันทึก...' : 'ยืนยันสนาม & เริ่มแข่ง'}
                </button>
              </div>
            </form>
          </div>
        );
      })()}
    </div>
  );
};
