/**
 * Workout screenshot contracts.
 *
 * The premise is different from food scanning and the contracts follow from
 * it. A food photo is *interpreted*: portion sizes are estimated, a nutrition
 * database fills in what the photograph cannot say. A workout screenshot is
 * *read*: the other app has already done the counting and printed the answer,
 * so every field here is either visible on screen or absent.
 *
 * Nothing in this module estimates. A missing duration comes back missing.
 */

export type WorkoutAppId = 'home_workout' | 'lose_weight_men' | 'other'

/** Matches the app's own `WorkoutKind`. Repeated, not imported: the server
 *  shares no code with the browser bundle, and one enum in two places is
 *  cheaper than a dependency between them. */
export type ReadWorkoutKind = 'strength' | 'cardio' | 'general'

/**
 * One exercise line, as printed.
 *
 * Every number is optional and every one of them is either on the screen or
 * absent — the same rule the session-level fields follow. A row that reads
 * "Squats 3 x 12" yields sets and reps and nothing else; there is no third
 * number to infer and none is invented.
 *
 * `kind` decides which numbers the review form asks about, and is derived from
 * which ones were actually read rather than asked of the model, so it cannot
 * disagree with the row it labels.
 *
 * `timed` is the row that used to lose a number. "Plank 3 x 45 sec" carries a
 * set count like a strength row and a clock like a cardio one; classified as
 * either, the other's figure was thrown away on the way in. It is its own
 * shape now, and the only one that keeps both.
 */
export interface ReadExercise {
  name: string
  kind: 'strength' | 'timed' | 'cardio'
  sets?: number
  reps?: number
  weightKg?: number
  durationSec?: number
  distanceKm?: number
}

/**
 * What was legible in the screenshot.
 *
 * Every field is optional except the confidence, because every field can
 * genuinely be missing from a summary screen — and a blank the user fills in
 * is worth far more than a number we invented for them.
 */
export interface ReadWorkout {
  /** Which app the screenshot came from, if the chrome identifies it. */
  app?: WorkoutAppId
  /** The app's name as printed, when it is not one we know. */
  appName?: string
  /** The plan or programme, e.g. "Full Body Beginner". */
  planName?: string
  /** Day number within the plan, when the screen shows one. */
  dayNumber?: number
  /** The workout's own name, when it differs from the plan. */
  workoutName?: string
  /** Seconds. Parsed from mm:ss or hh:mm:ss on screen. */
  durationSec?: number
  /** Kilocalories, as the app reported them. */
  caloriesKcal?: number
  /** Number of exercises, only when the screen states or lists them. */
  exerciseCount?: number
  /** A date printed on the screen, ISO yyyy-mm-dd, when there is one. */
  date?: string
  /** What sort of session the screen describes, when it is evident. */
  kind?: ReadWorkoutKind
  /**
   * The exercises the screen actually lists.
   *
   * Empty when the summary gives only totals, which is the common case — a
   * finished-workout screen usually shows a name, a time and a calorie figure
   * and nothing else. An empty list is a correct reading, not a failure.
   */
  exercises?: ReadExercise[]
}

export interface WorkoutVisionResult extends ReadWorkout {
  /** 0–1, how legible the screenshot was overall. */
  confidence: number
  /** True when nothing usable was found — a photo of a cat, or a menu. */
  notAWorkout: boolean
  /** Field names the model could not read. Surfaced, never filled in. */
  missing: string[]
}

export interface WorkoutVisionProvider {
  readonly name: string
  /** `timeoutMs` lets the retry layer give later attempts a longer deadline. */
  read(
    image: { base64: string; mimeType: string },
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<WorkoutVisionResult>
}

/** What the browser receives. Deliberately small — no provider internals. */
export interface WorkoutScanResponse extends ReadWorkout {
  confidence: number
  /** Bands the confidence server-side so the UI cannot drift from the rules. */
  confidenceLevel: 'high' | 'medium' | 'low'
  /** Which of the fields above came back empty. */
  missing: string[]
  /**
   * Always true. The review form is not a formality — no screenshot reading is
   * saved without a person looking at it first.
   */
  needsReview: true
  /** 'mock' only ever appears from an explicitly enabled dev server. */
  source: 'live' | 'mock'
  /** Vision requests actually made. 1 means it worked first time. */
  attempts: number
}

/** Error categories the frontend maps to human copy. */
export type WorkoutScanErrorCode =
  | 'not_configured'
  | 'invalid_image'
  | 'too_large'
  | 'unauthorized'
  | 'rate_limited'
  | 'timeout'
  | 'provider_failed'
  | 'unreadable_response'
  | 'no_workout_found'

/**
 * Which failures are worth trying again.
 *
 * Transient: the same request could plausibly succeed in a moment.
 * Permanent: repeating it produces the same answer and spends quota to do so.
 */
const TRANSIENT_CODES: WorkoutScanErrorCode[] = [
  'timeout',
  'rate_limited',
  'provider_failed',
  'unreadable_response',
]

export class WorkoutScanFailure extends Error {
  readonly code: WorkoutScanErrorCode
  readonly transient: boolean

  constructor(code: WorkoutScanErrorCode, message: string, transient?: boolean) {
    super(message)
    this.name = 'WorkoutScanFailure'
    this.code = code
    this.transient = transient ?? TRANSIENT_CODES.includes(code)
  }
}

/**
 * Legibility bands. Thresholds live here so the server decides once and the UI
 * renders the label — the two can never drift apart.
 */
export function legibility(value: number): 'high' | 'medium' | 'low' {
  if (value >= 0.8) return 'high'
  if (value >= 0.55) return 'medium'
  return 'low'
}
