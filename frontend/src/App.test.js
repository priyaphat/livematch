import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import App from './App.vue'
import MatchSetupModal from './components/MatchSetupModal.vue'
import LiveBoardPage from './pages/LiveBoardPage.vue'
import SettingsPage from './pages/SettingsPage.vue'

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
})
