import { DivisionConfig, Tournament } from '../types/tournament';

export interface RegistrationWindowStatus {
  isOpen: boolean;
  reason: string;
}

export function normalizeDateTimeLocal(value?: string): string {
  if (!value) return '';
  return value.trim().replace(' ', 'T').slice(0, 16);
}

export function formatThaiDateTimeRange(openAt?: string, closeAt?: string): string {
  const openStr = normalizeDateTimeLocal(openAt).replace('T', ' ');
  const closeStr = normalizeDateTimeLocal(closeAt).replace('T', ' ');
  if (openStr && closeStr) return `${openStr} – ${closeStr}`;
  if (openStr) return `เปิด ${openStr}`;
  if (closeStr) return `ปิด ${closeStr}`;
  return 'ไม่ได้กำหนดช่วงเวลา';
}

export function formatThaiDateTime(value?: string): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) return `${trimmed} น.`;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return trimmed;
  const dateText = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
  const timeText = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return `${dateText} · ${timeText} น.`;
}

export function getRegistrationWindowStatus(
  tournament: Tournament,
  now: Date = new Date()
): RegistrationWindowStatus {
  const cfg = tournament.registrationConfig;
  if (!cfg.isOpen) {
    return { isOpen: false, reason: 'ผู้จัดปิดรับสมัครออนไลน์ชั่วคราว' };
  }

  if (
    tournament.status === 'ปิดรับสมัคร' ||
    tournament.status === 'ยกเลิก' ||
    tournament.status === 'แข่งขันเสร็จแล้ว' ||
    tournament.status === 'Archived'
  ) {
    return { isOpen: false, reason: `สถานะรายการอยู่ในช่วง "${tournament.status}"` };
  }

  const openNorm = normalizeDateTimeLocal(cfg.openAt);
  if (openNorm) {
    const openDate = new Date(openNorm);
    if (!Number.isNaN(openDate.getTime()) && now < openDate) {
      return {
        isOpen: false,
        reason: `ยังไม่ถึงกำหนดเปิดรับสมัคร (เปิด ${openNorm.replace('T', ' ')})`,
      };
    }
  }

  const closeNorm = normalizeDateTimeLocal(cfg.closeAt);
  if (closeNorm) {
    const closeDate = new Date(closeNorm);
    if (!Number.isNaN(closeDate.getTime()) && now > closeDate) {
      return {
        isOpen: false,
        reason: `ปิดรับสมัครแล้วตั้งแต่ ${closeNorm.replace('T', ' ')}`,
      };
    }
  }

  if (tournament.endDate) {
    const eventEnd = new Date(`${tournament.endDate}T23:59:59`);
    if (!Number.isNaN(eventEnd.getTime()) && now > eventEnd) {
      return {
        isOpen: false,
        reason: `พ้นกำหนดวันจัดงาน (${tournament.endDate}) แล้ว`,
      };
    }
  }

  return { isOpen: true, reason: 'เปิดรับสมัครออนไลน์อยู่' };
}

export function getDivisionFormat(division?: DivisionConfig): 'singles' | 'doubles' {
  if (!division) return 'doubles';
  if (division.formats.includes('singles') && !division.formats.includes('doubles')) {
    return 'singles';
  }
  if (division.playersPerTeam === 1) return 'singles';
  return division.formats[0] === 'singles' ? 'singles' : 'doubles';
}

export const FREE_PARTICIPANTS_LIMIT = 20;
export const EXTRA_PARTICIPANT_COST = 10;

export function calculateParticipantExtraCost(totalParticipants: number): number {
  const safe = Math.max(0, Math.floor(Number(totalParticipants) || 0));
  return Math.max(0, safe - FREE_PARTICIPANTS_LIMIT) * EXTRA_PARTICIPANT_COST;
}

export function calculateExpandParticipantsCost(
  currentMaxParticipants: number,
  addParticipants: number
): number {
  const safeCurrent = Math.max(0, Math.floor(Number(currentMaxParticipants) || 0));
  const safeAdd = Math.max(0, Math.floor(Number(addParticipants) || 0));
  if (safeAdd <= 0) return 0;
  return (
    calculateParticipantExtraCost(safeCurrent + safeAdd) -
    calculateParticipantExtraCost(safeCurrent)
  );
}

export function getDivisionParticipantsCount(division: DivisionConfig): number {
  if (!division.enabled) return 0;
  const fmt = getDivisionFormat(division);
  if (fmt === 'doubles') {
    const q = typeof division.quotaDoubles === 'number' ? Math.max(0, division.quotaDoubles) : 0;
    return q * 2;
  }
  const q = typeof division.quotaSingles === 'number' ? Math.max(0, division.quotaSingles) : 0;
  return q;
}

export function getTournamentAllocatedParticipants(divisions: DivisionConfig[]): number {
  return divisions.reduce((sum, div) => sum + getDivisionParticipantsCount(div), 0);
}

