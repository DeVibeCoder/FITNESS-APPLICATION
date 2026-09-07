import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState, LoadingScreen } from '@/components/ui/EmptyState'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { hasRole } from '@/services'
import { adminService, type AccountRow } from '@/services/adminService'
import { formatDay, toDateKey } from '@/utils/date'
import styles from './Admin.module.css'

/**
 * Approving people who have asked to join.
 *
 * Deliberately small — a list and two buttons, not an HR console.
 *
 * The queue is read from the server rather than from the local cache, because
 * an approval is the one answer where this device's copy is not good enough:
 * it would show requests somebody already decided elsewhere and hide the ones
 * it has never seen.
 *
 * The role check below decides what to draw and nothing else. Every request
 * this screen makes is checked again by `requireAdmin` on the server, against
 * the role column on the user row — so a person who edits their local profile
 * to say "admin" gets this page and then a 403 from every button on it.
 */
export function Admin() {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const [pending, setPending] = useState<AccountRow[] | undefined>(undefined)

  const refresh = useCallback(async () => {
    const queue = await adminService.queue('pending')
    setPending(queue.accounts)
  }, [])

  const isAdmin = hasRole(user, 'admin')
  useEffect(() => {
    if (isAdmin) void refresh()
  }, [isAdmin, refresh])

  if (!user) return <LoadingScreen />
  if (!isAdmin) return <Navigate to="/me" replace />
  if (pending === undefined) return <LoadingScreen />

  const decide = async (userId: string, status: 'approved' | 'rejected', name: string) => {
    const result = await guard(() => adminService.decide(userId, status))
    if (result !== undefined) {
      show(status === 'approved' ? `${name} can now sign in.` : `${name}'s request was declined.`, 'success')
      // Re-read rather than editing the list in place: the queue is the
      // server's, and another administrator may have changed it too.
      await refresh()
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Admin"
        subtitle={pending.length ? `${pending.length} waiting` : 'Nothing waiting'}
        parent={{ label: 'Me', to: '/me' }}
      />


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
                  Asked {formatDay(toDateKey(new Date(request.created_at)))}
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
