import type { AchievementDef, AchievementGroup } from '@/models'

/**
 * Mostly about showing up. Nothing here rewards being the lightest person in
 * the group — the body milestones measure movement toward whatever that
 * person's own goal is, so gaining and losing count the same.
 *
 * Keys are permanent. Several were unlocked by the original twelve and are
 * still referenced by stored rows, so they are never renamed.
 */
export const ACHIEVEMENTS: AchievementDef[] = [
  // --- Workouts ------------------------------------------------------------
  { key: 'first_workout', title: 'First Workout', description: 'You started. That is the hard part.', icon: '🌱', group: 'training', criteria: 'Complete one workout.', tier: 1 },
  { key: 'five_workouts', title: '5 Workouts', description: 'Five done. It is starting to stick.', icon: '🔩', group: 'training', criteria: 'Complete 5 workouts.', tier: 2 },
  { key: 'ten_workouts', title: '10 Workouts', description: 'Ten sessions in the bank.', icon: '🏋️', group: 'training', criteria: 'Complete 10 workouts.', tier: 3 },
  { key: 'twentyfive_workouts', title: '25 Workouts', description: 'Twenty-five. That is a real base.', icon: '🧱', group: 'training', criteria: 'Complete 25 workouts.', tier: 4 },
  { key: 'fifty_workouts', title: '50 Workouts', description: 'This is a habit now, not a phase.', icon: '🥇', group: 'training', criteria: 'Complete 50 workouts.', tier: 5 },
  { key: 'hundred_workouts', title: '100 Workouts', description: 'One hundred times you chose to go.', icon: '💯', group: 'training', criteria: 'Complete 100 workouts.', tier: 6 },

  // --- Streak --------------------------------------------------------------
  { key: 'streak_3', title: '3 Day Streak', description: 'Three in a row. The chain has started.', icon: '✨', group: 'streak', criteria: 'Log something on 3 days in a row.', tier: 1 },
  { key: 'streak_7', title: '7 Day Streak', description: 'A full week without breaking the chain.', icon: '🔥', group: 'streak', criteria: 'Log something on 7 days in a row.', tier: 2 },
  { key: 'streak_14', title: '14 Day Streak', description: 'Two weeks straight.', icon: '🌟', group: 'streak', criteria: 'Log something on 14 days in a row.', tier: 3 },
  { key: 'streak_30', title: '30 Day Streak', description: 'A month of showing up.', icon: '⚡', group: 'streak', criteria: 'Log something on 30 days in a row.', tier: 4 },
  { key: 'streak_60', title: '60 Day Streak', description: 'Two months unbroken.', icon: '☄️', group: 'streak', criteria: 'Log something on 60 days in a row.', tier: 5 },
  { key: 'streak_90', title: '90 Day Streak', description: 'Ninety days. This is just who you are now.', icon: '👑', group: 'streak', criteria: 'Log something on 90 days in a row.', tier: 6 },

  // --- Steps ---------------------------------------------------------------
  { key: 'steps_10k_day', title: '10,000 Steps', description: 'Ten thousand steps in a single day.', icon: '🚶', group: 'steps', criteria: 'Record 10,000 steps in a single day.', tier: 1 },
  { key: 'steps_50k', title: '50,000 Steps', description: 'Fifty thousand steps logged.', icon: '👟', group: 'steps', criteria: 'Record 50,000 steps in total.', tier: 2 },
  { key: 'steps_100k', title: '100,000 Steps', description: 'Six figures on foot.', icon: '🥾', group: 'steps', criteria: 'Record 100,000 steps in total.', tier: 3 },
  { key: 'steps_500k', title: '500,000 Steps', description: 'Half a million. That is a long way.', icon: '🗺️', group: 'steps', criteria: 'Record 500,000 steps in total.', tier: 4 },
  { key: 'steps_1m', title: '1 Million Steps', description: 'A million steps. Genuinely remarkable.', icon: '🌍', group: 'steps', criteria: 'Record 1,000,000 steps in total.', tier: 5 },

  // --- Weight & goal -------------------------------------------------------
  { key: 'first_kg', title: 'First 1 kg', description: 'The first one proves it works.', icon: '⚖️', group: 'body', criteria: 'Move 1 kg toward your own target, whichever direction that is.', tier: 1 },
  { key: 'three_kg', title: '3 kg Progress', description: 'Three kilograms in the right direction.', icon: '📐', group: 'body', criteria: 'Move 3 kg toward your own target.', tier: 2 },
  { key: 'five_kg', title: '5 kg Progress', description: 'Five kilograms of real change.', icon: '🎯', group: 'body', criteria: 'Move 5 kg toward your own target.', tier: 3 },
  { key: 'ten_kg', title: '10 kg Progress', description: 'Ten kilograms. People will have noticed.', icon: '🏔️', group: 'body', criteria: 'Move 10 kg toward your own target.', tier: 4 },
  { key: 'goal_reached', title: 'Goal Reached', description: 'You said you would, and you did.', icon: '🏁', group: 'body', criteria: 'Reach your target weight.', tier: 5 },

  // --- Nutrition -----------------------------------------------------------
  { key: 'nutrition_7', title: '7 Days Logged', description: 'A week of knowing what you ate.', icon: '🍎', group: 'nutrition', criteria: 'Log food on 7 separate days.', tier: 1 },
  { key: 'nutrition_14', title: '14 Days Logged', description: 'Two weeks of paying attention.', icon: '🥗', group: 'nutrition', criteria: 'Log food on 14 separate days.', tier: 2 },
  { key: 'nutrition_30', title: '30 Days Logged', description: 'A month logged. That takes patience.', icon: '📗', group: 'nutrition', criteria: 'Log food on 30 separate days.', tier: 3 },

  // --- Consistency ---------------------------------------------------------
  { key: 'consistency_7', title: '7 Day Consistency', description: 'Seven active days recorded.', icon: '📅', group: 'consistency', criteria: 'Have 7 days on which you logged a workout, steps or a weigh-in.', tier: 1 },
  { key: 'consistency_30', title: '30 Day Consistency', description: 'Steady for a whole month.', icon: '📈', group: 'consistency', criteria: 'Have 30 such days.', tier: 2 },
  { key: 'consistency_60', title: '60 Day Consistency', description: 'Sixty active days. Quietly impressive.', icon: '🧭', group: 'consistency', criteria: 'Have 60 such days.', tier: 3 },

  // --- Special -------------------------------------------------------------
  { key: 'first_weigh_in', title: 'First Weekly Weigh-in', description: 'Your progress story has a beginning.', icon: '📌', group: 'special', criteria: 'Record one weekly weigh-in.', tier: 1 },
  { key: 'first_update', title: 'First Group Update', description: 'You told the others. That is the whole point.', icon: '📣', group: 'special', criteria: 'Post one update to the group.', tier: 2 },
  { key: 'first_pr', title: 'First Personal Best', description: 'Your best session yet.', icon: '💥', group: 'special', criteria: 'Record a set that beats your previous best for that exercise.', tier: 3 },
]

export const ACHIEVEMENT_BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]))

/** Section order and copy for the achievements screen. */
export const ACHIEVEMENT_GROUPS: { key: AchievementGroup; label: string }[] = [
  { key: 'training', label: 'Workouts' },
  { key: 'streak', label: 'Streak' },
  { key: 'steps', label: 'Steps' },
  { key: 'body', label: 'Weight & goal' },
  { key: 'nutrition', label: 'Nutrition' },
  { key: 'consistency', label: 'Consistency' },
  { key: 'special', label: 'Milestones' },
]
