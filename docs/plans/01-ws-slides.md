# Frontend Plan 01 — WebSocket Hook + Slide Display

## Goal
Build the WebSocket connection layer and the slide display UI.
By end of this plan:
- App connects to `ws://localhost:5173/ws` (proxied to backend)
- Slide changes from backend are rendered immediately
- A placeholder "Start" button initiates the session
- Live transcript text is shown in a bottom bar

**Success criterion:** Open the app, click Start, and the first slide appears.
Ask the backend to change slides manually (via wscat) and the UI updates.

## Types First: `src/types/protocol.ts`

```typescript
// All messages the server can send to the client
export type ServerMessage =
  | { type: 'transcript'; text: string; is_final: boolean }
  | { type: 'slide_change'; index: number; slide: SlideData }
  | { type: 'agent_text'; text: string }
  | { type: 'tts_chunk'; data: string }   // base64 MP3
  | { type: 'tts_done' }
  | { type: 'error'; message: string }
  | { type: 'pong' }

// All messages the client can send to the server
export type ClientMessage =
  | { type: 'start' }
  | { type: 'audio_chunk'; data: string }  // base64 PCM
  | { type: 'interrupt' }
  | { type: 'ping' }

export interface SlideData {
  title: string
  bullets: string[]
}

export interface Slide extends SlideData {
  index: number
}
```

## Hook: `src/hooks/useWebSocket.ts`

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClientMessage, ServerMessage, Slide } from '../types/protocol'

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

export interface WSState {
  connected: boolean
  currentSlide: Slide | null
  slideIndex: number
  transcript: string
  agentText: string
  isTTSSpeaking: boolean
  error: string | null
}

export function useWebSocket() {
  const ws = useRef<WebSocket | null>(null)
  const [state, setState] = useState<WSState>({
    connected: false,
    currentSlide: null,
    slideIndex: 0,
    transcript: '',
    agentText: '',
    isTTSSpeaking: false,
    error: null,
  })

  // Callback refs for audio handling (set by useAudioPlayer in Plan 03)
  const onTTSChunk = useRef<((data: string) => void) | null>(null)
  const onTTSDone = useRef<(() => void) | null>(null)

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return

    const socket = new WebSocket(WS_URL)
    ws.current = socket

    socket.onopen = () => {
      setState(s => ({ ...s, connected: true, error: null }))
      send({ type: 'start' })
    }

    socket.onclose = () => {
      setState(s => ({ ...s, connected: false }))
    }

    socket.onerror = () => {
      setState(s => ({ ...s, error: 'WebSocket connection failed' }))
    }

    socket.onmessage = (event) => {
      const msg: ServerMessage = JSON.parse(event.data)
      handleMessage(msg)
    }
  }, [])

  const disconnect = useCallback(() => {
    ws.current?.close()
    ws.current = null
  }, [])

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
          agentText: '',
        }))
        break

      case 'transcript':
        setState(s => ({ ...s, transcript: msg.text }))
        break

      case 'agent_text':
        setState(s => ({ ...s, agentText: msg.text }))
        break

      case 'tts_chunk':
        setState(s => ({ ...s, isTTSSpeaking: true }))
        onTTSChunk.current?.(msg.data)
        break

      case 'tts_done':
        setState(s => ({ ...s, isTTSSpeaking: false }))
        onTTSDone.current?.()
        break

      case 'error':
        setState(s => ({ ...s, error: msg.message }))
        break
    }
  }, [])

  useEffect(() => {
    return () => { ws.current?.close() }
  }, [])

  return { state, connect, disconnect, send, onTTSChunk, onTTSDone }
}
```

## Component: `src/components/SlideView.tsx`

```tsx
import type { Slide } from '../types/protocol'

interface Props {
  slide: Slide | null
  isTransitioning?: boolean
}

export function SlideView({ slide, isTransitioning }: Props) {
  if (!slide) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-500 text-xl">Connecting...</p>
      </div>
    )
  }

  return (
    <div
      className={`flex-1 flex flex-col justify-center px-16 py-12 transition-opacity duration-300 ${
        isTransitioning ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <h1 className="text-5xl font-bold text-white mb-10 leading-tight tracking-tight">
        {slide.title}
      </h1>
      <ul className="space-y-4">
        {slide.bullets.map((bullet, i) => (
          <li key={i} className="flex items-start gap-4">
            <span className="mt-2 w-2 h-2 rounded-full bg-purple-400 flex-shrink-0" />
            <span className="text-xl text-gray-200 leading-relaxed">{bullet}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

## Component: `src/components/SlideNav.tsx`

```tsx
interface Props {
  total: number
  current: number
}

export function SlideNav({ total, current }: Props) {
  return (
    <div className="flex items-center justify-center gap-3 pb-8">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`rounded-full transition-all duration-300 ${
            i === current
              ? 'w-6 h-2 bg-purple-400'
              : 'w-2 h-2 bg-gray-600'
          }`}
        />
      ))}
    </div>
  )
}
```

## Component: `src/components/TranscriptBar.tsx`

```tsx
interface Props {
  transcript: string
  agentText: string
  isSpeaking: boolean
}

export function TranscriptBar({ transcript, agentText, isSpeaking }: Props) {
  if (!transcript && !agentText) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900/90 backdrop-blur border-t border-gray-800 px-8 py-4">
      {agentText && (
        <p className="text-purple-300 text-sm mb-1 flex items-center gap-2">
          {isSpeaking && (
            <span className="flex gap-0.5">
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  className="w-1 h-3 bg-purple-400 rounded-full animate-bounce"
                  style={{ animationDelay: `${i * 0.1}s` }}
                />
              ))}
            </span>
          )}
          {agentText}
        </p>
      )}
      {transcript && (
        <p className="text-gray-400 text-sm italic">You: {transcript}</p>
      )}
    </div>
  )
}
```

## Update `src/App.tsx`

```tsx
import { useState, useEffect } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { SlideView } from './components/SlideView'
import { SlideNav } from './components/SlideNav'
import { TranscriptBar } from './components/TranscriptBar'

const TOTAL_SLIDES = 6

export default function App() {
  const { state, connect, disconnect } = useWebSocket()
  const [started, setStarted] = useState(false)

  const handleStart = () => {
    setStarted(true)
    connect()
  }

  if (!started) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center space-y-8">
          <h1 className="text-5xl font-bold text-white tracking-tight">
            AI in Clinical Trials
          </h1>
          <p className="text-gray-400 text-lg">
            A voice-interactive presentation
          </p>
          <button
            onClick={handleStart}
            className="px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white text-lg font-semibold rounded-2xl transition-colors"
          >
            Start Presentation
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <div className="flex-1 flex flex-col max-w-5xl mx-auto w-full">
        <SlideView slide={state.currentSlide} />
        <SlideNav total={TOTAL_SLIDES} current={state.slideIndex} />
      </div>
      <TranscriptBar
        transcript={state.transcript}
        agentText={state.agentText}
        isSpeaking={state.isTTSSpeaking}
      />
    </div>
  )
}
```

## Verification
1. `npm run dev` — app loads at http://localhost:5173
2. Backend must be running on port 8000
3. Click "Start Presentation" → WebSocket connects → first slide appears
4. Check browser console for no errors
5. Use wscat to send `{"type":"slide_change","index":1,"slide":{"title":"Test","bullets":["a","b"]}}` → UI updates
