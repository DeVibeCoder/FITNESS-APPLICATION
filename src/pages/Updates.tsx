import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Section } from '@/components/ui/Card'
import { EmptyState, LoadingScreen } from '@/components/ui/EmptyState'
import { UpdateFeed } from '@/components/group/UpdateFeed'
import { updateService, userService } from '@/services'
import type { UpdateWithReactions } from '@/services/updateService'
import { addDays, startOfWeek, toDateKey, todayKey } from '@/utils/date'
import { EMPTY } from '@/data/messages'
import styles from './Updates.module.css'

/** Natural date buckets — nobody scans a feed by timestamp. */
function bucketFor(iso: string, today: string): string {
  const date = toDateKey(new Date(iso))
  if (date === today) return 'Today'
  if (date === addDays(today, -1)) return 'Yesterday'
  if (date >= startOfWeek(today)) return 'Earlier this week'
  if (date >= addDays(startOfWeek(today), -7)) return 'Last week'
  return 'Older'
}

const ORDER = ['Today', 'Yesterday', 'Earlier this week', 'Last week', 'Older']

export function Updates() {
  const today = todayKey()
  const updates = useLiveQuery(() => updateService.all(200), [])
  const users = useLiveQuery(() => userService.listMembers(), [])

  const memberIds = useMemo(() => new Set((users ?? []).map((u) => u.id)), [users])

  const grouped = useMemo(() => {
    const buckets = new Map<string, UpdateWithReactions[]>()
    for (const update of updates ?? []) {
      // The feed is the group's, so it carries the group's activity. Anything
      // written by an account that is not a member is skipped here rather than
      // silently dropped by the row renderer, which would leave a day heading
      // standing over nothing.
      if (!memberIds.has(update.userId)) continue
      const bucket = bucketFor(update.createdAt, today)
      buckets.set(bucket, [...(buckets.get(bucket) ?? []), update])
    }
    return ORDER.filter((label) => buckets.has(label)).map((label) => ({
      label,
      updates: buckets.get(label)!,
    }))
  }, [updates, today, memberIds])

  if (updates === undefined || users === undefined) return <LoadingScreen />

  const userMap = new Map((users ?? []).map((u) => [u.id, u]))

  return (
    <div className={styles.page}>
      {/* A Group tab, not a page of its own — the shell above still holds. */}
      <div className={styles.intro}>
        <h2 className={styles.heading}>Updates</h2>
        <p className={styles.sub}>What the group has been doing</p>
      </div>

      {grouped.length === 0 ? (
        <EmptyState title={EMPTY.noUpdates.title} body={EMPTY.noUpdates.body} />
      ) : (
        grouped.map((group) => (
          <Section key={group.label} title={group.label}>
            <UpdateFeed updates={group.updates} users={userMap} />
          </Section>
        ))
      )}
    </div>
  )
}
