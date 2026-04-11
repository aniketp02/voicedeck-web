# Frontend Agent Plan 09 — Presentation Catalog Screen

## Agent Instructions
Read this plan fully before acting. Do not ask questions. All decisions are made.

**Dependencies — both must be complete before starting this plan:**
- **Plan 07** (interrupt UX) — App.tsx is rewritten there; this plan builds on that version
- **Plan 08** (backend catalog) — the `GET /presentations` endpoint must exist

---

## Goal
Replace the single hardcoded "Start Presentation" screen with a catalog that lets the user
choose from available presentations before connecting. The selected presentation ID is passed
to the backend via the WebSocket `start` message.

**What this plan does NOT do:**
- No PPTX/PDF upload parsing (out of scope — requires file processing pipeline)
- No creating new presentations in the UI — the catalog shows what's registered in the backend
- The voice, interrupt, and slide mechanics are unchanged

**Files changed:**
- `src/types/protocol.ts` — add `PresentationMeta`, update `ClientMessage.start`
- `src/hooks/useWebSocket.ts` — `connect(presentationId)` sends the ID in start message
- `src/components/PresentationSelector.tsx` — NEW: catalog grid with loading/error states
- `src/App.tsx` — add catalog screen before the existing start screen

---

## Task 1: Update `src/types/protocol.ts`

Two changes:
1. Add `PresentationMeta` interface (matches the backend `/presentations` API response shape)
2. Update `ClientMessage` so the `start` message can carry `presentation_id`

```typescript
// All messages the server can send to the client
export type ServerMessage =
  | { type: 'transcript'; text: string; is_final: boolean }
  | { type: 'slide_change'; index: number; slide: SlideData }
  | { type: 'agent_text'; text: string }
  | { type: 'tts_chunk'; data: string }
  | { type: 'tts_done' }
  | { type: 'error'; message: string }
  | { type: 'pong' }

// All messages the client can send to the server
export type ClientMessage =
  | { type: 'start'; presentation_id?: string }  // presentation_id optional for backwards compat
  | { type: 'audio_chunk'; data: string }
  | { type: 'interrupt' }
  | { type: 'ping' }

export interface SlideData {
  title: string
  bullets: string[]
}

export interface Slide extends SlideData {
  index: number
}

/** Presentation catalog entry — matches GET /presentations response shape. */
export interface PresentationMeta {
  id: string
  title: string
  description: string
  slide_count: number
}

// Voice state drives orb hue and status label
export type VoiceState =
  | 'idle'           // not started
  | 'listening'      // mic on, waiting for speech
  | 'user-speaking'  // VAD detected user voice
  | 'thinking'       // LLM processing (transcript received, no agent_text yet)
  | 'ai-speaking'    // TTS streaming

export function voiceStateToHue(state: VoiceState): number {
  switch (state) {
    case 'user-speaking':
      return 120
    case 'ai-speaking':
      return 260
    default:
      return 0
  }
}

export function voiceStateToLabel(state: VoiceState): string {
  switch (state) {
    case 'idle':
      return 'Click mic to start'
    case 'listening':
      return 'Listening...'
    case 'user-speaking':
      return 'Hearing you...'
    case 'thinking':
      return 'Thinking...'
    case 'ai-speaking':
      return 'Speaking...'
  }
}
```

---

## Task 2: Update `src/hooks/useWebSocket.ts`

`connect()` now accepts a `presentationId` argument (defaults to `'clinical-trials'` for
backwards compatibility). It includes the ID in the `start` message sent on socket open.

Also update `WebSocketControls.connect` type signature.

```typescript
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'

import type { ClientMessage, ServerMessage, Slide } from '@/types/protocol'

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

export interface WebSocketState {
  connected: boolean
  currentSlide: Slide | null
  slideIndex: number
  transcript: string
  agentText: string
  hasFinalTranscript: boolean
  isTTSActive: boolean
  error: string | null
}

export interface WebSocketControls {
  connect: (presentationId?: string) => void   // presentationId defaults to 'clinical-trials'
  disconnect: () => void
  send: (msg: ClientMessage) => void
  onTTSChunk: MutableRefObject<((data: string) => void) | null>
  onTTSDone: MutableRefObject<(() => void) | null>
}

const INITIAL_STATE: WebSocketState = {
  connected: false,
  currentSlide: null,
  slideIndex: 0,
  transcript: '',
  agentText: '',
  hasFinalTranscript: false,
  isTTSActive: false,
  error: null,
}

export function useWebSocket(): [WebSocketState, WebSocketControls] {
  const ws = useRef<WebSocket | null>(null)
  const [state, setState] = useState<WebSocketState>(INITIAL_STATE)

  const onTTSChunk = useRef<((data: string) => void) | null>(null)
  const onTTSDone = useRef<(() => void) | null>(null)

  const send = useCallback((msg: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg))
    }
  }, [])

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'slide_change':
        setState((s) => ({
          ...s,
          currentSlide: { index: msg.index, ...msg.slide },
          slideIndex: msg.index,
          agentText: '',
          hasFinalTranscript: false,
        }))
        break

      case 'transcript':
        setState((s) => ({
          ...s,
          transcript: msg.text,
          hasFinalTranscript: msg.is_final && msg.text.trim().length > 0,
        }))
        break

      case 'agent_text':
        setState((s) => ({ ...s, agentText: msg.text }))
        break

      case 'tts_chunk':
        setState((s) => ({ ...s, isTTSActive: true, hasFinalTranscript: false }))
        onTTSChunk.current?.(msg.data)
        break

      case 'tts_done':
        setState((s) => ({ ...s, isTTSActive: false }))
        onTTSDone.current?.()
        break

      case 'error':
        setState((s) => ({ ...s, error: msg.message }))
        break

      case 'pong':
        break
    }
  }, [])

  const connect = useCallback(
    (presentationId: string = 'clinical-trials') => {
      if (ws.current?.readyState === WebSocket.OPEN) return

      const socket = new WebSocket(WS_URL)
      ws.current = socket

      socket.onopen = () => {
        setState((s) => ({ ...s, connected: true, error: null }))
        // Send start with presentation_id so the backend loads the right content
        socket.send(
          JSON.stringify({
            type: 'start',
            presentation_id: presentationId,
          } satisfies ClientMessage),
        )
      }

      socket.onclose = (e) => {
        setState((s) => ({
          ...s,
          connected: false,
          isTTSActive: false,
          hasFinalTranscript: false,
          error: !e.wasClean ? `Connection closed (code ${e.code})` : s.error,
        }))
      }

      socket.onerror = () => {
        setState((s) => ({
          ...s,
          error: 'WebSocket connection failed. Is the backend running?',
        }))
      }

      socket.onmessage = (event) => {
        try {
          const msg: ServerMessage = JSON.parse(event.data as string)
          handleMessage(msg)
        } catch {
          console.warn('Received non-JSON WebSocket message:', event.data)
        }
      }
    },
    [handleMessage],
  )

  const disconnect = useCallback(() => {
    ws.current?.close(1000, 'User disconnected')
    ws.current = null
    setState({ ...INITIAL_STATE })
  }, [])

  useEffect(() => {
    return () => {
      ws.current?.close()
    }
  }, [])

  const controls: WebSocketControls = {
    connect,
    disconnect,
    send,
    onTTSChunk,
    onTTSDone,
  }
  return [state, controls]
}
```

---

## Task 3: Create `src/components/PresentationSelector.tsx`

New component. Fetches `/api/presentations`, renders a card grid.
States: loading, error (backend down), and the card grid.

The proxy in `vite.config.ts` maps `/api/*` → `http://localhost:8000/*` (strips `/api` prefix),
so `fetch('/api/presentations')` hits `GET http://localhost:8000/presentations`.

Design decisions:
- Cards use light theme (white card on the hero-bg gradient from Plan 06)
- Slide count shown as a small badge on each card
- Hover: lift shadow + indigo ring — signals interactivity
- Loading state: 2 skeleton cards
- Error state: inline message with retry button

```tsx
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

import type { PresentationMeta } from '@/types/protocol'

interface Props {
  onSelect: (presentationId: string, title: string) => void
}

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; presentations: PresentationMeta[] }

export function PresentationSelector({ onSelect }: Props) {
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'loading' })

  const fetchPresentations = () => {
    setFetchState({ status: 'loading' })
    fetch('/api/presentations')
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`)
        return res.json() as Promise<PresentationMeta[]>
      })
      .then((presentations) => setFetchState({ status: 'ready', presentations }))
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : 'Could not reach backend'
        setFetchState({ status: 'error', message })
      })
  }

  useEffect(() => {
    fetchPresentations()
  }, [])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-10 hero-bg px-6">
      {/* Header */}
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white/70 px-4 py-1.5 text-xs font-medium text-indigo-700 shadow-sm backdrop-blur-sm">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500" />
          Voice-Interactive Presentations
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          Choose a Presentation
        </h1>
        <p className="max-w-sm text-muted-foreground">
          Ask questions, get answers — the slides follow the conversation.
        </p>
      </div>

      {/* Card grid */}
      <div className="w-full max-w-2xl">
        {fetchState.status === 'loading' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {fetchState.status === 'error' && (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-destructive/20 bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-destructive">
              Could not load presentations — is the backend running?
            </p>
            <p className="font-mono text-xs text-muted-foreground">{fetchState.message}</p>
            <button
              type="button"
              onClick={fetchPresentations}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {fetchState.status === 'ready' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {fetchState.presentations.map((p, i) => (
              <PresentationCard
                key={p.id}
                presentation={p}
                index={i}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface CardProps {
  presentation: PresentationMeta
  index: number
  onSelect: (id: string, title: string) => void
}

function PresentationCard({ presentation, index, onSelect }: CardProps) {
  return (
    <motion.button
      type="button"
      onClick={() => onSelect(presentation.id, presentation.title)}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.3, ease: 'easeOut' }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className="group flex flex-col items-start gap-3 rounded-2xl border border-border bg-white p-6 text-left shadow-sm transition-all hover:border-indigo-200 hover:shadow-md hover:shadow-indigo-100/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
    >
      {/* Slide count badge */}
      <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
        {presentation.slide_count} slides
      </span>

      {/* Title */}
      <h3 className="text-base font-semibold leading-snug text-foreground group-hover:text-indigo-700 transition-colors">
        {presentation.title}
      </h3>

      {/* Description */}
      <p className="text-sm leading-relaxed text-muted-foreground">
        {presentation.description}
      </p>

      {/* CTA row */}
      <div className="mt-auto flex items-center gap-1.5 text-xs font-medium text-indigo-600 opacity-0 transition-opacity group-hover:opacity-100">
        Start presentation
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </motion.button>
  )
}

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-6 shadow-sm">
      <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
      <div className="h-5 w-3/4 animate-pulse rounded-md bg-muted" />
      <div className="space-y-1.5">
        <div className="h-3.5 animate-pulse rounded bg-muted" />
        <div className="h-3.5 w-5/6 animate-pulse rounded bg-muted" />
      </div>
    </div>
  )
}
```

---

## Task 4: Replace `src/App.tsx`

Add two new state variables:
- `selectedPresentation: { id: string; title: string } | null` — set when user picks from catalog
- Update `handlePresentationStart` to accept the selection and pass `presentationId` to `connect()`

The app now has three screens:
1. **Catalog** (`selectedPresentation === null`) — `PresentationSelector`
2. **Start** (`selectedPresentation !== null && !started`) — NOT USED (selection → connect immediately)
3. **Presentation** (`started === true`) — the main layout

Actually: selecting a card immediately starts the presentation — no intermediate "Start" button.
The catalog card IS the start button. This reduces clicks.

Also: pass `title` to `Header` so it shows the real presentation title (Header got a `title` prop in Plan 06).

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'

import { Header } from '@/components/Header'
import { OrbPanel } from '@/components/OrbPanel'
import { PresentationSelector } from '@/components/PresentationSelector'
import { SlideNav } from '@/components/SlideNav'
import { SlideView } from '@/components/SlideView'
import { useAudioCapture } from '@/hooks/useAudioCapture'
import { useAudioPlayer } from '@/hooks/useAudioPlayer'
import { useVoiceState } from '@/hooks/useVoiceState'
import { useWebSocket } from '@/hooks/useWebSocket'

export default function App() {
  const [micDenied, setMicDenied] = useState(false)
  const [selectedPresentation, setSelectedPresentation] = useState<{
    id: string
    title: string
  } | null>(null)
  const [started, setStarted] = useState(false)

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

  // Called when user clicks a presentation card in the catalog.
  // Immediately connects and starts the presentation — no intermediate screen.
  const handleSelectPresentation = useCallback(
    (id: string, title: string) => {
      setSelectedPresentation({ id, title })
      setStarted(true)
      connect(id)
    },
    [connect],
  )

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

  const totalSlides = selectedPresentation?.id === 'drug-discovery' ? 6 : 6

  // ── Catalog screen ─────────────────────────────────────────────────────
  if (!started) {
    return <PresentationSelector onSelect={handleSelectPresentation} />
  }

  // ── Presentation screen ─────────────────────────────────────────────────
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
        totalSlides={totalSlides}
        title={selectedPresentation?.title}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left panel: slide content */}
        <div className="flex min-h-0 flex-col bg-background" style={{ width: '65%' }}>
          <SlideView slide={wsState.currentSlide} totalSlides={totalSlides} />
          <SlideNav total={totalSlides} current={wsState.slideIndex} />
        </div>

        {/* Right panel: orb + voice controls */}
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

Note on `totalSlides`: currently hardcoded to 6 since both presentations have 6 slides.
A cleaner approach would be `wsState.currentSlide?.totalSlides` or tracking it from the
backend — but that requires a protocol change. Both presentations have 6 slides, so
this is correct as-is for the MVP. Leave a `// TODO:` comment if desired.

---

## Task 5: TypeScript verification

```bash
cd frontend
npx tsc --noEmit
```

Expected: no errors.

Common issues:
- `PresentationMeta` not exported from `@/types/protocol` → verify Task 1 added the export
- `connect` called with argument in App.tsx but typed as `() => void` → verify Task 2 updated the type signature to `(presentationId?: string) => void`
- `hero-bg` class not found by TS (it's a CSS class, TS won't check this — ignore)
- `title` prop on `Header` missing → verify Plan 06's Header has `title?: string` prop

---

## Task 6: End-to-end verification

Start backend + frontend:
```bash
# Terminal 1
cd backend && source venv/bin/activate && uvicorn app.main:app --port 8000 --log-level info

# Terminal 2
cd frontend && npm run dev
```

### Test 1: Catalog loads
1. Open http://localhost:5173
2. **Expected:** Catalog screen with gradient background and 2 presentation cards:
   - "AI in Clinical Trials" (6 slides)
   - "AI in Drug Discovery" (6 slides)
3. Cards appear with stagger animation (one after the other)

### Test 2: Clinical trials flow
1. Click "AI in Clinical Trials" card
2. **Expected:**
   - Header shows "AI in Clinical Trials" title
   - Slide 01/06: "The Broken Machine: Clinical Trials Today" renders
   - WebSocket connected badge (green)

### Test 3: Drug Discovery flow
1. Refresh page
2. Click "AI in Drug Discovery" card
3. **Expected:**
   - Header shows "AI in Drug Discovery"
   - Slide 01/06: "The Drug Discovery Crisis" renders
   - Backend terminal: `INFO  Session started: presentation='drug-discovery' slides=6`

### Test 4: Drug Discovery navigation
1. Click mic, ask: "Tell me about AlphaFold"
2. **Expected:** Slide navigates to "AlphaFold and the Structural Revolution" (slide 2)
3. AI speaks about AlphaFold content, not clinical trials content

### Test 5: Backend down (error state)
1. Stop backend, open http://localhost:5173
2. **Expected:** Catalog loads (it tries to fetch) → shows error card with "Retry" button
3. Start backend, click Retry → catalog appears with 2 cards

---

## Acceptance Criteria

- [ ] `src/types/protocol.ts` — `PresentationMeta` exported, `ClientMessage.start` has optional `presentation_id`
- [ ] `src/hooks/useWebSocket.ts` — `connect(presentationId?)` sends `presentation_id` in start message
- [ ] `src/components/PresentationSelector.tsx` — loads from `/api/presentations`, renders cards, loading/error states
- [ ] `src/App.tsx` — catalog screen before started check, `handleSelectPresentation` wires connect
- [ ] Header shows the correct presentation title
- [ ] Catalog → click "AI in Drug Discovery" → correct slides load and AI answers about Drug Discovery content
- [ ] Backend down → error state with Retry button
- [ ] TypeScript compiles clean

## File Checklist After This Plan

```
src/
  types/
    protocol.ts                 ← PresentationMeta added, ClientMessage.start updated
  hooks/
    useWebSocket.ts             ← connect(presentationId?) updated
  components/
    PresentationSelector.tsx    ← NEW: catalog grid
  App.tsx                       ← catalog screen + handleSelectPresentation
```
