import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Moon, Play, Repeat } from 'lucide-react'
import { db } from '@/lib/db'
import { PageHeader } from '@/components/ui/PageHeader'
import { workoutAppLabel } from '@/data/workoutApps'
import { Card, Section } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { WorkoutTabs } from '@/components/workout/WorkoutTabs'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { workoutService } from '@/services'
import type { WorkoutPlan as WorkoutPlanModel } from '@/models'
import { formatDay, todayKey } from '@/utils/date'
import { clamp, pct } from '@/utils/format'
import styles from './WorkoutPlan.module.css'

/**
 * The plan a member is working through, and how far along they are. Day status
 * is derived from completed sessions, so switching plans never rewrites history.
 */
export function WorkoutPlan() {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const today = todayKey()
  const [changing, setChanging] = useState(false)

  const enrollment = useLiveQuery(
    () => (user ? workoutService.activeEnrollment(user.id) : undefined),
    [user?.id],
  )
  const plans = useLiveQuery(() => workoutService.listPlans(), [])
  const plan = useLiveQuery(
    () => (enrollment ? workoutService.getPlan(enrollment.planId) : undefined),
    [enrollment?.planId],
  )
  const days = useLiveQuery(
    async () =>
      enrollment
        ? (await db.planDays.where('planId').equals(enrollment.planId).toArray()).sort(
            (a, b) => a.dayNumber - b.dayNumber,
          )
        : [],
    [enrollment?.planId],
  )
  const sessions = useLiveQuery(
    () => (user ? workoutService.sessionsForUser(user.id) : []),
    [user?.id],
  )

  /**
   * Plans live in the external app, so the label has to come from the data:
   * whichever app this person has actually been logging from, falling back to
   * the first one on their profile.
   */
  const planApp = sessions?.find((session) => session.source)?.source ?? user?.workoutApps?.[0]

  if (!user || enrollment === undefined || plans === undefined) return <LoadingScreen />

  const currentDay =
    enrollment && plan ? workoutService.dayNumberFor(enrollment, today, plan.totalDays) : 0
  const completedDays = new Set(
    (sessions ?? [])
      .filter((session) => session.planId === enrollment?.planId && session.dayNumber)
      .map((session) => session.dayNumber!),
  )
  const trainingDays = (days ?? []).filter((day) => day.estimatedMinutes > 0)
  const doneCount = trainingDays.filter((day) => completedDays.has(day.dayNumber)).length
  const progressPct = trainingDays.length
    ? clamp((doneCount / trainingDays.length) * 100, 0, 100)
    : 0

  const switchTo = async (next: WorkoutPlanModel) => {
    await guard(async () => {
      await workoutService.enroll(user.id, next.id)
      show(`Switched to ${next.name}. Day 1 starts today.`, 'success')
    })
    setChanging(false)
  }

  return (
    <div className={styles.page}>
      <PageHeader title="Plan" subtitle={plan?.name ?? 'No plan selected'} backTo="/workout" />
      <WorkoutTabs />

      {plan && enrollment ? (
        <>
          <Section title="Your external workout plan">
            <Card className={styles.planCard}>
              <div className={styles.planHead}>
                <div>
                  <p className={styles.planApp}>
                    <span className={styles.planAppLabel}>Workout app</span>
                    {workoutAppLabel(planApp)}
                  </p>
                  <h2 className={styles.planName}>{plan.name}</h2>
                  <p className={styles.planMeta}>
                    {plan.totalDays} days · {plan.level} · started{' '}
                    {enrollment.startDate === today ? 'today' : formatDay(enrollment.startDate)}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Repeat size={14} strokeWidth={2.2} />}
                  onClick={() => setChanging(true)}
                >
                  Change
                </Button>
              </div>

              <p className={styles.planDesc}>{plan.description}</p>

              <div className={styles.progressRow}>
                <span className={styles.progressLabel}>
                  Day <span className="tnum">{currentDay}</span> of{' '}
                  <span className="tnum">{plan.totalDays}</span>
                </span>
                <span className={styles.progressPct}>
                  <span className="tnum">{doneCount}</span>/{trainingDays.length} sessions ·{' '}
                  <span className="tnum">{pct(progressPct)}</span>
                </span>
              </div>
              <div className={styles.track}>
                <div className={styles.fill} style={{ width: `${progressPct}%` }} />
              </div>
            </Card>
          </Section>

          <Section title="Days">
            <ol className={styles.days}>
              {(days ?? []).map((day) => {
                const isRest = day.estimatedMinutes === 0
                const done = completedDays.has(day.dayNumber)
                const isCurrent = day.dayNumber === currentDay
                const state = done ? 'done' : isCurrent ? 'current' : isRest ? 'rest' : 'todo'
                return (
                  <li key={day.id} className={`${styles.day} ${styles[state]}`}>
                    <span className={styles.dayMark} aria-hidden="true">
                      {done ? (
                        <Check size={12} strokeWidth={3.2} />
                      ) : isCurrent ? (
                        <Play size={10} strokeWidth={3} fill="currentColor" />
                      ) : isRest ? (
                        <Moon size={11} strokeWidth={2.2} />
                      ) : null}
                    </span>
                    <span className={styles.dayNumber}>
                      Day <span className="tnum">{day.dayNumber}</span>
                    </span>
                    <span className={styles.dayName}>{day.name}</span>
                    {isCurrent ? <span className={styles.todayTag}>Today</span> : null}
                  </li>
                )
              })}
            </ol>
            <p className={styles.note}>
              Switching plans keeps every session you have already finished. Only what is scheduled
              next changes.
            </p>
          </Section>
        </>
      ) : (
        <Section title="Choose a plan">
          <p className={styles.note}>Pick a plan and your daily sessions start appearing on Today.</p>
          <ul className={styles.planList}>
            {plans.map((option) => (
              <li key={option.id}>
                <PlanOption plan={option} onChoose={() => switchTo(option)} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Sheet
        open={changing}
        onClose={() => setChanging(false)}
        title="Change plan"
        subtitle="Your finished workouts stay exactly where they are."
      >
        <ul className={styles.planList}>
          {plans.map((option) => (
            <li key={option.id}>
              <PlanOption
                plan={option}
                active={option.id === enrollment?.planId}
                onChoose={() => switchTo(option)}
              />
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  )
}

function PlanOption({
  plan,
  active,
  onChoose,
}: {
  plan: WorkoutPlanModel
  active?: boolean
  onChoose: () => void
}) {
  return (
    <Card className={[styles.option, active ? styles.optionActive : ''].filter(Boolean).join(' ')}>
      <div className={styles.optionHead}>
        <h3 className={styles.optionName}>{plan.name}</h3>
        {active ? <span className={styles.optionBadge}>Current</span> : null}
      </div>
      <p className={styles.optionDesc}>{plan.description}</p>
      <ul className={styles.tags}>
        <li>{plan.totalDays} days</li>
        <li>{plan.level}</li>
        {plan.focus.map((tag) => (
          <li key={tag}>{tag}</li>
        ))}
      </ul>
      {!active ? (
        <Button variant="secondary" size="sm" onClick={onChoose}>
          Switch to this plan
        </Button>
      ) : null}
    </Card>
  )
}
