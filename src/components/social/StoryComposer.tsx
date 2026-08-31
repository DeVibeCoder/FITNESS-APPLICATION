import { useId, useRef, useState } from 'react'
import { Camera, Images, Trash2, Video } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CameraCapture } from './CameraCapture'
import { StoryFrame, STORY_BACKGROUNDS, DEFAULT_STORY_BACKGROUND } from './StoryFrame'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useTempImage } from '@/hooks/useTempImage'
import { storyService } from '@/services'
import {
  describeMedia,
  PICK_MESSAGE,
  reject,
  STORY_VIDEO_MAX_SEC,
  withinStoryLimit,
  type PickedMedia,
} from '@/lib/mediaPick'
import type { MediaAsset, StoryBackground } from '@/models'
import styles from './StoryComposer.module.css'

/** A story is a glance, not an essay. */
const MAX_LENGTH = 140

/**
 * Making a story.
 *
 * The preview leads and everything else serves it: a 9:16 stage at the top
 * drawn by the same `StoryFrame` the viewer uses, then the two ways to fill
 * it, then the words. This is a thing you look at, not a record you fill in.
 *
 * Two ways in, and they are genuinely different things. "Take photo or video"
 * opens the app's own camera through `getUserMedia`; "Photos & videos" opens
 * the file picker. The old `capture` attribute on a file input was neither —
 * it is a hint the picker may offer a camera, and on most devices it simply
 * opened the gallery under a button labelled Camera.
 *
 * A clip over a minute is refused before anything is written, and the reason
 * is stated in the composer rather than in a toast that scrolls away. There is
 * no trimming: cutting somebody's video for them, in a browser, without ever
 * having read the bytes, is not a thing to do quietly.
 *
 * Media stays a reference the whole way down. The file becomes an object URL
 * owned by `useTempImage`, and publishing hands that ownership over so closing
 * the sheet no longer revokes what the rail is showing.
 */
export function StoryComposer({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<PickedMedia | null>(null)
  const [background, setBackground] = useState<StoryBackground>(DEFAULT_STORY_BACKGROUND)
  const [saving, setSaving] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  /** `null` is closed; the value is the mode the camera opens armed in. */
  const [cameraOpen, setCameraOpen] = useState<'photo' | 'video' | null>(null)
  const libraryInput = useRef<HTMLInputElement>(null)
  const textId = useId()

  // The preview URL, and the only thing that owns it until the story lands.
  const preview = useTempImage()

  if (!user) return null

  const tooLong = Boolean(picked && !withinStoryLimit(picked))
  const hasDraft = text.trim().length > 0 || preview.url !== null
  const canShare = hasDraft && !tooLong

  const pick = async (file: File | undefined) => {
    if (!file) return
    const problem = reject(file)
    if (problem) {
      show(PICK_MESSAGE[problem], 'error')
      return
    }
    const url = preview.set(file)
    setPicked(await describeMedia(file, url))
  }

  const clearMedia = () => {
    preview.release()
    setPicked(null)
  }

  const share = async () => {
    if (!canShare || saving) return
    setSaving(true)

    const media =
      preview.url && picked
        ? {
            kind: picked.kind,
            ref: preview.url,
            mimeType: picked.mimeType,
            width: picked.width,
            height: picked.height,
            durationSec: picked.durationSec,
          }
        : undefined

    const created = await guard(() =>
      storyService.create({
        userId: user.id,
        text,
        media,
        // Only meaningful without media, and the service drops it otherwise.
        background: media ? undefined : background,
      }),
    )
    setSaving(false)
    // The draft survives a failed write rather than vanishing with it.
    if (!created) return

    if (media) preview.detach()
    setText('')
    setPicked(null)
    show('Added to your story. Gone in 24 hours.', 'success')
    onDone()
  }

  const discard = () => {
    preview.release()
    onCancel()
  }

  const remaining = MAX_LENGTH - text.length
  const previewAsset: MediaAsset | undefined =
    preview.url && picked
      ? {
          id: 'draft',
          kind: picked.kind,
          ref: preview.url,
          mimeType: picked.mimeType,
          width: picked.width,
          height: picked.height,
          durationSec: picked.durationSec,
          temporary: true,
          createdAt: '',
        }
      : undefined

  /** Both inputs behave identically once a file exists; only the ask differs. */
  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    void pick(event.target.files?.[0])
    // Reset, so picking the same file twice in a row still fires.
    event.target.value = ''
  }

  return (
    <>
      {/* Exactly what the group will see, at the shape they will see it in. */}
      <div className={styles.stage}>
        <StoryFrame
          story={{ type: previewAsset ? 'photo' : 'text', text, background }}
          media={previewAsset}
          compact
        />
        {!hasDraft ? (
          <p className={styles.placeholder}>Take something, pick something, or just say it.</p>
        ) : null}
        {previewAsset ? (
          <button className={styles.clear} onClick={clearMedia} aria-label="Remove media">
            <Trash2 size={15} strokeWidth={2.2} />
          </button>
        ) : null}
      </div>

      {tooLong ? (
        <p className={styles.limit} role="alert">
          That clip is {picked?.durationSec}s. A story can be up to {STORY_VIDEO_MAX_SEC} seconds —
          pick a shorter one, or trim it before choosing it.
        </p>
      ) : null}

      <input
        ref={libraryInput}
        type="file"
        accept="image/*,video/*"
        className={styles.file}
        onChange={onFile}
      />

      {/*
        A camera strip, not a pair of upload buttons.

        Three small controls on one row: photo, video, and the library. They
        are deliberately compact — a story is made with the camera, so the
        stage above is the screen and these are the way in, not the subject.
        Photo and Video open the same camera in different modes; choosing
        Video arms the shutter and starts nothing, which is the whole point of
        a mode being a mode.
      */}
      <div className={styles.capture} role="group" aria-label="Add to your story">
        <button
          className={`${styles.captureButton} ${styles.captureLead}`}
          onClick={() => setCameraOpen('photo')}
        >
          <Camera size={17} strokeWidth={2.1} />
          Photo
        </button>
        <button className={styles.captureButton} onClick={() => setCameraOpen('video')}>
          <Video size={17} strokeWidth={2.1} />
          Video
        </button>
        <button
          className={styles.captureButton}
          onClick={() => libraryInput.current?.click()}
          aria-label="Choose from device"
        >
          <Images size={17} strokeWidth={2.1} />
          Upload
        </button>
      </div>

      {cameraOpen ? (
        <CameraCapture
          // A story is 9:16 everywhere it is shown, so it is 9:16 in the
          // viewfinder too — what is framed here is what the story will be,
          // rather than something the story frame crops the sides off later.
          frame="story"
          initialMode={cameraOpen}
          maxVideoSec={STORY_VIDEO_MAX_SEC}
          onCapture={(file) => {
            setCameraOpen(null)
            void pick(file)
          }}
          onClose={() => setCameraOpen(null)}
          onChooseInstead={() => {
            setCameraOpen(null)
            libraryInput.current?.click()
          }}
        />
      ) : null}

      {/*
        Only when there is no media. A picture is its own background, and
        offering a colour that will never be painted is offering a lie.
      */}
      {previewAsset ? null : (
        <fieldset className={styles.grounds}>
          <legend className={styles.label}>Background</legend>
          <div className={styles.groundRow}>
            {STORY_BACKGROUNDS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-label={option.label}
                aria-pressed={background === option.value}
                className={[
                  styles.ground,
                  styles[option.value],
                  background === option.value ? styles.groundOn : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setBackground(option.value)}
              />
            ))}
          </div>
        </fieldset>
      )}

      <div className={styles.field}>
        <label className={styles.label} htmlFor={textId}>
          {previewAsset ? 'Caption' : 'Your words'}
        </label>
        <textarea
          id={textId}
          className={styles.textarea}
          value={text}
          rows={2}
          maxLength={MAX_LENGTH}
          placeholder={previewAsset ? 'Optional' : 'Leg day. Pray for me 😅'}
          onChange={(event) => setText(event.target.value)}
        />
        {remaining <= 40 ? <p className={`${styles.counter} tnum`}>{remaining} left</p> : null}
      </div>

      <Button size="lg" block onClick={share} disabled={!canShare || saving}>
        {saving ? 'Sharing…' : 'Share to your story'}
      </Button>
      <p className={styles.note}>Your group only. Gone in 24 hours.</p>

      {confirmDiscard ? (
        <div className={styles.confirm}>
          <p className={styles.confirmText}>Discard this story? What you made will be lost.</p>
          <div className={styles.confirmRow}>
            <Button variant="secondary" onClick={() => setConfirmDiscard(false)}>
              Keep making it
            </Button>
            <Button variant="danger" onClick={discard}>
              Discard
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          onClick={() => (hasDraft ? setConfirmDiscard(true) : discard())}
          disabled={saving}
        >
          {hasDraft ? 'Discard' : 'Cancel'}
        </Button>
      )}
    </>
  )
}
