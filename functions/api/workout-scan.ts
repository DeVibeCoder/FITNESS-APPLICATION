import { handleWorkoutScanRequest } from '../../server/workoutScan/handler'

/**
 * POST /api/workout-scan, as a Cloudflare Pages Function.
 *
 * The sibling of `api/workout-scan.ts` (Vercel/Netlify) and the Vite dev
 * middleware. All three call the same `handleWorkoutScanRequest`; each only
 * translates its host's HTTP shape and hands over that host's environment.
 *
 * The key lives in `context.env`, which comes from the encrypted variables set
 * on the Pages project. It is never bundled, never prefixed VITE_, and
 * therefore never reachable from the browser — the same guarantee the Node
 * version makes, enforced by a different mechanism.
 */
interface Env {
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
}

export const onRequestPost = async (context: {
  request: Request
  env: Env
}): Promise<Response> => {
  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return Response.json(
      { error: 'invalid_image', message: 'No screenshot was received.' },
      { status: 400 },
    )
  }

  const { status, body: payload } = await handleWorkoutScanRequest(
    body,
    context.request.signal,
    context.env as Record<string, string | undefined>,
  )

  return Response.json(payload, {
    status,
    // Nothing about a screenshot or its analysis should be cached anywhere.
    headers: { 'Cache-Control': 'no-store' },
  })
}

/** Anything other than POST is refused before an image is ever read. */
export const onRequest = async (): Promise<Response> =>
  Response.json({ error: 'method_not_allowed' }, { status: 405 })
