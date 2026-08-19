import { useEffect, useState } from 'react'

/**
 * A single self-cleaning interval that re-renders once a second while `active`.
 *
 * Nothing accumulates here: callers read `Date.now()` and subtract stored
 * timestamps. That keeps timers accurate when the tab is backgrounded (where
 * intervals are throttled), and means a missed tick loses a frame rather than a
 * second. Turning `active` off clears the interval, so no duplicates can build
 * up across pauses, re-renders, or unmounts.
 */
export function useTicker(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [active, intervalMs])

  return now
}
