import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, Scale, Footprints, GlassWater, UtensilsCrossed, HeartPulse, Dumbbell, Minus, Plus, PenLine, Camera, Quote } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { WeightEntryForm } from '@/components/progress/WeightEntryForm'
import { LogWorkoutForm } from './LogWorkoutForm'
import { AddFoodFlow } from '@/components/nutrition/AddFoodSheet'
import { PostComposer } from '@/components/social/PostComposer'
import { StoryComposer } from '@/components/social/StoryComposer'
import { MotivationComposer } from '@/components/social/MotivationComposer'
import { Button } from '@/components/ui/Button'
import { Field, OptionGroup } from '@/components/ui/Field'
import { ProgressBar } from '@/components/ui/Progress'
import { useAuth } from '@/context/AuthContext'
import type { LogDraft } from '@/context/LogSheetContext'
import { useToast } from '@/context/ToastContext'
import { achievementService, checkinService, nutritionService, stepsService } from '@/services'
import { ENERGY_OPTIONS, FEELING_OPTIONS, feelingFor, MOOD_OPTIONS, SORENESS_OPTIONS } from '@/services/checkinService'
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
  /** Which half of the sheet it belongs to. */
  group: 'share' | 'log'
  /** Built in a later phase; the sheet says so rather than pretending. */
  soon?: boolean
}[] = [
  /*
   * Sharing comes first: this is a social app that also logs, not a logger
   * that also shares.
   *
   * Nothing here is emphasised any more. Post used to carry a `primary` style,
   * which on an accent-tinted row read as *selected* — people opened the sheet
   * and believed they had already chosen Post. A menu of things you have not
   * picked yet should look like a menu of things you have not picked yet.
   */
  { mode: 'post', label: 'Post', hint: 'Say something to the group', icon: PenLine, group: 'share' },
  { mode: 'story', label: 'Story', hint: 'Gone in 24 hours', icon: Camera, group: 'share' },
  { mode: 'motivation', label: 'Motivation', hint: 'A quote worth passing on', icon: Quote, group: 'share' },
  { mode: 'workout', label: 'Workout', hint: 'From Home Workout or another app', icon: Dumbbell, group: 'log' },
  { mode: 'weight', label: 'Weight', hint: "This week's weigh-in", icon: Scale, group: 'log' },
  { mode: 'steps', label: 'Steps', hint: "Today's count", icon: Footprints, group: 'log' },
  { mode: 'water', label: 'Water', hint: 'Add a glass', icon: GlassWater, group: 'log' },
  { mode: 'meal', label: 'Meal', hint: 'Food and macros', icon: UtensilsCrossed, group: 'log' },
  { mode: 'checkin', label: 'Check-in', hint: 'How you feel', icon: HeartPulse, group: 'log' },
]

const TITLES: Record<Mode, string> = {
  menu: 'Create',
  post: 'New post',
  story: 'New story',
  motivation: 'Pass on a line',
  workout: "Log today's workout",
  weight: 'Weekly weigh-in',
  steps: 'Log steps',
  water: 'Water',
  meal: 'Add food',
  checkin: 'Daily check-in',
}

export function LogSheet({
  open,
  onClose,
  initialMode = 'menu',
  draft,
}: {
  open: boolean
  onClose: () => void
  initialMode?: Mode
  /** Text a Share action prepared, for the post composer to start from. */
  draft?: LogDraft
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
      {mode === 'post' ? (
        <PostComposer initialText={draft?.text} onDone={close} onCancel={close} />
      ) : null}
      {mode === 'story' ? <StoryComposer onDone={close} onCancel={close} /> : null}
      {/*
        Its own composer now. It writes the same row through the same service —
        a post with `motivation: true` — but making a quote card and writing a
        post are different acts, and they were the same screen with the labels
        swapped. Editing an existing one still opens the post composer, because
        by then it is a post with words in it.
      */}
      {mode === 'motivation' ? <MotivationComposer onDone={close} onCancel={close} /> : null}
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
              ({ mode, label, hint, icon: Icon, soon }) => (
                <li key={mode}>
                  <button className={styles.menuItem} onClick={() => onPick(mode)}>
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
  const { show, guard } = useToast()
  const today = todayKey()
  const [custom, setCustom] = useState('')
  const ml = useLiveQuery(
    () => (user ? nutritionService.waterForDay(user.id, today) : undefined),
    [user?.id, today],
  )

  if (!user) return null
  const goalMl = user.waterGoalL * 1000
  const current = ml ?? 0

  // "Set amount" sets the day's total rather than adding to it: someone who
  // has been drinking from a 1.5 L bottle knows the total, not the glasses.
  const setTotal = async () => {
    const target = Number.parseInt(custom, 10)
    if (!Number.isFinite(target) || target < 0 || target > 20_000) {
      show('That amount looks off.', 'error')
      return
    }
    const result = await guard(async () => {
      await nutritionService.setWaterTotal(user.id, today, target)
      return true
    })
    if (result) {
      setCustom('')
      show('Water updated.', 'success')
    }
  }

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

      <Field
        label="Set amount"
        type="number"
        inputMode="numeric"
        suffix="ml"
        value={custom}
        placeholder={String(current)}
        onChange={(event) => setCustom(event.target.value)}
        hint="Replaces today's total."
      />
      <Button variant="secondary" onClick={setTotal} disabled={!custom.trim()}>
        Set today's total
      </Button>

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

  const feeling = feelingFor({ mood, energy })

  return (
    <>
      {/*
        The quick answer, and the same five the Activity prompt offers. Picking
        one fills the three controls below rather than saving on its own, so
        somebody who wants to adjust soreness or add a note still can.
      */}
      <div className={styles.feelings} role="group" aria-label="How are you feeling today?">
        {FEELING_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={feeling?.key === option.key}
            className={[styles.feeling, feeling?.key === option.key ? styles.feelingOn : '']
              .filter(Boolean)
              .join(' ')}
            onClick={() => {
              setMood(option.mood)
              setEnergy(option.energy)
              setSoreness(option.soreness)
            }}
          >
            <span className={styles.feelingEmoji} aria-hidden="true">
              {option.emoji}
            </span>
            <span className={styles.feelingLabel}>{option.label}</span>
          </button>
        ))}
      </div>

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
