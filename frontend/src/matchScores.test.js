import { describe, expect, it } from 'vitest'
import { emptyMatchScores, matchScoreSummary, validateMatchScores } from './matchScores.js'

describe('match score rules', () => {
  it('starts with two empty sets and allows manual result fallback', () => {
    expect(emptyMatchScores()).toEqual([{ a: '', b: '' }, { a: '', b: '' }])
    expect(validateMatchScores(emptyMatchScores())).toEqual({ scores: [], winner: '', error: '' })
  })

  it.each([
    [[{ a: 21, b: 18 }, { a: 21, b: 19 }], 'A'],
    [[{ a: 21, b: 18 }, { a: 17, b: 21 }], 'draw'],
    [[{ a: 21, b: 18 }, { a: 17, b: 21 }, { a: 21, b: 15 }], 'A'],
    [[{ a: 18, b: 21 }, { a: 21, b: 17 }, { a: 15, b: 21 }], 'B']
  ])('calculates the winner from set wins', (scores, winner) => {
    expect(validateMatchScores(scores)).toEqual({ scores, winner, error: '' })
  })

  it('rejects partial, tied, out-of-range, and invalid set counts', () => {
    expect(validateMatchScores([{ a: 21, b: '' }, { a: '', b: '' }]).error).toContain('ให้ครบ')
    expect(validateMatchScores([{ a: 21, b: 21 }, { a: 18, b: 21 }]).error).toContain('ห้ามเท่ากัน')
    expect(validateMatchScores([{ a: 100, b: 20 }, { a: 18, b: 21 }]).error).toContain('0–99')
    expect(validateMatchScores([{ a: 21, b: 18 }]).error).toContain('2 หรือ 3')
  })

  it('formats the number of sets won', () => {
    expect(matchScoreSummary([{ a: 21, b: 18 }, { a: 17, b: 21 }, { a: 21, b: 15 }])).toBe('2–1 เซต')
    expect(matchScoreSummary([])).toBe('-')
  })
})
