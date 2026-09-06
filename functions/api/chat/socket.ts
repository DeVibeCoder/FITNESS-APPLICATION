/**
 * The one door to the realtime layer.
 *
 * A client asks this route to upgrade to a WebSocket. Before anything is
 * forwarded, the session cookie is resolved, the account is checked for
 * approval, and membership of the conversation is confirmed — so by the time
 * the Durable Object sees a request, who the caller is and what they are
 * allowed to hear has already been decided. The object is bound
 * service-to-service and has no public route, so this is the only path to it.
 *
 * Nothing is sent over the socket. It carries notifications that something
 * changed, and the client reads the change back over the same authenticated
 * HTTP API it always used. That is deliberate: a second write path would be a
 * second place to get the sender's identity right.
 *
 * If the binding is missing — a preview without the Worker, a local `pages
 * dev` — this answers 503 and the client keeps polling. The application is
 * fully usable without realtime; that is the difference between delivery and
 * storage.
 */
import { requireApprovedUser, authFailureResponse, type AuthEnv } from '../../../server/auth/guard'
import { chatRepo, CONVERSATION_ID } from '../../../server/data/chatRepo'
import type { D1Database } from '../../../server/fitness/repo'
import type { DurableObjectNamespace } from '../../../server/data/realtime'

interface RealtimeEnv {
  DB?: unknown
  CHAT_ROOM?: DurableObjectNamespace
  REALTIME_SECRET?: string
}

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export const onRequestGet = async (context: { request: Request; env: RealtimeEnv }) => {
  if (!context.env.DB) {
    return json({ error: 'unauthenticated', message: 'Sign in to continue.' }, 401)
  }

  let user
  try {
    user = await requireApprovedUser(context.request, context.env as unknown as AuthEnv)
  } catch (error) {
    const refusal = authFailureResponse(error)
    if (refusal) return refusal
    throw error
  }

  const db = context.env.DB as D1Database

  // You may listen to a conversation you are in. Membership is read from the
  // database, never from the request.
  await chatRepo.ensureMember(db, user.id)
  if (!(await chatRepo.isMember(db, user.id))) {
    return json({ error: 'forbidden', message: 'That is not your conversation.' }, 403)
  }

  if (!context.env.CHAT_ROOM) {
    return json(
      { error: 'realtime_unavailable', message: 'Live updates are not available here.' },
      503,
    )
  }

  const room = context.env.CHAT_ROOM.get(context.env.CHAT_ROOM.idFromName(CONVERSATION_ID))
  const forwarded = new Request(context.request)
  if (context.env.REALTIME_SECRET) {
    forwarded.headers.set('x-circuit-realtime', context.env.REALTIME_SECRET)
  }
  return room.fetch(forwarded)
}
