<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  Activity,
  BarChart3,
  Check,
  ClipboardList,
  Clock3,
  Copy,
  CreditCard,
  Medal,
  History,
  Home,
  LogOut,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Share2,
  Shuffle,
  Sun,
  Users,
  X
} from '@lucide/vue'
import MatchSetupModal from './components/MatchSetupModal.vue'
import AuthPage from './pages/AuthPage.vue'
import DashboardPage from './pages/DashboardPage.vue'
import HistoryPage from './pages/HistoryPage.vue'
import HomePage from './pages/HomePage.vue'
import LiveBoardPage from './pages/LiveBoardPage.vue'
import LiveMatchPage from './pages/LiveMatchPage.vue'
import PlayersPage from './pages/PlayersPage.vue'
import SettingsPage from './pages/SettingsPage.vue'
import SharedPlayersPage from './pages/SharedPlayersPage.vue'
import SupervisorPage from './pages/SupervisorPage.vue'

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080'
const adminSessionKey = 'livematch.adminSessionId'

const tabs = [
  { id: 'home', label: 'หน้าแรก', icon: Home },
  { id: 'dashboard', label: 'แดชบอร์ด', icon: BarChart3 },
  { id: 'players', label: 'สมาชิก', icon: Users },
  { id: 'livematch', label: 'จัดคู่', icon: Shuffle },
  { id: 'liveboard', label: 'แข่งอยู่', icon: Activity },
  { id: 'history', label: 'ประวัติ', icon: History },
  { id: 'settings', label: 'ตั้งค่า', icon: Settings }
]

const adminTabs = computed(() => tabs.filter((tab) => tab.id !== 'home'))
const mobileTabs = computed(() => adminTabs.value.filter((tab) => tab.id !== 'settings'))
const currentTab = computed(() => tabs.find((tab) => tab.id === state.tab) || tabs[0])

const state = reactive({
  tab: 'home',
  theme: 'light',
  session: {
    id: 'demo-session',
    name: 'แบดวันอังคาร',
    adminPasscode: 'LM-2406',
    unlocked: false
  },
  settings: {
    entryFee: 120,
    shuttleFee: 85,
    courtCount: 4,
    courtNames: ['สนาม 1', 'สนาม 2', 'สนาม 3', 'สนาม 4'],
    levels: ['light', 'middle', 'heavy'],
    allowCrossLevel: true,
    crossLevelRange: 1,
    randomPriority: 'level',
    showPaymentOnShare: true
  },
  players: [
    { id: 1, name: 'ต้น', games: 4, wins: 2, losses: 2, shuttles: 4, paid: true, active: true, level: 'middle', coupon: true },
    { id: 2, name: 'แพรว', games: 3, wins: 2, losses: 1, shuttles: 3, paid: false, active: true, level: 'middle', coupon: true },
    { id: 3, name: 'บอล', games: 2, wins: 1, losses: 1, shuttles: 2, paid: false, active: true, level: 'light', coupon: true },
    { id: 4, name: 'เมย์', games: 2, wins: 1, losses: 1, shuttles: 2, paid: true, active: true, level: 'light', coupon: true },
    { id: 5, name: 'ฟ้า', games: 5, wins: 3, losses: 2, shuttles: 5, paid: true, active: true, level: 'heavy', coupon: true },
    { id: 6, name: 'วิน', games: 1, wins: 0, losses: 1, shuttles: 1, paid: false, active: true, level: 'heavy', coupon: true },
    { id: 7, name: 'บีม', games: 0, wins: 0, losses: 0, shuttles: 0, paid: false, active: true, level: 'middle', coupon: true },
    { id: 8, name: 'นัท', games: 0, wins: 0, losses: 0, shuttles: 0, paid: false, active: true, level: 'middle', coupon: true },
    { id: 9, name: 'เจน', games: 0, wins: 0, losses: 0, shuttles: 0, paid: false, active: true, level: 'light', coupon: true },
    { id: 10, name: 'โอ๊ต', games: 0, wins: 0, losses: 0, shuttles: 0, paid: false, active: true, level: 'light', coupon: true },
    { id: 11, name: 'ก้อง', games: 1, wins: 1, losses: 0, shuttles: 1, paid: false, active: true, level: 'light', coupon: true },
    { id: 12, name: 'พลอย', games: 1, wins: 1, losses: 0, shuttles: 1, paid: true, active: true, level: 'light', coupon: true }
  ],
  couples: [{ id: 1, a: 1, b: 2 }],
  queue: [
    { id: 1, court: '-', level: 'middle', a1: 1, a2: 2, b1: 7, b2: 8 }
  ],
  live: [
    { id: 50, court: '1', level: 'heavy', a1: 5, a2: 6, b1: 3, b2: 4, shuttles: 2, status: 'กำลังเล่น', startedAt: '19:20' }
  ],
  history: [
    { id: 49, court: '2', level: 'middle', a1: 1, a2: 2, b1: 3, b2: 4, shuttles: 2, winner: 'A', shuttleSequence: '1-2', startedAt: '18:50', endedAt: '19:08', note: 'เกมแรก' }
  ]
})

const forms = reactive({
  newSessionName: 'แบดวันอังคาร',
  passcodeInput: '',
  createdPasscode: '',
  loginError: '',
  newPlayerName: '',
  playerSearch: '',
  playerPage: 1,
  playerPageSize: 8,
  coupleSearch: '',
  couplePage: 1,
  couplePageSize: 8,
  couponSearch: '',
  couponPage: 1,
  couponPageSize: 8,
  supervisorPassword: '',
  supervisorError: '',
  supervisorSummary: null,
  shareLink: '',
  shareStatus: '',
  finishNote: '',
  finishWinner: '',
  cancelNote: '',
  selectedPlayerId: 1,
  coupleAId: 1,
  coupleBId: 2,
  matchCourts: {},
  newCourtName: '',
  newLevelName: ''
})
const ui = reactive({
  showCouponModal: false,
  showCoupleModal: false,
  showFinishModal: false,
  finishMatch: null,
  showCancelModal: false,
  cancelMatch: null
})
const share = reactive({
  isPublic: false,
  loading: false,
  error: '',
  showPayment: false
})
const supervisor = reactive({
  isPage: window.location.pathname === '/supervisor',
  unlocked: false,
  loading: false
})
const selectedLiveId = ref(null)

async function api(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'request failed' }))
    throw new Error(error.error || 'request failed')
  }
  return response.json()
}

function applyServerState(nextState) {
  const currentTab = state.tab
  const currentTheme = state.theme
  Object.assign(state, nextState)
  state.tab = currentTab
  state.theme = currentTheme
  if (state.players.length && !state.players.some((player) => player.id === forms.selectedPlayerId)) {
    forms.selectedPlayerId = state.players[0].id
  }
}

onMounted(() => {
  if (supervisor.isPage) return
  loadSharedPlayers()
  restoreAdminSession()
})

async function saveSettings() {
  applyServerState(await api(`/api/sessions/${state.session.id}/settings`, {
    method: 'PUT',
    body: JSON.stringify(state.settings)
  }))
}

async function loginSupervisor() {
  supervisor.loading = true
  forms.supervisorError = ''
  try {
    forms.supervisorSummary = await api('/api/supervisor/summary', {
      method: 'POST',
      body: JSON.stringify({ username: 'superadmin', password: forms.supervisorPassword })
    })
    supervisor.unlocked = true
  } catch {
    forms.supervisorError = 'รหัสผ่านไม่ถูกต้อง'
  } finally {
    supervisor.loading = false
  }
}

async function restoreAdminSession() {
  if (share.isPublic) return
  const sessionId = localStorage.getItem(adminSessionKey)
  if (!sessionId) return
  try {
    const nextState = await api(`/api/sessions/${sessionId}/state`)
    applyServerState(nextState)
    state.session.unlocked = true
    state.tab = 'dashboard'
  } catch {
    localStorage.removeItem(adminSessionKey)
  }
}

function rememberAdminSession() {
  localStorage.setItem(adminSessionKey, state.session.id)
}

function logout() {
  localStorage.removeItem(adminSessionKey)
  state.session.unlocked = false
  state.tab = 'home'
  forms.passcodeInput = ''
  forms.loginError = ''
}

watch(
  () => state.theme,
  (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  },
  { immediate: true }
)

const playerById = (id) => state.players.find((player) => player.id === id)
const playerName = (id) => playerById(id)?.name || '-'
const levelLabel = (level) => ({ light: 'เบา', middle: 'กลาง', heavy: 'หนัก' }[level] || level)
function matchLevelLabel(match) {
  const orderedLevels = state.settings.levels
  const levels = [...new Set(matchPlayers(match).map((id) => playerById(id)?.level || match.level))]
    .sort((a, b) => {
      const aIndex = orderedLevels.indexOf(a)
      const bIndex = orderedLevels.indexOf(b)
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex)
    })
  return levels.map(levelLabel).join(' + ')
}
const isAdmin = computed(() => state.session.unlocked)

const queuedPlayerIds = computed(() => new Set(state.queue.flatMap(matchPlayers)))
const livePlayerIds = computed(() => new Set(state.live.flatMap(matchPlayers)))
const activePlayerCount = computed(() => state.players.filter((player) => player.active).length)
const totalShuttles = computed(() => state.live.reduce((sum, match) => sum + match.shuttles, 0) + state.history.reduce((sum, match) => sum + match.shuttles, 0))
const totalRecordedMatches = computed(() => state.live.length + state.history.length + state.queue.length)
const totalPlays = computed(() => state.players.reduce((sum, player) => sum + player.games, 0))
const averageGames = computed(() => activePlayerCount.value ? totalPlays.value / activePlayerCount.value : 0)
const totalRevenue = computed(() => state.players.reduce((sum, player) => sum + playerCost(player), 0))
const paidRevenue = computed(() => state.players.filter((player) => player.paid).reduce((sum, player) => sum + playerCost(player), 0))
const unpaidRevenue = computed(() => Math.max(0, totalRevenue.value - paidRevenue.value))
const paymentPercent = computed(() => totalRevenue.value ? Math.round((paidRevenue.value / totalRevenue.value) * 100) : 0)
const unpaidPlayers = computed(() => state.players.filter((player) => player.active && !player.paid))
const minGames = computed(() => (state.players.length ? Math.min(...state.players.map((player) => player.games)) : 0))
const maxGames = computed(() => (state.players.length ? Math.max(...state.players.map((player) => player.games)) : 0))
const topPlayers = computed(() => [...state.players].sort((a, b) => b.games - a.games || a.id - b.id).slice(0, 4))
const quietPlayers = computed(() => [...state.players].sort((a, b) => a.games - b.games || a.id - b.id).slice(0, 4))
const topWinners = computed(() => [...state.players].sort((a, b) => (b.wins || 0) - (a.wins || 0) || (a.losses || 0) - (b.losses || 0) || a.id - b.id).slice(0, 5))
const usedCourts = computed(() => new Set(state.live.map((match) => match.court)))
const availableCourtNames = computed(() => state.settings.courtNames.filter((court) => !usedCourts.value.has(court)))
const usedCourtNames = computed(() => new Set([...state.queue, ...state.live, ...state.history].map((match) => match.court).filter((court) => court && court !== '-')))
const usedLevels = computed(() => new Set([
  ...state.players.map((player) => player.level),
  ...state.queue.map((match) => match.level),
  ...state.live.map((match) => match.level),
  ...state.history.map((match) => match.level)
].filter(Boolean)))
const availablePlayers = computed(() =>
  state.players
    .filter((player) => player.active && !queuedPlayerIds.value.has(player.id) && !livePlayerIds.value.has(player.id))
    .sort((a, b) => a.games - b.games || a.id - b.id)
)

const couponGroups = computed(() => {
  const used = new Set()
  const groups = []
  for (const player of availablePlayers.value) {
    if (used.has(player.id)) continue
    const couple = state.couples.find((item) => item.a === player.id || item.b === player.id)
    if (couple) {
      const mateId = couple.a === player.id ? couple.b : couple.a
      const mate = availablePlayers.value.find((item) => item.id === mateId)
      if (mate) {
        groups.push({ ids: [player.id, mate.id], name: `${player.name} + ${mate.name}`, level: player.level, coupon: player.coupon && mate.coupon, games: player.games + mate.games })
        used.add(player.id)
        used.add(mate.id)
        continue
      }
    }
    groups.push({ ids: [player.id], name: player.name, level: player.level, coupon: player.coupon, games: player.games })
    used.add(player.id)
  }
  return groups.sort((a, b) => a.games - b.games)
})
const randomEligibleGroups = computed(() => couponGroups.value.filter((group) => group.coupon))

const dashboardCards = computed(() => [
  { label: 'ผู้เล่นวันนี้', value: `${activePlayerCount.value} คน`, icon: Users },
  { label: 'จำนวนแมตช์ที่บันทึก', value: `${totalRecordedMatches.value} เกม`, icon: ClipboardList },
  { label: 'รวมการลงเล่น', value: `${totalPlays.value} ครั้ง`, icon: Medal },
  { label: 'เฉลี่ยเกมต่อคน', value: averageGames.value.toFixed(2), icon: BarChart3 },
  { label: 'ลงน้อยสุด', value: `${minGames.value} เกม`, icon: Clock3 },
  { label: 'ลงมากสุด', value: `${maxGames.value} เกม`, icon: Activity },
  { label: 'ใช้ลูกแบดที่เบิก', value: `${totalShuttles.value} ลูก`, icon: RefreshCw },
  { label: 'รายรับรวม', value: money(totalRevenue.value), icon: CreditCard }
])

function matchPlayers(match) {
  return [match.a1, match.a2, match.b1, match.b2]
}

function playerCost(player) {
  return state.settings.entryFee + player.shuttles * state.settings.shuttleFee
}

function money(value) {
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(value)
}

async function createSession() {
  try {
    const response = await fetch(`${apiUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: forms.newSessionName })
    })
    if (!response.ok) throw new Error('backend unavailable')
    const session = await response.json()
    state.session = { ...session, unlocked: false }
  } catch {
    state.session = {
      id: crypto.randomUUID(),
      name: forms.newSessionName || 'แบดวันนี้',
      adminPasscode: `LM-${Math.floor(1000 + Math.random() * 9000)}`,
      unlocked: false
    }
  }
  forms.createdPasscode = state.session.adminPasscode
  forms.passcodeInput = ''
  forms.loginError = ''
}

function unlockDashboard() {
  state.session.unlocked = forms.passcodeInput === state.session.adminPasscode
  if (state.session.unlocked) {
    forms.loginError = ''
    state.tab = 'dashboard'
    return
  }
  forms.loginError = 'Passcode ไม่ถูกต้อง'
}

function addPlayer() {
  const name = forms.newPlayerName.trim()
  if (!name) return
  const id = Math.max(...state.players.map((player) => player.id), 0) + 1
  state.players.push({ id, name, games: 0, wins: 0, losses: 0, shuttles: 0, paid: false, active: true, level: 'middle', coupon: false })
  forms.newPlayerName = ''
}

function togglePayment(player) {
  player.paid = !player.paid
}

function randomMatch() {
  while (true) {
    const { selected, level } = pickRandomMatch(randomEligibleGroups.value)
    if (selected.length < 4) return

    const couple = state.couples.find((item) => selected.includes(item.a) && selected.includes(item.b))
    let teams = selected
    if (couple) {
      const rest = selected.filter((id) => id !== couple.a && id !== couple.b)
      teams = [couple.a, couple.b, rest[0], rest[1]]
    }

    state.queue.push({
      id: nextGameId(),
      court: '-',
      level,
      a1: teams[0],
      a2: teams[1],
      b1: teams[2],
      b2: teams[3]
    })
  }
}

function pickRandomMatch(groups) {
  if (state.settings.randomPriority === 'games') return pickRandomMatchByGames(groups)
  return pickRandomMatchByLevel(groups)
}

function pickRandomMatchByLevel(groups) {
  for (const level of state.settings.levels) {
    const selected = pickFourGroups(groups.filter((group) => group.level === level))
    if (selected.length === 4) return { selected, level }
  }
  if (state.settings.allowCrossLevel) {
    for (const level of state.settings.levels) {
      const baseIndex = state.settings.levels.indexOf(level)
      const selected = pickFourGroups(groups.filter((group) => {
        const groupIndex = state.settings.levels.indexOf(group.level)
        return group.level === level || Math.abs(groupIndex - baseIndex) <= state.settings.crossLevelRange
      }))
      if (selected.length === 4) return { selected, level }
    }
  }
  return { selected: [], level: '' }
}

function pickRandomMatchByGames(groups) {
  const sameLevel = bestMatchForLevels(groups, state.settings.levels)
  if (sameLevel.selected.length === 4) return sameLevel
  if (!state.settings.allowCrossLevel) return { selected: [], level: '' }

  let best = { selected: [], level: '', games: Number.POSITIVE_INFINITY }
  for (const level of state.settings.levels) {
    const baseIndex = state.settings.levels.indexOf(level)
    const pool = groups.filter((group) => {
      const groupIndex = state.settings.levels.indexOf(group.level)
      return group.level === level || Math.abs(groupIndex - baseIndex) <= state.settings.crossLevelRange
    })
    const selected = pickFourGroups(pool)
    if (selected.length === 4) {
      const games = selectedGroupGames(pool, selected)
      if (games < best.games) best = { selected, level, games }
    }
  }
  return best.selected.length === 4 ? best : { selected: [], level: '' }
}

function bestMatchForLevels(groups, levels) {
  let best = { selected: [], level: '', games: Number.POSITIVE_INFINITY }
  for (const level of levels) {
    const pool = groups.filter((group) => group.level === level)
    const selected = pickFourGroups(pool)
    if (selected.length === 4) {
      const games = selectedGroupGames(pool, selected)
      if (games < best.games) best = { selected, level, games }
    }
  }
  return best.selected.length === 4 ? best : { selected: [], level: '' }
}

function selectedGroupGames(groups, selected) {
  const selectedSet = new Set(selected)
  return groups.reduce((sum, group) => (
    group.ids.some((id) => selectedSet.has(id)) ? sum + group.games : sum
  ), 0)
}

function pickFourGroups(groups) {
  const selected = []
  for (const group of groups) {
    if (selected.length + group.ids.length <= 4) selected.push(...group.ids)
    if (selected.length === 4) return selected
  }
  return selected
}

function startMatch(match, court = '') {
  if (!court) return
  state.queue = state.queue.filter((item) => item.id !== match.id)
  state.live.push({ ...match, court, shuttles: 1, status: 'กำลังเล่น', startedAt: currentTime() })
  state.tab = 'liveboard'
}

function cancelQueuedMatch(match) {
  state.queue = state.queue.filter((item) => item.id !== match.id)
  delete forms.matchCourts[match.id]
}

function adjustShuttle(match, delta) {
  match.shuttles = Math.max(0, match.shuttles + delta)
}

function closeLive(match, cancelled = false, note = '') {
  selectedLiveId.value = match.id
  const ended = {
    ...match,
    endedAt: currentTime(),
    winner: cancelled ? '' : forms.finishWinner,
    shuttleSequence: cancelled ? '' : nextShuttleSequence(match.shuttles),
    note: note || forms.finishNote || (cancelled ? 'ยกเลิกการแข่งขัน' : 'จบการแข่งขัน')
  }
  state.history.unshift(ended)
  for (const id of matchPlayers(match)) {
    const player = playerById(id)
    if (player && !cancelled) {
      player.games += 1
      player.shuttles += match.shuttles
      const won = (ended.winner === 'A' && (id === match.a1 || id === match.a2)) || (ended.winner === 'B' && (id === match.b1 || id === match.b2))
      if (won) player.wins = (player.wins || 0) + 1
      else if (ended.winner) player.losses = (player.losses || 0) + 1
    }
  }
  state.live = state.live.filter((item) => item.id !== match.id)
  forms.finishNote = ''
  selectedLiveId.value = null
}

function requestFinishMatch(match) {
  ui.finishMatch = match
  forms.finishNote = ''
  forms.finishWinner = ''
  ui.showFinishModal = true
}

function confirmFinishMatch() {
  if (!ui.finishMatch) return
  closeLive(ui.finishMatch, false, forms.finishNote)
  ui.finishMatch = null
  forms.finishNote = ''
  forms.finishWinner = ''
  ui.showFinishModal = false
}

function requestCancelMatch(match) {
  ui.cancelMatch = match
  forms.cancelNote = ''
  ui.showCancelModal = true
}

function confirmCancelMatch() {
  if (!ui.cancelMatch) return
  closeLive(ui.cancelMatch, true, forms.cancelNote)
  ui.cancelMatch = null
  forms.cancelNote = ''
  ui.showCancelModal = false
}

function nextShuttleSequence(used) {
  if (used <= 0) return ''
  const start = state.history.reduce((sum, match) => sum + match.shuttles, 1)
  const end = start + used - 1
  return start === end ? `${start}` : `${start}-${end}`
}

function addCouple() {
  const a = Number(forms.coupleAId)
  const b = Number(forms.coupleBId)
  if (!a || !b || a === b) return
  state.couples = state.couples.filter((couple) => couple.a !== a && couple.b !== a && couple.a !== b && couple.b !== b)
  state.couples.push({ id: Date.now(), a, b })
}

function removeCouple(id) {
  state.couples = state.couples.filter((couple) => couple.id !== id)
}

function nextGameId() {
  return Math.max(0, ...state.queue.map((m) => m.id), ...state.live.map((m) => m.id), ...state.history.map((m) => m.id)) + 1
}

function currentTime() {
  return new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
}

function addCourt() {
  const name = forms.newCourtName.trim()
  state.settings.courtNames.push(name || `สนาม ${state.settings.courtNames.length + 1}`)
  state.settings.courtCount = state.settings.courtNames.length
  forms.newCourtName = ''
  saveSettings().catch(() => {})
}

function removeCourt(index) {
  if (state.settings.courtNames.length <= 1) return
  if (usedCourtNames.value.has(state.settings.courtNames[index])) return
  state.settings.courtNames.splice(index, 1)
  state.settings.courtCount = state.settings.courtNames.length
  saveSettings().catch(() => {})
}

function addLevel() {
  const level = forms.newLevelName.trim()
  if (!level || state.settings.levels.includes(level)) return
  state.settings.levels.push(level)
  forms.newLevelName = ''
  saveSettings().catch(() => {})
}

function removeLevel(index) {
  if (state.settings.levels.length <= 1) return
  if (usedLevels.value.has(state.settings.levels[index])) return
  state.settings.levels.splice(index, 1)
  saveSettings().catch(() => {})
}

function playerShareLink() {
  const params = new URLSearchParams({
    view: 'players',
    session: state.session.id
  })
  return `${window.location.origin}${window.location.pathname}?${params.toString()}`
}

async function sharePlayers() {
  forms.shareLink = playerShareLink()
  forms.shareStatus = ''
  try {
    await navigator.clipboard.writeText(forms.shareLink)
    forms.shareStatus = 'คัดลอกลิงก์แล้ว'
  } catch {
    forms.shareStatus = 'คัดลอกอัตโนมัติไม่ได้ ใช้ลิงก์ด้านล่างได้เลย'
  }
}

async function loadSharedPlayers() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('view') !== 'players' || !params.get('session')) return
  share.isPublic = true
  share.loading = true
  share.error = ''
  try {
    const nextState = await api(`/api/sessions/${params.get('session')}/state`)
    applyServerState(nextState)
    share.showPayment = state.settings.showPaymentOnShare
    state.session.unlocked = false
  } catch {
    share.error = 'ไม่พบข้อมูล session นี้'
  } finally {
    share.loading = false
  }
}

async function createSessionApi() {
  try {
    const record = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: forms.newSessionName })
    })
    applyServerState(record.state)
    forms.createdPasscode = record.adminPasscode
    forms.passcodeInput = ''
    forms.loginError = ''
  } catch {
    await createSession()
  }
}

async function unlockDashboardApi() {
  try {
    let nextState
    try {
      nextState = await api(`/api/sessions/${state.session.id}/unlock`, {
        method: 'POST',
        body: JSON.stringify({ passcode: forms.passcodeInput })
      })
    } catch {
      nextState = await api('/api/sessions/unlock', {
        method: 'POST',
        body: JSON.stringify({ passcode: forms.passcodeInput })
      })
    }
    applyServerState(nextState)
    rememberAdminSession()
    forms.loginError = ''
    state.tab = 'dashboard'
  } catch {
    unlockDashboard()
  }
}

async function addPlayerApi() {
  const name = forms.newPlayerName.trim()
  if (!name) return
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/players`, {
      method: 'POST',
      body: JSON.stringify({ name, level: state.settings.levels[0] || 'middle', coupon: false })
    }))
    forms.newPlayerName = ''
  } catch {
    addPlayer()
  }
}

async function togglePaymentApi(player) {
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/players/${player.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ paid: !player.paid })
    }))
  } catch {
    togglePayment(player)
  }
}

async function updatePlayerLevelApi(playerId, level) {
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/players/${playerId}`, {
      method: 'PATCH',
      body: JSON.stringify({ level })
    }))
  } catch {
    const player = playerById(playerId)
    if (player) player.level = level
  }
}

async function updatePlayerRandomStatusApi(playerId, level) {
  const ready = level !== 'not-ready'
  const body = ready ? { level, coupon: true } : { coupon: false }
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/players/${playerId}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    }))
  } catch {
    const player = playerById(playerId)
    if (!player) return
    player.coupon = ready
    if (ready) player.level = level
  }
}

async function randomMatchApi() {
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/random`, { method: 'POST' }))
  } catch {
    randomMatch()
  }
}

async function startMatchApi(match, court = '') {
  if (!court) return
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/queue/${match.id}/start`, {
      method: 'POST',
      body: JSON.stringify({ court })
    }))
    state.tab = 'liveboard'
  } catch {
    startMatch(match, court)
  }
}

async function cancelQueuedMatchApi(match) {
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/queue/${match.id}`, { method: 'DELETE' }))
  } catch {
    cancelQueuedMatch(match)
  }
}

async function adjustShuttleApi(match, delta) {
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/live/${match.id}/shuttles`, {
      method: 'PATCH',
      body: JSON.stringify({ delta })
    }))
  } catch {
    adjustShuttle(match, delta)
  }
}

async function closeLiveApi(match, cancelled = false, note = '') {
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/live/${match.id}/${cancelled ? 'cancel' : 'finish'}`, {
      method: 'POST',
      body: JSON.stringify({ note, winner: forms.finishWinner })
    }))
    forms.finishNote = ''
  } catch {
    closeLive(match, cancelled, note)
  }
}

async function confirmFinishMatchApi() {
  if (!ui.finishMatch) return
  await closeLiveApi(ui.finishMatch, false, forms.finishNote)
  ui.finishMatch = null
  forms.finishNote = ''
  forms.finishWinner = ''
  ui.showFinishModal = false
}

async function confirmCancelMatchApi() {
  if (!ui.cancelMatch) return
  await closeLiveApi(ui.cancelMatch, true, forms.cancelNote)
  ui.cancelMatch = null
  forms.cancelNote = ''
  ui.showCancelModal = false
}

async function addCoupleApi() {
  const a = Number(forms.coupleAId)
  const b = Number(forms.coupleBId)
  if (!a || !b || a === b) return
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/couples`, {
      method: 'POST',
      body: JSON.stringify({ a, b })
    }))
  } catch {
    addCouple()
  }
}

async function removeCoupleApi(id) {
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/couples/${id}`, { method: 'DELETE' }))
  } catch {
    removeCouple(id)
  }
}

async function saveSettingsApi() {
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/settings`, {
      method: 'PUT',
      body: JSON.stringify(state.settings)
    }))
  } catch {
    // Local fallback keeps manual testing usable if the backend is offline.
  }
}

const pageProps = computed(() => ({
  state,
  forms,
  ui,
  activePlayerCount: activePlayerCount.value,
  totalRecordedMatches: totalRecordedMatches.value,
  averageGames: averageGames.value,
  minGames: minGames.value,
  maxGames: maxGames.value,
  totalShuttles: totalShuttles.value,
  paymentPercent: paymentPercent.value,
  totalRevenue: totalRevenue.value,
  paidRevenue: paidRevenue.value,
  unpaidRevenue: unpaidRevenue.value,
  unpaidPlayers: unpaidPlayers.value,
  topPlayers: topPlayers.value,
  quietPlayers: quietPlayers.value,
  topWinners: topWinners.value,
  couponGroups: couponGroups.value,
  availableCourtNames: availableCourtNames.value,
  usedCourtNames: usedCourtNames.value,
  usedLevels: usedLevels.value,
  money,
  playerCost,
  levelLabel,
  matchLevelLabel,
  addPlayer: addPlayerApi,
  sharePlayers,
  togglePayment: togglePaymentApi,
  updatePlayerLevel: updatePlayerLevelApi,
  updatePlayerRandomStatus: updatePlayerRandomStatusApi,
  randomMatch: randomMatchApi,
  startMatch: startMatchApi,
  cancelQueuedMatch: cancelQueuedMatchApi,
  playerName,
  adjustShuttle: adjustShuttleApi,
  closeLive: closeLiveApi,
  requestFinishMatch,
  confirmFinishMatch: confirmFinishMatchApi,
  requestCancelMatch,
  confirmCancelMatch: confirmCancelMatchApi,
  addCouple: addCoupleApi,
  removeCouple: removeCoupleApi,
  addCourt,
  removeCourt,
  addLevel,
  removeLevel,
  saveSettings: saveSettingsApi,
  supervisor,
  loginSupervisor,
  createSession: createSessionApi,
  unlockDashboard: unlockDashboardApi
}))
</script>

<template>
  <div class="min-h-screen bg-paper-50 text-stone-900 transition dark:bg-paper-900 dark:text-stone-100">
    <SupervisorPage v-if="supervisor.isPage" v-bind="pageProps" />

    <SharedPlayersPage v-else-if="share.isPublic" :state="state" :share="share" :money="money" :player-cost="playerCost" />

    <template v-else>
    <header class="sticky top-0 z-30 border-b border-stone-200/80 bg-paper-50/95 backdrop-blur dark:border-stone-700 dark:bg-paper-900/95">
      <div class="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4">
        <button class="flex min-w-0 items-center gap-3 text-left" @click="isAdmin ? state.tab = 'dashboard' : state.tab = 'home'">
          <span class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-court-500 text-white shadow-soft">
            <Medal class="h-5 w-5" />
          </span>
          <span class="min-w-0">
            <span class="block truncate text-base font-black leading-5 sm:text-lg">LiveMatch</span>
            <span class="block truncate text-xs text-stone-500 dark:text-stone-400">{{ isAdmin ? currentTab.label : 'Admin access' }}</span>
          </span>
        </button>
        <div class="flex items-center gap-2">
          <span v-if="isAdmin" class="hidden rounded-md border border-stone-200 bg-white px-3 py-1 text-xs text-stone-500 dark:border-stone-700 dark:bg-stone-900 md:inline">
            {{ state.session.name }}
          </span>
          <button
            v-if="isAdmin"
            class="grid h-10 w-10 place-items-center rounded-md border border-stone-200 bg-white text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 md:hidden"
            title="ตั้งค่า"
            @click="state.tab = 'settings'"
          >
            <Settings class="h-5 w-5" />
          </button>
          <button
            v-if="isAdmin"
            class="grid h-10 w-10 place-items-center rounded-md border border-stone-200 bg-white text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            title="ออกจากระบบ"
            @click="logout"
          >
            <LogOut class="h-5 w-5" />
          </button>
          <button
            class="grid h-10 w-10 place-items-center rounded-md border border-stone-200 bg-white text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            :title="state.theme === 'dark' ? 'Light mode' : 'Dark mode'"
            @click="state.theme = state.theme === 'dark' ? 'light' : 'dark'"
          >
            <Sun v-if="state.theme === 'dark'" class="h-5 w-5" />
            <Moon v-else class="h-5 w-5" />
          </button>
        </div>
      </div>
      <nav v-if="isAdmin" class="scrollbar-none mx-auto hidden max-w-7xl gap-1 overflow-x-auto px-4 pb-3 md:flex">
        <button
          v-for="tab in adminTabs"
          :key="tab.id"
          class="flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition"
          :class="state.tab === tab.id ? 'bg-stone-900 text-white dark:bg-white dark:text-stone-900' : 'text-stone-600 hover:bg-white dark:text-stone-300 dark:hover:bg-stone-800'"
          @click="state.tab = tab.id"
        >
          <component :is="tab.icon" class="h-4 w-4" />
          {{ tab.label }}
        </button>
      </nav>
    </header>

    <main class="mx-auto max-w-7xl px-4 pb-28 pt-4 md:pb-8 md:pt-5">
      <AuthPage v-if="!isAdmin" v-bind="pageProps" />

      <HomePage v-if="isAdmin && state.tab === 'home'" v-bind="pageProps" />

      <DashboardPage v-if="isAdmin && state.tab === 'dashboard'" v-bind="pageProps" />

      <PlayersPage v-if="isAdmin && state.tab === 'players'" v-bind="pageProps" />

      <LiveMatchPage v-if="isAdmin && state.tab === 'livematch'" v-bind="pageProps" />

      <LiveBoardPage v-if="isAdmin && state.tab === 'liveboard'" v-bind="pageProps" />

      <HistoryPage v-if="isAdmin && state.tab === 'history'" v-bind="pageProps" />

      <SettingsPage v-if="isAdmin && state.tab === 'settings'" v-bind="pageProps" />
    </main>

    <nav
      v-if="isAdmin"
      class="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-paper-50/95 px-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgba(34,41,37,0.08)] backdrop-blur dark:border-stone-700 dark:bg-paper-900/95 md:hidden"
    >
      <div class="mx-auto grid max-w-md grid-cols-5 gap-1">
        <button
          v-for="tab in mobileTabs"
          :key="tab.id"
          class="flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md text-[11px] font-semibold leading-none transition"
          :class="state.tab === tab.id ? 'bg-stone-900 text-white dark:bg-white dark:text-stone-900' : 'text-stone-500 active:bg-stone-100 dark:text-stone-400 dark:active:bg-stone-800'"
          @click="state.tab = tab.id"
        >
          <component :is="tab.icon" class="h-5 w-5 shrink-0" />
          <span class="max-w-full truncate">{{ tab.label }}</span>
        </button>
      </div>
    </nav>

    <MatchSetupModal v-if="isAdmin && (ui.showCouponModal || ui.showCoupleModal)" v-bind="pageProps" />
    </template>
  </div>
</template>
