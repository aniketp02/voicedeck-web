import { useCallback, useEffect, useMemo, useRef } from 'react'

export interface AudioPlayerControls {
  initSession: () => void
  onChunk: (base64: string) => void
  onDone: () => void
  stop: () => void
}

/**
 * Stream MP3 TTS chunks via MediaSource (MSE). First onChunk lazily starts a session.
 * @param onAssistantPlaybackEnded — invoked when assistant audio stops (natural end, empty stream, or interrupt).
 */
export function useAudioPlayer(
  onAssistantPlaybackEnded?: () => void,
): AudioPlayerControls {
  const onAssistantPlaybackEndedRef = useRef(onAssistantPlaybackEnded)
  useEffect(() => {
    onAssistantPlaybackEndedRef.current = onAssistantPlaybackEnded
  }, [onAssistantPlaybackEnded])

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mediaSourceRef = useRef<MediaSource | null>(null)
  const sourceBufferRef = useRef<SourceBuffer | null>(null)
  const chunkQueueRef = useRef<Uint8Array[]>([])
  const isAppendingRef = useRef(false)
  /** Consecutive appendBuffer failures (quota/timing); reset on success or new session). */
  const appendFailureCountRef = useRef(0)
  /** After first successful SourceBuffer append (MPEG decode is picky about first segment). */
  const firstAppendDoneRef = useRef(false)
  /** Server sent tts_done — allow flushing a final small remainder (< min hold). */
  const ttsChunksFinishedRef = useRef(false)
  /** True while a TTS stream is active (until onDone teardown). */
  const sessionActiveRef = useRef(false)
  /** True from stop() until the next initSession() — blocks onChunk lazy-init. */
  const stoppingRef = useRef(false)
  /** Fired after audio actually starts (avoids spurious audio.ended before first decode). */
  const playbackStartedRef = useRef(false)
  const objectUrlRef = useRef<string | null>(null)

  const appendNextRef = useRef<() => void>(() => {})

  const teardown = useCallback((notifyPlaybackEnded = false) => {
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
    appendFailureCountRef.current = 0
    firstAppendDoneRef.current = false
    ttsChunksFinishedRef.current = false
    playbackStartedRef.current = false
    sessionActiveRef.current = false
    if (notifyPlaybackEnded) {
      onAssistantPlaybackEndedRef.current?.()
    }
  }, [])

  const appendNext = useCallback(() => {
    const sb = sourceBufferRef.current
    const ms = mediaSourceRef.current
    const q = chunkQueueRef.current
    if (!sb || isAppendingRef.current || q.length === 0) return
    if (ms?.readyState !== 'open') return
    if (sb.updating) return

    // MP3 over MSE: arbitrary chunk sizes (e.g. 4KiB) often split MPEG frames; the
    // decoder skips to the next sync word → missing beginnings / mid-stream gaps.
    // Coalesce appends and hold the first append until we have enough bytes for a
    // clean frame boundary (ElevenLabs yields larger chunks so this hid the issue).
    // ~4–5 MP3 frames; lower = less wait before first decode (Deepgram TTFB + this = perceived lag).
    const MIN_FIRST_BYTES = 4096
    const MERGE_TARGET_BYTES = 32768

    let totalQueued = 0
    for (const c of q) {
      totalQueued += c.length
    }

    if (!firstAppendDoneRef.current && !ttsChunksFinishedRef.current) {
      if (totalQueued < MIN_FIRST_BYTES && q.length === 1) {
        return
      }
    }

    const parts: Uint8Array[] = []
    let mergedLen = 0
    while (q.length > 0 && mergedLen < MERGE_TARGET_BYTES) {
      parts.push(q.shift()!)
      mergedLen += parts[parts.length - 1]!.length
    }
    if (parts.length === 0) return

    let toAppend: Uint8Array
    if (parts.length === 1) {
      toAppend = parts[0]!
    } else {
      toAppend = new Uint8Array(mergedLen)
      let off = 0
      for (const p of parts) {
        toAppend.set(p, off)
        off += p.length
      }
    }

    isAppendingRef.current = true
    try {
      const copy = toAppend.slice()
      sb.appendBuffer(copy)
      firstAppendDoneRef.current = true
      appendFailureCountRef.current = 0
    } catch {
      isAppendingRef.current = false
      chunkQueueRef.current.unshift(toAppend)
      appendFailureCountRef.current += 1
      if (appendFailureCountRef.current < 16) {
        window.setTimeout(() => appendNextRef.current(), 50)
      } else {
        console.warn('MSE appendBuffer failed repeatedly; ending assistant playback')
        teardown(true)
      }
    }
  }, [teardown])

  useEffect(() => {
    appendNextRef.current = appendNext
  }, [appendNext])

  const initSession = useCallback(() => {
    stoppingRef.current = false
    // Avoid tearing down a session that onChunk already started (lazy init + Plan 05 rising-edge effect).
    if (sessionActiveRef.current && mediaSourceRef.current) {
      return
    }

    teardown(false)

    sessionActiveRef.current = true
    chunkQueueRef.current = []
    isAppendingRef.current = false
    appendFailureCountRef.current = 0
    firstAppendDoneRef.current = false
    ttsChunksFinishedRef.current = false

    const audio = new Audio()
    audioRef.current = audio
    audio.addEventListener(
      'playing',
      () => {
        playbackStartedRef.current = true
      },
      { once: true },
    )
    // Do not teardown on generic 'error' — spurious events during MSE attach/seek
    // were clearing agent state before playback (orb → listening with no audio).

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
      if (stoppingRef.current) return

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
    ttsChunksFinishedRef.current = true
    // Unblock min-byte hold for short single-chunk streams (< MIN_FIRST_BYTES).
    appendNextRef.current()

    const startDrain = () => {
      const ms = mediaSourceRef.current
      if (!ms || ms.readyState !== 'open') {
        return false
      }

      const finish = () => {
        try {
          ms.endOfStream()
        } catch {
          /* already ended */
        }
        sessionActiveRef.current = false
        const audio = audioRef.current
        if (!audio) {
          teardown(true)
          return
        }

        const onPlaybackFinished = () => teardown(true)

        // After endOfStream(), some engines briefly set ended===true before any PCM is
        // emitted; the old `else { teardown(true) }` then cleared React (orb → listening)
        // right when decode/play began.
        const hasBufferedAudio = () =>
          audio.buffered.length > 0 && audio.buffered.end(audio.buffered.length - 1) > 0.02

        if (!audio.ended) {
          audio.addEventListener('ended', onPlaybackFinished, { once: true })
          return
        }

        const dur = audio.duration
        const ct = audio.currentTime
        const naturalEnd =
          playbackStartedRef.current &&
          Number.isFinite(dur) &&
          dur > 0 &&
          dur !== Number.POSITIVE_INFINITY &&
          ct >= dur - 0.25

        if (naturalEnd) {
          teardown(true)
          return
        }

        if (hasBufferedAudio()) {
          playbackStartedRef.current = false
          audio.addEventListener('ended', onPlaybackFinished, { once: true })
          void audio.play().catch(() => onPlaybackFinished())
          return
        }

        teardown(true)
      }

      const drain = window.setInterval(() => {
        const sb = sourceBufferRef.current
        if (
          !sb?.updating &&
          !isAppendingRef.current &&
          chunkQueueRef.current.length === 0
        ) {
          clearInterval(drain)
          finish()
        }
      }, 50)
      return true
    }

    if (startDrain()) {
      return
    }

    // tts_done can arrive before MediaSource 'sourceopen' (e.g. Deepgram sends the full
    // stream then done in one burst). Never teardown(true) here — that would call
    // endAssistantPlayback() and drop the orb to "listening" before audio plays.
    if (sessionActiveRef.current || chunkQueueRef.current.length > 0) {
      let attempts = 0
      const maxAttempts = 160 // ~4s at 25ms — enough for sourceopen + append

      const retry = () => {
        if (startDrain()) {
          return
        }
        attempts++
        if (attempts < maxAttempts && (sessionActiveRef.current || chunkQueueRef.current.length > 0)) {
          window.setTimeout(retry, 25)
          return
        }
        // Truly no audio (empty TTS) or stuck — release assistant UI
        teardown(true)
      }
      window.setTimeout(retry, 0)
      return
    }

    teardown(true)
  }, [teardown])

  const stop = useCallback(() => {
    stoppingRef.current = true
    sessionActiveRef.current = false
    chunkQueueRef.current = []
    isAppendingRef.current = false

    const audio = audioRef.current
    if (!audio || audio.paused) {
      teardown(true)
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
        teardown(true)
        return
      }
      audio.volume = initialVolume * (1 - elapsed / FADE_MS)
      requestAnimationFrame(ramp)
    }

    requestAnimationFrame(ramp)
  }, [teardown])

  useEffect(() => () => teardown(false), [teardown])

  return useMemo(
    () => ({ initSession, onChunk, onDone, stop }),
    [initSession, onChunk, onDone, stop],
  )
}
