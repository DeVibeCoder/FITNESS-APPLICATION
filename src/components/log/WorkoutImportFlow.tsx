import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, ImageUp, PencilLine, RefreshCw, ScanLine, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CameraCapture } from '@/components/social/CameraCapture'
import { useHistoryDismiss } from '@/hooks/useHistoryDismiss'
import { useTempImage } from '@/hooks/useTempImage'
import { useToast } from '@/context/ToastContext'
import {
  workoutScanService,
  WorkoutScanError,
  type WorkoutScan,
} from '@/services/workoutScanService'
import { ManualWorkoutForm, type WorkoutDraft } from './ManualWorkoutForm'
import { todayKey } from '@/utils/date'
import styles from './WorkoutImportFlow.module.css'

type Stage = 'pick' | 'reading' | 'failed' | 'review'

/**
 * Reading a workout off a screenshot.
 *
 * The premise, unchanged from the endpoint that serves it: the other app has
 * already counted, and this transcribes what it printed. Nothing here
 * estimates, and a field the screen did not show arrives blank so the person
 * can answer it — a blank costs one tap, an invented 480 kcal gets saved and
 * quietly corrupts a month of totals.
 *
 * Three rules shape the flow:
 *
 *   The picture appears immediately, before any reading is attempted, because
 *   "is this the right screenshot" is a question you answer by looking.
 *
 *   The picture survives failure. Every unhappy path — no API key, a timeout,
 *   an image of a menu — keeps the screenshot on screen and offers the manual
 *   form, so there is always a way forward and never a dead end.
 *
 *   Nothing is written until Save. The reading fills the manual form and that
 *   form does the rest, which is why an imported workout and a typed one are
 *   the same record: one editor, one review step, one save path, no separate
 *   "imported workout" system to keep in step.
 *
 * The screenshot itself is never persisted. It is an object URL for as long as
 * this component is mounted, is downscaled into a transient string for the one
 * request, and is released on unmount however the flow ended.
 */
export function WorkoutImportFlow({
  onDone,
  onCancel,
}: {
  onDone: () => void
  /** Back out of importing, to the choice between this and typing. */
  onCancel: () => void
}) {
  const { show } = useToast()
  const shot = useTempImage()

  const [stage, setStage] = useState<Stage>('pick')
  const [scan, setScan] = useState<WorkoutScan | null>(null)
  const [failure, setFailure] = useState<{ message: string; canRetry: boolean } | null>(null)
  const [slow, setSlow] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  /** The file itself, kept so Read again does not need the picture re-chosen. */
  const [file, setFile] = useState<File | null>(null)
  /** Which step the embedded manual form is on. See its `onStep`. */
  const [formStep, setFormStep] = useState<'details' | 'review'>('details')

  const fileInput = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)

  // Leaving mid-read must not leave a request running against a dead screen.
  useEffect(() => () => abort.current?.abort(), [])

  /** A long read says so rather than looking stuck. */
  useEffect(() => {
    if (stage !== 'reading') {
      setSlow(false)
      return
    }
    const timer = window.setTimeout(() => setSlow(true), 6000)
    return () => window.clearTimeout(timer)
  }, [stage])

  const read = async (chosen: File) => {
    setStage('reading')
    setFailure(null)
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller

    try {
      const result = await workoutScanService.analyzeScreenshot(chosen, {
        signal: controller.signal,
      })
      setScan(result)
      setStage('review')
    } catch (error) {
      if (controller.signal.aborted) return
      const scanError = error instanceof WorkoutScanError ? error : null
      setFailure({
        message:
          scanError?.message ??
          'Screenshot reading is unavailable right now. You can still enter the workout yourself.',
        canRetry: scanError?.canRetry ?? true,
      })
      // Deliberately not 'pick': the picture stays, and so does the way out.
      setStage('failed')
    }
  }

  /** Accepts a picture from either route and starts reading it. */
  const accept = (chosen: File | undefined) => {
    if (!chosen) return
    try {
      workoutScanService.validate(chosen)
    } catch (error) {
      show(error instanceof Error ? error.message : 'That image cannot be read.', 'error')
      return
    }
    shot.set(chosen)
    setFile(chosen)
    void read(chosen)
  }

  const clear = () => {
    abort.current?.abort()
    shot.release()
    setFile(null)
    setScan(null)
    setFailure(null)
    setStage('pick')
  }

  /*
   * What the reading came to, as a draft for the manual form.
   *
   * Only what was actually read is carried across. `planName` is the fallback
   * name because a summary screen usually prints the plan and nothing else,
   * and `exerciseCount` is deliberately not turned into placeholder rows — a
   * screen that said "8 exercises" without naming them has given us a number,
   * not a list, and inventing eight blank rows would be inventing content.
   */
  const draft: WorkoutDraft | undefined = scan
    ? {
        kind: scan.kind,
        name: scan.workoutName ?? scan.planName,
        date: scan.date ?? todayKey(),
        durationSec: scan.durationSec,
        caloriesKcal: scan.caloriesKcal,
        exercises: scan.exercises,
      }
    : undefined

  const picture = shot.url ? (
    <figure className={styles.shot}>
      <img src={shot.url} alt="The screenshot being read" className={styles.shotImage} />
    </figure>
  ) : null

  const fileField = (
    <input
      ref={fileInput}
      type="file"
      accept={workoutScanService.accept}
      className={styles.file}
      onChange={(event) => {
        accept(event.target.files?.[0])
        // Reset, so choosing the same file twice in a row still fires.
        event.target.value = ''
      }}
      aria-label="Choose a workout screenshot"
    />
  )

  /**
   * Retake, replace, remove — available wherever the picture is.
   *
   * Not only on the review screen, which is where they used to live. A
   * screenshot that turns out to be the wrong one is discovered while looking
   * at it, and that happens while it is being read and again when the reading
   * fails; having to wait for a result before being allowed to change the
   * picture is the flow arguing with the person using it.
   */
  const tools = (
    <div className={styles.shotTools}>
      <button className={styles.shotTool} onClick={() => setCameraOpen(true)}>
        <Camera size={14} strokeWidth={2.2} />
        Retake
      </button>
      <button className={styles.shotTool} onClick={() => fileInput.current?.click()}>
        <ImageUp size={14} strokeWidth={2.2} />
        Replace
      </button>
      <button className={`${styles.shotTool} ${styles.shotToolDanger}`} onClick={clear}>
        <Trash2 size={14} strokeWidth={2.2} />
        Remove
      </button>
    </div>
  )

  const cameraSheet = cameraOpen ? (
    <CameraCapture
      /* Stills only. This phase reads screens, and a video of one would be a
         worse photograph of it. */
      allowVideo={false}
      onCapture={(captured) => {
        setCameraOpen(false)
        accept(captured)
      }}
      onClose={() => setCameraOpen(false)}
      onChooseInstead={() => {
        setCameraOpen(false)
        fileInput.current?.click()
      }}
    />
  ) : null

  // --- Pick ----------------------------------------------------------------
  if (stage === 'pick') {
    return (
      <>
        <div className={styles.intro}>
          <span className={styles.introIcon} aria-hidden="true">
            <ScanLine size={22} strokeWidth={1.9} />
          </span>
          <p className={styles.introText}>
            Point it at your workout app's summary screen. Only what is printed there is read —
            anything it does not show, you fill in.
          </p>
        </div>

        <Button
          size="lg"
          block
          icon={<Camera size={17} strokeWidth={2.2} />}
          onClick={() => setCameraOpen(true)}
        >
          Take a picture
        </Button>
        <Button
          variant="secondary"
          size="lg"
          block
          icon={<ImageUp size={16} strokeWidth={2.2} />}
          onClick={() => fileInput.current?.click()}
        >
          Choose from device
        </Button>

        {fileField}
        {cameraSheet}

        <Button variant="ghost" onClick={onCancel}>
          Back
        </Button>
      </>
    )
  }

  // --- Reading -------------------------------------------------------------
  if (stage === 'reading') {
    return (
      <>
        {/* Back puts the picture down and stops the reading with it. */}
        <PictureBack onBack={clear} />
        {picture}
        {tools}
        <div className={styles.working}>
          <span className={styles.spinner} aria-hidden="true" />
          <p className={styles.workingTitle}>Reading workout…</p>
          <p className={styles.workingHint}>
            {slow ? 'Still going. A slow first request usually settles down.' : 'This takes a moment.'}
          </p>
        </div>
        <Button variant="ghost" onClick={clear}>
          Cancel
        </Button>
        {fileField}
        {cameraSheet}
      </>
    )
  }

  // --- Failed --------------------------------------------------------------
  if (stage === 'failed') {
    return (
      <>
        {/* The picture is still a rung: Back puts it down, it does not leave. */}
        <PictureBack onBack={clear} />
        {picture}
        <div className={styles.failed}>
          <span className={styles.failedIcon} aria-hidden="true">
            <AlertTriangle size={20} strokeWidth={2} />
          </span>
          <p className={styles.failedTitle}>Automatic reading did not work</p>
          <p className={styles.failedBody}>{failure?.message}</p>
        </div>

        {/*
          The picture is still on screen and both ways forward are here. A
          failed reading must never be a dead end — the screenshot is in front
          of the person and typing what it says is a perfectly good answer.
        */}
        {failure?.canRetry && file ? (
          <Button
            variant="secondary"
            block
            icon={<RefreshCw size={16} strokeWidth={2.2} />}
            onClick={() => void read(file)}
          >
            Try reading it again
          </Button>
        ) : null}
        <Button
          size="lg"
          block
          icon={<PencilLine size={16} strokeWidth={2.2} />}
          onClick={() => {
            setFailure(null)
            setStage('review')
          }}
        >
          Enter it myself
        </Button>
        {tools}
        {fileField}
        {cameraSheet}
      </>
    )
  }

  // --- Review --------------------------------------------------------------
  return (
    <>
      {/* Back from the review returns to the picture, not out of the flow. */}
      <PictureBack onBack={clear} />

      {formStep === 'details' ? picture : null}
      {formStep === 'details' ? tools : null}

      {scan && formStep === 'details' ? <ReadingSummary scan={scan} /> : null}

      {/*
        The manual form, pre-filled. Everything below this line — editing,
        the review summary, saving — is the same code a typed workout uses, so
        the two cannot drift and there is only ever one kind of record.
      */}
      <ManualWorkoutForm draft={draft} onStep={setFormStep} onDone={onDone} />

      {fileField}
      {cameraSheet}
    </>
  )
}

/**
 * What the reading found, and what it did not.
 *
 * The missing list is the useful half: it is the difference between "the
 * screen did not say" and "we failed to read it", and it tells the person
 * exactly which blanks below are theirs to fill.
 */
function ReadingSummary({ scan }: { scan: WorkoutScan }) {
  const found = [
    scan.workoutName ?? scan.planName ? 'name' : null,
    scan.durationSec ? 'duration' : null,
    scan.caloriesKcal ? 'calories' : null,
    scan.exercises.length > 0 ? `${scan.exercises.length} exercises` : null,
  ].filter(Boolean) as string[]

  const blank = [
    scan.durationSec ? null : 'duration',
    scan.caloriesKcal ? null : 'calories',
    scan.exercises.length > 0 ? null : 'exercises',
  ].filter(Boolean) as string[]

  return (
    <div className={styles.result}>
      <p className={styles.resultTitle}>
        {found.length > 0 ? 'Workout found' : 'Not much was legible'}
      </p>
      {found.length > 0 ? <p className={styles.resultBody}>Read: {found.join(', ')}.</p> : null}
      {blank.length > 0 ? (
        <p className={styles.resultMissing}>
          Not shown on the screenshot: {blank.join(', ')}. Left blank for you to fill in.
        </p>
      ) : null}
      {scan.source === 'mock' ? (
        <p className={styles.resultMock}>Development mock — not your screenshot.</p>
      ) : null}
    </div>
  )
}

/**
 * One history entry for as long as a picture is in hand.
 *
 * It used to exist only on the review screen, which meant Back while the
 * screenshot was being read — or while the failure was on screen — unwound the
 * whole import flow in one press and took the picture with it. A picture is a
 * rung of its own: Back puts it down and returns to the two ways of choosing
 * one, and the press after that leaves the flow.
 *
 * Renders nothing; its lifetime is the feature.
 */
function PictureBack({ onBack }: { onBack: () => void }) {
  useHistoryDismiss(onBack)
  return null
}
