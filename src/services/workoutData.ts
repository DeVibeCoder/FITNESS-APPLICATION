/**
 * Which store a workout goes to, decided in one place.
 *
 * The application has two: D1 behind the fitness API, and Dexie in the
 * browser. Rather than teach every screen about both, this picks — and every
 * caller keeps calling the same four functions it always did.
 *
 * The rule is simple and deliberately not clever: **the cloud is used only
 * when there is a real approved session to use it with.** No session, no
 * backend deployed, or an account still waiting for approval, and everything
 * carries on in Dexie exactly as before. Nothing is ever written to the cloud
 * anonymously, and no server identity is invented to make a write possible.
 *
 * What this does NOT do is move anything. History already in Dexie stays in
 * Dexie; the cloud starts empty and fills up with what is logged from here
 * on. Bulk-uploading a device's history is a migration with real questions
 * attached — which rows are legitimately this person's, what happens on a
 * second device — and it is not this phase's to answer.
 *
 * Announcements stay local either way, because the group feed has not moved
 * yet. That keeps the Phase 30 rule intact: a new workout announces once, an
 * edit announces nothing, and a delete leaves the announcement standing.
 */
import type { DateKey, Difficulty, ID, LoggedExercise, WorkoutKind, WorkoutSession } from '@/models'
import { workoutService } from './workoutService'
import { cloudWorkoutService, CloudWorkoutError } from './cloudWorkoutService'
import { updateService } from './updateService'

export type WorkoutStore = 'cloud' | 'local'

/**
 * Set once, when the session is resolved. Not read from storage and not
 * guessable by a screen: if nobody has said there is an approved session,
 * there is not one.
 */
let store: WorkoutStore = 'local'

/**
 * Puts a cloud workout under the profile the app knows the person by.
 *
 * D1 stores the server account id, which is the right owner to store. The
 * screens ask a different question — "is this mine, may I edit it" — and they
 * answer it with the local profile id the identity bridge linked to that
 * account. Without this, a workout logged to the cloud comes back owned by an
 * id no screen recognises, and the card silently drops its edit and delete
 * controls. The relabelling is safe because the API returns nothing but the
 * caller's own rows: the guard resolves the owner from the session cookie, so
 * every row here already belongs to whoever is asking.
 */
const asLocalOwner = (session: WorkoutSession, userId: ID): WorkoutSession => ({ ...session, userId })

export const workoutData = {
  /** Called by AuthContext once it knows what kind of session this is. */
  useCloud(enabled: boolean): void {
    store = enabled ? 'cloud' : 'local'
  },

  current(): WorkoutStore {
    return store
  },

  async list(userId: ID): Promise<WorkoutSession[]> {
    if (store === 'cloud') {
      const sessions = await cloudWorkoutService.list()
      return sessions.map((session) => asLocalOwner(session, userId))
    }
    return workoutService.sessionsForUser(userId)
  },

  async exercisesFor(sessionId: ID): Promise<LoggedExercise[]> {
    if (store === 'cloud') {
      const detail = await cloudWorkoutService.detail(sessionId)
      return detail?.exercises ?? []
    }
    return workoutService.exercisesFor(sessionId)
  },

  /**
   * Logs or edits one workout.
   *
   * `sessionId` present means edit, exactly as the local service has always
   * treated it — so an edit updates in place and cannot become a second
   * workout, in either store.
   */
  async save(input: {
    sessionId?: ID
    userId: ID
    date: DateKey
    kind: WorkoutKind
    name: string
    durationSec: number
    caloriesKcal?: number
    difficulty?: Difficulty
    note?: string
    exercises: Omit<LoggedExercise, 'id' | 'sessionId' | 'order'>[]
  }): Promise<WorkoutSession> {
    if (store !== 'cloud') return workoutService.logManual(input)

    const payload = {
      date: input.date,
      kind: input.kind,
      name: input.name,
      durationSec: input.durationSec,
      caloriesKcal: input.caloriesKcal,
      difficulty: input.difficulty,
      note: input.note,
      exercises: input.exercises,
    }

    if (input.sessionId) {
      await cloudWorkoutService.update(input.sessionId, payload)
      const edited = await cloudWorkoutService.detail(input.sessionId)
      if (!edited) throw new CloudWorkoutError('not_found', 'That workout no longer exists.', 404)
      // Deliberately no announcement: an edit restates a workout, it does not
      // perform a new one.
      return asLocalOwner(edited.session, input.userId)
    }

    const id = await cloudWorkoutService.create(payload)
    const created = await cloudWorkoutService.detail(id)
    if (!created) throw new CloudWorkoutError('not_found', 'That workout could not be read back.', 404)

    /*
     * The group hears about it once. postOnce is keyed to the workout id, so
     * a retry after a flaky response cannot produce a second announcement —
     * and because the id comes from D1, an edit later carries the same key
     * and changes nothing.
     */
    await updateService.postOnce({
      userId: input.userId,
      kind: 'workout_completed',
      dedupeKey: `workout:${id}`,
      text: `completed ${created.session.name} 💪`,
      meta: { kcal: created.session.caloriesKcal, durationSec: created.session.durationSec },
    })

    return asLocalOwner(created.session, input.userId)
  },

  /** Removes a workout. Its announcement is left standing, as it always was. */
  async remove(sessionId: ID): Promise<void> {
    if (store === 'cloud') return cloudWorkoutService.remove(sessionId)
    return workoutService.removeSession(sessionId)
  },
}
