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
})
