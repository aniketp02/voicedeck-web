# VoxSlide Frontend — Agent Plans Overview

## Purpose
These plans are for **autonomous Claude Code agents**.
Each plan is fully self-contained. Open one file and say:
> "Implement the plan in docs/agent-plans/NN-name.md"

## Plan Index

| Plan | Phase | Deliverable | Blocking On |
|------|-------|-------------|-------------|
| [01-shadcn-setup.md](01-shadcn-setup.md) | Setup | shadcn init, OGL, framer-motion, VoicePoweredOrb component | Nothing |
| [02-layout-slides.md](02-layout-slides.md) | Layout | Side-by-side shell, SlideView + TextEffect bullets, slide dot nav | Plan 01 |
| [03-websocket-hook.md](03-websocket-hook.md) | Data | useWebSocket hook, all WS message types, connection state | Plan 02 |
| [04-audio-hooks.md](04-audio-hooks.md) | Audio | useAudioCapture (PCM→backend), useAudioPlayer (TTS chunks) | Plan 03 |
| [05-full-integration.md](05-full-integration.md) | Final | App.tsx assembly, orb hue wiring, all interaction states | Plan 04 |

## Layout Specification (locked)

```
┌─────────────────────────────────────────────────────────────────┐
│  Header bar: title left · connection status · slide N/6 right  │
├──────────────────────────────────────────┬──────────────────────┤
│                                          │                      │
│  [Slide Title — 3xl bold]                │   [VoicePoweredOrb] │
│                                          │   300×300 centered   │
│  • Bullet (stagger-in on slide change)   │                      │
│  • Bullet                                │   [Status label]     │
│  • Bullet                                │   Listening /        │
│  • Bullet                                │   Speaking /         │
│                                          │   Thinking...        │
├──────────────────────────────────────────┴──────────────────────┤
│  Slide dot indicators (6 dots, active = pill)                   │
├─────────────────────────────────────────────────────────────────┤
│  [Bottom bar] You: transcript text  ·  Agent: response text     │
└─────────────────────────────────────────────────────────────────┘
```

- Left panel: `65%` width, slide content
- Right panel: `35%` width, orb + voice status
- Bottom bar: fixed, `bg-background/80 backdrop-blur`

## Orb Hue Scheme (locked)

| State | hue value | Color result | Label shown |
|-------|-----------|--------------|-------------|
| Idle (not started) | `0` | Purple/violet | — |
| Listening (mic on, no voice) | `0` | Purple/violet | "Listening..." |
| User speaking | `120` | Green/teal | "Hearing you..." |
| AI thinking (LLM call) | `0` + low hoverIntensity | Dim purple | "Thinking..." |
| AI speaking (TTS playing) | `260` | Blue-indigo | "Speaking..." |

## Tech Stack

```
React 19 + TypeScript 5 + Vite
Tailwind CSS v4 (already installed)
shadcn/ui — dark theme, slate base
framer-motion — slide transitions, TextEffect, AnimatedGroup
ogl — WebGL for VoicePoweredOrb
```

## Key Source Reference

`VoicePoweredOrb` component source: `/home/poklinho/projects/sythio-labs/ui-guide.md`
The component uses OGL (WebGL), takes `hue`, `enableVoiceControl`, and `onVoiceDetected` props.
In VoxSlide we control hue externally — set `enableVoiceControl={false}` and drive `hue` from app state.

## Dev Setup

```bash
cd voicedeck-web
npm install
npm run dev   # http://localhost:5173
# Backend must be running: cd ../voicedeck && source venv/bin/activate && uvicorn app.main:app --port 8000
```

## WebSocket Protocol (backend contract — do not change)

```
Client → Server:
  {"type": "start"}
  {"type": "audio_chunk", "data": "<base64 PCM linear16 16kHz mono>"}
  {"type": "interrupt"}
  {"type": "ping"}

Server → Client:
  {"type": "transcript",   "text": "...", "is_final": bool}
  {"type": "slide_change", "index": N,   "slide": {"title": "...", "bullets": [...]}}
  {"type": "agent_text",   "text": "..."}
  {"type": "tts_chunk",    "data": "<base64 MP3>"}
  {"type": "tts_done"}
  {"type": "error",        "message": "..."}
  {"type": "pong"}
```
