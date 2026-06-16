<script setup>
import { Check, Plus } from '@lucide/vue'

defineProps([
  'state',
  'forms',
  'createSession',
  'unlockDashboard'
])
</script>

<template>
  <section class="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
    <div class="rounded-lg border border-stone-200 bg-white p-5 shadow-soft dark:border-stone-700 dark:bg-stone-900">
      <div class="flex items-center gap-3">
        <span class="grid h-12 w-12 place-items-center rounded-md bg-shuttle-400 text-stone-900">
          <Plus class="h-6 w-6" />
        </span>
        <div>
          <h1 class="text-2xl font-bold">สร้างสนาม / session แบด</h1>
          <p class="text-sm text-stone-500 dark:text-stone-400">ระบบจะสร้าง admin passcode สำหรับผู้ดูแลทันที</p>
        </div>
      </div>
      <div class="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
        <input v-model="forms.newSessionName" class="h-12 rounded-md border border-stone-200 bg-paper-50 px-4 outline-none focus:border-court-500 dark:border-stone-700 dark:bg-stone-800" />
        <button class="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-court-500 px-5 font-semibold text-white hover:bg-court-600" @click="createSession">
          <Plus class="h-5 w-5" />
          สร้าง
        </button>
      </div>
      <div class="mt-5 rounded-md bg-paper-100 p-4 dark:bg-stone-800">
        <p class="text-sm text-stone-500 dark:text-stone-400">Admin passcode ปัจจุบัน</p>
        <p class="mt-1 text-3xl font-black tracking-wide">{{ state.session.adminPasscode }}</p>
      </div>
    </div>

    <div class="rounded-lg border border-stone-200 bg-white p-5 shadow-soft dark:border-stone-700 dark:bg-stone-900">
      <h2 class="text-lg font-bold">เข้า dashboard</h2>
      <p class="mt-1 text-sm text-stone-500 dark:text-stone-400">กรอก passcode ของ session เพื่อจัดการข้อมูล</p>
      <div class="mt-4 grid gap-3">
        <input v-model="forms.passcodeInput" class="h-12 rounded-md border border-stone-200 bg-paper-50 px-4 outline-none focus:border-court-500 dark:border-stone-700 dark:bg-stone-800" placeholder="เช่น LM-2406" />
        <button class="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-stone-900 px-5 font-semibold text-white dark:bg-white dark:text-stone-900" @click="unlockDashboard">
          <Check class="h-5 w-5" />
          เข้า dashboard
        </button>
      </div>
    </div>
  </section>
</template>
