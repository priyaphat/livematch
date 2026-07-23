<script setup>
import { ref } from 'vue'
import { Check, KeyRound, Mail, MessageCircleWarning, Moon, ShieldCheck, Sparkles, Sun, Trophy, UserPlus, Zap } from '@lucide/vue'
import SupportIssueModal from '../components/SupportIssueModal.vue'
import HeroBackground from '../components/HeroBackground.vue'

const props = defineProps([
  'forms',
  'auth',
  'loginAdmin',
  'registerAdmin',
  'forgotPassword',
  'resetPassword',
  'language',
  'toggleLanguage',
  'toggleTheme',
  'state',
  'submitSupportIssue'
])

const showSupportIssue = ref(false)

const tabs = [
  { id: 'login', label: 'เข้าสู่ระบบ', icon: KeyRound },
  { id: 'register', label: 'สมัครสมาชิก', icon: UserPlus },
  { id: 'forgot', label: 'ลืมรหัสผ่าน', icon: Mail }
]

const highlights = [
  'สุ่มคู่แบดแบบบาลานซ์ตามระดับมือและจำนวนเกม',
  'จัดคิว เริ่มเกม จบเกม และบันทึกประวัติในที่เดียว',
  'คิดค่าใช้จ่ายรายคนจากค่าสนาม ลูกแบด และค่า session',
  'มีหน้าแชร์ QR ให้สมาชิกดูคิวและค่าใช้จ่ายเอง'
]
</script>

<template>
  <section class="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1.08fr_0.92fr] lg:items-start">
    <div class="lm-hero-bg overflow-hidden rounded-lg border border-stone-200 bg-white shadow-soft dark:border-stone-700 dark:bg-stone-900">
      <HeroBackground />
      <div class="grid gap-5 p-5 sm:p-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <span class="inline-flex items-center gap-2 rounded-md bg-court-500/10 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-court-700 dark:text-court-300">
            <Trophy class="h-4 w-4" />
            LiveMatch
          </span>
          <span class="inline-flex items-center gap-2 rounded-md bg-shuttle-400 px-3 py-1 text-xs font-black text-stone-950">
            <Sparkles class="h-4 w-4" />
            โปรเปิดตัว 49 coin
          </span>
        </div>

        <div>
          <h1 class="max-w-2xl text-3xl font-black leading-tight text-stone-950 dark:text-white sm:text-5xl">
            โปรแกรมจัด session แบด ที่ช่วยให้แอดมินเหนื่อยน้อยลง
          </h1>
          <p class="mt-4 max-w-2xl text-base font-semibold leading-7 text-stone-600 dark:text-stone-300">
            LiveMatch ช่วยรับสมาชิก สุ่มคู่ จัดคิว บันทึกผล และสรุปค่าใช้จ่ายให้ครบในหน้าจอเดียว เหมาะกับก๊วนแบดและสนามที่ต้องการจัดรอบให้แฟร์และไว
          </p>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <article class="rounded-lg border border-shuttle-300 bg-shuttle-400/15 p-4 dark:border-shuttle-700">
            <p class="text-sm font-black text-stone-500 dark:text-stone-400">ช่วงเปิดโปรแกรม</p>
            <div class="mt-2 flex items-end gap-3">
              <p class="text-4xl font-black text-stone-950 dark:text-white">49</p>
              <p class="pb-1 text-sm font-black text-stone-500 line-through">59 coin</p>
            </div>
            <p class="mt-2 text-sm font-bold text-stone-600 dark:text-stone-300">สร้าง liveMatch session ได้ในราคาพิเศษ</p>
          </article>

          <article class="rounded-lg border border-court-200 bg-court-500/10 p-4 dark:border-court-900">
            <p class="text-sm font-black text-stone-500 dark:text-stone-400">ของดีของโปรแกรม</p>
            <div class="mt-2 flex items-center gap-2">
              <Zap class="h-8 w-8 text-court-600 dark:text-court-300" />
              <p class="text-2xl font-black">จบงานใน flow เดียว</p>
            </div>
            <p class="mt-2 text-sm font-bold text-stone-600 dark:text-stone-300">ไม่ต้องแยกจดชื่อ คิว เกม และเงินหลายที่</p>
          </article>
        </div>

        <div class="grid gap-2">
          <div v-for="item in highlights" :key="item" class="flex items-start gap-3 rounded-md bg-paper-100 p-3 dark:bg-stone-800">
            <Check class="mt-0.5 h-5 w-5 shrink-0 text-court-500" />
            <p class="text-sm font-bold text-stone-700 dark:text-stone-200">{{ item }}</p>
          </div>
        </div>
      </div>
    </div>

    <div class="rounded-lg border border-stone-200 bg-white p-5 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-6">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm font-black text-court-700 dark:text-court-300">Admin account</p>
          <h2 class="mt-1 text-2xl font-black">เริ่มใช้งาน LiveMatch</h2>
          <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">สมัคร ยืนยันอีเมล แล้วเข้าแดชบอร์ดผู้ดูแลเพื่อสร้าง session ด้วย coin</p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button
            class="hidden"
            :title="language === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'"
            @click="toggleLanguage"
          >
            {{ language === 'th' ? 'EN' : 'TH' }}
          </button>
          <button
            class="hidden"
            :title="state.theme === 'dark' ? 'Light mode' : 'Dark mode'"
            @click="toggleTheme"
          >
            <Sun v-if="state.theme === 'dark'" class="h-5 w-5" />
            <Moon v-else class="h-5 w-5" />
          </button>
          <span class="grid h-11 w-11 place-items-center rounded-md bg-court-500 text-white">
            <ShieldCheck class="h-6 w-6" />
          </span>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-2 gap-2 rounded-md bg-paper-100 p-1 dark:bg-stone-800">
        <button
          class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-white px-3 text-xs font-black text-stone-700 transition hover:bg-paper-50 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-950"
          :title="language === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'"
          @click="toggleLanguage"
        >
          <span>Language</span>
          <span>{{ language === 'th' ? 'EN' : 'TH' }}</span>
        </button>
        <button
          class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-white px-3 text-xs font-black text-stone-700 transition hover:bg-paper-50 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-950"
          :title="state.theme === 'dark' ? 'Light mode' : 'Dark mode'"
          @click="toggleTheme"
        >
          <Sun v-if="state.theme === 'dark'" class="h-5 w-5" />
          <Moon v-else class="h-5 w-5" />
          <span>{{ state.theme === 'dark' ? 'Light' : 'Dark' }}</span>
        </button>
      </div>

      <div v-if="forms.authMode !== 'reset'" class="mt-5 grid grid-cols-3 gap-2 rounded-md bg-paper-100 p-1 dark:bg-stone-800">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="inline-flex h-11 items-center justify-center gap-2 rounded-md px-2 text-sm font-black transition"
          :class="forms.authMode === tab.id ? 'bg-white text-stone-950 shadow-soft dark:bg-stone-950 dark:text-white' : 'text-stone-500 dark:text-stone-400'"
          @click="forms.authMode = tab.id; forms.authError = ''; forms.authMessage = ''"
        >
          <component :is="tab.icon" class="h-4 w-4" />
          <span class="hidden sm:inline">{{ tab.label }}</span>
        </button>
      </div>

      <div class="mt-5 grid gap-3">
        <label v-if="forms.authMode === 'register'" class="grid gap-2 text-sm font-bold">
          ชื่อ
          <input v-model="forms.authName" class="h-12 rounded-md border border-stone-200 bg-paper-50 px-4 outline-none transition focus:border-court-500 focus:ring-4 focus:ring-court-500/10 dark:border-stone-700 dark:bg-stone-800" placeholder="ชื่อผู้ดูแล" />
        </label>

        <label v-if="forms.authMode !== 'reset'" class="grid gap-2 text-sm font-bold">
          Email
          <input v-model="forms.authEmail" type="email" class="h-12 rounded-md border border-stone-200 bg-paper-50 px-4 outline-none transition focus:border-court-500 focus:ring-4 focus:ring-court-500/10 dark:border-stone-700 dark:bg-stone-800" placeholder="admin@example.com" />
        </label>

        <label v-if="forms.authMode !== 'forgot'" class="grid gap-2 text-sm font-bold">
          Password
          <input v-model="forms.authPassword" type="password" class="h-12 rounded-md border border-stone-200 bg-paper-50 px-4 outline-none transition focus:border-court-500 focus:ring-4 focus:ring-court-500/10 dark:border-stone-700 dark:bg-stone-800" placeholder="อย่างน้อย 8 ตัวอักษร" @keyup.enter="forms.authMode === 'register' ? registerAdmin() : (forms.authMode === 'reset' ? resetPassword() : loginAdmin())" />
        </label>

        <p v-if="forms.authMessage" class="rounded-md bg-court-500/10 px-3 py-2 text-sm font-bold text-court-700 dark:text-court-300">{{ forms.authMessage }}</p>
        <p v-if="forms.authError" class="rounded-md bg-red-50 px-3 py-2 text-sm font-bold text-red-700 dark:bg-red-950/40 dark:text-red-200">{{ forms.authError }}</p>

        <button v-if="forms.authMode === 'login'" class="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-stone-900 px-5 font-bold text-white transition hover:bg-stone-800 disabled:opacity-60 dark:bg-white dark:text-stone-900" :disabled="auth.loading" @click="loginAdmin">
          <KeyRound class="h-5 w-5" />
          {{ auth.loading ? 'กำลังเข้าสู่ระบบ' : 'เข้าสู่ระบบ' }}
        </button>
        <button v-else-if="forms.authMode === 'register'" class="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-court-500 px-5 font-bold text-white transition hover:bg-court-600 disabled:opacity-60" :disabled="auth.loading" @click="registerAdmin">
          <UserPlus class="h-5 w-5" />
          {{ auth.loading ? 'กำลังสมัคร' : 'สมัครและส่ง verify email' }}
        </button>
        <button v-else-if="forms.authMode === 'forgot'" class="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-shuttle-500 px-5 font-bold text-stone-950 transition hover:bg-shuttle-400 disabled:opacity-60" :disabled="auth.loading" @click="forgotPassword">
          <Mail class="h-5 w-5" />
          {{ auth.loading ? 'กำลังส่งอีเมล' : 'ส่งอีเมลรีเซ็ตรหัสผ่าน' }}
        </button>
        <button v-else class="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-court-500 px-5 font-bold text-white transition hover:bg-court-600 disabled:opacity-60" :disabled="auth.loading" @click="resetPassword">
          <KeyRound class="h-5 w-5" />
          {{ auth.loading ? 'กำลังรีเซ็ต' : 'ตั้งรหัสผ่านใหม่' }}
        </button>
      </div>

      <div class="mt-5 border-t border-stone-200 pt-4 dark:border-stone-700">
        <button class="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-stone-200 bg-paper-50 px-4 text-sm font-black dark:border-stone-700 dark:bg-stone-800" @click="showSupportIssue = true">
          <MessageCircleWarning class="h-5 w-5 text-court-600 dark:text-court-300" />
          ติดต่อแอดมิน / แจ้งปัญหา
        </button>
      </div>
    </div>
    <footer class="py-3 text-center text-xs font-semibold text-stone-500 dark:text-stone-400 lg:col-span-2">
      Copyright 2026 LiveMatch v2.1 · Contact
      <a class="font-black text-court-700 underline-offset-4 hover:underline dark:text-court-300" href="https://www.vibestudio.work/" target="_blank" rel="noopener noreferrer">vibestudio.work</a>
    </footer>
    <SupportIssueModal v-if="showSupportIssue" :submit-support-issue="props.submitSupportIssue" @close="showSupportIssue = false" />
  </section>
</template>
