import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { reportError } from "@/lib/monitoring";
import {
  canonicalizePhotoUrlsInText,
  photoFieldUrls,
  replacePhotoFields,
  signedPhotoObject,
  signingContext,
  signingWindow,
  storageOrigin,
  type SigningContext,
} from "@/lib/photo-urls";

/**
 * Member photos are private objects (N455, 20261108160000); this is where
 * they become readable, and only for rows the reader could already read.
 *
 * `photoFetch` wraps a Supabase client's fetch at the database boundary:
 *  - on the way in (every PostgREST request), any signed photo URL in the
 *    body is turned back into its canonical spelling, so the database only
 *    ever stores and compares canonical URLs, whoever wrote them;
 *  - on the way out (`sign: true`), the canonical photo URLs at the places
 *    the database guards for that table or RPC (src/lib/photo-urls.ts,
 *    PHOTO_POSITIONS; N940) are replaced by signed URLs. The rows were returned under the
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

/** `localUntil`: a link only this process holds (the shared memo was down); used until then, then the shared memo is asked again. */
type Signed = { window: number; url: string; localUntil?: number };

const MAX_MEMO = 20_000;
const memo = new Map<string, Signed>();

let signer: ReturnType<typeof createSupabaseClient> | null = null;
function signingClient() {
  if (!signer) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Photo signing needs the Supabase URL and secret key");
    // Bounded like the admin client: a stalled Storage or memo call must not hang a render.
    const timed: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(10_000) });
    signer = createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timed } });
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
    if (cached && cached.window === window && (cached.localUntil === undefined || Date.now() < cached.localUntil)) {
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
    for (const row of known ?? []) {
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
  const offered = await sharedSignatures("photo_signatures_offer", window, minted);
  if (!offered) {
    // Not stored in the shared memo: remembered here only until the shared
    // memo is tried again (#196 review), so an outage doesn't mean signing
    // afresh on every render, and once it's back this process adopts the
    // shared link rather than keeping its own for the rest of the window.
    const localUntil = Math.max(sharedRetryAt, Date.now() + 1);
    for (const m of minted) {
      const url = urlByObject.get(`${m.bucket}/${m.path}`)!;
      out.set(url, m.signed_url);
      memo.set(url, { window, url: m.signed_url, localUntil });
    }
    return out;
  }
  const winners = new Map(offered.map((row) => [`${row.bucket}/${row.path}`, row.signed_url]));
  for (const m of minted) {
    const key = `${m.bucket}/${m.path}`;
    keep(urlByObject.get(key)!, winners.get(key) ?? m.signed_url);
  }
  return out;
}

type SharedRow = { bucket: string; path: string; signed_url: string };
/** A shared-memo call that takes longer than this is given up for this response. */
export const SHARED_BUDGET_MS = 1_500;
/** After a failure, a short pause before the next call (a missing function, an outage), not a long one. */
const SHARED_RETRY_MS = 30_000;
/** Failures are reported at most this often, with how many there were since the last report. */
const SHARED_REPORT_MS = 10 * 60_000;
let sharedRetryAt = 0;
let sharedReportedAt = 0;
let sharedFailures = 0;

/**
 * The shared memo's read or offer. Null when it can't be asked or failed
 * (this response signs on its own, and remembers nothing); otherwise its rows.
 */
async function sharedSignatures(
  fn: "photo_signatures_read" | "photo_signatures_offer",
  window: number,
  objects: readonly { bucket: string; path: string; signed_url?: string }[],
): Promise<SharedRow[] | null> {
  if (!objects.length) return [];
  if (Date.now() < sharedRetryAt) return null;
  try {
    const args = fn === "photo_signatures_read" ? { p_window: window, p_objects: objects } : { p_window: window, p_signed: objects };
    type Call = { abortSignal: (signal: AbortSignal) => PromiseLike<{ data: SharedRow[] | null; error: unknown }> };
    const call = (signingClient() as unknown as { rpc: (f: string, a: unknown) => Call }).rpc(fn, args);
    const { data, error } = await call.abortSignal(AbortSignal.timeout(SHARED_BUDGET_MS));
    if (error) throw error;
    return data ?? [];
  } catch (error) {
    sharedRetryAt = Date.now() + SHARED_RETRY_MS;
    sharedFailures += 1;
    if (Date.now() - sharedReportedAt >= SHARED_REPORT_MS) {
      reportError("[photos] shared signing memo failed; signing per response", { fn, failures: sharedFailures, error });
      sharedReportedAt = Date.now();
      sharedFailures = 0;
    }
    return null;
  }
}

/** One signed photo URL; anything that isn't a member photo comes back as it was. */
export async function signedPhotoUrl<T extends string | null | undefined>(url: T): Promise<T> {
  if (!url) return url;
  return ((await signedPhotoUrls([url])).get(url) ?? url) as T;
}

/**
 * The photo fields of a JSON answer signed, in one batch per bucket. Only
 * whole values at the places the database guards, for this answer's table or
 * RPC (src/lib/photo-urls.ts, PHOTO_POSITIONS): a photo URL written into
 * prose, a profile link, a JSON column or any other member-written field
 * stays canonical, which the storage layer refuses (#178 and #196 reviews).
 * Text that isn't JSON, or an answer with no known context, is left as it is.
 */
export async function signPhotoUrlsInText(text: string, context: SigningContext | null): Promise<string> {
  if (!context || !text.includes("/storage/v1/object/public/")) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  const urls = photoFieldUrls(parsed, context);
  if (!urls.length) return text;
  return JSON.stringify(replacePhotoFields(parsed, context, await signedPhotoUrls(urls)));
}

/** How long a photo link in a member's data export opens for: the export's own download life. */
export const EXPORT_PHOTO_LINK_SECONDS = 7 * 24 * 60 * 60;

/**
 * A member's own photos in their data export (N455): the stored canonical
 * URL no longer opens, so each becomes a link that opens for seven days. The
 * rows were selected for the requesting member only, by the export's own
 * ownership filters, from `context` (the section's table and projection).
 * Only guarded photo places are linked, and only objects in the member's own
 * folder: another member's photo URL the member wrote into a comment, or
 * another member's photo on a row the export carries, is not (#178 review).
 */
export async function signPhotosForExport<T>(value: T, ownerId: string, context: SigningContext | null, nowMs = Date.now()): Promise<T> {
  if (value == null || !context) return value;
  // The member's own objects only: their folder is the path's first segment.
  const urls = photoFieldUrls(value, context).filter((url) => signedPhotoObject(url)?.path.split("/")[0] === ownerId);
  if (!urls.length) return value;
  return replacePhotoFields(value, context, await signedPhotoUrls(urls, nowMs, EXPORT_PHOTO_LINK_SECONDS));
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
    // The table or RPC this answers, in the public schema only (another
    // schema's same-named table isn't the one the guards cover).
    const headers0 = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const profile = headers0.get("accept-profile") ?? headers0.get("content-profile");
    const context = profile && profile !== "public" ? null : signingContext(requestUrl(input));
    if (!context) return response;
    const text = await response.text();
    const signed = await signPhotoUrlsInText(text, context);
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(signed, { status: response.status, statusText: response.statusText, headers });
  };
}
