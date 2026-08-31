import { db } from '@/lib/db'
import { userService } from './userService'
import { now, uid } from '@/lib/id'
import { assertOwner } from './ownership'
import type {
  ChallengeContribution,
  ChallengeProgress,
  ChallengeStatus,
  DateKey,
  GroupChallenge,
  ID,
} from '@/models'
import { daysBetween, endOfWeek, startOfWeek, todayKey, weekDays } from '@/utils/date'
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

  // --- Taking part ---------------------------------------------------------

  /**
   * Everyone sitting this challenge out.
   *
   * Rows only exist for people who made a choice, so this is normally empty
   * and the whole group is on the board — see `ChallengeParticipant`.
   */
  async sittingOut(challengeId: ID): Promise<ID[]> {
    const rows = await db.challengeParticipants.where('challengeId').equals(challengeId).toArray()
    return rows.filter((row) => row.leftAt).map((row) => row.userId)
  },

  /** Is this person on the board? Everyone is, until they say otherwise. */
  async isTakingPart(challengeId: ID, userId: ID): Promise<boolean> {
    const row = await db.challengeParticipants
      .where('[challengeId+userId]')
      .equals([challengeId, userId])
      .first()
    return !row?.leftAt
  },

  /**
   * Sit this week out.
   *
   * Nothing is deleted and nothing already logged is affected — the person
   * simply stops being counted toward this week's target, which is what keeps
   * a per-member challenge honest when one of three is away or injured.
   */
  async leave(challengeId: ID, userId: ID): Promise<void> {
    // You answer for yourself. The same check a server would run.
    assertOwner(userId)
    const existing = await db.challengeParticipants
      .where('[challengeId+userId]')
      .equals([challengeId, userId])
      .first()
    if (existing) {
      if (existing.leftAt) return
      await db.challengeParticipants.update(existing.id, { leftAt: now() })
      return
    }
    await db.challengeParticipants.add({
      id: uid('cp'),
      challengeId,
      userId,
      joinedAt: now(),
      leftAt: now(),
    })
  },

  /** Join back in. Progress is derived, so the week's records come back too. */
  async join(challengeId: ID, userId: ID): Promise<void> {
    assertOwner(userId)
    const existing = await db.challengeParticipants
      .where('[challengeId+userId]')
      .equals([challengeId, userId])
      .first()
    if (!existing) return
    // The row stays: it is the record that a choice was made, and clearing the
    // date is what puts the person back on the board.
    await db.challengeParticipants.update(existing.id, { leftAt: undefined, joinedAt: now() })
  },

  // --- Progress ------------------------------------------------------------

  /**
   * Progress for a week, derived entirely from the records the rest of the app
   * already writes. Nothing about a challenge is stored as a running total, so
   * deleting a workout correctly takes it back off the board.
   *
   * Only members count, and only members taking part: a pending account is not
   * in the group, and somebody sitting the week out asked not to be counted.
   */
  async progress(date: DateKey, asOf: DateKey = todayKey()): Promise<ChallengeProgress | null> {
    const challenge = await this.forWeek(date)
    if (!challenge) return null
    const days = weekDays(challenge.weekStart)
    const from = days[0]
    const to = days[days.length - 1]
    const [users, out] = await Promise.all([
      userService.listMembers(),
      this.sittingOut(challenge.id).then((ids) => new Set(ids)),
    ])
    const taking = users.filter((user) => !out.has(user.id))

    const measured = await Promise.all(
      taking.map(async (user) => {
        const value = await measure(challenge.metric, user.id, from, to, user.waterGoalL)
        return {
          userId: user.id,
          value,
          met: challenge.perMember ? value >= challenge.target : false,
        }
      }),
    )

    const total = measured.reduce((sum, c) => sum + c.value, 0)
    const target = challenge.perMember ? challenge.target * taking.length : challenge.target
    const complete =
      taking.length > 0 &&
      (challenge.perMember ? measured.every((c) => c.met) : total >= challenge.target)

    return {
      challenge,
      contributions: ranked(measured),
      // Only people still in the group: somebody whose account was never
      // approved is not sitting this one out, they are simply not here.
      sittingOut: users.filter((user) => out.has(user.id)).map((user) => user.id),
      total,
      target,
      pct: target === 0 ? 0 : Math.min(100, Math.round((total / target) * 100)),
      complete,
      ...runsFor(challenge.weekStart, asOf),
    }
  },

  /**
   * Challenges from weeks already finished, newest first.
   *
   * Read exactly the way the live one is, so a past week says whether it was
   * actually completed rather than being remembered as a title. Nothing is
   * created here: a week nobody opened the app during has no challenge, and
   * inventing one afterwards would put a target on the board that the group
   * was never asked for.
   */
  async history(date: DateKey = todayKey(), limit = 4): Promise<ChallengeProgress[]> {
    const thisWeek = startOfWeek(date)
    const past = (await db.challenges.toArray())
      .filter((challenge) => challenge.weekStart < thisWeek)
      .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
      .slice(0, limit)

    const rows = await Promise.all(past.map((challenge) => this.progress(challenge.weekStart, date)))
    return rows.filter((row): row is ChallengeProgress => row !== null)
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

/**
 * Standard competition ranking: two people on 40 both come second, and the
 * next one comes fourth. Ordering is what makes a board readable at a glance;
 * the number itself is never presented as a score.
 */
function ranked(rows: { userId: ID; value: number; met: boolean }[]): ChallengeContribution[] {
  const sorted = [...rows].sort((a, b) => b.value - a.value || a.userId.localeCompare(b.userId))
  let rank = 0
  let previous: number | null = null
  return sorted.map((row, index) => {
    if (previous === null || row.value !== previous) rank = index + 1
    previous = row.value
    return { ...row, rank }
  })
}

/**
 * When a challenge runs, and how much of it is left.
 *
 * Derived from `weekStart` rather than stored: both dates are the same week
 * boundary the rest of the app already computes, and a second copy on the row
 * is a second thing that can be wrong.
 */
function runsFor(
  weekStart: DateKey,
  asOf: DateKey,
): { startDate: DateKey; endDate: DateKey; daysLeft: number; status: ChallengeStatus } {
  const endDate = endOfWeek(weekStart)
  const status: ChallengeStatus =
    asOf < weekStart ? 'upcoming' : asOf > endDate ? 'ended' : 'active'
  return {
    startDate: weekStart,
    endDate,
    // Inclusive of the day being asked about, so the last day reads "1 day left".
    daysLeft: status === 'ended' ? 0 : daysBetween(asOf < weekStart ? weekStart : asOf, endDate) + 1,
    status,
  }
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
