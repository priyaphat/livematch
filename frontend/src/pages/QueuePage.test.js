import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import QueuePage from './QueuePage.vue'

const baseProps = (availability) => ({
  state: {
    settings: { shuttleBrands: [{ id: 'victor', name: 'Victor No.1', priceSatang: 10000, active: true }] },
    shuttleStockAvailability: [availability],
    queue: [{ id: 7, a1: 1, a2: 2, b1: 3, b2: 4, level: 'กลาง' }],
    players: [1, 2, 3, 4].map((id) => ({ id, name: `ผู้เล่น ${id}` })),
  },
  forms: { matchCourts: { 7: 'สนาม 1' }, matchShuttleBrands: {} },
  matchLevelLabel: () => 'กลาง',
  openQueueQr: vi.fn(),
  startMatch: vi.fn(),
  announceQueuedMatch: vi.fn(),
  cancelQueuedMatch: vi.fn(),
  playerName: (id) => `ผู้เล่น ${id}`,
  availableCourtNames: ['สนาม 1'],
  activeShuttleBrands: () => [{ id: 'victor', name: 'Victor No.1', priceSatang: 10000, active: true }],
  saveSettings: vi.fn(),
  isSessionReadOnly: false,
})

describe('QueuePage shuttle stock', () => {
  it('shows remaining stock and starts a single available brand directly', async () => {
    const props = baseProps({ brandId: 'victor', linked: true, availableQuantity: 3, selectable: true })
    const wrapper = mount(QueuePage, { props })
    const start = wrapper.findAll('button').find((button) => button.text().trim() === 'เริ่ม')
    await start.trigger('click')
    expect(props.startMatch).toHaveBeenCalledWith(props.state.queue[0], 'สนาม 1')
  })

  it('opens the selector and disables a linked brand when stock is empty', async () => {
    const props = baseProps({ brandId: 'victor', linked: true, availableQuantity: 0, selectable: false, code: 'POS_SHUTTLE_OUT_OF_STOCK' })
    const wrapper = mount(QueuePage, { props })
    const start = wrapper.findAll('button').find((button) => button.text().includes('เริ่ม'))
    await start.trigger('click')
    expect(wrapper.text()).toContain('สินค้าหมด')
    const brandButton = wrapper.findAll('button').find((button) => button.text().includes('Victor No.1'))
    expect(brandButton.attributes('disabled')).toBeDefined()
    expect(props.startMatch).not.toHaveBeenCalled()
  })
})
