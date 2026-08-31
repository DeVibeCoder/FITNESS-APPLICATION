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

/**
 * Every overlay currently holding a history entry, outermost first.
 *
 * `popstate` is a window event: every mounted listener hears every pop. With
 * a sheet open and a camera open inside it, one Back closed both — and one
 * step deeper, a sub-screen's Back closed the sub-screen *and* the sheet
 * around it. Only the innermost overlay may answer a given Back, and this
 * stack is what says which one that is.
 */
const stack: symbol[] = []

/**
 * How many pops this module caused itself.
 *
 * When an overlay closes on its own — a camera that has just taken a photo —
 * its cleanup pops the entry it pushed. That pop fires `popstate` too, and
 * without this the overlay underneath would treat it as a Back gesture and
 * close as well. A counter rather than a flag, because two overlays can
 * unmount in the same tick.
 */
let selfPops = 0

export function useHistoryDismiss(onDismiss: () => void): void {
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss

  useEffect(() => {
    if (typeof window === 'undefined') return

    const token = Symbol('overlay')
    /*
     * Pushed on the next frame rather than immediately.
     *
     * React's development mode runs an effect, tears it down and runs it again
     * to surface exactly this kind of bug — and it did. Pushing on the first
     * run meant the teardown called `history.back()`, whose `popstate` then
     * arrived at the second run's listener and dismissed the overlay in the
     * frame it opened: a lightbox that closed itself the moment it was tapped,
     * in `npm run dev` only. Deferring by a frame means the discarded first
     * run never pushes anything, so it has nothing to undo.
     *
     * Nothing about the behaviour changes in a build: the entry lands one
     * frame later, which is far quicker than anybody can press Back.
     */
    let pushed = false
    let cancelled = false
    const frame = requestAnimationFrame(() => {
      if (cancelled) return
      window.history.pushState({ overlay: true }, '')
      stack.push(token)
      pushed = true
    })

    const onPopState = () => {
      // A pop this module asked for, not one the user made. Swallow it.
      if (selfPops > 0) {
        selfPops--
        return
      }
      // Somebody is above us; the Back belongs to them.
      if (stack[stack.length - 1] !== token) return
      stack.pop()
      // Back took the entry off; there is nothing left for the cleanup to pop.
      pushed = false
      dismiss.current()
    }

    window.addEventListener('popstate', onPopState)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      window.removeEventListener('popstate', onPopState)
      const at = stack.lastIndexOf(token)
      if (at !== -1) stack.splice(at, 1)
      // Closed by something other than Back, so the entry is still there and
      // has to come off — otherwise Back would first undo an overlay that is
      // already gone. The counter tells the remaining listeners that the pop
      // this causes is ours and not a gesture.
      if (pushed) {
        selfPops++
        window.history.back()
      }
    }
  }, [])
}
