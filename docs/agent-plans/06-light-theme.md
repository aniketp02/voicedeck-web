# Frontend Agent Plan 06 — Light Theme + Visual Polish

## Agent Instructions
Read this plan fully before acting. Do not ask questions. All decisions are made.
Plans 01–05 must be complete before starting.

**Parallel execution:** This plan runs immediately. Plan 07 depends on this plan completing first.
Plan 08 (backend) runs in parallel with this plan — no conflict.

---

## Goal
Replace the dark slate theme with a polished light theme.
The right orb panel stays intentionally dark (slate-950) — this is a design decision, not a mistake.
The split creates visual contrast: clean white slide presentation on the left, dark AI voice interface on the right.

**Files changed in this plan:**
- `src/main.tsx` — remove dark class
- `src/index.css` — new light color palette + hero gradient
- `src/components/Header.tsx` — badge colors legible on light background
- `src/components/SlideView.tsx` — slide card framing

**Files NOT touched in this plan (handled in Plan 07):**
- `src/components/OrbPanel.tsx`
- `src/components/MicButton.tsx`
- `src/App.tsx`

---

## Task 1: Update `src/main.tsx`

Remove the `document.documentElement.classList.add('dark')` line.
The html element will no longer carry the `.dark` class — CSS variables fall back to the `:root` light theme values.

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

---

## Task 2: Replace `src/index.css` with light theme

Complete replacement. Key decisions:
- Background: warm near-white (not stark white)
- Primary: indigo-500 — matches `hue=260` used during `ai-speaking` state, professional
- No `.dark` block — this is a light-only app
- `.hero-bg` class: radial gradient mesh for the start screen
- `.slide-panel` class: subtle shadow card for slide content area

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-popover: hsl(var(--popover));
  --color-popover-foreground: hsl(var(--popover-foreground));
  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));
  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));
  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));
  --color-border: hsl(var(--border));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));
  --radius: var(--radius);
}

:root {
  --radius: 0.625rem;

  /* Surface */
  --background: 220 20% 97%;          /* warm near-white */
  --foreground: 224 71% 8%;           /* deep navy — not pure black */

  /* Cards / popovers */
  --card: 0 0% 100%;
  --card-foreground: 224 71% 8%;
  --popover: 0 0% 100%;
  --popover-foreground: 224 71% 8%;

  /* Primary — indigo-500 (matches ai-speaking hue) */
  --primary: 243 75% 59%;
  --primary-foreground: 0 0% 100%;

  /* Secondary */
  --secondary: 220 14% 94%;
  --secondary-foreground: 224 71% 8%;

  /* Muted */
  --muted: 220 14% 94%;
  --muted-foreground: 220 9% 46%;

  /* Accent */
  --accent: 220 14% 94%;
  --accent-foreground: 224 71% 8%;

  /* Destructive */
  --destructive: 0 72% 51%;
  --destructive-foreground: 0 0% 100%;

  /* Borders + inputs */
  --border: 220 13% 87%;
  --input: 220 13% 87%;
  --ring: 243 75% 59%;
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}

/* Hero start screen — radial gradient mesh */
.hero-bg {
  background:
    radial-gradient(ellipse at 20% 45%, hsl(243 75% 96%) 0%, transparent 55%),
    radial-gradient(ellipse at 78% 30%, hsl(199 89% 93%) 0%, transparent 55%),
    radial-gradient(ellipse at 55% 80%, hsl(280 60% 96%) 0%, transparent 45%),
    hsl(220 20% 97%);
}
```

---

## Task 3: Replace `src/components/Header.tsx`

The connected badge used `text-emerald-400` which is too light on a white background (fails contrast).
Change to `text-emerald-700 bg-emerald-50 border-emerald-200` for the light theme.

The header title should reflect dynamic content — it will receive the presentation title as a prop
in Plan 09. For now, keep it hardcoded but update the badge colors.

```tsx
import { Badge } from '@/components/ui/badge'

interface Props {
  connected: boolean
  slideIndex: number
  totalSlides: number
  title?: string
}

export function Header({ connected, slideIndex, totalSlides, title = 'AI in Clinical Trials' }: Props) {
  return (
    <header className="flex items-center justify-between border-b border-border px-8 py-3.5 bg-white/80 backdrop-blur-sm">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <div className="flex items-center gap-3">
        <Badge
          variant={connected ? 'outline' : 'secondary'}
          className={`text-xs font-medium ${
            connected
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'text-muted-foreground'
          }`}
        >
          <span
            className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
              connected ? 'bg-emerald-500' : 'bg-muted-foreground/40'
            }`}
          />
          {connected ? 'Connected' : 'Disconnected'}
        </Badge>
        <span className="font-mono text-xs text-muted-foreground">
          {String(slideIndex + 1).padStart(2, '0')}/
          {String(totalSlides).padStart(2, '0')}
        </span>
      </div>
    </header>
  )
}
```

Note: `title` prop is optional and defaults to `'AI in Clinical Trials'`. Plan 09 will pass the
actual presentation title once catalog is implemented. The `title?: string` prop addition is
backwards-compatible — App.tsx does not need to change for this.

---

## Task 4: Replace `src/components/SlideView.tsx`

Add a card wrapper so the slide content looks like an actual presentation slide rather than
floating text. The card is white with subtle shadow — this differentiates the content area
visually on the light background.

Also: the `/ 06` in the slide number badge is hardcoded. Replace it with `totalSlides` prop
so it works with any presentation length (forwards compatibility for Plan 09 catalog).

```tsx
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
      {/* Slide card */}
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
              {String(slide.index + 1).padStart(2, '0')} / {String(totalSlides).padStart(2, '0')}
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
```

---

## Task 5: TypeScript verification

```bash
cd frontend
npx tsc --noEmit
```

Expected: no errors.

**If you see errors on `variant="outline"` for Badge:** The shadcn Badge may not have an `outline`
variant installed. Check `src/components/ui/badge.tsx` for available variants.
If `outline` is not available, use `variant="secondary"` for the connected badge and keep the
className override for the green colors.

---

## Task 6: Visual spot-check

Run `npm run dev` and verify:
- [ ] Start screen: white/light background with soft indigo+blue gradient glow (not flat white)
- [ ] "Start Presentation" button is indigo (not dark slate)
- [ ] After clicking Start: header appears with white background, thin bottom border
- [ ] Connected badge: green text on light green pill (readable)
- [ ] Slide area: white card with subtle shadow, floating on the light grey background
- [ ] Slide title is dark navy, bullets are medium grey — both readable
- [ ] No TypeScript errors: `npx tsc --noEmit`

---

## Acceptance Criteria

- [ ] `src/main.tsx` — no `classList.add('dark')`
- [ ] `src/index.css` — indigo primary, warm off-white background, hero-bg gradient class
- [ ] `src/components/Header.tsx` — connected badge readable on white (emerald-700 text)
- [ ] `src/components/SlideView.tsx` — card wrapper with shadow + totalSlides prop
- [ ] Light theme renders correctly in browser
- [ ] TypeScript compiles clean

## File Checklist After This Plan

```
src/
  main.tsx                  ← dark class removed
  index.css                 ← new light palette + hero-bg gradient
  components/
    Header.tsx              ← badge colors updated for light theme + title prop
    SlideView.tsx           ← card framing + totalSlides prop
```
