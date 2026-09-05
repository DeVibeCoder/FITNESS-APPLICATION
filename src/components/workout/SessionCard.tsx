import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, ChevronDown, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { achievementService, workoutService } from '@/services'
import { useToast } from '@/context/ToastContext'
import { summarise } from '@/components/log/exerciseSummary'
import { db } from '@/lib/db'
import type { SetResult, WorkoutSession } from '@/models'
import type { ResolvedExercise } from '@/services/workoutService'
import { workoutData } from '@/services/workoutData'
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
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { isOwner } = useAuth()
  const { show, guard } = useToast()

  /*
   * Deleting takes the session and only what belonged to it — its sets, its
   * exercises. The ownership guard in the service is what actually enforces
   * whose it is; this only decides whether to offer the button.
   */
  const remove = async () => {
    setDeleting(true)
    const done = await guard(async () => {
      await workoutData.remove(session.id)
      // The streak and the awards are derived from what is left, so they are
      // re-read rather than adjusted.
      await achievementService.evaluate(session.userId, { announce: false })
      return true
    })
    setDeleting(false)
    if (!done) return
    setConfirmDelete(false)
    show('Workout deleted.', 'success')
  }

  /** Whether this session actually recorded anything beyond the summary. */
  const setCount = useLiveQuery(
    () => db.setResults.where('sessionId').equals(session.id).count(),
    [session.id],
  )
  /*
   * The exercises somebody typed in, which are a different kind of detail from
   * a player's set-by-set results — and the far more common one now. Either
   * earns the expander; neither is invented for a session that has neither.
   */
  const logged = useLiveQuery(() => workoutData.exercisesFor(session.id), [session.id])
  const hasLogged = (logged?.length ?? 0) > 0
  const hasDetail = (setCount ?? 0) > 0 || hasLogged

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
        The exercises as they were written down. One line each, in the order
        they were entered, saying only what that kind of exercise has: sets and
        reps for lifting, time and distance for cardio.
      */}
      {open && hasLogged ? (
        <ul className={styles.logged}>
          {logged!.map((exercise) => (
            <li key={exercise.id} className={styles.loggedRow}>
              <span className={styles.loggedName}>{exercise.name}</span>
              <span className={styles.loggedDetail}>{summarise(exercise)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        Anything typed by hand can be corrected or removed by whoever wrote it
        — a mistyped duration is likely on both routes. Player sessions were
        recorded set by set and have nothing sensible to re-enter, so they get
        neither control.
      */}
      {(session.loggedVia === 'quick_log' || session.loggedVia === 'manual') &&
      isOwner(session.userId) ? (
        <div className={styles.editRow}>
          <button className={styles.edit} onClick={() => setEditing(true)}>
            <Pencil size={13} strokeWidth={2.2} />
            Edit this log
          </button>
          <button
            className={`${styles.edit} ${styles.delete}`}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={13} strokeWidth={2.2} />
            Delete
          </button>
        </div>
      ) : null}

      <Sheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this workout?"
      >
        <p className={styles.confirmText}>
          It comes off your history, your week and your streak. Nothing else is touched, and this
          cannot be undone.
        </p>
        <div className={styles.confirmRow}>
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
            Keep it
          </Button>
          <Button variant="danger" onClick={remove} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </Sheet>

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
