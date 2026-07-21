<script setup>
import { BarChart3, ShieldCheck } from '@lucide/vue'
import HeroBackground from '../components/HeroBackground.vue'

defineProps(['state', 'selectAdminTab'])
</script>

<template>
  <section class="lm-hero-bg overflow-hidden rounded-lg border border-stone-200 bg-white p-5 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-6">
    <HeroBackground />
    <div class="grid gap-5 lg:grid-cols-[1fr_15rem] lg:items-center">
    <div class="flex items-start gap-3">
      <span class="grid h-12 w-12 place-items-center rounded-md bg-court-500 text-white">
        <ShieldCheck class="h-6 w-6" />
      </span>
      <div>
        <p class="text-sm font-black text-court-700 dark:text-court-300">Owner-only session</p>
        <h1 class="mt-1 text-2xl font-black">{{ state.session.name }}</h1>
        <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">session นี้ผูกกับบัญชี admin ที่สร้าง ไม่มี passkey สำหรับ session ใหม่</p>
      </div>
    </div>
    </div>
    <button class="mt-5 inline-flex h-11 items-center gap-2 rounded-md bg-stone-900 px-4 font-bold text-white dark:bg-white dark:text-stone-900" @click="selectAdminTab('dashboard')">
      <BarChart3 class="h-4 w-4" />
      ไป dashboard
    </button>
  </section>
</template>
