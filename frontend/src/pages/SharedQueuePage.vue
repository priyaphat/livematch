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
const totalVisibleMatches = computed(() => waitingMatches.value.length + liveMatches.value.length)
const tvDensityClass = computed(() => {
  if (totalVisibleMatches.value <= 2) return 'shared-queue-page--sparse'
  if (totalVisibleMatches.value > 16) return 'shared-queue-page--dense'
  if (totalVisibleMatches.value > 8) return 'shared-queue-page--compact'
  return 'shared-queue-page--comfortable'
})
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

function tvGridLayout(matchCount) {
  const rows = Math.max(1, Math.ceil(matchCount / 5))
  const columns = Math.max(1, Math.ceil(matchCount / rows))
  return { rows, columns }
}

function tvGridStyle(matchCount) {
  const { rows, columns } = tvGridLayout(matchCount)
  const teamNameSize = rows >= 3
    ? 'clamp(1.05rem, 2.2vmin, 1.6rem)'
    : rows === 2
      ? 'clamp(1.35rem, 3vmin, 2.2rem)'
      : 'clamp(2rem, 4.2vmin, 3.2rem)'
  return {
    '--tv-grid-rows': rows,
    '--tv-grid-columns': columns,
    '--tv-team-name-size': teamNameSize
  }
}

function tvContentStyle() {
  if (!liveMatches.value.length) return {}
  const liveRows = tvGridLayout(liveMatches.value.length).rows
  const waitingRows = tvGridLayout(waitingMatches.value.length).rows
  return {
    '--tv-content-rows': `minmax(0, ${liveRows + 0.8}fr) minmax(0, ${waitingRows + 0.8}fr)`
  }
}
</script>

<template>
  <section :class="['shared-queue-page min-h-screen bg-paper-50 px-3 py-4 dark:bg-paper-900 sm:px-4', tvDensityClass]">
    <div class="shared-queue-shell mx-auto grid max-w-3xl gap-4">
      <div class="shared-queue-summary overflow-hidden rounded-lg border border-stone-200 bg-white shadow-soft dark:border-stone-700 dark:bg-stone-900">
        <div class="shared-queue-hero bg-[linear-gradient(135deg,#1f8a70_0%,#2f7f8f_58%,#20251f_100%)] p-4 text-white">
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

        <div class="shared-queue-stats grid grid-cols-3 divide-x divide-stone-100 border-b border-stone-100 dark:divide-stone-800 dark:border-stone-800">
          <div class="shared-queue-stat p-3">
            <p class="text-[11px] font-bold text-stone-500 dark:text-stone-400">รอแข่ง</p>
            <p class="mt-1 text-xl font-black">{{ waitingMatches.length }}</p>
          </div>
          <div class="shared-queue-stat p-3">
            <p class="text-[11px] font-bold text-stone-500 dark:text-stone-400">กำลังแข่ง</p>
            <p class="mt-1 text-xl font-black">{{ liveMatches.length }}</p>
          </div>
          <div class="shared-queue-stat p-3">
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

      <div v-else class="shared-queue-content" :class="{ 'shared-queue-content--waiting-only': !liveMatches.length }" :style="tvContentStyle()">
        <div v-if="liveMatches.length" class="shared-queue-column shared-live-column">
          <div class="shared-queue-section-title flex items-center gap-2 px-1">
            <Activity class="h-5 w-5 text-court-600" />
            <h2 class="font-black">กำลังแข่ง</h2>
          </div>

          <div class="shared-match-grid" :style="tvGridStyle(liveMatches.length)">
            <article
              v-for="match in liveMatches"
              :key="match.id"
              class="shared-match-card shared-live-card overflow-hidden rounded-lg border border-court-500/20 bg-white shadow-soft dark:border-court-500/30 dark:bg-stone-900"
            >
              <div class="shared-match-header flex items-center justify-between gap-3 border-b border-stone-100 bg-court-500/10 p-3 dark:border-stone-800">
                <div class="min-w-0">
                  <p class="truncate text-xs font-black text-court-700 dark:text-court-300">เกมที่ {{ match.id }} · {{ match.court }}</p>
                  <p class="shared-match-meta mt-0.5 truncate text-xs font-bold text-stone-500 dark:text-stone-400">ระดับ {{ matchLevelLabel(match) }} · ลูกแบด {{ match.shuttles }} · เริ่ม {{ match.startedAt || '-' }}</p>
                </div>
                <span class="shared-live-badge shrink-0 rounded-md bg-court-500 px-2 py-1 text-xs font-black text-white">กำลังแข่ง</span>
              </div>
              <div class="shared-elapsed flex items-center gap-2 border-b border-stone-100 bg-white px-3 py-2 text-sm font-black text-court-700 dark:border-stone-800 dark:bg-stone-900 dark:text-court-300">
                <Clock3 class="h-4 w-4" />
                <span>ตีมาแล้ว {{ elapsedTime(match) }}</span>
              </div>
              <div class="shared-team-grid grid gap-2 p-3">
                <div class="shared-team-box rounded-md bg-paper-100 p-3 dark:bg-stone-800">
                  <p class="text-xs font-black text-stone-500 dark:text-stone-400">ทีม A</p>
                  <p class="shared-team-name mt-1 text-lg font-black">{{ teamText(match, 'A') }}</p>
                </div>
                <div class="shared-team-box rounded-md bg-paper-100 p-3 dark:bg-stone-800">
                  <p class="text-xs font-black text-stone-500 dark:text-stone-400">ทีม B</p>
                  <p class="shared-team-name mt-1 text-lg font-black">{{ teamText(match, 'B') }}</p>
                </div>
              </div>
            </article>
          </div>
        </div>

        <div class="shared-queue-column shared-waiting-column">
          <div class="shared-queue-section-title flex items-center gap-2 px-1">
            <Clock3 class="h-5 w-5 text-amber-700 dark:text-amber-300" />
            <h2 class="font-black">ลำดับคิวรอลงสนาม</h2>
          </div>

          <div v-if="!waitingMatches.length" class="shared-empty-queue rounded-lg border border-stone-200 bg-white p-6 text-center shadow-soft dark:border-stone-700 dark:bg-stone-900">
            <Medal class="mx-auto h-8 w-8 text-stone-300 dark:text-stone-600" />
            <p class="mt-2 font-black">ยังไม่มีคิวรอลงสนาม</p>
            <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">รอผู้ดูแลจัดคู่หรือเริ่มเกมถัดไป</p>
          </div>

          <div v-else class="shared-match-grid" :style="tvGridStyle(waitingMatches.length)">
            <article
              v-for="(match, index) in waitingMatches"
              :key="match.id"
              class="shared-match-card shared-waiting-card overflow-hidden rounded-lg border border-stone-200 bg-white shadow-soft dark:border-stone-700 dark:bg-stone-900"
            >
              <div class="shared-match-header grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-stone-100 bg-paper-100 p-3 dark:border-stone-800 dark:bg-stone-800">
                <span class="shared-queue-number grid h-10 w-10 place-items-center rounded-md bg-stone-900 text-sm font-black text-white dark:bg-white dark:text-stone-900">#{{ index + 1 }}</span>
                <div class="min-w-0">
                  <p class="truncate text-sm font-black">เกมที่ {{ match.id }}</p>
                  <p class="shared-match-meta truncate text-xs font-bold text-stone-500 dark:text-stone-400">ระดับ {{ matchLevelLabel(match) }} · รอเลือกสนาม</p>
                </div>
                <UsersRound class="shared-match-icon h-5 w-5 text-court-600 dark:text-court-300" />
              </div>
              <div class="shared-team-grid grid gap-2 p-3 sm:grid-cols-2">
                <div class="shared-team-box rounded-md border border-stone-100 p-3 dark:border-stone-800">
                  <p class="text-xs font-black text-stone-500 dark:text-stone-400">ทีม A</p>
                  <p class="shared-team-name mt-1 text-lg font-black">{{ teamText(match, 'A') }}</p>
                </div>
                <div class="shared-team-box rounded-md border border-stone-100 p-3 dark:border-stone-800">
                  <p class="text-xs font-black text-stone-500 dark:text-stone-400">ทีม B</p>
                  <p class="shared-team-name mt-1 text-lg font-black">{{ teamText(match, 'B') }}</p>
                </div>
              </div>
            </article>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.shared-queue-content,
.shared-queue-column,
.shared-match-grid {
  display: grid;
  gap: 0.75rem;
}

@media (min-width: 1100px) and (min-aspect-ratio: 4 / 3) {
  .shared-queue-page {
    height: 100dvh;
    min-height: 0;
    overflow: hidden;
    padding: clamp(0.75rem, 1.2vw, 1.5rem);
  }

  .shared-queue-shell {
    width: 100%;
    max-width: none;
    height: 100%;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr);
    gap: clamp(0.65rem, 1vw, 1rem);
  }

  .shared-queue-summary {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(27rem, 38vw);
  }

  .shared-queue-hero {
    display: flex;
    min-width: 0;
    flex-direction: column;
    justify-content: center;
    padding: clamp(0.8rem, 1.2vw, 1.3rem);
  }

  .shared-queue-hero > p {
    font-size: clamp(0.65rem, 0.75vw, 0.8rem);
  }

  .shared-queue-hero h1 {
    font-size: clamp(1.5rem, 2vw, 2.35rem);
  }

  .shared-queue-hero > div {
    margin-top: 0.35rem;
  }

  .shared-queue-hero > div > div > p {
    font-size: clamp(0.75rem, 0.9vw, 1rem);
  }

  .shared-queue-stats {
    border-bottom: 0;
    border-left: 1px solid rgb(231 229 228);
  }

  :global(.dark) .shared-queue-stats {
    border-left-color: rgb(68 64 60);
  }

  .shared-queue-stat {
    display: flex;
    min-width: 0;
    flex-direction: column;
    justify-content: center;
    padding: clamp(0.7rem, 1vw, 1rem);
  }

  .shared-queue-stat p:first-child {
    font-size: clamp(0.65rem, 0.75vw, 0.8rem);
  }

  .shared-queue-stat p:last-child {
    margin-top: 0.15rem;
    font-size: clamp(1.5rem, 2vw, 2.25rem);
  }

  .shared-queue-content {
    height: 100%;
    min-height: 0;
    align-self: start;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: var(--tv-content-rows, repeat(2, minmax(0, 1fr)));
    gap: clamp(0.6rem, 0.8vw, 0.9rem);
  }

  .shared-queue-content--waiting-only {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }

  .shared-queue-column {
    min-width: 0;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 0.5rem;
    overflow: hidden;
  }

  .shared-queue-section-title {
    min-height: 2rem;
  }

  .shared-queue-section-title::after {
    height: 1px;
    flex: 1;
    content: '';
    background: linear-gradient(90deg, rgb(120 113 108 / 35%), transparent);
  }

  .shared-live-column .shared-queue-section-title {
    color: rgb(20 184 166);
  }

  .shared-waiting-column .shared-queue-section-title {
    color: rgb(245 158 11);
  }

  .shared-queue-section-title h2 {
    font-size: clamp(1.35rem, 3.2vmin, 2rem);
  }

  .shared-match-grid {
    min-width: 0;
    min-height: 0;
    grid-template-columns: repeat(var(--tv-grid-columns), minmax(0, 1fr));
    grid-template-rows: repeat(var(--tv-grid-rows), minmax(0, 1fr));
    gap: clamp(0.45rem, 0.65vw, 0.75rem);
  }

  .shared-match-card {
    display: flex;
    min-width: 0;
    min-height: 0;
    height: 100%;
    flex-direction: column;
    border-radius: 1rem;
    box-shadow: 0 10px 28px rgb(0 0 0 / 8%);
  }

  .shared-live-card {
    border-top: 3px solid rgb(45 212 191 / 85%);
  }

  .shared-waiting-card {
    border-top: 3px solid rgb(251 191 36 / 80%);
  }

  .shared-match-header {
    min-height: 0;
    padding: clamp(0.45rem, 0.65vw, 0.75rem);
  }

  .shared-match-header p:first-child {
    font-size: clamp(1rem, 2.1vmin, 1.4rem);
  }

  .shared-queue-number {
    width: clamp(2rem, 2.5vw, 2.75rem);
    height: clamp(2rem, 2.5vw, 2.75rem);
    font-size: clamp(0.9rem, 2vmin, 1.15rem);
    background: rgb(245 158 11);
    color: rgb(28 25 23);
  }

  .shared-match-meta {
    font-size: clamp(0.85rem, 1.75vmin, 1.05rem);
  }

  .shared-live-badge {
    font-size: clamp(0.75rem, 1.6vmin, 0.9rem);
  }

  .shared-elapsed {
    padding: clamp(0.3rem, 0.4vw, 0.45rem) clamp(0.45rem, 0.65vw, 0.75rem);
    font-size: clamp(0.9rem, 1.9vmin, 1.1rem);
    background: rgb(20 184 166 / 6%);
  }

  .shared-team-grid {
    position: relative;
    min-height: 0;
    flex: 1;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: clamp(0.55rem, 0.7vw, 0.8rem);
    gap: clamp(0.55rem, 0.7vw, 0.8rem);
  }

  .shared-team-grid::after {
    position: absolute;
    top: 50%;
    left: 50%;
    z-index: 2;
    display: grid;
    width: clamp(1.8rem, 2.2vw, 2.5rem);
    height: clamp(1.8rem, 2.2vw, 2.5rem);
    place-items: center;
    border: 1px solid rgb(120 113 108 / 35%);
    border-radius: 999px;
    background: rgb(28 25 23);
    color: rgb(255 255 255 / 85%);
    content: 'VS';
    font-size: clamp(0.55rem, 0.65vw, 0.7rem);
    font-weight: 900;
    transform: translate(-50%, -50%);
  }

  .shared-team-box {
    position: relative;
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    justify-content: center;
    overflow: hidden;
    padding: clamp(0.4rem, 0.55vw, 0.65rem);
    border: 1px solid transparent;
    border-radius: 0.8rem;
    text-align: center;
  }

  .shared-team-box:first-child {
    border-color: rgb(45 212 191 / 22%);
    background: rgb(45 212 191 / 7%);
  }

  .shared-team-box:last-child {
    border-color: rgb(251 191 36 / 22%);
    background: rgb(251 191 36 / 7%);
  }

  .shared-team-box > p:first-child {
    position: absolute;
    top: clamp(0.25rem, 0.35vw, 0.4rem);
    left: clamp(0.35rem, 0.5vw, 0.6rem);
    z-index: 1;
    margin: 0;
    font-size: clamp(0.75rem, 1.6vmin, 0.95rem);
  }

  .shared-team-name {
    display: -webkit-box;
    overflow: hidden;
    margin-top: 0;
    font-size: var(--tv-team-name-size, clamp(2.25rem, 2.8vw, 3.4rem));
    font-weight: 800;
    letter-spacing: -0.025em;
    line-height: 1;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .shared-empty-queue {
    display: grid;
    min-height: 0;
    place-content: center;
  }

  .shared-queue-page--sparse .shared-match-grid {
    grid-template-rows: repeat(var(--tv-grid-rows), clamp(12rem, 24vh, 16rem));
    align-content: start;
  }

  .shared-queue-page--sparse .shared-team-name {
    font-size: clamp(2.2rem, 4.5vmin, 3.5rem);
  }

  .shared-queue-page--dense .shared-queue-hero,
  .shared-queue-page--dense .shared-queue-stat {
    padding-block: 0.55rem;
  }

  .shared-queue-page--compact .shared-queue-content,
  .shared-queue-page--dense .shared-queue-content {
    height: 100%;
  }

  .shared-queue-page--compact .shared-team-name {
    font-size: clamp(1.3rem, 2.8vmin, 2rem);
  }

  .shared-queue-page--dense .shared-match-header,
  .shared-queue-page--dense .shared-team-box {
    padding: 0.35rem;
  }

  .shared-queue-page--dense .shared-match-icon,
  .shared-queue-page--dense .shared-live-badge,
  .shared-queue-page--dense .shared-team-grid::after {
    display: none;
  }

  .shared-queue-page--dense .shared-team-name {
    font-size: clamp(0.78rem, 1.8vmin, 1rem);
    -webkit-line-clamp: 1;
  }
}
</style>
