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
  Eye,
  History,
  Plus,
  QrCode,
  RefreshCw,
  Save,
  Settings,
  UserRound,
  X,
  XCircle,
} from "@lucide/vue";

const props = defineProps(["apiRequest"]);
const today = new Date().toLocaleDateString("en-CA", {
  timeZone: "Asia/Bangkok",
});
const state = reactive({
  bookings: [],
  closures: [],
  date: today,
  loading: false,
  error: "",
});
const settings = reactive({});
const savedScheduleSettings = reactive({});
const courts = ref([]);
const activeTab = ref("pending");
const editor = ref(null);
const review = ref(null);
const qrModal = ref(false);
const qrDataUrl = ref("");
const qrStatus = ref("");
const settingsStatus = ref("");
const lastUpdated = ref(null);
const newCourt = reactive({ name: "", pricePerInterval: 100 });
const historyItems = ref([]);
const historyLoading = ref(false);
const historyFilters = reactive({
  startDate: today,
  endDate: today,
  courtId: "",
  phone: "",
});
let timer;
let settingsReady = false;
let overviewRequest = 0;

const tabs = computed(() => [
  {
    id: "pending",
    label: "รอตรวจสอบ",
    icon: ClipboardList,
    count: pendingBookings.value.length,
  },
  { id: "history", label: "ประวัติการจอง", icon: History },
  { id: "settings", label: "ตั้งค่า", icon: Settings },
]);
const pendingBookings = computed(() =>
  state.bookings.filter((booking) => booking.status === "pending_review"),
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
const editorTotal = computed(() => {
  if (
    !editor.value?.startAt ||
    !editor.value?.endAt ||
    !selectedEditorCourt.value
  )
    return 0;
  const minutes =
    (new Date(editor.value.endAt).getTime() -
      new Date(editor.value.startAt).getTime()) /
    60000;
  return Math.max(
    0,
    Math.round(minutes / Number(savedScheduleSettings.intervalMinutes || 60)) *
      selectedEditorCourt.value.pricePerInterval,
  );
});
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
  loadOverview();
}

function goToday() {
  state.date = today;
  loadOverview();
}

function openNewBooking() {
  const court = courts.value[0];
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

function cellClass(info) {
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
  state.closures = data.closures || [];
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
  if (!silent) state.loading = true;
  state.error = "";
  try {
    const data = await props.apiRequest(
      `/api/admin/booking/overview?date=${state.date}`,
    );
    if (request !== overviewRequest) return;
    applyOverview(data, includeConfiguration, replaceSettingsDraft);
    lastUpdated.value = new Date();
  } catch (error) {
    if (request === overviewRequest) state.error = error.message;
  } finally {
    if (!silent && request === overviewRequest) state.loading = false;
  }
}

async function loadHistory() {
  historyLoading.value = true;
  state.error = "";
  try {
    const params = new URLSearchParams({
      startDate: historyFilters.startDate,
      endDate: historyFilters.endDate,
    });
    if (historyFilters.courtId) params.set("courtId", historyFilters.courtId);
    if (historyFilters.phone.trim())
      params.set("phone", historyFilters.phone.trim());
    const data = await props.apiRequest(
      `/api/admin/booking/history?${params.toString()}`,
    );
    historyItems.value = data.items || [];
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
  if (tab === "history") loadHistory();
}

function resetHistoryFilters() {
  Object.assign(historyFilters, {
    startDate: today,
    endDate: today,
    courtId: "",
    phone: "",
  });
  loadHistory();
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

function paymentStatusLabel(status) {
  return (
    {
      unpaid: "ยังไม่ชำระ",
      pending: "รอตรวจสอบ",
      paid: "ชำระแล้ว",
      rejected: "ไม่ผ่าน",
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
  editor.value = {
    courtId: court.id,
    startAt: localDateTime(minute),
    endAt: localDateTime(
      minute + Number(savedScheduleSettings.intervalMinutes || 60),
    ),
    kind: "booking",
    memberId: "",
    phone: "",
    memberOptions: [],
  };
}

async function searchMember() {
  if (String(editor.value?.phone || "").replace(/\D/g, "").length <= 5) {
    if (editor.value) editor.value.memberOptions = [];
    return;
  }
  const data = await props.apiRequest(
    `/api/admin/members/search?phone=${encodeURIComponent(editor.value.phone)}`,
  );
  editor.value.memberOptions = data.items || [];
}

async function createEntry() {
  try {
    if (editor.value.kind === "closure") {
      await props.apiRequest("/api/admin/booking/closures", {
        method: "POST",
        body: JSON.stringify(editor.value),
      });
    } else {
      await props.apiRequest("/api/admin/booking/bookings", {
        method: "POST",
        body: JSON.stringify(editor.value),
      });
    }
    editor.value = null;
    await loadOverview();
  } catch (error) {
    state.error = error.message;
  }
}

async function reopenClosure() {
  try {
    await props.apiRequest(`/api/admin/booking/closures/${editor.value.id}`, {
      method: "DELETE",
    });
    editor.value = null;
    await loadOverview();
  } catch (error) {
    state.error = error.message;
  }
}

async function submitReview() {
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
  } catch (error) {
    state.error = error.message;
  }
}

async function saveSettings() {
  settingsStatus.value = "";
  try {
    await props.apiRequest("/api/admin/booking/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
    settingsStatus.value = "บันทึกการตั้งค่าแล้ว";
    await loadOverview(false, true, true);
  } catch (error) {
    state.error = error.message;
  }
}

async function addCourt() {
  try {
    await props.apiRequest("/api/admin/booking/courts", {
      method: "POST",
      body: JSON.stringify(newCourt),
    });
    newCourt.name = "";
    await loadOverview(false, true);
  } catch (error) {
    state.error = error.message;
  }
}

async function updateCourt(court) {
  try {
    await props.apiRequest(`/api/admin/booking/courts/${court.id}`, {
      method: "PATCH",
      body: JSON.stringify(court),
    });
    await loadOverview(false, true);
  } catch (error) {
    state.error = error.message;
  }
}

async function deleteCourt(court) {
  if (!window.confirm(`ปิดใช้งาน ${court.name}?`)) return;
  try {
    await props.apiRequest(`/api/admin/booking/courts/${court.id}`, {
      method: "DELETE",
    });
    await loadOverview(false, true);
  } catch (error) {
    state.error = error.message;
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
  timer = window.setInterval(() => loadOverview(true, false), 30000);
  window.addEventListener("focus", refreshOnFocus);
});
onUnmounted(() => {
  window.clearInterval(timer);
  window.removeEventListener("focus", refreshOnFocus);
});
</script>

<template>
  <section
    class="mx-auto grid max-w-[1500px] gap-4 p-4 text-stone-900 dark:text-stone-100"
  >
    <header class="booking-command-bar">
      <div class="flex min-w-0 items-center gap-3">
        <button
          class="booking-icon-button"
          aria-label="กลับ Admin dashboard"
          @click="goBack"
        >
          <ArrowLeft class="h-5 w-5" />
        </button>
        <div class="min-w-0">
          <p
            class="text-xs font-black uppercase tracking-[0.16em] text-court-700"
          >
            LiveMatch booking
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

      <div class="flex flex-wrap items-center justify-end gap-2">
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
              Daily schedule
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
        <div class="overflow-x-auto">
          <table class="w-full min-w-[900px] border-collapse">
            <thead>
              <tr class="booking-table-head">
                <th class="sticky left-0 z-10 min-w-28 p-3">เวลา / สนาม</th>
                <th
                  v-for="court in courts"
                  :key="court.id"
                  class="min-w-44 p-3"
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
                <td v-for="court in courts" :key="court.id" class="p-1.5">
                  <button
                    class="booking-slot"
                    :class="cellClass(cell(court, minute))"
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

      <aside v-if="editor" class="booking-inspector">
        <div class="flex items-start justify-between gap-3 border-b pb-4">
          <div>
            <p
              class="text-xs font-black uppercase tracking-[0.14em] text-court-700"
            >
              Quick action
            </p>
            <h2 class="mt-1 text-xl font-black">
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
              {{ selectedEditorCourt?.name }}
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
            <label class="booking-field"
              ><span>ค้นสมาชิกด้วยเบอร์</span
              ><input
                v-model="editor.phone"
                placeholder="พิมพ์อย่างน้อย 6 หลัก"
                @input="searchMember"
            /></label>
            <label class="booking-field"
              ><span>ผู้จอง</span
              ><select v-model="editor.memberId">
                <option value="">จองโดย Admin</option>
                <option
                  v-for="member in editor.memberOptions"
                  :key="member.id"
                  :value="member.id"
                >
                  {{ member.phone }} · {{ member.name }}
                </option>
              </select></label
            >
          </template>
          <label class="booking-field"
            ><span>{{
              editor.kind === "closure" ? "วันแรก / เวลาเริ่มปิด" : "เวลาเริ่ม"
            }}</span
            ><input v-model="editor.startAt" type="datetime-local"
          /></label>
          <label class="booking-field"
            ><span>{{
              editor.kind === "closure"
                ? "วันสุดท้าย / เวลาสิ้นสุดในแต่ละวัน"
                : "เวลาสิ้นสุด"
            }}</span
            ><input v-model="editor.endAt" type="datetime-local"
          /></label>
          <p
            v-if="editor.kind === 'closure'"
            class="rounded-xl bg-paper-100 p-3 text-sm font-semibold text-stone-600 dark:text-stone-300"
          >
            ปิดช่วงเวลาเดียวกันซ้ำทุกวัน ตั้งแต่วันแรกถึงวันสุดท้าย
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
              >{{ selectedEditorCourt?.pricePerInterval || 0 }} บาท /
              ช่วง</small
            >
          </div>
          <button class="booking-primary-button h-12 w-full justify-center">
            {{
              editor.kind === "booking" ? "ยืนยันการจอง" : "ยืนยันปิดช่วงเวลา"
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
            @click="reopenClosure"
          >
            เปิดช่วงเวลานี้
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
          <button class="booking-primary-button h-12 w-full justify-center">
            ยืนยัน{{
              review.action === "approve"
                ? "อนุมัติ"
                : review.action === "cancel"
                  ? "ยกเลิก"
                  : "ไม่อนุมัติ"
            }}
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
          v-for="booking in pendingBookings"
          :key="booking.id"
          class="grid gap-3 rounded-lg bg-purple-50 p-3 dark:bg-purple-950/20 sm:grid-cols-[1fr_auto] sm:items-center"
        >
          <div>
            <p class="font-black">
              {{ booking.bookerName }} · {{ booking.courtName }}
            </p>
            <p class="text-sm">
              {{ new Date(booking.startAt).toLocaleString("th-TH") }} · ฿{{
                booking.totalPriceThb
              }}
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
          @submit.prevent="loadHistory"
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
              <th class="p-3">วันและเวลา</th>
              <th class="p-3">สนาม</th>
              <th class="p-3">ผู้จอง</th>
              <th class="p-3">เบอร์โทร</th>
              <th class="p-3">สถานะการจอง</th>
              <th class="p-3">สถานะชำระ</th>
              <th class="p-3 text-right">ยอดรวม</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="booking in historyItems"
              :key="booking.id"
              class="border-b dark:border-stone-700"
            >
              <td class="p-3 font-bold">
                {{ new Date(booking.startAt).toLocaleString("th-TH") }}
                <span class="block text-xs font-medium text-stone-500">
                  ถึง {{ new Date(booking.endAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) }} น.
                </span>
              </td>
              <td class="p-3 font-black">{{ booking.courtName }}</td>
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
              <td class="p-3 font-bold">{{ paymentStatusLabel(booking.paymentStatus) }}</td>
              <td class="p-3 text-right text-base font-black">
                ฿{{ Number(booking.totalPriceThb || 0).toLocaleString("th-TH") }}
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
      <div class="border-t px-4 py-3 text-xs font-bold text-stone-500 dark:border-stone-700">
        แสดง {{ historyItems.length }} รายการ · สูงสุด 500 รายการต่อการค้นหา
      </div>
    </section>

    <div v-else-if="activeTab === 'settings'" class="grid gap-4 lg:grid-cols-2">
      <section
        class="rounded-xl border bg-white p-4 dark:border-stone-700 dark:bg-stone-900"
      >
        <h2 class="flex items-center gap-2 text-lg font-black">
          <Settings class="h-5 w-5" />ตั้งค่าการจอง
        </h2>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <label class="grid gap-1 text-sm font-bold"
            >เวลาเริ่ม<input
              v-model="settings.openTime"
              type="time"
              class="h-10 rounded-lg border bg-transparent px-3"
          /></label>
          <label class="grid gap-1 text-sm font-bold"
            >เวลาสิ้นสุด<input
              v-model="settings.closeTime"
              type="time"
              class="h-10 rounded-lg border bg-transparent px-3"
          /></label>
          <label class="grid gap-1 text-sm font-bold"
            >ช่วงเวลา (นาที)<input
              v-model.number="settings.intervalMinutes"
              type="number"
              min="10"
              step="10"
              class="h-10 rounded-lg border bg-transparent px-3"
          /></label>
          <label class="flex items-center gap-2 font-bold"
            ><input
              v-model="settings.allowOvernight"
              type="checkbox"
            />จองข้ามวัน</label
          >
          <label class="flex items-center gap-2 font-bold"
            ><input
              v-model="settings.useSamePrice"
              type="checkbox"
            />ใช้ราคาเดียวกันทุกสนาม</label
          >
          <label class="grid gap-1 text-sm font-bold"
            >PromptPay<select
              v-model="settings.promptPayType"
              class="h-10 rounded-lg border bg-transparent px-3"
            >
              <option value="mobile">เบอร์โทร</option>
              <option value="national_id">บัตรประชาชน</option>
              <option value="ewallet">e-Wallet</option>
            </select></label
          >
          <label class="grid gap-1 text-sm font-bold"
            >เลข PromptPay<input
              v-model="settings.promptPayId"
              class="h-10 rounded-lg border bg-transparent px-3"
          /></label>
          <label class="grid gap-1 text-sm font-bold"
            >ชื่อผู้รับ<input
              v-model="settings.promptPayReceiverName"
              class="h-10 rounded-lg border bg-transparent px-3"
          /></label>
          <label class="grid gap-1 text-sm font-bold"
            >Telegram Bot token<input
              v-model="settings.telegramBotToken"
              type="password"
              placeholder="เว้นว่างเพื่อใช้ค่าเดิม"
              class="h-10 rounded-lg border bg-transparent px-3"
          /></label>
          <label class="grid gap-1 text-sm font-bold"
            >Telegram Chat ID<input
              v-model="settings.telegramChatId"
              class="h-10 rounded-lg border bg-transparent px-3"
          /></label>
          <label class="grid gap-1 text-sm font-bold sm:col-span-2"
            >โลโก้<input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              @change="fileData($event, 'logoData', 2 * 1024 * 1024)"
          /></label>
        </div>
        <p
          v-if="settingsStatus"
          class="mt-3 rounded-lg bg-green-50 p-3 font-bold text-green-700"
        >
          {{ settingsStatus }}
        </p>
        <button
          class="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-court-500 font-black text-white"
          @click="saveSettings"
        >
          <Save class="h-4 w-4" />บันทึกตั้งค่า
        </button>
      </section>

      <section
        class="rounded-xl border bg-white p-4 dark:border-stone-700 dark:bg-stone-900"
      >
        <h2 class="text-lg font-black">จัดการสนาม</h2>
        <div class="mt-3 grid gap-2">
          <div
            v-for="court in courts"
            :key="court.id"
            class="grid gap-2 sm:grid-cols-[1fr_7rem_auto_auto]"
          >
            <input
              v-model="court.name"
              class="h-10 rounded-lg border bg-transparent px-3"
            /><input
              v-model.number="court.pricePerInterval"
              type="number"
              min="0"
              class="h-10 rounded-lg border bg-transparent px-3"
            /><button
              class="h-10 rounded-lg border px-3 font-bold"
              @click="updateCourt(court)"
            >
              บันทึก</button
            ><button
              class="h-10 rounded-lg border border-red-200 px-3 text-red-700"
              @click="deleteCourt(court)"
            >
              ลบ
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
              @click="addCourt"
            >
              <Plus class="inline h-4 w-4" /> เพิ่ม
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
          ><button class="h-11 rounded-lg bg-court-500 font-black text-white">
            ยืนยัน
          </button>
        </div>
      </form>
    </div>

    <div
      v-if="review"
      class="fixed inset-0 z-50 grid place-items-end bg-black/60 p-3 sm:place-items-center"
      @click.self="review = null"
    >
      <form
        class="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-2xl dark:bg-stone-900"
        @submit.prevent="submitReview"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-xs font-black uppercase tracking-[0.14em] text-court-700">Slip review</p>
            <h2 class="mt-1 text-xl font-black">รายละเอียดการจอง</h2>
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
          <div>
            <p class="text-xs font-bold text-stone-500">สนาม</p>
            <p class="mt-1 font-black">{{ review.courtName }}</p>
          </div>
          <div>
            <p class="text-xs font-bold text-stone-500">ยอดชำระ</p>
            <p class="mt-1 text-xl font-black text-court-700">฿{{ Number(review.totalPriceThb || 0).toLocaleString("th-TH") }}</p>
          </div>
          <div class="col-span-2">
            <p class="text-xs font-bold text-stone-500">วันและเวลา</p>
            <p class="mt-1 font-black">
              {{ new Date(review.startAt).toLocaleString("th-TH") }}–{{ new Date(review.endAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) }} น.
            </p>
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
          ><button class="booking-primary-button h-11 justify-center">
            ยืนยัน{{ review.action === "approve" ? "อนุมัติ" : review.action === "cancel" ? "ยกเลิก" : "ไม่อนุมัติ" }}
          </button>
        </div>
      </form>
    </div>

    <div
      v-if="qrModal"
      class="fixed inset-0 z-50 grid place-items-end bg-black/50 p-3 sm:place-items-center"
      @click.self="qrModal = false"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-4 dark:bg-stone-900">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-black text-court-700">QR Code</p>
            <h2 class="text-xl font-black">ลิงก์ลงทะเบียนและจองสนาม</h2>
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
