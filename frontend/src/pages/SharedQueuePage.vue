<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Activity, Clock3, ListOrdered, Medal, UsersRound } from '@lucide/vue'

const props = defineProps([
  'state',
  'share',
  'playerName',
  'matchLevelLabel'
])

const waitingMatches = computed(() => [...props.state.queue].sort((a, b) => a.id - b.id))
const liveMatches = computed(() => [...props.state.live].sort((a, b) => a.id - b.id))
const now = ref(new Date())
let elapsedTimer = null

onMounted(() => {
  elapsedTimer = window.setInterval(() => {
    now.value = new Date()
  }, 30000)
})

onUnmounted(() => {
  if (elapsedTimer) window.clearInterval(elapsedTimer)
})

function teamText(match, side) {
  return side === 'A'
    ? `${props.playerName(match.a1)} + ${props.playerName(match.a2)}`
    : `${props.playerName(match.b1)} + ${props.playerName(match.b2)}`
}

function elapsedTime(match) {
  if (!match.startedAt) return '-'
  const [hourText, minuteText] = match.startedAt.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '-'

  const started = new Date(now.value)
  started.setHours(hour, minute, 0, 0)
  if (started > now.value) started.setDate(started.getDate() - 1)

  const totalMinutes = Math.max(0, Math.floor((now.value - started) / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours} ชม. ${minutes} นาที`
  return `${minutes} นาที`
}
</script>

<template>
  <section class="min-h-screen bg-paper-50 px-3 py-4 dark:bg-paper-900 sm:px-4">
    <div class="mx-auto grid max-w-3xl gap-4">
      <div class="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-soft dark:border-stone-700 dark:bg-stone-900">
        <div class="bg-[linear-gradient(135deg,#1f8a70_0%,#2f7f8f_58%,#20251f_100%)] p-4 text-white">
          <p class="text-xs font-black uppercase tracking-[0.16em] text-white/75">LiveMatch Queue</p>
          <div class="mt-2 flex items-end justify-between gap-3">
            <div class="min-w-0">
              <h1 class="truncate text-2xl font-black leading-tight">{{ state.session.name }}</h1>
              <p class="mt-1 text-sm font-medium text-white/80">ลำดับคิวลงสนามและเกมที่กำลังแข่ง</p>
            </div>
            <div class="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-white/15 ring-1 ring-white/20">
              <ListOrdered class="h-6 w-6" />
            </div>
          </div>
        </div>

        <div class="grid grid-cols-3 divide-x divide-stone-100 border-b border-stone-100 dark:divide-stone-800 dark:border-stone-800">
          <div class="p-3">
            <p class="text-[11px] font-bold text-stone-500 dark:text-stone-400">รอแข่ง</p>
            <p class="mt-1 text-xl font-black">{{ waitingMatches.length }}</p>
          </div>
          <div class="p-3">
            <p class="text-[11px] font-bold text-stone-500 dark:text-stone-400">กำลังแข่ง</p>
            <p class="mt-1 text-xl font-black">{{ liveMatches.length }}</p>
          </div>
          <div class="p-3">
            <p class="text-[11px] font-bold text-stone-500 dark:text-stone-400">สนาม</p>
            <p class="mt-1 text-xl font-black">{{ state.settings.courtNames.length }}</p>
          </div>
        </div>
      </div>

      <div v-if="share.loading" class="rounded-lg border border-stone-200 bg-white p-4 text-sm font-semibold text-stone-500 dark:border-stone-700 dark:bg-stone-900">
        กำลังโหลดข้อมูล
      </div>

      <div v-else-if="share.error" class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
        {{ share.error }}
      </div>

      <template v-else>
        <div v-if="liveMatches.length" class="grid gap-3">
          <div class="flex items-center gap-2 px-1">
            <Activity class="h-5 w-5 text-court-600" />
            <h2 class="font-black">กำลังแข่ง</h2>
          </div>

          <article
            v-for="match in liveMatches"
            :key="match.id"
            class="overflow-hidden rounded-lg border border-court-500/20 bg-white shadow-soft dark:border-court-500/30 dark:bg-stone-900"
          >
            <div class="flex items-center justify-between gap-3 border-b border-stone-100 bg-court-500/10 p-3 dark:border-stone-800">
              <div>
                <p class="text-xs font-black text-court-700 dark:text-court-300">เกมที่ {{ match.id }} · {{ match.court }}</p>
                <p class="mt-0.5 text-xs font-bold text-stone-500 dark:text-stone-400">ระดับ {{ matchLevelLabel(match) }} · ลูกแบด {{ match.shuttles }} · เริ่ม {{ match.startedAt || '-' }}</p>
              </div>
              <span class="rounded-md bg-court-500 px-2 py-1 text-xs font-black text-white">กำลังแข่ง</span>
            </div>
            <div class="flex items-center gap-2 border-b border-stone-100 bg-white px-3 py-2 text-sm font-black text-court-700 dark:border-stone-800 dark:bg-stone-900 dark:text-court-300">
              <Clock3 class="h-4 w-4" />
              <span>ตีมาแล้ว {{ elapsedTime(match) }}</span>
            </div>
            <div class="grid gap-2 p-3">
              <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
                <p class="text-xs font-black text-stone-500 dark:text-stone-400">ทีม A</p>
                <p class="mt-1 text-lg font-black">{{ teamText(match, 'A') }}</p>
              </div>
              <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
                <p class="text-xs font-black text-stone-500 dark:text-stone-400">ทีม B</p>
                <p class="mt-1 text-lg font-black">{{ teamText(match, 'B') }}</p>
              </div>
            </div>
          </article>
        </div>

        <div class="grid gap-3">
          <div class="flex items-center gap-2 px-1">
            <Clock3 class="h-5 w-5 text-amber-700 dark:text-amber-300" />
            <h2 class="font-black">ลำดับคิวรอลงสนาม</h2>
          </div>

          <div v-if="!waitingMatches.length" class="rounded-lg border border-stone-200 bg-white p-6 text-center shadow-soft dark:border-stone-700 dark:bg-stone-900">
            <Medal class="mx-auto h-8 w-8 text-stone-300 dark:text-stone-600" />
            <p class="mt-2 font-black">ยังไม่มีคิวรอลงสนาม</p>
            <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">รอผู้ดูแลจัดคู่หรือเริ่มเกมถัดไป</p>
          </div>

          <article
            v-for="(match, index) in waitingMatches"
            :key="match.id"
            class="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-soft dark:border-stone-700 dark:bg-stone-900"
          >
            <div class="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-stone-100 bg-paper-100 p-3 dark:border-stone-800 dark:bg-stone-800">
              <span class="grid h-10 w-10 place-items-center rounded-md bg-stone-900 text-sm font-black text-white dark:bg-white dark:text-stone-900">#{{ index + 1 }}</span>
              <div class="min-w-0">
                <p class="truncate text-sm font-black">เกมที่ {{ match.id }}</p>
                <p class="text-xs font-bold text-stone-500 dark:text-stone-400">ระดับ {{ matchLevelLabel(match) }} · รอเลือกสนาม</p>
              </div>
              <UsersRound class="h-5 w-5 text-court-600 dark:text-court-300" />
            </div>
            <div class="grid gap-2 p-3 sm:grid-cols-2">
              <div class="rounded-md border border-stone-100 p-3 dark:border-stone-800">
                <p class="text-xs font-black text-stone-500 dark:text-stone-400">ทีม A</p>
                <p class="mt-1 text-lg font-black">{{ teamText(match, 'A') }}</p>
              </div>
              <div class="rounded-md border border-stone-100 p-3 dark:border-stone-800">
                <p class="text-xs font-black text-stone-500 dark:text-stone-400">ทีม B</p>
                <p class="mt-1 text-lg font-black">{{ teamText(match, 'B') }}</p>
              </div>
            </div>
          </article>
        </div>
      </template>
    </div>
  </section>
</template>
