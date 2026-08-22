<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { CreditCard, Download, Plus, Trophy, X } from '@lucide/vue'
import { exportHistoryExcel, exportPaymentHistoryExcel } from '../excelExport'
import { emptyMatchScores, matchScoreSummary, validateMatchScores } from '../matchScores.js'

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
const selectedPayment = ref(null)
const exportLoading = ref(false)
const exportError = ref('')
const editingMatch = ref(null)
const editScores = ref(emptyMatchScores())
const editWinner = ref('')
const editError = ref('')
const editSaving = ref(false)
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

function openResultEditor(match) {
  editingMatch.value = match
  editScores.value = Array.isArray(match.scores) && match.scores.length
    ? match.scores.map((score) => ({ a: String(score.a), b: String(score.b) }))
    : emptyMatchScores()
  editWinner.value = match.winner || ''
  editError.value = ''
}

function closeResultEditor() {
  editingMatch.value = null
  editScores.value = emptyMatchScores()
  editWinner.value = ''
  editError.value = ''
}

function addEditSet() {
  if (editScores.value.length < 3) editScores.value.push({ a: '', b: '' })
  editError.value = ''
}

function removeEditSet() {
  if (editScores.value.length === 3) editScores.value.pop()
  editError.value = ''
}

async function saveEditedResult() {
  if (!editingMatch.value || editSaving.value) return
  const result = validateMatchScores(editScores.value)
  editError.value = result.error
  if (result.error) return
  editSaving.value = true
  try {
    await props.updateHistoryWinner(editingMatch.value, result.scores.length ? result.winner : editWinner.value, result.scores)
    closeResultEditor()
  } catch (error) {
    editError.value = error?.message || 'บันทึกคะแนนไม่สำเร็จ'
  } finally {
    editSaving.value = false
  }
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

function handleBillingSync(event) {
  const items = event?.detail?.paymentHistory
  if (!Array.isArray(items)) return
  paymentEvents.value = items
  paymentLoaded.value = true
  paymentError.value = ''
}

onMounted(() => window.addEventListener('livematch:billing-sync', handleBillingSync))
onUnmounted(() => window.removeEventListener('livematch:billing-sync', handleBillingSync))

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
		<article v-for="event in paymentEvents" :key="event.id" class="grid cursor-pointer gap-2 p-4 hover:bg-paper-50 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-5 dark:hover:bg-stone-800/50" @click="selectedPayment = event">
          <div class="min-w-0">
            <p class="truncate font-black">{{ event.playerName }}</p>
            <p class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">{{ event.createdAt }}</p>
			<p class="mt-1 text-xs font-black text-stone-600 dark:text-stone-300">{{ event.paid ? (event.paymentMethod === 'promptpay' ? 'สแกน' : 'เงินสด') : '—' }} <span v-if="event.originSystem" class="ml-1 rounded px-1.5 py-0.5" :class="event.originSystem === 'pos' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200'">รับที่ {{ event.originSystem === 'pos' ? 'POS' : 'Match' }}</span></p>
          </div>
          <span class="w-fit rounded-md px-2 py-1 text-xs font-black" :class="event.paid ? 'bg-court-500/10 text-court-700 dark:text-court-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'">
            {{ event.paid ? 'ชำระเงิน' : 'ยกเลิกการชำระเงิน' }}
          </span>
		  <div class="text-right"><p class="font-black tabular-nums text-court-700 dark:text-court-300">฿{{ formatAmount(event.amount) }}</p><p v-if="event.matchTotalSatang !== undefined" class="mt-1 text-[10px] font-bold text-stone-400">Match ฿{{ formatAmount(Number(event.matchTotalSatang || 0) / 100) }} · POS ฿{{ formatAmount(Number(event.posTotalSatang || 0) / 100) }}</p></div>
		</article>
	</div>

	<div v-if="selectedPayment" class="fixed inset-0 z-[70] grid place-items-end bg-stone-950/50 p-3 sm:place-items-center" role="dialog" aria-modal="true" @click.self="selectedPayment = null">
	  <div class="w-full max-w-lg overflow-hidden rounded-lg border border-stone-200 bg-white shadow-soft dark:border-stone-700 dark:bg-stone-900">
		<div class="flex items-start justify-between border-b border-stone-100 p-4 dark:border-stone-800"><div><p class="text-xs font-black text-court-600">{{ selectedPayment.paymentId || selectedPayment.id }}</p><h2 class="mt-1 text-lg font-black">รายละเอียดการชำระเงิน · {{ selectedPayment.playerName }}</h2></div><button class="grid h-9 w-9 place-items-center rounded-md hover:bg-stone-100 dark:hover:bg-stone-800" @click="selectedPayment = null"><X class="h-4 w-4" /></button></div>
		<div class="max-h-[65vh] space-y-3 overflow-y-auto p-4">
		  <div class="grid grid-cols-3 gap-2 text-center text-sm"><div class="rounded-lg bg-paper-100 p-3 dark:bg-stone-800"><p class="text-xs font-bold text-stone-500">Match</p><b>฿{{ formatAmount(Number(selectedPayment.matchTotalSatang || 0) / 100) }}</b></div><div class="rounded-lg bg-paper-100 p-3 dark:bg-stone-800"><p class="text-xs font-bold text-stone-500">POS</p><b>฿{{ formatAmount(Number(selectedPayment.posTotalSatang || 0) / 100) }}</b></div><div class="rounded-lg bg-court-500/10 p-3"><p class="text-xs font-bold text-stone-500">รวม</p><b class="text-court-700">฿{{ formatAmount(selectedPayment.amount) }}</b></div></div>
		  <section v-for="line in (selectedPayment.lines || [])" :key="`${line.sourceType}-${line.sourceId}`" class="rounded-lg border border-stone-200 p-3 dark:border-stone-700"><div class="flex items-center justify-between gap-3"><div><span class="rounded px-1.5 py-0.5 text-[10px] font-black" :class="line.sourceType === 'pos' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'">{{ line.sourceType.toUpperCase() }}</span><p class="mt-1 font-black">{{ line.label }}</p></div><b>฿{{ formatAmount(Number(line.amountSatang || 0) / 100) }}</b></div><div v-if="Array.isArray(line.snapshot?.items)" class="mt-2 grid gap-1 border-t border-stone-100 pt-2 text-xs dark:border-stone-800"><div v-for="(item, index) in line.snapshot.items" :key="index" class="flex justify-between gap-3"><span>{{ item.quantity || 1 }} × {{ item.name || item.productName || item.label || 'รายการ' }}</span><b>฿{{ formatAmount(Number(item.amountSatang ?? item.lineTotalSatang ?? 0) / 100) }}</b></div></div></section>
		</div>
	  </div>
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

        <div v-if="match.scores?.length" class="rounded-md border border-court-200 bg-court-500/5 p-3 dark:border-court-900/60">
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm font-black">คะแนนรายเซต</p>
            <span class="rounded-md bg-white px-2.5 py-1 text-xs font-black text-court-700 dark:bg-stone-900 dark:text-court-300">{{ matchScoreSummary(match.scores) }}</span>
          </div>
          <div class="mt-3 grid gap-2" :class="match.scores.length === 3 ? 'grid-cols-3' : 'grid-cols-2'">
            <div v-for="(score, index) in match.scores" :key="index" class="rounded-md bg-white p-2 text-center dark:bg-stone-900">
              <p class="text-[11px] font-bold text-stone-500">เซต {{ index + 1 }}</p>
              <p class="mt-1 text-xl font-black tabular-nums">{{ score.a }}–{{ score.b }}</p>
            </div>
          </div>
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
              :disabled="isSessionReadOnly || isCancelled(match) || match.scores?.length"
              aria-label="เปลี่ยนผลการแข่งขัน"
              @change="updateHistoryWinner(match, $event.target.value)"
            >
              <option value="">ไม่ระบุผล</option>
              <option value="A">ทีม A ชนะ</option>
              <option value="B">ทีม B ชนะ</option>
              <option value="draw">เสมอ</option>
            </select>
            <button
              type="button"
              class="h-10 rounded-md border border-court-200 bg-court-500/10 px-3 text-sm font-black text-court-700 disabled:opacity-50 dark:border-court-900 dark:text-court-300"
              :disabled="isSessionReadOnly || isCancelled(match)"
              @click="openResultEditor(match)"
            >
              {{ match.scores?.length ? 'แก้คะแนน' : 'เพิ่มคะแนน' }}
            </button>
          </div>
          <p class="mt-1 text-xs font-black text-court-700 dark:text-court-300">สกอร์ {{ resultScoreText(match) }}</p>
          <p v-if="match.note" class="mt-2 text-stone-600 dark:text-stone-300">{{ match.note }}</p>
        </div>
      </div>
    </article>

    <div v-if="editingMatch" class="fixed inset-0 z-50 grid place-items-end bg-black/50 p-3 sm:place-items-center" role="dialog" aria-modal="true" aria-labelledby="edit-match-score-title">
      <section class="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-4 shadow-2xl dark:bg-stone-900">
        <div class="flex items-start justify-between gap-3">
          <div><p class="text-xs font-bold text-court-600">เกมที่ {{ editingMatch.id }}</p><h2 id="edit-match-score-title" class="mt-1 text-xl font-black">แก้คะแนนการแข่งขัน</h2></div>
          <button class="grid h-10 w-10 place-items-center rounded-md border border-stone-200 dark:border-stone-700" aria-label="ปิดแก้คะแนน" @click="closeResultEditor"><X class="h-4 w-4" /></button>
        </div>

        <div class="mt-4 grid grid-cols-[3rem_1fr_1fr] items-start gap-2 text-center text-xs font-black text-stone-500">
          <span class="pt-1">เซต</span>
          <div class="min-w-0"><span>ทีม A</span><small class="mt-0.5 block break-words text-[10px] font-semibold leading-tight text-stone-400">{{ teamText(editingMatch, 'A') }}</small></div>
          <div class="min-w-0"><span>ทีม B</span><small class="mt-0.5 block break-words text-[10px] font-semibold leading-tight text-stone-400">{{ teamText(editingMatch, 'B') }}</small></div>
        </div>
        <div v-for="(score, index) in editScores" :key="index" class="mt-2 grid grid-cols-[3rem_1fr_1fr] items-center gap-2">
          <span class="text-center font-black">{{ index + 1 }}</span>
          <input v-model="score.a" type="number" min="0" max="99" step="1" inputmode="numeric" :aria-label="`แก้คะแนนทีม A เซต ${index + 1}`" class="h-12 min-w-0 rounded-md border border-stone-200 bg-paper-50 text-center text-xl font-black dark:border-stone-700 dark:bg-stone-800" @input="editError = ''" />
          <input v-model="score.b" type="number" min="0" max="99" step="1" inputmode="numeric" :aria-label="`แก้คะแนนทีม B เซต ${index + 1}`" class="h-12 min-w-0 rounded-md border border-stone-200 bg-paper-50 text-center text-xl font-black dark:border-stone-700 dark:bg-stone-800" @input="editError = ''" />
        </div>
        <div class="mt-3 flex justify-end">
          <button v-if="editScores.length < 3" class="inline-flex h-9 items-center gap-1 rounded-md border border-court-200 px-3 text-xs font-black text-court-700" @click="addEditSet"><Plus class="h-3.5 w-3.5" />เพิ่มเซตที่ 3</button>
          <button v-else class="h-9 rounded-md border border-rose-200 px-3 text-xs font-black text-rose-700" @click="removeEditSet">ลบเซตที่ 3</button>
        </div>

        <div v-if="!editScores.some((score) => score.a !== '' || score.b !== '')" class="mt-4 grid gap-2">
          <p class="text-xs font-bold text-stone-500">ไม่กรอกคะแนน — เลือกผลเอง</p>
          <select v-model="editWinner" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 font-bold dark:border-stone-700 dark:bg-stone-800">
            <option value="">ไม่ระบุผล</option><option value="A">ทีม A ชนะ</option><option value="B">ทีม B ชนะ</option><option value="draw">เสมอ</option>
          </select>
        </div>
        <p v-if="editError" class="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{{ editError }}</p>
        <div class="mt-5 grid grid-cols-2 gap-2">
          <button class="h-11 rounded-md border border-stone-200 font-black dark:border-stone-700" @click="closeResultEditor">ยกเลิก</button>
          <button class="h-11 rounded-md bg-court-500 font-black text-white disabled:opacity-50" :disabled="editSaving" @click="saveEditedResult">{{ editSaving ? 'กำลังบันทึก...' : 'บันทึกคะแนน' }}</button>
        </div>
      </section>
    </div>
  </section>
</template>
