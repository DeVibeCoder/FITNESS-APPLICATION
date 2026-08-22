import type { WorkoutAppId, WorkoutVisionResult } from './types.ts'
import { WorkoutScanFailure } from './types.ts'

/**
 * Runtime validation of model output.
 *
 * A language model's JSON is untrusted input. Everything is checked, coerced
 * into range, and anything unrecognisable is dropped rather than passed on.
 *
 * The bias here runs the opposite way to most validators: when a value is
 * doubtful it is *discarded*, not repaired. A blank field in the review form
 * costs the user one tap; a confidently wrong 480 kcal gets saved and quietly
 * corrupts a month of totals.
 */

const APPS: WorkoutAppId[] = ['home_workout', 'lose_weight_men', 'other']

/** Sanity ceilings. Anything past these is a misread, not a heroic session. */
const MAX_DURATION_SEC = 6 * 60 * 60
const MAX_KCAL = 5000
const MAX_EXERCISES = 60
const MAX_DAY = 400

function asString(value: unknown, max = 80): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, max)
  if (trimmed.length === 0) return undefined
  // Models reach for these when a field is absent. They are not answers.
  if (/^(n\/?a|none|null|unknown|not visible|-|—)$/i.test(trimmed)) return undefined
  return trimmed
}

function asNumber(value: unknown, min: number, max: number): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  if (!Number.isFinite(parsed)) return undefined
  if (parsed < min || parsed > max) return undefined
  return parsed
}

function asApp(value: unknown): WorkoutAppId | undefined {
  const raw = typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : ''
  const direct = APPS.find((app) => app === raw)
  if (direct) return direct
  if (/home_?workout/.test(raw)) return 'home_workout'
  if (/lose_?weight/.test(raw)) return 'lose_weight_men'
  return undefined
}

/**
 * Duration as printed. Workout apps show mm:ss far more often than seconds, so
 * both a clock string and a bare number are accepted — but a bare number is
 * read as seconds only when the model said so in `durationSec`.
 */
export function parseClock(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 && value <= MAX_DURATION_SEC ? Math.round(value) : undefined
  }
  const text = asString(value, 20)
  if (!text) return undefined

  const parts = text.split(':').map((part) => part.trim())
  if (parts.length >= 2 && parts.length <= 3 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    const numbers = parts.map(Number)
    const seconds =
      numbers.length === 3
        ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
        : numbers[0] * 60 + numbers[1]
    return seconds > 0 && seconds <= MAX_DURATION_SEC ? seconds : undefined
  }

  // "23 min", "1h 05m" — the other two shapes these screens use.
  const hours = text.match(/(\d{1,2})\s*h/i)
  const minutes = text.match(/(\d{1,3})\s*m(?!s)/i)
  if (hours || minutes) {
    const seconds = (Number(hours?.[1] ?? 0) * 60 + Number(minutes?.[1] ?? 0)) * 60
    return seconds > 0 && seconds <= MAX_DURATION_SEC ? seconds : undefined
  }
  return undefined
}

/** Strips a ```json fence if the model wrapped its answer in one. */
export function stripFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (fenced ? fenced[1] : text).trim()
}

export function parseWorkoutJson(text: string): unknown {
  try {
    return JSON.parse(stripFence(text))
  } catch {
    throw new WorkoutScanFailure(
      'unreadable_response',
      'The analysis came back in a form we could not read.',
    )
  }
}

const FIELDS = [
  'planName',
  'dayNumber',
  'workoutName',
  'durationSec',
  'caloriesKcal',
  'exerciseCount',
] as const

export function validateWorkoutResult(raw: unknown): WorkoutVisionResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new WorkoutScanFailure('unreadable_response', 'The analysis came back empty.')
  }
  const source = raw as Record<string, unknown>

  if (source.notAWorkout === true) {
    throw new WorkoutScanFailure(
      'no_workout_found',
      'That screenshot does not look like a workout summary.',
    )
  }

  const app = asApp(source.app)
  const result: WorkoutVisionResult = {
    app,
    appName: app === undefined ? asString(source.appName, 40) : undefined,
    planName: asString(source.planName),
    dayNumber: asNumber(source.dayNumber, 1, MAX_DAY),
    workoutName: asString(source.workoutName),
    durationSec: parseClock(source.durationSec ?? source.duration),
    caloriesKcal: asNumber(source.caloriesKcal, 1, MAX_KCAL),
    exerciseCount: asNumber(source.exerciseCount, 1, MAX_EXERCISES),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(source.date ?? '')) ? String(source.date) : undefined,
    confidence: asNumber(source.confidence, 0, 1) ?? 0.4,
    notAWorkout: false,
    missing: [],
  }

  if (result.dayNumber !== undefined) result.dayNumber = Math.round(result.dayNumber)
  if (result.exerciseCount !== undefined) result.exerciseCount = Math.round(result.exerciseCount)
  if (result.caloriesKcal !== undefined) result.caloriesKcal = Math.round(result.caloriesKcal)

  /*
   * `missing` is derived from what survived validation rather than taken from
   * the model. Otherwise a model that claims to have read a duration, and then
   * returns something unparseable, would leave the field blank *and* report it
   * as read — and the review form would not know to point at it.
   */
  result.missing = FIELDS.filter((field) => result[field] === undefined)

  // Nothing legible at all is a failure, not a blank form. The user should be
  // offered another go or the manual route, not asked to type everything into
  // a form that pretended to have scanned something.
  const read = FIELDS.length - result.missing.length
  if (read === 0) {
    throw new WorkoutScanFailure(
      'no_workout_found',
      'We could not read any workout details from that screenshot.',
    )
  }

  return result
}
