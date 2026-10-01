import { describe, expect, it, vi } from 'vitest'
import { compressProfileImage, PROFILE_IMAGE_MAX_BYTES } from './profileImage'

describe('profile image compression', () => {
  it('rejects files larger than 5 MB before decoding them', async () => {
    const oversized = new File([new Uint8Array(PROFILE_IMAGE_MAX_BYTES + 1)], 'large.jpg', { type: 'image/jpeg' })
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')
    await expect(compressProfileImage(oversized)).rejects.toThrow('ไม่เกิน 5 MB')
    expect(createObjectURL).not.toHaveBeenCalled()
    createObjectURL.mockRestore()
  })

  it('rejects unsupported file types', async () => {
    const file = new File(['hello'], 'avatar.svg', { type: 'image/svg+xml' })
    await expect(compressProfileImage(file)).rejects.toThrow('JPEG, PNG หรือ WebP')
  })
})
