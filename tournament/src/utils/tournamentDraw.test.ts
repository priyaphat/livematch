import { describe, expect, it } from 'vitest';
import { MatchRecord } from '../types/tournament';
import {
  countUniqueKnockoutEntrants,
  getPointDifferenceSource,
  getPublishedRoundRobinSummary,
  getStandingPointsSource,
} from './tournamentDraw';

const match = (teamAId: string, teamBId: string): MatchRecord => ({
  id: `${teamAId}-${teamBId}`,
  tournamentId: 't',
  matchCode: 'KO',
  divisionId: 'd',
  format: 'doubles',
  stage: 'SF',
  scheduledTime: '09:00',
  estimatedStart: '09:00',
  teamAId,
  teamAName: teamAId,
  teamAClub: '',
  teamAPlayers: [],
  teamBId,
  teamBName: teamBId,
  teamBClub: '',
  teamBPlayers: [],
  status: 'scheduled',
  callCount: 0,
  currentSet: 1,
  sets: [],
  servingTeam: 'A',
  servingPlayerIndex: 0,
  endsSwapped: false,
  locked: false,
  cards: [],
  timeoutsUsed: { A: 0, B: 0 },
  timeline: [],
});

describe('countUniqueKnockoutEntrants', () => {
  it('counts four real teams once across multiple rounds', () => {
    const matches = [
      match('team-1', 'team-4'),
      match('team-2', 'team-3'),
      match('team-1', 'tbd-final-b'),
      match('team-2', 'bye-1'),
    ];
    expect(
      countUniqueKnockoutEntrants(matches, ['team-1', 'team-2', 'team-3', 'team-4'])
    ).toBe(4);
  });
});

describe('getStandingPointsSource', () => {
  it('explains one point from one drawn match', () => {
    expect(getStandingPointsSource({ won: 0, drawn: 1, lost: 0 })).toEqual({
      total: 1,
      compact: '0×2 + 1×1 + 0×0',
      description: '0 ชนะ × 2 + 1 เสมอ × 1 + 0 แพ้ × 0 = 1 คะแนน',
    });
  });

  it('combines wins and draws while losses add no points', () => {
    const source = getStandingPointsSource({ won: 2, drawn: 1, lost: 3 });
    expect(source.total).toBe(5);
    expect(source.compact).toBe('2×2 + 1×1 + 3×0');
  });
});

describe('getPointDifferenceSource', () => {
  it('explains a positive point difference', () => {
    expect(getPointDifferenceSource(42, 40)).toEqual({
      difference: 2,
      display: '+2',
      compact: '42-40',
      description: 'แต้มที่ทำได้ 42 - แต้มที่เสีย 40 = +2',
    });
  });

  it('explains a negative point difference', () => {
    expect(getPointDifferenceSource(40, 42).display).toBe('-2');
  });
});

describe('getPublishedRoundRobinSummary', () => {
  it('uses the four published groups of three instead of recalculating from settings', () => {
    const teams = ['A', 'B', 'C', 'D'].flatMap((groupName) =>
      Array.from({ length: 3 }, () => ({ groupName }))
    );

    expect(getPublishedRoundRobinSummary(teams)).toEqual({
      assignedTeams: 12,
      unassignedTeams: 0,
      groupCount: 4,
      groupSizes: [3, 3, 3, 3],
      expectedMatches: 12,
    });
  });

  it('reports teams approved after publishing as unassigned', () => {
    const summary = getPublishedRoundRobinSummary([
      { groupName: 'กลุ่ม A' },
      { groupName: 'กลุ่ม A' },
      {},
    ]);
    expect(summary.expectedMatches).toBe(1);
    expect(summary.unassignedTeams).toBe(1);
  });
});
