import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import AdminSupervisorPage from './AdminSupervisorPage.vue'

function mountDashboard(features) {
  return mount(AdminSupervisorPage, {
    props: {
      auth: {
        user: { name: 'Admin', email: 'admin@example.com', coins: 100 },
        sessions: [],
        features,
        memberCount: 7,
        bookingCount: 12,
        defaultSettings: { dashboardAnnouncements: ['กรุณาเตรียมตัวลงสนาม'] },
        liveMatchSessionCost: 1,
        liveShareSessionCost: 1
      },
      forms: { sessionCreateType: 'liveMatch' },
      ui: { showAdminDefaultSettingsModal: false, showCreateSessionModal: false },
      navigateAdminFeature: vi.fn(),
      openDashboardAnnouncements: vi.fn(),
      createSession: vi.fn(),
      openOwnedSession: vi.fn(),
      refreshAdminSupervisor: vi.fn(),
      saveAdminDefaultSettings: vi.fn(),
      addAdminDefaultShuttleBrand: vi.fn(),
      removeAdminDefaultShuttleBrand: vi.fn(),
      addAdminDefaultCourt: vi.fn(),
      removeAdminDefaultCourt: vi.fn(),
      addAdminDefaultLevel: vi.fn(),
      removeAdminDefaultLevel: vi.fn()
    }
  })
}

describe('AdminSupervisorPage feature cards', () => {
  it('hides member and booking cards when both flags are disabled', () => {
    const wrapper = mountDashboard({ memberEnabled: false, bookingEnabled: false })
    expect(wrapper.text()).not.toContain('ระบบสมาชิก')
    expect(wrapper.text()).not.toContain('ระบบจองสนาม')
  })

  it('shows only enabled cards and routes through the feature callback', async () => {
    const wrapper = mountDashboard({ memberEnabled: true, bookingEnabled: false })
    expect(wrapper.text()).toContain('ระบบสมาชิก')
    expect(wrapper.text()).toContain('7 สมาชิก')
    expect(wrapper.text()).not.toContain('ระบบจองสนาม')
    await wrapper.findAll('button').find((button) => button.text().includes('ระบบสมาชิก')).trigger('click')
    expect(wrapper.props('navigateAdminFeature')).toHaveBeenCalledWith('members')
  })

  it.each([
    [{ memberEnabled: true, bookingEnabled: false, posEnabled: false }, ['grid-cols-1'], ['sm:grid-cols-2', 'lg:grid-cols-3']],
    [{ memberEnabled: true, bookingEnabled: true, posEnabled: false }, ['sm:grid-cols-2'], ['lg:grid-cols-3']],
    [{ memberEnabled: true, bookingEnabled: true, posEnabled: true }, ['sm:grid-cols-2', 'lg:grid-cols-3'], []]
  ])('fills the feature grid for every visible-card count', (features, includedClasses, excludedClasses) => {
    const wrapper = mountDashboard(features)
    const gridClasses = wrapper.get('[data-testid="admin-feature-grid"]').classes()
    includedClasses.forEach((className) => expect(gridClasses).toContain(className))
    excludedClasses.forEach((className) => expect(gridClasses).not.toContain(className))
  })

  it('opens the shared announcement modal from the dashboard header', async () => {
    const wrapper = mountDashboard({ memberEnabled: false, bookingEnabled: false })
    const button = wrapper.findAll('button').find((item) => item.text().includes('ประกาศ'))
    expect(button.text()).toContain('1')
    await button.trigger('click')
    expect(wrapper.props('openDashboardAnnouncements')).toHaveBeenCalledOnce()
  })
})
