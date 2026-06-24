<script setup>
import { Clock3, Play, QrCode, XCircle } from '@lucide/vue'

defineProps([
  'state',
  'forms',
  'matchLevelLabel',
  'openQueueQr',
  'startMatch',
  'cancelQueuedMatch',
  'playerName',
  'availableCourtNames',
  'isSessionReadOnly'
])
</script>

<template>
  <section class="grid gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
      <div class="flex items-center gap-3">
        <span class="grid h-11 w-11 place-items-center rounded-md bg-court-500/10 text-court-700 dark:text-court-300">
          <Clock3 class="h-5 w-5" />
        </span>
        <div>
          <h1 class="text-xl font-black">รอคิว</h1>
          <p class="text-sm font-semibold text-stone-500 dark:text-stone-400">เกมที่ยืนยันแล้ว รอเลือกสนามและเริ่มการแข่งขัน</p>
        </div>
      </div>
      <div class="grid w-full gap-2 sm:w-auto">
        <button class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-court-500 px-4 text-sm font-bold text-white" @click="openQueueQr">
          <QrCode class="h-4 w-4" />
          QR แสดงคิว
        </button>
      </div>
    </div>

    <div v-if="!state.queue.length" class="rounded-lg border border-stone-200 bg-white p-6 text-center shadow-soft dark:border-stone-700 dark:bg-stone-900">
      <p class="font-black">ยังไม่มีเกมรอคิว</p>
      <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">ยืนยันคู่จากหน้าจัดคู่ก่อน แล้วเกมจะมาแสดงที่นี่</p>
    </div>

    <div class="grid gap-3">
      <article v-for="match in state.queue" :key="match.id" class="relative rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
        <div class="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
          <div>
            <p class="text-sm text-stone-500">เกมที่ {{ match.id }} · ระดับ {{ matchLevelLabel(match) }}</p>
            <h2 class="mt-1 text-xl font-black">{{ playerName(match.a1) }} + {{ playerName(match.a2) }} vs {{ playerName(match.b1) }} + {{ playerName(match.b2) }}</h2>
          </div>
          <div class="grid gap-2 sm:min-w-96 sm:grid-cols-[1fr_auto_auto]">
            <select v-model="forms.matchCourts[match.id]" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" :disabled="isSessionReadOnly">
              <option disabled value="">{{ availableCourtNames.length ? 'เลือกสนาม' : 'สนามเต็ม' }}</option>
              <option v-for="court in availableCourtNames" :key="court" :value="court">{{ court }}</option>
            </select>
            <button
              class="inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 font-bold text-white transition disabled:cursor-not-allowed"
              :class="forms.matchCourts[match.id] ? 'bg-court-500' : 'bg-stone-400'"
              :disabled="isSessionReadOnly || !forms.matchCourts[match.id]"
              @click="startMatch(match, forms.matchCourts[match.id])"
            >
              <Play class="h-4 w-4" />
              เริ่ม
            </button>
            <button
              class="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 text-sm font-bold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300 dark:hover:bg-rose-950/30"
              aria-label="ยกเลิกคิวเกม"
              title="ยกเลิกคิวเกม"
              :disabled="isSessionReadOnly"
              @click="cancelQueuedMatch(match)"
            >
              <XCircle class="h-4 w-4" />
              ยกเลิกคิว
            </button>
          </div>
          <p v-if="!forms.matchCourts[match.id]" class="text-xs font-semibold text-amber-700 dark:text-shuttle-400 sm:col-span-2">
            ต้องเลือกสนามก่อนเริ่มการแข่งขัน
          </p>
        </div>
      </article>
    </div>
  </section>
</template>
