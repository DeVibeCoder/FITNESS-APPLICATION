import type { FitnessGoal, User } from '@/models'
import { goalLabel } from './calories'

/**
 * What each goal actually cares about.
 *
 * The dashboard is one design, not six. This only changes what gets promoted
 * to the top and what a card chooses to say — nobody gets a different app
 * because they want to gain weight instead of lose it.
 */
export type Emphasis = 'weight' | 'calories' | 'protein' | 'steps' | 'workouts' | 'consistency'

interface GoalProfile {
  /** Most important first. The Home column is ordered by this. */
  focus: Emphasis[]
  /** Short line under the person's name. */
  tagline: string
  /** Whether a target weight is a meaningful thing to show. */
  usesTargetWeight: boolean
  /** How to describe movement on the scale for this goal. */
  direction: 'down' | 'up' | 'steady'
}

const PROFILES: Record<FitnessGoal, GoalProfile> = {
  lose_weight: {
    focus: ['weight', 'calories', 'steps', 'workouts'],
    tagline: 'Steady loss, week by week',
    usesTargetWeight: true,
    direction: 'down',
  },
  build_muscle: {
    focus: ['protein', 'weight', 'workouts', 'calories'],
    tagline: 'Eat enough, train often',
    usesTargetWeight: true,
    direction: 'up',
  },
  gain_weight: {
    focus: ['weight', 'calories', 'protein', 'consistency'],
    tagline: 'Above maintenance, consistently',
    usesTargetWeight: true,
    direction: 'up',
  },
  maintain: {
    focus: ['consistency', 'weight', 'workouts', 'steps'],
    tagline: 'Hold the line',
    usesTargetWeight: true,
    direction: 'steady',
  },
  improve_fitness: {
    focus: ['workouts', 'steps', 'consistency', 'weight'],
    tagline: 'Move more, feel better',
    usesTargetWeight: false,
    direction: 'steady',
  },
  general_fitness: {
    focus: ['consistency', 'steps', 'workouts', 'calories'],
    tagline: 'Keep showing up',
    usesTargetWeight: false,
    direction: 'steady',
  },
}

export function goalProfile(goal: FitnessGoal): GoalProfile {
  return PROFILES[goal] ?? PROFILES.maintain
}

/** True when this metric is one of the goal's headline concerns. */
export function emphasises(goal: FitnessGoal, metric: Emphasis): boolean {
  return goalProfile(goal).focus.slice(0, 2).includes(metric)
}

/**
 * The line under someone's name: what they are working on, in their words
 * rather than the app's. Used on both the profile and member screens.
 */
export function goalHeadline(user: Pick<User, 'goal'>): string {
  return goalLabel(user.goal)
}

/**
 * Progress toward the person's own target, signed so that positive is always
 * "the right way". Someone gaining and someone cutting both read as progress.
 */
export function movementTowardGoal(user: Pick<User, 'startWeightKg' | 'targetWeightKg'>, currentKg: number): number {
  if (user.targetWeightKg < user.startWeightKg) return user.startWeightKg - currentKg
  if (user.targetWeightKg > user.startWeightKg) return currentKg - user.startWeightKg
  // Maintaining: any drift away from the start counts against you.
  return -Math.abs(currentKg - user.startWeightKg)
}

/** How far is left, never negative once the target is met. */
export function remainingToGoal(
  user: Pick<User, 'startWeightKg' | 'targetWeightKg'>,
  currentKg: number,
): number {
  if (user.targetWeightKg === user.startWeightKg) return 0
  return Math.max(0, Math.abs(user.targetWeightKg - currentKg))
}
