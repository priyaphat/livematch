import { MatchRecord, ScoringRules } from '../types/tournament';

export interface CourtPositions {
  A: [0 | 1, 0 | 1];
  B: [0 | 1, 0 | 1];
}

export type ManualSwapBySet = Record<string, { A: boolean; B: boolean }>;

export function getEffectiveTeamPlayers(match: MatchRecord, team: 'A' | 'B'): string[] {
  const players = team === 'A' ? match.teamAPlayers : match.teamBPlayers;
  if (match.format === 'singles') return players.slice(0, 1);
  return players;
}

export function getInitialCourtPositions(match: MatchRecord): CourtPositions {
  if (match.courtPositions) {
    return {
      A: [...match.courtPositions.A] as [0 | 1, 0 | 1],
      B: [...match.courtPositions.B] as [0 | 1, 0 | 1],
    };
  }
  const activeSet = match.sets[match.currentSet - 1] || { scoreA: 0, scoreB: 0 };
  const isEvenA = activeSet.scoreA % 2 === 0;
  const isEvenB = activeSet.scoreB % 2 === 0;

  let posA: [0 | 1, 0 | 1] = [0, 1];
  let posB: [0 | 1, 0 | 1] = [0, 1];

  if (match.servingTeam === 'A' && getEffectiveTeamPlayers(match, 'A').length > 1) {
    const idx = match.servingPlayerIndex === 1 ? 1 : 0;
    const other: 0 | 1 = idx === 0 ? 1 : 0;
    posA = isEvenA ? [idx, other] : [other, idx];
  } else if (match.servingTeam === 'B' && getEffectiveTeamPlayers(match, 'B').length > 1) {
    const idx = match.servingPlayerIndex === 1 ? 1 : 0;
    const other: 0 | 1 = idx === 0 ? 1 : 0;
    posB = isEvenB ? [idx, other] : [other, idx];
  }

  return { A: posA, B: posB };
}

export function getManualSwapsMap(match: MatchRecord): ManualSwapBySet {
  const cloned: ManualSwapBySet = {};
  if (match.manualServerSwaps) {
    for (const [k, v] of Object.entries(match.manualServerSwaps)) {
      cloned[k] = { A: Boolean(v?.A), B: Boolean(v?.B) };
    }
  }
  const key = String(match.currentSet || 1);
  if (!cloned[key]) {
    cloned[key] = { A: false, B: false };
  }
  return cloned;
}

export function getActiveCourtState(match: MatchRecord) {
  const activeSet = match.sets[match.currentSet - 1] || {
    setNumber: match.currentSet || 1,
    scoreA: 0,
    scoreB: 0,
  };
  const pos = getInitialCourtPositions(match);
  const swaps = getManualSwapsMap(match);
  const setKey = String(match.currentSet || 1);
  const servingTeam: 'A' | 'B' = match.servingTeam === 'B' ? 'B' : 'A';
  const receivingTeam: 'A' | 'B' = servingTeam === 'A' ? 'B' : 'A';
  const servingScore = servingTeam === 'A' ? activeSet.scoreA : activeSet.scoreB;
  const serviceBox: 'right' | 'left' = servingScore % 2 === 0 ? 'right' : 'left';

  const servingPlayers = getEffectiveTeamPlayers(match, servingTeam);
  const receivingPlayers = getEffectiveTeamPlayers(match, receivingTeam);

  const activeServerIndex: 0 | 1 =
    servingPlayers.length > 1
      ? serviceBox === 'right'
        ? pos[servingTeam][0]
        : pos[servingTeam][1]
      : 0;

  const expectedReceiverIndex: 0 | 1 =
    receivingPlayers.length > 1
      ? serviceBox === 'right'
        ? pos[receivingTeam][0]
        : pos[receivingTeam][1]
      : 0;

  return {
    courtPositions: pos,
    swapsInCurrentSet: swaps[setKey] || { A: false, B: false },
    servingTeam,
    receivingTeam,
    servingScore,
    serviceBox,
    activeServerIndex,
    expectedReceiverIndex,
  };
}

export interface SinglesCourtPresentation {
  team: 'A' | 'B';
  role: 'server' | 'receiver';
  playerName: string;
  serviceBox: 'right' | 'left';
  boxLabel: 'ขวา · คู่' | 'ซ้าย · คี่';
  roleLabel: 'เสิร์ฟ' | 'รับเสิร์ฟ';
}

export function getSinglesCourtPresentation(
  match: MatchRecord,
  team: 'A' | 'B'
): SinglesCourtPresentation {
  const court = getActiveCourtState(match);
  const role = court.servingTeam === team ? 'server' : 'receiver';
  const playerName = getEffectiveTeamPlayers(match, team)[0] ||
    (team === 'A' ? match.teamAName : match.teamBName);
  return {
    team,
    role,
    playerName,
    serviceBox: court.serviceBox,
    boxLabel: court.serviceBox === 'right' ? 'ขวา · คู่' : 'ซ้าย · คี่',
    roleLabel: role === 'server' ? 'เสิร์ฟ' : 'รับเสิร์ฟ',
  };
}

export function getServeLogDetail(match: MatchRecord): string {
  const court = getActiveCourtState(match);
  const serverPlayers = getEffectiveTeamPlayers(match, court.servingTeam);
  const receiverPlayers = getEffectiveTeamPlayers(match, court.receivingTeam);
  const serverName = serverPlayers[court.activeServerIndex] || serverPlayers[0] ||
    (court.servingTeam === 'A' ? match.teamAName : match.teamBName);
  const receiverName = receiverPlayers[court.expectedReceiverIndex] || receiverPlayers[0] ||
    (court.receivingTeam === 'A' ? match.teamAName : match.teamBName);
  const boxLabel = court.serviceBox === 'right' ? 'ขวา · คู่' : 'ซ้าย · คี่';
  return `ผู้เสิร์ฟ: ${serverName} (ทีม ${court.servingTeam} · ${boxLabel}) · ผู้รับ: ${receiverName} (ทีม ${court.receivingTeam} · ${boxLabel})`;
}

export function createSnapshotForUndo(match: MatchRecord) {
  const activeSet = match.sets[match.currentSet - 1] || { scoreA: 0, scoreB: 0 };
  const pos = getInitialCourtPositions(match);
  const swaps = getManualSwapsMap(match);
  return {
    status: match.status,
    scoreA: activeSet.scoreA,
    scoreB: activeSet.scoreB,
    servingTeam: match.servingTeam,
    servingPlayerIndex: match.servingPlayerIndex,
    courtPositions: pos,
    manualServerSwaps: swaps,
  };
}

export function restoreSnapshotForUndo(
  match: MatchRecord,
  snapshot: ReturnType<typeof createSnapshotForUndo>
) {
  const activeSet = match.sets[match.currentSet - 1] || match.sets[0];
  if (activeSet) {
    activeSet.scoreA = snapshot.scoreA;
    activeSet.scoreB = snapshot.scoreB;
  }
  match.status = snapshot.status;
  match.servingTeam = snapshot.servingTeam;
  match.servingPlayerIndex = match.format === 'singles' ? 0 : snapshot.servingPlayerIndex;
  match.courtPositions = match.format === 'singles'
    ? { A: [0, 1], B: [0, 1] }
    : {
        A: [...snapshot.courtPositions.A] as [0 | 1, 0 | 1],
        B: [...snapshot.courtPositions.B] as [0 | 1, 0 | 1],
      };
  match.manualServerSwaps = structuredClone(snapshot.manualServerSwaps);
}

export function applyBadmintonPoint(match: MatchRecord, scoringTeam: 'A' | 'B') {
  if (match.sets.length === 0) {
    match.sets = [{ setNumber: 1, scoreA: 0, scoreB: 0 }];
    match.currentSet = 1;
  }
  const activeSet = match.sets[match.currentSet - 1] || match.sets[match.sets.length - 1];
  const pos = getInitialCourtPositions(match);
  const wasServing = match.servingTeam === scoringTeam;

  if (scoringTeam === 'A') {
    activeSet.scoreA += 1;
  } else {
    activeSet.scoreB += 1;
  }

  const players = getEffectiveTeamPlayers(match, scoringTeam);
  if (wasServing && players.length > 1) {
    pos[scoringTeam] = [pos[scoringTeam][1], pos[scoringTeam][0]];
  }

  match.status = 'live';
  match.servingTeam = scoringTeam;
  match.courtPositions = pos;

  const newScore = scoringTeam === 'A' ? activeSet.scoreA : activeSet.scoreB;
  const serviceBox: 'right' | 'left' = newScore % 2 === 0 ? 'right' : 'left';
  match.servingPlayerIndex =
    players.length > 1 ? (serviceBox === 'right' ? pos[scoringTeam][0] : pos[scoringTeam][1]) : 0;

  return {
    wasServiceOver: !wasServing,
    serviceBox,
    serverName: players[match.servingPlayerIndex] || players[0] || '',
  };
}

export function applyManualTeamServeToggle(match: MatchRecord) {
  const pos = getInitialCourtPositions(match);
  const nextTeam: 'A' | 'B' = match.servingTeam === 'A' ? 'B' : 'A';
  const activeSet = match.sets[match.currentSet - 1] || { scoreA: 0, scoreB: 0 };
  const nextScore = nextTeam === 'A' ? activeSet.scoreA : activeSet.scoreB;
  const players = getEffectiveTeamPlayers(match, nextTeam);

  match.servingTeam = nextTeam;
  match.courtPositions = pos;
  match.servingPlayerIndex =
    players.length > 1 ? (nextScore % 2 === 0 ? pos[nextTeam][0] : pos[nextTeam][1]) : 0;
}

export function applyManualServerPlayerSwap(
  match: MatchRecord,
  targetTeam?: 'A' | 'B'
): { ok: true; swappedTeam: 'A' | 'B'; serverName: string } | { ok: false; error: string } {
  const team = targetTeam || match.servingTeam;
  const players = getEffectiveTeamPlayers(match, team);
  if (players.length < 2) {
    return {
      ok: false,
      error: 'ประเภทเดี่ยวมีผู้เล่น 1 คน ไม่สามารถสลับคนเสิร์ฟในทีมได้',
    };
  }

  const setKey = String(match.currentSet || 1);
  const swaps = getManualSwapsMap(match);
  if (swaps[setKey][team]) {
    return {
      ok: false,
      error: `ทีม ${team} ใช้สิทธิ์สลับคนเสิร์ฟในเซตที่ ${match.currentSet} ครบ 1 ครั้งแล้ว (ที่เหลือสลับอัตโนมัติตามกติกา)`,
    };
  }

  const pos = getInitialCourtPositions(match);
  pos[team] = [pos[team][1], pos[team][0]];
  swaps[setKey][team] = true;

  match.courtPositions = pos;
  match.manualServerSwaps = swaps;

  const activeSet = match.sets[match.currentSet - 1] || { scoreA: 0, scoreB: 0 };
  const teamScore = team === 'A' ? activeSet.scoreA : activeSet.scoreB;
  const activeIndex: 0 | 1 = teamScore % 2 === 0 ? pos[team][0] : pos[team][1];
  if (team === match.servingTeam) {
    match.servingPlayerIndex = activeIndex;
  }

  return {
    ok: true,
    swappedTeam: team,
    serverName: players[activeIndex] || players[0] || '',
  };
}

export function getSetWinnerByRules(
  scoreA: number,
  scoreB: number,
  rules?: ScoringRules
): 'A' | 'B' | null {
  if (scoreA === scoreB) return null;
  const target = rules?.pointsPerSet || 21;
  const maxCap = rules?.maxCapPoint || 30;
  const winByTwo = rules?.winByTwo ?? true;
  const settingEnabled = rules?.settingEnabled ?? true;
  const goldenPoint = rules?.goldenPoint ?? false;

  const hi = Math.max(scoreA, scoreB);
  const lo = Math.min(scoreA, scoreB);
  const leader: 'A' | 'B' = scoreA > scoreB ? 'A' : 'B';

  if (!settingEnabled || !winByTwo || goldenPoint) {
    return hi >= target ? leader : null;
  }
  if (hi >= maxCap) return leader;
  if (hi >= target && hi - lo >= 2) return leader;
  return null;
}

export type MatchOutcome = 'A' | 'B' | 'draw';

export function getMatchOutcomeByRules(
  sets: Array<{ scoreA: number; scoreB: number; winner?: 'A' | 'B' }>,
  rules: ScoringRules | undefined,
  stage: string
): MatchOutcome | null {
  const winners = sets
    .map((set) => set.winner || getSetWinnerByRules(set.scoreA, set.scoreB, rules))
    .filter((winner): winner is 'A' | 'B' => Boolean(winner));
  const winsA = winners.filter((winner) => winner === 'A').length;
  const winsB = winners.filter((winner) => winner === 'B').length;
  const bestOfSets = rules?.bestOfSets || 3;

  if (bestOfSets === 2) {
    if (winners.length < 2) return null;
    if (winsA === winsB) return stage.toLowerCase() === 'group' ? 'draw' : null;
    return winsA > winsB ? 'A' : 'B';
  }

  const requiredWins = Math.floor(bestOfSets / 2) + 1;
  if (winsA >= requiredWins) return 'A';
  if (winsB >= requiredWins) return 'B';
  return null;
}
