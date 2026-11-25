import React from 'react';
import { Camera, Upload } from 'lucide-react';

export interface AthleteRegistrationValues {
  firstName: string;
  lastName: string;
  nickname: string;
  gender: 'M' | 'F';
  birthDate: string;
  nationality: string;
  idDocumentNo: string;
  phone: string;
  email: string;
  club: string;
  province: string;
  shirtSize: string;
  address: string;
  emergencyContact: string;
  healthInfo: string;
  photoUrl: string;
  pdpaConsent: boolean;
}

interface Props {
  athleteNumber: 1 | 2;
  values: AthleteRegistrationValues;
  pdpaText: string;
  onChange: <K extends keyof AthleteRegistrationValues>(field: K, value: AthleteRegistrationValues[K]) => void;
  onPhotoChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  compact?: boolean;
}

const inputClass = 'w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]';

export const AthleteRegistrationFields: React.FC<Props> = ({
  athleteNumber,
  values,
  pdpaText,
  onChange,
  onPhotoChange,
  compact = false,
}) => (
  <div className={`${compact ? 'p-3 rounded-lg' : 'p-4 rounded-2xl'} bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] space-y-3`}>
    <div className="font-bold text-[#141D2B] dark:text-[#F3F5F8]">
      ข้อมูลนักกีฬาคนที่ {athleteNumber} {athleteNumber === 2 ? '(คู่หู) ' : ''}*
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <label className="font-medium">ชื่อจริง *<input required value={values.firstName} onChange={(e) => onChange('firstName', e.target.value)} className={`mt-1 ${inputClass}`} /></label>
      <label className="font-medium">นามสกุล *<input required value={values.lastName} onChange={(e) => onChange('lastName', e.target.value)} className={`mt-1 ${inputClass}`} /></label>
      <label className="font-medium">ชื่อเล่น<input value={values.nickname} onChange={(e) => onChange('nickname', e.target.value)} className={`mt-1 ${inputClass}`} /></label>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <label className="font-medium">เพศ *<select required value={values.gender} onChange={(e) => onChange('gender', e.target.value as 'M' | 'F')} className={`mt-1 ${inputClass}`}><option value="M">ชาย</option><option value="F">หญิง</option></select></label>
      <label className="font-medium">วันเกิด *<input required type="date" value={values.birthDate} onChange={(e) => onChange('birthDate', e.target.value)} className={`mt-1 ${inputClass}`} /></label>
      <label className="font-medium">สัญชาติ *<input required value={values.nationality} onChange={(e) => onChange('nationality', e.target.value)} className={`mt-1 ${inputClass}`} /></label>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <label className="font-medium">เบอร์โทร *<input required inputMode="tel" value={values.phone} onChange={(e) => onChange('phone', e.target.value)} className={`mt-1 ${inputClass}`} /></label>
      <label className="font-medium">อีเมล<input type="email" value={values.email} onChange={(e) => onChange('email', e.target.value)} className={`mt-1 ${inputClass}`} /></label>
      <label className="font-medium">เลขบัตร/หนังสือเดินทาง<input value={values.idDocumentNo} onChange={(e) => onChange('idDocumentNo', e.target.value)} className={`mt-1 ${inputClass}`} /></label>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <label className="font-medium">สโมสร / สังกัด<input value={values.club} onChange={(e) => onChange('club', e.target.value)} placeholder="อิสระ" className={`mt-1 ${inputClass}`} /></label>
      <label className="font-medium">จังหวัด<input value={values.province} onChange={(e) => onChange('province', e.target.value)} className={`mt-1 ${inputClass}`} /></label>
      <label className="font-medium">ขนาดเสื้อ<select value={values.shirtSize} onChange={(e) => onChange('shirtSize', e.target.value)} className={`mt-1 ${inputClass}`}>{['XS', 'S', 'M', 'L', 'XL', '2XL'].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <label className="font-medium">ที่อยู่ติดต่อ *<textarea required rows={2} value={values.address} onChange={(e) => onChange('address', e.target.value)} className="mt-1 w-full p-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" /></label>
      <label className="font-medium">ผู้ติดต่อฉุกเฉิน (ชื่อ/เบอร์โทร) *<textarea required rows={2} value={values.emergencyContact} onChange={(e) => onChange('emergencyContact', e.target.value)} className="mt-1 w-full p-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" /></label>
    </div>

    <label className="block font-medium">ข้อมูลสุขภาพ/โรคประจำตัว (ถ้ามี)<input value={values.healthInfo} onChange={(e) => onChange('healthInfo', e.target.value)} placeholder="ระบุเฉพาะเมื่อจำเป็นเพื่อความปลอดภัยในสนาม" className={`mt-1 ${inputClass}`} /></label>

    <div className="flex items-center gap-3 pt-1">
      {values.photoUrl ? <img src={values.photoUrl} alt={`รูปนักกีฬาคนที่ ${athleteNumber}`} className="w-12 h-12 rounded-lg object-cover border border-[#E2DFD5] dark:border-[#25354C]" /> : <div className="w-12 h-12 rounded-lg border border-dashed border-[#C9C4B5] flex items-center justify-center text-[#525C6B]"><Camera className="w-5 h-5" /></div>}
      <label className="min-h-[40px] px-3 rounded-lg border border-dashed border-[#156143] text-[#156143] dark:text-[#4ADE80] font-semibold inline-flex items-center gap-1.5 cursor-pointer">
        <Upload className="w-3.5 h-3.5" />
        <span>{values.photoUrl ? `เปลี่ยนรูปนักกีฬาคนที่ ${athleteNumber}` : `อัปโหลดรูปนักกีฬาคนที่ ${athleteNumber} *`}</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={onPhotoChange} />
      </label>
    </div>

    <label className="flex items-start gap-2.5 rounded-xl border border-[#BBDCCF] bg-[#F1FAF6] p-3 dark:border-[#24533F] dark:bg-[#10291E] cursor-pointer">
      <input required type="checkbox" checked={values.pdpaConsent} onChange={(e) => onChange('pdpaConsent', e.target.checked)} className="mt-0.5" />
      <span><strong className="block">ความยินยอม PDPA ของนักกีฬาคนที่ {athleteNumber} *</strong><span className="mt-1 block text-[11px] leading-5 text-[#526071] dark:text-[#B9C4D3]">{pdpaText}</span></span>
    </label>
  </div>
);
