/**
 * Telling the room something changed.
 *
 * Called after a write to D1 has already succeeded, and never awaited in a way
 * that can fail the write: the message is saved whether or not anybody was
 * listening, and a delivery layer that can turn a successful save into an
 * error is worse than no delivery layer.
 *
 * The payload is an event, not a row — a kind and an id. Whoever hears it
 * reads the actual content back over the authenticated API, so nothing here
 * can leak content to a socket that should not have it.
 */
/*
 * The shape of the binding, declared here rather than pulled in from
 * `@cloudflare/workers-types`. The rest of this server does the same for D1:
 * three methods are all that is used, and a types package is a dependency to
 * keep in step for the sake of names already written down.
 */
export interface DurableObjectStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>
}
export interface DurableObjectNamespace {
  idFromName(name: string): unknown
  get(id: unknown): DurableObjectStub
}

export interface RealtimeEnv {
  CHAT_ROOM?: DurableObjectNamespace
  REALTIME_SECRET?: string
}

export interface RealtimeEvent {
  kind: 'message' | 'reaction' | 'deleted' | 'pinned'
  id?: string
  actorId?: string
}

export async function publish(
  env: RealtimeEnv,
  conversationId: string,
  event: RealtimeEvent,
): Promise<void> {
  if (!env.CHAT_ROOM) return
  try {
    const room = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(conversationId))
    await room.fetch('https://realtime.invalid/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.REALTIME_SECRET ? { 'x-circuit-realtime': env.REALTIME_SECRET } : {}),
      },
      body: JSON.stringify({ ...event, at: new Date().toISOString() }),
    })
  } catch {
    // Nobody heard it live. The row is in D1 and the next read finds it.
  }
}
