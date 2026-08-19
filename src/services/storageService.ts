import { db } from '@/lib/db'

/**
 * Small key/value preferences. Split deliberately:
 *  - localStorage for things needed before React mounts (theme, session)
 *  - IndexedDB `meta` for everything else
 * A backend implementation would keep the same signatures.
 */

const PREFIX = 'circuit.'

function readLocal<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw === null ? null : (JSON.parse(raw) as T)
  } catch {
    return null
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* Private browsing or a full quota — the app still works, just forgets. */
  }
}

function clearLocal(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    /* ignore */
  }
}

export type ThemePref = 'light' | 'dark' | 'system'

export const storageService = {
  getSessionUserId(): string | null {
    return readLocal<string>('sessionUserId')
  },

  setSessionUserId(userId: string | null): void {
    if (userId) writeLocal('sessionUserId', userId)
    else clearLocal('sessionUserId')
  },

  getTheme(): ThemePref {
    // Written as a bare string by the pre-paint script in index.html.
    try {
      const raw = localStorage.getItem(`${PREFIX}theme`)
      if (raw === 'dark' || raw === 'light') return raw
    } catch {
      /* ignore */
    }
    return 'system'
  },

  setTheme(pref: ThemePref): void {
    try {
      if (pref === 'system') localStorage.removeItem(`${PREFIX}theme`)
      else localStorage.setItem(`${PREFIX}theme`, pref)
    } catch {
      /* ignore */
    }
  },

  async getMeta<T>(key: string): Promise<T | undefined> {
    const row = await db.meta.get(key)
    return row?.value as T | undefined
  },

  async setMeta(key: string, value: unknown): Promise<void> {
    await db.meta.put({ key, value })
  },
}
