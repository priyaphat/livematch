<script setup>
import { computed, ref } from 'vue'
import { Save } from '@lucide/vue'

const props = defineProps([
  'state',
  'money',
  'playerCost',
  'playerLiveShareHours',
  'liveShareCourtHours',
  'liveSharePlayerHours',
  'liveShareCourtCost',
  'liveShareShuttleCount',
  'liveShareShuttleCost',
  'liveShareSessionCost',
  'liveShareTotalCost',
  'saveLiveShareHours'
])

const visibleHourCount = ref(4)
const activePlayers = computed(() => props.state.players.filter((player) => player.active))
const savedMaxHour = computed(() => {
  const courtHours = Object.values(props.state.liveShare?.courtHours || {}).flat()
  const playerHours = Object.values(props.state.liveShare?.playerHours || {}).flat()
  const shuttleHours = Object.keys(props.state.liveShare?.shuttleHours || {}).map((hour) => Number(hour))
  return Math.max(4, ...courtHours, ...playerHours, ...shuttleHours, 1)
})
const hourCount = computed(() => Math.max(visibleHourCount.value, savedMaxHour.value))
const hours = computed(() => Array.from({ length: hourCount.value }, (_, index) => index + 1))

function hasHour(kind, target, hour) {
  const source = kind === 'court' ? props.state.liveShare.courtHours : props.state.liveShare.playerHours
  return (source[String(target)] || []).includes(hour)
}

function toggleHour(kind, target, hour) {
  const key = String(target)
  const source = kind === 'court' ? props.state.liveShare.courtHours : props.state.liveShare.playerHours
  const current = new Set(source[key] || [])
  if (current.has(hour)) current.delete(hour)
  else current.add(hour)
  source[key] = [...current].sort((a, b) => a - b)
}

function addHourColumn() {
  visibleHourCount.value = hourCount.value + 1
}

function shuttleForHour(hour) {
  return Number(props.state.liveShare.shuttleHours?.[String(hour)] || 0)
}

function updateShuttleHour(hour, value) {
  const count = Math.max(0, Math.floor(Number(value || 0)))
  if (count > 0) props.state.liveShare.shuttleHours[String(hour)] = count
  else delete props.state.liveShare.shuttleHours[String(hour)]
}
</script>

<template>
  <section class="grid gap-4">
    <div class="grid gap-3 rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 md:grid-cols-[1fr_auto] md:items-center">
      <div>
        <p class="text-sm font-semibold text-court-700 dark:text-court-300">liveShare</p>
        <h1 class="mt-1 text-2xl font-black">ชั่วโมงเล่น</h1>
        <p class="mt-1 text-sm font-semibold text-stone-500 dark:text-stone-400">เช็คสนามและสมาชิกเป็นรายชั่วโมง แล้วกดบันทึก</p>
      </div>
      <button class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-court-500 px-4 font-black text-white" @click="saveLiveShareHours">
        <Save class="h-4 w-4" />
        Save
      </button>
    </div>

    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <article class="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
        <p class="text-xs font-bold text-stone-500 dark:text-stone-400">ชั่วโมงสนาม</p>
        <p class="mt-2 text-2xl font-black">{{ liveShareCourtHours }}</p>
      </article>
      <article class="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
        <p class="text-xs font-bold text-stone-500 dark:text-stone-400">ชั่วโมงผู้เล่น</p>
        <p class="mt-2 text-2xl font-black">{{ liveSharePlayerHours }}</p>
      </article>
      <article class="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
        <p class="text-xs font-bold text-stone-500 dark:text-stone-400">ค่าคอร์ด/ค่าสนาม</p>
        <p class="mt-2 text-2xl font-black">{{ money(liveShareCourtCost) }}</p>
      </article>
      <article class="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
        <p class="text-xs font-bold text-stone-500 dark:text-stone-400">รวมจ่าย</p>
        <p class="mt-2 text-2xl font-black">{{ money(liveShareTotalCost) }}</p>
        <p class="mt-1 text-xs font-semibold text-stone-500 dark:text-stone-400">ลูกแบด {{ liveShareShuttleCount }} ลูก / {{ money(liveShareShuttleCost) }} · session {{ money(liveShareSessionCost) }}</p>
      </article>
    </div>

    <section class="overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
      <div class="flex items-center justify-between gap-3 border-b border-stone-200 bg-paper-100 p-3 dark:border-stone-800 dark:bg-stone-800">
        <h2 class="font-black">สนามรายชั่วโมง</h2>
        <button class="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm font-black dark:border-stone-700 dark:bg-stone-900" @click="addHourColumn">
          + ชั่วโมง
        </button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr class="bg-paper-100 text-left text-xs font-black text-stone-500 dark:bg-stone-800 dark:text-stone-300">
              <th class="sticky left-0 z-10 bg-paper-100 p-3 dark:bg-stone-800">สนาม</th>
              <th v-for="hour in hours" :key="hour" class="w-16 p-3 text-center">{{ hour }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="court in state.settings.courtNames" :key="court" class="border-t border-stone-100 dark:border-stone-800">
              <th class="sticky left-0 z-10 bg-white p-3 text-left font-black dark:bg-stone-900">{{ court }}</th>
              <td v-for="hour in hours" :key="hour" class="p-2 text-center">
                <input :checked="hasHour('court', court, hour)" type="checkbox" class="h-5 w-5" @change="toggleHour('court', court, hour)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
      <div class="border-b border-stone-200 bg-paper-100 p-3 dark:border-stone-800 dark:bg-stone-800">
        <h2 class="font-black">ลูกแบดรายชั่วโมง</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr class="bg-paper-100 text-left text-xs font-black text-stone-500 dark:bg-stone-800 dark:text-stone-300">
              <th class="sticky left-0 z-10 bg-paper-100 p-3 dark:bg-stone-800">ลูกแบด</th>
              <th v-for="hour in hours" :key="hour" class="w-20 p-3 text-center">{{ hour }}</th>
            </tr>
          </thead>
          <tbody>
            <tr class="border-t border-stone-100 dark:border-stone-800">
              <th class="sticky left-0 z-10 bg-white p-3 text-left font-black dark:bg-stone-900">จำนวนลูก</th>
              <td v-for="hour in hours" :key="hour" class="p-2 text-center">
                <input
                  :value="shuttleForHour(hour)"
                  type="number"
                  min="0"
                  inputmode="numeric"
                  class="h-10 w-16 rounded-md border border-stone-200 bg-paper-50 px-2 text-center font-black dark:border-stone-700 dark:bg-stone-800"
                  @input="updateShuttleHour(hour, $event.target.value)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
      <div class="border-b border-stone-200 bg-paper-100 p-3 dark:border-stone-800 dark:bg-stone-800">
        <h2 class="font-black">สมาชิกเป็นรายชั่วโมง</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[42rem] border-collapse text-sm">
          <thead>
            <tr class="bg-paper-100 text-left text-xs font-black text-stone-500 dark:bg-stone-800 dark:text-stone-300">
              <th class="sticky left-0 z-10 bg-paper-100 p-3 dark:bg-stone-800">ชื่อสมาชิก</th>
              <th v-for="hour in hours" :key="hour" class="w-16 p-3 text-center">{{ hour }}</th>
              <th class="w-28 p-3 text-right">รายคนละ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="player in activePlayers" :key="player.id" class="border-t border-stone-100 dark:border-stone-800">
              <th class="sticky left-0 z-10 bg-white p-3 text-left font-black dark:bg-stone-900">{{ player.id }}. {{ player.name }}</th>
              <td v-for="hour in hours" :key="hour" class="p-2 text-center">
                <input :checked="hasHour('player', player.id, hour)" type="checkbox" class="h-5 w-5" @change="toggleHour('player', player.id, hour)" />
              </td>
              <td class="p-3 text-right font-black text-court-700 dark:text-court-300">
                {{ money(playerCost(player)) }}
                <span class="block text-[11px] font-bold text-stone-500">{{ playerLiveShareHours(player.id) }} ชม.</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>
