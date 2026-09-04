import { withUser } from '../_guard'
import { workoutRepo } from '../../../../server/fitness/repo'
import { validateWorkout } from '../../../../server/fitness/validate'

/** GET /api/fitness/workouts — the caller's own sessions, newest first. */
export const onRequestGet = (context: { request: Request; env: { DB?: unknown } }) =>
  withUser(context, async (user, db) => {
    const limit = Number(new URL(context.request.url).searchParams.get('limit') ?? 100)
    const sessions = await workoutRepo.list(db, user.id, limit)
    return Response.json({ sessions }, { headers: { 'Cache-Control': 'no-store' } })
  })

/**
 * POST /api/fitness/workouts — logs one.
 *
 * The owner comes from the session. A `userId` in the body is not read, so
 * sending one changes nothing rather than being an error worth reporting.
 */
export const onRequestPost = (context: { request: Request; env: { DB?: unknown } }) =>
  withUser(context, async (user, db) => {
    const input = validateWorkout(await context.request.json())
    const id = await workoutRepo.create(db, user.id, input)
    return Response.json({ id }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  })
