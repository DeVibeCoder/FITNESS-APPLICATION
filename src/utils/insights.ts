import type { BodyMeasurement, WeightEntry } from '@/models'
import type { WeightProgress } from './progress'
import { measurementChange } from './progress'
import { daysBetween } from './date'
import { num } from './format'

export interface Insight {
  id: string
  text: string
  /** 'good' = moving toward the goal. Never 'bad' — this is not a report card. */
  tone: 'good' | 'neutral'
}

/**
 * Plain observations read straight off the records. No coaching, no prediction,
 * no advice — and nothing is claimed unless there is enough data behind it.
 *
 * Every rule states its own minimum evidence. Where that evidence is missing
 * the rule simply produces nothing, and the caller falls back to asking the
 * user to keep logging.
 */
export function buildInsights(input: {
  weights: WeightEntry[]
  measurements: BodyMeasurement[]
  progress: WeightProgress
  workoutsThisWeek: number
  workoutGoal: number
  streak: number
  consistencyPct: number
}): Insight[] {
  const insights: Insight[] = []
  const { progress } = input

  // --- Weight trend: needs 3+ official weigh-ins spanning at least two weeks.
  const official = input.weights
    .filter((entry) => entry.kind === 'official')
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  const recent = official.slice(-5)
  if (recent.length >= 3) {
    const span = daysBetween(recent[0].date, recent[recent.length - 1].date)
    if (span >= 14) {
      const delta = recent[recent.length - 1].weightKg - recent[0].weightKg
      const weeks = Math.round(span / 7)
      if (Math.abs(delta) < 0.3) {
        insights.push({
          id: 'trend',
          text: `Your weight has held steady over the last ${weeks} weeks.`,
          tone: progress.direction === 'maintaining' ? 'good' : 'neutral',
        })
      } else {
        const goingDown = delta < 0
        const towardGoal =
          (progress.direction === 'losing' && goingDown) ||
          (progress.direction === 'gaining' && !goingDown)
        insights.push({
          id: 'trend',
          text: `Your weight is trending ${goingDown ? 'down' : 'up'} over the last ${weeks} weeks.`,
          tone: towardGoal ? 'good' : 'neutral',
        })
      }
    }
  }

  // --- Distance to goal: needs at least one weigh-in and a real target.
  if (official.length > 0 && !progress.reached && progress.remainingKg >= 0.1) {
    insights.push({
      id: 'remaining',
      text: `You're ${num(progress.remainingKg, 1)} kg from your goal.`,
      tone: 'neutral',
    })
  }
  if (progress.reached) {
    insights.push({ id: 'reached', text: 'You have reached your goal weight.', tone: 'good' })
  }

  // --- Measurements: needs two entries of the same field on different dates.
  for (const field of ['waistCm', 'chestCm', 'hipsCm'] as const) {
    const change = measurementChange(input.measurements, field)
    if (!change || change.points.length < 2 || Math.abs(change.change) < 0.5) continue
    const label = field === 'waistCm' ? 'waist' : field === 'chestCm' ? 'chest' : 'hips'
    const direction = change.change < 0 ? 'lower' : 'higher'
    insights.push({
      id: `measure-${field}`,
      text: `Your ${label} is ${num(Math.abs(change.change), 1)} cm ${direction} than your first measurement.`,
      tone: 'neutral',
    })
    break // One measurement observation is enough.
  }

  // --- Training: a simple count of what actually happened this week.
  if (input.workoutsThisWeek > 0) {
    insights.push({
      id: 'workouts',
      text: `You completed ${input.workoutsThisWeek} ${
        input.workoutsThisWeek === 1 ? 'workout' : 'workouts'
      } this week.`,
      tone: input.workoutsThisWeek >= input.workoutGoal ? 'good' : 'neutral',
    })
  }

  if (input.streak >= 7) {
    insights.push({
      id: 'streak',
      text: `You have logged something every day for ${input.streak} days.`,
      tone: 'good',
    })
  }

  return insights.slice(0, 4)
}

/** Shown when there is genuinely nothing to observe yet. */
export const NOT_ENOUGH_DATA = 'Keep logging to build your trend.'
