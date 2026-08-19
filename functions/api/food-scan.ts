import { handleFoodScanRequest } from '../../server/foodScan/handler'

/**
 * POST /api/food-scan, as a Cloudflare Pages Function.
 *
 * The sibling of `api/food-scan.ts` (Vercel/Netlify) and the Vite dev
 * middleware. All three call the same `handleFoodScanRequest`; each only
 * translates its host's HTTP shape and hands over that host's environment.
 *
 * The keys live in `context.env`, which comes from the encrypted variables set
 * on the Pages project. They are never bundled, never prefixed VITE_, and
 * therefore never reachable from the browser — the same guarantee the Node
 * version makes, enforced by a different mechanism.
 */
interface Env {
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
  FDC_API_KEY?: string
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
      { error: 'invalid_image', message: 'No photo was received.' },
      { status: 400 },
    )
  }

  const { status, body: payload } = await handleFoodScanRequest(
    body,
    context.request.signal,
    context.env as Record<string, string | undefined>,
  )

  return Response.json(payload, {
    status,
    // Nothing about a food photo or its analysis should be cached anywhere.
    headers: { 'Cache-Control': 'no-store' },
  })
}

/** Anything other than POST is refused before a photo is ever read. */
export const onRequest = async (): Promise<Response> =>
  Response.json({ error: 'method_not_allowed' }, { status: 405 })
