import { useCallback, useEffect, useRef, useState } from 'react'

import { Header } from '@/components/Header'
import { OrbPanel } from '@/components/OrbPanel'
import { PresentationSelector } from '@/components/PresentationSelector'
import { SlideNav } from '@/components/SlideNav'
import { SlideView } from '@/components/SlideView'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useAudioCapture } from '@/hooks/useAudioCapture'
import { useAudioPlayer } from '@/hooks/useAudioPlayer'
import { useVoiceState } from '@/hooks/useVoiceState'
import { useWebSocket } from '@/hooks/useWebSocket'
import type { PresentationMeta } from '@/types/protocol'

export default function App() {
  const [micDenied, setMicDenied] = useState(false)
  const [selectedPresentation, setSelectedPresentation] =
    useState<PresentationMeta | null>(null)
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

  const handleSelectPresentation = useCallback(
    (presentation: PresentationMeta) => {
      setSelectedPresentation(presentation)
      setStarted(true)
      connect(presentation.id)
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

  // Both registered decks currently use 6 slides; slide_count comes from the API for future decks.
  const totalSlides = selectedPresentation?.slide_count ?? 6

  if (!started) {
    return (
      <div className="relative">
        <div className="absolute right-4 top-4 z-10 sm:right-8 sm:top-6">
          <ThemeToggle />
        </div>
        <PresentationSelector onSelect={handleSelectPresentation} />
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
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-8 py-2 text-center text-sm text-amber-700 dark:text-amber-400">
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
        <div className="flex min-h-0 flex-col bg-background" style={{ width: '65%' }}>
          <SlideView slide={wsState.currentSlide} totalSlides={totalSlides} />
          <SlideNav total={totalSlides} current={wsState.slideIndex} />
        </div>
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

      <footer className="border-t border-border/50 bg-background/80 px-8 py-3 backdrop-blur dark:border-white/10">
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
