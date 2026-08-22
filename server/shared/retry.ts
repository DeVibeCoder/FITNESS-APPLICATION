/**
 * Retry with exponential backoff and jitter.
 *
 * Only transient failures are retried. Google's guidance is explicit that
 * 429 and 5xx-class responses should back off and retry, while client errors
 * such as 400/401/403 should not — repeating those just burns quota to get the
 * same answer.
 *
 * Observed in this app: the first call of a session times out at the full
 * budget while an immediate second call succeeds in 8–13s, which is a cold
 * connection rather than a busy service. Timeouts are therefore firmly in the
 * transient set, and the first attempt gets a shorter deadline so a stall is
 * cut loose quickly instead of making the user wait it out.
 *
 * Shared by the food and workout scanners. It knows nothing about either:
 * transience is read off a `transient` flag the failure classes both carry,
 * and the error thrown on cancellation is supplied by the caller so each
 * endpoint keeps its own error type all the way out.
 */

export interface RetryOutcome<T> {
  value: T
  /** Total requests made, including the successful one. */
  attempts: number
}

export interface RetryOptions {
  /** Total requests allowed, not additional retries. */
  attempts?: number
  baseDelayMs?: number
  /** Stops retrying once this much time has elapsed overall. */
  budgetMs?: number
  signal?: AbortSignal
  /** Per-attempt deadline; index 0 is the first attempt. */
  timeoutFor?: (attempt: number) => number
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void
  /** What to throw when the caller aborts. Keeps error types per-endpoint. */
  cancelled?: () => Error
}

/** ±20% so simultaneous clients do not retry in lockstep. */
function jitter(ms: number): number {
  return Math.round(ms * (0.8 + Math.random() * 0.4))
}

export function delayFor(attempt: number, baseDelayMs = 1000): number {
  // 1 → ~800–1200ms, 2 → ~1600–2400ms, 3 → ~3200–4800ms
  return jitter(baseDelayMs * 2 ** (attempt - 1))
}

/**
 * Duck-typed rather than `instanceof`, so one retry loop can serve failure
 * classes from different modules. An unrecognised throw is most often a socket
 * or DNS blip, so the default is "worth another go".
 */
export function isTransient(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'transient' in error) {
    return (error as { transient: unknown }).transient !== false
  }
  return true
}

function codeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code: unknown }).code)
  }
  return 'unknown'
}

function sleep(ms: number, signal: AbortSignal | undefined, cancelled: () => Error): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(cancelled())
      },
      { once: true },
    )
  })
}

export async function withRetry<T>(
  task: (context: { attempt: number; timeoutMs: number }) => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryOutcome<T>> {
  const maxAttempts = Math.max(1, options.attempts ?? 3)
  const budgetMs = options.budgetMs ?? 90_000
  const cancelled = options.cancelled ?? (() => new Error('cancelled'))
  const startedAt = Date.now()
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) throw cancelled()

    try {
      const value = await task({
        attempt,
        timeoutMs: options.timeoutFor?.(attempt - 1) ?? 30_000,
      })
      return { value, attempts: attempt }
    } catch (error) {
      lastError = error

      const last = attempt === maxAttempts
      const elapsed = Date.now() - startedAt
      if (last || !isTransient(error) || elapsed >= budgetMs || options.signal?.aborted) {
        break
      }

      const delayMs = delayFor(attempt, options.baseDelayMs)
      // Do not start a wait that would overrun the budget anyway.
      if (elapsed + delayMs >= budgetMs) break

      options.onRetry?.({ attempt, delayMs, reason: codeOf(error) })
      await sleep(delayMs, options.signal, cancelled)
    }
  }

  throw lastError
}
