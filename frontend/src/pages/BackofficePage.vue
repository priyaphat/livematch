<script setup>
import { computed } from 'vue'
import { Activity, CheckCircle2, Coins, Eye, ImagePlus, Link, Lock, MessageCircleWarning, ReceiptText, RefreshCw, Save, Search, Settings, Upload, Users, X, XCircle } from '@lucide/vue'

const props = defineProps([
  'forms',
  'ui',
  'backoffice',
  'loadBackoffice',
  'loadBackofficeCoinOrders',
  'loadBackofficeActivityLogs',
  'applyBackofficeActivityFilters',
  'changeBackofficeActivityUser',
  'loadBackofficeSupportIssues',
  'applyBackofficeSupportFilters',
  'openBackofficeSupportIssue',
  'saveBackofficeSupportIssue',
  'openBackofficeAdminDetail',
  'saveBackofficeSettings',
  'saveBackofficeCoinShop',
  'setupBackofficeTelegramWebhook',
  'addBackofficeCoinPackage',
  'removeBackofficeCoinPackage',
  'adjustBackofficeCoins',
  'reviewBackofficeCoinOrder',
  'handleBackofficeQrFile',
  'coinOrderStatusText',
  'coinOrderStatusClass'
])

const summary = computed(() => props.forms.backofficeSummary || {})
const users = computed(() => summary.value.users || [])
const ledger = computed(() => summary.value.coinLedger || [])
const orders = computed(() => summary.value.coinPurchaseOrders || [])
const logs = computed(() => summary.value.activityLogs || [])
const ordersPagination = computed(() => props.forms.backofficeOrdersPagination || { page: 1, total: 0, totalPages: 0 })
const activityPagination = computed(() => props.forms.backofficeActivityPagination || { page: 1, total: 0, totalPages: 0 })
const supportIssues = computed(() => props.forms.backofficeSupportIssues || [])
const supportPagination = computed(() => props.forms.backofficeSupportPagination || { page: 1, total: 0, totalPages: 0 })
const supportIssueDetail = computed(() => props.forms.backofficeSupportIssueDetail || null)
const adminDetail = computed(() => props.forms.backofficeAdminDetail || {})
const adminDetailUser = computed(() => adminDetail.value.user || {})
const adminDetailSessions = computed(() => adminDetail.value.sessions || [])
const adminDetailLedger = computed(() => adminDetail.value.coinLedger || [])
const adminDetailOrders = computed(() => adminDetail.value.orders || [])
const tabs = [
  { id: 'overview', label: 'ภาพรวม', icon: Settings },
  { id: 'promotions', label: 'แพ็กเกจ coin', icon: Coins },
  { id: 'orders', label: 'รายการซื้อ', icon: ReceiptText },
  { id: 'members', label: 'สมาชิก admin', icon: Users },
  { id: 'support', label: 'แจ้งปัญหา', icon: MessageCircleWarning },
  { id: 'activity', label: 'Activity log', icon: Activity }
]

function supportStatusText(status) {
  return {
    new: 'ใหม่',
    in_progress: 'กำลังตรวจสอบ',
    resolved: 'แก้ไขแล้ว'
  }[status] || status
}

function supportStatusClass(status) {
  if (status === 'resolved') return 'bg-court-500/10 text-court-700 dark:text-court-300'
  if (status === 'in_progress') return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
  return 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
}

function activityText(action) {
  const map = {
    create_session_spend_coin: 'สร้าง session และตัด coin',
    submit_coin_purchase: 'ส่งคำสั่งซื้อ coin',
    update_session_coin_cost: 'แก้ราคาสร้าง session',
    update_coin_shop: 'แก้แพ็กเกจ/QR coin',
    manual_coin_adjustment: 'เพิ่ม/หัก coin manual',
    approve_coin_purchase: 'อนุมัติรายการซื้อ coin',
    reject_coin_purchase: 'ไม่อนุมัติรายการซื้อ coin',
    submit_support_issue: 'ส่งรายการแจ้งปัญหา',
    update_support_issue: 'อัปเดตรายการแจ้งปัญหา',
    telegram_support_notification_failed: 'ส่งแจ้งเตือนปัญหาไป Telegram ไม่สำเร็จ',
    telegram_support_media_failed: 'ส่งรูปปัญหาไป Telegram ไม่สำเร็จ'
  }
  const sessionMap = {
    open_session: 'เปิด session เดิม',
    blocked_expired_session_action: 'บล็อก action เพราะ session ครบ 3 วัน',
    add_player: 'เพิ่มสมาชิก',
    rename_player: 'แก้ชื่อสมาชิก',
    update_player: 'แก้ไขสมาชิก',
    toggle_player_paid: 'อัปเดตสถานะจ่ายเงิน',
    delete_player: 'ลบสมาชิก',
    update_session_settings: 'แก้ตั้งค่า session',
    add_couple: 'เพิ่มคู่รัก',
    delete_couple: 'ลบคู่รัก',
    random_matches: 'สุ่มจัดคู่',
    confirm_pending_match: 'ยืนยันเกมเข้าคิว',
    cancel_pending_match: 'ยกเลิกเกมที่สุ่มไว้',
    start_match: 'เริ่มการแข่งขัน',
    cancel_queued_match: 'ยกเลิกคิว',
    adjust_match_shuttles: 'ปรับจำนวนลูกแบด',
    finish_match: 'จบการแข่งขัน',
    cancel_live_match: 'ยกเลิกการแข่งขัน',
    update_history_winner: 'แก้ผลย้อนหลัง'
  }
  return sessionMap[action] || map[action] || action
}

function activityDetails(details) {
  try {
    const parsed = JSON.parse(details || '{}')
    return Object.entries(parsed).map(([key, value]) => `${key}: ${value}`).join(' · ')
  } catch {
    return details
  }
}
function openSlipPreview(order) {
  props.forms.backofficeSlipPreview = order
  props.ui.showBackofficeSlipModal = true
}

function closeSlipPreview() {
  props.forms.backofficeSlipPreview = null
  props.ui.showBackofficeSlipModal = false
}
</script>

<template>
  <section class="min-h-screen bg-paper-50 px-4 py-5 text-stone-950 dark:bg-paper-900 dark:text-white">
    <div class="mx-auto grid max-w-6xl gap-4">
      <header class="grid gap-3 rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <p class="text-sm font-black text-court-700 dark:text-court-300">Backoffice</p>
          <h1 class="mt-1 text-2xl font-black">LiveMatch Admin Members</h1>
          <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">ดูสมาชิก admin ตั้งราคา session โปรโมชัน coin และตรวจรายการซื้อ coin</p>
        </div>
        <button v-if="backoffice.unlocked" class="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-stone-200 px-4 font-bold dark:border-stone-700" :disabled="backoffice.loading" @click="loadBackoffice">
          <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': backoffice.loading }" />
          รีเฟรช
        </button>
      </header>

      <section v-if="!backoffice.unlocked" class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="grid gap-2 text-sm font-bold">
            Username
            <input v-model="forms.backofficeUsername" class="h-12 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" placeholder="superadmin" />
          </label>
          <label class="grid gap-2 text-sm font-bold">
            Password
            <input v-model="forms.backofficePassword" type="password" class="h-12 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" placeholder="password" @keyup.enter="loadBackoffice" />
          </label>
        </div>
        <button class="mt-3 inline-flex h-12 items-center justify-center gap-2 rounded-md bg-court-500 px-5 font-bold text-white disabled:opacity-60" :disabled="backoffice.loading" @click="loadBackoffice">
          <Lock class="h-4 w-4" />
          {{ backoffice.loading ? 'กำลังตรวจสอบ' : 'เข้าสู่หลังบ้าน' }}
        </button>
        <p v-if="forms.backofficeError" class="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm font-bold text-red-700 dark:bg-red-950/40 dark:text-red-200">{{ forms.backofficeError }}</p>
      </section>

      <template v-else>
        <nav class="scrollbar-none flex gap-2 overflow-x-auto rounded-lg border border-stone-200 bg-white p-2 shadow-soft dark:border-stone-700 dark:bg-stone-900">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="inline-flex h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-black transition"
            :class="forms.backofficeTab === tab.id ? 'bg-stone-900 text-white dark:bg-white dark:text-stone-900' : 'text-stone-600 hover:bg-paper-100 dark:text-stone-300 dark:hover:bg-stone-800'"
            @click="forms.backofficeTab = tab.id"
          >
            <component :is="tab.icon" class="h-4 w-4" />
            {{ tab.label }}
            <span v-if="tab.id === 'support' && forms.backofficeSupportNewCount" class="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-black text-white">
              {{ forms.backofficeSupportNewCount }}
            </span>
          </button>
        </nav>

        <div v-if="forms.backofficeTab === 'overview'" class="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <section class="grid gap-4">
            <article class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
              <div class="flex items-center gap-2">
                <Settings class="h-5 w-5 text-court-600" />
                <h2 class="text-lg font-black">ราคา session</h2>
              </div>
              <label class="mt-3 grid gap-2 text-sm font-bold">
                liveMatch session cost
                <input v-model.number="forms.backofficeLiveMatchCost" type="number" min="0" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" />
              </label>
              <label class="mt-3 grid gap-2 text-sm font-bold">
                liveShare session cost
                <input v-model.number="forms.backofficeLiveShareCost" type="number" min="0" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" />
              </label>
              <button class="mt-3 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-court-500 px-4 font-bold text-white" @click="saveBackofficeSettings">
                <Save class="h-4 w-4" />
                บันทึกราคา
              </button>
            </article>

            <article class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
              <div class="flex items-center gap-2">
                <ReceiptText class="h-5 w-5 text-court-600" />
                <h2 class="text-lg font-black">Telegram notification</h2>
              </div>
              <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">แจ้ง backoffice เมื่อมีรายการซื้อ coin หรือรายการแจ้งปัญหาใหม่ ผ่าน Telegram Bot</p>
              <div class="mt-3 grid gap-3">
                <label class="grid gap-2 text-sm font-bold">
                  Bot token
                  <input v-model="forms.backofficeTelegramBotToken" type="password" autocomplete="off" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" placeholder="TELEGRAM_BOT_TOKEN" />
                </label>
                <label class="grid gap-2 text-sm font-bold">
                  Chat ID
                  <input v-model="forms.backofficeTelegramChatId" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" placeholder="chat_id เช่น -1001234567890" />
                </label>
                <label class="grid gap-2 text-sm font-bold">
                  Webhook secret
                  <input v-model="forms.backofficeTelegramWebhookSecret" readonly class="h-11 rounded-md border border-stone-200 bg-paper-100 px-3 text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300" placeholder="ระบบสร้างให้อัตโนมัติ" />
                </label>
                <label class="grid gap-2 text-sm font-bold">
                  Webhook URL
                  <input :value="forms.backofficeTelegramWebhookUrl || (forms.backofficeTelegramWebhookSecret ? `/api/telegram/webhook/${forms.backofficeTelegramWebhookSecret}` : '')" readonly class="h-11 rounded-md border border-stone-200 bg-paper-100 px-3 text-xs text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300" placeholder="บันทึก Telegram ก่อนเพื่อสร้าง URL" />
                </label>
              </div>
              <div class="mt-3 grid gap-2 sm:grid-cols-2">
                <button class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-court-500 px-4 font-bold text-white" @click="saveBackofficeCoinShop">
                  <Save class="h-4 w-4" />
                  บันทึก Telegram
                </button>
                <button class="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-court-200 bg-court-500/10 px-4 font-bold text-court-700 dark:border-court-900 dark:text-court-300" @click="setupBackofficeTelegramWebhook">
                  <Link class="h-4 w-4" />
                  ตั้งค่า Telegram webhook
                </button>
              </div>
              <p v-if="forms.backofficeTelegramWebhookStatus" class="mt-2 rounded-md bg-paper-100 px-3 py-2 text-sm font-bold text-stone-700 dark:bg-stone-800 dark:text-stone-200">{{ forms.backofficeTelegramWebhookStatus }}</p>
            </article>

            <article class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
              <div class="flex items-center gap-2">
                <Coins class="h-5 w-5 text-shuttle-500" />
                <h2 class="text-lg font-black">เพิ่ม/หัก coin manual</h2>
              </div>
              <div class="mt-3 grid gap-3">
                <select v-model="forms.backofficeCoinAdminId" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800">
                  <option value="">เลือก admin</option>
                  <option v-for="user in users" :key="user.id" :value="user.id">{{ user.email }} ({{ user.coins }} coin)</option>
                </select>
                <input v-model.number="forms.backofficeCoinDelta" type="number" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" placeholder="+10 หรือ -5" />
                <input v-model="forms.backofficeCoinNote" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" placeholder="note" />
              </div>
              <button class="mt-3 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-shuttle-500 px-4 font-bold text-stone-950" @click="adjustBackofficeCoins">
                <Coins class="h-4 w-4" />
                บันทึก coin
              </button>
            </article>
            <p v-if="forms.backofficeError" class="rounded-md bg-red-50 px-3 py-2 text-sm font-bold text-red-700 dark:bg-red-950/40 dark:text-red-200">{{ forms.backofficeError }}</p>
          </section>

          <section class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-2">
                <Users class="h-5 w-5 text-court-600" />
                <h2 class="text-lg font-black">สมาชิก admin</h2>
              </div>
              <span class="rounded-md bg-paper-100 px-3 py-1 text-xs font-black text-stone-600 dark:bg-stone-800 dark:text-stone-300">{{ users.length }} คน</span>
            </div>
            <div class="mt-3 divide-y divide-stone-200 overflow-hidden rounded-md border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
              <div v-for="user in users" :key="user.id" class="grid gap-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div class="min-w-0">
                  <p class="truncate font-black">{{ user.email }}</p>
                  <p class="mt-1 truncate text-xs font-semibold text-stone-500">{{ user.name }} · {{ user.sessions }} session · {{ user.verified ? 'verified' : 'not verified' }}</p>
                </div>
                <div class="flex items-center justify-end gap-2">
                  <p class="text-right text-lg font-black tabular-nums">{{ user.coins }} coin</p>
                  <button class="inline-flex h-10 items-center gap-2 rounded-md border border-stone-200 px-3 text-sm font-black dark:border-stone-700" @click="openBackofficeAdminDetail(user.id)">
                    <Eye class="h-4 w-4" />
                    ดู
                  </button>
                </div>
              </div>
              <p v-if="!users.length" class="p-4 text-sm font-semibold text-stone-500">ยังไม่มี admin user</p>
            </div>
          </section>
        </div>

        <section v-if="forms.backofficeTab === 'promotions'" class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-lg font-black">แพ็กเกจขาย coin</h2>
              <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">ตั้งราคาที่ลูกค้าต้องโอน จำนวน coin ที่จะได้รับ และป้ายโปรโมชันที่แสดงในหน้าซื้อ coin</p>
            </div>
            <div class="flex gap-2">
              <button class="inline-flex h-10 items-center gap-2 rounded-md border border-stone-200 px-3 text-sm font-bold dark:border-stone-700" @click="addBackofficeCoinPackage">
                <Coins class="h-4 w-4" />
                เพิ่มแพ็กเกจขาย
              </button>
              <button class="inline-flex h-10 items-center gap-2 rounded-md bg-court-500 px-3 text-sm font-bold text-white" @click="saveBackofficeCoinShop">
                <Save class="h-4 w-4" />
                บันทึกแพ็กเกจ
              </button>
            </div>
          </div>

          <div class="mt-4 grid gap-4 lg:grid-cols-[1fr_16rem]">
            <div class="grid gap-3">
              <div v-for="(pkg, index) in forms.backofficeCoinPackages" :key="pkg.id || index" class="rounded-lg bg-paper-100 p-3 dark:bg-stone-800">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <p class="text-sm font-black">แพ็กเกจที่ {{ index + 1 }}</p>
                    <p class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">เปิดขายแล้วลูกค้าจะเห็นแพ็กเกจนี้ในหน้าซื้อ coin</p>
                  </div>
                  <button class="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-red-200 text-red-700 dark:border-red-900 dark:text-red-300" title="ลบแพ็กเกจนี้" @click="removeBackofficeCoinPackage(index)">
                    <XCircle class="h-4 w-4" />
                  </button>
                </div>

                <div class="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label class="grid gap-1 text-xs font-black text-stone-500 dark:text-stone-400">
                    ชื่อแพ็กเกจ
                    <input v-model="pkg.name" class="h-10 rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white" placeholder="เช่น Starter 100" />
                  </label>
                  <label class="grid gap-1 text-xs font-black text-stone-500 dark:text-stone-400">
                    ราคาโอน (บาท)
                    <input v-model.number="pkg.priceThb" type="number" min="1" class="h-10 rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white" placeholder="เช่น 99" />
                  </label>
                  <label class="grid gap-1 text-xs font-black text-stone-500 dark:text-stone-400">
                    coin ที่ลูกค้าได้รับ
                    <input v-model.number="pkg.coins" type="number" min="1" class="h-10 rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white" placeholder="เช่น 100" />
                  </label>
                  <label class="grid gap-1 text-xs font-black text-stone-500 dark:text-stone-400">
                    ป้ายโปรโมชัน
                    <input v-model="pkg.bonusText" class="h-10 rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white" placeholder="เช่น คุ้มสุด / แนะนำ" />
                  </label>
                </div>

                <div class="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md bg-white p-3 dark:bg-stone-900">
                  <div>
                    <p class="text-xs font-bold text-stone-500 dark:text-stone-400">ตัวอย่างที่ลูกค้าจะเห็น</p>
                    <p class="mt-1 font-black">{{ pkg.name || 'ชื่อแพ็กเกจ' }} · โอน ฿{{ Number(pkg.priceThb || 0).toLocaleString('th-TH') }} ได้ {{ Number(pkg.coins || 0).toLocaleString('th-TH') }} coin</p>
                    <p v-if="pkg.bonusText" class="mt-1 text-xs font-black text-court-700 dark:text-court-300">{{ pkg.bonusText }}</p>
                  </div>
                  <label class="inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-black" :class="pkg.active ? 'border-court-200 bg-court-500/10 text-court-700 dark:border-court-900 dark:text-court-300' : 'border-stone-200 bg-paper-100 text-stone-500 dark:border-stone-700 dark:bg-stone-800'">
                    <input v-model="pkg.active" type="checkbox" />
                    {{ pkg.active ? 'เปิดขาย' : 'ปิดขาย' }}
                  </label>
                </div>
              </div>
              <p v-if="!forms.backofficeCoinPackages.length" class="rounded-md bg-paper-100 p-4 text-sm font-semibold text-stone-500 dark:bg-stone-800">ยังไม่มีแพ็กเกจขาย coin กด “เพิ่มแพ็กเกจขาย” เพื่อเริ่มตั้งราคา</p>
            </div>

            <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
              <p class="font-black">PromptPay ตามยอด</p>
              <p class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">ตั้งบัญชีรับเงิน ระบบจะสร้าง QR ตามราคาแพ็กเกจให้ลูกค้าอัตโนมัติ</p>
              <div class="mt-3 grid gap-2">
                <label class="grid gap-1 text-xs font-black text-stone-500 dark:text-stone-400">
                  ประเภท PromptPay
                  <select v-model="forms.backofficePromptPayType" class="h-10 rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white">
                    <option value="mobile">เบอร์มือถือ</option>
                    <option value="national_id">เลขบัตรประชาชน</option>
                    <option value="ewallet">e-Wallet</option>
                  </select>
                </label>
                <label class="grid gap-1 text-xs font-black text-stone-500 dark:text-stone-400">
                  PromptPay ID
                  <input v-model="forms.backofficePromptPayId" class="h-10 rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white" placeholder="เช่น 0812345678" />
                </label>
                <label class="grid gap-1 text-xs font-black text-stone-500 dark:text-stone-400">
                  ชื่อผู้รับ / label ตรวจสลิป
                  <input v-model="forms.backofficePromptPayReceiverName" class="h-10 rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white" placeholder="ชื่อบัญชีผู้รับ" />
                </label>
              </div>
            </div>

            <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
              <p class="font-black">QR สำหรับรับเงิน</p>
              <p class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">ลูกค้าจะสแกน QR นี้หลังเลือกแพ็กเกจ</p>
              <div class="mt-3 grid min-h-48 place-items-center rounded-md bg-white p-2 dark:bg-stone-900">
                <img v-if="forms.backofficeCoinPaymentQrImage" :src="forms.backofficeCoinPaymentQrImage" alt="QR รับเงิน" class="max-h-44 object-contain" />
                <ImagePlus v-else class="h-10 w-10 text-stone-400" />
              </div>
              <label class="mt-3 flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-stone-300 text-sm font-black dark:border-stone-700">
                <Upload class="h-4 w-4" />
                อัปโหลด QR รับเงิน
                <input type="file" accept="image/*" class="hidden" @change="handleBackofficeQrFile" />
              </label>
            </div>
          </div>
        </section>

        <section v-if="forms.backofficeTab === 'orders'" class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-lg font-black">รายการซื้อ coin</h2>
            <span class="rounded-md bg-paper-100 px-3 py-1 text-xs font-black text-stone-600 dark:bg-stone-800 dark:text-stone-300">
              {{ ordersPagination.total }} รายการ
            </span>
          </div>
          <div class="mt-3 grid gap-3">
            <article v-for="order in orders" :key="order.id" class="grid gap-3 rounded-md bg-paper-100 p-3 dark:bg-stone-800 lg:grid-cols-[1fr_8rem_9rem_auto] lg:items-center">
              <div class="min-w-0">
                <p class="truncate font-black">{{ order.adminEmail }}</p>
                <p class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">ราคา ฿{{ order.priceThb }} · ได้ {{ order.coins }} coin · {{ order.createdAt }}</p>
                <p v-if="order.note" class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">{{ order.note }}</p>
                <div class="mt-2 rounded-md bg-white p-2 text-xs font-semibold text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="rounded px-2 py-1 font-black" :class="order.verificationStatus === 'passed' ? 'bg-court-500/10 text-court-700 dark:text-court-300' : order.verificationStatus === 'warning' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300'">
                      {{ order.verificationStatus || 'manual_review' }}
                    </span>
                    <span v-if="order.transRef">transRef: {{ order.transRef }}</span>
                  </div>
                  <p v-if="order.verificationNote" class="mt-1">{{ order.verificationNote }}</p>
                  <p class="mt-1">
                    <span v-if="order.detectedAmountThb">ยอดที่อ่านได้ ฿{{ Number(order.detectedAmountThb || 0).toLocaleString('th-TH') }}</span>
                    <span v-if="order.detectedPaidAt"> · เวลา {{ order.detectedPaidAt }}</span>
                    <span v-if="order.detectedReceiver"> · ผู้รับ {{ order.detectedReceiver }}</span>
                  </p>
                </div>
              </div>
              <button
                v-if="order.slipImage"
                type="button"
                class="group relative h-24 w-full overflow-hidden rounded-md bg-white p-1 ring-1 ring-stone-200 transition hover:ring-court-500 dark:bg-stone-900 dark:ring-stone-800"
                title="ดูสลิปขนาดใหญ่"
                @click="openSlipPreview(order)"
              >
                <img :src="order.slipImage" alt="สลิป" class="h-full w-full object-contain" />
                <span class="absolute inset-x-1 bottom-1 rounded bg-stone-950/70 px-2 py-1 text-center text-[11px] font-black text-white opacity-0 transition group-hover:opacity-100">ดูรูปใหญ่</span>
              </button>
              <span class="w-max rounded-md px-2 py-1 text-xs font-black" :class="coinOrderStatusClass(order.status)">{{ coinOrderStatusText(order.status) }}</span>
              <div v-if="order.status === 'pending'" class="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                <button class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-court-500 px-3 text-sm font-black text-white" @click="reviewBackofficeCoinOrder(order.id, 'approved')">
                  <CheckCircle2 class="h-4 w-4" />
                  อนุมัติ
                </button>
                <button class="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-black text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" @click="reviewBackofficeCoinOrder(order.id, 'rejected')">
                  <XCircle class="h-4 w-4" />
                  ไม่อนุมัติ
                </button>
              </div>
            </article>
            <p v-if="!orders.length" class="rounded-md bg-paper-100 p-4 text-sm font-semibold text-stone-500 dark:bg-stone-800">ยังไม่มีรายการซื้อ coin</p>
          </div>
          <div v-if="ordersPagination.total > 0" class="mt-4 grid gap-3 border-t border-stone-200 pt-3 text-sm dark:border-stone-800 sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <select
              v-model.number="forms.backofficeOrdersPageSize"
              class="h-9 rounded-md border border-stone-200 bg-paper-50 px-3 font-black dark:border-stone-700 dark:bg-stone-800"
              aria-label="จำนวนรายการซื้อต่อหน้า"
              @change="loadBackofficeCoinOrders(1)"
            >
              <option :value="10">10 รายการ</option>
              <option :value="20">20 รายการ</option>
              <option :value="50">50 รายการ</option>
            </select>
            <span class="text-center font-black">หน้า {{ ordersPagination.page }} / {{ Math.max(1, ordersPagination.totalPages) }}</span>
            <div class="grid grid-cols-2 gap-2">
            <button
              class="h-9 rounded-md border border-stone-200 px-3 font-black disabled:opacity-40 dark:border-stone-700"
              :disabled="ordersPagination.page <= 1"
              @click="loadBackofficeCoinOrders(ordersPagination.page - 1)"
            >
              ก่อนหน้า
            </button>
            <button
              class="h-9 rounded-md border border-stone-200 px-3 font-black disabled:opacity-40 dark:border-stone-700"
              :disabled="ordersPagination.page >= ordersPagination.totalPages"
              @click="loadBackofficeCoinOrders(ordersPagination.page + 1)"
            >
              ถัดไป
            </button>
            </div>
          </div>
        </section>

        <section v-if="forms.backofficeTab === 'members'" class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <Users class="h-5 w-5 text-court-600" />
              <h2 class="text-lg font-black">สมาชิก admin</h2>
            </div>
            <span class="rounded-md bg-paper-100 px-3 py-1 text-xs font-black text-stone-600 dark:bg-stone-800 dark:text-stone-300">{{ users.length }} คน</span>
          </div>
          <div class="mt-3 divide-y divide-stone-200 overflow-hidden rounded-md border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
            <div v-for="user in users" :key="user.id" class="grid gap-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div class="min-w-0">
                <p class="truncate font-black">{{ user.email }}</p>
                <p class="mt-1 truncate text-xs font-semibold text-stone-500">{{ user.name }} · {{ user.sessions }} session · {{ user.verified ? 'verified' : 'not verified' }}</p>
              </div>
              <div class="flex items-center justify-end gap-2">
                <p class="text-right text-lg font-black tabular-nums">{{ user.coins }} coin</p>
                <button class="inline-flex h-10 items-center gap-2 rounded-md border border-stone-200 px-3 text-sm font-black dark:border-stone-700" @click="openBackofficeAdminDetail(user.id)">
                  <Eye class="h-4 w-4" />
                  ดู
                </button>
              </div>
            </div>
            <p v-if="!users.length" class="p-4 text-sm font-semibold text-stone-500">ยังไม่มี admin user</p>
          </div>
        </section>

        <section v-if="forms.backofficeTab === 'support'" class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="text-lg font-black">แจ้งปัญหา</h2>
              <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">ตรวจรายละเอียด รูปประกอบ และช่องทางติดต่อกลับ</p>
            </div>
            <span class="rounded-md bg-paper-100 px-3 py-1 text-xs font-black text-stone-600 dark:bg-stone-800 dark:text-stone-300">
              {{ supportPagination.total }} รายการ
            </span>
          </div>

          <form class="mt-4 grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto]" @submit.prevent="applyBackofficeSupportFilters">
            <select v-model="forms.backofficeSupportStatus" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 text-sm font-bold dark:border-stone-700 dark:bg-stone-800" @change="applyBackofficeSupportFilters">
              <option value="">ทุกสถานะ</option>
              <option value="new">ใหม่</option>
              <option value="in_progress">กำลังตรวจสอบ</option>
              <option value="resolved">แก้ไขแล้ว</option>
            </select>
            <input v-model="forms.backofficeSupportSearch" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 text-sm font-bold dark:border-stone-700 dark:bg-stone-800" placeholder="ค้นหาเลขรายการ ชื่อปัญหา หรือติดต่อกลับ" />
            <button class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-court-500 px-4 text-sm font-black text-white">
              <Search class="h-4 w-4" />
              ค้นหา
            </button>
          </form>

          <div class="mt-4 grid gap-2">
            <button
              v-for="issue in supportIssues"
              :key="issue.id"
              class="grid gap-3 rounded-md border border-stone-200 bg-paper-50 p-3 text-left transition hover:border-court-500 dark:border-stone-700 dark:bg-stone-800 sm:grid-cols-[1fr_auto] sm:items-center"
              @click="openBackofficeSupportIssue(issue.id)"
            >
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="truncate font-black">{{ issue.title }}</p>
                  <span class="rounded-md px-2 py-1 text-xs font-black" :class="supportStatusClass(issue.status)">{{ supportStatusText(issue.status) }}</span>
                </div>
                <p class="mt-1 line-clamp-2 text-sm font-semibold text-stone-600 dark:text-stone-300">{{ issue.details }}</p>
                <p class="mt-1 text-xs font-semibold text-stone-500">{{ issue.id }} · {{ issue.contact }} · {{ issue.imageCount }} รูป</p>
              </div>
              <span class="text-xs font-black text-stone-500">{{ issue.createdAt }}</span>
            </button>
            <p v-if="!supportIssues.length" class="rounded-md bg-paper-100 p-4 text-sm font-semibold text-stone-500 dark:bg-stone-800">ไม่พบรายการแจ้งปัญหา</p>
          </div>

          <div v-if="supportPagination.totalPages > 1" class="mt-4 flex items-center justify-between gap-3 border-t border-stone-200 pt-3 text-sm dark:border-stone-800">
            <button class="h-9 rounded-md border border-stone-200 px-3 font-black disabled:opacity-40 dark:border-stone-700" :disabled="supportPagination.page <= 1" @click="loadBackofficeSupportIssues(supportPagination.page - 1)">ก่อนหน้า</button>
            <span class="font-black">หน้า {{ supportPagination.page }} / {{ supportPagination.totalPages }}</span>
            <button class="h-9 rounded-md border border-stone-200 px-3 font-black disabled:opacity-40 dark:border-stone-700" :disabled="supportPagination.page >= supportPagination.totalPages" @click="loadBackofficeSupportIssues(supportPagination.page + 1)">ถัดไป</button>
          </div>
        </section>

        <section v-if="forms.backofficeTab === 'activity'" class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-lg font-black">Activity log</h2>
            <span class="rounded-md bg-paper-100 px-3 py-1 text-xs font-black text-stone-600 dark:bg-stone-800 dark:text-stone-300">
              {{ activityPagination.total }} รายการ
            </span>
          </div>
          <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">บันทึกทุก action ที่เกี่ยวกับเงินและ coin เพื่อใช้ตรวจสอบย้อนหลัง</p>
          <form class="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" @submit.prevent="applyBackofficeActivityFilters">
            <label class="grid gap-1 text-xs font-black text-stone-500 dark:text-stone-400">
              User
              <select
                v-model="forms.backofficeActivityUserId"
                class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 text-sm font-bold text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                @change="changeBackofficeActivityUser"
              >
                <option value="">User ทั้งหมด</option>
                <option v-for="user in users" :key="user.id" :value="user.id">{{ user.email }}</option>
              </select>
            </label>
            <label class="grid gap-1 text-xs font-black text-stone-500 dark:text-stone-400">
              Match
              <select
                v-model="forms.backofficeActivityMatchId"
                class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 text-sm font-bold text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                :disabled="!forms.backofficeActivityUserId"
              >
                <option value="">{{ forms.backofficeActivityUserId ? 'Match ทั้งหมด' : 'เลือก User ก่อน' }}</option>
                <option v-for="match in forms.backofficeActivityMatchOptions" :key="match.id" :value="match.id">{{ match.label }}</option>
              </select>
            </label>
            <button class="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-md bg-court-500 px-4 text-sm font-black text-white">
              <Search class="h-4 w-4" />
              กรอง
            </button>
          </form>
          <div class="mt-3 grid gap-2">
            <article v-for="item in logs" :key="item.id" class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p class="font-black">{{ activityText(item.action) }}</p>
                  <p class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">{{ item.actorType }}: {{ item.actorId }} · {{ item.targetType }} {{ item.targetId }}</p>
                </div>
                <span class="rounded-md bg-white px-2 py-1 text-xs font-black text-stone-500 dark:bg-stone-900 dark:text-stone-300">{{ item.createdAt }}</span>
              </div>
              <p class="mt-2 rounded-md bg-white p-2 text-xs font-semibold text-stone-500 dark:bg-stone-900 dark:text-stone-300">{{ activityDetails(item.details) }}</p>
            </article>
            <p v-if="!logs.length" class="rounded-md bg-paper-100 p-4 text-sm font-semibold text-stone-500 dark:bg-stone-800">ยังไม่มี Activity log</p>
          </div>
          <div v-if="activityPagination.totalPages > 1" class="mt-4 flex items-center justify-between gap-3 border-t border-stone-200 pt-3 text-sm dark:border-stone-800">
            <button
              class="h-9 rounded-md border border-stone-200 px-3 font-black disabled:opacity-40 dark:border-stone-700"
              :disabled="activityPagination.page <= 1"
              @click="loadBackofficeActivityLogs(activityPagination.page - 1)"
            >
              ก่อนหน้า
            </button>
            <span class="font-black">หน้า {{ activityPagination.page }} / {{ activityPagination.totalPages }}</span>
            <button
              class="h-9 rounded-md border border-stone-200 px-3 font-black disabled:opacity-40 dark:border-stone-700"
              :disabled="activityPagination.page >= activityPagination.totalPages"
              @click="loadBackofficeActivityLogs(activityPagination.page + 1)"
            >
              ถัดไป
            </button>
          </div>
        </section>

        <section v-if="forms.backofficeTab === 'orders'" class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
          <h2 class="text-lg font-black">Coin ledger</h2>
          <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div v-for="item in ledger" :key="item.id" class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
              <div class="flex items-center justify-between gap-3">
                <p class="font-black" :class="item.delta > 0 ? 'text-court-700 dark:text-court-300' : 'text-red-700 dark:text-red-300'">{{ item.delta > 0 ? '+' : '' }}{{ item.delta }}</p>
                <p class="text-xs text-stone-500">{{ item.createdAt }}</p>
              </div>
              <p class="mt-1 truncate text-sm font-semibold">{{ item.adminEmail }}</p>
              <p class="mt-1 text-xs text-stone-500">{{ item.reason }} · balance {{ item.balance }}</p>
            </div>
          </div>
        </section>
      </template>
    </div>

    <div v-if="ui.showBackofficeAdminModal" class="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3 sm:place-items-center">
      <div class="w-full max-w-5xl rounded-lg bg-white p-4 shadow-soft dark:bg-stone-900">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-black text-court-700 dark:text-court-300">Admin DB Preview</p>
            <h2 class="mt-1 truncate text-2xl font-black">{{ adminDetailUser.name || adminDetailUser.email || '-' }}</h2>
            <p class="mt-1 truncate text-sm font-semibold text-stone-500 dark:text-stone-400">{{ adminDetailUser.email }} · {{ adminDetailUser.verified ? 'verified' : 'not verified' }}</p>
          </div>
          <button class="grid h-9 w-9 place-items-center rounded-md border border-stone-200 dark:border-stone-700" aria-label="ปิด modal" @click="ui.showBackofficeAdminModal = false">
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="mt-4 grid max-h-[74vh] gap-4 overflow-auto pr-1">
          <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <article class="rounded-lg border border-stone-200 p-3 dark:border-stone-700">
              <p class="text-xs font-bold text-stone-500 dark:text-stone-400">Coin ที่เหลือ</p>
              <p class="mt-2 text-2xl font-black tabular-nums">{{ Number(adminDetailUser.coins || 0).toLocaleString('th-TH') }}</p>
            </article>
            <article class="rounded-lg border border-stone-200 p-3 dark:border-stone-700">
              <p class="text-xs font-bold text-stone-500 dark:text-stone-400">Session</p>
              <p class="mt-2 text-2xl font-black tabular-nums">{{ adminDetailSessions.length }}</p>
            </article>
            <article class="rounded-lg border border-stone-200 p-3 dark:border-stone-700">
              <p class="text-xs font-bold text-stone-500 dark:text-stone-400">รายการซื้อ coin</p>
              <p class="mt-2 text-2xl font-black tabular-nums">{{ adminDetailOrders.length }}</p>
            </article>
            <article class="rounded-lg border border-stone-200 p-3 dark:border-stone-700">
              <p class="text-xs font-bold text-stone-500 dark:text-stone-400">สมัครเมื่อ</p>
              <p class="mt-2 text-sm font-black">{{ adminDetailUser.createdAt || '-' }}</p>
            </article>
          </div>

          <section class="rounded-lg border border-stone-200 p-4 dark:border-stone-700">
            <div class="flex items-center justify-between gap-3">
              <h3 class="font-black">Session ของ admin นี้</h3>
              <span class="rounded-md bg-paper-100 px-2 py-1 text-xs font-black text-stone-500 dark:bg-stone-800 dark:text-stone-300">{{ adminDetailSessions.length }} รายการ</span>
            </div>
            <div class="mt-3 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
              <div v-for="session in adminDetailSessions" :key="session.id" class="grid gap-2 border-t border-stone-200 p-3 first:border-t-0 dark:border-stone-800 md:grid-cols-[1fr_0.7fr_0.7fr_0.7fr] md:items-center">
                <div class="min-w-0">
                  <p class="truncate font-black">{{ session.name }}</p>
                  <p class="mt-1 truncate text-xs font-semibold text-stone-500">{{ session.type || 'liveMatch' }} · {{ session.updatedAt || '-' }}</p>
                </div>
                <p class="text-sm font-black">{{ Number(session.players || 0).toLocaleString('th-TH') }} สมาชิก</p>
                <p class="text-sm font-black">{{ Number(session.matches || 0).toLocaleString('th-TH') }} เกม</p>
                <p class="text-sm font-black">{{ Number(session.revenue || 0).toLocaleString('th-TH') }} บาท</p>
              </div>
              <p v-if="!adminDetailSessions.length" class="p-4 text-sm font-semibold text-stone-500">ยังไม่มี session</p>
            </div>
          </section>

          <div class="grid gap-4 lg:grid-cols-2">
            <section class="rounded-lg border border-stone-200 p-4 dark:border-stone-700">
              <h3 class="font-black">รายการซื้อ coin</h3>
              <div class="mt-3 grid gap-2">
                <div v-for="order in adminDetailOrders" :key="order.id" class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
                  <div class="flex items-center justify-between gap-3">
                    <p class="font-black">฿{{ Number(order.priceThb || 0).toLocaleString('th-TH') }} / {{ Number(order.coins || 0).toLocaleString('th-TH') }} coin</p>
                    <span class="rounded-md px-2 py-1 text-xs font-black" :class="coinOrderStatusClass(order.status)">{{ coinOrderStatusText(order.status) }}</span>
                  </div>
                  <p class="mt-1 text-xs font-semibold text-stone-500">{{ order.createdAt }}</p>
                </div>
                <p v-if="!adminDetailOrders.length" class="rounded-md bg-paper-100 p-4 text-sm font-semibold text-stone-500 dark:bg-stone-800">ยังไม่มีรายการซื้อ coin</p>
              </div>
            </section>

            <section class="rounded-lg border border-stone-200 p-4 dark:border-stone-700">
              <h3 class="font-black">Coin ledger</h3>
              <div class="mt-3 grid gap-2">
                <div v-for="item in adminDetailLedger" :key="item.id" class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
                  <div class="flex items-center justify-between gap-3">
                    <p class="font-black">{{ item.reason }}</p>
                    <p class="font-black tabular-nums" :class="item.delta > 0 ? 'text-court-700 dark:text-court-300' : 'text-red-700 dark:text-red-300'">{{ item.delta > 0 ? '+' : '' }}{{ item.delta }}</p>
                  </div>
                  <p class="mt-1 text-xs font-semibold text-stone-500">{{ item.createdAt }} · คงเหลือ {{ item.balance }}</p>
                </div>
                <p v-if="!adminDetailLedger.length" class="rounded-md bg-paper-100 p-4 text-sm font-semibold text-stone-500 dark:bg-stone-800">ยังไม่มี coin ledger</p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>

    <div v-if="ui.showBackofficeSupportModal && supportIssueDetail" class="fixed inset-0 z-[60] grid place-items-end bg-black/60 p-3 sm:place-items-center" role="dialog" aria-modal="true" aria-label="รายละเอียดแจ้งปัญหา" @click.self="ui.showBackofficeSupportModal = false">
      <div class="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-lg bg-white p-4 shadow-soft dark:bg-stone-900 sm:p-5">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-black text-court-700 dark:text-court-300">{{ supportIssueDetail.id }}</p>
            <h2 class="mt-1 text-xl font-black">{{ supportIssueDetail.title }}</h2>
            <p class="mt-1 text-xs font-semibold text-stone-500">{{ supportIssueDetail.createdAt }}</p>
          </div>
          <button class="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-stone-200 dark:border-stone-700" aria-label="ปิด modal" @click="ui.showBackofficeSupportModal = false">
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="mt-4 grid gap-4 lg:grid-cols-[1fr_0.8fr]">
          <div class="grid content-start gap-3">
            <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
              <p class="text-xs font-black text-stone-500">รายละเอียด</p>
              <p class="mt-2 whitespace-pre-wrap text-sm font-semibold">{{ supportIssueDetail.details }}</p>
            </div>
            <div class="rounded-md bg-paper-100 p-3 dark:bg-stone-800">
              <p class="text-xs font-black text-stone-500">ติดต่อกลับ</p>
              <p class="mt-2 break-words font-black">{{ supportIssueDetail.contact }}</p>
            </div>
            <div v-if="supportIssueDetail.images?.length" class="grid grid-cols-2 gap-2">
              <a v-for="(image, index) in supportIssueDetail.images" :key="index" :href="image" target="_blank" rel="noreferrer" class="aspect-square overflow-hidden rounded-md border border-stone-200 bg-paper-100 dark:border-stone-700 dark:bg-stone-800">
                <img :src="image" :alt="`รูปปัญหา ${index + 1}`" class="h-full w-full object-contain" />
              </a>
            </div>
          </div>

          <div class="grid content-start gap-3">
            <label class="grid gap-2 text-sm font-black">
              สถานะ
              <select v-model="supportIssueDetail.status" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800">
                <option value="new">ใหม่</option>
                <option value="in_progress">กำลังตรวจสอบ</option>
                <option value="resolved">แก้ไขแล้ว</option>
              </select>
            </label>
            <label class="grid gap-2 text-sm font-black">
              บันทึกข้อความตอบกลับ
              <textarea v-model="supportIssueDetail.supervisorReply" maxlength="5000" rows="7" class="rounded-md border border-stone-200 bg-paper-50 p-3 dark:border-stone-700 dark:bg-stone-800" placeholder="บันทึกคำตอบหรือแนวทางแก้ไข แล้วติดต่อผู้แจ้งผ่านช่องทางที่ให้มา" />
            </label>
            <button class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-court-500 px-4 text-sm font-black text-white disabled:cursor-wait disabled:opacity-60" :disabled="forms.backofficeSupportSaving" @click="saveBackofficeSupportIssue">
              <Save class="h-4 w-4" />
              {{ forms.backofficeSupportSaving ? 'กำลังบันทึก...' : 'บันทึก' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="ui.showBackofficeSlipModal && forms.backofficeSlipPreview" class="fixed inset-0 z-[60] grid place-items-end bg-black/70 p-3 sm:place-items-center" role="dialog" aria-modal="true" aria-label="ดูสลิป">
      <div class="w-full max-w-3xl rounded-lg bg-white p-4 shadow-soft dark:bg-stone-900">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-black text-court-700 dark:text-court-300">Payment slip</p>
            <h2 class="mt-1 truncate text-xl font-black">{{ forms.backofficeSlipPreview.adminEmail || '-' }}</h2>
            <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">฿{{ Number(forms.backofficeSlipPreview.priceThb || 0).toLocaleString('th-TH') }} · {{ Number(forms.backofficeSlipPreview.coins || 0).toLocaleString('th-TH') }} coin · {{ forms.backofficeSlipPreview.createdAt }}</p>
          </div>
          <button class="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-stone-200 dark:border-stone-700" aria-label="ปิด modal" @click="closeSlipPreview">
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="mt-4 grid max-h-[75vh] place-items-center overflow-auto rounded-md bg-paper-100 p-3 dark:bg-stone-800">
          <img :src="forms.backofficeSlipPreview.slipImage" alt="สลิปชำระเงิน" class="max-h-[70vh] max-w-full rounded-md bg-white object-contain p-2 dark:bg-stone-950" />
        </div>

        <div class="mt-4 flex justify-end">
          <button class="h-10 rounded-md border border-stone-200 px-4 text-sm font-black dark:border-stone-700" @click="closeSlipPreview">ปิด</button>
        </div>
      </div>
    </div>
  </section>
</template>
