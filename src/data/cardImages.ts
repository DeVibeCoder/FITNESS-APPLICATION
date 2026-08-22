/**
 * Photography for the cards that carry a section.
 *
 * Presentation only. Nothing here is stored, cached by us, uploaded, or
 * written to IndexedDB or localStorage — these are `src` attributes on an
 * `<img>` and nothing else. No record in this app has ever held an image and
 * none does now.
 *
 * Every URL below was taken from an Unsplash search page and then verified to
 * return `200 image/jpeg` before being written down. None was recalled from
 * memory or assembled by hand: a plausible-looking Unsplash ID that does not
 * exist is a broken card, and the whole point of a photograph is that it is
 * there. If one of these ever rots, the card falls back to its gradient — see
 * `CardPhoto`, which hides itself on error rather than showing a torn image.
 *
 * One image per subject, and the same image in light and dark. A card whose
 * photograph changes with the theme reads as a rendering fault.
 *
 * These are remote URLs, which is a deliberate trade for a prototype: the rest
 * of the app works offline and these will simply not appear when it is. That
 * is why every card underneath still has a complete visual treatment of its
 * own, and why nothing structural depends on an image arriving.
 */

export interface CardImage {
  /** Unsplash photo id. The CDN path, not a page slug. */
  id: string
  /** What is actually in the frame. Used to reason about crops, not rendered. */
  subject: string
  /**
   * Where the interesting part sits, as an `object-position`. Wide cards crop
   * hard on a phone, and a barbell centred in the source can end up as a wall.
   */
  position?: string
}

const UNSPLASH = 'https://images.unsplash.com/'

/**
 * The subjects, one per card that earns a photograph.
 *
 * Deliberately a short list. Steps, calories and water get a small tile;
 * workouts, the weigh-in and awards get a shallow band. Nothing here is a
 * full-bleed hero, because a feed of photo banners is a mood board rather than
 * a tracker — the numbers are the content.
 */
export const CARD_IMAGES = {
  /** Workout → weights and a gym floor. */
  workout: {
    id: 'photo-1620188467120-5042ed1eb5da',
    subject: 'A gym with a barbell and weight plates',
    position: '50% 60%',
  },
  /** Steps → someone actually covering ground. */
  steps: {
    id: 'photo-1486218119243-13883505764c',
    subject: 'Man running on a road beside a grass field',
    position: '50% 45%',
  },
  /** Calories → what the number is made of. */
  calories: {
    id: 'photo-1546069901-ba9599a7e63c',
    subject: 'Vegetables and meat in a bowl',
    position: '50% 50%',
  },
  /** Water → hydration, in a training context rather than a still life. */
  water: {
    id: 'photo-1600679472233-eabc13b79f07',
    subject: 'Man drinking from a black sports bottle',
    position: '50% 40%',
  },
  /** Weigh-in → the object itself. */
  weighIn: {
    id: 'photo-1522844990619-4951c40f7eda',
    subject: 'Person standing on a white digital bathroom scale',
    position: '50% 55%',
  },
  /** Motivation → the athletic lifestyle, not a slogan. */
  motivation: {
    id: 'photo-1605296867724-fa87a8ef53fd',
    subject: 'A man standing by a barbell in a dark gym',
    position: '50% 45%',
  },
  /** Achievements → strength, at the moment of effort. */
  achievements: {
    id: 'photo-1549060279-7e168fcee0c2',
    subject: 'Person about to lift a barbell',
    position: '50% 50%',
  },
} satisfies Record<string, CardImage>

export type CardImageKey = keyof typeof CARD_IMAGES

/**
 * The two shapes a card photograph is ever drawn at, as pixels the CDN should
 * crop to.
 *
 * Both are given a height, which matters more than it looks: with a width
 * alone the CDN returns the whole frame at that width and the browser throws
 * most of it away, so a 104px tile arrives as a 480px-tall photograph. Asking
 * for the crop moves that work to the CDN and cuts the bytes by an order of
 * magnitude.
 *
 * The band's 5:1 is a compromise. The real box is about 4:1 on a phone and
 * nearer 7:1 on a wide desktop card, and one crop cannot be both — `object-fit:
 * cover` absorbs the difference either way, so this is chosen to lose the
 * least from the middle of the range.
 */
const SHAPES = {
  band: { width: 560, height: 112 },
  tile: { width: 56, height: 56 },
} as const

export type CardPhotoShape = keyof typeof SHAPES

/**
 * A CDN URL for one shape at one pixel density.
 *
 * `auto=format` lets the CDN serve AVIF or WebP to browsers that take them,
 * `fit=crop` does the cropping server-side, and `q=70` is where these
 * particular photographs stop looking better and start only getting larger.
 */
export function cardImageUrl(key: CardImageKey, shape: CardPhotoShape, density = 1): string {
  const { width, height } = SHAPES[shape]
  return (
    `${UNSPLASH}${CARD_IMAGES[key].id}` +
    `?w=${width * density}&h=${height * density}&q=70&auto=format&fit=crop`
  )
}

/** 1x and 2x, so a retina screen is not served a blurred upscale. */
export function cardImageSrcSet(key: CardImageKey, shape: CardPhotoShape): string {
  return `${cardImageUrl(key, shape, 1)} 1x, ${cardImageUrl(key, shape, 2)} 2x`
}
