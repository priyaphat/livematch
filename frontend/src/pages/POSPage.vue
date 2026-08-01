<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import QRCode from 'qrcode'
import {
  Archive, ArrowDown, BarChart3, Boxes, Home, LayoutDashboard, Minus, Pencil, Plus,
  ReceiptText, Save, Search, Settings, ShoppingCart, Trash2, X
} from '@lucide/vue'
import { setLanguage } from '../i18n'
import { persistTheme } from '../theme'

const props = defineProps(['apiRequest', 'auth'])
const state = reactive({
  enabled: false, products: [], categories: [], units: [], sales: [], customers: [], stockMovements: [], stockBatches: [],
  report: {}, settings: {}, loading: false, error: '', notice: ''
})
const tab = ref('dashboard')
const productSearch = ref('')
const stockSearch = ref('')
const stockFilter = ref('all')
const selectedCategory = ref('all')
const cart = ref([])
const buyer = ref('anonymous:')
const buyerSearch = ref('')
const buyerOpen = ref(false)
const paymentMethod = ref('cash')
const saving = ref(false)
const productModal = ref(null)
const stockModal = ref(null)
const catalogModal = ref(null)
const billing = ref(null)
const qrDataUrl = ref('')

const tabs = computed(() => [
  { id: 'dashboard', label: 'แดชบอร์ด', icon: LayoutDashboard },
  ...(state.enabled ? [{ id: 'sale', label: 'การขาย', icon: ShoppingCart }] : []),
  { id: 'orders', label: 'บิล', icon: ReceiptText },
  { id: 'products', label: 'สินค้า', icon: Boxes },
  { id: 'stock', label: 'สต็อก', icon: Archive },
  { id: 'report', label: 'รายงาน', icon: BarChart3 },
  { id: 'settings', label: 'ตั้งค่า', icon: Settings }
])
const categoryOptions = computed(() => [
  { id: 'all', name: 'สินค้าทั้งหมด' },
  { id: 'uncategorized', name: 'ไม่มีหมวดหมู่' },
  ...state.categories
])
const productsForCategory = computed(() => {
  const term = productSearch.value.trim().toLocaleLowerCase('th-TH')
  return state.products.filter((item) => {
    const categoryMatch = selectedCategory.value === 'all'
      || (selectedCategory.value === 'uncategorized' && !item.category)
      || item.category === selectedCategory.value
    return categoryMatch && (!term || `${item.name} ${item.sku}`.toLocaleLowerCase('th-TH').includes(term))
  })
})
const saleProducts = computed(() => productsForCategory.value.filter((item) => item.active))
const cartSubtotal = computed(() => cart.value.reduce((sum, item) => sum + item.priceThb * item.quantity, 0))
const taxAmount = computed(() => {
  const rate = Number(state.settings.taxRatePercent || 0)
  return rate > 0 && !state.settings.pricesIncludeTax ? Math.round(cartSubtotal.value * rate / 100) : 0
})
const cartTotal = computed(() => cartSubtotal.value + taxAmount.value)
const combinedTotal = computed(() => cartTotal.value + Number(billing.value?.totalThb || 0))
const selectedBuyer = computed(() => {
  const [kind, id] = buyer.value.split(':')
  return { kind, id, item: state.customers.find((item) => item.kind === kind && item.id === id) }
})
const buyerResults = computed(() => {
  const term = buyerSearch.value.trim().toLocaleLowerCase('th-TH')
  const digits = term.replace(/\D/g, '')
  if ((!digits && term.length < 2) || (digits && digits.length < 5)) return []
  return state.customers.filter((item) => {
    if (!['member', 'player'].includes(item.kind)) return false
    if (digits) return String(item.phone || '').replace(/\D/g, '').includes(digits)
    return String(item.name || '').toLocaleLowerCase('th-TH').includes(term)
  }).slice(0, 12)
})
const openSales = computed(() => state.sales.filter((sale) => sale.status === 'open'))
const historySales = computed(() => state.sales.filter((sale) => sale.status !== 'open'))
const lowStockProducts = computed(() => state.products.filter((item) => item.active && item.lowStock))
const filteredStockProducts = computed(() => {
  const term = stockSearch.value.trim().toLocaleLowerCase('th-TH')
  return state.products.filter((item) => {
    const matchesTerm = !term || `${item.name} ${item.sku} ${item.category}`.toLocaleLowerCase('th-TH').includes(term)
    const matchesFilter = stockFilter.value === 'all' || (stockFilter.value === 'low' && item.lowStock) || (stockFilter.value === 'out' && item.stockQuantity <= 0)
    return matchesTerm && matchesFilter
  })
})
const stockTotalUnits = computed(() => state.products.reduce((sum, item) => sum + Number(item.stockQuantity || 0), 0))
const stockValueTHB = computed(() => state.products.reduce((sum, item) => sum + Number(item.stockQuantity || 0) * Number(item.costThb || 0), 0))

function money(value) { return `฿${Number(value || 0).toLocaleString('th-TH')}` }
function goHome() { window.location.assign('/') }
function saleStatus(status) { return ({ open: 'ค้างชำระ', paid: 'ชำระแล้ว', void: 'ยกเลิก' })[status] || status }
function customerLabel(customer) {
  return customer.kind === 'player'
    ? `${customer.name} - ${customer.sessionName || 'Match วันนี้'}`
    : `${customer.name}${customer.phone ? ` · ${customer.phone}` : ''}`
}

async function load() {
  state.loading = true
  state.error = ''
  try {
    const data = await props.apiRequest('/api/admin/pos/overview')
    Object.assign(state, {
      enabled: Boolean(data.enabled), products: data.products || [], categories: data.categories || [], units: data.units || [],
      sales: data.sales || [], customers: data.customers || [], stockMovements: data.stockMovements || [], stockBatches: data.stockBatches || [],
      report: data.report || {}, settings: { theme: 'light', language: 'th', taxRatePercent: 0, pricesIncludeTax: true, ...(data.settings || {}) }
    })
    persistTheme(state.settings.theme)
    setLanguage(state.settings.language)
  } catch (error) { state.error = error.message || 'โหลดระบบ POS ไม่สำเร็จ' }
  finally { state.loading = false }
}

function chooseBuyer(customer) {
  buyer.value = `${customer.kind}:${customer.id}`
  buyerSearch.value = customerLabel(customer)
  buyerOpen.value = false
}
function clearBuyer() {
  buyer.value = 'anonymous:'
  buyerSearch.value = ''
  buyerOpen.value = false
}
function addToCart(product) {
  if (!state.enabled || product.stockQuantity <= 0) return
  const current = cart.value.find((item) => item.id === product.id)
  if (current) {
    if (current.quantity < product.stockQuantity) current.quantity++
  } else cart.value.push({ id: product.id, name: product.name, unit: product.unit, imageData: product.imageData, priceThb: product.priceThb, quantity: 1, stockQuantity: product.stockQuantity })
}
function changeQuantity(item, delta) {
  item.quantity = Math.max(0, Math.min(item.stockQuantity, item.quantity + delta))
  if (!item.quantity) cart.value = cart.value.filter((entry) => entry.id !== item.id)
}

async function refreshBilling() {
  billing.value = null
  qrDataUrl.value = ''
  if (!state.enabled || selectedBuyer.value.kind === 'anonymous') {
    if (paymentMethod.value === 'promptpay' && cartTotal.value > 0) await refreshQR(cartTotal.value)
    return
  }
  try {
    const query = selectedBuyer.value.kind === 'member'
      ? `memberId=${encodeURIComponent(selectedBuyer.value.id)}`
      : `playerRef=${encodeURIComponent(selectedBuyer.value.id)}`
    billing.value = await props.apiRequest(`/api/admin/pos/billing-summary?${query}`)
    if (paymentMethod.value === 'promptpay' && combinedTotal.value > 0) await refreshQR(combinedTotal.value)
  } catch { billing.value = null }
}
async function refreshQR(amount) {
  try {
    const data = await props.apiRequest(`/api/admin/pos/qr?amount=${amount}`)
    qrDataUrl.value = await QRCode.toDataURL(data.promptPayPayload, { width: 260, margin: 1 })
  } catch { qrDataUrl.value = '' }
}
async function checkout(action) {
  if (!cart.value.length || saving.value) return
  saving.value = true
  state.error = ''
  try {
    const result = await props.apiRequest('/api/admin/pos/sales', {
      method: 'POST',
      body: JSON.stringify({
        buyerType: selectedBuyer.value.kind, buyerId: selectedBuyer.value.id,
        action, method: paymentMethod.value,
        expectedTotalThb: action === 'pay' ? combinedTotal.value : 0,
        items: cart.value.map((item) => ({ productId: item.id, quantity: item.quantity }))
      })
    })
    state.notice = action === 'pay' ? `รับชำระสำเร็จ ${money(result.settlement?.totalThb || result.totalThb || combinedTotal.value)}` : `พักยอดบิล ${result.saleId} แล้ว`
    cart.value = []
    clearBuyer()
    billing.value = null
    qrDataUrl.value = ''
    await load()
  } catch (error) { state.error = error.message || 'บันทึกการขายไม่สำเร็จ' }
  finally { saving.value = false }
}
async function settleSale(sale) {
  if (!sale.billingAccountId || saving.value) return
  saving.value = true
  try {
    const summary = await props.apiRequest(`/api/admin/pos/billing-summary?accountId=${encodeURIComponent(sale.billingAccountId)}`)
    await props.apiRequest('/api/admin/pos/settlements', { method: 'POST', body: JSON.stringify({ billingAccountId: sale.billingAccountId, method: paymentMethod.value, expectedTotalThb: summary.totalThb }) })
    state.notice = `รับชำระสำเร็จ ${money(summary.totalThb)}`
    await load()
  } catch (error) { state.error = error.message || 'รับชำระไม่สำเร็จ' }
  finally { saving.value = false }
}
async function voidSale(sale) {
  if (!window.confirm(`ยกเลิกบิล ${sale.id} และคืนสินค้าเข้าสต็อก?`)) return
  try {
    await props.apiRequest(`/api/admin/pos/sales/${sale.id}/void`, { method: 'POST', body: JSON.stringify({ note: 'ยกเลิกจากหน้า POS' }) })
    state.notice = 'ยกเลิกบิลและคืนสต็อกแล้ว'
    await load()
  } catch (error) { state.error = error.message }
}

function openNewProduct() {
  productModal.value = { id: '', sku: '', category: selectedCategory.value === 'all' || selectedCategory.value === 'uncategorized' ? '' : selectedCategory.value, name: '', unit: '', imageData: '', priceThb: 0, costThb: 0, stockQuantity: 0, lowStockThreshold: Number(state.settings.defaultLowStock || 5), active: true }
}
function openEditProduct(product) { productModal.value = { ...product } }
function loadProductImage(event) {
  const file = event.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { productModal.value.imageData = String(reader.result || '') }
  reader.readAsDataURL(file)
}
async function saveProduct() {
  if (!productModal.value?.name?.trim()) return
  saving.value = true
  try {
    const editing = Boolean(productModal.value.id)
    await props.apiRequest(editing ? `/api/admin/pos/products/${productModal.value.id}` : '/api/admin/pos/products', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(productModal.value) })
    productModal.value = null
    await load()
  } catch (error) { state.error = error.message }
  finally { saving.value = false }
}
function openCatalog(kind, item = null) {
  catalogModal.value = { kind, form: item ? { id: item.id, name: item.name, active: item.active } : { id: '', name: '', active: true } }
}
function resetCatalogForm() { catalogModal.value.form = { id: '', name: '', active: true } }
async function saveCatalog() {
  const modal = catalogModal.value
  if (!modal?.form.name.trim()) return
  const editing = Boolean(modal.form.id)
  const base = modal.kind === 'category' ? 'categories' : 'units'
  try {
    await props.apiRequest(`/api/admin/pos/${base}${editing ? `/${modal.form.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify({ name: modal.form.name, active: modal.form.active }) })
    await load()
    resetCatalogForm()
  } catch (error) { state.error = error.message }
}
async function removeCatalog(item) {
  const modal = catalogModal.value
  const base = modal.kind === 'category' ? 'categories' : 'units'
  if (item.usedCount > 0 || !window.confirm(`ลบ “${item.name}”?`)) return
  try {
    await props.apiRequest(`/api/admin/pos/${base}/${item.id}`, { method: 'DELETE' })
    await load()
  } catch (error) { state.error = error.message }
}
function stockActionLabel(action) { return ({ in: 'นำเข้า', out: 'นำออก', adjust: 'ปรับปรุงสต็อก' })[action] }
function openStockBatch(mode) {
  const now = new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
  stockModal.value = {
    mode, search: '', note: '', name: `${stockActionLabel(mode)} ${now}`,
    items: state.products.map((product) => ({ product, selected: false, quantity: 0, targetQuantity: Number(product.stockQuantity || 0), costThb: Number(product.costThb || 0) }))
  }
}
function visibleStockBatchItems() {
  const term = stockModal.value?.search?.trim().toLocaleLowerCase('th-TH') || ''
  return (stockModal.value?.items || []).filter((item) => !term || `${item.product.name} ${item.product.sku}`.toLocaleLowerCase('th-TH').includes(term))
}
function stockBatchDelta(item, mode = stockModal.value?.mode) {
  const current = Number(item.product.stockQuantity || 0)
  if (mode === 'in') return Math.abs(Number(item.quantity || 0))
  if (mode === 'out') return -Math.abs(Number(item.quantity || 0))
  return Number(item.targetQuantity || 0) - current
}
function stockBatchBalance(item, mode = stockModal.value?.mode) {
  return Number(item.product.stockQuantity || 0) + stockBatchDelta(item, mode)
}
function signedQuantity(value) {
  const amount = Number(value || 0)
  return `${amount > 0 ? '+' : ''}${amount.toLocaleString('th-TH')}`
}
function stockBatchResultingCost(item, mode = stockModal.value?.mode) {
  const currentQuantity = Number(item.product.stockQuantity || 0)
  const currentCost = Number(item.product.costThb || 0)
  const delta = stockBatchDelta(item, mode)
  if (delta <= 0) return currentCost
  const incomingCost = Number(item.costThb || 0)
  return Math.round(((currentQuantity * currentCost) + (delta * incomingCost)) / (currentQuantity + delta))
}
function stockBatchLineCost(item, mode = stockModal.value?.mode) {
  const delta = Math.abs(stockBatchDelta(item, mode))
  const unitCost = stockBatchDelta(item, mode) > 0 ? Number(item.costThb || 0) : Number(item.product.costThb || 0)
  return delta * unitCost
}
function selectedStockBatchTotalCost() {
  return (stockModal.value?.items || []).filter((item) => item.selected).reduce((sum, item) => sum + stockBatchLineCost(item), 0)
}
async function saveStock() {
  if (!stockModal.value) return
  const modal = stockModal.value
  const selected = modal.items.filter((item) => item.selected)
  if (!selected.length) {
    state.error = 'กรุณาเลือกสินค้าอย่างน้อย 1 รายการ'
    return
  }
  if (!modal.name?.trim()) {
    state.error = 'กรุณาระบุชื่อรายการ'
    return
  }
  if (selected.some((item) => modal.mode !== 'adjust' ? Number(item.quantity) <= 0 : Number(item.targetQuantity) < 0)) {
    state.error = modal.mode === 'adjust' ? 'ยอดคงเหลือต้องไม่ติดลบ' : 'จำนวนทุกรายการต้องมากกว่า 0'
    return
  }
  saving.value = true
  try {
    await props.apiRequest('/api/admin/pos/stock/batch', { method: 'POST', body: JSON.stringify({
      name: modal.name.trim(),
      mode: modal.mode,
      note: modal.note,
      items: selected.map((item) => ({ productId: item.product.id, quantity: Number(item.quantity || 0), targetQuantity: Number(item.targetQuantity || 0), costThb: Number(item.costThb || 0) }))
    }) })
    stockModal.value = null
    await load()
  } catch (error) { state.error = error.message }
  finally { saving.value = false }
}
async function saveSettings() {
  saving.value = true
  try {
    await props.apiRequest('/api/admin/pos/settings', { method: 'PUT', body: JSON.stringify(state.settings) })
    persistTheme(state.settings.theme)
    setLanguage(state.settings.language)
    state.notice = 'บันทึกการตั้งค่า POS แล้ว'
    await load()
  } catch (error) { state.error = error.message }
  finally { saving.value = false }
}
function loadLogo(event) {
  const file = event.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { state.settings.logoData = String(reader.result || '') }
  reader.readAsDataURL(file)
}

watch([buyer, paymentMethod, cartTotal], refreshBilling)
onMounted(load)
</script>

<template>
  <section class="min-h-screen bg-paper-50 px-3 pb-28 pt-4 text-stone-950 dark:bg-paper-900 dark:text-white sm:px-5">
    <main class="mx-auto max-w-7xl">
      <p v-if="state.error" class="mb-3 rounded-lg bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">{{ state.error }}</p>
      <p v-if="state.notice" class="mb-3 rounded-lg bg-court-500/10 p-3 text-sm font-bold text-court-700 dark:text-court-300">{{ state.notice }}</p>

      <section v-if="tab === 'dashboard'" data-testid="pos-dashboard">
        <div class="rounded-2xl bg-stone-950 p-5 text-white shadow-soft dark:bg-stone-900">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div><p class="text-sm font-black text-court-300">LiveMatch POS</p><h1 class="mt-1 text-3xl font-black">แดชบอร์ดการขาย</h1><p class="mt-1 text-sm text-stone-300">ภาพรวมร้านและการขายวันนี้</p></div>
            <div class="flex flex-wrap gap-2"><button class="inline-flex h-12 items-center gap-2 rounded-xl border border-white/20 px-4 font-black" @click="goHome"><Home class="h-5 w-5" />HOME</button><button v-if="state.enabled" class="h-12 rounded-xl bg-court-500 px-5 font-black" @click="tab='sale'">เริ่มการขาย</button><span v-else class="inline-flex items-center rounded-full bg-amber-400/15 px-4 py-2 text-sm font-black text-amber-200">ปิดใช้งาน · อ่านย้อนหลัง</span></div>
          </div>
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <article v-for="metric in [{k:'salesThb',l:'ยอดขายวันนี้',money:true},{k:'grossProfitThb',l:'กำไรขั้นต้น',money:true},{k:'outstandingThb',l:'ยอดค้างชำระ',money:true},{k:'lowStockCount',l:'สินค้าใกล้หมด'}]" :key="metric.k" class="rounded-xl border bg-white p-4 dark:border-stone-700 dark:bg-stone-900"><p class="text-sm font-bold text-stone-500">{{ metric.l }}</p><p class="mt-2 text-2xl font-black">{{ metric.money ? money(state.report[metric.k]) : Number(state.report[metric.k] || 0).toLocaleString('th-TH') }}</p></article>
        </div>
        <div class="mt-4 grid gap-4 lg:grid-cols-2">
          <section class="rounded-xl border bg-white p-4 dark:border-stone-700 dark:bg-stone-900"><h2 class="font-black">บิลค้างล่าสุด</h2><div class="mt-3 grid gap-2"><button v-for="sale in openSales.slice(0,5)" :key="sale.id" class="flex justify-between rounded-lg bg-paper-100 p-3 text-left dark:bg-stone-800" @click="tab='orders'"><span><b>{{ sale.buyerName || 'ไม่ระบุชื่อ' }}</b><small class="block text-stone-500">{{ sale.id }}</small></span><b>{{ money(sale.totalThb) }}</b></button><p v-if="!openSales.length" class="py-5 text-center text-sm text-stone-500">ไม่มีบิลค้าง</p></div></section>
          <section class="rounded-xl border bg-white p-4 dark:border-stone-700 dark:bg-stone-900"><h2 class="font-black">สินค้าใกล้หมด</h2><div class="mt-3 grid gap-2"><button v-for="product in lowStockProducts.slice(0,5)" :key="product.id" class="flex justify-between rounded-lg bg-paper-100 p-3 text-left dark:bg-stone-800" @click="tab='stock'"><b>{{ product.name }}</b><span class="font-black text-rose-600">{{ product.stockQuantity }} {{ product.unit }}</span></button><p v-if="!lowStockProducts.length" class="py-5 text-center text-sm text-stone-500">สต็อกอยู่ในระดับปกติ</p></div></section>
        </div>
      </section>

      <div v-else-if="tab === 'sale' && state.enabled" class="grid gap-4 lg:grid-cols-[1fr_380px]">
        <section class="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
          <div class="grid gap-2 sm:grid-cols-[220px_1fr]"><select v-model="selectedCategory" class="h-11 rounded-lg border bg-transparent px-3 dark:border-stone-700"><option v-for="category in categoryOptions" :key="category.id" :value="category.id === 'all' || category.id === 'uncategorized' ? category.id : category.name">{{ category.name }}</option></select><label class="flex h-11 items-center gap-2 rounded-lg border px-3 dark:border-stone-700"><Search class="h-4 w-4" /><input v-model="productSearch" class="min-w-0 flex-1 bg-transparent outline-none" placeholder="ค้นหาชื่อหรือ SKU" /></label></div>
          <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"><button v-for="product in saleProducts" :key="product.id" class="overflow-hidden rounded-xl border bg-white text-left transition hover:border-court-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900" :disabled="product.stockQuantity<=0" @click="addToCart(product)"><div class="aspect-square bg-paper-100 dark:bg-stone-800"><img v-if="product.imageData" :src="product.imageData" :alt="product.name" class="h-full w-full object-cover" /><div v-else class="grid h-full place-items-center text-stone-300"><Boxes class="h-9 w-9" /></div></div><div class="p-3"><p class="truncate font-black">{{ product.name }}</p><p class="mt-1 text-xs text-stone-500">{{ product.category || 'ทั่วไป' }} · {{ product.unit || 'ไม่มีหน่วย' }}</p><div class="mt-3 flex justify-between"><b class="text-court-700 dark:text-court-300">{{ money(product.priceThb) }}</b><small :class="product.lowStock?'text-rose-600':'text-stone-500'">เหลือ {{ product.stockQuantity }}</small></div></div></button></div>
        </section>
        <aside class="h-fit rounded-xl border border-stone-200 bg-white p-4 shadow-soft dark:border-stone-700 dark:bg-stone-900 lg:sticky lg:top-4">
          <h2 class="flex items-center gap-2 text-xl font-black"><ShoppingCart class="h-5 w-5" />ตะกร้าสินค้า</h2>
          <div class="mt-3 grid gap-2"><article v-for="item in cart" :key="item.id" class="rounded-lg bg-paper-100 p-3 dark:bg-stone-800"><div class="flex justify-between gap-3"><b>{{ item.name }}</b><b>{{ money(item.priceThb*item.quantity) }}</b></div><div class="mt-2 flex items-center justify-end gap-2"><button class="grid h-8 w-8 place-items-center rounded border" @click="changeQuantity(item,-1)"><Minus class="h-4 w-4" /></button><b class="w-8 text-center">{{ item.quantity }}</b><button class="grid h-8 w-8 place-items-center rounded border" @click="changeQuantity(item,1)"><Plus class="h-4 w-4" /></button></div></article><p v-if="!cart.length" class="py-6 text-center text-sm font-semibold text-stone-500">ยังไม่มีสินค้าในตะกร้า</p></div>
          <div class="relative mt-3"><label class="text-sm font-black">ผู้ซื้อ</label><div class="mt-1 flex h-11 items-center rounded-lg border px-3 dark:border-stone-700"><Search class="mr-2 h-4 w-4" /><input v-model="buyerSearch" class="min-w-0 flex-1 bg-transparent outline-none" placeholder="พิมพ์ชื่อ 2 ตัว หรือเบอร์ 5 ตัว" @focus="buyerOpen=true" @input="buyerOpen=true" /><button v-if="buyerSearch" aria-label="ล้างผู้ซื้อ" @click="clearBuyer"><X class="h-4 w-4" /></button><ArrowDown v-else class="h-4 w-4" /></div><div v-if="buyerOpen && buyerResults.length" class="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-white p-1 shadow-xl dark:border-stone-700 dark:bg-stone-900"><button v-for="customer in buyerResults" :key="`${customer.kind}-${customer.id}`" class="block w-full rounded-md p-3 text-left hover:bg-paper-100 dark:hover:bg-stone-800" @click="chooseBuyer(customer)"><b>{{ customerLabel(customer) }}</b><small class="block text-stone-500">{{ customer.kind === 'member' ? 'สมาชิก' : 'ขาจรจาก Session วันนี้' }}</small></button></div><p v-if="buyerOpen && buyerSearch && !buyerResults.length" class="mt-1 text-xs font-bold text-stone-500">พิมพ์ชื่ออย่างน้อย 2 ตัว หรือเบอร์อย่างน้อย 5 ตัว</p><button v-if="selectedBuyer.kind==='anonymous'" class="mt-2 text-xs font-black text-court-700" @click="buyerOpen=false">ไม่ระบุชื่อ · ชำระทันที</button></div>
          <div v-if="billing?.totalThb" class="mt-3 rounded-lg bg-sky-50 p-3 text-sm dark:bg-sky-950/30"><div class="flex justify-between"><span>ยอดค้าง Match</span><b>{{ money(billing.matchTotalThb) }}</b></div><div class="mt-1 flex justify-between"><span>ยอดสินค้าเดิม</span><b>{{ money(billing.posTotalThb) }}</b></div></div>
          <div v-if="taxAmount" class="mt-3 flex justify-between text-sm"><span>ภาษี {{ state.settings.taxRatePercent }}%</span><b>{{ money(taxAmount) }}</b></div><div class="mt-4 flex justify-between border-t pt-4 text-xl font-black dark:border-stone-700"><span>ยอดรวม</span><span class="text-court-700 dark:text-court-300">{{ money(combinedTotal) }}</span></div>
          <label class="mt-3 grid gap-1 text-sm font-black">ช่องทางชำระ<select v-model="paymentMethod" class="h-11 rounded-lg border bg-transparent px-3 dark:border-stone-700"><option value="cash">เงินสด</option><option value="promptpay">PromptPay QR</option></select></label><div v-if="paymentMethod==='promptpay'" class="mt-3 grid place-items-center rounded-lg bg-paper-100 p-3 dark:bg-stone-800"><img v-if="qrDataUrl" :src="qrDataUrl" alt="POS PromptPay QR" class="h-44 w-44 rounded bg-white p-1" /><p v-else class="text-center text-sm font-bold text-stone-500">กรุณาตั้งค่า PromptPay</p></div>
          <div class="mt-3 grid grid-cols-2 gap-2"><button class="h-11 rounded-lg border font-black disabled:opacity-40 dark:border-stone-700" :disabled="!cart.length||selectedBuyer.kind==='anonymous'||saving" @click="checkout('open')">พักยอด</button><button class="h-11 rounded-lg bg-court-500 font-black text-white disabled:opacity-40" :disabled="!cart.length||saving" @click="checkout('pay')">รับชำระ</button></div>
        </aside>
      </div>

      <div v-else-if="tab === 'orders'" class="grid gap-4"><section class="rounded-xl border bg-white p-4 dark:border-stone-700 dark:bg-stone-900"><h1 class="text-2xl font-black">บิลค้างชำระ</h1><div class="mt-3 grid gap-2"><article v-for="sale in openSales" :key="sale.id" class="grid gap-3 rounded-lg bg-paper-100 p-3 dark:bg-stone-800 sm:grid-cols-[1fr_auto] sm:items-center"><div><b>{{ sale.buyerName || 'ไม่ระบุชื่อ' }}</b><p class="text-xs text-stone-500">{{ sale.id }} · {{ sale.createdAt }}</p><p class="mt-1 text-sm text-stone-500">{{ sale.items.map(i=>`${i.productName} × ${i.quantity}`).join(', ') }}</p></div><div class="flex items-center gap-2"><b>{{ money(sale.totalThb) }}</b><button v-if="state.enabled&&sale.billingAccountId" class="h-9 rounded-lg bg-court-500 px-3 text-sm font-black text-white" @click="settleSale(sale)">เก็บเงินรวม</button><button v-if="state.enabled" class="grid h-9 w-9 place-items-center rounded-lg border border-rose-200 text-rose-600" @click="voidSale(sale)"><Trash2 class="h-4 w-4" /></button></div></article><p v-if="!openSales.length" class="py-6 text-center text-stone-500">ไม่มีบิลค้าง</p></div></section><section class="rounded-xl border bg-white p-4 dark:border-stone-700 dark:bg-stone-900"><h2 class="text-xl font-black">ประวัติล่าสุด</h2><div class="mt-3 overflow-x-auto"><table class="w-full min-w-[680px] text-sm"><thead><tr class="border-b text-left dark:border-stone-700"><th class="p-2">เวลา</th><th>เลขที่</th><th>ผู้ซื้อ</th><th>สถานะ</th><th class="text-right">ยอด</th></tr></thead><tbody><tr v-for="sale in historySales" :key="sale.id" class="border-b dark:border-stone-800"><td class="p-2">{{ sale.createdAt }}</td><td>{{ sale.id }}</td><td>{{ sale.buyerName || '-' }}</td><td>{{ saleStatus(sale.status) }}</td><td class="text-right font-black">{{ money(sale.totalThb) }}</td></tr></tbody></table></div></section></div>

      <div v-else-if="tab === 'products'" class="grid gap-4 lg:grid-cols-[1fr_3fr]">
        <aside class="h-fit rounded-xl border bg-white p-4 dark:border-stone-700 dark:bg-stone-900"><div class="flex items-center justify-between"><h1 class="text-xl font-black">หมวดหมู่</h1><button v-if="state.enabled" class="grid h-10 w-10 place-items-center rounded-lg bg-court-500 text-white" aria-label="จัดการหมวดหมู่" @click="openCatalog('category')"><Plus class="h-4 w-4" /></button></div><div class="mt-3 grid gap-1"><button v-for="category in categoryOptions" :key="category.id" class="group flex min-h-11 items-center justify-between rounded-lg px-3 text-left font-bold" :class="selectedCategory === (category.id === 'all' || category.id === 'uncategorized' ? category.id : category.name) ? 'bg-court-500 text-white' : 'hover:bg-paper-100 dark:hover:bg-stone-800'" @click="selectedCategory=category.id === 'all' || category.id === 'uncategorized' ? category.id : category.name"><span><span>{{ category.name }}</span><small v-if="category.active === false" class="ml-2 opacity-60">ปิด</small></span><span v-if="category.id.startsWith('category-') && state.enabled" class="grid h-7 w-7 place-items-center rounded opacity-60 group-hover:opacity-100" @click.stop="openCatalog('category',category)"><Pencil class="h-4 w-4" /></span></button></div></aside>
        <section class="rounded-xl border bg-white p-4 dark:border-stone-700 dark:bg-stone-900"><div class="flex flex-wrap items-center justify-between gap-3"><div><h1 class="text-2xl font-black">สินค้า</h1><p class="text-sm text-stone-500">เลือกหมวดหมู่ด้านซ้ายเพื่อดูสินค้า</p></div><div class="flex gap-2"><button v-if="state.enabled" class="inline-flex h-11 items-center gap-2 rounded-lg border px-4 font-black dark:border-stone-700" @click="openCatalog('unit')"><Plus class="h-4 w-4" />เพิ่มหน่วย</button><button v-if="state.enabled" class="inline-flex h-11 items-center gap-2 rounded-lg bg-court-500 px-4 font-black text-white" @click="openNewProduct"><Plus class="h-4 w-4" />เพิ่มสินค้า</button></div></div><label class="mt-4 flex h-11 items-center gap-2 rounded-lg border px-3 dark:border-stone-700"><Search class="h-4 w-4" /><input v-model="productSearch" class="min-w-0 flex-1 bg-transparent outline-none" placeholder="ค้นหาสินค้า" /></label><div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><article v-for="product in productsForCategory" :key="product.id" class="overflow-hidden rounded-xl border bg-white dark:border-stone-700 dark:bg-stone-900"><div class="aspect-[4/3] bg-paper-100 dark:bg-stone-800"><img v-if="product.imageData" :src="product.imageData" :alt="product.name" class="h-full w-full object-cover" /><div v-else class="grid h-full place-items-center text-stone-300"><Boxes class="h-10 w-10" /></div></div><div class="p-4"><div class="flex justify-between gap-2"><div><h2 class="font-black">{{ product.name }}</h2><p class="text-xs text-stone-500">{{ product.sku || 'ไม่มีรหัสสินค้า' }} · {{ product.unit || 'ไม่มีหน่วย' }}</p></div><b>{{ money(product.priceThb) }}</b></div><button v-if="state.enabled" class="mt-3 h-9 w-full rounded-lg border font-bold dark:border-stone-700" @click="openEditProduct(product)">แก้ไขสินค้า</button></div></article><p v-if="!productsForCategory.length" class="py-10 text-center text-stone-500 sm:col-span-2 xl:col-span-3">ยังไม่มีสินค้าในหมวดนี้</p></div></section>
      </div>

      <div v-else-if="tab === 'stock'" class="grid gap-4">
        <section class="overflow-hidden rounded-2xl bg-stone-950 p-5 text-white shadow-soft dark:bg-stone-900">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div><p class="text-sm font-black text-court-300">คลังสินค้า</p><h1 class="mt-1 text-3xl font-black">จัดการสต็อก</h1><p class="mt-1 text-sm text-stone-300">ตรวจสอบยอดคงเหลือและสร้างรายการหลายสินค้าพร้อมกัน</p></div>
            <span class="rounded-full bg-white/10 px-3 py-1 text-sm font-black">{{ state.products.length }} สินค้า</span>
          </div>
          <div v-if="state.enabled" class="mt-5 grid gap-2 sm:grid-cols-3" role="group" aria-label="สร้างรายการสต็อก">
            <button class="flex min-h-20 items-center gap-3 rounded-xl bg-court-500 p-4 text-left transition hover:-translate-y-0.5" @click="openStockBatch('in')"><span class="grid h-11 w-11 place-items-center rounded-lg bg-white/15"><Plus class="h-5 w-5" /></span><span><b class="block">สร้างการนำเข้า</b><small class="text-white/75">รับสินค้าเข้าคลัง</small></span></button>
            <button class="flex min-h-20 items-center gap-3 rounded-xl bg-rose-600 p-4 text-left transition hover:-translate-y-0.5" @click="openStockBatch('out')"><span class="grid h-11 w-11 place-items-center rounded-lg bg-white/15"><Minus class="h-5 w-5" /></span><span><b class="block">สร้างการนำออก</b><small class="text-white/75">เบิกหรือตัดสินค้า</small></span></button>
            <button class="flex min-h-20 items-center gap-3 rounded-xl bg-sky-600 p-4 text-left transition hover:-translate-y-0.5" @click="openStockBatch('adjust')"><span class="grid h-11 w-11 place-items-center rounded-lg bg-white/15"><Settings class="h-5 w-5" /></span><span><b class="block">สร้างการปรับปรุง</b><small class="text-white/75">แก้ยอดจากการตรวจนับ</small></span></button>
          </div>
        </section>

        <section class="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="สรุปสต็อก">
          <article class="rounded-xl border bg-white p-4 dark:border-stone-700 dark:bg-stone-900"><p class="text-xs font-black text-stone-500">รายการสินค้า</p><p class="mt-2 text-2xl font-black">{{ state.products.length }}</p><small class="text-stone-500">SKU ทั้งหมด</small></article>
          <article class="rounded-xl border bg-white p-4 dark:border-stone-700 dark:bg-stone-900"><p class="text-xs font-black text-stone-500">จำนวนคงเหลือรวม</p><p class="mt-2 text-2xl font-black">{{ stockTotalUnits.toLocaleString('th-TH') }}</p><small class="text-stone-500">ทุกหน่วยสินค้า</small></article>
          <article class="rounded-xl border bg-white p-4 dark:border-stone-700 dark:bg-stone-900"><p class="text-xs font-black text-stone-500">มูลค่าสต็อก</p><p class="mt-2 text-2xl font-black">{{ money(stockValueTHB) }}</p><small class="text-stone-500">คำนวณจากต้นทุน</small></article>
          <article class="rounded-xl border p-4" :class="lowStockProducts.length?'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30':'bg-white dark:border-stone-700 dark:bg-stone-900'"><p class="text-xs font-black text-stone-500">สินค้าใกล้หมด</p><p class="mt-2 text-2xl font-black" :class="lowStockProducts.length?'text-rose-600':''">{{ lowStockProducts.length }}</p><small class="text-stone-500">ถึงจุดแจ้งเตือน</small></article>
        </section>

        <section class="rounded-xl border bg-white dark:border-stone-700 dark:bg-stone-900">
          <div class="border-b p-4 dark:border-stone-700"><div class="flex flex-wrap items-end justify-between gap-3"><div><h2 class="text-xl font-black">รายการสินค้าในคลัง</h2><p class="text-sm text-stone-500">{{ filteredStockProducts.length }} จาก {{ state.products.length }} รายการ</p></div><div class="flex w-full gap-2 sm:w-auto"><label class="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 dark:border-stone-700 sm:w-64"><Search class="h-4 w-4" /><input v-model="stockSearch" class="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="ค้นหาสินค้า" /></label><select v-model="stockFilter" class="h-10 rounded-lg border bg-transparent px-3 text-sm font-bold dark:border-stone-700"><option value="all">ทั้งหมด</option><option value="low">ใกล้หมด</option><option value="out">หมดสต็อก</option></select></div></div></div>
          <div class="hidden overflow-x-auto md:block"><table class="w-full min-w-[760px] text-sm"><thead><tr class="bg-paper-100 text-left text-xs font-black text-stone-500 dark:bg-stone-800"><th class="p-3">สินค้า</th><th>หมวดหมู่</th><th>หน่วย</th><th class="text-right">ต้นทุน</th><th class="text-right">คงเหลือ</th><th class="pr-3 text-right">สถานะ</th></tr></thead><tbody><tr v-for="product in filteredStockProducts" :key="product.id" class="border-t dark:border-stone-800"><td class="p-3"><div class="flex items-center gap-3"><img v-if="product.imageData" :src="product.imageData" :alt="product.name" class="h-11 w-11 rounded-lg object-cover" /><span v-else class="grid h-11 w-11 place-items-center rounded-lg bg-paper-100 text-stone-400 dark:bg-stone-800"><Boxes class="h-5 w-5" /></span><span><b class="block">{{ product.name }}</b><small class="text-stone-500">{{ product.sku || 'ไม่มีรหัสสินค้า' }}</small></span></div></td><td>{{ product.category || 'ไม่มีหมวดหมู่' }}</td><td>{{ product.unit || 'ไม่มีหน่วย' }}</td><td class="text-right">{{ money(product.costThb) }}</td><td class="text-right text-lg font-black">{{ product.stockQuantity }}</td><td class="pr-3 text-right"><span class="rounded-full px-2 py-1 text-xs font-black" :class="product.stockQuantity<=0?'bg-rose-100 text-rose-700':product.lowStock?'bg-amber-100 text-amber-800':'bg-court-500/10 text-court-700'">{{ product.stockQuantity<=0?'หมด':product.lowStock?'ใกล้หมด':'ปกติ' }}</span></td></tr></tbody></table></div>
          <div class="grid gap-2 p-3 md:hidden"><article v-for="product in filteredStockProducts" :key="product.id" class="flex items-center gap-3 rounded-xl border p-3 dark:border-stone-700"><img v-if="product.imageData" :src="product.imageData" :alt="product.name" class="h-14 w-14 rounded-lg object-cover" /><span v-else class="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-paper-100 text-stone-400 dark:bg-stone-800"><Boxes class="h-5 w-5" /></span><div class="min-w-0 flex-1"><b class="block truncate">{{ product.name }}</b><small class="text-stone-500">{{ product.sku || 'ไม่มีรหัส' }} · {{ product.unit || 'ไม่มีหน่วย' }}</small><p class="mt-1 text-xs text-stone-500">ต้นทุน {{ money(product.costThb) }}</p></div><div class="text-right"><b class="block text-xl" :class="product.lowStock?'text-rose-600':''">{{ product.stockQuantity }}</b><small class="text-stone-500">คงเหลือ</small></div></article></div>
          <p v-if="!filteredStockProducts.length" class="p-8 text-center text-stone-500">ไม่พบสินค้าตามเงื่อนไข</p>
        </section>

        <section class="rounded-xl border bg-white dark:border-stone-700 dark:bg-stone-900">
          <div class="border-b p-4 dark:border-stone-700"><h2 class="text-xl font-black">รายการสต็อก</h2><p class="text-sm text-stone-500">หนึ่งรายการรวมสินค้าได้หลายชนิด พร้อมต้นทุนของแต่ละรายการ</p></div>
          <div class="grid gap-3 p-3 sm:p-4">
            <article v-for="batch in state.stockBatches" :key="batch.id" class="overflow-hidden rounded-xl border border-stone-200 dark:border-stone-700">
              <header class="flex flex-wrap items-start justify-between gap-3 bg-paper-50 p-3 dark:bg-stone-800 sm:p-4"><div><div class="flex flex-wrap items-center gap-2"><b class="text-base">{{ batch.name }}</b><span class="rounded-full px-2 py-1 text-xs font-black" :class="batch.mode==='in'?'bg-emerald-100 text-emerald-700':batch.mode==='out'?'bg-rose-100 text-rose-700':'bg-sky-100 text-sky-700'">{{ stockActionLabel(batch.mode) }}</span></div><p class="mt-1 text-xs text-stone-500">{{ batch.createdAt }} · {{ batch.items.length }} สินค้า<span v-if="batch.note"> · {{ batch.note }}</span></p></div><div class="text-right"><small class="block font-bold text-stone-500">มูลค่ารายการ</small><b class="text-lg">{{ money(batch.totalCostThb) }}</b></div></header>
              <div class="overflow-x-auto"><table class="w-full min-w-[720px] text-sm"><thead><tr class="text-left text-xs font-black text-stone-500"><th class="p-3">สินค้า</th><th class="text-right">เปลี่ยน</th><th class="text-right">คงเหลือ</th><th class="text-right">ต้นทุนรายการ/หน่วย</th><th class="text-right">ต้นทุนเฉลี่ย</th><th class="pr-3 text-right">รวม</th></tr></thead><tbody><tr v-for="item in batch.items" :key="item.id" class="border-t dark:border-stone-800"><td class="p-3 font-bold">{{ item.productName }}</td><td class="text-right font-black" :class="item.delta<0?'text-rose-600':'text-court-700'">{{ signedQuantity(item.delta) }}</td><td class="text-right">{{ item.balance }}</td><td class="text-right">{{ money(item.unitCostThb) }}</td><td class="text-right"><span v-if="item.previousCostThb!==item.resultingCostThb">{{ money(item.previousCostThb) }} → </span><b>{{ money(item.resultingCostThb) }}</b></td><td class="pr-3 text-right font-bold">{{ money(item.totalCostThb) }}</td></tr></tbody></table></div>
            </article>
            <p v-if="!state.stockBatches.length" class="rounded-xl border border-dashed p-8 text-center text-stone-500 dark:border-stone-700">ยังไม่มีรายการนำเข้า นำออก หรือปรับปรุง</p>
          </div>
        </section>
      </div>

      <section v-else-if="tab === 'report'" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><article v-for="metric in [{k:'salesThb',l:'ยอดขายวันนี้',money:true},{k:'costThb',l:'ต้นทุนวันนี้',money:true},{k:'grossProfitThb',l:'กำไรขั้นต้น',money:true},{k:'outstandingThb',l:'ยอดสินค้าค้าง',money:true},{k:'lowStockCount',l:'สินค้าใกล้หมด'}]" :key="metric.k" class="rounded-xl border bg-white p-4 dark:border-stone-700 dark:bg-stone-900"><p class="text-sm font-bold text-stone-500">{{ metric.l }}</p><p class="mt-2 text-2xl font-black">{{ metric.money?money(state.report[metric.k]):Number(state.report[metric.k]||0).toLocaleString('th-TH') }}</p></article></section>

      <section v-else-if="tab === 'settings'" class="mx-auto max-w-3xl rounded-xl border bg-white p-4 dark:border-stone-700 dark:bg-stone-900"><h1 class="text-2xl font-black">ตั้งค่า POS</h1><fieldset :disabled="!state.enabled" class="mt-4 grid gap-3 disabled:opacity-70 sm:grid-cols-2"><label class="grid gap-1 text-sm font-black">โหมดสี<select v-model="state.settings.theme" class="h-11 rounded-lg border bg-transparent px-3 dark:border-stone-700"><option value="light">Light mode</option><option value="dark">Dark mode</option></select></label><label class="grid gap-1 text-sm font-black">ภาษา<select v-model="state.settings.language" class="h-11 rounded-lg border bg-transparent px-3 dark:border-stone-700"><option value="th">ไทย</option><option value="en">English</option></select></label><label class="grid gap-1 text-sm font-black">ภาษี (%)<input v-model.number="state.settings.taxRatePercent" type="number" min="0" max="100" class="h-11 rounded-lg border bg-transparent px-3 dark:border-stone-700" /></label><label class="flex items-center gap-2 pt-6 font-bold"><input v-model="state.settings.pricesIncludeTax" type="checkbox" /> ราคาสินค้ารวมภาษีแล้ว</label><label class="grid gap-1 text-sm font-black">ประเภท PromptPay<select v-model="state.settings.promptPayType" class="h-11 rounded-lg border bg-transparent px-3 dark:border-stone-700"><option value="mobile">เบอร์มือถือ</option><option value="national_id">เลขบัตร/ภาษี</option><option value="ewallet">E-Wallet</option></select></label><label class="grid gap-1 text-sm font-black">PromptPay ID<input v-model="state.settings.promptPayId" class="h-11 rounded-lg border bg-transparent px-3 dark:border-stone-700" /></label><label class="grid gap-1 text-sm font-black sm:col-span-2">ชื่อบัญชีผู้รับ<input v-model="state.settings.promptPayReceiverName" class="h-11 rounded-lg border bg-transparent px-3 dark:border-stone-700" /></label><label class="grid gap-1 text-sm font-black">หัวใบเสร็จ<input v-model="state.settings.receiptHeader" class="h-11 rounded-lg border bg-transparent px-3 dark:border-stone-700" /></label><label class="grid gap-1 text-sm font-black">แจ้งเตือนสต็อกต่ำ<input v-model.number="state.settings.defaultLowStock" type="number" min="0" class="h-11 rounded-lg border bg-transparent px-3 dark:border-stone-700" /></label><label class="grid gap-1 text-sm font-black sm:col-span-2">โลโก้ใบเสร็จ<input type="file" accept="image/png,image/jpeg,image/webp" class="rounded-lg border p-2 dark:border-stone-700" @change="loadLogo" /></label><label class="grid gap-1 text-sm font-black sm:col-span-2">ท้ายใบเสร็จ<textarea v-model="state.settings.receiptFooter" rows="3" class="rounded-lg border bg-transparent p-3 dark:border-stone-700" /></label></fieldset><button v-if="state.enabled" class="mt-4 inline-flex h-11 items-center gap-2 rounded-lg bg-court-500 px-5 font-black text-white" :disabled="saving" @click="saveSettings"><Save class="h-4 w-4" />บันทึกตั้งค่า</button></section>
    </main>

    <nav class="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 px-2 pb-[max(.6rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgba(34,41,37,.10)] backdrop-blur-xl dark:border-stone-700 dark:bg-stone-900/95" aria-label="เมนู POS ด้านล่าง"><div class="mx-auto flex max-w-4xl gap-1 overflow-x-auto"><button v-for="item in tabs" :key="item.id" class="flex min-w-[76px] flex-1 flex-col items-center gap-1 rounded-lg px-2 py-2 text-[11px] font-black" :class="tab===item.id?'bg-court-500 text-white':'text-stone-500 hover:bg-paper-100 dark:hover:bg-stone-800'" @click="tab=item.id"><component :is="item.icon" class="h-5 w-5" />{{ item.label }}</button></div></nav>

    <div v-if="productModal" class="fixed inset-0 z-50 grid place-items-end bg-black/50 p-3 sm:place-items-center" @click.self="productModal=null"><form class="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-4 dark:bg-stone-900" @submit.prevent="saveProduct"><div class="flex justify-between"><h2 class="text-xl font-black">{{ productModal.id?'แก้ไขสินค้า':'เพิ่มสินค้า' }}</h2><button type="button" @click="productModal=null"><X /></button></div><div class="mt-4 grid gap-3 sm:grid-cols-2"><label class="grid gap-1 font-bold sm:col-span-2">รูปสินค้า<input type="file" accept="image/png,image/jpeg,image/webp" class="rounded border p-2" @change="loadProductImage" /><img v-if="productModal.imageData" :src="productModal.imageData" alt="ตัวอย่างรูปสินค้า" class="mt-2 aspect-video max-h-48 w-full rounded-lg bg-paper-100 object-contain" /></label><label class="grid gap-1 font-bold">ชื่อสินค้า<input v-model="productModal.name" required class="h-11 rounded border bg-transparent px-3" /></label><label class="grid gap-1 font-bold">รหัสสินค้า (SKU)<input v-model="productModal.sku" class="h-11 rounded border bg-transparent px-3" /><small class="font-normal text-stone-500">รหัสอ้างอิงภายในร้าน เช่น WATER-001 ไม่บังคับกรอก</small></label><label class="grid gap-1 font-bold">หมวดหมู่<select v-model="productModal.category" class="h-11 rounded border bg-transparent px-3"><option value="">ไม่มีหมวดหมู่</option><option v-for="category in state.categories.filter(item=>item.active || item.name===productModal.category)" :key="category.id" :value="category.name">{{ category.name }}</option></select></label><label class="grid gap-1 font-bold">หน่วย<select v-model="productModal.unit" class="h-11 rounded border bg-transparent px-3"><option value="">ไม่มีหน่วย</option><option v-for="unit in state.units.filter(item=>item.active || item.name===productModal.unit)" :key="unit.id" :value="unit.name">{{ unit.name }}</option></select></label><label class="grid gap-1 font-bold">ราคาขาย<input v-model.number="productModal.priceThb" type="number" min="0" class="h-11 rounded border bg-transparent px-3" /></label><label class="grid gap-1 font-bold">จุดแจ้งเตือน<input v-model.number="productModal.lowStockThreshold" type="number" min="0" class="h-11 rounded border bg-transparent px-3" /></label><label class="flex items-center gap-2 font-bold"><input v-model="productModal.active" type="checkbox" /> เปิดขาย</label></div><button class="mt-4 h-11 w-full rounded-lg bg-court-500 font-black text-white">บันทึกสินค้า</button></form></div>
    <div v-if="catalogModal" class="fixed inset-0 z-50 grid place-items-end bg-black/50 p-3 sm:place-items-center" @click.self="catalogModal=null"><section class="max-h-[88vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-4 dark:bg-stone-900"><div class="flex items-center justify-between"><h2 class="text-xl font-black">จัดการ{{ catalogModal.kind==='category'?'หมวดหมู่':'หน่วย' }}</h2><button @click="catalogModal=null"><X class="h-5 w-5" /></button></div><form class="mt-4 rounded-lg bg-paper-100 p-3 dark:bg-stone-800" @submit.prevent="saveCatalog"><label class="grid gap-1 font-bold">ชื่อ<input v-model="catalogModal.form.name" required class="h-11 rounded-lg border bg-white px-3 dark:border-stone-700 dark:bg-stone-900" /></label><label class="mt-3 flex items-center gap-2 font-bold"><input v-model="catalogModal.form.active" type="checkbox" /> เปิดใช้งาน</label><div class="mt-3 grid grid-cols-2 gap-2"><button v-if="catalogModal.form.id" type="button" class="h-10 rounded-lg border font-bold" @click="resetCatalogForm">ยกเลิกแก้ไข</button><button class="h-10 rounded-lg bg-court-500 font-black text-white" :class="{'col-span-2':!catalogModal.form.id}">{{ catalogModal.form.id?'บันทึกการแก้ไข':'เพิ่มรายการ' }}</button></div></form><div class="mt-4 grid gap-2"><article v-for="item in (catalogModal.kind==='category'?state.categories:state.units)" :key="item.id" class="flex items-center justify-between gap-3 rounded-lg border p-3 dark:border-stone-700"><div><b>{{ item.name }}</b><p class="text-xs text-stone-500">{{ item.active?'เปิดใช้งาน':'ปิดใช้งาน' }} · ใช้กับสินค้า {{ item.usedCount || 0 }} รายการ</p></div><div class="flex gap-1"><button class="grid h-9 w-9 place-items-center rounded-lg border" aria-label="แก้ไข" @click="openCatalog(catalogModal.kind,item)"><Pencil class="h-4 w-4" /></button><button class="grid h-9 w-9 place-items-center rounded-lg border border-rose-200 text-rose-600 disabled:opacity-30" aria-label="ลบ" :disabled="item.usedCount>0" :title="item.usedCount>0?'มีสินค้าใช้งานอยู่ จึงลบไม่ได้':'ลบรายการ'" @click="removeCatalog(item)"><Trash2 class="h-4 w-4" /></button></div></article></div></section></div>
    <div v-if="stockModal" class="fixed inset-0 z-50 grid place-items-end overflow-hidden bg-black/55 p-0 sm:place-items-center sm:p-3" @click.self="stockModal=null">
      <form class="flex max-h-[100dvh] min-w-0 w-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl dark:bg-stone-900 sm:max-h-[94vh] sm:w-[calc(100vw-1.5rem)] sm:rounded-2xl sm:border sm:border-stone-700" @submit.prevent="saveStock">
        <header class="flex min-w-0 shrink-0 items-center justify-between gap-3 border-b px-4 py-4 dark:border-stone-700 sm:px-5"><div class="min-w-0"><h2 class="truncate text-xl font-black">สร้างการ{{ stockActionLabel(stockModal.mode) }}</h2><p class="truncate text-sm text-stone-500">เลือกสินค้าและกรอกข้อมูลได้หลายรายการพร้อมกัน</p></div><button type="button" class="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-stone-200 text-stone-500 dark:border-stone-700" @click="stockModal=null"><X class="h-5 w-5" /></button></header>
        <div class="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5">
          <label class="mb-4 grid min-w-0 gap-1.5 text-sm font-black"><span>ชื่อรายการ</span><input v-model="stockModal.name" required maxlength="160" class="h-11 min-w-0 w-full rounded-xl border border-stone-200 bg-paper-50 px-3 outline-none transition focus:border-court-500 focus:ring-2 focus:ring-court-500/15 dark:border-stone-700 dark:bg-stone-800" placeholder="เช่น รับสินค้ารอบเช้า หรือ เบิกใช้ในสนาม" /><small class="font-semibold text-stone-500">สินค้าที่เลือกทั้งหมดจะอยู่ภายใต้รายการชื่อนี้</small></label>
          <label class="flex h-11 min-w-0 w-full items-center gap-2.5 rounded-lg border border-stone-300 bg-white px-3 transition focus-within:border-court-500 focus-within:ring-2 focus-within:ring-court-500/15 dark:border-stone-600 dark:bg-stone-900"><Search class="h-5 w-5 shrink-0 text-stone-400" /><input v-model="stockModal.search" type="text" class="h-full min-w-0 max-w-full flex-1 appearance-none border-0 bg-transparent p-0 text-sm font-semibold shadow-none outline-none ring-0 placeholder:text-stone-400 focus:border-0 focus:outline-none focus:ring-0 dark:bg-transparent" placeholder="ค้นหาชื่อหรือรหัสสินค้า" /><span class="shrink-0 rounded-md bg-paper-100 px-2 py-1 text-[11px] font-black text-stone-500 dark:bg-stone-800">{{ visibleStockBatchItems().length }} รายการ</span></label>
          <div class="mt-4 grid min-w-0 gap-3">
            <article v-for="item in visibleStockBatchItems()" :key="item.product.id" class="grid min-w-0 max-w-full overflow-hidden gap-3 rounded-xl border p-3 transition sm:p-4 lg:grid-cols-[auto_minmax(0,1fr)_minmax(170px,200px)_minmax(150px,180px)] lg:items-center" :class="item.selected?'border-court-500 bg-court-500/5 shadow-[0_0_0_2px_rgba(74,145,122,.08)]':'border-stone-200 dark:border-stone-700'">
              <label class="flex cursor-pointer items-center gap-3 lg:block"><input v-model="item.selected" type="checkbox" class="h-6 w-6 cursor-pointer rounded-md border-2 border-stone-300 accent-court-500" :aria-label="`เลือก ${item.product.name}`" /><span class="font-bold lg:hidden">เลือกสินค้า</span></label>
              <div class="flex min-w-0 items-center gap-3"><img v-if="item.product.imageData" :src="item.product.imageData" :alt="item.product.name" class="h-14 w-14 shrink-0 rounded-xl object-cover" /><div v-else class="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-paper-100 text-stone-400 dark:bg-stone-800"><Boxes class="h-6 w-6" /></div><div class="min-w-0"><b class="block truncate text-base">{{ item.product.name }}</b><small class="block truncate text-stone-500">{{ item.product.sku || 'ไม่มีรหัส' }} · {{ item.product.unit || 'ไม่มีหน่วย' }}</small><span class="mt-1 inline-flex rounded-md bg-paper-100 px-2 py-1 text-xs font-black text-stone-600 dark:bg-stone-800 dark:text-stone-300">คงเหลือ {{ item.product.stockQuantity }}</span></div></div>
              <label v-if="stockModal.mode!=='adjust'" class="grid min-w-0 max-w-full gap-1.5 text-sm font-black"><span>{{ stockModal.mode==='in'?'จำนวนที่เพิ่ม':'จำนวนที่นำออก' }}</span><input v-model.number="item.quantity" type="number" min="1" :disabled="!item.selected" class="h-11 min-w-0 w-full max-w-full rounded-xl border border-stone-200 bg-paper-50 px-3 text-base font-black outline-none transition focus:border-court-500 focus:ring-2 focus:ring-court-500/15 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:bg-stone-800" /><small class="min-w-0 truncate font-bold" :class="stockBatchBalance(item)<0?'text-rose-600':'text-stone-500'">คงเหลือ {{ item.product.stockQuantity }} → <b>{{ stockBatchBalance(item) }}</b></small></label>
              <label v-else class="grid min-w-0 max-w-full gap-1.5 text-sm font-black"><span>ยอดคงเหลือจริง</span><input v-model.number="item.targetQuantity" type="number" min="0" :disabled="!item.selected" class="h-11 min-w-0 w-full max-w-full rounded-xl border border-stone-200 bg-paper-50 px-3 text-base font-black outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:bg-stone-800" /><small class="min-w-0 truncate font-bold" :class="stockBatchDelta(item)>0?'text-court-700':stockBatchDelta(item)<0?'text-rose-600':'text-stone-500'">ปรับ {{ signedQuantity(stockBatchDelta(item)) }} จาก {{ item.product.stockQuantity }}</small></label>
              <label v-if="stockModal.mode!=='out'" class="grid min-w-0 max-w-full gap-1.5 text-sm font-black"><span>ต้นทุน/หน่วย</span><input v-model.number="item.costThb" type="number" min="0" :disabled="!item.selected" class="h-11 min-w-0 w-full max-w-full rounded-xl border border-stone-200 bg-paper-50 px-3 text-base font-black outline-none transition focus:border-court-500 focus:ring-2 focus:ring-court-500/15 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:bg-stone-800" /><small class="min-w-0 font-semibold text-stone-500">เฉลี่ย {{ money(item.product.costThb) }} → <b>{{ money(stockBatchResultingCost(item)) }}</b> · รวม {{ money(stockBatchLineCost(item)) }}</small></label><div v-else class="min-w-0 max-w-full overflow-hidden rounded-xl bg-paper-100 p-3 dark:bg-stone-800"><small class="font-bold text-stone-500">ต้นทุนเฉลี่ย/หน่วย</small><b class="mt-1 block truncate">{{ money(item.product.costThb) }}</b><small class="mt-1 block font-semibold text-stone-500">รวม {{ money(stockBatchLineCost(item)) }}</small></div>
            </article>
            <p v-if="!visibleStockBatchItems().length" class="rounded-xl border border-dashed p-8 text-center text-stone-500 dark:border-stone-700">ไม่พบสินค้า</p>
          </div>
          <label class="mt-5 grid min-w-0 max-w-full gap-2 font-black"><span>หมายเหตุรายการ</span><input v-model="stockModal.note" class="h-12 min-w-0 w-full max-w-full rounded-xl border border-stone-200 bg-paper-50 px-4 outline-none transition focus:border-court-500 focus:ring-2 focus:ring-court-500/15 dark:border-stone-700 dark:bg-stone-800" placeholder="ระบุเลขที่เอกสารหรือเหตุผล (ถ้ามี)" /></label>
        </div>
        <footer class="grid shrink-0 gap-3 border-t bg-white p-4 dark:border-stone-700 dark:bg-stone-900 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:px-5"><div><small class="font-bold text-stone-500">รวม {{ stockModal.items.filter(item=>item.selected).length }} สินค้า</small><b class="block text-lg">มูลค่า {{ money(selectedStockBatchTotalCost()) }}</b></div><button type="button" class="h-12 rounded-xl border border-stone-300 px-6 font-black dark:border-stone-600" @click="stockModal=null">ยกเลิก</button><button class="h-12 rounded-xl bg-court-500 px-6 font-black text-white shadow-soft disabled:opacity-50" :disabled="saving||!stockModal.name.trim()||!stockModal.items.some(item=>item.selected)">บันทึกรายการรวม</button></footer>
      </form>
    </div>
  </section>
</template>
