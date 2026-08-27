import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useHistoryDismiss } from '@/hooks/useHistoryDismiss'
import { isPlaceholder } from '@/services/mediaService'
import type { MediaAsset } from '@/models'
// The seed's gradient artwork lives with the frame that normally draws it.
import frameStyles from './MediaFrame.module.css'
import styles from './MediaLightbox.module.css'

/** How far a drag has to travel before it counts as "put this away". */
const DISMISS_AT = 110

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
 * Three ways out, because a full-screen picture should never trap anybody:
 * the close button, a downward drag, and Back. Escape and a click on the
 * ground work too, which between them cover every habit somebody might arrive
 * with.
 */
export function MediaLightbox({ asset, onClose }: { asset: MediaAsset; onClose: () => void }) {
  const from = useRef<{ x: number; y: number } | null>(null)
  const [drag, setDrag] = useState(0)

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
   * Drag down to dismiss. The picture follows the finger and the ground fades
   * with it, so the gesture is visibly reversible right up until it is let go
   * — which is what makes it feel like putting something down rather than
   * guessing at a threshold.
   */
  const onPointerDown = (event: React.PointerEvent) => {
    // A video's own controls need the pointer more than the gesture does.
    if (asset.kind === 'video') return
    from.current = { x: event.clientX, y: event.clientY }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (!from.current) return
    const dy = event.clientY - from.current.y
    const dx = event.clientX - from.current.x
    // Downward and mostly vertical, or it is not this gesture.
    setDrag(dy > 0 && Math.abs(dy) > Math.abs(dx) ? dy : 0)
  }

  const onPointerUp = () => {
    if (drag > DISMISS_AT) onClose()
    from.current = null
    setDrag(0)
  }

  const placeholder = isPlaceholder(asset.ref)

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

      <button className={styles.close} onClick={onClose} aria-label="Close">
        <X size={20} strokeWidth={2.2} />
      </button>

      <div
        className={styles.holder}
        style={drag > 0 ? { transform: `translateY(${drag}px)` } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
    </div>,
    document.body,
  )
}
