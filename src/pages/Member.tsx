import { useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, LoadingScreen } from '@/components/ui/EmptyState'
import { ProfileView } from '@/components/profile/ProfileView'
import { progressService } from '@/services'
import { todayKey } from '@/utils/date'
import { firstName } from '@/utils/format'
import styles from './Profile.module.css'

/**
 * Read-only view of another member. Everyone can see everyone's progress; only
 * the owner gets the edit controls, which simply are not rendered here.
 */
export function Member() {
  const { userId } = useParams<{ userId: string }>()
  const snapshot = useLiveQuery(
    () => (userId ? progressService.userSnapshot(userId, todayKey()) : undefined),
    [userId],
  )

  if (snapshot === undefined) return <LoadingScreen />
  if (snapshot === null) {
    return (
      <div className={styles.page}>
        <PageHeader title="Not found" backTo="/progress" />
        <EmptyState
          title="No such member"
          body="That profile is not in the group. It may have been removed."
        />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={firstName(snapshot.user.name)}
        subtitle={`@${snapshot.user.handle}`}
        backTo="/progress"
      />
      <ProfileView snapshot={snapshot} variant="member" />
    </div>
  )
}
