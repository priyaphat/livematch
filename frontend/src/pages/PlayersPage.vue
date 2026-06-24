<script setup>
import { computed, ref, watch } from 'vue'
import { Check, Copy, Pencil, Plus, QrCode, Save, Search, Trash2, X } from '@lucide/vue'

const props = defineProps([
  'state',
  'forms',
  'money',
  'playerCost',
  'playerDeleteBlockReasons',
  'addPlayer',
  'renamePlayer',
  'deletePlayer',
  'sharePlayers',
  'openPlayersQr',
  'saveSettings',
  'togglePayment',
  'isSessionReadOnly'
])

const filteredPlayers = computed(() => {
  const keyword = props.forms.playerSearch.trim().toLocaleLowerCase('th-TH')
  return props.state.players.filter((player) => player.active && (
    !keyword || player.name.toLocaleLowerCase('th-TH').includes(keyword) || String(player.id).includes(keyword)
  ))
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredPlayers.value.length / props.forms.playerPageSize)))
const pagedPlayers = computed(() => {
  const start = (props.forms.playerPage - 1) * props.forms.playerPageSize
  return filteredPlayers.value.slice(start, start + props.forms.playerPageSize)
})
const editingPlayer = ref(null)
const editingName = ref('')
const deleteBlockReasons = computed(() => (
  editingPlayer.value ? props.playerDeleteBlockReasons(editingPlayer.value.id) : []
))

function openEditPlayer(player) {
  if (props.isSessionReadOnly) return
  editingPlayer.value = player
  editingName.value = player.name
}

function closeEditPlayer() {
  editingPlayer.value = null
  editingName.value = ''
}

async function saveEditPlayer() {
  if (!editingPlayer.value || !editingName.value.trim()) return
  await props.renamePlayer(editingPlayer.value, editingName.value)
  closeEditPlayer()
}

async function deleteEditPlayer() {
  if (!editingPlayer.value) return
  try {
    await props.deletePlayer(editingPlayer.value)
    closeEditPlayer()
  } catch {
    // The app-level toast explains why deletion was blocked.
  }
}

watch(() => props.forms.playerSearch, () => {
  props.forms.playerPage = 1
})
</script>

<template>
  <section class="grid gap-4">
    <div class="grid gap-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900 md:grid-cols-[1fr_auto]">
      <input
        v-model="forms.newPlayerName"
        class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800"
        placeholder="ชื่อสมาชิกใหม่"
        :disabled="isSessionReadOnly"
        @keyup.enter="addPlayer"
      />
      <button class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-court-500 px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45" :disabled="isSessionReadOnly" @click="addPlayer">
        <Plus class="h-4 w-4" />
        เพิ่ม
      </button>
    </div>

    <div class="grid gap-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
      <label class="flex items-center gap-2 text-sm">
        <input v-model="state.settings.showPaymentOnShare" type="checkbox" :disabled="isSessionReadOnly" @change="saveSettings" />
        แสดงสถานะจ่ายเงินในลิงก์แชร์
      </label>
      <div class="grid gap-2 sm:grid-cols-2">
        <button class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white dark:bg-white dark:text-stone-900" @click="sharePlayers">
          <Copy class="h-4 w-4" />
          คัดลอกลิงก์สมาชิก
        </button>
        <button class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-court-500 px-4 text-sm font-semibold text-white" @click="openPlayersQr">
          <QrCode class="h-4 w-4" />
          QR ลิงก์สมาชิก
        </button>
      </div>
      <input
        v-if="forms.shareLink"
        :value="forms.shareLink"
        readonly
        class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 text-xs text-stone-500 dark:border-stone-700 dark:bg-stone-800"
      />
      <p v-if="forms.shareStatus" class="text-sm font-semibold text-court-700 dark:text-court-500">{{ forms.shareStatus }}</p>
    </div>

    <div class="overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
      <div class="grid gap-3 border-b border-stone-200 bg-paper-100 p-3 dark:border-stone-800 dark:bg-stone-800 sm:grid-cols-[1fr_auto]">
        <label class="flex h-11 items-center gap-2 rounded-md border border-stone-200 bg-white px-3 dark:border-stone-700 dark:bg-stone-900">
          <Search class="h-4 w-4 text-court-600" />
          <input v-model="forms.playerSearch" class="min-w-0 flex-1 bg-transparent outline-none" placeholder="ค้นหาชื่อหรือเลขสมาชิก" />
        </label>
        <select v-model.number="forms.playerPageSize" class="h-11 rounded-md border border-stone-200 bg-white px-3 dark:border-stone-700 dark:bg-stone-900">
          <option :value="8">8 แถว</option>
          <option :value="16">16 แถว</option>
          <option :value="32">32 แถว</option>
        </select>
      </div>

      <div class="grid grid-cols-[1fr_4rem_4rem_6rem] gap-2 border-b border-stone-200 bg-paper-100 p-3 text-sm font-black text-stone-600 dark:border-stone-800 dark:bg-stone-800 dark:text-stone-200">
        <span>ชื่อ</span>
        <span class="text-right">เกม</span>
        <span class="text-right">ลูก</span>
        <span class="text-right">ค่าใช้จ่าย</span>
      </div>

      <div v-if="!pagedPlayers.length" class="p-4 text-sm text-stone-500">
        ไม่พบสมาชิก
      </div>

      <article
        v-for="player in pagedPlayers"
        :key="player.id"
        class="block w-full border-b border-stone-100 p-3 text-left last:border-b-0 dark:border-stone-800"
        @click="forms.selectedPlayerId = player.id"
      >
        <div class="grid grid-cols-[1fr_4rem_4rem_6rem] items-baseline gap-2">
          <span class="truncate text-base font-black">{{ player.name }}</span>
          <span class="text-right font-bold">{{ player.games }}</span>
          <span class="text-right font-bold">{{ player.shuttles }}</span>
          <span class="text-right font-black tabular-nums text-court-700 dark:text-court-300">{{ money(playerCost(player)) }}</span>
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span class="font-semibold text-stone-600 dark:text-stone-300">ค่าใช้จ่าย {{ money(playerCost(player)) }}</span>
          <span class="font-semibold text-stone-600 dark:text-stone-300">ชนะ {{ player.wins || 0 }} · เสมอ {{ player.draws || 0 }} · แพ้ {{ player.losses || 0 }}</span>
          <button
            class="inline-flex h-8 items-center gap-1 rounded-md border border-court-200 bg-court-500/10 px-2 text-xs font-bold text-court-700 dark:border-court-900/60 dark:text-court-300"
            :disabled="isSessionReadOnly"
            aria-label="แก้ไขสมาชิก"
            @click.stop="openEditPlayer(player)"
          >
            <Pencil class="h-3.5 w-3.5" />
            แก้ไข
          </button>
          <button
            class="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-bold"
            :class="player.paid ? 'bg-court-500 text-white' : 'bg-shuttle-400 text-stone-900'"
            :disabled="isSessionReadOnly"
            @click.stop="togglePayment(player)"
          >
            <Check class="h-3.5 w-3.5" />
            {{ player.paid ? 'จ่ายแล้ว' : 'ยังไม่ได้จ่าย' }}
          </button>
        </div>
      </article>

      <div class="flex items-center justify-between gap-3 border-t border-stone-200 p-3 text-sm dark:border-stone-800">
        <button class="h-9 rounded-md border border-stone-200 px-3 font-bold disabled:opacity-40 dark:border-stone-700" :disabled="forms.playerPage <= 1" @click="forms.playerPage--">
          ก่อนหน้า
        </button>
        <span class="font-bold">หน้า {{ forms.playerPage }} / {{ totalPages }}</span>
        <button class="h-9 rounded-md border border-stone-200 px-3 font-bold disabled:opacity-40 dark:border-stone-700" :disabled="forms.playerPage >= totalPages" @click="forms.playerPage++">
          ถัดไป
        </button>
      </div>
    </div>

    <div
      v-if="editingPlayer"
      class="fixed inset-0 z-50 grid place-items-end bg-stone-950/45 p-3 sm:place-items-center"
      role="dialog"
      aria-modal="true"
      aria-label="แก้ไข"
      @click.self="closeEditPlayer"
    >
      <div class="w-full max-w-md rounded-lg border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-court-600 dark:text-court-300">สมาชิก #{{ editingPlayer.id }}</p>
            <h2 class="mt-1 text-xl font-black">แก้ไข</h2>
          </div>
          <button class="grid h-9 w-9 place-items-center rounded-md hover:bg-stone-100 dark:hover:bg-stone-800" aria-label="ปิด" @click="closeEditPlayer">
            <X class="h-4 w-4" />
          </button>
        </div>

        <label class="mt-4 grid gap-2 text-sm font-bold">
          ชื่อสมาชิก
          <input
            v-model="editingName"
            class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 text-base font-black outline-none focus:border-court-500 dark:border-stone-700 dark:bg-stone-800"
            :disabled="isSessionReadOnly"
            aria-label="แก้ชื่อสมาชิก"
            @keyup.enter="saveEditPlayer"
          />
        </label>

        <div class="mt-4 grid gap-2 sm:grid-cols-2">
          <button class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-court-500 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45" :disabled="isSessionReadOnly" @click="saveEditPlayer">
            <Save class="h-4 w-4" />
            บันทึกชื่อ
          </button>
          <button
            class="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 text-sm font-bold text-rose-700 disabled:cursor-not-allowed disabled:opacity-45 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300"
            :disabled="isSessionReadOnly || deleteBlockReasons.length > 0"
            @click="deleteEditPlayer"
          >
            <Trash2 class="h-4 w-4" />
            ลบชื่อ
          </button>
        </div>
        <p v-if="deleteBlockReasons.length" class="mt-3 rounded-md bg-amber-50 p-3 text-sm font-bold text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          ลบไม่ได้: {{ deleteBlockReasons.join(', ') }}
        </p>
      </div>
    </div>
  </section>
</template>
