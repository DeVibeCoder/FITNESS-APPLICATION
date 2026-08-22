/**
 * Generates the PWA icon PNGs from a tiny hand-rolled rasterizer so the project
 * has no image tooling dependency. Run with: npm run icons
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons')

const INK = [0x14, 0x10, 0x0d]
const ACCENT = [0xf9, 0x73, 0x16]
const PAPER = [0xfa, 0xf6, 0xf2]

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour with alpha
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // no filter
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Coverage of a shape at a pixel, sampled 3x3 for anti-aliasing. */
function coverage(x, y, test) {
  let hits = 0
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      if (test(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3)) hits++
    }
  }
  return hits / 9
}

function roundedRect(size, radius) {
  return (px, py) => {
    const cx = Math.min(Math.max(px, radius), size - radius)
    const cy = Math.min(Math.max(py, radius), size - radius)
    const dx = px - cx
    const dy = py - cy
    return dx * dx + dy * dy <= radius * radius
  }
}

/** Open arc: a ring segment with rounded caps, drawn clockwise from 12 o'clock. */
function arc(cx, cy, radius, width, fromDeg, toDeg) {
  const half = width / 2
  const toAngle = (deg) => ((deg - 90) * Math.PI) / 180
  const capA = [cx + radius * Math.cos(toAngle(fromDeg)), cy + radius * Math.sin(toAngle(fromDeg))]
  const capB = [cx + radius * Math.cos(toAngle(toDeg)), cy + radius * Math.sin(toAngle(toDeg))]
  return (px, py) => {
    const dx = px - cx
    const dy = py - cy
    const d = Math.hypot(dx, dy)
    if (Math.abs(d - radius) <= half) {
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90
      if (deg < 0) deg += 360
      if (deg >= fromDeg && deg <= toDeg) return true
    }
    return (
      Math.hypot(px - capA[0], py - capA[1]) <= half ||
      Math.hypot(px - capB[0], py - capB[1]) <= half
    )
  }
}

function blend(buf, i, color, alpha) {
  if (alpha <= 0) return
  for (let c = 0; c < 3; c++) {
    buf[i + c] = Math.round(buf[i + c] * (1 - alpha) + color[c] * alpha)
  }
  buf[i + 3] = Math.round(buf[i + 3] * (1 - alpha) + 255 * alpha)
}

function render(size, { bleed = false } = {}) {
  const buf = Buffer.alloc(size * size * 4, 0)
  const s = size
  // Content is inset on maskable icons so nothing is lost to the safe-zone crop.
  const inset = bleed ? 0 : s * 0.06
  const scale = bleed ? 0.62 : 1
  const box = s - inset * 2
  const bgShape = roundedRect(box, box * 0.22)
  const bg = bleed ? () => true : (px, py) => bgShape(px - inset, py - inset)
  const cx = s / 2
  const cy = s / 2
  const outer = arc(cx, cy, s * 0.29 * scale, s * 0.105 * scale, 0, 292)
  const inner = arc(cx, cy, s * 0.145 * scale, s * 0.105 * scale, 0, 205)

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4
      blend(buf, i, INK, coverage(x, y, bg))
      blend(buf, i, ACCENT, coverage(x, y, outer))
      blend(buf, i, PAPER, coverage(x, y, inner))
    }
  }
  return buf
}

mkdirSync(OUT, { recursive: true })
for (const [name, size, opts] of [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { bleed: true }],
  ['apple-touch-icon.png', 180, { bleed: true }],
]) {
  writeFileSync(resolve(OUT, name), encodePng(size, render(size, opts)))
  console.log('wrote', name)
}
