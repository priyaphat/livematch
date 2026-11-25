import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Camera,
  CheckCircle2,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  ShieldCheck,
  Upload,
  User,
  Users,
  Video,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { apiFetch, dataUrlToBlob, stageTournamentFile } from '../../services/api';
import { PlayerRecord, Tournament } from '../../types/tournament';
import {
  formatThaiDateTimeRange,
  getDivisionFormat,
  getRegistrationWindowStatus,
} from '../../utils/registration';
import { EmptyStateCard, QRCodeMatrix } from '../common/UIPrimitives';
import { AthleteRegistrationFields } from '../common/AthleteRegistrationFields';

export const PublicRegistrationPage: React.FC = () => {
  const {
    state,
    selectedTournamentId,
    setPortalMode,
    setPublicLookupCode,
    refreshState,
    notify,
  } = useApp();

  type Availability = { quota: number; registered: number; remaining: number; unlimited: boolean; full: boolean };
  type PublicRegistrationTournament = Tournament & { registrationAvailability?: Record<string, Availability> };
  const [publicTournament, setPublicTournament] = useState<PublicRegistrationTournament | null>(null);
  const [publicLoading, setPublicLoading] = useState(true);
  const linkToken = selectedTournamentId || new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('tournament') || '';

  useEffect(() => {
    if (!linkToken) {
      setPublicLoading(false);
      return;
    }
    setPublicLoading(true);
    void apiFetch<{ tournaments: PublicRegistrationTournament[] }>(`/api/public-tournament/state?token=${encodeURIComponent(linkToken)}`)
      .then((response) => setPublicTournament(response.tournaments[0] || null))
      .catch((error) => notify('error', error instanceof Error ? error.message : 'ไม่พบรายการแข่งขัน'))
      .finally(() => setPublicLoading(false));
  }, [linkToken, notify]);

  const tournament = useMemo<PublicRegistrationTournament | null>(
    () =>
      publicTournament ||
      state.tournaments.find((t) => t.id === selectedTournamentId) ||
      state.tournaments.find((t) => t.publicViewConfig.enabled) ||
      state.tournaments[0] ||
      null,
    [publicTournament, state.tournaments, selectedTournamentId]
  );

  const enabledDivisions = useMemo(
    () => (tournament?.divisions || []).filter((d) => d.enabled),
    [tournament]
  );

  const [divisionId, setDivisionId] = useState<string>(() => enabledDivisions[0]?.id || '');
  const selectedDivision = useMemo(
    () =>
      enabledDivisions.find((d) => d.id === divisionId && !tournament?.registrationAvailability?.[`${d.id}|${getDivisionFormat(d)}`]?.full) ||
      enabledDivisions.find((d) => {
        const format = getDivisionFormat(d);
        return !tournament?.registrationAvailability?.[`${d.id}|${format}`]?.full;
      }) ||
      enabledDivisions[0],
    [enabledDivisions, divisionId, tournament]
  );
  useEffect(() => {
    if (selectedDivision && selectedDivision.id !== divisionId) {
      setDivisionId(selectedDivision.id);
    }
  }, [divisionId, selectedDivision]);
  const effectiveFormat = getDivisionFormat(selectedDivision);
  const selectedAvailability = selectedDivision
    ? tournament?.registrationAvailability?.[`${selectedDivision.id}|${effectiveFormat}`]
    : undefined;
  const fee =
    effectiveFormat === 'doubles'
      ? selectedDivision?.entryFeeDoubles || 800
      : selectedDivision?.entryFeeSingles || 500;

  const [step, setStep] = useState<'form' | 'payment' | 'done'>('form');
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    teamName: '',
    teamLogoUrl: '',
    firstName: '',
    lastName: '',
    nickname: '',
    gender: 'M' as 'M' | 'F',
    phone: '',
    email: '',
    club: '',
    province: 'แพร่',
    photoUrl: '',
    partnerFirstName: '',
    partnerLastName: '',
    partnerNickname: '',
    partnerGender: 'M' as 'M' | 'F',
    partnerBirthDate: '',
    partnerNationality: 'ไทย',
    partnerIdDocumentNo: '',
    partnerPhone: '',
    partnerEmail: '',
    partnerClub: '',
    partnerProvince: 'แพร่',
    partnerShirtSize: 'L' as PlayerRecord['shirtSize'],
    partnerAddress: '',
    partnerEmergencyContact: '',
    partnerHealthInfo: '',
    partnerHealthConsent: false,
    partnerPdpaConsent: false,
    partnerPhotoUrl: '',
    skillVideoUrl: '',
    shirtSize: 'L' as PlayerRecord['shirtSize'],
    birthDate: '',
    nationality: 'ไทย',
    idDocumentNo: '',
    address: '',
    emergencyContact: '',
    healthInfo: '',
    pdpaConsent: false,
  });

  const [slipImage, setSlipImage] = useState('');
  const [slipBank, setSlipBank] = useState('พร้อมเพย์ (PromptPay QR)');
  const [slipRef, setSlipRef] = useState('');
  const [createdPlayer, setCreatedPlayer] = useState<PlayerRecord | null>(null);

  if (!tournament && publicLoading) {
    return <div className="mx-auto max-w-xl p-6 text-center text-sm">กำลังตรวจสอบรายการแข่งขัน…</div>;
  }

  if (!tournament) {
    return (
      <div className="max-w-xl mx-auto p-6">
        <EmptyStateCard
          title="ไม่พบรายการแข่งขันที่เปิดรับสมัคร"
          description="กรุณาตรวจสอบลิงก์หรือติดต่อผู้จัดรายการ"
        />
      </div>
    );
  }

  const regWindow = getRegistrationWindowStatus(tournament);

  const compressImageUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    maxSide: number,
    onDone: (dataUrl: string) => void
  ) => {
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
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        onDone(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const isVideoUrlValid =
    !form.skillVideoUrl.trim() ||
    (() => {
      try {
        const u = new URL(form.skillVideoUrl.trim());
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        return false;
      }
    })();

  const handleSubmit = async () => {
    if (selectedAvailability?.full) {
      notify('error', 'ระดับมือและประเภทนี้มีผู้สมัครครบแล้ว กรุณาติดต่อผู้จัดรายการ');
      return;
    }
    if (!slipImage) {
      notify('error', 'กรุณาแนบหลักฐานสลิปโอนเงินก่อนส่งใบสมัคร');
      return;
    }
    if (!isVideoUrlValid) {
      notify('error', 'ลิงก์วิดีโอประเมินมือต้องขึ้นต้นด้วย http:// หรือ https://');
      return;
    }
    const partnerFullName = `${form.partnerFirstName} ${form.partnerLastName}`.trim();
    const defaultTeamName =
      effectiveFormat === 'doubles'
        ? form.teamName.trim() ||
          `${form.firstName}${form.partnerFirstName ? ` / ${form.partnerFirstName}` : ''}`
        : form.teamName.trim() || `${form.firstName} ${form.lastName}`.trim();

    setSubmitting(true);
    try {
      const stagedSlip = await stageTournamentFile(
        `/api/public/files/stage?token=${encodeURIComponent(tournament.publicToken || selectedTournamentId || '')}`,
        dataUrlToBlob(slipImage),
        'payment_slip'
      );
      const created = await apiFetch<PlayerRecord>(`/api/public-tournament/register?token=${encodeURIComponent(tournament.publicToken || selectedTournamentId || '')}`, {
        method: 'POST',
        body: JSON.stringify({
          tournamentId: tournament.id,
          teamName: defaultTeamName,
          teamLogoUrl: form.teamLogoUrl || undefined,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          nickname: form.nickname.trim(),
          gender: form.gender,
          birthDate: form.birthDate,
          nationality: form.nationality,
          idDocumentNo: form.idDocumentNo.trim() || undefined,
          address: form.address.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          club: form.club.trim() || 'อิสระ',
          province: form.province.trim() || 'แพร่',
          divisionId: selectedDivision?.id || divisionId,
          format: effectiveFormat,
          photoUrl: form.photoUrl,
          partnerName: effectiveFormat === 'doubles' ? partnerFullName : undefined,
          partnerFirstName: effectiveFormat === 'doubles' ? form.partnerFirstName.trim() : undefined,
          partnerLastName: effectiveFormat === 'doubles' ? form.partnerLastName.trim() : undefined,
          partnerNickname: effectiveFormat === 'doubles' ? form.partnerNickname.trim() : undefined,
          partnerPhone: effectiveFormat === 'doubles' ? form.partnerPhone.trim() : undefined,
          partnerPhotoUrl: effectiveFormat === 'doubles' ? form.partnerPhotoUrl : undefined,
          skillVideoUrl: form.skillVideoUrl.trim() || undefined,
          shirtSize: form.shirtSize,
          emergencyContact: form.emergencyContact.trim(),
          healthInfo: form.healthInfo.trim() || undefined,
          healthConsent: true,
          pdpaConsent: form.pdpaConsent,
          members: [
            {
              role: 'primary', firstName: form.firstName.trim(), lastName: form.lastName.trim(), nickname: form.nickname.trim(),
              gender: form.gender, birthDate: form.birthDate, nationality: form.nationality,
              idDocumentNo: form.idDocumentNo.trim() || undefined, address: form.address.trim(), phone: form.phone.trim(),
              email: form.email.trim(), club: form.club.trim() || 'อิสระ', province: form.province.trim() || 'แพร่', shirtSize: form.shirtSize, photoUrl: form.photoUrl,
              emergencyContact: form.emergencyContact.trim(), healthInfo: form.healthInfo.trim() || undefined,
              healthConsent: true, pdpaConsent: form.pdpaConsent,
            },
            ...(effectiveFormat === 'doubles' ? [{
              role: 'partner' as const, firstName: form.partnerFirstName.trim(), lastName: form.partnerLastName.trim(), nickname: form.partnerNickname.trim(),
              gender: form.partnerGender, birthDate: form.partnerBirthDate, nationality: form.partnerNationality,
              idDocumentNo: form.partnerIdDocumentNo.trim() || undefined, address: form.partnerAddress.trim(), phone: form.partnerPhone.trim(),
              email: form.partnerEmail.trim(), club: form.partnerClub.trim() || 'อิสระ', province: form.partnerProvince.trim() || 'แพร่', shirtSize: form.partnerShirtSize, photoUrl: form.partnerPhotoUrl,
              emergencyContact: form.partnerEmergencyContact.trim(), healthInfo: form.partnerHealthInfo.trim() || undefined,
              healthConsent: form.partnerHealthConsent, pdpaConsent: form.partnerPdpaConsent,
            }] : []),
          ],
          registrationSource: 'online',
          documentStatus: 'pending',
          paymentStatus: 'pending_verify',
          slipStatus: 'pending',
          paymentChannel: 'PromptPay',
          slipFileId: stagedSlip.fileId,
          slipTransferBank: slipBank,
          slipTransferRef: slipRef.trim() || `PP-${Date.now().toString().slice(-8)}`,
          slipTransferAmount: fee,
          slipUploadedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
          amountPaid: 0,
          amountDue: fee,
          checkedIn: false,
          withdrawn: false,
          noShow: false,
        }),
      });
      await refreshState();
      setCreatedPlayer(created);
      setStep('done');
      notify('success', 'ส่งใบสมัครและสลิปโอนเงินสำเร็จ');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'ส่งใบสมัครไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  const verificationCode = createdPlayer?.verificationCode || '';
  const registrationCode = createdPlayer?.registrationCode || '';
  const statusUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?mode=public_status&tournament=${encodeURIComponent(
          tournament.publicToken || tournament.id
        )}&code=${encodeURIComponent(registrationCode)}&verification=${encodeURIComponent(verificationCode)}`
      : `/?mode=public_status&tournament=${tournament.publicToken || tournament.id}&code=${registrationCode}&verification=${verificationCode}`;

  return (
    <div className="min-h-[100dvh] bg-[#F7F6F2] dark:bg-[#0B121C] text-[#141D2B] dark:text-[#F3F5F8] py-5 px-4">
      <div className="max-w-lg mx-auto space-y-4">
        {/* Tournament Card Banner */}
        <div className="rounded-2xl overflow-hidden border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] shadow-sm">
          <div className="relative h-32 bg-[#142642]">
            <img
              src={tournament.bannerUrl}
              alt={tournament.name}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover opacity-55"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />
            <div className="absolute bottom-3 left-4 right-4 flex items-center gap-3 text-white">
              <img
                src={tournament.emblemUrl}
                alt={tournament.name}
                referrerPolicy="no-referrer"
                className="w-11 h-11 rounded-xl object-cover border border-white/25 shrink-0"
              />
              <div className="min-w-0">
                <div className="text-[11px] opacity-85">รับสมัครนักกีฬาออนไลน์</div>
                <h1 className="text-base font-bold truncate">{tournament.name}</h1>
              </div>
            </div>
          </div>
          <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#525C6B] dark:text-[#9AA8BC]">
            <span>
              {tournament.venue} · {tournament.startDate} – {tournament.endDate}
            </span>
            <button
              type="button"
              onClick={() => setPortalMode('public_status')}
              className="text-[#156143] dark:text-[#4ADE80] font-semibold inline-flex items-center gap-1 hover:underline"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>ตรวจสอบสถานะผู้สมัครเดิม</span>
            </button>
          </div>
        </div>

        {!regWindow.isOpen ? (
          <div className="rounded-2xl bg-white dark:bg-[#131E2E] border border-[#FECACA] dark:border-[#5E2025] p-6 text-center space-y-3">
            <CalendarClock className="w-10 h-10 text-[#B91C1C] dark:text-[#F87171] mx-auto" />
            <h2 className="text-base font-bold text-[#B91C1C] dark:text-[#F87171]">
              ปิดรับสมัครออนไลน์แล้ว
            </h2>
            <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">{regWindow.reason}</p>
            <div className="p-3 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] text-xs space-y-1">
              <div>
                ช่วงรับสมัคร:{' '}
                {formatThaiDateTimeRange(
                  tournament.registrationConfig.openAt,
                  tournament.registrationConfig.closeAt
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPortalMode('public_status')}
              className="w-full min-h-[44px] rounded-xl bg-[#142642] text-white text-xs font-semibold"
            >
              ตรวจสอบสถานะ & สายการแข่งขัน
            </button>
          </div>
        ) : step === 'form' ? (
          <div className="space-y-3 text-xs">
            {/* Step 1: Division & Team Identity */}
            <div className="rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-4 space-y-3">
              <div>
                <label className="block font-bold mb-1.5">เลือกระดับมือที่สมัคร *</label>
                <select
                  value={selectedDivision?.id || ''}
                  onChange={(e) => setDivisionId(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] font-medium"
                >
                  {enabledDivisions.length === 0 && <option value="">ไม่มีระดับมือที่เปิดรับสมัคร</option>}
                  {enabledDivisions.map((d) => {
                    const fmt = getDivisionFormat(d);
                    const dFee =
                      fmt === 'doubles' ? d.entryFeeDoubles || 800 : d.entryFeeSingles || 500;
                    const availability = tournament.registrationAvailability?.[`${d.id}|${fmt}`];
                    const availabilityLabel = availability?.unlimited
                      ? 'ไม่จำกัดจำนวน'
                      : availability?.full
                      ? 'เต็ม — ติดต่อผู้จัด'
                      : `เหลือ ${availability?.remaining ?? 0} ทีม`;
                    return (
                      <option key={d.id} value={d.id} disabled={availability?.full}>
                        {d.nameTh} · {fmt === 'singles' ? 'เดี่ยว 1 คน' : 'คู่ 2 คน'} · {availabilityLabel} (฿{dFee})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="p-2.5 rounded-xl bg-[#EFF6FF] dark:bg-[#162742] border border-[#BFDBFE] dark:border-[#2B4368] text-[#1D4ED8] dark:text-[#93C5FD] flex items-center gap-2 font-semibold">
                {effectiveFormat === 'doubles' ? (
                  <Users className="w-4 h-4 shrink-0" />
                ) : (
                  <User className="w-4 h-4 shrink-0" />
                )}
                <span>
                  {effectiveFormat === 'doubles'
                    ? 'ประเภทคู่ — กรอกข้อมูลและอัปโหลดรูปนักกีฬา 2 คน'
                    : 'ประเภทเดี่ยว — กรอกข้อมูลและอัปโหลดรูปนักกีฬา 1 คน'}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2.5">
                <div>
                  <label className="block font-semibold mb-1">ชื่อทีม / คู่แข่ง</label>
                  <input
                    value={form.teamName}
                    onChange={(e) => setForm({ ...form, teamName: e.target.value })}
                    placeholder={
                      effectiveFormat === 'doubles'
                        ? 'เช่น แพร่พิราบขาว 1'
                        : 'เว้นว่างเพื่อใช้ชื่อ-นามสกุล'
                    }
                    className="w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                  />
                </div>
              </div>

              {/* Team Logo Upload */}
              <div className="pt-1">
                <label className="block font-semibold mb-1.5">โลโก้ทีม (Team Logo · ถ้ามี)</label>
                <div className="flex items-center gap-3">
                  {form.teamLogoUrl ? (
                    <img
                      src={form.teamLogoUrl}
                      alt="โลโก้ทีม"
                      className="w-12 h-12 rounded-xl object-cover border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2]"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl border border-dashed border-[#C9C4B5] flex items-center justify-center text-[#525C6B]">
                      <ImageIcon className="w-5 h-5" />
                    </div>
                  )}
                  <label className="flex-1 min-h-[42px] px-3 rounded-xl border border-dashed border-[#142642] dark:border-[#60A5FA] text-[#142642] dark:text-[#93C5FD] font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer">
                    <Upload className="w-4 h-4" />
                    <span>{form.teamLogoUrl ? 'เปลี่ยนรูปโลโก้ทีม' : 'อัปโหลดรูปโลโก้ทีม'}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={(e) =>
                        compressImageUpload(e, 256, (url) =>
                          setForm((prev) => ({ ...prev, teamLogoUrl: url }))
                        )
                      }
                    />
                  </label>
                </div>
              </div>
            </div>

            <AthleteRegistrationFields
              athleteNumber={1}
              pdpaText={tournament.registrationConfig.pdpaConsentText}
              values={{
                firstName: form.firstName, lastName: form.lastName, nickname: form.nickname,
                gender: form.gender, birthDate: form.birthDate, nationality: form.nationality,
                idDocumentNo: form.idDocumentNo, phone: form.phone, email: form.email,
                club: form.club, province: form.province, shirtSize: form.shirtSize || 'L',
                address: form.address, emergencyContact: form.emergencyContact,
                healthInfo: form.healthInfo, photoUrl: form.photoUrl, pdpaConsent: form.pdpaConsent,
              }}
              onChange={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
              onPhotoChange={(event) => compressImageUpload(event, 320, (url) => setForm((prev) => ({ ...prev, photoUrl: url })))}
            />

            {effectiveFormat === 'doubles' && (
              <AthleteRegistrationFields
                athleteNumber={2}
                pdpaText={tournament.registrationConfig.pdpaConsentText}
                values={{
                  firstName: form.partnerFirstName, lastName: form.partnerLastName, nickname: form.partnerNickname,
                  gender: form.partnerGender, birthDate: form.partnerBirthDate, nationality: form.partnerNationality,
                  idDocumentNo: form.partnerIdDocumentNo, phone: form.partnerPhone, email: form.partnerEmail,
                  club: form.partnerClub, province: form.partnerProvince, shirtSize: form.partnerShirtSize || 'L',
                  address: form.partnerAddress, emergencyContact: form.partnerEmergencyContact,
                  healthInfo: form.partnerHealthInfo, photoUrl: form.partnerPhotoUrl, pdpaConsent: form.partnerPdpaConsent,
                }}
                onChange={(field, value) => {
                  const partnerField = `partner${field.charAt(0).toUpperCase()}${field.slice(1)}`;
                  setForm((prev) => ({ ...prev, [partnerField]: value }));
                }}
                onPhotoChange={(event) => compressImageUpload(event, 320, (url) => setForm((prev) => ({ ...prev, partnerPhotoUrl: url })))}
              />
            )}

            {/* Player 1 */}
            {false && <>
            <div className="rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-4 space-y-2.5">
              <div className="font-bold text-sm">ข้อมูลนักกีฬาคนที่ 1 *</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  placeholder="ชื่อจริง *"
                  className="w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                />
                <input
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  placeholder="นามสกุล *"
                  className="w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <label className="text-[11px] font-semibold">วันเกิด *<input type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} className="mt-1 w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" /></label>
                <label className="text-[11px] font-semibold">สัญชาติ *<input value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} className="mt-1 w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" /></label>
                <label className="text-[11px] font-semibold">เลขบัตร/หนังสือเดินทาง<input value={form.idDocumentNo} onChange={(e) => setForm({ ...form, idDocumentNo: e.target.value })} className="mt-1 w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" /></label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="text-[11px] font-semibold">ที่อยู่ติดต่อ *<textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-1 w-full p-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" /></label>
                <label className="text-[11px] font-semibold">ผู้ติดต่อฉุกเฉิน (ชื่อ/เบอร์โทร) *<textarea rows={2} value={form.emergencyContact} onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })} className="mt-1 w-full p-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" /></label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={form.nickname}
                  onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                  placeholder="ชื่อเล่น"
                  className="w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                />
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="เบอร์โทรศัพท์ติดต่อ *"
                  className="w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                />
              </div>
              <div className="flex items-center gap-3 pt-1">
                {form.photoUrl ? (
                  <img
                    src={form.photoUrl}
                    alt="รูปนักกีฬาคนที่ 1"
                    className="w-12 h-12 rounded-xl object-cover border border-[#E2DFD5] dark:border-[#25354C]"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-xl border border-dashed border-[#C9C4B5] flex items-center justify-center text-[#525C6B]">
                    <Camera className="w-5 h-5" />
                  </div>
                )}
                <label className="flex-1 min-h-[42px] px-3 rounded-xl border border-dashed border-[#156143] text-[#156143] dark:text-[#4ADE80] font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer">
                  <Upload className="w-4 h-4" />
                  <span>{form.photoUrl ? 'เปลี่ยนรูปนักกีฬาคนที่ 1' : 'อัปโหลดรูปนักกีฬาคนที่ 1 *'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(e) =>
                      compressImageUpload(e, 320, (url) =>
                        setForm((prev) => ({ ...prev, photoUrl: url }))
                      )
                    }
                  />
                </label>
              </div>
            </div>

            {/* Player 2 if doubles */}
            {effectiveFormat === 'doubles' && (
              <div className="rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-4 space-y-2.5">
                <div className="font-bold text-sm">ข้อมูลนักกีฬาคนที่ 2 (คู่หู) *</div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={form.partnerFirstName}
                    onChange={(e) => setForm({ ...form, partnerFirstName: e.target.value })}
                    placeholder="ชื่อจริงคู่หู *"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                  />
                  <input
                    value={form.partnerLastName}
                    onChange={(e) => setForm({ ...form, partnerLastName: e.target.value })}
                    placeholder="นามสกุลคู่หู *"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={form.partnerNickname}
                    onChange={(e) => setForm({ ...form, partnerNickname: e.target.value })}
                    placeholder="ชื่อเล่นคู่หู"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                  />
                  <input
                    value={form.partnerPhone}
                    onChange={(e) => setForm({ ...form, partnerPhone: e.target.value })}
                    placeholder="เบอร์โทรคู่หู"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select value={form.partnerGender} onChange={(e) => setForm({ ...form, partnerGender: e.target.value as 'M' | 'F' })} className="w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"><option value="M">ชาย</option><option value="F">หญิง</option></select>
                  <input type="date" value={form.partnerBirthDate} onChange={(e) => setForm({ ...form, partnerBirthDate: e.target.value })} aria-label="วันเกิดนักกีฬาคนที่ 2" className="w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                  <input value={form.partnerNationality} onChange={(e) => setForm({ ...form, partnerNationality: e.target.value })} placeholder="สัญชาติ *" className="w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                  <input value={form.partnerIdDocumentNo} onChange={(e) => setForm({ ...form, partnerIdDocumentNo: e.target.value })} placeholder="เลขบัตร/หนังสือเดินทาง" className="w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                  <input type="email" value={form.partnerEmail} onChange={(e) => setForm({ ...form, partnerEmail: e.target.value })} placeholder="อีเมลคนที่ 2" className="w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                </div>
                <textarea rows={2} value={form.partnerAddress} onChange={(e) => setForm({ ...form, partnerAddress: e.target.value })} placeholder="ที่อยู่ติดต่อคนที่ 2 *" className="w-full p-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                <input value={form.partnerEmergencyContact} onChange={(e) => setForm({ ...form, partnerEmergencyContact: e.target.value })} placeholder="ผู้ติดต่อฉุกเฉินคนที่ 2 (ชื่อ/เบอร์โทร) *" className="w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                <input value={form.partnerHealthInfo} onChange={(e) => setForm({ ...form, partnerHealthInfo: e.target.value })} placeholder="ข้อมูลสุขภาพคนที่ 2 (ถ้ามี)" className="w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                <label className="rounded-xl border border-[#BBDCCF] bg-[#F1FAF6] p-3 flex items-start gap-2.5 dark:border-[#24533F] dark:bg-[#10291E]">
                  <input type="checkbox" checked={form.partnerPdpaConsent} onChange={(e) => setForm({ ...form, partnerPdpaConsent: e.target.checked })} className="mt-0.5" />
                  <span className="text-[11px]"><strong className="block">ความยินยอม PDPA ของนักกีฬาคนที่ 2 *</strong>{tournament?.registrationConfig.pdpaConsentText}</span>
                </label>
                <div className="flex items-center gap-3 pt-1">
                  {form.partnerPhotoUrl ? (
                    <img
                      src={form.partnerPhotoUrl}
                      alt="รูปนักกีฬาคนที่ 2"
                      className="w-12 h-12 rounded-xl object-cover border border-[#E2DFD5] dark:border-[#25354C]"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl border border-dashed border-[#C9C4B5] flex items-center justify-center text-[#525C6B]">
                      <Camera className="w-5 h-5" />
                    </div>
                  )}
                  <label className="flex-1 min-h-[42px] px-3 rounded-xl border border-dashed border-[#156143] text-[#156143] dark:text-[#4ADE80] font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer">
                    <Upload className="w-4 h-4" />
                    <span>
                      {form.partnerPhotoUrl
                        ? 'เปลี่ยนรูปนักกีฬาคนที่ 2'
                        : 'อัปโหลดรูปนักกีฬาคนที่ 2 *'}
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={(e) =>
                        compressImageUpload(e, 320, (url) =>
                          setForm((prev) => ({ ...prev, partnerPhotoUrl: url }))
                        )
                      }
                    />
                  </label>
                </div>
              </div>
            )}
            </>}

            {/* Skill Assessment Video Link */}
            <div className="rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-4 space-y-2">
              <label className="font-bold text-sm flex items-center gap-1.5">
                <Video className="w-4 h-4 text-[#156143] dark:text-[#4ADE80]" />
                <span>ลิงก์วิดีโอประเมินระดับมือ (Skill Assessment Video)</span>
              </label>
              <p className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
                วางลิงก์ YouTube, TikTok, Facebook หรือ Google Drive เพื่อให้คณะกรรมการพิจารณาจัดระดับมือ
              </p>
              <div className="relative">
                <Link2 className="w-4 h-4 text-[#525C6B] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="url"
                  value={form.skillVideoUrl}
                  onChange={(e) => setForm({ ...form, skillVideoUrl: e.target.value })}
                  placeholder="https://youtube.com/watch?v=... หรือ https://drive.google.com/..."
                  className="w-full min-h-[42px] pl-9 pr-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                />
              </div>
              {!isVideoUrlValid && (
                <div className="text-[11px] text-[#B91C1C] dark:text-[#F87171]">
                  ลิงก์วิดีโอต้องขึ้นต้นด้วย http:// หรือ https://
                </div>
              )}
            </div>

            {/* PDPA */}
            {false && <label className="rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-3.5 flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.pdpaConsent}
                onChange={(e) => setForm({ ...form, pdpaConsent: e.target.checked })}
                className="mt-0.5"
              />
              <span className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
                {tournament?.registrationConfig.pdpaConsentText}
              </span>
            </label>}

            <button
              type="button"
              disabled={
                !selectedDivision ||
                !form.firstName.trim() ||
                !form.lastName.trim() ||
                !form.phone.trim() ||
                !form.birthDate ||
                !form.nationality.trim() ||
                !form.address.trim() ||
                !form.emergencyContact.trim() ||
                !form.photoUrl ||
                !form.pdpaConsent ||
                !isVideoUrlValid ||
                (effectiveFormat === 'doubles' &&
                  (!form.partnerFirstName.trim() ||
                    !form.partnerLastName.trim() ||
                    !form.partnerPhone.trim() ||
                    !form.partnerBirthDate ||
                    !form.partnerNationality.trim() ||
                    !form.partnerAddress.trim() ||
                    !form.partnerEmergencyContact.trim() ||
                    !form.partnerPdpaConsent ||
                    !form.partnerPhotoUrl))
              }
              onClick={() => setStep('payment')}
              className="w-full min-h-[48px] rounded-xl bg-[#156143] hover:bg-[#104D35] text-white text-sm font-bold disabled:opacity-40"
            >
              ถัดไป: ชำระเงิน & แนบสลิป (฿{fee.toLocaleString()}) →
            </button>
          </div>
        ) : step === 'payment' ? (
          <div className="rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-4 space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-[#E2DFD5] dark:border-[#25354C] pb-3">
              <div>
                <div className="font-bold text-sm">ชำระค่าสมัคร & แนบหลักฐานโอนเงิน</div>
                <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
                  รุ่น {selectedDivision?.nameTh} ({effectiveFormat === 'doubles' ? 'คู่' : 'เดี่ยว'})
                </div>
              </div>
              <div className="text-xl font-extrabold font-mono tabular-nums text-[#156143] dark:text-[#4ADE80]">
                ฿{fee.toLocaleString()}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] space-y-1.5">
              <div className="font-bold">ข้อมูลการโอนเงิน / พร้อมเพย์</div>
              <div>ธนาคาร: {tournament.paymentConfig.bankName || 'ธนาคารกสิกรไทย'}</div>
              <div className="font-mono font-bold text-sm">
                เลขบัญชี: {tournament.paymentConfig.bankAccountNo}
              </div>
              <div>ชื่อบัญชี: {tournament.paymentConfig.bankAccountName}</div>
              {tournament.paymentConfig.promptPayId && (
                <div className="font-mono">
                  PromptPay ID: {tournament.paymentConfig.promptPayId}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <input
                value={slipBank}
                onChange={(e) => setSlipBank(e.target.value)}
                placeholder="ธนาคารที่โอน (เช่น K PLUS / SCB / PromptPay)"
                className="w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
              />
              <input
                value={slipRef}
                onChange={(e) => setSlipRef(e.target.value)}
                placeholder="เลขอ้างอิงสลิป (ถ้ามี)"
                className="w-full min-h-[42px] px-3 rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
              />
              {slipImage && (
                <img
                  src={slipImage}
                  alt="สลิปที่แนบ"
                  className="w-full max-h-56 object-contain rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white"
                />
              )}
              <label className="w-full min-h-[46px] px-3 rounded-xl border-2 border-dashed border-[#156143] text-[#156143] dark:text-[#4ADE80] font-bold inline-flex items-center justify-center gap-2 cursor-pointer">
                <Upload className="w-4 h-4" />
                <span>{slipImage ? 'เปลี่ยนรูปสลิปโอนเงิน' : 'อัปโหลดรูปสลิปโอนเงิน (บังคับ) *'}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(e) => compressImageUpload(e, 720, (url) => setSlipImage(url))}
                />
              </label>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep('form')}
                className="flex-1 min-h-[46px] rounded-xl border border-[#E2DFD5] dark:border-[#25354C] font-semibold"
              >
                ← ย้อนแก้ไขข้อมูล
              </button>
              <button
                type="button"
                disabled={!slipImage || submitting}
                onClick={handleSubmit}
                className="flex-1 min-h-[46px] rounded-xl bg-[#156143] hover:bg-[#104D35] text-white font-bold disabled:opacity-40"
              >
                {submitting ? 'กำลังบันทึก...' : 'ยืนยันชำระเงิน & ส่งใบสมัคร'}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-6 text-center space-y-4">
            <CheckCircle2 className="w-12 h-12 text-[#156143] dark:text-[#4ADE80] mx-auto" />
            <div>
              <h2 className="text-lg font-bold">
                {createdPlayer?.waitingList
                  ? 'บันทึกเข้าคิว Waiting List แล้ว'
                  : 'ลงทะเบียนและแนบสลิปสำเร็จ!'}
              </h2>
              <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC] mt-1">
                กรุณาบันทึกรหัสตรวจสอบหรือ QR Code ด้านล่างไว้ เพื่อใช้ติดตามสถานะอนุมัติ ผลตรวจสลิป และสายการแข่งขันของทีมคุณ
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-left">
              <div className="p-3 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C]">
                <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">เลขที่ใบสมัคร</div>
                <div className="font-mono text-base font-bold text-[#141D2B] dark:text-[#F3F5F8]">
                  {createdPlayer?.registrationCode}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#ECFDF3] dark:bg-[#0E2E1D] border border-[#A7F3D0] dark:border-[#1E5C40]">
                <div className="text-[11px] text-[#156143] dark:text-[#4ADE80]">รหัสตรวจสอบ (Verify Code)</div>
                <div className="font-mono text-base font-extrabold tracking-wider text-[#156143] dark:text-[#4ADE80]">
                  {verificationCode}
                </div>
              </div>
            </div>

            <div className="flex justify-center">
              <QRCodeMatrix value={statusUrl} size={156} />
            </div>

            <div className="p-2.5 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] text-[11px] font-mono truncate">
              {statusUrl}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(statusUrl);
                  notify('success', 'คัดลอกลิงก์หน้าตรวจสอบสถานะแล้ว');
                }}
                className="flex-1 min-h-[44px] rounded-xl border border-[#E2DFD5] dark:border-[#25354C] text-xs font-semibold inline-flex items-center justify-center gap-1.5"
              >
                <Copy className="w-4 h-4" />
                <span>คัดลอกลิงก์หน้าตรวจสอบ</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setPublicLookupCode(verificationCode);
                  setPortalMode('public_status');
                }}
                className="flex-1 min-h-[44px] rounded-xl bg-[#142642] hover:bg-[#1E355C] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5"
              >
                <ExternalLink className="w-4 h-4" />
                <span>เปิดดูสถานะ & สายแข่ง</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
