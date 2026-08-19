export type BmiCategory = 'underweight' | 'healthy' | 'overweight' | 'obese'

export interface BmiResult {
  value: number
  category: BmiCategory
  label: string
  /** Weight range (kg) that would put this height in the healthy band. */
  healthyRangeKg: [number, number]
}

const LABELS: Record<BmiCategory, string> = {
  underweight: 'Underweight',
  healthy: 'Healthy range',
  overweight: 'Overweight',
  obese: 'Obese',
}

export function bmiCategory(value: number): BmiCategory {
  if (value < 18.5) return 'underweight'
  if (value < 25) return 'healthy'
  if (value < 30) return 'overweight'
  return 'obese'
}

export function calcBmi(weightKg: number, heightCm: number): BmiResult {
  const m = heightCm / 100
  const value = m > 0 ? weightKg / (m * m) : 0
  const category = bmiCategory(value)
  return {
    value: Math.round(value * 10) / 10,
    category,
    label: LABELS[category],
    healthyRangeKg: [
      Math.round(18.5 * m * m * 10) / 10,
      Math.round(24.9 * m * m * 10) / 10,
    ],
  }
}

/** Position 0–1 along a 15–40 BMI scale, for drawing the indicator. */
export function bmiScalePosition(value: number): number {
  return Math.min(1, Math.max(0, (value - 15) / 25))
}

export const BMI_BANDS: { category: BmiCategory; from: number; to: number; label: string }[] = [
  { category: 'underweight', from: 15, to: 18.5, label: 'Under' },
  { category: 'healthy', from: 18.5, to: 25, label: 'Healthy' },
  { category: 'overweight', from: 25, to: 30, label: 'Over' },
  { category: 'obese', from: 30, to: 40, label: 'Obese' },
]
