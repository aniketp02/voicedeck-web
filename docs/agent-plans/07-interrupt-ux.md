# Frontend Agent Plan 07 — Seamless Interrupt UX

## Agent Instructions
Read this plan fully before acting. Do not ask questions. All decisions are made.
**Plan 06 must be complete before starting this plan** (OrbPanel needs the new CSS variables).

**Parallel execution:** Plan 08 (backend) runs in parallel with this plan — no conflict.
Plan 09 depends on both this plan AND Plan 08 completing.

---

## Goal
Fix the two interrupt problems:

**Problem 1 — Voice interrupt unreliable:** When the AI is speaking through speakers, mic echo
raises the ambient RMS level, eating into the margin between silence (0.0) and user voice (0.012).
Users must speak noticeably louder than normal. Fix: lower VAD threshold during TTS + debounce
interrupt to send exactly once per TTS episode.

**Problem 2 — No tap-to-interrupt affordance:** The only hint is tiny italic text "Speak to
interrupt" in MicButton. Users miss it, especially on a phone or when focused on slides. Fix: show
a large animated button during `ai-speaking` state directly in the OrbPanel.

**Problem 3 — Abrupt audio cut:** Calling `audio.pause()` immediately creates a jarring click.
Fix: 120ms volume ramp-down before pause.

**Files changed in this plan:**
- `src/hooks/useAudioCapture.ts` — dynamic VAD threshold + interrupt debounce
- `src/hooks/useAudioPlayer.ts` — smooth fade-out on `stop()`
- `src/components/OrbPanel.tsx` — add `onInterrupt` prop + tap-to-interrupt button + dark panel
- `src/components/MicButton.tsx` — text colors fixed for dark panel background
- `src/App.tsx` — pass `onInterrupt` to OrbPanel + dark background on right panel

---

## Task 1: Update `src/hooks/useAudioCapture.ts`

Two changes:
1. Dynamic threshold: `VAD_THRESHOLD_DURING_TTS = 0.008` (lower = more sensitive when echo present)
2. Interrupt debounce: use `interruptSentRef` so only one interrupt fires per TTS episode,
   regardless of how long the user speaks. Reset the ref when TTS becomes inactive.

```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  float32ToInt16,
  getRMSLevel,
  int16ToBase64,
} from '@/lib/audioUtils'
import type { ClientMessage } from '@/types/protocol'

const SAMPLE_RATE = 16000
/** ScriptProcessorNode only allows powers of two 256–16384 (not e.g. 1600). 2048 ≈ 128ms @ 16kHz. */
const BUFFER_SIZE = 2048
/** Default VAD threshold — tuned for quiet ambient conditions. */
const VAD_THRESHOLD = 0.012
/**
 * Lower threshold used while TTS is active.
 * Speaker echo raises ambient RMS; lowering the threshold makes it easier
 * for the user's voice to cross it and trigger an interrupt.
 */
const VAD_THRESHOLD_DURING_TTS = 0.008
const VAD_RELEASE_FRAMES = 8

interface UseAudioCaptureOptions {
  onChunk: (msg: ClientMessage) => void
  onInterrupt: () => void
  isTTSActive: boolean
}

export interface AudioCaptureState {
  isCapturing: boolean
  isUserSpeaking: boolean
  rmsLevel: number
}

export function useAudioCapture({
  onChunk,
  onInterrupt,
  isTTSActive,
}: UseAudioCaptureOptions): [
  AudioCaptureState,
  { start: () => Promise<void>; stop: () => void },
] {
  const [isCapturing, setIsCapturing] = useState(false)
  const [isUserSpeaking, setIsUserSpeaking] = useState(false)
  const [rmsLevel, setRmsLevel] = useState(0)

  const contextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const silenceFramesRef = useRef(0)
  const isTTSActiveRef = useRef(isTTSActive)
  const onChunkRef = useRef(onChunk)
  const onInterruptRef = useRef(onInterrupt)
  /**
   * Tracks whether we already sent an interrupt for the current TTS episode.
   * Prevents sending 10+ interrupt messages per second while user speaks.
   * Reset to false when isTTSActive becomes false (new TTS stream starts fresh).
   */
  const interruptSentRef = useRef(false)

  useEffect(() => {
    isTTSActiveRef.current = isTTSActive
    // When TTS ends, allow a future interrupt on the next TTS episode
    if (!isTTSActive) {
      interruptSentRef.current = false
    }
  }, [isTTSActive])
  useEffect(() => {
    onChunkRef.current = onChunk
  }, [onChunk])
  useEffect(() => {
    onInterruptRef.current = onInterrupt
  }, [onInterrupt])

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
      const processor = context.createScriptProcessor(BUFFER_SIZE, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (e) => {
        const float32 = e.inputBuffer.getChannelData(0)
        const rms = getRMSLevel(float32)

        setRmsLevel(rms)

        // Use lower threshold during TTS to compensate for speaker echo
        const threshold = isTTSActiveRef.current
          ? VAD_THRESHOLD_DURING_TTS
          : VAD_THRESHOLD

        const voiceActive = rms > threshold
        if (voiceActive) {
          silenceFramesRef.current = 0
          setIsUserSpeaking(true)

          // Send interrupt at most once per TTS episode
          if (isTTSActiveRef.current && !interruptSentRef.current) {
            interruptSentRef.current = true
            onInterruptRef.current()
          }
        } else {
          silenceFramesRef.current++
          if (silenceFramesRef.current >= VAD_RELEASE_FRAMES) {
            setIsUserSpeaking(false)
          }
        }

        const int16 = float32ToInt16(float32)
        const data = int16ToBase64(int16)
        onChunkRef.current({ type: 'audio_chunk', data })
      }

      // Mute node: prevents mic audio from bleeding into speakers
      const mute = context.createGain()
      mute.gain.value = 0
      source.connect(processor)
      processor.connect(mute)
      mute.connect(context.destination)

      setIsCapturing(true)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        console.error('Microphone permission denied')
        throw err
      }
      console.error('Failed to start audio capture:', err)
      if (err instanceof Error) throw err
      throw new Error(String(err))
    }
  }, [isCapturing])

  const stop = useCallback(() => {
    processorRef.current?.disconnect()
    contextRef.current?.close().catch(() => {})
    streamRef.current?.getTracks().forEach((t) => t.stop())
    processorRef.current = null
    contextRef.current = null
    streamRef.current = null
    setIsCapturing(false)
    setIsUserSpeaking(false)
    setRmsLevel(0)
    silenceFramesRef.current = 0
    interruptSentRef.current = false
  }, [])

  const controls = useMemo(() => ({ start, stop }), [start, stop])

  return [{ isCapturing, isUserSpeaking, rmsLevel }, controls]
}
```

---

## Task 2: Update `src/hooks/useAudioPlayer.ts`

Add a 120ms volume ramp-down in `stop()` before calling `pause()`.
This prevents the jarring audio click that occurs on abrupt pause.

Replace only the `stop` callback (everything else stays the same):

```typescript
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
```

**How to apply:** In `src/hooks/useAudioPlayer.ts`, replace the entire `stop` useCallback block
(lines 150–156 in the current file) with the above code.

The full file for reference — the agent should use targeted editing on just the `stop` block,
not rewrite the whole file. The rest of `useAudioPlayer.ts` is unchanged from Plan 04.

---

## Task 3: Replace `src/components/OrbPanel.tsx`

Full replacement. Changes:
1. Outer container gets `bg-slate-950` — permanent dark panel regardless of app theme
2. All text uses `text-slate-100` / `text-slate-300` (not `text-foreground` which is dark on light theme)
3. New `onInterrupt` prop — shows a large animated tap-to-interrupt button during `ai-speaking`
4. `StatusDot` colors adjusted for dark background (idle dot uses `bg-slate-500` not CSS variable)
5. Remove the redundant "Speak to interrupt" text from MicButton area (MicButton itself handles it)

```tsx
import { AnimatePresence, motion } from 'framer-motion'

import { MicButton } from '@/components/MicButton'
import { VoicePoweredOrb } from '@/components/ui/voice-powered-orb'
import {
  type VoiceState,
  voiceStateToHue,
  voiceStateToLabel,
} from '@/types/protocol'

interface Props {
  voiceState: VoiceState
  transcript: string
  agentText: string
  isCapturing: boolean
  isTTSActive: boolean
  rmsLevel: number
  onMicStart: () => void
  onMicStop: () => void
  onInterrupt: () => void   // NEW — called by tap-to-interrupt button
}

function orbHoverIntensity(state: VoiceState): number {
  if (state === 'thinking') return 0.2
  if (state === 'ai-speaking') return 0.9
  if (state === 'user-speaking') return 0.8
  return 0.5
}

export function OrbPanel({
  voiceState,
  transcript,
  agentText,
  isCapturing,
  isTTSActive,
  rmsLevel,
  onMicStart,
  onMicStop,
  onInterrupt,
}: Props) {
  const hue = voiceStateToHue(voiceState)
  const label = voiceStateToLabel(voiceState)
  const intensity = orbHoverIntensity(voiceState)

  return (
    // bg-slate-950 is hardcoded — this panel stays dark even in the light theme.
    // The orb WebGL canvas renders its own dark background; this bg must match.
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-slate-950 px-6 py-8">
      {/* OGL Orb */}
      <div className="h-[260px] w-[260px] flex-shrink-0">
        <VoicePoweredOrb
          hue={hue}
          hoverIntensity={intensity}
          enableVoiceControl={false}
          className="h-full w-full"
        />
      </div>

      {/* Voice state label */}
      <AnimatePresence mode="wait">
        <motion.div
          key={voiceState}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col items-center gap-1.5 text-center"
        >
          <StatusDot state={voiceState} />
          <span className="text-sm font-medium text-slate-100">{label}</span>
        </motion.div>
      </AnimatePresence>

      {/* Live text: transcript (user speaking) or agent text (ai speaking) */}
      <div className="min-h-[3rem] w-full px-2 text-center">
        <AnimatePresence mode="wait">
          {voiceState === 'user-speaking' && transcript ? (
            <motion.p
              key="transcript"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-xs italic leading-relaxed text-emerald-400/80"
            >
              &ldquo;{transcript}&rdquo;
            </motion.p>
          ) : null}
          {voiceState === 'ai-speaking' && agentText ? (
            <motion.p
              key="agent"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="line-clamp-3 text-xs italic leading-relaxed text-indigo-300/80"
            >
              &ldquo;{agentText}&rdquo;
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>

      {/*
        Tap-to-interrupt button — visible only during ai-speaking.
        Primary interrupt affordance: large, hard to miss.
        VAD interrupt still works simultaneously as a fallback.
      */}
      <AnimatePresence>
        {voiceState === 'ai-speaking' ? (
          <motion.button
            key="interrupt-btn"
            type="button"
            onClick={onInterrupt}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            whileTap={{ scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/15 px-5 py-2.5 text-sm font-medium text-indigo-200 transition-colors hover:bg-indigo-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
            Tap to interrupt
          </motion.button>
        ) : null}
      </AnimatePresence>

      {/* Mic button — hidden during ai-speaking to reduce visual clutter */}
      <AnimatePresence>
        {voiceState !== 'ai-speaking' ? (
          <motion.div
            key="mic"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <MicButton
              isCapturing={isCapturing}
              isTTSActive={isTTSActive}
              rmsLevel={rmsLevel}
              onStart={onMicStart}
              onStop={onMicStop}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function StatusDot({ state }: { state: VoiceState }) {
  // All colors must be readable on bg-slate-950
  const colors: Record<VoiceState, string> = {
    idle:            'bg-slate-500',
    listening:       'bg-violet-400 animate-pulse',
    'user-speaking': 'bg-emerald-400',
    thinking:        'bg-amber-400 animate-pulse',
    'ai-speaking':   'bg-indigo-400',
  }
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${colors[state]}`}
      aria-hidden
    />
  )
}
```

---

## Task 4: Replace `src/components/MicButton.tsx`

Text colors fixed for dark panel background (`text-muted-foreground` maps to the light theme
grey, which is near-invisible on slate-950). Replace with explicit dark-panel-safe colors.

Remove the "Speak to interrupt" text — OrbPanel now handles this with the tap-to-interrupt
button, which is more prominent. MicButton's isTTSActive prop can be removed but keep it
in the interface for backwards compatibility.

```tsx
import { motion } from 'framer-motion'

interface Props {
  isCapturing: boolean
  isTTSActive: boolean   // kept for interface compatibility; no longer used for hint text
  rmsLevel: number
  onStart: () => void
  onStop: () => void
}

export function MicButton({
  isCapturing,
  rmsLevel,
  onStart,
  onStop,
}: Props) {
  const scale = isCapturing ? 1 + rmsLevel * 2 : 1

  return (
    <div className="flex flex-col items-center gap-2">
      <motion.button
        type="button"
        onClick={isCapturing ? onStop : onStart}
        animate={{ scale }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        className={`flex h-14 w-14 items-center justify-center rounded-full shadow-lg shadow-black/30 transition-colors ${
          isCapturing
            ? 'bg-emerald-600 hover:bg-emerald-500'
            : 'bg-indigo-600 hover:bg-indigo-500'
        }`}
        aria-label={isCapturing ? 'Stop microphone' : 'Start microphone'}
      >
        <MicIcon active={isCapturing} />
      </motion.button>
      <span className="text-xs text-slate-400">
        {isCapturing ? 'Tap to stop' : 'Tap to speak'}
      </span>
    </div>
  )
}

function MicIcon({ active }: { active: boolean }) {
  if (active) {
    return (
      <svg className="h-5 w-5 text-white" fill="currentColor" viewBox="0 0 24 24">
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </svg>
    )
  }
  return (
    <svg className="h-5 w-5 text-white" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2zm-7 8a1 1 0 0 1 1 1 6 6 0 0 0 12 0 1 1 0 0 1 2 0 8 8 0 0 1-7 7.93V21h2a1 1 0 0 1 0 2H9a1 1 0 0 1 0-2h2v-2.07A8 8 0 0 1 4 12a1 1 0 0 1 1-1z" />
    </svg>
  )
}
```

Note: the idle mic button color changed from `bg-primary` to `bg-indigo-600` — on the dark panel
bg-primary would be indigo-500 which reads as the same. Using a hardcoded value prevents any
CSS variable mismatch on the dark panel.

---

## Task 5: Replace `src/App.tsx`

Changes from the current version:
1. Add `bg-slate-950` to the right panel wrapper div (the orb column)
2. Remove `border-r border-border/50` from the left panel — color contrast between white slides
   and slate-950 orb panel creates the visual separation naturally
3. Add `onInterrupt={handleInterrupt}` to OrbPanel call
4. Add `hero-bg` CSS class to the start screen container
5. SlideView gets `totalSlides={TOTAL_SLIDES}` prop (new prop added in Plan 06)

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'

import { Header } from '@/components/Header'
import { OrbPanel } from '@/components/OrbPanel'
import { SlideNav } from '@/components/SlideNav'
import { SlideView } from '@/components/SlideView'
import { useAudioCapture } from '@/hooks/useAudioCapture'
import { useAudioPlayer } from '@/hooks/useAudioPlayer'
import { useVoiceState } from '@/hooks/useVoiceState'
import { useWebSocket } from '@/hooks/useWebSocket'

const TOTAL_SLIDES = 6

export default function App() {
  const [started, setStarted] = useState(false)
  const [micDenied, setMicDenied] = useState(false)

  const [wsState, { connect, send, onTTSChunk: onTTSChunkRef, onTTSDone: onTTSDoneRef }] =
    useWebSocket()
  const audioPlayer = useAudioPlayer()

  const handleInterrupt = useCallback(() => {
    send({ type: 'interrupt' })
    audioPlayer.stop()
  }, [send, audioPlayer])

  const [captureState, captureControls] = useAudioCapture({
    onChunk: send,
    onInterrupt: handleInterrupt,
    isTTSActive: wsState.isTTSActive,
  })

  const voiceState = useVoiceState({
    wsState,
    isCapturing: captureState.isCapturing,
    isUserSpeaking: captureState.isUserSpeaking,
  })

  useEffect(() => {
    onTTSChunkRef.current = audioPlayer.onChunk
    onTTSDoneRef.current = audioPlayer.onDone
  }, [onTTSChunkRef, onTTSDoneRef, audioPlayer.onChunk, audioPlayer.onDone])

  const prevTTSActiveRef = useRef(false)
  useEffect(() => {
    if (wsState.isTTSActive && !prevTTSActiveRef.current) {
      audioPlayer.initSession()
    }
    prevTTSActiveRef.current = wsState.isTTSActive
  }, [wsState.isTTSActive, audioPlayer])

  const handlePresentationStart = useCallback(() => {
    setStarted(true)
    connect()
  }, [connect])

  const handleMicStart = useCallback(async () => {
    setMicDenied(false)
    try {
      await captureControls.start()
    } catch {
      setMicDenied(true)
    }
  }, [captureControls])

  const handleMicStop = useCallback(() => {
    captureControls.stop()
  }, [captureControls])

  // ── Start screen ───────────────────────────────────────────────────────
  if (!started) {
    return (
      // hero-bg defined in index.css — soft indigo/blue/violet radial gradient
      <div className="hero-bg flex min-h-screen flex-col items-center justify-center gap-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white/70 px-4 py-1.5 text-xs font-medium text-indigo-700 shadow-sm backdrop-blur-sm">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500" />
            Voice-Interactive Presentation
          </div>
          <h1 className="text-5xl font-bold leading-tight tracking-tight text-foreground">
            AI in Clinical Trials
          </h1>
          <p className="max-w-md text-lg text-muted-foreground">
            Ask questions, get answers — the slides follow the conversation.
          </p>
        </div>
        <button
          type="button"
          onClick={handlePresentationStart}
          className="rounded-2xl bg-primary px-8 py-4 text-lg font-semibold text-primary-foreground shadow-lg shadow-indigo-200 transition-all hover:opacity-90 hover:shadow-indigo-300 active:scale-95"
        >
          Start Presentation
        </button>
      </div>
    )
  }

  // ── Main layout ─────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {wsState.error ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-8 py-2 text-center text-sm text-destructive">
          {wsState.error}
        </div>
      ) : null}
      {micDenied && !wsState.error ? (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-8 py-2 text-center text-sm text-amber-700">
          Microphone access denied. Please allow microphone permission and refresh.
        </div>
      ) : null}

      <Header
        connected={wsState.connected}
        slideIndex={wsState.slideIndex}
        totalSlides={TOTAL_SLIDES}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left panel: slide content — white on light background */}
        <div className="flex min-h-0 flex-col bg-background" style={{ width: '65%' }}>
          <SlideView slide={wsState.currentSlide} totalSlides={TOTAL_SLIDES} />
          <SlideNav total={TOTAL_SLIDES} current={wsState.slideIndex} />
        </div>

        {/* Right panel: orb + voice controls — intentionally dark */}
        <div className="min-h-0 overflow-y-auto bg-slate-950" style={{ width: '35%' }}>
          <OrbPanel
            voiceState={voiceState}
            transcript={wsState.transcript}
            agentText={wsState.agentText}
            isCapturing={captureState.isCapturing}
            isTTSActive={wsState.isTTSActive}
            rmsLevel={captureState.rmsLevel}
            onMicStart={handleMicStart}
            onMicStop={handleMicStop}
            onInterrupt={handleInterrupt}
          />
        </div>
      </div>

      <footer className="border-t border-border bg-white/80 px-8 py-3 backdrop-blur-sm">
        <div className="flex flex-col gap-1 text-sm sm:flex-row sm:justify-between sm:gap-8">
          <p className="min-w-0 truncate text-muted-foreground">
            <span className="font-medium text-foreground">You:</span>{' '}
            {wsState.transcript || '—'}
          </p>
          <p className="min-w-0 truncate text-right text-muted-foreground sm:max-w-[50%]">
            <span className="font-medium text-foreground">Agent:</span>{' '}
            {wsState.agentText || '—'}
          </p>
        </div>
      </footer>
    </div>
  )
}
```

---

## Task 6: TypeScript verification

```bash
cd frontend
npx tsc --noEmit
```

**Expected:** no errors.

Common issues:
- `onInterrupt` missing from OrbPanel call → ensure Task 5 App.tsx includes `onInterrupt={handleInterrupt}`
- `totalSlides` missing from SlideView call → ensure Task 5 App.tsx includes `totalSlides={TOTAL_SLIDES}`

---

## Task 7: Interrupt flow verification

Start backend + frontend and test:

### Test A: VAD interrupt (voice over TTS)
1. Ask a question, wait for AI to start speaking through speakers
2. Speak clearly — **should be at normal speaking volume**, not shouting
3. **Expected:** Audio fades out smoothly (120ms), no click, `voiceState` shifts to `user-speaking`
4. Backend terminal shows: `INFO  Interrupt signal received from client` then `INFO  run_agent cancelled`

### Test B: Tap-to-interrupt button
1. Ask a question, wait for AI to start speaking
2. The indigo pulsing "Tap to interrupt" button should appear in the orb panel
3. Click it
4. **Expected:** Same fade-out + state reset as above

### Test C: Interrupt debounce
Open browser DevTools → Network → WS
1. Ask a question, wait for TTS to start
2. Speak continuously for 2–3 seconds (long utterance)
3. In the WS messages panel, count `{"type":"interrupt"}` messages
4. **Expected:** Exactly ONE interrupt message, not dozens

### Test D: Normal capture still works after interrupt
1. After an interrupt, the mic should still be active
2. The `isCapturing` state stays `true` — you should be able to ask another question normally

---

## Acceptance Criteria

- [ ] `useAudioCapture.ts` — `VAD_THRESHOLD_DURING_TTS = 0.008`, `interruptSentRef` debounce
- [ ] `useAudioPlayer.ts` — `stop()` ramps volume to 0 over 120ms before `pause()`
- [ ] `OrbPanel.tsx` — `bg-slate-950`, all text uses slate/emerald/indigo direct colors, `onInterrupt` prop, tap-to-interrupt button visible during `ai-speaking`
- [ ] `MicButton.tsx` — text colors use `text-slate-400`, mic button is `bg-indigo-600`
- [ ] `App.tsx` — right panel has `bg-slate-950`, `onInterrupt` passed to OrbPanel, hero screen uses `hero-bg`
- [ ] VAD interrupt works at normal speaking volume (not shouting)
- [ ] Tap-to-interrupt button appears and works
- [ ] Audio fade-out is smooth (no click)
- [ ] Exactly one interrupt WebSocket message sent per TTS episode
- [ ] TypeScript compiles clean

## File Checklist After This Plan

```
src/
  hooks/
    useAudioCapture.ts    ← dynamic threshold + interrupt debounce
    useAudioPlayer.ts     ← 120ms fade-out on stop()
  components/
    OrbPanel.tsx          ← dark panel + tap-to-interrupt button
    MicButton.tsx         ← text colors fixed for dark bg
  App.tsx                 ← right panel bg + onInterrupt + hero-bg
```
