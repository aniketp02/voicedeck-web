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
import type { PresentationMeta, VoiceState } from '@/types/protocol'

interface ConversationTurn {
  role: 'user' | 'assistant'
  text: string
}

export default function App() {
  const [micDenied, setMicDenied] = useState(false)
  const [selectedPresentation, setSelectedPresentation] =
    useState<PresentationMeta | null>(null)
  const [started, setStarted] = useState(false)
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([])

  const [
    wsState,
    {
      connect,
      disconnect,
      send,
      navigate,
      onTTSChunk: onTTSChunkRef,
      onTTSDone: onTTSDoneRef,
      endAssistantPlayback,
      clearAgentDisplay,
      startAutoNarrate,
      stopAutoNarrate,
    },
  ] = useWebSocket()
  // When the audio element fires 'ended', update local state AND tell the server
  // so auto_narrate_loop knows it's safe to advance to the next slide.
  const handlePlaybackEnd = useCallback(() => {
    endAssistantPlayback()
    send({ type: 'tts_playback_done' })
  }, [endAssistantPlayback, send])

  const audioPlayer = useAudioPlayer(handlePlaybackEnd)

  const handleInterrupt = useCallback(() => {
    send({ type: 'interrupt' })
    clearAgentDisplay()
    audioPlayer.stop()
  }, [send, clearAgentDisplay, audioPlayer])

  const [captureState, captureControls] = useAudioCapture({
    onChunk: send,
    onInterrupt: handleInterrupt,
    isTTSActive: wsState.isTTSActive,
    agentTurnActive: wsState.agentTurnActive,
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

  const lastRecordedTranscriptRef = useRef('')

  useEffect(() => {
    if (
      wsState.hasFinalTranscript &&
      wsState.transcript.trim() &&
      wsState.transcript !== lastRecordedTranscriptRef.current
    ) {
      lastRecordedTranscriptRef.current = wsState.transcript
      setConversationHistory((prev) => [...prev, { role: 'user', text: wsState.transcript }])
    }
  }, [wsState.hasFinalTranscript, wsState.transcript])

  useEffect(() => {
    if (!wsState.agentText.trim()) return
    setConversationHistory((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === 'assistant') {
        return [...prev.slice(0, -1), { role: 'assistant', text: wsState.agentText }]
      }
      return [...prev, { role: 'assistant', text: wsState.agentText }]
    })
  }, [wsState.agentText])

  const handleSelectPresentation = useCallback(
    (presentation: PresentationMeta) => {
      setSelectedPresentation(presentation)
      setStarted(true)
      connect(presentation.id)
    },
    [connect],
  )

  const handleReset = useCallback(() => {
    captureControls.stop()
    audioPlayer.stop()
    disconnect()
    setConversationHistory([])
    lastRecordedTranscriptRef.current = ''

    const pid = selectedPresentation?.id ?? 'clinical-trials'
    setTimeout(() => {
      connect(pid)
    }, 150)
  }, [captureControls, audioPlayer, disconnect, connect, selectedPresentation])

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

  const totalSlides = selectedPresentation?.slide_count ?? 6

  useEffect(() => {
    if (!started) return
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (voiceState === 'ai-speaking' || voiceState === 'thinking') return
      if (!wsState.connected) return

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        const next = wsState.slideIndex + 1
        if (next < totalSlides) navigate(next)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        const prev = wsState.slideIndex - 1
        if (prev >= 0) navigate(prev)
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [started, wsState.connected, wsState.slideIndex, voiceState, totalSlides, navigate])

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
        onReset={handleReset}
        isAutoNarrating={wsState.isAutoNarrating}
        onStartAutoNarrate={startAutoNarrate}
        onStopAutoNarrate={stopAutoNarrate}
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

      <ConversationFooter
        history={conversationHistory}
        voiceState={voiceState}
        currentTranscript={wsState.transcript}
        currentAgentText={wsState.agentText}
      />
    </div>
  )
}

interface ConversationFooterProps {
  history: ConversationTurn[]
  voiceState: VoiceState
  currentTranscript: string
  currentAgentText: string
}

function ConversationFooter({
  history,
  voiceState,
  currentTranscript,
  currentAgentText,
}: ConversationFooterProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [history, currentTranscript, currentAgentText])

  const isEmpty = history.length === 0 && !currentTranscript && !currentAgentText

  return (
    <footer className="border-t border-border/50 bg-background/80 backdrop-blur dark:border-white/10">
      <div
        ref={scrollRef}
        className="mx-auto max-h-36 max-w-5xl overflow-y-auto px-6 py-3 sm:px-8"
      >
        {isEmpty ? (
          <p className="py-2 text-center text-xs text-muted-foreground/50">
            Conversation will appear here — tap the mic to start
          </p>
        ) : (
          <div className="space-y-2">
            {history.map((turn, i) => (
              <TurnRow key={i} role={turn.role} text={turn.text} dim />
            ))}

            {(voiceState === 'user-speaking' || voiceState === 'listening') &&
            currentTranscript.trim() ? (
              <TurnRow role="user" text={currentTranscript} live />
            ) : null}

            {(voiceState === 'thinking' || voiceState === 'ai-speaking') &&
            currentAgentText.trim() ? (
              <TurnRow role="assistant" text={currentAgentText} live />
            ) : null}
          </div>
        )}
      </div>
    </footer>
  )
}

interface TurnRowProps {
  role: 'user' | 'assistant'
  text: string
  dim?: boolean
  live?: boolean
}

function TurnRow({ role, text, dim, live }: TurnRowProps) {
  const isUser = role === 'user'
  return (
    <div className={`flex items-start gap-2 text-sm ${dim ? 'opacity-60' : ''}`}>
      <span
        className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide ${
          isUser
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
            : 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-400'
        }`}
      >
        {isUser ? 'You' : 'AI'}
      </span>
      <p className={`min-w-0 leading-relaxed text-muted-foreground ${live ? 'italic' : ''}`}>
        {text}
        {live ? (
          <span className="ml-1 inline-block h-2 w-0.5 animate-pulse bg-current opacity-70" />
        ) : null}
      </p>
    </div>
  )
}
