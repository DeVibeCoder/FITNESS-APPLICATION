import { db } from '@/lib/db'
import { uid } from '@/lib/id'
import type {
  BodyMeasurement,
  DateKey,
  MotivationVideo,
  DailyCheckIn,
  FoodEntry,
  Goal,
  MealSlot,
  PlanDay,
  PlanEnrollment,
  Reaction,
  StepEntry,
  Update,
  User,
  WaterEntry,
  WeightEntry,
  WorkoutExercise,
  WorkoutPlan,
  WorkoutSession,
  WorkoutSource,
  ChatMessage,
  ChatReaction,
  Post,
  PostReaction,
  Comment,
  Story,
  StoryView,
  MediaAsset,
  AppNotification,
} from '@/models'
import { PLAN_TEMPLATES, TEMPLATES, EXERCISES, slotForDay } from './library'
import { achievementService } from '@/services/achievementService'
import { authService } from '@/services/authService'
import { challengeService } from '@/services/challengeService'
import { DEMO_PASSWORD } from './demo'
import { addDays, daysBetween, startOfWeek, todayKey } from '@/utils/date'

/** Bump to reseed on next load (development convenience). */
export const SEED_VERSION = 10

// --- Date helpers ----------------------------------------------------------
// Everything is expressed as an offset from today so the demo never goes stale.

const TODAY = todayKey()
const day = (offset: number) => addDays(TODAY, offset)

function at(offset: number, hour: number, minute = 0): string {
  const [y, m, d] = day(offset).split('-').map(Number)
  const target = new Date(y, m - 1, d, hour, minute).getTime()
  const now = Date.now()
  // A seeded entry for today must not carry a timestamp from later today —
  // "undo the last glass" orders by createdAt and would pick the wrong row.
  // Later hours still land closer to now, so the ordering survives.
  if (target > now) return new Date(now - (24 - hour) * 60_000).toISOString()
  return new Date(target).toISOString()
}

/**
 * Sessions are placed by weekday inside a given week, not by a raw day offset.
 *
 * Offsets alone slide across the week boundary: seeded on a Saturday they fill
 * the current week, but by Sunday the same offsets land in the previous one and
 * the app opens on an empty week. Anchoring to `startOfWeek` keeps the two
 * reference weeks intact whatever day it is read.
 */
function atOn(date: DateKey, hour: number, minute = 0): string {
  const [y, m, d] = date.split('-').map(Number)
  const target = new Date(y, m - 1, d, hour, minute).getTime()
  const now = Date.now()
  if (target > now) return new Date(now - (24 - hour) * 60_000).toISOString()
  return new Date(target).toISOString()
}

const WEEK_START = startOfWeek(TODAY)

/** Plan start dates, anchored to the week so day numbers never drift. */
const AHMED_PLAN_START = addDays(WEEK_START, -14)
const NADIA_PLAN_START = addDays(WEEK_START, -20)
const SAMIR_PLAN_START = addDays(WEEK_START, -21)

function inWeek(weekOffset: number, weekday: number): DateKey {
  return addDays(WEEK_START, weekOffset * 7 + weekday)
}

/** Minutes before "now" — used for today's activity so timestamps read naturally. */
function agoMinutes(mins: number): string {
  return new Date(Date.now() - mins * 60_000).toISOString()
}

// --- Users -----------------------------------------------------------------

const USERS: User[] = [
  {
    id: 'u_ahmed',
    name: 'Ahmed Rahman',
    email: 'ahmed.rahman@gmail.com',
    role: 'admin',
    status: 'approved',
    handle: 'ahmed',
    avatarColor: '#3d6ea8',
    birthDate: '1992-03-14',
    sex: 'male',
    heightCm: 165,
    startWeightKg: 82,
    targetWeightKg: 72,
    goal: 'lose_weight',
    activityLevel: 'moderate',
    stepGoal: 8000,
    waterGoalL: 2.5,
    workoutsPerWeekGoal: 6,
    weighInDay: 0,
    workoutApps: ['home_workout'],
    units: 'metric',
    onboardedAt: at(-72, 9),
    joinedAt: at(-72, 9),
  },
  {
    id: 'u_nadia',
    name: 'Nadia Karim',
    email: 'nadia.karim@gmail.com',
    role: 'member',
    status: 'approved',
    handle: 'nadia',
    avatarColor: '#a8557a',
    birthDate: '1995-07-02',
    sex: 'female',
    heightCm: 168,
    startWeightKg: 87.3,
    targetWeightKg: 78,
    goal: 'lose_weight',
    activityLevel: 'light',
    stepGoal: 9000,
    waterGoalL: 2.5,
    workoutsPerWeekGoal: 4,
    weighInDay: 0,
    workoutApps: ['home_workout', 'lose_weight_men'],
    units: 'metric',
    onboardedAt: at(-72, 11),
    joinedAt: at(-72, 11),
  },
  {
    id: 'u_samir',
    name: 'Samir Haque',
    email: 'samir.haque@outlook.com',
    role: 'member',
    status: 'approved',
    handle: 'samir',
    avatarColor: '#5f8b4c',
    birthDate: '1988-11-20',
    sex: 'male',
    heightCm: 178,
    startWeightKg: 73.2,
    // Samir is the counterexample on purpose: the group is not three people
    // all trying to lose weight, and every goal-aware screen has to prove it.
    targetWeightKg: 78,
    goal: 'build_muscle',
    activityLevel: 'active',
    stepGoal: 10000,
    waterGoalL: 3,
    workoutsPerWeekGoal: 6,
    weighInDay: 0,
    workoutApps: ['lose_weight_men', 'home_workout'],
    units: 'metric',
    onboardedAt: at(-70, 8),
    joinedAt: at(-70, 8),
  },
  {
    id: 'u_leila',
    name: 'Leila Haddad',
    handle: 'leila',
    email: 'leila.haddad@gmail.com',
    role: 'member',
    // Waiting on approval, so the admin screen has a real request to act on.
    status: 'pending',
    avatarColor: '#9a6bb0',
    birthDate: '1997-01-30',
    sex: 'female',
    heightCm: 163,
    startWeightKg: 68,
    targetWeightKg: 63,
    goal: 'lose_weight',
    activityLevel: 'light',
    stepGoal: 8000,
    waterGoalL: 2,
    workoutsPerWeekGoal: 3,
    weighInDay: 0,
    workoutApps: ['home_workout'],
    units: 'metric',
    joinedAt: at(-2, 18),
  },
]

// --- Weight ----------------------------------------------------------------
// Weekly official weigh-ins going back ten weeks, oldest first.

const OFFICIAL_WEIGHTS: Record<string, number[]> = {
  u_ahmed: [82.0, 81.2, 80.6, 79.9, 79.4, 78.9, 78.5, 78.2, 77.9, 77.6, 76.8],
  u_nadia: [87.3, 86.8, 86.4, 86.0, 85.6, 85.3, 85.0, 84.8, 84.6, 84.4, 84.2],
  // Samir is building muscle, so his line goes up. Every goal-aware screen
  // reads "toward goal" rather than "lost", and this is the data that proves
  // it — with a flat fortnight in the middle, because real gaining stalls.
  u_samir: [73.2, 73.5, 73.9, 74.2, 74.4, 74.4, 74.5, 74.9, 75.3, 75.6, 76.0],
}

/** Ahmed also weighs in most mornings, which is what makes his chart readable. */
const AHMED_DAILY_WEIGHTS: [number, number][] = [
  [-6, 77.5],
  [-5, 77.4],
  [-4, 77.2],
  [-3, 77.1],
  [-2, 77.0],
  [-1, 76.9],
]

// --- Sessions --------------------------------------------------------------

/**
 * A session is placed either a fixed number of days back (for things that must
 * sit on a specific day relative to now, such as "trained today") or on a
 * weekday inside a given week (for the two reference weeks). Anything that
 * resolves to a future date is simply not seeded.
 */
type Placement = { daysAgo: number } | { weekOffset: number; weekday: number }

interface SeedSession {
  userId: string
  place: Placement
  durationSec: number
  kcal: number
  difficulty: 'hard' | 'just_right' | 'easy'
  hour: number
  minute: number
}

function resolvePlacement(place: Placement): DateKey | null {
  const date = 'daysAgo' in place ? day(-place.daysAgo) : inWeek(place.weekOffset, place.weekday)
  return date > TODAY ? null : date
}

/**
 * Ahmed's history reproduces the numbers the group has been posting in
 * WhatsApp. Both reference weeks are complete weeks in the past, so the totals
 * hold on any day of the week:
 *   last week      4 workouts / 41:08 / 868.4 kcal
 *   the week before 5 workouts / 49:10 / 1,038.0 kcal
 * The current week fills in as its days elapse.
 */
const AHMED_SESSIONS: SeedSession[] = [
  // Two weeks ago — 5 workouts, 49:10, 1,038.0 kcal.
  { userId: 'u_ahmed', place: { weekOffset: -2, weekday: 0 }, durationSec: 344, kcal: 111.7, difficulty: 'hard', hour: 20, minute: 15 },
  { userId: 'u_ahmed', place: { weekOffset: -2, weekday: 1 }, durationSec: 383, kcal: 125.8, difficulty: 'just_right', hour: 19, minute: 40 },
  { userId: 'u_ahmed', place: { weekOffset: -2, weekday: 3 }, durationSec: 855, kcal: 376.9, difficulty: 'hard', hour: 6, minute: 55 },
  { userId: 'u_ahmed', place: { weekOffset: -2, weekday: 5 }, durationSec: 722, kcal: 254.0, difficulty: 'just_right', hour: 21, minute: 5 },
  { userId: 'u_ahmed', place: { weekOffset: -2, weekday: 6 }, durationSec: 646, kcal: 169.6, difficulty: 'easy', hour: 20, minute: 30 },

  // Last week — 4 workouts, 41:08, 868.4 kcal.
  { userId: 'u_ahmed', place: { weekOffset: -1, weekday: 1 }, durationSec: 646, kcal: 254.0, difficulty: 'just_right', hour: 7, minute: 20 },
  { userId: 'u_ahmed', place: { weekOffset: -1, weekday: 2 }, durationSec: 722, kcal: 289.3, difficulty: 'hard', hour: 20, minute: 48 },
  { userId: 'u_ahmed', place: { weekOffset: -1, weekday: 4 }, durationSec: 482, kcal: 169.6, difficulty: 'just_right', hour: 20, minute: 53 },
  { userId: 'u_ahmed', place: { weekOffset: -1, weekday: 5 }, durationSec: 618, kcal: 155.5, difficulty: 'easy', hour: 19, minute: 26 },

  // This week, as it happens. Nothing on today, so the workout CTA is live.
  { userId: 'u_ahmed', place: { weekOffset: 0, weekday: 1 }, durationSec: 705, kcal: 231.4, difficulty: 'just_right', hour: 7, minute: 15 },
  { userId: 'u_ahmed', place: { weekOffset: 0, weekday: 2 }, durationSec: 540, kcal: 168.2, difficulty: 'hard', hour: 20, minute: 5 },
  { userId: 'u_ahmed', place: { weekOffset: 0, weekday: 4 }, durationSec: 812, kcal: 264.7, difficulty: 'just_right', hour: 6, minute: 50 },
]

const NADIA_SESSIONS: SeedSession[] = [
  { userId: 'u_nadia', place: { weekOffset: -2, weekday: 1 }, durationSec: 660, kcal: 182.0, difficulty: 'just_right', hour: 7, minute: 5 },
  { userId: 'u_nadia', place: { weekOffset: -2, weekday: 3 }, durationSec: 498, kcal: 129.5, difficulty: 'easy', hour: 20, minute: 40 },
  { userId: 'u_nadia', place: { weekOffset: -2, weekday: 5 }, durationSec: 744, kcal: 214.8, difficulty: 'hard', hour: 7, minute: 10 },
  { userId: 'u_nadia', place: { weekOffset: -1, weekday: 0 }, durationSec: 690, kcal: 201.3, difficulty: 'just_right', hour: 18, minute: 55 },
  { userId: 'u_nadia', place: { weekOffset: -1, weekday: 2 }, durationSec: 705, kcal: 198.4, difficulty: 'just_right', hour: 7, minute: 5 },
  { userId: 'u_nadia', place: { weekOffset: -1, weekday: 4 }, durationSec: 540, kcal: 141.2, difficulty: 'hard', hour: 20, minute: 20 },
  { userId: 'u_nadia', place: { weekOffset: -1, weekday: 6 }, durationSec: 812, kcal: 236.7, difficulty: 'just_right', hour: 18, minute: 45 },
  { userId: 'u_nadia', place: { weekOffset: 0, weekday: 1 }, durationSec: 620, kcal: 168.3, difficulty: 'hard', hour: 7, minute: 15 },
  { userId: 'u_nadia', place: { weekOffset: 0, weekday: 3 }, durationSec: 705, kcal: 191.6, difficulty: 'just_right', hour: 7, minute: 20 },
]

/** Samir is the consistent one — including a session already done today. */
const SAMIR_SESSIONS: SeedSession[] = [
  { userId: 'u_samir', place: { daysAgo: 13 }, durationSec: 1140, kcal: 318.4, difficulty: 'just_right', hour: 6, minute: 30 },
  { userId: 'u_samir', place: { daysAgo: 12 }, durationSec: 1020, kcal: 289.1, difficulty: 'easy', hour: 6, minute: 35 },
  { userId: 'u_samir', place: { daysAgo: 11 }, durationSec: 1230, kcal: 371.8, difficulty: 'hard', hour: 6, minute: 28 },
  { userId: 'u_samir', place: { daysAgo: 9 }, durationSec: 1095, kcal: 305.2, difficulty: 'just_right', hour: 6, minute: 40 },
  { userId: 'u_samir', place: { daysAgo: 8 }, durationSec: 960, kcal: 268.9, difficulty: 'just_right', hour: 6, minute: 32 },
  { userId: 'u_samir', place: { daysAgo: 6 }, durationSec: 1102, kcal: 312.5, difficulty: 'just_right', hour: 6, minute: 30 },
  { userId: 'u_samir', place: { daysAgo: 5 }, durationSec: 1284, kcal: 402.1, difficulty: 'hard', hour: 6, minute: 35 },
  { userId: 'u_samir', place: { daysAgo: 3 }, durationSec: 1050, kcal: 298.7, difficulty: 'easy', hour: 6, minute: 28 },
  { userId: 'u_samir', place: { daysAgo: 2 }, durationSec: 890, kcal: 240.4, difficulty: 'just_right', hour: 6, minute: 40 },
  { userId: 'u_samir', place: { daysAgo: 1 }, durationSec: 1160, kcal: 330.2, difficulty: 'just_right', hour: 6, minute: 32 },
  { userId: 'u_samir', place: { daysAgo: 0 }, durationSec: 1085, kcal: 305.9, difficulty: 'just_right', hour: 6, minute: 34 },
]

// --- Steps -----------------------------------------------------------------

const STEPS: Record<string, [number, number][]> = {
  // 12 unbroken days — Ahmed's streak. This week totals 56,421.
  u_ahmed: [
    [-11, 8120], [-10, 7410], [-9, 9332], [-8, 6940], [-7, 8875], [-6, 6210],
    [-5, 9048], [-4, 8432], [-3, 7905], [-2, 10116], [-1, 6868], [0, 7842],
  ],
  u_nadia: [
    [-7, 9210], [-6, 7640], [-5, 10204], [-4, 8930], [-3, 9415], [-2, 6880],
    [-1, 9102], [0, 8412],
  ],
  u_samir: [
    [-14, 11040], [-13, 12310], [-12, 9880], [-11, 13420], [-10, 10760],
    [-9, 11890], [-8, 9450], [-7, 12005], [-6, 10330], [-5, 13115],
    [-4, 11470], [-3, 9905], [-2, 12680], [-1, 10240], [0, 11238],
  ],
}

// --- Nutrition -------------------------------------------------------------

interface SeedFood {
  meal: MealSlot
  name: string
  portion: string
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
  hour: number
}

/** Today for Ahmed: 1,840 kcal · 128 P · 198 C · 61 F. */
const AHMED_TODAY_FOOD: SeedFood[] = [
  { meal: 'breakfast', name: 'Oats with banana & peanut butter', portion: '1 bowl', kcal: 430, proteinG: 12, carbsG: 62, fatG: 17, hour: 7 },
  { meal: 'lunch', name: 'Grilled chicken, rice & salad', portion: '1 plate', kcal: 620, proteinG: 42, carbsG: 84, fatG: 15, hour: 13 },
  { meal: 'snacks', name: 'Greek yogurt & berries', portion: '150 g', kcal: 180, proteinG: 16, carbsG: 20, fatG: 4, hour: 16 },
  { meal: 'snacks', name: 'Whey shake', portion: '1 scoop', kcal: 160, proteinG: 25, carbsG: 6, fatG: 2, hour: 17 },
  { meal: 'dinner', name: 'Beef kofta with vegetables', portion: '1 serving', kcal: 450, proteinG: 33, carbsG: 26, fatG: 23, hour: 20 },
]

const GENERIC_DAY: SeedFood[] = [
  { meal: 'breakfast', name: 'Eggs on toast', portion: '2 eggs, 2 slices', kcal: 380, proteinG: 22, carbsG: 34, fatG: 17, hour: 8 },
  { meal: 'lunch', name: 'Chicken wrap & salad', portion: '1 wrap', kcal: 560, proteinG: 38, carbsG: 58, fatG: 18, hour: 13 },
  { meal: 'snacks', name: 'Apple & almonds', portion: '1 apple, 20 g', kcal: 210, proteinG: 5, carbsG: 26, fatG: 11, hour: 16 },
  { meal: 'dinner', name: 'Salmon, potatoes & greens', portion: '1 plate', kcal: 640, proteinG: 44, carbsG: 52, fatG: 26, hour: 20 },
]

// --- Build -----------------------------------------------------------------

function buildPlans() {
  const plans: WorkoutPlan[] = []
  const planDays: PlanDay[] = []
  const workoutExercises: WorkoutExercise[] = []

  for (const template of PLAN_TEMPLATES) {
    plans.push({
      id: template.id,
      name: template.name,
      description: template.description,
      level: template.level,
      totalDays: template.totalDays,
      focus: template.focus,
      ownerId: null,
      createdAt: at(-72, 9),
    })

    for (let dayNumber = 1; dayNumber <= template.totalDays; dayNumber++) {
      const slot = slotForDay(template, dayNumber)
      const planDayId = `${template.id}_d${dayNumber}`
      if (slot === 'rest') {
        planDays.push({ id: planDayId, planId: template.id, dayNumber, name: 'Rest day', estimatedMinutes: 0 })
        continue
      }
      const workout = TEMPLATES[slot]
      planDays.push({
        id: planDayId,
        planId: template.id,
        dayNumber,
        name: workout.name,
        estimatedMinutes: workout.estimatedMinutes,
      })
      workout.exercises.forEach((exercise, index) => {
        workoutExercises.push({
          id: `${planDayId}_e${index}`,
          planDayId,
          exerciseId: exercise.exerciseId,
          order: index,
          sets: exercise.sets,
          reps: exercise.reps,
          durationSec: exercise.durationSec,
          restSec: exercise.restSec,
        })
      })
    }
  }

  return { plans, planDays, workoutExercises }
}

/** Which app each member trains in. Matches their profile's `workoutApps`. */
const SESSION_SOURCE: Record<string, WorkoutSource> = {
  u_ahmed: 'home_workout',
  u_nadia: 'home_workout',
  u_samir: 'lose_weight_men',
}

function buildSessions(
  planId: string,
  enrolledFrom: DateKey,
  seeds: SeedSession[],
): WorkoutSession[] {
  const template = PLAN_TEMPLATES.find((p) => p.id === planId)!
  const sessions: WorkoutSession[] = []

  for (const seed of seeds) {
    const date = resolvePlacement(seed.place)
    if (date === null) continue // Would land in the future.

    // Day number follows the enrolment, so it always matches what the plan
    // screen shows for that date.
    const dayNumber = ((daysBetween(enrolledFrom, date) % template.totalDays) + template.totalDays) % template.totalDays + 1
    const slot = slotForDay(template, dayNumber)
    const workout = slot === 'rest' ? TEMPLATES.full_body : TEMPLATES[slot]

    const isToday = date === TODAY
    const startedAt = isToday
      ? agoMinutes(70 + Math.round(seed.durationSec / 60))
      : atOn(date, seed.hour, seed.minute)
    const completedAt = isToday
      ? agoMinutes(70)
      : new Date(new Date(startedAt).getTime() + seed.durationSec * 1000).toISOString()

    sessions.push({
      id: `s_${seed.userId}_${date}`,
      userId: seed.userId,
      planId,
      planDayId: `${planId}_d${dayNumber}`,
      dayNumber,
      name: workout.name,
      startedAt,
      completedAt,
      date,
      durationSec: seed.durationSec,
      exerciseCount: workout.exercises.length,
      caloriesKcal: seed.kcal,
      difficulty: seed.difficulty,
      status: 'completed',
      // The group trains in other apps and records the result here, so the
      // seeded history looks like what they will actually produce.
      source: SESSION_SOURCE[seed.userId] ?? 'home_workout',
      planName: template.name,
      loggedVia: 'quick_log',
    })
  }
  return sessions
}

function buildWeights(): WeightEntry[] {
  const entries: WeightEntry[] = []
  for (const [userId, weights] of Object.entries(OFFICIAL_WEIGHTS)) {
    weights.forEach((weightKg, index) => {
      const offset = -7 * (weights.length - 1 - index)
      entries.push({
        id: `w_${userId}_${index}`,
        userId,
        date: day(offset),
        weightKg,
        kind: 'official',
        createdAt: offset === 0 ? agoMinutes(125) : at(offset, 7, 30),
      })
    })
  }
  for (const [offset, weightKg] of AHMED_DAILY_WEIGHTS) {
    entries.push({
      id: `w_u_ahmed_daily_${offset}`,
      userId: 'u_ahmed',
      date: day(offset),
      weightKg,
      kind: 'daily',
      createdAt: at(offset, 7, 25),
    })
  }
  return entries
}

function buildFood(): FoodEntry[] {
  const entries: FoodEntry[] = []
  const push = (userId: string, offset: number, meals: SeedFood[], tag: string) => {
    meals.forEach((meal, index) => {
      entries.push({
        id: `f_${userId}_${tag}_${index}`,
        userId,
        date: day(offset),
        meal: meal.meal,
        name: meal.name,
        portion: meal.portion,
        kcal: meal.kcal,
        proteinG: meal.proteinG,
        carbsG: meal.carbsG,
        fatG: meal.fatG,
        source: 'manual',
        createdAt: at(offset, meal.hour),
      })
    })
  }

  push('u_ahmed', 0, AHMED_TODAY_FOOD, 'today')
  for (const offset of [-1, -2, -3, -4]) push('u_ahmed', offset, GENERIC_DAY, `d${offset}`)
  for (const offset of [0, -1, -3]) push('u_nadia', offset, GENERIC_DAY, `d${offset}`)
  for (const offset of [0, -1, -2, -3, -4, -5]) push('u_samir', offset, GENERIC_DAY, `d${offset}`)
  return entries
}

function buildWater(): WaterEntry[] {
  const entries: WaterEntry[] = []
  const push = (userId: string, offset: number, amounts: number[]) => {
    amounts.forEach((ml, index) => {
      entries.push({
        id: `h2o_${userId}_${offset}_${index}`,
        userId,
        date: day(offset),
        ml,
        createdAt: at(offset, 8 + index * 3),
      })
    })
  }
  push('u_ahmed', 0, [500, 500, 500, 300])
  for (const offset of [-1, -2, -3, -4, -5]) push('u_ahmed', offset, [500, 500, 500, 500, 250])
  for (const offset of [0, -1, -2]) push('u_nadia', offset, [500, 500, 500])
  for (const offset of [0, -1, -2, -3, -4]) push('u_samir', offset, [750, 750, 750, 500])
  return entries
}

function buildSteps(): StepEntry[] {
  const entries: StepEntry[] = []
  for (const [userId, days] of Object.entries(STEPS)) {
    for (const [offset, steps] of days) {
      entries.push({
        id: `st_${userId}_${offset}`,
        userId,
        date: day(offset),
        steps,
        source: 'manual',
        createdAt: offset === 0 ? agoMinutes(25) : at(offset, 22),
      })
    }
  }
  return entries
}

function buildCheckIns(): DailyCheckIn[] {
  const rows: [string, number, 1 | 2 | 3 | 4, 1 | 2 | 3 | 4 | 5, DailyCheckIn['soreness'], string?][] = [
    ['u_ahmed', -4, 3, 4, 'low'],
    ['u_ahmed', -3, 2, 3, 'medium', 'Legs are wrecked from yesterday.'],
    ['u_ahmed', -2, 4, 5, 'low', 'Best I have felt in weeks.'],
    ['u_ahmed', -1, 3, 4, 'none'],
    ['u_nadia', -3, 2, 3, 'medium'],
    ['u_nadia', -1, 3, 4, 'low'],
    ['u_nadia', 0, 3, 4, 'none', 'Slept properly for once.'],
    ['u_samir', -4, 4, 5, 'low'],
    ['u_samir', -3, 4, 4, 'none'],
    ['u_samir', -2, 3, 4, 'medium'],
    ['u_samir', -1, 4, 5, 'low'],
    ['u_samir', 0, 4, 5, 'none', 'Early session done. Good start.'],
  ]
  return rows.map(([userId, offset, energy, mood, soreness, note]) => ({
    id: `ci_${userId}_${offset}`,
    userId,
    date: day(offset),
    energy,
    mood,
    soreness,
    note,
    createdAt: offset === 0 ? agoMinutes(200) : at(offset, 8),
  }))
}

function buildUpdates(): { updates: Update[]; reactions: Reaction[] } {
  const updates: Update[] = [
    { id: 'up_1', userId: 'u_nadia', kind: 'steps_logged', text: 'reached 9,000 steps 🚶', meta: { steps: 8412 }, createdAt: agoMinutes(25) },
    { id: 'up_2', userId: 'u_samir', kind: 'workout_completed', text: 'completed Day 22 — Lose Weight 30 Days Plan 💪', meta: { kcal: 305.9, durationSec: 1085 }, createdAt: agoMinutes(70) },
    { id: 'up_3', userId: 'u_ahmed', kind: 'weight_logged', text: 'completed their weekly weigh-in — −0.8 kg this week 🔥', meta: { weightKg: 76.8, changeKg: -0.8 }, createdAt: agoMinutes(125) },
    { id: 'up_4', userId: 'u_samir', kind: 'achievement', text: 'unlocked 30 Day Consistency 📈', meta: { key: 'consistency_30' }, createdAt: agoMinutes(190) },
    { id: 'up_5', userId: 'u_nadia', kind: 'checkin', text: 'checked in — feeling good today', createdAt: agoMinutes(240) },
    { id: 'up_6', userId: 'u_ahmed', kind: 'workout_completed', text: 'completed Day 14 — Lose Weight 30 Days Plan 💪', meta: { kcal: 155.5, durationSec: 618 }, createdAt: at(-1, 19, 35) },
    { id: 'up_7', userId: 'u_nadia', kind: 'workout_completed', text: 'completed Day 19 — Full Body Beginner 💪', meta: { kcal: 236.7, durationSec: 812 }, createdAt: at(-2, 19, 0) },
    { id: 'up_8', userId: 'u_ahmed', kind: 'achievement', text: 'unlocked 5 kg Progress 🎯', meta: { key: 'five_kg' }, createdAt: at(-2, 21, 5) },
  ]

  const reactions: Reaction[] = [
    { id: 'r_1', updateId: 'up_2', userId: 'u_ahmed', emoji: '🔥', createdAt: agoMinutes(60) },
    { id: 'r_2', updateId: 'up_2', userId: 'u_nadia', emoji: '💪', createdAt: agoMinutes(55) },
    { id: 'r_3', updateId: 'up_3', userId: 'u_samir', emoji: '👏', createdAt: agoMinutes(110) },
    { id: 'r_4', updateId: 'up_8', userId: 'u_nadia', emoji: '🔥', createdAt: at(-2, 21, 30) },
    { id: 'r_5', updateId: 'up_8', userId: 'u_samir', emoji: '🔥', createdAt: at(-2, 22, 0) },
    { id: 'r_6', updateId: 'up_6', userId: 'u_samir', emoji: '💪', createdAt: at(-1, 20, 10) },
  ]

  return { updates, reactions }
}

/**
 * A short, ordinary conversation.
 *
 * Twelve messages over two days — enough that the room looks lived in, few
 * enough that it does not read as a script. Two of them are shares, which is
 * roughly the ratio the app is trying to encourage: mostly people talking,
 * occasionally a number.
 */
function buildChat(sessions: WorkoutSession[]): {
  messages: ChatMessage[]
  reactions: ChatReaction[]
} {
  // Point the share at a workout that definitely exists, whatever weekday the
  // seed runs on: Ahmed's most recent one.
  const ahmedsLast = sessions
    .filter((s) => s.userId === 'u_ahmed')
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .at(-1)

  const said: [string, string, string, string?][] = [
    // [id, userId, text, replyToId]
    ['m_1', 'u_samir', "Who's training tonight?"],
    ['m_2', 'u_nadia', "Me, around 8. Legs today so wish me luck 😅", 'm_1'],
    ['m_3', 'u_ahmed', 'Workout done 💪'],
    ['m_4', 'u_samir', 'Nice one', 'm_3'],
    ['m_5', 'u_nadia', "I'm taking the long way home for extra steps 😂"],
    ['m_6', 'u_ahmed', "Weekly weigh-in tomorrow, don't forget"],
    ['m_7', 'u_samir', 'Already dreading it', 'm_6'],
    ['m_8', 'u_nadia', "Let's hit 50k steps this week. We were close last time."],
    ['m_9', 'u_samir', "I'm in"],
    ['m_10', 'u_ahmed', 'That one was harder than yesterday, my legs are gone'],
  ]

  const messages: ChatMessage[] = said.map(([id, userId, text, replyToId], index) => ({
    id,
    userId,
    text,
    // Spread across yesterday evening and this morning so the thread has a
    // natural gap in it rather than twelve messages a minute apart.
    createdAt: index < 5 ? at(-1, 18 + index, index * 7) : agoMinutes((10 - index) * 46),
    replyToId,
  }))

  // The two shares sit at the end, closest to now.
  if (ahmedsLast) {
    messages.push({
      id: 'm_share_workout',
      userId: 'u_ahmed',
      text: '',
      createdAt: agoMinutes(64),
      sharedType: 'workout',
      sharedDataId: ahmedsLast.id,
    })
  }
  messages.push({
    id: 'm_share_weighin',
    userId: 'u_ahmed',
    text: '',
    createdAt: agoMinutes(38),
    sharedType: 'weigh_in',
    // The most recent official weigh-in; see buildWeights for the id shape.
    sharedDataId: `w_u_ahmed_${OFFICIAL_WEIGHTS.u_ahmed.length - 1}`,
  })
  // The one mention in the thread, and the reason n_3 exists. Ordinary
  // messages never generate a notification; being named does.
  messages.push({
    id: 'm_11',
    userId: 'u_nadia',
    text: '@Ahmed under 77 🔥',
    createdAt: agoMinutes(31),
    replyToId: 'm_share_weighin',
  })

  const reactions: ChatReaction[] = [
    { id: 'cr_1', messageId: 'm_3', userId: 'u_nadia', emoji: '💪', createdAt: at(-1, 20, 12) },
    { id: 'cr_2', messageId: 'm_5', userId: 'u_ahmed', emoji: '😂', createdAt: agoMinutes(220) },
    { id: 'cr_3', messageId: 'm_5', userId: 'u_samir', emoji: '😂', createdAt: agoMinutes(215) },
    { id: 'cr_4', messageId: 'm_share_weighin', userId: 'u_samir', emoji: '🔥', createdAt: agoMinutes(30) },
    { id: 'cr_5', messageId: 'm_8', userId: 'u_ahmed', emoji: '👏', createdAt: agoMinutes(120) },
  ]

  return { messages, reactions }
}


/**
 * The social layer's demo content.
 *
 * Ordinary things three people would actually say to each other, not a
 * showcase. Two of the posts carry a record (a workout, a weigh-in) by
 * reference; one carries a placeholder image, which the UI draws from CSS —
 * there is no stock photograph anywhere in this app and no binary in the
 * database.
 */
function buildSocial(sessions: WorkoutSession[]): {
  posts: Post[]
  reactions: PostReaction[]
  comments: Comment[]
  stories: Story[]
  storyViews: StoryView[]
  media: MediaAsset[]
  notifications: AppNotification[]
} {
  const ahmedsLast = sessions
    .filter((s) => s.userId === 'u_ahmed')
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .at(-1)

  const media: MediaAsset[] = [
    {
      id: 'media_ridge',
      kind: 'image',
      // Drawn by the UI, not fetched. See mediaService for why.
      ref: 'placeholder:ridge',
      mimeType: 'image/webp',
      width: 1200,
      height: 900,
      createdAt: at(-1, 7, 40),
    },
    {
      id: 'media_track',
      kind: 'image',
      ref: 'placeholder:track',
      mimeType: 'image/webp',
      width: 1080,
      height: 1920,
      createdAt: agoMinutes(150),
    },
  ]

  const posts: Post[] = [
    {
      id: 'p_1',
      userId: 'u_samir',
      type: 'status',
      text: 'Starting to feel stronger every week. The bar finally moved today.',
      createdAt: at(-2, 20, 10),
      visibility: 'group',
      mediaIds: [],
      reactionCount: 2,
      commentCount: 1,
    },
    {
      id: 'p_2',
      userId: 'u_nadia',
      type: 'steps',
      text: 'Finally hit my step goal today! 🔥 Walked the long way back on purpose.',
      createdAt: at(-1, 19, 5),
      visibility: 'group',
      mediaIds: [],
      sharedType: 'steps',
      reactionCount: 3,
      commentCount: 0,
    },
    {
      id: 'p_3',
      userId: 'u_ahmed',
      type: 'photo',
      text: 'Morning walk before the heat. Worth getting up for.',
      createdAt: at(-1, 7, 42),
      visibility: 'group',
      mediaIds: ['media_ridge'],
      reactionCount: 2,
      commentCount: 1,
    },
    {
      id: 'p_4',
      userId: 'u_ahmed',
      type: 'workout',
      text: "Didn't feel like training today, but got it done anyway. 💪",
      createdAt: agoMinutes(95),
      visibility: 'group',
      mediaIds: [],
      sharedType: 'workout',
      sharedDataId: ahmedsLast?.id,
      reactionCount: 2,
      commentCount: 1,
    },
    {
      id: 'p_5',
      userId: 'u_nadia',
      type: 'motivation',
      text: "Saw this and it stuck: you don't have to be extreme, just consistent.",
      createdAt: agoMinutes(70),
      visibility: 'group',
      mediaIds: [],
      reactionCount: 1,
      commentCount: 0,
    },
    {
      id: 'p_6',
      userId: 'u_ahmed',
      type: 'weigh_in',
      text: 'Weekly weigh-in done. Slow week but it went the right way.',
      createdAt: agoMinutes(40),
      visibility: 'group',
      mediaIds: [],
      sharedType: 'weigh_in',
      sharedDataId: `w_u_ahmed_${OFFICIAL_WEIGHTS.u_ahmed.length - 1}`,
      reactionCount: 2,
      commentCount: 0,
    },
  ]

  const reactions: PostReaction[] = [
    { id: 'pr_1', postId: 'p_1', userId: 'u_ahmed', emoji: '💪', createdAt: at(-2, 20, 40) },
    { id: 'pr_2', postId: 'p_1', userId: 'u_nadia', emoji: '👏', createdAt: at(-2, 21, 5) },
    { id: 'pr_3', postId: 'p_2', userId: 'u_ahmed', emoji: '🔥', createdAt: at(-1, 19, 30) },
    { id: 'pr_4', postId: 'p_2', userId: 'u_samir', emoji: '🔥', createdAt: at(-1, 19, 48) },
    { id: 'pr_5', postId: 'p_2', userId: 'u_nadia', emoji: '❤️', createdAt: at(-1, 20, 2) },
    { id: 'pr_6', postId: 'p_3', userId: 'u_nadia', emoji: '❤️', createdAt: at(-1, 8, 20) },
    { id: 'pr_7', postId: 'p_3', userId: 'u_samir', emoji: '👏', createdAt: at(-1, 9, 0) },
    { id: 'pr_8', postId: 'p_4', userId: 'u_nadia', emoji: '💪', createdAt: agoMinutes(80) },
    { id: 'pr_9', postId: 'p_4', userId: 'u_samir', emoji: '🔥', createdAt: agoMinutes(74) },
    { id: 'pr_10', postId: 'p_5', userId: 'u_ahmed', emoji: '👏', createdAt: agoMinutes(58) },
    { id: 'pr_11', postId: 'p_6', userId: 'u_nadia', emoji: '🔥', createdAt: agoMinutes(33) },
    { id: 'pr_12', postId: 'p_6', userId: 'u_samir', emoji: '👏', createdAt: agoMinutes(28) },
  ]

  const comments: Comment[] = [
    { id: 'c_1', postId: 'p_1', userId: 'u_nadia', text: 'You have been so consistent lately', createdAt: at(-2, 21, 12) },
    { id: 'c_2', postId: 'p_3', userId: 'u_samir', text: 'That view is unfair', createdAt: at(-1, 9, 4) },
    { id: 'c_3', postId: 'p_4', userId: 'u_samir', text: 'Those are the ones that count', createdAt: agoMinutes(66) },
  ]

  /** Live stories, so the rail has something in it on a fresh install. */
  const storyAt = (minsAgo: number) => agoMinutes(minsAgo)
  const expiresFrom = (minsAgo: number) =>
    new Date(Date.now() - minsAgo * 60_000 + 24 * 60 * 60 * 1000).toISOString()

  const stories: Story[] = [
    {
      id: 'st_1',
      userId: 'u_nadia',
      type: 'photo',
      text: 'Out early',
      mediaId: 'media_track',
      createdAt: storyAt(150),
      expiresAt: expiresFrom(150),
    },
    {
      id: 'st_2',
      userId: 'u_samir',
      type: 'text',
      text: 'Leg day. Pray for me 😅',
      createdAt: storyAt(115),
      expiresAt: expiresFrom(115),
    },
    {
      id: 'st_3',
      userId: 'u_ahmed',
      type: 'workout',
      text: 'Done before work',
      sharedType: 'workout',
      sharedDataId: ahmedsLast?.id,
      createdAt: storyAt(92),
      expiresAt: expiresFrom(92),
    },
  ]

  // Ahmed has already looked at Nadia's; Samir's is still unseen for him.
  const storyViews: StoryView[] = [
    { id: 'sv_1', storyId: 'st_1', userId: 'u_ahmed', viewedAt: agoMinutes(140) },
  ]

  const notifications: AppNotification[] = [
    {
      id: 'n_1',
      userId: 'u_ahmed',
      kind: 'post_reaction',
      actorId: 'u_nadia',
      targetId: 'p_4',
      text: 'Nadia reacted 💪 to your workout',
      href: '/',
      createdAt: agoMinutes(80),
    },
    {
      id: 'n_2',
      userId: 'u_ahmed',
      kind: 'comment',
      actorId: 'u_samir',
      targetId: 'p_4',
      text: 'Samir commented: “Those are the ones that count”',
      href: '/',
      createdAt: agoMinutes(66),
    },
    {
      /*
       * A mention, not "Nadia sent a message". Ordinary chat traffic never
       * becomes a notification — being named is the exception, because it is
       * addressed to one person and usually wants an answer.
       */
      id: 'n_3',
      userId: 'u_ahmed',
      kind: 'mention',
      actorId: 'u_nadia',
      text: 'Nadia mentioned you in Fitness group.',
      href: '/chat/thread',
      createdAt: agoMinutes(31),
    },
    {
      id: 'n_4',
      userId: 'u_ahmed',
      kind: 'story',
      actorId: 'u_samir',
      targetId: 'st_2',
      text: 'Samir added to their story',
      href: '/',
      createdAt: agoMinutes(115),
      readAt: agoMinutes(100),
    },
    {
      id: 'n_5',
      userId: 'u_ahmed',
      kind: 'challenge',
      text: 'The group is over halfway to this week’s challenge',
      href: '/group/challenge',
      createdAt: agoMinutes(220),
      readAt: agoMinutes(210),
    },
  ]

  return { posts, reactions, comments, stories, storyViews, media, notifications }
}


/**
 * Motivation videos are links and nothing else. Titles below were checked
 * against the live pages; swap them for the group's own picks at any time.
 */
function buildVideos(): MotivationVideo[] {
  const videos: [string, string, string, string][] = [
    ['v_consistency', 'Relentless Consistency & Discipline', 'J1s5chcgL8Q', 'Consistency beats motivation.'],
    ['v_discipline', 'The Art of Discipline', '_gucVS4x8SU', 'Discipline gets you there when motivation disappears.'],
    ['v_goggins', 'Consistency & Discipline — David Goggins', 'fFeAeYb0W60', "You're not going to feel like it. Go anyway."],
  ]
  return videos.map(([id, title, videoId, quote], index) => ({
    id,
    title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    provider: 'youtube' as const,
    quote,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    addedBy: 'u_ahmed',
    addedAt: at(-30 + index, 20),
    // All three take part in the weekly rotation; which one is featured is
    // decided by the week, not by a stored flag.
    isActive: true,
    rotationOrder: index,
  }))
}

function buildMeasurements(): BodyMeasurement[] {
  const rows: [string, number, Partial<BodyMeasurement>][] = [
    ['u_ahmed', -70, { waistCm: 94, chestCm: 104, hipsCm: 102, armCm: 33, thighCm: 60, bodyFatPct: 28 }],
    ['u_ahmed', -35, { waistCm: 91, chestCm: 102.5, hipsCm: 100.5, armCm: 33.2, thighCm: 59, bodyFatPct: 26.2 }],
    ['u_ahmed', 0, { waistCm: 88, chestCm: 101, hipsCm: 99, armCm: 33.5, thighCm: 58, bodyFatPct: 24.5 }],
    ['u_nadia', -70, { waistCm: 89, hipsCm: 110, thighCm: 63, bodyFatPct: 36 }],
    ['u_nadia', 0, { waistCm: 85.5, hipsCm: 107, thighCm: 61.5, bodyFatPct: 34 }],
    ['u_samir', -70, { waistCm: 82, chestCm: 98, armCm: 32, bodyFatPct: 19 }],
    ['u_samir', 0, { waistCm: 79, chestCm: 99.5, armCm: 33, bodyFatPct: 16.5 }],
  ]
  return rows.map(([userId, offset, values]) => ({
    id: `m_${userId}_${offset}`,
    userId,
    date: day(offset),
    createdAt: at(offset, 7, 45),
    ...values,
  }))
}

function buildGoals(): Goal[] {
  return [
    { id: 'g_ahmed_1', userId: 'u_ahmed', kind: 'weight', title: 'Reach 72 kg', targetValue: 72, unit: 'kg', targetDate: day(60), createdAt: at(-70, 9) },
    { id: 'g_ahmed_2', userId: 'u_ahmed', kind: 'workouts', title: 'Six sessions a week', targetValue: 6, unit: 'per week', createdAt: at(-70, 9) },
    { id: 'g_nadia_1', userId: 'u_nadia', kind: 'weight', title: 'Reach 78 kg', targetValue: 78, unit: 'kg', targetDate: day(90), createdAt: at(-70, 11) },
    { id: 'g_samir_1', userId: 'u_samir', kind: 'steps', title: '10,000 steps a day', targetValue: 10000, unit: 'steps', createdAt: at(-70, 8) },
  ]
}

// --- Entry point -----------------------------------------------------------

/**
 * Populates an empty database. Existing data is never touched — a reseed is an
 * explicit action (see `resetDatabase`).
 */
export async function seedDatabase(): Promise<void> {
  const { plans, planDays, workoutExercises } = buildPlans()
  const { updates, reactions } = buildUpdates()

  const sessions = [
    ...buildSessions('plan_lose_weight_30', AHMED_PLAN_START, AHMED_SESSIONS),
    ...buildSessions('plan_full_body_beginner', NADIA_PLAN_START, NADIA_SESSIONS),
    ...buildSessions('plan_lose_weight_30', SAMIR_PLAN_START, SAMIR_SESSIONS),
  ]
  const chat = buildChat(sessions)
  const social = buildSocial(sessions)

  const enrollments: PlanEnrollment[] = [
    { id: 'en_ahmed', userId: 'u_ahmed', planId: 'plan_lose_weight_30', startDate: AHMED_PLAN_START, active: true },
    { id: 'en_nadia', userId: 'u_nadia', planId: 'plan_full_body_beginner', startDate: NADIA_PLAN_START, active: true },
    { id: 'en_samir', userId: 'u_samir', planId: 'plan_lose_weight_30', startDate: SAMIR_PLAN_START, active: true },
  ]

  await db.transaction('rw', db.tables, async () => {
    await Promise.all([
      db.users.bulkPut(USERS),
      db.exercises.bulkPut(EXERCISES),
      db.plans.bulkPut(plans),
      db.planDays.bulkPut(planDays),
      db.workoutExercises.bulkPut(workoutExercises),
      db.enrollments.bulkPut(enrollments),
      db.sessions.bulkPut(sessions),
      db.weights.bulkPut(buildWeights()),
      db.measurements.bulkPut(buildMeasurements()),
      db.foods.bulkPut(buildFood()),
      db.water.bulkPut(buildWater()),
      db.steps.bulkPut(buildSteps()),
      db.checkins.bulkPut(buildCheckIns()),
      db.updates.bulkPut(updates),
      db.reactions.bulkPut(reactions),
      db.goals.bulkPut(buildGoals()),
      db.videos.bulkPut(buildVideos()),
      db.messages.bulkPut(chat.messages),
      db.chatReactions.bulkPut(chat.reactions),
      db.posts.bulkPut(social.posts),
      db.postReactions.bulkPut(social.reactions),
      db.comments.bulkPut(social.comments),
      db.stories.bulkPut(social.stories),
      db.storyViews.bulkPut(social.storyViews),
      db.media.bulkPut(social.media),
      db.notifications.bulkPut(social.notifications),
      db.meta.put({ key: 'seedVersion', value: SEED_VERSION }),
      db.meta.put({ key: 'seededOn', value: TODAY }),
    ])
  })

  // Demo accounts get a password so sign-in is a real form rather than a list
  // of people to tap. Hashing happens in authService, so the seed never holds
  // a digest of its own.
  // This week's shared target, so a fresh install opens with a live board.
  await challengeService.ensureWeek(TODAY)

  for (const user of USERS) {
    await authService.setPassword(user.id, DEMO_PASSWORD)
  }

  // Achievements are derived from the seeded history rather than handed out,
  // so every unlocked badge corresponds to something the member actually did.
  // Silent: this is backfill, not news.
  for (const user of USERS) {
    await achievementService.evaluate(user.id, { announce: false })
  }
}

/** Wipes everything and reseeds. Exposed in More → Data for demo purposes. */
export async function resetDatabase(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
  await seedDatabase()
}

/**
 * Runs once per fresh browser profile, and again if the seed shape changed.
 * Keeps `uid` referenced for future generated rows.
 */
export async function ensureSeeded(): Promise<void> {
  const stored = await db.meta.get('seedVersion')
  if (stored?.value === SEED_VERSION) return
  if (stored) {
    await resetDatabase()
    return
  }
  const userCount = await db.users.count()
  if (userCount > 0) {
    await db.meta.put({ key: 'seedVersion', value: SEED_VERSION })
    return
  }
  await seedDatabase()
  await db.meta.put({ key: 'installId', value: uid('install') })
}
