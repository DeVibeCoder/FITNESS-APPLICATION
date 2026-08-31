import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { CornerUpLeft, Pin } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { SharedCard } from './SharedCard'
import { StickerBubble } from './StickerBubble'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { chatService } from '@/services/chatService'
import type { ChatMessageView } from '@/services/chatService'
import type { User } from '@/models'
import { formatClock } from '@/utils/date'
import { firstName } from '@/utils/format'
import { sharedSummary } from './shareLabels'
import styles from './MessageBubble.module.css'

/** How far a message has to travel right before the reply is armed. */
const REPLY_AT = 56
/** Past this the bubble stops following the finger, so the row cannot run away. */
const SWIPE_MAX = 84
/** A press held this long is a press-and-hold, not a tap. */
const HOLD_MS = 420

/**
 * One message.
 *
 * Yours sit right and tinted, everyone else's left with an avatar — the one
 * convention worth borrowing from every chat app, because people already read
 * it without thinking. Everything else follows this app's own surfaces.
 *
 * There are no buttons under it any more. Three icon controls beneath every
 * bubble meant a screen of conversation carried more controls than messages,
 * and they were the first thing the eye landed on. The actions moved to where
 * every phone already puts them: swipe a message to the right to reply to it,
 * press and hold it for everything else. What is left under the bubble is what
 * people actually said to it — the reactions — and nothing that moves when one
 * arrives.
 */
export function MessageBubble({
  message,
  author,
  users,
  onReply,
  onOpenActions,
  /** True when the previous message was from the same person, minutes ago. */
  grouped,
}: {
  message: ChatMessageView
  author: User
  users: Map<string, User>
  onReply: (message: ChatMessageView) => void
  /** Opens the action menu, anchored on the bubble that was held. */
  onOpenActions: (message: ChatMessageView, anchor: DOMRect) => void
  grouped: boolean
}) {
  const { user } = useAuth()
  const { guard } = useToast()
  const [swipe, setSwipe] = useState(0)
  /*
   * The same travel, kept in a ref.
   *
   * The lift handler has to know how far the finger got, and it cannot ask
   * the state: a fast swipe delivers its moves and its lift in one task, so
   * React has not re-rendered and `swipe` is still whatever it was when the
   * handler was created — zero. The ref is written synchronously and is
   * therefore the only value that is true at the moment of the lift.
   */
  const swipeRef = useRef(0)
  const mine = user?.id === message.userId
  const deleted = Boolean(message.deletedAt)
  const bubbleRef = useRef<HTMLDivElement>(null)

  const counts = new Map<string, number>()
  for (const reaction of message.reactions) {
    counts.set(reaction.emoji, (counts.get(reaction.emoji) ?? 0) + 1)
  }
  const myReaction = message.reactions.find((r) => r.userId === user?.id)

  const react = (emoji: string) => {
    if (!user) return
    void guard(() => chatService.toggleReaction(message.id, user.id, emoji))
  }

  /*
   * Two gestures on the same pointer, told apart by what the finger does.
   *
   * Held still past HOLD_MS, it is a press-and-hold and the menu opens. Moved
   * horizontally first, it is a swipe and the hold is called off. Moved
   * vertically, it is the page scrolling and this gets out of the way — which
   * is what `touch-action: pan-y` on the row guarantees, so a scroll is never
   * waiting on a decision made here.
   */
  const start = useRef<{ x: number; y: number } | null>(null)
  const hold = useRef<number | null>(null)
  const axis = useRef<'none' | 'x' | 'y'>('none')

  const cancelHold = () => {
    if (hold.current !== null) window.clearTimeout(hold.current)
    hold.current = null
  }

  const openMenu = () => {
    cancelHold()
    const box = bubbleRef.current?.getBoundingClientRect()
    if (!box || deleted) return
    // A press-and-hold that opens a menu should feel like something happened
    // even before the eye gets there.
    navigator.vibrate?.(8)
    onOpenActions(message, box)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLLIElement>) => {
    if (deleted || event.button === 2) return
    // A reaction chip is its own control. Starting a swipe or a hold on one
    // would mean a tap sometimes toggles a reaction and sometimes opens a
    // menu, which is the kind of ambiguity that makes people stop tapping.
    if ((event.target as HTMLElement).closest('button')) return
    /*
     * Captured, so the lift is heard even when the finger has travelled off
     * the message. Without it a swipe that ends over the next bubble never
     * gets its pointerup and the row stays dragged open.
     */
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* Nothing to capture with. The gesture still works from this element. */
    }
    start.current = { x: event.clientX, y: event.clientY }
    axis.current = 'none'
    swipeRef.current = 0
    cancelHold()
    hold.current = window.setTimeout(openMenu, HOLD_MS)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLLIElement>) => {
    const from = start.current
    if (!from) return
    const dx = event.clientX - from.x
    const dy = event.clientY - from.y

    if (axis.current === 'none') {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      axis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      cancelHold()
    }
    if (axis.current !== 'x') return

    // Rightwards only, and it stiffens as it goes so the row cannot be dragged
    // halfway across the screen.
    const travel = Math.max(0, dx)
    swipeRef.current = travel
    setSwipe(travel > SWIPE_MAX ? SWIPE_MAX + (travel - SWIPE_MAX) * 0.18 : travel)
  }

  const endGesture = () => {
    cancelHold()
    if (axis.current === 'x' && swipeRef.current >= REPLY_AT) {
      navigator.vibrate?.(6)
      onReply(message)
    }
    start.current = null
    axis.current = 'none'
    swipeRef.current = 0
    setSwipe(0)
  }

  return (
    <li
      className={[styles.row, mine ? styles.mine : '', grouped ? styles.grouped : '']
        .filter(Boolean)
        .join(' ')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onContextMenu={(event) => {
        // Right-click on a desktop, and the system menu on a phone that fires
        // one — both are the same request as a press-and-hold.
        if (deleted) return
        event.preventDefault()
        openMenu()
      }}
    >
      {/* The reply mark the message is being dragged onto. */}
      <span
        className={[styles.swipeHint, swipe >= REPLY_AT ? styles.swipeArmed : '']
          .filter(Boolean)
          .join(' ')}
        style={{ opacity: Math.min(1, swipe / REPLY_AT) }}
        aria-hidden="true"
      >
        <CornerUpLeft size={15} strokeWidth={2.4} />
      </span>

      <span className={styles.gutter}>
        {!mine && !grouped ? <Avatar user={author} size="xs" /> : null}
      </span>

      <div
        className={styles.stack}
        style={swipe ? { transform: `translateX(${swipe}px)` } : undefined}
      >
        {!mine && !grouped ? <p className={styles.author}>{firstName(author.name)}</p> : null}

        {/*
          A sticker is not a bubble. It is drawn on the thread itself, at the
          size of the thing it is, because wrapping a sticker in a surface is
          what makes stickers look like clip art in a form.
        */}
        {!deleted && message.stickerId ? (
          <div ref={bubbleRef} className={styles.stickerHolder}>
            <StickerBubble stickerId={message.stickerId} />
            <span className={styles.stickerTime}>{formatClock(message.createdAt)}</span>
          </div>
        ) : (
          <div
            ref={bubbleRef}
            className={[
              styles.bubble,
              deleted ? styles.deleted : '',
              message.pinnedAt && !deleted ? styles.isPinned : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {message.pinnedAt && !deleted ? (
              <span className={styles.pinned}>
                <Pin size={10} strokeWidth={2.8} aria-hidden="true" />
                Pinned
              </span>
            ) : null}

            {/*
              A deleted message keeps its place and its timestamp so the thread
              does not jump, and shows nothing else — no quote, no share card, no
              text. The row survives; the content does not.
            */}
            {deleted ? (
              <p className={styles.tombstone}>Message deleted</p>
            ) : (
              <>
                {message.replyTo ? (
                  <div className={styles.quote}>
                    <span className={styles.quoteName}>
                      {firstName(users.get(message.replyTo.userId)?.name ?? 'Someone')}
                    </span>
                    <span
                      className={[
                        styles.quoteText,
                        message.replyTo.deletedAt ? styles.quoteGone : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {message.replyTo.deletedAt
                        ? 'Message deleted'
                        : message.replyTo.text || sharedSummary(message.replyTo.sharedType)}
                    </span>
                  </div>
                ) : null}

                {message.sharedType ? (
                  <div className={styles.block}>
                    <SharedCard message={message} author={author} />
                  </div>
                ) : null}
              </>
            )}

            {/*
              Text and time on one line when the text is short enough to leave
              room, and on two when it is not.

              That is the whole of it: the bubble is a wrapping flex row, the
              text is one item and the clock another. A three-word message no
              longer spends a second line on its own timestamp, and a paragraph
              wraps the way a paragraph should. Nothing measures anything.
            */}
            {!deleted && message.text ? (
              <span className={styles.text}>{withMentions(message.text, users, mine)}</span>
            ) : null}
            <span className={styles.time}>{formatClock(message.createdAt)}</span>
          </div>
        )}

        {/*
          Reactions, on the message's own side, and nothing else on the row.
          They shrink and scroll rather than wrap, so five distinct reactions
          cannot make the row two lines tall.
        */}
        {!deleted && counts.size > 0 ? (
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
                {count > 1 ? <span className="tnum">{count}</span> : null}
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

