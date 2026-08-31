/**
 * Human copy. Short, said out loud without cringing, and never coach-speak.
 * Picked by date so a line stays put for a whole day instead of flickering.
 */

export const DAILY_LINES = [
  'Consistency beats perfection.',
  'One workout at a time.',
  'You showed up. That is what matters.',
  "You're closer than you were yesterday.",
  "Don't break the chain.",
  'Small progress is still progress.',
  'The hard part is starting. You already know that.',
  'Twelve honest minutes beat an hour you never do.',
  'Nobody regrets the workout they finished.',
  'Rest is part of the plan, not a break from it.',
]

const DONE_LINES = [
  'That is today handled.',
  'Logged. Nice work.',
  'Chain intact.',
  'Good session.',
]

export function lineOfTheDay(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return DAILY_LINES[hash % DAILY_LINES.length]
}

export function doneLine(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 17 + seed.charCodeAt(i)) >>> 0
  return DONE_LINES[hash % DONE_LINES.length]
}

/** Empty-state copy, kept in one place so the tone stays consistent. */
export const EMPTY = {
  restDay: {
    title: 'Rest day',
    body: 'That is part of the plan. Your next session is waiting tomorrow.',
  },
  noWeights: {
    title: 'No weigh-ins yet',
    body: 'Your first weigh-in starts your progress story.',
  },
  noMeals: { title: 'Nothing logged yet today', body: 'Add your first meal whenever you eat it.' },
  noUpdates: { title: 'Quiet in here', body: 'Your group has not posted today. Be the first to check in.' },
  noSessions: { title: 'No workouts yet', body: 'Finish one session and it shows up here.' },
  noMeasurements: {
    title: 'No measurements yet',
    body: 'The scale misses a lot. A tape measure fills in the rest.',
  },
  noSteps: { title: 'No steps logged', body: 'Add today’s count and the week fills in.' },
} as const

/**
 * A warm line under the greeting.
 *
 * Never about falling behind. The app is an accountability group between
 * friends, and nothing here should make someone feel worse for missing a day —
 * "keep going" beats "you missed one" every time.
 */
const ENCOURAGEMENT = [
  "let's keep the chain going",
  'one day at a time',
  'good to have you back',
  'small steps still count',
  "you're doing the work",
  'showing up is the hard part',
]

export function encouragementLine(userId: string, seed: string): string {
  const key = `${userId}:${seed}`
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 23 + key.charCodeAt(i)) >>> 0
  return ENCOURAGEMENT[hash % ENCOURAGEMENT.length]
}
