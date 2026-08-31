import type { WorkoutVisionProvider, WorkoutVisionResult } from './types.ts'
import { WorkoutScanFailure } from './types.ts'
import { parseWorkoutJson, validateWorkoutResult } from './validate.ts'

/**
 * Google Gemini workout-screenshot reading.
 *
 * The API key is read from the environment inside this module and never leaves
 * the server. Nothing about the image is logged or retained: it is passed
 * through to the provider and dropped when the request ends.
 *
 * Structurally the twin of the food provider, and deliberately a separate file
 * rather than a shared one with a switch in it. The two ask the model for
 * different things — one interprets a photograph, the other transcribes a
 * screen — and the prompts are the feature, so they should be readable and
 * changeable on their own.
 */

const endpointFor = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

/**
 * The instruction is the whole feature.
 *
 * Everything here exists to stop the model being helpful in the one way that
 * would ruin this: filling a blank with a plausible number. The user's own
 * workout app has already counted; our job is to copy what it printed.
 */
const SYSTEM_PROMPT = `You read a screenshot from a fitness app and transcribe the workout summary it shows. This is transcription, not interpretation.

Rules, in order of importance:
1. Report only what is legible in THIS screenshot. Every value you return must be text you can actually see on the screen.
2. Never estimate, infer or complete a value. If the duration is not shown, omit durationSec. If calories are not shown, omit caloriesKcal. A missing field is the correct answer and the person will fill it in themselves; a plausible invented number is silently wrong and will be saved as fact.
3. Do not carry anything over from other images. You have no memory of previous screenshots.
4. app: "home_workout" for the Home Workout - No Equipment app, "lose_weight_men" for Lose Weight App for Men, otherwise "other" and put the app's printed name in appName. Only set this when the app is identifiable from its name or interface.
5. planName is the plan or programme, e.g. "Full Body Beginner", "Abs Beginner". workoutName is the individual session's name when the screen gives one that differs from the plan. If only one name appears, put it in planName and omit workoutName.
6. dayNumber is the number in "Day 15" and similar. Only when a day number is printed.
7. durationSec: give the duration exactly as printed, as a string, e.g. "23:14" or "1:05:30" or "23 min". Do not convert it. Do not estimate it from an exercise list.
8. caloriesKcal: the number of calories the app reported. Just the number.
9. exerciseCount: only when the screen states a count, or lists exercises you can count with certainty. Never guess from a plan name.
10. date: only if a calendar date is printed on the screen, formatted yyyy-mm-dd.
11. kind: "strength" when the screen is about sets and reps or named lifts, "cardio" when it is about a run, ride, swim, row or similar, "general" for anything else. Only when the screen makes it evident.
12. exercises: transcribe the exercise list ONLY if the screenshot actually lists individual exercises. Most summary screens do not — they show a name, a time and a calorie figure, and for those the correct answer is an empty array. For each row give the name exactly as printed, and only the numbers printed beside it:
    - "Squats 3 x 12" gives name "Squats", sets 3, reps 12. There is no weight on that line, so omit weightKg.
    - "Bench press 4 x 8 @ 60kg" gives sets 4, reps 8, weightKg 60.
    - "Treadmill 20:00 2.5 km" gives name "Treadmill", durationSec "20:00", distanceKm 2.5.
    - A row with only a name and no numbers is still worth returning; give the name and omit every number.
    Never split one exercise into several, never merge several into one, and never add an exercise that is not printed.
13. Set notAWorkout to true when the image is not a workout summary at all — a home screen, a menu, a photograph, a chat. Do not try to salvage a reading from it.
14. missing: list the names of the fields you could not read.

confidence is 0 to 1 and reflects how legible the screenshot was. A blurry, cropped or partially obscured screen should score low even if you managed to read some of it.`

/*
 * There is deliberately no `response_schema`.
 *
 * Constraining the response to one made this model markedly *worse* at the
 * job: on a summary screen printing "Day 12", "42:30", "318 kcal" and five
 * exercises, it returned the plan name and reported everything else as
 * unreadable — with a confidence of 1.0. The identical image and prompt
 * without the schema returns every field correctly, exercises included.
 *
 * Nothing is lost by dropping it. `response_mime_type` still forces JSON, and
 * the answer was never trusted anyway: `validateWorkoutResult` treats it as
 * hostile input, coerces every field into range and discards whatever will not
 * coerce. The schema was a second, weaker copy of a check we already do
 * properly — and it was costing us the readings.
 */

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
    throw new WorkoutScanFailure('invalid_image', 'That screenshot could not be analysed.')
  }

  const candidate = payload.candidates?.[0]
  const text = (candidate?.content?.parts ?? [])
    .map((part) => part.text)
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('')

  if (!text) {
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
      throw new WorkoutScanFailure('unreadable_response', 'The analysis did not finish.')
    }
    throw new WorkoutScanFailure('unreadable_response', 'The analysis came back empty.')
  }
  return text
}

export class GeminiWorkoutVisionProvider implements WorkoutVisionProvider {
  readonly name = 'gemini'

  private readonly apiKey: string
  private readonly model: string
  private readonly timeoutMs: number

  constructor(apiKey: string, model = 'gemini-3.6-flash', timeoutMs = 30_000) {
    this.apiKey = apiKey
    this.model = model
    this.timeoutMs = timeoutMs
  }

  async read(
    image: { base64: string; mimeType: string },
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<WorkoutVisionResult> {
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
                { text: 'Transcribe the workout summary shown in this screenshot.' },
                { inline_data: { mime_type: image.mimeType, data: image.base64 } },
              ],
            },
          ],
          generationConfig: {
            response_mime_type: 'application/json',
            // Transcription, not writing. Near-zero temperature keeps the same
            // screenshot returning the same reading.
            temperature: 0,
            topP: 0.95,
          },
        }),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new WorkoutScanFailure('timeout', 'The analysis took too long.')
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new WorkoutScanFailure('timeout', 'The analysis was cancelled.', false)
      }
      throw new WorkoutScanFailure('provider_failed', 'Could not reach the analysis service.')
    }

    if (!response.ok) {
      // The provider's own message is never forwarded — it can contain request
      // details, and it is not written for the person holding the phone.
      let detail = ''
      try {
        detail = (await response.text()).slice(0, 500)
      } catch {
        /* No body is fine; the status alone still classifies it. */
      }

      if (response.status === 401 || response.status === 403) {
        throw new WorkoutScanFailure('unauthorized', 'The analysis service rejected our credentials.')
      }
      if (response.status === 429 || response.status === 408) {
        throw new WorkoutScanFailure('rate_limited', 'The analysis service is busy.')
      }
      if (response.status >= 500) {
        throw new WorkoutScanFailure('provider_failed', 'The analysis service is unavailable.')
      }
      if (response.status === 404) {
        throw new WorkoutScanFailure('not_configured', 'The configured vision model was not found.')
      }
      if (response.status === 400) {
        // Google answers a bad or missing key with 400, not 401. Blaming the
        // user's screenshot for our own misconfiguration would send them
        // chasing the wrong problem.
        if (/API_KEY_INVALID|API key not valid|UNAUTHENTICATED|PERMISSION_DENIED/i.test(detail)) {
          throw new WorkoutScanFailure('unauthorized', 'The analysis service rejected our credentials.')
        }
        if (/model|not found|NOT_FOUND/i.test(detail)) {
          throw new WorkoutScanFailure('not_configured', 'The configured vision model is unavailable.')
        }
        throw new WorkoutScanFailure('invalid_image', 'That screenshot could not be analysed.')
      }
      throw new WorkoutScanFailure('provider_failed', 'The analysis service is unavailable.')
    }

    const payload = (await response.json()) as GeminiResponse
    return validateWorkoutResult(parseWorkoutJson(extractText(payload)))
  }
}
