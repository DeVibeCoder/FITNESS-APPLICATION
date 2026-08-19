import { db } from '@/lib/db'
import { uid, now } from '@/lib/id'
import type { BodyMeasurement, ID } from '@/models'
import { assertOwner, assertOwnerOf } from './ownership'

export const MEASUREMENT_FIELDS: {
  key: keyof Pick<BodyMeasurement, 'waistCm' | 'chestCm' | 'hipsCm' | 'armCm' | 'thighCm'>
  label: string
}[] = [
  { key: 'waistCm', label: 'Waist' },
  { key: 'chestCm', label: 'Chest' },
  { key: 'hipsCm', label: 'Hips' },
  { key: 'armCm', label: 'Arms' },
  { key: 'thighCm', label: 'Thighs' },
]

/** Measurements are optional everywhere — the scale is not the whole story. */
export const measurementService = {
  async listForUser(userId: ID): Promise<BodyMeasurement[]> {
    return db.measurements.where('userId').equals(userId).sortBy('date')
  },

  async latest(userId: ID): Promise<BodyMeasurement | undefined> {
    const rows = await this.listForUser(userId)
    return rows[rows.length - 1]
  },

  async first(userId: ID): Promise<BodyMeasurement | undefined> {
    return (await this.listForUser(userId))[0]
  },

  async save(input: Omit<BodyMeasurement, 'id' | 'createdAt'>): Promise<BodyMeasurement> {
    assertOwner(input.userId)
    const existing = await db.measurements
      .where('[userId+date]')
      .equals([input.userId, input.date])
      .first()
    const entry: BodyMeasurement = { ...input, id: existing?.id ?? uid('m'), createdAt: now() }
    await db.measurements.put(entry)
    return entry
  },

  async remove(id: ID): Promise<void> {
    assertOwnerOf(await db.measurements.get(id))
    await db.measurements.delete(id)
  },
}
