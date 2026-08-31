import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Heart,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { SharedCard } from '@/components/chat/SharedCard'
import { MediaFrame } from './MediaFrame'
import { CommentsSheet } from './CommentsSheet'
import { MediaLightbox } from './MediaLightbox'
import { PostComposer } from './PostComposer'
import type { MediaAsset } from '@/models'
import type { FeedPost } from '@/services/postService'
import { chatService, postService } from '@/services'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { timeAgo } from '@/utils/date'
import { firstName } from '@/utils/format'
import styles from './PostCard.module.css'

/**
 * How much of a caption shows before it is folded.
 *
 * A character count rather than a measured height: it costs no layout pass,
 * it is the same on every screen width, and being approximately right about
 * "this is long" is all the decision needs. A caption with paragraphs in it
 * folds sooner, because blank lines make it taller than its length suggests.
 */
const FOLD_AT = 220
const FOLD_AT_LINES = 6

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
 * Words first, then the picture. A caption underneath a photo is read after
 * the thing it was meant to introduce, and a caption *on* a photo fights it
 * for the same pixels — so the order here is author, what they said, what they
 * are showing. The picture still runs full-bleed to the card's edges, which is
 * what keeps a feed scanning as a feed rather than as a list of notes.
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
  const { user, isOwner } = useAuth()
  const { show, guard } = useToast()
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [lightbox, setLightbox] = useState<MediaAsset | null>(null)
  const kind = KIND_LABEL[post.type]
  const isMine = isOwner(post.userId)
  const reaction = post.reactionCount > 0 ? REACTION_WORD[post.type] : undefined
  /*
   * Motivation is not a post with a label on it.
   *
   * It is somebody handing the group a line, so it is set as one: a quote on
   * the app's own orange, with the words at display size and the attribution
   * underneath. It folds later than an ordinary post because a quote that
   * stops mid-sentence is not a quote.
   */
  const isMotivation = post.type === 'motivation'
  const longCaption = isMotivation
    ? post.text.length > FOLD_AT * 2
    : post.text.length > FOLD_AT || post.text.split('\n').length > FOLD_AT_LINES
  const folded = longCaption && !expanded

  const reactions = useLiveQuery(() => postService.reactionsFor(post.id), [post.id])
  const mineReacted = Boolean(reactions?.some((r) => r.userId === user?.id))

  // One emoji on the feed. The chat has a picker because a conversation earns
  // nuance; a post only needs "I saw this and I am glad".
  const toggle = () => {
    if (!user) return
    void guard(() => postService.toggleReaction(post.id, user.id, '🔥'))
  }

  /** Sends the line to the chat, as text, attributed to whoever wrote it. */
  const passItOn = async () => {
    if (!user) return
    const sent = await guard(() =>
      chatService.send({
        userId: user.id,
        text: `“${post.text}” — ${firstName(post.author.name)}`,
      }),
    )
    if (sent) show('Sent to the group chat.', 'success')
  }

  const remove = async () => {
    const done = await guard(() => postService.remove(post.id))
    if (done === undefined) return
    // Nothing to close afterwards — the feed query drops the card itself.
    show('Post deleted.', 'success')
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
            {post.updatedAt ? <span className={styles.edited}>edited</span> : null}
            {/*
              Only the author ever sees a private post, so the badge is for
              them: it is the difference between "nobody replied" and "nobody
              could see it".
            */}
            {post.visibility === 'private' ? (
              <span className={styles.private}>
                <Lock size={11} strokeWidth={2.6} />
                Only you
              </span>
            ) : null}
            {kind ? (
              <span
                className={[styles.kind, isMotivation ? styles.kindMotivation : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                {isMotivation ? <Sparkles size={10} strokeWidth={2.6} aria-hidden="true" /> : null}
                {kind}
              </span>
            ) : null}
          </p>
        </div>

        {/*
          Editing and deleting, and only on your own post. The guard in the
          service is what actually enforces that; this is what stops the
          affordance appearing where it cannot work.
        */}
        {isMine ? (
          <div className={styles.owner}>
            <button
              className={styles.menuButton}
              onClick={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Post options"
            >
              <MoreHorizontal size={18} strokeWidth={2.2} />
            </button>
            {menuOpen ? (
              <>
                <button
                  className={styles.menuScrim}
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close post options"
                  tabIndex={-1}
                />
                <div className={styles.menu} role="menu">
                  <button
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() => {
                      setMenuOpen(false)
                      setEditing(true)
                    }}
                  >
                    <Pencil size={15} strokeWidth={2.1} />
                    Edit post
                  </button>
                  <button
                    role="menuitem"
                    className={`${styles.menuItem} ${styles.menuDanger}`}
                    onClick={() => {
                      setMenuOpen(false)
                      setConfirmDelete(true)
                    }}
                  >
                    <Trash2 size={15} strokeWidth={2.1} />
                    Delete post
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className={[styles.body, isMotivation ? styles.motivationBody : ''].filter(Boolean).join(' ')}>
        {isMotivation && post.text ? (
          <blockquote className={styles.motivation}>
            {/*
              A slow wash of light behind the words. It is one element and one
              transform, so it composites and costs nothing; `prefers-reduced-
              motion` stops it dead and leaves the same card, still.
            */}
            <span className={styles.motivationGlow} aria-hidden="true" />
            <span className={styles.motivationMark} aria-hidden="true">
              “
            </span>
            <p className={[styles.motivationText, folded ? styles.folded : ''].filter(Boolean).join(' ')}>
              {post.text}
            </p>
            <footer className={styles.motivationBy}>
              Passed on by {firstName(post.author.name)}
            </footer>
          </blockquote>
        ) : post.text ? (
          <p className={[styles.text, folded ? styles.folded : ''].filter(Boolean).join(' ')}>
            {post.text}
          </p>
        ) : null}
        {longCaption ? (
          <button className={styles.more} onClick={() => setExpanded((open) => !open)}>
            {expanded ? 'See less' : 'See more'}
          </button>
        ) : null}

        {post.sharedType ? (
          <div className={styles.shared}>
            <SharedCard message={post} author={post.author} />
          </div>
        ) : null}
      </div>

      {/*
        Full-bleed, under the words it belongs to, and in the media's own
        shape rather than a fixed box. Pressing it opens the whole frame —
        the feed's clamp is a scanning compromise, not the only way to see it.
      */}
      {post.media.length > 0 ? (
        <div className={styles.media}>
          {post.media.map((asset) => (
            <button
              key={asset.id}
              className={styles.mediaButton}
              onClick={() => setLightbox(asset)}
              aria-label={asset.kind === 'video' ? 'Play this clip' : 'View this photo'}
            >
              <MediaFrame asset={asset} rounded={false} natural />
            </button>
          ))}
        </div>
      ) : null}

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

        {/*
          Motivation is the one kind of post that exists to be passed on
          again, so it gets a control the others do not: it sends the line to
          the chat rather than reacting to it here.
        */}
        {isMotivation ? (
          <button className={styles.pass} onClick={passItOn} aria-label="Send this to the chat">
            <Send size={14} strokeWidth={2.3} />
            Pass it on
          </button>
        ) : reaction ? (
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

      {/*
        The caption goes with the picture. Reading what somebody said about a
        photo used to mean closing the photo first, which is the sort of small
        tax that stops people opening them at all.
      */}
      {lightbox ? (
        <MediaLightbox
          asset={lightbox}
          caption={post.text}
          author={post.author}
          when={post.createdAt}
          onClose={() => setLightbox(null)}
        />
      ) : null}

      {/*
        The same composer that wrote it, opened on what it already says — and
        mounted only while it is open, for the same reason the thread is.
      */}
      {editing ? (
        <Sheet open onClose={() => setEditing(false)} title="Edit post">
          <PostComposer
            post={post}
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </Sheet>
      ) : null}

      {confirmDelete ? (
        <Sheet open onClose={() => setConfirmDelete(false)} title="Delete this post?">
          <p className={styles.confirmText}>
            It goes for everyone, along with its reactions and comments. This cannot be undone.
          </p>
          <div className={styles.confirmRow}>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmDelete(false)
                void remove()
              }}
            >
              Delete
            </Button>
          </div>
        </Sheet>
      ) : null}
    </article>
  )
}
