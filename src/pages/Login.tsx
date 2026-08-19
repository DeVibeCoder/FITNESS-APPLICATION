import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Logo } from '@/components/ui/Logo'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { useAuth } from '@/context/AuthContext'
import { DEMO_PASSWORD } from '@/data/demo'
import styles from './Login.module.css'

/**
 * A real sign-in screen, not a list of people to tap.
 *
 * The credentials are checked locally, which is a genuine limitation rather
 * than a pretence — see authService. What matters here is that the app behaves
 * like something private: you type who you are, and you cannot become someone
 * else by choosing them from a menu.
 */
export function Login() {
  const { user, ready, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [handle, setHandle] = useState('')
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showDemo, setShowDemo] = useState(false)

  if (!ready) return <LoadingScreen />
  if (user) return <Navigate to={(location.state as { from?: string })?.from ?? '/'} replace />

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(handle, password)
      navigate((location.state as { from?: string })?.from ?? '/', { replace: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.head}>
          <Logo size={30} />
          <h1 className={styles.title}>Welcome back.</h1>
          <p className={styles.subtitle}>Your progress starts here.</p>
        </header>

        <form className={`glass ${styles.card}`} onSubmit={submit} noValidate>
          <Field
            label="Username"
            value={handle}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            placeholder="Your username"
            onChange={(event) => {
              setHandle(event.target.value)
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

          <Button size="lg" block type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>

          <button
            type="button"
            className={styles.link}
            onClick={() => setShowDemo((current) => !current)}
          >
            Forgot password?
          </button>

          {showDemo ? (
            <div className={styles.demo}>
              <p>
                Accounts live on this device only, so there is nothing to email you. The three
                demo accounts are <strong>ahmed</strong>, <strong>nadia</strong> and{' '}
                <strong>samir</strong>, all with the password <strong>{DEMO_PASSWORD}</strong>.
              </p>
              <p className={styles.demoNote}>
                Real password recovery arrives with the server.
              </p>
            </div>
          ) : null}
        </form>

        <p className={styles.newHere}>
          New here? <Link to="/setup" className={styles.inlineLink}>Set up your account</Link>
        </p>
      </div>
    </div>
  )
}
