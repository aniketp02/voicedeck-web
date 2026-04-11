import { AnimatePresence, motion } from 'framer-motion'

import type { Slide } from '@/types/protocol'

interface Props {
  slide: Slide | null
}

const BULLET_STAGGER = 0.08 // seconds between each bullet

export function SlideView({ slide }: Props) {
  if (!slide) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-lg text-muted-foreground"
        >
          Connecting to presentation...
        </motion.p>
      </div>
    )
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={slide.index}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -16 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="flex flex-1 flex-col justify-center overflow-hidden px-12 py-10"
      >
        <motion.span
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.05 }}
          className="mb-4 font-mono text-xs uppercase tracking-widest text-muted-foreground"
        >
          {String(slide.index + 1).padStart(2, '0')} / 06
        </motion.span>

        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.35 }}
          className="mb-8 text-3xl font-bold leading-tight tracking-tight text-foreground"
        >
          {slide.title}
        </motion.h1>

        <ul className="space-y-3">
          {slide.bullets.map((bullet, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                delay: 0.2 + i * BULLET_STAGGER,
                duration: 0.3,
                ease: 'easeOut',
              }}
              className="flex items-start gap-3"
            >
              <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
              <span className="text-base leading-relaxed text-muted-foreground">
                {bullet}
              </span>
            </motion.li>
          ))}
        </ul>
      </motion.div>
    </AnimatePresence>
  )
}
