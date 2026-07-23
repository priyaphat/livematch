<script setup>
import { computed, defineAsyncComponent, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { createAnnouncementAudioCache } from './utils/announcementAudioCache.js'
import { arrangeTeamsByTeammateHistory } from './utils/teamRotation.js'
import {
  Activity,
  BarChart3,
  BookOpen,
  Check,
  ClipboardList,
  Clock3,
  Coins,
  Copy,
  CreditCard,
  Database,
  House,
  LayoutDashboard,
  UsersRound,
  ListTodo,
  RadioTower,
  Archive,
  SlidersHorizontal,
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
import ManualTeamModal from './components/ManualTeamModal.vue'
import AuthPage from './pages/AuthPage.vue'
import { installDomTranslator, language, levelText, t, toggleLanguage } from './i18n'
import { persistPublicTheme, persistTheme, readStoredPublicTheme, readStoredTheme } from './theme'
const BackofficePage = defineAsyncComponent(() => import('./pages/BackofficePage.vue'))
const AdminSupervisorPage = defineAsyncComponent(() => import('./pages/AdminSupervisorPage.vue'))
const DashboardPage = defineAsyncComponent(() => import('./pages/DashboardPage.vue'))
const HistoryPage = defineAsyncComponent(() => import('./pages/HistoryPage.vue'))
const HomePage = defineAsyncComponent(() => import('./pages/HomePage.vue'))
const HelpPage = defineAsyncComponent(() => import('./pages/HelpPage.vue'))
const LiveBoardPage = defineAsyncComponent(() => import('./pages/LiveBoardPage.vue'))
const LiveShareHoursPage = defineAsyncComponent(() => import('./pages/LiveShareHoursPage.vue'))
const LiveMatchPage = defineAsyncComponent(() => import('./pages/LiveMatchPage.vue'))
const PlayersPage = defineAsyncComponent(() => import('./pages/PlayersPage.vue'))
const QueuePage = defineAsyncComponent(() => import('./pages/QueuePage.vue'))
const SettingsPage = defineAsyncComponent(() => import('./pages/SettingsPage.vue'))
const SharedPlayersPage = defineAsyncComponent(() => import('./pages/SharedPlayersPage.vue'))
const SharedQueuePage = defineAsyncComponent(() => import('./pages/SharedQueuePage.vue'))
const VerifyEmailPage = defineAsyncComponent(() => import('./pages/VerifyEmailPage.vue'))
const MemberAdminPage = defineAsyncComponent(() => import('./pages/MemberAdminPage.vue'))
const BookingAdminPage = defineAsyncComponent(() => import('./pages/BookingAdminPage.vue'))
const PublicBookingPage = defineAsyncComponent(() => import('./pages/PublicBookingPage.vue'))
const PublicProfilePage = defineAsyncComponent(() => import('./pages/PublicProfilePage.vue'))

const apiUrl = import.meta.env.VITE_API_URL || ''
const routePath = window.location.pathname
const adminFeaturePage = routePath === '/admin/members' ? 'members' : routePath === '/admin/booking' ? 'booking' : ''
const publicBookingToken = routePath.startsWith('/booking/') ? routePath.slice('/booking/'.length).split('/')[0] : ''
const publicProfileToken = routePath.startsWith('/p/') ? routePath.slice('/p/'.length).split('/')[0] : ''
const isPublicBookingSurface = Boolean(publicBookingToken || publicProfileToken)
const adminNavigationKey = 'livematch_admin_navigation'
const restorableAdminTabs = new Set(['dashboard', 'players', 'livematch', 'queue', 'liveboard', 'history', 'settings', 'liveShareHours', 'help'])
const defaultAnnouncementTemplate = 'บุฟเฟ่ต์สนามที่ {court}\n{pause}\nคุณ{a} คุณ{b} คุณ{c} คุณ{d}'

function readAdminNavigation() {
  const params = new URLSearchParams(window.location.search)
  const sessionId = params.get('session') || ''
  const tab = params.get('tab') || ''
  if (sessionId) return { sessionId, tab: restorableAdminTabs.has(tab) ? tab : 'dashboard' }
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(adminNavigationKey) || 'null')
    return saved?.sessionId ? { sessionId: saved.sessionId, tab: restorableAdminTabs.has(saved.tab) ? saved.tab : 'dashboard' } : null
  } catch {
    return null
  }
}

function persistAdminNavigation(sessionId, tab = 'dashboard') {
  const safeTab = restorableAdminTabs.has(tab) ? tab : 'dashboard'
  try { window.sessionStorage.setItem(adminNavigationKey, JSON.stringify({ sessionId, tab: safeTab })) } catch { /* URL remains the fallback. */ }
  const url = new URL(window.location.href)
  url.searchParams.set('session', sessionId)
  url.searchParams.set('tab', safeTab)
  window.history.replaceState({}, '', url)
}

function clearAdminNavigation() {
  try { window.sessionStorage.removeItem(adminNavigationKey) } catch { /* Ignore unavailable storage. */ }
  const url = new URL(window.location.href)
  url.searchParams.delete('session')
  url.searchParams.delete('tab')
  window.history.replaceState({}, '', url)
}

function defaultSessionSettingsTemplate() {
  return {
    entryFee: 120,
    clubEntryFee: 120,
    courtFeePerHour: 150,
    shuttleFee: 85,
    shuttleBrands: [{ id: 'default', name: 'ลูกแบดทั่วไป', price: 85, active: true }],
    courtCount: 4,
    courtNames: ['สนาม 1', 'สนาม 2', 'สนาม 3', 'สนาม 4'],
    levels: ['เบา', 'กลาง', 'หนัก'],
    announcementTemplate: defaultAnnouncementTemplate
  }
}

const tabs = computed(() => [
  { id: 'home', label: t('หน้าแรก', 'Home'), icon: House },
  { id: 'dashboard', label: t('แดชบอร์ด', 'Dashboard'), icon: LayoutDashboard },
  { id: 'players', label: t('สมาชิก', 'Players'), icon: UsersRound },
  { id: 'livematch', label: t('จัดคู่', 'Pairing'), icon: Shuffle },
  { id: 'queue', label: t('รอคิว', 'Queue'), icon: ListTodo },
  { id: 'liveboard', label: t('แข่งอยู่', 'Live board'), icon: RadioTower },
  { id: 'history', label: t('ประวัติ', 'History'), icon: Archive },
  { id: 'settings', label: t('ตั้งค่า', 'Settings'), icon: SlidersHorizontal },
  ...(isLiveShare.value ? [{ id: 'liveShareHours', label: t('ชั่วโมงเล่น', 'Hours'), icon: Clock3 }] : []),
  { id: 'help', label: t('วิธีใช้', 'Guide'), icon: BookOpen }
])

const adminTabs = computed(() => tabs.value.filter((tab) => tab.id !== 'home'))
const mobileTabs = computed(() => adminTabs.value)
const currentTab = computed(() => tabs.value.find((tab) => tab.id === state.tab) || tabs.value[0])

const state = reactive({
  tab: 'home',
  theme: isPublicBookingSurface ? readStoredPublicTheme() : readStoredTheme(),
  session: {
    id: 'demo-session',
    name: 'แบดวันอังคาร',
    type: 'liveMatch',
    adminPasscode: 'LM-2406',
    unlocked: false,
    createdAt: '',
    expiresAt: '',
    expired: false,
    readOnly: false,
    readOnlyReason: ''
  },
  settings: {
    entryFee: 120,
    clubEntryFee: 100,
    courtFeePerHour: 150,
    shuttleFee: 85,
    shuttleBrands: [{ id: 'default', name: 'ลูกแบดทั่วไป', price: 85, active: true }],
    sessionFee: 0,
    courtCount: 4,
    courtNames: ['สนาม 1', 'สนาม 2', 'สนาม 3', 'สนาม 4'],
    levels: ['เบา', 'กลาง', 'หนัก'],
    allowCrossLevel: true,
    crossLevelRange: 1,
    randomPriority: 'level',
    showPaymentOnShare: true,
    showTotalOnShare: true,
    resetPlayersAfterFinish: true,
    startMatchWithShuttle: true,
    announcementTemplate: defaultAnnouncementTemplate
  },
  players: [
    { id: 1, name: 'ต้น', games: 4, wins: 2, draws: 0, losses: 2, shuttles: 4, paid: true, active: true, level: 'กลาง', coupon: true, clubMember: true },
    { id: 2, name: 'แพรว', games: 3, wins: 2, draws: 0, losses: 1, shuttles: 3, paid: false, active: true, level: 'กลาง', coupon: true, clubMember: false },
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
  returnedShuttles: [],
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
  newPlayerPhone: '',
  newPlayerMemberId: '',
  playerSearch: '',
  playerPaymentFilter: 'all',
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
  backofficeOverviewTab: 'system',
  backofficeSummary: null,
  backofficeAdminDetail: null,
  backofficeDiscountPercent: 0,
  backofficeSubscriptionId: '',
  backofficeSubscriptionStartDate: '',
  backofficeSubscriptionEndDate: '',
  backofficeSubscriptionTotalSessions: 1,
  backofficeSubscriptionPaidAmountThb: 0,
  backofficeSubscriptionNote: '',
  backofficeSubscriptionCancelNote: '',
  backofficeBenefitStatus: '',
  backofficeCoinAdminId: '',
  backofficeCoinDelta: 0,
  backofficeCoinNote: '',
  backofficeLiveMatchCost: null,
  backofficeLiveShareCost: null,
  backofficeCoinPackages: [],
  backofficeSubscriptionPackages: [],
  backofficeCoinPaymentQrImage: '',
  backofficePromptPayId: '',
  backofficePromptPayType: 'mobile',
  backofficePromptPayReceiverName: '',
  backofficeTelegramBotToken: '',
  backofficeTelegramChatId: '',
  backofficeTelegramWebhookSecret: '',
  backofficeTelegramWebhookUrl: '',
  backofficeTelegramWebhookStatus: '',
  backofficeSlipOKEnabled: false,
  backofficeSlipOKBranchId: '',
  backofficeSlipOKApiKey: '',
  backofficeSlipOKApiKeyMasked: '',
  backofficeSlipOKMonthlyCap: 0,
  backofficeSlipOKQuota: { available: false, remaining: 0, used: 0, limit: 0, overQuota: 0, capReached: false, error: '' },
  backofficeSlipOKStatus: '',
  backofficeRejectOrderId: '',
  backofficeRejectNote: '',
  backofficeTelegramSendingId: '',
  backofficeSlipPreview: null,
  backofficeOrdersPage: 1,
  backofficeOrdersPageSize: 10,
  backofficeOrdersPagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
  backofficeLedgerPage: 1,
  backofficeLedgerPageSize: 20,
  backofficeLedgerPagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  backofficeActivityPage: 1,
  backofficeActivityPageSize: 20,
  backofficeActivityUserId: '',
  backofficeActivitySessionId: '',
  backofficeActivitySessionOptions: [],
  backofficeActivityPagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  backofficeSupportIssues: [],
  backofficeSupportIssueDetail: null,
  backofficeSupportStatus: '',
  backofficeSupportSearch: '',
  backofficeSupportPage: 1,
  backofficeSupportPageSize: 20,
  backofficeSupportNewCount: 0,
  backofficeSupportPagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  backofficeSupportSaving: false,
  coinModalMode: 'shop',
  coinShopTab: 'coin',
  coinSelectedPackageId: '',
  subscriptionSelectedPackageId: '',
  coinPaymentQrDataUrl: '',
  coinSlipImage: '',
  coinOrderStatus: '',
  shareLink: '',
  shareStatus: '',
  finishNote: '',
  finishWinner: '',
  cancelNote: '',
  cancelShuttleReturned: false,
  newPlayerClubMember: false,
  selectedPlayerId: 1,
  coupleAId: '',
  coupleBId: '',
  matchCourts: {},
  matchShuttleBrands: {},
  addShuttleBrandId: '',
  playerNameEdits: {},
  newShuttleBrandName: '',
  newShuttleBrandPrice: 0,
  adminDefaultNewShuttleBrandName: '',
  adminDefaultNewShuttleBrandPrice: 0,
  adminDefaultNewCourtName: '',
  adminDefaultNewLevelName: '',
  adminDefaultSettingsStatus: '',
  newCourtName: '',
  newLevelName: ''
})
const ui = reactive({
  showCouponModal: false,
  showCoupleModal: false,
  showManualTeamModal: false,
  showFinishModal: false,
  finishMatch: null,
  showCancelModal: false,
  cancelMatch: null,
  showShuttleModal: false,
  shuttleMatch: null,
  showReturnShuttleModal: false,
  returnShuttleMatch: null,
  showQrModal: false,
  showCreateSessionModal: false,
  showAdminDefaultSettingsModal: false,
  showCoinModal: false,
  showBackofficeAdminModal: false,
  showBackofficeSlipModal: false,
  showBackofficeSupportModal: false,
  toast: null,
  loadingTab: ''
})
const share = reactive({
  isPublic: false,
  view: '',
  loading: false,
  error: '',
  showPayment: false,
  showTotal: true
})
const auth = reactive({
  loading: false,
  ready: false,
  user: null,
  sessions: [],
  coinLedger: [],
  liveMatchSessionCost: null,
  liveShareSessionCost: null,
  benefits: { discountPercent: 0, pricing: {}, subscription: null },
  coinPackages: [],
  subscriptionPackages: [],
  coinPaymentQrImage: '',
  defaultSettings: defaultSessionSettingsTemplate(),
  promptPayId: '',
  promptPayType: 'mobile',
  promptPayReceiverName: '',
  promptPayPayloads: {},
  subscriptionPromptPayPayloads: {},
  promptPayAvailable: false,
  subscriptionEligibility: { canPurchase: true, reason: '', renewal: false, estimatedStartDate: '' },
  coinOrders: [],
  features: { memberEnabled: false, bookingEnabled: false },
  memberCount: 0,
  bookingCount: 0
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
  const isFormData = options.body instanceof FormData
  const csrfToken = document.cookie.split('; ').find((item) => item.startsWith('livematch_csrf='))?.split('=').slice(1).join('=') || ''
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
      'Accept': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': decodeURIComponent(csrfToken) } : {}),
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
  if (!forms.backofficeUsername || !forms.backofficePassword) return {}
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
  if (Array.isArray(patch.returnedShuttles)) state.returnedShuttles = patch.returnedShuttles
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
  if (state.settings.clubEntryFee === undefined || state.settings.clubEntryFee === null) {
    state.settings.clubEntryFee = state.settings.entryFee || 0
  }
  if (!Array.isArray(state.settings.shuttleBrands) || !state.settings.shuttleBrands.length) {
    state.settings.shuttleBrands = [{ id: 'default', name: 'ลูกแบดทั่วไป', price: Number(state.settings.shuttleFee || 0), active: true }]
  }
  if (!activeShuttleBrands().length) {
    state.settings.shuttleBrands[0].active = true
  }
  state.settings.shuttleFee = Number(state.settings.shuttleBrands[0]?.price || state.settings.shuttleFee || 0)
  for (const player of state.players || []) {
    if (player.clubMember === undefined) player.clubMember = false
  }
  for (const match of [...(state.live || []), ...(state.history || []), ...(state.queue || []), ...(state.pending || [])]) {
    normalizeMatchShuttleItems(match)
  }
  if (state.settings.courtFeePerHour === undefined || state.settings.courtFeePerHour === null) {
    state.settings.courtFeePerHour = 150
  }
  if (state.settings.startMatchWithShuttle === undefined) {
    state.settings.startMatchWithShuttle = true
  }
  if (state.settings.showTotalOnShare === undefined) {
    state.settings.showTotalOnShare = true
  }
  if (!String(state.settings.announcementTemplate || '').trim()) {
    state.settings.announcementTemplate = defaultAnnouncementTemplate
  }
  if (!state.liveShare) {
    state.liveShare = { courtHours: {}, playerHours: {}, shuttleHours: {} }
  }
  if (!state.liveShare.courtHours) state.liveShare.courtHours = {}
  if (!state.liveShare.playerHours) state.liveShare.playerHours = {}
  if (!state.liveShare.shuttleHours) state.liveShare.shuttleHours = {}
  state.returnedShuttles = (state.returnedShuttles || []).map((item) => (
    typeof item === 'number' ? { brandId: 'default', number: item } : { brandId: item.brandId || 'default', number: Number(item.number || 0) }
  )).filter((item) => item.number > 0)
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
  if (state.session.unlocked && state.session.id && restorableAdminTabs.has(tabId)) {
    persistAdminNavigation(state.session.id, tabId)
  }
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
  if (backoffice.isPage) {
    restoreBackoffice()
    return
  }
  const resetToken = params.get('token')
  if (window.location.pathname === '/reset-password' && resetToken) {
    forms.authMode = 'reset'
    forms.resetToken = resetToken
  }
  loadSharedView()
  restoreAdminAccount(true)
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
  stopAnnouncementAudio()
  announcementAudioCache.dispose()
})

async function saveSettings() {
  if (!ensureSessionActive()) return
  applyServerState(await api(`/api/sessions/${state.session.id}/settings`, {
    method: 'PUT',
    body: JSON.stringify({ ...state.settings, sessionName: state.session.name })
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

async function openOwnedSession(sessionId, requestedTab = 'dashboard') {
  try {
    const nextState = await api(`/api/sessions/${sessionId}/dashboard?open=1`)
    mergeSessionPatch(nextState)
    const fullState = await api(`/api/sessions/${sessionId}/state`)
    applyServerState(fullState)
    state.session.unlocked = true
    state.tab = restorableAdminTabs.has(requestedTab) ? requestedTab : 'dashboard'
    persistAdminNavigation(sessionId, state.tab)
    if (state.session.readOnly || state.session.expired) {
      showToast(sessionReadOnlyMessage.value, 'info')
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
  clearAdminNavigation()
  await refreshAdminSupervisor()
}

async function restoreBackoffice() {
  forms.backofficeError = ''
  backoffice.loading = true
  try {
    forms.backofficeSummary = await api('/api/backoffice/summary')
    forms.backofficeLiveMatchCost = forms.backofficeSummary.liveMatchSessionCost
    forms.backofficeLiveShareCost = forms.backofficeSummary.liveShareSessionCost
    syncBackofficeCoinShopForms()
    await Promise.all([loadBackofficeCoinOrders(), loadBackofficeCoinLedger(), loadBackofficeActivityLogs(), loadBackofficeSupportIssues()])
    backoffice.unlocked = true
  } catch (error) {
    backoffice.unlocked = false
    if (error.status !== 401) forms.backofficeError = error.message || 'โหลดหลังบ้านไม่สำเร็จ'
  } finally {
    backoffice.loading = false
  }
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
    await Promise.all([
      loadBackofficeCoinOrders(),
      loadBackofficeCoinLedger(),
      loadBackofficeActivityLogs(),
      loadBackofficeSupportIssues()
    ])
    backoffice.unlocked = true
    forms.backofficePassword = ''
  } catch (error) {
    forms.backofficeError = error.message || 'เข้าสู่หลังบ้านไม่สำเร็จ'
  } finally {
    backoffice.loading = false
  }
}

async function submitSupportIssue(formData) {
  return api('/api/support-issues', {
    method: 'POST',
    body: formData
  })
}

async function loadBackofficeSupportIssues(page = forms.backofficeSupportPage) {
  const params = new URLSearchParams({
    page: String(Math.max(1, Number(page || 1))),
    pageSize: String(forms.backofficeSupportPageSize)
  })
  if (forms.backofficeSupportStatus) params.set('status', forms.backofficeSupportStatus)
  if (forms.backofficeSupportSearch.trim()) params.set('search', forms.backofficeSupportSearch.trim())
  const payload = await api(`/api/backoffice/support-issues?${params}`, {
    headers: backofficeAuthHeaders()
  })
  forms.backofficeSupportIssues = payload.issues || []
  forms.backofficeSupportNewCount = Number(payload.newCount || 0)
  forms.backofficeSupportPagination = payload.pagination || { page: 1, pageSize: forms.backofficeSupportPageSize, total: 0, totalPages: 0 }
  forms.backofficeSupportPage = forms.backofficeSupportPagination.page || 1
}

function applyBackofficeSupportFilters() {
  forms.backofficeSupportPage = 1
  return loadBackofficeSupportIssues(1)
}

async function openBackofficeSupportIssue(issueId) {
  forms.backofficeSupportIssueDetail = await api(`/api/backoffice/support-issues/${issueId}`, {
    headers: backofficeAuthHeaders()
  })
  ui.showBackofficeSupportModal = true
}

async function saveBackofficeSupportIssue() {
  const issue = forms.backofficeSupportIssueDetail
  if (!issue || forms.backofficeSupportSaving) return
  forms.backofficeSupportSaving = true
  try {
    forms.backofficeSupportIssueDetail = await api(`/api/backoffice/support-issues/${issue.id}`, {
      method: 'PUT',
      headers: backofficeAuthHeaders(),
      body: JSON.stringify({
        status: issue.status,
        supervisorReply: issue.supervisorReply || ''
      })
    })
    await loadBackofficeSupportIssues(forms.backofficeSupportPage)
    showToast('บันทึกรายการแจ้งปัญหาแล้ว', 'info')
  } catch (error) {
    showToast(error.message || 'บันทึกรายการแจ้งปัญหาไม่สำเร็จ')
  } finally {
    forms.backofficeSupportSaving = false
  }
}

async function loadBackofficeCoinOrders(page = forms.backofficeOrdersPage) {
  const params = new URLSearchParams({
    page: String(Math.max(1, Number(page || 1))),
    pageSize: String(forms.backofficeOrdersPageSize)
  })
  const payload = await api(`/api/backoffice/coin-orders?${params}`, {
    headers: backofficeAuthHeaders()
  })
  forms.backofficeSummary = {
    ...(forms.backofficeSummary || {}),
    coinPurchaseOrders: payload.orders || []
  }
  forms.backofficeOrdersPagination = payload.pagination || { page: 1, pageSize: forms.backofficeOrdersPageSize, total: 0, totalPages: 0 }
  forms.backofficeOrdersPage = forms.backofficeOrdersPagination.page || 1
}

async function loadBackofficeActivityLogs(page = forms.backofficeActivityPage) {
  const params = new URLSearchParams({
    page: String(Math.max(1, Number(page || 1))),
    pageSize: String(forms.backofficeActivityPageSize)
  })
  if (forms.backofficeActivityUserId) params.set('userId', forms.backofficeActivityUserId)
  if (forms.backofficeActivitySessionId.trim()) params.set('sessionId', forms.backofficeActivitySessionId.trim())
  const payload = await api(`/api/backoffice/activity-logs?${params}`, {
    headers: backofficeAuthHeaders()
  })
  forms.backofficeSummary = {
    ...(forms.backofficeSummary || {}),
    activityLogs: payload.logs || []
  }
  forms.backofficeActivityPagination = payload.pagination || { page: 1, pageSize: forms.backofficeActivityPageSize, total: 0, totalPages: 0 }
  forms.backofficeActivitySessionOptions = payload.sessionOptions || []
  forms.backofficeActivityPage = forms.backofficeActivityPagination.page || 1
}

function applyBackofficeActivityFilters() {
  forms.backofficeActivityPage = 1
  return loadBackofficeActivityLogs(1)
}

function changeBackofficeActivityUser() {
  forms.backofficeActivitySessionId = ''
  forms.backofficeActivitySessionOptions = []
  return applyBackofficeActivityFilters()
}

async function openBackofficeAdminDetail(adminId) {
  forms.backofficeError = ''
  try {
    applyBackofficeAdminDetail(await api(`/api/backoffice/admins/${adminId}`, {
      headers: backofficeAuthHeaders()
    }))
    ui.showBackofficeAdminModal = true
  } catch (error) {
    forms.backofficeError = error.message || 'โหลดรายละเอียด admin ไม่สำเร็จ'
  }
}

function dateInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

function defaultSubscriptionDates() {
  const start = new Date()
  const end = new Date(start)
  end.setMonth(end.getMonth() + 1)
  end.setDate(end.getDate() - 1)
  return { startDate: dateInputValue(start), endDate: dateInputValue(end) }
}

function syncBackofficeBenefitForms() {
  const benefits = forms.backofficeAdminDetail?.benefits || {}
  const subscription = benefits.subscription || null
  const defaults = defaultSubscriptionDates()
  forms.backofficeDiscountPercent = Number(benefits.discountPercent || 0)
  forms.backofficeSubscriptionId = subscription?.id || ''
  forms.backofficeSubscriptionStartDate = subscription?.startDate || defaults.startDate
  forms.backofficeSubscriptionEndDate = subscription?.endDate || defaults.endDate
  forms.backofficeSubscriptionTotalSessions = Number(subscription?.totalSessions || 1)
  forms.backofficeSubscriptionPaidAmountThb = Number(subscription?.paidAmountThb || 0)
  forms.backofficeSubscriptionNote = subscription?.note || ''
  forms.backofficeSubscriptionCancelNote = ''
  forms.backofficeBenefitStatus = ''
}

function applyBackofficeAdminDetail(payload) {
  forms.backofficeAdminDetail = payload
  syncBackofficeBenefitForms()
  const userId = payload?.user?.id
  const summaryUser = forms.backofficeSummary?.users?.find((item) => item.id === userId)
  if (summaryUser) {
    summaryUser.discountPercent = Number(payload?.benefits?.discountPercent || 0)
    summaryUser.subscription = payload?.benefits?.subscription || null
  }
}

async function saveBackofficeAdminDiscount() {
  const adminId = forms.backofficeAdminDetail?.user?.id
  if (!adminId) return
  forms.backofficeBenefitStatus = ''
  try {
    applyBackofficeAdminDetail(await api(`/api/backoffice/admins/${adminId}/discount`, {
      method: 'PUT',
      headers: backofficeAuthHeaders(),
      body: JSON.stringify({ discountPercent: Number(forms.backofficeDiscountPercent) })
    }))
    forms.backofficeBenefitStatus = 'บันทึกส่วนลดแล้ว'
  } catch (error) {
    forms.backofficeBenefitStatus = error.message || 'บันทึกส่วนลดไม่สำเร็จ'
  }
}

async function saveBackofficeAdminSubscription() {
  const adminId = forms.backofficeAdminDetail?.user?.id
  if (!adminId) return
  const subscriptionId = forms.backofficeSubscriptionId
  const path = subscriptionId
    ? `/api/backoffice/admins/${adminId}/subscriptions/${subscriptionId}`
    : `/api/backoffice/admins/${adminId}/subscriptions`
  forms.backofficeBenefitStatus = ''
  try {
    applyBackofficeAdminDetail(await api(path, {
      method: subscriptionId ? 'PUT' : 'POST',
      headers: backofficeAuthHeaders(),
      body: JSON.stringify({
        startDate: forms.backofficeSubscriptionStartDate,
        endDate: forms.backofficeSubscriptionEndDate,
        totalSessions: Number(forms.backofficeSubscriptionTotalSessions),
        paidAmountThb: Number(forms.backofficeSubscriptionPaidAmountThb),
        note: forms.backofficeSubscriptionNote || ''
      })
    }))
    forms.backofficeBenefitStatus = subscriptionId ? 'แก้ไขแพ็กเกจแล้ว' : 'สร้างแพ็กเกจแล้ว'
  } catch (error) {
    forms.backofficeBenefitStatus = error.message || 'บันทึกแพ็กเกจไม่สำเร็จ'
  }
}

async function cancelBackofficeAdminSubscription() {
  const adminId = forms.backofficeAdminDetail?.user?.id
  const subscriptionId = forms.backofficeSubscriptionId
  if (!adminId || !subscriptionId) return
  if (!window.confirm('ยืนยันยกเลิกแพ็กเกจนี้? สิทธิ์ที่เหลือจะใช้ไม่ได้ทันที')) return
  forms.backofficeBenefitStatus = ''
  try {
    applyBackofficeAdminDetail(await api(`/api/backoffice/admins/${adminId}/subscriptions/${subscriptionId}/cancel`, {
      method: 'POST',
      headers: backofficeAuthHeaders(),
      body: JSON.stringify({ note: forms.backofficeSubscriptionCancelNote || '' })
    }))
    forms.backofficeBenefitStatus = 'ยกเลิกแพ็กเกจแล้ว'
  } catch (error) {
    forms.backofficeBenefitStatus = error.message || 'ยกเลิกแพ็กเกจไม่สำเร็จ'
  }
}

function syncBackofficeCoinShopForms() {
  const summary = forms.backofficeSummary || {}
  forms.backofficeCoinPackages = (summary.coinPackages || []).map((item) => ({ ...item }))
  forms.backofficeSubscriptionPackages = (summary.subscriptionPackages || []).map((item) => ({ ...item }))
  forms.backofficeCoinPaymentQrImage = summary.coinPaymentQrImage || ''
  forms.backofficePromptPayId = summary.promptPayId || ''
  forms.backofficePromptPayType = summary.promptPayType || 'mobile'
  forms.backofficePromptPayReceiverName = summary.promptPayReceiverName || ''
  forms.backofficeTelegramBotToken = summary.telegramBotToken || ''
  forms.backofficeTelegramChatId = summary.telegramChatId || ''
  forms.backofficeTelegramWebhookSecret = summary.telegramWebhookSecret || ''
  forms.backofficeTelegramWebhookUrl = summary.telegramWebhookUrl || ''
  forms.backofficeSlipOKEnabled = Boolean(summary.slipOKEnabled)
  forms.backofficeSlipOKBranchId = summary.slipOKBranchId || ''
  forms.backofficeSlipOKApiKey = ''
  forms.backofficeSlipOKApiKeyMasked = summary.slipOKApiKeyMasked || ''
  forms.backofficeSlipOKMonthlyCap = Number(summary.slipOKMonthlyCap || 0)
  forms.backofficeSlipOKQuota = summary.slipOKQuota || forms.backofficeSlipOKQuota
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
        subscriptionPackages: forms.backofficeSubscriptionPackages,
        paymentQrImage: forms.backofficeCoinPaymentQrImage,
        promptPayId: forms.backofficePromptPayId,
        promptPayType: forms.backofficePromptPayType,
        promptPayReceiverName: forms.backofficePromptPayReceiverName,
        telegramBotToken: forms.backofficeTelegramBotToken,
        telegramChatId: forms.backofficeTelegramChatId,
        telegramWebhookSecret: forms.backofficeTelegramWebhookSecret,
        slipOKEnabled: forms.backofficeSlipOKEnabled,
        slipOKBranchId: forms.backofficeSlipOKBranchId,
        slipOKApiKey: forms.backofficeSlipOKApiKey,
        slipOKMonthlyCap: Number(forms.backofficeSlipOKMonthlyCap)
      })
    })
    syncBackofficeCoinShopForms()
  } catch (error) {
    forms.backofficeError = error.message || 'บันทึกโปรโมชัน coin ไม่สำเร็จ'
  }
}

async function refreshBackofficeSlipOKQuota() {
  forms.backofficeSlipOKStatus = 'กำลังตรวจสอบการเชื่อมต่อ...'
  try {
    const quota = await api('/api/backoffice/slipok-quota', {
      headers: backofficeAuthHeaders()
    })
    forms.backofficeSlipOKQuota = quota
    forms.backofficeSlipOKStatus = 'เชื่อมต่อ SlipOK สำเร็จ'
  } catch (error) {
    forms.backofficeSlipOKStatus = error.message || 'เชื่อมต่อ SlipOK ไม่สำเร็จ'
  }
}

async function setupBackofficeTelegramWebhook() {
  forms.backofficeError = ''
  forms.backofficeTelegramWebhookStatus = ''
  const webhookUrl = forms.backofficeTelegramWebhookUrl || ''
  if (!webhookUrl.startsWith('https://')) {
    forms.backofficeTelegramWebhookStatus = 'Telegram รับเฉพาะ HTTPS กรุณาตั้ง APP_BASE_URL เป็นโดเมน HTTPS แล้ว restart backend'
    return
  }
  try {
    const payload = await api('/api/backoffice/telegram-webhook', {
      method: 'POST',
      headers: backofficeAuthHeaders()
    })
    forms.backofficeTelegramWebhookUrl = payload.webhookUrl || forms.backofficeTelegramWebhookUrl
    forms.backofficeTelegramWebhookStatus = 'ตั้งค่า Telegram webhook สำเร็จ'
  } catch (error) {
    forms.backofficeTelegramWebhookStatus = error.message || 'ตั้งค่า Telegram webhook ไม่สำเร็จ'
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

function addBackofficeSubscriptionPackage() {
  forms.backofficeSubscriptionPackages.push({
    id: '',
    name: 'แพ็กเกจรายเดือนใหม่',
    priceThb: 999,
    totalSessions: 30,
    durationDays: 30,
    bonusText: '',
    active: true,
    sortOrder: forms.backofficeSubscriptionPackages.length + 1
  })
}

function removeBackofficeSubscriptionPackage(index) {
  forms.backofficeSubscriptionPackages.splice(index, 1)
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
    await loadBackofficeCoinOrders(forms.backofficeOrdersPage)
  } catch (error) {
    forms.backofficeError = error.message || 'อัปเดตรายการชำระเงินไม่สำเร็จ'
  }
}

function applyAdminPayload(payload) {
  auth.user = payload.user || null
  auth.sessions = payload.sessions || []
  auth.coinLedger = payload.coinLedger || []
  auth.defaultSettings = normalizeSessionDefaults(payload.defaultSettings || auth.defaultSettings)
  auth.liveMatchSessionCost = payload.liveMatchSessionCost ?? null
  auth.liveShareSessionCost = payload.liveShareSessionCost ?? null
  auth.benefits = payload.benefits || { discountPercent: 0, pricing: {}, subscription: null }
  auth.features = payload.features || { memberEnabled: false, bookingEnabled: false }
  auth.memberCount = Number(payload.memberCount || 0)
  auth.bookingCount = Number(payload.bookingCount || 0)
}

function navigateAdminFeature(feature) {
  window.location.href = feature === 'members' ? '/admin/members' : '/admin/booking'
}

async function saveBackofficeAdminFeatures(features) {
  const adminId = forms.backofficeAdminDetail?.user?.id
  if (!adminId) return
  try {
    applyBackofficeAdminDetail(await api(`/api/backoffice/admins/${adminId}/features`, {
      method: 'PATCH', headers: backofficeAuthHeaders(), body: JSON.stringify(features)
    }))
    forms.backofficeBenefitStatus = 'บันทึกสิทธิ์ระบบแล้ว'
  } catch (error) { forms.backofficeBenefitStatus = error.message || 'บันทึกสิทธิ์ไม่สำเร็จ' }
}

function applyCoinShopPayload(payload) {
  auth.coinPackages = payload.packages || []
  auth.subscriptionPackages = payload.subscriptionPackages || []
  auth.coinPaymentQrImage = payload.paymentQrImage || ''
  auth.promptPayId = payload.promptPayId || ''
  auth.promptPayType = payload.promptPayType || 'mobile'
  auth.promptPayReceiverName = payload.promptPayReceiverName || ''
  auth.promptPayPayloads = payload.promptPayPayloads || {}
  auth.subscriptionPromptPayPayloads = payload.subscriptionPromptPayPayloads || {}
  auth.promptPayAvailable = Boolean(payload.promptPayAvailable)
  auth.subscriptionEligibility = payload.subscriptionEligibility || { canPurchase: true, reason: '', renewal: false, estimatedStartDate: '' }
  auth.coinOrders = payload.orders || []
  if (!forms.coinSelectedPackageId && auth.coinPackages.length) {
    forms.coinSelectedPackageId = auth.coinPackages[0].id
  }
  if (!forms.subscriptionSelectedPackageId && auth.subscriptionPackages.length) {
    forms.subscriptionSelectedPackageId = auth.subscriptionPackages[0].id
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
    showToast(error.message || 'โหลดร้านค้าไม่สำเร็จ')
  }
}

async function submitCoinOrder() {
  forms.coinOrderStatus = ''
  try {
    const payload = await api('/api/admin/coin-orders', {
      method: 'POST',
      body: JSON.stringify({
        productType: forms.coinShopTab,
        packageId: selectedShopPackage()?.id,
        slipImage: forms.coinSlipImage
      })
    })
    applyCoinShopPayload(payload)
    const latestOrder = auth.coinOrders[0]
    forms.coinSlipImage = ''
    forms.coinOrderStatus = latestOrder?.status === 'approved'
      ? latestOrder?.productType === 'subscription'
        ? 'SlipOK ตรวจสอบผ่าน เปิดสิทธิ์แพ็กเกจสำเร็จ'
        : 'SlipOK ตรวจสอบผ่าน เติม coin สำเร็จ'
      : 'ส่งรายการแล้ว รอ backoffice ตรวจสอบ'
    await restoreAdminAccount()
  } catch (error) {
    forms.coinOrderStatus = error.message || 'ส่งรายการชำระเงินไม่สำเร็จ'
  }
}

async function restoreAdminAccount(restoreNavigation = false) {
  if (share.isPublic) {
    auth.ready = true
    return
  }
  try {
    const payload = await api('/api/auth/me')
    applyAdminPayload(payload)
    if (restoreNavigation) {
      const navigation = readAdminNavigation()
      if (navigation && auth.sessions.some((session) => session.id === navigation.sessionId)) {
        await openOwnedSession(navigation.sessionId, navigation.tab)
      } else if (navigation) {
        clearAdminNavigation()
      }
    }
  } catch {
    auth.user = null
  } finally {
    auth.ready = true
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
  clearAdminNavigation()
  forms.authPassword = ''
  forms.loginError = ''
}

watch(
  () => state.theme,
  (theme) => {
    state.theme = isPublicBookingSurface
      ? persistPublicTheme(theme)
      : persistTheme(theme)
  },
  { immediate: true }
)

function toggleTheme() {
  const nextTheme = state.theme === 'dark' ? 'light' : 'dark'
  state.theme = isPublicBookingSurface
    ? persistPublicTheme(nextTheme)
    : persistTheme(nextTheme)
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
const isSessionReadOnly = computed(() => Boolean(state.session.readOnly || state.session.expired))
const sessionReadOnlyMessage = computed(() => (
  state.session.readOnlyReason === 'paid_complete_24h'
    ? 'session นี้ชำระครบและเกิน 1 วันแล้ว เปิดดูย้อนหลังได้ แต่ต้องสร้าง session ใหม่เพื่อจัดผู้เล่นหรือบันทึกเกมต่อ'
    : 'session นี้ครบ 3 วันแล้ว เปิดดูย้อนหลังได้ แต่ต้องสร้าง session ใหม่เพื่อจัดผู้เล่นหรือบันทึกเกมต่อ'
))
const showAppHeader = computed(() => !((isAdmin.value && state.tab === 'home') || (!auth.user && !isAdmin.value)))

const queuedPlayerIds = computed(() => new Set([...state.pending, ...state.queue].flatMap(matchPlayers)))
const livePlayerIds = computed(() => new Set(state.live.flatMap(matchPlayers)))
const activePlayers = computed(() => state.players.filter((player) => player.active))
const realHistoryMatches = computed(() => state.history.filter((match) => !isCancelledMatch(match)))
const cancelledMatches = computed(() => state.history.filter(isCancelledMatch))
const chargeableCancelledMatches = computed(() => cancelledMatches.value.filter((match) => !match.shuttleReturned))
const activePlayerCount = computed(() => activePlayers.value.length)
const liveShareShuttleCount = computed(() => Object.values(state.liveShare?.shuttleHours || {}).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0))
const totalShuttles = computed(() => (
  isLiveShare.value
    ? liveShareShuttleCount.value
    : state.live.reduce((sum, match) => sum + match.shuttles, 0)
      + realHistoryMatches.value.reduce((sum, match) => sum + match.shuttles, 0)
      + chargeableCancelledMatches.value.reduce((sum, match) => sum + match.shuttles, 0)
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
    .filter((player) => player.active && !player.paid && !queuedPlayerIds.value.has(player.id) && !livePlayerIds.value.has(player.id))
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
  return playerEntryFee(player) + playerShuttleCost(player.id) + sessionFeeShare.value
}

function playerEntryFee(player) {
  return Number(player?.clubMember ? state.settings.clubEntryFee : state.settings.entryFee) || 0
}

function activeShuttleBrands() {
  return (state.settings.shuttleBrands || []).filter((brand) => brand.active)
}

function defaultShuttleBrand() {
  return activeShuttleBrands()[0] || state.settings.shuttleBrands?.[0] || { id: 'default', name: 'ลูกแบดทั่วไป', price: Number(state.settings.shuttleFee || 0), active: true }
}

function shuttleBrandById(brandId) {
  return (state.settings.shuttleBrands || []).find((brand) => brand.id === brandId) || defaultShuttleBrand()
}

function shuttleBrandName(brandId) {
  return shuttleBrandById(brandId).name || 'ลูกแบด'
}

function normalizeMatchShuttleItems(match) {
  if (!match) return []
  if (!Array.isArray(match.shuttleSequenceItems)) {
    match.shuttleSequenceItems = []
  }
  if (!match.shuttleSequenceItems.length && match.shuttleSequence) {
    match.shuttleSequenceItems = shuttleSequenceNumbers(match.shuttleSequence).map((number) => ({ brandId: 'default', number }))
  }
  return match.shuttleSequenceItems
}

function matchShuttleItems(match) {
  return normalizeMatchShuttleItems(match)
}

function matchShuttleSummary(match) {
  const counts = new Map()
  for (const item of matchShuttleItems(match)) {
    counts.set(item.brandId, (counts.get(item.brandId) || 0) + 1)
  }
  return Array.from(counts.entries()).map(([brandId, count]) => `${shuttleBrandName(brandId)} ${count}`).join(' · ')
}

function matchShuttleSequenceText(match) {
  return matchShuttleItems(match).map((item) => `${shuttleBrandName(item.brandId)} #${item.number}`).join(', ') || match?.shuttleSequence || '-'
}

function playerShuttleCost(playerId) {
  let total = 0
  for (const match of [...state.live, ...state.history]) {
    if (!matchPlayers(match).includes(playerId)) continue
    if (isCancelledMatch(match) && match.shuttleReturned) continue
    const items = matchShuttleItems(match)
    if (items.length) {
      total += items.reduce((sum, item) => sum + Number(shuttleBrandById(item.brandId).price || 0), 0)
    } else {
      total += Number(match.shuttles || 0) * Number(state.settings.shuttleFee || 0)
    }
  }
  return total
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

function selectedSubscriptionPackage() {
  return auth.subscriptionPackages.find((item) => item.id === forms.subscriptionSelectedPackageId) || auth.subscriptionPackages[0] || null
}

function selectedShopPackage() {
  return forms.coinShopTab === 'subscription' ? selectedSubscriptionPackage() : selectedCoinPackage()
}

const canSubmitShopOrder = computed(() => {
  if (forms.coinShopTab === 'subscription' && !auth.subscriptionEligibility?.canPurchase) return false
  return Boolean(selectedShopPackage()?.id && forms.coinSlipImage && coinPaymentQrReady.value)
})

const coinPaymentQrReady = computed(() => Boolean(forms.coinPaymentQrDataUrl || auth.coinPaymentQrImage))
const selectedPromptPayPayload = computed(() => forms.coinShopTab === 'subscription'
  ? auth.subscriptionPromptPayPayloads?.[forms.subscriptionSelectedPackageId] || ''
  : auth.promptPayPayloads?.[forms.coinSelectedPackageId] || '')

async function refreshCoinPaymentQr() {
  const payload = selectedPromptPayPayload.value
  if (payload) {
    try {
      const QRCode = (await import('qrcode')).default
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
  () => [forms.coinShopTab, forms.coinSelectedPackageId, forms.subscriptionSelectedPackageId, auth.promptPayPayloads, auth.subscriptionPromptPayPayloads],
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
  state.players.push({ id, name, games: 0, wins: 0, draws: 0, losses: 0, shuttles: 0, paid: false, active: true, level: state.settings.levels[0] || 'กลาง', coupon: false, clubMember: forms.newPlayerClubMember })
  forms.newPlayerName = ''
  forms.newPlayerClubMember = false
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
  if (player.paid) {
    player.coupon = false
    state.couples = state.couples.filter((couple) => couple.a !== player.id && couple.b !== player.id)
  }
}

function normalizeSessionDefaults(input = {}) {
  const base = defaultSessionSettingsTemplate()
  const next = {
    ...base,
    ...input,
    courtNames: Array.isArray(input.courtNames) ? input.courtNames.map((name) => String(name || '').trim()).filter(Boolean) : base.courtNames,
    levels: Array.isArray(input.levels) ? input.levels.map((name) => String(name || '').trim()).filter(Boolean) : base.levels,
    shuttleBrands: Array.isArray(input.shuttleBrands) ? input.shuttleBrands.map((brand) => ({
      id: String(brand.id || brand.name || `brand-${Date.now()}`).trim() || `brand-${Date.now()}`,
      name: String(brand.name || '').trim(),
      price: Math.max(0, Number(brand.price || 0)),
      active: Boolean(brand.active)
    })).filter((brand) => brand.name) : base.shuttleBrands
  }
  next.entryFee = Math.max(0, Number(next.entryFee || 0))
  next.clubEntryFee = Math.max(0, Number(next.clubEntryFee || next.entryFee || 0))
  next.courtFeePerHour = Math.max(0, Number(next.courtFeePerHour || 0))
  if (!next.courtNames.length) next.courtNames = [...base.courtNames]
  if (!next.levels.length) next.levels = [...base.levels]
  if (!next.shuttleBrands.length) next.shuttleBrands = [...base.shuttleBrands]
  if (!next.shuttleBrands.some((brand) => brand.active)) next.shuttleBrands[0].active = true
  next.shuttleFee = Number(next.shuttleBrands[0]?.price || next.shuttleFee || 0)
  next.courtCount = next.courtNames.length
  if (!String(next.announcementTemplate || '').trim()) next.announcementTemplate = defaultAnnouncementTemplate
  return next
}

function randomMatch() {
  while (true) {
    const { selected, level } = pickRandomMatch(randomEligibleGroups.value)
    if (selected.length < 4) return

    const teams = arrangeTeamsByTeammateHistory(selected, state.couples, state.history)

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

function startMatch(match, court = '', brandId = defaultShuttleBrand().id) {
  if (!court) return
  if (!matchLevelsAllowed(match)) return
  state.queue = state.queue.filter((item) => item.id !== match.id)
  const started = { ...match, court, shuttles: 0, shuttleSequence: '', shuttleSequenceItems: [], status: 'กำลังเล่น', startedAt: currentTime() }
  if (state.settings.startMatchWithShuttle) {
    const number = nextShuttleNumber(brandId)
    started.shuttles = 1
    started.shuttleSequenceItems.push({ brandId, number })
    started.shuttleSequence = appendShuttleNumber(started.shuttleSequence, number)
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
  delete forms.matchCourts[match.id]
}

function adjustShuttle(match, delta, brandId = defaultShuttleBrand().id) {
  if (delta <= 0) return
  for (let index = 0; index < delta; index += 1) {
    const nextNumber = nextShuttleNumber(brandId)
    match.shuttles += 1
    normalizeMatchShuttleItems(match).push({ brandId, number: nextNumber })
    match.shuttleSequence = appendShuttleNumber(match.shuttleSequence || '', nextNumber)
  }
}

function createManualMatch(match) {
  const ids = [match.a1, match.a2, match.b1, match.b2].map(Number)
  if (ids.some((id) => !id) || new Set(ids).size !== 4) {
    throw new Error('กรุณาเลือกผู้เล่นให้ครบ 4 คนโดยไม่ซ้ำกัน')
  }
  const availableIds = new Set(availablePlayers.value.map((player) => player.id))
  if (ids.some((id) => !availableIds.has(id))) {
    throw new Error('มีผู้เล่นที่ไม่ว่างหรือไม่สามารถจัดทีมได้')
  }
  const teamByPlayer = new Map([
    [ids[0], 0],
    [ids[1], 0],
    [ids[2], 1],
    [ids[3], 1]
  ])
  for (const couple of state.couples) {
    const hasA = teamByPlayer.has(couple.a)
    const hasB = teamByPlayer.has(couple.b)
    if (hasA !== hasB) throw new Error('คู่ที่กำหนดไว้ต้องถูกเลือกมาด้วยกัน')
    if (hasA && teamByPlayer.get(couple.a) !== teamByPlayer.get(couple.b)) {
      throw new Error('คู่ที่กำหนดไว้ต้องอยู่ทีมเดียวกัน')
    }
  }
  const level = state.settings.levels.includes(match.level) ? match.level : state.settings.levels[0]
  if (!level) throw new Error('กรุณาเลือกระดับมือที่ถูกต้อง')
  state.pending.push({
    id: nextPendingId(),
    court: '-',
    level,
    a1: ids[0],
    a2: ids[1],
    b1: ids[2],
    b2: ids[3]
  })
}

function closeLive(match, cancelled = false, note = '', shuttleReturned = false) {
  selectedLiveId.value = match.id
  const ended = {
    ...match,
    endedAt: currentTime(),
    winner: cancelled ? '' : forms.finishWinner,
    shuttleSequence: match.shuttleSequence || '',
    shuttleSequenceItems: matchShuttleItems(match),
    shuttleReturned: cancelled && shuttleReturned && match.shuttles > 0 && Boolean(match.shuttleSequence),
    status: cancelled ? 'cancelled' : 'finished',
    note: note || forms.finishNote || (cancelled ? 'ยกเลิกการแข่งขัน' : 'จบการแข่งขัน')
  }
  if (ended.shuttleReturned) {
    const latest = matchShuttleItems(ended).at(-1)
    if (latest) {
      ended.returnedShuttleBrandId = latest.brandId
      ended.returnedShuttleNumber = latest.number
      if (!state.returnedShuttles.some((item) => (item.brandId || 'default') === latest.brandId && item.number === latest.number)) {
        state.returnedShuttles.push({ brandId: latest.brandId, number: latest.number })
      }
    }
  }
  state.history.unshift(ended)
  for (const id of matchPlayers(match)) {
    const player = playerById(id)
    if (player && (!cancelled || !ended.shuttleReturned)) {
      player.shuttles += match.shuttles
      if (cancelled) continue
      player.games += 1
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
  if (!ensureSessionActive()) return
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
  if (!ensureSessionActive()) return
  ui.cancelMatch = match
  forms.cancelNote = ''
  forms.cancelShuttleReturned = false
  ui.showCancelModal = true
}

function requestAddShuttle(match) {
  if (!ensureSessionActive()) return
  ui.shuttleMatch = match
  forms.addShuttleBrandId = latestShuttleBrandId(match) || defaultShuttleBrand().id
  ui.showShuttleModal = true
}

let activeSpeechUtterances = []
let activeAnnouncementAudio = null
let announcementRunId = 0
let lastCloudTTSNoticeCode = ''
const announcementAudioCache = createAnnouncementAudioCache(fetchCloudAnnouncementBlob)

function waitForSpeechVoices(timeoutMs = 2500) {
  if (!('speechSynthesis' in window)) return Promise.resolve([])
  const currentVoices = window.speechSynthesis.getVoices()
  if (currentVoices.length) return Promise.resolve(currentVoices)
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.speechSynthesis.removeEventListener?.('voiceschanged', finish)
      resolve(window.speechSynthesis.getVoices())
    }
    window.speechSynthesis.addEventListener?.('voiceschanged', finish)
    window.speechSynthesis.onvoiceschanged = finish
    window.setTimeout(finish, timeoutMs)
  })
}

function announcementParts(match, court = '') {
  const players = matchPlayers(match).map((id) => playerName(id))
  const values = {
    court,
    สนาม: court,
    a: players[0] || '',
    b: players[1] || '',
    c: players[2] || '',
    d: players[3] || ''
  }
  const pauseToken = '__LIVEMATCH_SPEECH_PAUSE__'
  let text = String(state.settings.announcementTemplate || defaultAnnouncementTemplate)
    .replace(/\{\s*pause\s*\}/gi, `\n${pauseToken}\n`)
    .replace(/\{\s*เว้นช่วงพูด\s*\}/g, `\n${pauseToken}\n`)

  for (const [key, value] of Object.entries(values)) {
    text = text.replace(new RegExp(`\\{\\s*${key}\\s*\\}`, 'g'), value)
  }

  return text
    .split(pauseToken)
    .map((part) => part.replace(/\s*\n+\s*/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

async function playAnnouncementChime() {
  try {
    const bell = new Audio('/sounds/announcement-bell.mp3')
    bell.preload = 'auto'
    bell.volume = 0.85
    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(resolve, 2200)
      bell.addEventListener('ended', () => {
        window.clearTimeout(timeout)
        resolve()
      }, { once: true })
      bell.addEventListener('error', () => {
        window.clearTimeout(timeout)
        reject(new Error('announcement bell failed'))
      }, { once: true })
      bell.play().catch((error) => {
        window.clearTimeout(timeout)
        reject(error)
      })
    })
    return
  } catch {
    // Fall back to a generated chime if the audio file is blocked or unavailable.
  }

  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) return
  try {
    const audio = new AudioContext()
    if (audio.state === 'suspended') {
      await audio.resume()
    }
    const now = audio.currentTime
    const gain = audio.createGain()
    gain.connect(audio.destination)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.025)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48)

    for (const [index, frequency] of [880, 1174.66].entries()) {
      const oscillator = audio.createOscillator()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, now + index * 0.12)
      oscillator.connect(gain)
      oscillator.start(now + index * 0.12)
      oscillator.stop(now + index * 0.12 + 0.22)
    }

    await new Promise((resolve) => window.setTimeout(resolve, 560))
    await audio.close()
  } catch {
    // Audio can be blocked on some mobile browsers; speech should still continue.
  }
}

function cloudAnnouncementText(parts) {
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join('\n')
}

async function requestCloudAnnouncementAudio(parts) {
  const text = cloudAnnouncementText(parts)
  if (!text) throw new Error('ไม่มีข้อความสำหรับอ่านออกเสียง')
  return announcementAudioCache.get(text)
}

async function fetchCloudAnnouncementBlob(text) {
	const csrfToken = document.cookie.split('; ').find((item) => item.startsWith('livematch_csrf='))?.split('=').slice(1).join('=') || ''
  const response = await fetch(`${apiUrl}/api/sessions/${state.session.id}/announcement-audio`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg, application/json',
      ...(csrfToken ? { 'X-CSRF-Token': decodeURIComponent(csrfToken) } : {})
    },
    body: JSON.stringify({ text })
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    const error = new Error(payload.error || 'ไม่สามารถสร้างเสียง Google ได้')
    error.code = payload.code || 'tts_unavailable'
    throw error
  }
  const blob = await response.blob()
  if (!blob.size) throw new Error('ไฟล์เสียง Google ว่างเปล่า')
  return blob
}

function stopAnnouncementAudio() {
  if (!activeAnnouncementAudio) return
  activeAnnouncementAudio.pause?.()
  activeAnnouncementAudio.removeAttribute?.('src')
  activeAnnouncementAudio.load?.()
  activeAnnouncementAudio = null
}

function playCloudAnnouncementAudio(url) {
  stopAnnouncementAudio()
  return new Promise((resolve, reject) => {
    const audio = new Audio(url)
    activeAnnouncementAudio = audio
    const finish = () => {
      if (activeAnnouncementAudio === audio) activeAnnouncementAudio = null
      resolve()
    }
    audio.addEventListener('ended', finish, { once: true })
    audio.addEventListener('error', () => {
      if (activeAnnouncementAudio === audio) activeAnnouncementAudio = null
      reject(new Error('ไม่สามารถเล่นไฟล์เสียง Google ได้'))
    }, { once: true })
    audio.play().catch((error) => {
      if (activeAnnouncementAudio === audio) activeAnnouncementAudio = null
      reject(error)
    })
  })
}

function currentThaiSpeechVoice() {
  const voices = window.speechSynthesis.getVoices()
  return voices.find((voice) => voice.lang?.toLowerCase() === 'th-th')
    || voices.find((voice) => voice.lang?.toLowerCase().startsWith('th'))
    || null
}

function resumeSpeechForIOS() {
  window.speechSynthesis.resume?.()
  window.setTimeout(() => window.speechSynthesis.resume?.(), 120)
  window.setTimeout(() => window.speechSynthesis.resume?.(), 450)
}

function primeSpeechForIOS() {
  try {
    const primer = new window.SpeechSynthesisUtterance('.')
    primer.lang = 'th-TH'
    primer.volume = 0
    primer.rate = 1
    activeSpeechUtterances = [primer]
    window.speechSynthesis.speak(primer)
    resumeSpeechForIOS()
  } catch {
    // Some browsers reject silent primer utterances; the real announcement can still try to speak.
  }
}

function speakAnnouncement(parts, thaiVoice = null) {
  activeSpeechUtterances = parts.map((text) => {
    const utterance = new window.SpeechSynthesisUtterance(text)
    utterance.lang = 'th-TH'
    if (thaiVoice) utterance.voice = thaiVoice
    utterance.rate = 0.85
    utterance.pitch = 1
    utterance.onend = () => {
      activeSpeechUtterances = activeSpeechUtterances.filter((item) => item !== utterance)
    }
    utterance.onerror = () => {
      activeSpeechUtterances = activeSpeechUtterances.filter((item) => item !== utterance)
    }
    return utterance
  })
  for (const utterance of activeSpeechUtterances) {
    window.speechSynthesis.speak(utterance)
  }
  resumeSpeechForIOS()
}

async function announceQueuedMatch(match, court = '') {
  if (!court) return
  const hasDeviceSpeech = 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function'
  const runId = ++announcementRunId
  const parts = announcementParts(match, court)
  const cloudResultPromise = requestCloudAnnouncementAudio(parts)
    .then((url) => ({ url, error: null }))
    .catch((error) => ({ url: '', error }))
  stopAnnouncementAudio()
  if (hasDeviceSpeech) {
    window.speechSynthesis.cancel()
    primeSpeechForIOS()
  }
  await playAnnouncementChime()
  const cloudResult = await cloudResultPromise
  if (runId !== announcementRunId) return
  if (cloudResult.url) {
    try {
      await playCloudAnnouncementAudio(cloudResult.url)
      return
    } catch {
      // If MP3 playback is blocked, continue with the device speech fallback.
    }
  } else if (cloudResult.error?.code && cloudResult.error.code !== 'tts_disabled' && lastCloudTTSNoticeCode !== cloudResult.error.code) {
    lastCloudTTSNoticeCode = cloudResult.error.code
    showToast(cloudResult.error.message, 'info')
  }

  if (!hasDeviceSpeech) {
    showToast('Google TTS ใช้งานไม่ได้ และอุปกรณ์นี้ไม่รองรับเสียงสำรอง')
    return
  }
  let thaiVoice = currentThaiSpeechVoice()
  if (!thaiVoice) {
    waitForSpeechVoices(900).then((voices) => {
      const loadedThaiVoice = voices.find((voice) => voice.lang?.toLowerCase() === 'th-th')
        || voices.find((voice) => voice.lang?.toLowerCase().startsWith('th'))
        || null
      speakAnnouncement(parts, loadedThaiVoice)
      if (!loadedThaiVoice) {
        showToast('ไม่พบเสียงภาษาไทยในอุปกรณ์นี้ จะลองอ่านด้วยเสียงเริ่มต้น', 'info')
      }
    })
    return
  }
  speakAnnouncement(parts, thaiVoice)
}

function latestShuttleNumber(match) {
  return matchShuttleItems(match).at(-1)?.number || shuttleSequenceNumbers(match?.shuttleSequence || '').at(-1) || null
}

function latestShuttleBrandId(match) {
  return matchShuttleItems(match).at(-1)?.brandId || defaultShuttleBrand().id
}

function requestReturnShuttle(match) {
  if (!ensureSessionActive() || Number(match?.shuttles || 0) <= 1) return
  ui.returnShuttleMatch = match
  ui.showReturnShuttleModal = true
}

async function confirmAddShuttle() {
  if (!ui.shuttleMatch) return
  await adjustShuttleApi(ui.shuttleMatch, 1, forms.addShuttleBrandId || latestShuttleBrandId(ui.shuttleMatch) || defaultShuttleBrand().id)
  ui.shuttleMatch = null
  forms.addShuttleBrandId = ''
  ui.showShuttleModal = false
}

async function confirmReturnShuttle() {
  if (!ui.returnShuttleMatch) return
  await returnShuttleApi(ui.returnShuttleMatch)
  ui.returnShuttleMatch = null
  ui.showReturnShuttleModal = false
}

function confirmCancelMatch() {
  if (!ui.cancelMatch) return
  closeLive(ui.cancelMatch, true, forms.cancelNote, forms.cancelShuttleReturned)
  ui.cancelMatch = null
  forms.cancelNote = ''
  forms.cancelShuttleReturned = false
  ui.showCancelModal = false
}

function appendShuttleNumber(sequence, number) {
  return sequence ? `${sequence},${number}` : `${number}`
}

function nextShuttleNumber(brandId = defaultShuttleBrand().id) {
  brandId = brandId || defaultShuttleBrand().id
  if ((state.returnedShuttles || []).length) {
    state.returnedShuttles.sort((a, b) => String(a.brandId || 'default').localeCompare(String(b.brandId || 'default')) || a.number - b.number)
    const index = state.returnedShuttles.findIndex((item) => (item.brandId || 'default') === brandId)
    if (index >= 0) {
      const [item] = state.returnedShuttles.splice(index, 1)
      return item.number
    }
  }
  const matches = [...state.live, ...state.history]
  const maxSequence = matches.reduce((max, match) => Math.max(max, ...matchShuttleItems(match).filter((item) => item.brandId === brandId).map((item) => item.number), 0), 0)
  const allocationCount = new Map()
  const returnCount = new Map()
  for (const match of matches) {
    for (const item of matchShuttleItems(match).filter((entry) => entry.brandId === brandId)) {
      const number = item.number
      allocationCount.set(number, (allocationCount.get(number) || 0) + 1)
      if (match.status === 'cancelled' && match.shuttleReturned) {
        returnCount.set(number, (returnCount.get(number) || 0) + 1)
      }
    }
  }
  for (let number = 1; number <= maxSequence; number += 1) {
    if ((allocationCount.get(number) || 0) > 0 && allocationCount.get(number) === returnCount.get(number)) return number
  }
  const legacyCount = matches
    .filter((match) => !match.shuttleSequence)
    .reduce((sum, match) => sum + (match.shuttles || 0), 0)
  return Math.max(maxSequence, legacyCount) + 1
}

function returnLatestShuttle(match) {
  const items = matchShuttleItems(match)
  if (match.shuttles <= 1 || items.length <= 1) return
  const returned = items.pop()
  match.shuttles -= 1
  match.shuttleSequence = items.map((item) => item.number).join(',')
  match.returnedShuttleBrandId = returned.brandId
  match.returnedShuttleNumber = returned.number
  if (!state.returnedShuttles.some((item) => (item.brandId || 'default') === returned.brandId && item.number === returned.number)) {
    state.returnedShuttles.push({ brandId: returned.brandId, number: returned.number })
  }
}

async function loadBackofficeCoinLedger(page = forms.backofficeLedgerPage) {
  const params = new URLSearchParams({
    page: String(Math.max(1, Number(page || 1))),
    pageSize: String(forms.backofficeLedgerPageSize)
  })
  const payload = await api(`/api/backoffice/coin-ledger?${params}`, {
    headers: backofficeAuthHeaders()
  })
  forms.backofficeSummary = {
    ...(forms.backofficeSummary || {}),
    coinLedger: payload.items || []
  }
  forms.backofficeLedgerPagination = payload.pagination || { page: 1, pageSize: forms.backofficeLedgerPageSize, total: 0, totalPages: 0 }
  forms.backofficeLedgerPage = forms.backofficeLedgerPagination.page || 1
}

async function resendBackofficeCoinOrderTelegram(orderId) {
  if (forms.backofficeTelegramSendingId) return
  forms.backofficeTelegramSendingId = orderId
  forms.backofficeError = ''
  try {
    await api(`/api/backoffice/coin-orders/${orderId}/telegram`, {
      method: 'POST',
      headers: backofficeAuthHeaders()
    })
    showToast('ส่งรายการซื้อไป Telegram แล้ว', 'info')
  } catch (error) {
    forms.backofficeError = error.message || 'ส่งรายการซื้อไป Telegram ไม่สำเร็จ'
    showToast(forms.backofficeError)
  } finally {
    forms.backofficeTelegramSendingId = ''
  }
}

function shuttleSequenceNumbers(sequence) {
  return sequence.split(',').flatMap((part) => {
    const bounds = part.trim().split('-').map((value) => Number.parseInt(value.trim(), 10))
    if (!Number.isFinite(bounds[0])) return []
    const start = Math.min(bounds[0], Number.isFinite(bounds.at(-1)) ? bounds.at(-1) : bounds[0])
    const end = Math.max(bounds[0], Number.isFinite(bounds.at(-1)) ? bounds.at(-1) : bounds[0])
    return Array.from({ length: end - start + 1 }, (_, index) => start + index)
  })
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

function addShuttleBrand() {
  if (!ensureSessionActive()) return
  const name = forms.newShuttleBrandName.trim()
  if (!name) return
  const idBase = name.toLowerCase().replace(/[^a-z0-9ก-๙]+/gi, '-').replace(/^-|-$/g, '') || `brand-${Date.now()}`
  let id = idBase
  let suffix = 2
  while ((state.settings.shuttleBrands || []).some((brand) => brand.id === id)) {
    id = `${idBase}-${suffix}`
    suffix += 1
  }
  state.settings.shuttleBrands.push({ id, name, price: Math.max(0, Number(forms.newShuttleBrandPrice || 0)), active: true })
  forms.newShuttleBrandName = ''
  forms.newShuttleBrandPrice = 0
  saveSettings().catch(() => {})
}

function addAdminDefaultShuttleBrand() {
  const name = forms.adminDefaultNewShuttleBrandName.trim()
  if (!name) return
  const idBase = name.toLowerCase().replace(/[^a-z0-9ก-๙]+/gi, '-').replace(/^-|-$/g, '') || `brand-${Date.now()}`
  let id = idBase
  let suffix = 2
  while ((auth.defaultSettings.shuttleBrands || []).some((brand) => brand.id === id)) {
    id = `${idBase}-${suffix}`
    suffix += 1
  }
  auth.defaultSettings.shuttleBrands.push({ id, name, price: Math.max(0, Number(forms.adminDefaultNewShuttleBrandPrice || 0)), active: true })
  forms.adminDefaultNewShuttleBrandName = ''
  forms.adminDefaultNewShuttleBrandPrice = 0
}

function removeAdminDefaultShuttleBrand(index) {
  if ((auth.defaultSettings.shuttleBrands || []).length <= 1) return
  auth.defaultSettings.shuttleBrands.splice(index, 1)
  if (!auth.defaultSettings.shuttleBrands.some((brand) => brand.active)) {
    auth.defaultSettings.shuttleBrands[0].active = true
  }
}

function addAdminDefaultCourt() {
  const name = forms.adminDefaultNewCourtName.trim() || `สนาม ${(auth.defaultSettings.courtNames || []).length + 1}`
  auth.defaultSettings.courtNames.push(name)
  forms.adminDefaultNewCourtName = ''
}

function removeAdminDefaultCourt(index) {
  if ((auth.defaultSettings.courtNames || []).length <= 1) return
  auth.defaultSettings.courtNames.splice(index, 1)
}

function addAdminDefaultLevel() {
  const name = forms.adminDefaultNewLevelName.trim()
  if (!name || auth.defaultSettings.levels.includes(name)) return
  auth.defaultSettings.levels.push(name)
  forms.adminDefaultNewLevelName = ''
}

function removeAdminDefaultLevel(index) {
  if ((auth.defaultSettings.levels || []).length <= 1) return
  auth.defaultSettings.levels.splice(index, 1)
}

async function saveAdminDefaultSettings() {
  forms.adminDefaultSettingsStatus = ''
  auth.defaultSettings = normalizeSessionDefaults(auth.defaultSettings)
  try {
    applyAdminPayload(await api('/api/admin/default-settings', {
      method: 'PUT',
      body: JSON.stringify(auth.defaultSettings)
    }))
    forms.adminDefaultSettingsStatus = 'บันทึกค่าเริ่มต้นแล้ว'
    showToast('บันทึกค่าเริ่มต้นแล้ว', 'success')
  } catch (error) {
    forms.adminDefaultSettingsStatus = error.message || 'บันทึกค่าเริ่มต้นไม่สำเร็จ'
    showToast(forms.adminDefaultSettingsStatus)
  }
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
  const QRCode = (await import('qrcode')).default
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
    share.showTotal = state.settings.showTotalOnShare !== false
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
  if (!isSessionReadOnly.value) return true
  showToast(sessionReadOnlyMessage.value)
  return false
}

async function addPlayerApi() {
  if (!ensureSessionActive()) return
  const name = forms.newPlayerName.trim()
  if (!name) return
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/players`, {
      method: 'POST',
      body: JSON.stringify({ name, memberId: forms.newPlayerMemberId, level: state.settings.levels[0] || 'กลาง', coupon: false })
    }))
    forms.newPlayerName = ''
    forms.newPlayerPhone = ''
    forms.newPlayerMemberId = ''
  } catch (error) {
    showToast(error.message || 'เพิ่มผู้เล่นไม่สำเร็จ')
  }
}

async function renamePlayerApi(player, name, clubMember = player.clubMember, memberId = player.memberId) {
  if (!ensureSessionActive()) return
  const nextName = name.trim()
  if (!nextName) return
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/players/${player.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: nextName, clubMember, memberId })
    }))
  } catch {
    renamePlayer(player, nextName)
    player.clubMember = clubMember
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
  const brandId = forms.matchShuttleBrands[match.id] || defaultShuttleBrand().id
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/queue/${match.id}/start`, {
      method: 'POST',
      body: JSON.stringify({ court, brandId })
    }))
    state.tab = 'liveboard'
  } catch {
    startMatch(match, court, brandId)
  }
}

async function createManualMatchApi(match) {
  if (!ensureSessionActive()) throw new Error(sessionReadOnlyMessage.value)
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/pending`, {
      method: 'POST',
      body: JSON.stringify(match)
    }))
  } catch (error) {
    if (error?.status) {
      showToast(error.message || 'สร้างทีมไม่สำเร็จ')
      throw error
    }
    createManualMatch(match)
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

async function adjustShuttleApi(match, delta, brandId = defaultShuttleBrand().id) {
  if (!ensureSessionActive()) return
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/live/${match.id}/shuttles`, {
      method: 'PATCH',
      body: JSON.stringify({ delta, brandId })
    }))
  } catch {
    adjustShuttle(match, delta, brandId)
  }
}

async function returnShuttleApi(match) {
  if (!ensureSessionActive()) return
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/live/${match.id}/shuttles/return`, {
      method: 'POST'
    }))
  } catch {
    returnLatestShuttle(match)
  }
}

async function closeLiveApi(match, cancelled = false, note = '', shuttleReturned = false) {
  if (!ensureSessionActive()) return
  try {
    applyServerState(await api(`/api/sessions/${state.session.id}/live/${match.id}/${cancelled ? 'cancel' : 'finish'}`, {
      method: 'POST',
      body: JSON.stringify({ note, winner: forms.finishWinner, shuttleReturned })
    }))
    forms.finishNote = ''
  } catch {
    closeLive(match, cancelled, note, shuttleReturned)
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
  await closeLiveApi(ui.cancelMatch, true, forms.cancelNote, forms.cancelShuttleReturned)
  ui.cancelMatch = null
  forms.cancelNote = ''
  forms.cancelShuttleReturned = false
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
      body: JSON.stringify({ ...state.settings, sessionName: state.session.name })
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
  apiRequest: api,
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
  isSessionReadOnly: isSessionReadOnly.value,
  isLiveShare: isLiveShare.value,
  money,
  playerCost,
  playerEntryFee,
  playerLiveShareHours,
  playerDeleteBlockReasons,
  playerScore,
  levelLabel,
  matchLevelLabel,
  activeShuttleBrands,
  defaultShuttleBrand,
  shuttleBrandName,
  matchShuttleSummary,
  matchShuttleSequenceText,
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
  announceQueuedMatch,
  cancelQueuedMatch: cancelQueuedMatchApi,
  playerName,
  requestAddShuttle,
  confirmAddShuttle,
  latestShuttleNumber,
  latestShuttleBrandId,
  requestReturnShuttle,
  confirmReturnShuttle,
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
  addShuttleBrand,
  addAdminDefaultShuttleBrand,
  removeAdminDefaultShuttleBrand,
  addAdminDefaultCourt,
  removeAdminDefaultCourt,
  addAdminDefaultLevel,
  removeAdminDefaultLevel,
  saveAdminDefaultSettings,
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
  navigateAdminFeature,
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
  submitSupportIssue,
  loadBackofficeSupportIssues,
  applyBackofficeSupportFilters,
  openBackofficeSupportIssue,
  saveBackofficeSupportIssue,
  loadBackofficeCoinOrders,
  loadBackofficeCoinLedger,
  loadBackofficeActivityLogs,
  applyBackofficeActivityFilters,
  changeBackofficeActivityUser,
  openBackofficeAdminDetail,
  saveBackofficeAdminDiscount,
  saveBackofficeAdminFeatures,
  saveBackofficeAdminSubscription,
  cancelBackofficeAdminSubscription,
  saveBackofficeSettings,
  saveBackofficeCoinShop,
  setupBackofficeTelegramWebhook,
  refreshBackofficeSlipOKQuota,
  addBackofficeCoinPackage,
  removeBackofficeCoinPackage,
  addBackofficeSubscriptionPackage,
  removeBackofficeSubscriptionPackage,
  adjustBackofficeCoins,
  reviewBackofficeCoinOrder,
  resendBackofficeCoinOrderTelegram
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
    <PublicBookingPage v-else-if="publicBookingToken" :api-request="api" :token="publicBookingToken" :theme="state.theme" @toggle-theme="toggleTheme" />
    <PublicProfilePage v-else-if="publicProfileToken" :api-request="api" :token="publicProfileToken" :theme="state.theme" @toggle-theme="toggleTheme" />
    <div v-else-if="!auth.ready && !share.isPublic" data-testid="auth-boot-screen" class="grid min-h-screen place-items-center px-4">
      <div class="grid justify-items-center gap-3 text-center" role="status" aria-live="polite">
        <span class="h-10 w-10 animate-spin rounded-full border-4 border-court-200 border-t-court-600 dark:border-stone-700 dark:border-t-court-400" />
        <p class="font-black">กำลังเตรียมข้อมูลผู้ดูแล</p>
      </div>
    </div>
    <MemberAdminPage v-else-if="adminFeaturePage === 'members' && auth.user" :api-request="api" :auth="auth" />
    <BookingAdminPage v-else-if="adminFeaturePage === 'booking' && auth.user" :api-request="api" />
    <AuthPage v-else-if="adminFeaturePage" v-bind="pageProps" />

    <SharedPlayersPage v-else-if="share.isPublic && share.view === 'players'" :state="state" :share="share" :money="money" :player-cost="playerCost" />
    <SharedQueuePage v-else-if="share.isPublic && share.view === 'queue'" :state="state" :share="share" :player-name="playerName" :match-level-label="matchLevelLabel" />

    <template v-else>
    <header v-if="showAppHeader" class="sticky top-0 z-30 border-b border-stone-200/80 bg-paper-50/80 shadow-[0_10px_30px_rgba(34,41,37,0.06)] backdrop-blur-xl dark:border-stone-700 dark:bg-paper-900/80">
      <div class="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-3 sm:gap-3 sm:px-4">
        <button class="flex min-w-0 items-center gap-2 text-left sm:gap-3" @click="isAdmin ? selectAdminTab('dashboard') : state.tab = 'home'">
          <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-court-500 to-skycourt-500 text-white shadow-soft">
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
            class="grid h-9 w-9 place-items-center rounded-xl border border-court-200 bg-white text-court-700 transition hover:bg-court-500/10 dark:border-court-900 dark:bg-stone-800 dark:text-court-300 sm:inline-flex sm:h-10 sm:w-auto sm:gap-2 sm:px-3 sm:text-xs sm:font-black"
            title="ซื้อ coin"
            @click="openCoinModal('shop')"
          >
            <Coins class="h-4 w-4" />
            <span class="hidden sm:inline">ซื้อ coin</span>
          </button>
          <button
            v-if="auth.user && !isAdmin"
            class="grid h-9 w-9 place-items-center rounded-xl border border-stone-200 bg-white text-stone-700 transition hover:bg-paper-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 sm:h-10 sm:w-10"
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
      <nav v-if="isAdmin" class="scrollbar-none mx-auto hidden max-w-7xl gap-1.5 overflow-x-auto px-4 pb-3 md:flex">
        <button
          v-for="tab in adminTabs"
          :key="tab.id"
          class="flex h-10 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-black transition"
          :class="state.tab === tab.id ? 'bg-court-500 text-white shadow-soft dark:bg-court-500 dark:text-white' : 'text-stone-600 hover:bg-white/80 dark:text-stone-300 dark:hover:bg-stone-800'"
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

      <div v-if="isAdmin && isSessionReadOnly" class="mb-3 grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200 sm:grid-cols-[1fr_auto] sm:items-center">
        <span>{{ sessionReadOnlyMessage }}</span>
        <button class="h-10 rounded-md bg-court-500 px-4 text-white" @click="backToAdminDashboard">
          สร้าง session ใหม่
        </button>
      </div>

      <HomePage v-if="isAdmin && state.tab === 'home'" v-bind="pageProps" />

      <DashboardPage v-if="isAdmin && state.tab === 'dashboard'" v-bind="pageProps" />

      <PlayersPage v-if="isAdmin && state.tab === 'players'" v-bind="pageProps" />

      <LiveMatchPage v-if="isAdmin && state.tab === 'livematch'" v-bind="pageProps" />

      <QueuePage
        v-if="isAdmin && state.tab === 'queue'"
        :state="state"
        :forms="forms"
        :match-level-label="matchLevelLabel"
        :open-queue-qr="openQueueQr"
        :start-match="startMatchApi"
        :announce-queued-match="announceQueuedMatch"
        :cancel-queued-match="cancelQueuedMatchApi"
        :player-name="playerName"
        :available-court-names="availableCourtNames"
        :active-shuttle-brands="activeShuttleBrands"
        :is-session-read-only="isSessionReadOnly"
      />

      <LiveBoardPage v-if="isAdmin && state.tab === 'liveboard'" v-bind="pageProps" />

      <HistoryPage v-if="isAdmin && state.tab === 'history'" v-bind="pageProps" />

      <SettingsPage v-if="isAdmin && state.tab === 'settings'" v-bind="pageProps" />

      <LiveShareHoursPage v-if="isAdmin && state.tab === 'liveShareHours' && isLiveShare" v-bind="pageProps" />

      <HelpPage v-if="isAdmin && state.tab === 'help'" v-bind="pageProps" />
    </main>

    <nav
      v-if="isAdmin"
      class="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-paper-50/85 px-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgba(34,41,37,0.08)] backdrop-blur-xl dark:border-stone-700 dark:bg-paper-900/85 md:hidden"
    >
      <div class="mx-auto flex max-w-lg gap-1 overflow-x-auto">
        <button
          v-for="tab in mobileTabs"
          :key="tab.id"
          class="flex h-14 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-bold leading-none transition"
          :class="state.tab === tab.id ? 'bg-court-500 text-white shadow-soft dark:bg-court-500 dark:text-white' : 'text-stone-500 active:bg-stone-100 dark:text-stone-400 dark:active:bg-stone-800'"
          @click="selectAdminTab(tab.id)"
        >
          <component :is="tab.icon" class="h-5 w-5 shrink-0" />
          <span class="max-w-full truncate">{{ tab.label }}</span>
        </button>
      </div>
    </nav>

    <MatchSetupModal v-if="isAdmin && (ui.showCouponModal || ui.showCoupleModal)" v-bind="pageProps" />

    <ManualTeamModal
      v-if="isAdmin && ui.showManualTeamModal"
      :state="state"
      :players="availablePlayers"
      :create-manual-match="createManualMatchApi"
      :is-session-read-only="isSessionReadOnly"
      @close="ui.showManualTeamModal = false"
    />

    <div v-if="ui.showCoinModal" class="fixed inset-0 z-40 grid place-items-end bg-stone-950/55 backdrop-blur-sm sm:place-items-center sm:p-4">
      <div class="flex h-[100dvh] w-full flex-col overflow-hidden bg-paper-50 shadow-2xl dark:bg-stone-900 sm:h-auto sm:max-h-[92vh] sm:max-w-6xl sm:rounded-2xl sm:border sm:border-stone-200 dark:sm:border-stone-700">
        <header class="shrink-0 border-b border-stone-200 bg-white px-4 py-4 dark:border-stone-700 dark:bg-stone-900 sm:px-6">
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 items-center gap-3">
              <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-shuttle-400 text-stone-950"><Coins class="h-5 w-5" /></span>
              <div class="min-w-0">
                <h2 class="truncate text-xl font-black">Coin และแพ็กเกจ</h2>
                <p class="mt-0.5 text-xs font-semibold text-stone-500 dark:text-stone-400">เลือกแพ็กเกจ ชำระเงิน และส่งสลิปในที่เดียว</p>
                <span class="mt-2 inline-flex rounded-md bg-paper-100 px-2 py-1 text-[11px] font-black text-stone-600 dark:bg-stone-800 dark:text-stone-300 sm:hidden">Coin คงเหลือ {{ Number(auth.user?.coins || 0).toLocaleString('th-TH') }}</span>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <div class="hidden rounded-lg bg-paper-100 px-3 py-2 text-right dark:bg-stone-800 sm:block">
                <p class="text-[10px] font-black uppercase tracking-wide text-stone-400">Coin คงเหลือ</p>
                <p class="text-lg font-black tabular-nums">{{ Number(auth.user?.coins || 0).toLocaleString('th-TH') }}</p>
              </div>
              <button class="grid h-10 w-10 place-items-center rounded-lg border border-stone-200 text-stone-500 transition hover:bg-paper-100 dark:border-stone-700 dark:hover:bg-stone-800" aria-label="ปิด modal" @click="ui.showCoinModal = false"><X class="h-4 w-4" /></button>
            </div>
          </div>

          <nav class="mt-4 grid grid-cols-3 gap-1 rounded-lg bg-paper-100 p-1 dark:bg-stone-800" aria-label="เมนู Coin และแพ็กเกจ">
            <button type="button" class="inline-flex h-10 items-center justify-center gap-2 rounded-md text-xs font-black transition sm:text-sm" :class="forms.coinModalMode === 'shop' ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-white' : 'text-stone-500'" @click="openCoinModal('shop')"><Coins class="h-4 w-4" />ซื้อแพ็กเกจ</button>
            <button type="button" class="inline-flex h-10 items-center justify-center gap-2 rounded-md text-xs font-black transition sm:text-sm" :class="forms.coinModalMode === 'orders' ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-white' : 'text-stone-500'" @click="forms.coinModalMode = 'orders'"><ClipboardList class="h-4 w-4" />รายการชำระ</button>
            <button type="button" class="inline-flex h-10 items-center justify-center gap-2 rounded-md text-xs font-black transition sm:text-sm" :class="forms.coinModalMode === 'history' ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-white' : 'text-stone-500'" @click="forms.coinModalMode = 'history'"><History class="h-4 w-4" />ประวัติ Coin</button>
          </nav>
        </header>

        <main class="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          <section v-if="forms.coinModalMode === 'shop'" class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div class="min-w-0">
              <div class="mb-4 grid grid-cols-3 gap-2 text-center text-[11px] font-black text-stone-500">
                <div class="rounded-lg bg-white px-2 py-2 dark:bg-stone-800"><span class="mr-1 text-court-600">1</span>เลือกแพ็กเกจ</div>
                <div class="rounded-lg bg-white px-2 py-2 dark:bg-stone-800"><span class="mr-1 text-court-600">2</span>สแกนจ่าย</div>
                <div class="rounded-lg bg-white px-2 py-2 dark:bg-stone-800"><span class="mr-1 text-court-600">3</span>ส่งสลิป</div>
              </div>

              <div class="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900">
                <nav class="grid grid-cols-2 gap-1 rounded-lg bg-paper-100 p-1 dark:bg-stone-800" aria-label="ประเภทสินค้า">
                  <button type="button" class="h-11 rounded-md text-sm font-black transition" :class="forms.coinShopTab === 'coin' ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-white' : 'text-stone-500'" @click="forms.coinShopTab = 'coin'">เติม Coin</button>
                  <button type="button" class="h-11 rounded-md text-sm font-black transition" :class="forms.coinShopTab === 'subscription' ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-white' : 'text-stone-500'" @click="forms.coinShopTab = 'subscription'">แพ็กเกจรายเดือน</button>
                </nav>

                <div v-if="forms.coinShopTab === 'coin'" class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <button v-for="pkg in auth.coinPackages" :key="pkg.id" type="button" class="relative min-h-40 rounded-xl border p-4 text-left transition" :class="forms.coinSelectedPackageId === pkg.id ? 'border-shuttle-500 bg-shuttle-400/10 ring-2 ring-shuttle-500/15' : 'border-stone-200 hover:border-stone-300 hover:bg-paper-50 dark:border-stone-700 dark:hover:bg-stone-800'" @click="forms.coinSelectedPackageId = pkg.id">
                    <span v-if="forms.coinSelectedPackageId === pkg.id" class="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-shuttle-400 text-stone-950"><Check class="h-3.5 w-3.5" /></span>
                    <p class="pr-8 text-base font-black">{{ pkg.name }}</p>
                    <p class="mt-3 text-2xl font-black tabular-nums">฿{{ Number(pkg.priceThb || 0).toLocaleString('th-TH') }}</p>
                    <p class="mt-3 text-sm font-black text-shuttle-700 dark:text-shuttle-300">รับ {{ Number(pkg.coins || 0).toLocaleString('th-TH') }} Coin</p>
                    <span v-if="pkg.bonusText" class="mt-2 inline-flex rounded-md bg-court-500/10 px-2 py-1 text-[11px] font-black text-court-700 dark:text-court-300">{{ pkg.bonusText }}</span>
                  </button>
                </div>
                <p v-if="forms.coinShopTab === 'coin' && !auth.coinPackages.length" class="mt-3 rounded-lg bg-paper-100 p-5 text-center text-sm font-semibold text-stone-500 dark:bg-stone-800">ยังไม่มีโปรโมชัน Coin</p>

                <div v-if="forms.coinShopTab === 'subscription'" class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <button v-for="pkg in auth.subscriptionPackages" :key="pkg.id" type="button" class="relative min-h-40 rounded-xl border p-4 text-left transition" :class="forms.subscriptionSelectedPackageId === pkg.id ? 'border-court-500 bg-court-500/10 ring-2 ring-court-500/15' : 'border-stone-200 hover:border-stone-300 hover:bg-paper-50 dark:border-stone-700 dark:hover:bg-stone-800'" @click="forms.subscriptionSelectedPackageId = pkg.id">
                    <span v-if="forms.subscriptionSelectedPackageId === pkg.id" class="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-court-500 text-white"><Check class="h-3.5 w-3.5" /></span>
                    <p class="pr-8 text-base font-black">{{ pkg.name }}</p>
                    <p class="mt-3 text-2xl font-black tabular-nums">฿{{ Number(pkg.priceThb || 0).toLocaleString('th-TH') }}</p>
                    <p class="mt-3 text-sm font-black text-court-700 dark:text-court-300">{{ Number(pkg.totalSessions || 0).toLocaleString('th-TH') }} Session · {{ Number(pkg.durationDays || 0).toLocaleString('th-TH') }} วัน</p>
                    <span v-if="pkg.bonusText" class="mt-2 inline-flex rounded-md bg-court-500/10 px-2 py-1 text-[11px] font-black text-court-700 dark:text-court-300">{{ pkg.bonusText }}</span>
                  </button>
                </div>
                <p v-if="forms.coinShopTab === 'subscription' && !auth.subscriptionPackages.length" class="mt-3 rounded-lg bg-paper-100 p-5 text-center text-sm font-semibold text-stone-500 dark:bg-stone-800">ยังไม่มีแพ็กเกจรายเดือนเปิดขาย</p>
              </div>

              <div v-if="forms.coinShopTab === 'subscription' && auth.subscriptionEligibility?.renewal" class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                ต่ออายุล่วงหน้า · รอบใหม่คาดว่าจะเริ่มวันที่ {{ auth.subscriptionEligibility.estimatedStartDate }} หลังรอบเดิมสิ้นสุด {{ auth.subscriptionEligibility.currentEndDate }}
              </div>
              <div v-if="forms.coinShopTab === 'subscription' && !auth.subscriptionEligibility?.canPurchase" class="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{{ auth.subscriptionEligibility?.reason || 'ยังไม่สามารถซื้อแพ็กเกจรายเดือนได้' }}</div>
            </div>

            <aside class="h-max rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900 lg:sticky lg:top-0">
              <div class="flex items-start justify-between gap-3 border-b border-stone-100 pb-3 dark:border-stone-800">
                <div>
                  <p class="text-xs font-black text-stone-400">ยอดชำระ</p>
                  <p class="mt-1 text-3xl font-black tabular-nums">฿{{ Number(selectedShopPackage()?.priceThb || 0).toLocaleString('th-TH') }}</p>
                </div>
                <span class="rounded-md bg-paper-100 px-2 py-1 text-xs font-black text-stone-500 dark:bg-stone-800">{{ forms.coinShopTab === 'subscription' ? 'รายเดือน' : 'Coin' }}</span>
              </div>
              <p class="mt-3 font-black">{{ selectedShopPackage()?.name || 'กรุณาเลือกแพ็กเกจ' }}</p>
              <p class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">
                <template v-if="forms.coinShopTab === 'subscription'">{{ Number(selectedShopPackage()?.totalSessions || 0).toLocaleString('th-TH') }} Session · {{ Number(selectedShopPackage()?.durationDays || 0).toLocaleString('th-TH') }} วัน</template>
                <template v-else>รับ {{ Number(selectedShopPackage()?.coins || 0).toLocaleString('th-TH') }} Coin</template>
              </p>

              <div class="mt-4 grid min-h-52 place-items-center rounded-xl bg-paper-100 p-3 dark:bg-stone-800">
                <img v-if="forms.coinPaymentQrDataUrl" :src="forms.coinPaymentQrDataUrl" alt="PromptPay QR ตามยอด" class="h-48 w-48 rounded-lg bg-white object-contain p-2" />
                <img v-else-if="auth.coinPaymentQrImage" :src="auth.coinPaymentQrImage" alt="QR ชำระเงินสำรอง" class="h-48 w-48 rounded-lg bg-white object-contain p-2" />
                <p v-else class="max-w-48 text-center text-sm font-bold text-stone-500">Backoffice ยังไม่ได้ตั้ง PromptPay หรือ QR สำรอง</p>
              </div>
              <p class="mt-2 text-center text-[11px] font-bold" :class="forms.coinPaymentQrDataUrl ? 'text-court-700 dark:text-court-300' : 'text-amber-700 dark:text-amber-300'">{{ forms.coinPaymentQrDataUrl ? 'QR สร้างตามยอดแพ็กเกจนี้แล้ว' : 'กรุณาโอนตามยอดที่แสดง' }}</p>

              <label class="mt-4 flex min-h-20 cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed border-stone-300 px-3 text-center text-sm font-black transition hover:border-court-500 hover:bg-court-500/5 dark:border-stone-700">
                <Upload class="h-5 w-5 text-court-600" />
                <span>{{ forms.coinSlipImage ? 'เปลี่ยนรูปสลิป' : 'เลือกรูปสลิป' }}</span>
                <input type="file" accept="image/*" class="hidden" @change="handleCoinSlipFile" />
              </label>
              <img v-if="forms.coinSlipImage" :src="forms.coinSlipImage" alt="สลิปที่เลือก" class="mt-3 h-28 w-full rounded-lg border border-stone-200 bg-paper-100 object-contain dark:border-stone-700 dark:bg-stone-800" />
              <button class="mt-4 h-12 w-full rounded-lg bg-court-500 px-4 font-black text-white transition hover:bg-court-600 disabled:cursor-not-allowed disabled:opacity-40" :disabled="!canSubmitShopOrder" @click="submitCoinOrder">ส่งสลิปตรวจสอบ</button>
              <p v-if="forms.coinOrderStatus" class="mt-3 rounded-lg bg-paper-100 px-3 py-2 text-sm font-bold text-stone-600 dark:bg-stone-800 dark:text-stone-300">{{ forms.coinOrderStatus }}</p>
            </aside>
          </section>

          <section v-else-if="forms.coinModalMode === 'orders'" class="mx-auto grid max-w-3xl gap-3">
            <div class="mb-1 flex items-end justify-between gap-3">
              <div><h3 class="text-lg font-black">รายการชำระเงิน</h3><p class="mt-1 text-sm font-semibold text-stone-500">ตรวจสอบสถานะสลิปและสิทธิ์ที่ได้รับ</p></div>
              <span class="rounded-md bg-white px-3 py-1 text-xs font-black dark:bg-stone-800">{{ auth.coinOrders.length }} รายการ</span>
            </div>
            <article v-for="order in auth.coinOrders" :key="order.id" class="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0"><p class="truncate font-black">{{ order.packageName || order.packageId }}</p><p class="mt-1 text-xs font-semibold text-stone-500">{{ order.createdAt }} · {{ order.productType === 'subscription' ? 'แพ็กเกจรายเดือน' : 'เติม Coin' }}</p></div>
                <span class="shrink-0 rounded-md px-2 py-1 text-xs font-black" :class="coinOrderStatusClass(order.status)">{{ coinOrderStatusText(order.status) }}</span>
              </div>
              <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div class="rounded-lg bg-paper-100 p-3 dark:bg-stone-800"><p class="text-[10px] font-black text-stone-400">ยอดชำระ</p><p class="mt-1 font-black">฿{{ Number(order.priceThb || 0).toLocaleString('th-TH') }}</p></div>
                <div class="rounded-lg bg-paper-100 p-3 dark:bg-stone-800"><p class="text-[10px] font-black text-stone-400">ได้รับ</p><p class="mt-1 font-black text-court-700 dark:text-court-300">{{ order.productType === 'subscription' ? `${Number(order.totalSessions || 0).toLocaleString('th-TH')} Session` : `${Number(order.coins || 0).toLocaleString('th-TH')} Coin` }}</p></div>
                <div class="col-span-2 rounded-lg bg-paper-100 p-3 dark:bg-stone-800 sm:col-span-1"><p class="text-[10px] font-black text-stone-400">เลขรายการ</p><p class="mt-1 truncate text-xs font-black">{{ order.id }}</p></div>
              </div>
              <p v-if="order.note" class="mt-3 text-xs font-semibold text-stone-500">{{ order.note }}</p>
            </article>
            <p v-if="!auth.coinOrders.length" class="rounded-xl bg-white p-8 text-center text-sm font-semibold text-stone-500 dark:bg-stone-800">ยังไม่มีรายการชำระเงิน</p>
          </section>

          <section v-else class="mx-auto grid max-w-3xl gap-3">
            <div class="mb-1 flex items-end justify-between gap-3"><div><h3 class="text-lg font-black">ประวัติ Coin</h3><p class="mt-1 text-sm font-semibold text-stone-500">รายการเติมและใช้ Coin ของบัญชีนี้</p></div><span class="rounded-lg bg-shuttle-400 px-3 py-2 text-sm font-black text-stone-950">คงเหลือ {{ Number(auth.user?.coins || 0).toLocaleString('th-TH') }}</span></div>
            <article v-for="item in auth.coinLedger" :key="item.id" class="flex items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
              <div class="min-w-0"><p class="font-black" :class="item.delta > 0 ? 'text-court-700 dark:text-court-300' : 'text-red-700 dark:text-red-300'">{{ coinReasonText(item) }}</p><p class="mt-1 text-xs font-semibold text-stone-500">{{ item.createdAt }} · คงเหลือ {{ Number(item.balance || 0).toLocaleString('th-TH') }}</p></div>
              <p class="shrink-0 text-lg font-black tabular-nums" :class="item.delta > 0 ? 'text-court-700 dark:text-court-300' : 'text-red-700 dark:text-red-300'">{{ item.delta > 0 ? '+' : '' }}{{ item.delta }}</p>
            </article>
            <p v-if="!auth.coinLedger.length" class="rounded-xl bg-white p-8 text-center text-sm font-semibold text-stone-500 dark:bg-stone-800">ยังไม่มีประวัติ Coin</p>
          </section>
        </main>
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
