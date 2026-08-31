import { db } from '@/lib/db'
import { uid, now } from '@/lib/id'
import type {
  DateKey,
  Difficulty,
  Exercise,
  ID,
  LoggedExercise,
  PlanDay,
  PlanEnrollment,
  SetResult,
  WorkoutExercise,
  WorkoutKind,
  WorkoutPlan,
  WorkoutSession,
  WorkoutSource,
} from '@/models'
import { daysBetween, todayKey } from '@/utils/date'
import { duration } from '@/utils/format'
import { currentStreak, longestStreak } from '@/utils/streaks'
import { estimateWorkoutCalories } from '@/utils/calories'
import { updateService } from './updateService'
import { assertOwner, assertOwnerOf } from './ownership'

export interface ResolvedExercise extends WorkoutExercise {
  exercise: Exercise
}

export interface ResolvedDay {
  plan: WorkoutPlan
  planDay: PlanDay
  dayNumber: number
  isRestDay: boolean
  exercises: ResolvedExercise[]
  estimatedMinutes: number
}

export interface WorkoutStats {
  total: number
  totalDurationSec: number
  totalCalories: number
  thisWeek: number
  thisMonth: number
  thisYear: number
  longestSessionSec: number
  averageDurationSec: number
  currentStreak: number
  longestStreak: number
}

/** Where the player is up to, derived entirely from stored set results. */
export interface SessionCursor {
  exerciseIndex: number
  setIndex: number
  setsDone: number
  totalSets: number
  exercisesDone: number
  finished: boolean
}

export interface SessionDetail {
  session: WorkoutSession
  day: ResolvedDay | null
  results: SetResult[]
}

export interface PersonalBest {
  label: string
  value: string
  exerciseName: string
}

export const DIFFICULTY_OPTIONS: { value: Difficulty; label: string }[] = [
  { value: 'hard', label: 'Hard' },
  { value: 'just_right', label: 'Just right' },
  { value: 'easy', label: 'Easy' },
]

/**
 * How a finished workout reads in the group feed: what they did, in the words
 * the other app used. Short enough to scan three of them in a row.
 */
function workoutUpdateText(session: Pick<WorkoutSession, 'name' | 'planName' | 'dayNumber'>): string {
  const what = session.planName?.trim() || session.name
  return session.dayNumber
    ? `completed Day ${session.dayNumber} — ${what} 💪`
    : `completed ${what} 💪`
}

/**
 * What to call a session nobody named.
 *
 * A blank title is common — people log the numbers and skip the label — and
 * "Workout" for everything makes a month of history unreadable. The kind is
 * already known, so it becomes the name.
 */
const DEFAULT_NAME: Record<WorkoutKind, string> = {
  strength: 'Strength training',
  cardio: 'Cardio',
  general: 'Workout',
}

export const workoutService = {
  listPlans(): Promise<WorkoutPlan[]> {
    return db.plans.toArray()
  },

  getPlan(planId: ID): Promise<WorkoutPlan | undefined> {
    return db.plans.get(planId)
  },

  async activeEnrollment(userId: ID): Promise<PlanEnrollment | undefined> {
    const rows = await db.enrollments.where('userId').equals(userId).toArray()
    return rows.find((e) => e.active) ?? rows[0]
  },

  async enroll(userId: ID, planId: ID, startDate: DateKey = todayKey()): Promise<PlanEnrollment> {
    assertOwner(userId)
    const existing = await db.enrollments.where('userId').equals(userId).toArray()
    await Promise.all(existing.map((e) => db.enrollments.update(e.id, { active: false })))
    const enrollment: PlanEnrollment = { id: uid('en'), userId, planId, startDate, active: true }
    await db.enrollments.add(enrollment)
    return enrollment
  },

  /** Which day of the plan a given date falls on. Day 1 is the start date. */
  dayNumberFor(enrollment: PlanEnrollment, date: DateKey, totalDays: number): number {
    const offset = daysBetween(enrollment.startDate, date)
    if (offset < 0) return 1
    // Plans loop rather than dead-ending on the last day.
    return (offset % totalDays) + 1
  },

  async resolveDay(planId: ID, dayNumber: number): Promise<ResolvedDay | null> {
    const plan = await db.plans.get(planId)
    if (!plan) return null
    const planDay = await db.planDays.where('[planId+dayNumber]').equals([planId, dayNumber]).first()
    if (!planDay) return null

    const rows = await db.workoutExercises.where('planDayId').equals(planDay.id).toArray()
    rows.sort((a, b) => a.order - b.order)
    const catalogue = await db.exercises.bulkGet(rows.map((r) => r.exerciseId))
    const exercises = rows
      .map((row, index) => ({ ...row, exercise: catalogue[index] }))
      .filter((row): row is ResolvedExercise => Boolean(row.exercise))

    return {
      plan,
      planDay,
      dayNumber,
      isRestDay: exercises.length === 0,
      exercises,
      estimatedMinutes: planDay.estimatedMinutes,
    }
  },

  /** The workout scheduled for `date`, based on the user's active plan. */
  async scheduledFor(userId: ID, date: DateKey = todayKey()): Promise<ResolvedDay | null> {
    const enrollment = await this.activeEnrollment(userId)
    if (!enrollment) return null
    const plan = await db.plans.get(enrollment.planId)
    if (!plan) return null
    const dayNumber = this.dayNumberFor(enrollment, date, plan.totalDays)
    return this.resolveDay(enrollment.planId, dayNumber)
  },

  async sessionsForUser(userId: ID): Promise<WorkoutSession[]> {
    const rows = await db.sessions.where('userId').equals(userId).toArray()
    return rows
      .filter((s) => s.status === 'completed')
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
  },

  async sessionsInRange(userId: ID, from: DateKey, to: DateKey): Promise<WorkoutSession[]> {
    const rows = await db.sessions
      .where('[userId+date]')
      .between([userId, from], [userId, to], true, true)
      .toArray()
    return rows
      .filter((s) => s.status === 'completed')
      .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))
  },

  async sessionsForDay(userId: ID, date: DateKey): Promise<WorkoutSession[]> {
    return this.sessionsInRange(userId, date, date)
  },

  async completedOn(userId: ID, date: DateKey): Promise<boolean> {
    return (await this.sessionsForDay(userId, date)).length > 0
  },

  async stats(userId: ID, weekDates: DateKey[]): Promise<WorkoutStats> {
    const sessions = await this.sessionsForUser(userId)
    const week = new Set(weekDates)
    const today = todayKey()
    const month = today.slice(0, 7)
    const year = today.slice(0, 4)
    const dates = sessions.map((s) => s.date)

    return {
      total: sessions.length,
      totalDurationSec: sessions.reduce((sum, s) => sum + s.durationSec, 0),
      totalCalories: Math.round(sessions.reduce((sum, s) => sum + s.caloriesKcal, 0) * 10) / 10,
      thisWeek: sessions.filter((s) => week.has(s.date)).length,
      thisMonth: sessions.filter((s) => s.date.startsWith(month)).length,
      thisYear: sessions.filter((s) => s.date.startsWith(year)).length,
      longestSessionSec: sessions.reduce((max, s) => Math.max(max, s.durationSec), 0),
      averageDurationSec: sessions.length
        ? Math.round(sessions.reduce((sum, s) => sum + s.durationSec, 0) / sessions.length)
        : 0,
      currentStreak: currentStreak(dates),
      longestStreak: longestStreak(dates),
    }
  },

  async start(input: {
    userId: ID
    planId: ID
    planDayId: ID
    dayNumber: number
    name: string
    exerciseCount: number
  }): Promise<WorkoutSession> {
    assertOwner(input.userId)
    // One live session at a time: starting again just returns to the one that
    // is already running rather than orphaning it.
    const running = await this.activeSession(input.userId)
    if (running) return running

    const session: WorkoutSession = {
      id: uid('s'),
      userId: input.userId,
      planId: input.planId,
      planDayId: input.planDayId,
      dayNumber: input.dayNumber,
      name: input.name,
      startedAt: now(),
      date: todayKey(),
      durationSec: 0,
      exerciseCount: input.exerciseCount,
      caloriesKcal: 0,
      status: 'in_progress',
    }
    await db.sessions.add(session)
    return session
  },

  /**
   * Finishing writes the session and posts to the group feed. Everything else
   * the app shows — streaks, weekly totals, consistency — is derived from these
   * rows, so nothing else needs updating.
   */
  async complete(input: {
    sessionId: ID
    durationSec: number
    difficulty?: Difficulty
    note?: string
    /** Average MET of the session's exercises. */
    met: number
    bodyWeightKg: number
  }): Promise<WorkoutSession> {
    const session = await db.sessions.get(input.sessionId)
    if (!session) throw new Error('Session not found')
    assertOwner(session.userId)

    // Finishing twice — a double tap, a stale tab, a retry — must not post a
    // second update or count the session again. The first call wins.
    if (session.status === 'completed') return session

    const durationSec = Math.max(1, Math.round(input.durationSec))
    const caloriesKcal = estimateWorkoutCalories(input.met, input.bodyWeightKg, durationSec)
    const updated: WorkoutSession = {
      ...session,
      durationSec,
      difficulty: input.difficulty,
      note: input.note?.trim() || undefined,
      caloriesKcal,
      completedAt: now(),
      pausedAt: undefined,
      status: 'completed',
    }
    await db.sessions.put(updated)

    await updateService.postOnce({
      userId: session.userId,
      kind: 'workout_completed',
      dedupeKey: `workout:${session.id}`,
      text: workoutUpdateText(session),
      meta: { kcal: caloriesKcal, durationSec },
    })
    return updated
  },

  /**
   * Record a workout that was performed in another app.
   *
   * This is the everyday path: train in Home Workout or Lose Weight for Men,
   * then spend ten seconds writing down what the summary screen said. There is
   * no live session, no set results and no timer — just the result.
   *
   * Editing an existing log passes `sessionId`, which keeps the original feed
   * post rather than announcing the same workout twice.
   */
  async logExternal(input: {
    sessionId?: ID
    userId: ID
    date?: DateKey
    source: WorkoutSource
    sourceName?: string
    planName?: string
    dayNumber?: number
    name: string
    exerciseCount: number
    durationSec: number
    caloriesKcal: number
    difficulty?: Difficulty
    note?: string
  }): Promise<WorkoutSession> {
    assertOwner(input.userId)

    const date = input.date ?? todayKey()
    const name = input.name.trim() || input.planName?.trim() || 'Workout'
    const clean = {
      source: input.source,
      sourceName: input.source === 'other' ? input.sourceName?.trim() || undefined : undefined,
      planName: input.planName?.trim() || undefined,
      dayNumber: input.dayNumber && input.dayNumber > 0 ? Math.round(input.dayNumber) : undefined,
      name,
      exerciseCount: Math.max(0, Math.round(input.exerciseCount)),
      durationSec: Math.max(0, Math.round(input.durationSec)),
      // The external app already counted these; we take its number rather than
      // re-estimating from a MET table that knows nothing about the session.
      caloriesKcal: Math.max(0, Math.round(input.caloriesKcal * 10) / 10),
      difficulty: input.difficulty,
      note: input.note?.trim() || undefined,
    }

    if (input.sessionId) {
      const existing = await db.sessions.get(input.sessionId)
      assertOwnerOf(existing)
      if (!existing) throw new Error('Session not found')
      const updated: WorkoutSession = { ...existing, ...clean, date }
      await db.sessions.put(updated)
      return updated
    }

    const session: WorkoutSession = {
      id: uid('ws'),
      userId: input.userId,
      date,
      startedAt: now(),
      completedAt: now(),
      status: 'completed',
      loggedVia: 'quick_log',
      ...clean,
    }
    await db.sessions.add(session)

    await updateService.postOnce({
      userId: input.userId,
      kind: 'workout_completed',
      dedupeKey: `workout:${session.id}`,
      text: workoutUpdateText(session),
      meta: { kcal: session.caloriesKcal, durationSec: session.durationSec },
    })
    return session
  },

  // --- Logging by hand -----------------------------------------------------

  /** The exercises somebody wrote down for a session, in the order they wrote them. */
  async exercisesFor(sessionId: ID): Promise<LoggedExercise[]> {
    const rows = await db.loggedExercises.where('sessionId').equals(sessionId).toArray()
    return rows.sort((a, b) => a.order - b.order)
  },

  /**
   * Record a workout somebody is typing in themselves.
   *
   * Separate from `logExternal` because they are answering different
   * questions. That one transcribes another app's summary screen — its plan
   * name, its day number, its calorie figure. This one is a person writing
   * down what they did, so it asks for the session and its exercises and
   * nothing about where it came from.
   *
   * The exercises are replaced wholesale rather than diffed. An edit is
   * somebody re-stating the list, the lists are three or four rows long, and a
   * diff would be more code than the thing it optimises — done in one
   * transaction so a save can never leave half a workout behind.
   *
   * `exerciseCount` stays on the session because the summary card, the week
   * stats and the group feed all read it, and none of them should have to
   * fetch a second table to count to three.
   */
  async logManual(input: {
    sessionId?: ID
    userId: ID
    date: DateKey
    kind: WorkoutKind
    name: string
    durationSec: number
    caloriesKcal?: number
    difficulty?: Difficulty
    note?: string
    exercises: Omit<LoggedExercise, 'id' | 'sessionId' | 'order'>[]
  }): Promise<WorkoutSession> {
    assertOwner(input.userId)

    const name = input.name.trim() || DEFAULT_NAME[input.kind]
    const exercises = input.exercises
      .filter((exercise) => exercise.name.trim().length > 0)
      .map((exercise, order) => ({
        ...exercise,
        id: uid('lex'),
        sessionId: input.sessionId ?? '',
        order,
        name: exercise.name.trim(),
        note: exercise.note?.trim() || undefined,
      }))

    const clean = {
      kind: input.kind,
      name,
      exerciseCount: exercises.length,
      durationSec: Math.max(0, Math.round(input.durationSec)),
      caloriesKcal: Math.max(0, Math.round((input.caloriesKcal ?? 0) * 10) / 10),
      difficulty: input.difficulty,
      note: input.note?.trim() || undefined,
      loggedVia: 'manual' as const,
      // A hand-written log has no external app behind it, and saying it came
      // from one would be a claim the record cannot support.
      source: 'other' as WorkoutSource,
      sourceName: undefined,
      planName: undefined,
      dayNumber: undefined,
    }

    if (input.sessionId) {
      const existing = await db.sessions.get(input.sessionId)
      assertOwnerOf(existing)
      if (!existing) throw new Error('Session not found')
      const updated: WorkoutSession = { ...existing, ...clean, date: input.date }
      await db.transaction('rw', db.sessions, db.loggedExercises, async () => {
        await db.sessions.put(updated)
        await db.loggedExercises.where('sessionId').equals(updated.id).delete()
        await db.loggedExercises.bulkAdd(
          exercises.map((exercise) => ({ ...exercise, sessionId: updated.id })),
        )
      })
      return updated
    }

    const session: WorkoutSession = {
      id: uid('ws'),
      userId: input.userId,
      date: input.date,
      startedAt: now(),
      completedAt: now(),
      status: 'completed',
      ...clean,
    }
    await db.transaction('rw', db.sessions, db.loggedExercises, async () => {
      await db.sessions.add(session)
      await db.loggedExercises.bulkAdd(
        exercises.map((exercise) => ({ ...exercise, sessionId: session.id })),
      )
    })

    // The group hears about it once, exactly as it does for an imported log.
    await updateService.postOnce({
      userId: input.userId,
      kind: 'workout_completed',
      dedupeKey: `workout:${session.id}`,
      text: workoutUpdateText(session),
      meta: { kcal: session.caloriesKcal, durationSec: session.durationSec },
    })
    return session
  },

  /**
   * What to pre-fill the quick-log form with: whatever they logged last, with
   * the day number moved on by one. Most sessions are the next day of the same
   * plan in the same app, so this is usually correct as typed.
   */
  async quickLogDefaults(userId: ID): Promise<{
    source: WorkoutSource
    sourceName?: string
    planName?: string
    dayNumber?: number
    name?: string
    exerciseCount?: number
  }> {
    const [user, previous] = await Promise.all([
      db.users.get(userId),
      db.sessions
        .where('userId')
        .equals(userId)
        .filter((s) => s.status === 'completed' && s.loggedVia === 'quick_log')
        .sortBy('date'),
    ])
    // `sortBy` is ascending and ignores an earlier `reverse()`, so the newest
    // log is the last element — taking the first one offered up the oldest
    // workout on record as the starting point for the next.
    const last = previous.at(-1)
    if (!last) {
      return { source: user?.workoutApps?.[0] ?? 'home_workout' }
    }
    return {
      source: last.source ?? 'home_workout',
      sourceName: last.sourceName,
      planName: last.planName,
      dayNumber: last.dayNumber ? last.dayNumber + 1 : undefined,
      name: last.name,
      exerciseCount: last.exerciseCount,
    }
  },

  // --- Live session -------------------------------------------------------

  /** The session currently in progress, if any. At most one per user. */
  async activeSession(userId: ID): Promise<WorkoutSession | undefined> {
    return db.sessions.where('[userId+status]').equals([userId, 'in_progress']).first()
  },

  /**
   * Seconds of actual work, excluding paused time. Derived from timestamps
   * rather than counted up by a timer, so it stays correct across a refresh,
   * a backgrounded tab, or a long pause.
   */
  elapsedSec(session: WorkoutSession, now: number = Date.now()): number {
    const started = new Date(session.startedAt).getTime()
    const upTo = session.pausedAt ? new Date(session.pausedAt).getTime() : now
    return Math.max(0, Math.floor((upTo - started) / 1000) - (session.pausedSec ?? 0))
  },

  async pause(sessionId: ID): Promise<void> {
    const session = await db.sessions.get(sessionId)
    assertOwnerOf(session)
    if (!session || session.pausedAt) return
    await db.sessions.update(sessionId, { pausedAt: now() })
  },

  async resume(sessionId: ID): Promise<void> {
    const session = await db.sessions.get(sessionId)
    assertOwnerOf(session)
    if (!session?.pausedAt) return
    const pausedFor = Math.max(0, Math.round((Date.now() - new Date(session.pausedAt).getTime()) / 1000))
    await db.sessions.update(sessionId, {
      pausedAt: undefined,
      pausedSec: (session.pausedSec ?? 0) + pausedFor,
    })
  },

  setResults(sessionId: ID): Promise<SetResult[]> {
    return db.setResults.where('sessionId').equals(sessionId).toArray()
  },

  /** Records one completed set. Re-logging the same set corrects it. */
  async logSet(input: {
    sessionId: ID
    workoutExerciseId: ID
    setIndex: number
    reps?: number
    durationSec?: number
    weightKg?: number
  }): Promise<SetResult> {
    const session = await db.sessions.get(input.sessionId)
    assertOwnerOf(session)
    const existing = await db.setResults
      .where('[sessionId+workoutExerciseId]')
      .equals([input.sessionId, input.workoutExerciseId])
      .filter((row) => row.setIndex === input.setIndex)
      .first()

    const result: SetResult = {
      id: existing?.id ?? uid('sr'),
      sessionId: input.sessionId,
      workoutExerciseId: input.workoutExerciseId,
      setIndex: input.setIndex,
      reps: input.reps,
      durationSec: input.durationSec,
      weightKg: input.weightKg,
      completed: true,
      skipped: false,
      completedAt: now(),
    }
    await db.setResults.put(result)
    return result
  },

  /** Marks every remaining set of an exercise as skipped, so history stays honest. */
  async skipExercise(input: {
    sessionId: ID
    workoutExerciseId: ID
    sets: number
  }): Promise<void> {
    const session = await db.sessions.get(input.sessionId)
    assertOwnerOf(session)
    const existing = await db.setResults
      .where('[sessionId+workoutExerciseId]')
      .equals([input.sessionId, input.workoutExerciseId])
      .toArray()
    const done = new Set(existing.filter((row) => row.completed).map((row) => row.setIndex))

    const rows: SetResult[] = []
    for (let setIndex = 0; setIndex < input.sets; setIndex++) {
      if (done.has(setIndex)) continue
      rows.push({
        id: existing.find((row) => row.setIndex === setIndex)?.id ?? uid('sr'),
        sessionId: input.sessionId,
        workoutExerciseId: input.workoutExerciseId,
        setIndex,
        completed: false,
        skipped: true,
        completedAt: now(),
      })
    }
    if (rows.length) await db.setResults.bulkPut(rows)
  },

  /** Undo the most recent completed set — the fix for a mis-tap mid-workout. */
  async undoLastSet(sessionId: ID): Promise<void> {
    const session = await db.sessions.get(sessionId)
    assertOwnerOf(session)
    const rows = await this.setResults(sessionId)
    const last = rows
      .filter((row) => row.completed && row.completedAt)
      .sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : -1))[0]
    if (last) await db.setResults.delete(last.id)
  },

  /**
   * Where the player should be, computed from the stored results. Keeping this
   * derived means a refresh mid-workout lands exactly where the user left off
   * without persisting any UI state.
   */
  cursor(exercises: ResolvedExercise[], results: SetResult[]): SessionCursor {
    const byExercise = new Map<ID, SetResult[]>()
    for (const row of results) {
      byExercise.set(row.workoutExerciseId, [...(byExercise.get(row.workoutExerciseId) ?? []), row])
    }

    const totalSets = exercises.reduce((sum, exercise) => sum + exercise.sets, 0)
    const setsDone = results.filter((row) => row.completed).length
    let exercisesDone = 0

    for (let index = 0; index < exercises.length; index++) {
      const exercise = exercises[index]
      const rows = byExercise.get(exercise.id) ?? []
      const settled = new Set(rows.map((row) => row.setIndex))
      if (settled.size >= exercise.sets) {
        exercisesDone += 1
        continue
      }
      let setIndex = 0
      while (setIndex < exercise.sets && settled.has(setIndex)) setIndex += 1
      return { exerciseIndex: index, setIndex, setsDone, totalSets, exercisesDone, finished: false }
    }

    return {
      exerciseIndex: exercises.length - 1,
      setIndex: 0,
      setsDone,
      totalSets,
      exercisesDone,
      finished: true,
    }
  },

  /** Session plus its planned day and recorded sets, for the history detail. */
  async detail(sessionId: ID): Promise<SessionDetail | null> {
    const session = await db.sessions.get(sessionId)
    if (!session) return null
    const day =
      session.planId && session.dayNumber
        ? await this.resolveDay(session.planId, session.dayNumber)
        : null
    return { session, day, results: await this.setResults(sessionId) }
  },

  /**
   * Bests drawn from actual recorded sets. Sessions logged before the player
   * existed have no set data, so this stays empty rather than inventing one.
   */
  async personalBests(userId: ID): Promise<PersonalBest[]> {
    const sessions = await this.sessionsForUser(userId)
    const ids = new Set(sessions.map((s) => s.id))
    if (ids.size === 0) return []

    const rows = (await db.setResults.toArray()).filter(
      (row) => ids.has(row.sessionId) && row.completed,
    )
    if (rows.length === 0) return []

    const planned = await db.workoutExercises.bulkGet([
      ...new Set(rows.map((row) => row.workoutExerciseId)),
    ])
    const exerciseIdFor = new Map(
      planned.filter(Boolean).map((row) => [row!.id, row!.exerciseId]),
    )
    const catalogue = await db.exercises.bulkGet([...new Set([...exerciseIdFor.values()])])
    const nameFor = new Map(catalogue.filter(Boolean).map((e) => [e!.id, e!.name]))

    const bestReps = new Map<string, number>()
    const bestHold = new Map<string, number>()
    const bestWeight = new Map<string, number>()

    for (const row of rows) {
      const exerciseId = exerciseIdFor.get(row.workoutExerciseId)
      const name = exerciseId ? nameFor.get(exerciseId) : undefined
      if (!name) continue
      if (row.reps) bestReps.set(name, Math.max(bestReps.get(name) ?? 0, row.reps))
      if (row.durationSec) bestHold.set(name, Math.max(bestHold.get(name) ?? 0, row.durationSec))
      if (row.weightKg) bestWeight.set(name, Math.max(bestWeight.get(name) ?? 0, row.weightKg))
    }

    const best: PersonalBest[] = []
    const topReps = [...bestReps.entries()].sort((a, b) => b[1] - a[1])[0]
    const topHold = [...bestHold.entries()].sort((a, b) => b[1] - a[1])[0]
    const topWeight = [...bestWeight.entries()].sort((a, b) => b[1] - a[1])[0]
    if (topReps) best.push({ label: 'Most reps in a set', value: `${topReps[1]}`, exerciseName: topReps[0] })
    if (topHold) best.push({ label: 'Longest hold', value: duration(topHold[1]), exerciseName: topHold[0] })
    if (topWeight) best.push({ label: 'Heaviest set', value: `${topWeight[1]} kg`, exerciseName: topWeight[0] })
    return best
  },

  /** Ends a session without counting it. The record is kept, not deleted. */
  async abandon(sessionId: ID): Promise<void> {
    const session = await db.sessions.get(sessionId)
    assertOwnerOf(session)
    if (!session) return
    await db.sessions.update(sessionId, {
      status: 'abandoned',
      completedAt: now(),
      pausedAt: undefined,
      durationSec: this.elapsedSec(session),
    })
  },

  /**
   * Delete a session and everything that only existed because of it.
   *
   * Both kinds of detail go: the set-by-set results a player recorded, and the
   * exercises somebody typed in by hand. Nothing else references either, so
   * there is nothing else to sweep — and deliberately nothing outside this
   * session is touched.
   */
  async removeSession(sessionId: ID): Promise<void> {
    assertOwnerOf(await db.sessions.get(sessionId))
    await db.transaction('rw', db.sessions, db.setResults, db.loggedExercises, async () => {
      await db.sessions.delete(sessionId)
      await db.setResults.where('sessionId').equals(sessionId).delete()
      await db.loggedExercises.where('sessionId').equals(sessionId).delete()
    })
  },

  /**
   * Session-level MET for the calorie estimate.
   *
   * Averaging the individual exercises understates a circuit: the short rests
   * keep the heart rate up between moves. The Compendium of Physical Activities
   * puts general circuit training at 8.0, so that is the floor — a session only
   * scores higher if the movements themselves are harder than that.
   */
  averageMet(exercises: ResolvedExercise[]): number {
    if (exercises.length === 0) return 8
    const average = exercises.reduce((sum, e) => sum + e.exercise.met, 0) / exercises.length
    return Math.max(8, average)
  },
}
