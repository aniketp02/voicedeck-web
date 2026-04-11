import { AnimatePresence, motion } from 'framer-motion'

import { MicButton } from '@/components/MicButton'
import { VoicePoweredOrb } from '@/components/ui/voice-powered-orb'
import {
  type VoiceState,
  voiceStateToHue,
  voiceStateToLabel,
} from '@/types/protocol'

interface Props {
  voiceState: VoiceState
  transcript: string
  agentText: string
  isCapturing: boolean
  isTTSActive: boolean
  rmsLevel: number
  onMicStart: () => void
  onMicStop: () => void
  onInterrupt: () => void
}

function orbHoverIntensity(state: VoiceState): number {
  if (state === 'thinking') return 0.2
  if (state === 'ai-speaking') return 0.9
  if (state === 'user-speaking') return 0.8
  return 0.5
}

export function OrbPanel({
  voiceState,
  transcript,
  agentText,
  isCapturing,
  isTTSActive,
  rmsLevel,
  onMicStart,
  onMicStop,
  onInterrupt,
}: Props) {
  const hue = voiceStateToHue(voiceState)
  const label = voiceStateToLabel(voiceState)
  const intensity = orbHoverIntensity(voiceState)

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-slate-950 px-6 py-8">
      <div className="h-[260px] w-[260px] flex-shrink-0">
        <VoicePoweredOrb
          hue={hue}
          hoverIntensity={intensity}
          audioLevel={rmsLevel}
          enableVoiceControl={false}
          className="h-full w-full"
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={voiceState}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col items-center gap-1.5 text-center"
        >
          <StatusDot state={voiceState} />
          <span className="text-sm font-medium text-slate-100">{label}</span>
        </motion.div>
      </AnimatePresence>

      <div className="min-h-[3rem] w-full px-2 text-center">
        <AnimatePresence mode="wait">
          {voiceState === 'user-speaking' && transcript ? (
            <motion.p
              key="transcript"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-xs italic leading-relaxed text-emerald-400/80"
            >
              &ldquo;{transcript}&rdquo;
            </motion.p>
          ) : null}
          {voiceState === 'ai-speaking' && agentText ? (
            <motion.p
              key="agent"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="line-clamp-3 text-xs italic leading-relaxed text-indigo-300/80"
            >
              &ldquo;{agentText}&rdquo;
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {voiceState === 'ai-speaking' ? (
          <motion.button
            key="interrupt-btn"
            type="button"
            onClick={onInterrupt}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            whileTap={{ scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/15 px-5 py-2.5 text-sm font-medium text-indigo-200 transition-colors hover:bg-indigo-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
            Tap to interrupt
          </motion.button>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {voiceState !== 'ai-speaking' ? (
          <motion.div
            key="mic"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <MicButton
              isCapturing={isCapturing}
              isTTSActive={isTTSActive}
              rmsLevel={rmsLevel}
              onStart={onMicStart}
              onStop={onMicStop}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function StatusDot({ state }: { state: VoiceState }) {
  const colors: Record<VoiceState, string> = {
    idle: 'bg-slate-500',
    listening: 'bg-violet-400 animate-pulse',
    'user-speaking': 'bg-emerald-400',
    thinking: 'bg-amber-400 animate-pulse',
    'ai-speaking': 'bg-indigo-400',
  }
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${colors[state]}`}
      aria-hidden
    />
  )
}
