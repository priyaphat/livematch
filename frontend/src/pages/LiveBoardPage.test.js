import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import LiveBoardPage from './LiveBoardPage.vue'

function pageProps(availability) {
  const brand = { id: 'victor', name: 'Victor No.1', priceSatang: 10000, active: true, posProductId: availability?.linked ? 'product-1' : '' }
  return {
    state: {
      settings: { shuttleBrands: [brand] },
      shuttleStockAvailability: availability ? [availability] : [],
      live: [{ id: 12, court: 'สนาม 1', status: 'กำลังเล่น', a1: 1, a2: 2, b1: 3, b2: 4, shuttles: 1, shuttleSequenceItems: [{ brandId: 'victor', number: 1 }] }],
    },
    forms: { addShuttleBrandId: 'victor', finishScores: [] },
    ui: { showShuttleModal: true, shuttleMatch: { id: 12 } },
    playerName: (id) => `ผู้เล่น ${id}`,
    requestAddShuttle: vi.fn(),
    confirmAddShuttle: vi.fn(),
    latestShuttleNumber: () => 1,
    latestShuttleBrandId: () => 'victor',
    activeShuttleBrands: () => [brand],
    shuttleBrandName: () => brand.name,
    matchShuttleSummary: () => '',
    matchShuttleSequenceText: () => 'Victor No.1 #1',
    requestReturnShuttle: vi.fn(),
    confirmReturnShuttle: vi.fn(),
    requestFinishMatch: vi.fn(),
    confirmFinishMatch: vi.fn(),
    requestCancelMatch: vi.fn(),
    confirmCancelMatch: vi.fn(),
    isSessionReadOnly: false,
  }
}

describe('LiveBoardPage shuttle stock', () => {
  it('shows current POS stock and allows adding when stock remains', async () => {
    const props = pageProps({ brandId: 'victor', linked: true, availableQuantity: 2, selectable: true })
    const wrapper = mount(LiveBoardPage, { props })
    expect(wrapper.text()).toContain('คงเหลือ 2 ลูก')
    const confirm = wrapper.findAll('button').find((button) => button.text().trim() === 'เพิ่มลูกแบด')
    expect(confirm.attributes('disabled')).toBeUndefined()
    await confirm.trigger('click')
    expect(props.confirmAddShuttle).toHaveBeenCalledOnce()
  })

  it('blocks adding a linked POS shuttle when stock is empty', async () => {
    const props = pageProps({ brandId: 'victor', linked: true, availableQuantity: 0, selectable: false, code: 'POS_SHUTTLE_OUT_OF_STOCK' })
    const wrapper = mount(LiveBoardPage, { props })
    expect(wrapper.text()).toContain('สินค้าหมด')
    const confirm = wrapper.findAll('button').find((button) => button.text().trim() === 'เพิ่มลูกแบด')
    expect(confirm.attributes('disabled')).toBeDefined()
    await confirm.trigger('click')
    expect(props.confirmAddShuttle).not.toHaveBeenCalled()
  })

  it('keeps Match-only shuttle brands usable without POS stock', () => {
    const props = pageProps({ brandId: 'victor', linked: false, selectable: true })
    const wrapper = mount(LiveBoardPage, { props })
    expect(wrapper.text()).toContain('ไม่เชื่อมสต็อก POS')
    const confirm = wrapper.findAll('button').find((button) => button.text().trim() === 'เพิ่มลูกแบด')
    expect(confirm.attributes('disabled')).toBeUndefined()
  })
})
