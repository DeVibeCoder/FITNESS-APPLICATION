/**
 * Choosing which database row actually describes the food in the photo.
 *
 * Plain term overlap is not enough. Searching "beef steak" returns
 * "Beef, sandwich steak" first, which contains both words, scores perfectly and
 * is processed sandwich meat at 326 kcal — not the steak on the plate. The
 * scoring below exists to reject that class of near-miss.
 */

/** Cooking methods are matched as a bonus, not as required terms. */
export const COOKING_METHODS = [
  'grilled', 'fried', 'boiled', 'baked', 'roasted', 'steamed',
  'poached', 'raw', 'cooked', 'smoked', 'braised', 'broiled', 'seared',
]

/**
 * Words that turn an ingredient into a different, usually composite dish. If
 * the user's food does not mention one and the database row does, it is the
 * wrong row — a steak sandwich is not a steak.
 */
const COMPOSITE_MARKERS = [
  // Other dishes that merely contain the food.
  'sandwich', 'burger', 'soup', 'stew', 'casserole', 'pizza', 'pie',
  'wrap', 'taco', 'burrito', 'roll', 'sub', 'melt', 'curry', 'lasagna',
  'nugget', 'patty', 'breaded', 'battered', 'country fried', 'salad',
  'dinner', 'entree', 'baby food', 'infant', 'formula',
  // Ingredient and commercial forms rather than the food on a plate. Rice
  // flour is 359 kcal per 100g against about 130 for cooked rice, so matching
  // one for the other is not a rounding error.
  'flour', 'powder', 'dehydrated', 'uncooked', 'frozen', 'mixture',
  'concentrate', 'canned', 'dry mix', 'instant',
]

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((token) => token.length > 2)
}

/**
 * A brand row shouts: "CRACKER BARREL, grilled sirloin steak".
 *
 * USDA's own abbreviations are also upper case — NFS is "not further
 * specified", the generic entry we actively want — so they are excluded before
 * looking for a shouting brand name.
 */
function looksBranded(description: string): boolean {
  const withoutAbbreviations = description.replace(/\b(NFS|NS|USDA|SR)\b/g, '')
  return (
    /\b[A-Z]{4,}\b/.test(withoutAbbreviations) ||
    /\b[A-Z]{2,}\s+[A-Z]{2,}\b/.test(withoutAbbreviations)
  )
}

export interface MatchInput {
  description: string
  dataType?: string
  per100: { kcal: number; proteinG: number; carbsG: number; fatG: number }
}

/**
 * Nutrition that could not belong to a real whole food. Catches a mis-parsed
 * row before its numbers reach someone's diary.
 */
export function isPlausible(per100: MatchInput['per100']): boolean {
  const { kcal, proteinG, carbsG, fatG } = per100
  if (kcal < 15 || kcal > 900) return false
  if (proteinG < 0 || carbsG < 0 || fatG < 0) return false
  if (proteinG > 100 || carbsG > 100 || fatG > 100) return false

  // Energy should roughly equal what the macros carry. Fibre, alcohol and
  // rounding make this inexact, so the tolerance is generous — this is only
  // here to catch rows that are plainly inconsistent.
  const fromMacros = proteinG * 4 + carbsG * 4 + fatG * 9
  if (fromMacros === 0) return false
  const drift = Math.abs(fromMacros - kcal) / kcal
  return drift <= 0.5
}

/**
 * 0 means "do not use this row". Anything at or above `MIN_SCORE` is usable.
 *
 * The score is deliberately left unclamped at the top: two good rows can both
 * exceed 1, and clamping before comparison would flatten them into a tie that
 * insertion order decides. The caller clamps only when reporting confidence.
 */
export const MIN_SCORE = 0.45

export function scoreMatch(candidate: MatchInput, query: string): number {
  const description = candidate.description?.trim()
  if (!description) return 0

  const lower = description.toLowerCase()
  const queryTokens = tokenize(query)
  const coreTerms = queryTokens.filter((token) => !COOKING_METHODS.includes(token))
  if (coreTerms.length === 0) return 0

  // Every meaningful word of the food must appear. "beef steak" may not match a
  // row about chicken, however well the rest lines up.
  if (!coreTerms.every((term) => lower.includes(term))) return 0

  const lowerQuery = query.toLowerCase()

  // A composite dish the user did not describe is the wrong food entirely.
  for (const marker of COMPOSITE_MARKERS) {
    if (lower.includes(marker) && !lowerQuery.includes(marker)) return 0
  }

  // "Beans and white rice" is two foods; "grilled with sauce" adds one the
  // photograph may not contain. Either way the row describes more than was
  // asked for, and its numbers would be someone else's dinner.
  for (const joiner of [' and ', ' with ', ' plus ', ' in ']) {
    if (lower.includes(joiner) && !lowerQuery.includes(joiner)) return 0
  }

  if (!isPlausible(candidate.per100)) return 0

  let score = 1

  // Preparation changes the numbers, so a method nobody asked for is a worse
  // fit. "raw" is exempt — it is the ordinary state of a food, not a treatment.
  const rowMethods = COOKING_METHODS.filter((method) => lower.includes(method))
  const askedMethod = queryTokens.find((token) => COOKING_METHODS.includes(token))
  if (!askedMethod && rowMethods.some((method) => method !== 'raw')) {
    score -= 0.2
  } else if (askedMethod && rowMethods.length > 0 && !rowMethods.includes(askedMethod)) {
    score -= 0.25
  }

  // Each additional descriptive word is another way this row could be a
  // different cut, brand or preparation than what was photographed.
  const extra = tokenize(lower).filter((token) => !queryTokens.includes(token))
  score -= Math.min(0.45, extra.length * 0.07)

  // "NFS" is USDA's generic, unspecified entry — usually the right answer when
  // someone photographs an ordinary plate of something.
  if (/\bnfs\b/i.test(lower)) score += 0.12

  if (looksBranded(description)) score -= 0.25

  const method = queryTokens.find((token) => COOKING_METHODS.includes(token))
  if (method && lower.includes(method)) score += 0.08

  // Curated datasets describe generic foods; branded rows are one
  // manufacturer's product and rarely what someone cooked at home.
  if (candidate.dataType === 'Foundation' || candidate.dataType === 'SR Legacy') score += 0.1
  else if (candidate.dataType === 'Survey (FNDDS)') score += 0.12

  return Math.max(0, score)
}

/** Highest scoring row, or null when nothing clears the bar. */
export function pickBest<T extends MatchInput>(
  candidates: T[],
  query: string,
): { candidate: T; score: number } | null {
  let best: { candidate: T; score: number } | null = null
  for (const candidate of candidates) {
    const score = scoreMatch(candidate, query)
    if (score >= MIN_SCORE && (best === null || score > best.score)) {
      best = { candidate, score }
    }
  }
  return best
}
