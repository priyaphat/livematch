import { describe, expect, it } from 'vitest'
import { waitMinutes } from './waitTime'

describe('waitMinutes', () => {
  it('returns whole elapsed minutes', () => {
    expect(waitMinutes('2026-08-17T10:00:00Z', Date.parse('2026-08-17T10:12:59Z'))).toBe(12)
  })

  it('returns null while the player is in a live match', () => {
    expect(waitMinutes('', Date.now())).toBeNull()
  })

  it('never displays a negative minute count', () => {
    expect(waitMinutes('2026-08-17T10:01:00Z', Date.parse('2026-08-17T10:00:00Z'))).toBe(0)
  })
})
