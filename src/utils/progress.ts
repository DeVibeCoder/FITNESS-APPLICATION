import type { BodyMeasurement, DateKey, WeightEntry } from '@/models'
import { clamp } from './format'
import { startOfWeek, endOfWeek, addDays, daysBetween } from './date'

export interface WeightProgress {
  startKg: number
  currentKg: number
  targetKg: number
  /** Positive means moved toward the goal, whichever direction that is. */
  changeKg: number
  remainingKg: number
  pct: number
  direction: 'losing' | 'gaining' | 'maintaining'
  reached: boolean
}

export function weightProgress(
  startKg: number,
  currentKg: number,
  targetKg: number,
): WeightProgress {
  const span = startKg - targetKg
  const moved = startKg - currentKg
  const direction = span > 0.1 ? 'losing' : span < -0.1 ? 'gaining' : 'maintaining'
  const pct = Math.abs(span) < 0.1 ? 100 : clamp((moved / span) * 100, 0, 100)
  const remaining = Math.max(0, Math.abs(currentKg - targetKg))
  return {
    startKg,
    currentKg,
    targetKg,
    // Rounded here rather than at each call site: 76.8 − 82 is 5.200000000000003
    // in binary floating point, and that must never reach a comparison or a label.
    changeKg: Math.round((currentKg - startKg) * 10) / 10,
    remainingKg: Math.round(remaining * 10) / 10,
    pct,
    direction,
    reached: direction === 'losing' ? currentKg <= targetKg : currentKg >= targetKg,
  }
}

/**
 * Newest first. Two entries can share a date — an official weigh-in in the
 * morning and a daily one that evening — so `createdAt` breaks the tie. Without
 * it the "current weight" would depend on insertion order, which is not a
 * decision the user made.
 */
function newestFirst(a: WeightEntry, b: WeightEntry): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  return a.createdAt < b.createdAt ? 1 : -1
}

/** The most recent entry on or before `date`. */
export function weightOn(entries: WeightEntry[], date: DateKey): WeightEntry | undefined {
  return entries.filter((e) => e.date <= date).sort(newestFirst)[0]
}

export function latestWeight(entries: WeightEntry[]): WeightEntry | undefined {
  return [...entries].sort(newestFirst)[0]
}

/** Change between the latest entry and the newest one at least `days` old. */
export function changeOver(entries: WeightEntry[], days: number, from: DateKey): number | null {
  const latest = weightOn(entries, from)
  if (!latest) return null
  const cutoff = new Date(from)
  cutoff.setDate(cutoff.getDate() - days)
  const y = cutoff.getFullYear()
  const m = `${cutoff.getMonth() + 1}`.padStart(2, '0')
  const d = `${cutoff.getDate()}`.padStart(2, '0')
  const earlier = weightOn(entries, `${y}-${m}-${d}`)
  if (!earlier || earlier.id === latest.id) return null
  return Math.round((latest.weightKg - earlier.weightKg) * 10) / 10
}

/**
 * Smooths day-to-day water-weight noise so the trend line reads as a trend
 * rather than a heart-rate monitor.
 */
export function movingAverage(values: number[], window = 3): number[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1)
    return slice.reduce((sum, v) => sum + v, 0) / slice.length
  })
}

/**
 * Named for what it actually is. `weightProgress` stays as the implementation
 * because it is what every existing caller imports; this is the general-purpose
 * alias for goals of any direction.
 */
export const goalProgress = weightProgress

// --- Official weigh-ins ----------------------------------------------------

export interface WeighInComparison {
  /** Weeks since the first official weigh-in, 1-based. */
  weekNumber: number
  thisWeek?: WeightEntry
  lastWeek?: WeightEntry
  changeKg?: number
}

/**
 * The weekly official weigh-in is what the group compares. Daily entries are
 * deliberately excluded so a bad morning on the scale never reads as a setback.
 */
export function weighInComparison(
  entries: WeightEntry[],
  dateInWeek: DateKey,
): WeighInComparison {
  const official = entries
    .filter((entry) => entry.kind === 'official')
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  const from = startOfWeek(dateInWeek)
  const to = endOfWeek(dateInWeek)
  const previousFrom = addDays(from, -7)

  const inRange = (start: DateKey, end: DateKey) =>
    official.filter((entry) => entry.date >= start && entry.date <= end).at(-1)

  const thisWeek = inRange(from, to)
  const lastWeek = inRange(previousFrom, addDays(from, -1))
  const weekNumber = official.length
    ? Math.floor(daysBetween(startOfWeek(official[0].date), from) / 7) + 1
    : 1

  return {
    weekNumber: Math.max(1, weekNumber),
    thisWeek,
    lastWeek,
    changeKg:
      thisWeek && lastWeek
        ? Math.round((thisWeek.weightKg - lastWeek.weightKg) * 10) / 10
        : undefined,
  }
}

/** Change between consecutive entries, newest first — for the history list. */
export function withDeltas(
  entries: WeightEntry[],
): { entry: WeightEntry; changeKg?: number }[] {
  const ordered = [...entries].sort((a, b) => (a.date < b.date ? 1 : -1))
  return ordered.map((entry, index) => {
    // Compare like with like: an official weigh-in against the previous
    // official one, a daily against the previous daily.
    const previous = ordered.slice(index + 1).find((other) => other.kind === entry.kind)
    return {
      entry,
      changeKg: previous
        ? Math.round((entry.weightKg - previous.weightKg) * 10) / 10
        : undefined,
    }
  })
}

// --- Body measurements -----------------------------------------------------

export type MeasurementField = 'waistCm' | 'chestCm' | 'hipsCm' | 'armCm' | 'thighCm' | 'bodyFatPct'

export interface MeasurementChange {
  field: MeasurementField
  first: number
  latest: number
  change: number
  firstDate: DateKey
  latestDate: DateKey
  points: { date: DateKey; value: number }[]
}

/**
 * Only reports on fields the user has actually recorded. Nothing is
 * interpolated and nothing is invented — a field with one entry reports a
 * change of zero and a single point, which the UI can choose not to chart.
 */
export function measurementChange(
  entries: BodyMeasurement[],
  field: MeasurementField,
): MeasurementChange | null {
  const points = entries
    .filter((entry) => typeof entry[field] === 'number')
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((entry) => ({ date: entry.date, value: entry[field] as number }))

  if (points.length === 0) return null
  const first = points[0]
  const latest = points[points.length - 1]
  return {
    field,
    first: first.value,
    latest: latest.value,
    change: Math.round((latest.value - first.value) * 10) / 10,
    firstDate: first.date,
    latestDate: latest.date,
    points,
  }
}
