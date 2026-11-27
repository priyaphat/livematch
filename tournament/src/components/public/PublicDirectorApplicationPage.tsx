import React, { useEffect, useMemo, useState } from 'react';
import { Camera, CheckCircle2, Copy, FileUp, Gavel, LogIn, ShieldCheck, Trash2, Upload } from 'lucide-react';
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

const OFFICIAL_ROLES = [
  { value: 'chair_umpire', label: 'กรรมการผู้ตัดสิน (Chair Umpire)' },
  { value: 'service_judge', label: 'กรรมการกำกับการส่งลูก (Service Judge)' },
  { value: 'line_judge', label: 'กรรมการกำกับเส้น (Line Judge)' },
  { value: 'match_control', label: 'ควบคุมการแข่งขัน / ผู้ช่วย Referee' },
];

const SCORING_SKILLS = [
  { value: 'paper_scoresheet', label: 'ใช้ใบบันทึกคะแนนกระดาษได้' },
  { value: 'digital_scoring', label: 'ใช้ระบบบันทึกคะแนนดิจิทัลได้' },
  { value: 'badminton_english', label: 'ใช้คำศัพท์แบดมินตันภาษาอังกฤษได้' },
];

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
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('');
  const [document, setDocument] = useState<File | null>(null);
  const [result, setResult] = useState<ApplicationResult | null>(null);
  const [form, setForm] = useState({
    firstName: '', lastName: '', nickname: '', phone: '', email: '',
    lineId: '', province: '', emergencyContactName: '', emergencyContactPhone: '',
    officialRoles: [] as string[], certificationLevel: 'none_club', certificationBody: '',
    licenseNumber: '', certificationExpiry: '', yearsExperience: '', matchesOfficiated: '',
    scoringSkills: [] as string[], clubAffiliation: '', experienceNote: '', shirtSize: '', logisticsNote: '',
    pdpaConsent: false, codeOfConductConsent: false,
  });

  useEffect(() => {
    if (!photo) {
      setPhotoPreviewUrl('');
      return undefined;
    }
    const previewUrl = URL.createObjectURL(photo);
    setPhotoPreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [photo]);

  if (!tournament) {
    return <main className="mx-auto max-w-xl p-6 text-center">ไม่พบรายการแข่งขัน กรุณาตรวจสอบ QR หรือลิงก์อีกครั้ง</main>;
  }

  const token = linkToken || tournament.publicToken || tournament.id;
  const loginUrl = typeof window === 'undefined'
    ? '/?mode=umpire'
    : `${window.location.origin}/?mode=umpire${result ? `&code=${encodeURIComponent(result.loginCode)}` : ''}`;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.officialRoles.length === 0) {
      notify('error', 'กรุณาเลือกบทบาทกรรมการที่สมัครอย่างน้อย 1 รายการ');
      return;
    }
    if (!form.pdpaConsent) {
      notify('error', 'กรุณาอ่านและยืนยันความยินยอม PDPA');
      return;
    }
    if (!form.codeOfConductConsent) {
      notify('error', 'กรุณารับรองความถูกต้องของข้อมูลและยอมรับจรรยาบรรณกรรมการ');
      return;
    }
    setSubmitting(true);
    try {
      let photoFileId: string | undefined;
      let documentFileId: string | undefined;
      if (photo) {
        const stagedPhoto = await stageTournamentFile(
          `/api/public/files/stage?token=${encodeURIComponent(token)}`,
          photo,
          'director_photo',
        );
        photoFileId = stagedPhoto.fileId;
      }
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
            yearsExperience: form.yearsExperience === '' ? undefined : Number(form.yearsExperience),
            matchesOfficiated: form.matchesOfficiated === '' ? undefined : Number(form.matchesOfficiated),
            tournamentId: tournament.id,
            photoFileId,
            photoName: photo?.name,
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
  const applicationOpen = tournament.directorApplicationAvailability?.isOpen !== false;
  const toggleListValue = (field: 'officialRoles' | 'scoringSkills', value: string) => {
    setForm((previous) => ({
      ...previous,
      [field]: previous[field].includes(value)
        ? previous[field].filter((item) => item !== value)
        : [...previous[field], value],
    }));
  };
  return (
    <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
      <header className="rounded-2xl bg-[#142642] p-5 text-white sm:p-7">
        <div className="flex items-center gap-3"><Gavel className="h-8 w-8 text-[#F4C86A]" /><div><p className="text-xs text-[#C7D2E3]">LiveMatch Tournament</p><h1 className="text-xl font-bold">สมัครกรรมการออนไลน์</h1></div></div>
        <p className="mt-3 text-sm text-[#DCE5F2]">{tournament.name} · ไม่มีค่าธรรมเนียมสมัคร และไม่ต้องชำระเงิน</p>
      </header>
      {!applicationOpen && (
        <div className="mt-4 rounded-xl border border-[#F4C7C7] bg-[#FFF3F3] p-4 text-sm font-semibold text-[#A92929] dark:border-[#6B2A2A] dark:bg-[#2A1212] dark:text-[#FCA5A5]">
          {tournament.directorApplicationAvailability?.reason || 'รายการนี้ปิดรับสมัครกรรมการแล้ว'}
        </div>
      )}
      <form onSubmit={submit} className="mt-4 space-y-5 rounded-2xl border border-[#D8D5CC] bg-white p-5 shadow-sm dark:border-[#25354C] dark:bg-[#131E2E] sm:p-7">
        <section>
          <h2 className="font-bold">1. ข้อมูลติดต่อ</h2>
          <p className="mt-1 text-xs text-[#667085] dark:text-[#9AA8BC]">เก็บเฉพาะข้อมูลที่ผู้จัดใช้ติดต่อ อนุมัติ และประสานงานในวันแข่งขัน</p>
          <div className="mt-3 flex flex-col gap-3 rounded-xl border border-[#E2DFD5] bg-[#F7F6F2] p-3 dark:border-[#25354C] dark:bg-[#0B121C] sm:flex-row sm:items-center">
            {photoPreviewUrl ? (
              <img src={photoPreviewUrl} alt="ตัวอย่างรูปกรรมการ" className="h-24 w-24 shrink-0 rounded-xl border border-[#BBDCCF] bg-white object-cover" />
            ) : (
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-dashed border-[#9AA8BC] bg-white text-[#667085] dark:bg-[#131E2E]">
                <Camera className="h-7 w-7" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold">รูปถ่ายกรรมการ</div>
              <p className="mt-1 text-xs leading-5 text-[#667085] dark:text-[#9AA8BC]">ใช้รูปหน้าตรงที่เห็นใบหน้าชัดเจน สำหรับตรวจสอบตัวตนและแสดงในระบบกรรมการ รองรับ JPG, PNG หรือ WebP ไม่เกิน 8 MB</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg bg-[#142642] px-3 text-xs font-bold text-white">
                  <Upload className="h-4 w-4" /> {photo ? 'เปลี่ยนรูปภาพ' : 'อัปโหลดรูปภาพ'}
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      const selected = event.target.files?.[0] || null;
                      event.target.value = '';
                      if (!selected) return;
                      if (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type)) {
                        notify('error', 'รองรับเฉพาะรูป JPG, PNG และ WebP');
                        return;
                      }
                      if (selected.size > 8 * 1024 * 1024) {
                        notify('error', 'รูปภาพต้องมีขนาดไม่เกิน 8 MB');
                        return;
                      }
                      setPhoto(selected);
                    }}
                  />
                </label>
                {photo && (
                  <button type="button" onClick={() => setPhoto(null)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#F1B7B7] px-3 text-xs font-bold text-[#A92929] dark:text-[#FCA5A5]">
                    <Trash2 className="h-4 w-4" /> ลบรูป
                  </button>
                )}
              </div>
              {photo && <p className="mt-2 truncate text-[11px] text-[#667085]">{photo.name} · {(photo.size / 1024 / 1024).toFixed(2)} MB</p>}
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold">ชื่อจริง *<input required value={form.firstName} onChange={(e) => setForm({...form, firstName:e.target.value})} className={inputClass}/></label>
            <label className="text-xs font-semibold">นามสกุล *<input required value={form.lastName} onChange={(e) => setForm({...form, lastName:e.target.value})} className={inputClass}/></label>
            <label className="text-xs font-semibold">ชื่อเล่น<input value={form.nickname} onChange={(e) => setForm({...form, nickname:e.target.value})} className={inputClass}/></label>
            <label className="text-xs font-semibold">เบอร์โทร *<input required type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({...form, phone:e.target.value})} className={inputClass}/></label>
            <label className="text-xs font-semibold">อีเมล *<input required type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({...form, email:e.target.value})} className={inputClass}/></label>
            <label className="text-xs font-semibold">LINE ID<input value={form.lineId} onChange={(e) => setForm({...form, lineId:e.target.value})} className={inputClass}/></label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold">จังหวัดที่พำนัก *<input required autoComplete="address-level1" value={form.province} onChange={(e) => setForm({...form, province:e.target.value})} className={inputClass}/></label>
            <label className="text-xs font-semibold">ชื่อผู้ติดต่อฉุกเฉิน *<input required value={form.emergencyContactName} onChange={(e) => setForm({...form, emergencyContactName:e.target.value})} className={inputClass}/></label>
            <label className="text-xs font-semibold">เบอร์ผู้ติดต่อฉุกเฉิน *<input required type="tel" inputMode="tel" value={form.emergencyContactPhone} onChange={(e) => setForm({...form, emergencyContactPhone:e.target.value})} className={inputClass}/></label>
          </div>
        </section>
        <section className="border-t border-[#E2DFD5] pt-5 dark:border-[#25354C]">
          <h2 className="font-bold">2. บทบาทและคุณสมบัติ</h2>
          <fieldset className="mt-3">
            <legend className="text-xs font-semibold">บทบาทที่สมัคร * (เลือกได้มากกว่า 1)</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {OFFICIAL_ROLES.map((role) => (
                <label key={role.value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${form.officialRoles.includes(role.value) ? 'border-[#156143] bg-[#F1FAF6] text-[#156143] dark:bg-[#10291E] dark:text-[#4ADE80]' : 'border-[#D8D5CC] dark:border-[#25354C]'}`}>
                  <input type="checkbox" checked={form.officialRoles.includes(role.value)} onChange={() => toggleListValue('officialRoles', role.value)}/>
                  {role.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold">ระดับการรับรอง *<select required value={form.certificationLevel} onChange={(e) => setForm({...form, certificationLevel:e.target.value})} className={inputClass}><option value="none_club">ยังไม่มีใบรับรอง / ระดับชมรม</option><option value="provincial">ระดับจังหวัด / ภูมิภาค</option><option value="national">ระดับประเทศ</option><option value="badminton_asia">Badminton Asia</option><option value="bwf">BWF</option></select></label>
            <label className="text-xs font-semibold">สังกัดสโมสร / ชมรม<input value={form.clubAffiliation} onChange={(e) => setForm({...form, clubAffiliation:e.target.value})} className={inputClass}/></label>
            <label className="text-xs font-semibold">หน่วยงานที่ออกใบรับรอง<input placeholder="เช่น สมาคมกีฬาแบดมินตันฯ" value={form.certificationBody} onChange={(e) => setForm({...form, certificationBody:e.target.value})} className={inputClass}/></label>
            <label className="text-xs font-semibold">เลขใบอนุญาต / เลขสมาชิก<input value={form.licenseNumber} onChange={(e) => setForm({...form, licenseNumber:e.target.value})} className={inputClass}/></label>
            <label className="text-xs font-semibold">วันหมดอายุใบรับรอง<input type="date" value={form.certificationExpiry} onChange={(e) => setForm({...form, certificationExpiry:e.target.value})} className={inputClass}/></label>
            <label className="text-xs font-semibold">ขนาดเสื้อ (ถ้ามีเสื้อทีมงาน)<select value={form.shirtSize} onChange={(e) => setForm({...form, shirtSize:e.target.value})} className={inputClass}><option value="">ไม่ระบุ</option><option>XS</option><option>S</option><option>M</option><option>L</option><option>XL</option><option>2XL</option><option>3XL</option></select></label>
          </div>
        </section>
        <section className="border-t border-[#E2DFD5] pt-5 dark:border-[#25354C]">
          <h2 className="font-bold">3. ประสบการณ์และทักษะ</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold">ประสบการณ์ (ปี)<input min="0" max="80" inputMode="numeric" type="number" value={form.yearsExperience} onChange={(e) => setForm({...form, yearsExperience:e.target.value})} className={inputClass}/></label>
            <label className="text-xs font-semibold">จำนวนแมตช์ที่เคยปฏิบัติหน้าที่โดยประมาณ<input min="0" inputMode="numeric" type="number" value={form.matchesOfficiated} onChange={(e) => setForm({...form, matchesOfficiated:e.target.value})} className={inputClass}/></label>
          </div>
          <fieldset className="mt-3">
            <legend className="text-xs font-semibold">ทักษะการบันทึกคะแนน</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {SCORING_SKILLS.map((skill) => (
                <label key={skill.value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-[#D8D5CC] px-3 text-xs dark:border-[#25354C]">
                  <input type="checkbox" checked={form.scoringSkills.includes(skill.value)} onChange={() => toggleListValue('scoringSkills', skill.value)}/>
                  {skill.label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="mt-3 block text-xs font-semibold">รายการหรือประสบการณ์ล่าสุด<textarea rows={3} placeholder="เช่น ชื่อรายการ ปี และหน้าที่ที่รับผิดชอบ" value={form.experienceNote} onChange={(e) => setForm({...form, experienceNote:e.target.value})} className={inputClass}/></label>
          <label className="mt-3 block text-xs font-semibold">ข้อมูลสำหรับการประสานงานเพิ่มเติม<textarea rows={2} placeholder="เช่น อาหาร ข้อจำกัดการเดินทาง หรือการอำนวยความสะดวกที่ต้องการ (ไม่ต้องระบุข้อมูลสุขภาพ)" value={form.logisticsNote} onChange={(e) => setForm({...form, logisticsNote:e.target.value})} className={inputClass}/></label>
          <div className="mt-3 rounded-lg border border-[#BBDCCF] bg-[#F1FAF6] p-3 text-xs text-[#156143] dark:border-[#24533F] dark:bg-[#10291E] dark:text-[#4ADE80]">เมื่อผ่านการอนุมัติ ผู้จัดสามารถมอบหมายการแข่งขันได้ทุกระดับและทุกประเภทตามความเหมาะสม</div>
        </section>
        <section className="border-t border-[#E2DFD5] pt-5 dark:border-[#25354C]">
          <h2 className="font-bold">4. เอกสารประกอบ (ไม่บังคับ)</h2>
          <label className="mt-3 flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[#9AA8BC] px-4 text-sm"><FileUp className="h-5 w-5"/><span className="flex-1 truncate">{document?.name || 'แนบบัตรกรรมการ ใบรับรอง หรือ PDF เพื่อช่วยตรวจสอบคุณสมบัติ'}</span><Upload className="h-4 w-4"/><input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e)=>setDocument(e.target.files?.[0]||null)}/></label>
        </section>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#BBDCCF] bg-[#F1FAF6] p-4 text-sm dark:border-[#24533F] dark:bg-[#10291E]">
          <input required type="checkbox" checked={form.pdpaConsent} onChange={(e)=>setForm({...form,pdpaConsent:e.target.checked})} className="mt-1"/>
          <span><span className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4 text-[#156143]"/>ความยินยอม PDPA *</span><span className="mt-1 block text-xs leading-5 text-[#526071] dark:text-[#B9C4D3]">{tournament.registrationConfig?.pdpaConsentText || 'ยินยอมให้ผู้จัดเก็บและใช้ข้อมูลในใบสมัครเพื่อพิจารณา ติดต่อ และบริหารจัดการแข่งขัน โดยเปิดเผยเท่าที่จำเป็นตามวัตถุประสงค์ของรายการ'}</span></span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#D8D5CC] p-4 text-sm dark:border-[#25354C]">
          <input required type="checkbox" checked={form.codeOfConductConsent} onChange={(e)=>setForm({...form,codeOfConductConsent:e.target.checked})} className="mt-1"/>
          <span><strong className="block">รับรองข้อมูลและยอมรับจรรยาบรรณกรรมการ *</strong><span className="mt-1 block text-xs leading-5 text-[#526071] dark:text-[#B9C4D3]">ข้าพเจ้ารับรองว่าข้อมูลเป็นจริง จะปฏิบัติหน้าที่อย่างเป็นกลาง รักษาความลับ หลีกเลี่ยงผลประโยชน์ทับซ้อน และปฏิบัติตามกติกาของรายการ</span></span>
        </label>
        <button disabled={submitting || !applicationOpen || !form.pdpaConsent || !form.codeOfConductConsent || form.officialRoles.length === 0} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#156143] px-5 font-bold text-white disabled:opacity-45">{submitting?'กำลังส่งใบสมัคร…':'ส่งใบสมัครกรรมการ (ไม่มีค่าธรรมเนียม)'}</button>
      </form>
    </main>
  );
};
