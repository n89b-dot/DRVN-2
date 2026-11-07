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
  const isolatedLocal = process.env.E2E_TEST_PROJECT_REF === "local-drvn-remediation" && ["127.0.0.1", "localhost"].includes(parsed.hostname) && parsed.port === "54321";
  if (parsed.protocol !== "https:" && !(isolatedLocal && parsed.protocol === "http:")) return false;

  const host = supabaseStorageHost();
  // Missing configuration cannot establish ownership. Fail closed.
  if (!host) return false;

  return parsed.host === host && parsed.pathname.includes("/storage/v1/object/");
}

/**
 * Buckets that use `users upload to own folder`-style RLS, where the first
 * path segment after the bucket is `auth.uid()::text` (see the storage
 * policies in supabase/migrations/0001_v3_schema.sql, unchanged by
 * 0006_security_hardening.sql). Every bucket client uploads land in.
 */
export const OWNED_STORAGE_BUCKETS = [
  "avatars",
  "car-images",
  "activity-images",
  "listing-images",
  "dispute-evidence",
  // Private conversation photos, `<sender>/<recipient>/<file>` (20260928140000)
  // — ledgered like any upload so an unsent photo is reclaimed after 48h.
  "message-photos",
];

/** The public buckets: the only ones a stored photo URL may point into. */
export const PUBLIC_MEDIA_BUCKETS = ["avatars", "car-images", "activity-images", "listing-images"];

/** One storage object: its bucket and decoded object path. */
export type StorageObjectRef = { bucket: string; path: string };

/**
 * Every spelling of a storage-object URL: the public, signed and
 * authenticated object routes and the image-render route, with any query or
 * fragment. Mirrors `private.media_object_key` in
 * supabase/migrations/20261107203000_media_integrity.sql — the two must
 * agree, because the database's reference check and this module's deletion
 * target have to name the same object (N99).
 */
const OBJECT_URL_RE =
  /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]+\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/([a-z0-9_-]{1,63})\/([^?#]+)/;

/** A decoded object path DRVN will name: `<folder>/<file>` at least, no
 *  empty, `.` or `..` segment, no control characters and none of \ ? # %. */
export function isCanonicalObjectPath(path: unknown): path is string {
  if (typeof path !== "string" || path.length < 3 || path.length > 512) return false;
  if (path.indexOf("/") < 1 || path.endsWith("/") || path.includes("//")) return false;
  if (path.split("/").some((segment) => segment === "." || segment === "..")) return false;
  return !/[\u0000-\u001f\u007f-\u009f\\?#%]/.test(path);
}

/**
 * The canonical identity of a storage URL: (bucket, percent-decoded path),
 * whatever route, query or encoding it was spelled with. Null when it names
 * no object we would ever act on. The host is NOT checked here — callers
 * that accept or delete check `isOwnStorageUrl` too.
 */
export function canonicalStorageObject(value: unknown): StorageObjectRef | null {
  if (typeof value !== "string" || !value || value.length > 2000) return null;
  const match = value.match(OBJECT_URL_RE);
  if (!match) return null;
  const [, bucket, rawPath] = match;
  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  return isCanonicalObjectPath(path) ? { bucket, path } : null;
}

/** `<bucket>/<path>` — the key both sides of a reference check compare. */
export function storageObjectKey(ref: StorageObjectRef): string {
  return `${ref.bucket}/${ref.path}`;
}

/**
 * True for the one spelling DRVN stores: our storage origin, the public
 * object route, a path that needs no percent-encoding, and nothing after it.
 * This is exactly what `getPublicUrl` returns for the paths uploads mint, and
 * what the database accepts in a member's photo columns (20261107203000).
 */
export function isCanonicalPublicStorageUrl(value: unknown): value is string {
  if (!isOwnStorageUrl(value)) return false;
  const ref = canonicalStorageObject(value);
  if (!ref) return false;
  const { origin } = new URL(value);
  return value === `${origin}/storage/v1/object/public/${ref.bucket}/${ref.path}`;
}

/**
 * True for a storage URL that is ours, in its canonical public spelling, in a
 * bucket members upload to, AND whose uploader folder (the first path
 * segment) is `userId`. Host + path checks alone only prove a URL points at
 * *some* object in our storage — anyone could copy another user's public
 * photo URL and submit it as their own. Storage RLS keys the uploader folder
 * to `auth.uid()`, so requiring that folder to equal the current user is what
 * actually proves ownership. A dressed-up spelling (query, fragment, encoded
 * characters) is refused rather than stored: it would name the same object
 * as the plain URL but match no stored reference.
 */
export function isOwnedStorageUrl(value: unknown, userId: string): value is string {
  if (!userId || !isCanonicalPublicStorageUrl(value)) return false;
  const ref = canonicalStorageObject(value)!;
  return OWNED_STORAGE_BUCKETS.includes(ref.bucket) && ref.path.split("/")[0] === userId;
}

/**
 * Where a share image (opengraph-image.tsx) may fetch a photo from: only a
 * canonical public object on our own storage, in a public bucket. Anything
 * else — another host, a private bucket, an internal address a stored URL was
 * pointed at — renders the card without a photo (N55: SSRF).
 */
export function ogImageSource(value: unknown): string | null {
  if (!isCanonicalPublicStorageUrl(value)) return null;
  const ref = canonicalStorageObject(value)!;
  return PUBLIC_MEDIA_BUCKETS.includes(ref.bucket) ? value : null;
}

/**
 * dispute-evidence went private in 0027 (P0: it was a public bucket — see
 * supabase/migrations/0027_evidence_privacy.sql). A private object has no
 * fetchable "public" URL, so the upload flow submits the bare object path
 * instead of calling `getPublicUrl`. Since 20261107203000 Storage only takes
 * evidence at `<uploader>/<order>/<file>` while that order is disputed, so a
 * path attached to an order must be the uploader's own, for that order.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EVIDENCE_FILE_RE = /^[A-Za-z0-9_-]{1,80}\.[A-Za-z0-9]{1,10}$/;

export function isOwnedDisputeEvidenceRef(value: unknown, userId: string, orderId: string): value is string {
  if (typeof value !== "string" || !value || !userId || !orderId) return false;
  const parts = value.split("/");
  return (
    parts.length === 3 &&
    parts[0] === userId &&
    parts[1] === orderId &&
    UUID_RE.test(orderId) &&
    EVIDENCE_FILE_RE.test(parts[2])
  );
}

/**
 * Filters a client-supplied list down to URLs we're willing to persist. When
 * `userId` is given, also requires each URL to be owned by that user — pass
 * it at every call site that persists client-supplied URLs.
 */
export function keepValidImageUrls(values: unknown, max = 12, userId?: string): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((v): v is string => (userId ? isOwnedStorageUrl(v, userId) : isCanonicalPublicStorageUrl(v)))
    .slice(0, max);
}

/**
 * Splits a storage URL on our own host back into its bucket + object path —
 * the shape the storage API's remove() wants. Any spelling of the URL
 * resolves to the same object (`canonicalStorageObject`); a URL on a host we
 * don't own returns null, so callers can't be steered into deleting objects
 * there.
 */
export function parseStorageObject(value: unknown): StorageObjectRef | null {
  if (!isOwnStorageUrl(value)) return null;
  return canonicalStorageObject(value);
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
    if (userId ? !isOwnedStorageUrl(url, userId) : !isCanonicalPublicStorageUrl(url)) continue;
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
    const isolatedLocal = process.env.E2E_TEST_PROJECT_REF === "local-drvn-remediation" && ["127.0.0.1", "localhost"].includes(parsed.hostname) && parsed.port === "54321";
  if (parsed.protocol !== "https:" && !(isolatedLocal && parsed.protocol === "http:")) return false;
    return ["youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com"].includes(parsed.host);
  } catch {
    return false;
  }
}
