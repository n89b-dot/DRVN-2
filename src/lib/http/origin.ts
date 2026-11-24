/**
 * "This write came from our own pages."
 *
 * A route that acts on the session cookie must not act for another site's
 * page: the browser attaches the cookie whoever asked. Server actions have
 * this check built in; a route handler has to make it. One function, so the
 * routes cannot each get it slightly differently (three of them had: one
 * compared the header with an environment variable's raw text, which a
 * trailing slash breaks).
 *
 * A browser names the page's origin on every POST. Accepted: the origin this
 * request was addressed to, or the configured site origin. Where the header
 * is absent, the browser's own `Sec-Fetch-Site: same-origin` is accepted in
 * its place; page script cannot set either header.
 */
export function isSameOrigin(request: Request): boolean {
  const allowed = new Set<string>([new URL(request.url).origin]);
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) {
    try {
      allowed.add(new URL(site).origin);
    } catch {
      // A malformed setting allows nothing extra.
    }
  }
  const origin = request.headers.get("origin");
  if (origin) return allowed.has(origin);
  return request.headers.get("sec-fetch-site") === "same-origin";
}

/** The refusal to return, or null when the request is from our own pages. */
export function requireSameOrigin(request: Request, headers?: HeadersInit): Response | null {
  return isSameOrigin(request) ? null : Response.json({ error: "Invalid origin." }, { status: 403, headers });
}
