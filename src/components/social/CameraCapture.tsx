import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, CircleStop, Images, SwitchCamera, Video, X } from 'lucide-react'
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
 * Deliberately not a camera app. No filters, no zoom, no grid, no torch: a
 * preview, a shutter, a way to record, a way to flip, and a way out. What it
 * does need to be is honest — a denied permission says so and offers the
 * library instead of leaving somebody staring at a black rectangle.
 *
 * Nothing is written anywhere. The captured blob lives in memory, becomes a
 * File, and goes straight to the composer that opened this.
 */
export function CameraCapture({
  onCapture,
  onClose,
  onChooseInstead,
  allowVideo = true,
  maxVideoSec,
}: {
  onCapture: (file: File) => void
  onClose: () => void
  /** Offered when the camera cannot be used at all. */
  onChooseInstead?: () => void
  allowVideo?: boolean
  /** Recording stops itself here. Stories pass 60; posts pass nothing. */
  maxVideoSec?: number
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [multipleCameras, setMultipleCameras] = useState(false)

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

  /*
   * Opening the camera, and re-opening it when the person flips it.
   *
   * Audio is requested alongside video because a recorded clip with no sound
   * is a clip somebody will re-record. A device that refuses audio still gets
   * a camera: the retry drops the audio ask rather than failing outright.
   */
  useEffect(() => {
    let cancelled = false

    const start = async () => {
      setReady(false)
      setError(null)
      stop()

      const media = navigator.mediaDevices
      if (!media?.getUserMedia) {
        setError('This browser will not give the page a camera.')
        return
      }

      const attempts: MediaStreamConstraints[] = [
        { video: { facingMode: facing }, audio: allowVideo },
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

  // The recording clock, and the limit that stops it on its own.
  useEffect(() => {
    if (!recording) return
    const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000)
    return () => window.clearInterval(timer)
  }, [recording])

  useEffect(() => {
    if (recording && maxVideoSec && elapsed >= maxVideoSec) stopRecording()
    // stopRecording is stable enough for this guard; re-running on identity
    // would restart the check on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, recording, maxVideoSec])

  const takePhoto = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) return
    // A front camera shows you a mirror; the photo should be what it saw.
    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    canvas.toBlob(
      (blob) => {
        if (!blob) return
        stop()
        onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.92,
    )
  }

  const startRecording = () => {
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
  }

  function stopRecording() {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    recorder.stop()
    recorderRef.current = null
    setRecording(false)
  }

  const canRecord = allowVideo && typeof MediaRecorder !== 'undefined'

  return createPortal(
    <div className={styles.root} role="dialog" aria-modal="true" aria-label="Camera">
      <video
        ref={videoRef}
        className={[styles.preview, facing === 'user' ? styles.mirrored : '']
          .filter(Boolean)
          .join(' ')}
        playsInline
        muted
        autoPlay
      />

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

      <header className={styles.top}>
        <button className={styles.iconButton} onClick={close} aria-label="Close camera">
          <X size={20} strokeWidth={2.2} />
        </button>
        {recording ? (
          <span className={styles.recording}>
            <span className={styles.dot} aria-hidden="true" />
            <span className="tnum">
              {String(Math.floor(elapsed / 60)).padStart(2, '0')}:
              {String(elapsed % 60).padStart(2, '0')}
            </span>
            {maxVideoSec ? <span className={styles.limit}>/ {maxVideoSec}s</span> : null}
          </span>
        ) : null}
        {multipleCameras && !recording ? (
          <button
            className={styles.iconButton}
            onClick={() => setFacing((current) => (current === 'user' ? 'environment' : 'user'))}
            aria-label="Switch camera"
          >
            <SwitchCamera size={20} strokeWidth={2.1} />
          </button>
        ) : (
          <span className={styles.iconSpacer} aria-hidden="true" />
        )}
      </header>

      <footer className={styles.controls}>
        {/*
          One shutter and one record button, and never a mode switch: a person
          who wants a photo presses the round one and a person who wants a clip
          holds the other. A mode you can be in the wrong one of is the main
          way camera interfaces waste people's time.
        */}
        {canRecord ? (
          <button
            className={[styles.record, recording ? styles.recordOn : ''].filter(Boolean).join(' ')}
            onClick={recording ? stopRecording : startRecording}
            disabled={!ready}
            aria-label={recording ? 'Stop recording' : 'Record a video'}
          >
            {recording ? (
              <CircleStop size={22} strokeWidth={2.2} />
            ) : (
              <Video size={22} strokeWidth={2.2} />
            )}
          </button>
        ) : (
          <span className={styles.iconSpacer} aria-hidden="true" />
        )}

        <button
          className={styles.shutter}
          onClick={takePhoto}
          disabled={!ready || recording}
          aria-label="Take a photo"
        >
          <Camera size={24} strokeWidth={2} />
        </button>

        {onChooseInstead ? (
          <button
            className={styles.iconButton}
            onClick={() => {
              stop()
              onChooseInstead()
            }}
            aria-label="Choose from device instead"
          >
            <Images size={20} strokeWidth={2.1} />
          </button>
        ) : (
          <span className={styles.iconSpacer} aria-hidden="true" />
        )}
      </footer>
    </div>,
    document.body,
  )
}
