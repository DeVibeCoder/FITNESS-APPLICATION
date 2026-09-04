/**
 * Password hashing for the Workers runtime.
 *
 * Better Auth picks its implementation from the runtime: Node gets
 * `node:crypto` scrypt on the libuv thread pool, and anything else — Workers
 * included — falls back to `@noble/hashes` scrypt in pure JavaScript, with
 * N=16384, r=16, p=1.
 *
 * That fallback is the problem, and it is not a marginal one. Measured on a
 * fast desktop CPU:
 *
 *   noble scrypt N=16384 r=16 (what Workers would run)   472 ms
 *   noble scrypt N=16384 r=8  (standard parameters)      221 ms
 *   PBKDF2-SHA-256, 210k iterations, via crypto.subtle   157 ms
 *
 * Two things make the scrypt path unusable here rather than merely slow.
 * It is half a second of single-threaded JavaScript per login on hardware
 * far better than an isolate gets, and it allocates 128 · N · r = **32 MB**
 * for the mixing buffer — a quarter of a Worker's 128 MB memory ceiling, for
 * one password, before the request has done anything else.
 *
 * So we override it. PBKDF2-SHA-256 through Web Crypto is native rather than
 * interpreted, allocates almost nothing, and is a first-class option Better
 * Auth documents ("if you want to use a different algorithm"), not a
 * configuration invented here.
 *
 * PBKDF2 is memory-cheap, which is exactly why scrypt exists — a GPU attacks
 * it more efficiently. The iteration count answers that: 600,000 is the OWASP
 * recommendation for PBKDF2-HMAC-SHA-256, and it costs about 429 ms measured
 * above. We take that trade knowingly, because the alternative on this runtime
 * is not "stronger hashing", it is "hashing that does not fit".
 *
 * The stored format carries its own parameters, so raising the iteration count
 * later does not invalidate existing hashes.
 */

/** OWASP's current floor for PBKDF2-HMAC-SHA-256. */
const ITERATIONS = 600_000
const SALT_BYTES = 16
const KEY_BITS = 256
const PREFIX = 'pbkdf2-sha256'

const encoder = new TextEncoder()

const toHex = (bytes: ArrayBuffer | Uint8Array): string =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

const fromHex = (hex: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array((hex.match(/.{1,2}/g) ?? []).map((byte) => Number.parseInt(byte, 16)))

async function derive(
  password: string,
  // Typed as ArrayBuffer-backed so this compiles under the app's lib set,
  // where a plain Uint8Array may be backed by a SharedArrayBuffer.
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    // NFKC so the same password typed on two keyboards is the same password.
    encoder.encode(password.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  )
  return toHex(bits)
}

/**
 * `pbkdf2-sha256$<iterations>$<salt>$<key>` — self-describing, so a hash made
 * today still verifies after the iteration count is raised.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const key = await derive(password, salt, ITERATIONS)
  return `${PREFIX}$${ITERATIONS}$${toHex(salt)}$${key}`
}

/**
 * Compared in constant time. A fast `!==` leaks, through timing, how much of
 * the digest was right — which is a slow way to guess a password, but a way.
 */
export async function verifyPassword({
  hash,
  password,
}: {
  hash: string
  password: string
}): Promise<boolean> {
  const [prefix, iterationText, saltHex, expected] = hash.split('$')
  if (prefix !== PREFIX || !iterationText || !saltHex || !expected) return false

  const iterations = Number.parseInt(iterationText, 10)
  if (!Number.isFinite(iterations) || iterations < 1) return false

  const actual = await derive(password, fromHex(saltHex), iterations)
  return timingSafeEqual(actual, expected)
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}

/** Exposed so tooling can report what the runtime will actually do. */
export const passwordHashing = { algorithm: PREFIX, iterations: ITERATIONS } as const
