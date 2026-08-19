import { Link } from 'react-router-dom'
import { Heart, MessageCircle } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { SharedCard } from '@/components/chat/SharedCard'
import { MediaFrame } from './MediaFrame'
import type { FeedPost } from '@/services/postService'
import { useAuth } from '@/context/AuthContext'
import { timeAgo } from '@/utils/date'
import { firstName } from '@/utils/format'
import styles from './PostCard.module.css'

/** A short label for what kind of post this is, when it is worth saying. */
const KIND_LABEL: Partial<Record<FeedPost['type'], string>> = {
  workout: 'Workout',
  weigh_in: 'Weigh-in',
  steps: 'Steps',
  achievement: 'Achievement',
  motivation: 'Motivation',
}

/**
 * One post in the feed.
 *
 * Read-only in Phase 1. Reaction and comment counts are shown because they are
 * real seeded numbers, but they are not buttons yet — reacting and commenting
 * are Phase 2, and a control that looks live but does nothing is worse than no
 * control. Records are rendered by the same `SharedCard` the chat uses, so a
 * shared workout looks identical wherever it appears and stays current.
 */
export function PostCard({ post }: { post: FeedPost }) {
  const { user } = useAuth()
  const kind = KIND_LABEL[post.type]
  const isMine = user?.id === post.userId

  return (
    <article className={styles.card}>
      <header className={styles.head}>
        <Link
          to={isMine ? '/me' : `/u/${post.userId}`}
          className={styles.avatar}
          aria-label={post.author.name}
        >
          <Avatar user={post.author} size="sm" />
        </Link>
        <div className={styles.who}>
          <p className={styles.name}>{firstName(post.author.name)}</p>
          <p className={styles.when}>
            {timeAgo(post.createdAt)}
            {kind ? <span className={styles.kind}>{kind}</span> : null}
          </p>
        </div>
      </header>

      {post.text ? <p className={styles.text}>{post.text}</p> : null}

      {post.media.map((asset) => (
        <MediaFrame key={asset.id} asset={asset} />
      ))}

      {post.sharedType ? (
        <div className={styles.shared}>
          <SharedCard message={post} author={post.author} />
        </div>
      ) : null}

      <footer className={styles.footer}>
        <span className={styles.count}>
          <Heart size={14} strokeWidth={2.2} />
          <span className="tnum">{post.reactionCount}</span>
        </span>
        <span className={styles.count}>
          <MessageCircle size={14} strokeWidth={2.2} />
          <span className="tnum">{post.commentCount}</span>
        </span>
      </footer>
    </article>
  )
}
