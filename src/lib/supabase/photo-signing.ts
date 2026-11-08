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
 * hour-long signing window in this process, so one photo keeps one URL for
 * the hour (the image optimiser and browsers can cache it), and each lasts to
 * the end of the next window.
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
export async function signedPhotoUrls(urls: readonly string[], nowMs = Date.now()): Promise<Map<string, string>> {
  const { window, expiresIn } = signingWindow(nowMs);
  const out = new Map<string, string>();
  const missing = new Map<string, { path: string; url: string }[]>();
  for (const url of new Set(urls)) {
    const cached = memo.get(url);
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
  await Promise.all(
    [...missing].map(async ([bucket, objects]) => {
      try {
        const { data, error } = await signingClient()
          .storage.from(bucket)
          .createSignedUrls(objects.map((o) => o.path), expiresIn);
        if (error) throw error;
        const byPath = new Map((data ?? []).filter((d) => d.signedUrl && !d.error).map((d) => [d.path, d.signedUrl]));
        for (const object of objects) {
          const signed = byPath.get(object.path);
          if (!signed) continue;
          out.set(object.url, signed);
          memo.set(object.url, { window, url: signed });
        }
      } catch (error) {
        reportError("[photos] signing failed", { bucket, count: objects.length, error });
      }
    })
  );
  return out;
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
