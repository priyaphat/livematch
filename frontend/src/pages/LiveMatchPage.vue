<script setup>
import { ClipboardList, Play, Shuffle, Users } from '@lucide/vue'

defineProps([
  'state',
  'forms',
  'ui',
  'matchLevelLabel',
  'randomMatch',
  'startMatch',
  'playerName',
  'availableCourtNames'
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
            <p class="text-sm text-stone-500">เกมที่ {{ match.id }} · ระดับ {{ matchLevelLabel(match) }}</p>
            <h2 class="mt-1 text-xl font-black">{{ playerName(match.a1) }} + {{ playerName(match.a2) }} vs {{ playerName(match.b1) }} + {{ playerName(match.b2) }}</h2>
          </div>
          <div class="grid grid-cols-[1fr_auto] gap-2 sm:min-w-72">
            <select v-model="forms.matchCourts[match.id]" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800">
              <option disabled value="">{{ availableCourtNames.length ? 'เลือกสนาม' : 'สนามเต็ม' }}</option>
              <option v-for="court in availableCourtNames" :key="court" :value="court">{{ court }}</option>
            </select>
            <button
              class="inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 font-bold text-white transition disabled:cursor-not-allowed"
              :class="forms.matchCourts[match.id] ? 'bg-court-500' : 'bg-stone-400'"
              :disabled="!forms.matchCourts[match.id]"
              @click="startMatch(match, forms.matchCourts[match.id])"
            >
              <Play class="h-4 w-4" />
              เริ่ม
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
