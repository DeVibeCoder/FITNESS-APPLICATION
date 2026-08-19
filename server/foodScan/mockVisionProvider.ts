import type { FoodVisionProvider, VisionResult } from './types.ts'

/**
 * Development-only stand-in for the vision provider.
 *
 * This exists so the review-and-edit UI can be worked on without burning API
 * calls. It is reachable ONLY by setting FOOD_SCAN_MOCK=1 outside production,
 * and every response it produces is tagged `source: 'mock'` so the interface can
 * shout about it.
 *
 * It is never used as a fallback when the real provider fails. That behaviour —
 * showing a plausible meal that has nothing to do with the photograph — is the
 * bug this whole endpoint was written to remove.
 */
export class DevMockVisionProvider implements FoodVisionProvider {
  readonly name = 'dev-mock'

  async identify(): Promise<VisionResult> {
    return {
      items: [
        {
          name: 'DEV MOCK — not your photo',
          foodType: 'placeholder',
          quantity: 100,
          unit: 'g',
          confidence: 0.1,
          alternatives: [],
        },
      ],
      mealDescription: 'Development mock. No image was analysed.',
      overallConfidence: 0.1,
      needsUserConfirmation: true,
    }
  }
}
