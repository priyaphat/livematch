<script setup>
import { Plus, X } from '@lucide/vue'

defineProps([
  'state',
  'forms',
  'addCourt',
  'removeCourt',
  'addLevel',
  'removeLevel',
  'saveSettings'
])
</script>

<template>
  <section class="grid gap-4 lg:grid-cols-2">
    <div class="grid gap-4">
      <label class="grid gap-2 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
        <span class="font-bold">ค่าเข้าสนามต่อคน</span>
        <input v-model.number="state.settings.entryFee" type="number" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" @change="saveSettings" />
      </label>

      <label class="grid gap-2 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
        <span class="font-bold">ค่าลูกแบด</span>
        <input v-model.number="state.settings.shuttleFee" type="number" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" @change="saveSettings" />
      </label>

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
        <span class="text-sm text-stone-500 dark:text-stone-400">
          ระดับมือก่อนจะจัดกลุ่มตามระดับเป็นหลัก ส่วนเกมน้อยก่อนจะเลือกกลุ่มที่จำนวนเกมรวมน้อยกว่า
        </span>
      </label>
    </div>

    <div class="grid gap-4">
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
            <button class="grid h-10 w-10 place-items-center rounded-md border border-stone-200 dark:border-stone-700" @click="removeCourt(index)">
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

      <div class="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
        <h2 class="font-black">ระดับมือ</h2>
        <p class="text-sm text-stone-500 dark:text-stone-400">default: light, middle, heavy</p>

        <div class="mt-4 space-y-2">
          <div v-for="(level, index) in state.settings.levels" :key="level" class="grid grid-cols-[1fr_auto] gap-2">
            <input v-model="state.settings.levels[index]" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" @change="saveSettings" />
            <button class="grid h-10 w-10 place-items-center rounded-md border border-stone-200 dark:border-stone-700" @click="removeLevel(index)">
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
  </section>
</template>
