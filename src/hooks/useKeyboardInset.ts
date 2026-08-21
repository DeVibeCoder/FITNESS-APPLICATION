import { useEffect, useState } from 'react'

/**
 * Whether the software keyboard is up, and how much of the viewport it covers.
 *
 * Two signals, because browsers handle the keyboard in two different ways and
 * neither one alone is enough:
 *
 *   `inset`  — what `visualViewport` says is unreachable. Safari and older
 *              Android WebViews leave the layout viewport at full height and
 *              simply cover the bottom of it, so this is the keyboard's height
 *              and the composer has to lift by exactly that much.
 *
 *   `open`   — whether the layout viewport itself shrank. Chrome with
 *              `interactive-widget=resizes-content` reflows the page for us, so
 *              `inset` is 0 and nothing needs lifting — but the bottom bar is
 *              still sitting there above the keyboard, which is the thing that
 *              looked broken. Comparing against the tallest height seen at this
 *              width catches it.
 *
 * Deliberately not driven by focus. Focus-driven layout meant any blur — tapping
 * Send, tapping a delete icon — moved the page between mousedown and mouseup, so
 * the press landed on nothing. A keyboard that is genuinely open is the only
 * thing that should reflow the screen; on a desktop nothing reflows at all.
 */

/** Below this, a shrunken viewport is a browser chrome change, not a keyboard. */
const MIN_KEYBOARD = 120

export interface KeyboardState {
  /** Pixels of the layout viewport the keyboard covers. 0 when it reflows. */
  inset: number
  open: boolean
}

export function useKeyboardInset(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({ inset: 0, open: false })

  useEffect(() => {
    // The tallest the layout viewport has been at the current width. Rotating
    // or resizing changes the width, which resets the baseline — otherwise a
    // landscape height would make portrait look permanently "keyboarded".
    let tallest = window.innerHeight
    let atWidth = window.innerWidth

    const measure = () => {
      if (window.innerWidth !== atWidth) {
        atWidth = window.innerWidth
        tallest = window.innerHeight
      }
      tallest = Math.max(tallest, window.innerHeight)

      const vv = window.visualViewport
      const covered = vv ? window.innerHeight - (vv.height + vv.offsetTop) : 0
      const inset = covered > MIN_KEYBOARD ? Math.round(covered) : 0
      const shrank = tallest - window.innerHeight > MIN_KEYBOARD

      setState((current) =>
        current.inset === inset && current.open === (inset > 0 || shrank)
          ? current
          : { inset, open: inset > 0 || shrank },
      )
    }

    measure()
    window.visualViewport?.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    return () => {
      window.visualViewport?.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [])

  return state
}
