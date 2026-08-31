import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { EMOJI_GROUPS, searchEmoji } from '@/data/emoji'
import styles from './EmojiPicker.module.css'

/**
 * Everything, not a shortlist.
 *
 * The row in the action menu is the five this group reaches for; this is the
 * rest — nine groups, browsable and searchable, in the order every keyboard
 * puts them. Nothing here limits what may be *stored*: a reaction is a string,
 * so any character a keyboard can produce is already a valid one. This is the
 * browse-and-search surface.
 *
 * It is a Sheet, like every other overlay in the app, so there is one modal
 * pattern rather than a bespoke one for emoji.
 */
export function EmojiPicker({
  onPick,
  onClose,
  selected,
}: {
  onPick: (emoji: string) => void
  onClose: () => void
  /** The reaction already on the message, so it reads as pressed. */
  selected?: string
}) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState(EMOJI_GROUPS[0].key)

  const results = useMemo(() => searchEmoji(query), [query])
  const searching = query.trim().length > 0
  const shown = searching
    ? results
    : (EMOJI_GROUPS.find((each) => each.key === group) ?? EMOJI_GROUPS[0]).emoji

  return (
    <Sheet open onClose={onClose} title="Pick an emoji">
      <div className={styles.search}>
        <Search size={16} strokeWidth={2.2} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          value={query}
          placeholder="Search"
          aria-label="Search emoji"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {/* The group strip is hidden while searching — it would be answering a
          question nobody is asking any more. */}
      {searching ? null : (
        <div className={styles.tabs} role="tablist" aria-label="Emoji groups">
          {EMOJI_GROUPS.map((each) => (
            <button
              key={each.key}
              role="tab"
              aria-selected={group === each.key}
              aria-label={each.label}
              className={[styles.tab, group === each.key ? styles.tabOn : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => setGroup(each.key)}
            >
              <span aria-hidden="true">{each.tab}</span>
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className={styles.none}>Nothing matches “{query.trim()}”. Try browsing instead.</p>
      ) : (
        <ul className={styles.grid}>
          {shown.map((emoji) => (
            <li key={emoji}>
              <button
                className={[styles.emoji, emoji === selected ? styles.emojiOn : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onPick(emoji)}
                aria-pressed={emoji === selected}
                aria-label={`React with ${emoji}`}
              >
                {emoji}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
