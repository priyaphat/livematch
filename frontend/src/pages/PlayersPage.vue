<script setup>
import { computed, ref, watch } from 'vue'
import { Check, Copy, Download, Pencil, Plus, QrCode, Save, Search, Trash2, X } from '@lucide/vue'
import { exportMembersExcel } from '../excelExport'

const props = defineProps([
  'state',
  'forms',
  'money',
  'playerCost',
  'playerLiveShareHours',
  'levelLabel',
  'playerDeleteBlockReasons',
  'addPlayer',
  'renamePlayer',
  'deletePlayer',
  'sharePlayers',
  'openPlayersQr',
  'saveSettings',
  'togglePayment',
  'isSessionReadOnly',
  'apiRequest'
])

const filteredPlayers = computed(() => {
  const keyword = props.forms.playerSearch.trim().toLocaleLowerCase('th-TH')
  const paymentFilter = props.forms.playerPaymentFilter || 'all'
  return props.state.players.filter((player) => player.active && (
    !keyword || player.name.toLocaleLowerCase('th-TH').includes(keyword) || String(player.id).includes(keyword)
  ) && (
    paymentFilter === 'all' ||
    (paymentFilter === 'paid' && player.paid) ||
    (paymentFilter === 'unpaid' && !player.paid)
  ))
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredPlayers.value.length / props.forms.playerPageSize)))
const pagedPlayers = computed(() => {
  const start = (props.forms.playerPage - 1) * props.forms.playerPageSize
  return filteredPlayers.value.slice(start, start + props.forms.playerPageSize)
})
const editingPlayer = ref(null)
const editingName = ref('')
const editingClubMember = ref(false)
const editingPhone = ref('')
const editingMemberId = ref('')
const editingMemberOptions = ref([])
const memberOptions = ref([])
const memberLoading = ref(false)
const memberDropdownOpen = ref(false)
const memberSearchCompleted = ref('')
const memberSearchError = ref('')
const showCreateMember = ref(false)
const newMemberType = ref('general')
let memberSearchTimer
let memberSearchSequence = 0
let memberBlurTimer
let editingMemberSearchTimer
const exportLoading = ref(false)
const exportError = ref('')
const deleteBlockReasons = computed(() => (
  editingPlayer.value ? props.playerDeleteBlockReasons(editingPlayer.value.id) : []
))
const newPlayerPhoneDigits = computed(() => String(props.forms.newPlayerPhone || '').replace(/\D/g, ''))
const canCreateMissingMember = computed(() => (
  newPlayerPhoneDigits.value.length >= 9 &&
  !memberLoading.value &&
  memberSearchCompleted.value === newPlayerPhoneDigits.value &&
  !memberOptions.value.length
))

function openEditPlayer(player) {
  if (props.isSessionReadOnly) return
  editingPlayer.value = player
  editingName.value = player.name
  editingClubMember.value = Boolean(player.clubMember)
  editingPhone.value = ''
  editingMemberId.value = player.memberId || ''
  editingMemberOptions.value = []
}

function closeEditPlayer() {
  editingPlayer.value = null
  editingName.value = ''
  editingClubMember.value = false
  editingPhone.value = ''
  editingMemberId.value = ''
  editingMemberOptions.value = []
}

async function saveEditPlayer() {
  if (!editingPlayer.value || !editingName.value.trim()) return
  await props.renamePlayer(editingPlayer.value, editingName.value, editingClubMember.value, editingMemberId.value)
  closeEditPlayer()
}

function searchEditingMember() {
  clearTimeout(editingMemberSearchTimer)
  if (String(editingPhone.value || '').replace(/\D/g, '').length <= 5) {
    editingMemberOptions.value = []
    return
  }
  editingMemberSearchTimer = setTimeout(async () => {
    const payload = await props.apiRequest(`/api/admin/members/search?phone=${encodeURIComponent(editingPhone.value)}`)
    editingMemberOptions.value = payload.items || []
  }, 300)
}

function selectEditingMember() {
  const member = editingMemberOptions.value.find((item) => item.id === editingMemberId.value)
  if (member) editingName.value = member.name
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

watch(() => props.forms.playerPaymentFilter, () => {
  props.forms.playerPage = 1
})

watch(() => props.forms.newPlayerPhone, (phone) => {
  clearTimeout(memberSearchTimer)
  const digits = String(phone || '').replace(/\D/g, '')
  const selectedMember = memberOptions.value.find((item) => item.id === props.forms.newPlayerMemberId)
  if (selectedMember && String(selectedMember.phone || '').replace(/\D/g, '') === digits) {
    memberDropdownOpen.value = false
    return
  }
  props.forms.newPlayerMemberId = ''
  memberOptions.value = []
  memberSearchCompleted.value = ''
  memberSearchError.value = ''
  memberLoading.value = false
  memberSearchSequence += 1
  if (digits.length <= 5) {
    memberDropdownOpen.value = false
    return
  }
  memberDropdownOpen.value = true
  memberLoading.value = true
  const searchSequence = memberSearchSequence
  memberSearchTimer = setTimeout(async () => {
    try {
      const payload = await props.apiRequest(`/api/admin/members/search?phone=${encodeURIComponent(phone)}`)
      if (searchSequence !== memberSearchSequence) return
      memberOptions.value = payload.items || []
      memberSearchCompleted.value = digits
    } catch (error) {
      if (searchSequence === memberSearchSequence) memberSearchError.value = error.message || 'ค้นหาสมาชิกไม่สำเร็จ'
    } finally {
      if (searchSequence === memberSearchSequence) memberLoading.value = false
    }
  }, 300)
})

function selectMember(member) {
  clearTimeout(memberBlurTimer)
  props.forms.newPlayerMemberId = member.id
  props.forms.newPlayerPhone = member.phone
  props.forms.newPlayerName = member.name
  memberOptions.value = [member]
  memberSearchCompleted.value = String(member.phone || '').replace(/\D/g, '')
  memberDropdownOpen.value = false
}

function closeMemberDropdownLater() {
  clearTimeout(memberBlurTimer)
  memberBlurTimer = window.setTimeout(() => { memberDropdownOpen.value = false }, 120)
}

async function createAndSelectMember() {
  const created = await props.apiRequest('/api/admin/members', { method: 'POST', body: JSON.stringify({ name: props.forms.newPlayerName, phone: props.forms.newPlayerPhone, memberType: newMemberType.value }) })
  memberOptions.value = [created]
  props.forms.newPlayerMemberId = created.id
  props.forms.newPlayerName = created.name
  memberSearchCompleted.value = String(created.phone || '').replace(/\D/g, '')
  memberDropdownOpen.value = false
  showCreateMember.value = false
}

async function exportExcel() {
  if (exportLoading.value) return
  exportLoading.value = true
  exportError.value = ''
  try {
    await exportMembersExcel(props)
  } catch (error) {
    exportError.value = error?.message || 'สร้างไฟล์ Excel ไม่สำเร็จ'
  } finally {
    exportLoading.value = false
  }
}
</script>

<template>
  <section class="grid gap-4">
    <div data-testid="member-combobox-row" class="grid gap-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900 md:grid-cols-[1fr_auto]">
      <div class="relative">
        <div class="relative">
          <input
            v-model="forms.newPlayerPhone"
            inputmode="tel"
            autocomplete="off"
            role="combobox"
            aria-label="ค้นหาสมาชิกด้วยเบอร์โทร"
            :aria-expanded="memberDropdownOpen"
            aria-controls="new-player-member-options"
            class="h-11 w-full rounded-md border border-stone-200 bg-paper-50 px-3 pr-10 outline-none transition focus:border-court-500 dark:border-stone-700 dark:bg-stone-800"
            placeholder="ค้นหาสมาชิกด้วยเบอร์โทร (เกิน 5 หลัก)"
            :disabled="isSessionReadOnly"
            @focus="memberDropdownOpen = newPlayerPhoneDigits.length > 5"
            @blur="closeMemberDropdownLater"
            @keydown.esc="memberDropdownOpen = false"
          />
          <span v-if="memberLoading" class="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-court-500 border-t-transparent" aria-label="กำลังค้นหา" />
        </div>
        <div
          v-if="memberDropdownOpen"
          id="new-player-member-options"
          role="listbox"
          class="absolute inset-x-0 top-full z-40 mt-1 max-h-64 overflow-auto rounded-md border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-700 dark:bg-stone-900"
        >
          <p v-if="memberLoading" class="px-3 py-3 text-sm font-semibold text-stone-500">กำลังค้นหาสมาชิก...</p>
          <template v-else>
            <button
              v-for="member in memberOptions"
              :key="member.id"
              type="button"
              role="option"
              :aria-selected="forms.newPlayerMemberId === member.id"
              class="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-paper-100 dark:hover:bg-stone-800"
              @mousedown.prevent
              @click="selectMember(member)"
            >
              <span><b class="block">{{ member.phone }}</b><small class="text-stone-500">{{ member.name }}</small></span>
              <Check v-if="forms.newPlayerMemberId === member.id" class="h-4 w-4 shrink-0 text-court-600" />
            </button>
          </template>
          <p v-if="!memberLoading && memberSearchError" class="px-3 py-3 text-sm font-bold text-red-600">{{ memberSearchError }}</p>
          <div v-else-if="!memberLoading && memberSearchCompleted === newPlayerPhoneDigits && !memberOptions.length" class="p-2">
            <p class="px-1 pb-2 text-sm font-semibold text-stone-500">ไม่พบสมาชิกจากเบอร์นี้</p>
            <button v-if="canCreateMissingMember" type="button" class="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-court-500 px-3 text-sm font-black text-white" @mousedown.prevent @click="showCreateMember=true; memberDropdownOpen=false"><Plus class="h-4 w-4" />เพิ่มสมาชิกใหม่</button>
          </div>
          <p v-else-if="!memberLoading && newPlayerPhoneDigits.length <= 5" class="px-3 py-3 text-sm font-semibold text-stone-500">กรอกเบอร์ให้เกิน 5 หลักเพื่อค้นหา</p>
        </div>
      </div>
      <button class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-court-500 px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45" :disabled="isSessionReadOnly || !forms.newPlayerMemberId" @click="addPlayer">
        <Plus class="h-4 w-4" />
        เพิ่ม
      </button>
    </div>

    <div class="grid gap-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
      <div class="grid gap-2 text-sm sm:grid-cols-2">
        <label class="flex items-center gap-2">
          <input v-model="state.settings.showPaymentOnShare" type="checkbox" :disabled="isSessionReadOnly" @change="saveSettings" />
          แสดงสถานะจ่ายเงินในลิงก์แชร์
        </label>
        <label class="flex items-center gap-2">
          <input v-model="state.settings.showTotalOnShare" type="checkbox" :disabled="isSessionReadOnly" @change="saveSettings" />
          แสดงยอดรวมในลิงก์แชร์
        </label>
      </div>
      <div class="grid gap-2 sm:grid-cols-2">
        <button class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white dark:bg-white dark:text-stone-900" @click="sharePlayers">
          <Copy class="h-4 w-4" />
          คัดลอกลิงก์สมาชิก
        </button>
        <button class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-court-500 px-4 text-sm font-semibold text-white" @click="openPlayersQr">
          <QrCode class="h-4 w-4" />
          QR ลิงก์สมาชิก
        </button>
        <button
          class="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-court-200 bg-court-500/10 px-4 text-sm font-semibold text-court-700 disabled:cursor-wait disabled:opacity-60 dark:border-court-900/60 dark:text-court-300 sm:col-span-2"
          :disabled="exportLoading"
          data-testid="export-members"
          @click="exportExcel"
        >
          <Download class="h-4 w-4" />
          {{ exportLoading ? 'กำลังสร้าง Excel...' : 'Export Excel' }}
        </button>
      </div>
      <input
        v-if="forms.shareLink"
        :value="forms.shareLink"
        readonly
        class="h-10 rounded-md border border-stone-200 bg-paper-50 px-3 text-xs text-stone-500 dark:border-stone-700 dark:bg-stone-800"
      />
      <p v-if="forms.shareStatus" class="text-sm font-semibold text-court-700 dark:text-court-500">{{ forms.shareStatus }}</p>
      <p v-if="exportError" class="text-sm font-semibold text-rose-700 dark:text-rose-300">{{ exportError }}</p>
    </div>

    <div class="overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
      <div class="grid gap-3 border-b border-stone-200 bg-paper-100 p-3 dark:border-stone-800 dark:bg-stone-800 lg:grid-cols-[1fr_auto_auto]">
        <label class="flex h-11 items-center gap-2 rounded-md border border-stone-200 bg-white px-3 dark:border-stone-700 dark:bg-stone-900">
          <Search class="h-4 w-4 text-court-600" />
          <input v-model="forms.playerSearch" class="min-w-0 flex-1 bg-transparent outline-none" placeholder="ค้นหาชื่อหรือเลขสมาชิก" />
        </label>
        <select v-model="forms.playerPaymentFilter" class="h-11 rounded-md border border-stone-200 bg-white px-3 font-bold dark:border-stone-700 dark:bg-stone-900">
          <option value="all">ทั้งหมด</option>
          <option value="paid">จ่ายแล้ว</option>
          <option value="unpaid">ยังไม่จ่าย</option>
        </select>
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
          <span class="truncate text-base font-black">{{ player.name }} <span v-if="player.clubMember" class="rounded bg-court-500/10 px-1.5 py-0.5 text-xs text-court-700 dark:text-court-300">ชมรม</span></span>
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

        <label class="mt-3 grid gap-2 text-sm font-bold">
          ผูกสมาชิกด้วยเบอร์โทร
          <input v-model="editingPhone" inputmode="tel" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" placeholder="กรอกมากกว่า 5 หลัก" @input="searchEditingMember" />
        </label>
        <select v-if="editingMemberOptions.length" v-model="editingMemberId" class="mt-2 h-11 w-full rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" @change="selectEditingMember">
          <option value="">ไม่ผูกสมาชิก</option>
          <option v-for="member in editingMemberOptions" :key="member.id" :value="member.id">{{ member.phone }} · {{ member.name }}</option>
        </select>
        <p v-else-if="editingMemberId" class="mt-2 text-xs font-bold text-court-700">เชื่อมกับสมาชิกแล้ว</p>

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
    <div v-if="showCreateMember" class="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-3"><form class="w-full max-w-md rounded-lg bg-white p-4 dark:bg-stone-900" @submit.prevent="createAndSelectMember"><h2 class="text-xl font-black">เพิ่มสมาชิกใหม่</h2><div class="mt-3 grid gap-3"><input v-model="forms.newPlayerName" required placeholder="ชื่อ" class="h-11 rounded-md border bg-transparent px-3"/><input :value="forms.newPlayerPhone" disabled class="h-11 rounded-md border bg-stone-100 px-3"/><select v-model="newMemberType" class="h-11 rounded-md border bg-transparent px-3"><option value="general">สมาชิกทั่วไป</option><option value="club">สมาชิกชมรม</option></select><div class="grid grid-cols-2 gap-2"><button type="button" class="h-11 rounded-md border" @click="showCreateMember=false">ยกเลิก</button><button class="h-11 rounded-md bg-court-500 font-black text-white">เพิ่มสมาชิก</button></div></div></form></div>
  </section>
</template>
