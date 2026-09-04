import { withUser } from './_guard'
import { workoutRepo } from '../../../server/fitness/repo'

/**
 * GET /api/fitness/exercises — the reference catalogue.
 *
 * Shared reference data rather than anybody's records, but still behind the
 * session: an unauthenticated endpoint is an unauthenticated endpoint.
 */
export const onRequestGet = (context: { request: Request; env: { DB?: unknown } }) =>
  withUser(context, async (_user, db) => {
    const exercises = await workoutRepo.exercises(db)
    return Response.json({ exercises }, { headers: { 'Cache-Control': 'no-store' } })
  })
