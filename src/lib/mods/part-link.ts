import "server-only";

import { randomUUID } from "node:crypto";

import { resolveImportConfig } from "@/lib/listing-import/config";
import { checkFetchUrl } from "@/lib/listing-import/fetch/guard";
import { safeFetch } from "@/lib/listing-import/fetch/safe-fetch";
import {
  extractCanonicalUrl,
  extractJsonLdProduct,
  extractOpenGraph,
  loadHtml,
} from "@/lib/listing-import/extract/html";
import { importListingImages } from "@/lib/listing-import/media/import-images";
import { parseModLine } from "@/lib/mods/parse";
import type { ModCategory } from "@/lib/mods/parse";

/**
 * "Add a mod by pasting a link" (L-1…L-4).
 *
 * Deliberately the importer's plumbing at a fraction of its weight. The
 * listing importer exists to build a whole saleable listing from someone
 * else's page: a durable job ladder, AI extraction, up to twelve photos. A
 * mod line needs a title, a brand, a part number, one thumbnail and what the
 * shop was charging — so this reuses the parts that make a remote fetch safe
 * (SSRF guard, pinned DNS, byte caps, sharp re-encode) and none of the parts
 * that make it expensive. No AI, no job row, one image.
 *
 * Two rules the shape enforces rather than promises:
 *   - the thumbnail lands in `car-images`, never `listing-images`, so a
 *     shop's product photo cannot become a listing photo (L-4);
 *   - a reference price without a currency is not returned at all, because
 *     the database refuses that half-state and a bare number on a build sheet
 *     would be read as pounds by one person and dollars by the next.
 */

/** What a pasted link fills in. Every field is editable afterwards (L-2). */
export type PartLinkFields = {
  product_url: string;
  source_domain: string;
  title: string;
  brand: string | null;
  product: string | null;
  part_number: string | null;
  category: ModCategory | null;
  image_url: string | null;
  ref_price_cents: number | null;
  ref_price_currency: string | null;
};

export type PartLinkResult =
  | ({
      ok: true;
      /**
       * The address DRVN really fetched: the member's link, or where its
       * redirects led, each hop checked by the fetch guard. Unlike
       * product_url (the page's own canonical claim, which the page can set
       * to anything), this is a page someone actually supplied or visited
       * (OS-W07 N124 follow-up). Not part of the mod line.
       */
      fetched_url: string;
    } & PartLinkFields)
  | { ok: false; error: string };

const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 12_000;

/** ISO-4217-ish: three letters. Anything else is treated as no currency. */
export function normalizeCurrency(raw: string | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/**
 * Shop prices arrive as "1,299.00", "£1299", "1.299,00 €". Only the plain
 * decimal forms are trusted: a wrong price on a build sheet is worse than no
 * price, and this number is never used for a transaction.
 */
export function parsePriceCents(raw: string | undefined): number | null {
  if (!raw) return null;
  // A leading minus would otherwise be stripped along with the currency
  // symbol and read as a positive price.
  if (/-\s*\d/.test(raw)) return null;
  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;
  // Ambiguous separators (both present, or a comma acting as decimal) are
  // refused rather than guessed.
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  if (hasComma && hasDot) return null;
  if (hasComma && /,\d{1,2}$/.test(cleaned)) return null;
  const value = Number(cleaned.replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) return null;
  return Math.round(value * 100);
}

export async function fetchPartLink(rawUrl: string, userId: string): Promise<PartLinkResult> {
  const config = resolveImportConfig();
  const check = checkFetchUrl(rawUrl, { allowPrivate: config.allowPrivateHosts });
  if (!check.ok) return { ok: false, error: "That link can't be read. Check it and try again." };

  const page = await safeFetch(check.url.toString(), {
    maxBytes: MAX_PAGE_BYTES,
    totalTimeoutMs: PAGE_TIMEOUT_MS,
    accept: "text/html,application/xhtml+xml",
    allowPrivate: config.allowPrivateHosts,
  });
  if (!page.ok) {
    // Many big parts shops refuse automated reads outright (403, a bot
    // challenge, a login wall). That isn't the member's link being broken,
    // so it shouldn't sound like it.
    const blocked =
      page.code === "source_access_denied" ||
      page.code === "source_challenge" ||
      page.code === "source_login_required";
    return {
      ok: false,
      error: blocked
        ? "This shop blocks automatic reading — add the part by hand or paste its details."
        : "Couldn't reach that page. You can type the part in instead.",
    };
  }
  if (!/text\/html|application\/xhtml/i.test(page.contentType)) {
    return { ok: false, error: "That link isn't a product page. Type the part in instead." };
  }

  const $ = loadHtml(page.body.toString("utf8"));
  const product = extractJsonLdProduct($, page.finalUrl);
  const og = extractOpenGraph($, page.finalUrl);
  const canonical = extractCanonicalUrl($, page.finalUrl) ?? page.finalUrl;

  const title = (product?.name ?? trimSiteName(og.title, og.siteName) ?? "").trim().slice(0, 200);
  if (!title) {
    return { ok: false, error: "Couldn't read a part from that page. Type it in instead." };
  }

  // The page's own brand is authoritative when it states one; otherwise the
  // build sheet's own parser has a curated brand list and a first-word
  // fallback, which is the same guess a typed line would get.
  const parsed = parseModLine(title);
  const brand = (product?.brand ?? "").trim() || parsed.brand || null;
  // When the page named the brand, the parser's guess at where the brand ends
  // is not to be trusted — keep the whole title as the product instead.
  const productName = product?.brand?.trim()
    ? title.replace(new RegExp(`^${escapeRegExp(product.brand.trim())}\\s*`, "i"), "").trim() ||
      title
    : parsed.product || title;

  // JSON-LD first; a shop that only states its price in meta tags still
  // gets one.
  const currency = normalizeCurrency(product?.currency) ?? normalizeCurrency(og.priceCurrency);
  const cents = parsePriceCents(product?.priceText) ?? parsePriceCents(og.priceAmount);
  // No currency means no price — the database refuses the half-state, and so
  // does this, rather than storing a number nobody can read.
  const refPrice = currency && cents ? { cents, currency } : null;

  let imageUrl: string | null = null;
  const candidate = product?.images[0] ?? og.images[0];
  if (candidate) {
    const { images } = await importListingImages({
      userId,
      importId: randomUUID(),
      candidates: [{ url: candidate }],
      alreadyImported: [],
      allowPrivate: config.allowPrivateHosts,
      bucket: "car-images",
      pathPrefix: "part-links",
      maxImages: 1,
    });
    imageUrl = images[0]?.url ?? null;
  }

  return {
    ok: true,
    fetched_url: page.finalUrl,
    product_url: canonical.slice(0, 2000),
    source_domain: new URL(canonical).hostname.replace(/^www\./i, ""),
    title,
    brand: brand ? brand.slice(0, 120) : null,
    product: productName ? productName.slice(0, 200) : null,
    part_number: product?.partNumber?.trim().slice(0, 80) ?? parsed.part_number ?? null,
    category: parsed.category,
    image_url: imageUrl,
    ref_price_cents: refPrice?.cents ?? null,
    ref_price_currency: refPrice?.currency ?? null,
  };
}

/**
 * Page titles carry the shop's name: "MX | Asphalt Black | fifteen52". Left
 * in, it became the product name and the parser read the shop's name as a
 * part number. Drops a trailing " | Site" (or " – Site") segment — the
 * stated site name when there is one, otherwise the last pipe segment.
 */
export function trimSiteName(title: string | undefined, siteName?: string): string | undefined {
  if (!title) return title;
  let out = title.trim();
  const site = siteName?.trim();
  const withoutSite = site
    ? out.replace(new RegExp(`\\s*[|\\-–—:]\\s*${escapeRegExp(site)}\\s*$`, "i"), "")
    : out;
  if (withoutSite !== out) {
    out = withoutSite;
  } else {
    const parts = out.split(/\s+\|\s+/);
    if (parts.length > 1) out = parts.slice(0, -1).join(" | ");
  }
  return out.replace(/[\s|\-–—:]+$/, "").trim() || title.trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
