<script setup>
import { computed, ref } from 'vue'
import { CreditCard, Download, Trophy } from '@lucide/vue'
import { exportHistoryExcel, exportPaymentHistoryExcel } from '../excelExport'

const props = defineProps([
  'state',
  'playerName',
  'matchLevelLabel',
  'shuttleBrandName',
  'matchShuttleSummary',
  'matchShuttleSequenceText',
  'updateHistoryWinner',
  'isSessionReadOnly',
  'apiRequest'
])

const sortedHistory = computed(() => [...props.state.history].sort((a, b) => a.id - b.id))
const activeTab = ref('matches')
const paymentEvents = ref([])
const paymentLoading = ref(false)
const paymentLoaded = ref(false)
const paymentError = ref('')
const exportLoading = ref(false)
const exportError = ref('')
const brandName = (brandId) => props.shuttleBrandName?.(brandId) || props.state.settings?.shuttleBrands?.find((brand) => brand.id === brandId)?.name || 'ลูกแบดทั่วไป'
const shuttleSummary = (match) => props.matchShuttleSummary?.(match) || ''
const shuttleSequenceText = (match) => props.matchShuttleSequenceText?.(match) || match?.shuttleSequence || '-'
const teamText = (match, side) => (side === 'A' ? [match.a1, match.a2] : [match.b1, match.b2]).filter((id) => Number(id) > 0).map((id) => props.playerName(id)).join(' + ')
const formatAmount = (value) => {
  const amount = Number(value || 0)
  const hasSatang = Math.round(amount * 100) % 100 !== 0
  return amount.toLocaleString('th-TH', { minimumFractionDigits: hasSatang ? 2 : 0, maximumFractionDigits: 2 })
}

function winnerText(match) {
  if (!match.winner) return '-'
  if (match.winner === 'draw') return 'เสมอ'
  return teamText(match, match.winner)
}

function resultScoreText(match) {
  if (isCancelled(match)) return 'ยกเลิก'
  if (match.winner === 'A') return 'ทีม A +1 · ทีม B +0'
  if (match.winner === 'B') return 'ทีม A +0 · ทีม B +1'
  if (match.winner === 'draw') return 'ทีม A +0.5 · ทีม B +0.5'
  return '-'
}

function isCancelled(match) {
  return match.status === 'cancelled'
}

async function loadPaymentEvents(force = false) {
  if (paymentLoading.value || (paymentLoaded.value && !force)) return
  paymentLoading.value = true
  paymentError.value = ''
  try {
    const payload = await props.apiRequest(`/api/sessions/${props.state.session.id}/payment-events?all=1`)
    paymentEvents.value = payload?.items || []
    paymentLoaded.value = true
  } catch (error) {
    paymentError.value = error?.message || 'โหลดประวัติการชำระเงินไม่สำเร็จ'
  } finally {
    paymentLoading.value = false
  }
}

function selectTab(tab) {
  activeTab.value = tab
  if (tab === 'payments') void loadPaymentEvents()
}

async function exportExcel() {
  if (exportLoading.value) return
  exportLoading.value = true
  exportError.value = ''
  try {
    if (activeTab.value === 'payments') {
      await loadPaymentEvents(true)
      if (paymentError.value) throw new Error(paymentError.value)
      await exportPaymentHistoryExcel(props, paymentEvents.value)
    } else {
      await exportHistoryExcel(props)
    }
  } catch (error) {
    exportError.value = error?.message || 'สร้างไฟล์ Excel ไม่สำเร็จ'
  } finally {
    exportLoading.value = false
  }
}
</script>

<template>
  <section class="grid gap-3">
    <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900">
      <div>
        <h1 class="font-black">ประวัติ</h1>
        <p class="text-xs font-semibold text-stone-500 dark:text-stone-400">{{ activeTab === 'matches' ? sortedHistory.length : paymentEvents.length }} รายการ</p>
      </div>
      <button
        class="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-court-200 bg-court-500/10 px-4 text-sm font-bold text-court-700 disabled:cursor-wait disabled:opacity-60 dark:border-court-900/60 dark:text-court-300"
        :disabled="exportLoading"
        data-testid="export-history"
        @click="exportExcel"
      >
        <Download class="h-4 w-4" />
        {{ exportLoading ? 'กำลังสร้าง Excel...' : 'Export Excel' }}
      </button>
      <p v-if="exportError" class="w-full text-right text-xs font-bold text-rose-700 dark:text-rose-300">{{ exportError }}</p>
    </div>

    <nav class="grid grid-cols-2 gap-1 rounded-lg border border-stone-200 bg-white p-1 dark:border-stone-700 dark:bg-stone-900" aria-label="ประเภทประวัติ">
      <button
        type="button"
        class="inline-flex h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-black transition"
        :class="activeTab === 'matches' ? 'bg-court-500 text-white' : 'text-stone-500 hover:bg-paper-100 dark:text-stone-300 dark:hover:bg-stone-800'"
        @click="selectTab('matches')"
      >
        <Trophy class="h-4 w-4" />
        ประวัติการแข่งขัน
      </button>
      <button
        type="button"
        class="inline-flex h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-black transition"
        :class="activeTab === 'payments' ? 'bg-court-500 text-white' : 'text-stone-500 hover:bg-paper-100 dark:text-stone-300 dark:hover:bg-stone-800'"
        @click="selectTab('payments')"
      >
        <CreditCard class="h-4 w-4" />
        ประวัติการชำระเงิน
      </button>
    </nav>

    <div v-if="activeTab === 'payments'" class="overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
      <p v-if="paymentLoading" class="p-5 text-center text-sm font-bold text-stone-500">กำลังโหลดประวัติการชำระเงิน...</p>
      <p v-else-if="paymentError" class="p-5 text-center text-sm font-bold text-rose-700 dark:text-rose-300">{{ paymentError }}</p>
      <p v-else-if="!paymentEvents.length" class="p-5 text-center text-sm font-bold text-stone-500">ยังไม่มีประวัติการชำระเงิน</p>
      <div v-else class="divide-y divide-stone-100 dark:divide-stone-800">
        <article v-for="event in paymentEvents" :key="event.id" class="grid gap-2 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-5">
          <div class="min-w-0">
            <p class="truncate font-black">{{ event.playerName }}</p>
            <p class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">{{ event.createdAt }}</p>
          </div>
          <span class="w-fit rounded-md px-2 py-1 text-xs font-black" :class="event.paid ? 'bg-court-500/10 text-court-700 dark:text-court-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'">
            {{ event.paid ? 'ชำระเงิน' : 'ยกเลิกการชำระเงิน' }}
          </span>
          <p class="font-black tabular-nums text-court-700 dark:text-court-300">฿{{ formatAmount(event.amount) }}</p>
        </article>
      </div>
    </div>
    <article
      v-for="match in sortedHistory"
      v-show="activeTab === 'matches'"
      :key="match.id"
      class="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-soft dark:border-stone-700 dark:bg-stone-900"
    >
      <div class="flex items-start justify-between gap-3 border-b border-stone-100 bg-paper-100 p-3 dark:border-stone-800 dark:bg-stone-800">
        <div>
          <p class="text-xs font-bold text-stone-500 dark:text-stone-400">เกมที่</p>
          <h2 class="text-2xl font-black">{{ match.id }}</h2>
          <span
            class="mt-2 inline-flex rounded-md px-2 py-1 text-xs font-black"
            :class="isCancelled(match) ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-court-500/10 text-court-700 dark:text-court-300'"
          >
            {{ isCancelled(match) ? 'สถานะ ยกเลิก' : 'สถานะ บันทึกผล' }}
          </span>
          <span
            v-if="isCancelled(match) && match.shuttleReturned"
            class="ml-2 mt-2 inline-flex rounded-md bg-shuttle-400/20 px-2 py-1 text-xs font-black text-amber-800 dark:text-shuttle-400"
          >
            คืนลูกแล้ว
            <span v-if="match.returnedShuttleNumber"> · {{ brandName(match.returnedShuttleBrandId) }} #{{ match.returnedShuttleNumber }}</span>
          </span>
        </div>
        <div class="text-right">
          <p class="text-xs font-bold text-stone-500 dark:text-stone-400">สนาม</p>
          <p class="font-black">{{ match.court }}</p>
        </div>
      </div>

      <div class="grid gap-3 p-3">
        <div class="grid gap-2 rounded-md border border-stone-100 p-3 dark:border-stone-800">
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm font-bold text-stone-500">ทีม A</span>
            <span v-if="match.winner === 'A'" class="rounded-md bg-court-500/10 px-2 py-1 text-xs font-black text-court-700 dark:text-court-300">ชนะ</span>
            <span v-else-if="match.winner === 'draw'" class="rounded-md bg-shuttle-400/20 px-2 py-1 text-xs font-black text-amber-800 dark:text-shuttle-400">เสมอ</span>
          </div>
          <p class="text-lg font-black">{{ teamText(match, 'A') }}</p>
        </div>

        <div class="grid gap-2 rounded-md border border-stone-100 p-3 dark:border-stone-800">
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm font-bold text-stone-500">ทีม B</span>
            <span v-if="match.winner === 'B'" class="rounded-md bg-court-500/10 px-2 py-1 text-xs font-black text-court-700 dark:text-court-300">ชนะ</span>
            <span v-else-if="match.winner === 'draw'" class="rounded-md bg-shuttle-400/20 px-2 py-1 text-xs font-black text-amber-800 dark:text-shuttle-400">เสมอ</span>
          </div>
          <p class="text-lg font-black">{{ teamText(match, 'B') }}</p>
        </div>

        <div class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
            <p class="text-xs text-stone-500 dark:text-stone-400">เริ่ม</p>
            <p class="font-black">{{ match.startedAt || '-' }}</p>
          </div>
          <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
            <p class="text-xs text-stone-500 dark:text-stone-400">จบ</p>
            <p class="font-black">{{ match.endedAt || '-' }}</p>
          </div>
          <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
            <p class="text-xs text-stone-500 dark:text-stone-400">ลูกแบด</p>
            <p class="font-black">{{ match.shuttles }}</p>
            <p v-if="shuttleSummary(match)" class="text-[11px] font-bold text-stone-500 dark:text-stone-400">{{ shuttleSummary(match) }}</p>
          </div>
          <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
            <p class="text-xs text-stone-500 dark:text-stone-400">Sequence</p>
            <p class="font-black">{{ shuttleSequenceText(match) }}</p>
          </div>
        </div>

        <div class="rounded-md bg-paper-100 p-3 text-sm dark:bg-stone-800">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p class="text-xs text-stone-500 dark:text-stone-400">ผลการแข่งขัน / แก้ย้อนหลัง</p>
              <p class="mt-1 font-bold">{{ isCancelled(match) ? 'ยกเลิกคิว' : winnerText(match) }}</p>
            </div>
            <select
              :value="match.winner || ''"
              class="h-10 rounded-md border border-stone-200 bg-white px-3 text-sm font-bold disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900"
              :disabled="isSessionReadOnly || isCancelled(match)"
              aria-label="เปลี่ยนผลการแข่งขัน"
              @change="updateHistoryWinner(match, $event.target.value)"
            >
              <option value="">ไม่ระบุผล</option>
              <option value="A">ทีม A ชนะ</option>
              <option value="B">ทีม B ชนะ</option>
              <option value="draw">เสมอ</option>
            </select>
          </div>
          <p class="mt-1 text-xs font-black text-court-700 dark:text-court-300">สกอร์ {{ resultScoreText(match) }}</p>
          <p v-if="match.note" class="mt-2 text-stone-600 dark:text-stone-300">{{ match.note }}</p>
        </div>
      </div>
    </article>
  </section>
</template>
