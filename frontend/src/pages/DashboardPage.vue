<script setup>
import { computed, ref } from 'vue'
import { Activity, BarChart3, ClipboardList, CreditCard, Download, RefreshCw, Shuffle, Trophy, Users } from '@lucide/vue'
import { exportDashboardExcel } from '../excelExport'
import HeroBackground from '../components/HeroBackground.vue'

const props = defineProps([
  'state',
  'activePlayerCount',
  'totalRecordedMatches',
  'cancelledMatches',
  'averageGames',
  'minGames',
  'maxGames',
  'totalShuttles',
  'paymentPercent',
  'money',
  'totalRevenue',
  'paidRevenue',
  'unpaidRevenue',
  'liveShareCourtHours',
  'liveSharePlayerHours',
  'liveShareCourtCost',
  'liveShareShuttleCost',
  'liveShareSessionCost',
  'unpaidPlayers',
  'topPlayers',
  'quietPlayers',
  'topWinners',
  'playerCost',
  'playerScore',
  'levelLabel',
  'selectAdminTab'
])

const exportLoading = ref(false)
const exportError = ref('')

const shuttleBrandSummary = computed(() => {
  const counts = new Map()
  const brandName = (brandId) => props.state.settings.shuttleBrands?.find((brand) => brand.id === brandId)?.name || 'ลูกแบดทั่วไป'
  for (const match of [...(props.state.live || []), ...(props.state.history || [])]) {
    if (match.status === 'cancelled' && match.shuttleReturned) continue
    const items = Array.isArray(match.shuttleSequenceItems) && match.shuttleSequenceItems.length
      ? match.shuttleSequenceItems
      : String(match.shuttleSequence || '').split(',').filter(Boolean).map((part) => ({ brandId: 'default', number: Number(part) }))
    for (const item of items) {
      const id = item.brandId || 'default'
      counts.set(id, (counts.get(id) || 0) + 1)
    }
  }
  return Array.from(counts.entries()).map(([brandId, count]) => ({ brandId, name: brandName(brandId), count }))
})

async function exportExcel() {
  if (exportLoading.value) return
  exportLoading.value = true
  exportError.value = ''
  try {
    await exportDashboardExcel(props)
  } catch (error) {
    exportError.value = error?.message || 'สร้างไฟล์ Excel ไม่สำเร็จ'
  } finally {
    exportLoading.value = false
  }
}
</script>

<template>
  <section class="grid gap-4">
    <div class="lm-hero-bg rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-5">
      <HeroBackground />
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p class="text-sm font-semibold text-court-600 dark:text-court-500">ภาพรวมวันนี้</p>
          <h1 class="mt-1 text-2xl font-black leading-tight sm:text-3xl">{{ state.session.name }}</h1>
          <p class="mt-1 text-sm text-stone-500 dark:text-stone-400">อัปเดตจากสมาชิก คิว สนามที่กำลังเล่น และประวัติการแข่งขัน</p>
        </div>
        <div class="grid grid-cols-2 gap-2 sm:min-w-64">
          <button class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-court-500 px-3 text-sm font-bold text-white" @click="selectAdminTab('livematch')">
            <Shuffle class="h-4 w-4" />
            จัดคู่
          </button>
          <button class="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-stone-200 bg-paper-50 px-3 text-sm font-bold dark:border-stone-700 dark:bg-stone-800" @click="selectAdminTab('players')">
            <Users class="h-4 w-4" />
            สมาชิก
          </button>
          <button
            class="col-span-2 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-court-200 bg-court-500/10 px-3 text-sm font-bold text-court-700 disabled:cursor-wait disabled:opacity-60 dark:border-court-900/60 dark:text-court-300"
            :disabled="exportLoading"
            data-testid="export-dashboard"
            @click="exportExcel"
          >
            <Download class="h-4 w-4" />
            {{ exportLoading ? 'กำลังสร้าง Excel...' : 'Export Excel' }}
          </button>
          <p v-if="exportError" class="col-span-2 text-right text-xs font-bold text-rose-700 dark:text-rose-300">{{ exportError }}</p>
        </div>
      </div>

      <div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-md bg-paper-100 p-4 dark:bg-stone-800">
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm text-stone-500 dark:text-stone-400">ผู้เล่นวันนี้</p>
            <Users class="h-5 w-5 text-court-500" />
          </div>
          <p class="mt-2 text-3xl font-black">{{ activePlayerCount }}</p>
          <p class="text-xs text-stone-500 dark:text-stone-400">คนที่เปิดใช้งานใน session</p>
        </div>
        <div class="rounded-md bg-paper-100 p-4 dark:bg-stone-800">
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm text-stone-500 dark:text-stone-400">เกมทั้งหมด</p>
            <ClipboardList class="h-5 w-5 text-court-500" />
          </div>
          <p class="mt-2 text-3xl font-black">{{ totalRecordedMatches }}</p>
          <p class="text-xs text-stone-500 dark:text-stone-400">คิว {{ state.queue.length }} · กำลังเล่น {{ state.live.length }} · เกมจริง {{ state.history.length - cancelledMatches.length }} · ยกเลิก {{ cancelledMatches.length }}</p>
        </div>
        <div class="rounded-md bg-paper-100 p-4 dark:bg-stone-800">
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm text-stone-500 dark:text-stone-400">เฉลี่ยเกมต่อคน</p>
            <BarChart3 class="h-5 w-5 text-court-500" />
          </div>
          <p class="mt-2 text-3xl font-black">{{ averageGames.toFixed(2) }}</p>
          <p class="text-xs text-stone-500 dark:text-stone-400">ต่ำสุด {{ minGames }} · สูงสุด {{ maxGames }}</p>
        </div>
        <div class="rounded-md bg-paper-100 p-4 dark:bg-stone-800">
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm text-stone-500 dark:text-stone-400">ลูกแบดใช้จริง</p>
            <RefreshCw class="h-5 w-5 text-court-500" />
          </div>
          <p class="mt-2 text-3xl font-black">{{ totalShuttles }}</p>
          <p class="text-xs text-stone-500 dark:text-stone-400">ลูกแบดรวม {{ totalShuttles * 4 }} ลูก</p>
        </div>
      </div>

      <div class="mt-4 grid gap-3 sm:grid-cols-3">
        <div class="rounded-md border border-court-200 bg-court-500/10 p-4 dark:border-court-900/60 dark:bg-court-500/10">
          <p class="text-sm font-bold text-court-700 dark:text-court-300">ยอดเกมจริง</p>
          <p class="mt-1 text-3xl font-black">{{ totalRecordedMatches }}</p>
          <p class="text-xs font-semibold text-stone-500 dark:text-stone-400">กำลังเล่น + ประวัติที่ไม่ยกเลิก</p>
        </div>
        <div class="rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
          <p class="text-sm font-bold text-amber-800 dark:text-amber-300">รอคิว</p>
          <p class="mt-1 text-3xl font-black">{{ state.queue.length }}</p>
          <p class="text-xs font-semibold text-stone-500 dark:text-stone-400">ยังไม่รวมในยอดเกมจริง</p>
        </div>
        <div class="rounded-md border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/20">
          <p class="text-sm font-bold text-rose-700 dark:text-rose-300">ยกเลิก</p>
          <p class="mt-1 text-3xl font-black">{{ cancelledMatches.length }}</p>
          <p class="text-xs font-semibold text-stone-500 dark:text-stone-400">หักออกจากเกมทั้งหมดแล้ว</p>
        </div>
      </div>

      <div v-if="shuttleBrandSummary.length" class="mt-4 rounded-md border border-shuttle-400/50 bg-shuttle-400/10 p-4">
        <p class="text-sm font-black text-amber-800 dark:text-shuttle-400">ลูกแบดตามยี่ห้อ</p>
        <div class="mt-2 flex flex-wrap gap-2">
          <span v-for="item in shuttleBrandSummary" :key="item.brandId" class="rounded-md bg-white px-2.5 py-1 text-xs font-black text-stone-700 dark:bg-stone-900 dark:text-stone-200">
            {{ item.name }} {{ item.count }} ลูก
          </span>
        </div>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <div class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-stone-500 dark:text-stone-400">การเงิน</p>
            <h2 class="mt-1 text-xl font-black">รับแล้ว {{ paymentPercent }}%</h2>
          </div>
          <CreditCard class="h-6 w-6 text-court-500" />
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-3">
          <div v-if="state.session.type === 'liveShare'" class="rounded-md border border-stone-200 p-3 dark:border-stone-700">
            <p class="text-xs text-stone-500 dark:text-stone-400">ค่าคอร์ด/ค่าสนาม</p>
            <p class="mt-1 text-xl font-black">{{ money(liveShareCourtCost) }}</p>
            <p class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">{{ liveShareCourtHours }} ชม.สนาม · session {{ money(liveShareSessionCost) }}</p>
          </div>
          <div class="rounded-md border border-stone-200 p-3 dark:border-stone-700">
            <p class="text-xs text-stone-500 dark:text-stone-400">รายรับรวม</p>
            <p class="mt-1 text-xl font-black">{{ money(totalRevenue) }}</p>
          </div>
          <div class="rounded-md border border-stone-200 p-3 dark:border-stone-700">
            <p class="text-xs text-stone-500 dark:text-stone-400">รับแล้ว</p>
            <p class="mt-1 text-xl font-black text-court-600 dark:text-court-500">{{ money(paidRevenue) }}</p>
          </div>
          <div class="rounded-md border border-stone-200 p-3 dark:border-stone-700">
            <p class="text-xs text-stone-500 dark:text-stone-400">ค้างชำระ</p>
            <p class="mt-1 text-xl font-black text-amber-700 dark:text-shuttle-400">{{ money(unpaidRevenue) }}</p>
          </div>
        </div>
        <div class="mt-4 h-3 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
          <div class="h-full rounded-full bg-court-500" :style="{ width: `${paymentPercent}%` }" />
        </div>
        <p class="mt-2 text-xs font-semibold text-stone-500 dark:text-stone-400">{{ unpaidPlayers.length }} คนค้างจ่าย</p>
      </div>

      <div class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-stone-500 dark:text-stone-400">สถานะสนาม</p>
            <h2 class="mt-1 text-xl font-black">{{ state.live.length }} เกมกำลังเล่น</h2>
          </div>
          <Activity class="h-6 w-6 text-court-500" />
        </div>
        <div class="mt-4 grid grid-cols-3 gap-2 text-center">
          <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
            <p class="text-2xl font-black">{{ state.queue.length }}</p>
            <p class="text-xs text-stone-500 dark:text-stone-400">รอลง</p>
          </div>
          <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
            <p class="text-2xl font-black">{{ state.live.length }}</p>
            <p class="text-xs text-stone-500 dark:text-stone-400">กำลังเล่น</p>
          </div>
          <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
            <p class="text-2xl font-black">{{ state.settings.courtNames.length }}</p>
            <p class="text-xs text-stone-500 dark:text-stone-400">สนาม</p>
          </div>
        </div>
        <div class="mt-3 rounded-md border border-rose-100 bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300">
          ยกเลิก {{ cancelledMatches.length }} เกม · ไม่รวมในเกมทั้งหมด
        </div>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-3">
      <div class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-5">
        <div class="flex items-center justify-between">
          <h2 class="font-black">ผู้ชนะมากสุด</h2>
          <Trophy class="h-5 w-5 text-court-500" />
        </div>
        <div class="mt-4 space-y-3">
          <div v-for="(player, index) in topWinners" :key="player.id" class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate font-bold">{{ index + 1 }}. {{ player.name }}</p>
              <p class="text-xs text-stone-500 dark:text-stone-400">เสมอ {{ player.draws || 0 }} · แพ้ {{ player.losses || 0 }} · เล่น {{ player.games }} เกม</p>
            </div>
            <span class="rounded-md bg-paper-100 px-3 py-1 text-sm font-black dark:bg-stone-800">{{ playerScore(player) }} แต้ม</span>
          </div>
        </div>
      </div>

      <div class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-5">
        <h2 class="font-black">ลงเล่นมากสุด</h2>
        <div class="mt-4 space-y-3">
          <div v-for="player in topPlayers" :key="player.id" class="flex items-center justify-between gap-3">
            <p class="truncate font-bold">{{ player.name }}</p>
            <span class="rounded-md bg-paper-100 px-3 py-1 text-sm font-black dark:bg-stone-800">{{ player.games }} เกม</span>
          </div>
        </div>
      </div>

      <div class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-5">
        <h2 class="font-black">ควรได้ลงรอบถัดไป</h2>
        <div class="mt-4 space-y-3">
          <div v-for="player in quietPlayers" :key="player.id" class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate font-bold">{{ player.name }}</p>
              <p class="text-xs text-stone-500 dark:text-stone-400">ระดับ {{ levelLabel(player.level) }}</p>
            </div>
            <span class="rounded-md bg-paper-100 px-3 py-1 text-sm font-black dark:bg-stone-800">{{ player.games }} เกม</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
