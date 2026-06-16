<script setup>
import { computed } from 'vue'

const props = defineProps([
  'state',
  'playerName'
])

const sortedHistory = computed(() => [...props.state.history].sort((a, b) => a.id - b.id))

function winnerText(match) {
  if (!match.winner) return '-'
  return match.winner === 'A'
    ? `${props.playerName(match.a1)} + ${props.playerName(match.a2)}`
    : `${props.playerName(match.b1)} + ${props.playerName(match.b2)}`
}
</script>

<template>
  <section class="grid gap-3">
    <article
      v-for="match in sortedHistory"
      :key="match.id"
      class="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-soft dark:border-stone-700 dark:bg-stone-900"
    >
      <div class="flex items-start justify-between gap-3 border-b border-stone-100 bg-paper-100 p-3 dark:border-stone-800 dark:bg-stone-800">
        <div>
          <p class="text-xs font-bold text-stone-500 dark:text-stone-400">เกมที่</p>
          <h2 class="text-2xl font-black">{{ match.id }}</h2>
        </div>
        <div class="text-right">
          <p class="text-xs font-bold text-stone-500 dark:text-stone-400">สนาม</p>
          <p class="font-black">{{ match.court }}</p>
        </div>
      </div>

      <div class="grid gap-3 p-3">
        <div class="grid gap-2 rounded-md border border-stone-100 p-3 dark:border-stone-800">
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm font-bold text-stone-500">ทีม A</span>
            <span v-if="match.winner === 'A'" class="rounded-md bg-court-500/10 px-2 py-1 text-xs font-black text-court-700 dark:text-court-300">ชนะ</span>
          </div>
          <p class="text-lg font-black">{{ playerName(match.a1) }} + {{ playerName(match.a2) }}</p>
        </div>

        <div class="grid gap-2 rounded-md border border-stone-100 p-3 dark:border-stone-800">
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm font-bold text-stone-500">ทีม B</span>
            <span v-if="match.winner === 'B'" class="rounded-md bg-court-500/10 px-2 py-1 text-xs font-black text-court-700 dark:text-court-300">ชนะ</span>
          </div>
          <p class="text-lg font-black">{{ playerName(match.b1) }} + {{ playerName(match.b2) }}</p>
        </div>

        <div class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
            <p class="text-xs text-stone-500 dark:text-stone-400">เริ่ม</p>
            <p class="font-black">{{ match.startedAt || '-' }}</p>
          </div>
          <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
            <p class="text-xs text-stone-500 dark:text-stone-400">จบ</p>
            <p class="font-black">{{ match.endedAt || '-' }}</p>
          </div>
          <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
            <p class="text-xs text-stone-500 dark:text-stone-400">ลูกแบด</p>
            <p class="font-black">{{ match.shuttles }}</p>
          </div>
          <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
            <p class="text-xs text-stone-500 dark:text-stone-400">Sequence</p>
            <p class="font-black">{{ match.shuttleSequence || '-' }}</p>
          </div>
        </div>

        <div class="rounded-md bg-paper-100 p-3 text-sm dark:bg-stone-800">
          <p class="text-xs text-stone-500 dark:text-stone-400">ผู้ชนะ</p>
          <p class="mt-1 font-bold">{{ winnerText(match) }}</p>
          <p v-if="match.note" class="mt-2 text-stone-600 dark:text-stone-300">{{ match.note }}</p>
        </div>
      </div>
    </article>
  </section>
</template>
