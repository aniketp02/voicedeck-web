/** Backend base URL with no trailing slash. Empty in dev → use Vite proxy (/api, /ws). */
function apiOrigin(): string {
  const raw = import.meta.env.VITE_API_ORIGIN as string | undefined
  return raw?.trim().replace(/\/$/, '') ?? ''
}

/** GET /presentations — dev uses /api/presentations (proxied); prod uses absolute backend URL. */
export function presentationsUrl(): string {
  const base = apiOrigin()
  return base ? `${base}/presentations` : '/api/presentations'
}

/** WebSocket URL for /ws. */
export function webSocketUrl(): string {
  const base = apiOrigin()
  if (base) {
    const u = new URL(base)
    const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${wsProto}//${u.host}/ws`
  }
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}/ws`
}
