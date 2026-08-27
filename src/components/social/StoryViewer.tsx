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

/** How far a finger travels before the gesture commits to an axis. */
const LOCK_AT = 12
/** How far a sideways drag has to go to actually change person. */
const SWIPE_MIN = 45
/** How far a vertical drag has to go to put the story away. */
const DISMISS_AT = 110
/**
 * How much of a sideways drag the card actually travels.
 *
 * Resistance, on purpose: changing person is commit-or-snap-back, not a scrub
 * through a filmstrip, and a card that lags the finger says so without a word.
 * Thresholds are compared against the damped distance, so `SWIPE_MIN * DAMP`
 * is still `SWIPE_MIN` pixels of real finger travel.
 */
const DAMP = 0.55
/** Long enough to see the card leave, short enough not to feel like waiting. */
const EXIT_MS = 220
/** The person-to-person cross-slide. Slower, because two cards are moving. */
const SLIDE_MS = 360

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
 *
 * Gestures are split three ways, and the split is the point.
 *
 *   tap      — this person's stories, forward on the right, back on the left
 *   sideways — the next person or the previous one, skipping whatever is left
 *              of this one's day
 *   vertical — put the whole thing away, in either direction
 *
 * Somebody five stories deep in Ahmed's day can leave for Nadia with one swipe
 * rather than tapping past four things they did not want, and can get out of
 * the viewer entirely with a flick in the direction their thumb was already
 * going. Vertical is deliberately not story navigation: on a full-screen
 * viewer, up and down are how people put things down, and taking that gesture
 * for something else is how a viewer starts feeling like a trap.
 *
 * The axis locks once, after `LOCK_AT` pixels, and never changes for the rest
 * of the drag — so a diagonal resolves to exactly one thing rather than
 * flickering between two.
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
  /** Locked after LOCK_AT pixels; a drag is one axis or the other, never both. */
  const axis = useRef<'x' | 'y' | null>(null)
  /** Live finger offset, so the card can follow it. */
  const [drag, setDrag] = useState({ x: 0, y: 0 })
  /**
   * Set while the card is being thrown off the screen. Vertical only —
   * changing person is a two-card move and uses `leaving` instead.
   */
  const [exit, setExit] = useState<'up' | 'down' | null>(null)
  /** Which side the incoming person should slide in from. */
  const [entering, setEntering] = useState<'left' | 'right' | null>(null)
  /**
   * The card on its way out, kept on screen while the next one arrives.
   *
   * Without it the outgoing story unmounts the instant the person changes and
   * the transition is a card leaving into nothing, then a card appearing from
   * nothing. Holding it for the length of the slide is what makes the two
   * halves one movement.
   */
  const [leaving, setLeaving] = useState<{
    ring: StoryRing
    story: StoryRing['stories'][number]
    direction: 'left' | 'right'
  } | null>(null)

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

  /**
   * Jump to another person, rather than walking there.
   *
   * Always lands on their first story: arriving mid-way through somebody's day
   * because of where you happened to be in yours makes no sense to the person
   * doing the swiping.
   */
  const toPerson = useCallback(
    (step: 1 | -1) => {
      const target = ringIndex + step
      if (target < 0 || target >= live.length) return
      setPaused(false)
      setShowViewers(false)
      setRingIndex(target)
      setStoryIndex(0)
    },
    [live.length, ringIndex],
  )

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

  const clearHoldTimer = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
    holdTimer.current = null
  }

  const onPointerDown = (event: React.PointerEvent) => {
    // A drag that starts while the last one is still leaving would fight it.
    if (exit) return
    held.current = false
    axis.current = null
    swipeFrom.current = { x: event.clientX, y: event.clientY }
    setDrag({ x: 0, y: 0 })
    /*
     * Capture the pointer, so a finger that wanders off the card still
     * reports where it went and still reports letting go. Without this a drag
     * that leaves the element simply stops sending events and the card is
     * left stranded halfway through a gesture nobody can finish.
     */
    event.currentTarget.setPointerCapture?.(event.pointerId)
    holdTimer.current = window.setTimeout(() => {
      held.current = true
      setPaused(true)
    }, 220)
  }

  /**
   * The finger, followed.
   *
   * The axis locks once and stays locked, so a drag that starts downward stays
   * a dismissal even if it wanders sideways on the way. Sideways movement is
   * damped: it is a commit-or-snap-back gesture rather than a scrub, and
   * resistance is what says so.
   */
  const onPointerMove = (event: React.PointerEvent) => {
    const from = swipeFrom.current
    if (!from || exit) return

    const dx = event.clientX - from.x
    const dy = event.clientY - from.y

    if (!axis.current) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < LOCK_AT) return
      axis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      // It is a drag, not a hold — but the story still stops advancing while
      // a finger is on it, which is the whole reason the timer pauses here.
      clearHoldTimer()
      held.current = true
      setPaused(true)
    }

    setDrag(axis.current === 'y' ? { x: 0, y: dy } : { x: dx * DAMP, y: 0 })
  }

  /**
   * What the drag turned out to mean.
   *
   * Past the threshold it commits and the card animates out in the direction
   * it was already going; short of it, the card springs back and nothing
   * happens. Either way the timer resumes, and it resumes only after the
   * decision — so a story can never advance underneath a gesture that was
   * about to replace it.
   */
  const onPointerUp = () => {
    const dragged = axis.current
    const { x, y } = drag
    clearHoldTimer()
    swipeFrom.current = null
    axis.current = null

    if (!dragged) {
      // A hold that never moved: let go and carry on.
      if (held.current) setPaused(false)
      return
    }

    if (dragged === 'y' && Math.abs(y) >= DISMISS_AT) {
      leave(y < 0 ? 'up' : 'down')
      return
    }

    if (dragged === 'x' && Math.abs(x) >= SWIPE_MIN * DAMP) {
      const forward = x < 0
      // Nowhere to go: snap back rather than pretending something happened.
      if (!hasPerson(forward ? 1 : -1)) {
        setDrag({ x: 0, y: 0 })
        setPaused(false)
        return
      }
      leave(forward ? 'left' : 'right')
      return
    }

    // Short of the threshold. Back where it started.
    setDrag({ x: 0, y: 0 })
    setPaused(false)
  }

  /** Whether there is a person that way to move to. */
  const hasPerson = (step: 1 | -1) => {
    const target = ringIndex + step
    return target >= 0 && target < live.length
  }

  /**
   * Finishes the movement the gesture started.
   *
   * Vertical is one card leaving: it flies off and the viewer closes behind
   * it, so there is nothing to arrive.
   *
   * Horizontal is two cards moving as one. The person changes immediately —
   * so the new story is already mounted and already loading — while the old
   * card is held on screen a moment longer and pushed out alongside it. Both
   * travel the same distance at the same time, one going and one coming, with
   * a little depth between them so the pair reads as a deck being turned
   * rather than two unrelated slides.
   *
   * The timer stays paused for the whole flight either way. A progress bar
   * finishing mid-animation would advance a story that is already halfway off
   * the screen.
   */
  const leave = (direction: 'up' | 'down' | 'left' | 'right') => {
    setPaused(true)
    setDrag({ x: 0, y: 0 })

    if (direction === 'up' || direction === 'down') {
      setExit(direction)
      window.setTimeout(onClose, EXIT_MS)
      return
    }

    const forward = direction === 'left'
    // Nowhere to go: snap back rather than pretending something happened.
    if (!hasPerson(forward ? 1 : -1)) {
      setPaused(false)
      return
    }

    setLeaving({ ring, story, direction })
    // The new person comes from the side the old one is heading towards.
    setEntering(forward ? 'right' : 'left')
    toPerson(forward ? 1 : -1)
    // `toPerson` resumes the timer; the slide is not over yet.
    setPaused(true)

    window.setTimeout(() => {
      setLeaving(null)
      setEntering(null)
      setPaused(false)
    }, SLIDE_MS)
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

  /*
   * The ground fades as the story is pulled away, so the gesture reads as
   * "putting this down" and stays visibly reversible until it is let go.
   */
  const dragging = drag.x !== 0 || drag.y !== 0
  const pulled = Math.abs(drag.y)
  const dragTransform = `translate3d(${drag.x}px, ${drag.y}px, 0) scale(${
    1 - Math.min(pulled / 1400, 0.1)
  })`

  return createPortal(
    <div
      className={styles.root}
      role="dialog"
      aria-modal="true"
      aria-label="Stories"
      style={pulled > 0 ? { opacity: Math.max(0.4, 1 - pulled / 420) } : undefined}
    >
      {/*
        Desktop only. On a phone the tap zones are the navigation and these
        would be two more things covering the picture.
      */}
      <button
        className={`${styles.step} ${styles.stepBack}`}
        onClick={() => leave('right')}
        aria-label="Previous person"
      >
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
          Two cards can be in flight at once, so they share a deck rather than
          taking turns in the layout. Both are absolutely placed and stacked;
          only the live one takes gestures.
        */}
        <div className={styles.deck}>
          {/*
            The person being left behind, held for the length of the slide so
            the move reads as one gesture instead of two.
          */}
          {leaving ? (
            <div
              key={`leaving-${leaving.story.id}`}
              className={`${styles.card} ${
                leaving.direction === 'left' ? styles.slideOutLeft : styles.slideOutRight
              }`}
              aria-hidden="true"
            >
              <StoryFrame
                story={leaving.story}
                media={leaving.story.mediaId ? leaving.ring.media.get(leaving.story.mediaId) : undefined}
                author={leaving.ring.user}
              />
            </div>
          ) : null}

          {/*
            Remounted per story, so the entry transition replays rather than
            the picture swapping in place. While a finger is down the transform
            is driven inline and the transition is off, so the card tracks the
            finger exactly; on release the class takes over and animates.
          */}
          <div
            key={story.id}
            className={[
              styles.card,
              dragging ? styles.dragging : '',
              exit ? styles[`exit${exit[0].toUpperCase()}${exit.slice(1)}`] : '',
              entering ? styles[`slideIn${entering[0].toUpperCase()}${entering.slice(1)}`] : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={dragging ? { transform: dragTransform } : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <StoryFrame
              story={story}
              media={story.mediaId ? ring.media.get(story.mediaId) : undefined}
              author={ring.user}
            />

            <button className={`${styles.zone} ${styles.zoneBack}`} onClick={tap(previous)} aria-label="Previous story" />
            <button className={`${styles.zone} ${styles.zoneNext}`} onClick={tap(next)} aria-label="Next story" />
          </div>
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

      <button
        className={`${styles.step} ${styles.stepNext}`}
        onClick={() => leave('left')}
        aria-label="Next person"
      >
        <ChevronRight size={22} strokeWidth={2.2} />
      </button>
    </div>,
    document.body,
  )
}
