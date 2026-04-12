import { ThemeToggle } from '@/components/ThemeToggle'
import { Badge } from '@/components/ui/badge'

interface Props {
  connected: boolean
  slideIndex: number
  totalSlides: number
  title?: string
  onReset?: () => void
  isAutoNarrating?: boolean
  onStartAutoNarrate?: () => void
  onStopAutoNarrate?: () => void
}

export function Header({
  connected,
  slideIndex,
  totalSlides,
  title = 'AI in Clinical Trials',
  onReset,
  isAutoNarrating = false,
  onStartAutoNarrate,
  onStopAutoNarrate,
}: Props) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-white/80 px-8 py-3.5 backdrop-blur-sm dark:border-white/10 dark:bg-slate-950/90">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="flex items-center gap-3">
        <ThemeToggle />

        {connected && (onStartAutoNarrate || onStopAutoNarrate) ? (
          <button
            type="button"
            aria-pressed={isAutoNarrating}
            onClick={isAutoNarrating ? onStopAutoNarrate : onStartAutoNarrate}
            title={isAutoNarrating ? 'Stop auto-narration' : 'Auto-narrate all slides'}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              isAutoNarrating
                ? 'bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:hover:bg-violet-900/60'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {isAutoNarrating ? (
              <>
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
                Stop
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                </svg>
                Auto Present
              </>
            )}
          </button>
        ) : null}

        {connected && onReset ? (
          <button
            type="button"
            onClick={onReset}
            title="Restart from slide 1"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 12A7.5 7.5 0 0 1 12 4.5V3m0 1.5A7.5 7.5 0 1 1 4.5 12"
              />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v3" />
            </svg>
            Reset
          </button>
        ) : null}

        <Badge
          variant={connected ? 'outline' : 'secondary'}
          className={`text-xs font-medium ${
            connected
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/35 dark:bg-emerald-950/55 dark:text-emerald-300'
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
