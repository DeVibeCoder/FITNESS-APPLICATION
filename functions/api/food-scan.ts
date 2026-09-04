import { handleFoodScanRequest } from '../../server/foodScan/handler'
import { requireApprovedUser, authFailureResponse, type AuthEnv } from '../../server/auth/guard'

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
  /** Bound in wrangler.toml. Its absence means nobody can be authenticated. */
  DB?: unknown
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
  FDC_API_KEY?: string
}

export const onRequestPost = async (context: {
  request: Request
  env: Env
}): Promise<Response> => {
  /*
   * Identity first, before the body is even read.
   *
   * This endpoint spends real money — a Gemini call per request — and until
   * now anyone who knew the URL could spend it. The session cookie is the
   * only thing trusted here: not a header, not a field in the body, not the
   * frontend having decided the user looked fine.
   *
   * A pending, rejected or disabled account is refused the same as an
   * anonymous one. Approval is what buys access to the expensive parts.
   *
   * With no database bound there is no way to check anybody, so the endpoint
   * refuses rather than falling open. A missing binding is a deployment that
   * is not finished, and the safe reading of that is "no".
   */
  try {
    if (!context.env.DB) {
      return Response.json(
        { error: 'unauthenticated', message: 'Sign in to continue.' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    await requireApprovedUser(context.request, context.env as unknown as AuthEnv)
  } catch (error) {
    const refusal = authFailureResponse(error)
    if (refusal) return refusal
    throw error
  }

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
