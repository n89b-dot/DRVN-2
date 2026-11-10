import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { reportError } from "@/lib/monitoring";
import {
  canonicalizePhotoUrlsInText,
  photoFieldUrls,
  replacePhotoFields,
  signedPhotoObject,
  signingContextFor,
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

/** The Supabase client the signer uses: Storage's signer and the shared memo's two functions. */
export type SigningClient = ReturnType<typeof createSupabaseClient>;

/**
 * A Storage signing call that takes longer than this is given up for this
 * response (work review #136). It was ten seconds, the client's own limit,
 * so a slow photo store held every page with photos for ten seconds.
 */
export const SIGN_BUDGET_MS = 2_500;
/** After a signing call fails or runs out of time, the pause before the next: the shared memo's. */
export const SIGN_RETRY_MS = 30_000;

let processClient: SigningClient | null = null;
/** The process's own client, made on first use from the environment. */
function defaultSigningClient(): SigningClient {
  if (!processClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Photo signing needs the Supabase URL and secret key");
    // Bounded: a stalled Storage or memo call must not hang a render. A
    // Storage call is cut off at its budget, so the request itself ends.
    const timed: typeof fetch = (input, init) => {
      const address = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(address.includes("/storage/v1/") ? SIGN_BUDGET_MS : 10_000) });
    };
    processClient = createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timed } });
  }
  return processClient;
}

/** The answer, or a rejection once `ms` has passed, whichever comes first. */
function withinBudget<T>(call: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
    Promise.resolve(call).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

type SharedRow = { bucket: string; path: string; signed_url: string };
/** A shared-memo call that takes longer than this is given up for this response. */
export const SHARED_BUDGET_MS = 1_500;
/** After a failure, a short pause before the next call (a missing function, an outage), not a long one. */
const SHARED_RETRY_MS = 30_000;
/** Failures are reported at most this often, with how many there were since the last report. */
const SHARED_REPORT_MS = 10 * 60_000;
/** Thrown by an export page read while the signer may not sign; the export job is retried. */
export const EXPORT_NOT_READY = "Photo signing is not ready, so this export page was not written; the job will be tried again";

/** How long a photo link in a member's data export opens for: the export's own download life. */
export const EXPORT_PHOTO_LINK_SECONDS = 7 * 24 * 60 * 60;

/** A "the guards are there" answer is used without asking again for this long. */
const READY_FRESH_MS = 5 * 60_000;
/** A "they aren't" answer is asked again after this long. */
const NOT_READY_FOR_MS = 30_000;
/** After a check that could not be made, the next waits this long, doubling each time up to the last. */
const READY_RETRY_MS = [2_000, 4_000, 8_000, 16_000, 30_000];
/** PostgREST's and Postgres's "there is no such function": the migration is not applied, which is an answer. */
const NO_SUCH_FUNCTION = new Set(["PGRST202", "42883"]);

/** Each reason is reported at most once per ten minutes, with how many times it happened since. */
const REPORT_EVERY_MS = 10 * 60_000;

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/** What a signer is given (work review #135): its clock, its client, and where it reports. */
export type PhotoSignerDeps = {
  /** The one clock: every window, pause and age is read from it. */
  now?: () => number;
  /** The client that signs and holds the shared memo. Asked for on each use. */
  client?: () => SigningClient;
  report?: (message: string, detail?: Record<string, unknown>) => void;
};

/**
 * A photo signer with its own memory: the links it has minted this hour, what
 * the database last said about its guards, and its pauses after a failure.
 * The app has one (below). A test builds a fresh one, with a clock it moves
 * and a client it controls, so no test depends on what ran before it or on
 * the date (the cause of work review #124).
 */
export function createPhotoSigner({
  now = Date.now,
  client = defaultSigningClient,
  // Looked up when something is reported, not when the signer is made: the app's signer is made as this module loads.
  report = (message, detail) => reportError(message, detail),
}: PhotoSignerDeps = {}) {
  const memo = new Map<string, Signed>();
  /** No Storage signing call before this time: set after one fails or runs past its budget. */
  let signRetryAt = 0;

  /**
   * Signed URLs for canonical photo URLs, keyed by the canonical URL. A URL
   * that isn't a member photo, or that Storage would not sign, is left out (the
   * caller keeps the canonical URL, which renders as a missing photo rather
   * than failing the page).
   */
  async function signedPhotoUrls(
    urls: readonly string[],
    /** A fixed life instead of the window's, minted fresh and never shared (the account export). */
    fixedExpiresIn?: number
  ): Promise<Map<string, string>> {
    const windowed = signingWindow(now());
    const window = fixedExpiresIn ? -1 : windowed.window;
    const expiresIn = fixedExpiresIn ?? windowed.expiresIn;
    const out = new Map<string, string>();
    const missing = new Map<string, { path: string; url: string }[]>();
    for (const url of new Set(urls)) {
      const cached = fixedExpiresIn ? undefined : memo.get(url);
      if (cached && cached.window === window && (cached.localUntil === undefined || now() < cached.localUntil)) {
        out.set(url, cached.url);
        continue;
      }
      const object = signedPhotoObject(url);
      if (!object) continue;
      missing.set(object.bucket, [...(missing.get(object.bucket) ?? []), { path: object.path, url }]);
    }
    if (!missing.size) return out;

    if (memo.size > MAX_MEMO) {
      // The live window, not the export's -1, or one export page would empty the memo.
      for (const [key, value] of memo) if (value.window !== windowed.window) memo.delete(key);
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
    // After a failed or slow signing call, none is made for thirty seconds
    // (work review #136): the photos that would need one show the no-photo
    // plate at once, where every page used to wait out the call again.
    if (now() < signRetryAt) return out;
    await Promise.all(
      [...missing].map(async ([bucket, all]) => {
        const objects = all.filter((o) => !out.has(o.url));
        if (!objects.length) return;
        try {
          const { data, error } = await withinBudget(
            client().storage.from(bucket).createSignedUrls(objects.map((o) => o.path), expiresIn),
            SIGN_BUDGET_MS,
          );
          if (error) throw error;
          const byPath = new Map((data ?? []).filter((d) => d.signedUrl && !d.error).map((d) => [d.path, d.signedUrl]));
          const refused = objects.filter((o) => !byPath.has(o.path));
          if (refused.length) report("[photos] storage would not sign some photos", { bucket, count: refused.length });
          for (const object of objects) {
            const signed = byPath.get(object.path);
            if (signed) minted.push({ bucket, path: object.path, signed_url: signed });
          }
        } catch (error) {
          signRetryAt = now() + SIGN_RETRY_MS;
          reportBounded("signing-failed", "[photos] signing failed; no signing call for thirty seconds", { bucket, count: objects.length, error });
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
      const localUntil = Math.max(sharedRetryAt, now() + 1);
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
    if (now() < sharedRetryAt) return null;
    try {
      const args = fn === "photo_signatures_read" ? { p_window: window, p_objects: objects } : { p_window: window, p_signed: objects };
      type Call = { abortSignal: (signal: AbortSignal) => PromiseLike<{ data: SharedRow[] | null; error: unknown }> };
      const call = (client() as unknown as { rpc: (f: string, a: unknown) => Call }).rpc(fn, args);
      const { data, error } = await call.abortSignal(AbortSignal.timeout(SHARED_BUDGET_MS));
      if (error) throw error;
      return data ?? [];
    } catch (error) {
      sharedRetryAt = now() + SHARED_RETRY_MS;
      sharedFailures += 1;
      if (now() - sharedReportedAt >= SHARED_REPORT_MS) {
        report("[photos] shared signing memo failed; signing per response", { fn, failures: sharedFailures, error });
        sharedReportedAt = now();
        sharedFailures = 0;
      }
      return null;
    }
  }

  /** One signed photo URL; anything that isn't a member photo comes back as it was. */
  async function signedPhotoUrl<T extends string | null | undefined>(url: T): Promise<T> {
    if (!url) return url;
    return ((await signedPhotoUrls([url])).get(url) ?? url) as T;
  }

  /**
   * One signed photo URL for a member's own object: a URL outside `ownerId`'s
   * folder comes back as it was, unsigned, which Storage refuses. For an action
   * that signs what it was handed rather than what a guarded read returned.
   */
  async function signedOwnPhotoUrl<T extends string | null | undefined>(url: T, ownerId: string): Promise<T> {
    if (!url || signedPhotoObject(url)?.path.split("/")[0] !== ownerId) return url;
    return signedPhotoUrl(url);
  }

  /**
   * The photo fields of a JSON answer signed, in one batch per bucket. Only
   * whole values at the places the database guards, for this answer's table or
   * RPC (src/lib/photo-urls.ts, PHOTO_POSITIONS): a photo URL written into
   * prose, a profile link, a JSON column or any other member-written field
   * stays canonical, which the storage layer refuses (#178 and #196 reviews).
   * Text that isn't JSON, or an answer with no known context, is left as it is.
   */
  async function signPhotoUrlsInText(text: string, context: SigningContext | null): Promise<string> {
    if (!context || !text.includes("/storage/v1/object/public/")) return text;
    if (!(await photoSigningReady())) return text;
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

  /**
   * A member's own photos in their data export (N455): the stored canonical
   * URL no longer opens, so each becomes a link that opens for seven days. The
   * rows were selected for the requesting member only, by the export's own
   * ownership filters, from `context` (the section's table and projection).
   * Only guarded photo places are linked, and only objects in the member's own
   * folder: another member's photo URL the member wrote into a comment, or
   * another member's photo on a row the export carries, is not (#178 review).
   */
  async function signPhotosForExport<T>(value: T, ownerId: string, context: SigningContext | null): Promise<T> {
    if (value == null || !context) return value;
    // An export page is stored for good: one written while signing is off would
    // carry links that never open, and the export would still finish as a
    // success. The job fails here instead, and its next attempt reads the page again.
    if (!(await photoSigningReady())) throw new Error(EXPORT_NOT_READY);
    // The member's own objects only: their folder is the path's first segment.
    const urls = photoFieldUrls(value, context).filter((url) => signedPhotoObject(url)?.path.split("/")[0] === ownerId);
    if (!urls.length) return value;
    return replacePhotoFields(value, context, await signedPhotoUrls(urls, EXPORT_PHOTO_LINK_SECONDS));
  }

  /**
   * `answer` is the last thing the database said (null: it has never answered
   * this instance). `askAfter`: no new question before then. `failures`: checks
   * in a row that could not be made.
   */
  let readiness: { answer: boolean | null; askAfter: number; failures: number } = { answer: null, askAfter: 0, failures: 0 };
  let readyAsk: Promise<void> | null = null;

  /** One question to the database, shared by every caller waiting on it. Never rejects. */
  function askReadiness(): Promise<void> {
    readyAsk ??= (async () => {
      let answer: boolean | null = null;
      let failure: unknown;
      try {
        type Call = { abortSignal: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }> };
        const call = (client() as unknown as { rpc: (f: string) => Call }).rpc("photo_signing_ready");
        const { data, error } = await call.abortSignal(AbortSignal.timeout(SHARED_BUDGET_MS));
        if (error && NO_SUCH_FUNCTION.has(String((error as { code?: unknown }).code))) answer = false;
        else if (error) throw error;
        else answer = data === true;
      } catch (error) {
        failure = error ?? new Error("the readiness check failed");
      }
      const at = now();
      if (answer === null) {
        // No answer (a timeout, an outage): what the database last said stands.
        // A slow check must not blank every photo on the instance (work review #146).
        const failures = readiness.failures + 1;
        readiness = { answer: readiness.answer, askAfter: at + READY_RETRY_MS[Math.min(failures, READY_RETRY_MS.length) - 1], failures };
        reportBounded("ready-check-failed", "[photos] could not check the database's photo guards; the last answer stands", { lastAnswer: readiness.answer, failures, error: failure });
        return;
      }
      readiness = { answer, askAfter: at + (answer ? READY_FRESH_MS : NOT_READY_FOR_MS), failures: 0 };
      if (!answer) reportBounded("not-ready", "[photos] the database's photo guards are missing (20261110190000); signing nothing", {});
    })().finally(() => { readyAsk = null; });
    return readyAsk;
  }

  /**
   * Whether the database guards every place the signer signs (N940,
   * public.photo_signing_ready, 20261110190000). Until it says so, nothing is
   * signed at the boundary or in an export: code deployed ahead of its
   * migration fails safe (photos show the no-photo plate) rather than signing
   * places nothing has checked.
   *
   * Only an answer from the database changes what this returns (N1062, work
   * review #146). "Yes" is used for five minutes; after that it is still used,
   * at once, while the database is asked again behind the response. "No" (or no
   * such function) is asked again after thirty seconds. A check that could not
   * be made, a timeout or an outage, leaves the last answer standing and is
   * tried again after two seconds, doubling to thirty. An instance the database
   * has never answered signs nothing.
   * (deploy.yml's migration-status step also stops a deploy whose migrations
   * are behind, but this does not depend on it.)
   */
  async function photoSigningReady(): Promise<boolean> {
    const saidYes = () => readiness.answer === true;
    if (now() < readiness.askAfter) return saidYes();
    if (saidYes()) {
      void askReadiness();
      return true;
    }
    await askReadiness();
    return saidYes();
  }

  const reported = new Map<string, { at: number; since: number }>();
  function reportBounded(reason: string, message: string, detail: Record<string, unknown>) {
    const seen = reported.get(reason);
    if (seen && now() - seen.at < REPORT_EVERY_MS) {
      seen.since += 1;
      return;
    }
    report(message, { reason, since: seen?.since ?? 0, ...detail });
    reported.set(reason, { at: now(), since: 0 });
  }

  /** A Supabase client fetch that keeps canonical photo URLs in the database and, with `sign`, hands out signed ones. */
  function photoFetch(base: typeof fetch, options: { sign: boolean }): typeof fetch {
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
      if (profile && profile !== "public") {
        reportBounded("non-public-profile", "[photos] a read of another schema came back unsigned", { profile });
        return response;
      }
      const found = signingContextFor(requestUrl(input));
      if (!("context" in found)) {
        // A read the signer can't place stays unsigned; that is safe, but a
        // page may lose its photos, so it is said (once per ten minutes).
        if (found.reason !== "not-rest") reportBounded(found.reason, "[photos] a read the signer can't place came back unsigned", { reason: found.reason });
        return response;
      }
      const context = found.context;
      const text = await response.text();
      const signed = await signPhotoUrlsInText(text, context);
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      return new Response(signed, { status: response.status, statusText: response.statusText, headers });
    };
  }

  return { signedPhotoUrls, signedPhotoUrl, signedOwnPhotoUrl, signPhotoUrlsInText, signPhotosForExport, photoSigningReady, photoFetch };
}

export type PhotoSigner = ReturnType<typeof createPhotoSigner>;

/** The app's signer: one per server process. */
const processSigner = createPhotoSigner();
export const { signedPhotoUrls, signedPhotoUrl, signedOwnPhotoUrl, signPhotoUrlsInText, signPhotosForExport, photoSigningReady, photoFetch } = processSigner;
