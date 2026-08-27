import { db } from '@/lib/db'
import { uid, now } from '@/lib/id'
import type { AchievementDef, ID, UserAchievement } from '@/models'
import { ACHIEVEMENTS, ACHIEVEMENT_BY_KEY } from '@/data/achievements'
import { currentStreak } from '@/utils/streaks'
import { updateService } from './updateService'
import { workoutService } from './workoutService'

export interface AchievementView extends AchievementDef {
  unlockedAt?: string
}

export const achievementService = {
  definitions(): AchievementDef[] {
    return ACHIEVEMENTS
  },

  async listForUser(userId: ID): Promise<AchievementView[]> {
    const unlocked = await db.achievements.where('userId').equals(userId).toArray()
    const byKey = new Map(unlocked.map((u) => [u.achievementKey, u]))
    return ACHIEVEMENTS.map((def) => ({ ...def, unlockedAt: byKey.get(def.key)?.unlockedAt }))
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
    const [user, sessions, weights, steps, existing, bests, foods, updates] = await Promise.all([
      db.users.get(userId),
      db.sessions.where('userId').equals(userId).toArray(),
      db.weights.where('userId').equals(userId).sortBy('date'),
      db.steps.where('userId').equals(userId).toArray(),
      db.achievements.where('userId').equals(userId).toArray(),
      workoutService.personalBests(userId),
      db.foods.where('userId').equals(userId).toArray(),
      db.updates.where('userId').equals(userId).count(),
    ])
    if (!user) return []

    const completed = sessions.filter((s) => s.status === 'completed')
    const totalSteps = steps.reduce((sum, s) => sum + s.steps, 0)
    const officialWeighIns = weights.filter((w) => w.kind === 'official')
    const nutritionDays = new Set(foods.map((f) => f.date)).size

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
    const reachedGoal =
      officialWeighIns.length > 0 &&
      ((wantsToLose && latest <= user.targetWeightKg) ||
        (wantsToGain && latest >= user.targetWeightKg))

    const activeDates = new Set<string>([
      ...completed.map((s) => s.date),
      ...steps.map((s) => s.date),
      ...weights.map((w) => w.date),
    ])
    const streak = currentStreak(activeDates)

    const earned: Record<string, boolean> = {
      first_workout: completed.length >= 1,
      five_workouts: completed.length >= 5,
      ten_workouts: completed.length >= 10,
      twentyfive_workouts: completed.length >= 25,
      fifty_workouts: completed.length >= 50,
      hundred_workouts: completed.length >= 100,

      streak_3: streak >= 3,
      streak_7: streak >= 7,
      streak_14: streak >= 14,
      streak_30: streak >= 30,
      streak_60: streak >= 60,
      streak_90: streak >= 90,

      steps_10k_day: steps.some((s) => s.steps >= 10_000),
      steps_50k: totalSteps >= 50_000,
      steps_100k: totalSteps >= 100_000,
      steps_500k: totalSteps >= 500_000,
      steps_1m: totalSteps >= 1_000_000,

      first_kg: movedKg >= 1,
      three_kg: movedKg >= 3,
      five_kg: movedKg >= 5,
      ten_kg: movedKg >= 10,
      goal_reached: reachedGoal,

      nutrition_7: nutritionDays >= 7,
      nutrition_14: nutritionDays >= 14,
      nutrition_30: nutritionDays >= 30,

      consistency_7: activeDates.size >= 7,
      consistency_30: activeDates.size >= 30,
      consistency_60: activeDates.size >= 60,

      first_weigh_in: officialWeighIns.length >= 1,
      first_update: updates >= 1,
      // A real personal best needs recorded sets to compare, not just a
      // session that happens to be the longest so far.
      first_pr: bests.length > 0,
    }

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
