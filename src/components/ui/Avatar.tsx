import type { User } from '@/models'
import { initials } from '@/utils/format'
import styles from './Avatar.module.css'

interface AvatarProps {
  user: Pick<User, 'name' | 'avatarColor' | 'avatarUrl'>
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  /** Draws a ring around the avatar, e.g. for an active streak. */
  ring?: boolean
}

export function Avatar({ user, size = 'md', ring }: AvatarProps) {
  return (
    <span
      className={[styles.avatar, styles[size], ring ? styles.ring : ''].filter(Boolean).join(' ')}
      style={{ '--avatar-color': user.avatarColor } as React.CSSProperties}
    >
      {user.avatarUrl ? (
        <img src={user.avatarUrl} alt="" className={styles.image} />
      ) : (
        <span aria-hidden="true">{initials(user.name)}</span>
      )}
    </span>
  )
}
