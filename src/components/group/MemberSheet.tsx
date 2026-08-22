import { useLiveQuery } from 'dexie-react-hooks'
import { Sheet } from '@/components/ui/Sheet'
import { EmptyState, LoadingScreen } from '@/components/ui/EmptyState'
import { ProfileView } from '@/components/profile/ProfileView'
import { progressService } from '@/services'
import { todayKey } from '@/utils/date'

/**
 * One member's progress, over the top of Group.
 *
 * Tapping a person used to navigate to /u/:id, which is a page of its own with
 * its own back arrow to somewhere else entirely — so "look at how Samir is
 * doing" cost you your place in Group and gave you a screen that no longer
 * looked like Group. This is the same information without leaving: a bottom
 * sheet on a phone, a centred dialog on a desktop, and closing it puts you
 * back exactly where you were, scroll position included.
 *
 * The body is `ProfileView` in its read-only variant — the same component the
 * member page renders — so there is one member layout in the app rather than a
 * page version and a sheet version drifting apart.
 */
export function MemberSheet({
  userId,
  onClose,
}: {
  /** `null` closes the sheet. */
  userId: string | null
  onClose: () => void
}) {
  const snapshot = useLiveQuery(
    () => (userId ? progressService.userSnapshot(userId, todayKey()) : undefined),
    [userId],
  )

  return (
    <Sheet
      open={userId !== null}
      onClose={onClose}
      title={snapshot?.user.name ?? 'Member'}
      subtitle={snapshot ? `@${snapshot.user.handle}` : undefined}
    >
      {snapshot === undefined ? <LoadingScreen /> : null}
      {snapshot === null ? (
        <EmptyState
          compact
          title="No such member"
          body="That profile is not in the group any more."
        />
      ) : null}
      {snapshot ? <ProfileView snapshot={snapshot} variant="member" /> : null}
    </Sheet>
  )
}
