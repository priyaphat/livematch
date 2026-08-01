import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import POSPage from './POSPage.vue'

function overview(enabled = true) {
  return {
    enabled,
    settings: { promptPayType: 'mobile', promptPayId: '', promptPayReceiverName: '', defaultLowStock: 5, theme: 'light', language: 'th', taxRatePercent: 0, pricesIncludeTax: true },
    categories: [{ id: 'category-1', name: 'เครื่องดื่ม', active: true, usedCount: 1 }],
    units: [{ id: 'unit-1', name: 'ขวด', active: true, usedCount: 1 }, { id: 'unit-2', name: 'กล่อง', active: true, usedCount: 0 }],
    products: [{ id: 'product-1', sku: 'W01', category: 'เครื่องดื่ม', name: 'น้ำดื่ม', unit: 'ขวด', priceThb: 20, costThb: 8, stockQuantity: 10, lowStockThreshold: 2, active: true }, { id: 'product-2', sku: 'S01', category: '', name: 'ลูกแบด', unit: 'กล่อง', priceThb: 120, costThb: 80, stockQuantity: 5, lowStockThreshold: 2, active: true }],
    customers: [{ kind: 'member', id: 'member-1', name: 'สมชาย', phone: '0812345678', billingAccountId: 'account-1' }, { kind: 'player', id: 'today:1', name: 'อนันต์', sessionName: 'Tuesday Match' }],
    sales: [{ id: 'sale-old', buyerName: 'สมชาย', status: 'paid', totalThb: 20, costThb: 8, createdAt: '2026-07-28 10:00', items: [] }],
    stockBatches: [{ id: 'stock-1', name: 'รับสินค้ารอบเช้า', mode: 'in', note: '', totalCostThb: 60, createdAt: '2026-07-28 09:00', items: [{ id: 1, productId: 'product-1', productName: 'น้ำดื่ม', delta: 5, balance: 15, unitCostThb: 12, totalCostThb: 60, previousCostThb: 8, resultingCostThb: 9 }] }],
    report: { salesThb: 20, grossProfitThb: 12, outstandingThb: 0, lowStockCount: 0, cashThb: 20, promptPayThb: 0 }
  }
}

describe('POSPage', () => {
  it('creates an immediate anonymous sale from the cart', async () => {
    const apiRequest = vi.fn((url, options = {}) => {
      if (url === '/api/admin/pos/overview') return Promise.resolve(overview(true))
      if (url === '/api/admin/pos/sales' && options.method === 'POST') return Promise.resolve({ saleId: 'sale-1', status: 'paid', totalThb: 20 })
      return Promise.resolve({})
    })
    const wrapper = mount(POSPage, { props: { apiRequest, auth: {} } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('เริ่มการขาย'))
    await wrapper.findAll('button').find((button) => button.text() === 'การขาย').trigger('click')
    expect(wrapper.text()).toContain('น้ำดื่ม')
    await wrapper.findAll('button').find((button) => button.text().includes('น้ำดื่ม')).trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === 'รับชำระ').trigger('click')
    await vi.waitFor(() => expect(apiRequest.mock.calls.some(([url]) => url === '/api/admin/pos/sales')).toBe(true))
    const call = apiRequest.mock.calls.find(([url]) => url === '/api/admin/pos/sales')
    expect(JSON.parse(call[1].body)).toMatchObject({ buyerType: 'anonymous', action: 'pay', method: 'cash', items: [{ productId: 'product-1', quantity: 1 }] })
  })

  it('hides the point of sale and keeps history available when disabled', async () => {
    const apiRequest = vi.fn(() => Promise.resolve(overview(false)))
    const wrapper = mount(POSPage, { props: { apiRequest, auth: {} } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('ปิดใช้งาน · อ่านย้อนหลัง'))
    expect(wrapper.findAll('button').some((button) => button.text() === 'การขาย')).toBe(false)
    await wrapper.findAll('button').find((button) => button.text() === 'บิล').trigger('click')
    expect(wrapper.text()).toContain('sale-old')
    expect(apiRequest).toHaveBeenCalledWith('/api/admin/pos/overview')
  })

  it('searches buyers only after the name or phone threshold and labels today players with their match', async () => {
    const wrapper = mount(POSPage, { props: { apiRequest: vi.fn(() => Promise.resolve(overview(true))), auth: {} } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('เริ่มการขาย'))
    await wrapper.findAll('button').find((button) => button.text() === 'การขาย').trigger('click')
    const input = wrapper.get('input[placeholder="พิมพ์ชื่อ 2 ตัว หรือเบอร์ 5 ตัว"]')
    await input.setValue('อ')
    expect(wrapper.text()).not.toContain('อนันต์ - Tuesday Match')
    await input.setValue('อน')
    expect(wrapper.text()).toContain('อนันต์ - Tuesday Match')
  })

  it('manages product units and keeps cost and initial stock out of the product form', async () => {
    const wrapper = mount(POSPage, { props: { apiRequest: vi.fn(() => Promise.resolve(overview(true))), auth: {} } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('เริ่มการขาย'))
    await wrapper.findAll('button').find((button) => button.text() === 'สินค้า').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === 'เพิ่มสินค้า').trigger('click')
    expect(wrapper.text()).toContain('รหัสสินค้า (SKU)')
    expect(wrapper.text()).toContain('ไม่มีหน่วย')
    expect(wrapper.text()).not.toContain('สต็อกเริ่มต้น')
    expect(wrapper.text()).not.toContain('ต้นทุนต่อหน่วย')
    await wrapper.findAll('button').find((button) => button.text() === 'เพิ่มหน่วย').trigger('click')
    expect(wrapper.text()).toContain('จัดการหน่วย')
    const deleteButtons = wrapper.findAll('button[aria-label="ลบ"]')
    expect(deleteButtons.some((button) => button.attributes('disabled') !== undefined)).toBe(true)
    expect(deleteButtons.some((button) => button.attributes('disabled') === undefined)).toBe(true)
  })

  it('creates one stock transaction containing multiple selected products', async () => {
    const apiRequest = vi.fn(() => Promise.resolve(overview(true)))
    const wrapper = mount(POSPage, { props: { apiRequest, auth: {} } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('เริ่มการขาย'))
    await wrapper.findAll('button').find((button) => button.text() === 'สต็อก').trigger('click')
    const actions = wrapper.get('[role="group"]').findAll('button')
    expect(actions.map((item) => item.text())).toEqual(['สร้างการนำเข้ารับสินค้าเข้าคลัง', 'สร้างการนำออกเบิกหรือตัดสินค้า', 'สร้างการปรับปรุงแก้ยอดจากการตรวจนับ'])
    await actions[0].trigger('click')
    expect(wrapper.text()).toContain('เลือกสินค้าและกรอกข้อมูลได้หลายรายการพร้อมกัน')
    const checks = wrapper.findAll('input[type="checkbox"]')
    await checks[0].setValue(true)
    await checks[1].setValue(true)
    const numbers = wrapper.findAll('article input[type="number"]')
    await numbers[0].setValue(2)
    await numbers[2].setValue(3)
    expect(wrapper.text()).toContain('คงเหลือ 10 → 12')
    expect(wrapper.text()).toContain('คงเหลือ 5 → 8')
    expect(wrapper.text()).toContain('รวม 2 สินค้า')
    expect(wrapper.text()).toContain('บันทึกรายการรวม')
    await wrapper.find('form').trigger('submit')
    await vi.waitFor(() => expect(apiRequest.mock.calls.some(([url]) => url === '/api/admin/pos/stock/batch')).toBe(true))
    const call = apiRequest.mock.calls.find(([url]) => url === '/api/admin/pos/stock/batch')
    expect(JSON.parse(call[1].body)).toMatchObject({ name: expect.stringContaining('นำเข้า'), mode: 'in', items: [{ productId: 'product-1', quantity: 2 }, { productId: 'product-2', quantity: 3 }] })
  })

  it('previews remaining stock for stock-out and signed differences for adjustments', async () => {
    const wrapper = mount(POSPage, { props: { apiRequest: vi.fn(() => Promise.resolve(overview(true))), auth: {} } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('เริ่มการขาย'))
    await wrapper.findAll('button').find((button) => button.text() === 'สต็อก').trigger('click')
    await wrapper.findAll('button').find((button) => button.text().includes('สร้างการนำออก')).trigger('click')
    await wrapper.findAll('input[type="checkbox"]')[0].setValue(true)
    await wrapper.findAll('article input[type="number"]')[0].setValue(3)
    expect(wrapper.text()).toContain('คงเหลือ 10 → 7')
    await wrapper.findAll('button').find((button) => button.text() === 'ยกเลิก').trigger('click')
    await wrapper.findAll('button').find((button) => button.text().includes('สร้างการปรับปรุง')).trigger('click')
    await wrapper.findAll('input[type="checkbox"]')[0].setValue(true)
    await wrapper.findAll('article input[type="number"]')[0].setValue(12)
    expect(wrapper.text()).toContain('ปรับ +2 จาก 10')
    await wrapper.findAll('article input[type="number"]')[0].setValue(8)
    expect(wrapper.text()).toContain('ปรับ -2 จาก 10')
  })
})
