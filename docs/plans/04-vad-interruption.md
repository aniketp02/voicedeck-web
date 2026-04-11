# Frontend Plan 04 — VAD + Interruption + Final Polish

## Goal
1. Detect when the user starts speaking while TTS is playing
2. Send an `interrupt` signal to stop the AI mid-sentence
3. Stop playing audio locally
4. Polish the UI: smooth slide transitions, status indicators, error states

**Success criterion:** The full E2E loop works beautifully:
speak → AI responds with voice → speak again → AI stops and listens.

## Prerequisite
All previous plans complete (01-03 backend + 01-03 frontend).

## VAD + Interruption Logic

Add to `useAudioCapture.ts` — pass `isTTSSpeaking` and `onInterrupt`:

```typescript
// Update UseAudioCaptureOptions:
interface UseAudioCaptureOptions {
  onAudioChunk: (base64: string) => void
  onVoiceStart?: () => void
  onVoiceEnd?: () => void
  isTTSSpeaking?: boolean          // NEW
  onInterrupt?: () => void         // NEW
}

// In onaudioprocess, add after VAD detection:
const isVoice = rms > VAD_THRESHOLD
if (isVoice && !wasVoiceActiveRef.current) {
  wasVoiceActiveRef.current = true
  onVoiceStart?.()

  // Interrupt TTS if AI is speaking
  if (isTTSSpeaking) {
    onInterrupt?.()
  }
}
```

## Update `src/App.tsx` for Interruption

```tsx
// In App.tsx, wire interrupt:
const { isCapturing, rmsLevel, start: startCapture, stop: stopCapture } = useAudioCapture({
  onAudioChunk: (base64) => send({ type: 'audio_chunk', data: base64 }),
  isTTSSpeaking: state.isTTSSpeaking,
  onInterrupt: () => {
    stopAudio()                          // stop local audio playback
    send({ type: 'interrupt' })          // tell backend to stop TTS
  },
})
```

## Slide Transition Animation

Update `SlideView.tsx` to animate between slides:

```tsx
import { useEffect, useState } from 'react'
import type { Slide } from '../types/protocol'

interface Props {
  slide: Slide | null
}

export function SlideView({ slide }: Props) {
  const [displaySlide, setDisplaySlide] = useState(slide)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    if (!slide || slide.index === displaySlide?.index) return
    setFading(true)
    const t = setTimeout(() => {
      setDisplaySlide(slide)
      setFading(false)
    }, 250)
    return () => clearTimeout(t)
  }, [slide])

  if (!displaySlide) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-500 text-xl">Connecting...</p>
      </div>
    )
  }

  return (
    <div
      className={`flex-1 flex flex-col justify-center px-16 py-12 transition-opacity duration-250 ${
        fading ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'
      }`}
      style={{ transition: 'opacity 250ms ease, transform 250ms ease' }}
    >
      <h1 className="text-5xl font-bold text-white mb-10 leading-tight tracking-tight">
        {displaySlide.title}
      </h1>
      <ul className="space-y-4">
        {displaySlide.bullets.map((bullet, i) => (
          <li
            key={i}
            className="flex items-start gap-4"
            style={{
              animation: `fadeInUp 0.4s ease ${i * 0.08}s both`,
            }}
          >
            <span className="mt-2 w-2 h-2 rounded-full bg-purple-400 flex-shrink-0" />
            <span className="text-xl text-gray-200 leading-relaxed">{bullet}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

Add to `src/index.css` (after tailwind import):
```css
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

## Connection Status + Error Display

Add a status bar to `App.tsx`:

```tsx
// Top of the presentation screen, above slides:
<div className="flex items-center justify-between px-8 py-4 border-b border-gray-800">
  <div className="flex items-center gap-2">
    <div className={`w-2 h-2 rounded-full ${state.connected ? 'bg-green-400' : 'bg-red-400'}`} />
    <span className="text-gray-400 text-sm">
      {state.connected ? 'Connected' : 'Disconnected'}
    </span>
  </div>
  <span className="text-gray-600 text-sm">AI in Clinical Trials</span>
  <div className="w-24" /> {/* spacer */}
</div>
```

For errors:
```tsx
{state.error && (
  <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-red-900/80 text-red-200 px-4 py-2 rounded-lg text-sm">
    {state.error}
  </div>
)}
```

## Final `src/App.tsx` — Complete Assembly

At this point, App.tsx should compose all hooks and components together.
Key wiring:
1. `useWebSocket` → manages connection + state
2. `useAudioCapture` → mic → PCM → backend, VAD → interrupt signal
3. `useAudioPlayer` → TTS chunks → Web Audio playback
4. `SlideView` → current slide with transitions
5. `SlideNav` → dot indicators
6. `VoiceButton` → mic toggle with RMS visualization
7. `TranscriptBar` → live transcript + agent text
8. Status bar → connection state

## E2E Verification Checklist
- [ ] App loads at http://localhost:5173
- [ ] Click Start → WebSocket connects → Slide 1 appears
- [ ] Click mic → browser asks permission → grant
- [ ] Say "tell me about patient recruitment" → slide 2 appears, AI narrates
- [ ] Say "what about FDA regulation?" → slide 5 appears, AI narrates
- [ ] Interrupt mid-sentence → AI stops, system listens
- [ ] Say another question → AI answers
- [ ] Connection loss → red status dot appears
- [ ] Slide transitions are smooth (250ms fade)
- [ ] Mic button pulses with voice level

## Deployment Note (Optional)
If demoing remotely, mic access requires HTTPS.
Quick option: `npx serve dist --ssl-cert` or deploy to Vercel/Netlify.
