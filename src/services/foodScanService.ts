import type { MealSlot } from '@/models'
import type { FoodUnit } from '@/utils/nutrition'
import { prepareImageForUpload } from '@/lib/image'
import { fingerprintFile, readCached, writeCached } from '@/lib/scanCache'

/**
 * Food photo analysis.
 *
 * The browser sends a compressed copy of the photo to our own endpoint, which
 * holds the provider credentials and does the work. No API key exists in this
 * bundle, and the UI has no idea which vision or nutrition provider answered.
 *
 * There is no sample data in this file and no fallback to any. If analysis
 * fails, it fails — the caller shows an error and offers manual entry. Handing
 * someone a plausible meal that has nothing to do with their photograph is the
 * defect this module was rewritten to remove.
 */

export type ConfidenceLevel = 'high' | 'medium' | 'low'

export interface ScanItem {
  /** Stable id so the review list can be edited without re-keying. */
  id: string
  name: string
  quantity: number
  unit: FoodUnit
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
  /** 0–1 from the vision model. Surfaced, never hidden. */
  confidence: number
  /** Banded by the server so the UI and the rules cannot drift apart. */
  confidenceLevel: ConfidenceLevel
  /** Other readings the model considered plausible. */
  alternatives: string[]
  cookingMethod?: string
  /** The nutrition database entry used, when there was one. */
  matchedName?: string
  /**
   * How well that database entry fits — a different question from whether the
   * model recognised the food.
   */
  matchLevel?: ConfidenceLevel
  /** 'database' | 'estimate' | 'none' — where the numbers came from. */
  nutritionFrom: 'database' | 'estimate' | 'none'
  fromDatabase: boolean
}

export interface ScanResult {
  items: ScanItem[]
  mealDescription: string
  overallConfidence: number
  needsUserConfirmation: boolean
  overallLevel: ConfidenceLevel
  suggestedMeal: MealSlot
  /** 'mock' only ever appears from an explicitly enabled dev server. */
  source: 'live' | 'mock'
  nutritionSource: string
  /** Vision requests the server made. Above 1 means it recovered from a hiccup. */
  attempts: number
  /** True when this came from the session cache rather than a fresh analysis. */
  fromCache: boolean
}

/**
 * Where a scan currently is, as far as the browser can honestly tell.
 *
 * Only two of these are the browser's own work; the third is one request that
 * the server answers after doing several things inside it. There is
 * deliberately no invented "checking nutrition" step timed off a stopwatch —
 * a progress bar that is really a clock is a lie about what is happening.
 */
export type ScanStage = 'preparing' | 'analyzing'

export class ScanError extends Error {
  readonly canRetry: boolean

  constructor(message: string, canRetry = true) {
    super(message)
    this.name = 'ScanError'
    this.canRetry = canRetry
  }
}

const MAX_BYTES = 12 * 1024 * 1024
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

/** Server error codes → something worth reading on a phone. */
const MESSAGES: Record<string, string> = {
  not_configured: 'Food analysis is not set up yet. You can still enter the meal manually.',
  invalid_image: "That photo couldn't be used. Try another one.",
  too_large: 'That photo is too large. Try a smaller one.',
  unauthorized: 'Food analysis is not set up correctly — the API key was rejected.',
  rate_limited: "We've hit today's analysis limit. Try again later, or enter it manually.",
  timeout: 'That took too long. Try again, or enter the meal manually.',
  provider_failed: 'Food analysis is temporarily unavailable.',
  unreadable_response: "We couldn't read the result. Try again, or enter it manually.",
  no_food_found: "We couldn't make out any food in that photo. Try a clearer one.",
}

let counter = 0

export function suggestMeal(at: Date = new Date()): MealSlot {
  const hour = at.getHours()
  if (hour < 11) return 'breakfast'
  if (hour < 16) return 'lunch'
  if (hour < 21) return 'dinner'
  return 'snacks'
}

export const foodScanService = {
  /**
   * What the file input asks for.
   *
   * `image/*`, deliberately, rather than the list of types this service can
   * actually read. A specific MIME list makes Android Chrome fall back to the
   * generic intent chooser — which offers the camera — instead of the system
   * photo picker, so "Choose from device" opened a camera. The broad type
   * opens the gallery; anything unreadable is caught by `validate` below and
   * refused with a sentence, which is a far better trade than a picker that
   * launches the wrong thing.
   */
  accept: 'image/*',

  /** The types the pipeline can actually read, for validation and for tests. */
  readable: ACCEPTED.join(','),

  validate(file: { type: string; size: number }): void {
    if (!ACCEPTED.includes(file.type)) {
      throw new ScanError("That file isn't a photo we can read. Try a JPEG or PNG.", false)
    }
    if (file.size > MAX_BYTES) {
      throw new ScanError('That photo is very large. Try a smaller one.', false)
    }
    if (file.size === 0) {
      throw new ScanError("That photo couldn't be used. Try another one.", false)
    }
  },

  /**
   * Sends the photo for analysis and returns what was actually found in it.
   * Rejects with a `ScanError` carrying a message that is already safe to show.
   */
  async analyzeImage(
    file: File,
    options: {
      signal?: AbortSignal
      forceRefresh?: boolean
      /** Called as the flow moves between the stages it can actually see. */
      onStage?: (stage: ScanStage) => void
    } = {},
  ): Promise<ScanResult> {
    this.validate(file)

    // The same photograph should not produce a different answer — or a second
    // charge — within a session.
    const fingerprint = await fingerprintFile(file)
    if (!options.forceRefresh) {
      const cached = readCached<ScanResult>(fingerprint)
      if (cached) return { ...cached, fromCache: true }
    }

    // Shrunk before it leaves the device: cheaper, faster, and no more of the
    // photo travels than the analysis needs. On an older phone with a 12 MP
    // camera this is a second or two of real work, and it is the one part the
    // browser can name while it happens.
    options.onStage?.('preparing')
    const prepared = await prepareImageForUpload(file)

    options.onStage?.('analyzing')

    let response: Response
    try {
      response = await fetch('/api/food-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The endpoint costs a real Gemini call, so it requires an approved
        // session. Same-origin fetch omits cookies unless asked.
        credentials: 'include',
        signal: options.signal,
        body: JSON.stringify({ imageBase64: prepared.base64, mimeType: prepared.mimeType }),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ScanError('Scan cancelled.', false)
      }
      throw new ScanError('Food analysis is temporarily unavailable. Check your connection.')
    }

    if (!response.ok) {
      let code = 'provider_failed'
      try {
        code = (await response.json())?.error ?? code
      } catch {
        /* An unparseable error body is still just a failure. */
      }
      throw new ScanError(MESSAGES[code] ?? MESSAGES.provider_failed, code !== 'not_configured')
    }

    const payload = await response.json()
    const items: ScanItem[] = (payload.items ?? []).map((item: Record<string, unknown>) => ({
      id: `scan_${++counter}`,
      name: String(item.name ?? 'Food'),
      quantity: Number(item.quantity) || 0,
      unit: (item.unit as FoodUnit) ?? 'g',
      kcal: Number(item.kcal) || 0,
      proteinG: Number(item.proteinG) || 0,
      carbsG: Number(item.carbsG) || 0,
      fatG: Number(item.fatG) || 0,
      confidence: Number(item.confidence) || 0,
      confidenceLevel: (item.confidenceLevel as ConfidenceLevel) ?? 'low',
      alternatives: Array.isArray(item.alternatives) ? (item.alternatives as string[]) : [],
      cookingMethod: item.cookingMethod ? String(item.cookingMethod) : undefined,
      matchedName: item.matchedName ? String(item.matchedName) : undefined,
      matchLevel: item.matchLevel ? (item.matchLevel as ConfidenceLevel) : undefined,
      nutritionFrom: (item.nutritionFrom as ScanItem['nutritionFrom']) ?? 'none',
      fromDatabase: item.fromDatabase === true,
    }))

    if (items.length === 0) {
      throw new ScanError(MESSAGES.no_food_found)
    }

    const result: ScanResult = {
      items,
      mealDescription: String(payload.mealDescription ?? 'Meal'),
      overallConfidence: Number(payload.overallConfidence) || 0,
      overallLevel: (payload.overallLevel as ConfidenceLevel) ?? 'medium',
      needsUserConfirmation: payload.needsUserConfirmation !== false,
      suggestedMeal: suggestMeal(),
      source: payload.source === 'mock' ? 'mock' : 'live',
      nutritionSource: String(payload.nutritionSource ?? 'none'),
      attempts: Number(payload.attempts) || 1,
      fromCache: false,
    }

    // Only successful, validated analyses are remembered. Every path that
    // throws above leaves the cache untouched, so a failure never sticks and
    // the next attempt is a real one.
    writeCached(fingerprint, result)
    return result
  },
}

/**
 * Totals for the review screen, always recomputed from the item rows so the
 * headline can never disagree with the list under it.
 */
export function scanTotals(items: ScanItem[]) {
  return items.reduce(
    (totals, item) => ({
      kcal: totals.kcal + item.kcal,
      proteinG: totals.proteinG + item.proteinG,
      carbsG: totals.carbsG + item.carbsG,
      fatG: totals.fatG + item.fatG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  )
}
