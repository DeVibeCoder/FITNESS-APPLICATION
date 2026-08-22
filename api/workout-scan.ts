import { handleWorkoutScanRequest } from '../server/workoutScan/handler'

/**
 * Serverless entry point for POST /api/workout-scan.
 *
 * The sibling of `api/food-scan.ts`, and deliberately identical in shape: the
 * Web Request/Response signature that Vercel, Netlify, Cloudflare and Deno
 * Deploy all accept, so deploying this later is configuration rather than a
 * rewrite. All the work lives in `server/workoutScan/handler.ts`; this file
 * only translates HTTP.
 */
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { error: 'invalid_image', message: 'No screenshot was received.' },
      { status: 400 },
    )
  }

  const { status, body: payload } = await handleWorkoutScanRequest(body, request.signal)
  return Response.json(payload, {
    status,
    // Nothing about a screenshot or its analysis should be cached anywhere.
    headers: { 'Cache-Control': 'no-store' },
  })
}

export const config = { runtime: 'nodejs' }
