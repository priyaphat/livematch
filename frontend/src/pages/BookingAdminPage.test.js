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
  it('locks the settings save button and shows a completion toast', async () => {
    let resolveSave
    const pendingSave = new Promise((resolve) => { resolveSave = resolve })
    const settingsWithImages = overview({
      logoData: 'data:image/png;base64,current-logo',
      popupImage: 'data:image/png;base64,current-popup',
    })
    const apiRequest = vi.fn((url, options) => {
      if (url === '/api/admin/booking/settings' && options?.method === 'PUT') return pendingSave
      if (url.includes('/slipok-quota')) return Promise.resolve({})
      if (url.includes('/blacklist')) return Promise.resolve({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 })
      return Promise.resolve(structuredClone(settingsWithImages))
    })
    const wrapper = mount(BookingAdminPage, { props: { apiRequest } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('ตารางการจองสนาม'))
    await wrapper.findAll('button').find((button) => button.text().includes('ตั้งค่า')).trigger('click')
    const saveButton = wrapper.findAll('button').find((button) => button.text().includes('บันทึกตั้งค่า'))
    await saveButton.trigger('click')
    await saveButton.trigger('click')
    const saveCalls = apiRequest.mock.calls.filter(([url, options]) => url === '/api/admin/booking/settings' && options?.method === 'PUT')
    expect(saveCalls).toHaveLength(1)
    expect(JSON.parse(saveCalls[0][1].body)).not.toHaveProperty('logoData')
    expect(JSON.parse(saveCalls[0][1].body)).not.toHaveProperty('popupImage')
    expect(saveButton.attributes('disabled')).toBeDefined()
    expect(saveButton.text()).toContain('กำลังบันทึก')
    resolveSave(structuredClone(settingsWithImages))
    await vi.waitFor(() => expect(wrapper.text()).toContain('บันทึกการตั้งค่าแล้ว'))
    wrapper.unmount()
  })

  it('sends an empty image field only when the admin deletes that image', async () => {
    const settingsWithImages = overview({
      logoData: 'data:image/png;base64,current-logo',
      popupImage: 'data:image/png;base64,current-popup',
    })
    const apiRequest = vi.fn((url) => {
      if (url.includes('/slipok-quota')) return Promise.resolve({})
      return Promise.resolve(structuredClone(settingsWithImages))
    })
    const wrapper = mount(BookingAdminPage, { props: { apiRequest } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('ตารางการจองสนาม'))
    await wrapper.findAll('button').find((button) => button.text().includes('ตั้งค่า')).trigger('click')
    await wrapper.findAll('button').find((button) => button.text().includes('การแสดงผล')).trigger('click')
    await wrapper.findAll('button').find((button) => button.text().includes('ลบภาพ Popup')).trigger('click')
    await wrapper.findAll('button').find((button) => button.text().includes('บันทึกตั้งค่า')).trigger('click')

    const saveCall = apiRequest.mock.calls.find(([url, options]) =>
      url === '/api/admin/booking/settings' && options?.method === 'PUT'
    )
    const payload = JSON.parse(saveCall[1].body)
    expect(payload).not.toHaveProperty('logoData')
    expect(payload.popupImage).toBe('')
    wrapper.unmount()
  })

  it('checks Telegram getUpdates and renders the returned JSON without saving the token', async () => {
    const apiRequest = vi.fn((url, options) => {
      if (url === '/api/admin/booking/telegram-check') {
        return Promise.resolve({ httpStatus: 200, response: { ok: true, result: [{ update_id: 42 }] } })
      }
      return Promise.resolve(structuredClone(overview()))
    })
    const wrapper = mount(BookingAdminPage, { props: { apiRequest } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('ตารางการจองสนาม'))
    await wrapper.findAll('button').find((button) => button.text().includes('ตั้งค่า')).trigger('click')
    await wrapper.findAll('button').find((button) => button.text().includes('การรับชำระ')).trigger('click')
    await wrapper.find('input[type="password"]').setValue('123456789:test-secret')
    await wrapper.findAll('button').find((button) => button.text().includes('getUpdates')).trigger('click')

    await vi.waitFor(() => expect(wrapper.text()).toContain('update_id'))
    expect(wrapper.text()).toContain('42')
    const request = apiRequest.mock.calls.find(([url]) => url === '/api/admin/booking/telegram-check')
    expect(JSON.parse(request[1].body)).toEqual({ botToken: '123456789:test-secret' })
    expect(apiRequest.mock.calls.some(([url, options]) => url.endsWith('/settings') && options?.method === 'PUT')).toBe(false)
    wrapper.unmount()
  })

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
    expect(wrapper.findAll('nav button')).toHaveLength(5)

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
    expect(wrapper.text()).toContain('ตารางและกติกา')
    expect(wrapper.text()).toContain('การรับชำระ')
    expect(wrapper.text()).toContain('Auto Slip')
    expect(wrapper.text()).toContain('การแสดงผล')
    const courtsTab = wrapper.findAll('button').find((button) => button.text().includes('จัดการสนาม'))
    await courtsTab.trigger('click')
    const activeCourtToggle = wrapper.findAll('label').find((label) => label.text().includes('เปิดใช้งาน')).find('input[type="checkbox"]')
    expect(activeCourtToggle.element.checked).toBe(true)
    await activeCourtToggle.setValue(false)
    await vi.waitFor(() => expect(apiRequest.mock.calls.some(([url, options]) =>
      url.includes('/api/admin/booking/courts/court-1') &&
      options?.method === 'PATCH' &&
      JSON.parse(options.body).active === false
    )).toBe(true))
    const bookingRulesTab = wrapper.findAll('button').find((button) => button.text().includes('ตารางและกติกา'))
    await bookingRulesTab.trigger('click')
    const openTime = wrapper.find('input[type="time"]')
    const interval = wrapper.find('input[min="10"]')
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

  it('shows pending reviews from every date, including overdue bookings', async () => {
    const payload = overview()
    payload.bookings = []
    payload.pendingReviews = [
      { id: 'overdue-1', courtId: 'court-1', courtName: 'สนาม 1', bookerName: 'รายการค้าง', startAt: '2026-01-01T17:00:00+07:00', endAt: '2026-01-01T18:00:00+07:00', status: 'pending_review', totalPriceThb: 100 },
      { id: 'future-1', courtId: 'court-1', courtName: 'สนาม 1', bookerName: 'รายการวันอื่น', startAt: `${testTomorrow}T17:00:00+07:00`, endAt: `${testTomorrow}T18:00:00+07:00`, status: 'pending_review', totalPriceThb: 100 },
    ]
    const apiRequest = vi.fn(() => Promise.resolve(structuredClone(payload)))
    const wrapper = mount(BookingAdminPage, { props: { apiRequest } })

    await vi.waitFor(() => expect(wrapper.text()).toContain('รายการค้าง'))
    expect(wrapper.text()).toContain('รายการวันอื่น')
    expect(wrapper.findAll('nav button').find((button) => button.text().includes('รอตรวจสอบ')).text()).toContain('2')
    wrapper.unmount()
  })

  it('groups a booking batch into one pending row and shows every slot in the review modal', async () => {
    const payload = overview()
    payload.bookings = []
    payload.pendingReviews = [16, 17, 18].map((hour, index) => ({
      id: `batch-booking-${index + 1}`,
      batchId: 'batch-1',
      courtId: 'court-1',
      courtName: 'สนาม 1',
      bookerName: 'ผู้จองสามช่วง',
      startAt: `${testToday}T${hour}:00:00+07:00`,
      endAt: `${testToday}T${hour + 1}:00:00+07:00`,
      status: 'pending_review',
      totalPriceThb: 100,
      slipData: 'data:image/png;base64,iVBORw0KGgo=',
    }))
    const apiRequest = vi.fn(() => Promise.resolve(structuredClone(payload)))
    const wrapper = mount(BookingAdminPage, { props: { apiRequest } })

    await vi.waitFor(() => expect(wrapper.text()).toContain('ผู้จองสามช่วง · 3 ช่วงเวลา'))
    expect(wrapper.findAll('section article')).toHaveLength(1)
    expect(wrapper.text()).toContain('฿300')
    await wrapper.find('section article button').trigger('click')
    const modal = wrapper.get('[aria-labelledby="booking-review-title"]')
    expect(modal.text()).toContain('ช่วงเวลาที่จอง 3 รายการ')
    expect(modal.text()).toContain('1. สนาม 1')
    expect(modal.text()).toContain('2. สนาม 1')
    expect(modal.text()).toContain('3. สนาม 1')
    expect(modal.text()).toContain('฿300')
    wrapper.unmount()
  })

  it.each([
    ['จองสนาม', '/api/admin/booking/bookings'],
    ['ปิดช่วงเวลา', '/api/admin/booking/closures'],
  ])('submits multiple selected slots when creating %s', async (modeLabel, endpoint) => {
    const payload = overview()
    payload.bookings = []
    payload.closures = []
    const apiRequest = vi.fn((url) => Promise.resolve(url.includes('/overview') ? structuredClone(payload) : {}))
    const wrapper = mount(BookingAdminPage, { props: { apiRequest } })
    await vi.waitFor(() => expect(wrapper.findAll('tbody .booking-state--free')).toHaveLength(6))

    const freeSlots = wrapper.findAll('tbody .booking-state--free')
    await freeSlots[0].trigger('click')
    await freeSlots[2].trigger('click')
    expect(wrapper.text()).toContain('เลือกแล้ว 2 ช่องเวลา')

    if (modeLabel === 'ปิดช่วงเวลา') {
      await wrapper.findAll('.booking-segmented button').find((button) => button.text().includes(modeLabel)).trigger('click')
      await wrapper.find('textarea').setValue('ปิดปรับปรุง')
    }
    await wrapper.find('.booking-inspector form').trigger('submit')

    await vi.waitFor(() => expect(apiRequest.mock.calls.some(([url]) => url === endpoint)).toBe(true))
    const request = apiRequest.mock.calls.find(([url]) => url === endpoint)
    const body = JSON.parse(request[1].body)
    expect(body.items).toEqual([
      { courtId: 'court-1', startAt: `${testToday}T16:00`, endAt: `${testToday}T17:00` },
      { courtId: 'court-1', startAt: `${testToday}T18:00`, endAt: `${testToday}T19:00` },
    ])
    expect(body.slots).toBeUndefined()
    wrapper.unmount()
  })

  it('keeps adjacent selected slots as separate booking history records', async () => {
    const payload = overview()
    payload.bookings = []
    payload.closures = []
    const apiRequest = vi.fn((url) => Promise.resolve(url.includes('/overview') ? structuredClone(payload) : { items: [], total: 0 }))
    const wrapper = mount(BookingAdminPage, { props: { apiRequest } })
    await vi.waitFor(() => expect(wrapper.findAll('tbody .booking-state--free')).toHaveLength(6))

    const freeSlots = wrapper.findAll('tbody .booking-state--free')
    await freeSlots[0].trigger('click')
    await freeSlots[1].trigger('click')
    await wrapper.find('.booking-inspector form').trigger('submit')

    await vi.waitFor(() => expect(apiRequest.mock.calls.some(([url]) => url === '/api/admin/booking/bookings')).toBe(true))
    const request = apiRequest.mock.calls.find(([url]) => url === '/api/admin/booking/bookings')
    expect(JSON.parse(request[1].body).items).toEqual([
      { courtId: 'court-1', startAt: `${testToday}T16:00`, endAt: `${testToday}T17:00` },
      { courtId: 'court-1', startAt: `${testToday}T17:00`, endAt: `${testToday}T18:00` },
    ])
    wrapper.unmount()
  })

  it('shows a paid-together booking batch as one history row with its slot count', async () => {
    const payload = overview()
    const apiRequest = vi.fn((url) => {
      if (url.includes('/history?')) return Promise.resolve({
        items: [{
          id: 'batch-1', batchId: 'batch-1', bookingCount: 2,
          courtName: 'สนาม 1, สนาม 2', bookerName: 'Admin', bookedBy: 'admin', phone: '',
          startAt: `${testToday}T16:00:00+07:00`, endAt: `${testToday}T18:00:00+07:00`,
          status: 'confirmed', paymentStatus: 'unpaid', totalPriceThb: 220, createdAt: '12/08/2026 15:45',
          items: [
            { id: 'one', courtName: 'สนาม 1', startAt: `${testToday}T16:00:00+07:00`, endAt: `${testToday}T17:00:00+07:00`, totalPriceThb: 100 },
            { id: 'two', courtName: 'สนาม 2', startAt: `${testToday}T17:00:00+07:00`, endAt: `${testToday}T18:00:00+07:00`, totalPriceThb: 120 },
          ],
        }],
        page: 1, pageSize: 20, total: 1,
      })
      return Promise.resolve(structuredClone(payload))
    })
    const wrapper = mount(BookingAdminPage, { props: { apiRequest } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('ตารางการจองสนาม'))
    await wrapper.findAll('button').find((button) => button.text().includes('ประวัติการจอง')).trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('2 ช่วงเวลา'))

    const historyTable = wrapper.findAll('table').find((table) => table.text().includes('สถานะการจอง'))
    expect(historyTable.findAll('tbody tr')).toHaveLength(1)
    expect(historyTable.text()).toContain('เวลาที่ทำรายการ')
    expect(historyTable.text()).toContain('12/08/2026 15:45')
    expect(historyTable.text()).not.toContain('สถานะชำระ')
    expect(historyTable.text()).not.toContain('สนาม 1, สนาม 2')
    expect(wrapper.text()).toContain('แสดง 1 จาก 1 รายการ')
    await historyTable.findAll('button').find((button) => button.text().includes('ดูรายการ')).trigger('click')
    expect(wrapper.get('[aria-labelledby="booking-history-detail-title"]').text()).toContain('สนาม 1')
    expect(wrapper.get('[aria-labelledby="booking-history-detail-title"]').text()).toContain('สนาม 2')
    expect(wrapper.get('[aria-labelledby="booking-history-detail-title"]').text()).toContain('฿220')
    wrapper.unmount()
  })

  it('repeats the selected slot on each chosen date without changing its time', async () => {
    const payload = overview()
    payload.bookings = []
    payload.closures = []
    const apiRequest = vi.fn((url) => Promise.resolve(url.includes('/overview') ? structuredClone(payload) : {}))
    const wrapper = mount(BookingAdminPage, { props: { apiRequest } })
    await vi.waitFor(() => expect(wrapper.find('.booking-state--free').exists()).toBe(true))

    const selectedSlot = wrapper.find('.booking-state--free')
    await selectedSlot.trigger('click')
    const dateInputs = wrapper.findAll('.booking-inspector input[type="date"]')
    await dateInputs[0].setValue(testToday)
    await dateInputs[1].setValue(testTomorrow)

    expect(wrapper.text()).toContain('ทำซ้ำ 2 วัน · รวม 2 รายการ')
    expect(wrapper.text()).toContain('฿200')
    expect(selectedSlot.classes()).toContain('booking-state--selected')
    await wrapper.find('.booking-inspector form').trigger('submit')

    await vi.waitFor(() => expect(apiRequest.mock.calls.some(([url]) => url === '/api/admin/booking/bookings')).toBe(true))
    const request = apiRequest.mock.calls.find(([url]) => url === '/api/admin/booking/bookings')
    const body = JSON.parse(request[1].body)
    expect(body.items).toEqual([
      { courtId: 'court-1', startAt: `${testToday}T16:00`, endAt: `${testToday}T17:00` },
      { courtId: 'court-1', startAt: `${testTomorrow}T16:00`, endAt: `${testTomorrow}T17:00` },
    ])
    const historyTab = wrapper.findAll('button').find((button) => button.text().includes('ประวัติการจอง'))
    await historyTab.trigger('click')
    await vi.waitFor(() => expect(apiRequest.mock.calls.some(([url]) => url.includes(`/api/admin/booking/history?startDate=${testToday}&endDate=${testTomorrow}`))).toBe(true))
    wrapper.unmount()
  })

  it('repeats every selected court slot across the closure date range', async () => {
    const payload = overview()
    payload.courts.push({ id: 'court-2', name: 'สนาม 2', pricePerInterval: 120, active: true })
    payload.bookings = []
    payload.closures = []
    const apiRequest = vi.fn((url) => Promise.resolve(url.includes('/overview') ? structuredClone(payload) : {}))
    const wrapper = mount(BookingAdminPage, { props: { apiRequest } })
    await vi.waitFor(() => expect(wrapper.findAll('tbody .booking-state--free').length).toBeGreaterThanOrEqual(2))

    const freeSlots = wrapper.findAll('tbody .booking-state--free')
    await freeSlots[0].trigger('click')
    await freeSlots[1].trigger('click')
    await wrapper.findAll('.booking-segmented button').find((button) => button.text().includes('ปิดช่วงเวลา')).trigger('click')
    const dateInputs = wrapper.findAll('.booking-inspector input[type="date"]')
    await dateInputs[0].setValue(testTomorrow)
    await dateInputs[1].setValue(addDays(testTomorrow, 3))
    await wrapper.find('textarea').setValue('ปิดปรับปรุง')

    expect(wrapper.text()).toContain('ทำซ้ำ 4 วัน · รวม 8 รายการ')
    await wrapper.find('.booking-inspector form').trigger('submit')
    await vi.waitFor(() => expect(apiRequest.mock.calls.some(([url]) => url === '/api/admin/booking/closures')).toBe(true))
    const request = apiRequest.mock.calls.find(([url]) => url === '/api/admin/booking/closures')
    const body = JSON.parse(request[1].body)
    expect(body.items).toHaveLength(8)
    expect(body.items[0]).toEqual({ courtId: 'court-1', startAt: `${testTomorrow}T16:00`, endAt: `${testTomorrow}T17:00` })
    expect(body.items.at(-1)).toEqual({ courtId: 'court-2', startAt: `${addDays(testTomorrow, 3)}T16:00`, endAt: `${addDays(testTomorrow, 3)}T17:00` })
    wrapper.unmount()
  })

  it('calculates repeated multi-court slots by daily cost times number of days', async () => {
    const payload = overview()
    payload.courts.push({ id: 'court-2', name: 'สนาม 2', pricePerInterval: 120, active: true })
    payload.bookings = []
    payload.closures = []
    const apiRequest = vi.fn((url) => Promise.resolve(url.includes('/overview') ? structuredClone(payload) : {}))
    const wrapper = mount(BookingAdminPage, { props: { apiRequest } })
    await vi.waitFor(() => expect(wrapper.findAll('tbody .booking-state--free').length).toBeGreaterThanOrEqual(2))

    const freeSlots = wrapper.findAll('tbody .booking-state--free')
    await freeSlots[0].trigger('click')
    await freeSlots[1].trigger('click')
    expect(wrapper.text()).toContain('฿220')
    expect(wrapper.findAll('input[type="datetime-local"]')).toHaveLength(0)

    const dateInputs = wrapper.findAll('.booking-inspector input[type="date"]')
    await dateInputs[0].setValue(testToday)
    await dateInputs[1].setValue(testTomorrow)

    expect(wrapper.text()).toContain('2 ช่อง / วัน × 2 วัน · 220 บาท / วัน')
    expect(wrapper.text()).toContain('฿440')
    await wrapper.find('.booking-inspector form').trigger('submit')

    await vi.waitFor(() => expect(apiRequest.mock.calls.some(([url]) => url === '/api/admin/booking/bookings')).toBe(true))
    const request = apiRequest.mock.calls.find(([url]) => url === '/api/admin/booking/bookings')
    expect(JSON.parse(request[1].body).items).toEqual([
      { courtId: 'court-1', startAt: `${testToday}T16:00`, endAt: `${testToday}T17:00` },
      { courtId: 'court-2', startAt: `${testToday}T16:00`, endAt: `${testToday}T17:00` },
      { courtId: 'court-1', startAt: `${testTomorrow}T16:00`, endAt: `${testTomorrow}T17:00` },
      { courtId: 'court-2', startAt: `${testTomorrow}T16:00`, endAt: `${testTomorrow}T17:00` },
    ])
    wrapper.unmount()
  })

  it('uses one searchable booker combobox with admin as the first option', async () => {
    const payload = overview()
    payload.bookings = []
    payload.closures = []
    const member = { id: 'member-1', name: 'สมชาย', phone: '0812345678' }
    const apiRequest = vi.fn((url) => {
      if (url.includes('/members/search?')) return Promise.resolve({ items: [member] })
      if (url === '/api/admin/booking/bookings') return Promise.resolve({})
      return Promise.resolve(structuredClone(payload))
    })
    const wrapper = mount(BookingAdminPage, { props: { apiRequest } })
    await vi.waitFor(() => expect(wrapper.find('.booking-state--free').exists()).toBe(true))
    await wrapper.find('.booking-state--free').trigger('click')

    const combobox = wrapper.get('input[role="combobox"]')
    expect(combobox.element.value).toBe('จองโดย Admin')
    await combobox.trigger('focus')
    expect(wrapper.findAll('[role="option"]')[0].text()).toContain('จองโดย Admin')
    await combobox.setValue('081234')
    await vi.waitFor(() => expect(wrapper.text()).toContain('สมชาย'))
    expect(apiRequest.mock.calls.some(([url]) => url.includes('/members/search?q=081234'))).toBe(true)

    const memberOption = wrapper.findAll('[role="option"]').find((option) => option.text().includes('สมชาย'))
    await memberOption.trigger('mousedown')
    expect(combobox.element.value).toBe('0812345678 · สมชาย')
    await wrapper.find('.booking-inspector form').trigger('submit')

    await vi.waitFor(() => expect(apiRequest.mock.calls.some(([url]) => url === '/api/admin/booking/bookings')).toBe(true))
    const request = apiRequest.mock.calls.find(([url]) => url === '/api/admin/booking/bookings')
    expect(JSON.parse(request[1].body).memberId).toBe('member-1')
    wrapper.unmount()
  })
})
