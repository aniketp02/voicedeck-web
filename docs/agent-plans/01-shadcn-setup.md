# Frontend Agent Plan 01 — shadcn Setup + Dependencies + VoicePoweredOrb

## Agent Instructions
Read this plan fully before acting. Do not ask questions. All decisions are made.
Run every verification command. Fix failures before moving to the next task.

---

## Goal
Set up shadcn/ui (dark theme), install `ogl` and `framer-motion`, create the
`lib/utils.ts` utility, and copy the `VoicePoweredOrb` component into the project.

**Success criterion:** `npm run dev` starts, `http://localhost:5173` loads with
no console errors, and the VoicePoweredOrb renders when dropped into App.tsx.

---

## Task 1: Install dependencies

```bash
cd frontend
npm install framer-motion ogl
npm install -D @types/node
```

Verify:
```bash
node -e "require('./node_modules/framer-motion/package.json'); console.log('framer-motion OK')"
node -e "require('./node_modules/ogl/package.json'); console.log('ogl OK')"
```

---

## Task 2: Configure path alias in `tsconfig.app.json`

Read `tsconfig.app.json`. Add `paths` to the `compilerOptions`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

Add the same alias to `vite.config.ts`:

```typescript
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8000', ws: true },
      '/api': { target: 'http://localhost:8000', rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
})
```

---

## Task 3: Initialize shadcn

```bash
cd frontend
npx shadcn@latest init --defaults
```

When prompted (if interactive):
- Style: **Default**
- Base color: **Slate**
- CSS variables: **Yes**

This creates:
- `src/lib/utils.ts` — with `cn()` helper
- `src/components/ui/` — empty dir for shadcn components
- Updates `src/index.css` with shadcn CSS variables

If `src/index.css` is overwritten and the `@import "tailwindcss"` line is removed,
add it back at the very top of `index.css`:
```css
@import "tailwindcss";
/* shadcn variables follow */
```

**Verify:**
```bash
cat src/lib/utils.ts
# Must contain: export function cn(...
```

---

## Task 4: Install shadcn Badge component (used for slide number + status)

```bash
npx shadcn@latest add badge
```

---

## Task 5: Force dark mode globally

In `src/index.css`, ensure the `:root` or `html` selector sets the dark theme.
shadcn dark mode uses the `.dark` class on `<html>`. The simplest approach for
a dark-only app: add the class in `src/main.tsx`:

Read `src/main.tsx`. Add `document.documentElement.classList.add('dark')` before
the `createRoot` call:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

document.documentElement.classList.add('dark')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

---

## Task 6: Copy VoicePoweredOrb component

Create `src/components/ui/voice-powered-orb.tsx`.

The full source is at `/home/poklinho/projects/sythio-labs/ui-guide.md`.
Read that file completely and extract the `VoicePoweredOrb` component
(everything from `"use client";` through the closing `};` of the component).

**Important modifications when copying:**

1. Remove `"use client";` at the top — not needed in Vite/React
2. The import `import { cn } from "@/lib/utils"` must stay as-is (path alias set up in Task 2)
3. The OGL import must be: `import { Renderer, Program, Mesh, Triangle, Vec3 } from "ogl"`
4. Keep all props and GLSL shaders exactly as-is

**After copying, verify the file compiles:**
```bash
npx tsc --noEmit 2>&1 | head -20
```

If you see `Cannot find module 'ogl'` → `npm install ogl` (already done in Task 1)
If you see `Cannot find module '@/lib/utils'` → verify Task 2 and 3 are complete

---

## Task 7: Verify with a smoke test in App.tsx

Temporarily update `src/App.tsx` to render the orb:

```tsx
import { VoicePoweredOrb } from './components/ui/voice-powered-orb'

export default function App() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-[300px] h-[300px]">
        <VoicePoweredOrb hue={0} enableVoiceControl={false} />
      </div>
    </div>
  )
}
```

Run `npm run dev` and open http://localhost:5173.
**Expected:** A dark background with the animated purple/violet WebGL orb rendering.
No console errors (WebGL warnings about `gl_FragColor` in strict mode are OK).

**Revert App.tsx** after smoke test to:
```tsx
export default function App() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <p className="text-foreground">VoxSlide — setup complete</p>
    </div>
  )
}
```

---

## Acceptance Criteria

- [ ] `framer-motion` and `ogl` in `node_modules`
- [ ] `src/lib/utils.ts` exists with `cn()` function
- [ ] `@/` path alias works in TypeScript and Vite
- [ ] `src/components/ui/voice-powered-orb.tsx` exists with no TS errors
- [ ] `document.documentElement.classList.add('dark')` in `main.tsx`
- [ ] `npm run dev` starts without errors
- [ ] Orb renders in browser (smoke test passes)
- [ ] shadcn Badge component installed at `src/components/ui/badge.tsx`

## File Checklist After This Plan

```
src/
  main.tsx                          ← dark class added
  App.tsx                           ← reset to placeholder
  index.css                         ← shadcn vars + tailwind import
  lib/
    utils.ts                        ← cn() helper
  components/
    ui/
      badge.tsx                     ← shadcn Badge
      voice-powered-orb.tsx         ← OGL orb (copied from ui-guide.md)
```
