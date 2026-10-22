<script setup>
import { Plus, Trash2, X } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import ProductStockCombobox from '../components/ProductStockCombobox.vue'

const props = defineProps([
  'state',
  'apiRequest',
  'forms',
  'addCourt',
  'removeCourt',
  'addLevel',
  'removeLevel',
  'addShuttleBrand',
  'usedCourtNames',
  'usedLevels',
  'saveSettings',
  'updatePlayerLibero',
  'isSessionReadOnly'
])

const activeSettingsTab = ref('general')
const isLiveShare = computed(() => props.state.session?.type === 'liveShare')
const usedCourtSet = computed(() => props.usedCourtNames || new Set())
const usedLevelSet = computed(() => props.usedLevels || new Set())
const liberoSearch = ref('')
const liberoComboboxOpen = ref(false)
const liberoSavingId = ref(0)
const liberoPlayers = computed(() => (props.state.players || []).filter((player) => player.active && !player.paid && player.libero))
const availableLiberoPlayers = computed(() => {
  const search = liberoSearch.value.trim().toLowerCase()
  return (props.state.players || [])
    .filter((player) => player.active && !player.paid && !player.libero)
    .filter((player) => !search || player.name.toLowerCase().includes(search) || String(player.id).includes(search))
    .sort((a, b) => a.id - b.id)
})

async function setLibero(playerId, enabled) {
  if (!playerId || !props.updatePlayerLibero) return
  liberoSavingId.value = Number(playerId)
  try {
    await props.updatePlayerLibero(Number(playerId), enabled)
    if (enabled) {
      liberoSearch.value = ''
      liberoComboboxOpen.value = false
    }
  } finally {
    liberoSavingId.value = 0
  }
}

function closeLiberoCombobox() {
  window.setTimeout(() => {
    liberoComboboxOpen.value = false
  }, 120)
}

async function selectLiberoPlayer(player) {
  liberoSearch.value = `#${player.id} ${player.name}`
  await setLibero(player.id, true)
}

function applyLinkedShuttleProduct(brand, product) {
  if (product) {
    brand.priceSatang = Math.max(0, Number(product.priceSatang || 0))
    brand.price = brand.priceSatang / 100
  }
  props.saveSettings?.()
}

function updateShuttleBrandPrice(brand, event) {
  const price = Math.max(0, Number(event.target.value || 0))
  brand.price = price
  brand.priceSatang = Math.round(price * 100)
}

function removeShuttleBrand(index) {
  if ((props.state.settings.shuttleBrands || []).length <= 1) return
  props.state.settings.shuttleBrands.splice(index, 1)
  if (!props.state.settings.shuttleBrands.some((brand) => brand.active)) {
    props.state.settings.shuttleBrands[0].active = true
  }
  props.saveSettings?.()
}

const settingsTabs = computed(() => [
  { id: 'general', label: 'ทั่วไป', hint: 'ชื่อ session และ workflow' },
  { id: 'costs', label: 'ค่าใช้จ่าย', hint: 'ค่าสนามและลูกแบด' },
  { id: 'courts', label: 'สนาม', hint: 'ชื่อสนามทั้งหมด' },
  ...(!isLiveShare.value ? [
    { id: 'waiting', label: 'เวลารอเล่น', hint: 'แสดงเวลาแยกแต่ละหน้า' },
    { id: 'libero', label: 'ริโบโร่', hint: 'เตรียมผู้เล่นลงเกมถัดไป' },
    { id: 'match', label: 'จัดคู่ / เสียง', hint: 'ระดับมือ การสุ่ม และคำอ่าน' }
  ] : [])
])

const sessionName = computed({
  get: () => props.state.session?.name || '',
  set: (value) => {
    if (!props.state.session) props.state.session = {}
    props.state.session.name = value
  }
})

watch(settingsTabs, (tabs) => {
  if (!tabs.some((tab) => tab.id === activeSettingsTab.value)) {
    activeSettingsTab.value = tabs[0]?.id || 'general'
  }
})
</script>

<template>
  <section class="grid gap-4">
    <div class="overflow-x-auto rounded-lg border border-stone-200 bg-white p-2 shadow-soft dark:border-stone-700 dark:bg-stone-900">
      <div class="flex min-w-max gap-2">
        <button
          v-for="tab in settingsTabs"
          :key="tab.id"
          type="button"
          class="min-w-32 rounded-md px-4 py-3 text-left transition"
          :class="activeSettingsTab === tab.id ? 'bg-court-500 text-white shadow-soft' : 'bg-paper-100 text-stone-700 hover:bg-paper-50 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700'"
          @click="activeSettingsTab = tab.id"
        >
          <span class="block text-sm font-black">{{ tab.label }}</span>
          <span class="mt-0.5 block text-xs font-semibold opacity-75">{{ tab.hint }}</span>
        </button>
      </div>
    </div>

    <fieldset class="grid gap-4 disabled:opacity-75" :disabled="isSessionReadOnly">
      <div v-if="activeSettingsTab === 'general'" class="grid gap-4 lg:grid-cols-2">
        <label class="grid gap-2 rounded-lg border border-court-200 bg-white p-4 dark:border-court-900 dark:bg-stone-900">
          <span class="font-bold">ชื่อ Session</span>
          <input v-model.trim="sessionName" maxlength="120" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" placeholder="ชื่อสนามหรือชื่อกิจกรรม" @change="saveSettings" />
        </label>

        <label class="grid gap-2 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
          <span class="font-bold">ค่าใช้ session</span>
          <input v-model.number="state.settings.sessionFee" type="number" min="0" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" @change="saveSettings" />
          <span class="text-sm text-stone-500 dark:text-stone-400">หารเฉลี่ยตามจำนวนสมาชิก active แล้วบวกในค่าใช้จ่ายของทุกคน</span>
        </label>

        <label v-if="isLiveShare" class="flex items-center justify-between gap-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
          <span>
            <span class="block font-black">โหมด liveShare</span>
            <span class="mt-1 block text-sm font-semibold text-stone-500 dark:text-stone-400">ระบบคิดค่าสนามและลูกแบดตามชั่วโมงเล่น</span>
          </span>
          <input checked disabled type="checkbox" class="h-5 w-5" />
        </label>

        <label v-if="!isLiveShare" class="grid gap-3 rounded-lg border border-court-200 bg-white p-4 shadow-soft dark:border-court-900 dark:bg-stone-900">
          <span class="flex items-center justify-between gap-4">
            <span>
              <span class="block font-black">สถานะหลังจบเกม</span>
              <span class="mt-1 block text-sm font-semibold text-stone-500 dark:text-stone-400">จบเกมแล้วตั้งผู้เล่นเป็นยังไม่พร้อม และกลับไปแสดงแบบนั้นในหน้าจัดคู่</span>
            </span>
            <input v-model="state.settings.resetPlayersAfterFinish" type="checkbox" class="h-5 w-5 shrink-0" @change="saveSettings" />
          </span>
        </label>

        <label v-if="!isLiveShare" class="grid gap-3 rounded-lg border border-court-200 bg-white p-4 shadow-soft dark:border-court-900 dark:bg-stone-900">
          <span class="flex items-center justify-between gap-4">
            <span>
              <span class="block font-black">ลูกแบดตอนเริ่มเกม</span>
              <span class="mt-1 block text-sm font-semibold text-stone-500 dark:text-stone-400">เริ่มเกมแล้วนับลูกแบด 1 ลูกอัตโนมัติ</span>
            </span>
            <input v-model="state.settings.startMatchWithShuttle" type="checkbox" class="h-5 w-5 shrink-0" @change="saveSettings" />
          </span>
        </label>

      </div>

      <div v-else-if="activeSettingsTab === 'costs'" class="grid gap-4 lg:grid-cols-2">
        <label v-if="isLiveShare" class="grid gap-2 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
          <span class="font-bold">ค่าสนามต่อชั่วโมง</span>
          <input v-model.number="state.settings.courtFeePerHour" type="number" min="0" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" @change="saveSettings" />
        </label>

        <label v-for="memberType in (!isLiveShare ? (state.memberTypes || []).filter((item) => item.active) : [])" :key="memberType.id" class="grid gap-2 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
          <span class="font-bold">ค่าเข้าสนาม {{ memberType.name }}</span>
          <input v-model.number="state.settings.memberEntryFees[memberType.id]" type="number" min="0" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" @change="saveSettings" />
        </label>

        <div class="grid gap-4 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900 lg:col-span-2">
          <div>
            <h2 class="font-black">ยี่ห้อลูกแบด</h2>
            <p class="mt-1 text-xs font-semibold leading-5 text-stone-500 dark:text-stone-400">กำหนดชื่อ ราคาสำรอง และสินค้าสต็อก POS สำหรับ Session นี้</p>
          </div>
          <div class="grid gap-3">
            <article v-for="(brand, index) in state.settings.shuttleBrands" :key="brand.id" class="grid gap-3 rounded-xl border border-stone-200 bg-paper-100 p-3 dark:border-stone-700 dark:bg-stone-800/70">
              <div class="flex min-w-0 items-end gap-2">
                <label class="grid min-w-0 flex-1 gap-1.5">
                  <span class="text-xs font-black text-stone-500 dark:text-stone-400">ชื่อยี่ห้อลูกแบด</span>
                  <input v-model.trim="brand.name" class="h-11 min-w-0 rounded-lg border border-stone-200 bg-white px-3 font-bold dark:border-stone-700 dark:bg-stone-900" @change="saveSettings" />
                </label>
                <label class="flex h-11 shrink-0 items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 text-sm font-bold dark:border-stone-700 dark:bg-stone-900">
                  <input v-model="brand.active" type="checkbox" class="h-4 w-4 accent-court-600" @change="saveSettings" />
                  ใช้งาน
                </label>
                <button type="button" class="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-rose-200 text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-35 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/30" :disabled="state.settings.shuttleBrands.length <= 1" aria-label="ลบยี่ห้อลูกแบด" @click="removeShuttleBrand(index)">
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>

              <div class="grid min-w-0 gap-3 md:grid-cols-[10rem_minmax(0,1fr)]">
                <label class="grid min-w-0 gap-1.5">
                  <span class="text-xs font-black text-stone-500 dark:text-stone-400">ราคาต่อลูก</span>
                  <input :value="Number(brand.priceSatang ?? Math.round(Number(brand.price || 0) * 100)) / 100" type="number" min="0" step="0.01" :disabled="Boolean(brand.posProductId)" class="h-11 min-w-0 rounded-lg border border-stone-200 bg-white px-3 font-bold tabular-nums disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:disabled:bg-stone-900/50" @input="updateShuttleBrandPrice(brand, $event)" @change="saveSettings" />
                  <small v-if="brand.posProductId" class="font-bold text-court-700 dark:text-court-300">ใช้ราคา POS {{ (Number(brand.priceSatang || 0) / 100).toLocaleString('th-TH', { minimumFractionDigits: Number(brand.priceSatang || 0) % 100 ? 2 : 0 }) }} บาท</small>
                  <small v-else class="font-semibold text-stone-500">ราคาสำรองของ Match</small>
                </label>
                <label class="grid min-w-0 gap-1.5">
                  <span class="text-xs font-black text-stone-500 dark:text-stone-400">เชื่อมสินค้าสต็อก POS</span>
                  <ProductStockCombobox v-model="brand.posProductId" :api-request="apiRequest" @selected-product="applyLinkedShuttleProduct(brand, $event)" />
                  <small class="font-semibold text-stone-500">เลือกเฉพาะสินค้าที่เปิดติดตามสต็อก</small>
                </label>
              </div>
            </article>
          </div>

          <div class="grid gap-3 rounded-xl border border-dashed border-stone-300 bg-paper-50 p-3 dark:border-stone-700 dark:bg-stone-800/50 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
            <label class="grid min-w-0 gap-1.5"><span class="text-xs font-black text-stone-500 dark:text-stone-400">เพิ่มยี่ห้อใหม่</span><input v-model="forms.newShuttleBrandName" class="h-11 min-w-0 rounded-lg border border-stone-200 bg-white px-3 font-bold dark:border-stone-700 dark:bg-stone-900" placeholder="ชื่อยี่ห้อลูกแบด" @keyup.enter="addShuttleBrand" /></label>
            <label class="grid min-w-0 gap-1.5"><span class="text-xs font-black text-stone-500 dark:text-stone-400">ราคาเริ่มต้น</span><input v-model.number="forms.newShuttleBrandPrice" type="number" min="0" step="0.01" class="h-11 min-w-0 rounded-lg border border-stone-200 bg-white px-3 font-bold tabular-nums dark:border-stone-700 dark:bg-stone-900" placeholder="0.00" @keyup.enter="addShuttleBrand" /></label>
            <button type="button" class="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 text-sm font-black text-white transition hover:bg-stone-800 dark:bg-white dark:text-stone-900" @click="addShuttleBrand">
              <Plus class="h-4 w-4" />
              เพิ่ม
            </button>
          </div>
          <p class="rounded-lg bg-court-500/10 px-3 py-2.5 text-xs font-semibold leading-5 text-court-700 dark:text-court-300">เมื่อเชื่อม POS ราคาจะอ่านจากสินค้าและแก้ใน Session ไม่ได้ ลูกแบด 1 ลูกจะตัดสินค้า 1 หน่วย</p>
        </div>
      </div>

      <div v-else-if="activeSettingsTab === 'courts'" class="grid gap-4">
        <div class="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="font-black">ชื่อสนาม</h2>
              <p class="text-sm text-stone-500 dark:text-stone-400">จำนวนสนาม {{ state.settings.courtNames.length }} สนาม</p>
            </div>
          </div>

          <div class="mt-4 space-y-2">
            <div v-for="(court, index) in state.settings.courtNames" :key="index" class="grid grid-cols-[1fr_auto] gap-2">
              <input v-model="state.settings.courtNames[index]" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" @change="saveSettings" />
              <button
                class="grid h-10 w-10 place-items-center rounded-md border border-stone-200 dark:border-stone-700"
                :class="usedCourtSet.has(court) ? 'opacity-40' : ''"
                :disabled="usedCourtSet.has(court)"
                :title="usedCourtSet.has(court) ? 'สนามนี้ถูกใช้งานแล้ว' : 'ลบสนาม'"
                @click="removeCourt(index)"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
          </div>

          <div class="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <input v-model="forms.newCourtName" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" placeholder="ชื่อสนามใหม่" @keyup.enter="addCourt" />
            <button class="inline-flex h-10 items-center gap-2 rounded-md bg-court-500 px-4 font-bold text-white" @click="addCourt">
              <Plus class="h-4 w-4" />
              เพิ่ม
            </button>
          </div>
        </div>
      </div>

      <div v-else-if="activeSettingsTab === 'waiting'" class="grid gap-4 lg:grid-cols-3">
        <label class="flex items-center justify-between gap-4 rounded-lg border border-court-200 bg-court-50/60 p-4 dark:border-court-900 dark:bg-court-950/20 lg:col-span-3">
          <span>
            <span class="block font-black">เล่นอนิเมชันเมื่อเริ่มการแข่งขัน</span>
            <span class="mt-1 block text-sm font-semibold text-stone-500 dark:text-stone-400">แสดงการ์ดเปิดตัวผู้เล่น 5 วินาทีบนหน้าคิวจอ PC เท่านั้น</span>
          </span>
          <input v-model="state.settings.matchStartAnimationEnabled" type="checkbox" class="h-5 w-5 shrink-0" @change="saveSettings" />
        </label>
        <label class="flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/20 lg:col-span-3">
          <span>
            <span class="block font-black">แจ้งเตือนผู้เล่นที่รอนาน</span>
            <span class="mt-1 block text-sm font-semibold text-stone-500 dark:text-stone-400">แจ้งเมื่อผู้เล่นที่เปิดคูปองยังไม่ได้เล่นครบ 20 นาที และแจ้งซ้ำทุก 10 นาที</span>
          </span>
          <input v-model="state.settings.idleWaitAlertEnabled" type="checkbox" class="h-5 w-5 shrink-0" @change="saveSettings" />
        </label>
        <label class="flex items-center justify-between gap-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
          <span>
            <span class="block font-black">หน้าเมนูสมาชิก</span>
            <span class="mt-1 block text-sm font-semibold text-stone-500 dark:text-stone-400">แสดงจำนวนนาทีต่อหลังชื่อผู้เล่น</span>
          </span>
          <input v-model="state.settings.showWaitTimePlayers" type="checkbox" class="h-5 w-5 shrink-0" @change="saveSettings" />
        </label>
        <label class="flex items-center justify-between gap-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
          <span>
            <span class="block font-black">หน้าเมนูจัดคู่</span>
            <span class="mt-1 block text-sm font-semibold text-stone-500 dark:text-stone-400">แสดงจำนวนนาทีต่อหลังชื่อผู้เล่น</span>
          </span>
          <input v-model="state.settings.showWaitTimePairing" type="checkbox" class="h-5 w-5 shrink-0" @change="saveSettings" />
        </label>
        <label class="flex items-center justify-between gap-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
          <span>
            <span class="block font-black">หน้าเมนูรอคิว</span>
            <span class="mt-1 block text-sm font-semibold text-stone-500 dark:text-stone-400">แสดงจำนวนนาทีต่อหลังชื่อผู้เล่น</span>
          </span>
          <input v-model="state.settings.showWaitTimeQueue" type="checkbox" class="h-5 w-5 shrink-0" @change="saveSettings" />
        </label>
        <div class="rounded-lg border border-court-200 bg-court-500/10 p-4 text-sm font-semibold text-court-800 dark:border-court-900 dark:text-court-200 lg:col-span-3">
          เวลาเริ่มนับเมื่อเพิ่มผู้เล่นหรือจบการแข่งขัน และหยุดนับทันทีเมื่อกดเริ่มเกม ผู้เล่นแต่ละคนมีเวลาแยกกัน
        </div>
      </div>

      <div v-else-if="activeSettingsTab === 'libero'" class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section class="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
          <h2 class="font-black">เพิ่มริโบโร่</h2>
          <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">เลือกจากผู้เล่นที่อยู่ใน Session นี้ ริโบโร่ที่กำลังแข่งสามารถถูกจัดทีมและ Random สำหรับเกมถัดไปได้</p>
          <div class="relative mt-4">
            <input
              v-model="liberoSearch"
              type="search"
              role="combobox"
              aria-label="ค้นหาและเพิ่มริโบโร่"
              :aria-expanded="liberoComboboxOpen"
              aria-controls="libero-player-options"
              autocomplete="off"
              class="h-11 w-full rounded-md border border-stone-200 bg-paper-50 px-3 pr-10 font-semibold outline-none focus:border-court-500 focus:ring-2 focus:ring-court-500/20 dark:border-stone-700 dark:bg-stone-800"
              placeholder="ค้นหาชื่อหรือเลขผู้เล่น"
              :disabled="Boolean(liberoSavingId)"
              @focus="liberoComboboxOpen = true"
              @input="liberoComboboxOpen = true"
              @blur="closeLiberoCombobox"
              @keydown.escape="liberoComboboxOpen = false"
            />
            <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black text-stone-400">⌄</span>
            <div
              v-if="liberoComboboxOpen"
              id="libero-player-options"
              role="listbox"
              class="absolute inset-x-0 top-[calc(100%+0.35rem)] z-20 max-h-64 overflow-y-auto rounded-md border border-stone-200 bg-white p-1 shadow-xl dark:border-stone-700 dark:bg-stone-900"
            >
              <button
                v-for="player in availableLiberoPlayers"
                :key="player.id"
                type="button"
                role="option"
                class="flex w-full items-center justify-between gap-3 rounded px-3 py-2.5 text-left hover:bg-court-50 dark:hover:bg-court-950/30"
                @mousedown.prevent="selectLiberoPlayer(player)"
              >
                <span class="min-w-0 truncate font-black">#{{ player.id }} {{ player.name }}</span>
                <span class="shrink-0 text-xs font-semibold text-stone-500">{{ player.games || 0 }} เกม</span>
              </button>
              <p v-if="!availableLiberoPlayers.length" class="px-3 py-4 text-center text-sm font-semibold text-stone-500">ไม่พบผู้เล่นที่เพิ่มได้</p>
            </div>
          </div>
        </section>

        <section class="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
          <h2 class="font-black">รายชื่อริโบโร่ {{ liberoPlayers.length }} คน</h2>
          <div v-if="liberoPlayers.length" class="mt-4 overflow-hidden rounded-lg border border-stone-200 dark:border-stone-700">
            <div class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 bg-paper-100 px-3 py-2 text-xs font-black text-stone-500 dark:bg-stone-800 dark:text-stone-400">
              <span>ผู้เล่น</span><span>เล่นแล้ว</span><span class="w-9 text-center">จัดการ</span>
            </div>
            <div class="divide-y divide-stone-200 dark:divide-stone-700">
              <article v-for="player in liberoPlayers" :key="player.id" class="grid min-h-14 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2">
                <div class="min-w-0">
                  <p class="truncate font-black">{{ player.name }}</p>
                  <p class="text-xs font-semibold text-stone-500">#{{ player.id }} · ริโบโร่</p>
                </div>
                <span class="whitespace-nowrap rounded-md bg-court-50 px-2.5 py-1 text-sm font-black text-court-800 dark:bg-court-950/30 dark:text-court-200">{{ player.games || 0 }} ตา</span>
                <button type="button" class="grid h-9 w-9 place-items-center rounded-md border border-stone-200 text-stone-500 hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:border-stone-700 dark:hover:bg-red-950/30" :disabled="liberoSavingId === player.id" :aria-label="`นำ ${player.name} ออกจากริโบโร่`" @click="setLibero(player.id, false)"><X class="h-4 w-4" /></button>
              </article>
            </div>
          </div>
          <p v-else class="mt-4 rounded-md bg-paper-100 p-4 text-sm font-semibold text-stone-500 dark:bg-stone-800">ยังไม่มีรายชื่อริโบโร่</p>
          <p class="mt-4 rounded-md bg-amber-50 p-3 text-xs font-semibold text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">ริโบโร่จัดเข้าคิวล่วงหน้าได้ แต่ระบบจะบล็อกการเริ่มเกมใหม่จนกว่าเกมเดิมจะจบ</p>
        </section>
      </div>

      <div v-else-if="activeSettingsTab === 'match'" class="grid gap-4 lg:grid-cols-2">
        <label class="flex items-center justify-between gap-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
          <span class="font-bold">จับคู่ข้ามระดับมือ</span>
          <input v-model="state.settings.allowCrossLevel" type="checkbox" class="h-5 w-5" @change="saveSettings" />
        </label>

        <label class="grid gap-2 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
          <span class="font-bold">ลำดับการสุ่ม</span>
          <select v-model="state.settings.randomPriority" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" @change="saveSettings">
            <option value="level">ระดับมือก่อน</option>
            <option value="games">เกมน้อยก่อน</option>
          </select>
          <span class="text-sm text-stone-500 dark:text-stone-400">ระดับมือก่อนจะจัดกลุ่มตามระดับเป็นหลัก ส่วนเกมน้อยก่อนจะเลือกกลุ่มที่จำนวนเกมรวมน้อยกว่า</span>
        </label>

        <label class="grid gap-3 rounded-lg border border-court-200 bg-white p-4 shadow-soft dark:border-court-900 dark:bg-stone-900 lg:col-span-2">
          <span>
            <span class="block font-black">คำอ่านตอนเรียกคิว</span>
            <span class="mt-1 block text-sm font-semibold text-stone-500 dark:text-stone-400">ใช้ตัวแปร {court}, {pause}, {a}, {b}, {c}, {d}</span>
          </span>
          <textarea
            v-model="state.settings.announcementTemplate"
            rows="5"
            class="min-h-32 rounded-md border border-stone-200 bg-paper-50 px-3 py-2 dark:border-stone-700 dark:bg-stone-800"
            placeholder="บุฟเฟ่ต์สนามที่ {court}&#10;{pause}&#10;คุณ{a} คุณ{b} คุณ{c} คุณ{d}"
            @change="saveSettings"
          />
        </label>

        <div class="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900 lg:col-span-2">
          <h2 class="font-black">ระดับมือ</h2>
          <p class="text-sm text-stone-500 dark:text-stone-400">default: เบา, กลาง, หนัก</p>

          <div class="mt-4 space-y-2">
            <div v-for="(level, index) in state.settings.levels" :key="level" class="grid grid-cols-[1fr_auto] gap-2">
              <input v-model="state.settings.levels[index]" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" @change="saveSettings" />
              <button
                class="grid h-10 w-10 place-items-center rounded-md border border-stone-200 dark:border-stone-700"
                :class="usedLevelSet.has(level) ? 'opacity-40' : ''"
                :disabled="usedLevelSet.has(level)"
                :title="usedLevelSet.has(level) ? 'ระดับมือนี้ถูกใช้งานแล้ว' : 'ลบระดับมือ'"
                @click="removeLevel(index)"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
          </div>

          <div class="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <input v-model="forms.newLevelName" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" placeholder="ระดับมือใหม่" @keyup.enter="addLevel" />
            <button class="inline-flex h-10 items-center gap-2 rounded-md bg-court-500 px-4 font-bold text-white" @click="addLevel">
              <Plus class="h-4 w-4" />
              เพิ่ม
            </button>
          </div>
        </div>
      </div>
    </fieldset>
  </section>
</template>
