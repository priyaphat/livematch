import React, { useMemo } from 'react';
import {
  Activity,
  ExternalLink,
  GitBranch,
  Megaphone,
  PauseCircle,
  Printer,
  Share2,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { apiFetch } from '../../services/api';
import { MatchRecord, Tournament } from '../../types/tournament';
import { EmergencyPauseBanner, StatusIndicator } from '../common/UIPrimitives';
import { Level2Tab } from './TournamentShell';

export const TournamentHomeView: React.FC<{
  tournament: Tournament;
  onNavigate: (tab: Level2Tab) => void;
}> = ({ tournament, onNavigate }) => {
  const {
    state,
    refreshState,
    hasPermission,
    setPortalMode,
    setPublicInitialTab,
    setPublicFocusMatchId,
    requestConfirm,
    notify,
  } = useApp();

  const tPlayers = useMemo(
    () => state.players.filter((p) => p.tournamentId === tournament.id && !p.withdrawn),
    [state.players, tournament.id]
  );

  const tMatches = useMemo(
    () => state.matches.filter((m) => m.tournamentId === tournament.id),
    [state.matches, tournament.id]
  );

  const liveMatches = useMemo(
    () => tMatches.filter((m) => m.status === 'live' || m.status === 'interval'),
    [tMatches]
  );

  const nextMatches = useMemo(
    () => tMatches.filter((m) => m.status === 'scheduled' || m.status === 'calling'),
    [tMatches]
  );

  const stats = useMemo(() => {
    const approved = tPlayers.filter((p) => p.documentStatus === 'approved').length;
    const pendingDoc = tPlayers.filter((p) => p.documentStatus === 'pending').length;
    const paid = tPlayers.filter((p) => p.paymentStatus === 'paid').length;
    const unpaid = tPlayers.filter(
      (p) => p.paymentStatus === 'unpaid' || p.paymentStatus === 'pending_verify'
    ).length;
    const checkedIn = tPlayers.filter((p) => p.checkedIn).length;
    const finished = tMatches.filter(
      (m) => m.status === 'finished' || m.status === 'walkover'
    ).length;
    const delayed = tMatches.filter(
      (m) => m.conflictWarning || (m.status === 'calling' && m.callCount >= 2)
    ).length;

    const totalRevenue = tPlayers.reduce((s, p) => s + p.amountPaid, 0);
    const totalPending = tPlayers.reduce((s, p) => s + p.amountDue, 0);

    return {
      totalPlayers: tPlayers.length,
      approved,
      pendingDoc,
      paid,
      unpaid,
      checkedIn,
      todayMatches: tMatches.length,
      finished,
      live: liveMatches.length,
      delayed,
      totalRevenue,
      totalPending,
    };
  }, [tPlayers, tMatches, liveMatches.length]);

  // Chart data calculations
  const divisionBreakdown = useMemo(() => {
    return tournament.divisions.filter((div) => div.enabled).map((div) => {
      const count = tPlayers.filter((p) => p.divisionId === div.id).length;
      const quota = div.formats.includes('doubles') ? div.quotaDoubles : div.quotaSingles;
      const max = typeof quota === 'number' && quota > 0 ? quota : 32;
      return {
        id: div.id,
        name: div.nameTh,
        count,
        pct: Math.min(100, Math.round((count / max) * 100)),
        color: div.color,
      };
    });
  }, [tournament.divisions, tPlayers]);

  const genderBreakdown = useMemo(() => {
    let male = 0;
    let female = 0;
    let mixed = 0;
    tPlayers.forEach((p) => {
      const div = tournament.divisions.find((d) => d.id === p.divisionId);
      if (div?.gender === 'mixed') mixed += 1;
      else if (p.gender === 'F') female += 1;
      else male += 1;
    });
    const total = Math.max(1, male + female + mixed);
    return { male, female, mixed, total };
  }, [tPlayers, tournament.divisions]);

  const courtUtilization = useMemo(() => {
    return tournament.courts.map((c) => {
      const count = tMatches.filter((m) => m.courtId === c.id).length;
      const done = tMatches.filter(
        (m) => m.courtId === c.id && (m.status === 'finished' || m.status === 'walkover')
      ).length;
      return { id: c.id, name: c.name, count, done, status: c.status };
    });
  }, [tournament.courts, tMatches]);

  const handleCallAthlete = async (match: MatchRecord) => {
    try {
      await apiFetch(`/api/matches/${match.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ callAthlete: true }),
      });
      await refreshState();
      notify('success', `ประกาศเรียกนักกีฬาคู่ ${match.matchCode} (${match.teamAName} vs ${match.teamBName}) แล้ว`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'เรียกนักกีฬาไม่สำเร็จ');
    }
  };

  const handleUpdatePublicNextCount = async (count: number) => {
    try {
      await apiFetch(`/api/tournaments/${tournament.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          publicViewConfig: { ...tournament.publicViewConfig, nextMatchesCount: count },
          _auditReason: `ปรับจำนวนคู่ถัดไปใน Public View เป็น ${count} คู่`,
        }),
      });
      await refreshState();
      notify('success', `Public View จะแสดงคู่ถัดไปล่วงหน้า ${count} คู่`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
    }
  };

  const handleToggleEmergencyPause = () => {
    if (tournament.emergencyPaused) {
      requestConfirm({
        title: 'กลับมาแข่งขันต่อ (Resume Tournament)?',
        description: 'ยกเลิกประกาศพักฉุกเฉินและเปิดสนามแข่งขันต่อตามปกติ',
        confirmLabel: 'กลับมาแข่งต่อ',
        onConfirm: async () => {
          await apiFetch(`/api/tournaments/${tournament.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              emergencyPaused: false,
              status: 'กำลังแข่งขัน',
              _auditReason: 'กลับมาแข่งขันต่อหลังพักฉุกเฉิน',
            }),
          });
          await refreshState();
          notify('success', 'กลับมาแข่งขันต่อแล้ว');
        },
      });
    } else {
      requestConfirm({
        title: 'ประกาศพักการแข่งขันฉุกเฉิน (Emergency / Rain Delay)?',
        description: 'ทุกหน้าจอ Public View และ Venue Display จะแสดงประกาศหยุดพักการแข่งขันชั่วคราวทันที',
        confirmLabel: 'ประกาศพักการแข่งขัน',
        destructive: true,
        requireReason: true,
        reasonPlaceholder: 'เช่น ฝนตกหนักหลังคารั่วบริเวณสนาม 3-4 / ไฟสนามขัดข้อง',
        onConfirm: async (reason) => {
          await apiFetch(`/api/tournaments/${tournament.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              emergencyPaused: true,
              emergencyReason: reason,
              status: 'พักการแข่งขัน',
              _auditReason: reason,
            }),
          });
          await refreshState();
          notify('warning', 'ประกาศพักการแข่งขันชั่วคราวแล้ว');
        },
      });
    }
  };

  const completionPct =
    stats.todayMatches > 0 ? Math.round((stats.finished / stats.todayMatches) * 100) : 0;

  return (
    <div className="space-y-6">
      {tournament.emergencyPaused && (
        <EmergencyPauseBanner
          reason={tournament.emergencyReason}
          canResume={hasPermission('editSettings')}
          onResume={handleToggleEmergencyPause}
        />
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onNavigate('member')}
            className="min-h-[42px] px-3.5 py-2 rounded-lg bg-[#156143] hover:bg-[#104D35] text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <UserPlus className="w-4 h-4" />
            <span>รับสมัครนักกีฬา</span>
          </button>
          <button
            onClick={() => onNavigate('member')}
            className="min-h-[42px] px-3.5 py-2 rounded-lg bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
          >
            <UserCheck className="w-4 h-4" />
            <span>Check-in</span>
          </button>
          <button
            onClick={() => onNavigate('approval')}
            className="min-h-[42px] px-3.5 py-2 rounded-lg bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
          >
            <UserCheck className="w-4 h-4 text-[#156143] dark:text-[#229A6B]" />
            <span>อนุมัติ & ตรวจสลิป</span>
          </button>
          <button
            onClick={() => onNavigate('tournament')}
            className="min-h-[42px] px-3.5 py-2 rounded-lg bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
          >
            <GitBranch className="w-4 h-4" />
            <span>จัดสาย & มอบหมายกรรมการ</span>
          </button>
          <button
            onClick={() => {
              setPublicInitialTab('venue');
              setPortalMode('public_live');
            }}
            className="min-h-[42px] px-3.5 py-2 rounded-lg bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
          >
            <Activity className="w-4 h-4" />
            <span>เปิด Live Score (TV)</span>
          </button>
          <button
            onClick={() => window.print()}
            className="min-h-[42px] px-3.5 py-2 rounded-lg bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
          >
            <Printer className="w-4 h-4" />
            <span>พิมพ์เอกสาร</span>
          </button>
        </div>

        {hasPermission('editSettings') && (
          <button
            onClick={handleToggleEmergencyPause}
            className={`min-h-[42px] px-3.5 py-2 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 ${
              tournament.emergencyPaused
                ? 'bg-[#156143] text-white border-[#104D35]'
                : 'bg-[#FEF9C3] text-[#713F12] border-[#FDE047] dark:bg-[#332409] dark:text-[#FACC15] dark:border-[#5C410D]'
            }`}
          >
            <PauseCircle className="w-4 h-4" />
            <span>{tournament.emergencyPaused ? 'ยกเลิกพักฉุกเฉิน' : 'พักแข่งขันฉุกเฉิน'}</span>
          </button>
        )}
      </div>

      {/* 10 Summary Operational Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'ผู้สมัครทั้งหมด', value: stats.totalPlayers },
          { label: 'ผ่านการตรวจสอบแล้ว', value: stats.approved },
          { label: 'รอตรวจสอบ', value: stats.pendingDoc },
          { label: 'ชำระแล้ว', value: stats.paid },
          { label: 'ค้างชำระ', value: stats.unpaid },
          { label: 'Check-in แล้ว', value: stats.checkedIn },
          { label: 'คู่แข่งขันวันนี้', value: stats.todayMatches },
          { label: 'คู่ที่จบแล้ว', value: stats.finished },
          { label: 'คู่ที่กำลังแข่งขัน', value: stats.live },
          { label: 'คู่ที่ล่าช้า / ซ้อน', value: stats.delayed },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-3.5"
          >
            <div className="text-xs text-[#525C6B] dark:text-[#9AA8BC] truncate">{card.label}</div>
            <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-[#141D2B] dark:text-[#F3F5F8]">
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Live Matches Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-[#141D2B] dark:text-[#F3F5F8]">
            กำลังแข่งขันขณะนี้ ({liveMatches.length} สนาม)
          </h2>
          <button
            onClick={() => {
              setPublicInitialTab('center');
              setPortalMode('public_live');
            }}
            className="text-xs font-semibold text-[#156143] dark:text-[#229A6B] inline-flex items-center gap-1 hover:underline"
          >
            <span>ดูทั้งหมดใน Public Live Score</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {liveMatches.map((m) => {
            const courtName = tournament.courts.find((c) => c.id === m.courtId)?.name || 'รอสนาม';
            const divName = tournament.divisions.find((d) => d.id === m.divisionId)?.nameTh || '';
            const activeSet = m.sets[m.currentSet - 1] || { scoreA: 0, scoreB: 0 };
            return (
              <div
                key={m.id}
                className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 flex flex-col justify-between gap-3"
              >
                <div className="flex items-center justify-between gap-2 text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                  <span className="font-semibold text-[#141D2B] dark:text-[#F3F5F8]">
                    {courtName} · {m.matchCode}
                  </span>
                  <StatusIndicator tone="live" label={`เซต ${m.currentSet}`} compact />
                </div>

                <div className="text-xs text-[#525C6B] dark:text-[#9AA8BC] truncate">{divName}</div>

                <div className="space-y-2 py-2 border-y border-[#E2DFD5] dark:border-[#25354C]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex items-center gap-1.5">
                      {m.servingTeam === 'A' && (
                        <span
                          className="w-2.5 h-2.5 rounded-sm bg-[#EAB308] shrink-0"
                          title="ผู้เสิร์ฟ"
                        />
                      )}
                      <span className="font-semibold text-sm truncate">{m.teamAName}</span>
                    </div>
                    <div className="flex items-center gap-2 font-mono tabular-nums">
                      <span className="text-xs text-[#525C6B]">
                        {m.sets
                          .slice(0, m.currentSet - 1)
                          .map((s) => s.scoreA)
                          .join(' ')}
                      </span>
                      <span className="text-xl font-bold text-[#156143] dark:text-[#229A6B]">
                        {activeSet.scoreA}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex items-center gap-1.5">
                      {m.servingTeam === 'B' && (
                        <span
                          className="w-2.5 h-2.5 rounded-sm bg-[#EAB308] shrink-0"
                          title="ผู้เสิร์ฟ"
                        />
                      )}
                      <span className="font-semibold text-sm truncate">{m.teamBName}</span>
                    </div>
                    <div className="flex items-center gap-2 font-mono tabular-nums">
                      <span className="text-xs text-[#525C6B]">
                        {m.sets
                          .slice(0, m.currentSet - 1)
                          .map((s) => s.scoreB)
                          .join(' ')}
                      </span>
                      <span className="text-xl font-bold text-[#141D2B] dark:text-[#F3F5F8]">
                        {activeSet.scoreB}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                  <span className="truncate">
                    กรรมการ: {m.umpireName || 'ยังไม่ระบุ'} · เริ่ม {m.actualStart || m.scheduledTime}
                  </span>
                  <button
                    onClick={() => {
                      setPublicFocusMatchId(m.id);
                      setPublicInitialTab('live');
                      setPortalMode('public_live');
                    }}
                    className="min-h-[34px] px-2.5 rounded-lg bg-[#142642] text-white text-xs font-medium whitespace-nowrap shrink-0"
                  >
                    ดู Live Score
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Next Matches Queue */}
      <section className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">คู่ถัดไป (Next Up Queue)</h2>
            <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
              ประกาศเรียกนักกีฬาเข้าสนามและกำหนดจำนวนคู่ที่แสดงบน Public View
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <label htmlFor="public-next-count">แสดงใน Public View ล่วงหน้า:</label>
            <select
              id="public-next-count"
              value={tournament.publicViewConfig.nextMatchesCount}
              disabled={!hasPermission('editSettings')}
              onChange={(e) => handleUpdatePublicNextCount(Number(e.target.value))}
              className="min-h-[38px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] font-semibold"
            >
              {[2, 3, 4, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n} คู่
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="divide-y divide-[#E2DFD5] dark:divide-[#25354C]">
          {nextMatches.slice(0, 6).map((m) => {
            const courtName = tournament.courts.find((c) => c.id === m.courtId)?.name || 'รอจัดสนาม';
            const divName = tournament.divisions.find((d) => d.id === m.divisionId)?.nameTh || '';
            return (
              <div
                key={m.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-[#156143] dark:text-[#229A6B]">
                      {m.matchCode}
                    </span>
                    <span className="text-sm font-semibold">
                      {m.teamAName} vs {m.teamBName}
                    </span>
                    <StatusIndicator
                      tone={m.status === 'calling' ? 'warning' : 'neutral'}
                      label={
                        m.status === 'calling' ? `เรียกตัวครั้งที่ ${m.callCount}` : 'รอลงสนาม'
                      }
                      compact
                    />
                  </div>
                  <div className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
                    {divName} · {courtName} · เวลาคาดการณ์ {m.estimatedStart} น.
                    {m.conflictWarning ? ` · แจ้งเตือน: ${m.conflictWarning}` : ''}
                  </div>
                </div>

                <button
                  onClick={() => handleCallAthlete(m)}
                  className="min-h-[40px] px-3.5 py-2 rounded-lg bg-[#EAB308] hover:bg-[#CA8A04] text-[#142642] text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Megaphone className="w-3.5 h-3.5" />
                  <span>ประกาศเรียกนักกีฬา</span>
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* 6 Operational Charts */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* 1. Applicants by Division */}
        <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 space-y-3">
          <h3 className="text-sm font-bold">1. ผู้สมัครแยกตามระดับมือ</h3>
          <div className="space-y-2.5">
            {divisionBreakdown.map((d) => (
              <div key={d.id} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="truncate">{d.name}</span>
                  <span className="font-mono tabular-nums font-semibold">{d.count} ทีม</span>
                </div>
                <div className="h-2 rounded-full bg-[#EFECE4] dark:bg-[#1B293D] overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(6, d.pct)}%`, backgroundColor: d.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 2. Gender Distribution */}
        <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 space-y-3">
          <h3 className="text-sm font-bold">2. สัดส่วนผู้สมัคร (ชาย / หญิง / คู่ผสม)</h3>
          <div className="space-y-3 pt-1">
            {[
              { label: 'ประเภทชาย', count: genderBreakdown.male, color: '#142642' },
              { label: 'ประเภทหญิง', count: genderBreakdown.female, color: '#156143' },
              { label: 'ประเภทคู่ผสม', count: genderBreakdown.mixed, color: '#CA8A04' },
            ].map((g) => (
              <div key={g.label} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span>{g.label}</span>
                  <span className="font-mono tabular-nums">
                    {g.count} ({Math.round((g.count / genderBreakdown.total) * 100)}%)
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-[#EFECE4] dark:bg-[#1B293D] overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.round((g.count / genderBreakdown.total) * 100)}%`,
                      backgroundColor: g.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 3. Revenue vs Pending */}
        <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 space-y-3">
          <h3 className="text-sm font-bold">3. รายรับค่าสมัครและยอดค้างชำระ</h3>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="p-3 rounded-lg bg-[#ECFDF3] dark:bg-[#0E2E1D]">
              <div className="text-xs text-[#15803D] dark:text-[#4ADE80]">ชำระแล้ว</div>
              <div className="mt-1 text-lg font-bold font-mono tabular-nums text-[#14532D] dark:text-[#86EFAC]">
                ฿{stats.totalRevenue.toLocaleString()}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[#FEF9C3] dark:bg-[#332409]">
              <div className="text-xs text-[#92400E] dark:text-[#FACC15]">ค้างชำระ / รอตรวจ</div>
              <div className="mt-1 text-lg font-bold font-mono tabular-nums text-[#713F12] dark:text-[#FDE047]">
                ฿{stats.totalPending.toLocaleString()}
              </div>
            </div>
          </div>
          <div className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
            ช่องทางหลัก: PromptPay QR, LiveMatch POS, โอนธนาคาร
          </div>
        </div>

        {/* 4. Tournament Completion Progress */}
        <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 space-y-3">
          <h3 className="text-sm font-bold">4. ความคืบหน้าการแข่งขัน</h3>
          <div className="flex items-center gap-4">
            <svg width="72" height="72" viewBox="0 0 36 36" className="shrink-0">
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke="currentColor"
                className="text-[#EFECE4] dark:text-[#1B293D]"
                strokeWidth="3.5"
              />
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke="#156143"
                strokeWidth="3.5"
                strokeDasharray={`${completionPct}, 100`}
                strokeLinecap="round"
                transform="rotate(-90 18 18)"
              />
              <text
                x="18"
                y="20.5"
                textAnchor="middle"
                className="fill-[#141D2B] dark:fill-[#F3F5F8] text-[8px] font-bold font-mono"
              >
                {completionPct}%
              </text>
            </svg>
            <div className="text-xs space-y-1">
              <div>จบแล้ว: {stats.finished} คู่</div>
              <div>กำลังแข่ง: {stats.live} คู่</div>
              <div>รอแข่งขัน: {nextMatches.length} คู่</div>
            </div>
          </div>
        </div>

        {/* 5. Matches by Time Slot */}
        <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 space-y-3">
          <h3 className="text-sm font-bold">5. จำนวนแมตช์ตามช่วงเวลา</h3>
          <div className="flex items-end gap-2 h-24 pt-2">
            {[
              { slot: '09:00', count: 4 },
              { slot: '10:00', count: 5 },
              { slot: '13:00', count: 4 },
              { slot: '15:00', count: 3 },
              { slot: '17:00', count: 2 },
            ].map((b) => (
              <div key={b.slot} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[11px] font-mono tabular-nums">{b.count}</span>
                <div
                  className="w-full rounded-t bg-[#156143] dark:bg-[#229A6B]"
                  style={{ height: `${b.count * 12}px` }}
                />
                <span className="text-[10px] font-mono text-[#525C6B] dark:text-[#9AA8BC]">
                  {b.slot}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 6. Court Utilization */}
        <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 space-y-3">
          <h3 className="text-sm font-bold">6. การใช้งานสนาม ({tournament.courts.length} สนาม)</h3>
          <div className="space-y-2">
            {courtUtilization.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-xs">
                <span className="font-medium">{c.name}</span>
                <span className="font-mono tabular-nums text-[#525C6B] dark:text-[#9AA8BC]">
                  จบ {c.done} / ทั้งหมด {c.count} คู่
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
