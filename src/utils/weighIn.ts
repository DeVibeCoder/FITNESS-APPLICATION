import type { DateKey, Weekday, WeightEntry } from '@/models'
import { addDays, fromDateKey, todayKey } from './date'

/**
 * The weekly weigh-in schedule.
 *
 * Weighing is weekly in this app: one number per person per week, taken on the
 * day they chose, and that is the number the group compares. The schedule is
 * therefore derived — every slot is seven days from the last one, counted back
 * from whichever occurrence of the user's weigh-in day has most recently
 * passed. Nothing here is a fixed date, and nothing is hard-coded: change the
 * weigh-in day in the profile and every slot below moves with it.
 *
 * Legacy `daily` rows, from before weighing became weekly, are deliberately
 * ignored here. A salty dinner should not be able to change what the week says.
 */

export interface WeighInSlot {
  /** The scheduled date for this week's weigh-in. */
  date: DateKey
  /** The official entry recorded for it, if there is one. */
  entry?: WeightEntry
  /** Change against the previous slot that has an entry. */
  changeKg?: number
  /** The slot the current date falls in. Exactly one is ever true. */
  current: boolean
  /** A slot whose date has not arrived yet. */
  upcoming: boolean
}

/**
 * The most recent occurrence of `weighInDay` on or before `on`.
 *
 * This is the anchor for everything else: today is always somewhere inside the
 * week that started on this date, so this is "the slot I am in".
 */
export function currentWeighInDate(weighInDay: Weekday, on: DateKey = todayKey()): DateKey {
  const daysSince = (fromDateKey(on).getDay() - weighInDay + 7) % 7
  return addDays(on, -daysSince)
}

/** The next scheduled weigh-in after the current one. Always seven days on. */
export function nextWeighInDate(weighInDay: Weekday, on: DateKey = todayKey()): DateKey {
  return addDays(currentWeighInDate(weighInDay, on), 7)
}

/**
 * Which slot an entry belongs to: the scheduled date at or before it.
 *
 * Logging a day late still counts for that week. The alternative — only
 * matching the exact day — would silently drop a Monday entry from a Sunday
 * schedule, and the person would be told they had missed a week they did not.
 */
export function slotFor(weighInDay: Weekday, date: DateKey): DateKey {
  return currentWeighInDate(weighInDay, date)
}

/** Half a year of rows is a history; three years of rows is a scroll. */
const MAX_WEEKS = 26

/**
 * The schedule, newest first.
 *
 * Runs from the current slot back to the first weigh-in on record and no
 * further. That matters: padding it out to a fixed number of weeks would print
 * "Missed" against half a dozen weeks that happened before the person joined,
 * which is both wrong and discouraging. Someone with no readings at all gets
 * this week and the next one — the shape of the thing, with nothing invented.
 *
 * `includeNext` prepends the next scheduled date, which is what makes "every
 * seven days from here" visible rather than something to take on trust.
 */
export function weighInSchedule(
  entries: WeightEntry[],
  weighInDay: Weekday,
  options: { on?: DateKey; includeNext?: boolean } = {},
): WeighInSlot[] {
  const on = options.on ?? todayKey()
  const current = currentWeighInDate(weighInDay, on)

  // One entry per slot. A correction logged later in the same week replaces
  // the earlier one rather than creating a second row for that week.
  const bySlot = slotMap(entries, weighInDay, current)

  const earliest = [...bySlot.keys()].sort()[0]
  const weeksBack = earliest
    ? Math.min(
        MAX_WEEKS,
        // Rounded, not floored: a week containing a DST change is 167 hours.
        Math.round(
          (fromDateKey(current).getTime() - fromDateKey(earliest).getTime()) / 604_800_000,
        ),
      )
    : 0

  const dates: DateKey[] = []
  if (options.includeNext) dates.push(addDays(current, 7))
  for (let week = 0; week <= weeksBack; week++) dates.push(addDays(current, -7 * week))

  /*
   * Changes are computed against the previous slot *that has a reading*, not
   * against the previous slot. Someone who misses a week and then weighs in
   * should see the change since they last stood on the scale, not a dash.
   */
  const withReadings = [...bySlot.entries()].sort(([a], [b]) => (a < b ? -1 : 1))

  return dates.map((date) => {
    const entry = bySlot.get(date)
    let changeKg: number | undefined
    if (entry) {
      const index = withReadings.findIndex(([slot]) => slot === date)
      const previous = index > 0 ? withReadings[index - 1][1] : undefined
      if (previous) changeKg = Math.round((entry.weightKg - previous.weightKg) * 10) / 10
    }
    return {
      date,
      entry,
      changeKg,
      current: date === current,
      upcoming: date > current,
    }
  })
}

// --- This week -------------------------------------------------------------

/**
 * One official reading per seven-day cycle, keyed by the cycle's date.
 *
 * Shared by the schedule and by `weeklyWeighIn` so both agree on which week a
 * reading belongs to. Future-dated rows are dropped: a schedule must not
 * contain a week that has not happened.
 */
function slotMap(
  entries: WeightEntry[],
  weighInDay: Weekday,
  current: DateKey,
): Map<DateKey, WeightEntry> {
  const bySlot = new Map<DateKey, WeightEntry>()
  const officials = entries
    .filter((entry) => entry.kind === 'official')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt < b.createdAt ? -1 : 1))
  for (const entry of officials) {
    const slot = slotFor(weighInDay, entry.date)
    if (slot <= current) bySlot.set(slot, entry)
  }
  return bySlot
}

/** This week's weigh-in: whether it has happened, and how the week moved. */
export interface WeeklyWeighIn {
  /** The date the current seven-day cycle started — where this week's reading belongs. */
  slotDate: DateKey
  /** The next scheduled weigh-in, always seven days after `slotDate`. */
  nextDate: DateKey
  /** This week's reading, once it exists. */
  entry?: WeightEntry
  /**
   * The last reading before this week — not necessarily last week's. Someone
   * who skips a week should be told how far they have come since they last
   * stood on the scale rather than shown a dash.
   */
  previous?: WeightEntry
  /** `entry` − `previous`, to 0.1 kg. Undefined until there are two readings. */
  changeKg?: number
  /** How many weeks back `previous` was. 1 for a normal week. */
  weeksSincePrevious?: number
  /** True once this week has a reading. This is the whole status question. */
  done: boolean
}

/**
 * The status the app shows everywhere: is this week's weigh-in done, what did
 * it say, and how did it move.
 *
 * Anchored to the user's own weigh-in day rather than to the calendar week, so
 * someone who weighs in on a Wednesday gets Wednesday-to-Wednesday and not a
 * change that resets every Sunday underneath them.
 */
export function weeklyWeighIn(
  entries: WeightEntry[],
  weighInDay: Weekday,
  on: DateKey = todayKey(),
): WeeklyWeighIn {
  const slotDate = currentWeighInDate(weighInDay, on)
  const bySlot = slotMap(entries, weighInDay, slotDate)

  const entry = bySlot.get(slotDate)
  const earlier = [...bySlot.entries()]
    .filter(([slot]) => slot < slotDate)
    .sort(([a], [b]) => (a < b ? -1 : 1))
  const previousSlot = earlier.at(-1)

  return {
    slotDate,
    nextDate: addDays(slotDate, 7),
    entry,
    previous: previousSlot?.[1],
    changeKg:
      entry && previousSlot
        ? Math.round((entry.weightKg - previousSlot[1].weightKg) * 10) / 10
        : undefined,
    weeksSincePrevious: previousSlot
      ? Math.round(
          (fromDateKey(slotDate).getTime() - fromDateKey(previousSlot[0]).getTime()) / 604_800_000,
        )
      : undefined,
    done: Boolean(entry),
  }
}
