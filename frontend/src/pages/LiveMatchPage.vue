<script setup>
import { ClipboardList, Play, Shuffle, Users } from '@lucide/vue'

defineProps([
  'state',
  'forms',
  'ui',
  'levelLabel',
  'randomMatch',
  'startMatch',
  'playerName'
])
</script>

<template>
  <section class="grid gap-4">
    <div class="flex flex-wrap gap-2">
      <button class="inline-flex h-11 items-center gap-2 rounded-md border border-stone-200 bg-white px-4 font-semibold dark:border-stone-700 dark:bg-stone-900" @click="ui.showCoupleModal = true">
        <Users class="h-4 w-4" />
        คู่รัก
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

    <div class="grid gap-3">
      <article v-for="match in state.queue" :key="match.id" class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
        <div class="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
          <div>
            <p class="text-sm text-stone-500">เกมที่ {{ match.id }} · ระดับ {{ levelLabel(match.level) }}</p>
            <h2 class="mt-1 text-xl font-black">{{ playerName(match.a1) }} + {{ playerName(match.a2) }} vs {{ playerName(match.b1) }} + {{ playerName(match.b2) }}</h2>
          </div>
          <div class="grid grid-cols-[1fr_auto] gap-2 sm:min-w-72">
            <select v-model="forms.matchCourts[match.id]" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800">
              <option disabled value="">เลือกสนาม</option>
              <option v-for="court in state.settings.courtNames" :key="court" :value="court">{{ court }}</option>
            </select>
            <button class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-court-500 px-4 font-bold text-white" @click="startMatch(match, forms.matchCourts[match.id] || state.settings.courtNames[0])">
              <Play class="h-4 w-4" />
              เริ่ม
            </button>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
