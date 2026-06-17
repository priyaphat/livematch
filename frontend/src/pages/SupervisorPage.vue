<script setup>
import { computed, reactive, ref } from 'vue'
import {
  Activity,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  Database,
  Eye,
  Lock,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Trophy,
  Users,
  X,
  XCircle
} from '@lucide/vue'

const props = defineProps(['forms', 'supervisor', 'loginSupervisor', 'money'])

const apiUrl = import.meta.env.VITE_API_URL || ''
const sessionPage = ref(1)
const sessionPageSize = 5
const detail = reactive({
  open: false,
  loading: false,
  error: '',
  data: null
})

const summary = computed(() => props.forms.supervisorSummary || {})
const sessions = computed(() => summary.value.sessions || [])
const topWinners = computed(() => summary.value.topWinners || [])
const sessionPages = computed(() => Math.max(1, Math.ceil(sessions.value.length / sessionPageSize)))
const pagedSessions = computed(() => {
  const start = (sessionPage.value - 1) * sessionPageSize
  return sessions.value.slice(start, start + sessionPageSize)
})

const numberValue = (value) => Number(value || 0).toLocaleString('th-TH')
const moneyValue = (value) => props.money ? props.money(value || 0) : `${numberValue(value)} บาท`
const percent = (value, total) => {
  if (!total) return 0
  return Math.min(100, Math.round((Number(value || 0) / Number(total || 0)) * 100))
}
const paymentPercent = computed(() => percent(summary.value.paidRevenue, summary.value.totalRevenue))
const queuePercent = computed(() => percent(summary.value.queueMatches, summary.value.totalMatches))
const livePercent = computed(() => percent(summary.value.liveMatches, summary.value.totalMatches))
const historyPercent = computed(() => percent(summary.value.historyMatches, summary.value.totalMatches))
const revenuePerPlayer = computed(() => summary.value.totalPlayers ? Math.round(Number(summary.value.totalRevenue || 0) / Number(summary.value.totalPlayers)) : 0)

const primaryStats = computed(() => [
  { label: 'Session ทั้งหมด', value: numberValue(summary.value.totalSessions), detail: 'สนามที่สร้างไว้', icon: Database, tone: 'text-court-600 bg-court-500/10 dark:text-court-300' },
  { label: 'สมาชิกใช้งาน', value: numberValue(summary.value.totalPlayers), detail: `เฉลี่ย ${Number(summary.value.averageGames || 0).toFixed(2)} เกม/คน`, icon: Users, tone: 'text-sky-700 bg-sky-100 dark:text-sky-300 dark:bg-sky-950/40' },
  { label: 'เกมทั้งหมด', value: numberValue(summary.value.totalMatches), detail: `จบแล้ว ${numberValue(summary.value.historyMatches)} เกม`, icon: Activity, tone: 'text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-950/40' },
  { label: 'รายรับประเมิน', value: moneyValue(summary.value.totalRevenue), detail: `เฉลี่ย ${moneyValue(revenuePerPlayer.value)}/คน`, icon: CreditCard, tone: 'text-rose-700 bg-rose-100 dark:text-rose-300 dark:bg-rose-950/40' }
])
const detailStats = computed(() => [
  { label: 'ลูกแบดรวม', value: numberValue(summary.value.totalShuttles), caption: 'นับจากทุกแมตช์', icon: BarChart3 },
  { label: 'คะแนนชนะรวม', value: numberValue(summary.value.totalWins), caption: 'รวมจากสมาชิก active', icon: Trophy },
  { label: 'รอจัดลงสนาม', value: numberValue(summary.value.queueMatches), caption: `${queuePercent.value}% ของเกมทั้งหมด`, icon: Clock3 },
  { label: 'กำลังแข่ง', value: numberValue(summary.value.liveMatches), caption: `${livePercent.value}% ของเกมทั้งหมด`, icon: Activity }
])

const rankClass = (index) => {
  if (index === 0) return 'bg-shuttle-400 text-stone-950 shadow-[0_8px_22px_rgba(245,197,66,0.35)]'
  if (index === 1) return 'bg-stone-300 text-stone-900'
  if (index === 2) return 'bg-amber-700 text-white'
  return 'bg-paper-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200'
}
const winnerText = (match) => ({ A: 'ทีม A ชนะ', B: 'ทีม B ชนะ' }[match.winner] || 'ไม่ระบุผู้ชนะ')
const teamText = (match, side) => side === 'A' ? `${match.a1Name} + ${match.a2Name}` : `${match.b1Name} + ${match.b2Name}`
const paidPlayers = computed(() => detail.data?.players?.filter((player) => player.paid).length || 0)
const unpaidPlayers = computed(() => detail.data?.players?.filter((player) => !player.paid).length || 0)
const detailPaymentPercent = computed(() => detail.data ? percent(detail.data.paidRevenue, detail.data.totalRevenue) : 0)

const refreshSupervisor = () => props.loginSupervisor()
const goHome = () => {
  window.location.href = '/'
}
const changeSessionPage = (nextPage) => {
  sessionPage.value = Math.min(sessionPages.value, Math.max(1, nextPage))
}
async function openSessionDetail(session) {
  detail.open = true
  detail.loading = true
  detail.error = ''
  detail.data = null
  try {
    const response = await fetch(`${apiUrl}/api/supervisor/session-detail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'superadmin',
        password: props.forms.supervisorPassword,
        sessionId: session.id
      })
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'request failed' }))
      throw new Error(error.error || 'request failed')
    }
    detail.data = await response.json()
  } catch {
    detail.error = 'โหลดรายละเอียด session ไม่สำเร็จ'
  } finally {
    detail.loading = false
  }
}
function closeDetail() {
  detail.open = false
  detail.loading = false
  detail.error = ''
  detail.data = null
}
</script>

<template>
  <section class="min-h-screen bg-paper-50 px-4 py-5 text-stone-950 dark:bg-paper-900 dark:text-white">
    <div class="mx-auto grid max-w-6xl gap-4">
      <header class="grid gap-3 rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:grid-cols-[1fr_auto] sm:items-center">
        <div class="min-w-0">
          <div class="inline-flex items-center gap-2 rounded-md bg-court-500/10 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-court-700 dark:text-court-300">
            <ShieldCheck class="h-4 w-4" />
            Supervisor
          </div>
          <h1 class="mt-3 text-2xl font-black leading-tight sm:text-3xl">LiveMatch Superadmin</h1>
          <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">ภาพรวมทุก session สำหรับตรวจรายรับ เกม ผู้เล่น และสถานะสนามแบบละเอียด</p>
        </div>
        <div v-if="supervisor.unlocked" class="flex gap-2">
          <button class="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md border border-stone-200 bg-paper-50 px-4 text-sm font-bold transition hover:bg-paper-100 dark:border-stone-700 dark:bg-stone-800 sm:flex-none" :disabled="supervisor.loading" @click="refreshSupervisor">
            <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': supervisor.loading }" />
            รีเฟรช
          </button>
          <button class="inline-flex h-11 flex-1 items-center justify-center rounded-md bg-stone-900 px-4 text-sm font-bold text-white transition hover:bg-stone-800 dark:bg-white dark:text-stone-900 sm:flex-none" @click="goHome">หน้าแรก</button>
        </div>
      </header>

      <div v-if="!supervisor.unlocked" class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
        <div class="mb-4 rounded-md bg-paper-100 p-3 text-sm font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300">ใช้บัญชี superadmin เพื่อดูข้อมูลรวมทุก session ในระบบ</div>
        <label class="grid gap-2 text-sm font-bold">
          <span>รหัสผ่าน superadmin</span>
          <input v-model="forms.supervisorPassword" type="password" class="h-12 rounded-md border border-stone-200 bg-paper-50 px-3 text-base outline-none transition focus:border-court-500 focus:ring-2 focus:ring-court-500/20 dark:border-stone-700 dark:bg-stone-800" placeholder="12345678" @keyup.enter="loginSupervisor" />
        </label>
        <button class="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-court-500 px-4 font-bold text-white transition hover:bg-court-600 disabled:opacity-60 sm:w-auto" :disabled="supervisor.loading" @click="loginSupervisor">
          <Lock class="h-4 w-4" />
          {{ supervisor.loading ? 'กำลังตรวจสอบ' : 'เข้าสู่ Supervisor' }}
        </button>
        <p v-if="forms.supervisorError" class="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm font-bold text-red-700 dark:bg-red-950/40 dark:text-red-200">{{ forms.supervisorError }}</p>
      </div>

      <template v-else>
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article v-for="stat in primaryStats" :key="stat.label" class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm font-bold text-stone-500 dark:text-stone-400">{{ stat.label }}</p>
                <p class="mt-2 truncate text-2xl font-black tabular-nums sm:text-3xl">{{ stat.value }}</p>
              </div>
              <span class="grid h-10 w-10 shrink-0 place-items-center rounded-md" :class="stat.tone">
                <component :is="stat.icon" class="h-5 w-5" />
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
                <h2 class="mt-1 text-xl font-black">รับแล้ว {{ paymentPercent }}%</h2>
              </div>
              <CreditCard class="h-6 w-6 text-court-600 dark:text-court-300" />
            </div>
            <div class="mt-4 h-3 overflow-hidden rounded-full bg-paper-100 dark:bg-stone-800">
              <div class="h-full rounded-full bg-court-500 transition-all" :style="{ width: `${paymentPercent}%` }"></div>
            </div>
            <div class="mt-4 grid gap-3 sm:grid-cols-3">
              <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
                <p class="text-xs font-bold text-stone-500 dark:text-stone-400">ยอดรวม</p>
                <p class="mt-1 text-lg font-black tabular-nums">{{ moneyValue(summary.totalRevenue) }}</p>
              </div>
              <div class="rounded-md bg-court-500/10 p-3">
                <p class="text-xs font-bold text-court-700 dark:text-court-300">จ่ายแล้ว</p>
                <p class="mt-1 text-lg font-black tabular-nums">{{ moneyValue(summary.paidRevenue) }}</p>
              </div>
              <div class="rounded-md bg-amber-100 p-3 dark:bg-amber-950/40">
                <p class="text-xs font-bold text-amber-800 dark:text-amber-300">ค้างจ่าย</p>
                <p class="mt-1 text-lg font-black tabular-nums">{{ moneyValue(summary.unpaidRevenue) }}</p>
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
                <div class="flex justify-between text-sm font-bold"><span>รอแข่ง</span><span>{{ numberValue(summary.queueMatches) }} เกม</span></div>
                <div class="mt-2 h-2 overflow-hidden rounded-full bg-paper-100 dark:bg-stone-800"><div class="h-full rounded-full bg-amber-500" :style="{ width: `${queuePercent}%` }"></div></div>
              </div>
              <div>
                <div class="flex justify-between text-sm font-bold"><span>กำลังแข่ง</span><span>{{ numberValue(summary.liveMatches) }} เกม</span></div>
                <div class="mt-2 h-2 overflow-hidden rounded-full bg-paper-100 dark:bg-stone-800"><div class="h-full rounded-full bg-court-500" :style="{ width: `${livePercent}%` }"></div></div>
              </div>
              <div>
                <div class="flex justify-between text-sm font-bold"><span>ประวัติ</span><span>{{ numberValue(summary.historyMatches) }} เกม</span></div>
                <div class="mt-2 h-2 overflow-hidden rounded-full bg-paper-100 dark:bg-stone-800"><div class="h-full rounded-full bg-stone-700 dark:bg-stone-300" :style="{ width: `${historyPercent}%` }"></div></div>
              </div>
            </div>
          </section>
        </div>

        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article v-for="stat in detailStats" :key="stat.label" class="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
            <div class="flex items-center gap-2 text-stone-500 dark:text-stone-400">
              <component :is="stat.icon" class="h-4 w-4" />
              <p class="text-sm font-bold">{{ stat.label }}</p>
            </div>
            <p class="mt-2 text-2xl font-black tabular-nums">{{ stat.value }}</p>
            <p class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">{{ stat.caption }}</p>
          </article>
        </div>

        <div class="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <section class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
            <div class="flex items-center gap-2">
              <Trophy class="h-5 w-5 text-shuttle-500" />
              <h2 class="font-black">ผู้ชนะมากสุด 5 อันดับ</h2>
            </div>
            <div class="mt-4 space-y-3">
              <div v-for="(player, index) in topWinners" :key="`${player.sessionId}-${player.id}`" class="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 rounded-md bg-paper-100 p-3 dark:bg-stone-800">
                <span class="grid h-10 w-10 place-items-center rounded-md text-base font-black" :class="rankClass(index)">{{ index + 1 }}</span>
                <div class="min-w-0">
                  <p class="truncate font-black">{{ player.name }}</p>
                  <p class="truncate text-xs font-semibold text-stone-500 dark:text-stone-400">{{ player.sessionName }}</p>
                </div>
                <div class="text-right">
                  <p class="font-black tabular-nums">{{ numberValue(player.wins) }}</p>
                  <p class="text-xs font-bold text-stone-500 dark:text-stone-400">ชนะ</p>
                </div>
              </div>
              <p v-if="!topWinners.length" class="rounded-md bg-paper-100 p-4 text-sm font-semibold text-stone-500 dark:bg-stone-800 dark:text-stone-400">ยังไม่มีข้อมูลผู้ชนะ</p>
            </div>
          </section>

          <section class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-stone-500 dark:text-stone-400">Session ล่าสุด</p>
                <h2 class="mt-1 font-black">รายละเอียดแยกสนาม</h2>
              </div>
              <span class="rounded-md bg-paper-100 px-3 py-1 text-xs font-black text-stone-600 dark:bg-stone-800 dark:text-stone-300">{{ sessions.length }} รายการ</span>
            </div>
            <div class="mt-4 overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800">
              <div class="hidden grid-cols-[1.2fr_0.65fr_0.8fr_0.65fr_0.75fr_6.5rem] gap-3 bg-paper-100 px-3 py-2 text-xs font-black text-stone-500 dark:bg-stone-800 dark:text-stone-300 md:grid">
                <span>Session</span><span>สมาชิก</span><span>เกม</span><span>ลูกแบด</span><span class="text-right">รายรับ</span><span class="text-right">ประวัติ</span>
              </div>
              <div v-for="session in pagedSessions" :key="session.id" class="border-t border-stone-200 p-3 first:border-t-0 dark:border-stone-800 md:grid md:grid-cols-[1.2fr_0.65fr_0.8fr_0.65fr_0.75fr_6.5rem] md:items-center md:gap-3">
                <div class="min-w-0">
                  <p class="truncate font-black">{{ session.name }}</p>
                  <p class="mt-1 truncate text-xs font-semibold text-stone-500 dark:text-stone-400">{{ session.id }} · อัปเดต {{ session.updatedAt || '-' }}</p>
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
                <button class="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-stone-200 bg-white px-3 text-sm font-black transition hover:bg-paper-100 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800 md:mt-0" @click="openSessionDetail(session)">
                  <Eye class="h-4 w-4" />
                  ดูประวัติ
                </button>
              </div>
              <p v-if="!sessions.length" class="p-4 text-sm font-semibold text-stone-500 dark:text-stone-400">ยังไม่มี session ในระบบ</p>
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
      </template>
    </div>

    <div v-if="detail.open" class="fixed inset-0 z-50 grid place-items-end bg-stone-950/55 p-0 sm:place-items-center sm:p-4">
      <section class="max-h-[92vh] w-full overflow-y-auto rounded-t-lg border border-stone-200 bg-paper-50 p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:max-w-4xl sm:rounded-lg">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-black text-court-700 dark:text-court-300">ประวัติ Session</p>
            <h2 class="mt-1 truncate text-xl font-black">{{ detail.data?.sessionName || 'กำลังโหลดข้อมูล' }}</h2>
            <p v-if="detail.data" class="mt-1 truncate text-xs font-semibold text-stone-500 dark:text-stone-400">{{ detail.data.sessionId }}</p>
          </div>
          <button class="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800" @click="closeDetail">
            <X class="h-5 w-5" />
          </button>
        </div>

        <div v-if="detail.loading" class="mt-4 rounded-lg border border-stone-200 bg-white p-4 text-sm font-bold text-stone-500 dark:border-stone-700 dark:bg-stone-800">กำลังโหลดรายละเอียด...</div>
        <div v-else-if="detail.error" class="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{{ detail.error }}</div>

        <template v-else-if="detail.data">
          <div class="mt-4 grid gap-3 sm:grid-cols-4">
            <div class="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800">
              <p class="text-xs font-bold text-stone-500 dark:text-stone-400">รายรับรวม</p>
              <p class="mt-1 text-xl font-black">{{ moneyValue(detail.data.totalRevenue) }}</p>
            </div>
            <div class="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800">
              <p class="text-xs font-bold text-court-700 dark:text-court-300">จ่ายแล้ว</p>
              <p class="mt-1 text-xl font-black">{{ moneyValue(detail.data.paidRevenue) }}</p>
            </div>
            <div class="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800">
              <p class="text-xs font-bold text-amber-700 dark:text-amber-300">ค้างจ่าย</p>
              <p class="mt-1 text-xl font-black">{{ moneyValue(detail.data.unpaidRevenue) }}</p>
            </div>
            <div class="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800">
              <p class="text-xs font-bold text-stone-500 dark:text-stone-400">สมาชิก</p>
              <p class="mt-1 text-xl font-black">{{ paidPlayers }} / {{ unpaidPlayers }}</p>
            </div>
          </div>
          <div class="mt-3 h-3 overflow-hidden rounded-full bg-paper-100 dark:bg-stone-800">
            <div class="h-full rounded-full bg-court-500" :style="{ width: `${detailPaymentPercent}%` }"></div>
          </div>

          <div class="mt-5 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <section class="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800">
              <div class="flex items-center gap-2">
                <ReceiptText class="h-5 w-5 text-court-600 dark:text-court-300" />
                <h3 class="font-black">การจ่ายเงิน</h3>
              </div>
              <div class="mt-3 max-h-[20rem] overflow-y-auto rounded-md border border-stone-200 dark:border-stone-700">
                <div v-for="player in detail.data.players" :key="player.id" class="grid grid-cols-[1fr_auto] gap-2 border-t border-stone-200 p-3 first:border-t-0 dark:border-stone-700">
                  <div class="min-w-0">
                    <p class="truncate font-black">{{ player.id }}. {{ player.name }}</p>
                    <p class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">เกม {{ player.games }} · ลูก {{ player.shuttles }} · ชนะ {{ player.wins }} · แพ้ {{ player.losses }}</p>
                  </div>
                  <div class="text-right">
                    <p class="font-black">{{ moneyValue(player.cost) }}</p>
                    <span class="mt-1 inline-flex rounded-md px-2 py-1 text-xs font-black" :class="player.paid ? 'bg-court-500/10 text-court-700 dark:text-court-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'">
                      {{ player.paid ? 'จ่ายแล้ว' : 'ยังไม่จ่าย' }}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section class="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800">
              <div class="flex items-center gap-2">
                <Clock3 class="h-5 w-5 text-court-600 dark:text-court-300" />
                <h3 class="font-black">ประวัติเกม</h3>
              </div>
              <div class="mt-3 space-y-3">
                <article v-for="match in detail.data.history" :key="match.id" class="rounded-md bg-paper-100 p-3 dark:bg-stone-900">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <p class="text-xs font-bold text-stone-500 dark:text-stone-400">เกมที่ {{ match.id }} · สนาม {{ match.court || '-' }}</p>
                      <p class="mt-1 font-black">{{ teamText(match, 'A') }} vs {{ teamText(match, 'B') }}</p>
                    </div>
                    <span class="rounded-md bg-white px-2 py-1 text-xs font-black text-stone-600 dark:bg-stone-800 dark:text-stone-200">{{ winnerText(match) }}</span>
                  </div>
                  <p class="mt-2 text-xs font-semibold text-stone-500 dark:text-stone-400">ลูก {{ match.shuttles }} · sequence {{ match.shuttleSequence || '-' }} · {{ match.startedAt || '-' }} - {{ match.endedAt || '-' }}</p>
                  <p v-if="match.note" class="mt-2 rounded-md bg-white p-2 text-sm font-semibold dark:bg-stone-800">{{ match.note }}</p>
                </article>
                <p v-if="!detail.data.history.length" class="rounded-md bg-paper-100 p-4 text-sm font-semibold text-stone-500 dark:bg-stone-900 dark:text-stone-400">ยังไม่มีประวัติเกมใน session นี้</p>
              </div>
            </section>
          </div>
        </template>
      </section>
    </div>
  </section>
</template>
