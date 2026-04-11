import { motion } from 'framer-motion'

interface Props {
  isCapturing: boolean
  isTTSActive: boolean
  rmsLevel: number
  onStart: () => void
  onStop: () => void
}

export function MicButton({
  isCapturing,
  isTTSActive,
  rmsLevel,
  onStart,
  onStop,
}: Props) {
  const scale = isCapturing ? 1 + rmsLevel * 2 : 1

  return (
    <div className="flex flex-col items-center gap-2">
      {isTTSActive ? (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-xs text-indigo-400/70"
        >
          Speak to interrupt
        </motion.p>
      ) : null}
      <motion.button
        type="button"
        onClick={isCapturing ? onStop : onStart}
        animate={{ scale }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        className={`flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-colors ${
          isCapturing
            ? 'bg-emerald-600 hover:bg-emerald-500'
            : 'bg-primary hover:bg-primary/90'
        }`}
        aria-label={isCapturing ? 'Stop microphone' : 'Start microphone'}
      >
        <MicIcon active={isCapturing} />
      </motion.button>
      <span className="text-xs text-muted-foreground">
        {isCapturing ? 'Tap to stop' : 'Tap to speak'}
      </span>
    </div>
  )
}

function MicIcon({ active }: { active: boolean }) {
  if (active) {
    return (
      <svg className="h-5 w-5 text-white" fill="currentColor" viewBox="0 0 24 24">
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </svg>
    )
  }
  return (
    <svg className="h-5 w-5 text-white" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2zm-7 8a1 1 0 0 1 1 1 6 6 0 0 0 12 0 1 1 0 0 1 2 0 8 8 0 0 1-7 7.93V21h2a1 1 0 0 1 0 2H9a1 1 0 0 1 0-2h2v-2.07A8 8 0 0 1 4 12a1 1 0 0 1 1-1z" />
    </svg>
  )
}
