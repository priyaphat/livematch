import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import MemberAdminPage from './MemberAdminPage.vue'

describe('MemberAdminPage', () => {
  it('presents member search as a plain input with a clear placeholder', async () => {
    const apiRequest = vi.fn(() => Promise.resolve({ items: [], total: 5, page: 1 }))
    const wrapper = mount(MemberAdminPage, { props: { apiRequest, auth: {} } })
    await vi.waitFor(() => expect(apiRequest).toHaveBeenCalled())

    const search = wrapper.get('input[aria-label="ค้นหาสมาชิก"]')
    expect(search.attributes('placeholder')).toBe('ค้นหาชื่อ เบอร์โทร หรืออีเมล')
    await search.setValue('สมชาย')
    expect(search.element.value).toBe('สมชาย')
    wrapper.unmount()
  })

  it('shows a save error through the toast above the open member modal', async () => {
    const duplicateMessage = 'เบอร์โทรนี้มีอยู่แล้ว'
    const apiRequest = vi.fn((url, options = {}) => {
      if (url === '/api/admin/members' && options.method === 'POST') {
        return Promise.reject(new Error(duplicateMessage))
      }
      return Promise.resolve({ items: [], total: 0, page: 1 })
    })
    const showToast = vi.fn()
    const wrapper = mount(MemberAdminPage, { props: { apiRequest, auth: {}, showToast } })

    await vi.waitFor(() => expect(apiRequest).toHaveBeenCalled())
    const createButton = wrapper.findAll('button').find((button) => button.text().includes('ลงทะเบียนสมาชิก'))
    await createButton.trigger('click')
    const inputs = wrapper.findAll('form input')
    await inputs[0].setValue('สมาชิกซ้ำ')
    await inputs[1].setValue('0882250419')
    await wrapper.find('form').trigger('submit')

    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith(duplicateMessage, 'error'))
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.findAll('form')).toHaveLength(1)
    expect(wrapper.text()).not.toContain(duplicateMessage)
  })

  it('bulk manages club membership with 50 rows per page and saves changed members', async () => {
    const apiRequest = vi.fn((url, options = {}) => {
      if (url === '/api/admin/members/bulk-membership') return Promise.resolve({ changed: 1 })
      if (url === '/api/admin/member-types') return Promise.resolve({ items: [{ id: 'general-id', code: 'general', name: 'สมาชิกทั่วไป', active: true }, { id: 'club-id', code: 'club', name: 'สมาชิกชมรม', active: true }] })
      if (String(url).includes('pageSize=50')) return Promise.resolve({ items: [{ id: 'm1', name: 'สมชาย', phone: '0812345678', memberType: 'general', memberTypeId: 'general-id' }], total: 51, page: 1 })
      return Promise.resolve({ items: [], total: 0, page: 1 })
    })
    const wrapper = mount(MemberAdminPage, { props: { apiRequest, auth: {} } })
    await vi.waitFor(() => expect(apiRequest).toHaveBeenCalled())
    await wrapper.findAll('button').find((button) => button.text().includes('จัดการสมาชิก')).trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('สมชาย'))
    const typeSelect = wrapper.findAll('select').find((select) => select.element.value === 'general-id')
    await typeSelect.setValue('club-id')
    await wrapper.findAll('button').find((button) => button.text() === 'บันทึก').trigger('click')
    await vi.waitFor(() => expect(apiRequest.mock.calls.some(([url]) => url === '/api/admin/members/bulk-membership')).toBe(true))
    const call = apiRequest.mock.calls.find(([url]) => url === '/api/admin/members/bulk-membership')
    expect(JSON.parse(call[1].body)).toEqual({ updates: [{ id: 'm1', memberTypeId: 'club-id' }] })
  })
})
