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
 * How the group tends to answer each kind of post.
 *
 * Shown as a quiet summary on the right of the footer, not as a button — the
 * reference puts a reaction there and it is the warmest thing on the card, but
 * reacting is Phase 2 and a control that looks live and does nothing is worse
 * than none. It only appears once somebody has actually reacted.
 */
const REACTION_WORD: Partial<Record<FeedPost['type'], string>> = {
  workout: 'Respect',
  weigh_in: 'Great',
  steps: 'Strong',
  achievement: 'Earned',
  motivation: 'Inspiring',
}

/**
 * One post in the feed.
 *
 * Media-first: when a post carries an image it runs full-bleed to the card's
 * edges and the text sits underneath, which is what makes a feed scan as a
 * feed rather than as a list of notes. Text-only posts keep their padding and
 * lead with the words.
 *
 * Read-only in Phase 1. Reaction and comment counts are shown because they are
 * real seeded numbers, but they are not buttons yet. Records are rendered by
 * the same `SharedCard` the chat uses, so a shared workout looks identical
 * wherever it appears and stays current.
 */
export function PostCard({ post }: { post: FeedPost }) {
  const { user } = useAuth()
  const kind = KIND_LABEL[post.type]
  const isMine = user?.id === post.userId
  const reaction = post.reactionCount > 0 ? REACTION_WORD[post.type] : undefined

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

      {/* Full-bleed, above the words — the card's subject when there is one. */}
      {post.media.length > 0 ? (
        <div className={styles.media}>
          {post.media.map((asset) => (
            <MediaFrame key={asset.id} asset={asset} rounded={false} />
          ))}
        </div>
      ) : null}

      <div className={styles.body}>
        {post.text ? <p className={styles.text}>{post.text}</p> : null}

        {post.sharedType ? (
          <div className={styles.shared}>
            <SharedCard message={post} author={post.author} />
          </div>
        ) : null}
      </div>

      <footer className={styles.footer}>
        <span className={styles.counts}>
          <span className={styles.count}>
            <Heart
              size={16}
              strokeWidth={2.2}
              className={post.reactionCount > 0 ? styles.hearted : undefined}
            />
            <span className="tnum">{post.reactionCount}</span>
          </span>
          <span className={styles.count}>
            <MessageCircle size={16} strokeWidth={2.2} />
            <span className="tnum">{post.commentCount}</span>
          </span>
        </span>

        {reaction ? (
          <span className={styles.reaction}>
            <span aria-hidden="true">🔥</span>
            {reaction}!
          </span>
        ) : null}
      </footer>
    </article>
  )
}
