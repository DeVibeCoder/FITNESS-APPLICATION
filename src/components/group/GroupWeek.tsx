import { Link } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import type { UserSnapshot } from '@/services/progressService'
import { firstName } from '@/utils/format'
import styles from './GroupWeek.module.css'

interface Category {
  label: string
  hint: string
  member: UserSnapshot
  value: string
}

/**
 * Friendly categories rather than a ranking. Every entry names someone doing
 * well; nobody is named for doing badly, and there is no position number.
 */
export function GroupWeek({
  categories,
  currentUserId,
}: {
  categories: Category[]
  currentUserId: string
}) {
  return (
    <>
      <ul className={styles.list}>
        {categories.map((category) => (
          <li key={category.label}>
            <Card flush>
              <Link
                to={category.member.user.id === currentUserId ? '/profile' : `/u/${category.member.user.id}`}
                className={styles.row}
              >
                <Avatar user={category.member.user} size="sm" />
                <span className={styles.text}>
                  <span className={styles.label}>{category.label}</span>
                  <span className={styles.name}>{firstName(category.member.user.name)}</span>
                </span>
                <span className={styles.value}>{category.value}</span>
              </Link>
            </Card>
          </li>
        ))}
      </ul>
      <p className={styles.note}>
        Everyone is measured against their own goal, so a week counts the same whether someone is
        trying to lose, gain or simply keep showing up.
      </p>
    </>
  )
}
