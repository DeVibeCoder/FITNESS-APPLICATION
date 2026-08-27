import { useId, useRef, useState } from 'react'
import { ImagePlus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { OptionGroup } from '@/components/ui/Field'
import { MediaFrame } from './MediaFrame'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useTempImage } from '@/hooks/useTempImage'
import { postService, DEFAULT_VISIBILITY } from '@/services'
import type { FeedPost } from '@/services/postService'
import type { MediaAsset, Visibility } from '@/models'
import styles from './PostComposer.module.css'

/** Long enough for a real thought, short enough to still be a post. */
const MAX_LENGTH = 600

/** Bigger than any phone photo worth attaching; a guard, not a target. */
const MAX_BYTES = 20 * 1024 * 1024

/**
 * Who a post is for, in the two answers this app actually has.
 *
 * `public` exists in the model so the type does not have to change when a
 * shareable link arrives, and it is deliberately not offered here — a choice
 * that does nothing yet would be a promise the app cannot keep.
 */
const VISIBILITY_OPTIONS: { value: Visibility; label: string }[] = [
  { value: 'group', label: 'The group' },
  { value: 'private', label: 'Only me' },
]

/**
 * Writing a post, and editing one.
 *
 * The same component for both because they are the same decisions: the words,
 * the picture, who can see it. Editing simply starts with them filled in and
 * writes through `update` instead of `create`.
 *
 * It does not know what a workout is, and that is deliberate. Sharing a record
 * runs the other way: the card that already holds the numbers turns them into
 * a sentence and opens this with the sentence in the box. A composer that
 * picked records was a second, worse way to look up your own data, sitting in
 * the one place nobody was looking for it.
 *
 * The picture is a reference the whole way down. The file is never read into
 * the database — it becomes an object URL owned by `useTempImage`, and posting
 * hands that ownership over so closing the composer no longer revokes it. When
 * object storage arrives the only thing that changes is what `ref` holds; this
 * file does not have to know.
 */
export function PostComposer({
  post,
  initialText,
  onDone,
  onCancel,
}: {
  /** Present when editing an existing post. */
  post?: FeedPost
  /** Words a Share action prepared. The person edits them from here. */
  initialText?: string
  onDone: () => void
  onCancel: () => void
}) {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const editing = Boolean(post)

  const [text, setText] = useState(post?.text ?? initialText ?? '')
  const [visibility, setVisibility] = useState<Visibility>(post?.visibility ?? DEFAULT_VISIBILITY)
  const [saving, setSaving] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  /** The picture the post already had, until the person removes it. */
  const [keptMedia, setKeptMedia] = useState<MediaAsset | undefined>(post?.media[0])
  const [picked, setPicked] = useState<{ mimeType: string; width?: number; height?: number } | null>(
    null,
  )
  const fileInput = useRef<HTMLInputElement>(null)
  const textId = useId()

  // The preview URL, and the only thing that owns it. Posting hands it over;
  // anything else — cancelling, closing, unmounting — revokes it.
  const preview = useTempImage()

  /*
   * The draft is seeded once, from the props, and never re-seeded.
   *
   * That matters more than it looks: the feed is a live query, so `post` is a
   * new object every time anybody reacts to anything. Syncing state back from
   * it would wipe what someone was halfway through typing. The composer is
   * mounted fresh each time the sheet opens, which is what makes a single
   * initialisation correct.
   */

  if (!user) return null

  const hasDraft =
    text.trim() !== (post?.text ?? initialText ?? '') ||
    preview.url !== null ||
    keptMedia?.id !== post?.media[0]?.id ||
    visibility !== (post?.visibility ?? DEFAULT_VISIBILITY)

  const canPost = Boolean(text.trim() || preview.url || keptMedia || post?.sharedType)

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
    // Measured from the preview rather than by decoding the file a second
    // time. The card needs it to know whether to draw the frame tall or wide.
    const size = await measure(url).catch(() => undefined)
    setPicked({ mimeType: file.type, width: size?.width, height: size?.height })
    // A new picture replaces the old one rather than sitting beside it.
    setKeptMedia(undefined)
  }

  const clearImage = () => {
    preview.release()
    setPicked(null)
    setKeptMedia(undefined)
  }

  const submit = async () => {
    if (!canPost || saving) return
    setSaving(true)

    const media =
      preview.url && picked
        ? { kind: 'image' as const, ref: preview.url, mimeType: picked.mimeType, width: picked.width, height: picked.height }
        : undefined

    if (editing && post) {
      const result = await guard(() =>
        postService.update(post.id, {
          text,
          visibility,
          // Left out entirely when the picture is untouched, so an edit to the
          // words cannot quietly re-register the same image.
          media: media ?? (keptMedia ? undefined : post.media.length > 0 ? null : undefined),
        }),
      )
      setSaving(false)
      if (result === undefined) return
      if (media) preview.detach()
      show('Post updated.', 'success')
      onDone()
      return
    }

    const created = await guard(() =>
      postService.create({ userId: user.id, text, visibility, media }),
    )
    setSaving(false)
    // The draft survives a failed write — losing what somebody typed is worse
    // than leaving it on screen to try again.
    if (!created) return

    if (media) preview.detach()
    setText('')
    setPicked(null)
    show(visibility === 'private' ? 'Saved, just for you.' : 'Posted to the group.', 'success')
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
      : keptMedia

  return (
    <>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={textId}>
          {editing ? 'Your post' : "What's going on?"}
        </label>
        <textarea
          id={textId}
          className={styles.textarea}
          value={text}
          rows={4}
          maxLength={MAX_LENGTH}
          placeholder="Say something to the group…"
          onChange={(event) => setText(event.target.value)}
        />
        {remaining <= 100 ? (
          <p className={`${styles.counter} tnum`}>{remaining} left</p>
        ) : null}
      </div>

      {previewAsset ? (
        <div className={styles.preview}>
          <MediaFrame asset={previewAsset} />
          <button className={styles.removeImage} onClick={clearImage} aria-label="Remove photo">
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>
      ) : null}

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
      {previewAsset?.temporary ? (
        <p className={styles.note}>
          The photo is referenced, never copied into the app — it stays on this device and will not
          survive a reload until cloud storage arrives.
        </p>
      ) : null}

      {editing && post?.sharedType ? (
        <p className={styles.note}>The record this post shares stays attached.</p>
      ) : null}

      <OptionGroup
        label="Who can see this"
        value={visibility}
        options={VISIBILITY_OPTIONS}
        onChange={setVisibility}
      />

      <Button size="lg" block onClick={submit} disabled={!canPost || saving}>
        {saving ? 'Posting…' : editing ? 'Save changes' : 'Post'}
      </Button>

      {confirmDiscard ? (
        <div className={styles.confirm}>
          <p className={styles.confirmText}>Discard this post? What you wrote will be lost.</p>
          <div className={styles.confirmRow}>
            <Button variant="secondary" onClick={() => setConfirmDiscard(false)}>
              Keep writing
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
