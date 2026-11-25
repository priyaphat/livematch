import { describe, expect, it } from 'vitest';
import { getMatchOutcomeByRules } from './badmintonRules';
import type { ScoringRules } from '../types/tournament';

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
