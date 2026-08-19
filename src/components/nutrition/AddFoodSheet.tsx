import { useEffect, useState } from 'react'
import { ChevronLeft, Camera, PencilLine, Search } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { FoodEntryForm } from './FoodEntryForm'
import { FoodScanner } from './FoodScanner'
import type { FoodEntry, MealSlot } from '@/models'
import styles from './AddFoodSheet.module.css'

type Mode = 'choose' | 'manual' | 'scan'

interface AddFoodSheetProps {
  open: boolean
  onClose: () => void
  /** Editing jumps straight to the manual form with the record loaded. */
  entry?: FoodEntry
  meal?: MealSlot
  date?: string
  /** Skips the chooser — used by the quick-log sheet's "Log Food". */
  startIn?: Mode
}

const TITLES: Record<Mode, string> = {
  choose: 'Add food',
  manual: 'Add food',
  scan: 'Scan a meal',
}

/**
 * The single entry point for logging food. Both the nutrition screen and the
 * quick-log sheet render this, so there is one form and one scanner in the app.
 *
 * Split from its Sheet wrapper so the quick-log sheet can host the flow inside
 * the sheet it already has open, rather than stacking a second one on top.
 */
export function AddFoodFlow({
  entry,
  meal,
  date,
  startIn = 'choose',
  onDone,
  onModeChange,
}: {
  entry?: FoodEntry
  meal?: MealSlot
  date?: string
  startIn?: Mode
  onDone: () => void
  onModeChange?: (mode: Mode) => void
}) {
  const [mode, setModeState] = useState<Mode>(entry ? 'manual' : startIn)

  const setMode = (next: Mode) => {
    setModeState(next)
    onModeChange?.(next)
  }

  useEffect(() => {
    setModeState(entry ? 'manual' : startIn)
  }, [entry, startIn])

  const onClose = onDone

  return (
    <>
      {mode !== 'choose' && !entry && startIn === 'choose' ? (
        <button className={styles.back} onClick={() => setMode('choose')}>
          <ChevronLeft size={16} strokeWidth={2.4} />
          Back
        </button>
      ) : null}

      {mode === 'choose' ? (
        <ul className={styles.options}>
          <li>
            <button className={styles.option} onClick={() => setMode('manual')}>
              <span className={styles.icon}>
                <PencilLine size={19} strokeWidth={1.9} />
              </span>
              <span className={styles.text}>
                <span className={styles.label}>Enter it manually</span>
                <span className={styles.hint}>Name, portion and the numbers</span>
              </span>
            </button>
          </li>
          <li>
            <button className={styles.option} onClick={() => setMode('scan')}>
              <span className={styles.icon}>
                <Camera size={19} strokeWidth={1.9} />
              </span>
              <span className={styles.text}>
                <span className={styles.label}>Scan a meal</span>
                <span className={styles.hint}>Start from a photo, then correct it</span>
              </span>
            </button>
          </li>
          <li>
            <span className={`${styles.option} ${styles.disabled}`} aria-disabled="true">
              <span className={styles.icon}>
                <Search size={19} strokeWidth={1.9} />
              </span>
              <span className={styles.text}>
                <span className={styles.label}>Search a food database</span>
                <span className={styles.hint}>Not connected yet</span>
              </span>
            </span>
          </li>
        </ul>
      ) : null}

      {mode === 'manual' ? (
        <FoodEntryForm entry={entry} meal={meal} date={date} onDone={onClose} />
      ) : null}

      {mode === 'scan' ? <FoodScanner date={date} onDone={onClose} /> : null}
    </>
  )
}

/** Sheet-wrapped version, for callers that do not already have one open. */
export function AddFoodSheet({
  open,
  onClose,
  entry,
  meal,
  date,
  startIn = 'choose',
}: AddFoodSheetProps) {
  const [mode, setMode] = useState<Mode>('choose')

  useEffect(() => {
    if (open) setMode(entry ? 'manual' : startIn)
  }, [open, entry, startIn])

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={entry ? 'Edit food' : TITLES[mode]}
      subtitle={mode === 'choose' ? 'Type it in, or start from a photo.' : undefined}
    >
      {open ? (
        <AddFoodFlow
          entry={entry}
          meal={meal}
          date={date}
          startIn={startIn}
          onDone={onClose}
          onModeChange={setMode}
        />
      ) : null}
    </Sheet>
  )
}
