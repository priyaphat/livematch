<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import QRCode from 'qrcode'
import '@fontsource/dseg7/700.css'
import { Activity, Clock3, ListOrdered, Medal, UsersRound } from '@lucide/vue'
import { waitMinutes } from '../waitTime'

const props = defineProps([
  'state',
  'share',
  'shareLink',
  'playerName',
  'matchLevelLabel'
])

const waitingMatches = computed(() => [...props.state.queue].sort((a, b) => a.id - b.id))
const liveMatches = computed(() => [...props.state.live].sort((a, b) => a.id - b.id))
const desktopLiveMatches = computed(() => liveMatches.value)
const matchIntro = ref(null)
const pendingMatchIntros = []
let observedAnnouncementSession = ''
let observedAnnouncementSequence = 0
const occupiedPlayerIds = computed(() => new Set(
  [...(props.state.queue || []), ...(props.state.live || [])]
    .flatMap((match) => [match.a1, match.a2, match.b1, match.b2])
    .map(Number)
    .filter((id) => id > 0)
))
const pendingPlayerIds = computed(() => new Set(
  (props.state.pending || [])
    .flatMap((match) => [match.a1, match.a2, match.b1, match.b2])
    .map(Number)
    .filter((id) => id > 0)
))
const waitingPlayers = computed(() => (props.state.players || [])
  .filter((player) => player.active && (player.coupon || pendingPlayerIds.value.has(Number(player.id))) && !occupiedPlayerIds.value.has(Number(player.id)))
  .sort((a, b) => Number(a.id) - Number(b.id)))
const showWaitingPlayerTime = computed(() => props.state.settings?.showWaitTimePairing !== false)
const waitingPlayerColumnCount = computed(() => Math.max(1, Math.ceil(waitingPlayers.value.length / 10)))
const waitingPlayerColumns = computed(() => {
  const size = Math.ceil(waitingPlayers.value.length / waitingPlayerColumnCount.value)
  return Array.from({ length: waitingPlayerColumnCount.value }, (_, index) => ({
    offset: index * size,
    players: waitingPlayers.value.slice(index * size, (index + 1) * size)
  })).filter((column) => column.players.length)
})
const showWaitingSlide = ref(false)
const showMobileCoupons = ref(false)
const totalVisibleMatches = computed(() => waitingMatches.value.length + liveMatches.value.length)
const tvDensityClass = computed(() => {
  if (totalVisibleMatches.value <= 2) return 'shared-queue-page--sparse'
  if (totalVisibleMatches.value > 16) return 'shared-queue-page--dense'
  if (totalVisibleMatches.value > 8) return 'shared-queue-page--compact'
  return 'shared-queue-page--comfortable'
})
const now = ref(new Date())
const queueClockFormatter = new Intl.DateTimeFormat('th-TH-u-nu-latn', {
  timeZone: 'Asia/Bangkok',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
})
const queueNavbarClock = computed(() => queueClockFormatter.format(now.value))
const queueQrDataUrl = ref('')
let elapsedTimer = null
let fadeTimer = null
let matchIntroTimer = null
let matchIntroGapTimer = null
let qrRequestSequence = 0

function matchPlayerCards(match) {
  return [
    { id: Number(match.a1 || 0), side: 'A', slot: 'A1' },
    { id: Number(match.a2 || 0), side: 'A', slot: 'A2' },
    { id: Number(match.b1 || 0), side: 'B', slot: 'B1' },
    { id: Number(match.b2 || 0), side: 'B', slot: 'B2' }
  ]
    .filter((player) => player.id > 0)
    .map((player) => {
      const detail = (props.state.players || []).find((item) => Number(item.id) === player.id)
      return { ...player, name: detail?.name || props.playerName(player.id), avatarUrl: detail?.avatarUrl || '' }
    })
}

function showNextMatchIntro() {
  if (matchIntro.value || !pendingMatchIntros.length) return
  matchIntro.value = pendingMatchIntros.shift()
  showWaitingSlide.value = false
  matchIntroTimer = window.setTimeout(() => {
    matchIntro.value = null
    matchIntroGapTimer = window.setTimeout(showNextMatchIntro, 900)
  }, 5000)
}

watch(
  () => [
    Boolean(props.share.loading),
    String(props.state.session?.id || ''),
    Number(props.state.queueAnnouncement?.sequence || 0)
  ],
  ([loading, sessionId, sequence]) => {
    if (loading) return
    if (observedAnnouncementSession !== sessionId) {
      observedAnnouncementSession = sessionId
      observedAnnouncementSequence = sequence
      return
    }
    if (sequence <= observedAnnouncementSequence) return
    observedAnnouncementSequence = sequence
    if (props.state.settings?.matchStartAnimationEnabled === false) return

    const announcement = props.state.queueAnnouncement || {}
    const matchId = Number(announcement.matchId || 0)
    const match = [...waitingMatches.value, ...liveMatches.value].find((item) => Number(item.id) === matchId)
    if (!match) return
    const players = matchPlayerCards(match)
    pendingMatchIntros.push({
      ...match,
      court: announcement.court || match.court,
      players,
      isSingles: players.filter((player) => player.side === 'A').length === 1 && players.filter((player) => player.side === 'B').length === 1,
      courtLabel: announcement.court || matchCourt(match)
    })
    showNextMatchIntro()
  },
  { immediate: true }
)

watch(() => props.shareLink, async (link) => {
  const sequence = ++qrRequestSequence
  if (!link) {
    queueQrDataUrl.value = ''
    return
  }
  try {
    const dataUrl = await QRCode.toDataURL(link, {
      width: 360,
      margin: 2,
      color: { dark: '#191b18', light: '#fbfaf4' }
    })
    if (sequence === qrRequestSequence) queueQrDataUrl.value = dataUrl
  } catch {
    if (sequence === qrRequestSequence) queueQrDataUrl.value = ''
  }
}, { immediate: true })

onMounted(() => {
  elapsedTimer = window.setInterval(() => {
    now.value = new Date()
  }, 1000)
  fadeTimer = window.setInterval(() => {
    if (matchIntro.value) {
      showWaitingSlide.value = false
    } else if (props.state.settings.showWaitingOnQueueShare && waitingPlayers.value.length) {
      showWaitingSlide.value = !showWaitingSlide.value
    } else {
      showWaitingSlide.value = false
    }
  }, 10000)
})

onUnmounted(() => {
  if (elapsedTimer) window.clearInterval(elapsedTimer)
  if (fadeTimer) window.clearInterval(fadeTimer)
  if (matchIntroTimer) window.clearTimeout(matchIntroTimer)
  if (matchIntroGapTimer) window.clearTimeout(matchIntroGapTimer)
})

watch(() => props.state.settings.showWaitingOnQueueShare, (enabled) => {
  if (!enabled) {
    showWaitingSlide.value = false
    showMobileCoupons.value = false
  }
})

watch(() => props.state.settings?.matchStartAnimationEnabled, (enabled) => {
  if (enabled !== false) return
  if (matchIntroTimer) window.clearTimeout(matchIntroTimer)
  if (matchIntroGapTimer) window.clearTimeout(matchIntroGapTimer)
  matchIntroTimer = null
  matchIntroGapTimer = null
  pendingMatchIntros.splice(0)
  matchIntro.value = null
})

watch(() => waitingPlayers.value.length, (count) => {
  if (!count) showMobileCoupons.value = false
})

function teamText(match, side) {
  return (side === 'A' ? [match.a1, match.a2] : [match.b1, match.b2])
    .filter((id) => Number(id) > 0)
    .map((id) => props.playerName(id))
    .join(' + ')
}

function matchCourt(match) {
  return match.court && match.court !== '-' ? match.court : 'รอเลือกสนาม'
}

function showcaseCourtLabel(value) {
  const label = String(value || '').trim()
  if (!label || label === 'รอเลือกสนาม') return 'COURT TBA'
  const courtName = label.replace(/^สนาม\s*/i, '').replace(/^court\s*/i, '').trim()
  return `COURT ${courtName || label}`
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

function waitingPlayerTime(player) {
  const minutes = waitMinutes(player?.waitStartedAt, now.value.getTime())
  if (minutes === null) return '-'
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours > 0) return `${hours} ชม. ${remainingMinutes} นาที`
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
    <div class="shared-flight-board relative mx-auto hidden min-h-[calc(100dvh-2rem)] w-full max-w-[1600px] flex-col overflow-hidden rounded-xl border border-stone-700 bg-[#171a18] text-white shadow-2xl md:flex">
      <header class="shared-flight-header grid min-h-[4.25rem] shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-5 border-b border-white/10 bg-[#222725] px-4 py-2.5">
        <div class="flex min-w-0 items-center gap-3">
          <h1 class="truncate text-lg font-black lg:text-xl">{{ state.session.name }}</h1>
          <span class="text-stone-300">•</span>
          <p class="truncate text-xs font-semibold text-white/55 lg:text-sm">ลำดับคิวลงสนามและเกมที่กำลังแข่งขัน</p>
        </div>
        <div data-testid="shared-queue-navbar-clock" class="shared-navbar-clock grid h-13 min-w-[12rem] place-items-center px-2 lg:min-w-[13.25rem]">
          <span aria-hidden="true" class="shared-navbar-clock-segments">88:88:88</span>
          <time class="shared-navbar-clock-time tabular-nums" :datetime="now.toISOString()">{{ queueNavbarClock }}</time>
        </div>
        <div class="shared-flight-summary-slot grid h-13 w-[22rem] shrink-0 place-items-center justify-self-end lg:w-[28rem]">
        <Transition name="queue-fade" mode="out-in">
        <div v-if="showWaitingSlide" key="waiting-summary" class="shared-flight-waiting-summary flex h-12 w-full min-w-0 flex-col justify-center text-right">
          <p class="text-[10px] font-black uppercase tracking-[0.12em] text-court-700">Waiting list</p>
          <h2 class="mt-0.5 truncate text-base font-black text-stone-900 lg:text-lg">รายชื่อคนที่ยังรอจับคู่ {{ waitingPlayers.length }} คน</h2>
        </div>
        <div v-else key="match-summary" class="shared-flight-stats grid h-13 w-full shrink-0 grid-cols-3 divide-x divide-white/10 overflow-hidden rounded-lg border border-white/10 bg-black/15 text-center">
          <div class="px-4 py-1.5">
            <p class="text-[11px] font-bold text-white/50">รอแข่งขัน</p>
            <p class="mt-0.5 text-xl font-black text-amber-300">{{ waitingMatches.length }}</p>
          </div>
          <div class="px-4 py-1.5">
            <p class="text-[11px] font-bold text-white/50">กำลังแข่งขัน</p>
            <p class="mt-0.5 text-xl font-black text-court-300">{{ liveMatches.length }}</p>
          </div>
          <div class="px-4 py-1.5">
            <p class="text-[11px] font-bold text-white/50">สนาม</p>
            <p class="mt-0.5 text-xl font-black">{{ state.settings.courtNames.length }}</p>
          </div>
        </div>
        </Transition>
        </div>
      </header>

      <div v-if="share.loading" class="grid flex-1 place-items-center p-8 text-lg font-bold text-white/60">กำลังโหลดข้อมูล</div>
      <div v-else-if="share.error" class="m-5 rounded-lg border border-red-400/40 bg-red-500/10 p-4 font-bold text-red-200">{{ share.error }}</div>
      <Transition v-else name="queue-fade" mode="out-in">
      <div v-if="showWaitingSlide" key="waiting-players" class="shared-waiting-people min-h-0 flex-1 overflow-hidden bg-[#fbfaf4] text-stone-900">
        <div class="grid gap-x-4" :style="{ gridTemplateColumns: `repeat(${waitingPlayerColumns.length}, minmax(0, 1fr))` }">
          <div v-for="column in waitingPlayerColumns" :key="column.offset" class="shared-coupon-list overflow-hidden border-y border-stone-300 bg-white">
            <div :class="['shared-flight-columns coupon-flight-columns grid bg-[#eeeae0] px-4 py-2.5 text-xs font-black text-stone-600', { 'coupon-flight-columns--with-wait': showWaitingPlayerTime }]">
              <span>เลขสมาชิก</span><span>ผู้เล่น</span><span>ระดับ</span><span>สถานะ</span><span v-if="showWaitingPlayerTime">เวลาที่รอ</span>
            </div>
            <article v-for="player in column.players" :key="player.id" :class="['shared-flight-row coupon-flight-row grid min-h-12 items-center border-t border-stone-200 px-4 py-1.5', { 'coupon-flight-row--with-wait': showWaitingPlayerTime }]">
              <span class="font-black text-court-700">#{{ player.id }}</span><p class="coupon-player-name flex min-w-0 items-center gap-2"><span class="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-court-500/10 text-court-700"><img v-if="player.avatarUrl" :src="player.avatarUrl" alt="" class="h-full w-full object-cover" /><UsersRound v-else class="h-4 w-4" /></span><span class="truncate">{{ player.name }}</span></p><p class="truncate text-sm font-bold text-stone-600">{{ player.level || '-' }}</p><span><span v-if="pendingPlayerIds.has(Number(player.id))" class="coupon-pending-badge">กำลังจับคู่</span></span><span v-if="showWaitingPlayerTime" class="coupon-wait-time">รอ {{ waitingPlayerTime(player) }}</span>
            </article>
          </div>
        </div>
      </div>
      <div v-else key="matches" class="shared-flight-scroll min-h-0 flex-1 overflow-y-auto pb-44">
        <div class="shared-flight-columns sticky top-0 z-10 grid border-b border-white/15 bg-[#101312] px-4 py-3 text-xs font-black uppercase tracking-[0.1em] text-white/55">
          <span>สถานะ</span><span>คิว</span><span>ทีม A</span><span>ทีม B</span><span>สนาม</span><span>เวลา</span>
        </div>

        <section v-if="liveMatches.length" class="shared-flight-section">
          <div class="shared-flight-section-label border-b border-court-300/20 bg-court-500/10 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-court-200">กำลังแข่งขัน</div>
          <TransitionGroup name="live-start" tag="div" class="shared-flight-transition-list">
            <article v-for="match in desktopLiveMatches" :key="`match-${match.id}`" class="shared-flight-row shared-flight-row--live grid items-center border-b border-white/10 px-4 py-1.5">
              <span class="shared-flight-status bg-court-400/15 text-court-200"><span class="h-2 w-2 rounded-full bg-court-300"></span>เริ่ม {{ match.startedAt || '-' }}</span>
              <span class="text-center text-sm font-black text-white/30">–</span>
              <p class="shared-flight-team">{{ teamText(match, 'A') }}</p>
              <p class="shared-flight-team">{{ teamText(match, 'B') }}</p>
              <p class="font-black text-court-200">{{ matchCourt(match) }}</p>
              <p class="text-xs font-bold text-white/50">เล่นมาแล้ว {{ elapsedTime(match) }}</p>
            </article>
          </TransitionGroup>
        </section>

        <section v-if="waitingMatches.length" class="shared-flight-section">
          <div class="shared-flight-section-label border-b border-amber-300/20 bg-amber-400/10 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-amber-200">รอคิวลงสนาม</div>
          <TransitionGroup name="queue-bout" tag="div" class="shared-flight-transition-list">
            <article
              v-for="(match, index) in waitingMatches"
              :key="`match-${match.id}`"
              class="shared-flight-row shared-flight-row--waiting shared-fight-entry grid items-center border-b border-white/10 px-4 py-1.5"
              :class="{ 'shared-next-fight-row': index === 0 }"
              :style="{ '--fight-index': index }"
            >
              <span class="shared-flight-status bg-amber-300/15 text-amber-200"><span class="h-2 w-2 rounded-full bg-amber-300"></span>{{ index === 0 ? 'คู่ถัดไป' : 'รอคิว' }}</span>
              <p class="text-center text-base font-black text-amber-200">#{{ index + 1 }}</p>
              <p class="shared-flight-team shared-fighter-name shared-fighter-name--a">{{ teamText(match, 'A') }}</p>
              <p class="shared-flight-team shared-fighter-name shared-fighter-name--b">{{ teamText(match, 'B') }}</p>
              <p class="font-black" :class="match.court && match.court !== '-' ? 'text-white' : 'text-white/45'">{{ matchCourt(match) }}</p>
              <p class="text-sm font-bold text-white/45">รอเรียกลงสนาม</p>
            </article>
          </TransitionGroup>
        </section>

        <div v-if="!liveMatches.length && !waitingMatches.length" class="grid min-h-72 place-content-center text-center">
          <Medal class="mx-auto h-12 w-12 text-white/20" />
          <p class="mt-3 text-xl font-black">ยังไม่มีคิวรอลงสนาม</p>
          <p class="mt-1 font-semibold text-white/45">รายการจะแสดงอัตโนมัติเมื่อผู้ดูแลจัดคู่</p>
        </div>
      </div>
      </Transition>

      <Transition name="match-showcase">
        <div
          v-if="matchIntro"
          class="match-start-showcase absolute inset-0 z-50 hidden items-center justify-center overflow-hidden md:flex"
          role="status"
          aria-live="assertive"
          data-testid="match-start-showcase"
        >
          <div class="match-showcase-rays" aria-hidden="true"></div>
          <div class="match-showcase-arena" aria-hidden="true"></div>
          <div class="match-showcase-content relative z-10 w-full max-w-6xl px-8">
            <div class="match-showcase-heading text-center">
              <p class="match-showcase-kicker">NOW CALLING</p>
              <h2>MATCH {{ matchIntro.id }}</h2>
              <div class="match-showcase-court"><Activity class="h-5 w-5" /> {{ showcaseCourtLabel(matchIntro.courtLabel) }}</div>
            </div>

            <div class="match-showcase-lineup" :class="{ 'match-showcase-lineup--singles': matchIntro.isSingles }">
              <div class="match-showcase-team match-showcase-team--a">
                <article
                  v-for="(player, index) in matchIntro.players.filter((item) => item.side === 'A')"
                  :key="`intro-${matchIntro.id}-${player.slot}`"
                  class="match-showcase-player match-showcase-player--a"
                  :style="{ '--player-delay': `${index * 120}ms` }"
                >
                  <span class="match-showcase-portrait">
                    <img v-if="player.avatarUrl" :src="player.avatarUrl" :alt="player.name" class="match-showcase-portrait-image" />
                    <span v-else class="match-showcase-portrait-fallback"><UsersRound class="h-14 w-14" /></span>
                  </span>
                  <span class="match-showcase-nameplate"><small>PLAYER {{ player.slot }}</small><strong>{{ player.name }}</strong></span>
                </article>
              </div>

              <div class="match-showcase-versus" aria-label="พบกัน">
                <span>VS</span>
              </div>

              <div class="match-showcase-team match-showcase-team--b">
                <article
                  v-for="(player, index) in matchIntro.players.filter((item) => item.side === 'B')"
                  :key="`intro-${matchIntro.id}-${player.slot}`"
                  class="match-showcase-player match-showcase-player--b"
                  :style="{ '--player-delay': `${index * 120}ms` }"
                >
                  <span class="match-showcase-portrait">
                    <img v-if="player.avatarUrl" :src="player.avatarUrl" :alt="player.name" class="match-showcase-portrait-image" />
                    <span v-else class="match-showcase-portrait-fallback"><UsersRound class="h-14 w-14" /></span>
                  </span>
                  <span class="match-showcase-nameplate"><small>PLAYER {{ player.slot }}</small><strong>{{ player.name }}</strong></span>
                </article>
              </div>
            </div>
            <p class="match-showcase-status">PLEASE REPORT TO COURT</p>
          </div>
        </div>
      </Transition>

      <aside v-if="queueQrDataUrl" class="shared-queue-qr fixed bottom-4 right-4 z-30 hidden rounded-xl border border-stone-200 bg-white p-2.5 text-center text-stone-900 shadow-2xl md:block" data-testid="shared-queue-qr">
        <img :src="queueQrDataUrl" class="mx-auto aspect-square w-[120px]" alt="QR สำหรับเปิดคิวบนมือถือ" />
        <p class="mt-1 max-w-[120px] text-[11px] font-black leading-tight">สแกนดูคิวบนมือถือ</p>
      </aside>
    </div>

    <div class="shared-queue-shell mx-auto grid max-w-3xl gap-4 md:hidden">
      <div class="shared-queue-summary overflow-hidden rounded-lg border border-stone-200 bg-white shadow-soft dark:border-stone-700 dark:bg-stone-900">
        <div class="shared-queue-hero bg-[linear-gradient(135deg,#1f8a70_0%,#2f7f8f_58%,#20251f_100%)] p-4 text-white">
          <p class="text-xs font-black uppercase tracking-[0.16em] text-white/75">LiveMatch Queue</p>
          <div class="mt-2 flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="flex min-w-0 items-center gap-2">
                <h1 class="shrink-0 text-xl font-black leading-tight">{{ state.session.name }}</h1>
                <span class="text-current/40">•</span>
                <p class="truncate text-xs font-semibold">ลำดับคิวลงสนามและเกมที่กำลังแข่งขัน</p>
              </div>
            </div>
            <button
              v-if="state.settings.showWaitingOnQueueShare && waitingPlayers.length"
              class="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-white/15 text-current ring-1 ring-white/20"
              type="button"
              :title="showMobileCoupons ? 'ดูคิว' : 'ดูคูปอง'"
              :aria-label="showMobileCoupons ? 'ดูคิว' : 'ดูคูปอง'"
              @click="showMobileCoupons = !showMobileCoupons"
            >
              <ListOrdered v-if="showMobileCoupons" class="h-6 w-6" />
              <UsersRound v-else class="h-6 w-6" />
            </button>
            <div v-else class="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-white/15 ring-1 ring-white/20">
              <ListOrdered class="h-6 w-6" />
            </div>
          </div>
        </div>

        <Transition name="queue-fade" mode="out-in">
        <div v-if="showMobileCoupons && state.settings.showWaitingOnQueueShare" key="mobile-waiting-summary" class="mobile-waiting-summary flex min-h-[4.1rem] items-center justify-between bg-[#cfeae2] px-4 py-2.5">
          <div><p class="text-[10px] font-black uppercase tracking-[0.12em]">Waiting list</p><h2 class="mt-0.5 text-base font-black">รายชื่อคนที่ยังรอจับคู่ {{ waitingPlayers.length }} คน</h2></div>
          <UsersRound class="h-6 w-6" />
        </div>
        <div v-else key="mobile-match-summary" class="shared-queue-stats grid min-h-[4.1rem] grid-cols-3 divide-x divide-stone-100 border-b border-stone-100 dark:divide-stone-800 dark:border-stone-800">
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
        </Transition>
      </div>

      <div v-if="share.loading" class="rounded-lg border border-stone-200 bg-white p-4 text-sm font-semibold text-stone-500 dark:border-stone-700 dark:bg-stone-900">
        กำลังโหลดข้อมูล
      </div>

      <div v-else-if="share.error" class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
        {{ share.error }}
      </div>

      <template v-else>
      <div v-if="showMobileCoupons && state.settings.showWaitingOnQueueShare" class="mobile-coupon-board min-h-0 overflow-hidden rounded-xl bg-white">
        <div class="mobile-coupon-columns grid bg-[#f0ede5] px-4 py-2 text-xs font-black text-stone-600">
          <span>เลขสมาชิก</span><span>ผู้เล่น</span><span>ระดับ</span><span>{{ showWaitingPlayerTime ? 'สถานะ / เวลารอ' : 'สถานะ' }}</span>
        </div>
        <div class="mobile-coupon-scroll max-h-[calc(100dvh-15rem)] overflow-y-auto">
          <article v-for="player in waitingPlayers" :key="player.id" class="mobile-coupon-row grid min-h-14 items-center px-4 py-2">
            <span class="text-sm font-black text-court-700">#{{ player.id }}</span>
            <p class="mobile-coupon-name coupon-player-name truncate">{{ player.name }}</p>
            <p class="mobile-coupon-level truncate text-sm font-bold">{{ player.level || '-' }}</p>
            <span class="grid gap-0.5"><span v-if="pendingPlayerIds.has(Number(player.id))" class="coupon-pending-badge">กำลังจับคู่</span><span v-if="showWaitingPlayerTime" class="coupon-wait-time">รอ {{ waitingPlayerTime(player) }}</span></span>
          </article>
        </div>
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
      </template>
    </div>
  </section>
</template>

<style scoped>
.queue-fade-enter-active,
.queue-fade-leave-active { transition: opacity 0.65s ease; }
.queue-fade-enter-from,
.queue-fade-leave-to { opacity: 0; }

.match-start-showcase {
  background: rgb(39 39 42 / 72%);
  backdrop-filter: blur(5px) saturate(0.72);
  color: #fff;
  font-family: 'Arial Black', Arial, sans-serif;
  isolation: isolate;
}

.match-start-showcase::before,
.match-start-showcase::after {
  position: absolute;
  inset: -30%;
  content: '';
  pointer-events: none;
}

.match-start-showcase::before {
  background: repeating-conic-gradient(from 20deg, rgb(255 255 255 / 7%) 0deg 1.2deg, transparent 1.2deg 12deg);
  mask-image: radial-gradient(circle, #000 0 38%, transparent 70%);
  animation: showcase-rays-spin 12s linear infinite;
}

.match-start-showcase::after {
  background: linear-gradient(90deg, transparent 0 40%, rgb(255 255 255 / 13%) 49%, rgb(255 255 255 / 36%) 50%, rgb(255 255 255 / 13%) 51%, transparent 60% 100%);
  transform: skewX(-18deg) translateX(-85%);
  animation: showcase-flash-sweep 1.15s 0.25s ease-out both;
}

.match-showcase-rays {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(105deg, transparent 0 44%, rgb(255 255 255 / 10%) 49%, transparent 54%),
    linear-gradient(75deg, transparent 0 44%, rgb(255 255 255 / 7%) 49%, transparent 54%);
  animation: showcase-energy 2.2s ease-in-out infinite alternate;
}

.match-showcase-arena {
  position: absolute;
  right: 6%;
  bottom: -20%;
  left: 6%;
  height: 52%;
  border: 2px solid rgb(255 255 255 / 13%);
  background:
    linear-gradient(90deg, transparent 49.7%, rgb(255 255 255 / 18%) 50%, transparent 50.3%),
    linear-gradient(rgb(255 255 255 / 12%) 1px, transparent 1px),
    linear-gradient(90deg, rgb(255 255 255 / 12%) 1px, transparent 1px),
    rgb(63 63 70 / 14%);
  background-size: 100% 100%, 52px 52px, 52px 52px, 100% 100%;
  box-shadow: 0 0 60px rgb(255 255 255 / 8%);
  transform: perspective(680px) rotateX(62deg);
}

.match-showcase-heading {
  animation: showcase-title-drop 0.55s cubic-bezier(0.18, 0.9, 0.2, 1.1) both;
}

.match-showcase-kicker {
  color: #86efac;
  font-size: clamp(0.78rem, 1vw, 1rem);
  font-weight: 1000;
  letter-spacing: 0.38em;
  text-shadow: 0 0 18px rgb(74 222 128 / 70%);
}

.match-showcase-heading h2 {
  margin-top: 0.15rem;
  font-size: clamp(2rem, 4.8vw, 4.4rem);
  font-weight: 1000;
  letter-spacing: 0.055em;
  line-height: 1;
  text-shadow: 0 8px 30px rgb(0 0 0 / 65%);
}

.match-showcase-court {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  margin-top: 0.7rem;
  border: 1px solid rgb(255 255 255 / 24%);
  border-radius: 999px;
  background: rgb(0 0 0 / 34%);
  padding: 0.42rem 1rem;
  color: #fef3c7;
  font-size: clamp(0.95rem, 1.3vw, 1.2rem);
  font-weight: 900;
  letter-spacing: 0.075em;
  backdrop-filter: blur(8px);
}

.match-showcase-lineup {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: clamp(1rem, 3vw, 3.2rem);
  margin-top: clamp(1.5rem, 4vh, 3rem);
}

.match-showcase-team {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: clamp(0.7rem, 1.4vw, 1.2rem);
}

.match-showcase-lineup--singles .match-showcase-team {
  grid-template-columns: minmax(0, min(15rem, 100%));
  justify-content: center;
}

.match-showcase-lineup--singles .match-showcase-player {
  width: min(15rem, 100%);
  justify-self: center;
}

.match-showcase-player {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: clamp(15rem, 34vh, 20rem);
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 22%);
  border-radius: 1.15rem 1.15rem 0.45rem 0.45rem;
  padding: 0;
  box-shadow: 0 22px 55px rgb(0 0 0 / 48%);
  animation-duration: 0.72s;
  animation-delay: calc(0.2s + var(--player-delay));
  animation-timing-function: cubic-bezier(0.16, 0.9, 0.22, 1.08);
  animation-fill-mode: both;
}

.match-showcase-player--a {
  background: linear-gradient(155deg, rgb(14 165 233 / 46%), rgb(8 47 73 / 88%) 62%, rgb(2 20 31 / 96%));
  animation-name: showcase-card-from-left;
}

.match-showcase-player--b {
  background: linear-gradient(155deg, rgb(245 158 11 / 46%), rgb(120 53 15 / 88%) 62%, rgb(35 20 3 / 96%));
  animation-name: showcase-card-from-right;
}

.match-showcase-player::before {
  position: absolute;
  inset: 0;
  background: linear-gradient(120deg, transparent 15%, rgb(255 255 255 / 18%) 48%, transparent 65%);
  content: '';
  z-index: 4;
  transform: translateX(-120%);
  animation: showcase-card-shine 1.5s calc(0.65s + var(--player-delay)) ease-out both;
}

.match-showcase-portrait {
  position: absolute;
  inset: 0;
  display: block;
}

.match-showcase-portrait::after {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 35%, rgb(0 0 0 / 18%) 58%, rgb(0 0 0 / 92%) 100%);
  content: '';
}

.match-showcase-portrait-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 22%;
}

.match-showcase-portrait-fallback {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  background:
    radial-gradient(circle at 50% 38%, rgb(255 255 255 / 20%), transparent 24%),
    linear-gradient(145deg, rgb(255 255 255 / 8%), rgb(0 0 0 / 26%));
  color: rgb(255 255 255 / 72%);
}

.match-showcase-nameplate {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 3;
  display: grid;
  gap: 0.2rem;
  padding: 2.8rem 0.8rem 1rem;
  background: linear-gradient(180deg, transparent, rgb(0 0 0 / 88%));
  text-align: center;
}

.match-showcase-nameplate small {
  color: rgb(255 255 255 / 62%);
  font-family: 'Arial Black', Arial, sans-serif;
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.18em;
}

.match-showcase-nameplate strong {
  display: -webkit-box;
  overflow: hidden;
  color: #fff;
  font-family: Arial, 'Noto Sans Thai', sans-serif;
  font-size: clamp(1.15rem, 1.8vw, 1.7rem);
  font-weight: 1000;
  letter-spacing: 0.025em;
  line-height: 1.1;
  text-shadow: 0 3px 12px rgb(0 0 0 / 70%);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.match-showcase-versus {
  display: grid;
  width: clamp(4.8rem, 7vw, 6.8rem);
  aspect-ratio: 1;
  place-items: center;
  border: 2px solid rgb(255 255 255 / 34%);
  border-radius: 999px;
  background: radial-gradient(circle, #fff 0 4%, #fbbf24 5% 16%, #b45309 48%, #301603 72%);
  box-shadow: 0 0 0 8px rgb(255 255 255 / 5%), 0 0 42px rgb(251 191 36 / 58%);
  animation: showcase-vs-pop 0.55s 0.7s cubic-bezier(0.15, 1.25, 0.35, 1) both;
}

.match-showcase-versus span {
  font-size: clamp(1.7rem, 3vw, 2.8rem);
  font-style: italic;
  font-weight: 1000;
  letter-spacing: 0.035em;
  text-shadow: 0 4px 12px rgb(0 0 0 / 70%);
}

.match-showcase-status {
  margin-top: clamp(1rem, 3vh, 2rem);
  color: rgb(255 255 255 / 75%);
  font-size: clamp(0.9rem, 1.1vw, 1.1rem);
  font-weight: 900;
  letter-spacing: 0.24em;
  text-align: center;
  animation: showcase-status-pulse 0.8s 1.1s ease-in-out infinite alternate;
}

.match-showcase-enter-active { animation: showcase-screen-in 0.38s ease-out both; }
.match-showcase-leave-active { animation: showcase-screen-out 0.82s ease-in both; }
.match-showcase-leave-active .match-showcase-heading { animation: showcase-title-rise 0.58s ease-in both; }
.match-showcase-leave-active .match-showcase-player--a { animation: showcase-card-to-left 0.72s cubic-bezier(0.55, 0, 0.85, 0.35) both; }
.match-showcase-leave-active .match-showcase-player--b { animation: showcase-card-to-right 0.72s cubic-bezier(0.55, 0, 0.85, 0.35) both; }
.match-showcase-leave-active .match-showcase-versus { animation: showcase-vs-away 0.55s 0.08s ease-in both; }
.match-showcase-leave-active .match-showcase-status { animation: showcase-status-away 0.35s ease-in both; }

@keyframes showcase-screen-in {
  from { opacity: 0; transform: scale(1.06); filter: brightness(1.8); }
  to { opacity: 1; transform: scale(1); filter: brightness(1); }
}
@keyframes showcase-screen-out {
  from { opacity: 1; filter: brightness(1); }
  72% { opacity: 1; filter: brightness(1); }
  to { opacity: 0; filter: brightness(1.8); }
}
@keyframes showcase-title-drop {
  from { opacity: 0; transform: translateY(-24px) scale(1.08); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes showcase-card-from-left {
  from { opacity: 0; transform: translateX(-72vw) rotateY(42deg) scale(0.8); }
  72% { opacity: 1; transform: translateX(2.5%) rotateY(-2deg) scale(1.025); }
  to { opacity: 1; transform: translateX(0) rotateY(0) scale(1); }
}
@keyframes showcase-card-from-right {
  from { opacity: 0; transform: translateX(72vw) rotateY(-42deg) scale(0.8); }
  72% { opacity: 1; transform: translateX(-2.5%) rotateY(2deg) scale(1.025); }
  to { opacity: 1; transform: translateX(0) rotateY(0) scale(1); }
}
@keyframes showcase-title-rise {
  from { opacity: 1; transform: translateY(0) scale(1); }
  to { opacity: 0; transform: translateY(-24px) scale(1.08); }
}
@keyframes showcase-card-to-left {
  from { opacity: 1; transform: translateX(0) rotateY(0) scale(1); }
  28% { opacity: 1; transform: translateX(2.5%) rotateY(-2deg) scale(1.025); }
  to { opacity: 0; transform: translateX(-72vw) rotateY(42deg) scale(0.8); }
}
@keyframes showcase-card-to-right {
  from { opacity: 1; transform: translateX(0) rotateY(0) scale(1); }
  28% { opacity: 1; transform: translateX(-2.5%) rotateY(2deg) scale(1.025); }
  to { opacity: 0; transform: translateX(72vw) rotateY(-42deg) scale(0.8); }
}
@keyframes showcase-vs-away {
  from { opacity: 1; transform: scale(1) rotate(0); filter: blur(0); }
  to { opacity: 0; transform: scale(2.4) rotate(-16deg); filter: blur(8px); }
}
@keyframes showcase-status-away {
  from { opacity: 1; }
  to { opacity: 0; }
}
@keyframes showcase-vs-pop {
  from { opacity: 0; transform: scale(2.4) rotate(-16deg); filter: blur(8px); }
  to { opacity: 1; transform: scale(1) rotate(0); filter: blur(0); }
}
@keyframes showcase-card-shine {
  from { transform: translateX(-120%); }
  to { transform: translateX(140%); }
}
@keyframes showcase-flash-sweep {
  from { opacity: 0; transform: skewX(-18deg) translateX(-85%); }
  28% { opacity: 1; }
  to { opacity: 0; transform: skewX(-18deg) translateX(85%); }
}
@keyframes showcase-rays-spin { to { transform: rotate(360deg); } }
@keyframes showcase-energy {
  from { opacity: 0.35; transform: scale(0.96); }
  to { opacity: 0.78; transform: scale(1.04); }
}
@keyframes showcase-status-pulse {
  from { opacity: 0.45; }
  to { opacity: 1; text-shadow: 0 0 16px rgb(255 255 255 / 55%); }
}

.shared-fight-entry {
  animation: fight-card-enter 0.58s cubic-bezier(0.22, 0.78, 0.25, 1) both;
  animation-delay: calc(var(--fight-index, 0) * 70ms);
}

.shared-next-fight-row {
  position: relative;
  z-index: 1;
  animation-name: fight-card-enter, fight-card-float;
  animation-duration: 0.58s, 3.6s;
  animation-timing-function: cubic-bezier(0.22, 0.78, 0.25, 1), ease-in-out;
  animation-delay: 0ms, 0.65s;
  animation-iteration-count: 1, infinite;
  animation-fill-mode: both, none;
}

.shared-fighter-name--a { animation: fighter-from-left 0.72s cubic-bezier(0.2, 0.85, 0.25, 1) both; }
.shared-fighter-name--b { animation: fighter-from-right 0.72s cubic-bezier(0.2, 0.85, 0.25, 1) both; }

.shared-next-fight-row::after {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border: 1px solid rgb(245 158 11 / 42%);
  border-radius: inherit;
  content: '';
  animation: fight-ring 2.4s ease-in-out infinite;
}

.queue-bout-leave-active {
  z-index: 6;
  pointer-events: none;
  animation: fight-to-court 0.9s cubic-bezier(0.32, 0, 0.18, 1) both !important;
}
.queue-bout-move { transition: transform 0.65s cubic-bezier(0.2, 0.8, 0.25, 1); }
.live-start-enter-active {
  position: relative;
  z-index: 5;
  animation: live-match-arrive 0.9s cubic-bezier(0.16, 0.84, 0.3, 1) both;
}
.live-start-enter-active::after {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(100deg, transparent 15%, rgb(52 211 153 / 28%) 48%, transparent 78%);
  content: '';
  animation: live-match-sweep 0.9s ease-out both;
}
.live-start-move { transition: transform 0.65s cubic-bezier(0.2, 0.8, 0.25, 1); }

@keyframes fight-card-enter {
  from { opacity: 0; transform: translateY(20px) scale(0.975); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes fight-card-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}
@keyframes fighter-from-left {
  from { opacity: 0; transform: translateX(-20px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes fighter-from-right {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes fight-ring {
  0%, 100% { opacity: 0.35; box-shadow: 0 0 0 0 rgb(245 158 11 / 10%); }
  50% { opacity: 1; box-shadow: 0 0 0 5px rgb(245 158 11 / 8%); }
}
@keyframes fight-to-court {
  0% { opacity: 1; transform: translateY(0) scale(1); filter: brightness(1); }
  38% { opacity: 1; transform: translateY(-8px) scale(1.018); filter: brightness(1.18); box-shadow: 0 0 0 2px rgb(245 158 11 / 50%); }
  100% { opacity: 0; transform: translateY(-42px) scale(0.96); filter: brightness(1.25); }
}
@keyframes live-match-arrive {
  0% { opacity: 0; transform: translateY(-26px) scale(0.97); background-color: rgb(16 185 129 / 22%); }
  58% { opacity: 1; transform: translateY(3px) scale(1.008); background-color: rgb(16 185 129 / 16%); }
  100% { opacity: 1; transform: translateY(0) scale(1); background-color: transparent; }
}
@keyframes live-match-sweep {
  from { opacity: 0; transform: translateX(-70%); }
  35% { opacity: 1; }
  to { opacity: 0; transform: translateX(70%); }
}
@media (prefers-reduced-motion: reduce) {
  .shared-fight-entry,
  .shared-next-fight-row,
  .shared-fighter-name,
  .shared-next-fight-row::after,
  .queue-bout-leave-active,
  .live-start-enter-active,
  .live-start-enter-active::after,
  .match-start-showcase,
  .match-start-showcase::before,
  .match-start-showcase::after,
  .match-showcase-rays,
  .match-showcase-heading,
  .match-showcase-player,
  .match-showcase-player::before,
  .match-showcase-versus,
  .match-showcase-status {
    animation: none !important;
  }
  .queue-bout-move,
  .live-start-move { transition: none !important; }
}

.shared-queue-page { background: #f5f3ed !important; color-scheme: light; color: #1c1917; }
.shared-flight-board { border-color: #d6d3d1 !important; border-radius: 0.75rem !important; background: #fbfaf4 !important; color: #1c1917 !important; box-shadow: 0 14px 35px rgb(41 37 36 / 10%) !important; }
.shared-flight-header { border-color: #d6d3d1 !important; background: #ffffff !important; color: #1c1917 !important; }
.shared-flight-header p { color: #57534e !important; }
.shared-navbar-clock {
  overflow: hidden;
  border: 0;
  background: transparent;
  box-shadow: none;
}
.shared-navbar-clock-segments,
.shared-navbar-clock-time {
  grid-area: 1 / 1;
  font-family: 'DSEG7', monospace;
  font-size: clamp(2rem, 3vw, 2.4rem);
  font-weight: 700;
  letter-spacing: 0.035em;
  line-height: 1;
  white-space: nowrap;
}
.shared-navbar-clock-segments {
  color: #dbeafe;
  opacity: 0.7;
}
.shared-navbar-clock-time {
  position: relative;
  color: #2563eb;
  text-shadow: 0 0 2px rgb(37 99 235 / 30%);
}
.shared-flight-stats { border-color: #e7e5e4 !important; background: #f5f5f4 !important; }
.shared-flight-waiting-summary p { color: #287565 !important; }
.shared-flight-waiting-summary h2 { color: #1c1917 !important; font-size: 1.25rem !important; }
.shared-flight-waiting-summary,
.shared-waiting-people,
.mobile-waiting-summary,
.mobile-coupon-board { font-family: 'Sarabun', 'Noto Sans Thai', sans-serif !important; }
.shared-flight-columns { border-color: #d6d3d1 !important; background: #f0ede5 !important; color: #57534e !important; font-size: 0.82rem !important; letter-spacing: 0.13em !important; }
.shared-flight-row { border-color: #e7e5e4 !important; background: #ffffff !important; }
.shared-flight-row:nth-of-type(even) { background: #fafaf9 !important; }
.shared-flight-team { color: #1c1917 !important; font-size: clamp(1.15rem, 1.7vw, 1.55rem) !important; }
.shared-flight-row > p:not(.shared-flight-team) { color: #57534e !important; font-size: 1rem !important; }
.shared-flight-section-label { border-color: #d6d3d1 !important; }
.shared-flight-row--live .shared-flight-status { background: #e1f3ed !important; color: #176b5a !important; }
.shared-flight-row--waiting .shared-flight-status { background: #fff3d6 !important; color: #8a5a06 !important; }
.shared-flight-row--live .shared-flight-status > span { background: #3b9f87 !important; }
.shared-flight-row--waiting .shared-flight-status > span { background: #d99a1b !important; }
.shared-flight-section > .shared-flight-section-label { background: #f5f3ed !important; color: #44403c !important; font-size: 0.72rem !important; }
.shared-waiting-people { background: #fbfaf4 !important; color: #1c1917 !important; }
.shared-coupon-list { border-color: #d6d3d1 !important; border-right: 0 !important; border-left: 0 !important; background: #fff !important; color: #1c1917 !important; box-shadow: none !important; }
.shared-coupon-list > div { background: #eeeae0 !important; color: #57534e !important; }
.shared-coupon-list > article { border-color: #e7e5e4 !important; background: #fff !important; color: #1c1917 !important; }
.shared-coupon-list > article:nth-child(odd) { background: #f8f7f3 !important; }
.shared-coupon-list > article span { color: #287565 !important; }
.shared-coupon-list > article p:first-of-type { color: #1c1917 !important; }
.shared-coupon-list > article p:last-of-type { color: #57534e !important; }
.coupon-flight-columns { grid-template-columns: 4rem minmax(0, 1fr) 5rem 6.5rem !important; column-gap: clamp(0.45rem, 0.7vw, 0.7rem) !important; font-size: 0.88rem !important; letter-spacing: 0.06em; }
.coupon-flight-row { position: relative; grid-template-columns: 4rem minmax(0, 1fr) 5rem 6.5rem !important; column-gap: clamp(0.45rem, 0.7vw, 0.7rem) !important; }
.coupon-flight-columns--with-wait,
.coupon-flight-row--with-wait { grid-template-columns: 4rem minmax(0, 1fr) 5rem 6.5rem 7rem !important; }
.coupon-wait-time { white-space: nowrap; font-size: 0.82rem; font-weight: 800; color: #78716c; }
.coupon-flight-row > p { font-size: 1.12rem !important; }
.coupon-player-name { color: #1c1917 !important; font-size: clamp(1.2rem, 1.55vw, 1.55rem) !important; font-weight: 500 !important; line-height: 1.25; }
.coupon-pending-badge { border-radius: 999px; background: #fff0c9 !important; padding: 0.22rem 0.5rem; color: #855b08 !important; font-size: 0.66rem; font-weight: 900; white-space: nowrap; }
.shared-queue-shell { color: #1c1917 !important; }
.shared-queue-shell .shared-queue-summary,
.shared-queue-shell .shared-match-card,
.shared-queue-shell .shared-empty-queue { border-color: #d6d3d1 !important; background: #ffffff !important; }
.shared-queue-shell .shared-team-box,
.shared-queue-shell .shared-match-header { border-color: #e7e5e4 !important; background: #f5f5f4 !important; }
.shared-queue-shell .shared-team-name { color: #1c1917 !important; font-size: clamp(1.3rem, 4.2vw, 1.8rem); }
.shared-flight-columns,
.shared-flight-row {
  grid-template-columns: minmax(5.8rem, 0.7fr) minmax(3rem, 0.3fr) minmax(0, 1.6fr) minmax(0, 1.6fr) minmax(5.5rem, 0.8fr) minmax(6rem, 0.9fr);
  column-gap: clamp(0.65rem, 1.4vw, 1.5rem);
}

.shared-flight-row {
  position: relative;
  min-height: 3.4rem;
  background: rgb(255 255 255 / 2%);
}

.shared-flight-row > div > p:last-child,
.shared-flight-row > p:not(.shared-flight-team) {
  font-size: 0.82rem;
}

.shared-flight-row:nth-of-type(even) {
  background: rgb(255 255 255 / 5%);
}

.shared-flight-row::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  content: '';
}

.shared-flight-row--live::before {
  background: rgb(94 234 212);
}

.shared-flight-row--waiting::before {
  background: rgb(252 211 77);
}

.shared-flight-status {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 0.45rem;
  border-radius: 0.5rem;
  padding: 0.32rem 0.5rem;
  font-size: 0.68rem;
  font-weight: 900;
  white-space: nowrap;
}

.shared-flight-team {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  font-size: clamp(0.75rem, 1vw, 0.92rem);
  font-weight: 500;
  line-height: 1.25;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.shared-flight-scroll {
  scrollbar-color: rgb(120 113 108 / 65%) transparent;
}

.shared-queue-content,
.shared-queue-column,
.shared-match-grid {
  display: grid;
  gap: 0.75rem;
}

@media (max-width: 767px) {
  .shared-queue-page { padding: 0.6rem !important; background: #f7f5ef !important; }
  .shared-queue-shell { gap: 1rem; }
  .shared-queue-shell .shared-queue-summary,
  .shared-queue-shell .shared-match-card,
  .shared-queue-shell .shared-empty-queue {
    border: 0 !important;
    box-shadow: 0 5px 18px rgb(41 37 36 / 8%) !important;
  }
  .shared-queue-summary { border-radius: 1rem !important; }
  .shared-queue-hero { background: linear-gradient(135deg, #dff3ec 0%, #cce8df 100%) !important; color: #1c453c !important; }
  .shared-queue-hero > p,
  .shared-queue-hero h1,
  .shared-queue-hero h1 + p { color: #1c453c !important; }
  .shared-queue-hero button,
  .shared-queue-hero > div > div:last-child { border-color: #abd2c7 !important; background: #fff !important; color: #24695a !important; box-shadow: none !important; }
  .shared-queue-stats { border: 0 !important; }
  .shared-queue-stat { border: 0 !important; }
  .shared-queue-stat + .shared-queue-stat { border-left: 0 !important; }
  .shared-queue-column { gap: 0.55rem; }
  .shared-queue-section-title { padding-inline: 0.35rem !important; }
  .shared-match-card { border-radius: 1rem !important; background: #fff !important; }
  .shared-match-header { border: 0 !important; background: #fff !important; padding: 0.9rem 1rem 0.55rem !important; }
  .shared-elapsed {
    border: 0 !important;
    margin: 0.35rem 1rem 0.15rem;
    border-radius: 0.65rem;
    background: linear-gradient(90deg, #dff3ec, #eef8f4) !important;
    color: #206b5a !important;
    padding: 0.65rem 0.8rem !important;
  }
  .shared-team-grid { gap: 0.5rem; padding: 0.65rem 1rem 1rem !important; }
  .shared-queue-shell .shared-team-box { border: 0 !important; }
  .shared-queue-shell .shared-team-box:first-child { background: #eef5f8 !important; }
  .shared-queue-shell .shared-team-box:last-child { background: #faf3e5 !important; }
  .shared-empty-queue { padding: 2rem 1rem !important; background: #fff !important; }
  .shared-live-badge { background: #75bda9 !important; }
  .shared-waiting-card .shared-match-header { background: #fff !important; }
  .shared-queue-number { background: #f3ead5 !important; color: #805d13 !important; }
  .mobile-coupon-board { color: #1c1917 !important; box-shadow: 0 5px 18px rgb(41 37 36 / 8%); }
  .mobile-coupon-title { background: #cfeae2 !important; color: #173f36 !important; }
  .mobile-coupon-title h2 { color: #173f36 !important; }
  .mobile-coupon-eyebrow { color: #287565 !important; }
  .mobile-coupon-title svg { color: #287565 !important; }
  .mobile-waiting-summary { color: #173f36 !important; }
  .mobile-waiting-summary p { color: #287565 !important; }
  .mobile-waiting-summary h2 { color: #173f36 !important; font-size: 1.2rem !important; }
  .mobile-waiting-summary svg { color: #287565 !important; }
  .mobile-coupon-row { border: 0 !important; background: #fff !important; }
  .mobile-coupon-columns,
  .mobile-coupon-row { grid-template-columns: 3.2rem minmax(0, 1fr) 3.8rem 5.3rem !important; column-gap: 0.35rem; }
  .mobile-coupon-row .coupon-wait-time { font-size: 0.72rem; }
  .mobile-coupon-row:nth-child(even) { background: #f8f7f3 !important; }
  .mobile-coupon-row > span { color: #287565 !important; }
  .mobile-coupon-name { color: #1c1917 !important; font-size: 1.25rem !important; }
  .mobile-coupon-level { color: #57534e !important; font-size: 1rem !important; }
  .mobile-coupon-board > div:nth-child(1) { color: #44403c !important; font-size: 0.82rem !important; }
  .mobile-coupon-scroll { scrollbar-color: #a8cfc3 transparent; }
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

  .shared-flight-board {
    width: 100%;
    max-width: none;
    height: 100%;
    min-height: 0;
  }

  .shared-flight-header {
    padding: clamp(0.45rem, 0.7vw, 0.75rem) clamp(0.85rem, 1.2vw, 1.4rem);
  }

  .shared-flight-row {
    min-height: clamp(3.15rem, 5.3vh, 4.2rem);
    padding-block: clamp(0.3rem, 0.5vh, 0.45rem);
  }

  .shared-flight-row > div > p:last-child,
  .shared-flight-row > p:not(.shared-flight-team) {
    font-size: clamp(0.74rem, 0.85vw, 0.92rem);
  }

  .shared-flight-team {
    font-size: clamp(0.82rem, 1vw, 1.08rem);
  }

  .shared-flight-status {
    font-size: clamp(0.65rem, 0.7vw, 0.78rem);
  }

  .shared-queue-qr {
    right: clamp(1rem, 1.5vw, 1.75rem);
    bottom: clamp(1rem, 1.5vw, 1.75rem);
    padding: 0.75rem;
  }

  .shared-queue-qr img {
    width: clamp(9.25rem, 9vw, 11rem);
  }

  .shared-queue-qr p {
    max-width: 11rem;
    font-size: clamp(0.7rem, 0.75vw, 0.85rem);
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

/* Elder-friendly typography: keep the whole public queue on one clear Thai typeface. */
.shared-queue-page {
  font-family: 'Sarabun', 'Noto Sans Thai', sans-serif !important;
  font-size: 18px;
  line-height: 1.4;
}
.shared-flight-header h1 { font-size: clamp(1.3rem, 1.8vw, 1.65rem) !important; font-weight: 800; }
.shared-flight-header > div:first-child p { font-size: clamp(0.95rem, 1.15vw, 1.1rem) !important; font-weight: 600; }
.shared-flight-stats p:first-child { font-size: 0.82rem !important; font-weight: 700; }
.shared-flight-stats p:last-child { font-size: 1.45rem !important; font-weight: 800; }
.shared-flight-columns { font-size: clamp(0.88rem, 1vw, 1rem) !important; font-weight: 700; }
.shared-flight-section-label { font-size: 0.88rem !important; font-weight: 800; }
.shared-flight-team,
.shared-queue-page--compact .shared-flight-team,
.shared-queue-page--dense .shared-flight-team { font-size: clamp(1.2rem, 1.55vw, 1.55rem) !important; font-weight: 500 !important; line-height: 1.25; }
.shared-flight-row > p:not(.shared-flight-team) { font-size: clamp(0.95rem, 1.1vw, 1.08rem) !important; font-weight: 600; }
.shared-flight-status { font-size: 0.82rem !important; font-weight: 800; }
.coupon-player-name { font-size: clamp(1.2rem, 1.55vw, 1.55rem) !important; }
.coupon-flight-row > p { font-size: 1.05rem !important; }
.coupon-flight-row > .coupon-player-name { font-size: clamp(1.2rem, 1.55vw, 1.55rem) !important; font-weight: 500 !important; }
.coupon-pending-badge { font-size: 0.76rem; }

@media (max-width: 767px) {
  .shared-queue-page { font-size: 17px; line-height: 1.45; }
  .shared-queue-hero > p { font-size: 0.78rem !important; }
  .shared-queue-hero h1 { font-size: 1.35rem !important; }
  .shared-queue-hero h1 + span + p { font-size: 0.9rem !important; }
  .shared-queue-stat p:first-child { font-size: 0.82rem !important; font-weight: 600; }
  .shared-queue-stat p:last-child { font-size: 1.5rem !important; font-weight: 800; }
  .shared-queue-section-title h2 { font-size: 1.35rem !important; }
  .shared-match-header p:first-child { font-size: 1rem !important; }
  .shared-match-meta { font-size: 0.88rem !important; }
  .shared-live-badge { font-size: 0.82rem !important; }
  .shared-elapsed { font-size: 1.05rem !important; }
  .shared-team-box > p:first-child { font-size: 0.88rem !important; font-weight: 700; }
  .shared-team-name,
  .shared-queue-page--sparse .shared-team-name,
  .shared-queue-page--compact .shared-team-name,
  .shared-queue-page--dense .shared-team-name { font-size: 1.45rem !important; font-weight: 700; line-height: 1.15; }
  .shared-empty-queue p:first-of-type { font-size: 1.15rem; }
  .shared-empty-queue p:last-of-type { font-size: 0.95rem; }
  .mobile-waiting-summary h2 { font-size: 1.25rem !important; }
  .mobile-coupon-columns { font-size: 0.88rem !important; }
  .mobile-coupon-name,
  .mobile-coupon-row > .coupon-player-name { font-size: 1.45rem !important; font-weight: 700 !important; line-height: 1.15; }
  .mobile-coupon-level { font-size: 1rem !important; }
  .coupon-pending-badge { font-size: 0.72rem; }
}
</style>
