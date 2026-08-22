<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Download } from '@lucide/vue'

const deferredPrompt = ref(null)
const installed = ref(false)
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)

const isStandalone = () =>
  (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
  window.navigator.standalone === true
const visible = computed(() => !installed.value && !isStandalone() && (Boolean(deferredPrompt.value) || isIos))

function capturePrompt(event) {
  event.preventDefault()
  deferredPrompt.value = event
}

function markInstalled() {
  installed.value = true
  deferredPrompt.value = null
}

async function install() {
  if (!deferredPrompt.value) {
    window.alert('บน iPhone/iPad ให้แตะปุ่มแชร์ใน Safari แล้วเลือก “เพิ่มไปยังหน้าจอโฮม”')
    return
  }

  deferredPrompt.value.prompt()
  await deferredPrompt.value.userChoice
  deferredPrompt.value = null
}

onMounted(() => {
  installed.value = isStandalone()
  window.addEventListener('beforeinstallprompt', capturePrompt)
  window.addEventListener('appinstalled', markInstalled)
})

onUnmounted(() => {
  window.removeEventListener('beforeinstallprompt', capturePrompt)
  window.removeEventListener('appinstalled', markInstalled)
})
</script>

<template>
  <button
    v-if="visible"
    class="inline-flex h-9 items-center gap-1.5 rounded-xl border border-court-200 bg-white px-2.5 text-xs font-black text-court-700 transition hover:bg-court-500/10 dark:border-court-900 dark:bg-stone-800 dark:text-court-300 sm:h-10 sm:px-3"
    type="button"
    title="ติดตั้ง LiveMatch บนอุปกรณ์นี้"
    @click="install"
  >
    <Download class="h-4 w-4" />
    <span class="hidden sm:inline">ติดตั้งแอป</span>
  </button>
</template>
