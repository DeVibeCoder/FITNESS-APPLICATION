import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { LogoMark, LogoSlogan } from '@/components/ui/Logo'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { useAuth } from '@/context/AuthContext'
import { BackendUnavailable } from './BackendUnavailable'
import styles from './Login.module.css'

/**
 * Signing in, for real.
 *
 * The form posts to `/api/auth/sign-in/email`. The server checks the password
 * against a PBKDF2 verifier in D1 and answers with an httpOnly cookie this
 * page cannot read, cannot copy and cannot forge. Nothing about the account —
 * not the id, not the role, not whether it is approved — is decided here or
 * stored anywhere this page can reach.
 *
 * It used to check the password itself, against IndexedDB, and print three
 * demo usernames and their shared password underneath the form. That was
 * honest about what it was and it was still a way into an application. Both
 * halves are gone: the credentials with the fixture group, and the local check
 * with `authService`.
 *
 * The failure message is the same for a wrong password and an address that
 * has never signed up. Which half was wrong is not something to learn by
 * guessing.
 */
export function Login() {
  const { serverUser, ready, backend, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  if (!ready) return <LoadingScreen />
  if (backend === 'unavailable') return <BackendUnavailable />
  /*
   * Already signed in — including an account still waiting on approval. It
   * goes to `/`, where the gate decides what it may see. Sending it straight
   * into the app from here would be this screen answering a question that is
   * not its to answer.
   */
  if (serverUser) return <Navigate to={(location.state as { from?: string })?.from ?? '/'} replace />

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email.trim(), password)
      navigate((location.state as { from?: string })?.from ?? '/', { replace: true })
    } catch {
      setError('That email and password do not match.')
      setBusy(false)
    }
  }

  return (
    <div className={styles.page} data-surface="brand">
      <div className={styles.inner}>
        {/*
          Emblem, name, meaning, then one line about what the app is for — in
          that order, because that is the order somebody arriving for the first
          time needs them. The heading is the brand rather than a greeting:
          "Welcome back" told a returning user something they knew and a new
          one nothing at all.
        */}
        <header className={styles.head}>
          <LogoMark size={92} />
          <h1 className={styles.brand}>RALLY</h1>
          <LogoSlogan />
          <p className={styles.subtitle}>Your fitness. Your progress. Your rally.</p>
        </header>

        <form className={`glass ${styles.card}`} onSubmit={submit} noValidate>
          <Field
            label="Email"
            type="email"
            value={email}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="email"
            placeholder="you@example.com"
            onChange={(event) => {
              setEmail(event.target.value)
              setError(null)
            }}
          />

          <div className={styles.passwordField}>
            <Field
              label="Password"
              type={reveal ? 'text' : 'password'}
              value={password}
              autoComplete="current-password"
              placeholder="Your password"
              onChange={(event) => {
                setPassword(event.target.value)
                setError(null)
              }}
            />
            <button
              type="button"
              className={styles.reveal}
              onClick={() => setReveal((current) => !current)}
              aria-label={reveal ? 'Hide password' : 'Show password'}
            >
              {reveal ? <EyeOff size={17} strokeWidth={2} /> : <Eye size={17} strokeWidth={2} />}
            </button>
          </div>

          {/*
            Announced politely so a screen reader hears the failure without the
            focus being yanked out of the password field.
          */}
          <p className={styles.error} role="status" aria-live="polite">
            {error}
          </p>

          <Button size="lg" block type="submit" disabled={busy || !email.trim() || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>

          <button
            type="button"
            className={styles.link}
            onClick={() => setShowHelp((current) => !current)}
          >
            Forgot password?
          </button>

          {/*
            The truth, rather than a form that would post into a mailer this
            deployment does not have. `sendResetPassword` throws on purpose in
            server/auth/auth.ts, so a "check your email" here would be a
            message about an email nobody sent.
          */}
          {showHelp ? (
            <div className={styles.helpNote}>
              <p>
                Password resets are not set up on this deployment yet — there is no mail
                service to send one. Ask whoever runs the group to reset it for you.
              </p>
            </div>
          ) : null}
        </form>

        <p className={styles.newHere}>
          New here? <Link to="/setup" className={styles.inlineLink}>Ask to join</Link>
        </p>
      </div>
    </div>
  )
}
