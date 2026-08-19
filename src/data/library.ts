import type { Exercise } from '@/models'

/**
 * Exercise catalogue. Bodyweight-only for now — the group trains at home.
 * `met` drives the calorie estimate; `cue` is the one thing worth remembering.
 */
export const EXERCISES: Exercise[] = [
  { id: 'ex_jumping_jacks', name: 'Jumping Jacks', muscleGroups: ['full body'], equipment: 'bodyweight', met: 8, cue: 'Land soft, stay light on your feet.' },
  { id: 'ex_high_knees', name: 'High Knees', muscleGroups: ['legs', 'core'], equipment: 'bodyweight', met: 8, cue: 'Drive the knee to hip height.' },
  { id: 'ex_butt_kicks', name: 'Butt Kicks', muscleGroups: ['legs'], equipment: 'bodyweight', met: 7, cue: 'Quick feet, tall chest.' },
  { id: 'ex_skater_hops', name: 'Skater Hops', muscleGroups: ['legs', 'glutes'], equipment: 'bodyweight', met: 7, cue: 'Push out sideways, land balanced.' },
  { id: 'ex_burpee', name: 'Burpees', muscleGroups: ['full body'], equipment: 'bodyweight', met: 10, cue: 'Pace yourself — smooth beats fast.' },
  { id: 'ex_mountain_climbers', name: 'Mountain Climbers', muscleGroups: ['core', 'shoulders'], equipment: 'bodyweight', met: 8, cue: 'Hips stay level, no bouncing.' },
  { id: 'ex_squat', name: 'Bodyweight Squats', muscleGroups: ['quads', 'glutes'], equipment: 'bodyweight', met: 5.5, cue: 'Sit back, knees track over toes.' },
  { id: 'ex_sumo_squat', name: 'Sumo Squats', muscleGroups: ['glutes', 'inner thigh'], equipment: 'bodyweight', met: 5.5, cue: 'Wide stance, toes turned out.' },
  { id: 'ex_reverse_lunge', name: 'Reverse Lunges', muscleGroups: ['quads', 'glutes'], equipment: 'bodyweight', met: 6, cue: 'Step back, drop straight down.' },
  { id: 'ex_step_up', name: 'Step-ups', muscleGroups: ['quads', 'glutes'], equipment: 'bodyweight', met: 6, cue: 'Drive through the front heel.' },
  { id: 'ex_wall_sit', name: 'Wall Sit', muscleGroups: ['quads'], equipment: 'bodyweight', met: 4.5, cue: 'Thighs parallel, breathe through it.' },
  { id: 'ex_calf_raise', name: 'Calf Raises', muscleGroups: ['calves'], equipment: 'bodyweight', met: 3.5, cue: 'Full range, pause at the top.' },
  { id: 'ex_glute_bridge', name: 'Glute Bridge', muscleGroups: ['glutes', 'hamstrings'], equipment: 'bodyweight', met: 4, cue: 'Squeeze at the top, ribs down.' },
  { id: 'ex_donkey_kick', name: 'Donkey Kicks', muscleGroups: ['glutes'], equipment: 'bodyweight', met: 3.5, cue: 'Move from the hip, not the back.' },
  { id: 'ex_push_up', name: 'Push-ups', muscleGroups: ['chest', 'triceps'], equipment: 'bodyweight', met: 8, cue: 'Knees down is a real push-up too.' },
  { id: 'ex_superman', name: 'Superman Hold', muscleGroups: ['lower back'], equipment: 'bodyweight', met: 3.5, cue: 'Lift long, not high.' },
  { id: 'ex_plank', name: 'Plank', muscleGroups: ['core'], equipment: 'bodyweight', met: 3.8, cue: 'Straight line from head to heels.' },
  { id: 'ex_side_plank', name: 'Side Plank', muscleGroups: ['obliques'], equipment: 'bodyweight', met: 3.8, cue: 'Stack the shoulders, lift the hips.' },
  { id: 'ex_crunch', name: 'Crunches', muscleGroups: ['abs'], equipment: 'bodyweight', met: 3.8, cue: 'Chin off the chest, curl the ribs.' },
  { id: 'ex_bicycle_crunch', name: 'Bicycle Crunches', muscleGroups: ['abs', 'obliques'], equipment: 'bodyweight', met: 6, cue: 'Slow and controlled beats fast.' },
  { id: 'ex_leg_raise', name: 'Leg Raises', muscleGroups: ['lower abs'], equipment: 'bodyweight', met: 4, cue: 'Press the lower back into the floor.' },
  { id: 'ex_russian_twist', name: 'Russian Twists', muscleGroups: ['obliques'], equipment: 'bodyweight', met: 4.5, cue: 'Rotate through the ribs.' },
  { id: 'ex_flutter_kick', name: 'Flutter Kicks', muscleGroups: ['lower abs'], equipment: 'bodyweight', met: 4.5, cue: 'Small kicks, steady breathing.' },
  { id: 'ex_dead_bug', name: 'Dead Bug', muscleGroups: ['core'], equipment: 'bodyweight', met: 3.5, cue: 'Ribs down the whole time.' },
]

export const EXERCISE_BY_ID = new Map(EXERCISES.map((e) => [e.id, e]))

export interface TemplateExercise {
  exerciseId: string
  sets: number
  reps?: number
  durationSec?: number
  restSec: number
}

export interface WorkoutTemplate {
  key: string
  name: string
  estimatedMinutes: number
  exercises: TemplateExercise[]
}

/** Every session in the group's plans is one of these, or a rest day. */
export const TEMPLATES: Record<string, WorkoutTemplate> = {
  full_body: {
    key: 'full_body',
    name: 'Full Body Beginner',
    estimatedMinutes: 12,
    exercises: [
      { exerciseId: 'ex_jumping_jacks', sets: 3, durationSec: 40, restSec: 20 },
      { exerciseId: 'ex_squat', sets: 3, reps: 15, restSec: 30 },
      { exerciseId: 'ex_push_up', sets: 3, reps: 10, restSec: 30 },
      { exerciseId: 'ex_reverse_lunge', sets: 3, reps: 12, restSec: 30 },
      { exerciseId: 'ex_glute_bridge', sets: 3, reps: 15, restSec: 25 },
      { exerciseId: 'ex_plank', sets: 3, durationSec: 30, restSec: 25 },
      { exerciseId: 'ex_mountain_climbers', sets: 3, durationSec: 30, restSec: 25 },
      { exerciseId: 'ex_superman', sets: 3, durationSec: 20, restSec: 20 },
    ],
  },
  core: {
    key: 'core',
    name: 'Core Burner',
    estimatedMinutes: 10,
    exercises: [
      { exerciseId: 'ex_crunch', sets: 3, reps: 20, restSec: 20 },
      { exerciseId: 'ex_bicycle_crunch', sets: 3, durationSec: 30, restSec: 20 },
      { exerciseId: 'ex_leg_raise', sets: 3, reps: 12, restSec: 25 },
      { exerciseId: 'ex_russian_twist', sets: 3, durationSec: 30, restSec: 20 },
      { exerciseId: 'ex_plank', sets: 3, durationSec: 40, restSec: 25 },
      { exerciseId: 'ex_side_plank', sets: 3, durationSec: 25, restSec: 20 },
      { exerciseId: 'ex_flutter_kick', sets: 3, durationSec: 30, restSec: 20 },
      { exerciseId: 'ex_dead_bug', sets: 3, reps: 12, restSec: 20 },
    ],
  },
  lower: {
    key: 'lower',
    name: 'Lower Body Focus',
    estimatedMinutes: 14,
    exercises: [
      { exerciseId: 'ex_squat', sets: 4, reps: 15, restSec: 30 },
      { exerciseId: 'ex_reverse_lunge', sets: 3, reps: 12, restSec: 30 },
      { exerciseId: 'ex_glute_bridge', sets: 4, reps: 15, restSec: 25 },
      { exerciseId: 'ex_wall_sit', sets: 3, durationSec: 40, restSec: 30 },
      { exerciseId: 'ex_step_up', sets: 3, reps: 12, restSec: 30 },
      { exerciseId: 'ex_sumo_squat', sets: 3, reps: 15, restSec: 30 },
      { exerciseId: 'ex_calf_raise', sets: 3, reps: 20, restSec: 20 },
      { exerciseId: 'ex_donkey_kick', sets: 3, reps: 15, restSec: 20 },
    ],
  },
  cardio: {
    key: 'cardio',
    name: 'Cardio & Core',
    estimatedMinutes: 13,
    exercises: [
      { exerciseId: 'ex_high_knees', sets: 4, durationSec: 30, restSec: 20 },
      { exerciseId: 'ex_jumping_jacks', sets: 4, durationSec: 40, restSec: 20 },
      { exerciseId: 'ex_burpee', sets: 3, reps: 8, restSec: 35 },
      { exerciseId: 'ex_mountain_climbers', sets: 4, durationSec: 30, restSec: 25 },
      { exerciseId: 'ex_skater_hops', sets: 3, durationSec: 30, restSec: 25 },
      { exerciseId: 'ex_plank', sets: 3, durationSec: 40, restSec: 25 },
      { exerciseId: 'ex_bicycle_crunch', sets: 3, durationSec: 30, restSec: 20 },
      { exerciseId: 'ex_butt_kicks', sets: 3, durationSec: 30, restSec: 20 },
    ],
  },
}

/** 'rest' marks a scheduled rest day — a first-class part of the plan. */
export type CycleSlot = keyof typeof TEMPLATES | 'rest'

export interface PlanTemplate {
  id: string
  name: string
  description: string
  level: 'beginner' | 'intermediate' | 'advanced'
  totalDays: number
  focus: string[]
  /** Repeats for the length of the plan. */
  cycle: CycleSlot[]
}

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    id: 'plan_lose_weight_30',
    name: 'Lose Weight 30 Days Plan',
    description:
      'Short, repeatable sessions six days out of seven. Built to be done in a living room before work.',
    level: 'beginner',
    totalDays: 30,
    focus: ['Fat loss', 'Full body', 'No equipment'],
    cycle: ['full_body', 'core', 'lower', 'full_body', 'cardio', 'rest'],
  },
  {
    id: 'plan_full_body_beginner',
    name: 'Full Body Beginner',
    description:
      'Four sessions a week with real rest between them. The one to pick if you are starting from zero.',
    level: 'beginner',
    totalDays: 28,
    focus: ['Getting started', 'Full body', 'Gentle'],
    cycle: ['full_body', 'rest', 'core', 'rest', 'lower', 'rest', 'cardio'],
  },
]

export function slotForDay(plan: PlanTemplate, dayNumber: number): CycleSlot {
  return plan.cycle[(dayNumber - 1) % plan.cycle.length]
}
