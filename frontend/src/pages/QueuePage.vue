<script setup>
import { ref } from 'vue'
import { CheckCircle2, Clock3, Play, QrCode, Volume2, X, XCircle } from '@lucide/vue'
import LineArt from '../components/LineArt.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps([
  'state',
  'forms',
  'matchLevelLabel',
  'openQueueQr',
  'startMatch',
  'announceQueuedMatch',
  'cancelQueuedMatch',
  'playerName',
  'availableCourtNames',
  'activeShuttleBrands',
  'isSessionReadOnly'
])

const activeBrands = () => props.activeShuttleBrands?.() || props.state.settings?.shuttleBrands?.filter((brand) => brand.active) || []
if (!props.forms.matchShuttleBrands) props.forms.matchShuttleBrands = {}

const startMatchSelection = ref(null)
const startMatchBrandId = ref('')

function requestStartMatch(match) {
  if (props.isSessionReadOnly) return
  const court = props.forms.matchCourts[match.id]
  if (!court) return
  const brands = activeBrands()
  if (brands.length <= 1) {
    props.forms.matchShuttleBrands[match.id] = brands[0]?.id || ''
    props.startMatch(match, court)
    return
  }
  startMatchSelection.value = match
  startMatchBrandId.value = props.forms.matchShuttleBrands[match.id] || ''
}

function closeStartMatchModal() {
  startMatchSelection.value = null
  startMatchBrandId.value = ''
}

function confirmStartMatch() {
  const match = startMatchSelection.value
  if (!match || !startMatchBrandId.value) return
  const court = props.forms.matchCourts[match.id]
  if (!court) return
  props.forms.matchShuttleBrands[match.id] = startMatchBrandId.value
  closeStartMatchModal()
  props.startMatch(match, court)
}
</script>

<template>
  <section class="grid gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
      <div class="flex items-center gap-3">
        <span class="grid h-11 w-11 place-items-center rounded-md bg-court-500/10 text-court-700 dark:text-court-300">
          <Clock3 class="h-5 w-5" />
        </span>
        <div>
          <h1 class="text-xl font-black">รอคิว</h1>
          <p class="text-sm font-semibold text-stone-500 dark:text-stone-400">เกมที่ยืนยันแล้ว รอเลือกสนามและเริ่มการแข่งขัน</p>
        </div>
      </div>
      <div class="grid w-full gap-2 sm:w-auto">
        <button class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-court-500 px-4 text-sm font-bold text-white" @click="openQueueQr">
          <QrCode class="h-4 w-4" />
          QR แสดงคิว
        </button>
      </div>
    </div>

    <div v-if="!state.queue.length" class="lm-empty">
      <LineArt name="queue" tone="sky" class="mx-auto mb-4 max-w-sm" />
      <p class="font-black">ยังไม่มีเกมรอคิว</p>
      <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">ยืนยันคู่จากหน้าจัดคู่ก่อน แล้วเกมจะมาแสดงที่นี่</p>
    </div>

    <div class="grid gap-3">
      <article v-for="match in state.queue" :key="match.id" class="relative rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
        <div class="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
          <div>
            <p class="text-sm text-stone-500">เกมที่ {{ match.id }} · ระดับ {{ matchLevelLabel(match) }}</p>
            <h2 class="mt-1 text-xl font-black">{{ playerName(match.a1) }} + {{ playerName(match.a2) }} vs {{ playerName(match.b1) }} + {{ playerName(match.b2) }}</h2>
          </div>
          <div class="grid gap-2 sm:min-w-96 sm:grid-cols-[1fr_auto_auto_auto]">
            <select v-model="forms.matchCourts[match.id]" class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" :disabled="isSessionReadOnly">
              <option disabled value="">{{ availableCourtNames.length ? 'เลือกสนาม' : 'สนามเต็ม' }}</option>
              <option v-for="court in availableCourtNames" :key="court" :value="court">{{ court }}</option>
            </select>
            <button
              v-if="forms.matchCourts[match.id]"
              class="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-court-200 bg-court-500/10 px-3 text-sm font-bold text-court-700 dark:border-court-900 dark:text-court-300"
              type="button"
              @click="announceQueuedMatch(match, forms.matchCourts[match.id])"
            >
              <Volume2 class="h-4 w-4" />
              อ่านออกเสียง
            </button>
            <button
              class="inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 font-bold text-white transition disabled:cursor-not-allowed"
              :class="forms.matchCourts[match.id] ? 'bg-court-500' : 'bg-stone-400'"
              :disabled="isSessionReadOnly || !forms.matchCourts[match.id]"
              @click="requestStartMatch(match)"
            >
              <Play class="h-4 w-4" />
              เริ่ม
            </button>
            <button
              class="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 text-sm font-bold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300 dark:hover:bg-rose-950/30"
              aria-label="ยกเลิกคิวเกม"
              title="ยกเลิกคิวเกม"
              :disabled="isSessionReadOnly"
              @click="cancelQueuedMatch(match)"
            >
              <XCircle class="h-4 w-4" />
              ยกเลิกคิว
            </button>
          </div>
          <p v-if="!forms.matchCourts[match.id]" class="text-xs font-semibold text-amber-700 dark:text-shuttle-400 sm:col-span-2">
            ต้องเลือกสนามก่อนเริ่มการแข่งขัน
          </p>
        </div>
      </article>
    </div>
  </section>

  <div
    v-if="startMatchSelection"
    class="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 sm:place-items-center"
    role="dialog"
    aria-modal="true"
    aria-label="เลือกยี่ห้อลูกแบด"
    @click.self="closeStartMatchModal"
  >
    <section class="w-full max-w-lg overflow-hidden rounded-lg border border-stone-200 bg-white shadow-soft dark:border-stone-700 dark:bg-stone-900">
      <header class="flex items-start justify-between gap-3 border-b border-stone-200 p-4 dark:border-stone-700">
        <div>
          <p class="text-sm font-black text-court-700 dark:text-court-300">เริ่มเกมที่ {{ forms.matchCourts[startMatchSelection.id] }}</p>
          <h2 class="mt-1 text-xl font-black">เลือกลูกแบดลูกแรก</h2>
          <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">เกมที่ {{ startMatchSelection.id }} · เลือกยี่ห้อก่อนเริ่มการแข่งขัน</p>
        </div>
        <button class="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-stone-200 dark:border-stone-700" aria-label="ปิด modal" @click="closeStartMatchModal">
          <X class="h-4 w-4" />
        </button>
      </header>

      <div class="grid max-h-[55vh] gap-2 overflow-y-auto p-4 sm:grid-cols-2">
        <button
          v-for="brand in activeBrands()"
          :key="brand.id"
          type="button"
          class="flex min-h-16 items-center justify-between gap-3 rounded-lg border p-3 text-left transition"
          :class="startMatchBrandId === brand.id ? 'border-court-500 bg-court-500/10 ring-2 ring-court-500/15' : 'border-stone-200 bg-paper-50 hover:border-court-300 dark:border-stone-700 dark:bg-stone-800'"
          @click="startMatchBrandId = brand.id"
        >
          <span>
            <span class="block font-black">{{ brand.name }}</span>
            <span class="mt-0.5 block text-xs font-semibold text-stone-500 dark:text-stone-400">{{ Number(brand.price || 0).toLocaleString('th-TH') }} บาท / ลูก</span>
          </span>
          <CheckCircle2 v-if="startMatchBrandId === brand.id" class="h-5 w-5 shrink-0 text-court-600 dark:text-court-300" />
        </button>
      </div>

      <footer class="grid grid-cols-2 gap-2 border-t border-stone-200 p-3 dark:border-stone-700 sm:p-4">
        <button class="h-11 rounded-md border border-stone-200 px-4 font-black dark:border-stone-700" @click="closeStartMatchModal">ยกเลิก</button>
        <button class="inline-flex h-11 items-center justify-center gap-2 rounded-md px-4 font-black text-white disabled:cursor-not-allowed disabled:bg-stone-400" :class="startMatchBrandId ? 'bg-court-500' : 'bg-stone-400'" :disabled="!startMatchBrandId" @click="confirmStartMatch">
          <Play class="h-4 w-4" />
          เริ่มเกม
        </button>
      </footer>
    </section>
  </div>
</template>
