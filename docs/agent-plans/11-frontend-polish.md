# Frontend Agent Plan 11 — Audio Fix + Keyboard Nav + Session Reset + Conversation History

## Agent Instructions
Read this plan fully before acting. Do not ask questions. All decisions are made.
Plans 01–09 must be complete before starting.

**Parallel execution:** This plan runs in parallel with backend Plan 10.
Plan 10 and Plan 11 have zero file overlap — they can proceed simultaneously.

**Dependency note:** After Plan 10 completes, the backend sends `speech_final` in transcript
messages. This plan updates the frontend to consume it. If running Plan 11 before Plan 10,
the `speech_final` field will be `undefined` on incoming messages — the fallback to
`is_final` ensures nothing breaks, but the premature thinking state won't be fully fixed
until Plan 10 is also deployed.

---

## Background: Four Things Being Fixed/Added

### Fix 1 — Old TTS audio plays during thinking phase
**Root cause:** `useAudioPlayer.onChunk()` has a lazy-init guard:
```typescript
if (!sessionActiveRef.current) { initSession() }
```
When `stop()` is called on interrupt, it sets `sessionActiveRef.current = false` and starts
a 120ms fade. But if in-flight `tts_chunk` WebSocket messages arrive during those 120ms
(from the backend task before it finishes cancelling), `onChunk` sees `sessionActiveRef=false`,
calls `initSession()`, creates a fresh MediaSource, and begins playing the old audio —
exactly when the orb should be showing "Thinking...".

**Fix:** `stoppingRef` — a boolean ref set to `true` at the start of `stop()` and reset to
`false` only at the start of `initSession()`. In `onChunk`, drop chunks if `stoppingRef=true`.

### Fix 2 — Premature "Thinking" orb flash on mid-sentence pause
**Root cause:** `useWebSocket.ts` sets `hasFinalTranscript=true` on every `is_final` transcript
message. `useVoiceState` maps `hasFinalTranscript=true` → `thinking` state. A natural pause
mid-sentence triggers `is_final` from Deepgram (but not `speech_final`), causing the orb to
flash to "Thinking..." before the user has finished speaking.

**Fix:** Set `hasFinalTranscript=true` only when `msg.speech_final === true`. Plan 10 adds
`speech_final` to the transcript WebSocket message. The `ServerMessage` type needs updating.

### Addition 3 — Keyboard slide navigation
Arrow keys navigate slides during a live presentation without using voice. Sends
`{"type": "navigate", "index": N}` to the backend (Plan 10 handles it). Only active while
connected; does nothing during TTS playback or thinking to avoid accidental navigation.

### Addition 4 — Session reset + conversation history
A small reset button in the header restarts from slide 0 with fresh conversation history.
The footer is upgraded from a single last-turn display to a multi-turn scrollable history.

---

## Files Changed

- `src/types/protocol.ts` — `speech_final` in transcript, `navigate` ClientMessage
- `src/hooks/useAudioPlayer.ts` — `stoppingRef` fix
- `src/hooks/useWebSocket.ts` — `speech_final` drives `hasFinalTranscript`, `navigate()` function
- `src/components/Header.tsx` — reset button
- `src/App.tsx` — keyboard nav, reset handler, conversation history state + footer

---

## Task 1: Update `src/types/protocol.ts`

Two targeted edits:

**Edit A:** Add `speech_final` to the transcript ServerMessage:

```typescript
// Old:
| { type: 'transcript'; text: string; is_final: boolean }

// New:
| { type: 'transcript'; text: string; is_final: boolean; speech_final: boolean }
```

**Edit B:** Add the `navigate` ClientMessage variant:

```typescript
// Old:
export type ClientMessage =
  | { type: 'start'; presentation_id?: string }
  | { type: 'audio_chunk'; data: string }
  | { type: 'interrupt' }
  | { type: 'ping' }

// New:
export type ClientMessage =
  | { type: 'start'; presentation_id?: string }
  | { type: 'audio_chunk'; data: string }
  | { type: 'interrupt' }
  | { type: 'navigate'; index: number }
  | { type: 'ping' }
```

---

## Task 2: Update `src/hooks/useAudioPlayer.ts`

Add `stoppingRef` to block `onChunk` from lazy-initing after `stop()` is called.

**Add the ref declaration** after `sessionActiveRef`:

```typescript
  /** True from stop() until the next initSession() — blocks onChunk lazy-init. */
  const stoppingRef = useRef(false)
```

**Update `initSession`:** reset `stoppingRef` at the start (before the guard check):

```typescript
  const initSession = useCallback(() => {
    stoppingRef.current = false   // NEW — a new session is starting; un-block onChunk
    // Avoid tearing down a session that onChunk already started (lazy init + Plan 05 rising-edge effect).
    if (sessionActiveRef.current && mediaSourceRef.current) {
      return
    }
    // ... rest unchanged
```

**Update `onChunk`:** drop chunks while stopping:

```typescript
  const onChunk = useCallback(
    (base64: string) => {
      // Drop in-flight chunks from the interrupted TTS stream.
      // stoppingRef is true from stop() until the next initSession().
      if (stoppingRef.current) return   // NEW

      if (!sessionActiveRef.current) {
        initSession()
      }
      // ... rest unchanged
```

**Update `stop`:** set `stoppingRef` at the very start:

```typescript
  const stop = useCallback(() => {
    stoppingRef.current = true   // NEW — block onChunk from re-initing
    sessionActiveRef.current = false
    chunkQueueRef.current = []
    isAppendingRef.current = false
    // ... rest unchanged (fade logic, teardown)
```

The `stoppingRef` stays `true` through the 120ms fade and `teardown()`. It is only reset
to `false` when `initSession()` is called explicitly — which only happens in App.tsx's
rising-edge effect when `wsState.isTTSActive` goes from `false` to `true` for a NEW stream.

---

## Task 3: Update `src/hooks/useWebSocket.ts`

Two targeted changes:

### Change A: Gate `hasFinalTranscript` on `speech_final`

In the `transcript` case of `handleMessage`:

```typescript
      case 'transcript':
        setState((s) => ({
          ...s,
          transcript: msg.text,
          // speech_final fires once per full utterance (after silence threshold).
          // is_final fires at segment boundaries (mid-sentence pauses) — not a reliable agent trigger.
          // Fall back to is_final if speech_final is absent (backwards compat during Plan 10 rollout).
          hasFinalTranscript:
            (msg.speech_final ?? msg.is_final) && msg.text.trim().length > 0,
        }))
        break
```

### Change B: Add `navigate()` to `WebSocketControls`

Update the `WebSocketControls` interface:

```typescript
export interface WebSocketControls {
  connect: (presentationId?: string) => void
  disconnect: () => void
  send: (msg: ClientMessage) => void
  navigate: (index: number) => void   // NEW
  onTTSChunk: MutableRefObject<((data: string) => void) | null>
  onTTSDone: MutableRefObject<(() => void) | null>
  endAssistantPlayback: () => void
}
```

Add the `navigate` implementation (after the existing `disconnect` useCallback):

```typescript
  const navigate = useCallback((index: number) => {
    send({ type: 'navigate', index })
  }, [send])
```

Add `navigate` to the `controls` object at the bottom:

```typescript
  const controls: WebSocketControls = {
    connect,
    disconnect,
    send,
    navigate,   // NEW
    onTTSChunk,
    onTTSDone,
    endAssistantPlayback,
  }
```

---

## Task 4: Update `src/components/Header.tsx`

Add an `onReset` prop and a small reset button. The button appears only when connected
(when `connected === true`). It shows a restart icon (↺) with "Reset" label.

```tsx
import { ThemeToggle } from '@/components/ThemeToggle'
import { Badge } from '@/components/ui/badge'

interface Props {
  connected: boolean
  slideIndex: number
  totalSlides: number
  title?: string
  onReset?: () => void   // NEW — called on reset button click
}

export function Header({
  connected,
  slideIndex,
  totalSlides,
  title = 'AI in Clinical Trials',
  onReset,
}: Props) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-white/80 px-8 py-3.5 backdrop-blur-sm dark:border-white/10 dark:bg-slate-950/90">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="flex items-center gap-3">
        <ThemeToggle />

        {/* Reset session button — only shown when connected */}
        {connected && onReset ? (
          <button
            type="button"
            onClick={onReset}
            title="Restart from slide 1"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* Restart / refresh icon */}
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 12A7.5 7.5 0 0 1 12 4.5V3m0 1.5A7.5 7.5 0 1 1 4.5 12"
              />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v3" />
            </svg>
            Reset
          </button>
        ) : null}

        <Badge
          variant={connected ? 'outline' : 'secondary'}
          className={`text-xs font-medium ${
            connected
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/35 dark:bg-emerald-950/55 dark:text-emerald-300'
              : 'text-muted-foreground'
          }`}
        >
          <span
            className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
              connected ? 'bg-emerald-500' : 'bg-muted-foreground/40'
            }`}
          />
          {connected ? 'Connected' : 'Disconnected'}
        </Badge>
        <span className="font-mono text-xs text-muted-foreground">
          {String(slideIndex + 1).padStart(2, '0')}/
          {String(totalSlides).padStart(2, '0')}
        </span>
      </div>
    </header>
  )
}
```

---

## Task 5: Replace `src/App.tsx`

Full replacement. Changes from the current version:
1. Add `navigate` to the wsControls destructure
2. Add `conversationHistory` state and its update effects
3. Add `handleReset` function
4. Add keyboard navigation `useEffect`
5. Pass `onReset` to `Header`
6. Replace the footer with a multi-turn conversation history panel
7. Clear conversation history on reset

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'

import { Header } from '@/components/Header'
import { OrbPanel } from '@/components/OrbPanel'
import { PresentationSelector } from '@/components/PresentationSelector'
import { SlideNav } from '@/components/SlideNav'
import { SlideView } from '@/components/SlideView'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useAudioCapture } from '@/hooks/useAudioCapture'
import { useAudioPlayer } from '@/hooks/useAudioPlayer'
import { useVoiceState } from '@/hooks/useVoiceState'
import { useWebSocket } from '@/hooks/useWebSocket'
import type { PresentationMeta } from '@/types/protocol'

interface ConversationTurn {
  role: 'user' | 'assistant'
  text: string
}

export default function App() {
  const [micDenied, setMicDenied] = useState(false)
  const [selectedPresentation, setSelectedPresentation] =
    useState<PresentationMeta | null>(null)
  const [started, setStarted] = useState(false)
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([])

  const [
    wsState,
    {
      connect,
      disconnect,
      send,
      navigate,
      onTTSChunk: onTTSChunkRef,
      onTTSDone: onTTSDoneRef,
      endAssistantPlayback,
    },
  ] = useWebSocket()
  const audioPlayer = useAudioPlayer(endAssistantPlayback)

  const handleInterrupt = useCallback(() => {
    send({ type: 'interrupt' })
    audioPlayer.stop()
  }, [send, audioPlayer])

  const [captureState, captureControls] = useAudioCapture({
    onChunk: send,
    onInterrupt: handleInterrupt,
    isTTSActive: wsState.isTTSActive,
    agentTurnActive: wsState.agentTurnActive,
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

  // ── Conversation history ──────────────────────────────────────────────
  // Track the last transcript we recorded to avoid duplicate entries
  const lastRecordedTranscriptRef = useRef('')

  // When user finishes speaking (speech_final → hasFinalTranscript), record user turn
  useEffect(() => {
    if (
      wsState.hasFinalTranscript &&
      wsState.transcript.trim() &&
      wsState.transcript !== lastRecordedTranscriptRef.current
    ) {
      lastRecordedTranscriptRef.current = wsState.transcript
      setConversationHistory((prev) => [
        ...prev,
        { role: 'user', text: wsState.transcript },
      ])
    }
  }, [wsState.hasFinalTranscript, wsState.transcript])

  // When agent text arrives, add or update the last assistant turn
  useEffect(() => {
    if (!wsState.agentText.trim()) return
    setConversationHistory((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === 'assistant') {
        // Update in-progress assistant turn (in case it comes in pieces)
        return [...prev.slice(0, -1), { role: 'assistant', text: wsState.agentText }]
      }
      return [...prev, { role: 'assistant', text: wsState.agentText }]
    })
  }, [wsState.agentText])

  // ── Handlers ─────────────────────────────────────────────────────────
  const handleSelectPresentation = useCallback(
    (presentation: PresentationMeta) => {
      setSelectedPresentation(presentation)
      setStarted(true)
      connect(presentation.id)
    },
    [connect],
  )

  const handleReset = useCallback(() => {
    // Stop capture and audio, disconnect, clear local state
    captureControls.stop()
    audioPlayer.stop()
    disconnect()
    setConversationHistory([])
    lastRecordedTranscriptRef.current = ''

    // Reconnect after brief cleanup delay
    const pid = selectedPresentation?.id ?? 'clinical-trials'
    setTimeout(() => {
      connect(pid)
    }, 150)
  }, [captureControls, audioPlayer, disconnect, connect, selectedPresentation])

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

  // ── Keyboard slide navigation ─────────────────────────────────────────
  // ← / → navigate slides. Disabled during ai-speaking / thinking to avoid
  // interrupting mid-response. Only active when connected.
  const totalSlides = selectedPresentation?.slide_count ?? 6

  useEffect(() => {
    if (!started) return
    const handleKey = (e: KeyboardEvent) => {
      // Don't hijack keys typed in text inputs
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      // Don't navigate while AI is working — wait for idle/listening state
      if (voiceState === 'ai-speaking' || voiceState === 'thinking') return
      if (!wsState.connected) return

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        const next = wsState.slideIndex + 1
        if (next < totalSlides) navigate(next)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        const prev = wsState.slideIndex - 1
        if (prev >= 0) navigate(prev)
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [
    started,
    wsState.connected,
    wsState.slideIndex,
    voiceState,
    totalSlides,
    navigate,
  ])

  // ── Catalog screen ────────────────────────────────────────────────────
  if (!started) {
    return (
      <div className="relative">
        <div className="absolute right-4 top-4 z-10 sm:right-8 sm:top-6">
          <ThemeToggle />
        </div>
        <PresentationSelector onSelect={handleSelectPresentation} />
      </div>
    )
  }

  // ── Presentation screen ───────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {wsState.error ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-8 py-2 text-center text-sm text-destructive">
          {wsState.error}
        </div>
      ) : null}
      {micDenied && !wsState.error ? (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-8 py-2 text-center text-sm text-amber-700 dark:text-amber-400">
          Microphone access denied. Please allow microphone permission and refresh.
        </div>
      ) : null}

      <Header
        connected={wsState.connected}
        slideIndex={wsState.slideIndex}
        totalSlides={totalSlides}
        title={selectedPresentation?.title}
        onReset={handleReset}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 flex-col bg-background" style={{ width: '65%' }}>
          <SlideView slide={wsState.currentSlide} totalSlides={totalSlides} />
          <SlideNav total={totalSlides} current={wsState.slideIndex} />
        </div>
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

      {/* Conversation history footer */}
      <ConversationFooter
        history={conversationHistory}
        voiceState={voiceState}
        currentTranscript={wsState.transcript}
        currentAgentText={wsState.agentText}
      />
    </div>
  )
}

// ── ConversationFooter ────────────────────────────────────────────────────
// Shows the last 4 turns in a fixed-height scrollable panel.
// Always scrolls to the bottom when new content arrives.

interface ConversationFooterProps {
  history: ConversationTurn[]
  voiceState: string
  currentTranscript: string
  currentAgentText: string
}

function ConversationFooter({
  history,
  voiceState,
  currentTranscript,
  currentAgentText,
}: ConversationFooterProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when history changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [history, currentTranscript, currentAgentText])

  const isEmpty = history.length === 0 && !currentTranscript && !currentAgentText

  return (
    <footer className="border-t border-border/50 bg-background/80 backdrop-blur dark:border-white/10">
      <div
        ref={scrollRef}
        className="mx-auto max-h-36 max-w-5xl overflow-y-auto px-6 py-3 sm:px-8"
      >
        {isEmpty ? (
          <p className="py-2 text-center text-xs text-muted-foreground/50">
            Conversation will appear here — tap the mic to start
          </p>
        ) : (
          <div className="space-y-2">
            {history.map((turn, i) => (
              <TurnRow key={i} role={turn.role} text={turn.text} dim />
            ))}

            {/* Live interim transcript while user is speaking */}
            {(voiceState === 'user-speaking' || voiceState === 'listening') &&
            currentTranscript.trim() ? (
              <TurnRow role="user" text={currentTranscript} live />
            ) : null}

            {/* Live agent text while thinking/speaking */}
            {(voiceState === 'thinking' || voiceState === 'ai-speaking') &&
            currentAgentText.trim() ? (
              <TurnRow role="assistant" text={currentAgentText} live />
            ) : null}
          </div>
        )}
      </div>
    </footer>
  )
}

interface TurnRowProps {
  role: 'user' | 'assistant'
  text: string
  dim?: boolean
  live?: boolean
}

function TurnRow({ role, text, dim, live }: TurnRowProps) {
  const isUser = role === 'user'
  return (
    <div className={`flex items-start gap-2 text-sm ${dim ? 'opacity-60' : ''}`}>
      <span
        className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide ${
          isUser
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
            : 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-400'
        }`}
      >
        {isUser ? 'You' : 'AI'}
      </span>
      <p className={`min-w-0 leading-relaxed text-muted-foreground ${live ? 'italic' : ''}`}>
        {text}
        {live ? (
          <span className="ml-1 inline-block h-2 w-0.5 animate-pulse bg-current opacity-70" />
        ) : null}
      </p>
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

Expected: no errors.

Common issues:
- `navigate` not in `WebSocketControls` destructure → verify Task 3 added it to the interface and the controls object
- `speech_final` on transcript message not typed → verify Task 1 updated `ServerMessage`
- `onReset` prop missing on Header → verify Task 4 added it
- `ConversationTurn` used in App.tsx but not exported → it's a local interface, TS is fine with this
- `disconnect` used in `handleReset` but not destructured → verify Task 5's destructure includes it

---

## Task 7: Verification checklist

Start backend + frontend:
```bash
cd backend && source venv/bin/activate && uvicorn app.main:app --port 8000
cd frontend && npm run dev
```

### Test A: No more old audio during thinking (stoppingRef fix)
1. Ask a question, wait for TTS audio to start playing
2. Interrupt by speaking (or tap-to-interrupt)
3. Watch the orb: it should go immediately to "Thinking..." with NO audio playing
4. **Failure sign:** If you hear 1–2 seconds of the old response before silence, the stoppingRef
   fix didn't apply — check Task 2 was applied to all three locations

### Test B: No premature thinking flash (speech_final fix)
1. Start mic, speak: "Tell me about... [pause 1.5 seconds] ...AlphaFold"
2. **Expected:** Orb stays in `user-speaking` (green) through the pause and completes to
   `thinking` only after the full sentence. No flash to "Thinking..." on the pause.
3. Only works fully after Plan 10 backend is also deployed (backend must send `speech_final`)

### Test C: Keyboard navigation
1. Connect, get slide 1
2. Press → (right arrow): slide should advance to 2, nav dots update
3. Press ← (left arrow): slide returns to 1
4. During AI speaking: press → — nothing should happen
5. Open browser DevTools → Network → WS: verify `{"type":"navigate","index":N}` messages

### Test D: Session reset
1. Navigate to slide 3, have a 2-turn conversation
2. Click "Reset" in the header
3. **Expected:**
   - Returns to slide 1 (slide_change message from backend)
   - Conversation history panel clears
   - Connected badge briefly shows disconnected then reconnects
   - Orb resets to idle

### Test E: Conversation history panel
1. Ask 3 questions and wait for answers
2. **Expected:** Footer panel shows up to all turns:
   - User turns: small green "You" label
   - AI turns: small indigo "AI" label  
   - Live interim transcript appears while speaking (italic, with cursor blink)
   - Panel auto-scrolls to the bottom on new content

### Test F: Keyboard nav respects voice state
1. Ask a question, wait for AI to start speaking
2. Press → during `ai-speaking`: nothing should happen
3. After TTS finishes (orb returns to listening): press → again — nav works

---

## Acceptance Criteria

- [ ] `types/protocol.ts` — `speech_final` in transcript ServerMessage, `navigate` in ClientMessage
- [ ] `useAudioPlayer.ts` — `stoppingRef` prevents onChunk re-init after `stop()`
- [ ] `useWebSocket.ts` — `hasFinalTranscript` gated on `speech_final ?? is_final`, `navigate()` exposed
- [ ] `Header.tsx` — `onReset` prop, reset button visible when connected
- [ ] `App.tsx` — keyboard nav (← →), `handleReset`, conversation history effects, `ConversationFooter`
- [ ] Old TTS audio does NOT play during thinking phase after interrupt
- [ ] No premature thinking flash on mid-sentence pause (requires Plan 10 deployed)
- [ ] Keyboard navigation works; disabled during ai-speaking/thinking
- [ ] Reset returns to slide 1 with cleared history
- [ ] Conversation history shows up to N turns with live transcript blinking cursor
- [ ] TypeScript compiles clean

## File Checklist After This Plan

```
src/
  types/
    protocol.ts               ← speech_final in transcript, navigate ClientMessage
  hooks/
    useAudioPlayer.ts         ← stoppingRef fix (3 locations)
    useWebSocket.ts           ← speech_final drives hasFinalTranscript, navigate()
  components/
    Header.tsx                ← onReset prop + reset button
  App.tsx                     ← keyboard nav + reset + ConversationFooter + history state
```
