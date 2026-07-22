import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PlayersPage from './PlayersPage.vue'

function mountPlayers(apiRequest) {
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
      state: { players: [], settings: { showPaymentOnShare: true, showTotalOnShare: true }, session: { type: 'liveMatch' } },
      forms,
      money: (value) => String(value),
      playerCost: () => 0,
      playerLiveShareHours: () => 0,
      levelLabel: (value) => value,
      playerDeleteBlockReasons: () => [],
      addPlayer: vi.fn(),
      renamePlayer: vi.fn(),
      deletePlayer: vi.fn(),
      sharePlayers: vi.fn(),
      openPlayersQr: vi.fn(),
      saveSettings: vi.fn(),
      togglePayment: vi.fn(),
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
    const input = wrapper.find('input[aria-label="ค้นหาสมาชิกด้วยเบอร์โทร"]')

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

    const option = wrapper.find('[role="option"]')
    await option.trigger('click')
    expect(forms.newPlayerMemberId).toBe('member-1')
    expect(forms.newPlayerPhone).toBe('0882250419')
    expect(forms.newPlayerName).toBe('สมาชิกทดสอบ')
  })
})
