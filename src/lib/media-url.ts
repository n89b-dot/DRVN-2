/**
 * Validation for image URLs that arrive from the client.
 *
 * Uploads happen browser-side and only the resulting URL is posted to a server
 * action, so the string is user-controlled. Storing it unchecked allowed
 * off-site hotlinking, tracking beacons and `data:` payloads to be rendered on
 * public pages. React escapes attributes so this was never XSS — it is a
 * content-integrity and privacy problem.
 */

function supabaseStorageHost(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** True for an https URL on our own Supabase storage host. */
export function isOwnStorageUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;

  const host = supabaseStorageHost();
  // Without configuration we cannot verify provenance, so accept any https URL
  // rather than breaking local development against a proxy.
  if (!host) return true;

  return parsed.host === host && parsed.pathname.includes("/storage/v1/object/");
}

/** Filters a client-supplied list down to URLs we're willing to persist. */
export function keepValidImageUrls(values: unknown, max = 12): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter(isOwnStorageUrl).slice(0, max);
}

/** Embeddable video links — currently YouTube only, matching the renderer. */
export function isAllowedVideoUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;
    return ["youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com"].includes(parsed.host);
  } catch {
    return false;
  }
}
