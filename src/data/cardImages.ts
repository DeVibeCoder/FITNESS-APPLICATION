/**
 * Photography for the cards that carry a section.
 *
 * Presentation only. Nothing here is stored, cached by us, uploaded, or
 * written to IndexedDB or localStorage — these are `src` attributes on an
 * `<img>` and nothing else. No record in this app has ever held an image and
 * none does now.
 *
 * Every URL below was taken from an Unsplash search page and then verified to
 * return `200 image/*` before being written down. None was recalled from
 * memory or assembled by hand: a plausible-looking Unsplash id that does not
 * exist is a broken card, and the whole point of a photograph is that it is
 * there.
 *
 * One image per subject, and the same image in light and dark. A card whose
 * photograph changes with the theme reads as a rendering fault.
 *
 * These are remote URLs, which is a deliberate trade for a prototype: the rest
 * of the app works offline and these will not load when it is. That is why
 * `CardPhoto` keeps its dark ground when the image fails — the text over it
 * stays readable either way, which it would not if the photograph were the
 * only thing making the card dark.
 */

export interface CardImage {
  /** Unsplash photo id. The CDN path, not a page slug. */
  id: string
  /** What is actually in the frame. Used to reason about crops, not rendered. */
  subject: string
  /**
   * Where the interesting part sits, as an `object-position`. A card is much
   * wider than it is tall, so a full-bleed crop throws away most of the height
   * and this decides which part survives.
   */
  position?: string
}

const UNSPLASH = 'https://images.unsplash.com/'

/**
 * The subjects, one per card that carries a photograph.
 *
 * Deliberately a short list, and every one of them fills its card rather than
 * sitting in a strip across the top. A band showed a slice of a picture and
 * read as a cropped accident; a filled card reads as a card with a photograph
 * in it. The cards themselves stay short — see `CardPhoto`, which is
 * positioned rather than laid out and so adds no height at all.
 */
export const CARD_IMAGES = {
  /** Today's workout → weights and a gym floor. */
  workout: {
    id: 'photo-1620188467120-5042ed1eb5da',
    subject: 'A gym with a barbell and weight plates',
    position: '50% 55%',
  },
  /** Steps → feet actually covering ground, not a distant runner. */
  steps: {
    id: 'photo-1549992609-7a9043b5bf6b',
    subject: 'Close-up of a person walking on pavement',
    position: '50% 50%',
  },
  /** Calories → what the number is made of. */
  calories: {
    id: 'photo-1546069901-ba9599a7e63c',
    subject: 'Vegetables and meat in a bowl',
    position: '50% 50%',
  },
  /** Water → water itself, rather than a person holding some. */
  water: {
    id: 'photo-1553564552-02656d6a2390',
    subject: 'Water being poured into a drinking glass',
    position: '50% 45%',
  },
  /** Weigh-in → the object itself. */
  weighIn: {
    id: 'photo-1522844990619-4951c40f7eda',
    subject: 'Person standing on a white digital bathroom scale',
    position: '50% 50%',
  },
  /** Our fitness group → several people training together, not one athlete. */
  group: {
    id: 'photo-1554284126-aa88f22d8b74',
    subject: 'Three people lifting barbells together',
    position: '50% 45%',
  },
  /** My journey → distance covered, with an end of it in sight. */
  journey: {
    id: 'photo-1502224562085-639556652f33',
    subject: 'Silhouette of a person running on a road at golden hour',
    position: '50% 50%',
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
 * Two widths, and the browser picks.
 *
 * Width descriptors rather than 1x/2x, because the same card is 354px across
 * on a phone and up to 704px on a desktop — a density descriptor cannot know
 * that and would send a phone the desktop image. The larger of the two is
 * asked for at a lower quality on purpose: everything here sits under a heavy
 * scrim, where the difference between q70 and q55 is invisible and the
 * difference in bytes is not.
 */
const RENDITIONS = [
  { width: 720, height: 400, quality: 70 },
  { width: 1080, height: 600, quality: 55 },
] as const

/**
 * How wide the image will actually be drawn.
 *
 * The reading column is capped, so past the desktop breakpoint the card stops
 * growing and there is no point fetching anything bigger.
 */
export const CARD_IMAGE_SIZES = '(min-width: 64rem) 704px, 100vw'

/**
 * `auto=format` lets the CDN serve AVIF or WebP to browsers that take them,
 * and `fit=crop` with both a width and a height does the cropping server-side.
 * Asking for a width alone returns the whole frame at that width and leaves
 * the browser to throw most of it away — an order of magnitude more bytes for
 * the same pixels on screen.
 */
function renditionUrl(key: CardImageKey, index: number): string {
  const { width, height, quality } = RENDITIONS[index]
  return (
    `${UNSPLASH}${CARD_IMAGES[key].id}` +
    `?w=${width}&h=${height}&q=${quality}&auto=format&fit=crop`
  )
}

/** The default `src`, for browsers that ignore `srcset`. */
export function cardImageUrl(key: CardImageKey): string {
  return renditionUrl(key, 0)
}

export function cardImageSrcSet(key: CardImageKey): string {
  return RENDITIONS.map(
    (rendition, index) => `${renditionUrl(key, index)} ${rendition.width}w`,
  ).join(', ')
}
