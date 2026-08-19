/** Display formatting. Kept out of components so numbers read identically everywhere. */

export function num(value: number, digits = 0): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** '76.8 kg' */
export function kg(value: number, unit = true): string {
  return `${num(value, 1)}${unit ? ' kg' : ''}`
}

/** '+0.4' / '−0.8' — a true minus sign, and a sign always shown. */
export function signed(value: number, digits = 1): string {
  if (Math.abs(value) < 10 ** -digits / 2) return num(0, digits)
  const sign = value > 0 ? '+' : '−'
  return `${sign}${num(Math.abs(value), digits)}`
}

/** '125.8' */
export function kcal(value: number, digits = 0): string {
  return num(value, digits)
}

export function cm(value: number): string {
  return `${num(value, 1)} cm`
}

export function litres(ml: number): string {
  return num(ml / 1000, 1)
}

export function pct(value: number): string {
  return `${Math.round(value)}%`
}

/** '06:23' below an hour, '1:12:40' above it. */
export function duration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(s / 3600)
  const mins = Math.floor((s % 3600) / 60)
  const secs = s % 60
  if (hours > 0) return `${hours}:${`${mins}`.padStart(2, '0')}:${`${secs}`.padStart(2, '0')}`
  return `${`${mins}`.padStart(2, '0')}:${`${secs}`.padStart(2, '0')}`
}

/**
 * Reads a duration the way someone would type it off another app's summary
 * screen: '06:23', '6:23', '1:12:40', or a bare '6' meaning six minutes.
 * Returns null when it cannot be understood, so the caller can say so.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim()
  if (!text) return null

  const parts = text.split(':')
  if (parts.length === 1) {
    const mins = Number(parts[0])
    return Number.isFinite(mins) && mins >= 0 ? Math.round(mins * 60) : null
  }
  if (parts.length > 3) return null

  const numbers = parts.map(Number)
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return null
  // Seconds and minutes past 59 are a typo, not a very long minute.
  if (numbers.slice(1).some((n) => n > 59)) return null

  return parts.length === 2
    ? numbers[0] * 60 + numbers[1]
    : numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
}

/** '12 min' — for at-a-glance estimates rather than precise timing. */
export function minutes(totalSeconds: number): string {
  return `${Math.max(1, Math.round(totalSeconds / 60))} min`
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
