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
 * Read-only view of another member, as a page.
 *
 * Nothing in the app links here any more: Group, Group Progress and the Home
 * rail all open `MemberSheet` over whatever screen you were on, because
 * leaving the section to read one person's numbers is what made Group feel
 * like a hub of separate apps. The route stays for links people already have,
 * and it renders the same `ProfileView` the sheet does — so the two cannot
 * show different things — with a way back into Group.
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
        <PageHeader title="Not found" parent={{ label: 'Group', to: '/group' }} />
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
        parent={{ label: 'Group', to: '/group' }}
      />
      <ProfileView snapshot={snapshot} variant="member" />
    </div>
  )
}
