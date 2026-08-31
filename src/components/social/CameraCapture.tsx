import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Grid3x3, Images, SwitchCamera, Timer, TimerOff, X, Zap, ZapOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useHistoryDismiss } from '@/hooks/useHistoryDismiss'
import styles from './CameraCapture.module.css'

/**
 * The camera, in the app.
 *
 * `capture` on a file input was never the camera — it is a hint that the
 * picker may offer one, and on most desktops and plenty of phones it simply
 * opens the gallery. This asks for the camera itself through `getUserMedia`,
 * shows what it sees, and hands back a `File` exactly as if one had been
 * picked. Everything downstream — the object URL, the measuring, the
 * MediaAsset reference — is unchanged, because a captured file and a chosen
 * file are the same thing once they exist.
 *
 * It is laid out the way a phone camera is laid out, and for the same reason:
 * the viewfinder is a framed rectangle with the controls on black above and
 * below it, not a full-bleed picture with buttons floating on top. That frame
 * is the picture you are actually going to get — the same ratio, the same
 * crop, the same zoom — so nothing arrives in the composer wider or tighter
 * than what was on screen. Stories frame 9:16 because that is what a story is;
 * everything else frames whatever the lens hands over.
 *
 * The controls are the ones a phone has taught everybody to expect: pinch and
 * a zoom rail, tap to focus, a torch, a framing grid, a self-timer, and a
 * shutter. Each is either backed by a real capability of the live track or
 * done honestly in pixels — nothing appears on screen that the device cannot
 * actually do, because a torch button that does nothing is worse than no torch
 * button at all.
 *
 * Nothing is written anywhere. The captured blob lives in memory, becomes a
 * File, and goes straight to the composer that opened this.
 */

/*
 * The parts of the media-capture spec the DOM typings do not carry. They are
 * widely implemented on phones and absent on most desktops, which is exactly
 * why every use of them is feature-detected against the live track first.
 */
type CameraCapabilities = MediaTrackCapabilities & {
  torch?: boolean
  zoom?: { min?: number; max?: number; step?: number }
  focusMode?: string[]
}

type CameraConstraint = {
  torch?: boolean
  zoom?: number
  focusMode?: string
  pointsOfInterest?: { x: number; y: number }[]
}

/** How far the pixel-cropping fallback goes when the lens itself will not zoom. */
const DIGITAL_MAX = 4

/** The self-timer, in the only two lengths anybody has ever wanted. */
const TIMERS = [0, 3, 10] as const

/** Two presses of the shutter this close together are one press, twice. */
const DEBOUNCE_MS = 350

/**
 * How long the shutter has to be held before it starts recording.
 *
 * Short enough that holding feels immediate, long enough that an ordinary tap
 * — which lasts about 80ms — is never mistaken for one.
 */
const HOLD_TO_RECORD_MS = 260

/*
 * Grid and timer are chosen once and then wanted again. Holding them at module
 * scope means the choice survives closing and reopening the camera without
 * writing a preference to a device nobody asked us to write to.
 */
let rememberedGrid = false
let rememberedTimer: (typeof TIMERS)[number] = 0

function applyTrack(track: MediaStreamTrack | undefined, constraint: CameraConstraint) {
  if (!track) return Promise.resolve()
  return track
    .applyConstraints({ advanced: [constraint] } as unknown as MediaTrackConstraints)
    .catch(() => undefined)
}

function clock(ms: number) {
  const total = Math.floor(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function cx(...names: (string | false | undefined)[]) {
  return names.filter(Boolean).join(' ')
}

export function CameraCapture({
  onCapture,
  onClose,
  onChooseInstead,
  allowVideo = true,
  maxVideoSec,
  frame = 'free',
  initialMode = 'photo',
  holdToRecord = false,
}: {
  onCapture: (file: File) => void
  onClose: () => void
  /** Offered when the camera cannot be used at all. */
  onChooseInstead?: () => void
  allowVideo?: boolean
  /**
   * Which mode the camera opens in.
   *
   * A mode, and only a mode. Opening on `video` arms the shutter to record —
   * it does not start recording, and nothing in this component starts a
   * capture except a press of the shutter itself.
   */
  initialMode?: 'photo' | 'video'
  /** Recording stops itself here. Stories pass 60; posts pass nothing. */
  maxVideoSec?: number
  /**
   * The shape of the thing being made. `story` frames and crops to 9:16;
   * `free` keeps whatever the lens gives, which is what a post displays.
   */
  frame?: 'story' | 'free'
  /**
   * One shutter that does both: a tap takes a photo, a press and hold records
   * for as long as it is held.
   *
   * Stories use it, and it is why they no longer carry a Photo/Video rail.
   * Two words that both opened the same camera were a choice about nothing —
   * the finger already knows the difference between a tap and a hold, and
   * every story camera on a phone has taught it.
   */
  holdToRecord?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [multipleCameras, setMultipleCameras] = useState(false)

  const [mode, setMode] = useState<'photo' | 'video'>(initialMode)
  const [grid, setGrid] = useState(rememberedGrid)
  const [timer, setTimer] = useState<(typeof TIMERS)[number]>(rememberedTimer)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [flash, setFlash] = useState(false)

  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [focusSupported, setFocusSupported] = useState(false)
  const [reticle, setReticle] = useState<{ x: number; y: number; at: number } | null>(null)

  /** The stream's own shape, which is the frame when nothing else asks for one. */
  const [sensor, setSensor] = useState<{ width: number; height: number } | null>(null)
  /** The viewfinder's box in pixels, measured rather than guessed. */
  const [area, setArea] = useState({ width: 0, height: 0 })

  /*
   * `native` says whether the lens itself zooms. Where it does not, the same
   * rail crops pixels instead — real for a photo, which is cropped out of the
   * frame already in hand, and impossible for a clip, which is whatever the
   * track hands the recorder. So the fallback is offered for photos only,
   * rather than zooming a preview over a recording that stays wide.
   */
  const [zoomRange, setZoomRange] = useState<{
    min: number
    max: number
    step: number
    native: boolean
  } | null>(null)
  const [zoom, setZoom] = useState(1)

  const canRecord = allowVideo && typeof MediaRecorder !== 'undefined'
  /*
   * A story is shot full-bleed.
   *
   * In the framed layout the viewfinder had to fit between a settings bar and
   * a console, which on a 390px phone left a 337×600 picture inside a black
   * screen — a preview of a preview. Here the picture takes the whole screen
   * at its true 9:16 and the controls float over it, which is both what a
   * phone camera looks like and what the story itself will look like.
   */
  const immersive = frame === 'story'
  const factor = zoomRange ? zoom / zoomRange.min : 1
  const zoomUsable = Boolean(zoomRange && (zoomRange.native || mode === 'photo'))

  /*
   * One ratio, used three times: to size the frame on screen, to crop the
   * photo, and to decide how much of the picture the preview has to hide. They
   * cannot drift apart, which is the whole point of there being one of them.
   */
  const ratio = frame === 'story' ? 9 / 16 : sensor ? sensor.width / sensor.height : 3 / 4
  /*
   * The largest rectangle of the right shape that fits the measured area.
   *
   * Immersive mode measures the whole screen rather than the strip left over
   * between two bands, so the same line produces a far bigger picture without
   * ever stretching it: the ratio is still the one the file will have.
   */
  const frameWidth = Math.min(area.width, area.height * ratio)
  const frameHeight = frameWidth / ratio

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const close = useCallback(() => {
    stop()
    onClose()
  }, [stop, onClose])

  // Back closes the camera rather than leaving the app.
  useHistoryDismiss(close)

  useEffect(() => {
    rememberedGrid = grid
    rememberedTimer = timer
  }, [grid, timer])

  // The frame is sized from the measured area, so it is right on a short phone
  // in landscape and on a tall one with the keyboard shut, without a guess.
  useEffect(() => {
    const node = areaRef.current
    if (!node) return
    // contentRect, not clientWidth: the padding around the frame is breathing
    // room, not space the picture is allowed to use. The observer fires once
    // on observe, so there is no separate first measurement.
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setArea({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  /*
   * Opening the camera, and re-opening it when the person flips it.
   *
   * Audio is requested alongside video because a recorded clip with no sound
   * is a clip somebody will re-record. A device that refuses audio still gets
   * a camera: the retry drops the audio ask rather than failing outright.
   *
   * What the lens can do is read back off the running track. Capabilities
   * belong to a camera, not to a device — the front one usually has no torch
   * and less zoom than the back — so this runs again on every flip, and the
   * controls appear and disappear with the lens they belong to.
   */
  useEffect(() => {
    let cancelled = false

    const start = async () => {
      setReady(false)
      setError(null)
      setTorchOn(false)
      setTorchSupported(false)
      setFocusSupported(false)
      setZoomRange(null)
      setZoom(1)
      stop()

      const media = navigator.mediaDevices
      if (!media?.getUserMedia) {
        setError('This browser will not give the page a camera.')
        return
      }

      const attempts: MediaStreamConstraints[] = [
        {
          video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: allowVideo,
        },
        { video: { facingMode: facing }, audio: false },
        { video: true, audio: false },
      ]

      for (const constraints of attempts) {
        try {
          const stream = await media.getUserMedia(constraints)
          if (cancelled) {
            stream.getTracks().forEach((track) => track.stop())
            return
          }
          streamRef.current = stream
          if (videoRef.current) {
            videoRef.current.srcObject = stream
            // Autoplay is only allowed because the preview is muted.
            await videoRef.current.play().catch(() => undefined)
          }
          setReady(true)

          const track = stream.getVideoTracks()[0]
          const caps: CameraCapabilities = track?.getCapabilities?.() ?? {}
          setTorchSupported(caps.torch === true)
          setFocusSupported(Boolean(caps.focusMode?.some((each) => each !== 'none')))

          const min = caps.zoom?.min ?? 1
          const max = caps.zoom?.max ?? 1
          if (caps.zoom && max > min) {
            /*
             * Cameras report zoom in units of their own choosing, where "1×"
             * is whatever the minimum happens to be — 1 on one phone, 100 on
             * the next. Everything on screen is therefore a factor of the
             * minimum, and only this state holds the raw value.
             */
            setZoomRange({ min, max, step: caps.zoom.step || (max - min) / 100, native: true })
            setZoom(min)
          } else {
            setZoomRange({ min: 1, max: DIGITAL_MAX, step: 0.05, native: false })
            setZoom(1)
          }

          // Only offer the flip where there is something to flip to.
          const devices = await media.enumerateDevices().catch(() => [])
          if (!cancelled) {
            setMultipleCameras(devices.filter((d) => d.kind === 'videoinput').length > 1)
          }
          return
        } catch (failure) {
          const name = failure instanceof Error ? failure.name : ''
          // A refusal is final; a constraint this device cannot meet is not.
          if (name === 'NotAllowedError' || name === 'SecurityError') {
            if (!cancelled) {
              setError('Camera permission was declined. You can still choose a file instead.')
            }
            return
          }
        }
      }

      if (!cancelled) setError('No camera was available on this device.')
    }

    void start()
    return () => {
      cancelled = true
      stop()
    }
  }, [facing, allowVideo, stop])

  // A cropped preview over a clip that will not be cropped is a lie, so moving
  // to video with the fallback rail takes the crop back.
  useEffect(() => {
    if (mode === 'video' && zoomRange && !zoomRange.native && zoom !== 1) setZoom(1)
  }, [mode, zoomRange, zoom])

  useEffect(() => {
    if (!canRecord && mode === 'video') setMode('photo')
  }, [canRecord, mode])

  const setZoomTo = useCallback(
    (next: number) => {
      if (!zoomRange) return
      const clamped = Math.min(Math.max(next, zoomRange.min), zoomRange.max)
      setZoom(clamped)
      if (zoomRange.native) {
        void applyTrack(streamRef.current?.getVideoTracks()[0], { zoom: clamped })
      }
    },
    [zoomRange],
  )

  const toggleTorch = () => {
    const next = !torchOn
    setTorchOn(next)
    void applyTrack(streamRef.current?.getVideoTracks()[0], { torch: next })
  }

  // The recording clock. Tenths, so the ring around the shutter sweeps rather
  // than stepping once a second.
  useEffect(() => {
    if (!recording) return
    const started = Date.now()
    const tick = window.setInterval(() => setElapsed(Date.now() - started), 100)
    return () => window.clearInterval(tick)
  }, [recording])

  useEffect(() => {
    if (recording && maxVideoSec && elapsed >= maxVideoSec * 1000) stopRecording()
    // stopRecording is stable enough for this guard; re-running on identity
    // would restart the check on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, recording, maxVideoSec])

  const takePhoto = useCallback(() => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return

    /*
     * The frame on screen, cut out of the frame the sensor sent.
     *
     * Two crops, one after the other and both centred: the ratio the composer
     * is going to show, then the zoom — which the lens has already applied
     * when it can, and which is this crop when it cannot. What comes out is
     * pixel for pixel what the viewfinder was showing.
     */
    const crop = zoomRange && !zoomRange.native ? zoom : 1
    const source = video.videoWidth / video.videoHeight
    let sw = source > ratio ? video.videoHeight * ratio : video.videoWidth
    let sh = source > ratio ? video.videoHeight : video.videoWidth / ratio
    sw /= crop
    sh /= crop
    const sx = (video.videoWidth - sw) / 2
    const sy = (video.videoHeight - sh) / 2

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(sw)
    canvas.height = Math.round(sh)
    const context = canvas.getContext('2d')
    if (!context) return
    // A front camera shows you a mirror; the photo should be what it saw.
    context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)

    setFlash(true)
    window.setTimeout(() => setFlash(false), 170)

    canvas.toBlob(
      (blob) => {
        if (!blob) return
        stop()
        onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.92,
    )
  }, [onCapture, ratio, stop, zoom, zoomRange])

  const startRecording = useCallback(() => {
    const stream = streamRef.current
    if (!stream || typeof MediaRecorder === 'undefined') return

    const type = [
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ].find((candidate) => MediaRecorder.isTypeSupported?.(candidate))

    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    chunksRef.current = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      const mimeType = recorder.mimeType || 'video/webm'
      const blob = new Blob(chunksRef.current, { type: mimeType })
      chunksRef.current = []
      if (blob.size === 0) return
      const extension = mimeType.includes('mp4') ? 'mp4' : 'webm'
      stop()
      onCapture(new File([blob], `clip-${Date.now()}.${extension}`, { type: mimeType }))
    }

    recorderRef.current = recorder
    recorder.start()
    setElapsed(0)
    setRecording(true)
  }, [onCapture, stop])

  function stopRecording() {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    recorder.stop()
    recorderRef.current = null
    setRecording(false)
  }

  /*
   * The self-timer. It counts down over the picture, and pressing the shutter
   * again during the count calls it off — a countdown you cannot cancel is a
   * countdown that makes people sprint back to the phone for a photo they have
   * already decided against.
   */
  const countdownRef = useRef<number | null>(null)

  const clearCountdown = useCallback(() => {
    if (countdownRef.current !== null) window.clearInterval(countdownRef.current)
    countdownRef.current = null
    setCountdown(null)
  }, [])

  const fire = useCallback(() => {
    if (mode === 'video') startRecording()
    else takePhoto()
  }, [mode, startRecording, takePhoto])

  /*
   * The shutter, and the only thing in this file that starts a capture.
   *
   * Choosing Video does not start a recording, and neither does anything else
   * on screen: a mode is a statement about what the shutter will do next, not
   * an instruction to do it now. The guard below is what makes that true even
   * when a device sends a pointer press and a synthesised click for the same
   * finger — the second one inside a third of a second is dropped rather than
   * quietly stopping the clip the first one started.
   */
  const lastPress = useRef(0)

  /*
   * Tap or hold, on one control.
   *
   * The hold timer starts on press. If it fires, this is a recording and the
   * lift stops it; if the lift comes first, it was a tap and the shutter takes
   * a photo. `heldRef` is what tells the two apart at lift time, and it is a
   * ref rather than state because the lift handler must read the value that is
   * true *now*, not the one from the render that installed it.
   */
  const holdTimer = useRef<number | null>(null)
  const heldRef = useRef(false)
  const [holding, setHolding] = useState(false)

  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
    holdTimer.current = null
    setHolding(false)
  }, [])

  const press = useCallback(() => {
    if (!ready) return
    const now = Date.now()
    if (now - lastPress.current < DEBOUNCE_MS) return
    lastPress.current = now

    if (recording) {
      stopRecording()
      return
    }
    if (countdownRef.current !== null) {
      clearCountdown()
      return
    }
    if (timer === 0) {
      fire()
      return
    }
    setCountdown(timer)
    countdownRef.current = window.setInterval(() => {
      setCountdown((left) => {
        if (left === null) return null
        if (left > 1) return left - 1
        clearCountdown()
        fire()
        return null
      })
    }, 1000)
  }, [clearCountdown, fire, ready, recording, timer])

  useEffect(() => clearCountdown, [clearCountdown])

  /** Press: arm the hold. Held long enough and it becomes a recording. */
  const onShutterDown = useCallback(() => {
    if (!ready || !canRecord) return
    heldRef.current = false
    setHolding(true)
    clearCountdown()
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null
      heldRef.current = true
      setMode('video')
      startRecording()
    }, HOLD_TO_RECORD_MS)
  }, [ready, canRecord, clearCountdown, startRecording])

  /** Lift: stop the recording it started, or take the photo it was. */
  const onShutterUp = useCallback(() => {
    const wasHeld = heldRef.current
    heldRef.current = false
    clearHold()
    if (wasHeld) {
      stopRecording()
      return
    }
    setMode('photo')
    press()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearHold, press])

  useEffect(() => clearHold, [clearHold])

  /*
   * Pinch to zoom, and tap to focus, on the picture itself.
   *
   * Two fingers is a pinch and the rail follows it. One finger that lands and
   * lifts without travelling is a focus point: it goes to the lens as a point
   * of interest and shows as a reticle where the finger was. The preview of a
   * front camera is mirrored, so the x the lens is told is mirrored back.
   */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; zoom: number } | null>(null)
  const tap = useRef<{ x: number; y: number; at: number } | null>(null)

  const spread = () => {
    const [a, b] = [...pointers.current.values()]
    if (!a || !b) return 0
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  const onStageDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Captured so the lift is heard even if the finger wanders off the frame;
    // an uncaptured pointer that ends elsewhere would sit in the map for ever
    // and turn the next single tap into half a pinch.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* Nothing to capture with — the tap still works, it just leaks a lift. */
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2 && zoomUsable) {
      pinch.current = { distance: spread(), zoom }
      tap.current = null
    } else if (pointers.current.size === 1) {
      tap.current = { x: event.clientX, y: event.clientY, at: Date.now() }
    }
  }

  const onStageMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pinch.current && pointers.current.size === 2) {
      const distance = spread()
      if (distance && pinch.current.distance) {
        setZoomTo(pinch.current.zoom * (distance / pinch.current.distance))
      }
      return
    }

    const start = tap.current
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) {
      tap.current = null
    }
  }

  const onStageUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null

    const start = tap.current
    tap.current = null
    if (!start || !focusSupported || !ready) return
    if (Date.now() - start.at > 700) return

    const box = stageRef.current?.getBoundingClientRect()
    if (!box) return
    const x = (event.clientX - box.left) / box.width
    const y = (event.clientY - box.top) / box.height
    if (x < 0 || x > 1 || y < 0 || y > 1) return

    setReticle({ x: event.clientX - box.left, y: event.clientY - box.top, at: Date.now() })
    void applyTrack(streamRef.current?.getVideoTracks()[0], {
      focusMode: 'single-shot',
      pointsOfInterest: [{ x: facing === 'user' ? 1 - x : x, y }],
    })
  }

  useEffect(() => {
    if (!reticle) return
    const clear = window.setTimeout(() => setReticle(null), 1100)
    return () => window.clearTimeout(clear)
  }, [reticle])

  /*
   * Zoom stops, not a slider: the steps a phone camera offers, filtered to the
   * ones this lens can reach. The active stop shows the live figure, so a
   * pinch to 2.8× has somewhere to read itself.
   */
  const stops = zoomRange
    ? [1, 2, 5, 10].filter((step) => step === 1 || step <= zoomRange.max / zoomRange.min)
    : []
  const progress = maxVideoSec ? Math.min(elapsed / (maxVideoSec * 1000), 1) : 0
  const RING = 2 * Math.PI * 45

  return createPortal(
    <div
      className={cx(styles.root, immersive && styles.immersive)}
      role="dialog"
      aria-modal="true"
      aria-label="Camera"
    >
      <header className={styles.top}>
        <button className={styles.iconButton} onClick={close} aria-label="Close camera">
          <X size={20} strokeWidth={2.2} />
        </button>

        {recording ? (
          <span className={styles.recording}>
            <span className={styles.dot} aria-hidden="true" />
            <span className="tnum">{clock(elapsed)}</span>
            {maxVideoSec ? <span className={styles.limit}>/ {maxVideoSec}s</span> : null}
          </span>
        ) : error ? null : (
          <div className={styles.tools}>
            {torchSupported ? (
              <button
                className={cx(styles.chip, torchOn && styles.chipOn)}
                onClick={toggleTorch}
                aria-pressed={torchOn}
                aria-label={torchOn ? 'Turn the light off' : 'Turn the light on'}
              >
                {torchOn ? (
                  <Zap size={17} strokeWidth={2.2} />
                ) : (
                  <ZapOff size={17} strokeWidth={2.2} />
                )}
              </button>
            ) : null}

            <button
              className={cx(styles.chip, grid && styles.chipOn)}
              onClick={() => setGrid((on) => !on)}
              aria-pressed={grid}
              aria-label="Framing grid"
            >
              <Grid3x3 size={17} strokeWidth={2.2} />
            </button>

            <button
              className={cx(styles.chip, timer !== 0 && styles.chipOn)}
              onClick={() =>
                setTimer((current) => TIMERS[(TIMERS.indexOf(current) + 1) % TIMERS.length])
              }
              aria-label={timer === 0 ? 'Self-timer off' : `Self-timer, ${timer} seconds`}
            >
              {timer === 0 ? (
                <TimerOff size={17} strokeWidth={2.2} />
              ) : (
                <>
                  <Timer size={17} strokeWidth={2.2} />
                  <span className={styles.chipLabel}>{timer}</span>
                </>
              )}
            </button>
          </div>
        )}
      </header>

      {/*
        The viewfinder. The measured area holds the frame, the frame holds the
        picture and everything drawn over it, and the frame is exactly the
        shape of the file this will produce.
      */}
      <div className={styles.area} ref={areaRef}>
        <div
          ref={stageRef}
          className={cx(styles.frame, recording && styles.frameRecording)}
          style={{ width: frameWidth || undefined, height: frameHeight || undefined }}
          onPointerDown={onStageDown}
          onPointerMove={onStageMove}
          onPointerUp={onStageUp}
          onPointerCancel={(event) => {
            pointers.current.delete(event.pointerId)
            pinch.current = null
            tap.current = null
          }}
        >
          <video
            ref={videoRef}
            className={cx(styles.preview, facing === 'user' && styles.mirrored)}
            style={
              zoomRange && !zoomRange.native && zoom !== 1
                ? { transform: `${facing === 'user' ? 'scaleX(-1) ' : ''}scale(${zoom})` }
                : undefined
            }
            onLoadedMetadata={(event) =>
              setSensor({
                width: event.currentTarget.videoWidth,
                height: event.currentTarget.videoHeight,
              })
            }
            playsInline
            muted
            autoPlay
          />

          {grid ? <div className={styles.grid} aria-hidden="true" /> : null}

          {reticle ? (
            <span
              key={reticle.at}
              className={styles.reticle}
              style={{ left: reticle.x, top: reticle.y }}
              aria-hidden="true"
            />
          ) : null}

          {countdown !== null ? (
            <div className={styles.countdown} aria-live="assertive">
              {countdown}
            </div>
          ) : null}

          {flash ? <div className={styles.flashFrame} aria-hidden="true" /> : null}

          {zoomUsable && stops.length > 1 && countdown === null && ready && !error ? (
            <div className={styles.zoom} role="group" aria-label="Zoom">
              {stops.map((step) => {
                const active = Math.abs(factor - step) < 0.12
                // A stop reads as a whole number until a pinch takes it off one.
                const shown =
                  active && Math.abs(factor - Math.round(factor)) > 0.05
                    ? factor.toFixed(1)
                    : String(active ? Math.round(factor) : step)
                return (
                  <button
                    key={step}
                    className={cx(styles.zoomStep, active && styles.zoomOn)}
                    onClick={() => setZoomTo((zoomRange?.min ?? 1) * step)}
                    aria-label={`Zoom ${step} times`}
                  >
                    {shown}
                    <span className={styles.times}>×</span>
                  </button>
                )
              })}
            </div>
          ) : null}

          {error ? (
            <div className={styles.problem}>
              <p className={styles.problemText}>{error}</p>
              {onChooseInstead ? (
                <Button
                  variant="secondary"
                  icon={<Images size={16} strokeWidth={2.1} />}
                  onClick={() => {
                    stop()
                    onChooseInstead()
                  }}
                >
                  Choose from device
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <footer className={styles.console}>
        {/*
          What the shutter will do, said in one word. Choosing here changes
          nothing but that: the recording starts when the shutter is pressed.
        */}
        {holdToRecord ? (
          /*
            No Photo/Video rail here on purpose: one shutter does both, so
            there is nothing to choose in advance. The line says how.
          */
          <p className={styles.hint} aria-live="polite">
            {recording ? 'Release to stop' : holding ? 'Keep holding…' : 'Tap for a photo · hold to record'}
          </p>
        ) : canRecord && !recording ? (
          <div className={styles.modes} role="group" aria-label="Capture mode">
            {/*
              The lit word rides on a pill that slides between the two, so the
              selected mode is legible at a glance and in greyscale. Choosing
              here changes what the shutter will do and nothing else.
            */}
            <span
              className={cx(styles.modeThumb, mode === 'video' && styles.modeThumbRight)}
              aria-hidden="true"
            />
            <button
              className={cx(styles.mode, mode === 'photo' && styles.modeOn)}
              onClick={() => setMode('photo')}
              aria-pressed={mode === 'photo'}
            >
              Photo
            </button>
            <button
              className={cx(styles.mode, mode === 'video' && styles.modeOn)}
              onClick={() => setMode('video')}
              aria-pressed={mode === 'video'}
            >
              Video
            </button>
          </div>
        ) : recording ? (
          <p className={styles.recordingHint}>Tap again to stop</p>
        ) : null}

        <div className={styles.row}>
          {onChooseInstead ? (
            <button
              className={styles.libraryButton}
              onClick={() => {
                stop()
                onChooseInstead()
              }}
              disabled={recording}
              aria-label="Choose from device instead"
            >
              <Images size={20} strokeWidth={2} />
            </button>
          ) : (
            <span className={styles.sideSpacer} aria-hidden="true" />
          )}

          <div className={styles.shutterWrap}>
            <svg className={styles.ring} viewBox="0 0 100 100" aria-hidden="true">
              <circle className={styles.ringTrack} cx="50" cy="50" r="45" />
              {recording && maxVideoSec ? (
                <circle
                  className={styles.ringHead}
                  cx="50"
                  cy="50"
                  r="45"
                  style={{ strokeDasharray: RING, strokeDashoffset: RING * (1 - progress) }}
                />
              ) : null}
            </svg>

            <button
              className={styles.shutter}
              /*
                Pointer events, not click, when one control has to tell a tap
                from a hold — `click` only ever arrives after the lift and
                cannot say how long the finger was down.
              */
              {...(holdToRecord
                ? {
                    onPointerDown: onShutterDown,
                    onPointerUp: onShutterUp,
                    onPointerCancel: () => {
                      if (heldRef.current) stopRecording()
                      heldRef.current = false
                      clearHold()
                    },
                    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
                  }
                : { onClick: press })}
              disabled={!ready}
              aria-label={
                recording
                  ? 'Stop recording'
                  : holdToRecord
                    ? 'Take a photo, or hold to record'
                    : mode === 'video'
                      ? 'Start recording'
                      : 'Take a photo'
              }
            >
              <span
                className={cx(
                  styles.core,
                  !holdToRecord && mode === 'video' && !recording && styles.coreVideo,
                  holding && !recording && styles.coreArming,
                  recording && styles.coreRecording,
                )}
              />
            </button>
          </div>

          {multipleCameras ? (
            <button
              className={styles.flipButton}
              onClick={() => setFacing((current) => (current === 'user' ? 'environment' : 'user'))}
              disabled={recording}
              aria-label="Switch camera"
            >
              <SwitchCamera size={20} strokeWidth={2} />
            </button>
          ) : (
            <span className={styles.sideSpacer} aria-hidden="true" />
          )}
        </div>
      </footer>
    </div>,
    document.body,
  )
}
