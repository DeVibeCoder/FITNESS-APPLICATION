import { handleFoodScanRequest } from '../server/foodScan/handler'

/**
 * Serverless entry point for POST /api/food-scan.
 *
 * Uses the Web Request/Response signature that Vercel, Netlify, Cloudflare and
 * Deno Deploy all accept, so deploying this later is configuration rather than
 * a rewrite. All the work lives in `server/foodScan/handler.ts`; this file only
 * translates HTTP.
 */
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_image', message: 'No photo was received.' }, { status: 400 })
  }

  const { status, body: payload } = await handleFoodScanRequest(body, request.signal)
  return Response.json(payload, {
    status,
    // Nothing about a food photo or its analysis should be cached anywhere.
    headers: { 'Cache-Control': 'no-store' },
  })
}

export const config = { runtime: 'nodejs' }
