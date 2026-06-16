import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import App from './App.vue'
import MatchSetupModal from './components/MatchSetupModal.vue'

describe('LiveMatch app', () => {
  it('hides admin screens before passcode access', () => {
    const wrapper = mount(App)

    expect(wrapper.text()).toContain('LiveMatch')
    expect(wrapper.text()).toContain('เข้าสู่ระบบผู้ดูแล')
    expect(wrapper.text()).not.toContain('ผู้เล่นวันนี้')
    expect(wrapper.text()).not.toContain('จัดคู่')
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
})
