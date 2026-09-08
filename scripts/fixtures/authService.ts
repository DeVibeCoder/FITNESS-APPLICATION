import type { User } from '@/models'
import { db } from '@/lib/db'
import { storageService } from '@/services/storageService'
import { userService } from '@/services/userService'

/**
 * The local sign-in the application used before it had a server. Fixture only.
 *
 * IMPORTANT: this was never security, and it is not authentication any more.
 * Everything here runs against a local database that the holder of the device
 * can read or replace at will.
 *
 * The application no longer imports it. Real sign-in is Better Auth over
 * `/api/auth`, the session is an httpOnly cookie, and `role` and `status` are
 * read from the D1 user row on every protected request — see
 * `server/auth/guard.ts`. This file survives only because `verify-data` drives
 * four thousand assertions against the fixture group, and those assertions
 * need a way to say "now this person is the one acting".
 *
 * It lives in `scripts/fixtures` for the reason the README there gives: a
 * second way to authenticate is dangerous in proportion to how reachable it
 * is, and nothing in `src` can reach this directory.
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
     * Joining needs no approval, so nothing is ever left pending — see the v5
     * migration in `lib/db`. An account an admin turned away still cannot get
     * in, which is a product rule rather than a security boundary: the record
     * is local and editable.
     */
    if (user.status === 'rejected') {
      throw new AuthError('This account was turned away.')
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
