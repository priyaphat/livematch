<script setup>
defineProps([
  'state',
  'share',
  'money',
  'playerCost'
])
</script>

<template>
  <section class="mx-auto grid max-w-xl gap-4 px-4 py-5">
    <div class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
      <p class="text-sm font-semibold text-court-700 dark:text-court-500">LiveMatch</p>
      <h1 class="mt-1 text-2xl font-black">{{ state.session.name }}</h1>
      <p class="mt-1 text-sm text-stone-500 dark:text-stone-400">รายชื่อสมาชิกและสรุปค่าใช้จ่าย</p>
    </div>

    <div v-if="share.loading" class="rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-500 dark:border-stone-700 dark:bg-stone-900">
      กำลังโหลดข้อมูล
    </div>

    <div v-else-if="share.error" class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
      {{ share.error }}
    </div>

    <div v-else class="rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
      <div class="grid grid-cols-[1fr_4rem_4rem] gap-2 border-b border-stone-200 bg-paper-100 p-3 text-sm font-black text-stone-600 dark:border-stone-800 dark:bg-stone-800 dark:text-stone-200">
        <span>ชื่อ</span>
        <span class="text-right">เกม</span>
        <span class="text-right">ลูก</span>
      </div>

      <div v-if="!state.players.length" class="p-4 text-sm text-stone-500">
        ยังไม่มีสมาชิก
      </div>

      <div v-for="player in state.players" :key="player.id" class="border-b border-stone-100 p-3 last:border-b-0 dark:border-stone-800">
        <div class="grid grid-cols-[1fr_4rem_4rem] items-baseline gap-2">
          <span class="truncate text-base font-black">{{ player.name }}</span>
          <span class="text-right font-bold">{{ player.games }}</span>
          <span class="text-right font-bold">{{ player.shuttles }}</span>
        </div>
        <p class="mt-2 text-sm font-semibold text-stone-600 dark:text-stone-300">
          ค่าใช้จ่าย {{ money(playerCost(player)) }}
          <span v-if="share.showPayment" :class="player.paid ? 'text-court-700 dark:text-court-500' : 'text-amber-700 dark:text-shuttle-400'">
            {{ player.paid ? 'จ่ายแล้ว' : 'ยังไม่ได้จ่าย' }}
          </span>
        </p>
      </div>
    </div>
  </section>
</template>
