function teammateKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function keepsCouplesTogether(candidate, couples) {
  const teamByPlayer = new Map([
    [candidate[0], 0],
    [candidate[1], 0],
    [candidate[2], 1],
    [candidate[3], 1]
  ])
  return couples.every((couple) => {
    if (!teamByPlayer.has(couple.a) || !teamByPlayer.has(couple.b)) return true
    return teamByPlayer.get(couple.a) === teamByPlayer.get(couple.b)
  })
}

export function arrangeTeamsByTeammateHistory(ids, couples = [], history = []) {
  if (ids.length !== 4) return ids
  const candidates = [
    [ids[0], ids[1], ids[2], ids[3]],
    [ids[0], ids[2], ids[1], ids[3]],
    [ids[0], ids[3], ids[1], ids[2]]
  ]
  const counts = new Map()
  const recency = new Map()
  history.forEach((match, index) => {
    const weight = history.length - index
    for (const [a, b] of [[match.a1, match.a2], [match.b1, match.b2]]) {
      if (!a || !b || a === b) continue
      const key = teammateKey(a, b)
      counts.set(key, (counts.get(key) || 0) + 1)
      if (!recency.has(key)) recency.set(key, weight)
    }
  })

  let best = null
  let bestScore = null
  for (const candidate of candidates) {
    if (!keepsCouplesTogether(candidate, couples)) continue
    const first = teammateKey(candidate[0], candidate[1])
    const second = teammateKey(candidate[2], candidate[3])
    const firstCount = counts.get(first) || 0
    const secondCount = counts.get(second) || 0
    const score = [
      firstCount + secondCount,
      Math.max(firstCount, secondCount),
      (recency.get(first) || 0) + (recency.get(second) || 0)
    ]
    if (!bestScore || score.some((value, index) => value < bestScore[index] && score.slice(0, index).every((item, prior) => item === bestScore[prior]))) {
      best = candidate
      bestScore = score
    }
  }
  return best || ids
}
