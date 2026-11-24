/**
 * The Cache-Control a page response carries (src/proxy.ts).
 *
 * Almost everything is `private, no-store`: nothing may keep a copy, so a
 * shared computer never shows one person's page to the next. That also keeps
 * the page out of the browser's back/forward cache, which is why pressing
 * Back reloaded every page from the server.
 *
 * A signed-out visitor's browse pages carry `private, no-cache` instead. No
 * shared cache may store them and a normal visit still asks the server, but
 * the browser may keep the page it just left in memory and put it back at
 * once on Back. Only where all of these hold:
 *  - a GET or HEAD for a public browse page (the list below);
 *  - the request carries no session cookie, so the page holds nothing of a
 *    member's (a member who signs out and presses Back is not shown the page
 *    they had: it was sent `no-store`);
 *  - the response sets no cookie and is not a redirect.
 */
export const NO_STORE = "private, no-store";
export const VISITOR_BROWSE = "private, no-cache";

/** Public browse pages: the two front doors, a part, a build, a post, a profile. */
const BROWSE_PATHS = [
  /^\/$/,
  /^\/marketplace$/,
  /^\/explore$/,
  /^\/listings\/[^/]+$/,
  /^\/cars\/[^/]+(\/activity\/[^/]+)?$/,
  /^\/posts\/[^/]+$/,
  /^\/u\/[^/]+$/,
];

/** A Supabase session cookie, whole or one chunk of it (`sb-<ref>-auth-token`, `.0`, `.1`…). */
export function isSessionCookie(name: string): boolean {
  return /^sb-.+-auth-token(\.\d+)?$/.test(name);
}

export function pageCacheControl(input: {
  method: string;
  pathname: string;
  cookieNames: readonly string[];
  /** The response's status and whether it sets a cookie. */
  status: number;
  setsCookie: boolean;
}): typeof NO_STORE | typeof VISITOR_BROWSE {
  if (input.method !== "GET" && input.method !== "HEAD") return NO_STORE;
  if (input.status < 200 || input.status >= 300 || input.setsCookie) return NO_STORE;
  if (input.cookieNames.some(isSessionCookie)) return NO_STORE;
  return BROWSE_PATHS.some((path) => path.test(input.pathname)) ? VISITOR_BROWSE : NO_STORE;
}
