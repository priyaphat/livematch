import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import MatchSetupModal from './components/MatchSetupModal.vue'
import SupportIssueModal from './components/SupportIssueModal.vue'
import AuthPage from './pages/AuthPage.vue'
import BackofficePage from './pages/BackofficePage.vue'
import DashboardPage from './pages/DashboardPage.vue'
import HelpPage from './pages/HelpPage.vue'
import HistoryPage from './pages/HistoryPage.vue'
import LiveBoardPage from './pages/LiveBoardPage.vue'
import LiveMatchPage from './pages/LiveMatchPage.vue'
import LiveShareHoursPage from './pages/LiveShareHoursPage.vue'
import PlayersPage from './pages/PlayersPage.vue'
import QueuePage from './pages/QueuePage.vue'
import SettingsPage from './pages/SettingsPage.vue'
import SharedPlayersPage from './pages/SharedPlayersPage.vue'
import SharedQueuePage from './pages/SharedQueuePage.vue'
import { applyStoredTheme } from './theme'

function sessionStatePayload(type = 'liveMatch', extraSession = {}) {
  return {
    tab: 'home',
    theme: 'light',
    session: { id: 'test-session', name: 'Test Session', type, adminPasscode: '', unlocked: true, ...extraSession },
    settings: {
      entryFee: 0,
      courtFeePerHour: 150,
      shuttleFee: 0,
      sessionFee: 0,
      courtCount: 1,
      courtNames: ['สนาม 1'],
      levels: ['light', 'middle', 'heavy'],
      allowCrossLevel: true,
      crossLevelRange: 1,
      randomPriority: 'level',
      showPaymentOnShare: true,
      resetPlayersAfterFinish: true,
      startMatchWithShuttle: type !== 'liveShare'
    },
    players: [],
    couples: [],
    pending: [],
    queue: [],
    live: [],
    history: [],
    liveShare: { courtHours: {}, playerHours: {}, shuttleHours: {} },
    nextIds: { player: 0, match: 0, couple: 0, pending: 0 }
  }
}

async function openMockedOwnedSession(type = 'liveMatch', extraSession = {}) {
  const statePayload = sessionStatePayload(type, extraSession)
  const originalFetch = globalThis.fetch
  globalThis.fetch = vi.fn((url) => {
    const target = String(url)
    if (target.includes('/api/auth/me')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin', verified: true, coins: 5 },
          sessions: [{ id: 'test-session', name: 'Test Session', type, updatedAt: '2026-06-23 21:00' }],
          coinLedger: [],
          liveMatchSessionCost: 1,
          liveShareSessionCost: 1
        })
      })
    }
    if (target.includes('/dashboard')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ players: [] })
      })
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(statePayload)
    })
  })

  const wrapper = mount(App)
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
  const openButton = wrapper.findAll('button').find((button) => ['เปิด', 'Open'].some((label) => button.text().includes(label)))
  expect(openButton?.exists()).toBe(true)
  await openButton.trigger('click')
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
  return { wrapper, originalFetch }
}

describe('LiveMatch app', () => {
  it('hides admin screens before admin account login', () => {
    const wrapper = mount(App)

    expect(wrapper.text()).toContain('LiveMatch')
    expect(wrapper.text()).toContain('เข้าสู่ระบบ')
    expect(wrapper.text()).toContain('สมัครสมาชิก')
    expect(wrapper.text()).not.toContain('ผู้เล่นวันนี้')
    expect(wrapper.text()).not.toContain('จัดคู่')
  })
  it('toggles interface language', async () => {
    localStorage.setItem('livematch.language', 'th')
    const wrapper = mount(App)
    const languageButton = wrapper.findAll('button').find((button) => button.text() === 'EN')
    expect(languageButton.exists()).toBe(true)
    await languageButton.trigger('click')
    expect(wrapper.text()).toContain('TH')
  })

  it('restores and persists dark mode preference', async () => {
    localStorage.removeItem('livematch.adminSessionId')
    localStorage.removeItem('livematch.theme')
    document.documentElement.classList.remove('dark')
    const wrapper = mount(App)

    const darkButton = wrapper.findAll('button').find((button) => button.attributes('title') === 'Dark mode')
    expect(darkButton.exists()).toBe(true)
    await darkButton.trigger('click')

    expect(localStorage.getItem('livematch.theme')).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    wrapper.unmount()
    document.documentElement.classList.remove('dark')

    const restoredWrapper = mount(App)
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    const themeButton = restoredWrapper.findAll('button').find((button) => button.attributes('title') === 'Light mode')
    expect(themeButton.exists()).toBe(true)
    await themeButton.trigger('click')

    expect(localStorage.getItem('livematch.theme')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    restoredWrapper.unmount()
    localStorage.removeItem('livematch.theme')
    document.documentElement.classList.remove('dark')
  })

  it('creates the theme storage key when the app opens', () => {
    localStorage.removeItem('livematch.theme')
    document.documentElement.classList.remove('dark')

    applyStoredTheme()

    expect(localStorage.getItem('livematch.theme')).toBe('light')
  })

  it('keeps stored dark mode when restored session state says light', async () => {
    localStorage.setItem('livematch.adminSessionId', 'test-session')
    localStorage.setItem('livematch.theme', 'dark')
    document.documentElement.classList.remove('dark')
    const statePayload = {
      tab: 'home',
      theme: 'light',
      session: { id: 'test-session', name: 'Test Session', adminPasscode: '', unlocked: false },
      settings: {
        entryFee: 0,
        shuttleFee: 0,
        courtCount: 1,
        courtNames: ['สนาม 1'],
        levels: ['light', 'middle', 'heavy'],
        allowCrossLevel: true,
        crossLevelRange: 1,
        randomPriority: 'level',
        showPaymentOnShare: true,
        resetPlayersAfterFinish: true,
        startMatchWithShuttle: true
      },
      players: [],
      couples: [],
      pending: [],
      queue: [],
      live: [],
      history: [],
      nextIds: { player: 0, match: 0, couple: 0, pending: 0 }
    }
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(statePayload)
    }))

    const wrapper = mount(App)
    await Promise.resolve()
    await Promise.resolve()

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('livematch.theme')).toBe('dark')

    wrapper.unmount()
    globalThis.fetch = originalFetch
    localStorage.removeItem('livematch.adminSessionId')
    localStorage.removeItem('livematch.theme')
    document.documentElement.classList.remove('dark')
  })

  it('renders Telegram webhook setup controls in backoffice', async () => {
    const setupBackofficeTelegramWebhook = vi.fn()
    const refreshBackofficeSlipOKQuota = vi.fn()
    const wrapper = mount(BackofficePage, {
      props: {
        forms: {
          backofficeTab: 'overview',
          backofficeSummary: { users: [], coinLedger: [], coinPurchaseOrders: [], activityLogs: [] },
          backofficeTelegramBotToken: '',
          backofficeTelegramChatId: '',
          backofficeTelegramWebhookSecret: 'secret-123',
          backofficeTelegramWebhookUrl: 'https://livematch.vibestudio.work/api/telegram/webhook/secret-123',
          backofficeTelegramWebhookStatus: 'ตั้งค่า Telegram webhook สำเร็จ',
          backofficeSlipOKEnabled: true,
          backofficeSlipOKBranchId: 'branch-1',
          backofficeSlipOKApiKey: '',
          backofficeSlipOKApiKeyMasked: 'abcd••••••••wxyz',
          backofficeSlipOKMonthlyCap: 100,
          backofficeSlipOKQuota: { available: true, used: 20, remaining: 80, limit: 100 }
        },
        ui: {},
        backoffice: { unlocked: true },
        loadBackoffice: vi.fn(),
        openBackofficeAdminDetail: vi.fn(),
        saveBackofficeSettings: vi.fn(),
        saveBackofficeCoinShop: vi.fn(),
        setupBackofficeTelegramWebhook,
        refreshBackofficeSlipOKQuota,
        addBackofficeCoinPackage: vi.fn(),
        removeBackofficeCoinPackage: vi.fn(),
        adjustBackofficeCoins: vi.fn(),
        reviewBackofficeCoinOrder: vi.fn(),
        handleBackofficeQrFile: vi.fn(),
        coinOrderStatusText: () => '',
        coinOrderStatusClass: () => ''
      }
    })

    expect(wrapper.text()).toContain('Webhook URL')
    expect(wrapper.find('input[value="https://livematch.vibestudio.work/api/telegram/webhook/secret-123"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Telegram webhook')
    expect(wrapper.text()).toContain('SlipOK verification')
    expect(wrapper.text()).toContain('20 / 100')
    await wrapper.findAll('button').find((button) => button.text().includes('Telegram webhook')).trigger('click')
    expect(setupBackofficeTelegramWebhook).toHaveBeenCalledTimes(1)
    await wrapper.findAll('button').find((button) => button.text().includes('ทดสอบและรีเฟรชโควตา')).trigger('click')
    expect(refreshBackofficeSlipOKQuota).toHaveBeenCalledTimes(1)
  })

  it('opens and submits the public support issue form', async () => {
    const submitSupportIssue = vi.fn().mockResolvedValue({ id: 'issue-test123' })
    const wrapper = mount(AuthPage, {
      props: {
        forms: { authMode: 'login', authEmail: '', authPassword: '', authError: '', authMessage: '' },
        auth: { loading: false },
        loginAdmin: vi.fn(),
        registerAdmin: vi.fn(),
        forgotPassword: vi.fn(),
        resetPassword: vi.fn(),
        language: 'th',
        toggleLanguage: vi.fn(),
        toggleTheme: vi.fn(),
        state: { theme: 'light' },
        submitSupportIssue
      }
    })

    await wrapper.findAll('button').find((button) => button.text().includes('ติดต่อแอดมิน')).trigger('click')
    const dialog = wrapper.get('[role="dialog"]')
    await dialog.get('input[placeholder="สรุปปัญหาที่พบ"]').setValue('กดบันทึกไม่ได้')
    await dialog.get('textarea[placeholder*="เกิดอะไรขึ้น"]').setValue('หน้า setting ไม่ตอบสนอง')
    await dialog.get('input[placeholder*="LINE"]').setValue('line: tester')
    await dialog.get('form').trigger('submit')
    await Promise.resolve()

    expect(submitSupportIssue).toHaveBeenCalledTimes(1)
    expect(submitSupportIssue.mock.calls[0][0]).toBeInstanceOf(FormData)
    expect(wrapper.text()).toContain('issue-test123')
    const footerLink = wrapper.get('a[href="https://www.vibestudio.work/"]')
    expect(footerLink.attributes('target')).toBe('_blank')
    expect(wrapper.text()).toContain('Copyright 2026 LiveMatch v2.1')
  })

  it('rejects support images larger than 3MB before upload', async () => {
    const wrapper = mount(SupportIssueModal, {
      props: { submitSupportIssue: vi.fn() }
    })
    const input = wrapper.get('input[type="file"]')
    const file = new File([new Uint8Array(3 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')

    expect(wrapper.text()).toContain('รูปแต่ละไฟล์ต้องมีขนาดไม่เกิน 3MB')
  })

  it('shows support issues, filters and pagination in backoffice', async () => {
    const applyFilters = vi.fn()
    const loadIssues = vi.fn()
    const openIssue = vi.fn()
    const wrapper = mount(BackofficePage, {
      props: {
        forms: {
          backofficeTab: 'support',
          backofficeSummary: { users: [], coinLedger: [], coinPurchaseOrders: [], activityLogs: [] },
          backofficeSupportIssues: [{ id: 'issue-1', title: 'ทดสอบ', details: 'รายละเอียด', contact: 'line:test', imageCount: 2, status: 'new', createdAt: '2026-06-28 20:00' }],
          backofficeSupportStatus: '',
          backofficeSupportSearch: '',
          backofficeSupportNewCount: 1,
          backofficeSupportPagination: { page: 1, pageSize: 20, total: 21, totalPages: 2 }
        },
        ui: {},
        backoffice: { unlocked: true },
        loadBackoffice: vi.fn(),
        loadBackofficeCoinOrders: vi.fn(),
        loadBackofficeActivityLogs: vi.fn(),
        applyBackofficeActivityFilters: vi.fn(),
        loadBackofficeSupportIssues: loadIssues,
        applyBackofficeSupportFilters: applyFilters,
        openBackofficeSupportIssue: openIssue,
        saveBackofficeSupportIssue: vi.fn(),
        openBackofficeAdminDetail: vi.fn(),
        saveBackofficeSettings: vi.fn(),
        saveBackofficeCoinShop: vi.fn(),
        setupBackofficeTelegramWebhook: vi.fn(),
        addBackofficeCoinPackage: vi.fn(),
        removeBackofficeCoinPackage: vi.fn(),
        adjustBackofficeCoins: vi.fn(),
        reviewBackofficeCoinOrder: vi.fn(),
        handleBackofficeQrFile: vi.fn(),
        coinOrderStatusText: () => '',
        coinOrderStatusClass: () => ''
      }
    })

    await wrapper.get('input[placeholder*="เลขรายการ"]').setValue('issue-1')
    await wrapper.get('form').trigger('submit')
    await wrapper.findAll('button').find((button) => button.text().includes('ทดสอบ')).trigger('click')
    await wrapper.findAll('button').find((button) => button.text().trim() === 'ถัดไป').trigger('click')

    expect(applyFilters).toHaveBeenCalledTimes(1)
    expect(openIssue).toHaveBeenCalledWith('issue-1')
    expect(loadIssues).toHaveBeenCalledWith(2)
    expect(wrapper.text()).toContain('1')
  })

  it('filters and paginates backoffice activity logs', async () => {
    const applyFilters = vi.fn()
    const changeUser = vi.fn()
    const loadActivity = vi.fn()
    const wrapper = mount(BackofficePage, {
      props: {
        forms: {
          backofficeTab: 'activity',
          backofficeSummary: {
            users: [{ id: 'admin-1', email: 'admin@example.com' }],
            coinLedger: [],
            coinPurchaseOrders: [],
            activityLogs: [{ id: 1, action: 'start_match', actorType: 'admin', actorId: 'admin-1', targetType: 'match', targetId: '12', details: '{}', createdAt: '2026-06-28 20:00' }]
          },
          backofficeActivityUserId: '',
          backofficeActivitySessionId: '',
          backofficeActivitySessionOptions: [{ id: 'session-1', label: 'Test Session' }],
          backofficeActivityPagination: { page: 2, pageSize: 20, total: 45, totalPages: 3 }
        },
        ui: {},
        backoffice: { unlocked: true },
        loadBackoffice: vi.fn(),
        loadBackofficeCoinOrders: vi.fn(),
        loadBackofficeActivityLogs: loadActivity,
        applyBackofficeActivityFilters: applyFilters,
        changeBackofficeActivityUser: changeUser,
        openBackofficeAdminDetail: vi.fn(),
        saveBackofficeSettings: vi.fn(),
        saveBackofficeCoinShop: vi.fn(),
        setupBackofficeTelegramWebhook: vi.fn(),
        addBackofficeCoinPackage: vi.fn(),
        removeBackofficeCoinPackage: vi.fn(),
        adjustBackofficeCoins: vi.fn(),
        reviewBackofficeCoinOrder: vi.fn(),
        handleBackofficeQrFile: vi.fn(),
        coinOrderStatusText: () => '',
        coinOrderStatusClass: () => ''
      }
    })

    const filters = wrapper.findAll('form select')
    await filters[0].setValue('admin-1')
    await filters[1].setValue('session-1')
    await wrapper.get('form').trigger('submit')
    const paginationButtons = wrapper.findAll('section button').filter((button) => ['ก่อนหน้า', 'ถัดไป'].includes(button.text().trim()))
    await paginationButtons[1].trigger('click')

    expect(changeUser).toHaveBeenCalledTimes(1)
    expect(applyFilters).toHaveBeenCalledTimes(1)
    expect(filters[1].text()).toContain('Test Session')
    expect(loadActivity).toHaveBeenCalledWith(3)
    expect(wrapper.text()).toContain('หน้า 2 / 3')
  })

  it('paginates coin purchase orders in backoffice', async () => {
    const loadOrders = vi.fn()
    const resendTelegram = vi.fn()
    const wrapper = mount(BackofficePage, {
      props: {
        forms: {
          backofficeTab: 'orders',
          backofficeSummary: {
            users: [],
            coinLedger: [],
            activityLogs: [],
            coinPurchaseOrders: [{ id: 'order-1', adminEmail: 'admin@example.com', packageId: 'starter', priceThb: 100, coins: 100, status: 'approved', verificationNote: 'ยอดเงินไม่ตรง', createdAt: '2026-06-28 20:00' }]
          },
          backofficeOrdersPagination: { page: 1, pageSize: 10, total: 21, totalPages: 3 }
        },
        ui: {},
        backoffice: { unlocked: true },
        loadBackoffice: vi.fn(),
        loadBackofficeCoinOrders: loadOrders,
        loadBackofficeActivityLogs: vi.fn(),
        applyBackofficeActivityFilters: vi.fn(),
        openBackofficeAdminDetail: vi.fn(),
        saveBackofficeSettings: vi.fn(),
        saveBackofficeCoinShop: vi.fn(),
        setupBackofficeTelegramWebhook: vi.fn(),
        addBackofficeCoinPackage: vi.fn(),
        removeBackofficeCoinPackage: vi.fn(),
        adjustBackofficeCoins: vi.fn(),
        reviewBackofficeCoinOrder: vi.fn(),
        resendBackofficeCoinOrderTelegram: resendTelegram,
        handleBackofficeQrFile: vi.fn(),
        coinOrderStatusText: () => 'อนุมัติแล้ว',
        coinOrderStatusClass: () => ''
      }
    })

    const paginationButtons = wrapper.findAll('section button').filter((button) => ['ก่อนหน้า', 'ถัดไป'].includes(button.text().trim()))
    expect(paginationButtons[0].element.disabled).toBe(true)
    await wrapper.get('select[aria-label="จำนวนรายการซื้อต่อหน้า"]').setValue('20')
    await paginationButtons[1].trigger('click')
    await wrapper.findAll('button').find((button) => button.text().includes('Telegram')).trigger('click')
    expect(loadOrders).toHaveBeenCalledWith(1)
    expect(loadOrders).toHaveBeenCalledWith(2)
    expect(resendTelegram).toHaveBeenCalledWith('order-1')
    expect(wrapper.text()).toContain('เหตุผลการตรวจสอบ')
    expect(wrapper.text()).toContain('21 รายการ')
  })

  it('disables settings controls when the session is read-only', () => {
    const wrapper = mount(SettingsPage, {
      props: {
        state: {
          session: { type: 'liveMatch' },
          settings: {
            entryFee: 100,
            shuttleFee: 80,
            sessionFee: 0,
            allowCrossLevel: true,
            resetPlayersAfterFinish: true,
            startMatchWithShuttle: true,
            randomPriority: 'level',
            courtNames: ['1'],
            levels: ['light']
          }
        },
        forms: { newCourtName: '', newLevelName: '' },
        addCourt: vi.fn(),
        removeCourt: vi.fn(),
        addLevel: vi.fn(),
        removeLevel: vi.fn(),
        usedCourtNames: new Set(),
        usedLevels: new Set(),
        saveSettings: vi.fn(),
        isSessionReadOnly: true
      }
    })

    expect(wrapper.find('fieldset').attributes('disabled')).toBeDefined()
    expect(wrapper.find('fieldset').find('input').exists()).toBe(true)
  })

  it('disables liveShare hour editing when the session is read-only', () => {
    const saveLiveShareHours = vi.fn()
    const wrapper = mount(LiveShareHoursPage, {
      props: {
        state: {
          settings: { courtNames: ['1'] },
          players: [{ id: 1, name: 'A', active: true }],
          liveShare: { courtHours: {}, playerHours: {}, shuttleHours: {} }
        },
        money: (value) => `${value}`,
        playerCost: () => 0,
        playerLiveShareHours: () => 0,
        liveShareCourtHours: 0,
        liveSharePlayerHours: 0,
        liveShareCourtCost: 0,
        liveShareShuttleCount: 0,
        liveShareShuttleCost: 0,
        liveShareSessionCost: 0,
        liveShareTotalCost: 0,
        saveLiveShareHours,
        isSessionReadOnly: true
      }
    })

    expect(wrapper.find('button').element.disabled).toBe(true)
    expect(wrapper.find('input[type="checkbox"]').element.disabled).toBe(true)
    expect(wrapper.find('input[type="number"]').element.disabled).toBe(true)
  })

  it('renders LiveMatch guide content', () => {
    const wrapper = mount(HelpPage, {
      props: {
        state: { session: { name: 'Test Match', type: 'liveMatch' } },
        isLiveShare: false
      }
    })

    expect(wrapper.text()).toContain('วิธีใช้ LiveMatch')
    expect(wrapper.text()).toContain('ตั้งค่า')
    expect(wrapper.text()).toContain('จัดคู่')
    expect(wrapper.text()).toContain('QR คิว')
    expect(wrapper.text()).toContain('read-only')
    expect(wrapper.text()).not.toContain('วิธีใช้ LiveShare')
  })

  it('renders LiveShare guide content with hour instructions', () => {
    const wrapper = mount(HelpPage, {
      props: {
        state: { session: { name: 'Test Share', type: 'liveShare' } },
        isLiveShare: true
      }
    })

    expect(wrapper.text()).toContain('วิธีใช้ LiveShare')
    expect(wrapper.text()).toContain('ชั่วโมงเล่น')
    expect(wrapper.text()).toContain('คำนวณแยกทีละชั่วโมง')
    expect(wrapper.text()).toContain('ค่าสนามต่อชั่วโมง')
    expect(wrapper.text()).not.toContain('วิธีใช้ LiveMatch')
  })

  it('shows the guide tab after settings for liveMatch sessions', async () => {
    localStorage.setItem('livematch.language', 'th')
    const { wrapper, originalFetch } = await openMockedOwnedSession('liveMatch')
    const labels = wrapper.findAll('header nav button').map((button) => button.text().trim())
    const settingsIndex = labels.findIndex((label) => label.includes('ตั้งค่า') || label.includes('Settings'))
    const guideIndex = labels.findIndex((label) => label.includes('วิธีใช้') || label.includes('Guide'))
    const hoursIndex = labels.findIndex((label) => label.includes('ชั่วโมงเล่น') || label.includes('Hours'))

    expect(settingsIndex).toBeGreaterThan(-1)
    expect(guideIndex).toBe(settingsIndex + 1)
    expect(hoursIndex).toBe(-1)

    wrapper.unmount()
    globalThis.fetch = originalFetch
    localStorage.removeItem('livematch.language')
  })

  it('shows the guide tab after liveShare hours for liveShare sessions', async () => {
    localStorage.setItem('livematch.language', 'th')
    const { wrapper, originalFetch } = await openMockedOwnedSession('liveShare')
    const labels = wrapper.findAll('header nav button').map((button) => button.text().trim())
    const settingsIndex = labels.findIndex((label) => label.includes('ตั้งค่า') || label.includes('Settings'))
    const hoursIndex = labels.findIndex((label) => label.includes('ชั่วโมงเล่น') || label.includes('Hours'))
    const guideIndex = labels.findIndex((label) => label.includes('วิธีใช้') || label.includes('Guide'))

    expect(settingsIndex).toBeGreaterThan(-1)
    expect(hoursIndex).toBe(settingsIndex + 1)
    expect(guideIndex).toBe(hoursIndex + 1)

    wrapper.unmount()
    globalThis.fetch = originalFetch
    localStorage.removeItem('livematch.language')
  })

  it('keeps the guide tab available for read-only sessions', async () => {
    const { wrapper, originalFetch } = await openMockedOwnedSession('liveMatch', {
      expired: true,
      readOnly: true,
      readOnlyReason: 'paid_complete_24h'
    })
    const guideButton = wrapper.findAll('header nav button').find((button) => button.text().includes('วิธีใช้') || button.text().includes('Guide'))
    expect(guideButton?.exists()).toBe(true)
    await guideButton.trigger('click')
    await Promise.resolve()
    expect(wrapper.text()).toContain('วิธีใช้ LiveMatch')

    wrapper.unmount()
    globalThis.fetch = originalFetch
  })

  it('opens an owned session from the admin supervisor', async () => {
    const statePayload = {
      tab: 'home',
      theme: 'light',
      session: { id: 'test-session', name: 'Test Session', adminPasscode: '', unlocked: true },
      settings: {
        entryFee: 0,
        shuttleFee: 0,
        courtCount: 1,
        courtNames: ['สนาม 1'],
        levels: ['light', 'middle', 'heavy'],
        allowCrossLevel: true,
        crossLevelRange: 1,
        randomPriority: 'level',
        showPaymentOnShare: true,
        resetPlayersAfterFinish: true,
        startMatchWithShuttle: true
      },
      players: [],
      couples: [],
      pending: [],
      queue: [],
      live: [],
      history: [],
      nextIds: { player: 0, match: 0, couple: 0, pending: 0 }
    }
    const calls = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn((url) => {
      calls.push(String(url))
      if (String(url).includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin', verified: true, coins: 5 },
            sessions: [{ id: 'test-session', name: 'Test Session', updatedAt: '2026-06-23 21:00' }],
            coinLedger: [],
            liveMatchSessionCost: 1
          })
        })
      }
      if (String(url).includes('/dashboard')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ players: [] })
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(statePayload)
      })
    })

    const wrapper = mount(App)
    for (let index = 0; index < 5; index += 1) await Promise.resolve()
    await wrapper.findAll('button').find((button) => button.text().includes('เปิด')).trigger('click')
    for (let index = 0; index < 5; index += 1) await Promise.resolve()

    expect(calls.some((call) => call.includes('/api/sessions/test-session/dashboard'))).toBe(true)
    expect(calls.filter((call) => call.includes('/api/sessions/test-session/state')).length).toBe(1)
    expect(wrapper.text()).toContain('Test Session')

    wrapper.unmount()
    globalThis.fetch = originalFetch
  })

  it('defaults random coupon groups to not ready', () => {
    const wrapper = mount(MatchSetupModal, {
      props: {
        state: {
          settings: {
            levels: ['light', 'middle', 'heavy']
          },
          players: []
        },
        forms: {},
        ui: {
          showCouponModal: true,
          showCoupleModal: false
        },
        couponGroups: [
          { ids: [1], name: 'มาริ', level: 'light', coupon: false, games: 0 }
        ],
        levelLabel: (level) => ({ light: 'เบา', middle: 'กลาง', heavy: 'หนัก' }[level] || level),
        playerName: () => '',
        addCouple: () => {},
        removeCouple: () => {},
        updatePlayerRandomStatus: () => {}
      }
    })

    const select = wrapper.get('select')
    expect(select.element.value).toBe('not-ready')
    expect(wrapper.text()).toContain('ยังไม่พร้อม')
  })

  it('opens couple modal with empty player inputs', async () => {
    const forms = { coupleAId: 1, coupleBId: 2 }
    const wrapper = mount(MatchSetupModal, {
      props: {
        state: {
          settings: {
            levels: ['light', 'middle', 'heavy']
          },
          players: [
            { id: 1, name: 'p1', active: true },
            { id: 2, name: 'p2', active: true }
          ],
          couples: []
        },
        forms,
        ui: {
          showCouponModal: false,
          showCoupleModal: true
        },
        couponGroups: [],
        levelLabel: (level) => level,
        playerName: (id) => `p${id}`,
        addCouple: () => {},
        removeCouple: () => {},
        updatePlayerRandomStatus: () => {}
      }
    })

    await Promise.resolve()
    const inputs = wrapper.findAll('input')

    expect(inputs.at(0).element.value).toBe('')
    expect(inputs.at(1).element.value).toBe('')
    expect(forms.coupleAId).toBe('')
    expect(forms.coupleBId).toBe('')
  })

  it('confirms shuttle add without rendering a decrement button', async () => {
    let requested = null
    let confirmed = false
    const ui = {
      showShuttleModal: false,
      shuttleMatch: null,
      showFinishModal: false,
      showCancelModal: false
    }
    const wrapper = mount(LiveBoardPage, {
      props: {
        state: {
          live: [
            { id: 1, court: '1', status: 'playing', a1: 1, a2: 2, b1: 3, b2: 4, shuttles: 0, shuttleSequence: '' }
          ]
        },
        forms: {},
        ui,
        playerName: (id) => `p${id}`,
        requestAddShuttle: (match) => {
          requested = match
          ui.shuttleMatch = match
          ui.showShuttleModal = true
        },
        confirmAddShuttle: () => {
          confirmed = true
        },
        requestFinishMatch: () => {},
        confirmFinishMatch: () => {},
        requestCancelMatch: () => {},
        confirmCancelMatch: () => {}
      }
    })

    expect(wrapper.text()).not.toContain('-')
    await wrapper.get('button').trigger('click')
    expect(requested?.id).toBe(1)
    await wrapper.setProps({ ui: { ...ui } })
    const buttons = wrapper.findAll('button')
    await buttons.at(buttons.length - 1).trigger('click')
    expect(confirmed).toBe(true)
  })

  it('offers draw when finishing a live match', async () => {
    const forms = { finishWinner: '', finishNote: '' }
    const ui = {
      showShuttleModal: false,
      showFinishModal: true,
      finishMatch: { id: 1, a1: 1, a2: 2, b1: 3, b2: 4 },
      showCancelModal: false
    }
    let savedWinner = ''
    const wrapper = mount(LiveBoardPage, {
      props: {
        state: {
          live: [
            { id: 1, court: '1', status: 'playing', a1: 1, a2: 2, b1: 3, b2: 4, shuttles: 0, shuttleSequence: '' }
          ]
        },
        forms,
        ui,
        playerName: (id) => `p${id}`,
        requestAddShuttle: () => {},
        confirmAddShuttle: () => {},
        requestFinishMatch: () => {},
        confirmFinishMatch: () => {
          savedWinner = forms.finishWinner
        },
        requestCancelMatch: () => {},
        confirmCancelMatch: () => {}
      }
    })

    const drawInput = wrapper.get('input[value="draw"]')
    await drawInput.setValue(true)
    await wrapper.findAll('button').at(wrapper.findAll('button').length - 1).trigger('click')

    expect(savedWinner).toBe('draw')
  })

  it('offers an unchecked shuttle return option when cancelling a live match', async () => {
    const forms = { cancelNote: '', cancelShuttleReturned: false }
    const ui = {
      showShuttleModal: false,
      showFinishModal: false,
      showCancelModal: true,
      cancelMatch: {
        id: 2,
        court: '1',
        a1: 1,
        a2: 2,
        b1: 3,
        b2: 4,
        shuttles: 1,
        shuttleSequence: '2'
      }
    }
    let returned = null
    const wrapper = mount(LiveBoardPage, {
      props: {
        state: { live: [ui.cancelMatch] },
        forms,
        ui,
        playerName: (id) => `p${id}`,
        requestAddShuttle: () => {},
        confirmAddShuttle: () => {},
        requestFinishMatch: () => {},
        confirmFinishMatch: () => {},
        requestCancelMatch: () => {},
        confirmCancelMatch: () => {
          returned = forms.cancelShuttleReturned
        }
      }
    })

    const checkbox = wrapper.get('input[type="checkbox"]')
    expect(checkbox.element.checked).toBe(false)
    expect(wrapper.text()).toContain('คืนลูกหมายเลข 2')
    await checkbox.setValue(true)
    await wrapper.findAll('button').at(wrapper.findAll('button').length - 1).trigger('click')

    expect(returned).toBe(true)
  })

  it('shows the return button only for multiple shuttles and confirms the latest number', async () => {
    const match = { id: 5, court: '1', a1: 1, a2: 2, b1: 3, b2: 4, shuttles: 2, shuttleSequence: '5,6' }
    const ui = {
      showShuttleModal: false,
      showReturnShuttleModal: true,
      returnShuttleMatch: match,
      showFinishModal: false,
      showCancelModal: false
    }
    const confirmReturn = vi.fn()
    const wrapper = mount(LiveBoardPage, {
      props: {
        state: { live: [match] },
        forms: {},
        ui,
        playerName: (id) => `p${id}`,
        requestAddShuttle: () => {},
        confirmAddShuttle: () => {},
        latestShuttleNumber: () => 6,
        requestReturnShuttle: () => {},
        confirmReturnShuttle: confirmReturn,
        requestFinishMatch: () => {},
        confirmFinishMatch: () => {},
        requestCancelMatch: () => {},
        confirmCancelMatch: () => {}
      }
    })

    expect(wrapper.text()).toContain('เพิ่มลูก')
    expect(wrapper.text()).toContain('คืนลูก')
    expect(wrapper.text()).toContain('คืนลูกหมายเลข 6')
    await wrapper.findAll('button').find((item) => item.text().includes('ยืนยันคืนลูก')).trigger('click')
    expect(confirmReturn).toHaveBeenCalledOnce()
  })

  it('shows draw result and score in history', () => {
    const wrapper = mount(HistoryPage, {
      props: {
        state: {
          history: [
            { id: 1, court: '1', a1: 1, a2: 2, b1: 3, b2: 4, shuttles: 1, winner: 'draw' }
          ]
        },
        playerName: (id) => `p${id}`,
        updateHistoryWinner: () => {}
      }
    })

    expect(wrapper.text()).toContain('เสมอ')
    expect(wrapper.text()).toContain('ทีม A +0.5')
    expect(wrapper.text()).toContain('ทีม B +0.5')
  })

  it('renders cancelled history and result edit controls', async () => {
    let nextWinner = ''
    const wrapper = mount(HistoryPage, {
      props: {
        state: {
          history: [
            { id: 13, court: '1', a1: 1, a2: 2, b1: 3, b2: 4, shuttles: 1, winner: 'A', status: 'finished' },
            { id: 14, court: '-', a1: 5, a2: 6, b1: 7, b2: 8, shuttles: 0, winner: '', status: 'cancelled', note: 'ยกเลิกคิว' }
          ]
        },
        playerName: (id) => `p${id}`,
        updateHistoryWinner: (_match, winner) => {
          nextWinner = winner
        }
      }
    })

    const selects = wrapper.findAll('select[aria-label="เปลี่ยนผลการแข่งขัน"]')
    await selects[0].setValue('B')

    expect(nextWinner).toBe('B')
    expect(selects[1].element.disabled).toBe(true)
    expect(wrapper.text()).toContain('ยกเลิก')
  })

  it('shows returned shuttle status in cancelled history', () => {
    const wrapper = mount(HistoryPage, {
      props: {
        state: {
          history: [
            { id: 2, court: '1', a1: 1, a2: 2, b1: 3, b2: 4, shuttles: 1, shuttleSequence: '2', status: 'cancelled', shuttleReturned: true }
          ]
        },
        playerName: (id) => `p${id}`,
        updateHistoryWinner: () => {}
      }
    })

    expect(wrapper.text()).toContain('คืนลูกแล้ว')
    expect(wrapper.text()).toContain('2')
  })

  it('shows score and draw stats in shared players view', () => {
    const wrapper = mount(SharedPlayersPage, {
      props: {
        state: {
          session: { name: 'Test Session' },
          players: [
            { id: 1, name: 'p1', games: 2, wins: 1, draws: 1, losses: 0, shuttles: 2, paid: false, active: true }
          ]
        },
        share: { loading: false, error: '', showPayment: false },
        money: (value) => `${value}`,
        playerCost: () => 0
      }
    })

    expect(wrapper.text()).toContain('แต้ม')
    expect(wrapper.text()).toContain('1.5')
    expect(wrapper.text()).toContain('เสมอ 1')
  })

  it('renders reset readiness setting', () => {
    const wrapper = mount(SettingsPage, {
      props: {
        state: {
          session: { name: 'สนามเดิม', type: 'liveMatch' },
          settings: {
            entryFee: 120,
            shuttleFee: 85,
            allowCrossLevel: true,
            resetPlayersAfterFinish: true,
            startMatchWithShuttle: true,
            announcementTemplate: 'บุฟเฟ่ต์สนามที่ {court}\n{pause}\nคุณ{a} คุณ{b} คุณ{c} คุณ{d}',
            randomPriority: 'level',
            courtNames: ['court 1'],
            levels: ['light']
          }
        },
        forms: { newCourtName: '', newLevelName: '' },
        addCourt: () => {},
        removeCourt: () => {},
        addLevel: () => {},
        removeLevel: () => {},
        usedCourtNames: new Set(),
        usedLevels: new Set(),
        saveSettings: () => {}
      }
    })

    expect(wrapper.text()).toContain('จบเกมแล้วตั้งผู้เล่นเป็นยังไม่พร้อม')
    expect(wrapper.text()).toContain('เริ่มเกมแล้วนับลูกแบด 1 ลูกอัตโนมัติ')
    expect(wrapper.text()).toContain('คำอ่านตอนเรียกคิว')
    expect(wrapper.get('textarea').element.value).toContain('{court}')
    expect(wrapper.get('textarea').element.value).toContain('{pause}')
    expect(wrapper.findAll('input[type="checkbox"]').at(1).element.checked).toBe(true)
    expect(wrapper.findAll('input[type="checkbox"]').at(2).element.checked).toBe(true)
    expect(wrapper.get('input[placeholder="ชื่อสนามหรือชื่อกิจกรรม"]').element.value).toBe('สนามเดิม')
  })
  it('renders readable member share labels', () => {
    const wrapper = mount(PlayersPage, {
      props: {
        state: {
          settings: { showPaymentOnShare: true },
          players: []
        },
        forms: {
          newPlayerName: '',
          playerSearch: '',
          playerPage: 1,
          playerPageSize: 8,
          selectedPlayerId: null,
          shareLink: '',
          shareStatus: ''
        },
        money: (value) => value,
        playerCost: () => 0,
        playerDeleteBlockReasons: () => [],
        addPlayer: () => {},
        renamePlayer: () => {},
        deletePlayer: () => {},
        sharePlayers: () => {},
        openPlayersQr: () => {},
        saveSettings: () => {},
        togglePayment: () => {}
      }
    })

    expect(wrapper.text()).toContain('คัดลอกลิงก์สมาชิก')
    expect(wrapper.text()).toContain('QR ลิงก์สมาชิก')
    expect(wrapper.text()).not.toContain('????')
  })

  it('renders member rename and delete controls', async () => {
    let renamed = ''
    let deleted = null
    const player = { id: 1, name: 'p1', games: 0, wins: 0, draws: 0, losses: 0, shuttles: 0, paid: false, active: true }
    const wrapper = mount(PlayersPage, {
      props: {
        state: {
          settings: { showPaymentOnShare: true },
          players: [player]
        },
        forms: {
          newPlayerName: '',
          playerSearch: '',
          playerPage: 1,
          playerPageSize: 8,
          selectedPlayerId: null,
          shareLink: '',
          shareStatus: ''
        },
        money: (value) => value,
        playerCost: () => 0,
        playerDeleteBlockReasons: () => [],
        addPlayer: () => {},
        renamePlayer: (_player, name) => {
          renamed = name
        },
        deletePlayer: (_player) => {
          deleted = _player
        },
        sharePlayers: () => {},
        openPlayersQr: () => {},
        saveSettings: () => {},
        togglePayment: () => {}
      }
    })

    await wrapper.get('button[aria-label="แก้ไขสมาชิก"]').trigger('click')
    expect(wrapper.text()).toContain('แก้ไข')

    const nameInput = wrapper.get('div[role="dialog"] input[aria-label="แก้ชื่อสมาชิก"]')
    await nameInput.setValue('p1 edited')
    await wrapper.findAll('div[role="dialog"] button').at(1).trigger('click')

    expect(renamed).toBe('p1 edited')

    await wrapper.get('button[aria-label="แก้ไขสมาชิก"]').trigger('click')
    await wrapper.findAll('div[role="dialog"] button').at(2).trigger('click')
    expect(deleted?.id).toBe(player.id)
  })

  it('disables member delete when the player has references', async () => {
    const player = { id: 1, name: 'p1', games: 0, wins: 0, draws: 0, losses: 0, shuttles: 0, paid: false, active: true }
    const wrapper = mount(PlayersPage, {
      props: {
        state: {
          settings: { showPaymentOnShare: true },
          players: [player]
        },
        forms: {
          newPlayerName: '',
          playerSearch: '',
          playerPage: 1,
          playerPageSize: 8,
          selectedPlayerId: null,
          shareLink: '',
          shareStatus: ''
        },
        money: (value) => value,
        playerCost: () => 0,
        playerDeleteBlockReasons: () => ['มีคู่จับ'],
        addPlayer: () => {},
        renamePlayer: () => {},
        deletePlayer: () => {
          throw new Error('should not delete')
        },
        sharePlayers: () => {},
        openPlayersQr: () => {},
        saveSettings: () => {},
        togglePayment: () => {}
      }
    })

    await wrapper.get('button[aria-label="แก้ไขสมาชิก"]').trigger('click')
    const deleteButton = wrapper.findAll('div[role="dialog"] button').at(2)

    expect(deleteButton.element.disabled).toBe(true)
    expect(wrapper.text()).toContain('ลบไม่ได้')
    expect(wrapper.text()).toContain('มีคู่จับ')
  })

  it('keeps pairing drafts separate from queue controls', () => {
    const wrapper = mount(LiveMatchPage, {
      props: {
        state: {
          pending: [
            { id: -1, level: 'middle', a1: 1, a2: 2, b1: 3, b2: 4 }
          ]
        },
        ui: {},
        matchLevelLabel: () => 'กลาง',
        randomMatch: () => {},
        confirmPendingMatch: () => {},
        cancelPendingMatch: () => {},
        playerName: (id) => `p${id}`
      }
    })

    expect(wrapper.text()).toContain('ยืนยัน')
    expect(wrapper.text()).toContain('ยกเลิกจับคู่')
    expect(wrapper.text()).not.toContain('เกมที่')
    expect(wrapper.text()).not.toContain('เริ่ม')
    expect(wrapper.find('select').exists()).toBe(false)
  })

  it('renders queue controls for confirmed games', async () => {
    let cancelled = null
    const wrapper = mount(QueuePage, {
      props: {
        state: {
          queue: [
            { id: 9, level: 'middle', court: '-', a1: 1, a2: 2, b1: 3, b2: 4 }
          ]
        },
        forms: { matchCourts: { 9: '' } },
        matchLevelLabel: () => 'กลาง',
        copyQueueLink: () => {},
        openQueueQr: () => {},
        startMatch: () => {},
        cancelQueuedMatch: (match) => {
          cancelled = match
        },
        playerName: (id) => `p${id}`,
        availableCourtNames: ['สนาม 1', 'สนาม 2']
      }
    })

    expect(wrapper.text()).toContain('เกมที่ 9')
    expect(wrapper.text()).toContain('QR แสดงคิว')
    expect(wrapper.text()).toContain('เริ่ม')
    expect(wrapper.text()).not.toContain('คัดลอกคิว')
    expect(wrapper.find('[aria-label="ยกเลิกการจับคู่"]').exists()).toBe(false)
    expect(wrapper.find('select').exists()).toBe(true)
    await wrapper.get('button[title="ยกเลิกคิวเกม"]').trigger('click')
    expect(cancelled?.id).toBe(9)
  })

  it('announces a queued match after selecting a court', async () => {
    const announce = vi.fn()
    const wrapper = mount(QueuePage, {
      props: {
        state: { queue: [{ id: 9, level: 'middle', a1: 1, a2: 2, b1: 3, b2: 4 }] },
        forms: { matchCourts: { 9: '' } },
        matchLevelLabel: () => 'กลาง',
        openQueueQr: () => {},
        startMatch: () => {},
        announceQueuedMatch: announce,
        cancelQueuedMatch: () => {},
        playerName: (id) => `p${id}`,
        availableCourtNames: ['สนาม 1']
      }
    })

    expect(wrapper.text()).not.toContain('อ่านออกเสียง')
    await wrapper.get('select').setValue('สนาม 1')
    const button = wrapper.findAll('button').find((item) => item.text().includes('อ่านออกเสียง'))
    await button.trigger('click')
    expect(announce).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }), 'สนาม 1')
  })

  it('shows dashboard game total after cancelled games are excluded', () => {
    const wrapper = mount(DashboardPage, {
      props: {
        state: {
          session: { name: 'Test Session' },
          queue: [{ id: 15 }],
          live: [{ id: 16 }],
          history: [
            { id: 13, status: 'finished' },
            { id: 14, status: 'cancelled' }
          ],
          settings: { courtNames: ['court 1', 'court 2'] }
        },
        activePlayerCount: 4,
        totalRecordedMatches: 2,
        cancelledMatches: [{ id: 14, status: 'cancelled' }],
        averageGames: 1,
        minGames: 0,
        maxGames: 2,
        totalShuttles: 2,
        paymentPercent: 50,
        money: (value) => `${value}`,
        totalRevenue: 400,
        paidRevenue: 200,
        unpaidRevenue: 200,
        unpaidPlayers: [{ id: 1 }],
        topPlayers: [],
        quietPlayers: [],
        topWinners: [],
        playerCost: () => 0,
        playerScore: () => 0,
        levelLabel: (level) => level
      }
    })

    expect(wrapper.text()).toContain('2')
    expect(wrapper.text()).toContain('ยกเลิก 1')
    expect(wrapper.get('[data-testid="export-dashboard"]').text()).toContain('Export Excel')
  })

  it('shows Excel export actions on members and history even when read-only', () => {
    const memberWrapper = mount(PlayersPage, {
      props: {
        state: {
          session: { type: 'liveShare' },
          settings: { showPaymentOnShare: true },
          players: []
        },
        forms: {
          newPlayerName: '',
          playerSearch: '',
          playerPage: 1,
          playerPageSize: 8,
          selectedPlayerId: null,
          shareLink: '',
          shareStatus: ''
        },
        money: (value) => value,
        playerCost: () => 0,
        playerLiveShareHours: () => 0,
        levelLabel: (level) => level,
        playerDeleteBlockReasons: () => [],
        addPlayer: () => {},
        renamePlayer: () => {},
        deletePlayer: () => {},
        sharePlayers: () => {},
        openPlayersQr: () => {},
        saveSettings: () => {},
        togglePayment: () => {},
        isSessionReadOnly: true
      }
    })
    const historyWrapper = mount(HistoryPage, {
      props: {
        state: {
          session: { type: 'liveShare' },
          history: []
        },
        playerName: (id) => `p${id}`,
        matchLevelLabel: (level) => level,
        updateHistoryWinner: () => {},
        isSessionReadOnly: true
      }
    })

    expect(memberWrapper.get('[data-testid="export-members"]').element.disabled).toBe(false)
    expect(historyWrapper.get('[data-testid="export-history"]').element.disabled).toBe(false)
  })

  it('refreshes shared views every 30 seconds', async () => {
    vi.useFakeTimers()
    const originalUrl = window.location.href
    window.history.pushState({}, '', '/?view=queue&session=test-session')
    const statePayload = {
      tab: 'home',
      theme: 'light',
      session: { id: 'test-session', name: 'Test Session', adminPasscode: '', unlocked: false },
      settings: {
        entryFee: 0,
        shuttleFee: 0,
        courtCount: 1,
        courtNames: ['สนาม 1'],
        levels: ['light', 'middle', 'heavy'],
        allowCrossLevel: true,
        crossLevelRange: 1,
        randomPriority: 'level',
        showPaymentOnShare: true,
        resetPlayersAfterFinish: true,
        startMatchWithShuttle: true
      },
      players: [],
      couples: [],
      pending: [],
      queue: [],
      live: [],
      history: [],
      nextIds: { player: 0, match: 0, couple: 0, pending: 0 }
    }
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(statePayload)
    }))
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock

    const wrapper = mount(App)
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(30000)
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(30000)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    globalThis.fetch = originalFetch
    window.history.pushState({}, '', originalUrl)
    vi.useRealTimers()
  })

  it('shows live shared queue status and elapsed play time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-17T10:17:00+07:00'))
    const wrapper = mount(SharedQueuePage, {
      props: {
        state: {
          session: { name: 'Test Session' },
          settings: { courtNames: ['สนาม 1'] },
          queue: [],
          live: [
            { id: 3, court: 'สนาม 1', level: 'middle', a1: 1, a2: 2, b1: 3, b2: 4, shuttles: 1, startedAt: '10:00' }
          ]
        },
        share: { loading: false, error: '' },
        playerName: (id) => `p${id}`,
        matchLevelLabel: () => 'กลาง'
      }
    })

    expect(wrapper.text()).toContain('กำลังแข่ง')
    expect(wrapper.text()).toContain('ตีมาแล้ว 17 นาที')
    expect(wrapper.text()).toContain('เริ่ม 10:00')
    wrapper.unmount()
    vi.useRealTimers()
  })
})
