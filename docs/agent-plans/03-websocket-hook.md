# Frontend Agent Plan 03 — WebSocket Hook + Connection State

## Agent Instructions
Read this plan fully before acting. Do not ask questions. All decisions are made.
Plans 01 and 02 must be complete before starting.

---

## Goal
Implement `useWebSocket` — the central state hook that connects to the backend
WebSocket, handles all incoming messages, and exposes state + send function
to the rest of the app.

Also create `useVoiceState` — a small derived hook that tracks `VoiceState`
transitions based on WebSocket events and audio activity.

**Success criterion:** After implementing this plan, clicking "Start" in a
modified App.tsx connects to the backend, the first slide appears from a
real `slide_change` message, and live transcripts show up.

---

## Background: State Machine

```
VoiceState transitions:
  idle
    → listening          (mic starts)

  listening
    → user-speaking      (VAD threshold exceeded — from useAudioCapture in Plan 04)
    → idle               (mic stops)

  user-speaking
    → thinking           (is_final transcript received)
    → listening          (voice stops, no final transcript yet)

  thinking
    → ai-speaking        (first tts_chunk received)
    → listening          (tts_done without any tts_chunk — edge case)

  ai-speaking
    → listening          (tts_done received)
    → listening          (interrupt sent)
```

---

## Task 1: Create `src/hooks/useWebSocket.ts`

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClientMessage, ServerMessage, Slide } from '../types/protocol'

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

export interface WebSocketState {
  connected: boolean
  currentSlide: Slide | null
  slideIndex: number
  transcript: string       // latest (possibly interim) transcript
  agentText: string        // latest agent response text
  hasFinalTranscript: boolean  // true after is_final received (drives thinking state)
  isTTSActive: boolean         // true while tts_chunks arriving (before tts_done)
  error: string | null
}

export interface WebSocketControls {
  connect: () => void
  disconnect: () => void
  send: (msg: ClientMessage) => void
  // Callback refs — set by useAudioPlayer in Plan 04
  onTTSChunk: React.MutableRefObject<((data: string) => void) | null>
  onTTSDone: React.MutableRefObject<(() => void) | null>
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

  // Callback refs for audio player (wired up in Plan 05)
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
        setState(s => ({
          ...s,
          currentSlide: { index: msg.index, ...msg.slide },
          slideIndex: msg.index,
          agentText: '',         // clear old agent text on slide change
          hasFinalTranscript: false,
        }))
        break

      case 'transcript':
        setState(s => ({
          ...s,
          transcript: msg.text,
          hasFinalTranscript: msg.is_final && msg.text.trim().length > 0,
        }))
        break

      case 'agent_text':
        setState(s => ({ ...s, agentText: msg.text }))
        break

      case 'tts_chunk':
        setState(s => ({ ...s, isTTSActive: true, hasFinalTranscript: false }))
        onTTSChunk.current?.(msg.data)
        break

      case 'tts_done':
        setState(s => ({ ...s, isTTSActive: false }))
        onTTSDone.current?.()
        break

      case 'error':
        setState(s => ({ ...s, error: msg.message }))
        break

      case 'pong':
        break // no-op
    }
  }, [])

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return

    const socket = new WebSocket(WS_URL)
    ws.current = socket

    socket.onopen = () => {
      setState(s => ({ ...s, connected: true, error: null }))
      socket.send(JSON.stringify({ type: 'start' } satisfies ClientMessage))
    }

    socket.onclose = (e) => {
      setState(s => ({
        ...s,
        connected: false,
        isTTSActive: false,
        hasFinalTranscript: false,
      }))
      if (!e.wasClean) {
        setState(s => ({ ...s, error: `Connection closed (code ${e.code})` }))
      }
    }

    socket.onerror = () => {
      setState(s => ({ ...s, error: 'WebSocket connection failed. Is the backend running?' }))
    }

    socket.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data)
        handleMessage(msg)
      } catch {
        console.warn('Received non-JSON WebSocket message:', event.data)
      }
    }
  }, [handleMessage])

  const disconnect = useCallback(() => {
    ws.current?.close(1000, 'User disconnected')
    ws.current = null
    setState(INITIAL_STATE)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      ws.current?.close()
    }
  }, [])

  const controls: WebSocketControls = { connect, disconnect, send, onTTSChunk, onTTSDone }
  return [state, controls]
}
```

---

## Task 2: Create `src/hooks/useVoiceState.ts`

Derives `VoiceState` from WebSocket state and audio activity.
This is the single source of truth for orb hue and status label.

```typescript
import { useEffect, useState } from 'react'
import type { VoiceState } from '../types/protocol'
import type { WebSocketState } from './useWebSocket'

interface VoiceStateInput {
  wsState: WebSocketState
  isCapturing: boolean      // mic is running
  isUserSpeaking: boolean   // VAD says voice detected
}

export function useVoiceState({
  wsState,
  isCapturing,
  isUserSpeaking,
}: VoiceStateInput): VoiceState {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')

  useEffect(() => {
    // Priority order (highest wins):
    if (wsState.isTTSActive) {
      setVoiceState('ai-speaking')
    } else if (wsState.hasFinalTranscript) {
      setVoiceState('thinking')
    } else if (isUserSpeaking && isCapturing) {
      setVoiceState('user-speaking')
    } else if (isCapturing) {
      setVoiceState('listening')
    } else {
      setVoiceState('idle')
    }
  }, [
    wsState.isTTSActive,
    wsState.hasFinalTranscript,
    isUserSpeaking,
    isCapturing,
  ])

  return voiceState
}
```

---

## Task 3: Wire into App.tsx for verification

Update `src/App.tsx` to use `useWebSocket` and show a real Start button:

```tsx
import { useState } from 'react'
import { Header } from './components/Header'
import { SlideView } from './components/SlideView'
import { SlideNav } from './components/SlideNav'
import { OrbPanel } from './components/OrbPanel'
import { useWebSocket } from './hooks/useWebSocket'
import type { VoiceState } from './types/protocol'

const TOTAL_SLIDES = 6

export default function App() {
  const [started, setStarted] = useState(false)
  const [wsState, wsControls] = useWebSocket()

  // Placeholder voice state — wired properly in Plan 05
  const voiceState: VoiceState = wsState.isTTSActive ? 'ai-speaking'
    : wsState.hasFinalTranscript ? 'thinking'
    : wsState.connected ? 'listening'
    : 'idle'

  const handleStart = () => {
    setStarted(true)
    wsControls.connect()
  }

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
          />
        </div>
      </div>
    </div>
  )
}
```

---

## Task 4: Integration verification

### With backend running

```bash
# Terminal 1
cd backend && source venv/bin/activate && uvicorn app.main:app --port 8000

# Terminal 2
cd frontend && npm run dev
```

1. Open http://localhost:5173
2. Click "Start Presentation"
3. Orb appears, header shows "Connected" badge
4. First slide renders with title + bullets from real backend data
5. Open browser DevTools → Network → WS → verify messages:
   - Backend sends: `{"type":"slide_change","index":0,"slide":{...}}`
   - Frontend sends: `{"type":"start"}`

### Without backend (verify error state)

1. Stop backend
2. Click "Start Presentation"
3. **Expected:** Error banner appears: "WebSocket connection failed. Is the backend running?"
4. No crash — graceful degradation

---

## Acceptance Criteria

- [ ] `src/hooks/useWebSocket.ts` — full implementation, no stubs
- [ ] `src/hooks/useVoiceState.ts` — derives VoiceState from ws + audio state
- [ ] App.tsx Start button connects to backend
- [ ] First slide renders from real `slide_change` message
- [ ] Error banner shown when backend is unreachable
- [ ] `hasFinalTranscript` → `thinking` state (orb dims) — verify in logs
- [ ] `isTTSActive` → `ai-speaking` state (orb goes indigo) — verify after Plan 04
- [ ] TypeScript compiles: `npx tsc --noEmit`

## File Checklist After This Plan

```
src/
  hooks/
    useWebSocket.ts    ← WebSocket state + all message handling
    useVoiceState.ts   ← VoiceState derivation from ws + audio inputs
  App.tsx              ← Start screen + connected layout with real ws state
```
