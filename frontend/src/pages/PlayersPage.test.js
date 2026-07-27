import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PlayersPage from './PlayersPage.vue'

function mountPlayers(apiRequest, overrides = {}) {
  const forms = {
    playerSearch: '',
    playerPaymentFilter: 'all',
    playerPage: 1,
    playerPageSize: 20,
    newPlayerPhone: '',
    newPlayerName: '',
    newPlayerMemberId: '',
    shareLink: '',
    shareStatus: ''
  }
  const wrapper = mount(PlayersPage, {
    props: {
      state: overrides.state || { players: [], settings: { showPaymentOnShare: true, showTotalOnShare: true }, session: { type: 'liveMatch' } },
      forms,
      money: (value) => String(value),
      playerCost: overrides.playerCost || (() => 0),
      playerLiveShareHours: () => 0,
      levelLabel: (value) => value,
      playerDeleteBlockReasons: () => [],
      addPlayer: overrides.addPlayer || vi.fn(),
      renamePlayer: vi.fn(),
      deletePlayer: vi.fn(),
      sharePlayers: vi.fn(),
      openPlayersQr: vi.fn(),
      saveSettings: vi.fn(),
      togglePayment: overrides.togglePayment || vi.fn(),
      isSessionReadOnly: false,
      apiRequest
    }
  })
  return { wrapper, forms }
}

afterEach(() => vi.useRealTimers())

describe('PlayersPage member combobox', () => {
  it('searches only after more than five phone digits and selects a member', async () => {
    vi.useFakeTimers()
    const member = { id: 'member-1', phone: '0882250419', name: 'สมาชิกทดสอบ' }
    const apiRequest = vi.fn().mockResolvedValue({ items: [member] })
    const { wrapper, forms } = mountPlayers(apiRequest)
    const input = wrapper.find('input[aria-label="ชื่อขาจรหรือค้นหาสมาชิกด้วยชื่อหรือเบอร์โทร"]')

    expect(wrapper.find('[data-testid="member-combobox-row"]').findAll('input')).toHaveLength(1)

    await input.setValue('08822')
    await vi.advanceTimersByTimeAsync(400)
    expect(apiRequest).not.toHaveBeenCalled()

    await input.setValue('088225')
    await vi.advanceTimersByTimeAsync(300)
    await Promise.resolve()
    expect(apiRequest).toHaveBeenCalledWith('/api/admin/members/search?phone=088225')
    expect(wrapper.text()).toContain('0882250419')
    expect(wrapper.text()).toContain('สมาชิกทดสอบ')

    await wrapper.find('[role="option"]').trigger('click')
    expect(forms.newPlayerMemberId).toBe('member-1')
    expect(forms.newPlayerPhone).toBe('0882250419')
    expect(forms.newPlayerName).toBe('สมาชิกทดสอบ')
  })

  it('searches by a two-character name and requires selecting the result to link the member', async () => {
    vi.useFakeTimers()
    const addPlayer = vi.fn()
    const member = { id: 'member-name', phone: '0864407370', name: 'ปรียาภัฒน์' }
    const apiRequest = vi.fn().mockResolvedValue({ items: [member] })
    const { wrapper, forms } = mountPlayers(apiRequest, { addPlayer })
    const input = wrapper.find('input[aria-label="ชื่อขาจรหรือค้นหาสมาชิกด้วยชื่อหรือเบอร์โทร"]')

    await input.setValue('ป')
    await vi.advanceTimersByTimeAsync(400)
    expect(apiRequest).not.toHaveBeenCalled()

    await input.setValue('ปรี')
    await vi.advanceTimersByTimeAsync(300)
    await Promise.resolve()
    expect(apiRequest).toHaveBeenCalledWith('/api/admin/members/search?q=%E0%B8%9B%E0%B8%A3%E0%B8%B5')
    expect(wrapper.find('[role="option"]').text()).toContain('ปรียาภัฒน์')
    expect(wrapper.find('[role="option"]').text()).toContain('0864407370')

    await wrapper.find('[role="option"]').trigger('click')
    await wrapper.find('[data-testid="member-combobox-row"] > button').trigger('click')
    expect(forms.newPlayerMemberId).toBe('member-name')
    expect(forms.newPlayerName).toBe('ปรียาภัฒน์')
    expect(addPlayer).toHaveBeenCalledOnce()
  })

  it('adds a typed matching name as a session-only guest when no result was selected', async () => {
    vi.useFakeTimers()
    const addPlayer = vi.fn()
    const apiRequest = vi.fn().mockResolvedValue({ items: [{ id: 'member-1', phone: '0811111111', name: 'สมชาย' }] })
    const { wrapper, forms } = mountPlayers(apiRequest, { addPlayer })
    const input = wrapper.find('input[aria-label="ชื่อขาจรหรือค้นหาสมาชิกด้วยชื่อหรือเบอร์โทร"]')

    await input.setValue('สมชาย')
    await vi.advanceTimersByTimeAsync(300)
    await wrapper.find('[data-testid="member-combobox-row"] > button').trigger('click')

    expect(forms.newPlayerName).toBe('สมชาย')
    expect(forms.newPlayerMemberId).toBe('')
    expect(addPlayer).toHaveBeenCalledOnce()
  })

  it('clears a selected member when the entry text changes', async () => {
    vi.useFakeTimers()
    const member = { id: 'member-1', phone: '0882250419', name: 'สมาชิกทดสอบ' }
    const { wrapper, forms } = mountPlayers(vi.fn().mockResolvedValue({ items: [member] }))
    const input = wrapper.find('input[aria-label="ชื่อขาจรหรือค้นหาสมาชิกด้วยชื่อหรือเบอร์โทร"]')

    await input.setValue('สมาชิก')
    await vi.advanceTimersByTimeAsync(300)
    await wrapper.find('[role="option"]').trigger('click')
    expect(forms.newPlayerMemberId).toBe('member-1')

    await input.setValue('ชื่อใหม่')
    expect(forms.newPlayerMemberId).toBe('')
  })

  it('ignores a stale member-search response', async () => {
    vi.useFakeTimers()
    let resolveFirst
    let resolveSecond
    const apiRequest = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))
    const { wrapper } = mountPlayers(apiRequest)
    const input = wrapper.find('input[aria-label="ชื่อขาจรหรือค้นหาสมาชิกด้วยชื่อหรือเบอร์โทร"]')

    await input.setValue('สม')
    await vi.advanceTimersByTimeAsync(300)
    await input.setValue('สมศรี')
    await vi.advanceTimersByTimeAsync(300)
    resolveSecond({ items: [{ id: 'new', name: 'สมศรี', phone: '0822222222' }] })
    await Promise.resolve()
    resolveFirst({ items: [{ id: 'old', name: 'สมชาย', phone: '0811111111' }] })
    await Promise.resolve()

    expect(wrapper.text()).toContain('สมศรี')
    expect(wrapper.text()).not.toContain('สมชาย')
  })

  it('does not add an unmatched phone number as a guest name', async () => {
    vi.useFakeTimers()
    const addPlayer = vi.fn()
    const { wrapper } = mountPlayers(vi.fn().mockResolvedValue({ items: [] }), { addPlayer })
    const input = wrapper.find('input[aria-label="ชื่อขาจรหรือค้นหาสมาชิกด้วยชื่อหรือเบอร์โทร"]')

    await input.setValue('0882250419')
    await vi.advanceTimersByTimeAsync(300)

    expect(wrapper.find('[data-testid="member-combobox-row"] > button').attributes('disabled')).toBeDefined()
    expect(addPlayer).not.toHaveBeenCalled()
  })
})

describe('PlayersPage player sorting', () => {
  const players = [
    { id: 1, name: 'Beta', games: 2, shuttles: 3, paid: false, active: true },
    { id: 2, name: 'Alpha', games: 1, shuttles: 4, paid: false, active: true },
    { id: 3, name: 'Charlie', games: 3, shuttles: 1, paid: false, active: true },
  ]
  const costs = { 1: 300, 2: 100, 3: 200 }

  function rowNames(wrapper) {
    return wrapper.findAll('[data-testid="player-row"]').map((row) => row.find('span.truncate').text())
  }

  it.each([
    ['เรียงตามชื่อ', ['Alpha', 'Beta', 'Charlie']],
    ['เรียงตามจำนวนเกม', ['Alpha', 'Beta', 'Charlie']],
    ['เรียงตามจำนวนลูก', ['Charlie', 'Beta', 'Alpha']],
    ['เรียงตามค่าใช้จ่าย', ['Alpha', 'Charlie', 'Beta']],
  ])('sorts descending and ascending with the %s header', async (label, ascending) => {
    const { wrapper, forms } = mountPlayers(vi.fn(), {
      state: { players, settings: { showPaymentOnShare: true, showTotalOnShare: true }, session: { type: 'liveMatch' } },
      playerCost: (player) => costs[player.id],
    })
    forms.playerPage = 2
    const header = wrapper.find(`button[aria-label="${label}"]`)

    await header.trigger('click')
    expect(forms.playerPage).toBe(1)
    expect(rowNames(wrapper)).toEqual([...ascending].reverse())
    expect(header.element.parentElement.getAttribute('aria-sort')).toBe('descending')

    await header.trigger('click')
    expect(rowNames(wrapper)).toEqual(ascending)
    expect(header.element.parentElement.getAttribute('aria-sort')).toBe('ascending')
  })

  it('switches from shuttle sorting to cost sorting immediately', async () => {
    const { wrapper, forms } = mountPlayers(vi.fn(), {
      state: { players, settings: { showPaymentOnShare: true, showTotalOnShare: true }, session: { type: 'liveMatch' } },
      playerCost: (player) => costs[player.id],
    })
    forms.playerPage = 2
    const shuttleHeader = wrapper.find('button[aria-label="เรียงตามจำนวนลูก"]')
    const costHeader = wrapper.find('button[aria-label="เรียงตามค่าใช้จ่าย"]')

    await shuttleHeader.trigger('click')
    expect(rowNames(wrapper)).toEqual(['Alpha', 'Beta', 'Charlie'])
    expect(shuttleHeader.element.parentElement.getAttribute('aria-sort')).toBe('descending')

    await costHeader.trigger('click')
    expect(forms.playerPage).toBe(1)
    expect(rowNames(wrapper)).toEqual(['Beta', 'Charlie', 'Alpha'])
    expect(shuttleHeader.element.parentElement.getAttribute('aria-sort')).toBe('none')
    expect(costHeader.element.parentElement.getAttribute('aria-sort')).toBe('descending')
  })
})

describe('PlayersPage payment modal', () => {
  const player = { id: 7, name: 'Member', games: 1, shuttles: 2, paid: false, active: true }
  const state = { players: [player], settings: { showPaymentOnShare: true, showTotalOnShare: true }, session: { id: 'session-1', type: 'liveMatch' } }

  it('loads a fresh itemized summary before confirming payment', async () => {
    const summary = {
      playerId: 7,
      playerName: 'Member',
      paid: false,
      items: [
        { key: 'entry', label: 'ค่าเข้าสนาม', quantity: 1, unitAmountThb: 100, amountThb: 100 },
        { key: 'shuttle-rsl', label: 'ค่าลูกแบด RSL', quantity: 2, unitAmountThb: 85, amountThb: 170 },
      ],
      totalThb: 270,
    }
    const apiRequest = vi.fn().mockResolvedValue(summary)
    const togglePayment = vi.fn().mockResolvedValue()
    const { wrapper } = mountPlayers(apiRequest, { state, togglePayment })

    const paymentButton = wrapper.findAll('button').find((button) => button.text() === 'ชำระเงิน')
    await paymentButton.trigger('click')
    await flushPromises()

    expect(apiRequest).toHaveBeenCalledWith('/api/sessions/session-1/players/7/payment-summary')
    expect(wrapper.text()).toContain('ค่าเข้าสนาม')
    expect(wrapper.text()).toContain('ค่าลูกแบด RSL')
    expect(wrapper.text()).toContain('270')

    const confirmButton = wrapper.findAll('button').find((button) => button.text() === 'ชำระ')
    await confirmButton.trigger('click')
    await flushPromises()
    expect(togglePayment).toHaveBeenCalledWith(player)
  })

  it('asks for confirmation before cancelling a payment', async () => {
    const paidPlayer = { ...player, paid: true }
    const apiRequest = vi.fn()
    const togglePayment = vi.fn().mockResolvedValue()
    const { wrapper } = mountPlayers(apiRequest, { state: { ...state, players: [paidPlayer] }, togglePayment })

    const cancelPaymentButton = wrapper.findAll('button').find((button) => button.text() === 'ยกเลิกการชำระ')
    await cancelPaymentButton.trigger('click')
    expect(apiRequest).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('ยกเลิกการชำระเงิน')

    const confirmButton = wrapper.findAll('button').find((button) => button.text() === 'ตกลง')
    await confirmButton.trigger('click')
    await flushPromises()
    expect(togglePayment).toHaveBeenCalledWith(paidPlayer)
  })
})
