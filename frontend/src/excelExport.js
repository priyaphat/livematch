const COLORS = {
  court: 'FF15803D',
  courtLight: 'FFDCFCE7',
  paper: 'FFFFFBEB',
  stone: 'FF44403C',
  stoneLight: 'FFF5F5F4',
  white: 'FFFFFFFF'
}

function numeric(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function brandName(state, brandId) {
  return (state.settings?.shuttleBrands || []).find((brand) => brand.id === brandId)?.name || 'ลูกแบดทั่วไป'
}

function shuttleItems(match) {
  if (Array.isArray(match.shuttleSequenceItems) && match.shuttleSequenceItems.length) return match.shuttleSequenceItems
  return String(match.shuttleSequence || '').split(',').filter(Boolean).map((part) => ({ brandId: 'default', number: Number.parseInt(part, 10) }))
}

function shuttleSequenceText(state, match) {
  const items = shuttleItems(match).filter((item) => Number.isFinite(Number(item.number)))
  return items.length ? items.map((item) => `${brandName(state, item.brandId || 'default')} #${item.number}`).join(', ') : match.shuttleSequence || '-'
}

function shuttleSummaryText(state, match) {
  const counts = new Map()
  for (const item of shuttleItems(match)) {
    const id = item.brandId || 'default'
    counts.set(id, (counts.get(id) || 0) + 1)
  }
  return Array.from(counts.entries()).map(([id, count]) => `${brandName(state, id)} ${count}`).join(' · ')
}

function localDateStamp(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function sanitizeFilenamePart(value, fallback = 'session') {
  const sanitized = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[.-]+$/g, '')
  return sanitized || fallback
}

export function exportFilename(state, page, date = new Date()) {
  const type = sanitizeFilenamePart(state?.session?.type || 'liveMatch', 'liveMatch')
  const name = sanitizeFilenamePart(state?.session?.name, 'session')
  return `${type}-${name}-${sanitizeFilenamePart(page, 'export')}-${localDateStamp(date)}.xlsx`
}

export function buildMembersExportData({ state, playerCost, playerLiveShareHours, levelLabel }) {
  const isLiveShare = state.session?.type === 'liveShare'
  const headers = [
    'ID',
    'ชื่อ',
    'สมาชิกชมรม',
    'ระดับมือ',
    ...(isLiveShare ? ['ชั่วโมงเล่น'] : []),
    'จำนวนเกม',
    'ชนะ',
    'เสมอ',
    'แพ้',
    'ลูกแบด',
    'ค่าใช้จ่าย (บาท)',
    'สถานะชำระ'
  ]
  const players = (state.players || []).filter((player) => player.active)
  const rows = players.map((player) => [
    player.id,
    player.name,
    player.clubMember ? 'ใช่' : 'ไม่ใช่',
    levelLabel(player.level),
    ...(isLiveShare ? [numeric(playerLiveShareHours(player.id))] : []),
    numeric(player.games),
    numeric(player.wins),
    numeric(player.draws),
    numeric(player.losses),
    numeric(player.shuttles),
    numeric(playerCost(player)),
    player.paid ? 'จ่ายแล้ว' : 'ค้างชำระ'
  ])
  const total = players.reduce((sum, player) => sum + numeric(playerCost(player)), 0)
  const paid = players.filter((player) => player.paid).reduce((sum, player) => sum + numeric(playerCost(player)), 0)

  return {
    headers,
    rows,
    summary: [
      ['สมาชิกทั้งหมด', players.length],
      ['ค่าใช้จ่ายรวม', total],
      ['รับแล้ว', paid],
      ['ค้างชำระ', Math.max(0, total - paid)]
    ]
  }
}

function historyWinnerText(match, playerName) {
  if (match.status === 'cancelled') return 'ยกเลิก'
  if (match.winner === 'draw') return 'เสมอ'
  if (match.winner === 'A') return `${playerName(match.a1)} + ${playerName(match.a2)}`
  if (match.winner === 'B') return `${playerName(match.b1)} + ${playerName(match.b2)}`
  return '-'
}

export function buildHistoryExportData({ state, playerName, matchLevelLabel }) {
  const headers = [
    'เกมที่',
    'สนาม',
    'A1',
    'A2',
    'B1',
    'B2',
    'ระดับมือ',
    'เวลาเริ่ม',
    'เวลาจบ',
    'ลูกแบด',
    'สรุปยี่ห้อลูกแบด',
    'สถานะ',
    'ผู้ชนะ',
    'Shuttle sequence',
    'หมายเหตุ'
  ]
  const rows = [...(state.history || [])]
    .sort((a, b) => a.id - b.id)
    .map((match) => [
      match.id,
      match.court || '-',
      playerName(match.a1),
      playerName(match.a2),
      playerName(match.b1),
      playerName(match.b2),
      matchLevelLabel(match.level),
      match.startedAt || '-',
      match.endedAt || '-',
      numeric(match.shuttles),
      shuttleSummaryText(state, match),
      match.status === 'cancelled' ? 'ยกเลิก' : 'บันทึกผล',
      historyWinnerText(match, playerName),
      shuttleSequenceText(state, match),
      match.note || ''
    ])

  return { headers, rows, emptyMessage: 'ไม่มีข้อมูลประวัติ' }
}

export function buildDashboardExportData({
  state,
  activePlayerCount,
  totalRecordedMatches,
  cancelledMatches,
  averageGames,
  minGames,
  maxGames,
  totalShuttles,
  paymentPercent,
  totalRevenue,
  paidRevenue,
  unpaidRevenue,
  liveShareCourtHours,
  liveSharePlayerHours,
  liveShareCourtCost,
  liveShareShuttleCost,
  liveShareSessionCost,
  unpaidPlayers,
  topPlayers,
  quietPlayers,
  topWinners,
  playerCost,
  playerScore,
  levelLabel
}) {
  const isLiveShare = state.session?.type === 'liveShare'
  const summary = [
    ['สมาชิกที่ใช้งาน', numeric(activePlayerCount)],
    ['เกมรอคิว', (state.queue || []).length],
    ['กำลังแข่งขัน', (state.live || []).length],
    ['เกมที่บันทึก', numeric(totalRecordedMatches)],
    ['เกมในประวัติ', (state.history || []).length],
    ['เกมยกเลิก', (cancelledMatches || []).length],
    ['เฉลี่ยเกมต่อคน', numeric(averageGames)],
    ['เกมน้อยสุด', numeric(minGames)],
    ['เกมมากสุด', numeric(maxGames)],
    ['ลูกแบดใช้จริง', numeric(totalShuttles)],
    ['รายรับรวม', numeric(totalRevenue)],
    ['รับแล้ว', numeric(paidRevenue)],
    ['ค้างชำระ', numeric(unpaidRevenue)],
    ['ชำระแล้ว (%)', numeric(paymentPercent)]
  ]
  if (isLiveShare) {
    summary.splice(10, 0,
      ['ชั่วโมงสนามรวม', numeric(liveShareCourtHours)],
      ['ชั่วโมงผู้เล่นรวม', numeric(liveSharePlayerHours)],
      ['ค่าสนาม', numeric(liveShareCourtCost)],
      ['ค่าลูกแบด', numeric(liveShareShuttleCost)],
      ['ค่า session', numeric(liveShareSessionCost)]
    )
  }

  return {
    summary,
    unpaid: (unpaidPlayers || []).map((player) => [player.id, player.name, numeric(playerCost(player))]),
    topPlayers: (topPlayers || []).map((player, index) => [index + 1, player.name, numeric(player.games)]),
    quietPlayers: (quietPlayers || []).map((player, index) => [index + 1, player.name, levelLabel(player.level), numeric(player.games)]),
    topWinners: (topWinners || []).map((player, index) => [
      index + 1,
      player.name,
      numeric(player.wins),
      numeric(player.draws),
      numeric(player.losses),
      numeric(playerScore(player))
    ])
  }
}

function styleTitle(worksheet, title, columnCount) {
  const row = worksheet.addRow([title])
  worksheet.mergeCells(row.number, 1, row.number, columnCount)
  row.height = 28
  row.getCell(1).font = { bold: true, size: 16, color: { argb: COLORS.white } }
  row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.court } }
  row.getCell(1).alignment = { vertical: 'middle' }
}

function addSessionMeta(worksheet, state, columnCount) {
  worksheet.addRow(['Session', state.session?.name || '-'])
  worksheet.addRow(['ประเภท', state.session?.type || 'liveMatch'])
  worksheet.addRow(['รหัส Session', state.session?.id || '-'])
  worksheet.addRow(['วันที่ Export', new Date()])
  worksheet.getCell(`B${worksheet.rowCount}`).numFmt = 'yyyy-mm-dd hh:mm'
  for (let rowNumber = worksheet.rowCount - 3; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    worksheet.getCell(rowNumber, 1).font = { bold: true, color: { argb: COLORS.stone } }
  }
  worksheet.addRow([])
  worksheet.views = [{ state: 'frozen', ySplit: worksheet.rowCount }]
  worksheet.properties.defaultRowHeight = 20
  worksheet.pageSetup = { orientation: columnCount > 8 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
}

function addSectionHeader(worksheet, title, columnCount) {
  const row = worksheet.addRow([title])
  worksheet.mergeCells(row.number, 1, row.number, columnCount)
  row.getCell(1).font = { bold: true, color: { argb: COLORS.stone } }
  row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.courtLight } }
}

function addTable(worksheet, headers, rows, { currencyColumns = [], decimalColumns = [] } = {}) {
  const header = worksheet.addRow(headers)
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: COLORS.white } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.stone } }
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  for (const values of rows) {
    const row = worksheet.addRow(values)
    row.eachCell((cell, columnNumber) => {
      if (currencyColumns.includes(columnNumber)) cell.numFmt = '#,##0'
      if (decimalColumns.includes(columnNumber)) cell.numFmt = '#,##0.00'
      cell.alignment = { vertical: 'top', wrapText: true }
    })
  }
}

function finishWorksheet(worksheet) {
  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        bottom: { style: 'hair', color: { argb: 'FFD6D3D1' } }
      }
    })
  })
  worksheet.columns.forEach((column, index) => {
    let width = index === 0 ? 14 : 12
    column.eachCell({ includeEmpty: false }, (cell) => {
      const value = cell.value instanceof Date ? 16 : String(cell.value ?? '').length + 2
      width = Math.max(width, Math.min(value, 36))
    })
    column.width = width
  })
  worksheet.autoFilter = undefined
}

async function createWorkbook() {
  const module = await import('exceljs')
  const Workbook = module.Workbook || module.default?.Workbook
  const workbook = new Workbook()
  workbook.creator = 'LiveMatch'
  workbook.created = new Date()
  return workbook
}

async function saveWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function exportMembersExcel(options) {
  const data = buildMembersExportData(options)
  const workbook = await createWorkbook()
  const worksheet = workbook.addWorksheet('สมาชิก')
  styleTitle(worksheet, 'รายงานสมาชิก', data.headers.length)
  addSessionMeta(worksheet, options.state, data.headers.length)
  addTable(worksheet, data.headers, data.rows, { currencyColumns: [data.headers.indexOf('ค่าใช้จ่าย (บาท)') + 1] })
  worksheet.addRow([])
  addSectionHeader(worksheet, 'สรุปค่าใช้จ่าย', 2)
  addTable(worksheet, ['รายการ', 'จำนวน'], data.summary, { currencyColumns: [2] })
  finishWorksheet(worksheet)
  await saveWorkbook(workbook, exportFilename(options.state, 'members'))
}

export async function exportHistoryExcel(options) {
  const data = buildHistoryExportData(options)
  const workbook = await createWorkbook()
  const worksheet = workbook.addWorksheet('ประวัติ')
  styleTitle(worksheet, 'รายงานประวัติการแข่งขัน', data.headers.length)
  addSessionMeta(worksheet, options.state, data.headers.length)
  addTable(worksheet, data.headers, data.rows)
  if (!data.rows.length) {
    const row = worksheet.addRow([data.emptyMessage])
    worksheet.mergeCells(row.number, 1, row.number, data.headers.length)
    row.getCell(1).alignment = { horizontal: 'center' }
    row.getCell(1).font = { italic: true, color: { argb: COLORS.stone } }
  }
  finishWorksheet(worksheet)
  await saveWorkbook(workbook, exportFilename(options.state, 'history'))
}

export async function exportDashboardExcel(options) {
  const data = buildDashboardExportData(options)
  const workbook = await createWorkbook()
  const worksheet = workbook.addWorksheet('Dashboard')
  styleTitle(worksheet, 'รายงานภาพรวม Session', 6)
  addSessionMeta(worksheet, options.state, 6)

  addSectionHeader(worksheet, 'ภาพรวม', 2)
  addTable(worksheet, ['รายการ', 'จำนวน'], data.summary, {
    currencyColumns: [2],
    decimalColumns: [2]
  })
  worksheet.addRow([])

  addSectionHeader(worksheet, 'สมาชิกค้างชำระ', 3)
  addTable(worksheet, ['ID', 'ชื่อ', 'ยอดค้าง (บาท)'], data.unpaid, { currencyColumns: [3] })
  worksheet.addRow([])

  addSectionHeader(worksheet, 'ผู้ชนะมากที่สุด', 6)
  addTable(worksheet, ['อันดับ', 'ชื่อ', 'ชนะ', 'เสมอ', 'แพ้', 'คะแนน'], data.topWinners, { decimalColumns: [6] })
  worksheet.addRow([])

  addSectionHeader(worksheet, 'ลงเล่นมากที่สุด', 3)
  addTable(worksheet, ['อันดับ', 'ชื่อ', 'เกม'], data.topPlayers)
  worksheet.addRow([])

  addSectionHeader(worksheet, 'ควรได้ลงรอบถัดไป', 4)
  addTable(worksheet, ['อันดับ', 'ชื่อ', 'ระดับมือ', 'เกม'], data.quietPlayers)
  finishWorksheet(worksheet)
  await saveWorkbook(workbook, exportFilename(options.state, 'dashboard'))
}
