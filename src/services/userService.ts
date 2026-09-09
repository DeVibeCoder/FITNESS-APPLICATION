import { db } from '@/lib/db'
import type { Goal, ID, User } from '@/models'
import { uid, now } from '@/lib/id'
import { assertOwner } from './ownership'
import { cloudSync } from './cloudSync'
import { mediaService, type MediaInput } from './mediaService'
import { storageService } from './storageService'

export const userService = {
  async list(): Promise<User[]> {
    const users = await db.users.toArray()
    return users.sort((a, b) => a.name.localeCompare(b.name))
  },

  /**
   * Everyone actually in the group.
   *
   * A pending or rejected request is an account, but not a member — it must
   * not appear in the group, the chat, the stories rail or any total. Accounts
   * predating the approval flow have no status and are members.
   */
  /**
   * The people in the group: everybody on the roster, plus you.
   *
   * This used to be every row in `db.users`, which was right when the only
   * rows were the ones this device had authored. It stopped being right once
   * the roster hydrated, because a browser that has been signed into more than
   * one account holds a leftover local profile for each of them — and the
   * roster carries that same person again, under their server id. The result
   * was somebody appearing twice in the group, once with their real numbers
   * and once with the roster's.
   *
   * A row belongs here if it came from the roster (`remote`, or a server id
   * rather than a locally-minted `u_` one), or if it is the profile being read
   * by the person looking. Anything else is another account's leftovers on a
   * shared browser and is nobody's business on this screen.
   */
  async listMembers(): Promise<User[]> {
    const [users, meta] = await Promise.all([db.users.toArray(), db.meta.toArray()])
    const mine = storageService.getSessionUserId()

    /*
     * A local profile that is linked to an account the roster also describes
     * is the same person twice, and the roster row is the one to keep — it is
     * the server's, and it is the id everybody else's posts are authored by.
     *
     * This only happens on a browser that more than one account has signed
     * into: the earlier sign-in leaves its profile behind, the roster brings
     * the same person back under their server id, and the group lists them
     * both. Filtering by "is it a local id" instead would have been simpler
     * and wrong — a device from before the backend has local profiles for
     * everybody, and they are the only rows it has.
     */
    const duplicated = new Set(
      meta
        .filter((row) => String(row.key).startsWith('link:local:'))
        .filter((row) => users.some((user) => user.id === row.value))
        .map((row) => String(row.key).slice('link:local:'.length)),
    )

    return users
      .filter((user) => (user.status ?? 'approved') === 'approved')
      .filter((user) => user.id === mine || !duplicated.has(user.id))
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  get(id: ID): Promise<User | undefined> {
    return db.users.get(id)
  },

  async getByHandle(handle: string): Promise<User | undefined> {
    return db.users.where('handle').equals(handle.trim().toLowerCase()).first()
  },

  /** Only the owner may edit. See `assertOwner` for how that survives a backend. */
  async update(id: ID, changes: Partial<Omit<User, 'id'>>): Promise<void> {
    assertOwner(id)
    await db.users.update(id, changes)
    /*
     * Only the fields the server recognises as a profile travel. `role` and
     * `status` are not among them and are not sent — an account that could
     * edit its own status could approve itself, so the server's writable list
     * is the one that decides, and this side does not even try.
     */
    await cloudSync.pushProfile(changes)
  },

  async create(input: Omit<User, 'id' | 'joinedAt'>): Promise<User> {
    const user: User = { ...input, id: uid('u'), joinedAt: now() }
    await db.users.add(user)
    return user
  },

  /**
   * Set somebody's profile picture.
   *
   * The picture goes through `mediaService` like every other image in the app:
   * a `MediaAsset` row holding metadata and a pointer, never the bytes. What
   * is stored on the user is that asset's id, so nothing about a person's row
   * grows and nothing binary reaches the database.
   *
   * The previous picture's asset is released, because an avatar nobody points
   * at is not history worth keeping — unlike a post's photo, which belongs to
   * the post for as long as the post exists.
   */
  async setAvatar(userId: ID, media: MediaInput): Promise<User | undefined> {
    assertOwner(userId)
    const user = await db.users.get(userId)
    if (!user) return undefined

    const asset = await mediaService.register(media)
    await db.users.update(userId, { avatarMediaId: asset.id })
    // `avatar_media_id` is on the profile route's writable list, so the picture
    // follows the person to their other devices and onto everybody's roster.
    await cloudSync.pushProfile({ avatarMediaId: asset.id })
    if (user.avatarMediaId) await mediaService.forget([user.avatarMediaId])
    return db.users.get(userId)
  },

  /** Back to initials. The asset goes with it. */
  async clearAvatar(userId: ID): Promise<void> {
    assertOwner(userId)
    const user = await db.users.get(userId)
    if (!user?.avatarMediaId) return
    await db.users.update(userId, { avatarMediaId: undefined })
    await cloudSync.pushProfile({ avatarMediaId: null })
    await mediaService.forget([user.avatarMediaId])
  },

  listGoals(userId: ID): Promise<Goal[]> {
    return db.goals.where('userId').equals(userId).toArray()
  },

  async addGoal(input: Omit<Goal, 'id' | 'createdAt'>): Promise<Goal> {
    const goal: Goal = { ...input, id: uid('g'), createdAt: now() }
    await db.goals.add(goal)
    return goal
  },

  async removeGoal(id: ID): Promise<void> {
    await db.goals.delete(id)
  },
}
