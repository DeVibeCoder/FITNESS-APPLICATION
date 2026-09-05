/**
 * Workouts, in the cloud.
 *
 * Talks to the fitness API and nothing else. It sends no user id, no role and
 * no ownership of any kind — the session cookie says who is asking, the
 * server decides what that means, and a payload claiming otherwise is simply
 * ignored on the other side.
 *
 * The API speaks snake_case rows straight out of D1; the application speaks
 * the camelCase shapes its screens have always used. The mapping lives here
 * so neither side has to know about the other, and so a column rename is one
 * file's problem.
 */
import type { DateKey, Difficulty, ExerciseKind, ID, LoggedExercise, WorkoutKind, WorkoutSession } from '@/models'

const BASE = '/api/fitness'

export class CloudWorkoutError extends Error {
  readonly code: string
  readonly status: number
  /** Which field the server objected to, when it said. */
  readonly field?: string

  constructor(code: string, message: string, status: number, field?: string) {
    super(message)
    this.name = 'CloudWorkoutError'
    this.code = code
    this.status = status
    this.field = field
  }
}

/** The row shape D1 returns. Kept separate from the domain model on purpose. */
interface SessionRow {
  id: string
  user_id: string
  date: string
  kind: string
  name: string
  status: string
  duration_sec: number
  calories_kcal: number
  exercise_count: number
  difficulty: string | null
  note: string | null
  logged_via: string
  started_at: string
  completed_at: string | null
  created_at: string
  updated_at: string
}

interface ExerciseRow {
  id: string
  session_id: string
  position: number
  name: string
  kind: string
  sets: number | null
  reps: number | null
  weight_kg: number | null
  duration_sec: number | null
  distance_km: number | null
  note: string | null
}

/** A row becomes the session shape the screens already render. */
function toSession(row: SessionRow): WorkoutSession {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date as DateKey,
    kind: row.kind as WorkoutKind,
    name: row.name,
    status: row.status as WorkoutSession['status'],
    durationSec: row.duration_sec,
    caloriesKcal: row.calories_kcal,
    exerciseCount: row.exercise_count,
    difficulty: (row.difficulty ?? undefined) as Difficulty | undefined,
    note: row.note ?? undefined,
    loggedVia: row.logged_via as WorkoutSession['loggedVia'],
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
  } as WorkoutSession
}

function toExercise(row: ExerciseRow): LoggedExercise {
  return {
    id: row.id,
    sessionId: row.session_id,
    order: row.position,
    name: row.name,
    kind: row.kind as ExerciseKind,
    // Null is how the database says "this kind does not carry that", and
    // undefined is how the application says it. Same statement, two dialects.
    sets: row.sets ?? undefined,
    reps: row.reps ?? undefined,
    weightKg: row.weight_kg ?? undefined,
    durationSec: row.duration_sec ?? undefined,
    distanceKm: row.distance_km ?? undefined,
    note: row.note ?? undefined,
  }
}

/**
 * An exercise on its way out.
 *
 * Only the fields its own kind may carry are sent. The server validates this
 * and the database constrains it, but sending a timed exercise with a weight
 * would be asking for a 400 that the caller could have avoided — and it keeps
 * the payload honest about what was actually recorded.
 */
function fromExercise(exercise: Omit<LoggedExercise, 'id' | 'sessionId' | 'order'>) {
  const base = { name: exercise.name, kind: exercise.kind, note: exercise.note ?? null }
  if (exercise.kind === 'timed') {
    return { ...base, sets: exercise.sets ?? null, durationSec: exercise.durationSec ?? null }
  }
  if (exercise.kind === 'cardio') {
    return { ...base, durationSec: exercise.durationSec ?? null, distanceKm: exercise.distanceKm ?? null }
  }
  return {
    ...base,
    sets: exercise.sets ?? null,
    reps: exercise.reps ?? null,
    weightKg: exercise.weightKg ?? null,
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    // Without this the session cookie is not sent and every call is anonymous.
    credentials: 'include',
  })

  if (response.status === 204) return undefined as T

  const text = await response.text()
  let payload: Record<string, unknown> = {}
  try {
    payload = text ? ((JSON.parse(text) as Record<string, unknown> | null) ?? {}) : {}
  } catch {
    // Not JSON means this was not the API — an unfinished deployment serving
    // the app shell, most likely. Treated as unavailable, not as a failure
    // the user did something to cause.
    throw new CloudWorkoutError('unavailable', 'Workout sync is not available right now.', response.status)
  }

  if (!response.ok) {
    throw new CloudWorkoutError(
      String(payload.error ?? 'request_failed'),
      // The server's own sentence. Database errors never reach here — the
      // API answers those as a generic message with the detail in its log.
      String(payload.message ?? 'That could not be saved. Try again.'),
      response.status,
      typeof payload.field === 'string' ? payload.field : undefined,
    )
  }
  return payload as T
}

export interface CloudWorkoutInput {
  date: DateKey
  kind: WorkoutKind
  name: string
  durationSec: number
  caloriesKcal?: number
  difficulty?: Difficulty
  note?: string
  exercises: Omit<LoggedExercise, 'id' | 'sessionId' | 'order'>[]
}

const toPayload = (input: CloudWorkoutInput) => ({
  date: input.date,
  kind: input.kind,
  name: input.name,
  durationSec: input.durationSec,
  caloriesKcal: input.caloriesKcal ?? 0,
  difficulty: input.difficulty ?? null,
  note: input.note ?? null,
  loggedVia: 'manual',
  exercises: input.exercises.filter((e) => e.name.trim().length > 0).map(fromExercise),
})

export const cloudWorkoutService = {
  async list(limit = 100): Promise<WorkoutSession[]> {
    const { sessions } = await call<{ sessions: SessionRow[] }>(`/workouts?limit=${limit}`)
    return (sessions ?? []).map(toSession)
  },

  async detail(sessionId: ID): Promise<{ session: WorkoutSession; exercises: LoggedExercise[] } | null> {
    try {
      const body = await call<{ session: SessionRow; exercises: ExerciseRow[] }>(`/workouts/${sessionId}`)
      return { session: toSession(body.session), exercises: (body.exercises ?? []).map(toExercise) }
    } catch (error) {
      // Somebody else's workout and a workout that never existed look the
      // same from here, which is the point.
      if (error instanceof CloudWorkoutError && error.status === 404) return null
      throw error
    }
  },

  async create(input: CloudWorkoutInput): Promise<ID> {
    const { id } = await call<{ id: string }>('/workouts', {
      method: 'POST',
      body: JSON.stringify(toPayload(input)),
    })
    return id
  },

  /** Replaces a workout in place. Never creates a second one. */
  async update(sessionId: ID, input: CloudWorkoutInput): Promise<void> {
    await call(`/workouts/${sessionId}`, { method: 'PATCH', body: JSON.stringify(toPayload(input)) })
  },

  async remove(sessionId: ID): Promise<void> {
    await call(`/workouts/${sessionId}`, { method: 'DELETE' })
  },

  async exercises(): Promise<unknown[]> {
    const { exercises } = await call<{ exercises: unknown[] }>('/exercises')
    return exercises ?? []
  },
}
