import { MatchFormatType, MatchTimelineEvent } from '../types/tournament';

export interface ScoreSheetRally {
  sequence: number;
  setNumber: number;
  winner: 'A' | 'B';
  scoreA: number;
  scoreB: number;
  serverTeam: 'A' | 'B';
  serverPlayerIndex: 0 | 1;
  receiverTeam: 'A' | 'B';
  receiverPlayerIndex: 0 | 1;
  serviceSide: 'ขวา' | 'ซ้าย';
}

const parseScore = (value: string): { scoreA: number; scoreB: number } | null => {
  const match = value.match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return null;
  return { scoreA: Number(match[1]), scoreB: Number(match[2]) };
};

const playerIndexAtBox = (
  event: MatchTimelineEvent,
  team: 'A' | 'B',
  boxIndex: 0 | 1,
  format: MatchFormatType
): 0 | 1 => {
  if (format === 'singles') return 0;
  const positions = event.undoSnapshot?.courtPositions?.[team];
  return positions?.[boxIndex] === 1 ? 1 : 0;
};

/**
 * Timeline is stored newest-first. Build the effective point sequence in play
 * order and reconcile undo events back to their authoritative score snapshot.
 */
export function buildScoreSheetRallies(
  timeline: MatchTimelineEvent[],
  format: MatchFormatType
): ScoreSheetRally[] {
  const ralliesBySet = new Map<number, ScoreSheetRally[]>();

  [...timeline].reverse().forEach((event) => {
    const score = parseScore(event.scoreSnapshot || '');
    if (!score) return;
    const setNumber = Math.max(1, event.setNumber || 1);
    const setRallies = ralliesBySet.get(setNumber) || [];

    if (event.type === 'undo') {
      while (setRallies.length > 0) {
        const latest = setRallies[setRallies.length - 1];
        if (latest.scoreA === score.scoreA && latest.scoreB === score.scoreB) break;
        setRallies.pop();
      }
      ralliesBySet.set(setNumber, setRallies);
      return;
    }

    if (event.type !== 'point_A' && event.type !== 'point_B') return;
    const winner = event.type === 'point_A' ? 'A' : 'B';
    const snapshot = event.undoSnapshot;
    const serverTeam = snapshot?.servingTeam === 'B' ? 'B' : 'A';
    const receiverTeam = serverTeam === 'A' ? 'B' : 'A';
    const serverScore = serverTeam === 'A'
      ? snapshot?.scoreA ?? Math.max(0, score.scoreA - (winner === 'A' ? 1 : 0))
      : snapshot?.scoreB ?? Math.max(0, score.scoreB - (winner === 'B' ? 1 : 0));
    const boxIndex: 0 | 1 = serverScore % 2 === 0 ? 0 : 1;

    setRallies.push({
      sequence: setRallies.length + 1,
      setNumber,
      winner,
      scoreA: score.scoreA,
      scoreB: score.scoreB,
      serverTeam,
      serverPlayerIndex: playerIndexAtBox(event, serverTeam, boxIndex, format),
      receiverTeam,
      receiverPlayerIndex: playerIndexAtBox(event, receiverTeam, boxIndex, format),
      serviceSide: boxIndex === 0 ? 'ขวา' : 'ซ้าย',
    });
    ralliesBySet.set(setNumber, setRallies);
  });

  return Array.from(ralliesBySet.entries())
    .sort(([a], [b]) => a - b)
    .flatMap(([, rallies]) => rallies.map((rally, index) => ({ ...rally, sequence: index + 1 })));
}
