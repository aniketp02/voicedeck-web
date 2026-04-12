import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  float32ToInt16,
  getRMSLevel,
  int16ToBase64,
} from '@/lib/audioUtils'
import type { ClientMessage } from '@/types/protocol'

const SAMPLE_RATE = 16000
/** ScriptProcessorNode only allows powers of two 256–16384 (not e.g. 1600). 2048 ≈ 128ms @ 16kHz. */
const BUFFER_SIZE = 2048
/** Default VAD threshold — tuned for quiet ambient conditions. */
const VAD_THRESHOLD = 0.012
/**
 * Lower threshold used while TTS is active.
 * Speaker echo raises ambient RMS; lowering the threshold makes it easier
 * for the user's voice to cross it and trigger an interrupt.
 */
const VAD_THRESHOLD_DURING_TTS = 0.008
const VAD_RELEASE_FRAMES = 8

interface UseAudioCaptureOptions {
  onChunk: (msg: ClientMessage) => void
  onInterrupt: () => void
  isTTSActive: boolean
  agentTurnActive: boolean
}

export interface AudioCaptureState {
  isCapturing: boolean
  isUserSpeaking: boolean
  rmsLevel: number
}

export function useAudioCapture({
  onChunk,
  onInterrupt,
  isTTSActive,
  agentTurnActive,
}: UseAudioCaptureOptions): [
  AudioCaptureState,
  { start: () => Promise<void>; stop: () => void },
] {
  const [isCapturing, setIsCapturing] = useState(false)
  const [isUserSpeaking, setIsUserSpeaking] = useState(false)
  const [rmsLevel, setRmsLevel] = useState(0)

  const contextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const silenceFramesRef = useRef(0)
  const isTTSActiveRef = useRef(isTTSActive)
  const onChunkRef = useRef(onChunk)
  const onInterruptRef = useRef(onInterrupt)
  /** At most one interrupt per assistant turn; reset when turn ends. */
  const interruptSentRef = useRef(false)

  useEffect(() => {
    isTTSActiveRef.current = isTTSActive
    if (!isTTSActive && !agentTurnActive) {
      interruptSentRef.current = false
    }
  }, [isTTSActive, agentTurnActive])
  useEffect(() => {
    onChunkRef.current = onChunk
  }, [onChunk])
  useEffect(() => {
    onInterruptRef.current = onInterrupt
  }, [onInterrupt])

  const start = useCallback(async () => {
    if (isCapturing) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream

      const context = new AudioContext({ sampleRate: SAMPLE_RATE })
      contextRef.current = context

      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(BUFFER_SIZE, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (e) => {
        const float32 = e.inputBuffer.getChannelData(0)
        const rms = getRMSLevel(float32)

        setRmsLevel(rms)

        // Only arm VAD barge-in while assistant audio is actually streaming. If we also
        // keyed off agentTurnActive, ambient noise after agent_text (before the first
        // tts_chunk) sent interrupt → server skipped TTS (interrupt_event set) while the
        // slide still updated — common on "go to next slide and explain" with slower Deepgram.
        const vadInterruptArmed = isTTSActiveRef.current
        const threshold = vadInterruptArmed
          ? VAD_THRESHOLD_DURING_TTS
          : VAD_THRESHOLD

        const voiceActive = rms > threshold
        if (voiceActive) {
          silenceFramesRef.current = 0
          setIsUserSpeaking(true)

          if (vadInterruptArmed && !interruptSentRef.current) {
            interruptSentRef.current = true
            onInterruptRef.current()
          }
        } else {
          silenceFramesRef.current++
          if (silenceFramesRef.current >= VAD_RELEASE_FRAMES) {
            setIsUserSpeaking(false)
          }
        }

        const int16 = float32ToInt16(float32)
        const data = int16ToBase64(int16)
        onChunkRef.current({ type: 'audio_chunk', data })
      }

      const mute = context.createGain()
      mute.gain.value = 0
      source.connect(processor)
      processor.connect(mute)
      mute.connect(context.destination)

      setIsCapturing(true)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        console.error('Microphone permission denied')
        throw err
      }
      console.error('Failed to start audio capture:', err)
      if (err instanceof Error) throw err
      throw new Error(String(err))
    }
  }, [isCapturing])

  const stop = useCallback(() => {
    processorRef.current?.disconnect()
    contextRef.current?.close().catch(() => {})
    streamRef.current?.getTracks().forEach((t) => t.stop())
    processorRef.current = null
    contextRef.current = null
    streamRef.current = null
    setIsCapturing(false)
    setIsUserSpeaking(false)
    setRmsLevel(0)
    silenceFramesRef.current = 0
    interruptSentRef.current = false
  }, [])

  const controls = useMemo(() => ({ start, stop }), [start, stop])

  return [{ isCapturing, isUserSpeaking, rmsLevel }, controls]
}
