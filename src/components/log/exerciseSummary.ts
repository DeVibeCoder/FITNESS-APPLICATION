import type { LoggedExercise } from '@/models'
import { duration, num } from '@/utils/format'

/**
 * One logged exercise as a single line: "3 × 12 · 60 kg", "20:00 · 4.2 km".
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
  } else {
    if (exercise.durationSec) parts.push(duration(exercise.durationSec))
    if (exercise.distanceKm) parts.push(`${num(exercise.distanceKm, 1)} km`)
  }
  return parts.join(' · ')
}
