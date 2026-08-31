/**
 * The app's own stickers.
 *
 * Drawn, not downloaded. Each one is a glyph and a word rendered from this
 * table, so the sticker set costs no network, no image files and no bytes in
 * the database — a sticker message stores the key and nothing else.
 *
 * They are deliberately about this group's subject rather than being a general
 * reaction pack: what gets said in a training thread is "go on", "that's a
 * PB", "rest day", not a cartoon cat. A general pack is what an external
 * provider is for, and there is not one configured.
 *
 * Keys are permanent. A stored message references one by key, so renaming a
 * key would blank a message somebody already sent. The glyphs are deliberately
 * drawn from the long-established emoji set: anything from the last couple of
 * Unicode releases lands as an empty box on a phone a year or two old, and a
 * sticker that renders as a rectangle is worse than one that does not exist.
 */
export interface Sticker {
  key: string
  glyph: string
  /** The word on the sticker. Kept short — it is set large. */
  word: string
  /** Read out in place of the picture. */
  label: string
  group: StickerGroup
  /** Which of the sticker grounds it is drawn on. */
  tone: 'ember' | 'lime' | 'ice' | 'ink'
}

export type StickerGroup = 'hype' | 'effort' | 'recovery'

export const STICKER_GROUPS: { key: StickerGroup; label: string }[] = [
  { key: 'hype', label: 'Hype' },
  { key: 'effort', label: 'Effort' },
  { key: 'recovery', label: 'Recovery' },
]

export const STICKERS: Sticker[] = [
  { key: 'lets_go', glyph: '🔥', word: "LET'S GO", label: "Let's go", group: 'hype', tone: 'ember' },
  { key: 'beast', glyph: '💪', word: 'BEAST', label: 'Beast mode', group: 'hype', tone: 'ember' },
  { key: 'pb', glyph: '🏆', word: 'NEW PB', label: 'New personal best', group: 'hype', tone: 'ember' },
  { key: 'respect', glyph: '🤝', word: 'RESPECT', label: 'Respect', group: 'hype', tone: 'ink' },
  { key: 'proud', glyph: '👏', word: 'PROUD', label: 'Proud of you', group: 'hype', tone: 'lime' },
  { key: 'showed_up', glyph: '✅', word: 'SHOWED UP', label: 'Showed up', group: 'effort', tone: 'lime' },
  { key: 'no_excuses', glyph: '🚫', word: 'NO EXCUSES', label: 'No excuses', group: 'effort', tone: 'ink' },
  { key: 'grind', glyph: '⚙️', word: 'GRIND', label: 'Grind', group: 'effort', tone: 'ink' },
  { key: 'one_more', glyph: '➕', word: 'ONE MORE', label: 'One more rep', group: 'effort', tone: 'ember' },
  { key: 'leg_day', glyph: '🦵', word: 'LEG DAY', label: 'Leg day', group: 'effort', tone: 'ember' },
  { key: 'rest_day', glyph: '😴', word: 'REST DAY', label: 'Rest day', group: 'recovery', tone: 'ice' },
  { key: 'hydrate', glyph: '💧', word: 'HYDRATE', label: 'Hydrate', group: 'recovery', tone: 'ice' },
  { key: 'sore', glyph: '😣', word: 'SO SORE', label: 'So sore', group: 'recovery', tone: 'ice' },
  { key: 'stretch', glyph: '🧘', word: 'STRETCH', label: 'Stretch it out', group: 'recovery', tone: 'lime' },
  { key: 'eat', glyph: '🍽️', word: 'REFUEL', label: 'Refuel', group: 'recovery', tone: 'lime' },
]

export const STICKER_BY_KEY = new Map(STICKERS.map((sticker) => [sticker.key, sticker]))
