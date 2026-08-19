import type { User } from '@/models'
import { db } from '@/lib/db'
import { storageService } from './storageService'
import { userService } from './userService'

/**
 * Local-only authentication for the frontend phase.
 *
 * IMPORTANT: this is not security. Everything here runs in the browser against
 * a local database, so anyone with the device can read or replace it. The
 * digest below exists so passwords are not sitting in plain text in IndexedDB
 * and so the sign-in *experience* is real — not so the app is protected.
 *
 * Real protection arrives with a backend. When it does, only the four methods
 * below change; no screen has to move.
 */

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

/**
 * Salted SHA-256, with the handle as the salt so two people choosing the same
 * password do not end up with the same digest. Deliberately not a slow KDF —
 * pretending to harden a value the attacker already has full access to would
 * only be theatre.
 */
async function digest(handle: string, password: string): Promise<string> {
  const data = new TextEncoder().encode(`circuit:${handle.toLowerCase()}:${password}`)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const authService = {
  /** Everyone who can sign in. Replaced by a real directory later. */
  listAccounts(): Promise<User[]> {
    return userService.list()
  },

  async signIn(handle: string, password: string): Promise<User> {
    const cleaned = handle.trim().toLowerCase()
    if (!cleaned) throw new AuthError('Enter your username.')
    if (!password) throw new AuthError('Enter your password.')

    const user = await userService.getByHandle(cleaned)
    // The same message either way: which half was wrong is not the user's
    // business to learn by guessing.
    const wrong = new AuthError('That username and password do not match.')
    if (!user?.secret) throw wrong
    if ((await digest(cleaned, password)) !== user.secret) throw wrong

    /*
     * A pending or rejected request cannot get in. This is a product rule, not
     * a security boundary — the record is local and editable — but the flow
     * has to behave correctly before a server can enforce it.
     */
    if (user.status === 'pending') {
      throw new AuthError('Your request is still waiting for approval.')
    }
    if (user.status === 'rejected') {
      throw new AuthError('This request was not approved.')
    }

    storageService.setSessionUserId(user.id)
    return user
  },

  /** Sets or replaces a local password. Used by setup and by the profile. */
  async setPassword(userId: string, password: string): Promise<void> {
    if (password.length < 4) throw new AuthError('Use at least 4 characters.')
    const user = await db.users.get(userId)
    if (!user) throw new AuthError('That account is no longer available.')
    await db.users.update(userId, { secret: await digest(user.handle, password) })
  },

  async signOut(): Promise<void> {
    storageService.setSessionUserId(null)
  },

  async currentUser(): Promise<User | null> {
    const id = storageService.getSessionUserId()
    if (!id) return null
    return (await userService.get(id)) ?? null
  },
}
