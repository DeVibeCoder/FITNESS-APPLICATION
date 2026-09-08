import { db } from '@/lib/db'
import type { PlanDay, WorkoutExercise, WorkoutPlan } from '@/models'
import { EXERCISES, PLAN_TEMPLATES, TEMPLATES, slotForDay } from './library'

/**
 * The catalogue, and only the catalogue.
 *
 * The application reads its exercises and plan templates from Dexie through
 * `useLiveQuery`, so those rows have to exist on a device before any workout
 * screen can draw anything. They used to arrive as a side effect of seeding
 * the demo group, which meant the only way to have a plan library was to also
 * have three strangers, their weigh-ins, their meals and their chat.
 *
 * This is the half that was always legitimate. An exercise is a fact about
 * the app — the same twenty-four rows for everyone, owned by nobody, carrying
 * nothing personal. The other half is gone; see `scripts/fixtures`.
 *
 * Two rules make this safe to run on every boot:
 *
 * It writes reference tables only. `users`, `sessions`, `weights`, `foods`,
 * `posts`, `messages` — every table that holds something a person did — are
 * not touched here and cannot be: they are not in the transaction.
 *
 * And it is idempotent by id. `bulkPut` on stable ids rewrites the same rows
 * rather than accumulating copies, so a catalogue correction ships by simply
 * being deployed. A plan somebody built themselves has an `ownerId` and an id
 * that is not a template id, so nothing here can overwrite it.
 */

/** Plans that ship with the app. `ownerId: null` is what marks them as ours. */
function buildTemplates(): {
  plans: WorkoutPlan[]
  planDays: PlanDay[]
  workoutExercises: WorkoutExercise[]
} {
  const plans: WorkoutPlan[] = []
  const planDays: PlanDay[] = []
  const workoutExercises: WorkoutExercise[] = []

  /*
   * A fixed timestamp, not `now()`. These rows are rewritten on every boot,
   * and a moving `createdAt` would make the catalogue look freshly authored
   * every time the app opened — and would reorder any list sorted by it.
   */
  const createdAt = '2026-01-01T00:00:00.000Z'

  for (const template of PLAN_TEMPLATES) {
    plans.push({
      id: template.id,
      name: template.name,
      description: template.description,
      level: template.level,
      totalDays: template.totalDays,
      focus: template.focus,
      ownerId: null,
      createdAt,
    })

    for (let dayNumber = 1; dayNumber <= template.totalDays; dayNumber++) {
      const slot = slotForDay(template, dayNumber)
      const planDayId = `${template.id}_d${dayNumber}`
      if (slot === 'rest') {
        planDays.push({
          id: planDayId,
          planId: template.id,
          dayNumber,
          name: 'Rest day',
          estimatedMinutes: 0,
        })
        continue
      }

      const workout = TEMPLATES[slot]
      planDays.push({
        id: planDayId,
        planId: template.id,
        dayNumber,
        name: workout.name,
        estimatedMinutes: workout.estimatedMinutes,
      })
      workout.exercises.forEach((exercise, index) => {
        workoutExercises.push({
          id: `${planDayId}_e${index}`,
          planDayId,
          exerciseId: exercise.exerciseId,
          order: index,
          sets: exercise.sets,
          reps: exercise.reps,
          durationSec: exercise.durationSec,
          restSec: exercise.restSec,
        })
      })
    }
  }

  return { plans, planDays, workoutExercises }
}

/**
 * Puts the catalogue on this device. Called once on boot, before any screen
 * reads a plan.
 */
export async function installReferenceData(): Promise<void> {
  const { plans, planDays, workoutExercises } = buildTemplates()

  await db.transaction(
    'rw',
    [db.exercises, db.plans, db.planDays, db.workoutExercises],
    async () => {
      await Promise.all([
        db.exercises.bulkPut(EXERCISES),
        db.plans.bulkPut(plans),
        db.planDays.bulkPut(planDays),
        db.workoutExercises.bulkPut(workoutExercises),
      ])
    },
  )
}
