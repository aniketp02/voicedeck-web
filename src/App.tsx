import { useCallback, useEffect, useRef, useState } from 'react'

import { Header } from '@/components/Header'
import { OrbPanel } from '@/components/OrbPanel'
import { SlideNav } from '@/components/SlideNav'
import { SlideView } from '@/components/SlideView'
import { useAudioCapture } from '@/hooks/useAudioCapture'
import { useAudioPlayer } from '@/hooks/useAudioPlayer'
import { useVoiceState } from '@/hooks/useVoiceState'
import { useWebSocket } from '@/hooks/useWebSocket'

const TOTAL_SLIDES = 6

export default function App() {
  const [started, setStarted] = useState(false)
  const [micDenied, setMicDenied] = useState(false)

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

  const handlePresentationStart = useCallback(() => {
    setStarted(true)
    connect()
  }, [connect])

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

  if (!started) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background">
        <h1 className="text-center text-5xl font-bold leading-tight tracking-tight text-foreground">
          AI in Clinical Trials
        </h1>
        <p className="max-w-md text-center text-lg text-muted-foreground">
          A voice-interactive presentation. Ask questions, get answers — the slides follow
          the conversation.
        </p>
        <button
          type="button"
          onClick={handlePresentationStart}
          className="rounded-2xl bg-primary px-8 py-4 text-lg font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Start Presentation
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {wsState.error ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-8 py-2 text-center text-sm text-destructive">
          {wsState.error}
        </div>
      ) : null}
      {micDenied && !wsState.error ? (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-8 py-2 text-center text-sm text-amber-400">
          Microphone access denied. Please allow microphone permission and refresh.
        </div>
      ) : null}

      <Header
        connected={wsState.connected}
        slideIndex={wsState.slideIndex}
        totalSlides={TOTAL_SLIDES}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className="flex min-h-0 flex-col border-r border-border/50"
          style={{ width: '65%' }}
        >
          <SlideView slide={wsState.currentSlide} />
          <SlideNav total={TOTAL_SLIDES} current={wsState.slideIndex} />
        </div>
        <div className="min-h-0 overflow-y-auto" style={{ width: '35%' }}>
          <OrbPanel
            voiceState={voiceState}
            transcript={wsState.transcript}
            agentText={wsState.agentText}
            isCapturing={captureState.isCapturing}
            isTTSActive={wsState.isTTSActive}
            rmsLevel={captureState.rmsLevel}
            onMicStart={handleMicStart}
            onMicStop={handleMicStop}
          />
        </div>
      </div>

      <footer className="border-t border-border/50 bg-background/80 px-8 py-3 backdrop-blur">
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
