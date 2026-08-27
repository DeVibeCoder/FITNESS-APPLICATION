import { SharedCard } from '@/components/chat/SharedCard'
import { MediaFrame } from './MediaFrame'
import type { MediaAsset, Story, StoryBackground, User } from '@/models'
import styles from './StoryFrame.module.css'

/**
 * The seven grounds a written story can be drawn on.
 *
 * A small, fixed set rather than a colour picker: every one of them has been
 * checked against white text, and none of them stops looking like this app.
 * `ember` is first and is the default, so every story written before the
 * picker existed still looks exactly as it did.
 */
export const STORY_BACKGROUNDS: { value: StoryBackground; label: string }[] = [
  { value: 'ember', label: 'Ember' },
  { value: 'violet', label: 'Violet' },
  { value: 'ocean', label: 'Ocean' },
  { value: 'forest', label: 'Forest' },
  { value: 'blossom', label: 'Blossom' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'stone', label: 'Stone' },
]

export const DEFAULT_STORY_BACKGROUND: StoryBackground = 'ember'

/**
 * What a story looks like.
 *
 * One component for both the composer's preview and the viewer, so "preview
 * before publishing" means the actual thing rather than an approximation of
 * it. If the two ever diverge it will be because somebody changed this file,
 * which is the only way to keep that promise honest.
 *
 * A picture is drawn `contain` rather than cropped: these are photos people
 * took on a phone in whatever shape their camera gave them, and a story that
 * silently cuts the top off a squat is worse than one with bars down the side.
 * The blurred copy behind it fills those bars with the picture's own colours,
 * which is what stops a portrait photo sitting in a black void.
 *
 * A story with no media is drawn on one of the chosen grounds with the words
 * large and centred. A story *with* media never takes a ground — the picture
 * is the background, and painting over it would be discarding what the story
 * is of.
 */
export function StoryFrame({
  story,
  media,
  author,
  compact = false,
}: {
  story: Pick<Story, 'type' | 'text' | 'sharedType' | 'sharedDataId' | 'background'>
  media?: MediaAsset
  /** Needed only by a story that carries a record. */
  author?: User
  /** The composer's small preview, which has no viewer controls to clear. */
  compact?: boolean
}) {
  const written = !media
  const ground = story.background ?? DEFAULT_STORY_BACKGROUND

  return (
    <div
      className={[
        styles.frame,
        compact ? styles.compact : '',
        written ? `${styles.written} ${styles[ground]}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {media ? (
        <>
          {/*
            The backdrop. Aria-hidden and inert: it is the same picture again,
            blurred and overscanned purely so the letterboxing has a colour.
          */}
          <div className={styles.backdrop} aria-hidden="true">
            <MediaFrame asset={media} rounded={false} fill />
          </div>
          <div className={styles.picture}>
            <MediaFrame
              asset={media}
              rounded={false}
              fill
              contain
              /* A story clip starts on its own; the small composer preview
                 does the same, and neither needs a control bar over it. */
              autoPlay={media.kind === 'video'}
            />
          </div>
        </>
      ) : null}

      {story.sharedType && author ? (
        <div className={styles.shared}>
          <SharedCard message={story} author={author} />
        </div>
      ) : null}

      {story.text ? (
        <p className={written ? styles.words : styles.caption}>{story.text}</p>
      ) : null}
    </div>
  )
}
