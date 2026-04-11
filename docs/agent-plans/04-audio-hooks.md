# Frontend Agent Plan 04 — Audio Capture + Audio Playback Hooks

## Agent Instructions
Read this plan fully before acting. Do not ask questions. All decisions are made.
Plan 03 must be complete (useWebSocket working, slides rendering from backend).

---

## Goal
Implement two audio hooks:
1. `useAudioCapture` — mic → 16kHz PCM → base64 → WebSocket `audio_chunk` messages
2. `useAudioPlayer` — receive base64 MP3 `tts_chunk` messages → play via Web Audio

Also implement a `MicButton` component for the orb panel (start/stop capture).

**Success criterion:**
- Speaking into mic → backend logs show `Final transcript: "your words"`
- AI response → audio plays in browser

---

## Task 1: Create `src/lib/audioUtils.ts`

```typescript
/**
 * Convert Float32Array (Web Audio API native format) to Int16Array (PCM linear16).
 * Backend Deepgram config: linear16, 16000 Hz, mono.
 */
export function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]))
    int16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767
  }
  return int16
}

/**
 * Encode Int16Array as base64 string for WebSocket transmission.
 */
export function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Calculate RMS amplitude (0–1) of a Float32Array.
 * Used for VAD (voice activity detection).
 */
export function getRMSLevel(float32: Float32Array): number {
  let sum = 0
  for (let i = 0; i < float32.length; i++) {
    sum += float32[i] * float32[i]
  }
  return Math.sqrt(sum / float32.length)
}

/**
 * Decode base64 string to Uint8Array.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
```

---

## Task 2: Create `src/hooks/useAudioCapture.ts`

Captures mic audio at 16kHz mono, converts to PCM, and streams to backend.
Uses `ScriptProcessorNode` (deprecated but universally supported for MVP).

VAD detection: RMS > threshold → `isUserSpeaking = true`.
Interrupt logic: if `isUserSpeaking` while `isTTSActive` → send interrupt.

```typescript
import { useCallback, useRef, useState } from 'react'
import { float32ToInt16, int16ToBase64, getRMSLevel } from '../lib/audioUtils'
import type { ClientMessage } from '../types/protocol'

const SAMPLE_RATE = 16000
const BUFFER_SIZE = 1600        // 100ms at 16kHz
const VAD_THRESHOLD = 0.012     // RMS level to consider as voice activity
const VAD_RELEASE_FRAMES = 8    // frames of silence before declaring voice stopped

interface UseAudioCaptureOptions {
  onChunk: (msg: ClientMessage) => void       // send audio_chunk to backend
  onInterrupt: () => void                     // called when user speaks over TTS
  isTTSActive: boolean                        // from wsState.isTTSActive
}

export interface AudioCaptureState {
  isCapturing: boolean
  isUserSpeaking: boolean
  rmsLevel: number    // 0–1, for orb animation
}

export function useAudioCapture({
  onChunk,
  onInterrupt,
  isTTSActive,
}: UseAudioCaptureOptions): [AudioCaptureState, { start: () => Promise<void>; stop: () => void }] {
  const [isCapturing, setIsCapturing] = useState(false)
  const [isUserSpeaking, setIsUserSpeaking] = useState(false)
  const [rmsLevel, setRmsLevel] = useState(0)

  const contextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const silenceFramesRef = useRef(0)
  const isTTSActiveRef = useRef(isTTSActive)

  // Keep ref in sync with prop (avoids stale closure in onaudioprocess)
  isTTSActiveRef.current = isTTSActive

  const start = useCallback(async () => {
    if (isCapturing) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream

      const context = new AudioContext({ sampleRate: SAMPLE_RATE })
      contextRef.current = context

      const source = context.createMediaStreamSource(stream)
      // ScriptProcessorNode is deprecated but works in all browsers for MVP
      const processor = context.createScriptProcessor(BUFFER_SIZE, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (e) => {
        const float32 = e.inputBuffer.getChannelData(0)
        const rms = getRMSLevel(float32)

        // Update RMS for orb animation
        setRmsLevel(rms)

        // VAD
        const voiceActive = rms > VAD_THRESHOLD
        if (voiceActive) {
          silenceFramesRef.current = 0
          setIsUserSpeaking(true)

          // Interrupt TTS if AI is speaking
          if (isTTSActiveRef.current) {
            onInterrupt()
          }
        } else {
          silenceFramesRef.current++
          if (silenceFramesRef.current >= VAD_RELEASE_FRAMES) {
            setIsUserSpeaking(false)
          }
        }

        // Always send audio to backend (Deepgram does server-side VAD too)
        const int16 = float32ToInt16(float32)
        const data = int16ToBase64(int16)
        onChunk({ type: 'audio_chunk', data })
      }

      source.connect(processor)
      processor.connect(context.destination)
      setIsCapturing(true)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        console.error('Microphone permission denied')
      } else {
        console.error('Failed to start audio capture:', err)
      }
    }
  }, [isCapturing, onChunk, onInterrupt])

  const stop = useCallback(() => {
    processorRef.current?.disconnect()
    contextRef.current?.close()
    streamRef.current?.getTracks().forEach(t => t.stop())
    processorRef.current = null
    contextRef.current = null
    streamRef.current = null
    setIsCapturing(false)
    setIsUserSpeaking(false)
    setRmsLevel(0)
    silenceFramesRef.current = 0
  }, [])

  return [
    { isCapturing, isUserSpeaking, rmsLevel },
    { start, stop },
  ]
}
```

---

## Task 3: Create `src/hooks/useAudioPlayer.ts`

Receives base64 MP3 chunks and plays them via the Web Audio API.

Strategy:
- **Primary**: MediaSource Extensions (MSE) — gapless streaming playback
- **Fallback**: Collect all chunks, play complete blob on `tts_done` — simpler but higher latency

Implement primary first. If MSE gives browser issues, the fallback is documented at the bottom.

```typescript
import { useCallback, useRef } from 'react'

export interface AudioPlayerControls {
  initSession: () => void           // call when first tts_chunk arrives
  onChunk: (base64: string) => void // feed each tts_chunk
  onDone: () => void                // call on tts_done
  stop: () => void                  // interrupt playback immediately
}

export function useAudioPlayer(): AudioPlayerControls {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mediaSourceRef = useRef<MediaSource | null>(null)
  const sourceBufferRef = useRef<SourceBuffer | null>(null)
  const chunkQueueRef = useRef<Uint8Array[]>([])
  const isAppendingRef = useRef(false)
  const sessionActiveRef = useRef(false)

  const appendNext = useCallback(() => {
    const sb = sourceBufferRef.current
    const ms = mediaSourceRef.current
    if (!sb || isAppendingRef.current || chunkQueueRef.current.length === 0) return
    if (ms?.readyState !== 'open') return
    if (sb.updating) return

    isAppendingRef.current = true
    const chunk = chunkQueueRef.current.shift()!
    try {
      sb.appendBuffer(chunk)
    } catch {
      isAppendingRef.current = false
    }
  }, [])

  const initSession = useCallback(() => {
    // Tear down previous session
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
    }
    chunkQueueRef.current = []
    isAppendingRef.current = false
    sessionActiveRef.current = true

    const audio = new Audio()
    audioRef.current = audio

    const ms = new MediaSource()
    mediaSourceRef.current = ms
    audio.src = URL.createObjectURL(ms)

    ms.addEventListener('sourceopen', () => {
      if (!sessionActiveRef.current) return
      try {
        const sb = ms.addSourceBuffer('audio/mpeg')
        sourceBufferRef.current = sb
        sb.addEventListener('updateend', () => {
          isAppendingRef.current = false
          appendNext()
        })
        appendNext() // drain any chunks that arrived before sourceopen
      } catch (e) {
        console.warn('MSE SourceBuffer creation failed, audio may not play:', e)
      }
    })

    audio.play().catch(() => {
      // Autoplay blocked — requires prior user gesture (MicButton click handles this)
    })
  }, [appendNext])

  const onChunk = useCallback((base64: string) => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    chunkQueueRef.current.push(bytes)
    appendNext()
  }, [appendNext])

  const onDone = useCallback(() => {
    const ms = mediaSourceRef.current
    if (ms?.readyState !== 'open') return

    const drain = setInterval(() => {
      const sb = sourceBufferRef.current
      if (!sb?.updating && chunkQueueRef.current.length === 0) {
        clearInterval(drain)
        try { ms.endOfStream() } catch { /* already ended */ }
      }
    }, 50)
  }, [])

  const stop = useCallback(() => {
    sessionActiveRef.current = false
    audioRef.current?.pause()
    chunkQueueRef.current = []
    isAppendingRef.current = false
  }, [])

  return { initSession, onChunk, onDone, stop }
}

/*
 * FALLBACK: useAudioPlayerSimple
 * If MSE causes issues (rare), swap useAudioPlayer for this.
 * Higher latency (plays only after tts_done) but simpler.
 *
 * export function useAudioPlayerSimple(): AudioPlayerControls {
 *   const chunks = useRef<Uint8Array[]>([])
 *
 *   const initSession = () => { chunks.current = [] }
 *
 *   const onChunk = (base64: string) => {
 *     const b = atob(base64)
 *     const arr = new Uint8Array(b.length)
 *     for (let i = 0; i < b.length; i++) arr[i] = b.charCodeAt(i)
 *     chunks.current.push(arr)
 *   }
 *
 *   const onDone = () => {
 *     const total = chunks.current.reduce((s, c) => s + c.length, 0)
 *     const merged = new Uint8Array(total)
 *     let offset = 0
 *     for (const c of chunks.current) { merged.set(c, offset); offset += c.length }
 *     chunks.current = []
 *     const url = URL.createObjectURL(new Blob([merged], { type: 'audio/mpeg' }))
 *     const audio = new Audio(url)
 *     audio.play()
 *     audio.onended = () => URL.revokeObjectURL(url)
 *   }
 *
 *   const stop = () => { chunks.current = [] }
 *   return { initSession, onChunk, onDone, stop }
 * }
 */
```

---

## Task 4: Create `src/components/MicButton.tsx`

Visible in the OrbPanel under the orb. Start/stop capture with visual feedback.

```tsx
import { motion } from 'framer-motion'

interface Props {
  isCapturing: boolean
  isTTSActive: boolean
  rmsLevel: number    // 0–1
  onStart: () => void
  onStop: () => void
}

export function MicButton({ isCapturing, isTTSActive, rmsLevel, onStart, onStop }: Props) {
  const scale = isCapturing ? 1 + rmsLevel * 2 : 1

  return (
    <div className="flex flex-col items-center gap-2">
      {isTTSActive && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-xs text-indigo-400/70"
        >
          Speak to interrupt
        </motion.p>
      )}
      <motion.button
        onClick={isCapturing ? onStop : onStart}
        animate={{ scale }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-colors ${
          isCapturing
            ? 'bg-emerald-600 hover:bg-emerald-500'
            : 'bg-primary hover:bg-primary/90'
        }`}
        aria-label={isCapturing ? 'Stop microphone' : 'Start microphone'}
      >
        <MicIcon active={isCapturing} />
      </motion.button>
      <span className="text-xs text-muted-foreground">
        {isCapturing ? 'Tap to stop' : 'Tap to speak'}
      </span>
    </div>
  )
}

function MicIcon({ active }: { active: boolean }) {
  if (active) {
    // Stop icon
    return (
      <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </svg>
    )
  }
  // Mic icon
  return (
    <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2zm-7 8a1 1 0 0 1 1 1 6 6 0 0 0 12 0 1 1 0 0 1 2 0 8 8 0 0 1-7 7.93V21h2a1 1 0 0 1 0 2H9a1 1 0 0 1 0-2h2v-2.07A8 8 0 0 1 4 12a1 1 0 0 1 1-1z"/>
    </svg>
  )
}
```

---

## Task 5: Update `OrbPanel.tsx` to include MicButton

In `src/components/OrbPanel.tsx`, add `MicButton` below the status text:

```tsx
// Add to Props interface:
interface Props {
  voiceState: VoiceState
  transcript: string
  agentText: string
  isCapturing: boolean     // NEW
  isTTSActive: boolean     // NEW
  rmsLevel: number         // NEW
  onMicStart: () => void   // NEW
  onMicStop: () => void    // NEW
}

// Add MicButton import at top:
import { MicButton } from '../MicButton'

// Add MicButton at the bottom of the returned JSX (after the live text div):
<MicButton
  isCapturing={isCapturing}
  isTTSActive={isTTSActive}
  rmsLevel={rmsLevel}
  onStart={onMicStart}
  onStop={onMicStop}
/>
```

---

## Verification

### Step 1: TypeScript check
```bash
npx tsc --noEmit
```
No errors expected.

### Step 2: Audio capture test
1. Start backend + frontend
2. Click "Start Presentation" → Connect
3. Click mic button → browser requests permission → grant
4. Speak clearly → watch backend terminal for:
   ```
   INFO  Deepgram STT connection opened
   INFO  Final transcript: 'hello world'
   ```
5. Mic button should pulse (scale animation) with voice level

### Step 3: TTS playback test
With backend working and a slide loaded:
1. Click mic, ask "What's the problem with clinical trials?"
2. Backend logs should show LLM response + TTS chunks
3. Audio should play in browser within ~2 seconds

### Step 4: Interrupt test
1. Ask a question, wait for TTS audio to start playing
2. Speak again
3. Audio should stop within ~300ms
4. New question gets processed

---

## Acceptance Criteria

- [ ] `src/lib/audioUtils.ts` — all 4 utilities implemented
- [ ] `src/hooks/useAudioCapture.ts` — mic → PCM → base64 → backend
- [ ] `src/hooks/useAudioPlayer.ts` — MSE streaming TTS playback
- [ ] `src/components/MicButton.tsx` — pulse animation on voice activity
- [ ] `OrbPanel.tsx` updated with MicButton and new props
- [ ] Mic permission flow works (granted / denied handled)
- [ ] Speech → transcript in backend logs
- [ ] AI audio plays in browser
- [ ] Interrupt stops audio and processes new speech
- [ ] No TS errors

## File Checklist After This Plan

```
src/
  lib/
    audioUtils.ts          ← PCM conversion, base64, RMS
  hooks/
    useAudioCapture.ts     ← mic → PCM → WS chunks + VAD
    useAudioPlayer.ts      ← MSE TTS playback
  components/
    MicButton.tsx          ← mic toggle with pulse animation
    OrbPanel.tsx           ← updated with MicButton + new props
```
