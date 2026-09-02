import { useEffect, useState } from 'react'
import { ChevronLeft, Camera, ImageUp, PencilLine } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { FoodEntryForm } from './FoodEntryForm'
import { FoodScanner, type ScanStart } from './FoodScanner'
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
 * Three ways in, named for what they actually do. Taking a photo opens the
 * camera, choosing from the device opens the picker, and typing it in opens the
 * same form an edit opens — a "camera" that was really the gallery, and a
 * gallery that was really the camera, were the same button twice.
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
  /** Which door the scanner opens on. Only meaningful while mode is 'scan'. */
  const [scanStart, setScanStart] = useState<ScanStart>('choose')

  const setMode = (next: Mode) => {
    setModeState(next)
    onModeChange?.(next)
  }

  const startScan = (from: ScanStart) => {
    setScanStart(from)
    setMode('scan')
  }

  useEffect(() => {
    setModeState(entry ? 'manual' : startIn)
    setScanStart('choose')
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
            <button className={styles.option} onClick={() => startScan('camera')}>
              <span className={styles.icon}>
                <Camera size={19} strokeWidth={1.9} />
              </span>
              <span className={styles.text}>
                <span className={styles.label}>Take a food photo</span>
                <span className={styles.hint}>Opens the camera, then you correct it</span>
              </span>
            </button>
          </li>
          <li>
            <button className={styles.option} onClick={() => startScan('library')}>
              <span className={styles.icon}>
                <ImageUp size={19} strokeWidth={1.9} />
              </span>
              <span className={styles.text}>
                <span className={styles.label}>Choose from device</span>
                <span className={styles.hint}>Use a photo you already took</span>
              </span>
            </button>
          </li>
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
        </ul>
      ) : null}

      {mode === 'manual' ? (
        <FoodEntryForm entry={entry} meal={meal} date={date} onDone={onClose} />
      ) : null}

      {mode === 'scan' ? (
        <FoodScanner
          date={date}
          start={scanStart}
          onManual={() => setMode('manual')}
          onDone={onClose}
        />
      ) : null}
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
      subtitle={mode === 'choose' ? 'Photograph it, or type it in.' : undefined}
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
