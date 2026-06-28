<script setup>
import { computed, ref } from 'vue'
import { Download } from '@lucide/vue'
import { exportHistoryExcel } from '../excelExport'

const props = defineProps([
  'state',
  'playerName',
  'matchLevelLabel',
  'updateHistoryWinner',
  'isSessionReadOnly'
])

const sortedHistory = computed(() => [...props.state.history].sort((a, b) => a.id - b.id))
const exportLoading = ref(false)
const exportError = ref('')

function winnerText(match) {
  if (!match.winner) return '-'
  if (match.winner === 'draw') return 'เสมอ'
  return match.winner === 'A'
    ? `${props.playerName(match.a1)} + ${props.playerName(match.a2)}`
    : `${props.playerName(match.b1)} + ${props.playerName(match.b2)}`
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

async function exportExcel() {
  if (exportLoading.value) return
  exportLoading.value = true
  exportError.value = ''
  try {
    await exportHistoryExcel(props)
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
        <h1 class="font-black">ประวัติการแข่งขัน</h1>
        <p class="text-xs font-semibold text-stone-500 dark:text-stone-400">{{ sortedHistory.length }} รายการ</p>
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
    <article
      v-for="match in sortedHistory"
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
          <p class="text-lg font-black">{{ playerName(match.a1) }} + {{ playerName(match.a2) }}</p>
        </div>

        <div class="grid gap-2 rounded-md border border-stone-100 p-3 dark:border-stone-800">
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm font-bold text-stone-500">ทีม B</span>
            <span v-if="match.winner === 'B'" class="rounded-md bg-court-500/10 px-2 py-1 text-xs font-black text-court-700 dark:text-court-300">ชนะ</span>
            <span v-else-if="match.winner === 'draw'" class="rounded-md bg-shuttle-400/20 px-2 py-1 text-xs font-black text-amber-800 dark:text-shuttle-400">เสมอ</span>
          </div>
          <p class="text-lg font-black">{{ playerName(match.b1) }} + {{ playerName(match.b2) }}</p>
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
          </div>
          <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
            <p class="text-xs text-stone-500 dark:text-stone-400">Sequence</p>
            <p class="font-black">{{ match.shuttleSequence || '-' }}</p>
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
