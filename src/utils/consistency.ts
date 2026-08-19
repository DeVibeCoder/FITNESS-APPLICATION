import { clamp } from './format'

export interface ConsistencyInput {
  workouts: number
  workoutGoal: number
  /** Days in the week that hit the step goal. */
  stepDays: number
  /** Days with any food logged. */
  nutritionDays: number
  checkinDays: number
  /** Days elapsed in the week so far — a Tuesday is not judged against seven days. */
  daysElapsed: number
}

export interface ConsistencyResult {
  score: number
  parts: { label: string; done: number; total: number; pct: number }[]
}

const WEIGHTS = { workouts: 0.4, steps: 0.2, nutrition: 0.2, checkins: 0.2 }

/**
 * A weekly score out of 100, weighted toward training because that is what the
 * group actually committed to. Each part is capped at 100 so an exceptional
 * week in one area cannot paper over a missing one — but nothing goes negative
 * either. Missing a single day should sting a little, not feel like failure.
 */
export function consistencyScore(input: ConsistencyInput): ConsistencyResult {
  const elapsed = Math.max(1, input.daysElapsed)
  const parts = [
    {
      label: 'Workouts',
      done: input.workouts,
      total: input.workoutGoal,
      pct: clamp((input.workouts / Math.max(1, input.workoutGoal)) * 100, 0, 100),
    },
    {
      label: 'Steps',
      done: input.stepDays,
      total: elapsed,
      pct: clamp((input.stepDays / elapsed) * 100, 0, 100),
    },
    {
      label: 'Nutrition',
      done: input.nutritionDays,
      total: elapsed,
      pct: clamp((input.nutritionDays / elapsed) * 100, 0, 100),
    },
    {
      label: 'Check-ins',
      done: input.checkinDays,
      total: elapsed,
      pct: clamp((input.checkinDays / elapsed) * 100, 0, 100),
    },
  ]

  const score =
    parts[0].pct * WEIGHTS.workouts +
    parts[1].pct * WEIGHTS.steps +
    parts[2].pct * WEIGHTS.nutrition +
    parts[3].pct * WEIGHTS.checkins

  return { score: Math.round(score), parts }
}

/** Human framing for a score — never scolding. */
export function consistencyTone(score: number): { label: string; note: string } {
  if (score >= 90) return { label: 'Locked in', note: 'This is what a great week looks like.' }
  if (score >= 75) return { label: 'Strong week', note: 'Solid. Keep the chain going.' }
  if (score >= 55) return { label: 'Building', note: 'Decent base — one more session lifts this.' }
  if (score >= 30) return { label: 'Getting going', note: 'Some days beat no days.' }
  return { label: 'Fresh start', note: 'Today is a good day to start again.' }
}
