/**
 * Same-origin redirect targets only.
 *
 * `startsWith("/")` is not sufficient on its own: `//evil.com` is a
 * protocol-relative URL that browsers happily send off-site, which turns any
 * `?next=` parameter into an open redirect for phishing.
 */
export function safeRedirectPath(value: unknown, fallback = "/home"): string {
  if (typeof value !== "string") return fallback;

  const path = value.trim();
  if (!path.startsWith("/")) return fallback;
  if (path.startsWith("//")) return fallback;
  // Rules out `/\evil.com` (some browsers normalise the backslash) and any
  // scheme smuggled into the path, e.g. `/javascript:alert(1)`.
  if (path.startsWith("/\\")) return fallback;
  if (path.includes(":")) return fallback;

  return path;
}
