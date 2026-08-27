import { useId, useRef, useState } from 'react'
import { ImagePlus, Trash2, X } from 'lucide-react'
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
 * The preview is the real thing: the same `StoryFrame` the viewer draws, at
 * story proportions, updating as you type. Nothing is written until Share is
 * pressed, so cancelling costs a revoked object URL and nothing else.
 *
 * The picture is a reference the whole way down — the file becomes an object
 * URL owned by `useTempImage`, and publishing hands that ownership over so
 * closing the sheet no longer revokes what the rail is now showing. No bytes
 * reach the database, which is the rule `mediaService` exists to enforce.
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
  const fileInput = useRef<HTMLInputElement>(null)
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
    show('Added to your story. It is gone in 24 hours.', 'success')
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

  return (
    <>
      {/* Exactly what the group will see, at the shape they will see it in. */}
      <div className={styles.preview}>
        <StoryFrame story={{ type: previewAsset ? 'photo' : 'text', text }} media={previewAsset} />
        {previewAsset ? (
          <button className={styles.removeImage} onClick={clearImage} aria-label="Remove photo">
            <X size={15} strokeWidth={2.4} />
          </button>
        ) : null}
        {!hasDraft ? <p className={styles.placeholder}>Your story appears here.</p> : null}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className={styles.file}
        onChange={(event) => {
          void pick(event.target.files?.[0])
          // Reset, so picking the same file twice in a row still fires.
          event.target.value = ''
        }}
      />
      <Button
        variant="secondary"
        icon={<ImagePlus size={16} strokeWidth={2.1} />}
        onClick={() => fileInput.current?.click()}
      >
        {previewAsset ? 'Change photo' : 'Add a photo'}
      </Button>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={textId}>
          {previewAsset ? 'Caption' : 'Say something'}
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

      <p className={styles.note}>
        {previewAsset
          ? 'Shared with the group and gone in 24 hours. The photo is referenced, never copied into the app — it stays on this device and will not survive a reload until cloud storage arrives.'
          : 'Shared with the group and gone in 24 hours.'}
      </p>

      <Button size="lg" block onClick={share} disabled={!canShare || saving}>
        {saving ? 'Sharing…' : 'Share story'}
      </Button>

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
          icon={hasDraft ? <Trash2 size={15} strokeWidth={2.1} /> : undefined}
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
