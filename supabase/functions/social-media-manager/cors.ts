/**
 * Resolves the Access-Control-Allow-Headers value for a preflight response.
 *
 * Deliberately echoes back whatever the browser's preflight actually requested rather than
 * checking it against a hand-maintained allow-list: supabase-js 2.93.1's browser build adds
 * X-Supabase-Client-Platform / X-Supabase-Client-Platform-Version headers whenever
 * navigator.userAgentData is available (i.e. on every Chromium browser), which a static
 * list that only knew about authorization/apikey/content-type/x-client-info didn't cover --
 * that gap caused every request to fail as "TypeError: Failed to fetch" before the actual
 * POST ever reached this function. Echoing the request is safe here: the origin is already
 * wildcard ("*") with no credentials involved, and the real authorization boundary is the
 * JWT check inside the request handler, not CORS.
 */
export function resolveAllowHeaders(requestedHeaders: string | null, fallback: string): string {
  return requestedHeaders && requestedHeaders.trim().length > 0 ? requestedHeaders : fallback;
}
