import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { StickerBubble } from './StickerBubble'
import { STICKERS, STICKER_GROUPS } from '@/data/stickers'
import { gifService, type Gif } from '@/services/gifService'
import styles from './StickerPicker.module.css'

type Tab = 'stickers' | 'gifs'

/**
 * Stickers and GIFs, in one picker.
 *
 * The stickers are the app's own and they work: each is a key in
 * `data/stickers.ts`, drawn from that table, stored as the key and nothing
 * else — no image files, no network, no bytes in the database.
 *
 * The GIF tab is built and honest. There is no provider configured, so it says
 * so instead of showing a grid of nothing or quietly pretending stickers are
 * GIFs. Everything else about the tab — the search box, the grid, the loading
 * and empty states — is already here, so connecting a real provider is
 * `configureGifProvider(...)` at start-up and no change to this file.
 */
export function StickerPicker({
  onSticker,
  onGif,
  onClose,
}: {
  onSticker: (stickerId: string) => void
  /** Nothing calls this today; it is the shape the provider will feed. */
  onGif?: (gif: Gif) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('stickers')
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState<Gif[] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (tab !== 'gifs' || !gifService.available) return
    const controller = new AbortController()
    setLoading(true)
    gifService
      .search(query, controller.signal)
      .then((rows) => setGifs(rows ?? []))
      .catch(() => setGifs([]))
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [tab, query])

  const needle = query.trim().toLowerCase()
  const matching = needle
    ? STICKERS.filter(
        (sticker) =>
          sticker.label.toLowerCase().includes(needle) ||
          sticker.word.toLowerCase().includes(needle),
      )
    : null

  return (
    <Sheet open onClose={onClose} title="Stickers & GIFs">
      <div className={styles.tabs} role="tablist" aria-label="Sticker or GIF">
        {(['stickers', 'gifs'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            className={[styles.tab, tab === value ? styles.tabOn : ''].filter(Boolean).join(' ')}
            onClick={() => setTab(value)}
          >
            {value === 'stickers' ? 'Stickers' : 'GIFs'}
          </button>
        ))}
      </div>

      <div className={styles.search}>
        <Search size={16} strokeWidth={2.2} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          value={query}
          placeholder={tab === 'stickers' ? 'Search stickers' : 'Search GIFs'}
          aria-label={tab === 'stickers' ? 'Search stickers' : 'Search GIFs'}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {tab === 'stickers' ? (
        matching ? (
          matching.length === 0 ? (
            <p className={styles.note}>Nothing matches “{query.trim()}”.</p>
          ) : (
            <Grid stickers={matching} onSticker={onSticker} />
          )
        ) : (
          STICKER_GROUPS.map((group) => {
            const inGroup = STICKERS.filter((sticker) => sticker.group === group.key)
            if (inGroup.length === 0) return null
            return (
              <section key={group.key} className={styles.group}>
                <p className="eyebrow">{group.label}</p>
                <Grid stickers={inGroup} onSticker={onSticker} />
              </section>
            )
          })
        )
      ) : !gifService.available ? (
        /*
          Said plainly rather than dressed up. A GIF search reaches a third
          party from a private group's chat, which is a decision for whoever
          runs this app — not something to switch on quietly so a tab looks
          full.
        */
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No GIF service is connected.</p>
          <p className={styles.emptyBody}>
            GIFs come from an outside provider, and this app has not been given one. The picker is
            ready for it — until then, the stickers above are made here and work offline.
          </p>
        </div>
      ) : loading ? (
        <p className={styles.note}>Searching…</p>
      ) : gifs && gifs.length > 0 ? (
        <ul className={styles.gifGrid}>
          {gifs.map((gif) => (
            <li key={gif.id}>
              <button className={styles.gif} onClick={() => onGif?.(gif)}>
                <img src={gif.previewUrl} alt={gif.description} loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.note}>Nothing came back for that.</p>
      )}
    </Sheet>
  )
}

function Grid({
  stickers,
  onSticker,
}: {
  stickers: typeof STICKERS
  onSticker: (stickerId: string) => void
}) {
  return (
    <ul className={styles.grid}>
      {stickers.map((sticker) => (
        <li key={sticker.key}>
          <button
            className={styles.pick}
            onClick={() => onSticker(sticker.key)}
            aria-label={`Send the ${sticker.label} sticker`}
          >
            <StickerBubble stickerId={sticker.key} size="sm" />
          </button>
        </li>
      ))}
    </ul>
  )
}
