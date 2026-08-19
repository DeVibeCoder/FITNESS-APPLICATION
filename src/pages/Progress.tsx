import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus } from 'lucide-react'
import { Card, Section } from '@/components/ui/Card'
import { Button, ButtonLink } from '@/components/ui/Button'
import { EmptyState, LoadingScreen } from '@/components/ui/EmptyState'
import { TrendChart } from '@/components/charts/TrendChart'
import { GoalHero } from '@/components/home/GoalHero'
import { WeighInCard } from '@/components/progress/WeighInCard'
import { WeightHistory } from '@/components/progress/WeightHistory'
import { MeasurementSection } from '@/components/progress/MeasurementSection'
import { BmiCard } from '@/components/progress/BmiCard'
import { EnergyCard } from '@/components/progress/EnergyCard'
import { WeekSnapshot } from '@/components/progress/WeekSnapshot'
import { Insights } from '@/components/progress/Insights'
import { useAuth } from '@/context/AuthContext'
import { useLogSheet } from '@/context/LogSheetContext'
import { measurementService, progressService, weightService } from '@/services'
import { buildInsights } from '@/utils/insights'
import { changeOver, weighInComparison } from '@/utils/progress'
import { todayKey } from '@/utils/date'
import { num, signed } from '@/utils/format'
import { EMPTY } from '@/data/messages'
import styles from './Progress.module.css'

/**
 * My progress — a primary destination now, not a page inside Activity.
 *
 * Activity answers "what about today". This answers "is any of it working",
 * which is a different question asked on a different rhythm, and burying it two
 * taps deep made the one number people actually care about the hardest one to
 * find. Group progress is separate again: this screen is only about you.
 *
 * One scroll, no tabs. Journey, then the week, then the body, then the energy
 * estimates, then the records the earlier sections were derived from. Tabs made
 * three of those four invisible until you knew to go looking.
 */
export function Progress() {
  const { user } = useAuth()
  const { open } = useLogSheet()
  const today = todayKey()

  const me = useLiveQuery(
    () => (user ? progressService.userSnapshot(user.id, today) : undefined),
    [user?.id, today],
  )
  const week = useLiveQuery(
    () => (user ? progressService.weeklySummary(user.id, today) : undefined),
    [user?.id, today],
  )
  const weights = useLiveQuery(
    () => (user ? weightService.listForUser(user.id) : undefined),
    [user?.id],
  )
  const measurements = useLiveQuery(
    () => (user ? measurementService.listForUser(user.id) : undefined),
    [user?.id],
  )

  const series = useMemo(
    () => (weights ?? []).map((entry) => ({ date: entry.date, value: entry.weightKg })),
    [weights],
  )

  const insights = useMemo(() => {
    if (!me) return []
    return buildInsights({
      weights: weights ?? [],
      measurements: measurements ?? [],
      progress: me.progress,
      workoutsThisWeek: me.workoutsThisWeek,
      workoutGoal: week?.workoutGoal ?? user?.workoutsPerWeekGoal ?? 5,
      streak: me.streak,
      consistencyPct: me.consistency.score,
    })
  }, [me, weights, measurements, week, user])

  if (!user || !me) return <LoadingScreen />

  const weeklyChange = weights ? changeOver(weights, 7, today) : null
  const monthlyChange = weights ? changeOver(weights, 30, today) : null
  const comparison = weighInComparison(weights ?? [], today)

  return (
    <div className={styles.page}>
      {/*
        A primary tab, so no back arrow: there is nothing above this to go back
        to. The link out points sideways, to the group's version of the same
        idea, and is clearly labelled as somebody else's numbers.
      */}
      <header className={styles.intro}>
        <div className={styles.introText}>
          <h1 className={styles.heading}>My journey</h1>
          <p className={styles.sub}>Where you started, where you are</p>
        </div>
        <Link to="/group/progress" className={styles.link}>
          Group progress
        </Link>
      </header>

      {/*
        The hero this screen is named after: start, now, goal and how far along
        that is. It used to sit on Activity, where it competed with the day.

        One journey card, not two. This screen briefly carried both this and
        WeightJourney, which stated the same four numbers immediately below in a
        different layout — the kind of duplication that makes a reader wonder
        which one is authoritative.
      */}
      <GoalHero user={user} progress={me.progress} />

      {/* --- The week ---------------------------------------------------- */}
      <Section
        title="This week"
        action={
          <button className={styles.link} onClick={() => open('weight')}>
            Log weigh-in
          </button>
        }
      >
        <WeighInCard comparison={comparison} />
      </Section>

      {week ? (
        <Section title="Consistency">
          <WeekSnapshot week={week} consistency={me.consistency} />
        </Section>
      ) : null}

      <Section title="Trend">
        {series.length >= 2 ? (
          <Card>
            <TrendChart points={series} goal={user.targetWeightKg} />
            <dl className={styles.changes}>
              <div>
                <dt>This week</dt>
                <dd className={changeClass(weeklyChange)}>
                  {weeklyChange === null ? '—' : `${signed(weeklyChange)} kg`}
                </dd>
              </div>
              <div>
                <dt>This month</dt>
                <dd className={changeClass(monthlyChange)}>
                  {monthlyChange === null ? '—' : `${signed(monthlyChange)} kg`}
                </dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd className={changeClass(me.progress.changeKg)}>
                  {signed(me.progress.changeKg)} kg
                </dd>
              </div>
            </dl>
          </Card>
        ) : (
          <EmptyState
            title={EMPTY.noWeights.title}
            body={EMPTY.noWeights.body}
            action={
              <Button icon={<Plus size={16} strokeWidth={2.4} />} onClick={() => open('weight')}>
                Log your first weigh-in
              </Button>
            }
          />
        )}
      </Section>

      {/* --- Body --------------------------------------------------------- */}
      <Section title="Body">
        <BmiCard user={user} currentWeightKg={me.currentWeightKg} />
      </Section>

      <MeasurementSection entries={measurements ?? []} />

      {/* --- Energy ------------------------------------------------------- */}
      <Section title="Energy">
        <EnergyCard user={user} energy={me.energy} detailed />
      </Section>

      <Section title="What feeds these numbers">
        <Card className={styles.inputs}>
          <dl className={styles.inputList}>
            <div>
              <dt>Height</dt>
              <dd className="tnum">{user.heightCm} cm</dd>
            </div>
            <div>
              <dt>Current weight</dt>
              <dd className="tnum">{num(me.currentWeightKg, 1)} kg</dd>
            </div>
            <div>
              <dt>Goal weight</dt>
              <dd className="tnum">{num(user.targetWeightKg, 1)} kg</dd>
            </div>
          </dl>
          <p className={styles.note}>
            Change any of these — or your age, sex, goal or activity level — in your profile and
            every estimate here recalculates straight away.
          </p>
          <ButtonLink to="/profile" variant="secondary">
            Edit profile
          </ButtonLink>
        </Card>
      </Section>

      {/* --- The detail everything above was derived from ------------------ */}
      <Section title="What the records show">
        <Insights insights={insights} />
      </Section>

      <Section title="Weight history">
        <WeightHistory entries={weights ?? []} />
      </Section>

      <p className={styles.note}>
        Energy figures are estimates from your profile, not measurements. Only your weigh-ins,
        workouts and steps are things you actually recorded.
      </p>
    </div>
  )
}

function changeClass(value: number | null): string {
  if (value === null) return styles.flat
  if (value < -0.05) return styles.down
  if (value > 0.05) return styles.up
  return styles.flat
}
