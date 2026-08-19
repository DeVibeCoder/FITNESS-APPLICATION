import type { DetectedFood, FoodUnit, VisionResult } from './types.ts'
import { ScanFailure } from './types.ts'

/**
 * Runtime validation of model output.
 *
 * A language model's JSON is untrusted input. Everything is checked, coerced
 * into range, and anything unrecognisable is dropped rather than passed on —
 * a malformed response must never reach the user as a confident food item.
 */

const UNITS: FoodUnit[] = ['g', 'ml', 'piece', 'slice', 'cup', 'tbsp', 'serving']

function asString(value: unknown, max = 120): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, max)
  return trimmed.length > 0 ? trimmed : null
}

function asNumber(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(parsed)) return null
  return Math.min(Math.max(parsed, min), max)
}

function asUnit(value: unknown): FoodUnit {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const direct = UNITS.find((unit) => unit === raw)
  if (direct) return direct
  // Tolerate the obvious variants a model reaches for.
  if (['gram', 'grams', 'gr'].includes(raw)) return 'g'
  if (['millilitre', 'milliliter', 'millilitres', 'milliliters'].includes(raw)) return 'ml'
  if (['pieces', 'pcs', 'item', 'items', 'whole'].includes(raw)) return 'piece'
  if (['slices'].includes(raw)) return 'slice'
  if (['cups'].includes(raw)) return 'cup'
  if (['tablespoon', 'tablespoons', 'tbs'].includes(raw)) return 'tbsp'
  return 'serving'
}

/** Strips a ```json fence if the model wrapped its answer in one. */
export function stripFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (fenced ? fenced[1] : text).trim()
}

export function parseVisionJson(text: string): unknown {
  try {
    return JSON.parse(stripFence(text))
  } catch {
    throw new ScanFailure('unreadable_response', 'The analysis came back in a form we could not read.')
  }
}

export function validateVisionResult(raw: unknown): VisionResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new ScanFailure('unreadable_response', 'The analysis came back empty.')
  }
  const source = raw as Record<string, unknown>
  const rawItems = Array.isArray(source.items) ? source.items : []

  const items: DetectedFood[] = []
  for (const entry of rawItems) {
    if (typeof entry !== 'object' || entry === null) continue
    const item = entry as Record<string, unknown>

    const name = asString(item.name)
    if (!name) continue // No name, no item. Never guess one.

    const quantity = asNumber(item.estimatedQuantity ?? item.quantity, 0.1, 5000)
    const confidence = asNumber(item.confidence, 0, 1)

    items.push({
      name,
      foodType: asString(item.likelyFoodType ?? item.foodType) ?? name,
      quantity: quantity ?? 100,
      unit: asUnit(item.unit),
      confidence: confidence ?? 0.4,
      alternatives: Array.isArray(item.alternatives)
        ? item.alternatives
            .map((alternative) => asString(alternative))
            .filter((alternative): alternative is string => alternative !== null)
            .slice(0, 4)
        : [],
      cookingMethod: asString(item.cookingMethod) ?? undefined,
      estimatedKcal: asNumber(item.estimatedKcal, 0, 5000) ?? undefined,
      estimatedProteinG: asNumber(item.estimatedProteinG, 0, 500) ?? undefined,
      estimatedCarbsG: asNumber(item.estimatedCarbsG, 0, 500) ?? undefined,
      estimatedFatG: asNumber(item.estimatedFatG, 0, 500) ?? undefined,
    })
    if (items.length >= 12) break // A plate has a plausible upper bound.
  }

  if (items.length === 0) {
    throw new ScanFailure(
      'no_food_found',
      'We could not make out any food in that photo.',
    )
  }

  const overall =
    asNumber(source.overallConfidence, 0, 1) ??
    items.reduce((sum, item) => sum + item.confidence, 0) / items.length

  return {
    items,
    mealDescription: asString(source.mealDescription, 200) ?? 'Meal',
    overallConfidence: overall,
    // Trust the model's own flag, but insist on confirmation whenever the
    // reading is weak regardless of what it claimed.
    needsUserConfirmation:
      source.needsUserConfirmation === true ||
      overall < 0.75 ||
      items.some((item) => item.confidence < 0.6),
  }
}
