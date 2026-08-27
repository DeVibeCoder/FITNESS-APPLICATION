import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { MediaFrame } from './MediaFrame'
import { useHistoryDismiss } from '@/hooks/useHistoryDismiss'
import type { MediaAsset } from '@/models'
import styles from './MediaLightbox.module.css'

/**
 * One picture or clip, at the size it deserves.
 *
 * The feed clamps shapes so a column of posts stays scannable; this is where
 * that compromise is paid back. Nothing is cropped here — the whole frame is
 * shown, contained, on a dark ground, at whatever proportions it actually has.
 *
 * Full-bleed on a phone and a centred stage with room around it on a desktop,
 * from the same markup. Back closes it rather than leaving the app, the same
 * way the story viewer handles it, because a full-screen overlay the browser
 * cannot see is a Back button that does the wrong thing.
 *
 * Video gets real controls here and only here. In the feed it is a still.
 */
export function MediaLightbox({ asset, onClose }: { asset: MediaAsset; onClose: () => void }) {
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

  return createPortal(
    <div className={styles.root} role="dialog" aria-modal="true" aria-label="Media viewer">
      {/*
        The ground is the close control too — tapping beside the picture is
        how everybody expects to get out of one of these.
      */}
      <button className={styles.scrim} onClick={onClose} aria-label="Close" tabIndex={-1} />

      <button className={styles.close} onClick={onClose} aria-label="Close">
        <X size={20} strokeWidth={2.2} />
      </button>

      <div className={styles.stage}>
        <MediaFrame asset={asset} rounded={false} fill contain controls={asset.kind === 'video'} />
      </div>
    </div>,
    document.body,
  )
}
