import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import MatchSetupModal from './components/MatchSetupModal.vue'
import HistoryPage from './pages/HistoryPage.vue'
import LiveBoardPage from './pages/LiveBoardPage.vue'
import LiveMatchPage from './pages/LiveMatchPage.vue'
import PlayersPage from './pages/PlayersPage.vue'
import QueuePage from './pages/QueuePage.vue'
import SettingsPage from './pages/SettingsPage.vue'
import SharedPlayersPage from './pages/SharedPlayersPage.vue'
import SharedQueuePage from './pages/SharedQueuePage.vue'
import { applyStoredTheme } from './theme'

describe('LiveMatch app', () => {
  it('hides admin screens before passcode access', () => {
    const wrapper = mount(App)

    expect(wrapper.text()).toContain('LiveMatch')
    expect(wrapper.text()).toContain('เข้าสู่ระบบผู้ดูแล')
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
        resetPlayersAfterFinish: true
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

  it('shows draw result and score in history', () => {
    const wrapper = mount(HistoryPage, {
      props: {
        state: {
          history: [
            { id: 1, court: '1', a1: 1, a2: 2, b1: 3, b2: 4, shuttles: 1, winner: 'draw' }
          ]
        },
        playerName: (id) => `p${id}`
      }
    })

    expect(wrapper.text()).toContain('เสมอ')
    expect(wrapper.text()).toContain('ทีม A +0.5')
    expect(wrapper.text()).toContain('ทีม B +0.5')
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
          settings: {
            entryFee: 120,
            shuttleFee: 85,
            allowCrossLevel: true,
            resetPlayersAfterFinish: true,
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
    expect(wrapper.findAll('input[type="checkbox"]').at(1).element.checked).toBe(true)
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
        addPlayer: () => {},
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

  it('renders queue controls for confirmed games', () => {
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
        cancelQueuedMatch: () => {},
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
        resetPlayersAfterFinish: true
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
