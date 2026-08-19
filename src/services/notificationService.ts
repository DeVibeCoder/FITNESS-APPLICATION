import { db } from '@/lib/db'
import { now } from '@/lib/id'
import type { AppNotification, ID } from '@/models'
import { assertOwner } from './ownership'

/**
 * Notifications, addressed to one person.
 *
 * Phase 1 is the frontend architecture only: the model, the unread count and
 * the list. Nothing generates notifications automatically yet and there is no
 * delivery mechanism — that is Phase 8, and it will be a server's job. The
 * seeded rows exist so the UI has something honest to render.
 */
export const notificationService = {
  /** Newest first, for the notifications screen. */
  async listFor(userId: ID, limit = 40): Promise<AppNotification[]> {
    const rows = await db.notifications.where('userId').equals(userId).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit)
  },

  async unreadCount(userId: ID): Promise<number> {
    const rows = await db.notifications.where('userId').equals(userId).toArray()
    return rows.filter((row) => !row.readAt).length
  },

  /** You can only mark your own as read — the same rule a server would apply. */
  async markRead(userId: ID, notificationId: ID): Promise<void> {
    assertOwner(userId)
    const row = await db.notifications.get(notificationId)
    if (!row || row.userId !== userId || row.readAt) return
    await db.notifications.update(notificationId, { readAt: now() })
  },

  async markAllRead(userId: ID): Promise<number> {
    assertOwner(userId)
    const unread = (await db.notifications.where('userId').equals(userId).toArray()).filter(
      (row) => !row.readAt,
    )
    const stamp = now()
    await Promise.all(unread.map((row) => db.notifications.update(row.id, { readAt: stamp })))
    return unread.length
  },
}
