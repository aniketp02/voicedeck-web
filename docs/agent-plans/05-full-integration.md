# Frontend Agent Plan 05 — Full Integration: App Assembly + All Interaction States

## Agent Instructions
Read this plan fully before acting. Do not ask questions. All decisions are made.
Plans 01–04 must be complete before starting.

---

## Goal
Wire every hook into `App.tsx` to produce a fully functional voice slide deck:
- `useWebSocket` + `useAudioCapture` + `useAudioPlayer` + `useVoiceState` all connected
- `onTTSChunk` / `onTTSDone` callback refs populated so the audio player receives TTS data
- `initSession()` triggered exactly once per TTS stream (on first `isTTSActive` rising edge)
- Interrupt flow: user speaks over TTS → `wsControls.send({type:'interrupt'})` + `audioPlayer.stop()`
- All edge-case UI states handled: connecting, mic-denied, thinking gap, error banner

**Success criterion:** A user can open the app, click Start, grant mic permission, ask a
question, hear the AI answer, and interrupt mid-speech — all working end-to-end.

---

## State Wiring Diagram

```
useWebSocket ──────────────────────────────────────────────────────┐
  wsState.isTTSActive ──► rising-edge effect ──► audioPlayer.initSession()
  wsState.isTTSActive ──► useAudioCapture(isTTSActive)
  wsControls.onTTSChunk.current = audioPlayer.onChunk
  wsControls.onTTSDone.current  = audioPlayer.onDone

useAudioCapture ────────────────────────────────────────────────────┐
  onChunk  = wsControls.send
  onInterrupt = () => { wsControls.send({type:'interrupt'}); audioPlayer.stop() }
  isTTSActive = wsState.isTTSActive

useVoiceState ──────────────────────────────────────────────────────┐
  wsState           (from useWebSocket)
  isCapturing       (from useAudioCapture)
  isUserSpeaking    (from useAudioCapture)
  → voiceState      (drives orb hue + status label)
```

---

## Task 1: Replace `src/App.tsx` with the full integrated version

```tsx
import { useEffect, useRef, useState } from 'react'
import { Header } from './components/Header'
import { SlideView } from './components/SlideView'
import { SlideNav } from './components/SlideNav'
import { OrbPanel } from './components/OrbPanel'
import { useWebSocket } from './hooks/useWebSocket'
import { useVoiceState } from './hooks/useVoiceState'
import { useAudioCapture } from './hooks/useAudioCapture'
import { useAudioPlayer } from './hooks/useAudioPlayer'

const TOTAL_SLIDES = 6

export default function App() {
  const [started, setStarted] = useState(false)
  const [micDenied, setMicDenied] = useState(false)

  // ── Core hooks ──────────────────────────────────────────────────────
  const [wsState, wsControls] = useWebSocket()
  const audioPlayer = useAudioPlayer()

  const handleInterrupt = () => {
    wsControls.send({ type: 'interrupt' })
    audioPlayer.stop()
  }

  const [captureState, captureControls] = useAudioCapture({
    onChunk: wsControls.send,
    onInterrupt: handleInterrupt,
    isTTSActive: wsState.isTTSActive,
  })

  const voiceState = useVoiceState({
    wsState,
    isCapturing: captureState.isCapturing,
    isUserSpeaking: captureState.isUserSpeaking,
  })

  // ── Wire audio player callbacks into WebSocket hook ──────────────────
  // These refs are read by useWebSocket's message handler to route TTS data.
  useEffect(() => {
    wsControls.onTTSChunk.current = audioPlayer.onChunk
    wsControls.onTTSDone.current = audioPlayer.onDone
  }, [audioPlayer.onChunk, audioPlayer.onDone, wsControls.onTTSChunk, wsControls.onTTSDone])

  // ── Init audio session on first tts_chunk (isTTSActive rising edge) ─
  const prevTTSActiveRef = useRef(false)
  useEffect(() => {
    if (wsState.isTTSActive && !prevTTSActiveRef.current) {
      audioPlayer.initSession()
    }
    prevTTSActiveRef.current = wsState.isTTSActive
  }, [wsState.isTTSActive, audioPlayer])

  // ── Handlers ─────────────────────────────────────────────────────────
  const handleStart = () => {
    setStarted(true)
    wsControls.connect()
  }

  const handleMicStart = async () => {
    setMicDenied(false)
    try {
      await captureControls.start()
    } catch {
      setMicDenied(true)
    }
  }

  const handleMicStop = () => {
    captureControls.stop()
  }

  // ── Start screen ─────────────────────────────────────────────────────
  if (!started) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-8">
        <h1 className="text-5xl font-bold text-foreground tracking-tight text-center leading-tight">
          AI in Clinical Trials
        </h1>
        <p className="text-muted-foreground text-lg max-w-md text-center">
          A voice-interactive presentation. Ask questions, get answers — the slides follow the conversation.
        </p>
        <button
          onClick={handleStart}
          className="px-8 py-4 rounded-2xl bg-primary text-primary-foreground font-semibold text-lg hover:opacity-90 transition-opacity"
        >
          Start Presentation
        </button>
      </div>
    )
  }

  // ── Main layout ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Error banner — WebSocket error or mic denied */}
      {wsState.error && (
        <div className="bg-destructive/10 border-b border-destructive/30 px-8 py-2 text-sm text-destructive text-center">
          {wsState.error}
        </div>
      )}
      {micDenied && !wsState.error && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-8 py-2 text-sm text-amber-400 text-center">
          Microphone access denied. Please allow microphone permission and refresh.
        </div>
      )}

      <Header
        connected={wsState.connected}
        slideIndex={wsState.slideIndex}
        totalSlides={TOTAL_SLIDES}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left: 65% — slide content */}
        <div className="flex flex-col border-r border-border/50" style={{ width: '65%' }}>
          <SlideView slide={wsState.currentSlide} />
          <SlideNav total={TOTAL_SLIDES} current={wsState.slideIndex} />
        </div>

        {/* Right: 35% — orb + mic */}
        <div style={{ width: '35%' }}>
          <OrbPanel
            voiceState={voiceState}
            transcript={wsState.transcript}
            agentText={wsState.agentText}
            isCapturing={captureState.isCapturing}
            isTTSActive={wsState.isTTSActive}
            rmsLevel={captureState.rmsLevel}
            onMicStart={handleMicStart}
            onMicStop={handleMicStop}
          />
        </div>
      </div>
    </div>
  )
}
```

---

## Task 2: Verify `useAudioCapture` propagates mic-denied error

The `start()` function in `useAudioCapture.ts` catches `NotAllowedError` internally and
logs to console, but does **not** re-throw. The `App.tsx` above expects a thrown error to
set `micDenied`. Update `useAudioCapture.ts` to re-throw:

```typescript
// In the catch block of useAudioCapture.ts start():
} catch (err: unknown) {
  if (err instanceof Error && err.name === 'NotAllowedError') {
    console.error('Microphone permission denied')
  } else {
    console.error('Failed to start audio capture:', err)
  }
  throw err   // ← Add this line so App.tsx can catch and show the banner
}
```

---

## Task 3: Verify `useAudioCapture` stable callbacks

In `useAudioCapture.ts`, `onChunk` and `onInterrupt` are in the `useCallback` dependency
array but change on every render (they're defined inline in App.tsx). Wrap the interrupt
handler in `useCallback` in App.tsx:

The `handleInterrupt` and `handleMicStart` functions inside App.tsx should be wrapped with
`useCallback` so they don't re-trigger the `useAudioCapture` internal `useCallback` needlessly.

Update the relevant lines in App.tsx:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'

// Replace handleInterrupt with:
const handleInterrupt = useCallback(() => {
  wsControls.send({ type: 'interrupt' })
  audioPlayer.stop()
}, [wsControls.send, audioPlayer.stop])

// Replace handleMicStart with:
const handleMicStart = useCallback(async () => {
  setMicDenied(false)
  try {
    await captureControls.start()
  } catch {
    setMicDenied(true)
  }
}, [captureControls.start])

// Replace handleMicStop with:
const handleMicStop = useCallback(() => {
  captureControls.stop()
}, [captureControls.stop])
```

This prevents the audio processor from being re-created on every render while capturing.

---

## Task 4: Complete App.tsx (consolidated final version)

Replace the Task 1 version with this consolidated version that includes all `useCallback` wrapping:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Header } from './components/Header'
import { SlideView } from './components/SlideView'
import { SlideNav } from './components/SlideNav'
import { OrbPanel } from './components/OrbPanel'
import { useWebSocket } from './hooks/useWebSocket'
import { useVoiceState } from './hooks/useVoiceState'
import { useAudioCapture } from './hooks/useAudioCapture'
import { useAudioPlayer } from './hooks/useAudioPlayer'

const TOTAL_SLIDES = 6

export default function App() {
  const [started, setStarted] = useState(false)
  const [micDenied, setMicDenied] = useState(false)

  // ── Core hooks ──────────────────────────────────────────────────────
  const [wsState, wsControls] = useWebSocket()
  const audioPlayer = useAudioPlayer()

  const handleInterrupt = useCallback(() => {
    wsControls.send({ type: 'interrupt' })
    audioPlayer.stop()
  }, [wsControls.send, audioPlayer.stop])

  const [captureState, captureControls] = useAudioCapture({
    onChunk: wsControls.send,
    onInterrupt: handleInterrupt,
    isTTSActive: wsState.isTTSActive,
  })

  const voiceState = useVoiceState({
    wsState,
    isCapturing: captureState.isCapturing,
    isUserSpeaking: captureState.isUserSpeaking,
  })

  // ── Wire audio callbacks into WebSocket hook ─────────────────────────
  useEffect(() => {
    wsControls.onTTSChunk.current = audioPlayer.onChunk
    wsControls.onTTSDone.current = audioPlayer.onDone
  }, [audioPlayer.onChunk, audioPlayer.onDone, wsControls.onTTSChunk, wsControls.onTTSDone])

  // ── Init audio session on isTTSActive rising edge ────────────────────
  const prevTTSActiveRef = useRef(false)
  useEffect(() => {
    if (wsState.isTTSActive && !prevTTSActiveRef.current) {
      audioPlayer.initSession()
    }
    prevTTSActiveRef.current = wsState.isTTSActive
  }, [wsState.isTTSActive, audioPlayer])

  // ── Handlers ─────────────────────────────────────────────────────────
  const handleStart = () => {
    setStarted(true)
    wsControls.connect()
  }

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

  // ── Start screen ─────────────────────────────────────────────────────
  if (!started) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-8">
        <h1 className="text-5xl font-bold text-foreground tracking-tight text-center leading-tight">
          AI in Clinical Trials
        </h1>
        <p className="text-muted-foreground text-lg max-w-md text-center">
          A voice-interactive presentation. Ask questions, get answers — the slides follow the conversation.
        </p>
        <button
          onClick={handleStart}
          className="px-8 py-4 rounded-2xl bg-primary text-primary-foreground font-semibold text-lg hover:opacity-90 transition-opacity"
        >
          Start Presentation
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {wsState.error && (
        <div className="bg-destructive/10 border-b border-destructive/30 px-8 py-2 text-sm text-destructive text-center">
          {wsState.error}
        </div>
      )}
      {micDenied && !wsState.error && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-8 py-2 text-sm text-amber-400 text-center">
          Microphone access denied. Please allow microphone permission and refresh.
        </div>
      )}

      <Header
        connected={wsState.connected}
        slideIndex={wsState.slideIndex}
        totalSlides={TOTAL_SLIDES}
      />

      <div className="flex-1 flex overflow-hidden">
        <div className="flex flex-col border-r border-border/50" style={{ width: '65%' }}>
          <SlideView slide={wsState.currentSlide} />
          <SlideNav total={TOTAL_SLIDES} current={wsState.slideIndex} />
        </div>
        <div style={{ width: '35%' }}>
          <OrbPanel
            voiceState={voiceState}
            transcript={wsState.transcript}
            agentText={wsState.agentText}
            isCapturing={captureState.isCapturing}
            isTTSActive={wsState.isTTSActive}
            rmsLevel={captureState.rmsLevel}
            onMicStart={handleMicStart}
            onMicStop={handleMicStop}
          />
        </div>
      </div>
    </div>
  )
}
```

---

## Task 5: TypeScript verification

```bash
cd frontend
npx tsc --noEmit
```

Expected: no errors. Common issues and fixes:

**Issue:** `audioPlayer.stop` / `audioPlayer.initSession` not in `useCallback` deps  
**Fix:** The `useCallback` deps in App.tsx reference `audioPlayer.stop` and `audioPlayer.initSession`. These are stable refs from `useAudioPlayer` (defined with `useCallback` in Plan 04), so no issue.

**Issue:** `wsControls.send` signature mismatch  
**Fix:** `onChunk: wsControls.send` — `wsControls.send` takes `ClientMessage`, and `onChunk` expects `(msg: ClientMessage) => void`. These match.

**Issue:** `captureControls.start` not returning a Promise in the type  
**Fix:** The `start` function is declared as `async` in Plan 04, so TypeScript infers `() => Promise<void>`. No issue.

---

## Task 6: End-to-end verification checklist

### Prerequisites
```bash
# Terminal 1 — backend
cd backend
source venv/bin/activate
uvicorn app.main:app --port 8000 --log-level info

# Terminal 2 — frontend
cd frontend
npm run dev
```

### Test 1: Connection + slide load
1. Open http://localhost:5173
2. Click **Start Presentation**
3. **Expected:**
   - Header shows green **Connected** badge
   - Slide 01/06 renders with title "The Broken Machine: Clinical Trials Today"
   - Bullets stagger in one by one
   - Orb is visible (purple/violet)
   - Mic button visible: "Tap to speak"

### Test 2: Voice capture + transcript
1. Click mic button → browser asks for permission → **Allow**
2. Speak: *"Hello, can you hear me?"*
3. **Expected:**
   - Mic button turns green, shows stop icon
   - Status label changes to "Hearing you..."
   - Orb hue shifts toward green
   - Backend terminal shows: `INFO  Final transcript: 'hello can you hear me'`

### Test 3: AI response
1. Click mic, ask: *"What percentage of drugs succeed in clinical trials?"*
2. Wait ~2–3 seconds
3. **Expected:**
   - Status: "Thinking..." (orb dims)
   - Then: "Speaking..." (orb goes indigo/blue-purple)
   - AI audio plays in browser
   - Agent text appears below orb

### Test 4: Slide navigation
1. Click mic, ask: *"Tell me about AI-powered patient matching"*
2. **Expected:**
   - Slide animates to relevant slide (2–4 depending on backend logic)
   - Slide number badge updates
   - Dot nav pill moves
   - Backend terminal shows: `INFO  Navigating to slide N`

### Test 5: Interrupt mid-speech
1. Ask any question, wait for AI to start speaking
2. While audio is playing, **speak again**
3. **Expected:**
   - Audio stops within ~300ms
   - Status immediately returns to "Hearing you..." (orb shifts green)
   - Backend terminal shows: `INFO  Interrupt received, cancelling agent task`
   - New question gets processed normally

### Test 6: Error states
1. Stop the backend, click **Start Presentation**
2. **Expected:** Red error banner: "WebSocket connection failed. Is the backend running?"
3. Deny mic permission when prompted
4. **Expected:** Amber banner: "Microphone access denied..."

### Test 7: TypeScript clean build
```bash
npx tsc --noEmit
npm run build
```
Both must succeed with zero errors.

---

## Acceptance Criteria

- [ ] `src/App.tsx` — full integration: all 4 hooks wired, callback refs set, rising-edge effect
- [ ] `useAudioCapture.ts` — re-throws on mic denied so App can show amber banner
- [ ] Connection → slide renders from real backend data (no hardcoded state)
- [ ] Mic button starts capture; speaking sends audio to backend
- [ ] Backend logs show final transcripts
- [ ] AI audio plays via MSE streaming
- [ ] Interrupt stops audio and processes new speech
- [ ] `micDenied` banner shown when permission denied
- [ ] `wsState.error` banner shown when WebSocket fails
- [ ] Orb hue: purple (idle/listening) → green (user-speaking) → dim purple (thinking) → indigo (ai-speaking)
- [ ] Slide transitions animate on navigation
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run build` — clean

---

## File Checklist After This Plan

```
src/
  App.tsx                   ← Full integration (replaces Plan 03 version)
  hooks/
    useAudioCapture.ts      ← Minor fix: re-throw on mic denied
    useAudioPlayer.ts       ← (unchanged from Plan 04)
    useWebSocket.ts         ← (unchanged from Plan 03)
    useVoiceState.ts        ← (unchanged from Plan 03)
  components/
    Header.tsx              ← (unchanged from Plan 02)
    SlideView.tsx           ← (unchanged from Plan 02)
    SlideNav.tsx            ← (unchanged from Plan 02)
    OrbPanel.tsx            ← (unchanged from Plan 04)
    MicButton.tsx           ← (unchanged from Plan 04)
    ui/
      badge.tsx             ← (from Plan 01)
      voice-powered-orb.tsx ← (from Plan 01)
  lib/
    audioUtils.ts           ← (from Plan 04)
    utils.ts                ← (from Plan 01 shadcn)
  types/
    protocol.ts             ← (from Plan 02)
```

---

## Troubleshooting

### Audio doesn't play
- Open DevTools → Console — look for `MSE SourceBuffer creation failed`
- If MSE fails: swap `useAudioPlayer` for `useAudioPlayerSimple` (fallback in Plan 04 comments)
- Confirm browser supports `audio/mpeg` in MediaSource: `MediaSource.isTypeSupported('audio/mpeg')`

### No transcripts in backend logs
- Confirm Deepgram API key is set in `backend/.env`
- Check `backend/app/services/stt.py` for SSL patch errors (Plan backend-02)
- Try speaking louder — VAD threshold is 0.012 RMS

### Slides don't navigate
- Check backend terminal: is agent graph running?
- Verify `backend/.env` has `OPENAI_API_KEY`
- Check LangGraph node logs: `understand_node` should log intent + target slide

### Interrupt doesn't stop audio
- Confirm `audioPlayer.stop()` is called alongside `wsControls.send({type:'interrupt'})`
- Verify `isTTSActiveRef` is in sync (Plan 04 stale closure fix)
- Check backend terminal for: `Interrupt received, cancelling agent task`
