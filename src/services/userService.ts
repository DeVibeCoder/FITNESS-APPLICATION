import { db } from '@/lib/db'
import type { Goal, ID, User } from '@/models'
import { uid, now } from '@/lib/id'
import { assertOwner } from './ownership'
import { mediaService, type MediaInput } from './mediaService'

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
  async listMembers(): Promise<User[]> {
    const users = await db.users.toArray()
    return users
      .filter((user) => (user.status ?? 'approved') === 'approved')
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
    if (user.avatarMediaId) await mediaService.forget([user.avatarMediaId])
    return db.users.get(userId)
  },

  /** Back to initials. The asset goes with it. */
  async clearAvatar(userId: ID): Promise<void> {
    assertOwner(userId)
    const user = await db.users.get(userId)
    if (!user?.avatarMediaId) return
    await db.users.update(userId, { avatarMediaId: undefined })
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
