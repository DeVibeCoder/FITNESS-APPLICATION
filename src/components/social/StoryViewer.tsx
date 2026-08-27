import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, Eye, Trash2, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { StoryFrame } from './StoryFrame'
import type { StoryRing } from '@/services/storyService'
import { storyService } from '@/services'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useHistoryDismiss } from '@/hooks/useHistoryDismiss'
import { timeAgo } from '@/utils/date'
import { firstName } from '@/utils/format'
import styles from './StoryViewer.module.css'

/**
 * The story viewer.
 *
 * Full screen on a phone, a centred stage with room around it on a desktop —
 * the same component either way, because it is one interaction at two widths.
 * The desktop version deliberately does not stretch: a story is a portrait
 * thing, and a 1400px-wide one is not a story, it is a banner.
 *
 * Timing lives in CSS. The active progress bar runs a 5s animation and its
 * `animationend` is what advances the story, so pausing the animation pauses
 * the whole thing with nothing to keep in sync — no interval, no elapsed
 * bookkeeping, and no way for the bar and the story to disagree.
 *
 * The rings are a snapshot taken when the viewer opened, on purpose. They come
 * from a live query, and watching a story rewrites the seen state that query
 * sorts on — reading it live would reorder the rail out from under someone
 * mid-story.
 *
 * Opening pushes a history entry, so the phone's Back gesture closes the story
 * rather than leaving the app. That is the whole reason for the entry: without
 * it, a full-screen overlay is invisible to the browser's idea of "where am
 * I", and Back does the only thing it can — leave. See `useHistoryDismiss`.
 */
export function StoryViewer({
  rings,
  startIndex,
  onClose,
}: {
  rings: StoryRing[]
  startIndex: number
  onClose: () => void
}) {
  const { user, isOwner } = useAuth()
  const { show, guard } = useToast()
  const [ringIndex, setRingIndex] = useState(startIndex)
  const [storyIndex, setStoryIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showViewers, setShowViewers] = useState(false)
  /** Stories deleted while the viewer is open; the snapshot cannot know. */
  const [deleted, setDeleted] = useState<Set<string>>(new Set())

  // Distinguishes a tap from a hold without a second gesture layer: the hold
  // timer fires, the tap that follows is suppressed.
  const holdTimer = useRef<number | null>(null)
  const held = useRef(false)
  /** Where a drag started, so a swipe can be told from a tap. */
  const swipeFrom = useRef<{ x: number; y: number } | null>(null)

  const live = useMemo(
    () =>
      rings
        .map((ring) => ({ ...ring, stories: ring.stories.filter((s) => !deleted.has(s.id)) }))
        .filter((ring) => ring.stories.length > 0),
    [rings, deleted],
  )

  const ring = live[Math.min(ringIndex, live.length - 1)]
  const story = ring?.stories[Math.min(storyIndex, (ring?.stories.length ?? 1) - 1)]
  const mine = Boolean(story && isOwner(story.userId))

  /*
   * How long this story is on screen. A picture or a few words get the usual
   * five seconds; a clip gets its own length, so the bar finishing and the
   * video finishing are the same moment rather than two competing ones.
   */
  const asset = story?.mediaId ? ring?.media.get(story.mediaId) : undefined
  const holdSec =
    asset?.kind === 'video' && asset.durationSec
      ? Math.min(Math.max(asset.durationSec, 3), 60)
      : 5

  const viewers = useLiveQuery(
    () => (story && mine ? storyService.viewersOf(story.id) : undefined),
    [story?.id, mine],
  )

  const next = useCallback(() => {
    setPaused(false)
    setShowViewers(false)
    const current = live[ringIndex]
    if (!current) return
    if (storyIndex + 1 < current.stories.length) {
      setStoryIndex(storyIndex + 1)
    } else if (ringIndex + 1 < live.length) {
      // Past this person's last story: on to the next person.
      setRingIndex(ringIndex + 1)
      setStoryIndex(0)
    } else {
      // Past the last person's last story: out.
      onClose()
    }
  }, [live, ringIndex, storyIndex, onClose])

  const previous = useCallback(() => {
    setPaused(false)
    setShowViewers(false)
    if (storyIndex > 0) {
      setStoryIndex(storyIndex - 1)
    } else if (ringIndex > 0) {
      setRingIndex(ringIndex - 1)
      setStoryIndex(Math.max(0, live[ringIndex - 1].stories.length - 1))
    }
    // At the very beginning, going back stays put rather than closing.
  }, [live, ringIndex, storyIndex])

  /*
   * Watching somebody's story marks it seen. Your own never counts — the
   * service enforces that too, so the rule holds whoever calls it.
   */
  const storyId = story?.id
  const authorId = story?.userId
  const viewerId = user?.id
  useEffect(() => {
    if (!storyId || !viewerId || authorId === viewerId) return
    void storyService.markSeen(storyId, viewerId)
  }, [storyId, authorId, viewerId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowRight') next()
      else if (event.key === 'ArrowLeft') previous()
      else if (event.key === ' ') {
        event.preventDefault()
        setPaused((value) => !value)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    // Nothing behind the viewer scrolls while it is open.
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose, next, previous])

  // Everything was deleted while it was open — there is nothing left to show.
  useEffect(() => {
    if (live.length === 0) onClose()
  }, [live.length, onClose])

  // Back closes the story instead of leaving the app.
  useHistoryDismiss(onClose)

  if (!user || !ring || !story) return null

  const startHold = (event: React.PointerEvent) => {
    held.current = false
    swipeFrom.current = { x: event.clientX, y: event.clientY }
    holdTimer.current = window.setTimeout(() => {
      held.current = true
      setPaused(true)
    }, 220)
  }

  const endHold = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
    holdTimer.current = null
    swipeFrom.current = null
    if (held.current) setPaused(false)
  }

  /**
   * A swipe, if it was one.
   *
   * Horizontal moves between stories. Vertical is caught and deliberately
   * ignored — the point is that a stray downward flick, which on a phone is
   * the gesture that dismisses things, does nothing here rather than something
   * surprising. Back is the way out, and the close button is the other one.
   */
  const endSwipe = (event: React.PointerEvent) => {
    const from = swipeFrom.current
    endHold()
    if (!from || held.current) return

    const dx = event.clientX - from.x
    const dy = event.clientY - from.y
    if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy)) return

    // A swipe is navigation, so the tap underneath it must not also fire.
    held.current = true
    if (dx < 0) next()
    else previous()
  }

  /** A tap navigates; the tap that ends a hold does not. */
  const tap = (go: () => void) => () => {
    if (held.current) {
      held.current = false
      return
    }
    go()
  }

  const remove = async () => {
    setConfirmDelete(false)
    const done = await guard(() => storyService.remove(story.id))
    if (done === undefined) return
    setDeleted((current) => new Set(current).add(story.id))
    show('Story deleted.', 'success')
  }

  return createPortal(
    <div className={styles.root} role="dialog" aria-modal="true" aria-label="Stories">
      {/*
        Desktop only. On a phone the tap zones are the navigation and these
        would be two more things covering the picture.
      */}
      <button className={`${styles.step} ${styles.stepBack}`} onClick={previous} aria-label="Previous story">
        <ChevronLeft size={22} strokeWidth={2.2} />
      </button>

      <div className={styles.stage}>
        <div className={styles.progress}>
          {ring.stories.map((item, index) => (
            <span key={item.id} className={styles.track}>
              <span
                className={[
                  styles.bar,
                  index < storyIndex ? styles.barDone : '',
                  index === storyIndex ? styles.barLive : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={
                  index === storyIndex
                    ? {
                        animationPlayState: paused ? 'paused' : 'running',
                        animationDuration: `${holdSec}s`,
                      }
                    : undefined
                }
                onAnimationEnd={index === storyIndex ? next : undefined}
              />
            </span>
          ))}
        </div>

        <header className={styles.head}>
          <Avatar user={ring.user} size="sm" />
          <div className={styles.who}>
            <p className={styles.name}>{mine ? 'Your story' : firstName(ring.user.name)}</p>
            <p className={styles.when}>{timeAgo(story.createdAt)}</p>
          </div>
          {mine ? (
            <button
              className={styles.headButton}
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete this story"
            >
              <Trash2 size={17} strokeWidth={2.1} />
            </button>
          ) : null}
          <button className={styles.headButton} onClick={onClose} aria-label="Close stories">
            <X size={19} strokeWidth={2.2} />
          </button>
        </header>

        {/*
          Remounted per story, so the entry transition replays rather than the
          picture swapping in place.
        */}
        <div
          key={story.id}
          className={styles.card}
          onPointerDown={startHold}
          onPointerUp={endSwipe}
          onPointerCancel={endHold}
          onPointerLeave={endHold}
        >
          <StoryFrame
            story={story}
            media={story.mediaId ? ring.media.get(story.mediaId) : undefined}
            author={ring.user}
          />

          <button className={`${styles.zone} ${styles.zoneBack}`} onClick={tap(previous)} aria-label="Previous story" />
          <button className={`${styles.zone} ${styles.zoneNext}`} onClick={tap(next)} aria-label="Next story" />
        </div>

        {/*
          Your own audience, and only yours. Nobody else is told who watched —
          see storyService.viewersOf for what is deliberately not shown.
        */}
        {mine ? (
          <div className={styles.audience}>
            <button
              className={styles.seenBy}
              onClick={() => {
                setShowViewers((open) => !open)
                setPaused(true)
              }}
              aria-expanded={showViewers}
              disabled={(viewers?.length ?? 0) === 0}
            >
              <Eye size={15} strokeWidth={2.2} />
              <span className="tnum">{viewers?.length ?? 0}</span>
              {viewers?.length === 1 ? 'view' : 'views'}
            </button>
            {showViewers && viewers && viewers.length > 0 ? (
              <p className={styles.viewerNames}>
                Seen by {viewers.map((viewer) => firstName(viewer.name)).join(', ')}
              </p>
            ) : null}
          </div>
        ) : null}

        {confirmDelete ? (
          <div className={styles.confirm}>
            <p className={styles.confirmText}>Delete this story? This cannot be undone.</p>
            <div className={styles.confirmRow}>
              <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                Keep it
              </Button>
              <Button variant="danger" onClick={remove}>
                Delete
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <button className={`${styles.step} ${styles.stepNext}`} onClick={next} aria-label="Next story">
        <ChevronRight size={22} strokeWidth={2.2} />
      </button>
    </div>,
    document.body,
  )
}
