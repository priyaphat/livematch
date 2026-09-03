<script setup>
import { Loader2, Search, X } from '@lucide/vue'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  apiRequest: { type: Function, default: null }
})
const emit = defineEmits(['update:modelValue'])

const root = ref(null)
const input = ref(null)
const query = ref('')
const options = ref([])
const open = ref(false)
const loading = ref(false)
let timer
let requestNumber = 0

const productLabel = (product) => [product.name, product.sku ? `SKU ${product.sku}` : '', product.barcode ? `บาร์โค้ด ${product.barcode}` : ''].filter(Boolean).join(' · ')
const stockLabel = (product) => `${Number(product.saleStockQuantity ?? product.stockQuantity ?? 0).toLocaleString('th-TH')} ${product.unit || 'หน่วย'}`

async function searchProducts(search = '') {
  if (!props.apiRequest) {
    options.value = []
    return
  }
  const currentRequest = ++requestNumber
  loading.value = true
  try {
    const params = new URLSearchParams({ page: '1', pageSize: '100', status: 'active', search })
    const result = await props.apiRequest(`/api/admin/pos/products?${params}`)
    if (currentRequest !== requestNumber) return
    options.value = (result?.items || []).filter((product) => product.trackStock !== false && product.active !== false)
    const selected = options.value.find((product) => product.id === props.modelValue)
    if (selected && (!query.value || query.value === props.modelValue)) query.value = productLabel(selected)
  } catch {
    if (currentRequest === requestNumber) options.value = []
  } finally {
    if (currentRequest === requestNumber) loading.value = false
  }
}

function handleInput(event) {
  query.value = event.target.value
  open.value = true
  window.clearTimeout(timer)
  timer = window.setTimeout(() => searchProducts(query.value.trim()), 300)
}

function selectProduct(product) {
  emit('update:modelValue', product.id)
  query.value = productLabel(product)
  open.value = false
}

function clearProduct() {
  emit('update:modelValue', '')
  query.value = ''
  open.value = true
  void searchProducts('')
  nextTick(() => input.value?.focus())
}

function handleOutside(event) {
  if (!root.value?.contains(event.target)) open.value = false
}

watch(() => props.modelValue, async (value) => {
  if (!value) {
    query.value = ''
    return
  }
  const selected = options.value.find((product) => product.id === value)
  if (selected) query.value = productLabel(selected)
  else {
    query.value = value
    await searchProducts(value)
  }
}, { immediate: true })

onMounted(() => {
  document.addEventListener('mousedown', handleOutside)
  if (!props.modelValue) void searchProducts('')
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleOutside)
  window.clearTimeout(timer)
})
</script>

<template>
  <div ref="root" class="relative min-w-0">
    <div class="relative">
      <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
      <input ref="input" :value="query" role="combobox" :aria-expanded="open" autocomplete="off" class="h-10 w-full rounded-md border border-stone-200 bg-white pl-9 pr-16 text-sm font-semibold dark:border-stone-700 dark:bg-stone-900" placeholder="ค้นหาชื่อ, SKU หรือบาร์โค้ด" @focus="open=true; searchProducts(query.trim())" @input="handleInput" />
      <div class="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        <Loader2 v-if="loading" class="h-4 w-4 animate-spin text-court-600" />
        <button v-if="modelValue || query" type="button" class="grid h-7 w-7 place-items-center rounded text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800" aria-label="ยกเลิกการเชื่อมสินค้า" @click="clearProduct"><X class="h-4 w-4" /></button>
      </div>
    </div>
    <div v-if="open" class="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-stone-200 bg-white p-1 shadow-xl dark:border-stone-700 dark:bg-stone-900">
      <button type="button" class="w-full rounded-md px-3 py-2 text-left text-sm font-bold text-stone-500 hover:bg-paper-100 dark:hover:bg-stone-800" @click="clearProduct">ไม่เชื่อมสต็อก POS</button>
      <button v-for="product in options" :key="product.id" type="button" class="grid w-full grid-cols-[1fr_auto] gap-3 rounded-md px-3 py-2 text-left hover:bg-court-500/10" @click="selectProduct(product)">
        <span class="min-w-0"><b class="block truncate text-sm">{{ product.name }}</b><small class="block truncate font-semibold text-stone-500">{{ [product.sku, product.barcode].filter(Boolean).join(' · ') || 'ไม่มี SKU/บาร์โค้ด' }}</small></span>
        <span class="self-center whitespace-nowrap text-xs font-black text-court-700 dark:text-court-300">คงเหลือ {{ stockLabel(product) }}</span>
      </button>
      <p v-if="!loading && !options.length" class="px-3 py-5 text-center text-sm font-bold text-stone-500">ไม่พบสินค้าที่เปิดติดตามสต็อก</p>
    </div>
  </div>
</template>
