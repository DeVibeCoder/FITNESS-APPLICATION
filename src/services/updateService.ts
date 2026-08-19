import { db } from '@/lib/db'
import { uid, now } from '@/lib/id'
import type { ID, Reaction, Update } from '@/models'
import { assertOwner } from './ownership'

export interface UpdateWithReactions extends Update {
  reactions: Reaction[]
}

/** The group feed. Small on purpose — this is not a social network. */
export const updateService = {
  async recent(limit = 12): Promise<UpdateWithReactions[]> {
    const updates = await db.updates.orderBy('createdAt').reverse().limit(limit).toArray()
    const ids = new Set(updates.map((u) => u.id))
    const reactions = await db.reactions.filter((r) => ids.has(r.updateId)).toArray()
    return updates.map((update) => ({
      ...update,
      reactions: reactions.filter((r) => r.updateId === update.id),
    }))
  },

  async post(input: Omit<Update, 'id' | 'createdAt'>): Promise<Update> {
    const update: Update = { ...input, id: uid('up'), createdAt: now() }
    await db.updates.add(update)
    return update
  },

  /**
   * Posts at most one update per real-world event.
   *
   * The feed describes what happened, not how many times it was saved.
   * Correcting a weigh-in, re-finishing a session from a stale tab, or logging
   * a second meal must not produce a second post. Returns the existing update
   * untouched when the key has already been used.
   */
  async postOnce(
    input: Omit<Update, 'id' | 'createdAt' | 'dedupeKey'> & { dedupeKey: string },
  ): Promise<Update> {
    const existing = await db.updates.filter((row) => row.dedupeKey === input.dedupeKey).first()
    if (existing) return existing
    return this.post(input)
  },

  /** Full history for the Updates page, newest first. */
  async all(limit = 200): Promise<UpdateWithReactions[]> {
    return this.recent(limit)
  },

  /** Tapping the same emoji again removes it. One emoji per person per update. */
  async toggleReaction(updateId: ID, userId: ID, emoji: string): Promise<void> {
    // You react as yourself; nobody reacts on your behalf.
    assertOwner(userId)
    const existing = await db.reactions
      .where('[updateId+userId]')
      .equals([updateId, userId])
      .first()

    if (existing?.emoji === emoji) {
      await db.reactions.delete(existing.id)
      return
    }
    if (existing) {
      await db.reactions.update(existing.id, { emoji, createdAt: now() })
      return
    }
    await db.reactions.add({ id: uid('r'), updateId, userId, emoji, createdAt: now() })
  },
}

/** Encouragement only. No comments, no counts, no followers. */
export const REACTION_EMOJI = ['🔥', '💪', '👏', '❤️'] as const
