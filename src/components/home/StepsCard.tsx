import { useState } from 'react'
import { Footprints, Pencil, Plus } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { useAuth } from '@/context/AuthContext'
import { useLogSheet } from '@/context/LogSheetContext'
import { useToast } from '@/context/ToastContext'
import { stepsService } from '@/services'
import { todayKey } from '@/utils/date'
import { clamp, num, pct as formatPct } from '@/utils/format'
import styles from './StepsCard.module.css'

interface StepsCardProps {
  steps: number
  goal: number
}

/**
 * Steps get their own card because they are the thing most likely to be logged
 * from a watch face at the end of the day — two taps, no typing.
 */
export function StepsCard({ steps, goal }: StepsCardProps) {
  const { user } = useAuth()
  const { open } = useLogSheet()
  const { guard } = useToast()
  const [busy, setBusy] = useState(false)

  if (!user) return null

  const progress = goal > 0 ? clamp((steps / goal) * 100, 0, 100) : 0
  const remaining = Math.max(0, goal - steps)
  const hit = steps >= goal

  const add = async (delta: number) => {
    setBusy(true)
    await guard(() =>
      stepsService.set({ userId: user.id, date: todayKey(), steps: steps + delta }),
    )
    setBusy(false)
  }

  return (
    <Card className={styles.card}>
      <div className={styles.head}>
        <div className={styles.readout}>
          <p className={`${styles.value} tnum`}>{num(steps)}</p>
          <p className={styles.label}>of {num(goal)} steps</p>
        </div>
        <div className={styles.pctWrap}>
          <span className={[styles.pct, hit ? styles.pctHit : ''].filter(Boolean).join(' ')}>
            <span className="tnum">{formatPct(progress)}</span>
          </span>
          <span className={styles.icon} aria-hidden="true">
            <Footprints size={15} strokeWidth={1.9} />
          </span>
        </div>
      </div>

      <div className={styles.track} role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Steps progress">
        <div
          className={[styles.fill, hit ? styles.fillHit : ''].filter(Boolean).join(' ')}
          style={{ width: `${progress}%` }}
        />
      </div>

      <p className={styles.note}>
        {hit ? 'Goal hit for today.' : `${num(remaining)} to go`}
      </p>

      <div className={styles.actions}>
        <button className={styles.quick} onClick={() => add(500)} disabled={busy}>
          <Plus size={13} strokeWidth={2.6} />
          500
        </button>
        <button className={styles.quick} onClick={() => add(1000)} disabled={busy}>
          <Plus size={13} strokeWidth={2.6} />
          1,000
        </button>
        <button className={styles.edit} onClick={() => open('steps')}>
          <Pencil size={13} strokeWidth={2.2} />
          Edit
        </button>
      </div>
    </Card>
  )
}
