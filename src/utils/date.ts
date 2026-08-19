import type { DateKey } from '@/models'

/** The group's week runs Sunday → Saturday, matching how they already report. */
export const WEEK_STARTS_ON = 0

const MS_DAY = 86_400_000

/** Local calendar day as 'YYYY-MM-DD'. Never use toISOString() — that is UTC. */
export function toDateKey(date: Date = new Date()): DateKey {
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function fromDateKey(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayKey(): DateKey {
  return toDateKey(new Date())
}

export function addDays(key: DateKey, days: number): DateKey {
  const d = fromDateKey(key)
  d.setDate(d.getDate() + days)
  return toDateKey(d)
}

export function daysBetween(a: DateKey, b: DateKey): number {
  return Math.round((fromDateKey(b).getTime() - fromDateKey(a).getTime()) / MS_DAY)
}

export function startOfWeek(key: DateKey = todayKey()): DateKey {
  const d = fromDateKey(key)
  const diff = (d.getDay() - WEEK_STARTS_ON + 7) % 7
  return addDays(key, -diff)
}

export function endOfWeek(key: DateKey = todayKey()): DateKey {
  return addDays(startOfWeek(key), 6)
}

/** Every day in the week containing `key`, Sunday first. */
export function weekDays(key: DateKey = todayKey()): DateKey[] {
  const start = startOfWeek(key)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** The `count` days ending at `key`, oldest first. */
export function lastNDays(count: number, key: DateKey = todayKey()): DateKey[] {
  return Array.from({ length: count }, (_, i) => addDays(key, i - count + 1))
}

export function startOfMonth(key: DateKey): DateKey {
  return `${key.slice(0, 7)}-01`
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

export function isToday(key: DateKey): boolean {
  return key === todayKey()
}

// --- Formatting ------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** 'Aug 13' */
export function formatDay(key: DateKey): string {
  const d = fromDateKey(key)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/** 'Saturday, 15 August' */
export function formatFullDate(key: DateKey): string {
  const d = fromDateKey(key)
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    d.getDay()
  ]
  return `${day}, ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`
}

/** 'Aug 9 – Aug 15' */
export function formatRange(start: DateKey, end: DateKey): string {
  return `${formatDay(start)} – ${formatDay(end)}`
}

export function monthLabel(year: number, monthIndex: number): string {
  return `${MONTHS_LONG[monthIndex]} ${year}`
}

export function weekdayLabel(key: DateKey): string {
  return DAYS[fromDateKey(key).getDay()]
}

export const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** '8:53 PM' */
export function formatClock(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours()
  const m = `${d.getMinutes()}`.padStart(2, '0')
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${suffix}`
}

/** '10 min ago', 'Yesterday' — deliberately vague, like a person would say it. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime())
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return formatDay(toDateKey(new Date(iso)))
}

/** 'Good morning' / 'Good afternoon' / 'Good evening' */
export function greeting(now: Date = new Date()): string {
  const h = now.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}
