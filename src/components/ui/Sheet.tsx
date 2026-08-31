import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useHistoryDismiss } from '@/hooks/useHistoryDismiss'
import styles from './Sheet.module.css'

interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  /** Hidden supporting text for screen readers, or visible if `showSubtitle`. */
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}

/**
 * Bottom sheet on phones, centred dialog on desktop. Everything that collects
 * input uses this so there is exactly one modal pattern in the app.
 */
export function Sheet({ open, ...rest }: SheetProps) {
  /*
   * The open sheet is a component of its own, and that split is deliberate.
   *
   * Callers render `Sheet` whether or not it is open, but the open body runs
   * hooks that must only exist while it is on screen — `useHistoryDismiss`
   * pushes a history entry, and one pushed for a closed sheet would swallow a
   * Back press that belonged to the page. Mounting and unmounting a child is
   * how a hook gets a lifetime, rather than an early return that the rules of
   * hooks would not allow anyway.
   */
  return open ? <OpenSheet {...rest} /> : null
}

function OpenSheet({ onClose, title, subtitle, children, footer }: Omit<SheetProps, 'open'>) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  /*
   * The phone's Back gesture closes the sheet rather than leaving the screen
   * underneath it.
   *
   * Without this, backing out of a sheet navigated the app while the sheet
   * stayed mounted on top — a stale overlay over a page you did not choose,
   * which is exactly what happened when backing out of Log today's workout.
   * Nested sheets each push their own entry, so Back unwinds them one at a
   * time, innermost first.
   */
  useHistoryDismiss(onClose)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    const previouslyFocused = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    /*
     * Move focus into the sheet, but onto the panel rather than onto whatever
     * control happens to be first.
     *
     * Focusing the first control meant opening Create put a focus ring on
     * "Post", which reads as *already chosen* — people opened the sheet
     * believing they had picked something. The panel is focusable for exactly
     * this: a screen reader lands on the dialog and its title, a keyboard user
     * tabs on from there, and no option is highlighted before it is picked.
     */
    const timer = window.setTimeout(() => panelRef.current?.focus(), 60)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      window.clearTimeout(timer)
      // Send focus back where it came from, so closing does not dump the user
      // at the top of the page.
      previouslyFocused?.focus?.()
    }
  }, [onClose])

  return createPortal(
    <div className={styles.root}>
      <button className={styles.scrim} onClick={onClose} aria-label="Close" tabIndex={-1} />
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        /* Focusable so the sheet itself can take focus; never in the tab ring. */
        tabIndex={-1}
      >
        <div className={styles.grabber} aria-hidden="true" />
        <header className={styles.head}>
          <div>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={2.2} />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  )
}
