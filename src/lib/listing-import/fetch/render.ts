import "server-only";

import dns from "node:dns/promises";

import { isForbiddenAddress } from "./guard";

/**
 * Optional public-page rendering fallback — ordinary Chromium rendering of
 * the SAME publicly accessible URL, for pages that genuinely require client
 * rendering (LISTING_IMPORT_PUBLIC_BROWSER_ENABLED=true). This is a renderer,
 * not an agent: no session, no storage, no interaction, one navigation,
 * bounded time.
 *
 * Capability-detected: playwright-core is resolved dynamically so deployments
 * without a browser runtime lose ONLY this fallback — HTTP/forum/paste import
 * works everywhere. Every subresource request is checked against the same
 * private-address rules as the HTTP fetcher before it may connect.
 */

const RENDER_TIMEOUT_MS = 20_000;
const MAX_HTML_BYTES = 3_000_000;

export type RenderResult =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; code: "render_unavailable" | "render_failed" | "render_blocked" };

export async function renderPublicPage(url: string): Promise<RenderResult> {
  type ChromiumModule = {
    chromium: {
      launch(opts: { headless: boolean }): Promise<{
        newContext(opts: Record<string, unknown>): Promise<{
          route(pattern: string, handler: (route: RouteLike) => Promise<void>): Promise<void>;
          newPage(): Promise<PageLike>;
        }>;
        close(): Promise<void>;
      }>;
    };
  };
  type RouteLike = {
    request(): { url(): string };
    abort(): Promise<void>;
    continue(): Promise<void>;
  };
  type PageLike = {
    goto(url: string, opts: { waitUntil: string; timeout: number }): Promise<unknown>;
    waitForTimeout(ms: number): Promise<void>;
    content(): Promise<string>;
    url(): string;
  };

  let mod: ChromiumModule;
  try {
    // Runtime resolution keeps playwright-core out of every bundle graph.
    mod = (await import(/* webpackIgnore: true */ "playwright-core")) as unknown as ChromiumModule;
  } catch {
    return { ok: false, code: "render_unavailable" };
  }

  let browser: Awaited<ReturnType<ChromiumModule["chromium"]["launch"]>> | null = null;
  const hostVerdicts = new Map<string, boolean>();

  const hostAllowed = async (hostname: string): Promise<boolean> => {
    const cached = hostVerdicts.get(hostname);
    if (cached !== undefined) return cached;
    let allowed = false;
    try {
      const records = await dns.lookup(hostname, { all: true, verbatim: true });
      allowed = records.length > 0 && records.every((r) => !isForbiddenAddress(r.address));
    } catch {
      allowed = false;
    }
    hostVerdicts.set(hostname, allowed);
    return allowed;
  };

  try {
    browser = await mod.chromium.launch({ headless: true });
    const context = await browser.newContext({
      javaScriptEnabled: true,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 DRVNImporter/1.0",
      viewport: { width: 1280, height: 900 },
    });

    await context.route("**/*", async (route) => {
      try {
        const requestUrl = new URL(route.request().url());
        if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") {
          return await route.abort();
        }
        const host = requestUrl.hostname;
        if (/^[\d.]+$/.test(host) || host.includes(":")) {
          if (isForbiddenAddress(host)) return await route.abort();
        } else if (!(await hostAllowed(host))) {
          return await route.abort();
        }
        await route.continue();
      } catch {
        await route.abort().catch(() => {});
      }
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: RENDER_TIMEOUT_MS });
    // A short settle for client-rendered content; never an open-ended wait.
    await page.waitForTimeout(2_500);
    const html = await page.content();
    if (html.length > MAX_HTML_BYTES) return { ok: false, code: "render_failed" };
    return { ok: true, html, finalUrl: page.url() };
  } catch {
    return { ok: false, code: "render_failed" };
  } finally {
    await browser?.close().catch(() => {});
  }
}
