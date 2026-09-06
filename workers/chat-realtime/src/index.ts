/**
 * Delivery for the group chat. Not storage.
 *
 * D1 remains the source of truth: a message is written there over HTTP and is
 * complete the moment that returns. This object exists only so the other
 * people looking at the conversation hear about it without waiting to ask
 * again. Nothing is persisted here — no message history, no state worth
 * losing — which is what makes it safe for this to be missing, restarted, or
 * evicted at any moment.
 *
 * Nobody reaches it directly. The only caller is the Pages Function at
 * `/api/chat/socket`, which resolves the session cookie, checks that the
 * account is approved and in the conversation, and only then forwards the
 * request. That is the whole authentication story, and it is deliberately not
 * duplicated here: two places that decide who you are is two places that can
 * disagree. The object is bound service-to-service and is not routed publicly.
 *
 * The one thing it does insist on is that the caller was forwarded rather than
 * arriving on its own, which is what the shared header is for.
 */

interface Env {
  /** Set as a secret on both sides. Proves the request came from the app. */
  REALTIME_SECRET?: string
}

/** What a client is told. Deliberately small — an event, not a database row. */
interface Broadcast {
  kind: 'message' | 'reaction' | 'deleted' | 'pinned'
  /** The row's id in D1, so the client can fetch or reconcile it. */
  id?: string
  /** Who caused it, as the server knows them. Never taken from the client. */
  actorId?: string
  at: string
}

export class ChatRoom implements DurableObject {
  private sockets = new Set<WebSocket>()

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Forwarded, or not at all.
    if (this.env.REALTIME_SECRET && request.headers.get('x-circuit-realtime') !== this.env.REALTIME_SECRET) {
      return new Response('forbidden', { status: 403 })
    }

    if (url.pathname.endsWith('/publish')) {
      const event = (await request.json()) as Broadcast
      this.broadcast(event)
      return Response.json({ delivered: this.sockets.size })
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    server.accept()
    this.sockets.add(server)

    /*
     * A socket that has gone away is not an error worth reporting, it is the
     * ordinary end of a connection: a phone locking, a tab closing, a train
     * going into a tunnel. Both endings do the same thing.
     */
    const forget = () => this.sockets.delete(server)
    server.addEventListener('close', forget)
    server.addEventListener('error', forget)

    /*
     * Messages from a client are read and dropped. Sending is done over HTTP,
     * against D1, through the same authenticated route as everything else —
     * accepting content here would be a second write path with a different
     * idea of who the sender is.
     */
    server.addEventListener('message', () => {
      try {
        server.send(JSON.stringify({ kind: 'ack', at: new Date().toISOString() }))
      } catch {
        forget()
      }
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  private broadcast(event: Broadcast): void {
    const payload = JSON.stringify(event)
    for (const socket of [...this.sockets]) {
      try {
        socket.send(payload)
      } catch {
        this.sockets.delete(socket)
      }
    }
  }
}

/**
 * The Worker itself does nothing but hold the class.
 *
 * Pages can bind a Durable Object only from another script, so this exists to
 * be that script. It answers nothing on its own so that a stray request to its
 * workers.dev address finds no application behind it.
 */
export default {
  fetch(): Response {
    return new Response('not found', { status: 404 })
  },
}
