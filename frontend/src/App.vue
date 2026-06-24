<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import QRCode from 'qrcode'
import {
  Activity,
  BarChart3,
  Check,
  ClipboardList,
  Clock3,
  Coins,
  Copy,
  CreditCard,
  Database,
  Medal,
  History,
  Home,
  ImagePlus,
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
  Upload,
  Users,
  X
} from '@lucide/vue'
import MatchSetupModal from './components/MatchSetupModal.vue'
import AdminSupervisorPage from './pages/AdminSupervisorPage.vue'
import AuthPage from './pages/AuthPage.vue'
import BackofficePage from './pages/BackofficePage.vue'
import DashboardPage from './pages/DashboardPage.vue'
import HistoryPage from './pages/HistoryPage.vue'
import HomePage from './pages/HomePage.vue'
import LiveBoardPage from './pages/LiveBoardPage.vue'
import LiveShareHoursPage from './pages/LiveShareHoursPage.vue'
import LiveMatchPage from './pages/LiveMatchPage.vue'
import PlayersPage from './pages/PlayersPage.vue'
import QueuePage from './pages/QueuePage.vue'
import SettingsPage from './pages/SettingsPage.vue'
import SharedPlayersPage from './pages/SharedPlayersPage.vue'
import SharedQueuePage from './pages/SharedQueuePage.vue'
import VerifyEmailPage from './pages/VerifyEmailPage.vue'
import { installDomTranslator, language, levelText, t, toggleLanguage } from './i18n'
import { persistTheme, readStoredTheme } from './theme'

const apiUrl = import.meta.env.VITE_API_URL || ''

const tabs = computed(() => [
  { id: 'home', label: t('หน้าแรก', 'Home'), icon: Home },
  { id: 'dashboard', label: t('แดชบอร์ด', 'Dashboard'), icon: BarChart3 },
  { id: 'players', label: t('สมาชิก', 'Players'), icon: Users },
  { id: 'livematch', label: t('จัดคู่', 'Pairing'), icon: Shuffle },
  { id: 'queue', label: t('รอคิว', 'Queue'), icon: Clock3 },
  { id: 'liveboard', label: t('แข่งอยู่', 'Live board'), icon: Activity },
  { id: 'history', label: t('ประวัติ', 'History'), icon: History },
  { id: 'settings', label: t('ตั้งค่า', 'Settings'), icon: Settings },
  ...(isLiveShare.value ? [{ id: 'liveShareHours', label: t('ชั่วโมงเล่น', 'Hours'), icon: Clock3 }] : [])
])

const adminTabs = computed(() => tabs.value.filter((tab) => tab.id !== 'home'))
const mobileTabs = computed(() => adminTabs.value)
const currentTab = computed(() => tabs.value.find((tab) => tab.id === state.tab) || tabs.value[0])

const state = reactive({
  tab: 'home',
  theme: readStoredTheme(),
  session: {
    id: 'demo-session',
    name: 'แบดวันอังคาร',
    type: 'liveMatch',
    adminPasscode: 'LM-2406',
    unlocked: false,
    createdAt: '',
    expiresAt: '',
    expired: false
  },
  settings: {
    entryFee: 120,
    courtFeePerHour: 150,
    shuttleFee: 85,
    sessionFee: 0,
    courtCount: 4,
    courtNames: ['สนาม 1', 'สนาม 2', 'สนาม 3', 'สนาม 4'],
    levels: ['light', 'middle', 'heavy'],
    allowCrossLevel: true,
    crossLevelRange: 1,
    randomPriority: 'level',
    showPaymentOnShare: true,
    resetPlayersAfterFinish: true,
    startMatchWithShuttle: true
  },
  players: [
    { id: 1, name: 'ต้น', games: 4, wins: 2, draws: 0, losses: 2, shuttles: 4, paid: true, active: true, level: 'middle', coupon: true },
    { id: 2, name: 'แพรว', games: 3, wins: 2, draws: 0, losses: 1, shuttles: 3, paid: false, active: true, level: 'middle', coupon: true },
    { id: 3, name: 'บอล', games: 2, wins: 1, draws: 0, losses: 1, shuttles: 2, paid: false, active: true, level: 'light', coupon: true },
    { id: 4, name: 'เมย์', games: 2, wins: 1, draws: 0, losses: 1, shuttles: 2, paid: true, active: true, level: 'light', coupon: true },
    { id: 5, name: 'ฟ้า', games: 5, wins: 3, draws: 0, losses: 2, shuttles: 5, paid: true, active: true, level: 'heavy', coupon: true },
    { id: 6, name: 'วิน', games: 1, wins: 0, draws: 0, losses: 1, shuttles: 1, paid: false, active: true, level: 'heavy', coupon: true },
    { id: 7, name: 'บีม', games: 0, wins: 0, draws: 0, losses: 0, shuttles: 0, paid: false, active: true, level: 'middle', coupon: true },
    { id: 8, name: 'นัท', games: 0, wins: 0, draws: 0, losses: 0, shuttles: 0, paid: false, active: true, level: 'middle', coupon: true },
    { id: 9, name: 'เจน', games: 0, wins: 0, draws: 0, losses: 0, shuttles: 0, paid: false, active: true, level: 'light', coupon: true },
    { id: 10, name: 'โอ๊ต', games: 0, wins: 0, draws: 0, losses: 0, shuttles: 0, paid: false, active: true, level: 'light', coupon: true },
    { id: 11, name: 'ก้อง', games: 1, wins: 1, draws: 0, losses: 0, shuttles: 1, paid: false, active: true, level: 'light', coupon: true },
    { id: 12, name: 'พลอย', games: 1, wins: 1, draws: 0, losses: 0, shuttles: 1, paid: true, active: true, level: 'light', coupon: true }
  ],
  couples: [{ id: 1, a: 1, b: 2 }],
  pending: [],
  queue: [
    { id: 1, court: '-', level: 'middle', a1: 1, a2: 2, b1: 7, b2: 8 }
  ],
  live: [
    { id: 50, court: '1', level: 'heavy', a1: 5, a2: 6, b1: 3, b2: 4, shuttles: 2, status: 'กำลังเล่น', startedAt: '19:20' }
  ],
  history: [
    { id: 49, court: '2', level: 'middle', a1: 1, a2: 2, b1: 3, b2: 4, shuttles: 2, winner: 'A', shuttleSequence: '1-2', startedAt: '18:50', endedAt: '19:08', note: 'เกมแรก' }
  ],
  liveShare: {
    courtHours: {},
    playerHours: {},
    shuttleHours: {}
  }
})

const forms = reactive({
  newSessionName: '',
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
  randomError: '',
  qrLink: '',
  qrTitle: '',
  qrDataUrl: '',
  qrStatus: '',
  supervisorPassword: '',
  supervisorError: '',
  supervisorSummary: null,
  authMode: 'login',
  authName: '',
  authEmail: '',
  authPassword: '',
  authMessage: '',
  authError: '',
  resetToken: '',
  sessionCreateName: '',
  sessionCreateType: 'liveMatch',
  backofficeUsername: '',
  backofficePassword: '',
  backofficeError: '',
  backofficeTab: 'overview',
  backofficeSummary: null,
  backofficeAdminDetail: null,
  backofficeCoinAdminId: '',
  backofficeCoinDelta: 0,
  backofficeCoinNote: '',
  backofficeLiveMatchCost: null,
  backofficeLiveShareCost: null,
  backofficeCoinPackages: [],
  backofficeCoinPaymentQrImage: '',
  backofficePromptPayId: '',
  backofficePromptPayType: 'mobile',
  backofficePromptPayReceiverName: '',
  backofficeTelegramBotToken: '',
  backofficeTelegramChatId: '',
  backofficeTelegramWebhookSecret: '',
  backofficeRejectOrderId: '',
  backofficeRejectNote: '',
  backofficeSlipPreview: null,
  coinModalMode: 'shop',
  coinSelectedPackageId: '',
  coinPaymentQrDataUrl: '',
  coinSlipImage: '',
  coinOrderStatus: '',
  shareLink: '',
  shareStatus: '',
  finishNote: '',
  finishWinner: '',
  cancelNote: '',
  selectedPlayerId: 1,
  coupleAId: '',
  coupleBId: '',
  matchCourts: {},
  playerNameEdits: {},
  newCourtName: '',
  newLevelName: ''
})
const ui = reactive({
  showCouponModal: false,
  showCoupleModal: false,
  showFinishModal: false,
  finishMatch: null,
  showCancelModal: false,
  cancelMatch: null,
  showShuttleModal: false,
  shuttleMatch: null,
  showQrModal: false,
  showCreateSessionModal: false,
  showCoinModal: false,
  showBackofficeAdminModal: false,
  showBackofficeSlipModal: false,
  toast: null,
  loadingTab: ''
})
const share = reactive({
  isPublic: false,
  view: '',
  loading: false,
  error: '',
  showPayment: false
})
const auth = reactive({
  loading: false,
  user: null,
  sessions: [],
  coinLedger: [],
  liveMatchSessionCost: null,
  liveShareSessionCost: null,
  coinPackages: [],
  coinPaymentQrImage: '',
  promptPayId: '',
  promptPayType: 'mobile',
  promptPayReceiverName: '',
  promptPayPayloads: {},
  promptPayAvailable: false,
  coinOrders: []
})
const backoffice = reactive({
  isPage: window.location.pathname === '/backoffice' || window.location.pathname === '/supervisor',
  unlocked: false,
  loading: false
})
const verifyEmail = reactive({
  isPage: window.location.pathname === '/verify-email',
  status: 'loading',
  message: 'กรุณารอสักครู่ ระบบกำลังตรวจสอบลิงก์ยืนยันอีเมลของคุณ'
})
const selectedLiveId = ref(null)
let toastTimer = null
let sharedRefreshTimer = null

function showToast(message, type = 'error') {
  if (!message) return
  ui.toast = { message, type }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    ui.toast = null
    toastTimer = null
  }, 4200)
}

function closeToast() {
  ui.toast = null
  if (toastTimer) {
    window.clearTimeout(toastTimer)
    toastTimer = null
  }
}

async function api(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers || {})
    }
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'request failed' }))
    const requestError = new Error(error.error || 'request failed')
    requestError.status = response.status
    throw requestError
  }
  return response.json()
}

function backofficeAuthHeaders() {
  return {
    Authorization: `Basic ${btoa(`${forms.backofficeUsername}:${forms.backofficePassword}`)}`
  }
}

function applyServerState(nextState) {
  const currentTab = state.tab
  const currentTheme = readStoredTheme()
  Object.assign(state, nextState)
  normalizeClientSettings()
  state.tab = currentTab
  state.theme = persistTheme(currentTheme)
  if (state.players.length && !state.players.some((player) => player.id === forms.selectedPlayerId)) {
    forms.selectedPlayerId = state.players[0].id
  }
}

function mergeSessionPatch(patch = {}) {
  if (Array.isArray(patch.players)) state.players = patch.players
  if (Array.isArray(patch.couples)) state.couples = patch.couples
  if (Array.isArray(patch.pending)) state.pending = patch.pending
  if (Array.isArray(patch.queue)) state.queue = patch.queue
  if (Array.isArray(patch.live)) state.live = patch.live
  if (Array.isArray(patch.history)) state.history = patch.history
  if (patch.liveShare) state.liveShare = patch.liveShare
  if (patch.settings) state.settings = patch.settings
  normalizeClientSettings()
  if (state.players.length && !state.players.some((player) => player.id === forms.selectedPlayerId)) {
    forms.selectedPlayerId = state.players[0].id
  }
}

function normalizeClientSettings() {
  if (!state.session.type) {
    state.session.type = 'liveMatch'
  }
  if (state.settings.sessionFee === undefined) {
    state.settings.sessionFee = 0
  }
  if (state.settings.courtFeePerHour === undefined || state.settings.courtFeePerHour === null) {
    state.settings.courtFeePerHour = 150
  }
  if (state.settings.startMatchWithShuttle === undefined) {
    state.settings.startMatchWithShuttle = true
  }
  if (!state.liveShare) {
    state.liveShare = { courtHours: {}, playerHours: {}, shuttleHours: {} }
  }
  if (!state.liveShare.courtHours) state.liveShare.courtHours = {}
  if (!state.liveShare.playerHours) state.liveShare.playerHours = {}
  if (!state.liveShare.shuttleHours) state.liveShare.shuttleHours = {}
  if (state.session.type === 'liveShare') {
    state.settings.startMatchWithShuttle = false
  }
}

async function reloadAdminTab(tabId) {
  if (!state.session.id || !state.session.unlocked) return
  switch (tabId) {
  case 'dashboard': {
    const payload = await api(`/api/sessions/${state.session.id}/dashboard`)
    mergeSessionPatch(payload)
    break
  }
  case 'players': {
    const payload = await api(`/api/sessions/${state.session.id}/players?all=1`)
    mergeSessionPatch({ players: payload.items || [] })
    break
  }
  case 'livematch': {
    const [couponsPayload, couplesPayload, queuePayload] = await Promise.all([
      api(`/api/sessions/${state.session.id}/coupons?all=1`),
      api(`/api/sessions/${state.session.id}/couples?all=1`),
      api(`/api/sessions/${state.session.id}/queue`)
    ])
    void couponsPayload
    mergeSessionPatch({ couples: couplesPayload.items || [], ...queuePayload })
    break
  }
  case 'queue':
    mergeSessionPatch(await api(`/api/sessions/${state.session.id}/queue`))
    break
  case 'liveboard':
    mergeSessionPatch(await api(`/api/sessions/${state.session.id}/live`))
    break
  case 'history':
    mergeSessionPatch(await api(`/api/sessions/${state.session.id}/history`))
    break
  case 'settings':
    mergeSessionPatch(await api(`/api/sessions/${state.session.id}/settings`))
    break
  case 'liveShareHours':
    mergeSessionPatch(await api(`/api/sessions/${state.session.id}/live-share-hours`))
    break
  default:
    break
  }
}

async function selectAdminTab(tabId) {
  if (state.tab === tabId && ui.loadingTab) return
  const previousTab = state.tab
  state.tab = tabId
  if (!state.session.unlocked || tabId === 'home') return
  ui.loadingTab = tabId
  try {
    await reloadAdminTab(tabId)
  } catch (error) {
    state.tab = tabId || previousTab
    showToast(error.message || 'โหลดข้อมูลล่าสุดไม่สำเร็จ')
  } finally {
    ui.loadingTab = ''
  }
}

onMounted(() => {
  state.theme = persistTheme(readStoredTheme())
  installDomTranslator(() => document.body)
  const params = new URLSearchParams(window.location.search)
  if (params.get('mode')) {
    forms.authMode = params.get('mode')
  }
  if (verifyEmail.isPage) {
    confirmVerifyEmail(params.get('token'))
    return
  }
  if (backoffice.isPage) return
  const resetToken = params.get('token')
  if (window.location.pathname === '/reset-password' && resetToken) {
    forms.authMode = 'reset'
    forms.resetToken = resetToken
  }
  loadSharedView()
  restoreAdminAccount()
})

async function confirmVerifyEmail(token) {
  if (!token) {
    verifyEmail.status = 'error'
    verifyEmail.message = 'ไม่พบ token สำหรับยืนยันอีเมล กรุณาเปิดลิงก์จากอีเมลอีกครั้ง'
    return
  }
  verifyEmail.status = 'loading'
  verifyEmail.message = 'กรุณารอสักครู่ ระบบกำลังตรวจสอบลิงก์ยืนยันอีเมลของคุณ'
  try {
    await api(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
    verifyEmail.status = 'success'
    verifyEmail.message = 'บัญชี admin ของคุณพร้อมใช้งานแล้ว สามารถเข้าสู่ระบบและสร้าง session ได้เลย'
  } catch (error) {
    verifyEmail.status = 'error'
    verifyEmail.message = error.message || 'ลิงก์ยืนยันอีเมลหมดอายุหรือถูกใช้งานไปแล้ว'
  }
}

onUnmounted(() => {
  stopSharedRefresh()
})

async function saveSettings() {
  if (!ensureSessionActive()) return
  applyServerState(await api(`/api/sessions/${state.session.id}/settings`, {
    method: 'PUT',
    body: JSON.stringify(state.settings)
  }))
}

async function loginAdmin() {
  forms.authError = ''
  forms.authMessage = ''
  auth.loading = true
  try {
    applyAdminPayload(await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: forms.authEmail, password: forms.authPassword })
    }))
    forms.authPassword = ''
  } catch (error) {
    forms.authError = error.message || 'เข้าสู่ระบบไม่สำเร็จ'
  } finally {
    auth.loading = false
  }
}

async function registerAdmin() {
  forms.authError = ''
  forms.authMessage = ''
  auth.loading = true
  try {
    await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: forms.authName, email: forms.authEmail, password: forms.authPassword })
    })
    forms.authMessage = 'ส่งอีเมลยืนยันแล้ว กรุณาตรวจสอบกล่องอีเมล'
    forms.authPassword = ''
    forms.authMode = 'login'
  } catch (error) {
    forms.authError = error.message || 'สมัครสมาชิกไม่สำเร็จ'
  } finally {
    auth.loading = false
  }
}

async function forgotPassword() {
  forms.authError = ''
  forms.authMessage = ''
  auth.loading = true
  try {
    await api('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: forms.authEmail })
    })
    forms.authMessage = 'ส่งอีเมลรีเซ็ตรหัสผ่านแล้ว'
  } catch (error) {
    forms.authError = error.message || 'ส่งอีเมลรีเซ็ตไม่สำเร็จ'
  } finally {
    auth.loading = false
  }
}

async function resetPassword() {
  forms.authError = ''
  forms.authMessage = ''
  auth.loading = true
  try {
    await api('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: forms.resetToken, password: forms.authPassword })
    })
    forms.authMessage = 'รีเซ็ตรหัสผ่านแล้ว กรุณาเข้าสู่ระบบ'
    forms.authPassword = ''
    forms.authMode = 'login'
  } catch (error) {
    forms.authError = error.message || 'รีเซ็ตรหัสผ่านไม่สำเร็จ'
  } finally {
    auth.loading = false
  }
}

async function openOwnedSession(sessionId) {
  try {
    const nextState = await api(`/api/sessions/${sessionId}/dashboard?open=1`)
    mergeSessionPatch(nextState)
    const fullState = await api(`/api/sessions/${sessionId}/state`)
    applyServerState(fullState)
    state.session.unlocked = true
    state.tab = 'dashboard'
    if (state.session.expired) {
      showToast('session นี้ครบ 3 วันแล้ว เปิดดูย้อนหลังได้ แต่ต้องสร้าง session ใหม่เพื่อจัดต่อ', 'info')
    }
  } catch (error) {
    showToast(error.message || 'เปิด session ไม่สำเร็จ')
  }
}

async function refreshAdminSupervisor() {
  try {
    applyAdminPayload(await api('/api/admin/supervisor'))
  } catch (error) {
    showToast(error.message || 'โหลด dashboard admin ไม่สำเร็จ')
  }
}

async function backToAdminDashboard() {
  state.session.unlocked = false
  state.tab = 'home'
  await refreshAdminSupervisor()
}

async function loadBackoffice() {
  forms.backofficeError = ''
  backoffice.loading = true
  try {
  forms.backofficeSummary = await api('/api/backoffice/summary', {
      headers: backofficeAuthHeaders()
    })
    forms.backofficeLiveMatchCost = forms.backofficeSummary.liveMatchSessionCost
    forms.backofficeLiveShareCost = forms.backofficeSummary.liveShareSessionCost
    syncBackofficeCoinShopForms()
    backoffice.unlocked = true
  } catch (error) {
    forms.backofficeError = error.message || 'เข้าสู่หลังบ้านไม่สำเร็จ'
  } finally {
    backoffice.loading = false
  }
}

async function openBackofficeAdminDetail(adminId) {
  forms.backofficeError = ''
  try {
    forms.backofficeAdminDetail = await api(`/api/backoffice/admins/${adminId}`, {
      headers: backofficeAuthHeaders()
    })
    ui.showBackofficeAdminModal = true
  } catch (error) {
    forms.backofficeError = error.message || 'โหลดรายละเอียด admin ไม่สำเร็จ'
  }
}

function syncBackofficeCoinShopForms() {
  const summary = forms.backofficeSummary || {}
  forms.backofficeCoinPackages = (summary.coinPackages || []).map((item) => ({ ...item }))
  forms.backofficeCoinPaymentQrImage = summary.coinPaymentQrImage || ''
  forms.backofficePromptPayId = summary.promptPayId || ''
  forms.backofficePromptPayType = summary.promptPayType || 'mobile'
  forms.backofficePromptPayReceiverName = summary.promptPayReceiverName || ''
  forms.backofficeTelegramBotToken = summary.telegramBotToken || ''
  forms.backofficeTelegramChatId = summary.telegramChatId || ''
  forms.backofficeTelegramWebhookSecret = summary.telegramWebhookSecret || ''
}

async function saveBackofficeSettings() {
  forms.backofficeError = ''
  try {
    forms.backofficeSummary = await api('/api/backoffice/settings', {
      method: 'PUT',
      headers: backofficeAuthHeaders(),
      body: JSON.stringify({
        liveMatchSessionCost: Number(forms.backofficeLiveMatchCost),
        liveShareSessionCost: Number(forms.backofficeLiveShareCost)
      })
    })
  } catch (error) {
    forms.backofficeError = error.message || 'บันทึกราคา coin ไม่สำเร็จ'
  }
}

async function saveBackofficeCoinShop() {
  forms.backofficeError = ''
  try {
    forms.backofficeSummary = await api('/api/backoffice/coin-shop', {
      method: 'PUT',
      headers: backofficeAuthHeaders(),
      body: JSON.stringify({
        packages: forms.backofficeCoinPackages,
        paymentQrImage: forms.backofficeCoinPaymentQrImage,
        promptPayId: forms.backofficePromptPayId,
        promptPayType: forms.backofficePromptPayType,
        promptPayReceiverName: forms.backofficePromptPayReceiverName,
        telegramBotToken: forms.backofficeTelegramBotToken,
        telegramChatId: forms.backofficeTelegramChatId,
        telegramWebhookSecret: forms.backofficeTelegramWebhookSecret
      })
    })
    syncBackofficeCoinShopForms()
  } catch (error) {
    forms.backofficeError = error.message || 'บันทึกโปรโมชัน coin ไม่สำเร็จ'
  }
}

function addBackofficeCoinPackage() {
  forms.backofficeCoinPackages.push({
    id: '',
    name: 'แพ็กเกจใหม่',
    priceThb: 100,
    coins: 100,
    bonusText: '',
    active: true,
    sortOrder: forms.backofficeCoinPackages.length + 1
  })
}

function removeBackofficeCoinPackage(index) {
  forms.backofficeCoinPackages.splice(index, 1)
}

async function adjustBackofficeCoins() {
  forms.backofficeError = ''
  try {
    forms.backofficeSummary = await api('/api/backoffice/coins', {
      method: 'POST',
      headers: backofficeAuthHeaders(),
      body: JSON.stringify({
        adminId: forms.backofficeCoinAdminId,
        delta: Number(forms.backofficeCoinDelta),
        note: forms.backofficeCoinNote
      })
    })
    forms.backofficeCoinDelta = 0
    forms.backofficeCoinNote = ''
  } catch (error) {
    forms.backofficeError = error.message || 'ปรับ coin ไม่สำเร็จ'
  }
}

async function reviewBackofficeCoinOrder(orderId, status) {
  forms.backofficeError = ''
  try {
    forms.backofficeSummary = await api(`/api/backoffice/coin-orders/${orderId}/${status === 'approved' ? 'approve' : 'reject'}`, {
      method: 'POST',
      headers: backofficeAuthHeaders(),
      body: JSON.stringify({ note: status === 'rejected' ? forms.backofficeRejectNote : '' })
    })
    forms.backofficeRejectOrderId = ''
    forms.backofficeRejectNote = ''
    syncBackofficeCoinShopForms()
  } catch (error) {
    forms.backofficeError = error.message || 'อัปเดตรายการซื้อ coin ไม่สำเร็จ'
  }
}

function applyAdminPayload(payload) {
  auth.user = payload.user || null
  auth.sessions = payload.sessions || []
  auth.coinLedger = payload.coinLedger || []
  auth.liveMatchSessionCost = payload.liveMatchSessionCost ?? null
  auth.liveShareSessionCost = payload.liveShareSessionCost ?? null
}

function applyCoinShopPayload(payload) {
  auth.coinPackages = payload.packages || []
  auth.coinPaymentQrImage = payload.paymentQrImage || ''
  auth.promptPayId = payload.promptPayId || ''
  auth.promptPayType = payload.promptPayType || 'mobile'
  auth.promptPayReceiverName = payload.promptPayReceiverName || ''
  auth.promptPayPayloads = payload.promptPayPayloads || {}
  auth.promptPayAvailable = Boolean(payload.promptPayAvailable)
  auth.coinOrders = payload.orders || []
  if (!forms.coinSelectedPackageId && auth.coinPackages.length) {
    forms.coinSelectedPackageId = auth.coinPackages[0].id
  }
  refreshCoinPaymentQr()
}

async function openCoinModal(mode = 'shop') {
  forms.coinModalMode = mode
  ui.showCoinModal = true
  if (mode === 'shop') await loadCoinShop()
}

async function loadCoinShop() {
  if (!auth.user) return
  try {
    applyCoinShopPayload(await api('/api/admin/coin-shop'))
  } catch (error) {
    showToast(error.message || 'โหลดร้าน coin ไม่สำเร็จ')
  }
}

async function submitCoinOrder() {
  forms.coinOrderStatus = ''
  try {
    const payload = await api('/api/admin/coin-orders', {
      method: 'POST',
      body: JSON.stringify({
        packageId: forms.coinSelectedPackageId,
        slipImage: forms.coinSlipImage
      })
    })
    applyCoinShopPayload(payload)
    forms.coinSlipImage = ''
    forms.coinOrderStatus = 'ส่งรายการซื้อแล้ว รอ backoffice ตรวจสอบ'
    await restoreAdminAccount()
  } catch (error) {
    forms.coinOrderStatus = error.message || 'ส่งรายการซื้อ coin ไม่สำเร็จ'
  }
}

async function restoreAdminAccount() {
  if (share.isPublic) return
  try {
    applyAdminPayload(await api('/api/auth/me'))
  } catch {
    auth.user = null
  }
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' })
  } catch {
    // Local state is still cleared if the backend session is already gone.
  }
  auth.user = null
  auth.sessions = []
  auth.coinLedger = []
  state.session.unlocked = false
  state.tab = 'home'
  forms.authPassword = ''
  forms.loginError = ''
}

watch(
  () => state.theme,
  (theme) => {
    state.theme = persistTheme(theme)
  },
  { immediate: true }
)

function toggleTheme() {
  state.theme = persistTheme(state.theme === 'dark' ? 'light' : 'dark')
}

const playerById = (id) => state.players.find((player) => player.id === id)
const playerName = (id) => playerById(id)?.name || '-'
const levelLabel = (level) => levelText(level)
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
const isLiveShare = computed(() => state.session.type === 'liveShare')
const isSessionExpired = computed(() => Boolean(state.session.expired))
const showAppHeader = computed(() => !((isAdmin.value && state.tab === 'home') || (!auth.user && !isAdmin.value)))

const queuedPlayerIds = computed(() => new Set([...state.pending, ...state.queue].flatMap(matchPlayers)))
const livePlayerIds = computed(() => new Set(state.live.flatMap(matchPlayers)))
const activePlayers = computed(() => state.players.filter((player) => player.active))
const realHistoryMatches = computed(() => state.history.filter((match) => !isCancelledMatch(match)))
const cancelledMatches = computed(() => state.history.filter(isCancelledMatch))
const activePlayerCount = computed(() => activePlayers.value.length)
const liveShareShuttleCount = computed(() => Object.values(state.liveShare?.shuttleHours || {}).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0))
const totalShuttles = computed(() => (
  isLiveShare.value
    ? liveShareShuttleCount.value
    : state.live.reduce((sum, match) => sum + match.shuttles, 0) + realHistoryMatches.value.reduce((sum, match) => sum + match.shuttles, 0)
))
const totalRecordedMatches = computed(() => state.live.length + realHistoryMatches.value.length)
const totalPlays = computed(() => activePlayers.value.reduce((sum, player) => sum + player.games, 0))
const averageGames = computed(() => activePlayerCount.value ? totalPlays.value / activePlayerCount.value : 0)
const liveShareCourtHours = computed(() => Object.values(state.liveShare?.courtHours || {}).reduce((sum, hours) => sum + normalizedHours(hours).length, 0))
const liveSharePlayerHours = computed(() => activePlayers.value.reduce((sum, player) => sum + playerLiveShareHours(player.id), 0))
const liveShareCourtCost = computed(() => liveShareCourtHours.value * Number(state.settings.courtFeePerHour || 0))
const liveShareShuttleCost = computed(() => liveShareShuttleCount.value * Number(state.settings.shuttleFee || 0))
const liveShareSessionCost = computed(() => Math.max(0, Number(state.settings.sessionFee || 0)))
const liveShareTotalCost = computed(() => liveShareCourtCost.value + liveShareShuttleCost.value + liveShareSessionCost.value)
const totalRevenue = computed(() => activePlayers.value.reduce((sum, player) => sum + playerCost(player), 0))
const paidRevenue = computed(() => activePlayers.value.filter((player) => player.paid).reduce((sum, player) => sum + playerCost(player), 0))
const unpaidRevenue = computed(() => Math.max(0, totalRevenue.value - paidRevenue.value))
const paymentPercent = computed(() => totalRevenue.value ? Math.round((paidRevenue.value / totalRevenue.value) * 100) : 0)
const unpaidPlayers = computed(() => activePlayers.value.filter((player) => !player.paid))
const minGames = computed(() => (activePlayers.value.length ? Math.min(...activePlayers.value.map((player) => player.games)) : 0))
const maxGames = computed(() => (activePlayers.value.length ? Math.max(...activePlayers.value.map((player) => player.games)) : 0))
const topPlayers = computed(() => [...activePlayers.value].sort((a, b) => b.games - a.games || a.id - b.id).slice(0, 4))
const quietPlayers = computed(() => [...activePlayers.value].sort((a, b) => a.games - b.games || a.id - b.id).slice(0, 4))
const playerScore = (player) => (player.wins || 0) + (player.draws || 0) * 0.5
const topWinners = computed(() => [...activePlayers.value].sort((a, b) => playerScore(b) - playerScore(a) || (b.wins || 0) - (a.wins || 0) || (a.losses || 0) - (b.losses || 0) || a.id - b.id).slice(0, 5))
const usedCourts = computed(() => new Set(state.live.map((match) => match.court)))
const availableCourtNames = computed(() => state.settings.courtNames.filter((court) => !usedCourts.value.has(court)))
const usedCourtNames = computed(() => new Set([...state.queue, ...state.live, ...state.history].map((match) => match.court).filter((court) => court && court !== '-')))
const usedLevels = computed(() => new Set([
  ...state.players.map((player) => player.level),
  ...state.pending.map((match) => match.level),
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
  ...(isLiveShare.value ? [{ label: 'ค่าคอร์ด/ค่าสนาม', value: money(liveShareCourtCost.value), icon: Coins }] : []),
  { label: 'รายรับรวม', value: money(totalRevenue.value), icon: CreditCard }
])

function matchPlayers(match) {
  return [match.a1, match.a2, match.b1, match.b2]
}

function normalizedHours(hours = []) {
  return [...new Set((hours || []).map((hour) => Number(hour)).filter((hour) => Number.isInteger(hour) && hour > 0))].sort((a, b) => a - b)
}

function playerLiveShareHours(playerId) {
  return normalizedHours(state.liveShare?.playerHours?.[String(playerId)] || []).length
}

function liveShareActiveHoursList() {
  const hours = new Set()
  for (const item of Object.values(state.liveShare?.courtHours || {})) {
    normalizedHours(item).forEach((hour) => hours.add(hour))
  }
  for (const item of Object.values(state.liveShare?.playerHours || {})) {
    normalizedHours(item).forEach((hour) => hours.add(hour))
  }
  for (const [hour, quantity] of Object.entries(state.liveShare?.shuttleHours || {})) {
    if (Number(quantity || 0) > 0) hours.add(Number(hour))
  }
  return [...hours].sort((a, b) => a - b)
}

function liveShareCourtCountForHour(hour) {
  return Object.values(state.liveShare?.courtHours || {}).filter((hours) => normalizedHours(hours).includes(hour)).length
}

function liveSharePlayerCountForHour(hour) {
  return activePlayers.value.filter((player) => normalizedHours(state.liveShare?.playerHours?.[String(player.id)] || []).includes(hour)).length
}

function liveShareHourlyPlayerCost(player) {
  const activeHours = liveShareActiveHoursList()
  if (!activeHours.length) return 0
  return normalizedHours(state.liveShare?.playerHours?.[String(player.id)] || []).reduce((sum, hour) => {
    const playerCount = liveSharePlayerCountForHour(hour)
    if (!playerCount) return sum
    const hourCourtCost = liveShareCourtCountForHour(hour) * Number(state.settings.courtFeePerHour || 0)
    const hourShuttleCost = Math.max(0, Number(state.liveShare?.shuttleHours?.[String(hour)] || 0)) * Number(state.settings.shuttleFee || 0)
    const numerator = (hourCourtCost + hourShuttleCost) * activeHours.length + liveShareSessionCost.value
    const denominator = activeHours.length * playerCount
    return sum + Math.ceil(numerator / denominator)
  }, 0)
}

function playerCost(player) {
  if (isLiveShare.value) {
    return liveShareHourlyPlayerCost(player)
  }
  return state.settings.entryFee + player.shuttles * state.settings.shuttleFee + sessionFeeShare.value
}

const sessionFeeShare = computed(() => {
  if (!activePlayerCount.value || !state.settings.sessionFee) return 0
  return Math.ceil(Number(state.settings.sessionFee || 0) / activePlayerCount.value)
})

function money(value) {
  return new Intl.NumberFormat(language.value === 'en' ? 'en-US' : 'th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(value)
}

function coinReasonText(item) {
  if (item.reason === 'create_session') return 'ใช้สร้าง session'
  if (item.reason === 'coin_purchase') return 'ซื้อ coin'
  if (item.reason === 'manual_adjustment' && item.delta > 0) return 'เติม coin โดยแอดมิน'
  if (item.reason === 'manual_adjustment' && item.delta < 0) return 'หัก coin โดยแอดมิน'
  return item.reason || 'รายการ coin'
}

function requestBuyCoin() {
  openCoinModal()
}

function coinOrderStatusText(status) {
  if (status === 'approved') return 'อนุมัติแล้ว'
  if (status === 'rejected') return 'ไม่อนุมัติ'
  return 'รอตรวจสอบ'
}

function coinOrderStatusClass(status) {
  if (status === 'approved') return 'bg-court-500/10 text-court-700 dark:text-court-300'
  if (status === 'rejected') return 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200'
  return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
}

function selectedCoinPackage() {
  return auth.coinPackages.find((item) => item.id === forms.coinSelectedPackageId) || auth.coinPackages[0] || null
}

const coinPaymentQrReady = computed(() => Boolean(forms.coinPaymentQrDataUrl || auth.coinPaymentQrImage))
const selectedPromptPayPayload = computed(() => auth.promptPayPayloads?.[forms.coinSelectedPackageId] || '')

async function refreshCoinPaymentQr() {
  const payload = selectedPromptPayPayload.value
  if (payload) {
    try {
      forms.coinPaymentQrDataUrl = await QRCode.toDataURL(payload, {
        margin: 1,
        width: 256,
        color: { dark: '#1c1917', light: '#ffffff' }
      })
      return
    } catch {
      forms.coinPaymentQrDataUrl = ''
    }
  }
  forms.coinPaymentQrDataUrl = ''
}

watch(
  () => [forms.coinSelectedPackageId, auth.promptPayPayloads],
  () => {
    refreshCoinPaymentQr()
  },
  { deep: true }
)

function readImageFile(file, callback) {
  if (!file) return
  if (!file.type.startsWith('image/')) {
    showToast('กรุณาเลือกไฟล์รูปภาพ')
    return
  }
  const reader = new FileReader()
  reader.onload = () => callback(String(reader.result || ''))
  reader.onerror = () => showToast('อ่านไฟล์รูปไม่สำเร็จ')
  reader.readAsDataURL(file)
}

function handleCoinSlipFile(event) {
  readImageFile(event.target.files?.[0], (dataUrl) => {
    forms.coinSlipImage = dataUrl
  })
}

function handleBackofficeQrFile(event) {
  readImageFile(event.target.files?.[0], (dataUrl) => {
    forms.backofficeCoinPaymentQrImage = dataUrl
  })
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
  forms.loginError = t('Passcode ไม่ถูกต้อง', 'Incorrect passcode')
}

function addPlayer() {
  const name = forms.newPlayerName.trim()
  if (!name) return
  const id = Math.max(...state.players.map((player) => player.id), 0) + 1
  state.players.push({ id, name, games: 0, wins: 0, draws: 0, losses: 0, shuttles: 0, paid: false, active: true, level: 'middle', coupon: false })
  forms.newPlayerName = ''
}

function renamePlayer(player, name) {
  const nextName = name.trim()
  if (!nextName) return
  player.name = nextName
}

function deletePlayer(player) {
  const reasons = playerDeleteBlockReasons(player.id)
  if (reasons.length) {
    throw new Error(`ลบไม่ได้: ${reasons.join(', ')}`)
  }
  state.players = state.players.filter((item) => item.id !== player.id)
}

function playerReferenced(playerId) {
  return playerDeleteBlockReasons(playerId).length > 0
}

function playerDeleteBlockReasons(playerId) {
  const reasons = []
  if (state.couples.some((couple) => couple.a === playerId || couple.b === playerId)) reasons.push('มีคู่จับ')
  if (state.pending.some((match) => matchPlayers(match).includes(playerId))) reasons.push('อยู่ในรายการจับคู่')
  if (state.queue.some((match) => matchPlayers(match).includes(playerId))) reasons.push('รอคิว')
  if (state.live.some((match) => matchPlayers(match).includes(playerId))) reasons.push('กำลังแข่ง')
  if (state.history.some((match) => matchPlayers(match).includes(playerId))) reasons.push('มีประวัติ')
  return reasons
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

    state.pending.push({
      id: nextPendingId(),
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
      for (const poolLevels of adjacentLevelWindows(level)) {
        const selected = pickFourGroups(groups.filter((group) => poolLevels.includes(group.level)))
        if (selected.length === 4) return { selected, level }
      }
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
    for (const poolLevels of adjacentLevelWindows(level)) {
      const pool = groups.filter((group) => poolLevels.includes(group.level))
      const selected = pickFourGroups(pool)
      if (selected.length === 4) {
        const games = selectedGroupGames(pool, selected)
        if (games < best.games) best = { selected, level, games }
      }
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

function adjacentLevelWindows(level) {
  const index = state.settings.levels.indexOf(level)
  if (index < 0) return []
  return [
    index > 0 ? [level, state.settings.levels[index - 1]] : null,
    index < state.settings.levels.length - 1 ? [level, state.settings.levels[index + 1]] : null
  ].filter(Boolean)
}

function pickFourGroups(groups) {
  return pickFourGroupsFrom(groups, 0, [])
}

function pickFourGroupsFrom(groups, index, selected) {
  if (selected.length === 4) return selected
  if (selected.length > 4 || index >= groups.length) return selected
  const group = groups[index]
  if (selected.length + group.ids.length <= 4) {
    const withGroup = pickFourGroupsFrom(groups, index + 1, [...selected, ...group.ids])
    if (withGroup.length === 4) return withGroup
  }
  return pickFourGroupsFrom(groups, index + 1, selected)
}

function startMatch(match, court = '') {
  if (!court) return
  if (!matchLevelsAllowed(match)) return
  state.queue = state.queue.filter((item) => item.id !== match.id)
  const started = { ...match, court, shuttles: 0, shuttleSequence: '', status: 'กำลังเล่น', startedAt: currentTime() }
  if (state.settings.startMatchWithShuttle) {
    started.shuttles = 1
    started.shuttleSequence = appendShuttleNumber(started.shuttleSequence, nextShuttleNumber())
  }
  state.live.push(started)
  state.tab = 'liveboard'
}

function matchLevelsAllowed(match) {
  const indexes = matchPlayers(match).map((id) => state.settings.levels.indexOf(playerById(id)?.level || ''))
  if (indexes.some((index) => index < 0)) return false
  const min = Math.min(...indexes)
  const max = Math.max(...indexes)
  return min === max || (state.settings.allowCrossLevel && max - min <= 1)
}

function confirmPendingMatch(match) {
  state.pending = state.pending.filter((item) => item.id !== match.id)
  state.queue.push({ ...match, id: nextGameId(), court: '-' })
}

function cancelPendingMatch(match) {
  state.pending = state.pending.filter((item) => item.id !== match.id)
}

function cancelQueuedMatch(match) {
  state.queue = state.queue.filter((item) => item.id !== match.id)
  state.history.unshift({
    ...match,
    status: 'cancelled',
    winner: '',
    shuttles: 0,
    shuttleSequence: '',
    endedAt: currentTime(),
    note: match.note || 'ยกเลิกคิว'
  })
  delete forms.matchCourts[match.id]
}

function adjustShuttle(match, delta) {
  if (delta <= 0) return
  for (let index = 0; index < delta; index += 1) {
    const nextNumber = nextShuttleNumber()
    match.shuttles += 1
    match.shuttleSequence = appendShuttleNumber(match.shuttleSequence || '', nextNumber)
  }
}

function closeLive(match, cancelled = false, note = '') {
  selectedLiveId.value = match.id
  const ended = {
    ...match,
    endedAt: currentTime(),
    winner: cancelled ? '' : forms.finishWinner,
    shuttleSequence: cancelled ? '' : (match.shuttleSequence || ''),
    status: cancelled ? 'cancelled' : 'finished',
    note: note || forms.finishNote || (cancelled ? 'ยกเลิกการแข่งขัน' : 'จบการแข่งขัน')
  }
  state.history.unshift(ended)
  for (const id of matchPlayers(match)) {
    const player = playerById(id)
    if (player && !cancelled) {
      player.games += 1
      player.shuttles += match.shuttles
      if (state.settings.resetPlayersAfterFinish) player.coupon = false
      const won = (ended.winner === 'A' && (id === match.a1 || id === match.a2)) || (ended.winner === 'B' && (id === match.b1 || id === match.b2))
      if (won) player.wins = (player.wins || 0) + 1
      else if (ended.winner === 'draw') player.draws = (player.draws || 0) + 1
      else if (ended.winner && ended.winner !== 'draw') player.losses = (player.losses || 0) + 1
    }
  }
  state.live = state.live.filter((item) => item.id !== match.id)
  forms.finishNote = ''
  selectedLiveId.value = null
}

function updateHistoryWinner(match, winner) {
  const normalizedWinner = ['A', 'B', 'draw'].includes(winner) ? winner : ''
  if (isCancelledMatch(match)) return
  applyResultStats(match, match.winner, -1)
  match.winner = normalizedWinner
  applyResultStats(match, normalizedWinner, 1)
}

function applyResultStats(match, winner, delta) {
  if (!['A', 'B', 'draw'].includes(winner)) return
  for (const id of matchPlayers(match)) {
    const player = playerById(id)
    if (!player) continue
    if (winner === 'draw') {
      player.draws = Math.max(0, (player.draws || 0) + delta)
      continue
    }
    const won = (winner === 'A' && (id === match.a1 || id === match.a2)) || (winner === 'B' && (id === match.b1 || id === match.b2))
    if (won) player.wins = Math.max(0, (player.wins || 0) + delta)
    else player.losses = Math.max(0, (player.losses || 0) + delta)
  }
}

function isCancelledMatch(match) {
  return match.status === 'cancelled'
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

function requestAddShuttle(match) {
  ui.shuttleMatch = match
  ui.showShuttleModal = true
}

async function confirmAddShuttle() {
  if (!ui.shuttleMatch) return
  await adjustShuttleApi(ui.shuttleMatch, 1)
  ui.shuttleMatch = null
  ui.showShuttleModal = false
}

function confirmCancelMatch() {
  if (!ui.cancelMatch) return
  closeLive(ui.cancelMatch, true, forms.cancelNote)
  ui.cancelMatch = null
  forms.cancelNote = ''
  ui.showCancelModal = false
}

function appendShuttleNumber(sequence, number) {
  return sequence ? `${sequence},${number}` : `${number}`
}

function nextShuttleNumber() {
  const matches = [...state.live, ...state.history]
  const maxSequence = matches.reduce((max, match) => Math.max(max, maxShuttleSequenceNumber(match.shuttleSequence || '')), 0)
  const legacyCount = matches
    .filter((match) => !match.shuttleSequence)
    .reduce((sum, match) => sum + (match.shuttles || 0), 0)
  return Math.max(maxSequence, legacyCount) + 1
}

function maxShuttleSequenceNumber(sequence) {
  return sequence.split(',').reduce((max, part) => {
    const value = part.trim()
    if (!value) return max
    const end = value.split('-').pop()
    const number = Number.parseInt(end, 10)
    return Number.isFinite(number) ? Math.max(max, number) : max
  }, 0)
}

function addCouple() {
  const a = Number(forms.coupleAId)
  const b = Number(forms.coupleBId)
  if (!a || !b || a === b) return
  state.couples = state.couples.filter((couple) => couple.a !== a && couple.b !== a && couple.a !== b && couple.b !== b)
  state.couples.push({ id: Date.now(), a, b })
  syncNewCouple(a, b)
  forms.coupleAId = ''
  forms.coupleBId = ''
}

function removeCouple(id) {
  state.couples = state.couples.filter((couple) => couple.id !== id)
}

function syncNewCouple(a, b) {
  const source = playerById(a)
  const mate = playerById(b)
  if (!source || !mate) return
  mate.level = source.level
  mate.coupon = source.coupon
}

function syncCoupledPlayerStatus(playerId) {
  const couple = state.couples.find((item) => item.a === playerId || item.b === playerId)
  if (!couple) return
  const source = playerById(playerId)
  const mate = playerById(couple.a === playerId ? couple.b : couple.a)
  if (!source || !mate) return
  mate.level = source.level
  mate.coupon = source.coupon
}

function nextGameId() {
  return Math.max(0, ...state.queue.map((m) => m.id), ...state.live.map((m) => m.id), ...state.history.map((m) => m.id)) + 1
}

function nextPendingId() {
  return Math.min(0, ...state.pending.map((m) => m.id)) - 1
}

function currentTime() {
  return new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
}

function addCourt() {
  if (!ensureSessionActive()) return
  const name = forms.newCourtName.trim()
  state.settings.courtNames.push(name || `สนาม ${state.settings.courtNames.length + 1}`)
  state.settings.courtCount = state.settings.courtNames.length
  forms.newCourtName = ''
  saveSettings().catch(() => {})
}

function removeCourt(index) {
  if (!ensureSessionActive()) return
  if (state.settings.courtNames.length <= 1) return
  if (usedCourtNames.value.has(state.settings.courtNames[index])) return
  state.settings.courtNames.splice(index, 1)
  state.settings.courtCount = state.settings.courtNames.length
  saveSettings().catch(() => {})
}

function addLevel() {
  if (!ensureSessionActive()) return
  const level = forms.newLevelName.trim()
  if (!level || state.settings.levels.includes(level)) return
  state.settings.levels.push(level)
  forms.newLevelName = ''
  saveSettings().catch(() => {})
}

function removeLevel(index) {
  if (!ensureSessionActive()) return
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

function queueShareLink() {
  const params = new URLSearchParams({
    view: 'queue',
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

async function copyQueueLink() {
  forms.shareLink = queueShareLink()
  forms.shareStatus = ''
  try {
    await navigator.clipboard.writeText(forms.shareLink)
    forms.shareStatus = 'คัดลอกลิงก์แล้ว'
    showToast('คัดลอกลิงก์แล้ว', 'success')
  } catch {
    forms.shareStatus = 'คัดลอกอัตโนมัติไม่ได้ ใช้ลิงก์ด้านล่างได้เลย'
    showToast(forms.shareStatus)
  }
}

async function openQr(title, link) {
  forms.qrTitle = title
  forms.qrLink = link
  forms.qrStatus = ''
  forms.qrDataUrl = await QRCode.toDataURL(link, {
    width: 320,
    margin: 2,
    color: {
      dark: '#191b18',
      light: '#fbfaf4'
    }
  })
  ui.showQrModal = true
}

function openPlayersQr() {
  return openQr('QR ลิงก์สมาชิก', playerShareLink())
}

function openQueueQr() {
  return openQr('QR ลิงก์คิวจัดคู่', queueShareLink())
}

async function copyQrLink() {
  try {
    await navigator.clipboard.writeText(forms.qrLink)
    forms.qrStatus = 'คัดลอกลิงก์แล้ว'
  } catch {
    forms.qrStatus = 'คัดลอกอัตโนมัติไม่ได้ ใช้ลิงก์ด้านล่างได้เลย'
  }
}

function startSharedRefresh() {
  if (sharedRefreshTimer) return
  sharedRefreshTimer = window.setInterval(() => {
    loadSharedView({ silent: true })
  }, 30000)
}

function stopSharedRefresh() {
  if (!sharedRefreshTimer) return
  window.clearInterval(sharedRefreshTimer)
  sharedRefreshTimer = null
}

async function loadSharedView({ silent = false } = {}) {
  const params = new URLSearchParams(window.location.search)
  const view = params.get('view')
  if (!['players', 'queue'].includes(view) || !params.get('session')) return
  share.isPublic = true
  share.view = view
  if (!silent) share.loading = true
  share.error = ''
  try {
    const nextState = await api(`/api/sessions/${params.get('session')}/state`)
    applyServerState(nextState)
    share.showPayment = state.settings.showPaymentOnShare
    state.session.unlocked = false
    startSharedRefresh()
  } catch {
    share.error = t('ไม่พบข้อมูล session นี้', 'Session not found')
  } finally {
    if (!silent) share.loading = false
  }
}

async function createSessionApi() {
  try {
    const record = await api('/api/admin/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: forms.sessionCreateName || forms.newSessionName, type: forms.sessionCreateType || 'liveMatch' })
    })
    applyServerState(record.state)
    applyAdminPayload(await api('/api/admin/supervisor'))
    ui.showCreateSessionModal = false
    forms.sessionCreateName = ''
    forms.sessionCreateType = 'liveMatch'
    forms.loginError = ''
    state.session.unlocked = true
    state.tab = 'dashboard'
  } catch (error) {
    showToast(error.message || 'สร้าง session ไม่สำเร็จ')
  }
}

async function unlockDashboardApi() {
  forms.loginError = 'ระบบ passcode ถูกยกเลิกแล้ว กรุณา login ด้วยบัญชี admin'
}

function ensureSessionActive() {
  if (!state.session.expired) return true
  showToast('session นี้ครบ 3 วันแล้ว กรุณาสร้าง session ใหม่เพื่อใช้งานต่อ')
  return false
}

async function addPlayerApi() {
  if (!ensureSessionActive()) return
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

async function renamePlayerApi(player, name) {
  if (!ensureSessionActive()) return
  const nextName = name.trim()
  if (!nextName || nextName === player.name) return
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/players/${player.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: nextName })
    }))
  } catch {
    renamePlayer(player, nextName)
  }
}

async function deletePlayerApi(player) {
  if (!ensureSessionActive()) return
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/players/${player.id}`, { method: 'DELETE' }))
  } catch (error) {
    if (error.status === 409) {
      showToast(error.message)
      throw error
    }
    try {
      deletePlayer(player)
    } catch (localError) {
      showToast(localError.message)
      throw localError
    }
  }
}

async function togglePaymentApi(player) {
  if (!ensureSessionActive()) return
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
  if (!ensureSessionActive()) return
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/players/${playerId}`, {
      method: 'PATCH',
      body: JSON.stringify({ level })
    }))
  } catch {
    const player = playerById(playerId)
    if (player) player.level = level
    syncCoupledPlayerStatus(playerId)
  }
}

async function updatePlayerRandomStatusApi(playerId, level) {
  if (!ensureSessionActive()) return
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
    syncCoupledPlayerStatus(playerId)
  }
}

async function randomMatchApi() {
  if (!ensureSessionActive()) return
  forms.randomError = ''
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/random`, { method: 'POST' }))
  } catch (error) {
    forms.randomError = error.message || t('สุ่มจับคู่ไม่สำเร็จ', 'Could not randomize pairs')
    showToast(forms.randomError)
  }
}

async function startMatchApi(match, court = '') {
  if (!ensureSessionActive()) return
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

async function confirmPendingMatchApi(match) {
  if (!ensureSessionActive()) return
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/pending/${match.id}/confirm`, { method: 'POST' }))
    state.tab = 'queue'
  } catch {
    confirmPendingMatch(match)
    state.tab = 'queue'
  }
}

async function cancelPendingMatchApi(match) {
  if (!ensureSessionActive()) return
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/pending/${match.id}`, { method: 'DELETE' }))
  } catch {
    cancelPendingMatch(match)
  }
}

async function cancelQueuedMatchApi(match) {
  if (!ensureSessionActive()) return
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/queue/${match.id}`, { method: 'DELETE' }))
  } catch {
    cancelQueuedMatch(match)
  }
}

async function adjustShuttleApi(match, delta) {
  if (!ensureSessionActive()) return
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
  if (!ensureSessionActive()) return
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

async function updateHistoryWinnerApi(match, winner) {
  if (!ensureSessionActive()) return
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/history/${match.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ winner })
    }))
  } catch {
    updateHistoryWinner(match, winner)
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
  if (!ensureSessionActive()) return
  const a = Number(forms.coupleAId)
  const b = Number(forms.coupleBId)
  if (!a || !b || a === b) return
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/couples`, {
      method: 'POST',
      body: JSON.stringify({ a, b })
    }))
    forms.coupleAId = ''
    forms.coupleBId = ''
  } catch {
    addCouple()
  }
}

async function removeCoupleApi(id) {
  if (!ensureSessionActive()) return
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/couples/${id}`, { method: 'DELETE' }))
  } catch {
    removeCouple(id)
  }
}

async function saveSettingsApi() {
  if (!ensureSessionActive()) return
  state.settings.crossLevelRange = 1
  if (isLiveShare.value) {
    state.settings.startMatchWithShuttle = false
  }
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/settings`, {
      method: 'PUT',
      body: JSON.stringify(state.settings)
    }))
  } catch {
    // Local fallback keeps manual testing usable if the backend is offline.
  }
}

async function saveLiveShareHoursApi() {
  if (!ensureSessionActive() || !isLiveShare.value) return
  state.liveShare.courtHours = Object.fromEntries(
    Object.entries(state.liveShare.courtHours || {}).map(([key, hours]) => [key, normalizedHours(hours)])
  )
  state.liveShare.playerHours = Object.fromEntries(
    Object.entries(state.liveShare.playerHours || {}).map(([key, hours]) => [key, normalizedHours(hours)])
  )
  state.liveShare.shuttleHours = Object.fromEntries(
    Object.entries(state.liveShare.shuttleHours || {})
      .map(([key, value]) => [String(Number(key)), Math.max(0, Math.floor(Number(value || 0)))])
      .filter(([key, value]) => Number(key) > 0 && value > 0)
  )
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/live-share-hours`, {
      method: 'PUT',
      body: JSON.stringify(state.liveShare)
    }))
    showToast('บันทึกชั่วโมงเล่นแล้ว', 'info')
  } catch (error) {
    showToast(error.message || 'บันทึกชั่วโมงเล่นไม่สำเร็จ')
  }
}

const pageProps = computed(() => ({
  state,
  forms,
  ui,
  activePlayerCount: activePlayerCount.value,
  totalRecordedMatches: totalRecordedMatches.value,
  cancelledMatches: cancelledMatches.value,
  averageGames: averageGames.value,
  minGames: minGames.value,
  maxGames: maxGames.value,
  totalShuttles: totalShuttles.value,
  paymentPercent: paymentPercent.value,
  totalRevenue: totalRevenue.value,
  paidRevenue: paidRevenue.value,
  unpaidRevenue: unpaidRevenue.value,
  liveShareCourtHours: liveShareCourtHours.value,
  liveSharePlayerHours: liveSharePlayerHours.value,
  liveShareCourtCost: liveShareCourtCost.value,
  liveShareShuttleCount: liveShareShuttleCount.value,
  liveShareShuttleCost: liveShareShuttleCost.value,
  liveShareSessionCost: liveShareSessionCost.value,
  liveShareTotalCost: liveShareTotalCost.value,
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
  playerLiveShareHours,
  playerDeleteBlockReasons,
  playerScore,
  levelLabel,
  matchLevelLabel,
  addPlayer: addPlayerApi,
  renamePlayer: renamePlayerApi,
  deletePlayer: deletePlayerApi,
  sharePlayers,
  copyQueueLink,
  openPlayersQr,
  openQueueQr,
  copyQrLink,
  togglePayment: togglePaymentApi,
  updatePlayerLevel: updatePlayerLevelApi,
  updatePlayerRandomStatus: updatePlayerRandomStatusApi,
  randomMatch: randomMatchApi,
  confirmPendingMatch: confirmPendingMatchApi,
  cancelPendingMatch: cancelPendingMatchApi,
  startMatch: startMatchApi,
  cancelQueuedMatch: cancelQueuedMatchApi,
  playerName,
  requestAddShuttle,
  confirmAddShuttle,
  closeLive: closeLiveApi,
  requestFinishMatch,
  confirmFinishMatch: confirmFinishMatchApi,
  requestCancelMatch,
  confirmCancelMatch: confirmCancelMatchApi,
  updateHistoryWinner: updateHistoryWinnerApi,
  addCouple: addCoupleApi,
  removeCouple: removeCoupleApi,
  addCourt,
  removeCourt,
  addLevel,
  removeLevel,
  saveSettings: saveSettingsApi,
  saveLiveShareHours: saveLiveShareHoursApi,
  selectAdminTab,
  language: language.value,
  toggleLanguage,
  toggleTheme,
  auth,
  backoffice,
  verifyEmail,
  loginAdmin,
  registerAdmin,
  forgotPassword,
  resetPassword,
  openOwnedSession,
  refreshAdminSupervisor,
  backToAdminDashboard,
  logout,
  coinReasonText,
  coinOrderStatusText,
  coinOrderStatusClass,
  selectedCoinPackage,
  requestBuyCoin,
  openCoinModal,
  loadCoinShop,
  submitCoinOrder,
  handleCoinSlipFile,
  handleBackofficeQrFile,
  createSession: createSessionApi,
  unlockDashboard: unlockDashboardApi,
  loadBackoffice,
  openBackofficeAdminDetail,
  saveBackofficeSettings,
  saveBackofficeCoinShop,
  addBackofficeCoinPackage,
  removeBackofficeCoinPackage,
  adjustBackofficeCoins,
  reviewBackofficeCoinOrder
}))
</script>

<template>
  <div class="min-h-screen bg-paper-50 text-stone-900 transition dark:bg-paper-900 dark:text-stone-100">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-y-2 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-2 opacity-0"
    >
      <div
        v-if="ui.toast"
        class="fixed inset-x-3 top-3 z-50 mx-auto flex max-w-md items-start justify-between gap-3 rounded-md border p-3 shadow-soft sm:left-auto sm:right-4 sm:mx-0"
        :class="ui.toast.type === 'error' ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100' : 'border-court-500 bg-white text-stone-900 dark:border-court-600 dark:bg-stone-900 dark:text-stone-100'"
        role="status"
        aria-live="polite"
      >
        <span class="text-sm font-bold leading-6">{{ ui.toast.message }}</span>
        <button class="grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10" aria-label="ปิดแจ้งเตือน" @click="closeToast">
          <X class="h-4 w-4" />
        </button>
      </div>
    </Transition>

    <VerifyEmailPage v-if="verifyEmail.isPage" v-bind="pageProps" />
    <BackofficePage v-else-if="backoffice.isPage" v-bind="pageProps" />

    <SharedPlayersPage v-else-if="share.isPublic && share.view === 'players'" :state="state" :share="share" :money="money" :player-cost="playerCost" />
    <SharedQueuePage v-else-if="share.isPublic && share.view === 'queue'" :state="state" :share="share" :player-name="playerName" :match-level-label="matchLevelLabel" />

    <template v-else>
    <header v-if="showAppHeader" class="sticky top-0 z-30 border-b border-stone-200/80 bg-paper-50/95 backdrop-blur dark:border-stone-700 dark:bg-paper-900/95">
      <div class="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-3 sm:gap-3 sm:px-4">
        <button class="flex min-w-0 items-center gap-2 text-left sm:gap-3" @click="isAdmin ? selectAdminTab('dashboard') : state.tab = 'home'">
          <span class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-court-500 text-white shadow-soft">
            <Medal class="h-5 w-5" />
          </span>
          <span class="hidden min-w-0 xs:block sm:block">
            <span class="block truncate text-base font-black leading-5 sm:text-lg">LiveMatch</span>
            <span class="block truncate text-xs text-stone-500 dark:text-stone-400">{{ isAdmin ? currentTab.label : (auth.user ? 'Admin dashboard' : 'Admin access') }}</span>
          </span>
        </button>
        <div class="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <button
            v-if="auth.user && !isAdmin"
            class="inline-flex h-9 max-w-[4rem] items-center justify-center gap-1 rounded-md border border-shuttle-500 bg-shuttle-400 px-1.5 text-xs font-black uppercase text-stone-950 shadow-[0_8px_24px_rgba(245,197,66,0.28)] transition hover:bg-shuttle-300 dark:border-shuttle-600 dark:bg-shuttle-400 dark:text-stone-950 sm:h-10 sm:max-w-none sm:gap-2 sm:px-3"
            title="ดูประวัติ coin"
            @click="openCoinModal('history')"
          >
            <CreditCard class="h-4 w-4" />
            <span class="hidden sm:inline">COIN :</span>
            <span class="truncate tabular-nums">{{ Number(auth.user.coins || 0).toLocaleString('th-TH') }}</span>
          </button>
          <button
            v-if="auth.user && !isAdmin"
            class="grid h-9 w-9 place-items-center rounded-md border border-court-200 bg-white text-court-700 transition hover:bg-court-50 dark:border-court-900 dark:bg-stone-800 dark:text-court-300 sm:inline-flex sm:h-10 sm:w-auto sm:gap-2 sm:px-3 sm:text-xs sm:font-black"
            title="ซื้อ coin"
            @click="openCoinModal('shop')"
          >
            <Coins class="h-4 w-4" />
            <span class="hidden sm:inline">ซื้อ coin</span>
          </button>
          <button
            v-if="auth.user && !isAdmin"
            class="grid h-9 w-9 place-items-center rounded-md border border-stone-200 bg-white text-stone-700 transition hover:bg-paper-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 sm:h-10 sm:w-10"
            title="ออกจากระบบ"
            @click="logout"
          >
            <LogOut class="h-5 w-5" />
          </button>
          <span v-if="isAdmin" class="hidden rounded-md border border-stone-200 bg-white px-3 py-1 text-xs text-stone-500 dark:border-stone-700 dark:bg-stone-900 md:inline">
            {{ state.session.name }}
          </span>
          <button
            v-if="isAdmin && auth.user"
            class="hidden h-10 items-center gap-2 rounded-md border border-stone-200 bg-white px-3 text-xs font-black text-stone-700 transition hover:bg-paper-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700 sm:inline-flex"
            title="กลับ Admin dashboard"
            @click="backToAdminDashboard"
          >
            <Database class="h-4 w-4" />
            Admin DB
          </button>
          <button
            v-if="isAdmin && auth.user"
            class="grid h-10 w-10 place-items-center rounded-md border border-stone-200 bg-white text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 sm:hidden"
            title="กลับ Admin dashboard"
            @click="backToAdminDashboard"
          >
            <Database class="h-5 w-5" />
          </button>
          <button
            v-if="isAdmin"
            class="grid h-10 w-10 place-items-center rounded-md border border-stone-200 bg-white text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 md:hidden"
            title="ตั้งค่า"
            @click="selectAdminTab('settings')"
          >
            <Settings class="h-5 w-5" />
          </button>
          <button
            class="grid h-9 min-w-9 place-items-center rounded-md border border-stone-200 bg-white px-1.5 text-xs font-black text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 sm:h-10 sm:min-w-10 sm:px-2"
            :title="language === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'"
            @click="toggleLanguage"
          >
            {{ language === 'th' ? 'EN' : 'TH' }}
          </button>
          <button
            class="grid h-9 w-9 place-items-center rounded-md border border-stone-200 bg-white text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 sm:h-10 sm:w-10"
            :title="state.theme === 'dark' ? 'Light mode' : 'Dark mode'"
            @click="toggleTheme"
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
          @click="selectAdminTab(tab.id)"
        >
          <component :is="tab.icon" class="h-4 w-4" />
          {{ tab.label }}
        </button>
      </nav>
    </header>

    <main class="mx-auto max-w-7xl px-4 pb-28 pt-4 md:pb-8 md:pt-5">
      <AuthPage v-if="!auth.user && !isAdmin" v-bind="pageProps" />

      <AdminSupervisorPage v-else-if="auth.user && !isAdmin" v-bind="pageProps" />

      <div v-if="ui.loadingTab" class="mb-3 rounded-md border border-court-200 bg-court-500/10 p-3 text-sm font-bold text-court-700 dark:border-court-900/60 dark:text-court-300">
        กำลังโหลดข้อมูลล่าสุด...
      </div>

      <div v-if="isAdmin && isSessionExpired" class="mb-3 grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200 sm:grid-cols-[1fr_auto] sm:items-center">
        <span>session นี้ครบ 3 วันแล้ว เปิดดูย้อนหลังได้ แต่ต้องสร้าง session ใหม่เพื่อจัดผู้เล่นหรือบันทึกเกมต่อ</span>
        <button class="h-10 rounded-md bg-court-500 px-4 text-white" @click="backToAdminDashboard">
          สร้าง session ใหม่
        </button>
      </div>

      <HomePage v-if="isAdmin && state.tab === 'home'" v-bind="pageProps" />

      <DashboardPage v-if="isAdmin && state.tab === 'dashboard'" v-bind="pageProps" />

      <PlayersPage v-if="isAdmin && state.tab === 'players'" v-bind="pageProps" />

      <LiveMatchPage v-if="isAdmin && state.tab === 'livematch'" v-bind="pageProps" />

      <QueuePage v-if="isAdmin && state.tab === 'queue'" v-bind="pageProps" />

      <LiveBoardPage v-if="isAdmin && state.tab === 'liveboard'" v-bind="pageProps" />

      <HistoryPage v-if="isAdmin && state.tab === 'history'" v-bind="pageProps" />

      <SettingsPage v-if="isAdmin && state.tab === 'settings'" v-bind="pageProps" />

      <LiveShareHoursPage v-if="isAdmin && state.tab === 'liveShareHours' && isLiveShare" v-bind="pageProps" />
    </main>

    <nav
      v-if="isAdmin"
      class="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-paper-50/95 px-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgba(34,41,37,0.08)] backdrop-blur dark:border-stone-700 dark:bg-paper-900/95 md:hidden"
    >
      <div class="mx-auto flex max-w-lg gap-1 overflow-x-auto">
        <button
          v-for="tab in mobileTabs"
          :key="tab.id"
          class="flex h-14 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-md text-[11px] font-semibold leading-none transition"
          :class="state.tab === tab.id ? 'bg-stone-900 text-white dark:bg-white dark:text-stone-900' : 'text-stone-500 active:bg-stone-100 dark:text-stone-400 dark:active:bg-stone-800'"
          @click="selectAdminTab(tab.id)"
        >
          <component :is="tab.icon" class="h-5 w-5 shrink-0" />
          <span class="max-w-full truncate">{{ tab.label }}</span>
        </button>
      </div>
    </nav>

    <MatchSetupModal v-if="isAdmin && (ui.showCouponModal || ui.showCoupleModal)" v-bind="pageProps" />

    <div v-if="ui.showCoinModal" class="fixed inset-0 z-40 grid place-items-end bg-black/40 p-3 sm:place-items-center">
      <div class="w-full max-w-4xl rounded-lg bg-white p-4 shadow-soft dark:bg-stone-900">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-black text-shuttle-700 dark:text-shuttle-300">Coin</p>
            <h2 class="mt-1 text-xl font-black">COIN : {{ Number(auth.user?.coins || 0).toLocaleString('th-TH') }}</h2>
            <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">{{ forms.coinModalMode === 'shop' ? 'เลือกโปรโมชัน โอนเงินตาม QR แล้วอัปโหลดสลิปเพื่อรอตรวจสอบ' : 'ประวัติการเติมและการใช้ coin ของบัญชีนี้' }}</p>
          </div>
          <button class="grid h-9 w-9 place-items-center rounded-md border border-stone-200 dark:border-stone-700" aria-label="ปิด modal" @click="ui.showCoinModal = false">
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="mt-4 grid max-h-[72vh] gap-4 overflow-auto pr-1 lg:grid-cols-[1.15fr_0.85fr]">
          <section v-if="forms.coinModalMode === 'shop'" class="grid gap-3">
            <div class="grid gap-3 sm:grid-cols-2">
              <button
                v-for="pkg in auth.coinPackages"
                :key="pkg.id"
                type="button"
                class="rounded-lg border p-4 text-left transition"
                :class="forms.coinSelectedPackageId === pkg.id ? 'border-shuttle-500 bg-shuttle-400/15 ring-2 ring-shuttle-500/20' : 'border-stone-200 bg-paper-100 hover:bg-paper-50 dark:border-stone-700 dark:bg-stone-800 dark:hover:bg-stone-700'"
                @click="forms.coinSelectedPackageId = pkg.id"
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <p class="text-lg font-black">{{ pkg.name }}</p>
                    <p class="mt-2 text-3xl font-black tabular-nums">฿{{ Number(pkg.priceThb || 0).toLocaleString('th-TH') }}</p>
                  </div>
                  <span v-if="pkg.bonusText" class="rounded-md bg-court-500/10 px-2 py-1 text-xs font-black text-court-700 dark:text-court-300">{{ pkg.bonusText }}</span>
                </div>
                <p class="mt-4 text-sm font-bold text-stone-500 dark:text-stone-400">ได้รับ</p>
                <p class="mt-1 text-xl font-black text-shuttle-700 dark:text-shuttle-300">{{ Number(pkg.coins || 0).toLocaleString('th-TH') }} coin</p>
              </button>
            </div>
            <p v-if="!auth.coinPackages.length" class="rounded-md bg-paper-100 p-4 text-sm font-semibold text-stone-500 dark:bg-stone-800 dark:text-stone-400">ยังไม่มีโปรโมชัน coin</p>

            <div class="rounded-lg border border-stone-200 p-4 dark:border-stone-700">
              <h3 class="font-black">ชำระเงิน</h3>
              <div class="mt-3 grid gap-3 sm:grid-cols-[12rem_1fr]">
                <div class="grid min-h-48 place-items-center rounded-lg bg-paper-100 p-3 dark:bg-stone-800">
                  <img v-if="forms.coinPaymentQrDataUrl" :src="forms.coinPaymentQrDataUrl" alt="PromptPay QR ตามยอด" class="max-h-44 rounded-md bg-white object-contain p-2" />
                  <img v-else-if="auth.coinPaymentQrImage" :src="auth.coinPaymentQrImage" alt="QR ชำระเงินสำรอง" class="max-h-44 rounded-md bg-white object-contain p-2" />
                  <p v-else class="text-center text-sm font-bold text-stone-500">backoffice ยังไม่ได้ตั้ง PromptPay หรือ QR สำรอง</p>
                </div>
                <div class="grid gap-3">
                  <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
                    <p class="text-xs font-bold text-stone-500 dark:text-stone-400">แพ็กเกจที่เลือก</p>
                    <p class="mt-1 font-black">{{ selectedCoinPackage()?.name || '-' }}</p>
                    <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">ราคา ฿{{ Number(selectedCoinPackage()?.priceThb || 0).toLocaleString('th-TH') }} ได้ {{ Number(selectedCoinPackage()?.coins || 0).toLocaleString('th-TH') }} coin</p>
                    <p class="mt-2 text-xs font-bold" :class="forms.coinPaymentQrDataUrl ? 'text-court-700 dark:text-court-300' : 'text-amber-700 dark:text-amber-300'">
                      {{ forms.coinPaymentQrDataUrl ? 'QR นี้สร้างตามยอดแพ็กเกจที่เลือก' : 'ใช้ QR สำรอง กรุณาโอนตามยอดแพ็กเกจ' }}
                    </p>
                  </div>
                  <label class="grid cursor-pointer place-items-center gap-2 rounded-md border border-dashed border-stone-300 p-4 text-center text-sm font-black transition hover:bg-paper-100 dark:border-stone-700 dark:hover:bg-stone-800">
                    <Upload class="h-5 w-5" />
                    อัปโหลดสลิป
                    <input type="file" accept="image/*" class="hidden" @change="handleCoinSlipFile" />
                  </label>
                  <img v-if="forms.coinSlipImage" :src="forms.coinSlipImage" alt="สลิปที่เลือก" class="max-h-32 rounded-md border border-stone-200 object-contain dark:border-stone-700" />
                  <button class="h-11 rounded-md bg-court-500 px-4 font-black text-white transition hover:bg-court-600 disabled:opacity-50" :disabled="!forms.coinSelectedPackageId || !forms.coinSlipImage || !coinPaymentQrReady" @click="submitCoinOrder">
                    ส่งตรวจสอบ
                  </button>
                  <p v-if="forms.coinOrderStatus" class="rounded-md bg-paper-100 px-3 py-2 text-sm font-bold text-stone-600 dark:bg-stone-800 dark:text-stone-300">{{ forms.coinOrderStatus }}</p>
                </div>
              </div>
            </div>
          </section>

          <section class="grid content-start gap-3">
            <div v-if="forms.coinModalMode === 'shop'" class="rounded-lg border border-stone-200 p-4 dark:border-stone-700">
              <h3 class="font-black">รายการซื้อ coin</h3>
              <div class="mt-3 grid gap-2">
                <div v-for="order in auth.coinOrders" :key="order.id" class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
                  <div class="flex items-center justify-between gap-3">
                    <p class="font-black">฿{{ Number(order.priceThb || 0).toLocaleString('th-TH') }} / {{ Number(order.coins || 0).toLocaleString('th-TH') }} coin</p>
                    <span class="rounded-md px-2 py-1 text-xs font-black" :class="coinOrderStatusClass(order.status)">{{ coinOrderStatusText(order.status) }}</span>
                  </div>
                  <p class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">{{ order.createdAt }}</p>
                  <p v-if="order.note" class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">{{ order.note }}</p>
                </div>
                <p v-if="!auth.coinOrders.length" class="rounded-md bg-paper-100 p-4 text-sm font-semibold text-stone-500 dark:bg-stone-800 dark:text-stone-400">ยังไม่มีรายการซื้อ coin</p>
              </div>
            </div>

            <div v-if="forms.coinModalMode === 'history'" class="rounded-lg border border-stone-200 p-4 dark:border-stone-700">
              <h3 class="font-black">ประวัติ coin</h3>
              <div class="mt-3 grid gap-2">
                <div v-for="item in auth.coinLedger" :key="item.id" class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
                  <div class="flex items-center justify-between gap-3">
                    <p class="font-black" :class="item.delta > 0 ? 'text-court-700 dark:text-court-300' : 'text-red-700 dark:text-red-300'">{{ coinReasonText(item) }}</p>
                    <p class="text-sm font-black tabular-nums" :class="item.delta > 0 ? 'text-court-700 dark:text-court-300' : 'text-red-700 dark:text-red-300'">{{ item.delta > 0 ? '+' : '' }}{{ item.delta }}</p>
                  </div>
                  <div class="mt-1 flex items-center justify-between gap-3 text-xs font-semibold text-stone-500 dark:text-stone-400">
                    <span>{{ item.createdAt }}</span>
                    <span>คงเหลือ {{ Number(item.balance || 0).toLocaleString('th-TH') }}</span>
                  </div>
                </div>
                <p v-if="!auth.coinLedger.length" class="rounded-md bg-paper-100 p-4 text-sm font-semibold text-stone-500 dark:bg-stone-800 dark:text-stone-400">ยังไม่มีประวัติ coin</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>

    <div v-if="ui.showQrModal" class="fixed inset-0 z-40 grid place-items-end bg-black/40 p-3 sm:place-items-center">
      <div class="w-full max-w-md rounded-lg bg-white p-4 shadow-soft dark:bg-stone-900">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-black">{{ forms.qrTitle }}</h2>
            <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">สแกนเพื่อเปิดลิงก์ หรือคัดลอกลิงก์ด้านล่าง</p>
          </div>
          <button class="grid h-9 w-9 place-items-center rounded-md border border-stone-200 dark:border-stone-700" aria-label="ปิด modal" @click="ui.showQrModal = false">
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="mt-4 grid place-items-center rounded-lg bg-paper-100 p-4 dark:bg-stone-800">
          <img v-if="forms.qrDataUrl" :src="forms.qrDataUrl" alt="QR code" class="h-64 w-64 rounded-md bg-white p-2" />
        </div>

        <input
          :value="forms.qrLink"
          readonly
          class="mt-3 h-10 w-full rounded-md border border-stone-200 bg-paper-50 px-3 text-xs text-stone-500 dark:border-stone-700 dark:bg-stone-800"
        />
        <p v-if="forms.qrStatus" class="mt-2 text-sm font-bold text-court-700 dark:text-court-300">{{ forms.qrStatus }}</p>

        <div class="mt-4 grid grid-cols-2 gap-2">
          <button class="h-11 rounded-md border border-stone-200 font-bold dark:border-stone-700" @click="ui.showQrModal = false">กลับ</button>
          <button class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-court-500 font-bold text-white" @click="copyQrLink">
            <Copy class="h-4 w-4" />
            คัดลอกลิงก์
          </button>
        </div>
      </div>
    </div>
    </template>
  </div>
</template>
