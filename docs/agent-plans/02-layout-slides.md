# Frontend Agent Plan 02 — Layout Shell + SlideView + Animations

## Agent Instructions
Read this plan fully before acting. Do not ask questions. All decisions are made.
Plan 01 must be complete before starting (shadcn, ogl, framer-motion installed).

---

## Goal
Build the complete visual shell of the app:
- Side-by-side layout (65% slides / 35% orb panel)
- `SlideView` component with staggered bullet animations on slide change
- Slide dot navigation indicator
- Header bar with title, connection badge, slide counter
- Bottom transcript bar (static, wired to state in Plan 05)
- Orb panel structure (orb + status label placeholder)

**Success criterion:** The layout renders correctly with hardcoded slide data.
Switching the `currentSlide` prop animates the new slide in.

---

## Task 1: Create `src/types/protocol.ts`

```typescript
// All messages the server can send to the client
export type ServerMessage =
  | { type: 'transcript'; text: string; is_final: boolean }
  | { type: 'slide_change'; index: number; slide: SlideData }
  | { type: 'agent_text'; text: string }
  | { type: 'tts_chunk'; data: string }
  | { type: 'tts_done' }
  | { type: 'error'; message: string }
  | { type: 'pong' }

// All messages the client can send to the server
export type ClientMessage =
  | { type: 'start' }
  | { type: 'audio_chunk'; data: string }
  | { type: 'interrupt' }
  | { type: 'ping' }

export interface SlideData {
  title: string
  bullets: string[]
}

export interface Slide extends SlideData {
  index: number
}

// Voice state drives orb hue and status label
export type VoiceState =
  | 'idle'        // not started
  | 'listening'   // mic on, waiting for speech
  | 'user-speaking'   // VAD detected user voice
  | 'thinking'    // LLM processing (transcript received, no agent_text yet)
  | 'ai-speaking' // TTS streaming

export function voiceStateToHue(state: VoiceState): number {
  switch (state) {
    case 'user-speaking': return 120
    case 'ai-speaking':   return 260
    default:              return 0
  }
}

export function voiceStateToLabel(state: VoiceState): string {
  switch (state) {
    case 'idle':          return 'Click mic to start'
    case 'listening':     return 'Listening...'
    case 'user-speaking': return 'Hearing you...'
    case 'thinking':      return 'Thinking...'
    case 'ai-speaking':   return 'Speaking...'
  }
}
```

---

## Task 2: Create `src/components/SlideView.tsx`

Uses framer-motion `AnimatePresence` to animate between slides.
Bullets stagger in one by one after the title appears.

```tsx
import { AnimatePresence, motion } from 'framer-motion'
import type { Slide } from '../types/protocol'

interface Props {
  slide: Slide | null
}

const BULLET_STAGGER = 0.08  // seconds between each bullet

export function SlideView({ slide }: Props) {
  if (!slide) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-muted-foreground text-lg"
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
        className="flex-1 flex flex-col justify-center px-12 py-10 overflow-hidden"
      >
        {/* Slide number badge */}
        <motion.span
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.05 }}
          className="text-xs font-mono text-muted-foreground mb-4 tracking-widest uppercase"
        >
          {String(slide.index + 1).padStart(2, '0')} / 06
        </motion.span>

        {/* Title */}
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.35 }}
          className="text-3xl font-bold text-foreground mb-8 leading-tight tracking-tight"
        >
          {slide.title}
        </motion.h1>

        {/* Bullets */}
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
              <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
              <span className="text-base text-muted-foreground leading-relaxed">
                {bullet}
              </span>
            </motion.li>
          ))}
        </ul>
      </motion.div>
    </AnimatePresence>
  )
}
```

---

## Task 3: Create `src/components/SlideNav.tsx`

Dot indicators. Active slide = wide pill. Others = small circles.

```tsx
interface Props {
  total: number
  current: number
}

export function SlideNav({ total, current }: Props) {
  return (
    <div className="flex items-center justify-center gap-2 py-4">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`rounded-full transition-all duration-400 ${
            i === current
              ? 'w-6 h-2 bg-primary'
              : 'w-2 h-2 bg-muted-foreground/30'
          }`}
        />
      ))}
    </div>
  )
}
```

---

## Task 4: Create `src/components/OrbPanel.tsx`

Right panel — holds the orb and voice status label.

```tsx
import { VoicePoweredOrb } from './ui/voice-powered-orb'
import type { VoiceState } from '../types/protocol'
import { voiceStateToHue, voiceStateToLabel } from '../types/protocol'
import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  voiceState: VoiceState
  transcript: string     // live transcript (interim)
  agentText: string      // last agent text spoken
}

// hoverIntensity is lower when "thinking" to dim the orb
function orbHoverIntensity(state: VoiceState): number {
  if (state === 'thinking') return 0.2
  if (state === 'ai-speaking') return 0.9
  if (state === 'user-speaking') return 0.8
  return 0.5
}

export function OrbPanel({ voiceState, transcript, agentText }: Props) {
  const hue = voiceStateToHue(voiceState)
  const label = voiceStateToLabel(voiceState)
  const intensity = orbHoverIntensity(voiceState)

  return (
    <div className="flex flex-col items-center justify-center gap-6 h-full py-10 px-6">
      {/* OGL Orb */}
      <div className="w-[280px] h-[280px] flex-shrink-0">
        <VoicePoweredOrb
          hue={hue}
          enableVoiceControl={false}
          maxHoverIntensity={intensity}
          className="w-full h-full"
        />
      </div>

      {/* Voice state label */}
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

      {/* Live text: transcript (user) or agent text */}
      <div className="w-full min-h-[3rem] text-center px-2">
        <AnimatePresence mode="wait">
          {voiceState === 'user-speaking' && transcript && (
            <motion.p
              key="transcript"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-xs text-emerald-400/80 italic leading-relaxed"
            >
              "{transcript}"
            </motion.p>
          )}
          {voiceState === 'ai-speaking' && agentText && (
            <motion.p
              key="agent"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-xs text-indigo-300/80 italic leading-relaxed line-clamp-3"
            >
              "{agentText}"
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// Small colored dot indicating current voice state
function StatusDot({ state }: { state: VoiceState }) {
  const colors: Record<VoiceState, string> = {
    idle:           'bg-muted-foreground/40',
    listening:      'bg-primary animate-pulse',
    'user-speaking': 'bg-emerald-400',
    thinking:       'bg-amber-400 animate-pulse',
    'ai-speaking':  'bg-indigo-400',
  }
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${colors[state]}`} />
  )
}
```

---

## Task 5: Create `src/components/Header.tsx`

```tsx
import { Badge } from './ui/badge'

interface Props {
  connected: boolean
  slideIndex: number
  totalSlides: number
}

export function Header({ connected, slideIndex, totalSlides }: Props) {
  return (
    <header className="flex items-center justify-between px-8 py-4 border-b border-border/50">
      <h2 className="text-sm font-semibold text-foreground tracking-tight">
        AI in Clinical Trials
      </h2>
      <div className="flex items-center gap-3">
        <Badge
          variant={connected ? 'default' : 'secondary'}
          className={`text-xs ${connected ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : ''}`}
        >
          <span className={`mr-1.5 inline-block w-1.5 h-1.5 rounded-full ${
            connected ? 'bg-emerald-400' : 'bg-muted-foreground/50'
          }`} />
          {connected ? 'Connected' : 'Disconnected'}
        </Badge>
        <span className="text-xs text-muted-foreground font-mono">
          {String(slideIndex + 1).padStart(2, '0')}/{String(totalSlides).padStart(2, '0')}
        </span>
      </div>
    </header>
  )
}
```

---

## Task 6: Update `src/App.tsx` with the full layout shell

Wire all components together with hardcoded state so the layout can be verified
visually before hooks are added in Plans 03-04.

```tsx
import { useState } from 'react'
import { Header } from './components/Header'
import { SlideView } from './components/SlideView'
import { SlideNav } from './components/SlideNav'
import { OrbPanel } from './components/OrbPanel'
import type { Slide, VoiceState } from './types/protocol'

// Hardcoded first slide for layout verification
const DEMO_SLIDE: Slide = {
  index: 0,
  title: 'The Broken Machine: Clinical Trials Today',
  bullets: [
    'Average trial takes 10–15 years and costs $2.6 billion',
    '90% of drugs that enter trials never reach patients',
    'Only 3–5% of eligible patients actually enroll',
    'Largely paper-based, siloed, and manually intensive',
  ],
}

const TOTAL_SLIDES = 6

export default function App() {
  // These will come from hooks in Plans 03-05
  const [currentSlide] = useState<Slide | null>(DEMO_SLIDE)
  const [slideIndex] = useState(0)
  const [connected] = useState(false)
  const [voiceState] = useState<VoiceState>('idle')
  const [transcript] = useState('')
  const [agentText] = useState('')

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Header
        connected={connected}
        slideIndex={slideIndex}
        totalSlides={TOTAL_SLIDES}
      />

      {/* Main content: 65% slide / 35% orb */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: slide content */}
        <div className="flex flex-col border-r border-border/50" style={{ width: '65%' }}>
          <SlideView slide={currentSlide} />
          <SlideNav total={TOTAL_SLIDES} current={slideIndex} />
        </div>

        {/* Right: orb panel */}
        <div style={{ width: '35%' }}>
          <OrbPanel
            voiceState={voiceState}
            transcript={transcript}
            agentText={agentText}
          />
        </div>
      </div>
    </div>
  )
}
```

---

## Task 7: Verify layout

```bash
npm run dev
```

Open http://localhost:5173. Verify:
- [ ] Dark background with slide content on left
- [ ] Animated purple orb on right
- [ ] Header with "AI in Clinical Trials" title and disconnected badge
- [ ] 6 nav dots at the bottom of the slide panel
- [ ] Slide title and bullets render (bullets stagger in on load)
- [ ] No TypeScript errors: `npx tsc --noEmit`

## Acceptance Criteria

- [ ] `src/types/protocol.ts` exists with all types
- [ ] `src/components/SlideView.tsx` — AnimatePresence slide transitions
- [ ] `src/components/SlideNav.tsx` — 6 dot indicators
- [ ] `src/components/OrbPanel.tsx` — orb + status label + live text
- [ ] `src/components/Header.tsx` — title + connection badge + slide counter
- [ ] `src/App.tsx` — full layout shell with hardcoded state
- [ ] Layout renders in browser with no errors
- [ ] TypeScript compiles clean

## File Checklist After This Plan

```
src/
  types/
    protocol.ts           ← message types, VoiceState, hue/label helpers
  components/
    Header.tsx
    SlideView.tsx         ← AnimatePresence + stagger bullets
    SlideNav.tsx          ← dot indicators
    OrbPanel.tsx          ← orb + status
    ui/
      badge.tsx           (from Plan 01)
      voice-powered-orb.tsx (from Plan 01)
  App.tsx                 ← full layout with hardcoded state
```
