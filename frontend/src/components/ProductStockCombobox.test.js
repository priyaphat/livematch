import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ProductStockCombobox from './ProductStockCombobox.vue'

describe('ProductStockCombobox', () => {
  it('shows exact POS price and stock and emits the complete selected product', async () => {
    const product = {
      id: 'shuttle-1',
      name: 'Yonex AS-30',
      sku: 'SH-030',
      priceSatang: 9950,
      saleStockQuantity: 12,
      unit: 'ลูก',
      trackStock: true,
      active: true
    }
    const apiRequest = vi.fn().mockResolvedValue({ items: [product] })
    const wrapper = mount(ProductStockCombobox, { props: { modelValue: '', apiRequest } })

    await wrapper.get('input[role="combobox"]').trigger('focus')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Yonex AS-30'))
    expect(wrapper.text()).toContain('99.50')
    expect(wrapper.text()).toContain('คงเหลือ 12 ลูก')

    await wrapper.findAll('button').find((button) => button.text().includes('Yonex AS-30')).trigger('click')
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual(['shuttle-1'])
    expect(wrapper.emitted('selected-product').at(-1)).toEqual([product])
  })

  it('clears both the product id and selected product snapshot', async () => {
    const wrapper = mount(ProductStockCombobox, {
      props: { modelValue: 'shuttle-1', apiRequest: vi.fn().mockResolvedValue({ items: [] }) }
    })
    await wrapper.get('button[aria-label="ยกเลิกการเชื่อมสินค้า"]').trigger('click')
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([''])
    expect(wrapper.emitted('selected-product').at(-1)).toEqual([null])
  })

  it('reopens a selected product by its id instead of searching its display label', async () => {
    const product = { id: 'shuttle-1', name: 'Yonex AS-30', sku: 'SH-030', priceSatang: 10000, stockQuantity: 8, trackStock: true, active: true }
    const apiRequest = vi.fn().mockResolvedValue({ items: [product] })
    const wrapper = mount(ProductStockCombobox, { props: { modelValue: 'shuttle-1', apiRequest } })
    await vi.waitFor(() => expect(wrapper.get('input').element.value).toContain('Yonex AS-30'))

    apiRequest.mockClear()
    await wrapper.get('input').trigger('focus')
    await vi.waitFor(() => expect(apiRequest).toHaveBeenCalled())
    expect(apiRequest.mock.calls.at(-1)[0]).toContain('search=shuttle-1')
    expect(wrapper.text()).toContain('คงเหลือ 8 หน่วย')
  })
})
