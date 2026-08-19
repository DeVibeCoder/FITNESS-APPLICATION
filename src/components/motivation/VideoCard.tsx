import { useState } from 'react'
import { Play, Pencil, ExternalLink } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { motivationService } from '@/services'
import type { MotivationVideo } from '@/models'
import styles from './VideoCard.module.css'

/**
 * A link with a picture in front of it.
 *
 * The embed is not mounted until the user chooses to watch, so nothing
 * autoplays and no third-party player loads on a screen nobody asked for. If a
 * provider cannot be embedded, the card falls back to opening the original URL.
 */
export function VideoCard({
  video,
  featured,
  onEdit,
}: {
  video: MotivationVideo
  featured?: boolean
  onEdit?: (video: MotivationVideo) => void
}) {
  const [watching, setWatching] = useState(false)
  const embedUrl = motivationService.embedUrl(video)
  const canEmbed = video.provider === 'youtube' || video.provider === 'vimeo'

  return (
    <Card flush className={[styles.card, featured ? styles.featured : ''].filter(Boolean).join(' ')}>
      {watching && embedUrl && canEmbed ? (
        <div className={styles.frame}>
          <iframe
            src={embedUrl}
            title={video.title}
            allow="accelerometer; encrypted-media; picture-in-picture"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : (
        <button
          className={styles.thumb}
          onClick={() => {
            if (canEmbed) setWatching(true)
            else window.open(video.url, '_blank', 'noopener,noreferrer')
          }}
          aria-label={`Watch ${video.title}`}
        >
          {video.thumbnailUrl ? (
            <img src={video.thumbnailUrl} alt="" className={styles.image} loading="lazy" />
          ) : (
            <span className={styles.placeholder} aria-hidden="true" />
          )}
          {/*
            The featured card puts its title and line over the still, behind a
            dark scrim — the cinematic treatment only earns its keep on the one
            video the week is about, so the rest keep the plain caption below.
          */}
          {featured ? <span className={styles.scrim} aria-hidden="true" /> : null}
          <span className={styles.play}>
            {canEmbed ? (
              <Play size={featured ? 22 : 18} strokeWidth={2.4} fill="currentColor" />
            ) : (
              <ExternalLink size={featured ? 20 : 16} strokeWidth={2.2} />
            )}
          </span>
          {featured ? (
            <span className={styles.overlay}>
              <span className={styles.overlayTitle}>{video.title}</span>
              {video.quote ? (
                <span className={styles.overlayQuote}>“{video.quote}”</span>
              ) : null}
            </span>
          ) : null}
        </button>
      )}

      <div className={styles.body}>
        {/* Already shown over the still on the featured card. */}
        {featured && !watching ? null : (
          <>
            <p className={styles.title}>{video.title}</p>
            {video.quote ? <p className={styles.quote}>“{video.quote}”</p> : null}
          </>
        )}
        <div className={styles.actions}>
          {!watching ? (
            <button
              className={styles.watch}
              onClick={() => {
                if (canEmbed) setWatching(true)
                else window.open(video.url, '_blank', 'noopener,noreferrer')
              }}
            >
              {canEmbed ? 'Watch' : 'Open link'}
            </button>
          ) : (
            <button className={styles.watch} onClick={() => setWatching(false)}>
              Close
            </button>
          )}
          {onEdit ? (
            <button className={styles.edit} onClick={() => onEdit(video)} aria-label="Edit video">
              <Pencil size={13} strokeWidth={2.1} />
            </button>
          ) : null}
        </div>
      </div>
    </Card>
  )
}
