import { useCallback, useEffect, useRef, useState } from 'react'
import { TempImage } from '@/lib/tempImage'

/**
 * React wrapper around `TempImage`. The URL is revoked when the component
 * unmounts, so navigating away or refreshing mid-scan leaves nothing behind.
 */
export function useTempImage(): {
  url: string | null
  /** Returns the new URL, so a caller can use it before the state lands. */
  set: (file: Blob) => string
  release: () => void
  detach: () => string | null
} {
  const holder = useRef<TempImage>(null)
  holder.current ??= new TempImage()
  const [url, setUrl] = useState<string | null>(null)

  const set = useCallback((file: Blob) => {
    const url = holder.current!.set(file)
    setUrl(url)
    return url
  }, [])

  const release = useCallback(() => {
    holder.current!.release()
    setUrl(null)
  }, [])

  /**
   * Gives the URL away, so unmounting no longer revokes it. Used when the
   * picked image has been attached to something that outlives this component.
   */
  const detach = useCallback(() => {
    const handed = holder.current!.detach()
    setUrl(null)
    return handed
  }, [])

  useEffect(() => {
    const current = holder.current!
    return () => current.release()
  }, [])

  return { url, set, release, detach }
}
