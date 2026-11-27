import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Eye,
  ExternalLink,
  FileCheck2,
  Globe,
  Image as ImageIcon,
  Maximize2,
  Phone,
  QrCode,
  Receipt,
  Search,
  ShieldCheck,
  Upload,
  UserCheck,
  UserPlus,
  Users,
  Video,
  X,
  XCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { apiFetch, stageTournamentFile } from '../../services/api';
import { DirectorUmpire, PlayerRecord, Tournament, VerifyStatus } from '../../types/tournament';
import { EmptyStateCard, PaginationBar, StatusIndicator, TeamLogoBadge } from '../common/UIPrimitives';

type SubTab = 'players' | 'directors' | 'payments';
type StatusFilter = 'pending' | 'all' | 'approved' | 'rejected';
type PaymentFilter = 'pending_verify' | 'all' | 'rejected' | 'partial' | 'paid';

const REJECT_SLIP_PRESETS = [
  'ยอดเงินในสลิปไม่ตรงกับค่าสมัคร',
  'ภาพสลิปไม่ชัดเจน / อ่านเลขอ้างอิงไม่ได้',
  'สลิปซ้ำกับใบสมัครอื่น',
  'บัญชีปลายทางหรือวันเวลาโอนไม่ถูกต้อง',
];

export const ApprovalAndPaymentView: React.FC<{ tournament: Tournament }> = ({ tournament }) => {
  const { state, refreshState, hasPermission, notify } = useApp();

  const [subTab, setSubTab] = useState<SubTab>('players');

  // Player Approval filters
  const [playerStatusFilter, setPlayerStatusFilter] = useState<StatusFilter>('pending');
  const [playerSourceFilter, setPlayerSourceFilter] = useState<'all' | 'online' | 'staff'>('all');
  const [playerSearch, setPlayerSearch] = useState('');
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [detailPlayer, setDetailPlayer] = useState<PlayerRecord | null>(null);

  // Director Approval filters
  const [directorStatusFilter, setDirectorStatusFilter] = useState<StatusFilter>('pending');
  const [directorSearch, setDirectorSearch] = useState('');
  const [showDirectorApplyModal, setShowDirectorApplyModal] = useState(false);
  const [dirForm, setDirForm] = useState({
    firstName: '',
    lastName: '',
    nickname: '',
    phone: '',
    email: '',
    photoUrl: '',
    certification: 'กรรมการสมาคมฯ ระดับ 1',
    clubAffiliation: 'อิสระ (ไม่มีสังกัด)',
    experienceNote: '',
  });

  // Payment Verification filters & inspector state
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('pending_verify');
  const [paymentSearch, setPaymentSearch] = useState('');
  const [activePaymentPlayerId, setActivePaymentPlayerId] = useState<string | null>(null);
  const [zoomSlipPlayer, setZoomSlipPlayer] = useState<PlayerRecord | null>(null);

  // Pagination state per tab
  const [playerPage, setPlayerPage] = useState(1);
  const [playerPageSize, setPlayerPageSize] = useState(10);
  const [directorPage, setDirectorPage] = useState(1);
  const [directorPageSize, setDirectorPageSize] = useState(8);
  const [paymentPage, setPaymentPage] = useState(1);
  const [paymentPageSize, setPaymentPageSize] = useState(8);
  const [listedPlayers, setListedPlayers] = useState<PlayerRecord[]>([]);
  const [listedPlayerTotal, setListedPlayerTotal] = useState(0);
  const [listedDirectors, setListedDirectors] = useState<DirectorUmpire[]>([]);
  const [listedDirectorTotal, setListedDirectorTotal] = useState(0);
  const [listedPayments, setListedPayments] = useState<PlayerRecord[]>([]);
  const [listedPaymentTotal, setListedPaymentTotal] = useState(0);

  // Reject Reason Modal state
  const [rejectTarget, setRejectTarget] = useState<
    | { kind: 'player'; player: PlayerRecord }
    | { kind: 'director'; director: DirectorUmpire }
    | { kind: 'payment'; player: PlayerRecord }
    | null
  >(null);
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const tPlayers = useMemo(
    () => state.players.filter((p) => p.tournamentId === tournament.id && !p.withdrawn),
    [state.players, tournament.id]
  );

  const onlinePlayers = useMemo(
    () => tPlayers.filter((p) => p.registrationSource === 'online'),
    [tPlayers]
  );

  const tUmpires = useMemo(
    () => state.umpires.filter((u) => u.tournamentId === tournament.id),
    [state.umpires, tournament.id]
  );

  // Pending badges
  const counts = useMemo(() => {
    const pendingPlayers = tPlayers.filter((p) => p.documentStatus === 'pending').length;
    const pendingDirectors = tUmpires.filter(
      (u) => (u.approvalStatus || 'approved') === 'pending'
    ).length;
    const pendingPayments = onlinePlayers.filter(
      (p) => p.paymentStatus === 'pending_verify' && Boolean(p.slipImageUrl)
    ).length;
    const pendingVerifyAmount = onlinePlayers
      .filter((p) => p.paymentStatus === 'pending_verify')
      .reduce((sum, p) => sum + (p.slipTransferAmount ?? p.amountDue), 0);

    return { pendingPlayers, pendingDirectors, pendingPayments, pendingVerifyAmount };
  }, [tPlayers, tUmpires, onlinePlayers]);

  useEffect(() => {
    if (
      listedPayments.length > 0 &&
      (!activePaymentPlayerId || !listedPayments.some((p) => p.id === activePaymentPlayerId))
    ) {
      setActivePaymentPlayerId(listedPayments[0].id);
    } else if (listedPayments.length === 0) {
      setActivePaymentPlayerId(null);
    }
  }, [listedPayments, activePaymentPlayerId]);

  const activePaymentPlayer = useMemo(
    () => listedPayments.find((p) => p.id === activePaymentPlayerId) || null,
    [listedPayments, activePaymentPlayerId]
  );

  useEffect(() => {
    setPlayerPage(1);
  }, [tournament.id, playerStatusFilter, playerSourceFilter, playerSearch]);

  useEffect(() => {
    setDirectorPage(1);
  }, [tournament.id, directorStatusFilter, directorSearch]);

  useEffect(() => {
    setPaymentPage(1);
  }, [tournament.id, paymentFilter, paymentSearch]);

  useEffect(() => {
    const params = new URLSearchParams({ kind: 'players', tournamentId: tournament.id, page: String(playerPage), pageSize: String(playerPageSize), search: playerSearch, status: playerStatusFilter, source: playerSourceFilter });
    void apiFetch<{items: PlayerRecord[]; pagination: {total: number}}>(`/api/registrations?${params}`).then((data) => { setListedPlayers(data.items); setListedPlayerTotal(data.pagination.total); }).catch((error) => notify('error', error instanceof Error ? error.message : 'โหลดใบสมัครไม่สำเร็จ'));
  }, [tournament.id, playerPage, playerPageSize, playerSearch, playerStatusFilter, playerSourceFilter, state.players, notify]);

  useEffect(() => {
    const params = new URLSearchParams({ kind: 'directors', tournamentId: tournament.id, page: String(directorPage), pageSize: String(directorPageSize), search: directorSearch, status: directorStatusFilter });
    void apiFetch<{items: DirectorUmpire[]; pagination: {total: number}}>(`/api/registrations?${params}`).then((data) => { setListedDirectors(data.items); setListedDirectorTotal(data.pagination.total); }).catch((error) => notify('error', error instanceof Error ? error.message : 'โหลดใบสมัครกรรมการไม่สำเร็จ'));
  }, [tournament.id, directorPage, directorPageSize, directorSearch, directorStatusFilter, state.umpires, notify]);

  useEffect(() => {
    const params = new URLSearchParams({ kind: 'payments', tournamentId: tournament.id, page: String(paymentPage), pageSize: String(paymentPageSize), search: paymentSearch, payment: paymentFilter });
    void apiFetch<{items: PlayerRecord[]; pagination: {total: number}}>(`/api/registrations?${params}`).then((data) => { setListedPayments(data.items); setListedPaymentTotal(data.pagination.total); }).catch((error) => notify('error', error instanceof Error ? error.message : 'โหลดรายการชำระเงินไม่สำเร็จ'));
  }, [tournament.id, paymentPage, paymentPageSize, paymentSearch, paymentFilter, state.players, notify]);

  const paginatedPlayers = listedPlayers;
  const paginatedDirectors = listedDirectors;
  const paginatedPaymentPlayers = listedPayments;

  // Handlers
  const handleReviewPlayer = async (
    player: PlayerRecord,
    decision: 'approved' | 'rejected',
    reason?: string
  ) => {
    setSubmitting(true);
    try {
      await apiFetch(`/api/players/${player.id}/review-approval`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason }),
      });
      await refreshState();
      notify(
        decision === 'approved' ? 'success' : 'warning',
        decision === 'approved'
          ? `อนุมัติผู้เล่น ${player.teamName} (${player.registrationCode}) แล้ว`
          : `ปฏิเสธใบสมัคร ${player.registrationCode} แล้ว`
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'ดำเนินการไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkApprovePlayers = async () => {
    if (selectedPlayerIds.length === 0) return;
    setSubmitting(true);
    try {
      await apiFetch('/api/players/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids: selectedPlayerIds, action: 'approve' }),
      });
      await refreshState();
      notify('success', `ให้ผ่านการตรวจข้อมูลและประเมินมือ ${selectedPlayerIds.length} รายการแล้ว`);
      setSelectedPlayerIds([]);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'อนุมัติไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviewDirector = async (
    director: DirectorUmpire,
    decision: 'approved' | 'rejected',
    reason?: string
  ) => {
    setSubmitting(true);
    try {
      await apiFetch(`/api/umpires/${director.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason }),
      });
      await refreshState();
      notify(
        decision === 'approved' ? 'success' : 'warning',
        decision === 'approved'
          ? `อนุมัติกรรมการ ${director.firstName} ${director.lastName} และเปิดใช้งานรหัส 12 หลักแล้ว`
          : `ปฏิเสธคำขอกรรมการ ${director.firstName} แล้ว`
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'ดำเนินการไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApplyDirector = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/api/umpires/apply', {
        method: 'POST',
        body: JSON.stringify({
          tournamentId: tournament.id,
          ...dirForm,
          codeExpiresAt: `${tournament.endDate} 23:59`,
        }),
      });
      await refreshState();
      setShowDirectorApplyModal(false);
      setDirectorStatusFilter('pending');
      setDirForm({
        firstName: '',
        lastName: '',
        nickname: '',
        phone: '',
        email: '',
        photoUrl: '',
        certification: 'กรรมการสมาคมฯ ระดับ 1',
        clubAffiliation: 'อิสระ (ไม่มีสังกัด)',
        experienceNote: '',
      });
      notify('success', 'ส่งใบสมัครกรรมการออนไลน์เข้าคิวรออนุมัติแล้ว');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'ส่งใบสมัครไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDirectorPhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      notify('error', 'กรุณาเลือกไฟล์รูปภาพ (PNG, JPG, WebP)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 320;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setDirForm((prev) => ({
          ...prev,
          photoUrl: canvas.toDataURL('image/jpeg', 0.85),
        }));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleReviewPayment = async (
    player: PlayerRecord,
    decision: 'approved' | 'rejected' | 'partial',
    paidAmount?: number,
    reason?: string
  ) => {
    setSubmitting(true);
    try {
      await apiFetch(`/api/players/${player.id}/review-payment`, {
        method: 'POST',
        body: JSON.stringify({ decision, paidAmount, reason }),
      });
      await refreshState();
      notify(
        decision === 'rejected' ? 'warning' : 'success',
        decision === 'approved'
          ? `ยืนยันชำระเงิน ${player.registrationCode} เรียบร้อย`
          : decision === 'partial'
          ? `บันทึกชำระบางส่วนสำหรับ ${player.registrationCode} แล้ว`
          : `ปฏิเสธสลิป ${player.registrationCode} และแจ้งโอนใหม่แล้ว`
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'ตรวจสอบสลิปไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUploadSlipFile = async (player: PlayerRecord, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      notify('error', 'กรุณาเลือกไฟล์รูปภาพสลิป (PNG, JPG, WebP)');
      return;
    }
    e.target.value = '';
    setSubmitting(true);
    try {
      const staged = await stageTournamentFile(
        `/api/files/stage?tournamentId=${encodeURIComponent(tournament.id)}`,
        file,
        'payment_slip'
      );
      await apiFetch(`/api/players/${player.id}/upload-slip`, {
        method: 'POST',
        body: JSON.stringify({
          slipFileId: staged.fileId,
          slipTransferBank: 'พร้อมเพย์ (PromptPay QR)',
          slipTransferAmount: player.amountDue || 800,
        }),
      });
      await refreshState();
      setPaymentFilter('pending_verify');
      setActivePaymentPlayerId(player.id);
      notify('success', `แนบสลิปให้ ${player.registrationCode} เข้าคิวรอตรวจสอบแล้ว`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'อัปโหลดสลิปไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  const submitRejectModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget) return;
    const reason = rejectReason.trim() || 'ข้อมูลหรือหลักฐานยังไม่ครบถ้วน';
    if (rejectTarget.kind === 'player') {
      await handleReviewPlayer(rejectTarget.player, 'rejected', reason);
    } else if (rejectTarget.kind === 'director') {
      await handleReviewDirector(rejectTarget.director, 'rejected', reason);
    } else {
      await handleReviewPayment(rejectTarget.player, 'rejected', undefined, reason);
    }
    setRejectTarget(null);
    setRejectReason('');
  };

  const renderSlipVisual = (player: PlayerRecord, large = false) => {
    if (player.slipImageUrl) {
      return (
        <img
          src={player.slipImageUrl}
          alt={`สลิปโอนเงิน ${player.registrationCode}`}
          className={`w-full ${large ? 'max-h-[70vh]' : 'max-h-72'} object-contain rounded-lg bg-white`}
        />
      );
    }
    return (
      <div className={`${large ? 'py-12' : 'py-8'} text-center space-y-3`}>
        <Receipt className="w-9 h-9 text-[#525C6B] mx-auto opacity-60" />
        <div className="text-xs font-semibold text-[#B45309] dark:text-[#FBBF24]">
          ไม่พบไฟล์สลิปจริงในระบบ
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Header & Summary KPIs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#141D2B] dark:text-[#F3F5F8]">
            ศูนย์อนุมัติ & ตรวจสอบการชำระเงินออนไลน์
          </h1>
          <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC] mt-0.5">
            อนุมัติผู้สมัคร (Player), อนุมัติกรรมการ (Director) และตรวจสอบหลักฐานโอนเงินจากการสมัครออนไลน์
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => setSubTab('players')}
          className={`text-left rounded-xl border p-3.5 transition-colors ${
            subTab === 'players'
              ? 'border-[#156143] bg-[#ECFDF3]/50 dark:bg-[#0E2E1D]/30 dark:border-[#229A6B]'
              : 'border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] hover:bg-[#F7F6F2] dark:hover:bg-[#1B293D]'
          }`}
        >
          <div className="text-xs text-[#525C6B] dark:text-[#9AA8BC] flex items-center justify-between">
            <span>นักกีฬารออนุมัติ</span>
            <Users className="w-4 h-4 text-[#156143] dark:text-[#229A6B]" />
          </div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums">
            {counts.pendingPlayers}
          </div>
          <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC] mt-0.5">
            จากทั้งหมด {tPlayers.length} ทีม/คน
          </div>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('directors')}
          className={`text-left rounded-xl border p-3.5 transition-colors ${
            subTab === 'directors'
              ? 'border-[#156143] bg-[#ECFDF3]/50 dark:bg-[#0E2E1D]/30 dark:border-[#229A6B]'
              : 'border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] hover:bg-[#F7F6F2] dark:hover:bg-[#1B293D]'
          }`}
        >
          <div className="text-xs text-[#525C6B] dark:text-[#9AA8BC] flex items-center justify-between">
            <span>กรรมการรออนุมัติ</span>
            <ShieldCheck className="w-4 h-4 text-[#156143] dark:text-[#229A6B]" />
          </div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums">
            {counts.pendingDirectors}
          </div>
          <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC] mt-0.5">
            เปิดใช้รหัส 12 หลักเมื่ออนุมัติ
          </div>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('payments')}
          className={`text-left rounded-xl border p-3.5 transition-colors ${
            subTab === 'payments'
              ? 'border-[#156143] bg-[#ECFDF3]/50 dark:bg-[#0E2E1D]/30 dark:border-[#229A6B]'
              : 'border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] hover:bg-[#F7F6F2] dark:hover:bg-[#1B293D]'
          }`}
        >
          <div className="text-xs text-[#525C6B] dark:text-[#9AA8BC] flex items-center justify-between">
            <span>สลิปออนไลน์รอตรวจ</span>
            <Receipt className="w-4 h-4 text-[#D97706] dark:text-[#FACC15]" />
          </div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-[#B45309] dark:text-[#FACC15]">
            {counts.pendingPayments}
          </div>
          <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC] mt-0.5">
            ผู้สมัครออนไลน์ {onlinePlayers.length} รายการ
          </div>
        </button>

        <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-3.5">
          <div className="text-xs text-[#525C6B] dark:text-[#9AA8BC] flex items-center justify-between">
            <span>ยอดสลิปรอตรวจสอบ</span>
            <CreditCard className="w-4 h-4 text-[#142642] dark:text-[#9AA8BC]" />
          </div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums">
            ฿{counts.pendingVerifyAmount.toLocaleString()}
          </div>
          <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC] mt-0.5">
            PromptPay / โอนธนาคารออนไลน์
          </div>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-[#EFECE4] dark:bg-[#1B293D] w-fit">
          <button
            type="button"
            onClick={() => setSubTab('players')}
            className={`min-h-[40px] px-3.5 py-2 rounded-md text-xs font-semibold inline-flex items-center gap-2 transition-colors ${
              subTab === 'players'
                ? 'bg-white dark:bg-[#131E2E] shadow-sm text-[#141D2B] dark:text-[#F3F5F8]'
                : 'text-[#525C6B] dark:text-[#9AA8BC]'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            <span>อนุมัติ Player</span>
            {counts.pendingPlayers > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-[#FEF9C3] text-[#713F12] dark:bg-[#332409] dark:text-[#FACC15] font-mono text-[11px]">
                {counts.pendingPlayers}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSubTab('directors')}
            className={`min-h-[40px] px-3.5 py-2 rounded-md text-xs font-semibold inline-flex items-center gap-2 transition-colors ${
              subTab === 'directors'
                ? 'bg-white dark:bg-[#131E2E] shadow-sm text-[#141D2B] dark:text-[#F3F5F8]'
                : 'text-[#525C6B] dark:text-[#9AA8BC]'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>อนุมัติ Director / กรรมการ</span>
            {counts.pendingDirectors > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-[#FEF9C3] text-[#713F12] dark:bg-[#332409] dark:text-[#FACC15] font-mono text-[11px]">
                {counts.pendingDirectors}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSubTab('payments')}
            className={`min-h-[40px] px-3.5 py-2 rounded-md text-xs font-semibold inline-flex items-center gap-2 transition-colors ${
              subTab === 'payments'
                ? 'bg-white dark:bg-[#131E2E] shadow-sm text-[#141D2B] dark:text-[#F3F5F8]'
                : 'text-[#525C6B] dark:text-[#9AA8BC]'
            }`}
          >
            <FileCheck2 className="w-4 h-4" />
            <span>ตรวจชำระเงิน (สมัครออนไลน์)</span>
            {counts.pendingPayments > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-[#FEF2F2] text-[#B91C1C] dark:bg-[#361215] dark:text-[#F87171] font-mono text-[11px]">
                {counts.pendingPayments}
              </span>
            )}
          </button>
        </div>

        {subTab === 'directors' && <span className="text-[11px] text-[#667085] dark:text-[#9AA8BC]">QR สมัครออนไลน์อยู่ที่เมนู สมาชิก › กรรมการ</span>}
      </div>

      {/* TAB 1: PLAYER APPROVAL */}
      {subTab === 'players' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#B9D8CB] bg-[#F1FAF6] p-3 text-xs text-[#156143] dark:border-[#24533F] dark:bg-[#10291E] dark:text-[#86E0B4]">
            <strong>อนุมัติครั้งที่ 1 — ตรวจข้อมูลและประเมินระดับมือ:</strong> เปิดดูข้อมูลนักกีฬาทุกคน รูปถ่าย คลิปประเมินมือ และรุ่นที่สมัครก่อนกดให้ผ่าน เมื่อผ่านแล้วผู้สมัครจึงชำระเงินและแนบสลิปได้
          </div>
          <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { id: 'pending', label: `รออนุมัติ (${counts.pendingPlayers})` },
                  { id: 'approved', label: 'อนุมัติแล้ว' },
                  { id: 'rejected', label: 'ปฏิเสธ' },
                  { id: 'all', label: 'ทั้งหมด' },
                ] as { id: StatusFilter; label: string }[]
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setPlayerStatusFilter(f.id);
                    setSelectedPlayerIds([]);
                  }}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors ${
                    playerStatusFilter === f.id
                      ? 'bg-[#156143] text-white'
                      : 'border border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={playerSourceFilter}
                onChange={(e) => setPlayerSourceFilter(e.target.value as 'all' | 'online' | 'staff')}
                className="min-h-[38px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs font-medium"
              >
                <option value="all">ทุกช่องทางสมัคร</option>
                <option value="online">สมัครออนไลน์</option>
                <option value="staff">เจ้าหน้าที่รับสมัคร</option>
              </select>

              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 text-[#525C6B] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={playerSearch}
                  onChange={(e) => setPlayerSearch(e.target.value)}
                  placeholder="ค้นหารหัส ทีม ชื่อนักกีฬา..."
                  className="w-full min-h-[38px] pl-9 pr-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs"
                />
              </div>
            </div>
          </div>

          {selectedPlayerIds.length > 0 && hasPermission('approveRegistration') && (
            <div className="rounded-xl border border-[#156143]/30 bg-[#ECFDF3] dark:bg-[#0E2E1D] px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-[#156143] dark:text-[#4ADE80]">
                เลือกนักกีฬาอยู่ {selectedPlayerIds.length} รายการ
              </span>
              <button
                type="button"
                disabled={submitting}
                onClick={handleBulkApprovePlayers}
                className="min-h-[36px] px-3.5 rounded-lg bg-[#156143] hover:bg-[#104D35] text-white font-semibold inline-flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>ผ่านการประเมินทั้งหมดที่เลือก</span>
              </button>
            </div>
          )}

          {paginatedPlayers.length === 0 ? (
            <EmptyStateCard
              title="ไม่มีรายการนักกีฬาในสถานะนี้"
              description="ลองสลับตัวกรองเป็น 'ทั้งหมด' เพื่อดูรายการที่อนุมัติแล้ว"
            />
          ) : (
            <div className="space-y-3">
              {paginatedPlayers.map((p) => {
                const div = tournament.divisions.find((d) => d.id === p.divisionId);
                const isOnline = (p.registrationSource || 'online') === 'online';
                return (
                  <div
                    key={p.id}
                    className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedPlayerIds.includes(p.id)}
                        onChange={(e) =>
                          setSelectedPlayerIds((prev) =>
                            e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                          )
                        }
                        className="mt-1.5"
                        aria-label={`เลือก ${p.teamName}`}
                      />
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-[#156143] dark:text-[#229A6B]">
                            {p.registrationCode}
                          </span>
                          {p.verificationCode && (
                            <span className="px-2 py-0.5 rounded bg-[#EFECE4] dark:bg-[#1B293D] font-mono text-[11px] font-semibold text-[#141D2B] dark:text-[#F3F5F8]">
                              Verify: {p.verificationCode}
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold inline-flex items-center gap-1 ${
                              isOnline
                                ? 'bg-[#EFF6FF] text-[#1D4ED8] dark:bg-[#162742] dark:text-[#93C5FD]'
                                : 'bg-[#F7F6F2] text-[#525C6B] dark:bg-[#1B293D] dark:text-[#9AA8BC]'
                            }`}
                          >
                            <Globe className="w-3 h-3" />
                            {isOnline ? 'สมัครออนไลน์' : 'เจ้าหน้าที่สมัคร'}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-[#EFECE4] dark:bg-[#1B293D] text-[11px] font-semibold">
                            {p.format === 'singles' ? 'เดี่ยว 1 คน' : 'คู่ 2 คน'}
                          </span>
                          <StatusIndicator
                            tone={
                              p.documentStatus === 'approved'
                                ? 'success'
                                : p.documentStatus === 'rejected'
                                ? 'danger'
                                : 'warning'
                            }
                            label={
                              p.documentStatus === 'approved'
                                ? 'อนุมัติแล้ว'
                                : p.documentStatus === 'rejected'
                                ? 'ปฏิเสธ'
                                : 'รออนุมัติ'
                            }
                            compact
                          />
                          {p.possibleDuplicateOf && (
                            <span className="px-2 py-0.5 rounded bg-[#FEF9C3] text-[#713F12] text-[11px] font-semibold inline-flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              อาจซ้ำซ้อน
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2.5">
                          <TeamLogoBadge teamName={p.teamName} logoUrl={p.teamLogoUrl} size="md" />
                          {(p.photoUrl || p.partnerPhotoUrl) && (
                            <div className="flex -space-x-2 shrink-0">
                              {p.photoUrl && (
                                <img
                                  src={p.photoUrl}
                                  alt={p.firstName}
                                  className="w-9 h-9 rounded-lg object-cover border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2]"
                                />
                              )}
                              {p.format === 'doubles' && p.partnerPhotoUrl && (
                                <img
                                  src={p.partnerPhotoUrl}
                                  alt={p.partnerName || 'Partner'}
                                  className="w-9 h-9 rounded-lg object-cover border border-white dark:border-[#131E2E] bg-[#F7F6F2]"
                                />
                              )}
                            </div>
                          )}
                          <div className="text-sm sm:text-base font-bold text-[#141D2B] dark:text-[#F3F5F8] truncate">
                            {p.teamName}
                          </div>
                        </div>

                        <div className="text-xs text-[#525C6B] dark:text-[#9AA8BC] flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span>
                            นักกีฬา: <strong className="text-[#141D2B] dark:text-[#F3F5F8]">{p.firstName} {p.lastName}</strong> ({p.nickname})
                            {p.partnerName ? ` · คู่: ${p.partnerName}` : ''}
                          </span>
                          <span>รุ่น: <strong className="text-[#141D2B] dark:text-[#F3F5F8]">{div?.nameTh}</strong></span>
                          <span>สโมสร: {p.club} ({p.province})</span>
                          <span className="inline-flex items-center gap-1">
                            <Phone className="w-3 h-3" /> {p.phone}
                          </span>
                        </div>

                        <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC] flex flex-wrap items-center gap-3">
                          <span>สมัครเมื่อ: <span className="font-mono">{p.registeredAt}</span></span>
                          <span>PDPA: {p.pdpaConsent ? 'ยินยอมแล้ว' : 'ยังไม่ยินยอม'}</span>
                          <span>
                            ชำระเงิน:{' '}
                            <strong
                              className={
                                p.paymentStatus === 'paid'
                                  ? 'text-[#15803D] dark:text-[#4ADE80]'
                                  : p.slipStatus === 'rejected'
                                  ? 'text-[#B91C1C] dark:text-[#F87171]'
                                  : 'text-[#B45309] dark:text-[#FACC15]'
                              }
                            >
                              {p.paymentStatus === 'paid'
                                ? `ชำระแล้ว ฿${p.amountPaid}`
                                : p.paymentStatus === 'pending_verify'
                                ? 'มีสลิปรอตรวจ'
                                : p.slipStatus === 'rejected'
                                ? 'สลิปไม่ผ่าน (รอแนบใหม่)'
                                : `ค้างชำระหน้างาน ฿${p.amountDue}`}
                            </strong>
                          </span>
                          {p.skillVideoUrl && (
                            <a
                              href={p.skillVideoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-semibold text-[#1D4ED8] dark:text-[#93C5FD] hover:underline"
                            >
                              <Video className="w-3 h-3" />
                              <span>ดูคลิปประเมินมือ</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                          {p.approvalNote && (
                            <span className="text-[#B91C1C] dark:text-[#F87171]">
                              หมายเหตุ: {p.approvalNote}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0 pl-6 lg:pl-0">
                      <button
                        type="button"
                        onClick={() => setDetailPlayer(p)}
                        className="min-h-[38px] px-3 rounded-lg border border-[#B9D8CB] text-[#156143] dark:border-[#24533F] dark:text-[#86E0B4] hover:bg-[#F1FAF6] dark:hover:bg-[#10291E] text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>ดูข้อมูล / ประเมินมือ</span>
                      </button>
                      {isOnline && p.paymentStatus === 'pending_verify' && (
                        <button
                          type="button"
                          onClick={() => {
                            setSubTab('payments');
                            setPaymentFilter('pending_verify');
                            setActivePaymentPlayerId(p.id);
                          }}
                          className="min-h-[38px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D] text-xs font-semibold inline-flex items-center gap-1.5"
                        >
                          <Receipt className="w-3.5 h-3.5 text-[#D97706]" />
                          <span>ตรวจสลิป</span>
                        </button>
                      )}

                      {hasPermission('approveRegistration') && p.documentStatus !== 'approved' && (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => handleReviewPlayer(p, 'approved')}
                          className="min-h-[38px] px-3.5 rounded-lg bg-[#156143] hover:bg-[#104D35] text-white text-xs font-semibold inline-flex items-center gap-1.5"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>ผ่านการประเมินมือ</span>
                        </button>
                      )}

                      {hasPermission('approveRegistration') && p.documentStatus !== 'rejected' && (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => {
                            setRejectReason('');
                            setRejectTarget({ kind: 'player', player: p });
                          }}
                          className="min-h-[38px] px-3 rounded-lg border border-[#FECACA] dark:border-[#7F1D1D] text-[#B91C1C] dark:text-[#F87171] hover:bg-[#FEF2F2] dark:hover:bg-[#361215] text-xs font-semibold inline-flex items-center gap-1.5"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>ปฏิเสธ</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              <PaginationBar
                page={playerPage}
                pageSize={playerPageSize}
                totalItems={listedPlayerTotal}
                onPageChange={setPlayerPage}
                onPageSizeChange={setPlayerPageSize}
                pageSizeOptions={[10, 20, 50]}
              />
            </div>
          )}
        </div>
      )}

      {/* TAB 2: DIRECTOR / UMPIRE APPROVAL */}
      {subTab === 'directors' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { id: 'pending', label: `รออนุมัติ (${counts.pendingDirectors})` },
                  { id: 'approved', label: 'อนุมัติแล้ว' },
                  { id: 'rejected', label: 'ปฏิเสธ' },
                  { id: 'all', label: 'ทั้งหมด' },
                ] as { id: StatusFilter; label: string }[]
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setDirectorStatusFilter(f.id)}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors ${
                    directorStatusFilter === f.id
                      ? 'bg-[#156143] text-white'
                      : 'border border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="relative sm:w-64">
              <Search className="w-4 h-4 text-[#525C6B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={directorSearch}
                onChange={(e) => setDirectorSearch(e.target.value)}
                placeholder="ค้นหาชื่อกรรมการ รหัส สโมสร..."
                className="w-full min-h-[38px] pl-9 pr-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs"
              />
            </div>
          </div>

          {paginatedDirectors.length === 0 ? (
            <EmptyStateCard
              title="ไม่มีคำขออนุมัติกรรมการในสถานะนี้"
              description="เปิด QR สมัครออนไลน์ได้จากเมนู สมาชิก › กรรมการ หรือสลับดูสถานะทั้งหมด"
            />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {paginatedDirectors.map((u) => {
                const status: VerifyStatus = u.approvalStatus || 'approved';
                const isOnline = u.applicationSource === 'online';
                return (
                  <div
                    key={u.id}
                    className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-3 min-w-0">
                          {u.photoUrl ? (
                            <img
                              src={u.photoUrl}
                              alt={`${u.firstName} ${u.lastName}`}
                              referrerPolicy="no-referrer"
                              className="w-12 h-12 rounded-xl object-cover border border-[#E2DFD5] dark:border-[#25354C] shrink-0 bg-[#F7F6F2]"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] flex items-center justify-center text-[#525C6B] dark:text-[#9AA8BC] shrink-0">
                              <UserCheck className="w-5 h-5" />
                            </div>
                          )}
                          <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs font-bold text-[#156143] dark:text-[#229A6B]">
                                {u.code}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded text-[11px] font-semibold inline-flex items-center gap-1 ${
                                  isOnline
                                    ? 'bg-[#EFF6FF] text-[#1D4ED8] dark:bg-[#162742] dark:text-[#93C5FD]'
                                    : 'bg-[#F7F6F2] text-[#525C6B] dark:bg-[#1B293D] dark:text-[#9AA8BC]'
                                }`}
                              >
                                {isOnline ? 'สมัครออนไลน์' : 'เพิ่มโดยทีมงาน'}
                              </span>
                            </div>
                            <h3 className="text-base font-bold text-[#141D2B] dark:text-[#F3F5F8] truncate">
                              {u.firstName} {u.lastName} {u.nickname ? `(${u.nickname})` : ''}
                            </h3>
                          </div>
                        </div>

                        <StatusIndicator
                          tone={
                            status === 'approved'
                              ? 'success'
                              : status === 'rejected'
                              ? 'danger'
                              : 'warning'
                          }
                          label={
                            status === 'approved'
                              ? 'อนุมัติแล้ว'
                              : status === 'rejected'
                              ? 'ปฏิเสธ'
                              : 'รออนุมัติ'
                          }
                          compact
                        />
                      </div>

                      <div className="space-y-1 text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                        <div className="flex items-center gap-1.5">
                          <Award className="w-3.5 h-3.5 shrink-0 text-[#156143]" />
                          <span className="font-medium text-[#141D2B] dark:text-[#F3F5F8]">
                            {u.certification}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 shrink-0" />
                          <span>สังกัด: {u.clubAffiliation || 'อิสระ'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {u.phone} {u.email ? `· ${u.email}` : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            PDPA: {u.pdpaConsent ? 'ยินยอมแล้ว' : 'ไม่พบข้อมูล'} · ตัดสินได้ทุกระดับ · ไม่มีค่าธรรมเนียม
                          </span>
                        </div>
                      </div>

                      {u.experienceNote && (
                        <div className="p-2.5 rounded-lg bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] text-xs text-[#141D2B] dark:text-[#F3F5F8]">
                          <span className="text-[#525C6B] dark:text-[#9AA8BC]">ประสบการณ์: </span>
                          {u.experienceNote}
                        </div>
                      )}

                      {u.documentFileId && (
                        <a href={`/api/tournament/files/${encodeURIComponent(u.documentFileId)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#BBDCCF] bg-[#F1FAF6] px-3 text-xs font-semibold text-[#156143] dark:border-[#24533F] dark:bg-[#10291E] dark:text-[#4ADE80]">
                          <FileCheck2 className="h-4 w-4" />
                          <span>เปิดเอกสารประกอบ{u.documentName ? ` · ${u.documentName}` : ''}</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}

                      <div className="p-2.5 rounded-lg bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] flex items-center justify-between text-xs">
                        <span className="text-[#525C6B] dark:text-[#9AA8BC]">รหัสเข้า PWA 12 หลัก</span>
                        <span className="font-mono font-bold">
                          {status === 'approved' && u.active
                            ? u.loginCode12
                              ? u.loginCode12
                              : `••••••••${u.loginCodeLast4 || '••••'}`
                            : 'รอเปิดใช้งานเมื่ออนุมัติ'}
                        </span>
                      </div>

                      {u.approvalNote && (
                        <div className="text-[11px] text-[#B91C1C] dark:text-[#F87171]">
                          หมายเหตุ: {u.approvalNote}
                        </div>
                      )}
                    </div>

                    {hasPermission('assignUmpire') && (
                      <div className="pt-2 border-t border-[#E2DFD5] dark:border-[#25354C] flex flex-wrap gap-2">
                        {status !== 'approved' && (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => handleReviewDirector(u, 'approved')}
                            className="flex-1 min-h-[38px] px-3.5 rounded-lg bg-[#156143] hover:bg-[#104D35] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                          >
                            <Check className="w-4 h-4" />
                            <span>อนุมัติ & เปิดใช้รหัส 12 หลัก</span>
                          </button>
                        )}
                        {status !== 'rejected' && (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => {
                              setRejectReason('');
                              setRejectTarget({ kind: 'director', director: u });
                            }}
                            className="min-h-[38px] px-3 rounded-lg border border-[#FECACA] dark:border-[#7F1D1D] text-[#B91C1C] dark:text-[#F87171] hover:bg-[#FEF2F2] dark:hover:bg-[#361215] text-xs font-semibold inline-flex items-center gap-1.5"
                          >
                            <X className="w-4 h-4" />
                            <span>ปฏิเสธ</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
                })}
              </div>
              <PaginationBar
                page={directorPage}
                pageSize={directorPageSize}
                totalItems={listedDirectorTotal}
                onPageChange={setDirectorPage}
                onPageSizeChange={setDirectorPageSize}
                pageSizeOptions={[8, 16, 32]}
              />
            </div>
          )}
        </div>
      )}

      {/* TAB 3: ONLINE REGISTRATION PAYMENT VERIFICATION */}
      {subTab === 'payments' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { id: 'pending_verify', label: `รอตรวจสลิป (${counts.pendingPayments})` },
                  { id: 'rejected', label: 'สลิปไม่ผ่าน / รอแนบใหม่' },
                  { id: 'partial', label: 'ชำระบางส่วน' },
                  { id: 'paid', label: 'ยืนยันแล้ว' },
                  { id: 'all', label: 'สมัครออนไลน์ทั้งหมด' },
                ] as { id: PaymentFilter; label: string }[]
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setPaymentFilter(f.id)}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors ${
                    paymentFilter === f.id
                      ? 'bg-[#156143] text-white'
                      : 'border border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="relative sm:w-64">
              <Search className="w-4 h-4 text-[#525C6B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={paymentSearch}
                onChange={(e) => setPaymentSearch(e.target.value)}
                placeholder="ค้นหารหัสสมัคร ชื่อทีม เลขอ้างอิงสลิป..."
                className="w-full min-h-[38px] pl-9 pr-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs"
              />
            </div>
          </div>

          {paginatedPaymentPlayers.length === 0 ? (
            <EmptyStateCard
              title="ไม่มีรายการชำระเงินออนไลน์ในหมวดนี้"
              description="เลือกดู 'สมัครออนไลน์ทั้งหมด' เพื่อตรวจดูรายการที่ยืนยันชำระเงินแล้วหรือรอแนบสลิป"
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              {/* Left Queue List */}
              <div className="lg:col-span-5 space-y-2.5">
                {paginatedPaymentPlayers.map((p) => {
                  const div = tournament.divisions.find((d) => d.id === p.divisionId);
                  const isActive = p.id === activePaymentPlayerId;
                  const totalFee = p.amountPaid + p.amountDue;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setActivePaymentPlayerId(p.id)}
                      className={`w-full text-left rounded-xl border p-3.5 transition-all ${
                        isActive
                          ? 'border-[#156143] bg-[#ECFDF3]/60 dark:bg-[#0E2E1D]/40 dark:border-[#229A6B] ring-1 ring-[#156143]/30'
                          : 'border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] hover:bg-[#F7F6F2] dark:hover:bg-[#1B293D]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-[#156143] dark:text-[#229A6B]">
                          {p.registrationCode}
                        </span>
                        <StatusIndicator
                          tone={
                            p.paymentStatus === 'paid'
                              ? 'success'
                              : p.paymentStatus === 'pending_verify'
                              ? 'warning'
                              : p.paymentStatus === 'partial'
                              ? 'info'
                              : 'danger'
                          }
                          label={
                            p.paymentStatus === 'paid'
                              ? 'ชำระแล้ว'
                              : p.paymentStatus === 'pending_verify'
                              ? 'รอตรวจสลิป'
                              : p.paymentStatus === 'partial'
                              ? 'ชำระบางส่วน'
                              : p.slipStatus === 'rejected'
                              ? 'สลิปไม่ผ่าน'
                              : 'รอแนบสลิปใหม่'
                          }
                          compact
                        />
                      </div>

                      <div className="mt-1.5 flex items-center gap-2">
                        <TeamLogoBadge teamName={p.teamName} logoUrl={p.teamLogoUrl} size="sm" />
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-[#141D2B] dark:text-[#F3F5F8] truncate">
                            {p.teamName}
                          </div>
                          <div className="text-xs text-[#525C6B] dark:text-[#9AA8BC] truncate">
                            {p.firstName} {p.lastName} · {div?.nameTh}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 pt-2 border-t border-[#E2DFD5] dark:border-[#25354C] flex items-center justify-between text-xs">
                        <span className="text-[#525C6B] dark:text-[#9AA8BC]">
                          {p.slipTransferBank || p.paymentChannel || 'ยังไม่ระบุช่องทาง'}
                        </span>
                        <span className="font-mono tabular-nums font-bold">
                          ชำระ ฿{p.amountPaid.toLocaleString()} / ฿{totalFee.toLocaleString()}
                        </span>
                      </div>
                    </button>
                  );
                })}
                <PaginationBar
                  page={paymentPage}
                  pageSize={paymentPageSize}
                  totalItems={listedPaymentTotal}
                  onPageChange={setPaymentPage}
                  onPageSizeChange={setPaymentPageSize}
                  pageSizeOptions={[8, 16, 30]}
                />
              </div>

              {/* Right Side-by-Side Slip Inspector */}
              {activePaymentPlayer && (
                <div className="lg:col-span-7 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 sm:p-5 space-y-4">
                  {(() => {
                    const p = activePaymentPlayer;
                    const div = tournament.divisions.find((d) => d.id === p.divisionId);
                    const totalFee = p.amountPaid + p.amountDue;
                    const slipAmt = p.paymentStatus === 'pending_verify'
                      ? (p.slipTransferAmount ?? totalFee)
                      : p.amountPaid;
                    const hasSlip = Boolean(p.slipImageUrl) && p.slipStatus !== 'not_uploaded';
                    const isExactMatch = hasSlip && slipAmt === totalFee;
                    const isUnderpaid = hasSlip && slipAmt < totalFee;

                    return (
                      <>
                        <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-[#E2DFD5] dark:border-[#25354C]">
                          <div className="flex items-start gap-3">
                            <TeamLogoBadge teamName={p.teamName} logoUrl={p.teamLogoUrl} size="md" />
                            {(p.photoUrl || p.partnerPhotoUrl) && (
                              <div className="flex -space-x-2 shrink-0 mt-0.5">
                                {p.photoUrl && (
                                  <img
                                    src={p.photoUrl}
                                    alt={p.firstName}
                                    className="w-10 h-10 rounded-lg object-cover border border-[#E2DFD5] dark:border-[#25354C]"
                                  />
                                )}
                                {p.format === 'doubles' && p.partnerPhotoUrl && (
                                  <img
                                    src={p.partnerPhotoUrl}
                                    alt={p.partnerName || 'Partner'}
                                    className="w-10 h-10 rounded-lg object-cover border border-white dark:border-[#131E2E]"
                                  />
                                )}
                              </div>
                            )}
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-xs font-bold text-[#156143] dark:text-[#229A6B]">
                                  {p.registrationCode}
                                </span>
                                <span className="px-2 py-0.5 rounded bg-[#EFF6FF] text-[#1D4ED8] dark:bg-[#162742] dark:text-[#93C5FD] text-[11px] font-semibold">
                                  สมัครออนไลน์
                                </span>
                                <span className="px-2 py-0.5 rounded bg-[#EFECE4] dark:bg-[#1B293D] text-[11px] font-semibold">
                                  {p.format === 'singles' ? 'เดี่ยว 1 คน' : 'คู่ 2 คน'}
                                </span>
                              </div>
                              <h3 className="text-base sm:text-lg font-bold mt-1">{p.teamName}</h3>
                              <div className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                                {p.firstName} {p.lastName}
                                {p.partnerName ? ` · คู่: ${p.partnerName}` : ''} · {div?.nameTh} · โทร {p.phone}
                              </div>
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">ค่าสมัครตามระบบ</div>
                            <div className="text-xl font-bold font-mono tabular-nums text-[#141D2B] dark:text-[#F3F5F8]">
                              ฿{totalFee.toLocaleString()}
                            </div>
                          </div>
                        </div>

                        {/* Amount Matching Banner */}
                        {hasSlip && p.paymentStatus !== 'paid' && (
                          <div
                            className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                              isExactMatch
                                ? 'bg-[#ECFDF3] border-[#BBF7D0] text-[#14532D] dark:bg-[#0E2E1D] dark:border-[#1E593A] dark:text-[#86EFAC]'
                                : isUnderpaid
                                ? 'bg-[#FEF9C3] border-[#FDE047] text-[#713F12] dark:bg-[#332409] dark:border-[#5C410D] dark:text-[#FDE047]'
                                : 'bg-[#EFF6FF] border-[#BFDBFE] text-[#1E3A8A]'
                            }`}
                          >
                            {isExactMatch ? (
                              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                            )}
                            <div>
                              <div className="font-bold">
                                {isExactMatch
                                  ? `ยอดโอนในสลิปตรงกับค่าสมัคร (฿${slipAmt.toLocaleString()})`
                                  : `ยอดโอนในสลิปไม่ตรงกับค่าสมัคร! โอนมา ฿${slipAmt.toLocaleString()} จากยอด ฿${totalFee.toLocaleString()}`}
                              </div>
                              {p.notes && <div className="mt-0.5 opacity-90">หมายเหตุผู้สมัคร: {p.notes}</div>}
                            </div>
                          </div>
                        )}

                        {p.paymentRejectReason && (
                          <div className="p-3 rounded-lg border border-[#FECACA] bg-[#FEF2F2] text-[#991B1B] dark:bg-[#361215] dark:border-[#7F1D1D] dark:text-[#FCA5A5] text-xs flex items-start gap-2">
                            <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                            <div>
                              <span className="font-bold">หมายเหตุ/เหตุผลล่าสุด: </span>
                              {p.paymentRejectReason}
                            </div>
                          </div>
                        )}

                        {/* Slip Preview Area */}
                        <div className="rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold flex items-center gap-1.5">
                              <ImageIcon className="w-4 h-4 text-[#156143]" />
                              หลักฐานสลิปโอนเงินออนไลน์
                            </span>
                            {hasSlip && (
                              <button
                                type="button"
                                onClick={() => setZoomSlipPlayer(p)}
                                className="text-xs font-semibold text-[#156143] dark:text-[#4ADE80] inline-flex items-center gap-1 hover:underline"
                              >
                                <Maximize2 className="w-3.5 h-3.5" />
                                <span>ขยายดูสลิป</span>
                              </button>
                            )}
                          </div>

                          {hasSlip ? (
                            <div
                              onClick={() => setZoomSlipPlayer(p)}
                              className="cursor-pointer"
                              title="คลิกเพื่อขยายดูสลิป"
                            >
                              {renderSlipVisual(p)}
                            </div>
                          ) : (
                            <div className="py-8 text-center space-y-3">
                              <Receipt className="w-9 h-9 text-[#525C6B] mx-auto opacity-60" />
                              <div className="text-xs font-semibold text-[#B45309] dark:text-[#FBBF24]">
                                ไม่พบไฟล์สลิปจริง จึงยังไม่สามารถอนุมัติการชำระเงินได้
                              </div>
                              <div className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                                ให้ผู้สมัครอัปโหลดสลิปใหม่ หรือเจ้าหน้าที่แนบไฟล์สลิปด้านล่าง
                              </div>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                            <label className="min-h-[36px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D] font-medium inline-flex items-center gap-1.5 cursor-pointer">
                              <Upload className="w-3.5 h-3.5" />
                              <span>{hasSlip ? 'อัปโหลดสลิปใหม่แทน' : 'แนบสลิปโอนเงิน'}</span>
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                onChange={(e) => handleUploadSlipFile(p, e)}
                                className="sr-only"
                              />
                            </label>

                            {p.paymentVerifiedBy && (
                              <span className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
                                ตรวจล่าสุดโดย {p.paymentVerifiedBy} ({p.paymentVerifiedAt})
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Verification Actions */}
                        {hasPermission('verifyPayment') && p.paymentStatus !== 'paid' && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            <button
                              type="button"
                              disabled={submitting || !hasSlip}
                              onClick={() =>
                                handleReviewPayment(
                                  p,
                                  'approved',
                                  isExactMatch ? slipAmt : totalFee
                                )
                              }
                              className="flex-1 min-h-[44px] px-4 rounded-xl bg-[#156143] hover:bg-[#104D35] disabled:opacity-45 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5"
                            >
                              <Check className="w-4 h-4" />
                              <span>อนุมัติชำระครบ (฿{totalFee.toLocaleString()})</span>
                            </button>

                            {isUnderpaid && (
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() =>
                                  handleReviewPayment(
                                    p,
                                    'partial',
                                    slipAmt,
                                    `รับชำระมัดจำ/บางส่วน ฿${slipAmt.toLocaleString()} (คงเหลือ ฿${(totalFee - slipAmt).toLocaleString()})`
                                  )
                                }
                                className="min-h-[44px] px-3.5 rounded-xl bg-[#142642] hover:bg-[#1E355C] text-white text-xs font-semibold inline-flex items-center gap-1.5"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                                <span>รับชำระบางส่วน (฿{slipAmt.toLocaleString()})</span>
                              </button>
                            )}

                            <button
                              type="button"
                              disabled={submitting || !hasSlip}
                              onClick={() => {
                                setRejectReason(
                                  isUnderpaid ? 'ยอดเงินในสลิปไม่ตรงกับค่าสมัคร' : ''
                                );
                                setRejectTarget({ kind: 'payment', player: p });
                              }}
                              className="min-h-[44px] px-3.5 rounded-xl border border-[#FECACA] dark:border-[#7F1D1D] text-[#B91C1C] dark:text-[#F87171] hover:bg-[#FEF2F2] dark:hover:bg-[#361215] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-45"
                            >
                              <X className="w-4 h-4" />
                              <span>ปฏิเสธสลิป</span>
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Player Application Detail / Skill Assessment Modal */}
      {detailPlayer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-0 sm:p-4" role="dialog" aria-modal="true" onClick={() => setDetailPlayer(null)}>
          <div className="flex max-h-[100dvh] w-full max-w-5xl flex-col overflow-hidden rounded-none border border-[#E2DFD5] bg-white shadow-xl dark:border-[#25354C] dark:bg-[#131E2E] sm:max-h-[92dvh] sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-[#E2DFD5] p-4 dark:border-[#25354C]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-[#F1FAF6] px-2 py-1 text-[11px] font-bold text-[#156143] dark:bg-[#10291E] dark:text-[#86E0B4]">อนุมัติครั้งที่ 1</span>
                  <span className="font-mono text-xs font-bold">{detailPlayer.registrationCode}</span>
                </div>
                <h3 className="mt-1 text-base font-bold">ตรวจข้อมูลและประเมินมือ · {detailPlayer.teamName}</h3>
                <p className="mt-1 text-xs text-[#667085] dark:text-[#9AA8BC]">ตรวจรูป ข้อมูลผู้สมัครทุกคน คลิปประเมินมือ และระดับที่สมัคร ก่อนให้ผ่านเข้าสู่ขั้นตอนชำระเงิน</p>
              </div>
              <button type="button" onClick={() => setDetailPlayer(null)} className="flex min-h-10 min-w-10 items-center justify-center rounded-lg hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"><X className="h-4 w-4" /></button>
            </div>

            <div className="overflow-y-auto p-4 sm:p-5">
              {(() => {
                const division = tournament.divisions.find((item) => item.id === detailPlayer.divisionId);
                const members = detailPlayer.members?.length ? detailPlayer.members : [{
                  role: 'primary' as const,
                  firstName: detailPlayer.firstName,
                  lastName: detailPlayer.lastName,
                  nickname: detailPlayer.nickname,
                  gender: detailPlayer.gender,
                  birthDate: detailPlayer.birthDate,
                  nationality: detailPlayer.nationality || '',
                  idDocumentNo: detailPlayer.idDocumentNo,
                  address: detailPlayer.address || '',
                  phone: detailPlayer.phone,
                  email: detailPlayer.email,
                  club: detailPlayer.club,
                  province: detailPlayer.province,
                  shirtSize: detailPlayer.shirtSize,
                  photoUrl: detailPlayer.photoUrl,
                  emergencyContact: detailPlayer.emergencyContact,
                  healthInfo: detailPlayer.healthInfo,
                  healthConsent: detailPlayer.healthConsent,
                  pdpaConsent: detailPlayer.pdpaConsent,
                }];
                return (
                  <div className="space-y-4 text-xs">
                    <section className="grid gap-3 rounded-xl border border-[#E2DFD5] bg-[#F7F6F2] p-4 dark:border-[#25354C] dark:bg-[#0B121C] sm:grid-cols-2 lg:grid-cols-4">
                      <div><span className="text-[#667085]">ทีม:</span><strong className="ml-1">{detailPlayer.teamName}</strong></div>
                      <div><span className="text-[#667085]">ระดับมือ:</span><strong className="ml-1">{division?.nameTh || detailPlayer.divisionId}</strong></div>
                      <div><span className="text-[#667085]">ประเภท:</span><strong className="ml-1">{detailPlayer.format === 'doubles' ? 'คู่ 2 คน' : 'เดี่ยว 1 คน'}</strong></div>
                      <div><span className="text-[#667085]">สโมสร:</span><strong className="ml-1">{detailPlayer.club || '-'}</strong></div>
                    </section>

                    <div className="grid gap-4 lg:grid-cols-2">
                      {members.map((member, index) => (
                        <section key={`${member.role}-${index}`} className="rounded-xl border border-[#E2DFD5] p-4 dark:border-[#25354C]">
                          <div className="flex items-start gap-3">
                            {member.photoUrl ? <a href={member.photoUrl} target="_blank" rel="noreferrer"><img src={member.photoUrl} alt={`${member.firstName} ${member.lastName}`} className="h-24 w-24 rounded-xl border border-[#E2DFD5] object-cover dark:border-[#25354C]" /></a> : <div className="flex h-24 w-24 items-center justify-center rounded-xl border border-dashed border-[#9AA8BC]"><UserCheck className="h-7 w-7 text-[#667085]" /></div>}
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-bold text-[#156143]">นักกีฬาคนที่ {index + 1}</div>
                              <h4 className="mt-1 text-base font-bold">{member.firstName} {member.lastName}</h4>
                              <p className="text-[#667085]">ชื่อเล่น {member.nickname || '-'} · {member.gender === 'F' ? 'หญิง' : 'ชาย'}</p>
                              <p className="mt-1">โทร {member.phone || '-'} · {member.email || '-'}</p>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 border-t border-[#E2DFD5] pt-3 dark:border-[#25354C] sm:grid-cols-2">
                            <div><span className="text-[#667085]">วันเกิด:</span> {member.birthDate || '-'}</div>
                            <div><span className="text-[#667085]">สัญชาติ:</span> {member.nationality || '-'}</div>
                            <div><span className="text-[#667085]">เลขเอกสาร:</span> {member.idDocumentNo || '-'}</div>
                            <div><span className="text-[#667085]">จังหวัด:</span> {member.province || '-'}</div>
                            <div><span className="text-[#667085]">สโมสร:</span> {member.club || '-'}</div>
                            <div><span className="text-[#667085]">ขนาดเสื้อ:</span> {member.shirtSize || '-'}</div>
                            <div className="sm:col-span-2"><span className="text-[#667085]">ที่อยู่:</span> {member.address || '-'}</div>
                            <div className="sm:col-span-2"><span className="text-[#667085]">ผู้ติดต่อฉุกเฉิน:</span> {member.emergencyContact || '-'}</div>
                            {hasPermission('viewHealthData') && <div className="sm:col-span-2"><span className="text-[#667085]">ข้อมูลสุขภาพ:</span> {member.healthInfo || 'ไม่มีข้อมูล'}</div>}
                            <div><span className="text-[#667085]">PDPA:</span> {member.pdpaConsent ? 'ยินยอมแล้ว' : 'ยังไม่ยินยอม'}</div>
                          </div>
                        </section>
                      ))}
                    </div>

                    <section className="rounded-xl border border-[#E2DFD5] p-4 dark:border-[#25354C]">
                      <h4 className="font-bold">หลักฐานสำหรับประเมินมือ</h4>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {detailPlayer.skillVideoUrl ? <a href={detailPlayer.skillVideoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#142642] px-3 font-bold text-white"><Video className="h-4 w-4" />เปิดคลิปประเมินมือ<ExternalLink className="h-3.5 w-3.5" /></a> : <span className="rounded-lg bg-[#FFF8E7] px-3 py-2 font-semibold text-[#8A5B00] dark:bg-[#2B210E] dark:text-[#F8D37B]">ผู้สมัครไม่ได้แนบคลิปประเมินมือ</span>}
                        {detailPlayer.teamLogoUrl && <a href={detailPlayer.teamLogoUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 font-semibold"><ImageIcon className="h-4 w-4" />ดูโลโก้ทีม</a>}
                      </div>
                      {detailPlayer.notes && <p className="mt-3 rounded-lg bg-[#F7F6F2] p-3 dark:bg-[#0B121C]"><span className="font-bold">หมายเหตุผู้สมัคร:</span> {detailPlayer.notes}</p>}
                    </section>
                  </div>
                );
              })()}
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-[#E2DFD5] bg-[#F7F6F2] p-4 dark:border-[#25354C] dark:bg-[#0B121C]">
              <button type="button" onClick={() => setDetailPlayer(null)} className="min-h-10 rounded-lg border border-[#E2DFD5] bg-white px-4 font-semibold dark:border-[#25354C] dark:bg-[#131E2E]">ปิด</button>
              {hasPermission('approveRegistration') && detailPlayer.documentStatus !== 'rejected' && <button type="button" disabled={submitting} onClick={() => { setRejectReason(''); setRejectTarget({ kind: 'player', player: detailPlayer }); setDetailPlayer(null); }} className="min-h-10 rounded-lg border border-[#FECACA] px-4 font-semibold text-[#B91C1C] dark:border-[#7F1D1D] dark:text-[#F87171]">ไม่ผ่านการประเมิน</button>}
              {hasPermission('approveRegistration') && detailPlayer.documentStatus !== 'approved' && <button type="button" disabled={submitting} onClick={async () => { await handleReviewPlayer(detailPlayer, 'approved'); setDetailPlayer(null); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#156143] px-4 font-bold text-white"><Check className="h-4 w-4" />ผ่านการประเมินมือ</button>}
            </div>
          </div>
        </div>
      )}

      {/* Zoom Slip Modal */}
      {zoomSlipPlayer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setZoomSlipPlayer(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-[#F7F6F2] dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">
                หลักฐานการชำระเงิน · {zoomSlipPlayer.registrationCode} ({zoomSlipPlayer.teamName})
              </h3>
              <button
                type="button"
                onClick={() => setZoomSlipPlayer(null)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {renderSlipVisual(zoomSlipPlayer, true)}
          </div>
        </div>
      )}

      {/* Reject Reason Modal */}
      {rejectTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={submitRejectModal}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] shadow-xl p-5 space-y-4 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#B91C1C] dark:text-[#F87171]">
                {rejectTarget.kind === 'player'
                  ? `ปฏิเสธผู้เล่น: ${rejectTarget.player.teamName}`
                  : rejectTarget.kind === 'director'
                  ? `ปฏิเสธกรรมการ: ${rejectTarget.director.firstName} ${rejectTarget.director.lastName}`
                  : `ปฏิเสธสลิป: ${rejectTarget.player.registrationCode}`}
              </h3>
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="p-1 rounded-lg hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {rejectTarget.kind === 'payment' && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-[#525C6B] dark:text-[#9AA8BC]">
                  เลือกเหตุผลด่วน:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {REJECT_SLIP_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setRejectReason(preset)}
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium ${
                        rejectReason === preset
                          ? 'border-[#B91C1C] bg-[#FEF2F2] text-[#991B1B]'
                          : 'border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#F7F6F2] dark:hover:bg-[#1B293D]'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="block font-medium mb-1">ระบุเหตุผล (แจ้งกลับผู้สมัคร)</label>
              <textarea
                required
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="ระบุสาเหตุที่ไม่อนุมัติหรือสิ่งที่ต้องแก้ไข..."
                className="w-full p-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="min-h-[40px] px-4 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] font-medium"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="min-h-[40px] px-4 rounded-lg bg-[#B91C1C] hover:bg-[#991B1B] text-white font-semibold"
              >
                ยืนยันปฏิเสธ
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Test Online Director Application Modal */}
      {showDirectorApplyModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleApplyDirector}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] shadow-xl p-5 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">สมัครกรรมการออนไลน์ (เข้าคิวรออนุมัติ)</h3>
              <button
                type="button"
                onClick={() => setShowDirectorApplyModal(false)}
                className="p-1 rounded-lg hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2.5 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] flex items-center gap-3">
              {dirForm.photoUrl ? (
                <img
                  src={dirForm.photoUrl}
                  alt="รูปกรรมการ"
                  className="w-12 h-12 rounded-xl object-cover border border-[#156143] shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-xl border border-dashed border-[#D9D5C9] dark:border-[#2C3E57] flex items-center justify-center text-[#525C6B] shrink-0">
                  <UserCheck className="w-5 h-5" />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <label className="min-h-[34px] px-3 rounded-lg bg-[#142642] text-white font-semibold inline-flex items-center gap-1.5 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{dirForm.photoUrl ? 'เปลี่ยนรูปกรรมการ' : 'อัปโหลดรูปกรรมการ'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={handleDirectorPhotoUpload}
                  />
                </label>
                {dirForm.photoUrl && (
                  <button
                    type="button"
                    onClick={() => setDirForm((prev) => ({ ...prev, photoUrl: '' }))}
                    className="min-h-[34px] px-2.5 rounded-lg border border-[#FECACA] text-[#B91C1C]"
                  >
                    ลบรูป
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input
                required
                placeholder="ชื่อจริง *"
                value={dirForm.firstName}
                onChange={(e) => setDirForm({ ...dirForm, firstName: e.target.value })}
                className="min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
              />
              <input
                required
                placeholder="นามสกุล *"
                value={dirForm.lastName}
                onChange={(e) => setDirForm({ ...dirForm, lastName: e.target.value })}
                className="min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="ชื่อเล่น"
                value={dirForm.nickname}
                onChange={(e) => setDirForm({ ...dirForm, nickname: e.target.value })}
                className="min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
              />
              <input
                required
                placeholder="เบอร์โทร *"
                value={dirForm.phone}
                onChange={(e) => setDirForm({ ...dirForm, phone: e.target.value })}
                className="min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
              />
            </div>

            <input
              placeholder="ระดับใบรับรอง (เช่น กรรมการสมาคมฯ ระดับ 1)"
              value={dirForm.certification}
              onChange={(e) => setDirForm({ ...dirForm, certification: e.target.value })}
              className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
            />

            <input
              placeholder="สังกัดสโมสร (เพื่อตรวจสอบ Conflict of Interest)"
              value={dirForm.clubAffiliation}
              onChange={(e) => setDirForm({ ...dirForm, clubAffiliation: e.target.value })}
              className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
            />

            <textarea
              rows={2}
              placeholder="ประสบการณ์ตัดสินที่ผ่านมา..."
              value={dirForm.experienceNote}
              onChange={(e) => setDirForm({ ...dirForm, experienceNote: e.target.value })}
              className="w-full p-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
            />

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowDirectorApplyModal(false)}
                className="min-h-[40px] px-4 rounded-lg border border-[#E2DFD5] dark:border-[#25354C]"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="min-h-[40px] px-4 rounded-lg bg-[#156143] text-white font-semibold"
              >
                ส่งใบสมัครกรรมการ
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
