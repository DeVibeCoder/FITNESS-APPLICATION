import type { WeeklyReview, WeeklyComparison } from '@/services/reviewService'
import type { WeightProgress } from './progress'
import { num } from './format'
import { weekdayLabel } from './date'

/**
 * Deterministic sentences about the week, read straight off the numbers.
 *
 * No coaching, no prediction, no advice. Each line states something that
 * happened, and a line is only produced when the data behind it exists. The
 * tone rules from the brief apply: nothing here says failed, behind, or worst.
 */
export function reviewLines(
  review: WeeklyReview,
  progress: WeightProgress,
  options: { isCurrentWeek?: boolean } = {},
): string[] {
  const lines: string[] = []
  // Streaks and distance-to-goal describe where the member stands right now.
  // Stating them inside a review of a week from last year would be true of
  // today and misleading about that week, so they are current-week only.
  const present = options.isCurrentWeek ?? false

  if (review.workouts > 0) {
    lines.push(
      review.workouts >= review.workoutGoal
        ? `You hit your target of ${review.workoutGoal} workouts this week.`
        : `You trained ${review.workouts} ${review.workouts === 1 ? 'time' : 'times'} this week.`,
    )
  }

  if (review.bestDay) {
    lines.push(`Your longest session was on ${weekdayLabel(review.bestDay.date)}.`)
  }

  if (review.steps > 0) {
    lines.push(`You walked ${num(review.steps)} steps, averaging ${num(review.avgStepsPerDay)} a day.`)
  }

  if (review.nutritionDays > 0) {
    lines.push(
      `You logged food on ${review.nutritionDays} of ${review.daysElapsed} days.`,
    )
  }

  if (review.weightChangeKg !== undefined && Math.abs(review.weightChangeKg) >= 0.1) {
    const down = review.weightChangeKg < 0
    lines.push(`Your weight moved ${down ? 'down' : 'up'} ${num(Math.abs(review.weightChangeKg), 1)} kg.`)
  }

  if (present && !progress.reached && progress.remainingKg >= 0.1) {
    lines.push(`You're ${num(progress.remainingKg, 1)} kg from your current goal.`)
  }

  if (present && review.streak >= 3) {
    lines.push(`You have logged something ${review.streak} days in a row.`)
  }

  return lines.slice(0, 5)
}

/** Shown when the week is genuinely empty. */
export const NOTHING_YET =
  'Nothing logged this week yet. Anything you record will show up here.'

/** Shown when there is no previous week to compare against. */
export const NO_COMPARISON = 'Keep logging to unlock the comparison.'

export interface ComparisonRow {
  label: string
  value: string
  direction: 'up' | 'down' | 'flat'
  /** True when the movement is toward what the member is aiming for. */
  favourable: boolean
}

/**
 * Turns the raw deltas into labelled rows. Direction is which way the number
 * moved; `favourable` is whether that is the direction the member wants, which
 * for weight depends on their goal.
 */
export function comparisonRows(
  comparison: WeeklyComparison,
  progress: WeightProgress,
): ComparisonRow[] {
  const rows: ComparisonRow[] = []

  if (comparison.weight) {
    const goingDown = comparison.weight.current < 0
    rows.push({
      label: 'Weight',
      value: `${num(Math.abs(comparison.weight.current), 1)} kg this week`,
      direction: comparison.weight.current < 0 ? 'down' : comparison.weight.current > 0 ? 'up' : 'flat',
      favourable:
        progress.direction === 'losing'
          ? goingDown
          : progress.direction === 'gaining'
            ? !goingDown
            : Math.abs(comparison.weight.current) < 0.5,
    })
  }

  rows.push({
    label: 'Workouts',
    value: formatChange(comparison.workouts.change, 0),
    direction: comparison.workouts.direction,
    favourable: comparison.workouts.direction !== 'down',
  })

  rows.push({
    label: 'Steps',
    value: formatChange(comparison.steps.change, 0),
    direction: comparison.steps.direction,
    favourable: comparison.steps.direction !== 'down',
  })

  rows.push({
    label: 'Consistency',
    value: `${formatChange(comparison.consistency.change, 0)}%`,
    direction: comparison.consistency.direction,
    favourable: comparison.consistency.direction !== 'down',
  })

  return rows
}

function formatChange(change: number, digits: number): string {
  if (Math.abs(change) < 10 ** -digits / 2) return 'Same as last week'
  return `${change > 0 ? '+' : '−'}${num(Math.abs(change), digits)}`
}
