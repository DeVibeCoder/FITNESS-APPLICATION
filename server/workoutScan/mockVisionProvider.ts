import type { WorkoutVisionProvider, WorkoutVisionResult } from './types.ts'

/**
 * Development-only stand-in for the vision provider.
 *
 * This exists so the review-and-edit form can be worked on without burning API
 * calls. It is reachable ONLY by setting WORKOUT_SCAN_MOCK=1 outside
 * production, and every response it produces is tagged `source: 'mock'` so the
 * interface can shout about it.
 *
 * It is never used as a fallback when the real provider fails. Showing someone
 * a plausible workout that has nothing to do with their screenshot is the bug
 * this endpoint was written to avoid, not a graceful degradation.
 *
 * Note the deliberately partial answer: two fields are left missing, because
 * the case worth exercising in development is the one where the screenshot did
 * not say everything and the review form has to ask.
 */
export class DevMockWorkoutVisionProvider implements WorkoutVisionProvider {
  readonly name = 'dev-mock'

  async read(): Promise<WorkoutVisionResult> {
    return {
      app: 'other',
      appName: 'DEV MOCK — not your screenshot',
      planName: 'DEV MOCK plan',
      dayNumber: 1,
      durationSec: 900,
      confidence: 0.1,
      notAWorkout: false,
      missing: ['caloriesKcal', 'exerciseCount', 'workoutName'],
    }
  }
}
