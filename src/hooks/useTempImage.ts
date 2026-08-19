import { useCallback, useEffect, useRef, useState } from 'react'
import { TempImage } from '@/lib/tempImage'

/**
 * React wrapper around `TempImage`. The URL is revoked when the component
 * unmounts, so navigating away or refreshing mid-scan leaves nothing behind.
 */
export function useTempImage(): {
  url: string | null
  set: (file: Blob) => void
  release: () => void
} {
  const holder = useRef<TempImage>(null)
  holder.current ??= new TempImage()
  const [url, setUrl] = useState<string | null>(null)

  const set = useCallback((file: Blob) => {
    setUrl(holder.current!.set(file))
  }, [])

  const release = useCallback(() => {
    holder.current!.release()
    setUrl(null)
  }, [])

  useEffect(() => {
    const current = holder.current!
    return () => current.release()
  }, [])

  return { url, set, release }
}
