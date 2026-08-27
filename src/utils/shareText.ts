import { duration, litres, num, signed } from './format'

/**
 * The words a fitness record turns into when somebody shares it.
 *
 * Sharing starts at the record and ends at the composer, so this is where the
 * numbers become a sentence — one place, rather than a template inside every
 * card that has a Share button. The composer receives text and nothing else,
 * which is what keeps it a post composer rather than a record picker.
 *
 * These are opening lines, not final copy: the person editing them afterwards
 * is the point. So they state the fact and stop, without inventing a mood
 * nobody asked for.
 */

export function stepsShare(steps: number, goal: number): string {
  const hit = goal > 0 && steps >= goal
  return `${num(steps)} steps today${hit ? ' — goal hit 💪' : ''}`
}

export function workoutShare(name: string, durationSec: number, kcal: number): string {
  const parts = [durationSec > 0 ? duration(durationSec) : '', kcal > 0 ? `${num(kcal, 0)} kcal` : '']
    .filter(Boolean)
    .join(' · ')
  return `Finished ${name} today.${parts ? `\n${parts}` : ''}`
}

/**
 * The weigh-in reads over two lines because it is two facts: where you are,
 * and which way the week went. Squeezing them onto one line makes the number
 * that matters compete with the number that explains it.
 */
export function weighInShare(weightKg: number, changeKg?: number): string {
  const headline = `Weekly weigh-in: ${num(weightKg, 1)} kg`
  if (changeKg === undefined) return headline
  return `${headline}\n${signed(changeKg)} kg this week.`
}

export function caloriesShare(kcal: number, targetKcal: number): string {
  if (targetKcal <= 0) return `${num(kcal, 0)} kcal today.`
  return `${num(kcal, 0)} of ${num(targetKcal, 0)} kcal today.`
}

export function waterShare(ml: number, goalMl: number): string {
  const hit = goalMl > 0 && ml >= goalMl
  return `${litres(ml)} L of water today${hit ? ' — goal hit 💧' : ''}`
}
