import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { LogOut, Pencil } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { Field, SelectField } from '@/components/ui/Field'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { ProfileView } from '@/components/profile/ProfileView'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { progressService, userService } from '@/services'
import { ACTIVITY_LEVELS, FITNESS_GOALS } from '@/utils/calories'
import type { ActivityLevel, FitnessGoal, Sex, Weekday } from '@/models'
import { todayKey } from '@/utils/date'
import styles from './Profile.module.css'

/** Sunday first, matching how the week is counted everywhere else. */
const WEEKDAY_OPTIONS: { value: Weekday; label: string }[] = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

export function Profile() {
  const { user, signOut } = useAuth()
  const [editing, setEditing] = useState(false)

  const snapshot = useLiveQuery(
    () => (user ? progressService.userSnapshot(user.id, todayKey()) : undefined),
    [user?.id],
  )

  if (!user || !snapshot) return <LoadingScreen />

  return (
    <div className={styles.page}>
      <PageHeader title="Your profile" subtitle={`@${user.handle}`} backTo="/me" />

      <ProfileView
        snapshot={snapshot}
        headerAction={
          <>
            <Button
              variant="secondary"
              icon={<Pencil size={15} strokeWidth={2.2} />}
              onClick={() => setEditing(true)}
            >
              Edit profile
            </Button>
            <Button
              variant="ghost"
              icon={<LogOut size={15} strokeWidth={2.2} />}
              onClick={signOut}
            >
              Sign out
            </Button>
          </>
        }
      />

      <EditProfileSheet open={editing} onClose={() => setEditing(false)} />
    </div>
  )
}

function EditProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const [form, setForm] = useState({
    name: '',
    birthDate: '',
    sex: 'male' as Sex,
    heightCm: '',
    startWeightKg: '',
    targetWeightKg: '',
    goal: 'lose_weight' as FitnessGoal,
    activityLevel: 'moderate' as ActivityLevel,
    stepGoal: '',
    waterGoalL: '',
    workoutsPerWeekGoal: '',
    weighInDay: 0 as Weekday,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !user) return
    setForm({
      name: user.name,
      birthDate: user.birthDate,
      sex: user.sex,
      heightCm: String(user.heightCm),
      startWeightKg: String(user.startWeightKg),
      targetWeightKg: String(user.targetWeightKg),
      goal: user.goal,
      activityLevel: user.activityLevel,
      stepGoal: String(user.stepGoal),
      waterGoalL: String(user.waterGoalL),
      workoutsPerWeekGoal: String(user.workoutsPerWeekGoal),
      weighInDay: user.weighInDay,
    })
  }, [open, user])

  if (!user) return null

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const save = async () => {
    const heightCm = Number.parseFloat(form.heightCm)
    if (!form.name.trim()) {
      show('A name helps the others know who is who.', 'error')
      return
    }
    if (!Number.isFinite(heightCm) || heightCm < 100 || heightCm > 250) {
      show('That height looks off. Check the number.', 'error')
      return
    }
    setSaving(true)
    const result = await guard(() =>
      userService.update(user.id, {
        name: form.name.trim(),
        birthDate: form.birthDate,
        sex: form.sex,
        heightCm,
        startWeightKg: Number.parseFloat(form.startWeightKg) || user.startWeightKg,
        targetWeightKg: Number.parseFloat(form.targetWeightKg) || user.targetWeightKg,
        goal: form.goal,
        activityLevel: form.activityLevel,
        stepGoal: Number.parseInt(form.stepGoal, 10) || user.stepGoal,
        waterGoalL: Number.parseFloat(form.waterGoalL) || user.waterGoalL,
        workoutsPerWeekGoal:
          Number.parseInt(form.workoutsPerWeekGoal, 10) || user.workoutsPerWeekGoal,
        weighInDay: form.weighInDay,
      }),
    )
    setSaving(false)
    if (result !== undefined) {
      show('Profile updated. Your targets recalculated.', 'success')
      onClose()
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Edit profile"
      subtitle="Changing these recalculates your BMI, BMR and calorie target."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <Field label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} />
      <div className={styles.row}>
        <Field
          label="Date of birth"
          type="date"
          value={form.birthDate}
          max={todayKey()}
          onChange={(e) => set('birthDate', e.target.value)}
        />
        <SelectField label="Sex" value={form.sex} onChange={(e) => set('sex', e.target.value as Sex)}>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </SelectField>
      </div>
      <Field
        label="Height"
        type="number"
        inputMode="decimal"
        suffix="cm"
        value={form.heightCm}
        onChange={(e) => set('heightCm', e.target.value)}
      />
      <div className={styles.row}>
        <Field
          label="Starting weight"
          type="number"
          inputMode="decimal"
          step="0.1"
          suffix="kg"
          value={form.startWeightKg}
          onChange={(e) => set('startWeightKg', e.target.value)}
        />
        <Field
          label="Goal weight"
          type="number"
          inputMode="decimal"
          step="0.1"
          suffix="kg"
          value={form.targetWeightKg}
          onChange={(e) => set('targetWeightKg', e.target.value)}
        />
      </div>
      <SelectField
        label="Goal"
        value={form.goal}
        hint={FITNESS_GOALS.find((g) => g.value === form.goal)?.hint}
        onChange={(e) => set('goal', e.target.value as FitnessGoal)}
      >
        {FITNESS_GOALS.map((goal) => (
          <option key={goal.value} value={goal.value}>
            {goal.label}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Activity level"
        value={form.activityLevel}
        hint={ACTIVITY_LEVELS.find((l) => l.value === form.activityLevel)?.hint}
        onChange={(e) => set('activityLevel', e.target.value as ActivityLevel)}
      >
        {ACTIVITY_LEVELS.map((level) => (
          <option key={level.value} value={level.value}>
            {level.label}
          </option>
        ))}
      </SelectField>
      <div className={styles.row}>
        <Field
          label="Daily steps"
          type="number"
          inputMode="numeric"
          value={form.stepGoal}
          onChange={(e) => set('stepGoal', e.target.value)}
        />
        <Field
          label="Water"
          type="number"
          inputMode="decimal"
          step="0.1"
          suffix="L"
          value={form.waterGoalL}
          onChange={(e) => set('waterGoalL', e.target.value)}
        />
      </div>
      <Field
        label="Workouts per week"
        type="number"
        inputMode="numeric"
        value={form.workoutsPerWeekGoal}
        hint="Used for your weekly consistency score."
        onChange={(e) => set('workoutsPerWeekGoal', e.target.value)}
      />
      <SelectField
        label="Weekly weigh-in day"
        value={String(form.weighInDay)}
        hint="When Home reminds you to record the week's official weight."
        onChange={(e) => set('weighInDay', Number(e.target.value) as Weekday)}
      >
        {WEEKDAY_OPTIONS.map((day) => (
          <option key={day.value} value={day.value}>
            {day.label}
          </option>
        ))}
      </SelectField>
    </Sheet>
  )
}
