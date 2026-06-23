<script setup>
import { CheckCircle2, Loader2, MailCheck, XCircle } from '@lucide/vue'

defineProps(['verifyEmail'])
</script>

<template>
  <section class="min-h-screen bg-paper-50 px-4 py-8 text-stone-950 dark:bg-paper-900 dark:text-white">
    <div class="mx-auto grid min-h-[calc(100vh-4rem)] max-w-xl place-items-center">
      <article class="w-full rounded-lg border border-stone-200 bg-white p-6 text-center shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-8">
        <div
          class="mx-auto grid h-16 w-16 place-items-center rounded-md"
          :class="verifyEmail.status === 'success' ? 'bg-court-500/10 text-court-700 dark:text-court-300' : verifyEmail.status === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-shuttle-500/20 text-stone-900 dark:text-shuttle-300'"
        >
          <Loader2 v-if="verifyEmail.status === 'loading'" class="h-8 w-8 animate-spin" />
          <CheckCircle2 v-else-if="verifyEmail.status === 'success'" class="h-8 w-8" />
          <XCircle v-else-if="verifyEmail.status === 'error'" class="h-8 w-8" />
          <MailCheck v-else class="h-8 w-8" />
        </div>

        <p class="mt-5 text-sm font-black uppercase tracking-[0.14em] text-court-700 dark:text-court-300">LiveMatch</p>
        <h1 class="mt-2 text-2xl font-black leading-tight sm:text-3xl">
          <span v-if="verifyEmail.status === 'success'">ยืนยันอีเมลสำเร็จ</span>
          <span v-else-if="verifyEmail.status === 'error'">ยืนยันอีเมลไม่สำเร็จ</span>
          <span v-else>กำลังยืนยันอีเมล</span>
        </h1>

        <p class="mt-3 text-base font-semibold leading-7 text-stone-600 dark:text-stone-300">
          {{ verifyEmail.message }}
        </p>

        <div class="mt-6 grid gap-2 sm:grid-cols-2">
          <a href="/" class="inline-flex h-12 items-center justify-center rounded-md bg-stone-900 px-5 font-bold text-white transition hover:bg-stone-800 dark:bg-white dark:text-stone-900">
            ไปหน้าเข้าสู่ระบบ
          </a>
          <a href="/?mode=register" class="inline-flex h-12 items-center justify-center rounded-md border border-stone-200 px-5 font-bold transition hover:bg-paper-100 dark:border-stone-700 dark:hover:bg-stone-800">
            สมัครใหม่
          </a>
        </div>
      </article>
    </div>
  </section>
</template>
