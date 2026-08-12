<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import QRCode from "qrcode";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ClipboardList,
  Copy,
  Download,
  Eye,
  History,
  Plus,
  QrCode,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  UserRound,
  X,
  XCircle,
} from "@lucide/vue";
import { exportBookingAdminExcel } from "../adminExcelExport";

const props = defineProps(["apiRequest", "auth"]);
const AUTO_REFRESH_MS = 10000;
const today = new Date().toLocaleDateString("en-CA", {
  timeZone: "Asia/Bangkok",
});
const state = reactive({
  bookings: [],
  pendingReviews: [],
  closures: [],
  date: today,
  loading: false,
  error: "",
});
const settings = reactive({});
const savedScheduleSettings = reactive({});
const courts = ref([]);
const activeTab = ref("pending");
const settingsTab = ref("booking");
const editor = ref(null);
const review = ref(null);
const historyDetail = ref(null);
const qrModal = ref(false);
const qrDataUrl = ref("");
const qrStatus = ref("");
const settingsStatus = ref("");
const telegramCheckLoading = ref(false);
const telegramCheckResult = ref(null);
const telegramCheckError = ref("");
const lastUpdated = ref(null);
const scheduleScroll = ref(null);
const newCourt = reactive({ name: "", pricePerInterval: 100 });
const historyItems = ref([]);
const historyLoading = ref(false);
const historyPage = ref(1);
const historyPageSize = ref(20);
const historyTotal = ref(0);
const pendingPage = ref(1);
const pendingPageSize = 10;
const historyFilters = reactive({
  startDate: addDateDays(today, -30),
  endDate: addDateDays(today, 30),
  courtId: "",
  phone: "",
});
const exportFilters = reactive({
  startDate: today,
  endDate: today,
  status: "all",
});
const exportLoading = ref(false);
const exportStatus = ref("");
const incidents = reactive({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1, search: "", type: "", loading: false });
const slipOKQuota = reactive({ available: false, used: 0, remaining: 0, limit: 0, capReached: false, error: "" });
const actionBusy = reactive({ entry: false, reopen: false, review: false, settings: false, addCourt: false });
const courtBusy = reactive(new Set());
const adminToast = reactive({ message: "", tone: "success" });
let timer;
let adminToastTimer;
let settingsReady = false;
let overviewRequest = 0;
let memberSearchRequest = 0;

const tabs = computed(() => [
  {
    id: "pending",
    label: "รอตรวจสอบ",
    icon: ClipboardList,
    count: pendingBookings.value.length,
  },
  { id: "history", label: "ประวัติการจอง", icon: History },
  { id: "blacklist", label: "Blacklist", icon: ShieldCheck, count: incidents.total },
  { id: "export", label: "รายงาน", icon: Download },
  { id: "settings", label: "ตั้งค่า", icon: Settings },
]);

function showAdminToast(message, tone = "success") {
  adminToast.message = message;
  adminToast.tone = tone;
  clearTimeout(adminToastTimer);
  adminToastTimer = setTimeout(() => { adminToast.message = ""; }, 3500);
}

function setCourtBusy(id, busy) {
  if (busy) courtBusy.add(id);
  else courtBusy.delete(id);
}
const settingsTabs = [
  { id: "booking", label: "ตารางและกติกา" },
  { id: "payment", label: "การรับชำระ" },
  { id: "slipok", label: "Auto Slip" },
  { id: "display", label: "การแสดงผล" },
  { id: "courts", label: "จัดการสนาม" },
];
const pendingBookings = computed(() => {
  const groups = new Map();
  for (const booking of state.pendingReviews) {
    const key = booking.batchId || booking.id;
    if (!groups.has(key)) {
      groups.set(key, {
        ...booking,
        items: [booking],
        totalPriceThb: Number(booking.totalPriceThb || 0),
      });
      continue;
    }
    const group = groups.get(key);
    group.items.push(booking);
    group.totalPriceThb += Number(booking.totalPriceThb || 0);
    if (!group.slipData && booking.slipData) group.slipData = booking.slipData;
  }
  return [...groups.values()].map((group) => ({
    ...group,
    courtCount: new Set(group.items.map((item) => item.courtId)).size,
  }));
});
const activeCourts = computed(() => courts.value.filter((court) => court.active));
const pendingTotalPages = computed(() =>
  Math.max(1, Math.ceil(pendingBookings.value.length / pendingPageSize)),
);
const pagedPendingBookings = computed(() => {
  const start = (pendingPage.value - 1) * pendingPageSize;
  return pendingBookings.value.slice(start, start + pendingPageSize);
});
const historyTotalPages = computed(() =>
  Math.max(1, Math.ceil(historyTotal.value / historyPageSize.value)),
);
const displayDate = computed(() =>
  new Intl.DateTimeFormat("th-TH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${state.date}T12:00:00+07:00`)),
);
const selectedEditorCourt = computed(() =>
  courts.value.find((court) => court.id === editor.value?.courtId),
);
const editorSlots = computed(() => editor.value?.slots || []);
const selectedEditorCourts = computed(() => {
  const selectedIds = new Set(editor.value?.selectedCourtIds || []);
  for (const slot of editorSlots.value) selectedIds.add(slot.courtId);
  if (!selectedIds.size && editor.value?.courtId) selectedIds.add(editor.value.courtId);
  return courts.value.filter((court) => selectedIds.has(court.id));
});
const editorItems = computed(() => {
  const interval = Number(savedScheduleSettings.intervalMinutes || 60);
  const result = [];
  for (const court of activeCourts.value) {
    const minutes = editorSlots.value
      .filter((slot) => slot.courtId === court.id)
      .map((slot) => slot.minute)
      .sort((a, b) => a - b);
    for (const minute of minutes) {
      result.push({
        courtId: court.id,
        courtName: court.name,
        startMinute: minute,
        endMinute: minute + interval,
        startAt: localDateTime(minute),
        endAt: localDateTime(minute + interval),
      });
    }
  }
  return result;
});
const repeatDayCount = computed(() => {
  const start = editor.value?.repeatStartDate || state.date;
  const end = editor.value?.repeatEndDate || start;
  const startTime = new Date(`${start}T12:00:00Z`).getTime();
  const endTime = new Date(`${end}T12:00:00Z`).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime)
    return 0;
  return Math.floor((endTime - startTime) / 86400000) + 1;
});
const editorDailyTotal = computed(() =>
  editorSlots.value.reduce((sum, slot) => {
    const court = courts.value.find((item) => item.id === slot.courtId);
    return sum + Number(court?.pricePerInterval || 0);
  }, 0),
);
const repeatedEditorItems = computed(() => {
  const result = [];
  const startDate = editor.value?.repeatStartDate || state.date;
  for (let day = 0; day < repeatDayCount.value; day += 1) {
    const targetDate = addDateDays(startDate, day);
    for (const item of editorItems.value) {
      result.push({
        courtId: item.courtId,
        startAt: repeatDateTime(item.startAt, targetDate),
        endAt: repeatDateTime(item.endAt, targetDate),
      });
    }
  }
  return result;
});
const editorTotal = computed(() => editorDailyTotal.value * repeatDayCount.value);
const publicLink = computed(() =>
  savedScheduleSettings.publicToken
    ? `${window.location.origin}/booking/${savedScheduleSettings.publicToken}`
    : "",
);
const slots = computed(() => {
  const [openHour, openMinute] = String(
    savedScheduleSettings.openTime || "16:00",
  )
    .split(":")
    .map(Number);
  const [closeHour, closeMinute] = String(
    savedScheduleSettings.closeTime || "22:00",
  )
    .split(":")
    .map(Number);
  const start = openHour * 60 + openMinute;
  let end = closeHour * 60 + closeMinute;
  if (end <= start && savedScheduleSettings.allowOvernight) end += 1440;
  const result = [];
  for (
    let minute = start;
    minute < end;
    minute += Number(savedScheduleSettings.intervalMinutes || 60)
  )
    result.push(minute);
  return result;
});

function goBack() {
  window.location.assign("/");
}

function changeDate(days) {
  const [year, month, day] = state.date.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  state.date = date.toISOString().slice(0, 10);
  editor.value = null;
  review.value = null;
  if (scheduleScroll.value) scheduleScroll.value.scrollLeft = 0;
  loadOverview();
}

function goToday() {
  state.date = today;
  editor.value = null;
  review.value = null;
  if (scheduleScroll.value) scheduleScroll.value.scrollLeft = 0;
  loadOverview();
}

function openNewBooking() {
  const court = activeCourts.value[0];
  const minute = slots.value[0];
  if (court && minute !== undefined) openCell(court, minute);
}

function localDateTime(minute) {
  const date = new Date(`${state.date}T00:00:00+07:00`);
  date.setMinutes(minute);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(date)
    .replace(" ", "T");
}

function addDateDays(value, days) {
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function repeatDateTime(value, targetDate) {
  const sourceDate = String(value).slice(0, 10);
  const sourceTime = String(value).slice(11, 16);
  const sourceDay = new Date(`${sourceDate}T12:00:00Z`).getTime();
  const scheduleDay = new Date(`${state.date}T12:00:00Z`).getTime();
  const offsetDays = Math.round((sourceDay - scheduleDay) / 86400000);
  return `${addDateDays(targetDate, offsetDays)}T${sourceTime}`;
}

function timeLabel(minute) {
  return `${String(Math.floor((minute % 1440) / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function cell(court, minute) {
  const start = new Date(`${localDateTime(minute)}:00+07:00`).getTime();
  const end =
    start + Number(savedScheduleSettings.intervalMinutes || 60) * 60000;
  const booking = state.bookings.find(
    (item) =>
      ["hold", "pending_review", "confirmed"].includes(item.status) &&
      item.courtId === court.id &&
      new Date(item.startAt).getTime() < end &&
      new Date(item.endAt).getTime() > start,
  );
  if (booking)
    return {
      kind: "booking",
      item: booking,
      label: `${bookingStatusLabel(booking.status)}\n${booking.bookerName || "Admin"}`,
    };
  const closure = state.closures.find(
    (item) =>
      item.courtId === court.id &&
      new Date(item.startAt).getTime() < end &&
      new Date(item.endAt).getTime() > start,
  );
  if (closure)
    return {
      kind: "closure",
      item: closure,
      label: closure.note ? `ปิดสนาม\n${closure.note}` : "ปิดสนาม",
    };
  return { kind: "free", label: `ว่าง ฿${court.pricePerInterval}` };
}

function isEditorSlot(court, minute) {
  return editorSlots.value.some(
    (slot) => slot.courtId === court.id && slot.minute === minute,
  );
}

function cellClass(info, court, minute) {
  if (info.kind === "free" && isEditorSlot(court, minute))
    return "booking-state--selected";
  if (info.kind === "closure") return "booking-state--closed";
  if (info.item?.status === "pending_review")
    return "booking-state--pending";
  if (info.item?.status === "hold") return "booking-state--hold";
  if (info.kind === "booking") return "booking-state--busy";
  return "booking-state--free";
}

function applyOverview(
  data,
  includeConfiguration = false,
  replaceSettingsDraft = false,
) {
  state.bookings = data.bookings || [];
  state.pendingReviews = data.pendingReviews || state.bookings.filter(
    (booking) => booking.status === "pending_review",
  );
  state.closures = data.closures || [];
  pendingPage.value = Math.min(pendingPage.value, pendingTotalPages.value);
  if (includeConfiguration || !settingsReady) {
    Object.assign(savedScheduleSettings, data.settings || {});
    if (replaceSettingsDraft || !settingsReady)
      Object.assign(settings, data.settings || {});
    courts.value = (data.courts || []).map((court) => ({ ...court }));
    settingsReady = true;
  }
}

async function loadOverview(
  silent = false,
  includeConfiguration = false,
  replaceSettingsDraft = false,
) {
  const request = ++overviewRequest;
  const requestedDate = state.date;
  const previousScroll = scheduleScroll.value?.scrollLeft || 0;
  if (!silent) state.loading = true;
  state.error = "";
  try {
    const data = await props.apiRequest(
      `/api/admin/booking/overview?date=${state.date}`,
    );
    if (request !== overviewRequest) return;
    applyOverview(data, includeConfiguration, replaceSettingsDraft);
    requestAnimationFrame(() => {
      if (scheduleScroll.value && state.date === requestedDate)
        scheduleScroll.value.scrollLeft = previousScroll;
    });
    lastUpdated.value = new Date();
  } catch (error) {
    if (request === overviewRequest) state.error = error.message;
  } finally {
    if (!silent && request === overviewRequest) state.loading = false;
  }
}

async function loadHistory(page = historyPage.value) {
  historyPage.value = Math.max(1, Number(page) || 1);
  historyLoading.value = true;
  state.error = "";
  try {
    const params = new URLSearchParams({
      startDate: historyFilters.startDate,
      endDate: historyFilters.endDate,
      page: String(historyPage.value),
      pageSize: String(historyPageSize.value),
    });
    if (historyFilters.courtId) params.set("courtId", historyFilters.courtId);
    if (historyFilters.phone.trim())
      params.set("phone", historyFilters.phone.trim());
    const data = await props.apiRequest(
      `/api/admin/booking/history?${params.toString()}`,
    );
    historyItems.value = data.items || [];
    historyPage.value = data.page || historyPage.value;
    historyPageSize.value = data.pageSize || historyPageSize.value;
    historyTotal.value = data.total || 0;
  } catch (error) {
    state.error = error.message;
  } finally {
    historyLoading.value = false;
  }
}

function changeTab(tab) {
  activeTab.value = tab;
  editor.value = null;
  review.value = null;
  historyDetail.value = null;
  if (tab === "history") loadHistory();
}

function resetHistoryFilters() {
  Object.assign(historyFilters, {
    startDate: addDateDays(today, -30),
    endDate: addDateDays(today, 30),
    courtId: "",
    phone: "",
  });
  loadHistory(1);
}

async function downloadBookingExport() {
  state.error = "";
  exportStatus.value = "";
  if (
    !exportFilters.startDate ||
    !exportFilters.endDate ||
    exportFilters.endDate < exportFilters.startDate
  ) {
    state.error = "กรุณาเลือกช่วงวันที่ให้ถูกต้อง";
    return;
  }
  exportLoading.value = true;
  try {
    await exportBookingAdminExcel(props.apiRequest, exportFilters);
    exportStatus.value = "สร้างไฟล์ Excel สำเร็จ";
  } catch (error) {
    state.error = error.message;
  } finally {
    exportLoading.value = false;
  }
}

function bookingStatusLabel(status) {
  return (
    {
      hold: "กำลังจอง",
      pending_review: "รอตรวจสอบ",
      confirmed: "ยืนยันแล้ว",
      rejected: "ไม่อนุมัติ",
      cancelled: "ยกเลิก",
      expired: "หมดเวลา",
    }[status] || status
  );
}

function historyStatusClass(status) {
  if (status === "confirmed")
    return "bg-green-100 text-green-800 dark:bg-green-950/30 dark:text-green-200";
  if (status === "pending_review" || status === "hold")
    return "bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200";
  return "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300";
}

async function openQrModal() {
  if (!publicLink.value) return;
  qrStatus.value = "";
  qrDataUrl.value = await QRCode.toDataURL(publicLink.value, {
    width: 320,
    margin: 2,
    color: { dark: "#191b18", light: "#ffffff" },
  });
  qrModal.value = true;
}

async function copyLink() {
  if (!publicLink.value) return;
  try {
    await navigator.clipboard.writeText(publicLink.value);
    qrStatus.value = "คัดลอกลิงก์แล้ว";
  } catch {
    qrStatus.value = "คัดลอกอัตโนมัติไม่ได้ กรุณาคัดลอกจากช่องลิงก์";
  }
}

async function openCell(court, minute) {
  const info = cell(court, minute);
  if (info.kind === "booking") {
    review.value = {
      ...info.item,
      action: info.item.status === "pending_review" ? "approve" : "cancel",
      note: "",
    };
    return;
  }
  if (info.kind === "closure") {
    editor.value = { ...info.item, kind: "reopen" };
    return;
  }
  if (editor.value && editor.value.kind !== "reopen" && Array.isArray(editor.value.slots)) {
    const index = editor.value.slots.findIndex(
      (slot) => slot.courtId === court.id && slot.minute === minute,
    );
    if (index >= 0) editor.value.slots.splice(index, 1);
    else editor.value.slots.push({ courtId: court.id, minute });
    editor.value.selectedCourtIds = [
      ...new Set(editor.value.slots.map((slot) => slot.courtId)),
    ];
    if (!editor.value.slots.length) editor.value = null;
    return;
  }
  editor.value = {
    courtId: court.id,
    startAt: localDateTime(minute),
    endAt: localDateTime(
      minute + Number(savedScheduleSettings.intervalMinutes || 60),
    ),
    kind: "booking",
    memberId: "",
    memberQuery: "จองโดย Admin",
    memberComboOpen: false,
    memberOptions: [],
    slots: [{ courtId: court.id, minute }],
    selectedCourtIds: [court.id],
    repeatStartDate: state.date,
    repeatEndDate: state.date,
  };
}

function openHistoryDetail(booking) {
  historyDetail.value = booking;
}

async function searchMember() {
  const currentEditor = editor.value;
  const query = String(currentEditor?.memberQuery || "").trim();
  const request = ++memberSearchRequest;
  if (!currentEditor || query === "" || query === "จองโดย Admin") {
    if (currentEditor) currentEditor.memberOptions = [];
    return;
  }
  currentEditor.memberId = "";
  currentEditor.memberComboOpen = true;
  try {
    const data = await props.apiRequest(
      `/api/admin/members/search?q=${encodeURIComponent(query)}`,
    );
    if (request === memberSearchRequest && editor.value === currentEditor)
      currentEditor.memberOptions = data.items || [];
  } catch (error) {
    if (request === memberSearchRequest) state.error = error.message;
  }
}

function selectBookingMember(member = null) {
  if (!editor.value) return;
  editor.value.memberId = member?.id || "";
  editor.value.memberQuery = member
    ? `${member.phone} · ${member.name}`
    : "จองโดย Admin";
  editor.value.memberComboOpen = false;
}

async function createEntry() {
  if (actionBusy.entry) return;
  actionBusy.entry = true;
  try {
    if (!repeatDayCount.value)
      throw new Error("วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่มทำซ้ำ");
    if (repeatedEditorItems.value.length > 1000)
      throw new Error("รายการที่ทำซ้ำมากเกินไป กรุณาลดจำนวนวันหรือช่องเวลา");
    const payload = { ...editor.value, items: repeatedEditorItems.value };
    delete payload.slots;
    delete payload.selectedCourtIds;
    delete payload.repeatStartDate;
    delete payload.repeatEndDate;
    delete payload.memberQuery;
    delete payload.memberComboOpen;
    delete payload.memberOptions;
    if (editor.value.kind === "closure") {
      await props.apiRequest("/api/admin/booking/closures", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } else {
      await props.apiRequest("/api/admin/booking/bookings", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
    historyFilters.startDate = editor.value.repeatStartDate || state.date;
    historyFilters.endDate = editor.value.repeatEndDate || state.date;
    editor.value = null;
    await loadOverview();
    showAdminToast(payload.kind === "closure" ? "บันทึกการปิดสนามแล้ว" : "บันทึกการจองแล้ว");
  } catch (error) {
    state.error = error.message;
    showAdminToast(error.message || "บันทึกรายการไม่สำเร็จ", "error");
  } finally {
    actionBusy.entry = false;
  }
}

async function reopenClosure() {
  if (actionBusy.reopen) return;
  actionBusy.reopen = true;
  try {
    await props.apiRequest(`/api/admin/booking/closures/${editor.value.id}`, {
      method: "DELETE",
    });
    editor.value = null;
    await loadOverview();
    showAdminToast("เปิดช่วงเวลาสนามแล้ว");
  } catch (error) {
    state.error = error.message;
    showAdminToast(error.message || "เปิดช่วงเวลาไม่สำเร็จ", "error");
  } finally {
    actionBusy.reopen = false;
  }
}

async function submitReview() {
  if (actionBusy.review) return;
  actionBusy.review = true;
  const action = review.value?.action;
  try {
    await props.apiRequest(
      `/api/admin/booking/bookings/${review.value.id}/review`,
      {
        method: "POST",
        body: JSON.stringify({
          action: review.value.action,
          note: review.value.note || "",
        }),
      },
    );
    review.value = null;
    await loadOverview();
    showAdminToast(action === "approve" ? "อนุมัติการจองแล้ว" : action === "cancel" ? "ยกเลิกการจองแล้ว" : "ปฏิเสธการจองแล้ว");
  } catch (error) {
    state.error = error.message;
    showAdminToast(error.message || "บันทึกผลตรวจสอบไม่สำเร็จ", "error");
  } finally {
    actionBusy.review = false;
  }
}

async function saveSettings() {
  if (actionBusy.settings) return;
  actionBusy.settings = true;
  settingsStatus.value = "";
  try {
    const payload = { ...settings };
    if (payload.logoData === savedScheduleSettings.logoData)
      delete payload.logoData;
    if (payload.popupImage === savedScheduleSettings.popupImage)
      delete payload.popupImage;
    await props.apiRequest("/api/admin/booking/settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    settingsStatus.value = "บันทึกการตั้งค่าแล้ว";
    await loadOverview(false, true, true);
    await loadSlipOKQuota();
    showAdminToast("บันทึกการตั้งค่าแล้ว");
  } catch (error) {
    state.error = error.message;
    showAdminToast(error.message || "บันทึกการตั้งค่าไม่สำเร็จ", "error");
  } finally {
    actionBusy.settings = false;
  }
}

async function loadSlipOKQuota() {
  try { Object.assign(slipOKQuota, await props.apiRequest('/api/admin/booking/slipok-quota')); }
  catch (error) { slipOKQuota.error = error.message || 'ตรวจสอบโควตาไม่สำเร็จ'; }
}

async function checkTelegramConnection() {
  telegramCheckLoading.value = true;
  telegramCheckError.value = "";
  telegramCheckResult.value = null;
  try {
    telegramCheckResult.value = await props.apiRequest('/api/admin/booking/telegram-check', {
      method: 'POST',
      body: JSON.stringify({ botToken: settings.telegramBotToken || '' }),
    });
  } catch (error) {
    telegramCheckError.value = error.message || 'ตรวจสอบ Telegram ไม่สำเร็จ';
  } finally {
    telegramCheckLoading.value = false;
  }
}

async function loadIncidents(page = incidents.page) {
  incidents.loading = true;
  try {
    const params = new URLSearchParams({ page, pageSize: incidents.pageSize, search: incidents.search, type: incidents.type });
    Object.assign(incidents, await props.apiRequest(`/api/admin/booking/blacklist?${params}`));
  } catch (error) { state.error = error.message; }
  finally { incidents.loading = false; }
}

async function addCourt() {
  if (actionBusy.addCourt) return;
  actionBusy.addCourt = true;
  try {
    await props.apiRequest("/api/admin/booking/courts", {
      method: "POST",
      body: JSON.stringify(newCourt),
    });
    newCourt.name = "";
    await loadOverview(false, true);
    showAdminToast("เพิ่มสนามแล้ว");
  } catch (error) {
    state.error = error.message;
    showAdminToast(error.message || "เพิ่มสนามไม่สำเร็จ", "error");
  } finally {
    actionBusy.addCourt = false;
  }
}

async function updateCourt(court) {
  if (courtBusy.has(court.id)) return;
  setCourtBusy(court.id, true);
  try {
    await props.apiRequest(`/api/admin/booking/courts/${court.id}`, {
      method: "PATCH",
      body: JSON.stringify(court),
    });
    await loadOverview(false, true);
    showAdminToast(`บันทึก ${court.name} แล้ว`);
  } catch (error) {
    state.error = error.message;
    await loadOverview(false, true);
    showAdminToast(error.message || "บันทึกสนามไม่สำเร็จ", "error");
  } finally {
    setCourtBusy(court.id, false);
  }
}

async function deleteCourt(court) {
  if (courtBusy.has(court.id)) return;
  if (!window.confirm(`ลบ ${court.name}? หากสนามนี้มีประวัติใช้งาน ระบบจะปิดใช้งานแทน`)) return;
  setCourtBusy(court.id, true);
  try {
    const result = await props.apiRequest(`/api/admin/booking/courts/${court.id}`, {
      method: "DELETE",
    });
    settingsStatus.value = result.hardDeleted
      ? `ลบ ${court.name} แล้ว`
      : `สนาม ${court.name} มีประวัติใช้งาน จึงปิดใช้งานแทน`;
    await loadOverview(false, true);
    showAdminToast(settingsStatus.value);
  } catch (error) {
    state.error = error.message;
    showAdminToast(error.message || "ลบสนามไม่สำเร็จ", "error");
  } finally {
    setCourtBusy(court.id, false);
  }
}

function fileData(event, key, maxSize) {
  const file = event.target.files?.[0];
  if (!file || file.size > maxSize) {
    state.error = "ไฟล์ใหญ่เกินกำหนด";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    settings[key] = reader.result;
  };
  reader.readAsDataURL(file);
}

const refreshOnFocus = () => loadOverview(true, false);
onMounted(async () => {
  await loadOverview(false, true, true);
  await Promise.all([loadSlipOKQuota(), loadIncidents(1)]);
  timer = window.setInterval(() => loadOverview(true, false), AUTO_REFRESH_MS);
  window.addEventListener("focus", refreshOnFocus);
});
onUnmounted(() => {
  window.clearInterval(timer);
  window.clearTimeout(adminToastTimer);
  memberSearchRequest += 1;
  window.removeEventListener("focus", refreshOnFocus);
});
</script>

<template>
  <section
    class="mx-auto grid max-w-[1500px] gap-4 p-4 text-stone-900 dark:text-stone-100"
  >
    <div v-if="adminToast.message" class="fixed right-4 top-4 z-[100] flex max-w-sm items-center gap-3 rounded-xl px-4 py-3 font-bold text-white shadow-2xl" :class="adminToast.tone === 'error' ? 'bg-red-600' : 'bg-court-600'" role="status">
      <CheckCircle2 v-if="adminToast.tone !== 'error'" class="h-5 w-5 shrink-0" /><XCircle v-else class="h-5 w-5 shrink-0" />{{ adminToast.message }}
    </div>
    <header class="booking-command-bar">
      <div class="flex min-w-0 items-center gap-3">
        <button
          class="booking-icon-button"
          aria-label="กลับ Admin dashboard"
          @click="goBack"
        >
          <ArrowLeft class="h-5 w-5" />
        </button>
        <img
          v-if="auth?.branding?.logoData"
          :src="auth.branding.logoData"
          alt="โลโก้ระบบ"
          class="h-10 w-10 shrink-0 rounded-lg border border-stone-200 bg-white object-cover dark:border-stone-700"
        />
        <div class="min-w-0">
          <p
            class="text-xs font-black uppercase tracking-[0.16em] text-court-700"
          >
            ระบบจองสนาม {{ auth?.branding?.systemName || 'LiveMatch' }}
          </p>
          <h1 class="truncate text-xl font-black sm:text-2xl">
            ศูนย์จัดการตารางจองสนาม
          </h1>
        </div>
      </div>

      <div class="booking-date-control">
        <button
          type="button"
          class="booking-date-arrow"
          aria-label="วันก่อนหน้า"
          @click="changeDate(-1)"
        >
          &lt;
        </button>
        <label class="booking-date-label">
          <CalendarDays class="h-5 w-5 text-court-700" />
          <span class="hidden font-black md:inline">{{ displayDate }}</span>
          <input
            v-model="state.date"
            type="date"
            class="booking-date-input"
            aria-label="วันที่แสดงตาราง"
            @change="loadOverview()"
          />
        </label>
        <button
          type="button"
          class="booking-date-arrow"
          aria-label="วันถัดไป"
          @click="changeDate(1)"
        >
          &gt;
        </button>
        <button type="button" class="booking-today-button" @click="goToday">
          วันนี้
        </button>
      </div>

      <div class="booking-command-actions flex items-center justify-end gap-2">
        <span
          v-if="lastUpdated"
          class="hidden items-center gap-1.5 text-xs font-bold text-stone-500 xl:inline-flex"
        >
          <span class="h-2 w-2 rounded-full bg-court-500"></span>
          อัปเดต
          {{
            lastUpdated.toLocaleTimeString("th-TH", {
              hour: "2-digit",
              minute: "2-digit",
            })
          }}
        </span>
        <button
          class="booking-secondary-button"
          :disabled="state.loading"
          @click="loadOverview()"
        >
          <RefreshCw class="h-4 w-4" :class="state.loading && 'animate-spin'" />
          <span class="hidden sm:inline">รีเฟรชตาราง</span>
        </button>
        <button class="booking-secondary-button" @click="openQrModal">
          <QrCode class="h-4 w-4" /><span class="hidden sm:inline"
            >QR/ลิงก์</span
          >
        </button>
        <button class="booking-primary-button" @click="openNewBooking">
          <Plus class="h-4 w-4" />สร้างการจอง
        </button>
      </div>
    </header>
    <p
      v-if="state.error"
      class="rounded-xl bg-red-50 p-3 font-bold text-red-700 dark:bg-red-950/30 dark:text-red-200"
    >
      {{ state.error }}
    </p>

    <div
      class="booking-workspace"
      :class="editor && 'booking-workspace--inspecting'"
    >
      <section
        class="min-w-0 overflow-hidden rounded-[1.15rem] border bg-white dark:border-stone-700 dark:bg-stone-900"
      >
        <div
          class="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"
        >
          <div>
            <p
              class="text-xs font-black uppercase tracking-[0.14em] text-court-700"
            >
              ตารางประจำวัน
            </p>
            <h2 class="text-lg font-black">ตารางการจองสนาม</h2>
          </div>
          <p class="text-sm font-bold text-stone-500">
            {{ savedScheduleSettings.openTime || "16:00" }}–{{
              savedScheduleSettings.closeTime || "22:00"
            }}
            · ช่องละ {{ savedScheduleSettings.intervalMinutes || 60 }} นาที
          </p>
        </div>
        <div ref="scheduleScroll" class="max-w-full overflow-x-auto overscroll-x-contain">
          <table class="w-full min-w-[720px] border-collapse">
            <thead>
              <tr class="booking-table-head">
                <th class="sticky left-0 z-10 min-w-28 p-3">เวลา / สนาม</th>
                <th
                  v-for="court in activeCourts"
                  :key="court.id"
                  class="min-w-32 p-3"
                >
                  {{ court.name }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="minute in slots"
                :key="minute"
                class="border-b dark:border-stone-700"
              >
                <th class="booking-time-cell">{{ timeLabel(minute) }} น.</th>
                <td v-for="court in activeCourts" :key="court.id" class="p-1.5">
                  <button
                    class="booking-slot"
                    :class="cellClass(cell(court, minute), court, minute)"
                    :title="cell(court, minute).item?.note || ''"
                    @click="openCell(court, minute)"
                  >
                    {{ cell(court, minute).label }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div
          class="flex flex-wrap items-center gap-x-5 gap-y-2 border-t px-4 py-3 text-xs font-bold text-stone-500"
        >
          <span class="inline-flex items-center gap-2"><i class="legend-dot legend-dot--free"></i>ว่าง</span>
          <span class="inline-flex items-center gap-2"><i class="legend-dot legend-dot--hold"></i>กำลังจอง</span>
          <span class="inline-flex items-center gap-2"><i class="legend-dot legend-dot--pending"></i>รอตรวจสอบ</span>
          <span class="inline-flex items-center gap-2"><i class="legend-dot legend-dot--busy"></i>จองแล้ว</span>
          <span class="inline-flex items-center gap-2"><i class="legend-dot legend-dot--closed"></i>ปิดสนาม</span>
          <span class="ml-auto hidden text-court-700 md:inline"
            >คลิกช่องเวลาเพื่อสร้างหรือจัดการรายการ</span
          >
        </div>
      </section>

      <aside v-if="editor" class="booking-inspector" role="dialog" aria-modal="true" aria-labelledby="booking-inspector-title" @keydown.esc="closeEditor">
        <div class="flex items-start justify-between gap-3 border-b pb-4">
          <div>
            <p
              class="text-xs font-black uppercase tracking-[0.14em] text-court-700"
            >
              จัดการรายการ
            </p>
            <h2 id="booking-inspector-title" class="mt-1 text-xl font-black">
              {{
                review
                  ? "รายละเอียดการจอง"
                  : editor?.kind === "reopen"
                    ? "ช่วงเวลาปิดสนาม"
                    : "สร้างรายการ"
              }}
            </h2>
            <p
              v-if="editor?.courtId"
              class="mt-1 text-sm font-bold text-stone-500"
            >
              {{ editorSlots.length > 1 ? `เลือกแล้ว ${editorSlots.length} ช่องเวลา` : selectedEditorCourt?.name }}
            </p>
          </div>
          <button
            class="booking-icon-button"
            aria-label="ปิดรายละเอียด"
            @click="
              editor = null;
              review = null;
            "
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <form
          v-if="editor && editor.kind !== 'reopen'"
          class="mt-4 grid gap-4"
          @submit.prevent="createEntry"
        >
          <div class="booking-segmented">
            <button
              type="button"
              :class="editor.kind === 'booking' && 'is-active'"
              @click="editor.kind = 'booking'"
            >
              <UserRound class="h-4 w-4" />จองสนาม
            </button>
            <button
              type="button"
              :class="editor.kind === 'closure' && 'is-active'"
              @click="editor.kind = 'closure'"
            >
              <XCircle class="h-4 w-4" />ปิดช่วงเวลา
            </button>
          </div>
          <template v-if="editor.kind === 'booking'">
            <div class="booking-field">
              <label for="admin-booking-member">ผู้จอง</label>
              <div class="relative">
                <input
                  id="admin-booking-member"
                  v-model="editor.memberQuery"
                  role="combobox"
                  aria-label="ผู้จอง"
                  aria-autocomplete="list"
                  :aria-expanded="editor.memberComboOpen"
                  placeholder="ค้นหาสมาชิกด้วยชื่อหรือเบอร์โทร"
                  autocomplete="off"
                  @focus="editor.memberComboOpen = true; $event.target.select()"
                  @blur="editor.memberComboOpen = false"
                  @input="searchMember"
                />
                <div
                  v-if="editor.memberComboOpen"
                  role="listbox"
                  class="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-700 dark:bg-stone-900"
                >
                  <button
                    type="button"
                    role="option"
                    :aria-selected="editor.memberId === ''"
                    class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-black hover:bg-paper-100 dark:hover:bg-stone-800"
                    @mousedown.prevent="selectBookingMember()"
                  >
                    <span>จองโดย Admin</span>
                    <CheckCircle2 v-if="editor.memberId === ''" class="h-4 w-4 text-court-600" />
                  </button>
                  <button
                    v-for="member in editor.memberOptions"
                    :key="member.id"
                    type="button"
                    role="option"
                    :aria-selected="editor.memberId === member.id"
                    class="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-paper-100 dark:hover:bg-stone-800"
                    @mousedown.prevent="selectBookingMember(member)"
                  >
                    <span><strong>{{ member.name }}</strong><small class="mt-0.5 block font-semibold text-stone-500">{{ member.phone }}</small></span>
                    <CheckCircle2 v-if="editor.memberId === member.id" class="h-4 w-4 shrink-0 text-court-600" />
                  </button>
                  <p v-if="editor.memberQuery !== 'จองโดย Admin' && !editor.memberOptions.length" class="px-3 py-2 text-sm font-semibold text-stone-500">
                    ไม่พบสมาชิกที่ค้นหา
                  </p>
                </div>
              </div>
            </div>
          </template>
          <div class="rounded-xl border border-court-200 bg-court-500/10 p-3 dark:border-court-900">
            <p class="text-sm font-black text-court-800 dark:text-court-200">เลือกแล้ว {{ editorSlots.length }} ช่องเวลา</p>
            <p class="mt-1 text-xs font-semibold text-stone-600 dark:text-stone-300">คลิกช่องว่างในตารางเพื่อเลือกเพิ่มหรือเอาออก</p>
            <div class="mt-2 grid gap-1 text-sm font-bold">
              <span v-for="item in editorItems" :key="`${item.courtId}-${item.startMinute}`">
                {{ item.courtName }} · {{ timeLabel(item.startMinute) }}–{{ timeLabel(item.endMinute) }} น.
              </span>
            </div>
          </div>
          <div class="grid min-w-0 gap-3 rounded-xl border border-stone-200 p-3 dark:border-stone-700">
            <label class="booking-field min-w-0"><span>วันเริ่มทำซ้ำ</span><input v-model="editor.repeatStartDate" class="min-w-0" type="date" /></label>
            <label class="booking-field min-w-0"><span>วันสุดท้าย</span><input v-model="editor.repeatEndDate" class="min-w-0" type="date" :min="editor.repeatStartDate" /></label>
            <p class="rounded-lg bg-paper-100 px-3 py-2 text-sm font-black text-stone-600 dark:bg-stone-800 dark:text-stone-300">ทำซ้ำ {{ repeatDayCount }} วัน · รวม {{ repeatedEditorItems.length }} รายการ</p>
          </div>
          <p class="rounded-xl bg-paper-100 p-3 text-sm font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            ระบบจะทำซ้ำเฉพาะสนามและช่องเวลาที่เลือกในทุกวัน ตั้งแต่วันเริ่มถึงวันสุดท้าย
          </p>
          <label v-if="editor.kind === 'closure'" class="booking-field"
            ><span>เหตุผล</span
            ><textarea
              v-model="editor.note"
              required
              rows="3"
              placeholder="เช่น ซ่อมพื้นสนาม"
            ></textarea>
          </label>
          <div v-if="editor.kind === 'booking'" class="booking-total">
            <span>สรุปค่าใช้จ่าย</span
            ><strong>฿{{ editorTotal.toLocaleString("th-TH") }}</strong
            ><small
              >{{ editorSlots.length }} ช่อง / วัน × {{ repeatDayCount }} วัน
              · {{ editorDailyTotal.toLocaleString("th-TH") }} บาท / วัน</small
            >
          </div>
          <button class="booking-primary-button h-12 w-full justify-center" :disabled="actionBusy.entry">
            <RefreshCw v-if="actionBusy.entry" class="h-4 w-4 animate-spin" />
            {{
              actionBusy.entry ? "กำลังบันทึก..." : editor.kind === "booking" ? "ยืนยันการจอง" : "ยืนยันปิดช่วงเวลา"
            }}
          </button>
        </form>

        <div v-else-if="editor?.kind === 'reopen'" class="mt-4 grid gap-4">
          <div class="rounded-xl bg-paper-100 p-4">
            <p class="text-sm font-bold text-stone-500">เหตุผล</p>
            <p class="mt-1 font-black">{{ editor.note || "ไม่ระบุเหตุผล" }}</p>
          </div>
          <button
            class="booking-primary-button h-12 w-full justify-center"
            :disabled="actionBusy.reopen"
            @click="reopenClosure"
          >
            <RefreshCw v-if="actionBusy.reopen" class="h-4 w-4 animate-spin" />{{ actionBusy.reopen ? "กำลังเปิดช่วงเวลา..." : "เปิดช่วงเวลานี้" }}
          </button>
        </div>

        <form
          v-else-if="review"
          class="mt-4 grid gap-4"
          @submit.prevent="submitReview"
        >
          <div class="rounded-xl bg-paper-100 p-4">
            <p class="text-lg font-black">
              {{ review.bookerName }} · {{ review.courtName }}
            </p>
            <p class="mt-1 text-sm font-bold text-stone-500">
              {{ new Date(review.startAt).toLocaleString("th-TH") }}
            </p>
            <p class="mt-3 text-2xl font-black text-court-700">
              ฿{{ review.totalPriceThb }}
            </p>
          </div>
          <img
            v-if="review.slipData"
            :src="review.slipData"
            alt="สลิปชำระเงิน"
            class="max-h-72 w-full rounded-xl bg-paper-100 object-contain"
          />
          <div
            v-if="review.status === 'pending_review'"
            class="booking-segmented"
          >
            <button
              type="button"
              :class="review.action === 'approve' && 'is-active'"
              @click="review.action = 'approve'"
            >
              อนุมัติ</button
            ><button
              type="button"
              :class="review.action === 'reject' && 'is-active'"
              @click="review.action = 'reject'"
            >
              ไม่อนุมัติ
            </button>
          </div>
          <label class="booking-field"
            ><span>เหตุผล / หมายเหตุ</span
            ><textarea
              v-model="review.note"
              rows="3"
              :required="review.action !== 'approve'"
            ></textarea>
          </label>
          <button class="booking-primary-button h-12 w-full justify-center" :disabled="actionBusy.review">
            <RefreshCw v-if="actionBusy.review" class="h-4 w-4 animate-spin" />{{ actionBusy.review ? "กำลังบันทึก..." : "ยืนยัน" }}{{ !actionBusy.review ? (
              review.action === "approve"
                ? "อนุมัติ"
                : review.action === "cancel"
                  ? "ยกเลิก"
                  : "ไม่อนุมัติ"
            ) : "" }}
          </button>
        </form>
      </aside>
    </div>

    <nav
      class="scrollbar-none flex gap-2 overflow-x-auto rounded-xl border bg-white p-2 dark:border-stone-700 dark:bg-stone-900"
      aria-label="เมนูระบบจองสนาม"
    >
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg px-4 font-black"
        :class="
          activeTab === tab.id
            ? 'bg-court-500 text-white'
            : 'hover:bg-paper-100 dark:hover:bg-stone-800'
        "
        @click="changeTab(tab.id)"
      >
        <component :is="tab.icon" class="h-4 w-4" />{{ tab.label }}
        <span
          v-if="tab.count"
          class="rounded-full bg-purple-600 px-2 py-0.5 text-xs text-white"
          >{{ tab.count }}</span
        >
      </button>
    </nav>

    <section
      v-if="activeTab === 'pending'"
      class="rounded-xl border bg-white p-4 dark:border-stone-700 dark:bg-stone-900"
    >
      <h2 class="flex items-center gap-2 text-lg font-black">
        <CheckCircle2 class="h-5 w-5" />รายการรอตรวจสอบ
      </h2>
      <div class="mt-3 grid gap-2">
        <article
          v-for="booking in pagedPendingBookings"
          :key="booking.id"
          class="grid gap-3 rounded-lg bg-purple-50 p-3 dark:bg-purple-950/20 sm:grid-cols-[1fr_auto] sm:items-center"
        >
          <div>
            <p class="font-black">
              {{ booking.bookerName }} · {{ booking.items.length > 1 ? `${booking.items.length} ช่วงเวลา` : booking.courtName }}
            </p>
            <p class="text-sm">
              {{ new Date(booking.startAt).toLocaleString("th-TH") }}
              <template v-if="booking.items.length > 1"> · {{ booking.courtCount }} สนาม</template>
              · ฿{{ Number(booking.totalPriceThb || 0).toLocaleString("th-TH") }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              class="inline-flex h-10 items-center gap-1.5 rounded-lg border border-stone-300 px-3 font-black dark:border-stone-600"
              @click="review = { ...booking, action: 'approve', note: '' }"
            >
              <Eye class="h-4 w-4" />ดูรายละเอียด
            </button>
          </div>
        </article>
        <p
          v-if="!pendingBookings.length"
          class="py-8 text-center text-stone-500"
        >
          ไม่มีรายการรอตรวจสอบ
        </p>
      </div>
      <div v-if="pendingBookings.length > pendingPageSize" class="mt-4 flex items-center justify-between border-t pt-3 dark:border-stone-700">
        <button class="booking-secondary-button h-10" :disabled="pendingPage <= 1" @click="pendingPage--">ก่อนหน้า</button>
        <span class="text-sm font-black">หน้า {{ pendingPage }} / {{ pendingTotalPages }} · {{ pendingBookings.length }} รายการ</span>
        <button class="booking-secondary-button h-10" :disabled="pendingPage >= pendingTotalPages" @click="pendingPage++">ถัดไป</button>
      </div>
    </section>

    <section
      v-else-if="activeTab === 'history'"
      class="overflow-hidden rounded-xl border bg-white dark:border-stone-700 dark:bg-stone-900"
    >
      <div class="border-b p-4 dark:border-stone-700">
        <h2 class="flex items-center gap-2 text-lg font-black">
          <History class="h-5 w-5" />ประวัติการจองสนาม
        </h2>
        <form
          class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto_auto] lg:items-end"
          @submit.prevent="loadHistory(1)"
        >
          <label class="booking-field">
            <span>วันเริ่มต้น</span>
            <input v-model="historyFilters.startDate" type="date" required />
          </label>
          <label class="booking-field">
            <span>วันสิ้นสุด</span>
            <input
              v-model="historyFilters.endDate"
              type="date"
              :min="historyFilters.startDate"
              required
            />
          </label>
          <label class="booking-field">
            <span>สนาม</span>
            <select v-model="historyFilters.courtId">
              <option value="">ทุกสนาม</option>
              <option v-for="court in courts" :key="court.id" :value="court.id">
                {{ court.name }}
              </option>
            </select>
          </label>
          <label class="booking-field">
            <span>เบอร์โทร</span>
            <input
              v-model="historyFilters.phone"
              inputmode="tel"
              placeholder="ค้นหาจากเบอร์โทร"
            />
          </label>
          <button
            type="submit"
            class="booking-primary-button h-11 justify-center"
            :disabled="historyLoading"
          >
            <RefreshCw class="h-4 w-4" :class="historyLoading && 'animate-spin'" />
            ค้นหา
          </button>
          <button
            type="button"
            class="booking-secondary-button h-11 justify-center"
            @click="resetHistoryFilters"
          >
            วันนี้
          </button>
        </form>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr class="booking-table-head text-left">
              <th class="p-3">วันที่จอง</th>
              <th class="p-3">จำนวน</th>
              <th class="p-3">ผู้จอง</th>
              <th class="p-3">เบอร์โทร</th>
              <th class="p-3">สถานะการจอง</th>
              <th class="p-3">เวลาที่ทำรายการ</th>
              <th class="p-3 text-right">ยอดรวม</th>
              <th class="p-3 text-center">รายการ</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="booking in historyItems"
              :key="booking.id"
              class="border-b dark:border-stone-700"
            >
              <td class="p-3 font-bold whitespace-nowrap">{{ new Date(booking.startAt).toLocaleDateString("th-TH") }}</td>
              <td class="p-3 align-top">
                <span class="inline-flex rounded-full bg-court-500/10 px-2.5 py-1 text-xs font-black text-court-700 dark:text-court-300">{{ booking.bookingCount || 1 }} ช่วงเวลา</span>
              </td>
              <td class="p-3">
                <span class="font-black">{{ booking.bookerName || "Admin" }}</span>
                <span class="block text-xs text-stone-500">
                  {{ booking.bookedBy === "admin" ? "สร้างโดย Admin" : "สมาชิก" }}
                </span>
              </td>
              <td class="p-3 font-bold">{{ booking.phone || "-" }}</td>
              <td class="p-3">
                <span
                  class="inline-flex rounded-full px-2.5 py-1 text-xs font-black"
                  :class="historyStatusClass(booking.status)"
                >{{ bookingStatusLabel(booking.status) }}</span>
              </td>
              <td class="p-3 font-bold whitespace-nowrap">{{ booking.createdAt || "-" }}</td>
              <td class="p-3 text-right text-base font-black">
                ฿{{ Number(booking.totalPriceThb || 0).toLocaleString("th-TH") }}
              </td>
              <td class="p-3 text-center">
                <button type="button" class="booking-secondary-button h-9 whitespace-nowrap px-3" @click="openHistoryDetail(booking)">
                  <ClipboardList class="h-4 w-4" />ดูรายการ
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p
          v-if="!historyLoading && !historyItems.length"
          class="p-10 text-center font-bold text-stone-500"
        >
          ไม่พบประวัติการจองตามตัวกรอง
        </p>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm font-bold text-stone-500 dark:border-stone-700">
        <span>แสดง {{ historyItems.length }} จาก {{ historyTotal }} รายการ</span>
        <div class="flex items-center gap-2">
          <button class="booking-secondary-button h-10" :disabled="historyPage <= 1 || historyLoading" @click="loadHistory(historyPage - 1)">ก่อนหน้า</button>
          <span>หน้า {{ historyPage }} / {{ historyTotalPages }}</span>
          <button class="booking-secondary-button h-10" :disabled="historyPage >= historyTotalPages || historyLoading" @click="loadHistory(historyPage + 1)">ถัดไป</button>
        </div>
      </div>
    </section>

    <section v-else-if="activeTab === 'blacklist'" class="rounded-xl border bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
      <div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="flex items-center gap-2 text-lg font-black"><ShieldCheck class="h-5 w-5 text-red-600" />Blacklist · ประวัติสลิปผิดปกติ</h2><p class="mt-1 text-sm font-semibold text-stone-500">ใช้เก็บประวัติเท่านั้น ไม่ได้ปิดกั้นสมาชิกจากการจอง</p></div><span class="rounded-full bg-red-50 px-3 py-1 text-sm font-black text-red-700">{{ incidents.total }} เหตุการณ์</span></div>
      <form class="mt-4 grid gap-2 sm:grid-cols-[1fr_13rem_auto]" @submit.prevent="loadIncidents(1)"><input v-model="incidents.search" class="h-11 rounded-lg border bg-transparent px-3" placeholder="ค้นหาชื่อ เบอร์ หรือ transRef" /><select v-model="incidents.type" class="h-11 rounded-lg border bg-transparent px-3"><option value="">ทุกประเภท</option><option value="duplicate">สลิปซ้ำ</option><option value="verification_failed">ตรวจสลิปไม่ผ่าน</option></select><button class="booking-primary-button justify-center">ค้นหา</button></form>
      <div class="mt-4 grid gap-3"><article v-for="item in incidents.items" :key="item.id" class="rounded-xl border p-4 dark:border-stone-700"><div class="flex flex-wrap items-start justify-between gap-2"><div><p class="font-black">{{ item.memberName || 'ไม่พบชื่อสมาชิก' }} · {{ item.phone || '-' }}</p><p class="text-xs font-semibold text-stone-500">{{ item.createdAt }} · Booking {{ item.bookingId }}</p></div><span class="rounded-full px-2 py-1 text-xs font-black" :class="item.type === 'duplicate' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'">{{ item.type === 'duplicate' ? 'สลิปซ้ำ' : 'ตรวจไม่ผ่าน' }}</span></div><p class="mt-3 rounded-lg bg-paper-100 p-3 text-sm font-bold dark:bg-stone-800">{{ item.reason }}</p><p v-if="item.transRef" class="mt-2 break-all text-xs font-semibold text-stone-500">transRef: {{ item.transRef }}</p><div v-if="item.type === 'duplicate'" class="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/20"><b>ซ้ำกับ:</b> {{ item.duplicateMemberName || '-' }} · {{ item.duplicatePhone || '-' }} · {{ item.duplicateAt || '-' }}</div></article><p v-if="!incidents.loading && !incidents.items.length" class="p-8 text-center text-stone-500">ยังไม่มีประวัติสลิปผิดปกติ</p></div>
      <div v-if="incidents.totalPages > 1" class="mt-4 flex items-center justify-between"><button class="rounded-lg border px-3 py-2 font-bold disabled:opacity-40" :disabled="incidents.page<=1" @click="loadIncidents(incidents.page-1)">ก่อนหน้า</button><span class="text-sm font-black">หน้า {{ incidents.page }} / {{ incidents.totalPages }}</span><button class="rounded-lg border px-3 py-2 font-bold disabled:opacity-40" :disabled="incidents.page>=incidents.totalPages" @click="loadIncidents(incidents.page+1)">ถัดไป</button></div>
    </section>

    <section
      v-else-if="activeTab === 'export'"
      class="rounded-xl border bg-white p-4 dark:border-stone-700 dark:bg-stone-900"
    >
      <div class="mx-auto max-w-3xl">
        <h2 class="flex items-center gap-2 text-lg font-black">
          <Download class="h-5 w-5" />รายงานรายละเอียดการจองสนาม
        </h2>
        <p class="mt-1 text-sm text-stone-500">
          ไฟล์จะแสดงผู้จอง สนาม ช่วงเวลา ยอดเงิน เวลาโอน เวลาอนุมัติ และสถานะทั้งหมด โดยไม่รวมรูปสลิป
        </p>
        <form
          class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end"
          @submit.prevent="downloadBookingExport"
        >
          <label class="booking-field">
            <span>วันที่เริ่มต้น</span>
            <input v-model="exportFilters.startDate" type="date" required />
          </label>
          <label class="booking-field">
            <span>วันที่สิ้นสุด</span>
            <input
              v-model="exportFilters.endDate"
              type="date"
              :min="exportFilters.startDate"
              required
            />
          </label>
          <label class="booking-field">
            <span>สถานะการจอง</span>
            <select v-model="exportFilters.status">
              <option value="all">ทั้งหมด</option>
              <option value="hold">กำลังจอง</option>
              <option value="pending_review">รอตรวจสอบ</option>
              <option value="confirmed">ยืนยันแล้ว</option>
              <option value="rejected">ไม่อนุมัติ</option>
              <option value="cancelled">ยกเลิก</option>
              <option value="expired">หมดเวลา</option>
            </select>
          </label>
          <button
            type="submit"
            class="booking-primary-button h-11 justify-center"
            :disabled="exportLoading"
          >
            <Download class="h-4 w-4" />
            {{ exportLoading ? "กำลังสร้างไฟล์..." : "ดาวน์โหลดรายงาน" }}
          </button>
        </form>
        <p
          v-if="exportStatus"
          class="mt-4 rounded-lg bg-green-50 p-3 font-bold text-green-700 dark:bg-green-950/30 dark:text-green-200"
        >
          {{ exportStatus }}
        </p>
      </div>
    </section>

    <div v-else-if="activeTab === 'settings'" class="grid gap-4">
      <nav
        class="flex gap-2 overflow-x-auto rounded-xl border bg-white p-2 dark:border-stone-700 dark:bg-stone-900"
        aria-label="หมวดการตั้งค่าระบบจอง"
      >
        <button
          v-for="item in settingsTabs"
          :key="item.id"
          type="button"
          class="h-10 shrink-0 rounded-lg px-4 text-sm font-black transition"
          :class="settingsTab === item.id ? 'bg-court-500 text-white shadow-sm' : 'text-stone-600 hover:bg-paper-100 dark:text-stone-300 dark:hover:bg-stone-800'"
          @click="settingsTab = item.id"
        >
          {{ item.label }}
        </button>
      </nav>

      <section
        v-if="settingsTab !== 'courts'"
        class="rounded-xl border bg-white p-4 dark:border-stone-700 dark:bg-stone-900"
      >
        <h2 class="flex items-center gap-2 text-lg font-black">
          <Settings class="h-5 w-5" />{{ settingsTabs.find((item) => item.id === settingsTab)?.label }}
        </h2>

        <div v-if="settingsTab === 'booking'" class="mt-4 grid gap-3 sm:grid-cols-2">
          <label class="grid gap-1 text-sm font-bold">เวลาเริ่ม<input v-model="settings.openTime" type="time" class="h-10 rounded-lg border bg-transparent px-3" /></label>
          <label class="grid gap-1 text-sm font-bold">เวลาสิ้นสุด<input v-model="settings.closeTime" type="time" class="h-10 rounded-lg border bg-transparent px-3" /></label>
          <label class="grid gap-1 text-sm font-bold">ช่วงเวลา (นาที)<input v-model.number="settings.intervalMinutes" type="number" min="10" step="10" class="h-10 rounded-lg border bg-transparent px-3" /></label>
          <label class="flex items-center gap-2 font-bold"><input v-model="settings.allowOvernight" type="checkbox" />จองข้ามวัน</label>
          <label class="flex items-center gap-2 font-bold sm:col-span-2"><input v-model="settings.bookingAcceptanceEnabled" type="checkbox" />จำกัดเวลาเปิดรับการจอง</label>
          <label v-if="settings.bookingAcceptanceEnabled" class="grid gap-1 text-sm font-bold">เปิดรับเวลา<input v-model="settings.bookingAcceptanceOpenTime" type="time" required class="h-10 rounded-lg border bg-transparent px-3" /></label>
          <label v-if="settings.bookingAcceptanceEnabled" class="grid gap-1 text-sm font-bold">ปิดรับเวลา<input v-model="settings.bookingAcceptanceCloseTime" type="time" required class="h-10 rounded-lg border bg-transparent px-3" /></label>
          <label class="flex items-center gap-2 font-bold sm:col-span-2"><input v-model="settings.singleSlotPurchaseEnabled" type="checkbox" />ซื้อได้ครั้งละ 1 สนาม × 1 ช่วงเวลา</label>
        </div>

        <div v-else-if="settingsTab === 'payment'" class="mt-4 grid gap-3 sm:grid-cols-2">
          <label class="flex items-center gap-2 font-bold sm:col-span-2"><input v-model="settings.useSamePrice" type="checkbox" />ใช้ราคาเดียวกันทุกสนาม</label>
          <label class="grid gap-1 text-sm font-bold">PromptPay<select v-model="settings.promptPayType" class="h-10 rounded-lg border bg-transparent px-3"><option value="mobile">เบอร์โทร</option><option value="national_id">บัตรประชาชน / เลขผู้เสียภาษีนิติบุคคล</option><option value="ewallet">e-Wallet</option></select></label>
          <label class="grid gap-1 text-sm font-bold">เลข PromptPay<input v-model="settings.promptPayId" class="h-10 rounded-lg border bg-transparent px-3" /></label>
          <label class="grid gap-1 text-sm font-bold sm:col-span-2">ชื่อผู้รับ<input v-model="settings.promptPayReceiverName" class="h-10 rounded-lg border bg-transparent px-3" /></label>
          <div class="grid gap-3 rounded-lg border p-3 dark:border-stone-700 sm:col-span-2 sm:grid-cols-2">
            <label class="grid gap-1 text-sm font-bold">Telegram Bot token<input v-model="settings.telegramBotToken" type="password" placeholder="เว้นว่างเพื่อใช้ค่าเดิม" class="h-10 rounded-lg border bg-transparent px-3" /></label>
            <label class="grid gap-1 text-sm font-bold">Telegram Chat ID<input v-model="settings.telegramChatId" class="h-10 rounded-lg border bg-transparent px-3" /></label>
            <div class="grid gap-2 sm:col-span-2">
              <button type="button" class="booking-secondary-button h-10 justify-center" :disabled="telegramCheckLoading || (!settings.telegramBotToken && !settings.telegramConfigured)" @click="checkTelegramConnection">
                <RefreshCw class="h-4 w-4" :class="telegramCheckLoading && 'animate-spin'" />{{ telegramCheckLoading ? 'กำลังยิง getUpdates...' : 'ตรวจสอบ Telegram · getUpdates' }}
              </button>
              <p class="text-xs font-semibold text-stone-500">กรอก Bot Token แล้วกดตรวจสอบ ระบบจะแสดง JSON จาก Telegram ด้านล่าง หากเว้นว่างจะใช้ Token ที่บันทึกไว้</p>
              <pre v-if="telegramCheckResult" class="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-stone-950 p-3 text-xs leading-5 text-green-300">{{ JSON.stringify(telegramCheckResult, null, 2) }}</pre>
              <p v-if="telegramCheckError" class="rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700 dark:bg-red-950/30 dark:text-red-200">{{ telegramCheckError }}</p>
            </div>
          </div>
        </div>

        <div v-else-if="settingsTab === 'slipok'" class="mt-4 grid gap-3">
          <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 dark:border-stone-700">
            <label class="flex items-center gap-2 font-black"><input v-model="settings.slipOKEnabled" type="checkbox" />เปิดใช้ Auto Slip</label>
            <button type="button" class="rounded-lg border px-3 py-2 text-xs font-black" @click="loadSlipOKQuota">รีเฟรชโควตา</button>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="grid gap-1 text-sm font-bold">Branch ID<input v-model="settings.slipOKBranchId" class="h-10 rounded-lg border bg-transparent px-3" /></label>
            <label class="grid gap-1 text-sm font-bold">API Key<input v-model="settings.slipOKApiKey" type="password" class="h-10 rounded-lg border bg-transparent px-3" :placeholder="settings.slipOKApiKeyMasked || 'กรอก API Key'" /></label>
            <label class="grid gap-1 text-sm font-bold">Monthly cap<input v-model.number="settings.slipOKMonthlyCap" type="number" min="0" class="h-10 rounded-lg border bg-transparent px-3" /></label>
            <div class="rounded-lg bg-paper-100 p-3 text-sm font-bold dark:bg-stone-800">ใช้แล้ว {{ slipOKQuota.used || 0 }} · คงเหลือ {{ slipOKQuota.remaining || 0 }} / {{ slipOKQuota.limit || settings.slipOKMonthlyCap || 0 }}<p v-if="slipOKQuota.error" class="mt-1 text-xs text-amber-700">{{ slipOKQuota.error }}</p></div>
          </div>
          <p class="rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">หาก Auto Slip ใช้งานไม่ได้หรือโควตาหมด ระบบจะส่งให้ Admin ตรวจ Manual</p>
        </div>

        <div v-else-if="settingsTab === 'display'" class="mt-4 grid gap-4 sm:grid-cols-2">
          <div class="grid gap-3 rounded-lg border p-3 dark:border-stone-700">
            <h3 class="font-black">โลโก้หน้าจอง</h3>
            <div v-if="settings.logoData" class="grid place-items-center rounded-lg bg-paper-100 p-2 dark:bg-stone-800"><img :src="settings.logoData" alt="ตัวอย่างโลโก้" class="h-20 w-20 rounded-xl object-cover" /></div>
            <label class="inline-flex h-11 cursor-pointer items-center justify-center rounded-lg border border-dashed font-black">เลือกโลโก้<input class="sr-only" type="file" accept="image/png,image/jpeg,image/webp" @change="fileData($event, 'logoData', 2 * 1024 * 1024)" /></label>
            <button v-if="settings.logoData" type="button" class="h-10 rounded-lg border border-red-200 font-bold text-red-700" @click="settings.logoData = ''">ลบโลโก้</button>
          </div>
          <div class="grid gap-3 rounded-lg border p-3 dark:border-stone-700">
            <label class="flex items-center gap-2 font-black"><input v-model="settings.popupEnabled" type="checkbox" />เปิด Popup หน้า Booking User</label>
            <div v-if="settings.popupImage" class="grid place-items-center rounded-lg bg-paper-100 p-2 dark:bg-stone-800"><img :src="settings.popupImage" alt="ตัวอย่าง Popup" class="max-h-52 rounded-lg object-contain" /></div>
            <label class="inline-flex h-11 cursor-pointer items-center justify-center rounded-lg border border-dashed font-black">อัปโหลดภาพ Popup<input class="sr-only" type="file" accept="image/png,image/jpeg,image/webp" @change="fileData($event, 'popupImage', 2 * 1024 * 1024)" /></label>
            <button v-if="settings.popupImage" type="button" class="h-10 rounded-lg border border-red-200 font-bold text-red-700" @click="settings.popupImage = ''">ลบภาพ Popup</button>
          </div>
        </div>

        <p v-if="settingsStatus" class="mt-4 rounded-lg bg-green-50 p-3 font-bold text-green-700">{{ settingsStatus }}</p>
        <button class="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-court-500 font-black text-white disabled:opacity-60" :disabled="actionBusy.settings" @click="saveSettings">
          <RefreshCw v-if="actionBusy.settings" class="h-4 w-4 animate-spin" /><Save v-else class="h-4 w-4" />{{ actionBusy.settings ? "กำลังบันทึก..." : "บันทึกตั้งค่า" }}
        </button>
      </section>

      <section
        v-else
        class="rounded-xl border bg-white p-4 dark:border-stone-700 dark:bg-stone-900"
      >
        <h2 class="text-lg font-black">จัดการสนาม</h2>
        <p class="mt-1 text-sm font-semibold text-stone-500">เพิ่ม แก้ไขราคา เปิดใช้งาน หรือลบสนาม</p>
        <div class="mt-4 grid gap-2">
          <div
            v-for="court in courts"
            :key="court.id"
            class="grid gap-2 rounded-lg border border-stone-200 p-2 dark:border-stone-700 sm:grid-cols-[1fr_7rem_auto_auto_auto] sm:items-center"
            :class="!court.active && 'opacity-60'"
          >
            <input
              v-model="court.name"
              class="h-10 rounded-lg border bg-transparent px-3"
            /><input
              v-model.number="court.pricePerInterval"
              type="number"
              min="0"
              class="h-10 rounded-lg border bg-transparent px-3"
            /><label class="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-3 font-bold">
              <input v-model="court.active" type="checkbox" :disabled="courtBusy.has(court.id)" @change="updateCourt(court)" />
              เปิดใช้งาน
            </label><button
              class="h-10 rounded-lg border px-3 font-bold"
              :disabled="courtBusy.has(court.id)"
              @click="updateCourt(court)"
            >
              <RefreshCw v-if="courtBusy.has(court.id)" class="inline h-4 w-4 animate-spin" /> {{ courtBusy.has(court.id) ? "กำลังบันทึก" : "บันทึก" }}</button
            ><button
              class="h-10 rounded-lg border border-red-200 px-3 text-red-700"
              :disabled="courtBusy.has(court.id)"
              @click="deleteCourt(court)"
            >
              {{ courtBusy.has(court.id) ? "รอสักครู่" : "ลบ" }}
            </button>
          </div>
          <div class="grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
            <input
              v-model="newCourt.name"
              placeholder="ชื่อสนามใหม่"
              class="h-10 rounded-lg border bg-transparent px-3"
            /><input
              v-model.number="newCourt.pricePerInterval"
              type="number"
              min="0"
              class="h-10 rounded-lg border bg-transparent px-3"
            /><button
              class="h-10 rounded-lg bg-stone-900 px-3 font-bold text-white dark:bg-white dark:text-stone-900"
              :disabled="actionBusy.addCourt"
              @click="addCourt"
            >
              <RefreshCw v-if="actionBusy.addCourt" class="inline h-4 w-4 animate-spin" /><Plus v-else class="inline h-4 w-4" /> {{ actionBusy.addCourt ? "กำลังเพิ่ม..." : "เพิ่ม" }}
            </button>
          </div>
        </div>
      </section>
    </div>

    <div
      v-if="false && editor?.kind === 'reopen'"
      class="fixed inset-0 z-50 grid place-items-center bg-black/50 p-3"
      @click.self="editor = null"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-4 dark:bg-stone-900">
        <div class="flex justify-between">
          <h2 class="text-xl font-black">ช่วงเวลาปิดสนาม</h2>
          <button @click="editor = null"><X class="h-5 w-5" /></button>
        </div>
        <p class="mt-3 rounded-lg bg-paper-100 p-3 font-bold dark:bg-stone-800">
          {{ editor.note || "ไม่ระบุเหตุผล" }}
        </p>
        <div class="mt-4 grid grid-cols-2 gap-2">
          <button class="h-11 rounded-lg border" @click="editor = null">
            กลับ</button
          ><button
            class="h-11 rounded-lg bg-court-500 font-black text-white"
            @click="reopenClosure"
          >
            เปิดช่วงเวลานี้
          </button>
        </div>
      </div>
    </div>

    <div
      v-else-if="false && editor"
      class="fixed inset-0 z-50 grid place-items-end bg-black/50 p-3 sm:place-items-center"
      @click.self="editor = null"
    >
      <form
        class="w-full max-w-lg rounded-xl bg-white p-4 dark:bg-stone-900"
        @submit.prevent="createEntry"
      >
        <div class="flex justify-between">
          <h2 class="text-xl font-black">สร้างรายการ</h2>
          <button type="button" @click="editor = null">
            <X class="h-5 w-5" />
          </button>
        </div>
        <div class="mt-4 grid gap-3">
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              class="h-10 rounded-lg border font-black"
              :class="editor.kind === 'booking' && 'bg-court-500 text-white'"
              @click="editor.kind = 'booking'"
            >
              จองสนาม</button
            ><button
              type="button"
              class="h-10 rounded-lg border font-black"
              :class="editor.kind === 'closure' && 'bg-stone-700 text-white'"
              @click="editor.kind = 'closure'"
            >
              ปิดช่วงเวลา
            </button>
          </div>
          <label v-if="editor.kind === 'booking'" class="grid gap-1 font-bold"
            >ค้นสมาชิกด้วยเบอร์<input
              v-model="editor.phone"
              class="h-11 rounded-lg border bg-transparent px-3"
              @input="searchMember" /></label
          ><select
            v-if="editor.kind === 'booking'"
            v-model="editor.memberId"
            class="h-11 rounded-lg border bg-transparent px-3"
          >
            <option value="">จองโดย Admin</option>
            <option
              v-for="member in editor.memberOptions"
              :key="member.id"
              :value="member.id"
            >
              {{ member.phone }} · {{ member.name }}
            </option></select
          ><label class="grid gap-1 font-bold"
            >{{ editor.kind === "closure" ? "วันแรก / เวลาเริ่มปิด" : "เริ่ม"
            }}<input
              v-model="editor.startAt"
              type="datetime-local"
              class="h-11 rounded-lg border bg-transparent px-3" /></label
          ><label class="grid gap-1 font-bold"
            >{{
              editor.kind === "closure"
                ? "วันสุดท้าย / เวลาสิ้นสุดในแต่ละวัน"
                : "สิ้นสุด"
            }}<input
              v-model="editor.endAt"
              type="datetime-local"
              class="h-11 rounded-lg border bg-transparent px-3"
          /></label>
          <p
            v-if="editor.kind === 'closure'"
            class="rounded-lg bg-paper-100 p-3 text-sm font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300"
          >
            ระบบจะปิดช่วงเวลาเดียวกันซ้ำทุกวัน ตั้งแต่วันแรกถึงวันสุดท้าย เช่น
            22 ก.ค. 20:00 ถึง 30 ก.ค. 21:00 = ปิด 20:00–21:00 ทุกวัน
          </p>
          <label v-if="editor.kind === 'closure'" class="grid gap-1 font-bold"
            >เหตุผล<input
              v-model="editor.note"
              required
              class="h-11 rounded-lg border bg-transparent px-3" /></label
          ><button class="h-11 rounded-lg bg-court-500 font-black text-white" :disabled="actionBusy.entry">
            <RefreshCw v-if="actionBusy.entry" class="inline h-4 w-4 animate-spin" /> {{ actionBusy.entry ? "กำลังบันทึก..." : "ยืนยัน" }}
          </button>
        </div>
      </form>
    </div>

    <div
      v-if="review"
      class="fixed inset-0 z-50 grid place-items-end bg-black/60 p-3 sm:place-items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-review-title"
      @click.self="review = null"
      @keydown.esc="review = null"
    >
      <form
        class="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-2xl dark:bg-stone-900"
        @submit.prevent="submitReview"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-xs font-black uppercase tracking-[0.14em] text-court-700">Slip review</p>
            <h2 id="booking-review-title" class="mt-1 text-xl font-black">รายละเอียดการจอง</h2>
          </div>
          <button
            type="button"
            class="booking-icon-button"
            aria-label="ปิดรายละเอียด"
            @click="review = null"
          ><X class="h-4 w-4" /></button>
        </div>
        <div class="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-paper-100 p-4 dark:bg-stone-800">
          <div class="col-span-2">
            <p class="text-xs font-bold text-stone-500">ผู้จอง</p>
            <p class="mt-1 text-lg font-black">{{ review.bookerName || "Admin" }}</p>
          </div>
          <div v-if="review.items?.length === 1">
            <p class="text-xs font-bold text-stone-500">สนาม</p>
            <p class="mt-1 font-black">{{ review.courtName }}</p>
          </div>
          <div>
            <p class="text-xs font-bold text-stone-500">ยอดชำระ</p>
            <p class="mt-1 text-xl font-black text-court-700">฿{{ Number(review.totalPriceThb || 0).toLocaleString("th-TH") }}</p>
          </div>
          <div v-if="review.items?.length === 1" class="col-span-2">
            <p class="text-xs font-bold text-stone-500">วันและเวลา</p>
            <p class="mt-1 font-black">
              {{ new Date(review.startAt).toLocaleString("th-TH") }}–{{ new Date(review.endAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) }} น.
            </p>
          </div>
          <div v-if="review.items?.length > 1" class="col-span-2">
            <p class="text-xs font-bold text-stone-500">ช่วงเวลาที่จอง {{ review.items.length }} รายการ</p>
            <div class="mt-2 grid gap-2">
              <div v-for="(item, index) in review.items" :key="item.id" class="rounded-lg bg-white p-3 dark:bg-stone-900">
                <p class="font-black">{{ index + 1 }}. {{ item.courtName }} · ฿{{ Number(item.totalPriceThb || 0).toLocaleString("th-TH") }}</p>
                <p class="mt-1 text-sm font-semibold text-stone-500">
                  {{ new Date(item.startAt).toLocaleString("th-TH") }}–{{ new Date(item.endAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) }} น.
                </p>
              </div>
            </div>
          </div>
        </div>
        <img
          v-if="review.slipData"
          :src="review.slipData"
          alt="สลิปชำระเงิน"
          class="mt-4 max-h-80 w-full rounded-xl border bg-paper-100 object-contain dark:border-stone-700 dark:bg-stone-800"
        />
        <div v-else class="mt-4 rounded-xl bg-amber-50 p-5 text-center font-bold text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          ไม่พบรูปสลิปในรายการนี้
        </div>
        <div v-if="review.status === 'pending_review'" class="booking-segmented mt-4">
          <button type="button" :class="review.action === 'approve' && 'is-active'" @click="review.action = 'approve'">อนุมัติ</button>
          <button type="button" :class="review.action === 'reject' && 'is-active'" @click="review.action = 'reject'">ไม่อนุมัติ</button>
        </div>
        <label class="booking-field mt-4">
          <span>เหตุผล / หมายเหตุ</span>
          <textarea v-model="review.note" rows="3" :required="review.action !== 'approve'"></textarea>
        </label>
        <div class="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            class="booking-secondary-button h-11 justify-center"
            @click="review = null"
          >
            กลับ</button
          ><button class="booking-primary-button h-11 justify-center" :disabled="actionBusy.review">
            <RefreshCw v-if="actionBusy.review" class="h-4 w-4 animate-spin" />{{ actionBusy.review ? "กำลังบันทึก..." : `ยืนยัน${review.action === "approve" ? "อนุมัติ" : review.action === "cancel" ? "ยกเลิก" : "ไม่อนุมัติ"}` }}
          </button>
        </div>
      </form>
    </div>

    <div
      v-if="historyDetail"
      class="fixed inset-0 z-[70] grid place-items-end bg-black/55 p-3 backdrop-blur-sm sm:place-items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-history-detail-title"
      @click.self="historyDetail = null"
      @keydown.esc="historyDetail = null"
    >
      <section class="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-white shadow-2xl dark:border-stone-700 dark:bg-stone-900">
        <header class="flex items-start justify-between gap-3 border-b p-4 dark:border-stone-700">
          <div>
            <p class="text-xs font-black uppercase tracking-wider text-court-700 dark:text-court-300">รายละเอียดชุดการจอง</p>
            <h2 id="booking-history-detail-title" class="mt-1 text-xl font-black">{{ historyDetail.bookingCount || 1 }} ช่วงเวลา</h2>
            <p class="mt-1 text-sm font-semibold text-stone-500">ทำรายการเมื่อ {{ historyDetail.createdAt || '-' }}</p>
          </div>
          <button type="button" class="grid h-10 w-10 shrink-0 place-items-center rounded-lg border dark:border-stone-700" aria-label="ปิดรายละเอียด" @click="historyDetail = null"><X class="h-4 w-4" /></button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <div class="grid grid-cols-2 gap-3 rounded-xl bg-paper-100 p-3 text-sm dark:bg-stone-800">
            <div><p class="text-xs font-bold text-stone-500">ผู้จอง</p><p class="mt-1 font-black">{{ historyDetail.bookerName || 'Admin' }}</p></div>
            <div><p class="text-xs font-bold text-stone-500">เบอร์โทร</p><p class="mt-1 font-black">{{ historyDetail.phone || '-' }}</p></div>
            <div><p class="text-xs font-bold text-stone-500">สถานะ</p><span class="mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-black" :class="historyStatusClass(historyDetail.status)">{{ bookingStatusLabel(historyDetail.status) }}</span></div>
            <div><p class="text-xs font-bold text-stone-500">ยอดรวมทั้งชุด</p><p class="mt-1 text-lg font-black text-court-700 dark:text-court-300">฿{{ Number(historyDetail.totalPriceThb || 0).toLocaleString('th-TH') }}</p></div>
          </div>

          <div class="mt-4 grid gap-2">
            <article v-for="(item, index) in historyDetail.items || []" :key="item.id || index" class="rounded-xl border p-3 dark:border-stone-700">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="font-black">{{ index + 1 }}. {{ item.courtName }}</p>
                  <p class="mt-1 text-sm font-semibold text-stone-500">{{ new Date(item.startAt).toLocaleString('th-TH') }}–{{ new Date(item.endAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) }} น.</p>
                </div>
                <p class="shrink-0 font-black">฿{{ Number(item.totalPriceThb || 0).toLocaleString('th-TH') }}</p>
              </div>
            </article>
            <p v-if="!historyDetail.items?.length" class="rounded-xl bg-paper-100 p-5 text-center text-sm font-bold text-stone-500 dark:bg-stone-800">ไม่พบรายละเอียดช่วงเวลา</p>
          </div>
          <p v-if="historyDetail.note" class="mt-4 rounded-xl bg-paper-100 p-3 text-sm font-semibold dark:bg-stone-800"><b>หมายเหตุ:</b> {{ historyDetail.note }}</p>
        </div>
        <footer class="border-t p-3 dark:border-stone-700"><button type="button" class="booking-primary-button h-11 w-full justify-center" @click="historyDetail = null">ปิด</button></footer>
      </section>
    </div>

    <div
      v-if="qrModal"
      class="fixed inset-0 z-50 grid place-items-end bg-black/50 p-3 sm:place-items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-qr-title"
      @click.self="qrModal = false"
      @keydown.esc="qrModal = false"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-4 dark:bg-stone-900">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-black text-court-700">QR Code</p>
            <h2 id="booking-qr-title" class="text-xl font-black">ลิงก์ลงทะเบียนและจองสนาม</h2>
          </div>
          <button
            class="grid h-9 w-9 place-items-center rounded-lg border"
            aria-label="ปิด modal"
            @click="qrModal = false"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
        <div class="mt-4 grid place-items-center">
          <img
            v-if="qrDataUrl"
            :src="qrDataUrl"
            alt="QR จองสนาม"
            class="h-64 w-64 rounded-lg bg-white p-2"
          />
        </div>
        <input
          :value="publicLink"
          readonly
          class="mt-4 h-11 w-full rounded-lg border bg-paper-50 px-3 text-sm dark:bg-stone-800"
        />
        <p v-if="qrStatus" class="mt-2 text-sm font-bold text-court-700">
          {{ qrStatus }}
        </p>
        <div class="mt-4 grid grid-cols-2 gap-2">
          <button
            class="h-11 rounded-lg border font-bold"
            @click="qrModal = false"
          >
            กลับ</button
          ><button
            class="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-court-500 font-black text-white"
            @click="copyLink"
          >
            <Copy class="h-4 w-4" />คัดลอกลิงก์
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
