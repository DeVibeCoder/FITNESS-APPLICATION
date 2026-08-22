import { Navigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, X } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState, LoadingScreen } from '@/components/ui/EmptyState'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { accountService, hasRole } from '@/services'
import { goalLabel } from '@/utils/calories'
import { formatDay, toDateKey } from '@/utils/date'
import styles from './Admin.module.css'

/**
 * Approving people who have asked to join.
 *
 * Deliberately small — a list and two buttons, not an HR console. The route
 * bounces anyone who is not an admin, but that is a convenience rather than a
 * protection: the role lives in a local database that anyone with the device
 * can edit. Real authorisation arrives with the server.
 */
export function Admin() {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const pending = useLiveQuery(() => accountService.pending(), [])

  if (!user) return <LoadingScreen />
  if (!hasRole(user, 'admin')) return <Navigate to="/me" replace />
  if (pending === undefined) return <LoadingScreen />

  const decide = async (userId: string, status: 'approved' | 'rejected', name: string) => {
    const result = await guard(() =>
      accountService.decide({ adminId: user.id, userId, status }),
    )
    if (result !== undefined) {
      show(status === 'approved' ? `${name} can now sign in.` : `${name}'s request was declined.`, 'success')
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Admin"
        subtitle={pending.length ? `${pending.length} waiting` : 'Nothing waiting'}
        parent={{ label: 'Me', to: '/me' }}
      />

      <p className={styles.warning}>
        Approval runs entirely on this device. It shapes the flow but protects nothing until the
        group moves to a server.
      </p>

      {pending.length === 0 ? (
        <EmptyState
          title="No requests"
          body="When someone asks to join, they will appear here for you to approve."
        />
      ) : (
        <ul className={styles.list}>
          {pending.map((request) => (
            <li key={request.id} className={styles.request}>
              <div className={styles.details}>
                <p className={styles.name}>{request.name}</p>
                <p className={styles.email}>{request.email ?? 'No email on file'}</p>
                <p className={styles.meta}>
                  {goalLabel(request.goal)} · asked{' '}
                  {formatDay(toDateKey(new Date(request.joinedAt)))}
                </p>
              </div>
              <div className={styles.actions}>
                <Button
                  size="sm"
                  icon={<Check size={14} strokeWidth={2.6} />}
                  onClick={() => decide(request.id, 'approved', request.name)}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<X size={14} strokeWidth={2.6} />}
                  onClick={() => decide(request.id, 'rejected', request.name)}
                >
                  Decline
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
