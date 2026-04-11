import { Badge } from '@/components/ui/badge'

interface Props {
  connected: boolean
  slideIndex: number
  totalSlides: number
  title?: string
}

export function Header({
  connected,
  slideIndex,
  totalSlides,
  title = 'AI in Clinical Trials',
}: Props) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-white/80 px-8 py-3.5 backdrop-blur-sm">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
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
