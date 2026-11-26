import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Search,
  ShieldCheck,
  Upload,
  UserPlus,
  Video,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { apiFetch, stageTournamentFile } from '../../services/api';
import {
  CourtConfig,
  DivisionConfig,
  MatchRecord,
  PaymentStatus,
  VerifyStatus,
} from '../../types/tournament';
import { PlacementAwareKnockoutBrackets } from '../common/KnockoutBracketCanvas';
import { EmptyStateCard, StatusIndicator, TeamLogoBadge, buildTeamLogoMap } from '../common/UIPrimitives';
import { formatThaiDateTime } from '../../utils/registration';

interface PublicPlayerStatusPayload {
  tournament: {
    id: string;
    name: string;
    venue: string;
    startDate: string;
    endDate: string;
    bannerUrl: string;
    emblemUrl: string;
    divisions: DivisionConfig[];
    courts: CourtConfig[];
    paymentConfig: {
      promptPayId: string;
      bankName: string;
      bankAccountNo: string;
      bankAccountName: string;
    };
  };
  player: {
    id: string;
    registrationCode: string;
    verificationCode: string;
    tournamentId: string;
    teamName: string;
    teamLogoUrl?: string;
    firstName: string;
    lastName: string;
    nickname: string;
    partnerName?: string;
    photoUrl?: string;
    partnerPhotoUrl?: string;
    club: string;
    province: string;
    divisionId: string;
    format: 'doubles' | 'singles';
    skillVideoUrl?: string;
    documentStatus: VerifyStatus;
    approvalNote?: string;
    paymentStatus: PaymentStatus;
    slipStatus: VerifyStatus | 'not_uploaded';
    paymentRejectReason?: string;
    amountPaid: number;
    amountDue: number;
    checkedIn: boolean;
    checkInTime?: string;
    waitingList: boolean;
    waitingPosition?: number;
    withdrawn: boolean;
    seed?: number;
    groupName?: string;
    registeredAt: string;
  };
  teamMatches: MatchRecord[];
  divisionMatches: MatchRecord[];
}

export const PublicPlayerStatusPage: React.FC = () => {
  const {
    selectedTournamentId,
    publicLookupCode,
    setPublicLookupCode,
    setPortalMode,
    notify,
  } = useApp();

  const [codeInput, setCodeInput] = useState(publicLookupCode || '');
  const [verificationInput, setVerificationInput] = useState(() => new URLSearchParams(window.location.search).get('verification') || '');
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [data, setData] = useState<PublicPlayerStatusPayload | null>(null);

  const performLookup = useCallback(
    async (codeToSearch: string) => {
      const clean = codeToSearch.trim();
      if (!clean) {
        setErrMsg('กรุณากรอกรหัสตรวจสอบ หรือเลขที่สมัคร (เช่น PHR-2601)');
        return;
      }
      setLoading(true);
      setErrMsg('');
      try {
        const params = new URLSearchParams();
        if (selectedTournamentId) params.set('tournamentId', selectedTournamentId);
        params.set('code', clean);
        params.set('verification', verificationInput.trim());
        const res = await apiFetch<PublicPlayerStatusPayload>(
          `/api/public/player-status?${params.toString()}`
        );
        setData(res);
        // Keep verification credentials in memory only for actions such as a
        // slip re-upload. Once verified, do not leave either code visible in
        // the form or exposed in browser history/address-bar query params.
        setPublicLookupCode('');
        const visibleParams = new URLSearchParams(window.location.search);
        visibleParams.delete('code');
        visibleParams.delete('verification');
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${visibleParams.size ? `?${visibleParams}` : ''}`
        );
      } catch (err) {
        setData(null);
        setErrMsg(err instanceof Error ? err.message : 'ไม่พบข้อมูลตามรหัสนี้');
      } finally {
        setLoading(false);
      }
    },
    [selectedTournamentId, setPublicLookupCode, verificationInput]
  );

  useEffect(() => {
    if (publicLookupCode) {
      setCodeInput(publicLookupCode);
      performLookup(publicLookupCode);
    }
  }, [publicLookupCode, performLookup]);

  const handleReuploadSlip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!data) return;
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      notify('error', 'กรุณาเลือกไฟล์รูปภาพสลิป');
      return;
    }
    e.target.value = '';
    try {
      const staged = await stageTournamentFile('/api/public/files/stage', file, 'payment_slip');
      await apiFetch('/api/public/player-status/upload-slip', {
        method: 'POST',
        body: JSON.stringify({
          code: codeInput.trim() || data.player.registrationCode,
          verification: verificationInput.trim(),
          slipFileId: staged.fileId,
          slipTransferBank: 'พร้อมเพย์ (PromptPay QR)',
          slipTransferAmount: data.player.amountDue || 0,
        }),
      });
      await performLookup(codeInput || data.player.registrationCode);
      notify('success', 'ส่งสลิปใหม่เข้าคิวรอตรวจสอบแล้ว');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'อัปโหลดสลิปไม่สำเร็จ');
    }
  };

  const division = data?.tournament.divisions.find((d) => d.id === data.player.divisionId);
  const teamLogos = useMemo(
    () =>
      data
        ? buildTeamLogoMap([
            {
              id: data.player.id,
              teamName: data.player.teamName,
              teamLogoUrl: data.player.teamLogoUrl,
            },
          ])
        : {},
    [data]
  );

  return (
    <div className="min-h-[100dvh] bg-[#F7F6F2] dark:bg-[#0B121C] text-[#141D2B] dark:text-[#F3F5F8] py-5 px-4">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* Search Box */}
        <div className="rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#156143] text-white flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-bold">
                  ตรวจสอบสถานะการสมัคร & สายการแข่งขันของทีม
                </h1>
                <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                  {data
                    ? 'ยืนยันข้อมูลสำเร็จแล้ว ระบบซ่อนรหัสที่ใช้ตรวจสอบเพื่อความเป็นส่วนตัว'
                    : 'กรอกรหัสตรวจสอบ (Verify Code) หรือเลขที่ใบสมัคร (เช่น PHR-2601)'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPortalMode('public_register')}
              className="min-h-[38px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D] text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <UserPlus className="w-3.5 h-3.5 text-[#156143] dark:text-[#4ADE80]" />
              <span>ไปหน้าสมัครแข่งขัน</span>
            </button>
          </div>

          {!data ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                performLookup(codeInput);
              }}
              className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
            >
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-[#525C6B] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  placeholder="เลขที่สมัคร เช่น PHR-2601"
                  className="w-full min-h-[46px] pl-10 pr-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-sm font-mono font-semibold"
                />
              </div>
              <input
                value={verificationInput}
                onChange={(e) => setVerificationInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="รหัสยืนยัน 6 หลัก"
                className="w-full min-h-[46px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-sm font-mono font-semibold"
              />
              <button
                type="submit"
                disabled={loading}
                className="min-h-[46px] px-6 rounded-xl bg-[#142642] hover:bg-[#1E355C] text-white text-sm font-bold shrink-0 disabled:opacity-50"
              >
                {loading ? 'กำลังค้นหา...' : 'ตรวจสอบข้อมูล'}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setData(null);
                setCodeInput('');
                setVerificationInput('');
                setErrMsg('');
              }}
              className="min-h-[42px] px-4 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D] text-xs font-semibold inline-flex items-center justify-center gap-1.5"
            >
              <Search className="w-3.5 h-3.5" />
              ตรวจสอบรายการอื่น
            </button>
          )}

          {errMsg && (
            <div className="p-3 rounded-xl bg-[#FEF2F2] dark:bg-[#361215] border border-[#FECACA] dark:border-[#5E2025] text-xs text-[#B91C1C] dark:text-[#F87171] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errMsg}</span>
            </div>
          )}
        </div>

        {data && (
          <>
            {/* Team Profile & Status Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Team Identity */}
              <div className="lg:col-span-2 rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <TeamLogoBadge
                      teamName={data.player.teamName}
                      logoUrl={data.player.teamLogoUrl}
                      size="lg"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                        <span className="font-bold text-[#156143] dark:text-[#4ADE80]">
                          {data.player.registrationCode}
                        </span>
                      </div>
                      <h2 className="text-lg font-bold truncate mt-0.5">{data.player.teamName}</h2>
                      <div className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                        {division?.nameTh} · สโมสร {data.player.club} ({data.player.province})
                      </div>
                    </div>
                  </div>

                  {data.player.groupName && (
                    <span className="px-2.5 py-1 rounded-lg bg-[#EFF6FF] dark:bg-[#162742] text-[#1D4ED8] dark:text-[#93C5FD] text-xs font-bold">
                      {data.player.groupName}
                      {data.player.seed ? ` · Seed #${data.player.seed}` : ''}
                    </span>
                  )}
                </div>

                {/* Players & Video */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#E2DFD5] dark:border-[#25354C] text-xs">
                  <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C]">
                    {data.player.photoUrl && (
                      <img
                        src={data.player.photoUrl}
                        alt={data.player.firstName}
                        className="w-10 h-10 rounded-lg object-cover shrink-0"
                      />
                    )}
                    <div>
                      <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">นักกีฬา 1</div>
                      <div className="font-bold">
                        {data.player.firstName} {data.player.lastName}
                        {data.player.nickname ? ` (${data.player.nickname})` : ''}
                      </div>
                    </div>
                  </div>

                  {data.player.format === 'doubles' && (
                    <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C]">
                      {data.player.partnerPhotoUrl && (
                        <img
                          src={data.player.partnerPhotoUrl}
                          alt={data.player.partnerName || 'Partner'}
                          className="w-10 h-10 rounded-lg object-cover shrink-0"
                        />
                      )}
                      <div>
                        <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">นักกีฬา 2</div>
                        <div className="font-bold">{data.player.partnerName || '-'}</div>
                      </div>
                    </div>
                  )}
                </div>

                {data.player.skillVideoUrl && (
                  <div className="p-3 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <Video className="w-4 h-4 text-[#156143] dark:text-[#4ADE80] shrink-0" />
                      <span className="truncate">วิดีโอประเมินระดับมือที่ส่งไว้</span>
                    </div>
                    <a
                      href={data.player.skillVideoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#156143] dark:text-[#4ADE80] font-bold inline-flex items-center gap-1 shrink-0 hover:underline"
                    >
                      <span>เปิดดูคลิป</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </div>

              {/* Status Checklist */}
              <div className="rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-5 space-y-3 text-xs">
                <h3 className="text-sm font-bold">สถานะใบสมัครและการชำระเงิน</h3>

                <div className="p-3 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] space-y-1.5">
                  <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">1. อนุมัติใบสมัคร / ระดับมือ</div>
                  <StatusIndicator
                    tone={
                      data.player.withdrawn
                        ? 'danger'
                        : data.player.documentStatus === 'approved'
                        ? 'success'
                        : data.player.documentStatus === 'rejected'
                        ? 'danger'
                        : 'warning'
                    }
                    label={
                      data.player.withdrawn
                        ? 'ถอนตัวจากการแข่งขันแล้ว'
                        : data.player.documentStatus === 'approved'
                        ? 'อนุมัติแล้ว'
                        : data.player.documentStatus === 'rejected'
                        ? 'ไม่ผ่านการอนุมัติ'
                        : 'รอเจ้าหน้าที่ตรวจสอบ'
                    }
                  />
                  {data.player.approvalNote && (
                    <div className="text-[11px] text-[#B91C1C] dark:text-[#F87171]">
                      หมายเหตุ: {data.player.approvalNote}
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] space-y-1.5">
                  <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">2. การชำระเงิน / ตรวจสลิป</div>
                  <StatusIndicator
                    tone={
                      data.player.paymentStatus === 'paid'
                        ? 'success'
                        : data.player.slipStatus === 'rejected'
                        ? 'danger'
                        : 'warning'
                    }
                    label={
                      data.player.paymentStatus === 'paid'
                        ? `ชำระครบ ฿${data.player.amountPaid.toLocaleString()}`
                        : data.player.paymentStatus === 'pending_verify'
                        ? 'ส่งสลิปแล้ว · รอตรวจสอบ'
                        : data.player.slipStatus === 'rejected'
                        ? 'สลิปไม่ผ่าน · กรุณาแนบใหม่'
                        : `ค้างชำระ ฿${data.player.amountDue.toLocaleString()}`
                    }
                  />
                  {data.player.paymentRejectReason && (
                    <div className="text-[11px] text-[#B91C1C] dark:text-[#F87171]">
                      เหตุผล: {data.player.paymentRejectReason}
                    </div>
                  )}
                  {!data.player.withdrawn && data.player.documentStatus === 'pending' && (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                      รอเจ้าหน้าที่อนุมัติใบสมัครก่อน ระบบจึงจะเปิดข้อมูลชำระเงินและปุ่มแนบสลิป
                    </div>
                  )}
                  {!data.player.withdrawn &&
                    data.player.documentStatus === 'approved' &&
                    data.player.paymentStatus !== 'paid' && (
                    <div className="mt-2 rounded-lg border border-[#E2DFD5] bg-white p-3 text-[11px] leading-5 dark:border-[#25354C] dark:bg-[#131E2E]">
                      <div className="font-bold text-[#156143] dark:text-[#4ADE80]">ข้อมูลชำระค่าสมัคร</div>
                      <div>ยอดชำระ: <strong>฿{data.player.amountDue.toLocaleString()}</strong></div>
                      <div>ธนาคาร: {data.tournament.paymentConfig.bankName || 'กรุณาติดต่อผู้จัด'}</div>
                      <div>เลขบัญชี: <span className="font-mono font-semibold">{data.tournament.paymentConfig.bankAccountNo || '-'}</span></div>
                      <div>ชื่อบัญชี: {data.tournament.paymentConfig.bankAccountName || '-'}</div>
                      {data.tournament.paymentConfig.promptPayId && (
                        <div>PromptPay: <span className="font-mono font-semibold">{data.tournament.paymentConfig.promptPayId}</span></div>
                      )}
                    </div>
                  )}
                  {!data.player.withdrawn &&
                    data.player.documentStatus === 'approved' &&
                    data.player.paymentStatus !== 'paid' && (
                    <label className="mt-2 w-full min-h-[38px] px-3 rounded-lg border border-dashed border-[#156143] text-[#156143] dark:text-[#4ADE80] font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      <span>อัปโหลดสลิปโอนเงินใหม่</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="sr-only"
                        onChange={handleReuploadSlip}
                      />
                    </label>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] space-y-1.5">
                  <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">3. สถานะ Check-in วันแข่ง</div>
                  <StatusIndicator
                    tone={data.player.checkedIn ? 'success' : 'neutral'}
                    label={
                      data.player.checkedIn
                        ? `Check-in แล้ว (${formatThaiDateTime(data.player.checkInTime)})`
                        : 'รอ Check-in หน้างาน'
                    }
                  />
                </div>
              </div>
            </div>

            {/* Team Matches */}
            <div className="rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-[#156143]" />
                  <span>ตารางแข่งขันของทีม ({data.teamMatches.length} คู่)</span>
                </h3>
              </div>

              {data.teamMatches.length === 0 ? (
                <div className="p-4 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] text-xs text-[#525C6B] dark:text-[#9AA8BC] flex items-center gap-2">
                  <Clock className="w-4 h-4 shrink-0" />
                  <span>ยังไม่มีโปรแกรมแข่งขัน หรือผู้จัดยังไม่ได้ประกาศสายในรุ่นนี้</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {data.teamMatches.map((m) => {
                    const courtName =
                      data.tournament.courts.find((c) => c.id === m.courtId)?.name || 'รอจัดสนาม';
                    const scoreStr = m.sets.map((s) => `${s.scoreA}-${s.scoreB}`).join(', ');
                    return (
                      <div
                        key={m.id}
                        className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] p-3.5 space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-bold text-[#156143] dark:text-[#4ADE80]">
                            {m.matchCode} · {courtName} · {m.scheduledTime}
                          </span>
                          <StatusIndicator
                            tone={
                              m.status === 'live'
                                ? 'live'
                                : m.status === 'finished' || m.status === 'walkover'
                                ? 'success'
                                : 'neutral'
                            }
                            label={
                              m.status === 'live'
                                ? 'กำลังแข่ง'
                                : m.status === 'finished' || m.status === 'walkover'
                                ? 'จบแล้ว'
                                : 'รอแข่งขัน'
                            }
                            compact
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-sm font-bold">
                          <span className="inline-flex items-center gap-1.5">
                            <TeamLogoBadge
                              teamName={m.teamAName}
                              logoUrl={teamLogos[m.teamAId] || teamLogos[m.teamAName]}
                              size="xs"
                            />
                            <span>{m.teamAName}</span>
                          </span>
                          <span className="font-normal text-xs text-[#525C6B]">vs</span>
                          <span className="inline-flex items-center gap-1.5">
                            <TeamLogoBadge
                              teamName={m.teamBName}
                              logoUrl={teamLogos[m.teamBId] || teamLogos[m.teamBName]}
                              size="xs"
                            />
                            <span>{m.teamBName}</span>
                          </span>
                        </div>
                        {scoreStr && (
                          <div className="font-mono font-semibold text-[#142642] dark:text-[#FACC15]">
                            สกอร์: {scoreStr}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Division Bracket */}
            {data.divisionMatches.length > 0 && (
              <div className="rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-5 space-y-3">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#156143]" />
                  <span>สายการแข่งขันรุ่น {division?.nameTh}</span>
                </h3>
                <PlacementAwareKnockoutBrackets
                  matches={data.divisionMatches}
                  teamLogos={teamLogos}
                  title={`สายการแข่งขัน — ${division?.nameTh || ''}`}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
