import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, FileUp, Gavel, LogIn, ShieldCheck, Upload } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { apiFetch, stageTournamentFile } from '../../services/api';
import { Tournament } from '../../types/tournament';
import { QRCodeMatrix } from '../common/UIPrimitives';

type ApplicationResult = {
  id: string;
  code: string;
  loginCode: string;
  approvalStatus: 'pending';
  message: string;
};

export const PublicDirectorApplicationPage: React.FC = () => {
  const { state, selectedTournamentId, notify } = useApp();
  const contextTournament = useMemo(
    () => state.tournaments.find((item) => item.id === selectedTournamentId)
      || state.tournaments.find((item) => item.publicToken === selectedTournamentId)
      || state.tournaments[0]
      || null,
    [state.tournaments, selectedTournamentId],
  );
  const [publicTournament, setPublicTournament] = useState<Tournament | null>(null);
  const tournament = publicTournament || contextTournament;
  const linkToken = selectedTournamentId || new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('tournament') || '';
  useEffect(() => {
    if (!linkToken) return;
    void apiFetch<{tournaments: Tournament[]}>(`/api/public-tournament/state?token=${encodeURIComponent(linkToken)}`)
      .then((data) => setPublicTournament(data.tournaments[0] || null))
      .catch((error) => notify('error', error instanceof Error ? error.message : 'ไม่พบรายการแข่งขัน'));
  }, [linkToken, notify]);
  const [submitting, setSubmitting] = useState(false);
  const [document, setDocument] = useState<File | null>(null);
  const [result, setResult] = useState<ApplicationResult | null>(null);
  const [form, setForm] = useState({
    firstName: '', lastName: '', nickname: '', phone: '', email: '',
    certification: 'ผู้ตัดสินชมรม / สโมสร', clubAffiliation: '',
    address: '', emergencyContact: '', lineId: '', experienceNote: '',
    pdpaConsent: false,
  });

  if (!tournament) {
    return <main className="mx-auto max-w-xl p-6 text-center">ไม่พบรายการแข่งขัน กรุณาตรวจสอบ QR หรือลิงก์อีกครั้ง</main>;
  }

  const token = linkToken || tournament.publicToken || tournament.id;
  const loginUrl = typeof window === 'undefined'
    ? '/?mode=umpire'
    : `${window.location.origin}/?mode=umpire${result ? `&code=${encodeURIComponent(result.loginCode)}` : ''}`;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.pdpaConsent) {
      notify('error', 'กรุณาอ่านและยืนยันความยินยอม PDPA');
      return;
    }
    setSubmitting(true);
    try {
      let documentFileId: string | undefined;
      if (document) {
        const staged = await stageTournamentFile(
          `/api/public/files/stage?token=${encodeURIComponent(token)}`,
          document,
          'director_document',
        );
        documentFileId = staged.fileId;
      }
      const created = await apiFetch<ApplicationResult>(
        `/api/public-tournament/director-apply?token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...form,
            tournamentId: tournament.id,
            documentFileId,
            documentName: document?.name,
          }),
        },
      );
      setResult(created);
      notify('success', 'ส่งใบสมัครกรรมการแล้ว กรุณารอผู้จัดอนุมัติ');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'ส่งใบสมัครไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-2xl items-center p-4 sm:p-8">
        <section className="w-full rounded-2xl border border-[#D8D5CC] bg-white p-6 text-center shadow-xl dark:border-[#25354C] dark:bg-[#131E2E] sm:p-8">
          <CheckCircle2 className="mx-auto h-12 w-12 text-[#156143]" />
          <h1 className="mt-3 text-2xl font-bold">รับใบสมัครกรรมการแล้ว</h1>
          <p className="mt-2 text-sm text-[#667085] dark:text-[#9AA8BC]">รหัสนี้ออกให้แล้ว แต่จะเข้าสู่ระบบได้หลังผู้จัดรายการอนุมัติเท่านั้น</p>
          <div className="mx-auto mt-5 max-w-md rounded-xl border border-[#F4C86A] bg-[#FFF8E7] p-4 dark:border-[#6B4D16] dark:bg-[#2B210E]">
            <div className="text-xs font-bold text-[#7A4E00] dark:text-[#F8D37B]">รหัสเข้าสู่ระบบ 12 หลัก — บันทึกไว้ตอนนี้</div>
            <div className="mt-2 font-mono text-2xl font-black tracking-[0.18em] text-[#142642] dark:text-white">
              {result.loginCode}
            </div>
            <button type="button" onClick={() => navigator.clipboard?.writeText(result.loginCode)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#142642] px-4 text-xs font-bold text-white">
              <Copy className="h-4 w-4" /> คัดลอกรหัส
            </button>
          </div>
          <div className="mx-auto mt-5 w-fit rounded-xl bg-white p-3"><QRCodeMatrix value={loginUrl} size={176} /></div>
          <a href={loginUrl} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#156143] px-5 text-sm font-bold text-white">
            <LogIn className="h-4 w-4" /> ไปหน้าเข้าสู่ระบบกรรมการ
          </a>
          <p className="mt-4 rounded-lg bg-[#F7F6F2] p-3 text-xs text-[#667085] dark:bg-[#0B121C] dark:text-[#9AA8BC]">หากยังไม่ได้รับอนุมัติ ระบบจะแจ้งว่า “ใบสมัครอยู่ระหว่างรออนุมัติ” และจะไม่สร้าง session ให้</p>
        </section>
      </main>
    );
  }

  const inputClass = 'mt-1 min-h-11 w-full rounded-lg border border-[#CFCBC0] bg-white px-3 text-sm dark:border-[#25354C] dark:bg-[#0B121C]';
  return (
    <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
      <header className="rounded-2xl bg-[#142642] p-5 text-white sm:p-7">
        <div className="flex items-center gap-3"><Gavel className="h-8 w-8 text-[#F4C86A]" /><div><p className="text-xs text-[#C7D2E3]">LiveMatch Tournament</p><h1 className="text-xl font-bold">สมัครกรรมการออนไลน์</h1></div></div>
        <p className="mt-3 text-sm text-[#DCE5F2]">{tournament.name} · ไม่มีค่าธรรมเนียมสมัคร และไม่ต้องชำระเงิน</p>
      </header>
      <form onSubmit={submit} className="mt-4 space-y-5 rounded-2xl border border-[#D8D5CC] bg-white p-5 shadow-sm dark:border-[#25354C] dark:bg-[#131E2E] sm:p-7">
        <section>
          <h2 className="font-bold">ข้อมูลผู้สมัคร</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold">ชื่อจริง *<input required value={form.firstName} onChange={(e) => setForm({...form, firstName:e.target.value})} className={inputClass}/></label>
            <label className="text-xs font-semibold">นามสกุล *<input required value={form.lastName} onChange={(e) => setForm({...form, lastName:e.target.value})} className={inputClass}/></label>
            <label className="text-xs font-semibold">ชื่อเล่น<input value={form.nickname} onChange={(e) => setForm({...form, nickname:e.target.value})} className={inputClass}/></label>
            <label className="text-xs font-semibold">เบอร์โทร *<input required value={form.phone} onChange={(e) => setForm({...form, phone:e.target.value})} className={inputClass}/></label>
            <label className="text-xs font-semibold">อีเมล<input type="email" value={form.email} onChange={(e) => setForm({...form, email:e.target.value})} className={inputClass}/></label>
            <label className="text-xs font-semibold">LINE ID<input value={form.lineId} onChange={(e) => setForm({...form, lineId:e.target.value})} className={inputClass}/></label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold">ที่อยู่ติดต่อ<textarea required rows={2} value={form.address} onChange={(e) => setForm({...form, address:e.target.value})} className={inputClass}/></label>
            <label className="text-xs font-semibold">ผู้ติดต่อฉุกเฉิน (ชื่อ/เบอร์โทร) *<textarea required rows={2} value={form.emergencyContact} onChange={(e) => setForm({...form, emergencyContact:e.target.value})} className={inputClass}/></label>
          </div>
        </section>
        <section className="border-t border-[#E2DFD5] pt-5 dark:border-[#25354C]">
          <h2 className="font-bold">คุณสมบัติกรรมการ</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold">ระดับใบรับรอง<select value={form.certification} onChange={(e) => setForm({...form, certification:e.target.value})} className={inputClass}><option>ผู้ตัดสินชมรม / สโมสร</option><option>กรรมการสมาคมฯ ระดับ 1</option><option>กรรมการสมาคมฯ ระดับ 2</option><option>ผู้ตัดสินอิสระ</option></select></label>
            <label className="text-xs font-semibold">สังกัดสโมสร / ชมรม<input value={form.clubAffiliation} onChange={(e) => setForm({...form, clubAffiliation:e.target.value})} className={inputClass}/></label>
          </div>
          <div className="mt-3 rounded-lg border border-[#BBDCCF] bg-[#F1FAF6] p-3 text-xs text-[#156143] dark:border-[#24533F] dark:bg-[#10291E] dark:text-[#4ADE80]">กรรมการที่ผ่านการอนุมัติสามารถตัดสินได้ทุกระดับและทุกประเภทการแข่งขัน</div>
          <label className="mt-3 block text-xs font-semibold">ประสบการณ์ตัดสิน<textarea rows={3} value={form.experienceNote} onChange={(e) => setForm({...form, experienceNote:e.target.value})} className={inputClass}/></label>
        </section>
        <section className="border-t border-[#E2DFD5] pt-5 dark:border-[#25354C]">
          <h2 className="font-bold">เอกสารประกอบ (ไม่บังคับ)</h2>
          <label className="mt-3 flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[#9AA8BC] px-4 text-sm"><FileUp className="h-5 w-5"/><span className="flex-1 truncate">{document?.name || 'แนบใบรับรอง รูปภาพ หรือ PDF (สูงสุดตามที่ระบบกำหนด)'}</span><Upload className="h-4 w-4"/><input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e)=>setDocument(e.target.files?.[0]||null)}/></label>
        </section>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#BBDCCF] bg-[#F1FAF6] p-4 text-sm dark:border-[#24533F] dark:bg-[#10291E]">
          <input required type="checkbox" checked={form.pdpaConsent} onChange={(e)=>setForm({...form,pdpaConsent:e.target.checked})} className="mt-1"/>
          <span><span className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4 text-[#156143]"/>ความยินยอม PDPA *</span><span className="mt-1 block text-xs leading-5 text-[#526071] dark:text-[#B9C4D3]">{tournament.registrationConfig.pdpaConsentText}</span></span>
        </label>
        <button disabled={submitting || !form.pdpaConsent} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#156143] px-5 font-bold text-white disabled:opacity-45">{submitting?'กำลังส่งใบสมัคร…':'ส่งใบสมัครกรรมการ (ไม่มีค่าธรรมเนียม)'}</button>
      </form>
    </main>
  );
};
