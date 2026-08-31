import { useId, useRef, useState } from 'react'
import { Camera, Images, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { OptionGroup } from '@/components/ui/Field'
import { CameraCapture } from './CameraCapture'
import { MediaFrame } from './MediaFrame'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useTempImage } from '@/hooks/useTempImage'
import { postService, DEFAULT_VISIBILITY } from '@/services'
import { describeMedia, PICK_MESSAGE, reject, type PickedMedia } from '@/lib/mediaPick'
import type { FeedPost } from '@/services/postService'
import type { MediaAsset, Visibility } from '@/models'
import styles from './PostComposer.module.css'

/** Long enough for a real thought, short enough to still be a post. */
const MAX_LENGTH = 600

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
  /** The media the post already had, until the person removes it. */
  const [keptMedia, setKeptMedia] = useState<MediaAsset | undefined>(post?.media[0])
  const [picked, setPicked] = useState<PickedMedia | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const libraryInput = useRef<HTMLInputElement>(null)
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
    const problem = reject(file)
    if (problem) {
      show(PICK_MESSAGE[problem], 'error')
      return
    }
    const url = preview.set(file)
    // Measured from the preview rather than by decoding the file a second
    // time. The card needs it to know what shape to reserve.
    setPicked(await describeMedia(file, url))
    // New media replaces the old rather than sitting beside it.
    setKeptMedia(undefined)
  }

  const clearImage = () => {
    preview.release()
    setPicked(null)
    setKeptMedia(undefined)
  }

  /** Both inputs behave identically once a file exists; only the ask differs. */
  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    void pick(event.target.files?.[0])
    // Reset, so picking the same file twice in a row still fires.
    event.target.value = ''
  }

  const submit = async () => {
    if (!canPost || saving) return
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
      postService.create({
        userId: user.id,
        text,
        visibility,
        media,
      }),
    )
    setSaving(false)
    // The draft survives a failed write — losing what somebody typed is worse
    // than leaving it on screen to try again.
    if (!created) return

    if (media) preview.detach()
    setText('')
    setPicked(null)
    show(
      visibility === 'private' ? 'Saved, just for you.' : 'Posted to the group.',
      'success',
    )
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

      {/*
        What will actually be posted, at the shape it actually is.

        `contain` rather than the feed's crop: this is the check before
        pressing Post, and a preview that quietly cuts the top off the picture
        is the one thing it must not do. `eager` is what makes it appear at
        all — see MediaFrame. A clip gets real controls, because "is this the
        right video" is not a question a still frame answers.
      */}
      {previewAsset ? (
        <div className={styles.preview}>
          <MediaFrame
            asset={previewAsset}
            natural
            contain
            eager
            controls={previewAsset.kind === 'video'}
          />
          <button className={styles.removeImage} onClick={clearImage} aria-label="Remove media">
            <X size={15} strokeWidth={2.4} />
          </button>
          <span className={styles.previewKind}>
            {previewAsset.kind === 'video' ? 'Video' : 'Photo'}
          </span>
        </div>
      ) : null}

      {/*
        Two ways in, and genuinely two different things: the app's own camera
        through getUserMedia, or the file picker. See CameraCapture for why the
        `capture` attribute was never actually the camera.
      */}
      <input
        ref={libraryInput}
        type="file"
        accept="image/*,video/*"
        className={styles.file}
        onChange={onFile}
      />

      {/*
        An attach row, not a pair of cards.

        A post is words with something attached; a story is a camera with words
        after. So this sits under the box as two small chips with the label
        beside the glyph, and New Story gets the camera strip — the two
        composers should not be the same screen with different copy on it.
      */}
      <div className={styles.capture} role="group" aria-label="Add to your post">
        <button className={styles.captureButton} onClick={() => setCameraOpen(true)}>
          <Camera size={15} strokeWidth={2.2} />
          {previewAsset ? 'Retake' : 'Camera'}
        </button>
        <button className={styles.captureButton} onClick={() => libraryInput.current?.click()}>
          <Images size={15} strokeWidth={2.2} />
          {previewAsset ? 'Replace' : 'Upload'}
        </button>
      </div>

      {cameraOpen ? (
        <CameraCapture
          onCapture={(file) => {
            setCameraOpen(false)
            void pick(file)
          }}
          onClose={() => setCameraOpen(false)}
          onChooseInstead={() => {
            setCameraOpen(false)
            libraryInput.current?.click()
          }}
        />
      ) : null}
      {previewAsset?.temporary ? (
        <p className={styles.note}>
          Media is referenced, never copied into the app — it stays on this device and will not
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
        {saving ? 'Sharing…' : editing ? 'Save changes' : 'Post'}
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
