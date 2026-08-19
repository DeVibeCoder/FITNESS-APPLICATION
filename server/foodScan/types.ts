/**
 * Food scanning contracts.
 *
 * The vision provider identifies what is in the photo. The nutrition provider
 * turns those foods into numbers. Neither knows about the other, and the
 * frontend knows about neither — it only ever sees the merged result from
 * `/api/food-scan`.
 */

export type FoodUnit = 'g' | 'ml' | 'piece' | 'slice' | 'cup' | 'tbsp' | 'serving'

export interface DetectedFood {
  /** What the model believes it can see, e.g. "Grilled beef steak". */
  name: string
  /** Coarse category, used to bias the nutrition search. */
  foodType: string
  /** Approximate portion. A photograph cannot measure mass — this is a guess. */
  quantity: number
  unit: FoodUnit
  /** 0–1. Low values must reach the user as uncertainty, not as fact. */
  confidence: number
  /** Other plausible readings, offered to the user rather than discarded. */
  alternatives: string[]
  /** Only when visible or clearly inferable; never invented. */
  cookingMethod?: string
  /**
   * The model's own rough nutrition for the portion it estimated. Used only
   * when the database has no trustworthy row — an honest ballpark the user can
   * correct beats a zero, and beats numbers borrowed from a different food.
   */
  estimatedKcal?: number
  estimatedProteinG?: number
  estimatedCarbsG?: number
  estimatedFatG?: number
}

export interface VisionResult {
  items: DetectedFood[]
  mealDescription: string
  overallConfidence: number
  needsUserConfirmation: boolean
}

export interface FoodVisionProvider {
  readonly name: string
  /** `timeoutMs` lets the retry layer give later attempts a longer deadline. */
  identify(
    image: { base64: string; mimeType: string },
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<VisionResult>
}

export interface NutritionFacts {
  /** Per the requested quantity, not per 100 g. */
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
  /** The database entry actually used, so the user can see what was matched. */
  matchedName: string
  source: string
  /** 0–1, how well the match fits the detected food. */
  matchConfidence: number
}

export interface NutritionProvider {
  readonly name: string
  lookup(
    query: { name: string; foodType?: string; cookingMethod?: string; quantity: number; unit: FoodUnit },
    signal?: AbortSignal,
  ): Promise<NutritionFacts | null>
}

/** What the browser receives. Deliberately small — no provider internals. */
export interface ScanResponseItem {
  name: string
  quantity: number
  unit: FoodUnit
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
  confidence: number
  /** Banded recognition confidence, decided server-side. */
  confidenceLevel: ConfidenceLevel
  alternatives: string[]
  cookingMethod?: string
  matchedName?: string
  /**
   * How well the nutrition record fits the detected food. Deliberately separate
   * from `confidence`: the model can be certain it is steak while the database
   * match for "steak" is only so-so.
   */
  matchLevel?: ConfidenceLevel
  /**
   * Where the numbers came from:
   *   'database' — a USDA row that passed the match checks
   *   'estimate' — the vision model's own ballpark, needing a closer look
   *   'none'     — nothing usable; the user fills the fields in
   */
  nutritionFrom: 'database' | 'estimate' | 'none'
  /** Kept for readability at call sites; true only for 'database'. */
  fromDatabase: boolean
}

export interface ScanResponse {
  items: ScanResponseItem[]
  mealDescription: string
  overallConfidence: number
  needsUserConfirmation: boolean
  overallLevel: ConfidenceLevel
  estimated: true
  /** 'live' for real analysis; 'mock' only ever in an explicitly enabled dev build. */
  source: 'live' | 'mock'
  nutritionSource: string
  /** Vision requests actually made. 1 means it worked first time. */
  attempts: number
}

/** Error categories the frontend maps to human copy. */
export type ScanErrorCode =
  | 'not_configured'
  | 'invalid_image'
  | 'too_large'
  | 'unauthorized'
  | 'rate_limited'
  | 'timeout'
  | 'provider_failed'
  | 'unreadable_response'
  | 'no_food_found'

/**
 * Which failures are worth trying again.
 *
 * Transient: the same request could plausibly succeed in a moment.
 * Permanent: repeating it produces the same answer and spends quota to do so.
 */
const TRANSIENT_CODES: ScanErrorCode[] = [
  'timeout',
  'rate_limited',
  'provider_failed',
  // A model that returned unparseable JSON may well produce valid JSON on a
  // second generation, so this is worth one more go.
  'unreadable_response',
]

export class ScanFailure extends Error {
  readonly code: ScanErrorCode
  readonly transient: boolean

  constructor(code: ScanErrorCode, message: string, transient?: boolean) {
    super(message)
    this.name = 'ScanFailure'
    this.code = code
    this.transient = transient ?? TRANSIENT_CODES.includes(code)
  }
}

export type ConfidenceLevel = 'high' | 'medium' | 'low'

/**
 * Recognition confidence bands. Thresholds live here so the server decides once
 * and the UI simply renders the label — the two can never drift apart.
 */
export function confidenceLevel(value: number): ConfidenceLevel {
  if (value >= 0.8) return 'high'
  if (value >= 0.55) return 'medium'
  return 'low'
}
