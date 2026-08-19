import type { FoodUnit, NutritionFacts, NutritionProvider } from './types.ts'
import { COOKING_METHODS, pickBest, type MatchInput } from './match.ts'

/**
 * USDA FoodData Central nutrition lookup.
 *
 * The vision model says what the food is; this decides what that food contains.
 * Trusting the model's own calorie guess alone would compound two estimates,
 * and a reference database is better at the second one — but only if the row it
 * picks really is the photographed food, which is what `match.ts` enforces.
 *
 * The key is read on the server and never sent to the browser.
 */

const SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search'

/** FDC nutrient numbers, with names as a fallback for shape drift. */
const NUTRIENTS = {
  kcal: { ids: [1008, 2047, 2048], match: /^energy/i, unit: /kcal/i },
  proteinG: { ids: [1003], match: /^protein/i, unit: /g/i },
  fatG: { ids: [1004], match: /total lipid|^fat/i, unit: /g/i },
  carbsG: { ids: [1005], match: /carbohydrate/i, unit: /g/i },
} as const

/**
 * Rough grams for units a database cannot resolve on its own. These exist only
 * to scale per-100g figures into something editable — they are approximations,
 * surfaced with reduced match confidence, and the user can correct the portion.
 */
const GRAMS_PER_UNIT: Record<FoodUnit, number> = {
  g: 1,
  ml: 1, // Close enough for water-like foods; the user can adjust.
  piece: 120,
  slice: 30,
  cup: 240,
  tbsp: 15,
  serving: 150,
}

/**
 * Moves a trailing cooking method to the front, which is how the database
 * describes foods: "beef steak grilled" searches worse than "grilled beef
 * steak".
 *
 * Deliberately conservative. Unusual foods are left exactly as the vision model
 * named them — rewriting something we do not recognise is how a search ends up
 * matching the wrong thing.
 */
export function normalizeFoodName(name: string): string {
  const trimmed = name.trim().split(/\s+/).join(' ')
  const words = trimmed.split(' ')
  if (words.length < 2) return trimmed

  const last = words[words.length - 1].toLowerCase()
  if (COOKING_METHODS.includes(last)) {
    return [last, ...words.slice(0, -1)].join(' ')
  }
  return trimmed
}

interface FdcNutrient {
  nutrientId?: number
  nutrientName?: string
  unitName?: string
  value?: number
  nutrient?: { id?: number; name?: string; unitName?: string }
  amount?: number
}

interface FdcFood {
  fdcId: number
  description?: string
  dataType?: string
  foodNutrients?: FdcNutrient[]
}

/** Reads one nutrient, tolerating both the search and detail response shapes. */
function readNutrient(
  nutrients: FdcNutrient[],
  spec: (typeof NUTRIENTS)[keyof typeof NUTRIENTS],
): number {
  for (const entry of nutrients) {
    const id = entry.nutrientId ?? entry.nutrient?.id
    const name = entry.nutrientName ?? entry.nutrient?.name ?? ''
    const unit = entry.unitName ?? entry.nutrient?.unitName ?? ''
    const value = entry.value ?? entry.amount

    if (typeof value !== 'number') continue
    const idMatches = typeof id === 'number' && (spec.ids as readonly number[]).includes(id)
    const nameMatches = spec.match.test(name) && spec.unit.test(unit)
    if (idMatches || nameMatches) return value
  }
  return 0
}

export class FoodDataCentralNutritionProvider implements NutritionProvider {
  readonly name = 'usda-fdc'

  private readonly apiKey: string
  private readonly timeoutMs: number

  constructor(apiKey: string, timeoutMs = 12_000) {
    this.apiKey = apiKey
    this.timeoutMs = timeoutMs
  }

  /**
   * Searches, retrying its own transient failures.
   *
   * FoodData Central sits behind a gateway that intermittently answers a
   * perfectly valid request with an nginx `400 Bad Request` HTML page —
   * measured at roughly one in six identical calls. Treating that as a client
   * error is what left foods showing 0 kcal, so a non-JSON body is retried
   * rather than believed.
   */
  private async search(query: string, signal?: AbortSignal): Promise<FdcFood[]> {
    const params = new URLSearchParams({
      api_key: this.apiKey,
      query,
      pageSize: '15',
      dataType: 'Foundation,SR Legacy,Survey (FNDDS)',
    })

    for (let attempt = 1; attempt <= 3; attempt++) {
      if (signal?.aborted) return []
      try {
        const timeout = AbortSignal.timeout(this.timeoutMs)
        const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
        const response = await fetch(`${SEARCH_URL}?${params}`, { signal: combined })
        const contentType = response.headers.get('content-type') ?? ''

        if (response.ok && contentType.includes('json')) {
          const payload = (await response.json()) as { foods?: FdcFood[] }
          return payload.foods ?? []
        }
        // A JSON error body is a real rejection — the key or query is wrong and
        // repeating it changes nothing. An HTML body is the gateway misfiring.
        if (response.status < 500 && response.status !== 429 && contentType.includes('json')) {
          return []
        }
      } catch {
        if (signal?.aborted) return []
      }
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt + Math.random() * 300))
      }
    }
    return []
  }

  async lookup(
    query: {
      name: string
      foodType?: string
      cookingMethod?: string
      quantity: number
      unit: FoodUnit
    },
    signal?: AbortSignal,
  ): Promise<NutritionFacts | null> {
    const search = normalizeFoodName([query.cookingMethod, query.name].filter(Boolean).join(' '))
    const foods = await this.search(search, signal)
    if (foods.length === 0) return null

    const candidates: MatchInput[] = foods.map((food) => {
      const nutrients = food.foodNutrients ?? []
      return {
        description: food.description ?? '',
        dataType: food.dataType,
        per100: {
          kcal: readNutrient(nutrients, NUTRIENTS.kcal),
          proteinG: readNutrient(nutrients, NUTRIENTS.proteinG),
          carbsG: readNutrient(nutrients, NUTRIENTS.carbsG),
          fatG: readNutrient(nutrients, NUTRIENTS.fatG),
        },
      }
    })

    const best = pickBest(candidates, search)
    // No row cleared the bar. Returning nothing is correct here: the caller
    // falls back to the model's own estimate rather than to a plausible-looking
    // row that describes a different food.
    if (!best) return null

    const grams = query.quantity * (GRAMS_PER_UNIT[query.unit] ?? 100)
    const factor = grams / 100
    const { per100 } = best.candidate

    // A unit we had to guess at is a weaker match than a weight we were given.
    const unitPenalty = query.unit === 'g' || query.unit === 'ml' ? 0 : 0.2

    return {
      kcal: Math.round(per100.kcal * factor),
      proteinG: Math.round(per100.proteinG * factor),
      carbsG: Math.round(per100.carbsG * factor),
      fatG: Math.round(per100.fatG * factor),
      matchedName: best.candidate.description,
      source: 'USDA FoodData Central',
      matchConfidence: Math.max(0, Math.min(1, best.score) - unitPenalty),
    }
  }
}
