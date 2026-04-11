import { useCallback, useEffect, useMemo, useRef } from 'react'

export interface AudioPlayerControls {
  initSession: () => void
  onChunk: (base64: string) => void
  onDone: () => void
  stop: () => void
}

/**
 * Stream MP3 TTS chunks via MediaSource (MSE). First onChunk lazily starts a session.
 */
export function useAudioPlayer(): AudioPlayerControls {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mediaSourceRef = useRef<MediaSource | null>(null)
  const sourceBufferRef = useRef<SourceBuffer | null>(null)
  const chunkQueueRef = useRef<Uint8Array[]>([])
  const isAppendingRef = useRef(false)
  /** True while a TTS stream is active (until onDone teardown). */
  const sessionActiveRef = useRef(false)
  const objectUrlRef = useRef<string | null>(null)

  const appendNextRef = useRef<() => void>(() => {})

  const teardown = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    audioRef.current?.pause()
    audioRef.current = null
    mediaSourceRef.current = null
    sourceBufferRef.current = null
    chunkQueueRef.current = []
    isAppendingRef.current = false
    sessionActiveRef.current = false
  }, [])

  const appendNext = useCallback(() => {
    const sb = sourceBufferRef.current
    const ms = mediaSourceRef.current
    if (!sb || isAppendingRef.current || chunkQueueRef.current.length === 0) return
    if (ms?.readyState !== 'open') return
    if (sb.updating) return

    isAppendingRef.current = true
    const chunk = chunkQueueRef.current.shift()!
    try {
      // Copy so buffer is a plain ArrayBuffer (TS strict + MSE compatibility)
      const copy = chunk.slice()
      sb.appendBuffer(copy)
    } catch {
      isAppendingRef.current = false
    }
  }, [])

  useEffect(() => {
    appendNextRef.current = appendNext
  }, [appendNext])

  const initSession = useCallback(() => {
    // Avoid tearing down a session that onChunk already started (lazy init + Plan 05 rising-edge effect).
    if (sessionActiveRef.current && mediaSourceRef.current) {
      return
    }

    teardown()

    sessionActiveRef.current = true
    chunkQueueRef.current = []
    isAppendingRef.current = false

    const audio = new Audio()
    audioRef.current = audio

    const ms = new MediaSource()
    mediaSourceRef.current = ms
    const url = URL.createObjectURL(ms)
    objectUrlRef.current = url
    audio.src = url

    ms.addEventListener('sourceopen', () => {
      if (!sessionActiveRef.current) return
      try {
        const sb = ms.addSourceBuffer('audio/mpeg')
        sourceBufferRef.current = sb
        sb.addEventListener('updateend', () => {
          isAppendingRef.current = false
          appendNextRef.current()
        })
        appendNextRef.current()
      } catch (e) {
        console.warn('MSE SourceBuffer creation failed, audio may not play:', e)
      }
    })

    void audio.play().catch(() => {
      /* autoplay may require user gesture — mic click satisfies this */
    })
  }, [teardown])

  const onChunk = useCallback(
    (base64: string) => {
      if (!sessionActiveRef.current) {
        initSession()
      }

      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      chunkQueueRef.current.push(bytes)
      appendNext()
    },
    [appendNext, initSession],
  )

  const onDone = useCallback(() => {
    const ms = mediaSourceRef.current
    if (!ms || ms.readyState !== 'open') {
      teardown()
      return
    }

    const finish = () => {
      try {
        ms.endOfStream()
      } catch {
        /* already ended */
      }
      sessionActiveRef.current = false
      const audio = audioRef.current
      if (audio && !audio.ended) {
        audio.addEventListener('ended', () => teardown(), { once: true })
      } else {
        teardown()
      }
    }

    const drain = window.setInterval(() => {
      const sb = sourceBufferRef.current
      if (!sb?.updating && chunkQueueRef.current.length === 0) {
        clearInterval(drain)
        finish()
      }
    }, 50)
  }, [teardown])

  const stop = useCallback(() => {
    sessionActiveRef.current = false
    chunkQueueRef.current = []
    isAppendingRef.current = false

    const audio = audioRef.current
    if (!audio || audio.paused) {
      teardown()
      return
    }

    // 120ms volume ramp-down before pause — prevents jarring click
    const initialVolume = audio.volume
    const startTime = performance.now()
    const FADE_MS = 120

    const ramp = () => {
      const elapsed = performance.now() - startTime
      if (elapsed >= FADE_MS) {
        audio.volume = 0
        audio.pause()
        audio.volume = initialVolume // restore for next session
        teardown()
        return
      }
      audio.volume = initialVolume * (1 - elapsed / FADE_MS)
      requestAnimationFrame(ramp)
    }

    requestAnimationFrame(ramp)
  }, [teardown])

  useEffect(() => () => teardown(), [teardown])

  return useMemo(
    () => ({ initSession, onChunk, onDone, stop }),
    [initSession, onChunk, onDone, stop],
  )
}
