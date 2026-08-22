import Dexie from 'dexie'
import type { EntityTable } from 'dexie'
import type {
  BodyMeasurement,
  DailyCheckIn,
  ChatMessage,
  ChatReaction,
  Comment,
  MediaAsset,
  AppNotification,
  Post,
  PostReaction,
  Story,
  StoryView,
  Exercise,
  FoodEntry,
  Goal,
  GroupChallenge,
  MotivationVideo,
  PlanDay,
  PlanEnrollment,
  ProgressPhoto,
  Reaction,
  SetResult,
  StepEntry,
  Update,
  User,
  UserAchievement,
  WaterEntry,
  WeightEntry,
  WorkoutExercise,
  WorkoutPlan,
  WorkoutSession,
} from '@/models'

/** Free-form key/value row for preferences and bookkeeping. */
export interface MetaRow {
  key: string
  value: unknown
}

/**
 * One store per entity, indexed the way the app actually queries: nearly every
 * read is "this user, this day" or "this user, this range", so [userId+date]
 * compound indexes carry the load. Mirrors a future SQL/Firestore layout.
 */
export class CircuitDb extends Dexie {
  users!: EntityTable<User, 'id'>
  goals!: EntityTable<Goal, 'id'>
  weights!: EntityTable<WeightEntry, 'id'>
  measurements!: EntityTable<BodyMeasurement, 'id'>
  photos!: EntityTable<ProgressPhoto, 'id'>
  exercises!: EntityTable<Exercise, 'id'>
  plans!: EntityTable<WorkoutPlan, 'id'>
  enrollments!: EntityTable<PlanEnrollment, 'id'>
  planDays!: EntityTable<PlanDay, 'id'>
  workoutExercises!: EntityTable<WorkoutExercise, 'id'>
  sessions!: EntityTable<WorkoutSession, 'id'>
  setResults!: EntityTable<SetResult, 'id'>
  foods!: EntityTable<FoodEntry, 'id'>
  water!: EntityTable<WaterEntry, 'id'>
  steps!: EntityTable<StepEntry, 'id'>
  checkins!: EntityTable<DailyCheckIn, 'id'>
  updates!: EntityTable<Update, 'id'>
  reactions!: EntityTable<Reaction, 'id'>
  achievements!: EntityTable<UserAchievement, 'id'>
  videos!: EntityTable<MotivationVideo, 'id'>
  challenges!: EntityTable<GroupChallenge, 'id'>
  messages!: EntityTable<ChatMessage, 'id'>
  chatReactions!: EntityTable<ChatReaction, 'id'>
  posts!: EntityTable<Post, 'id'>
  postReactions!: EntityTable<PostReaction, 'id'>
  comments!: EntityTable<Comment, 'id'>
  stories!: EntityTable<Story, 'id'>
  storyViews!: EntityTable<StoryView, 'id'>
  media!: EntityTable<MediaAsset, 'id'>
  notifications!: EntityTable<AppNotification, 'id'>
  meta!: EntityTable<MetaRow, 'key'>

  constructor() {
    super('circuit')
    this.version(1).stores({
      users: 'id, handle',
      goals: 'id, userId',
      weights: 'id, userId, date, [userId+date]',
      measurements: 'id, userId, date, [userId+date]',
      photos: 'id, userId, [userId+date]',
      exercises: 'id, name',
      plans: 'id, ownerId',
      enrollments: 'id, userId, planId',
      planDays: 'id, planId, [planId+dayNumber]',
      workoutExercises: 'id, planDayId, [planDayId+order]',
      sessions: 'id, userId, date, status, [userId+date], [userId+status]',
      setResults: 'id, sessionId, [sessionId+workoutExerciseId]',
      foods: 'id, userId, date, [userId+date]',
      water: 'id, userId, date, [userId+date]',
      steps: 'id, userId, date, [userId+date]',
      checkins: 'id, userId, date, [userId+date]',
      updates: 'id, userId, createdAt',
      reactions: 'id, updateId, [updateId+userId]',
      achievements: 'id, userId, [userId+achievementKey]',
      videos: 'id, addedBy',
      meta: 'key',
    })

    /**
     * v2 — external workout logging, weekly challenges and local credentials.
     *
     * Only the changed stores are listed; Dexie carries the rest forward. The
     * upgrade backfills the fields added to `User` so a browser holding v1 data
     * keeps every workout, weigh-in and meal it already had.
     */
    this.version(2)
      // weekStart is unique: one challenge per week, so a race between two
      // tabs creating it fails loudly rather than duplicating the board.
      .stores({ challenges: 'id, &weekStart' })
      .upgrade(async (tx) => {
        await tx
          .table('users')
          .toCollection()
          .modify((user: Partial<User>) => {
            user.weighInDay ??= 0
            user.workoutApps ??= ['home_workout']
            user.units ??= 'metric'
            // Anyone already using the app has finished setting it up.
            user.onboardedAt ??= user.joinedAt
          })
      })

    /**
     * v3 — the group chat.
     *
     * Two new stores and nothing else touched, so every existing workout,
     * weigh-in, meal and update is carried forward untouched. Chat reactions
     * get their own table rather than overloading `reactions`, whose rows are
     * keyed to updates; a shared shape beats a field that means two things.
     */
    this.version(3).stores({
      // replyToId is indexed because deleting a message has to find the
      // replies that quote it and clear the link.
      messages: 'id, userId, createdAt, replyToId',
      chatReactions: 'id, messageId, [messageId+userId]',
    })

    /**
     * v4 — the social foundation.
     *
     * Seven new stores, nothing existing touched, so every workout, weigh-in,
     * meal, message and achievement carries forward untouched. `media` holds
     * metadata and a reference only — no binary ever enters IndexedDB.
     */
    this.version(4).stores({
      posts: 'id, userId, createdAt, type',
      postReactions: 'id, postId, [postId+userId]',
      comments: 'id, postId, createdAt',
      stories: 'id, userId, createdAt, expiresAt',
      storyViews: 'id, storyId, [storyId+userId]',
      media: 'id',
      notifications: 'id, userId, createdAt, readAt',
    })

    /**
     * v5 — joining no longer needs approval.
     *
     * Sign-up now creates an active account, so any request already sitting in
     * this browser would otherwise wait on a decision that can never arrive:
     * the admin screen only ever saw its own device, never anyone else's.
     * Flipping them here means an account made before this change simply works
     * on the next load, on whichever phone created it.
     *
     * `rejected` is left alone — that was a decision someone actually made.
     */
    this.version(5).upgrade(async (tx) => {
      await tx
        .table('users')
        .toCollection()
        .modify((user: Partial<User>) => {
          if (user.status === 'pending') user.status = 'approved'
        })
    })
  }
}

export const db = new CircuitDb()

/** Thrown errors are turned into human copy at the UI edge — never shown raw. */
export class DataError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DataError'
  }
}
