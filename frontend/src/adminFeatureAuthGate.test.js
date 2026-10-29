import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn((value) => Promise.resolve(`data:image/png;base64,${btoa(value)}`)) }
}))

describe('admin feature authentication transition', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.resetModules()
    window.history.replaceState({}, '', '/admin/members')
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
    window.history.replaceState({}, '', '/')
  })

  it('shows a spinner instead of flashing the login page while checking the existing session', async () => {
    let resolveAuth
    globalThis.fetch = vi.fn(() => new Promise((resolve) => { resolveAuth = resolve }))
    const { default: App } = await import('./App.vue')
    const wrapper = mount(App)

    expect(wrapper.find('[data-testid="admin-feature-auth-spinner"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('สมัครสมาชิก')

    resolveAuth({ ok: false, status: 401, headers: { get: () => null }, json: () => Promise.resolve({ error: 'login required' }) })
    await flushPromises()

    expect(wrapper.find('[data-testid="admin-feature-auth-spinner"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('เข้าสู่ระบบ')
    wrapper.unmount()
  }, 15000)

  it('reveals the real login page if the session check stalls', async () => {
    vi.useFakeTimers()
    globalThis.fetch = vi.fn(() => new Promise(() => {}))
    const { default: App } = await import('./App.vue')
    const wrapper = mount(App)

    expect(wrapper.find('[data-testid="admin-feature-auth-spinner"]').exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(8000)
    await flushPromises()

    expect(wrapper.find('[data-testid="admin-feature-auth-spinner"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('เข้าสู่ระบบ')
    wrapper.unmount()
  })
})
