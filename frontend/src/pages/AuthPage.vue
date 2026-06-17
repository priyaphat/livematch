<script setup>
import { Check, Medal, LockKeyhole, Plus, ShieldCheck, Sparkles } from '@lucide/vue'

defineProps([
  'forms',
  'createSession',
  'unlockDashboard'
])
</script>

<template>
  <section class="mx-auto grid max-w-5xl gap-4 md:grid-cols-[0.95fr_1.05fr] md:items-start">
    <div class="rounded-lg border border-stone-200 bg-white p-5 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-6">
      <div class="flex items-start justify-between gap-4">
        <div class="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-court-500 text-white shadow-soft">
          <Medal class="h-7 w-7" />
        </div>
        <span class="rounded-md bg-paper-100 px-3 py-1 text-xs font-bold text-court-600 dark:bg-stone-800 dark:text-court-500">
          Admin only
        </span>
      </div>

      <div class="mt-6">
        <p class="text-sm font-bold text-court-600 dark:text-court-500">LiveMatch</p>
        <h1 class="mt-2 text-3xl font-black leading-tight text-stone-950 dark:text-white sm:text-4xl">
          จัด session แบดให้ลื่นขึ้น
        </h1>
        <p class="mt-3 text-base leading-7 text-stone-600 dark:text-stone-300">
          เข้า dashboard เพื่อจัดสมาชิก สุ่มคู่ คุมสนามที่กำลังเล่น และดูค่าใช้จ่ายรายคนในที่เดียว
        </p>
      </div>

      <div class="mt-6 grid gap-3">
        <div class="flex items-start gap-3 rounded-md bg-paper-100 p-3 dark:bg-stone-800">
          <ShieldCheck class="mt-0.5 h-5 w-5 shrink-0 text-court-500" />
          <div>
            <p class="font-bold">ยังไม่แสดงข้อมูลก่อนเข้าใช้งาน</p>
            <p class="text-sm text-stone-500 dark:text-stone-400">
              ผู้เล่นและข้อมูลสนามจะถูกซ่อนไว้จนกว่า admin จะกรอก passcode ถูกต้อง
            </p>
          </div>
        </div>
        <div class="flex items-start gap-3 rounded-md bg-paper-100 p-3 dark:bg-stone-800">
          <Sparkles class="mt-0.5 h-5 w-5 shrink-0 text-shuttle-500" />
          <div>
            <p class="font-bold">พร้อมใช้กับมือถือหน้างาน</p>
            <p class="text-sm text-stone-500 dark:text-stone-400">
              ปุ่มใหญ่ อ่านง่าย เหมาะกับการเปิดข้างสนามระหว่างจัดเกม
            </p>
          </div>
        </div>
      </div>
    </div>

    <div class="grid gap-4">
      <div class="rounded-lg border border-stone-200 bg-white p-5 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-6">
        <div class="flex items-center gap-3">
          <span class="grid h-11 w-11 place-items-center rounded-md bg-stone-900 text-white dark:bg-white dark:text-stone-900">
            <LockKeyhole class="h-5 w-5" />
          </span>
          <div>
            <h2 class="text-xl font-black">เข้าสู่ระบบผู้ดูแล</h2>
            <p class="text-sm text-stone-500 dark:text-stone-400">กรอก admin passcode ของ session</p>
          </div>
        </div>

        <div class="mt-5 grid gap-3">
          <label class="grid gap-2 text-sm font-bold">
            Admin passcode
            <input
              v-model="forms.passcodeInput"
              class="h-12 rounded-md border border-stone-200 bg-paper-50 px-4 text-base outline-none transition focus:border-court-500 focus:ring-4 focus:ring-court-500/10 dark:border-stone-700 dark:bg-stone-800"
              placeholder="กรอก passcode"
              @keyup.enter="unlockDashboard"
            />
          </label>
          <p v-if="forms.loginError" class="rounded-md bg-red-50 px-3 py-2 text-sm font-bold text-red-700 dark:bg-red-950 dark:text-red-200">
            {{ forms.loginError }}
          </p>
          <button
            class="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-stone-900 px-5 font-bold text-white transition hover:bg-stone-800 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
            @click="unlockDashboard"
          >
            <Check class="h-5 w-5" />
            เข้า dashboard
          </button>
        </div>
      </div>

      <div class="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-900 sm:p-6">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-black">สร้าง session ใหม่</h2>
            <p class="text-sm text-stone-500 dark:text-stone-400">ระบบจะสร้าง passcode สำหรับ admin</p>
          </div>
          <span class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-paper-100 text-court-600 dark:bg-stone-800 dark:text-court-500">
            <Plus class="h-5 w-5" />
          </span>
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <input placeholder="live match name"
            v-model="forms.newSessionName"
            class="h-12 rounded-md border border-stone-200 bg-paper-50 px-4 outline-none transition focus:border-court-500 focus:ring-4 focus:ring-court-500/10 dark:border-stone-700 dark:bg-stone-800"
          />
          <button
            class="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-court-500 px-5 font-bold text-white transition hover:bg-court-600"
            @click="createSession"
          >
            <Plus class="h-5 w-5" />
            สร้าง
          </button>
        </div>

        <div v-if="forms.createdPasscode" class="mt-4 rounded-md border border-court-500/20 bg-court-500/10 p-4 dark:bg-court-500/15">
          <p class="text-sm font-bold text-court-700 dark:text-court-500">สร้างแล้ว ใช้ passcode นี้เพื่อเข้า dashboard</p>
          <p class="mt-1 text-3xl font-black tracking-wide">{{ forms.createdPasscode }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
