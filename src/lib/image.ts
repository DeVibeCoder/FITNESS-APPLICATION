/**
 * Shrinks a photo before it is analysed.
 *
 * A modern phone camera produces 8–12 MB images. The vision model gains
 * nothing from that resolution for identifying food, and sending it costs
 * bandwidth on a phone and money per request. Roughly 1024px on the long edge
 * keeps plate detail and texture — which is what distinguishes steak from
 * salmon — while landing around a few hundred kilobytes.
 *
 * The resized copy is a transient value: it is handed to the upload and never
 * stored.
 */

export interface PreparedImage {
  base64: string
  mimeType: string
  bytes: number
  width: number
  height: number
}

const MAX_EDGE = 1024
const QUALITY = 0.82

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('read_failed'))
    reader.readAsDataURL(blob)
  })
}

async function loadBitmap(file: Blob): Promise<{ width: number; height: number; source: CanvasImageSource }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    return { width: bitmap.width, height: bitmap.height, source: bitmap }
  }
  // Safari fallback.
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('decode_failed'))
      element.src = url
    })
    return { width: image.naturalWidth, height: image.naturalHeight, source: image }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Returns base64 (without the data: prefix) ready to POST. Falls back to the
 * original bytes if the browser cannot decode the image — the server validates
 * size and type either way.
 */
export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  try {
    const { width, height, source } = await loadBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
    const targetWidth = Math.max(1, Math.round(width * scale))
    const targetHeight = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no_canvas')
    context.drawImage(source, 0, 0, targetWidth, targetHeight)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    )
    if (!blob) throw new Error('encode_failed')

    const dataUrl = await readAsDataUrl(blob)
    if (source instanceof ImageBitmap) source.close()

    return {
      base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
      mimeType: 'image/jpeg',
      bytes: blob.size,
      width: targetWidth,
      height: targetHeight,
    }
  } catch {
    const dataUrl = await readAsDataUrl(file)
    return {
      base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
      mimeType: file.type,
      bytes: file.size,
      width: 0,
      height: 0,
    }
  }
}
