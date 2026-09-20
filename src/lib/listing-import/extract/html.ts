import "server-only";

import * as cheerio from "cheerio";

/**
 * Deterministic metadata extraction — the layers that run BEFORE any AI:
 * JSON-LD (schema.org Product/Offer), OpenGraph/Twitter meta, canonical
 * links. A page that already states its price in structured data never pays
 * a language model to rediscover it.
 */

export type CheerioDoc = cheerio.CheerioAPI;

export function loadHtml(html: string): CheerioDoc {
  return cheerio.load(html);
}

export function absoluteUrl(base: string, href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export type JsonLdProduct = {
  name?: string;
  description?: string;
  priceText?: string;
  currency?: string;
  conditionText?: string;
  availability?: string;
  partNumber?: string;
  /** Schema.org `brand` — an Organization node or a bare string. DRVN needs
   *  it for listings (M-6) and to confirm the brand on a link-added mod
   *  (L-2); without it the brand has to be guessed from the title. */
  brand?: string;
  images: string[];
};

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function asArray(value: JsonValue | undefined): JsonValue[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function firstString(value: JsonValue | undefined): string | undefined {
  for (const v of asArray(value)) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const url = (v as Record<string, JsonValue>).url ?? (v as Record<string, JsonValue>)["@id"];
      if (typeof url === "string" && url.trim()) return url.trim();
    }
  }
  return undefined;
}

function isType(node: Record<string, JsonValue>, type: string): boolean {
  return asArray(node["@type"]).some(
    (t) => typeof t === "string" && t.toLowerCase().endsWith(type.toLowerCase())
  );
}

/** Walks every JSON-LD block for the first schema.org Product (+ Offer). */
export function extractJsonLdProduct($: CheerioDoc, baseUrl: string): JsonLdProduct | null {
  const nodes: Record<string, JsonValue>[] = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    const text = $(el).text();
    if (!text || text.length > 200_000) return;
    try {
      const parsed = JSON.parse(text) as JsonValue;
      const queue = asArray(parsed);
      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== "object" || Array.isArray(node)) continue;
        const rec = node as Record<string, JsonValue>;
        nodes.push(rec);
        if (rec["@graph"]) queue.push(...asArray(rec["@graph"]));
        if (rec.mainEntity) queue.push(...asArray(rec.mainEntity));
        if (rec.itemListElement) queue.push(...asArray(rec.itemListElement));
        if (rec.item) queue.push(...asArray(rec.item));
      }
    } catch {
      // Malformed JSON-LD is common in the wild; skip the block.
    }
  });

  const product = nodes.find((n) => isType(n, "Product"));
  if (!product) return null;

  const offers = asArray(product.offers).find(
    (o): o is Record<string, JsonValue> => Boolean(o) && typeof o === "object" && !Array.isArray(o)
  );

  const images = asArray(product.image)
    .map((img) => firstString(img))
    .filter((u): u is string => Boolean(u))
    .map((u) => absoluteUrl(baseUrl, u))
    .filter((u): u is string => Boolean(u))
    .slice(0, 24);

  const priceRaw = offers ? firstString(offers.price) ?? firstString(offers.lowPrice) : undefined;
  const condition = offers ? firstString(offers.itemCondition) : undefined;

  // `brand` is either a bare string or an Organization/Brand node; both are
  // common, so read the node's name rather than assuming either shape.
  const brandNode = asArray(product.brand)[0];
  const brand =
    typeof brandNode === "object" && brandNode !== null && !Array.isArray(brandNode)
      ? firstString((brandNode as Record<string, JsonValue>).name)
      : firstString(brandNode);

  return {
    name: firstString(product.name),
    description: firstString(product.description),
    priceText: priceRaw,
    currency: offers ? firstString(offers.priceCurrency) : undefined,
    conditionText: condition?.replace(/^https?:\/\/schema\.org\//i, ""),
    availability: offers
      ? firstString(offers.availability)?.replace(/^https?:\/\/schema\.org\//i, "")
      : undefined,
    partNumber: firstString(product.mpn) ?? firstString(product.sku),
    brand,
    images,
  };
}

export type OpenGraphData = {
  title?: string;
  description?: string;
  siteName?: string;
  url?: string;
  images: string[];
};

export function extractOpenGraph($: CheerioDoc, baseUrl: string): OpenGraphData {
  const meta = (prop: string): string | undefined => {
    const value =
      $(`meta[property="${prop}"]`).attr("content") ?? $(`meta[name="${prop}"]`).attr("content");
    return value?.trim() || undefined;
  };
  const images: string[] = [];
  $('meta[property="og:image"], meta[property="og:image:url"], meta[property="og:image:secure_url"]').each(
    (_i, el) => {
      const url = absoluteUrl(baseUrl, $(el).attr("content") ?? undefined);
      if (url && !images.includes(url)) images.push(url);
    }
  );
  const twitterImage = absoluteUrl(baseUrl, meta("twitter:image"));
  if (twitterImage && !images.includes(twitterImage)) images.push(twitterImage);

  return {
    title: meta("og:title") ?? meta("twitter:title"),
    description: meta("og:description") ?? meta("twitter:description") ?? meta("description"),
    siteName: meta("og:site_name"),
    url: absoluteUrl(baseUrl, meta("og:url")),
    images: images.slice(0, 24),
  };
}

export function extractCanonicalUrl($: CheerioDoc, baseUrl: string): string | undefined {
  return absoluteUrl(baseUrl, $('link[rel="canonical"]').attr("href") ?? undefined);
}

/** Collapses an element's rendered text with sane whitespace. */
export function elementText($: CheerioDoc, selector: string): string {
  const el = $(selector).first();
  if (!el.length) return "";
  // <br> and block ends become newlines so paragraphs survive.
  const html = el.html() ?? "";
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|blockquote|h[1-6]|tr)>/gi, "\n");
  const text = cheerio.load(`<div>${withBreaks}</div>`)("div").text();
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
