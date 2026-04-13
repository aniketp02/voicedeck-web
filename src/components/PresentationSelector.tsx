import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'

import { presentationsUrl } from '@/lib/apiOrigin'
import type { PresentationMeta } from '@/types/protocol'

interface Props {
  onSelect: (presentation: PresentationMeta) => void
}

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; presentations: PresentationMeta[] }

async function requestPresentations(): Promise<PresentationMeta[]> {
  const res = await fetch(presentationsUrl())
  if (!res.ok) throw new Error(`Server returned ${res.status}`)
  return res.json() as Promise<PresentationMeta[]>
}

export function PresentationSelector({ onSelect }: Props) {
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'loading' })

  const fetchPresentations = () => {
    setFetchState({ status: 'loading' })
    requestPresentations()
      .then((presentations) => setFetchState({ status: 'ready', presentations }))
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : 'Could not reach backend'
        setFetchState({ status: 'error', message })
      })
  }

  useEffect(() => {
    requestPresentations()
      .then((presentations) => setFetchState({ status: 'ready', presentations }))
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : 'Could not reach backend'
        setFetchState({ status: 'error', message })
      })
  }, [])

  return (
    <div className="hero-bg flex min-h-screen flex-col items-center justify-center gap-10 px-6 py-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white/70 px-4 py-1.5 text-xs font-medium text-indigo-700 shadow-sm backdrop-blur-sm dark:border-indigo-500/30 dark:bg-slate-900/70 dark:text-indigo-200">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500" />
          Voice-Interactive Presentations
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          Choose a Presentation
        </h1>
        <p className="max-w-sm text-muted-foreground">
          Ask questions, get answers — the slides follow the conversation.
        </p>
      </div>

      <div className="w-full max-w-2xl">
        {fetchState.status === 'loading' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {fetchState.status === 'error' && (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-destructive/20 bg-card p-8 text-center shadow-sm">
            <p className="text-sm text-destructive">
              Could not load presentations — is the backend running?
            </p>
            <p className="font-mono text-xs text-muted-foreground">{fetchState.message}</p>
            <button
              type="button"
              onClick={fetchPresentations}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Retry
            </button>
          </div>
        )}

        {fetchState.status === 'ready' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {fetchState.presentations.map((p, i) => (
              <PresentationCard
                key={p.id}
                presentation={p}
                index={i}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface CardProps {
  presentation: PresentationMeta
  index: number
  onSelect: (presentation: PresentationMeta) => void
}

function PresentationCard({ presentation, index, onSelect }: CardProps) {
  return (
    <motion.button
      type="button"
      onClick={() => onSelect(presentation)}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.3, ease: 'easeOut' }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className="group flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-6 text-left shadow-sm transition-all hover:border-indigo-200 hover:shadow-md hover:shadow-indigo-100/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:hover:border-indigo-500/40 dark:hover:shadow-indigo-950/40"
    >
      <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300">
        {presentation.slide_count} slides
      </span>

      <h3 className="text-base font-semibold leading-snug text-foreground transition-colors group-hover:text-indigo-700 dark:group-hover:text-indigo-300">
        {presentation.title}
      </h3>

      <p className="text-sm leading-relaxed text-muted-foreground">{presentation.description}</p>

      <div className="mt-auto flex items-center gap-1.5 text-xs font-medium text-indigo-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-indigo-400">
        Start presentation
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </motion.button>
  )
}

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
      <div className="h-5 w-3/4 animate-pulse rounded-md bg-muted" />
      <div className="space-y-1.5">
        <div className="h-3.5 animate-pulse rounded bg-muted" />
        <div className="h-3.5 w-5/6 animate-pulse rounded bg-muted" />
      </div>
    </div>
  )
}
