import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowDown,
  ArrowLeft,
  Award,
  Dumbbell,
  Footprints,
  Pin,
  Plus,
  Scale,
  SendHorizontal,
  Smile,
  Target,
  X,
} from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { sharedSummary } from '@/components/chat/shareLabels'
import { MessageActions } from '@/components/chat/MessageActions'
import { StickerPicker } from '@/components/chat/StickerPicker'
import { GroupMembersSheet } from '@/components/chat/GroupMembersSheet'
import { MemberSheet } from '@/components/group/MemberSheet'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { challengeService, chatService , userService } from '@/services'
import type { ChatMessageView } from '@/services/chatService'
import { todayKey } from '@/utils/date'
import { firstName } from '@/utils/format'
import { STICKER_BY_KEY } from '@/data/stickers'
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
  const [shareMenu, setShareMenu] = useState(false)
  const [stickersOpen, setStickersOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  /**
   * The message a press-and-hold opened, and where it was when it did.
   *
   * The rectangle is captured at the moment of the press rather than looked up
   * later: by the time the menu paints, the thread may have moved under it.
   */
  const [actions, setActions] = useState<{ message: ChatMessageView; anchor: DOMRect } | null>(null)
  /**
   * One person, opened from the member list.
   *
   * The same sheet Group opens, over the thread rather than instead of it —
   * looking somebody up mid-conversation must not cost you the conversation,
   * and there is no reason for Chat to grow a second member layout that can
   * drift from the one Group already has.
   */
  const [memberDetail, setMemberDetail] = useState<string | null>(null)
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
  /**
   * True while the composer holds focus — which on a phone means the keyboard
   * is up. The bottom navigation hides for the duration so the composer can
   * sit directly on the keyboard, the way every messaging app behaves. It is
   * published as an attribute on <body> rather than lifted into context
   * because it is presentation, and the nav only needs to react to it in CSS.
   */
  /*
   * How much the keyboard is actually covering, measured rather than assumed.
   * The dock lifts by exactly this, so no device-specific offset is baked in
   * and browsers that reflow the layout viewport themselves simply report 0.
   *
   * The layout follows this and *not* the composer's focus. Driving it from
   * focus meant any blur — tapping Send, tapping a delete icon — moved the
   * page between mousedown and mouseup, so the press landed on nothing. A
   * keyboard that is genuinely open is the only thing that should reflow the
   * screen, and on a desktop nothing reflows at all.
   */
  const { inset: keyboard, open: keyboardOpen } = useKeyboardInset()
  const input = useRef<HTMLTextAreaElement>(null)
  /*
   * Callback refs, not `useRef`, and that distinction is the whole reason the
   * measurement works.
   *
   * This screen returns a loading state before it returns the thread, so the
   * first commit — the one a `[]` effect runs after — has no dock and no page
   * to observe, and a plain ref would have been null exactly when the effect
   * looked. A callback ref fires when the node actually appears, whenever that
   * is, and re-runs the effect with it.
   */
  const [dockNode, setDockNode] = useState<HTMLDivElement | null>(null)
  const [pageNode, setPageNode] = useState<HTMLDivElement | null>(null)
  const positioned = useRef(false)
  const seenCount = useRef(0)

  /*
   * The dock's real height, published to the page as `--dock-height`.
   *
   * The page reserves exactly this much at its foot, so the newest message
   * always clears the composer. A fixed guess could not: the dock is taller
   * with a reply banner open, taller again while a two-line message is being
   * typed, and the difference is precisely what was cutting a shared workout
   * card in half at the bottom of the thread.
   */
  useEffect(() => {
    if (!dockNode || !pageNode) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      // borderBoxSize, not contentRect: the dock's own padding is part of what
      // the thread has to clear, and contentRect leaves it out.
      const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
      pageNode.style.setProperty('--dock-height', `${Math.ceil(height)}px`)
    })
    observer.observe(dockNode)
    return () => observer.disconnect()
  }, [dockNode, pageNode])

  const messages = useLiveQuery(() => chatService.list(), [])
  const users = useLiveQuery(() => userService.listMembers(), [])
  // Normally empty. One banner, for the one thing the group agreed to keep in
  // view — a session time, this week's target.
  const pinned = useLiveQuery(() => chatService.pinned(), [])
  const challenge = useLiveQuery(() => challengeService.forWeek(today), [today])
  /*
   * What this person actually has to share. The menu lists only these, so it
   * can never offer an action whose only possible outcome is an error toast.
   */
  const shareable = useLiveQuery(
    () => (user ? chatService.shareable(user.id, today, challenge?.id) : undefined),
    [user?.id, today, challenge?.id],
  )
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

  /**
   * Puts the newest message at the bottom of whatever space is left.
   *
   * Called on open, on send, on the arrow, and every time the keyboard moves.
   * `BOTTOM` is far past any real page, so the browser clamps to the true
   * maximum — which is the only number that is correct after a reflow nobody
   * has measured yet.
   */
  const toBottom = useCallback((smooth = false) => {
    window.scrollTo({ top: BOTTOM, behavior: smooth ? 'smooth' : 'auto' })
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

  useEffect(() => {
    if (keyboardOpen) document.body.dataset.composing = 'true'
    else delete document.body.dataset.composing
    // Leaving mid-typing must not strand the rest of the app without a nav.
    return () => {
      delete document.body.dataset.composing
    }
  }, [keyboardOpen])

  /*
   * The keyboard changing the viewport is the reflow that actually decides
   * where the bottom is, and it arrives long after the focus handler ran.
   *
   * Three passes rather than one. The keyboard animates over roughly a third
   * of a second and the layout is a different height at every frame of it, so
   * a single scroll lands against a viewport that is about to change again.
   * Each pass is cheap — a scroll to a clamped maximum — and the last one is
   * the one that sticks. This is what makes "the newest message is visible the
   * moment the keyboard opens" true whether the keyboard was already up or
   * not.
   */
  useEffect(() => {
    if (!keyboardOpen) return
    if (document.activeElement !== input.current) return
    const passes = [0, 140, 340].map((delay) => window.setTimeout(() => toBottom(), delay))
    return () => passes.forEach(window.clearTimeout)
  }, [keyboardOpen, keyboard, toBottom])

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
    toBottom(true)
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
    // Back to a clean conversation the moment something is chosen.
    setShareMenu(false)
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
    <div className={styles.page} ref={setPageNode}>
      {/* Focused header: out, who is here, and nothing else. */}
      <header className={styles.head}>
        <Link to="/chat" className={styles.back} aria-label="Back to chat">
          <ArrowLeft size={18} strokeWidth={2.2} />
        </Link>
        {/*
          The title and the faces are one control. The row of avatars used to
          be decoration — it said three people were here without saying which
          three — so it now opens the member list, which is the question it
          was already provoking.
        */}
        <button
          className={styles.who}
          onClick={() => setMembersOpen(true)}
          aria-haspopup="dialog"
          aria-label="See who is in this group"
        >
          <span className={styles.headText}>
            <span className={styles.title}>Fitness group</span>
            <span className={styles.sub}>{users.length} people</span>
          </span>
          <span className={styles.faces} aria-hidden="true">
            {users.slice(0, 3).map((member) => (
              <span key={member.id} className={styles.face}>
                <Avatar user={member} size="xs" />
              </span>
            ))}
          </span>
        </button>
      </header>

      <GroupMembersSheet
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        onSelect={(id) => {
          // One sheet at a time: the list steps aside for the person it named.
          setMembersOpen(false)
          setMemberDetail(id)
        }}
      />
      <MemberSheet userId={memberDetail} onClose={() => setMemberDetail(null)} />

      {pinned && pinned.length > 0 ? (
        <button
          className={styles.pinnedBar}
          onClick={() => {
            const target = document.getElementById(`message-${pinned[0].id}`)
            target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }}
        >
          <Pin size={13} strokeWidth={2.4} className={styles.pinnedIcon} />
          <span className={styles.pinnedText}>
            {pinned[0].text ||
              (pinned[0].stickerId
                ? `Sticker: ${STICKER_BY_KEY.get(pinned[0].stickerId)?.label ?? 'sticker'}`
                : sharedSummary(pinned[0].sharedType))}
          </span>
          {pinned.length > 1 ? (
            <span className={styles.pinnedCount}>+{pinned.length - 1}</span>
          ) : null}
        </button>
      ) : null}

      <div className={styles.thread}>
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Your group is quiet.</p>
            <p className={styles.emptyBody}>Share what you're working on today.</p>
            <button className={styles.emptyAction} onClick={() => input.current?.focus()}>
              Write a message
            </button>
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
                <div key={message.id} id={`message-${message.id}`}>
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
                    onOpenActions={(target, anchor) => setActions({ message: target, anchor })}
                    grouped={grouped && firstUnreadId !== message.id}
                  />
                </div>
              )
            })}
          </ul>
        )}
      </div>

      <div
        ref={setDockNode}
        className={[styles.dock, keyboardOpen ? styles.docked : ''].filter(Boolean).join(' ')}
        style={keyboard ? ({ '--keyboard': `${keyboard}px` } as React.CSSProperties) : undefined}
      >
        {/*
          One small arrow at the lower right, and nothing behind it.

          It replaced two centred pills sitting on a frosted panel across the
          middle of the thread — which covered the newest messages, which are
          exactly the ones somebody scrolling back down is trying to read. A
          count rides on the arrow when messages arrived while you were up in
          the history, because that is news; being scrolled up on its own is
          not, so then it is just the arrow.
        */}
        {scrolledUp || arrived > 0 ? (
          <button
            className={[styles.toNewest, arrived > 0 ? styles.toNewestNew : '']
              .filter(Boolean)
              .join(' ')}
            onClick={jumpToNewest}
            aria-label={
              arrived > 0
                ? `${arrived} new message${arrived === 1 ? '' : 's'} — go to the newest`
                : 'Go to the newest message'
            }
          >
            <ArrowDown size={18} strokeWidth={2.6} />
            {arrived > 0 ? (
              <span className={styles.toNewestBadge}>{arrived > 9 ? '9+' : arrived}</span>
            ) : null}
          </button>
        ) : null}

        {/*
          The share menu, opened by the + beside the input.
          It replaced a permanent row of four chips above the composer. That
          row made every screenful of conversation look like a logging form,
          and three quarters of it was usually irrelevant — so it is a menu
          now, and it lists only what this person actually has to share.
        */}
        {shareMenu ? (
          <>
            <button
              className={styles.scrim}
              onClick={() => setShareMenu(false)}
              aria-label="Close share menu"
            />
            <div className={styles.shareMenu} role="menu" aria-label="Share your progress">
              {SHARE_ACTIONS.filter((action) => shareable?.has(action.kind)).map((action) => (
                <button
                  key={action.kind}
                  role="menuitem"
                  className={styles.shareItem}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => share(action.kind)}
                >
                  <span className={styles.shareIcon}>{action.icon}</span>
                  {action.label}
                </button>
              ))}
              {shareable && shareable.size === 0 ? (
                <p className={styles.shareEmpty}>
                  Nothing to share yet — log a workout, steps or a weigh-in first.
                </p>
              ) : null}
            </div>
          </>
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
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setReplyTo(null)}
                aria-label="Cancel reply"
              >
                <X size={15} strokeWidth={2.4} />
              </button>
            </div>
          ) : null}

          <div className={styles.inputRow}>
            {/*
              onMouseDown preventDefault, on every control inside the dock.

              Without it, pressing one blurs the textarea first: `composing`
              flips false, the bottom bar slides back in, and the dock drops by
              the bar's height *between mousedown and mouseup* — so the press
              lands on empty page and Send silently does nothing. Keeping focus
              in the textarea also keeps the keyboard up after sending, which
              is what a chat should do anyway.
            */}
            <button
              className={[styles.attach, shareMenu ? styles.attachOpen : ''].filter(Boolean).join(' ')}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setShareMenu((open) => !open)}
              aria-label="Share progress"
              aria-expanded={shareMenu}
              aria-haspopup="menu"
            >
              <Plus size={18} strokeWidth={2.6} />
            </button>

            {/*
              Stickers and GIFs. Beside the input rather than inside the share
              menu: a sticker is a way of saying something, not a record being
              attached, and it belongs next to the words for the same reason
              the emoji key does on a phone keyboard.
            */}
            <button
              className={[styles.attach, stickersOpen ? styles.attachOpen : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => {
                /*
                 * Let the keyboard go before the sheet arrives.
                 *
                 * The sticker sheet is a real overlay, not an input accessory,
                 * so a keyboard still on screen underneath it fights it for
                 * the bottom half of the phone: the sheet opens behind it, the
                 * viewport resizes as it closes anyway, and the thread jumps.
                 * Blurring first makes the sequence deliberate — keyboard
                 * down, then sheet up — and the anchor effect puts the newest
                 * message back where it belongs on the way through.
                 *
                 * This is also why the button does *not* preventDefault on
                 * mousedown the way Send does: Send must keep focus, and this
                 * must give it up.
                 */
                input.current?.blur()
                setStickersOpen(true)
              }}
              aria-label="Stickers and GIFs"
              aria-haspopup="dialog"
            >
              <Smile size={18} strokeWidth={2.2} />
            </button>

            <textarea
              ref={input}
              className={styles.input}
              value={draft}
              rows={1}
              /*
                One word. "Write a message…" wrapped to a second line inside a
                single-row textarea at 320px once the sticker button joined the
                row, and the second line was clipped — a placeholder reading
                "Write a" over a cut-off "message" is worse than the plain
                noun every chat app uses.
              */
              placeholder="Message"
              aria-label="Write a message"
              onChange={(event) => {
                setDraft(event.target.value)
                event.target.style.height = 'auto'
                event.target.style.height = `${event.target.scrollHeight}px`
              }}
              onFocus={() => {
                /*
                 * Tapping the composer means you are about to say something,
                 * and what you are about to say goes at the bottom — so this
                 * goes to the newest message whether or not you were already
                 * there, and whether or not the keyboard was already up.
                 *
                 * The effect above catches the reflow the keyboard causes;
                 * this covers the case where it causes none, because it was
                 * already open.
                 */
                jumpToNewest()
                window.setTimeout(jumpToNewest, 120)
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
              onMouseDown={(event) => event.preventDefault()}
              onClick={send}
              disabled={!draft.trim() || sending}
              aria-label="Send message"
            >
              <SendHorizontal size={17} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </div>

      {actions ? (
        <MessageActions
          message={actions.message}
          anchor={actions.anchor}
          onClose={() => setActions(null)}
          onReply={(target) => {
            setReplyTo(target)
            input.current?.focus()
          }}
        />
      ) : null}

      {stickersOpen ? (
        <StickerPicker
          onClose={() => setStickersOpen(false)}
          onSticker={async (stickerId) => {
            setStickersOpen(false)
            const sent = await guard(() =>
              chatService.sendSticker(user.id, stickerId, replyTo?.id),
            )
            if (sent === undefined) return
            setReplyTo(null)
            // The sheet closing is itself a reflow, so the anchor waits for it.
            window.setTimeout(() => toBottom(), 80)
            window.setTimeout(() => toBottom(), 320)
          }}
        />
      ) : null}
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

/**
 * What the + offers, in the order it offers it.
 *
 * Declared once rather than written out five times in the menu: the list is
 * filtered against what is actually available, so the markup only has to know
 * how to render an item, not which items exist.
 */
const SHARE_ACTIONS = [
  { kind: 'workout', label: 'Share workout', icon: <Dumbbell size={16} strokeWidth={2.1} /> },
  { kind: 'weigh_in', label: 'Share weigh-in', icon: <Scale size={16} strokeWidth={2.1} /> },
  { kind: 'steps', label: 'Share steps', icon: <Footprints size={16} strokeWidth={2.1} /> },
  { kind: 'achievement', label: 'Share achievement', icon: <Award size={16} strokeWidth={2.1} /> },
  { kind: 'challenge', label: 'Share challenge', icon: <Target size={16} strokeWidth={2.1} /> },
] as const
