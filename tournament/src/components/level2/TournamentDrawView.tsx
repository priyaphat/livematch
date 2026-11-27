import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  Edit3,
  History,
  Lock,
  MapPin,
  Play,
  Printer,
  Share2,
  Shuffle,
  Sliders,
  Trophy,
  UserCheck,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { apiFetch } from '../../services/api';
import {
  DrawSystemType,
  GroupStandingRow,
  MatchFormatType,
  MatchRecord,
  MatchStage,
  PlayerRecord,
  Tournament,
} from '../../types/tournament';
import { KnockoutBracketCanvas } from '../common/KnockoutBracketCanvas';
import {
  countUniqueKnockoutEntrants,
  getPointDifferenceSource,
  getPublishedRoundRobinSummary,
  getStandingPointsSource,
} from '../../utils/tournamentDraw';
import { EmptyStateCard, PaginationBar, QRCodeMatrix, StatusIndicator, TeamLogoBadge, buildTeamLogoMap } from '../common/UIPrimitives';
import { formatThaiDateTime } from '../../utils/registration';
import { getMatchOutcomeByRules, getSetWinnerByRules } from '../../utils/badmintonRules';
import { buildScoreSheetRallies } from '../../utils/scoreSheet';

type DrawSubTab =
  | 'applicants'
  | 'generator'
  | 'rr_matches'
  | 'groups'
  | 'knockout'
  | 'umpires'
  | 'share';

const completedMatchStatuses = new Set<MatchRecord['status']>([
  'finished', 'walkover', 'retired', 'disqualified',
]);
const isCompletedMatch = (match: MatchRecord) => completedMatchStatuses.has(match.status);

const DRAW_SYSTEM_META: Record<DrawSystemType, { label: string; shortLabel: string; desc: string }> = {
  group_then_knockout: {
    label: 'รอบแบ่งกลุ่มพบกันหมด + Knockout',
    shortLabel: 'แบ่งกลุ่ม + Knockout',
    desc: 'แข่งแบบพบกันหมดในกลุ่มก่อน แล้วคัดทีมอันดับแรกเข้าสู่สาย Knockout',
  },
  round_robin: {
    label: 'พบกันหมดทั้งสาย (Round Robin)',
    shortLabel: 'พบกันหมดทั้งสาย',
    desc: 'ทุกทีมในรุ่นแข่งพบกันหมดทุกคู่ นับคะแนนและ Tie-break จัดอันดับรวม',
  },
  single_elimination: {
    label: 'แพ้คัดออก (Single Elimination)',
    shortLabel: 'Single Elimination',
    desc: 'จัดสายแบบแพ้คัดออกโดยตรงจากรายชื่อผู้สมัคร พร้อมจัดการ BYE อัตโนมัติ',
  },
  double_elimination: {
    label: 'แพ้สองครั้งคัดออก (Double Elimination)',
    shortLabel: 'Double Elimination',
    desc: 'จัดสายแบบแพ้สองครั้งคัดออก ส่งเข้าสาย Knockout ทันที',
  },
};

function estimateGroupSizes(totalTeams: number, drawSystem: DrawSystemType, teamsPerGroup: number): number[] {
  if (totalTeams <= 1) return [];
  if (drawSystem === 'round_robin') return [totalTeams];
  const groupCount = Math.max(1, Math.ceil(totalTeams / teamsPerGroup));
  const sizes = Array(groupCount).fill(0);
  for (let i = 0; i < totalTeams; i++) {
    sizes[i % groupCount] += 1;
  }
  return sizes;
}

function buildSeedSlotOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const nextSum = order.length * 2 + 1;
    const expanded: number[] = [];
    for (const s of order) {
      expanded.push(s);
      expanded.push(nextSum - s);
    }
    order = expanded;
  }
  return order;
}

function generateKnockoutMatchesFromTeams(
  seededTeams: {
    id: string;
    teamName: string;
    club: string;
    players: string[];
  }[],
  tournament: Tournament,
  divisionId: string,
  divisionCode: string,
  format: MatchFormatType
): MatchRecord[] {
  if (seededTeams.length < 2) return [];

  let bracketSize = 2;
  while (bracketSize < seededTeams.length) {
    bracketSize *= 2;
  }
  if (bracketSize > 64) bracketSize = 64;

  const stagesForSize: Record<number, MatchStage[]> = {
    2: ['F'],
    4: ['SF', 'F'],
    8: ['QF', 'SF', 'F'],
    16: ['R16', 'QF', 'SF', 'F'],
    32: ['R32', 'R16', 'QF', 'SF', 'F'],
    64: ['R64', 'R32', 'R16', 'QF', 'SF', 'F'],
  };
  const stages = stagesForSize[bracketSize] || ['QF', 'SF', 'F'];
  const stamp = Date.now();
  const roundMatchesMap = new Map<MatchStage, MatchRecord[]>();

  // First create empty shell matches from Final backwards or First round forwards so nextMatchId can link
  stages.forEach((stage, sIdx) => {
    const count = bracketSize / Math.pow(2, sIdx + 1);
    const list: MatchRecord[] = [];
    for (let i = 0; i < count; i++) {
      const codePrefix = divisionCode.split('-')[0] || divisionCode;
      list.push({
        id: `m-ko-${stamp}-${stage}-${i + 1}`,
        tournamentId: tournament.id,
        matchCode: `${codePrefix}-${stage}${i + 1}`,
        divisionId,
        format,
        stage,
        bracketOrder: i + 1,
        courtId: undefined,
        scheduledTime: sIdx === 0 ? '13:30' : sIdx === 1 ? '15:00' : '16:30',
        estimatedStart: sIdx === 0 ? '13:30' : sIdx === 1 ? '15:00' : '16:30',
        teamAId: `tbd-${stage}-${i + 1}-a`,
        teamAName: 'รอผลรอบก่อนหน้า',
        teamAClub: '-',
        teamAPlayers: [],
        teamBId: `tbd-${stage}-${i + 1}-b`,
        teamBName: 'รอผลรอบก่อนหน้า',
        teamBClub: '-',
        teamBPlayers: [],
        status: 'scheduled',
        callCount: 0,
        currentSet: 1,
        sets: [{ setNumber: 1, scoreA: 0, scoreB: 0 }],
        servingTeam: 'A',
        servingPlayerIndex: 0,
        endsSwapped: false,
        locked: false,
        cards: [],
        timeoutsUsed: { A: 0, B: 0 },
        timeline: [],
      });
    }
    roundMatchesMap.set(stage, list);
  });

  // Wire nextMatchId & nextMatchSlot
  for (let sIdx = 0; sIdx < stages.length - 1; sIdx++) {
    const curList = roundMatchesMap.get(stages[sIdx]) || [];
    const nextList = roundMatchesMap.get(stages[sIdx + 1]) || [];
    curList.forEach((m, idx) => {
      const target = nextList[Math.floor(idx / 2)];
      if (target) {
        m.nextMatchId = target.id;
        m.nextMatchSlot = idx % 2 === 0 ? 'A' : 'B';
        if (m.nextMatchSlot === 'A') {
          target.teamAName = `ผู้ชนะ ${m.matchCode}`;
        } else {
          target.teamBName = `ผู้ชนะ ${m.matchCode}`;
        }
      }
    });
  }

  // Fill first round with standard bracket seeding + BYE handling
  const firstStage = stages[0];
  const firstMatches = roundMatchesMap.get(firstStage) || [];
  const slotOrder = buildSeedSlotOrder(bracketSize);

  firstMatches.forEach((m, idx) => {
    const seedIdxA = slotOrder[idx * 2] - 1;
    const seedIdxB = slotOrder[idx * 2 + 1] - 1;
    const teamA = seededTeams[seedIdxA];
    const teamB = seededTeams[seedIdxB];

    if (teamA) {
      m.teamAId = teamA.id;
      m.teamAName = teamA.teamName;
      m.teamAClub = teamA.club;
      m.teamAPlayers = teamA.players;
    }

    if (teamB) {
      m.teamBId = teamB.id;
      m.teamBName = teamB.teamName;
      m.teamBClub = teamB.club;
      m.teamBPlayers = teamB.players;
    } else if (teamA) {
      m.teamBId = `bye-${idx + 1}`;
      m.teamBName = 'BYE';
      m.teamBClub = '-';
      m.teamBPlayers = [];
      m.isBye = true;
      m.status = 'walkover';
      m.winner = 'A';
      m.locked = true;
      m.sets = [];

      // Advance teamA to next match immediately
      if (m.nextMatchId && m.nextMatchSlot) {
        for (const list of roundMatchesMap.values()) {
          const target = list.find((nm) => nm.id === m.nextMatchId);
          if (target) {
            if (m.nextMatchSlot === 'A') {
              target.teamAId = teamA.id;
              target.teamAName = teamA.teamName;
              target.teamAClub = teamA.club;
              target.teamAPlayers = teamA.players;
            } else {
              target.teamBId = teamA.id;
              target.teamBName = teamA.teamName;
              target.teamBClub = teamA.club;
              target.teamBPlayers = teamA.players;
            }
          }
        }
      }
    }
  });

  const allKoMatches: MatchRecord[] = [];
  stages.forEach((st) => {
    allKoMatches.push(...(roundMatchesMap.get(st) || []));
  });
  return allKoMatches;
}

export const TournamentDrawView: React.FC<{ tournament: Tournament }> = ({ tournament }) => {
  const { state, refreshState, applyOptimisticMatch, hasPermission, notify, requestConfirm } = useApp();

  useEffect(() => {
    // Draw counts must always come from the current server snapshot. A missed
    // SSE event or a restored PWA tab must not keep an older partial bracket.
    void refreshState();
  }, [tournament.id, refreshState]);

  const enabledDivisions = useMemo(
    () => tournament.divisions.filter((d) => d.enabled),
    [tournament.divisions]
  );

  const [selectedDivId, setSelectedDivId] = useState<string>(
    enabledDivisions[0]?.id || ''
  );

  const activeDivision = useMemo(
    () => enabledDivisions.find((d) => d.id === selectedDivId) || enabledDivisions[0],
    [enabledDivisions, selectedDivId]
  );

  useEffect(() => {
    if (!enabledDivisions.some((division) => division.id === selectedDivId)) {
      setSelectedDivId(enabledDivisions[0]?.id || '');
    }
  }, [enabledDivisions, selectedDivId]);

  const effectiveFormat: MatchFormatType = useMemo(
    () => activeDivision?.formats[0] || 'doubles',
    [activeDivision]
  );

  const [subTab, setSubTab] = useState<DrawSubTab>('applicants');

  // Sync generator parameters with Tournament Settings
  const [drawSystem, setDrawSystem] = useState<DrawSystemType>(tournament.drawSystem);
  const [teamsPerGroup, setTeamsPerGroup] = useState(tournament.teamsPerGroup || 4);
  const [qualifiersPerGroup, setQualifiersPerGroup] = useState(tournament.qualifiersPerGroup || 2);
  const [separateClub, setSeparateClub] = useState(tournament.separateSameClub);

  useEffect(() => {
    setDrawSystem(tournament.drawSystem);
    setTeamsPerGroup(tournament.teamsPerGroup || 4);
    setQualifiersPerGroup(tournament.qualifiersPerGroup || 2);
    setSeparateClub(tournament.separateSameClub);
  }, [
    tournament.id,
    tournament.drawSystem,
    tournament.teamsPerGroup,
    tournament.qualifiersPerGroup,
    tournament.separateSameClub,
  ]);

  const [previewGroups, setPreviewGroups] = useState<{ groupName: string; teams: PlayerRecord[] }[] | null>(
    null
  );
  const [serverPreviewId, setServerPreviewId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [selectedTeam, setSelectedTeam] = useState<PlayerRecord | null>(null);

  // Match Detail / Score Modal
  const [selectedMatch, setSelectedMatch] = useState<MatchRecord | null>(null);
  const [overrideScores, setOverrideScores] = useState<{ a: number; b: number }[]>([]);
  const [overrideWinner, setOverrideWinner] = useState<'A' | 'B' | 'draw'>('A');
  const [overrideReason, setOverrideReason] = useState('');
  const [modalCourtId, setModalCourtId] = useState<string>('');
  const [modalUmpireId, setModalUmpireId] = useState<string>('');
  const [knockoutModeOpen, setKnockoutModeOpen] = useState(false);
  const [knockoutMode, setKnockoutMode] = useState<'combined' | 'split_rank_brackets'>('combined');
  const [includeThirdPlacePlayoff, setIncludeThirdPlacePlayoff] = useState(false);
  const [creatingKnockout, setCreatingKnockout] = useState(false);

  useEffect(() => {
    // A preview is scoped to one division/format. Keeping it while switching
    // division made Step 2 show teams from the previous division while Steps
    // 3-5 correctly showed the newly selected division.
    setPreviewGroups(null);
    setServerPreviewId(null);
    setPreviewLoading(false);
    setGroupFilter('all');
    setSelectedTeam(null);
    setSelectedMatch(null);
    setKnockoutModeOpen(false);
  }, [activeDivision?.id, effectiveFormat]);

  // Pagination states across Draw tabs
  const [applicantsPage, setApplicantsPage] = useState(1);
  const [applicantsPageSize, setApplicantsPageSize] = useState(10);
  const [rrPage, setRrPage] = useState(1);
  const [rrPageSize, setRrPageSize] = useState(10);
  const [groupsPage, setGroupsPage] = useState(1);
  const [groupsPageSize, setGroupsPageSize] = useState(6);
  const [umpireAssignPage, setUmpireAssignPage] = useState(1);
  const [umpireAssignPageSize, setUmpireAssignPageSize] = useState(10);
  const [revPage, setRevPage] = useState(1);
  const [revPageSize, setRevPageSize] = useState(5);

  const drawMeta = DRAW_SYSTEM_META[drawSystem] || DRAW_SYSTEM_META.group_then_knockout;
  const isKnockoutOnly =
    drawSystem === 'single_elimination' || drawSystem === 'double_elimination';
  const publicBracketUrl = typeof window === 'undefined'
    ? `/?mode=public&tournament=${encodeURIComponent(tournament.publicToken || tournament.id)}&tab=bracket&division=${encodeURIComponent(activeDivision?.id || '')}`
    : `${window.location.origin}/?mode=public&tournament=${encodeURIComponent(tournament.publicToken || tournament.id)}&tab=bracket&division=${encodeURIComponent(activeDivision?.id || '')}`;
  const publicEmbedCode = `<iframe src="${publicBracketUrl}&kiosk=1" width="100%" height="600" loading="lazy"></iframe>`;

  const divisionPlayers = useMemo(
    () =>
      state.players
        .filter(
          (p) =>
            p.tournamentId === tournament.id &&
            p.divisionId === activeDivision?.id &&
            p.format === effectiveFormat &&
            p.documentStatus === 'approved' &&
            !p.withdrawn &&
            !p.waitingList
        )
        .sort((a, b) => a.registrationCode.localeCompare(b.registrationCode)),
    [state.players, tournament.id, activeDivision?.id, effectiveFormat]
  );

  const divisionMatches = useMemo(
    () =>
      state.matches.filter(
        (m) =>
          m.tournamentId === tournament.id &&
          m.divisionId === activeDivision?.id &&
          m.format === effectiveFormat
      ),
    [state.matches, tournament.id, activeDivision?.id, effectiveFormat]
  );

  const groupMatches = useMemo(
    () => divisionMatches.filter((m) => m.stage === 'group'),
    [divisionMatches]
  );

  const koMatches = useMemo(
    () => divisionMatches.filter((m) => m.stage !== 'group'),
    [divisionMatches]
  );

  const knockoutEntrantCount = useMemo(() => {
    return countUniqueKnockoutEntrants(koMatches, divisionPlayers.map((team) => team.id));
  }, [divisionPlayers, koMatches]);

  const championshipMatches = useMemo(
    () => koMatches.filter((m) => m.placementBracket === 'championship'),
    [koMatches]
  );
  const thirdPlaceMatches = useMemo(
    () => koMatches.filter((m) => m.placementBracket === 'third_place'),
    [koMatches]
  );
  const hasSplitRankBrackets = championshipMatches.length > 0 || thirdPlaceMatches.length > 0;

  const tournamentUmpires = useMemo(
    () => state.umpires.filter((u) => u.tournamentId === tournament.id && u.active),
    [state.umpires, tournament.id]
  );

  const teamLogos = useMemo(() => buildTeamLogoMap(state.players), [state.players]);

  // Predicted round-robin matches from Settings & current teams
  const predictedGroupSizes = useMemo(
    () => estimateGroupSizes(divisionPlayers.length, drawSystem, teamsPerGroup),
    [divisionPlayers.length, drawSystem, teamsPerGroup]
  );

  const predictedRoundRobinMatches = useMemo(
    () => predictedGroupSizes.reduce((sum, n) => sum + (n * (n - 1)) / 2, 0),
    [predictedGroupSizes]
  );

  // Once a draw is published, validation must follow its persisted group assignments.
  // Recalculating from the current teamsPerGroup setting can turn 4x3 groups (12 matches)
  // into a false 3x4 expectation (18 matches) when settings change after publishing.
  const publishedRoundRobinSummary = useMemo(
    () => getPublishedRoundRobinSummary(divisionPlayers),
    [divisionPlayers]
  );
  const expectedPublishedRoundRobinMatches = publishedRoundRobinSummary.expectedMatches;

  useEffect(() => {
    if (
      (drawSystem === 'group_then_knockout' || drawSystem === 'round_robin') &&
      groupMatches.length > 0 &&
      groupMatches.length !== expectedPublishedRoundRobinMatches
    ) {
      void refreshState();
    }
  }, [drawSystem, groupMatches.length, expectedPublishedRoundRobinMatches, refreshState]);

  // Compute Group Standings with Tie-Break rules
  const groupStandings = useMemo(() => {
    const byGroup = new Map<string, GroupStandingRow[]>();

    divisionPlayers.forEach((p) => {
      const gName = p.groupName || 'กลุ่ม A';
      if (!byGroup.has(gName)) byGroup.set(gName, []);
      byGroup.get(gName)!.push({
        teamId: p.id,
        teamName: p.teamName,
        club: p.club,
        groupName: gName,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        standingPoints: 0,
        setsFor: 0,
        setsAgainst: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        rank: 1,
        qualified: false,
      });
    });

    groupMatches.forEach((m) => {
      if (!isCompletedMatch(m)) return;
      const gRows = byGroup.get(m.groupName || 'กลุ่ม A');
      if (!gRows) return;
      const rowA = gRows.find((r) => r.teamId === m.teamAId);
      const rowB = gRows.find((r) => r.teamId === m.teamBId);
      if (!rowA || !rowB) return;
      const outcome =
        m.winner || getMatchOutcomeByRules(m.sets, tournament.scoringRules, m.stage);

      rowA.played += 1;
      rowB.played += 1;
      if (outcome === 'A') {
        rowA.won += 1;
        rowB.lost += 1;
        rowA.standingPoints += 2;
      } else if (outcome === 'B') {
        rowB.won += 1;
        rowA.lost += 1;
        rowB.standingPoints += 2;
      } else if (outcome === 'draw') {
        rowA.drawn += 1;
        rowB.drawn += 1;
        rowA.standingPoints += 1;
        rowB.standingPoints += 1;
      }
      m.sets.forEach((s) => {
        rowA.pointsFor += s.scoreA;
        rowA.pointsAgainst += s.scoreB;
        rowB.pointsFor += s.scoreB;
        rowB.pointsAgainst += s.scoreA;
        const setWinner = s.winner || getSetWinnerByRules(s.scoreA, s.scoreB, tournament.scoringRules);
        if (setWinner === 'A') {
          rowA.setsFor += 1;
          rowB.setsAgainst += 1;
        } else if (setWinner === 'B') {
          rowB.setsFor += 1;
          rowA.setsAgainst += 1;
        }
      });
    });

    for (const [, rows] of byGroup) {
      rows.sort((a, b) => {
        if (b.standingPoints !== a.standingPoints) return b.standingPoints - a.standingPoints;
        for (const criterion of tournament.tieBreakOrder) {
          let comparison = 0;
          if (criterion === 'matches_won') comparison = b.won - a.won;
          if (criterion === 'set_diff') {
            comparison = (b.setsFor - b.setsAgainst) - (a.setsFor - a.setsAgainst);
          }
          if (criterion === 'point_diff') {
            comparison = (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst);
          }
          if (criterion === 'points_for') comparison = b.pointsFor - a.pointsFor;
          if (criterion === 'head_to_head') {
            const directMatch = groupMatches.find(
              (match) =>
                isCompletedMatch(match) &&
                ((match.teamAId === a.teamId && match.teamBId === b.teamId) ||
                  (match.teamAId === b.teamId && match.teamBId === a.teamId))
            );
            if (directMatch?.winner === 'A') {
              comparison = directMatch.teamAId === a.teamId ? -1 : 1;
            } else if (directMatch?.winner === 'B') {
              comparison = directMatch.teamBId === a.teamId ? -1 : 1;
            }
          }
          if (criterion === 'coin_toss') comparison = a.teamId.localeCompare(b.teamId);
          if (comparison !== 0) return comparison;
        }
        return a.teamName.localeCompare(b.teamName, 'th');
      });
      rows.forEach((r, idx) => {
        r.rank = idx + 1;
        const matchesInGroup = groupMatches.filter(
          (match) => (match.groupName || 'กลุ่ม A') === r.groupName
        );
        const expectedMatches = (rows.length * (rows.length - 1)) / 2;
        const groupCompleted =
          expectedMatches > 0 &&
          matchesInGroup.length === expectedMatches &&
          matchesInGroup.every(isCompletedMatch);
        r.qualified = groupCompleted && idx < qualifiersPerGroup;
      });
    }

    return Array.from(byGroup.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [groupMatches, divisionPlayers, qualifiersPerGroup, tournament.tieBreakOrder, tournament.scoringRules]);

  const groupNames = useMemo(() => {
    const names = new Set<string>();
    groupStandings.forEach(([g]) => names.add(g));
    groupMatches.forEach((m) => {
      if (m.groupName) names.add(m.groupName);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [groupStandings, groupMatches]);

  const filteredGroupMatches = useMemo(() => {
    if (groupFilter === 'all') return groupMatches;
    return groupMatches.filter((m) => (m.groupName || 'กลุ่ม A') === groupFilter);
  }, [groupMatches, groupFilter]);

  useEffect(() => {
    setApplicantsPage(1);
    setRrPage(1);
    setGroupsPage(1);
    setUmpireAssignPage(1);
  }, [tournament.id, activeDivision?.id]);

  useEffect(() => {
    setRrPage(1);
  }, [groupFilter]);

  const applicantsTotalPages = Math.max(1, Math.ceil(divisionPlayers.length / applicantsPageSize));
  const safeApplicantsPage = Math.min(Math.max(1, applicantsPage), applicantsTotalPages);
  const paginatedDivisionPlayers = useMemo(
    () =>
      divisionPlayers.slice(
        (safeApplicantsPage - 1) * applicantsPageSize,
        safeApplicantsPage * applicantsPageSize
      ),
    [divisionPlayers, safeApplicantsPage, applicantsPageSize]
  );

  const rrTotalPages = Math.max(1, Math.ceil(filteredGroupMatches.length / rrPageSize));
  const safeRrPage = Math.min(Math.max(1, rrPage), rrTotalPages);
  const paginatedGroupMatches = useMemo(
    () =>
      filteredGroupMatches.slice((safeRrPage - 1) * rrPageSize, safeRrPage * rrPageSize),
    [filteredGroupMatches, safeRrPage, rrPageSize]
  );

  const groupsTotalPages = Math.max(1, Math.ceil(groupStandings.length / groupsPageSize));
  const safeGroupsPage = Math.min(Math.max(1, groupsPage), groupsTotalPages);
  const paginatedGroupStandings = useMemo(
    () =>
      groupStandings.slice(
        (safeGroupsPage - 1) * groupsPageSize,
        safeGroupsPage * groupsPageSize
      ),
    [groupStandings, safeGroupsPage, groupsPageSize]
  );

  const umpireAssignTotalPages = Math.max(
    1,
    Math.ceil(koMatches.length / umpireAssignPageSize)
  );
  const safeUmpireAssignPage = Math.min(Math.max(1, umpireAssignPage), umpireAssignTotalPages);
  const paginatedKnockoutMatches = useMemo(
    () =>
      koMatches.slice(
        (safeUmpireAssignPage - 1) * umpireAssignPageSize,
        safeUmpireAssignPage * umpireAssignPageSize
      ),
    [koMatches, safeUmpireAssignPage, umpireAssignPageSize]
  );

  const revTotalPages = Math.max(1, Math.ceil(state.drawRevisions.length / revPageSize));
  const safeRevPage = Math.min(Math.max(1, revPage), revTotalPages);
  const paginatedRevisions = useMemo(
    () =>
      state.drawRevisions.slice((safeRevPage - 1) * revPageSize, safeRevPage * revPageSize),
    [state.drawRevisions, safeRevPage, revPageSize]
  );

  const groupMatchStats = useMemo(() => {
    const total = groupMatches.length;
    const finished = groupMatches.filter(isCompletedMatch).length;
    const live = groupMatches.filter((m) => m.status === 'live' || m.status === 'calling' || m.status === 'interval').length;
    const scheduled = Math.max(0, total - finished - live);
    const assignedUmpires = groupMatches.filter((m) => Boolean(m.umpireId)).length;
    const missingUmpires = groupMatches.filter((m) => !m.umpireId && !m.isBye && !isCompletedMatch(m)).length;
    return { total, finished, live, scheduled, assignedUmpires, missingUmpires };
  }, [groupMatches]);

  const printTournamentDocument = (kind: 'score_sheets' | 'court_schedule' | 'bracket') => {
    const escapeHtml = (value: unknown) => String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
    const divisionName = activeDivision?.nameTh || '';
    const generatedAt = new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short',
    }).format(new Date());
    const courtName = (courtId?: string) => tournament.courts.find((court) => court.id === courtId)?.name || courtId || 'ยังไม่กำหนด';

    let title = '';
    let content = '';
    if (kind === 'score_sheets') {
      title = `ใบบันทึกคะแนน · ${divisionName}`;
      const pointHeadings = Array.from({ length: 31 }, (_, point) => `<th>${point}</th>`).join('');
      content = divisionMatches.map((match) => {
        const setByNumber = new Map(match.sets.map((set) => [set.setNumber, set]));
        const scoreRallies = buildScoreSheetRallies(match.timeline || [], match.format);
        const playerCode = (team: 'A' | 'B', playerIndex: 0 | 1) => `${team}${playerIndex + 1}`;
        const teamPlayers = (players: string[]) =>
          players.length > 0
            ? players.map((player, index) => `<div>${index + 1}. ${escapeHtml(player)}</div>`).join('')
            : '<div class="blank-line">&nbsp;</div><div class="blank-line">&nbsp;</div>';
        const summaryRows = [1, 2, 3].map((setNo) => {
          const set = setByNumber.get(setNo);
          const setCompleted = set?.winner === 'A' || set?.winner === 'B';
          const winner = set?.winner === 'A' ? 'A' : set?.winner === 'B' ? 'B' : '';
          return `<tr><td>${setNo}</td><td>${setCompleted ? set.scoreA : ''}</td><td>${setCompleted ? set.scoreB : ''}</td><td>${winner}</td></tr>`;
        }).join('');
        const scoreSet = (setNo: number) => {
          const set = setByNumber.get(setNo);
          const setCompleted = set?.winner === 'A' || set?.winner === 'B';
          const setLabel = setNo === 3 ? 'เซต 3 (ตัดสิน)' : `เซต ${setNo}`;
          const setRallies = scoreRallies.filter((rally) => rally.setNumber === setNo);
          const pointCells = (team: 'A' | 'B') => Array.from({ length: 31 }, (_, ownScore) => {
            if (ownScore === 0) {
              return `<td class="point-cell start-cell"><span>เริ่ม</span></td>`;
            }
            const rally = setRallies.find((item) =>
              item.winner === team && (team === 'A' ? item.scoreA : item.scoreB) === ownScore
            );
            if (!rally) return '<td class="point-cell"></td>';
            const opponentScore = team === 'A' ? rally.scoreB : rally.scoreA;
            return `<td class="point-cell scored-point">
              <b>${opponentScore}</b>
              <span>#${rally.sequence} · ${team} ได้</span>
              <small>S ${playerCode(rally.serverTeam, rally.serverPlayerIndex)} › R ${playerCode(rally.receiverTeam, rally.receiverPlayerIndex)}</small>
              <em>${rally.serviceSide}</em>
            </td>`;
          }).join('');
          const firstRally = setRallies[0];
          const initialRole = (team: 'A' | 'B') => {
            if (!firstRally) return '';
            if (firstRally.serverTeam === team) return `S ${playerCode(team, firstRally.serverPlayerIndex)}`;
            return `R ${playerCode(team, firstRally.receiverPlayerIndex)}`;
          };
          return `<table class="score-grid" aria-label="${setLabel}">
            <thead>
              <tr><th class="set-label" rowspan="2">${setLabel}</th><th class="team-col" rowspan="2">ทีม</th><th class="role-col" rowspan="2">S/R</th><th class="point-title" colspan="31">ลำดับแต้ม (ทำเครื่องหมายทุกครั้งที่ได้แต้ม)</th><th class="final-col" rowspan="2">ผล</th></tr>
              <tr class="point-headings">${pointHeadings}</tr>
            </thead>
            <tbody>
              <tr><th class="team-letter">A</th><td class="role-box">${initialRole('A')}</td>${pointCells('A')}<td class="final-score">${setCompleted ? set.scoreA : ''}</td></tr>
              <tr class="team-b-row"><th class="team-letter">B</th><td class="role-box">${initialRole('B')}</td>${pointCells('B')}<td class="final-score">${setCompleted ? set.scoreB : ''}</td></tr>
            </tbody>
          </table>`;
        };
        return `
          <section class="score-sheet">
            <div class="sheet-heading">
              <div><div class="eyebrow">ใบบันทึกคะแนนการแข่งขันแบดมินตัน</div><h1>${escapeHtml(tournament.name)}</h1></div>
              <div class="sheet-code"><span>คู่ที่</span><strong>${escapeHtml(match.matchCode)}</strong></div>
            </div>
            <div class="score-meta">
              <div><span>ประเภท / ระดับมือ</span><b>${escapeHtml(divisionName)} · ${match.format === 'singles' ? 'เดี่ยว' : 'คู่'}</b></div>
              <div><span>รอบการแข่งขัน</span><b>${escapeHtml(match.groupName || match.stage)}</b></div>
              <div><span>วันที่ / เวลา</span><b>${escapeHtml(match.scheduledDate || '________________')} · ${escapeHtml(match.scheduledTime || match.estimatedStart || '________')}</b></div>
              <div><span>สนาม</span><b>${escapeHtml(courtName(match.courtId))}</b></div>
            </div>
            <div class="match-summary">
              <div class="team-box"><div class="team-tag">ทีม A</div><h2>${escapeHtml(match.teamAName || 'รอผู้ชนะ')}</h2><div class="player-list">${teamPlayers(match.teamAPlayers)}</div></div>
              <table class="set-summary"><thead><tr><th>เซต</th><th>A</th><th>B</th><th>ชนะ</th></tr></thead><tbody>${summaryRows}</tbody><tfoot><tr><th colspan="2">ผลแมตช์</th><td colspan="2">${match.winner === 'A' ? 'ทีม A ชนะ' : match.winner === 'B' ? 'ทีม B ชนะ' : match.winner === 'draw' ? 'เสมอ' : ''}</td></tr></tfoot></table>
              <div class="team-box"><div class="team-tag">ทีม B</div><h2>${escapeHtml(match.teamBName || 'รอผู้ชนะ')}</h2><div class="player-list">${teamPlayers(match.teamBPlayers)}</div></div>
              <div class="official-box">
                <div><span>ผู้ตัดสิน</span><b>${escapeHtml(match.umpireName || '________________________')}</b></div>
                <div><span>เวลาเริ่ม</span><b>${escapeHtml(match.actualStart || '________')}</b></div>
                <div><span>เวลาจบ</span><b>${escapeHtml(match.actualEnd || '________')}</b></div>
                <div><span>จำนวนลูกแบด</span><b>${match.shuttlesUsed ?? '______'} ลูก</b></div>
              </div>
            </div>
            <div class="score-legend">
              <b>วิธีอ่าน:</b> หัวคอลัมน์ = คะแนนของทีมในแถวนั้น · ตัวเลขใหญ่ในช่อง = คะแนนคู่แข่ง ณ ลูกนั้น · # = ลำดับลูก · A/B ได้ = ทีมที่ได้แต้ม · S/R = ผู้เสิร์ฟ/ผู้รับก่อนตีลูก
              ${scoreRallies.length === 0 ? '<strong> · แมตช์นี้ไม่มี Timeline รายลูก (เช่น บันทึกผ่าน Quick Score) จึงแสดงได้เฉพาะผลสรุป</strong>' : ''}
            </div>
            <div class="score-grids">${scoreSet(1)}${scoreSet(2)}${scoreSet(3)}</div>
            <div class="sheet-footer">
              <div class="notes"><b>เหตุการณ์ / หมายเหตุกรรมการ</b><span></span></div>
              <div class="sign-box"><span>ลงชื่อผู้ตัดสิน</span><b>________________________________</b></div>
              <div class="sign-box"><span>ลงชื่อผู้ควบคุมการแข่งขัน</span><b>________________________________</b></div>
            </div>
          </section>`;
      }).join('') || '<p>ยังไม่มีคู่แข่งขันในระดับมือนี้</p>';
    } else if (kind === 'court_schedule') {
      title = `ตารางการใช้สนาม · ${divisionName}`;
      const sorted = [...divisionMatches].sort((a, b) => `${a.scheduledDate || ''} ${a.scheduledTime || a.estimatedStart || ''}`.localeCompare(`${b.scheduledDate || ''} ${b.scheduledTime || b.estimatedStart || ''}`));
      content = `<table><thead><tr><th>วัน/เวลา</th><th>สนาม</th><th>คู่ที่</th><th>ทีม A</th><th>ทีม B</th><th>กรรมการ</th><th>สถานะ</th></tr></thead><tbody>${sorted.map((match) => `<tr><td>${escapeHtml(match.scheduledDate || '')} ${escapeHtml(match.scheduledTime || match.estimatedStart || '')}</td><td>${escapeHtml(courtName(match.courtId))}</td><td>${escapeHtml(match.matchCode)}</td><td>${escapeHtml(match.teamAName)}</td><td>${escapeHtml(match.teamBName)}</td><td>${escapeHtml(match.umpireName || '—')}</td><td>${escapeHtml(match.status)}</td></tr>`).join('')}</tbody></table>`;
    } else {
      title = `สายการแข่งขัน · ${divisionName}`;
      const stageOrder = ['group', 'R64', 'R32', 'R16', 'QF', 'SF', 'F', 'P3', 'LB1', 'GF', 'GF_RESET'];
      const stages = [...new Set(divisionMatches.map((match) => match.stage))].sort((a, b) => stageOrder.indexOf(a) - stageOrder.indexOf(b));
      content = stages.map((stage) => `<section class="stage"><h2>${escapeHtml(stage === 'group' ? 'รอบแบ่งกลุ่ม' : stage)}</h2>${divisionMatches.filter((match) => match.stage === stage).map((match) => `<div class="bracket-match"><strong>${escapeHtml(match.matchCode)}</strong><span>${escapeHtml(match.teamAName)}</span><b>${escapeHtml(match.sets.map((set) => `${set.scoreA}-${set.scoreB}`).join(' · ') || '—')}</b><span>${escapeHtml(match.teamBName)}</span></div>`).join('')}</section>`).join('') || '<p>ยังไม่มีสายการแข่งขัน</p>';
    }

    const pageSize = kind === 'score_sheets' ? 'A4 landscape' : 'A4';
    const documentHeader = kind === 'score_sheets' ? '' : `<header class="document-header"><div><h1>${escapeHtml(tournament.name)}</h1><p>${escapeHtml(title)}</p></div><div>พิมพ์เมื่อ ${escapeHtml(generatedAt)}<br>เวลา Asia/Bangkok</div></header>`;
    const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
      @page{size:${pageSize};margin:8mm}*{box-sizing:border-box}body{font-family:Arial,'Sarabun',sans-serif;color:#111;margin:0;font-size:12px}.document-header{border-bottom:2px solid #156143;padding-bottom:8px;margin-bottom:14px;display:flex;justify-content:space-between;gap:16px}h1{font-size:20px;margin:0}h2{font-size:15px;margin:4px 0}p{margin:4px 0}table{width:100%;border-collapse:collapse;margin:8px 0 16px}th,td{border:1px solid #777;padding:7px;text-align:left}th{background:#eef7f2}.stage{break-inside:avoid;margin-bottom:18px}.bracket-match{display:grid;grid-template-columns:70px 1fr 100px 1fr;border:1px solid #777;margin:5px 0;padding:8px;gap:8px;align-items:center}.bracket-match b{text-align:center}
      .score-sheet{break-after:page;page-break-after:always;min-height:190mm;padding:2mm}.score-sheet:last-child{break-after:auto;page-break-after:auto}.sheet-heading{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:5px}.sheet-heading h1{font-size:18px}.eyebrow{font-size:10px;font-weight:700;letter-spacing:.08em}.sheet-code{display:flex;align-items:center;gap:8px;border:2px solid #111;padding:5px 10px}.sheet-code strong{font-size:15px}.score-meta{display:grid;grid-template-columns:1.5fr 1fr 1.35fr .8fr;border:1px solid #222;border-top:0}.score-meta>div{padding:5px 7px;border-right:1px solid #777}.score-meta>div:last-child{border-right:0}.score-meta span,.official-box span,.sign-box span{display:block;font-size:8px;color:#444;margin-bottom:2px}.score-meta b{font-size:10px}.match-summary{display:grid;grid-template-columns:1.25fr .8fr 1.25fr 1fr;gap:6px;margin-top:7px;align-items:stretch}.team-box,.official-box{border:1.5px solid #222;padding:6px;min-height:75px}.team-box{position:relative;text-align:center}.team-tag{position:absolute;top:0;left:0;background:#111;color:#fff;padding:3px 8px;font-weight:700}.team-box h2{font-size:14px;margin:0 0 4px;padding-left:35px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.player-list{font-size:9px;line-height:1.5;border-top:1px solid #aaa;padding-top:3px}.blank-line{border-bottom:1px dotted #999}.official-box{display:grid;grid-template-columns:1fr 1fr;gap:4px 8px}.official-box b{font-size:9px}.set-summary{margin:0;font-size:9px}.set-summary th,.set-summary td{padding:2px 4px;text-align:center;height:15px}.set-summary tfoot th,.set-summary tfoot td{font-size:8px}.score-legend{margin-top:6px;border:1px solid #999;background:#f6f6f6;padding:3px 6px;font-size:6.5px}.score-legend strong{color:#a33}.score-grids{margin-top:4px}.score-grid{table-layout:fixed;margin:0 0 5px;font-size:7px}.score-grid th,.score-grid td{padding:0;text-align:center;border:1px solid #555}.score-grid .set-label{width:52px;font-size:8px;background:#e7eee9}.score-grid .team-col{width:27px}.score-grid .role-col{width:29px}.score-grid .final-col{width:28px;background:#e7eee9}.score-grid .point-title{height:13px;font-size:7px;letter-spacing:.03em}.score-grid .point-headings th{height:11px;font-size:6px;font-weight:400;background:#fafafa}.score-grid tbody th,.score-grid tbody td{height:30px}.score-grid .team-letter{font-size:10px;background:#fff}.score-grid .role-box{background:#fff;font-size:6px;font-weight:700}.score-grid .point-cell{background:#fff;overflow:hidden;line-height:1}.score-grid .team-b-row .point-cell,.score-grid .team-b-row .role-box{background:#e4e4e4}.score-grid .point-cell span,.score-grid .point-cell small,.score-grid .point-cell em{display:block;white-space:nowrap;font-size:4.5px;font-style:normal}.score-grid .point-cell b{display:block;font-size:7px}.score-grid .scored-point{box-shadow:inset 0 0 0 1px #111}.score-grid .start-cell span{font-size:5px;color:#666}.score-grid .final-score{font-size:12px;font-weight:700;background:#fff}.sheet-footer{display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:8px;margin-top:6px}.notes,.sign-box{border:1px solid #555;min-height:28px;padding:4px 6px}.notes b{font-size:8px}.notes span{display:block;border-bottom:1px dotted #777;margin-top:8px}.sign-box{text-align:center}.sign-box b{display:block;font-size:9px;margin-top:7px}@media print{button{display:none}.score-sheet{break-inside:avoid}}
    </style></head><body>${documentHeader}${content}<script>window.addEventListener('load',()=>window.print())<\/script></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const printWindow = window.open(url, '_blank');
    if (!printWindow) {
      URL.revokeObjectURL(url);
      notify('error', 'เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up แล้วลองใหม่');
      return;
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  // Seeded list of qualified teams ordered cross-group (A1, B1, ..., B2, A2...) so Step 4 Knockout pairs opposite groups
  const qualifiedSeededTeams = useMemo(() => {
    const ordered: {
      id: string;
      teamName: string;
      club: string;
      players: string[];
      groupName: string;
      rank: number;
    }[] = [];

    for (let rank = 1; rank <= qualifiersPerGroup; rank++) {
      const tierGroups = rank % 2 === 1 ? [...groupStandings] : [...groupStandings].reverse();
      tierGroups.forEach(([gName, rows]) => {
        const row = rows[rank - 1];
        if (!row?.qualified) return;
        const pl = divisionPlayers.find((p) => p.id === row.teamId);
        const players = pl?.partnerName
          ? [`${pl.firstName} ${pl.lastName}`, pl.partnerName]
          : pl
          ? [`${pl.firstName} ${pl.lastName}`]
          : [row.teamName];
        ordered.push({
          id: row.teamId,
          teamName: row.teamName,
          club: row.club,
          players,
          groupName: gName,
          rank,
        });
      });
    }
    return ordered;
  }, [groupStandings, qualifiersPerGroup, divisionPlayers]);

  const rankOneTeams = useMemo(
    () => qualifiedSeededTeams.filter((team) => team.rank === 1),
    [qualifiedSeededTeams]
  );
  const rankTwoTeams = useMemo(
    () => qualifiedSeededTeams.filter((team) => team.rank === 2),
    [qualifiedSeededTeams]
  );

  // Draw Preview / Random Generator (Before vs After)
  const buildRandomGroups = async () => {
    if (divisionPlayers.length === 0 || !activeDivision) return;
    setPreviewLoading(true);
    try {
      const preview = await apiFetch<{
        previewId: string;
        groups: { groupName: string; teams: PlayerRecord[] }[];
        warnings?: string[];
      }>('/api/draw/preview', {
        method: 'POST',
        body: JSON.stringify({
          tournamentId: tournament.id,
          divisionId: activeDivision.id,
          format: effectiveFormat,
          drawSystem,
          teamsPerGroup,
          qualifiersPerGroup,
          separateClub,
        }),
      });
      setPreviewGroups(preview.groups);
      setServerPreviewId(preview.previewId);
      if (preview.warnings?.length) notify('warning', preview.warnings.join(' · '));
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'สร้างตัวอย่างสายไม่สำเร็จ');
    } finally {
      setPreviewLoading(false);
    }
  };

  const previewRoundRobinMatches = useMemo(() => {
    if (!previewGroups) return 0;
    return previewGroups.reduce((sum, g) => sum + (g.teams.length * (g.teams.length - 1)) / 2, 0);
  }, [previewGroups]);

  const handlePublishDraw = () => {
    if (!previewGroups || !activeDivision) return;

    if (serverPreviewId) {
      requestConfirm({
        title: `เผยแพร่สาย ${activeDivision.nameTh}?`,
        description: `ยืนยันผล Preview จาก backend และสร้างสาย ${drawMeta.label}`,
        confirmLabel: 'ยืนยัน Publish',
        impactLines: [
          `ทีมทั้งหมด ${divisionPlayers.length} ทีม`,
          `ระบบแข่งขัน ${drawMeta.label}`,
          `บันทึกเป็น Revision v${tournament.bracketVersion + 1}`,
        ],
        onConfirm: async () => {
          await apiFetch('/api/draw/publish', {
            method: 'POST',
            body: JSON.stringify({ previewId: serverPreviewId, lockAfterPublish: tournament.bracketLocked }),
          });
          await refreshState();
          setPreviewGroups(null);
          setServerPreviewId(null);
          setSubTab(isKnockoutOnly ? 'knockout' : 'rr_matches');
          notify('success', `เผยแพร่สาย v${tournament.bracketVersion + 1} เรียบร้อย`);
        },
      });
      return;
    }

    setPreviewGroups(null);
    setServerPreviewId(null);
    notify('warning', 'Preview หมดอายุ กรุณากดสุ่มสายใหม่ก่อน Publish');
  };

  // Umpire & optional Court assignment
  const handleAssignUmpire = async (matchId: string, umpireId: string) => {
    try {
      const response = await apiFetch<{ match: MatchRecord }>(`/api/matches/${matchId}`, {
        method: 'PATCH',
        body: JSON.stringify({ umpireId }),
      });
      applyOptimisticMatch(response.match);
      notify('success', umpireId ? 'มอบหมายกรรมการสำเร็จ' : 'ยกเลิกการเลือกกรรมการแล้ว');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'ไม่สามารถมอบหมายกรรมการได้');
    }
  };

  const handleAssignCourt = async (matchId: string, courtId: string) => {
    try {
      const response = await apiFetch<{ match: MatchRecord }>(`/api/matches/${matchId}`, {
        method: 'PATCH',
        body: JSON.stringify({ courtId }),
      });
      applyOptimisticMatch(response.match);
      notify('success', courtId ? 'กำหนดสนามแข่งขันแล้ว' : 'เปลี่ยนเป็นไม่ระบุสนามแล้ว');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'ไม่สามารถกำหนดสนามได้');
    }
  };

  const handleRandomUmpires = async (targetList: MatchRecord[] = divisionMatches) => {
    const eligibleMatches = targetList.filter(
      (m) => (m.status === 'scheduled' || m.status === 'calling') && !m.umpireId && !m.isBye
    );
    if (eligibleMatches.length === 0) {
      notify('info', 'ทุกคู่ที่รอแข่งขันมีกรรมการแล้ว');
      return;
    }
    let assigned = 0;
    for (let idx = 0; idx < eligibleMatches.length; idx++) {
      const m = eligibleMatches[idx];
      const candidates = tournamentUmpires.filter(
        (u) =>
          u.clubAffiliation !== m.teamAClub &&
          u.clubAffiliation !== m.teamBClub
      );
      const validUmpire = candidates[idx % Math.max(1, candidates.length)];
      if (validUmpire) {
        try {
          await apiFetch(`/api/matches/${m.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ umpireId: validUmpire.id }),
          });
          assigned += 1;
        } catch {
          // skip conflict
        }
      }
    }
    await refreshState();
    notify('success', `สุ่มมอบหมายกรรมการอัตโนมัติ ${assigned} คู่ (ข้ามคู่ที่สังกัดสโมสรเดียวกัน)`);
  };

  // Advance from Step 3 (Round Robin) -> Step 4 (Knockout Bracket)
  const handleAdvanceToKnockout = () => {
    if (!activeDivision) return;
    if (qualifiedSeededTeams.length < 2) {
      notify('error', 'ต้องมีทีมผ่านเข้ารอบอย่างน้อย 2 ทีมจึงจะสร้างสาย Knockout ได้');
      return;
    }

    if (publishedRoundRobinSummary.unassignedTeams > 0) {
      notify('error', `มี ${publishedRoundRobinSummary.unassignedTeams} ทีมที่ยังไม่อยู่ในกลุ่ม กรุณา Publish สายใหม่ก่อนสร้าง Knockout`);
      return;
    }
    if (groupMatchStats.total !== expectedPublishedRoundRobinMatches) {
      const difference = Math.abs(expectedPublishedRoundRobinMatches - groupMatchStats.total);
      notify('error', `สายรอบแบ่งกลุ่มไม่ครบ จำนวนแมตช์ต่างจากสายที่ Publish ${difference} คู่ (พบ ${groupMatchStats.total}/${expectedPublishedRoundRobinMatches} คู่) กรุณา Publish สายใหม่ก่อนสร้าง Knockout`);
      return;
    }
    const unfinishedCount = groupMatchStats.total - groupMatchStats.finished;
    if (unfinishedCount > 0) {
      notify('error', `ยังมีแมตช์รอบแบ่งกลุ่มค้างอยู่ ${unfinishedCount} คู่ ต้องบันทึกผลให้ครบก่อนสร้างสาย Knockout`);
      return;
    }

    setKnockoutMode('combined');
    setIncludeThirdPlacePlayoff(false);
    setKnockoutModeOpen(true);
  };

  const createKnockout = async () => {
    if (!activeDivision || creatingKnockout) return;
    if (knockoutMode === 'split_rank_brackets' && (rankOneTeams.length < 2 || rankTwoTeams.length < 2)) {
      notify('error', 'การแยกสายต้องมีอย่างน้อย 2 กลุ่ม และกำหนดให้เข้ารอบอย่างน้อยกลุ่มละ 2 ทีม');
      return;
    }
    setCreatingKnockout(true);
    try {
      const result = await apiFetch<{ matchCount: number; mode: string }>('/api/draw/advance-knockout', {
        method: 'POST',
        body: JSON.stringify({
          tournamentId: tournament.id,
          divisionId: activeDivision.id,
          format: effectiveFormat,
          mode: knockoutMode,
          teamIds: qualifiedSeededTeams.map((team) => team.id),
          rankOneTeamIds: rankOneTeams.map((team) => team.id),
          rankTwoTeamIds: rankTwoTeams.map((team) => team.id),
          qualifiersPerGroup,
          thirdPlacePlayoff: knockoutMode === 'combined' && includeThirdPlacePlayoff,
        }),
      });
      await refreshState();
      setKnockoutModeOpen(false);
      setSubTab('knockout');
      notify(
        'success',
        knockoutMode === 'split_rank_brackets'
          ? `สร้าง 2 สายแล้ว ${result.matchCount} คู่: สายชิงอันดับ 1–2 และสายชิงอันดับ 3–4`
          : `สร้างสาย Knockout รวม ${result.matchCount} คู่${includeThirdPlacePlayoff ? ' พร้อมคู่ชิงอันดับ 3–4' : ''} และเข้าสู่ขั้นตอนที่ 5 แล้ว`
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'สร้างสาย Knockout ไม่สำเร็จ');
    } finally {
      setCreatingKnockout(false);
    }
  };

  const openMatchModal = (m: MatchRecord) => {
    setSelectedMatch(m);
    setOverrideScores(
      m.sets.length > 0
        ? m.sets.map((s) => ({ a: s.scoreA, b: s.scoreB }))
        : [{ a: 0, b: 0 }, { a: 0, b: 0 }]
    );
    setOverrideWinner(m.winner || 'A');
    setOverrideReason('');
    setModalCourtId(m.courtId || '');
    setModalUmpireId(m.umpireId || '');
  };

  const handleSaveQuickScore = async (targetStatus: 'live' | 'finished') => {
    if (!selectedMatch) return;
    try {
      const sets = overrideScores.map((s, idx) => ({
        setNumber: idx + 1,
        scoreA: s.a,
        scoreB: s.b,
        winner: getSetWinnerByRules(s.a, s.b, tournament.scoringRules) || undefined,
      }));
      const computedWinner =
        getMatchOutcomeByRules(sets, tournament.scoringRules, selectedMatch.stage) || overrideWinner;

      await apiFetch(`/api/matches/${selectedMatch.id}/quick-score`, {
        method: 'POST',
        body: JSON.stringify({
          sets,
          winner: computedWinner,
          status: targetStatus,
          courtId: modalCourtId,
          umpireId: modalUmpireId,
        }),
      });
      await refreshState();
      setSelectedMatch(null);
      notify(
        'success',
        targetStatus === 'live'
          ? `เริ่มการแข่งขันคู่ ${selectedMatch.matchCode} แล้ว`
          : `บันทึกผลคู่ ${selectedMatch.matchCode} และอัปเดตตารางคะแนนแล้ว`
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'บันทึกผลไม่สำเร็จ');
    }
  };

  const handleSaveOverride = async () => {
    if (!selectedMatch) return;
    if (overrideReason.trim().length < 3) {
      notify('error', 'กรุณาระบุเหตุผลการแก้ไขคะแนนอย่างน้อย 3 ตัวอักษร');
      return;
    }
    try {
      const sets = overrideScores.map((s, idx) => ({
        setNumber: idx + 1,
        scoreA: s.a,
        scoreB: s.b,
        winner: getSetWinnerByRules(s.a, s.b, tournament.scoringRules) || undefined,
      }));
      await apiFetch(`/api/matches/${selectedMatch.id}/override`, {
        method: 'POST',
        body: JSON.stringify({
          sets,
          winner:
            getMatchOutcomeByRules(sets, tournament.scoringRules, selectedMatch.stage) || overrideWinner,
          status: 'finished',
          reason: overrideReason.trim(),
        }),
      });
      await refreshState();
      setSelectedMatch(null);
      notify('success', `บันทึกการแก้ไขผล ${selectedMatch.matchCode} พร้อม Audit Log แล้ว`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'แก้ไขคะแนนไม่สำเร็จ');
    }
  };

  const getMatchStatusBadge = (m: MatchRecord) => {
    if (m.status === 'live') return <StatusIndicator tone="live" label="กำลังแข่ง" compact />;
    if (m.status === 'calling') return <StatusIndicator tone="warning" label="เรียกตัว" compact />;
    if (m.status === 'interval') return <StatusIndicator tone="warning" label="พักครึ่ง" compact />;
    if (m.status === 'finished') return <StatusIndicator tone="success" label="จบแล้ว" compact />;
    if (m.status === 'walkover') return <StatusIndicator tone="warning" label={m.isBye ? 'BYE' : 'ชนะบาย'} compact />;
    if (m.status === 'retired') return <StatusIndicator tone="warning" label="ถอนตัวระหว่างแข่ง" compact />;
    if (m.status === 'disqualified') return <StatusIndicator tone="danger" label="ตัดสิทธิ์" compact />;
    return <StatusIndicator tone="neutral" label="รอแข่งขัน" compact />;
  };

  const canEditModalScores =
    selectedMatch &&
    ((!selectedMatch.locked && hasPermission('scoreMatch')) || hasPermission('overrideLockedResult'));
  const overrideIsDraw = Boolean(
    selectedMatch &&
      getMatchOutcomeByRules(
        overrideScores.map((score, index) => ({
          setNumber: index + 1,
          scoreA: score.a,
          scoreB: score.b,
          winner: getSetWinnerByRules(score.a, score.b, tournament.scoringRules) || undefined,
        })),
        tournament.scoringRules,
        selectedMatch.stage
      ) === 'draw'
  );

  const hasApplicants = divisionPlayers.length >= 2;
  const canDrawBracket = hasPermission('drawBracket');
  const hasGroupDraw = groupMatches.length > 0;
  const allGroupFinished =
    expectedPublishedRoundRobinMatches > 0 &&
    publishedRoundRobinSummary.unassignedTeams === 0 &&
    groupMatches.length === expectedPublishedRoundRobinMatches &&
    groupMatches.every(isCompletedMatch);
  const hasAnyDraw = divisionMatches.length > 0;
  const hasKoDraw = koMatches.length > 0;
  const allKoFinished =
    koMatches.length > 0 &&
    koMatches.every(isCompletedMatch);

  const timelineSteps = useMemo(() => {
    const step3Disabled = isKnockoutOnly || !hasGroupDraw;
    const step4Disabled = isKnockoutOnly || !hasGroupDraw;
    const step5Disabled =
      drawSystem === 'group_then_knockout'
        ? !allGroupFinished
        : isKnockoutOnly
        ? !hasKoDraw
        : !hasKoDraw && !allGroupFinished;

    return [
      {
        id: 'applicants' as const,
        stepNum: 1,
        label: 'รายชื่อ & No.',
        statusText: `${divisionPlayers.length} ทีม`,
        completed: hasApplicants,
        disabled: false,
        disabledReason: '',
      },
      {
        id: 'generator' as const,
        stepNum: 2,
        label: 'สร้าง / สุ่มสาย',
        statusText: hasAnyDraw ? `สร้างแล้ว ${divisionMatches.length} คู่` : 'รอสุ่มสาย',
        completed: hasAnyDraw,
        disabled: !hasApplicants,
        disabledReason: 'ต้องมีทีมสมัครอย่างน้อย 2 ทีม',
      },
      {
        id: 'rr_matches' as const,
        stepNum: 3,
        label: 'แมตช์วนแข่ง',
        statusText: isKnockoutOnly
          ? 'ไม่มีรอบแบ่งกลุ่ม'
          : hasGroupDraw
          ? `${groupMatchStats.finished}/${groupMatchStats.total} คู่`
          : 'รอขั้นที่ 2',
        completed: !isKnockoutOnly && allGroupFinished,
        disabled: step3Disabled,
        disabledReason: isKnockoutOnly ? 'ระบบนี้ไม่มีรอบแบ่งกลุ่ม' : 'กรุณาสร้างสายในขั้นที่ 2 ก่อน',
      },
      {
        id: 'groups' as const,
        stepNum: 4,
        label: 'ตารางคะแนน',
        statusText: isKnockoutOnly
          ? 'ไม่มีรอบแบ่งกลุ่ม'
          : hasGroupDraw
          ? `${groupStandings.length} กลุ่ม`
          : 'รอขั้นที่ 2',
        completed: !isKnockoutOnly && allGroupFinished,
        disabled: step4Disabled,
        disabledReason: isKnockoutOnly ? 'ระบบนี้ไม่มีรอบแบ่งกลุ่ม' : 'กรุณาสร้างสายในขั้นที่ 2 ก่อน',
      },
      {
        id: 'knockout' as const,
        stepNum: 5,
        label: 'สาย Knockout',
        statusText:
          drawSystem === 'group_then_knockout' && !allGroupFinished
            ? `รอรอบวนแข่ง (${groupMatchStats.finished}/${groupMatchStats.total})`
            : hasKoDraw
            ? `${koMatches.length} คู่`
            : 'พร้อมสร้างสาย',
        completed: allKoFinished,
        disabled: step5Disabled,
        disabledReason:
          drawSystem === 'group_then_knockout'
            ? hasGroupDraw
              ? `รอแข่งรอบวนแข่งให้ครบ (เหลือ ${groupMatchStats.total - groupMatchStats.finished} คู่)`
              : 'กรุณาสร้างสายในขั้นที่ 2 ก่อน'
            : 'กรุณาสร้างสายในขั้นที่ 2 ก่อน',
      },
      {
        id: 'umpires' as const,
        stepNum: 6,
        label: 'กรรมการ Knockout',
        statusText: hasKoDraw ? `${koMatches.filter((m) => m.umpireId).length}/${koMatches.length} คู่` : 'รอขั้นที่ 5',
        completed: hasKoDraw && koMatches.every((m) => Boolean(m.umpireId) || Boolean(m.isBye)),
        disabled: !hasKoDraw,
        disabledReason: 'กรุณาสร้างสาย Knockout ในขั้นที่ 5 ก่อน',
      },
      {
        id: 'share' as const,
        stepNum: 7,
        label: 'แชร์ & พิมพ์',
        statusText: hasAnyDraw ? 'พร้อมแชร์' : 'รอสร้างสาย',
        completed: false,
        disabled: !hasAnyDraw,
        disabledReason: 'กรุณาสร้างสายในขั้นที่ 2 ก่อน',
      },
    ];
  }, [
    isKnockoutOnly,
    hasGroupDraw,
    hasKoDraw,
    hasAnyDraw,
    hasApplicants,
    allGroupFinished,
    allKoFinished,
    drawSystem,
    divisionPlayers.length,
    divisionMatches,
    groupMatchStats.finished,
    groupMatchStats.total,
    groupStandings.length,
    koMatches.length,
  ]);

  useEffect(() => {
    const cur = timelineSteps.find((s) => s.id === subTab);
    if (cur?.disabled) {
      const fallback = timelineSteps.find((s) => !s.disabled)?.id || 'applicants';
      setSubTab(fallback);
    }
  }, [timelineSteps, subTab]);

  return (
    <div className="space-y-5">
      {/* Division Selector Tabs (Horizontal Scrollbar when divisions list is long) */}
      <div className="space-y-2.5">
        <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-2.5 border-b border-[#E2DFD5] dark:border-[#25354C] [scrollbar-width:thin]">
          {enabledDivisions.map((div) => (
            <button
              key={div.id}
              onClick={() => {
                setSelectedDivId(div.id);
                setPreviewGroups(null);
                setGroupFilter('all');
              }}
              className={`min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-2 ${
                activeDivision?.id === div.id
                  ? 'bg-[#142642] text-white'
                  : 'bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] text-[#141D2B] dark:text-[#F3F5F8] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]'
              }`}
            >
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: div.color }}
                aria-hidden="true"
              />
              <span>{div.nameTh}</span>
            </button>
          ))}
        </div>

        {/* Active Setting Summary (Doubles/Singles toggle removed as format follows Division Settings) */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#525C6B] dark:text-[#9AA8BC]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-1 rounded bg-[#F7F6F2] dark:bg-[#1B293D] border border-[#E2DFD5] dark:border-[#25354C] font-medium text-[#141D2B] dark:text-[#F3F5F8]">
              ประเภท: {effectiveFormat === 'singles' ? 'เดี่ยว (Singles)' : 'คู่ (Doubles)'}
            </span>
            <span className="px-2.5 py-1 rounded bg-[#F7F6F2] dark:bg-[#1B293D] border border-[#E2DFD5] dark:border-[#25354C] font-medium text-[#141D2B] dark:text-[#F3F5F8]">
              ตั้งค่า: {drawMeta.shortLabel}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span>ทีมสมัคร: {divisionPlayers.length}</span>
            <span aria-hidden="true">·</span>
            <span>วนแข่ง: {groupMatches.length} แมตช์</span>
            <span aria-hidden="true">·</span>
            <span>สาย v{tournament.bracketVersion}</span>
            {tournament.bracketLocked && (
              <StatusIndicator tone="info" label="ล็อกสายแล้ว" compact />
            )}
          </div>
        </div>
      </div>

      {/* Sequential Workflow Timeline */}
      <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-3 overflow-x-auto [scrollbar-width:thin]">
        <ol className="flex items-start min-w-[780px] gap-1">
          {timelineSteps.map((step, idx) => {
            const isActive = subTab === step.id;
            const isLocked = step.disabled;
            const isDone = step.completed && !isActive && !isLocked;
            return (
              <li key={step.id} className="flex-1 flex items-start min-w-0">
                <button
                  type="button"
                  disabled={isLocked}
                  title={isLocked ? step.disabledReason : step.label}
                  onClick={() => setSubTab(step.id)}
                  className={`w-full group flex flex-col items-center text-center px-1.5 py-1 rounded-lg transition-colors ${
                    isLocked
                      ? 'opacity-45 cursor-not-allowed'
                      : isActive
                      ? 'bg-[#ECFDF3] dark:bg-[#0E2E1D]/60'
                      : 'hover:bg-[#F7F6F2] dark:hover:bg-[#1B293D]'
                  }`}
                >
                  <div className="w-full flex items-center justify-center relative">
                    {idx > 0 && (
                      <div
                        className={`hidden sm:block absolute right-1/2 left-0 top-1/2 -translate-y-1/2 h-0.5 mr-4 ${
                          timelineSteps[idx - 1].completed
                            ? 'bg-[#156143] dark:bg-[#229A6B]'
                            : 'bg-[#E2DFD5] dark:bg-[#25354C]'
                        }`}
                      />
                    )}
                    {idx < timelineSteps.length - 1 && (
                      <div
                        className={`hidden sm:block absolute left-1/2 right-0 top-1/2 -translate-y-1/2 h-0.5 ml-4 ${
                          step.completed
                            ? 'bg-[#156143] dark:bg-[#229A6B]'
                            : 'bg-[#E2DFD5] dark:bg-[#25354C]'
                        }`}
                      />
                    )}
                    <span
                      className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                        isLocked
                          ? 'bg-[#F7F6F2] dark:bg-[#0B121C] border-[#D9D5C9] dark:border-[#2C3E57] text-[#525C6B]'
                          : isActive
                          ? 'bg-[#156143] border-[#156143] text-white shadow-sm'
                          : isDone
                          ? 'bg-[#ECFDF3] dark:bg-[#0E2E1D] border-[#156143] dark:border-[#229A6B] text-[#156143] dark:text-[#4ADE80]'
                          : 'bg-white dark:bg-[#131E2E] border-[#C9C4B5] dark:border-[#344966] text-[#141D2B] dark:text-[#F3F5F8]'
                      }`}
                    >
                      {isLocked ? (
                        <Lock className="w-3.5 h-3.5" />
                      ) : isDone ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        step.stepNum
                      )}
                    </span>
                  </div>
                  <div
                    className={`mt-1.5 text-[11px] font-bold leading-tight truncate max-w-full ${
                      isActive
                        ? 'text-[#156143] dark:text-[#4ADE80]'
                        : 'text-[#141D2B] dark:text-[#F3F5F8]'
                    }`}
                  >
                    {step.label}
                  </div>
                  <div className="text-[10px] text-[#525C6B] dark:text-[#9AA8BC] truncate max-w-full">
                    {step.statusText}
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* 1. Applicants */}
      {subTab === 'applicants' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] overflow-hidden">
            <div className="p-4 border-b border-[#E2DFD5] dark:border-[#25354C] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold">
                  รายชื่อผู้สมัคร — {activeDivision?.nameTh}
                </h3>
                <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                  แสดงทุกทีมและรายชื่อนักกีฬา ตรวจสอบรายละเอียดทีมก่อนสุ่มสายในขั้นตอนที่ 2
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const csv = [
                      'No,Code,Team,Players,Club,CheckIn',
                      ...divisionPlayers.map(
                        (p, index) =>
                          `${index + 1},${p.registrationCode},"${p.teamName}","${(p.members || []).map((member) => `${member.firstName} ${member.lastName}`).join(' / ') || `${p.firstName} ${p.lastName}${p.partnerName ? ` / ${p.partnerName}` : ''}`}","${p.club}",${p.checkedIn}`
                      ),
                    ].join('\n');
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${activeDivision?.code || 'players'}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    notify('success', 'ส่งออกรายชื่อ CSV แล้ว');
                  }}
                  className="min-h-[38px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] text-xs font-medium inline-flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
                <button
                  onClick={() => setSubTab('generator')}
                  className="min-h-[38px] px-3.5 rounded-lg bg-[#156143] text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <span>ไปสุ่มสาย (ขั้นตอนที่ 2)</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {divisionPlayers.length === 0 ? (
              <div className="p-6">
                <EmptyStateCard
                  title="ยังไม่มีผู้สมัครในรุ่นนี้"
                  description="สามารถรับสมัครนักกีฬาได้จากหน้า สมาชิก & กรรมการ หรือหน้าลงทะเบียนออนไลน์"
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-[#F7F6F2] dark:bg-[#0B121C] border-b border-[#E2DFD5] dark:border-[#25354C] text-[#525C6B] dark:text-[#9AA8BC]">
                      <th className="py-3 px-4">No.</th>
                      <th className="py-3 px-4">ทีม / นักกีฬา</th>
                      <th className="py-3 px-4">สโมสร</th>
                      <th className="py-3 px-4">Check-in</th>
                      <th className="py-3 px-4 text-right">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2DFD5] dark:divide-[#25354C]">
                    {paginatedDivisionPlayers.map((p, pageIndex) => (
                      <tr key={p.id}>
                        <td className="py-3 px-4 font-mono font-bold">
                          {(safeApplicantsPage - 1) * applicantsPageSize + pageIndex + 1}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-sm flex items-center gap-2">
                            <TeamLogoBadge teamName={p.teamName} logoUrl={p.teamLogoUrl} size="xs" />
                            <span>{p.teamName}</span>
                          </div>
                          <div className="mt-1 space-y-0.5 text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
                            {(p.members?.length ? p.members : [{ firstName: p.firstName, lastName: p.lastName, nickname: p.nickname }, ...(p.partnerName ? [{ firstName: p.partnerName, lastName: '', nickname: p.partnerNickname }] : [])]).map((member, memberIndex) => (
                              <div key={`${p.id}-member-${memberIndex}`}>{memberIndex + 1}. {member.firstName} {member.lastName}{member.nickname ? ` (${member.nickname})` : ''}</div>
                            ))}
                          </div>
                          {p.possibleDuplicateOf && (
                            <div className="mt-1 inline-flex items-center gap-1 text-[#92400E] dark:text-[#FACC15]">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>พบผู้เล่นลงแข่งหลายประเภท (ตรวจเวลาซ้อน)</span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">{p.club}</td>
                        <td className="py-3 px-4">
                          <StatusIndicator
                            tone={p.checkedIn ? 'success' : 'neutral'}
                            label={p.checkedIn ? `เช็คอิน ${formatThaiDateTime(p.checkInTime)}` : 'ยังไม่เช็คอิน'}
                            compact
                          />
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button type="button" onClick={() => setSelectedTeam(p)} className="min-h-[34px] rounded-lg border border-[#E2DFD5] px-3 font-semibold dark:border-[#25354C]">
                            ดูข้อมูลทีม
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <PaginationBar
            page={safeApplicantsPage}
            pageSize={applicantsPageSize}
            totalItems={divisionPlayers.length}
            onPageChange={setApplicantsPage}
            onPageSizeChange={setApplicantsPageSize}
          />
        </div>
      )}

      {/* 2. Draw Generator (Synced with Settings + Match Count Forecast + Before & After Preview) */}
      {subTab === 'generator' && (
        <div className="space-y-5">
          {/* Active Settings Banner */}
          <div className="rounded-xl border border-[#156143]/30 dark:border-[#229A6B]/30 bg-[#ECFDF3]/50 dark:bg-[#0E2E1D]/30 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-[#156143] dark:text-[#4ADE80]">
                <Sliders className="w-4 h-4" />
                <span>รูปแบบการแข่งขันสำหรับการสุ่มครั้งนี้: {drawMeta.label}</span>
              </div>
              <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">{drawMeta.desc}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <div className="px-3.5 py-2 rounded-lg bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] text-xs">
                <div className="text-[#525C6B] dark:text-[#9AA8BC]">ทีมสมัครรุ่นนี้</div>
                <div className="text-base font-bold font-mono">{divisionPlayers.length} ทีม</div>
              </div>
              {!isKnockoutOnly ? (
                <div className="px-3.5 py-2 rounded-lg bg-white dark:bg-[#131E2E] border border-[#156143]/40 dark:border-[#229A6B]/40 text-xs">
                  <div className="text-[#525C6B] dark:text-[#9AA8BC]">คาดการณ์แมตช์วนแข่งทั้งหมด</div>
                  <div className="text-base font-bold font-mono text-[#156143] dark:text-[#4ADE80]">
                    {predictedRoundRobinMatches} แมตช์ ({predictedGroupSizes.length} กลุ่ม)
                  </div>
                </div>
              ) : (
                <div className="px-3.5 py-2 rounded-lg bg-white dark:bg-[#131E2E] border border-[#156143]/40 dark:border-[#229A6B]/40 text-xs">
                  <div className="text-[#525C6B] dark:text-[#9AA8BC]">สายแพ้คัดออกโดยตรง</div>
                  <div className="text-base font-bold font-mono text-[#156143] dark:text-[#4ADE80]">
                    {Math.max(0, divisionPlayers.length - 1)} คู่หลัก + BYE
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold">เครื่องมือจัดสายและสุ่มแบ่งกลุ่ม (Draw Generator)</h3>
                <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                  กด “สุ่มสาย (Preview)” เพื่อตรวจสอบจำนวนกลุ่มและจำนวนแมตช์วนแข่งทั้งหมด ก่อน Publish ไปขั้นตอนที่ 3
                </p>
              </div>
              {tournament.bracketLocked && (
                <StatusIndicator tone="info" label="สายปัจจุบันถูกล็อก (แก้ไขผ่าน Revision)" />
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">รูปแบบการแข่งขันหลัก</label>
                <select
                  value={drawSystem}
                  onChange={(event) => {
                    setDrawSystem(event.target.value as DrawSystemType);
                    setPreviewGroups(null);
                    setServerPreviewId(null);
                  }}
                  className="w-full min-h-[42px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-sm"
                >
                  <option value="group_then_knockout">แบ่งกลุ่มพบกันหมด + Knockout</option>
                  <option value="round_robin">พบกันหมดทั้งรุ่น</option>
                  <option value="single_elimination">แพ้คัดออก</option>
                  <option value="double_elimination">แพ้สองครั้งคัดออก</option>
                </select>
              </div>
              {drawSystem === 'group_then_knockout' && (
                <div>
                  <label className="block text-xs font-medium mb-1">จำนวนทีมต่อสาย (กลุ่ม)</label>
                  <select
                    value={teamsPerGroup}
                    onChange={(e) => setTeamsPerGroup(Number(e.target.value))}
                    className="w-full min-h-[42px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-sm"
                  >
                    {[3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n} ทีม / สาย
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {!isKnockoutOnly && (
                <div>
                  <label className="block text-xs font-medium mb-1">ทีมผ่านเข้ารอบต่อสาย</label>
                  <select
                    value={qualifiersPerGroup}
                    onChange={(e) => setQualifiersPerGroup(Number(e.target.value))}
                    className="w-full min-h-[42px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-sm"
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n} อันดับแรก
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <label className="flex items-center gap-2 text-xs font-medium p-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C]">
                <input
                  type="checkbox"
                  checked={separateClub}
                  onChange={(e) => setSeparateClub(e.target.checked)}
                />
                <span>แยกสโมสรเดียวกันอัตโนมัติ</span>
              </label>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                disabled={previewLoading || !canDrawBracket || divisionPlayers.length < 2}
                onClick={buildRandomGroups}
                title={
                  !canDrawBracket
                    ? 'บัญชีนี้ไม่มีสิทธิ์จัดสาย กรุณาเข้าสู่ระบบด้วย Owner หรือ Tournament Admin'
                    : divisionPlayers.length < 2
                    ? 'ต้องมีทีมที่อนุมัติและไม่อยู่ Waiting List อย่างน้อย 2 ทีม'
                    : undefined
                }
                className="min-h-[44px] px-4 py-2 rounded-lg bg-[#142642] hover:bg-[#1E355C] text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
              >
                <Shuffle className="w-4 h-4" />
                <span>{previewLoading ? 'กำลังสร้าง Preview...' : 'สุ่มสายและดูผล (Random Preview)'}</span>
              </button>

              {previewGroups && (
                <>
                  <button
                    onClick={() => { setPreviewGroups(null); setServerPreviewId(null); }}
                    className="min-h-[44px] px-4 py-2 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] text-xs font-semibold"
                  >
                    ล้างตัวอย่าง (Reset)
                  </button>
                  <button
                    disabled={!hasPermission('drawBracket')}
                    onClick={handlePublishDraw}
                    className="min-h-[44px] px-5 py-2 rounded-lg bg-[#156143] hover:bg-[#104D35] text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Lock className="w-4 h-4" />
                    <span>
                      {isKnockoutOnly
                        ? 'Publish & ไปสาย Knockout →'
                        : `Publish (${previewRoundRobinMatches} แมตช์วนแข่ง) & ไปขั้นตอนที่ 3 →`}
                    </span>
                  </button>
                </>
              )}

              {groupMatches.length > 0 && !previewGroups && (
                <button
                  onClick={() => setSubTab('rr_matches')}
                  className="min-h-[44px] px-4 py-2 rounded-lg border border-[#156143] text-[#156143] dark:text-[#4ADE80] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#ECFDF3] dark:hover:bg-[#0E2E1D]/40"
                >
                  <span>ดูแมตช์วนแข่งทั้งหมด ({groupMatches.length} แมตช์) & เลือกกรรมการ</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>

            {!canDrawBracket && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                บัญชีปัจจุบันไม่มีสิทธิ์จัดหรือ Publish สายการแข่งขัน กรุณาออกจากระบบกรรมการ แล้วเข้าสู่ระบบด้วย Owner หรือ Tournament Admin
              </div>
            )}
          </div>

          {/* Before vs After Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Before */}
            <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold">สายปัจจุบัน (Before)</h4>
                <div className="flex items-center gap-2">
                  {groupMatches.length > 0 && (
                    <span className="text-xs font-mono text-[#525C6B] dark:text-[#9AA8BC]">
                      {groupMatches.length} แมตช์วนแข่ง
                    </span>
                  )}
                  <StatusIndicator tone="neutral" label={`v${tournament.bracketVersion}`} compact />
                </div>
              </div>
              {groupStandings.length === 0 ? (
                <p className="text-xs text-[#525C6B]">ยังไม่มีการจัดกลุ่มในรุ่นนี้</p>
              ) : (
                <div className="space-y-3">
                  {groupStandings.map(([gName, rows]) => {
                    const gMatchCount = (rows.length * (rows.length - 1)) / 2;
                    return (
                      <div
                        key={gName}
                        className="p-3 rounded-lg bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C]"
                      >
                        <div className="flex items-center justify-between text-xs font-bold mb-1.5">
                          <span>{gName}</span>
                          <span className="font-mono text-[#525C6B] dark:text-[#9AA8BC]">
                            {rows.length} ทีม · {gMatchCount} แมตช์
                          </span>
                        </div>
                        <ul className="space-y-1 text-xs">
                          {rows.map((r) => (
                            <li key={r.teamId} className="flex justify-between">
                              <span>{r.teamName}</span>
                              <span className="text-[#525C6B]">{r.club}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* After Preview */}
            <div className="rounded-xl border border-[#156143]/40 dark:border-[#229A6B]/40 bg-white dark:bg-[#131E2E] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-[#156143] dark:text-[#229A6B]">
                  ผลสุ่มสายใหม่ (After Preview)
                </h4>
                <StatusIndicator
                  tone={previewGroups ? 'success' : 'neutral'}
                  label={
                    previewGroups
                      ? isKnockoutOnly
                        ? 'พร้อมสร้างสาย Knockout'
                        : `พร้อม Publish · ${previewRoundRobinMatches} แมตช์วนแข่ง`
                      : 'รอกดสุ่ม'
                  }
                  compact
                />
              </div>
              {!previewGroups ? (
                <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC] py-6 text-center">
                  กดปุ่ม “สุ่มสายและดูผล” เพื่อสร้างสายใหม่และดูจำนวนแมตช์วนแข่งทั้งหมดก่อนยืนยัน
                </p>
              ) : (
                <div className="space-y-3">
                  {!isKnockoutOnly && (
                    <div className="p-3 rounded-lg bg-[#156143]/10 dark:bg-[#229A6B]/15 border border-[#156143]/30 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-[#156143] dark:text-[#4ADE80]">
                        รวมแมตช์การวนแข่งรอบแรกทั้งหมด ({previewGroups.length} กลุ่ม)
                      </span>
                      <span className="font-mono font-bold text-sm text-[#156143] dark:text-[#4ADE80]">
                        {previewRoundRobinMatches} แมตช์
                      </span>
                    </div>
                  )}
                  {previewGroups.map((g) => {
                    const gMatchCount = (g.teams.length * (g.teams.length - 1)) / 2;
                    return (
                      <div
                        key={g.groupName}
                        className="p-3 rounded-lg bg-[#ECFDF3]/50 dark:bg-[#0E2E1D]/40 border border-[#BBF7D0] dark:border-[#1B4D32]"
                      >
                        <div className="flex items-center justify-between text-xs font-bold mb-1.5">
                          <span>{isKnockoutOnly ? 'ลำดับวางสาย Knockout' : g.groupName}</span>
                          {!isKnockoutOnly && (
                            <span className="font-mono text-[#156143] dark:text-[#4ADE80]">
                              {g.teams.length} ทีม · {gMatchCount} แมตช์วนแข่ง
                            </span>
                          )}
                        </div>
                        <ul className="space-y-1 text-xs">
                          {g.teams.map((t, i) => (
                            <li key={t.id} className="flex justify-between">
                              <span>
                                {i + 1}. {t.teamName}
                              </span>
                              <span className="text-[#525C6B]">{t.club}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Revision History */}
          <div className="space-y-3">
            <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold">
                <History className="w-4 h-4" />
                <span>ประวัติเวอร์ชันสายการแข่งขัน (Revision History)</span>
              </div>
              <div className="divide-y divide-[#E2DFD5] dark:divide-[#25354C] text-xs">
                {paginatedRevisions.map((rev) => (
                  <div key={rev.version} className="py-2 flex flex-wrap justify-between gap-2">
                    <span>
                      <strong>v{rev.version}</strong> · {rev.summary}
                    </span>
                    <span className="text-[#525C6B] dark:text-[#9AA8BC] font-mono">
                      {rev.createdBy} · {rev.createdAt}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <PaginationBar
              page={safeRevPage}
              pageSize={revPageSize}
              totalItems={state.drawRevisions.length}
              onPageChange={setRevPage}
              onPageSizeChange={setRevPageSize}
              pageSizeOptions={[5, 10, 20]}
            />
          </div>
        </div>
      )}

      {/* 3. Round-Robin Matches & Umpire Selection Tab */}
      {subTab === 'rr_matches' && (
        <div className="space-y-5">
          {/* Summary Stats Strip synced with Settings */}
          <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-[#E2DFD5] dark:border-[#25354C]">
              <div>
                <div className="text-xs font-semibold text-[#156143] dark:text-[#4ADE80]">
                  ขั้นตอนที่ 3 · รายการแมตช์วนแข่งทั้งหมด ({drawMeta.label})
                </div>
                <h3 className="text-base font-bold mt-0.5">
                  จำนวนแมตช์การวนแข่งทั้งหมด · จัดกรรมการ · บันทึกผล
                </h3>
                <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                  กติกาจากตั้งค่า: แบ่ง {groupStandings.length} กลุ่ม · แข่ง {tournament.scoringRules.bestOfSets} เซต ({tournament.scoringRules.pointsPerSet} แต้ม)
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  disabled={!hasPermission('assignUmpire') || groupMatches.length === 0}
                  onClick={() => handleRandomUmpires(groupMatches)}
                  className="min-h-[40px] px-3.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                  <span>สุ่มกรรมการแมตช์วนแข่ง</span>
                </button>
                <button
                  onClick={() => setSubTab('groups')}
                  className="min-h-[40px] px-4 rounded-lg bg-[#156143] hover:bg-[#104D35] text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <span>ไปดูตารางคะแนนรอบแรก (ขั้นตอนที่ 4)</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 4 Key Operational Metrics */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C]">
                <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
                  จำนวนแมตช์วนแข่งทั้งหมด
                </div>
                <div className="text-xl font-bold font-mono mt-1 text-[#156143] dark:text-[#4ADE80]">
                  {groupMatchStats.total} <span className="text-xs font-sans font-medium">แมตช์</span>
                </div>
                <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC] mt-0.5">
                  แบ่ง {groupStandings.length} กลุ่ม · {divisionPlayers.length} ทีม
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C]">
                <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">ความคืบหน้าการแข่งขัน</div>
                <div className="text-xl font-bold font-mono mt-1">
                  {groupMatchStats.finished}/{groupMatchStats.total}
                </div>
                <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC] mt-0.5">
                  กำลังแข่ง {groupMatchStats.live} · รอแข่ง {groupMatchStats.scheduled}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C]">
                <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">การเลือกกรรมการประจำคู่</div>
                <div
                  className={`text-xl font-bold font-mono mt-1 ${
                    groupMatchStats.missingUmpires > 0
                      ? 'text-[#B45309] dark:text-[#FACC15]'
                      : 'text-[#156143] dark:text-[#4ADE80]'
                  }`}
                >
                  {groupMatchStats.assignedUmpires}/{groupMatchStats.total}
                </div>
                <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC] mt-0.5">
                  {groupMatchStats.missingUmpires > 0
                    ? `ยังไม่ได้เลือก ${groupMatchStats.missingUmpires} คู่`
                    : 'เลือกกรรมการครบทุกคู่แล้ว'}
                </div>
              </div>

              {allGroupFinished && (
                <div className="p-3.5 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C]">
                  <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">สิทธิ์เข้าสู่ขั้นตอนต่อไป</div>
                  <div className="text-xl font-bold font-mono mt-1">
                    {qualifiedSeededTeams.length} <span className="text-xs font-sans font-medium">ทีม</span>
                  </div>
                  <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC] mt-0.5">
                    {drawSystem === 'round_robin'
                      ? 'ตัดสินแชมป์จากตารางคะแนน'
                      : `คัดเข้ารอบกลุ่มละ ${qualifiersPerGroup} ทีม`}
                  </div>
                </div>
              )}
            </div>
          </div>

          {groupMatches.length === 0 ? (
            <EmptyStateCard
              title="ยังไม่มีแมตช์รอบวนแข่ง"
              description="กรุณากดสุ่มและ Publish สายในขั้นตอนที่ 2 (2. สร้าง / สุ่มสาย) ก่อน"
              actionLabel="ไปขั้นตอนที่ 2 (สร้าง / สุ่มสาย)"
              onAction={() => setSubTab('generator')}
            />
          ) : (
            <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] overflow-hidden">
              <div className="p-4 border-b border-[#E2DFD5] dark:border-[#25354C] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold">
                    รายการแมตช์การวนแข่งทั้งหมด ({groupMatches.length} แมตช์) — เลือกกรรมการ & แข่งต่อ
                  </h4>
                  <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                    เลือกกรรมการประจำคู่และบันทึกผลการแข่งขันได้จากที่นี่ จากนั้นไปดูตารางคะแนนในแท็บที่ 4
                  </p>
                </div>

                {/* Group Filter Tabs */}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setGroupFilter('all')}
                    className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold ${
                      groupFilter === 'all'
                        ? 'bg-[#142642] text-white'
                        : 'bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C]'
                    }`}
                  >
                    ทั้งหมด ({groupMatches.length})
                  </button>
                  {groupNames.map((gName) => {
                    const cnt = groupMatches.filter((m) => (m.groupName || 'กลุ่ม A') === gName).length;
                    return (
                      <button
                        key={gName}
                        onClick={() => setGroupFilter(gName)}
                        className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold ${
                          groupFilter === gName
                            ? 'bg-[#142642] text-white'
                            : 'bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C]'
                        }`}
                      >
                        {gName} ({cnt})
                      </button>
                    );
                  })}
                </div>
              </div>

              {filteredGroupMatches.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#525C6B]">
                  ไม่พบแมตช์ในกลุ่มที่เลือก
                </div>
              ) : (
                <div className="divide-y divide-[#E2DFD5] dark:divide-[#25354C]">
                  {paginatedGroupMatches.map((m) => {
                    const courtName =
                      tournament.courts.find((c) => c.id === m.courtId)?.name ||
                      m.courtId ||
                      'ไม่ระบุสนาม';
                    const scoreText =
                      m.sets.length > 0 && (m.sets[0].scoreA > 0 || m.sets[0].scoreB > 0 || isCompletedMatch(m))
                        ? m.sets.map((s) => `${s.scoreA}-${s.scoreB}`).join(' / ')
                        : '0-0';
                    const isFinished = isCompletedMatch(m);
                    const displayOutcome =
                      m.winner || getMatchOutcomeByRules(m.sets, tournament.scoringRules, m.stage);
                    const setWinsA = m.sets.filter(
                      (set) => (set.winner || getSetWinnerByRules(set.scoreA, set.scoreB, tournament.scoringRules)) === 'A'
                    ).length;
                    const setWinsB = m.sets.filter(
                      (set) => (set.winner || getSetWinnerByRules(set.scoreA, set.scoreB, tournament.scoringRules)) === 'B'
                    ).length;

                    return (
                      <div
                        key={m.id}
                        className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 hover:bg-[#FAF9F6] dark:hover:bg-[#172336] transition-colors"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-bold text-[#156143] dark:text-[#4ADE80]">
                              {m.matchCode}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-[#EFECE4] dark:bg-[#1B293D] text-[11px] font-semibold">
                              {m.groupName || 'กลุ่ม A'}
                            </span>
                            {getMatchStatusBadge(m)}
                            <span className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                              {courtName} · {m.scheduledTime} น.
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                            <span className={`inline-flex items-center gap-1.5 ${displayOutcome === 'A' ? 'text-[#156143] dark:text-[#4ADE80]' : ''}`}>
                              <TeamLogoBadge
                                teamName={m.teamAName}
                                logoUrl={teamLogos[m.teamAId] || teamLogos[m.teamAName]}
                                size="xs"
                              />
                              <span>{m.teamAName}</span>
                            </span>
                            <span className="text-xs text-[#525C6B] font-normal">vs</span>
                            <span className={`inline-flex items-center gap-1.5 ${displayOutcome === 'B' ? 'text-[#156143] dark:text-[#4ADE80]' : ''}`}>
                              <TeamLogoBadge
                                teamName={m.teamBName}
                                logoUrl={teamLogos[m.teamBId] || teamLogos[m.teamBName]}
                                size="xs"
                              />
                              <span>{m.teamBName}</span>
                            </span>
                            <span className="font-mono text-xs px-2 py-0.5 rounded bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C]">
                              {scoreText}
                            </span>
                            {displayOutcome === 'draw' && (
                              <StatusIndicator tone="neutral" label={`เสมอ ${setWinsA}–${setWinsB} เซต`} compact />
                            )}
                          </div>

                          {m.conflictWarning && (
                            <div className="text-xs text-[#B45309] dark:text-[#FACC15] flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              <span>{m.conflictWarning}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 shrink-0">
                          <div className="flex items-center gap-1.5">
                            <MapPin className="w-4 h-4 text-[#525C6B] dark:text-[#9AA8BC] hidden sm:block shrink-0" />
                            <select
                              disabled={isFinished || Boolean(m.isBye)}
                              value={m.courtId || ''}
                              onChange={(e) => handleAssignCourt(m.id, e.target.value)}
                              aria-label={`เลือกสนามคู่ ${m.matchCode}`}
                              className="w-full sm:w-40 min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs disabled:opacity-50 truncate"
                            >
                              <option value="">-- ไม่ระบุสนาม --</option>
                              {tournament.courts.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <UserCheck className="w-4 h-4 text-[#525C6B] dark:text-[#9AA8BC] hidden sm:block shrink-0" />
                            <select
                              disabled={!hasPermission('assignUmpire') || isFinished || Boolean(m.isBye)}
                              value={m.umpireId || ''}
                              onChange={(e) => handleAssignUmpire(m.id, e.target.value)}
                              aria-label={`เลือกกรรมการคู่ ${m.matchCode}`}
                              className="w-full sm:w-56 min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs disabled:opacity-50 truncate"
                            >
                              <option value="">-- เลือกกรรมการ --</option>
                              {tournamentUmpires.map((u) => {
                                const ownClub =
                                  u.clubAffiliation === m.teamAClub || u.clubAffiliation === m.teamBClub;
                                return (
                                  <option key={u.id} value={u.id}>
                                    {u.firstName} {u.lastName} (งาน {u.assignedMatches} คู่)
                                    {ownClub ? ' [สังกัดทีมเดียวกัน]' : ''}
                                  </option>
                                );
                              })}
                            </select>
                          </div>

                          <button
                            onClick={() => openMatchModal(m)}
                            className={`min-h-[40px] px-3.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap ${
                              isFinished
                                ? 'border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]'
                                : 'bg-[#142642] hover:bg-[#1E355C] text-white'
                            }`}
                          >
                            {isFinished ? (
                              <>
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>ดู / แก้ผล</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5" />
                                <span>แข่งต่อ / บันทึกผล</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {groupMatches.length > 0 && (
            <PaginationBar
              page={safeRrPage}
              pageSize={rrPageSize}
              totalItems={filteredGroupMatches.length}
              onPageChange={setRrPage}
              onPageSizeChange={setRrPageSize}
            />
          )}
        </div>
      )}

      {/* 4. Group Standings & Qualified Teams Tab */}
      {subTab === 'groups' && (
        <div className="space-y-5">
          {groupStandings.length === 0 ? (
            <EmptyStateCard
              title="ยังไม่มีตารางคะแนนรอบแรก"
              description="กรุณากดสุ่มและ Publish สายในขั้นตอนที่ 2 (2. สร้าง / สุ่มสาย) ก่อน"
              actionLabel="ไปขั้นตอนที่ 2 (สร้าง / สุ่มสาย)"
              onAction={() => setSubTab('generator')}
            />
          ) : (
            <>
              {(groupMatches.length !== expectedPublishedRoundRobinMatches ||
                publishedRoundRobinSummary.unassignedTeams > 0) && (
                <div className="rounded-xl border border-[#F59E0B] bg-[#FFFBEB] p-4 text-xs text-[#92400E] dark:border-[#B45309] dark:bg-[#261B07] dark:text-[#FACC15] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <strong>ข้อมูลแมตช์วนแข่งไม่ครบ:</strong> พบ {groupMatches.length}/{expectedPublishedRoundRobinMatches} คู่
                    · สายที่ Publish มี {publishedRoundRobinSummary.assignedTeams} ทีมใน {publishedRoundRobinSummary.groupCount} กลุ่ม
                    {publishedRoundRobinSummary.unassignedTeams > 0
                      ? ` · มี ${publishedRoundRobinSummary.unassignedTeams} ทีมยังไม่อยู่ในกลุ่ม`
                      : ''}
                  </div>
                  <button type="button" onClick={() => void refreshState()} className="min-h-9 rounded-lg border border-current px-3 font-semibold">โหลดข้อมูลใหม่</button>
                </div>
              )}
              {/* Tie-Break & Navigation Header */}
              <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-[#156143] dark:text-[#4ADE80]">
                    ขั้นตอนที่ 4 · ตารางคะแนนรอบแรก ({groupStandings.length} กลุ่ม)
                  </div>
                  <div className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                    เกณฑ์จัดอันดับ Tie-break:{' '}
                    <strong className="text-[#141D2B] dark:text-[#F3F5F8]">
                      คะแนนสะสม (ชนะ 2 · เสมอ 1 · แพ้ 0) → จำนวนชนะ → ผลต่างเซต → ผลต่างคะแนน → คะแนนได้รวม
                    </strong>
                    {allGroupFinished
                      ? ` · คัดเข้ารอบ ${qualifiersPerGroup} อันดับแรก / กลุ่ม (${qualifiedSeededTeams.length} ทีม)`
                      : ' · ผลอันดับและสิทธิ์เข้ารอบจะสรุปเมื่อแข่งครบทุกคู่'}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setSubTab('rr_matches')}
                    className="min-h-[40px] px-3.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] text-xs font-semibold"
                  >
                    ← ดูแมตช์วนแข่ง ({groupMatches.length})
                  </button>
                  {koMatches.length > 0 && (
                    <button
                      onClick={() => setSubTab('knockout')}
                      className="min-h-[40px] px-3.5 rounded-lg border border-[#156143] text-[#156143] dark:text-[#4ADE80] text-xs font-semibold inline-flex items-center gap-1.5"
                    >
                      <Trophy className="w-3.5 h-3.5" />
                      <span>ดูสาย Knockout ({koMatches.length} คู่)</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Group Standings Tables */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {paginatedGroupStandings.map(([groupName, rows]) => {
                  const grpMatches = groupMatches.filter((m) => (m.groupName || 'กลุ่ม A') === groupName);
                  const grpDone = grpMatches.filter(isCompletedMatch).length;
                  const expectedGroupMatches = (rows.length * (rows.length - 1)) / 2;
                  const groupCompleted =
                    expectedGroupMatches > 0 &&
                    grpMatches.length === expectedGroupMatches &&
                    grpMatches.every(isCompletedMatch);
                  return (
                    <div
                      key={groupName}
                      className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] overflow-hidden"
                    >
                      <div className="px-4 py-3 bg-[#F7F6F2] dark:bg-[#0B121C] border-b border-[#E2DFD5] dark:border-[#25354C] flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold">{groupName}</span>
                          <span className="text-[11px] font-mono text-[#525C6B] dark:text-[#9AA8BC]">
                            ({grpDone}/{expectedGroupMatches} แมตช์)
                          </span>
                        </div>
                        <span className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                          {groupCompleted
                            ? `เข้ารอบ ${qualifiersPerGroup} ทีม`
                            : 'รอแข่งขันให้ครบทุกคู่'}
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left border-collapse">
                          <thead>
                            <tr className="border-b border-[#E2DFD5] dark:border-[#25354C] text-[#525C6B] dark:text-[#9AA8BC]">
                              <th className="py-2.5 px-3">#</th>
                              <th className="py-2.5 px-3">ทีม</th>
                              <th className="py-2.5 px-2 text-right">แข่ง</th>
                              <th className="py-2.5 px-2 text-right">ชนะ</th>
                              <th className="py-2.5 px-2 text-right">เสมอ</th>
                              <th className="py-2.5 px-2 text-right">แพ้</th>
                              <th className="py-2.5 px-2 text-right">
                                <span className="block">คะแนนสะสม</span>
                                <span className="block whitespace-nowrap text-[9px] font-normal opacity-80">
                                  ชนะ 2 · เสมอ 1 · แพ้ 0
                                </span>
                              </th>
                              <th className="py-2.5 px-2 text-right">เซต</th>
                              <th className="py-2.5 px-2 text-right">
                                <span className="block">ผลต่างแต้ม</span>
                                <span className="block whitespace-nowrap text-[9px] font-normal opacity-80">
                                  แต้มได้ − แต้มเสีย
                                </span>
                              </th>
                              <th className="py-2.5 px-3 text-right">สิทธิ์</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E2DFD5] dark:divide-[#25354C] font-mono tabular-nums">
                            {rows.map((r) => {
                              const pointsSource = getStandingPointsSource(r);
                              const pointDifferenceSource = getPointDifferenceSource(
                                r.pointsFor,
                                r.pointsAgainst
                              );
                              return (
                              <tr key={r.teamId}>
                                <td className="py-2.5 px-3 font-bold">{r.rank}</td>
                                <td className="py-2.5 px-3 font-sans font-medium">
                                  <div className="flex items-center gap-2">
                                    <TeamLogoBadge
                                      teamName={r.teamName}
                                      logoUrl={teamLogos[r.teamId] || teamLogos[r.teamName]}
                                      size="xs"
                                    />
                                    <span className="truncate">{r.teamName}</span>
                                  </div>
                                </td>
                                <td className="py-2.5 px-2 text-right">{r.played}</td>
                                <td className="py-2.5 px-2 text-right font-bold text-[#156143] dark:text-[#229A6B]">
                                  {r.won}
                                </td>
                                <td className="py-2.5 px-2 text-right">{r.drawn}</td>
                                <td className="py-2.5 px-2 text-right">{r.lost}</td>
                                <td
                                  className="py-2.5 px-2 text-right"
                                  title={pointsSource.description}
                                  aria-label={`ที่มาคะแนน ${r.teamName}: ${pointsSource.description}`}
                                >
                                  <div className="font-bold text-sm">{r.standingPoints}</div>
                                  <div className="mt-0.5 whitespace-nowrap text-[9px] font-normal text-[#687386] dark:text-[#9AA8BC]">
                                    {pointsSource.compact}
                                  </div>
                                </td>
                                <td className="py-2.5 px-2 text-right">
                                  {r.setsFor}-{r.setsAgainst}
                                </td>
                                <td
                                  className="py-2.5 px-2 text-right"
                                  title={pointDifferenceSource.description}
                                  aria-label={`ที่มาผลต่างแต้ม ${r.teamName}: ${pointDifferenceSource.description}`}
                                >
                                  <div className="font-bold">{pointDifferenceSource.display}</div>
                                  <div className="mt-0.5 whitespace-nowrap text-[9px] font-normal text-[#687386] dark:text-[#9AA8BC]">
                                    {pointDifferenceSource.compact}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 text-right font-sans">
                                  {groupCompleted && r.qualified ? (
                                    <StatusIndicator tone="success" label="เข้ารอบ" compact />
                                  ) : groupCompleted ? (
                                    <span className="text-[#525C6B]">—</span>
                                  ) : null}
                                </td>
                              </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>

              <PaginationBar
                page={safeGroupsPage}
                pageSize={groupsPageSize}
                totalItems={groupStandings.length}
                onPageChange={setGroupsPage}
                onPageSizeChange={setGroupsPageSize}
                pageSizeOptions={[4, 6, 8, 12]}
              />

              {/* Next Step Footer Bar */}
              <div className="rounded-xl border border-[#156143]/40 dark:border-[#229A6B]/40 bg-[#ECFDF3]/60 dark:bg-[#0E2E1D]/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-bold text-[#141D2B] dark:text-[#F3F5F8]">
                    {drawSystem === 'round_robin'
                      ? 'ขั้นตอนถัดไป: สรุปอันดับรอบพบกันหมด หรือ แชร์สายการแข่งขัน'
                      : 'ขั้นตอนถัดไป: นำทีมที่ผ่านเข้ารอบเข้าสู่สาย Knockout'}
                  </div>
                  <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                    {drawSystem === 'round_robin'
                      ? `แข่งจบแล้ว ${groupMatchStats.finished}/${groupMatchStats.total} แมตช์ สามารถแชร์ผลหรือสร้างรอบ Playoff เพิ่มเติมได้`
                      : `มีทีมที่ติดอันดับเข้ารอบแล้ว ${qualifiedSeededTeams.length} ทีม (ไขว้สายอัตโนมัติตามอันดับกลุ่ม)`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {drawSystem === 'round_robin' ? (
                    <>
                      <button
                        onClick={() => setSubTab('share')}
                        className="min-h-[42px] px-4 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <Share2 className="w-4 h-4" />
                        <span>ไปแชร์ & พิมพ์</span>
                      </button>
                      <button
                        disabled={!hasPermission('drawBracket') || qualifiedSeededTeams.length < 2}
                        onClick={handleAdvanceToKnockout}
                        className="min-h-[42px] px-4 rounded-lg bg-[#156143] hover:bg-[#104D35] text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
                      >
                        <span>สร้างสาย Playoff & ไปขั้นตอนที่ 5</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <button
                      disabled={
                        !hasPermission('drawBracket') ||
                        qualifiedSeededTeams.length < 2 ||
                        (drawSystem === 'group_then_knockout' && !allGroupFinished)
                      }
                      title={
                        drawSystem === 'group_then_knockout' && !allGroupFinished
                          ? `ต้องแข่งรอบวนแข่งให้ครบทั้ง ${groupMatchStats.total} คู่ก่อน`
                          : undefined
                      }
                      onClick={handleAdvanceToKnockout}
                      className="min-h-[44px] px-5 rounded-lg bg-[#156143] hover:bg-[#104D35] text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-40"
                    >
                      <Trophy className="w-4 h-4" />
                      <span>
                        {drawSystem === 'group_then_knockout' && !allGroupFinished
                          ? `รอรอบวนแข่งให้ครบ (${groupMatchStats.finished}/${groupMatchStats.total})`
                          : koMatches.length > 0
                          ? 'อัปเดตสาย Knockout ใหม่ & ไปขั้นตอนที่ 5'
                          : 'สร้างสาย Knockout & ไปแข่งต่อในขั้นตอนที่ 5'}
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* 5. Knockout Pyramid Bracket */}
      {subTab === 'knockout' && (
        <div className="space-y-3">
          {koMatches.length === 0 ? (
            <EmptyStateCard
              title="ยังไม่มีสาย Knockout ในรุ่นนี้"
              description="สามารถสร้างสาย Knockout จากตารางคะแนนในขั้นตอนที่ 4 หรือสุ่มสายแพ้คัดออกโดยตรง"
              actionLabel="ไปขั้นตอนที่ 4 (ตารางคะแนนรอบแรก)"
              onAction={() => setSubTab('groups')}
            />
          ) : hasSplitRankBrackets ? (
            <div className="space-y-5">
              <div className="rounded-xl border border-[#156143]/30 bg-[#ECFDF3] p-4 text-sm dark:border-[#229A6B]/30 dark:bg-[#0E2E1D]/40">
                <div className="font-bold text-[#156143] dark:text-[#4ADE80]">แยกสายตามอันดับรอบแบ่งกลุ่ม</div>
                <p className="mt-1 text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                  สายอันดับ 1 ใช้หาแชมป์และรองแชมป์ ส่วน Final ของสายอันดับ 2 ใช้ตัดสินอันดับ 3–4
                </p>
              </div>
              {championshipMatches.length > 0 && (
                <KnockoutBracketCanvas
                  matches={championshipMatches}
                  teamLogos={teamLogos}
                  onSelectMatch={openMatchModal}
                  title={`สายอันดับ 1 ของกลุ่ม — ชิงอันดับ 1–2 (${activeDivision?.nameTh})`}
                />
              )}
              {thirdPlaceMatches.length > 0 && (
                <KnockoutBracketCanvas
                  matches={thirdPlaceMatches}
                  teamLogos={teamLogos}
                  onSelectMatch={openMatchModal}
                  title={`สายอันดับ 2 ของกลุ่ม — ชิงอันดับ 3–4 (${activeDivision?.nameTh})`}
                />
              )}
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-[#D8E7DF] bg-[#F2FBF6] px-4 py-3 text-sm dark:border-[#214B39] dark:bg-[#0E2E1D]/40">
                <span className="font-bold text-[#156143] dark:text-[#4ADE80]">ทีมผ่านเข้ารอบ {knockoutEntrantCount} ทีม</span>
                <span className="ml-2 text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                  นับ Team ID ไม่ซ้ำ และไม่นับ BYE หรือช่องรอผลรอบก่อนหน้า
                </span>
              </div>
              <KnockoutBracketCanvas
                matches={divisionMatches}
                teamLogos={teamLogos}
                onSelectMatch={openMatchModal}
                title={`สาย Knockout — ${activeDivision?.nameTh} (คลิกที่คู่เพื่อดูรายละเอียด บันทึกผล หรือแก้ไขผล)`}
              />
            </>
          )}
        </div>
      )}

      {/* 6. Umpire Assignment (Knockout matches only; group matches belong to step 3) */}
      {subTab === 'umpires' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] overflow-hidden">
            <div className="p-4 border-b border-[#E2DFD5] dark:border-[#25354C] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold">การมอบหมายกรรมการรอบ Knockout ({koMatches.length} คู่)</h3>
                <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                  ขั้นตอนนี้แสดงเฉพาะคู่ Knockout ส่วนคู่รอบแบ่งกลุ่มมอบหมายได้ในขั้นตอนที่ 3
                </p>
              </div>
              <button
                disabled={!hasPermission('assignUmpire')}
                onClick={() => handleRandomUmpires(koMatches)}
                className="min-h-[40px] px-3.5 rounded-lg bg-[#156143] text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
              >
                <Shuffle className="w-3.5 h-3.5" />
                <span>สุ่มกรรมการอัตโนมัติ</span>
              </button>
            </div>

            <div className="divide-y divide-[#E2DFD5] dark:divide-[#25354C]">
              {paginatedKnockoutMatches.map((m) => (
                <div
                  key={m.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      <span className="font-mono text-xs text-[#156143]">{m.matchCode}</span>
                      <span className="inline-flex items-center gap-1.5">
                        <TeamLogoBadge
                          teamName={m.teamAName}
                          logoUrl={teamLogos[m.teamAId] || teamLogos[m.teamAName]}
                          size="xs"
                        />
                        <span>{m.teamAName}</span>
                      </span>
                      <span className="text-xs font-normal text-[#525C6B]">vs</span>
                      <span className="inline-flex items-center gap-1.5">
                        <TeamLogoBadge
                          teamName={m.teamBName}
                          logoUrl={teamLogos[m.teamBId] || teamLogos[m.teamBName]}
                          size="xs"
                        />
                        <span>{m.teamBName}</span>
                      </span>
                    </div>
                    <div className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                      {m.stage === 'group' ? m.groupName || 'รอบแบ่งกลุ่ม' : m.stage} · เวลา {m.scheduledTime} · สโมสร: {m.teamAClub} / {m.teamBClub}
                    </div>
                    {m.conflictWarning && (
                      <div className="text-xs text-[#B45309] dark:text-[#FACC15] flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>{m.conflictWarning}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-4 h-4 text-[#525C6B] dark:text-[#9AA8BC] hidden sm:block shrink-0" />
                      <select
                        disabled={isCompletedMatch(m) || Boolean(m.isBye)}
                        value={m.courtId || ''}
                        onChange={(e) => handleAssignCourt(m.id, e.target.value)}
                        aria-label={`เลือกสนามคู่ ${m.matchCode}`}
                        className="w-full sm:w-40 min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs disabled:opacity-50 truncate"
                      >
                        <option value="">-- ไม่ระบุสนาม --</option>
                        {tournament.courts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <UserCheck className="w-4 h-4 text-[#525C6B] dark:text-[#9AA8BC] hidden sm:block shrink-0" />
                      <select
                        disabled={!hasPermission('assignUmpire') || isCompletedMatch(m) || Boolean(m.isBye)}
                        value={m.umpireId || ''}
                        onChange={(e) => handleAssignUmpire(m.id, e.target.value)}
                        aria-label={`เลือกกรรมการคู่ ${m.matchCode}`}
                        className="w-full sm:w-56 min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs disabled:opacity-50 truncate"
                      >
                        <option value="">-- เลือกกรรมการ --</option>
                        {tournamentUmpires.map((u) => {
                          const ownClub =
                            u.clubAffiliation === m.teamAClub || u.clubAffiliation === m.teamBClub;
                          return (
                            <option key={u.id} value={u.id}>
                              {u.firstName} {u.lastName} (งาน {u.assignedMatches} คู่)
                              {ownClub ? ' [สังกัดทีมเดียวกัน]' : ''}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <PaginationBar
            page={safeUmpireAssignPage}
            pageSize={umpireAssignPageSize}
            totalItems={koMatches.length}
            onPageChange={setUmpireAssignPage}
            onPageSizeChange={setUmpireAssignPageSize}
          />
        </div>
      )}

      {/* 6. Share & Print */}
      {subTab === 'share' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-5 flex flex-col items-center text-center space-y-3">
            <h3 className="text-sm font-bold">QR Code สายการแข่งขัน ({activeDivision?.nameTh})</h3>
            <QRCodeMatrix
              value={publicBracketUrl}
              size={140}
            />
            <div className="w-full p-2 rounded bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] text-xs font-mono truncate">
              {publicBracketUrl}
            </div>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(publicBracketUrl);
                notify('success', 'คัดลอกลิงก์ Public Bracket แล้ว');
              }}
              className="min-h-[40px] px-4 rounded-lg bg-[#156143] text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>คัดลอกลิงก์ Public Bracket</span>
            </button>
            <button type="button" onClick={() => { navigator.clipboard?.writeText(publicEmbedCode); notify('success', 'คัดลอก Embed Code แล้ว'); }} className="text-xs font-semibold text-[#156143] dark:text-[#4ADE80]">คัดลอก Embed Code</button>
          </div>

          <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-5 space-y-3">
            <h3 className="text-sm font-bold">พิมพ์เอกสารหน้าสนาม (Print-Friendly)</h3>
            <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
              สร้างเอกสารจากข้อมูลระดับมือที่เลือก พร้อมคะแนน สนาม เวลา และกรรมการล่าสุด
            </p>
            <div className="space-y-2 pt-2">
              {[
                { label: 'พิมพ์ใบบันทึกคะแนน (Score Sheet)', kind: 'score_sheets' as const },
                { label: 'พิมพ์ตารางการใช้สนาม (Court Schedule)', kind: 'court_schedule' as const },
                { label: 'พิมพ์สายการแข่งขัน (Bracket)', kind: 'bracket' as const },
              ].map((document) => (
                <button
                  key={document.kind}
                  onClick={() => {
                    printTournamentDocument(document.kind);
                    notify('info', `เตรียมเอกสาร: ${document.label}`);
                  }}
                  className="w-full min-h-[44px] px-4 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] text-xs font-semibold flex items-center justify-between hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
                >
                  <span>{document.label}</span>
                  <Printer className="w-4 h-4" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Match Detail / Quick Score / Admin Override Modal */}
      {knockoutModeOpen && activeDivision && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[#E2DFD5] bg-white shadow-2xl dark:border-[#25354C] dark:bg-[#131E2E]">
            <div className="flex items-start justify-between gap-4 border-b border-[#E2DFD5] p-5 dark:border-[#25354C]">
              <div>
                <h3 className="text-base font-bold">เลือกวิธีสร้างสาย Knockout</h3>
                <p className="mt-1 text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                  {activeDivision.nameTh} · รอบแบ่งกลุ่มจบครบ {groupMatchStats.finished}/{groupMatchStats.total} คู่
                </p>
              </div>
              <button type="button" disabled={creatingKnockout} onClick={() => setKnockoutModeOpen(false)} className="rounded-lg p-2 hover:bg-[#F7F6F2] disabled:opacity-40 dark:hover:bg-[#1B293D]">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <button
                type="button"
                onClick={() => setKnockoutMode('combined')}
                className={`w-full rounded-xl border p-4 text-left transition ${knockoutMode === 'combined' ? 'border-[#156143] bg-[#ECFDF3] ring-1 ring-[#156143] dark:bg-[#0E2E1D]/40' : 'border-[#E2DFD5] hover:border-[#156143]/50 dark:border-[#25354C]'}`}
              >
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${knockoutMode === 'combined' ? 'border-[#156143] bg-[#156143] text-white' : 'border-[#98A2B3]'}`}>{knockoutMode === 'combined' ? '✓' : ''}</span>
                  <div>
                    <div className="text-sm font-bold">สาย Knockout รวมทีมที่เข้ารอบทั้งหมด</div>
                    <p className="mt-1 text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                      รวมอันดับที่ผ่านเข้ารอบ {qualifiedSeededTeams.length} ทีมไว้ในสายเดียว เพื่อหาอันดับ 1–2 ตามปกติ
                    </p>
                  </div>
                </div>
              </button>
              <button
                type="button"
                disabled={rankOneTeams.length < 2 || rankTwoTeams.length < 2}
                onClick={() => {
                  setKnockoutMode('split_rank_brackets');
                  setIncludeThirdPlacePlayoff(false);
                }}
                className={`w-full rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${knockoutMode === 'split_rank_brackets' ? 'border-[#156143] bg-[#ECFDF3] ring-1 ring-[#156143] dark:bg-[#0E2E1D]/40' : 'border-[#E2DFD5] hover:border-[#156143]/50 dark:border-[#25354C]'}`}
              >
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${knockoutMode === 'split_rank_brackets' ? 'border-[#156143] bg-[#156143] text-white' : 'border-[#98A2B3]'}`}>{knockoutMode === 'split_rank_brackets' ? '✓' : ''}</span>
                  <div>
                    <div className="text-sm font-bold">แยกสายอันดับ 1 และอันดับ 2 ของแต่ละกลุ่ม</div>
                    <p className="mt-1 text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                      อันดับ 1 จำนวน {rankOneTeams.length} ทีม แข่งหาแชมป์–รองแชมป์ และอันดับ 2 จำนวน {rankTwoTeams.length} ทีม แข่งตัดสินอันดับ 3–4
                    </p>
                    {(rankOneTeams.length < 2 || rankTwoTeams.length < 2) && (
                      <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-400">ต้องมีอย่างน้อย 2 กลุ่ม และรับเข้ารอบอย่างน้อยกลุ่มละ 2 ทีม</p>
                    )}
                  </div>
                </div>
              </button>
              <label className={`flex items-start gap-3 rounded-xl border p-4 ${knockoutMode === 'combined' ? 'cursor-pointer border-[#E2DFD5] dark:border-[#25354C]' : 'cursor-not-allowed border-[#E2DFD5] opacity-55 dark:border-[#25354C]'}`}>
                <input
                  type="checkbox"
                  checked={knockoutMode === 'combined' && includeThirdPlacePlayoff}
                  disabled={knockoutMode !== 'combined' || qualifiedSeededTeams.length < 4}
                  onChange={(event) => setIncludeThirdPlacePlayoff(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#156143]"
                />
                <span>
                  <strong className="block text-sm">จัดคู่ชิงอันดับ 3–4 เพิ่ม</strong>
                  <span className="mt-1 block text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                    {knockoutMode === 'split_rank_brackets'
                      ? 'โหมดแยกสายใช้ Final ของสายอันดับ 2 ตัดสินอันดับ 3–4 อยู่แล้ว'
                      : qualifiedSeededTeams.length < 4
                      ? 'ต้องมีทีมเข้ารอบอย่างน้อย 4 ทีม'
                      : 'นำผู้แพ้จากรอบรองชนะเลิศทั้ง 2 คู่มาแข่งกัน ผู้ชนะได้อันดับ 3 และผู้แพ้ได้อันดับ 4'}
                  </span>
                </span>
              </label>
              <div className="rounded-lg bg-[#F7F6F2] px-3 py-2 text-[11px] text-[#525C6B] dark:bg-[#0B121C] dark:text-[#9AA8BC]">
                เมื่อยืนยัน ระบบจะสร้าง Revision ใหม่และแทนสาย Knockout เดิม หากสายเดิมเริ่มแข่งขันแล้วระบบจะไม่อนุญาตให้สร้างทับ
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-[#E2DFD5] bg-[#F7F6F2] p-4 sm:flex-row sm:justify-end dark:border-[#25354C] dark:bg-[#0B121C]">
              <button type="button" disabled={creatingKnockout} onClick={() => setKnockoutModeOpen(false)} className="min-h-11 rounded-lg border border-[#E2DFD5] bg-white px-5 text-xs font-semibold disabled:opacity-40 dark:border-[#25354C] dark:bg-[#131E2E]">ยกเลิก</button>
              <button type="button" disabled={creatingKnockout} onClick={createKnockout} className="min-h-11 rounded-lg bg-[#156143] px-5 text-xs font-bold text-white disabled:opacity-50">
                {creatingKnockout ? 'กำลังสร้างสาย…' : 'ยืนยันสร้างสายและไปขั้นตอนที่ 5'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[#E2DFD5] bg-white shadow-2xl dark:border-[#25354C] dark:bg-[#131E2E]">
            <div className="flex items-center justify-between border-b border-[#E2DFD5] p-4 dark:border-[#25354C]">
              <div>
                <div className="text-xs font-mono text-[#156143]">{selectedTeam.registrationCode}</div>
                <h3 className="font-bold">{selectedTeam.teamName}</h3>
              </div>
              <button type="button" onClick={() => setSelectedTeam(null)} className="rounded-lg p-2 hover:bg-[#F7F6F2] dark:hover:bg-[#1B293D]"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-4 p-5 text-sm sm:grid-cols-2">
              <div><div className="text-xs text-[#667085]">สโมสร / ชมรม</div><div className="font-semibold">{selectedTeam.club || 'อิสระ'}</div></div>
              <div><div className="text-xs text-[#667085]">ประเภท</div><div className="font-semibold">{selectedTeam.format === 'doubles' ? 'คู่' : 'เดี่ยว'}</div></div>
              <div className="sm:col-span-2">
                <div className="mb-2 text-xs text-[#667085]">รายชื่อนักกีฬา</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(selectedTeam.members?.length ? selectedTeam.members : [{ firstName: selectedTeam.firstName, lastName: selectedTeam.lastName, nickname: selectedTeam.nickname }, ...(selectedTeam.partnerName ? [{ firstName: selectedTeam.partnerName, lastName: '', nickname: selectedTeam.partnerNickname }] : [])]).map((member, index) => (
                    <div key={`${selectedTeam.id}-detail-${index}`} className="rounded-xl bg-[#F7F6F2] p-3 dark:bg-[#0B121C]">
                      <div className="text-xs text-[#667085]">นักกีฬาคนที่ {index + 1}</div>
                      <div className="font-bold">{member.firstName} {member.lastName}{member.nickname ? ` (${member.nickname})` : ''}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div><div className="text-xs text-[#667085]">Check-in</div><div className="font-semibold">{selectedTeam.checkedIn ? formatThaiDateTime(selectedTeam.checkInTime) : 'ยังไม่เช็คอิน'}</div></div>
              <div><div className="text-xs text-[#667085]">กลุ่ม / สาย</div><div className="font-semibold">{selectedTeam.groupName || 'ยังไม่จัดสาย'}</div></div>
            </div>
            <div className="flex justify-end border-t border-[#E2DFD5] p-4 dark:border-[#25354C]"><button type="button" onClick={() => setSelectedTeam(null)} className="min-h-10 rounded-lg bg-[#142642] px-5 text-xs font-bold text-white">ปิด</button></div>
          </div>
        </div>
      )}

      {selectedMatch && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] shadow-xl overflow-hidden">
            <div className="p-4 border-b border-[#E2DFD5] dark:border-[#25354C] flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold">
                  จัดการแข่งขัน & บันทึกผล — {selectedMatch.matchCode}
                </h3>
                <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                  {selectedMatch.teamAName} vs {selectedMatch.teamBName}
                </p>
              </div>
              <button
                onClick={() => setSelectedMatch(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusIndicator
                  tone={selectedMatch.locked ? 'info' : selectedMatch.status === 'live' ? 'live' : 'neutral'}
                  label={selectedMatch.locked ? 'ผลถูกล็อกแล้ว' : selectedMatch.status}
                  compact
                />
                <span>
                  รอบ: {selectedMatch.stage === 'group' ? selectedMatch.groupName || 'รอบแบ่งกลุ่ม' : selectedMatch.stage}
                </span>
              </div>

              {/* Court & Umpire quick assign inside modal for unlocked matches */}
              {!selectedMatch.locked && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">สนามแข่งขัน</label>
                    <select
                      value={modalCourtId}
                      onChange={(e) => setModalCourtId(e.target.value)}
                      className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs"
                    >
                      <option value="">-- ยังไม่ระบุสนาม --</option>
                      {tournament.courts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">กรรมการผู้ตัดสิน</label>
                    <select
                      value={modalUmpireId}
                      onChange={(e) => setModalUmpireId(e.target.value)}
                      disabled={!hasPermission('assignUmpire')}
                      className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs disabled:opacity-50"
                    >
                      <option value="">-- เลือกกรรมการ --</option>
                      {tournamentUmpires.map((u) => {
                        const ownClub =
                          u.clubAffiliation === selectedMatch.teamAClub ||
                          u.clubAffiliation === selectedMatch.teamBClub;
                        return (
                          <option key={u.id} value={u.id}>
                            {u.firstName} {u.lastName}
                            {ownClub ? ' [สังกัดทีมเดียวกัน]' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>
              )}

              {/* Score editor */}
              <div className="space-y-2">
                <div className="text-xs font-semibold">
                  คะแนนแต่ละเซต ({selectedMatch.teamAName} vs {selectedMatch.teamBName})
                </div>
                {overrideScores.map((s, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <span className="text-xs font-mono w-14">เซต {idx + 1}</span>
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={s.a}
                      disabled={!canEditModalScores}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setOverrideScores((prev) =>
                          prev.map((item, sIdx) => (sIdx === idx ? { ...item, a: val } : item))
                        );
                      }}
                      className="w-20 min-h-[40px] px-2 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] font-mono text-center"
                    />
                    <span>-</span>
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={s.b}
                      disabled={!canEditModalScores}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setOverrideScores((prev) =>
                          prev.map((item, sIdx) => (sIdx === idx ? { ...item, b: val } : item))
                        );
                      }}
                      className="w-20 min-h-[40px] px-2 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] font-mono text-center"
                    />
                  </div>
                ))}
                {canEditModalScores &&
                  overrideScores.length <
                    (tournament.scoringRules.bestOfSets === 2 && selectedMatch.stage !== 'group'
                      ? 3
                      : tournament.scoringRules.bestOfSets || 3) && (
                  <button
                    type="button"
                    onClick={() => setOverrideScores([...overrideScores, { a: 0, b: 0 }])}
                    className="text-xs font-semibold text-[#156143]"
                  >
                    + เพิ่มเซต {overrideScores.length + 1}
                  </button>
                )}
              </div>

              {canEditModalScores && (
                <div>
                  <label className="block text-xs font-medium mb-1">ผลการแข่งขัน</label>
                  {overrideIsDraw ? (
                    <div className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs font-bold text-[#156143] dark:text-[#4ADE80] flex items-center">
                      เสมอ 1–1 เซต
                    </div>
                  ) : (
                    <select
                      value={overrideWinner === 'draw' ? 'A' : overrideWinner}
                      onChange={(e) => setOverrideWinner(e.target.value as 'A' | 'B')}
                      className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs"
                    >
                      <option value="A">{selectedMatch.teamAName}</option>
                      <option value="B">{selectedMatch.teamBName}</option>
                    </select>
                  )}
                  {tournament.scoringRules.bestOfSets === 2 && selectedMatch.stage === 'group' && (
                    <p className="mt-1 text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
                      หากแบ่งกันชนะทีมละ 1 เซต ระบบจะบันทึกเป็นผลเสมออัตโนมัติ
                    </p>
                  )}
                </div>
              )}

              {selectedMatch.locked && hasPermission('overrideLockedResult') && (
                <div>
                  <label className="block text-xs font-medium mb-1">
                    เหตุผลการแก้ผลที่ล็อกแล้ว (บังคับสำหรับ Audit Log) *
                  </label>
                  <input
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="เช่น แก้ไขคะแนนตามคำร้องและลายเซ็นกรรมการ"
                    className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs"
                  />
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 bg-[#F7F6F2] dark:bg-[#0B121C] border-t border-[#E2DFD5] dark:border-[#25354C] flex flex-wrap justify-end gap-2">
              <button
                onClick={() => setSelectedMatch(null)}
                className="min-h-[40px] px-4 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] text-xs font-medium"
              >
                ปิด
              </button>

              {!selectedMatch.locked && hasPermission('scoreMatch') ? (
                <>
                  <button
                    onClick={() => handleSaveQuickScore('live')}
                    className="min-h-[40px] px-4 rounded-lg bg-[#142642] text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>เริ่มแข่ง (Live)</span>
                  </button>
                  <button
                    onClick={() => handleSaveQuickScore('finished')}
                    className="min-h-[40px] px-4 rounded-lg bg-[#156143] text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>บันทึกผลจบแมตช์</span>
                  </button>
                </>
              ) : (
                selectedMatch.locked &&
                hasPermission('overrideLockedResult') && (
                  <button
                    onClick={handleSaveOverride}
                    className="min-h-[40px] px-4 rounded-lg bg-[#156143] text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>บันทึกการแก้ไขผล (Admin)</span>
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
