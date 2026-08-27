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

/**
 * The one-tap answer to "how are you feeling today?".
 *
 * Deliberately not a second check-in system. Each feeling is a shortcut into
 * the check-in that already exists — mood, energy and soreness written in one
 * tap — so the quick prompt on Activity and the full form in the Create sheet
 * read and write exactly the same record.
 */
export const FEELING_OPTIONS: {
  key: string
  emoji: string
  label: string
  mood: DailyCheckIn['mood']
  energy: DailyCheckIn['energy']
  soreness: DailyCheckIn['soreness']
}[] = [
  { key: 'great', emoji: '🙂', label: 'Great', mood: 4, energy: 4, soreness: 'none' },
  { key: 'okay', emoji: '😐', label: 'Okay', mood: 3, energy: 3, soreness: 'none' },
  { key: 'tired', emoji: '😓', label: 'Tired', mood: 2, energy: 2, soreness: 'low' },
  { key: 'low', emoji: '😴', label: 'Low energy', mood: 2, energy: 1, soreness: 'none' },
  { key: 'strong', emoji: '💪', label: 'Strong', mood: 5, energy: 4, soreness: 'none' },
]

/**
 * Which feeling a saved check-in reads as, so the prompt can show what was
 * already chosen. Matched on mood and energy together — the pair is what
 * separates "tired" from "low energy" — and undefined when the person used the
 * full form and landed somewhere none of the five describes.
 */
export function feelingFor(
  checkIn: Pick<DailyCheckIn, 'mood' | 'energy'> | undefined,
): (typeof FEELING_OPTIONS)[number] | undefined {
  if (!checkIn) return undefined
  return FEELING_OPTIONS.find(
    (option) => option.mood === checkIn.mood && option.energy === checkIn.energy,
  )
}

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
