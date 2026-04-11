import { AnimatePresence, motion } from 'framer-motion'

import type { Slide } from '@/types/protocol'

interface Props {
  slide: Slide | null
  totalSlides?: number
}

const BULLET_STAGGER = 0.08

export function SlideView({ slide, totalSlides = 6 }: Props) {
  if (!slide) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden p-5">
        <div className="flex flex-1 items-center justify-center rounded-xl border border-border/60 bg-white shadow-sm">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-lg text-muted-foreground"
          >
            Connecting to presentation...
          </motion.p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-5">
      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-white shadow-[0_1px_16px_rgba(0,0,0,0.06)]">
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
              className="mb-4 font-mono text-xs uppercase tracking-widest text-muted-foreground/70"
            >
              {String(slide.index + 1).padStart(2, '0')} /{' '}
              {String(totalSlides).padStart(2, '0')}
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
      </div>
    </div>
  )
}
