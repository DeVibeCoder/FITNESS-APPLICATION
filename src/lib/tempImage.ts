/**
 * Owns the lifetime of a food photo preview.
 *
 * A scanned photo exists only as an object URL, only for as long as the scan
 * workflow is on screen. Nothing here writes to storage of any kind — there is
 * deliberately no `save`. Replacing an image or releasing the holder revokes
 * the previous URL immediately, so a session of repeated scans cannot leak
 * blobs into memory.
 *
 * Kept out of React so the create/revoke pairing can be tested directly.
 */
export class TempImage {
  private url: string | null = null

  /** Swaps in a new file, revoking whatever was held before. */
  set(file: Blob): string {
    this.release()
    this.url = URL.createObjectURL(file)
    return this.url
  }

  get current(): string | null {
    return this.url
  }

  /** Safe to call repeatedly; revoking twice is not an error but is pointless. */
  release(): void {
    if (this.url === null) return
    URL.revokeObjectURL(this.url)
    this.url = null
  }
}
