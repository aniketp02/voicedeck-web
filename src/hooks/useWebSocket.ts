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
  connect: (presentationId?: string) => void
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
