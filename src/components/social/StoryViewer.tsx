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
/** How far a vertical drag has to go to put the story away. */
const DISMISS_AT = 110
/** How much of a turn has to be completed for it to finish on its own. */
const TURN_AT = 0.28
/** Long enough to see the card leave, short enough not to feel like waiting. */
const EXIT_MS = 220
/** The cube's settle. Must match `--turn` in the stylesheet. */
const TURN_MS = 380

/**
 * A turn of the cube, in progress.
 *
 * `progress` runs 0 → 1 and is driven by the finger while one is down, then by
 * a transition once it is lifted. `settling` is what switches between those
 * two: with a finger down there is no transition at all, so the cube tracks
 * the hand exactly instead of lagging a frame behind it.
 */
interface Turn {
  dir: 1 | -1
  progress: number
  settling: boolean
}

/**
 * The story viewer.
 *
 * Full screen on a phone, a centred stage with room around it on a desktop —
 * the same component either way, because it is one interaction at two widths.
 * The desktop version deliberately does not stretch: a story is a portrait
 * thing, and a 1400px-wide one is not a story, it is a banner.
 *
 * Timing lives in CSS. The active progress bar runs an animation and its
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
 * rather than leaving the app. See `useHistoryDismiss`.
 *
 * Gestures are split three ways, and the split is the point.
 *
 *   tap      — this person's stories, forward on the right, back on the left
 *   sideways — the next person or the previous one, skipping whatever is left
 *              of this one's day
 *   vertical — put the whole thing away, in either direction
 *
 * The axis locks once, after `LOCK_AT` pixels, and never changes for the rest
 * of the drag — so a diagonal resolves to exactly one thing rather than
 * flickering between two.
 *
 * --- The cube --------------------------------------------------------------
 *
 * Changing person turns a cube, and it is a real one rather than a slide
 * dressed up as depth. Two faces are on screen, hinged on the edge they share:
 * the outgoing face pivots about its trailing edge and the incoming face about
 * its leading one, and those two edges are the same moving line. That single
 * shared seam is the whole difference between a cube and two panels crossing —
 * one is an object being rotated, the other is two pictures passing each other.
 *
 * The turn follows the finger. Drag halfway and the cube sits open at
 * forty-five degrees, showing both faces at once; let go short of the
 * threshold and it rotates back. Nothing about it is a fixed animation that
 * plays after the gesture is over, which is what makes it feel attached to the
 * hand rather than triggered by it.
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
  /** The deck's width, read once per gesture — the cube turns in that span. */
  const deckRef = useRef<HTMLDivElement>(null)
  const spanRef = useRef(1)

  /** Vertical only. Sideways lives in `turn`, because it moves two faces. */
  const [drag, setDrag] = useState(0)
  /** Set while the card is being thrown off the screen. Vertical only. */
  const [exit, setExit] = useState<'up' | 'down' | null>(null)
  const [turn, setTurn] = useState<Turn | null>(null)

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

  /** Whether there is a person that way to turn to. */
  const hasPerson = (step: 1 | -1) => {
    const target = ringIndex + step
    return target >= 0 && target < live.length
  }

  const clearHoldTimer = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
    holdTimer.current = null
  }

  /**
   * Finishes a turn, or abandons it.
   *
   * Either way the cube animates from wherever the finger left it, so a
   * released gesture continues rather than restarting. The person only changes
   * once the faces have actually arrived — swapping earlier would show the new
   * story flat while the old one was still rotating over it.
   */
  const settle = (dir: 1 | -1, commit: boolean) => {
    setPaused(true)
    setTurn({ dir, progress: commit ? 1 : 0, settling: true })
    window.setTimeout(() => {
      if (commit) {
        setRingIndex(ringIndex + dir)
        setStoryIndex(0)
        setShowViewers(false)
      }
      setTurn(null)
      setPaused(false)
    }, TURN_MS)
  }

  const onPointerDown = (event: React.PointerEvent) => {
    // A drag that starts mid-flight would fight whatever is already moving.
    if (exit || turn?.settling) return
    held.current = false
    axis.current = null
    swipeFrom.current = { x: event.clientX, y: event.clientY }
    spanRef.current = deckRef.current?.offsetWidth || window.innerWidth || 1
    setDrag(0)
    /*
     * Capture the pointer, so a finger that wanders off the card still
     * reports where it went and still reports letting go. Without this a drag
     * that leaves the element simply stops sending events and the cube is
     * left stranded halfway through a turn nobody can finish.
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
   * a dismissal even if it wanders sideways on the way. Sideways drives the
   * cube directly: the fraction of the deck's width the finger has covered is
   * the fraction of the quarter-turn the cube has made.
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

    if (axis.current === 'y') {
      setDrag(dy)
      return
    }

    const dir: 1 | -1 = dx < 0 ? 1 : -1
    if (!hasPerson(dir)) {
      // Nothing that way. Resist rather than turning to an empty face.
      setTurn({ dir, progress: Math.min(Math.abs(dx) / spanRef.current, 1) * 0.12, settling: false })
      return
    }
    setTurn({ dir, progress: Math.min(Math.abs(dx) / spanRef.current, 1), settling: false })
  }

  /**
   * What the gesture turned out to mean.
   *
   * The timer resumes only after the decision, so a story can never advance
   * underneath a gesture that was about to replace it.
   */
  const onPointerUp = () => {
    const dragged = axis.current
    clearHoldTimer()
    swipeFrom.current = null
    axis.current = null

    if (!dragged) {
      // A hold that never moved: let go and carry on.
      if (held.current) setPaused(false)
      return
    }

    if (dragged === 'y') {
      if (Math.abs(drag) >= DISMISS_AT) {
        setPaused(true)
        setDrag(0)
        setExit(drag < 0 ? 'up' : 'down')
        window.setTimeout(onClose, EXIT_MS)
        return
      }
      setDrag(0)
      setPaused(false)
      return
    }

    if (!turn) {
      setPaused(false)
      return
    }
    settle(turn.dir, hasPerson(turn.dir) && turn.progress >= TURN_AT)
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
   * The two faces of the cube.
   *
   * Both hinge on the edge they share, which is the whole trick: the outgoing
   * face pivots about its trailing edge, the incoming one about its leading
   * edge, and those are the same line. Everything else — how far each has
   * turned, how far it has travelled, how dark it has gone — follows from one
   * number.
   */
  const faceTransform = (progress: number, dir: 1 | -1, incoming: boolean) => {
    const p = incoming ? 1 - progress : progress
    const away = incoming ? -dir : dir
    return `translateX(${-100 * p * away}%) rotateY(${-90 * p * away}deg)`
  }

  const faceOrigin = (dir: 1 | -1, incoming: boolean) =>
    (dir === 1) === !incoming ? '100% 50%' : '0% 50%'

  const dragging = drag !== 0 || Boolean(turn && !turn.settling)
  const pulled = Math.abs(drag)
  const neighbour = turn ? live[ringIndex + turn.dir] : undefined
  const neighbourStory = neighbour?.stories[0]

  const currentStyle: React.CSSProperties = turn
    ? {
        transform: faceTransform(turn.progress, turn.dir, false),
        transformOrigin: faceOrigin(turn.dir, false),
      }
    : pulled > 0
      ? { transform: `translate3d(0, ${drag}px, 0) scale(${1 - Math.min(pulled / 1400, 0.1)})` }
      : {}

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
        onClick={() => hasPerson(-1) && settle(-1, true)}
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
          The cube. Two faces share this box and hinge on the edge between
          them; only the live one takes gestures.
        */}
        <div className={styles.deck} ref={deckRef}>
          {/* The face coming round. Present only while the cube is turning. */}
          {turn && neighbour && neighbourStory ? (
            <div
              key={`turning-${neighbourStory.id}`}
              className={[styles.card, turn.settling ? '' : styles.dragging].filter(Boolean).join(' ')}
              style={{
                transform: faceTransform(turn.progress, turn.dir, true),
                transformOrigin: faceOrigin(turn.dir, true),
              }}
              aria-hidden="true"
            >
              <StoryFrame
                story={neighbourStory}
                media={
                  neighbourStory.mediaId ? neighbour.media.get(neighbourStory.mediaId) : undefined
                }
                author={neighbour.user}
              />
              {/*
                A face turned away from the light is darker. The shading is
                what stops the two reading as equally present — the eye follows
                the one getting brighter.
              */}
              <span
                className={styles.shade}
                style={{ opacity: 0.75 * (1 - turn.progress) }}
                aria-hidden="true"
              />
            </div>
          ) : null}

          {/*
            Remounted per story, so the entry transition replays rather than
            the picture swapping in place. While a finger is down the transform
            is driven inline and the transition is off, so the face tracks the
            finger exactly; on release the transition takes over from wherever
            it was left.
          */}
          <div
            key={story.id}
            className={[
              styles.card,
              dragging ? styles.dragging : '',
              exit ? styles[`exit${exit[0].toUpperCase()}${exit.slice(1)}`] : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={currentStyle}
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

            {turn ? (
              <span
                className={styles.shade}
                style={{ opacity: 0.75 * turn.progress }}
                aria-hidden="true"
              />
            ) : null}
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
        onClick={() => hasPerson(1) && settle(1, true)}
        aria-label="Next person"
      >
        <ChevronRight size={22} strokeWidth={2.2} />
      </button>
    </div>,
    document.body,
  )
}
