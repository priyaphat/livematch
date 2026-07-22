<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import {
  ArrowLeft,
  CalendarDays,
  CreditCard,
  History,
  Moon,
  Save,
  Sun,
  Upload,
  UserRound,
} from "@lucide/vue";

const props = defineProps(["apiRequest", "token", "theme"]);
const emit = defineEmits(["toggle-theme"]);
const state = reactive({
  member: null,
  bookingToken: "",
  bookings: [],
  payments: [],
  matches: [],
  loading: true,
  error: "",
  now: Date.now(),
});
const activeSection = ref("bookings");
const saveStatus = ref("");
const uploadingId = ref("");
const uploadStatus = ref("");
let clock;
let refreshingExpired = false;
const statusText = (status) =>
  ({
    hold: "กำลังจอง",
    pending_review: "รอตรวจสอบ",
    confirmed: "ยืนยันแล้ว",
    rejected: "ไม่อนุมัติ",
    cancelled: "ยกเลิก",
    expired: "หมดเวลา",
    paid: "ชำระแล้ว",
    unpaid: "ยังไม่ชำระ",
    pending: "รอตรวจ",
  })[status] || status;
const upcomingCount = computed(
  () =>
    state.bookings.filter((booking) =>
      ["hold", "pending_review", "confirmed"].includes(booking.status),
    ).length,
);

async function load() {
  state.loading = true;
  try {
    Object.assign(state, await props.apiRequest(`/api/profile/${props.token}`));
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
  }
}
async function save() {
  saveStatus.value = "";
  try {
    await props.apiRequest(`/api/profile/${props.token}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: state.member.name,
        phone: state.member.phone,
      }),
    });
    saveStatus.value = "บันทึกข้อมูลแล้ว";
    await load();
  } catch (error) {
    state.error = error.message;
  }
}
function goBooking() {
  if (state.bookingToken)
    window.location.assign(`/booking/${state.bookingToken}`);
}
function timestamp(value) {
  const normalized = String(value || "").replace(/([+-]\d{2})$/, "$1:00");
  const result = Date.parse(normalized);
  return Number.isFinite(result) ? result : 0;
}
function remainingText(booking) {
  const seconds = Math.max(
    0,
    Math.ceil((timestamp(booking.holdExpiresAt) - state.now) / 1000),
  );
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function uploadSlip(event, booking) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  ) {
    state.error = "รองรับสลิป JPEG, PNG หรือ WebP ขนาดไม่เกิน 5 MB";
    return;
  }
  uploadingId.value = booking.id;
  uploadStatus.value = "";
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      await props.apiRequest(
        `/api/public-booking/${state.bookingToken}/slip/${booking.id}`,
        { method: "POST", body: JSON.stringify({ slipData: reader.result }) },
      );
      uploadStatus.value = "อัปโหลดสลิปแล้ว รอผู้ดูแลตรวจสอบ";
      await load();
    } catch (error) {
      state.error = error.message;
    } finally {
      uploadingId.value = "";
    }
  };
  reader.readAsDataURL(file);
}
onMounted(async () => {
  await load();
  clock = window.setInterval(async () => {
    state.now = Date.now();
    const expired = state.bookings.some(
      (booking) =>
        booking.status === "hold" &&
        booking.holdExpiresAt &&
        timestamp(booking.holdExpiresAt) <= state.now,
    );
    if (expired && !refreshingExpired) {
      refreshingExpired = true;
      await load();
      refreshingExpired = false;
    }
  }, 1000);
});
onUnmounted(() => window.clearInterval(clock));
</script>

<template>
  <main class="profile-shell">
    <header class="profile-header">
      <div class="flex items-center gap-3">
        <button
          class="booking-icon-button"
          aria-label="กลับ"
          @click="history.back()"
        >
          <ArrowLeft class="h-5 w-5" />
        </button>
        <div>
          <p
            class="text-xs font-black uppercase tracking-[0.16em] text-court-700"
          >
            LiveMatch profile
          </p>
          <h1 class="text-xl font-black sm:text-2xl">ข้อมูลสมาชิกและประวัติ</h1>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
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
        <span
          class="rounded-full bg-court-50 px-3 py-1.5 text-sm font-black text-court-700"
          >{{
            state.member.active === false ? "ปิดใช้งาน" : "สมาชิกที่ใช้งานอยู่"
          }}</span
        >
        <button
          v-if="state.bookingToken"
          class="booking-primary-button h-11"
          @click="goBooking"
        >
          <CalendarDays class="h-4 w-4" />จองสนาม
        </button>
        </template>
      </div>
    </header>
    <p
      v-if="state.error"
      class="rounded-xl bg-red-50 p-3 font-bold text-red-700"
    >
      {{ state.error }}
    </p>

    <template v-if="state.member">
      <section class="profile-overview">
        <div class="profile-avatar"><UserRound class="h-8 w-8" /></div>
        <div class="min-w-0">
          <h2 class="truncate text-2xl font-black">{{ state.member.name }}</h2>
          <p class="truncate text-sm text-stone-500">
            {{ state.member.email }}
          </p>
        </div>
        <div class="profile-stat">
          <strong>{{ upcomingCount }}</strong
          ><span>รายการที่กำลังดำเนินการ</span>
        </div>
        <div class="profile-stat">
          <strong>{{ state.bookings.length }}</strong
          ><span>ประวัติการจองทั้งหมด</span>
        </div>
      </section>

      <div class="profile-layout">
        <aside class="profile-editor">
          <div>
            <p
              class="text-xs font-black uppercase tracking-[0.14em] text-court-700"
            >
              Personal details
            </p>
            <h2 class="mt-1 text-lg font-black">ข้อมูลพื้นฐาน</h2>
          </div>
          <div class="mt-5 grid gap-4">
            <label class="booking-field"
              ><span>ชื่อ</span><input v-model="state.member.name"
            /></label>
            <label class="booking-field"
              ><span>เบอร์โทร</span
              ><input v-model="state.member.phone" inputmode="tel"
            /></label>
            <label class="booking-field"
              ><span>อีเมล (แก้ไขไม่ได้)</span
              ><input :value="state.member.email" disabled
            /></label>
          </div>
          <p v-if="saveStatus" class="mt-3 text-sm font-bold text-court-700">
            {{ saveStatus }}
          </p>
          <button class="booking-primary-button mt-5 h-12 w-full" @click="save">
            <Save class="h-4 w-4" />บันทึกข้อมูล
          </button>
        </aside>

        <section class="profile-activity">
          <nav class="profile-tabs" aria-label="ประวัติสมาชิก">
            <button
              :class="activeSection === 'bookings' && 'is-active'"
              @click="activeSection = 'bookings'"
            >
              <CalendarDays class="h-4 w-4" />การจอง
              <span>{{ state.bookings.length }}</span>
            </button>
            <button
              :class="activeSection === 'payments' && 'is-active'"
              @click="activeSection = 'payments'"
            >
              <CreditCard class="h-4 w-4" />การชำระเงิน
              <span>{{ state.payments.length }}</span>
            </button>
            <button
              :class="activeSection === 'matches' && 'is-active'"
              @click="activeSection = 'matches'"
            >
              <History class="h-4 w-4" />Match history
              <span>{{ state.matches.length }}</span>
            </button>
          </nav>

          <div v-if="activeSection === 'bookings'" class="profile-list">
            <p
              v-if="uploadStatus"
              class="m-3 rounded-xl bg-court-50 p-3 text-sm font-black text-court-700"
            >
              {{ uploadStatus }}
            </p>
            <article
              v-for="booking in state.bookings"
              :key="booking.id"
              class="profile-list-row profile-booking-row"
            >
              <div class="profile-row-icon">
                <CalendarDays class="h-5 w-5" />
              </div>
              <div class="min-w-0">
                <p class="font-black">{{ booking.courtName }}</p>
                <p class="mt-1 text-sm text-stone-500">
                  {{ new Date(booking.startAt).toLocaleString("th-TH") }}–{{
                    new Date(booking.endAt).toLocaleTimeString("th-TH", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  }}
                </p>
              </div>
              <div class="profile-booking-actions text-right">
                <span class="profile-status">{{
                  statusText(booking.status)
                }}</span>
                <p class="mt-2 font-black">฿{{ booking.totalPriceThb }}</p>
                <p
                  v-if="booking.status === 'hold' && booking.holdExpiresAt"
                  class="mt-1 text-xs font-black text-amber-600"
                >
                  เหลือ {{ remainingText(booking) }} นาที
                </p>
                <label
                  v-if="booking.status === 'hold' && state.bookingToken"
                  class="mt-2 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-court-500 px-3 text-xs font-black text-white"
                  :class="uploadingId === booking.id && 'pointer-events-none opacity-60'"
                >
                  <Upload class="h-3.5 w-3.5" />
                  {{ uploadingId === booking.id ? "กำลังอัปโหลด" : "อัปโหลดสลิป" }}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    class="hidden"
                    @change="uploadSlip($event, booking)"
                  />
                </label>
              </div>
            </article>
            <p v-if="!state.bookings.length" class="profile-empty">
              ยังไม่มีประวัติการจอง
            </p>
          </div>

          <div v-else-if="activeSection === 'payments'" class="profile-list">
            <article
              v-for="payment in state.payments"
              :key="`${payment.kind}-${payment.id}-${payment.createdAt}`"
              class="profile-list-row"
            >
              <div class="profile-row-icon"><CreditCard class="h-5 w-5" /></div>
              <div>
                <p class="font-black">
                  {{
                    payment.kind === "booking" ? "ค่าจองสนาม" : "ค่าเล่น Match"
                  }}
                </p>
                <p class="mt-1 text-sm text-stone-500">
                  {{ payment.createdAt }}
                </p>
              </div>
              <div class="text-right">
                <span class="profile-status">{{
                  statusText(payment.status)
                }}</span>
                <p class="mt-2 font-black">฿{{ payment.amountThb }}</p>
              </div>
            </article>
            <p v-if="!state.payments.length" class="profile-empty">
              ยังไม่มีรายการชำระเงิน
            </p>
          </div>

          <div v-else class="profile-list">
            <article
              v-for="match in state.matches"
              :key="`${match.sessionName}-${match.matchId}`"
              class="profile-list-row"
            >
              <div class="profile-row-icon"><History class="h-5 w-5" /></div>
              <div>
                <p class="font-black">
                  {{ match.sessionName }} · เกม {{ match.matchId }}
                </p>
                <p class="mt-1 text-sm text-stone-500">
                  {{ match.startedAt }}–{{ match.endedAt }}
                </p>
              </div>
              <div class="text-right">
                <span class="profile-status">{{ match.status }}</span>
                <p class="mt-2 font-black">{{ match.court }}</p>
              </div>
            </article>
            <p v-if="!state.matches.length" class="profile-empty">
              ยังไม่มีประวัติการแข่งขันที่เชื่อมสมาชิก
            </p>
          </div>
        </section>
      </div>
    </template>
  </main>
</template>
