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
  /** True from agent_text until local TTS playback ends (not server tts_done). */
  agentTurnActive: boolean
  /** True while the server is running auto-narration mode. */
  isAutoNarrating: boolean
  error: string | null
}

export interface WebSocketControls {
  connect: (presentationId?: string) => void
  disconnect: () => void
  send: (msg: ClientMessage) => void
  navigate: (index: number) => void
  onTTSChunk: MutableRefObject<((data: string) => void) | null>
  onTTSDone: MutableRefObject<(() => void) | null>
  /** Call when local TTS playback actually ends (not when the server sends tts_done). */
  endAssistantPlayback: () => void
  /** Clear in-progress assistant text (e.g. user interrupt) so the UI does not show stale copy. */
  clearAgentDisplay: () => void
  startAutoNarrate: () => void
  stopAutoNarrate: () => void
}

const INITIAL_STATE: WebSocketState = {
  connected: false,
  currentSlide: null,
  slideIndex: 0,
  transcript: '',
  agentText: '',
  hasFinalTranscript: false,
  isTTSActive: false,
  agentTurnActive: false,
  isAutoNarrating: false,
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

  const endAssistantPlayback = useCallback(() => {
    setState((s) => ({
      ...s,
      isTTSActive: false,
      agentTurnActive: false,
      // Deepgram transcript persists until the next STT message; clear it when playback
      // ends so the footer does not show the last user line as a live placeholder.
      transcript: '',
      hasFinalTranscript: false,
    }))
  }, [])

  const clearAgentDisplay = useCallback(() => {
    setState((s) => ({ ...s, agentText: '' }))
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
          // Do not clear agentTurnActive here. The agent may send slide_change before
          // agent_text/tts; clearing it caused a flash to "listening" before audio.
          // endAssistantPlayback clears it when local TTS actually ends.
        }))
        break

      case 'transcript': {
        const hasFinalTranscript =
          (msg.speech_final ?? msg.is_final) && msg.text.trim().length > 0
        // New user utterance (Deepgram utterance end): drop previous assistant text so
        // "thinking" does not still show the last reply in the chat footer.
        const newUtterance = Boolean(msg.speech_final && msg.text.trim())
        setState((s) => ({
          ...s,
          transcript: msg.text,
          hasFinalTranscript,
          ...(newUtterance ? { agentText: '' } : {}),
        }))
        break
      }

      case 'agent_text':
        setState((s) => ({
          ...s,
          agentText: msg.text,
          hasFinalTranscript: false,
          agentTurnActive: true,
          // User turn is already in conversation history; drop STT text so it does not
          // linger through thinking / ai-speaking / listening.
          transcript: '',
        }))
        break

      case 'tts_chunk':
        setState((s) => ({
          ...s,
          isTTSActive: true,
          hasFinalTranscript: false,
          agentTurnActive: true,
        }))
        onTTSChunk.current?.(msg.data)
        break

      case 'tts_done':
        // Server finished sending chunks; playback may continue for seconds.
        // Clear isTTSActive / agentTurnActive in endAssistantPlayback when audio ends.
        onTTSDone.current?.()
        break

      case 'auto_narrate_complete':
        setState((s) => ({
          ...s,
          isAutoNarrating: false,
          agentText: s.agentText || 'Presentation complete.',
        }))
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
          agentTurnActive: false,
          isAutoNarrating: false,
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

  const navigate = useCallback(
    (index: number) => {
      send({ type: 'navigate', index })
    },
    [send],
  )

  const startAutoNarrate = useCallback(() => {
    setState((s) => ({ ...s, isAutoNarrating: true }))
    send({ type: 'start_auto_narrate' })
  }, [send])

  const stopAutoNarrate = useCallback(() => {
    setState((s) => ({ ...s, isAutoNarrating: false }))
    send({ type: 'stop_auto_narrate' })
  }, [send])

  useEffect(() => {
    return () => {
      ws.current?.close()
    }
  }, [])

  const controls: WebSocketControls = {
    connect,
    disconnect,
    send,
    navigate,
    onTTSChunk,
    onTTSDone,
    endAssistantPlayback,
    clearAgentDisplay,
    startAutoNarrate,
    stopAutoNarrate,
  }
  return [state, controls]
}
