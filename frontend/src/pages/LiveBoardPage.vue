<script setup>
import { Check, X } from '@lucide/vue'

defineProps([
  'state',
  'forms',
  'ui',
  'playerName',
  'adjustShuttle',
  'closeLive',
  'requestCancelMatch',
  'confirmCancelMatch'
])
</script>

<template>
  <section class="grid gap-3">
    <article v-for="match in state.live" :key="match.id" class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-sm text-stone-500">เกมที่ {{ match.id }} · {{ match.court }} · {{ match.status }}</p>
          <h2 class="mt-1 text-xl font-black">{{ playerName(match.a1) }} + {{ playerName(match.a2) }} vs {{ playerName(match.b1) }} + {{ playerName(match.b2) }}</h2>
        </div>
        <span class="rounded-md bg-shuttle-400 px-3 py-1 text-sm font-bold text-stone-900">ลูกแบด {{ match.shuttles }}</span>
      </div>

      <div class="mt-4 flex flex-wrap gap-2">
        <button class="grid h-10 w-10 place-items-center rounded-md border border-stone-200 dark:border-stone-700" @click="adjustShuttle(match, -1)">-</button>
        <button class="grid h-10 w-10 place-items-center rounded-md border border-stone-200 dark:border-stone-700" @click="adjustShuttle(match, 1)">+</button>
        <button class="inline-flex h-10 items-center gap-2 rounded-md bg-court-500 px-4 font-semibold text-white" @click="closeLive(match, false)">
          <Check class="h-4 w-4" />
          จบ
        </button>
        <button class="inline-flex h-10 items-center gap-2 rounded-md bg-red-600 px-4 font-semibold text-white" @click="requestCancelMatch(match)">
          <X class="h-4 w-4" />
          ยกเลิก
        </button>
      </div>
    </article>

    <div v-if="ui.showCancelModal" class="fixed inset-0 z-40 grid place-items-end bg-black/40 p-3 sm:place-items-center">
      <div class="w-full max-w-md rounded-lg bg-white p-4 shadow-soft dark:bg-stone-900">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-black">ยกเลิกการแข่งขัน</h2>
            <p class="mt-1 text-sm text-stone-500 dark:text-stone-400">บันทึกหมายเหตุสำหรับเกมที่ {{ ui.cancelMatch?.id }}</p>
          </div>
          <button class="grid h-9 w-9 place-items-center rounded-md border border-stone-200 dark:border-stone-700" aria-label="ปิด modal" @click="ui.showCancelModal = false">
            <X class="h-4 w-4" />
          </button>
        </div>

        <textarea
          v-model="forms.cancelNote"
          class="mt-4 min-h-28 w-full rounded-md border border-stone-200 bg-paper-50 p-3 outline-none focus:border-court-500 dark:border-stone-700 dark:bg-stone-800"
          placeholder="เช่น ผู้เล่นเจ็บ / สนามไม่ว่าง / ยกเลิกตามคำขอ"
        />

        <div class="mt-4 grid grid-cols-2 gap-2">
          <button class="h-11 rounded-md border border-stone-200 font-bold dark:border-stone-700" @click="ui.showCancelModal = false">กลับ</button>
          <button class="h-11 rounded-md bg-red-600 font-bold text-white" @click="confirmCancelMatch">บันทึกยกเลิก</button>
        </div>
      </div>
    </div>
  </section>
</template>
