<script setup>
import { computed, ref } from 'vue'
import { CheckCircle2, CircleDollarSign, Search, Shield, UsersRound, XCircle } from '@lucide/vue'

const props = defineProps([
  'state',
  'share',
  'money',
  'playerCost'
])

const searchText = ref('')
const paymentFilter = ref('all')

const activePlayers = computed(() => props.state.players.filter((player) => player.active))
const paidCount = computed(() => activePlayers.value.filter((player) => player.paid).length)
const unpaidCount = computed(() => activePlayers.value.length - paidCount.value)
const totalCost = computed(() => activePlayers.value.reduce((sum, player) => sum + props.playerCost(player), 0))

const filteredPlayers = computed(() => {
  const keyword = searchText.value.trim().toLocaleLowerCase('th-TH')
  return activePlayers.value
    .filter((player) => {
      const matchesSearch = !keyword || player.name.toLocaleLowerCase('th-TH').includes(keyword) || String(player.id).includes(keyword)
      const matchesPayment =
        paymentFilter.value === 'all' ||
        !props.share.showPayment ||
        (paymentFilter.value === 'paid' && player.paid) ||
        (paymentFilter.value === 'unpaid' && !player.paid)
      return matchesSearch && matchesPayment
    })
    .sort((a, b) => (b.wins || 0) - (a.wins || 0) || b.games - a.games || a.name.localeCompare(b.name, 'th-TH'))
})

const filterTabs = computed(() => [
  { id: 'all', label: 'ทั้งหมด', count: activePlayers.value.length },
  { id: 'paid', label: 'จ่ายแล้ว', count: paidCount.value, hidden: !props.share.showPayment },
  { id: 'unpaid', label: 'ค้างจ่าย', count: unpaidCount.value, hidden: !props.share.showPayment }
].filter((tab) => !tab.hidden))

function rankStyle(index) {
  const styles = [
    {
      wrap: 'h-12 w-12 bg-amber-400 text-stone-950 shadow-[0_10px_24px_rgba(245,158,11,0.34)] ring-4 ring-amber-100 dark:ring-amber-400/20',
      icon: 'h-7 w-7',
      label: 'text-[11px]',
      effect: 'rank-shield rank-shield-1'
    },
    {
      wrap: 'h-11 w-11 bg-stone-300 text-stone-950 shadow-[0_8px_18px_rgba(120,113,108,0.24)] ring-4 ring-stone-100 dark:ring-stone-400/15',
      icon: 'h-6 w-6',
      label: 'text-[10px]',
      effect: 'rank-shield rank-shield-2'
    },
    {
      wrap: 'h-10 w-10 bg-orange-300 text-stone-950 shadow-[0_8px_18px_rgba(251,146,60,0.24)] ring-4 ring-orange-100 dark:ring-orange-400/15',
      icon: 'h-5 w-5',
      label: 'text-[10px]',
      effect: 'rank-shield rank-shield-3'
    },
    {
      wrap: 'h-9 w-9 bg-court-500/15 text-court-700 dark:bg-court-500/20 dark:text-court-300',
      icon: 'h-4.5 w-4.5',
      label: 'text-[9px]',
      effect: 'rank-shield rank-shield-4'
    },
    {
      wrap: 'h-8 w-8 bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
      icon: 'h-4 w-4',
      label: 'text-[9px]',
      effect: 'rank-shield rank-shield-5'
    }
  ]
  return styles[index] || null
}
</script>

<template>
  <section class="min-h-screen bg-paper-50 px-3 py-4 dark:bg-paper-900 sm:px-4">
    <div class="mx-auto grid max-w-3xl gap-4">
      <div class="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-soft dark:border-stone-700 dark:bg-stone-900">
        <div class="bg-[linear-gradient(135deg,#1f9a78_0%,#2f7f8f_52%,#262b25_100%)] p-4 text-white">
          <p class="text-xs font-black uppercase tracking-[0.16em] text-white/75">LiveMatch View</p>
          <div class="mt-2 flex items-end justify-between gap-3">
            <div class="min-w-0">
              <h1 class="truncate text-2xl font-black leading-tight">{{ state.session.name }}</h1>
              <p class="mt-1 text-sm font-medium text-white/80">รายชื่อสมาชิกและสรุปค่าใช้จ่าย</p>
            </div>
            <div class="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-white/15 ring-1 ring-white/20">
              <UsersRound class="h-6 w-6" />
            </div>
          </div>
        </div>

        <div class="grid grid-cols-3 divide-x divide-stone-100 border-b border-stone-100 dark:divide-stone-800 dark:border-stone-800">
          <div class="p-3">
            <p class="text-[11px] font-bold text-stone-500 dark:text-stone-400">สมาชิก</p>
            <p class="mt-1 text-xl font-black">{{ activePlayers.length }}</p>
          </div>
          <div class="p-3">
            <p class="text-[11px] font-bold text-stone-500 dark:text-stone-400">เกมรวม</p>
            <p class="mt-1 text-xl font-black">{{ activePlayers.reduce((sum, player) => sum + player.games, 0) }}</p>
          </div>
          <div class="p-3">
            <p class="text-[11px] font-bold text-stone-500 dark:text-stone-400">ยอดรวม</p>
            <p class="mt-1 truncate text-xl font-black">{{ money(totalCost) }}</p>
          </div>
        </div>

        <div class="grid gap-3 p-3">
          <label class="group flex h-12 items-center gap-2 rounded-lg border border-stone-200 bg-paper-50 px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition focus-within:border-court-500 focus-within:ring-4 focus-within:ring-court-500/15 dark:border-stone-700 dark:bg-stone-800">
            <Search class="h-5 w-5 shrink-0 text-court-700 dark:text-court-400" />
            <input
              v-model="searchText"
              class="min-w-0 flex-1 bg-transparent text-base font-bold outline-none placeholder:text-stone-400"
              placeholder="ค้นหาชื่อหรือเลขสมาชิก"
            />
          </label>

          <div class="grid rounded-lg border border-stone-200 bg-paper-100 p-1 dark:border-stone-700 dark:bg-stone-800" :style="{ gridTemplateColumns: `repeat(${filterTabs.length}, minmax(0, 1fr))` }">
            <button
              v-for="tab in filterTabs"
              :key="tab.id"
              class="flex h-10 items-center justify-center gap-1.5 rounded-md text-xs font-black transition"
              :class="paymentFilter === tab.id ? 'bg-white text-stone-950 shadow-soft dark:bg-stone-950 dark:text-white' : 'text-stone-500 dark:text-stone-400'"
              @click="paymentFilter = tab.id"
            >
              <span>{{ tab.label }}</span>
              <span class="rounded bg-stone-900/10 px-1.5 py-0.5 text-[10px] dark:bg-white/10">{{ tab.count }}</span>
            </button>
          </div>
        </div>
      </div>

      <div v-if="share.loading" class="rounded-lg border border-stone-200 bg-white p-4 text-sm font-semibold text-stone-500 dark:border-stone-700 dark:bg-stone-900">
        กำลังโหลดข้อมูล
      </div>

      <div v-else-if="share.error" class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
        {{ share.error }}
      </div>

      <div v-else class="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-soft dark:border-stone-700 dark:bg-stone-900">
        <div
          class="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-2 border-b border-stone-200 bg-paper-100 px-3 py-2 text-xs font-black text-stone-500 dark:border-stone-800 dark:bg-stone-800 dark:text-stone-300"
          :class="share.showPayment ? 'sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_8rem]' : 'sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem]'"
        >
          <span>ชื่อ</span>
          <span class="text-right">เกม</span>
          <span class="text-right">ลูก</span>
          <span v-if="share.showPayment" class="hidden text-right sm:block">สถานะ</span>
        </div>

        <div v-if="!filteredPlayers.length" class="grid place-items-center gap-2 px-4 py-10 text-center">
          <Search class="h-8 w-8 text-stone-300 dark:text-stone-600" />
          <p class="text-sm font-bold text-stone-500 dark:text-stone-400">
            {{ activePlayers.length ? 'ไม่พบรายชื่อที่ค้นหา' : 'ยังไม่มีสมาชิก' }}
          </p>
        </div>

        <div
          v-for="(player, index) in filteredPlayers"
          :key="player.id"
          class="border-b border-stone-100 px-3 py-3 last:border-b-0 dark:border-stone-800"
          :class="index < 5 ? 'bg-[linear-gradient(90deg,rgba(31,154,120,0.08),transparent_62%)] dark:bg-[linear-gradient(90deg,rgba(47,127,143,0.16),transparent_62%)]' : ''"
        >
          <div
            class="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-2"
            :class="share.showPayment ? 'sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_8rem]' : 'sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem]'"
          >
            <div class="min-w-0">
              <div class="flex min-w-0 items-center gap-2">
                <span
                  v-if="rankStyle(index)"
                  class="relative grid shrink-0 place-items-center overflow-hidden rounded-lg"
                  :class="[rankStyle(index).wrap, rankStyle(index).effect]"
                  :title="`อันดับ ${index + 1}`"
                >
                  <Shield :class="rankStyle(index).icon" />
                  <span class="absolute font-black leading-none" :class="rankStyle(index).label">{{ index + 1 }}</span>
                </span>
                <span
                  v-else
                  class="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-court-500/10 text-xs font-black text-court-700 dark:bg-court-500/20 dark:text-court-300"
                >
                  {{ player.id }}
                </span>
                <span class="min-w-0">
                  <span class="block truncate text-base font-black">{{ player.name }}</span>
                  <span v-if="index < 5" class="block truncate text-xs font-bold text-court-700 dark:text-court-300">Top {{ index + 1 }} · ชนะ {{ player.wins || 0 }}</span>
                </span>
              </div>
            </div>
            <span class="text-right text-base font-black tabular-nums">{{ player.games }}</span>
            <span class="text-right text-base font-black tabular-nums">{{ player.shuttles }}</span>
            <span v-if="share.showPayment" class="hidden justify-self-end sm:block">
              <span
                class="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-black"
                :class="player.paid ? 'bg-court-500/12 text-court-700 dark:bg-court-500/20 dark:text-court-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'"
              >
                <CheckCircle2 v-if="player.paid" class="h-4 w-4" />
                <XCircle v-else class="h-4 w-4" />
                {{ player.paid ? 'จ่ายแล้ว' : 'ค้างจ่าย' }}
              </span>
            </span>
          </div>

          <div class="mt-2 flex flex-wrap items-center justify-between gap-2 pl-10">
            <span class="inline-flex items-center gap-1.5 text-sm font-bold text-stone-600 dark:text-stone-300">
              <CircleDollarSign class="h-4 w-4 text-court-700 dark:text-court-400" />
              ค่าใช้จ่าย {{ money(playerCost(player)) }}
            </span>
            <span class="text-sm font-bold text-stone-600 dark:text-stone-300">
              ชนะ {{ player.wins || 0 }} · แพ้ {{ player.losses || 0 }}
            </span>
            <span
              v-if="share.showPayment"
              class="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-black sm:hidden"
              :class="player.paid ? 'bg-court-500/12 text-court-700 dark:bg-court-500/20 dark:text-court-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'"
            >
              <CheckCircle2 v-if="player.paid" class="h-4 w-4" />
              <XCircle v-else class="h-4 w-4" />
              {{ player.paid ? 'จ่ายแล้ว' : 'ค้างจ่าย' }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.rank-shield::before {
  content: "";
  position: absolute;
  inset: -40%;
  transform: translateX(-80%) rotate(18deg);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.62), transparent);
  animation: shield-shine 3.4s ease-in-out infinite;
}

.rank-shield-1 {
  animation: shield-pop 2.4s ease-in-out infinite;
}

.rank-shield-2 {
  animation: shield-float 2.8s ease-in-out infinite;
  animation-delay: 0.12s;
}

.rank-shield-3 {
  animation: shield-float 3.1s ease-in-out infinite;
  animation-delay: 0.24s;
}

.rank-shield-4::before,
.rank-shield-5::before {
  animation-duration: 4.6s;
  opacity: 0.55;
}

@keyframes shield-pop {
  0%,
  100% {
    transform: translateY(0) scale(1);
    filter: saturate(1);
  }
  50% {
    transform: translateY(-2px) scale(1.07);
    filter: saturate(1.2);
  }
}

@keyframes shield-float {
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-1px) rotate(-2deg);
  }
}

@keyframes shield-shine {
  0%,
  42% {
    transform: translateX(-90%) rotate(18deg);
  }
  58%,
  100% {
    transform: translateX(90%) rotate(18deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .rank-shield,
  .rank-shield::before {
    animation: none;
  }
}
</style>
