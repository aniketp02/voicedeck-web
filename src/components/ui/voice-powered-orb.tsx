import { useEffect, useRef } from 'react'
import { Mesh, Program, Renderer, Triangle } from 'ogl'

import { cn } from '@/lib/utils'

const VERT = `#version 300 es
precision highp float;
in vec2 uv;
in vec2 position;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform float uTime;
uniform float uHue;
uniform float uHoverIntensity;
uniform float uAudioLevel;
uniform vec2 uResolution;
out vec4 fragColor;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec2 uv = vUv - 0.5;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  uv.x *= aspect;
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float audio = uAudioLevel * 0.35;
  float swirl =
      sin(uTime * 1.4 + r * (9.0 + audio * 6.0) + a * 2.8) * 0.5 + 0.5;
  float pulse = 0.52 + 0.28 * sin(uTime * 2.0 + r * 11.0);
  float edge = smoothstep(0.5 + audio * 0.08, 0.1, r);
  float core =
      edge *
      (0.62 + 0.38 * swirl) *
      (0.75 + 0.25 * uHoverIntensity) *
      (0.88 + 0.12 * pulse);
  float sat = 0.48 + 0.18 * swirl + audio * 0.15;
  vec3 col = hsv2rgb(vec3(mod(uHue / 360.0, 1.0), sat, core));
  fragColor = vec4(col * core, 1.0);
}
`

export interface VoicePoweredOrbProps {
  className?: string
  /** Hue in degrees (0–360), drives orb color. */
  hue?: number
  /** When true, microphone level modulates the orb and may call `onVoiceDetected`. */
  enableVoiceControl?: boolean
  onVoiceDetected?: () => void
  /** Scales motion / brightness (e.g. lower while “thinking”). Default 1. */
  hoverIntensity?: number
}

export function VoicePoweredOrb({
  className,
  hue = 0,
  enableVoiceControl = false,
  onVoiceDetected,
  hoverIntensity = 1,
}: VoicePoweredOrbProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef(hue)
  const hoverRef = useRef(hoverIntensity)
  const voiceCbRef = useRef(onVoiceDetected)

  useEffect(() => {
    hueRef.current = hue
  }, [hue])
  useEffect(() => {
    hoverRef.current = hoverIntensity
  }, [hoverIntensity])
  useEffect(() => {
    voiceCbRef.current = onVoiceDetected
  }, [onVoiceDetected])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const canvas = document.createElement('canvas')
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    el.appendChild(canvas)

    const renderer = new Renderer({
      canvas,
      width: el.clientWidth,
      height: el.clientHeight,
      dpr: Math.min(2, window.devicePixelRatio || 1),
      alpha: false,
      antialias: true,
    })
    const { gl } = renderer

    const geometry = new Triangle(gl)
    const program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uHue: { value: hueRef.current },
        uHoverIntensity: { value: hoverRef.current },
        uAudioLevel: { value: 0 },
        uResolution: { value: [el.clientWidth, el.clientHeight] },
      },
      depthTest: false,
      depthWrite: false,
    })
    const mesh = new Mesh(gl, { geometry, program, frustumCulled: false })

    let audioCtx: AudioContext | null = null
    let analyser: AnalyserNode | null = null
    let mediaStream: MediaStream | null = null
    let lastVoiceFire = 0

    if (enableVoiceControl) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          mediaStream = stream
          audioCtx = new AudioContext()
          const src = audioCtx.createMediaStreamSource(stream)
          analyser = audioCtx.createAnalyser()
          analyser.fftSize = 512
          src.connect(analyser)
        })
        .catch(() => {
          /* mic denied — orb still renders */
        })
    }

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      const h = el.clientHeight
      renderer.setSize(w, h)
      program.uniforms.uResolution.value = [w, h]
    })
    ro.observe(el)

    let raf = 0
    const t0 = performance.now()
    const data = new Uint8Array(256)

    const loop = (t: number) => {
      const time = (t - t0) * 0.001
      program.uniforms.uTime.value = time
      program.uniforms.uHue.value = hueRef.current
      program.uniforms.uHoverIntensity.value = hoverRef.current

      let level = 0
      if (analyser) {
        analyser.getByteFrequencyData(data)
        let s = 0
        for (let i = 0; i < data.length; i++) s += data[i]!
        level = s / (data.length * 255)
        program.uniforms.uAudioLevel.value = level
        const now = performance.now()
        if (
          level > 0.12 &&
          voiceCbRef.current &&
          now - lastVoiceFire > 400
        ) {
          lastVoiceFire = now
          voiceCbRef.current()
        }
      } else {
        program.uniforms.uAudioLevel.value = 0
      }

      renderer.render({ scene: mesh })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      program.remove()
      geometry.remove()
      if (mediaStream) {
        for (const track of mediaStream.getTracks()) track.stop()
      }
      if (audioCtx) void audioCtx.close()
      el.removeChild(canvas)
    }
  }, [enableVoiceControl])

  return (
    <div
      ref={containerRef}
      className={cn('relative size-full min-h-[120px] overflow-hidden rounded-full', className)}
      aria-hidden
    />
  )
}
