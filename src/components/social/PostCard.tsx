import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Heart, MessageCircle } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { SharedCard } from '@/components/chat/SharedCard'
import { MediaFrame } from './MediaFrame'
import { CommentsSheet } from './CommentsSheet'
import type { FeedPost } from '@/services/postService'
import { postService } from '@/services'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
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
 * A quiet summary on the right of the footer, shown once somebody has actually
 * reacted. It reports rather than invites — the heart on the left is the
 * control.
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
 * Reacting and commenting are live. The heart toggles your own reaction — one
 * per person, tap again to take it back — and the comment count opens the
 * comments overlay. Nothing about a thread is rendered in the feed itself: a
 * post with forty comments and a post with none are exactly the same height,
 * which is what keeps scrolling predictable. Both go through postService,
 * which re-derives the counts from the rows so the number on the card cannot
 * drift from what is behind it.
 *
 * Records are rendered by the same `SharedCard` the chat uses, so a shared
 * workout looks identical wherever it appears and stays current.
 */
export function PostCard({ post }: { post: FeedPost }) {
  const { user } = useAuth()
  const { guard } = useToast()
  const [commentsOpen, setCommentsOpen] = useState(false)
  const kind = KIND_LABEL[post.type]
  const isMine = user?.id === post.userId
  const reaction = post.reactionCount > 0 ? REACTION_WORD[post.type] : undefined

  const reactions = useLiveQuery(() => postService.reactionsFor(post.id), [post.id])
  const mineReacted = Boolean(reactions?.some((r) => r.userId === user?.id))

  // One emoji on the feed. The chat has a picker because a conversation earns
  // nuance; a post only needs "I saw this and I am glad".
  const toggle = () => {
    if (!user) return
    void guard(() => postService.toggleReaction(post.id, user.id, '🔥'))
  }

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
          <button
            className={[styles.count, mineReacted ? styles.countOn : ''].filter(Boolean).join(' ')}
            onClick={toggle}
            aria-pressed={mineReacted}
            aria-label={mineReacted ? 'Remove your reaction' : 'React to this post'}
          >
            <Heart
              size={16}
              strokeWidth={2.2}
              className={mineReacted ? styles.hearted : undefined}
            />
            <span className="tnum">{post.reactionCount}</span>
          </button>
          <button
            className={[styles.count, commentsOpen ? styles.countOn : ''].filter(Boolean).join(' ')}
            onClick={() => setCommentsOpen(true)}
            aria-haspopup="dialog"
            aria-label={
              post.commentCount === 1 ? 'View 1 comment' : `View ${post.commentCount} comments`
            }
          >
            <MessageCircle size={16} strokeWidth={2.2} />
            <span className="tnum">{post.commentCount}</span>
          </button>
        </span>

        {reaction ? (
          <span className={styles.reaction}>
            <span aria-hidden="true">🔥</span>
            {reaction}!
          </span>
        ) : null}
      </footer>

      {/*
        The thread opens over the feed, not inside the card. Mounted only while
        it is open so a screen of posts is not a screen of hidden dialogs.
      */}
      {commentsOpen ? (
        <CommentsSheet post={post} open onClose={() => setCommentsOpen(false)} />
      ) : null}
    </article>
  )
}
