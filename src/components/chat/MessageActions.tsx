import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CornerUpLeft, Copy, Pin, PinOff, Plus, SmilePlus, Trash2 } from 'lucide-react'
import { EmojiPicker } from './EmojiPicker'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { chatService, CHAT_REACTIONS } from '@/services/chatService'
import type { ChatMessageView } from '@/services/chatService'
import styles from './MessageActions.module.css'

/** How far the card is kept from every edge of the screen. */
const EDGE = 12
/** Matches `.card` in the stylesheet; the clamp below has to know it. */
const CARD_WIDTH = 268

/**
 * What a press-and-hold offers.
 *
 * The reactions first, as a row of the ones this group actually uses, with a
 * `+` through to everything else — reacting is far and away the most common
 * answer to a message, so it is the thing already open rather than an item in
 * a list that opens another list.
 *
 * Then the actions. Delete appears only on your own message, which the service
 * enforces anyway; showing it on somebody else's would be offering a button
 * whose only outcome is a refusal.
 *
 * It is anchored to the bubble that was held, clamped to the screen, so the
 * menu appears where the finger already is rather than in the middle of the
 * page. Everything about closing it is deliberate: the scrim, Escape, and
 * picking anything all put it away, and nothing here can trap anyone.
 */
export function MessageActions({
  message,
  anchor,
  onClose,
  onReply,
}: {
  message: ChatMessageView
  /** Where the bubble was when it was held. */
  anchor: DOMRect
  onClose: () => void
  onReply: (message: ChatMessageView) => void
}) {
  const { user, isOwner } = useAuth()
  const { show, guard } = useToast()
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  if (!user) return null

  const mine = isOwner(message.userId)
  const myReaction = message.reactions.find((r) => r.userId === user.id)
  const pinned = Boolean(message.pinnedAt)

  const react = (emoji: string) => {
    onClose()
    void guard(() => chatService.toggleReaction(message.id, user.id, emoji))
  }

  const copy = async () => {
    onClose()
    const text = message.text.trim()
    if (!text) {
      show('There is no text to copy.', 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      show('Copied.', 'success')
    } catch {
      // Clipboard access is refused in plenty of contexts — an insecure
      // origin, a browser setting — and saying so is better than silence.
      show('This browser would not let the page copy that.', 'error')
    }
  }

  const pin = async () => {
    onClose()
    const nowPinned = await guard(() => chatService.togglePin(message.id, user.id))
    if (nowPinned === undefined) return
    show(nowPinned ? 'Pinned to the top of the chat.' : 'Unpinned.', 'success')
  }

  const remove = () => {
    onClose()
    void guard(() => chatService.remove(message.id))
  }

  /*
   * Below the bubble if there is room, above it if there is not, and never off
   * either end. The card is a fixed width so this only has to solve for one
   * axis of its own size, which it reads back after mounting is unnecessary
   * for: a max-height plus clamping is enough and costs no second layout pass.
   */
  const below = anchor.bottom + 260 < window.innerHeight
  const top = below
    ? Math.min(anchor.bottom + 8, window.innerHeight - EDGE)
    : Math.max(EDGE, anchor.top - 8)

  return createPortal(
    <>
      <div className={styles.root} role="dialog" aria-modal="true" aria-label="Message actions">
        <button className={styles.scrim} onClick={onClose} aria-label="Close" />

        <div
          className={`glass ${styles.card}`}
          style={{
            top,
            transform: below ? undefined : 'translateY(-100%)',
            // Kept on the message's own side, and inside the screen — and
            // never negative on a phone narrower than the card itself.
            left: Math.max(
              EDGE,
              Math.min(anchor.left, window.innerWidth - CARD_WIDTH - EDGE),
            ),
          }}
        >
          <div className={styles.reactRow} role="group" aria-label="React">
            {CHAT_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                className={[styles.react, myReaction?.emoji === emoji ? styles.reactOn : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => react(emoji)}
                aria-pressed={myReaction?.emoji === emoji}
                aria-label={`React with ${emoji}`}
              >
                {emoji}
              </button>
            ))}
            <button
              className={styles.more}
              onClick={() => setPickerOpen(true)}
              aria-label="More emoji"
              aria-haspopup="dialog"
            >
              <Plus size={16} strokeWidth={2.6} />
            </button>
          </div>

          <ul className={styles.actions}>
            <Action
              icon={<CornerUpLeft size={16} strokeWidth={2.1} />}
              label="Reply"
              onClick={() => {
                onClose()
                onReply(message)
              }}
            />
            <Action
              icon={<SmilePlus size={16} strokeWidth={2.1} />}
              label={myReaction ? 'Change reaction' : 'React'}
              onClick={() => setPickerOpen(true)}
            />
            <Action
              icon={<Copy size={16} strokeWidth={2.1} />}
              label="Copy text"
              onClick={copy}
            />
            <Action
              icon={
                pinned ? <PinOff size={16} strokeWidth={2.1} /> : <Pin size={16} strokeWidth={2.1} />
              }
              label={pinned ? 'Unpin' : 'Pin'}
              onClick={pin}
            />
            {/* Only your own. The guard in the service is what enforces it. */}
            {mine ? (
              <Action
                icon={<Trash2 size={16} strokeWidth={2.1} />}
                label="Delete"
                danger
                onClick={remove}
              />
            ) : null}
          </ul>
        </div>
      </div>

      {pickerOpen ? (
        <EmojiPicker
          selected={myReaction?.emoji}
          onPick={(emoji) => {
            setPickerOpen(false)
            react(emoji)
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </>,
    document.body,
  )
}

function Action({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <li>
      <button
        className={[styles.action, danger ? styles.danger : ''].filter(Boolean).join(' ')}
        onClick={onClick}
      >
        <span className={styles.actionIcon}>{icon}</span>
        {label}
      </button>
    </li>
  )
}
