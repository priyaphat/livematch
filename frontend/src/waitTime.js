import { onBeforeUnmount, onMounted, ref } from 'vue'

export function waitMinutes(waitStartedAt, now = Date.now()) {
  const startedAt = Date.parse(waitStartedAt || '')
  if (!Number.isFinite(startedAt)) return null
  return Math.max(0, Math.floor((now - startedAt) / 60000))
}

export function useWaitClock() {
  const now = ref(Date.now())
  let timer = null

  onMounted(() => {
    timer = window.setInterval(() => {
      now.value = Date.now()
    }, 15000)
  })
  onBeforeUnmount(() => {
    if (timer) window.clearInterval(timer)
  })

  return now
}
