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

/**
 * Buckets that use `users upload to own folder`-style RLS, where the first
 * path segment after the bucket is `auth.uid()::text` (see the storage
 * policies in supabase/migrations/0001_v3_schema.sql, unchanged by
 * 0006_security_hardening.sql). Every bucket client uploads land in.
 */
const OWNED_STORAGE_BUCKETS = [
  "avatars",
  "car-images",
  "activity-images",
  "listing-images",
  "dispute-evidence",
];

/**
 * True for a storage URL that is both ours (`isOwnStorageUrl`) AND whose
 * object path's uploader folder matches `userId`. Host + path checks alone
 * only prove a URL points at *some* object in our storage — anyone could copy
 * another user's public avatar or photo URL and submit it as their own.
 * Storage RLS keys the uploader folder to `auth.uid()`, so requiring that
 * folder to equal the current user is what actually proves ownership.
 */
export function isOwnedStorageUrl(value: unknown, userId: string): value is string {
  if (!isOwnStorageUrl(value) || !userId) return false;

  const parsed = new URL(value);
  const match = parsed.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/([^/]+)\//);
  if (!match) return false;

  const [, bucket, folder] = match;
  return OWNED_STORAGE_BUCKETS.includes(bucket) && folder === userId;
}

/**
 * dispute-evidence went private in 0027 (P0: it was a public bucket — see
 * supabase/migrations/0027_evidence_privacy.sql). A private object has no
 * fetchable "public" URL, so the upload flow submits the bare object path
 * ('{uid}/{filename}', the same shape `storage.foldername` parses in the
 * storage RLS policy) instead of calling `getPublicUrl`. This validates that
 * path form and, for old rows still shaped as full URLs, falls back to the
 * existing `isOwnedStorageUrl` check — legacy data isn't rewritten by this
 * function, only accepted where it happens to still be readable this way.
 */
const DISPUTE_EVIDENCE_PATH_RE = /^([^/]+)\/[^/.]+\.[a-zA-Z0-9]+$/;

export function isOwnedDisputeEvidenceRef(value: unknown, userId: string): value is string {
  if (typeof value !== "string" || !value || !userId) return false;
  const match = value.match(DISPUTE_EVIDENCE_PATH_RE);
  if (match) return match[1] === userId;
  return isOwnedStorageUrl(value, userId);
}

/**
 * Filters a client-supplied list down to URLs we're willing to persist. When
 * `userId` is given, also requires each URL to be owned by that user — pass
 * it at every call site that persists client-supplied URLs.
 */
export function keepValidImageUrls(values: unknown, max = 12, userId?: string): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((v): v is string => (userId ? isOwnedStorageUrl(v, userId) : isOwnStorageUrl(v)))
    .slice(0, max);
}

/**
 * Splits a public storage URL back into its bucket + object path — the shape
 * the storage API's remove() wants. Only URLs that pass `isOwnStorageUrl`
 * resolve; anything else returns null so callers can't be steered into
 * deleting objects on a host we don't own.
 */
export function parseStorageObject(value: unknown): { bucket: string; path: string } | null {
  if (!isOwnStorageUrl(value)) return null;
  const match = new URL(value).pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const [, bucket, rawPath] = match;
  const path = decodeURIComponent(rawPath);
  if (!path || path.includes("..")) return null;
  return { bucket, path };
}

export type GalleryImageInput = { url: string; alt: string | null };

/**
 * Filters a client-supplied ordered gallery (url + alt pairs) down to entries
 * we're willing to persist. Array order is preserved and becomes the
 * `position` each row is saved with, so this also gates reorder/cover input.
 */
export function keepValidGalleryImages(
  values: unknown,
  max = 12,
  userId?: string
): GalleryImageInput[] {
  if (!Array.isArray(values)) return [];
  const out: GalleryImageInput[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const url = (value as Record<string, unknown>).url;
    if (typeof url !== "string") continue;
    if (userId ? !isOwnedStorageUrl(url, userId) : !isOwnStorageUrl(url)) continue;
    const altRaw = (value as Record<string, unknown>).alt;
    const alt = typeof altRaw === "string" ? altRaw.trim().slice(0, 200) || null : null;
    out.push({ url, alt });
    if (out.length >= max) break;
  }
  return out;
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
