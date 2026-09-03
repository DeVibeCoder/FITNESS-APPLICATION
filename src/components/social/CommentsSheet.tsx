import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { SendHorizontal, Trash2, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'
import { postService, userService } from '@/services'
import type { FeedPost } from '@/services/postService'
import { timeAgo } from '@/utils/date'
import { firstName } from '@/utils/format'
import styles from './CommentsSheet.module.css'

/**
 * The comments on one post, as a place you go rather than a drawer that grows
 * out of the feed.
 *
 * There is exactly one of these in the app. A bottom sheet on a phone and a
 * centred dialog on a desktop are the same component and the same markup —
 * only the CSS differs, because the two are the same interaction at two
 * widths, not two features. Nothing about the feed changes while it is open:
 * the card underneath keeps its height and its scroll position, which is the
 * whole reason the inline thread had to go.
 *
 * Deliberately not a comment system. One level, no mentions, no sorting, no
 * pagination — three people replying to a post. Deleting is the author's own,
 * enforced by the same ownership guard the services use everywhere else.
 */
export function CommentsSheet({
  post,
  open,
  onClose,
}: {
  post: FeedPost
  open: boolean
  onClose: () => void
}) {
  const { user, isOwner } = useAuth()
  const { guard } = useToast()
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  /*
   * The keyboard is measured rather than assumed. Safari leaves the layout
   * viewport at full height and simply covers the bottom of it, so the
   * composer has to lift by exactly what is covered; Chrome reflows for us and
   * reports 0. Both end up with the composer sitting on the keyboard.
   */
  const { inset: keyboard } = useKeyboardInset()

  const comments = useLiveQuery(() => (open ? postService.commentsFor(post.id) : undefined), [post.id, open])
  const users = useLiveQuery(() => (open ? userService.listMembers() : undefined), [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    const previouslyFocused = document.activeElement as HTMLElement | null
    // The feed must not scroll behind the sheet — that is what makes closing
    // return to exactly the position you opened from.
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  // Open on the newest comment, the way a conversation is read.
  useEffect(() => {
    if (!open || !comments) return
    const element = listRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [open, comments])

  if (!open || !user) return null

  const byId = new Map((users ?? []).map((u) => [u.id, u]))
  const rows = comments ?? []

  const submit = async () => {
    if (!draft.trim() || sending) return
    setSending(true)
    const result = await guard(() => postService.comment(post.id, user.id, draft))
    setSending(false)
    // Only clear once it actually landed — losing what you typed to a failed
    // write is worse than leaving it there to try again.
    if (result) {
      setDraft('')
      input.current?.focus()
    }
  }

  return createPortal(
    <div className={styles.root}>
      {/* Decorative click target; the header Close is the announced one. */}
      <button className={styles.scrim} onClick={onClose} aria-hidden="true" tabIndex={-1} />

      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        /*
         * The panel lifts rather than the composer alone: lifting only the
         * composer would leave the list running underneath the keyboard, and
         * the reader would lose the comment they were replying to.
         */
        style={keyboard > 0 ? { paddingBottom: keyboard } : undefined}
      >
        <div className={styles.grabber} aria-hidden="true" />

        <header className={styles.head}>
          <h2 id={titleId} className={styles.title}>
            Comments
            {rows.length > 0 ? <span className={`tnum ${styles.count}`}>{rows.length}</span> : null}
          </h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={2.2} />
          </button>
        </header>

        {/*
          One line of the post it belongs to. Enough to keep the thread
          anchored to something — a sheet of replies with no idea what is being
          replied to is the failure mode this line exists to prevent.
        */}
        <div className={styles.context}>
          <Avatar user={post.author} size="xs" />
          <p className={styles.contextText}>
            <span className={styles.contextName}>{firstName(post.author.name)}</span>{' '}
            <span className={styles.contextBody}>{post.text || postSummary(post)}</span>
          </p>
        </div>

        <div className={styles.list} ref={listRef}>
          {rows.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>No comments yet.</p>
              <p className={styles.emptyBody}>Be the first to say something.</p>
            </div>
          ) : (
            <ul className={styles.items}>
              {rows.map((comment) => {
                const author = byId.get(comment.userId)
                if (!author) return null
                return (
                  <li key={comment.id} className={styles.item}>
                    <Avatar user={author} size="xs" />
                    <div className={styles.body}>
                      <p className={styles.meta}>
                        <span className={styles.name}>{firstName(author.name)}</span>
                        <span className={styles.when}>{timeAgo(comment.createdAt)}</span>
                      </p>
                      <p className={styles.text}>{comment.text}</p>
                    </div>
                    {isOwner(comment.userId) ? (
                      <button
                        className={styles.remove}
                        onClick={() => guard(() => postService.removeComment(comment.id))}
                        aria-label="Delete your comment"
                      >
                        <Trash2 size={13} strokeWidth={2} />
                      </button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <footer className={styles.compose}>
          <Avatar user={user} size="xs" />
          <input
            ref={input}
            className={styles.input}
            value={draft}
            placeholder="Write a comment…"
            aria-label="Write a comment"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit()
              }
            }}
          />
          <button
            className={styles.send}
            onClick={submit}
            disabled={!draft.trim() || sending}
            aria-label="Post comment"
          >
            <SendHorizontal size={16} strokeWidth={2.2} />
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

/** What to call a post that has no words of its own. */
function postSummary(post: FeedPost): string {
  if (post.media.length > 0) return 'Shared a photo'
  switch (post.type) {
    case 'workout':
      return 'Shared a workout'
    case 'weigh_in':
      return 'Shared a weigh-in'
    case 'steps':
      return 'Shared their steps'
    case 'achievement':
      return 'Shared an achievement'
    default:
      return 'Shared an update'
  }
}
