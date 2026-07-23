import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PublicProfilePage from './PublicProfilePage.vue'

describe('PublicProfilePage', () => {
  it('shows logout for an authenticated member', async () => {
    const apiRequest = vi.fn().mockResolvedValue({
      member: { name: 'ผู้ทดสอบ', email: 'user@example.com', active: true },
      bookingToken: 'tenant-token',
      bookings: [],
      payments: [],
      matches: [],
      serverNow: new Date().toISOString(),
    })
    const wrapper = mount(PublicProfilePage, {
      props: { apiRequest, token: 'profile-token', theme: 'light' },
    })
    await flushPromises()
    expect(wrapper.get('button.booking-secondary-button').text()).toContain('ออกจากระบบ')
    wrapper.unmount()
  })

  it('loads profile history one page at a time', async () => {
    const apiRequest = vi.fn((url) => {
      const page = Number(new URL(url, 'http://localhost').searchParams.get('bookingPage') || 1)
      return Promise.resolve({
        member: { name: 'ผู้ทดสอบ', email: 'user@example.com', active: true },
        bookingToken: 'tenant-token',
        bookings: [{ id: `booking-${page}`, courtName: `สนามหน้า ${page}`, startAt: '2026-07-23T18:00:00+07:00', endAt: '2026-07-23T19:00:00+07:00', status: 'confirmed', totalPriceThb: 100 }],
        payments: [],
        matches: [],
        pagination: {
          bookings: { page, pageSize: 10, total: 11 },
          payments: { page: 1, pageSize: 10, total: 0 },
          matches: { page: 1, pageSize: 10, total: 0 },
        },
        serverNow: new Date().toISOString(),
      })
    })
    const wrapper = mount(PublicProfilePage, {
      props: { apiRequest, token: 'profile-token', theme: 'light' },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('สนามหน้า 1')
    const next = wrapper.find('.profile-pager').findAll('button').find((button) => button.text() === 'ถัดไป')
    await next.trigger('click')
    await flushPromises()
    expect(apiRequest.mock.calls.at(-1)[0]).toContain('bookingPage=2')
    expect(wrapper.text()).toContain('สนามหน้า 2')
    wrapper.unmount()
  })
})
