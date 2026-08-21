/**
 * Domain models.
 *
 * These are deliberately normalised and reference each other by id so the same
 * shapes can move to Firestore/Postgres later without reshaping the UI. Nothing
 * here stores binary data — images are referenced, never embedded.
 */

export type ID = string
/** Calendar day, 'YYYY-MM-DD', always in the user's local time. */
export type DateKey = string
/** Full ISO 8601 timestamp. */
export type Timestamp = string

export type Sex = 'male' | 'female'

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'

export type FitnessGoal =
  | 'lose_weight'
  | 'maintain'
  | 'gain_weight'
  | 'build_muscle'
  | 'improve_fitness'
  | 'general_fitness'

/**
 * The app someone actually trained in. We record results from other apps
 * rather than replacing them, so every workout knows where it came from.
 */
export type WorkoutSource = 'home_workout' | 'lose_weight_men' | 'other'

/** 0 = Sunday … 6 = Saturday. Matches `Date.prototype.getDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type Units = 'metric' | 'imperial'

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snacks'

export type Difficulty = 'hard' | 'just_right' | 'easy'

export type Soreness = 'none' | 'low' | 'medium' | 'high'

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * What someone is allowed to do.
 *
 * Checked through `hasRole` rather than by comparing strings in components, so
 * when a server owns authorisation there is one place to change. This is a
 * local convenience today and provides no real security — anyone with the
 * device can edit the record.
 */
export type UserRole = 'admin' | 'member'

/** Where an account is in the join process. */
export type AccountStatus = 'pending' | 'approved' | 'rejected'

export interface User {
  id: ID
  name: string
  /** Short login handle. Auth is local-only for now; see authService. */
  handle: string
  /** Primary contact and future password-recovery identity. */
  email?: string
  role?: UserRole
  status?: AccountStatus
  /** Set when an admin approved or rejected the request. */
  decidedAt?: Timestamp
  decidedBy?: ID
  /**
   * Local credential representation — a salted digest, never the password.
   * This is device-local and is NOT a security boundary; a real backend will
   * own credentials later. Nothing in the UI ever reads it.
   */
  secret?: string
  avatarUrl?: string
  /** Fallback avatar tint when there is no photo. */
  avatarColor: string
  birthDate: DateKey
  sex: Sex
  heightCm: number
  startWeightKg: number
  targetWeightKg: number
  goal: FitnessGoal
  activityLevel: ActivityLevel
  /** Manual override; when unset the target is derived from TDEE. */
  calorieTargetOverride?: number
  stepGoal: number
  waterGoalL: number
  workoutsPerWeekGoal: number
  /** Which day the official weekly weigh-in falls on. Default Sunday. */
  weighInDay: Weekday
  /** The workout apps this person actually uses, for the quick-log shortlist. */
  workoutApps: WorkoutSource[]
  units: Units
  /** Set once the setup flow has been completed. */
  onboardedAt?: Timestamp
  joinedAt: Timestamp
}

/** A user's own personal target, separate from the shared profile numbers. */
export interface Goal {
  id: ID
  userId: ID
  kind: 'weight' | 'workouts' | 'steps' | 'measurement' | 'custom'
  title: string
  targetValue: number
  unit: string
  targetDate?: DateKey
  createdAt: Timestamp
  achievedAt?: Timestamp
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

export interface WeightEntry {
  id: ID
  userId: ID
  date: DateKey
  weightKg: number
  /** The weekly 'official' weigh-in is what the group compares; daily is optional. */
  kind: 'official' | 'daily'
  note?: string
  createdAt: Timestamp
}

export interface BodyMeasurement {
  id: ID
  userId: ID
  date: DateKey
  waistCm?: number
  chestCm?: number
  hipsCm?: number
  armCm?: number
  thighCm?: number
  bodyFatPct?: number
  note?: string
  createdAt: Timestamp
}

/**
 * Progress photos are metadata only. Binary lives in device-local IndexedDB
 * (or, later, object storage) and is referenced by storageRef — never inlined.
 */
export interface ProgressPhoto {
  id: ID
  userId: ID
  date: DateKey
  pose: 'front' | 'side' | 'back'
  storageRef: string
  width: number
  height: number
  createdAt: Timestamp
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export interface Exercise {
  id: ID
  name: string
  muscleGroups: string[]
  equipment: 'bodyweight' | 'dumbbell' | 'barbell' | 'machine' | 'band' | 'other'
  /** Metabolic equivalent, used to estimate calories burned. */
  met: number
  cue?: string
  /**
   * Reserved for a future illustration set. Nothing ships one today — the
   * player draws a placeholder when this is absent, so adding art later is a
   * data change rather than a UI change.
   */
  imageUrl?: string
}

export interface WorkoutPlan {
  id: ID
  name: string
  description: string
  level: 'beginner' | 'intermediate' | 'advanced'
  totalDays: number
  focus: string[]
  /** null = shared with the whole group; otherwise the owner's id. */
  ownerId: ID | null
  createdAt: Timestamp
}

/** Which plan a user is currently working through, and when they started it. */
export interface PlanEnrollment {
  id: ID
  userId: ID
  planId: ID
  startDate: DateKey
  active: boolean
}

export interface PlanDay {
  id: ID
  planId: ID
  dayNumber: number
  name: string
  estimatedMinutes: number
}

export interface WorkoutExercise {
  id: ID
  planDayId: ID
  exerciseId: ID
  order: number
  sets: number
  reps?: number
  durationSec?: number
  restSec: number
  weightKg?: number
}

export interface WorkoutSession {
  id: ID
  userId: ID
  planId?: ID
  planDayId?: ID
  dayNumber?: number
  name: string
  startedAt: Timestamp
  completedAt?: Timestamp
  date: DateKey
  durationSec: number
  exerciseCount: number
  caloriesKcal: number
  difficulty?: Difficulty
  note?: string
  status: 'in_progress' | 'completed' | 'abandoned'
  /**
   * Where the workout was actually performed. Absent on sessions recorded by
   * the built-in player before external logging existed, which is why every
   * read treats `undefined` as "this app".
   */
  source?: WorkoutSource
  /** Free-text app name when `source` is 'other'. */
  sourceName?: string
  /** Plan name as it reads in the external app, e.g. "Full Body Beginner". */
  planName?: string
  /** How the record was created. Quick logs never have set-by-set detail. */
  loggedVia?: 'player' | 'quick_log'
  /**
   * Pause bookkeeping. Elapsed time is always derived from these plus
   * `startedAt` rather than counted up, so it survives a refresh and cannot
   * drift while the tab is backgrounded.
   */
  pausedSec?: number
  pausedAt?: Timestamp
}

export interface SetResult {
  id: ID
  sessionId: ID
  workoutExerciseId: ID
  /** 0-based position within the exercise's sets. */
  setIndex: number
  reps?: number
  durationSec?: number
  weightKg?: number
  completed: boolean
  /** Written when the user skips the exercise rather than performing it. */
  skipped?: boolean
  completedAt?: Timestamp
}

// ---------------------------------------------------------------------------
// Nutrition & daily logs
// ---------------------------------------------------------------------------

export interface FoodEntry {
  id: ID
  userId: ID
  date: DateKey
  meal: MealSlot
  name: string
  /** Display string, e.g. "150 g". Derived from quantity + unit when present. */
  portion: string
  /**
   * Split out so a portion can be edited as a number — "200 g → 250 g" — rather
   * than by re-parsing the display string. Optional because entries seeded
   * before the nutrition screen existed only carry `portion`.
   */
  quantity?: number
  unit?: string
  note?: string
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
  /**
   * 'photo' entries came from the food-scan flow. The photo itself is discarded
   * after analysis — only these numbers are ever stored.
   */
  source: 'manual' | 'photo' | 'favourite'
  createdAt: Timestamp
}

export interface WaterEntry {
  id: ID
  userId: ID
  date: DateKey
  ml: number
  createdAt: Timestamp
}

export interface StepEntry {
  id: ID
  userId: ID
  date: DateKey
  steps: number
  source: 'manual' | 'health_kit' | 'health_connect' | 'fitbit'
  createdAt: Timestamp
}

export interface DailyCheckIn {
  id: ID
  userId: ID
  date: DateKey
  /** 1 low → 4 great */
  energy: 1 | 2 | 3 | 4
  /** 1 😞 → 5 🔥 */
  mood: 1 | 2 | 3 | 4 | 5
  soreness: Soreness
  note?: string
  createdAt: Timestamp
}

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

export type UpdateKind =
  | 'workout_completed'
  | 'weight_logged'
  | 'steps_logged'
  | 'checkin'
  | 'achievement'
  | 'goal_reached'
  | 'nutrition_logged'
  | 'challenge_completed'

export interface Update {
  id: ID
  userId: ID
  kind: UpdateKind
  text: string
  /** Small denormalised payload for rendering the row without extra reads. */
  meta?: Record<string, string | number>
  /**
   * Identifies the real-world event behind this post, e.g. `weigh-in:2026-08-15`.
   * Posting the same key twice is a no-op, so correcting a weigh-in or finishing
   * a workout from two tabs cannot flood the feed.
   */
  dedupeKey?: string
  createdAt: Timestamp
}

export interface Reaction {
  id: ID
  updateId: ID
  userId: ID
  emoji: string
  createdAt: Timestamp
}

export type AchievementGroup =
  | 'training'
  | 'streak'
  | 'steps'
  | 'body'
  | 'nutrition'
  | 'consistency'
  | 'special'

// ---------------------------------------------------------------------------
// Group chat
// ---------------------------------------------------------------------------

/**
 * What a message is carrying besides its text. A share references the record
 * it describes by id rather than copying it, so a card always renders the
 * current truth and correcting a workout does not leave a stale message behind.
 */
export type SharedType = 'workout' | 'weigh_in' | 'steps' | 'achievement' | 'challenge'

/**
 * One message in the group's conversation.
 *
 * Deliberately small: text, who, when, and optionally what it points at. No
 * attachments, no images, no read receipts, no typing state. Shaped so it can
 * move to a `messages` collection unchanged.
 */
export interface ChatMessage {
  id: ID
  userId: ID
  text: string
  createdAt: Timestamp
  /** One level only — a reply to a reply still points at the original. */
  replyToId?: ID
  sharedType?: SharedType
  /**
   * The id of the shared record: a session, a weight entry, a step entry, an
   * achievement key or a challenge. Never a copy of its contents.
   */
  sharedDataId?: ID
  /**
   * Set when the author deletes the message.
   *
   * Soft, so the conversation keeps its shape: the bubble stays where it was,
   * timestamps do not shift, and a reply that quoted it still has something to
   * point at. The content itself is cleared at the same time — a deleted
   * message must not survive in the database where some later view could
   * render it.
   *
   * Not indexed: nothing queries by it, and adding an index would force a
   * schema version for a field Dexie already stores happily.
   */
  deletedAt?: Timestamp
}

export interface ChatReaction {
  id: ID
  messageId: ID
  userId: ID
  emoji: string
  createdAt: Timestamp
}

// ---------------------------------------------------------------------------
// The social layer
// ---------------------------------------------------------------------------

/**
 * Who can see a thing.
 *
 * Everything social in this app defaults to `group`: three people in a private
 * room. `private` is for the person alone, `public` exists so the type does not
 * have to change when a shareable link is added later — nothing uses it today.
 */
export type Visibility = 'private' | 'group' | 'public'

/**
 * A reference to a picture or a clip. Never the bytes.
 *
 * The application must not hold binary in IndexedDB, so this row is metadata
 * and a pointer. Today `ref` is either a `placeholder:` token the UI draws
 * itself or a session-scoped `blob:` URL; when object storage arrives (R2 or
 * similar) it becomes a key and nothing above this line has to change.
 */
export interface MediaAsset {
  id: ID
  kind: 'image' | 'video'
  /** Storage key, `placeholder:<name>`, or a temporary `blob:` URL. */
  ref: string
  mimeType: string
  width?: number
  height?: number
  durationSec?: number
  /**
   * True when `ref` is only valid for this page load. A temporary asset is
   * never treated as durable, and the UI says so rather than showing a
   * broken image after a refresh.
   */
  temporary?: boolean
  createdAt: Timestamp
}

export type PostType =
  | 'text'
  | 'photo'
  | 'video'
  | 'workout'
  | 'weigh_in'
  | 'steps'
  | 'achievement'
  | 'motivation'
  | 'status'

/**
 * Something someone chose to say to the group.
 *
 * A post that carries a record — a workout, a weigh-in — references it by id
 * through the same `sharedType`/`sharedDataId` pair the chat already uses, so
 * the card always renders current truth rather than a copy that can go stale.
 *
 * Counts are denormalised for the feed, which reads far more often than it
 * writes. Phase 2 owns keeping them honest.
 */
export interface Post {
  id: ID
  userId: ID
  type: PostType
  text: string
  createdAt: Timestamp
  updatedAt?: Timestamp
  visibility: Visibility
  /** Media is referenced, never embedded. Usually zero or one. */
  mediaIds: ID[]
  sharedType?: SharedType
  sharedDataId?: ID
  reactionCount: number
  commentCount: number
}

export interface PostReaction {
  id: ID
  postId: ID
  userId: ID
  emoji: string
  createdAt: Timestamp
}

/** One level, like the chat. Threads are deliberately not a feature. */
export interface Comment {
  id: ID
  postId: ID
  userId: ID
  text: string
  createdAt: Timestamp
}

export type StoryType =
  | 'text'
  | 'photo'
  | 'video'
  | 'workout'
  | 'weigh_in'
  | 'achievement'
  | 'motivation'

/**
 * A story is a post with a deadline.
 *
 * `expiresAt` is authoritative and always written at creation; nothing reads a
 * story without checking it, so an expired story cannot appear because a
 * cleanup job did not run.
 */
export interface Story {
  id: ID
  userId: ID
  type: StoryType
  text?: string
  mediaId?: ID
  createdAt: Timestamp
  expiresAt: Timestamp
  sharedType?: SharedType
  sharedDataId?: ID
}

/** Who has seen a story. Separate rows so the story itself stays immutable. */
export interface StoryView {
  id: ID
  storyId: ID
  userId: ID
  viewedAt: Timestamp
}

/**
 * What is worth interrupting someone for.
 *
 * `mention` is the only chat-related kind, on purpose. Ordinary messages,
 * reactions and group updates are represented by the Chat tab's unread badge
 * and by the feed itself — a notification for every message would train people
 * to ignore the bell, at which point it cannot do its job for the things that
 * actually need an answer.
 */
export type NotificationKind =
  | 'post_reaction'
  | 'comment'
  | 'mention'
  | 'story'
  | 'achievement'
  | 'challenge'
  | 'weigh_in_reminder'
  | 'workout_activity'

/**
 * Something worth telling one person about. Addressed to `userId`; `actorId` is
 * whoever caused it, absent when the app itself did.
 */
export interface AppNotification {
  id: ID
  userId: ID
  kind: NotificationKind
  text: string
  createdAt: Timestamp
  readAt?: Timestamp
  actorId?: ID
  /** The post, message, story or achievement this points at. */
  targetId?: ID
  /** Where tapping it should go. */
  href?: string
}

export interface AchievementDef {
  key: string
  title: string
  description: string
  icon: string
  group: AchievementGroup
  /**
   * Ordering hint within a group, so "5 Workouts" always sits before
   * "10 Workouts" no matter how the list is filtered.
   */
  tier: number
}

export interface UserAchievement {
  id: ID
  userId: ID
  achievementKey: string
  unlockedAt: Timestamp
}

/**
 * A link, never a file. Nothing about a video is downloaded, uploaded or
 * stored as binary — the thumbnail is a remote URL too.
 */
export interface MotivationVideo {
  id: ID
  title: string
  /** External URL only — we never host video. */
  url: string
  provider: 'youtube' | 'vimeo' | 'other'
  quote?: string
  thumbnailUrl?: string
  durationSec?: number
  addedBy: ID
  addedAt: Timestamp
  /** Excluded from the weekly rotation while false. */
  isActive: boolean
  /** Position in the weekly rotation. Lower goes first; ties fall back to id. */
  rotationOrder?: number
}

// ---------------------------------------------------------------------------
// Weekly group challenge
// ---------------------------------------------------------------------------

export type ChallengeMetric = 'steps' | 'workouts' | 'checkins' | 'water' | 'nutrition'

/**
 * One shared target per week. Progress is always derived from the same records
 * the rest of the app writes — a challenge never stores its own totals, so it
 * cannot drift from reality.
 */
export interface GroupChallenge {
  id: ID
  /** Sunday of the week this challenge belongs to, matching `startOfWeek`. */
  weekStart: DateKey
  title: string
  blurb: string
  metric: ChallengeMetric
  /** Combined across the group when `perMember` is false, otherwise each. */
  target: number
  perMember: boolean
  unit: string
  icon: string
  createdAt: Timestamp
}

/** Computed, never persisted. */
export interface ChallengeProgress {
  challenge: GroupChallenge
  contributions: { userId: ID; value: number; met: boolean }[]
  total: number
  target: number
  pct: number
  complete: boolean
}

// ---------------------------------------------------------------------------
// Derived shapes (computed, never persisted)
// ---------------------------------------------------------------------------

export interface WeeklySummary {
  userId: ID
  weekStart: DateKey
  weekEnd: DateKey
  workouts: number
  workoutGoal: number
  durationSec: number
  caloriesBurned: number
  steps: number
  avgStepsPerDay: number
  daysLogged: number
  weightChangeKg?: number
  consistencyPct: number
}

export interface DayTotals {
  date: DateKey
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
  waterMl: number
  steps: number
  workoutCompleted: boolean
  weightKg?: number
  checkedIn: boolean
}
