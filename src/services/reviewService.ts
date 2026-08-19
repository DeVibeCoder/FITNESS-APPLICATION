import { db } from '@/lib/db'
import type { DateKey, ID } from '@/models'
import { addDays, daysBetween, endOfWeek, startOfWeek, todayKey, weekDays } from '@/utils/date'
import type { ConsistencyResult } from '@/utils/consistency'
import { progressService, type UserSnapshot } from './progressService'
import { nutritionService } from './nutritionService'
import { workoutService } from './workoutService'

/**
 * Weekly review.
 *
 * Composes the existing progress, nutrition and workout services — nothing here
 * stores a second copy of anything. Every figure is recomputed from sessions,
 * steps, food, water, weights and check-ins on demand.
 */

export interface WeeklyReview {
  weekStart: DateKey
  weekEnd: DateKey
  daysElapsed: number
  weightChangeKg?: number
  workouts: number
  workoutGoal: number
  durationSec: number
  caloriesBurned: number
  steps: number
  avgStepsPerDay: number
  nutritionDays: number
  /** Only meaningful once there are days to average across. */
  avgCalories?: number
  waterMl: number
  checkinDays: number
  consistency: ConsistencyResult
  streak: number
  /** The day with the most training time, if any training happened. */
  bestDay?: { date: DateKey; durationSec: number }
}

export interface Delta {
  current: number
  previous: number
  change: number
  direction: 'up' | 'down' | 'flat'
}

export interface WeeklyComparison {
  /** False when the previous week has nothing to compare against. */
  available: boolean
  weight?: Delta
  workouts: Delta
  steps: Delta
  consistency: Delta
}

function delta(current: number, previous: number, epsilon = 0.001): Delta {
  const change = Math.round((current - previous) * 100) / 100
  return {
    current,
    previous,
    change,
    direction: change > epsilon ? 'up' : change < -epsilon ? 'down' : 'flat',
  }
}

export const reviewService = {
  async weeklyReview(userId: ID, dateInWeek: DateKey = todayKey()): Promise<WeeklyReview> {
    const from = startOfWeek(dateInWeek)
    const to = endOfWeek(dateInWeek)
    const today = todayKey()
    const daysElapsed = to <= today ? 7 : Math.min(7, Math.max(1, daysBetween(from, today) + 1))
    const dates = weekDays(dateInWeek)

    const [summary, consistency, streak, sessions, food, water, checkins] = await Promise.all([
      progressService.weeklySummary(userId, dateInWeek),
      progressService.consistency(userId, dateInWeek),
      progressService.streak(userId),
      workoutService.sessionsInRange(userId, from, to),
      nutritionService.history(userId, dates),
      db.water.where('[userId+date]').between([userId, from], [userId, to], true, true).toArray(),
      db.checkins.where('[userId+date]').between([userId, from], [userId, to], true, true).toArray(),
    ])

    const loggedDays = Object.values(food).filter((day) => day.entries > 0)
    const byDay = new Map<DateKey, number>()
    for (const session of sessions) {
      byDay.set(session.date, (byDay.get(session.date) ?? 0) + session.durationSec)
    }
    const best = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0]

    return {
      weekStart: from,
      weekEnd: to,
      daysElapsed,
      weightChangeKg: summary.weightChangeKg,
      workouts: summary.workouts,
      workoutGoal: summary.workoutGoal,
      durationSec: summary.durationSec,
      caloriesBurned: summary.caloriesBurned,
      steps: summary.steps,
      avgStepsPerDay: summary.avgStepsPerDay,
      nutritionDays: loggedDays.length,
      // Averaged only across days that were actually logged — dividing by seven
      // would report a number the person never ate.
      avgCalories: loggedDays.length
        ? Math.round(loggedDays.reduce((sum, day) => sum + day.kcal, 0) / loggedDays.length)
        : undefined,
      waterMl: water.reduce((sum, row) => sum + row.ml, 0),
      checkinDays: checkins.length,
      consistency,
      streak,
      bestDay: best ? { date: best[0], durationSec: best[1] } : undefined,
    }
  },

  /**
   * This week against last. Reports `available: false` rather than inventing a
   * baseline when the previous week has no activity at all.
   */
  async comparison(userId: ID, dateInWeek: DateKey = todayKey()): Promise<WeeklyComparison> {
    const previousWeek = addDays(startOfWeek(dateInWeek), -1)
    const [current, previous] = await Promise.all([
      this.weeklyReview(userId, dateInWeek),
      this.weeklyReview(userId, previousWeek),
    ])

    const hadActivity =
      previous.workouts > 0 || previous.steps > 0 || previous.nutritionDays > 0 || previous.checkinDays > 0

    return {
      available: hadActivity,
      weight:
        current.weightChangeKg !== undefined && previous.weightChangeKg !== undefined
          ? delta(current.weightChangeKg, previous.weightChangeKg, 0.05)
          : undefined,
      workouts: delta(current.workouts, previous.workouts),
      steps: delta(current.steps, previous.steps),
      consistency: delta(current.consistency.score, previous.consistency.score),
    }
  },

  /**
   * The group's week. Categories are chosen so members with opposite goals are
   * still comparable — nobody is ranked on kilograms.
   */
  async groupWeek(dateInWeek: DateKey = todayKey()): Promise<{
    label: string
    hint: string
    member: UserSnapshot
    value: string
  }[]> {
    const members = await progressService.groupSnapshot(dateInWeek)
    if (members.length === 0) return []

    const pick = (score: (m: UserSnapshot) => number) =>
      members.reduce((best, m) => (score(m) > score(best) ? m : best), members[0])

    const categories = [
      {
        label: 'Most consistent',
        hint: 'Highest share of the week logged',
        member: pick((m) => m.consistency.score),
        value: (m: UserSnapshot) => `${m.consistency.score}%`,
      },
      {
        label: 'Most workouts',
        hint: 'Sessions finished this week',
        member: pick((m) => m.workoutsThisWeek),
        value: (m: UserSnapshot) => `${m.workoutsThisWeek}`,
      },
      {
        label: 'Most steps',
        hint: 'Steps walked this week',
        member: pick((m) => m.stepsThisWeek),
        value: (m: UserSnapshot) => m.stepsThisWeek.toLocaleString(),
      },
      {
        label: 'Longest streak',
        hint: 'Days in a row with something logged',
        member: pick((m) => m.streak),
        value: (m: UserSnapshot) => `${m.streak} days`,
      },
      {
        label: 'Most improved',
        hint: "Furthest along their own goal, whichever direction it runs",
        member: pick((m) => m.progress.pct),
        value: (m: UserSnapshot) => `${Math.round(m.progress.pct)}%`,
      },
    ]

    return categories.map((category) => ({
      label: category.label,
      hint: category.hint,
      member: category.member,
      value: category.value(category.member),
    }))
  },
}
