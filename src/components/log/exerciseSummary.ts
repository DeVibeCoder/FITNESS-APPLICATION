import type { LoggedExercise } from '@/models'
import { duration, num, parseDuration } from '@/utils/format'

/**
 * One logged exercise as a single line: "3 × 12 · 60 kg", "3 × 45 sec",
 * "20:00 · 4.2 km".
 *
 * It lives in its own module because both the form that writes an exercise and
 * the card that reads it back have to describe it identically — one
 * description, one place — and because a component file that also exports a
 * plain function stops React Fast Refresh working.
 *
 * Only what is there is said. An exercise with sets but no weight reads
 * "3 sets"; one with nothing at all reads as an empty string, which the caller
 * renders as nothing rather than as a row of dashes.
 */
export function summarise(
  exercise: Pick<
    LoggedExercise,
    'kind' | 'sets' | 'reps' | 'weightKg' | 'durationSec' | 'distanceKm'
  >,
): string {
  const parts: string[] = []
  if (exercise.kind === 'strength') {
    if (exercise.sets && exercise.reps) parts.push(`${exercise.sets} × ${exercise.reps}`)
    else if (exercise.sets) parts.push(`${exercise.sets} sets`)
    else if (exercise.reps) parts.push(`${exercise.reps} reps`)
    if (exercise.weightKg) parts.push(`${num(exercise.weightKg, exercise.weightKg % 1 ? 1 : 0)} kg`)
  } else if (exercise.kind === 'timed') {
    /*
     * "3 × 45 sec", which is how a plank is written down everywhere else. The
     * multiplication is sets against the hold, so the hold is spelled out in
     * its own units rather than as a clock: 45 sec reads as a hold, 00:45
     * reads as a lap time.
     */
    const hold = exercise.durationSec ? holdLabel(exercise.durationSec) : ''
    if (exercise.sets && hold) parts.push(`${exercise.sets} × ${hold}`)
    else if (hold) parts.push(hold)
    else if (exercise.sets) parts.push(`${exercise.sets} sets`)
    if (exercise.weightKg) parts.push(`${num(exercise.weightKg, exercise.weightKg % 1 ? 1 : 0)} kg`)
  } else {
    if (exercise.durationSec) parts.push(duration(exercise.durationSec))
    if (exercise.distanceKm) parts.push(`${num(exercise.distanceKm, 1)} km`)
  }
  return parts.join(' · ')
}

/**
 * A hold, in the units it is counted in.
 *
 * Under two minutes is seconds, because that is what the screen it came from
 * said and what the person counted; longer than that is a clock, because
 * "150 sec" is nobody's idea of two and a half minutes.
 */
export function holdLabel(seconds: number): string {
  if (seconds < 120) return `${Math.round(seconds)} sec`
  return duration(seconds)
}

/**
 * What a hold field shows while it is being edited.
 *
 * The bare number for a hold under two minutes — typing "45" and being shown
 * "45 sec" back would fight the cursor — and a clock beyond that.
 */
export function holdValue(seconds: number): string {
  return seconds < 120 ? String(Math.round(seconds)) : duration(seconds)
}

/**
 * Reads a hold as somebody would write one.
 *
 * A bare number is seconds here, which is the opposite of the session-length
 * field where a bare number is minutes — and correct in both places: nobody
 * plans a 45-minute plank or a 30-second workout. "45", "45 sec", "45s" and
 * "1:30" all land where they should.
 */
export function parseHold(input: string): number | null {
  const text = input.trim().toLowerCase()
  if (!text) return null
  if (text.includes(':')) return parseDuration(text)

  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes)?$/)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return null
  const minutes = match[2]?.startsWith('m') === true
  return Math.round(minutes ? value * 60 : value)
}
