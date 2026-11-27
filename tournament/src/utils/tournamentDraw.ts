import { MatchRecord } from '../types/tournament';

export interface StandingPointsBreakdown {
  won: number;
  drawn: number;
  lost: number;
}

export function getStandingPointsSource(row: StandingPointsBreakdown): {
  total: number;
  compact: string;
  description: string;
} {
  const winPoints = row.won * 2;
  const drawPoints = row.drawn;
  const total = winPoints + drawPoints;

  return {
    total,
    compact: `${row.won}×2 + ${row.drawn}×1 + ${row.lost}×0`,
    description: `${row.won} ชนะ × 2 + ${row.drawn} เสมอ × 1 + ${row.lost} แพ้ × 0 = ${total} คะแนน`,
  };
}

export function getPointDifferenceSource(pointsFor: number, pointsAgainst: number): {
  difference: number;
  display: string;
  compact: string;
  description: string;
} {
  const difference = pointsFor - pointsAgainst;
  const display = `${difference >= 0 ? '+' : ''}${difference}`;

  return {
    difference,
    display,
    compact: `${pointsFor}-${pointsAgainst}`,
    description: `แต้มที่ทำได้ ${pointsFor} - แต้มที่เสีย ${pointsAgainst} = ${display}`,
  };
}

export function getPublishedRoundRobinSummary(
  teams: ReadonlyArray<{ groupName?: string }>
): {
  assignedTeams: number;
  unassignedTeams: number;
  groupCount: number;
  groupSizes: number[];
  expectedMatches: number;
} {
  const groups = new Map<string, number>();
  let unassignedTeams = 0;

  teams.forEach((team) => {
    const groupName = team.groupName?.trim();
    if (!groupName) {
      unassignedTeams += 1;
      return;
    }
    groups.set(groupName, (groups.get(groupName) || 0) + 1);
  });

  const groupSizes = Array.from(groups.values());
  return {
    assignedTeams: teams.length - unassignedTeams,
    unassignedTeams,
    groupCount: groupSizes.length,
    groupSizes,
    expectedMatches: groupSizes.reduce((sum, size) => sum + (size * (size - 1)) / 2, 0),
  };
}

export function countUniqueKnockoutEntrants(
  matches: MatchRecord[],
  registeredTeamIds: Iterable<string>
): number {
  const registered = new Set(registeredTeamIds);
  const entrants = new Set<string>();
  matches.forEach((match) => {
    if (registered.has(match.teamAId)) entrants.add(match.teamAId);
    if (registered.has(match.teamBId)) entrants.add(match.teamBId);
  });
  return entrants.size;
}
