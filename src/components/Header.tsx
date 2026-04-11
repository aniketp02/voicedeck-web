import { Badge } from '@/components/ui/badge'

interface Props {
  connected: boolean
  slideIndex: number
  totalSlides: number
}

export function Header({ connected, slideIndex, totalSlides }: Props) {
  return (
    <header className="flex items-center justify-between border-b border-border/50 px-8 py-4">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">
        AI in Clinical Trials
      </h2>
      <div className="flex items-center gap-3">
        <Badge
          variant={connected ? 'default' : 'secondary'}
          className={`text-xs ${connected ? 'border-emerald-500/30 bg-emerald-500/20 text-emerald-400' : ''}`}
        >
          <span
            className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
              connected ? 'bg-emerald-400' : 'bg-muted-foreground/50'
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
