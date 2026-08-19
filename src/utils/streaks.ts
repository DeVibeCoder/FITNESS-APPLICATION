import type { DateKey } from '@/models'
import { addDays, todayKey } from './date'

/**
 * Consecutive days ending today.
 *
 * Today not being logged yet does not break the streak — it is still early.
 * Only a fully missed yesterday does. This is deliberate: the app should nudge,
 * not punish.
 */
export function currentStreak(dates: Iterable<DateKey>, today: DateKey = todayKey()): number {
  const set = new Set(dates)
  let cursor = set.has(today) ? today : addDays(today, -1)
  let count = 0
  while (set.has(cursor)) {
    count += 1
    cursor = addDays(cursor, -1)
  }
  return count
}

export function longestStreak(dates: Iterable<DateKey>): number {
  const sorted = [...new Set(dates)].sort()
  let best = 0
  let run = 0
  let previous: DateKey | null = null
  for (const date of sorted) {
    run = previous && addDays(previous, 1) === date ? run + 1 : 1
    best = Math.max(best, run)
    previous = date
  }
  return best
}

/** True when the streak survives only if something is logged today. */
export function streakAtRisk(dates: Iterable<DateKey>, today: DateKey = todayKey()): boolean {
  const set = new Set(dates)
  return !set.has(today) && set.has(addDays(today, -1))
}
