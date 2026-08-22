import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus } from 'lucide-react'
import { Card, Section } from '@/components/ui/Card'
import { Button, ButtonLink } from '@/components/ui/Button'
import { EmptyState, LoadingScreen } from '@/components/ui/EmptyState'
import { TrendChart } from '@/components/charts/TrendChart'
import { GoalHero } from '@/components/home/GoalHero'
import { WeighInCard } from '@/components/progress/WeighInCard'
import { WeightHistory } from '@/components/progress/WeightHistory'
import { BmiCard } from '@/components/progress/BmiCard'
import { EnergyCard } from '@/components/progress/EnergyCard'
import { WeekSnapshot } from '@/components/progress/WeekSnapshot'
import { Insights } from '@/components/progress/Insights'
import { useAuth } from '@/context/AuthContext'
import { useLogSheet } from '@/context/LogSheetContext'
import { progressService, weightService } from '@/services'
import { buildInsights } from '@/utils/insights'
import { changeOver, weighInComparison } from '@/utils/progress'
import { todayKey } from '@/utils/date'
import { num, signed } from '@/utils/format'
import { goalProfile } from '@/utils/goals'
import { EMPTY } from '@/data/messages'
import styles from './Progress.module.css'

/**
 * My progress. Mine, and nobody else's.
 *
 * Activity answers "what about today". This answers "is any of it working",
 * which is a different question asked on a different rhythm. Everyone else's
 * numbers live in Group → Progress; this screen used to carry a link across to
 * them, which was small but was the last thread making the two pages read as
 * two halves of one thing rather than as two answers to two questions.
 *
 * One scroll, no tabs. Journey, the body facts, the week, the trend, the
 * energy estimates, then the weekly weigh-ins the rest was derived from.
 *
 * Measurements are gone from this screen. They were four sections — a table, a
 * chart, a chart selector and a history — for something nobody in the group
 * was recording. The service and the model are untouched, so bringing them
 * back is a matter of rendering them again.
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

  const series = useMemo(
    () => (weights ?? []).map((entry) => ({ date: entry.date, value: entry.weightKg })),
    [weights],
  )

  const insights = useMemo(() => {
    if (!me) return []
    return buildInsights({
      weights: weights ?? [],
      // Measurements are no longer shown, so nothing is read for them either —
      // an insight about a waist nobody can see on this screen would be a
      // reference to a section that is not there.
      measurements: [],
      progress: me.progress,
      workoutsThisWeek: me.workoutsThisWeek,
      workoutGoal: week?.workoutGoal ?? user?.workoutsPerWeekGoal ?? 5,
      streak: me.streak,
      consistencyPct: me.consistency.score,
    })
  }, [me, weights, week, user])

  if (!user || !me) return <LoadingScreen />

  const weeklyChange = weights ? changeOver(weights, 7, today) : null
  const monthlyChange = weights ? changeOver(weights, 30, today) : null
  const comparison = weighInComparison(weights ?? [], today)
  const usesTarget = goalProfile(user.goal).usesTargetWeight

  return (
    <div className={styles.page}>
      {/*
        A primary tab, so no back arrow: there is nothing above this to go back
        to. And no sideways link either — this page is one person's.

        Plain text, not a card. It is a page title; the card directly beneath
        it is the thing worth looking at, and giving the heading its own
        surface put two competing objects at the top of the screen.
      */}
      <header className={styles.intro}>
        <div className={styles.introText}>
          <h1 className={styles.heading}>My journey</h1>
          <p className={styles.sub}>Where you started, where you are</p>
        </div>
      </header>

      {/*
        The hero this screen is named after, and the one card here that carries
        a photograph: start, now, goal and how far along that is.
      */}
      <GoalHero user={user} progress={me.progress} />

      {/*
        The same four numbers as words rather than as a diagram, plus the two
        the hero has no room for — height, and how the week moved.

        This is deliberately the only place the figures are listed. The hero
        above draws them; the card that used to sit at the bottom under "What
        feeds these numbers" listed three of them again with an edit link, and
        a reader had no way to tell which of the two was authoritative.
      */}
      <Section title="Your starting point">
        <Card className={styles.facts}>
          <dl className={styles.factList}>
            <div>
              <dt>Height</dt>
              <dd className="tnum">{user.heightCm} cm</dd>
            </div>
            <div>
              <dt>Starting weight</dt>
              <dd className="tnum">{num(user.startWeightKg, 1)} kg</dd>
            </div>
            <div>
              <dt>Current weight</dt>
              <dd className={`tnum ${styles.now}`}>{num(me.currentWeightKg, 1)} kg</dd>
            </div>
            {usesTarget ? (
              <div>
                <dt>Goal</dt>
                <dd className="tnum">{num(user.targetWeightKg, 1)} kg</dd>
              </div>
            ) : null}
            <div>
              <dt>Weekly change</dt>
              <dd className={`tnum ${changeClass(weeklyChange)}`}>
                {weeklyChange === null ? '—' : `${signed(weeklyChange)} kg`}
              </dd>
            </div>
            <div>
              <dt>Since you started</dt>
              <dd className={`tnum ${changeClass(me.progress.changeKg)}`}>
                {signed(me.progress.changeKg)} kg
              </dd>
            </div>
          </dl>
          <ButtonLink to="/profile" variant="secondary">
            Edit profile
          </ButtonLink>
        </Card>
      </Section>

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

      {/* --- Energy ------------------------------------------------------- */}
      <Section title="Energy">
        <EnergyCard user={user} energy={me.energy} detailed />
      </Section>

      <Section title="What the records show">
        <Insights insights={insights} />
      </Section>

      <Section title="Weekly weigh-ins">
        <WeightHistory entries={weights ?? []} weighInDay={user.weighInDay} />
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
