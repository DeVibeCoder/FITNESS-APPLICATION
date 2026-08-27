import { db } from '@/lib/db'
import { userService } from './userService'
import type {
  DailyCheckIn,
  DateKey,
  ID,
  User,
  WeeklySummary,
  WeightEntry,
  WorkoutSession,
} from '@/models'
import {
  addDays,
  daysBetween,
  endOfWeek,
  startOfWeek,
  todayKey,
} from '@/utils/date'
import { calcBmi, type BmiResult } from '@/utils/bmi'
import { ageFrom, calcEnergyPlan, type EnergyPlan } from '@/utils/calories'
import { consistencyScore, type ConsistencyResult } from '@/utils/consistency'
import { currentStreak, longestStreak, streakAtRisk } from '@/utils/streaks'
import { weightProgress, type WeightProgress } from '@/utils/progress'
import { sumMacros, type MacroTotals } from './nutritionService'
import { workoutService, type ResolvedDay } from './workoutService'

export interface DailySnapshot {
  date: DateKey
  user: User
  steps: number
  stepGoal: number
  nutrition: MacroTotals
  energy: EnergyPlan
  waterMl: number
  waterGoalMl: number
  weightKg?: number
  weightToday?: WeightEntry
  scheduled: ResolvedDay | null
  completedSessions: WorkoutSession[]
  checkIn?: DailyCheckIn
  /** The five daily habits, for the completion ring. */
  tasksDone: number
  tasksTotal: number
}

export interface UserSnapshot {
  user: User
  currentWeightKg: number
  progress: WeightProgress
  bmi: BmiResult
  energy: EnergyPlan
  streak: number
  longestStreak: number
  streakAtRisk: boolean
  workoutsThisWeek: number
  stepsThisWeek: number
  consistency: ConsistencyResult
  achievements: number
  lastActive?: DateKey
}

/**
 * Weighing is weekly. Older databases can still hold `daily` rows from before
 * that was true, so every read of a weight goes through here — a morning
 * reading must never be mistaken for the week's number.
 */
const weekly = (entry: WeightEntry) => entry.kind === 'official'

/** Every date the user did anything at all — the basis for the streak. */
async function activeDates(userId: ID): Promise<Set<DateKey>> {
  const [sessions, steps, weights, foods, checkins] = await Promise.all([
    db.sessions.where('userId').equals(userId).toArray(),
    db.steps.where('userId').equals(userId).toArray(),
    db.weights.where('userId').equals(userId).toArray(),
    db.foods.where('userId').equals(userId).toArray(),
    db.checkins.where('userId').equals(userId).toArray(),
  ])
  return new Set<DateKey>([
    ...sessions.filter((s) => s.status === 'completed').map((s) => s.date),
    ...steps.map((s) => s.date),
    ...weights.map((w) => w.date),
    ...foods.map((f) => f.date),
    ...checkins.map((c) => c.date),
  ])
}

async function energyFor(user: User, weightKg: number): Promise<EnergyPlan> {
  return calcEnergyPlan({
    weightKg,
    heightCm: user.heightCm,
    age: ageFrom(user.birthDate),
    sex: user.sex,
    activityLevel: user.activityLevel,
    goal: user.goal,
    override: user.calorieTargetOverride,
  })
}

export const progressService = {
  async currentWeight(userId: ID): Promise<number> {
    const rows = (await db.weights.where('userId').equals(userId).sortBy('date')).filter(weekly)
    const user = await db.users.get(userId)
    return rows.length ? rows[rows.length - 1].weightKg : (user?.startWeightKg ?? 0)
  },

  energyPlan: energyFor,

  /** Everything the Home screen needs for one day, in a single call. */
  async dailySnapshot(userId: ID, date: DateKey = todayKey()): Promise<DailySnapshot | null> {
    const user = await db.users.get(userId)
    if (!user) return null

    const [foods, waterRows, stepRow, weightRows, checkIn, sessions, scheduled] = await Promise.all([
      db.foods.where('[userId+date]').equals([userId, date]).toArray(),
      db.water.where('[userId+date]').equals([userId, date]).toArray(),
      db.steps.where('[userId+date]').equals([userId, date]).first(),
      db.weights.where('[userId+date]').equals([userId, date]).toArray(),
      db.checkins.where('[userId+date]').equals([userId, date]).first(),
      workoutService.sessionsForDay(userId, date),
      workoutService.scheduledFor(userId, date),
    ])

    // Only a weekly weigh-in counts. A legacy `daily` row on this date is a
    // reading, not the week's number, and must not become "today's weight".
    const weightToday = weightRows.find(weekly)
    const weightKg = weightToday?.weightKg ?? (await this.currentWeight(userId))
    const energy = await energyFor(user, weightKg)
    const waterMl = waterRows.reduce((sum, row) => sum + row.ml, 0)
    const steps = stepRow?.steps ?? 0

    // A rest day counts as done — the plan said rest.
    const workoutDone = sessions.length > 0 || scheduled?.isRestDay === true
    const done = [
      workoutDone,
      steps >= user.stepGoal,
      foods.length > 0,
      waterMl >= user.waterGoalL * 1000,
      Boolean(checkIn),
    ].filter(Boolean).length

    return {
      date,
      user,
      steps,
      stepGoal: user.stepGoal,
      nutrition: sumMacros(foods),
      energy,
      waterMl,
      waterGoalMl: Math.round(user.waterGoalL * 1000),
      weightKg,
      weightToday,
      scheduled,
      completedSessions: sessions,
      checkIn,
      tasksDone: done,
      tasksTotal: 5,
    }
  },

  async weeklySummary(userId: ID, dateInWeek: DateKey = todayKey()): Promise<WeeklySummary> {
    const user = await db.users.get(userId)
    const from = startOfWeek(dateInWeek)
    const to = endOfWeek(dateInWeek)
    const today = todayKey()
    const daysElapsed = to <= today ? 7 : Math.min(7, daysBetween(from, today) + 1)

    const [sessions, steps, foods, checkins, weights] = await Promise.all([
      workoutService.sessionsInRange(userId, from, to),
      db.steps.where('[userId+date]').between([userId, from], [userId, to], true, true).toArray(),
      db.foods.where('[userId+date]').between([userId, from], [userId, to], true, true).toArray(),
      db.checkins.where('[userId+date]').between([userId, from], [userId, to], true, true).toArray(),
      db.weights.where('userId').equals(userId).sortBy('date'),
    ])

    const stepGoal = user?.stepGoal ?? 8000
    const totalSteps = steps.reduce((sum, s) => sum + s.steps, 0)
    const nutritionDays = new Set(foods.map((f) => f.date)).size
    const workoutGoal = user?.workoutsPerWeekGoal ?? 5

    // Weight change across the week: last weigh-in in the week vs the last one
    // on or before the week started. Weekly readings only — a leftover daily
    // row would report a change the person never weighed.
    const weighIns = weights.filter(weekly)
    const inWeek = weighIns.filter((w) => w.date >= from && w.date <= to)
    const before = weighIns.filter((w) => w.date < from)
    const weightChangeKg =
      inWeek.length && before.length
        ? Math.round((inWeek[inWeek.length - 1].weightKg - before[before.length - 1].weightKg) * 10) / 10
        : inWeek.length > 1
          ? Math.round((inWeek[inWeek.length - 1].weightKg - inWeek[0].weightKg) * 10) / 10
          : undefined

    const consistency = consistencyScore({
      workouts: sessions.length,
      workoutGoal,
      stepDays: steps.filter((s) => s.steps >= stepGoal).length,
      nutritionDays,
      checkinDays: checkins.length,
      daysElapsed,
    })

    return {
      userId,
      weekStart: from,
      weekEnd: to,
      workouts: sessions.length,
      workoutGoal,
      durationSec: sessions.reduce((sum, s) => sum + s.durationSec, 0),
      caloriesBurned: Math.round(sessions.reduce((sum, s) => sum + s.caloriesKcal, 0) * 10) / 10,
      steps: totalSteps,
      avgStepsPerDay: steps.length ? Math.round(totalSteps / steps.length) : 0,
      daysLogged: new Set([
        ...sessions.map((s) => s.date),
        ...steps.map((s) => s.date),
        ...foods.map((f) => f.date),
        ...checkins.map((c) => c.date),
      ]).size,
      weightChangeKg,
      consistencyPct: consistency.score,
    }
  },

  async consistency(userId: ID, dateInWeek: DateKey = todayKey()): Promise<ConsistencyResult> {
    const user = await db.users.get(userId)
    const from = startOfWeek(dateInWeek)
    const to = endOfWeek(dateInWeek)
    const today = todayKey()
    const daysElapsed = to <= today ? 7 : Math.min(7, daysBetween(from, today) + 1)

    const [sessions, steps, foods, checkins] = await Promise.all([
      workoutService.sessionsInRange(userId, from, to),
      db.steps.where('[userId+date]').between([userId, from], [userId, to], true, true).toArray(),
      db.foods.where('[userId+date]').between([userId, from], [userId, to], true, true).toArray(),
      db.checkins.where('[userId+date]').between([userId, from], [userId, to], true, true).toArray(),
    ])

    return consistencyScore({
      workouts: sessions.length,
      workoutGoal: user?.workoutsPerWeekGoal ?? 5,
      stepDays: steps.filter((s) => s.steps >= (user?.stepGoal ?? 8000)).length,
      nutritionDays: new Set(foods.map((f) => f.date)).size,
      checkinDays: checkins.length,
      daysElapsed,
    })
  },

  async streak(userId: ID): Promise<number> {
    return currentStreak(await activeDates(userId))
  },

  /** One row per member for the "Our progress" section and the profile header. */
  async userSnapshot(userId: ID, dateInWeek: DateKey = todayKey()): Promise<UserSnapshot | null> {
    const user = await db.users.get(userId)
    if (!user) return null

    const from = startOfWeek(dateInWeek)
    const to = endOfWeek(dateInWeek)
    const [currentWeightKg, dates, sessions, steps, consistency, achievements] = await Promise.all([
      this.currentWeight(userId),
      activeDates(userId),
      workoutService.sessionsInRange(userId, from, to),
      db.steps.where('[userId+date]').between([userId, from], [userId, to], true, true).toArray(),
      this.consistency(userId, dateInWeek),
      db.achievements.where('userId').equals(userId).count(),
    ])

    const sorted = [...dates].sort()
    return {
      user,
      currentWeightKg,
      progress: weightProgress(user.startWeightKg, currentWeightKg, user.targetWeightKg),
      bmi: calcBmi(currentWeightKg, user.heightCm),
      energy: await energyFor(user, currentWeightKg),
      streak: currentStreak(dates),
      longestStreak: longestStreak(dates),
      streakAtRisk: streakAtRisk(dates),
      workoutsThisWeek: sessions.length,
      stepsThisWeek: steps.reduce((sum, s) => sum + s.steps, 0),
      consistency,
      achievements,
      lastActive: sorted[sorted.length - 1],
    }
  },

  async groupSnapshot(dateInWeek: DateKey = todayKey()): Promise<UserSnapshot[]> {
    const users = await userService.listMembers()
    const rows = await Promise.all(users.map((u) => this.userSnapshot(u.id, dateInWeek)))
    return rows
      .filter((row): row is UserSnapshot => row !== null)
      .sort((a, b) => b.consistency.score - a.consistency.score)
  },

  /** Weight series for the trend chart, one point per entry. */
  async weightSeries(userId: ID, days = 90): Promise<{ date: DateKey; weightKg: number }[]> {
    const from = addDays(todayKey(), -days)
    const rows = await db.weights
      .where('[userId+date]')
      .between([userId, from], [userId, todayKey()], true, true)
      .toArray()
    return rows
      .filter(weekly)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((row) => ({ date: row.date, weightKg: row.weightKg }))
  },
}
