import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, Trophy } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, Section } from '@/components/ui/Card'
import { EmptyState, LoadingScreen } from '@/components/ui/EmptyState'
import { WorkoutTabs } from '@/components/workout/WorkoutTabs'
import { SessionCard } from '@/components/workout/SessionCard'
import { useAuth } from '@/context/AuthContext'
import { progressService, workoutService } from '@/services'
import type { WorkoutSession } from '@/models'
import {
  addDays,
  daysInMonth,
  formatDay,
  formatRange,
  fromDateKey,
  monthLabel,
  toDateKey,
  todayKey,
  weekDays,
  weekdayLabel,
  WEEKDAY_INITIALS,
} from '@/utils/date'
import { duration, num } from '@/utils/format'
import { EMPTY } from '@/data/messages'
import styles from './WorkoutHistory.module.css'

export function WorkoutHistory() {
  const { user } = useAuth()
  const today = todayKey()
  const [cursor, setCursor] = useState(() => {
    const now = fromDateKey(today)
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const [selected, setSelected] = useState<string>(today)

  const sessions = useLiveQuery(
    () => (user ? workoutService.sessionsForUser(user.id) : undefined),
    [user?.id],
  )
  const week = useLiveQuery(
    () => (user ? progressService.weeklySummary(user.id, selected) : undefined),
    [user?.id, selected],
  )
  const stats = useLiveQuery(
    () => (user ? workoutService.stats(user.id, weekDays(today)) : undefined),
    [user?.id, today],
  )
  const bests = useLiveQuery(
    () => (user ? workoutService.personalBests(user.id) : undefined),
    [user?.id],
  )
  const scheduledRestDays = useLiveQuery(async () => {
    // Which days of the visible month the plan calls a rest day, so the
    // calendar can tell "rested as planned" apart from "missed".
    if (!user) return new Set<string>()
    const enrollment = await workoutService.activeEnrollment(user.id)
    if (!enrollment) return new Set<string>()
    const plan = await workoutService.getPlan(enrollment.planId)
    if (!plan) return new Set<string>()
    const rest = new Set<string>()
    const total = daysInMonth(cursor.year, cursor.month)
    for (let dayOfMonth = 1; dayOfMonth <= total; dayOfMonth++) {
      const key = toDateKey(new Date(cursor.year, cursor.month, dayOfMonth))
      const dayNumber = workoutService.dayNumberFor(enrollment, key, plan.totalDays)
      const resolved = await workoutService.resolveDay(plan.id, dayNumber)
      if (resolved?.isRestDay) rest.add(key)
    }
    return rest
  }, [user?.id, cursor.year, cursor.month])

  const byDate = useMemo(() => {
    const map = new Map<string, WorkoutSession[]>()
    for (const session of sessions ?? []) {
      map.set(session.date, [...(map.get(session.date) ?? []), session])
    }
    return map
  }, [sessions])

  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor])

  const weekSessions = useMemo(() => {
    if (!week) return []
    return (sessions ?? [])
      .filter((s) => s.date >= week.weekStart && s.date <= week.weekEnd)
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
  }, [sessions, week])

  const bestDay = useMemo(() => {
    if (weekSessions.length === 0) return null
    const totals = new Map<string, number>()
    for (const session of weekSessions) {
      totals.set(session.date, (totals.get(session.date) ?? 0) + session.durationSec)
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]
  }, [weekSessions])

  if (!user || sessions === undefined) return <LoadingScreen />

  const shiftMonth = (delta: number) => {
    setCursor((current) => {
      const date = new Date(current.year, current.month + delta, 1)
      return { year: date.getFullYear(), month: date.getMonth() }
    })
  }

  const shiftWeek = (delta: number) => {
    const next = addDays(selected, delta * 7)
    setSelected(next)
    const date = fromDateKey(next)
    setCursor({ year: date.getFullYear(), month: date.getMonth() })
  }

  const atCurrentMonth =
    cursor.year === fromDateKey(today).getFullYear() &&
    cursor.month === fromDateKey(today).getMonth()
  const selectedSessions = byDate.get(selected) ?? []
  const avgWeekDuration = week && week.workouts > 0 ? week.durationSec / week.workouts : 0

  return (
    <div className={styles.page}>
      <PageHeader title="Logs" subtitle="Your workout journal" parent={{ label: 'Workout', to: '/workout' }} />
      <WorkoutTabs />

      {stats ? (
        <Section title="All time">
          <Card flush>
            <dl className={styles.stats}>
              <div>
                <dd className="tnum">{num(stats.total)}</dd>
                <dt>Workouts</dt>
              </div>
              <div>
                <dd className="tnum">{num(Math.round(stats.totalDurationSec / 60))}</dd>
                <dt>Minutes</dt>
              </div>
              <div>
                <dd className="tnum">{num(stats.totalCalories)}</dd>
                <dt>Est. kcal</dt>
              </div>
              <div>
                <dd className="tnum">{stats.currentStreak}</dd>
                <dt>Day streak</dt>
              </div>
              <div>
                <dd className="tnum">{stats.longestStreak}</dd>
                <dt>Best streak</dt>
              </div>
              <div>
                <dd className="tnum">{stats.thisMonth}</dd>
                <dt>This month</dt>
              </div>
            </dl>
          </Card>
        </Section>
      ) : null}

      <Card className={styles.calendarCard}>
        <div className={styles.calendarHead}>
          <button className={styles.monthButton} onClick={() => shiftMonth(-1)} aria-label="Previous month">
            <ChevronLeft size={18} strokeWidth={2.2} />
          </button>
          <p className={styles.monthLabel}>{monthLabel(cursor.year, cursor.month)}</p>
          <button
            className={styles.monthButton}
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
            disabled={atCurrentMonth}
          >
            <ChevronRight size={18} strokeWidth={2.2} />
          </button>
        </div>

        <div className={styles.weekdays} aria-hidden="true">
          {WEEKDAY_INITIALS.map((initial, index) => (
            <span key={index}>{initial}</span>
          ))}
        </div>

        <div className={styles.grid}>
          {grid.map((cell, index) =>
            cell === null ? (
              <span key={`pad-${index}`} className={styles.pad} />
            ) : (
              <button
                key={cell}
                className={[
                  styles.day,
                  byDate.has(cell) ? styles.dayDone : '',
                  scheduledRestDays?.has(cell) ? styles.dayRest : '',
                  cell === selected ? styles.daySelected : '',
                  cell === today ? styles.dayToday : '',
                  cell > today ? styles.dayFuture : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setSelected(cell)}
                aria-pressed={cell === selected}
                aria-label={`${formatDay(cell)}${
                  byDate.has(cell)
                    ? ', workout completed'
                    : scheduledRestDays?.has(cell)
                      ? ', rest day'
                      : ''
                }`}
              >
                <span className="tnum">{fromDateKey(cell).getDate()}</span>
              </button>
            ),
          )}
        </div>

        <ul className={styles.legend}>
          <li>
            <span className={`${styles.key} ${styles.keyDone}`} /> Workout
          </li>
          <li>
            <span className={`${styles.key} ${styles.keyRest}`} /> Rest day
          </li>
        </ul>
      </Card>

      <Section title={selected === today ? 'Today' : formatDay(selected)}>
        {selectedSessions.length > 0 ? (
          <div className={styles.sessionList}>
            {selectedSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                defaultOpen={selectedSessions.length === 1}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            compact
            title={
              selected > today
                ? 'Not yet'
                : scheduledRestDays?.has(selected)
                  ? 'Rest day'
                  : 'No workout that day'
            }
            body={
              selected > today
                ? 'This one is still ahead of you.'
                : scheduledRestDays?.has(selected)
                  ? 'The plan called for rest, and rest was taken.'
                  : 'Nothing was logged. It happens — the week is what counts.'
            }
          />
        )}
      </Section>

      {week ? (
        <Section
          title="Weekly summary"
          action={
            <span className={styles.weekNav}>
              <button onClick={() => shiftWeek(-1)} aria-label="Previous week">
                <ChevronLeft size={15} strokeWidth={2.4} />
              </button>
              <button onClick={() => setSelected(today)} className={styles.weekNow}>
                This week
              </button>
              <button
                onClick={() => shiftWeek(1)}
                aria-label="Next week"
                disabled={week.weekEnd >= today}
              >
                <ChevronRight size={15} strokeWidth={2.4} />
              </button>
            </span>
          }
        >
          <Card className={styles.weekCard}>
            <p className={styles.weekRange}>{formatRange(week.weekStart, week.weekEnd)}</p>
            <dl className={styles.weekStats}>
              <div>
                <dd className="tnum">{week.workouts}</dd>
                <dt>Workouts</dt>
              </div>
              <div>
                <dd className="tnum">{duration(week.durationSec)}</dd>
                <dt>Total time</dt>
              </div>
              <div>
                <dd className="tnum">{num(week.caloriesBurned, 1)}</dd>
                <dt>Est. kcal</dt>
              </div>
            </dl>
            {week.workouts > 0 ? (
              <p className={styles.weekExtra}>
                Average session <span className="tnum">{duration(avgWeekDuration)}</span>
                {bestDay ? (
                  <>
                    {' '}
                    · most active day <strong>{weekdayLabel(bestDay[0])}</strong>
                  </>
                ) : null}
              </p>
            ) : null}
          </Card>

          {weekSessions.length > 0 ? (
            <div className={styles.sessionList}>
              {weekSessions.map((session) => (
                <SessionCard key={session.id} session={session} showDate />
              ))}
            </div>
          ) : (
            <EmptyState compact title={EMPTY.noSessions.title} body={EMPTY.noSessions.body} />
          )}
        </Section>
      ) : null}

      {bests && bests.length > 0 ? (
        <Section title="Personal bests">
          <ul className={styles.bests}>
            {bests.map((best) => (
              <li key={best.label}>
                <Card className={styles.best}>
                  <span className={styles.bestIcon}>
                    <Trophy size={14} strokeWidth={2.2} />
                  </span>
                  <span className={styles.bestText}>
                    <span className={styles.bestLabel}>{best.label}</span>
                    <span className={styles.bestName}>{best.exerciseName}</span>
                  </span>
                  <span className={`${styles.bestValue} tnum`}>{best.value}</span>
                </Card>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  )
}

/** Month grid padded so the 1st lands under the right weekday (Sunday first). */
function buildMonthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1)
  const lead = first.getDay()
  const total = daysInMonth(year, month)
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let dayOfMonth = 1; dayOfMonth <= total; dayOfMonth++) {
    cells.push(toDateKey(new Date(year, month, dayOfMonth)))
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}
