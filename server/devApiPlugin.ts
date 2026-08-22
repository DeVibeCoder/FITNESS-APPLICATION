import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleFoodScanRequest } from './foodScan/handler.ts'
import { handleWorkoutScanRequest } from './workoutScan/handler.ts'

/**
 * Serves /api/food-scan and /api/workout-scan from the Vite dev server.
 *
 * Keeps `npm run dev` a single command while both endpoints stay deployable as
 * serverless functions. The API key is read here, in the Node process — it is
 * never part of the client bundle, and Vite only exposes `VITE_`-prefixed
 * variables to the browser, so `GEMINI_API_KEY` cannot leak through the env.
 */
type Handler = (body: unknown) => Promise<{ status: number; body: unknown }>

/**
 * One JSON POST endpoint. Both scanners take the same shape of request — a
 * base64 image and its type — and differ only in what they do with it, so the
 * plumbing is written once.
 */
function jsonPost(handle: Handler, emptyMessage: string) {
  return (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end(JSON.stringify({ error: 'method_not_allowed' }))
      return
    }

    const chunks: Buffer[] = []
    let bytes = 0
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      // Guard the dev server against an accidental enormous upload.
      if (bytes > 12 * 1024 * 1024) {
        res.statusCode = 413
        res.end(JSON.stringify({ error: 'too_large', message: 'That image is too large.' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', async () => {
      if (res.writableEnded) return
      let body: unknown
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'invalid_image', message: emptyMessage }))
        return
      }

      const { status, body: payload } = await handle(body)
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(payload))
    })
  }
}

export function devApiPlugin(): Plugin {
  return {
    name: 'circuit-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(
        '/api/food-scan',
        jsonPost((body) => handleFoodScanRequest(body), 'No photo was received.'),
      )
      server.middlewares.use(
        '/api/workout-scan',
        jsonPost((body) => handleWorkoutScanRequest(body), 'No screenshot was received.'),
      )
    },
  }
}
