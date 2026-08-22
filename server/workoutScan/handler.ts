import type { WorkoutScanResponse, WorkoutVisionProvider } from './types.ts'
import { legibility, WorkoutScanFailure } from './types.ts'
import { GeminiWorkoutVisionProvider } from './geminiVisionProvider.ts'
import { DevMockWorkoutVisionProvider } from './mockVisionProvider.ts'
import { withRetry } from '../shared/retry.ts'

/**
 * The workout-screenshot endpoint, as a plain function.
 *
 * Framework-agnostic on purpose: the Vite dev middleware and the serverless
 * entries both call this, so there is one implementation of the pipeline.
 *
 * The image lives in this function's arguments and nowhere else. It is not
 * written to disk, not cached, not logged, and is unreferenced the moment this
 * returns. The response carries structured fields only — there is no path by
 * which a screenshot reaches storage, here or in the browser.
 */

const MAX_BYTES = 6 * 1024 * 1024
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

export interface WorkoutScanRequestBody {
  imageBase64: string
  mimeType: string
}

export interface WorkoutProviders {
  vision: WorkoutVisionProvider
  source: 'live' | 'mock'
}

export type ScanEnv = Record<string, string | undefined>

/*
 * `globalThis.process?.env` rather than `process.env`. Node and the Vite dev
 * server have it; Cloudflare Workers do not, and referencing it bare there is
 * a ReferenceError at module load — before any request arrives, so the failure
 * would look like a broken deployment rather than a missing binding.
 */
const hostEnv = (): ScanEnv => (globalThis as { process?: { env?: ScanEnv } }).process?.env ?? {}

/**
 * Chooses providers from the environment.
 *
 * The same key as the food scanner, because it is the same vendor and the same
 * account — but its own mock flag, so turning one off for UI work does not
 * silently stub the other.
 *
 * The mock is never a fallback: if the real provider is unconfigured or fails,
 * the request fails and the user is told. Handing someone a workout they did
 * not do is worse than handing them an empty form.
 */
export function resolveWorkoutProviders(env: ScanEnv = hostEnv()): WorkoutProviders {
  if (env.WORKOUT_SCAN_MOCK === '1' && env.NODE_ENV !== 'production') {
    return { vision: new DevMockWorkoutVisionProvider(), source: 'mock' }
  }

  const geminiKey = env.GEMINI_API_KEY?.trim()
  if (!geminiKey) {
    throw new WorkoutScanFailure(
      'not_configured',
      'Screenshot reading is not configured on this server.',
    )
  }
  const model = env.GEMINI_MODEL?.trim() || undefined
  return { vision: new GeminiWorkoutVisionProvider(geminiKey, model), source: 'live' }
}

function decodeImage(body: WorkoutScanRequestBody): { base64: string; mimeType: string } {
  if (typeof body?.imageBase64 !== 'string' || typeof body?.mimeType !== 'string') {
    throw new WorkoutScanFailure('invalid_image', 'No screenshot was received.')
  }
  if (!ACCEPTED.includes(body.mimeType)) {
    throw new WorkoutScanFailure('invalid_image', "That file isn't an image we can read.")
  }
  // base64 is 4 characters per 3 bytes.
  const bytes = Math.floor((body.imageBase64.length * 3) / 4)
  if (bytes === 0) throw new WorkoutScanFailure('invalid_image', 'That screenshot was empty.')
  if (bytes > MAX_BYTES) {
    throw new WorkoutScanFailure('too_large', 'That screenshot is too large to analyse.')
  }

  return { base64: body.imageBase64, mimeType: body.mimeType }
}

/**
 * Runs the pipeline:
 *
 *   temporary image
 *     → vision transcription   (retried as a unit)
 *     → validation, which drops anything doubtful
 *     → structured fields plus a list of what was not legible
 *
 * There is no second stage. Unlike food, nothing has to be looked up: the
 * user's own app already did the counting, so a value is either on the screen
 * or it is the user's to supply.
 */
export async function runWorkoutScan(
  body: WorkoutScanRequestBody,
  providers: WorkoutProviders,
  signal?: AbortSignal,
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void,
): Promise<WorkoutScanResponse> {
  const image = decodeImage(body)

  const { value: read, attempts } = await withRetry(
    ({ timeoutMs }) => providers.vision.read(image, signal, timeoutMs),
    {
      attempts: 3,
      baseDelayMs: 1000,
      budgetMs: 90_000,
      signal,
      // The first call of a session stalls on a cold connection, so it gets a
      // shorter leash; later attempts are given more room.
      timeoutFor: (index) => [20_000, 30_000, 40_000][index] ?? 30_000,
      cancelled: () => new WorkoutScanFailure('timeout', 'Cancelled.', false),
      onRetry,
    },
  )

  return {
    app: read.app,
    appName: read.appName,
    planName: read.planName,
    dayNumber: read.dayNumber,
    workoutName: read.workoutName,
    durationSec: read.durationSec,
    caloriesKcal: read.caloriesKcal,
    exerciseCount: read.exerciseCount,
    date: read.date,
    confidence: Math.round(read.confidence * 100) / 100,
    confidenceLevel: legibility(read.confidence),
    missing: read.missing,
    // Not a computed flag. A screenshot reading is never saved unreviewed,
    // however legible it looked, so this is a constant and says so.
    needsReview: true,
    source: providers.source,
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
  no_workout_found: 422,
}

/**
 * Turns the pipeline into an HTTP response.
 *
 * Only a code and a short message cross the wire. Provider names, upstream
 * status text and stack traces stay on the server.
 */
export async function handleWorkoutScanRequest(
  body: unknown,
  signal?: AbortSignal,
  /*
   * Supplied by the host. Node and Vite leave it undefined and fall through to
   * process.env; Cloudflare Pages passes the Function's bindings, which is the
   * only way a Worker ever sees a secret.
   */
  env?: ScanEnv,
): Promise<{ status: number; body: unknown }> {
  const started = Date.now()
  let providerName = 'unknown'
  try {
    const providers = resolveWorkoutProviders(env)
    providerName = providers.vision.name
    let retries = 0
    const result = await runWorkoutScan(
      body as WorkoutScanRequestBody,
      providers,
      signal,
      (info) => {
        retries += 1
        logScan({
          ok: false,
          provider: providerName,
          ms: Date.now() - started,
          errorCode: info.reason,
          attempt: info.attempt,
          retryInMs: info.delayMs,
        })
      },
    )
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
      error instanceof WorkoutScanFailure
        ? error
        : new WorkoutScanFailure('provider_failed', 'Screenshot reading is temporarily unavailable.')
    logScan({
      ok: false,
      provider: providerName,
      ms: Date.now() - started,
      errorCode: failure.code,
    })
    return {
      status: STATUS[failure.code] ?? 500,
      body: { error: failure.code, message: failure.message },
    }
  }
}

/**
 * Deliberately narrow. The screenshot, the request body and the model's answer
 * are never written anywhere — only whether it worked, how long it took and
 * what category of thing went wrong.
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
  console.info('[workout-scan]', JSON.stringify({ ...entry, at: new Date().toISOString() }))
}
