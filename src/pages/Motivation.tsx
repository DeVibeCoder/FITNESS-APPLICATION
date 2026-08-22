import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, Section } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { EmptyState, LoadingScreen } from '@/components/ui/EmptyState'
import { VideoCard } from '@/components/motivation/VideoCard'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { motivationService } from '@/services'
import { parseVideoUrl } from '@/services/motivationService'
import type { MotivationVideo } from '@/models'
import styles from './Motivation.module.css'

/**
 * Links to other people's videos, plus this week's line.
 *
 * One video is featured per week and the rotation advances on its own, so the
 * page has something new to say every Sunday without anyone maintaining it.
 * Nothing is downloaded, uploaded or stored beyond the URL.
 */
export function Motivation() {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const [editing, setEditing] = useState<MotivationVideo | null>(null)
  const [adding, setAdding] = useState(false)

  const videos = useLiveQuery(() => motivationService.list(), [])
  const featured = useLiveQuery(() => motivationService.featuredForWeek(), [])
  const upcoming = useLiveQuery(() => motivationService.upcoming(2), [])
  const pinned = useLiveQuery(() => motivationService.isPinned(), [])

  if (!user || videos === undefined) return <LoadingScreen />

  const others = videos.filter((video) => video.id !== featured?.id)

  return (
    <div className={styles.page}>
      <PageHeader
        parent={{ label: 'Me', to: '/me' }}
        title="Motivation"
        subtitle="A few things worth watching again"
        action={
          <Button size="sm" icon={<Plus size={15} strokeWidth={2.4} />} onClick={() => setAdding(true)}>
            Add
          </Button>
        }
      />

      <Card className={styles.quoteCard}>
        <p className="eyebrow">Today's line</p>
        <p className={styles.quote}>{motivationService.quoteOfTheDay(user.id)}</p>
      </Card>

      {featured ? (
        <Section
          title="Featured this week"
          action={
            pinned ? (
              <button
                className={styles.rotationLink}
                onClick={async () => {
                  await motivationService.unpinWeek()
                  show('Back to the automatic rotation.', 'success')
                }}
              >
                Use rotation
              </button>
            ) : (
              <span className={styles.rotationNote}>Automatic</span>
            )
          }
        >
          <VideoCard video={featured} featured onEdit={setEditing} />
          {upcoming && upcoming.length > 0 ? (
            <p className={styles.upcoming}>
              Next up: {upcoming.map((video) => video.title).join(', then ')}
            </p>
          ) : null}
        </Section>
      ) : videos.length === 0 ? (
        <EmptyState
          title="No videos yet"
          body="Paste a YouTube or Vimeo link and it shows up here for the whole group."
          action={
            <Button icon={<Plus size={16} strokeWidth={2.4} />} onClick={() => setAdding(true)}>
              Add a video
            </Button>
          }
        />
      ) : null}

      {others.length > 0 ? (
        <Section title="The collection">
          <ul className={styles.grid}>
            {others.map((video, index) => (
              <li key={video.id} className={styles.collectionItem}>
                <VideoCard video={video} onEdit={setEditing} />
                <div className={styles.order}>
                  <span className={video.isActive ? styles.inRotation : styles.outOfRotation}>
                    {video.isActive ? 'In rotation' : 'Paused'}
                  </span>
                  <button
                    className={styles.orderButton}
                    aria-label={`Move ${video.title} earlier in the rotation`}
                    disabled={!video.isActive || index === 0}
                    onClick={() => guard(() => motivationService.reorder(video.id, -1))}
                  >
                    <ArrowUp size={14} strokeWidth={2.4} />
                  </button>
                  <button
                    className={styles.orderButton}
                    aria-label={`Move ${video.title} later in the rotation`}
                    disabled={!video.isActive || index === others.length - 1}
                    onClick={() => guard(() => motivationService.reorder(video.id, 1))}
                  >
                    <ArrowDown size={14} strokeWidth={2.4} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <p className={styles.note}>
        Videos are links to their original platform. Nothing is uploaded or stored here — remove a
        link and it is gone.
      </p>

      <VideoSheet
        open={adding || editing !== null}
        video={editing ?? undefined}
        onClose={() => {
          setAdding(false)
          setEditing(null)
        }}
        onSaved={(message) => show(message, 'success')}
        guard={guard}
        userId={user.id}
      />
    </div>
  )
}

function VideoSheet({
  open,
  video,
  onClose,
  onSaved,
  guard,
  userId,
}: {
  open: boolean
  video?: MotivationVideo
  onClose: () => void
  onSaved: (message: string) => void
  guard: <T>(action: () => Promise<T>, failureMessage?: string) => Promise<T | undefined>
  userId: string
}) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [quote, setQuote] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(video?.title ?? '')
    setUrl(video?.url ?? '')
    setQuote(video?.quote ?? '')
    setConfirmDelete(false)
  }, [open, video])

  const valid = parseVideoUrl(url) !== null

  const save = async () => {
    if (!valid) return
    setSaving(true)
    const result = await guard(async () => {
      if (video) {
        await motivationService.update(video.id, { title, url, quote })
      } else {
        await motivationService.add({ title, url, quote, addedBy: userId, makeActive: false })
      }
    })
    setSaving(false)
    if (result !== undefined) {
      onSaved(video ? 'Video updated.' : 'Video added.')
      onClose()
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={video ? 'Edit video' : 'Add a video'}
      subtitle="Paste a YouTube or Vimeo link. Only the link is stored."
    >
      <Field
        label="Link"
        value={url}
        placeholder="https://www.youtube.com/watch?v=…"
        onChange={(event) => setUrl(event.target.value)}
        hint={url && !valid ? "That doesn't look like a video link." : undefined}
      />
      <Field
        label="Title"
        value={title}
        placeholder="What is it called?"
        onChange={(event) => setTitle(event.target.value)}
      />
      <Field
        label="Quote"
        value={quote}
        placeholder="Optional — the line worth remembering"
        maxLength={140}
        onChange={(event) => setQuote(event.target.value)}
      />

      <Button size="lg" block onClick={save} disabled={saving || !valid}>
        {saving ? 'Saving…' : video ? 'Save changes' : 'Add video'}
      </Button>

      {video ? (
        <>
          <Button
            variant="secondary"
            onClick={async () => {
              await guard(() => motivationService.pinForWeek(video.id))
              onSaved('Featured for this week.')
              onClose()
            }}
          >
            Feature this week
          </Button>

          <Button
            variant="secondary"
            onClick={async () => {
              await guard(() => motivationService.setInRotation(video.id, !video.isActive))
              onSaved(video.isActive ? 'Paused — it will be skipped.' : 'Back in the rotation.')
              onClose()
            }}
          >
            {video.isActive ? 'Pause in rotation' : 'Return to rotation'}
          </Button>

          {confirmDelete ? (
            <div className={styles.confirm}>
              <p className={styles.confirmText}>Delete this video from the collection?</p>
              <div className={styles.confirmRow}>
                <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </Button>
                <Button
                  variant="danger"
                  onClick={async () => {
                    await guard(() => motivationService.remove(video.id))
                    onSaved('Video deleted.')
                    onClose()
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              icon={<Trash2 size={15} strokeWidth={2.1} />}
              onClick={() => setConfirmDelete(true)}
            >
              Delete video
            </Button>
          )}
        </>
      ) : null}
    </Sheet>
  )
}
