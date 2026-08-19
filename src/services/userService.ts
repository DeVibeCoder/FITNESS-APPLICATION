import { db } from '@/lib/db'
import type { Goal, ID, User } from '@/models'
import { uid, now } from '@/lib/id'
import { assertOwner } from './ownership'

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
