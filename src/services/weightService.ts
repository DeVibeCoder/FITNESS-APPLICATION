import { db } from '@/lib/db'
import { uid, now } from '@/lib/id'
import type { DateKey, ID, WeightEntry } from '@/models'
import { latestWeight } from '@/utils/progress'
import { signed } from '@/utils/format'
import { updateService } from './updateService'
import { assertOwner, assertOwnerOf } from './ownership'

export const weightService = {
  listForUser(userId: ID): Promise<WeightEntry[]> {
    return db.weights.where('userId').equals(userId).sortBy('date')
  },

  async listRange(userId: ID, from: DateKey, to: DateKey): Promise<WeightEntry[]> {
    const rows = await db.weights
      .where('[userId+date]')
      .between([userId, from], [userId, to], true, true)
      .toArray()
    return rows.sort((a, b) => (a.date < b.date ? -1 : 1))
  },

  async latest(userId: ID): Promise<WeightEntry | undefined> {
    return latestWeight(await this.listForUser(userId))
  },

  /** Current weight, falling back to the profile's starting weight. */
  async currentWeight(userId: ID): Promise<number> {
    const entry = await this.latest(userId)
    if (entry) return entry.weightKg
    const user = await db.users.get(userId)
    return user?.startWeightKg ?? 0
  },

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

    // One post per weigh-in day. Correcting the number later updates the
    // record without telling the group twice. The feed says that a weigh-in
    // happened and how the week moved — not the full history.
    if (input.announce !== false && input.kind === 'official') {
      await updateService.postOnce({
        userId: input.userId,
        kind: 'weight_logged',
        dedupeKey: `weigh-in:${input.userId}:${input.date}`,
        text: 'logged their weekly weigh-in',
        meta: { weightKg: entry.weightKg },
      })
    }
    return entry
  },

  /**
   * Tell the group about a weekly weigh-in, on purpose.
   *
   * Sharing is a choice made after saving, so the number can be recorded
   * privately and posted only if the person wants to. The post carries the
   * weight and the week's change and nothing else — no history, no measurements.
   */
  async shareWeighIn(userId: ID, date: DateKey): Promise<boolean> {
    assertOwner(userId)
    const entry = await db.weights
      .where('[userId+date]')
      .equals([userId, date])
      .filter((e) => e.kind === 'official')
      .first()
    if (!entry) return false

    const officials = (await this.listForUser(userId)).filter(
      (e) => e.kind === 'official' && e.date < date,
    )
    const previous = officials[officials.length - 1]
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
      dedupeKey: `weigh-in:${userId}:${date}`,
      text: `completed their weekly weigh-in${change}`,
      meta:
        changeKg === undefined
          ? { weightKg: entry.weightKg }
          : { weightKg: entry.weightKg, changeKg },
    })
    return true
  },

  /** Whether this weigh-in has already been posted to the group. */
  async isShared(userId: ID, date: DateKey): Promise<boolean> {
    const key = `weigh-in:${userId}:${date}`
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
