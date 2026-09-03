import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useHistoryDismiss } from '@/hooks/useHistoryDismiss'
import { isPlaceholder } from '@/services/mediaService'
import type { MediaAsset, User } from '@/models'
import { timeAgo } from '@/utils/date'
import { firstName } from '@/utils/format'
// The seed's gradient artwork lives with the frame that normally draws it.
import frameStyles from './MediaFrame.module.css'
import styles from './MediaLightbox.module.css'

/** How far a drag has to travel before it counts as "put this away". */
const DISMISS_AT = 110

/** Longer than this and the caption folds behind "See more". */
const FOLD_AT = 140

/** How far in a double-tap goes, and how far a pinch is allowed to. */
const DOUBLE_TAP_SCALE = 2.5
const MAX_SCALE = 4

/**
 * A tap is a press that went nowhere and did not linger. Anything that travels
 * further than this is a drag, and the picture should move rather than the
 * caption blink.
 */
const TAP_SLOP = 10
const TAP_MS = 350

/** How long to wait for a second tap before treating the first as a single. */
const DOUBLE_TAP_MS = 260

/** Fit-to-screen: no zoom, no offset. */
const FIT = { scale: 1, x: 0, y: 0 }

/**
 * One picture or clip, at the size it deserves.
 *
 * The media element sizes itself — `max-width: 100%`, `max-height: 100%`, and
 * nothing else. That is the whole fix for the empty bands: a fixed stage with
 * a contained picture inside it letterboxes twice, once for the stage and once
 * for the picture. Here a portrait photo is tall, a landscape one is wide, and
 * the dark ground is simply whatever is left over rather than a shape the
 * picture was poured into.
 *
 * The caption comes with it. A photo without what was said about it is half
 * the post, and having to close the viewer to read the sentence underneath is
 * the kind of small tax that makes people stop opening pictures at all. Long
 * captions fold, exactly as they do on the card.
 *
 * Three ways out, because a full-screen picture should never trap anybody:
 * the close button, a downward drag, and Back. Escape and a click on the
 * ground work too, which between them cover every habit somebody might arrive
 * with — and Back consumes only this overlay, so the app's own navigation is
 * where it was.
 */
export function MediaLightbox({
  asset,
  onClose,
  caption,
  author,
  when,
}: {
  asset: MediaAsset
  onClose: () => void
  /** What was said about it. Shown under the media, folded when long. */
  caption?: string
  author?: User
  /** ISO timestamp of the post, for the relative time beside the name. */
  when?: string
}) {
  const from = useRef<{ x: number; y: number } | null>(null)
  const [drag, setDrag] = useState(0)
  const [expanded, setExpanded] = useState(false)

  /*
   * How far into the picture we are, and where.
   *
   * One piece of state rather than three, because a zoom and the offset it
   * implies have to land in the same paint — clamping an offset against a
   * scale that has not been applied yet is how a zoomed picture ends up with
   * a sliver of black down one side.
   */
  const [view, setView] = useState(FIT)
  const zoomed = view.scale > 1

  /** Whether the caption and the close button are currently showing. */
  const [chrome, setChrome] = useState(true)

  const holderRef = useRef<HTMLDivElement>(null)
  /** Live pointers, so two fingers can be told from one. */
  const points = useRef(new Map<number, { x: number; y: number }>())
  /** What the gesture looked like when it started. */
  const start = useRef<{
    view: typeof FIT
    distance: number
    anchor: { x: number; y: number }
    at: number
    travelled: number
  } | null>(null)
  const tapTimer = useRef<number | null>(null)

  useEffect(() => () => void (tapTimer.current && window.clearTimeout(tapTimer.current)), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  // Back closes the picture instead of leaving the app.
  useHistoryDismiss(onClose)

  /*
   * Keeps the picture's own edges outside the frame it fills.
   *
   * At rest the media exactly fits, so there is nothing to pan and the offset
   * is pinned to zero. Zoomed in, the slack is however much the picture grew
   * — half of it in each direction, because it scales about its centre. Past
   * that the user would be dragging the photograph off into the black, which
   * is the one thing a pan should never be able to do.
   */
  const contain = (scale: number, x: number, y: number) => {
    const el = holderRef.current
    if (!el) return { scale, x: 0, y: 0 }
    const slackX = Math.max(0, (el.clientWidth * scale - el.clientWidth) / 2)
    const slackY = Math.max(0, (el.clientHeight * scale - el.clientHeight) / 2)
    return {
      scale,
      x: Math.min(slackX, Math.max(-slackX, x)),
      y: Math.min(slackY, Math.max(-slackY, y)),
    }
  }

  /**
   * Zoom about a point on the screen, keeping whatever is under it there.
   *
   * Without this a pinch pulls the picture towards its middle: the thing
   * somebody was actually looking at slides out from under their fingers,
   * which is the difference between inspecting a photo and fighting one.
   */
  const zoomAbout = (next: number, screenX: number, screenY: number, base = view) => {
    const el = holderRef.current
    const scale = Math.min(MAX_SCALE, Math.max(1, next))
    if (!el) return FIT
    if (scale === 1) return FIT
    const box = el.getBoundingClientRect()
    // Where the centre would be with no offset applied.
    const originX = box.left + box.width / 2 - base.x
    const originY = box.top + box.height / 2 - base.y
    const dx = screenX - originX
    const dy = screenY - originY
    const ratio = scale / base.scale
    return contain(scale, dx - ratio * (dx - base.x), dy - ratio * (dy - base.y))
  }

  const toggleChrome = () => setChrome((showing) => !showing)

  /*
   * One tap is the caption, two is a closer look.
   *
   * The single tap waits out the double-tap window before it acts. That costs
   * a quarter of a second on a gesture nobody times, and it buys a double-tap
   * that does not make the caption flash on its way in — which is the sort of
   * thing that reads as a bug even when the end state is right.
   */
  const onTap = (x: number, y: number) => {
    if (tapTimer.current) {
      window.clearTimeout(tapTimer.current)
      tapTimer.current = null
      setView((current) =>
        current.scale > 1 ? FIT : zoomAbout(DOUBLE_TAP_SCALE, x, y, current),
      )
      return
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null
      toggleChrome()
    }, DOUBLE_TAP_MS)
  }

  /*
   * Drag down to dismiss. The picture follows the finger and the ground fades
   * with it, so the gesture is visibly reversible right up until it is let go
   * — which is what makes it feel like putting something down rather than
   * guessing at a threshold.
   *
   * Only while the picture is fitted, though. Once it is zoomed the same
   * one-finger drag means pan: a photo somebody has just magnified to read
   * something in the corner should not fall out of the viewer when they go
   * looking for the corner.
   *
   * A clip is dragged by the frame around it rather than by the video itself:
   * the element's own controls need the pointer more than the gesture does,
   * and a scrub bar that dismisses the viewer is worse than no gesture.
   */
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.target instanceof HTMLVideoElement) return
    /*
     * Only the caption's own controls are exempt.
     *
     * Excluding the whole caption looked right and was wrong: the panel is an
     * overlay across the foot of the picture, and on a short photo in a narrow
     * window it covers the middle — which is exactly where somebody taps to
     * put it away. The tap did nothing there, so the caption could not be
     * dismissed at all. "See more" still needs the press, and nothing else in
     * the panel does.
     */
    if (event.target instanceof Element && event.target.closest('button')) return

    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const live = [...points.current.values()]

    if (live.length === 1) {
      from.current = { x: event.clientX, y: event.clientY }
      start.current = { view, distance: 0, anchor: live[0], at: Date.now(), travelled: 0 }
      return
    }
    if (live.length === 2) {
      // A pinch has begun: the drag-to-dismiss it interrupts is cancelled.
      setDrag(0)
      from.current = null
      start.current = {
        view,
        distance: Math.hypot(live[0].x - live[1].x, live[0].y - live[1].y),
        anchor: { x: (live[0].x + live[1].x) / 2, y: (live[0].y + live[1].y) / 2 },
        at: Date.now(),
        travelled: TAP_SLOP + 1,
      }
    }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (!points.current.has(event.pointerId)) return
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const live = [...points.current.values()]
    const began = start.current
    if (!began) return

    // --- Two fingers: pinch to zoom, about the point between them ----------
    if (live.length >= 2) {
      const distance = Math.hypot(live[0].x - live[1].x, live[0].y - live[1].y)
      if (began.distance > 0) {
        setView(
          zoomAbout(
            (began.view.scale * distance) / began.distance,
            began.anchor.x,
            began.anchor.y,
            began.view,
          ),
        )
      }
      return
    }

    const dx = event.clientX - began.anchor.x
    const dy = event.clientY - began.anchor.y
    began.travelled = Math.max(began.travelled, Math.hypot(dx, dy))

    // --- One finger, zoomed in: pan --------------------------------------
    if (began.view.scale > 1) {
      setView(contain(began.view.scale, began.view.x + dx, began.view.y + dy))
      return
    }

    // --- One finger, fitted: the dismiss gesture --------------------------
    if (!from.current) return
    setDrag(dy > 0 && Math.abs(dy) > Math.abs(dx) ? dy : 0)
  }

  const onPointerUp = (event: React.PointerEvent) => {
    const began = start.current
    points.current.delete(event.pointerId)

    if (drag > DISMISS_AT) {
      onClose()
    } else if (
      began &&
      points.current.size === 0 &&
      began.travelled <= TAP_SLOP &&
      Date.now() - began.at <= TAP_MS
    ) {
      onTap(event.clientX, event.clientY)
    }

    if (points.current.size === 0) {
      from.current = null
      start.current = null
      setDrag(0)
      // A pinch that ended near the bottom stop settles back to a clean fit.
      setView((current) => (current.scale <= 1.01 ? FIT : current))
    }
  }

  const placeholder = isPlaceholder(asset.ref)
  const text = caption?.trim() ?? ''
  const longCaption = text.length > FOLD_AT || text.split('\n').length > 3

  return createPortal(
    <div
      className={styles.root}
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      style={drag > 0 ? { opacity: Math.max(0.35, 1 - drag / 320) } : undefined}
    >
      {/*
        The ground is the close control too — tapping beside the picture is
        how everybody expects to get out of one of these.
      */}
      <button className={styles.scrim} onClick={onClose} aria-label="Close" tabIndex={-1} />

      <button
        className={[styles.close, chrome ? '' : styles.away].filter(Boolean).join(' ')}
        onClick={onClose}
        aria-label="Close"
        aria-hidden={!chrome}
        tabIndex={chrome ? 0 : -1}
      >
        <X size={20} strokeWidth={2.2} />
      </button>

      <div
        className={styles.stage}
        style={drag > 0 ? { transform: `translateY(${drag}px)` } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          ref={holderRef}
          className={[styles.holder, zoomed ? styles.zoomed : ''].filter(Boolean).join(' ')}
          style={
            zoomed
              ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }
              : undefined
          }
        >
          {placeholder ? (
            // Seed art, drawn by CSS. It has no intrinsic size, so it gets one.
            <span
              className={`${styles.art} ${frameStyles[asset.ref.slice('placeholder:'.length)] ?? ''}`}
              aria-hidden="true"
            />
          ) : asset.kind === 'video' ? (
            <video
              src={asset.ref}
              className={styles.media}
              controls
              autoPlay
              playsInline
              preload="metadata"
            />
          ) : (
            <img src={asset.ref} alt="" className={styles.media} decoding="async" />
          )}
        </div>

        {/*
          Under the media rather than over it. A caption laid on top of a photo
          is a caption competing with the photo for the same pixels, and on a
          portrait picture there is nowhere on it that is not the subject.
        */}
        {author || text ? (
          <figcaption
            className={[styles.caption, chrome ? '' : styles.away].filter(Boolean).join(' ')}
            aria-hidden={!chrome}
          >
            {author ? (
              <p className={styles.by}>
                {firstName(author.name)}
                {when ? <span className={styles.when}>{timeAgo(when)}</span> : null}
              </p>
            ) : null}
            {text ? (
              <p
                className={[styles.text, longCaption && !expanded ? styles.folded : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                {text}
              </p>
            ) : null}
            {longCaption ? (
              <button className={styles.more} onClick={() => setExpanded((open) => !open)}>
                {expanded ? 'See less' : 'See more'}
              </button>
            ) : null}
          </figcaption>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
