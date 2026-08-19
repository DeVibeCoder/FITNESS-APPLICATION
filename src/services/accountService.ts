import { db } from '@/lib/db'
import { now } from '@/lib/id'
import type { AccountStatus, ID, User, UserRole } from '@/models'
import { assertOwner } from './ownership'

/**
 * Roles and join requests.
 *
 * IMPORTANT: none of this is access control. It runs in the browser against a
 * local database, so anyone with the device can approve themselves. What it
 * provides is the *shape* — a role, a status, an approval step — so the screens
 * and the flow exist before a server can enforce any of it. Real authorisation
 * is a backend concern and this file will become a thin client for it.
 */

/** Everything about who may do what goes through here, never a string compare. */
export function hasRole(user: Pick<User, 'role'> | null | undefined, role: UserRole): boolean {
  if (!user) return false
  // Accounts created before roles existed are members.
  return (user.role ?? 'member') === role
}

export function isApproved(user: Pick<User, 'status'> | null | undefined): boolean {
  if (!user) return false
  // Anything predating the approval flow is already in.
  return (user.status ?? 'approved') === 'approved'
}

export interface EmailCheck {
  valid: boolean
  message?: string
}

/**
 * Deliberately permissive: one @, something either side, a dot in the domain.
 * Gmail, plus-addressing and long TLDs all pass. A stricter pattern rejects
 * real addresses, and only sending mail can truly confirm one anyway.
 */
export function validateEmail(email: string): EmailCheck {
  const value = email.trim()
  if (!value) return { valid: false, message: 'Enter your email address.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
    return { valid: false, message: "That does not look like an email address." }
  }
  return { valid: true }
}

export interface PasswordCheck {
  /** 0–4, for the strength meter. */
  score: number
  label: string
  valid: boolean
  message?: string
}

/** Length first, then variety. Long beats clever, so length counts double. */
export function checkPassword(password: string): PasswordCheck {
  if (password.length < 8) {
    return { score: password.length > 0 ? 1 : 0, label: 'Too short', valid: false, message: 'Use at least 8 characters.' }
  }
  let score = 1
  if (password.length >= 12) score++
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++
  if (/\d/.test(password) || /[^\w\s]/.test(password)) score++

  const label = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][score] ?? 'Weak'
  return { score, label, valid: true }
}

export const accountService = {
  /**
   * Is this handle or email already taken?
   *
   * On the sign-up form this is a helpful "that username is taken". A real
   * sign-in screen must never reveal whether an account exists — that check
   * belongs on the server and stays deliberately vague.
   */
  async isHandleTaken(handle: string): Promise<boolean> {
    const value = handle.trim().toLowerCase()
    if (!value) return false
    return Boolean(await db.users.where('handle').equals(value).first())
  },

  async isEmailTaken(email: string): Promise<boolean> {
    const value = email.trim().toLowerCase()
    if (!value) return false
    const users = await db.users.toArray()
    return users.some((user) => user.email?.toLowerCase() === value)
  },

  /** Everyone waiting on a decision, oldest request first. */
  async pending(): Promise<User[]> {
    const users = await db.users.toArray()
    return users
      .filter((user) => user.status === 'pending')
      .sort((a, b) => (a.joinedAt < b.joinedAt ? -1 : 1))
  },

  async pendingCount(): Promise<number> {
    return (await this.pending()).length
  },

  /**
   * Approve or reject a request.
   *
   * Guarded on the acting admin so the call site cannot skip the check, and so
   * the shape matches what a server route will need.
   */
  async decide(input: {
    adminId: ID
    userId: ID
    status: Extract<AccountStatus, 'approved' | 'rejected'>
  }): Promise<void> {
    assertOwner(input.adminId)
    const admin = await db.users.get(input.adminId)
    if (!hasRole(admin, 'admin')) throw new Error('Only an admin can decide requests.')

    const target = await db.users.get(input.userId)
    if (!target || target.status !== 'pending') return

    await db.users.update(input.userId, {
      status: input.status,
      decidedAt: now(),
      decidedBy: input.adminId,
    })
  },
}
