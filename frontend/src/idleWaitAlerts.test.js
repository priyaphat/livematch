import { describe, expect, it } from 'vitest'
import { collectIdleWaitAlerts } from './idleWaitAlerts'

const now = Date.parse('2026-10-01T12:00:00.000Z')

function player(id, minutes, patch = {}) {
  return {
    id,
    name: `P${id}`,
    active: true,
    paid: false,
    coupon: true,
    waitStartedAt: new Date(now - minutes * 60_000).toISOString(),
    ...patch
  }
}

describe('collectIdleWaitAlerts', () => {
  it('alerts at 20 minutes and advances in ten-minute buckets', () => {
    expect(collectIdleWaitAlerts({ players: [player(1, 27)], live: [] }, now)[0].threshold).toBe(20)
    expect(collectIdleWaitAlerts({ players: [player(1, 30)], live: [] }, now)[0].threshold).toBe(30)
    expect(collectIdleWaitAlerts({ players: [player(1, 49)], live: [] }, now)[0].threshold).toBe(40)
  })

  it('includes pending or queued coupon holders but excludes ineligible and live players', () => {
    const state = {
      players: [
        player(1, 25),
        player(2, 25, { coupon: false }),
        player(3, 25, { paid: true }),
        player(4, 25, { active: false }),
        player(5, 25, { withdrawn: true }),
        player(6, 25)
      ],
      pending: [{ a1: 1 }],
      queue: [{ a1: 1 }],
      live: [{ a1: 6, a2: 0, b1: 0, b2: 0 }]
    }
    expect(collectIdleWaitAlerts(state, now).map((item) => item.player.id)).toEqual([1])
  })
})
