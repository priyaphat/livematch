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
      state: overrides.state || { players: [], memberTypes: [{ id: 'type-general', code: 'general', name: 'สมาชิกทั่วไป', active: true }, { id: 'type-club', code: 'club', name: 'สมาชิกชมรม', active: true }], settings: { showPaymentOnShare: true, showTotalOnShare: true }, session: { type: 'liveMatch', allowMatchGuestEntry: true } },
      forms,
      money: (value) => String(value),
      playerCost: overrides.playerCost || (() => 0),
      playerLiveShareHours: () => 0,
      levelLabel: (value) => value,
      playerDeleteBlockReasons: () => [],
      addPlayer: overrides.addPlayer || vi.fn(),
      renamePlayer: overrides.renamePlayer || vi.fn(),
      deletePlayer: overrides.deletePlayer || vi.fn(),
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
  it('searches a phone from the first digit and selects a member', async () => {
    vi.useFakeTimers()
    const member = { id: 'member-1', phone: '0882250419', name: 'สมาชิกทดสอบ' }
    const apiRequest = vi.fn().mockResolvedValue({ items: [member] })
    const { wrapper, forms } = mountPlayers(apiRequest)
    const input = wrapper.find('input[aria-label="ชื่อขาจรหรือค้นหาสมาชิกด้วยชื่อหรือเบอร์โทร"]')

    expect(wrapper.find('[data-testid="member-combobox-row"]').findAll('input')).toHaveLength(1)

    await input.setValue('0')
    await vi.advanceTimersByTimeAsync(700)
    await Promise.resolve()
    expect(apiRequest).toHaveBeenCalledWith('/api/admin/members/search?phone=0')
    expect(wrapper.text()).toContain('0882250419')
    expect(wrapper.text()).toContain('สมาชิกทดสอบ')
    await input.setValue('0882250419')
    await vi.advanceTimersByTimeAsync(700)
    await Promise.resolve()
    expect(wrapper.findAll('button').some((button) => button.text().includes('เพิ่มสมาชิกใหม่'))).toBe(false)

    await wrapper.find('[role="option"]').trigger('click')
    expect(forms.newPlayerMemberId).toBe('member-1')
    expect(forms.newPlayerPhone).toBe('0882250419')
    expect(forms.newPlayerName).toBe('สมาชิกทดสอบ')
  })

  it('searches a name and adds the selected member to the match immediately', async () => {
    vi.useFakeTimers()
    const addPlayer = vi.fn()
    const member = { id: 'member-name', phone: '0864407370', name: 'ปรียาภัฒน์' }
    const apiRequest = vi.fn().mockResolvedValue({ items: [member] })
    const { wrapper, forms } = mountPlayers(apiRequest, { addPlayer })
    const input = wrapper.find('input[aria-label="ชื่อขาจรหรือค้นหาสมาชิกด้วยชื่อหรือเบอร์โทร"]')

    await input.setValue('ป')
    await vi.advanceTimersByTimeAsync(700)
    await Promise.resolve()
    expect(apiRequest).toHaveBeenCalledWith('/api/admin/members/search?q=%E0%B8%9B')
    expect(wrapper.find('[role="option"]').text()).toContain('ปรียาภัฒน์')
    expect(wrapper.find('[role="option"]').text()).toContain('0864407370')
    expect(wrapper.findAll('button').some((button) => button.text().includes('เพิ่มสมาชิกใหม่'))).toBe(true)

    await wrapper.find('[role="option"]').trigger('click')
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
    await vi.advanceTimersByTimeAsync(700)
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
    await vi.advanceTimersByTimeAsync(700)
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
    await vi.advanceTimersByTimeAsync(700)
    await input.setValue('สมศรี')
    await vi.advanceTimersByTimeAsync(700)
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
    await vi.advanceTimersByTimeAsync(700)

    expect(wrapper.find('[data-testid="member-combobox-row"] > button').attributes('disabled')).toBeDefined()
    expect(addPlayer).not.toHaveBeenCalled()
  })

  it('creates a member from an unmatched name only after entering a 10-digit phone', async () => {
    vi.useFakeTimers()
    const addPlayer = vi.fn()
    const created = { id: 'member-new', name: 'สมาชิกใหม่', phone: '0812345678', memberType: 'general', memberTypeId: 'type-general' }
    const apiRequest = vi.fn((url, options = {}) => {
      if (url === '/api/admin/members' && options.method === 'POST') return Promise.resolve(created)
      return Promise.resolve({ items: [] })
    })
    const { wrapper, forms } = mountPlayers(apiRequest, { addPlayer })
    const searchInput = wrapper.find('input[aria-label="ชื่อขาจรหรือค้นหาสมาชิกด้วยชื่อหรือเบอร์โทร"]')

    await searchInput.setValue('สมาชิกใหม่')
    await vi.advanceTimersByTimeAsync(700)
    await Promise.resolve()
    const createButton = wrapper.findAll('button').find((button) => button.text().includes('เพิ่มสมาชิกใหม่'))
    expect(createButton).toBeTruthy()
    await createButton.trigger('click')

    expect(wrapper.find('input[aria-label="ชื่อสมาชิกใหม่"]').element.value).toBe('สมาชิกใหม่')
    expect(wrapper.find('input[aria-label="เบอร์โทรสมาชิกใหม่"]').element.value).toBe('')
    expect(wrapper.text()).toContain('** ชื่อซ้ำจะมีผลตอนเรียกชื่อ')
    expect(wrapper.find('select[aria-label="ประเภทสมาชิก"] + svg').exists()).toBe(true)
    const submit = wrapper.findAll('form button').find((button) => button.text().includes('เพิ่มสมาชิก'))
    await wrapper.find('input[aria-label="เบอร์โทรสมาชิกใหม่"]').setValue('081234567')
    expect(submit.attributes('disabled')).toBeDefined()
    await wrapper.find('input[aria-label="เบอร์โทรสมาชิกใหม่"]').setValue('0812345678')
    expect(submit.attributes('disabled')).toBeUndefined()
    await wrapper.find('form').trigger('submit')

    await vi.waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/admin/members', expect.objectContaining({ method: 'POST' })))
    const createCall = apiRequest.mock.calls.find(([url, options]) => url === '/api/admin/members' && options?.method === 'POST')
    expect(JSON.parse(createCall[1].body)).toEqual({ name: 'สมาชิกใหม่', phone: '0812345678', memberTypeId: 'type-general' })
    expect(forms.newPlayerMemberId).toBe('member-new')
    expect(forms.newPlayerPhone).toBe('0812345678')
    expect(addPlayer).toHaveBeenCalledOnce()
  })

  it('blocks a typed guest when the central guest policy is disabled', async () => {
    vi.useFakeTimers()
    const addPlayer = vi.fn()
    const { wrapper } = mountPlayers(vi.fn().mockResolvedValue({ items: [] }), {
      addPlayer,
      state: {
        players: [],
        memberTypes: [{ id: 'type-general', code: 'general', name: 'สมาชิกทั่วไป', active: true }],
        settings: { showPaymentOnShare: true, showTotalOnShare: true },
        session: { type: 'liveMatch', allowMatchGuestEntry: false },
      },
    })

    await wrapper.find('input[role="combobox"]').setValue('ขาจร')
    await vi.advanceTimersByTimeAsync(700)
    const addButton = wrapper.find('[data-testid="member-combobox-row"] > button')
    expect(addButton.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('ต้องเลือกหรือสร้างสมาชิกก่อน')
    await addButton.trigger('click')
    expect(addPlayer).not.toHaveBeenCalled()
  })

  it('disables a member who is already active in the match', async () => {
    vi.useFakeTimers()
    const member = { id: 'member-existing', phone: '0811111111', name: 'Existing' }
    const addPlayer = vi.fn()
    const { wrapper } = mountPlayers(vi.fn().mockResolvedValue({ items: [member] }), {
      addPlayer,
      state: {
        players: [{ id: 1, name: 'Existing', memberId: member.id, active: true }],
        settings: { showPaymentOnShare: true, showTotalOnShare: true },
        memberTypes: [{ id: 'type-general', code: 'general', name: 'สมาชิกทั่วไป', active: true }],
        session: { type: 'liveMatch', allowMatchGuestEntry: true },
      },
    })

    await wrapper.find('input[role="combobox"]').setValue('Existing')
    await vi.advanceTimersByTimeAsync(700)
    const option = wrapper.find('[role="option"]')
    expect(option.attributes('disabled')).toBeDefined()
    expect(option.text()).toContain('อยู่ใน Match แล้ว')
    await option.trigger('click')
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
    return wrapper.findAll('[data-testid="player-row"]').map((row) => row.find('span.truncate').text().replace(/^#\d+\s*/, ''))
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

describe('PlayersPage linked member protection', () => {
  it('disables name and phone changes and leaves only removal for a linked member', async () => {
    const renamePlayer = vi.fn()
    const deletePlayer = vi.fn().mockResolvedValue()
    const linkedPlayer = { id: 9, name: 'Linked Member', memberId: 'member-9', games: 0, shuttles: 0, paid: false, active: true }
    const { wrapper } = mountPlayers(vi.fn(), {
      state: { players: [linkedPlayer], settings: { showPaymentOnShare: true, showTotalOnShare: true }, session: { type: 'liveMatch' } },
      renamePlayer,
      deletePlayer,
    })

    const removeFromMatchButton = wrapper.get('button[aria-label="ลบสมาชิกออกจาก Match"]')
    expect(removeFromMatchButton.text()).toContain('ลบออก')
    await removeFromMatchButton.trigger('click')

    expect(wrapper.get('input[aria-label="แก้ชื่อสมาชิก"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input[inputmode="tel"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('ชื่อและเบอร์โทรต้องแก้ไขจากระบบสมาชิกเท่านั้น')
    expect(wrapper.findAll('button').some((button) => button.text() === 'บันทึกชื่อ')).toBe(false)

    await wrapper.findAll('button').find((button) => button.text() === 'ลบชื่อ').trigger('click')
    expect(deletePlayer).toHaveBeenCalledWith(linkedPlayer)
    expect(renamePlayer).not.toHaveBeenCalled()
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
        { key: 'shuttle-split', label: 'ค่าลูกแบด (หารตามจำนวนผู้เล่นจริง)', quantity: 1, unitAmountThb: 85, amountThb: 170, details: [
          { key: 'shuttle-detail-yonex', label: 'Yonex', quantity: 1, unitAmountThb: 90 },
          { key: 'shuttle-detail-rsl', label: 'RSL', quantity: 1, unitAmountThb: 85 },
        ] },
      ],
      matchHistory: [{ matchId: 12, court: 'สนาม 1', level: 'middle', result: 'ชนะ', team: 'Member + Partner', opponent: 'Opponent A + Opponent B', startedAt: '18:00', endedAt: '18:35', shuttles: 2, note: 'เกมทดสอบ' }],
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
    expect(wrapper.text()).toContain('ค่าลูกแบด (หารตามจำนวนผู้เล่นจริง)')
    expect(wrapper.get('[data-testid="shuttle-brand-details"]').text()).toContain('Yonex')
    expect(wrapper.get('[data-testid="shuttle-brand-details"]').text()).toContain('RSL')
    expect(wrapper.get('[data-testid="payment-match-history"]').text()).toContain('เกม #12 · สนาม 1')
    expect(wrapper.get('[data-testid="payment-match-history"] [title]').attributes('title')).toContain('ทีม: Member + Partner')
    expect(wrapper.get('[data-testid="payment-match-history"] [title]').attributes('title')).toContain('หมายเหตุ: เกมทดสอบ')
    expect(wrapper.text()).toContain('270')

    const confirmButton = wrapper.findAll('button').find((button) => button.text() === 'ชำระ')
    await confirmButton.trigger('click')
    await flushPromises()
    expect(togglePayment).toHaveBeenCalledWith(player, expect.objectContaining({ totalThb: 270 }), 'cash')
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
    expect(togglePayment).toHaveBeenCalledWith(paidPlayer, null, 'cash')
  })
})
