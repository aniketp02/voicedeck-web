import { useMemo } from 'react'

import type { VoiceState } from '@/types/protocol'

import type { WebSocketState } from './useWebSocket'

interface VoiceStateInput {
  wsState: WebSocketState
  isCapturing: boolean
  isUserSpeaking: boolean
}

/**
 * Derives VoiceState from WebSocket + audio (VAD) inputs.
 * Priority: agent turn (text + TTS) → thinking (final transcript) → user speaking → listening → idle.
 */
export function useVoiceState({
  wsState,
  isCapturing,
  isUserSpeaking,
}: VoiceStateInput): VoiceState {
  return useMemo((): VoiceState => {
    if (wsState.isTTSActive || wsState.agentTurnActive) return 'ai-speaking'
    if (wsState.hasFinalTranscript) return 'thinking'
    if (isUserSpeaking && isCapturing) return 'user-speaking'
    if (isCapturing) return 'listening'
    return 'idle'
  }, [
    wsState.isTTSActive,
    wsState.agentTurnActive,
    wsState.hasFinalTranscript,
    isUserSpeaking,
    isCapturing,
  ])
}
