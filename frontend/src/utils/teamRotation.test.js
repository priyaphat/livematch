import { describe, expect, it } from 'vitest'
import { arrangeTeamsByTeammateHistory } from './teamRotation.js'

describe('teammate rotation', () => {
  it('uses every partner combination before repeating for the same four players', () => {
    const ids = [1, 2, 3, 4]
    const history = []

    const first = arrangeTeamsByTeammateHistory(ids, [], history)
    expect(first).toEqual([1, 2, 3, 4])
    history.unshift({ a1: first[0], a2: first[1], b1: first[2], b2: first[3] })

    const second = arrangeTeamsByTeammateHistory(ids, [], history)
    expect(second).toEqual([1, 3, 2, 4])
    history.unshift({ a1: second[0], a2: second[1], b1: second[2], b2: second[3] })

    const third = arrangeTeamsByTeammateHistory(ids, [], history)
    expect(third).toEqual([1, 4, 2, 3])
  })

  it('keeps a fixed couple together even when they have played together before', () => {
    const result = arrangeTeamsByTeammateHistory(
      [1, 2, 3, 4],
      [{ a: 1, b: 2 }],
      [{ a1: 1, a2: 2, b1: 3, b2: 4 }]
    )
    expect(result.slice(0, 2).sort()).toEqual([1, 2])
  })

  it('prefers the least recently used pairing when repeat counts are equal', () => {
    const result = arrangeTeamsByTeammateHistory(
      [1, 2, 3, 4],
      [],
      [
        { a1: 1, a2: 4, b1: 2, b2: 3 },
        { a1: 1, a2: 3, b1: 2, b2: 4 },
        { a1: 1, a2: 2, b1: 3, b2: 4 }
      ]
    )
    expect(result).toEqual([1, 2, 3, 4])
  })
})
