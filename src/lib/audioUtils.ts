/**
 * Convert Float32Array (Web Audio API native format) to Int16Array (PCM linear16).
 * Backend Deepgram config: linear16, 16000 Hz, mono.
 */
export function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]!))
    int16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767
  }
  return int16
}

/**
 * Encode Int16Array as base64 string for WebSocket transmission.
 */
export function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(
    int16.buffer,
    int16.byteOffset,
    int16.byteLength,
  )
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

/**
 * Calculate RMS amplitude (0–1) of a Float32Array.
 * Used for VAD (voice activity detection).
 */
export function getRMSLevel(float32: Float32Array): number {
  let sum = 0
  for (let i = 0; i < float32.length; i++) {
    sum += float32[i]! * float32[i]!
  }
  return Math.sqrt(sum / float32.length)
}

/**
 * Decode base64 string to Uint8Array.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
