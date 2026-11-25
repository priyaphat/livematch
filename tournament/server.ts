import express, { NextFunction, Request, Response } from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { createInitialSystemState } from './src/data/mockData';
import {
  AuditLogEntry,
  MatchRecord,
  PermissionKey,
  PlayerRecord,
  SystemStatePayload,
  Tournament,
  UserRole,
} from './src/types/tournament';
import {
  calculateExpandParticipantsCost,
  calculateParticipantExtraCost,
  getDivisionFormat,
  getRegistrationWindowStatus,
  getTournamentAllocatedParticipants,
} from './src/utils/registration';
import {
  applyBadmintonPoint,
  applyManualServerPlayerSwap,
  applyManualTeamServeToggle,
  createSnapshotForUndo,
  getManualSwapsMap,
} from './src/utils/badmintonRules';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

let systemState: SystemStatePayload = createInitialSystemState();
const processedEventIds = new Set<string>();

// SSE Clients
const sseClients = new Set<Response>();

function broadcastEvent(eventName: string, data: unknown) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

function nowBangkokTime(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}

function nowBangkokDateTime(): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  return parts;
}

function appendAudit(
  actorName: string,
  actorRole: UserRole,
  action: string,
  target: string,
  reason?: string,
  tournamentId?: string
) {
  const entry: AuditLogEntry = {
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: nowBangkokDateTime(),
    actorName,
    actorRole,
    action,
    target,
    reason,
    tournamentId,
  };
  systemState.auditLogs = [entry, ...systemState.auditLogs].slice(0, 200);
}

// Rate limiting store for Director 12-digit login
interface LoginAttemptTracker {
  failures: number;
  lockedUntil: number;
}
const directorLoginAttempts = new Map<string, LoginAttemptTracker>();

function getActor(req: Request): { role: UserRole; name: string } {
  const headerRole = (req.headers['x-user-role'] as UserRole) || systemState.activeUserRole;
  const headerName =
    decodeURIComponent((req.headers['x-user-name'] as string) || '') || systemState.activeUserName;
  return { role: headerRole, name: headerName };
}

function requirePermission(perm: PermissionKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    const { role } = getActor(req);
    const roleMap = systemState.rolePermissions[role];
    if (!roleMap || !roleMap[perm]) {
      return res.status(403).json({
        error: `สิทธิ์ของคุณ (${role}) ไม่ได้รับอนุญาตให้ดำเนินการนี้ (${perm})`,
      });
    }
    next();
  };
}

function isValidHttpUrl(raw?: string): boolean {
  if (!raw || !raw.trim()) return true;
  try {
    const parsed = new URL(raw.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function generateVerificationCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getPublicPayload() {
  const publicTournaments = systemState.tournaments
    .filter((t) => t.publicViewConfig.enabled)
    .map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      organizer: t.organizer,
      venue: t.venue,
      startDate: t.startDate,
      endDate: t.endDate,
      startTime: t.startTime,
      endTime: t.endTime,
      status: t.status,
      bannerUrl: t.bannerUrl,
      emblemUrl: t.emblemUrl,
      sponsors: t.publicViewConfig.showSponsors ? t.sponsors : [],
      divisions: t.divisions,
      courts: t.courts,
      publicViewConfig: t.publicViewConfig,
      emergencyPaused: t.emergencyPaused,
      emergencyReason: t.emergencyReason,
    }));

  // Strictly scrub personal data (phone, email, birthDate, healthInfo, payment details)
  const publicTeams = systemState.players.map((p) => ({
    id: p.id,
    registrationCode: p.registrationCode,
    tournamentId: p.tournamentId,
    teamName: p.teamName,
    teamLogoUrl: p.teamLogoUrl,
    club: p.club,
    province: p.province,
    divisionId: p.divisionId,
    format: p.format,
    seed: p.seed,
    groupName: p.groupName,
    waitingList: p.waitingList,
    withdrawn: p.withdrawn,
  }));

  const publicMatches = systemState.matches.map((m) => {
    const tourney = systemState.tournaments.find((t) => t.id === m.tournamentId);
    const showUmpire = tourney?.publicViewConfig.showUmpireName ?? false;
    return {
      ...m,
      umpireName: showUmpire ? m.umpireName : undefined,
      umpireId: undefined,
    };
  });

  return {
    tournaments: publicTournaments,
    teams: publicTeams,
    matches: publicMatches,
    serverTime: nowBangkokTime(),
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // SSE Real-Time Endpoint
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, time: nowBangkokTime() })}\n\n`);
    sseClients.add(res);

    const heartbeat = setInterval(() => {
      res.write(`: heartbeat\n\n`);
    }, 20000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  // Full state for staff/admin
  app.get('/api/state', (_req, res) => {
    res.json(systemState);
  });

  // Public scrubbed state (no login required)
  app.get('/api/public/state', (_req, res) => {
    res.json(getPublicPayload());
  });

  // Dynamic Web App Manifest per Public Page / Live Score Tab
  app.get('/api/manifest', (req, res) => {
    const mode = String(req.query.mode || 'public');
    const tournamentId = String(req.query.tournament || '');
    const tab = String(req.query.tab || 'center');
    const kiosk = String(req.query.kiosk || '1');

    const tourney = systemState.tournaments.find((t) => t.id === tournamentId);
    const tName = tourney?.name || 'LiveMatch';

    const params = new URLSearchParams();
    params.set('mode', mode);
    if (tournamentId) params.set('tournament', tournamentId);
    if (mode === 'public') {
      params.set('tab', tab);
      if (kiosk === '1') params.set('kiosk', '1');
    }

    const tabLabels: Record<string, { name: string; short: string }> = {
      center: { name: `${tName} - Match Center`, short: 'Match Center' },
      live: { name: `${tName} - Live Score`, short: 'Live Score' },
      bracket: { name: `${tName} - Bracket View`, short: 'Bracket View' },
      venue: { name: `${tName} - Venue TV`, short: 'Venue TV' },
    };

    let appName = `${tName} LiveMatch`;
    let shortName = 'LiveMatch';
    if (mode === 'public_register') {
      appName = `สมัครแข่งขัน · ${tName}`;
      shortName = 'สมัครแข่ง';
    } else if (mode === 'public_status') {
      appName = `ตรวจสอบสถานะทีม · ${tName}`;
      shortName = 'ตรวจสถานะ';
    } else if (mode === 'public') {
      const lbl = tabLabels[tab] || tabLabels.center;
      appName = lbl.name;
      shortName = lbl.short;
    }

    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.json({
      id: `/?${params.toString()}`,
      name: appName,
      short_name: shortName.slice(0, 12),
      start_url: `/?${params.toString()}`,
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      theme_color: '#142642',
      background_color: '#0B121C',
      icons: [
        { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    });
  });

  // Public Player / Team Status & Bracket Lookup via Registration Code or Verification Code
  app.get('/api/public/player-status', (req, res) => {
    const tournamentId = String(req.query.tournamentId || '').trim();
    const rawCode = String(req.query.code || '').trim().toLowerCase();
    if (!rawCode) {
      return res.status(400).json({ error: 'กรุณาระบุรหัสตรวจสอบ หรือเลขที่สมัคร (เช่น PHR-2601)' });
    }

    const player = systemState.players.find((p) => {
      if (tournamentId && p.tournamentId !== tournamentId) return false;
      const regMatch = p.registrationCode.toLowerCase() === rawCode;
      const verMatch = (p.verificationCode || '').toLowerCase() === rawCode;
      return regMatch || verMatch;
    });

    if (!player) {
      return res.status(404).json({
        error: 'ไม่พบข้อมูลทีมตามรหัสตรวจสอบนี้ กรุณาตรวจสอบรหัสอีกครั้ง',
      });
    }

    const tourney = systemState.tournaments.find((t) => t.id === player.tournamentId);
    if (!tourney) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลรายการแข่งขัน' });
    }

    const divisionMatches = systemState.matches
      .filter((m) => m.tournamentId === player.tournamentId && m.divisionId === player.divisionId)
      .map((m) => ({
        ...m,
        umpireId: undefined,
        umpireName: tourney.publicViewConfig.showUmpireName ? m.umpireName : undefined,
      }));

    const teamMatches = divisionMatches.filter(
      (m) =>
        m.teamAId === player.id ||
        m.teamBId === player.id ||
        m.teamAName === player.teamName ||
        m.teamBName === player.teamName
    );

    res.json({
      tournament: {
        id: tourney.id,
        name: tourney.name,
        venue: tourney.venue,
        startDate: tourney.startDate,
        endDate: tourney.endDate,
        bannerUrl: tourney.bannerUrl,
        emblemUrl: tourney.emblemUrl,
        divisions: tourney.divisions,
        courts: tourney.courts,
        paymentConfig: {
          promptPayId: tourney.paymentConfig.promptPayId,
          bankName: tourney.paymentConfig.bankName,
          bankAccountNo: tourney.paymentConfig.bankAccountNo,
          bankAccountName: tourney.paymentConfig.bankAccountName,
        },
      },
      player: {
        id: player.id,
        registrationCode: player.registrationCode,
        verificationCode: player.verificationCode || player.registrationCode,
        tournamentId: player.tournamentId,
        teamName: player.teamName,
        teamLogoUrl: player.teamLogoUrl,
        firstName: player.firstName,
        lastName: player.lastName,
        nickname: player.nickname,
        partnerName: player.partnerName,
        photoUrl: player.photoUrl,
        partnerPhotoUrl: player.partnerPhotoUrl,
        club: player.club,
        province: player.province,
        divisionId: player.divisionId,
        format: player.format,
        skillVideoUrl: player.skillVideoUrl,
        documentStatus: player.documentStatus,
        approvalNote: player.approvalNote,
        paymentStatus: player.paymentStatus,
        slipStatus: player.slipStatus,
        paymentRejectReason: player.paymentRejectReason,
        amountPaid: player.amountPaid,
        amountDue: player.amountDue,
        checkedIn: player.checkedIn,
        checkInTime: player.checkInTime,
        waitingList: player.waitingList,
        waitingPosition: player.waitingPosition,
        withdrawn: player.withdrawn,
        seed: player.seed,
        groupName: player.groupName,
        registeredAt: player.registeredAt,
      },
      teamMatches,
      divisionMatches,
    });
  });

  // Toggle LiveMatch Admin feature setting "ระบบจัดแข่ง"
  app.post('/api/feature-toggle', (req, res) => {
    const { enabled } = req.body as { enabled: boolean };
    systemState.liveMatchFeatureEnabled = Boolean(enabled);
    const actor = getActor(req);
    appendAudit(
      actor.name,
      actor.role,
      enabled ? 'ENABLE_TOURNAMENT_MODULE' : 'DISABLE_TOURNAMENT_MODULE',
      'LiveMatch User Admin · ระบบจัดแข่ง'
    );
    broadcastEvent('state_sync', systemState);
    res.json({ liveMatchFeatureEnabled: systemState.liveMatchFeatureEnabled });
  });

  // Role switcher for prototype verification
  app.post('/api/role-switch', (req, res) => {
    const { role, name } = req.body as { role: UserRole; name: string };
    systemState.activeUserRole = role;
    systemState.activeUserName = name;
    broadcastEvent('state_sync', systemState);
    res.json({ activeUserRole: role, activeUserName: name });
  });

  // Director / Umpire 12-Digit Code Login with Rate Limiting & Lockout
  app.post('/api/director/login', (req, res) => {
    const ip = req.ip || 'local';
    const now = Date.now();
    const tracker = directorLoginAttempts.get(ip) || { failures: 0, lockedUntil: 0 };

    if (tracker.lockedUntil > now) {
      const waitSec = Math.ceil((tracker.lockedUntil - now) / 1000);
      return res.status(429).json({
        error: `กรอกรหัสผิดเกินกำหนด กรุณารอ ${waitSec} วินาที แล้วลองใหม่อีกครั้ง`,
        lockedUntil: tracker.lockedUntil,
      });
    }

    const code = String(req.body?.code || '').replace(/\D/g, '');
    if (code.length !== 12) {
      return res.status(400).json({ error: 'กรุณากรอกรหัสกรรมการตัวเลข 12 หลักให้ครบถ้วน' });
    }

    const umpire = systemState.umpires.find((u) => u.loginCode12 === code);
    if (!umpire) {
      tracker.failures += 1;
      if (tracker.failures >= 5) {
        tracker.lockedUntil = now + 120_000;
        tracker.failures = 0;
      }
      directorLoginAttempts.set(ip, tracker);
      const remaining = tracker.lockedUntil > now ? 0 : 5 - tracker.failures;
      return res.status(401).json({
        error:
          remaining === 0
            ? 'กรอกรหัสผิดครบ 5 ครั้ง ระบบล็อกชั่วคราว 2 นาที'
            : `ไม่พบรหัสกรรมการนี้ (เหลือโอกาสอีก ${remaining} ครั้ง)`,
      });
    }

    if (!umpire.active) {
      return res.status(403).json({ error: 'รหัสกรรมการนี้ถูกระงับการใช้งาน (Revoked)' });
    }

    const expDate = new Date(umpire.codeExpiresAt.replace(' ', 'T') + '+07:00').getTime();
    if (!Number.isNaN(expDate) && expDate < now) {
      return res.status(403).json({ error: `รหัสกรรมการหมดอายุแล้ว (${umpire.codeExpiresAt})` });
    }

    directorLoginAttempts.delete(ip);
    const assignedMatches = systemState.matches.filter((m) => m.umpireId === umpire.id);
    appendAudit(umpire.firstName + ' ' + umpire.lastName, 'director', 'DIRECTOR_LOGIN', umpire.code);
    res.json({
      umpire,
      matches: assignedMatches,
    });
  });

  // Create tournament
  app.post('/api/tournaments', requirePermission('createTournament'), (req, res) => {
    const rawMax = Number(req.body?.maxParticipants);
    if (!Number.isFinite(rawMax) || rawMax < 1) {
      return res.status(400).json({ error: 'กรุณาระบุจำนวนคนที่ต้องลงสมัครอย่างน้อย 1 คน' });
    }
    const maxParticipants = Math.floor(rawMax);
    const divisions = Array.isArray(req.body?.divisions) ? req.body.divisions : [];
    const hasUnlimited = divisions.some((d: any) => {
      if (!d?.enabled) return false;
      const fmt = getDivisionFormat(d);
      return fmt === 'doubles' ? d.quotaDoubles === 'unlimited' : d.quotaSingles === 'unlimited';
    });
    if (hasUnlimited) {
      return res.status(400).json({ error: 'ไม่สามารถตั้งโควตาระดับมือเป็น "ไม่จำกัด" ได้ ต้องระบุจำนวนให้ไม่เกินจำนวนคนที่กำหนด' });
    }

    const allocatedPeople = getTournamentAllocatedParticipants(divisions);
    if (allocatedPeople > maxParticipants) {
      return res.status(400).json({
        error: `โควตารวมของระดับมือ (${allocatedPeople} คน) เกินจำนวนผู้สมัครที่กำหนด (${maxParticipants} คน)`,
      });
    }

    const costCoins = calculateParticipantExtraCost(maxParticipants);
    if (systemState.coinBalance < costCoins) {
      return res.status(400).json({
        error: `ยอด Coin ไม่เพียงพอ (ต้องใช้ ${costCoins.toLocaleString()} Coin · คงเหลือ ${systemState.coinBalance.toLocaleString()} Coin)`,
      });
    }

    systemState.coinBalance -= costCoins;
    const newT: Tournament = {
      ...req.body,
      maxParticipants,
    };
    systemState.tournaments = [newT, ...systemState.tournaments];
    const actor = getActor(req);
    appendAudit(
      actor.name,
      actor.role,
      'CREATE_TOURNAMENT',
      `${newT.name} (${maxParticipants} คน)`,
      costCoins > 0 ? `ชำระ ${costCoins.toLocaleString()} Coin` : 'สิทธิ์ฟรี 20 คนแรก',
      newT.id
    );
    broadcastEvent('state_sync', systemState);
    res.json(newT);
  });

  // Expand tournament participant capacity using Coin
  app.post('/api/tournaments/:id/expand-capacity', requirePermission('editSettings'), (req, res) => {
    const idx = systemState.tournaments.findIndex((t) => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'ไม่พบรายการแข่งขัน' });

    const rawAdd = Number(req.body?.addParticipants);
    if (!Number.isFinite(rawAdd) || rawAdd < 1 || !Number.isInteger(rawAdd)) {
      return res.status(400).json({ error: 'กรุณาระบุจำนวนคนที่ต้องการเพิ่มเป็นจำนวนเต็มตั้งแต่ 1 คนขึ้นไป' });
    }

    const t = systemState.tournaments[idx];
    const currentMax = Math.max(0, Math.floor(Number(t.maxParticipants) || 20));
    const costCoins = calculateExpandParticipantsCost(currentMax, rawAdd);

    if (systemState.coinBalance < costCoins) {
      return res.status(400).json({
        error: `ยอด Coin ไม่เพียงพอ (ต้องใช้ ${costCoins.toLocaleString()} Coin · คงเหลือ ${systemState.coinBalance.toLocaleString()} Coin)`,
      });
    }

    systemState.coinBalance -= costCoins;
    const updated: Tournament = {
      ...t,
      maxParticipants: currentMax + rawAdd,
    };
    systemState.tournaments[idx] = updated;

    const actor = getActor(req);
    appendAudit(
      actor.name,
      actor.role,
      'EXPAND_CAPACITY',
      `${updated.name} (+${rawAdd} คน → ${updated.maxParticipants} คน)`,
      costCoins > 0 ? `ชำระ ${costCoins.toLocaleString()} Coin` : 'ภายในสิทธิ์ฟรี 20 คนแรก',
      updated.id
    );
    broadcastEvent('state_sync', systemState);
    res.json({
      tournament: updated,
      coinBalance: systemState.coinBalance,
      costCoins,
    });
  });

  // Update tournament (status, settings, divisions, courts, emergency pause)
  app.patch('/api/tournaments/:id', requirePermission('editSettings'), (req, res) => {
    const idx = systemState.tournaments.findIndex((t) => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'ไม่พบรายการแข่งขัน' });

    const prev = systemState.tournaments[idx];
    const lockedMax = prev.maxParticipants ?? 20;
    const nextDivisions = Array.isArray(req.body?.divisions) ? req.body.divisions : prev.divisions;

    const hasUnlimited = nextDivisions.some((d: any) => {
      if (!d?.enabled) return false;
      const fmt = getDivisionFormat(d);
      return fmt === 'doubles' ? d.quotaDoubles === 'unlimited' : d.quotaSingles === 'unlimited';
    });
    if (hasUnlimited) {
      return res.status(400).json({
        error: 'ไม่สามารถตั้งโควตาระดับมือเป็น "ไม่จำกัด" ได้ กรุณาระบุจำนวนที่ชัดเจนภายในโควตารวม',
      });
    }

    const allocatedPeople = getTournamentAllocatedParticipants(nextDivisions);
    if (allocatedPeople > lockedMax) {
      return res.status(400).json({
        error: `โควตารวมของระดับมือ (${allocatedPeople} คน) เกินจำนวนผู้สมัครที่กำหนดไว้ (${lockedMax} คน) กรุณาลดโควตาหรือซื้อจำนวนคนเพิ่มด้วย Coin`,
      });
    }

    const { maxParticipants: _ignoredMax, _auditReason, ...restBody } = req.body || {};
    const updated: Tournament = {
      ...prev,
      ...restBody,
      divisions: nextDivisions,
      maxParticipants: lockedMax,
    };
    systemState.tournaments[idx] = updated;

    const actor = getActor(req);
    appendAudit(
      actor.name,
      actor.role,
      'UPDATE_TOURNAMENT',
      updated.name,
      _auditReason,
      updated.id
    );
    broadcastEvent('state_sync', systemState);
    res.json(updated);
  });

  // Duplicate tournament
  app.post('/api/tournaments/:id/duplicate', requirePermission('createTournament'), (req, res) => {
    const src = systemState.tournaments.find((t) => t.id === req.params.id);
    if (!src) return res.status(404).json({ error: 'ไม่พบรายการต้นฉบับ' });

    const maxParticipants = src.maxParticipants ?? 20;
    const costCoins = calculateParticipantExtraCost(maxParticipants);
    if (systemState.coinBalance < costCoins) {
      return res.status(400).json({
        error: `ยอด Coin ไม่เพียงพอสำหรับคัดลอกรายการ ${maxParticipants} คน (ต้องใช้ ${costCoins.toLocaleString()} Coin)`,
      });
    }

    systemState.coinBalance -= costCoins;
    const copy = structuredClone(src);
    copy.id = `trn-${Date.now()}`;
    copy.name = `${src.name} (สำเนา)`;
    copy.status = 'Draft';
    copy.bracketLocked = false;
    copy.bracketVersion = 1;
    copy.maxParticipants = maxParticipants;
    systemState.tournaments = [copy, ...systemState.tournaments];
    const actor = getActor(req);
    appendAudit(
      actor.name,
      actor.role,
      'DUPLICATE_TOURNAMENT',
      copy.name,
      costCoins > 0 ? `ชำระ ${costCoins.toLocaleString()} Coin` : undefined,
      copy.id
    );
    broadcastEvent('state_sync', systemState);
    res.json(copy);
  });

  // Register player (Public or Staff)
  app.post('/api/players', (req, res) => {
    const body = req.body as PlayerRecord;
    const tourney = systemState.tournaments.find((t) => t.id === body.tournamentId);
    if (!tourney) return res.status(404).json({ error: 'ไม่พบรายการแข่งขัน' });

    const source = body.registrationSource || 'staff';
    if (source === 'online') {
      const regWindow = getRegistrationWindowStatus(tourney);
      if (!regWindow.isOpen) {
        return res.status(403).json({
          error: regWindow.reason || 'ปิดรับสมัครออนไลน์แล้ว ตามกำหนดเวลาที่ตั้งค่าไว้',
        });
      }
      if (!body.slipImageUrl || body.slipStatus === 'not_uploaded') {
        return res.status(400).json({
          error: 'การสมัครออนไลน์จำเป็นต้องแนบหลักฐานสลิปโอนเงินก่อนส่งใบสมัคร',
        });
      }
    }

    const division = tourney.divisions.find((d) => d.id === body.divisionId);
    const resolvedFormat = division ? getDivisionFormat(division) : body.format || 'doubles';

    if (!body.photoUrl) {
      return res.status(400).json({
        error: 'กรุณาอัปโหลดรูปภาพนักกีฬาคนที่ 1 ให้เรียบร้อย',
      });
    }

    const partnerFullName =
      `${body.partnerFirstName || ''} ${body.partnerLastName || ''}`.trim() ||
      (body.partnerName || '').trim();

    if (resolvedFormat === 'doubles') {
      if (!partnerFullName) {
        return res.status(400).json({
          error: 'ประเภทคู่จำเป็นต้องกรอกข้อมูลนักกีฬาคนที่ 2 ให้ครบถ้วน',
        });
      }
      if (!body.partnerPhotoUrl) {
        return res.status(400).json({
          error: 'ประเภทคู่จำเป็นต้องอัปโหลดรูปภาพนักกีฬาคนที่ 2',
        });
      }
    }

    if (!isValidHttpUrl(body.skillVideoUrl)) {
      return res.status(400).json({
        error: 'ลิงก์วิดีโอประเมินมือต้องขึ้นต้นด้วย http:// หรือ https:// เท่านั้น',
      });
    }

    const activeCount = systemState.players.filter(
      (p) =>
        p.tournamentId === body.tournamentId &&
        p.divisionId === body.divisionId &&
        !p.withdrawn &&
        !p.waitingList
    ).length;

    const quota =
      resolvedFormat === 'doubles' ? division?.quotaDoubles : division?.quotaSingles;
    const isFull = typeof quota === 'number' && quota > 0 && activeCount >= quota;

    const waitingPos = isFull
      ? systemState.players.filter(
          (p) =>
            p.tournamentId === body.tournamentId &&
            p.divisionId === body.divisionId &&
            p.waitingList
        ).length + 1
      : undefined;

    const created: PlayerRecord = {
      ...body,
      id: body.id || `pl-${Date.now()}`,
      registrationCode: body.registrationCode || `PHR-${Math.floor(2620 + Math.random() * 700)}`,
      verificationCode: body.verificationCode || generateVerificationCode(),
      teamLogoUrl: body.teamLogoUrl || undefined,
      skillVideoUrl: body.skillVideoUrl?.trim() || undefined,
      format: resolvedFormat,
      partnerName: resolvedFormat === 'doubles' ? partnerFullName : undefined,
      paymentStatus: source === 'online' ? 'pending_verify' : body.paymentStatus || 'unpaid',
      slipStatus: source === 'online' ? 'pending' : body.slipStatus || 'not_uploaded',
      waitingList: isFull,
      waitingPosition: waitingPos,
      registeredAt: nowBangkokDateTime(),
    };

    systemState.players = [created, ...systemState.players];
    const actor = getActor(req);
    appendAudit(
      actor.name,
      actor.role,
      'REGISTER_PLAYER',
      `${created.teamName} (${created.registrationCode})`,
      isFull ? 'เข้าคิว Waiting List อัตโนมัติ' : undefined,
      created.tournamentId
    );
    broadcastEvent('state_sync', systemState);
    res.json(created);
  });

  // Update player (approve, payment, check-in, withdraw + waiting list auto-promotion)
  app.patch('/api/players/:id', (req, res) => {
    const idx = systemState.players.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'ไม่พบข้อมูลนักกีฬา' });

    const prev = systemState.players[idx];
    const updated: PlayerRecord = { ...prev, ...req.body };
    if (updated.checkedIn && !prev.checkedIn) {
      updated.checkInTime = nowBangkokTime().slice(0, 5);
    }
    systemState.players[idx] = updated;

    // Auto-promote waiting list if player withdrew
    let promotedPlayer: PlayerRecord | null = null;
    if (updated.withdrawn && !prev.withdrawn && !prev.waitingList) {
      const nextWaiting = systemState.players
        .filter(
          (p) =>
            p.tournamentId === updated.tournamentId &&
            p.divisionId === updated.divisionId &&
            p.waitingList &&
            !p.withdrawn
        )
        .sort((a, b) => (a.waitingPosition || 999) - (b.waitingPosition || 999))[0];
      if (nextWaiting) {
        nextWaiting.waitingList = false;
        nextWaiting.waitingPosition = undefined;
        nextWaiting.notes = 'เลื่อนสิทธิ์จาก Waiting List อัตโนมัติ';
        promotedPlayer = nextWaiting;
      }
    }

    const actor = getActor(req);
    appendAudit(
      actor.name,
      actor.role,
      'UPDATE_PLAYER',
      `${updated.teamName} (${updated.registrationCode})`,
      promotedPlayer ? `เลื่อน ${promotedPlayer.teamName} จาก Waiting List` : undefined,
      updated.tournamentId
    );
    broadcastEvent('state_sync', systemState);
    res.json({ updated, promotedPlayer });
  });

  // Bulk approve / check-in
  app.post('/api/players/bulk', requirePermission('approveRegistration'), (req, res) => {
    const { ids, action } = req.body as { ids: string[]; action: 'approve' | 'checkin' };
    for (const p of systemState.players) {
      if (ids.includes(p.id)) {
        if (action === 'approve') p.documentStatus = 'approved';
        if (action === 'checkin') {
          p.checkedIn = true;
          p.checkInTime = nowBangkokTime().slice(0, 5);
        }
      }
    }
    const actor = getActor(req);
    appendAudit(actor.name, actor.role, `BULK_${action.toUpperCase()}`, `${ids.length} รายการ`);
    broadcastEvent('state_sync', systemState);
    res.json({ ok: true, count: ids.length });
  });

  // Merge duplicate player records
  app.post('/api/players/merge', requirePermission('approveRegistration'), (req, res) => {
    const { primaryId, duplicateId } = req.body as { primaryId: string; duplicateId: string };
    const dup = systemState.players.find((p) => p.id === duplicateId);
    const pri = systemState.players.find((p) => p.id === primaryId);
    if (!dup || !pri) return res.status(404).json({ error: 'ไม่พบรายการที่จะรวม' });

    pri.notes = [pri.notes, `รวมข้อมูลซ้ำจาก ${dup.registrationCode}`].filter(Boolean).join(' · ');
    pri.possibleDuplicateOf = undefined;
    dup.possibleDuplicateOf = undefined;
    systemState.players = systemState.players.filter((p) => p.id !== duplicateId);

    const actor = getActor(req);
    appendAudit(
      actor.name,
      actor.role,
      'MERGE_DUPLICATE_PLAYER',
      `${pri.firstName} ${pri.lastName} (${pri.registrationCode} ← ${dup.registrationCode})`,
      undefined,
      pri.tournamentId
    );
    broadcastEvent('state_sync', systemState);
    res.json({ ok: true });
  });

  // Review Player Registration Approval (Online / Staff)
  app.post('/api/players/:id/review-approval', requirePermission('approveRegistration'), (req, res) => {
    const idx = systemState.players.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'ไม่พบข้อมูลนักกีฬา' });

    const { decision, reason } = req.body as {
      decision: 'approved' | 'rejected' | 'pending';
      reason?: string;
    };
    const actor = getActor(req);
    const prev = systemState.players[idx];
    const updated: PlayerRecord = {
      ...prev,
      documentStatus: decision,
      approvalNote: reason || undefined,
      approvedBy: actor.name,
      approvedAt: nowBangkokDateTime(),
    };
    systemState.players[idx] = updated;

    appendAudit(
      actor.name,
      actor.role,
      decision === 'approved' ? 'APPROVE_PLAYER' : decision === 'rejected' ? 'REJECT_PLAYER' : 'RESET_PLAYER_APPROVAL',
      `${updated.teamName} (${updated.registrationCode})`,
      reason,
      updated.tournamentId
    );
    broadcastEvent('state_sync', systemState);
    res.json({ player: updated });
  });

  // Review Online Payment Slip
  app.post('/api/players/:id/review-payment', requirePermission('verifyPayment'), (req, res) => {
    const idx = systemState.players.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'ไม่พบข้อมูลนักกีฬา' });

    const { decision, paidAmount, reason } = req.body as {
      decision: 'approved' | 'rejected' | 'partial';
      paidAmount?: number;
      reason?: string;
    };
    const actor = getActor(req);
    const prev = systemState.players[idx];
    const totalFee = prev.amountPaid + prev.amountDue;
    const updated: PlayerRecord = {
      ...prev,
      paymentVerifiedBy: actor.name,
      paymentVerifiedAt: nowBangkokDateTime(),
    };

    if (decision === 'approved') {
      const targetPaid = typeof paidAmount === 'number' && paidAmount > 0 ? paidAmount : totalFee || prev.slipTransferAmount || 800;
      updated.paymentStatus = 'paid';
      updated.slipStatus = 'approved';
      updated.amountPaid = targetPaid;
      updated.amountDue = Math.max(0, totalFee - targetPaid);
      updated.paymentRejectReason = undefined;
    } else if (decision === 'partial') {
      const added = typeof paidAmount === 'number' && paidAmount > 0 ? paidAmount : prev.slipTransferAmount || Math.round(totalFee / 2);
      const newPaid = Math.min(totalFee, prev.amountPaid + added);
      updated.amountPaid = newPaid;
      updated.amountDue = Math.max(0, totalFee - newPaid);
      updated.paymentStatus = updated.amountDue === 0 ? 'paid' : 'partial';
      updated.slipStatus = 'approved';
      updated.paymentRejectReason = reason || 'รับชำระบางส่วน รอชำระส่วนที่เหลือ';
    } else {
      updated.paymentStatus = 'unpaid';
      updated.slipStatus = 'rejected';
      updated.paymentRejectReason = reason || 'สลิปไม่ถูกต้อง / ยอดโอนไม่ตรง';
    }

    systemState.players[idx] = updated;
    appendAudit(
      actor.name,
      actor.role,
      `PAYMENT_${decision.toUpperCase()}`,
      `${updated.teamName} (${updated.registrationCode})`,
      reason,
      updated.tournamentId
    );
    broadcastEvent('state_sync', systemState);
    res.json({ player: updated });
  });

  // Upload or Attach Payment Slip for Online Registration
  app.post('/api/players/:id/upload-slip', (req, res) => {
    const idx = systemState.players.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'ไม่พบข้อมูลนักกีฬา' });

    const { slipImageUrl, slipTransferBank, slipTransferRef, slipTransferAmount, paymentChannel } = req.body as {
      slipImageUrl?: string;
      slipTransferBank?: string;
      slipTransferRef?: string;
      slipTransferAmount?: number;
      paymentChannel?: PlayerRecord['paymentChannel'];
    };

    const prev = systemState.players[idx];
    const updated: PlayerRecord = {
      ...prev,
      registrationSource: prev.registrationSource || 'online',
      paymentChannel: paymentChannel || prev.paymentChannel || 'PromptPay',
      paymentStatus: 'pending_verify',
      slipStatus: 'pending',
      slipImageUrl: slipImageUrl || prev.slipImageUrl,
      slipTransferBank: slipTransferBank || 'พร้อมเพย์ (PromptPay QR)',
      slipTransferRef: slipTransferRef || `PP-${Date.now().toString().slice(-8)}`,
      slipTransferAmount: slipTransferAmount ?? prev.amountDue,
      slipUploadedAt: nowBangkokDateTime(),
      paymentRejectReason: undefined,
    };
    systemState.players[idx] = updated;

    const actor = getActor(req);
    appendAudit(
      actor.name,
      actor.role,
      'UPLOAD_PAYMENT_SLIP',
      `${updated.teamName} (${updated.registrationCode})`,
      `฿${updated.slipTransferAmount}`,
      updated.tournamentId
    );
    broadcastEvent('state_sync', systemState);
    res.json({ player: updated });
  });

  // Umpires CRUD, Online Application, Approval & 12-digit code regeneration
  app.post('/api/umpires', requirePermission('assignUmpire'), (req, res) => {
    const body = req.body || {};
    const tUmpCount = systemState.umpires.filter((item) => item.tournamentId === body.tournamentId).length;
    const u = {
      id: body.id || `ump-${Date.now()}`,
      code: body.code || `UMP-${String(tUmpCount + 1).padStart(2, '0')}`,
      loginCode12:
        body.loginCode12 ||
        Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join(''),
      approvalStatus: 'approved',
      applicationSource: 'staff',
      appliedAt: body.appliedAt || nowBangkokDateTime(),
      active: true,
      assignedMatches: 0,
      completedMatches: 0,
      hoursWorked: 0,
      history: [],
      ...body,
      photoUrl: body.photoUrl || undefined,
    };
    systemState.umpires = [u, ...systemState.umpires];
    const actor = getActor(req);
    appendAudit(actor.name, actor.role, 'ADD_UMPIRE', `${u.firstName} ${u.lastName}`, undefined, u.tournamentId);
    broadcastEvent('state_sync', systemState);
    res.json(u);
  });

  // Public/Online Director/Umpire Application (Pending Approval)
  app.post('/api/umpires/apply', (req, res) => {
    const body = req.body;
    const code12 = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');
    const tUmpCount = systemState.umpires.filter((item) => item.tournamentId === body.tournamentId).length;
    const created = {
      id: `ump-${Date.now()}`,
      code: `UMP-${String(tUmpCount + 1).padStart(2, '0')}`,
      tournamentId: body.tournamentId,
      firstName: body.firstName,
      lastName: body.lastName,
      nickname: body.nickname || body.firstName,
      phone: body.phone,
      email: body.email || '',
      certification: body.certification || 'กรรมการภูมิภาค ระดับ 1',
      availableDates: body.availableDates || [],
      capableDivisions: body.capableDivisions || [],
      loginCode12: code12,
      codeExpiresAt: body.codeExpiresAt || '2026-12-31 23:59',
      active: false,
      assignedMatches: 0,
      completedMatches: 0,
      hoursWorked: 0,
      clubAffiliation: body.clubAffiliation || 'อิสระ (ไม่มีสังกัด)',
      photoUrl: body.photoUrl || undefined,
      approvalStatus: 'pending' as const,
      applicationSource: 'online' as const,
      appliedAt: nowBangkokDateTime(),
      experienceNote: body.experienceNote || '',
      history: [],
    };
    systemState.umpires = [created, ...systemState.umpires];
    const actor = getActor(req);
    appendAudit(actor.name, actor.role, 'APPLY_UMPIRE', `${created.firstName} ${created.lastName}`, undefined, created.tournamentId);
    broadcastEvent('state_sync', systemState);
    res.json(created);
  });

  // Review Director / Umpire Approval
  app.post('/api/umpires/:id/review', requirePermission('assignUmpire'), (req, res) => {
    const idx = systemState.umpires.findIndex((u) => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'ไม่พบข้อมูลกรรมการ' });

    const { decision, reason } = req.body as {
      decision: 'approved' | 'rejected' | 'pending';
      reason?: string;
    };
    const actor = getActor(req);
    const prev = systemState.umpires[idx];
    const updated = {
      ...prev,
      approvalStatus: decision,
      active: decision === 'approved',
      approvalNote: reason || undefined,
      approvedBy: actor.name,
      approvedAt: nowBangkokDateTime(),
    };
    systemState.umpires[idx] = updated;
    appendAudit(
      actor.name,
      actor.role,
      decision === 'approved' ? 'APPROVE_UMPIRE' : 'REJECT_UMPIRE',
      `${updated.firstName} ${updated.lastName} (${updated.code})`,
      reason,
      updated.tournamentId
    );
    broadcastEvent('state_sync', systemState);
    res.json({ umpire: updated });
  });

  app.post('/api/umpires/:id/regenerate-code', requirePermission('editSettings'), (req, res) => {
    const u = systemState.umpires.find((item) => item.id === req.params.id);
    if (!u) return res.status(404).json({ error: 'ไม่พบกรรมการ' });
    const newCode = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');
    u.loginCode12 = newCode;
    u.active = true;
    const actor = getActor(req);
    appendAudit(actor.name, actor.role, 'REGENERATE_UMPIRE_CODE', `${u.firstName} ${u.lastName}`, undefined, u.tournamentId);
    broadcastEvent('state_sync', systemState);
    res.json(u);
  });

  app.patch('/api/umpires/:id', requirePermission('editSettings'), (req, res) => {
    const idx = systemState.umpires.findIndex((u) => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'ไม่พบกรรมการ' });
    systemState.umpires[idx] = { ...systemState.umpires[idx], ...req.body };
    const actor = getActor(req);
    appendAudit(actor.name, actor.role, 'UPDATE_UMPIRE', systemState.umpires[idx].code);
    broadcastEvent('state_sync', systemState);
    res.json(systemState.umpires[idx]);
  });

  // Draw Publish & Lock
  app.post('/api/draw/publish', requirePermission('drawBracket'), (req, res) => {
    const {
      tournamentId,
      divisionId,
      format,
      matches,
      groupAssignments,
      lockAfterPublish,
      summary,
      stageType = 'group',
    } = req.body as {
      tournamentId: string;
      divisionId: string;
      format: MatchRecord['format'];
      matches?: MatchRecord[];
      groupAssignments?: { playerId: string; groupName: string; seed?: number }[];
      lockAfterPublish?: boolean;
      summary?: string;
      stageType?: 'group' | 'knockout' | 'all';
    };

    // Update group assignments on players
    if (Array.isArray(groupAssignments)) {
      for (const ga of groupAssignments) {
        const p = systemState.players.find((pl) => pl.id === ga.playerId);
        if (p) {
          p.groupName = ga.groupName;
          p.seed = ga.seed;
        }
      }
    }

    // Replace matches for this division/format scoped by stageType ('group' | 'knockout' | 'all')
    if (Array.isArray(matches) && matches.length > 0) {
      const otherMatches = systemState.matches.filter((m) => {
        const sameScope = m.tournamentId === tournamentId && m.divisionId === divisionId && m.format === format;
        if (!sameScope) return true;
        if (stageType === 'all') return false;
        if (stageType === 'knockout') return m.stage === 'group';
        return m.stage !== 'group';
      });
      systemState.matches = [...otherMatches, ...matches];
    }

    const t = systemState.tournaments.find((tr) => tr.id === tournamentId);
    const nextVer = (t?.bracketVersion || 1) + 1;
    if (t) {
      t.bracketVersion = nextVer;
      if (lockAfterPublish) t.bracketLocked = true;
    }

    const actor = getActor(req);
    systemState.drawRevisions = [
      {
        version: nextVer,
        createdAt: nowBangkokDateTime(),
        createdBy: actor.name,
        divisionId,
        format,
        summary: summary || 'เผยแพร่สายการแข่งขันรอบใหม่',
        locked: Boolean(lockAfterPublish),
      },
      ...systemState.drawRevisions,
    ];

    appendAudit(actor.name, actor.role, 'PUBLISH_DRAW', `${divisionId} v${nextVer}`, summary, tournamentId);
    broadcastEvent('state_sync', systemState);
    res.json({ version: nextVer, locked: Boolean(lockAfterPublish) });
  });

  // Match scoring & live operations (Server-authoritative & idempotent)
  app.post('/api/matches/:id/event', requirePermission('scoreMatch'), (req, res) => {
    const match = systemState.matches.find((m) => m.id === req.params.id);
    if (!match) return res.status(404).json({ error: 'ไม่พบคู่แข่งขัน' });

    if (match.locked) {
      return res.status(423).json({
        error: 'ผลการแข่งขันนี้ถูกล็อกแล้ว หากต้องการแก้ไขต้องใช้สิทธิ์ Admin พร้อมระบุเหตุผล',
      });
    }

    const { eventId, type, payload } = req.body as {
      eventId: string;
      type: string;
      payload?: Record<string, unknown>;
    };

    if (eventId && processedEventIds.has(eventId)) {
      return res.json({ match, deduplicated: true });
    }
    if (eventId) processedEventIds.add(eventId);

    const actor = getActor(req);
    const timeStr = nowBangkokTime();

    if (match.sets.length === 0) {
      match.sets = [{ setNumber: 1, scoreA: 0, scoreB: 0 }];
      match.currentSet = 1;
    }
    const activeSet = match.sets[match.currentSet - 1] || match.sets[match.sets.length - 1];

    const recordTimeline = (
      evType: MatchRecord['timeline'][number]['type'],
      detail?: string,
      undoSnapshot?: MatchRecord['timeline'][number]['undoSnapshot']
    ) => {
      match.timeline = [
        {
          id: eventId || `ev-${Date.now()}`,
          timestamp: timeStr,
          setNumber: match.currentSet,
          type: evType,
          scoreSnapshot: `${activeSet.scoreA} - ${activeSet.scoreB}`,
          actor: actor.name,
          detail,
          undoSnapshot,
        },
        ...match.timeline,
      ];
    };

    switch (type) {
      case 'start_match':
        match.status = 'live';
        match.actualStart = match.actualStart || timeStr.slice(0, 5);
        break;
      case 'point_A': {
        const snap = createSnapshotForUndo(match);
        const info = applyBadmintonPoint(match, 'A');
        recordTimeline(
          'point_A',
          `${match.teamAName} ได้แต้ม · เสิร์ฟถัดไป: ${info.serverName || match.teamAName}`,
          snap
        );
        break;
      }
      case 'point_B': {
        const snap = createSnapshotForUndo(match);
        const info = applyBadmintonPoint(match, 'B');
        recordTimeline(
          'point_B',
          `${match.teamBName} ได้แต้ม · เสิร์ฟถัดไป: ${info.serverName || match.teamBName}`,
          snap
        );
        break;
      }
      case 'undo': {
        const lastReversible = match.timeline.find(
          (ev) =>
            ev.setNumber === match.currentSet &&
            (ev.type === 'point_A' || ev.type === 'point_B' || ev.type === 'serve_change')
        );
        if (lastReversible) {
          if (lastReversible.undoSnapshot) {
            const snap = lastReversible.undoSnapshot;
            activeSet.scoreA = snap.scoreA;
            activeSet.scoreB = snap.scoreB;
            match.status = snap.status === 'scheduled' ? 'live' : snap.status;
            match.servingTeam = snap.servingTeam;
            match.servingPlayerIndex = snap.servingPlayerIndex;
            match.courtPositions = snap.courtPositions;
            match.manualServerSwaps = snap.manualServerSwaps;
          } else {
            if (lastReversible.type === 'point_A' && activeSet.scoreA > 0) activeSet.scoreA -= 1;
            if (lastReversible.type === 'point_B' && activeSet.scoreB > 0) activeSet.scoreB -= 1;
          }
          match.timeline = match.timeline.filter((ev) => ev.id !== lastReversible.id);
          recordTimeline('undo', `ย้อนรายการล่าสุด (${lastReversible.scoreSnapshot})`);
        }
        break;
      }
      case 'change_ends':
        match.endsSwapped = !match.endsSwapped;
        recordTimeline('change_ends', 'สลับแดนสนาม');
        break;
      case 'toggle_server': {
        const snap = createSnapshotForUndo(match);
        applyManualTeamServeToggle(match);
        recordTimeline('serve_change', `เปลี่ยนทีมเสิร์ฟเป็นทีม ${match.servingTeam}`, snap);
        break;
      }
      case 'toggle_server_player': {
        const targetTeam = (payload?.team as 'A' | 'B' | undefined) || match.servingTeam;
        const snap = createSnapshotForUndo(match);
        const result = applyManualServerPlayerSwap(match, targetTeam);
        if (!result.ok) {
          if (eventId) processedEventIds.delete(eventId);
          return res.status(409).json({ error: result.error });
        }
        recordTimeline(
          'serve_change',
          `สลับคนเสิร์ฟทีม ${result.swappedTeam} (ใช้สิทธิ์ 1/1 เซต ${match.currentSet}): ${result.serverName}`,
          snap
        );
        break;
      }
      case 'interval':
        match.status = 'interval';
        recordTimeline('interval', 'พักครึ่งเซต (Interval)');
        break;
      case 'timeout_A':
        match.timeoutsUsed.A += 1;
        recordTimeline('timeout_A', `${match.teamAName} ขอเวลานอก`);
        break;
      case 'timeout_B':
        match.timeoutsUsed.B += 1;
        recordTimeline('timeout_B', `${match.teamBName} ขอเวลานอก`);
        break;
      case 'medical_timeout':
        recordTimeline('medical_timeout', String(payload?.detail || 'ปฐมพยาบาลในสนาม'));
        break;
      case 'card': {
        const cardType = (payload?.cardType as 'yellow' | 'red' | 'black') || 'yellow';
        const team = (payload?.team as 'A' | 'B') || 'A';
        const reason = String(payload?.reason || 'ทำผิดกติกา');
        match.cards.push({ team, type: cardType, reason, time: timeStr.slice(0, 5) });
        if (cardType === 'red') {
          applyBadmintonPoint(match, team === 'A' ? 'B' : 'A');
        }
        recordTimeline(
          `card_${cardType}` as MatchRecord['timeline'][number]['type'],
          `ใบ${cardType} ทีม ${team}: ${reason}`
        );
        break;
      }
      case 'suspend':
        match.status = 'suspended';
        recordTimeline('suspend', String(payload?.reason || 'พักการแข่งขันชั่วคราว'));
        break;
      case 'resume':
        match.status = 'live';
        recordTimeline('resume', 'กลับมาแข่งขันต่อ');
        break;
      case 'end_set': {
        if (activeSet.scoreA !== activeSet.scoreB) {
          activeSet.winner = activeSet.scoreA > activeSet.scoreB ? 'A' : 'B';
        }
        const tourney = systemState.tournaments.find((t) => t.id === match.tournamentId);
        const bestOfSets = tourney?.scoringRules.bestOfSets || 3;
        const winsA = match.sets.filter((s) => s.winner === 'A').length;
        const winsB = match.sets.filter((s) => s.winner === 'B').length;
        recordTimeline(
          'end_set',
          `ยืนยันจบเซต ${match.currentSet} (${activeSet.scoreA}-${activeSet.scoreB})`
        );
        const shouldAdvanceSet =
          bestOfSets === 2
            ? match.sets.length < 2
            : bestOfSets === 3
            ? winsA < 2 && winsB < 2 && match.sets.length < 3
            : false;
        if (shouldAdvanceSet) {
          match.currentSet += 1;
          match.sets.push({ setNumber: match.currentSet, scoreA: 0, scoreB: 0 });
          match.endsSwapped = !match.endsSwapped;
          if (activeSet.winner) {
            match.servingTeam = activeSet.winner;
          }
          match.servingPlayerIndex = 0;
          match.courtPositions = { A: [0, 1], B: [0, 1] };
          const swaps = getManualSwapsMap(match);
          swaps[String(match.currentSet)] = { A: false, B: false };
          match.manualServerSwaps = swaps;
          match.status = 'live';
        }
        break;
      }
      case 'end_match': {
        if (activeSet && activeSet.scoreA !== activeSet.scoreB && !activeSet.winner) {
          activeSet.winner = activeSet.scoreA > activeSet.scoreB ? 'A' : 'B';
        }
        const winsA = match.sets.filter((s) => s.winner === 'A').length;
        const winsB = match.sets.filter((s) => s.winner === 'B').length;
        const totalPtsA = match.sets.reduce((sum, s) => sum + s.scoreA, 0);
        const totalPtsB = match.sets.reduce((sum, s) => sum + s.scoreB, 0);
        const specialStatus = payload?.status as MatchRecord['status'] | undefined;
        const explicitWinner = payload?.winner as 'A' | 'B' | undefined;

        match.winner =
          explicitWinner ||
          (winsA !== winsB ? (winsA > winsB ? 'A' : 'B') : totalPtsA >= totalPtsB ? 'A' : 'B');
        match.status = specialStatus || 'finished';
        match.actualEnd = timeStr.slice(0, 5);
        match.umpireNote = String(payload?.note || match.umpireNote || '');
        if (payload?.lock) {
          match.locked = true;
          match.umpireConfirmedAt = nowBangkokDateTime();
        }
        recordTimeline('end_match', `จบการแข่งขัน (${match.status}) ผู้ชนะทีม ${match.winner}`);

        // Auto-advance winner in Knockout bracket
        if (match.nextMatchId && match.nextMatchSlot) {
          const nextMatch = systemState.matches.find((nm) => nm.id === match.nextMatchId);
          if (nextMatch) {
            const winName = match.winner === 'A' ? match.teamAName : match.teamBName;
            const winClub = match.winner === 'A' ? match.teamAClub : match.teamBClub;
            const winId = match.winner === 'A' ? match.teamAId : match.teamBId;
            const winPlayers = match.winner === 'A' ? match.teamAPlayers : match.teamBPlayers;
            if (match.nextMatchSlot === 'A') {
              nextMatch.teamAId = winId;
              nextMatch.teamAName = winName;
              nextMatch.teamAClub = winClub;
              nextMatch.teamAPlayers = winPlayers;
            } else {
              nextMatch.teamBId = winId;
              nextMatch.teamBName = winName;
              nextMatch.teamBClub = winClub;
              nextMatch.teamBPlayers = winPlayers;
            }
          }
        }
        appendAudit(
          actor.name,
          actor.role,
          'CONFIRM_MATCH_RESULT',
          `${match.matchCode} (${match.teamAName} vs ${match.teamBName})`,
          match.umpireNote,
          match.tournamentId
        );
        break;
      }
      default:
        break;
    }

    broadcastEvent('match_update', match);
    broadcastEvent('state_sync', systemState);
    res.json({ match });
  });

  // Admin Override Locked Match Result
  app.post('/api/matches/:id/override', requirePermission('overrideLockedResult'), (req, res) => {
    const match = systemState.matches.find((m) => m.id === req.params.id);
    if (!match) return res.status(404).json({ error: 'ไม่พบคู่แข่งขัน' });

    const { sets, winner, status, reason } = req.body;
    if (!reason || String(reason).trim().length < 3) {
      return res.status(400).json({ error: 'กรุณาระบุเหตุผลในการแก้ไขผลการแข่งขัน' });
    }

    match.sets = sets;
    match.winner = winner;
    match.status = status || 'finished';
    if (match.nextMatchId && match.nextMatchSlot && (match.winner === 'A' || match.winner === 'B')) {
      const nextMatch = systemState.matches.find((nm) => nm.id === match.nextMatchId);
      if (nextMatch) {
        const winName = match.winner === 'A' ? match.teamAName : match.teamBName;
        const winClub = match.winner === 'A' ? match.teamAClub : match.teamBClub;
        const winId = match.winner === 'A' ? match.teamAId : match.teamBId;
        const winPlayers = match.winner === 'A' ? match.teamAPlayers : match.teamBPlayers;
        if (match.nextMatchSlot === 'A') {
          nextMatch.teamAId = winId;
          nextMatch.teamAName = winName;
          nextMatch.teamAClub = winClub;
          nextMatch.teamAPlayers = winPlayers;
        } else {
          nextMatch.teamBId = winId;
          nextMatch.teamBName = winName;
          nextMatch.teamBClub = winClub;
          nextMatch.teamBPlayers = winPlayers;
        }
      }
    }
    const actor = getActor(req);
    match.timeline = [
      {
        id: `ov-${Date.now()}`,
        timestamp: nowBangkokTime(),
        setNumber: match.currentSet,
        type: 'admin_override',
        scoreSnapshot: sets.map((s: { scoreA: number; scoreB: number }) => `${s.scoreA}-${s.scoreB}`).join(', '),
        actor: actor.name,
        detail: `แก้ไขผลโดย Admin: ${reason}`,
      },
      ...match.timeline,
    ];

    appendAudit(actor.name, actor.role, 'OVERRIDE_MATCH_RESULT', match.matchCode, reason, match.tournamentId);
    broadcastEvent('match_update', match);
    broadcastEvent('state_sync', systemState);
    res.json({ match });
  });

  // Quick Score / Progress Match (for unlocked matches by score_staff / admin / owner)
  app.post('/api/matches/:id/quick-score', requirePermission('scoreMatch'), (req, res) => {
    const match = systemState.matches.find((m) => m.id === req.params.id);
    if (!match) return res.status(404).json({ error: 'ไม่พบคู่แข่งขัน' });
    if (match.locked) {
      return res.status(423).json({
        error: 'ผลการแข่งขันนี้ถูกล็อกแล้ว กรุณาใช้สิทธิ์ Admin พร้อมระบุเหตุผลในการแก้ไข',
      });
    }

    const { sets, winner, status, courtId, umpireId } = req.body as {
      sets: MatchRecord['sets'];
      winner?: 'A' | 'B';
      status?: MatchRecord['status'];
      courtId?: string;
      umpireId?: string;
    };

    const actor = getActor(req);
    if (umpireId !== undefined) {
      if (!umpireId) {
        match.umpireId = undefined;
        match.umpireName = undefined;
      } else {
        const ump = systemState.umpires.find((u) => u.id === umpireId);
        if (ump && ump.clubAffiliation && (ump.clubAffiliation === match.teamAClub || ump.clubAffiliation === match.teamBClub)) {
          return res.status(409).json({
            error: `ไม่สามารถมอบหมาย ${ump.firstName} ได้ เนื่องจากสังกัดสโมสรเดียวกับทีมที่แข่งขัน (${ump.clubAffiliation})`,
          });
        }
        if (ump) {
          match.umpireId = ump.id;
          match.umpireName = `${ump.firstName} ${ump.lastName}`;
        }
      }
    }

    if (courtId !== undefined) match.courtId = courtId || undefined;
    if (Array.isArray(sets) && sets.length > 0) {
      match.sets = sets;
      match.currentSet = sets.length;
    }

    const nextStatus = status || 'finished';
    match.status = nextStatus;
    if (nextStatus === 'live' && !match.actualStart) {
      match.actualStart = nowBangkokTime().slice(0, 5);
    }
    if (nextStatus === 'finished' || nextStatus === 'walkover') {
      match.winner = winner || 'A';
      match.actualEnd = nowBangkokTime().slice(0, 5);

      if (match.nextMatchId && match.nextMatchSlot) {
        const nextMatch = systemState.matches.find((nm) => nm.id === match.nextMatchId);
        if (nextMatch) {
          const winName = match.winner === 'A' ? match.teamAName : match.teamBName;
          const winClub = match.winner === 'A' ? match.teamAClub : match.teamBClub;
          const winId = match.winner === 'A' ? match.teamAId : match.teamBId;
          const winPlayers = match.winner === 'A' ? match.teamAPlayers : match.teamBPlayers;
          if (match.nextMatchSlot === 'A') {
            nextMatch.teamAId = winId;
            nextMatch.teamAName = winName;
            nextMatch.teamAClub = winClub;
            nextMatch.teamAPlayers = winPlayers;
          } else {
            nextMatch.teamBId = winId;
            nextMatch.teamBName = winName;
            nextMatch.teamBClub = winClub;
            nextMatch.teamBPlayers = winPlayers;
          }
        }
      }
    }

    match.timeline = [
      {
        id: `qs-${Date.now()}`,
        timestamp: nowBangkokTime(),
        setNumber: match.currentSet,
        type: nextStatus === 'finished' ? 'end_match' : 'resume',
        scoreSnapshot: match.sets.map((s) => `${s.scoreA}-${s.scoreB}`).join(', '),
        actor: actor.name,
        detail: nextStatus === 'finished' ? `บันทึกผลชนะโดยทีม ${match.winner}` : `อัปเดตสถานะเป็น ${nextStatus}`,
      },
      ...match.timeline,
    ];

    appendAudit(
      actor.name,
      actor.role,
      nextStatus === 'finished' ? 'RECORD_MATCH_RESULT' : 'UPDATE_MATCH_SCORE',
      `${match.matchCode} (${match.teamAName} vs ${match.teamBName})`,
      match.sets.map((s) => `${s.scoreA}-${s.scoreB}`).join(', '),
      match.tournamentId
    );
    broadcastEvent('match_update', match);
    broadcastEvent('state_sync', systemState);
    res.json({ match });
  });

  // Update match metadata (court, schedule, umpire assignment, call athlete)
  app.patch('/api/matches/:id', (req, res) => {
    const match = systemState.matches.find((m) => m.id === req.params.id);
    if (!match) return res.status(404).json({ error: 'ไม่พบคู่แข่งขัน' });

    const { role, name } = getActor(req);
    if (req.body.umpireId !== undefined && !systemState.rolePermissions[role]?.assignUmpire) {
      return res.status(403).json({ error: 'คุณไม่มีสิทธิ์มอบหมายกรรมการ' });
    }

    // Check umpire own-team conflict on server
    if (req.body.umpireId !== undefined) {
      if (!req.body.umpireId) {
        match.umpireId = undefined;
        match.umpireName = undefined;
      } else {
        const ump = systemState.umpires.find((u) => u.id === req.body.umpireId);
        if (ump && ump.clubAffiliation && (ump.clubAffiliation === match.teamAClub || ump.clubAffiliation === match.teamBClub)) {
          return res.status(409).json({
            error: `ไม่สามารถมอบหมาย ${ump.firstName} ได้ เนื่องจากสังกัดสโมสรเดียวกับทีมที่แข่งขัน (${ump.clubAffiliation})`,
          });
        }
        if (ump) {
          match.umpireId = ump.id;
          match.umpireName = `${ump.firstName} ${ump.lastName}`;
        }
      }
    }

    if (req.body.courtId !== undefined) match.courtId = req.body.courtId || undefined;
    if (req.body.scheduledTime !== undefined) match.scheduledTime = req.body.scheduledTime;
    if (req.body.estimatedStart !== undefined) match.estimatedStart = req.body.estimatedStart;
    if (req.body.status !== undefined) match.status = req.body.status;
    if (req.body.callAthlete) {
      match.status = 'calling';
      match.callCount += 1;
      appendAudit(name, role, 'CALL_ATHLETE', `${match.matchCode} (${match.teamAName} vs ${match.teamBName})`, undefined, match.tournamentId);
    }

    broadcastEvent('match_update', match);
    broadcastEvent('state_sync', systemState);
    res.json({ match });
  });

  // Sub-accounts (Max 5 enforced on server!)
  app.post('/api/sub-accounts', requirePermission('manageSubAccounts'), (req, res) => {
    if (systemState.subAccounts.length >= 5) {
      return res.status(400).json({ error: 'สร้างบัญชีผู้ใช้งานรองได้สูงสุด 5 บัญชีเท่านั้น' });
    }
    const created = {
      ...req.body,
      id: `sub-${Date.now()}`,
      lastLogin: 'ยังไม่เคยเข้าสู่ระบบ',
    };
    systemState.subAccounts = [...systemState.subAccounts, created];
    const actor = getActor(req);
    appendAudit(actor.name, actor.role, 'CREATE_SUB_ACCOUNT', `${created.name} (${created.role})`);
    broadcastEvent('state_sync', systemState);
    res.json(created);
  });

  app.patch('/api/sub-accounts/:id', requirePermission('manageSubAccounts'), (req, res) => {
    const idx = systemState.subAccounts.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'ไม่พบบัญชีผู้ใช้' });
    systemState.subAccounts[idx] = { ...systemState.subAccounts[idx], ...req.body };
    const actor = getActor(req);
    appendAudit(actor.name, actor.role, 'UPDATE_SUB_ACCOUNT', systemState.subAccounts[idx].name);
    broadcastEvent('state_sync', systemState);
    res.json(systemState.subAccounts[idx]);
  });

  app.delete('/api/sub-accounts/:id', requirePermission('manageSubAccounts'), (req, res) => {
    const target = systemState.subAccounts.find((s) => s.id === req.params.id);
    systemState.subAccounts = systemState.subAccounts.filter((s) => s.id !== req.params.id);
    const actor = getActor(req);
    if (target) appendAudit(actor.name, actor.role, 'REVOKE_SUB_ACCOUNT', target.name);
    broadcastEvent('state_sync', systemState);
    res.json({ ok: true });
  });

  // Incidents
  app.post('/api/incidents', (req, res) => {
    const inc = {
      ...req.body,
      id: `inc-${Date.now()}`,
      timestamp: nowBangkokDateTime(),
    };
    systemState.incidents = [inc, ...systemState.incidents];
    const actor = getActor(req);
    appendAudit(actor.name, actor.role, 'LOG_INCIDENT', inc.description, undefined, inc.tournamentId);
    broadcastEvent('state_sync', systemState);
    res.json(inc);
  });

  // Backup / Restore
  app.post('/api/backup/restore', requirePermission('manageSubAccounts'), (req, res) => {
    const { action, snapshot } = req.body;
    if (action === 'reset_demo') {
      systemState = createInitialSystemState();
    } else if (snapshot && snapshot.tournaments) {
      systemState = snapshot;
    }
    broadcastEvent('state_sync', systemState);
    res.json(systemState);
  });

  const httpServer = http.createServer(app);

  // Vite / Static serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`LiveMatch Tournament server running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
