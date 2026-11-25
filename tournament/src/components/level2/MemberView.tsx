import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  CalendarClock,
  Camera,
  CheckCircle2,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  KeyRound,
  Link2,
  Mail,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Upload,
  User,
  UserCheck,
  UserPlus,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { apiFetch } from '../../services/api';
import {
  DirectorUmpire,
  MatchFormatType,
  PlayerRecord,
  Tournament,
  TournamentEntryMember,
} from '../../types/tournament';
import {
  formatThaiDateTime,
  formatThaiDateTimeRange,
  getDivisionFormat,
  getRegistrationWindowStatus,
} from '../../utils/registration';
import { EmptyStateCard, PaginationBar, QRCodeMatrix, StatusIndicator, TeamLogoBadge } from '../common/UIPrimitives';
import {
  AthleteRegistrationFields,
  AthleteRegistrationValues,
} from '../common/AthleteRegistrationFields';

const getPlayerPaymentPresentation = (player: PlayerRecord) => {
  switch (player.paymentStatus) {
    case 'paid':
      return { tone: 'success' as const, label: `ชำระแล้ว ฿${player.amountPaid}`, canConfirm: false };
    case 'pending_verify':
      return { tone: 'warning' as const, label: 'รอตรวจสลิป', canConfirm: true };
    case 'partial':
      return { tone: 'warning' as const, label: `ชำระบางส่วน ฿${player.amountPaid}`, canConfirm: true };
    case 'refunded':
      return { tone: 'neutral' as const, label: 'คืนเงินแล้ว', canConfirm: false };
    default:
      return { tone: 'danger' as const, label: `ค้าง ฿${player.amountDue}`, canConfirm: true };
  }
};

const athleteEditValues = (member: TournamentEntryMember): AthleteRegistrationValues => ({
  firstName: member.firstName || '',
  lastName: member.lastName || '',
  nickname: member.nickname || '',
  gender: member.gender || 'M',
  birthDate: member.birthDate || '',
  nationality: member.nationality || 'ไทย',
  idDocumentNo: member.idDocumentNo || '',
  phone: member.phone || '',
  email: member.email || '',
  club: member.club || '',
  province: member.province || '',
  shirtSize: member.shirtSize || 'L',
  address: member.address || '',
  emergencyContact: member.emergencyContact || '',
  healthInfo: member.healthInfo || '',
  photoUrl: member.photoUrl || '',
  pdpaConsent: Boolean(member.pdpaConsent),
});

export const MemberView: React.FC<{ tournament: Tournament }> = ({ tournament }) => {
  const { state, refreshState, hasPermission, notify, requestConfirm } = useApp();
  const enabledDivisions = useMemo(
    () => tournament.divisions.filter((division) => division.enabled),
    [tournament.divisions]
  );
  const [memberTab, setMemberTab] = useState<'player' | 'umpire'>('player');

  // Player filters
  const [search, setSearch] = useState('');
  const [filterDiv, setFilterDiv] = useState('all');
  const [filterPay, setFilterPay] = useState('all');
  const [filterCheckIn, setFilterCheckIn] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [playerPage, setPlayerPage] = useState(1);
  const [playerPageSize, setPlayerPageSize] = useState(10);
  const [umpirePage, setUmpirePage] = useState(1);
  const [umpirePageSize, setUmpirePageSize] = useState(8);
  const [umpireSearch, setUmpireSearch] = useState('');
  const [umpireStatus, setUmpireStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [listedPlayers, setListedPlayers] = useState<PlayerRecord[]>([]);
  const [listedPlayerTotal, setListedPlayerTotal] = useState(0);
  const [listedUmpires, setListedUmpires] = useState<DirectorUmpire[]>([]);
  const [listedUmpireTotal, setListedUmpireTotal] = useState(0);
  const [revealedDirectorCodes, setRevealedDirectorCodes] = useState<Record<string, string>>({});
  const [revealedPlayerStatusCodes, setRevealedPlayerStatusCodes] = useState<Record<string, string>>({});

  // Modals
  const [showStaffReg, setShowStaffReg] = useState(false);
  const [showOnlineLinksModal, setShowOnlineLinksModal] = useState(false);
  const [showDirectorOnlineModal, setShowDirectorOnlineModal] = useState(false);
  const [editPlayer, setEditPlayer] = useState<PlayerRecord | null>(null);
  const [showUmpireModal, setShowUmpireModal] = useState(false);
  const [editingUmpire, setEditingUmpire] = useState<DirectorUmpire | null>(null);
  const [historyUmpire, setHistoryUmpire] = useState<DirectorUmpire | null>(null);
  const [qrUmpire, setQrUmpire] = useState<DirectorUmpire | null>(null);

  // Registration form state (Staff registration)
  const [regForm, setRegForm] = useState({
    teamName: '',
    teamLogoUrl: '',
    firstName: '',
    lastName: '',
    nickname: '',
    gender: 'M' as 'M' | 'F',
    phone: '',
    email: '',
    club: '',
    province: 'แพร่',
    divisionId: enabledDivisions[0]?.id || '',
    format: getDivisionFormat(enabledDivisions[0]) as MatchFormatType,
    photoUrl: '',
    partnerName: '',
    partnerFirstName: '',
    partnerLastName: '',
    partnerNickname: '',
    partnerGender: 'M' as 'M' | 'F',
    partnerBirthDate: '',
    partnerNationality: 'ไทย',
    partnerIdDocumentNo: '',
    partnerPhone: '',
    partnerEmail: '',
    partnerClub: '',
    partnerProvince: 'แพร่',
    partnerShirtSize: 'L' as PlayerRecord['shirtSize'],
    partnerAddress: '',
    partnerEmergencyContact: '',
    partnerHealthInfo: '',
    partnerHealthConsent: false,
    partnerPdpaConsent: false,
    partnerPhotoUrl: '',
    skillVideoUrl: '',
    shirtSize: 'L' as PlayerRecord['shirtSize'],
    birthDate: '',
    nationality: 'ไทย',
    idDocumentNo: '',
    address: '',
    emergencyContact: '',
    healthInfo: '',
    healthConsent: false,
    pdpaConsent: false,
  });

  const createInitialUmpForm = () => ({
    firstName: '',
    lastName: '',
    nickname: '',
    phone: '',
    email: '',
    photoUrl: '',
    certification: 'กรรมการสมาคมฯ ระดับ 1',
    clubAffiliation: 'อิสระ (ไม่มีสังกัด)',
    experienceNote: '',
    address: '',
    emergencyContact: '',
    lineId: '',
    pdpaConsent: false,
  });

  // New Umpire form (Staff registration)
  const [umpForm, setUmpForm] = useState(createInitialUmpForm);

  const tPlayers = useMemo(
    () => state.players.filter((p) => p.tournamentId === tournament.id),
    [state.players, tournament.id]
  );

  const tUmpires = useMemo(
    () => state.umpires.filter((u) => u.tournamentId === tournament.id),
    [state.umpires, tournament.id]
  );

  useEffect(() => {
    setPlayerPage(1);
  }, [tournament.id, search, filterDiv, filterPay, filterCheckIn]);

  useEffect(() => {
    if (filterDiv !== 'all' && !enabledDivisions.some((division) => division.id === filterDiv)) {
      setFilterDiv('all');
    }
  }, [enabledDivisions, filterDiv]);

  useEffect(() => {
    setUmpirePage(1);
  }, [tournament.id, umpireSearch, umpireStatus]);

  useEffect(() => {
    const params = new URLSearchParams({
      kind: 'players', tournamentId: tournament.id, page: String(playerPage), pageSize: String(playerPageSize),
      search, division: filterDiv, payment: filterPay, checkIn: filterCheckIn,
    });
    void apiFetch<{ items: PlayerRecord[]; pagination: { total: number } }>(`/api/registrations?${params}`)
      .then((result) => { setListedPlayers(result.items); setListedPlayerTotal(result.pagination.total); })
      .catch((error) => notify('error', error instanceof Error ? error.message : 'โหลดรายชื่อนักกีฬาไม่สำเร็จ'));
  }, [tournament.id, playerPage, playerPageSize, search, filterDiv, filterPay, filterCheckIn, state.players, notify]);

  useEffect(() => {
    const params = new URLSearchParams({
      kind: 'directors', tournamentId: tournament.id, page: String(umpirePage), pageSize: String(umpirePageSize),
      search: umpireSearch, status: umpireStatus,
    });
    void apiFetch<{ items: DirectorUmpire[]; pagination: { total: number } }>(`/api/registrations?${params}`)
      .then((result) => { setListedUmpires(result.items); setListedUmpireTotal(result.pagination.total); })
      .catch((error) => notify('error', error instanceof Error ? error.message : 'โหลดรายชื่อกรรมการไม่สำเร็จ'));
  }, [tournament.id, umpirePage, umpirePageSize, umpireSearch, umpireStatus, state.umpires, notify]);

  const paginatedPlayers = listedPlayers;
  const paginatedUmpires = listedUmpires;

  const handleBulkAction = async (action: 'approve' | 'checkin') => {
    if (selectedIds.length === 0) return;
    try {
      await apiFetch('/api/players/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids: selectedIds, action }),
      });
      await refreshState();
      setSelectedIds([]);
      notify(
        'success',
        action === 'approve'
          ? `อนุมัติเอกสาร ${selectedIds.length} รายการแล้ว`
          : `Check-in สำเร็จ ${selectedIds.length} รายการ`
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'ดำเนินการไม่สำเร็จ');
    }
  };

  const handleUpdatePlayer = async (id: string, patch: Partial<PlayerRecord>, msg: string) => {
    try {
      const res = await apiFetch<{ promotedPlayer?: PlayerRecord | null }>(`/api/players/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await refreshState();
      if (res.promotedPlayer) {
        notify(
          'success',
          `${msg} · เลื่อนสิทธิ์ "${res.promotedPlayer.teamName}" จาก Waiting List อัตโนมัติแล้ว!`
        );
      } else {
        notify('success', msg);
      }
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'อัปเดตไม่สำเร็จ');
    }
  };

  const openEditPlayer = (player: PlayerRecord) => {
    const primary = player.members?.[0] || {
      role: 'primary' as const,
      firstName: player.firstName,
      lastName: player.lastName,
      nickname: player.nickname,
      gender: player.gender || 'M',
      birthDate: player.birthDate || '',
      nationality: player.nationality || 'ไทย',
      idDocumentNo: player.idDocumentNo || '',
      address: player.address || '',
      phone: player.phone || '',
      email: player.email || '',
      club: player.club || '',
      province: player.province || '',
      shirtSize: player.shirtSize || 'L',
      photoUrl: player.photoUrl || '',
      emergencyContact: player.emergencyContact || '',
      healthInfo: player.healthInfo || '',
      healthConsent: Boolean(player.healthConsent),
      pdpaConsent: Boolean(player.pdpaConsent),
    };
    const partner = player.members?.[1] || (player.format === 'doubles' ? {
      role: 'partner' as const,
      firstName: player.partnerFirstName || '',
      lastName: player.partnerLastName || '',
      nickname: player.partnerNickname || '',
      gender: 'M' as const,
      birthDate: '',
      nationality: 'ไทย',
      idDocumentNo: '',
      address: '',
      phone: player.partnerPhone || '',
      email: player.partnerEmail || '',
      club: player.partnerClub || '',
      province: player.partnerProvince || '',
      shirtSize: 'L' as const,
      photoUrl: player.partnerPhotoUrl || '',
      emergencyContact: '',
      healthInfo: '',
      healthConsent: false,
      pdpaConsent: Boolean(player.pdpaConsent),
    } : undefined);
    setEditPlayer({
      ...player,
      firstName: primary?.firstName || player.firstName,
      lastName: primary?.lastName || player.lastName,
      nickname: primary?.nickname || player.nickname,
      phone: primary?.phone || player.phone,
      email: primary?.email || player.email,
      club: primary?.club || player.club,
      partnerFirstName: partner?.firstName || player.partnerFirstName || '',
      partnerLastName: partner?.lastName || player.partnerLastName || '',
      partnerNickname: partner?.nickname || player.partnerNickname || '',
      partnerPhone: partner?.phone || player.partnerPhone || '',
      partnerEmail: partner?.email || player.partnerEmail || '',
      partnerClub: partner?.club || player.partnerClub || '',
      partnerProvince: partner?.province || player.partnerProvince || '',
      members: partner ? [primary, partner] : [primary],
    });
  };

  const updateEditMember = <K extends keyof AthleteRegistrationValues>(
    index: number,
    field: K,
    value: AthleteRegistrationValues[K]
  ) => {
    setEditPlayer((current) => {
      if (!current) return current;
      const members = [...(current.members || [])];
      if (!members[index]) return current;
      members[index] = { ...members[index], [field]: value };
      return { ...current, members };
    });
  };

  const handleEditImageUpload = (
    event: React.ChangeEvent<HTMLInputElement>,
    target: 'teamLogoUrl' | 'primary' | 'partner'
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      notify('error', 'กรุณาเลือกไฟล์รูปภาพ (PNG, JPG, WebP)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = target === 'teamLogoUrl' ? 256 : 320;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageUrl = canvas.toDataURL('image/jpeg', 0.85);
        if (target === 'teamLogoUrl') {
          setEditPlayer((current) => current ? { ...current, teamLogoUrl: imageUrl } : current);
        } else {
          updateEditMember(target === 'primary' ? 0 : 1, 'photoUrl', imageUrl);
        }
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  };

  const divisionAvailability = useMemo(() => {
    const result: Record<string, { remaining: number; unlimited: boolean; full: boolean }> = {};
    tournament.divisions.filter((division) => division.enabled).forEach((division) => {
      const format = getDivisionFormat(division);
      const registered = state.players.filter((player) =>
        player.tournamentId === tournament.id &&
        player.divisionId === division.id &&
        player.format === format &&
        !player.withdrawn &&
        !player.waitingList
      ).length;
      const rawQuota = format === 'doubles' ? division.quotaDoubles : division.quotaSingles;
      const unlimited = rawQuota === 'unlimited';
      const remaining = unlimited ? -1 : Math.max(0, Number(rawQuota) - registered);
      result[`${division.id}|${format}`] = { remaining, unlimited, full: !unlimited && remaining === 0 };
    });
    return result;
  }, [state.players, tournament.divisions, tournament.id]);
  const selectedDivision = useMemo(
    () =>
      tournament.divisions.find((d) => d.enabled && d.id === regForm.divisionId && !divisionAvailability[`${d.id}|${getDivisionFormat(d)}`]?.full) ||
      tournament.divisions.find((d) => {
        if (!d.enabled) return false;
        return !divisionAvailability[`${d.id}|${getDivisionFormat(d)}`]?.full;
      }) ||
      tournament.divisions.find((d) => d.enabled),
    [divisionAvailability, tournament.divisions, regForm.divisionId]
  );
  const effectiveFormat = getDivisionFormat(selectedDivision);
  const regWindow = useMemo(() => getRegistrationWindowStatus(tournament), [tournament]);

  const handlePhotoUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    field: 'photoUrl' | 'partnerPhotoUrl' | 'teamLogoUrl'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      notify('error', 'กรุณาเลือกไฟล์รูปภาพ (PNG, JPG, WebP)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = field === 'teamLogoUrl' ? 256 : 320;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setRegForm((prev) => ({
          ...prev,
          [field]: canvas.toDataURL('image/jpeg', 0.85),
        }));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleUmpirePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      notify('error', 'กรุณาเลือกไฟล์รูปภาพ (PNG, JPG, WebP)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 320;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setUmpForm((prev) => ({
          ...prev,
          photoUrl: canvas.toDataURL('image/jpeg', 0.85),
        }));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const publicRegisterUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?mode=public_register&tournament=${encodeURIComponent(
          tournament.publicToken || tournament.id
        )}`
      : `/?mode=public_register&tournament=${tournament.publicToken || tournament.id}`;

  const publicStatusUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?mode=public_status&tournament=${encodeURIComponent(
          tournament.publicToken || tournament.id
        )}`
      : `/?mode=public_status&tournament=${tournament.publicToken || tournament.id}`;

  const publicDirectorApplyUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?mode=public_director&tournament=${encodeURIComponent(
          tournament.publicToken || tournament.id
        )}`
      : `/?mode=public_director&tournament=${tournament.publicToken || tournament.id}`;

  const submitRegistration = async () => {
    const div = selectedDivision;
    const fmt = getDivisionFormat(div);
    const availability = div ? divisionAvailability[`${div.id}|${fmt}`] : undefined;
    if (availability?.full) {
      notify('error', 'ระดับมือและประเภทนี้มีผู้สมัครครบแล้ว กรุณาติดต่อผู้จัดรายการ');
      return null;
    }
    const fee = fmt === 'doubles' ? div?.entryFeeDoubles || 800 : div?.entryFeeSingles || 500;
    const partnerFullName =
      `${regForm.partnerFirstName} ${regForm.partnerLastName}`.trim() || regForm.partnerName.trim();

    if (!regForm.pdpaConsent) {
      notify('error', 'กรุณาอ่านและยืนยันความยินยอม PDPA ก่อนบันทึกใบสมัคร');
      return null;
    }

    if (!regForm.photoUrl) {
      notify('error', 'กรุณาอัปโหลดรูปภาพนักกีฬาคนที่ 1');
      return null;
    }
    if (fmt === 'doubles') {
      if (!partnerFullName) {
        notify('error', 'ประเภทคู่จำเป็นต้องกรอกชื่อ-นามสกุลนักกีฬาคนที่ 2');
        return null;
      }
      if (!regForm.partnerPhotoUrl) {
        notify('error', 'ประเภทคู่จำเป็นต้องอัปโหลดรูปภาพนักกีฬาคนที่ 2');
        return null;
      }
      if (!regForm.partnerBirthDate || !regForm.partnerPhone.trim() || !regForm.partnerAddress.trim() || !regForm.partnerEmergencyContact.trim()) {
        notify('error', 'กรุณากรอกข้อมูลส่วนตัวและผู้ติดต่อฉุกเฉินของนักกีฬาคนที่ 2 ให้ครบ');
        return null;
      }
      if (!regForm.partnerPdpaConsent) {
        notify('error', 'นักกีฬาคนที่ 2 ต้องยืนยันความยินยอม PDPA');
        return null;
      }
    }

    const defaultTeamName =
      fmt === 'doubles'
        ? regForm.teamName.trim() ||
          `${regForm.firstName}${regForm.partnerFirstName ? ` / ${regForm.partnerFirstName}` : ''}`
        : regForm.teamName.trim() || `${regForm.firstName} ${regForm.lastName}`.trim();

    try {
      const created = await apiFetch<PlayerRecord>('/api/players', {
        method: 'POST',
        body: JSON.stringify({
          tournamentId: tournament.id,
          teamName: defaultTeamName,
          teamLogoUrl: regForm.teamLogoUrl || undefined,
          firstName: regForm.firstName,
          lastName: regForm.lastName,
          nickname: regForm.nickname,
          gender: regForm.gender,
          birthDate: regForm.birthDate,
          nationality: regForm.nationality,
          idDocumentNo: regForm.idDocumentNo || undefined,
          address: regForm.address || undefined,
          phone: regForm.phone,
          email: regForm.email,
          club: regForm.club || 'อิสระ',
          province: regForm.province,
          divisionId: div?.id || regForm.divisionId,
          format: fmt,
          photoUrl: regForm.photoUrl,
          partnerName: fmt === 'doubles' ? partnerFullName : undefined,
          partnerFirstName: fmt === 'doubles' ? regForm.partnerFirstName : undefined,
          partnerLastName: fmt === 'doubles' ? regForm.partnerLastName : undefined,
          partnerNickname: fmt === 'doubles' ? regForm.partnerNickname : undefined,
          partnerPhone: fmt === 'doubles' ? regForm.partnerPhone : undefined,
          partnerPhotoUrl: fmt === 'doubles' ? regForm.partnerPhotoUrl : undefined,
          skillVideoUrl: regForm.skillVideoUrl.trim() || undefined,
          shirtSize: regForm.shirtSize,
          emergencyContact: regForm.emergencyContact,
          healthInfo: regForm.healthInfo || undefined,
          healthConsent: regForm.healthConsent,
          pdpaConsent: regForm.pdpaConsent,
          members: [
            {
              role: 'primary', firstName: regForm.firstName, lastName: regForm.lastName, nickname: regForm.nickname,
              gender: regForm.gender, birthDate: regForm.birthDate, nationality: regForm.nationality,
              idDocumentNo: regForm.idDocumentNo || undefined, address: regForm.address, phone: regForm.phone,
              email: regForm.email, club: regForm.club || 'อิสระ', province: regForm.province, shirtSize: regForm.shirtSize, photoUrl: regForm.photoUrl,
              emergencyContact: regForm.emergencyContact, healthInfo: regForm.healthInfo || undefined,
              healthConsent: regForm.healthConsent, pdpaConsent: regForm.pdpaConsent,
            },
            ...(fmt === 'doubles' ? [{
              role: 'partner' as const, firstName: regForm.partnerFirstName, lastName: regForm.partnerLastName,
              nickname: regForm.partnerNickname, gender: regForm.partnerGender, birthDate: regForm.partnerBirthDate,
              nationality: regForm.partnerNationality, idDocumentNo: regForm.partnerIdDocumentNo || undefined,
              address: regForm.partnerAddress, phone: regForm.partnerPhone, email: regForm.partnerEmail,
              club: regForm.partnerClub || 'อิสระ', province: regForm.partnerProvince, shirtSize: regForm.partnerShirtSize, photoUrl: regForm.partnerPhotoUrl,
              emergencyContact: regForm.partnerEmergencyContact, healthInfo: regForm.partnerHealthInfo || undefined,
              healthConsent: regForm.partnerHealthConsent, pdpaConsent: regForm.partnerPdpaConsent,
            }] : []),
          ],
          registrationSource: 'staff',
          documentStatus: tournament.registrationConfig.autoApprove ? 'approved' : 'pending',
          paymentStatus: 'unpaid',
          slipStatus: 'not_uploaded',
          amountPaid: 0,
          amountDue: fee,
          checkedIn: false,
          withdrawn: false,
          noShow: false,
        }),
      });
      if (created.id && created.verificationCode) {
        setRevealedPlayerStatusCodes((previous) => ({ ...previous, [created.id]: created.verificationCode || '' }));
      }
      await refreshState();
      setRegForm((prev) => ({
        ...prev,
        teamName: '',
        teamLogoUrl: '',
        firstName: '',
        lastName: '',
        nickname: '',
        phone: '',
        photoUrl: '',
        partnerName: '',
        partnerFirstName: '',
        partnerLastName: '',
        partnerNickname: '',
        partnerBirthDate: '',
        partnerIdDocumentNo: '',
        partnerPhone: '',
        partnerEmail: '',
        partnerClub: '',
        partnerProvince: 'แพร่',
        partnerShirtSize: 'L',
        partnerAddress: '',
        partnerEmergencyContact: '',
        partnerHealthInfo: '',
        partnerHealthConsent: false,
        partnerPdpaConsent: false,
        partnerPhotoUrl: '',
        skillVideoUrl: '',
        healthInfo: '',
        birthDate: '',
        idDocumentNo: '',
        address: '',
        emergencyContact: '',
        pdpaConsent: false,
      }));
      return created;
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'สมัครไม่สำเร็จ');
      return null;
    }
  };

  const handleAddUmpire = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUmpire && !umpForm.pdpaConsent) {
      notify('error', 'กรุณายืนยันความยินยอม PDPA ก่อนลงทะเบียนกรรมการ');
      return;
    }
    try {
      if (editingUmpire) {
        await apiFetch(`/api/umpires/${editingUmpire.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...umpForm,
          }),
        });
        await refreshState();
        setEditingUmpire(null);
        setUmpForm(createInitialUmpForm());
        setShowUmpireModal(false);
        notify('success', `แก้ไขข้อมูลกรรมการ ${editingUmpire.firstName} ${editingUmpire.lastName} แล้ว`);
        return;
      }
      const created = await apiFetch<{ id: string; loginCode: string }>('/api/umpires', {
        method: 'POST',
        body: JSON.stringify({
          id: `ump-${Date.now()}`,
          code: `UMP-0${tUmpires.length + 1}`,
          tournamentId: tournament.id,
          ...umpForm,
          codeExpiresAt: `${tournament.endDate} 23:59`,
          applicationSource: 'staff',
          approvalStatus: 'approved',
          active: true,
          assignedMatches: 0,
          completedMatches: 0,
          hoursWorked: 0,
          history: [],
        }),
      });
      await refreshState();
      if (created.id && created.loginCode) {
        setRevealedDirectorCodes((previous) => ({ ...previous, [created.id]: created.loginCode }));
      }
      setUmpForm(createInitialUmpForm());
      setShowUmpireModal(false);
      notify('success', `ลงทะเบียนกรรมการพร้อมรหัส 12 หลัก (${created.loginCode}) แล้ว กรุณาบันทึกรหัสนี้`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'เพิ่มกรรมการไม่สำเร็จ');
    }
  };

  const openEditUmpire = (umpire: DirectorUmpire) => {
    setEditingUmpire(umpire);
    setUmpForm({
      firstName: umpire.firstName || '',
      lastName: umpire.lastName || '',
      nickname: umpire.nickname || '',
      phone: umpire.phone || '',
      email: umpire.email || '',
      photoUrl: umpire.photoUrl || '',
      certification: umpire.certification || 'กรรมการสมาคมฯ ระดับ 1',
      clubAffiliation: umpire.clubAffiliation || 'อิสระ (ไม่มีสังกัด)',
      experienceNote: umpire.experienceNote || '',
      address: umpire.address || '',
      emergencyContact: umpire.emergencyContact || '',
      lineId: umpire.lineId || '',
      pdpaConsent: Boolean(umpire.pdpaConsent),
    });
    setShowUmpireModal(true);
  };

  const handleRegenerateCode = (u: DirectorUmpire) => {
    requestConfirm({
      title: `สร้างรหัส 12 หลักใหม่ให้ ${u.firstName} ${u.lastName}?`,
      description: 'รหัสเดิมจะถูกยกเลิกทันที (Revoke) และระบบจะออกรหัส 12 หลักชุดใหม่',
      confirmLabel: 'สร้างรหัสใหม่',
      onConfirm: async () => {
        const result = await apiFetch<{ loginCode: string }>(`/api/umpires/${u.id}/regenerate-code`, { method: 'POST' });
        await refreshState();
        setRevealedDirectorCodes((previous) => ({ ...previous, [u.id]: result.loginCode }));
        notify('success', `ออกรหัสใหม่ให้ ${u.firstName}: ${result.loginCode} (แสดงเฉพาะครั้งนี้)`);
      },
    });
  };

  const handleRegeneratePlayerStatusCode = async (player: PlayerRecord) => {
    try {
      const result = await apiFetch<{ verificationCode: string }>(`/api/players/${player.id}/regenerate-verification-code`, { method: 'POST' });
      setRevealedPlayerStatusCodes((previous) => ({ ...previous, [player.id]: result.verificationCode }));
      await refreshState();
      notify('success', `สร้างรหัสเข้าดูสถานะใหม่ให้ ${player.teamName} แล้ว`);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'สร้างรหัสเข้าดูสถานะไม่สำเร็จ');
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Tabs + Registration CTAs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-[#EFECE4] dark:bg-[#1B293D] w-fit">
          <button
            onClick={() => setMemberTab('player')}
            className={`min-h-[40px] px-4 py-2 rounded-md text-xs font-semibold ${
              memberTab === 'player'
                ? 'bg-white dark:bg-[#131E2E] shadow-sm text-[#141D2B] dark:text-[#F3F5F8]'
                : 'text-[#525C6B] dark:text-[#9AA8BC]'
            }`}
          >
            นักกีฬา / ทีม ({listedPlayerTotal || tPlayers.length})
          </button>
          <button
            onClick={() => setMemberTab('umpire')}
            className={`min-h-[40px] px-4 py-2 rounded-md text-xs font-semibold ${
              memberTab === 'umpire'
                ? 'bg-white dark:bg-[#131E2E] shadow-sm text-[#141D2B] dark:text-[#F3F5F8]'
                : 'text-[#525C6B] dark:text-[#9AA8BC]'
            }`}
          >
            กรรมการ / Director ({listedUmpireTotal || tUmpires.length})
          </button>
        </div>

        {memberTab === 'player' ? (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowStaffReg(true)}
              disabled={!hasPermission('approveRegistration')}
              className="min-h-[40px] px-3.5 rounded-lg bg-[#156143] hover:bg-[#104D35] text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <UserPlus className="w-4 h-4" />
              <span>รับสมัครโดยเจ้าหน้าที่</span>
            </button>
            <button
              type="button"
              onClick={() => setShowOnlineLinksModal(true)}
              className="min-h-[40px] px-3.5 rounded-lg bg-[#142642] hover:bg-[#1E355C] text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <QrCode className="w-4 h-4 text-[#FACC15]" />
              <span>QR & ลิงก์สมัครออนไลน์ / ตรวจสถานะ</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setEditingUmpire(null);
                setUmpForm(createInitialUmpForm());
                setShowUmpireModal(true);
              }}
              disabled={!hasPermission('assignUmpire')}
              className="min-h-[40px] px-4 rounded-lg bg-[#156143] hover:bg-[#104D35] text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <UserPlus className="w-4 h-4" />
              <span>รับลงทะเบียนโดยเจ้าหน้าที่</span>
            </button>
            <button type="button" onClick={() => setShowDirectorOnlineModal(true)} className="min-h-[40px] px-4 rounded-lg bg-[#142642] text-white text-xs font-semibold inline-flex items-center gap-1.5">
              <QrCode className="w-4 h-4 text-[#FACC15]" />
              <span>QR สมัครกรรมการออนไลน์</span>
            </button>
          </div>
        )}
      </div>

      {/* PLAYER TAB */}
      {memberTab === 'player' && (
        <div className="space-y-4">
          {/* Filters & Bulk Actions */}
          <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              <div className="relative lg:col-span-2">
                <Search className="w-4 h-4 text-[#525C6B] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ค้นหารหัสสมัคร ชื่อทีม ชื่อนักกีฬา สโมสร..."
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
                value={filterPay}
                onChange={(e) => setFilterPay(e.target.value)}
                className="min-h-[42px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs"
              >
                <option value="all">ทุกสถานะชำระเงิน</option>
                <option value="paid">ชำระแล้ว</option>
                <option value="pending_verify">รอตรวจสลิป</option>
                <option value="unpaid">ค้างชำระ</option>
              </select>
              <select
                value={filterCheckIn}
                onChange={(e) => setFilterCheckIn(e.target.value)}
                className="min-h-[42px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] text-xs"
              >
                <option value="all">ทุกสถานะ Check-in</option>
                <option value="yes">Check-in แล้ว</option>
                <option value="no">ยังไม่ Check-in</option>
              </select>
            </div>

            {selectedIds.length > 0 && (
              <div className="pt-2 border-t border-[#E2DFD5] dark:border-[#25354C] flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold">เลือกอยู่ {selectedIds.length} รายการ</span>
                <div className="flex gap-2">
                  <button
                    disabled={!hasPermission('approveRegistration')}
                    onClick={() => handleBulkAction('approve')}
                    className="min-h-[36px] px-3 rounded-lg bg-[#156143] text-white font-semibold disabled:opacity-40"
                  >
                    Bulk Approve เอกสาร
                  </button>
                  <button
                    disabled={!hasPermission('checkIn')}
                    onClick={() => handleBulkAction('checkin')}
                    className="min-h-[36px] px-3 rounded-lg bg-[#142642] text-white font-semibold disabled:opacity-40"
                  >
                    Bulk Check-in
                  </button>
                </div>
              </div>
            )}
          </div>

          {paginatedPlayers.length === 0 ? (
            <EmptyStateCard
              title="ไม่พบรายชื่อนักกีฬา"
              description="ลองเปลี่ยนคำค้นหาหรือตัวกรอง"
            />
          ) : (
            <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] overflow-x-auto shadow-sm">
              <table className="w-full min-w-[1220px] table-fixed text-xs text-left border-collapse">
                <colgroup>
                  <col className="w-11" />
                  <col className="w-[330px]" />
                  <col className="w-[230px]" />
                  <col className="w-[190px]" />
                  <col className="w-[210px]" />
                  <col className="w-[210px]" />
                </colgroup>
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#F7F6F2] dark:bg-[#0B121C] border-b border-[#E2DFD5] dark:border-[#25354C] text-[#525C6B] dark:text-[#9AA8BC]">
                    <th className="py-3 px-3 w-8">
                      <input
                        type="checkbox"
                        aria-label="เลือกทั้งหมด"
                        checked={
                          paginatedPlayers.length > 0 &&
                          paginatedPlayers.every((p) => selectedIds.includes(p.id))
                        }
                        onChange={(e) => {
                          const pageIds = paginatedPlayers.map((p) => p.id);
                          setSelectedIds((prev) =>
                            e.target.checked
                              ? Array.from(new Set([...prev, ...pageIds]))
                              : prev.filter((id) => !pageIds.includes(id))
                          );
                        }}
                      />
                    </th>
                    <th className="py-3 px-3">รหัส / ทีม / นักกีฬา</th>
                    <th className="py-3 px-3">ระดับ / สโมสร</th>
                    <th className="py-3 px-3">ชำระเงิน & สลิป</th>
                    <th className="py-3 px-3">Check-in & สถานะ</th>
                    <th className="py-3 px-3 text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2DFD5] dark:divide-[#25354C]">
                  {paginatedPlayers.map((p) => {
                    const div = tournament.divisions.find((d) => d.id === p.divisionId);
                    const payment = getPlayerPaymentPresentation(p);
                    const statusAccessCode = revealedPlayerStatusCodes[p.id] || p.verificationCode || '';
                    const statusCodeLast4 = p.verificationCodeLast4 || statusAccessCode.slice(-4) || '••••';
                    const athleteNames = p.members?.length
                      ? p.members.map((member) => `${member.firstName} ${member.lastName}${member.nickname ? ` (${member.nickname})` : ''}`.trim())
                      : [
                          `${p.firstName} ${p.lastName}${p.nickname ? ` (${p.nickname})` : ''}`.trim(),
                          p.partnerName?.trim(),
                        ].filter(Boolean) as string[];
                    return (
                      <tr key={p.id} className={`${p.withdrawn ? 'opacity-50' : ''} align-top transition-colors hover:bg-[#FAF9F6] dark:hover:bg-[#172235]`}>
                        <td className="py-4 px-3 align-top">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(p.id)}
                            onChange={(e) =>
                              setSelectedIds((prev) =>
                                e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)
                              )
                            }
                          />
                        </td>
                        <td className="py-4 px-3 align-top">
                          <div className="flex items-start gap-2.5">
                            <div className="flex -space-x-2 shrink-0 mt-0.5">
                              {p.photoUrl ? (
                                <img
                                  src={p.photoUrl}
                                  alt={p.firstName}
                                  className="w-8 h-8 rounded-lg object-cover border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2]"
                                />
                              ) : (
                                <div className="w-8 h-8 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] flex items-center justify-center text-[#525C6B]">
                                  <User className="w-4 h-4" />
                                </div>
                              )}
                              {p.format === 'doubles' &&
                                (p.partnerPhotoUrl ? (
                                  <img
                                    src={p.partnerPhotoUrl}
                                    alt={p.partnerName || 'Partner'}
                                    className="w-8 h-8 rounded-lg object-cover border border-white dark:border-[#131E2E] bg-[#F7F6F2]"
                                  />
                                ) : null)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[#667085] dark:text-[#9AA8BC]">
                                <span>รหัสสมัคร</span>
                                <span className="font-mono text-xs font-bold text-[#156143] dark:text-[#229A6B]">{p.registrationCode}</span>
                                {p.waitingList && <span>· Waiting #{p.waitingPosition || 1}</span>}
                              </div>
                              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[#667085] dark:text-[#9AA8BC]">
                                <span>รหัสเข้าดูสถานะ</span>
                                <span className="font-mono font-bold text-[#142642] dark:text-[#FACC15]">{statusAccessCode || `••${statusCodeLast4}`}</span>
                                <button type="button" disabled={!statusAccessCode} title="คัดลอกรหัสเข้าดูสถานะ" onClick={() => { if (statusAccessCode) { navigator.clipboard?.writeText(statusAccessCode); notify('success', 'คัดลอกรหัสเข้าดูสถานะแล้ว'); } }} className="rounded p-1 hover:bg-[#EFECE4] disabled:opacity-30 dark:hover:bg-[#1B293D]"><Copy className="h-3 w-3" /></button>
                                {hasPermission('approveRegistration') && <button type="button" title="สร้างรหัสเข้าดูสถานะใหม่" onClick={() => void handleRegeneratePlayerStatusCode(p)} className="rounded p-1 text-[#156143] hover:bg-[#ECFDF3] dark:text-[#4ADE80] dark:hover:bg-[#10291E]"><KeyRound className="h-3 w-3" /></button>}
                              </div>
                              <div className="font-semibold text-sm flex items-center gap-1.5 mt-1 min-w-0">
                                <TeamLogoBadge teamName={p.teamName} logoUrl={p.teamLogoUrl} size="xs" />
                                <span className="truncate" title={p.teamName}>{p.teamName}</span>
                              </div>
                              <div className="mt-1 space-y-0.5 text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
                                {athleteNames.map((name, index) => (
                                  <div key={`${p.id}-athlete-${index}`} className="truncate" title={name}>
                                    นักกีฬา {index + 1}: {name}
                                  </div>
                                ))}
                              </div>
                              {p.skillVideoUrl && (
                                <a
                                  href={p.skillVideoUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#156143] dark:text-[#4ADE80] hover:underline"
                                >
                                  <Video className="w-3 h-3" />
                                  <span>ดูคลิปประเมินมือ</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-3 align-top">
                          <div className="font-semibold flex flex-wrap items-center gap-1.5 leading-5">
                            <span className="min-w-0">{div?.nameTh || 'ไม่พบระดับมือ'}</span>
                            <span className="px-1.5 py-0.5 rounded bg-[#EFECE4] dark:bg-[#1B293D] text-[10px] font-semibold">
                              {p.format === 'singles' ? 'เดี่ยว 1 คน' : 'คู่ 2 คน'}
                            </span>
                          </div>
                          <div className="mt-1 text-[#525C6B] dark:text-[#9AA8BC] break-words">
                            {p.club || 'อิสระ'}{p.province ? ` · ${p.province}` : ''}
                          </div>
                        </td>
                        <td className="py-4 px-3 align-top space-y-2">
                          <StatusIndicator
                            tone={payment.tone}
                            label={payment.label}
                            compact
                          />
                          {payment.canConfirm && hasPermission('verifyPayment') && (
                            <div>
                              <button
                                onClick={() =>
                                  handleUpdatePlayer(
                                    p.id,
                                    {
                                      paymentStatus: 'paid',
                                      slipStatus: 'approved',
                                      amountPaid: p.amountDue || 800,
                                      amountDue: 0,
                                    },
                                    `ยืนยันชำระเงิน ${p.registrationCode}`
                                  )
                                }
                                className="text-[11px] font-semibold text-[#156143] hover:underline"
                              >
                                ยืนยันยอดชำระ
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="py-4 px-3 align-top space-y-2">
                          <StatusIndicator
                            tone={
                              p.withdrawn
                                ? 'danger'
                                : p.checkedIn
                                ? 'success'
                                : p.waitingList
                                ? 'warning'
                                : 'neutral'
                            }
                            label={
                              p.withdrawn
                                ? 'ถอนตัว'
                                : p.checkedIn
                                ? `เช็คอิน ${formatThaiDateTime(p.checkInTime)}`
                                : p.waitingList
                                ? 'Waiting List'
                                : 'รอเช็คอิน'
                            }
                            compact
                          />
                        </td>
                        <td className="py-4 px-3 align-top text-right">
                          <div className="inline-flex max-w-full flex-wrap items-center justify-end gap-1.5">
                            {!p.checkedIn && !p.withdrawn && hasPermission('checkIn') && (
                              <button
                                onClick={() =>
                                  handleUpdatePlayer(
                                    p.id,
                                    { checkedIn: true },
                                    `Check-in ${p.teamName}`
                                  )
                                }
                                className="min-h-[34px] px-2.5 rounded-lg bg-[#156143] text-white font-semibold"
                              >
                                Check-in
                              </button>
                            )}
                            {hasPermission('approveRegistration') && (
                              <button
                                onClick={() => openEditPlayer(p)}
                                className="min-h-[34px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] font-medium"
                              >
                                แก้ไขข้อมูล
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <PaginationBar
            page={playerPage}
            pageSize={playerPageSize}
            totalItems={listedPlayerTotal}
            onPageChange={setPlayerPage}
            onPageSizeChange={setPlayerPageSize}
            pageSizeOptions={[10, 20, 50]}
          />
        </div>
      )}

      {/* UMPIRE TAB */}
      {memberTab === 'umpire' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#E2DFD5] bg-white p-3 dark:border-[#25354C] dark:bg-[#131E2E]">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px]">
              <label className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#667085]" />
                <input value={umpireSearch} onChange={(event) => setUmpireSearch(event.target.value)} placeholder="ค้นหาชื่อ รหัส เบอร์โทร หรือสังกัด" className="min-h-10 w-full rounded-lg border border-[#D8D5CC] bg-[#F7F6F2] pl-9 pr-3 text-xs dark:border-[#25354C] dark:bg-[#0B121C]" />
              </label>
              <select value={umpireStatus} onChange={(event) => setUmpireStatus(event.target.value as typeof umpireStatus)} className="min-h-10 rounded-lg border border-[#D8D5CC] bg-[#F7F6F2] px-3 text-xs dark:border-[#25354C] dark:bg-[#0B121C]">
                <option value="all">ทุกสถานะ</option><option value="pending">รออนุมัติ</option><option value="approved">อนุมัติแล้ว</option><option value="rejected">ปฏิเสธ</option>
              </select>
            </div>
          </div>
          {paginatedUmpires.length === 0 ? (
            <EmptyStateCard title="ไม่พบกรรมการ" description="ลองเปลี่ยนคำค้นหาหรือสถานะ หรือเปิด QR เพื่อรับสมัครกรรมการออนไลน์" />
          ) : (
          <div className="space-y-2">
            <div className="hidden xl:grid xl:grid-cols-[minmax(280px,1.5fr)_minmax(220px,1fr)_190px_170px_minmax(280px,auto)] gap-4 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#667085] dark:text-[#9AA8BC]">
              <span>กรรมการ</span><span>คุณสมบัติ / รุ่นที่ตัดสิน</span><span>สถานะ / รหัสเข้าใช้</span><span>ภาระงาน</span><span className="text-right">จัดการ</span>
            </div>
            {paginatedUmpires.map((u) => {
              const revealedCode = revealedDirectorCodes[u.id] || u.loginCode12 || '';
              const last4 = u.loginCodeLast4 || revealedCode.slice(-4) || '••••';
              const statusTone = u.approvalStatus === 'pending' ? 'warning' : u.approvalStatus === 'rejected' || !u.active ? 'danger' : 'success';
              const statusLabel = u.approvalStatus === 'pending' ? 'รออนุมัติ' : u.approvalStatus === 'rejected' ? 'ปฏิเสธ' : u.active ? 'พร้อมใช้งาน' : 'ปิดใช้งาน';
              return (
                <article key={u.id} className="rounded-xl border border-[#E2DFD5] bg-white p-4 shadow-sm transition-colors hover:border-[#C9C3B5] dark:border-[#25354C] dark:bg-[#131E2E] dark:hover:border-[#3A506F]">
                  <div className="grid gap-4 xl:grid-cols-[minmax(280px,1.5fr)_minmax(220px,1fr)_190px_170px_minmax(280px,auto)] xl:items-center">
                    <div className="flex min-w-0 items-start gap-3">
                      {u.photoUrl ? <img src={u.photoUrl} alt={`${u.firstName} ${u.lastName}`} referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded-xl border border-[#E2DFD5] object-cover dark:border-[#25354C]" /> : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#E2DFD5] bg-[#F7F6F2] text-[#525C6B] dark:border-[#25354C] dark:bg-[#0B121C] dark:text-[#9AA8BC]"><UserCheck className="h-5 w-5" /></div>}
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] font-bold text-[#156143] dark:text-[#4ADE80]">{u.code}</div>
                        <h3 className="truncate text-sm font-bold" title={`${u.firstName} ${u.lastName}`}>{u.firstName} {u.lastName}{u.nickname ? ` (${u.nickname})` : ''}</h3>
                        <div className="mt-0.5 truncate text-[11px] text-[#667085] dark:text-[#9AA8BC]">{u.clubAffiliation || 'อิสระ'} · {u.phone}</div>
                        {u.email && <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-[#667085] dark:text-[#9AA8BC]"><Mail className="h-3 w-3 shrink-0" /><span className="truncate">{u.email}</span></div>}
                      </div>
                    </div>
                    <div className="min-w-0 text-xs">
                      <div className="xl:hidden mb-1 text-[10px] font-semibold text-[#667085]">คุณสมบัติ</div>
                      <div className="font-semibold">{u.certification || 'ยังไม่ระบุใบรับรอง'}</div>
                      <div className="mt-1 text-[11px] text-[#667085] dark:text-[#9AA8BC]">ตัดสินได้ทุกระดับและทุกประเภทการแข่งขัน</div>
                    </div>
                    <div className="space-y-2">
                      <StatusIndicator tone={statusTone} label={statusLabel} compact />
                      <div>
                        <div className="text-[10px] text-[#667085] dark:text-[#9AA8BC]">รหัสเข้าสู่ระบบ</div>
                        <div className="flex items-center gap-1">
                          <div className="font-mono text-sm font-bold tracking-[0.16em] text-[#142642] dark:text-[#FACC15]">{revealedCode || `••••••••${last4}`}</div>
                          <button
                            type="button"
                            disabled={!revealedCode}
                            title={revealedCode ? 'คัดลอกรหัสเข้าสู่ระบบ' : 'รหัสเต็มจะแสดงหลังสร้างรหัสใหม่เท่านั้น'}
                            onClick={() => {
                              if (!revealedCode) return;
                              navigator.clipboard?.writeText(revealedCode);
                              notify('success', 'คัดลอกรหัสเข้าสู่ระบบแล้ว');
                            }}
                            className="rounded-md p-1.5 text-[#156143] hover:bg-[#ECFDF3] disabled:cursor-not-allowed disabled:opacity-30 dark:text-[#4ADE80] dark:hover:bg-[#10291E]"
                            aria-label="คัดลอกรหัสเข้าสู่ระบบ"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="text-[10px] text-[#667085]">หมดอายุ {formatThaiDateTime(u.codeExpiresAt)}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 xl:grid-cols-1 xl:gap-1 text-xs">
                      <span><strong>{u.assignedMatches || 0}</strong> มอบหมาย</span>
                      <span><strong>{u.completedMatches || 0}</strong> ตัดสินแล้ว</span>
                      <span><strong>{u.hoursWorked || 0}</strong> ชั่วโมง</span>
                    </div>
                    <div className="flex flex-wrap justify-start gap-1.5 xl:justify-end">
                      <button disabled={!hasPermission('assignUmpire')} onClick={() => openEditUmpire(u)} className="min-h-9 rounded-lg border border-[#BBDCCF] px-2.5 text-xs font-semibold text-[#156143] disabled:opacity-40 dark:border-[#24533F] dark:text-[#4ADE80]">แก้ไขข้อมูล</button>
                      <details className="group relative">
                        <summary className="flex min-h-9 cursor-pointer list-none items-center rounded-lg bg-[#142642] px-3 text-xs font-semibold text-white">จัดการ ▾</summary>
                        <div className="absolute right-0 z-30 mt-1 w-52 overflow-hidden rounded-xl border border-[#E2DFD5] bg-white p-1.5 shadow-xl dark:border-[#25354C] dark:bg-[#131E2E]">
                          <button disabled={!hasPermission('assignUmpire')} onClick={() => handleRegenerateCode(u)} className="flex min-h-9 w-full items-center rounded-lg px-2.5 text-left text-xs hover:bg-[#F7F6F2] disabled:opacity-40 dark:hover:bg-[#1B293D]"><RefreshCw className="mr-2 h-3.5 w-3.5" />สร้างรหัสใหม่</button>
                          <button disabled={!revealedCode} title={revealedCode ? 'สร้าง QR สำหรับรหัสที่เพิ่งออก' : 'กดสร้างรหัสใหม่ก่อน'} onClick={() => setQrUmpire({ ...u, loginCode12: revealedCode })} className="flex min-h-9 w-full items-center rounded-lg px-2.5 text-left text-xs hover:bg-[#F7F6F2] disabled:opacity-40 dark:hover:bg-[#1B293D]"><QrCode className="mr-2 h-3.5 w-3.5" />QR เข้าแอปกรรมการ</button>
                          <button onClick={() => setHistoryUmpire(u)} className="flex min-h-9 w-full items-center rounded-lg px-2.5 text-left text-xs hover:bg-[#F7F6F2] dark:hover:bg-[#1B293D]">ประวัติ ({u.history?.length || 0})</button>
                          <button disabled={!hasPermission('assignUmpire')} onClick={async () => { await apiFetch(`/api/umpires/${u.id}`, { method: 'PATCH', body: JSON.stringify({ active: !u.active }) }); await refreshState(); notify('info', `${u.firstName}: ${!u.active ? 'เปิดใช้งาน' : 'Revoke รหัสแล้ว'}`); }} className="flex min-h-9 w-full items-center rounded-lg px-2.5 text-left text-xs text-[#B91C1C] hover:bg-[#FEF2F2] disabled:opacity-40 dark:text-[#F87171] dark:hover:bg-[#361215]">{u.active ? 'ยกเลิกรหัสเข้าใช้' : 'เปิดใช้งานกรรมการ'}</button>
                        </div>
                      </details>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          )}
          <PaginationBar
            page={umpirePage}
            pageSize={umpirePageSize}
            totalItems={listedUmpireTotal}
            onPageChange={setUmpirePage}
            onPageSizeChange={setUmpirePageSize}
            pageSizeOptions={[8, 16, 32]}
          />
        </div>
      )}

      {/* Staff Registration Modal */}
      {showStaffReg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-0 sm:p-4" role="dialog">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await submitRegistration();
              if (res) {
                setShowStaffReg(false);
                notify(
                  res.waitingList ? 'warning' : 'success',
                  res.waitingList
                    ? `โควตาเต็ม: บันทึก ${res.registrationCode} เข้า Waiting List #${res.waitingPosition}`
                    : `ลงทะเบียน ${res.registrationCode} (รหัสตรวจสอบ ${res.verificationCode || res.registrationCode}) สำเร็จ`
                );
              }
            }}
            className="flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-none border border-[#E2DFD5] bg-white shadow-xl dark:border-[#25354C] dark:bg-[#131E2E] sm:max-h-[90vh] sm:rounded-2xl lg:max-w-5xl"
          >
            <div className="p-4 border-b border-[#E2DFD5] dark:border-[#25354C] flex items-center justify-between">
              <h3 className="text-base font-bold">รับสมัครนักกีฬาโดยเจ้าหน้าที่</h3>
              <button type="button" onClick={() => setShowStaffReg(false)} className="p-1.5">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">ระดับมือ *</label>
                  <select
                    value={selectedDivision?.id || ''}
                    onChange={(e) => {
                      const d = tournament.divisions.find((x) => x.id === e.target.value);
                      setRegForm({
                        ...regForm,
                        divisionId: e.target.value,
                        format: getDivisionFormat(d),
                      });
                    }}
                    className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                  >
                    {!tournament.divisions.some((division) => division.enabled) && (
                      <option value="">ไม่มีระดับมือที่เปิดรับสมัคร</option>
                    )}
                    {tournament.divisions.filter((d) => d.enabled).map((d) => {
                      const fmt = getDivisionFormat(d);
                      const availability = divisionAvailability[`${d.id}|${fmt}`];
                      const availabilityLabel = availability?.unlimited
                        ? 'ไม่จำกัดจำนวน'
                        : availability?.full
                        ? 'เต็ม — ติดต่อผู้จัด'
                        : `เหลือ ${availability?.remaining ?? 0} ทีม`;
                      return (
                        <option key={d.id} value={d.id} disabled={availability?.full}>
                          {d.nameTh} ({fmt === 'singles' ? 'เดี่ยว 1 คน' : 'คู่ 2 คน'}) · {availabilityLabel}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="block font-medium mb-1">ชื่อทีม</label>
                  <input
                    value={regForm.teamName}
                    onChange={(e) => setRegForm({ ...regForm, teamName: e.target.value })}
                    placeholder={
                      effectiveFormat === 'doubles'
                        ? 'เช่น แพร่พิราบขาว 2'
                        : 'เว้นว่างเพื่อใช้ชื่อ-นามสกุล'
                    }
                    className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                  />
                </div>
              </div>

              {/* Team Logo Upload */}
              <div className="p-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  {regForm.teamLogoUrl ? (
                    <img
                      src={regForm.teamLogoUrl}
                      alt="โลโก้ทีม"
                      className="w-10 h-10 rounded-lg object-cover border border-[#E2DFD5] dark:border-[#25354C] bg-white"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg border border-dashed border-[#C9C4B5] flex items-center justify-center text-[#525C6B]">
                      <ImageIcon className="w-4 h-4" />
                    </div>
                  )}
                  <div>
                    <div className="font-semibold">โลโก้ทีม (Team Logo)</div>
                    <div className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
                      อัปโหลดรูปโลโก้ทีมสำหรับแสดงในตารางและสายแข่ง (Optional)
                    </div>
                  </div>
                </div>
                <label className="min-h-[36px] px-3 rounded-lg border border-dashed border-[#142642] dark:border-[#60A5FA] text-[#142642] dark:text-[#93C5FD] font-semibold inline-flex items-center gap-1.5 cursor-pointer shrink-0">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{regForm.teamLogoUrl ? 'เปลี่ยนโลโก้' : 'อัปโหลดโลโก้'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(e) => handlePhotoUpload(e, 'teamLogoUrl')}
                  />
                </label>
              </div>

              <div className="p-2.5 rounded-lg bg-[#EFF6FF] dark:bg-[#162742] border border-[#BFDBFE] dark:border-[#2B4368] text-[#1D4ED8] dark:text-[#93C5FD] flex items-center gap-2 font-semibold">
                {effectiveFormat === 'doubles' ? (
                  <Users className="w-4 h-4 shrink-0" />
                ) : (
                  <User className="w-4 h-4 shrink-0" />
                )}
                <span>
                  {effectiveFormat === 'doubles'
                    ? 'รุ่นประเภทคู่ — กรอกข้อมูลและอัปโหลดรูปภาพนักกีฬา 2 คน'
                    : 'รุ่นประเภทเดี่ยว — กรอกข้อมูลและอัปโหลดรูปภาพนักกีฬา 1 คน'}
                </span>
              </div>

              <AthleteRegistrationFields
                athleteNumber={1}
                compact
                pdpaText={tournament.registrationConfig.pdpaConsentText}
                values={{
                  firstName: regForm.firstName, lastName: regForm.lastName, nickname: regForm.nickname,
                  gender: regForm.gender, birthDate: regForm.birthDate, nationality: regForm.nationality,
                  idDocumentNo: regForm.idDocumentNo, phone: regForm.phone, email: regForm.email,
                  club: regForm.club, province: regForm.province, shirtSize: regForm.shirtSize || 'L',
                  address: regForm.address, emergencyContact: regForm.emergencyContact,
                  healthInfo: regForm.healthInfo, photoUrl: regForm.photoUrl, pdpaConsent: regForm.pdpaConsent,
                }}
                onChange={(field, value) => setRegForm((prev) => ({ ...prev, [field]: value }))}
                onPhotoChange={(event) => handlePhotoUpload(event, 'photoUrl')}
              />

              {effectiveFormat === 'doubles' && (
                <AthleteRegistrationFields
                  athleteNumber={2}
                  compact
                  pdpaText={tournament.registrationConfig.pdpaConsentText}
                  values={{
                    firstName: regForm.partnerFirstName, lastName: regForm.partnerLastName, nickname: regForm.partnerNickname,
                    gender: regForm.partnerGender, birthDate: regForm.partnerBirthDate, nationality: regForm.partnerNationality,
                    idDocumentNo: regForm.partnerIdDocumentNo, phone: regForm.partnerPhone, email: regForm.partnerEmail,
                    club: regForm.partnerClub, province: regForm.partnerProvince, shirtSize: regForm.partnerShirtSize || 'L',
                    address: regForm.partnerAddress, emergencyContact: regForm.partnerEmergencyContact,
                    healthInfo: regForm.partnerHealthInfo, photoUrl: regForm.partnerPhotoUrl, pdpaConsent: regForm.partnerPdpaConsent,
                  }}
                  onChange={(field, value) => {
                    const partnerField = `partner${field.charAt(0).toUpperCase()}${field.slice(1)}`;
                    setRegForm((prev) => ({ ...prev, [partnerField]: value }));
                  }}
                  onPhotoChange={(event) => handlePhotoUpload(event, 'partnerPhotoUrl')}
                />
              )}

              {false && <>

              <div className="p-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] space-y-2.5">
                <div className="font-bold text-[#141D2B] dark:text-[#F3F5F8]">
                  ข้อมูลนักกีฬาคนที่ 1 *
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block font-medium mb-1">ชื่อจริง *</label>
                    <input
                      required
                      value={regForm.firstName}
                      onChange={(e) => setRegForm({ ...regForm, firstName: e.target.value })}
                      className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                    />
                  </div>
                  <div>
                    <label className="block font-medium mb-1">นามสกุล *</label>
                    <input
                      required
                      value={regForm.lastName}
                      onChange={(e) => setRegForm({ ...regForm, lastName: e.target.value })}
                      className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                    />
                  </div>
                  <div>
                    <label className="block font-medium mb-1">ชื่อเล่น</label>
                    <input
                      value={regForm.nickname}
                      onChange={(e) => setRegForm({ ...regForm, nickname: e.target.value })}
                      className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3 pt-1">
                  {regForm.photoUrl ? (
                    <img
                      src={regForm.photoUrl}
                      alt="รูปนักกีฬาคนที่ 1"
                      className="w-12 h-12 rounded-lg object-cover border border-[#E2DFD5] dark:border-[#25354C]"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg border border-dashed border-[#C9C4B5] flex items-center justify-center text-[#525C6B]">
                      <Camera className="w-5 h-5" />
                    </div>
                  )}
                  <label className="min-h-[38px] px-3 rounded-lg border border-dashed border-[#156143] text-[#156143] dark:text-[#4ADE80] font-semibold inline-flex items-center gap-1.5 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>
                      {regForm.photoUrl ? 'เปลี่ยนรูปนักกีฬาคนที่ 1' : 'อัปโหลดรูปนักกีฬาคนที่ 1 *'}
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={(e) => handlePhotoUpload(e, 'photoUrl')}
                    />
                  </label>
                </div>
              </div>

              {effectiveFormat === 'doubles' && (
                <div className="p-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] space-y-2.5">
                  <div className="font-bold text-[#141D2B] dark:text-[#F3F5F8]">
                    ข้อมูลนักกีฬาคนที่ 2 (คู่หู) *
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block font-medium mb-1">ชื่อจริง *</label>
                      <input
                        required
                        value={regForm.partnerFirstName}
                        onChange={(e) =>
                          setRegForm({ ...regForm, partnerFirstName: e.target.value })
                        }
                        className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                      />
                    </div>
                    <div>
                      <label className="block font-medium mb-1">นามสกุล *</label>
                      <input
                        required
                        value={regForm.partnerLastName}
                        onChange={(e) =>
                          setRegForm({ ...regForm, partnerLastName: e.target.value })
                        }
                        className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                      />
                    </div>
                    <div>
                      <label className="block font-medium mb-1">ชื่อเล่น / เบอร์โทร</label>
                      <input
                        value={regForm.partnerNickname}
                        onChange={(e) =>
                          setRegForm({ ...regForm, partnerNickname: e.target.value })
                        }
                        placeholder="ชื่อเล่น"
                        className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="block font-medium mb-1">เพศ *</label>
                      <select value={regForm.partnerGender} onChange={(e) => setRegForm({ ...regForm, partnerGender: e.target.value as 'M' | 'F' })} className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"><option value="M">ชาย</option><option value="F">หญิง</option></select>
                    </div>
                    <div>
                      <label className="block font-medium mb-1">วันเกิด *</label>
                      <input required type="date" value={regForm.partnerBirthDate} onChange={(e) => setRegForm({ ...regForm, partnerBirthDate: e.target.value })} className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                    </div>
                    <div>
                      <label className="block font-medium mb-1">สัญชาติ *</label>
                      <input required value={regForm.partnerNationality} onChange={(e) => setRegForm({ ...regForm, partnerNationality: e.target.value })} className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input required value={regForm.partnerPhone} onChange={(e) => setRegForm({ ...regForm, partnerPhone: e.target.value })} placeholder="เบอร์โทรคนที่ 2 *" className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                    <input type="email" value={regForm.partnerEmail} onChange={(e) => setRegForm({ ...regForm, partnerEmail: e.target.value })} placeholder="อีเมลคนที่ 2" className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                    <input value={regForm.partnerIdDocumentNo} onChange={(e) => setRegForm({ ...regForm, partnerIdDocumentNo: e.target.value })} placeholder="เลขบัตร/หนังสือเดินทาง" className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                  </div>
                  <textarea required rows={2} value={regForm.partnerAddress} onChange={(e) => setRegForm({ ...regForm, partnerAddress: e.target.value })} placeholder="ที่อยู่ติดต่อคนที่ 2 *" className="w-full p-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input required value={regForm.partnerEmergencyContact} onChange={(e) => setRegForm({ ...regForm, partnerEmergencyContact: e.target.value })} placeholder="ผู้ติดต่อฉุกเฉินคนที่ 2 *" className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                    <input value={regForm.partnerHealthInfo} onChange={(e) => setRegForm({ ...regForm, partnerHealthInfo: e.target.value })} placeholder="ข้อมูลสุขภาพคนที่ 2 (ถ้ามี)" className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                  </div>
                  <label className="flex items-start gap-2.5 rounded-xl border border-[#BBDCCF] bg-[#F1FAF6] p-3 dark:border-[#24533F] dark:bg-[#10291E]">
                    <input required type="checkbox" checked={regForm.partnerPdpaConsent} onChange={(e) => setRegForm({ ...regForm, partnerPdpaConsent: e.target.checked })} className="mt-0.5" />
                    <span><strong className="block">ความยินยอม PDPA ของนักกีฬาคนที่ 2 *</strong><span className="mt-1 block text-[11px] leading-5 text-[#526071] dark:text-[#B9C4D3]">{tournament.registrationConfig.pdpaConsentText}</span></span>
                  </label>
                  <div className="flex items-center gap-3 pt-1">
                    {regForm.partnerPhotoUrl ? (
                      <img
                        src={regForm.partnerPhotoUrl}
                        alt="รูปนักกีฬาคนที่ 2"
                        className="w-12 h-12 rounded-lg object-cover border border-[#E2DFD5] dark:border-[#25354C]"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg border border-dashed border-[#C9C4B5] flex items-center justify-center text-[#525C6B]">
                        <Camera className="w-5 h-5" />
                      </div>
                    )}
                    <label className="min-h-[38px] px-3 rounded-lg border border-dashed border-[#156143] text-[#156143] dark:text-[#4ADE80] font-semibold inline-flex items-center gap-1.5 cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      <span>
                        {regForm.partnerPhotoUrl
                          ? 'เปลี่ยนรูปนักกีฬาคนที่ 2'
                          : 'อัปโหลดรูปนักกีฬาคนที่ 2 *'}
                      </span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="sr-only"
                        onChange={(e) => handlePhotoUpload(e, 'partnerPhotoUrl')}
                      />
                    </label>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium mb-1">เบอร์โทร *</label>
                  <input
                    required
                    value={regForm.phone}
                    onChange={(e) => setRegForm({ ...regForm, phone: e.target.value })}
                    className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">สโมสร</label>
                  <input
                    value={regForm.club}
                    onChange={(e) => setRegForm({ ...regForm, club: e.target.value })}
                    className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block font-medium mb-1">วันเกิด *</label>
                  <input required type="date" value={regForm.birthDate} onChange={(e) => setRegForm({ ...regForm, birthDate: e.target.value })} className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                </div>
                <div>
                  <label className="block font-medium mb-1">อีเมล</label>
                  <input type="email" value={regForm.email} onChange={(e) => setRegForm({ ...regForm, email: e.target.value })} className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                </div>
                <div>
                  <label className="block font-medium mb-1">สัญชาติ *</label>
                  <input required value={regForm.nationality} onChange={(e) => setRegForm({ ...regForm, nationality: e.target.value })} className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium mb-1">เลขบัตร/หนังสือเดินทาง (ไม่บังคับ)</label>
                  <input value={regForm.idDocumentNo} onChange={(e) => setRegForm({ ...regForm, idDocumentNo: e.target.value })} className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                </div>
                <div>
                  <label className="block font-medium mb-1">ผู้ติดต่อฉุกเฉิน (ชื่อ/เบอร์โทร) *</label>
                  <input required value={regForm.emergencyContact} onChange={(e) => setRegForm({ ...regForm, emergencyContact: e.target.value })} className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                </div>
              </div>
              <div>
                <label className="block font-medium mb-1">ที่อยู่ติดต่อ *</label>
                <textarea required rows={2} value={regForm.address} onChange={(e) => setRegForm({ ...regForm, address: e.target.value })} className="w-full p-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
              </div>
              <div>
                <label className="block font-medium mb-1">
                  ลิงก์วิดีโอประเมินระดับมือ (YouTube / Drive / TikTok · Optional)
                </label>
                <div className="relative">
                  <Link2 className="w-4 h-4 text-[#525C6B] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="url"
                    value={regForm.skillVideoUrl}
                    onChange={(e) => setRegForm({ ...regForm, skillVideoUrl: e.target.value })}
                    placeholder="https://youtube.com/watch?v=..."
                    className="w-full min-h-[40px] pl-9 pr-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium mb-1">ข้อมูลสุขภาพ/โรคประจำตัว (Optional · PDPA)</label>
                <input
                  value={regForm.healthInfo}
                  onChange={(e) => setRegForm({ ...regForm, healthInfo: e.target.value })}
                  placeholder="ระบุเฉพาะเมื่อจำเป็นเพื่อความปลอดภัยในสนาม"
                  className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                />
              </div>
              <label className="flex items-start gap-2.5 rounded-xl border border-[#BBDCCF] bg-[#F1FAF6] p-3 dark:border-[#24533F] dark:bg-[#10291E]">
                <input required type="checkbox" checked={regForm.pdpaConsent} onChange={(e) => setRegForm({ ...regForm, pdpaConsent: e.target.checked })} className="mt-0.5" />
                <span><strong className="block">ยืนยันความยินยอม PDPA *</strong><span className="mt-1 block text-[11px] leading-5 text-[#526071] dark:text-[#B9C4D3]">{tournament.registrationConfig.pdpaConsentText}</span></span>
              </label>
              </>}

              <div>
                <label className="block font-medium mb-1">ลิงก์วิดีโอประเมินระดับมือ (YouTube / Drive / TikTok · Optional)</label>
                <div className="relative">
                  <Link2 className="w-4 h-4 text-[#525C6B] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input type="url" value={regForm.skillVideoUrl} onChange={(e) => setRegForm({ ...regForm, skillVideoUrl: e.target.value })} placeholder="https://youtube.com/watch?v=..." className="w-full min-h-[40px] pl-9 pr-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" />
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-[#E2DFD5] dark:border-[#25354C] flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowStaffReg(false)}
                className="min-h-[40px] px-4 rounded-lg border border-[#E2DFD5] text-xs font-medium"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={!selectedDivision || !regForm.pdpaConsent || (effectiveFormat === 'doubles' && !regForm.partnerPdpaConsent)}
                className="min-h-[40px] px-5 rounded-lg bg-[#156143] text-white text-xs font-semibold disabled:opacity-45"
              >
                บันทึกใบสมัคร
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Public Registration & Status Check QR + Links Modal */}
      {showOnlineLinksModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-none border border-[#E2DFD5] bg-white shadow-2xl dark:border-[#25354C] dark:bg-[#131E2E] sm:max-h-[90vh] sm:rounded-2xl lg:max-w-5xl">
            <div className="px-5 py-3.5 bg-[#156143] text-white flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-[11px] opacity-85">ลิงก์และ QR Code สำหรับบุคคลภายนอก</div>
                <div className="text-sm font-bold truncate">{tournament.name}</div>
              </div>
              <button
                type="button"
                onClick={() => setShowOnlineLinksModal(false)}
                className="p-1.5 rounded-lg hover:bg-white/10"
                aria-label="ปิดหน้าต่าง"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              <div
                className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2 ${
                  regWindow.isOpen
                    ? 'bg-[#ECFDF3] dark:bg-[#0E2E1D] border-[#BBF7D0] dark:border-[#1E593A] text-[#14532D] dark:text-[#86EFAC]'
                    : 'bg-[#FEF2F2] dark:bg-[#2B1416] border-[#FECACA] dark:border-[#5E2025] text-[#B91C1C] dark:text-[#F87171]'
                }`}
              >
                <div className="flex items-center gap-2 font-semibold">
                  {regWindow.isOpen ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <CalendarClock className="w-4 h-4 shrink-0" />
                  )}
                  <span>
                    {regWindow.isOpen
                      ? 'ระบบรับสมัครออนไลน์กำลังเปิดใช้งาน'
                      : `ปิดรับสมัครออนไลน์ (${regWindow.reason})`}
                  </span>
                </div>
                <span className="text-[11px] opacity-90">
                  ช่วงรับสมัคร:{' '}
                  {formatThaiDateTimeRange(
                    tournament.registrationConfig.openAt,
                    tournament.registrationConfig.closeAt
                  )}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. Public Online Registration */}
                <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] p-4 flex flex-col items-center text-center space-y-3">
                  <div className="space-y-1">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#156143]/15 text-[#156143] dark:text-[#4ADE80] text-[11px] font-semibold">
                      1. หน้าสมัครออนไลน์
                    </span>
                    <h4 className="text-sm font-bold text-[#141D2B] dark:text-[#F3F5F8]">
                      QR & ลิงก์กรอกใบสมัคร + ชำระเงิน
                    </h4>
                    <p className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
                      สำหรับนักกีฬาภายนอกกรอกข้อมูล อัปโหลดโลโก้ทีม รูปนักกีฬา ลิงก์วิดีโอประเมินมือ และสลิปโอนเงิน
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-white border border-[#E2DFD5]">
                    <QRCodeMatrix value={publicRegisterUrl} size={156} />
                  </div>

                  <div className="w-full p-2.5 rounded-lg bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] text-[11px] font-mono break-all text-left text-[#525C6B] dark:text-[#9AA8BC]">
                    {publicRegisterUrl}
                  </div>

                  <div className="w-full flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(publicRegisterUrl);
                        notify('success', 'คัดลอกลิงก์หน้าสมัครออนไลน์แล้ว');
                      }}
                      className="flex-1 min-h-[42px] px-3 rounded-lg bg-[#156143] hover:bg-[#104D35] text-white font-semibold inline-flex items-center justify-center gap-1.5"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>คัดลอกลิงก์</span>
                    </button>
                    <a
                      href={publicRegisterUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[42px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>เปิดหน้า</span>
                    </a>
                  </div>
                </div>

                {/* 2. Public Status & Bracket Lookup */}
                <div className="rounded-xl border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] p-4 flex flex-col items-center text-center space-y-3">
                  <div className="space-y-1">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#142642]/15 dark:bg-[#25354C] text-[#142642] dark:text-[#93C5FD] text-[11px] font-semibold">
                      2. หน้าตรวจสอบสถานะ & สายแข่ง
                    </span>
                    <h4 className="text-sm font-bold text-[#141D2B] dark:text-[#F3F5F8]">
                      QR & ลิงก์ดูข้อมูลส่วนตัวทีม
                    </h4>
                    <p className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
                      ผู้สมัครใช้รหัสตรวจสอบดูสถานะอนุมัติ สถานะชำระเงิน (แนบสลิปเพิ่มได้) ตารางแข่ง และสายการแข่งขัน
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-white border border-[#E2DFD5]">
                    <QRCodeMatrix value={publicStatusUrl} size={156} />
                  </div>

                  <div className="w-full p-2.5 rounded-lg bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] text-[11px] font-mono break-all text-left text-[#525C6B] dark:text-[#9AA8BC]">
                    {publicStatusUrl}
                  </div>

                  <div className="w-full flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(publicStatusUrl);
                        notify('success', 'คัดลอกลิงก์หน้าตรวจสอบสถานะแล้ว');
                      }}
                      className="flex-1 min-h-[42px] px-3 rounded-lg bg-[#142642] hover:bg-[#1E355C] text-white font-semibold inline-flex items-center justify-center gap-1.5"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>คัดลอกลิงก์</span>
                    </button>
                    <a
                      href={publicStatusUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[42px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>เปิดหน้า</span>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDirectorOnlineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-[#E2DFD5] bg-white p-5 text-center shadow-2xl dark:border-[#25354C] dark:bg-[#131E2E]">
            <div className="flex items-center justify-between"><div className="text-left"><h3 className="text-base font-bold">QR สมัครกรรมการออนไลน์</h3><p className="mt-1 text-[11px] text-[#667085] dark:text-[#9AA8BC]">สมัครฟรี · เอกสารแนบไม่บังคับ · ต้องรออนุมัติก่อนเข้าสู่ระบบ</p></div><button type="button" onClick={() => setShowDirectorOnlineModal(false)} className="p-2"><X className="h-5 w-5" /></button></div>
            <div className="mx-auto mt-5 w-fit rounded-xl border border-[#E2DFD5] bg-white p-3"><QRCodeMatrix value={publicDirectorApplyUrl} size={210} /></div>
            <div className="mt-4 break-all rounded-lg bg-[#F7F6F2] p-3 text-left font-mono text-[11px] dark:bg-[#0B121C]">{publicDirectorApplyUrl}</div>
            <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => { navigator.clipboard?.writeText(publicDirectorApplyUrl); notify('success', 'คัดลอกลิงก์สมัครกรรมการแล้ว'); }} className="min-h-10 rounded-lg border border-[#D8D5CC] text-xs font-bold"><Copy className="mr-1 inline h-4 w-4" />คัดลอกลิงก์</button><a href={publicDirectorApplyUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-[#156143] text-xs font-bold text-white"><ExternalLink className="h-4 w-4" />เปิดหน้าสมัคร</a></div>
          </div>
        </div>
      )}

      {/* Edit player information / Withdraw Modal */}
      {editPlayer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-modal="true">
          <div className="flex max-h-[100dvh] w-full max-w-5xl flex-col overflow-hidden rounded-none border border-[#E2DFD5] bg-white shadow-2xl dark:border-[#25354C] dark:bg-[#131E2E] sm:max-h-[92vh] sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-[#E2DFD5] p-4 dark:border-[#25354C] sm:px-6">
              <div><h3 className="text-base font-bold">แก้ไขข้อมูลสมาชิก</h3><p className="text-xs text-[#667085]">รหัสดูสถานะ {editPlayer.registrationCode} · ไม่เปลี่ยนระดับมือจากหน้านี้</p></div>
              <button onClick={() => setEditPlayer(null)} className="rounded-lg p-2 hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-5 overflow-y-auto p-4 text-xs sm:p-6">
              <section className="space-y-4 rounded-xl border border-[#E2DFD5] p-4 dark:border-[#25354C]">
                <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
                  <div className="flex items-center justify-center rounded-xl border border-dashed border-[#C9C4B5] bg-[#F7F6F2] p-2 dark:border-[#2C3E57] dark:bg-[#0B121C]">
                    {editPlayer.teamLogoUrl ? (
                      <a href={editPlayer.teamLogoUrl} target="_blank" rel="noreferrer" title="เปิดดูโลโก้ขนาดเต็ม">
                        <img src={editPlayer.teamLogoUrl} alt={`โลโก้ ${editPlayer.teamName}`} className="h-24 w-24 rounded-xl object-cover" />
                      </a>
                    ) : <ImageIcon className="h-8 w-8 text-[#667085]" />}
                  </div>
                  <div className="space-y-3">
                    <label className="block font-semibold">ชื่อทีม *
                      <input required value={editPlayer.teamName} onChange={(e) => setEditPlayer({ ...editPlayer, teamName: e.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-[#E2DFD5] bg-[#F7F6F2] px-3 dark:border-[#25354C] dark:bg-[#0B121C]" />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[#156143] px-3 font-semibold text-[#156143] dark:text-[#4ADE80]">
                        <Upload className="h-3.5 w-3.5" />{editPlayer.teamLogoUrl ? 'เปลี่ยนโลโก้ทีม' : 'อัปโหลดโลโก้ทีม'}
                        <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => handleEditImageUpload(event, 'teamLogoUrl')} />
                      </label>
                      {editPlayer.teamLogoUrl && <a href={editPlayer.teamLogoUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-lg border px-3 font-semibold"><ExternalLink className="h-3.5 w-3.5" />เปิดรูป</a>}
                    </div>
                  </div>
                </div>
                <label className="block font-semibold">ลิงก์วิดีโอประเมินระดับมือ
                  <div className="mt-1 flex gap-2">
                    <input type="url" value={editPlayer.skillVideoUrl || ''} onChange={(e) => setEditPlayer({ ...editPlayer, skillVideoUrl: e.target.value })} placeholder="https://..." className="min-h-10 min-w-0 flex-1 rounded-lg border border-[#E2DFD5] bg-[#F7F6F2] px-3 dark:border-[#25354C] dark:bg-[#0B121C]" />
                    {editPlayer.skillVideoUrl && <a href={editPlayer.skillVideoUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-1 rounded-lg border px-3"><ExternalLink className="h-3.5 w-3.5" />เปิดลิงก์</a>}
                  </div>
                </label>
                <div className="grid gap-2 text-[11px] text-[#667085] sm:grid-cols-3">
                  <span>ประเภท: {editPlayer.format === 'doubles' ? 'คู่' : 'เดี่ยว'}</span>
                  <span>แหล่งสมัคร: {editPlayer.registrationSource === 'online' ? 'ออนไลน์' : 'เจ้าหน้าที่'}</span>
                  <span>สมัครเมื่อ: {formatThaiDateTime(editPlayer.registeredAt)}</span>
                </div>
              </section>
              <div className={`grid gap-4 ${editPlayer.format === 'doubles' ? 'lg:grid-cols-2' : ''}`}>
                {(editPlayer.members || []).map((member, index) => (
                  <section key={`${member.role}-${index}`} className={index === 0 ? 'rounded-xl border border-[#BBDCCF] bg-[#F8FCFA] p-3 dark:border-[#24533F] dark:bg-[#10291E]/40' : 'rounded-xl border border-[#C9D5EA] bg-[#F7FAFF] p-3 dark:border-[#2F4568] dark:bg-[#142642]/35'}>
                    <AthleteRegistrationFields
                      athleteNumber={(index + 1) as 1 | 2}
                      values={athleteEditValues(member)}
                      pdpaText={tournament.registrationConfig.pdpaConsentText}
                      compact
                      onChange={(field, value) => updateEditMember(index, field, value)}
                      onPhotoChange={(event) => handleEditImageUpload(event, index === 0 ? 'primary' : 'partner')}
                    />
                    {member.photoUrl && <a href={member.photoUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 font-semibold text-[#156143] dark:text-[#4ADE80]"><ExternalLink className="h-3.5 w-3.5" />เปิดรูปนักกีฬาขนาดเต็ม</a>}
                    <label className="mt-3 flex items-start gap-2 rounded-lg border border-[#E2DFD5] bg-white p-3 dark:border-[#25354C] dark:bg-[#131E2E]">
                      <input type="checkbox" checked={Boolean(member.healthConsent)} onChange={(event) => setEditPlayer((current) => {
                        if (!current) return current;
                        const members = [...(current.members || [])];
                        members[index] = { ...members[index], healthConsent: event.target.checked };
                        return { ...current, members };
                      })} />
                      <span><strong className="block">ยินยอมให้ใช้ข้อมูลสุขภาพเพื่อความปลอดภัย</strong><span className="text-[11px] text-[#667085]">ข้อมูลนี้แสดงเฉพาะเจ้าหน้าที่ที่มีสิทธิ์</span></span>
                    </label>
                  </section>
                ))}
              </div>
              {(editPlayer.slipImageUrl || editPlayer.slipTransferRef || editPlayer.notes) && (
                <section className="space-y-2 rounded-xl border border-[#E2DFD5] p-4 dark:border-[#25354C]">
                  <h4 className="font-bold">ข้อมูลเพิ่มเติมที่ผู้สมัครส่งมา</h4>
                  {editPlayer.notes && <div><span className="text-[#667085]">หมายเหตุ:</span> {editPlayer.notes}</div>}
                  {editPlayer.slipTransferRef && <div><span className="text-[#667085]">เลขอ้างอิงการโอน:</span> {editPlayer.slipTransferRef}</div>}
                  {editPlayer.slipImageUrl && <a href={editPlayer.slipImageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 font-semibold"><ExternalLink className="h-3.5 w-3.5" />เปิดหลักฐานการชำระเงิน</a>}
                </section>
              )}
            </div>
            <div className="flex flex-wrap justify-between gap-2 border-t border-[#E2DFD5] bg-[#F7F6F2] p-4 dark:border-[#25354C] dark:bg-[#0B121C] sm:px-6">
              <button
                onClick={async () => {
                  await handleUpdatePlayer(
                    editPlayer.id,
                    { withdrawn: true },
                    `ถอนตัวทีม ${editPlayer.teamName}`
                  );
                  setEditPlayer(null);
                }}
                className="min-h-[40px] px-3 rounded-lg border border-[#FECACA] text-[#B91C1C] font-semibold"
              >
                แจ้งถอนตัว (เลื่อน Waiting List)
              </button>
              <button
                onClick={async () => {
                  const members = editPlayer.members || [];
                  const primary = members[0];
                  const partner = members[1];
                  if (!primary?.firstName.trim() || !primary?.lastName.trim() || !primary?.phone.trim()) {
                    notify('error', 'กรุณากรอกชื่อ นามสกุล และเบอร์โทรของนักกีฬาคนที่ 1 ให้ครบ');
                    return;
                  }
                  if (editPlayer.format === 'doubles' && (!partner?.firstName.trim() || !partner?.lastName.trim() || !partner?.phone.trim())) {
                    notify('error', 'กรุณากรอกชื่อ นามสกุล และเบอร์โทรของนักกีฬาคนที่ 2 ให้ครบ');
                    return;
                  }
                  await handleUpdatePlayer(
                    editPlayer.id,
                    {
                      teamName: editPlayer.teamName,
                      teamLogoUrl: editPlayer.teamLogoUrl,
                      skillVideoUrl: editPlayer.skillVideoUrl,
                      firstName: primary.firstName, lastName: primary.lastName,
                      nickname: primary.nickname, gender: primary.gender, birthDate: primary.birthDate,
                      nationality: primary.nationality, idDocumentNo: primary.idDocumentNo,
                      address: primary.address, phone: primary.phone, email: primary.email,
                      club: primary.club, province: primary.province, shirtSize: primary.shirtSize,
                      photoUrl: primary.photoUrl, emergencyContact: primary.emergencyContact,
                      healthInfo: primary.healthInfo, healthConsent: primary.healthConsent, pdpaConsent: primary.pdpaConsent,
                      partnerName: partner ? `${partner.firstName} ${partner.lastName}`.trim() : undefined,
                      partnerFirstName: partner?.firstName, partnerLastName: partner?.lastName,
                      partnerNickname: partner?.nickname, partnerPhone: partner?.phone,
                      partnerEmail: partner?.email, partnerClub: partner?.club, partnerProvince: partner?.province,
                      partnerPhotoUrl: partner?.photoUrl,
                      members,
                    },
                    `อัปเดตข้อมูล ${editPlayer.teamName}`
                  );
                  setEditPlayer(null);
                }}
                className="min-h-[40px] px-4 rounded-lg bg-[#156143] text-white font-semibold"
              >
                บันทึกการเปลี่ยนแปลง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Staff Umpire Registration Modal */}
      {showUmpireModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleAddUmpire}
            className="w-full max-w-2xl rounded-none sm:rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] shadow-xl overflow-hidden max-h-[100dvh] sm:max-h-[90vh] flex flex-col lg:max-w-5xl"
          >
            <div className="p-4 border-b border-[#E2DFD5] dark:border-[#25354C] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">{editingUmpire ? 'แก้ไขข้อมูลกรรมการ' : 'รับลงทะเบียนกรรมการโดยเจ้าหน้าที่'}</h3>
                <p className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
                  {editingUmpire
                    ? 'ปรับข้อมูลติดต่อ คุณสมบัติ และรูปถ่ายกรรมการ'
                    : 'บันทึกประวัติกรรมการ อัปโหลดรูปถ่าย และออกรหัสเข้าแอป PWA 12 หลักอัตโนมัติ'}
                </p>
              </div>
              <button type="button" onClick={() => { setShowUmpireModal(false); setEditingUmpire(null); }} className="p-1.5 rounded-lg hover:bg-[#EFECE4] dark:hover:bg-[#1B293D]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3.5 overflow-y-auto text-xs">
              {/* Photo Upload */}
              <div className="p-3 rounded-xl bg-[#F7F6F2] dark:bg-[#0B121C] border border-[#E2DFD5] dark:border-[#25354C] flex items-center gap-3">
                {umpForm.photoUrl ? (
                  <img
                    src={umpForm.photoUrl}
                    alt="รูปกรรมการ"
                    className="w-16 h-16 rounded-xl object-cover border border-[#156143] shrink-0 bg-white"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-xl border border-dashed border-[#D9D5C9] dark:border-[#2C3E57] bg-white dark:bg-[#131E2E] flex items-center justify-center text-[#525C6B] shrink-0">
                    <Camera className="w-6 h-6" />
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="font-semibold text-[#141D2B] dark:text-[#F3F5F8]">
                    รูปถ่ายกรรมการ / Director
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="min-h-[34px] px-3 rounded-lg bg-[#142642] hover:bg-[#1E355C] text-white font-semibold inline-flex items-center gap-1.5 cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{umpForm.photoUrl ? 'เปลี่ยนรูปภาพ' : 'อัปโหลดรูปกรรมการ'}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="sr-only"
                        onChange={handleUmpirePhotoUpload}
                      />
                    </label>
                    {umpForm.photoUrl && (
                      <>
                        <a href={umpForm.photoUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border px-2.5 font-medium"><ExternalLink className="h-3.5 w-3.5" />เปิดรูป</a>
                        <button
                          type="button"
                          onClick={() => setUmpForm((prev) => ({ ...prev, photoUrl: '' }))}
                          className="min-h-[34px] px-2.5 rounded-lg border border-[#FECACA] text-[#B91C1C] dark:text-[#F87171] font-medium"
                        >
                          ลบรูป
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {editingUmpire && (
                <div className="grid gap-3 rounded-xl border border-[#E2DFD5] bg-[#F7F6F2] p-3 dark:border-[#25354C] dark:bg-[#0B121C] sm:grid-cols-2">
                  <div className="space-y-1 text-[11px]">
                    <div><span className="text-[#667085]">ช่องทางสมัคร:</span> {editingUmpire.applicationSource === 'online' ? 'ออนไลน์' : 'เจ้าหน้าที่'}</div>
                    <div><span className="text-[#667085]">วันที่สมัคร:</span> {editingUmpire.appliedAt ? formatThaiDateTime(editingUmpire.appliedAt) : '-'}</div>
                    <div><span className="text-[#667085]">สถานะอนุมัติ:</span> {editingUmpire.approvalStatus || '-'}</div>
                    {editingUmpire.approvalNote && <div><span className="text-[#667085]">หมายเหตุการอนุมัติ:</span> {editingUmpire.approvalNote}</div>}
                  </div>
                  <div className="flex items-center justify-start sm:justify-end">
                    {editingUmpire.documentFileId ? (
                      <a
                        href={`/api/tournament/files/${encodeURIComponent(editingUmpire.documentFileId)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[#BBDCCF] bg-white px-3 font-semibold text-[#156143] dark:border-[#24533F] dark:bg-[#131E2E] dark:text-[#4ADE80]"
                      >
                        <ExternalLink className="h-4 w-4" />
                        เปิดเอกสารแนบ{editingUmpire.documentName ? ` · ${editingUmpire.documentName}` : ''}
                      </a>
                    ) : <span className="text-[11px] text-[#667085]">ไม่มีเอกสารแนบ</span>}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-medium mb-1">ชื่อจริง *</label>
                  <input
                    required
                    placeholder="เช่น สมศักดิ์"
                    value={umpForm.firstName}
                    onChange={(e) => setUmpForm({ ...umpForm, firstName: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">นามสกุล *</label>
                  <input
                    required
                    placeholder="เช่น ใจเที่ยง"
                    value={umpForm.lastName}
                    onChange={(e) => setUmpForm({ ...umpForm, lastName: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block font-medium mb-1">ชื่อเล่น</label>
                  <input
                    placeholder="เช่น ศักดิ์"
                    value={umpForm.nickname}
                    onChange={(e) => setUmpForm({ ...umpForm, nickname: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">เบอร์โทรติดต่อ *</label>
                  <input
                    required
                    placeholder="08x-xxx-xxxx"
                    value={umpForm.phone}
                    onChange={(e) => setUmpForm({ ...umpForm, phone: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">อีเมล</label>
                  <input
                    type="email"
                    placeholder="name@example.com"
                    value={umpForm.email}
                    onChange={(e) => setUmpForm({ ...umpForm, email: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-medium mb-1 flex items-center gap-1">
                    <Award className="w-3.5 h-3.5 text-[#156143]" />
                    <span>ระดับใบรับรองกรรมการ</span>
                  </label>
                  <select
                    value={umpForm.certification}
                    onChange={(e) => setUmpForm({ ...umpForm, certification: e.target.value })}
                    className="w-full min-h-[40px] px-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                  >
                    <option value="กรรมการสมาคมฯ ระดับ 1">กรรมการสมาคมฯ ระดับ 1</option>
                    <option value="กรรมการสมาคมฯ ระดับ 2">กรรมการสมาคมฯ ระดับ 2</option>
                    <option value="กรรมการภูมิภาค ระดับ 1">กรรมการภูมิภาค ระดับ 1</option>
                    <option value="ผู้ตัดสินชมรม / สโมสร">ผู้ตัดสินชมรม / สโมสร</option>
                    <option value="ผู้ตัดสินอิสระ">ผู้ตัดสินอิสระ</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium mb-1">สังกัดสโมสร / ชมรม</label>
                  <input
                    placeholder="ระบุชื่อสโมสร หรือ อิสระ"
                    value={umpForm.clubAffiliation}
                    onChange={(e) => setUmpForm({ ...umpForm, clubAffiliation: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                  />
                  <div className="mt-1 text-[10px] text-[#525C6B] dark:text-[#9AA8BC]">
                    ใช้ตรวจป้องกัน Conflict of Interest เวลาจัดคู่แข่งขัน
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div><label className="block font-medium mb-1">LINE ID</label><input value={umpForm.lineId} onChange={(e) => setUmpForm({ ...umpForm, lineId: e.target.value })} className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" /></div>
                <div><label className="block font-medium mb-1">ผู้ติดต่อฉุกเฉิน (ชื่อ/เบอร์โทร) *</label><input required value={umpForm.emergencyContact} onChange={(e) => setUmpForm({ ...umpForm, emergencyContact: e.target.value })} className="w-full min-h-[40px] px-3 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" /></div>
              </div>
              <div><label className="block font-medium mb-1">ที่อยู่ติดต่อ *</label><textarea required rows={2} value={umpForm.address} onChange={(e) => setUmpForm({ ...umpForm, address: e.target.value })} className="w-full p-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]" /></div>

              <div>
                <label className="block font-medium mb-1">ประวัติ / ประสบการณ์ตัดสินที่ผ่านมา</label>
                <textarea
                  rows={2}
                  placeholder="ระบุรายการที่เคยปฏิบัติหน้าที่หรือความถนัดเพิ่มเติม..."
                  value={umpForm.experienceNote}
                  onChange={(e) => setUmpForm({ ...umpForm, experienceNote: e.target.value })}
                  className="w-full p-2.5 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C]"
                />
              </div>
              <label className="flex items-start gap-2.5 rounded-xl border border-[#BBDCCF] bg-[#F1FAF6] p-3 dark:border-[#24533F] dark:bg-[#10291E]">
                <input required={!editingUmpire} type="checkbox" checked={umpForm.pdpaConsent} onChange={(e) => setUmpForm({ ...umpForm, pdpaConsent: e.target.checked })} className="mt-0.5" />
                <span><strong className="block">ยืนยันความยินยอม PDPA *</strong><span className="mt-1 block text-[11px] leading-5 text-[#526071] dark:text-[#B9C4D3]">{tournament.registrationConfig.pdpaConsentText}</span></span>
              </label>
            </div>

            <div className="p-4 border-t border-[#E2DFD5] dark:border-[#25354C] bg-[#F7F6F2] dark:bg-[#0B121C] flex items-center justify-between gap-2 text-xs">
              <span className="text-[11px] text-[#525C6B] dark:text-[#9AA8BC]">
                {editingUmpire ? 'แก้ไขข้อมูลโดยไม่เปลี่ยนรหัสเข้าใช้เดิม' : 'อนุมัติพร้อมเปิดใช้รหัส 12 หลักทันที'}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setShowUmpireModal(false); setEditingUmpire(null); }}
                  className="min-h-[40px] px-4 rounded-lg border border-[#E2DFD5] dark:border-[#25354C] bg-white dark:bg-[#131E2E] font-medium"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={!editingUmpire && !umpForm.pdpaConsent}
                  className="min-h-[40px] px-4 rounded-lg bg-[#156143] hover:bg-[#104D35] text-white font-semibold disabled:opacity-45"
                >
                  {editingUmpire ? 'บันทึกการแก้ไข' : 'ลงทะเบียนกรรมการและสร้างรหัส 12 หลัก'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Umpire History Modal */}
      {historyUmpire && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">
                ประวัติการตัดสิน: {historyUmpire.firstName} {historyUmpire.lastName}
              </h3>
              <button onClick={() => setHistoryUmpire(null)} className="p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            {historyUmpire.history.length === 0 ? (
              <p className="text-[#525C6B] py-4 text-center">ยังไม่มีบันทึกการตัดสินในรายการนี้</p>
            ) : (
              <ul className="divide-y divide-[#E2DFD5] dark:divide-[#25354C]">
                {historyUmpire.history.map((h, i) => (
                  <li key={i} className="py-2 flex justify-between gap-2">
                    <span>
                      <strong>{h.matchCode}</strong> · {h.note}
                    </span>
                    <span className="font-mono text-[#525C6B]">{h.date}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {/* Umpire QR Code Modal for Standalone PWA */}
      {qrUmpire && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" role="dialog">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-5 space-y-4 text-center">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">
                QR แอปกรรมการ: {qrUmpire.firstName} {qrUmpire.lastName}
              </h3>
              <button onClick={() => setQrUmpire(null)} className="p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
              สแกนเพื่อเปิดเว็บแอปกรรมการแบบเต็มจอแยกจากเว็บหลัก (PWA) พร้อมแนบรหัส 12 หลัก
            </p>
            <div className="flex justify-center">
              <QRCodeMatrix
                value={`${
                  typeof window !== 'undefined' ? window.location.origin : 'https://livematch.th'
                }/?mode=umpire&code=${qrUmpire.loginCode12}`}
                size={164}
              />
            </div>
            <div className="p-2 rounded-lg bg-[#F7F6F2] dark:bg-[#0B121C] font-mono text-xs">
              รหัส 12 หลัก: {qrUmpire.loginCode12}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const url = `${window.location.origin}/?mode=umpire&code=${qrUmpire.loginCode12}`;
                  navigator.clipboard?.writeText(url);
                  notify('success', 'คัดลอกลิงก์เข้าแอปกรรมการแล้ว');
                }}
                className="flex-1 min-h-[42px] rounded-xl border border-[#E2DFD5] dark:border-[#25354C] text-xs font-semibold"
              >
                คัดลอกลิงก์
              </button>
              <a
                href={`/?mode=umpire&code=${qrUmpire.loginCode12}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 min-h-[42px] rounded-xl bg-[#156143] text-white text-xs font-semibold inline-flex items-center justify-center"
              >
                เปิดแอปกรรมการ
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
