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
 * Note the deliberately partial answer: calories are left missing, because the
 * case worth exercising in development is the one where the screenshot did not
 * say everything and the review form has to ask. The exercise list is partial
 * in the same way — one row carries a weight and one does not.
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
      kind: 'strength',
      exercises: [
        { name: 'DEV MOCK squats', kind: 'strength', sets: 3, reps: 12 },
        { name: 'DEV MOCK bench press', kind: 'strength', sets: 4, reps: 8, weightKg: 60 },
        { name: 'DEV MOCK treadmill', kind: 'cardio', durationSec: 600, distanceKm: 1.5 },
      ],
      confidence: 0.1,
      notAWorkout: false,
      missing: ['caloriesKcal', 'workoutName'],
    }
  }
}
