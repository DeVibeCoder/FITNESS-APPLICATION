import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ArrowLeft, Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, OptionGroup } from '@/components/ui/Field'
import { LogoMark, LogoSlogan } from '@/components/ui/Logo'
import { useAuth } from '@/context/AuthContext'
import { checkPassword, validateEmail } from '@/services'
import { ServerAuthError } from '@/services/serverAuthService'
import { ACTIVITY_LEVELS, FITNESS_GOALS, ageFrom, calcEnergyPlan } from '@/utils/calories'
import { goalProfile } from '@/utils/goals'
import { WORKOUT_APPS } from '@/data/workoutApps'
import { num } from '@/utils/format'
import type { ActivityLevel, FitnessGoal, Sex, Units, Weekday, WorkoutSource } from '@/models'
import styles from './Setup.module.css'

const WEEKDAYS: { value: Weekday; label: string }[] = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

const AVATAR_TINTS = ['#3d6ea8', '#a8557a', '#5f8b4c', '#9a6bb0', '#c07a2c', '#3f8f8a']

const STEPS = ['You', 'About you', 'Your goal', 'Activity', 'Preferences', 'Ready'] as const

/**
 * What to show when sign-up is refused.
 *
 * Better Auth answers a duplicate address with a code rather than a sentence,
 * and its sentence is written for a developer. Everything else stays
 * deliberately vague: an error message that relays the server's internals is a
 * description of the server.
 */
function signUpMessage(error: unknown): string {
  if (error instanceof ServerAuthError) {
    const code = error.code.toUpperCase()
    if (code.includes('EXIST') || error.status === 422) {
      return 'There is already an account using that email.'
    }
    if (code.includes('PASSWORD')) return 'That password was refused. Try a longer one.'
  }
  return 'That did not work. Check your details and try again.'
}

/**
 * Asking to join.
 *
 * Six short screens rather than one long form: each asks for as little as it
 * can and nothing is required twice. The last screen shows what the answers
 * add up to, so setup ends with something useful rather than a save button.
 *
 * What changed underneath it is the point of this screen now. It used to write
 * a user row into IndexedDB, set a local password digest and sign the person
 * straight in — an account this device invented, that no server had heard of,
 * already approved because there was nobody to ask. It now posts to
 * `/api/auth/sign-up/email`, and the row that gets written is in D1 with
 * `status = 'pending'`, a column no client can set.
 *
 * The profile answers do not go with it. A pending account has no profile to
 * write them to, and this device deliberately builds none for an account that
 * may never be let in — so they wait in `onboardingService` and are used once,
 * at approval. See the comment there.
 */
export function Setup() {
  const { serverUser, ready, signUp } = useAuth()

  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [confirm, setConfirm] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [sex, setSex] = useState<Sex>('male')
  const [heightCm, setHeightCm] = useState('')
  const [startWeight, setStartWeight] = useState('')
  const [goal, setGoal] = useState<FitnessGoal>('lose_weight')
  const [targetWeight, setTargetWeight] = useState('')
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>('moderate')
  const [weighInDay, setWeighInDay] = useState<Weekday>(0)
  const [workoutApps, setWorkoutApps] = useState<WorkoutSource[]>(['home_workout'])
  const [units, setUnits] = useState<Units>('metric')

  const usesTarget = goalProfile(goal).usesTargetWeight
  const startKg = Number(startWeight)
  const targetKg = Number(targetWeight)

  const plan = useMemo(() => {
    if (!startKg || !Number(heightCm) || !birthDate) return null
    return calcEnergyPlan({
      weightKg: startKg,
      heightCm: Number(heightCm),
      age: ageFrom(birthDate),
      sex,
      activityLevel,
      goal,
    })
  }, [startKg, heightCm, birthDate, sex, activityLevel, goal])

  if (!ready) return null
  /*
   * Already has an account — including one still waiting on a decision. It
   * goes to `/`, where the gate decides what it may see. This screen must not
   * become a way to start a second account over the top of a live session.
   */
  if (serverUser) return <Navigate to="/" replace />

  const canContinue = (): boolean => {
    switch (step) {
      case 0: {
        const emailOk = validateEmail(email).valid
        const passwordOk = checkPassword(password).valid
        return (
          name.trim().length > 1 &&
          handle.trim().length > 1 &&
          emailOk &&
          passwordOk &&
          password === confirm
        )
      }
      case 1:
        return Boolean(birthDate) && Number(heightCm) > 80 && Number(heightCm) < 260
      case 2:
        return startKg > 20 && startKg < 400 && (!usesTarget || (targetKg > 20 && targetKg < 400))
      case 3:
      case 4:
        return true
      default:
        return true
    }
  }

  /**
   * Creates the account, which then waits.
   *
   * No local user row, no local password, no sign-in. One request, which the
   * server answers by writing a `pending` row and setting a session cookie —
   * enough to see your own status and nothing else. The redirect at the top of
   * this component then sends the browser to `/`, where the gate renders the
   * waiting screen.
   *
   * A duplicate address is the server's answer to give, not this form's to
   * guess. There is no local directory to consult any more, and consulting one
   * would only ever have described this device.
   */
  const finish = async () => {
    setBusy(true)
    setError(null)
    try {
      await signUp({
        email: email.trim().toLowerCase(),
        password,
        name: name.trim(),
        onboarding: {
          handle: handle.trim().toLowerCase(),
          avatarColor: AVATAR_TINTS[Math.floor(Math.random() * AVATAR_TINTS.length)],
          birthDate,
          sex,
          heightCm: Number(heightCm),
          startWeightKg: startKg,
          // Someone with no weight target still needs a number here; their own
          // starting weight means "no change expected", which is the truth.
          targetWeightKg: usesTarget ? targetKg : startKg,
          goal,
          activityLevel,
          stepGoal: 8000,
          waterGoalL: 2.5,
          workoutsPerWeekGoal: 4,
          weighInDay,
          workoutApps: workoutApps.length ? workoutApps : ['home_workout'],
          units,
        },
      })
      // Nothing to navigate to: `serverUser` lands in context and the redirect
      // above takes over.
    } catch (caught) {
      setError(signUpMessage(caught))
      setBusy(false)
      // Both of the things that can go wrong were typed on the first screen.
      setStep(0)
    }
  }

  const toggleApp = (value: WorkoutSource) => {
    setWorkoutApps((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    )
  }

  return (
    <div className={styles.page} data-surface="brand">
      <div className={styles.inner}>
        <header className={styles.head}>
          {step === 0 ? (
            <Link to="/login" className={styles.back} aria-label="Back to sign in">
              <ArrowLeft size={18} strokeWidth={2.2} />
            </Link>
          ) : (
            <button
              className={styles.back}
              onClick={() => setStep((s) => s - 1)}
              aria-label="Previous step"
            >
              <ArrowLeft size={18} strokeWidth={2.2} />
            </button>
          )}
          <ol className={styles.dots} aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((label, index) => (
              <li
                key={label}
                className={[
                  styles.dot,
                  index === step ? styles.dotOn : '',
                  index < step ? styles.dotDone : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="sr-only">{label}</span>
              </li>
            ))}
          </ol>
        </header>

        <div className={`glass ${styles.card}`}>
          {step === 0 ? (
            <>
              {/*
                The first step carries the brand, because this is where
                somebody meets the app. The later steps do not repeat it —
                they are a form being filled in, and a logo above every one
                would be a banner rather than a mark.
              */}
              <div className={styles.brandBlock}>
                <LogoMark size={64} />
                <p className={styles.brandName}>RALLY</p>
                <LogoSlogan />
              </div>
              <div>
                <h1 className={styles.title}>Let's set you up</h1>
                <p className={styles.sub}>Takes about a minute.</p>
              </div>
              <Field
                label="Your name"
                value={name}
                autoComplete="name"
                placeholder="Your name"
                onChange={(event) => setName(event.target.value)}
              />
              <Field
                label="Username"
                value={handle}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                placeholder="yourname"
                hint="What the group sees beside what you post. Lower case, no spaces."
                onChange={(event) => setHandle(event.target.value.replace(/\s+/g, ''))}
              />
              <Field
                label="Email"
                type="email"
                value={email}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="email"
                placeholder="you@gmail.com"
                hint={
                  email && !validateEmail(email).valid
                    ? validateEmail(email).message
                    : 'Used to reach you, and to recover your account later.'
                }
                onChange={(event) => setEmail(event.target.value)}
              />
              <Field
                label="Password"
                type="password"
                value={password}
                autoComplete="new-password"
                placeholder="At least 10 characters"
                hint={password ? checkPassword(password).message ?? `Strength: ${checkPassword(password).label}` : 'At least 10 characters.'}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Field
                label="Confirm password"
                type="password"
                value={confirm}
                autoComplete="new-password"
                placeholder="Type it again"
                hint={confirm && confirm !== password ? "Those do not match." : undefined}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </>
          ) : null}

          {step === 1 ? (
            <>
              <div>
                <h1 className={styles.title}>About you</h1>
                <p className={styles.sub}>Used to estimate your daily energy — nothing else.</p>
              </div>
              <Field
                label="Date of birth"
                type="date"
                value={birthDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setBirthDate(event.target.value)}
              />
              <OptionGroup
                label="Sex"
                value={sex}
                options={[
                  { value: 'male' as Sex, label: 'Male' },
                  { value: 'female' as Sex, label: 'Female' },
                ]}
                onChange={setSex}
              />
              <Field
                label="Height"
                type="number"
                inputMode="decimal"
                suffix="cm"
                value={heightCm}
                placeholder="170"
                onChange={(event) => setHeightCm(event.target.value)}
              />
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div>
                <h1 className={styles.title}>What are you working on?</h1>
                <p className={styles.sub}>You can change this whenever it changes.</p>
              </div>
              <div className={styles.goals} role="radiogroup" aria-label="Your goal">
                {FITNESS_GOALS.map((option) => (
                  <button
                    key={option.value}
                    role="radio"
                    aria-checked={goal === option.value}
                    className={[styles.goal, goal === option.value ? styles.goalOn : '']
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setGoal(option.value)}
                  >
                    <span className={styles.goalLabel}>{option.label}</span>
                    <span className={styles.goalHint}>{option.hint}</span>
                    {goal === option.value ? (
                      <Check size={16} strokeWidth={2.6} className={styles.goalCheck} />
                    ) : null}
                  </button>
                ))}
              </div>
              <Field
                label="Weight right now"
                type="number"
                inputMode="decimal"
                suffix="kg"
                value={startWeight}
                placeholder="80.0"
                onChange={(event) => setStartWeight(event.target.value)}
              />
              {usesTarget ? (
                <Field
                  label="Weight you're aiming for"
                  type="number"
                  inputMode="decimal"
                  suffix="kg"
                  value={targetWeight}
                  placeholder="72.0"
                  onChange={(event) => setTargetWeight(event.target.value)}
                />
              ) : null}
            </>
          ) : null}

          {step === 3 ? (
            <>
              <div>
                <h1 className={styles.title}>How active are you?</h1>
                <p className={styles.sub}>Outside of workouts — your normal week.</p>
              </div>
              <div className={styles.goals} role="radiogroup" aria-label="Activity level">
                {ACTIVITY_LEVELS.map((option) => (
                  <button
                    key={option.value}
                    role="radio"
                    aria-checked={activityLevel === option.value}
                    className={[styles.goal, activityLevel === option.value ? styles.goalOn : '']
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setActivityLevel(option.value)}
                  >
                    <span className={styles.goalLabel}>{option.label}</span>
                    <span className={styles.goalHint}>{option.hint}</span>
                    {activityLevel === option.value ? (
                      <Check size={16} strokeWidth={2.6} className={styles.goalCheck} />
                    ) : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <div>
                <h1 className={styles.title}>A couple of preferences</h1>
                <p className={styles.sub}>All of these can change later.</p>
              </div>
              <OptionGroup
                label="Weekly weigh-in day"
                value={weighInDay}
                options={WEEKDAYS.map((d) => ({ value: d.value, label: d.label.slice(0, 3) }))}
                onChange={setWeighInDay}
              />
              <fieldset className={styles.apps}>
                <legend className={styles.appsLegend}>Which workout apps do you use?</legend>
                <div className={styles.appRow}>
                  {WORKOUT_APPS.map((app) => {
                    const on = workoutApps.includes(app.value)
                    return (
                      <button
                        key={app.value}
                        className={[styles.app, on ? styles.appOn : ''].filter(Boolean).join(' ')}
                        aria-pressed={on}
                        onClick={() => toggleApp(app.value)}
                      >
                        {app.label}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
              <OptionGroup
                label="Units"
                value={units}
                options={[
                  { value: 'metric' as Units, label: 'kg / cm' },
                  { value: 'imperial' as Units, label: 'lb / in' },
                ]}
                onChange={setUnits}
              />
              {units === 'imperial' ? (
                <p className={styles.note}>
                  Entry stays in kg and cm for now — pounds and inches arrive with the next
                  release.
                </p>
              ) : null}
            </>
          ) : null}

          {step === 5 ? (
            <>
              <div>
                <h1 className={styles.title}>Your plan is ready</h1>
                <p className={styles.sub}>
                  Estimates, not prescriptions — adjust them any time from your profile.
                </p>
              </div>
              <dl className={styles.summary}>
                <div className={styles.row}>
                  <dt>Starting</dt>
                  <dd className="tnum">{num(startKg, 1)} kg</dd>
                </div>
                {usesTarget ? (
                  <div className={styles.row}>
                    <dt>Goal</dt>
                    <dd className="tnum">{num(targetKg, 1)} kg</dd>
                  </div>
                ) : null}
                <div className={styles.row}>
                  <dt>Focus</dt>
                  <dd>{FITNESS_GOALS.find((g) => g.value === goal)?.label}</dd>
                </div>
                {plan ? (
                  <div className={`${styles.row} ${styles.rowStrong}`}>
                    <dt>Daily energy target</dt>
                    <dd className="tnum">{plan.target.toLocaleString()} kcal</dd>
                  </div>
                ) : null}
                <div className={styles.row}>
                  <dt>Weigh-in day</dt>
                  <dd>{WEEKDAYS.find((d) => d.value === weighInDay)?.label}</dd>
                </div>
              </dl>
            </>
          ) : null}

          {/*
            One place for the failure, outside the steps.
            A sign-up is refused for something typed on the first screen — a
            duplicate address, a password the server would not take — so the
            form goes back there to be corrected, and the message has to be
            visible when it arrives rather than left behind on the summary.
          */}
          {error ? <p className={styles.error}>{error}</p> : null}

          {step < STEPS.length - 1 ? (
            <Button size="lg" block disabled={!canContinue()} onClick={() => setStep((s) => s + 1)}>
              Continue
            </Button>
          ) : (
            <>
              {/*
                Said before the button rather than after it. Somebody who
                expects to land in the application and lands on a waiting
                screen has been surprised by their own app; somebody who was
                told is simply waiting.
              */}
              <p className={styles.note}>
                An administrator has to approve your account before you can start. You will see
                that happen without having to refresh.
              </p>
              <Button size="lg" block disabled={busy} onClick={finish}>
                {busy ? 'Sending…' : 'Ask to join'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
