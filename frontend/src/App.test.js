import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import MatchSetupModal from './components/MatchSetupModal.vue'
import DashboardPage from './pages/DashboardPage.vue'
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

  it('reloads only the selected admin menu endpoint', async () => {
    localStorage.setItem('livematch.adminSessionId', 'test-session')
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
    const calls = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn((url) => {
      calls.push(String(url))
      if (String(url).includes('/players?all=1')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            items: [{ id: 9, name: 'Fresh Player', games: 0, wins: 0, draws: 0, losses: 0, shuttles: 0, paid: false, active: true }],
            total: 1,
            page: 1,
            pageSize: 1
          })
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(statePayload)
      })
    })

    const wrapper = mount(App)
    for (let index = 0; index < 5; index += 1) await Promise.resolve()
    const desktopNav = wrapper.findAll('nav').at(0)
    await desktopNav.findAll('button').at(1).trigger('click')
    await Promise.resolve()
    await Promise.resolve()

    expect(calls.some((call) => call.includes('/api/sessions/test-session/players?all=1'))).toBe(true)
    expect(calls.filter((call) => call.includes('/api/sessions/test-session/state')).length).toBe(1)
    expect(wrapper.text()).toContain('Fresh Player')

    wrapper.unmount()
    globalThis.fetch = originalFetch
    localStorage.removeItem('livematch.adminSessionId')
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
        playerDeleteBlockReasons: () => ['มีประวัติ'],
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
    expect(wrapper.text()).toContain('มีประวัติ')
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
