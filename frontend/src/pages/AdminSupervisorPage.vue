<script setup>
import { computed, ref } from 'vue'
import HeroBackground from '../components/HeroBackground.vue'
import {
  Activity,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Coins,
  CreditCard,
  Database,
  Eye,
  Plus,
  Radio,
  ReceiptText,
  RefreshCw,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
  XCircle
} from '@lucide/vue'

const props = defineProps([
  'auth',
  'forms',
  'ui',
  'money',
  'createSession',
  'openOwnedSession',
  'refreshAdminSupervisor',
  'saveAdminDefaultSettings',
  'addAdminDefaultShuttleBrand',
  'removeAdminDefaultShuttleBrand',
  'addAdminDefaultCourt',
  'removeAdminDefaultCourt',
  'addAdminDefaultLevel',
  'removeAdminDefaultLevel'
])

const sessionPage = ref(1)
const adminDefaultSettingsTab = ref('costs')
const sessionPageSize = 6
const adminDefaultSettingsTabs = [
  { id: 'costs', label: 'ค่าใช้จ่ายและลูกแบด', hint: 'ราคาเริ่มต้น', icon: CreditCard },
  { id: 'courts', label: 'สนาม', hint: 'รายชื่อสนาม', icon: Database },
  { id: 'match', label: 'LiveMatch', hint: 'ระดับมือและเสียง', icon: SlidersHorizontal }
]
const benefits = computed(() => props.auth.benefits || { discountPercent: 0, pricing: {}, subscription: null })
const subscription = computed(() => benefits.value.subscription || null)
const canUseSubscription = computed(() => subscription.value?.status === 'active' && Number(subscription.value?.remaining || 0) > 0)
function priceQuote(type, fallback) {
  const quote = benefits.value.pricing?.[type]
  if (quote) return quote
  if (fallback === null || fallback === undefined) return null
  return { baseCost: Number(fallback), discountPercent: 0, finalCost: Number(fallback) }
}
const liveMatchQuote = computed(() => priceQuote('liveMatch', props.auth.liveMatchSessionCost))
const liveShareQuote = computed(() => priceQuote('liveShare', props.auth.liveShareSessionCost))
const liveMatchCost = computed(() => liveMatchQuote.value?.finalCost ?? null)
const liveShareCost = computed(() => liveShareQuote.value?.finalCost ?? null)
const sessions = computed(() => props.auth.sessions || [])
const canCreateLiveMatch = computed(() => liveMatchCost.value !== null && (canUseSubscription.value || Number(props.auth.user?.coins || 0) >= Number(liveMatchCost.value || 0)))
const canCreateLiveShare = computed(() => liveShareCost.value !== null && (canUseSubscription.value || Number(props.auth.user?.coins || 0) >= Number(liveShareCost.value || 0)))
const createBlockedText = computed(() => {
  if (props.forms.sessionCreateType === 'liveShare' && liveShareCost.value === null) return 'ยังไม่ได้ตั้งราคา liveShare coin'
  if (props.forms.sessionCreateType === 'liveShare' && !canCreateLiveShare.value) return 'coin ไม่พอ'
  if (liveMatchCost.value === null) return 'ยังไม่ได้ตั้งราคา coin'
  if (!canCreateLiveMatch.value) return 'coin ไม่พอ'
  return ''
})
const canCreateSelectedSession = computed(() => props.forms.sessionCreateType === 'liveShare' ? canCreateLiveShare.value : canCreateLiveMatch.value)

const sessionPages = computed(() => Math.max(1, Math.ceil(sessions.value.length / sessionPageSize)))
const pagedSessions = computed(() => {
  const start = (sessionPage.value - 1) * sessionPageSize
  return sessions.value.slice(start, start + sessionPageSize)
})

const totals = computed(() => sessions.value.reduce((sum, session) => ({
  players: sum.players + Number(session.players || 0),
  paidPlayers: sum.paidPlayers + Number(session.paidPlayers || 0),
  unpaidPlayers: sum.unpaidPlayers + Number(session.unpaidPlayers || 0),
  matches: sum.matches + Number(session.matches || 0),
  queueMatches: sum.queueMatches + Number(session.queueMatches || 0),
  liveMatches: sum.liveMatches + Number(session.liveMatches || 0),
  historyMatches: sum.historyMatches + Number(session.historyMatches || 0),
  shuttles: sum.shuttles + Number(session.shuttles || 0),
  revenue: sum.revenue + Number(session.revenue || 0)
}), {
  players: 0,
  paidPlayers: 0,
  unpaidPlayers: 0,
  matches: 0,
  queueMatches: 0,
  liveMatches: 0,
  historyMatches: 0,
  shuttles: 0,
  revenue: 0
}))

const numberValue = (value) => Number(value || 0).toLocaleString('th-TH')
const moneyValue = (value) => props.money ? props.money(value || 0) : `${numberValue(value)} บาท`
const percent = (value, total) => {
  if (!total) return 0
  return Math.min(100, Math.round((Number(value || 0) / Number(total || 0)) * 100))
}
const paymentPercent = computed(() => percent(totals.value.paidPlayers, totals.value.players))
const queuePercent = computed(() => percent(totals.value.queueMatches, Math.max(1, totals.value.matches + totals.value.queueMatches)))
const livePercent = computed(() => percent(totals.value.liveMatches, Math.max(1, totals.value.matches + totals.value.queueMatches)))
const historyPercent = computed(() => percent(totals.value.historyMatches, Math.max(1, totals.value.matches + totals.value.queueMatches)))

const primaryStats = computed(() => [
  { label: 'Coin ที่เหลือ', value: numberValue(props.auth.user?.coins), detail: liveMatchCost.value === null ? 'ยังไม่ได้ตั้งราคา liveMatch' : `liveMatch ${numberValue(liveMatchCost.value)} coin/session`, icon: Coins, tone: 'text-shuttle-700 bg-shuttle-400/20 dark:text-shuttle-300' },
  { label: 'Session ของคุณ', value: numberValue(sessions.value.length), detail: 'session ที่สร้างด้วยบัญชีนี้', icon: Database, tone: 'text-court-600 bg-court-500/10 dark:text-court-300' },
  { label: 'สมาชิกทั้งหมด', value: `${numberValue(totals.value.players)} คน`, detail: `จ่ายแล้ว ${numberValue(totals.value.paidPlayers)} / ค้าง ${numberValue(totals.value.unpaidPlayers)}`, icon: Users, tone: 'text-sky-700 bg-sky-100 dark:text-sky-300 dark:bg-sky-950/40' },
  { label: 'รายรับประเมิน', value: moneyValue(totals.value.revenue), detail: `ลูกแบดรวม ${numberValue(totals.value.shuttles)} ลูก`, icon: CreditCard, tone: 'text-rose-700 bg-rose-100 dark:text-rose-300 dark:bg-rose-950/40' }
])
const visiblePrimaryStats = computed(() => primaryStats.value.filter((stat) => stat.label !== 'Coin ที่เหลือ'))

const detailStats = computed(() => [
  { label: 'เกมจริงทั้งหมด', value: numberValue(totals.value.matches), caption: `จบแล้ว ${numberValue(totals.value.historyMatches)} เกม`, icon: Activity },
  { label: 'รอคิว', value: numberValue(totals.value.queueMatches), caption: `${queuePercent.value}% ของ pipeline`, icon: ReceiptText },
  { label: 'กำลังแข่ง', value: numberValue(totals.value.liveMatches), caption: `${livePercent.value}% ของ pipeline`, icon: BarChart3 },
  { label: 'ประวัติ', value: numberValue(totals.value.historyMatches), caption: `${historyPercent.value}% ของ pipeline`, icon: CheckCircle2 }
])

const changeSessionPage = (nextPage) => {
  sessionPage.value = Math.min(sessionPages.value, Math.max(1, nextPage))
}

const openAdminDefaultSettingsModal = () => {
  adminDefaultSettingsTab.value = 'costs'
  props.ui.showAdminDefaultSettingsModal = true
}

const closeAdminDefaultSettingsModal = () => {
  props.ui.showAdminDefaultSettingsModal = false
}
</script>

<template>
  <section class="mx-auto grid max-w-6xl gap-4">
    <header class="lm-hero-bg grid gap-4 overflow-hidden rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 lg:grid-cols-[1fr_auto] lg:items-center">
      <HeroBackground />
      <div class="min-w-0">
        <div class="inline-flex items-center gap-2 rounded-md bg-court-500/10 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-court-700 dark:text-court-300">
          <ShieldCheck class="h-4 w-4" />
          Admin dashboard
        </div>
        <h1 class="mt-3 truncate text-2xl font-black leading-tight sm:text-3xl">สวัสดี {{ auth.user?.name || auth.user?.email }}</h1>
        <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">ภาพรวม session, รายรับ และสถานะเกมของบัญชี admin นี้</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md border border-stone-200 bg-paper-50 px-4 text-sm font-bold transition hover:bg-paper-100 dark:border-stone-700 dark:bg-stone-800 sm:flex-none" @click="refreshAdminSupervisor">
          <RefreshCw class="h-4 w-4" />
          รีเฟรช
        </button>
        <button class="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md border border-court-200 bg-court-500/10 px-4 text-sm font-black text-court-700 transition hover:bg-court-500/15 dark:border-court-900/60 dark:text-court-300 sm:flex-none" @click="openAdminDefaultSettingsModal">
          <Database class="h-4 w-4" />
          ค่าเริ่มต้น
        </button>
        <button class="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-court-500 px-4 text-sm font-black text-white transition hover:bg-court-600 sm:flex-none" @click="ui.showCreateSessionModal = true">
          <Plus class="h-4 w-4" />
          สร้าง session
        </button>
      </div>
    </header>

    <div v-if="ui.showAdminDefaultSettingsModal" class="fixed inset-0 z-40 grid place-items-end bg-black/40 p-3 sm:place-items-center" role="dialog" aria-modal="true" aria-label="ค่าเริ่มต้น Session ใหม่" @click.self="closeAdminDefaultSettingsModal">
    <section class="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-soft dark:border-stone-700 dark:bg-stone-900">
      <div class="grid shrink-0 gap-3 border-b border-stone-200 p-4 dark:border-stone-700 sm:grid-cols-[1fr_auto] sm:items-start">
        <div>
          <p class="text-sm font-semibold text-court-700 dark:text-court-300">ค่าเริ่มต้น Session ใหม่</p>
          <h2 class="mt-1 text-xl font-black">ตั้งค่าส่วนกลางสำหรับกดสร้าง session</h2>
          <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">ค่านี้ถูก copy ตอนสร้าง session ใหม่เท่านั้น ไม่แก้ session เก่าหรือ session ที่เปิดอยู่</p>
        </div>
        <div class="flex flex-wrap gap-2">
        <button class="grid h-10 w-10 place-items-center rounded-md border border-stone-200 transition hover:bg-paper-100 dark:border-stone-700 dark:hover:bg-stone-800" aria-label="ปิด modal" @click="closeAdminDefaultSettingsModal">
          <X class="h-4 w-4" />
        </button>
        </div>
      </div>

      <nav class="scrollbar-none flex shrink-0 gap-2 overflow-x-auto border-b border-stone-200 bg-paper-50 p-2 dark:border-stone-700 dark:bg-stone-950" aria-label="หมวดค่าเริ่มต้น Session ใหม่">
        <button
          v-for="tab in adminDefaultSettingsTabs"
          :key="tab.id"
          type="button"
          class="flex min-w-44 items-center gap-3 rounded-md px-3 py-2.5 text-left transition"
          :class="adminDefaultSettingsTab === tab.id ? 'bg-white text-court-700 shadow-soft dark:bg-stone-800 dark:text-court-300' : 'text-stone-500 hover:bg-white/70 dark:text-stone-400 dark:hover:bg-stone-800/70'"
          @click="adminDefaultSettingsTab = tab.id"
        >
          <span class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-court-500/10">
            <component :is="tab.icon" class="h-4 w-4" />
          </span>
          <span>
            <span class="block text-sm font-black">{{ tab.label }}</span>
            <span class="block text-xs font-semibold opacity-70">{{ tab.hint }}</span>
          </span>
        </button>
      </nav>

      <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">

      <div v-show="adminDefaultSettingsTab === 'costs'" class="grid gap-3 md:grid-cols-3">
        <label class="grid gap-2 rounded-lg border border-stone-200 bg-paper-50 p-3 text-sm font-bold dark:border-stone-700 dark:bg-stone-800">
          ค่าเข้าสนามคนทั่วไป
          <input v-model.number="auth.defaultSettings.entryFee" type="number" min="0" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" />
        </label>
        <label class="grid gap-2 rounded-lg border border-stone-200 bg-paper-50 p-3 text-sm font-bold dark:border-stone-700 dark:bg-stone-800">
          ค่าเข้าสนามสมาชิกชมรม
          <input v-model.number="auth.defaultSettings.clubEntryFee" type="number" min="0" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" />
        </label>
        <label class="grid gap-2 rounded-lg border border-stone-200 bg-paper-50 p-3 text-sm font-bold dark:border-stone-700 dark:bg-stone-800">
          ค่าสนามต่อชั่วโมง liveShare
          <input v-model.number="auth.defaultSettings.courtFeePerHour" type="number" min="0" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" />
        </label>
      </div>

      <div class="grid gap-4 lg:grid-cols-2" :class="adminDefaultSettingsTab === 'match' ? 'lg:grid-cols-1' : ''">
        <div v-show="adminDefaultSettingsTab === 'costs'" class="grid gap-2 rounded-lg border border-stone-200 p-3 dark:border-stone-700 lg:col-span-2">
          <div>
            <p class="font-black">ยี่ห้อลูกแบด</p>
            <p class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">กำหนดยี่ห้อ ราคา และสถานะที่ใช้กับ Session ใหม่</p>
          </div>
          <div v-for="(brand, index) in auth.defaultSettings.shuttleBrands" :key="brand.id" class="grid gap-2 rounded-md bg-paper-100 p-2 dark:bg-stone-800 sm:grid-cols-[1fr_7rem_auto_auto] sm:items-center">
            <input v-model="brand.name" class="h-10 rounded-md border border-stone-200 bg-white px-3 dark:border-stone-700 dark:bg-stone-900" placeholder="ชื่อยี่ห้อ" />
            <input v-model.number="brand.price" type="number" min="0" class="h-10 rounded-md border border-stone-200 bg-white px-3 dark:border-stone-700 dark:bg-stone-900" placeholder="ราคา" />
            <label class="flex items-center gap-2 text-sm font-bold">
              <input v-model="brand.active" type="checkbox" />
              active
            </label>
            <button class="h-10 rounded-md border border-rose-200 px-3 text-sm font-black text-rose-700 disabled:opacity-40 dark:border-rose-900/60 dark:text-rose-300" :disabled="auth.defaultSettings.shuttleBrands.length <= 1" @click="removeAdminDefaultShuttleBrand(index)">
              ลบ
            </button>
          </div>
          <div class="grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
            <input v-model="forms.adminDefaultNewShuttleBrandName" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" placeholder="เพิ่มยี่ห้อ" />
            <input v-model.number="forms.adminDefaultNewShuttleBrandPrice" type="number" min="0" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" placeholder="ราคา" />
            <button class="h-10 rounded-md bg-stone-900 px-3 text-sm font-black text-white dark:bg-white dark:text-stone-900" @click="addAdminDefaultShuttleBrand">เพิ่ม</button>
          </div>
        </div>

        <div v-show="adminDefaultSettingsTab === 'match'" class="grid gap-2 rounded-lg border border-stone-200 p-3 dark:border-stone-700">
          <div>
            <p class="font-black">คำอ่านตอนเรียกคิว</p>
            <p class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">ใช้เป็นข้อความเริ่มต้นของ Session แบบ LiveMatch</p>
          </div>
          <textarea v-model="auth.defaultSettings.announcementTemplate" rows="5" class="rounded-md border border-stone-200 bg-paper-50 px-3 py-2 text-sm font-semibold dark:border-stone-700 dark:bg-stone-800" placeholder="บุฟเฟ่ต์สนามที่ {court}&#10;{pause}&#10;คุณ{a} คุณ{b} คุณ{c} คุณ{d}"></textarea>
          <p class="text-xs font-semibold text-stone-500 dark:text-stone-400">ตัวแปร: court, pause, a, b, c, d</p>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div v-show="adminDefaultSettingsTab === 'courts'" class="grid gap-2 rounded-lg border border-stone-200 p-3 dark:border-stone-700 lg:col-span-2">
          <div>
            <p class="font-black">ชื่อสนาม</p>
            <p class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">เรียงตามลำดับที่ต้องการให้แสดงตอนเลือกสนาม</p>
          </div>
          <div v-for="(court, index) in auth.defaultSettings.courtNames" :key="index" class="grid grid-cols-[1fr_auto] gap-2">
            <input v-model="auth.defaultSettings.courtNames[index]" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" />
            <button class="h-10 rounded-md border border-rose-200 px-3 text-sm font-black text-rose-700 disabled:opacity-40 dark:border-rose-900/60 dark:text-rose-300" :disabled="auth.defaultSettings.courtNames.length <= 1" @click="removeAdminDefaultCourt(index)">ลบ</button>
          </div>
          <div class="grid grid-cols-[1fr_auto] gap-2">
            <input v-model="forms.adminDefaultNewCourtName" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" placeholder="ชื่อสนามใหม่" />
            <button class="h-10 rounded-md bg-stone-900 px-3 text-sm font-black text-white dark:bg-white dark:text-stone-900" @click="addAdminDefaultCourt">เพิ่มสนาม</button>
          </div>
        </div>

        <div v-show="adminDefaultSettingsTab === 'match'" class="grid gap-2 rounded-lg border border-stone-200 p-3 dark:border-stone-700 lg:col-span-2">
          <div>
            <p class="font-black">ระดับมือ LiveMatch</p>
            <p class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">เรียงจากระดับเบาไปหนักสำหรับใช้จับคู่</p>
          </div>
          <div v-for="(level, index) in auth.defaultSettings.levels" :key="index" class="grid grid-cols-[1fr_auto] gap-2">
            <input v-model="auth.defaultSettings.levels[index]" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" />
            <button class="h-10 rounded-md border border-rose-200 px-3 text-sm font-black text-rose-700 disabled:opacity-40 dark:border-rose-900/60 dark:text-rose-300" :disabled="auth.defaultSettings.levels.length <= 1" @click="removeAdminDefaultLevel(index)">ลบ</button>
          </div>
          <div class="grid grid-cols-[1fr_auto] gap-2">
            <input v-model="forms.adminDefaultNewLevelName" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" placeholder="ระดับใหม่" />
            <button class="h-10 rounded-md bg-stone-900 px-3 text-sm font-black text-white dark:bg-white dark:text-stone-900" @click="addAdminDefaultLevel">เพิ่มระดับ</button>
          </div>
        </div>
      </div>

      </div>

      <div class="flex shrink-0 items-center justify-between gap-3 border-t border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900 sm:p-4">
        <p v-if="forms.adminDefaultSettingsStatus" class="min-w-0 flex-1 truncate text-sm font-black text-court-700 dark:text-court-300">{{ forms.adminDefaultSettingsStatus }}</p>
        <span v-else class="hidden text-xs font-semibold text-stone-500 sm:block">นำไปใช้เมื่อสร้าง Session ใหม่เท่านั้น</span>
        <div class="ml-auto grid grid-cols-2 gap-2">
          <button class="h-11 rounded-md border border-stone-200 px-4 text-sm font-black dark:border-stone-700" @click="closeAdminDefaultSettingsModal">ยกเลิก</button>
          <button class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-court-500 px-4 text-sm font-black text-white transition hover:bg-court-600" @click="saveAdminDefaultSettings">
            <CheckCircle2 class="h-4 w-4" />
            บันทึก
          </button>
        </div>
      </div>
    </section>
    </div>

    <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <article
        v-for="stat in visiblePrimaryStats"
        :key="stat.label"
        class="rounded-lg border border-stone-200 bg-white p-3 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-4"
        :class="stat.icon === CreditCard ? 'col-span-2' : ''"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-xs font-bold text-stone-500 dark:text-stone-400 sm:text-sm">{{ stat.label }}</p>
            <p class="mt-2 truncate text-xl font-black tabular-nums sm:text-3xl">{{ stat.value }}</p>
          </div>
          <span class="grid h-8 w-8 shrink-0 place-items-center rounded-md sm:h-10 sm:w-10" :class="stat.tone">
            <component :is="stat.icon" class="h-4 w-4 sm:h-5 sm:w-5" />
          </span>
        </div>
        <p class="mt-3 text-xs font-semibold text-stone-500 dark:text-stone-400">{{ stat.detail }}</p>
      </article>
    </div>

    <div class="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <section class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-stone-500 dark:text-stone-400">การเงินรวม</p>
            <h2 class="mt-1 text-xl font-black">สมาชิกจ่ายแล้ว {{ paymentPercent }}%</h2>
          </div>
          <CreditCard class="h-6 w-6 text-court-600 dark:text-court-300" />
        </div>
        <div class="mt-4 h-3 overflow-hidden rounded-full bg-paper-100 dark:bg-stone-800">
          <div class="h-full rounded-full bg-court-500 transition-all" :style="{ width: `${paymentPercent}%` }"></div>
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-3">
          <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
            <p class="text-xs font-bold text-stone-500 dark:text-stone-400">รายรับประเมิน</p>
            <p class="mt-1 text-lg font-black tabular-nums">{{ moneyValue(totals.revenue) }}</p>
          </div>
          <div class="rounded-md bg-court-500/10 p-3">
            <p class="text-xs font-bold text-court-700 dark:text-court-300">สมาชิกจ่ายแล้ว</p>
            <p class="mt-1 text-lg font-black tabular-nums">{{ numberValue(totals.paidPlayers) }} คน</p>
          </div>
          <div class="rounded-md bg-amber-100 p-3 dark:bg-amber-950/40">
            <p class="text-xs font-bold text-amber-800 dark:text-amber-300">ยังไม่จ่าย</p>
            <p class="mt-1 text-lg font-black tabular-nums">{{ numberValue(totals.unpaidPlayers) }} คน</p>
          </div>
        </div>
      </section>

      <section class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-stone-500 dark:text-stone-400">สถานะเกม</p>
            <h2 class="mt-1 text-xl font-black">Pipeline การแข่งขัน</h2>
          </div>
          <Activity class="h-6 w-6 text-court-600 dark:text-court-300" />
        </div>
        <div class="mt-4 space-y-3">
          <div>
            <div class="flex justify-between text-sm font-bold"><span>รอคิว</span><span>{{ numberValue(totals.queueMatches) }} เกม</span></div>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-paper-100 dark:bg-stone-800"><div class="h-full rounded-full bg-amber-500" :style="{ width: `${queuePercent}%` }"></div></div>
          </div>
          <div>
            <div class="flex justify-between text-sm font-bold"><span>กำลังแข่ง</span><span>{{ numberValue(totals.liveMatches) }} เกม</span></div>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-paper-100 dark:bg-stone-800"><div class="h-full rounded-full bg-court-500" :style="{ width: `${livePercent}%` }"></div></div>
          </div>
          <div>
            <div class="flex justify-between text-sm font-bold"><span>ประวัติ</span><span>{{ numberValue(totals.historyMatches) }} เกม</span></div>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-paper-100 dark:bg-stone-800"><div class="h-full rounded-full bg-stone-700 dark:bg-stone-300" :style="{ width: `${historyPercent}%` }"></div></div>
          </div>
        </div>
      </section>
    </div>

    <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <article v-for="stat in detailStats" :key="stat.label" class="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900 sm:p-4">
        <div class="flex items-center gap-2 text-stone-500 dark:text-stone-400">
          <component :is="stat.icon" class="h-4 w-4" />
          <p class="text-xs font-bold sm:text-sm">{{ stat.label }}</p>
        </div>
        <p class="mt-2 text-xl font-black tabular-nums sm:text-2xl">{{ stat.value }}</p>
        <p class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">{{ stat.caption }}</p>
      </article>
    </div>

    <div class="grid gap-4">
      <section class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-stone-500 dark:text-stone-400">Session ล่าสุด</p>
            <h2 class="mt-1 font-black">รายละเอียดแยกสนาม</h2>
          </div>
          <span class="rounded-md bg-paper-100 px-3 py-1 text-xs font-black text-stone-600 dark:bg-stone-800 dark:text-stone-300">{{ sessions.length }} รายการ</span>
        </div>

        <div class="mt-4 overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800">
          <div class="hidden grid-cols-[1.2fr_0.65fr_0.8fr_0.65fr_0.75fr_5rem] gap-3 bg-paper-100 px-3 py-2 text-xs font-black text-stone-500 dark:bg-stone-800 dark:text-stone-300 md:grid">
            <span>Session</span><span>สมาชิก</span><span>เกม</span><span>ลูกแบด</span><span class="text-right">รายรับ</span><span class="text-right">เปิด</span>
          </div>
          <div v-for="session in pagedSessions" :key="session.id" class="border-t border-stone-200 p-3 first:border-t-0 dark:border-stone-800 md:grid md:grid-cols-[1.2fr_0.65fr_0.8fr_0.65fr_0.75fr_5rem] md:items-center md:gap-3">
            <div class="min-w-0">
              <p class="truncate font-black">{{ session.name }}</p>
              <p class="mt-1 truncate text-xs font-semibold text-stone-500 dark:text-stone-400">
                <span class="rounded bg-paper-100 px-1.5 py-0.5 font-black dark:bg-stone-800">{{ session.type || 'liveMatch' }}</span>
                · อัปเดต {{ session.updatedAt || '-' }}
              </p>
            </div>
            <div class="mt-3 grid grid-cols-2 gap-2 text-sm md:mt-0 md:block">
              <p class="font-black tabular-nums">{{ numberValue(session.players) }} คน</p>
              <p class="flex items-center gap-1 text-xs font-bold text-stone-500 dark:text-stone-400">
                <CheckCircle2 class="h-3.5 w-3.5 text-court-600" />{{ numberValue(session.paidPlayers) }}
                <XCircle class="ml-1 h-3.5 w-3.5 text-amber-600" />{{ numberValue(session.unpaidPlayers) }}
              </p>
            </div>
            <div class="mt-3 grid grid-cols-3 gap-2 text-xs font-bold md:mt-0">
              <span class="rounded-md bg-amber-100 px-2 py-1 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">รอ {{ numberValue(session.queueMatches) }}</span>
              <span class="rounded-md bg-court-500/10 px-2 py-1 text-court-700 dark:text-court-300">แข่ง {{ numberValue(session.liveMatches) }}</span>
              <span class="rounded-md bg-paper-100 px-2 py-1 text-stone-600 dark:bg-stone-800 dark:text-stone-300">จบ {{ numberValue(session.historyMatches) }}</span>
            </div>
            <p class="mt-3 font-black tabular-nums md:mt-0">{{ numberValue(session.shuttles) }} ลูก</p>
            <p class="mt-3 text-right text-lg font-black tabular-nums md:mt-0">{{ moneyValue(session.revenue) }}</p>
            <button class="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-stone-200 bg-white px-3 text-sm font-black transition hover:bg-paper-100 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800 md:mt-0" @click="openOwnedSession(session.id)">
              <Eye class="h-4 w-4" />
              เปิด
            </button>
          </div>
          <p v-if="!sessions.length" class="p-4 text-sm font-semibold text-stone-500 dark:text-stone-400">ยังไม่มี session</p>
        </div>

        <div v-if="sessions.length" class="mt-3 flex items-center justify-between gap-3">
          <button class="inline-flex h-10 items-center gap-2 rounded-md border border-stone-200 px-3 text-sm font-bold disabled:opacity-40 dark:border-stone-700" :disabled="sessionPage <= 1" @click="changeSessionPage(sessionPage - 1)">
            <ChevronLeft class="h-4 w-4" />
            ก่อนหน้า
          </button>
          <span class="text-sm font-black">หน้า {{ sessionPage }} / {{ sessionPages }}</span>
          <button class="inline-flex h-10 items-center gap-2 rounded-md border border-stone-200 px-3 text-sm font-bold disabled:opacity-40 dark:border-stone-700" :disabled="sessionPage >= sessionPages" @click="changeSessionPage(sessionPage + 1)">
            ถัดไป
            <ChevronRight class="h-4 w-4" />
          </button>
        </div>
      </section>
    </div>

    <div v-if="ui.showCreateSessionModal" class="fixed inset-0 z-40 grid place-items-end bg-black/40 p-3 sm:place-items-center">
      <div class="w-full max-w-lg rounded-lg bg-white p-4 shadow-soft dark:bg-stone-900">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-black">สร้าง session</h2>
            <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">เลือกประเภท session ที่ต้องการสร้าง</p>
          </div>
          <button class="grid h-9 w-9 place-items-center rounded-md border border-stone-200 dark:border-stone-700" aria-label="ปิด modal" @click="ui.showCreateSessionModal = false">
            <X class="h-4 w-4" />
          </button>
        </div>

        <input v-model="forms.sessionCreateName" class="mt-4 h-11 w-full rounded-md border border-stone-200 bg-paper-50 px-3 font-semibold outline-none focus:border-court-500 dark:border-stone-700 dark:bg-stone-800" placeholder="ชื่อ session" />

        <div v-if="subscription" class="mt-3 rounded-md border px-3 py-2 text-sm" :class="canUseSubscription ? 'border-court-500 bg-court-500/10 text-court-700 dark:text-court-300' : 'border-stone-200 bg-paper-100 text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300'">
          <p class="font-black">
            {{ canUseSubscription ? `สิทธิ์รายเดือนเหลือ ${subscription.remaining}/${subscription.totalSessions} Session` : subscription.status === 'upcoming' ? 'แพ็กเกจยังไม่ถึงวันเริ่ม' : 'แพ็กเกจไม่มีสิทธิ์คงเหลือ' }}
          </p>
          <p class="mt-0.5 text-xs font-semibold">{{ subscription.startDate }} – {{ subscription.endDate }} · ระบบใช้สิทธิ์ก่อน Coin อัตโนมัติ</p>
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <button type="button" class="rounded-md border p-4 text-left transition" :class="forms.sessionCreateType === 'liveMatch' ? 'border-court-500 bg-court-500/10 ring-2 ring-court-500/20' : 'border-stone-200 bg-paper-100 hover:bg-paper-50 dark:border-stone-700 dark:bg-stone-800 dark:hover:bg-stone-700'" @click="forms.sessionCreateType = 'liveMatch'">
            <Radio class="h-6 w-6 text-court-600 dark:text-court-300" />
            <p class="mt-3 text-lg font-black">liveMatch</p>
            <p class="mt-1 text-xs font-black text-court-700 dark:text-court-300">ใช้งานได้ 3 วันนับจากเวลาสร้าง session</p>
            <template v-if="liveMatchQuote">
              <div v-if="liveMatchQuote.discountPercent > 0" class="mt-2 flex flex-wrap items-center gap-2 text-xs font-black">
                <span class="text-stone-400 line-through">{{ liveMatchQuote.baseCost }} coin</span>
                <span class="rounded bg-coral-100 px-2 py-0.5 text-coral-500">ลด {{ liveMatchQuote.discountPercent }}%</span>
              </div>
              <p class="mt-1 text-sm font-black text-stone-700 dark:text-stone-200">{{ liveMatchQuote.finalCost }} coin <span v-if="canUseSubscription" class="font-semibold text-stone-500">หลังสิทธิ์หมด</span></p>
              <p v-if="canUseSubscription" class="mt-1 text-xs font-black text-court-700 dark:text-court-300">ครั้งนี้ใช้สิทธิ์รายเดือน</p>
            </template>
            <p v-else class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">ยังไม่ได้ตั้งราคา coin</p>
            <p v-if="forms.sessionCreateType === 'liveMatch' && createBlockedText" class="mt-2 text-xs font-black text-red-700 dark:text-red-300">{{ createBlockedText }}</p>
          </button>

          <button type="button" class="rounded-md border p-4 text-left transition" :class="forms.sessionCreateType === 'liveShare' ? 'border-shuttle-500 bg-shuttle-400/15 ring-2 ring-shuttle-500/20' : 'border-stone-200 bg-paper-100 hover:bg-paper-50 dark:border-stone-700 dark:bg-stone-800 dark:hover:bg-stone-700'" @click="forms.sessionCreateType = 'liveShare'">
            <Share2 class="h-6 w-6 text-stone-500" />
            <p class="mt-3 text-lg font-black">liveShare</p>
            <p class="mt-1 text-xs font-black text-court-700 dark:text-court-300">คิดค่าสนามและลูกแบดตามชั่วโมงเล่น</p>
            <template v-if="liveShareQuote">
              <div v-if="liveShareQuote.discountPercent > 0" class="mt-2 flex flex-wrap items-center gap-2 text-xs font-black">
                <span class="text-stone-400 line-through">{{ liveShareQuote.baseCost }} coin</span>
                <span class="rounded bg-coral-100 px-2 py-0.5 text-coral-500">ลด {{ liveShareQuote.discountPercent }}%</span>
              </div>
              <p class="mt-1 text-sm font-black text-stone-700 dark:text-stone-200">{{ liveShareQuote.finalCost }} coin <span v-if="canUseSubscription" class="font-semibold text-stone-500">หลังสิทธิ์หมด</span></p>
              <p v-if="canUseSubscription" class="mt-1 text-xs font-black text-court-700 dark:text-court-300">ครั้งนี้ใช้สิทธิ์รายเดือน</p>
            </template>
            <p v-else class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">ยังไม่ได้ตั้งราคา coin</p>
          </button>
        </div>

        <div class="mt-4 grid grid-cols-[1fr_auto] gap-2">
          <button type="button" class="h-11 rounded-md border border-stone-200 px-4 font-bold dark:border-stone-700" @click="ui.showCreateSessionModal = false">ยกเลิก</button>
          <button type="button" class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-court-500 px-5 font-black text-white transition hover:bg-court-600 disabled:opacity-50" :disabled="!canCreateSelectedSession" @click="createSession">
            <Plus class="h-4 w-4" />
            สร้าง
          </button>
        </div>
        <p v-if="createBlockedText" class="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{{ createBlockedText }}</p>
      </div>
    </div>
  </section>
</template>
