import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { MatchRecord, MatchStage } from '../../types/tournament';
import { StatusIndicator, TeamLogoBadge } from './UIPrimitives';

const WINNER_STAGE_ORDER: MatchStage[] = ['R64', 'R32', 'R16', 'QF', 'SF', 'F', 'P3'];
const STAGE_LABELS: Partial<Record<MatchStage, string>> = {
  group: 'รอบแบ่งกลุ่ม',
  R64: 'รอบ 64',
  R32: 'รอบ 32',
  R16: 'รอบ 16',
  QF: 'รอบ 8 ทีม (QF)',
  SF: 'รอบรองชนะเลิศ (SF)',
  F: 'รอบชิงชนะเลิศ (Final)',
  P3: 'ชิงอันดับ 3–4',
  GF: 'Grand Final',
  GF_RESET: 'Grand Final Reset',
};

const stageLabel = (stage: MatchStage) =>
  STAGE_LABELS[stage] || (stage.startsWith('LB') ? `สายแพ้ รอบ ${stage.slice(2)}` : stage);

export const KnockoutBracketCanvas: React.FC<{
  matches: MatchRecord[];
  onSelectMatch?: (match: MatchRecord) => void;
  title?: string;
  kioskMode?: boolean;
  teamLogos?: Record<string, string>;
}> = ({ matches, onSelectMatch, title, kioskMode = false, teamLogos = {} }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 24, y: 24 });
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [cssFullscreen, setCssFullscreen] = useState(false);

  const isFullscreen = nativeFullscreen || cssFullscreen;

  const koMatches = matches.filter((m) => m.stage !== 'group');
  const loserStages = Array.from(new Set(
    koMatches.map((match) => match.stage).filter((stage) => stage.startsWith('LB'))
  )).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
  const presentStages = [
    ...WINNER_STAGE_ORDER.filter((stage) => koMatches.some((match) => match.stage === stage)),
    ...loserStages,
    ...(['GF', 'GF_RESET'] as MatchStage[]).filter((stage) => koMatches.some((match) => match.stage === stage)),
  ];

  // Layout geometry per round
  const COL_WIDTH = 260;
  const COL_GAP = 72;
  const CARD_HEIGHT = 96;
  const BASE_GAP = 24;

  const firstRoundCount =
    presentStages.length > 0
      ? koMatches.filter((m) => m.stage === presentStages[0]).length
      : 1;
  const canvasWidth = Math.max(
    320,
    presentStages.length * COL_WIDTH + Math.max(0, presentStages.length - 1) * COL_GAP
  );
  const canvasHeight = Math.max(
    240,
    40 + firstRoundCount * (CARD_HEIGHT + BASE_GAP) - BASE_GAP + 16
  );

  // Compute node coordinates for SVG lines
  const nodePositions = new Map<string, { x: number; y: number; stageIdx: number }>();
  presentStages.forEach((stage, stageIdx) => {
    const stageMatches = koMatches
      .filter((m) => m.stage === stage)
      .sort((a, b) => (a.bracketOrder || 0) - (b.bracketOrder || 0));

    const slotHeight = (CARD_HEIGHT + BASE_GAP) * Math.pow(2, stageIdx);
    stageMatches.forEach((m, idx) => {
      const x = stageIdx * (COL_WIDTH + COL_GAP);
      const y = 40 + idx * slotHeight + (slotHeight - CARD_HEIGHT) / 2 - BASE_GAP / 2;
      nodePositions.set(m.id, { x, y, stageIdx });
    });
  });

  const fitToScreen = useCallback(() => {
    const el = surfaceRef.current || containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const padX = isFullscreen ? 64 : 32;
    const padY = isFullscreen ? 48 : 32;
    const scaleX = (rect.width - padX) / canvasWidth;
    const scaleY = (rect.height - padY) / canvasHeight;
    const maxZoom = isFullscreen ? 1.55 : 1.15;
    const nextZoom = Math.max(0.35, Math.min(maxZoom, Number(Math.min(scaleX, scaleY).toFixed(2))));

    const scaledW = canvasWidth * nextZoom;
    const scaledH = canvasHeight * nextZoom;
    const panX = Math.max(16, Math.round((rect.width - scaledW) / 2));
    const panY = Math.max(16, Math.round((rect.height - scaledH) / 2));

    setZoom(nextZoom);
    setPan({ x: panX, y: panY });
  }, [canvasWidth, canvasHeight, isFullscreen]);

  // Keep native fullscreen state synced even when user presses ESC
  useEffect(() => {
    const handleFsChange = () => {
      const active = document.fullscreenElement === containerRef.current;
      setNativeFullscreen(active);
      if (!active) {
        setCssFullscreen(false);
      }
      requestAnimationFrame(() => {
        setTimeout(() => fitToScreen(), 50);
      });
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, [fitToScreen]);

  // Refit whenever surface resizes (e.g. sidebar animation, fullscreen toggle, window resize)
  useEffect(() => {
    fitToScreen();
    const el = surfaceRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      fitToScreen();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToScreen]);

  // Allow ESC key to close CSS fallback fullscreen
  useEffect(() => {
    if (!cssFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCssFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cssFullscreen]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button[data-match-card="true"]')) return;
    setDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({ x: dragStartRef.current.panX + dx, y: dragStartRef.current.panY + dy });
  };

  const handlePointerUp = () => {
    setDragging(false);
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (isFullscreen) {
      if (document.fullscreenElement) {
        await document.exitFullscreen?.().catch(() => {});
      }
      setNativeFullscreen(false);
      setCssFullscreen(false);
      return;
    }

    try {
      if (containerRef.current.requestFullscreen) {
        await containerRef.current.requestFullscreen();
        setNativeFullscreen(true);
      } else {
        setCssFullscreen(true);
      }
    } catch {
      // Fallback to viewport-filling fixed fullscreen if browser/iframe blocks native Fullscreen API
      setCssFullscreen(true);
    }
  };

  const getMatchTone = (m: MatchRecord) => {
    if (m.status === 'live') return { tone: 'live' as const, label: 'Live' };
    if (m.status === 'finished') return { tone: 'success' as const, label: 'จบแล้ว' };
    if (m.status === 'walkover' || m.isBye) return { tone: 'warning' as const, label: m.isBye ? 'BYE' : 'Walkover' };
    if (m.status === 'not_required') return { tone: 'neutral' as const, label: 'ไม่ต้องแข่ง' };
    if (m.status === 'awaiting_confirmation') return { tone: 'warning' as const, label: 'รอยืนยันผล' };
    return { tone: 'neutral' as const, label: 'รอแข่งขัน' };
  };

  return (
    <div
      ref={containerRef}
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 w-screen h-[100dvh] bg-[#F7F6F2] dark:bg-[#0B121C] overflow-hidden flex flex-col'
          : kioskMode
          ? 'rounded-2xl border border-white/10 bg-[#08101A] text-slate-100 overflow-hidden flex flex-col flex-1 min-h-[calc(100dvh-2.5rem)]'
          : 'rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] overflow-hidden flex flex-col'
      }
    >
      {/* Toolbar */}
      <div
        className={`px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-2 shrink-0 ${
          kioskMode
            ? 'bg-[#0C1624] border-white/10 text-slate-100'
            : 'bg-white dark:bg-[#131E2E] border-[#E2DFD5] dark:border-[#25354C]'
        }`}
      >
        <div
          className={`text-xs font-semibold ${
            kioskMode ? 'text-slate-100' : 'text-[#141D2B] dark:text-[#F3F5F8]'
          }`}
        >
          {title || 'สายแข่งขัน Knockout (ลากเพื่อเลื่อนดู หรือซูมเข้า-ออก)'}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.35, Number((z - 0.15).toFixed(2))))}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
            aria-label="ซูมออก"
            title="ซูมออก"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono tabular-nums w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(1.8, Number((z + 0.15).toFixed(2))))}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
            aria-label="ซูมเข้า"
            title="ซูมเข้า"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={fitToScreen}
            className="min-h-[36px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] text-xs font-medium inline-flex items-center gap-1 hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Fit</span>
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className={`min-h-[36px] px-2.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
              isFullscreen
                ? 'border-[#156143] bg-[#156143] text-white hover:bg-[#104D35]'
                : 'border-[#E2DFD5] dark:border-[#25354C] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]'
            }`}
            aria-label={isFullscreen ? 'ออกจากเต็มหน้าจอ' : 'เต็มหน้าจอ'}
            title={isFullscreen ? 'ออกจากเต็มหน้าจอ' : 'เต็มหน้าจอ'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            {isFullscreen && <span>ออกเต็มจอ</span>}
          </button>
        </div>
      </div>

      {/* Interactive Pan/Zoom Surface */}
      {presentStages.length === 0 ? (
        <div className="p-10 text-center text-sm text-[#525C6B] dark:text-[#9AA8BC] flex-1 flex items-center justify-center">
          ยังไม่มีข้อมูลสาย Knockout สำหรับประเภทนี้ (สามารถกด “สร้างสาย” หรือ “สุ่มสาย” เพื่อสร้างได้)
        </div>
      ) : (
        <div
          ref={surfaceRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={(e) => {
            if (!isFullscreen) return;
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.08 : -0.08;
            setZoom((z) => Math.max(0.35, Math.min(1.8, Number((z + delta).toFixed(2)))));
          }}
          className={`relative w-full overflow-hidden touch-none select-none ${
            isFullscreen || kioskMode ? 'flex-1 min-h-0' : 'h-[480px] md:h-[540px]'
          } ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        >
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              width: `${canvasWidth}px`,
              height: `${canvasHeight}px`,
            }}
            className="relative transition-transform duration-75 ease-out"
          >
            {/* Stage Headers */}
            {presentStages.map((st, idx) => (
              <div
                key={st}
                style={{ left: `${idx * (COL_WIDTH + COL_GAP)}px`, width: `${COL_WIDTH}px` }}
                className="absolute top-0 text-xs font-bold text-[#142642] dark:text-[#CBD5E1] pb-1 border-b border-[#D5D1C5] dark:border-[#25354C]"
              >
                {stageLabel(st)}
              </div>
            ))}

            {/* Connector SVG Layer */}
            <svg
              width={canvasWidth}
              height={canvasHeight}
              className="absolute inset-0 pointer-events-none"
            >
              {koMatches.map((m) => {
                if (!m.nextMatchId) return null;
                const from = nodePositions.get(m.id);
                const to = nodePositions.get(m.nextMatchId);
                if (!from || !to) return null;
                const startX = from.x + COL_WIDTH;
                const startY = from.y + CARD_HEIGHT / 2;
                const endX = to.x;
                const endY = to.y + CARD_HEIGHT / 2;
                const midX = startX + COL_GAP / 2;
                return (
                  <path
                    key={`edge-${m.id}-${m.nextMatchId}`}
                    d={`M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-[#C8C3B4] dark:text-[#354B6B]"
                  />
                );
              })}
              {koMatches.map((m) => {
                if (!m.nextLoserMatchId) return null;
                const from = nodePositions.get(m.id);
                const to = nodePositions.get(m.nextLoserMatchId);
                if (!from || !to) return null;
                const startX = from.x + COL_WIDTH;
                const startY = from.y + CARD_HEIGHT / 2;
                const endX = to.x;
                const endY = to.y + CARD_HEIGHT / 2;
                const midX = startX + Math.max(24, (endX - startX) / 2);
                return (
                  <path
                    key={`loser-edge-${m.id}-${m.nextLoserMatchId}`}
                    d={`M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray="6 5"
                    className="text-[#D97706] dark:text-[#F59E0B]"
                  />
                );
              })}
            </svg>

            {/* Match Nodes */}
            {koMatches.map((m) => {
              const pos = nodePositions.get(m.id);
              if (!pos) return null;
              const badge = getMatchTone(m);
              const scoreSummary = (team: 'A' | 'B') =>
                m.sets
                  .map((s) => (team === 'A' ? s.scoreA : s.scoreB))
                  .join(' · ');

              return (
                <button
                  key={m.id}
                  type="button"
                  data-match-card="true"
                  onClick={() => onSelectMatch?.(m)}
                  style={{
                    left: `${pos.x}px`,
                    top: `${pos.y}px`,
                    width: `${COL_WIDTH}px`,
                    height: `${CARD_HEIGHT}px`,
                  }}
                  className={`absolute text-left rounded-xl border bg-white dark:bg-[#131E2E] p-2.5 flex flex-col justify-between transition-shadow hover:shadow-md ${
                    m.status === 'live'
                      ? 'border-[#156143] dark:border-[#229A6B] ring-1 ring-[#156143]/30'
                      : 'border-[#E2DFD5] dark:border-[#25354C]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-mono font-bold text-[#525C6B] dark:text-[#9AA8BC]">
                      {m.matchCode} · {m.scheduledTime}
                    </span>
                    <StatusIndicator tone={badge.tone} label={badge.label} compact />
                  </div>

                  <div className="space-y-1 text-xs">
                    <div
                      className={`flex items-center justify-between gap-2 ${
                        m.winner === 'A' ? 'font-bold text-[#156143] dark:text-[#229A6B]' : ''
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <TeamLogoBadge
                          teamName={m.teamAName || 'รอผู้ชนะ'}
                          logoUrl={teamLogos[m.teamAId] || teamLogos[m.teamAName]}
                          size="xs"
                        />
                        <span className="truncate">{m.teamAName || 'รอผู้ชนะ'}</span>
                      </div>
                      <span className="font-mono tabular-nums shrink-0">{scoreSummary('A')}</span>
                    </div>
                    <div
                      className={`flex items-center justify-between gap-2 ${
                        m.winner === 'B' ? 'font-bold text-[#156143] dark:text-[#229A6B]' : ''
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <TeamLogoBadge
                          teamName={m.teamBName || 'รอผู้ชนะ'}
                          logoUrl={teamLogos[m.teamBId] || teamLogos[m.teamBName]}
                          size="xs"
                        />
                        <span className="truncate">{m.teamBName || 'รอผู้ชนะ'}</span>
                      </div>
                      <span className="font-mono tabular-nums shrink-0">{scoreSummary('B')}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Public/share views can receive either a legacy combined bracket or the two
 * placement brackets created after group play. Keep them as separate canvases
 * so rounds with the same stage (SF/F) never overlap visually.
 */
export const PlacementAwareKnockoutBrackets: React.FC<
  React.ComponentProps<typeof KnockoutBracketCanvas>
> = (props) => {
  const championship = props.matches.filter((match) => match.placementBracket === 'championship');
  const thirdPlace = props.matches.filter((match) => match.placementBracket === 'third_place');
  if (championship.length === 0 && thirdPlace.length === 0) {
    return <KnockoutBracketCanvas {...props} />;
  }
  const baseTitle = props.title ? `${props.title} · ` : '';
  return (
    <div className="space-y-4">
      {championship.length > 0 && (
        <KnockoutBracketCanvas
          {...props}
          matches={championship}
          title={`${baseTitle}สายอันดับ 1 ของกลุ่ม · ชิงอันดับ 1–2`}
        />
      )}
      {thirdPlace.length > 0 && (
        <KnockoutBracketCanvas
          {...props}
          matches={thirdPlace}
          title={`${baseTitle}สายอันดับ 2 ของกลุ่ม · ชิงอันดับ 3–4`}
        />
      )}
    </div>
  );
};
