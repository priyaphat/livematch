import { describe, expect, it } from 'vitest'
import {
  buildHistoryExportData,
  buildMembersExportData,
  exportFilename,
  sanitizeFilenamePart
} from './excelExport'

describe('Excel export data', () => {
  it('keeps ExcelJS workbook generation compatible with dependency overrides', async () => {
    const ExcelJS = (await import('exceljs')).default
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('สมาชิก').addRow(['ชื่อ', 'เบอร์โทร'])
    const buffer = await workbook.xlsx.writeBuffer()
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(buffer)
    expect(reopened.getWorksheet('สมาชิก').getCell('A1').value).toBe('ชื่อ')
  })

  it('sanitizes unsafe filename characters and keeps Thai names', () => {
    expect(sanitizeFilenamePart(' สนาม / วันเสาร์:*? ')).toBe('สนาม-วันเสาร์')
    expect(exportFilename({
      session: { type: 'liveShare', name: 'สนาม / วันเสาร์' }
    }, 'members', new Date(2026, 5, 28))).toBe('liveShare-สนาม-วันเสาร์-members-2026-06-28.xlsx')
  })

  it('exports every active member independently of page and search state', () => {
    const state = {
      session: { type: 'liveMatch' },
      players: [
        { id: 1, name: 'หนึ่ง', level: 'light', games: 2, wins: 1, draws: 0, losses: 1, shuttles: 2, paid: true, active: true },
        { id: 2, name: 'สอง', level: 'middle', games: 1, wins: 0, draws: 1, losses: 0, shuttles: 1, paid: false, active: true },
        { id: 3, name: 'ซ่อน', level: 'heavy', games: 0, wins: 0, draws: 0, losses: 0, shuttles: 0, paid: false, active: false }
      ]
    }
    const data = buildMembersExportData({
      state,
      playerCost: (player) => player.id * 100,
      playerLiveShareHours: () => 0,
      levelLabel: (level) => level
    })

    expect(data.rows).toHaveLength(2)
    expect(data.rows.map((row) => row[1])).toEqual(['หนึ่ง', 'สอง'])
    expect(data.summary).toEqual([
      ['สมาชิกทั้งหมด', 2],
      ['ค่าใช้จ่ายรวม', 300],
      ['รับแล้ว', 100],
      ['ค้างชำระ', 200]
    ])
  })

  it('adds LiveShare hours and uses the existing hourly player cost', () => {
    const state = {
      session: { type: 'liveShare' },
      players: [
        { id: 7, name: 'ผู้เล่น', level: 'middle', games: 0, wins: 0, draws: 0, losses: 0, shuttles: 0, paid: false, active: true }
      ]
    }
    const data = buildMembersExportData({
      state,
      playerCost: () => 175,
      playerLiveShareHours: () => 3,
      levelLabel: (level) => level
    })

    expect(data.headers).toContain('ชั่วโมงเล่น')
    expect(data.rows[0][data.headers.indexOf('ชั่วโมงเล่น')]).toBe(3)
    expect(data.rows[0][data.headers.indexOf('ค่าใช้จ่าย (บาท)')]).toBe(175)
  })

  it('builds complete history columns and handles an empty history', () => {
    const empty = buildHistoryExportData({
      state: { history: [] },
      playerName: (id) => `p${id}`,
      matchLevelLabel: (level) => level
    })
    expect(empty.rows).toEqual([])
    expect(empty.emptyMessage).toBe('ไม่มีข้อมูลประวัติ')

    const data = buildHistoryExportData({
      state: {
        history: [
          {
            id: 2,
            court: '1',
            a1: 1,
            a2: 2,
            b1: 3,
            b2: 4,
            level: 'middle',
            startedAt: '10:00',
            endedAt: '10:30',
            shuttles: 2,
            status: 'finished',
            winner: 'A',
            shuttleSequence: '1,2',
            note: 'เกมทดสอบ'
          }
        ]
      },
      playerName: (id) => `p${id}`,
      matchLevelLabel: (level) => level
    })

    expect(data.headers).toEqual([
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
    ])
    expect(data.rows[0][12]).toBe('p1 + p2')
    expect(data.rows[0][13]).toBe('ลูกแบดทั่วไป #1, ลูกแบดทั่วไป #2')
  })
})
