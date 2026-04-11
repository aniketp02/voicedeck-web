# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

**SynthioLabs Voice Slide Deck — Frontend** — React/TypeScript frontend for a voice-activated interactive slide deck prototype. Streams audio to/from the FastAPI backend via WebSockets; displays slides and visualizes voice activity.

**Stack:** React 19, TypeScript 5, Vite, Tailwind CSS

## Commands

```bash
npm install              # Install dependencies
npm run dev              # Start dev server
npm run build            # Production build
npm run test             # Run tests
npm run lint             # ESLint
npm run type-check       # TypeScript checking
```

## Architecture

```
src/
  components/            # Reusable UI components
    ui/                  # Base components (Button, Input, etc.)
  pages/                 # Route-level page components
  hooks/                 # Custom React hooks
  lib/                   # Utilities, API client, helpers
  types/                 # TypeScript type definitions
  styles/                # Global styles, Tailwind config
```

## Key Patterns

- Functional components with hooks only (no class components)
- TypeScript strict mode — no `any` types
- React Query for server state, local state for UI state
- Composition over prop drilling — use context sparingly
- Co-locate tests with components (`Component.test.tsx`)
- CSS via Tailwind utility classes, avoid custom CSS

## Component Pattern

```tsx
interface Props {
  title: string
  onAction: () => void
}

export function MyComponent({ title, onAction }: Props) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <button onClick={onAction}>Action</button>
    </div>
  )
}
```

## Testing

```bash
/tdd                 # TDD workflow
/code-review         # Code review
/build-fix           # Fix build errors
```

## Git Workflow

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`
- Feature branches from `main`
