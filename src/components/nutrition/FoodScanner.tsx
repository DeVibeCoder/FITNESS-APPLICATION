import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  ImageUp,
  Info,
  PencilLine,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CameraCapture } from '@/components/social/CameraCapture'
import { Field, SelectField } from '@/components/ui/Field'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useTempImage } from '@/hooks/useTempImage'
import { achievementService, nutritionService } from '@/services'
import { MEAL_SLOTS } from '@/services/nutritionService'
import {
  foodScanService,
  ScanError,
  scanTotals,
  type ScanItem,
  type ScanResult,
  type ScanStage,
} from '@/services/foodScanService'
import type { MealSlot } from '@/models'
import { FOOD_UNITS, formatPortion, type FoodUnit } from '@/utils/nutrition'
import { todayKey } from '@/utils/date'
import { num } from '@/utils/format'
import styles from './FoodScanner.module.css'

type Stage = 'choose' | 'analyzing' | 'review' | 'failed'

/**
 * Where this flow opens: on the chooser, or straight into the camera.
 *
 * There is deliberately no 'library' door. A gallery has to be opened by the
 * tap that asked for it, so the picker lives in the chooser above this and
 * hands the chosen photo down as `initialFile` — see AddFoodSheet.
 */
export type ScanStart = 'choose' | 'camera'

/**
 * A row on the review list.
 *
 * `manual` marks a line the person added themselves, so it is never dressed up
 * with a confidence score the model never gave — nothing on this screen may
 * claim the photograph said something it did not.
 */
type ReviewItem = ScanItem & { manual?: boolean }

let manualCounter = 0

function blankItem(): ReviewItem {
  return {
    id: `manual_${++manualCounter}`,
    name: '',
    quantity: 100,
    unit: 'g',
    kcal: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    confidence: 0,
    confidenceLevel: 'high',
    alternatives: [],
    nutritionFrom: 'none',
    fromDatabase: false,
    manual: true,
  }
}

/**
 * Photo → analysis → correct → save.
 *
 * Three rules, the same three the workout screenshot reader follows:
 *
 *   The picture appears immediately. "Take a photo" opens the camera itself
 *   through `getUserMedia` rather than a file input wearing a camera label,
 *   and a photo chosen from the gallery arrives here as `initialFile`. Either
 *   way it is on screen before any analysis is attempted.
 *
 *   The picture survives failure. Every unhappy path keeps it visible and
 *   offers a way forward — try again, retake, or type the meal in.
 *
 *   Nothing is written until Add. The photo is an object URL for as long as
 *   this component is mounted and is released on confirm, cancel, retake and
 *   unmount. Only the numbers somebody has reviewed are ever stored.
 */
export function FoodScanner({
  date,
  onDone,
  onManual,
  start = 'choose',
  initialFile,
}: {
  date?: string
  onDone: () => void
  /** Hands the flow to the manual form, keeping one food form in the app. */
  onManual?: () => void
  start?: ScanStart
  /** A photo already chosen from the gallery, scanned as this opens. */
  initialFile?: File
}) {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const preview = useTempImage()
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const lastFile = useRef<File | null>(null)

  const [stage, setStage] = useState<Stage>('choose')
  const [cameraOpen, setCameraOpen] = useState(start === 'camera')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [items, setItems] = useState<ReviewItem[]>([])
  const [meal, setMeal] = useState<MealSlot>('lunch')
  const [failure, setFailure] = useState<{ message: string; canRetry: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [slow, setSlow] = useState(false)
  /** What is actually happening, as far as this side of the wire can tell. */
  const [phase, setPhase] = useState<ScanStage>('preparing')
  /*
   * The latest `accept`, for the mount effect below. The effect must run after
   * the first render (when a handed-in file arrives), and `accept` is defined
   * further down where it can read the props it needs.
   */
  const acceptRef = useRef<(file: File | undefined) => void>(() => {})

  useEffect(() => () => abortRef.current?.abort(), [])

  /*
   * A photo chosen upstairs in the gallery, scanned as this opens.
   *
   * Keyed on the file itself, so a re-render never re-analyses the same photo
   * and a second choice always does. Deliberately no "already started" ref:
   * one would make a remount skip the restart after the abort that a remount
   * also triggers, leaving the scan spinning at a request that no longer
   * exists — which is exactly what it did.
   */
  useEffect(() => {
    if (initialFile) acceptRef.current(initialFile)
  }, [initialFile])

  // The server may quietly retry a stalled call. The browser cannot observe
  // that, so rather than claim a retry we simply stop pretending it is quick.
  useEffect(() => {
    if (stage !== 'analyzing') {
      setSlow(false)
      return
    }
    const timer = window.setTimeout(() => setSlow(true), 6000)
    return () => window.clearTimeout(timer)
  }, [stage])

  if (!user) return null
  const forDate = date ?? todayKey()

  const reset = () => {
    abortRef.current?.abort()
    abortRef.current = null
    preview.release()
    lastFile.current = null
    setItems([])
    setResult(null)
    setFailure(null)
    setStage('choose')
  }

  const analyze = async (file: File, forceRefresh = false) => {
    // Only one analysis in flight: starting a new scan abandons the old one so
    // a second request is never paid for or raced against.
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStage('analyzing')
    setPhase('preparing')
    setFailure(null)
    try {
      const scan = await foodScanService.analyzeImage(file, {
        signal: controller.signal,
        forceRefresh,
        onStage: setPhase,
      })
      if (controller.signal.aborted) return
      setResult(scan)
      setItems(scan.items)
      setMeal(scan.suggestedMeal)
      setStage('review')
    } catch (error) {
      if (controller.signal.aborted) return
      setFailure({
        message: error instanceof ScanError ? error.message : 'Food analysis is temporarily unavailable.',
        canRetry: error instanceof ScanError ? error.canRetry : true,
      })
      // Deliberately not 'choose': the photo stays, and so does the way out.
      setStage('failed')
    }
  }

  /** Accepts a photo from either route: shows it, then reads it. */
  const accept = (file: File | undefined) => {
    if (!file) return // Picker cancelled — nothing to clean up.

    try {
      foodScanService.validate(file)
    } catch (error) {
      show(error instanceof ScanError ? error.message : "That photo couldn't be used.", 'error')
      return
    }

    preview.set(file)
    lastFile.current = file
    void analyze(file)
  }

  acceptRef.current = accept

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset, so choosing the same file twice in a row still fires.
    event.target.value = ''
    accept(file)
  }

  const patch = (id: string, changes: Partial<ReviewItem>) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)))

  const drop = (id: string) => setItems((current) => current.filter((item) => item.id !== id))

  const addItem = () => setItems((current) => [...current, blankItem()])

  // The list is the source of truth: the headline can never disagree with it.
  const totals = scanTotals(items)

  const confirm = async () => {
    if (items.length === 0) {
      show('Nothing left to add.', 'error')
      return
    }
    setSaving(true)
    const saved = await guard(async () => {
      for (const item of items) {
        await nutritionService.addFood({
          userId: user.id,
          date: forDate,
          meal,
          name: item.name.trim() || 'Food',
          quantity: item.quantity,
          unit: item.unit,
          portion: formatPortion(item.quantity, item.unit),
          kcal: Math.round(item.kcal),
          proteinG: Math.round(item.proteinG),
          carbsG: Math.round(item.carbsG),
          fatG: Math.round(item.fatG),
          // A line typed on the review screen is a manual entry, whatever
          // started the flow.
          source: item.manual ? 'manual' : 'photo',
        })
      }
      // Counts toward the marks exactly as a typed meal does.
      await achievementService.evaluate(user.id)
      // `guard` says "it failed" with `undefined`, so success has to say
      // something. Without this the meal saved and the sheet stayed open with
      // the photo still held.
      return true
    })
    setSaving(false)
    if (saved) {
      preview.release()
      show(`Added ${items.length} ${items.length === 1 ? 'item' : 'items'}.`, 'success')
      onDone()
    }
  }

  const cancel = () => {
    reset()
    onDone()
  }

  /** The photo, at the size it deserves — never cropped to a thumbnail. */
  const picture = preview.url ? (
    <figure className={styles.shot}>
      <img src={preview.url} alt="The meal you photographed" className={styles.shotImage} />
    </figure>
  ) : null

  const fileField = (
    <input
      ref={inputRef}
      type="file"
      accept={foodScanService.accept}
      className={styles.file}
      onChange={onPick}
      aria-label="Choose a food photo"
    />
  )

  const cameraSheet = cameraOpen ? (
    <CameraCapture
      /* Stills only: a video of a plate is a worse photograph of it. */
      allowVideo={false}
      onCapture={(captured) => {
        setCameraOpen(false)
        accept(captured)
      }}
      onClose={() => {
        setCameraOpen(false)
        // Backing out of a camera that was opened directly leaves the chooser
        // rather than an empty screen.
        if (stage === 'choose') setStage('choose')
      }}
      onChooseInstead={() => {
        setCameraOpen(false)
        inputRef.current?.click()
      }}
    />
  ) : null

  /** Retake, replace, remove — the three things you do to a picture. */
  const tools = (
    <div className={styles.shotTools}>
      <button className={styles.shotTool} onClick={() => setCameraOpen(true)}>
        <Camera size={14} strokeWidth={2.2} />
        Retake
      </button>
      <button className={styles.shotTool} onClick={() => inputRef.current?.click()}>
        <ImageUp size={14} strokeWidth={2.2} />
        Replace
      </button>
      <button className={`${styles.shotTool} ${styles.shotToolDanger}`} onClick={reset}>
        <Trash2 size={14} strokeWidth={2.2} />
        Remove
      </button>
    </div>
  )

  // --- Choose -------------------------------------------------------------
  if (stage === 'choose') {
    return (
      <>
        <div className={styles.chooser}>
          <button className={styles.chooseButton} onClick={() => setCameraOpen(true)}>
            <span className={styles.chooseIcon}>
              <Camera size={20} strokeWidth={1.9} />
            </span>
            <span className={styles.chooseText}>
              <span className={styles.chooseLabel}>Take a food photo</span>
              <span className={styles.chooseHint}>Opens the camera</span>
            </span>
          </button>
          <button className={styles.chooseButton} onClick={() => inputRef.current?.click()}>
            <span className={styles.chooseIcon}>
              <ImageUp size={20} strokeWidth={1.9} />
            </span>
            <span className={styles.chooseText}>
              <span className={styles.chooseLabel}>Choose from device</span>
              <span className={styles.chooseHint}>Pick a photo you already have</span>
            </span>
          </button>
          {onManual ? (
            <button className={styles.chooseButton} onClick={onManual}>
              <span className={styles.chooseIcon}>
                <PencilLine size={20} strokeWidth={1.9} />
              </span>
              <span className={styles.chooseText}>
                <span className={styles.chooseLabel}>Enter it manually</span>
                <span className={styles.chooseHint}>Name, portion and the numbers</span>
              </span>
            </button>
          ) : null}
        </div>

        {fileField}
        {cameraSheet}

        <p className={styles.privacy}>
          <Info size={13} strokeWidth={2.2} />
          Your photo is sent for analysis and then discarded. It is never saved to your history —
          only the nutrition you confirm is kept.
        </p>
      </>
    )
  }

  // --- Analyzing ----------------------------------------------------------
  if (stage === 'analyzing') {
    return (
      <div className={styles.analyzing}>
        {picture}
        <div className={styles.analyzingText}>
          <span className={styles.spinner} aria-hidden="true" />
          <div>
            {/*
              Two stages, and both of them are true. Shrinking the photo
              happens here and is named here; everything after it is one
              request whose inside this side cannot see, so it is described as
              the one thing it is rather than as a march of invented steps.
            */}
            <p className={styles.analyzingTitle}>
              {phase === 'preparing' ? 'Preparing your photo' : 'Analysing your meal'}
            </p>
            <p className={styles.analyzingHint}>
              {phase === 'preparing'
                ? 'Shrinking it before it leaves your phone…'
                : slow
                  ? 'Still identifying foods and looking up their nutrition. This can take up to a minute.'
                  : 'Identifying foods and looking up their nutrition…'}
            </p>
          </div>
        </div>
        <Button variant="secondary" block onClick={cancel}>
          Cancel
        </Button>
        {fileField}
      </div>
    )
  }

  // --- Failed -------------------------------------------------------------
  if (stage === 'failed') {
    return (
      <>
        {/* The photo stays: it is still the meal, and typing it in is a
            perfectly good answer with the picture in front of you. */}
        {picture}
        <div className={styles.failed}>
          <span className={styles.failIcon}>
            <AlertTriangle size={22} strokeWidth={2} />
          </span>
          <p className={styles.failTitle}>We couldn't analyse that photo</p>
          <p className={styles.failBody}>{failure?.message}</p>
        </div>
        <div className={styles.failActions}>
          {failure?.canRetry && lastFile.current ? (
            <Button
              size="lg"
              block
              icon={<RefreshCw size={16} strokeWidth={2.2} />}
              onClick={() => lastFile.current && analyze(lastFile.current, true)}
            >
              Try again
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="lg"
            block
            icon={<PencilLine size={16} strokeWidth={2.2} />}
            onClick={() => (onManual ? onManual() : cancel())}
          >
            Enter food manually
          </Button>
          {tools}
        </div>
        {fileField}
        {cameraSheet}
      </>
    )
  }

  // --- Review -------------------------------------------------------------
  const lowConfidence = result?.needsUserConfirmation === true

  return (
    <>
      {picture}
      {tools}

      {result?.source === 'mock' ? (
        <p className={styles.devWarning}>
          <AlertTriangle size={13} strokeWidth={2.4} />
          <strong>Development mode.</strong> The server is running with FOOD_SCAN_MOCK enabled, so
          this result did not come from your photo.
        </p>
      ) : null}

      <p className={[styles.disclaimer, lowConfidence ? styles.uncertain : ''].filter(Boolean).join(' ')}>
        <Info size={13} strokeWidth={2.2} />
        {result?.overallLevel === 'low'
          ? "We couldn't confidently identify this food. Check every line, or enter it yourself."
          : lowConfidence
            ? 'Some of this needs a second look — check the foods and portions before saving.'
            : 'Estimated nutrition — review the food matches and portions before saving.'}
      </p>

      <div className={styles.reviewMeta}>
        {result?.fromCache ? (
          <span className={styles.cached}>Reusing this photo's earlier result</span>
        ) : null}
        <button
          className={styles.reanalyse}
          onClick={() => lastFile.current && analyze(lastFile.current, true)}
        >
          <RefreshCw size={12} strokeWidth={2.3} />
          Analyse again
        </button>
      </div>

      <ul className={styles.items}>
        {items.map((item) => (
          <li key={item.id} className={styles.item}>
            <div className={styles.itemHead}>
              <input
                className={styles.nameInput}
                value={item.name}
                placeholder={item.manual ? 'What was it?' : undefined}
                onChange={(event) => patch(item.id, { name: event.target.value })}
                aria-label="Food name"
              />
              <button
                className={styles.remove}
                onClick={() => drop(item.id)}
                aria-label={`Remove ${item.name || 'this item'}`}
              >
                <Trash2 size={14} strokeWidth={2.1} />
              </button>
            </div>

            <div className={styles.itemMeta}>
              {item.manual ? (
                <span className={styles.tag}>Added by you</span>
              ) : (
                <>
                  <span
                    className={[
                      styles.confidence,
                      item.confidenceLevel === 'high'
                        ? styles.sure
                        : item.confidenceLevel === 'medium'
                          ? styles.maybe
                          : styles.unsure,
                    ].join(' ')}
                  >
                    {item.confidenceLevel === 'high'
                      ? 'High confidence'
                      : item.confidenceLevel === 'medium'
                        ? 'Likely'
                        : 'Not sure'}
                    {' · '}
                    <span className="tnum">{Math.round(item.confidence * 100)}%</span>
                  </span>
                  {item.cookingMethod ? <span className={styles.tag}>{item.cookingMethod}</span> : null}
                  {item.nutritionFrom === 'database' ? (
                    <span className={item.matchLevel === 'low' ? styles.noMatch : styles.matched}>
                      {item.matchLevel === 'low' ? 'match needs confirming' : 'USDA'}
                      {item.matchedName && item.matchedName.toLowerCase() !== item.name.toLowerCase()
                        ? `: “${item.matchedName}”`
                        : ''}
                    </span>
                  ) : item.nutritionFrom === 'estimate' ? (
                    <span className={styles.noMatch}>estimated, not from the database — check it</span>
                  ) : (
                    <span className={styles.noMatch}>no nutrition found — please fill in</span>
                  )}
                </>
              )}
            </div>

            {item.alternatives.length > 0 ? (
              <div className={styles.alternatives}>
                <span className={styles.altLabel}>
                  {item.confidenceLevel === 'low' ? 'Choose' : 'Or was it'}
                </span>
                {item.alternatives.map((alternative) => (
                  <button
                    key={alternative}
                    className={styles.altButton}
                    onClick={() => patch(item.id, { name: alternative })}
                  >
                    {alternative}
                  </button>
                ))}
              </div>
            ) : null}

            <div className={styles.itemGrid}>
              <Field
                label="Approx. qty"
                type="number"
                inputMode="decimal"
                step="0.1"
                value={String(item.quantity)}
                onChange={(event) =>
                  patch(item.id, { quantity: Number.parseFloat(event.target.value) || 0 })
                }
              />
              <SelectField
                label="Unit"
                value={item.unit}
                onChange={(event) => patch(item.id, { unit: event.target.value as FoodUnit })}
              >
                {FOOD_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </SelectField>
              <Field
                label="kcal"
                type="number"
                inputMode="numeric"
                value={String(item.kcal)}
                onChange={(event) =>
                  patch(item.id, { kcal: Number.parseFloat(event.target.value) || 0 })
                }
              />
            </div>

            <div className={styles.itemGrid}>
              <Field
                label="Protein"
                type="number"
                inputMode="numeric"
                suffix="g"
                value={String(item.proteinG)}
                onChange={(event) =>
                  patch(item.id, { proteinG: Number.parseFloat(event.target.value) || 0 })
                }
              />
              <Field
                label="Carbs"
                type="number"
                inputMode="numeric"
                suffix="g"
                value={String(item.carbsG)}
                onChange={(event) =>
                  patch(item.id, { carbsG: Number.parseFloat(event.target.value) || 0 })
                }
              />
              <Field
                label="Fat"
                type="number"
                inputMode="numeric"
                suffix="g"
                value={String(item.fatG)}
                onChange={(event) =>
                  patch(item.id, { fatG: Number.parseFloat(event.target.value) || 0 })
                }
              />
            </div>
          </li>
        ))}
      </ul>

      {/*
        Something the camera could not see — the oil it was cooked in, the
        drink beside it — goes on as a line of its own rather than being
        smuggled into one of the detected foods.
      */}
      <Button
        variant="secondary"
        block
        icon={<Plus size={16} strokeWidth={2.4} />}
        onClick={addItem}
      >
        Add another food
      </Button>

      <p className={styles.hiddenCalories}>
        Oil, butter, sauce and dressing are hard to see in a photo and are not included. Add them as
        a separate item if they were used.
      </p>

      <div className={styles.totals}>
        <div>
          <p className={styles.totalsLabel}>Estimated total</p>
          <p className={styles.totalsValue}>
            <span className="tnum">{num(totals.kcal)}</span> kcal
          </p>
        </div>
        <p className={styles.totalsMacros}>
          <span className="tnum">{num(totals.proteinG)}</span> P ·{' '}
          <span className="tnum">{num(totals.carbsG)}</span> C ·{' '}
          <span className="tnum">{num(totals.fatG)}</span> F
        </p>
      </div>

      <SelectField
        label="Add to"
        value={meal}
        onChange={(event) => setMeal(event.target.value as MealSlot)}
      >
        {MEAL_SLOTS.map((slot) => (
          <option key={slot.value} value={slot.value}>
            {slot.label}
          </option>
        ))}
      </SelectField>

      <Button size="lg" block onClick={confirm} disabled={saving || items.length === 0}>
        {saving ? 'Saving…' : `Add ${items.length} ${items.length === 1 ? 'item' : 'items'}`}
      </Button>
      <Button variant="ghost" onClick={cancel}>
        Discard this scan
      </Button>

      {fileField}
      {cameraSheet}
    </>
  )
}
