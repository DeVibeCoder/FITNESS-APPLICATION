import { db } from '@/lib/db'
import { uid, now } from '@/lib/id'
import type { ID, Reaction, Update } from '@/models'
import { assertOwner } from './ownership'
import { cloudSync } from './cloudSync'

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
    const update = await this.writeLocal(input)
    await this.announce(update)
    return update
  },

  /** The local row, and nothing else. Safe to call inside a transaction. */
  async writeLocal(input: Omit<Update, 'id' | 'createdAt'>): Promise<Update> {
    const update: Update = { ...input, id: uid('up'), createdAt: now() }
    await db.updates.add(update)
    return update
  },

  /**
   * Tells the server, once the local write is finished and out of any
   * transaction.
   *
   * This is separate from the write for a reason that cost an afternoon:
   * Dexie commits a transaction as soon as its microtask queue drains, and a
   * `fetch` does not live on that queue. Awaiting a network call inside a
   * transaction therefore ends it early and throws PrematureCommitError on
   * the next statement — the announcement still landed, but the caller saw an
   * error for something that had worked. So the transaction does Dexie work
   * only, and this runs after it has closed.
   *
   * `dedupe_key` is UNIQUE in D1, so the Phase 30 rules survive the move and
   * are now enforced by the database rather than by looking first: a new
   * workout announces once because its key is new, an edit announces nothing
   * because it reuses the key, and a delete leaves the announcement standing
   * because nothing removes it.
   */
  async announce(update: Update): Promise<void> {
    await cloudSync.push('/social/updates', {
      id: update.id, kind: update.kind, text: update.text,
      meta: update.meta, dedupeKey: update.dedupeKey, createdAt: update.createdAt,
    })
  },

  /**
   * Posts at most one update per real-world event.
   *
   * The feed describes what happened, not how many times it was saved.
   * Correcting a weigh-in, re-finishing a session from a stale tab, or logging
   * a second meal must not produce a second post. Returns the existing update
   * untouched when the key has already been used.
   *
   * The look and the write are one transaction, because separately they were
   * a race: two saves landing together — a double-tapped button, a session
   * finished in two tabs at once — both looked, both found nothing, and both
   * posted. The dedupe key is not a database constraint, so nothing downstream
   * caught it and the group saw the same workout announced twice. Dexie
   * serialises transactions over a store, so inside one the second caller
   * cannot look until the first has finished writing, and it finds the row.
   *
   * Every caller posts after its own transaction has closed, so this opens a
   * new one rather than joining theirs.
   */
  async postOnce(
    input: Omit<Update, 'id' | 'createdAt' | 'dedupeKey'> & { dedupeKey: string },
  ): Promise<Update> {
    const { update, created } = await db.transaction('rw', db.updates, async () => {
      const existing = await db.updates.filter((row) => row.dedupeKey === input.dedupeKey).first()
      if (existing) return { update: existing, created: false }
      return { update: await this.writeLocal(input), created: true }
    })
    // Outside the transaction, for the reason `announce` explains.
    if (created) await this.announce(update)
    return update
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
      await this.pushReaction(updateId, existing.id, '')
      return
    }
    if (existing) {
      await db.reactions.update(existing.id, { emoji, createdAt: now() })
      await this.pushReaction(updateId, existing.id, emoji)
      return
    }
    const row = { id: uid('r'), updateId, userId, emoji, createdAt: now() }
    await db.reactions.add(row)
    await this.pushReaction(updateId, row.id, emoji)
  },

  /** One shape for all three branches above: set it, change it, take it off. */
  async pushReaction(updateId: ID, existingId: ID | undefined, emoji: string): Promise<void> {
    await cloudSync.push('/social/update-reactions', {
      id: existingId ?? uid('r'),
      targetId: updateId,
      emoji,
      createdAt: now(),
    })
  },
}

/** Encouragement only. No comments, no counts, no followers. */
export const REACTION_EMOJI = ['🔥', '💪', '👏', '❤️'] as const
