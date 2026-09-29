import "server-only";

import type { ImportErrorCode } from "../errors";
import { safeFetch } from "../fetch/safe-fetch";
import { renderPublicPage } from "../fetch/render";
import { extractOpenGraph, loadHtml, type CheerioDoc } from "../extract/html";
import { facebookItemId, normalizeImportUrl } from "../policy";
import type { ImportImageCandidate, NormalizedImportSource } from "../schema";
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
 * Retrieval ladder: plain HTTP → the listing's own embedded data (OpenGraph
 * when that is missing) → (optionally, when the deployment enables it)
 * ordinary Chromium rendering of the same public page → same extraction. The
 * analytics outcomes recorded by the engine tell us whether anonymous
 * retrieval is viable at scale.
 *
 * A logged-out item page carries ~20 recommended listings in the same data
 * as the one the seller linked. Every field is therefore read ONLY from
 * objects whose `id` is the item's own id — never "the first price on the
 * page", which is a stranger's price.
 */

export type FacebookFetchOutcome =
  | { ok: true; source: NormalizedImportSource; rendered: boolean }
  | { ok: false; code: ImportErrorCode; detail?: string; attemptedRender: boolean };

const LOGIN_MARKERS = /(\/login|\/checkpoint|login\.php)/i;
/** Facebook's error root ("This content isn't available right now") — the
 *  component name is language-independent; the sentence is the backstop. */
const GONE_MARKERS = /CometErrorRoot|content isn(?:'|\\u2019|’|\\')t available/i;
const MAX_PHOTOS = 12;

function looksLikeLoginWall(html: string, finalUrl: string, title: string | undefined): boolean {
  if (LOGIN_MARKERS.test(finalUrl)) return true;
  const t = (title ?? "").toLowerCase();
  if (/^(log in|log into|facebook - log in|anmelden)/.test(t)) return true;
  return /id="login_form"|name="login"|loginbutton/.test(html) && !/marketplace_listing/i.test(html);
}

type OwnListing = {
  title?: string;
  description?: string;
  priceText?: string;
  currency?: string;
  location?: string;
  conditionText?: string;
  availability?: string;
  photos: ImportImageCandidate[];
};

type Json = unknown;
type JsonObject = Record<string, Json>;

function isObject(value: Json): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: Json): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (isObject(value)) return text(value.text);
  return undefined;
}

/**
 * The listing's own fields, merged across every embedded JSON object whose
 * `id` is `itemId` (Facebook splits one listing over several objects). First
 * value found wins; objects belonging to other listings are never read.
 */
export function readOwnListing($: CheerioDoc, itemId: string): OwnListing | null {
  const own: OwnListing = { photos: [] };
  let found = false;
  const needle = `"${itemId}"`;

  $('script[type="application/json"]').each((_i, el) => {
    const raw = $(el).text();
    if (!raw.includes(needle) || raw.length > 3_000_000) return;
    let parsed: Json;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const stack: Json[] = [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        for (const child of node) stack.push(child);
        continue;
      }
      if (!isObject(node)) continue;
      for (const child of Object.values(node)) {
        if (child && typeof child === "object") stack.push(child);
      }
      if (node.id !== itemId) continue;
      found = true;

      own.title ??= text(node.marketplace_listing_title) ?? text(node.base_marketplace_listing_title);
      own.description ??= text(node.redacted_description);
      own.location ??= text(node.location_text);

      const price = node.listing_price;
      if (isObject(price) && !own.priceText) {
        own.priceText =
          text(price.formatted_amount_zeros_stripped) ?? text(price.formatted_amount) ?? text(price.amount);
        own.currency = text(price.currency)?.toUpperCase();
      }

      if (Array.isArray(node.attribute_data) && !own.conditionText) {
        const condition = node.attribute_data.find(
          (a) => isObject(a) && text(a.attribute_name)?.toLowerCase() === "condition"
        );
        if (isObject(condition)) own.conditionText = text(condition.label);
      }

      if (node.is_sold === true) own.availability = "sold";
      else if (node.is_pending === true) own.availability ??= "pending";

      if (Array.isArray(node.listing_photos) && !own.photos.length) {
        for (const photo of node.listing_photos) {
          const image = isObject(photo) ? photo.image : undefined;
          if (!isObject(image) || typeof image.uri !== "string") continue;
          own.photos.push({
            url: image.uri,
            width: typeof image.width === "number" ? image.width : undefined,
            height: typeof image.height === "number" ? image.height : undefined,
          });
        }
      }
    }
  });

  return found ? own : null;
}

type PageRead =
  | { ok: true; source: NormalizedImportSource }
  | { ok: false; code: "source_login_required" | "source_listing_gone" };

function readPage(html: string, finalUrl: string, requested: URL, rendered: boolean): PageRead {
  const $ = loadHtml(html);
  const og = extractOpenGraph($, finalUrl);
  const ogUrl = (() => {
    try {
      return og.url ? new URL(og.url) : null;
    } catch {
      return null;
    }
  })();
  const itemId =
    facebookItemId(new URL(finalUrl)) ?? facebookItemId(requested) ?? (ogUrl && facebookItemId(ogUrl));
  const own = itemId ? readOwnListing($, itemId) : null;

  const title = own?.title ?? og.title;
  const description = own?.description ?? og.description;

  if (!own) {
    const pageTitle = $("title").first().text().trim() || undefined;
    if (looksLikeLoginWall(html, finalUrl, pageTitle)) return { ok: false, code: "source_login_required" };
    if (!og.title) {
      return { ok: false, code: GONE_MARKERS.test(html) ? "source_listing_gone" : "source_login_required" };
    }
  }
  if (!title && !description) return { ok: false, code: "source_login_required" };

  const canonical = itemId ? `https://www.facebook.com/marketplace/item/${itemId}/` : (og.url ?? finalUrl);
  // The listing's own gallery; OpenGraph's single square crop only when the
  // gallery isn't in the page (it is the same first photo, smaller).
  const images = own?.photos.length ? own.photos : og.images.map((url) => ({ url }));

  return {
    ok: true,
    source: {
      sourceType: "facebook",
      sourceUrl: finalUrl,
      canonicalUrl: canonical,
      sourceDomain: "www.facebook.com",
      title,
      text: description || title || "",
      structuredFacts: {
        priceText: own?.priceText,
        currency: own?.currency,
        location: own?.location,
        conditionText: own?.conditionText,
        availability: own?.availability,
      },
      images: filterImageCandidates(images, MAX_PHOTOS),
      fetchMethod: rendered ? "render" : "http",
    },
  };
}

export async function fetchFacebookListing(
  url: URL,
  opts: { allowPrivate: boolean; browserEnabled: boolean }
): Promise<FacebookFetchOutcome> {
  const target = normalizeImportUrl(url);
  const result = await safeFetch(target.href, {
    maxBytes: 4_000_000,
    allowPrivate: opts.allowPrivate,
    rewriteRedirect: (next) => normalizeImportUrl(next),
  });

  let code: ImportErrorCode;
  let detail: string | undefined;
  if (result.ok) {
    const read = readPage(result.body.toString("utf8"), result.finalUrl, target, false);
    if (read.ok) return { ok: true, source: read.source, rendered: false };
    code = read.code;
  } else {
    code = result.code;
    detail = result.detail;
  }

  // A removed listing is removed for a browser too; don't render it.
  if (!opts.browserEnabled || code === "source_listing_gone") {
    return { ok: false, code, detail, attemptedRender: false };
  }

  // Rendering fallback — the same public page through an ordinary browser.
  const rendered = await renderPublicPage(target.href);
  if (rendered.ok) {
    const read = readPage(rendered.html, rendered.finalUrl, target, true);
    if (read.ok) return { ok: true, source: read.source, rendered: true };
    if (read.code === "source_listing_gone") code = read.code;
  }
  return { ok: false, code, detail, attemptedRender: true };
}
