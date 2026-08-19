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
  { key: 'first_workout', title: 'First Workout', description: 'You started. That is the hard part.', icon: '🌱', group: 'training', tier: 1 },
  { key: 'five_workouts', title: '5 Workouts', description: 'Five done. It is starting to stick.', icon: '🔩', group: 'training', tier: 2 },
  { key: 'ten_workouts', title: '10 Workouts', description: 'Ten sessions in the bank.', icon: '🏋️', group: 'training', tier: 3 },
  { key: 'twentyfive_workouts', title: '25 Workouts', description: 'Twenty-five. That is a real base.', icon: '🧱', group: 'training', tier: 4 },
  { key: 'fifty_workouts', title: '50 Workouts', description: 'This is a habit now, not a phase.', icon: '🥇', group: 'training', tier: 5 },
  { key: 'hundred_workouts', title: '100 Workouts', description: 'One hundred times you chose to go.', icon: '💯', group: 'training', tier: 6 },

  // --- Streak --------------------------------------------------------------
  { key: 'streak_3', title: '3 Day Streak', description: 'Three in a row. The chain has started.', icon: '✨', group: 'streak', tier: 1 },
  { key: 'streak_7', title: '7 Day Streak', description: 'A full week without breaking the chain.', icon: '🔥', group: 'streak', tier: 2 },
  { key: 'streak_14', title: '14 Day Streak', description: 'Two weeks straight.', icon: '🌟', group: 'streak', tier: 3 },
  { key: 'streak_30', title: '30 Day Streak', description: 'A month of showing up.', icon: '⚡', group: 'streak', tier: 4 },
  { key: 'streak_60', title: '60 Day Streak', description: 'Two months unbroken.', icon: '☄️', group: 'streak', tier: 5 },
  { key: 'streak_90', title: '90 Day Streak', description: 'Ninety days. This is just who you are now.', icon: '👑', group: 'streak', tier: 6 },

  // --- Steps ---------------------------------------------------------------
  { key: 'steps_10k_day', title: '10,000 Steps', description: 'Ten thousand steps in a single day.', icon: '🚶', group: 'steps', tier: 1 },
  { key: 'steps_50k', title: '50,000 Steps', description: 'Fifty thousand steps logged.', icon: '👟', group: 'steps', tier: 2 },
  { key: 'steps_100k', title: '100,000 Steps', description: 'Six figures on foot.', icon: '🥾', group: 'steps', tier: 3 },
  { key: 'steps_500k', title: '500,000 Steps', description: 'Half a million. That is a long way.', icon: '🗺️', group: 'steps', tier: 4 },
  { key: 'steps_1m', title: '1 Million Steps', description: 'A million steps. Genuinely remarkable.', icon: '🌍', group: 'steps', tier: 5 },

  // --- Weight & goal -------------------------------------------------------
  { key: 'first_kg', title: 'First 1 kg', description: 'The first one proves it works.', icon: '⚖️', group: 'body', tier: 1 },
  { key: 'three_kg', title: '3 kg Progress', description: 'Three kilograms in the right direction.', icon: '📐', group: 'body', tier: 2 },
  { key: 'five_kg', title: '5 kg Progress', description: 'Five kilograms of real change.', icon: '🎯', group: 'body', tier: 3 },
  { key: 'ten_kg', title: '10 kg Progress', description: 'Ten kilograms. People will have noticed.', icon: '🏔️', group: 'body', tier: 4 },
  { key: 'goal_reached', title: 'Goal Reached', description: 'You said you would, and you did.', icon: '🏁', group: 'body', tier: 5 },

  // --- Nutrition -----------------------------------------------------------
  { key: 'nutrition_7', title: '7 Days Logged', description: 'A week of knowing what you ate.', icon: '🍎', group: 'nutrition', tier: 1 },
  { key: 'nutrition_14', title: '14 Days Logged', description: 'Two weeks of paying attention.', icon: '🥗', group: 'nutrition', tier: 2 },
  { key: 'nutrition_30', title: '30 Days Logged', description: 'A month logged. That takes patience.', icon: '📗', group: 'nutrition', tier: 3 },

  // --- Consistency ---------------------------------------------------------
  { key: 'consistency_7', title: '7 Day Consistency', description: 'Seven active days recorded.', icon: '📅', group: 'consistency', tier: 1 },
  { key: 'consistency_30', title: '30 Day Consistency', description: 'Steady for a whole month.', icon: '📈', group: 'consistency', tier: 2 },
  { key: 'consistency_60', title: '60 Day Consistency', description: 'Sixty active days. Quietly impressive.', icon: '🧭', group: 'consistency', tier: 3 },

  // --- Special -------------------------------------------------------------
  { key: 'first_weigh_in', title: 'First Weekly Weigh-in', description: 'Your progress story has a beginning.', icon: '📌', group: 'special', tier: 1 },
  { key: 'first_update', title: 'First Group Update', description: 'You told the others. That is the whole point.', icon: '📣', group: 'special', tier: 2 },
  { key: 'first_pr', title: 'First Personal Best', description: 'Your best session yet.', icon: '💥', group: 'special', tier: 3 },
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
