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
  | { type: 'start' }
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

// Voice state drives orb hue and status label
export type VoiceState =
  | 'idle' // not started
  | 'listening' // mic on, waiting for speech
  | 'user-speaking' // VAD detected user voice
  | 'thinking' // LLM processing (transcript received, no agent_text yet)
  | 'ai-speaking' // TTS streaming

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
