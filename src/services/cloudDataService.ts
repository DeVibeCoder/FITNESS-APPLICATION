/**
 * The browser's side of `/api/data`.
 *
 * One `call` for everything, for the same reason `cloudWorkoutService` has
 * one: the rules that matter are per-request, not per-endpoint, and a single
 * function is a single place to get them right.
 *
 * Those rules are: send the session cookie and nothing else that identifies
 * anybody. No user id, no role, no account status, no token is ever put into a
 * URL, a header or a body here — the server reads all of that from the cookie
 * and would ignore ours anyway. And a response that is not JSON is treated as
 * no backend rather than as data, because a dev server or an offline PWA shell
 * answers HTML with a 200 and that must not be mistaken for an empty list.
 */
export type CloudDataFailure = 'unauthenticated' | 'forbidden' | 'unavailable' | 'invalid' | 'not_found'

export class CloudDataError extends Error {
  readonly kind: CloudDataFailure
  readonly status: number
  constructor(kind: CloudDataFailure, message: string, status: number) {
    super(message)
    this.name = 'CloudDataError'
    this.kind = kind
    this.status = status
  }
}

const BASE = '/api/data'

/**
 * Where a call goes.
 *
 * Almost everything is under `/api/data`, so that is the default. The admin
 * routes are not — they live under `/api/admin` because they are gated by a
 * different rule — and they still want this function's handling of cookies,
 * of non-JSON answers and of failure. Passing the base is cheaper than a
 * second copy of all of that.
 */
interface CallOptions {
  base?: string
}

async function call<T>(path: string, init?: RequestInit, options?: CallOptions): Promise<T> {
  const base = options?.base ?? BASE
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      credentials: 'include',
      headers: init?.body ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) } : init?.headers,
    })
  } catch {
    throw new CloudDataError('unavailable', 'The server could not be reached.', 0)
  }

  const type = response.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) {
    // An HTML body from an SPA fallback is not an answer to this question.
    throw new CloudDataError('unavailable', 'The server did not answer.', response.status)
  }

  const body = (await response.json()) as T & { error?: string; message?: string }
  if (response.ok) return body

  const kind: CloudDataFailure =
    response.status === 401 ? 'unauthenticated'
    : response.status === 403 ? 'forbidden'
    : response.status === 404 ? 'not_found'
    : response.status === 400 ? 'invalid'
    : 'unavailable'
  throw new CloudDataError(kind, body.message ?? 'That did not work.', response.status)
}

const rows = async <T>(path: string): Promise<T[]> => (await call<{ rows: T[] }>(path)).rows ?? []

export const cloudDataService = {
  get: <T>(path: string, options?: CallOptions) => call<T>(path, undefined, options),

  list: <T>(path: string, params?: Record<string, string | number | undefined>) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
    }
    const suffix = query.toString() ? `?${query}` : ''
    return rows<T>(`${path}${suffix}`)
  },

  post: <T = { ok: true }>(path: string, payload: unknown, options?: CallOptions) =>
    call<T>(path, { method: 'POST', body: JSON.stringify(payload) }, options),

  patch: <T = { ok: true }>(path: string, payload: unknown) =>
    call<T>(path, { method: 'PATCH', body: JSON.stringify(payload) }),

  remove: (path: string) => call<{ ok: true }>(path, { method: 'DELETE' }),
}
