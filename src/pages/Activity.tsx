import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Card'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { TodayStrip } from '@/components/home/TodayStrip'
import { TodayCard } from '@/components/home/TodayCard'
import { StepsCard } from '@/components/home/StepsCard'
import { FuelCard } from '@/components/home/FuelCard'
import { CheckInPrompt } from '@/components/home/CheckInPrompt'
import { TodayWorkoutCard } from '@/components/home/TodayWorkoutCard'
import { WeeklyWeighIn } from '@/components/home/WeeklyWeighIn'
import { GroupList } from '@/components/group/GroupList'
import { useAuth } from '@/context/AuthContext'
import { useLogSheet } from '@/context/LogSheetContext'
import { progressService } from '@/services'
import { todayKey, formatRange, startOfWeek, endOfWeek } from '@/utils/date'
import { duration, litres, num, pct, signed } from '@/utils/format'
import styles from './Activity.module.css'

/**
 * Today.
 *
 * The day you are actually having: what you trained, how far you walked, what
 * you ate and drank, the habits, the check-in, this week's weigh-in and a small
 * snapshot of the week so far. Deliberately not a second Progress page — that
 * is its own tab now, and duplicating it here is what made both feel vague.
 */
export function Activity() {
  const { user } = useAuth()
  const { open } = useLogSheet()
  const today = todayKey()

  const snapshot = useLiveQuery(
    () => (user ? progressService.dailySnapshot(user.id, today) : undefined),
    [user?.id, today],
  )
  const me = useLiveQuery(
    () => (user ? progressService.userSnapshot(user.id, today) : undefined),
    [user?.id, today],
  )
  const week = useLiveQuery(
    () => (user ? progressService.weeklySummary(user.id, today) : undefined),
    [user?.id, today],
  )
  const group = useLiveQuery(() => progressService.groupSnapshot(today), [today])

  if (!user || !snapshot || !me) return <LoadingScreen />

  return (
    <div className={styles.page}>
      {/*
        Titled Activity, not Today: the title has to match the tab that got you
        here, and on a phone this heading is hidden anyway because the app bar
        already prints it. The subtitle is what says which day this is about.
      */}
      <PageHeader title="Activity" subtitle="Today — what you have done so far" />

      {/*
        The goal hero moved to Progress, which is a primary tab now. Activity is
        today; the long arc of the journey is a different question asked on a
        different rhythm, and showing it in both places meant neither screen had
        an obvious job.
      */}
      <Section title="Today">
        <TodayStrip snapshot={snapshot} />
      </Section>

      <Section title="Today's workout">
        <TodayWorkoutCard snapshot={snapshot} onLog={() => open('workout')} />
      </Section>

      <Section title="Steps">
        <StepsCard steps={snapshot.steps} goal={snapshot.stepGoal} />
      </Section>

      <Section
        title="Calories & water"
        action={
          <Link to="/nutrition" className={styles.sectionLink}>
            Details
          </Link>
        }
      >
        <FuelCard snapshot={snapshot} />
      </Section>

      {/* §23: the nutrition numbers themselves, not a link to them. */}
      <Section
        title="Nutrition"
        action={
          <Link to="/nutrition" className={styles.sectionLink}>
            Details
          </Link>
        }
      >
        <dl className={styles.nutrition}>
          <div>
            <dt>Calories</dt>
            <dd className="tnum">
              {num(snapshot.nutrition.kcal)}
              <span className={styles.of}>/{num(snapshot.energy.target)}</span>
            </dd>
          </div>
          <div>
            <dt>Protein</dt>
            <dd className="tnum">
              {num(snapshot.nutrition.proteinG)}
              <span className={styles.of}>/{snapshot.energy.macros.proteinG} g</span>
            </dd>
          </div>
          <div>
            <dt>Water</dt>
            <dd className="tnum">
              {litres(snapshot.waterMl)}
              <span className={styles.of}>/{litres(snapshot.waterGoalMl)} L</span>
            </dd>
          </div>
        </dl>
      </Section>

      <Section title="Daily habits">
        <TodayCard
          snapshot={snapshot}
          streak={me.streak}
          streakAtRisk={me.streakAtRisk}
          changeKg={me.progress.changeKg}
          summaryOnly
        />
      </Section>

      <CheckInPrompt checkIn={snapshot.checkIn} onOpenFull={() => open('checkin')} />

      <WeeklyWeighIn />

      {week ? (
        <Section
          title="This week"
          action={
            <Link to="/review" className={styles.sectionLink}>
              Full review
            </Link>
          }
        >
          <dl className={styles.week}>
            <p className={styles.weekRange}>{formatRange(startOfWeek(today), endOfWeek(today))}</p>
            <div className={styles.weekGrid}>
              <div>
                <dt>Workouts</dt>
                <dd className="tnum">
                  {week.workouts}
                  <span className={styles.of}>/{week.workoutGoal}</span>
                </dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd className="tnum">{duration(week.durationSec)}</dd>
              </div>
              <div>
                <dt>Steps</dt>
                <dd className="tnum">{num(week.steps)}</dd>
              </div>
              <div>
                <dt>Weight</dt>
                <dd className="tnum">
                  {week.weightChangeKg === undefined ? '—' : `${signed(week.weightChangeKg)} kg`}
                </dd>
              </div>
              <div>
                <dt>Consistency</dt>
                <dd className="tnum">{pct(week.consistencyPct)}</dd>
              </div>
              <div>
                <dt>Toward goal</dt>
                <dd className="tnum">{pct(me.progress.pct)}</dd>
              </div>
            </div>
          </dl>
        </Section>
      ) : null}

      <Section
        title="Group activity"
        action={
          <Link to="/group" className={styles.sectionLink}>
            See all
          </Link>
        }
      >
        {group ? <GroupList members={group} currentUserId={user.id} /> : null}
      </Section>

      {/*
        No "go to Workout / Progress / Nutrition" list here. Everything it
        pointed at is either summarised above with its own Details link, or
        reachable from the section it belongs to. A page of redirects is a
        menu, not a screen.
      */}
      <p className={styles.footnote}>
        Calories and energy figures are estimates from your profile, not measurements.
      </p>
    </div>
  )
}

