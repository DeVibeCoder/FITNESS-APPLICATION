import type { WorkoutSource } from '@/models'

/**
 * The apps the group actually trains in.
 *
 * Circuit does not run workouts — it records what happened in these. The user
 * sees "Workout App" everywhere; nothing calls this a provider or a platform.
 */
export const WORKOUT_APPS: {
  value: WorkoutSource
  label: string
  /** Fits on a chip in a 320px column. */
  short: string
  tint: string
}[] = [
  { value: 'home_workout', label: 'Home Workout', short: 'Home Workout', tint: '#3d6ea8' },
  { value: 'lose_weight_men', label: 'Lose Weight for Men', short: 'Lose Weight', tint: '#6b8f4e' },
  { value: 'other', label: 'Other', short: 'Other', tint: '#9a6bb0' },
]

const BY_VALUE = new Map(WORKOUT_APPS.map((app) => [app.value, app]))

/**
 * What to call a workout's origin.
 *
 * Sessions recorded by the built-in player predate external logging and have
 * no source at all, so they read as "Circuit" rather than pretending to have
 * come from somewhere else.
 */
export function workoutAppLabel(source?: WorkoutSource, sourceName?: string): string {
  if (!source) return 'Circuit'
  if (source === 'other') return sourceName?.trim() || 'Other app'
  return BY_VALUE.get(source)?.label ?? 'Other app'
}

export function workoutAppTint(source?: WorkoutSource): string {
  if (!source) return 'var(--accent)'
  return BY_VALUE.get(source)?.tint ?? '#9a6bb0'
}
