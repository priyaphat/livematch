<script setup>
import { Check, Plus, RotateCcw, X } from '@lucide/vue'
import LineArt from '../components/LineArt.vue'

const props = defineProps([
  'state',
  'forms',
  'ui',
  'playerName',
  'requestAddShuttle',
  'confirmAddShuttle',
  'latestShuttleNumber',
  'latestShuttleBrandId',
  'activeShuttleBrands',
  'shuttleBrandName',
  'matchShuttleSummary',
  'matchShuttleSequenceText',
  'requestReturnShuttle',
  'confirmReturnShuttle',
  'requestFinishMatch',
  'confirmFinishMatch',
  'requestCancelMatch',
  'confirmCancelMatch',
  'isSessionReadOnly'
])

const activeBrands = () => props.activeShuttleBrands?.() || props.state.settings?.shuttleBrands?.filter((brand) => brand.active) || []
const brandName = (brandId) => props.shuttleBrandName?.(brandId) || props.state.settings?.shuttleBrands?.find((brand) => brand.id === brandId)?.name || 'ลูกแบดทั่วไป'
const shuttleSummary = (match) => props.matchShuttleSummary?.(match) || ''
const shuttleSequenceText = (match) => props.matchShuttleSequenceText?.(match) || match?.shuttleSequence || '-'
const latestBrandId = (match) => props.latestShuttleBrandId?.(match) || match?.shuttleSequenceItems?.at?.(-1)?.brandId || 'default'
if (props.forms.addShuttleBrandId === undefined) props.forms.addShuttleBrandId = ''
</script>

<template>
  <section class="grid gap-3">
    <div v-if="!state.live.length" class="lm-empty">
      <LineArt name="scoreboard" tone="mint" class="mx-auto mb-4 max-w-sm" />
      <p class="font-black">ยังไม่มีเกมที่กำลังแข่ง</p>
      <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">เริ่มเกมจากหน้ารอคิว แล้วเกมจะมาแสดงที่นี่</p>
    </div>
    <article v-for="match in state.live" :key="match.id" class="rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-sm text-stone-500">เกมที่ {{ match.id }} · {{ match.court }} · {{ match.status }}</p>
          <h2 class="mt-1 text-xl font-black">{{ playerName(match.a1) }} + {{ playerName(match.a2) }} vs {{ playerName(match.b1) }} + {{ playerName(match.b2) }}</h2>
        </div>
        <span class="rounded-md bg-shuttle-400 px-3 py-1 text-sm font-bold text-stone-900">ลูกแบด {{ match.shuttles }}<span v-if="shuttleSummary(match)"> · {{ shuttleSummary(match) }}</span></span>
      </div>
      <details v-if="match.shuttles" class="mt-3 rounded-md bg-paper-100 p-3 text-sm dark:bg-stone-800">
        <summary class="cursor-pointer font-bold">ดู sequence ลูกแบด</summary>
        <p class="mt-2 text-stone-600 dark:text-stone-300">{{ shuttleSequenceText(match) }}</p>
      </details>

      <div class="mt-4 flex flex-wrap gap-2">
        <button class="inline-flex h-10 items-center gap-2 rounded-md border border-stone-200 px-3 font-semibold disabled:cursor-not-allowed disabled:opacity-45 dark:border-stone-700" :disabled="isSessionReadOnly" @click="requestAddShuttle(match)">
          <Plus class="h-4 w-4" />
          เพิ่มลูก
        </button>
        <button v-if="match.shuttles > 1" class="inline-flex h-10 items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 font-semibold text-amber-800 disabled:cursor-not-allowed disabled:opacity-45 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300" :disabled="isSessionReadOnly" @click="requestReturnShuttle(match)">
          <RotateCcw class="h-4 w-4" />
          คืนลูก
        </button>
        <button class="inline-flex h-10 items-center gap-2 rounded-md bg-court-500 px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45" :disabled="isSessionReadOnly" @click="requestFinishMatch(match)">
          <Check class="h-4 w-4" />
          จบ
        </button>
        <button class="inline-flex h-10 items-center gap-2 rounded-md bg-red-600 px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45" :disabled="isSessionReadOnly" @click="requestCancelMatch(match)">
          <X class="h-4 w-4" />
          ยกเลิก
        </button>
      </div>
    </article>

    <div v-if="ui.showShuttleModal" class="fixed inset-0 z-40 grid place-items-end bg-black/40 p-3 sm:place-items-center">
      <div class="w-full max-w-md rounded-lg bg-white p-4 shadow-soft dark:bg-stone-900">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-black">ยืนยันเพิ่มลูกแบด</h2>
            <p class="mt-1 text-sm text-stone-500 dark:text-stone-400">เกมที่ {{ ui.shuttleMatch?.id }} จะได้รับเลขลูกแบดถัดไป</p>
          </div>
          <button class="grid h-9 w-9 place-items-center rounded-md border border-stone-200 dark:border-stone-700" aria-label="ปิด modal" @click="ui.showShuttleModal = false">
            <X class="h-4 w-4" />
          </button>
        </div>

        <label v-if="activeBrands().length > 1" class="mt-4 grid gap-2 text-sm font-bold">
          ยี่ห้อลูกแบด
          <select v-model="forms.addShuttleBrandId" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800">
            <option v-for="brand in activeBrands()" :key="brand.id" :value="brand.id">{{ brand.name }}</option>
          </select>
        </label>

        <div class="mt-4 grid grid-cols-2 gap-2">
          <button class="h-11 rounded-md border border-stone-200 font-bold dark:border-stone-700" @click="ui.showShuttleModal = false">กลับ</button>
          <button class="h-11 rounded-md bg-shuttle-400 font-bold text-stone-950 disabled:cursor-not-allowed disabled:opacity-45" :disabled="isSessionReadOnly" @click="confirmAddShuttle">เพิ่มลูกแบด</button>
        </div>
      </div>
    </div>

    <div v-if="ui.showReturnShuttleModal" class="fixed inset-0 z-40 grid place-items-end bg-black/40 p-3 sm:place-items-center">
      <div class="w-full max-w-md rounded-lg bg-white p-4 shadow-soft dark:bg-stone-900">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-black">ยืนยันคืนลูกแบด</h2>
            <p class="mt-1 text-sm text-stone-500 dark:text-stone-400">คืนลูกหมายเลข {{ latestShuttleNumber(ui.returnShuttleMatch) }} · {{ brandName(latestBrandId(ui.returnShuttleMatch)) }} #{{ latestShuttleNumber(ui.returnShuttleMatch) }} แล้วนำกลับไปใช้ในเกมถัดไป</p>
          </div>
          <button class="grid h-9 w-9 place-items-center rounded-md border border-stone-200 dark:border-stone-700" aria-label="ปิด modal คืนลูก" @click="ui.showReturnShuttleModal = false">
            <X class="h-4 w-4" />
          </button>
        </div>
        <div class="mt-4 rounded-md bg-amber-50 p-3 text-sm font-semibold text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          เกมนี้จะเหลือลูกแบด {{ Math.max(1, Number(ui.returnShuttleMatch?.shuttles || 1) - 1) }} ลูก
        </div>
        <div class="mt-4 grid grid-cols-2 gap-2">
          <button class="h-11 rounded-md border border-stone-200 font-bold dark:border-stone-700" @click="ui.showReturnShuttleModal = false">กลับ</button>
          <button class="h-11 rounded-md bg-amber-500 font-bold text-stone-950 disabled:cursor-not-allowed disabled:opacity-45" :disabled="isSessionReadOnly" @click="confirmReturnShuttle">ยืนยันคืนลูก</button>
        </div>
      </div>
    </div>

    <div v-if="ui.showFinishModal" class="fixed inset-0 z-40 grid place-items-end bg-black/40 p-3 sm:place-items-center">
      <div class="w-full max-w-md rounded-lg bg-white p-4 shadow-soft dark:bg-stone-900">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-black">จบการแข่งขัน</h2>
            <p class="mt-1 text-sm text-stone-500 dark:text-stone-400">เลือกผลการแข่งขันสำหรับเกมที่ {{ ui.finishMatch?.id }}</p>
          </div>
          <button class="grid h-9 w-9 place-items-center rounded-md border border-stone-200 dark:border-stone-700" aria-label="ปิด modal" @click="ui.showFinishModal = false">
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="mt-4 grid gap-2">
          <label class="flex items-center gap-3 rounded-md border border-stone-200 p-3 dark:border-stone-700">
            <input v-model="forms.finishWinner" type="radio" value="" :disabled="isSessionReadOnly" />
            <span class="font-bold">ไม่ระบุ</span>
          </label>
          <label class="flex items-center gap-3 rounded-md border border-stone-200 p-3 dark:border-stone-700">
            <input v-model="forms.finishWinner" type="radio" value="draw" :disabled="isSessionReadOnly" />
            <span class="font-bold">เสมอ</span>
          </label>
          <label class="flex items-center gap-3 rounded-md border border-stone-200 p-3 dark:border-stone-700">
            <input v-model="forms.finishWinner" type="radio" value="A" :disabled="isSessionReadOnly" />
            <span class="font-bold">{{ playerName(ui.finishMatch?.a1) }} + {{ playerName(ui.finishMatch?.a2) }}</span>
          </label>
          <label class="flex items-center gap-3 rounded-md border border-stone-200 p-3 dark:border-stone-700">
            <input v-model="forms.finishWinner" type="radio" value="B" :disabled="isSessionReadOnly" />
            <span class="font-bold">{{ playerName(ui.finishMatch?.b1) }} + {{ playerName(ui.finishMatch?.b2) }}</span>
          </label>
        </div>

        <textarea
          v-model="forms.finishNote"
          class="mt-4 min-h-24 w-full rounded-md border border-stone-200 bg-paper-50 p-3 outline-none focus:border-court-500 dark:border-stone-700 dark:bg-stone-800"
          placeholder="หมายเหตุหลังจบเกม"
          :disabled="isSessionReadOnly"
        />

        <div class="mt-4 grid grid-cols-2 gap-2">
          <button class="h-11 rounded-md border border-stone-200 font-bold dark:border-stone-700" @click="ui.showFinishModal = false">กลับ</button>
          <button class="h-11 rounded-md bg-court-500 font-bold text-white disabled:cursor-not-allowed disabled:opacity-45" :disabled="isSessionReadOnly" @click="confirmFinishMatch">บันทึกผล</button>
        </div>
      </div>
    </div>

    <div v-if="ui.showCancelModal" class="fixed inset-0 z-40 grid place-items-end bg-black/40 p-3 sm:place-items-center">
      <div class="w-full max-w-md rounded-lg bg-white p-4 shadow-soft dark:bg-stone-900">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-black">ยกเลิกการแข่งขัน</h2>
            <p class="mt-1 text-sm text-stone-500 dark:text-stone-400">บันทึกหมายเหตุสำหรับเกมที่ {{ ui.cancelMatch?.id }}</p>
          </div>
          <button class="grid h-9 w-9 place-items-center rounded-md border border-stone-200 dark:border-stone-700" aria-label="ปิด modal" @click="ui.showCancelModal = false">
            <X class="h-4 w-4" />
          </button>
        </div>

        <textarea
          v-model="forms.cancelNote"
          class="mt-4 min-h-28 w-full rounded-md border border-stone-200 bg-paper-50 p-3 outline-none focus:border-court-500 dark:border-stone-700 dark:bg-stone-800"
          placeholder="เช่น ผู้เล่นเจ็บ / สนามไม่ว่าง / ยกเลิกตามคำขอ"
          :disabled="isSessionReadOnly"
        />

        <label
          v-if="ui.cancelMatch?.shuttles > 0 && ui.cancelMatch?.shuttleSequence"
          class="mt-3 flex items-start gap-3 rounded-md border border-shuttle-400/60 bg-shuttle-400/10 p-3"
        >
          <input
            v-model="forms.cancelShuttleReturned"
            class="mt-1 h-4 w-4"
            type="checkbox"
            :disabled="isSessionReadOnly"
          />
          <span>
            <span class="block font-bold">คืนลูกแบด</span>
            <span class="text-xs text-stone-500 dark:text-stone-400">
              คืนลูกหมายเลข {{ ui.cancelMatch.shuttleSequence }} เพื่อนำกลับมาใช้ในเกมถัดไป
            </span>
          </span>
        </label>

        <div class="mt-4 grid grid-cols-2 gap-2">
          <button class="h-11 rounded-md border border-stone-200 font-bold dark:border-stone-700" @click="ui.showCancelModal = false">กลับ</button>
          <button class="h-11 rounded-md bg-red-600 font-bold text-white disabled:cursor-not-allowed disabled:opacity-45" :disabled="isSessionReadOnly" @click="confirmCancelMatch">บันทึกยกเลิก</button>
        </div>
      </div>
    </div>
  </section>
</template>
