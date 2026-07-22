<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ArrowLeft, CalendarDays, CreditCard, Eye, History, Pencil, Plus, RefreshCw, Search, Trash2, Users, X } from '@lucide/vue'

const props = defineProps(['apiRequest', 'auth'])
const state = reactive({ items: [], total: 0, page: 1, pageSize: 20, search: '', loading: false, error: '' })
const modal = ref(null)
const detail = ref(null)
const confirmDelete = ref(null)
let searchTimer
const totalPages = computed(() => Math.max(1, Math.ceil(state.total / state.pageSize)))

async function load(page = state.page) {
  state.loading = true; state.error = ''
  try {
    const params = new URLSearchParams({ page, pageSize: state.pageSize, search: state.search })
    const data = await props.apiRequest(`/api/admin/members?${params}`)
    Object.assign(state, { items: data.items || [], total: data.total || 0, page: data.page || page })
  } catch (error) { state.error = error.message } finally { state.loading = false }
}
function openCreate() { modal.value = { id: '', name: '', phone: '', memberType: 'general', active: true } }
function openEdit(item) { modal.value = { ...item } }
function goBack() { window.location.assign('/') }
async function openDetail(item) {
  state.error = ''
  try { detail.value = await props.apiRequest(`/api/admin/members/${item.id}`) }
  catch (error) { state.error = error.message }
}
function editFromDetail() { const member = detail.value?.member; detail.value = null; if (member) openEdit(member) }
const statusText = (status) => ({ hold: 'กำลังจอง', pending_review: 'รอตรวจสอบ', confirmed: 'ยืนยันแล้ว', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก', expired: 'หมดเวลา', paid: 'ชำระแล้ว', unpaid: 'ยังไม่ชำระ', pending: 'รอตรวจ', approved: 'อนุมัติแล้ว' }[status] || status)
async function save() {
  const item = modal.value
  try {
    await props.apiRequest(item.id ? `/api/admin/members/${item.id}` : '/api/admin/members', {
      method: item.id ? 'PATCH' : 'POST', body: JSON.stringify(item)
    })
    modal.value = null; await load(1)
  } catch (error) { state.error = error.message }
}
async function remove() {
  try { await props.apiRequest(`/api/admin/members/${confirmDelete.value.id}`, { method: 'DELETE' }); confirmDelete.value = null; await load(1) }
  catch (error) { state.error = error.message }
}
watch(() => state.search, () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => load(1), 300) })
onMounted(() => load(1))
</script>

<template>
  <section class="mx-auto grid max-w-6xl gap-4 p-4 text-stone-900 dark:text-stone-100">
    <header class="rounded-xl border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <button class="grid h-10 w-10 place-items-center rounded-lg border border-stone-200 dark:border-stone-700" aria-label="กลับ Admin dashboard" @click="goBack"><ArrowLeft class="h-5 w-5" /></button>
          <div><p class="text-sm font-black text-court-700 dark:text-court-300">Admin dashboard</p><h1 class="text-2xl font-black">ระบบสมาชิก</h1></div>
        </div>
        <div class="flex gap-2">
          <button class="inline-flex h-11 items-center gap-2 rounded-lg border border-stone-200 px-4 font-bold dark:border-stone-700" @click="load()"><RefreshCw class="h-4 w-4" />รีเฟรช</button>
          <button class="inline-flex h-11 items-center gap-2 rounded-lg bg-court-500 px-4 font-black text-white" @click="openCreate"><Plus class="h-4 w-4" />ลงทะเบียนสมาชิก</button>
        </div>
      </div>
    </header>
    <div class="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
      <label class="flex h-11 items-center gap-2 rounded-lg border border-stone-200 px-3 dark:border-stone-700"><Search class="h-4 w-4" /><input v-model="state.search" class="min-w-0 flex-1 bg-transparent outline-none" placeholder="ค้นหาชื่อ เบอร์ หรืออีเมล" /></label>
      <p v-if="state.error" class="mt-3 rounded-lg bg-red-50 p-3 font-bold text-red-700 dark:bg-red-950/40 dark:text-red-200">{{ state.error }}</p>
      <div class="mt-4 overflow-x-auto">
        <table class="w-full min-w-[760px] text-sm"><thead><tr class="bg-paper-100 text-left dark:bg-stone-800"><th class="p-3">ชื่อ</th><th class="p-3">เบอร์</th><th class="p-3">อีเมล</th><th class="p-3">ประเภท</th><th class="p-3">สถานะ</th><th class="p-3 text-right">จัดการ</th></tr></thead>
          <tbody><tr v-for="item in state.items" :key="item.id" class="border-b border-stone-100 dark:border-stone-800"><td class="p-3 font-black">{{ item.name }}</td><td class="p-3">{{ item.phone }}</td><td class="p-3">{{ item.email || '-' }}</td><td class="p-3">{{ item.memberType === 'club' ? 'สมาชิกชมรม' : 'สมาชิกทั่วไป' }}</td><td class="p-3"><span class="rounded-full px-2 py-1 text-xs font-black" :class="item.active ? 'bg-green-100 text-green-700' : 'bg-stone-200 text-stone-600'">{{ item.active ? 'ใช้งาน' : 'ปิดใช้งาน' }}</span></td><td class="p-3"><div class="flex justify-end gap-2"><button class="inline-flex h-9 items-center gap-1 rounded-lg border border-stone-200 px-2 font-bold dark:border-stone-700" @click="openDetail(item)"><Eye class="h-4 w-4" />ดูข้อมูล</button><button class="grid h-9 w-9 place-items-center rounded-lg border border-stone-200 dark:border-stone-700" aria-label="แก้ไข" @click="openEdit(item)"><Pencil class="h-4 w-4" /></button><button class="grid h-9 w-9 place-items-center rounded-lg border border-red-200 text-red-700" aria-label="ลบ" @click="confirmDelete=item"><Trash2 class="h-4 w-4" /></button></div></td></tr></tbody>
        </table>
        <p v-if="!state.loading && !state.items.length" class="p-8 text-center text-stone-500"><Users class="mx-auto mb-2 h-8 w-8" />ยังไม่มีสมาชิก</p>
      </div>
      <div class="mt-4 flex items-center justify-between"><button class="rounded-lg border px-3 py-2 disabled:opacity-40" :disabled="state.page<=1" @click="load(state.page-1)">ก่อนหน้า</button><span class="font-bold">หน้า {{ state.page }} / {{ totalPages }}</span><button class="rounded-lg border px-3 py-2 disabled:opacity-40" :disabled="state.page>=totalPages" @click="load(state.page+1)">ถัดไป</button></div>
    </div>
    <div v-if="detail" class="fixed inset-0 z-50 grid place-items-end bg-black/50 p-3 sm:place-items-center" @click.self="detail=null">
      <div class="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-xl bg-white p-4 dark:bg-stone-900">
        <div class="flex items-start justify-between gap-3"><div><p class="text-sm font-black text-court-700">ข้อมูลสมาชิก</p><h2 class="text-2xl font-black">{{ detail.member.name }}</h2></div><button aria-label="ปิด" @click="detail=null"><X class="h-5 w-5" /></button></div>
        <div class="mt-4 grid gap-3 rounded-lg bg-paper-100 p-4 dark:bg-stone-800 sm:grid-cols-2 lg:grid-cols-4"><div><small class="font-bold text-stone-500">เบอร์โทร</small><p class="font-black">{{ detail.member.phone }}</p></div><div><small class="font-bold text-stone-500">อีเมล</small><p class="break-all font-black">{{ detail.member.email || '-' }}</p></div><div><small class="font-bold text-stone-500">ประเภท</small><p class="font-black">{{ detail.member.memberType==='club'?'สมาชิกชมรม':'สมาชิกทั่วไป' }}</p></div><div><small class="font-bold text-stone-500">สถานะ</small><p class="font-black">{{ detail.member.active?'ใช้งาน':'ปิดใช้งาน' }} · {{ detail.member.linked?'เชื่อม Google แล้ว':'ยังไม่เชื่อม Google' }}</p></div></div>
        <div class="mt-4 grid gap-4 lg:grid-cols-2">
          <section class="rounded-lg border p-3"><h3 class="flex items-center gap-2 font-black"><CalendarDays class="h-4 w-4" />ประวัติจองสนาม</h3><div class="mt-2 grid gap-2"><article v-for="booking in detail.bookings" :key="booking.id" class="rounded-lg bg-paper-100 p-3 dark:bg-stone-800"><div class="flex justify-between gap-2"><b>{{ booking.courtName }}</b><b class="text-court-700">{{ statusText(booking.status) }}</b></div><p class="text-sm text-stone-500">{{ new Date(booking.startAt).toLocaleString('th-TH') }} · ฿{{ booking.totalPriceThb }}</p></article><p v-if="!detail.bookings.length" class="text-sm text-stone-500">ยังไม่มีประวัติการจอง</p></div></section>
          <section class="rounded-lg border p-3"><h3 class="flex items-center gap-2 font-black"><CreditCard class="h-4 w-4" />Payment log</h3><div class="mt-2 grid gap-2"><article v-for="payment in detail.payments" :key="`${payment.kind}-${payment.id}-${payment.createdAt}`" class="rounded-lg bg-paper-100 p-3 dark:bg-stone-800"><div class="flex justify-between"><b>{{ payment.kind==='booking'?'ค่าจองสนาม':'ค่า Match' }}</b><b>฿{{ payment.amountThb }}</b></div><p class="text-sm text-stone-500">{{ statusText(payment.status) }} · {{ payment.createdAt }}</p></article><p v-if="!detail.payments.length" class="text-sm text-stone-500">ยังไม่มี Payment log</p></div></section>
          <section class="rounded-lg border p-3 lg:col-span-2"><h3 class="flex items-center gap-2 font-black"><History class="h-4 w-4" />Match history</h3><div class="mt-2 grid gap-2 sm:grid-cols-2"><article v-for="match in detail.matches" :key="`${match.sessionName}-${match.matchId}`" class="rounded-lg bg-paper-100 p-3 dark:bg-stone-800"><div class="flex justify-between"><b>{{ match.sessionName }} · เกม {{ match.matchId }}</b><b>{{ match.court }}</b></div><p class="text-sm text-stone-500">{{ match.startedAt }} - {{ match.endedAt }} · {{ match.status }}</p></article><p v-if="!detail.matches.length" class="text-sm text-stone-500">ยังไม่มี Match history</p></div></section>
        </div>
        <div class="mt-4 grid grid-cols-2 gap-2"><button class="h-11 rounded-lg border font-bold" @click="detail=null">ปิด</button><button class="h-11 rounded-lg bg-court-500 font-black text-white" @click="editFromDetail">แก้ไขข้อมูล</button></div>
      </div>
    </div>
    <div v-if="modal" class="fixed inset-0 z-50 grid place-items-end bg-black/50 p-3 sm:place-items-center" @click.self="modal=null"><form class="w-full max-w-md rounded-xl bg-white p-4 dark:bg-stone-900" @submit.prevent="save"><div class="flex justify-between"><h2 class="text-xl font-black">{{ modal.id ? 'แก้ไขสมาชิก' : 'ลงทะเบียนสมาชิก' }}</h2><button type="button" @click="modal=null"><X class="h-5 w-5" /></button></div><div class="mt-4 grid gap-3"><label class="grid gap-1 text-sm font-bold">ชื่อ<input v-model="modal.name" required class="h-11 rounded-lg border bg-transparent px-3" /></label><label class="grid gap-1 text-sm font-bold">เบอร์โทร<input v-model="modal.phone" required inputmode="tel" class="h-11 rounded-lg border bg-transparent px-3" /></label><label class="grid gap-1 text-sm font-bold">ประเภท<select v-model="modal.memberType" class="h-11 rounded-lg border bg-transparent px-3"><option value="general">สมาชิกทั่วไป</option><option value="club">สมาชิกชมรม</option></select></label><label v-if="modal.id" class="flex items-center gap-2 font-bold"><input v-model="modal.active" type="checkbox" />เปิดใช้งาน</label><button class="h-11 rounded-lg bg-court-500 font-black text-white">บันทึก</button></div></form></div>
    <div v-if="confirmDelete" class="fixed inset-0 z-50 grid place-items-center bg-black/50 p-3"><div class="w-full max-w-sm rounded-xl bg-white p-4 dark:bg-stone-900"><h2 class="text-xl font-black">ยืนยันการลบ</h2><p class="mt-2">ลบ {{ confirmDelete.name }}? หากมีประวัติ ระบบจะปิดใช้งานแทน</p><div class="mt-4 grid grid-cols-2 gap-2"><button class="h-11 rounded-lg border" @click="confirmDelete=null">ยกเลิก</button><button class="h-11 rounded-lg bg-red-600 font-black text-white" @click="remove">ยืนยัน</button></div></div></div>
  </section>
</template>
