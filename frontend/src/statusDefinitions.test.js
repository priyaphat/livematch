import { describe, expect, it } from 'vitest'
import { language } from './i18n'
import { statusDefinitions, statusText, statusTone } from './statusDefinitions'

describe('status definitions', () => {
  it('covers every booking, payment, and match status without leaking internal codes', () => {
    const statuses = ['hold', 'pending_review', 'confirmed', 'rejected', 'cancelled', 'expired', 'unpaid', 'pending', 'paid', 'approved', 'manual_paid', 'finished']
    for (const status of statuses) {
      expect(statusDefinitions[status]).toBeTruthy()
      expect(statusText(status)).not.toBe(status)
      expect(statusTone(status)).toBeTruthy()
    }
  })

  it('uses the selected language and has a safe fallback', () => {
    language.value = 'en'
    expect(statusText('pending_review')).toBe('Pending review')
    expect(statusText('not_a_status')).toBe('Unknown status')
    language.value = 'th'
  })
})
