/**
 * Hearing that the conversation changed.
 *
 * The socket carries no content. It says "a message happened" and the caller
 * reads it back over the same authenticated API it already uses — so there is
 * one path for reading a message and one idea of who is allowed to. A socket
 * that delivered content would be a second answer to that question.
 *
 * Everything here is optional. If the socket cannot be opened — no binding, no
 * network, a browser that has thrown the tab into the background for an hour —
 * the chat keeps working exactly as it did over HTTP. That is why reconnection
 * backs off and then stops trying rather than hammering: the application is
 * not waiting on this.
 */
type Listener = () => void

const RECONNECT_MS = [1000, 2000, 5000, 10000, 30000]

let socket: WebSocket | null = null
let attempt = 0
let closedOnPurpose = false
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<Listener>()

const notify = () => {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // One screen's re-render failing must not stop the others hearing.
    }
  }
}

function open(): void {
  if (closedOnPurpose || socket) return
  if (typeof WebSocket === 'undefined' || typeof location === 'undefined') return

  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/chat/socket`
  let next: WebSocket
  try {
    next = new WebSocket(url)
  } catch {
    return
  }
  socket = next

  next.addEventListener('open', () => {
    attempt = 0
  })

  next.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(String(event.data)) as { kind?: string }
      // An ack is the socket confirming it is alive, not news.
      if (payload.kind && payload.kind !== 'ack') notify()
    } catch {
      // Unreadable frame. Nothing to do but ignore it.
    }
  })

  const retry = () => {
    if (socket === next) socket = null
    if (closedOnPurpose) return
    /*
     * Five attempts over about fifty seconds, then stop. A tab left open for a
     * week must not spend the week reconnecting, and the REST path is still
     * there — the cost of giving up is that updates arrive when the screen
     * asks, which is how the chat worked before any of this.
     */
    const wait = RECONNECT_MS[Math.min(attempt, RECONNECT_MS.length - 1)]
    attempt += 1
    if (attempt > RECONNECT_MS.length) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(open, wait)
  }

  next.addEventListener('close', retry)
  next.addEventListener('error', retry)
}

export const chatRealtime = {
  /**
   * Starts listening, and returns the function that stops.
   *
   * Safe to call from several screens at once: they share one socket, and it
   * closes when the last of them lets go.
   */
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    closedOnPurpose = false
    open()
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) chatRealtime.stop()
    }
  },

  stop(): void {
    closedOnPurpose = true
    if (timer) clearTimeout(timer)
    timer = null
    attempt = 0
    const current = socket
    socket = null
    try {
      current?.close()
    } catch {
      // Already gone.
    }
  },

  /** For the checks: whether a socket is currently open. */
  connected(): boolean {
    return socket?.readyState === WebSocket.OPEN
  },
}
