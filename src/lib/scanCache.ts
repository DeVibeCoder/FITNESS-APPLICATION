/**
 * Temporary memory of what a photo turned out to be.
 *
 * Scanning the same picture twice in a session should not produce two different
 * readings — or two bills. This keeps the *result* keyed by a fingerprint of the
 * image bytes.
 *
 * It never holds the image. No Blob, no ArrayBuffer, no base64, no object URL —
 * only a hex digest and the analysed numbers. It lives in a module-level Map,
 * so it disappears when the tab closes; nothing is written to Dexie,
 * localStorage or sessionStorage.
 */

const TTL_MS = 20 * 60 * 1000
const MAX_ENTRIES = 20

interface Entry<T> {
  value: T
  storedAt: number
}

const entries = new Map<string, Entry<unknown>>()

/**
 * SHA-256 of the file's bytes.
 *
 * Content-based, so the same picture chosen twice hashes the same however it
 * was picked. Falls back to file metadata where WebCrypto is unavailable
 * (non-secure contexts) — weaker, but it only ever gates a cache lookup.
 */
export async function fingerprintFile(file: File): Promise<string> {
  try {
    const bytes = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return `meta:${file.name}:${file.size}:${file.lastModified}:${file.type}`
  }
}

function prune(now: number): void {
  for (const [key, entry] of entries) {
    if (now - entry.storedAt > TTL_MS) entries.delete(key)
  }
  // Oldest first — Map preserves insertion order.
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    entries.delete(oldest)
  }
}

export function readCached<T>(fingerprint: string): T | null {
  const now = Date.now()
  prune(now)
  const entry = entries.get(fingerprint)
  if (!entry) return null
  if (now - entry.storedAt > TTL_MS) {
    entries.delete(fingerprint)
    return null
  }
  return entry.value as T
}

/**
 * Only ever called with a successful, validated analysis. A failure is never
 * stored, so the next attempt at the same photo is a real one.
 */
export function writeCached<T>(fingerprint: string, value: T): void {
  entries.set(fingerprint, { value, storedAt: Date.now() })
  prune(Date.now())
}

/** Exposed for tests and for the "analyse again" action. */
export function forgetCached(fingerprint: string): void {
  entries.delete(fingerprint)
}

export function clearScanCache(): void {
  entries.clear()
}

export function scanCacheSize(): number {
  prune(Date.now())
  return entries.size
}
