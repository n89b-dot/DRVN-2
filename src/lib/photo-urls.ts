/**
 * Member photos are private objects since 20261108160000 (N455): a private
 * car's photos, a draft listing's photos and a private car's post photos used
 * to be readable by anyone holding their public URL, though the pages that
 * showed them were not.
 *
 * The database keeps every photo in its one canonical spelling,
 * `<origin>/storage/v1/object/public/<bucket>/<path>`, which stays the
 * object's identity for the reference checks, cleanup, takedowns and the
 * storage report (20261107203000). Only the app sees another spelling: a
 * signed URL, minted after the row was read under the reader's own row
 * policies, so a photo reaches exactly the people who can see the row it
 * belongs to. src/lib/supabase/photo-signing.ts signs on the way out of the
 * database and turns signed URLs back into canonical ones on the way in.
 *
 * These are the pure rules (no server-only import, so they can be tested).
 */

import { MEMBER_JSON_COLUMNS } from "./json-columns";

/** The buckets whose objects are read through signed URLs. Avatars stay public. */
export const SIGNED_PHOTO_BUCKETS = ["car-images", "listing-images", "activity-images"] as const;

/** One signing window: URLs minted inside it are reused until it ends. */
export const SIGNING_WINDOW_SECONDS = 3600;

const BUCKETS = SIGNED_PHOTO_BUCKETS.join("|");
const PATH = "[^\"'\\s\\\\?#<>]+";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The storage origin photo URLs are minted on, or null when unconfigured. */
export function storageOrigin(env: Record<string, string | undefined> = process.env): string | null {
  try {
    return env.NEXT_PUBLIC_SUPABASE_URL ? new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin : null;
  } catch {
    return null;
  }
}

function publicPattern(origin: string, flags = "g"): RegExp {
  return new RegExp(`${escapeRegExp(origin)}/storage/v1/object/public/(${BUCKETS})/(${PATH})`, flags);
}

function signedPattern(origin: string, flags = "g"): RegExp {
  return new RegExp(`${escapeRegExp(origin)}/storage/v1/object/sign/(${BUCKETS})/(${PATH})\\?token=[A-Za-z0-9._~-]+`, flags);
}

/** A decoded object path is safe to name: no empty, `.` or `..` segment, no control characters, \ ? # %. */
function safePath(raw: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (path.length < 3 || path.length > 512 || path.indexOf("/") < 1 || path.endsWith("/") || path.includes("//")) return null;
  if (path.split("/").some((segment) => segment === "." || segment === "..")) return null;
  return /[\u0000-\u001f\u007f-\u009f\\?#%]/.test(path) ? null : path;
}

/**
 * The canonical spelling of a member photo URL: a signed URL for one of our
 * signed photo buckets becomes the public-route URL the database stores.
 * Anything else comes back unchanged.
 */
export function canonicalPhotoUrl<T>(value: T, origin: string | null = storageOrigin()): T {
  if (typeof value !== "string" || !origin) return value;
  const match = signedPattern(origin, "").exec(value);
  if (!match || match.index !== 0 || match[0].length !== value.length) return value;
  const path = safePath(match[2]);
  return (path ? `${origin}/storage/v1/object/public/${match[1]}/${path}` : value) as T;
}

/** Every signed photo URL in a text (a request body, a query string) back to its canonical spelling. */
export function canonicalizePhotoUrlsInText(text: string, origin: string | null = storageOrigin()): string {
  if (!origin || !text.includes("/storage/v1/object/sign/")) return text;
  return text.replace(signedPattern(origin), (whole, bucket: string, raw: string) => {
    const path = safePath(raw);
    return path ? `${origin}/storage/v1/object/public/${bucket}/${path}` : whole;
  });
}

/** The distinct canonical photo URLs a text (a database response) contains, in a signed bucket. */
export function canonicalPhotoUrlsInText(text: string, origin: string | null = storageOrigin()): string[] {
  if (!origin || !text.includes("/storage/v1/object/public/")) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(publicPattern(origin))) {
    if (safePath(match[2])) found.add(match[0]);
  }
  return [...found];
}

/** Replaces each canonical photo URL in a text with its signed spelling, where one was minted. */
export function replacePhotoUrlsInText(text: string, signed: ReadonlyMap<string, string>, origin: string | null = storageOrigin()): string {
  if (!origin || !signed.size) return text;
  return text.replace(publicPattern(origin), (whole) => signed.get(whole) ?? whole);
}

/** (bucket, path) of a canonical photo URL in a signed bucket, or null. */
export function signedPhotoObject(url: string, origin: string | null = storageOrigin()): { bucket: string; path: string } | null {
  if (!origin) return null;
  const match = publicPattern(origin, "").exec(url);
  if (!match || match.index !== 0 || match[0].length !== url.length) return null;
  const path = safePath(match[2]);
  return path ? { bucket: match[1], path } : null;
}

/**
 * The window a URL is minted in and how long to make it last: to the end of
 * the next window, so a page rendered at the end of one window still shows
 * its photos for at least an hour.
 */
export function signingWindow(nowMs: number): { window: number; expiresIn: number } {
  const now = Math.floor(nowMs / 1000);
  const window = Math.floor(now / SIGNING_WINDOW_SECONDS);
  return { window, expiresIn: (window + 2) * SIGNING_WINDOW_SECONDS - now };
}

const UNSIGNED_MEMBER_PHOTO = new RegExp(`/storage/v1/object/public/(?:${BUCKETS})/`);
const MEMBER_PHOTO = new RegExp(`/storage/v1/object/(?:public|sign)/(?:${BUCKETS})/`);

/** A member photo in either spelling (#196 review: only these get the plate on a failed load). */
export function isMemberPhotoSource(src: string | null | undefined): boolean {
  return typeof src === "string" && MEMBER_PHOTO.test(src);
}

/**
 * A member photo still in its canonical spelling: signing failed or a loader
 * read it without the signing wrapper, and the storage layer will refuse it.
 * `Media` shows the no-photo plate for it rather than a broken image (#105).
 * Origin-agnostic on purpose, so it works in the browser bundle too.
 */
export function isUnsignedMemberPhoto(src: string | null | undefined): boolean {
  return typeof src === "string" && UNSIGNED_MEMBER_PHOTO.test(src);
}

/**
 * Which values in a database answer may be signed (#178 review; #196 review).
 * The rule: a value is signed only when
 *   (a) it sits at a column or JSON path a DATABASE guard owner-checks on
 *       write (member_media_ref_ok and guard_member_post_body_media,
 *       20261107203000), and
 *   (b) where the row's owner is known (owner_id, seller_id or author_id on
 *       the nearest object that has one), the photo's folder is that owner.
 * Everything else stays canonical, which the storage layer refuses.
 *
 * (a) in practice: the guarded columns url, image_url and cover_image_url
 * (and the RPC aliases image, cover and cover_url, which read them), never
 * anything inside a JSON column, except a post body's images block `urls` and
 * its before/after `beforeUrl` / `afterUrl`, the only JSON paths the body
 * guard checks. src/lib/photo-urls.test.ts holds both lists to the schema.
 */
export const GUARDED_PHOTO_COLUMNS = new Set(["url", "image_url", "cover_image_url", "image", "cover", "cover_url"]);
/** The member-writable JSON columns (src/lib/json-columns.ts). */
export const JSON_COLUMNS = new Set<string>(MEMBER_JSON_COLUMNS);
const OWNER_KEYS = ["owner_id", "seller_id", "author_id"] as const;

type Walk = { key: string | null; holder: Record<string, unknown> | null; json: string | null; owner: string | null };

/** Whether a value at this place may be signed (rule (a)). */
export function isPhotoFieldKey(key: string | null, holder: Record<string, unknown> | null, json: string | null = null): boolean {
  if (!key) return false;
  if (json === null) return GUARDED_PHOTO_COLUMNS.has(key);
  if (json !== "body" || !holder) return false;
  return (key === "urls" && holder.type === "images") || ((key === "beforeUrl" || key === "afterUrl") && holder.type === "before_after");
}

function isWholeCanonicalPhoto(value: string, origin: string): boolean {
  return value.startsWith(origin) && signedPhotoObject(value, origin) !== null;
}

/** Rule (b): the photo's folder is the known owner's. */
function ownedBy(value: string, owner: string | null, origin: string): boolean {
  return owner === null || signedPhotoObject(value, origin)?.path.split("/")[0] === owner;
}

function walk(value: unknown, origin: string, onPhoto: (url: string) => string | void): unknown {
  const visit = (node: unknown, at: Walk): unknown => {
    if (typeof node === "string") {
      if (isPhotoFieldKey(at.key, at.holder, at.json) && isWholeCanonicalPhoto(node, origin) && ownedBy(node, at.owner, origin)) {
        return onPhoto(node) ?? node;
      }
      return node;
    }
    if (Array.isArray(node)) return node.map((item) => visit(item, at));
    if (node && typeof node === "object") {
      const object = node as Record<string, unknown>;
      const ownKey = at.json === null ? OWNER_KEYS.find((k) => typeof object[k] === "string") : undefined;
      const owner = ownKey ? (object[ownKey] as string) : at.owner;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(object)) {
        const json = at.json ?? (JSON_COLUMNS.has(k) && v !== null && typeof v === "object" ? k : null);
        out[k] = visit(v, { key: k, holder: object, json, owner });
      }
      return out;
    }
    return node;
  };
  return visit(value, { key: null, holder: null, json: null, owner: null });
}

/** The canonical photo URLs held at signable places of a parsed answer. */
export function photoFieldUrls(value: unknown, origin: string | null = storageOrigin()): string[] {
  if (!origin) return [];
  const found = new Set<string>();
  walk(value, origin, (url) => { found.add(url); });
  return [...found];
}

/** The same answer with each signable photo replaced by its signed spelling, where one was minted. */
export function replacePhotoFields<T>(value: T, signed: ReadonlyMap<string, string>, origin: string | null = storageOrigin()): T {
  if (!origin || !signed.size) return value;
  return walk(value, origin, (url) => signed.get(url)) as T;
}

const SIGNED_ROUTE = new RegExp(`/storage/v1/object/sign/(?:${BUCKETS})/[^?#]+\\?(?:[^#]*&)?token=([A-Za-z0-9._~-]+)`);

/**
 * Whether an image source is a member-photo link whose token has run out, or
 * can't be read (#178 review, P2). Next keeps a resized copy for the larger
 * of its TTL and the object's own Cache-Control, so an old link could keep
 * serving a photo long after it expired, including after its car went
 * private. The proxy refuses such a source before the optimiser can answer
 * from its cache. A token with a later expiry that wasn't minted by Storage
 * misses the cache and is refused by Storage itself.
 */
export function signedPhotoLinkExpired(source: string | null, nowMs = Date.now()): boolean {
  if (!source) return false;
  const match = SIGNED_ROUTE.exec(source);
  if (!match) return false;
  try {
    const payload = match[1].split(".")[1];
    if (!payload) return true;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    return typeof json.exp !== "number" || json.exp * 1000 <= nowMs;
  } catch {
    return true;
  }
}

