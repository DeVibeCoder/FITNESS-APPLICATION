import type { ActivityLevel, FitnessGoal, Sex } from '@/models'

/**
 * BMI → BMR → TDEE → goal adjustment → daily target.
 *
 * Every number here is an estimate and the UI must say so. BMR uses
 * Mifflin-St Jeor, which is the usual choice when body-fat data is unavailable.
 */

export const ACTIVITY_LEVELS: {
  value: ActivityLevel
  label: string
  hint: string
  factor: number
}[] = [
  { value: 'sedentary', label: 'Sedentary', hint: 'Desk job, little exercise', factor: 1.2 },
  { value: 'light', label: 'Lightly active', hint: 'Light exercise 1–3 days/week', factor: 1.375 },
  { value: 'moderate', label: 'Moderately active', hint: 'Exercise 3–5 days/week', factor: 1.55 },
  { value: 'active', label: 'Very active', hint: 'Hard exercise 6–7 days/week', factor: 1.725 },
  { value: 'very_active', label: 'Athlete', hint: 'Training twice a day, or physical job', factor: 1.9 },
]

export const FITNESS_GOALS: {
  value: FitnessGoal
  label: string
  hint: string
  /** Multiplier applied to TDEE. */
  factor: number
  proteinPerKg: number
}[] = [
  { value: 'lose_weight', label: 'Lose weight', hint: 'A steady deficit you can hold', factor: 0.85, proteinPerKg: 1.8 },
  { value: 'maintain', label: 'Maintain', hint: 'Hold your current weight', factor: 1, proteinPerKg: 1.6 },
  { value: 'gain_weight', label: 'Gain weight', hint: 'Eat above maintenance', factor: 1.15, proteinPerKg: 1.8 },
  { value: 'build_muscle', label: 'Build muscle', hint: 'A small surplus plus training', factor: 1.1, proteinPerKg: 2 },
  { value: 'improve_fitness', label: 'Get fitter', hint: 'Feel better, move more', factor: 1, proteinPerKg: 1.6 },
  { value: 'general_fitness', label: 'Stay healthy', hint: 'No target, just keep moving', factor: 1, proteinPerKg: 1.5 },
]

export function activityFactor(level: ActivityLevel): number {
  return ACTIVITY_LEVELS.find((l) => l.value === level)?.factor ?? 1.375
}

export function goalMeta(goal: FitnessGoal) {
  return FITNESS_GOALS.find((g) => g.value === goal) ?? FITNESS_GOALS[1]
}

export function activityLabel(level: ActivityLevel): string {
  return ACTIVITY_LEVELS.find((l) => l.value === level)?.label ?? level
}

export function goalLabel(goal: FitnessGoal): string {
  return goalMeta(goal).label
}

export function ageFrom(birthDate: string, now: Date = new Date()): number {
  const [y, m, d] = birthDate.split('-').map(Number)
  let age = now.getFullYear() - y
  const beforeBirthday =
    now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)
  if (beforeBirthday) age -= 1
  return age
}

/** Mifflin-St Jeor resting energy expenditure, kcal/day. */
export function calcBmr(input: {
  weightKg: number
  heightCm: number
  age: number
  sex: Sex
}): number {
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age
  return Math.round(base + (input.sex === 'male' ? 5 : -161))
}

/**
 * Rounded to the nearest 10. A TDEE of "2,533 kcal" implies a precision this
 * formula does not have, and rounding here keeps the whole chain consistent:
 * a maintain goal then lands exactly on maintenance instead of four kcal below
 * it because the target was rounded and this was not.
 */
export function calcTdee(bmr: number, level: ActivityLevel): number {
  return Math.round((bmr * activityFactor(level)) / 10) * 10
}

export interface MacroTargets {
  proteinG: number
  carbsG: number
  fatG: number
}

export interface EnergyPlan {
  bmr: number
  tdee: number
  target: number
  /** Difference from maintenance; negative is a deficit. */
  adjustment: number
  macros: MacroTargets
}

export function calcEnergyPlan(input: {
  weightKg: number
  heightCm: number
  age: number
  sex: Sex
  activityLevel: ActivityLevel
  goal: FitnessGoal
  override?: number
}): EnergyPlan {
  const bmr = calcBmr(input)
  const tdee = calcTdee(bmr, input.activityLevel)
  const meta = goalMeta(input.goal)
  // Never recommend below a conservative floor, however aggressive the goal.
  const floor = input.sex === 'male' ? 1500 : 1200
  const target = input.override ?? Math.max(floor, Math.round((tdee * meta.factor) / 10) * 10)

  const proteinG = Math.round(input.weightKg * meta.proteinPerKg)
  const fatG = Math.round((target * 0.27) / 9)
  const carbsG = Math.max(0, Math.round((target - proteinG * 4 - fatG * 9) / 4))

  return {
    bmr,
    tdee,
    target,
    adjustment: target - tdee,
    macros: { proteinG, carbsG, fatG },
  }
}

/**
 * Energy burned during a session. MET × 3.5 × kg ÷ 200 = kcal/min.
 * An estimate, and shown as one.
 */
export function estimateWorkoutCalories(
  met: number,
  weightKg: number,
  durationSec: number,
): number {
  const minutes = durationSec / 60
  return Math.round(((met * 3.5 * weightKg) / 200) * minutes * 10) / 10
}
