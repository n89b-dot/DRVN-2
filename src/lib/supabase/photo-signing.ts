import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { reportError } from "@/lib/monitoring";
import {
  canonicalizePhotoUrlsInText,
  canonicalPhotoUrlsInText,
  replacePhotoUrlsInText,
  signedPhotoObject,
  signingWindow,
  storageOrigin,
} from "@/lib/photo-urls";

/**
 * Member photos are private objects (N455, 20261108160000); this is where
 * they become readable, and only for rows the reader could already read.
 *
 * `photoFetch` wraps a Supabase client's fetch at the database boundary:
 *  - on the way in (every PostgREST request), any signed photo URL in the
 *    body is turned back into its canonical spelling, so the database only
 *    ever stores and compares canonical URLs, whoever wrote them;
 *  - on the way out (`sign: true`), every canonical photo URL in a
 *    response is replaced by a signed URL. The rows were returned under the
 *    reader's own row policies (or, for the console, after the admin gate),
 *    so this is the visibility check the page already made, applied once.
 *
 * Signed URLs are minted in batches per bucket and reused for the rest of the
 * hour-long signing window, so one photo keeps one URL for the hour (the
 * image optimiser and browsers can cache it), and each lasts to the end of
 * the next window. "One URL" holds across server instances (#117): a
 * process memo sits in front of a shared one in the database
 * (20261110100000, `photo_signatures_read` / `_offer`), where the first
 * instance to sign a photo in a window wins and every other reads its URL.
 * If the shared memo is unreachable, the instance signs on its own, as before.
 *
 * A photo that can't be signed keeps its canonical URL, which the storage
 * layer refuses. That is reported here, and `Media` shows the no-photo plate
 * for it instead of a broken image (src/components/ui/primitives.tsx).
 */

type Signed = { window: number; url: string };

const MAX_MEMO = 20_000;
const memo = new Map<string, Signed>();

let signer: ReturnType<typeof createSupabaseClient> | null = null;
function signingClient() {
  if (!signer) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Photo signing needs the Supabase URL and secret key");
    signer = createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return signer;
}

/**
 * Signed URLs for canonical photo URLs, keyed by the canonical URL. A URL
 * that isn't a member photo, or that Storage would not sign, is left out (the
 * caller keeps the canonical URL, which renders as a missing photo rather
 * than failing the page).
 */
export async function signedPhotoUrls(
  urls: readonly string[],
  nowMs = Date.now(),
  /** A fixed life instead of the window's, minted fresh and never shared (the account export). */
  fixedExpiresIn?: number
): Promise<Map<string, string>> {
  const windowed = signingWindow(nowMs);
  const window = fixedExpiresIn ? -1 : windowed.window;
  const expiresIn = fixedExpiresIn ?? windowed.expiresIn;
  const out = new Map<string, string>();
  const missing = new Map<string, { path: string; url: string }[]>();
  for (const url of new Set(urls)) {
    const cached = fixedExpiresIn ? undefined : memo.get(url);
    if (cached && cached.window === window) {
      out.set(url, cached.url);
      continue;
    }
    const object = signedPhotoObject(url);
    if (!object) continue;
    missing.set(object.bucket, [...(missing.get(object.bucket) ?? []), { path: object.path, url }]);
  }
  if (!missing.size) return out;

  if (memo.size > MAX_MEMO) {
    for (const [key, value] of memo) if (value.window !== window) memo.delete(key);
    if (memo.size > MAX_MEMO) memo.clear();
  }

  const keep = (url: string, signed: string) => {
    out.set(url, signed);
    if (!fixedExpiresIn) memo.set(url, { window, url: signed });
  };
  const urlByObject = new Map<string, string>();
  for (const [bucket, objects] of missing) for (const o of objects) urlByObject.set(`${bucket}/${o.path}`, o.url);

  // The shared memo first: another instance may already have signed these.
  if (!fixedExpiresIn) {
    const known = await sharedSignatures("photo_signatures_read", window, [...missing].flatMap(([bucket, objects]) => objects.map((o) => ({ bucket, path: o.path }))));
    for (const row of known) {
      const url = urlByObject.get(`${row.bucket}/${row.path}`);
      if (url) keep(url, row.signed_url);
    }
  }

  const minted: { bucket: string; path: string; signed_url: string }[] = [];
  await Promise.all(
    [...missing].map(async ([bucket, all]) => {
      const objects = all.filter((o) => !out.has(o.url));
      if (!objects.length) return;
      try {
        const { data, error } = await signingClient()
          .storage.from(bucket)
          .createSignedUrls(objects.map((o) => o.path), expiresIn);
        if (error) throw error;
        const byPath = new Map((data ?? []).filter((d) => d.signedUrl && !d.error).map((d) => [d.path, d.signedUrl]));
        const refused = objects.filter((o) => !byPath.has(o.path));
        if (refused.length) reportError("[photos] storage would not sign some photos", { bucket, count: refused.length });
        for (const object of objects) {
          const signed = byPath.get(object.path);
          if (signed) minted.push({ bucket, path: object.path, signed_url: signed });
        }
      } catch (error) {
        reportError("[photos] signing failed", { bucket, count: objects.length, error });
      }
    })
  );
  if (!minted.length) return out;
  if (fixedExpiresIn) {
    for (const m of minted) out.set(urlByObject.get(`${m.bucket}/${m.path}`)!, m.signed_url);
    return out;
  }
  // Offer what this instance minted; where another instance won the race, its URL is the one shown.
  const winners = new Map((await sharedSignatures("photo_signatures_offer", window, minted)).map((row) => [`${row.bucket}/${row.path}`, row.signed_url]));
  for (const m of minted) {
    const key = `${m.bucket}/${m.path}`;
    keep(urlByObject.get(key)!, winners.get(key) ?? m.signed_url);
  }
  return out;
}

type SharedRow = { bucket: string; path: string; signed_url: string };
let sharedUnavailableReported = false;
/** After a failure, sign per instance for a while instead of paying for a call that fails. */
let sharedRetryAt = 0;
const SHARED_RETRY_MS = 5 * 60_000;

/** The shared memo's read or offer; on any failure, nothing (this instance's own URLs stand). */
async function sharedSignatures(
  fn: "photo_signatures_read" | "photo_signatures_offer",
  window: number,
  objects: readonly { bucket: string; path: string; signed_url?: string }[],
): Promise<SharedRow[]> {
  if (!objects.length || Date.now() < sharedRetryAt) return [];
  try {
    const args = fn === "photo_signatures_read" ? { p_window: window, p_objects: objects } : { p_window: window, p_signed: objects };
    // The shared memo's functions are not in the generated types' public schema client used here.
    const { data, error } = await (signingClient() as unknown as { rpc: (f: string, a: unknown) => Promise<{ data: SharedRow[] | null; error: unknown }> }).rpc(fn, args);
    if (error) throw error;
    return data ?? [];
  } catch (error) {
    sharedRetryAt = Date.now() + SHARED_RETRY_MS;
    if (!sharedUnavailableReported) {
      sharedUnavailableReported = true;
      reportError("[photos] shared signing memo unavailable; signing per instance", { fn, error });
    }
    return [];
  }
}

/** One signed photo URL; anything that isn't a member photo comes back as it was. */
export async function signedPhotoUrl<T extends string | null | undefined>(url: T): Promise<T> {
  if (!url) return url;
  return ((await signedPhotoUrls([url])).get(url) ?? url) as T;
}

/** Every canonical photo URL inside a text (a JSON body) signed, in one batch per bucket. */
export async function signPhotoUrlsInText(text: string): Promise<string> {
  const urls = canonicalPhotoUrlsInText(text);
  if (!urls.length) return text;
  return replacePhotoUrlsInText(text, await signedPhotoUrls(urls));
}

/** Every canonical photo URL in a value (rows, nested objects) signed. */
export async function signPhotosIn<T>(value: T): Promise<T> {
  if (value == null) return value;
  const text = JSON.stringify(value);
  const signed = await signPhotoUrlsInText(text);
  return signed === text ? value : (JSON.parse(signed) as T);
}

/** How long a photo link in a member's data export opens for: the export's own download life. */
export const EXPORT_PHOTO_LINK_SECONDS = 7 * 24 * 60 * 60;

/**
 * A member's own photos in their data export (N455): the stored canonical
 * URL no longer opens, so each becomes a link that opens for seven days. The
 * rows were selected for the requesting member only, by the export's own
 * ownership filters.
 */
export async function signPhotosForExport<T>(value: T, nowMs = Date.now()): Promise<T> {
  if (value == null) return value;
  const text = JSON.stringify(value);
  const urls = canonicalPhotoUrlsInText(text);
  if (!urls.length) return value;
  return JSON.parse(replacePhotoUrlsInText(text, await signedPhotoUrls(urls, nowMs, EXPORT_PHOTO_LINK_SECONDS))) as T;
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/** A Supabase client fetch that keeps canonical photo URLs in the database and, with `sign`, hands out signed ones. */
export function photoFetch(base: typeof fetch, options: { sign: boolean }): typeof fetch {
  return async (input, init) => {
    if (!storageOrigin() || !requestUrl(input).includes("/rest/v1/")) return base(input, init);
    const body = init?.body;
    const outbound =
      typeof body === "string" && body.includes("/storage/v1/object/sign/")
        ? { ...init, body: canonicalizePhotoUrlsInText(body) }
        : init;
    const response = await base(input, outbound);
    if (!options.sign || !response.ok || response.body == null || [204, 205, 304].includes(response.status)) return response;
    if (!(response.headers.get("content-type") ?? "").includes("json")) return response;
    const text = await response.text();
    const signed = await signPhotoUrlsInText(text);
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(signed, { status: response.status, statusText: response.statusText, headers });
  };
}
