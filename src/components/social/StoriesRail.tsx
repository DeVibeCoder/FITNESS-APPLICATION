import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { StoryViewer } from './StoryViewer'
import type { StoryRing } from '@/services/storyService'
import { storyService } from '@/services'
import { useAuth } from '@/context/AuthContext'
import { useLogSheet } from '@/context/LogSheetContext'
import { firstName } from '@/utils/format'
import styles from './StoriesRail.module.css'

/**
 * The stories rail.
 *
 * Rings are ordered you-first, then unseen, then seen — the arrangement every
 * story rail uses because it matches what people look for. Expiry is the
 * service's job and happens on read, so a story that has run out simply is not
 * in the list rather than needing to be swept away.
 *
 * Your own place in the rail does two things, and they are two controls rather
 * than one guessing: the avatar opens your story when you have one, and the +
 * always adds another. When you have nothing live the whole thing is Add, and
 * the ring is a dashed outline saying so.
 *
 * The viewer opens on a snapshot of the rings taken at the moment of the tap.
 * Watching rewrites the seen state this query sorts on, and re-sorting the
 * list somebody is halfway through reading would move the story out from under
 * them.
 */
export function StoriesRail() {
  const { user } = useAuth()
  const { open } = useLogSheet()
  const rings = useLiveQuery(() => (user ? storyService.rings(user.id) : undefined), [user?.id])
  const [watching, setWatching] = useState<{ rings: StoryRing[]; index: number } | null>(null)

  if (!user) return null

  const all = rings ?? []
  const mine = all.find((ring) => ring.user.id === user.id)
  const others = all.filter((ring) => ring.user.id !== user.id)

  const watch = (ringUserId: string) => {
    const index = all.findIndex((ring) => ring.user.id === ringUserId)
    if (index >= 0) setWatching({ rings: all, index })
  }

  return (
    <>
      <div className={styles.rail} role="list" aria-label="Stories">
        <div className={styles.item} role="listitem">
          <div className={styles.add}>
            <button
              className={styles.ringButton}
              onClick={() => (mine ? watch(user.id) : open('story'))}
              aria-label={mine ? 'Watch your story' : 'Add to your story'}
            >
              <span
                className={[
                  styles.ring,
                  mine ? (mine.seen ? styles.ringSeen : styles.ringLive) : styles.ringOwn,
                ].join(' ')}
              >
                <Avatar user={user} size="lg" />
              </span>
            </button>
            {/*
              Always an add, even when you already have a story live — that is
              what makes the rail's own entry two controls rather than a guess
              about which one you meant.
            */}
            <button className={styles.plus} onClick={() => open('story')} aria-label="Add to your story">
              <Plus size={13} strokeWidth={3} />
            </button>
          </div>
          <span className={styles.name}>Your story</span>
        </div>

        {others.map((ring) => (
          <div key={ring.user.id} className={styles.item} role="listitem">
            <button
              className={styles.ringButton}
              onClick={() => watch(ring.user.id)}
              aria-label={`${ring.user.name}'s story, ${ring.seen ? 'already watched' : 'not watched yet'}`}
            >
              <span className={[styles.ring, ring.seen ? styles.ringSeen : styles.ringLive].join(' ')}>
                <Avatar user={ring.user} size="lg" />
              </span>
            </button>
            <span className={styles.name}>{firstName(ring.user.name)}</span>
          </div>
        ))}
      </div>

      {watching ? (
        <StoryViewer
          rings={watching.rings}
          startIndex={watching.index}
          onClose={() => setWatching(null)}
        />
      ) : null}
    </>
  )
}
