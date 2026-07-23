import { language } from './i18n'

export const statusDefinitions = Object.freeze({
  hold: { th: 'กำลังจอง', en: 'Booking in progress', tone: 'hold', order: 10 },
  pending_review: { th: 'รอตรวจสอบ', en: 'Pending review', tone: 'pending', order: 20 },
  confirmed: { th: 'จองแล้ว', en: 'Confirmed', tone: 'confirmed', order: 30 },
  rejected: { th: 'ไม่อนุมัติ', en: 'Rejected', tone: 'rejected', order: 40 },
  cancelled: { th: 'ยกเลิก', en: 'Cancelled', tone: 'neutral', order: 50 },
  expired: { th: 'หมดเวลา', en: 'Expired', tone: 'neutral', order: 60 },
  unpaid: { th: 'ยังไม่ชำระ', en: 'Unpaid', tone: 'neutral', order: 10 },
  pending: { th: 'รอตรวจสอบ', en: 'Pending', tone: 'pending', order: 20 },
  paid: { th: 'ชำระแล้ว', en: 'Paid', tone: 'confirmed', order: 30 },
  approved: { th: 'อนุมัติแล้ว', en: 'Approved', tone: 'confirmed', order: 30 },
  manual_paid: { th: 'บันทึกชำระโดยผู้ดูแล', en: 'Marked paid by admin', tone: 'confirmed', order: 30 },
  finished: { th: 'จบการแข่งขัน', en: 'Finished', tone: 'confirmed', order: 30 },
})

const unknown = { th: 'ไม่ทราบสถานะ', en: 'Unknown status', tone: 'neutral', order: 999 }

export function statusDefinition(status) {
  return statusDefinitions[String(status || '').toLowerCase()] || unknown
}

export function statusText(status) {
  return statusDefinition(status)[language.value === 'en' ? 'en' : 'th']
}

export function statusTone(status) {
  return statusDefinition(status).tone
}
