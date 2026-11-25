import React, { useEffect, useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Tournament } from '../../types/tournament';
import {
  PaginationBar,
  StatusIndicator,
} from '../common/UIPrimitives';

type ReportTab = 'applicants' | 'finance' | 'results' | 'courts' | 'umpires';
const terminalMatchStatuses = new Set(['finished', 'walkover', 'retired', 'disqualified']);

export const ReportView: React.FC<{ tournament: Tournament }> = ({ tournament }) => {
  const { state } = useApp();
  const enabledDivisions = useMemo(
    () => tournament.divisions.filter((division) => division.enabled),
    [tournament.divisions]
  );
  const [tab, setTab] = useState<ReportTab>(() => {
    const value = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('reportTab')
      : null;
    return value === 'finance' || value === 'results' || value === 'courts' || value === 'umpires'
      ? value
      : 'applicants';
  });
  const [filterDiv, setFilterDiv] = useState('all');
  const [filterCourt, setFilterCourt] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const generatedAt = useMemo(
    () =>
      new Intl.DateTimeFormat('th-TH', {
        timeZone: 'Asia/Bangkok',
        dateStyle: 'medium',
        timeStyle: 'medium',
      }).format(new Date()),
    [tab, filterDiv, filterCourt, filterStatus]
  );

  const tPlayers = useMemo(
    () =>
      state.players.filter(
        (p) => p.tournamentId === tournament.id && (filterDiv === 'all' || p.divisionId === filterDiv)
      ),
    [state.players, tournament.id, filterDiv]
  );

  const tMatches = useMemo(
    () =>
      state.matches.filter(
        (m) =>
          m.tournamentId === tournament.id &&
          (filterDiv === 'all' || m.divisionId === filterDiv) &&
          (filterCourt === 'all' || m.courtId === filterCourt) &&
          (filterStatus === 'all' ||
            (filterStatus === 'finished' ? terminalMatchStatuses.has(m.status) : m.status === filterStatus))
      ),
    [state.matches, tournament.id, filterDiv, filterCourt, filterStatus]
  );

  const tUmpires = useMemo(
    () => state.umpires.filter((u) => u.tournamentId === tournament.id),
    [state.umpires, tournament.id]
  );

  const tIncidents = useMemo(
    () => state.incidents.filter((i) => i.tournamentId === tournament.id),
    [state.incidents, tournament.id]
  );

  const reportDivisions = useMemo(
    () =>
      filterDiv === 'all'
        ? enabledDivisions
        : enabledDivisions.filter((d) => d.id === filterDiv),
    [enabledDivisions, filterDiv]
  );

  useEffect(() => {
    if (filterDiv !== 'all' && !enabledDivisions.some((division) => division.id === filterDiv)) {
      setFilterDiv('all');
    }
  }, [enabledDivisions, filterDiv]);

  const reportCourts = useMemo(
    () =>
      filterCourt === 'all'
        ? tournament.courts
        : tournament.courts.filter((c) => c.id === filterCourt),
    [tournament.courts, filterCourt]
  );

  const activeTotalItems = useMemo(() => {
    switch (tab) {
      case 'applicants':
        return reportDivisions.length;
      case 'finance':
        return tPlayers.length;
      case 'results':
        return tMatches.length;
      case 'courts':
        return reportCourts.length;
      case 'umpires':
        return tUmpires.length;
    }
  }, [tab, reportDivisions.length, tPlayers.length, tMatches.length, reportCourts.length, tUmpires.length]);

  const totalPages = Math.max(1, Math.ceil(activeTotalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    setPage(1);
  }, [tab, tournament.id, filterDiv, filterCourt, filterStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('reportTab', tab);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, [tab]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const paginatedDivisions = useMemo(
    () => reportDivisions.slice((safePage - 1) * pageSize, safePage * pageSize),
    [reportDivisions, safePage, pageSize]
  );

  const paginatedFinancePlayers = useMemo(
    () => tPlayers.slice((safePage - 1) * pageSize, safePage * pageSize),
    [tPlayers, safePage, pageSize]
  );

  const paginatedResultMatches = useMemo(
    () => tMatches.slice((safePage - 1) * pageSize, safePage * pageSize),
    [tMatches, safePage, pageSize]
  );

  const paginatedCourts = useMemo(
    () => reportCourts.slice((safePage - 1) * pageSize, safePage * pageSize),
    [reportCourts, safePage, pageSize]
  );

  const paginatedUmpires = useMemo(
    () => tUmpires.slice((safePage - 1) * pageSize, safePage * pageSize),
    [tUmpires, safePage, pageSize]
  );

  // Executive Summary Metrics
  const execSummary = useMemo(() => {
    const activeP = tPlayers.filter((p) => !p.withdrawn);
    const totalRevenue = activeP.reduce((s, p) => s + p.amountPaid, 0);
    const totalExpected = activeP.reduce((s, p) => s + p.amountPaid + p.amountDue, 0);
    const paymentPct = totalExpected > 0 ? Math.round((totalRevenue / totalExpected) * 100) : 0;

    const finished = tMatches.filter((m) => terminalMatchStatuses.has(m.status)).length;
    const completionPct = tMatches.length > 0 ? Math.round((finished / tMatches.length) * 100) : 0;
    const noShows = tPlayers.filter((p) => p.noShow).length;
    const noShowPct = activeP.length > 0 ? Math.round((noShows / activeP.length) * 100) : 0;

    const durations = tMatches.flatMap((match) => {
      if (!match.actualStart || !match.actualEnd) return [];
      const start = Date.parse(match.actualStart);
      const end = Date.parse(match.actualEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
      return [(end - start) / 60_000];
    });
    const assignedCourtMatches = tMatches.filter((match) => Boolean(match.courtId)).length;

    return {
      totalApplicants: activeP.length,
      totalRevenue,
      completionPct,
      noShowPct,
      avgDurationMin: durations.length
        ? Math.round(durations.reduce((sum, minutes) => sum + minutes, 0) / durations.length)
        : 0,
      courtUtilPct: tMatches.length ? Math.round((assignedCourtMatches / tMatches.length) * 100) : 0,
      paymentPct,
      incidentCount: tIncidents.length,
    };
  }, [tPlayers, tMatches, tIncidents]);

  return (
    <div className="space-y-5">
      {/* Executive Summary */}
      <section className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold">Executive Summary — {tournament.name}</h2>
          <span className="text-xs font-mono text-[#525C6B] dark:text-[#9AA8BC]">
            สร้างรายงานเมื่อ: {generatedAt} (Asia/Bangkok)
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
          {[
            { label: 'ผู้สมัครทั้งหมด', value: `${execSummary.totalApplicants}` },
            { label: 'รายได้ชำระแล้ว', value: `฿${execSummary.totalRevenue.toLocaleString()}` },
            { label: 'Completion Rate', value: `${execSummary.completionPct}%` },
            { label: 'No-show Rate', value: `${execSummary.noShowPct}%` },
            { label: 'เวลาเฉลี่ยจริง', value: execSummary.avgDurationMin ? `${execSummary.avgDurationMin} น.` : '—' },
            { label: 'จัดสนามแล้ว', value: `${execSummary.courtUtilPct}%` },
            { label: 'Payment Done', value: `${execSummary.paymentPct}%` },
            { label: 'Incident', value: `${execSummary.incidentCount}` },
          ].map((m) => (
            <div
              key={m.label}
              className="p-2.5 rounded-lg bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C]"
            >
              <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC] truncate">{m.label}</div>
              <div className="mt-1 text-base font-bold font-mono tabular-nums">{m.value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Report Tabs & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex max-w-full gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="ประเภทรายงาน">
          {[
            { id: 'applicants' as const, label: '1. รายงานผู้สมัคร' },
            { id: 'finance' as const, label: '2. รายงานการเงิน' },
            { id: 'results' as const, label: '3. รายงานผลการแข่งขัน' },
            { id: 'courts' as const, label: '4. การใช้สนาม & ตารางเวลา' },
            { id: 'umpires' as const, label: '5. รายงานกรรมการ' },
          ].map((r) => (
            <button
              key={r.id}
              onClick={() => setTab(r.id)}
              role="tab"
              aria-selected={tab === r.id}
              className={`min-h-[40px] shrink-0 px-3.5 py-2 rounded-lg text-xs font-semibold ${
                tab === r.id
                  ? 'bg-[#156143] text-white'
                  : 'bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C]'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            disabled
            title="ปิดใช้งานชั่วคราวระหว่างตรวจสอบรูปแบบไฟล์รายงาน"
            className="min-h-[40px] px-3.5 rounded-lg bg-[#142642] text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV / Excel</span>
          </button>
          <button
            disabled
            title="ปิดใช้งานชั่วคราวระหว่างตรวจสอบรูปแบบ PDF"
            className="min-h-[40px] px-3.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] text-xs font-semibold inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Printer className="w-4 h-4" />
            <span>พิมพ์ / PDF</span>
          </button>
        </div>
      </div>

      {/* Filters relevant to the active report only */}
      <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap gap-2">
          {tab !== 'umpires' && (
            <select
              value={filterDiv}
              onChange={(e) => setFilterDiv(e.target.value)}
              className="min-h-[38px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
            >
              <option value="all">ทุกระดับมือ</option>
              {enabledDivisions.map((d) => <option key={d.id} value={d.id}>{d.nameTh}</option>)}
            </select>
          )}
          {(tab === 'results' || tab === 'courts') && (
            <>
              <select value={filterCourt} onChange={(e) => setFilterCourt(e.target.value)} className="min-h-[38px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]">
                <option value="all">ทุกสนาม</option>
                {tournament.courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="min-h-[38px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]">
                <option value="all">ทุกสถานะคู่</option>
                <option value="finished">จบแล้ว</option>
                <option value="live">กำลังแข่งขัน</option>
                <option value="scheduled">รอแข่งขัน</option>
              </select>
            </>
          )}
          {tab === 'umpires' && <span className="self-center text-[#525C6B]">สรุปงานกรรมการและเหตุการณ์จากข้อมูลการแข่งขันจริง</span>}
        </div>
      </div>

      {/* Content Area */}
      <div className="space-y-3">
          <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] overflow-x-auto">
            {tab === 'applicants' && (
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-[#F7F6F2] dark:bg-[#0B121C] border-b border-[#E2DFD5] dark:border-[#25354C]">
                    <th className="py-3 px-4">ระดับมือ</th>
                    <th className="py-3 px-4 text-right">สมัครทั้งหมด</th>
                    <th className="py-3 px-4 text-right">ผ่านตรวจ</th>
                    <th className="py-3 px-4 text-right">Check-in</th>
                    <th className="py-3 px-4 text-right">Waiting List</th>
                    <th className="py-3 px-4 text-right">ถอนตัว / No-show</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2DFD5] dark:divide-[#25354C] font-mono tabular-nums">
                  {paginatedDivisions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 px-4 text-center font-sans text-[#525C6B] dark:text-[#9AA8BC]">
                        ไม่พบข้อมูลระดับมือตามตัวกรองที่เลือก
                      </td>
                    </tr>
                  ) : (
                    paginatedDivisions.map((d) => {
                      const list = tPlayers.filter((p) => p.divisionId === d.id);
                      return (
                        <tr key={d.id}>
                          <td className="py-3 px-4 font-sans font-semibold">{d.nameTh}</td>
                          <td className="py-3 px-4 text-right">{list.length}</td>
                          <td className="py-3 px-4 text-right">
                            {list.filter((p) => p.documentStatus === 'approved').length}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {list.filter((p) => p.checkedIn).length}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {list.filter((p) => p.waitingList).length}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {list.filter((p) => p.withdrawn || p.noShow).length}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}

            {tab === 'finance' && (
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-[#F7F6F2] dark:bg-[#0B121C] border-b border-[#E2DFD5] dark:border-[#25354C]">
                    <th className="py-3 px-4">รหัส / ทีม</th>
                    <th className="py-3 px-4">ช่องทางชำระ</th>
                    <th className="py-3 px-4 text-right">ชำระแล้ว</th>
                    <th className="py-3 px-4 text-right">ค้างชำระ</th>
                    <th className="py-3 px-4">สถานะสลิป</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2DFD5] dark:divide-[#25354C]">
                  {paginatedFinancePlayers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 px-4 text-center text-[#525C6B] dark:text-[#9AA8BC]">
                        ไม่พบข้อมูลรายการการเงินตามตัวกรองที่เลือก
                      </td>
                    </tr>
                  ) : (
                    paginatedFinancePlayers.map((p) => (
                      <tr key={p.id}>
                        <td className="py-3 px-4">
                          <span className="font-mono font-bold mr-2">{p.registrationCode}</span>
                          <span>{p.teamName}</span>
                        </td>
                        <td className="py-3 px-4">{p.paymentChannel || 'ยังไม่ระบุ'}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-[#156143]">
                          ฿{p.amountPaid.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-[#B91C1C]">
                          ฿{p.amountDue.toLocaleString()}
                        </td>
                        <td className="py-3 px-4">
                          <StatusIndicator
                            tone={
                              p.paymentStatus === 'paid'
                                ? 'success'
                                : p.paymentStatus === 'pending_verify'
                                ? 'warning'
                                : p.paymentStatus === 'partial'
                                ? 'warning'
                                : p.paymentStatus === 'refunded'
                                ? 'neutral'
                                : 'danger'
                            }
                            label={
                              p.paymentStatus === 'paid'
                                ? 'ยืนยันแล้ว'
                                : p.paymentStatus === 'pending_verify'
                                ? 'รอตรวจสลิป'
                                : p.paymentStatus === 'partial'
                                ? 'ชำระบางส่วน'
                                : p.paymentStatus === 'refunded'
                                ? 'คืนเงินแล้ว'
                                : 'ยังไม่ชำระ'
                            }
                            compact
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {tab === 'results' && (
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-[#F7F6F2] dark:bg-[#0B121C] border-b border-[#E2DFD5] dark:border-[#25354C]">
                    <th className="py-3 px-4">คู่ที่</th>
                    <th className="py-3 px-4">ทีม A vs ทีม B</th>
                    <th className="py-3 px-4">รอบ</th>
                    <th className="py-3 px-4">คะแนนเซต</th>
                    <th className="py-3 px-4">ผู้ชนะ / สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2DFD5] dark:divide-[#25354C]">
                  {paginatedResultMatches.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 px-4 text-center text-[#525C6B] dark:text-[#9AA8BC]">
                        ไม่พบข้อมูลผลการแข่งขันตามตัวกรองที่เลือก
                      </td>
                    </tr>
                  ) : (
                    paginatedResultMatches.map((m) => (
                      <tr key={m.id}>
                        <td className="py-3 px-4 font-mono font-bold">{m.matchCode}</td>
                        <td className="py-3 px-4">
                          {m.teamAName} vs {m.teamBName}
                        </td>
                        <td className="py-3 px-4">{m.stage}</td>
                        <td className="py-3 px-4 font-mono tabular-nums">
                          {m.sets.map((s) => `${s.scoreA}-${s.scoreB}`).join(' , ') || '—'}
                        </td>
                        <td className="py-3 px-4">
                          {m.winner === 'draw' ? (
                            <StatusIndicator tone="neutral" label="เสมอ" compact />
                          ) : m.winner ? (
                            <StatusIndicator
                              tone="success"
                              label={m.winner === 'A' ? m.teamAName : m.teamBName}
                              compact
                            />
                          ) : (
                            <StatusIndicator tone="neutral" label={m.status} compact />
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {tab === 'courts' && (
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-[#F7F6F2] dark:bg-[#0B121C] border-b border-[#E2DFD5] dark:border-[#25354C]">
                    <th className="py-3 px-4">สนาม</th>
                    <th className="py-3 px-4">เวลาเปิด-ปิด</th>
                    <th className="py-3 px-4 text-right">จำนวนคู่ทั้งหมด</th>
                    <th className="py-3 px-4 text-right">จบแล้ว</th>
                    <th className="py-3 px-4 text-right">เวลาเฉลี่ย</th>
                    <th className="py-3 px-4">Conflict / ล่าช้า</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2DFD5] dark:divide-[#25354C]">
                  {paginatedCourts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 px-4 text-center text-[#525C6B] dark:text-[#9AA8BC]">
                        ไม่พบข้อมูลสนามตามตัวกรองที่เลือก
                      </td>
                    </tr>
                  ) : (
                    paginatedCourts.map((c) => {
                      const list = tMatches.filter((m) => m.courtId === c.id);
                      const conflicts = list.filter((m) => m.conflictWarning).length;
                      const durations = list.flatMap((match) => {
                        if (!match.actualStart || !match.actualEnd) return [];
                        const start = Date.parse(match.actualStart);
                        const end = Date.parse(match.actualEnd);
                        return Number.isFinite(start) && Number.isFinite(end) && end >= start
                          ? [(end - start) / 60_000]
                          : [];
                      });
                      const averageMinutes = durations.length
                        ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
                        : null;
                      return (
                        <tr key={c.id}>
                          <td className="py-3 px-4 font-semibold">{c.name}</td>
                          <td className="py-3 px-4 font-mono">
                            {c.openTime} – {c.closeTime}
                          </td>
                          <td className="py-3 px-4 text-right font-mono">{list.length}</td>
                          <td className="py-3 px-4 text-right font-mono">
                            {list.filter((m) => terminalMatchStatuses.has(m.status)).length}
                          </td>
                          <td className="py-3 px-4 text-right font-mono">{averageMinutes === null ? '—' : `${averageMinutes} น.`}</td>
                          <td className="py-3 px-4">
                            {conflicts > 0 ? (
                              <StatusIndicator tone="warning" label={`พบ ${conflicts} คู่ซ้อน`} compact />
                            ) : (
                              <StatusIndicator tone="success" label="ปกติ" compact />
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}

            {tab === 'umpires' && (
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-[#F7F6F2] dark:bg-[#0B121C] border-b border-[#E2DFD5] dark:border-[#25354C]">
                    <th className="py-3 px-4">กรรมการ</th>
                    <th className="py-3 px-4">ระดับใบรับรอง</th>
                    <th className="py-3 px-4 text-right">ได้รับมอบหมาย</th>
                    <th className="py-3 px-4 text-right">ตัดสินแล้ว</th>
                    <th className="py-3 px-4 text-right">ชั่วโมงปฏิบัติงาน</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2DFD5] dark:divide-[#25354C]">
                  {paginatedUmpires.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 px-4 text-center text-[#525C6B] dark:text-[#9AA8BC]">
                        ยังไม่มีข้อมูลกรรมการในรายการนี้
                      </td>
                    </tr>
                  ) : (
                    paginatedUmpires.map((u) => {
                      const assigned = state.matches.filter((match) => match.tournamentId === tournament.id && match.umpireId === u.id);
                      const completed = assigned.filter((match) => ['finished', 'walkover', 'retired', 'disqualified'].includes(match.status));
                      const workedMinutes = completed.reduce((sum, match) => {
                        if (!match.actualStart || !match.actualEnd) return sum;
                        const start = Date.parse(match.actualStart);
                        const end = Date.parse(match.actualEnd);
                        return Number.isFinite(start) && Number.isFinite(end) && end >= start
                          ? sum + (end - start) / 60_000
                          : sum;
                      }, 0);
                      return (
                        <tr key={u.id}>
                          <td className="py-3 px-4 font-semibold">{u.firstName} {u.lastName} ({u.code})</td>
                          <td className="py-3 px-4">{u.certification}</td>
                          <td className="py-3 px-4 text-right font-mono">{assigned.length}</td>
                          <td className="py-3 px-4 text-right font-mono">{completed.length}</td>
                          <td className="py-3 px-4 text-right font-mono">{workedMinutes ? (workedMinutes / 60).toFixed(1) : '0.0'} ชม.</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>

          {tab === 'umpires' && (
            <div className="rounded-xl border border-[#E2DFD5] bg-white p-4 text-xs dark:border-[#25354C] dark:bg-[#131E2E]">
              <h3 className="mb-3 text-sm font-bold">เหตุการณ์และรายงานปัญหา ({tIncidents.length})</h3>
              {tIncidents.length === 0 ? (
                <div className="py-4 text-center text-[#525C6B]">ไม่มีเหตุการณ์ที่ถูกรายงาน</div>
              ) : (
                <div className="divide-y divide-[#E2DFD5] dark:divide-[#25354C]">
                  {tIncidents.map((incident) => (
                    <div key={incident.id} className="grid gap-2 py-2.5 sm:grid-cols-[150px_100px_1fr_100px]">
                      <span className="font-mono">{incident.timestamp}</span>
                      <span>{incident.matchCode || 'ทั้งรายการ'}</span>
                      <span>{incident.description}</span>
                      <StatusIndicator tone={incident.status === 'resolved' ? 'success' : 'warning'} label={incident.status === 'resolved' ? 'แก้ไขแล้ว' : 'เปิดอยู่'} compact />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <PaginationBar
            page={safePage}
            pageSize={pageSize}
            totalItems={activeTotalItems}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
      </div>
    </div>
  );
};
