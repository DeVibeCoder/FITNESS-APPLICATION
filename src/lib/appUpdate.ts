/**
 * Noticing that a new version of the app has taken over, and acting on it.
 *
 * The service worker is configured to install and activate immediately
 * (`skipWaiting` and `clientsClaim`), so a deployment reaches a device without
 * anybody being asked. What that does not do on its own is fix the page that
 * is already open: it was built from the previous bundle, its lazily-imported
 * route chunks are the previous build's, and it will go on running until
 * something reloads it. If those chunks have since aged out of the host, the
 * next route the person opens simply never appears — a blank screen, on a tab
 * that looked fine a moment ago.
 *
 * So when control passes to a new worker, the page reloads once. The reload is
 * cheap: it is a navigation, the new worker answers it from the network, and
 * every screen rebuilds from D1 as it always does on a fresh load. Nothing of
 * the person's is held in the page.
 *
 * Two guards, because a reload loop is worse than the bug it would be fixing:
 *
 * `controller` is read before anything is registered. A page that starts with
 * no controller and then gets one has not been updated — it has just been
 * claimed for the first time, which is what happens on a first visit. Only a
 * page that already had a controller and then got a different one has actually
 * been overtaken.
 *
 * And a timestamp in `sessionStorage`, so that if some future arrangement ever
 * does manage to fire this repeatedly, it reloads once and then stops rather
 * than spinning.
 */

/** Long enough that a genuine second update is possible; short enough to notice. */
const RELOAD_GUARD_MS = 30_000
const GUARD_KEY = 'rally.lastUpdateReload'

/** How often an open tab asks whether it has been superseded. */
const UPDATE_CHECK_MS = 15 * 60 * 1000

function reloadedRecently(): boolean {
  try {
    const last = Number(sessionStorage.getItem(GUARD_KEY) ?? '0')
    return Number.isFinite(last) && Date.now() - last < RELOAD_GUARD_MS
  } catch {
    // Storage can be unavailable. Erring towards "yes" would disable the whole
    // mechanism; erring towards "no" risks at most one extra reload.
    return false
  }
}

function rememberReload(): void {
  try {
    sessionStorage.setItem(GUARD_KEY, String(Date.now()))
  } catch {
    /* Nothing to do; the `reloading` flag below still holds within this page. */
  }
}

export function watchForUpdates(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  /*
   * Read now, before any registration has had a chance to claim this page.
   * This is what tells a first visit apart from being overtaken.
   */
  const hadController = Boolean(navigator.serviceWorker.controller)
  let reloading = false

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading || reloadedRecently()) return
    reloading = true
    rememberReload()
    window.location.reload()
  })

  /*
   * Ask whether there is a newer worker. The browser checks on its own when a
   * navigation happens, which for a single-page application can be never — a
   * tab left open for a week routes entirely in the client and issues no
   * navigations at all.
   */
  const check = () => {
    navigator.serviceWorker
      .getRegistration()
      .then((registration) => registration?.update())
      .catch(() => {
        // Offline, or no registration. The next check will do.
      })
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
  window.addEventListener('focus', check)
  window.setInterval(check, UPDATE_CHECK_MS)
}
