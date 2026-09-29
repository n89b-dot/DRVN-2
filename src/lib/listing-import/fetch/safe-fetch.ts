import "server-only";

import dns from "node:dns";
import type net from "node:net";

import { Agent, fetch as undiciFetch } from "undici";

import type { ImportErrorCode } from "../errors";
import { checkFetchUrl, isForbiddenAddress } from "./guard";

/**
 * The one hardened remote fetch for the importer — pages AND images go
 * through here. Guarantees, in order:
 *
 *  - http/https only, no embedded credentials, ports 80/443 (guard.ts)
 *  - every hostname resolves through a pinned lookup that validates the
 *    ACTUAL connect-time addresses (loopback, RFC1918, link-local, cloud
 *    metadata, CGN, v6 equivalents all refused) — re-resolution at connect
 *    time closes the DNS-rebinding TOCTOU window
 *  - redirects are never followed blindly: each hop re-runs the full URL and
 *    address gauntlet, capped at MAX_REDIRECTS
 *  - connect + total timeouts, response byte caps applied to the DECOMPRESSED
 *    stream (a gzip bomb hits the cap, not the heap)
 *  - an honest User-Agent; no DRVN cookies or auth material ever attached
 *
 * `allowPrivate` exists ONLY for tests/e2e fixture servers and is refused in
 * production by the env resolver (config.ts) — never pass it from product code.
 */

const USER_AGENT = "DRVNImporter/1.0 (+https://drvn.app/import)";
const MAX_REDIRECTS = 5;

export type SafeFetchOptions = {
  /** Cap on decompressed body bytes. */
  maxBytes: number;
  totalTimeoutMs?: number;
  connectTimeoutMs?: number;
  accept?: string;
  /** Test-only escape hatch for local fixture servers. */
  allowPrivate?: boolean;
  /**
   * Maps each redirect destination before it is followed (e.g. Facebook's
   * m. host → www). The rewritten URL still runs the full guard gauntlet.
   */
  rewriteRedirect?: (url: URL) => URL;
};

export type SafeFetchResult =
  | {
      ok: true;
      status: number;
      finalUrl: string;
      contentType: string;
      body: Buffer;
    }
  | { ok: false; code: ImportErrorCode; detail?: string };

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number
) => void;

function pinnedLookup(allowPrivate: boolean): net.LookupFunction {
  const lookup = (
    hostname: string,
    options: dns.LookupOptions,
    callback: LookupCallback
  ): void => {
    dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
      const cb = callback;
      if (err) return cb(err, "", 4);
      const list = Array.isArray(addresses)
        ? addresses
        : [{ address: addresses as unknown as string, family: 4 }];
      if (!list.length) {
        return cb(Object.assign(new Error("no addresses"), { code: "ENOTFOUND" }), "", 4);
      }
      // ANY forbidden record poisons the set — a half-public DNS answer is an
      // attack shape, not a configuration.
      if (!allowPrivate && list.some((a) => isForbiddenAddress(a.address))) {
        return cb(
          Object.assign(new Error("resolved to a private address"), { code: "EPRIVATEADDR" }),
          "",
          4
        );
      }
      if (options.all) return cb(null, list);
      cb(null, list[0].address, list[0].family);
    });
  };
  return lookup as unknown as net.LookupFunction;
}

function classifyStatus(status: number): ImportErrorCode {
  if (status === 401 || status === 407) return "source_login_required";
  if (status === 403 || status === 451) return "source_access_denied";
  if (status === 429) return "source_challenge";
  return "source_fetch_failed";
}

function classifyThrow(error: unknown): { code: ImportErrorCode; detail: string } {
  const message = error instanceof Error ? error.message : String(error);
  const cause =
    error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const combined = `${message} ${cause}`;
  if (/EPRIVATEADDR/i.test(combined) || /private address/i.test(combined)) {
    return { code: "source_private_address", detail: combined.slice(0, 300) };
  }
  if (/abort|timeout|timed out/i.test(combined)) {
    return { code: "source_fetch_timeout", detail: combined.slice(0, 300) };
  }
  return { code: "source_fetch_failed", detail: combined.slice(0, 300) };
}

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const totalTimeout = opts.totalTimeoutMs ?? 15_000;
  const connectTimeout = opts.connectTimeoutMs ?? 6_000;
  const deadline = Date.now() + totalTimeout;

  // Redirects are never auto-followed: fetch() runs redirect:"manual" and the
  // hop loop below re-validates every destination.
  const agent = new Agent({
    connect: {
      lookup: pinnedLookup(Boolean(opts.allowPrivate)),
      timeout: connectTimeout,
    },
  });

  try {
    let currentUrl = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const checked = checkFetchUrl(currentUrl, { allowPrivate: opts.allowPrivate });
      if (!checked.ok) return { ok: false, code: checked.code, detail: currentUrl.slice(0, 300) };

      const remaining = deadline - Date.now();
      if (remaining <= 0) return { ok: false, code: "source_fetch_timeout" };

      let response: Awaited<ReturnType<typeof undiciFetch>>;
      try {
        response = await undiciFetch(checked.url.href, {
          method: "GET",
          redirect: "manual",
          dispatcher: agent,
          signal: AbortSignal.timeout(remaining),
          headers: {
            "user-agent": USER_AGENT,
            accept: opts.accept ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
            "accept-language": "en-US,en;q=0.8",
          },
        });
      } catch (error) {
        const { code, detail } = classifyThrow(error);
        return { ok: false, code, detail };
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        if (!location) return { ok: false, code: "source_fetch_failed", detail: "redirect without location" };
        const next = new URL(location, checked.url);
        currentUrl = (opts.rewriteRedirect ? opts.rewriteRedirect(next) : next).href;
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return {
          ok: false,
          code: classifyStatus(response.status),
          detail: `HTTP ${response.status}`,
        };
      }

      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > opts.maxBytes * 4) {
        await response.body?.cancel().catch(() => {});
        return { ok: false, code: "source_too_large", detail: `declared ${declaredLength} bytes` };
      }

      // Read with a hard cap on DECOMPRESSED bytes.
      const chunks: Uint8Array[] = [];
      let received = 0;
      if (response.body) {
        const reader = response.body.getReader();
        for (;;) {
          if (Date.now() > deadline) {
            await reader.cancel().catch(() => {});
            return { ok: false, code: "source_fetch_timeout" };
          }
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > opts.maxBytes) {
            await reader.cancel().catch(() => {});
            return { ok: false, code: "source_too_large", detail: `over ${opts.maxBytes} bytes` };
          }
          chunks.push(value);
        }
      }

      return {
        ok: true,
        status: response.status,
        finalUrl: checked.url.href,
        contentType: (response.headers.get("content-type") ?? "").toLowerCase(),
        body: Buffer.concat(chunks),
      };
    }
    return { ok: false, code: "source_fetch_failed", detail: "too many redirects" };
  } finally {
    await agent.close().catch(() => {});
  }
}
