/**
 * The group chat, with D1 as the source of truth.
 *
 * There is one conversation, seeded by migration 0009, because there is one
 * group. Everything here is scoped to it, and membership is what grants
 * access: an approved account that has never opened the chat is added on its
 * first read, which is the whole of "joining" in an application where the
 * group is the product.
 *
 * Two things are deliberately not here. There is no presence, no typing
 * indicator and no read-receipt fan-out, because no screen asks for them. And
 * there is no realtime transport — messages are read back over HTTP. A
 * Durable Object socket would sit in front of this without changing a row,
 * which is exactly why it can wait.
 *
 * Deleting a message is soft and clears the text in the same statement. The
 * bubble keeps its place so a reply still has something to point at, and the
 * words themselves do not survive in a column where some later view could
 * render them.
 */
import type { D1Database } from '../fitness/repo'
import * as v from './validate'

export const GROUP_ID = 'grp_circuit'
export const CONVERSATION_ID = 'cnv_circuit'

const nowIso = () => new Date().toISOString()

// Mirrors `SharedType` in src/models exactly. See socialRepo for why.
const SHARED_TYPES = ['workout', 'weigh_in', 'steps', 'achievement', 'challenge'] as const

export function validateMessage(input: unknown) {
  const raw = v.body(input)
  return {
    id: v.id(raw.id),
    text: v.text(raw.text, 'text', 4000, { allowEmpty: true }),
    replyToId: v.optionalId(raw.replyToId, 'replyToId'),
    sharedType: v.optionalOneOf(raw.sharedType, 'sharedType', SHARED_TYPES),
    sharedDataId: v.optionalId(raw.sharedDataId, 'sharedDataId'),
    stickerId: v.optionalText(raw.stickerId, 'stickerId', 60),
    createdAt: v.optionalTimestamp(raw.createdAt, 'createdAt') ?? nowIso(),
  }
}

export const chatRepo = {
  /**
   * Makes sure the caller is in the group, then answers whether they are.
   *
   * Idempotent, and the only way anyone is added: there is no endpoint that
   * takes a user id and puts them in a group, so nobody can add anybody else.
   */
  async ensureMember(db: D1Database, userId: string): Promise<void> {
    await db
      .prepare(
        `INSERT INTO group_members (id, group_id, user_id, role, joined_at)
         VALUES (?, ?, ?, 'member', ?)
         ON CONFLICT(group_id, user_id) DO NOTHING`,
      )
      .bind(`gm_${crypto.randomUUID()}`, GROUP_ID, userId, nowIso())
      .run()
    await db
      .prepare(
        `INSERT INTO conversation_participants (id, conversation_id, user_id, joined_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(conversation_id, user_id) DO NOTHING`,
      )
      .bind(`cp_${crypto.randomUUID()}`, CONVERSATION_ID, userId, nowIso())
      .run()
  },

  async isMember(db: D1Database, userId: string): Promise<boolean> {
    const row = await db
      .prepare('SELECT id FROM conversation_participants WHERE conversation_id = ? AND user_id = ?')
      .bind(CONVERSATION_ID, userId)
      .first<{ id: string }>()
    return Boolean(row)
  },

  async members(db: D1Database) {
    const { results } = await db
      .prepare(
        `SELECT u.id, u.name, u.handle, u.avatar_color, gm.role, gm.joined_at
           FROM group_members gm JOIN users u ON u.id = gm.user_id
          WHERE gm.group_id = ?
          ORDER BY gm.joined_at ASC`,
      )
      .bind(GROUP_ID)
      .all()
    return results ?? []
  },

  /** Oldest first, which is the order a conversation is read in. */
  async listMessages(db: D1Database, limit: number) {
    const { results } = await db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?
         ) ORDER BY created_at ASC`,
      )
      .bind(CONVERSATION_ID, limit)
      .all()
    return results ?? []
  },

  async saveMessage(db: D1Database, userId: string, input: ReturnType<typeof validateMessage>) {
    await db
      .prepare(
        `INSERT INTO messages
           (id, conversation_id, user_id, text, reply_to_id, shared_type, shared_data_id, sticker_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET text = excluded.text
         WHERE messages.user_id = ?`,
      )
      .bind(
        input.id, CONVERSATION_ID, userId, input.text, input.replyToId,
        input.sharedType, input.sharedDataId, input.stickerId, input.createdAt, userId,
      )
      .run()
  },

  /** Soft, and the words go with it. Only the author may. */
  async deleteMessage(db: D1Database, userId: string, id: string): Promise<boolean> {
    const row = await db
      .prepare('SELECT id FROM messages WHERE id = ? AND user_id = ? AND conversation_id = ?')
      .bind(id, userId, CONVERSATION_ID)
      .first<{ id: string }>()
    if (!row) return false
    await db
      .prepare("UPDATE messages SET deleted_at = ?, text = '', sticker_id = NULL WHERE id = ? AND user_id = ?")
      .bind(nowIso(), id, userId)
      .run()
    return true
  },

  /**
   * Pins or unpins. Anyone in the group may pin, which matches the screen:
   * a pinned message is the group's, not the author's.
   */
  async setPinned(db: D1Database, userId: string, id: string, pinned: boolean): Promise<boolean> {
    const row = await db
      .prepare('SELECT id FROM messages WHERE id = ? AND conversation_id = ? AND deleted_at IS NULL')
      .bind(id, CONVERSATION_ID)
      .first<{ id: string }>()
    if (!row) return false
    await db
      .prepare('UPDATE messages SET pinned_at = ?, pinned_by = ? WHERE id = ?')
      .bind(pinned ? nowIso() : null, pinned ? userId : null, id)
      .run()
    return true
  },

  async listReactions(db: D1Database, limit: number) {
    const { results } = await db
      .prepare(
        `SELECT r.* FROM message_reactions r
           JOIN messages m ON m.id = r.message_id
          WHERE m.conversation_id = ?
          ORDER BY r.created_at DESC LIMIT ?`,
      )
      .bind(CONVERSATION_ID, limit)
      .all()
    return results ?? []
  },

  /** One per person per message; an empty emoji takes it back off. */
  async toggleReaction(
    db: D1Database,
    userId: string,
    input: { id: string; messageId: string; emoji: string; createdAt: string },
  ) {
    // A message the device has but D1 does not — seeded chat history, which
    // predates the account. Answered 404 rather than failing a constraint.
    const known = await db
      .prepare('SELECT id FROM messages WHERE id = ? AND conversation_id = ?')
      .bind(input.messageId, CONVERSATION_ID)
      .first<{ id: string }>()
    if (!known) return false
    if (!input.emoji) {
      await db
        .prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?')
        .bind(input.messageId, userId)
        .run()
      return true
    }
    await db
      .prepare(
        `INSERT INTO message_reactions (id, message_id, user_id, emoji, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji`,
      )
      .bind(input.id, input.messageId, userId, input.emoji, input.createdAt)
      .run()
    return true
  },
}
