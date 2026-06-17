import { nextTick, ref, watch } from 'vue'

const storageKey = 'livematch.language'

export const language = ref(localStorage.getItem(storageKey) || 'th')

export function setLanguage(nextLanguage) {
  language.value = nextLanguage === 'en' ? 'en' : 'th'
  localStorage.setItem(storageKey, language.value)
  document.documentElement.lang = language.value
}

export function toggleLanguage() {
  setLanguage(language.value === 'th' ? 'en' : 'th')
}

export function isEnglish() {
  return language.value === 'en'
}

export function t(th, en) {
  return isEnglish() ? en : th
}

export function levelText(level) {
  const labels = {
    light: { th: 'เบา', en: 'Light' },
    middle: { th: 'กลาง', en: 'Medium' },
    heavy: { th: 'หนัก', en: 'Heavy' }
  }
  return labels[level]?.[language.value] || level
}

const phrases = [
  ['หน้าแรก', 'Home'],
  ['แดชบอร์ด', 'Dashboard'],
  ['สมาชิก', 'Players'],
  ['จัดคู่', 'Pairing'],
  ['รอคิว', 'Queue'],
  ['แข่งอยู่', 'Live board'],
  ['ประวัติ', 'History'],
  ['ตั้งค่า', 'Settings'],
  ['ออกจากระบบ', 'Sign out'],
  ['Light mode', 'Light mode'],
  ['Dark mode', 'Dark mode'],
  ['Admin only', 'Admin only'],
  ['Admin access', 'Admin access'],
  ['จัด session แบดให้ลื่นขึ้น', 'Run badminton sessions smoothly'],
  ['เข้า dashboard เพื่อจัดสมาชิก สุ่มคู่ คุมสนามที่กำลังเล่น และดูค่าใช้จ่ายรายคนในที่เดียว', 'Open the dashboard to manage players, randomize pairs, control live courts, and review per-player costs.'],
  ['ยังไม่แสดงข้อมูลก่อนเข้าใช้งาน', 'Data stays hidden before access'],
  ['ผู้เล่นและข้อมูลสนามจะถูกซ่อนไว้จนกว่า admin จะกรอก passcode ถูกต้อง', 'Players and court data stay hidden until the admin passcode is correct.'],
  ['พร้อมใช้กับมือถือหน้างาน', 'Ready for mobile court-side use'],
  ['ปุ่มใหญ่ อ่านง่าย เหมาะกับการเปิดข้างสนามระหว่างจัดเกม', 'Large, readable controls for managing games beside the court.'],
  ['เข้าสู่ระบบผู้ดูแล', 'Admin sign in'],
  ['กรอก admin passcode ของ session', 'Enter the session admin passcode'],
  ['กรอก passcode', 'Enter passcode'],
  ['เข้า dashboard', 'Open dashboard'],
  ['สร้าง session ใหม่', 'Create new session'],
  ['ระบบจะสร้าง passcode สำหรับ admin', 'The system will generate an admin passcode'],
  ['สร้างแล้ว ใช้ passcode นี้เพื่อเข้า dashboard', 'Created. Use this passcode to open the dashboard'],
  ['สร้าง', 'Create'],
  ['ภาพรวมวันนี้', 'Today overview'],
  ['อัปเดตจากสมาชิก คิว สนามที่กำลังเล่น และประวัติการแข่งขัน', 'Updated from players, queue, live courts, and match history'],
  ['ผู้เล่นวันนี้', 'Players today'],
  ['คนที่เปิดใช้งานใน session', 'Active players in this session'],
  ['เกมทั้งหมด', 'Total games'],
  ['กำลังเล่น', 'Playing'],
  ['จบแล้ว', 'Finished'],
  ['เฉลี่ยเกมต่อคน', 'Average games per player'],
  ['ต่ำสุด', 'Min'],
  ['สูงสุด', 'Max'],
  ['ลูกแบดใช้จริง', 'Shuttles used'],
  ['ลูกแบดรวม', 'Total shuttle touches'],
  ['การเงิน', 'Finance'],
  ['รับแล้ว', 'Collected'],
  ['รายรับรวม', 'Total revenue'],
  ['ค้างชำระ', 'Unpaid'],
  ['คนค้างจ่าย', 'players unpaid'],
  ['สถานะสนาม', 'Court status'],
  ['เกมกำลังเล่น', 'live games'],
  ['รอลง', 'Queued'],
  ['สนาม', 'Court'],
  ['ผู้ชนะมากสุด', 'Top winners'],
  ['แพ้', 'Losses'],
  ['เสมอ', 'Draw'],
  ['แต้ม', 'Points'],
  ['เล่น', 'Played'],
  ['ชนะ', 'Wins'],
  ['ลงเล่นมากสุด', 'Most played'],
  ['ควรได้ลงรอบถัดไป', 'Should play next'],
  ['ระดับ', 'Level'],
  ['เพิ่มสมาชิก', 'Add player'],
  ['ชื่อสมาชิกใหม่', 'New player name'],
  ['ค้นหาชื่อหรือเลขสมาชิก', 'Search name or player number'],
  ['แชร์รายชื่อ', 'Share players'],
  ['แสดงสถานะจ่ายเงินในหน้าที่แชร์', 'Show payment status on shared page'],
  ['เลข', 'ID'],
  ['ชื่อ', 'Name'],
  ['เกม', 'Games'],
  ['ลูก', 'Shuttles'],
  ['ค่าใช้จ่าย', 'Cost'],
  ['สถานะ', 'Status'],
  ['จ่ายแล้ว', 'Paid'],
  ['ยังไม่ได้จ่าย', 'Unpaid'],
  ['ค้างจ่าย', 'Unpaid'],
  ['ทั้งหมด', 'All'],
  ['ก่อนหน้า', 'Previous'],
  ['ถัดไป', 'Next'],
  ['หน้า', 'Page'],
  ['จับคู่', 'Pair'],
  ['คูปองระดับมือ', 'Skill coupon'],
  ['คูปองระดับมือ / สิทธิ์สุ่ม', 'Skill coupon / random eligibility'],
  ['สิทธิ์สุ่ม', 'Random eligibility'],
  ['ยังไม่พร้อม', 'Not ready'],
  ['ไม่พบสมาชิกว่างให้เลือก', 'No available players to select'],
  ['เลือกสมาชิกคนที่ 1', 'Select player 1'],
  ['เลือกสมาชิกคนที่ 2', 'Select player 2'],
  ['ไม่พบสมาชิก', 'No players found'],
  ['สร้างคู่', 'Create pair'],
  ['ลบคู่', 'Remove pair'],
  ['ยังไม่มีคู่จับ', 'No pairs yet'],
  ['ยกเลิกการจับคู่', 'Cancel pairing'],
  ['เกมที่', 'Game'],
  ['เลือกสนาม', 'Select court'],
  ['สนามเต็ม', 'Courts full'],
  ['เริ่ม', 'Start'],
  ['ต้องเลือกสนามก่อนเริ่มการแข่งขัน', 'Select a court before starting the match'],
  ['ผู้เล่นว่างที่พร้อมสุ่มไม่พอสำหรับจัดคู่', 'Not enough ready available players to pair'],
  ['ลูกแบด', 'Shuttles'],
  ['ยืนยันเพิ่มลูกแบด', 'Confirm shuttle add'],
  ['จะได้รับเลขลูกแบดถัดไป', 'will receive the next shuttle number'],
  ['กลับ', 'Back'],
  ['เพิ่มลูกแบด', 'Add shuttle'],
  ['จบ', 'Finish'],
  ['ยกเลิก', 'Cancel'],
  ['จบการแข่งขัน', 'Finish match'],
  ['เลือกทีมที่ชนะสำหรับเกมที่', 'Choose the winning team for game'],
  ['เลือกผลการแข่งขันสำหรับเกมที่', 'Choose the match result for game'],
  ['ไม่ระบุ', 'Not specified'],
  ['หมายเหตุหลังจบเกม', 'Post-match note'],
  ['บันทึกผล', 'Save result'],
  ['ยกเลิกการแข่งขัน', 'Cancel match'],
  ['บันทึกหมายเหตุสำหรับเกมที่', 'Save a note for game'],
  ['บันทึกยกเลิก', 'Save cancellation'],
  ['ทีม A', 'Team A'],
  ['ทีม B', 'Team B'],
  ['เริ่ม', 'Start'],
  ['จบ', 'End'],
  ['ผู้ชนะ', 'Winner'],
  ['ผลการแข่งขัน', 'Result'],
  ['ค่าเข้าสนามต่อคน', 'Entry fee per player'],
  ['ค่าลูกแบด', 'Shuttle fee'],
  ['จับคู่ข้ามระดับมือ', 'Allow cross-level pairing'],
  ['สถานะหลังจบเกม', 'Post-match readiness'],
  ['จบเกมแล้วตั้งผู้เล่นเป็นยังไม่พร้อม และกลับไปแสดงแบบนั้นในหน้าจับคู่', 'After finishing a match, set players to Not ready on the pairing page'],
  ['ลำดับการสุ่ม', 'Random priority'],
  ['ระดับมือก่อน', 'Skill level first'],
  ['เกมน้อยก่อน', 'Fewest games first'],
  ['ชื่อสนาม', 'Court names'],
  ['จำนวนสนาม', 'Court count'],
  ['ชื่อสนามใหม่', 'New court name'],
  ['ระดับมือ', 'Skill levels'],
  ['ระดับมือใหม่', 'New skill level'],
  ['ลบสนาม', 'Remove court'],
  ['ลบระดับมือ', 'Remove skill level'],
  ['ระดับมือนี้ถูกใช้งานแล้ว', 'This skill level is in use'],
  ['สนามนี้ถูกใช้งานแล้ว', 'This court is in use'],
  ['รายชื่อสมาชิกและสรุปค่าใช้จ่าย', 'Player list and cost summary'],
  ['กำลังโหลดข้อมูล', 'Loading data'],
  ['ไม่พบรายชื่อที่ค้นหา', 'No matching players'],
  ['ยังไม่มีสมาชิก', 'No players yet'],
  ['อันดับ', 'Rank'],
  ['ค่าใช้จ่าย', 'Cost'],
  ['สร้างแล้ว', 'Created'],
  ['คัดลอกลิงก์แล้ว', 'Link copied'],
  ['คัดลอกลิงก์สมาชิก', 'Copy member link'],
  ['QR ลิงก์สมาชิก', 'Member link QR'],
  ['คัดลอกคิว', 'Copy queue'],
  ['QR คิว', 'Queue QR'],
  ['QR แสดงคิว', 'Queue QR'],
  ['ยังไม่มีคู่ที่รอยืนยัน', 'No pairings awaiting confirmation'],
  ['เลือกสิทธิ์สุ่มแล้วกด Random เพื่อสร้างคู่ก่อนส่งไปรอคิว', 'Select random eligibility, then press Random to create pairings before sending them to queue'],
  ['ยกเลิกจับคู่', 'Cancel pairing'],
  ['ยืนยัน', 'Confirm'],
  ['เกมที่ยืนยันแล้ว รอเลือกสนามและเริ่มการแข่งขัน', 'Confirmed games waiting for court selection and start'],
  ['ยังไม่มีเกมรอคิว', 'No queued games yet'],
  ['ยืนยันคู่จากหน้าจัดคู่ก่อน แล้วเกมจะมาแสดงที่นี่', 'Confirm pairings from the Pairing page first, then games will appear here'],
  ['QR ลิงก์คิวจัดคู่', 'Pairing queue QR'],
  ['สแกนเพื่อเปิดลิงก์ หรือคัดลอกลิงก์ด้านล่าง', 'Scan to open the link, or copy it below'],
  ['คัดลอกลิงก์', 'Copy link'],
  ['ลำดับคิวลงสนามและเกมที่กำลังแข่ง', 'Court queue and live matches'],
  ['ลำดับคิวรอลงสนาม', 'Waiting queue order'],
  ['ยังไม่มีคิวรอลงสนาม', 'No queued matches yet'],
  ['รอผู้ดูแลจัดคู่หรือเริ่มเกมถัดไป', 'Waiting for the admin to pair or start the next game'],
  ['รอเลือกสนาม', 'Waiting for court selection'],
  ['รอแข่ง', 'Waiting'],
  ['คัดลอกอัตโนมัติไม่ได้ ใช้ลิงก์ด้านล่างได้เลย', 'Could not copy automatically. Use the link below.'],
  ['ไม่พบข้อมูล session นี้', 'Session not found'],
  ['Passcode ไม่ถูกต้อง', 'Incorrect passcode'],
  ['สุ่มจับคู่ไม่สำเร็จ', 'Could not randomize pairs'],
  ['กำลังตรวจสอบ', 'Checking'],
  ['เข้าสู่ Supervisor', 'Open Supervisor'],
  ['รีเฟรช', 'Refresh'],
  ['ดูประวัติ', 'View history'],
  ['ยังไม่มีข้อมูลผู้ชนะ', 'No winner data yet'],
  ['ยังไม่มี session ในระบบ', 'No sessions yet'],
  ['ยังไม่มีประวัติเกมใน session นี้', 'No match history in this session yet'],
  ['จ่ายเงิน', 'Payment'],
  ['ยังไม่จ่าย', 'Unpaid'],
  ['เบา', 'Light'],
  ['กลาง', 'Medium'],
  ['หนัก', 'Heavy'],
  ['สนาม 1', 'Court 1'],
  ['สนาม 2', 'Court 2'],
  ['สนาม 3', 'Court 3'],
  ['สนาม 4', 'Court 4'],
  ['แบดวันอังคาร', 'Tuesday badminton'],
  ['แบดวันนี้', 'Today badminton']
]

const thToEn = new Map(phrases)
const enToTh = new Map(phrases.map(([th, en]) => [en, th]))

function phraseMap() {
  return language.value === 'en' ? thToEn : enToTh
}

function translateString(value) {
  if (!value || !value.trim()) return value
  let next = value
  const exact = phraseMap().get(next.trim())
  if (exact) return value.replace(next.trim(), exact)
  const entries = [...phraseMap().entries()].sort((a, b) => b[0].length - a[0].length)
  for (const [from, to] of entries) {
    next = next.split(from).join(to)
  }
  return next
}

function translateNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const translated = translateString(node.nodeValue)
    if (translated !== node.nodeValue) node.nodeValue = translated
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const tag = node.tagName
  if (tag === 'SCRIPT' || tag === 'STYLE') return
  for (const attribute of ['placeholder', 'title', 'aria-label']) {
    if (node.hasAttribute(attribute)) {
      const value = node.getAttribute(attribute)
      const translated = translateString(value)
      if (translated !== value) node.setAttribute(attribute, translated)
    }
  }
  for (const child of node.childNodes) translateNode(child)
}

export function installDomTranslator(rootGetter) {
  document.documentElement.lang = language.value
  let observer
  const translateRoot = () => {
    const root = rootGetter()
    if (!root) return
    observer?.disconnect()
    translateNode(root)
    observer?.observe(root, { childList: true, subtree: true, characterData: true, attributes: true })
  }
  nextTick(translateRoot)
  observer = new MutationObserver(() => nextTick(translateRoot))
  watch(language, () => {
    document.documentElement.lang = language.value
    nextTick(translateRoot)
  })
  return () => observer?.disconnect()
}
