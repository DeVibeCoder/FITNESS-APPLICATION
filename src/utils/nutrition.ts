import type { MacroTotals } from '@/services/nutritionService'
import type { MacroTargets } from './calories'
import { clamp, num } from './format'

export const FOOD_UNITS = ['g', 'ml', 'piece', 'slice', 'cup', 'tbsp', 'serving'] as const
export type FoodUnit = (typeof FOOD_UNITS)[number]

/** "150 g", "1 serving" — the display string stored alongside the numbers. */
export function formatPortion(quantity: number | undefined, unit: string | undefined): string {
  if (!quantity || !unit) return '1 serving'
  const rounded = Math.round(quantity * 10) / 10
  if (unit === 'g' || unit === 'ml') return `${num(rounded, rounded % 1 === 0 ? 0 : 1)} ${unit}`
  const plural = rounded === 1 ? unit : `${unit}s`
  return `${num(rounded, rounded % 1 === 0 ? 0 : 1)} ${plural}`
}

export interface CalorieStatus {
  label: string
  tone: 'under' | 'within' | 'over'
  remaining: number
  pct: number
}

/**
 * How today is going against the estimated target.
 *
 * "Within target" covers a deliberately wide band — an estimate accurate to a
 * few hundred calories cannot support a verdict on being fifty over. Nothing
 * here scolds; the labels are descriptive, not a grade.
 */
export function calorieStatus(consumed: number, target: number): CalorieStatus {
  const remaining = Math.round(target - consumed)
  const pct = target > 0 ? clamp((consumed / target) * 100, 0, 100) : 0
  // A 10% band either side of the target, floored at 100 kcal for small targets.
  const band = Math.max(100, target * 0.1)

  if (consumed === 0) return { label: 'Nothing logged yet', tone: 'under', remaining, pct }
  if (consumed > target + band) return { label: 'Above target', tone: 'over', remaining, pct }
  if (consumed < target - band) return { label: 'Under target', tone: 'under', remaining, pct }
  return { label: 'Within target', tone: 'within', remaining, pct }
}

export interface MacroProgress {
  key: 'protein' | 'carbs' | 'fat'
  label: string
  consumed: number
  target: number
  pct: number
}

export function macroProgress(totals: MacroTotals, targets: MacroTargets): MacroProgress[] {
  return [
    { key: 'protein' as const, label: 'Protein', consumed: totals.proteinG, target: targets.proteinG },
    { key: 'carbs' as const, label: 'Carbs', consumed: totals.carbsG, target: targets.carbsG },
    { key: 'fat' as const, label: 'Fat', consumed: totals.fatG, target: targets.fatG },
  ].map((row) => ({
    ...row,
    consumed: Math.round(row.consumed),
    pct: row.target > 0 ? clamp((row.consumed / row.target) * 100, 0, 100) : 0,
  }))
}

/**
 * Rough sanity check on a manually entered food, used only to warn — never to
 * block. Someone entering a real value we did not expect is right and we are
 * wrong.
 */
export function macrosLookOff(input: {
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
}): boolean {
  const fromMacros = input.proteinG * 4 + input.carbsG * 4 + input.fatG * 9
  if (fromMacros === 0 || input.kcal === 0) return false
  return Math.abs(fromMacros - input.kcal) > Math.max(120, input.kcal * 0.35)
}
