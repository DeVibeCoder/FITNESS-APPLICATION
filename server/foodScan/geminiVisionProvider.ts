import type { FoodVisionProvider, VisionResult } from './types.ts'
import { ScanFailure } from './types.ts'
import { parseVisionJson, validateVisionResult } from './validate.ts'

/**
 * Google Gemini food identification.
 *
 * The API key is read from the environment inside this module and never leaves
 * the server. Nothing about the image is logged or retained: it is passed
 * through to the provider and dropped when the request ends.
 */

/**
 * The classic `:generateContent` surface, verified working against the live API
 * with an inline image plus a response schema. The newer `/v1beta/interactions`
 * endpoint accepts the same key but answers with a different envelope and did
 * not return within 30s for an image request, so it is not used here.
 */
const endpointFor = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

/**
 * The instruction is the whole feature. Everything here exists to stop the
 * model doing the thing that made the old mock unacceptable — answering with a
 * plausible meal instead of the meal in front of it.
 */
const SYSTEM_PROMPT = `You identify food in a photograph for a nutrition log. This is a careful classification task, not a creative one.

Rules, in order of importance:
1. Look at THIS photograph and report only food you can actually see in it.
2. Never output a food you cannot see. Do not produce a typical, example or remembered meal. You have no memory of previous images — every photograph is judged only on its own contents. If the image shows steak, you must not report oats.
3. If the image contains no food at all, return an empty items array. An empty answer is correct and useful; a fabricated one is not.
4. List each distinct food separately. A plate of steak, rice and salad is three items, not one "mixed meal".
5. Portion size cannot be measured from a photograph. Estimate from visual cues such as plate and utensil size. Approximation is expected; false precision is not. Never imply you have weighed anything.
6. Do not force a match. If you are unsure what a food is, give your best reading, lower the confidence accordingly, and list other plausible readings in "alternatives". Declared uncertainty is far more useful than a confident wrong answer.
7. State cookingMethod only when it is visible or clearly implied (grill marks, batter, oil sheen). Otherwise omit it — do not infer hidden preparation as fact.
8. Do not estimate hidden oil, butter, sauce or dressing as a separate quantity unless it is plainly visible. The user adds those.
9. Be consistent: the same photograph should produce the same reading every time.
10. Also give typical nutrition for the portion you estimated: estimatedKcal, estimatedProteinG, estimatedCarbsG, estimatedFatG. These are a fallback for when our nutrition database has no good match, so use ordinary published values for that food and portion. Plain meat has no carbohydrate; plain rice has little fat. Do not return zeroes unless the food genuinely contains none.

confidence is 0 to 1 and should reflect genuine visual certainty. Set needsUserConfirmation to true whenever any item is below 0.6, or the scene is cluttered, dark, blurry or ambiguous.`


const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          likelyFoodType: { type: 'string' },
          estimatedQuantity: { type: 'number' },
          unit: { type: 'string', enum: ['g', 'ml', 'piece', 'slice', 'cup', 'tbsp', 'serving'] },
          confidence: { type: 'number' },
          cookingMethod: { type: 'string' },
          alternatives: { type: 'array', items: { type: 'string' } },
          estimatedKcal: { type: 'number' },
          estimatedProteinG: { type: 'number' },
          estimatedCarbsG: { type: 'number' },
          estimatedFatG: { type: 'number' },
        },
        required: ['name', 'estimatedQuantity', 'unit', 'confidence'],
      },
    },
    mealDescription: { type: 'string' },
    overallConfidence: { type: 'number' },
    needsUserConfirmation: { type: 'boolean' },
  },
  required: ['items', 'overallConfidence', 'needsUserConfirmation'],
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] }
    finishReason?: string
  }[]
  promptFeedback?: { blockReason?: string }
}

/**
 * Pulls the answer out of the response.
 *
 * Thinking models return several parts per candidate — the reasoning trace
 * carries a `thoughtSignature` and no `text`, so joining the text parts yields
 * the JSON and nothing else.
 */
function extractText(payload: GeminiResponse): string {
  if (payload.promptFeedback?.blockReason) {
    throw new ScanFailure('invalid_image', 'That photo could not be analysed.')
  }

  const candidate = payload.candidates?.[0]
  const text = (candidate?.content?.parts ?? [])
    .map((part) => part.text)
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('')

  if (!text) {
    // A truncated answer is a different problem from an empty one, but both
    // reach the user the same way: we could not read the result.
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
      throw new ScanFailure('unreadable_response', 'The analysis did not finish.')
    }
    throw new ScanFailure('unreadable_response', 'The analysis came back empty.')
  }
  return text
}

export class GeminiFoodVisionProvider implements FoodVisionProvider {
  readonly name = 'gemini'

  private readonly apiKey: string
  private readonly model: string
  private readonly timeoutMs: number

  constructor(
    apiKey: string,
    model = process.env.GEMINI_MODEL ?? 'gemini-3.6-flash',
    timeoutMs = 30_000,
  ) {
    this.apiKey = apiKey
    this.model = model
    this.timeoutMs = timeoutMs
  }

  async identify(
    image: { base64: string; mimeType: string },
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<VisionResult> {
    const timeout = AbortSignal.timeout(timeoutMs ?? this.timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

    let response: Response
    try {
      response = await fetch(endpointFor(this.model), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        signal: combined,
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: SYSTEM_PROMPT },
                {
                  text: 'Identify the food visible in this photograph and estimate the portions.',
                },
                { inline_data: { mime_type: image.mimeType, data: image.base64 } },
              ],
            },
          ],
          generationConfig: {
            response_mime_type: 'application/json',
            response_schema: RESPONSE_SCHEMA,
            // Identification is extraction, not writing. Near-zero temperature
            // keeps the same photograph returning the same reading.
            temperature: 0.1,
            topP: 0.95,
          },
        }),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new ScanFailure('timeout', 'The analysis took too long.')
      }
      if (error instanceof Error && error.name === 'AbortError') {
        // The user walked away. Nothing to retry.
        throw new ScanFailure('timeout', 'The analysis was cancelled.', false)
      }
      throw new ScanFailure('provider_failed', 'Could not reach the analysis service.')
    }

    if (!response.ok) {
      // The provider's own message is never forwarded — it can contain request
      // details, and it is not written for the person holding the phone. It is
      // read only to tell one kind of failure from another.
      let detail = ''
      try {
        detail = (await response.text()).slice(0, 500)
      } catch {
        /* No body is fine; the status alone still classifies it. */
      }

      if (response.status === 401 || response.status === 403) {
        throw new ScanFailure('unauthorized', 'The analysis service rejected our credentials.')
      }
      if (response.status === 429 || response.status === 408) {
        throw new ScanFailure('rate_limited', 'The analysis service is busy.')
      }
      if (response.status >= 500) {
        // 500/502/503/504 — the service is momentarily unwell, so this is worth
        // another go.
        throw new ScanFailure('provider_failed', 'The analysis service is unavailable.')
      }
      if (response.status === 404) {
        throw new ScanFailure('not_configured', 'The configured vision model was not found.')
      }
      if (response.status === 400) {
        // Google answers a bad or missing key with 400, not 401. Blaming the
        // user's photo for our own misconfiguration would send them chasing the
        // wrong problem.
        if (/API_KEY_INVALID|API key not valid|UNAUTHENTICATED|PERMISSION_DENIED/i.test(detail)) {
          throw new ScanFailure('unauthorized', 'The analysis service rejected our credentials.')
        }
        if (/model|not found|NOT_FOUND/i.test(detail)) {
          throw new ScanFailure('not_configured', 'The configured vision model is unavailable.')
        }
        throw new ScanFailure('invalid_image', 'That photo could not be analysed.')
      }
      throw new ScanFailure('provider_failed', 'The analysis service is unavailable.')
    }

    const payload = (await response.json()) as GeminiResponse
    return validateVisionResult(parseVisionJson(extractText(payload)))
  }
}
