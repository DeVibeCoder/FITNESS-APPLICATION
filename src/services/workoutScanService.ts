import type { ExerciseKind, WorkoutKind, WorkoutSource } from '@/models'
import { prepareImageForUpload } from '@/lib/image'

/**
 * Workout screenshot reading.
 *
 * The browser sends a compressed copy of the screenshot to our own endpoint,
 * which holds the provider credentials and does the work. No API key exists in
 * this bundle, and the UI has no idea which vision provider answered.
 *
 * Nothing here invents a value. Every field can come back undefined, and that
 * is the expected case rather than a failure — a workout app's summary screen
 * shows what it shows. The review form treats an absent field as a question
 * for the user, never as a zero.
 *
 * The screenshot itself is never persisted. It exists as an object URL for as
 * long as the review form is open, is downscaled into a transient base64
 * string for the one request, and is released on confirm, cancel or unmount.
 * The saved workout record contains structured fields only.
 */

/**
 * One exercise the screenshot listed.
 *
 * Shaped to drop straight into the manual log's own draft, so the review form
 * is the manual form and there is no second editor to keep in step.
 */
export interface ScannedExercise {
  name: string
  kind: ExerciseKind
  sets?: number
  reps?: number
  weightKg?: number
  durationSec?: number
  distanceKm?: number
}

export interface WorkoutScan {
  /** Which app the screenshot came from, when the chrome identified it. */
  app?: WorkoutSource
  /** The app's printed name, when it is not one we know. */
  appName?: string
  planName?: string
  dayNumber?: number
  workoutName?: string
  durationSec?: number
  caloriesKcal?: number
  exerciseCount?: number
  /** A date printed on the screen, yyyy-mm-dd. */
  date?: string
  /** What sort of session the screen described, when it was evident. */
  kind?: WorkoutKind
  /** The exercises the screen listed. Empty is the common, correct answer. */
  exercises: ScannedExercise[]
  /** 0–1, how legible the screenshot was. */
  confidence: number
  confidenceLevel: 'high' | 'medium' | 'low'
  /** Fields that were not legible. The review form points at these. */
  missing: string[]
  /** 'mock' only ever appears from an explicitly enabled dev server. */
  source: 'live' | 'mock'
  attempts: number
}

export class WorkoutScanError extends Error {
  readonly canRetry: boolean

  constructor(message: string, canRetry = true) {
    super(message)
    this.name = 'WorkoutScanError'
    this.canRetry = canRetry
  }
}

const MAX_BYTES = 12 * 1024 * 1024
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

/** Server error codes → something worth reading on a phone. */
const MESSAGES: Record<string, string> = {
  not_configured: 'Screenshot reading is not set up yet. You can still enter the workout yourself.',
  invalid_image: "That image couldn't be used. Try another screenshot.",
  too_large: 'That image is too large. Try a smaller one.',
  unauthorized: 'Screenshot reading is not set up correctly — the API key was rejected.',
  rate_limited: "We've hit today's limit. Try again later, or enter it yourself.",
  timeout: 'That took too long. Try again, or enter the workout yourself.',
  provider_failed: 'Screenshot reading is temporarily unavailable.',
  unreadable_response: "We couldn't read the result. Try again, or enter it yourself.",
  no_workout_found:
    "We couldn't find a workout summary in that image. Try the screen your app shows when a workout finishes.",
}

export const workoutScanService = {
  accept: ACCEPTED.join(','),

  validate(file: { type: string; size: number }): void {
    if (!ACCEPTED.includes(file.type)) {
      throw new WorkoutScanError("That file isn't an image we can read. Try a PNG or JPEG.", false)
    }
    if (file.size > MAX_BYTES) {
      throw new WorkoutScanError('That image is very large. Try a smaller one.', false)
    }
    if (file.size === 0) {
      throw new WorkoutScanError("That image couldn't be used. Try another one.", false)
    }
  },

  /**
   * Sends the screenshot for reading and returns what was actually legible.
   * Rejects with a `WorkoutScanError` carrying a message safe to show.
   *
   * Deliberately not cached. Food scanning caches by fingerprint because the
   * same plate photographed once should not be billed twice inside a session;
   * a workout screenshot is read once, reviewed and saved, so a cache would
   * only be a place for stale readings to live.
   */
  async analyzeScreenshot(
    file: File,
    options: { signal?: AbortSignal } = {},
  ): Promise<WorkoutScan> {
    this.validate(file)

    // Shrunk before it leaves the device: cheaper, faster, and no more of the
    // screen travels than the reading needs.
    const prepared = await prepareImageForUpload(file)

    let response: Response
    try {
      response = await fetch('/api/workout-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify({ imageBase64: prepared.base64, mimeType: prepared.mimeType }),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new WorkoutScanError('Cancelled.', false)
      }
      throw new WorkoutScanError(
        'Screenshot reading is temporarily unavailable. Check your connection.',
      )
    }

    if (!response.ok) {
      let code = 'provider_failed'
      try {
        code = (await response.json())?.error ?? code
      } catch {
        /* An unparseable error body is still just a failure. */
      }
      throw new WorkoutScanError(
        MESSAGES[code] ?? MESSAGES.provider_failed,
        code !== 'not_configured',
      )
    }

    const payload = await response.json()
    return {
      app: asSource(payload.app),
      appName: asText(payload.appName),
      planName: asText(payload.planName),
      dayNumber: asCount(payload.dayNumber),
      workoutName: asText(payload.workoutName),
      durationSec: asCount(payload.durationSec),
      caloriesKcal: asCount(payload.caloriesKcal),
      exerciseCount: asCount(payload.exerciseCount),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(payload.date ?? '')) ? String(payload.date) : undefined,
      kind: asKind(payload.kind),
      exercises: asExercises(payload.exercises),
      confidence: Number(payload.confidence) || 0,
      confidenceLevel: (payload.confidenceLevel as WorkoutScan['confidenceLevel']) ?? 'low',
      missing: Array.isArray(payload.missing) ? (payload.missing as string[]) : [],
      source: payload.source === 'mock' ? 'mock' : 'live',
      attempts: Number(payload.attempts) || 1,
    }
  },
}

const SOURCES: WorkoutSource[] = ['home_workout', 'lose_weight_men', 'other']
const KINDS: WorkoutKind[] = ['strength', 'cardio', 'general']

function asKind(value: unknown): WorkoutKind | undefined {
  return KINDS.find((kind) => kind === value)
}

/**
 * The server has already validated these; this is the same defensive pass the
 * rest of the file applies, because a response body is untrusted input on the
 * way in whoever produced it.
 */
function asExercises(value: unknown): ScannedExercise[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): ScannedExercise[] => {
    if (typeof entry !== 'object' || entry === null) return []
    const row = entry as Record<string, unknown>
    const name = asText(row.name)
    if (!name) return []
    return [
      {
        name,
        kind: row.kind === 'cardio' ? 'cardio' : 'strength',
        sets: asCount(row.sets),
        reps: asCount(row.reps),
        weightKg: asCount(row.weightKg),
        durationSec: asCount(row.durationSec),
        distanceKm: asCount(row.distanceKm),
      },
    ]
  })
}

function asSource(value: unknown): WorkoutSource | undefined {
  return SOURCES.find((source) => source === value)
}

/*
 * `undefined`, not a default. The whole point of the flow is that a field the
 * screenshot did not show arrives blank so the person can answer it — a `?? 0`
 * anywhere in this file would quietly turn "not visible" into "zero calories".
 */
function asText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function asCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return value
}

/** How many of the fields worth reading actually came back. */
export function scanCoverage(scan: WorkoutScan): { read: number; total: number } {
  const fields = [
    scan.planName,
    scan.dayNumber,
    scan.workoutName,
    scan.durationSec,
    scan.caloriesKcal,
    scan.exerciseCount,
  ]
  return { read: fields.filter((field) => field !== undefined).length, total: fields.length }
}
