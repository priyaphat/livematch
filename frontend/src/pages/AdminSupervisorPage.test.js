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
	it('filters the main admin dashboard by week, month, and a custom date range', async () => {
	  const wrapper = mountDashboard({ memberEnabled: true, bookingEnabled: true })
	  const refresh = wrapper.props('refreshAdminSupervisor')
	  const filter = wrapper.get('[data-testid="admin-dashboard-filter"]')

	  await vi.waitFor(() => expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ period: 'week' })))
	  expect(filter.text()).not.toContain('ทั้งหมด')
	  expect(filter.findAll('button').find((button) => button.text() === 'Week').classes()).toContain('bg-court-600')

	  const monthButton = filter.findAll('button').find((button) => button.text() === 'Month')
	  await vi.waitFor(() => expect(monthButton.attributes('disabled')).toBeUndefined())
	  await monthButton.trigger('click')
	  expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ period: 'month' }))

	  const customButton = filter.findAll('button').find((button) => button.text() === 'กำหนดเอง')
	  await vi.waitFor(() => expect(customButton.attributes('disabled')).toBeUndefined())
	  await customButton.trigger('click')
	  await wrapper.get('[data-testid="admin-dashboard-custom-start"]').setValue('2026-09-01')
	  await wrapper.get('[data-testid="admin-dashboard-custom-end"]').setValue('2026-09-12')
	  await wrapper.get('[data-testid="admin-dashboard-custom-filter"]').trigger('submit')
	  expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ period: 'custom', startDate: '2026-09-01', endDate: '2026-09-12' }))
	})

	it('searches and stores a tracked POS product in admin default shuttle settings', async () => {
	  const apiRequest = vi.fn().mockResolvedValue({ items: [{ id: 'product-yonex', name: 'Yonex AS-30', sku: 'SH-030', barcode: '88500030', priceSatang: 9950, trackStock: true, active: true, stockQuantity: 24, unit: 'ลูก' }] })
	  const auth = {
		user: { name: 'Admin', email: 'admin@example.com', coins: 100 }, sessions: [], features: { posEnabled: true }, memberTypes: [], liveMatchSessionCost: 1, liveShareSessionCost: 1,
		defaultSettings: { memberEntryFees: {}, shuttleBrands: [{ id: 'yonex', name: 'Yonex', price: 85, active: true }], courtNames: ['สนาม 1'], levels: ['กลาง'], dashboardAnnouncements: [] }
	  }
	  const wrapper = mount(AdminSupervisorPage, { props: {
		auth, apiRequest, forms: { sessionCreateType: 'liveMatch' }, ui: { showAdminDefaultSettingsModal: true, showCreateSessionModal: false },
		createSession: vi.fn(), openOwnedSession: vi.fn(), refreshAdminSupervisor: vi.fn(), saveAdminDefaultSettings: vi.fn(), addAdminDefaultShuttleBrand: vi.fn(), removeAdminDefaultShuttleBrand: vi.fn(), addAdminDefaultCourt: vi.fn(), removeAdminDefaultCourt: vi.fn(), addAdminDefaultLevel: vi.fn(), removeAdminDefaultLevel: vi.fn()
	  } })
	  const combobox = wrapper.get('input[role="combobox"]')
	  await combobox.trigger('focus')
	  await vi.waitFor(() => expect(wrapper.text()).toContain('Yonex AS-30'))
	  await wrapper.findAll('button').find((button) => button.text().includes('Yonex AS-30')).trigger('click')
	  expect(auth.defaultSettings.shuttleBrands[0].posProductId).toBe('product-yonex')
	  expect(auth.defaultSettings.shuttleBrands[0].priceSatang).toBe(9950)
	  expect(auth.defaultSettings.shuttleBrands[0].price).toBe(99.5)
	  expect(wrapper.text()).toContain('ใช้ราคา POS')
	  expect(wrapper.findAll('input[type="number"]').some((input) => input.attributes('disabled') !== undefined)).toBe(true)
	  expect(combobox.element.value).toContain('Yonex AS-30')
	})

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
    [{ memberEnabled: true, bookingEnabled: false, posEnabled: false }, ['grid-cols-1'], ['sm:grid-cols-2']],
    [{ memberEnabled: true, bookingEnabled: true, posEnabled: false }, ['sm:grid-cols-2'], ['grid-cols-1']],
    [{ memberEnabled: true, bookingEnabled: true, posEnabled: true }, ['sm:grid-cols-2'], ['grid-cols-1']]
  ])('fills the feature grid for every visible-card count', (features, includedClasses, excludedClasses) => {
    const wrapper = mountDashboard(features)
    const gridClasses = wrapper.get('[data-testid="admin-feature-grid"]').classes()
    includedClasses.forEach((className) => expect(gridClasses).toContain(className))
    excludedClasses.forEach((className) => expect(gridClasses).not.toContain(className))
  })

  it('does not render the retired POS UI entry while preserving its feature flag', () => {
    const wrapper = mountDashboard({ memberEnabled: false, bookingEnabled: false, posEnabled: true })
    expect(wrapper.text()).not.toContain('ระบบ POS')
    expect(wrapper.find('[data-testid="admin-feature-grid"]').exists()).toBe(false)
  })

  it('opens the shared announcement modal from the dashboard header', async () => {
    const wrapper = mountDashboard({ memberEnabled: false, bookingEnabled: false })
    const button = wrapper.findAll('button').find((item) => item.text().includes('ประกาศ'))
    expect(button.text()).toContain('1')
    await button.trigger('click')
    expect(wrapper.props('openDashboardAnnouncements')).toHaveBeenCalledOnce()
  })
})
