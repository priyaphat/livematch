import { describe, expect, it, vi } from 'vitest'
import { createAnnouncementAudioCache } from './announcementAudioCache.js'

describe('announcement audio cache', () => {
  it('loads the same announcement once for concurrent and repeated clicks', async () => {
    const loadBlob = vi.fn(async (text) => new Blob([text], { type: 'audio/mpeg' }))
    const create = vi.fn(() => 'blob:announcement')
    const revoke = vi.fn()
    const cache = createAnnouncementAudioCache(loadBlob, { create, revoke })

    const [first, simultaneous] = await Promise.all([
      cache.get('สนาม 1 คุณท็อป'),
      cache.get('สนาม 1 คุณท็อป')
    ])
    const repeated = await cache.get('สนาม 1 คุณท็อป')

    expect(first).toBe('blob:announcement')
    expect(simultaneous).toBe(first)
    expect(repeated).toBe(first)
    expect(loadBlob).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)

    cache.dispose()
    expect(revoke).toHaveBeenCalledWith('blob:announcement')
  })

  it('allows a retry after a failed request', async () => {
    const loadBlob = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(new Blob(['ok'], { type: 'audio/mpeg' }))
    const cache = createAnnouncementAudioCache(loadBlob, { create: () => 'blob:retry', revoke: () => {} })

    await expect(cache.get('ข้อความ')).rejects.toThrow('temporary failure')
    await expect(cache.get('ข้อความ')).resolves.toBe('blob:retry')
    expect(loadBlob).toHaveBeenCalledTimes(2)
  })
})
