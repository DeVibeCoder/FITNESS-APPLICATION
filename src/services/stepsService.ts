import { db } from '@/lib/db'
import { uid, now } from '@/lib/id'
import type { DateKey, ID, StepEntry } from '@/models'
import { updateService } from './updateService'
import { num } from '@/utils/format'
import { assertOwner, assertOwnerOf } from './ownership'

/**
 * Manual entry today. Device integrations (HealthKit, Health Connect, Fitbit)
 * would land as additional `source` values writing through this same service.
 */
export const stepsService = {
  async forDay(userId: ID, date: DateKey): Promise<number> {
    const entry = await db.steps.where('[userId+date]').equals([userId, date]).first()
    return entry?.steps ?? 0
  },

  async listRange(userId: ID, from: DateKey, to: DateKey): Promise<StepEntry[]> {
    const rows = await db.steps
      .where('[userId+date]')
      .between([userId, from], [userId, to], true, true)
      .toArray()
    return rows.sort((a, b) => (a.date < b.date ? -1 : 1))
  },

  /** Replaces the day's count rather than adding to it — people read one number off a watch. */
  async set(input: {
    userId: ID
    date: DateKey
    steps: number
    source?: StepEntry['source']
    announce?: boolean
  }): Promise<StepEntry> {
    assertOwner(input.userId)
    const existing = await db.steps.where('[userId+date]').equals([input.userId, input.date]).first()
    const entry: StepEntry = {
      id: existing?.id ?? uid('st'),
      userId: input.userId,
      date: input.date,
      steps: Math.max(0, Math.round(input.steps)),
      source: input.source ?? 'manual',
      createdAt: now(),
    }
    await db.steps.put(entry)

    // Worth telling the group about when the goal is reached — once per day,
    // however many times the count is corrected afterwards.
    if (input.announce !== false) {
      const user = await db.users.get(input.userId)
      const goal = user?.stepGoal ?? 0
      if (goal > 0 && entry.steps >= goal) {
        await updateService.postOnce({
          userId: input.userId,
          kind: 'steps_logged',
          dedupeKey: `steps-goal:${input.userId}:${input.date}`,
          text: `reached ${num(goal)} steps 🚶`,
          meta: { steps: entry.steps },
        })
      }
    }
    return entry
  },

  async remove(id: ID): Promise<void> {
    assertOwnerOf(await db.steps.get(id))
    await db.steps.delete(id)
  },
}
