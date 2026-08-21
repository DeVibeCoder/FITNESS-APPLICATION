import { db } from '@/lib/db'
import { now, uid } from '@/lib/id'
import type { ChatMessage, ChatReaction, DateKey, ID, SharedType } from '@/models'
import { assertOwner, assertOwnerOf } from './ownership'
import { storageService } from './storageService'

/**
 * The group's conversation.
 *
 * Deliberately not a social network: three people, one room, no channels, no
 * threads, no read state. Everything is local for now, but the shapes and the
 * ownership checks are the ones a server would enforce, so moving this to a
 * backend is a change of body rather than a change of design.
 */

/** Reactions available in chat. One more than the updates feed — people laugh. */
export const CHAT_REACTIONS = ['🔥', '💪', '👏', '❤️', '😂'] as const

/**
 * `@handle` or `@FirstName`, case-insensitively.
 *
 * The trailing boundary matters: without it "@ahmed's" would capture the
 * apostrophe and match nobody. Word characters only, so punctuation ends the
 * name rather than becoming part of it.
 */
const MENTION_PATTERN = /@([a-z0-9_]+)/gi

/**
 * Everyone named in a message who is not the author.
 *
 * Matched against both handle and first name, because people type what they
 * see: the chat shows "Nadia", so "@Nadia" has to work as well as "@nadia".
 * Exported for the same reason the ownership guard is — a server will run this
 * exact function, and it is worth being able to test it directly.
 */
export function mentionedIn(text: string, members: { id: ID; handle: string; name: string }[], authorId: ID): ID[] {
  const names = [...text.matchAll(MENTION_PATTERN)].map((match) => match[1].toLowerCase())
  if (names.length === 0) return []

  const found = new Set<ID>()
  for (const name of names) {
    const member = members.find(
      (m) =>
        m.id !== authorId &&
        (m.handle.toLowerCase() === name || m.name.split(' ')[0].toLowerCase() === name),
    )
    if (member) found.add(member.id)
  }
  return [...found]
}

export interface ChatMessageView extends ChatMessage {
  reactions: ChatReaction[]
  /** Enough of the original to render the quoted preview on a reply. */
  replyTo?: { id: ID; userId: ID; text: string; sharedType?: SharedType; deletedAt?: string }
}


/**
 * How far each person has read.
 *
 * Stored per user as a timestamp rather than per message: one value answers
 * "what is new for me", survives new messages arriving, and needs no table.
 * A server would keep the same shape on the membership row.
 */
const readKey = (userId: ID) => `chatLastRead:${userId}`

export interface ChatSummary {
  /** The most recent message, for the community card. */
  latest?: ChatMessage
  latestAuthorId?: ID
  unread: number
  /** Everything after this was written since the user last looked. */
  lastReadAt?: string
  total: number
}

export const chatService = {
  /**
   * The conversation, oldest first, so the newest message sits at the bottom
   * where a chat expects it. `limit` takes the most recent N and then restores
   * chronological order.
   */
  async list(limit = 200): Promise<ChatMessageView[]> {
    const newestFirst = await db.messages.orderBy('createdAt').reverse().limit(limit).toArray()
    const messages = newestFirst.reverse()
    if (messages.length === 0) return []

    const ids = new Set(messages.map((m) => m.id))
    const reactions = await db.chatReactions.filter((r) => ids.has(r.messageId)).toArray()

    // A reply can quote a message older than the window, so those are fetched
    // by id rather than assumed to be in `messages`.
    const missing = messages
      .map((m) => m.replyToId)
      .filter((id): id is ID => id !== undefined && !ids.has(id))
    const extra = missing.length ? await db.messages.bulkGet([...new Set(missing)]) : []
    const byId = new Map<ID, ChatMessage>()
    for (const message of [...messages, ...extra]) if (message) byId.set(message.id, message)

    return messages.map((message) => {
      const parent = message.replyToId ? byId.get(message.replyToId) : undefined
      return {
        ...message,
        reactions: reactions.filter((r) => r.messageId === message.id),
        replyTo: parent
          ? {
              id: parent.id,
              userId: parent.userId,
              text: parent.text,
              sharedType: parent.sharedType,
              deletedAt: parent.deletedAt,
            }
          : undefined,
      }
    })
  },

  /** The last few messages, for the compact preview on Home. */
  async latest(count = 2): Promise<ChatMessage[]> {
    const rows = await db.messages.orderBy('createdAt').reverse().limit(count).toArray()
    return rows.reverse()
  },

  // --- Read state ----------------------------------------------------------

  async lastReadAt(userId: ID): Promise<string | undefined> {
    return storageService.getMeta<string>(readKey(userId))
  },

  /**
   * Everything the community card needs, in one read: who spoke last, what
   * they said, and how much of it this person has not seen.
   *
   * Your own messages never count as unread — you wrote them.
   */
  async summary(userId: ID): Promise<ChatSummary> {
    const [all, lastReadAt] = await Promise.all([
      db.messages.orderBy('createdAt').toArray(),
      this.lastReadAt(userId),
    ])
    // A deleted message is still the newest row, but it is not something the
    // preview card can quote — so the card falls back to the last one that is.
    const latest = [...all].reverse().find((m) => !m.deletedAt)
    const unread = all.filter(
      (message) => message.userId !== userId && (!lastReadAt || message.createdAt > lastReadAt),
    ).length

    return {
      latest,
      latestAuthorId: latest?.userId,
      unread,
      lastReadAt,
      total: all.length,
    }
  },

  /**
   * The first message the reader has not seen — where the conversation should
   * open, and where the "new messages" divider goes.
   */
  async firstUnreadId(userId: ID): Promise<ID | undefined> {
    const [all, lastReadAt] = await Promise.all([
      db.messages.orderBy('createdAt').toArray(),
      this.lastReadAt(userId),
    ])
    if (!lastReadAt) return all.find((m) => m.userId !== userId)?.id
    return all.find((m) => m.userId !== userId && m.createdAt > lastReadAt)?.id
  },

  /**
   * Marks everything up to `upTo` as read.
   *
   * Called with the timestamp of the newest message the reader actually
   * reached, not simply because the route loaded — opening a chat and closing
   * it without scrolling should not silently swallow ten unread messages.
   * Never moves the marker backwards.
   */
  async markReadUpTo(userId: ID, upTo: string): Promise<void> {
    assertOwner(userId)
    const current = await this.lastReadAt(userId)
    if (current && current >= upTo) return
    await storageService.setMeta(readKey(userId), upTo)
  },

  count(): Promise<number> {
    return db.messages.count()
  },

  async send(input: {
    userId: ID
    text: string
    replyToId?: ID
    sharedType?: SharedType
    sharedDataId?: ID
  }): Promise<ChatMessage | null> {
    // You post as yourself. The same check a server would run.
    assertOwner(input.userId)

    const text = input.text.trim()
    // A share carries meaning without words; a plain message does not.
    if (!text && !input.sharedType) return null

    const message: ChatMessage = {
      id: uid('msg'),
      userId: input.userId,
      text,
      createdAt: now(),
      replyToId: input.replyToId,
      sharedType: input.sharedType,
      sharedDataId: input.sharedDataId,
    }
    await db.messages.add(message)
    await this.notifyMentions(message)
    return message
  },

  /**
   * The one notification chat is allowed to raise.
   *
   * Being named is a question addressed to you; the other ninety messages in
   * the thread are not. Everything else stays represented by the Chat tab's
   * unread count, which is where §9 and §25 want it.
   */
  async notifyMentions(message: ChatMessage): Promise<ID[]> {
    if (!message.text.includes('@')) return []

    const members = (await db.users.toArray()).filter(
      (user) => (user.status ?? 'approved') === 'approved',
    )
    const author = members.find((user) => user.id === message.userId)
    if (!author) return []

    const targets = mentionedIn(message.text, members, message.userId)
    if (targets.length === 0) return []

    await db.notifications.bulkAdd(
      targets.map((userId) => ({
        id: uid('n'),
        userId,
        kind: 'mention' as const,
        actorId: author.id,
        targetId: message.id,
        text: `${author.name.split(' ')[0]} mentioned you in Fitness group.`,
        href: '/chat/thread',
        createdAt: message.createdAt,
      })),
    )
    return targets
  },

  /**
   * Only the author can remove a message, and only their own.
   *
   * A soft delete: the row stays so the conversation keeps its shape, but the
   * text and any share reference are cleared, because "deleted" has to mean
   * the content is gone rather than merely hidden. Reactions go with it — you
   * cannot react to something that is not there.
   *
   * Replies keep pointing at it. Their quoted preview reads "Message deleted",
   * which is more honest than a reply that suddenly answers nothing.
   */
  async remove(messageId: ID): Promise<void> {
    const message = await db.messages.get(messageId)
    assertOwnerOf(message)
    if (!message || message.deletedAt) return

    await db.messages.update(messageId, {
      text: '',
      sharedType: undefined,
      sharedDataId: undefined,
      deletedAt: now(),
    })
    await db.chatReactions.where('messageId').equals(messageId).delete()
  },

  /**
   * Tapping the same emoji again takes it off. One emoji per person per
   * message, matching how reactions already work on updates.
   */
  async toggleReaction(messageId: ID, userId: ID, emoji: string): Promise<void> {
    assertOwner(userId)
    // Nothing to react to. The UI hides the control, but the rule belongs here
    // too — a server would enforce it and the UI is not the only caller.
    const message = await db.messages.get(messageId)
    if (!message || message.deletedAt) return
    const existing = await db.chatReactions
      .where('[messageId+userId]')
      .equals([messageId, userId])
      .first()

    if (existing?.emoji === emoji) {
      await db.chatReactions.delete(existing.id)
      return
    }
    if (existing) {
      await db.chatReactions.update(existing.id, { emoji, createdAt: now() })
      return
    }
    await db.chatReactions.add({ id: uid('cr'), messageId, userId, emoji, createdAt: now() })
  },

  // --- Sharing -------------------------------------------------------------

  /**
   * Which kinds of progress this person actually has to share right now.
   *
   * The share menu offers only these. Every `share*` method below already
   * returns null when there is nothing to send, so this is not a safety check
   * — it exists so the menu never offers an action that can only fail, which
   * is the difference between a menu and a guessing game.
   */
  async shareable(userId: ID, date: DateKey, challengeId?: ID): Promise<Set<SharedType>> {
    const [session, weights, steps, achievement] = await Promise.all([
      db.sessions
        .where('userId')
        .equals(userId)
        .filter((s) => s.status === 'completed')
        .first(),
      db.weights.where('userId').equals(userId).filter((w) => w.kind === 'official').first(),
      db.steps.where('[userId+date]').equals([userId, date]).first(),
      db.achievements.where('userId').equals(userId).first(),
    ])

    const available = new Set<SharedType>()
    if (session) available.add('workout')
    if (weights) available.add('weigh_in')
    if (steps) available.add('steps')
    if (achievement) available.add('achievement')
    if (challengeId) available.add('challenge')
    return available
  },


  /** Share the most recent workout, if there is one to share. */
  async shareWorkout(userId: ID, sessionId?: ID): Promise<ChatMessage | null> {
    const session = sessionId
      ? await db.sessions.get(sessionId)
      : (
          await db.sessions
            .where('userId')
            .equals(userId)
            .filter((s) => s.status === 'completed')
            .sortBy('date')
        ).at(-1)
    if (!session) return null
    return this.send({ userId, text: '', sharedType: 'workout', sharedDataId: session.id })
  },

  /** Share this week's official weigh-in. Never any other entry. */
  async shareWeighIn(userId: ID, date?: DateKey): Promise<ChatMessage | null> {
    const officials = (await db.weights.where('userId').equals(userId).sortBy('date')).filter(
      (entry) => entry.kind === 'official' && (!date || entry.date === date),
    )
    const entry = officials.at(-1)
    if (!entry) return null
    return this.send({ userId, text: '', sharedType: 'weigh_in', sharedDataId: entry.id })
  },

  async shareSteps(userId: ID, date: DateKey): Promise<ChatMessage | null> {
    const entry = await db.steps.where('[userId+date]').equals([userId, date]).first()
    if (!entry) return null
    return this.send({ userId, text: '', sharedType: 'steps', sharedDataId: entry.id })
  },

  /** Share an unlocked achievement. Locked ones cannot be shared. */
  async shareAchievement(userId: ID, achievementKey?: string): Promise<ChatMessage | null> {
    const unlocked = await db.achievements.where('userId').equals(userId).toArray()
    const row = achievementKey
      ? unlocked.find((a) => a.achievementKey === achievementKey)
      : unlocked.sort((a, b) => (a.unlockedAt < b.unlockedAt ? 1 : -1))[0]
    if (!row) return null
    return this.send({
      userId,
      text: '',
      sharedType: 'achievement',
      sharedDataId: row.achievementKey,
    })
  },

  async shareChallenge(userId: ID, challengeId: ID): Promise<ChatMessage | null> {
    const challenge = await db.challenges.get(challengeId)
    if (!challenge) return null
    return this.send({ userId, text: '', sharedType: 'challenge', sharedDataId: challenge.id })
  },
}
