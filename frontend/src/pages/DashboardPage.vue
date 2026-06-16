<script setup>
import { Activity, BarChart3, ClipboardList, CreditCard, RefreshCw, Shuffle, Trophy, Users } from '@lucide/vue'

defineProps([
  'state',
  'activePlayerCount',
  'totalRecordedMatches',
  'averageGames',
  'minGames',
  'maxGames',
  'totalShuttles',
  'paymentPercent',
  'money',
  'totalRevenue',
  'paidRevenue',
  'unpaidRevenue',
  'unpaidPlayers',
  'topPlayers',
  'quietPlayers',
  'topWinners',
  'playerCost',
  'levelLabel'
])
</script>

<template>
  <section class="grid gap-4">
    <div class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-5">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p class="text-sm font-semibold text-court-600 dark:text-court-500">ภาพรวมวันนี้</p>
          <h1 class="mt-1 text-2xl font-black leading-tight sm:text-3xl">{{ state.session.name }}</h1>
          <p class="mt-1 text-sm text-stone-500 dark:text-stone-400">อัปเดตจากสมาชิก คิว สนามที่กำลังเล่น และประวัติการแข่งขัน</p>
        </div>
        <div class="grid grid-cols-2 gap-2 sm:min-w-64">
          <button class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-court-500 px-3 text-sm font-bold text-white" @click="state.tab = 'livematch'">
            <Shuffle class="h-4 w-4" />
            จัดคู่
          </button>
          <button class="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-stone-200 bg-paper-50 px-3 text-sm font-bold dark:border-stone-700 dark:bg-stone-800" @click="state.tab = 'players'">
            <Users class="h-4 w-4" />
            สมาชิก
          </button>
        </div>
      </div>

      <div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-md bg-paper-100 p-4 dark:bg-stone-800">
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm text-stone-500 dark:text-stone-400">ผู้เล่นวันนี้</p>
            <Users class="h-5 w-5 text-court-500" />
          </div>
          <p class="mt-2 text-3xl font-black">{{ activePlayerCount }}</p>
          <p class="text-xs text-stone-500 dark:text-stone-400">คนที่เปิดใช้งานใน session</p>
        </div>
        <div class="rounded-md bg-paper-100 p-4 dark:bg-stone-800">
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm text-stone-500 dark:text-stone-400">เกมทั้งหมด</p>
            <ClipboardList class="h-5 w-5 text-court-500" />
          </div>
          <p class="mt-2 text-3xl font-black">{{ totalRecordedMatches }}</p>
          <p class="text-xs text-stone-500 dark:text-stone-400">คิว {{ state.queue.length }} · กำลังเล่น {{ state.live.length }} · จบแล้ว {{ state.history.length }}</p>
        </div>
        <div class="rounded-md bg-paper-100 p-4 dark:bg-stone-800">
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm text-stone-500 dark:text-stone-400">เฉลี่ยเกมต่อคน</p>
            <BarChart3 class="h-5 w-5 text-court-500" />
          </div>
          <p class="mt-2 text-3xl font-black">{{ averageGames.toFixed(2) }}</p>
          <p class="text-xs text-stone-500 dark:text-stone-400">ต่ำสุด {{ minGames }} · สูงสุด {{ maxGames }}</p>
        </div>
        <div class="rounded-md bg-paper-100 p-4 dark:bg-stone-800">
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm text-stone-500 dark:text-stone-400">ลูกแบดใช้จริง</p>
            <RefreshCw class="h-5 w-5 text-court-500" />
          </div>
          <p class="mt-2 text-3xl font-black">{{ totalShuttles }}</p>
          <p class="text-xs text-stone-500 dark:text-stone-400">ลูกแบดรวม {{ totalShuttles * 4 }} ลูก</p>
        </div>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <div class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-stone-500 dark:text-stone-400">การเงิน</p>
            <h2 class="mt-1 text-xl font-black">รับแล้ว {{ paymentPercent }}%</h2>
          </div>
          <CreditCard class="h-6 w-6 text-court-500" />
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-3">
          <div class="rounded-md border border-stone-200 p-3 dark:border-stone-700">
            <p class="text-xs text-stone-500 dark:text-stone-400">รายรับรวม</p>
            <p class="mt-1 text-xl font-black">{{ money(totalRevenue) }}</p>
          </div>
          <div class="rounded-md border border-stone-200 p-3 dark:border-stone-700">
            <p class="text-xs text-stone-500 dark:text-stone-400">รับแล้ว</p>
            <p class="mt-1 text-xl font-black text-court-600 dark:text-court-500">{{ money(paidRevenue) }}</p>
          </div>
          <div class="rounded-md border border-stone-200 p-3 dark:border-stone-700">
            <p class="text-xs text-stone-500 dark:text-stone-400">ค้างชำระ</p>
            <p class="mt-1 text-xl font-black text-amber-700 dark:text-shuttle-400">{{ money(unpaidRevenue) }}</p>
          </div>
        </div>
        <div class="mt-4 h-3 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
          <div class="h-full rounded-full bg-court-500" :style="{ width: `${paymentPercent}%` }" />
        </div>
        <p class="mt-2 text-xs font-semibold text-stone-500 dark:text-stone-400">{{ unpaidPlayers.length }} คนค้างจ่าย</p>
      </div>

      <div class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-stone-500 dark:text-stone-400">สถานะสนาม</p>
            <h2 class="mt-1 text-xl font-black">{{ state.live.length }} เกมกำลังเล่น</h2>
          </div>
          <Activity class="h-6 w-6 text-court-500" />
        </div>
        <div class="mt-4 grid grid-cols-3 gap-2 text-center">
          <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
            <p class="text-2xl font-black">{{ state.queue.length }}</p>
            <p class="text-xs text-stone-500 dark:text-stone-400">รอลง</p>
          </div>
          <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
            <p class="text-2xl font-black">{{ state.live.length }}</p>
            <p class="text-xs text-stone-500 dark:text-stone-400">กำลังเล่น</p>
          </div>
          <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
            <p class="text-2xl font-black">{{ state.settings.courtNames.length }}</p>
            <p class="text-xs text-stone-500 dark:text-stone-400">สนาม</p>
          </div>
        </div>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-3">
      <div class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-5">
        <div class="flex items-center justify-between">
          <h2 class="font-black">ผู้ชนะมากสุด</h2>
          <Trophy class="h-5 w-5 text-court-500" />
        </div>
        <div class="mt-4 space-y-3">
          <div v-for="(player, index) in topWinners" :key="player.id" class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate font-bold">{{ index + 1 }}. {{ player.name }}</p>
              <p class="text-xs text-stone-500 dark:text-stone-400">แพ้ {{ player.losses || 0 }} · เล่น {{ player.games }} เกม</p>
            </div>
            <span class="rounded-md bg-paper-100 px-3 py-1 text-sm font-black dark:bg-stone-800">{{ player.wins || 0 }} ชนะ</span>
          </div>
        </div>
      </div>

      <div class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-5">
        <h2 class="font-black">ลงเล่นมากสุด</h2>
        <div class="mt-4 space-y-3">
          <div v-for="player in topPlayers" :key="player.id" class="flex items-center justify-between gap-3">
            <p class="truncate font-bold">{{ player.name }}</p>
            <span class="rounded-md bg-paper-100 px-3 py-1 text-sm font-black dark:bg-stone-800">{{ player.games }} เกม</span>
          </div>
        </div>
      </div>

      <div class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-5">
        <h2 class="font-black">ควรได้ลงรอบถัดไป</h2>
        <div class="mt-4 space-y-3">
          <div v-for="player in quietPlayers" :key="player.id" class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate font-bold">{{ player.name }}</p>
              <p class="text-xs text-stone-500 dark:text-stone-400">ระดับ {{ levelLabel(player.level) }}</p>
            </div>
            <span class="rounded-md bg-paper-100 px-3 py-1 text-sm font-black dark:bg-stone-800">{{ player.games }} เกม</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
