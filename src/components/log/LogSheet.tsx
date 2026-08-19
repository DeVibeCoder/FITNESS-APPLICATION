import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, Scale, Footprints, GlassWater, UtensilsCrossed, HeartPulse, Dumbbell, Minus, Plus, PenLine, Camera, Quote } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { WeightEntryForm } from '@/components/progress/WeightEntryForm'
import { LogWorkoutForm } from './LogWorkoutForm'
import { AddFoodFlow } from '@/components/nutrition/AddFoodSheet'
import { Button } from '@/components/ui/Button'
import { Field, OptionGroup } from '@/components/ui/Field'
import { ProgressBar } from '@/components/ui/Progress'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { achievementService, checkinService, nutritionService, stepsService } from '@/services'
import { ENERGY_OPTIONS, MOOD_OPTIONS, SORENESS_OPTIONS } from '@/services/checkinService'
import type { DailyCheckIn } from '@/models'
import { todayKey } from '@/utils/date'
import { litres, num } from '@/utils/format'
import styles from './LogSheet.module.css'

type Mode = 'menu' | 'post' | 'story' | 'motivation' | 'workout' | 'weight' | 'steps' | 'water' | 'meal' | 'checkin'

const MENU: {
  mode: Mode
  label: string
  hint: string
  icon: typeof Scale
  primary?: boolean
  /** Which half of the sheet it belongs to. */
  group: 'share' | 'log'
  /** Built in a later phase; the sheet says so rather than pretending. */
  soon?: boolean
}[] = [
  // Sharing comes first now: this is a social app that also logs, not a
  // logger that also shares.
  { mode: 'post', label: 'Post', hint: 'Say something to the group', icon: PenLine, group: 'share', primary: true, soon: true },
  { mode: 'story', label: 'Story', hint: 'Gone in 24 hours', icon: Camera, group: 'share', soon: true },
  { mode: 'motivation', label: 'Motivation', hint: 'A quote or a video', icon: Quote, group: 'share', soon: true },
  { mode: 'workout', label: 'Workout', hint: 'From Home Workout or another app', icon: Dumbbell, group: 'log' },
  { mode: 'weight', label: 'Weight', hint: 'Log a weigh-in', icon: Scale, group: 'log' },
  { mode: 'steps', label: 'Steps', hint: "Today's count", icon: Footprints, group: 'log' },
  { mode: 'water', label: 'Water', hint: 'Add a glass', icon: GlassWater, group: 'log' },
  { mode: 'meal', label: 'Meal', hint: 'Food and macros', icon: UtensilsCrossed, group: 'log' },
  { mode: 'checkin', label: 'Check-in', hint: 'How you feel', icon: HeartPulse, group: 'log' },
]

const TITLES: Record<Mode, string> = {
  menu: 'Create',
  post: 'New post',
  story: 'New story',
  motivation: 'Share motivation',
  workout: "Log today's workout",
  weight: 'Log weigh-in',
  steps: 'Log steps',
  water: 'Water',
  meal: 'Add food',
  checkin: 'Daily check-in',
}

export function LogSheet({
  open,
  onClose,
  initialMode = 'menu',
}: {
  open: boolean
  onClose: () => void
  initialMode?: Mode
}) {
  const [mode, setMode] = useState<Mode>(initialMode)

  useEffect(() => {
    if (open) setMode(initialMode)
  }, [open, initialMode])

  const close = () => {
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={TITLES[mode]}
      subtitle={mode === 'menu' ? 'Share it with the group, or just write it down.' : undefined}
    >
      {mode !== 'menu' ? (
        <button className={styles.back} onClick={() => setMode('menu')}>
          <ChevronLeft size={16} strokeWidth={2.4} />
          All options
        </button>
      ) : null}

      {mode === 'menu' ? <Menu onPick={setMode} /> : null}
      {mode === 'post' || mode === 'story' || mode === 'motivation' ? (
        <ComingSoon mode={mode} />
      ) : null}
      {mode === 'workout' ? <LogWorkoutForm onDone={close} /> : null}
      {mode === 'weight' ? <WeightEntryForm onDone={close} /> : null}
      {mode === 'steps' ? <StepsForm onDone={close} /> : null}
      {mode === 'water' ? <WaterForm onDone={close} /> : null}
      {mode === 'meal' ? <AddFoodFlow onDone={close} /> : null}
      {mode === 'checkin' ? <CheckInForm onDone={close} /> : null}
    </Sheet>
  )
}

const GROUP_LABEL: Record<'share' | 'log', string> = {
  share: 'Share with the group',
  log: 'Log for yourself',
}

function Menu({ onPick }: { onPick: (mode: Mode) => void }) {
  return (
    <>
      {(['share', 'log'] as const).map((group) => (
        <section key={group} className={styles.menuGroup}>
          <p className="eyebrow">{GROUP_LABEL[group]}</p>
          <ul className={styles.menu}>
            {MENU.filter((item) => item.group === group).map(
              ({ mode, label, hint, icon: Icon, primary, soon }) => (
                <li key={mode}>
                  <button
                    className={[styles.menuItem, primary ? styles.menuItemPrimary : '']
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => onPick(mode)}
                  >
                    <span className={styles.menuIcon}>
                      <Icon size={19} strokeWidth={1.9} />
                    </span>
                    <span className={styles.menuText}>
                      <span className={styles.menuLabel}>{label}</span>
                      <span className={styles.menuHint}>{hint}</span>
                    </span>
                    {soon ? <span className={styles.soon}>Soon</span> : null}
                  </button>
                </li>
              ),
            )}
          </ul>
        </section>
      ))}
    </>
  )
}

/**
 * The creation flows that do not exist yet.
 *
 * Saying so plainly beats a form that looks real and silently does nothing.
 * Posting, stories and shared motivation are Phase 4; what already works —
 * workouts, weigh-ins, steps, water, meals, check-ins — is right below.
 */
function ComingSoon({ mode }: { mode: 'post' | 'story' | 'motivation' }) {
  const copy = {
    post: {
      title: 'Posting is being built',
      body: 'The feed and its seeded posts are here so you can see the shape of it. Writing your own arrives with the creation flow.',
    },
    story: {
      title: 'Stories are being built',
      body: 'The rail on Home is live and stories already expire after 24 hours. Capturing one is the next piece.',
    },
    motivation: {
      title: 'Sharing motivation is being built',
      body: 'Adding a video to the weekly rotation already works from the Motivation screen.',
    },
  }[mode]

  return (
    <div className={styles.soonPanel}>
      <p className={styles.soonTitle}>{copy.title}</p>
      <p className={styles.soonBody}>{copy.body}</p>
    </div>
  )
}

// --- Steps -----------------------------------------------------------------

function StepsForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const today = todayKey()

  const current = useLiveQuery(
    () => (user ? stepsService.forDay(user.id, today) : undefined),
    [user?.id, today],
  )

  useEffect(() => {
    if (current !== undefined && current > 0 && !value) setValue(String(current))
  }, [current, value])

  if (!user) return null

  const save = async () => {
    const steps = Number.parseInt(value, 10)
    if (!Number.isFinite(steps) || steps < 0 || steps > 200_000) {
      show('That step count looks off.', 'error')
      return
    }
    setSaving(true)
    const result = await guard(async () => {
      await stepsService.set({ userId: user.id, date: today, steps })
      await achievementService.evaluate(user.id)
    })
    setSaving(false)
    if (result !== undefined) {
      show('Steps updated.', 'success')
      onDone()
    }
  }

  const entered = Number.parseInt(value, 10) || 0

  return (
    <>
      <Field
        label="Steps today"
        type="number"
        inputMode="numeric"
        value={value}
        placeholder="0"
        onChange={(event) => setValue(event.target.value)}
        hint={`Goal: ${num(user.stepGoal)} steps`}
      />
      <div>
        <ProgressBar value={entered} max={user.stepGoal} label="Progress to step goal" />
        <p className={styles.meta}>
          {entered >= user.stepGoal
            ? 'Goal hit. Nice.'
            : `${num(Math.max(0, user.stepGoal - entered))} to go`}
        </p>
      </div>
      <Button size="lg" block onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save steps'}
      </Button>
    </>
  )
}

// --- Water -----------------------------------------------------------------

function WaterForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth()
  const { guard } = useToast()
  const today = todayKey()
  const ml = useLiveQuery(
    () => (user ? nutritionService.waterForDay(user.id, today) : undefined),
    [user?.id, today],
  )

  if (!user) return null
  const goalMl = user.waterGoalL * 1000
  const current = ml ?? 0

  return (
    <>
      <div className={styles.waterReadout}>
        <span className={`${styles.waterValue} tnum`}>{litres(current)}</span>
        <span className={styles.waterUnit}>/ {user.waterGoalL} L</span>
      </div>
      <ProgressBar value={current} max={goalMl} label="Water progress" />

      <div className={styles.waterButtons}>
        {[250, 500].map((amount) => (
          <Button
            key={amount}
            variant="secondary"
            size="lg"
            icon={<Plus size={16} strokeWidth={2.4} />}
            onClick={() => guard(() => nutritionService.addWater(user.id, today, amount))}
          >
            {amount} ml
          </Button>
        ))}
      </div>

      <Button
        variant="ghost"
        icon={<Minus size={16} strokeWidth={2.4} />}
        onClick={() => guard(() => nutritionService.removeLastWater(user.id, today))}
        disabled={current === 0}
      >
        Undo last
      </Button>

      <Button size="lg" block onClick={onDone}>
        Done
      </Button>
    </>
  )
}

// --- Check-in --------------------------------------------------------------

export function CheckInForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const today = todayKey()
  const existing = useLiveQuery(
    () => (user ? checkinService.forDay(user.id, today) : undefined),
    [user?.id, today],
  )

  const [energy, setEnergy] = useState<DailyCheckIn['energy']>(3)
  const [mood, setMood] = useState<DailyCheckIn['mood']>(4)
  const [soreness, setSoreness] = useState<DailyCheckIn['soreness']>('none')
  const [note, setNote] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!existing || loaded) return
    setEnergy(existing.energy)
    setMood(existing.mood)
    setSoreness(existing.soreness)
    setNote(existing.note ?? '')
    setLoaded(true)
  }, [existing, loaded])

  if (!user) return null

  const save = async () => {
    setSaving(true)
    const result = await guard(() =>
      checkinService.save({ userId: user.id, date: today, energy, mood, soreness, note: note.trim() || undefined }),
    )
    setSaving(false)
    if (result !== undefined) {
      show(existing ? 'Check-in updated.' : 'Checked in. Have a good one.', 'success')
      onDone()
    }
  }

  return (
    <>
      <OptionGroup label="Energy" value={energy} options={ENERGY_OPTIONS} onChange={setEnergy} />
      <OptionGroup
        label="Mood"
        value={mood}
        variant="emoji"
        options={MOOD_OPTIONS.map((m) => ({ value: m.value, label: m.label, emoji: m.emoji }))}
        onChange={setMood}
      />
      <OptionGroup label="Soreness" value={soreness} options={SORENESS_OPTIONS} onChange={setSoreness} />
      <Field
        label="Anything to add?"
        value={note}
        placeholder="Optional"
        maxLength={140}
        onChange={(event) => setNote(event.target.value)}
      />
      <Button size="lg" block onClick={save} disabled={saving}>
        {saving ? 'Saving…' : existing ? 'Update check-in' : 'Check in'}
      </Button>
    </>
  )
}
