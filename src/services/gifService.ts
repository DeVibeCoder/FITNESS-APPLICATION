/**
 * The seam a GIF provider will plug into.
 *
 * There is no provider configured, and this file deliberately does not invent
 * one: reaching a third-party GIF API means an outbound request from a private
 * group's chat, a key on a server, and terms about what may be logged — none
 * of which belongs in a frontend-only phase. So the picker is built, it asks
 * this module, and this module answers honestly that nothing is connected.
 *
 * What that buys is a real answer to "how would we add GIFs": implement
 * `GifProvider`, hand it to `configureGifProvider` at start-up, and the picker
 * starts working with no change to any component. Nothing above this line has
 * to know which service it turned out to be.
 */

export interface Gif {
  id: string
  /** The still or looping asset to draw. Always a remote URL. */
  url: string
  previewUrl: string
  width: number
  height: number
  /** For the alt text. Providers supply this; it is not optional here. */
  description: string
}

export interface GifProvider {
  name: string
  search(query: string, signal?: AbortSignal): Promise<Gif[]>
  trending(signal?: AbortSignal): Promise<Gif[]>
}

let provider: GifProvider | null = null

/** Called once at start-up when a provider exists. Nothing calls it today. */
export function configureGifProvider(next: GifProvider | null): void {
  provider = next
}

export const gifService = {
  /** Whether the picker has anything to ask. */
  get available(): boolean {
    return provider !== null
  },

  get providerName(): string | null {
    return provider?.name ?? null
  },

  /**
   * An empty result and a configured provider are different situations, and
   * the picker says different things about them — so this returns null rather
   * than an empty array when there is nothing to ask.
   */
  async search(query: string, signal?: AbortSignal): Promise<Gif[] | null> {
    if (!provider) return null
    const trimmed = query.trim()
    return trimmed ? provider.search(trimmed, signal) : provider.trending(signal)
  },
}
