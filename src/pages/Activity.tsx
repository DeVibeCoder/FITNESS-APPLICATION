import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight, Share2 } from 'lucide-react'
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
import { caloriesShare, stepsShare, waterShare, workoutShare } from '@/utils/shareText'
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
 * Two halves, in the order the day is actually lived: everything about today
 * first, then the week. The weekly weigh-in sits in the second half rather
 * than among the daily cards — it is not a thing to do today, it is a thing to
 * do this week, and having it between the check-in and the week summary made
 * the page read as one undifferentiated list of chores.
 *
 * Nutrition is a child of this screen rather than a sibling of it — the
 * calories card links into /activity/nutrition, the Activity tab stays lit,
 * and back comes here.
 *
 * Sharing starts here, on the record itself. Each section that holds a number
 * worth saying out loud carries a Share, which opens the post composer with
 * the sentence already written. The composer never learns what a workout is;
 * this screen already knows, and it is where somebody is standing when they
 * decide the number is worth sharing.
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

  // The most recent thing finished today, if anything was.
  const done = snapshot.completedSessions.at(-1)

  return (
    <div className={styles.page}>
      {/*
        Title only, which means nothing at all on a phone: the app bar prints
        "My activity" already, and the subtitle underneath it was a sentence
        restating what the first section says in one word. The day starts at
        the top of the screen now.
      */}
      <PageHeader title="My activity" />

      {/* --- Today -------------------------------------------------------- */}

      <Section title="Today">
        <TodayStrip snapshot={snapshot} />
      </Section>

      <Section
        title="Today's workout"
        action={
          done ? (
            <ShareAction
              label="Share today's workout"
              onShare={() =>
                open('post', {
                  text: workoutShare(
                    done.planName || done.name,
                    done.durationSec,
                    done.caloriesKcal,
                  ),
                })
              }
            />
          ) : null
        }
      >
        <TodayWorkoutCard snapshot={snapshot} onLog={() => open('workout')} />
      </Section>

      <Section
        title="Steps"
        action={
          snapshot.steps > 0 ? (
            <ShareAction
              label="Share today's steps"
              onShare={() =>
                open('post', { text: stepsShare(snapshot.steps, snapshot.stepGoal) })
              }
            />
          ) : null
        }
      >
        <StepsCard steps={snapshot.steps} goal={snapshot.stepGoal} />
      </Section>

      {/*
        One card for calories and water, and one way into the detail. There
        used to be two sections here — "Calories & water" and "Nutrition" —
        both ending in a link called Details that went to the same screen.
      */}
      <Section
        title="Calories & water"
        action={
          snapshot.nutrition.kcal > 0 || snapshot.waterMl > 0 ? (
            <ShareAction
              label="Share today's calories and water"
              onShare={() =>
                open('post', {
                  text: [
                    snapshot.nutrition.kcal > 0
                      ? caloriesShare(snapshot.nutrition.kcal, snapshot.energy.target)
                      : '',
                    snapshot.waterMl > 0
                      ? waterShare(snapshot.waterMl, snapshot.waterGoalMl)
                      : '',
                  ]
                    .filter(Boolean)
                    .join('\n'),
                })
              }
            />
          ) : null
        }
      >
        <FuelCard snapshot={snapshot} />
        <Link to="/activity/nutrition" className={styles.detailLink}>
          View nutrition
          <ArrowRight size={15} strokeWidth={2.4} />
        </Link>
      </Section>

      <Section title="Habits & check-in">
        <TodayCard
          snapshot={snapshot}
          streak={me.streak}
          streakAtRisk={me.streakAtRisk}
          changeKg={me.progress.changeKg}
          summaryOnly
        />
        <CheckInPrompt checkIn={snapshot.checkIn} onOpenFull={() => open('checkin')} />
      </Section>

      {/* --- This week ---------------------------------------------------- */}

      <Section
        title="This week"
        action={
          <Link to="/review" className={styles.sectionLink}>
            Full review
          </Link>
        }
      >
        {week ? (
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
        ) : null}

        <WeeklyWeighIn onShare={(text) => open('post', { text })} />
        {/*
          The one way across to Progress. Activity answers "what about today";
          the weigh-in above is the point at which that turns into "is any of
          it working", which is a different screen — and it was previously
          reachable from here only through the bottom bar.
        */}
        <Link to="/progress" className={styles.detailLink}>
          View your progress
          <ArrowRight size={15} strokeWidth={2.4} />
        </Link>
      </Section>

      <p className={styles.footnote}>
        Calories and energy figures are estimates from your profile, not measurements.
      </p>
    </div>
  )
}

/**
 * The Share that sits on a section heading.
 *
 * Deliberately quiet — a small control beside the label rather than a button
 * on the card. Sharing is something you occasionally decide to do about a
 * number, not the reason the number is on screen.
 */
function ShareAction({ label, onShare }: { label: string; onShare: () => void }): ReactNode {
  return (
    <button className={styles.shareAction} onClick={onShare} aria-label={label}>
      <Share2 size={14} strokeWidth={2.3} />
      Share
    </button>
  )
}
