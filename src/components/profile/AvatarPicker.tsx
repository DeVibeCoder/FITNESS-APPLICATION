import { useRef, useState } from 'react'
import { Camera, Images, Pencil, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { CameraCapture } from '@/components/social/CameraCapture'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useTempImage } from '@/hooks/useTempImage'
import { userService } from '@/services'
import { describeMedia, PICK_MESSAGE, reject, type PickedMedia } from '@/lib/mediaPick'
import styles from './AvatarPicker.module.css'

/**
 * The avatar, with a way to change it on the avatar itself.
 *
 * It used to be a separate "Profile picture" card above the profile card,
 * which made the Me area have two places claiming to be about who you are.
 * The control belongs on the thing it changes: a small pencil on the circle,
 * and everything else happens in a sheet over the page.
 *
 * Nothing is written until Save. Picking a photo shows it here first, because
 * "is this the one" is a question you answer by looking, and a picture that
 * committed the moment it was chosen gave nobody the chance to change their
 * mind without changing it twice.
 *
 * The picture goes through `mediaService` like every other image in the app:
 * a `MediaAsset` holding metadata and a pointer, never the bytes. The URL is
 * handed over on save, so this component must not revoke it afterwards.
 */
export function AvatarPicker({ ring }: { ring?: boolean }) {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const [open, setOpen] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  /** What was chosen but not yet confirmed. */
  const [chosen, setChosen] = useState<PickedMedia | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const draft = useTempImage()

  if (!user) return null

  const close = () => {
    // An unsaved choice is discarded, and its URL with it.
    draft.release()
    setChosen(null)
    setOpen(false)
  }

  const choose = async (file: File | undefined) => {
    if (!file) return
    const problem = reject(file)
    if (problem) {
      show(PICK_MESSAGE[problem], 'error')
      return
    }
    if (!file.type.startsWith('image/')) {
      show('A profile picture needs to be a photo.', 'error')
      return
    }
    const url = draft.set(file)
    setChosen(await describeMedia(file, url))
  }

  const save = async () => {
    if (!draft.url || !chosen || saving) return
    setSaving(true)
    const saved = await guard(() =>
      userService.setAvatar(user.id, {
        kind: 'image',
        ref: draft.url!,
        mimeType: chosen.mimeType,
        width: chosen.width,
        height: chosen.height,
      }),
    )
    setSaving(false)
    if (!saved) return
    // The asset owns the URL now; closing must not revoke it.
    draft.detach()
    setChosen(null)
    setOpen(false)
    // No refresh call: AuthContext reads the user through a live query, so
    // writing the row updates every avatar in the app at once.
    show('Profile picture updated.', 'success')
  }

  const remove = async () => {
    setSaving(true)
    const done = await guard(() => userService.clearAvatar(user.id))
    setSaving(false)
    if (done === undefined) return
    close()
    show('Back to your initials.', 'success')
  }

  const previewing = Boolean(draft.url && chosen)

  return (
    <>
      <span className={styles.holder}>
        <Avatar user={user} size="xl" ring={ring} />
        <button className={styles.edit} onClick={() => setOpen(true)} aria-label="Change your profile picture">
          <Pencil size={13} strokeWidth={2.6} />
        </button>
      </span>

      <Sheet open={open} onClose={close} title="Profile picture">
        {/*
          The picture being decided on, at a size you can actually judge. Not
          the current one — that is already on the page behind this sheet.
        */}
        <div className={styles.preview}>
          {previewing ? (
            <img src={draft.url!} alt="" className={styles.previewImage} />
          ) : (
            <Avatar user={user} size="xl" />
          )}
        </div>
        <p className={styles.previewNote}>
          {previewing
            ? 'This is how it will look. Save to use it.'
            : 'Shown to the group wherever your name appears.'}
        </p>

        <div className={styles.options}>
          <button className={styles.option} onClick={() => setCameraOpen(true)} disabled={saving}>
            <Camera size={16} strokeWidth={2.2} />
            Take a photo
          </button>
          <button
            className={styles.option}
            onClick={() => fileInput.current?.click()}
            disabled={saving}
          >
            <Images size={16} strokeWidth={2.2} />
            Choose from device
          </button>
          {user.avatarMediaId && !previewing ? (
            <button
              className={`${styles.option} ${styles.danger}`}
              onClick={remove}
              disabled={saving}
            >
              <Trash2 size={16} strokeWidth={2.2} />
              Remove photo
            </button>
          ) : null}
        </div>

        {previewing ? (
          <Button size="lg" block onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save picture'}
          </Button>
        ) : null}

        <Button variant="ghost" onClick={close} disabled={saving}>
          Cancel
        </Button>
      </Sheet>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className={styles.file}
        onChange={(event) => {
          void choose(event.target.files?.[0])
          // Reset, so picking the same file twice in a row still fires.
          event.target.value = ''
        }}
      />

      {cameraOpen ? (
        <CameraCapture
          allowVideo={false}
          onCapture={(file) => {
            setCameraOpen(false)
            void choose(file)
          }}
          onClose={() => setCameraOpen(false)}
          onChooseInstead={() => {
            setCameraOpen(false)
            fileInput.current?.click()
          }}
        />
      ) : null}
    </>
  )
}
