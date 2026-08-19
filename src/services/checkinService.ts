import { db } from '@/lib/db'
import { uid, now } from '@/lib/id'
import type { DailyCheckIn, DateKey, ID } from '@/models'
import { updateService } from './updateService'
import { assertOwner, assertOwnerOf } from './ownership'

export const ENERGY_OPTIONS: { value: 1 | 2 | 3 | 4; label: string }[] = [
  { value: 1, label: 'Low' },
  { value: 2, label: 'Okay' },
  { value: 3, label: 'Good' },
  { value: 4, label: 'Great' },
]

export const MOOD_OPTIONS: { value: 1 | 2 | 3 | 4 | 5; emoji: string; label: string }[] = [
  { value: 1, emoji: '😞', label: 'Rough' },
  { value: 2, emoji: '😐', label: 'Flat' },
  { value: 3, emoji: '🙂', label: 'Fine' },
  { value: 4, emoji: '😄', label: 'Good' },
  { value: 5, emoji: '🔥', label: 'Great' },
]

export const SORENESS_OPTIONS: { value: DailyCheckIn['soreness']; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

export const checkinService = {
  async forDay(userId: ID, date: DateKey): Promise<DailyCheckIn | undefined> {
    return db.checkins.where('[userId+date]').equals([userId, date]).first()
  },

  async listRange(userId: ID, from: DateKey, to: DateKey): Promise<DailyCheckIn[]> {
    const rows = await db.checkins
      .where('[userId+date]')
      .between([userId, from], [userId, to], true, true)
      .toArray()
    return rows.sort((a, b) => (a.date < b.date ? -1 : 1))
  },

  /** Re-checking in the same day overwrites — moods change. */
  async save(input: Omit<DailyCheckIn, 'id' | 'createdAt'>): Promise<DailyCheckIn> {
    assertOwner(input.userId)
    const existing = await this.forDay(input.userId, input.date)
    const entry: DailyCheckIn = { ...input, id: existing?.id ?? uid('ci'), createdAt: now() }
    await db.checkins.put(entry)

    if (!existing) {
      const mood = MOOD_OPTIONS.find((m) => m.value === input.mood)
      await updateService.postOnce({
        userId: input.userId,
        kind: 'checkin',
        dedupeKey: `checkin:${input.userId}:${input.date}`,
        text: `checked in — ${mood?.label.toLowerCase() ?? 'ok'} today`,
        meta: { mood: input.mood, energy: input.energy },
      })
    }
    return entry
  },

  async remove(id: ID): Promise<void> {
    assertOwnerOf(await db.checkins.get(id))
    await db.checkins.delete(id)
  },
}
