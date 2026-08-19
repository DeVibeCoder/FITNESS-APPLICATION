import { Button } from '@/components/ui/Button'
import styles from './BootError.module.css'

/** Shown when local storage is unavailable — private mode, or a wiped profile. */
export function BootError() {
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <h1 className={styles.title}>We couldn't open your data</h1>
        <p className={styles.body}>
          Circuit keeps everything on this device. If you are browsing privately, or storage is
          blocked, it has nowhere to save.
        </p>
        <Button size="lg" block onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    </div>
  )
}
