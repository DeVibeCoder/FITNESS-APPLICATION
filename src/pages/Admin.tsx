import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState, LoadingScreen } from '@/components/ui/EmptyState'
import { useAuth, useIsAdmin } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
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
 * The role check below decides what to draw and nothing else. It reads the
 * session's role — the server's answer, from the same `users.role` column the
 * routes consult — so there is no local field to edit into an admin. And even
 * that is only a courtesy: every request this screen makes is authorised again
 * by `requireAdmin`, so somebody who reached this page another way would get
 * it, and a 403 from every button on it.
 */
export function Admin() {
  const { ready } = useAuth()
  const { show, guard } = useToast()
  const [pending, setPending] = useState<AccountRow[] | undefined>(undefined)

  const refresh = useCallback(async () => {
    const queue = await adminService.queue('pending')
    setPending(queue.accounts)
  }, [])

  /*
   * The session's role, read from the D1 user row. Not the local profile: that
   * row lives in an IndexedDB the holder of the device can edit, so a screen
   * that trusted it would open for anybody who typed "admin" into it. This one
   * opens for anybody the server calls an admin — and every button on it is
   * checked again by `requireAdmin` when it is pressed.
   */
  const isAdmin = useIsAdmin()
  useEffect(() => {
    if (isAdmin) void refresh()
  }, [isAdmin, refresh])

  if (!ready) return <LoadingScreen />
  if (!isAdmin) return <Navigate to="/me" replace />
  if (pending === undefined) return <LoadingScreen />

  const decide = async (userId: string, status: 'approved' | 'rejected', name: string) => {
    /*
     * The `true` matters.
     *
     * `guard` returns undefined when the action throws — and `decide` returns
     * nothing, so it returned undefined when it succeeded as well. The two were
     * indistinguishable, the success branch never ran, and an approval that had
     * already been written left the person still listed as waiting with no
     * confirmation that anything had happened. Returning a value makes the two
     * outcomes different values.
     */
    const done = await guard(async () => {
      await adminService.decide(userId, status)
      return true as const
    })
    if (!done) return

    show(status === 'approved' ? `${name} can now sign in.` : `${name}'s request was declined.`, 'success')
    // Re-read rather than editing the list in place: the queue is the
    // server's, and another administrator may have changed it too.
    await refresh()
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
