import { db } from '@/lib/db'
import { userService } from './userService'
import { now, uid } from '@/lib/id'
import type { ChallengeProgress, DateKey, GroupChallenge, ID } from '@/models'
import { daysBetween, startOfWeek, weekDays } from '@/utils/date'
import { updateService } from './updateService'

/**
 * One shared target a week, rotating through a small set.
 *
 * Deliberately not a competition: most challenges ask the same thing of
 * everyone, and the group total is what completes. Nobody is ranked and nobody
 * loses.
 */
type Template = Omit<GroupChallenge, 'id' | 'weekStart' | 'createdAt'>

const TEMPLATES: Template[] = [
  {
    title: '50,000 group steps',
    blurb: 'Everything the three of you walk this week, added together.',
    metric: 'steps',
    target: 50_000,
    perMember: false,
    unit: 'steps',
    icon: '🚶',
  },
  {
    title: '5 workouts each',
    blurb: 'Five sessions per person, in whichever app you train in.',
    metric: 'workouts',
    target: 5,
    perMember: true,
    unit: 'workouts',
    icon: '💪',
  },
  {
    title: 'Check in every day',
    blurb: 'A quick note on how you felt, all seven days.',
    metric: 'checkins',
    target: 7,
    perMember: true,
    unit: 'days',
    icon: '📝',
  },
  {
    title: 'Hit your water goal 5 days',
    blurb: 'Five days each of actually finishing the bottle.',
    metric: 'water',
    target: 5,
    perMember: true,
    unit: 'days',
    icon: '💧',
  },
  {
    title: 'Log your food 5 days',
    blurb: 'Five days each of writing down what you ate.',
    metric: 'nutrition',
    target: 5,
    perMember: true,
    unit: 'days',
    icon: '🍎',
  },
]

/** A stable epoch so the rotation does not shift when the clock does. */
const ROTATION_EPOCH: DateKey = '2026-01-04'

function templateForWeek(weekStart: DateKey): Template {
  const weeks = Math.floor(daysBetween(ROTATION_EPOCH, weekStart) / 7)
  // Negative weeks (a back-dated week) still land inside the array.
  const index = ((weeks % TEMPLATES.length) + TEMPLATES.length) % TEMPLATES.length
  return TEMPLATES[index]
}

export const challengeService = {
  /**
   * The challenge for a week, if it has been created.
   *
   * Strictly read-only. This is called from live queries, and a query that
   * writes invalidates itself — Dexie warns about exactly this, and the fix is
   * to make creation an explicit step rather than a side effect of looking.
   */
  async forWeek(date: DateKey): Promise<GroupChallenge | undefined> {
    return db.challenges.where('weekStart').equals(startOfWeek(date)).first()
  },

  /**
   * The challenge for a week, creating it if this is the first time anyone has
   * asked. Called once at start-up, never from a render.
   *
   * Which one a week gets is a pure function of the date, so every member sees
   * the same challenge without anything having to be synchronised.
   */
  async ensureWeek(date: DateKey): Promise<GroupChallenge> {
    const weekStart = startOfWeek(date)
    const existing = await this.forWeek(date)
    if (existing) return existing

    const challenge: GroupChallenge = {
      ...templateForWeek(weekStart),
      id: uid('gc'),
      weekStart,
      createdAt: now(),
    }
    // Two tabs opening at once would both try to create it; the unique index
    // on weekStart means the loser fails and re-reads rather than duplicating.
    try {
      await db.challenges.add(challenge)
      return challenge
    } catch {
      return (await this.forWeek(date)) ?? challenge
    }
  },

  /**
   * Progress for a week, derived entirely from the records the rest of the app
   * already writes. Nothing about a challenge is stored as a running total, so
   * deleting a workout correctly takes it back off the board.
   */
  async progress(date: DateKey): Promise<ChallengeProgress | null> {
    const challenge = await this.forWeek(date)
    if (!challenge) return null
    const days = weekDays(challenge.weekStart)
    const from = days[0]
    const to = days[days.length - 1]
    const users = await userService.listMembers()

    const contributions = await Promise.all(
      users.map(async (user) => {
        const value = await measure(challenge.metric, user.id, from, to, user.waterGoalL)
        return {
          userId: user.id,
          value,
          met: challenge.perMember ? value >= challenge.target : false,
        }
      }),
    )

    const total = contributions.reduce((sum, c) => sum + c.value, 0)
    const target = challenge.perMember ? challenge.target * users.length : challenge.target
    const complete = challenge.perMember
      ? contributions.every((c) => c.met) && contributions.length > 0
      : total >= challenge.target

    return {
      challenge,
      contributions,
      total,
      target,
      pct: target === 0 ? 0 : Math.min(100, Math.round((total / target) * 100)),
      complete,
    }
  },

  /**
   * Announce a finished challenge, once. Called after writes that could have
   * completed it; safe to call whenever.
   */
  async announceIfComplete(date: DateKey, userId: ID): Promise<boolean> {
    // An explicit action, so creating the week here is fine.
    await this.ensureWeek(date)
    const progress = await this.progress(date)
    if (!progress?.complete) return false
    await updateService.postOnce({
      userId,
      kind: 'challenge_completed',
      dedupeKey: `challenge:${progress.challenge.id}`,
      text: `— the group finished “${progress.challenge.title}” 🎉`,
      meta: { title: progress.challenge.title },
    })
    return true
  },
}

/** Each metric reads the same records the rest of the app writes. */
async function measure(
  metric: GroupChallenge['metric'],
  userId: ID,
  from: DateKey,
  to: DateKey,
  waterGoalL: number,
): Promise<number> {
  const span = [[userId, from], [userId, to], true, true] as const

  switch (metric) {
    case 'steps': {
      const rows = await db.steps.where('[userId+date]').between(...span).toArray()
      return rows.reduce((sum, row) => sum + row.steps, 0)
    }
    case 'workouts': {
      const rows = await db.sessions.where('[userId+date]').between(...span).toArray()
      return rows.filter((s) => s.status === 'completed').length
    }
    case 'checkins': {
      const rows = await db.checkins.where('[userId+date]').between(...span).toArray()
      return new Set(rows.map((r) => r.date)).size
    }
    case 'water': {
      const rows = await db.water.where('[userId+date]').between(...span).toArray()
      const byDay = new Map<DateKey, number>()
      for (const row of rows) byDay.set(row.date, (byDay.get(row.date) ?? 0) + row.ml)
      return [...byDay.values()].filter((ml) => ml >= waterGoalL * 1000).length
    }
    case 'nutrition': {
      const rows = await db.foods.where('[userId+date]').between(...span).toArray()
      return new Set(rows.map((r) => r.date)).size
    }
  }
}
