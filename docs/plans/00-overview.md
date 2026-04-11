# SynthioLabs Voice Slide Deck — Frontend Overview

## What We're Building
A React/TypeScript single-page app that:
1. Displays 6 slides (title + bullets) with smooth transitions
2. Connects to the backend via WebSocket for real-time voice interaction
3. Captures mic audio, encodes it as PCM, and streams chunks to the backend
4. Plays back TTS audio chunks received from the backend
5. Detects voice activity to send interrupt signals
6. Shows live transcript and AI response text

## Tech Stack
| Tool | Purpose |
|------|---------|
| React 19 + TypeScript | UI framework |
| Vite | Build tool + dev proxy |
| Tailwind CSS v4 | Styling |
| Web Audio API | Mic capture + PCM encoding + TTS playback + VAD |
| WebSocket (native) | Real-time backend communication |

## Dev Proxy
`vite.config.ts` proxies `/ws` → `ws://localhost:8000` and `/api` → `http://localhost:8000`.
No CORS config needed in development.

## Repository Layout
```
frontend/
├── src/
│   ├── App.tsx               # Root — renders SlidePresenter
│   ├── main.tsx              # React entry point
│   ├── index.css             # Tailwind import
│   ├── components/
│   │   ├── SlideView.tsx     # Renders a single slide (title + bullets)
│   │   ├── SlideNav.tsx      # Dot indicators + prev/next arrows
│   │   ├── TranscriptBar.tsx # Live transcript + agent text overlay
│   │   └── VoiceButton.tsx   # Mic start/stop + visual VAD indicator
│   ├── hooks/
│   │   ├── useWebSocket.ts   # WebSocket connection + message handling
│   │   ├── useAudioCapture.ts# Mic → PCM chunks via AudioWorklet
│   │   └── useAudioPlayer.ts # TTS chunk queue → Web Audio API playback
│   ├── lib/
│   │   └── audioUtils.ts     # Float32 → Int16 PCM conversion helper
│   └── types/
│       └── protocol.ts       # TypeScript types for WebSocket messages
├── docs/plans/               # ← You are here
├── index.html
├── package.json
└── vite.config.ts
```

## Build Order
| Plan | Feature | Depends On |
|------|---------|------------|
| [01-ws-slides](01-ws-slides.md) | WebSocket hook + slide display | — |
| [02-audio-capture](02-audio-capture.md) | Mic capture → PCM → backend | 01 |
| [03-audio-playback](03-audio-playback.md) | TTS chunks → Web Audio playback | 02 |
| [04-vad-interruption](04-vad-interruption.md) | VAD + interrupt signal + full polish | 03 |

## Running Locally
```bash
cd frontend
npm install
npm run dev
# Opens http://localhost:5173
# Backend must be running on port 8000
```

## Backend Dependency
This frontend is useless without the backend. Run both:
```bash
# Terminal 1 — backend
cd backend && uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend && npm run dev
```
