<script setup>
import { Plus, X } from '@lucide/vue'

const props = defineProps([
  'state',
  'forms',
  'ui',
  'couponGroups',
  'levelLabel',
  'playerName',
  'addCouple',
  'removeCouple',
  'updatePlayerRandomStatus'
])

function groupValue(group) {
  return group.coupon ? group.level : 'not-ready'
}

function changeGroupStatus(group, event) {
  const level = event.target.value
  group.ids.forEach((id) => props.updatePlayerRandomStatus(id, level))
}
</script>

<template>
  <div class="fixed inset-0 z-40 grid place-items-end bg-black/40 p-3 sm:place-items-center">
    <div class="max-h-[86vh] w-full max-w-xl overflow-auto rounded-lg bg-white p-4 shadow-soft dark:bg-stone-900">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-bold">{{ ui.showCouponModal ? 'คูปองระดับมือ / สิทธิ์สุ่ม' : 'คู่รัก' }}</h2>
        <button
          class="grid h-9 w-9 place-items-center rounded-md border border-stone-200 dark:border-stone-700"
          aria-label="ปิด modal"
          @click="ui.showCouponModal = false; ui.showCoupleModal = false"
        >
          <X class="h-4 w-4" />
        </button>
      </div>

      <div v-if="ui.showCouponModal" class="mt-4 space-y-2">
        <div
          v-for="group in couponGroups"
          :key="group.ids.join('-')"
          class="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md bg-paper-100 p-3 dark:bg-stone-800"
        >
          <span class="font-bold">{{ group.ids.join('/') }}</span>
          <span class="min-w-0 truncate">{{ group.name }}</span>
          <select
            class="h-10 rounded-md border border-stone-200 bg-white px-2 text-sm font-semibold dark:border-stone-700 dark:bg-stone-900"
            :value="groupValue(group)"
            @change="changeGroupStatus(group, $event)"
          >
            <option value="not-ready">ยังไม่พร้อม</option>
            <option v-for="level in state.settings.levels" :key="level" :value="level">
              {{ levelLabel(level) }}
            </option>
          </select>
        </div>

        <p v-if="!couponGroups.length" class="rounded-md bg-paper-100 p-4 text-sm font-semibold text-stone-500 dark:bg-stone-800 dark:text-stone-400">
          ไม่มีสมาชิกว่างให้เลือก
        </p>
      </div>

      <div v-else class="mt-4 space-y-3">
        <div class="grid gap-3 rounded-md bg-paper-100 p-3 dark:bg-stone-800 sm:grid-cols-[1fr_1fr_auto]">
          <select v-model.number="forms.coupleAId" class="h-10 rounded-md border border-stone-200 bg-white px-3 dark:border-stone-700 dark:bg-stone-900">
            <option v-for="player in state.players.filter((item) => item.active)" :key="player.id" :value="player.id">
              {{ player.name }}
            </option>
          </select>
          <select v-model.number="forms.coupleBId" class="h-10 rounded-md border border-stone-200 bg-white px-3 dark:border-stone-700 dark:bg-stone-900">
            <option v-for="player in state.players.filter((item) => item.active)" :key="player.id" :value="player.id">
              {{ player.name }}
            </option>
          </select>
          <button class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-court-500 px-4 font-semibold text-white" @click="addCouple">
            <Plus class="h-4 w-4" />
            สร้างคู่รัก
          </button>
        </div>

        <div
          v-for="couple in state.couples"
          :key="couple.id"
          class="flex items-center justify-between rounded-md bg-paper-100 p-3 dark:bg-stone-800"
        >
          <span>{{ playerName(couple.a) }} + {{ playerName(couple.b) }}</span>
          <button class="grid h-9 w-9 place-items-center rounded-md border border-stone-200 dark:border-stone-700" aria-label="ลบคู่รัก" @click="removeCouple(couple.id)">
            <X class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
