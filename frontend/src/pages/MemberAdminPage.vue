<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ArrowLeft, CalendarDays, CreditCard, Download, Eye, History, Pencil, Plus, RefreshCw, Trash2, Users, X } from '@lucide/vue'
import { statusText } from '../statusDefinitions'
import { exportMembersAdminExcel } from '../adminExcelExport'

const props = defineProps(['apiRequest', 'auth', 'showToast'])
const state = reactive({ items: [], total: 0, page: 1, pageSize: 20, search: '', loading: false, error: '' })
const modal = ref(null)
const detail = ref(null)
const detailPages = reactive({ bookings: 1, payments: 1, matches: 1, pageSize: 6 })
const confirmDelete = ref(null)
const exportLoading = ref(false)
const reportModal = ref(false)
const reportData = ref(null)
const reportForm = reactive({ reportType: 'members', memberId: '' })
const manager = reactive({ open: false, items: [], total: 0, page: 1, pageSize: 50, search: '', memberType: '', loading: false, saving: false, error: '' })
const managerChanges = reactive({})
const memberTypes = ref([])
const typeManager = reactive({ open: false, name: '', loading: false, saving: false, error: '', editingId: '' })
let searchTimer
let managerSearchTimer
const totalPages = computed(() => Math.max(1, Math.ceil(state.total / state.pageSize)))
const reportNeedsMember = computed(() => reportForm.reportType !== 'members')
const paymentStatusText = (payment) => payment.kind === 'match' && payment.status === 'unpaid'
  ? 'ยกเลิกการชำระเงิน'
  : statusText(payment.status)
const paymentStatusClass = (payment) => payment.kind === 'match' && payment.status === 'unpaid'
  ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
  : 'bg-court-500/10 text-court-700 dark:text-court-300'

async function load(page = state.page) {
  state.loading = true; state.error = ''
  try {
    const params = new URLSearchParams({ page, pageSize: state.pageSize, search: state.search })
    const data = await props.apiRequest(`/api/admin/members?${params}`)
    Object.assign(state, { items: data.items || [], total: data.total || 0, page: data.page || page })
  } catch (error) { state.error = error.message } finally { state.loading = false }
}
async function loadManager(page = manager.page) {
  manager.loading = true; manager.error = ''
  try {
    const params = new URLSearchParams({ page, pageSize: manager.pageSize, search: manager.search, memberType: manager.memberType })
    const data = await props.apiRequest(`/api/admin/members?${params}`)
    manager.items = (data.items || []).map((item) => ({ ...item, selectedTypeId: managerChanges[item.id] ?? item.memberTypeId }))
    manager.total = Number(data.total || 0); manager.page = Number(data.page || page)
  } catch (error) { manager.error = error.message } finally { manager.loading = false }
}
function openManager() {
  Object.keys(managerChanges).forEach((key) => delete managerChanges[key])
  Object.assign(manager, { open: true, page: 1, search: '', memberType: '', error: '' })
  loadManager(1)
}
function setManagerMembership(item) { managerChanges[item.id] = item.selectedTypeId }
function closeManager() { if (!manager.saving) manager.open = false }
async function saveManager() {
  manager.saving = true; manager.error = ''
  try {
    const updates = Object.entries(managerChanges).map(([id, memberTypeId]) => ({ id, memberTypeId }))
    await props.apiRequest('/api/admin/members/bulk-membership', { method: 'PUT', body: JSON.stringify({ updates }) })
    manager.open = false
    if (props.showToast) props.showToast('บันทึกประเภทสมาชิกแล้ว', 'success')
    await load(1)
  } catch (error) { manager.error = error.message || 'บันทึกไม่สำเร็จ' } finally { manager.saving = false }
}
const defaultMemberTypeId = () => memberTypes.value.find((item) => item.code === 'general')?.id || memberTypes.value.find((item) => item.active)?.id || ''
function openCreate() { modal.value = { id: '', name: '', phone: '', memberTypeId: defaultMemberTypeId(), active: true } }
function openEdit(item) { modal.value = { ...item } }
function goBack() { window.location.assign('/') }
async function openDetail(item) {
  Object.assign(detailPages, { bookings: 1, payments: 1, matches: 1 })
  state.error = ''
  try { detail.value = await props.apiRequest(`/api/admin/members/${item.id}?bookingPage=1&paymentPage=1&matchPage=1&pageSize=${detailPages.pageSize}`) }
  catch (error) { state.error = error.message }
}
function detailTotalPages(section) {
  const meta = detail.value?.pagination?.[section]
  return Math.max(1, Math.ceil(Number(meta?.total || 0) / Number(meta?.pageSize || detailPages.pageSize)))
}
async function loadDetailPage(section, page) {
  if (!detail.value?.member?.id) return
  detailPages[section] = Math.max(1, Number(page) || 1)
  const params = new URLSearchParams({
    bookingPage: detailPages.bookings,
    paymentPage: detailPages.payments,
    matchPage: detailPages.matches,
    pageSize: detailPages.pageSize
  })
  state.error = ''
  try { detail.value = await props.apiRequest(`/api/admin/members/${detail.value.member.id}?${params}`) }
  catch (error) { state.error = error.message }
}
function editFromDetail() { const member = detail.value?.member; detail.value = null; if (member) openEdit(member) }
async function save() {
  const item = modal.value
  state.error = ''
  try {
    await props.apiRequest(item.id ? `/api/admin/members/${item.id}` : '/api/admin/members', {
      method: item.id ? 'PATCH' : 'POST', body: JSON.stringify(item)
    })
    modal.value = null; await load(1)
  } catch (error) {
    const message = error.message || 'ไม่สามารถบันทึกสมาชิกได้'
    if (props.showToast) props.showToast(message, 'error')
    else state.error = message
  }
}
async function loadMemberTypes() {
  const data = await props.apiRequest('/api/admin/member-types')
  memberTypes.value = data.items || []
}
function openTypeManager() { Object.assign(typeManager, { open: true, name: '', editingId: '', error: '' }); loadMemberTypes() }
async function createMemberType() {
  const name = typeManager.name.trim(); if (!name || typeManager.saving) return
  typeManager.saving = true; typeManager.error = ''
  try { const data = await props.apiRequest('/api/admin/member-types', { method: 'POST', body: JSON.stringify({ name }) }); memberTypes.value = data.items || []; typeManager.name = ''; props.showToast?.('เพิ่มประเภทสมาชิกแล้ว', 'success') }
  catch (error) { typeManager.error = error.message }
  finally { typeManager.saving = false }
}
async function updateMemberType(item, patch) {
  typeManager.saving = true; typeManager.error = ''
  try { const data = await props.apiRequest(`/api/admin/member-types/${item.id}`, { method: 'PATCH', body: JSON.stringify(patch) }); memberTypes.value = data.items || []; typeManager.editingId = ''; props.showToast?.('บันทึกประเภทสมาชิกแล้ว', 'success') }
  catch (error) { typeManager.error = error.message }
  finally { typeManager.saving = false }
}
async function deleteMemberType(item) {
  if (typeManager.saving) return
  typeManager.saving = true; typeManager.error = ''
  try { const data = await props.apiRequest(`/api/admin/member-types/${item.id}`, { method: 'DELETE' }); memberTypes.value = data.items || []; props.showToast?.(data.mode === 'soft' ? 'ซ่อนประเภทและเก็บประวัติแล้ว' : 'ลบประเภทสมาชิกแล้ว', 'success') }
  catch (error) { typeManager.error = error.message }
  finally { typeManager.saving = false }
}
async function remove() {
  try { await props.apiRequest(`/api/admin/members/${confirmDelete.value.id}`, { method: 'DELETE' }); confirmDelete.value = null; await load(1) }
  catch (error) { state.error = error.message }
}
async function openReportModal() {
  exportLoading.value = true
  state.error = ''
  try {
    reportData.value = await props.apiRequest('/api/admin/members/export')
    Object.assign(reportForm, { reportType: 'members', memberId: '' })
    reportModal.value = true
  }
  catch (error) { state.error = error.message }
  finally { exportLoading.value = false }
}
async function downloadMemberReport() {
  if (reportNeedsMember.value && !reportForm.memberId) {
    state.error = 'กรุณาเลือกสมาชิก'
    return
  }
  exportLoading.value = true
  state.error = ''
  try {
    await exportMembersAdminExcel(props.apiRequest, { ...reportForm }, reportData.value)
    reportModal.value = false
  }
  catch (error) { state.error = error.message }
  finally { exportLoading.value = false }
}
watch(() => state.search, () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => load(1), 300) })
watch(() => [manager.search, manager.memberType], () => { if (!manager.open) return; clearTimeout(managerSearchTimer); managerSearchTimer = setTimeout(() => loadManager(1), 300) })
onMounted(() => { load(1); loadMemberTypes() })
onUnmounted(() => { clearTimeout(searchTimer); clearTimeout(managerSearchTimer) })
</script>

<template>
  <section class="mx-auto grid min-w-0 max-w-6xl gap-4 overflow-x-hidden p-3 text-stone-900 dark:text-stone-100 sm:p-4">
    <header class="lm-hero-bg overflow-hidden rounded-xl border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-5">
      <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <button class="grid h-10 w-10 place-items-center rounded-lg border border-stone-200 dark:border-stone-700" aria-label="กลับ Admin dashboard" @click="goBack"><ArrowLeft class="h-5 w-5" /></button>
          <img
            v-if="auth?.branding?.logoData"
            :src="auth.branding.logoData"
            alt="โลโก้ระบบ"
            class="h-10 w-10 rounded-lg border border-stone-200 bg-white object-cover dark:border-stone-700"
          />
          <div><p class="text-sm font-black text-court-700 dark:text-court-300">{{ auth?.branding?.systemName || 'LiveMatch' }} · แดชบอร์ดผู้ดูแล</p><h1 class="text-2xl font-black">ระบบสมาชิก</h1></div>
        </div>
        <div class="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <button class="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-stone-200 bg-white/70 px-4 font-bold transition hover:border-court-400 hover:text-court-700 dark:border-stone-700 dark:bg-stone-900/70 dark:hover:text-court-300" @click="load()"><RefreshCw class="h-4 w-4" :class="state.loading ? 'animate-spin' : ''" />รีเฟรช</button>
          <button class="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-stone-200 bg-white/70 px-4 font-bold transition hover:border-court-400 hover:text-court-700 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900/70 dark:hover:text-court-300" :disabled="exportLoading" @click="openReportModal"><Download class="h-4 w-4" />{{ exportLoading ? 'กำลังโหลด...' : 'รายงาน' }}</button>
          <button class="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-court-200 bg-court-500/10 px-4 font-black text-court-700 dark:border-court-900 dark:text-court-300" @click="openManager"><Users class="h-4 w-4" />จัดการสมาชิก</button>
          <button class="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-court-200 bg-court-500/10 px-4 font-black text-court-700 dark:border-court-900 dark:text-court-300" @click="openTypeManager"><Pencil class="h-4 w-4" />จัดการประเภท</button>
          <button class="col-span-2 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-court-500 px-4 font-black text-white shadow-soft transition hover:bg-court-600 sm:col-span-1" @click="openCreate"><Plus class="h-4 w-4" />ลงทะเบียนสมาชิก</button>
        </div>
      </div>
    </header>
    <input v-model="state.search" type="search" autocomplete="off" aria-label="ค้นหาสมาชิก" class="h-12 w-full rounded-lg border border-stone-200 bg-white px-4 text-base font-semibold outline-none transition placeholder:font-normal placeholder:text-stone-400 focus:border-court-500 focus:ring-2 focus:ring-court-500/10 dark:border-stone-700 dark:bg-stone-900 dark:focus:border-court-400" placeholder="ค้นหาชื่อ เบอร์โทร หรืออีเมล" />
    <section class="min-w-0 rounded-xl border border-stone-200 bg-white p-3 shadow-soft dark:border-stone-700 dark:bg-stone-900 sm:p-4">
      <div class="flex items-center justify-between gap-3 border-b border-stone-100 pb-3 dark:border-stone-800">
        <div><h2 class="text-lg font-black">รายชื่อสมาชิก</h2><p class="text-sm font-medium text-stone-500">จัดการข้อมูล สถานะ และดูประวัติสมาชิก</p></div>
        <Users class="h-6 w-6 shrink-0 text-court-600 dark:text-court-300" />
      </div>
      <p v-if="state.error" class="mt-3 rounded-lg bg-red-50 p-3 font-bold text-red-700 dark:bg-red-950/40 dark:text-red-200">{{ state.error }}</p>
      <div class="mt-4 hidden max-w-full overflow-x-auto md:block">
        <table class="w-full min-w-[760px] text-sm"><thead><tr class="bg-paper-100 text-left text-stone-600 dark:bg-stone-800 dark:text-stone-300"><th class="rounded-l-lg p-3">ชื่อ</th><th class="p-3">เบอร์</th><th class="p-3">อีเมล</th><th class="p-3">ประเภท</th><th class="p-3">สถานะ</th><th class="rounded-r-lg p-3 text-right">จัดการ</th></tr></thead>
          <tbody><tr v-for="item in state.items" :key="item.id" class="border-b border-stone-100 transition hover:bg-paper-50 dark:border-stone-800 dark:hover:bg-stone-800/60"><td class="p-3 font-black">{{ item.name }}</td><td class="p-3 font-semibold">{{ item.phone }}</td><td class="p-3 text-stone-500">{{ item.email || '-' }}</td><td class="p-3">{{ item.memberTypeName || (item.memberType === 'club' ? 'สมาชิกชมรม' : 'สมาชิกทั่วไป') }}</td><td class="p-3"><span class="rounded-full px-2 py-1 text-xs font-black" :class="item.active ? 'bg-green-100 text-green-700' : 'bg-stone-200 text-stone-600'">{{ item.active ? 'ใช้งาน' : 'ปิดใช้งาน' }}</span></td><td class="p-3"><div class="flex justify-end gap-2"><button class="inline-flex h-9 items-center gap-1 rounded-lg border border-stone-200 px-2 font-bold transition hover:border-court-400 hover:text-court-700 dark:border-stone-700 dark:hover:text-court-300" @click="openDetail(item)"><Eye class="h-4 w-4" />ดูข้อมูล</button><button class="grid h-9 w-9 place-items-center rounded-lg border border-stone-200 transition hover:border-court-400 hover:text-court-700 dark:border-stone-700 dark:hover:text-court-300" aria-label="แก้ไข" @click="openEdit(item)"><Pencil class="h-4 w-4" /></button><button class="grid h-9 w-9 place-items-center rounded-lg border border-red-200 text-red-700 transition hover:bg-red-50 dark:hover:bg-red-950/30" aria-label="ลบ" @click="confirmDelete=item"><Trash2 class="h-4 w-4" /></button></div></td></tr></tbody>
        </table>
        <p v-if="!state.loading && !state.items.length" class="p-8 text-center text-stone-500"><Users class="mx-auto mb-2 h-8 w-8" />ยังไม่มีสมาชิก</p>
      </div>
      <div class="mt-4 grid gap-3 md:hidden">
        <article v-for="item in state.items" :key="item.id" class="min-w-0 rounded-xl border border-stone-200 bg-paper-50/60 p-3 shadow-sm dark:border-stone-700 dark:bg-stone-800/50" data-i18n-ignore>
          <div class="flex min-w-0 items-start justify-between gap-3"><div class="min-w-0"><h2 class="truncate text-lg font-black">{{ item.name }}</h2><p class="break-all text-sm text-stone-500">{{ item.phone }} · {{ item.email || '-' }}</p></div><span class="shrink-0 rounded-full px-2 py-1 text-xs font-black" :class="item.active ? 'bg-green-100 text-green-700' : 'bg-stone-200 text-stone-600'">{{ item.active ? 'ใช้งาน' : 'ปิดใช้งาน' }}</span></div>
          <p class="mt-2 text-sm font-bold">{{ item.memberTypeName || (item.memberType === 'club' ? 'สมาชิกชมรม' : 'สมาชิกทั่วไป') }}</p>
          <div class="mt-3 grid grid-cols-[1fr_auto_auto] gap-2"><button class="inline-flex h-10 items-center justify-center gap-1 rounded-lg border font-bold dark:border-stone-700" @click="openDetail(item)"><Eye class="h-4 w-4" />ดูข้อมูล</button><button class="grid h-10 w-10 place-items-center rounded-lg border dark:border-stone-700" aria-label="แก้ไข" @click="openEdit(item)"><Pencil class="h-4 w-4" /></button><button class="grid h-10 w-10 place-items-center rounded-lg border border-red-200 text-red-700" aria-label="ลบ" @click="confirmDelete=item"><Trash2 class="h-4 w-4" /></button></div>
        </article>
        <p v-if="!state.loading && !state.items.length" class="p-8 text-center text-stone-500"><Users class="mx-auto mb-2 h-8 w-8" />ยังไม่มีสมาชิก</p>
      </div>
      <div class="mt-4 flex items-center justify-between rounded-lg bg-paper-100 p-2 dark:bg-stone-800"><button class="rounded-lg border border-stone-200 bg-white px-3 py-2 font-bold disabled:opacity-40 dark:border-stone-700 dark:bg-stone-900" :disabled="state.page<=1" @click="load(state.page-1)">ก่อนหน้า</button><span class="text-sm font-black">หน้า {{ state.page }} / {{ totalPages }}</span><button class="rounded-lg border border-stone-200 bg-white px-3 py-2 font-bold disabled:opacity-40 dark:border-stone-700 dark:bg-stone-900" :disabled="state.page>=totalPages" @click="load(state.page+1)">ถัดไป</button></div>
    </section>
    <div v-if="manager.open" class="fixed inset-0 z-50 grid place-items-end bg-black/50 p-3 sm:place-items-center" role="dialog" aria-modal="true" aria-label="จัดการประเภทสมาชิก" @click.self="closeManager">
      <section class="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white dark:bg-stone-900">
        <header class="flex items-start justify-between gap-3 border-b p-4 dark:border-stone-700">
          <div><p class="text-sm font-black text-court-700">จัดการสมาชิก</p><h2 class="text-xl font-black">กำหนดประเภทสมาชิก</h2><p class="text-xs font-semibold text-stone-500">เลือกประเภทได้ทีละคน และเก็บการแก้ไขข้ามหน้าไว้จนกดบันทึก</p></div>
          <button class="grid h-10 w-10 place-items-center rounded-lg border dark:border-stone-700" aria-label="ปิด" @click="closeManager"><X class="h-5 w-5" /></button>
        </header>
        <div class="grid gap-2 border-b p-3 dark:border-stone-700 sm:grid-cols-[1fr_13rem]">
          <input v-model="manager.search" type="search" class="h-11 rounded-lg border bg-transparent px-3" placeholder="ค้นหาชื่อ เบอร์โทร หรืออีเมล" />
          <select v-model="manager.memberType" class="h-11 rounded-lg border bg-transparent px-3"><option value="">ทุกประเภท</option><option v-for="type in memberTypes" :key="type.id" :value="type.id">{{ type.name }}</option></select>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-3">
          <p v-if="manager.error" class="mb-3 rounded-lg bg-red-50 p-3 font-bold text-red-700">{{ manager.error }}</p>
          <label v-for="item in manager.items" :key="item.id" class="mb-2 grid min-h-14 gap-2 rounded-lg border p-3 dark:border-stone-700 sm:grid-cols-[1fr_14rem] sm:items-center">
            <span class="min-w-0"><b class="block truncate">{{ item.name }}</b><small class="block truncate text-stone-500">{{ item.phone }} · {{ item.email || '-' }}</small></span>
            <select v-model="item.selectedTypeId" class="h-10 min-w-0 rounded-lg border bg-transparent px-2 font-bold" @change="setManagerMembership(item)"><option v-for="type in memberTypes.filter(type => type.active || type.id === item.selectedTypeId)" :key="type.id" :value="type.id">{{ type.name }}</option></select>
          </label>
          <p v-if="!manager.loading && !manager.items.length" class="p-8 text-center text-stone-500">ไม่พบรายชื่อ</p>
        </div>
        <div class="flex items-center justify-between gap-2 border-t p-3 dark:border-stone-700">
          <button class="rounded-lg border px-3 py-2 font-bold disabled:opacity-40" :disabled="manager.page <= 1" @click="loadManager(manager.page-1)">ก่อนหน้า</button>
          <span class="text-sm font-black">หน้า {{ manager.page }} / {{ Math.max(1, Math.ceil(manager.total/manager.pageSize)) }} · {{ manager.total }} คน</span>
          <button class="rounded-lg border px-3 py-2 font-bold disabled:opacity-40" :disabled="manager.page >= Math.ceil(manager.total/manager.pageSize)" @click="loadManager(manager.page+1)">ถัดไป</button>
        </div>
        <footer class="grid grid-cols-2 gap-2 border-t p-3 dark:border-stone-700"><button class="h-11 rounded-lg border font-bold" :disabled="manager.saving" @click="closeManager">ยกเลิก</button><button class="h-11 rounded-lg bg-court-500 font-black text-white disabled:opacity-50" :disabled="manager.saving" @click="saveManager">{{ manager.saving ? 'กำลังบันทึก...' : 'บันทึก' }}</button></footer>
      </section>
    </div>
    <div v-if="detail" class="fixed inset-0 z-50 grid place-items-end bg-black/50 p-3 sm:place-items-center" role="dialog" aria-modal="true" aria-labelledby="member-detail-title" @click.self="detail=null" @keydown.esc="detail=null">
      <div class="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-xl bg-white p-4 dark:bg-stone-900" tabindex="-1">
        <div class="flex items-start justify-between gap-3"><div><p class="text-sm font-black text-court-700">ข้อมูลสมาชิก</p><h2 id="member-detail-title" class="text-2xl font-black" data-i18n-ignore>{{ detail.member.name }}</h2></div><button aria-label="ปิด" @click="detail=null"><X class="h-5 w-5" /></button></div>
        <div class="mt-4 grid gap-3 rounded-lg bg-paper-100 p-4 dark:bg-stone-800 sm:grid-cols-2 lg:grid-cols-4"><div><small class="font-bold text-stone-500">เบอร์โทร</small><p class="font-black">{{ detail.member.phone }}</p></div><div><small class="font-bold text-stone-500">อีเมล</small><p class="break-all font-black">{{ detail.member.email || '-' }}</p></div><div><small class="font-bold text-stone-500">ประเภท</small><p class="font-black">{{ detail.member.memberTypeName || (detail.member.memberType==='club'?'สมาชิกชมรม':'สมาชิกทั่วไป') }}</p></div><div><small class="font-bold text-stone-500">สถานะ</small><p class="font-black">{{ detail.member.active?'ใช้งาน':'ปิดใช้งาน' }} · {{ detail.member.linked?'เชื่อม Google แล้ว':'ยังไม่เชื่อม Google' }}</p></div></div>
        <div class="mt-4 grid gap-4 lg:grid-cols-2">
          <section class="rounded-lg border p-3"><h3 class="flex items-center gap-2 font-black"><CalendarDays class="h-4 w-4" />ประวัติจองสนาม</h3><div class="mt-2 grid gap-2"><article v-for="booking in detail.bookings" :key="booking.id" class="rounded-lg bg-paper-100 p-3 dark:bg-stone-800"><div class="flex justify-between gap-2"><b>{{ booking.courtName }}</b><b class="text-court-700">{{ statusText(booking.status) }}</b></div><p class="text-sm text-stone-500">{{ new Date(booking.startAt).toLocaleString('th-TH') }} · ฿{{ booking.totalPriceThb }}</p></article><p v-if="!detail.bookings.length" class="text-sm text-stone-500">ยังไม่มีประวัติการจอง</p></div><div v-if="detail.pagination?.bookings?.total > detailPages.pageSize" class="mt-3 flex items-center justify-between gap-2 text-xs font-bold"><button class="rounded border px-2 py-1 disabled:opacity-40" :disabled="detailPages.bookings<=1" @click="loadDetailPage('bookings',detailPages.bookings-1)">ก่อนหน้า</button><span>{{ detailPages.bookings }} / {{ detailTotalPages('bookings') }}</span><button class="rounded border px-2 py-1 disabled:opacity-40" :disabled="detailPages.bookings>=detailTotalPages('bookings')" @click="loadDetailPage('bookings',detailPages.bookings+1)">ถัดไป</button></div></section>
          <section class="rounded-lg border p-3"><h3 class="flex items-center gap-2 font-black"><CreditCard class="h-4 w-4" />ประวัติการชำระเงิน</h3><div class="mt-2 grid gap-2"><article v-for="payment in detail.payments" :key="`${payment.kind}-${payment.id}-${payment.createdAt}`" class="rounded-lg bg-paper-100 p-3 dark:bg-stone-800"><div class="flex justify-between gap-3"><b class="min-w-0 truncate">{{ payment.kind==='booking'?'ค่าจองสนาม':payment.kind==='pos'?`สินค้า POS · ${payment.id}`:`ค่าแข่งขัน · ${payment.sessionName || '-'}` }}</b><b class="shrink-0">฿{{ payment.amountThb }}</b></div><div class="mt-2 flex flex-wrap items-center gap-2"><span class="rounded-md px-2 py-1 text-xs font-black" :class="paymentStatusClass(payment)">{{ paymentStatusText(payment) }}</span><span class="text-xs font-semibold text-stone-500">{{ payment.createdAt }}</span></div></article><p v-if="!detail.payments.length" class="text-sm text-stone-500">ยังไม่มีประวัติการชำระเงิน</p></div><div v-if="detail.pagination?.payments?.total > detailPages.pageSize" class="mt-3 flex items-center justify-between gap-2 text-xs font-bold"><button class="rounded border px-2 py-1 disabled:opacity-40" :disabled="detailPages.payments<=1" @click="loadDetailPage('payments',detailPages.payments-1)">ก่อนหน้า</button><span>{{ detailPages.payments }} / {{ detailTotalPages('payments') }}</span><button class="rounded border px-2 py-1 disabled:opacity-40" :disabled="detailPages.payments>=detailTotalPages('payments')" @click="loadDetailPage('payments',detailPages.payments+1)">ถัดไป</button></div></section>
          <section class="rounded-lg border p-3 lg:col-span-2"><h3 class="flex items-center gap-2 font-black"><History class="h-4 w-4" />ประวัติการแข่งขัน</h3><div class="mt-2 grid gap-2 sm:grid-cols-2"><article v-for="match in detail.matches" :key="`${match.sessionName}-${match.matchId}`" class="rounded-lg bg-paper-100 p-3 dark:bg-stone-800" data-i18n-ignore><div class="flex justify-between"><b>{{ match.sessionName }} · เกม {{ match.matchId }}</b><b>{{ match.court }}</b></div><p class="text-sm text-stone-500">{{ match.startedAt }} - {{ match.endedAt }} · {{ statusText(match.status) }}</p></article><p v-if="!detail.matches.length" class="text-sm text-stone-500">ยังไม่มีประวัติการแข่งขัน</p></div><div v-if="detail.pagination?.matches?.total > detailPages.pageSize" class="mt-3 flex items-center justify-between gap-2 text-xs font-bold"><button class="rounded border px-2 py-1 disabled:opacity-40" :disabled="detailPages.matches<=1" @click="loadDetailPage('matches',detailPages.matches-1)">ก่อนหน้า</button><span>{{ detailPages.matches }} / {{ detailTotalPages('matches') }}</span><button class="rounded border px-2 py-1 disabled:opacity-40" :disabled="detailPages.matches>=detailTotalPages('matches')" @click="loadDetailPage('matches',detailPages.matches+1)">ถัดไป</button></div></section>
        </div>
        <div class="mt-4 grid grid-cols-2 gap-2"><button class="h-11 rounded-lg border font-bold" @click="detail=null">ปิด</button><button class="h-11 rounded-lg bg-court-500 font-black text-white" @click="editFromDetail">แก้ไขข้อมูล</button></div>
      </div>
    </div>
    <div
      v-if="reportModal"
      class="fixed inset-0 z-50 grid place-items-end bg-black/50 p-3 sm:place-items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="member-report-title"
      @click.self="reportModal=false"
      @keydown.esc="reportModal=false"
    >
      <form class="w-full max-w-md rounded-xl bg-white p-4 dark:bg-stone-900" @submit.prevent="downloadMemberReport">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-black text-court-700 dark:text-court-300">ระบบสมาชิก</p>
            <h2 id="member-report-title" class="text-xl font-black">สร้างรายงาน</h2>
          </div>
          <button type="button" class="grid h-9 w-9 place-items-center rounded-lg border dark:border-stone-700" aria-label="ปิดหน้ารายงาน" @click="reportModal=false"><X class="h-5 w-5" /></button>
        </div>
        <div class="mt-4 grid gap-3">
          <label class="grid gap-1 text-sm font-bold">
            ประเภทรายงาน
            <select v-model="reportForm.reportType" class="h-11 rounded-lg border bg-transparent px-3" @change="reportForm.memberId=''">
              <option value="members">รายชื่อสมาชิกทั้งหมด</option>
              <option value="bookings">รายละเอียดการจอง</option>
              <option value="payments">การชำระเงิน</option>
              <option value="matches">ประวัติ Match</option>
            </select>
          </label>
          <label v-if="reportNeedsMember" class="grid gap-1 text-sm font-bold">
            ชื่อสมาชิก
            <select v-model="reportForm.memberId" required class="h-11 rounded-lg border bg-transparent px-3">
              <option value="" disabled>เลือกสมาชิก</option>
              <option v-for="member in reportData?.members || []" :key="member.id" :value="member.id">
                {{ member.name }} · {{ member.phone }}
              </option>
            </select>
          </label>
          <p v-if="reportNeedsMember" class="text-sm text-stone-500">รายงานจะแสดงเฉพาะข้อมูลของสมาชิกที่เลือก</p>
          <p v-if="state.error" class="rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700 dark:bg-red-950/40 dark:text-red-200">{{ state.error }}</p>
          <button class="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-court-500 font-black text-white" :disabled="exportLoading">
            <Download class="h-4 w-4" />{{ exportLoading ? 'กำลังสร้างไฟล์...' : 'ดาวน์โหลดรายงาน' }}
          </button>
        </div>
      </form>
    </div>
    <div v-if="modal" class="fixed inset-0 z-50 grid place-items-end bg-black/50 p-3 sm:place-items-center" @click.self="modal=null"><form class="w-full max-w-md rounded-xl bg-white p-4 dark:bg-stone-900" @submit.prevent="save"><div class="flex justify-between"><h2 class="text-xl font-black">{{ modal.id ? 'แก้ไขสมาชิก' : 'ลงทะเบียนสมาชิก' }}</h2><button type="button" @click="modal=null"><X class="h-5 w-5" /></button></div><div class="mt-4 grid gap-3"><label class="grid gap-1 text-sm font-bold">ชื่อ<input v-model="modal.name" required class="h-11 rounded-lg border bg-transparent px-3" /></label><label class="grid gap-1 text-sm font-bold">เบอร์โทร<input v-model="modal.phone" required inputmode="tel" class="h-11 rounded-lg border bg-transparent px-3" /></label><label class="grid gap-1 text-sm font-bold">ประเภท<select v-model="modal.memberTypeId" required class="h-11 rounded-lg border bg-transparent px-3"><option v-for="type in memberTypes.filter(type => type.active || type.id === modal.memberTypeId)" :key="type.id" :value="type.id">{{ type.name }}</option></select></label><label v-if="modal.id" class="flex items-center gap-2 font-bold"><input v-model="modal.active" type="checkbox" />เปิดใช้งาน</label><button class="h-11 rounded-lg bg-court-500 font-black text-white">บันทึก</button></div></form></div>
    <div v-if="typeManager.open" class="fixed inset-0 z-[60] grid place-items-end bg-black/50 p-3 sm:place-items-center" @click.self="typeManager.open=false"><section class="max-h-[90dvh] w-full max-w-xl overflow-auto rounded-xl bg-white p-4 dark:bg-stone-900"><div class="flex items-start justify-between gap-3"><div><p class="text-sm font-black text-court-700">ระบบสมาชิก</p><h2 class="text-xl font-black">จัดการประเภทสมาชิก</h2></div><button class="grid h-9 w-9 place-items-center rounded-lg border" @click="typeManager.open=false"><X class="h-5 w-5" /></button></div><form class="mt-4 flex gap-2" @submit.prevent="createMemberType"><input v-model="typeManager.name" required maxlength="80" class="h-11 min-w-0 flex-1 rounded-lg border bg-transparent px-3" placeholder="ชื่อประเภทใหม่" /><button class="h-11 rounded-lg bg-court-500 px-4 font-black text-white disabled:opacity-50" :disabled="typeManager.saving">เพิ่ม</button></form><p v-if="typeManager.error" class="mt-3 rounded-lg bg-red-50 p-3 font-bold text-red-700">{{ typeManager.error }}</p><div class="mt-4 grid gap-2"><article v-for="type in memberTypes" :key="type.id" class="rounded-lg border p-3 dark:border-stone-700"><div class="flex flex-wrap items-center gap-2"><input v-if="typeManager.editingId===type.id" v-model="type.name" class="h-10 min-w-0 flex-1 rounded-lg border bg-transparent px-2" /><b v-else class="min-w-0 flex-1 truncate">{{ type.name }}</b><span v-if="type.system" class="rounded bg-court-500/10 px-2 py-1 text-xs font-black text-court-700">ประเภทหลัก</span><button v-if="typeManager.editingId===type.id" class="rounded-lg border px-3 py-2 font-bold" @click="updateMemberType(type,{name:type.name})">บันทึก</button><button v-else class="rounded-lg border px-3 py-2 font-bold disabled:opacity-40" :disabled="type.inUse && !type.system" @click="typeManager.editingId=type.id">แก้ชื่อ</button><button v-if="!type.system" class="rounded-lg border px-3 py-2 font-bold disabled:opacity-40" :disabled="type.inUse" @click="updateMemberType(type,{active:!type.active})">{{ type.active ? 'ปิดใช้' : 'เปิดใช้' }}</button><button v-if="!type.system" class="rounded-lg border border-red-200 px-3 py-2 font-bold text-red-700 disabled:opacity-40" :disabled="type.inUse" @click="deleteMemberType(type)">ลบ</button></div><p class="mt-1 text-xs font-semibold text-stone-500">{{ type.inUse ? 'มีสมาชิกใช้งานอยู่ จึงล็อกการจัดการ' : type.hasHistory ? 'มีประวัติการใช้งาน ลบแล้วจะซ่อนโดยไม่ทำลายประวัติ' : 'ยังไม่เคยถูกใช้งาน' }}</p></article></div></section></div>
    <div v-if="confirmDelete" class="fixed inset-0 z-50 grid place-items-center bg-black/50 p-3"><div class="w-full max-w-sm rounded-xl bg-white p-4 dark:bg-stone-900"><h2 class="text-xl font-black">ยืนยันการลบ</h2><p class="mt-2">ลบ {{ confirmDelete.name }}? หากมีประวัติ ระบบจะปิดใช้งานแทน</p><div class="mt-4 grid grid-cols-2 gap-2"><button class="h-11 rounded-lg border" @click="confirmDelete=null">ยกเลิก</button><button class="h-11 rounded-lg bg-red-600 font-black text-white" @click="remove">ยืนยัน</button></div></div></div>
  </section>
</template>
