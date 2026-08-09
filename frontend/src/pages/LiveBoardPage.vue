<script setup>
import { computed } from 'vue'
import { Check, Plus, RotateCcw, X } from '@lucide/vue'
import LineArt from '../components/LineArt.vue'
import { emptyMatchScores, validateMatchScores } from '../matchScores.js'

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
const teamName = (match = {}, side) => (side === 'A' ? [match?.a1, match?.a2] : [match?.b1, match?.b2]).filter((id) => Number(id) > 0).map((id) => props.playerName(id)).join(' + ')
if (props.forms.addShuttleBrandId === undefined) props.forms.addShuttleBrandId = ''
if (!Array.isArray(props.forms.finishScores)) props.forms.finishScores = emptyMatchScores()
if (props.forms.finishScoreError === undefined) props.forms.finishScoreError = ''
const hasAnyFinishScore = computed(() => (props.forms.finishScores || []).some((score) => score.a !== '' || score.b !== ''))
const finishScoreResult = computed(() => validateMatchScores(props.forms.finishScores || []))
const finishResultText = computed(() => finishScoreResult.value.winner === 'A'
  ? `${teamName(props.ui.finishMatch, 'A')} ชนะ`
  : finishScoreResult.value.winner === 'B'
    ? `${teamName(props.ui.finishMatch, 'B')} ชนะ`
    : finishScoreResult.value.winner === 'draw' ? 'เสมอ' : '')
function addThirdSet() {
  if (props.forms.finishScores.length < 3) props.forms.finishScores.push({ a: '', b: '' })
  props.forms.finishScoreError = ''
}
function removeThirdSet() {
  if (props.forms.finishScores.length === 3) props.forms.finishScores.pop()
  props.forms.finishScoreError = ''
}
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
          <h2 class="mt-1 text-xl font-black">{{ teamName(match, 'A') }} vs {{ teamName(match, 'B') }}</h2>
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
      <div class="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-4 shadow-soft dark:bg-stone-900">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-black">จบการแข่งขัน</h2>
            <p class="mt-1 text-sm text-stone-500 dark:text-stone-400">กรอกคะแนน หรือเลือกผลเองสำหรับเกมที่ {{ ui.finishMatch?.id }}</p>
          </div>
          <button class="grid h-9 w-9 place-items-center rounded-md border border-stone-200 dark:border-stone-700" aria-label="ปิด modal" @click="ui.showFinishModal = false">
            <X class="h-4 w-4" />
          </button>
        </div>

        <section class="mt-4 rounded-lg border border-stone-200 p-3 dark:border-stone-700">
          <div class="grid grid-cols-[3rem_1fr_1fr] items-start gap-2 text-center text-xs font-black text-stone-500">
            <span class="pt-1">เซต</span>
            <div class="min-w-0"><span>ทีม A</span><small class="mt-0.5 block break-words text-[10px] font-semibold leading-tight text-stone-400">{{ teamName(ui.finishMatch, 'A') }}</small></div>
            <div class="min-w-0"><span>ทีม B</span><small class="mt-0.5 block break-words text-[10px] font-semibold leading-tight text-stone-400">{{ teamName(ui.finishMatch, 'B') }}</small></div>
          </div>
          <div v-for="(score, index) in forms.finishScores" :key="index" class="mt-2 grid grid-cols-[3rem_1fr_1fr] items-center gap-2">
            <span class="text-center text-sm font-black">{{ index + 1 }}</span>
            <input v-model="score.a" type="number" min="0" max="99" step="1" inputmode="numeric" :aria-label="`คะแนนทีม A เซต ${index + 1}`" class="h-12 min-w-0 rounded-md border border-stone-200 bg-paper-50 px-2 text-center text-xl font-black outline-none focus:border-court-500 dark:border-stone-700 dark:bg-stone-800" :disabled="isSessionReadOnly" @input="forms.finishScoreError = ''" />
            <input v-model="score.b" type="number" min="0" max="99" step="1" inputmode="numeric" :aria-label="`คะแนนทีม B เซต ${index + 1}`" class="h-12 min-w-0 rounded-md border border-stone-200 bg-paper-50 px-2 text-center text-xl font-black outline-none focus:border-court-500 dark:border-stone-700 dark:bg-stone-800" :disabled="isSessionReadOnly" @input="forms.finishScoreError = ''" />
          </div>
          <div class="mt-3 flex justify-end">
            <button v-if="forms.finishScores.length < 3" type="button" class="h-9 rounded-md border border-court-200 px-3 text-xs font-black text-court-700 dark:border-court-900 dark:text-court-300" @click="addThirdSet">+ เพิ่มเซตที่ 3</button>
            <button v-else type="button" class="h-9 rounded-md border border-rose-200 px-3 text-xs font-black text-rose-700 dark:border-rose-900 dark:text-rose-300" @click="removeThirdSet">ลบเซตที่ 3</button>
          </div>
          <p v-if="hasAnyFinishScore && finishScoreResult.error" class="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{{ finishScoreResult.error }}</p>
          <p v-else-if="finishResultText" class="mt-3 rounded-md bg-court-500/10 px-3 py-2 text-sm font-black text-court-700 dark:text-court-300">ผลอัตโนมัติ: {{ finishResultText }}</p>
        </section>

        <div v-if="!hasAnyFinishScore" class="mt-4 grid gap-2">
          <p class="text-xs font-bold text-stone-500">ไม่กรอกคะแนน — เลือกผลเองได้</p>
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
            <span class="font-bold">{{ teamName(ui.finishMatch, 'A') }}</span>
          </label>
          <label class="flex items-center gap-3 rounded-md border border-stone-200 p-3 dark:border-stone-700">
            <input v-model="forms.finishWinner" type="radio" value="B" :disabled="isSessionReadOnly" />
            <span class="font-bold">{{ teamName(ui.finishMatch, 'B') }}</span>
          </label>
        </div>

        <p v-if="forms.finishScoreError" class="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{{ forms.finishScoreError }}</p>

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
