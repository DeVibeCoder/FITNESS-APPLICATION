import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, ChevronDown, SkipForward } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { workoutService } from '@/services'
import { db } from '@/lib/db'
import type { SetResult, WorkoutSession } from '@/models'
import type { ResolvedExercise } from '@/services/workoutService'
import { formatClock, formatDay } from '@/utils/date'
import { duration, num } from '@/utils/format'
import { Sheet } from '@/components/ui/Sheet'
import { LogWorkoutForm } from '@/components/log/LogWorkoutForm'
import { useAuth } from '@/context/AuthContext'
import { workoutAppLabel } from '@/data/workoutApps'
import styles from './SessionCard.module.css'

const DIFFICULTY_LABEL: Record<string, string> = {
  hard: 'Hard',
  just_right: 'Just right',
  easy: 'Easy',
}

interface SessionCardProps {
  session: WorkoutSession
  showDate?: boolean
  /** Collapsed by default in lists; expanded when it is the only thing shown. */
  defaultOpen?: boolean
}

/**
 * One entry in the workout journal.
 *
 * Summary first, always: date, which app, the plan and day, how long, how many
 * calories, how it felt. That is the whole record for a workout logged from
 * another app, and asking for sets and reps would mean asking for data the
 * external app already owns.
 *
 * Older sessions recorded by the built-in player do have a set-by-set
 * breakdown. Those — and only those — get a "View details" expander, so the
 * detail is available without every log pretending to have it.
 */
export function SessionCard({ session, showDate, defaultOpen = false }: SessionCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [editing, setEditing] = useState(false)
  const { isOwner } = useAuth()

  /** Whether this session actually recorded anything beyond the summary. */
  const setCount = useLiveQuery(
    () => db.setResults.where('sessionId').equals(session.id).count(),
    [session.id],
  )
  const hasDetail = (setCount ?? 0) > 0

  const detail = useLiveQuery(
    () => (open && hasDetail ? workoutService.detail(session.id) : undefined),
    [open, hasDetail, session.id],
  )

  const abandoned = session.status === 'abandoned'

  return (
    <Card flush className={styles.card}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <p className={styles.when}>
            {showDate ? `${formatDay(session.date)}, ` : ''}
            {formatClock(session.completedAt ?? session.startedAt)}
          </p>
          {/* The plan and day is what a log is about; the workout name follows. */}
          <p className={styles.name}>
            {session.dayNumber ? `Day ${session.dayNumber} · ` : ''}
            {session.planName || session.name}
          </p>
          <div className={styles.tags}>
            {/* §41: history must say which app the workout actually came from. */}
            <span className={`${styles.tag} ${styles.app}`}>
              {workoutAppLabel(session.source, session.sourceName)}
            </span>
            {abandoned ? <span className={`${styles.tag} ${styles.abandoned}`}>Unfinished</span> : null}
            {session.difficulty ? (
              <span className={`${styles.tag} ${styles[session.difficulty]}`}>
                {DIFFICULTY_LABEL[session.difficulty]}
              </span>
            ) : null}
          </div>
        </div>
        <div className={styles.headStats}>
          <span className={`${styles.time} tnum`}>{duration(session.durationSec)}</span>
          <span className={styles.kcal}>
            est. <span className="tnum">{num(session.caloriesKcal, 1)}</span> kcal
          </span>
        </div>
      </div>

      {session.note ? <p className={styles.note}>“{session.note}”</p> : null}

      {/*
        Only sessions the built-in player recorded have a set-by-set
        breakdown. Everything logged from another app is complete as it stands,
        so it gets no expander to open on nothing.
      */}
      {hasDetail ? (
        <div className={styles.detailRow}>
          <button
            className={styles.detailToggle}
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
          >
            {open ? 'Hide details' : 'View details'}
            <ChevronDown
              size={15}
              strokeWidth={2.2}
              className={[styles.chevron, open ? styles.chevronOpen : ''].filter(Boolean).join(' ')}
            />
          </button>
        </div>
      ) : null}

      {/*
        Quick logs are typed off another app's summary screen, so a mistyped
        duration is likely and correcting it should be easy. Player sessions
        are recorded set by set and have nothing sensible to re-enter.
      */}
      {session.loggedVia === 'quick_log' && isOwner(session.userId) ? (
        <div className={styles.editRow}>
          <button className={styles.edit} onClick={() => setEditing(true)}>
            <Pencil size={13} strokeWidth={2.2} />
            Edit this log
          </button>
        </div>
      ) : null}

      <Sheet
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit workout"
        subtitle="Correct anything that went in wrong."
      >
        {editing ? (
          <LogWorkoutForm session={session} onDone={() => setEditing(false)} />
        ) : null}
      </Sheet>

      {open ? (
        <div className={styles.detail}>
          {detail === undefined ? (
            <p className={styles.loading}>Loading…</p>
          ) : detail?.day && detail.day.exercises.length > 0 ? (
            <ul className={styles.exercises}>
              {detail.day.exercises.map((item) => (
                <ExerciseRow
                  key={item.id}
                  item={item}
                  results={detail.results.filter((row) => row.workoutExerciseId === item.id)}
                />
              ))}
            </ul>
          ) : (
            <p className={styles.loading}>
              No exercise breakdown was recorded for this session.
            </p>
          )}
        </div>
      ) : null}
    </Card>
  )
}

function ExerciseRow({ item, results }: { item: ResolvedExercise; results: SetResult[] }) {
  const completed = results.filter((row) => row.completed)
  const skipped = results.some((row) => row.skipped)
  const spec = `${item.sets} × ${item.durationSec ? `${item.durationSec}s` : item.reps}`

  // Prefer what actually happened; fall back to what was prescribed.
  const status = skipped
    ? 'skipped'
    : results.length === 0
      ? 'unrecorded'
      : completed.length >= item.sets
        ? 'done'
        : 'partial'

  return (
    <li className={`${styles.exercise} ${styles[status]}`}>
      <span className={styles.exerciseMark} aria-hidden="true">
        {status === 'done' ? (
          <Check size={11} strokeWidth={3.2} />
        ) : status === 'skipped' ? (
          <SkipForward size={10} strokeWidth={2.6} />
        ) : null}
      </span>
      <span className={styles.exerciseName}>{item.exercise.name}</span>
      <span className={styles.exerciseSpec}>
        {status === 'skipped' ? (
          'Skipped'
        ) : status === 'partial' ? (
          <>
            <span className="tnum">{completed.length}</span> of{' '}
            <span className="tnum">{item.sets}</span> sets
          </>
        ) : (
          <span className="tnum">{spec}</span>
        )}
      </span>
    </li>
  )
}
