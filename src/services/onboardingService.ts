import { db } from '@/lib/db'
import type { ActivityLevel, DateKey, FitnessGoal, Sex, Units, Weekday, WorkoutSource } from '@/models'

/**
 * What setup collected, held until there is somewhere to put it.
 *
 * Signing up and being let in are now two separate moments, and the gap
 * between them belongs to somebody else — an administrator, on another
 * device, whenever they next look. Setup still asks for height, weight, goal
 * and the rest, because asking a person to fill that in twice would be a
 * strange way to welcome them; but a pending account has no profile to write
 * it to. Its server row is a name and an approval state, and this device
 * deliberately builds no local profile for an account that may never be let
 * in.
 *
 * So the answers wait here, in the `meta` store the database already has, and
 * are consumed exactly once — by `identityLinkService.startFresh`, at the
 * moment approval finally creates a profile for them to describe.
 *
 * Nothing here is a credential and nothing here is trusted. It is a form the
 * person filled in about themselves, kept on their own device, describing
 * their own body. If it is missing — a different browser, cleared storage, an
 * approval three weeks later — the profile is created with defaults and they
 * change what they like from their profile screen. That is why `take` returns
 * null rather than throwing.
 */
export interface OnboardingAnswers {
  handle: string
  avatarColor: string
  birthDate: DateKey
  sex: Sex
  heightCm: number
  startWeightKg: number
  targetWeightKg: number
  goal: FitnessGoal
  activityLevel: ActivityLevel
  stepGoal: number
  waterGoalL: number
  workoutsPerWeekGoal: number
  weighInDay: Weekday
  workoutApps: WorkoutSource[]
  units: Units
}

/** Keyed by the account, so two people setting up on one device cannot mix. */
const key = (serverUserId: string) => `onboarding:${serverUserId}`

export const onboardingService = {
  async remember(serverUserId: string, answers: OnboardingAnswers): Promise<void> {
    await db.meta.put({ key: key(serverUserId), value: answers })
  },

  /**
   * Reads the answers and forgets them in the same breath.
   *
   * Once a profile exists it is the record, and a stale copy of what somebody
   * typed during setup could only ever overwrite a later correction.
   */
  async take(serverUserId: string): Promise<OnboardingAnswers | null> {
    const row = await db.meta.get(key(serverUserId))
    if (!row) return null
    await db.meta.delete(key(serverUserId))
    return (row.value as OnboardingAnswers) ?? null
  },
}
