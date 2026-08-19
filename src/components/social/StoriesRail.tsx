import { useLiveQuery } from 'dexie-react-hooks'
import { Plus } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { storyService } from '@/services'
import { useAuth } from '@/context/AuthContext'
import { useLogSheet } from '@/context/LogSheetContext'
import { firstName } from '@/utils/format'
import styles from './StoriesRail.module.css'

/**
 * The stories rail.
 *
 * Phase 1 builds the rail and the expiry rule; opening a story is Phase 3, so
 * a ring is not yet a button into a viewer that does not exist. Tapping your
 * own opens Create, which is the one thing that already leads somewhere.
 *
 * Rings are ordered you-first, then unseen, then seen — the arrangement every
 * story rail uses because it matches what people look for.
 */
export function StoriesRail() {
  const { user } = useAuth()
  const { open } = useLogSheet()
  const rings = useLiveQuery(() => (user ? storyService.rings(user.id) : undefined), [user?.id])

  if (!user) return null

  const mine = rings?.find((ring) => ring.user.id === user.id)
  const others = (rings ?? []).filter((ring) => ring.user.id !== user.id)

  return (
    <div className={styles.rail} role="list" aria-label="Stories">
      <div className={styles.item} role="listitem">
        <button className={styles.add} onClick={() => open('story')} aria-label="Add to your story">
          <span className={[styles.ring, mine ? styles.ringLive : styles.ringOwn].join(' ')}>
            <Avatar user={user} size="lg" />
          </span>
          <span className={styles.plus} aria-hidden="true">
            <Plus size={13} strokeWidth={3} />
          </span>
        </button>
        <span className={styles.name}>Your story</span>
      </div>

      {others.map((ring) => (
        <div key={ring.user.id} className={styles.item} role="listitem">
          {/*
            Not a button yet: the viewer is Phase 3, and a control that looks
            tappable but does nothing is worse than one that does not.
          */}
          <span className={[styles.ring, ring.seen ? styles.ringSeen : styles.ringLive].join(' ')}>
            <Avatar user={ring.user} size="lg" />
          </span>
          <span className={styles.name}>{firstName(ring.user.name)}</span>
        </div>
      ))}
    </div>
  )
}
