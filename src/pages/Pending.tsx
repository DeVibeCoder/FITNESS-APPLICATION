import { useEffect, useState } from 'react'
import { Hourglass, ShieldX, UserX } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import styles from './Pending.module.css'

/**
 * Where an account that may not enter waits — and where it stops waiting.
 *
 * Three statuses land here and each is a different sentence. Pending is a
 * question somebody else has not answered yet. Rejected and disabled are
 * answers, and pretending otherwise with a spinner would be a lie told
 * politely.
 *
 * The important behaviour is what happens when the answer changes. An
 * administrator approves this account on their own device, and this screen
 * becomes the application without anybody touching the browser. That works
 * because `AuthProvider` is already re-asking the server every few seconds
 * while a session is not approved; the moment the answer comes back
 * `approved`, `serverUser.status` changes, `RequireAuth` stops rendering this
 * screen and renders the route that was asked for.
 *
 * Note what does NOT happen: nothing tells this screen it was approved. There
 * is no event carrying a decision, no payload to trust and no message a page
 * could fabricate for itself. The client only ever re-asks the authenticated
 * API, and the API answers from the `users` row. A signal — a poll tick, a
 * regained focus, a socket frame — can only ever decide *when* to ask.
 *
 * The button is a courtesy for someone who does not want to wait four
 * seconds. It does the same thing the timer does.
 */
export function Pending() {
  const { serverUser, refresh, signOut } = useAuth()
  const [checking, setChecking] = useState(false)
  /** Announced once, so a screen reader is told this page updates itself. */
  const [waitedFor, setWaitedFor] = useState(0)

  useEffect(() => {
    if (serverUser?.status !== 'pending') return
    const timer = setInterval(() => setWaitedFor((seconds) => seconds + 30), 30000)
    return () => clearInterval(timer)
  }, [serverUser?.status])

  if (!serverUser) return null

  const check = async () => {
    setChecking(true)
    await refresh()
    // Deliberately not cleared on success: an approval unmounts this screen,
    // and a button that flicks back to "Check again" first is a flash of the
    // wrong state.
    setTimeout(() => setChecking(false), 600)
  }

  const copy = {
    pending: {
      icon: <Hourglass size={24} strokeWidth={1.9} />,
      title: 'Waiting for approval',
      body:
        'Your account has been created. An administrator has to let you in before you can ' +
        'start — this screen moves on by itself the moment they do.',
      footnote:
        waitedFor >= 120
          ? 'Still waiting. You can leave this open, or sign in again later — nothing is lost.'
          : 'You can leave this page open.',
      canRetry: true,
    },
    rejected: {
      icon: <UserX size={24} strokeWidth={1.9} />,
      title: 'This account was not approved',
      body:
        'An administrator declined the request. Nothing you entered has been shared with ' +
        'anybody in the group.',
      footnote: 'If you think that was a mistake, speak to whoever runs the group.',
      canRetry: false,
    },
    disabled: {
      icon: <ShieldX size={24} strokeWidth={1.9} />,
      title: 'This account has been disabled',
      body: 'It can no longer be used to sign in. Your data has not been deleted.',
      footnote: 'If you think that was a mistake, speak to whoever runs the group.',
      canRetry: false,
    },
  }[serverUser.status === 'approved' ? 'pending' : serverUser.status]

  return (
    <main className={styles.root}>
      <div className={styles.card}>
        <span
          className={`${styles.mark} ${copy.canRetry ? styles.marking : ''}`}
          aria-hidden="true"
        >
          {copy.icon}
        </span>

        <h1 className={styles.title}>{copy.title}</h1>
        {/*
          Polite rather than assertive: the status changes on its own, and
          yanking a screen reader mid-sentence to say so would be worse than
          telling it when it next comes up for air.
        */}
        <p className={styles.body} role="status" aria-live="polite">
          {copy.body}
        </p>

        <p className={styles.account}>{serverUser.email ?? serverUser.name}</p>

        {copy.canRetry ? (
          <button type="button" className={styles.signOut} onClick={check} disabled={checking}>
            {checking ? 'Checking…' : 'Check now'}
          </button>
        ) : null}

        <p className={styles.footnote}>{copy.footnote}</p>

        <button type="button" className={styles.signOut} onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </main>
  )
}
