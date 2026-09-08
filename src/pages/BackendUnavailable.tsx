import { Button } from '@/components/ui/Button'
import styles from './BootError.module.css'

/**
 * Shown when `/api/auth` cannot authenticate anybody — no database bound, no
 * `AUTH_SECRET`, or no Functions deployed at all.
 *
 * This screen exists because of what used to happen instead. The application
 * fell back to a local sign-in when the server did not answer, which meant a
 * misconfigured deployment did not look misconfigured: it looked like an app
 * you could log into, with an identity no server had agreed to and data no
 * server would ever hold.
 *
 * A deployment that cannot authenticate now admits nobody. That is a worse
 * afternoon for whoever broke the binding and a far better one for everybody
 * else.
 */
export function BackendUnavailable() {
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <h1 className={styles.title}>Sign-in is unavailable</h1>
        <p className={styles.body}>
          RALLY cannot reach the service that verifies accounts, so it cannot let anybody in.
          This is a problem with the deployment rather than with your account — nothing of
          yours has been lost.
        </p>
        <Button size="lg" block onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    </div>
  )
}
