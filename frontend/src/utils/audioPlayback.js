export function playAudioUntilEnded(audio, options = {}) {
  const fallbackTimeoutMs = Number(options.fallbackTimeoutMs || 60000)
  const safetyPaddingMs = Number(options.safetyPaddingMs || 5000)
  let settled = false
  let safetyTimer = null
  let resolvePromise
  let rejectPromise

  const clearSafetyTimer = () => {
    if (safetyTimer) window.clearTimeout(safetyTimer)
    safetyTimer = null
  }
  const cleanup = () => {
    clearSafetyTimer()
    audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
    audio.removeEventListener('ended', finish)
    audio.removeEventListener('error', fail)
  }
  const finish = () => {
    if (settled) return
    settled = true
    cleanup()
    resolvePromise()
  }
  const fail = (error) => {
    if (settled) return
    settled = true
    cleanup()
    audio.pause?.()
    rejectPromise(error instanceof Error ? error : new Error('audio playback failed'))
  }
  const setSafetyTimer = (timeoutMs) => {
    clearSafetyTimer()
    safetyTimer = window.setTimeout(() => fail(new Error('audio playback timed out')), timeoutMs)
  }
  const handleLoadedMetadata = () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      // Deadlock guard only. Normal completion always comes from the real `ended` event.
      setSafetyTimer(Math.ceil(audio.duration * 1000) + safetyPaddingMs)
    }
  }

  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  audio.addEventListener('loadedmetadata', handleLoadedMetadata)
  audio.addEventListener('ended', finish, { once: true })
  audio.addEventListener('error', fail, { once: true })
  setSafetyTimer(fallbackTimeoutMs)
  audio.play().catch(fail)

  return { promise, cancel: finish }
}
