import { db } from '@/lib/db'
import { uid, now } from '@/lib/id'
import type { DateKey, FoodEntry, ID, MealSlot, WaterEntry } from '@/models'
import { assertOwner, assertOwnerOf } from './ownership'
import { updateService } from './updateService'
import { todayKey } from '@/utils/date'

export interface MacroTotals {
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
}

export const MEAL_SLOTS: { value: MealSlot; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snacks', label: 'Snacks' },
]

export function sumMacros(entries: FoodEntry[]): MacroTotals {
  return entries.reduce<MacroTotals>(
    (totals, entry) => ({
      kcal: totals.kcal + entry.kcal,
      proteinG: totals.proteinG + entry.proteinG,
      carbsG: totals.carbsG + entry.carbsG,
      fatG: totals.fatG + entry.fatG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  )
}

export const nutritionService = {
  async foodForDay(userId: ID, date: DateKey): Promise<FoodEntry[]> {
    const rows = await db.foods.where('[userId+date]').equals([userId, date]).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  },

  async totalsForDay(userId: ID, date: DateKey): Promise<MacroTotals> {
    return sumMacros(await this.foodForDay(userId, date))
  },

  async daysLogged(userId: ID, dates: DateKey[]): Promise<number> {
    let count = 0
    for (const date of dates) {
      const found = await db.foods.where('[userId+date]').equals([userId, date]).first()
      if (found) count += 1
    }
    return count
  },

  /**
   * `source: 'photo'` records come from the food-scan flow. Only these numbers
   * are stored — the photo itself never reaches the database.
   */
  async addFood(input: Omit<FoodEntry, 'id' | 'createdAt'>): Promise<FoodEntry> {
    assertOwner(input.userId)
    const firstOfDay = (await this.foodForDay(input.userId, input.date)).length === 0
    const entry: FoodEntry = { ...input, id: uid('f'), createdAt: now() }
    await db.foods.add(entry)

    // The group sees that nutrition was logged, never what was eaten. Posted
    // once per day so the feed does not turn into a food diary.
    if (firstOfDay && input.date === todayKey()) {
      await updateService.postOnce({
        userId: input.userId,
        kind: 'checkin',
        dedupeKey: `nutrition:${input.userId}:${input.date}`,
        text: 'logged nutrition today',
      })
    }
    return entry
  },

  async updateFood(id: ID, changes: Partial<Omit<FoodEntry, 'id' | 'userId'>>): Promise<void> {
    assertOwnerOf(await db.foods.get(id))
    await db.foods.update(id, changes)
  },

  async removeFood(id: ID): Promise<void> {
    assertOwnerOf(await db.foods.get(id))
    await db.foods.delete(id)
  },

  /** A day's food grouped by meal, in the order meals are eaten. */
  async byMeal(userId: ID, date: DateKey): Promise<Record<MealSlot, FoodEntry[]>> {
    const entries = await this.foodForDay(userId, date)
    const grouped = { breakfast: [], lunch: [], dinner: [], snacks: [] } as Record<
      MealSlot,
      FoodEntry[]
    >
    for (const entry of entries) grouped[entry.meal].push(entry)
    return grouped
  },

  /** Totals plus water for one day — everything the nutrition screen reads. */
  async dayNutrition(
    userId: ID,
    date: DateKey,
  ): Promise<{ totals: MacroTotals; waterMl: number; entries: FoodEntry[] }> {
    const [entries, waterMl] = await Promise.all([
      this.foodForDay(userId, date),
      this.waterForDay(userId, date),
    ])
    return { totals: sumMacros(entries), waterMl, entries }
  },

  /** Per-day summaries for the date strip and history. */
  async history(
    userId: ID,
    dates: DateKey[],
  ): Promise<Record<DateKey, { kcal: number; waterMl: number; entries: number }>> {
    const summaries = await Promise.all(
      dates.map(async (date) => {
        const { totals, waterMl, entries } = await this.dayNutrition(userId, date)
        return [date, { kcal: totals.kcal, waterMl, entries: entries.length }] as const
      }),
    )
    return Object.fromEntries(summaries)
  },

  async waterForDay(userId: ID, date: DateKey): Promise<number> {
    const rows = await db.water.where('[userId+date]').equals([userId, date]).toArray()
    return rows.reduce((total, row) => total + row.ml, 0)
  },

  async addWater(userId: ID, date: DateKey, ml: number): Promise<WaterEntry> {
    assertOwner(userId)
    const entry: WaterEntry = { id: uid('h2o'), userId, date, ml, createdAt: now() }
    await db.water.add(entry)
    return entry
  },

  /**
   * Replaces a day's water with one figure. Used by the "set exact amount"
   * control; the incremental entries are collapsed rather than a second
   * hydration model being introduced.
   */
  async setWaterTotal(userId: ID, date: DateKey, ml: number): Promise<void> {
    assertOwner(userId)
    const rows = await db.water.where('[userId+date]').equals([userId, date]).toArray()
    await db.water.bulkDelete(rows.map((row) => row.id))
    const total = Math.max(0, Math.round(ml))
    if (total > 0) {
      await db.water.add({ id: uid('h2o'), userId, date, ml: total, createdAt: now() })
    }
  },

  /** Undo for the last glass — nobody wants a form to remove 250 ml. */
  async removeLastWater(userId: ID, date: DateKey): Promise<void> {
    assertOwner(userId)
    const rows = await db.water.where('[userId+date]').equals([userId, date]).toArray()
    const last = rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
    if (last) await db.water.delete(last.id)
  },
}
