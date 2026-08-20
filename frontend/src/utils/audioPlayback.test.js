import { afterEach, describe, expect, it, vi } from 'vitest'
import { playAudioUntilEnded } from './audioPlayback.js'

class FakeAudio extends EventTarget {
  constructor(duration) {
    super()
    this.duration = duration
    this.play = vi.fn().mockResolvedValue(undefined)
    this.pause = vi.fn()
  }
}

describe('playAudioUntilEnded', () => {
  afterEach(() => vi.useRealTimers())

  it('does not finish at the old 2.2 second cutoff and waits for ended', async () => {
    vi.useFakeTimers()
    const audio = new FakeAudio(8)
    const playback = playAudioUntilEnded(audio)
    let finished = false
    playback.promise.then(() => { finished = true })

    audio.dispatchEvent(new Event('loadedmetadata'))
    await vi.advanceTimersByTimeAsync(2200)
    expect(finished).toBe(false)

    audio.dispatchEvent(new Event('ended'))
    await playback.promise
    expect(finished).toBe(true)
  })

  it('can be cancelled cleanly when a newer announcement starts', async () => {
    vi.useFakeTimers()
    const audio = new FakeAudio(8)
    const playback = playAudioUntilEnded(audio)
    playback.cancel()
    await expect(playback.promise).resolves.toBeUndefined()
  })
})
