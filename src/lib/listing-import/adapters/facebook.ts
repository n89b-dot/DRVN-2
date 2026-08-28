import "server-only";

import type { ImportErrorCode } from "../errors";
import { safeFetch } from "../fetch/safe-fetch";
import { renderPublicPage } from "../fetch/render";
import { extractOpenGraph, loadHtml } from "../extract/html";
import type { NormalizedImportSource } from "../schema";
import { filterImageCandidates } from "./images";

/**
 * Facebook Marketplace — first-class, user-directed, single-page, logged-out.
 *
 * The scope is deliberately narrow and enforced here, not by convention:
 *  - exactly the URL the seller submitted (plus its redirects), once
 *  - anonymous: no accounts, no cookies, no sessions, no credential flows
 *  - no search, no enumeration, no profile/comment/related-listing traversal
 *  - no CAPTCHA solving, no proxy/fingerprint rotation, no stealth: a login
 *    wall or challenge STOPS the attempt and the import falls forward to
 *    paste (the seller keeps the URL provenance and loses nothing)
 *
 * Retrieval ladder: plain HTTP → OpenGraph/embedded-JSON extraction →
 * (optionally, when the deployment enables it) ordinary Chromium rendering of
 * the same public page → same extraction. The analytics outcomes recorded by
 * the engine tell us whether anonymous retrieval is viable at scale.
 */

export type FacebookFetchOutcome =
  | { ok: true; source: NormalizedImportSource; rendered: boolean }
  | { ok: false; code: ImportErrorCode; detail?: string; attemptedRender: boolean };

const LOGIN_MARKERS = /(\/login|\/checkpoint|login\.php)/i;

function looksLikeLoginWall(html: string, finalUrl: string, title: string | undefined): boolean {
  if (LOGIN_MARKERS.test(finalUrl)) return true;
  const t = (title ?? "").toLowerCase();
  if (/^(log in|log into|facebook - log in|anmelden)/.test(t)) return true;
  if (/id="login_form"|name="login"|loginbutton/.test(html) && !/marketplace_listing/i.test(html)) {
    return true;
  }
  return false;
}

/** Marketplace listing fields Facebook sometimes embeds in page JSON. */
function scrapeEmbeddedFields(html: string): {
  title?: string;
  priceText?: string;
  description?: string;
  location?: string;
} {
  const unescape = (value: string): string => {
    try {
      return JSON.parse(`"${value}"`) as string;
    } catch {
      return value;
    }
  };
  const grab = (pattern: RegExp): string | undefined => {
    const match = pattern.exec(html);
    return match ? unescape(match[1]).trim() || undefined : undefined;
  };
  return {
    title: grab(/"marketplace_listing_title"\s*:\s*"((?:[^"\\]|\\.)*)"/),
    priceText:
      grab(/"formatted_amount"\s*:\s*"((?:[^"\\]|\\.)*)"/) ??
      grab(/"formatted_price"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/),
    description: grab(/"redacted_description"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/),
    location: grab(/"location_text"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/),
  };
}

function buildSource(
  html: string,
  finalUrl: string,
  rendered: boolean
): NormalizedImportSource | null {
  const $ = loadHtml(html);
  const og = extractOpenGraph($, finalUrl);
  const embedded = scrapeEmbeddedFields(html);

  const title = embedded.title ?? og.title;
  const textParts = [embedded.description ?? og.description].filter(
    (part): part is string => Boolean(part && part.trim())
  );
  if (!title && !textParts.length) return null;

  const domain = (() => {
    try {
      return new URL(finalUrl).hostname;
    } catch {
      return undefined;
    }
  })();

  return {
    sourceType: "facebook",
    sourceUrl: finalUrl,
    canonicalUrl: og.url ?? finalUrl,
    sourceDomain: domain,
    title,
    text: textParts.join("\n\n") || title || "",
    structuredFacts: {
      priceText: embedded.priceText,
      location: embedded.location,
    },
    images: filterImageCandidates(og.images.map((url) => ({ url }))),
    fetchMethod: rendered ? "render" : "http",
  };
}

export async function fetchFacebookListing(
  url: URL,
  opts: { allowPrivate: boolean; browserEnabled: boolean }
): Promise<FacebookFetchOutcome> {
  const result = await safeFetch(url.href, {
    maxBytes: 4_000_000,
    allowPrivate: opts.allowPrivate,
  });

  let wall = false;
  if (result.ok) {
    const $ = loadHtml(result.body.toString("utf8"));
    const html = result.body.toString("utf8");
    const title = $("title").first().text().trim() || undefined;
    if (looksLikeLoginWall(html, result.finalUrl, title)) {
      wall = true;
    } else {
      const source = buildSource(html, result.finalUrl, false);
      if (source && source.text.trim()) return { ok: true, source, rendered: false };
      wall = true; // fetched but empty shell — same product answer as a wall
    }
  } else if (
    result.code !== "source_login_required" &&
    result.code !== "source_access_denied" &&
    result.code !== "source_challenge"
  ) {
    // Network-level failures aren't a Facebook wall; report them as-is.
    if (!opts.browserEnabled) {
      return { ok: false, code: result.code, detail: result.detail, attemptedRender: false };
    }
  }

  // Rendering fallback — the same public page through an ordinary browser.
  if (opts.browserEnabled) {
    const rendered = await renderPublicPage(url.href);
    if (rendered.ok) {
      const title = /<title[^>]*>([^<]*)</i.exec(rendered.html)?.[1]?.trim();
      if (!looksLikeLoginWall(rendered.html, rendered.finalUrl, title)) {
        const source = buildSource(rendered.html, rendered.finalUrl, true);
        if (source && source.text.trim()) return { ok: true, source, rendered: true };
      }
    }
    return {
      ok: false,
      code: wall || result.ok ? "source_login_required" : !result.ok ? result.code : "source_login_required",
      detail: !result.ok ? result.detail : undefined,
      attemptedRender: true,
    };
  }

  return {
    ok: false,
    code: wall || result.ok ? "source_login_required" : result.code,
    detail: !result.ok ? result.detail : undefined,
    attemptedRender: false,
  };
}
