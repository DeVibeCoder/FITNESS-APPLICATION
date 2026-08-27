import { useEffect, useRef } from 'react'

/**
 * Makes the phone's Back gesture close an overlay instead of leaving the app.
 *
 * A full-screen overlay is invisible to the browser's idea of "where am I".
 * Nothing was navigated to, so Back does the only thing it can — go to the
 * previous page, which for someone who opened the app on Home means leaving
 * it entirely. That is the bug this fixes.
 *
 * Opening pushes one history entry. Back pops it, `popstate` fires, and the
 * overlay closes having consumed exactly the gesture that would otherwise have
 * left. Closing any other way — the X, Escape, running out of stories — pops
 * that entry back off itself, so the history stack ends up exactly as deep as
 * it started and a second Back does not have to be pressed twice.
 *
 * `onDismiss` is read through a ref so a caller passing a fresh closure every
 * render does not tear the entry down and push a new one on each pass.
 */
export function useHistoryDismiss(onDismiss: () => void): void {
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss

  useEffect(() => {
    if (typeof window === 'undefined') return

    const token = { overlay: true, at: Date.now() }
    window.history.pushState(token, '')
    // Set once the entry is ours: it tells the cleanup whether the entry is
    // still on the stack, or whether Back already took it off.
    let ours = true

    const onPopState = () => {
      ours = false
      dismiss.current()
    }

    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      // Closed by something other than Back, so the entry is still there and
      // has to come off — otherwise Back would first undo an overlay that is
      // already gone.
      if (ours) window.history.back()
    }
  }, [])
}
