import { withUser } from '../_guard'
import { workoutRepo } from '../../../../server/fitness/repo'
import { validateWorkout } from '../../../../server/fitness/validate'

type Context = { request: Request; env: { DB?: unknown }; params: { id: string } }

const missing = () =>
  Response.json(
    { error: 'not_found', message: 'That workout does not exist.' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  )

/** GET one, with its exercises and set results. Somebody else's is a 404. */
export const onRequestGet = (context: Context) =>
  withUser(context, async (user, db) => {
    const detail = await workoutRepo.detail(db, user.id, context.params.id)
    if (!detail) return missing()
    return Response.json(detail, { headers: { 'Cache-Control': 'no-store' } })
  })

/** PATCH — replaces the session and its exercises. Writes no announcement. */
export const onRequestPatch = (context: Context) =>
  withUser(context, async (user, db) => {
    const input = validateWorkout(await context.request.json())
    const updated = await workoutRepo.update(db, user.id, context.params.id, input)
    return updated ? Response.json({ id: context.params.id }, { headers: { 'Cache-Control': 'no-store' } }) : missing()
  })

/** DELETE — cascades the children; leaves group announcements standing. */
export const onRequestDelete = (context: Context) =>
  withUser(context, async (user, db) => {
    const removed = await workoutRepo.remove(db, user.id, context.params.id)
    return removed ? new Response(null, { status: 204 }) : missing()
  })
