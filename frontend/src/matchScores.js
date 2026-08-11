export function emptyMatchScores(count = 2) {
  return Array.from({ length: count }, () => ({ a: '', b: '' }))
}

export function validateMatchScores(rows = []) {
  const values = Array.isArray(rows) ? rows : []
  const hasAnyScore = values.some((score) => (score?.a !== '' && score?.a != null) || (score?.b !== '' && score?.b != null))
  if (!hasAnyScore) return { scores: [], winner: '', error: '' }
  if (values.length !== 2 && values.length !== 3) return { scores: [], winner: '', error: 'คะแนนต้องมี 2 หรือ 3 เซต' }

  const scores = []
  let aWins = 0
  let bWins = 0
  for (let index = 0; index < values.length; index += 1) {
    const row = values[index] || {}
    if (row.a === '' || row.a == null || row.b === '' || row.b == null) {
      return { scores: [], winner: '', error: `กรุณากรอกคะแนนเซตที่ ${index + 1} ให้ครบ` }
    }
    const a = Number(row.a)
    const b = Number(row.b)
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || a > 99 || b < 0 || b > 99) {
      return { scores: [], winner: '', error: `คะแนนเซตที่ ${index + 1} ต้องเป็นจำนวนเต็ม 0–99` }
    }
    if (a === b) return { scores: [], winner: '', error: `คะแนนเซตที่ ${index + 1} ห้ามเท่ากัน` }
    scores.push({ a, b })
    if (a > b) aWins += 1
    else bWins += 1
  }
  return { scores, winner: aWins === bWins ? 'draw' : aWins > bWins ? 'A' : 'B', error: '' }
}

export function matchSetWins(scores = []) {
  return (scores || []).reduce((result, score) => {
    if (Number(score?.a) > Number(score?.b)) result.a += 1
    else if (Number(score?.b) > Number(score?.a)) result.b += 1
    return result
  }, { a: 0, b: 0 })
}

export function matchScoreSummary(scores = []) {
  if (!Array.isArray(scores) || !scores.length) return '-'
  const wins = matchSetWins(scores)
  return `${wins.a}–${wins.b} เซต`
}

export function matchScoreCell(scores = [], index) {
  const score = scores?.[index]
  return score ? `${score.a}–${score.b}` : '-'
}
