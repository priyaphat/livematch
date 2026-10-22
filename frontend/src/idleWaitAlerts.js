import { waitMinutes } from './waitTime'

export function collectIdleWaitAlerts(state, now = Date.now()) {
  const playing = new Set((state.live || [])
    .flatMap((match) => [match.a1, match.a2, match.b1, match.b2])
    .map(Number)
    .filter((id) => id > 0))

  return (state.players || []).flatMap((player) => {
    if (!player.active || player.paid || player.withdrawn || !player.coupon || playing.has(Number(player.id))) return []
    const minutes = waitMinutes(player.waitStartedAt, now)
    if (minutes === null || minutes < 20) return []
    const threshold = 20 + Math.floor((minutes - 20) / 10) * 10
    return [{
      player,
      threshold,
      signature: `${player.waitStartedAt || ''}|${threshold}`
    }]
  })
}
