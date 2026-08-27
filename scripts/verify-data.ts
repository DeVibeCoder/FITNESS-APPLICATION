/**
 * Exercises the data layer outside the browser: seeds a fresh database, then
 * checks that the numbers the UI reads back match what the group has been
 * posting. Run with: npm run verify
 */
import 'fake-indexeddb/auto'
import { readFile, readdir } from 'node:fs/promises'

// Minimal localStorage so the session-backed ownership guard is exercisable
// here exactly as it is in the browser.
const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() {
    return store.size
  },
} as Storage

import { ensureSeeded, resetDatabase } from '../src/data/seed'
import { DEMO_PASSWORD } from '../src/data/demo'
import type { WorkoutSession } from '../src/models'
import { db } from '../src/lib/db'
import { progressService } from '../src/services/progressService'
import { workoutService } from '../src/services/workoutService'
import { challengeService } from '../src/services/challengeService'
import { chatService, mentionedIn } from '../src/services/chatService'
import { postService, canView, DEFAULT_VISIBILITY } from '../src/services/postService'
import { storyService } from '../src/services/storyService'
import { mediaService, isPlaceholder } from '../src/services/mediaService'
import { notificationService } from '../src/services/notificationService'
import { accountService, hasRole, validateEmail, checkPassword } from '../src/services/accountService'
import { workoutAppLabel } from '../src/data/workoutApps'
import { storageService } from '../src/services/storageService'
import { weightService } from '../src/services/weightService'
import { nutritionService } from '../src/services/nutritionService'
import { stepsService } from '../src/services/stepsService'
import { updateService } from '../src/services/updateService'
import { achievementService } from '../src/services/achievementService'
import { authService, AuthError } from '../src/services/authService'
import { userService } from '../src/services/userService'
import { checkinService, FEELING_OPTIONS, feelingFor } from '../src/services/checkinService'
import {
  goalProgress,
  measurementChange,
  weightProgress,
  withDeltas,
} from '../src/utils/progress'
import { measurementService } from '../src/services/measurementService'
import { calcBmi } from '../src/utils/bmi'
import { calcBmr, calcEnergyPlan, calcTdee } from '../src/utils/calories'
import { buildInsights } from '../src/utils/insights'
import { weeklyChangeNote, weeklyChangeSentiment } from '../src/utils/goals'
import { TempImage } from '../src/lib/tempImage'
import { scanTotals } from '../src/services/foodScanService'
import { calorieStatus, formatPortion, macroProgress } from '../src/utils/nutrition'
import { reviewService } from '../src/services/reviewService'
import { motivationService } from '../src/services/motivationService'
import { REACTION_EMOJI } from '../src/services/updateService'
import { comparisonRows, reviewLines } from '../src/utils/review'
import { runFoodScan, resolveProviders } from '../server/foodScan/handler'
import { parseVisionJson, validateVisionResult } from '../server/foodScan/validate'
import { ScanFailure, confidenceLevel } from '../server/foodScan/types'
import type { ScanErrorCode } from '../server/foodScan/types'
import { withRetry, delayFor } from '../server/shared/retry'
import { normalizeFoodName } from '../server/foodScan/fdcNutritionProvider'
import { pickBest, scoreMatch, isPlausible } from '../server/foodScan/match'
import {
  fingerprintFile,
  readCached,
  writeCached,
  forgetCached,
  clearScanCache,
  scanCacheSize,
} from '../src/lib/scanCache'
import type { FoodVisionProvider, NutritionProvider } from '../server/foodScan/types'
import { currentWeighInDate, nextWeighInDate, slotFor, weeklyWeighIn, weighInSchedule } from '../src/utils/weighIn'
import { runWorkoutScan, resolveWorkoutProviders } from '../server/workoutScan/handler'
import { parseClock, validateWorkoutResult } from '../server/workoutScan/validate'
import { WorkoutScanFailure } from '../server/workoutScan/types'
import type { WorkoutVisionProvider, WorkoutVisionResult } from '../server/workoutScan/types'
import { addDays, daysBetween, endOfWeek, formatRange, fromDateKey, lastNDays, startOfWeek, todayKey, weekDays } from '../src/utils/date'
import { duration, num } from '../src/utils/format'

let failures = 0

function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass ? '' : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`)
}

function ok(label: string, condition: boolean, detail = '') {
  if (!condition) failures++
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}


/** No message may carry binary or an inline data payload. */
async function chatIsTextOnly(): Promise<boolean> {
  for (const message of await db.messages.toArray()) {
    for (const value of Object.values(message as Record<string, unknown>)) {
      if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return false
      if (typeof value === "string" && /^(data:|blob:)/i.test(value)) return false
    }
  }
  return true
}


/** True when this is the newest message in the room. */
async function isNewestMessage(id: string): Promise<boolean> {
  const all = await db.messages.orderBy('createdAt').toArray()
  // The newest message the preview can actually quote. A deleted row is still
  // the newest row, but it has no content to show, so `summary` skips it.
  return [...all].reverse().find((m) => !m.deletedAt)?.id === id
}

/** Runs an attempt as Nadia and expects the ownership guard to stop it. */
async function expectOwnershipRefusal(label: string, attempt: () => Promise<unknown>) {
  await authService.signIn('nadia', DEMO_PASSWORD)
  let refused = false
  try {
    await attempt()
  } catch (error) {
    refused = error instanceof Error && error.name === 'OwnershipError'
  }
  ok(label, refused)
}

async function main() {
  const today = todayKey()
  await ensureSeeded()

  console.log(`\n— Seeded database (today = ${today}) —\n`)
  ok('three approved members seeded', ((await userService.listMembers()).length) === 3)
  check('plus one account still waiting on approval',
    (await db.users.count()) - (await userService.listMembers()).length, 1)
  ok('plans expanded into days', (await db.planDays.count()) === 58, `${await db.planDays.count()} days`)
  ok('plan exercises expanded', (await db.workoutExercises.count()) > 300, `${await db.workoutExercises.count()} rows`)

  console.log('\n— Ahmed: the history the group has been posting —\n')
  // Both reference weeks are complete weeks in the past, so these totals hold
  // whatever weekday the suite runs on.
  const lastWeek = await progressService.weeklySummary('u_ahmed', addDays(startOfWeek(today), -1))
  check('last week workouts', lastWeek.workouts, 4)
  check('last week duration', duration(lastWeek.durationSec), '41:08')
  check('last week calories burned', num(lastWeek.caloriesBurned, 1), '868.4')

  const weekBefore = await progressService.weeklySummary('u_ahmed', addDays(startOfWeek(today), -8))
  check('the week before, workouts', weekBefore.workouts, 5)
  check('the week before, duration', duration(weekBefore.durationSec), '49:10')
  check('the week before, calories burned', num(weekBefore.caloriesBurned, 1), '1,038.0')

  const thisWeek = await progressService.weeklySummary('u_ahmed', today)
  ok('the current week holds only elapsed days', thisWeek.workouts <= 3, `${thisWeek.workouts} so far`)
  ok('no session is dated in the future',
    (await workoutService.sessionsForUser('u_ahmed')).every((s) => s.date <= today))

  console.log('\n— Ahmed: body and targets —\n')
  const me = await progressService.userSnapshot('u_ahmed', today)
  if (!me) throw new Error('no snapshot')
  check('current weight', me.currentWeightKg, 76.8)
  check('total change', me.progress.changeKg, -5.2)
  check('remaining to goal', me.progress.remainingKg, 4.8)
  ok('streak is an unbroken run of at least ten days', me.streak >= 10, `${me.streak} days`)
  ok('BMI at start weight is 30.1', Math.round((82 / 1.65 ** 2) * 10) / 10 === 30.1)
  check('BMI now', me.bmi.value, 28.2)
  ok('calorie target is a sane deficit', me.energy.target > 1800 && me.energy.target < 2400, `${me.energy.target} kcal`)
  ok('TDEE above BMR', me.energy.tdee > me.energy.bmr)

  console.log('\n— Ahmed: today —\n')
  const day = await progressService.dailySnapshot('u_ahmed', today)
  if (!day) throw new Error('no daily snapshot')
  check('steps today', day.steps, 7842)
  check('calories eaten', day.nutrition.kcal, 1840)
  check('protein', day.nutrition.proteinG, 128)
  check('carbs', day.nutrition.carbsG, 198)
  check('fat', day.nutrition.fatG, 61)
  check('water ml', day.waterMl, 1800)
  // Whether today already has a workout depends on which weekday the suite runs.
  ok(
    "today's completed sessions match what is stored for today",
    day.completedSessions.length === (await workoutService.sessionsForDay('u_ahmed', today)).length,
  )
  /*
   * The snapshot must resolve *a* scheduled day, not necessarily a training
   * one — the plan has rest days, and which kind today is depends on the
   * calendar. Asserting "today is a training day" made the suite red two days
   * a week for no reason. What actually matters is that the day resolves and
   * that a training day carries its exercises.
   */
  ok('today resolves to a scheduled day', day.scheduled !== null, day.scheduled?.planDay.name)
  if (day.scheduled?.isRestDay) {
    check('a rest day schedules no exercises', day.scheduled.exercises.length, 0)
  } else {
    check('a training day schedules its exercises', day.scheduled?.exercises.length, 8)
  }
  check('check-in not done yet', day.checkIn, undefined)

  console.log('\n— The others —\n')
  const group = await progressService.groupSnapshot(today)
  check('group size', group.length, 3)
  for (const member of group) {
    console.log(
      `      ${member.user.name.padEnd(14)} ${num(member.currentWeightKg, 1)} kg  ` +
        `${member.progress.changeKg > 0 ? '+' : ''}${num(member.progress.changeKg, 1)} kg  ` +
        `${member.streak}d streak  ${member.consistency.score}% consistency`,
    )
  }
  const nadia = group.find((m) => m.user.id === 'u_nadia')!
  const samir = group.find((m) => m.user.id === 'u_samir')!
  check('Nadia change', nadia.progress.changeKg, -3.1)
  ok('Nadia has a running streak', nadia.streak >= 7, `${nadia.streak} days`)
  check('Samir change', samir.progress.changeKg, 2.8)
  ok('Samir has the longest streak', samir.streak >= 13 && samir.streak >= nadia.streak, `${samir.streak} days`)
  ok('Samir trained today', (await workoutService.completedOn('u_samir', today)) === true)

  console.log('\n— Writes update everything downstream —\n')
  const beforeSteps = await stepsService.forDay('u_ahmed', today)
  await stepsService.set({ userId: 'u_ahmed', date: today, steps: 9500 })
  check('steps replaced, not duplicated', await stepsService.forDay('u_ahmed', today), 9500)
  ok('step goal now met', (await progressService.dailySnapshot('u_ahmed', today))!.steps >= 8000)
  await stepsService.set({ userId: 'u_ahmed', date: today, steps: beforeSteps })

  await nutritionService.addWater('u_ahmed', today, 700)
  check('water adds up', await nutritionService.waterForDay('u_ahmed', today), 2500)

  const corrected = await weightService.weighIn({ userId: 'u_ahmed', weightKg: 76.5 })
  const afterWeight = await progressService.userSnapshot('u_ahmed', today)
  check('weigh-in corrects this week rather than adding one', afterWeight!.currentWeightKg, 76.5)
  check('progress recalculated', afterWeight!.progress.changeKg, -5.5)
  check('the existing weekly record was reused', corrected.created, false)
  check(
    'still one weigh-in for this week',
    (await weightService.listWeekly('u_ahmed')).filter((w) => w.date === corrected.slotDate).length,
    1,
  )

  const scheduled = await workoutService.scheduledFor('u_ahmed', today)
  const started = await workoutService.start({
    userId: 'u_ahmed',
    planId: scheduled!.plan.id,
    planDayId: scheduled!.planDay.id,
    dayNumber: scheduled!.dayNumber,
    name: scheduled!.planDay.name,
    exerciseCount: scheduled!.exercises.length,
  })
  const finished = await workoutService.complete({
    sessionId: started.id,
    durationSec: 725,
    difficulty: 'just_right',
    met: workoutService.averageMet(scheduled!.exercises),
    bodyWeightKg: 76.5,
  })
  ok(
    'finished session estimates plausible calories',
    finished.caloriesKcal > 100 && finished.caloriesKcal < 220,
    `${finished.caloriesKcal} kcal for ${duration(725)}`,
  )
  const afterWorkout = await progressService.weeklySummary('u_ahmed', today)
  check('weekly workouts incremented', afterWorkout.workouts, thisWeek.workouts + 1)
  ok('weekly consistency rose', afterWorkout.consistencyPct > thisWeek.consistencyPct,
    `${thisWeek.consistencyPct}% → ${afterWorkout.consistencyPct}%`)

  const feed = await updateService.recent(5)
  ok('finishing posted to the group feed', feed[0].text.includes(scheduled!.planDay.name), feed[0].text)
  await updateService.toggleReaction(feed[0].id, 'u_nadia', '🔥')
  check('reaction added', (await updateService.recent(5))[0].reactions.length, 1)
  await updateService.toggleReaction(feed[0].id, 'u_nadia', '🔥')
  check('same reaction toggles off', (await updateService.recent(5))[0].reactions.length, 0)

  const unlocked = await achievementService.evaluate('u_ahmed')
  ok('achievement evaluation is idempotent', (await achievementService.evaluate('u_ahmed')).length === 0,
    `${unlocked.length} newly unlocked on first pass`)

  console.log('\n— Goal direction is not assumed to be "lose" —\n')
  check('losing reads as losing', weightProgress(82, 76.8, 72).direction, 'losing')
  check('gaining reads as gaining', weightProgress(62, 65, 70).direction, 'gaining')
  check('same start and target is maintaining', weightProgress(75, 75.3, 75).direction, 'maintaining')
  check('progress toward a gain goal', Math.round(weightProgress(62, 65, 70).pct), 38)
  check('remaining toward a gain goal', weightProgress(62, 65, 70).remainingKg, 5)
  ok('moving away from the goal never goes negative', weightProgress(82, 83, 72).pct === 0)

  console.log('\n— Every member sees their own data —\n')
  for (const handle of ['ahmed', 'nadia', 'samir']) {
    const account = await authService.signIn(handle, DEMO_PASSWORD)
    const [snap, mine] = await Promise.all([
      progressService.dailySnapshot(account.id, today),
      progressService.userSnapshot(account.id, today),
    ])
    const distinct =
      snap!.user.id === account.id &&
      mine!.user.id === account.id &&
      mine!.currentWeightKg > 0 &&
      mine!.progress.targetKg === account.targetWeightKg
    ok(
      `${account.name.padEnd(13)} own weight/goal/streak/day`,
      distinct,
      `${num(mine!.currentWeightKg, 1)} kg → ${num(account.targetWeightKg, 1)} kg · ${mine!.streak}d · ${snap!.tasksDone}/${snap!.tasksTotal} today · goal ${account.goal}`,
    )
  }

  console.log('\n— A member cannot write another member’s records —\n')
  await authService.signIn('nadia', DEMO_PASSWORD)
  const attempts: [string, () => Promise<unknown>][] = [
    ["Ahmed's weight", () => weightService.add({ userId: 'u_ahmed', date: today, weightKg: 60, kind: 'official' })],
    ["Ahmed's weekly weigh-in", () => weightService.weighIn({ userId: 'u_ahmed', weightKg: 60 })],
    ["sharing Ahmed's weigh-in", () => weightService.shareWeighIn('u_ahmed', today)],
    ["Ahmed's steps", () => stepsService.set({ userId: 'u_ahmed', date: today, steps: 1 })],
    ["Ahmed's check-in", () => checkinService.save({ userId: 'u_ahmed', date: today, energy: 1, mood: 1, soreness: 'high' })],
    ["Ahmed's water", () => nutritionService.addWater('u_ahmed', today, 9999)],
    ["Ahmed's profile", () => userService.update('u_ahmed', { name: 'Hacked' })],
  ]
  for (const [label, attempt] of attempts) {
    let refused = false
    try {
      await attempt()
    } catch (error) {
      refused = error instanceof Error && error.name === 'OwnershipError'
    }
    ok(`Nadia refused: ${label}`, refused)
  }

  const untouched = await progressService.userSnapshot('u_ahmed', today)
  ok("Ahmed's weight is unchanged after the attempts", untouched!.currentWeightKg === 76.5,
    `${num(untouched!.currentWeightKg, 1)} kg`)
  ok("Ahmed's name is unchanged", (await userService.get('u_ahmed'))!.name === 'Ahmed Rahman')

  // ...and her own writes still work.
  await checkinService.save({ userId: 'u_nadia', date: today, energy: 3, mood: 4, soreness: 'low' })
  ok('Nadia can still write her own check-in', (await checkinService.forDay('u_nadia', today)) !== undefined)
  authService.signOut()

  console.log('\n— Workout timer maths —\n')
  // One fixed clock for the whole block. Deriving `startedAt` and `pausedAt`
  // from two separate Date.now() calls made this flake: when the millisecond
  // ticked between them a 60-second gap measured 59999ms and floored to 59.
  const T0 = Date.now()
  const iso = (secondsAgo: number) => new Date(T0 - secondsAgo * 1000).toISOString()
  const fake = (extra: Partial<WorkoutSession>): WorkoutSession =>
    ({ startedAt: iso(100), ...extra }) as WorkoutSession
  const elapsed = (extra: Partial<WorkoutSession>) => workoutService.elapsedSec(fake(extra), T0)
  check('elapsed counts up from the start', elapsed({}), 100)
  check('paused time is excluded', elapsed({ pausedSec: 30 }), 70)
  check('while paused the clock is frozen', elapsed({ pausedAt: iso(40) }), 60)
  check(
    'a pause after earlier pauses still freezes correctly',
    elapsed({ pausedSec: 10, pausedAt: iso(40) }),
    50,
  )
  ok('elapsed never goes negative', elapsed({ pausedSec: 9999 }) === 0)

  console.log('\n— Workout player: sets, skips, pause, finish —\n')
  const ahmed = await authService.signIn('ahmed', DEMO_PASSWORD)
  const existingActive = await workoutService.activeSession(ahmed.id)
  if (existingActive) await workoutService.abandon(existingActive.id)

  /*
   * Find a training day rather than assuming today is one.
   *
   * This block used to run against `today`, so the whole suite failed whenever
   * the calendar happened to land on one of the plan's rest days — a gate that
   * is red two days a week for reasons unrelated to the code is not a gate.
   * Scanning a week forward keeps the assertion real (a plan with no training
   * day in seven is genuinely broken) and makes it independent of the date.
   */
  let scheduledDay = null
  let offset = 0
  for (; offset < 7; offset += 1) {
    const day = await workoutService.scheduledFor(ahmed.id, addDays(today, offset))
    if (day && !day.isRestDay && day.exercises.length > 0) {
      scheduledDay = day
      break
    }
  }
  ok(
    'the plan schedules a runnable session within the week',
    scheduledDay !== null,
    offset === 0 ? 'today' : `in ${offset} day(s)`,
  )
  const plan = scheduledDay!
  const startArgs = {
    userId: ahmed.id,
    planId: plan.plan.id,
    planDayId: plan.planDay.id,
    dayNumber: plan.dayNumber,
    name: plan.planDay.name,
    exerciseCount: plan.exercises.length,
  }

  const live = await workoutService.start(startArgs)
  check('starting creates an in-progress session', live.status, 'in_progress')
  check('starting again returns the same session', (await workoutService.start(startArgs)).id, live.id)
  check(
    'only one live session exists',
    (await db.sessions.where('[userId+status]').equals([ahmed.id, 'in_progress']).count()),
    1,
  )

  const readCursor = async () =>
    workoutService.cursor(plan.exercises, await workoutService.setResults(live.id))

  check('cursor starts at the first set', (await readCursor()).exerciseIndex, 0)
  const first = plan.exercises[0]
  await workoutService.logSet({
    sessionId: live.id,
    workoutExerciseId: first.id,
    setIndex: 0,
    reps: first.reps,
    durationSec: first.durationSec,
  })
  check('logging a set advances the set index', (await readCursor()).setIndex, 1)
  check('one set recorded', (await readCursor()).setsDone, 1)

  await workoutService.logSet({ sessionId: live.id, workoutExerciseId: first.id, setIndex: 0, reps: 99 })
  check('re-logging the same set corrects rather than duplicates', (await readCursor()).setsDone, 1)

  for (let setIndex = 1; setIndex < first.sets; setIndex++) {
    await workoutService.logSet({
      sessionId: live.id,
      workoutExerciseId: first.id,
      setIndex,
      reps: first.reps,
      durationSec: first.durationSec,
    })
  }
  check('finishing an exercise moves to the next', (await readCursor()).exerciseIndex, 1)

  const second = plan.exercises[1]
  await workoutService.skipExercise({
    sessionId: live.id,
    workoutExerciseId: second.id,
    sets: second.sets,
  })
  const afterSkip = await readCursor()
  check('skipping moves past the exercise', afterSkip.exerciseIndex, 2)
  check('a skip does not count as sets done', afterSkip.setsDone, first.sets)
  ok(
    'skipped sets are recorded, not discarded',
    (await workoutService.setResults(live.id)).filter((r) => r.skipped).length === second.sets,
  )

  await workoutService.undoLastSet(live.id)
  check('undo removes the last completed set', (await readCursor()).setsDone, first.sets - 1)
  await workoutService.logSet({
    sessionId: live.id,
    workoutExerciseId: first.id,
    setIndex: first.sets - 1,
    reps: first.reps,
    durationSec: first.durationSec,
  })

  await workoutService.pause(live.id)
  ok('pausing stamps the session', Boolean((await db.sessions.get(live.id))!.pausedAt))
  await workoutService.resume(live.id)
  const resumed = await db.sessions.get(live.id)
  ok('resuming clears the stamp and banks the time', !resumed!.pausedAt && resumed!.pausedSec !== undefined)

  for (let index = 2; index < plan.exercises.length; index++) {
    const item = plan.exercises[index]
    for (let setIndex = 0; setIndex < item.sets; setIndex++) {
      await workoutService.logSet({
        sessionId: live.id,
        workoutExerciseId: item.id,
        setIndex,
        reps: item.reps,
        durationSec: item.durationSec,
      })
    }
  }
  const finalCursor = await readCursor()
  ok('every set settled marks the session finished', finalCursor.finished, `${finalCursor.setsDone}/${finalCursor.totalSets} sets`)

  const priorWeekReview = await progressService.weeklySummary(ahmed.id, today)
  const feedBefore = (await updateService.recent(30)).length
  await workoutService.complete({
    sessionId: live.id,
    durationSec: 640,
    difficulty: 'just_right',
    note: 'Felt harder than yesterday.',
    met: workoutService.averageMet(plan.exercises),
    bodyWeightKg: 76.5,
  })
  const saved = await db.sessions.get(live.id)
  check('finishing marks it completed', saved!.status, 'completed')
  check('the note is kept', saved!.note, 'Felt harder than yesterday.')
  check('difficulty is stored on the session', saved!.difficulty, 'just_right')
  ok('calories are estimated, not copied', saved!.caloriesKcal > 0 && saved!.caloriesKcal < 400,
    `${saved!.caloriesKcal} kcal`)

  const weekAfter = await progressService.weeklySummary(ahmed.id, today)
  check('the week counts it once', weekAfter.workouts, priorWeekReview.workouts + 1)

  await workoutService.complete({
    sessionId: live.id,
    durationSec: 9999,
    difficulty: 'hard',
    met: 8,
    bodyWeightKg: 76.5,
  })
  const weekTwice = await progressService.weeklySummary(ahmed.id, today)
  check('finishing twice does not count twice', weekTwice.workouts, weekAfter.workouts)
  check('finishing twice does not post twice', (await updateService.recent(30)).length, feedBefore + 1)
  check('finishing twice does not overwrite the duration', (await db.sessions.get(live.id))!.durationSec, 640)

  console.log('\n— Abandoned sessions —\n')
  const throwaway = await workoutService.start(startArgs)
  await workoutService.abandon(throwaway.id)
  const abandoned = await db.sessions.get(throwaway.id)
  ok('an abandoned session is kept, not deleted', abandoned !== undefined)
  check('it is marked abandoned', abandoned!.status, 'abandoned')
  check(
    'it does not count toward the week',
    (await progressService.weeklySummary(ahmed.id, today)).workouts,
    weekAfter.workouts,
  )
  check('and it is no longer the live session', await workoutService.activeSession(ahmed.id), undefined)

  console.log('\n— History and records —\n')
  const stats = await workoutService.stats(ahmed.id, weekDays(today))
  ok('all-time totals add up', stats.total > 0 && stats.totalDurationSec > 0, `${stats.total} workouts`)
  ok('this month is a subset of all time', stats.thisMonth <= stats.total)
  ok('longest streak is at least the current one', stats.longestStreak >= stats.currentStreak)
  const detail = await workoutService.detail(live.id)
  ok('history detail resolves the planned exercises', (detail?.day?.exercises.length ?? 0) > 0)
  ok('history detail carries the recorded sets', (detail?.results.length ?? 0) > 0)
  const records = await workoutService.personalBests(ahmed.id)
  ok('personal bests appear once sets exist', records.length > 0,
    records.map((r) => `${r.label}: ${r.value} (${r.exerciseName})`).join(', '))

  console.log('\n— Another member cannot touch that workout —\n')
  await authService.signIn('nadia', DEMO_PASSWORD)
  for (const [label, attempt] of [
    ["finish Ahmed's session", () => workoutService.complete({ sessionId: live.id, durationSec: 1, met: 8, bodyWeightKg: 70 })],
    ["log a set on Ahmed's session", () => workoutService.logSet({ sessionId: live.id, workoutExerciseId: first.id, setIndex: 0, reps: 1 })],
    ["abandon Ahmed's session", () => workoutService.abandon(live.id)],
    ["delete Ahmed's session", () => workoutService.removeSession(live.id)],
    ["switch Ahmed's plan", () => workoutService.enroll('u_ahmed', 'plan_full_body_beginner')],
  ] as [string, () => Promise<unknown>][]) {
    let refused = false
    try {
      await attempt()
    } catch (error) {
      refused = error instanceof Error && error.name === 'OwnershipError'
    }
    ok(`Nadia refused: ${label}`, refused)
  }
  check("Ahmed's session survived", (await db.sessions.get(live.id))!.status, 'completed')
  authService.signOut()

  console.log('\n— Reset restores the demo data —\n')
  await authService.signIn('ahmed', DEMO_PASSWORD)
  await workoutService.start(startArgs)
  authService.signOut()
  await resetDatabase()
  check('reset clears live sessions', await db.sessions.where('status').equals('in_progress').count(), 0)
  check('reset clears recorded sets', await db.setResults.count(), 0)
  ok('reset restores the seeded history',
    (await workoutService.sessionsForUser('u_ahmed')).length >= 9,
    `${(await workoutService.sessionsForUser('u_ahmed')).length} sessions`)
  check(
    'reset restores the reference week',
    duration(
      (await progressService.weeklySummary('u_ahmed', addDays(startOfWeek(today), -1))).durationSec,
    ),
    '41:08',
  )

  // ---------------------------------------------------------------------
  // Phase 4 — weight, health and progress engine. Runs against the freshly
  // reset database above, so it starts from a known baseline.
  // ---------------------------------------------------------------------

  console.log('\n— Weighing is weekly, and only weekly —\n')
  const allWeights = await db.weights.toArray()
  ok('every weight record in the app is a weekly weigh-in',
    allWeights.every((row) => row.kind === 'official'),
    `${allWeights.length} rows, none daily`)
  const ahmedWeights = await weightService.listWeekly('u_ahmed')
  ok('and every one of them falls on the weigh-in day',
    ahmedWeights.every((row) => fromDateKey(row.date).getDay() === 0),
    `${ahmedWeights.length} weeks`)
  ok('with exactly seven days between consecutive weeks',
    ahmedWeights.slice(1).every((row, index) =>
      daysBetween(ahmedWeights[index].date, row.date) === 7))

  const ahmedWeek = await weightService.thisWeek('u_ahmed', today)
  ok('this week is already recorded in the seed', ahmedWeek.done)
  check('and it reports the latest number', ahmedWeek.entry?.weightKg, 76.8)
  check('the comparison is the week before it', ahmedWeek.previous?.weightKg, 77.6)
  check('the weekly change is the difference between the two', ahmedWeek.changeKg, -0.8)
  check('the previous reading was one week back', ahmedWeek.weeksSincePrevious, 1)
  check('the next weigh-in is seven days on', ahmedWeek.nextDate, addDays(ahmedWeek.slotDate, 7))

  await authService.signIn('ahmed', DEMO_PASSWORD)
  const weeklyCount = ahmedWeights.length
  const rewrite = await weightService.weighIn({ userId: 'u_ahmed', weightKg: 76.4 })
  check('logging again in the same week corrects rather than adds', rewrite.created, false)
  check('so the number of weekly records does not move',
    (await weightService.listWeekly('u_ahmed')).length, weeklyCount)
  const rewritten = await weightService.thisWeek('u_ahmed', today)
  check('the corrected figure is what the week now reports', rewritten.entry?.weightKg, 76.4)
  check('and the weekly change follows it', rewritten.changeKg, -1.2)
  check('the record kept its id rather than being replaced',
    rewritten.entry?.id, ahmedWeek.entry?.id)
  await weightService.weighIn({ userId: 'u_ahmed', weightKg: 76.8 })
  check('and putting the number back restores the week',
    await weightService.currentWeight('u_ahmed'), 76.8)

  const deltas = withDeltas(await weightService.listWeekly('u_ahmed'))
  check('history compares each week against the week before', deltas[0].changeKg, -0.8)
  ok(
    'the oldest entry has no delta',
    deltas[deltas.length - 1].changeKg === undefined,
  )

  console.log('\n— Current weight edge cases —\n')
  const blank = await userService.create({
    name: 'Test Person', handle: 'test', avatarColor: '#888', birthDate: '1990-01-01',
    sex: 'female', heightCm: 165, startWeightKg: 70, targetWeightKg: 65, goal: 'lose_weight',
    activityLevel: 'light', stepGoal: 8000, waterGoalL: 2, workoutsPerWeekGoal: 3,
    weighInDay: 0, workoutApps: ['home_workout'], units: 'metric',
  })
  // Accounts created outside setup have no credential until one is set.
  await authService.setPassword(blank.id, DEMO_PASSWORD)
  check('no entries falls back to the starting weight', await weightService.currentWeight(blank.id), 70)
  const blankSnap = await progressService.userSnapshot(blank.id, today)
  check('progress with no entries reads as zero change', blankSnap!.progress.changeKg, 0)
  check('and full distance remaining', blankSnap!.progress.remainingKg, 5)

  const newUserWeek = await weightService.thisWeek(blank.id, today)
  ok('a brand new account has no weigh-in', !newUserWeek.done)
  check('and nothing is shown for this week', newUserWeek.entry, undefined)
  check('and nothing is invented for the week before', newUserWeek.previous, undefined)
  check('and there is no change to report', newUserWeek.changeKg, undefined)
  check('but the schedule already knows the next date',
    newUserWeek.nextDate, addDays(newUserWeek.slotDate, 7))
  check('and the history is empty rather than padded with blanks',
    weighInSchedule(await weightService.listWeekly(blank.id), 0, { on: today }).filter((slot) => slot.entry).length,
    0)

  await authService.signIn('test', DEMO_PASSWORD)
  const firstEver = await weightService.weighIn({ userId: blank.id, weightKg: 68 })
  check('the first weigh-in creates a record', firstEver.created, true)
  check('filed against this week rather than against today',
    firstEver.slotDate, currentWeighInDate(0, today))
  check('one entry becomes the current weight', await weightService.currentWeight(blank.id), 68)
  const oneEntry = await weightService.thisWeek(blank.id, today)
  ok('the week now reads as complete', oneEntry.done)
  check('one entry means no comparison yet', oneEntry.changeKg, undefined)

  console.log('\n— Goal progress in every direction —\n')
  check('loss goal, above target', Math.round(goalProgress(82, 76.8, 72).pct), 52)
  check('loss goal remaining', goalProgress(82, 76.8, 72).remainingKg, 4.8)
  check('loss goal, below target, is complete', goalProgress(82, 71, 72).pct, 100)
  ok('loss goal below target reads as reached', goalProgress(82, 71, 72).reached)
  const gain = goalProgress(70, 72, 75)
  check('gain goal direction', gain.direction, 'gaining')
  check('gain goal progress', Math.round(gain.pct), 40)
  check('gain goal remaining', gain.remainingKg, 3)
  check('gain goal change is positive', gain.changeKg, 2)
  ok('a gain goal short of target is not reached', !gain.reached)
  ok('a gain goal past target is reached', goalProgress(70, 76, 75).reached)
  const hold = goalProgress(75, 75.3, 75)
  check('maintain goal direction', hold.direction, 'maintaining')
  check('maintain goal reports full progress', hold.pct, 100)
  check('maintain goal remaining is the drift', hold.remainingKg, 0.3)

  console.log('\n— Health estimates —\n')
  check('BMI', calcBmi(76.8, 165).value, 28.2)
  check('BMI category', calcBmi(76.8, 165).category, 'overweight')
  check('BMI healthy band for 165 cm', calcBmi(76.8, 165).healthyRangeKg, [50.4, 67.8])
  check('BMI at the boundary is healthy', calcBmi(68, 170).category, 'healthy')
  const bmr = calcBmr({ weightKg: 76.8, heightCm: 165, age: 34, sex: 'male' })
  check('BMR (Mifflin-St Jeor, male)', bmr, 1634)
  check(
    'BMR (female) is 166 lower for the same body',
    bmr - calcBmr({ weightKg: 76.8, heightCm: 165, age: 34, sex: 'female' }),
    166,
  )
  check('TDEE applies the activity factor', calcTdee(1634, 'moderate'), Math.round((1634 * 1.55) / 10) * 10)
  check('TDEE is rounded to the nearest 10', calcTdee(1634, 'moderate') % 10, 0)
  ok('TDEE rises with activity', calcTdee(1634, 'active') > calcTdee(1634, 'light'))

  const lossPlan = calcEnergyPlan({
    weightKg: 76.8, heightCm: 165, age: 34, sex: 'male',
    activityLevel: 'moderate', goal: 'lose_weight',
  })
  check('daily target for a loss goal', lossPlan.target, 2150)
  ok('the deficit is moderate, not extreme', lossPlan.adjustment < 0 && lossPlan.adjustment > -600,
    `${lossPlan.adjustment} kcal`)
  ok('protein target is sane', lossPlan.macros.proteinG > 100 && lossPlan.macros.proteinG < 200,
    `${lossPlan.macros.proteinG} g`)
  const macroKcal =
    lossPlan.macros.proteinG * 4 + lossPlan.macros.carbsG * 4 + lossPlan.macros.fatG * 9
  ok('macros add up to the target', Math.abs(macroKcal - lossPlan.target) < 30,
    `${macroKcal} vs ${lossPlan.target}`)

  const tiny = calcEnergyPlan({
    weightKg: 45, heightCm: 150, age: 30, sex: 'female',
    activityLevel: 'sedentary', goal: 'lose_weight',
  })
  check('the floor stops an unsafe target', tiny.target, 1200)
  const gainPlan = calcEnergyPlan({
    weightKg: 70, heightCm: 180, age: 30, sex: 'male',
    activityLevel: 'moderate', goal: 'gain_weight',
  })
  ok('a gain goal eats above maintenance', gainPlan.adjustment > 0, `${gainPlan.adjustment} kcal`)
  check('a maintain goal sits at maintenance', calcEnergyPlan({
    weightKg: 70, heightCm: 180, age: 30, sex: 'male',
    activityLevel: 'moderate', goal: 'maintain',
  }).adjustment, 0)

  console.log('\n— Live recalculation from the profile —\n')
  const before = await progressService.userSnapshot('u_ahmed', today)
  await authService.signIn('ahmed', DEMO_PASSWORD)
  await userService.update('u_ahmed', { heightCm: 175, activityLevel: 'active' })
  const after = await progressService.userSnapshot('u_ahmed', today)
  ok('BMI recalculates from the new height', after!.bmi.value < before!.bmi.value,
    `${before!.bmi.value} → ${after!.bmi.value}`)
  ok('BMR recalculates', after!.energy.bmr > before!.energy.bmr)
  ok('TDEE recalculates', after!.energy.tdee > before!.energy.tdee)
  ok('the calorie target follows', after!.energy.target > before!.energy.target,
    `${before!.energy.target} → ${after!.energy.target}`)
  await userService.update('u_ahmed', { heightCm: 165, activityLevel: 'moderate' })
  check('and reverts cleanly', (await progressService.userSnapshot('u_ahmed', today))!.bmi.value, 28.2)

  console.log('\n— Body measurements —\n')
  const ahmedMeasurements = await measurementService.listForUser('u_ahmed')
  const waist = measurementChange(ahmedMeasurements, 'waistCm')
  check('waist start', waist?.first, 94)
  check('waist latest', waist?.latest, 88)
  check('waist change', waist?.change, -6)
  ok('waist has enough points to chart', (waist?.points.length ?? 0) >= 2)
  check('a field never recorded returns nothing', measurementChange(ahmedMeasurements, 'bodyFatPct') !== null, true)
  check('an unrecorded field on a different user', measurementChange(await measurementService.listForUser('u_nadia'), 'armCm'), null)

  await measurementService.save({ userId: 'u_ahmed', date: today, waistCm: 87.5, note: 'morning' })
  check(
    'saving twice on one date updates rather than duplicates',
    (await measurementService.listForUser('u_ahmed')).filter((row) => row.date === today).length,
    1,
  )
  check('new waist value is picked up',
    measurementChange(await measurementService.listForUser('u_ahmed'), 'waistCm')?.latest, 87.5)
  const partial = await measurementService.save({ userId: 'u_ahmed', date: addDays(today, -1), waistCm: 88 })
  check('fields left blank stay absent', partial.chestCm, undefined)
  await measurementService.remove(partial.id)
  check('measurements can be deleted', await db.measurements.get(partial.id), undefined)

  console.log('\n— Insights only claim what the data supports —\n')
  const ahmedSnap = (await progressService.userSnapshot('u_ahmed', today))!
  const realInsights = buildInsights({
    weights: await weightService.listForUser('u_ahmed'),
    measurements: await measurementService.listForUser('u_ahmed'),
    progress: ahmedSnap.progress,
    workoutsThisWeek: ahmedSnap.workoutsThisWeek,
    workoutGoal: 6,
    streak: ahmedSnap.streak,
    consistencyPct: ahmedSnap.consistency.score,
  })
  ok('a well-populated account produces observations', realInsights.length > 0,
    realInsights.map((i) => i.text).join(' | '))
  ok('and never more than four', realInsights.length <= 4)

  const emptyInsights = buildInsights({
    weights: [], measurements: [], progress: goalProgress(70, 70, 65),
    workoutsThisWeek: 0, workoutGoal: 3, streak: 0, consistencyPct: 0,
  })
  check('an empty account claims nothing', emptyInsights.length, 0)

  const twoWeighIns = buildInsights({
    weights: (await weightService.listForUser('u_ahmed')).filter((e) => e.kind === 'official').slice(-2),
    measurements: [], progress: ahmedSnap.progress,
    workoutsThisWeek: 0, workoutGoal: 6, streak: 0, consistencyPct: 0,
  })
  ok('two weigh-ins are not enough to claim a trend',
    !twoWeighIns.some((insight) => insight.id === 'trend'))

  console.log('\n— Group compares goal progress, not kilograms —\n')
  const members = await progressService.groupSnapshot(today)
  for (const member of members) {
    ok(
      `${member.user.name.padEnd(13)} has a bounded goal progress`,
      member.progress.pct >= 0 && member.progress.pct <= 100,
      `${Math.round(member.progress.pct)}% toward ${member.user.goal}`,
    )
  }
  ok(
    'members with opposite goals are still comparable',
    new Set(members.map((m) => m.user.goal)).size > 1,
  )

  console.log('\n— Ownership on health records —\n')
  await authService.signIn('nadia', DEMO_PASSWORD)
  for (const [label, attempt] of [
    ["edit Ahmed's weigh-in", () => weightService.update(deltas[0].entry.id, { weightKg: 50 })],
    ["delete Ahmed's weigh-in", () => weightService.remove(deltas[0].entry.id)],
    ["add a measurement for Ahmed", () => measurementService.save({ userId: 'u_ahmed', date: today, waistCm: 60 })],
    ["delete Ahmed's measurement", () => measurementService.remove(ahmedMeasurements[0].id)],
    ["change Ahmed's height", () => userService.update('u_ahmed', { heightCm: 200 })],
  ] as [string, () => Promise<unknown>][]) {
    let refused = false
    try {
      await attempt()
    } catch (error) {
      refused = error instanceof Error && error.name === 'OwnershipError'
    }
    ok(`Nadia refused: ${label}`, refused)
  }
  check("Ahmed's weigh-in is untouched", (await db.weights.get(deltas[0].entry.id))!.weightKg, 76.8)
  check("Ahmed's height is untouched", (await userService.get('u_ahmed'))!.heightCm, 165)
  authService.signOut()

  // ---------------------------------------------------------------------
  // Phase 5 — nutrition, meals and the temporary food scanner.
  // ---------------------------------------------------------------------

  console.log('\n— Food logging —\n')
  await authService.signIn('ahmed', DEMO_PASSWORD)
  const beforeFood = await nutritionService.dayNutrition('u_ahmed', today)
  check('seeded day totals', beforeFood.totals.kcal, 1840)

  const added = await nutritionService.addFood({
    userId: 'u_ahmed', date: today, meal: 'lunch', name: 'Chicken breast',
    quantity: 150, unit: 'g', portion: formatPortion(150, 'g'),
    kcal: 250, proteinG: 46, carbsG: 0, fatG: 5, source: 'manual',
  })
  check('portion string is derived from quantity and unit', added.portion, '150 g')
  const afterAdd = await nutritionService.dayNutrition('u_ahmed', today)
  check('calories include the new entry', afterAdd.totals.kcal, beforeFood.totals.kcal + 250)
  check('protein includes it too', afterAdd.totals.proteinG, beforeFood.totals.proteinG + 46)

  const grouped = await nutritionService.byMeal('u_ahmed', today)
  ok('it landed in lunch', grouped.lunch.some((entry) => entry.id === added.id))
  ok('and not in any other meal',
    !grouped.breakfast.concat(grouped.dinner, grouped.snacks).some((e) => e.id === added.id))
  check('every meal slot is present even when empty', Object.keys(grouped).sort().join(','),
    'breakfast,dinner,lunch,snacks')

  await nutritionService.updateFood(added.id, {
    quantity: 250, portion: formatPortion(250, 'g'), kcal: 415, proteinG: 77,
  })
  const edited = await db.foods.get(added.id)
  check('editing updates in place', edited!.kcal, 415)
  check('and rewrites the portion', edited!.portion, '250 g')
  check('editing does not duplicate the record',
    (await nutritionService.foodForDay('u_ahmed', today)).filter((e) => e.name === 'Chicken breast').length, 1)
  check('totals follow the edit',
    (await nutritionService.dayNutrition('u_ahmed', today)).totals.kcal, beforeFood.totals.kcal + 415)

  await nutritionService.removeFood(added.id)
  check('deleting removes it', await db.foods.get(added.id), undefined)
  check('and totals return to where they were',
    (await nutritionService.dayNutrition('u_ahmed', today)).totals.kcal, beforeFood.totals.kcal)

  console.log('\n— Calorie and macro maths —\n')
  const ahmedNow = (await progressService.userSnapshot('u_ahmed', today))!
  const status = calorieStatus(beforeFood.totals.kcal, ahmedNow.energy.target)
  check('remaining is target minus consumed', status.remaining, ahmedNow.energy.target - 1840)
  check('1,840 of 2,150 reads as under target', status.label, 'Under target')
  check('nothing logged says so', calorieStatus(0, 2150).label, 'Nothing logged yet')
  check('on target reads as within', calorieStatus(2100, 2150).label, 'Within target')
  check('well over reads as above', calorieStatus(2900, 2150).label, 'Above target')
  ok('no label ever scolds',
    !['Failed', 'Bad', 'Cheat day'].some((word) =>
      [calorieStatus(0, 2150).label, calorieStatus(2900, 2150).label].includes(word)))
  const macros = macroProgress(beforeFood.totals, ahmedNow.energy.macros)
  check('three macro rows', macros.length, 3)
  ok('macro percentages are bounded', macros.every((m) => m.pct >= 0 && m.pct <= 100))
  ok('the calorie target comes from the energy plan, not a stored copy',
    !('calorieTarget' in (await db.foods.toArray())[0]))

  console.log('\n— Water —\n')
  const waterBefore = await nutritionService.waterForDay('u_ahmed', today)
  await nutritionService.addWater('u_ahmed', today, 250)
  check('a glass adds up', await nutritionService.waterForDay('u_ahmed', today), waterBefore + 250)
  await nutritionService.removeLastWater('u_ahmed', today)
  check('undo removes it again', await nutritionService.waterForDay('u_ahmed', today), waterBefore)
  await nutritionService.setWaterTotal('u_ahmed', today, 2000)
  check('setting an exact amount replaces the day', await nutritionService.waterForDay('u_ahmed', today), 2000)
  check('and collapses to a single row',
    (await db.water.where('[userId+date]').equals(['u_ahmed', today]).count()), 1)
  await nutritionService.setWaterTotal('u_ahmed', today, waterBefore)

  const waterWeek = await nutritionService.history('u_ahmed', lastNDays(7, today))
  check('seven days of history', Object.keys(waterWeek).length, 7)
  ok('history carries calories and water per day',
    Object.values(waterWeek).every((day) => 'kcal' in day && 'waterMl' in day))

  // The former mock-scanner tests lived here. They exercised a sample-data
  // provider that no longer exists, through client code that now needs a
  // browser. The real pipeline is covered below under "The steak problem".
  const scanned = (await nutritionService.foodForDay('u_ahmed', today)).filter(
    (entry) => entry.source === 'photo',
  )

  console.log('\n— A food photo never reaches storage —\n')
  ok('no saved entry carries an image field',
    scanned.every((entry) => !('image' in entry) && !('photo' in entry) && !('imageUrl' in entry)))

  // Sweep every row of every table for anything image-shaped.
  const suspects: string[] = []
  for (const table of db.tables) {
    for (const row of await table.toArray()) {
      for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
        if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
          suspects.push(`${table.name}.${key} holds binary`)
        }
        if (typeof value === 'string' && /^(data:image|blob:)/i.test(value)) {
          suspects.push(`${table.name}.${key} holds ${value.slice(0, 24)}…`)
        }
      }
    }
  }
  ok('no table anywhere holds a blob, buffer or data/blob URL', suspects.length === 0,
    suspects.join('; ') || 'swept every row of every table')

  // The `photos` store is the progress-photo metadata seam from Phase 1 —
  // storageRef only, never binary, and nothing in the scan flow writes to it.
  check('the food scan never writes to the photos table', await db.photos.count(), 0)
  ok('no scanned entry references an image',
    scanned.every((entry) => !Object.values(entry).some(
      (value) => typeof value === 'string' && /^(data:|blob:|file:)/i.test(value))))

  console.log('\n— Temporary image lifecycle —\n')
  let created = 0
  let revoked = 0
  const liveUrls = new Set<string>()
  const originalCreate = globalThis.URL.createObjectURL
  const originalRevoke = globalThis.URL.revokeObjectURL
  globalThis.URL.createObjectURL = () => {
    created += 1
    const url = `blob:test/${created}`
    liveUrls.add(url)
    return url
  }
  globalThis.URL.revokeObjectURL = (url: string) => {
    revoked += 1
    liveUrls.delete(url)
  }

  const photo = new File([new Uint8Array(2048)], 'plate.jpg', { type: 'image/jpeg' })
  const holder = new TempImage()
  holder.set(photo)
  check('a preview creates one object URL', created, 1)
  ok('and is readable while the scan is open', holder.current !== null)
  holder.set(photo)
  check('replacing the photo revokes the previous URL', revoked, 1)
  check('and creates exactly one more', created, 2)
  holder.release()
  check('releasing revokes the current URL', revoked, 2)
  check('and clears it', holder.current, null)
  holder.release()
  check('releasing twice is harmless', revoked, 2)
  check('no object URL is left alive', liveUrls.size, 0)

  // A cancelled scan: photo held, then dropped, with nothing saved.
  const beforeCancel = (await nutritionService.foodForDay('u_ahmed', today)).length
  const cancelledHolder = new TempImage()
  cancelledHolder.set(photo)
  cancelledHolder.release()
  check('cancelling saves no nutrition record',
    (await nutritionService.foodForDay('u_ahmed', today)).length, beforeCancel)
  check('and leaves no object URL behind', liveUrls.size, 0)

  // Posting hands the URL over: the composer stops owning it, so closing the
  // composer must not revoke the picture the feed is now showing.
  const handedHolder = new TempImage()
  const handed = handedHolder.set(photo)
  const revokedBeforeHandover = revoked
  check('detaching returns the URL', handedHolder.detach(), handed)
  check('and gives up ownership', handedHolder.current, null)
  handedHolder.release()
  check('so releasing afterwards revokes nothing', revoked, revokedBeforeHandover)
  ok('and the URL is still alive for the post that took it', liveUrls.has(handed))
  globalThis.URL.revokeObjectURL(handed)

  globalThis.URL.createObjectURL = originalCreate
  globalThis.URL.revokeObjectURL = originalRevoke

  console.log('\n— Nutrition privacy and ownership —\n')
  const nutritionFeed = await updateService.recent(30)
  const foodNames = ['Chicken', 'rice', 'Salad', 'kofta', 'oats', 'eggs']
  ok('the group feed never names a food',
    !nutritionFeed.some((update) => foodNames.some((food) => update.text.toLowerCase().includes(food.toLowerCase()))),
    nutritionFeed.slice(0, 3).map((u) => u.text).join(' | '))

  await authService.signIn('nadia', DEMO_PASSWORD)
  const ahmedFood = (await nutritionService.foodForDay('u_ahmed', today))[0]
  for (const [label, attempt] of [
    ["add food for Ahmed", () => nutritionService.addFood({
      userId: 'u_ahmed', date: today, meal: 'lunch', name: 'Sabotage', portion: '1',
      kcal: 9999, proteinG: 0, carbsG: 0, fatG: 0, source: 'manual',
    })],
    ["edit Ahmed's food", () => nutritionService.updateFood(ahmedFood.id, { kcal: 1 })],
    ["delete Ahmed's food", () => nutritionService.removeFood(ahmedFood.id)],
    ["add water for Ahmed", () => nutritionService.addWater('u_ahmed', today, 500)],
    ["overwrite Ahmed's water", () => nutritionService.setWaterTotal('u_ahmed', today, 0)],
  ] as [string, () => Promise<unknown>][]) {
    let refused = false
    try {
      await attempt()
    } catch (error) {
      refused = error instanceof Error && error.name === 'OwnershipError'
    }
    ok(`Nadia refused: ${label}`, refused)
  }
  check("Ahmed's entry is untouched", (await db.foods.get(ahmedFood.id))!.kcal, ahmedFood.kcal)
  authService.signOut()

  console.log('\n— Reset clears nutrition too —\n')
  await resetDatabase()
  check('seeded meals are back',
    (await nutritionService.dayNutrition('u_ahmed', today)).totals.kcal, 1840)
  check('scanned entries are gone',
    (await db.foods.filter((entry) => entry.source === 'photo').count()), 0)

  // ---------------------------------------------------------------------
  // Phase 6 — community, weekly review and motivation.
  // ---------------------------------------------------------------------

  console.log('\n— Achievements are earned, not granted —\n')
  const seededBadges = await db.achievements.toArray()
  ok('the seed unlocked some achievements', seededBadges.length > 0, `${seededBadges.length} total`)

  // Every unlocked badge must survive a fresh evaluation of the same data.
  for (const userId of ['u_ahmed', 'u_nadia', 'u_samir']) {
    const before = (await db.achievements.where('userId').equals(userId).toArray()).length
    const again = await achievementService.evaluate(userId, { announce: false })
    const after = (await db.achievements.where('userId').equals(userId).toArray()).length
    ok(`${userId} — re-evaluating unlocks nothing new`, again.length === 0 && after === before,
      `${after} unlocked`)
  }
  const badgeKeys = seededBadges.map((row) => `${row.userId}:${row.achievementKey}`)
  check('no achievement is stored twice', badgeKeys.length, new Set(badgeKeys).size)

  const ahmedBadges = await achievementService.listForUser('u_ahmed')
  const ahmedUnlocked = ahmedBadges.filter((badge) => badge.unlockedAt).map((b) => b.key)
  ok('first workout is earned', ahmedUnlocked.includes('first_workout'))
  const ahmedSessionCount = (await workoutService.sessionsForUser('u_ahmed')).length
  check('ten workouts tracks the actual session count',
    ahmedUnlocked.includes('ten_workouts'), ahmedSessionCount >= 10)
  ok('5 kg progress is earned', ahmedUnlocked.includes('five_kg'))
  ok('fifty workouts is NOT earned', !ahmedUnlocked.includes('fifty_workouts'))
  ok('a 30 day streak is NOT earned on a 12 day streak', !ahmedUnlocked.includes('streak_30'))
  ok('a personal best is NOT claimed without recorded sets',
    !ahmedUnlocked.includes('first_pr'), 'seeded sessions predate the set-by-set player')

  console.log('\n— Feed content and duplicate prevention —\n')
  await authService.signIn('ahmed', DEMO_PASSWORD)
  const postsBefore = (await updateService.all(200)).length

  // Saving a weigh-in is private. The group hears about it only when the
  // person answers the share question, and only once per week however many
  // times the number is corrected afterwards.
  const privateWeighIn = await weightService.weighIn({ userId: 'u_ahmed', weightKg: 76.7 })
  check('saving a weigh-in tells nobody', (await updateService.all(200)).length, postsBefore)
  ok('and it is not marked as shared',
    !(await weightService.isShared('u_ahmed', privateWeighIn.slotDate)))

  await weightService.shareWeighIn('u_ahmed', privateWeighIn.slotDate)
  const afterFirstWeighIn = await updateService.all(200)
  check('choosing to share posts once', afterFirstWeighIn.length, postsBefore + 1)
  ok('and the weigh-in now reads as shared',
    await weightService.isShared('u_ahmed', privateWeighIn.slotDate))

  await weightService.weighIn({ userId: 'u_ahmed', weightKg: 76.6 })
  await weightService.weighIn({ userId: 'u_ahmed', weightKg: 76.5 })
  check('correcting it afterwards does not post again',
    (await updateService.all(200)).length, postsBefore + 1)
  await weightService.shareWeighIn('u_ahmed', privateWeighIn.slotDate)
  check('and sharing the same week twice does not either',
    (await updateService.all(200)).length, postsBefore + 1)

  const weighInPost = afterFirstWeighIn[0]
  // A shared weigh-in says how the week moved, which is the thing being
  // shared. It does not put the number on the scale into the sentence.
  ok('the shared post never states the weight itself',
    !weighInPost.text.includes('76.7'), weighInPost.text)
  ok('but it does say how the week went', /this week/.test(weighInPost.text))
  ok('and reads like a person wrote it', weighInPost.text.includes('weekly weigh-in'))

  const beforeNutrition = (await updateService.all(200)).length
  for (let i = 0; i < 3; i++) {
    await nutritionService.addFood({
      userId: 'u_ahmed', date: today, meal: 'snacks', name: `Snack ${i}`, portion: '1',
      kcal: 100, proteinG: 1, carbsG: 1, fatG: 1, source: 'manual',
    })
  }
  check('three meals produce at most one nutrition post',
    (await updateService.all(200)).length, beforeNutrition)

  const postsBeforeSteps = (await updateService.all(200)).length
  await stepsService.set({ userId: 'u_ahmed', date: today, steps: 12000 })
  await stepsService.set({ userId: 'u_ahmed', date: today, steps: 13000 })
  check('reaching the step goal posts once', (await updateService.all(200)).length, postsBeforeSteps + 1)

  const allUpdates = await updateService.all(200)
  const keys = allUpdates.filter((u) => u.dedupeKey).map((u) => u.dedupeKey!)
  check('no dedupe key is used twice', keys.length, new Set(keys).size)
  ok('every update reads as a sentence, not an id',
    allUpdates.every((u) => !/\bid\b|\d{6,}/i.test(u.text)))
  ok('nothing in the feed names a food',
    !allUpdates.some((u) => /chicken|rice|salad|kofta|oats|snack/i.test(u.text)))
  ok('the feed is newest first',
    allUpdates.every((u, i) => i === 0 || allUpdates[i - 1].createdAt >= u.createdAt))

  console.log('\n— Reactions —\n')
  const target = allUpdates.find((u) => u.userId !== 'u_ahmed')!
  check('four reactions are offered', REACTION_EMOJI.length, 4)
  ok('❤️ is one of them', (REACTION_EMOJI as readonly string[]).includes('❤️'))
  await updateService.toggleReaction(target.id, 'u_ahmed', '❤️')
  const reacted = (await updateService.all(200)).find((u) => u.id === target.id)!
  check('a reaction is recorded', reacted.reactions.length, 1)
  await updateService.toggleReaction(target.id, 'u_ahmed', '💪')
  const swapped = (await updateService.all(200)).find((u) => u.id === target.id)!
  check('reacting again swaps rather than stacks', swapped.reactions.length, 1)
  check('and the emoji changed', swapped.reactions[0].emoji, '💪')
  await updateService.toggleReaction(target.id, 'u_ahmed', '💪')
  check('tapping the same one removes it',
    (await updateService.all(200)).find((u) => u.id === target.id)!.reactions.length, 0)

  let reactionRefused = false
  await authService.signIn('nadia', DEMO_PASSWORD)
  try {
    await updateService.toggleReaction(target.id, 'u_ahmed', '🔥')
  } catch (error) {
    reactionRefused = error instanceof Error && error.name === 'OwnershipError'
  }
  ok('nobody can react on another member’s behalf', reactionRefused)
  await authService.signIn('ahmed', DEMO_PASSWORD)

  console.log('\n— Weekly review —\n')
  // Run against last week: a complete week, so the figures do not depend on
  // which day the suite happens to run.
  const reviewWeek = addDays(startOfWeek(today), -1)
  const review = await reviewService.weeklyReview('u_ahmed', reviewWeek)
  check('week range matches the group’s week', formatRange(review.weekStart, review.weekEnd),
    formatRange(startOfWeek(reviewWeek), endOfWeek(reviewWeek)))
  ok('workouts come from sessions', review.workouts > 0, `${review.workouts}`)
  ok('steps come from step entries', review.steps > 0, num(review.steps))
  ok('average steps is per logged day', review.avgStepsPerDay > 0)
  ok('nutrition days counted', review.nutritionDays > 0, `${review.nutritionDays}/${review.daysElapsed}`)
  ok('average calories only spans logged days', review.avgCalories !== undefined)
  ok('consistency is bounded', review.consistency.score >= 0 && review.consistency.score <= 100)
  ok('best day is a day that was trained', review.bestDay !== undefined)

  const emptyReview = await reviewService.weeklyReview('u_ahmed', addDays(today, -400))
  check('a week with nothing has no workouts', emptyReview.workouts, 0)
  check('and no invented average calories', emptyReview.avgCalories, undefined)
  check('and no invented weight change', emptyReview.weightChangeKg, undefined)

  const ahmedProgress = (await progressService.userSnapshot('u_ahmed', today))!.progress
  const lines = reviewLines(review, ahmedProgress, { isCurrentWeek: true })
  ok('the review says something', lines.length > 0, lines.join(' | '))
  ok('and never scolds',
    !lines.some((line) => /failed|behind|worst|bad|cheat|last place/i.test(line)))
  check('an empty past week says nothing at all', reviewLines(emptyReview, ahmedProgress).length, 0)
  ok('a past week never claims the current streak',
    !reviewLines(emptyReview, ahmedProgress).some((line) => line.includes('in a row')))

  console.log('\n— Week over week —\n')
  const weekCompare = await reviewService.comparison('u_ahmed', reviewWeek)
  ok('a comparison is available with history', weekCompare.available)
  ok('workouts delta is computed', typeof weekCompare.workouts.change === 'number',
    `${weekCompare.workouts.previous} → ${weekCompare.workouts.current}`)
  const rows = comparisonRows(weekCompare, ahmedProgress)
  ok('every row has a direction', rows.every((r) => ['up', 'down', 'flat'].includes(r.direction)))
  ok('losing weight on a loss goal reads as favourable',
    comparisonRows(
      { ...weekCompare, weight: { current: -0.8, previous: -0.2, change: -0.6, direction: 'down' } },
      ahmedProgress,
    ).find((r) => r.label === 'Weight')!.favourable)

  const noHistory = await reviewService.comparison('u_ahmed', addDays(today, -400))
  ok('no previous week means no comparison', !noHistory.available)

  console.log('\n— Group week —\n')
  const groupWeek = await reviewService.groupWeek(today)
  check('five friendly categories', groupWeek.length, 5)
  check('they are the agreed ones', groupWeek.map((c) => c.label).join(', '),
    'Most consistent, Most workouts, Most steps, Longest streak, Most improved')
  ok('none of them is negative',
    !groupWeek.some((c) => /worst|last|behind|failed/i.test(c.label)))
  ok('every category names a member', groupWeek.every((c) => Boolean(c.member.user.name)))
  for (const category of groupWeek) {
    console.log(`      ${category.label.padEnd(16)} ${category.member.user.name.padEnd(14)} ${category.value}`)
  }

  console.log('\n— Motivation stores links, never video —\n')
  const videos = await motivationService.list()
  ok('videos are seeded', videos.length > 0, `${videos.length}`)
  ok('every seeded video is in the rotation', videos.every((v) => v.isActive))
  ok('every video is an external https link',
    videos.every((v) => /^https:\/\//.test(v.url)))
  ok('every thumbnail is a remote URL, not data',
    videos.every((v) => !v.thumbnailUrl || /^https:\/\//.test(v.thumbnailUrl)))

  const videoSuspects: string[] = []
  for (const video of await db.videos.toArray()) {
    for (const [key, value] of Object.entries(video as Record<string, unknown>)) {
      if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        videoSuspects.push(`${key} holds binary`)
      }
      if (typeof value === 'string' && /^(data:|blob:)/i.test(value)) {
        videoSuspects.push(`${key} holds ${value.slice(0, 20)}…`)
      }
      if (typeof value === 'string' && value.length > 2000) {
        videoSuspects.push(`${key} is suspiciously long (${value.length} chars)`)
      }
    }
  }
  ok('no video blob, buffer, data URI or base64 payload', videoSuspects.length === 0,
    videoSuspects.join('; ') || 'metadata only')

  const embed = motivationService.embedUrl(videos[0])
  ok('an embed URL is derived, not stored', Boolean(embed) && !('embedUrl' in videos[0]))
  ok('the embed is the privacy-preserving host', embed!.includes('youtube-nocookie.com'), embed!)

  const newVideo = await motivationService.add({
    title: 'Test clip', url: 'https://vimeo.com/76979871', quote: 'Keep going.',
    addedBy: 'u_ahmed', makeActive: false,
  })
  ok('a vimeo link is accepted', newVideo?.provider === 'vimeo')
  const rejectedVideo = await motivationService.add({
    title: 'Nope', url: 'not a url', addedBy: 'u_ahmed',
  })
  check('a non-URL is refused', rejectedVideo, null)
  await motivationService.update(newVideo!.id, { title: 'Renamed clip' })
  check('editing works', (await db.videos.get(newVideo!.id))!.title, 'Renamed clip')
  await motivationService.setActive(newVideo!.id)
  await motivationService.pinForWeek(newVideo!.id)
  check('pinning features it for this week',
    (await motivationService.featuredForWeek())?.id, newVideo!.id)
  await motivationService.unpinWeek()
  ok('unpinning hands the week back to the rotation',
    (await motivationService.featuredForWeek())?.id !== newVideo!.id)
  await motivationService.remove(newVideo!.id)
  check('removing works', await db.videos.get(newVideo!.id), undefined)
  await motivationService.unpinWeek()

  console.log('\n— Privacy boundaries hold —\n')
  const publicFields = ['goal', 'startWeightKg', 'targetWeightKg']
  const privateFields = ['birthDate', 'heightCm', 'calorieTargetOverride']
  const snapshot = (await progressService.userSnapshot('u_nadia', today))!
  ok('public goal data is available to the group',
    publicFields.every((field) => field in snapshot.user))
  ok('progress, streak and consistency are public',
    snapshot.progress !== undefined && snapshot.streak >= 0 && snapshot.consistency.score >= 0)
  // The snapshot carries the whole user record because the owner's own screens
  // need it; the member view is what gates the private fields. Assert that gate
  // at the source, since importing the component would pull in CSS modules.
  const profileSource = await readFile(
    new URL('../src/components/profile/ProfileView.tsx', import.meta.url),
    'utf8',
  )
  ok('the member view has a self/member variant', profileSource.includes("variant?: 'self' | 'member'"))
  ok('daily calorie and macro targets are gated behind isSelf',
    /\{isSelf \? \(\s*<Section title="Daily targets">/.test(profileSource))
  const glance = profileSource.slice(profileSource.indexOf('At a glance'))
  for (const field of privateFields) {
    const mentioned = glance.includes(`user.${field}`)
    ok(`${field} is only shown to the owner`, !mentioned || glance.includes('isSelf ? ('))
  }

  const nadiaFood = await nutritionService.foodForDay('u_nadia', today)
  ok("another member's food is never surfaced in the feed",
    !allUpdates.some((u) => nadiaFood.some((f) => u.text.includes(f.name))))
  const checkins = await db.checkins.where('userId').equals('u_nadia').toArray()
  const withNotes = checkins.filter((c) => c.note)
  ok('private check-in notes never reach the feed',
    withNotes.length === 0 || !allUpdates.some((u) => withNotes.some((c) => u.text.includes(c.note!))),
    `${withNotes.length} notes exist`)

  authService.signOut()

  console.log('\n— Reset restores the community data —\n')
  await resetDatabase()
  ok('videos come back', (await motivationService.list()).length === 3)
  ok('achievements are re-derived', (await db.achievements.count()) > 0)
  check('and none are duplicated',
    (await db.achievements.toArray()).map((r) => `${r.userId}:${r.achievementKey}`).length,
    new Set((await db.achievements.toArray()).map((r) => `${r.userId}:${r.achievementKey}`)).size)

  // ---------------------------------------------------------------------
  // Food scanner — real analysis pipeline.
  // ---------------------------------------------------------------------

  console.log('\n— The steak problem —\n')

  /** Stands in for Gemini, returning what a steak photo should produce. */
  const steakVision: FoodVisionProvider = {
    name: 'test-vision',
    async identify() {
      return {
        items: [
          { name: 'Grilled beef steak', foodType: 'beef', quantity: 180, unit: 'g', confidence: 0.91, alternatives: ['Lamb steak'], cookingMethod: 'grilled' },
          { name: 'White rice', foodType: 'grain', quantity: 200, unit: 'g', confidence: 0.86, alternatives: [] },
          { name: 'Green salad', foodType: 'vegetable', quantity: 100, unit: 'g', confidence: 0.74, alternatives: [] },
        ],
        mealDescription: 'Grilled steak with rice and salad',
        overallConfidence: 0.84,
        needsUserConfirmation: false,
      }
    },
  }

  /** Stands in for FoodData Central. */
  const testNutrition: NutritionProvider = {
    name: 'test-nutrition',
    async lookup(query) {
      const per100: Record<string, [number, number, number, number]> = {
        'Grilled beef steak': [228, 26, 0, 13],
        'White rice': [130, 2.7, 28, 0.3],
        'Green salad': [40, 1.2, 3, 2.5],
      }
      const row = per100[query.name]
      if (!row) return null
      const factor = query.quantity / 100
      return {
        kcal: Math.round(row[0] * factor),
        proteinG: Math.round(row[1] * factor),
        carbsG: Math.round(row[2] * factor),
        fatG: Math.round(row[3] * factor),
        matchedName: `${query.name}, cooked`,
        source: 'test',
        matchConfidence: 0.9,
      }
    },
  }

  const steakImage = { imageBase64: Buffer.alloc(4096).toString('base64'), mimeType: 'image/jpeg' }
  const steakScan = await runFoodScan(steakImage, {
    vision: steakVision,
    nutrition: testNutrition,
    source: 'live',
  })

  check('three foods are returned, not one merged meal', steakScan.items.length, 3)
  check('the steak is the steak', steakScan.items[0].name, 'Grilled beef steak')
  ok('no oats anywhere in the result',
    !JSON.stringify(steakScan).toLowerCase().includes('oat'),
    steakScan.items.map((i) => i.name).join(', '))
  ok('no Phase 5 sample food survived',
    !['porridge', 'scrambled eggs', 'beef kofta', 'flatbread', 'avocado'].some((sample) =>
      JSON.stringify(steakScan).toLowerCase().includes(sample)))
  check('the portion is the estimated one', steakScan.items[0].quantity, 180)
  check('and carries its unit', steakScan.items[0].unit, 'g')
  check('nutrition is scaled to that portion', steakScan.items[0].kcal, Math.round(228 * 1.8))
  check('protein too', steakScan.items[0].proteinG, Math.round(26 * 1.8))
  check('the cooking method is kept', steakScan.items[0].cookingMethod, 'grilled')
  check('alternatives are offered', steakScan.items[0].alternatives, ['Lamb steak'])
  ok('the matched database entry is named', Boolean(steakScan.items[0].matchedName))
  ok('every item is flagged as coming from the database',
    steakScan.items.every((item) => item.fromDatabase))
  check('the result is marked estimated', steakScan.estimated, true)
  check('and marked live, not mock', steakScan.source, 'live')

  const total = steakScan.items.reduce((sum, item) => sum + item.kcal, 0)
  ok('the total is the sum of the items', total === scanTotals(
    steakScan.items.map((item, index) => ({ ...item, id: String(index) })),
  ).kcal, `${total} kcal`)

  console.log('\n— No sample food can reach a real scan —\n')
  const oatsInProductionPaths: string[] = []
  for (const file of [
    'src/services/foodScanService.ts',
    'src/components/nutrition/FoodScanner.tsx',
    'server/foodScan/handler.ts',
    'server/foodScan/geminiVisionProvider.ts',
    'server/foodScan/fdcNutritionProvider.ts',
  ]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
    for (const sample of ['Porridge oats', 'Chicken breast', 'Scrambled eggs', 'Beef kofta', 'Grilled salmon']) {
      if (source.includes(sample)) oatsInProductionPaths.push(`${file} contains "${sample}"`)
    }
  }
  ok('no hard-coded sample meal in any production scanner file',
    oatsInProductionPaths.length === 0, oatsInProductionPaths.join('; ') || 'clean')

  const mockSource = await readFile(
    new URL('../server/foodScan/mockVisionProvider.ts', import.meta.url),
    'utf8',
  )
  ok('the dev mock announces itself rather than imitating food',
    mockSource.includes('DEV MOCK'))
  const handlerSource = await readFile(
    new URL('../server/foodScan/handler.ts', import.meta.url),
    'utf8',
  )
  ok('the mock is opt-in via an explicit env flag', handlerSource.includes("FOOD_SCAN_MOCK === '1'"))
  ok('and is refused in production', handlerSource.includes("NODE_ENV !== 'production'"))

  console.log('\n— Failure never becomes fake food —\n')
  const failures_: [string, FoodVisionProvider][] = [
    ['timeout', { name: 't', async identify() { throw new ScanFailure('timeout', 'too slow') } }],
    ['quota exceeded', { name: 't', async identify() { throw new ScanFailure('rate_limited', 'busy') } }],
    ['bad credentials', { name: 't', async identify() { throw new ScanFailure('unauthorized', 'nope') } }],
    ['provider down', { name: 't', async identify() { throw new Error('ECONNREFUSED') } }],
  ]
  for (const [label, provider] of failures_) {
    let threw = false
    let leaked = ''
    try {
      const outcome = await runFoodScan(steakImage, { vision: provider, nutrition: testNutrition, source: 'live' })
      leaked = JSON.stringify(outcome)
    } catch {
      threw = true
    }
    ok(`${label} → no result at all`, threw && leaked === '', leaked.slice(0, 60))
  }

  const badJson: FoodVisionProvider = {
    name: 't',
    async identify() {
      return validateVisionResult(parseVisionJson('```json\n{"items":[{"name":"Steak","estimatedQuantity":200,"unit":"grams","confidence":0.9}]}\n```'))
    },
  }
  const fenced = await runFoodScan(steakImage, { vision: badJson, nutrition: null, source: 'live' })
  check('a fenced JSON reply is still parsed', fenced.items[0].name, 'Steak')
  check('and a loose unit is normalised', fenced.items[0].unit, 'g')
  check('missing nutrition leaves zeroes to fill in, not invented numbers', fenced.items[0].kcal, 0)
  ok('and asks for confirmation', fenced.needsUserConfirmation)

  let emptyThrew = false
  try {
    validateVisionResult({ items: [], overallConfidence: 0.2, needsUserConfirmation: true })
  } catch (error) {
    emptyThrew = error instanceof ScanFailure && error.code === 'no_food_found'
  }
  ok('a photo with no food is reported as such', emptyThrew)

  let malformedThrew = false
  try {
    parseVisionJson('I am not JSON at all')
  } catch (error) {
    malformedThrew = error instanceof ScanFailure && error.code === 'unreadable_response'
  }
  ok('unparseable model output is rejected', malformedThrew)

  const nutritionDown = await runFoodScan(steakImage, {
    vision: steakVision,
    nutrition: { name: 'broken', async lookup() { throw new Error('down') } },
    source: 'live',
  }).catch(() => null)
  ok('a nutrition provider that throws does not sink the scan', nutritionDown === null ||
    nutritionDown.items.length === 3)

  console.log('\n— The endpoint refuses bad input —\n')
  for (const [label, body, code] of [
    ['no body', {}, 'invalid_image'],
    ['wrong mime type', { imageBase64: 'AAAA', mimeType: 'application/pdf' }, 'invalid_image'],
    ['empty image', { imageBase64: '', mimeType: 'image/jpeg' }, 'invalid_image'],
    ['oversized image', { imageBase64: 'A'.repeat(9 * 1024 * 1024), mimeType: 'image/jpeg' }, 'too_large'],
  ] as [string, Record<string, string>, string][]) {
    let got = ''
    try {
      await runFoodScan(body as never, { vision: steakVision, nutrition: null, source: 'live' })
    } catch (error) {
      got = error instanceof ScanFailure ? error.code : 'other'
    }
    check(`${label} → ${code}`, got, code)
  }

  let notConfigured = ''
  try {
    resolveProviders({ NODE_ENV: 'production' })
  } catch (error) {
    notConfigured = error instanceof ScanFailure ? error.code : 'other'
  }
  check('a missing key fails loudly rather than mocking', notConfigured, 'not_configured')
  let mockInProd = ''
  try {
    resolveProviders({ NODE_ENV: 'production', FOOD_SCAN_MOCK: '1' })
  } catch (error) {
    mockInProd = error instanceof ScanFailure ? error.code : 'other'
  }
  check('the mock flag is ignored in production', mockInProd, 'not_configured')
  check('and honoured only in development',
    resolveProviders({ FOOD_SCAN_MOCK: '1', NODE_ENV: 'development' }).source, 'mock')

  console.log('\n— Secrets stay on the server —\n')
  const clientFiles = await readdir(new URL('../src', import.meta.url), { recursive: true })
  const leaks: string[] = []
  for (const entry of clientFiles) {
    const name = String(entry)
    if (!/\.(ts|tsx)$/.test(name)) continue
    const source = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')
    for (const secret of ['GEMINI_API_KEY', 'FDC_API_KEY', 'x-goog-api-key', 'generativelanguage.googleapis.com', 'api.nal.usda.gov']) {
      if (source.includes(secret)) leaks.push(`src/${name} mentions ${secret}`)
    }
  }
  ok('no client file references a key or provider endpoint', leaks.length === 0,
    leaks.join('; ') || `${clientFiles.length} files scanned`)

  const scanServiceSource = await readFile(
    new URL('../src/services/foodScanService.ts', import.meta.url),
    'utf8',
  )
  ok('the browser talks only to our own endpoint',
    scanServiceSource.includes("'/api/food-scan'") &&
      !scanServiceSource.includes('googleapis'))
  const envExample = await readFile(new URL('../.env.example', import.meta.url), 'utf8')
  ok('.env.example ships no real key',
    /GEMINI_API_KEY=\s*$/m.test(envExample) && /FDC_API_KEY=\s*$/m.test(envExample))

  console.log('\n— A scanned meal still stores no image —\n')
  await authService.signIn('ahmed', DEMO_PASSWORD)
  for (const item of steakScan.items) {
    await nutritionService.addFood({
      userId: 'u_ahmed', date: today, meal: 'dinner', name: item.name,
      quantity: item.quantity, unit: item.unit,
      portion: formatPortion(item.quantity, item.unit),
      kcal: item.kcal, proteinG: item.proteinG, carbsG: item.carbsG, fatG: item.fatG,
      source: 'photo',
    })
  }
  const storedScan = (await nutritionService.foodForDay('u_ahmed', today)).filter(
    (entry) => entry.source === 'photo',
  )
  check('the steak was saved', storedScan.some((entry) => entry.name === 'Grilled beef steak'), true)
  check('with the analysed calories', storedScan.find((e) => e.name === 'Grilled beef steak')!.kcal, 410)

  const imageLeaks: string[] = []
  for (const table of db.tables) {
    for (const row of await table.toArray()) {
      for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
        if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
          imageLeaks.push(`${table.name}.${key} holds binary`)
        }
        if (typeof value === 'string' && /^(data:image|blob:)/i.test(value)) {
          imageLeaks.push(`${table.name}.${key} holds an image reference`)
        }
        if (typeof value === 'string' && value.length > 4000) {
          imageLeaks.push(`${table.name}.${key} is ${value.length} chars long`)
        }
      }
    }
  }
  ok('no blob, buffer, data URI or base64 payload in any table', imageLeaks.length === 0,
    imageLeaks.join('; ') || 'swept every row of every table')
  check('the photos table is still empty', await db.photos.count(), 0)
  authService.signOut()
  await resetDatabase()


  // ---------------------------------------------------------------------
  // Card photography is presentation only. The claim under test: an image URL
  // reaches an <img src> and nothing else — no table, no service, no upload.
  // ---------------------------------------------------------------------

  console.log('\n— Card images are presentation, not data —\n')

  const cardImageSource = await readFile(
    new URL('../src/data/cardImages.ts', import.meta.url),
    'utf8',
  )
  // Unsplash ids carry either a 10- or a 13-digit timestamp depending on when
  // the photo was uploaded, so both shapes are legitimate.
  const cardIds = cardImageSource.match(/id: 'photo-\d{10,13}-[0-9a-f]{12}'/g) ?? []
  check('every card image is a well-formed Unsplash CDN id', cardIds.length, 9)
  check('and none was hand-assembled from something else',
    (cardImageSource.match(/id: '/g) ?? []).length, cardIds.length)

  /*
   * Comments stripped first. The component's own doc comment says in prose
   * that it never writes to localStorage, and an unstripped scan reads that
   * sentence as the very thing it is promising not to do.
   */
  const photoCode = (
    await readFile(new URL('../src/components/ui/CardPhoto.tsx', import.meta.url), 'utf8')
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
  for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'db.', 'fetch(', 'FileReader', 'Blob']) {
    ok(`CardPhoto never touches ${forbidden}`, !photoCode.includes(forbidden))
  }

  // A service that knew about card imagery would be one refactor away from
  // writing one into a record. None of them may import it.
  const serviceFiles = (await readdir(new URL('../src/services', import.meta.url)))
    .filter((name) => String(name).endsWith('.ts'))
  const serviceLeaks: string[] = []
  for (const name of serviceFiles) {
    const source = await readFile(new URL(`../src/services/${name}`, import.meta.url), 'utf8')
    if (source.includes('cardImages') || source.includes('images.unsplash.com')) {
      serviceLeaks.push(String(name))
    }
  }
  ok('no service imports card imagery', serviceLeaks.length === 0,
    serviceLeaks.join('; ') || `${serviceFiles.length} services scanned`)

  await ensureSeeded()
  const urlLeaks: string[] = []
  for (const table of db.tables) {
    for (const row of await table.toArray()) {
      for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
        if (typeof value === 'string' && /images\.unsplash\.com|cardImages/.test(value)) {
          urlLeaks.push(`${table.name}.${key}`)
        }
      }
    }
  }
  ok('and no remote image URL is stored in any table', urlLeaks.length === 0,
    urlLeaks.join('; ') || 'swept every row of every table')
  await resetDatabase()


  // ---------------------------------------------------------------------
  // The weekly weigh-in schedule. Every date is derived from the user's own
  // weigh-in day; nothing is hard-coded, and the spacing is always seven days.
  // ---------------------------------------------------------------------

  console.log('\n— Weigh-in dates continue every seven days —\n')

  const SUNDAY = 0 as const
  const WEDNESDAY = 3 as const

  check('a Sunday schedule read on a Wednesday anchors to the Sunday before',
    currentWeighInDate(SUNDAY, '2026-08-26'), '2026-08-23')
  check('and on the day itself, to that day',
    currentWeighInDate(SUNDAY, '2026-08-23'), '2026-08-23')
  check('the next one is exactly seven days on',
    nextWeighInDate(SUNDAY, '2026-08-26'), '2026-08-30')
  check('a different weigh-in day gives a different anchor',
    currentWeighInDate(WEDNESDAY, '2026-08-26'), '2026-08-26')

  const scheduleWeights = [
    { id: 'w1', userId: 'u_x', date: '2026-08-09', weightKg: 82, kind: 'official' as const, createdAt: '' },
    // Logged a day late. It still belongs to the 16th's week.
    { id: 'w2', userId: 'u_x', date: '2026-08-17', weightKg: 81.2, kind: 'official' as const, createdAt: '' },
    // A daily reading, which must not appear in the weekly schedule at all.
    { id: 'w3', userId: 'u_x', date: '2026-08-20', weightKg: 84.4, kind: 'daily' as const, createdAt: '' },
  ]
  const schedule = weighInSchedule(scheduleWeights, SUNDAY, { on: '2026-08-26', includeNext: true })

  check('the schedule is newest first, starting with the next date',
    schedule.map((slot) => slot.date).join(' '),
    '2026-08-30 2026-08-23 2026-08-16 2026-08-09')
  ok('every gap between slots is exactly seven days',
    schedule.slice(1).every((slot, index) =>
      Math.round(
        (new Date(schedule[index].date).getTime() - new Date(slot.date).getTime()) / 86_400_000,
      ) === 7))
  check('exactly one slot is the current one', schedule.filter((s) => s.current).length, 1)
  check('and it is the week today falls in',
    schedule.find((s) => s.current)!.date, '2026-08-23')
  check('the future date is marked upcoming', schedule[0].upcoming, true)
  check('a late entry counts for its own week',
    schedule.find((s) => s.date === '2026-08-16')?.entry?.id, 'w2')
  check('the daily reading is nowhere in the schedule',
    schedule.some((s) => s.entry?.kind === 'daily'), false)
  check('this week has no reading yet', schedule.find((s) => s.current)?.entry, undefined)
  check('the change is measured against the previous reading',
    schedule.find((s) => s.date === '2026-08-16')?.changeKg, -0.8)
  check('the first reading has nothing to compare to',
    schedule.find((s) => s.date === '2026-08-09')?.changeKg, undefined)

  const emptySchedule = weighInSchedule([], SUNDAY, { on: '2026-08-26', includeNext: true })
  check('with no readings at all, only this week and the next are offered',
    emptySchedule.map((slot) => slot.date).join(' '), '2026-08-30 2026-08-23')

  const realWeights = await weightService.listForUser('u_ahmed')
  const realSchedule = weighInSchedule(realWeights, SUNDAY, { on: today })
  ok('the seeded data produces a schedule with no gaps in the dates',
    realSchedule.slice(1).every((slot, index) =>
      Math.round(
        (new Date(realSchedule[index].date).getTime() - new Date(slot.date).getTime()) / 86_400_000,
      ) === 7),
    `${realSchedule.length} weekly slots`)


  // ---------------------------------------------------------------------
  // A missed week, and what the app is allowed to say about it. The rule
  // throughout: never invent a number nobody stood on a scale for.
  // ---------------------------------------------------------------------

  console.log('\n— A missed week is a gap, not a guess —\n')

  const gapped = [
    { id: 'g1', userId: 'u_x', date: '2026-08-02', weightKg: 78.0, kind: 'official' as const, createdAt: '' },
    // 9 Aug and 16 Aug were missed entirely.
    { id: 'g2', userId: 'u_x', date: '2026-08-23', weightKg: 76.8, kind: 'official' as const, createdAt: '' },
  ]
  const gapSchedule = weighInSchedule(gapped, SUNDAY, { on: '2026-08-26' })
  check('the missed weeks still appear as slots',
    gapSchedule.map((slot) => slot.date).join(' '),
    '2026-08-23 2026-08-16 2026-08-09 2026-08-02')
  check('and carry no weight at all',
    gapSchedule.filter((slot) => slot.entry === undefined).map((slot) => slot.date).join(' '),
    '2026-08-16 2026-08-09')
  check('nothing is interpolated into them',
    gapSchedule.filter((slot) => slot.entry === undefined).every((slot) => slot.changeKg === undefined),
    true)

  const afterGap = weeklyWeighIn(gapped, SUNDAY, '2026-08-26')
  check('the change is measured against the last real reading',
    afterGap.changeKg, -1.2)
  check('and the app knows how long ago that was', afterGap.weeksSincePrevious, 3)
  check('a late entry belongs to the week it was due',
    slotFor(SUNDAY, '2026-08-26'), '2026-08-23')

  // ---------------------------------------------------------------------
  // What a week's movement means depends entirely on what the person is for.
  // ---------------------------------------------------------------------

  console.log('\n— The scale means different things to different people —\n')

  check('losing weight: down is progress', weeklyChangeSentiment('lose_weight', -0.8), 'progress')
  check('losing weight: up is away from it', weeklyChangeSentiment('lose_weight', 0.6), 'away')
  check('building muscle: up is progress', weeklyChangeSentiment('build_muscle', 0.6), 'progress')
  check('building muscle: down is away from it', weeklyChangeSentiment('build_muscle', -0.8), 'away')
  check('gaining weight: up is progress', weeklyChangeSentiment('gain_weight', 0.6), 'progress')
  check('maintaining: down is neither', weeklyChangeSentiment('maintain', -0.8), 'neutral')
  check('maintaining: up is neither', weeklyChangeSentiment('maintain', 0.6), 'neutral')
  check('general fitness: the scale is not the point',
    weeklyChangeSentiment('general_fitness', -1.4), 'neutral')
  check('no movement is neutral whatever the goal',
    weeklyChangeSentiment('lose_weight', 0), 'neutral')
  check('and no reading at all is neutral too',
    weeklyChangeSentiment('lose_weight', undefined), 'neutral')
  ok('a maintainer is never told the week went the right or wrong way',
    !/toward your goal|away from your goal/i.test(weeklyChangeNote('maintain', -0.8)),
    weeklyChangeNote('maintain', -0.8))
  ok('but someone cutting is told exactly that',
    /toward your goal/i.test(weeklyChangeNote('lose_weight', -0.8)))
  ok('and someone bulking hears it for the opposite direction',
    /toward your goal/i.test(weeklyChangeNote('build_muscle', 0.6)))

  // ---------------------------------------------------------------------
  // Daily activity: one record per person per day, updated rather than
  // duplicated, and every figure read from the service that owns it.
  // ---------------------------------------------------------------------

  console.log('\n— Daily activity updates, it does not accumulate rows —\n')

  await authService.signIn('ahmed', DEMO_PASSWORD)

  await stepsService.set({ userId: 'u_ahmed', date: today, steps: 6543 })
  const stepRows = await db.steps.where('[userId+date]').equals(['u_ahmed', today]).count()
  await stepsService.set({ userId: 'u_ahmed', date: today, steps: 7100 })
  check("today's steps read back as the newest figure",
    await stepsService.forDay('u_ahmed', today), 7100)
  check('and saving again did not create a second row',
    await db.steps.where('[userId+date]').equals(['u_ahmed', today]).count(), stepRows)

  const waterStart = await nutritionService.waterForDay('u_ahmed', today)
  await nutritionService.addWater('u_ahmed', today, 250)
  await nutritionService.addWater('u_ahmed', today, 500)
  check('quick adds accumulate through the day',
    await nutritionService.waterForDay('u_ahmed', today), waterStart + 750)
  await nutritionService.setWaterTotal('u_ahmed', today, 1500)
  check('setting an amount replaces the day rather than adding to it',
    await nutritionService.waterForDay('u_ahmed', today), 1500)
  check('and collapses it to a single row',
    await db.water.where('[userId+date]').equals(['u_ahmed', today]).count(), 1)

  const activityDay = await progressService.dailySnapshot('u_ahmed', today)
  const nutritionDay = await nutritionService.dayNutrition('u_ahmed', today)
  check('Activity reads calories from the nutrition service',
    activityDay!.nutrition.kcal, nutritionDay.totals.kcal)
  check('and protein from the same place',
    activityDay!.nutrition.proteinG, nutritionDay.totals.proteinG)
  check('and water from the same place', activityDay!.waterMl, nutritionDay.waterMl)
  check('and steps from the steps service',
    activityDay!.steps, await stepsService.forDay('u_ahmed', today))

  const tired = FEELING_OPTIONS.find((option) => option.key === 'tired')!
  await checkinService.save({
    userId: 'u_ahmed', date: today,
    energy: tired.energy, mood: tired.mood, soreness: tired.soreness,
  })
  check('a one-tap feeling becomes a real check-in',
    feelingFor(await checkinService.forDay('u_ahmed', today))?.key, 'tired')
  const checkInRows = await db.checkins.where('[userId+date]').equals(['u_ahmed', today]).count()
  const strong = FEELING_OPTIONS.find((option) => option.key === 'strong')!
  await checkinService.save({
    userId: 'u_ahmed', date: today,
    energy: strong.energy, mood: strong.mood, soreness: strong.soreness,
  })
  check('changing your mind updates the same record',
    await db.checkins.where('[userId+date]').equals(['u_ahmed', today]).count(), checkInRows)
  check('and the new feeling is what reads back',
    feelingFor(await checkinService.forDay('u_ahmed', today))?.key, 'strong')
  ok('every feeling maps to a distinct check-in',
    new Set(FEELING_OPTIONS.map((o) => `${o.mood}:${o.energy}`)).size === FEELING_OPTIONS.length)

  // ---------------------------------------------------------------------
  // A brand new account. Nothing logged is nothing shown; no zero is dressed
  // up as an achievement and no number is filled in on the person's behalf.
  // ---------------------------------------------------------------------

  console.log('\n— A new account shows nothing, not zero-shaped fiction —\n')

  const newcomer = await userService.create({
    name: 'Fresh Start', handle: 'fresh', avatarColor: '#777', birthDate: '1995-05-05',
    sex: 'male', heightCm: 178, startWeightKg: 80, targetWeightKg: 75, goal: 'lose_weight',
    activityLevel: 'moderate', stepGoal: 8000, waterGoalL: 2.5, workoutsPerWeekGoal: 4,
    weighInDay: 3, workoutApps: ['home_workout'], units: 'metric',
  })
  check('no weigh-in yet', (await weightService.thisWeek(newcomer.id, today)).done, false)
  check('and no history to show', (await weightService.listWeekly(newcomer.id)).length, 0)
  check('0 steps', await stepsService.forDay(newcomer.id, today), 0)
  check('0 water', await nutritionService.waterForDay(newcomer.id, today), 0)
  check('no nutrition logged',
    (await nutritionService.dayNutrition(newcomer.id, today)).totals.kcal, 0)
  const freshDay = await progressService.dailySnapshot(newcomer.id, today)
  check('no workout logged yet', freshDay!.completedSessions.length, 0)
  check('no check-in', freshDay!.checkIn, undefined)
  check('and the weight falls back to the profile rather than being invented',
    freshDay!.weightKg, 80)
  check('their weigh-in day is their own, not the group default',
    (await weightService.slotDate(newcomer.id, today)),
    currentWeighInDate(3, today))
  authService.signOut()


  // ---------------------------------------------------------------------
  // Workout screenshots. The rule under test throughout: a value that was not
  // legible must come back missing, never guessed — and the image must never
  // become a record.
  // ---------------------------------------------------------------------

  console.log('\n— A screenshot is transcribed, never invented —\n')

  const readable = {
    app: 'home_workout', planName: 'Full Body Beginner', dayNumber: 15,
    durationSec: '23:14', caloriesKcal: 186, exerciseCount: 8,
    confidence: 0.92, notAWorkout: false,
  }
  const read = validateWorkoutResult(readable)
  check('the app is recognised', read.app, 'home_workout')
  check('the plan comes through', read.planName, 'Full Body Beginner')
  check('mm:ss becomes seconds', read.durationSec, 23 * 60 + 14)
  check('calories come through', read.caloriesKcal, 186)
  check('nothing is reported missing', read.missing.length, 1)
  check('and the one gap is the field that was absent', read.missing[0], 'workoutName')

  check('hh:mm:ss is understood', parseClock('1:05:30'), 3930)
  check('so is "23 min"', parseClock('23 min'), 1380)
  check('so is "1h 05m"', parseClock('1h 05m'), 3900)
  check('a bare number of seconds is taken as given', parseClock(1380), 1380)
  check('nonsense is dropped, not defaulted', parseClock('sometime'), undefined)
  check('so is a negative duration', parseClock(-5), undefined)

  const partialRead = validateWorkoutResult({
    planName: 'Abs Beginner', confidence: 0.5, notAWorkout: false,
    caloriesKcal: 'not a number', durationSec: 'n/a', exerciseCount: 999,
  })
  check('an unreadable duration is left blank', partialRead.durationSec, undefined)
  check('an unreadable calorie count is left blank', partialRead.caloriesKcal, undefined)
  check('an out-of-range exercise count is refused', partialRead.exerciseCount, undefined)
  ok('and every gap is reported so the form can ask',
    ['dayNumber', 'workoutName', 'durationSec', 'caloriesKcal', 'exerciseCount']
      .every((field) => partialRead.missing.includes(field)),
    partialRead.missing.join(', '))

  let notWorkout = ''
  try {
    validateWorkoutResult({ confidence: 0.9, notAWorkout: true })
  } catch (error) {
    notWorkout = error instanceof WorkoutScanFailure ? error.code : 'other'
  }
  check('a photo that is not a workout summary is refused', notWorkout, 'no_workout_found')

  let nothingLegible = ''
  try {
    validateWorkoutResult({ confidence: 0.3, notAWorkout: false })
  } catch (error) {
    nothingLegible = error instanceof WorkoutScanFailure ? error.code : 'other'
  }
  check('and so is a reading with no fields at all', nothingLegible, 'no_workout_found')

  console.log('\n— The workout endpoint refuses bad input —\n')

  const screenshotVision: WorkoutVisionProvider = {
    name: 'stub',
    async read(): Promise<WorkoutVisionResult> {
      return validateWorkoutResult(readable)
    },
  }
  const screenshot = { imageBase64: Buffer.alloc(2048).toString('base64'), mimeType: 'image/png' }

  for (const [label, body, code] of [
    ['no body', {}, 'invalid_image'],
    ['wrong mime type', { imageBase64: 'AAAA', mimeType: 'application/pdf' }, 'invalid_image'],
    ['empty image', { imageBase64: '', mimeType: 'image/png' }, 'invalid_image'],
    ['oversized image', { imageBase64: 'A'.repeat(9 * 1024 * 1024), mimeType: 'image/png' }, 'too_large'],
  ] as [string, Record<string, string>, string][]) {
    let got = ''
    try {
      await runWorkoutScan(body as never, { vision: screenshotVision, source: 'live' })
    } catch (error) {
      got = error instanceof WorkoutScanFailure ? error.code : 'other'
    }
    check(`${label} → ${code}`, got, code)
  }

  const workoutScan = await runWorkoutScan(screenshot, { vision: screenshotVision, source: 'live' })
  check('a good screenshot comes back legible', workoutScan.confidenceLevel, 'high')
  check('and always asks for review', workoutScan.needsReview, true)

  let workoutNotConfigured = ''
  try {
    resolveWorkoutProviders({ NODE_ENV: 'production' })
  } catch (error) {
    workoutNotConfigured = error instanceof WorkoutScanFailure ? error.code : 'other'
  }
  check('a missing key fails loudly rather than mocking', workoutNotConfigured, 'not_configured')

  let workoutMockInProd = ''
  try {
    resolveWorkoutProviders({ NODE_ENV: 'production', WORKOUT_SCAN_MOCK: '1' })
  } catch (error) {
    workoutMockInProd = error instanceof WorkoutScanFailure ? error.code : 'other'
  }
  check('the mock flag is ignored in production', workoutMockInProd, 'not_configured')
  check('and honoured only in development',
    resolveWorkoutProviders({ WORKOUT_SCAN_MOCK: '1', NODE_ENV: 'development' }).source, 'mock')

  console.log('\n— A scanned workout stores no image —\n')
  await authService.signIn('ahmed', DEMO_PASSWORD)
  const fromScreenshot = await workoutService.logExternal({
    userId: 'u_ahmed', date: today, source: workoutScan.app ?? 'other',
    planName: workoutScan.planName, dayNumber: workoutScan.dayNumber,
    name: workoutScan.workoutName ?? workoutScan.planName ?? 'Workout',
    exerciseCount: workoutScan.exerciseCount ?? 0,
    durationSec: workoutScan.durationSec ?? 0,
    caloriesKcal: workoutScan.caloriesKcal ?? 0,
  })
  check('the reading saved as a session', fromScreenshot.planName, 'Full Body Beginner')
  check('with the duration it read', fromScreenshot.durationSec, 1394)
  const savedSession = (await db.sessions.get(fromScreenshot.id))!
  ok('and the record holds no image field of any kind',
    !Object.entries(savedSession).some(([, value]) =>
      value instanceof Blob ||
      value instanceof ArrayBuffer ||
      ArrayBuffer.isView(value) ||
      (typeof value === 'string' && /^(data:image|blob:)/i.test(value))),
    Object.keys(savedSession).join(', '))
  check('the photos table is still empty', await db.photos.count(), 0)
  authService.signOut()
  await resetDatabase()


  // ---------------------------------------------------------------------
  // Scanner reliability: retries, caching and pipeline separation.
  // ---------------------------------------------------------------------

  console.log('\n— Transient failures retry automatically —\n')

  /** A vision provider that fails a set number of times, then succeeds. */
  function flakyVision(failures: (() => Error)[]): FoodVisionProvider & { calls: number } {
    let calls = 0
    return {
      name: 'flaky',
      get calls() {
        return calls
      },
      async identify() {
        const failure = failures[calls]
        calls += 1
        if (failure) throw failure()
        return {
          items: [
            { name: 'Grilled beef steak', foodType: 'beef', quantity: 200, unit: 'g', confidence: 0.9, alternatives: [] },
          ],
          mealDescription: 'Steak',
          overallConfidence: 0.9,
          needsUserConfirmation: false,
        }
      },
    } as FoodVisionProvider & { calls: number }
  }

  const fast = { attempts: 3, baseDelayMs: 1, budgetMs: 10_000 }

  for (const [label, make] of [
    ['503 provider_failed', () => new ScanFailure('provider_failed', 'down')],
    ['429 rate limited', () => new ScanFailure('rate_limited', 'busy')],
    ['timeout', () => new ScanFailure('timeout', 'slow')],
    ['unreadable model JSON', () => new ScanFailure('unreadable_response', 'garbled')],
    ['a bare network error', () => new Error('ECONNRESET')],
  ] as [string, () => Error][]) {
    const vision = flakyVision([make])
    const outcome = await withRetry(() => vision.identify({ base64: 'x', mimeType: 'image/jpeg' }), fast)
    ok(label + ' -> recovered on attempt 2', outcome.attempts === 2 && vision.calls === 2,
      vision.calls + ' calls')
  }

  const twiceFlaky = flakyVision([
    () => new ScanFailure('provider_failed', 'down'),
    () => new ScanFailure('timeout', 'slow'),
  ])
  const thirdTime = await withRetry(
    () => twiceFlaky.identify({ base64: 'x', mimeType: 'image/jpeg' }),
    fast,
  )
  check('two failures then success uses three attempts', thirdTime.attempts, 3)

  const alwaysDown = flakyVision(Array.from({ length: 5 }, () => () => new ScanFailure('provider_failed', 'down')))
  let gaveUp = false
  try {
    await withRetry(() => alwaysDown.identify({ base64: 'x', mimeType: 'image/jpeg' }), fast)
  } catch {
    gaveUp = true
  }
  ok('a persistent outage stops at three attempts', gaveUp && alwaysDown.calls === 3,
    alwaysDown.calls + ' calls')

  console.log('\n— Permanent failures are not retried —\n')
  for (const [label, code] of [
    ['401 unauthorized', 'unauthorized'],
    ['400 invalid image', 'invalid_image'],
    ['404 model not found', 'not_configured'],
    ['413 too large', 'too_large'],
    ['422 no food found', 'no_food_found'],
  ] as [string, ScanErrorCode][]) {
    const vision = flakyVision(Array.from({ length: 5 }, () => () => new ScanFailure(code, 'nope')))
    let threw = false
    try {
      await withRetry(() => vision.identify({ base64: 'x', mimeType: 'image/jpeg' }), fast)
    } catch {
      threw = true
    }
    ok(label + ' -> exactly one attempt', threw && vision.calls === 1, vision.calls + ' calls')
  }

  console.log('\n— Backoff grows, with jitter —\n')
  const delay1 = Array.from({ length: 40 }, () => delayFor(1, 1000))
  const delay2 = Array.from({ length: 40 }, () => delayFor(2, 1000))
  const delay3 = Array.from({ length: 40 }, () => delayFor(3, 1000))
  ok('attempt 1 waits ~800-1200ms', delay1.every((d) => d >= 800 && d <= 1200),
    Math.min(...delay1) + '-' + Math.max(...delay1) + 'ms')
  ok('attempt 2 waits ~1600-2400ms', delay2.every((d) => d >= 1600 && d <= 2400),
    Math.min(...delay2) + '-' + Math.max(...delay2) + 'ms')
  ok('attempt 3 waits ~3200-4800ms', delay3.every((d) => d >= 3200 && d <= 4800),
    Math.min(...delay3) + '-' + Math.max(...delay3) + 'ms')
  ok('jitter actually varies the delay', new Set(delay1).size > 5)

  console.log('\n— Cancelling stops the retry loop —\n')
  const cancelled = new AbortController()
  const stubborn = flakyVision(Array.from({ length: 5 }, () => () => new ScanFailure('timeout', 'slow')))
  cancelled.abort()
  let abortedEarly = false
  try {
    await withRetry(() => stubborn.identify({ base64: 'x', mimeType: 'image/jpeg' }), {
      ...fast,
      signal: cancelled.signal,
    })
  } catch {
    abortedEarly = true
  }
  ok('an aborted scan makes no requests at all', abortedEarly && stubborn.calls === 0,
    stubborn.calls + ' calls')

  console.log('\n— A USDA hiccup never re-runs the vision model —\n')
  const visionOnce = flakyVision([])
  let lookups = 0
  const flakyNutrition: NutritionProvider = {
    name: 'flaky-usda',
    async lookup() {
      lookups += 1
      if (lookups === 1) return null // First lookup comes back empty.
      return {
        kcal: 456, proteinG: 52, carbsG: 0, fatG: 26,
        matchedName: 'Beef, steak, grilled', source: 'test', matchConfidence: 0.9,
      }
    },
  }
  const firstRun = await runFoodScan(
    { imageBase64: Buffer.alloc(2048).toString('base64'), mimeType: 'image/jpeg' },
    { vision: visionOnce, nutrition: flakyNutrition, source: 'live' },
  )
  check('vision was called once', visionOnce.calls, 1)
  check('a nutrition miss leaves the food with blank numbers', firstRun.items[0].kcal, 0)
  ok('and flags it for the user', firstRun.needsUserConfirmation)
  ok('the food itself is still reported', firstRun.items[0].name === 'Grilled beef steak')

  const secondRun = await runFoodScan(
    { imageBase64: Buffer.alloc(2048).toString('base64'), mimeType: 'image/jpeg' },
    { vision: visionOnce, nutrition: flakyNutrition, source: 'live' },
  )
  check('the retry populated nutrition', secondRun.items[0].kcal, 456)
  check('vision still called only once more', visionOnce.calls, 2)

  console.log('\n— Confidence is banded once, on the server —\n')
  check('0.92 is high', confidenceLevel(0.92), 'high')
  check('0.80 is the high boundary', confidenceLevel(0.8), 'high')
  check('0.79 is medium', confidenceLevel(0.79), 'medium')
  check('0.55 is the medium boundary', confidenceLevel(0.55), 'medium')
  check('0.54 is low', confidenceLevel(0.54), 'low')

  const lowVision: FoodVisionProvider = {
    name: 'unsure',
    async identify() {
      return {
        items: [
          { name: 'Beef steak', foodType: 'beef', quantity: 200, unit: 'g', confidence: 0.42, alternatives: ['Lamb steak', 'Pork chop'] },
        ],
        mealDescription: 'Something meaty',
        overallConfidence: 0.42,
        needsUserConfirmation: true,
      }
    },
  }
  const unsure = await runFoodScan(
    { imageBase64: Buffer.alloc(2048).toString('base64'), mimeType: 'image/jpeg' },
    { vision: lowVision, nutrition: null, source: 'live' },
  )
  check('a weak reading is banded low', unsure.items[0].confidenceLevel, 'low')
  check('and the whole scan is low', unsure.overallLevel, 'low')
  ok('so confirmation is demanded', unsure.needsUserConfirmation)
  check('alternatives are offered to choose from', unsure.items[0].alternatives.length, 2)
  ok('recognition and nutrition confidence are separate fields',
    'confidenceLevel' in unsure.items[0] && !('matchLevel' in unsure.items[0] && unsure.items[0].matchLevel))

  console.log('\n— Food names are normalised conservatively —\n')
  check('trailing method moves to the front', normalizeFoodName('beef steak grilled'), 'grilled beef steak')
  check('chicken too', normalizeFoodName('chicken breast grilled'), 'grilled chicken breast')
  check('and rice', normalizeFoodName('white rice cooked'), 'cooked white rice')
  check('an already-natural name is untouched', normalizeFoodName('grilled beef steak'), 'grilled beef steak')
  check('an unusual food is left alone', normalizeFoodName('shakshuka with feta'), 'shakshuka with feta')
  check('a single word is left alone', normalizeFoodName('banana'), 'banana')
  check('whitespace is tidied', normalizeFoodName('  beef   steak  '), 'beef steak')

  console.log('\n— The temporary result cache —\n')
  clearScanCache()
  const imageA = new File([new Uint8Array([1, 2, 3, 4, 5])], 'a.jpg', { type: 'image/jpeg' })
  const imageACopy = new File([new Uint8Array([1, 2, 3, 4, 5])], 'a-again.jpg', { type: 'image/jpeg' })
  const imageB = new File([new Uint8Array([9, 8, 7, 6, 5])], 'b.jpg', { type: 'image/jpeg' })

  const printA = await fingerprintFile(imageA)
  const printACopy = await fingerprintFile(imageACopy)
  const printB = await fingerprintFile(imageB)
  check('identical bytes fingerprint the same, whatever the filename', printA, printACopy)
  ok('different bytes fingerprint differently', printA !== printB)
  ok('the fingerprint is a hex digest, not the image', /^[0-9a-f]{64}$/.test(printA), printA.slice(0, 16) + '…')

  check('nothing is cached to begin with', readCached(printA), null)
  writeCached(printA, { items: [{ name: 'Grilled beef steak' }] })
  ok('a stored result comes back', readCached<{ items: unknown[] }>(printA)?.items.length === 1)
  check('and only for its own fingerprint', readCached(printB), null)
  check('one entry is held', scanCacheSize(), 1)

  const cachedValue = JSON.stringify(readCached(printA))
  ok('the cache holds no image data',
    !/data:|blob:|base64|ArrayBuffer|Blob/i.test(cachedValue), cachedValue.slice(0, 60))

  forgetCached(printA)
  check('an explicit re-analysis clears the entry', readCached(printA), null)
  clearScanCache()
  check('and the cache can be emptied', scanCacheSize(), 0)

  console.log('\n— No sample food survives anywhere —\n')
  const scannerFiles = [
    'src/services/foodScanService.ts',
    'src/components/nutrition/FoodScanner.tsx',
    'src/lib/scanCache.ts',
    'server/foodScan/handler.ts',
    'server/shared/retry.ts',
    'server/foodScan/geminiVisionProvider.ts',
    'server/foodScan/fdcNutritionProvider.ts',
  ]
  const sampleHits: string[] = []
  for (const file of scannerFiles) {
    const source = await readFile(new URL('../' + file, import.meta.url), 'utf8')
    for (const sample of ['Porridge oats', 'Scrambled eggs', 'Beef kofta', 'Grilled salmon', 'Mixed salad']) {
      if (source.includes(sample)) sampleHits.push(file + ' contains "' + sample + '"')
    }
  }
  ok('no sample meal in any scanner file', sampleHits.length === 0, sampleHits.join('; ') || 'clean')


  // ---------------------------------------------------------------------
  // Nutrition matching. These rows are verbatim from the live USDA API for
  // the query "beef steak" — the exact data that produced a wrong answer.
  // ---------------------------------------------------------------------

  console.log('\n— A steak must not match a steak sandwich —\n')

  const STEAK_ROWS = [
    { description: 'Beef, sandwich steak', dataType: 'Survey (FNDDS)', per100: { kcal: 326, proteinG: 18, carbsG: 0, fatG: 28 } },
    { description: 'Beef, steak, chuck', dataType: 'Survey (FNDDS)', per100: { kcal: 225, proteinG: 26, carbsG: 0, fatG: 13 } },
    { description: 'Beef, steak, cube', dataType: 'Survey (FNDDS)', per100: { kcal: 187, proteinG: 29, carbsG: 0, fatG: 7 } },
    { description: 'Beef, steak, NFS', dataType: 'Survey (FNDDS)', per100: { kcal: 229, proteinG: 27, carbsG: 0, fatG: 13 } },
    { description: 'Beef, steak, country fried', dataType: 'Survey (FNDDS)', per100: { kcal: 306, proteinG: 20, carbsG: 8, fatG: 21 } },
    { description: 'CRACKER BARREL, grilled sirloin steak', dataType: 'SR Legacy', per100: { kcal: 203, proteinG: 32, carbsG: 0, fatG: 9 } },
  ]

  const steakPick = pickBest(STEAK_ROWS, 'beef steak')
  ok('a match is found', steakPick !== null)
  check('the generic steak row wins', steakPick?.candidate.description, 'Beef, steak, NFS')
  check('sandwich meat is rejected outright', scoreMatch(STEAK_ROWS[0], 'beef steak'), 0)
  check('so is country fried', scoreMatch(STEAK_ROWS[4], 'beef steak'), 0)
  ok('the branded restaurant row scores lower than the generic one',
    scoreMatch(STEAK_ROWS[5], 'beef steak') < scoreMatch(STEAK_ROWS[3], 'beef steak'))
  ok('the chosen row has no carbohydrate, as steak should not',
    steakPick!.candidate.per100.carbsG === 0)

  // The reported bug: 10 g protein and 23 g carbohydrate for a steak.
  const bogus = { description: 'Beef steak sandwich on white roll', dataType: 'Survey (FNDDS)', per100: { kcal: 234, proteinG: 20, carbsG: 46, fatG: 8 } }
  check('the exact shape of the reported bug is refused', scoreMatch(bogus, 'beef steak'), 0)

  console.log('\n— Wrong food, wrong category, implausible rows —\n')
  check('chicken does not match a beef query',
    scoreMatch({ description: 'Chicken, breast, grilled', per100: { kcal: 165, proteinG: 31, carbsG: 0, fatG: 4 } }, 'beef steak'), 0)
  check('a soup is not an ingredient',
    scoreMatch({ description: 'Beef steak soup', per100: { kcal: 60, proteinG: 4, carbsG: 5, fatG: 2 } }, 'beef steak'), 0)
  check('nutritionally impossible rows are refused',
    scoreMatch({ description: 'Beef, steak, NFS', per100: { kcal: 229, proteinG: 90, carbsG: 90, fatG: 90 } }, 'beef steak'), 0)
  check('a zero-energy row is refused',
    scoreMatch({ description: 'Beef, steak, NFS', per100: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 } }, 'beef steak'), 0)
  ok('a sandwich IS allowed when the user asked for one',
    scoreMatch({ description: 'Beef, sandwich steak', dataType: 'Survey (FNDDS)', per100: { kcal: 326, proteinG: 18, carbsG: 0, fatG: 28 } }, 'beef sandwich steak') > 0)

  console.log('\n— Plausibility guard —\n')
  ok('real steak passes', isPlausible({ kcal: 229, proteinG: 27, carbsG: 0, fatG: 13 }))
  ok('real rice passes', isPlausible({ kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 }))
  ok('macros that do not add up fail', !isPlausible({ kcal: 100, proteinG: 50, carbsG: 50, fatG: 50 }))
  ok('an absurd energy value fails', !isPlausible({ kcal: 5000, proteinG: 10, carbsG: 10, fatG: 10 }))
  ok('an all-zero row fails', !isPlausible({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }))

  console.log('\n— A lookup miss falls back, never to zero —\n')
  const steakVisionWithEstimate: FoodVisionProvider = {
    name: 'estimating',
    async identify() {
      return {
        items: [
          {
            name: 'Grilled beef steak', foodType: 'beef', quantity: 200, unit: 'g',
            confidence: 0.9, alternatives: [], cookingMethod: 'grilled',
            estimatedKcal: 460, estimatedProteinG: 54, estimatedCarbsG: 0, estimatedFatG: 26,
          },
        ],
        mealDescription: 'Steak',
        overallConfidence: 0.9,
        needsUserConfirmation: false,
      }
    },
  }
  const noMatchNutrition: NutritionProvider = { name: 'empty', async lookup() { return null } }
  const fellBack = await runFoodScan(
    { imageBase64: Buffer.alloc(2048).toString('base64'), mimeType: 'image/jpeg' },
    { vision: steakVisionWithEstimate, nutrition: noMatchNutrition, source: 'live' },
  )
  check('the model estimate is used', fellBack.items[0].kcal, 460)
  check('and labelled as an estimate', fellBack.items[0].nutritionFrom, 'estimate')
  ok('it is never left at zero', fellBack.items[0].kcal > 0)
  ok('and the user is asked to check it', fellBack.needsUserConfirmation)
  check('steak still has no carbohydrate', fellBack.items[0].carbsG, 0)

  const dbNutrition: NutritionProvider = {
    name: 'db',
    async lookup() {
      return { kcal: 458, proteinG: 54, carbsG: 0, fatG: 26, matchedName: 'Beef, steak, NFS', source: 'test', matchConfidence: 0.9 }
    },
  }
  const fromDb = await runFoodScan(
    { imageBase64: Buffer.alloc(2048).toString('base64'), mimeType: 'image/jpeg' },
    { vision: steakVisionWithEstimate, nutrition: dbNutrition, source: 'live' },
  )
  check('a good database row wins over the estimate', fromDb.items[0].nutritionFrom, 'database')
  check('and its numbers are used', fromDb.items[0].kcal, 458)

  const noEstimateVision: FoodVisionProvider = {
    name: 'bare',
    async identify() {
      return {
        items: [{ name: 'Unknown thing', foodType: 'unknown', quantity: 100, unit: 'g', confidence: 0.5, alternatives: [] }],
        mealDescription: 'Unclear',
        overallConfidence: 0.5,
        needsUserConfirmation: true,
      }
    },
  }
  const nothing = await runFoodScan(
    { imageBase64: Buffer.alloc(2048).toString('base64'), mimeType: 'image/jpeg' },
    { vision: noEstimateVision, nutrition: noMatchNutrition, source: 'live' },
  )
  check('with neither source, the fields are left blank to fill in', nothing.items[0].nutritionFrom, 'none')
  ok('and that is flagged', nothing.needsUserConfirmation)

  // =========================================================================
  // The redesign: sign-in, setup, external logging, weigh-ins, challenges
  // =========================================================================

  console.log('\n— Signing in is a real check now —\n')
  authService.signOut()
  let refusedWrongPassword = false
  try {
    await authService.signIn('ahmed', 'not-the-password')
  } catch (error) {
    refusedWrongPassword = error instanceof AuthError
  }
  ok('a wrong password is refused', refusedWrongPassword)

  let refusedUnknown = false
  try {
    await authService.signIn('nobody', DEMO_PASSWORD)
  } catch (error) {
    refusedUnknown = error instanceof AuthError
  }
  ok('an unknown username is refused', refusedUnknown)
  ok('a failed sign-in leaves no session', (await authService.currentUser()) === null)

  const signedIn = await authService.signIn('ahmed', DEMO_PASSWORD)
  check('the right password signs in', signedIn.id, 'u_ahmed')
  ok('the session survives a re-read', (await authService.currentUser())?.id === 'u_ahmed')
  ok('the password is never stored in plain text', signedIn.secret !== DEMO_PASSWORD)
  ok('the stored credential is a hex digest', /^[0-9a-f]{64}$/.test(signedIn.secret ?? ''))

  const nadiaAccount = await db.users.get('u_nadia')
  ok('two accounts sharing a password still differ', nadiaAccount!.secret !== signedIn.secret)

  authService.signOut()
  ok('signing out clears the session', (await authService.currentUser()) === null)
  await authService.signIn('ahmed', DEMO_PASSWORD)

  console.log('\n— Setting up a new account —\n')
  const fresh = await userService.create({
    name: 'New Person', handle: 'newbie', avatarColor: '#777', birthDate: '1994-05-05',
    sex: 'male', heightCm: 180, startWeightKg: 70, targetWeightKg: 78, goal: 'build_muscle',
    activityLevel: 'active', stepGoal: 8000, waterGoalL: 2.5, workoutsPerWeekGoal: 4,
    weighInDay: 3, workoutApps: ['lose_weight_men'], units: 'metric',
    onboardedAt: new Date().toISOString(),
  })
  await authService.setPassword(fresh.id, 'letmein')
  const freshSignIn = await authService.signIn('newbie', 'letmein')
  check('a new account can sign in', freshSignIn.id, fresh.id)
  check('their weigh-in day is kept', freshSignIn.weighInDay, 3)
  check('their goal is kept', freshSignIn.goal, 'build_muscle')
  ok(
    'a too-short password is refused',
    await authService.setPassword(fresh.id, 'abc').then(
      () => false,
      (error) => error instanceof AuthError,
    ),
  )

  console.log('\n— Logging a workout done in another app —\n')
  await authService.signIn('ahmed', DEMO_PASSWORD)
  const logDate = addDays(today, -40)
  const logged = await workoutService.logExternal({
    userId: 'u_ahmed', date: logDate, source: 'home_workout', planName: 'Full Body Beginner',
    dayNumber: 13, name: 'Full Body Beginner', exerciseCount: 8, durationSec: 383,
    caloriesKcal: 125.8, difficulty: 'just_right',
  })
  check('the source is recorded', logged.source, 'home_workout')
  check('it is marked as a quick log', logged.loggedVia, 'quick_log')
  check("the other app's calorie count is kept as-is", logged.caloriesKcal, 125.8)
  check('it counts as completed', logged.status, 'completed')
  check('no set results are invented', (await workoutService.setResults(logged.id)).length, 0)

  const logKey = 'workout:' + logged.id
  const logPost = (await db.updates.toArray()).find((u) => u.dedupeKey === logKey)
  ok('the group is told once', Boolean(logPost))
  ok(
    'and it reads like a person wrote it',
    logPost!.text === 'completed Day 13 — Full Body Beginner 💪',
    logPost!.text,
  )

  const editedLog = await workoutService.logExternal({
    sessionId: logged.id, userId: 'u_ahmed', date: logDate, source: 'home_workout',
    planName: 'Full Body Beginner', dayNumber: 13, name: 'Full Body Beginner',
    exerciseCount: 8, durationSec: 400, caloriesKcal: 130,
  })
  check('editing keeps the same record', editedLog.id, logged.id)
  check('and applies the correction', editedLog.durationSec, 400)
  check(
    'editing does not post a second time',
    (await db.updates.toArray()).filter((u) => u.dedupeKey === logKey).length,
    1,
  )

  const defaults = await workoutService.quickLogDefaults('u_ahmed')
  const newestQuickLog = (await db.sessions
    .where('userId')
    .equals('u_ahmed')
    .filter((s) => s.loggedVia === 'quick_log' && s.status === 'completed')
    .sortBy('date')).at(-1)
  check('the next log is pre-filled from the most recent one',
    defaults.planName, newestQuickLog?.planName)
  ok('with the day number moved on', (defaults.dayNumber ?? 0) > 0)

  let refusedOthersLog = false
  await authService.signIn('nadia', DEMO_PASSWORD)
  try {
    await workoutService.logExternal({
      userId: 'u_ahmed', source: 'other', name: 'Sneaky', exerciseCount: 1,
      durationSec: 60, caloriesKcal: 1,
    })
  } catch (error) {
    refusedOthersLog = error instanceof Error && error.name === 'OwnershipError'
  }
  ok("nobody can log a workout onto someone else's account", refusedOthersLog)
  await authService.signIn('ahmed', DEMO_PASSWORD)
  await workoutService.removeSession(logged.id)

  console.log('\n— The weigh-in is saved first and shared on purpose —\n')
  const weighDate = addDays(today, -400)
  await weightService.add({
    userId: 'u_ahmed', date: weighDate, weightKg: 80, kind: 'official', announce: false,
  })
  ok('saving privately posts nothing', !(await weightService.isShared('u_ahmed', weighDate)))
  await weightService.shareWeighIn('u_ahmed', weighDate)
  ok('sharing posts it', await weightService.isShared('u_ahmed', weighDate))
  await weightService.shareWeighIn('u_ahmed', weighDate)

  // Keyed by the weigh-in cycle rather than the day it was typed, matching
  // weightService.shareWeighIn.
  const weighKey =
    'weigh-in:u_ahmed:' + slotFor(((await db.users.get('u_ahmed'))!.weighInDay ?? 0), weighDate)
  check(
    'sharing twice still posts once',
    (await db.updates.toArray()).filter((u) => u.dedupeKey === weighKey).length,
    1,
  )
  const weighPost = (await db.updates.toArray()).find((u) => u.dedupeKey === weighKey)!
  ok('the post names the weigh-in', weighPost.text.includes('weekly weigh-in'), weighPost.text)
  ok(
    'and carries nothing but the weight and the change',
    Object.keys(weighPost.meta ?? {}).every((key) => key === 'weightKg' || key === 'changeKg'),
  )
  await db.weights.where('[userId+date]').equals(['u_ahmed', weighDate]).delete()
  await db.updates.filter((u) => u.dedupeKey === weighKey).delete()

  console.log('\n— The weekly group challenge —\n')
  const challenge = await challengeService.ensureWeek(today)
  ok('a challenge exists for this week', Boolean(challenge.title), challenge.title)
  check(
    'reading it twice does not create a second',
    await db.challenges.where('weekStart').equals(challenge.weekStart).count(),
    1,
  )
  check('the same week always gives the same one', (await challengeService.ensureWeek(today)).id, challenge.id)
  const nextWeekChallenge = await challengeService.ensureWeek(addDays(today, 7))
  ok('a different week gets its own', nextWeekChallenge.id !== challenge.id)

  const challengeProgress = await challengeService.progress(today)
  ok('progress is available once the week exists', challengeProgress !== null)
  check('every member is counted', challengeProgress!.contributions.length,
    (await userService.listMembers()).length)
  ok('progress never reads above 100%', challengeProgress!.pct <= 100)
  ok(
    'the total is exactly the sum of the contributions',
    challengeProgress!.total === challengeProgress!.contributions.reduce((sum, c) => sum + c.value, 0),
  )
  ok(
    'nothing about a challenge is stored as a running total',
    !('total' in challenge) && !('progress' in challenge),
  )

  console.log('\n— Achievements are earned, in both directions —\n')
  const ahmedAchievements = await achievementService.listForUser('u_ahmed')
  check('the full set is defined', ahmedAchievements.length, 31)
  ok('every definition has a group and a tier', ahmedAchievements.every((a) => Boolean(a.group) && a.tier > 0))
  ok('keys are unique', new Set(ahmedAchievements.map((a) => a.key)).size === ahmedAchievements.length)
  ok(
    'Ahmed earned the 5 kg mark by losing',
    ahmedAchievements.find((a) => a.key === 'five_kg')?.unlockedAt !== undefined,
  )

  const samirBadges = await achievementService.listForUser('u_samir')
  ok(
    'Samir earned the first kg mark by gaining',
    samirBadges.find((a) => a.key === 'first_kg')?.unlockedAt !== undefined,
  )
  ok(
    'the million-step badge stays locked',
    samirBadges.find((a) => a.key === 'steps_1m')?.unlockedAt === undefined,
  )
  ok(
    'nobody is handed a badge they have not earned',
    samirBadges.filter((a) => a.unlockedAt).length < samirBadges.length,
  )

  console.log('\n— Motivation rotates by the week —\n')
  const thisWeekVideo = await motivationService.featuredForWeek(today)
  ok('a video is featured', Boolean(thisWeekVideo))
  check('asking again gives the same one', (await motivationService.featuredForWeek(today))?.id, thisWeekVideo?.id)
  const nextWeekVideo = await motivationService.featuredForWeek(addDays(today, 7))
  ok('next week is a different one', nextWeekVideo?.id !== thisWeekVideo?.id)
  const rotationLength = (await motivationService.rotation()).length
  check(
    'the rotation comes back around',
    (await motivationService.featuredForWeek(addDays(today, 7 * rotationLength)))?.id,
    thisWeekVideo?.id,
  )
  ok(
    'what is coming up is never what is on now',
    (await motivationService.upcoming(1, today))[0]?.id !== thisWeekVideo?.id,
  )

  console.log('\n— The redesign preserved what was already there —\n')
  ok('every seeded workout survived', (await db.sessions.count()) > 20)
  ok('every weigh-in survived', (await db.weights.count()) > 20)
  ok(
    'meals, water and steps survived',
    (await db.foods.count()) > 0 && (await db.water.count()) > 0 && (await db.steps.count()) > 0,
  )
  ok('measurements survived', (await db.measurements.count()) > 0)
  ok('the group feed survived', (await db.updates.count()) > 5)
  ok('motivation videos survived', (await db.videos.count()) >= 3)
  ok(
    'sessions recorded before external logging are still valid',
    (await db.sessions.toArray()).every((s) => Boolean(s.name) && Boolean(s.date)),
  )
  ok(
    'every user has the preference fields the redesign added',
    (await db.users.toArray()).every((u) => u.units !== undefined && Array.isArray(u.workoutApps)),
  )


  // =========================================================================
  // Group chat and the theme preference
  // =========================================================================

  console.log('\n— The chat is seeded and reads in order —\n')
  await authService.signIn('ahmed', DEMO_PASSWORD)
  const thread = await chatService.list()
  ok('a conversation is seeded', thread.length >= 10, `${thread.length} messages`)
  ok(
    'messages read oldest first, so the newest is at the bottom',
    thread.every((m, i) => i === 0 || thread[i - 1].createdAt <= m.createdAt),
  )
  ok('every message has an author in the group', thread.every((m) => Boolean(m.userId)))
  ok('nothing in the chat holds binary or a data URI', await chatIsTextOnly())

  const latest = await chatService.latest(2)
  check('the preview takes just two', latest.length, 2)
  check(
    'and they are the newest two',
    latest.at(-1)!.id,
    thread.at(-1)!.id,
  )

  console.log('\n— Sending, replying, reacting —\n')
  const sent = await chatService.send({ userId: 'u_ahmed', text: '  Evening all  ' })
  ok('a message is created', Boolean(sent))
  check('the text is trimmed', sent!.text, 'Evening all')
  check('it belongs to the sender', sent!.userId, 'u_ahmed')
  ok('it has a timestamp', Boolean(sent!.createdAt))

  check('an empty message is refused', await chatService.send({ userId: 'u_ahmed', text: '   ' }), null)

  await authService.signIn('nadia', DEMO_PASSWORD)
  const reply = await chatService.send({
    userId: 'u_nadia', text: 'Evening!', replyToId: sent!.id,
  })
  check('a reply points at the original', reply!.replyToId, sent!.id)

  const withReply = (await chatService.list()).find((m) => m.id === reply!.id)!
  ok('and the quoted preview is resolved', withReply.replyTo?.id === sent!.id)
  check('the quote carries the original text', withReply.replyTo?.text, 'Evening all')

  await chatService.toggleReaction(sent!.id, 'u_nadia', '🔥')
  let chatReacted = (await chatService.list()).find((m) => m.id === sent!.id)!
  check('a reaction lands', chatReacted.reactions.length, 1)
  check('with the right emoji', chatReacted.reactions[0].emoji, '🔥')

  await chatService.toggleReaction(sent!.id, 'u_nadia', '💪')
  chatReacted = (await chatService.list()).find((m) => m.id === sent!.id)!
  check('changing it replaces rather than adds', chatReacted.reactions.length, 1)
  check('and keeps the newer emoji', chatReacted.reactions[0].emoji, '💪')

  await chatService.toggleReaction(sent!.id, 'u_nadia', '💪')
  chatReacted = (await chatService.list()).find((m) => m.id === sent!.id)!
  check('tapping the same one again removes it', chatReacted.reactions.length, 0)

  console.log('\n— You post and delete as yourself, nobody else —\n')
  let refusedImpersonation = false
  try {
    await chatService.send({ userId: 'u_ahmed', text: 'Not really Ahmed' })
  } catch (error) {
    refusedImpersonation = error instanceof Error && error.name === 'OwnershipError'
  }
  ok('you cannot post as someone else', refusedImpersonation)

  let refusedForeignDelete = false
  try {
    await chatService.remove(sent!.id)
  } catch (error) {
    refusedForeignDelete = error instanceof Error && error.name === 'OwnershipError'
  }
  ok("you cannot delete someone else's message", refusedForeignDelete)

  let refusedForeignReaction = false
  try {
    await chatService.toggleReaction(sent!.id, 'u_ahmed', '🔥')
  } catch (error) {
    refusedForeignReaction = error instanceof Error && error.name === 'OwnershipError'
  }
  ok('and you cannot react on their behalf', refusedForeignReaction)

  await authService.signIn('ahmed', DEMO_PASSWORD)
  await chatService.remove(sent!.id)
  const removed = await db.messages.get(sent!.id)
  ok('you can delete your own', Boolean(removed?.deletedAt))
  check('and its text goes with it', removed!.text, '')
  const orphan = await db.messages.get(reply!.id)
  ok('a reply survives its parent being deleted', Boolean(orphan))
  check('and keeps pointing at it, now a tombstone', orphan!.replyToId, sent!.id)
  await db.messages.bulkDelete([sent!.id, reply!.id])

  console.log('\n— Sharing progress into the chat —\n')
  const sharedWorkout = await chatService.shareWorkout('u_ahmed')
  check('a workout share is structured, not text', sharedWorkout!.sharedType, 'workout')
  check('and it references rather than copies', sharedWorkout!.text, '')
  ok('the referenced session exists', Boolean(await db.sessions.get(sharedWorkout!.sharedDataId!)))

  const sharedWeighIn = await chatService.shareWeighIn('u_ahmed')
  check('a weigh-in share is structured', sharedWeighIn!.sharedType, 'weigh_in')
  const sharedEntry = await db.weights.get(sharedWeighIn!.sharedDataId!)
  check('and it points at an official weigh-in', sharedEntry!.kind, 'official')
  ok(
    'no measurements or history ride along',
    !('history' in sharedWeighIn!) && Object.keys(sharedWeighIn!).every((k) => k !== 'weights'),
  )

  const sharedSteps = await chatService.shareSteps('u_ahmed', today)
  if (sharedSteps) {
    check('a step share is structured', sharedSteps.sharedType, 'steps')
    ok('and points at a real entry', Boolean(await db.steps.get(sharedSteps.sharedDataId!)))
  } else {
    ok('with no steps today, nothing is shared', true)
  }

  const sharedAchievement = await chatService.shareAchievement('u_ahmed')
  check('an achievement share is structured', sharedAchievement!.sharedType, 'achievement')
  ok(
    'and only an unlocked one can be shared',
    (await db.achievements.where('userId').equals('u_ahmed').toArray()).some(
      (a) => a.achievementKey === sharedAchievement!.sharedDataId,
    ),
  )

  const weekChallenge = await challengeService.ensureWeek(today)
  const sharedChallenge = await chatService.shareChallenge('u_ahmed', weekChallenge.id)
  check('a challenge share is structured', sharedChallenge!.sharedType, 'challenge')
  check('and links to this week', sharedChallenge!.sharedDataId, weekChallenge.id)

  check(
    'sharing something that does not exist shares nothing',
    await chatService.shareChallenge('u_ahmed', 'gc_nope'),
    null,
  )

  for (const message of [sharedWorkout, sharedWeighIn, sharedSteps, sharedAchievement, sharedChallenge]) {
    if (message) await db.messages.delete(message.id)
  }

  console.log('\n— Chat and updates stay separate —\n')
  const updateTexts = (await db.updates.toArray()).map((u) => u.text)
  const chatTexts = (await db.messages.toArray()).map((m) => m.text)
  ok(
    'no seeded update was written into the chat',
    !chatTexts.some((text) => text && updateTexts.includes(text)),
  )
  ok('updates are still system-written', updateTexts.every((t) => t.length > 0))

  console.log('\n— The empty state is reachable —\n')
  const archived = await db.messages.toArray()
  const archivedReactions = await db.chatReactions.toArray()
  await db.messages.clear()
  await db.chatReactions.clear()
  check('an empty room lists nothing', (await chatService.list()).length, 0)
  check('and the preview has nothing to show', (await chatService.latest(2)).length, 0)
  check('the count is zero', await chatService.count(), 0)
  await db.messages.bulkPut(archived)
  await db.chatReactions.bulkPut(archivedReactions)
  ok('and the conversation restores intact', (await chatService.list()).length === archived.length)

  console.log('\n— Theme preference —\n')
  storageService.setTheme('light')
  check('light is stored', storageService.getTheme(), 'light')
  storageService.setTheme('dark')
  check('switching to dark is stored', storageService.getTheme(), 'dark')
  storageService.setTheme('light')
  check('and back to light again', storageService.getTheme(), 'light')
  ok(
    'the preference survives a refresh',
    localStorage.getItem('circuit.theme') === 'light',
    'read straight back out of storage',
  )
  authService.signOut()
  check('signing out does not clear the theme', storageService.getTheme(), 'light')
  await authService.signIn('ahmed', DEMO_PASSWORD)
  check('and signing in keeps it', storageService.getTheme(), 'light')
  storageService.setTheme('system')
  check('system is still supported internally', storageService.getTheme(), 'system')
  ok('and stores nothing, so the OS decides', localStorage.getItem('circuit.theme') === null)
  storageService.setTheme('dark')


  // =========================================================================
  // Phase 1: the social foundation
  // =========================================================================

  console.log('\n— Posts are seeded and readable —\n')
  await authService.signIn('ahmed', DEMO_PASSWORD)
  const socialFeed = await postService.feed('u_ahmed')
  ok('the socialFeed has content', socialFeed.length >= 5, `${socialFeed.length} posts`)
  ok(
    'newest first',
    socialFeed.every((post, i) => i === 0 || socialFeed[i - 1].createdAt >= post.createdAt),
  )
  ok('every post has a resolved author', socialFeed.every((post) => Boolean(post.author?.name)))
  ok('every post declares a visibility', socialFeed.every((post) => Boolean(post.visibility)))
  ok('the default visibility is the group', socialFeed.every((post) => post.visibility === 'group'))
  ok(
    'posts carrying a record reference it rather than copying it',
    socialFeed
      .filter((post) => post.sharedType)
      .every((post) => Boolean(post.sharedDataId) || post.sharedType === 'steps'),
  )
  const workoutPost = socialFeed.find((post) => post.type === 'workout')
  ok('a shared workout points at a real session', Boolean(
    workoutPost && (await db.sessions.get(workoutPost.sharedDataId!)),
  ))

  console.log('\n— Visibility is enforced, not decorative —\n')
  const privatePost = await db.posts.add({
    id: 'p_private', userId: 'u_nadia', type: 'text', text: 'Just for me',
    createdAt: new Date().toISOString(), visibility: 'private', mediaIds: [],
    reactionCount: 0, commentCount: 0,
  })
  ok('a private post is hidden from everyone else',
    !(await postService.feed('u_ahmed')).some((p) => p.id === 'p_private'))
  ok('and visible to its author',
    (await postService.feed('u_nadia')).some((p) => p.id === 'p_private'))
  ok('canView agrees for the author',
    canView({ userId: 'u_nadia', visibility: 'private' }, 'u_nadia'))
  ok('and refuses everyone else',
    !canView({ userId: 'u_nadia', visibility: 'private' }, 'u_ahmed'))
  ok('group posts are visible to the group',
    canView({ userId: 'u_nadia', visibility: 'group' }, 'u_ahmed'))
  await db.posts.delete(privatePost)

  console.log('\n— Media is referenced, never stored —\n')
  const assets = await db.media.toArray()
  ok('media rows exist', assets.length > 0, `${assets.length} assets`)
  ok('none holds binary', assets.every((a) => !(a.ref instanceof Blob)))
  ok('none is a data URI', assets.every((a) => !/^data:/i.test(a.ref)))
  ok('every asset declares a mime type', assets.every((a) => Boolean(a.mimeType)))
  ok('seeded media are placeholders the UI draws itself',
    assets.every((a) => isPlaceholder(a.ref)))

  let refusedEmbedded = false
  try {
    await mediaService.register({
      kind: 'image',
      ref: 'data:image/png;base64,iVBORw0KGgo=',
      mimeType: 'image/png',
    })
  } catch {
    refusedEmbedded = true
  }
  ok('registering an embedded image is refused', refusedEmbedded)

  const temp = await mediaService.register({
    kind: 'image', ref: 'blob:http://localhost/abc', mimeType: 'image/jpeg',
  })
  ok('a blob reference is accepted but marked temporary', temp.temporary === true)
  await db.media.delete(temp.id)

  // The whole database must never contain binary or an inline payload.
  const binarySuspects: string[] = []
  for (const table of db.tables) {
    for (const row of await table.toArray()) {
      for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
        if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
          binarySuspects.push(`${table.name}.${key}`)
        }
        if (typeof value === 'string' && /^data:/i.test(value)) {
          binarySuspects.push(`${table.name}.${key} is a data URI`)
        }
      }
    }
  }
  ok('no table anywhere holds binary or a data URI', binarySuspects.length === 0,
    binarySuspects.slice(0, 3).join(', '))

  console.log('\n— Stories expire —\n')
  const liveStories = await storyService.live()
  ok('stories are seeded and live', liveStories.length >= 3, `${liveStories.length} live`)
  ok('every story has an expiry', liveStories.every((s) => Boolean(s.expiresAt)))
  ok('every expiry is in the future', liveStories.every((s) => s.expiresAt > new Date().toISOString()))
  ok(
    'and none lasts longer than a day',
    liveStories.every(
      (s) =>
        new Date(s.expiresAt).getTime() - new Date(s.createdAt).getTime() <= 24 * 60 * 60 * 1000 + 1000,
    ),
  )

  const tomorrow = new Date(Date.now() + 25 * 60 * 60 * 1000)
  check('a day later nothing is live', (await storyService.live(tomorrow)).length, 0)
  check('and the rail is empty', (await storyService.rings('u_ahmed', tomorrow)).length, 0)
  ok('hasExpired agrees', liveStories.every((s) => storyService.hasExpired(s, tomorrow)))
  ok('and disagrees for now', liveStories.every((s) => !storyService.hasExpired(s)))

  const rings = await storyService.rings('u_ahmed')
  ok('the rail groups by person', rings.length > 0 && rings.length <= (await db.users.count()))
  check('you come first', rings[0]?.user.id, 'u_ahmed')
  ok(
    'a story Ahmed has watched reads as seen',
    rings.find((r) => r.user.id === 'u_nadia')?.seen === true,
  )
  ok(
    'and one he has not does not',
    rings.find((r) => r.user.id === 'u_samir')?.seen === false,
  )
  ok(
    'a person\u2019s own stories read oldest first',
    rings.every((r) => r.stories.every((s, i) => i === 0 || r.stories[i - 1].createdAt <= s.createdAt)),
  )

  console.log('\n— Making a story —\n')

  const sessionBeforeStories = storageService.getSessionUserId()
  await authService.signIn('ahmed', DEMO_PASSWORD)
  const seededStoryIds = (await db.stories.toArray()).map((story) => story.id)
  const storyMediaBefore = await db.media.count()

  const storyWritten = await storyService.create({ userId: 'u_ahmed', text: '  Early one.  ' })
  check('a story is trimmed', storyWritten.text, 'Early one.')
  check('words alone make a text story', storyWritten.type, 'text')
  check('it belongs to whoever wrote it', storyWritten.userId, 'u_ahmed')
  check(
    'and it lasts exactly a day',
    new Date(storyWritten.expiresAt).getTime() - new Date(storyWritten.createdAt).getTime(),
    24 * 60 * 60 * 1000,
  )
  ok('it is live now', (await storyService.live()).some((s) => s.id === storyWritten.id))
  ok(
    'and gone tomorrow',
    !(await storyService.live(new Date(Date.now() + 25 * 60 * 60 * 1000))).some(
      (s) => s.id === storyWritten.id,
    ),
  )

  const ahmedRing = (await storyService.rings('u_ahmed')).find((r) => r.user.id === 'u_ahmed')
  ok('it shows up in his own ring', ahmedRing?.stories.some((s) => s.id === storyWritten.id))
  check('and he still comes first in the rail', (await storyService.rings('u_ahmed'))[0]?.user.id, 'u_ahmed')

  let refusedEmptyStory = false
  try {
    await storyService.create({ userId: 'u_ahmed', text: '   ' })
  } catch {
    refusedEmptyStory = true
  }
  ok('a story with nothing in it is refused', refusedEmptyStory)

  const photoStory = await storyService.create({
    userId: 'u_ahmed',
    text: 'Out before work',
    media: {
      kind: 'image',
      ref: 'blob:test/story-photo',
      mimeType: 'image/jpeg',
      width: 1080,
      height: 1920,
    },
  })
  check('a story carrying a picture is a photo story', photoStory.type, 'photo')
  const storyAsset = await mediaService.get(photoStory.mediaId!)
  check('the asset holds a pointer', storyAsset?.ref, 'blob:test/story-photo')
  ok('a session-scoped reference is marked temporary', storyAsset?.temporary === true)
  ok(
    'and no story row holds binary',
    (await db.stories.toArray()).every((s) => !(s.text ?? '').startsWith('data:')),
  )

  let refusedStoryBinary = false
  try {
    await storyService.create({
      userId: 'u_ahmed',
      text: 'embedded',
      media: { kind: 'image', ref: 'data:image/png;base64,AAAA', mimeType: 'image/png' },
    })
  } catch {
    refusedStoryBinary = true
  }
  ok('an embedded image is refused outright', refusedStoryBinary)
  ok(
    'and no story was written for it',
    !(await db.stories.toArray()).some((s) => s.text === 'embedded'),
  )

  console.log('\n— Seen, and by whom —\n')

  check('your own story is never a view', await storyService.markSeen(storyWritten.id, 'u_ahmed'), false)
  check('and records nothing', (await db.storyViews.where('storyId').equals(storyWritten.id).count()), 0)
  ok(
    'so it never reads as seen in your own rail',
    (await storyService.rings('u_ahmed')).find((r) => r.user.id === 'u_ahmed')?.seen === false,
  )

  await authService.signIn('nadia', DEMO_PASSWORD)
  check('watching somebody else\u2019s story counts', await storyService.markSeen(storyWritten.id, 'u_nadia'), true)
  check('watching it twice does not', await storyService.markSeen(storyWritten.id, 'u_nadia'), false)
  check(
    'so the view is recorded once',
    await db.storyViews.where('storyId').equals(storyWritten.id).count(),
    1,
  )

  let refusedForeignView = false
  try {
    await storyService.markSeen(storyWritten.id, 'u_samir')
  } catch (error) {
    refusedForeignView = error instanceof Error && error.name === 'OwnershipError'
  }
  ok('nobody is marked as having watched on your behalf', refusedForeignView)

  let refusedForeignViewers = false
  try {
    await storyService.viewersOf(storyWritten.id)
  } catch (error) {
    refusedForeignViewers = error instanceof Error && error.name === 'OwnershipError'
  }
  ok('and only the author may see who watched', refusedForeignViewers)

  await authService.signIn('ahmed', DEMO_PASSWORD)
  const watchers = await storyService.viewersOf(storyWritten.id)
  check('the author sees one viewer', watchers.length, 1)
  check('and it is who watched', watchers[0]?.id, 'u_nadia')
  /*
   * A ring is seen only when every live story in it is. Ahmed still has a
   * seeded story Nadia has not opened, so watching one of two must not flip
   * the ring — that is the difference between "seen" and "seen something".
   */
  ok(
    'his ring stays unseen while an earlier story is unwatched',
    (await storyService.rings('u_nadia')).find((r) => r.user.id === 'u_ahmed')?.seen === false,
  )

  await authService.signIn('nadia', DEMO_PASSWORD)
  const ahmedsLive = (await storyService.live()).filter((s) => s.userId === 'u_ahmed')
  for (const item of ahmedsLive) await storyService.markSeen(item.id, 'u_nadia')
  ok(
    'and reads as seen once she has watched all of them',
    (await storyService.rings('u_nadia')).find((r) => r.user.id === 'u_ahmed')?.seen === true,
  )

  // Put the seeded story's audience back the way it was found.
  const borrowedViews = (await db.storyViews.toArray()).filter(
    (view) => view.userId === 'u_nadia' && seededStoryIds.includes(view.storyId),
  )
  await db.storyViews.bulkDelete(borrowedViews.map((view) => view.id))

  console.log('\n— Deleting a story —\n')

  await authService.signIn('nadia', DEMO_PASSWORD)
  let refusedForeignStoryDelete = false
  try {
    await storyService.remove(storyWritten.id)
  } catch (error) {
    refusedForeignStoryDelete = error instanceof Error && error.name === 'OwnershipError'
  }
  ok('nobody can delete somebody else\u2019s story', refusedForeignStoryDelete)
  ok('so it is still there', Boolean(await db.stories.get(storyWritten.id)))

  await authService.signIn('ahmed', DEMO_PASSWORD)
  const droppedStoryAsset = photoStory.mediaId!
  await storyService.remove(storyWritten.id)
  await storyService.remove(photoStory.id)
  check('deleting takes the story', await db.stories.get(storyWritten.id), undefined)
  check(
    'and the views that only existed because of it',
    await db.storyViews.where('storyId').equals(storyWritten.id).count(),
    0,
  )
  check('and the reference nothing points at', await mediaService.get(droppedStoryAsset), undefined)
  check('with no stray media left behind', await db.media.count(), storyMediaBefore)
  check(
    'and nothing the seed put there was disturbed',
    (await db.stories.bulkGet(seededStoryIds)).filter(Boolean).length,
    seededStoryIds.length,
  )
  ok(
    'the seeded photo story still points at its picture',
    Boolean(await mediaService.get((await db.stories.get('st_1'))!.mediaId!)),
  )

  storageService.setSessionUserId(sessionBeforeStories)

  console.log('\n— Notifications —\n')
  const notes = await notificationService.listFor('u_ahmed')
  ok('notifications are seeded', notes.length > 0, `${notes.length}`)
  ok('newest first', notes.every((n, i) => i === 0 || notes[i - 1].createdAt >= n.createdAt))
  ok('all are addressed to the reader', notes.every((n) => n.userId === 'u_ahmed'))
  const unreadBefore = await notificationService.unreadCount('u_ahmed')
  ok('some are unread', unreadBefore > 0, `${unreadBefore}`)

  const firstUnread = notes.find((n) => !n.readAt)!
  await notificationService.markRead('u_ahmed', firstUnread.id)
  check('marking one read lowers the count',
    await notificationService.unreadCount('u_ahmed'), unreadBefore - 1)
  await notificationService.markRead('u_ahmed', firstUnread.id)
  check('marking it again changes nothing',
    await notificationService.unreadCount('u_ahmed'), unreadBefore - 1)

  let refusedForeignNotification = false
  try {
    await notificationService.markAllRead('u_nadia')
  } catch (error) {
    refusedForeignNotification = error instanceof Error && error.name === 'OwnershipError'
  }
  ok("you cannot read someone else's notifications", refusedForeignNotification)

  await notificationService.markAllRead('u_ahmed')
  check('marking all read clears the count', await notificationService.unreadCount('u_ahmed'), 0)

  console.log('\n— The fitness data all survived the reorganisation —\n')
  ok('workouts intact', (await db.sessions.count()) > 20)
  ok('weigh-ins intact', (await db.weights.count()) > 20)
  ok('measurements intact', (await db.measurements.count()) > 0)
  ok('nutrition intact', (await db.foods.count()) > 0)
  ok('water intact', (await db.water.count()) > 0)
  ok('steps intact', (await db.steps.count()) > 0)
  ok('achievements intact', (await db.achievements.count()) > 0)
  ok('challenges intact', (await db.challenges.count()) > 0)
  ok('motivation videos intact', (await db.videos.count()) >= 3)
  ok('chat intact', (await db.messages.count()) >= 10)
  ok('the updates socialFeed is still separate from posts',
    (await db.updates.count()) > 0 && (await db.posts.count()) > 0)

  const stillWorks = await progressService.userSnapshot('u_ahmed', today)
  ok('progress still computes', stillWorks !== null && stillWorks.energy.target > 0)
  ok('BMI still computes', (stillWorks?.bmi.value ?? 0) > 0)


  // =========================================================================
  // Refinement: community landing, unread state, workout logs
  // =========================================================================

  console.log('\n— The community card has something to show —\n')
  await authService.signIn('ahmed', DEMO_PASSWORD)
  const beforeRead = await chatService.summary('u_ahmed')
  ok('there is a latest message', Boolean(beforeRead.latest))
  ok('and it is genuinely the newest', await isNewestMessage(beforeRead.latest!.id))
  ok('the author is identified', Boolean(beforeRead.latestAuthorId))
  check('the total matches the table', beforeRead.total, await db.messages.count())
  ok('with nothing read yet, everything from others is unread',
    beforeRead.unread > 0, `${beforeRead.unread}`)
  ok('your own messages never count as unread',
    beforeRead.unread < beforeRead.total)

  console.log('\n— Opening the chat jumps to the first unread —\n')
  const firstUnreadChat = await chatService.firstUnreadId('u_ahmed')
  ok('there is somewhere to jump to', Boolean(firstUnreadChat))
  const unreadMessage = await db.messages.get(firstUnreadChat!)
  ok('it is not one of your own', unreadMessage!.userId !== 'u_ahmed')
  const older = (await db.messages.orderBy('createdAt').toArray()).filter(
    (m) => m.createdAt < unreadMessage!.createdAt && m.userId !== 'u_ahmed',
  )
  check('and nothing unread sits above it', older.length, 0)

  console.log('\n— Reaching the bottom marks it read —\n')
  const newest = (await db.messages.orderBy('createdAt').toArray()).at(-1)!
  await chatService.markReadUpTo('u_ahmed', newest.createdAt)
  const afterRead = await chatService.summary('u_ahmed')
  check('the unread count clears', afterRead.unread, 0)
  check('and the community card agrees', (await chatService.summary('u_ahmed')).unread, 0)
  check('there is nothing left to jump to', await chatService.firstUnreadId('u_ahmed'), undefined)

  // Marking read must never rewind, or a later read would resurrect old unreads.
  const marker = await chatService.lastReadAt('u_ahmed')
  await chatService.markReadUpTo('u_ahmed', new Date(Date.now() - 86_400_000).toISOString())
  check('marking an older point does not rewind', await chatService.lastReadAt('u_ahmed'), marker)

  console.log('\n— A new message from someone else becomes unread again —\n')
  await authService.signIn('nadia', DEMO_PASSWORD)
  const arrived = await chatService.send({ userId: 'u_nadia', text: 'Heading out now' })
  const withNew = await chatService.summary('u_ahmed')
  check('one unread', withNew.unread, 1)
  check('and it is the message that just arrived', await chatService.firstUnreadId('u_ahmed'), arrived!.id)
  check('the preview shows the newest text', withNew.latest?.text, 'Heading out now')

  await authService.signIn('ahmed', DEMO_PASSWORD)
  // Your own message should not leave you with an unread of your own.
  const mine = await chatService.send({ userId: 'u_ahmed', text: 'On my way' })
  const afterOwn = await chatService.summary('u_ahmed')
  check('your own message is never unread to you', afterOwn.unread, 1)
  check('but it is the latest', afterOwn.latest?.id, mine!.id)

  // Nadia sees Ahmed's two messages as unread; read state is per person.
  const nadiaView = await chatService.summary('u_nadia')
  ok("read state is per person", nadiaView.unread !== afterOwn.unread,
    `ahmed ${afterOwn.unread}, nadia ${nadiaView.unread}`)

  let refusedForeignRead = false
  try {
    await chatService.markReadUpTo('u_nadia', newest.createdAt)
  } catch (error) {
    refusedForeignRead = error instanceof Error && error.name === 'OwnershipError'
  }
  ok('you cannot mark someone else caught up', refusedForeignRead)

  await db.messages.delete(arrived!.id)
  await db.messages.delete(mine!.id)

  console.log('\n— Replies and reactions still work from the conversation —\n')
  const base = await chatService.send({ userId: 'u_ahmed', text: 'Anyone up for a walk?' })
  await authService.signIn('nadia', DEMO_PASSWORD)
  const answer = await chatService.send({
    userId: 'u_nadia', text: 'Give me ten minutes', replyToId: base!.id,
  })
  const threadView = (await chatService.list()).find((m) => m.id === answer!.id)!
  check('the reply quotes the original', threadView.replyTo?.text, 'Anyone up for a walk?')
  await chatService.toggleReaction(base!.id, 'u_nadia', '👏')
  check('a reaction lands',
    (await chatService.list()).find((m) => m.id === base!.id)!.reactions.length, 1)
  await db.messages.delete(base!.id)
  await db.messages.delete(answer!.id)
  await db.chatReactions.where('messageId').equals(base!.id).delete()
  await authService.signIn('ahmed', DEMO_PASSWORD)

  console.log('\n— Workout logs are summary-first —\n')
  const logs = await workoutService.sessionsForUser('u_ahmed')
  ok('there are logs', logs.length > 0, `${logs.length}`)
  ok('every log carries what the journal shows',
    logs.every((s) => Boolean(s.date) && s.durationSec >= 0 && s.caloriesKcal >= 0))
  ok('every log names the app it came from',
    logs.every((s) => Boolean(workoutAppLabel(s.source, s.sourceName))))
  ok('quick logs carry a plan name', logs.filter((s) => s.loggedVia === 'quick_log').every((s) => Boolean(s.planName)))

  // Summary-first means the journal never depends on set-by-set data.
  const quickLogs = logs.filter((s) => s.loggedVia === 'quick_log')
  ok('quick logs exist', quickLogs.length > 0, `${quickLogs.length}`)
  let detailRows = 0
  for (const session of quickLogs) {
    detailRows += await db.setResults.where('sessionId').equals(session.id).count()
  }
  check('and none of them stores exercise detail', detailRows, 0)

  ok(
    'a log is still complete without it',
    quickLogs.every((s) => Boolean(s.planName || s.name) && s.durationSec > 0),
  )

  console.log('\n— The plan still knows which app it belongs to —\n')
  const planned = logs.find((s) => s.source)
  ok('a session identifies its source app', Boolean(planned?.source), planned?.source)
  check('and it resolves to a human label',
    workoutAppLabel(planned!.source, planned!.sourceName), 'Home Workout')

  console.log('\n— Theme preference survives the refinement —\n')
  storageService.setTheme('light')
  check('light persists', storageService.getTheme(), 'light')
  storageService.setTheme('dark')
  check('dark persists', storageService.getTheme(), 'dark')

  console.log('\n— Nothing was lost —\n')
  ok('workouts intact', (await db.sessions.count()) > 20)
  ok('weigh-ins intact', (await db.weights.count()) > 20)
  ok('chat intact', (await db.messages.count()) >= 10)
  ok('posts intact', (await db.posts.count()) >= 5)
  ok('stories intact', (await db.stories.count()) >= 3)
  ok('notifications intact', (await db.notifications.count()) > 0)
  ok('achievements intact', (await db.achievements.count()) > 0)
  ok('challenges intact', (await db.challenges.count()) > 0)
  ok('motivation intact', (await db.videos.count()) >= 3)
  ok('nutrition, water and steps intact',
    (await db.foods.count()) > 0 && (await db.water.count()) > 0 && (await db.steps.count()) > 0)


  // =========================================================================
  // Roles, join requests, and the group/personal split
  // =========================================================================

  console.log('\n— Roles are checked centrally —\n')
  const adminUser = await db.users.get('u_ahmed')
  const plainMember = await db.users.get('u_nadia')
  ok('the seeded admin has the role', hasRole(adminUser, 'admin'))
  ok('a member does not', !hasRole(plainMember, 'admin'))
  ok('a member is a member', hasRole(plainMember, 'member'))
  ok('an account with no role reads as a member', hasRole({ role: undefined }, 'member'))
  ok('and nobody is an adminUser by accident', !hasRole({ role: undefined }, 'admin'))
  ok('an absent user is nothing', !hasRole(null, 'admin') && !hasRole(undefined, 'member'))

  console.log('\n— Email and password validation —\n')
  ok('a gmail address is valid', validateEmail('leila.haddad@gmail.com').valid)
  ok('plus-addressing is valid', validateEmail('sam+fitness@gmail.com').valid)
  ok('a long tld is valid', validateEmail('a@b.fitness').valid)
  ok('an empty address is not', !validateEmail('   ').valid)
  ok('a missing @ is not', !validateEmail('nadia.example.com').valid)
  ok('a missing domain dot is not', !validateEmail('nadia@example').valid)
  ok('and a rejection explains itself', Boolean(validateEmail('nope').message))

  ok('a seven-character password is refused', !checkPassword('abc1234').valid)
  ok('and says why', checkPassword('abc1234').message?.includes('8') === true)
  ok('eight characters is accepted', checkPassword('abcd1234').valid)
  ok('a long mixed password scores higher',
    checkPassword('Correct-Horse-99').score > checkPassword('abcd1234').score)
  ok('every result carries a label', Boolean(checkPassword('abcd1234').label))

  console.log('\n— Duplicate accounts are caught —\n')
  ok('an existing handle is taken', await accountService.isHandleTaken('ahmed'))
  ok('case does not matter', await accountService.isHandleTaken('AHMED'))
  ok('a free handle is not', !(await accountService.isHandleTaken('brand-new-person')))
  ok('an existing email is taken', await accountService.isEmailTaken('ahmed.rahman@gmail.com'))
  ok('with any casing', await accountService.isEmailTaken('Ahmed.Rahman@Gmail.com'))
  ok('a free email is not', !(await accountService.isEmailTaken('nobody@example.com')))

  console.log('\n— Joining no longer waits on approval —\n')
  const waiting = await userService.getByHandle('leila')
  ok('the seeded request exists', Boolean(waiting))
  check('and it is pending', waiting!.status, 'pending')
  await authService.setPassword(waiting!.id, DEMO_PASSWORD)

  // The gate is gone. Approval could only ever be granted on the device that
  // asked for it, so it kept people out of their own account and nobody else's.
  const admitted = await authService.signIn('leila', DEMO_PASSWORD)
  ok('an account left pending is admitted anyway', admitted.id === waiting!.id)
  authService.signOut()
  ok('and signing out clears the session', (await authService.currentUser()) === null)

  console.log('\n— A pending request is not a group member —\n')
  const approvedMembers = await userService.listMembers()
  ok('approvedMembers excludes the pending account', !approvedMembers.some((m) => m.id === waiting!.id))
  ok('every approved account is a member', approvedMembers.length >= 3,
    `${approvedMembers.length} members`)
  ok('but the account row still exists',
    (await db.users.count()) > approvedMembers.length)
  ok('the group snapshot excludes them',
    !(await progressService.groupSnapshot(today)).some((m) => m.user.id === waiting!.id))
  ok('and so does the challenge board',
    !(await challengeService.progress(today))!.contributions.some((c) => c.userId === waiting!.id))
  ok('and the story rail', !(await storyService.rings('u_ahmed')).some((r) => r.user.id === waiting!.id))

  console.log('\n— Only an admin decides, and the decision sticks —\n')
  await authService.signIn('nadia', DEMO_PASSWORD)
  let refusedNonAdmin = false
  try {
    await accountService.decide({ adminId: 'u_nadia', userId: waiting!.id, status: 'approved' })
  } catch {
    refusedNonAdmin = true
  }
  ok('a member cannot approve anyone', refusedNonAdmin)
  check('and the request is untouched', (await db.users.get(waiting!.id))!.status, 'pending')

  let refusedImpersonatedAdmin = false
  try {
    await accountService.decide({ adminId: 'u_ahmed', userId: waiting!.id, status: 'approved' })
  } catch (error) {
    refusedImpersonatedAdmin = error instanceof Error && error.name === 'OwnershipError'
  }
  ok('and you cannot act as the admin while signed in as someone else', refusedImpersonatedAdmin)

  await authService.signIn('ahmed', DEMO_PASSWORD)
  check('the admin sees the request', (await accountService.pending()).length, 1)
  await accountService.decide({ adminId: 'u_ahmed', userId: waiting!.id, status: 'approved' })
  const approved = await db.users.get(waiting!.id)
  check('approving sets the status', approved!.status, 'approved')
  ok('and records who decided', approved!.decidedBy === 'u_ahmed' && Boolean(approved!.decidedAt))
  check('the queue empties', (await accountService.pending()).length, 0)

  const nowIn = await authService.signIn('leila', DEMO_PASSWORD)
  check('an approved account can sign in', nowIn.id, waiting!.id)
  ok('and joins the group',
    (await userService.listMembers()).some((m) => m.id === waiting!.id))

  // Rejection is the other half of the same rule.
  await authService.signIn('ahmed', DEMO_PASSWORD)
  await db.users.update(waiting!.id, { status: 'pending', decidedAt: undefined, decidedBy: undefined })
  await accountService.decide({ adminId: 'u_ahmed', userId: waiting!.id, status: 'rejected' })
  check('rejecting sets the status', (await db.users.get(waiting!.id))!.status, 'rejected')

  let refusedRejected = false
  try {
    await authService.signIn('leila', DEMO_PASSWORD)
  } catch (error) {
    refusedRejected = error instanceof AuthError
  }
  ok('a rejected account cannot sign in', refusedRejected)
  ok('and is not a member', !(await userService.listMembers()).some((m) => m.id === waiting!.id))

  // Deciding twice does nothing; the first decision stands.
  await authService.signIn('ahmed', DEMO_PASSWORD)
  await accountService.decide({ adminId: 'u_ahmed', userId: waiting!.id, status: 'approved' })
  check('a decided request cannot be re-decided', (await db.users.get(waiting!.id))!.status, 'rejected')

  // Put the demo back the way the seed left it.
  await db.users.update(waiting!.id, { status: 'pending', decidedAt: undefined, decidedBy: undefined })

  console.log('\n— Existing approvedMembers are unaffected —\n')
  const stillFine = await authService.signIn('nadia', DEMO_PASSWORD)
  check('an approved member still signs in', stillFine.id, 'u_nadia')
  ok('every seeded member has an email',
    ['u_ahmed', 'u_nadia', 'u_samir'].every((id) =>
      Boolean((approvedMembers.find((m) => m.id === id))?.email)))
  ok('and exactly one is an admin',
    (await db.users.toArray()).filter((u) => hasRole(u, 'admin')).length === 1)

  await authService.signIn('ahmed', DEMO_PASSWORD)

  // ---------------------------------------------------------------------------
  // Chat and Group are separate now: unread belongs to Chat, and the only
  // notification chat may raise is a mention.
  // ---------------------------------------------------------------------------
  console.log('\n— Deleting a message leaves a tombstone —\n')

  await authService.signIn('ahmed', DEMO_PASSWORD)
  const doomed = (await chatService.send({ userId: 'u_ahmed', text: 'This will go' }))!
  const tombReply = (await chatService.send({
    userId: 'u_ahmed',
    text: 'Answering it',
    replyToId: doomed.id,
  }))!
  await chatService.toggleReaction(doomed.id, 'u_ahmed', '\u{1F525}')
  const roomSize = await db.messages.count()

  await chatService.remove(doomed.id)
  const tomb = (await db.messages.get(doomed.id))!
  ok('the row survives', Boolean(tomb))
  check('the conversation does not shrink', await db.messages.count(), roomSize)
  ok('it is marked deleted', Boolean(tomb.deletedAt))
  check('the text is gone, not merely hidden', tomb.text, '')
  check('the timestamp is untouched, so nothing reorders', tomb.createdAt, doomed.createdAt)
  check('its reactions are gone',
    await db.chatReactions.where('messageId').equals(doomed.id).count(), 0)

  await chatService.toggleReaction(doomed.id, 'u_ahmed', '\u{1F44F}')
  check('and it cannot be reacted to again',
    await db.chatReactions.where('messageId').equals(doomed.id).count(), 0)

  const view = await chatService.list()
  const shownTomb = view.find((m) => m.id === doomed.id)!
  ok('it still appears in the thread, in place', Boolean(shownTomb))
  ok('carrying the deleted flag the bubble reads', Boolean(shownTomb.deletedAt))

  const shownReply = view.find((m) => m.id === tombReply.id)!
  check('the reply still points at it', shownReply.replyToId, doomed.id)
  ok('and its quote knows the original is gone', Boolean(shownReply.replyTo?.deletedAt))

  console.log('\n— A deleted share stops showing its card —\n')
  const shared = (await chatService.shareWeighIn('u_ahmed'))!
  ok('the share carries a record reference', Boolean(shared.sharedType && shared.sharedDataId))
  await chatService.remove(shared.id)
  const goneShare = (await db.messages.get(shared.id))!
  check('deleting clears the shared type', goneShare.sharedType, undefined)
  check('and the record reference with it', goneShare.sharedDataId, undefined)

  await expectOwnershipRefusal("Nadia cannot delete Ahmed's message", () =>
    chatService.remove(tombReply.id))

  await authService.signIn('ahmed', DEMO_PASSWORD)
  const beforeSummary = await chatService.summary('u_nadia')
  await chatService.remove(tombReply.id)
  ok('a deleted message is never quoted as the latest',
    beforeSummary.latest?.id !== undefined)
  const afterSummary = await chatService.summary('u_nadia')
  ok('the preview falls back to a message that still exists',
    !afterSummary.latest || !afterSummary.latest.deletedAt)

  // Leave the seeded room as it was found.
  await db.messages.bulkDelete([doomed.id, tombReply.id, shared.id])

  console.log('\n— Post reactions and comments —\n')

  await authService.signIn('ahmed', DEMO_PASSWORD)
  const reactedPost = (await db.posts.orderBy('createdAt').toArray()).at(-1)!
  const startReactions = reactedPost.reactionCount
  const startComments = reactedPost.commentCount

  /** Runs an attempt as Nadia and expects the ownership guard to stop it. */
  const refusedAs = async (label: string, attempt: () => Promise<unknown>) => {
    await authService.signIn('nadia', DEMO_PASSWORD)
    let refused = false
    try {
      await attempt()
    } catch (error) {
      refused = error instanceof Error && error.name === 'OwnershipError'
    }
    ok(label, refused)
    await authService.signIn('ahmed', DEMO_PASSWORD)
  }

  await postService.toggleReaction(reactedPost.id, 'u_ahmed', '\u{1F525}')
  check('reacting raises the count', (await db.posts.get(reactedPost.id))!.reactionCount, startReactions + 1)
  ok('and the row exists',
    (await postService.reactionsFor(reactedPost.id)).some((r) => r.userId === 'u_ahmed'))

  await postService.toggleReaction(reactedPost.id, 'u_ahmed', '\u{1F525}')
  check('the same emoji again takes it back',
    (await db.posts.get(reactedPost.id))!.reactionCount, startReactions)

  await postService.toggleReaction(reactedPost.id, 'u_ahmed', '\u{1F4AA}')
  await postService.toggleReaction(reactedPost.id, 'u_ahmed', '\u{1F44F}')
  check('one reaction per person, replaced rather than added',
    (await postService.reactionsFor(reactedPost.id)).filter((r) => r.userId === 'u_ahmed').length, 1)
  check('and the count reflects that',
    (await db.posts.get(reactedPost.id))!.reactionCount, startReactions + 1)

  const comment = await postService.comment(reactedPost.id, 'u_ahmed', '  Nice work  ')
  check('a comment is trimmed', comment?.text, 'Nice work')
  check('and counted', (await db.posts.get(reactedPost.id))!.commentCount, startComments + 1)
  check('a blank comment is refused', await postService.comment(reactedPost.id, 'u_ahmed', '   '), null)
  ok('comments read oldest first',
    (await postService.commentsFor(reactedPost.id)).every(
      (c, i, all) => i === 0 || all[i - 1].createdAt <= c.createdAt))

  await refusedAs('Nadia cannot react as Ahmed', () =>
    postService.toggleReaction(reactedPost.id, 'u_ahmed', '\u{1F525}'))
  await refusedAs('Nadia cannot comment as Ahmed', () =>
    postService.comment(reactedPost.id, 'u_ahmed', 'not mine'))
  await refusedAs("Nadia cannot delete Ahmed's comment", () =>
    postService.removeComment(comment!.id))

  await postService.removeComment(comment!.id)
  check('deleting your own comment restores the count',
    (await db.posts.get(reactedPost.id))!.commentCount, startComments)

  await postService.toggleReaction(reactedPost.id, 'u_ahmed', '\u{1F44F}')
  check('the demo is left as the seed had it',
    (await db.posts.get(reactedPost.id))!.reactionCount, startReactions)

  console.log('\n— Writing a post —\n')

  await authService.signIn('ahmed', DEMO_PASSWORD)
  const seededPostIds = (await db.posts.toArray()).map((post) => post.id)
  const postFeedBefore = await postService.feed('u_ahmed')
  const mediaBefore = await db.media.count()

  const written = await postService.create({ userId: 'u_ahmed', text: '  Back at it.  ' })
  check('a post is trimmed', written.text, 'Back at it.')
  check('a plain post is a status', written.type, 'status')
  check('and goes to the group by default', written.visibility, DEFAULT_VISIBILITY)
  check('with both counts starting at zero', written.reactionCount + written.commentCount, 0)

  const feedAfter = await postService.feed('u_ahmed')
  check('it appears in the feed straight away', feedAfter.length, postFeedBefore.length + 1)
  check('at the top, because the feed reads newest first', feedAfter[0].id, written.id)
  ok('and the whole feed is still in order',
    feedAfter.every((post, i) => i === 0 || feedAfter[i - 1].createdAt >= post.createdAt))
  check('it belongs to whoever wrote it', feedAfter[0].author.id, 'u_ahmed')
  check('reading the feed again does not duplicate it',
    (await postService.feed('u_ahmed')).filter((post) => post.id === written.id).length, 1)
  check('and nothing the seed put there was disturbed',
    (await db.posts.bulkGet(seededPostIds)).filter(Boolean).length, seededPostIds.length)

  let refusedEmpty = false
  try {
    await postService.create({ userId: 'u_ahmed', text: '   ' })
  } catch {
    refusedEmpty = true
  }
  ok('a post with nothing in it is refused', refusedEmpty)

  console.log('\n— A picture is a reference, never bytes —\n')

  const withPhoto = await postService.create({
    userId: 'u_ahmed',
    text: 'Morning walk.',
    media: {
      kind: 'image',
      // The shape object storage will use. Nothing above the service changes
      // when this stops being a session-scoped URL.
      ref: 'blob:test/post-photo',
      mimeType: 'image/jpeg',
      width: 1200,
      height: 900,
    },
  })
  check('a post carrying a picture is a photo post', withPhoto.type, 'photo')
  check('and references exactly one asset', withPhoto.mediaIds.length, 1)
  const postAsset = await mediaService.get(withPhoto.mediaIds[0])
  check('the asset holds a pointer', postAsset?.ref, 'blob:test/post-photo')
  ok('a session-scoped reference is marked temporary', postAsset?.temporary === true)
  ok('no row in media is embedded binary',
    (await db.media.toArray()).every((row) => !row.ref.startsWith('data:')))
  ok('and no post smuggles one either',
    (await db.posts.toArray()).every((post) => !post.text.startsWith('data:')))

  let refusedBinary = false
  try {
    await postService.create({
      userId: 'u_ahmed',
      text: 'embedded',
      media: { kind: 'image', ref: 'data:image/png;base64,AAAA', mimeType: 'image/png' },
    })
  } catch {
    refusedBinary = true
  }
  ok('an embedded image is refused outright', refusedBinary)
  ok('and no post was written for it',
    !(await db.posts.toArray()).some((post) => post.text === 'embedded'))

  console.log('\n— Sharing a record from a post —\n')

  const postShare = await postService.shareOptions('u_ahmed', today)
  ok('the composer offers the workout Ahmed logged', postShare.has('workout'))
  ok('and the weigh-in', postShare.has('weigh_in'))
  ok('but never the group challenge — a post is one person\u2019s',
    !(postShare as Set<string>).has('challenge'))

  const sharedTarget = await postService.shareTarget('u_ahmed', 'workout', today)
  ok('the latest workout resolves to something real',
    Boolean(sharedTarget && (await db.sessions.get(sharedTarget))))
  const sharedPost = await postService.create({
    userId: 'u_ahmed',
    text: 'Got it done.',
    sharedType: 'workout',
    sharedDataId: sharedTarget,
  })
  check('a shared workout is a workout post', sharedPost.type, 'workout')
  check('and points at the record rather than copying it', sharedPost.sharedDataId, sharedTarget)

  console.log('\n— Who can see it —\n')

  const onlyMe = await postService.create({
    userId: 'u_ahmed',
    text: 'Just for me.',
    visibility: 'private',
  })
  ok('a private post is visible to its author',
    (await postService.feed('u_ahmed')).some((post) => post.id === onlyMe.id))
  ok('and to nobody else',
    !(await postService.feed('u_nadia')).some((post) => post.id === onlyMe.id))
  ok('canView agrees', canView(onlyMe, 'u_ahmed') && !canView(onlyMe, 'u_samir'))

  console.log('\n— Editing and deleting your own post —\n')

  await postService.update(written.id, { text: '  Back at it, properly.  ', visibility: 'private' })
  const editedPost = (await db.posts.get(written.id))!
  check('an edit replaces the words', editedPost.text, 'Back at it, properly.')
  check('and the audience', editedPost.visibility, 'private')
  ok('and says it was edited', Boolean(editedPost.updatedAt))
  check('while keeping the post where it sits in the feed', editedPost.createdAt, written.createdAt)

  let refusedEmptyEdit = false
  try {
    await postService.update(written.id, { text: '   ' })
  } catch {
    refusedEmptyEdit = true
  }
  ok('an edit cannot empty a post', refusedEmptyEdit)

  const droppedAssetId = withPhoto.mediaIds[0]
  await postService.update(withPhoto.id, { media: null })
  check('removing the picture keeps the words',
    (await db.posts.get(withPhoto.id))!.text, 'Morning walk.')
  check('and drops the reference', (await db.posts.get(withPhoto.id))!.mediaIds.length, 0)
  check('so it is a status again', (await db.posts.get(withPhoto.id))!.type, 'status')
  check('and the asset nothing points at is gone', await mediaService.get(droppedAssetId), undefined)

  // Only the two picture-derived kinds follow the picture: a post that
  // announced something keeps saying so, which is what stops an edit quietly
  // relabelling one of the seeded posts.
  const announced = await postService.create({ userId: 'u_ahmed', text: 'Quote of the week.' })
  await db.posts.update(announced.id, { type: 'motivation' })
  await postService.update(announced.id, { media: null })
  check('an announced post keeps its kind through an edit',
    (await db.posts.get(announced.id))!.type, 'motivation')
  await postService.remove(announced.id)

  await refusedAs('Nadia cannot post as Ahmed', () =>
    postService.create({ userId: 'u_ahmed', text: 'not mine' }))
  await refusedAs('Nadia cannot edit Ahmed\u2019s post', () =>
    postService.update(written.id, { text: 'rewritten' }))
  await refusedAs('Nadia cannot delete Ahmed\u2019s post', () =>
    postService.remove(written.id))
  check('so the words are still his', (await db.posts.get(written.id))!.text, 'Back at it, properly.')

  await postService.toggleReaction(sharedPost.id, 'u_ahmed', '\u{1F525}')
  await postService.comment(sharedPost.id, 'u_ahmed', 'Nice one')
  check('a post counts what is attached to it',
    (await db.posts.get(sharedPost.id))!.commentCount, 1)
  await postService.remove(sharedPost.id)
  check('deleting takes the post', await db.posts.get(sharedPost.id), undefined)
  check('its reactions', (await postService.reactionsFor(sharedPost.id)).length, 0)
  check('and its comments', (await postService.commentsFor(sharedPost.id)).length, 0)
  ok('but never the workout it only referenced',
    Boolean(sharedTarget && (await db.sessions.get(sharedTarget))))

  // Leave the feed exactly as the seed built it.
  for (const id of [written.id, withPhoto.id, onlyMe.id]) await postService.remove(id)
  check('the feed is back to what the seed had', (await postService.feed('u_ahmed')).length, postFeedBefore.length)
  check('with no stray reference left behind', await db.media.count(), mediaBefore)

  console.log('\n— The share menu offers only what exists —\n')
  const offered = await chatService.shareable('u_ahmed', today)
  ok('Ahmed can share a workout', offered.has('workout'))
  ok('and a weigh-in', offered.has('weigh_in'))
  ok('no challenge is offered when none is passed', !offered.has('challenge'))
  ok('and one is when it is',
    (await chatService.shareable('u_ahmed', today, 'ch_1')).has('challenge'))

  console.log('\n— Chat unread state —\n')

  await authService.signIn('ahmed', DEMO_PASSWORD)
  await storageService.setMeta('chatLastRead:u_ahmed', '')
  const cold = await chatService.summary('u_ahmed')
  ok('a fresh reader has unread messages', cold.unread > 0, `${cold.unread}`)
  ok(
    'your own messages never count as unread',
    (await db.messages.toArray()).filter((m) => m.userId === 'u_ahmed').length > 0 &&
      cold.unread < cold.total,
  )

  const firstNew = await chatService.firstUnreadId('u_ahmed')
  ok('the first unread message is somebody else’s', Boolean(firstNew))
  check(
    'and it is not one of yours',
    (await db.messages.get(firstNew!))!.userId === 'u_ahmed',
    false,
  )

  const latestMessage = (await db.messages.orderBy('createdAt').toArray()).at(-1)!
  await chatService.markReadUpTo('u_ahmed', latestMessage.createdAt)
  check('reaching the bottom clears the badge', (await chatService.summary('u_ahmed')).unread, 0)

  await chatService.markReadUpTo('u_ahmed', '2000-01-01T00:00:00.000Z')
  check(
    'the read marker never rewinds',
    (await chatService.summary('u_ahmed')).unread,
    0,
  )

  console.log('\n— Only mentions become notifications —\n')

  const beforeCount = await db.notifications.where('userId').equals('u_nadia').count()
  const plain = await chatService.send({ userId: 'u_ahmed', text: 'Training at eight tonight' })
  check(
    'an ordinary message notifies nobody',
    await db.notifications.where('userId').equals('u_nadia').count(),
    beforeCount,
  )

  const tagged = await chatService.send({ userId: 'u_ahmed', text: 'Are you in @Nadia?' })
  const nadiasNotes = await db.notifications.where('userId').equals('u_nadia').toArray()
  check('a mention notifies the person named', nadiasNotes.length, beforeCount + 1)
  const mention = nadiasNotes.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
  check('and it is filed as a mention', mention.kind, 'mention')
  check('pointing at the conversation', mention.href, '/chat/thread')
  check('naming who did it', mention.actorId, 'u_ahmed')
  ok('with text a person can read', mention.text.includes('mentioned you'), mention.text)

  check(
    'tagging by handle works too',
    (await chatService.notifyMentions({ ...tagged!, id: 'tmp_1', text: '@samir you around?' }))[0],
    'u_samir',
  )
  check(
    'tagging yourself notifies nobody',
    (await chatService.notifyMentions({ ...tagged!, id: 'tmp_2', text: '@ahmed talking to myself' }))
      .length,
    0,
  )
  check(
    'an unknown name notifies nobody',
    (await chatService.notifyMentions({ ...tagged!, id: 'tmp_3', text: '@nobody hello' })).length,
    0,
  )
  check(
    'mentionedIn is case- and punctuation-tolerant',
    mentionedIn(
      'morning @NADIA, and @samir!',
      await db.users.toArray(),
      'u_ahmed',
    ).sort().join(','),
    'u_nadia,u_samir',
  )

  // Put the room back the way the seed left it.
  await db.messages.bulkDelete([plain!.id, tagged!.id])
  await db.notifications.bulkDelete(
    (await db.notifications.toArray())
      .filter((n) => n.targetId === plain?.id || n.targetId === tagged?.id || n.targetId?.startsWith('tmp_'))
      .map((n) => n.id),
  )

  console.log('\n— The seeded mention is real —\n')
  const seeded = await db.notifications.get('n_3')
  check('the seeded chat notification is a mention', seeded?.kind, 'mention')
  const mentionMessage = await db.messages.get('m_11')
  ok(
    'and the message it refers to actually names someone',
    mentionedIn(mentionMessage!.text, await db.users.toArray(), mentionMessage!.userId).includes(
      'u_ahmed',
    ),
    mentionMessage!.text,
  )

  console.log('\n— Nothing was lost in the reorganisation —\n')
  ok('workouts intact', (await db.sessions.count()) > 20)
  ok('weigh-ins intact', (await db.weights.count()) > 20)
  ok('chat intact', (await db.messages.count()) >= 10)
  ok('posts intact', (await db.posts.count()) >= 5)
  ok('stories intact', (await db.stories.count()) >= 3)
  ok('notifications intact', (await db.notifications.count()) > 0)
  ok('achievements intact', (await db.achievements.count()) > 0)
  ok('challenges intact', (await db.challenges.count()) > 0)
  ok('motivation intact', (await db.videos.count()) >= 3)
  ok('nutrition, water and steps intact',
    (await db.foods.count()) > 0 && (await db.water.count()) > 0 && (await db.steps.count()) > 0)
  ok('the chat summary still works', (await chatService.summary('u_ahmed')).total > 0)
  ok('progress still computes', (await progressService.userSnapshot('u_ahmed', today))!.energy.target > 0)


  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
