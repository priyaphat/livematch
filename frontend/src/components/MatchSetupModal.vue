<script setup>
import { computed, ref, watch } from 'vue'
import { Plus, Search, X } from '@lucide/vue'

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

const coupleAQuery = ref('')
const coupleBQuery = ref('')
const openCoupleSelect = ref('')

const activePlayers = computed(() => props.state.players.filter((player) => player.active))
const couponFiltered = computed(() => {
  const keyword = (props.forms.couponSearch || '').trim().toLocaleLowerCase('th-TH')
  return props.couponGroups.filter((group) => (
    !keyword || group.name.toLocaleLowerCase('th-TH').includes(keyword) || group.ids.join('/').includes(keyword)
  ))
})
const couponPages = computed(() => Math.max(1, Math.ceil(couponFiltered.value.length / props.forms.couponPageSize)))
const pagedCouponGroups = computed(() => {
  const page = props.forms.couponPage || 1
  const pageSize = props.forms.couponPageSize || 8
  const start = (page - 1) * pageSize
  return couponFiltered.value.slice(start, start + pageSize)
})

watch(() => props.forms.couponSearch, () => {
  props.forms.couponPage = 1
})

function optionLabel(player) {
  return player ? `${player.id}. ${player.name}` : ''
}

function selectedPlayer(id) {
  return activePlayers.value.find((player) => player.id === Number(id))
}

function syncCoupleQueries() {
  if (props.ui.showCoupleModal && !props.forms.coupleAId && !props.forms.coupleBId) {
    coupleAQuery.value = ''
    coupleBQuery.value = ''
    return
  }
  coupleAQuery.value = optionLabel(selectedPlayer(props.forms.coupleAId))
  coupleBQuery.value = optionLabel(selectedPlayer(props.forms.coupleBId))
}

watch(
  () => [props.forms.coupleAId, props.forms.coupleBId, props.ui.showCoupleModal],
  ([, , showCouple], [, , oldShowCouple] = []) => {
    if (showCouple && !oldShowCouple) {
      props.forms.coupleAId = ''
      props.forms.coupleBId = ''
      coupleAQuery.value = ''
      coupleBQuery.value = ''
      openCoupleSelect.value = ''
      return
    }
    syncCoupleQueries()
  },
  { immediate: true }
)

function filteredCouplePlayers(query, otherSelectedId) {
  const keyword = (query || '').trim().toLocaleLowerCase('th-TH')
  return activePlayers.value
    .filter((player) => player.id !== Number(otherSelectedId))
    .filter((player) => !keyword || player.name.toLocaleLowerCase('th-TH').includes(keyword) || String(player.id).includes(keyword))
    .slice(0, 8)
}

function updateCoupleInput(slot, value) {
  const normalized = value.trim().toLocaleLowerCase('th-TH')
  const matched = activePlayers.value.find((player) => (
    optionLabel(player).toLocaleLowerCase('th-TH') === normalized ||
    player.name.toLocaleLowerCase('th-TH') === normalized ||
    String(player.id) === normalized
  ))
  if (slot === 'a') {
    coupleAQuery.value = value
    if (matched && matched.id !== Number(props.forms.coupleBId)) props.forms.coupleAId = matched.id
  } else {
    coupleBQuery.value = value
    if (matched && matched.id !== Number(props.forms.coupleAId)) props.forms.coupleBId = matched.id
  }
}

function selectCouplePlayer(slot, player) {
  if (slot === 'a') {
    props.forms.coupleAId = player.id
    coupleAQuery.value = optionLabel(player)
  } else {
    props.forms.coupleBId = player.id
    coupleBQuery.value = optionLabel(player)
  }
  openCoupleSelect.value = ''
}

function closeModal() {
  props.ui.showCouponModal = false
  props.ui.showCoupleModal = false
}

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
        <h2 class="text-lg font-bold">{{ ui.showCouponModal ? 'คูปองระดับมือ / สิทธิ์สุ่ม' : 'จับคู่' }}</h2>
        <button
          class="grid h-9 w-9 place-items-center rounded-md border border-stone-200 dark:border-stone-700"
          aria-label="ปิด modal"
          @click="closeModal"
        >
          <X class="h-4 w-4" />
        </button>
      </div>

      <div v-if="ui.showCouponModal" class="mt-4 space-y-3">
        <label class="flex h-11 items-center gap-2 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800">
          <Search class="h-4 w-4 text-court-600" />
          <input v-model="forms.couponSearch" class="min-w-0 flex-1 bg-transparent outline-none" placeholder="ค้นหาชื่อหรือเลขสมาชิก" />
        </label>

        <div
          v-for="group in pagedCouponGroups"
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

        <p v-if="!pagedCouponGroups.length" class="rounded-md bg-paper-100 p-4 text-sm font-semibold text-stone-500 dark:bg-stone-800 dark:text-stone-400">
          ไม่พบสมาชิกว่างให้เลือก
        </p>

        <div class="flex items-center justify-between gap-3 text-sm">
          <button class="h-9 rounded-md border border-stone-200 px-3 font-bold disabled:opacity-40 dark:border-stone-700" :disabled="forms.couponPage <= 1" @click="forms.couponPage--">ก่อนหน้า</button>
          <span class="font-bold">หน้า {{ forms.couponPage }} / {{ couponPages }}</span>
          <button class="h-9 rounded-md border border-stone-200 px-3 font-bold disabled:opacity-40 dark:border-stone-700" :disabled="forms.couponPage >= couponPages" @click="forms.couponPage++">ถัดไป</button>
        </div>
      </div>

      <div v-else class="mt-4 space-y-3">
        <div class="grid gap-3 rounded-md bg-paper-100 p-3 dark:bg-stone-800 sm:grid-cols-[1fr_1fr_auto]">
          <div class="relative">
            <input
              :value="coupleAQuery"
              class="h-11 w-full rounded-md border border-stone-200 bg-white px-3 font-semibold outline-none transition focus:border-court-500 focus:ring-2 focus:ring-court-500/20 dark:border-stone-700 dark:bg-stone-900"
              placeholder="เลือกสมาชิกคนที่ 1"
              autocomplete="off"
              @focus="openCoupleSelect = 'a'"
              @input="updateCoupleInput('a', $event.target.value); openCoupleSelect = 'a'"
              @blur="setTimeout(() => { openCoupleSelect = '' }, 120)"
            />
            <div v-if="openCoupleSelect === 'a'" class="absolute left-0 right-0 top-12 z-10 max-h-56 overflow-auto rounded-md border border-stone-200 bg-white p-1 shadow-soft dark:border-stone-700 dark:bg-stone-900">
              <button
                v-for="player in filteredCouplePlayers(coupleAQuery, forms.coupleBId)"
                :key="player.id"
                type="button"
                class="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-semibold hover:bg-paper-100 dark:hover:bg-stone-800"
                @mousedown.prevent="selectCouplePlayer('a', player)"
              >
                <span class="truncate">{{ player.name }}</span>
                <span class="text-xs text-stone-500">#{{ player.id }}</span>
              </button>
              <p v-if="!filteredCouplePlayers(coupleAQuery, forms.coupleBId).length" class="px-3 py-2 text-sm font-semibold text-stone-500">ไม่พบสมาชิก</p>
            </div>
          </div>

          <div class="relative">
            <input
              :value="coupleBQuery"
              class="h-11 w-full rounded-md border border-stone-200 bg-white px-3 font-semibold outline-none transition focus:border-court-500 focus:ring-2 focus:ring-court-500/20 dark:border-stone-700 dark:bg-stone-900"
              placeholder="เลือกสมาชิกคนที่ 2"
              autocomplete="off"
              @focus="openCoupleSelect = 'b'"
              @input="updateCoupleInput('b', $event.target.value); openCoupleSelect = 'b'"
              @blur="setTimeout(() => { openCoupleSelect = '' }, 120)"
            />
            <div v-if="openCoupleSelect === 'b'" class="absolute left-0 right-0 top-12 z-10 max-h-56 overflow-auto rounded-md border border-stone-200 bg-white p-1 shadow-soft dark:border-stone-700 dark:bg-stone-900">
              <button
                v-for="player in filteredCouplePlayers(coupleBQuery, forms.coupleAId)"
                :key="player.id"
                type="button"
                class="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-semibold hover:bg-paper-100 dark:hover:bg-stone-800"
                @mousedown.prevent="selectCouplePlayer('b', player)"
              >
                <span class="truncate">{{ player.name }}</span>
                <span class="text-xs text-stone-500">#{{ player.id }}</span>
              </button>
              <p v-if="!filteredCouplePlayers(coupleBQuery, forms.coupleAId).length" class="px-3 py-2 text-sm font-semibold text-stone-500">ไม่พบสมาชิก</p>
            </div>
          </div>

          <button class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-court-500 px-4 font-semibold text-white" @click="addCouple">
            <Plus class="h-4 w-4" />
            สร้างคู่
          </button>
        </div>

        <div
          v-for="couple in state.couples"
          :key="couple.id"
          class="flex items-center justify-between rounded-md bg-paper-100 p-3 dark:bg-stone-800"
        >
          <span>{{ playerName(couple.a) }} + {{ playerName(couple.b) }}</span>
          <button class="grid h-9 w-9 place-items-center rounded-md border border-stone-200 dark:border-stone-700" aria-label="ลบคู่" @click="removeCouple(couple.id)">
            <X class="h-4 w-4" />
          </button>
        </div>

        <p v-if="!state.couples.length" class="rounded-md bg-paper-100 p-4 text-sm font-semibold text-stone-500 dark:bg-stone-800 dark:text-stone-400">
          ยังไม่มีคู่จับ
        </p>
      </div>
    </div>
  </div>
</template>
