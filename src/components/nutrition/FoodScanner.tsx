import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, ImageUp, Info, PencilLine, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, SelectField } from '@/components/ui/Field'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useTempImage } from '@/hooks/useTempImage'
import { nutritionService } from '@/services'
import { MEAL_SLOTS } from '@/services/nutritionService'
import { foodScanService, ScanError, scanTotals, type ScanItem, type ScanResult } from '@/services/foodScanService'
import type { MealSlot } from '@/models'
import { FOOD_UNITS, formatPortion, type FoodUnit } from '@/utils/nutrition'
import { todayKey } from '@/utils/date'
import { num } from '@/utils/format'
import styles from './FoodScanner.module.css'

type Stage = 'choose' | 'analyzing' | 'review' | 'failed'

/**
 * Photo → analysis → correct → save.
 *
 * The photo is sent to our own endpoint for analysis and held locally only as
 * an object URL while the review is on screen. Confirming saves numbers only.
 *
 * When analysis fails, this shows the failure. It never substitutes example
 * food for the food in the photograph.
 */
export function FoodScanner({ date, onDone }: { date?: string; onDone: () => void }) {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const preview = useTempImage()
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const lastFile = useRef<File | null>(null)

  const [stage, setStage] = useState<Stage>('choose')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [items, setItems] = useState<ScanItem[]>([])
  const [meal, setMeal] = useState<MealSlot>('lunch')
  const [failure, setFailure] = useState<{ message: string; canRetry: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [slow, setSlow] = useState(false)

  useEffect(() => () => abortRef.current?.abort(), [])

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
    setFailure(null)
    try {
      const scan = await foodScanService.analyzeImage(file, {
        signal: controller.signal,
        forceRefresh,
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
      setStage('failed')
    }
  }

  const onPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
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

  const patch = (id: string, changes: Partial<ScanItem>) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)))

  const drop = (id: string) => setItems((current) => current.filter((item) => item.id !== id))

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
          source: 'photo',
        })
      }
    })
    setSaving(false)
    if (saved !== undefined) {
      preview.release()
      show(`Added ${items.length} ${items.length === 1 ? 'item' : 'items'}.`, 'success')
      onDone()
    }
  }

  const cancel = () => {
    reset()
    onDone()
  }

  // --- Choose -------------------------------------------------------------
  if (stage === 'choose') {
    return (
      <>
        <div className={styles.chooser}>
          <button className={styles.chooseButton} onClick={() => inputRef.current?.click()}>
            <span className={styles.chooseIcon}>
              <Camera size={20} strokeWidth={1.9} />
            </span>
            <span className={styles.chooseText}>
              <span className={styles.chooseLabel}>Take a photo</span>
              <span className={styles.chooseHint}>Opens your camera on a phone</span>
            </span>
          </button>
          <button className={styles.chooseButton} onClick={() => inputRef.current?.click()}>
            <span className={styles.chooseIcon}>
              <ImageUp size={20} strokeWidth={1.9} />
            </span>
            <span className={styles.chooseText}>
              <span className={styles.chooseLabel}>Choose a photo</span>
              <span className={styles.chooseHint}>Pick one from your library</span>
            </span>
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={foodScanService.accept}
          capture="environment"
          className="sr-only"
          onChange={onPick}
        />

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
        {preview.url ? <img src={preview.url} alt="" className={styles.preview} /> : null}
        <div className={styles.analyzingText}>
          <span className={styles.spinner} aria-hidden="true" />
          <div>
            <p className={styles.analyzingTitle}>Analysing your meal</p>
            <p className={styles.analyzingHint}>
              {slow
                ? 'Taking a little longer than usual. Hang on…'
                : 'Identifying foods and estimating portions…'}
            </p>
          </div>
        </div>
        <Button variant="secondary" block onClick={cancel}>
          Cancel
        </Button>
      </div>
    )
  }

  // --- Failed -------------------------------------------------------------
  if (stage === 'failed') {
    return (
      <div className={styles.failed}>
        <span className={styles.failIcon}>
          <AlertTriangle size={22} strokeWidth={2} />
        </span>
        <p className={styles.failTitle}>We couldn't analyse that photo</p>
        <p className={styles.failBody}>{failure?.message}</p>
        <div className={styles.failActions}>
          {failure?.canRetry && lastFile.current ? (
            <Button
              size="lg"
              block
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
            onClick={cancel}
          >
            Enter food manually
          </Button>
        </div>
      </div>
    )
  }

  // --- Review -------------------------------------------------------------
  const lowConfidence = result?.needsUserConfirmation === true

  return (
    <>
      {preview.url ? (
        <img src={preview.url} alt="The meal you photographed" className={styles.preview} />
      ) : null}

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
                onChange={(event) => patch(item.id, { name: event.target.value })}
                aria-label="Food name"
              />
              <button
                className={styles.remove}
                onClick={() => drop(item.id)}
                aria-label={`Remove ${item.name}`}
              >
                <Trash2 size={14} strokeWidth={2.1} />
              </button>
            </div>

            <div className={styles.itemMeta}>
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
    </>
  )
}
