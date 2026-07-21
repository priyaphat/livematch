<script setup>
import { computed, reactive, ref } from 'vue'
import { Check, Users, X } from '@lucide/vue'

const props = defineProps({
  state: { type: Object, required: true },
  players: { type: Array, default: () => [] },
  createManualMatch: { type: Function, required: true },
  isSessionReadOnly: { type: Boolean, default: false }
})

const emit = defineEmits(['close'])
const selected = reactive({ a1: '', a2: '', b1: '', b2: '' })
const level = ref(props.state.settings.levels?.[0] || '')
const submitting = ref(false)
const error = ref('')
const slots = ['a1', 'a2', 'b1', 'b2']

const selectedIds = computed(() => slots.map((slot) => Number(selected[slot])).filter(Boolean))
const canSubmit = computed(() => selectedIds.value.length === 4 && new Set(selectedIds.value).size === 4 && Boolean(level.value) && !props.isSessionReadOnly && !submitting.value)

function optionsFor(slot) {
  const current = Number(selected[slot])
  const usedElsewhere = new Set(slots.filter((item) => item !== slot).map((item) => Number(selected[item])).filter(Boolean))
  return props.players.filter((player) => player.id === current || !usedElsewhere.has(player.id))
}

function optionLabel(player) {
  return `#${player.id} ${player.name} · ${player.level || '-'} · ${player.games || 0} เกม`
}

async function submit() {
  if (!canSubmit.value) return
  error.value = ''
  submitting.value = true
  try {
    await props.createManualMatch({
      a1: Number(selected.a1),
      a2: Number(selected.a2),
      b1: Number(selected.b1),
      b2: Number(selected.b2),
      level: level.value
    })
    emit('close')
  } catch (submitError) {
    error.value = submitError?.message || 'สร้างทีมไม่สำเร็จ'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 sm:place-items-center" @click.self="emit('close')">
    <section class="w-full max-w-2xl overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl dark:border-stone-700 dark:bg-stone-900">
      <header class="flex items-start justify-between gap-3 border-b border-stone-200 px-4 py-4 dark:border-stone-700 sm:px-5">
        <div>
          <div class="flex items-center gap-2 text-court-700 dark:text-court-300">
            <Users class="h-5 w-5" />
            <p class="text-sm font-black">จัดทีมด้วยตัวเอง</p>
          </div>
          <h2 class="mt-1 text-xl font-black">เลือกผู้เล่นทั้ง 4 คน</h2>
          <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">กำหนดตำแหน่ง A1, A2, B1 และ B2 แล้วกดยืนยัน</p>
        </div>
        <button class="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-stone-200 dark:border-stone-700" aria-label="ปิด" @click="emit('close')">
          <X class="h-4 w-4" />
        </button>
      </header>

      <form class="grid max-h-[72vh] gap-4 overflow-y-auto p-4 sm:p-5" @submit.prevent="submit">
        <div class="grid gap-3 sm:grid-cols-2">
          <fieldset class="grid gap-3 rounded-lg border border-court-200 bg-court-50/60 p-3 dark:border-court-900/60 dark:bg-court-950/20">
            <legend class="px-1 text-sm font-black text-court-700 dark:text-court-300">ทีม A</legend>
            <label v-for="slot in ['a1', 'a2']" :key="slot" class="grid gap-1.5 text-sm font-bold">
              <span>{{ slot.toUpperCase() }}</span>
              <select v-model="selected[slot]" class="h-11 w-full rounded-md border border-stone-300 bg-white px-3 font-semibold outline-none focus:border-court-500 focus:ring-2 focus:ring-court-500/20 dark:border-stone-700 dark:bg-stone-950">
                <option value="">เลือกผู้เล่น {{ slot.toUpperCase() }}</option>
                <option v-for="player in optionsFor(slot)" :key="player.id" :value="player.id">{{ optionLabel(player) }}</option>
              </select>
            </label>
          </fieldset>

          <fieldset class="grid gap-3 rounded-lg border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-900/60 dark:bg-sky-950/20">
            <legend class="px-1 text-sm font-black text-sky-700 dark:text-sky-300">ทีม B</legend>
            <label v-for="slot in ['b1', 'b2']" :key="slot" class="grid gap-1.5 text-sm font-bold">
              <span>{{ slot.toUpperCase() }}</span>
              <select v-model="selected[slot]" class="h-11 w-full rounded-md border border-stone-300 bg-white px-3 font-semibold outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-stone-700 dark:bg-stone-950">
                <option value="">เลือกผู้เล่น {{ slot.toUpperCase() }}</option>
                <option v-for="player in optionsFor(slot)" :key="player.id" :value="player.id">{{ optionLabel(player) }}</option>
              </select>
            </label>
          </fieldset>
        </div>

        <label class="grid gap-1.5 text-sm font-bold">
          <span>ระดับมือของเกม</span>
          <select v-model="level" class="h-11 rounded-md border border-stone-300 bg-white px-3 font-semibold outline-none focus:border-court-500 focus:ring-2 focus:ring-court-500/20 dark:border-stone-700 dark:bg-stone-950">
            <option v-for="item in state.settings.levels" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>

        <p class="rounded-md bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300">ผู้เล่นที่จ่ายแล้ว อยู่ในคิว หรือกำลังแข่งจะไม่แสดง · คู่ที่กำหนดไว้ต้องเลือกมาด้วยกันและอยู่ทีมเดียวกัน</p>
        <p v-if="players.length < 4" class="text-sm font-bold text-amber-700 dark:text-amber-300">มีผู้เล่นว่างไม่ครบ 4 คน</p>
        <p v-if="error" class="text-sm font-bold text-red-600 dark:text-red-400">{{ error }}</p>

        <footer class="grid grid-cols-2 gap-2 border-t border-stone-200 pt-4 dark:border-stone-700">
          <button type="button" class="h-11 rounded-md border border-stone-300 font-bold dark:border-stone-700" @click="emit('close')">กลับ</button>
          <button type="submit" class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-court-500 font-bold text-white disabled:cursor-not-allowed disabled:opacity-45" :disabled="!canSubmit">
            <Check class="h-4 w-4" />
            {{ submitting ? 'กำลังสร้าง...' : 'สร้างทีม' }}
          </button>
        </footer>
      </form>
    </section>
  </div>
</template>
