/**
 * Same-origin redirect targets only.
 *
 * Prefix checks alone were not enough: `//evil.com` is a protocol-relative
 * URL, and the URL parser strips tabs and newlines before it looks, so
 * `/\t/evil.com` (sent as `next=/%09/evil.com`) passed every prefix check and
 * then parsed as `https://evil.com/` (readiness N19). So the value is
 * refused outright when it carries a control character or a backslash, in
 * its raw or once-decoded form, and what survives is resolved against a
 * fixed trusted origin the way a browser would resolve it: anything that
 * lands on another origin is refused. The result is the resolved path, so
 * the browser receives exactly what was checked.
 */
const TRUSTED_ORIGIN = "https://drvn.invalid";

/** C0 controls (tab, newline, carriage return, NUL…), DEL and backslashes. */
const UNSAFE = /[\u0000-\u001f\u007f\\]/;

function decodedOnce(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed escape means the value was not produced by our own links.
    return null;
  }
}

export function safeRedirectPath(value: unknown, fallback = "/home"): string {
  if (typeof value !== "string") return fallback;

  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//")) return fallback;
  if (UNSAFE.test(path)) return fallback;
  // The value has usually been decoded once already (a query parameter), but
  // a destination is often carried inside another link's `next` and decoded
  // again on the far side: refuse what would become dangerous after one more.
  const decoded = decodedOnce(path);
  if (decoded === null || UNSAFE.test(decoded) || decoded.startsWith("//")) return fallback;
  // Rules out any scheme smuggled into the path, e.g. `/javascript:alert(1)`.
  if (path.includes(":") || decoded.includes(":")) return fallback;

  let resolved: URL;
  try {
    resolved = new URL(path, TRUSTED_ORIGIN);
  } catch {
    return fallback;
  }
  if (resolved.origin !== TRUSTED_ORIGIN) return fallback;

  const result = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  return result.startsWith("//") ? fallback : result;
}

/**
 * `/onboarding` with a validated internal destination attached, so an account
 * created halfway through making an offer still lands back on that listing
 * instead of being dropped on /home. Nothing reaches the query string that
 * `safeRedirectPath` hasn't already vetted.
 */
export function onboardingPath(requested?: unknown): string {
  const next = safeRedirectPath(requested, "");
  return next ? `/onboarding?next=${encodeURIComponent(next)}` : "/onboarding";
}
