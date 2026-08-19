import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Flame, Lock } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Card, Section } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { TrendChart } from '@/components/charts/TrendChart'
import { achievementService, progressService, workoutService } from '@/services'
import type { UserSnapshot } from '@/services/progressService'
import { ACTIVITY_LEVELS, ageFrom, goalLabel } from '@/utils/calories'
import { goalProfile, movementTowardGoal } from '@/utils/goals'
import { duration, num, signed } from '@/utils/format'
import { formatDay } from '@/utils/date'
import { EMPTY } from '@/data/messages'
import styles from './ProfileView.module.css'

const DIFFICULTY_LABEL: Record<string, string> = {
  hard: 'Hard',
  just_right: 'Just right',
  easy: 'Easy',
}

interface ProfileViewProps {
  snapshot: UserSnapshot
  /** Rendered under the header — edit controls for the owner. */
  headerAction?: React.ReactNode
  /**
   * 'member' is the read-only view of someone else. The group is meant to see
   * each other's progress — weight, goal, streak, consistency, sessions — but
   * not each other's body metrics or personal calorie and macro targets.
   */
  variant?: 'self' | 'member'
}

/** One profile layout, used for your own page and for viewing a group member. */
export function ProfileView({ snapshot, headerAction, variant = 'self' }: ProfileViewProps) {
  const isSelf = variant === 'self'
  const { user, progress, bmi, energy } = snapshot

  const weights = useLiveQuery(() => progressService.weightSeries(user.id, 120), [user.id])
  const sessions = useLiveQuery(() => workoutService.sessionsForUser(user.id), [user.id])
  const achievements = useLiveQuery(() => achievementService.listForUser(user.id), [user.id])

  const series = (weights ?? []).map((row) => ({ date: row.date, value: row.weightKg }))
  const recent = (sessions ?? []).slice(0, 4)
  const activity =
    ACTIVITY_LEVELS.find((level) => level.value === user.activityLevel)?.label ?? user.activityLevel

  const profile = goalProfile(user.goal)
  const usesTarget = profile.usesTargetWeight
  /**
   * Whether the scale moving is good news depends on the goal. Someone
   * building muscle gaining a kilo is progress, not a setback, and colouring
   * it red would be telling them off for succeeding.
   */
  const movedWell = movementTowardGoal(user, snapshot.currentWeightKg) > 0

  return (
    <div className={styles.page}>
      {/*
        Identity first: who this is and what they are working on. The journey
        line reads start → now, with the target underneath, so a glance answers
        "how is this person doing" without any arithmetic.
      */}
      <header className={`glass ${styles.head}`}>
        <Avatar user={user} size="xl" ring={snapshot.streak >= 7} />
        <div className={styles.headText}>
          <h2 className={styles.name}>{user.name}</h2>
          <p className={styles.goal}>{goalLabel(user.goal)}</p>

          <p className={styles.journey}>
            <span className="tnum">{num(user.startWeightKg, 1)}</span>
            <span className={styles.arrow} aria-label="to">
              →
            </span>
            <span className={`${styles.now} tnum`}>{num(snapshot.currentWeightKg, 1)}</span>
            <span className={styles.unit}>kg</span>
          </p>
          {usesTarget ? (
            <p className={styles.target}>
              <span className="tnum">{num(user.targetWeightKg, 1)} kg</span> goal
            </p>
          ) : (
            <p className={styles.target}>{profile.tagline}</p>
          )}

          <div className={styles.badges}>
            {snapshot.streak > 0 ? (
              <span className={styles.streak}>
                <Flame size={12} strokeWidth={2.5} />
                {snapshot.streak} day streak
              </span>
            ) : null}
            <span className={styles.badge}>
              <span className="tnum">{snapshot.achievements}</span> achievements
            </span>
            {isSelf ? <span className={styles.badge}>{activity}</span> : null}
          </div>
        </div>
      </header>

      {headerAction ? <div className={styles.headerAction}>{headerAction}</div> : null}

      <Section title="At a glance">
        <div className={styles.stats}>
          <Stat label="Current" value={`${num(snapshot.currentWeightKg, 1)} kg`} />
          <Stat label="Started" value={`${num(user.startWeightKg, 1)} kg`} />
          {/* A weight target is meaningless for "get fitter" — omit rather than fake one. */}
          {usesTarget ? <Stat label="Goal" value={`${num(user.targetWeightKg, 1)} kg`} /> : null}
          <Stat
            label="Change"
            value={`${signed(progress.changeKg)} kg`}
            tone={movedWell ? 'good' : undefined}
          />
          {isSelf ? (
            <>
              <Stat label="BMI" value={num(bmi.value, 1)} hint={bmi.label} />
              <Stat
                label="Height"
                value={`${user.heightCm} cm`}
                hint={`${ageFrom(user.birthDate)} years`}
              />
            </>
          ) : (
            <>
              <Stat label="Streak" value={`${snapshot.streak} days`} hint="current" />
              <Stat
                label="This week"
                value={`${snapshot.consistency.score}%`}
                hint="consistency"
              />
            </>
          )}
        </div>
      </Section>

      {isSelf ? (
        <Section title="Daily targets">
          <Card className={styles.energy}>
            <div className={styles.energyRow}>
              <div>
                <p className={styles.energyLabel}>Calories</p>
                <p className={`${styles.energyValue} tnum`}>{num(energy.target)}</p>
              </div>
              <ul className={styles.macros}>
                <li>
                  <span>Protein</span>
                  <span className="tnum">{energy.macros.proteinG} g</span>
                </li>
                <li>
                  <span>Carbs</span>
                  <span className="tnum">{energy.macros.carbsG} g</span>
                </li>
                <li>
                  <span>Fat</span>
                  <span className="tnum">{energy.macros.fatG} g</span>
                </li>
              </ul>
            </div>
            <dl className={styles.energyMeta}>
              <div>
                <dt>BMR</dt>
                <dd className="tnum">{num(energy.bmr)}</dd>
              </div>
              <div>
                <dt>TDEE</dt>
                <dd className="tnum">{num(energy.tdee)}</dd>
              </div>
              <div>
                <dt>Adjustment</dt>
                <dd className="tnum">{signed(energy.adjustment, 0)}</dd>
              </div>
            </dl>
            <p className={styles.note}>
              Estimates from height, weight, age and activity — a starting point to adjust from, not a
              prescription.
            </p>
          </Card>
        </Section>
      ) : null}

      <Section title="Weight trend">
        {series.length >= 2 ? (
          <Card>
            <TrendChart points={series} goal={user.targetWeightKg} />
          </Card>
        ) : (
          <EmptyState compact title={EMPTY.noWeights.title} body={EMPTY.noWeights.body} />
        )}
      </Section>

      <Section title="Recent sessions">
        {recent.length > 0 ? (
          <ul className={styles.sessions}>
            {/*
              Deliberately a summary: completion, name, day, duration, estimated
              calories and how it felt. Set-by-set results stay private to the
              owner's own history.
            */}
            {recent.map((session) => (
              <li key={session.id}>
                <div className={styles.sessionText}>
                  <p className={styles.sessionName}>
                    {session.dayNumber ? `Day ${session.dayNumber} · ` : ''}
                    {session.name}
                  </p>
                  <p className={styles.sessionDate}>
                    {formatDay(session.date)}
                    {session.difficulty ? ` · ${DIFFICULTY_LABEL[session.difficulty]}` : ''}
                  </p>
                </div>
                <span className={styles.sessionStat}>
                  <span className="tnum">{duration(session.durationSec)}</span>
                  <span className={styles.sessionKcal}>
                    est. <span className="tnum">{num(session.caloriesKcal, 1)}</span> kcal
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact title={EMPTY.noSessions.title} body={EMPTY.noSessions.body} />
        )}
      </Section>

      <Section
        title="Achievements"
        action={
          isSelf ? (
            <Link to="/achievements" className={styles.sectionLink}>
              See all
            </Link>
          ) : undefined
        }
      >
        <ul className={styles.achievements}>
          {(achievements ?? []).map((achievement) => (
            <li
              key={achievement.key}
              className={[styles.achievement, achievement.unlockedAt ? '' : styles.locked]
                .filter(Boolean)
                .join(' ')}
              title={achievement.description}
            >
              <span className={styles.achievementIcon} aria-hidden="true">
                {achievement.unlockedAt ? achievement.icon : <Lock size={14} strokeWidth={2} />}
              </span>
              <span className={styles.achievementTitle}>{achievement.title}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'good'
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={[styles.statValue, tone === 'good' ? styles.good : ''].join(' ')}>
        <span className="tnum">{value}</span>
      </span>
      {hint ? <span className={styles.statHint}>{hint}</span> : null}
    </div>
  )
}
