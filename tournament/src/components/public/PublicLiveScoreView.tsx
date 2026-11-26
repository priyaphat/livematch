import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Copy,
  ExternalLink,
  GitBranch,
  Megaphone,
  Monitor,
  QrCode,
  Search,
  ShieldCheck,
  Tv,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { PWAInstallButton } from '../../hooks/usePWAInstall';
import { apiFetch } from '../../services/api';
import { MatchRecord, Tournament } from '../../types/tournament';
import { PlacementAwareKnockoutBrackets } from '../common/KnockoutBracketCanvas';
import {
  buildTeamLogoMap,
  EmergencyPauseBanner,
  EmptyStateCard,
  QRCodeMatrix,
  StatusIndicator,
  TeamLogoBadge,
} from '../common/UIPrimitives';

interface PublicTeamSummary {
  id: string;
  teamName: string;
  teamLogoUrl?: string;
}

interface PublicStateResponse {
  tournaments: Tournament[];
  teams?: PublicTeamSummary[];
  matches: MatchRecord[];
  serverTime: string;
  streamCursor?: number;
}

function tabLabelsForManifest(tab: 'center' | 'live' | 'bracket' | 'venue') {
  return ({ center: 'LM Match Center', live: 'LM Live Score', bracket: 'LM Bracket', venue: 'LM Venue TV' } as const)[tab];
}

const isPublicCompletedMatch = (match: MatchRecord) =>
  ['finished', 'walkover', 'retired', 'disqualified'].includes(match.status);

export const PublicLiveScoreView: React.FC = () => {
  const {
    state,
    selectedTournamentId,
    publicInitialTab,
    setPublicInitialTab,
    publicFocusMatchId,
    isPublicKiosk,
    notify,
  } = useApp();

  const [tab, setTab] = useState<'center' | 'live' | 'bracket' | 'venue'>(publicInitialTab);
  const [focusMatchId, setFocusMatchId] = useState<string | null>(publicFocusMatchId);
  const [publicData, setPublicData] = useState<PublicStateResponse | null>(null);
  const [publicSseConnected, setPublicSseConnected] = useState(false);
  const [showTabPwaModal, setShowTabPwaModal] = useState(false);

  const [search, setSearch] = useState('');
  const [filterDiv, setFilterDiv] = useState('all');
  const [bracketDivisionId, setBracketDivisionId] = useState(() =>
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('division') || ''
      : ''
  );
  const [filterCourt, setFilterCourt] = useState('all');

  // Venue Display TV auto-rotate
  const [tvAutoRotate, setTvAutoRotate] = useState(true);
  const [tvSlide, setTvSlide] = useState<'courts' | 'queue'>('courts');

  useEffect(() => {
    setTab(publicInitialTab);
  }, [publicInitialTab]);

  useEffect(() => {
    if (publicFocusMatchId) setFocusMatchId(publicFocusMatchId);
  }, [publicFocusMatchId]);

  const publicToken = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('tournament') || ''
    : '';

  // Initial scrubbed bootstrap; subsequent score changes arrive as small SSE deltas.
  useEffect(() => {
    apiFetch<PublicStateResponse>('/api/public/bootstrap')
      .then((res) => setPublicData(res))
      .catch(() => {});
  }, [publicToken]);

  useEffect(() => {
    if (!publicToken) return;
    const stream = new EventSource(`/api/public-tournament/events?token=${encodeURIComponent(publicToken)}`);
    stream.addEventListener('connected', () => setPublicSseConnected(true));
    stream.addEventListener('match_update', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { match: MatchRecord };
        setPublicData((previous) => previous ? {
          ...previous,
          matches: previous.matches.some((match) => match.id === payload.match.id)
            ? previous.matches.map((match) => match.id === payload.match.id ? payload.match : match)
            : [...previous.matches, payload.match],
          serverTime: new Date().toISOString(),
        } : previous);
      } catch {
        // Ignore malformed frames; EventSource will continue with the next event.
      }
    });
    stream.addEventListener('draw_published', () => {
      void apiFetch<PublicStateResponse>('/api/public/bootstrap').then(setPublicData).catch(() => {});
    });
    stream.onerror = () => setPublicSseConnected(false);
    return () => stream.close();
  }, [publicToken]);

  useEffect(() => {
    if (!publicToken) return;
    let manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!manifest) {
      manifest = document.createElement('link');
      manifest.rel = 'manifest';
      document.head.appendChild(manifest);
    }
    manifest.href = `/api/public-tournament/manifest.webmanifest?token=${encodeURIComponent(publicToken)}&app=${tab}`;
    document.title = `${tabLabelsForManifest(tab)} · LiveMatch`;
    const appleTitle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    if (appleTitle) appleTitle.content = tabLabelsForManifest(tab);
  }, [publicToken, tab]);

  useEffect(() => {
    if (!tvAutoRotate || tab !== 'venue') return;
    const timer = setInterval(() => {
      setTvSlide((s) => (s === 'courts' ? 'queue' : 'courts'));
    }, 8000);
    return () => clearInterval(timer);
  }, [tvAutoRotate, tab]);

  const tournaments = publicData?.tournaments || state.tournaments;
  const activeTournament =
    tournaments.find((t) => t.id === selectedTournamentId) || tournaments[0];
  const enabledDivisions = useMemo(
    () => activeTournament?.divisions.filter((division) => division.enabled) || [],
    [activeTournament?.divisions]
  );

  useEffect(() => {
    if (filterDiv !== 'all' && !enabledDivisions.some((division) => division.id === filterDiv)) {
      setFilterDiv('all');
    }
  }, [enabledDivisions, filterDiv]);

  useEffect(() => {
    if (!enabledDivisions.length) return;
    if (!enabledDivisions.some((division) => division.id === bracketDivisionId)) {
      setBracketDivisionId(enabledDivisions[0].id);
    }
  }, [enabledDivisions, bracketDivisionId]);

  const selectBracketDivision = (divisionId: string) => {
    setBracketDivisionId(divisionId);
    const params = new URLSearchParams(window.location.search);
    params.set('division', divisionId);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  };

  const allMatches = useMemo(() => {
    const src = publicData?.matches || state.matches;
    return src.filter((m) => m.tournamentId === activeTournament?.id);
  }, [publicData, state.matches, activeTournament?.id]);

  const teamLogos = useMemo(() => {
    const teamSrc =
      publicData?.teams && publicData.teams.length > 0
        ? publicData.teams
        : state.players;
    return buildTeamLogoMap(teamSrc);
  }, [publicData?.teams, state.players]);

  const getTeamLogo = (teamId: string, teamName: string) =>
    teamLogos[teamId] || teamLogos[teamName];

  const filteredMatches = useMemo(() => {
    return allMatches.filter((m) => {
      if (filterDiv !== 'all' && m.divisionId !== filterDiv) return false;
      if (filterCourt !== 'all' && m.courtId !== filterCourt) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hit =
          m.teamAName.toLowerCase().includes(q) ||
          m.teamBName.toLowerCase().includes(q) ||
          m.matchCode.toLowerCase().includes(q) ||
          m.teamAPlayers.some((p) => p.toLowerCase().includes(q)) ||
          m.teamBPlayers.some((p) => p.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [allMatches, filterDiv, filterCourt, search]);

  const liveMatches = useMemo(
    () => filteredMatches.filter((m) => m.status === 'live' || m.status === 'interval'),
    [filteredMatches]
  );

  const nextLimit = activeTournament?.publicViewConfig.nextMatchesCount || 4;
  const upcomingMatches = useMemo(
    () =>
      filteredMatches
        .filter((m) => m.status === 'scheduled' || m.status === 'calling')
        .slice(0, nextLimit),
    [filteredMatches, nextLimit]
  );

  const finishedMatches = useMemo(
    () => filteredMatches.filter(isPublicCompletedMatch),
    [filteredMatches]
  );

  const focusedMatch =
    allMatches.find((m) => m.id === focusMatchId) || liveMatches[0] || allMatches[0];

  const bracketDivId = bracketDivisionId || enabledDivisions[0]?.id || '';
  const bracketMatches = useMemo(
    () => allMatches.filter((m) => m.divisionId === bracketDivId),
    [allMatches, bracketDivId]
  );

  if (!activeTournament) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <EmptyStateCard
          title="ไม่พบรายการแข่งขันสาธารณะที่เปิดแสดง"
          description="ผู้จัดอาจปิด Public View ชั่วคราว"
        />
      </div>
    );
  }

  const tabLabels: Record<'center' | 'live' | 'bracket' | 'venue', string> = {
    center: 'Match Center',
    live: 'Live Match View',
    bracket: 'Bracket View',
    venue: 'Venue Display (TV)',
  };

  const tabKioskUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?mode=public&tournament=${encodeURIComponent(
          publicToken
        )}&tab=${tab}&kiosk=1${tab === 'bracket' && bracketDivId ? `&division=${encodeURIComponent(bracketDivId)}` : ''}`
      : `/?mode=public&tournament=${publicToken}&tab=${tab}&kiosk=1`;

  // =========================================================================
  // STANDALONE CHROMELESS PWA KIOSK MODE (Zero logos, zero checkboxes/filters)
  // =========================================================================
  if (isPublicKiosk) {
    const kioskLiveMatches = allMatches.filter((m) => m.status === 'live' || m.status === 'interval');
    const kioskUpcomingMatches = allMatches
      .filter((m) => m.status === 'scheduled' || m.status === 'calling')
      .slice(0, Math.max(nextLimit, 6));
    const kioskFinishedMatches = allMatches
      .filter(isPublicCompletedMatch)
      .slice(0, 6);
    const kioskFocusedMatch =
      allMatches.find((m) => m.id === focusMatchId) || kioskLiveMatches[0] || allMatches[0];
    const kioskBracketDivId = bracketDivId;
    const kioskBracketMatches = allMatches.filter((m) => m.divisionId === kioskBracketDivId);

    const renderSetsPips = (m: MatchRecord, side: 'A' | 'B') => {
      const won = m.sets.filter((s) => s.winner === side).length;
      const totalNeeded = 2;
      return (
        <span className="inline-flex items-center gap-1" aria-label={`ชนะ ${won} เซต`}>
          {Array.from({ length: totalNeeded }).map((_, i) => (
            <span
              key={i}
              className={`w-2.5 h-2.5 rounded-xs transition-colors duration-300 ${
                i < won ? 'bg-[#229A6B]' : 'bg-white/15'
              }`}
            />
          ))}
        </span>
      );
    };

    return (
      <div className="relative min-h-[100dvh] w-full bg-[#070E17] text-[#F3F5F8] overflow-x-hidden flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        {/* Subtle Architectural Court Lines Backdrop */}
        <svg
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 w-full h-full opacity-[0.04]"
          viewBox="0 0 1200 720"
          preserveAspectRatio="xMidYMid slice"
        >
          <rect x="80" y="60" width="1040" height="600" fill="none" stroke="currentColor" strokeWidth="2" />
          <line x1="600" y1="60" x2="600" y2="660" stroke="currentColor" strokeWidth="2" strokeDasharray="8 8" />
          <line x1="410" y1="60" x2="410" y2="660" stroke="currentColor" strokeWidth="1.5" />
          <line x1="790" y1="60" x2="790" y2="660" stroke="currentColor" strokeWidth="1.5" />
          <line x1="80" y1="115" x2="1120" y2="115" stroke="currentColor" strokeWidth="1.5" />
          <line x1="80" y1="605" x2="1120" y2="605" stroke="currentColor" strokeWidth="1.5" />
          <line x1="150" y1="60" x2="150" y2="660" stroke="currentColor" strokeWidth="1.5" />
          <line x1="1050" y1="60" x2="1050" y2="660" stroke="currentColor" strokeWidth="1.5" />
          <line x1="80" y1="360" x2="410" y2="360" stroke="currentColor" strokeWidth="1.5" />
          <line x1="790" y1="360" x2="1120" y2="360" stroke="currentColor" strokeWidth="1.5" />
        </svg>

        {activeTournament.emergencyPaused && (
          <div className="relative z-10 px-4 pt-4">
            <EmergencyPauseBanner reason={activeTournament.emergencyReason} />
          </div>
        )}

        {/* KIOSK 1: MATCH CENTER */}
        {tab === 'center' && (
          <div className="relative z-10 flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 flex flex-col gap-6">
            {/* Live Matches Broadcast Grid */}
            <section className="space-y-3.5">
              <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                <h2 className="text-base sm:text-lg font-bold tracking-tight text-white">
                  กำลังแข่งขันสด ({kioskLiveMatches.length})
                </h2>
                <span className="text-xs font-mono text-white/60 tabular-nums">
                  {publicSseConnected ? 'LIVE SYNC' : 'RECONNECTING'}
                </span>
              </div>

              {kioskLiveMatches.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-[#0D1826]/90 p-10 text-center text-sm text-white/60 lm-card-enter">
                  ขณะนี้ยังไม่มีคู่ที่กำลังแข่งขัน
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {kioskLiveMatches.map((m, idx) => {
                    const activeSet = m.sets[m.currentSet - 1] || { scoreA: 0, scoreB: 0 };
                    const courtName =
                      activeTournament.courts.find((c) => c.id === m.courtId)?.name || m.courtId || '';
                    const divName =
                      activeTournament.divisions.find((d) => d.id === m.divisionId)?.nameTh || '';
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setFocusMatchId(m.id);
                          setTab('live');
                        }}
                        style={{ animationDelay: `${idx * 65}ms` }}
                        className="lm-card-enter text-left rounded-2xl bg-[#0D1826]/95 border border-white/10 hover:border-[#229A6B]/70 transition-colors overflow-hidden flex flex-col justify-between"
                      >
                        <div className="h-[2px] w-full bg-[#229A6B] lm-serve-breath" />
                        <div className="p-5 space-y-4">
                          <div className="flex items-center justify-between gap-2 text-xs text-white/65">
                            <span className="truncate font-medium">
                              {courtName} · {m.matchCode} · {divName}
                            </span>
                            <span className="font-mono font-semibold text-[#4ADE80] shrink-0">
                              เซต {m.currentSet}
                            </span>
                          </div>

                          <div className="space-y-3">
                            <div
                              className={`flex items-center justify-between gap-3 px-3 py-2 rounded-xl transition-colors duration-300 ${
                                m.servingTeam === 'A' ? 'bg-white/[0.05]' : ''
                              }`}
                            >
                              <div className="min-w-0 flex items-center gap-2.5">
                                <span
                                  className={`w-1 h-5 rounded-full transition-opacity duration-300 ${
                                    m.servingTeam === 'A' ? 'bg-[#EAB308] opacity-100' : 'opacity-0'
                                  }`}
                                />
                                <TeamLogoBadge
                                  teamName={m.teamAName}
                                  logoUrl={getTeamLogo(m.teamAId, m.teamAName)}
                                  size="md"
                                  highlight={m.servingTeam === 'A'}
                                />
                                <div className="min-w-0">
                                  <div className="text-base font-bold text-white truncate">
                                    {m.teamAName}
                                  </div>
                                  <div className="mt-0.5 flex items-center gap-2">
                                    {renderSetsPips(m, 'A')}
                                    {m.servingTeam === 'A' && (
                                      <span className="text-[11px] font-semibold text-[#FACC15]">
                                        เสิร์ฟ
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <span
                                key={`c-a-${m.id}-${activeSet.scoreA}`}
                                className="lm-score-pop text-4xl font-extrabold font-mono tabular-nums text-[#4ADE80] shrink-0"
                              >
                                {activeSet.scoreA}
                              </span>
                            </div>

                            <div
                              className={`flex items-center justify-between gap-3 px-3 py-2 rounded-xl transition-colors duration-300 ${
                                m.servingTeam === 'B' ? 'bg-white/[0.05]' : ''
                              }`}
                            >
                              <div className="min-w-0 flex items-center gap-2.5">
                                <span
                                  className={`w-1 h-5 rounded-full transition-opacity duration-300 ${
                                    m.servingTeam === 'B' ? 'bg-[#EAB308] opacity-100' : 'opacity-0'
                                  }`}
                                />
                                <TeamLogoBadge
                                  teamName={m.teamBName}
                                  logoUrl={getTeamLogo(m.teamBId, m.teamBName)}
                                  size="md"
                                  highlight={m.servingTeam === 'B'}
                                />
                                <div className="min-w-0">
                                  <div className="text-base font-bold text-white truncate">
                                    {m.teamBName}
                                  </div>
                                  <div className="mt-0.5 flex items-center gap-2">
                                    {renderSetsPips(m, 'B')}
                                    {m.servingTeam === 'B' && (
                                      <span className="text-[11px] font-semibold text-[#FACC15]">
                                        เสิร์ฟ
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <span
                                key={`c-b-${m.id}-${activeSet.scoreB}`}
                                className="lm-score-pop text-4xl font-extrabold font-mono tabular-nums text-white shrink-0"
                              >
                                {activeSet.scoreB}
                              </span>
                            </div>
                          </div>

                          <div className="pt-2 border-t border-white/10 flex items-center gap-3 text-[11px] font-mono text-white/55 tabular-nums">
                            {m.sets.map((s) => (
                              <span key={s.setNumber}>
                                S{s.setNumber}: {s.scoreA}-{s.scoreB}
                              </span>
                            ))}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Bottom Architectural Panels: Upcoming & Finished */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="lm-card-enter rounded-2xl border border-white/10 bg-[#0D1826]/90 p-5 space-y-3">
                <h3 className="text-sm font-bold text-white border-b border-white/10 pb-2.5">
                  คู่ถัดไป & เรียกนักกีฬา ({kioskUpcomingMatches.length})
                </h3>
                {kioskUpcomingMatches.length === 0 ? (
                  <p className="text-xs text-white/55 py-4 text-center">ไม่มีคู่รอแข่งขัน</p>
                ) : (
                  <div className="divide-y divide-white/10 text-xs">
                    {kioskUpcomingMatches.map((m) => (
                      <div key={m.id} className="py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex items-center gap-2.5">
                          <div className="flex -space-x-2 shrink-0">
                            <TeamLogoBadge
                              teamName={m.teamAName}
                              logoUrl={getTeamLogo(m.teamAId, m.teamAName)}
                              size="sm"
                            />
                            <TeamLogoBadge
                              teamName={m.teamBName}
                              logoUrl={getTeamLogo(m.teamBId, m.teamBName)}
                              size="sm"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-sm text-white truncate">
                              {m.matchCode} · {m.teamAName} vs {m.teamBName}
                            </div>
                            <div className="text-white/55 mt-0.5">
                              {activeTournament.courts.find((c) => c.id === m.courtId)?.name || 'รอจัดสนาม'} ·{' '}
                              {m.estimatedStart}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`text-xs font-bold shrink-0 ${
                            m.status === 'calling' ? 'text-[#FACC15]' : 'text-white/65'
                          }`}
                        >
                          {m.status === 'calling' ? 'เรียกนักกีฬา' : 'รอแข่ง'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="lm-card-enter rounded-2xl border border-white/10 bg-[#0D1826]/90 p-5 space-y-3">
                <h3 className="text-sm font-bold text-white border-b border-white/10 pb-2.5">
                  ผลการแข่งขันล่าสุด ({kioskFinishedMatches.length})
                </h3>
                {kioskFinishedMatches.length === 0 ? (
                  <p className="text-xs text-white/55 py-4 text-center">ยังไม่มีคู่ที่แข่งจบ</p>
                ) : (
                  <div className="divide-y divide-white/10 text-xs">
                    {kioskFinishedMatches.map((m) => (
                      <div key={m.id} className="py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex items-center gap-2.5">
                          <div className="flex -space-x-2 shrink-0">
                            <TeamLogoBadge
                              teamName={m.teamAName}
                              logoUrl={getTeamLogo(m.teamAId, m.teamAName)}
                              size="sm"
                            />
                            <TeamLogoBadge
                              teamName={m.teamBName}
                              logoUrl={getTeamLogo(m.teamBId, m.teamBName)}
                              size="sm"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-sm text-white truncate">
                              {m.matchCode} · {m.teamAName} vs {m.teamBName}
                            </div>
                            <div className="text-[#4ADE80] mt-0.5 font-medium truncate">
                              {m.winner === 'draw'
                                ? 'ผลการแข่งขัน: เสมอ'
                                : `ชนะ: ${m.winner === 'A' ? m.teamAName : m.teamBName}`}
                            </div>
                          </div>
                        </div>
                        <span className="font-mono font-bold text-sm text-white tabular-nums shrink-0">
                          {m.sets.map((s) => `${s.scoreA}-${s.scoreB}`).join(' · ') || 'WO'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* KIOSK 2: LIVE MATCH VIEW (Full-Viewport Broadcast Scoreboard) */}
        {tab === 'live' && kioskFocusedMatch && (() => {
          const curSet = kioskFocusedMatch.sets[kioskFocusedMatch.currentSet - 1] || {
            setNumber: kioskFocusedMatch.currentSet || 1,
            scoreA: 0,
            scoreB: 0,
          };
          const courtName =
            activeTournament.courts.find((c) => c.id === kioskFocusedMatch.courtId)?.name ||
            kioskFocusedMatch.courtId ||
            'สนามหลัก';
          const divName =
            activeTournament.divisions.find((d) => d.id === kioskFocusedMatch.divisionId)?.nameTh ||
            '';

          return (
            <div className="relative z-10 flex-1 w-full max-w-6xl mx-auto p-4 sm:p-8 lg:p-10 flex flex-col justify-between gap-6 lm-card-enter">
              {/* Top Quiet Metadata Line */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3 text-xs sm:text-sm text-white/75">
                <div className="font-medium truncate">
                  {courtName} · {kioskFocusedMatch.matchCode} · {divName}
                </div>
                <div className="flex items-center gap-3 font-mono shrink-0">
                  <span className="text-[#4ADE80] font-semibold lm-serve-breath">
                    {kioskFocusedMatch.status === 'live' ? 'LIVE' : kioskFocusedMatch.status.toUpperCase()}
                  </span>
                  <span className="text-white/30">|</span>
                  <span>เซตที่ {kioskFocusedMatch.currentSet}</span>
                </div>
              </div>

              {/* Monumental Arena Scoreboard */}
              <div className="rounded-3xl bg-[#0C1725]/95 border border-white/10 p-6 sm:p-10 lg:p-12 shadow-2xl space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-8 text-center">
                  {/* Team A */}
                  <div className="space-y-3 min-w-0 flex flex-col items-center">
                    <TeamLogoBadge
                      teamName={kioskFocusedMatch.teamAName}
                      logoUrl={getTeamLogo(kioskFocusedMatch.teamAId, kioskFocusedMatch.teamAName)}
                      size="xl"
                      highlight={kioskFocusedMatch.servingTeam === 'A'}
                    />
                    <div className="flex justify-center">{renderSetsPips(kioskFocusedMatch, 'A')}</div>
                    <h2 className="w-full text-2xl sm:text-3xl lg:text-4xl font-bold text-white tracking-tight truncate">
                      {kioskFocusedMatch.teamAName}
                    </h2>
                    <div className="w-full text-xs sm:text-sm text-white/60 truncate">
                      {kioskFocusedMatch.teamAPlayers.join(' / ')}
                    </div>
                    <div
                      className={`h-0.5 w-20 mx-auto rounded-full transition-all duration-300 ${
                        kioskFocusedMatch.servingTeam === 'A'
                          ? 'bg-[#EAB308] opacity-100 scale-x-100'
                          : 'bg-white/10 opacity-0 scale-x-50'
                      }`}
                    />
                    <div className="h-5 text-xs font-bold text-[#FACC15]">
                      {kioskFocusedMatch.servingTeam === 'A' ? 'กำลังเสิร์ฟ' : ''}
                    </div>
                  </div>

                  {/* Center Giant Tabular Score */}
                  <div className="flex items-center justify-center gap-5 sm:gap-8">
                    <div
                      key={`live-a-${curSet.scoreA}`}
                      className="lm-score-pop text-7xl sm:text-8xl lg:text-[9.5rem] font-extrabold font-mono tabular-nums leading-none text-[#FACC15]"
                    >
                      {curSet.scoreA}
                    </div>
                    <div className="text-3xl sm:text-5xl font-mono text-white/25 select-none">:</div>
                    <div
                      key={`live-b-${curSet.scoreB}`}
                      className="lm-score-pop text-7xl sm:text-8xl lg:text-[9.5rem] font-extrabold font-mono tabular-nums leading-none text-white"
                    >
                      {curSet.scoreB}
                    </div>
                  </div>

                  {/* Team B */}
                  <div className="space-y-3 min-w-0 flex flex-col items-center">
                    <TeamLogoBadge
                      teamName={kioskFocusedMatch.teamBName}
                      logoUrl={getTeamLogo(kioskFocusedMatch.teamBId, kioskFocusedMatch.teamBName)}
                      size="xl"
                      highlight={kioskFocusedMatch.servingTeam === 'B'}
                    />
                    <div className="flex justify-center">{renderSetsPips(kioskFocusedMatch, 'B')}</div>
                    <h2 className="w-full text-2xl sm:text-3xl lg:text-4xl font-bold text-white tracking-tight truncate">
                      {kioskFocusedMatch.teamBName}
                    </h2>
                    <div className="w-full text-xs sm:text-sm text-white/60 truncate">
                      {kioskFocusedMatch.teamBPlayers.join(' / ')}
                    </div>
                    <div
                      className={`h-0.5 w-20 mx-auto rounded-full transition-all duration-300 ${
                        kioskFocusedMatch.servingTeam === 'B'
                          ? 'bg-[#EAB308] opacity-100 scale-x-100'
                          : 'bg-white/10 opacity-0 scale-x-50'
                      }`}
                    />
                    <div className="h-5 text-xs font-bold text-[#FACC15]">
                      {kioskFocusedMatch.servingTeam === 'B' ? 'กำลังเสิร์ฟ' : ''}
                    </div>
                  </div>
                </div>

                {/* Set-by-Set Ledger Strip */}
                <div className="pt-5 border-t border-white/10 flex flex-wrap items-center justify-center gap-6 sm:gap-10 text-xs sm:text-sm font-mono tabular-nums text-white/75">
                  {kioskFocusedMatch.sets.map((s) => (
                    <div key={s.setNumber} className="flex items-center gap-2">
                      <span className="text-white/45">SET {s.setNumber}</span>
                      <span className="font-bold text-white">
                        {s.scoreA} – {s.scoreB}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quiet Recent Momentum Strip */}
              <div className="rounded-2xl border border-white/10 bg-[#0D1826]/85 px-5 py-3.5 space-y-2">
                <div className="text-xs font-semibold text-white/55">เหตุการณ์ล่าสุด</div>
                {kioskFocusedMatch.timeline.length === 0 ? (
                  <div className="text-xs text-white/45">รออัปเดตคะแนนจากสนาม...</div>
                ) : (
                  <div className="divide-y divide-white/10 text-xs">
                    {kioskFocusedMatch.timeline.slice(0, 4).map((ev) => (
                      <div key={ev.id} className="py-2 flex items-center justify-between gap-3">
                        <span className="truncate text-white/90">
                          <strong className="font-mono text-[#4ADE80] mr-2">S{ev.setNumber}</strong>
                          {ev.detail || ev.type}
                        </span>
                        <span className="font-mono tabular-nums text-white/55 shrink-0">
                          {ev.scoreSnapshot} · {ev.timestamp}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        {tab === 'live' && !kioskFocusedMatch && (
          <div className="relative z-10 flex-1 w-full max-w-4xl mx-auto p-6 flex items-center justify-center">
            <div className="lm-card-enter w-full rounded-3xl border border-white/10 bg-[#0D1826]/90 p-12 text-center space-y-2">
              <div className="text-lg font-bold text-white">ยังไม่มีแมตช์ในระบบ</div>
              <div className="text-sm text-white/60">หน้าจอจะอัปเดตคะแนนสดให้อัตโนมัติเมื่อเริ่มการแข่งขัน</div>
            </div>
          </div>
        )}

        {/* KIOSK 3: BRACKET VIEW (Zero filters, full-viewport pan/zoom canvas) */}
        {tab === 'bracket' && (
          <div className="relative z-10 flex-1 w-full p-3 sm:p-5 flex flex-col gap-3">
            <div className="flex justify-end">
              <label className="flex items-center gap-2 text-xs font-semibold text-white/70">
                <span>ระดับมือ</span>
                <select
                  value={kioskBracketDivId}
                  onChange={(event) => selectBracketDivision(event.target.value)}
                  className="min-h-[42px] max-w-[240px] rounded-lg border border-white/15 bg-[#0D1826] px-3 text-sm font-semibold text-white"
                >
                  {enabledDivisions.map((division) => (
                    <option key={division.id} value={division.id}>{division.nameTh}</option>
                  ))}
                </select>
              </label>
            </div>
            <PlacementAwareKnockoutBrackets
              kioskMode
              matches={kioskBracketMatches}
              teamLogos={teamLogos}
              title={`สายการแข่งขัน — ${
                activeTournament.divisions.find((d) => d.id === kioskBracketDivId)?.nameTh || ''
              }`}
            />
          </div>
        )}

        {/* KIOSK 4: VENUE DISPLAY (TV / Big Screen — Zero checkboxes, smooth auto-rotate) */}
        {tab === 'venue' && (
          <div className="relative z-10 flex-1 w-full max-w-[1440px] mx-auto p-4 sm:p-6 lg:p-8 flex flex-col gap-5">
            {/* Subtle top 8-second cycle sweep bar */}
            <div className="space-y-2">
              <div className="h-[2px] w-full bg-white/10 overflow-hidden rounded-full">
                <div
                  key={`sweep-${tvSlide}`}
                  className="lm-progress-sweep h-full w-full bg-[#229A6B]"
                />
              </div>
              <div className="flex items-center justify-between text-xs sm:text-sm text-white/70">
                <span className="font-semibold text-white">
                  {tvSlide === 'courts' ? 'คะแนนสดทุกสนาม' : 'คิวคู่ถัดไป & เรียกนักกีฬา'}
                </span>
                <span className="font-mono text-white/50 tabular-nums">
                  {tvSlide === 'courts' ? '1 / 2' : '2 / 2'}
                </span>
              </div>
            </div>

            {tvSlide === 'courts' ? (
              <div
                key="slide-courts"
                className="lm-slide-crossfade flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5 content-start"
              >
                {activeTournament.courts.map((c, idx) => {
                  const m = allMatches.find(
                    (item) =>
                      item.courtId === c.id && (item.status === 'live' || item.status === 'interval')
                  );
                  const nextForCourt = allMatches.find(
                    (item) =>
                      item.courtId === c.id &&
                      (item.status === 'calling' || item.status === 'scheduled')
                  );
                  const activeSet = m?.sets[m.currentSet - 1];
                  return (
                    <div
                      key={c.id}
                      style={{ animationDelay: `${idx * 55}ms` }}
                      className="lm-card-enter rounded-2xl bg-[#0D1826]/95 border border-white/10 p-6 flex flex-col justify-between gap-5 min-h-[210px]"
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
                        <span className="text-lg sm:text-xl font-bold text-[#FACC15]">
                          {c.name}
                        </span>
                        <span className="text-xs font-mono text-white/70">
                          {m ? `${m.matchCode} · เซต ${m.currentSet}` : 'สนามว่าง'}
                        </span>
                      </div>

                      {m ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0 flex items-center gap-2.5">
                              <span
                                className={`w-1.5 h-6 rounded-full ${
                                  m.servingTeam === 'A' ? 'bg-[#EAB308]' : 'bg-transparent'
                                }`}
                              />
                              <TeamLogoBadge
                                teamName={m.teamAName}
                                logoUrl={getTeamLogo(m.teamAId, m.teamAName)}
                                size="md"
                                highlight={m.servingTeam === 'A'}
                              />
                              <span className="text-lg sm:text-xl font-bold text-white truncate">
                                {m.teamAName}
                              </span>
                            </div>
                            <span
                              key={`tv-a-${m.id}-${activeSet?.scoreA ?? 0}`}
                              className="lm-score-pop text-4xl sm:text-5xl font-extrabold font-mono tabular-nums text-[#4ADE80] shrink-0"
                            >
                              {activeSet?.scoreA ?? 0}
                            </span>
                          </div>

                          <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0 flex items-center gap-2.5">
                              <span
                                className={`w-1.5 h-6 rounded-full ${
                                  m.servingTeam === 'B' ? 'bg-[#EAB308]' : 'bg-transparent'
                                }`}
                              />
                              <TeamLogoBadge
                                teamName={m.teamBName}
                                logoUrl={getTeamLogo(m.teamBId, m.teamBName)}
                                size="md"
                                highlight={m.servingTeam === 'B'}
                              />
                              <span className="text-lg sm:text-xl font-bold text-white truncate">
                                {m.teamBName}
                              </span>
                            </div>
                            <span
                              key={`tv-b-${m.id}-${activeSet?.scoreB ?? 0}`}
                              className="lm-score-pop text-4xl sm:text-5xl font-extrabold font-mono tabular-nums text-white shrink-0"
                            >
                              {activeSet?.scoreB ?? 0}
                            </span>
                          </div>
                        </div>
                      ) : nextForCourt ? (
                        <div className="py-3 space-y-2 text-center">
                          <div className="text-xs text-[#FACC15] font-semibold">คู่ถัดไปในสนามนี้</div>
                          <div className="flex items-center justify-center gap-2">
                            <TeamLogoBadge
                              teamName={nextForCourt.teamAName}
                              logoUrl={getTeamLogo(nextForCourt.teamAId, nextForCourt.teamAName)}
                              size="sm"
                            />
                            <span className="text-xs text-white/45">VS</span>
                            <TeamLogoBadge
                              teamName={nextForCourt.teamBName}
                              logoUrl={getTeamLogo(nextForCourt.teamBId, nextForCourt.teamBName)}
                              size="sm"
                            />
                          </div>
                          <div className="text-base font-bold text-white">
                            {nextForCourt.teamAName} vs {nextForCourt.teamBName}
                          </div>
                          <div className="text-xs font-mono text-white/55">
                            {nextForCourt.matchCode} · {nextForCourt.estimatedStart}
                          </div>
                        </div>
                      ) : (
                        <div className="py-6 text-center text-sm text-white/45">
                          เตรียมความพร้อมคู่ถัดไป
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                key="slide-queue"
                className="lm-slide-crossfade flex-1 rounded-2xl bg-[#0D1826]/95 border border-white/10 p-6 sm:p-8 space-y-5"
              >
                <div className="flex items-center gap-2.5 text-lg sm:text-xl font-bold text-[#FACC15] border-b border-white/10 pb-3">
                  <Megaphone className="w-5 h-5" />
                  <span>ประกาศเรียกนักกีฬา & คู่ถัดไป ({kioskUpcomingMatches.length} คู่)</span>
                </div>
                {kioskUpcomingMatches.length === 0 ? (
                  <div className="py-12 text-center text-sm text-white/55">
                    ยังไม่มีคู่รอแข่งขันในขณะนี้
                  </div>
                ) : (
                  <div className="divide-y divide-white/10">
                    {kioskUpcomingMatches.map((m, idx) => (
                      <div
                        key={m.id}
                        style={{ animationDelay: `${idx * 45}ms` }}
                        className="lm-card-enter py-4 flex items-center justify-between gap-4"
                      >
                        <div className="min-w-0 flex items-center gap-3">
                          <div className="flex -space-x-2 shrink-0">
                            <TeamLogoBadge
                              teamName={m.teamAName}
                              logoUrl={getTeamLogo(m.teamAId, m.teamAName)}
                              size="sm"
                            />
                            <TeamLogoBadge
                              teamName={m.teamBName}
                              logoUrl={getTeamLogo(m.teamBId, m.teamBName)}
                              size="sm"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="text-base sm:text-lg font-bold text-white truncate">
                              {m.matchCode}: {m.teamAName} vs {m.teamBName}
                            </div>
                            <div className="text-xs sm:text-sm text-white/60 mt-0.5">
                              {activeTournament.courts.find((c) => c.id === m.courtId)?.name || 'รอจัดสนาม'} ·{' '}
                              เวลาคาดการณ์ {m.estimatedStart}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`px-3.5 py-1.5 rounded-lg text-xs font-bold shrink-0 ${
                            m.status === 'calling'
                              ? 'bg-[#EAB308] text-[#142642]'
                              : 'bg-white/10 text-white'
                          }`}
                        >
                          {m.status === 'calling' ? 'ขอเชิญลงสนามด่วน' : 'เตรียมตัว'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5 space-y-5">
      {/* Public Banner & Tabs (Embedded Portal View) */}
      <div className="rounded-xl overflow-hidden border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E]">
        <div className="relative h-36 sm:h-44 w-full overflow-hidden bg-[#142642]">
          <img
            src={activeTournament.bannerUrl}
            alt={activeTournament.name}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover opacity-55"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
          <div className="absolute bottom-4 left-4 right-4 flex flex-col sm:flex-row sm:items-end justify-between gap-2 text-white">
            <div className="flex items-center gap-3">
              <img
                src={activeTournament.emblemUrl}
                alt="โลโก้รายการ"
                referrerPolicy="no-referrer"
                className="w-12 h-12 rounded-xl object-cover border border-white/30 shrink-0"
              />
              <div>
                <div className="text-xs opacity-90">
                  Public Live Score · {activeTournament.venue}
                </div>
                <h1 className="text-lg sm:text-xl font-bold">{activeTournament.name}</h1>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/50 border border-white/20">
                <span
                  className={`w-2 h-2 rounded-full ${
                    publicSseConnected ? 'bg-[#4ADE80]' : 'bg-[#FACC15]'
                  }`}
                />
                <span>{publicSseConnected ? 'ซิงค์คะแนนสดอัตโนมัติ' : 'กำลังเชื่อมต่อ'}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs + Per-Tab Standalone PWA Button */}
        <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 border-t border-[#E2DFD5] dark:border-[#25354C]">
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'center' as const, label: 'Match Center', icon: <Activity className="w-4 h-4" /> },
              { id: 'live' as const, label: 'Live Match View', icon: <Monitor className="w-4 h-4" /> },
              { id: 'bracket' as const, label: 'Bracket View', icon: <GitBranch className="w-4 h-4" /> },
              { id: 'venue' as const, label: 'Venue Display (TV)', icon: <Tv className="w-4 h-4" /> },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  setPublicInitialTab(t.id);
                }}
                className={`min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
                  tab === t.id
                    ? 'bg-[#156143] text-white'
                    : 'bg-[#F7F6F2] dark:bg-[#0B121C] text-[#141D2B] dark:text-[#F3F5F8] hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowTabPwaModal(true)}
              className="min-h-[38px] px-3 rounded-lg bg-[#142642] hover:bg-[#1E355C] text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <QrCode className="w-3.5 h-3.5 text-[#FACC15]" />
              <span>เปิด PWA หน้านี้ (เต็มจอไร้โลโก้)</span>
            </button>
            <div className="hidden xl:flex items-center gap-1.5 text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
              <ShieldCheck className="w-4 h-4 text-[#156143]" />
              <span>ซ่อนข้อมูลส่วนบุคคลตาม PDPA</span>
            </div>
          </div>
        </div>
      </div>

      {activeTournament.emergencyPaused && (
        <EmergencyPauseBanner reason={activeTournament.emergencyReason} />
      )}

      {/* 1. MATCH CENTER */}
      {tab === 'center' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-[#525C6B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาชื่อทีม หรือชื่อนักกีฬา..."
                className="w-full min-h-[42px] pl-9 pr-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs"
              />
            </div>
            <select
              value={filterDiv}
              onChange={(e) => setFilterDiv(e.target.value)}
              className="min-h-[42px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs"
            >
              <option value="all">ทุกระดับมือ</option>
              {enabledDivisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nameTh}
                </option>
              ))}
            </select>
            <select
              value={filterCourt}
              onChange={(e) => setFilterCourt(e.target.value)}
              className="min-h-[42px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs"
            >
              <option value="all">ทุกสนาม</option>
              {activeTournament.courts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Live Section */}
          <section className="space-y-3">
            <h2 className="text-base font-bold">กำลังแข่งขัน ({liveMatches.length})</h2>
            {liveMatches.length === 0 ? (
              <EmptyStateCard title="ไม่มีคู่ที่กำลังแข่งขันตามตัวกรอง" description="ลองเลือกตัวกรองทั้งหมด" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {liveMatches.map((m) => {
                  const activeSet = m.sets[m.currentSet - 1] || { scoreA: 0, scoreB: 0 };
                  const courtName = activeTournament.courts.find((c) => c.id === m.courtId)?.name || '';
                  return (
                    <button
                      key={m.id}
                      onClick={() => {
                        setFocusMatchId(m.id);
                        setTab('live');
                      }}
                      className="text-left rounded-xl border-2 border-[#156143] dark:border-[#229A6B] bg-white dark:bg-[#131E2E] p-4 space-y-2.5 hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold">
                          {courtName} · {m.matchCode}
                        </span>
                        <StatusIndicator tone="live" label={`เซต ${m.currentSet}`} compact />
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <TeamLogoBadge
                              teamName={m.teamAName}
                              logoUrl={getTeamLogo(m.teamAId, m.teamAName)}
                              size="sm"
                              highlight={m.servingTeam === 'A'}
                            />
                            <span className="font-semibold text-sm truncate">
                              {m.servingTeam === 'A' ? '● ' : ''}
                              {m.teamAName}
                            </span>
                          </div>
                          <span className="text-2xl font-bold font-mono tabular-nums text-[#156143] dark:text-[#229A6B]">
                            {activeSet.scoreA}
                          </span>
                        </div>
                        <div className="flex justify-between items-center gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <TeamLogoBadge
                              teamName={m.teamBName}
                              logoUrl={getTeamLogo(m.teamBId, m.teamBName)}
                              size="sm"
                              highlight={m.servingTeam === 'B'}
                            />
                            <span className="font-semibold text-sm truncate">
                              {m.servingTeam === 'B' ? '● ' : ''}
                              {m.teamBName}
                            </span>
                          </div>
                          <span className="text-2xl font-bold font-mono tabular-nums">
                            {activeSet.scoreB}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Upcoming & Finished */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 space-y-3">
              <h3 className="text-sm font-bold">คู่ถัดไป (แสดงล่วงหน้า {nextLimit} คู่)</h3>
              <div className="divide-y divide-[#E2DFD5] dark:divide-[#25354C] text-xs">
                {upcomingMatches.map((m) => (
                  <div key={m.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold">
                        {m.matchCode}: {m.teamAName} vs {m.teamBName}
                      </div>
                      <div className="text-[#525C6B]">
                        {activeTournament.courts.find((c) => c.id === m.courtId)?.name} · เวลา{' '}
                        {m.estimatedStart}
                      </div>
                    </div>
                    <StatusIndicator
                      tone={m.status === 'calling' ? 'warning' : 'neutral'}
                      label={m.status === 'calling' ? 'เรียกนักกีฬา' : 'รอแข่ง'}
                      compact
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 space-y-3">
              <h3 className="text-sm font-bold">ผลการแข่งขันล่าสุด ({finishedMatches.length})</h3>
              <div className="divide-y divide-[#E2DFD5] dark:divide-[#25354C] text-xs">
                {finishedMatches.slice(0, 6).map((m) => (
                  <div key={m.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold">
                        {m.matchCode}: {m.teamAName} vs {m.teamBName}
                      </div>
                      <div className="text-[#525C6B]">
                        {m.winner === 'draw'
                          ? 'ผลการแข่งขัน: เสมอ'
                          : `ผู้ชนะ: ${m.winner === 'A' ? m.teamAName : m.teamBName}`}
                      </div>
                    </div>
                    <span className="font-mono font-bold tabular-nums">
                      {m.sets.map((s) => `${s.scoreA}-${s.scoreB}`).join(', ') || 'WO'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. LIVE MATCH VIEW */}
      {tab === 'live' && focusedMatch && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <select
              value={focusedMatch.id}
              onChange={(e) => setFocusMatchId(e.target.value)}
              className="min-h-[42px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] text-xs font-semibold"
            >
              {allMatches.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.matchCode}: {m.teamAName} vs {m.teamBName} ({m.status})
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-2xl bg-[#142642] text-white p-5 sm:p-8 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs opacity-90">
              <span>
                {activeTournament.courts.find((c) => c.id === focusedMatch.courtId)?.name} ·{' '}
                {focusedMatch.matchCode} ·{' '}
                {activeTournament.divisions.find((d) => d.id === focusedMatch.divisionId)?.nameTh}
              </span>
              <span>เซตที่ {focusedMatch.currentSet}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 items-center gap-6 text-center">
              <div className="space-y-2 flex flex-col items-center">
                <TeamLogoBadge
                  teamName={focusedMatch.teamAName}
                  logoUrl={getTeamLogo(focusedMatch.teamAId, focusedMatch.teamAName)}
                  size="lg"
                  highlight={focusedMatch.servingTeam === 'A'}
                />
                <div className="text-lg sm:text-2xl font-bold">{focusedMatch.teamAName}</div>
                <div className="text-xs opacity-75">{focusedMatch.teamAPlayers.join(' / ')}</div>
                {focusedMatch.servingTeam === 'A' && (
                  <span className="inline-block px-2.5 py-0.5 rounded bg-[#EAB308] text-[#142642] text-xs font-bold">
                    กำลังเสิร์ฟ
                  </span>
                )}
              </div>

              <div className="flex items-center justify-center gap-6">
                <div className="text-6xl sm:text-7xl font-bold font-mono tabular-nums text-[#FACC15]">
                  {focusedMatch.sets[focusedMatch.currentSet - 1]?.scoreA ?? 0}
                </div>
                <div className="text-3xl opacity-50">:</div>
                <div className="text-6xl sm:text-7xl font-bold font-mono tabular-nums">
                  {focusedMatch.sets[focusedMatch.currentSet - 1]?.scoreB ?? 0}
                </div>
              </div>

              <div className="space-y-2 flex flex-col items-center">
                <TeamLogoBadge
                  teamName={focusedMatch.teamBName}
                  logoUrl={getTeamLogo(focusedMatch.teamBId, focusedMatch.teamBName)}
                  size="lg"
                  highlight={focusedMatch.servingTeam === 'B'}
                />
                <div className="text-lg sm:text-2xl font-bold">{focusedMatch.teamBName}</div>
                <div className="text-xs opacity-75">{focusedMatch.teamBPlayers.join(' / ')}</div>
                {focusedMatch.servingTeam === 'B' && (
                  <span className="inline-block px-2.5 py-0.5 rounded bg-[#EAB308] text-[#142642] text-xs font-bold">
                    กำลังเสิร์ฟ
                  </span>
                )}
              </div>
            </div>

            <div className="flex justify-center gap-4 text-xs font-mono border-t border-white/15 pt-4">
              {focusedMatch.sets.map((s) => (
                <span key={s.setNumber}>
                  เซต {s.setNumber}: {s.scoreA}-{s.scoreB}
                </span>
              ))}
            </div>
          </div>

          {/* Live Event Timeline */}
          <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 space-y-2">
            <h3 className="text-sm font-bold">เหตุการณ์ล่าสุด (Live Timeline)</h3>
            {focusedMatch.timeline.length === 0 ? (
              <p className="text-xs text-[#525C6B]">รออัปเดตคะแนนจากกรรมการสนาม...</p>
            ) : (
              <div className="divide-y divide-[#E2DFD5] dark:divide-[#25354C] text-xs">
                {focusedMatch.timeline.slice(0, 10).map((ev) => (
                  <div key={ev.id} className="py-2 flex justify-between">
                    <span>
                      <strong>S{ev.setNumber}</strong> · {ev.detail || ev.type}
                    </span>
                    <span className="font-mono text-[#525C6B]">
                      {ev.scoreSnapshot} ({ev.timestamp})
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. BRACKET VIEW */}
      {tab === 'bracket' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <select
              value={bracketDivId}
              onChange={(e) => selectBracketDivision(e.target.value)}
              className="min-h-[42px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] text-xs font-semibold"
            >
              {enabledDivisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nameTh}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(window.location.href);
                notify('success', 'คัดลอกลิงก์สายการแข่งขันแล้ว');
              }}
              className="min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] text-xs font-medium inline-flex items-center gap-1.5"
            >
              <QrCode className="w-4 h-4" />
              <span>แชร์ลิงก์สาย</span>
            </button>
          </div>
          <PlacementAwareKnockoutBrackets
            matches={bracketMatches}
            teamLogos={teamLogos}
            title={`สายการแข่งขันสาธารณะ — ${
              activeTournament.divisions.find((d) => d.id === bracketDivId)?.nameTh || ''
            }`}
          />
        </div>
      )}

      {/* 4. VENUE DISPLAY (TV / Big Screen) */}
      {tab === 'venue' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-bold">
              จอแสดงผลในสนาม (Venue TV Display) — {tvSlide === 'courts' ? 'คะแนนสดทุกสนาม' : 'คิวคู่ถัดไป & เรียกนักกีฬา'}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={tvAutoRotate}
                  onChange={(e) => setTvAutoRotate(e.target.checked)}
                />
                <span>สลับหน้าจออัตโนมัติ (8 วินาที)</span>
              </label>
              <button
                onClick={() => setTvSlide((s) => (s === 'courts' ? 'queue' : 'courts'))}
                className="min-h-[36px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] font-medium"
              >
                สลับหน้าจอทันที
              </button>
            </div>
          </div>

          {tvSlide === 'courts' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeTournament.courts.map((c) => {
                const m = allMatches.find(
                  (item) => item.courtId === c.id && (item.status === 'live' || item.status === 'interval')
                );
                const activeSet = m?.sets[m.currentSet - 1];
                return (
                  <div
                    key={c.id}
                    className="rounded-2xl bg-[#142642] text-white p-5 border border-[#25354C] space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-bold text-[#FACC15]">{c.name}</span>
                      <span className="text-xs font-mono opacity-80">
                        {m ? `${m.matchCode} · เซต ${m.currentSet}` : 'สนามว่าง'}
                      </span>
                    </div>
                    {m ? (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between gap-3 text-lg font-bold">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <TeamLogoBadge
                              teamName={m.teamAName}
                              logoUrl={getTeamLogo(m.teamAId, m.teamAName)}
                              size="md"
                              highlight={m.servingTeam === 'A'}
                            />
                            <span className="truncate">
                              {m.servingTeam === 'A' ? '▶ ' : ''}
                              {m.teamAName}
                            </span>
                          </div>
                          <span className="text-4xl font-mono tabular-nums text-[#4ADE80]">
                            {activeSet?.scoreA ?? 0}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-lg font-bold">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <TeamLogoBadge
                              teamName={m.teamBName}
                              logoUrl={getTeamLogo(m.teamBId, m.teamBName)}
                              size="md"
                              highlight={m.servingTeam === 'B'}
                            />
                            <span className="truncate">
                              {m.servingTeam === 'B' ? '▶ ' : ''}
                              {m.teamBName}
                            </span>
                          </div>
                          <span className="text-4xl font-mono tabular-nums">
                            {activeSet?.scoreB ?? 0}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="py-6 text-center text-sm opacity-60">เตรียมความพร้อมคู่ถัดไป</div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl bg-[#142642] text-white p-6 space-y-4">
              <div className="flex items-center gap-2 text-lg font-bold text-[#FACC15]">
                <Megaphone className="w-5 h-5" />
                <span>ประกาศเรียกนักกีฬา & คู่ถัดไป ({upcomingMatches.length} คู่)</span>
              </div>
              <div className="divide-y divide-white/15">
                {upcomingMatches.map((m) => (
                  <div key={m.id} className="py-3 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-base font-bold">
                        {m.matchCode}: {m.teamAName} vs {m.teamBName}
                      </div>
                      <div className="text-xs opacity-75">
                        {activeTournament.courts.find((c) => c.id === m.courtId)?.name} · เวลาคาดการณ์{' '}
                        {m.estimatedStart}
                      </div>
                    </div>
                    <span
                      className={`px-3 py-1 rounded text-xs font-bold ${
                        m.status === 'calling'
                          ? 'bg-[#EAB308] text-[#142642]'
                          : 'bg-white/15 text-white'
                      }`}
                    >
                      {m.status === 'calling' ? 'ขอเชิญลงสนามด่วน' : 'เตรียมตัว'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sponsors & QR Footer */}
          {activeTournament.publicViewConfig.showSponsors && (
            <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                ผู้สนับสนุนการแข่งขัน:{' '}
                <strong className="text-[#141D2B] dark:text-[#F3F5F8]">
                  {activeTournament.sponsors.join(' · ')}
                </strong>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <QRCodeMatrix value={tabKioskUrl} size={48} />
                <span>สแกนดูหน้าจอนี้</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Standalone Fullscreen Chromeless PWA Modal for Active Tab */}
      {showTabPwaModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] shadow-xl p-6 space-y-4 text-center">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">
                PWA หน้าจอแยก: {tabLabels[tab]}
              </h3>
              <button
                type="button"
                onClick={() => setShowTabPwaModal(false)}
                aria-label="ปิด"
                className="min-h-[36px] min-w-[36px] rounded-lg hover:bg-[#EFECE4] dark:hover:bg-[#1B293D] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
              เปิดหรือสแกน QR เพื่อแสดงผลหน้า <strong>{tabLabels[tab]}</strong> แบบสาธารณะเต็มจอ (ไม่มีโลโก้ แถบเมนู ฟิลเตอร์ หรือ checkbox เอาเฉพาะเนื้อหาสำหรับจอทีวีหรือมือถือ)
            </p>
            <div className="flex justify-center">
              <QRCodeMatrix value={tabKioskUrl} size={168} />
            </div>
            <div className="p-2.5 rounded-lg bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] text-[11px] font-mono truncate">
              {tabKioskUrl}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(tabKioskUrl);
                  notify('success', `คัดลอกลิงก์ ${tabLabels[tab]} แล้ว`);
                }}
                className="flex-1 min-h-[44px] rounded-xl border border-[#E2DFD5] dark:border-[#25354C] text-xs font-semibold inline-flex items-center justify-center gap-1.5"
              >
                <Copy className="w-4 h-4" />
                <span>คัดลอกลิงก์</span>
              </button>
              <a
                href={tabKioskUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setShowTabPwaModal(false)}
                className="flex-1 min-h-[44px] rounded-xl bg-[#156143] hover:bg-[#104D35] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
              >
                <ExternalLink className="w-4 h-4" />
                <span>เปิดเต็มจอไร้โลโก้</span>
              </a>
            </div>
            <div className="pt-1 flex justify-center">
              <PWAInstallButton appName={tabLabelsForManifest(tab)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
