import { describe, expect, it } from 'vitest';
import {
  applyBadmintonPoint,
  applyManualServerPlayerSwap,
  applyManualTeamServeToggle,
  createSnapshotForUndo,
  getEffectiveTeamPlayers,
  getMatchOutcomeByRules,
  getServeLogDetail,
  getSinglesCourtPresentation,
  restoreSnapshotForUndo,
} from './badmintonRules';
import type { MatchRecord, ScoringRules } from '../types/tournament';

const twoSetRules = {
  bestOfSets: 2,
  pointsPerSet: 21,
  winByTwo: true,
  maxCapPoint: 30,
} as ScoringRules;

describe('getMatchOutcomeByRules', () => {
  it('returns draw for a 1-1 group result regardless of total points', () => {
    expect(
      getMatchOutcomeByRules(
        [
          { scoreA: 21, scoreB: 6, winner: 'A' },
          { scoreA: 19, scoreB: 21, winner: 'B' },
        ],
        twoSetRules,
        'group'
      )
    ).toBe('draw');
  });

  it('returns the winner for a 2-0 group result', () => {
    expect(
      getMatchOutcomeByRules(
        [
          { scoreA: 21, scoreB: 12, winner: 'A' },
          { scoreA: 21, scoreB: 18, winner: 'A' },
        ],
        twoSetRules,
        'group'
      )
    ).toBe('A');
  });

  it('requires a deciding set for a 1-1 knockout result', () => {
    expect(
      getMatchOutcomeByRules(
        [
          { scoreA: 21, scoreB: 12, winner: 'A' },
          { scoreA: 17, scoreB: 21, winner: 'B' },
        ],
        twoSetRules,
        'QF'
      )
    ).toBeNull();
  });

  it('returns the knockout winner after the deciding set', () => {
    expect(
      getMatchOutcomeByRules(
        [
          { scoreA: 21, scoreB: 12, winner: 'A' },
          { scoreA: 17, scoreB: 21, winner: 'B' },
          { scoreA: 21, scoreB: 18, winner: 'A' },
        ],
        twoSetRules,
        'QF'
      )
    ).toBe('A');
  });
});

describe('manual doubles service order', () => {
  it('keeps the manually selected server after that team wins the first rally', () => {
    const match = {
      status: 'live', currentSet: 1, servingTeam: 'A', servingPlayerIndex: 0,
      teamAPlayers: ['A1', 'A2'], teamBPlayers: ['B1', 'B2'],
      courtPositions: { A: [0, 1], B: [0, 1] },
      manualServerSwaps: { '1': { A: false, B: false } },
      sets: [{ setNumber: 1, scoreA: 0, scoreB: 0 }],
    } as unknown as MatchRecord;

    expect(applyManualServerPlayerSwap(match, 'A').ok).toBe(true);
    expect(match.servingPlayerIndex).toBe(1);
    applyBadmintonPoint(match, 'A');
    expect(match.servingPlayerIndex).toBe(1);
    expect(match.sets[0].scoreA).toBe(1);
  });

  it('moves service to the correct doubles player on service-over', () => {
    const match = {
      status: 'live', currentSet: 1, servingTeam: 'A', servingPlayerIndex: 0,
      teamAPlayers: ['A1', 'A2'], teamBPlayers: ['B1', 'B2'],
      courtPositions: { A: [0, 1], B: [0, 1] },
      sets: [{ setNumber: 1, scoreA: 1, scoreB: 0 }],
    } as unknown as MatchRecord;

    applyBadmintonPoint(match, 'B');
    expect(match.servingTeam).toBe('B');
    expect(match.servingPlayerIndex).toBe(1);
    expect(match.sets[0].scoreB).toBe(1);
  });
});

describe('singles service order', () => {
  it('always keeps the only player as server while service court follows score parity', () => {
    const match = {
      format: 'singles', status: 'live', currentSet: 1, servingTeam: 'A', servingPlayerIndex: 0,
      teamAPlayers: ['A1'], teamBPlayers: ['B1'],
      courtPositions: { A: [0, 1], B: [0, 1] },
      sets: [{ setNumber: 1, scoreA: 0, scoreB: 0 }],
    } as unknown as MatchRecord;

    expect(applyBadmintonPoint(match, 'A')).toMatchObject({ serviceBox: 'left', serverName: 'A1' });
    expect(match.servingPlayerIndex).toBe(0);
    expect(applyBadmintonPoint(match, 'B')).toMatchObject({ serviceBox: 'left', serverName: 'B1' });
    expect(match.servingPlayerIndex).toBe(0);
    expect(applyManualServerPlayerSwap(match, 'B')).toMatchObject({ ok: false });
  });

  it('keeps server and receiver marks on the same service box through rally changes and undo', () => {
    const match = {
      format: 'singles', status: 'live', currentSet: 1, servingTeam: 'A', servingPlayerIndex: 0,
      teamAName: 'Team A', teamBName: 'Team B',
      teamAPlayers: ['A1'], teamBPlayers: ['B1'],
      courtPositions: { A: [0, 1], B: [0, 1] },
      manualServerSwaps: { '1': { A: false, B: false } },
      sets: [{ setNumber: 1, scoreA: 0, scoreB: 0 }],
    } as unknown as MatchRecord;

    expect(getSinglesCourtPresentation(match, 'A')).toMatchObject({ role: 'server', boxLabel: 'ขวา · คู่' });
    expect(getSinglesCourtPresentation(match, 'B')).toMatchObject({ role: 'receiver', boxLabel: 'ขวา · คู่' });

    applyBadmintonPoint(match, 'A');
    expect(getSinglesCourtPresentation(match, 'A')).toMatchObject({ role: 'server', boxLabel: 'ซ้าย · คี่' });
    expect(getSinglesCourtPresentation(match, 'B')).toMatchObject({ role: 'receiver', boxLabel: 'ซ้าย · คี่' });

    applyBadmintonPoint(match, 'B');
    expect(getSinglesCourtPresentation(match, 'B')).toMatchObject({ role: 'server', boxLabel: 'ซ้าย · คี่' });
    expect(getServeLogDetail(match)).toContain('ผู้เสิร์ฟ: B1 (ทีม B · ซ้าย · คี่)');
    expect(getServeLogDetail(match)).toContain('ผู้รับ: A1 (ทีม A · ซ้าย · คี่)');

    applyBadmintonPoint(match, 'A');
    expect(getSinglesCourtPresentation(match, 'A')).toMatchObject({ role: 'server', boxLabel: 'ขวา · คู่' });
    const beforeManualToggle = createSnapshotForUndo(match);
    applyManualTeamServeToggle(match);
    expect(getSinglesCourtPresentation(match, 'B')).toMatchObject({ role: 'server', boxLabel: 'ซ้าย · คี่' });
    restoreSnapshotForUndo(match, beforeManualToggle);
    expect(getSinglesCourtPresentation(match, 'A')).toMatchObject({ role: 'server', boxLabel: 'ขวา · คู่' });
    expect(match.sets[0]).toMatchObject({ scoreA: 2, scoreB: 1 });
  });

  it('uses format as authority and ignores stale duplicate players in a singles payload', () => {
    const match = {
      format: 'singles', status: 'live', currentSet: 1, servingTeam: 'A', servingPlayerIndex: 1,
      teamAName: 'Team A', teamBName: 'Team B',
      teamAPlayers: ['A1', 'STALE A2'], teamBPlayers: ['B1', 'STALE B2'],
      courtPositions: { A: [1, 0], B: [1, 0] },
      sets: [{ setNumber: 1, scoreA: 0, scoreB: 0 }],
    } as unknown as MatchRecord;

    expect(getEffectiveTeamPlayers(match, 'A')).toEqual(['A1']);
    expect(getSinglesCourtPresentation(match, 'A').playerName).toBe('A1');
    expect(applyManualServerPlayerSwap(match, 'A')).toMatchObject({ ok: false });
    applyBadmintonPoint(match, 'A');
    expect(match.servingPlayerIndex).toBe(0);
    expect(getServeLogDetail(match)).not.toContain('STALE');
  });
});
