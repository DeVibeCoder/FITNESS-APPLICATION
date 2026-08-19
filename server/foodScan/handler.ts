import type {
  FoodVisionProvider,
  NutritionProvider,
  ScanResponse,
  ScanResponseItem,
} from './types.ts'
import { confidenceLevel, ScanFailure } from './types.ts'
import { GeminiFoodVisionProvider } from './geminiVisionProvider.ts'
import { FoodDataCentralNutritionProvider } from './fdcNutritionProvider.ts'
import { DevMockVisionProvider } from './mockVisionProvider.ts'
import { withRetry } from './retry.ts'

/**
 * The food-scan endpoint, as a plain function.
 *
 * Framework-agnostic on purpose: the Vite dev middleware and the serverless
 * entry both call this, so there is one implementation of the pipeline.
 *
 * The image lives in this function's arguments and nowhere else. It is not
 * written to disk, not cached, not logged, and is unreferenced the moment this
 * returns.
 */

const MAX_BYTES = 6 * 1024 * 1024
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

export interface ScanRequestBody {
  imageBase64: string
  mimeType: string
}

export interface Providers {
  vision: FoodVisionProvider
  nutrition: NutritionProvider | null
  source: 'live' | 'mock'
}

/**
 * Chooses providers from the environment.
 *
 * The mock is only ever reachable by explicitly setting FOOD_SCAN_MOCK=1 in a
 * development environment. It is never a fallback: if the real provider is
 * unconfigured or fails, the request fails and the user is told so. Showing
 * someone a sample meal while they believe it came from their photo is the
 * exact defect this endpoint exists to remove.
 */
export function resolveProviders(env: Record<string, string | undefined> = process.env): Providers {
  const geminiKey = env.GEMINI_API_KEY?.trim()
  const fdcKey = env.FDC_API_KEY?.trim()
  const nutrition = fdcKey ? new FoodDataCentralNutritionProvider(fdcKey) : null

  if (env.FOOD_SCAN_MOCK === '1' && env.NODE_ENV !== 'production') {
    return { vision: new DevMockVisionProvider(), nutrition, source: 'mock' }
  }

  if (!geminiKey) {
    throw new ScanFailure(
      'not_configured',
      'Food analysis is not configured on this server.',
    )
  }
  return { vision: new GeminiFoodVisionProvider(geminiKey), nutrition, source: 'live' }
}

function decodeImage(body: ScanRequestBody): { base64: string; mimeType: string } {
  if (typeof body?.imageBase64 !== 'string' || typeof body?.mimeType !== 'string') {
    throw new ScanFailure('invalid_image', 'No photo was received.')
  }
  if (!ACCEPTED.includes(body.mimeType)) {
    throw new ScanFailure('invalid_image', "That file isn't a photo we can read.")
  }
  // base64 is 4 characters per 3 bytes.
  const bytes = Math.floor((body.imageBase64.length * 3) / 4)
  if (bytes === 0) throw new ScanFailure('invalid_image', 'That photo was empty.')
  if (bytes > MAX_BYTES) throw new ScanFailure('too_large', 'That photo is too large to analyse.')

  return { base64: body.imageBase64, mimeType: body.mimeType }
}

/**
 * Runs the pipeline:
 *
 *   temporary image
 *     → vision identification   (retried as a unit)
 *     → name normalisation      (inside the nutrition provider)
 *     → nutrition lookup        (retried separately, never re-running vision)
 *     → portion-scaled result
 *
 * The two halves are deliberately independent. If the food was identified but
 * the nutrition database hiccups, the identification is kept and only the
 * lookup is retried — asking the model to look at the photograph again would
 * cost money to learn something already known.
 */
export async function runFoodScan(
  body: ScanRequestBody,
  providers: Providers,
  signal?: AbortSignal,
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void,
): Promise<ScanResponse> {
  const image = decodeImage(body)

  const { value: vision, attempts } = await withRetry(
    ({ timeoutMs }) => providers.vision.identify(image, signal, timeoutMs),
    {
      attempts: 3,
      baseDelayMs: 1000,
      budgetMs: 90_000,
      signal,
      // The first call of a session stalls on a cold connection, so it gets a
      // shorter leash; later attempts are given more room.
      timeoutFor: (index) => [20_000, 30_000, 40_000][index] ?? 30_000,
      onRetry,
    },
  )

  // One nutrition lookup per distinct food, however many times it appears.
  const cache = new Map<string, Awaited<ReturnType<NutritionProvider['lookup']>>>()
  const items: ScanResponseItem[] = []

  for (const detected of vision.items) {
    const key = `${detected.name}|${detected.cookingMethod ?? ''}|${detected.quantity}|${detected.unit}`
    if (!cache.has(key)) {
      cache.set(
        key,
        providers.nutrition
          ? await providers.nutrition.lookup(
              {
                name: detected.name,
                foodType: detected.foodType,
                cookingMethod: detected.cookingMethod,
                quantity: detected.quantity,
                unit: detected.unit,
              },
              signal,
            )
          : null,
      )
    }
    const facts = cache.get(key) ?? null

    // Database first, the model's own estimate second, blank last.
    //
    // A row that failed the match checks is never used — a steak must not
    // inherit the numbers from a steak sandwich. But "0 kcal" against a visible
    // piece of food is just as wrong, so an honest ballpark fills the gap and
    // says plainly that it is one.
    const estimate =
      detected.estimatedKcal && detected.estimatedKcal > 0
        ? {
            kcal: Math.round(detected.estimatedKcal),
            proteinG: Math.round(detected.estimatedProteinG ?? 0),
            carbsG: Math.round(detected.estimatedCarbsG ?? 0),
            fatG: Math.round(detected.estimatedFatG ?? 0),
          }
        : null
    const nutrition = facts ?? estimate
    const nutritionFrom: 'database' | 'estimate' | 'none' = facts
      ? 'database'
      : estimate
        ? 'estimate'
        : 'none'

    items.push({
      name: detected.name,
      quantity: Math.round(detected.quantity * 10) / 10,
      unit: detected.unit,
      kcal: nutrition?.kcal ?? 0,
      proteinG: nutrition?.proteinG ?? 0,
      carbsG: nutrition?.carbsG ?? 0,
      fatG: nutrition?.fatG ?? 0,
      confidence: Math.round(detected.confidence * 100) / 100,
      confidenceLevel: confidenceLevel(detected.confidence),
      alternatives: detected.alternatives,
      cookingMethod: detected.cookingMethod,
      matchedName: facts?.matchedName,
      matchLevel: facts ? confidenceLevel(facts.matchConfidence) : undefined,
      nutritionFrom,
      fromDatabase: facts !== null,
    })
  }

  return {
    items,
    mealDescription: vision.mealDescription,
    overallConfidence: Math.round(vision.overallConfidence * 100) / 100,
    overallLevel: confidenceLevel(vision.overallConfidence),
    needsUserConfirmation:
      vision.needsUserConfirmation ||
      items.some(
        (item) =>
          item.nutritionFrom !== 'database' ||
          item.confidenceLevel === 'low' ||
          item.matchLevel === 'low',
      ),
    estimated: true,
    source: providers.source,
    nutritionSource: providers.nutrition?.name ?? 'none',
    attempts,
  }
}

const STATUS: Record<string, number> = {
  not_configured: 503,
  invalid_image: 400,
  too_large: 413,
  unauthorized: 502,
  rate_limited: 429,
  timeout: 504,
  provider_failed: 502,
  unreadable_response: 502,
  no_food_found: 422,
}

/**
 * Turns the pipeline into an HTTP response.
 *
 * Only a code and a short message cross the wire. Provider names, upstream
 * status text and stack traces stay on the server.
 */
export async function handleFoodScanRequest(
  body: unknown,
  signal?: AbortSignal,
): Promise<{ status: number; body: unknown }> {
  const started = Date.now()
  let providerName = 'unknown'
  try {
    const providers = resolveProviders()
    providerName = providers.vision.name
    let retries = 0
    const result = await runFoodScan(body as ScanRequestBody, providers, signal, (info) => {
      retries += 1
      logScan({
        ok: false,
        provider: providerName,
        ms: Date.now() - started,
        errorCode: info.reason,
        attempt: info.attempt,
        retryInMs: info.delayMs,
      })
    })
    logScan({
      ok: true,
      provider: providerName,
      ms: Date.now() - started,
      attempt: result.attempts,
      ...(retries > 0 ? { recoveredAfterRetries: retries } : {}),
    })
    return { status: 200, body: result }
  } catch (error) {
    const failure =
      error instanceof ScanFailure
        ? error
        : new ScanFailure('provider_failed', 'Food analysis is temporarily unavailable.')
    logScan({
      ok: false,
      provider: providerName,
      ms: Date.now() - started,
      errorCode: failure.code,
    })
    return { status: STATUS[failure.code] ?? 500, body: { error: failure.code, message: failure.message } }
  }
}

/**
 * Deliberately narrow. The photo, the request body and the model's answer are
 * never written anywhere — only whether it worked, how long it took and what
 * category of thing went wrong.
 */
function logScan(entry: {
  ok: boolean
  provider: string
  ms: number
  errorCode?: string
  attempt?: number
  retryInMs?: number
  recoveredAfterRetries?: number
}): void {
  console.info('[food-scan]', JSON.stringify({ ...entry, at: new Date().toISOString() }))
}
