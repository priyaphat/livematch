<script setup>
import { Plus, X } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

const props = defineProps([
  'state',
  'forms',
  'addCourt',
  'removeCourt',
  'addLevel',
  'removeLevel',
  'addShuttleBrand',
  'usedCourtNames',
  'usedLevels',
  'saveSettings',
  'isSessionReadOnly'
])

const activeSettingsTab = ref('general')
const isLiveShare = computed(() => props.state.session?.type === 'liveShare')
const usedCourtSet = computed(() => props.usedCourtNames || new Set())
const usedLevelSet = computed(() => props.usedLevels || new Set())

const settingsTabs = computed(() => [
  { id: 'general', label: 'ทั่วไป', hint: 'ชื่อ session และ workflow' },
  { id: 'costs', label: 'ค่าใช้จ่าย', hint: 'ค่าสนามและลูกแบด' },
  { id: 'courts', label: 'สนาม', hint: 'ชื่อสนามทั้งหมด' },
  ...(!isLiveShare.value ? [{ id: 'match', label: 'จัดคู่ / เสียง', hint: 'ระดับมือ การสุ่ม และคำอ่าน' }] : [])
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

        <label v-if="!isLiveShare" class="flex items-center justify-between gap-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
          <span class="font-bold">จับคู่ข้ามระดับมือ</span>
          <input v-model="state.settings.allowCrossLevel" type="checkbox" class="h-5 w-5" @change="saveSettings" />
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

        <label v-if="!isLiveShare" class="grid gap-3 rounded-lg border border-court-200 bg-white p-4 shadow-soft dark:border-court-900 dark:bg-stone-900 lg:col-span-2">
          <span>
            <span class="block font-black">คำอ่านตอนเรียกคิว</span>
            <span class="mt-1 block text-sm font-semibold text-stone-500 dark:text-stone-400">ใช้ตัวแปร {court}, {pause}, {a}, {b}, {c}, {d}</span>
          </span>
          <textarea
            v-model="state.settings.announcementTemplate"
            rows="4"
            class="min-h-28 rounded-md border border-stone-200 bg-paper-50 px-3 py-2 dark:border-stone-700 dark:bg-stone-800"
            placeholder="บุฟเฟ่ต์สนามที่ {court}&#10;{pause}&#10;คุณ{a} คุณ{b} คุณ{c} คุณ{d}"
            @change="saveSettings"
          />
        </label>
      </div>

      <div v-else-if="activeSettingsTab === 'costs'" class="grid gap-4 lg:grid-cols-2">
        <label class="grid gap-2 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
          <span class="font-bold">{{ isLiveShare ? 'ค่าสนามต่อชั่วโมง' : 'ค่าเข้าสนามต่อคนทั่วไป' }}</span>
          <input v-if="isLiveShare" v-model.number="state.settings.courtFeePerHour" type="number" min="0" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" @change="saveSettings" />
          <input v-else v-model.number="state.settings.entryFee" type="number" min="0" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" @change="saveSettings" />
        </label>

        <label v-if="!isLiveShare" class="grid gap-2 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
          <span class="font-bold">ค่าเข้าสนามสมาชิกชมรม</span>
          <input v-model.number="state.settings.clubEntryFee" type="number" min="0" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" @change="saveSettings" />
        </label>

        <div class="grid gap-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900 lg:col-span-2">
          <div>
            <h2 class="font-black">ยี่ห้อลูกแบด</h2>
            <p class="text-sm text-stone-500 dark:text-stone-400">ตั้งราคาแต่ละยี่ห้อ และปิดใช้งานยี่ห้อที่ไม่อยากให้เลือกต่อได้</p>
          </div>
          <div class="grid gap-2">
            <div v-for="brand in state.settings.shuttleBrands" :key="brand.id" class="grid gap-2 rounded-md border border-stone-200 p-3 dark:border-stone-700 sm:grid-cols-[1fr_7rem_auto]">
              <input v-model.trim="brand.name" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" @change="saveSettings" />
              <input v-model.number="brand.price" type="number" min="0" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" @change="saveSettings" />
              <label class="flex h-10 items-center gap-2 text-sm font-bold">
                <input v-model="brand.active" type="checkbox" @change="saveSettings" />
                ใช้งาน
              </label>
            </div>
          </div>
          <div class="grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
            <input v-model="forms.newShuttleBrandName" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" placeholder="ยี่ห้อลูกแบดใหม่" @keyup.enter="addShuttleBrand" />
            <input v-model.number="forms.newShuttleBrandPrice" type="number" min="0" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" placeholder="ราคา" @keyup.enter="addShuttleBrand" />
            <button class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-shuttle-400 px-4 font-bold text-stone-950" @click="addShuttleBrand">
              <Plus class="h-4 w-4" />
              เพิ่ม
            </button>
          </div>
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
