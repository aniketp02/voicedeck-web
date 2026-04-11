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
          className={`rounded-full transition-all duration-[400ms] ${
            i === current
              ? 'h-2 w-6 bg-primary'
              : 'h-2 w-2 bg-muted-foreground/30'
          }`}
        />
      ))}
    </div>
  )
}
