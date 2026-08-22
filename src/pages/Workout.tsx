import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Moon, Play, Plus, Timer } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, Section } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState, LoadingScreen } from '@/components/ui/EmptyState'
import { WorkoutTabs } from '@/components/workout/WorkoutTabs'
import { useAuth } from '@/context/AuthContext'
import { useLogSheet } from '@/context/LogSheetContext'
import { progressService, workoutService } from '@/services'
import { duration, kcal, minutes, num } from '@/utils/format'
import { formatRange, todayKey } from '@/utils/date'
import { EMPTY } from '@/data/messages'
import styles from './Workout.module.css'

export function Workout() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { open } = useLogSheet()
  const today = todayKey()

  const scheduled = useLiveQuery(
    () => (user ? workoutService.scheduledFor(user.id, today) : undefined),
    [user?.id, today],
  )
  const doneToday = useLiveQuery(
    () => (user ? workoutService.sessionsForDay(user.id, today) : undefined),
    [user?.id, today],
  )
  const week = useLiveQuery(
    () => (user ? progressService.weeklySummary(user.id, today) : undefined),
    [user?.id, today],
  )
  const active = useLiveQuery(
    () => (user ? workoutService.activeSession(user.id) : undefined),
    [user?.id],
  )

  if (!user || scheduled === undefined || doneToday === undefined) return <LoadingScreen />

  return (
    <div className={styles.page}>
      <PageHeader title="Workout" subtitle={scheduled ? scheduled.plan.name : 'No plan selected'} parent={{ label: 'Activity', to: '/activity' }} />
      <WorkoutTabs />

      {active ? (
        <Card tone="inverse" className={styles.resume}>
          <div className={styles.resumeText}>
            <span className={styles.resumeDot} aria-hidden="true" />
            <div>
              <p className={styles.resumeTitle}>Workout in progress</p>
              <p className={styles.resumeMeta}>
                {active.name}
                {active.pausedAt ? ' · paused' : ''}
              </p>
            </div>
          </div>
          <Button size="lg" block onClick={() => navigate('/workout/play')}>
            Resume workout
          </Button>
        </Card>
      ) : null}

      {/*
        The everyday path: train in Home Workout or Lose Weight for Men, then
        write down what it said. The built-in player is still here, further
        down, for anyone who wants to be walked through a session — but it is
        no longer what this screen pushes you toward.
      */}
      <Section title="Log a workout">
        <div className={`glass ${styles.logCard}`}>
          <div className={styles.logText}>
            <p className={styles.logTitle}>Done in another app?</p>
            <p className={styles.logBody}>
              Copy the summary across — app, plan, day, time and calories. Ten seconds.
            </p>
          </div>
          <Button
            size="lg"
            block
            icon={<Plus size={17} strokeWidth={2.6} />}
            onClick={() => open('workout')}
          >
            Log workout
          </Button>
        </div>
      </Section>

      <Section title={doneToday.length ? 'Done today' : "Today's plan"}>
        {doneToday.length > 0 ? (
          <ul className={styles.doneList}>
            {doneToday.map((session) => (
              <li key={session.id} className={styles.doneRow}>
                <span className={styles.doneCheck}>
                  <Check size={13} strokeWidth={3} />
                </span>
                <div className={styles.doneText}>
                  <p className={styles.doneName}>
                    {session.dayNumber ? `Day ${session.dayNumber} · ` : ''}
                    {session.name}
                  </p>
                  <p className={styles.doneMeta}>
                    <span className="tnum">{duration(session.durationSec)}</span> · est.{' '}
                    <span className="tnum">{kcal(session.caloriesKcal, 1)}</span> kcal ·{' '}
                    {session.exerciseCount} exercises
                  </p>
                  {session.note ? <p className={styles.doneNote}>“{session.note}”</p> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : scheduled === null ? (
          <EmptyState
            title="No plan yet"
            body="Choose a plan and your daily sessions appear here."
            action={
              <Link to="/workout/plan">
                <Button variant="secondary">Browse plans</Button>
              </Link>
            }
          />
        ) : scheduled.isRestDay ? (
          <EmptyState
            icon={<Moon size={20} strokeWidth={1.9} />}
            title={EMPTY.restDay.title}
            body={EMPTY.restDay.body}
          />
        ) : (
          <Card flush>
            <div className={styles.sessionHead}>
              <p className={styles.sessionDay}>Day {scheduled.dayNumber}</p>
              <h2 className={styles.sessionName}>{scheduled.planDay.name}</h2>
              <p className={styles.sessionMeta}>
                {scheduled.exercises.length} exercises · about{' '}
                {minutes(scheduled.estimatedMinutes * 60)} · {scheduled.plan.level}
              </p>
            </div>

            <ol className={styles.exercises}>
              {scheduled.exercises.map((item, index) => (
                <li key={item.id} className={styles.exercise}>
                  <span className={styles.exerciseIndex}>{index + 1}</span>
                  <div className={styles.exerciseText}>
                    <p className={styles.exerciseName}>{item.exercise.name}</p>
                    {item.exercise.cue ? (
                      <p className={styles.exerciseCue}>{item.exercise.cue}</p>
                    ) : null}
                  </div>
                  <span className={styles.exerciseSpec}>
                    <span className="tnum">
                      {item.sets} × {item.durationSec ? `${item.durationSec}s` : item.reps}
                    </span>
                    <span className={styles.exerciseRest}>{item.restSec}s rest</span>
                  </span>
                </li>
              ))}
            </ol>

            {!active ? (
              <div className={styles.startWrap}>
                <Button
                  size="lg"
                  block
                  variant="secondary"
                  onClick={() => navigate('/workout/play')}
                  icon={<Play size={17} strokeWidth={2.6} fill="currentColor" />}
                >
                  Start workout
                </Button>
              </div>
            ) : null}
          </Card>
        )}
      </Section>

      {week ? (
        <Section
          title="This week"
          action={
            <Link to="/workout/logs" className={styles.sectionLink}>
              History
            </Link>
          }
        >
          <Card className={styles.weekCard}>
            <p className={styles.weekRange}>{formatRange(week.weekStart, week.weekEnd)}</p>
            <dl className={styles.weekStats}>
              <div>
                <dd className="tnum">
                  {week.workouts}
                  <span className={styles.weekGoal}>/{week.workoutGoal}</span>
                </dd>
                <dt>Workouts</dt>
              </div>
              <div>
                <dd className="tnum">{duration(week.durationSec)}</dd>
                <dt>Time</dt>
              </div>
              <div>
                <dd className="tnum">{num(week.caloriesBurned, 1)}</dd>
                <dt>Est. kcal</dt>
              </div>
            </dl>
          </Card>
        </Section>
      ) : null}

      <p className={styles.footnote}>
        <Timer size={12} strokeWidth={2.2} />
        Calories are estimates from your weight and session length, not measurements.
      </p>
    </div>
  )
}
