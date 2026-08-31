import { db } from '@/lib/db'
import { uid, now } from '@/lib/id'
import type { AchievementDef, ID, UserAchievement } from '@/models'
import { ACHIEVEMENTS, ACHIEVEMENT_BY_KEY } from '@/data/achievements'
import { currentStreak } from '@/utils/streaks'
import { updateService } from './updateService'
import { workoutService } from './workoutService'

export interface AchievementView extends AchievementDef {
  unlockedAt?: string
  /**
   * How close this person is, for a mark they have not got yet.
   *
   * Absent once unlocked, and absent on the handful of marks that cannot
   * honestly be measured part-way — you have not half recorded a personal
   * best. A bar that always showed something would have to invent the
   * something.
   */
  progress?: AchievementProgress
}

/** How far along a locked achievement is. Computed, never persisted. */
export interface AchievementProgress {
  current: number
  target: number
  /** 0–100, clamped. */
  pct: number
  /** What the numbers count, for the sentence the UI writes. */
  noun: string
}

/**
 * Everything the unlock rules are decided from, read once.
 *
 * `evaluate` turns these into yes/no; `listForUser` turns the same numbers
 * into how-far-along. Having one function produce both is the only way the
 * bar under a locked mark cannot disagree with the rule that unlocks it.
 */
interface Measures {
  workouts: number
  streak: number
  bestDaySteps: number
  totalSteps: number
  movedKg: number
  /** Distance from start to target, for the goal mark. 0 when maintaining. */
  goalDistanceKg: number
  reachedGoal: boolean
  nutritionDays: number
  activeDays: number
  officialWeighIns: number
  updates: number
  personalBests: number
}

async function measuresFor(userId: ID): Promise<Measures | null> {
  const [user, sessions, weights, steps, bests, foods, updates] = await Promise.all([
    db.users.get(userId),
    db.sessions.where('userId').equals(userId).toArray(),
    db.weights.where('userId').equals(userId).sortBy('date'),
    db.steps.where('userId').equals(userId).toArray(),
    workoutService.personalBests(userId),
    db.foods.where('userId').equals(userId).toArray(),
    db.updates.where('userId').equals(userId).count(),
  ])
  if (!user) return null

  const completed = sessions.filter((s) => s.status === 'completed')
  const officialWeighIns = weights.filter((w) => w.kind === 'official')

  /**
   * Distance travelled toward this person's own target, never "weight lost".
   * Someone building muscle earns the same milestones for going up as
   * someone cutting earns for coming down.
   */
  const latest = officialWeighIns.length
    ? officialWeighIns[officialWeighIns.length - 1].weightKg
    : user.startWeightKg
  const wantsToGain = user.targetWeightKg > user.startWeightKg
  const wantsToLose = user.targetWeightKg < user.startWeightKg
  const movedKg = wantsToGain
    ? latest - user.startWeightKg
    : wantsToLose
      ? user.startWeightKg - latest
      : 0

  const activeDates = new Set<string>([
    ...completed.map((s) => s.date),
    ...steps.map((s) => s.date),
    ...weights.map((w) => w.date),
  ])

  return {
    workouts: completed.length,
    streak: currentStreak(activeDates),
    bestDaySteps: steps.reduce((best, row) => Math.max(best, row.steps), 0),
    totalSteps: steps.reduce((sum, s) => sum + s.steps, 0),
    movedKg,
    goalDistanceKg:
      wantsToGain || wantsToLose ? Math.abs(user.targetWeightKg - user.startWeightKg) : 0,
    reachedGoal:
      officialWeighIns.length > 0 &&
      ((wantsToLose && latest <= user.targetWeightKg) ||
        (wantsToGain && latest >= user.targetWeightKg)),
    nutritionDays: new Set(foods.map((f) => f.date)).size,
    activeDays: activeDates.size,
    officialWeighIns: officialWeighIns.length,
    updates,
    personalBests: bests.length,
  }
}

/** The same rules `evaluate` writes rows from, as a plain lookup. */
function earnedFrom(m: Measures): Record<string, boolean> {
  return {
    first_workout: m.workouts >= 1,
    five_workouts: m.workouts >= 5,
    ten_workouts: m.workouts >= 10,
    twentyfive_workouts: m.workouts >= 25,
    fifty_workouts: m.workouts >= 50,
    hundred_workouts: m.workouts >= 100,

    streak_3: m.streak >= 3,
    streak_7: m.streak >= 7,
    streak_14: m.streak >= 14,
    streak_30: m.streak >= 30,
    streak_60: m.streak >= 60,
    streak_90: m.streak >= 90,

    steps_10k_day: m.bestDaySteps >= 10_000,
    steps_50k: m.totalSteps >= 50_000,
    steps_100k: m.totalSteps >= 100_000,
    steps_500k: m.totalSteps >= 500_000,
    steps_1m: m.totalSteps >= 1_000_000,

    first_kg: m.movedKg >= 1,
    three_kg: m.movedKg >= 3,
    five_kg: m.movedKg >= 5,
    ten_kg: m.movedKg >= 10,
    goal_reached: m.reachedGoal,

    nutrition_7: m.nutritionDays >= 7,
    nutrition_14: m.nutritionDays >= 14,
    nutrition_30: m.nutritionDays >= 30,

    consistency_7: m.activeDays >= 7,
    consistency_30: m.activeDays >= 30,
    consistency_60: m.activeDays >= 60,

    first_weigh_in: m.officialWeighIns >= 1,
    first_update: m.updates >= 1,
    // A real personal best needs recorded sets to compare, not just a
    // session that happens to be the longest so far.
    first_pr: m.personalBests > 0,
  }
}

/**
 * How far along each measurable mark is.
 *
 * Keys missing from this map are the ones with nothing honest to show a
 * fraction of: a personal best either happened or it did not.
 */
function progressFrom(m: Measures): Record<string, { current: number; target: number; noun: string }> {
  const workout = (target: number) => ({ current: m.workouts, target, noun: 'workouts' })
  const streak = (target: number) => ({ current: m.streak, target, noun: 'days in a row' })
  const total = (target: number) => ({ current: m.totalSteps, target, noun: 'steps' })
  const moved = (target: number) => ({ current: m.movedKg, target, noun: 'kg' })
  const food = (target: number) => ({ current: m.nutritionDays, target, noun: 'days logged' })
  const active = (target: number) => ({ current: m.activeDays, target, noun: 'active days' })

  return {
    first_workout: workout(1),
    five_workouts: workout(5),
    ten_workouts: workout(10),
    twentyfive_workouts: workout(25),
    fifty_workouts: workout(50),
    hundred_workouts: workout(100),

    streak_3: streak(3),
    streak_7: streak(7),
    streak_14: streak(14),
    streak_30: streak(30),
    streak_60: streak(60),
    streak_90: streak(90),

    steps_10k_day: { current: m.bestDaySteps, target: 10_000, noun: 'steps in a day' },
    steps_50k: total(50_000),
    steps_100k: total(100_000),
    steps_500k: total(500_000),
    steps_1m: total(1_000_000),

    first_kg: moved(1),
    three_kg: moved(3),
    five_kg: moved(5),
    ten_kg: moved(10),
    // Only when there is a distance to travel. Somebody maintaining has no
    // target weight to be a fraction of the way toward.
    ...(m.goalDistanceKg > 0 ? { goal_reached: moved(m.goalDistanceKg) } : {}),

    nutrition_7: food(7),
    nutrition_14: food(14),
    nutrition_30: food(30),

    consistency_7: active(7),
    consistency_30: active(30),
    consistency_60: active(60),

    first_weigh_in: { current: m.officialWeighIns, target: 1, noun: 'weigh-ins' },
    first_update: { current: m.updates, target: 1, noun: 'updates' },
  }
}

export const achievementService = {
  definitions(): AchievementDef[] {
    return ACHIEVEMENTS
  },

  /**
   * Every mark, with its unlock date if earned and how close it is if not.
   *
   * The progress figures come from the same measurements the unlock rules run
   * on, so a bar can never sit at 100% under a mark that is still locked.
   */
  async listForUser(userId: ID): Promise<AchievementView[]> {
    const [unlocked, measures] = await Promise.all([
      db.achievements.where('userId').equals(userId).toArray(),
      measuresFor(userId),
    ])
    const byKey = new Map(unlocked.map((u) => [u.achievementKey, u]))
    const towards = measures ? progressFrom(measures) : {}

    return ACHIEVEMENTS.map((def) => {
      const unlockedAt = byKey.get(def.key)?.unlockedAt
      if (unlockedAt) return { ...def, unlockedAt }

      const row = towards[def.key]
      if (!row) return { ...def }
      // Never let a locked mark read as finished: the rules are the authority
      // on unlocking, and a bar at 100% beside a padlock is a bug on screen.
      const current = Math.max(0, Math.min(row.current, row.target))
      return {
        ...def,
        progress: {
          current,
          target: row.target,
          pct: row.target === 0 ? 0 : Math.min(99, Math.floor((current / row.target) * 100)),
          noun: row.noun,
        },
      }
    })
  },

  async unlockedCount(userId: ID): Promise<number> {
    return db.achievements.where('userId').equals(userId).count()
  },

  async recent(userId: ID, limit = 4): Promise<AchievementView[]> {
    const rows = await db.achievements.where('userId').equals(userId).toArray()
    return rows
      .sort((a, b) => (a.unlockedAt < b.unlockedAt ? 1 : -1))
      .slice(0, limit)
      .flatMap<AchievementView>((row) => {
        const def = ACHIEVEMENT_BY_KEY.get(row.achievementKey)
        return def ? [{ ...def, unlockedAt: row.unlockedAt }] : []
      })
  },

  /**
   * Re-derives everything the user has earned and unlocks what is new. Safe to
   * call after any write; already-unlocked keys are left alone.
   */
  async evaluate(
    userId: ID,
    options: { announce?: boolean } = {},
  ): Promise<AchievementDef[]> {
    const [existing, measures] = await Promise.all([
      db.achievements.where('userId').equals(userId).toArray(),
      measuresFor(userId),
    ])
    if (!measures) return []

    const earned = earnedFrom(measures)
    const already = new Set(existing.map((e) => e.achievementKey))
    const newlyUnlocked: AchievementDef[] = []
    const rows: UserAchievement[] = []

    for (const def of ACHIEVEMENTS) {
      if (!earned[def.key] || already.has(def.key)) continue
      rows.push({ id: uid('ua'), userId, achievementKey: def.key, unlockedAt: now() })
      newlyUnlocked.push(def)
    }

    if (rows.length) {
      await db.achievements.bulkAdd(rows)
      // Seeding evaluates silently: the group does not need a burst of posts
      // for achievements that were earned by history rather than just now.
      if (options.announce !== false) {
        for (const def of newlyUnlocked) {
          await updateService.postOnce({
            userId,
            kind: 'achievement',
            dedupeKey: `achievement:${userId}:${def.key}`,
            text: `unlocked ${def.title} ${def.icon}`,
            meta: { key: def.key },
          })
        }
      }
    }
    return newlyUnlocked
  },
}
