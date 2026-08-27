import { useId, useRef, useState } from 'react'
import { Camera, ImagePlus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { StoryFrame } from './StoryFrame'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useTempImage } from '@/hooks/useTempImage'
import { storyService } from '@/services'
import type { MediaAsset } from '@/models'
import styles from './StoryComposer.module.css'

/** A story is a glance, not an essay. */
const MAX_LENGTH = 140

/** Bigger than any phone photo worth attaching; a guard, not a target. */
const MAX_BYTES = 20 * 1024 * 1024

/**
 * Making a story.
 *
 * The preview leads and everything else serves it: a 9:16 stage at the top
 * drawn by the same `StoryFrame` the viewer uses, then the two ways to put a
 * picture in it, then the words. That order is the whole design — this is a
 * thing you look at, not a record you fill in, and the previous layout put a
 * text field first and the picture last, which is backwards.
 *
 * Two capture paths, because a phone has two. `capture="environment"` asks the
 * browser for the camera directly; a device or browser that cannot honour it
 * simply opens the file picker instead, which is why the fallback needs no
 * detection and no permission prompt of our own. Either way the file arrives
 * through the same handler and becomes the preview immediately — there is no
 * second "now upload it" step.
 *
 * The picture stays a reference the whole way down. The file becomes an object
 * URL owned by `useTempImage`, and publishing hands that ownership over so
 * closing the sheet no longer revokes what the rail is showing. No bytes reach
 * the database.
 */
export function StoryComposer({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<{ mimeType: string; width?: number; height?: number } | null>(
    null,
  )
  const [saving, setSaving] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const cameraInput = useRef<HTMLInputElement>(null)
  const libraryInput = useRef<HTMLInputElement>(null)
  const textId = useId()

  // The preview URL, and the only thing that owns it until the story lands.
  const preview = useTempImage()

  if (!user) return null

  const hasDraft = text.trim().length > 0 || preview.url !== null
  const canShare = hasDraft

  const pick = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      show('That file is not an image.', 'error')
      return
    }
    if (file.size > MAX_BYTES) {
      show('That image is too large.', 'error')
      return
    }
    const url = preview.set(file)
    const size = await measure(url).catch(() => undefined)
    setPicked({ mimeType: file.type, width: size?.width, height: size?.height })
  }

  const clearImage = () => {
    preview.release()
    setPicked(null)
  }

  const share = async () => {
    if (!canShare || saving) return
    setSaving(true)

    const media =
      preview.url && picked
        ? {
            kind: 'image' as const,
            ref: preview.url,
            mimeType: picked.mimeType,
            width: picked.width,
            height: picked.height,
          }
        : undefined

    const created = await guard(() => storyService.create({ userId: user.id, text, media }))
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
          kind: 'image',
          ref: preview.url,
          mimeType: picked.mimeType,
          width: picked.width,
          height: picked.height,
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
        <StoryFrame story={{ type: previewAsset ? 'photo' : 'text', text }} media={previewAsset} />
        {!hasDraft ? (
          <p className={styles.placeholder}>
            Take a photo, pick one, or just say something.
          </p>
        ) : null}
        {previewAsset ? (
          <button className={styles.clear} onClick={clearImage} aria-label="Remove photo">
            <Trash2 size={15} strokeWidth={2.2} />
          </button>
        ) : null}
      </div>

      {/*
        `capture` asks for the camera; a desktop browser that cannot honour it
        opens the file picker instead, which is the fallback working rather
        than a feature failing.
      */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className={styles.file}
        onChange={onFile}
      />
      <input
        ref={libraryInput}
        type="file"
        accept="image/*"
        className={styles.file}
        onChange={onFile}
      />

      <div className={styles.capture}>
        <button className={styles.captureButton} onClick={() => cameraInput.current?.click()}>
          <span className={styles.captureIcon}>
            {previewAsset ? (
              <RefreshCw size={20} strokeWidth={2} />
            ) : (
              <Camera size={20} strokeWidth={2} />
            )}
          </span>
          {previewAsset ? 'Retake' : 'Take photo'}
        </button>
        <button className={styles.captureButton} onClick={() => libraryInput.current?.click()}>
          <span className={styles.captureIcon}>
            <ImagePlus size={20} strokeWidth={2} />
          </span>
          {previewAsset ? 'Change' : 'Add photo'}
        </button>
      </div>

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

/** The picked image's natural size, read from the preview URL. */
function measure(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('decode_failed'))
    image.src = url
  })
}
