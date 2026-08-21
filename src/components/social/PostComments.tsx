import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { SendHorizontal, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { postService, userService } from '@/services'
import { timeAgo } from '@/utils/date'
import { firstName } from '@/utils/format'
import styles from './PostComments.module.css'

/**
 * The comments on one post: a small thread and a reply box.
 *
 * Deliberately not a comment system. One level, no mentions, no sorting, no
 * pagination — three people replying to a post, which is all this ever needs
 * to be. Deleting is the author's own, enforced by the same ownership guard
 * the services use everywhere else.
 */
export function PostComments({ postId }: { postId: string }) {
  const { user, isOwner } = useAuth()
  const { guard } = useToast()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const comments = useLiveQuery(() => postService.commentsFor(postId), [postId])
  const users = useLiveQuery(() => userService.listMembers(), [])

  if (!user || comments === undefined || users === undefined) return null
  const byId = new Map(users.map((u) => [u.id, u]))

  const submit = async () => {
    if (!draft.trim() || sending) return
    setSending(true)
    const result = await guard(() => postService.comment(postId, user.id, draft))
    setSending(false)
    // Only clear once it actually landed — losing what you typed to a failed
    // write is worse than leaving it there to try again.
    if (result) setDraft('')
  }

  return (
    <div className={styles.wrap}>
      {comments.length > 0 ? (
        <ul className={styles.list}>
          {comments.map((comment) => {
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
      ) : (
        <p className={styles.none}>No comments yet.</p>
      )}

      <div className={styles.compose}>
        <input
          className={styles.input}
          value={draft}
          placeholder="Add a comment…"
          aria-label="Add a comment"
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
          <SendHorizontal size={15} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  )
}
