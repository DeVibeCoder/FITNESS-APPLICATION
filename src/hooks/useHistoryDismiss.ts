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

/**
 * The pop events already accounted for.
 *
 * `popstate` is one event delivered to every mounted listener, and the count
 * above was being spent by whichever listener happened to run first: with a
 * sheet, a sub-screen and a camera all open, the sheet's listener swallowed
 * the camera's own pop and the sub-screen's listener — next in line, and by
 * then top of the stack — read the same pop as a Back and closed itself. One
 * photograph taken inside the workout import therefore landed two screens
 * further out than it left, with the picture gone.
 *
 * Marking the event rather than only counting it makes every listener agree
 * about a single pop: the first one spends the credit, the rest see that it
 * has been spent and leave the event alone.
 */
const accountedFor = new WeakSet<Event>()

/**
 * The one listener that owns the credit above.
 *
 * The counter used to be spent by whichever overlay listener happened to hear
 * the pop — and if the overlay that caused it was the last one open, there was
 * no listener left to hear anything. The credit then sat there unspent, and
 * the *next* real Back was swallowed as "ours": open a sheet, close it, open a
 * photo, press Back, and the photo stayed on screen.
 *
 * So the accounting belongs to the module, not to whoever happens to be
 * mounted. This listener is attached once, before any overlay's, and is
 * therefore always the first to see a pop: it spends the credit, marks the
 * event, and every overlay listener after it agrees about what that pop was.
 */
let bookkeeping = false

function keepBooks(): void {
  if (bookkeeping || typeof window === 'undefined') return
  bookkeeping = true
  window.addEventListener('popstate', (event) => {
    if (selfPops > 0) {
      selfPops--
      accountedFor.add(event)
    }
  })
}

export function useHistoryDismiss(onDismiss: () => void): void {
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss

  useEffect(() => {
    if (typeof window === 'undefined') return
    keepBooks()

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

    const onPopState = (event: PopStateEvent) => {
      // The bookkeeper above has already decided whether this pop was ours.
      if (accountedFor.has(event)) return
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
      // already gone. The counter tells the bookkeeper that the pop this
      // causes is ours and not a gesture, and the bookkeeper is still
      // listening even when this was the last overlay open.
      if (pushed) {
        selfPops++
        window.history.back()
      }
    }
  }, [])
}
