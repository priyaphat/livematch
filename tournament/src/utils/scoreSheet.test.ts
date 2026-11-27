import { describe, expect, it } from 'vitest';
import { MatchTimelineEvent } from '../types/tournament';
import { buildScoreSheetRallies } from './scoreSheet';

const point = (
  id: string,
  type: 'point_A' | 'point_B',
  scoreSnapshot: string,
  scoreA: number,
  scoreB: number,
  servingTeam: 'A' | 'B',
  positions: { A: [0 | 1, 0 | 1]; B: [0 | 1, 0 | 1] } = { A: [0, 1], B: [0, 1] }
): MatchTimelineEvent => ({
  id,
  type,
  scoreSnapshot,
  setNumber: 1,
  timestamp: '10:00:00',
  actor: 'กรรมการ',
  undoSnapshot: {
    status: 'live',
    scoreA,
    scoreB,
    servingTeam,
    servingPlayerIndex: 0,
    courtPositions: positions,
    manualServerSwaps: {},
  },
});

describe('buildScoreSheetRallies', () => {
  it('prints rallies chronologically with the actual pre-rally server and receiver', () => {
    const latestFirst = [
      point('p2', 'point_B', '1 - 1', 1, 0, 'A'),
      point('p1', 'point_A', '1 - 0', 0, 0, 'A'),
    ];
    const rallies = buildScoreSheetRallies(latestFirst, 'doubles');
    expect(rallies.map((rally) => rally.winner)).toEqual(['A', 'B']);
    expect(rallies[0]).toMatchObject({ scoreA: 1, scoreB: 0, serverTeam: 'A', receiverTeam: 'B', serviceSide: 'ขวา' });
    expect(rallies[1]).toMatchObject({ scoreA: 1, scoreB: 1, serverTeam: 'A', receiverTeam: 'B', serviceSide: 'ซ้าย' });
  });

  it('removes an undone point from the printed score sheet', () => {
    const undo: MatchTimelineEvent = {
      id: 'undo', type: 'undo', scoreSnapshot: '1 - 0', setNumber: 1,
      timestamp: '10:01:00', actor: 'กรรมการ',
    };
    const latestFirst = [
      undo,
      point('p2', 'point_B', '1 - 1', 1, 0, 'A'),
      point('p1', 'point_A', '1 - 0', 0, 0, 'A'),
    ];
    expect(buildScoreSheetRallies(latestFirst, 'singles').map((rally) => rally.winner)).toEqual(['A']);
  });

  it('forces singles to player index zero even when stale positions contain player two', () => {
    const rallies = buildScoreSheetRallies([
      point('p1', 'point_A', '1 - 0', 0, 0, 'A', { A: [1, 0], B: [1, 0] }),
    ], 'singles');
    expect(rallies[0]).toMatchObject({ serverPlayerIndex: 0, receiverPlayerIndex: 0 });
  });
});
