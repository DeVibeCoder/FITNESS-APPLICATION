import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight } from 'lucide-react'
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
import { useAuth } from '@/context/AuthContext'
import { useLogSheet } from '@/context/LogSheetContext'
import { progressService } from '@/services'
import { todayKey, formatRange, startOfWeek, endOfWeek } from '@/utils/date'
import { duration, num, pct, signed } from '@/utils/format'
import styles from './Activity.module.css'

/**
 * My activity. Today, and only mine.
 *
 * What I trained, how far I walked, what I ate and drank, my habits, my
 * check-in, my weigh-in and my week so far. The group used to have a section
 * down at the bottom; it is gone. Everyone else's numbers belong to Group,
 * and having them here meant Activity answered two questions badly instead of
 * one well.
 *
 * Nutrition is a child of this screen rather than a sibling of it — the
 * calories card links into /activity/nutrition, the Activity tab stays lit,
 * and back comes here.
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

  if (!user || !snapshot || !me) return <LoadingScreen />

  return (
    <div className={styles.page}>
      {/*
        Title only, which means nothing at all on a phone: the app bar prints
        "My activity" already, and the subtitle underneath it was a sentence
        restating what the first section says in one word. The day starts at
        the top of the screen now.
      */}
      <PageHeader title="My activity" />

      <Section title="Today">
        <TodayStrip snapshot={snapshot} />
      </Section>

      <Section title="Today's workout">
        <TodayWorkoutCard snapshot={snapshot} onLog={() => open('workout')} />
      </Section>

      <Section title="Steps">
        <StepsCard steps={snapshot.steps} goal={snapshot.stepGoal} />
      </Section>

      {/*
        One card for calories and water, and one way into the detail. There
        used to be two sections here — "Calories & water" and "Nutrition" —
        both ending in a link called Details that went to the same screen.
      */}
      <Section title="Calories & water">
        <FuelCard snapshot={snapshot} />
        <Link to="/activity/nutrition" className={styles.detailLink}>
          View nutrition
          <ArrowRight size={15} strokeWidth={2.4} />
        </Link>
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

      <p className={styles.footnote}>
        Calories and energy figures are estimates from your profile, not measurements.
      </p>
    </div>
  )
}
