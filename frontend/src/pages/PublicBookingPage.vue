<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import QRCode from "qrcode";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  LogIn,
  Moon,
  ShieldCheck,
  Sun,
  Upload,
  UserRound,
  X,
} from "@lucide/vue";

const props = defineProps(["apiRequest", "token", "theme"]);
const emit = defineEmits(["toggle-theme"]);
const today = new Date().toLocaleDateString("en-CA", {
  timeZone: "Asia/Bangkok",
});
const state = reactive({
  settings: {},
  courts: [],
  bookings: [],
  closures: [],
  queues: [],
  date: today,
  user: null,
  member: null,
  error: "",
  loading: false,
  now: Date.now(),
  clockOffsetMs: 0,
});
const claim = reactive({ name: "", phone: "" });
const selections = ref([]);
const payment = ref(null);
const qr = ref("");
const toast = reactive({ message: "", tone: "error" });
const scheduleScroll = ref(null);
let timer;
let clock;
let toastTimer;
let loadRequest = 0;
let loadInFlight = false;
let loadQueued = false;

const slots = computed(() => {
  const [openHour, openMinute] = String(state.settings.openTime || "16:00")
    .split(":")
    .map(Number);
  const [closeHour, closeMinute] = String(state.settings.closeTime || "22:00")
    .split(":")
    .map(Number);
  const start = openHour * 60 + openMinute;
  let end = closeHour * 60 + closeMinute;
  if (end <= start && state.settings.allowOvernight) end += 1440;
  const result = [];
  for (
    let minute = start;
    minute < end;
    minute += Number(state.settings.intervalMinutes || 60)
  )
    result.push(minute);
  return result;
});
const displayDate = computed(() =>
  new Intl.DateTimeFormat("th-TH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${state.date}T12:00:00+07:00`)),
);
const canChangeBookingDate = computed(
  () => state.settings.allowOvernight === true,
);
const total = computed(() =>
  selections.value.reduce((sum, item) => {
    const court = state.courts.find((entry) => entry.id === item.courtId);
    return sum + Number(court?.pricePerInterval || 0);
  }, 0),
);
const selectedDuration = computed(
  () => selections.value.length * Number(state.settings.intervalMinutes || 60),
);
const bookingItems = computed(() => {
  const interval = Number(state.settings.intervalMinutes || 60);
  const result = [];
  for (const court of state.courts) {
    const minutes = selections.value
      .filter((item) => item.courtId === court.id)
      .map((item) => item.minute)
      .sort((a, b) => a - b);
    for (const minute of minutes) {
      const last = result.at(-1);
      if (last?.courtId === court.id && last.endMinute === minute) {
        last.endMinute = minute + interval;
        last.endAt = localDateTime(minute + interval);
      } else {
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
  }
  return result;
});
const paymentSeconds = computed(() => {
  if (!payment.value?.holdExpiresAt || payment.value.status !== "hold") return 0;
  return Math.max(
    0,
    Math.ceil((timestamp(payment.value.holdExpiresAt) - state.now) / 1000),
  );
});
const paymentCountdown = computed(
  () =>
    `${Math.floor(paymentSeconds.value / 60)}:${String(paymentSeconds.value % 60).padStart(2, "0")}`,
);

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
function label(minute) {
  return `${String(Math.floor((minute % 1440) / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
function timestamp(value) {
  const normalized = String(value || "").replace(/([+-]\d{2})$/, "$1:00");
  const result = Date.parse(normalized);
  return Number.isFinite(result) ? result : 0;
}
function changeDate(days) {
  if (!canChangeBookingDate.value) return;
  const [year, month, day] = state.date.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  state.date = date.toISOString().slice(0, 10);
  if (scheduleScroll.value) scheduleScroll.value.scrollLeft = 0;
  clearSelection();
  load();
}
function goToday() {
  if (!canChangeBookingDate.value) return;
  state.date = today;
  if (scheduleScroll.value) scheduleScroll.value.scrollLeft = 0;
  clearSelection();
  load();
}
function clearSelection() {
  selections.value = [];
}
function showToast(message, tone = "error") {
  window.clearTimeout(toastTimer);
  toast.message = message;
  toast.tone = tone;
  toastTimer = window.setTimeout(() => {
    toast.message = "";
  }, 4500);
}
function status(court, minute) {
  const start = new Date(`${localDateTime(minute)}:00+07:00`).getTime();
  const end = start + Number(state.settings.intervalMinutes || 60) * 60000;
  const booking = state.bookings.find(
    (item) =>
      ["hold", "pending_review", "confirmed"].includes(item.status) &&
      item.courtId === court.id &&
      new Date(item.startAt).getTime() < end &&
      new Date(item.endAt).getTime() > start,
  );
  if (booking) {
    if (booking.status === "hold") {
      const seconds = Math.max(
        0,
        Math.ceil(
          (timestamp(booking.holdExpiresAt) - state.now) / 1000,
        ),
      );
      return {
        text: `กำลังจอง ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
        tone: "hold",
      };
    }
    return booking.status === "pending_review"
      ? { text: "รอตรวจสอบ", tone: "pending" }
      : { text: "จองแล้ว", tone: "busy" };
  }
  const closure = state.closures.find(
    (item) =>
      item.courtId === court.id &&
      new Date(item.startAt).getTime() < end &&
      new Date(item.endAt).getTime() > start,
  );
  if (closure)
    return {
      text: closure.note ? `ปิด · ${closure.note}` : "ปิดสนาม",
      tone: "closed",
    };
  return { text: `ว่าง ฿${court.pricePerInterval}`, tone: "free" };
}
function isSelected(court, minute) {
  return selections.value.some(
    (item) => item.courtId === court.id && item.minute === minute,
  );
}
function slotClass(court, minute) {
  if (isSelected(court, minute))
    return "public-slot--selected booking-state--selected";
  const tone = status(court, minute).tone;
  return `public-slot--${tone} booking-state--${tone}`;
}
async function load() {
  if (loadInFlight) {
    loadQueued = true;
    loadRequest += 1;
    return;
  }
  loadInFlight = true;
  const request = ++loadRequest;
  const requestedDate = state.date;
  const previousScroll = scheduleScroll.value?.scrollLeft || 0;
  state.loading = true;
  state.error = "";
  try {
    const availability = await props.apiRequest(
      `/api/public-booking/${props.token}/availability?date=${requestedDate}`,
    );
    if (request !== loadRequest || requestedDate !== state.date) return;
    Object.assign(state, availability);
    if (availability.serverNow) {
      state.clockOffsetMs = timestamp(availability.serverNow) - Date.now();
      state.now = Date.now() + state.clockOffsetMs;
    }
    requestAnimationFrame(() => {
      if (scheduleScroll.value && requestedDate === state.date)
        scheduleScroll.value.scrollLeft = previousScroll;
    });
    try {
      const me = await props.apiRequest(
        `/api/public-auth/me?tenant=${props.token}`,
      );
      state.user = me.user;
      state.member = me.member;
      if (!claim.name)
        claim.name = me.member?.name || me.user?.Name || me.user?.name || "";
      if (!claim.phone) claim.phone = me.member?.phone || "";
      if (state.member) {
        try {
          const queues = await props.apiRequest(
            `/api/public-booking/${props.token}/mine`,
          );
          if (request !== loadRequest) return;
          if (queues.serverNow) state.clockOffsetMs = timestamp(queues.serverNow) - Date.now();
          state.queues = (queues.items || []).filter(
            (queue) => queue.status === "hold",
          );
        } catch (error) {
          showToast(error.message || "โหลดคิวจองไม่สำเร็จ กรุณาลองใหม่");
        }
      } else {
        state.queues = [];
      }
    } catch {
      state.user = null;
      state.member = null;
      state.queues = [];
    }
  } catch (error) {
    if (
      error.status === 403 &&
      String(error.message || "").includes("เฉพาะวันนี้") &&
      state.date !== today
    ) {
      state.date = today;
      clearSelection();
      showToast(error.message);
      loadQueued = true;
      return;
    }
    state.error = error.message;
  } finally {
    if (request === loadRequest) state.loading = false;
    loadInFlight = false;
    if (loadQueued) {
      loadQueued = false;
      queueMicrotask(load);
    }
  }
}
function googleLogin() {
  window.location.assign(
    `/api/public-auth/google/start?tenant=${encodeURIComponent(props.token)}`,
  );
}
function goToProfile() {
  if (state.member?.profileToken)
    window.location.assign(`/p/${state.member.profileToken}`);
}
function queueCountdown(queue) {
  if (queue.status !== "hold" || !queue.holdExpiresAt) return "";
  const seconds = Math.max(
    0,
    Math.ceil((timestamp(queue.holdExpiresAt) - state.now) / 1000),
  );
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
async function openQueuePayment(queue) {
  payment.value = {
    id: queue.id,
    status: queue.status,
    totalPriceThb: queue.totalPriceThb,
    holdExpiresAt: queue.holdExpiresAt,
  };
  qr.value = queue.promptPayPayload
    ? await QRCode.toDataURL(queue.promptPayPayload, { width: 300, margin: 1 })
    : "";
}
async function claimMember() {
  try {
    await props.apiRequest("/api/public-auth/claim", {
      method: "POST",
      body: JSON.stringify({ tenant: props.token, ...claim }),
    });
    await load();
  } catch (error) {
    state.error = error.message;
  }
}
function selectSlot(court, minute) {
  const index = selections.value.findIndex(
    (item) => item.courtId === court.id && item.minute === minute,
  );
  if (index >= 0) {
    selections.value.splice(index, 1);
    return;
  }
  if (status(court, minute).tone !== "free" || !state.member) {
    showToast("ช่วงเวลานี้ไม่ว่างหรือไม่สามารถเลือกได้");
    return;
  }
  selections.value.push({ courtId: court.id, minute });
}
function select(court, minute) {
  if (status(court, minute).tone !== "free" || !state.member) return;
  const intervalMinutes = Number(state.settings.intervalMinutes || 60);
  const intervalMs = intervalMinutes * 60000;
  const start = localDateTime(minute);
  const end = localDateTime(minute + intervalMinutes);
  if (selection.courtId !== court.id || !selection.startAt) {
    if (selection.courtId && selection.courtId !== court.id)
      showToast(
        `เปลี่ยนการเลือกเป็น ${court.name} เวลา ${label(minute)} น.`,
        "info",
      );
    Object.assign(selection, { courtId: court.id, startAt: start, endAt: end });
    return;
  }

  const clickedStart = bookingTime(start);
  const currentStart = bookingTime(selection.startAt);
  const currentEnd = bookingTime(selection.endAt);
  if (clickedStart >= currentStart && clickedStart < currentEnd) {
    if (currentEnd - currentStart === intervalMs) clearSelection();
    else if (clickedStart === currentStart)
      selection.startAt = localDateTime(minute + intervalMinutes);
    else if (clickedStart + intervalMs === currentEnd) selection.endAt = start;
    else
      showToast(
        "ช่วงเวลาจองต้องต่อเนื่อง กรุณาเอาเวลาออกจากช่วงแรกหรือช่วงท้าย",
      );
    return;
  }

  const candidateStart = Math.min(currentStart, clickedStart);
  const candidateEnd = Math.max(currentEnd, clickedStart + intervalMs);
  const candidateSlots = slots.value.filter((slotMinute) => {
    const slotStart = bookingTime(localDateTime(slotMinute));
    return slotStart >= candidateStart && slotStart < candidateEnd;
  });
  const expectedSlots = Math.round(
    (candidateEnd - candidateStart) / intervalMs,
  );
  if (
    candidateSlots.length !== expectedSlots ||
    candidateSlots.some(
      (slotMinute) => status(court, slotMinute).tone !== "free",
    )
  ) {
    showToast("เลือกต่อไม่ได้ เพราะมีช่วงเวลาที่ไม่ว่างคั่นอยู่");
    return;
  }
  selection.startAt = new Date(candidateStart)
    .toLocaleString("sv-SE", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(" ", "T");
  selection.endAt = new Date(candidateEnd)
    .toLocaleString("sv-SE", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(" ", "T");
}
async function hold() {
  try {
    const data = await props.apiRequest(
      `/api/public-booking/${props.token}/hold`,
      { method: "POST", body: JSON.stringify(selection) },
    );
    payment.value = data.booking;
    qr.value = data.promptPayPayload
      ? await QRCode.toDataURL(data.promptPayPayload, { width: 300, margin: 1 })
      : "";
    await load();
  } catch (error) {
    const message = error.message || "ไม่สามารถล็อกช่วงเวลานี้ได้";
    showToast(message);
    clearSelection();
    await load();
  }
}
async function holdBatch() {
  try {
    const data = await props.apiRequest(
      `/api/public-booking/${props.token}/hold`,
      {
        method: "POST",
        body: JSON.stringify({
          items: bookingItems.value.map(({ courtId, startAt, endAt }) => ({
            courtId,
            startAt,
            endAt,
          })),
        }),
      },
    );
    payment.value = {
      id: data.batchId || data.booking?.id,
      totalPriceThb: data.totalPriceThb ?? data.booking?.totalPriceThb,
      status: "hold",
      holdExpiresAt:
        data.bookings?.[0]?.holdExpiresAt ||
        data.booking?.holdExpiresAt ||
        new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
    qr.value = data.promptPayPayload
      ? await QRCode.toDataURL(data.promptPayPayload, { width: 300, margin: 1 })
      : "";
    clearSelection();
    await load();
  } catch (error) {
    showToast(
      error.message || "ไม่สามารถล็อกช่วงเวลาที่เลือกได้ กรุณาเลือกใหม่",
    );
    clearSelection();
    await load();
  }
}
function upload(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file || file.size > 5 * 1024 * 1024) {
    showToast("ไฟล์ใหญ่เกิน 5 MB");
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      await props.apiRequest(
        `/api/public-booking/${props.token}/slip/${payment.value.id}`,
        { method: "POST", body: JSON.stringify({ slipData: reader.result }) },
      );
      payment.value.status = "pending_review";
      await load();
    } catch (error) {
      showToast(error.message || "อัปโหลดสลิปไม่สำเร็จ กรุณาตรวจสอบสถานะการจอง");
      payment.value = null;
      qr.value = "";
      await load();
    }
  };
  reader.readAsDataURL(file);
}

onMounted(async () => {
  await load();
  timer = setInterval(load, 30000);
  clock = setInterval(() => {
    state.now = Date.now() + state.clockOffsetMs;
    const expiredQueueIds = state.queues
      .filter(
        (queue) =>
          queue.status === "hold" &&
          queue.holdExpiresAt &&
          state.now >= timestamp(queue.holdExpiresAt),
      )
      .map((queue) => queue.id);
    if (expiredQueueIds.length) {
      state.queues = state.queues.filter(
        (queue) => !expiredQueueIds.includes(queue.id),
      );
      if (expiredQueueIds.includes(payment.value?.id)) {
        payment.value = null;
        qr.value = "";
      }
      showToast("หมดเวลาชำระเงินแล้ว รายการจองถูกลบ กรุณาเลือกเวลาใหม่");
      load();
      return;
    }
    if (
      payment.value?.status === "hold" &&
      payment.value.holdExpiresAt &&
      state.now >= timestamp(payment.value.holdExpiresAt)
    ) {
      payment.value = null;
      qr.value = "";
      showToast("หมดเวลาชำระเงินแล้ว รายการจองถูกลบ กรุณาเลือกเวลาใหม่");
      load();
    }
  }, 1000);
});
onUnmounted(() => {
  clearInterval(timer);
  clearInterval(clock);
  clearTimeout(toastTimer);
});
</script>

<template>
  <main class="public-booking-shell">
    <header class="public-booking-header">
      <div class="flex min-w-0 items-center gap-3">
        <img
          v-if="state.settings.logoData"
          :src="state.settings.logoData"
          alt="โลโก้สนาม"
          class="h-12 w-12 rounded-xl object-contain"
        />
        <div>
          <p
            class="text-xs font-black uppercase tracking-[0.16em] text-court-700"
          >
            ระบบจองสนาม LiveMatch
          </p>
          <h1 class="text-xl font-black sm:text-2xl">จองสนามแบดมินตัน</h1>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="booking-icon-button"
          :aria-label="props.theme === 'dark' ? 'ใช้โหมดสว่าง' : 'ใช้โหมดมืด'"
          :title="props.theme === 'dark' ? 'Light mode' : 'Dark mode'"
          @click="emit('toggle-theme')"
        >
          <Sun v-if="props.theme === 'dark'" class="h-4 w-4" />
          <Moon v-else class="h-4 w-4" />
        </button>
        <template v-if="state.member">
        <button
          v-if="state.member.profileToken"
          class="booking-secondary-button"
          @click="goToProfile"
        >
          <UserRound class="h-4 w-4" />โปรไฟล์
        </button>
        <div class="hidden text-right sm:block">
          <p class="text-sm font-black">{{ state.member.name }}</p>
          <p class="text-xs text-stone-500">สมาชิกที่ใช้งานอยู่</p>
        </div>
        </template>
      </div>
    </header>

    <p
      v-if="state.error"
      class="rounded-xl bg-red-50 p-3 font-bold text-red-700"
    >
      {{ state.error }}
    </p>
    <div
      v-if="toast.message"
      class="booking-toast"
      :class="`booking-toast--${toast.tone}`"
      role="alert"
      data-testid="booking-toast"
    >
      <X class="h-4 w-4" /><span>{{ toast.message }}</span>
      <button aria-label="ปิดข้อความ" @click="toast.message = ''">×</button>
    </div>

    <section v-if="!state.user" class="public-auth-panel">
      <div
        class="grid h-14 w-14 place-items-center rounded-2xl bg-court-50 text-court-700"
      >
        <LogIn class="h-7 w-7" />
      </div>
      <p
        class="mt-5 text-xs font-black uppercase tracking-[0.16em] text-court-700"
      >
        เริ่มต้นจองสนาม
      </p>
      <h2 class="mt-2 text-2xl font-black">เข้าสู่ระบบด้วย Google</h2>
      <p class="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-500">
        ดูช่วงเวลาว่าง เลือกสนาม และติดตามสถานะการชำระเงินได้ในบัญชีเดียว
      </p>
      <button
        class="booking-primary-button mt-6 h-12 px-6"
        @click="googleLogin"
      >
        ดำเนินการด้วย Google
      </button>
      <p
        class="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-stone-400"
      >
        <ShieldCheck class="h-4 w-4" />เราใช้ Google เพื่อยืนยันตัวตนเท่านั้น
      </p>
    </section>

    <section v-else-if="!state.member" class="public-register-panel">
      <div>
        <p
          class="text-xs font-black uppercase tracking-[0.16em] text-court-700"
        >
          ลงทะเบียนครั้งแรก
        </p>
        <h2 class="mt-1 text-2xl font-black">ข้อมูลสำหรับการจอง</h2>
        <p class="mt-2 text-sm text-stone-500">
          กรอกเพียงครั้งเดียว จากนั้นใช้บัญชีนี้จองและดูประวัติได้ทันที
        </p>
      </div>
      <form class="mt-6 grid gap-4" @submit.prevent="claimMember">
        <label class="booking-field"
          ><span>ชื่อที่ใช้แสดง</span
          ><input v-model="claim.name" required autocomplete="name"
        /></label>
        <label class="booking-field"
          ><span>เบอร์โทร</span
          ><input
            v-model="claim.phone"
            required
            inputmode="tel"
            autocomplete="tel"
            placeholder="08X-XXX-XXXX"
        /></label>
        <button class="booking-primary-button h-12 w-full">
          ลงทะเบียนและเริ่มจอง
        </button>
      </form>
    </section>

    <template v-else>
      <section
        v-if="state.queues.length"
        class="rounded-[1.15rem] border border-purple-200 bg-purple-50/80 p-4 dark:border-purple-900 dark:bg-purple-950/20"
        data-testid="active-booking-queues"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p class="text-xs font-black uppercase tracking-[0.14em] text-purple-700 dark:text-purple-300">Your booking queue</p>
            <h2 class="mt-1 text-lg font-black">รายการจองที่กำลังดำเนินการ</h2>
          </div>
          <span class="rounded-full bg-purple-100 px-3 py-1 text-xs font-black text-purple-800 dark:bg-purple-900/50 dark:text-purple-200">
            {{ state.queues.length }} รายการ
          </span>
        </div>
        <div class="mt-3 grid gap-2">
          <article
            v-for="queue in state.queues"
            :key="queue.id"
            class="grid gap-3 rounded-xl border bg-white p-3 dark:border-stone-700 dark:bg-stone-900 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="rounded-full px-2.5 py-1 text-xs font-black"
                  :class="queue.status === 'hold' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'"
                >{{ queue.status === "hold" ? "กำลังจอง" : "รอตรวจสอบ" }}</span>
                <strong v-if="queue.status === 'hold'" class="text-sm text-purple-700 dark:text-purple-300">
                  เหลือ {{ queueCountdown(queue) }} นาที
                </strong>
              </div>
              <p class="mt-2 font-black">{{ queue.courtNames.join(", ") }}</p>
              <p class="mt-1 text-sm font-bold text-stone-500">
                {{ new Date(queue.startAt).toLocaleString("th-TH") }}–{{ new Date(queue.endAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) }} น. · ฿{{ Number(queue.totalPriceThb || 0).toLocaleString("th-TH") }}
              </p>
            </div>
            <button
              type="button"
              class="booking-primary-button h-11 justify-center px-4"
              @click="openQueuePayment(queue)"
            >
              {{ queue.status === "hold" ? "แสดง QR / อัปโหลดสลิป" : "ดูสถานะ" }}
            </button>
          </article>
        </div>
      </section>

      <section class="public-date-bar">
        <div>
          <p
            class="text-xs font-black uppercase tracking-[0.14em] text-court-700"
          >
            เลือกวันและช่วงเวลา
          </p>
          <h2 class="mt-1 text-lg font-black">{{ displayDate }}</h2>
        </div>
        <div class="booking-date-control">
          <button
            class="booking-date-arrow"
            :disabled="!canChangeBookingDate"
            aria-label="วันก่อนหน้า"
            @click="changeDate(-1)"
          >
            &lt;
          </button>
          <label class="booking-date-label"
            ><CalendarDays class="h-5 w-5 text-court-700" /><input
              v-model="state.date"
              type="date"
              :disabled="!canChangeBookingDate"
              class="bg-transparent font-bold outline-none"
              aria-label="วันที่จอง"
              @change="
                clearSelection();
                load();
              "
          /></label>
          <button
            class="booking-date-arrow"
            :disabled="!canChangeBookingDate"
            aria-label="วันถัดไป"
            @click="changeDate(1)"
          >
            &gt;
          </button>
        </div>
        <button
          class="booking-today-button"
          type="button"
          :disabled="!canChangeBookingDate"
          @click="goToday"
        >
          วันนี้
        </button>
      </section>

      <section class="public-schedule-card">
        <div ref="scheduleScroll" class="public-schedule-scroll">
          <table class="public-timeline-table border-collapse">
            <thead>
              <tr class="booking-table-head">
                <th class="public-court-sticky">สนาม / เวลา</th>
                <th
                  v-for="minute in slots"
                  :key="minute"
                  class="public-time-heading"
                >
                  {{ label(minute) }} น.
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="court in state.courts" :key="court.id" class="border-b">
                <th class="public-court-sticky public-court-row-heading">
                  <span>{{ court.name }}</span>
                  <small>฿{{ court.pricePerInterval }} / ช่วง</small>
                </th>
                <td v-for="minute in slots" :key="minute" class="public-slot-cell">
                  <button
                    class="public-slot"
                    :class="slotClass(court, minute)"
                    :disabled="status(court, minute).tone !== 'free'"
                    :aria-pressed="isSelected(court, minute)"
                    :data-testid="`slot-${court.id}-${minute}`"
                    @click="selectSlot(court, minute)"
                  >
                    {{ status(court, minute).text }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <table v-if="false" class="w-full min-w-[760px] border-collapse">
            <thead>
              <tr class="booking-table-head">
                <th class="sticky left-0 z-10 min-w-24 bg-[#13344c] p-3">
                  เวลา
                </th>
                <th
                  v-for="court in state.courts"
                  :key="court.id"
                  class="public-court-heading p-3"
                >
                  {{ court.name
                  }}<span class="mt-1 block text-xs font-medium opacity-70"
                    >฿{{ court.pricePerInterval }} / ช่วง</span
                  >
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="minute in slots" :key="minute" class="border-b">
                <th class="booking-time-cell">{{ label(minute) }} น.</th>
                <td v-for="court in state.courts" :key="court.id" class="p-1.5">
                  <button
                    class="public-slot"
                    :class="slotClass(court, minute)"
                    :disabled="status(court, minute).tone !== 'free'"
                    :aria-pressed="isSelected(court, minute)"
                    :data-testid="`slot-${court.id}-${minute}`"
                    @click="select(court, minute)"
                  >
                    {{ status(court, minute).text }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="public-booking-legend">
          <span><i class="legend-dot legend-dot--free"></i>ว่าง</span>
          <span><i class="legend-dot legend-dot--selected"></i>เลือกแล้ว</span>
          <span><i class="legend-dot legend-dot--hold"></i>กำลังจอง</span>
          <span><i class="legend-dot legend-dot--pending"></i>รอตรวจสอบ</span>
          <span><i class="legend-dot legend-dot--busy"></i>จองแล้ว</span>
          <span><i class="legend-dot legend-dot--closed"></i>ปิดสนาม</span>
        </div>
      </section>

      <section
        v-if="selections.length"
        class="public-booking-summary"
        data-testid="booking-summary"
      >
        <button
          class="absolute right-3 top-3 text-stone-400"
          aria-label="ยกเลิกการเลือกทั้งหมด"
          @click="clearSelection"
        >
          <X class="h-4 w-4" />
        </button>
        <div class="min-w-0">
          <p class="text-xs font-black uppercase tracking-[0.14em] text-court-700">
            สรุปการจอง · {{ selections.length }} ช่วง
          </p>
          <div class="public-selection-list">
            <span v-for="item in bookingItems" :key="`${item.courtId}-${item.startAt}`">
              {{ item.courtName }} {{ label(item.startMinute) }}–{{ label(item.endMinute) }}
            </span>
          </div>
          <p class="mt-1 text-sm font-bold text-stone-500">
            รวม {{ selectedDuration }} นาที · เลือกข้ามสนามและข้ามชั่วโมงได้
          </p>
        </div>
        <div class="text-right">
          <p class="text-xs font-bold text-stone-500">ยอดรวม</p>
          <p class="text-3xl font-black text-court-700">
            ฿{{ total.toLocaleString("th-TH") }}
          </p>
        </div>
        <button class="booking-primary-button h-12" @click="holdBatch">
          ล็อกเวลาทั้งหมด 5 นาทีและชำระเงิน
        </button>
      </section>

      <section
        v-if="false"
        class="public-booking-summary"
        data-testid="booking-summary"
      >
        <button
          class="absolute right-3 top-3 text-stone-400"
          aria-label="ยกเลิกการเลือก"
          @click="clearSelection"
        >
          <X class="h-4 w-4" />
        </button>
        <div class="min-w-0">
          <p
            class="text-xs font-black uppercase tracking-[0.14em] text-court-700"
          >
            สรุปการจอง
          </p>
          <h2 class="truncate text-lg font-black">{{ selectedCourt?.name }}</h2>
          <p class="mt-1 text-sm font-bold text-stone-500">
            {{
              new Date(selection.startAt).toLocaleTimeString("th-TH", {
                hour: "2-digit",
                minute: "2-digit",
              })
            }}–{{
              new Date(selection.endAt).toLocaleTimeString("th-TH", {
                hour: "2-digit",
                minute: "2-digit",
              })
            }}
            · {{ selectedDuration }} นาที
          </p>
        </div>
        <div class="text-right">
          <p class="text-xs font-bold text-stone-500">ยอดรวม</p>
          <p class="text-3xl font-black text-court-700">
            ฿{{ total.toLocaleString("th-TH") }}
          </p>
        </div>
        <button class="booking-primary-button h-12" @click="hold">
          ล็อกเวลา 5 นาทีและชำระเงิน
        </button>
      </section>
    </template>

    <div
      v-if="payment"
      class="fixed inset-0 z-50 grid place-items-end bg-black/60 p-3 sm:place-items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="public-payment-title"
      @click.self="payment = null"
      @keydown.esc="payment = null"
    >
      <section class="public-payment-sheet">
        <button
          class="booking-icon-button absolute right-4 top-4"
          aria-label="ปิด"
          @click="payment = null"
        >
          <X class="h-4 w-4" />
        </button>
        <template v-if="payment.status !== 'pending_review'">
          <Clock3 class="h-7 w-7 text-purple-600" />
          <p
            class="mt-4 text-xs font-black uppercase tracking-[0.14em] text-purple-700"
          >
            กรุณาชำระภายใน {{ paymentCountdown }} นาที
          </p>
          <h2 id="public-payment-title" class="mt-1 text-2xl font-black">
            ชำระ ฿{{ payment.totalPriceThb?.toLocaleString("th-TH") }}
          </h2>
          <img
            v-if="qr"
            :src="qr"
            alt="QR PromptPay"
            class="mx-auto mt-5 h-64 w-64 rounded-2xl border bg-white p-3"
          />
          <p
            v-else
            class="mt-4 rounded-xl bg-amber-50 p-3 font-bold text-amber-800"
          >
            ยังไม่ได้ตั้งค่า PromptPay กรุณาติดต่อผู้ดูแล
          </p>
          <label class="booking-primary-button mt-5 h-12 cursor-pointer"
            ><Upload class="h-4 w-4" />อัปโหลดสลิป<input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              class="hidden"
              @change="upload"
          /></label>
          <p class="mt-3 text-xs text-stone-500">
            รองรับ JPEG, PNG, WebP ขนาดไม่เกิน 5 MB
          </p>
        </template>
        <template v-else>
          <div
            class="mx-auto grid h-16 w-16 place-items-center rounded-full bg-court-50 text-court-700"
          >
            <CheckCircle2 class="h-9 w-9" />
          </div>
          <h2 class="mt-5 text-2xl font-black">ส่งสลิปแล้ว</h2>
          <p class="mt-2 text-stone-500">
            รอผู้ดูแลตรวจสอบ คุณสามารถติดตามสถานะได้ในโปรไฟล์
          </p>
          <button
            v-if="state.member?.profileToken"
            class="booking-primary-button mt-6 h-12"
            @click="goToProfile"
          >
            ไปที่โปรไฟล์
          </button>
        </template>
      </section>
    </div>
  </main>
</template>
