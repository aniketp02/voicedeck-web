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
}: Props) {
  const hue = voiceStateToHue(voiceState)
  const label = voiceStateToLabel(voiceState)
  const intensity = orbHoverIntensity(voiceState)

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 py-10">
      <div className="h-[280px] w-[280px] flex-shrink-0">
        <VoicePoweredOrb
          hue={hue}
          hoverIntensity={intensity}
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
          className="flex flex-col items-center gap-1 text-center"
        >
          <StatusDot state={voiceState} />
          <span className="text-sm font-medium text-foreground">{label}</span>
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

      <MicButton
        isCapturing={isCapturing}
        isTTSActive={isTTSActive}
        rmsLevel={rmsLevel}
        onStart={onMicStart}
        onStop={onMicStop}
      />
    </div>
  )
}

function StatusDot({ state }: { state: VoiceState }) {
  const colors: Record<VoiceState, string> = {
    idle: 'bg-muted-foreground/40',
    listening: 'bg-primary animate-pulse',
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
