import { useEffect, useRef } from 'react'
import type { OGLRenderingContext } from 'ogl'
import { Mesh, Program, Renderer, Triangle, Vec3 } from 'ogl'

import { cn } from '@/lib/utils'

/** WebGL2 — wavy orb shader adapted from 21st.dev / shadcn voice-powered-orb (default theme). */
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
uniform float iTime;
uniform vec3 iResolution;
uniform float hue;
uniform float hover;
uniform float rot;
uniform float hoverIntensity;
out vec4 fragColor;

vec3 rgb2yiq(vec3 c) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  return vec3(y, i, q);
}

vec3 yiq2rgb(vec3 c) {
  float r = c.x + 0.956 * c.y + 0.621 * c.z;
  float g = c.x - 0.272 * c.y - 0.647 * c.z;
  float b = c.x - 1.106 * c.y + 1.703 * c.z;
  return vec3(r, g, b);
}

vec3 adjustHue(vec3 color, float hueDeg) {
  float hueRad = hueDeg * 3.14159265 / 180.0;
  vec3 yiq = rgb2yiq(color);
  float cosA = cos(hueRad);
  float sinA = sin(hueRad);
  float i = yiq.y * cosA - yiq.z * sinA;
  float q = yiq.y * sinA + yiq.z * cosA;
  yiq.y = i;
  yiq.z = q;
  return yiq2rgb(yiq);
}

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yxz + 19.19);
  return -1.0 + 2.0 * fract(vec3(
    p3.x + p3.y,
    p3.x + p3.z,
    p3.y + p3.z
  ) * p3.zyx);
}

float snoise3(vec3 p) {
  const float K1 = 0.333333333;
  const float K2 = 0.166666667;
  vec3 i = floor(p + (p.x + p.y + p.z) * K1);
  vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
  vec3 e = step(vec3(0.0), d0 - d0.yzx);
  vec3 i1 = e * (1.0 - e.zxy);
  vec3 i2 = 1.0 - e.zxy * (1.0 - e);
  vec3 d1 = d0 - (i1 - K2);
  vec3 d2 = d0 - (i2 - K1);
  vec3 d3 = d0 - 0.5;
  vec4 h = max(0.6 - vec4(
    dot(d0, d0),
    dot(d1, d1),
    dot(d2, d2),
    dot(d3, d3)
  ), 0.0);
  vec4 n = h * h * h * h * vec4(
    dot(d0, hash33(i)),
    dot(d1, hash33(i + i1)),
    dot(d2, hash33(i + i2)),
    dot(d3, hash33(i + 1.0))
  );
  return dot(vec4(31.316), n);
}

vec4 extractAlpha(vec3 colorIn) {
  float a = max(max(colorIn.r, colorIn.g), colorIn.b);
  return vec4(colorIn.rgb / (a + 1e-5), a);
}

const vec3 baseColor1 = vec3(0.611765, 0.262745, 0.996078);
const vec3 baseColor2 = vec3(0.298039, 0.760784, 0.913725);
const vec3 baseColor3 = vec3(0.062745, 0.078431, 0.600000);
const float innerRadius = 0.6;
const float noiseScale = 0.65;

float light1(float intensity, float attenuation, float dist) {
  return intensity / (1.0 + dist * attenuation);
}

float light2(float intensity, float attenuation, float dist) {
  return intensity / (1.0 + dist * dist * attenuation);
}

vec4 draw(vec2 uv) {
  vec3 color1 = adjustHue(baseColor1, hue);
  vec3 color2 = adjustHue(baseColor2, hue);
  vec3 color3 = adjustHue(baseColor3, hue);

  float ang = atan(uv.y, uv.x);
  float len = length(uv);
  float invLen = len > 0.0 ? 1.0 / len : 0.0;

  float n0 = snoise3(vec3(uv * noiseScale, iTime * 0.5)) * 0.5 + 0.5;
  float r0 = mix(mix(innerRadius, 1.0, 0.4), mix(innerRadius, 1.0, 0.6), n0);
  float d0 = distance(uv, (r0 * invLen) * uv);
  float v0 = light1(1.0, 10.0, d0);
  v0 *= smoothstep(r0 * 1.05, r0, len);
  float cl = cos(ang + iTime * 2.0) * 0.5 + 0.5;

  float a = iTime * -1.0;
  vec2 pos = vec2(cos(a), sin(a)) * r0;
  float d = distance(uv, pos);
  float v1 = light2(1.5, 5.0, d);
  v1 *= light1(1.0, 50.0, d0);

  float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
  float v3 = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);

  vec3 col = mix(color1, color2, cl);
  col = mix(color3, col, v0);
  col = (col + v1) * v2 * v3;
  col = clamp(col, 0.0, 1.0);

  return extractAlpha(col);
}

vec4 mainImage(vec2 fragCoord) {
  vec2 center = iResolution.xy * 0.5;
  float size = min(iResolution.x, iResolution.y);
  vec2 uv = (fragCoord - center) / size * 2.0;

  float angle = rot;
  float s = sin(angle);
  float c = cos(angle);
  uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);

  uv.x += hover * hoverIntensity * 0.1 * sin(uv.y * 10.0 + iTime);
  uv.y += hover * hoverIntensity * 0.1 * sin(uv.x * 10.0 + iTime);

  return draw(uv);
}

void main() {
  vec2 fragCoord = vUv * iResolution.xy;
  vec4 col = mainImage(fragCoord);
  fragColor = vec4(col.rgb * col.a, col.a);
}
`

export interface VoicePoweredOrbProps {
  className?: string
  /** Hue shift in degrees (0 = default purple/cyan wavy palette). */
  hue?: number
  /**
   * When true, orb opens its own mic for analysis (demo mode).
   * Prefer passing `audioLevel` from app capture instead.
   */
  enableVoiceControl?: boolean
  /** Normalized 0–1 level from app RMS (e.g. `rmsLevel` while capturing). */
  audioLevel?: number
  voiceSensitivity?: number
  maxRotationSpeed?: number
  /** Caps wavy distortion strength (0–1). */
  hoverIntensity?: number
  onVoiceDetected?: (detected: boolean) => void
}

export function VoicePoweredOrb({
  className,
  hue = 0,
  enableVoiceControl = false,
  audioLevel: audioLevelProp = 0,
  voiceSensitivity = 1.5,
  maxRotationSpeed = 1.2,
  hoverIntensity = 0.8,
  onVoiceDetected,
}: VoicePoweredOrbProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef(hue)
  const hoverCapRef = useRef(hoverIntensity)
  const audioLevelRef = useRef(audioLevelProp)
  const voiceCbRef = useRef(onVoiceDetected)
  const enableVoiceRef = useRef(enableVoiceControl)

  useEffect(() => {
    hueRef.current = hue
  }, [hue])
  useEffect(() => {
    hoverCapRef.current = hoverIntensity
  }, [hoverIntensity])
  useEffect(() => {
    audioLevelRef.current = audioLevelProp
  }, [audioLevelProp])
  useEffect(() => {
    voiceCbRef.current = onVoiceDetected
  }, [onVoiceDetected])
  useEffect(() => {
    enableVoiceRef.current = enableVoiceControl
  }, [enableVoiceControl])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let renderer: Renderer | null = null
    let gl: OGLRenderingContext | null = null
    let program: Program | null = null
    let mesh: Mesh | null = null
    let geometry: Triangle | null = null
    let rafId = 0
    let lastTime = 0
    let currentRot = 0
    const micReadyRef = { current: false }

    let audioCtx: AudioContext | null = null
    let analyser: AnalyserNode | null = null
    let mediaStream: MediaStream | null = null
    let dataArray: Uint8Array | null = null

    const stopMicrophone = () => {
      if (mediaStream) {
        for (const t of mediaStream.getTracks()) t.stop()
        mediaStream = null
      }
      analyser = null
      dataArray = null
      if (audioCtx && audioCtx.state !== 'closed') void audioCtx.close()
      audioCtx = null
    }

    const analyzeInternalMic = (): number => {
      if (!analyser || !dataArray) return 0
      analyser.getByteFrequencyData(dataArray as never)
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i]! / 255
        sum += v * v
      }
      const rms = Math.sqrt(sum / dataArray.length)
      return Math.min(rms * voiceSensitivity * 3.0, 1)
    }

    const initMicrophone = async (): Promise<boolean> => {
      stopMicrophone()
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 44100,
          },
        })
        mediaStream = stream
        audioCtx = new AudioContext()
        if (audioCtx.state === 'suspended') await audioCtx.resume()
        analyser = audioCtx.createAnalyser()
        const src = audioCtx.createMediaStreamSource(stream)
        analyser.fftSize = 512
        analyser.smoothingTimeConstant = 0.3
        analyser.minDecibels = -90
        analyser.maxDecibels = -10
        src.connect(analyser)
        const n = analyser.frequencyBinCount
        dataArray = new Uint8Array(new ArrayBuffer(n))
        return true
      } catch {
        return false
      }
    }

    try {
      renderer = new Renderer({
        alpha: true,
        premultipliedAlpha: false,
        antialias: true,
        dpr: Math.min(2, window.devicePixelRatio || 1),
      })
      gl = renderer.gl
      gl.clearColor(0, 0, 0, 0)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

      while (container.firstChild) container.removeChild(container.firstChild)
      const canvasEl = gl.canvas as HTMLCanvasElement
      container.appendChild(canvasEl)

      geometry = new Triangle(gl)
      program = new Program(gl, {
        vertex: VERT,
        fragment: FRAG,
        uniforms: {
          iTime: { value: 0 },
          iResolution: {
            value: new Vec3(gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height),
          },
          hue: { value: hueRef.current },
          hover: { value: 0 },
          rot: { value: 0 },
          hoverIntensity: { value: 0 },
        },
      })
      mesh = new Mesh(gl, { geometry, program })

      const resize = () => {
        if (!container || !renderer || !gl || !program) return
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        const width = container.clientWidth
        const height = container.clientHeight
        if (width === 0 || height === 0) return
        renderer.setSize(width * dpr, height * dpr)
        const c = gl.canvas as HTMLCanvasElement
        c.style.width = `${width}px`
        c.style.height = `${height}px`
        program.uniforms.iResolution.value.set(
          gl.canvas.width,
          gl.canvas.height,
          gl.canvas.width / gl.canvas.height,
        )
      }
      window.addEventListener('resize', resize)
      resize()

      if (enableVoiceRef.current) {
        void initMicrophone().then((ok) => {
          micReadyRef.current = ok
        })
      }

      const baseRotationSpeed = 0.3

      const frame = (t: number) => {
        rafId = requestAnimationFrame(frame)
        if (!program || !renderer || !mesh || !gl) return

        const dt = lastTime ? (t - lastTime) * 0.001 : 0
        lastTime = t
        program.uniforms.iTime.value = t * 0.001
        program.uniforms.hue.value = hueRef.current

        let voiceLevel = 0
        if (enableVoiceRef.current && micReadyRef.current) {
          voiceLevel = analyzeInternalMic()
        } else {
          voiceLevel = Math.min(
            Math.max(0, audioLevelRef.current) * voiceSensitivity,
            1,
          )
        }

        if (voiceCbRef.current) {
          voiceCbRef.current(voiceLevel > 0.1)
        }

        const cap = hoverCapRef.current
        if (voiceLevel > 0.05) {
          const speed = baseRotationSpeed + voiceLevel * maxRotationSpeed * 2.0
          currentRot += dt * speed
          program.uniforms.hover.value = Math.min(voiceLevel * 2.0, 1.0)
          program.uniforms.hoverIntensity.value = Math.min(
            voiceLevel * cap * 0.8,
            cap,
          )
        } else {
          currentRot += dt * baseRotationSpeed * 0.2
          program.uniforms.hover.value = 0
          program.uniforms.hoverIntensity.value = 0
        }

        program.uniforms.rot.value = currentRot

        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
        renderer.render({ scene: mesh })
      }
      rafId = requestAnimationFrame(frame)

      return () => {
        cancelAnimationFrame(rafId)
        window.removeEventListener('resize', resize)
        stopMicrophone()
        try {
          const c = gl?.canvas as HTMLCanvasElement | undefined
          if (c && container.contains(c)) container.removeChild(c)
        } catch {
          /* ignore */
        }
        program?.remove()
        geometry?.remove()
        gl?.getExtension('WEBGL_lose_context')?.loseContext()
      }
    } catch (e) {
      console.error('VoicePoweredOrb init failed:', e)
      return undefined
    }
  }, [
    maxRotationSpeed,
    voiceSensitivity,
    enableVoiceControl,
  ])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative h-full w-full min-h-[120px] overflow-hidden rounded-xl',
        className,
      )}
      aria-hidden
    />
  )
}
