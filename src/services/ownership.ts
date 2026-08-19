import { storageService } from './storageService'

/** Raised when a signed-in member tries to write someone else's record. */
export class OwnershipError extends Error {
  constructor(message = 'You can only change your own entries.') {
    super(message)
    this.name = 'OwnershipError'
  }
}

/**
 * Everyone can read everyone's progress; only the owner can write.
 *
 * The actor comes from the session rather than from a caller-supplied id —
 * the same shape a backend would use, so this check moves to security rules
 * later without changing a single call site.
 *
 * With no session at all (seeding, migrations, the verify script's setup) the
 * guard stands down: there is no user to impersonate.
 */
export function assertOwner(userId: string): void {
  const actor = storageService.getSessionUserId()
  if (actor === null || actor === userId) return
  throw new OwnershipError()
}

/** For updates and deletes addressed by row id rather than by user. */
export function assertOwnerOf(row: { userId: string } | undefined): void {
  if (!row) return
  assertOwner(row.userId)
}
