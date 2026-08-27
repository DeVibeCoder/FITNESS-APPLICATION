import { SharedCard } from '@/components/chat/SharedCard'
import { MediaFrame } from './MediaFrame'
import type { MediaAsset, Story, User } from '@/models'
import styles from './StoryFrame.module.css'

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
 * A story with no picture is drawn in the brand gradient with the words large
 * and centred — the same "written, not photographed" treatment every story
 * product uses, in this app's own colours rather than a new palette.
 */
export function StoryFrame({
  story,
  media,
  author,
}: {
  story: Pick<Story, 'type' | 'text' | 'sharedType' | 'sharedDataId'>
  media?: MediaAsset
  /** Needed only by a story that carries a record. */
  author?: User
}) {
  const written = !media

  return (
    <div className={[styles.frame, written ? styles.written : ''].filter(Boolean).join(' ')}>
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
            <MediaFrame asset={media} rounded={false} fill contain />
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
