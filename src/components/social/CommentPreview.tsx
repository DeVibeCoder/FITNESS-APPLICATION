import { useLiveQuery } from 'dexie-react-hooks'
import { Avatar } from '@/components/ui/Avatar'
import { postService, userService } from '@/services'
import { firstName } from '@/utils/format'
import styles from './CommentPreview.module.css'

/**
 * The last couple of comments on a post, as a conversation rather than a list.
 *
 * Two at most, clamped to two lines each. The feed's job is to let you see
 * that people replied and roughly what about — reading the thread is what the
 * post's own comment view is for, which is where the footer link goes.
 *
 * Renders nothing at all when there are no comments, so a quiet post costs no
 * vertical space.
 */
export function CommentPreview({ postId, onOpen }: { postId: string; onOpen: () => void }) {
  const comments = useLiveQuery(() => postService.commentsFor(postId), [postId])
  const users = useLiveQuery(() => userService.listMembers(), [])

  if (!comments || comments.length === 0 || !users) return null

  const byId = new Map(users.map((u) => [u.id, u]))
  // The newest two, still in reading order.
  const shown = comments.slice(-2)

  return (
    <div className={styles.wrap}>
      <ul className={styles.list}>
        {shown.map((comment) => {
          const author = byId.get(comment.userId)
          if (!author) return null
          return (
            <li key={comment.id} className={styles.item}>
              <Avatar user={author} size="xs" />
              <p className={styles.line}>
                <span className={styles.name}>{firstName(author.name)}</span>{' '}
                <span className={styles.text}>{comment.text}</span>
              </p>
            </li>
          )
        })}
      </ul>

      <button className={styles.more} onClick={onOpen}>
        {comments.length > shown.length
          ? `View all ${comments.length} comments`
          : 'View comments'}
        <span aria-hidden="true"> →</span>
      </button>
    </div>
  )
}
