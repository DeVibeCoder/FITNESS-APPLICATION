import { useId, useState } from 'react'
import { Quote, Shuffle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { OptionGroup } from '@/components/ui/Field'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { postService, DEFAULT_VISIBILITY } from '@/services'
import { DAILY_LINES } from '@/data/messages'
import type { Visibility } from '@/models'
import styles from './MotivationComposer.module.css'

/** A quote is a line, not an essay. */
const MAX_LENGTH = 220

const VISIBILITY_OPTIONS: { value: Visibility; label: string }[] = [
  { value: 'group', label: 'The group' },
  { value: 'private', label: 'Only me' },
]

/**
 * Passing a line on.
 *
 * Deliberately not the post composer with different words on the button. A
 * post is "what's going on" — a box, a picture, a Post. This is a quote card
 * being made: you type into the card itself, at the size it will be read at,
 * on the ground it will be read on, and what is on screen while you type is
 * what the group will see.
 *
 * It writes exactly what the post composer wrote — `postService.create` with
 * `motivation: true`, producing the same row of the same type. Nothing about
 * the data model moved; only the making of it did.
 */
export function MotivationComposer({
  onDone,
  onCancel,
}: {
  onDone: () => void
  onCancel: () => void
}) {
  const { user } = useAuth()
  const { show, guard } = useToast()
  const [text, setText] = useState('')
  const [visibility, setVisibility] = useState<Visibility>(DEFAULT_VISIBILITY)
  const [saving, setSaving] = useState(false)
  const textId = useId()

  if (!user) return null

  const canShare = text.trim().length > 0

  /*
   * A line from the app's own set, dropped into the box to be edited or
   * replaced. It is a starting point, not a submission — nothing is posted
   * until somebody presses the button, and what they post is whatever is in
   * the box by then.
   */
  const borrow = () => {
    const pool = DAILY_LINES.filter((line) => line !== text)
    setText(pool[Math.floor(Math.random() * pool.length)] ?? DAILY_LINES[0])
  }

  const share = async () => {
    if (!canShare || saving) return
    setSaving(true)
    const created = await guard(() =>
      postService.create({ userId: user.id, text, visibility, motivation: true }),
    )
    setSaving(false)
    // The draft survives a failed write rather than vanishing with it.
    if (!created) return
    setText('')
    show(
      visibility === 'private' ? 'Saved, just for you.' : 'Shared with the group.',
      'success',
    )
    onDone()
  }

  const remaining = MAX_LENGTH - text.length

  return (
    <>
      {/*
        The card is the input. Typing happens inside the thing being made,
        at the size and on the ground it will be read at.
      */}
      <div className={styles.card}>
        <span className={styles.mark} aria-hidden="true">
          “
        </span>
        <label className="sr-only" htmlFor={textId}>
          The line you want to pass on
        </label>
        <textarea
          id={textId}
          className={styles.input}
          value={text}
          rows={3}
          maxLength={MAX_LENGTH}
          placeholder="You don't have to be extreme, just consistent."
          onChange={(event) => setText(event.target.value)}
        />
        <p className={styles.by}>Passed on by {user.name.split(' ')[0]}</p>
      </div>

      <div className={styles.row}>
        <button className={styles.borrow} onClick={borrow}>
          <Quote size={14} strokeWidth={2.3} />
          Use one of ours
          <Shuffle size={13} strokeWidth={2.3} className={styles.shuffle} />
        </button>
        {remaining <= 60 ? <span className={`${styles.counter} tnum`}>{remaining}</span> : null}
      </div>

      <OptionGroup
        label="Who can see this"
        value={visibility}
        options={VISIBILITY_OPTIONS}
        onChange={setVisibility}
      />

      <Button size="lg" block onClick={share} disabled={!canShare || saving}>
        {saving ? 'Sharing…' : 'Pass it on'}
      </Button>

      <Button variant="ghost" onClick={onCancel} disabled={saving}>
        Cancel
      </Button>
    </>
  )
}
