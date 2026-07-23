import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import BookingAdminPage from './BookingAdminPage.vue'

const testToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
function addDays(value, days) {
  const date = new Date(`${value}T12:00:00+07:00`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
const testTomorrow = addDays(testToday, 1)

function overview(settings = {}) {
  return {
    settings: {
      openTime: '16:00', closeTime: '22:00', intervalMinutes: 60, allowOvernight: false,
      useSamePrice: true, promptPayType: 'mobile', promptPayId: '', promptPayReceiverName: '',
      publicToken: 'public-token', ...settings
    },
    courts: [{ id: 'court-1', name: 'สนาม 1', pricePerInterval: 100, active: true }],
    bookings: [{ id: 'booking-1', courtId: 'court-1', courtName: 'สนาม 1', bookerName: 'ผู้จอง', startAt: `${testToday}T17:00:00+07:00`, endAt: `${testToday}T18:00:00+07:00`, status: 'pending_review', totalPriceThb: 100, slipData: 'data:image/png;base64,iVBORw0KGgo=' }],
    closures: [
      { id: 'closure-1', courtId: 'court-1', startAt: `${testToday}T20:00:00+07:00`, endAt: `${testToday}T21:00:00+07:00`, note: 'ซ่อมพื้นสนาม' },
      { id: 'closure-2', courtId: 'court-1', startAt: `${testTomorrow}T20:00:00+07:00`, endAt: `${testTomorrow}T21:00:00+07:00`, note: 'ซ่อมพื้นสนาม' }
    ]
  }
}

describe('BookingAdminPage', () => {
  it('separates tabs, shows closure reasons, and does not overwrite settings during overview refresh', async () => {
    let payload = overview()
    const apiRequest = vi.fn(() => Promise.resolve(structuredClone(payload)))
    const wrapper = mount(BookingAdminPage, { props: { apiRequest } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('ซ่อมพื้นสนาม'))

    expect(wrapper.text()).toContain('เวลา / สนาม')
    expect(wrapper.text()).toContain('รอตรวจสอบ')
    expect(wrapper.text()).toContain('ตั้งค่า')
    expect(wrapper.text()).toContain('ผู้จอง · สนาม 1')
    expect(wrapper.find('.booking-state--pending').exists()).toBe(true)
    expect(wrapper.find('.booking-state--pending').text()).toBe('รอตรวจสอบ\nผู้จอง')
    expect(wrapper.find('.booking-state--closed').exists()).toBe(true)
    expect(wrapper.find('.booking-state--free').exists()).toBe(true)
    expect(wrapper.text()).toContain('ประวัติการจอง')
    expect(wrapper.findAll('nav button')).toHaveLength(3)

    const detailButton = wrapper.findAll('button').find((button) => button.text().includes('ดูรายละเอียด'))
    await detailButton.trigger('click')
    expect(wrapper.text()).toContain('รายละเอียดการจอง')
    expect(wrapper.find('img[alt="สลิปชำระเงิน"]').exists()).toBe(true)
    await wrapper.get('form[class*="max-h"]').trigger('submit')
    await vi.waitFor(() =>
      expect(apiRequest.mock.calls.some(([url]) => url.includes('/bookings/booking-1/review'))).toBe(true)
    )
    const reviewCall = apiRequest.mock.calls.find(([url]) => url.includes('/bookings/booking-1/review'))
    expect(JSON.parse(reviewCall[1].body)).toEqual({ action: 'approve', note: '' })
    expect(reviewCall[1].body).not.toContain('slipData')

    const detailButtonAgain = wrapper.findAll('button').find((button) => button.text().includes('ดูรายละเอียด'))
    await detailButtonAgain.trigger('click')
    await wrapper.get('button[aria-label="ปิดรายละเอียด"]').trigger('click')

    const nextDate = wrapper.find('button[aria-label="วันถัดไป"]')
    await nextDate.trigger('click')
    await vi.waitFor(() => expect(apiRequest.mock.calls.at(-1)[0]).toContain(`date=${testTomorrow}`))
    await vi.waitFor(() => {
      const closedCells = wrapper.findAll('tbody button').filter((button) => button.attributes('title') === 'ซ่อมพื้นสนาม')
      expect(closedCells).toHaveLength(1)
    })

    const previousDate = wrapper.find('button[aria-label="วันก่อนหน้า"]')
    await previousDate.trigger('click')
    await vi.waitFor(() => expect(apiRequest.mock.calls.at(-1)[0]).toContain(`date=${testToday}`))

    const historyTab = wrapper.findAll('nav button').find((button) => button.text().includes('ประวัติการจอง'))
    await historyTab.trigger('click')
    await vi.waitFor(() => expect(apiRequest.mock.calls.at(-1)[0]).toContain('/api/admin/booking/history?'))
    expect(wrapper.findAll('form input[type="date"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('เบอร์โทร')
    expect(wrapper.text()).toContain('ทุกสนาม')

    const settingsTab = wrapper.findAll('button').find((button) => button.text().includes('ตั้งค่า'))
    await settingsTab.trigger('click')
    const openTime = wrapper.find('input[type="time"]')
    const interval = wrapper.find('input[min="10"]')
    const activeCourtToggle = wrapper.findAll('label').find((label) => label.text().includes('เปิดใช้งาน')).find('input[type="checkbox"]')
    expect(activeCourtToggle.element.checked).toBe(true)
    await activeCourtToggle.setValue(false)
    await vi.waitFor(() => expect(apiRequest.mock.calls.some(([url, options]) =>
      url.includes('/api/admin/booking/courts/court-1') &&
      options?.method === 'PATCH' &&
      JSON.parse(options.body).active === false
    )).toBe(true))
    expect(wrapper.findAll('tbody tr')).toHaveLength(6)
    await openTime.setValue('17:30')
    await interval.setValue('30')
    expect(wrapper.findAll('tbody tr')).toHaveLength(6)
    expect(wrapper.text()).toContain('16:00 น.')

    payload = overview({ openTime: '19:00' })
    const refresh = wrapper.findAll('button').find((button) => button.text().includes('รีเฟรชตาราง'))
    await refresh.trigger('click')
    await vi.waitFor(() => expect(apiRequest.mock.calls.length).toBeGreaterThan(1))
    expect(openTime.element.value).toBe('17:30')
    expect(wrapper.findAll('tbody tr')).toHaveLength(6)

    const qrButton = wrapper.findAll('button').find((button) => button.text().includes('QR/ลิงก์'))
    await qrButton.trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('ลิงก์ลงทะเบียนและจองสนาม'))

    wrapper.unmount()
  })

  it('paginates pending reviews and requests booking history pages from the API', async () => {
    const pending = Array.from({ length: 11 }, (_, index) => ({
      id: `pending-${index + 1}`,
      courtId: 'court-1',
      courtName: 'สนาม 1',
      bookerName: `ผู้จอง ${index + 1}`,
      startAt: `${testToday}T17:00:00+07:00`,
      endAt: `${testToday}T18:00:00+07:00`,
      status: 'pending_review',
      totalPriceThb: 100,
    }))
    const apiRequest = vi.fn((url) => {
      if (url.includes('/history?')) {
        const page = Number(new URL(url, 'http://localhost').searchParams.get('page') || 1)
        return Promise.resolve({ items: page === 1 ? [{ ...pending[0], status: 'confirmed' }] : [{ ...pending[10], status: 'confirmed' }], page, pageSize: 20, total: 21 })
      }
      return Promise.resolve({ ...overview(), bookings: pending })
    })
    const wrapper = mount(BookingAdminPage, { props: { apiRequest } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('หน้า 1 / 2 · 11 รายการ'))
    expect(wrapper.text()).toContain('ผู้จอง 10')
    expect(wrapper.text()).not.toContain('ผู้จอง 11 · สนาม 1')

    const pendingNext = wrapper.findAll('button').find((button) => button.text() === 'ถัดไป')
    await pendingNext.trigger('click')
    expect(wrapper.text()).toContain('ผู้จอง 11')

    const historyTab = wrapper.findAll('nav button').find((button) => button.text().includes('ประวัติการจอง'))
    await historyTab.trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('หน้า 1 / 2'))
    const historyNext = wrapper.findAll('button').find((button) => button.text() === 'ถัดไป')
    await historyNext.trigger('click')
    await vi.waitFor(() => expect(apiRequest.mock.calls.at(-1)[0]).toContain('page=2'))
    expect(apiRequest.mock.calls.at(-1)[0]).toContain('pageSize=20')
    wrapper.unmount()
  })
})
