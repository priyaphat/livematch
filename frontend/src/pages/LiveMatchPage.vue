<script setup>
import { Check, ClipboardList, Shuffle, Users, X } from '@lucide/vue'

defineProps([
  'state',
  'ui',
  'matchLevelLabel',
  'randomMatch',
  'confirmPendingMatch',
  'cancelPendingMatch',
  'playerName'
])
</script>

<template>
  <section class="grid gap-4">
    <div class="flex flex-wrap gap-2">
      <button class="inline-flex h-11 items-center gap-2 rounded-md border border-stone-200 bg-white px-4 font-semibold dark:border-stone-700 dark:bg-stone-900" @click="ui.showCoupleModal = true">
        <Users class="h-4 w-4" />
        จับคู่
      </button>
      <button class="inline-flex h-11 items-center gap-2 rounded-md border border-stone-200 bg-white px-4 font-semibold dark:border-stone-700 dark:bg-stone-900" @click="ui.showCouponModal = true">
        <ClipboardList class="h-4 w-4" />
        คูปองระดับมือ
      </button>
      <button class="inline-flex h-11 items-center gap-2 rounded-md bg-court-500 px-4 font-semibold text-white" @click="randomMatch">
        <Shuffle class="h-4 w-4" />
        Random
      </button>
    </div>

    <div v-if="!state.pending.length" class="rounded-lg border border-stone-200 bg-white p-6 text-center shadow-soft dark:border-stone-700 dark:bg-stone-900">
      <p class="font-black">ยังไม่มีคู่ที่รอยืนยัน</p>
      <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">เลือกสิทธิ์สุ่มแล้วกด Random เพื่อสร้างคู่ก่อนส่งไปรอคิว</p>
    </div>

    <div class="grid gap-3">
      <article v-for="match in state.pending" :key="match.id" class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
        <div class="grid gap-4">
          <div>
            <p class="text-sm font-bold text-stone-500">ระดับ {{ matchLevelLabel(match) }}</p>
            <h2 class="mt-1 text-xl font-black">{{ playerName(match.a1) }} + {{ playerName(match.a2) }} vs {{ playerName(match.b1) }} + {{ playerName(match.b2) }}</h2>
          </div>

          <div class="grid gap-2 sm:grid-cols-2">
            <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
              <p class="text-xs font-black text-stone-500 dark:text-stone-400">ทีม A</p>
              <p class="mt-1 font-black">{{ playerName(match.a1) }} + {{ playerName(match.a2) }}</p>
            </div>
            <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
              <p class="text-xs font-black text-stone-500 dark:text-stone-400">ทีม B</p>
              <p class="mt-1 font-black">{{ playerName(match.b1) }} + {{ playerName(match.b2) }}</p>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <button class="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-stone-200 font-bold dark:border-stone-700" @click="cancelPendingMatch(match)">
              <X class="h-4 w-4" />
              ยกเลิกจับคู่
            </button>
            <button class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-court-500 font-bold text-white" @click="confirmPendingMatch(match)">
              <Check class="h-4 w-4" />
              ยืนยัน
            </button>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
