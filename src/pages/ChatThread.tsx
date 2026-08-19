import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowDown,
  ArrowLeft,
  Award,
  Dumbbell,
  Ellipsis,
  Footprints,
  Scale,
  SendHorizontal,
  Target,
  X,
} from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { challengeService, chatService , userService } from '@/services'
import type { ChatMessageView } from '@/services/chatService'
import { todayKey } from '@/utils/date'
import { firstName } from '@/utils/format'
import styles from './ChatThread.module.css'

/**
 * The conversation itself, at /chat/thread.
 *
 * Single-minded by design: a back arrow to the chat list, who is here, the
 * messages, and a composer. Nothing about the group's progress, the challenge
 * or the week appears here — that is Group's job now.
 *
 * Opening behaviour is the point of this screen. It lands on the first message
 * you have not read — with a divider saying so — or on the newest message when
 * there is nothing new. It never opens at the top of the history.
 */
export function ChatThread() {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const today = todayKey()

  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<ChatMessageView | null>(null)
  const [sending, setSending] = useState(false)
  const [moreShares, setMoreShares] = useState(false)
  /**
   * Two different states, deliberately not one.
   *
   * `arrived` counts messages that landed while the reader was up in the
   * history — that is news, and it says how much. `scrolledUp` is merely being
   * somewhere other than the bottom, which is not news and only needs a way
   * back down. Collapsing them would either nag about nothing or hide the fact
   * that someone just said something.
   */
  const [arrived, setArrived] = useState(0)
  const [scrolledUp, setScrolledUp] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const positioned = useRef(false)
  const seenCount = useRef(0)

  const messages = useLiveQuery(() => chatService.list(), [])
  const users = useLiveQuery(() => userService.listMembers(), [])
  const challenge = useLiveQuery(() => challengeService.forWeek(today), [today])
  /**
   * Captured once. The divider must not jump as messages are marked read while
   * the reader is still looking at them.
   */
  const [firstUnreadId, setFirstUnreadId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    if (!user || firstUnreadId !== undefined) return
    void chatService.firstUnreadId(user.id).then((id) => setFirstUnreadId(id ?? null))
  }, [user, firstUnreadId])

  const atBottom = useCallback(() => {
    const gap = document.documentElement.scrollHeight - window.scrollY - window.innerHeight
    return gap < 120
  }, [])

  /**
   * Applies a scroll, then re-applies it on the next two frames.
   *
   * The thread's height is not final when the positioning effect first runs:
   * reactions and shared cards arrive from a second query and the sticky dock
   * lays out after them, so the document grows underneath. A single scroll
   * therefore landed ~200px short and left the newest message tucked behind the
   * composer. Each retry bails if the reader has moved in the meantime, so this
   * can never fight somebody who started scrolling immediately.
   */
  const settle = useCallback((apply: () => void) => {
    apply()
    let expected = window.scrollY
    const again = (depth: number) => {
      if (Math.abs(window.scrollY - expected) > 2) return
      apply()
      expected = window.scrollY
      if (depth > 0) requestAnimationFrame(() => again(depth - 1))
    }
    requestAnimationFrame(() => again(2))
  }, [])

  /** Marks everything read once the reader is actually at the newest message. */
  const markCaughtUp = useCallback(() => {
    if (!user || !messages || messages.length === 0) return
    void chatService.markReadUpTo(user.id, messages[messages.length - 1].createdAt)
  }, [user, messages])

  // Position on open: the first unread if there is one, otherwise the newest.
  useEffect(() => {
    if (!messages || positioned.current || firstUnreadId === undefined) return
    positioned.current = true
    seenCount.current = messages.length

    const target = firstUnreadId
      ? document.getElementById(`divider-${firstUnreadId}`)
      : null

    if (target) {
      settle(() => target.scrollIntoView({ behavior: 'auto', block: 'center' }))
    } else {
      settle(() => window.scrollTo({ top: BOTTOM, behavior: 'auto' }))
      markCaughtUp()
    }
  }, [messages, firstUnreadId, markCaughtUp, settle])

  // A new message while scrolled up counts up an indicator instead of yanking
  // the reader away from whatever they were reading.
  useEffect(() => {
    if (!messages || !positioned.current) return
    if (messages.length > seenCount.current) {
      const added = messages.length - seenCount.current
      seenCount.current = messages.length
      if (atBottom()) {
        window.scrollTo({ top: BOTTOM, behavior: 'smooth' })
        markCaughtUp()
      } else {
        setArrived((count) => count + added)
      }
    }
  }, [messages, atBottom, markCaughtUp])

  // Reaching the bottom is what marks the conversation read — not the route
  // loading. Opening and leaving without scrolling keeps the unread count.
  useEffect(() => {
    const onScroll = () => {
      if (!atBottom()) {
        setScrolledUp(true)
        return
      }
      setScrolledUp(false)
      setArrived(0)
      markCaughtUp()
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [atBottom, markCaughtUp])

  if (!user || messages === undefined || users === undefined) return <LoadingScreen />

  const byId = new Map(users.map((u) => [u.id, u]))

  const jumpToNewest = () => {
    window.scrollTo({ top: BOTTOM, behavior: 'smooth' })
    setArrived(0)
    setScrolledUp(false)
    markCaughtUp()
  }

  const send = async () => {
    if (!draft.trim() || sending) return
    setSending(true)
    const result = await guard(() =>
      chatService.send({ userId: user.id, text: draft, replyToId: replyTo?.id }),
    )
    setSending(false)
    if (result !== undefined) {
      setDraft('')
      setReplyTo(null)
      if (input.current) input.current.style.height = 'auto'
      input.current?.focus()
      // Sending always returns you to the newest message.
      requestAnimationFrame(jumpToNewest)
    }
  }

  const share = async (kind: 'workout' | 'weigh_in' | 'steps' | 'achievement' | 'challenge') => {
    setMoreShares(false)
    const result = await guard(async () => {
      switch (kind) {
        case 'workout':
          return chatService.shareWorkout(user.id)
        case 'weigh_in':
          return chatService.shareWeighIn(user.id)
        case 'steps':
          return chatService.shareSteps(user.id, today)
        case 'achievement':
          return chatService.shareAchievement(user.id)
        case 'challenge':
          return challenge ? chatService.shareChallenge(user.id, challenge.id) : null
      }
    })
    if (result === null) show(NOTHING_TO_SHARE[kind], 'error')
    else if (result !== undefined) requestAnimationFrame(jumpToNewest)
  }

  return (
    <div className={styles.page}>
      {/* Focused header: out, who is here, and nothing else. */}
      <header className={styles.head}>
        <Link to="/chat" className={styles.back} aria-label="Back to chat">
          <ArrowLeft size={18} strokeWidth={2.2} />
        </Link>
        <div className={styles.headText}>
          <h2 className={styles.title}>Fitness group</h2>
          <p className={styles.sub}>{users.length} people</p>
        </div>
        <span className={styles.faces} aria-hidden="true">
          {users.slice(0, 3).map((member) => (
            <span key={member.id} className={styles.face}>
              <Avatar user={member} size="xs" />
            </span>
          ))}
        </span>
      </header>

      <div className={styles.thread}>
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <p className="eyebrow">Your group chat</p>
            <p className={styles.emptyTitle}>Your group is quiet.</p>
            <p className={styles.emptyBody}>Be the first to check in.</p>
          </div>
        ) : (
          <ul className={styles.list}>
            {messages.map((message, index) => {
              const author = byId.get(message.userId)
              if (!author) return null
              const previous = messages[index - 1]
              const grouped =
                Boolean(previous) &&
                previous.userId === message.userId &&
                !message.replyToId &&
                !message.sharedType &&
                new Date(message.createdAt).getTime() -
                  new Date(previous.createdAt).getTime() <
                  5 * 60_000

              return (
                <div key={message.id}>
                  {firstUnreadId === message.id ? (
                    <div className={styles.divider} id={`divider-${message.id}`}>
                      <span>New messages</span>
                    </div>
                  ) : null}
                  <MessageBubble
                    message={message}
                    author={author}
                    users={byId}
                    onReply={(target) => {
                      setReplyTo(target)
                      input.current?.focus()
                    }}
                    grouped={grouped && firstUnreadId !== message.id}
                  />
                </div>
              )
            })}
          </ul>
        )}
      </div>

      <div className={styles.dock}>
        {arrived > 0 ? (
          <button className={styles.newMessage} onClick={jumpToNewest}>
            <ArrowDown size={14} strokeWidth={2.4} />
            {arrived} new message{arrived === 1 ? '' : 's'}
          </button>
        ) : scrolledUp ? (
          <button className={styles.jump} onClick={jumpToNewest}>
            <ArrowDown size={14} strokeWidth={2.4} />
            Newest
          </button>
        ) : null}

        <div className={styles.shareRow} role="group" aria-label="Share your progress">
          <ShareButton label="Workout" icon={<Dumbbell size={14} strokeWidth={2.1} />} onClick={() => share('workout')} />
          <ShareButton label="Weigh-in" icon={<Scale size={14} strokeWidth={2.1} />} onClick={() => share('weigh_in')} />
          <ShareButton label="Steps" icon={<Footprints size={14} strokeWidth={2.1} />} onClick={() => share('steps')} />
          {/*
            Four chips fit a 320px screen; five did not, and a row that has to
            be swiped hides whatever is off the end. The rest live behind More.
          */}
          <ShareButton
            label="More"
            icon={<Ellipsis size={14} strokeWidth={2.1} />}
            onClick={() => setMoreShares((open) => !open)}
            pressed={moreShares}
          />
        </div>

        {moreShares ? (
          <div className={styles.shareRow} role="group" aria-label="More to share">
            <ShareButton label="Achievement" icon={<Award size={14} strokeWidth={2.1} />} onClick={() => share('achievement')} />
            <ShareButton label="Challenge" icon={<Target size={14} strokeWidth={2.1} />} onClick={() => share('challenge')} />
          </div>
        ) : null}

        <div className={`glass ${styles.composer}`}>
          {replyTo ? (
            <div className={styles.replying}>
              <div className={styles.replyingText}>
                <span className={styles.replyingName}>
                  Replying to {firstName(byId.get(replyTo.userId)?.name ?? 'them')}
                </span>
                <span className={styles.replyingBody}>{replyTo.text || 'Shared progress'}</span>
              </div>
              <button
                className={styles.cancelReply}
                onClick={() => setReplyTo(null)}
                aria-label="Cancel reply"
              >
                <X size={15} strokeWidth={2.4} />
              </button>
            </div>
          ) : null}

          <div className={styles.inputRow}>
            <textarea
              ref={input}
              className={styles.input}
              value={draft}
              rows={1}
              placeholder="Write a message…"
              aria-label="Write a message"
              onChange={(event) => {
                setDraft(event.target.value)
                event.target.style.height = 'auto'
                event.target.style.height = `${event.target.scrollHeight}px`
              }}
              onKeyDown={(event) => {
                // Enter sends on a desktop keyboard; Shift+Enter makes a new
                // line. On a phone the return key inserts a newline, which is
                // what people expect there.
                if (event.key === 'Enter' && !event.shiftKey && !('ontouchstart' in window)) {
                  event.preventDefault()
                  void send()
                }
              }}
            />
            <button
              className={styles.send}
              onClick={send}
              disabled={!draft.trim() || sending}
              aria-label="Send message"
            >
              <SendHorizontal size={17} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Far past any real page, so the browser clamps to the true maximum.
 *
 * `document.body.scrollHeight` is not that maximum here: the composer is a
 * sticky element pinned to the bottom, so while the thread is at the top it
 * contributes its full height to the flow and the figure over-reports by
 * roughly its own size. Scrolling to a number that cannot be reached lets the
 * engine answer the question instead of guessing at it.
 */
const BOTTOM = 1e7

const NOTHING_TO_SHARE: Record<string, string> = {
  workout: 'Log a workout first, then you can share it.',
  weigh_in: 'No official weigh-in to share yet.',
  steps: 'No steps logged today yet.',
  achievement: 'No achievements unlocked yet.',
  challenge: 'No challenge running this week.',
}

function ShareButton({
  label,
  icon,
  onClick,
  pressed,
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
  pressed?: boolean
}) {
  return (
    <button
      className={[styles.share, pressed ? styles.sharePressed : ''].filter(Boolean).join(' ')}
      onClick={onClick}
      aria-expanded={pressed === undefined ? undefined : pressed}
    >
      {icon}
      <span className={styles.shareLabel}>{label}</span>
    </button>
  )
}
