# Frontend Plan 03 — TTS Audio Playback

## Goal
Receive base64 MP3 chunks from the backend and play them through the
browser's Web Audio API with minimal latency. Chunks must play in order
and without gaps.

**Success criterion:** AI voice plays in the browser within ~500ms of
the agent finishing its text generation.

## Prerequisite
Plans 01 and 02 complete. Backend Plan 04 (TTS) must also be done.

## Strategy: MediaSource Extensions (MSE)

MP3 chunks from ElevenLabs form a continuous stream.
Use `MediaSource` + `SourceBuffer` to feed chunks to an `<audio>` element
as they arrive — this gives us seamless gapless playback.

**Fallback**: If MSE is unavailable (rare), concatenate all chunks and play
the whole file after `tts_done`. Less responsive but functional.

## Hook: `src/hooks/useAudioPlayer.ts`

```typescript
import { useCallback, useEffect, useRef } from 'react'

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mediaSourceRef = useRef<MediaSource | null>(null)
  const sourceBufferRef = useRef<SourceBuffer | null>(null)
  const chunkQueueRef = useRef<Uint8Array[]>([])
  const isAppendingRef = useRef(false)

  // Initialize a fresh MediaSource + audio element for each TTS session
  const initMediaSource = useCallback(() => {
    // Clean up previous
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
    }

    const audio = new Audio()
    audioRef.current = audio
    chunkQueueRef.current = []
    isAppendingRef.current = false

    const ms = new MediaSource()
    mediaSourceRef.current = ms
    audio.src = URL.createObjectURL(ms)

    ms.addEventListener('sourceopen', () => {
      try {
        const sb = ms.addSourceBuffer('audio/mpeg')
        sourceBufferRef.current = sb

        sb.addEventListener('updateend', () => {
          isAppendingRef.current = false
          appendNextChunk()
        })

        appendNextChunk()
      } catch (e) {
        console.error('SourceBuffer creation failed:', e)
      }
    })

    audio.play().catch(() => {
      // Autoplay blocked — user must interact first. VoiceButton click handles this.
    })
  }, [])

  const appendNextChunk = useCallback(() => {
    const sb = sourceBufferRef.current
    const ms = mediaSourceRef.current
    if (!sb || isAppendingRef.current || chunkQueueRef.current.length === 0) return
    if (ms?.readyState !== 'open') return

    isAppendingRef.current = true
    const chunk = chunkQueueRef.current.shift()!
    try {
      sb.appendBuffer(chunk)
    } catch (e) {
      isAppendingRef.current = false
      console.error('appendBuffer failed:', e)
    }
  }, [])

  const onTTSChunk = useCallback((base64: string) => {
    // Decode base64 → Uint8Array
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }

    chunkQueueRef.current.push(bytes)
    appendNextChunk()
  }, [appendNextChunk])

  const onTTSDone = useCallback(() => {
    // End the MediaSource stream gracefully
    const ms = mediaSourceRef.current
    if (ms?.readyState === 'open') {
      // Wait for buffer to drain before ending
      const drain = setInterval(() => {
        const sb = sourceBufferRef.current
        if (!sb?.updating && chunkQueueRef.current.length === 0) {
          clearInterval(drain)
          try { ms.endOfStream() } catch (_) {}
        }
      }, 50)
    }
  }, [])

  const stop = useCallback(() => {
    audioRef.current?.pause()
    chunkQueueRef.current = []
  }, [])

  return { initMediaSource, onTTSChunk, onTTSDone, stop }
}
```

## Wire into `useWebSocket.ts`

In `useWebSocket.ts`, the `onTTSChunk` and `onTTSDone` ref callbacks are
already set up. After `useAudioPlayer` is created in `App.tsx`, pass the
callbacks in:

```typescript
// In App.tsx, after both hooks are created:
const { initMediaSource, onTTSChunk, onTTSDone, stop: stopAudio } = useAudioPlayer()
const { state, connect, disconnect, send, onTTSChunk: ttsChunkRef, onTTSDone: ttsDoneRef } = useWebSocket()

// Wire them up once on mount:
useEffect(() => {
  ttsChunkRef.current = (data: string) => {
    // Init media source on first chunk of each TTS session
    onTTSChunk(data)
  }
  ttsDoneRef.current = onTTSDone
}, [onTTSChunk, onTTSDone])

// When TTS starts, init a new MediaSource:
useEffect(() => {
  if (state.isTTSSpeaking) {
    initMediaSource()
  }
}, [state.isTTSSpeaking])
```

## Alternative: Simple Blob Concatenation (fallback)

If MediaSource gives you trouble, use this simpler approach
(higher latency — plays only after `tts_done`):

```typescript
export function useAudioPlayerSimple() {
  const chunksRef = useRef<Uint8Array[]>([])

  const onTTSChunk = useCallback((base64: string) => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    chunksRef.current.push(bytes)
  }, [])

  const onTTSDone = useCallback(() => {
    const total = chunksRef.current.reduce((s, c) => s + c.length, 0)
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunksRef.current) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    chunksRef.current = []
    const blob = new Blob([merged], { type: 'audio/mpeg' })
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.play()
    audio.onended = () => URL.revokeObjectURL(url)
  }, [])

  return { onTTSChunk, onTTSDone, stop: () => { chunksRef.current = [] } }
}
```

**Recommendation**: Start with the simple fallback to get things working,
then upgrade to MediaSource for production quality.

## Verification
1. Complete backend Plan 04 first
2. Start both servers, open app, connect, click mic
3. Ask a question → hear the AI respond in audio
4. Check browser DevTools → Network → WS → verify `tts_chunk` messages arriving
5. Audio should start within ~500ms of agent finishing
