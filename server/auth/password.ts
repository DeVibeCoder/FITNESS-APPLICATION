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
 *
 * ONE ITERATION LIMIT, AND HOW THE COUNT IS STILL 600,000
 *
 * Workers refuses a single PBKDF2 call above 100,000 iterations:
 *
 *   NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
 *   supported (requested 600000).
 *
 * The local runtime does not enforce that, which is why this only appeared
 * when a real signup hit the deployed application — every test until then had
 * run against a workerd that allowed it. Lowering the count to fit would have
 * been a six-fold reduction in the work an attacker has to do, decided by a
 * platform limit rather than by anything about passwords.
 *
 * So the work is chained instead: six calls of 100,000, each one deriving from
 * the previous call's output under the same salt. The attacker must still
 * perform 600,000 iterations to test a guess, because round six cannot begin
 * until round five has finished — the sequential cost is exactly what PBKDF2's
 * iteration count buys, and chaining preserves it. What it does not preserve
 * is the *value*: a chained digest is not the same bytes as one 600,000-call
 * would produce, so the format says which scheme made it rather than leaving
 * two different derivations both claiming "600000".
 */

/** OWASP's floor for PBKDF2-HMAC-SHA-256, reached in rounds the runtime allows. */
const ROUNDS = 6
/** The most a single crypto.subtle PBKDF2 call may ask for on Workers. */
const PER_ROUND = 100_000
const ITERATIONS = ROUNDS * PER_ROUND
const SALT_BYTES = 16
const KEY_BITS = 256
const PREFIX = 'pbkdf2-sha256'
/** Written into the hash so the scheme is never inferred. */
const PARAMS = `${ROUNDS}x${PER_ROUND}`

const encoder = new TextEncoder()

const toHex = (bytes: ArrayBuffer | Uint8Array): string =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

const fromHex = (hex: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array((hex.match(/.{1,2}/g) ?? []).map((byte) => Number.parseInt(byte, 16)))

/** One PBKDF2 call, within what the runtime will accept. */
async function round(
  input: string,
  // Typed as ArrayBuffer-backed so this compiles under the app's lib set,
  // where a plain Uint8Array may be backed by a SharedArrayBuffer.
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    // NFKC so the same password typed on two keyboards is the same password.
    encoder.encode(input.normalize('NFKC')),
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
 * The full cost, as a chain.
 *
 * Each round's output is the next round's input, so the rounds cannot be run
 * in parallel and the total sequential work is `rounds x perRound`.
 */
async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  rounds: number,
  perRound: number,
): Promise<string> {
  let digest = password
  for (let i = 0; i < rounds; i += 1) digest = await round(digest, salt, perRound)
  return digest
}

/**
 * `pbkdf2-sha256$<rounds>x<perRound>$<salt>$<key>` — self-describing, so the
 * cost can be raised later without invalidating what is already stored.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const key = await derive(password, salt, ROUNDS, PER_ROUND)
  return `${PREFIX}$${PARAMS}$${toHex(salt)}$${key}`
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
  const [prefix, params, saltHex, expected] = hash.split('$')
  if (prefix !== PREFIX || !params || !saltHex || !expected) return false

  /*
   * `<rounds>x<perRound>` is the chained scheme. A bare number is the old
   * single-call one, which this runtime cannot reproduce above 100,000 — so
   * rather than deriving something that silently will not match, it is read
   * as a single round and refused outright when it asks for more than the
   * platform allows. Nothing in production carries that format: no account
   * was ever created before this was fixed, because creating one was the
   * request that failed.
   */
  const [roundText, perRoundText] = params.includes('x') ? params.split('x') : ['1', params]
  const rounds = Number.parseInt(roundText, 10)
  const perRound = Number.parseInt(perRoundText, 10)
  if (!Number.isFinite(rounds) || !Number.isFinite(perRound) || rounds < 1 || perRound < 1) return false
  if (perRound > PER_ROUND) return false

  const actual = await derive(password, fromHex(saltHex), rounds, perRound)
  return timingSafeEqual(actual, expected)
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}

/** Exposed so tooling can report what the runtime will actually do. */
export const passwordHashing = {
  algorithm: PREFIX,
  iterations: ITERATIONS,
  rounds: ROUNDS,
  perRound: PER_ROUND,
} as const
