import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Play } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { motivationService } from '@/services'
import styles from './HomeMotivation.module.css'

/**
 * A line and a link — not a player. Home should never load a third-party
 * embed, and nothing here plays until the user chooses to open it.
 */
export function HomeMotivation({ userId }: { userId: string }) {
  const video = useLiveQuery(() => motivationService.active(), [])
  const quote = motivationService.quoteOfTheDay(userId)

  return (
    <Card flush className={styles.card}>
      <div className={styles.body}>
        <p className={styles.quote}>“{video?.quote ?? quote}”</p>
        {video ? <p className={styles.title}>{video.title}</p> : null}
      </div>
      {video ? (
        <Link to="/motivation" className={styles.watch}>
          <span className={styles.play}>
            <Play size={13} strokeWidth={2.6} fill="currentColor" />
          </span>
          Watch
        </Link>
      ) : (
        <Link to="/motivation" className={styles.watch}>
          Add a video
        </Link>
      )}
    </Card>
  )
}
