import { useState } from 'react'
import { CornerUpLeft, SmilePlus, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { SharedCard } from './SharedCard'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { chatService, CHAT_REACTIONS } from '@/services/chatService'
import type { ChatMessageView } from '@/services/chatService'
import type { User } from '@/models'
import { formatClock } from '@/utils/date'
import { firstName } from '@/utils/format'
import styles from './MessageBubble.module.css'

/**
 * One message.
 *
 * Yours sit right and tinted, everyone else's left with an avatar — the one
 * convention worth borrowing from every chat app, because people already read
 * it without thinking. Everything else follows this app's own surfaces.
 */
export function MessageBubble({
  message,
  author,
  users,
  onReply,
  /** True when the previous message was from the same person, minutes ago. */
  grouped,
}: {
  message: ChatMessageView
  author: User
  users: Map<string, User>
  onReply: (message: ChatMessageView) => void
  grouped: boolean
}) {
  const { user, isOwner } = useAuth()
  const { guard } = useToast()
  const [picking, setPicking] = useState(false)
  const mine = user?.id === message.userId

  const counts = new Map<string, number>()
  for (const reaction of message.reactions) {
    counts.set(reaction.emoji, (counts.get(reaction.emoji) ?? 0) + 1)
  }
  const myReaction = message.reactions.find((r) => r.userId === user?.id)

  const react = (emoji: string) => {
    if (!user) return
    setPicking(false)
    void guard(() => chatService.toggleReaction(message.id, user.id, emoji))
  }

  return (
    <li
      className={[styles.row, mine ? styles.mine : '', grouped ? styles.grouped : '']
        .filter(Boolean)
        .join(' ')}
    >
      <span className={styles.gutter}>
        {!mine && !grouped ? <Avatar user={author} size="xs" /> : null}
      </span>

      <div className={styles.stack}>
        {!mine && !grouped ? <p className={styles.author}>{firstName(author.name)}</p> : null}

        <div className={styles.bubble}>
          {message.replyTo ? (
            <div className={styles.quote}>
              <span className={styles.quoteName}>
                {firstName(users.get(message.replyTo.userId)?.name ?? 'Someone')}
              </span>
              <span className={styles.quoteText}>
                {message.replyTo.text || sharedSummary(message.replyTo.sharedType)}
              </span>
            </div>
          ) : null}

          {message.sharedType ? <SharedCard message={message} author={author} /> : null}
          {message.text ? (
            <p className={styles.text}>{withMentions(message.text, users, mine)}</p>
          ) : null}

          <p className={styles.time}>{formatClock(message.createdAt)}</p>
        </div>

        {/*
          Under the bubble rather than beside it. Sitting alongside, these three
          buttons took ~90px out of an already narrow column and forced every
          message to wrap two words early.
        */}
        <div className={styles.tools}>
          <button
            className={styles.tool}
            onClick={() => setPicking((open) => !open)}
            aria-label={`React to ${firstName(author.name)}'s message`}
            aria-expanded={picking}
          >
            <SmilePlus size={14} strokeWidth={2.1} />
          </button>
          <button
            className={styles.tool}
            onClick={() => onReply(message)}
            aria-label={`Reply to ${firstName(author.name)}`}
          >
            <CornerUpLeft size={14} strokeWidth={2.1} />
          </button>
          {isOwner(message.userId) ? (
            <button
              className={styles.tool}
              onClick={() => guard(() => chatService.remove(message.id))}
              aria-label="Delete your message"
            >
              <Trash2 size={14} strokeWidth={2.1} />
            </button>
          ) : null}
        </div>

        {picking ? (
          <div className={`glass ${styles.picker}`} role="group" aria-label="Pick a reaction">
            {CHAT_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                className={styles.pick}
                onClick={() => react(emoji)}
                aria-label={`React with ${emoji}`}
                aria-pressed={myReaction?.emoji === emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}

        {counts.size > 0 ? (
          <div className={styles.reactions}>
            {[...counts.entries()].map(([emoji, count]) => (
              <button
                key={emoji}
                className={[styles.chip, myReaction?.emoji === emoji ? styles.chipMine : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => react(emoji)}
                aria-label={`${count} reacted with ${emoji}`}
                aria-pressed={myReaction?.emoji === emoji}
              >
                <span aria-hidden="true">{emoji}</span>
                <span className="tnum">{count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  )
}

/**
 * Marks up `@name` where the name belongs to somebody in the group.
 *
 * Only real members light up. An unmatched `@something` stays plain text —
 * highlighting it would suggest a person was notified when nobody was, which
 * is worse than not highlighting anything at all.
 */
function withMentions(text: string, users: Map<string, User>, mine: boolean) {
  if (!text.includes('@')) return text

  const members = [...users.values()]
  const isMember = (name: string) =>
    members.some(
      (user) =>
        user.handle.toLowerCase() === name.toLowerCase() ||
        user.name.split(' ')[0].toLowerCase() === name.toLowerCase(),
    )

  // The capture group keeps the delimiters, so split alternates text/name.
  return text.split(/@([a-z0-9_]+)/gi).map((part, index) => {
    if (index % 2 === 0) return part
    return isMember(part) ? (
      <strong key={index} className={mine ? styles.mentionMine : styles.mention}>
        @{part}
      </strong>
    ) : (
      `@${part}`
    )
  })
}

/** What to call a share when it is being quoted rather than shown. */
function sharedSummary(type?: string): string {
  switch (type) {
    case 'workout':
      return 'Shared a workout'
    case 'weigh_in':
      return 'Shared a weigh-in'
    case 'steps':
      return 'Shared their steps'
    case 'achievement':
      return 'Shared an achievement'
    case 'challenge':
      return 'Shared the challenge'
    default:
      return 'Message'
  }
}
