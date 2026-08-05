<script setup>
import { computed, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { ArrowDown, ArrowUp, Check, Copy, Download, Pencil, Plus, QrCode, Save, Search, Trash2, X } from '@lucide/vue'
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

const playerSortKey = ref('')
const playerSortDirection = ref('desc')
const sortedPlayers = computed(() => {
  const sortKey = playerSortKey.value
  if (!sortKey) return filteredPlayers.value
  const direction = playerSortDirection.value === 'desc' ? -1 : 1
  return [...filteredPlayers.value].sort((left, right) => {
    let compared = 0
    if (sortKey === 'name') {
      compared = left.name.localeCompare(right.name, 'th', { numeric: true, sensitivity: 'base' })
    } else if (sortKey === 'games') {
      compared = Number(left.games || 0) - Number(right.games || 0)
    } else if (sortKey === 'shuttles') {
      compared = Number(left.shuttles || 0) - Number(right.shuttles || 0)
    } else if (sortKey === 'cost') {
      compared = Number(props.playerCost(left) || 0) - Number(props.playerCost(right) || 0)
    }
    if (compared !== 0) return compared * direction
    const byName = left.name.localeCompare(right.name, 'th', { numeric: true, sensitivity: 'base' })
    return byName || Number(left.id || 0) - Number(right.id || 0)
  })
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredPlayers.value.length / props.forms.playerPageSize)))
const pagedPlayers = computed(() => {
  const start = (props.forms.playerPage - 1) * props.forms.playerPageSize
  return sortedPlayers.value.slice(start, start + props.forms.playerPageSize)
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
const newMemberName = ref('')
const newMemberPhone = ref('')
const newMemberType = ref('general')
const createMemberError = ref('')
const createMemberSaving = ref(false)
let memberSearchTimer
let memberSearchSequence = 0
let memberBlurTimer
let editingMemberSearchTimer
const exportLoading = ref(false)
const exportError = ref('')
const paymentPlayer = ref(null)
const paymentSummary = ref(null)
const paymentLoading = ref(false)
const paymentSaving = ref(false)
const paymentError = ref('')
const paymentMethod = ref('cash')
const paymentQr = ref('')
const combinedShuttleBreakdown = computed(() => (
  paymentSummary.value?.matchBreakdownItems?.find((item) => item.label === 'ค่าลูกแบด (หารตามจำนวนผู้เล่นจริง)') || null
))
const deleteBlockReasons = computed(() => (
  editingPlayer.value ? props.playerDeleteBlockReasons(editingPlayer.value.id) : []
))
const newPlayerPhoneDigits = computed(() => String(props.forms.newPlayerPhone || '').replace(/\D/g, ''))
const newPlayerEntry = computed(() => String(props.forms.newPlayerPhone || '').trim())
const isPhoneEntry = computed(() => /^[\d\s()+-]+$/.test(newPlayerEntry.value))
const isPhoneLookup = computed(() => (
  isPhoneEntry.value && newPlayerPhoneDigits.value.length >= 1
))
const isNameLookup = computed(() => !isPhoneEntry.value && [...newPlayerEntry.value].length >= 1)
const isMemberLookup = computed(() => isPhoneLookup.value || isNameLookup.value)
const memberSearchKey = computed(() => (
  isPhoneLookup.value ? newPlayerPhoneDigits.value : newPlayerEntry.value.toLocaleLowerCase('th-TH')
))
const canAddPlayer = computed(() => (
  !props.isSessionReadOnly &&
  Boolean(props.forms.newPlayerMemberId || (newPlayerEntry.value && !isPhoneLookup.value))
))
const canCreateMissingMember = computed(() => (
  !memberLoading.value &&
  memberSearchCompleted.value === memberSearchKey.value &&
  (isNameLookup.value || (newPlayerPhoneDigits.value.length >= 10 && !memberOptions.value.length))
))
const newMemberPhoneDigits = computed(() => String(newMemberPhone.value || '').replace(/\D/g, ''))
const canSubmitNewMember = computed(() => (
  !createMemberSaving.value &&
  Boolean(newMemberName.value.trim()) &&
  newMemberPhoneDigits.value.length === 10
))

function changePlayerSort(key) {
  const sameColumn = playerSortKey.value === key
  playerSortDirection.value = sameColumn && playerSortDirection.value === 'desc' ? 'asc' : 'desc'
  playerSortKey.value = key
  props.forms.playerPage = 1
}

function playerSortAria(key) {
  if (playerSortKey.value !== key) return 'none'
  return playerSortDirection.value === 'asc' ? 'ascending' : 'descending'
}

async function openPaymentModal(player) {
  if (props.isSessionReadOnly || paymentSaving.value) return
  paymentPlayer.value = player
  paymentSummary.value = null
  paymentError.value = ''
  if (player.paid) return
  paymentLoading.value = true
  try {
    paymentSummary.value = await props.apiRequest(`/api/sessions/${props.state.session.id}/players/${player.id}/payment-summary`)
    paymentMethod.value = 'cash'
    paymentQr.value = paymentSummary.value.promptPayPayload
      ? await QRCode.toDataURL(paymentSummary.value.promptPayPayload, { width: 260, margin: 1 })
      : ''
  } catch (error) {
    paymentError.value = error.message || 'โหลดรายละเอียดค่าใช้จ่ายไม่สำเร็จ'
  } finally {
    paymentLoading.value = false
  }
}

function closePaymentModal() {
  if (paymentSaving.value) return
  paymentPlayer.value = null
  paymentSummary.value = null
  paymentError.value = ''
  paymentQr.value = ''
}

async function confirmPaymentChange() {
  if (!paymentPlayer.value || paymentSaving.value || (!paymentPlayer.value.paid && !paymentSummary.value)) return
  paymentSaving.value = true
  paymentError.value = ''
  let saved = false
  try {
    await props.togglePayment(paymentPlayer.value, paymentSummary.value, paymentMethod.value)
    saved = true
  } catch (error) {
    paymentError.value = error.message || 'บันทึกสถานะชำระเงินไม่สำเร็จ'
  } finally {
    paymentSaving.value = false
  }
  if (saved) closePaymentModal()
}

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
  if (!editingPlayer.value || editingPlayer.value.memberId || !editingName.value.trim()) return
  await props.renamePlayer(editingPlayer.value, editingName.value, editingClubMember.value, editingMemberId.value)
  closeEditPlayer()
}

function searchEditingMember() {
  clearTimeout(editingMemberSearchTimer)
  if (editingPlayer.value?.memberId || String(editingPhone.value || '').replace(/\D/g, '').length < 1) {
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
  if (!isMemberLookup.value) {
    memberDropdownOpen.value = false
    return
  }
  memberDropdownOpen.value = true
  memberLoading.value = true
  const searchSequence = memberSearchSequence
  memberSearchTimer = setTimeout(async () => {
    try {
      const parameter = isPhoneLookup.value
        ? `phone=${encodeURIComponent(phone)}`
        : `q=${encodeURIComponent(newPlayerEntry.value)}`
      const payload = await props.apiRequest(`/api/admin/members/search?${parameter}`)
      if (searchSequence !== memberSearchSequence) return
      memberOptions.value = payload.items || []
      memberSearchCompleted.value = memberSearchKey.value
    } catch (error) {
      if (searchSequence === memberSearchSequence) memberSearchError.value = error.message || 'ค้นหาสมาชิกไม่สำเร็จ'
    } finally {
      if (searchSequence === memberSearchSequence) memberLoading.value = false
    }
  }, 300)
})

async function addPlayerFromEntry() {
  if (!canAddPlayer.value) return
  if (!props.forms.newPlayerMemberId) {
    props.forms.newPlayerName = newPlayerEntry.value
  }
  await props.addPlayer()
}

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

function openCreateMemberModal() {
  newMemberName.value = isNameLookup.value ? newPlayerEntry.value : ''
  newMemberPhone.value = isPhoneLookup.value ? newPlayerEntry.value : ''
  newMemberType.value = 'general'
  createMemberError.value = ''
  showCreateMember.value = true
  memberDropdownOpen.value = false
}

function matchHistoryTooltip(match) {
  return [
    `เกม #${match.matchId} · ${match.result}`,
    `ทีม: ${match.team || '-'}`,
    `พบ: ${match.opponent || '-'}`,
    `สนาม: ${match.court || '-'} · ระดับ: ${match.level || '-'}`,
    `เวลา: ${match.startedAt || '-'}${match.endedAt ? ` ถึง ${match.endedAt}` : ''}`,
    `ลูกแบด: ${match.shuttles || 0} ลูก`,
    match.note ? `หมายเหตุ: ${match.note}` : '',
  ].filter(Boolean).join('\n')
}

async function createAndSelectMember() {
  if (!canSubmitNewMember.value) return
  createMemberSaving.value = true
  createMemberError.value = ''
  try {
    const created = await props.apiRequest('/api/admin/members', {
      method: 'POST',
      body: JSON.stringify({ name: newMemberName.value.trim(), phone: newMemberPhone.value, memberType: newMemberType.value })
    })
    memberOptions.value = [created]
    props.forms.newPlayerMemberId = created.id
    props.forms.newPlayerName = created.name
    props.forms.newPlayerPhone = created.phone
    memberSearchCompleted.value = String(created.phone || '').replace(/\D/g, '')
    memberDropdownOpen.value = false
    showCreateMember.value = false
  } catch (error) {
    createMemberError.value = error.message || 'เพิ่มสมาชิกไม่สำเร็จ'
  } finally {
    createMemberSaving.value = false
  }
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
            inputmode="text"
            autocomplete="off"
            role="combobox"
            aria-label="ชื่อขาจรหรือค้นหาสมาชิกด้วยชื่อหรือเบอร์โทร"
            :aria-expanded="memberDropdownOpen"
            aria-controls="new-player-member-options"
            class="h-11 w-full rounded-md border border-stone-200 bg-paper-50 px-3 pr-10 outline-none transition focus:border-court-500 dark:border-stone-700 dark:bg-stone-800"
            placeholder="พิมพ์ชื่อหรือเบอร์สมาชิกเพื่อค้นหาตั้งแต่ตัวแรก"
            :disabled="isSessionReadOnly"
            @focus="memberDropdownOpen = isMemberLookup"
            @blur="closeMemberDropdownLater"
            @keydown.esc="memberDropdownOpen = false"
            @keydown.enter.prevent="addPlayerFromEntry"
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
              <span><b class="block">{{ member.name }}</b><small class="text-stone-500">{{ member.phone }}</small></span>
              <Check v-if="forms.newPlayerMemberId === member.id" class="h-4 w-4 shrink-0 text-court-600" />
            </button>
          </template>
          <p v-if="!memberLoading && memberSearchError" class="px-3 py-3 text-sm font-bold text-red-600">{{ memberSearchError }}</p>
          <div v-else-if="!memberLoading && memberSearchCompleted === memberSearchKey" class="p-2">
            <p v-if="!memberOptions.length" class="px-1 pb-2 text-sm font-semibold text-stone-500">{{ isPhoneLookup ? 'ไม่พบสมาชิกจากเบอร์นี้' : 'ไม่พบสมาชิกจากชื่อนี้ สามารถเพิ่มเป็นสมาชิกใหม่หรือขาจรได้' }}</p>
            <p v-else-if="isNameLookup" class="px-1 pb-2 text-sm font-semibold text-stone-500">หากไม่ใช่คนในรายชื่อ สามารถเพิ่มสมาชิกใหม่ด้วยชื่อซ้ำได้</p>
            <button v-if="canCreateMissingMember" type="button" class="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-court-500 px-3 text-sm font-black text-white" @mousedown.prevent @click="openCreateMemberModal"><Plus class="h-4 w-4" />เพิ่มสมาชิกใหม่</button>
          </div>
        </div>
      </div>
      <button class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-court-500 px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45" :disabled="!canAddPlayer" @click="addPlayerFromEntry">
        <Plus class="h-4 w-4" />
        เพิ่ม
      </button>
      <p class="text-xs font-medium text-stone-500 md:col-span-2">
        ระบบค้นหาสมาชิกทันทีตั้งแต่พิมพ์ตัวแรก · หากไม่เลือกสมาชิกจากผลค้นหา ชื่อที่พิมพ์จะถูกเพิ่มเป็นขาจรใน Match นี้
      </p>
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

      <div class="grid grid-cols-[1fr_4rem_4rem_6rem] gap-2 border-b border-stone-200 bg-paper-100 p-3 text-sm font-black text-stone-600 dark:border-stone-800 dark:bg-stone-800 dark:text-stone-200" role="row">
        <span role="columnheader" :aria-sort="playerSortAria('name')">
          <button class="flex w-full items-center gap-1 text-left" type="button" aria-label="เรียงตามชื่อ" @click="changePlayerSort('name')">
            ชื่อ<ArrowDown v-if="playerSortKey === 'name' && playerSortDirection === 'asc'" class="h-3.5 w-3.5" /><ArrowUp v-else-if="playerSortKey === 'name'" class="h-3.5 w-3.5" />
          </button>
        </span>
        <span role="columnheader" :aria-sort="playerSortAria('games')" class="text-right">
          <button class="flex w-full items-center justify-end gap-1" type="button" aria-label="เรียงตามจำนวนเกม" @click="changePlayerSort('games')">
            เกม<ArrowDown v-if="playerSortKey === 'games' && playerSortDirection === 'asc'" class="h-3.5 w-3.5" /><ArrowUp v-else-if="playerSortKey === 'games'" class="h-3.5 w-3.5" />
          </button>
        </span>
        <span role="columnheader" :aria-sort="playerSortAria('shuttles')" class="text-right">
          <button class="flex w-full items-center justify-end gap-1" type="button" aria-label="เรียงตามจำนวนลูก" @click="changePlayerSort('shuttles')">
            ลูก<ArrowDown v-if="playerSortKey === 'shuttles' && playerSortDirection === 'asc'" class="h-3.5 w-3.5" /><ArrowUp v-else-if="playerSortKey === 'shuttles'" class="h-3.5 w-3.5" />
          </button>
        </span>
        <span role="columnheader" :aria-sort="playerSortAria('cost')" class="text-right">
          <button class="flex w-full items-center justify-end gap-1" type="button" aria-label="เรียงตามค่าใช้จ่าย" @click="changePlayerSort('cost')">
            ค่าใช้จ่าย<ArrowDown v-if="playerSortKey === 'cost' && playerSortDirection === 'asc'" class="h-3.5 w-3.5" /><ArrowUp v-else-if="playerSortKey === 'cost'" class="h-3.5 w-3.5" />
          </button>
        </span>
      </div>

      <div v-if="!pagedPlayers.length" class="p-4 text-sm text-stone-500">
        ไม่พบสมาชิก
      </div>

      <article
        v-for="player in pagedPlayers"
        :key="player.id"
        data-testid="player-row"
        class="block w-full border-b border-stone-100 p-3 text-left last:border-b-0 dark:border-stone-800"
        @click="forms.selectedPlayerId = player.id"
      >
        <div class="grid grid-cols-[1fr_4rem_4rem_6rem] items-baseline gap-2">
          <span class="truncate text-base font-black"><span class="tabular-nums text-stone-500 dark:text-stone-400">#{{ player.id }}</span> {{ player.name }} <span v-if="player.clubMember" class="rounded bg-court-500/10 px-1.5 py-0.5 text-xs text-court-700 dark:text-court-300">ชมรม</span></span>
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
            :aria-label="player.memberId ? 'ลบสมาชิกออกจาก Match' : 'แก้ไขสมาชิก'"
            @click.stop="openEditPlayer(player)"
          >
            <Trash2 v-if="player.memberId" class="h-3.5 w-3.5" />
            <Pencil v-else class="h-3.5 w-3.5" />
            {{ player.memberId ? 'ลบออก' : 'แก้ไข' }}
          </button>
          <button
            class="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-bold"
            :class="player.paid ? 'border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300' : 'bg-shuttle-400 text-stone-900'"
            :disabled="isSessionReadOnly"
            @click.stop="openPaymentModal(player)"
          >
            <Check v-if="player.paid" class="h-3.5 w-3.5" />
            {{ player.paid ? 'ยกเลิกการชำระ' : 'ชำระเงิน' }}
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
      v-if="paymentPlayer"
      class="fixed inset-0 z-[60] grid place-items-end bg-stone-950/50 p-3 sm:place-items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="player-payment-title"
      @click.self="closePaymentModal"
    >
      <div class="w-full max-w-md overflow-hidden rounded-lg border border-stone-200 bg-white shadow-soft dark:border-stone-700 dark:bg-stone-900">
        <div class="flex items-start justify-between gap-3 border-b border-stone-100 p-4 dark:border-stone-800">
          <div>
            <p class="text-xs font-black uppercase tracking-wider text-court-600 dark:text-court-300">{{ paymentPlayer.name }}</p>
            <h2 id="player-payment-title" class="mt-1 text-xl font-black">{{ paymentPlayer.paid ? 'ยกเลิกการชำระเงิน' : 'รายละเอียดการชำระเงิน' }}</h2>
          </div>
          <button class="grid h-9 w-9 place-items-center rounded-md hover:bg-stone-100 disabled:opacity-40 dark:hover:bg-stone-800" aria-label="ปิด" :disabled="paymentSaving" @click="closePaymentModal">
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="max-h-[60vh] overflow-y-auto p-4">
          <template v-if="paymentPlayer.paid">
            <p class="rounded-lg bg-rose-50 p-4 text-sm font-bold text-rose-800 dark:bg-rose-950/25 dark:text-rose-200">ต้องการยกเลิกสถานะชำระเงินของ {{ paymentPlayer.name }} ใช่หรือไม่</p>
          </template>
          <template v-else>
            <div v-if="paymentLoading" class="rounded-lg bg-paper-100 p-5 text-center text-sm font-bold text-stone-500 dark:bg-stone-800">กำลังคำนวณค่าใช้จ่ายล่าสุด...</div>
            <div v-else-if="paymentSummary" class="grid gap-2">
              <div v-for="item in paymentSummary.items" :key="item.key" class="rounded-lg bg-paper-100 p-3 dark:bg-stone-800">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="font-black">{{ item.label }}</p>
                    <p v-if="item.description" class="mt-0.5 text-xs font-semibold text-stone-500 dark:text-stone-400">{{ item.description }}</p>
                    <p v-if="item.quantity > 1" class="mt-0.5 text-xs font-semibold text-stone-500 dark:text-stone-400">{{ item.quantity }} × {{ money(item.unitAmountThb) }}</p>
                  </div>
                  <p class="shrink-0 font-black tabular-nums">{{ money(item.amountThb) }}</p>
                </div>
                <div v-if="item.details?.length" class="mt-3 grid gap-1.5 border-t border-stone-200 pt-2 dark:border-stone-700" data-testid="shuttle-brand-details">
                  <div v-for="detail in item.details" :key="detail.key" class="flex items-center justify-between gap-3 text-sm">
                    <span class="font-bold">↳ {{ detail.label }}</span>
                    <span class="shrink-0 text-xs font-semibold text-stone-500">{{ detail.quantity }} ลูก × {{ money(detail.unitAmountThb) }}</span>
                  </div>
                </div>
              </div>
              <div v-if="combinedShuttleBreakdown?.details?.length" class="rounded-lg bg-paper-100 p-3 dark:bg-stone-800">
                <div class="flex items-center justify-between gap-3">
                  <p class="font-black">{{ combinedShuttleBreakdown.label }}</p>
                  <p class="font-black tabular-nums">{{ money(combinedShuttleBreakdown.amountThb) }}</p>
                </div>
                <div class="mt-3 grid gap-1.5 border-t border-stone-200 pt-2 dark:border-stone-700" data-testid="shuttle-brand-details">
                  <div v-for="detail in combinedShuttleBreakdown.details" :key="detail.key" class="flex items-center justify-between gap-3 text-sm">
                    <span class="font-bold">↳ {{ detail.label }}</span>
                    <span class="shrink-0 text-xs font-semibold text-stone-500">{{ detail.quantity }} ลูก × {{ money(detail.unitAmountThb) }}</span>
                  </div>
                </div>
              </div>
              <section v-if="paymentSummary.matchHistory?.length" class="mt-2 rounded-lg border border-stone-200 p-3 dark:border-stone-700" data-testid="payment-match-history">
                <div class="flex items-center justify-between gap-3">
                  <h3 class="font-black">ประวัติการเล่นแบบย่อ</h3>
                  <span class="text-xs font-semibold text-stone-500">วางเมาส์เพื่อดูรายละเอียด</span>
                </div>
                <div class="mt-2 grid gap-1.5">
                  <div
                    v-for="match in paymentSummary.matchHistory"
                    :key="match.matchId"
                    class="group relative flex cursor-help items-center justify-between gap-3 rounded-md bg-paper-50 px-3 py-2 text-sm outline-none ring-court-500/30 focus:ring-2 dark:bg-stone-900"
                    tabindex="0"
                    :title="matchHistoryTooltip(match)"
                  >
                    <span class="min-w-0 truncate font-bold">เกม #{{ match.matchId }} · {{ match.court || 'ไม่ระบุสนาม' }}</span>
                    <span class="shrink-0 rounded px-2 py-0.5 text-xs font-black" :class="match.result === 'ชนะ' ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300' : match.result === 'แพ้' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200'">{{ match.result }}</span>
                    <div class="pointer-events-none invisible absolute bottom-full left-0 z-40 mb-2 w-72 rounded-lg bg-stone-950 p-3 text-xs font-semibold leading-5 text-white opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100">
                      <p class="font-black">เกม #{{ match.matchId }} · {{ match.result }}</p>
                      <p>ทีม: {{ match.team || '-' }}</p>
                      <p>พบ: {{ match.opponent || '-' }}</p>
                      <p>สนาม: {{ match.court || '-' }} · ระดับ: {{ match.level || '-' }}</p>
                      <p>เวลา: {{ match.startedAt || '-' }}<template v-if="match.endedAt"> ถึง {{ match.endedAt }}</template></p>
                      <p>ลูกแบด: {{ match.shuttles || 0 }} ลูก</p>
                      <p v-if="match.note">หมายเหตุ: {{ match.note }}</p>
                    </div>
                  </div>
                </div>
              </section>
              <div class="mt-2 flex items-center justify-between border-t border-stone-200 pt-4 text-lg font-black dark:border-stone-700">
                <span>ยอดรวม</span>
                <span class="text-court-700 dark:text-court-300">{{ money(paymentSummary.totalThb) }}</span>
              </div>
              <div v-if="paymentSummary.posEnabled" class="mt-2 grid gap-2 rounded-lg bg-sky-50 p-3 text-sm dark:bg-sky-950/30">
                <div class="flex justify-between"><span>ยอด Match ทั้งหมด</span><b>{{ money(paymentSummary.matchTotalThb) }}</b></div>
                <div class="flex justify-between"><span>ยอดสินค้า POS</span><b>{{ money(paymentSummary.posTotalThb) }}</b></div>
              </div>
              <fieldset class="mt-2 grid gap-2 text-sm font-black">
                <legend class="mb-1">ช่องทางชำระ</legend>
                <div class="grid grid-cols-2 gap-2">
                  <label class="flex h-11 items-center gap-2 rounded-lg border px-3" :class="paymentMethod === 'cash' ? 'border-court-500 bg-court-500/10' : 'border-stone-200 dark:border-stone-700'"><input v-model="paymentMethod" type="radio" value="cash" /> เงินสด</label>
                  <label class="flex h-11 items-center gap-2 rounded-lg border px-3" :class="paymentMethod === 'promptpay' ? 'border-court-500 bg-court-500/10' : 'border-stone-200 dark:border-stone-700'"><input v-model="paymentMethod" type="radio" value="promptpay" /> สแกน</label>
                </div>
              </fieldset>
              <div v-if="paymentMethod==='promptpay'" class="mt-2 grid place-items-center rounded-lg bg-paper-100 p-3 dark:bg-stone-800"><img v-if="paymentQr" :src="paymentQr" alt="Match PromptPay QR" class="h-44 w-44 rounded bg-white p-1" /><p v-else class="text-center text-sm font-bold text-stone-500">บันทึกเป็นการชำระแบบสแกน · ยังไม่ได้ตั้งค่า PromptPay QR</p></div>
              <p class="text-xs font-semibold text-stone-500">คำนวณใหม่จากข้อมูลล่าสุดของระบบก่อนแสดงรายการนี้</p>
            </div>
          </template>
          <p v-if="paymentError" class="mt-3 rounded-lg bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">{{ paymentError }}</p>
        </div>

        <div class="grid grid-cols-2 gap-2 border-t border-stone-100 p-4 dark:border-stone-800">
          <button class="h-11 rounded-md border border-stone-200 font-bold disabled:opacity-40 dark:border-stone-700" :disabled="paymentSaving" @click="closePaymentModal">{{ paymentPlayer.paid ? 'ยกเลิก' : 'ปิด' }}</button>
          <button
            class="h-11 rounded-md font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
            :class="paymentPlayer.paid ? 'bg-rose-600' : 'bg-court-500'"
            :disabled="paymentSaving || paymentLoading || (!paymentPlayer.paid && !paymentSummary)"
            @click="confirmPaymentChange"
          >
            {{ paymentSaving ? 'กำลังบันทึก...' : paymentPlayer.paid ? 'ตกลง' : 'ชำระ' }}
          </button>
        </div>
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
            :disabled="isSessionReadOnly || Boolean(editingPlayer.memberId)"
            aria-label="แก้ชื่อสมาชิก"
            @keyup.enter="saveEditPlayer"
          />
        </label>

        <label class="mt-3 grid gap-2 text-sm font-bold" :class="editingPlayer.memberId ? 'opacity-60' : ''">
          ผูกสมาชิกด้วยเบอร์โทร
          <input v-model="editingPhone" inputmode="tel" class="h-11 rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" :disabled="isSessionReadOnly || Boolean(editingPlayer.memberId)" :placeholder="editingPlayer.memberId ? 'จัดการข้อมูลที่ระบบสมาชิก' : 'พิมพ์เบอร์เพื่อค้นหาตั้งแต่ตัวแรก'" @input="searchEditingMember" />
        </label>
        <select v-if="editingMemberOptions.length && !editingPlayer.memberId" v-model="editingMemberId" class="mt-2 h-11 w-full rounded-md border border-stone-200 bg-paper-50 px-3 dark:border-stone-700 dark:bg-stone-800" @change="selectEditingMember">
          <option value="">ไม่ผูกสมาชิก</option>
          <option v-for="member in editingMemberOptions" :key="member.id" :value="member.id">{{ member.phone }} · {{ member.name }}</option>
        </select>
        <p v-else-if="editingMemberId" class="mt-2 rounded-md bg-court-500/10 p-3 text-xs font-bold text-court-700 dark:text-court-300">เชื่อมกับระบบสมาชิกแล้ว ชื่อและเบอร์โทรต้องแก้ไขจากระบบสมาชิกเท่านั้น</p>

        <div class="mt-4 grid gap-2 sm:grid-cols-2">
          <button v-if="!editingPlayer.memberId" class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-court-500 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45" :disabled="isSessionReadOnly" @click="saveEditPlayer">
            <Save class="h-4 w-4" />
            บันทึกชื่อ
          </button>
          <button
            class="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 text-sm font-bold text-rose-700 disabled:cursor-not-allowed disabled:opacity-45 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300"
            :class="editingPlayer.memberId ? 'sm:col-span-2' : ''"
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
    <div v-if="showCreateMember" class="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-3" @click.self="showCreateMember=false">
      <form class="w-full max-w-md rounded-lg bg-white p-4 dark:bg-stone-900" @submit.prevent="createAndSelectMember">
        <h2 class="text-xl font-black">เพิ่มสมาชิกใหม่</h2>
        <div class="mt-3 grid gap-3">
          <input v-model="newMemberName" required aria-label="ชื่อสมาชิกใหม่" placeholder="ชื่อ" class="h-11 rounded-md border bg-transparent px-3" />
          <p class="rounded-md bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">** ชื่อซ้ำจะมีผลตอนเรียกชื่อ</p>
          <div class="grid gap-1">
            <input v-model="newMemberPhone" required inputmode="tel" autocomplete="tel" aria-label="เบอร์โทรสมาชิกใหม่" placeholder="เบอร์โทร 10 หลัก" class="h-11 rounded-md border bg-transparent px-3" />
            <p class="text-xs font-semibold" :class="newMemberPhoneDigits.length > 0 && newMemberPhoneDigits.length !== 10 ? 'text-red-600' : 'text-stone-500'">กรอกเบอร์โทรให้ครบ 10 หลัก</p>
          </div>
          <div class="relative">
            <select v-model="newMemberType" aria-label="ประเภทสมาชิก" class="h-11 w-full appearance-none rounded-md border bg-transparent px-3 pr-10">
              <option value="general">สมาชิกทั่วไป</option>
              <option value="club">สมาชิกชมรม</option>
            </select>
            <ArrowDown class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" aria-hidden="true" />
          </div>
          <p v-if="createMemberError" class="rounded-md bg-red-50 p-3 text-sm font-bold text-red-700 dark:bg-red-950/40 dark:text-red-200">{{ createMemberError }}</p>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" class="h-11 rounded-md border" :disabled="createMemberSaving" @click="showCreateMember=false">ยกเลิก</button>
            <button class="h-11 rounded-md bg-court-500 font-black text-white disabled:cursor-not-allowed disabled:opacity-45" :disabled="!canSubmitNewMember">{{ createMemberSaving ? 'กำลังเพิ่ม...' : 'เพิ่มสมาชิก' }}</button>
          </div>
        </div>
      </form>
    </div>
  </section>
</template>
