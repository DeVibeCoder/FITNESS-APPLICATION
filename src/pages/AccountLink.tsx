import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Avatar'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { identityLinkService } from '@/services/identityLinkService'
import type { User } from '@/models'
import styles from './AccountLink.module.css'

/**
 * The one question that cannot be answered automatically.
 *
 * An account has signed in and this device holds history that predates it.
 * Whether the two belong together is a fact about a person, not about data,
 * so nobody but the person can say. A matching email address is shown as a
 * hint because it usually is the same person — and it is never acted on,
 * because "knows the address" is not "owns the history".
 *
 * Choosing wrong here would hand somebody another person's workouts, so the
 * screen makes the two outcomes plain and does nothing until asked. Neither
 * choice destroys anything: linking rewrites no rows, and starting fresh
 * leaves every existing profile exactly where it is.
 */
export function AccountLink() {
  const { serverUser, linkExisting, startFresh, signOut } = useAuth()
  const { guard } = useToast()

  const [candidates, setCandidates] = useState<User[] | null>(null)
  const [hint, setHint] = useState<User | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!serverUser) return
    let cancelled = false
    void identityLinkService.resolve(serverUser).then((resolution) => {
      if (cancelled || resolution.kind !== 'choice') return
      setCandidates(resolution.localUsers)
      setHint(resolution.emailMatch)
      // Pre-selected, never pre-committed: the button still has to be pressed.
      setChosen(resolution.emailMatch?.id ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [serverUser])

  if (!serverUser) return null

  const useExisting = async () => {
    if (!chosen || busy) return
    setBusy(true)
    await guard(() => linkExisting(chosen), "That data could not be connected to this account.")
    setBusy(false)
  }

  const fresh = async () => {
    if (busy) return
    setBusy(true)
    await guard(() => startFresh(), "A new profile could not be created.")
    setBusy(false)
  }

  const none = candidates !== null && candidates.length === 0

  return (
    <main className={styles.root}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Signed in as</p>
        <h1 className={styles.title}>{serverUser.email ?? serverUser.name}</h1>

        {none ? (
          <p className={styles.body}>
            There is no existing profile on this device, so this account starts with a clean slate.
          </p>
        ) : (
          <p className={styles.body}>
            This device already holds training history. Connect it to this account, or begin again
            and leave it untouched.
          </p>
        )}

        {candidates === null ? (
          <p className={styles.body}>Looking at what is on this device…</p>
        ) : candidates.length > 0 ? (
          <>
            <ul className={styles.list}>
              {candidates.map((candidate) => {
                const isHint = hint?.id === candidate.id
                return (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      className={[styles.option, chosen === candidate.id ? styles.optionOn : '']
                        .filter(Boolean)
                        .join(' ')}
                      aria-pressed={chosen === candidate.id}
                      onClick={() => setChosen(candidate.id)}
                    >
                      <Avatar user={candidate} size="md" />
                      <span className={styles.optionText}>
                        <span className={styles.optionName}>{candidate.name}</span>
                        {/* Enough to tell two profiles apart, and no more. */}
                        <span className={styles.optionMeta}>
                          {isHint ? 'Same email address as this account' : `Joined ${candidate.joinedAt.slice(0, 10)}`}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            <Button size="lg" block onClick={useExisting} disabled={!chosen || busy}>
              {busy ? 'Connecting…' : 'Use this data on this device'}
            </Button>
          </>
        ) : null}

        <Button variant="secondary" size="lg" block onClick={fresh} disabled={busy}>
          {none ? 'Continue' : 'Start fresh instead'}
        </Button>

        <p className={styles.footnote}>
          Nothing on this device is deleted either way. Starting fresh leaves the existing history
          exactly where it is.
        </p>

        <button type="button" className={styles.signOut} onClick={signOut}>
          Sign out
        </button>
      </div>
    </main>
  )
}
