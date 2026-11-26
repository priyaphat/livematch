export type Language = 'th' | 'en';
export type ThemeMode = 'light' | 'dark';

export type UserRole =
  | 'owner'
  | 'tournament_admin'
  | 'registration_staff'
  | 'score_staff'
  | 'director';

export type PermissionKey =
  | 'createTournament'
  | 'editSettings'
  | 'drawBracket'
  | 'lockBracket'
  | 'approveRegistration'
  | 'checkIn'
  | 'verifyPayment'
  | 'assignUmpire'
  | 'scoreMatch'
  | 'overrideLockedResult'
  | 'viewHealthData'
  | 'manageSubAccounts'
  | 'exportReport';

export type RolePermissions = Record<UserRole, Record<PermissionKey, boolean>>;

export interface SubAccount {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Exclude<UserRole, 'owner' | 'director'>;
  active: boolean;
  lastLogin: string;
  permissions: Record<PermissionKey, boolean>;
}

export type TournamentStatus =
  | 'Draft'
  | 'เปิดรับสมัคร'
  | 'ปิดรับสมัคร'
  | 'เตรียมจัดสาย'
  | 'กำลังแข่งขัน'
  | 'พักการแข่งขัน'
  | 'แข่งขันเสร็จแล้ว'
  | 'ยกเลิก'
  | 'Archived';

export type MatchFormatType = 'doubles' | 'singles';
export type GenderScope = 'male' | 'female' | 'mixed' | 'open';
export type DrawSystemType =
  | 'group_then_knockout'
  | 'single_elimination'
  | 'double_elimination'
  | 'round_robin';

export type TieBreakCriterion =
  | 'matches_won'
  | 'head_to_head'
  | 'set_diff'
  | 'point_diff'
  | 'points_for'
  | 'coin_toss';

export interface DivisionConfig {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  color: string;
  enabled: boolean;
  gender: GenderScope;
  formats: MatchFormatType[];
  playersPerTeam: number;
  quotaDoubles: number | 'unlimited';
  quotaSingles: number | 'unlimited';
  minTeamsToOpen: number;
  minAge?: number;
  maxAge?: number;
  maxEventsPerPlayer: number;
  preventDuplicatePartner: boolean;
  entryFeeDoubles: number;
  entryFeeSingles: number;
  earlyBirdFeeDoubles?: number;
  earlyBirdFeeSingles?: number;
}

export interface ScoringRules {
  bestOfSets: 1 | 2 | 3;
  pointsPerSet: 15 | 21;
  settingEnabled: boolean;
  winByTwo: boolean;
  maxCapPoint: number;
  changeEndsInDecidingSetAt: number;
  intervalAt: number;
  timeoutPerMatch: number;
  goldenPoint: boolean;
}

export interface CourtConfig {
  id: string;
  name: string;
  openTime: string;
  closeTime: string;
  avgMatchMinutes: number;
  bufferMinutes: number;
  minRestMinutes: number;
  status: 'available' | 'in_use' | 'break' | 'maintenance';
  blackoutNote?: string;
}

export interface PaymentConfig {
  feeEnabled: boolean;
  useLiveMatchPos: boolean;
  posAccountConnected: boolean;
  promptPayId: string;
  bankName: string;
  bankAccountNo: string;
  bankAccountName: string;
  dueDate: string;
  requireSlipUpload: boolean;
  autoVerifySlip: boolean;
  allowPartialPayment: boolean;
  allowRefund: boolean;
}

export interface NotificationConfig {
  onRegisterSuccess: boolean;
  onPaymentVerified: boolean;
  onCheckIn: boolean;
  onBeforeMatch: boolean;
  onCourtChanged: boolean;
  onMatchResult: boolean;
  channels: {
    line: boolean;
    telegram: boolean;
    email: boolean;
  };
}

export interface PublicViewConfig {
  enabled: boolean;
  showResults: boolean;
  showLiveScore: boolean;
  nextMatchesCount: number;
  showUmpireName: boolean;
  showSponsors: boolean;
  autoRefreshSec: number;
  hidePersonalData: boolean;
}

export interface RegistrationConfig {
  isOpen: boolean;
  openAt: string;
  closeAt: string;
  enableWaitingList: boolean;
  autoApprove: boolean;
  checkInMinutesBefore: number;
  allowEditUntil: string;
  allowPartnerChange: boolean;
  pdpaConsentText: string;
  refundPolicyText: string;
}

export interface Tournament {
  id: string;
  publicToken?: string;
  name: string;
  description: string;
  organizer: string;
  contact: string;
  venue: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  timezone: string;
  year: number;
  status: TournamentStatus;
  bannerUrl: string;
  emblemUrl: string;
  sponsors: string[];
  rulesText: string;
  divisions: DivisionConfig[];
  drawSystem: DrawSystemType;
  teamsPerGroup: number;
  qualifiersPerGroup: number;
  separateSameClub: boolean;
  separateSeeds: boolean;
  bracketLocked: boolean;
  bracketVersion: number;
  tieBreakOrder: TieBreakCriterion[];
  scoringRules: ScoringRules;
  registrationConfig: RegistrationConfig;
  paymentConfig: PaymentConfig;
  courts: CourtConfig[];
  publicViewConfig: PublicViewConfig;
  notificationConfig: NotificationConfig;
  maxParticipants: number;
  emergencyPaused: boolean;
  emergencyReason?: string;
}

export type PaymentStatus = 'paid' | 'pending_verify' | 'unpaid' | 'partial' | 'refunded';
export type VerifyStatus = 'approved' | 'pending' | 'rejected';

export interface TournamentEntryMember {
  role: 'primary' | 'partner';
  firstName: string;
  lastName: string;
  nickname?: string;
  gender: 'M' | 'F';
  birthDate: string;
  nationality: string;
  idDocumentNo?: string;
  address: string;
  phone: string;
  email?: string;
  club?: string;
  province?: string;
  shirtSize?: 'XS' | 'S' | 'M' | 'L' | 'XL' | '2XL';
  photoUrl?: string;
  emergencyContact: string;
  healthInfo?: string;
  healthConsent: boolean;
  pdpaConsent: boolean;
}

export interface PlayerRecord {
  id: string;
  registrationCode: string;
  tournamentId: string;
  teamName: string;
  firstName: string;
  lastName: string;
  nickname: string;
  gender: 'M' | 'F';
  birthDate: string;
  age: number;
  nationality?: string;
  idDocumentNo?: string;
  address?: string;
  phone: string;
  email: string;
  club: string;
  province: string;
  divisionId: string;
  format: MatchFormatType;
  photoUrl?: string;
  partnerName?: string;
  partnerFirstName?: string;
  partnerLastName?: string;
  partnerNickname?: string;
  partnerPhone?: string;
  partnerEmail?: string;
  partnerClub?: string;
  partnerProvince?: string;
  partnerPhotoUrl?: string;
  partnerId?: string;
  members?: TournamentEntryMember[];
  shirtSize?: 'XS' | 'S' | 'M' | 'L' | 'XL' | '2XL';
  emergencyContact: string;
  healthInfo?: string;
  healthConsent: boolean;
  pdpaConsent: boolean;
  documentStatus: VerifyStatus;
  paymentStatus: PaymentStatus;
  slipStatus: VerifyStatus | 'not_uploaded';
  paymentChannel?: 'PromptPay' | 'โอนธนาคาร' | 'เงินสด' | 'LiveMatch POS';
  amountPaid: number;
  amountDue: number;
  checkedIn: boolean;
  checkInTime?: string;
  waitingList: boolean;
  waitingPosition?: number;
  withdrawn: boolean;
  noShow: boolean;
  seed?: number;
  groupName?: string;
  notes?: string;
  registeredAt: string;
  teamLogoUrl?: string;
  skillVideoUrl?: string;
  verificationCode?: string;
  verificationCodeLast4?: string;
  registrationSource?: 'online' | 'staff';
  possibleDuplicateOf?: string;
  approvalNote?: string;
  approvedBy?: string;
  approvedAt?: string;
  slipImageUrl?: string;
  slipUploadedAt?: string;
  slipTransferRef?: string;
  slipTransferBank?: string;
  slipTransferAmount?: number;
  paymentVerifiedBy?: string;
  paymentVerifiedAt?: string;
  paymentRejectReason?: string;
}

export interface DirectorUmpire {
  id: string;
  code: string;
  tournamentId: string;
  firstName: string;
  lastName: string;
  nickname: string;
  phone: string;
  email: string;
  certification: string;
  capableDivisions: string[];
  loginCode12?: string;
  loginCodeLast4?: string;
  codeExpiresAt: string;
  active: boolean;
  assignedMatches: number;
  completedMatches: number;
  hoursWorked: number;
  clubAffiliation?: string;
  photoUrl?: string;
  approvalStatus?: VerifyStatus;
  applicationSource?: 'online' | 'staff';
  appliedAt?: string;
  experienceNote?: string;
  address?: string;
  emergencyContact?: string;
  lineId?: string;
  pdpaConsent?: boolean;
  documentFileId?: string;
  documentName?: string;
  approvalNote?: string;
  approvedBy?: string;
  approvedAt?: string;
  history: { matchId: string; matchCode: string; date: string; note: string }[];
}

export type MatchStage = 'group' | 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F' | 'P3' | `LB${number}` | 'GF' | 'GF_RESET';
export type MatchStatus =
  | 'scheduled'
  | 'calling'
  | 'live'
  | 'interval'
  | 'suspended'
  | 'awaiting_confirmation'
  | 'finished'
  | 'walkover'
  | 'retired'
  | 'disqualified'
  | 'not_required';

export interface SetScore {
  setNumber: number;
  scoreA: number;
  scoreB: number;
  winner?: 'A' | 'B';
}

export interface MatchTimelineEvent {
  id: string;
  timestamp: string;
  setNumber: number;
  type:
    | 'start_match'
    | 'point_A'
    | 'point_B'
    | 'undo'
    | 'serve_change'
    | 'change_ends'
    | 'interval'
    | 'timeout_A'
    | 'timeout_B'
    | 'medical_timeout'
    | 'card'
    | 'card_yellow'
    | 'card_red'
    | 'card_black'
    | 'suspend'
    | 'resume'
    | 'shuttle_add'
    | 'shuttle_remove'
    | 'end_set'
    | 'end_match'
    | 'admin_override';
  scoreSnapshot: string;
  actor: string;
  detail?: string;
  undoSnapshot?: {
    status: MatchStatus;
    scoreA: number;
    scoreB: number;
    servingTeam: 'A' | 'B';
    servingPlayerIndex: 0 | 1;
    courtPositions: { A: [0 | 1, 0 | 1]; B: [0 | 1, 0 | 1] };
    manualServerSwaps: Record<string, { A: boolean; B: boolean }>;
  };
}

export interface MatchRecord {
  id: string;
  tournamentId: string;
  matchCode: string;
  divisionId: string;
  format: MatchFormatType;
  stage: MatchStage;
  groupName?: string;
  bracketOrder?: number;
  nextMatchId?: string;
  nextMatchSlot?: 'A' | 'B';
  nextLoserMatchId?: string;
  nextLoserMatchSlot?: 'A' | 'B';
  resetMatchId?: string;
  conditional?: boolean;
  bracketSide?: 'winners' | 'losers' | 'final';
  placementBracket?: 'championship' | 'third_place';
  placementLabel?: string;
  courtId?: string;
  scheduledTime: string;
  scheduledDate?: string;
  estimatedStart: string;
  actualStart?: string;
  actualEnd?: string;
  teamAId: string;
  teamAName: string;
  teamAClub: string;
  teamAPlayers: string[];
  teamBId: string;
  teamBName: string;
  teamBClub: string;
  teamBPlayers: string[];
  isBye?: boolean;
  umpireId?: string;
  umpireName?: string;
  status: MatchStatus;
  callCount: number;
  currentSet: number;
  sets: SetScore[];
  servingTeam: 'A' | 'B';
  servingPlayerIndex: 0 | 1;
  courtPositions?: { A: [0 | 1, 0 | 1]; B: [0 | 1, 0 | 1] };
  manualServerSwaps?: Record<string, { A: boolean; B: boolean }>;
  endsSwapped: boolean;
  winner?: 'A' | 'B' | 'draw';
  locked: boolean;
  umpireConfirmedAt?: string;
  umpireNote?: string;
  cards: { team: 'A' | 'B'; type: 'yellow' | 'red' | 'black'; reason: string; time: string }[];
  timeoutsUsed: { A: number; B: number };
  shuttlesUsed?: number;
  timeline: MatchTimelineEvent[];
  conflictWarning?: string;
  version?: number;
}

export interface GroupStandingRow {
  teamId: string;
  teamName: string;
  club: string;
  groupName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  standingPoints: number;
  setsFor: number;
  setsAgainst: number;
  pointsFor: number;
  pointsAgainst: number;
  rank: number;
  qualified: boolean;
}

export interface DrawRevision {
  version: number;
  createdAt: string;
  createdBy: string;
  divisionId: string;
  format: MatchFormatType;
  summary: string;
  locked: boolean;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorName: string;
  actorRole: UserRole;
  action: string;
  target: string;
  reason?: string;
  tournamentId?: string;
}

export interface IncidentReport {
  id: string;
  tournamentId: string;
  timestamp: string;
  type: 'medical' | 'protest' | 'delay' | 'equipment' | 'discipline';
  matchCode?: string;
  description: string;
  status: 'open' | 'resolved';
  reportedBy: string;
}

export interface SystemStatePayload {
  liveMatchFeatureEnabled: boolean;
  activeUserRole: UserRole;
  activeUserName: string;
  coinBalance: number;
  tournaments: Tournament[];
  players: PlayerRecord[];
  umpires: DirectorUmpire[];
  matches: MatchRecord[];
  drawRevisions: DrawRevision[];
  subAccounts: SubAccount[];
  rolePermissions: RolePermissions;
  auditLogs: AuditLogEntry[];
  incidents: IncidentReport[];
}
