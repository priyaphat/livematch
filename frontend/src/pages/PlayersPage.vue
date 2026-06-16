<script setup>
import { Check, Copy, Plus } from '@lucide/vue'

defineProps([
  'state',
  'forms',
  'money',
  'playerCost',
  'addPlayer',
  'sharePlayers',
  'saveSettings',
  'togglePayment'
])
</script>

<template>
  <section class="grid gap-4">
    <div class="grid gap-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900 md:grid-cols-[1fr_auto]">
      <input
        v-model="forms.newPlayerName"
        class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800"
        placeholder="ชื่อสมาชิกใหม่"
        @keyup.enter="addPlayer"
      />
      <button class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-court-500 px-4 font-semibold text-white" @click="addPlayer">
        <Plus class="h-4 w-4" />
        เพิ่ม
      </button>
    </div>

    <div class="grid gap-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
      <label class="flex items-center gap-2 text-sm">
        <input v-model="state.settings.showPaymentOnShare" type="checkbox" @change="saveSettings" />
        แสดงสถานะจ่ายเงินในลิงก์แชร์
      </label>
      <button class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white dark:bg-white dark:text-stone-900" @click="sharePlayers">
        <Copy class="h-4 w-4" />
        คัดลอกลิงก์สมาชิก
      </button>
      <input
        v-if="forms.shareLink"
        :value="forms.shareLink"
        readonly
        class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 text-xs text-stone-500 dark:border-stone-700 dark:bg-stone-800"
      />
      <p v-if="forms.shareStatus" class="text-sm font-semibold text-court-700 dark:text-court-500">{{ forms.shareStatus }}</p>
    </div>

    <div class="rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
      <div class="grid grid-cols-[1fr_4rem_4rem] gap-2 border-b border-stone-200 bg-paper-100 p-3 text-sm font-black text-stone-600 dark:border-stone-800 dark:bg-stone-800 dark:text-stone-200">
        <span>ชื่อ</span>
        <span class="text-right">เกม</span>
        <span class="text-right">ลูก</span>
      </div>

      <div v-if="!state.players.length" class="p-4 text-sm text-stone-500">
        ยังไม่มีสมาชิก
      </div>

      <button
        v-for="player in state.players"
        :key="player.id"
        class="block w-full border-b border-stone-100 p-3 text-left last:border-b-0 dark:border-stone-800"
        @click="forms.selectedPlayerId = player.id"
      >
        <div class="grid grid-cols-[1fr_4rem_4rem] items-baseline gap-2">
          <span class="truncate text-base font-black">{{ player.name }}</span>
          <span class="text-right font-bold">{{ player.games }}</span>
          <span class="text-right font-bold">{{ player.shuttles }}</span>
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span class="font-semibold text-stone-600 dark:text-stone-300">ค่าใช้จ่าย {{ money(playerCost(player)) }}</span>
          <button
            class="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-bold"
            :class="player.paid ? 'bg-court-500 text-white' : 'bg-shuttle-400 text-stone-900'"
            @click.stop="togglePayment(player)"
          >
            <Check class="h-3.5 w-3.5" />
            {{ player.paid ? 'จ่ายแล้ว' : 'ยังไม่ได้จ่าย' }}
          </button>
        </div>
      </button>
    </div>
  </section>
</template>
