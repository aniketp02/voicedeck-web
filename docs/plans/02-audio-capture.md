# Frontend Plan 02 — Mic Capture → PCM → Backend

## Goal
Capture microphone audio, convert it to 16-bit PCM at 16kHz mono, and
stream base64-encoded chunks to the backend via WebSocket.

**Success criterion:** Backend logs show `Final transcript: "..."` when you speak.

## Prerequisite
Plan 01 complete (WebSocket connected, slides rendering).

## Audio Format Contract
Backend Deepgram config expects:
- Encoding: `linear16` (signed 16-bit PCM)
- Sample rate: `16000` Hz
- Channels: `1` (mono)
- Chunks: every ~100ms (1600 samples)

## Utility: `src/lib/audioUtils.ts`

```typescript
/**
 * Convert Float32Array (Web Audio API format) to Int16Array (PCM linear16).
 * Clamps values to [-1, 1] before scaling.
 */
export function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]))
    int16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767
  }
  return int16
}

/**
 * Encode Int16Array as base64 string.
 */
export function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Calculate RMS level (0-1) of a Float32Array for VAD.
 */
export function getRMSLevel(float32: Float32Array): number {
  let sum = 0
  for (let i = 0; i < float32.length; i++) {
    sum += float32[i] * float32[i]
  }
  return Math.sqrt(sum / float32.length)
}
```

## Hook: `src/hooks/useAudioCapture.ts`

```typescript
import { useCallback, useRef, useState } from 'react'
import { float32ToInt16, int16ToBase64, getRMSLevel } from '../lib/audioUtils'

const SAMPLE_RATE = 16000
const CHUNK_SIZE = 1600    // 100ms at 16kHz
const VAD_THRESHOLD = 0.01  // RMS level to consider as voice

interface UseAudioCaptureOptions {
  onAudioChunk: (base64: string) => void
  onVoiceStart?: () => void
  onVoiceEnd?: () => void
}

export function useAudioCapture({
  onAudioChunk,
  onVoiceStart,
  onVoiceEnd,
}: UseAudioCaptureOptions) {
  const [isCapturing, setIsCapturing] = useState(false)
  const [rmsLevel, setRmsLevel] = useState(0)

  const contextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const wasVoiceActiveRef = useRef(false)
  const bufferRef = useRef<Float32Array[]>([])
  const bufferSamplesRef = useRef(0)

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream

      // AudioContext at 16kHz
      const context = new AudioContext({ sampleRate: SAMPLE_RATE })
      contextRef.current = context

      const source = context.createMediaStreamSource(stream)

      // ScriptProcessorNode for raw access (deprecated but widely supported)
      // For production: use AudioWorklet (more complex but lower latency)
      const processor = context.createScriptProcessor(CHUNK_SIZE, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (e) => {
        const float32 = e.inputBuffer.getChannelData(0)
        const rms = getRMSLevel(float32)
        setRmsLevel(rms)

        // VAD
        const isVoice = rms > VAD_THRESHOLD
        if (isVoice && !wasVoiceActiveRef.current) {
          wasVoiceActiveRef.current = true
          onVoiceStart?.()
        } else if (!isVoice && wasVoiceActiveRef.current) {
          wasVoiceActiveRef.current = false
          onVoiceEnd?.()
        }

        // Send chunk to backend (always — Deepgram handles VAD server-side)
        const int16 = float32ToInt16(float32)
        const base64 = int16ToBase64(int16)
        onAudioChunk(base64)
      }

      source.connect(processor)
      processor.connect(context.destination)  // connect to output (required)

      setIsCapturing(true)
    } catch (err) {
      console.error('Mic access denied:', err)
    }
  }, [onAudioChunk, onVoiceStart, onVoiceEnd])

  const stop = useCallback(() => {
    processorRef.current?.disconnect()
    contextRef.current?.close()
    streamRef.current?.getTracks().forEach(t => t.stop())
    processorRef.current = null
    contextRef.current = null
    streamRef.current = null
    setIsCapturing(false)
    setRmsLevel(0)
  }, [])

  return { isCapturing, rmsLevel, start, stop }
}
```

## Component: `src/components/VoiceButton.tsx`

```tsx
import { useEffect, useRef } from 'react'

interface Props {
  isCapturing: boolean
  rmsLevel: number  // 0-1
  isTTSSpeaking: boolean
  onStart: () => void
  onStop: () => void
}

export function VoiceButton({ isCapturing, rmsLevel, isTTSSpeaking, onStart, onStop }: Props) {
  const scale = 1 + rmsLevel * 3  // visual feedback

  return (
    <div className="fixed bottom-24 right-8 flex flex-col items-center gap-2">
      {isTTSSpeaking && (
        <span className="text-xs text-purple-400 font-medium">AI speaking</span>
      )}
      <button
        onClick={isCapturing ? onStop : onStart}
        className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-100 shadow-lg ${
          isCapturing
            ? 'bg-red-500 hover:bg-red-400'
            : 'bg-purple-600 hover:bg-purple-500'
        }`}
        style={{ transform: isCapturing ? `scale(${scale})` : 'scale(1)' }}
        title={isCapturing ? 'Stop listening' : 'Start listening'}
      >
        <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
          {isCapturing ? (
            <rect x="6" y="6" width="12" height="12" rx="2" />
          ) : (
            <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2zm-7 8a1 1 0 0 1 1 1 6 6 0 0 0 12 0 1 1 0 0 1 2 0 8 8 0 0 1-7 7.93V21h2a1 1 0 0 1 0 2H9a1 1 0 0 1 0-2h2v-2.07A8 8 0 0 1 4 12a1 1 0 0 1 1-1z" />
          )}
        </svg>
      </button>
    </div>
  )
}
```

## Update `src/App.tsx`

Add audio capture to the App. Import `useAudioCapture` and `VoiceButton`:

```tsx
// Add to imports
import { useAudioCapture } from './hooks/useAudioCapture'
import { VoiceButton } from './components/VoiceButton'

// Inside App, after useWebSocket():
const { isCapturing, rmsLevel, start: startCapture, stop: stopCapture } = useAudioCapture({
  onAudioChunk: (base64) => send({ type: 'audio_chunk', data: base64 }),
})

// Add VoiceButton to the JSX (inside the started screen):
<VoiceButton
  isCapturing={isCapturing}
  rmsLevel={rmsLevel}
  isTTSSpeaking={state.isTTSSpeaking}
  onStart={startCapture}
  onStop={stopCapture}
/>
```

## Verification
1. Click Start → Connect
2. Click the mic button → browser asks for mic permission → grant it
3. Speak → check backend logs for `Final transcript: "your words"`
4. Mic button should pulse with voice activity (scale animation)
5. Click stop → mic stops

## Browser Compatibility Note
`ScriptProcessorNode` is deprecated but works everywhere.
For production quality, replace with `AudioWorkletNode` (see note in Plan 04).
