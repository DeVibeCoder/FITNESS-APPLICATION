import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import type { User } from '@/models'
import { initials } from '@/utils/format'
import styles from './Avatar.module.css'

interface AvatarProps {
  user: Pick<User, 'name' | 'avatarColor' | 'avatarUrl' | 'avatarMediaId'>
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  /** Draws a ring around the avatar, e.g. for an active streak. */
  ring?: boolean
}

/**
 * Somebody's face, or their initials.
 *
 * The picture is a reference like every other image in this app: the user row
 * holds a `MediaAsset` id and the asset holds the pointer, so nothing binary
 * is stored and the avatar follows the same rules as a post's photo. This
 * resolves that id through a live query, which is what makes a new picture
 * appear everywhere at once — the header, the feed, the chat, the group —
 * the moment it is set, without a single one of those screens knowing.
 *
 * The fallback is not an error state. Most members have no picture, initials
 * on their own colour is a perfectly good answer, and it is what shows while
 * the asset is being read as well as when there is nothing to read.
 */
export function Avatar({ user, size = 'md', ring }: AvatarProps) {
  const asset = useLiveQuery(
    () => (user.avatarMediaId ? db.media.get(user.avatarMediaId) : undefined),
    [user.avatarMediaId],
  )
  const src = asset?.ref ?? user.avatarUrl

  return (
    <span
      className={[styles.avatar, styles[size], ring ? styles.ring : ''].filter(Boolean).join(' ')}
      style={{ '--avatar-color': user.avatarColor } as React.CSSProperties}
    >
      {src ? (
        <img src={src} alt="" className={styles.image} />
      ) : (
        <span aria-hidden="true">{initials(user.name)}</span>
      )}
    </span>
  )
}
