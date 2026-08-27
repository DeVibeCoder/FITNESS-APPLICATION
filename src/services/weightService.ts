import { db } from '@/lib/db'
import { uid, now } from '@/lib/id'
import type { DateKey, ID, Weekday, WeightEntry } from '@/models'
import { latestWeight } from '@/utils/progress'
import { signed } from '@/utils/format'
import { todayKey } from '@/utils/date'
import { currentWeighInDate, slotFor, weeklyWeighIn, type WeeklyWeighIn } from '@/utils/weighIn'
import { updateService } from './updateService'
import { assertOwner, assertOwnerOf } from './ownership'

/** The weekly weigh-in is the only kind this app writes. See `WeightEntry.kind`. */
const OFFICIAL: WeightEntry['kind'] = 'official'

/** Anything outside this is a typo, not a body. */
const MIN_KG = 20
const MAX_KG = 400

export function isPlausibleWeight(weightKg: number): boolean {
  return Number.isFinite(weightKg) && weightKg >= MIN_KG && weightKg <= MAX_KG
}

/** What `weighIn` did, so the caller can decide what to say about it. */
export interface WeighInResult {
  entry: WeightEntry
  /** The seven-day cycle it was filed under. */
  slotDate: DateKey
  /** Change against the previous recorded week, to 0.1 kg. */
  changeKg?: number
  /** False when this corrected a reading already taken this week. */
  created: boolean
}

export const weightService = {
  listForUser(userId: ID): Promise<WeightEntry[]> {
    return db.weights.where('userId').equals(userId).sortBy('date')
  },

  /**
   * The weekly weigh-ins, oldest first — the only weight history the app shows.
   *
   * Older databases can still hold `daily` rows from before weighing became
   * weekly. They are read out here and nowhere else, so a stray morning
   * reading can never turn up as a week's number.
   */
  async listWeekly(userId: ID): Promise<WeightEntry[]> {
    return (await this.listForUser(userId)).filter((entry) => entry.kind === OFFICIAL)
  },

  async listRange(userId: ID, from: DateKey, to: DateKey): Promise<WeightEntry[]> {
    const rows = await db.weights
      .where('[userId+date]')
      .between([userId, from], [userId, to], true, true)
      .toArray()
    return rows.sort((a, b) => (a.date < b.date ? -1 : 1))
  },

  /** The most recent weekly weigh-in. */
  async latest(userId: ID): Promise<WeightEntry | undefined> {
    return latestWeight(await this.listWeekly(userId))
  },

  /** Current weight, falling back to the profile's starting weight. */
  async currentWeight(userId: ID): Promise<number> {
    const entry = await this.latest(userId)
    if (entry) return entry.weightKg
    const user = await db.users.get(userId)
    return user?.startWeightKg ?? 0
  },

  /** The date this week's weigh-in belongs to, from the user's own schedule. */
  async slotDate(userId: ID, on: DateKey = todayKey()): Promise<DateKey> {
    const user = await db.users.get(userId)
    return currentWeighInDate((user?.weighInDay ?? 0) as Weekday, on)
  },

  /**
   * This week's status: due or complete, the number, and how the week moved.
   * The one read behind every weigh-in surface in the app.
   */
  async thisWeek(userId: ID, on: DateKey = todayKey()): Promise<WeeklyWeighIn> {
    const user = await db.users.get(userId)
    const entries = await this.listWeekly(userId)
    return weeklyWeighIn(entries, (user?.weighInDay ?? 0) as Weekday, on)
  },

  /**
   * Record this week's weigh-in.
   *
   * The date is the app's decision, not the user's: whichever seven-day cycle
   * today falls in. That is what makes a second entry on Thursday a correction
   * to Sunday's number rather than a second week appearing out of nowhere —
   * the existing row for the cycle is found and updated in place, keeping its
   * id, so nothing downstream sees two weigh-ins for one week.
   *
   * Nothing is posted to the group here. Saving is private; sharing is a
   * separate, deliberate call to `shareWeighIn`.
   */
  async weighIn(input: {
    userId: ID
    weightKg: number
    note?: string
    /** Defaults to today. Present so tests can stand somewhere else in time. */
    on?: DateKey
  }): Promise<WeighInResult> {
    assertOwner(input.userId)
    if (!isPlausibleWeight(input.weightKg)) {
      throw new Error(`Weight must be between ${MIN_KG} and ${MAX_KG} kg.`)
    }

    const on = input.on ?? todayKey()
    const user = await db.users.get(input.userId)
    const weighInDay = (user?.weighInDay ?? 0) as Weekday
    const slotDate = currentWeighInDate(weighInDay, on)

    const weekly = await this.listWeekly(input.userId)
    // Any reading already filed against this cycle, whatever day it was taken.
    const existing = weekly.find((entry) => slotFor(weighInDay, entry.date) === slotDate)

    const entry: WeightEntry = {
      id: existing?.id ?? uid('w'),
      userId: input.userId,
      date: slotDate,
      weightKg: Math.round(input.weightKg * 10) / 10,
      kind: OFFICIAL,
      note: input.note?.trim() || undefined,
      createdAt: existing?.createdAt ?? now(),
    }
    await db.weights.put(entry)

    const previous = weekly
      .filter((row) => slotFor(weighInDay, row.date) < slotDate)
      .at(-1)

    return {
      entry,
      slotDate,
      changeKg: previous
        ? Math.round((entry.weightKg - previous.weightKg) * 10) / 10
        : undefined,
      created: !existing,
    }
  },

  /**
   * Lower-level write, kept for the seed and for tests that need to place a
   * reading on a specific date. Silent by nature: like `weighIn`, it tells
   * nobody. Pass `announce: true` only when a caller genuinely means to post.
   */
  async add(input: {
    userId: ID
    date: DateKey
    weightKg: number
    kind: WeightEntry['kind']
    note?: string
    announce?: boolean
  }): Promise<WeightEntry> {
    assertOwner(input.userId)
    // One entry per day per kind — logging twice corrects, it does not duplicate.
    const existing = await db.weights
      .where('[userId+date]')
      .equals([input.userId, input.date])
      .filter((e) => e.kind === input.kind)
      .first()

    const entry: WeightEntry = {
      id: existing?.id ?? uid('w'),
      userId: input.userId,
      date: input.date,
      weightKg: Math.round(input.weightKg * 10) / 10,
      kind: input.kind,
      note: input.note,
      createdAt: now(),
    }
    await db.weights.put(entry)

    if (input.announce === true && input.kind === OFFICIAL) {
      await this.shareWeighIn(input.userId, input.date)
    }
    return entry
  },

  /**
   * Tell the group about a weekly weigh-in, on purpose.
   *
   * Sharing is a choice made after saving, so the number can be recorded
   * privately and posted only if the person wants to. The post carries the
   * weight and the week's change and nothing else — no history, no measurements.
   *
   * Keyed by the cycle, not by the day it was typed, so correcting the number
   * later updates the record without telling the group a second time.
   */
  async shareWeighIn(userId: ID, date: DateKey): Promise<boolean> {
    assertOwner(userId)
    const user = await db.users.get(userId)
    const weighInDay = (user?.weighInDay ?? 0) as Weekday
    const slot = slotFor(weighInDay, date)

    const weekly = await this.listWeekly(userId)
    const entry = weekly.find((row) => slotFor(weighInDay, row.date) === slot)
    if (!entry) return false

    const previous = weekly.filter((row) => slotFor(weighInDay, row.date) < slot).at(-1)
    const changeKg = previous
      ? Math.round((entry.weightKg - previous.weightKg) * 10) / 10
      : undefined

    const change =
      changeKg === undefined
        ? ''
        : ` — ${signed(changeKg)} kg this week${changeKg < 0 ? ' 🔥' : ''}`

    await updateService.postOnce({
      userId,
      kind: 'weight_logged',
      dedupeKey: `weigh-in:${userId}:${slot}`,
      text: `completed their weekly weigh-in${change}`,
      meta:
        changeKg === undefined
          ? { weightKg: entry.weightKg }
          : { weightKg: entry.weightKg, changeKg },
    })
    return true
  },

  /** Whether this week's weigh-in has already been posted to the group. */
  async isShared(userId: ID, date: DateKey): Promise<boolean> {
    const user = await db.users.get(userId)
    const slot = slotFor((user?.weighInDay ?? 0) as Weekday, date)
    const key = `weigh-in:${userId}:${slot}`
    return Boolean(await db.updates.filter((row) => row.dedupeKey === key).first())
  },

  async update(id: ID, changes: Partial<Pick<WeightEntry, 'weightKg' | 'date' | 'note' | 'kind'>>) {
    assertOwnerOf(await db.weights.get(id))
    await db.weights.update(id, changes)
  },

  async remove(id: ID): Promise<void> {
    assertOwnerOf(await db.weights.get(id))
    await db.weights.delete(id)
  },
}
