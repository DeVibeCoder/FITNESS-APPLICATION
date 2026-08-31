import { useRef, useState } from 'react'
import { Camera, Images, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { CameraCapture } from '@/components/social/CameraCapture'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useTempImage } from '@/hooks/useTempImage'
import { userService } from '@/services'
import { describeMedia, PICK_MESSAGE, reject } from '@/lib/mediaPick'
import styles from './AvatarPicker.module.css'

/**
 * Your face, or your initials.
 *
 * The picture is handled exactly the way a post's photo is: the file becomes
 * an object URL, `userService.setAvatar` registers it as a `MediaAsset`, and
 * the user row keeps that asset's id. No bytes reach the database and no
 * `data:` URL is ever built — the same rule the rest of the app is held to.
 *
 * The URL is handed over rather than owned here: once the asset exists, the
 * avatar outlives this component, so this must not revoke it on unmount. That
 * is what `detach` is for, and forgetting it is how a new profile picture
 * turns into a broken image the moment the sheet closes.
 *
 * Ownership is enforced in the service. This only ever offers to change your
 * own, because it is only ever rendered on your own profile.
 */
export function AvatarPicker() {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const [cameraOpen, setCameraOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const picked = useTempImage()

  if (!user) return null

  const apply = async (file: File | undefined) => {
    if (!file) return
    const problem = reject(file)
    if (problem) {
      show(PICK_MESSAGE[problem], 'error')
      return
    }
    if (file.type.startsWith('video/')) {
      show('A profile picture needs to be a photo.', 'error')
      return
    }

    setSaving(true)
    const url = picked.set(file)
    const measured = await describeMedia(file, url)
    const saved = await guard(() =>
      userService.setAvatar(user.id, {
        kind: 'image',
        ref: url,
        mimeType: measured.mimeType,
        width: measured.width,
        height: measured.height,
      }),
    )
    setSaving(false)
    if (!saved) {
      picked.release()
      return
    }
    // The asset owns the URL now; unmounting must not revoke it.
    picked.detach()
    // No refresh call: AuthContext reads the user through a live query, so
    // writing the row is what updates every avatar in the app at once.
    show('Profile picture updated.', 'success')
  }

  const remove = async () => {
    setSaving(true)
    const done = await guard(() => userService.clearAvatar(user.id))
    setSaving(false)
    if (done === undefined) return
    show('Back to your initials.', 'success')
  }

  return (
    <div className={styles.row}>
      <span className={styles.face}>
        <Avatar user={user} size="xl" />
      </span>

      <div className={styles.actions}>
        <p className={styles.label}>Profile picture</p>
        <div className={styles.buttons}>
          <button
            className={styles.action}
            onClick={() => setCameraOpen(true)}
            disabled={saving}
          >
            <Camera size={15} strokeWidth={2.2} />
            {user.avatarMediaId ? 'Retake' : 'Camera'}
          </button>
          <button
            className={styles.action}
            onClick={() => fileInput.current?.click()}
            disabled={saving}
          >
            <Images size={15} strokeWidth={2.2} />
            {user.avatarMediaId ? 'Replace' : 'Upload'}
          </button>
          {user.avatarMediaId ? (
            <button
              className={`${styles.action} ${styles.remove}`}
              onClick={remove}
              disabled={saving}
            >
              <Trash2 size={15} strokeWidth={2.2} />
              Remove
            </button>
          ) : null}
        </div>
        <p className={styles.note}>
          Shown to the group wherever your name appears. It stays on this device until cloud
          storage arrives.
        </p>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className={styles.file}
        onChange={(event) => {
          void apply(event.target.files?.[0])
          // Reset, so picking the same file twice in a row still fires.
          event.target.value = ''
        }}
      />

      {cameraOpen ? (
        <CameraCapture
          // Square, because that is the only shape an avatar is ever drawn in.
          frame="free"
          allowVideo={false}
          onCapture={(file) => {
            setCameraOpen(false)
            void apply(file)
          }}
          onClose={() => setCameraOpen(false)}
          onChooseInstead={() => {
            setCameraOpen(false)
            fileInput.current?.click()
          }}
        />
      ) : null}
    </div>
  )
}
