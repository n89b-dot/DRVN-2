import "server-only";

import type { ImportErrorCode } from "../errors";
import { safeFetch } from "../fetch/safe-fetch";
import {
  extractCanonicalUrl,
  extractJsonLdProduct,
  extractOpenGraph,
  loadHtml,
} from "../extract/html";
import { extractReadableContent } from "../extract/readability";
import type { NormalizedImportSource } from "../schema";
import type { SourcePolicy } from "../policy";
import { fetchDiscourseTopic, looksLikeDiscourse } from "./discourse";
import { fetchFacebookListing } from "./facebook";
import { extractForumFirstPost } from "./forums";
import { filterImageCandidates } from "./images";

/**
 * URL ingestion — one fetch, then a deterministic extraction ladder:
 *
 *   engine adapters (Discourse JSON, XenForo, vBulletin, phpBB — detected
 *   from the document, so unknown domains still hit the right extractor)
 *      ↓
 *   JSON-LD Product / OpenGraph metadata
 *      ↓
 *   Readability main-content fallback
 *
 * Facebook has its own pre-fetch adapter (facebook.ts) because its outcome
 * ladder (anonymous HTTP → optional render → paste fallback) is different in
 * kind, not just in selectors.
 */

export type SourceFetchOutcome =
  | { ok: true; source: NormalizedImportSource; adapter: string; rendered?: boolean }
  | { ok: false; code: ImportErrorCode; detail?: string; adapter: string; attemptedRender?: boolean };

export async function fetchNormalizedSource(
  policy: SourcePolicy,
  url: URL,
  opts: { allowPrivate: boolean; browserEnabled: boolean }
): Promise<SourceFetchOutcome> {
  if (policy.adapterId === "facebook") {
    const outcome = await fetchFacebookListing(url, opts);
    if (outcome.ok) {
      return {
        ok: true,
        source: outcome.source,
        adapter: "facebook",
        rendered: outcome.rendered,
      };
    }
    return {
      ok: false,
      code: outcome.code,
      detail: outcome.detail,
      adapter: "facebook",
      attemptedRender: outcome.attemptedRender,
    };
  }

  const result = await safeFetch(url.href, {
    maxBytes: 3_000_000,
    allowPrivate: opts.allowPrivate,
  });
  if (!result.ok) {
    return { ok: false, code: result.code, detail: result.detail, adapter: "generic" };
  }
  if (result.contentType && !/text\/html|application\/xhtml|text\/plain/.test(result.contentType)) {
    return { ok: false, code: "source_parse_failed", detail: result.contentType, adapter: "generic" };
  }

  const html = result.body.toString("utf8");
  const finalUrl = result.finalUrl;
  const domain = new URL(finalUrl).hostname;

  // Discourse: prefer the structured topic JSON over scraping the shell.
  if (looksLikeDiscourse(html)) {
    const topic = await fetchDiscourseTopic(new URL(finalUrl), opts);
    if (topic.ok) {
      return {
        ok: true,
        adapter: "discourse",
        source: {
          sourceType: "discourse",
          sourceUrl: finalUrl,
          canonicalUrl: finalUrl,
          sourceDomain: domain,
          fetchMethod: "http",
          images: topic.source.images,
          title: topic.source.title,
          text: topic.source.text,
        },
      };
    }
    // Fall through to the generic ladder — the HTML shell may still parse.
  }

  const $ = loadHtml(html);

  const forum = extractForumFirstPost($, html, finalUrl);
  if (forum?.source) {
    return {
      ok: true,
      adapter: forum.adapter,
      source: {
        ...forum.source,
        sourceType: forum.adapter,
        sourceUrl: finalUrl,
        canonicalUrl: extractCanonicalUrl($, finalUrl) ?? finalUrl,
        sourceDomain: domain,
        fetchMethod: "http",
      },
    };
  }

  // Generic ladder: structured data first, prose fallback last.
  const jsonLd = extractJsonLdProduct($, finalUrl);
  const og = extractOpenGraph($, finalUrl);
  const readable = await extractReadableContent(html, finalUrl);

  const title = jsonLd?.name ?? og.title ?? readable?.title;
  const textParts: string[] = [];
  if (jsonLd?.description) textParts.push(jsonLd.description);
  if (readable?.text && (!jsonLd?.description || readable.text.length > jsonLd.description.length)) {
    textParts.length = 0;
    textParts.push(readable.text);
  }
  if (!textParts.length && og.description) textParts.push(og.description);

  const text = textParts.join("\n\n").trim();
  if (!title && !text) {
    return { ok: false, code: "source_parse_failed", adapter: "generic" };
  }

  const images = filterImageCandidates(
    [...(jsonLd?.images ?? []), ...og.images].map((u) => ({ url: u }))
  );

  return {
    ok: true,
    adapter: "generic",
    source: {
      sourceType: "generic",
      sourceUrl: finalUrl,
      canonicalUrl: extractCanonicalUrl($, finalUrl) ?? og.url ?? finalUrl,
      sourceDomain: domain,
      title,
      text: text || title || "",
      structuredFacts: jsonLd
        ? {
            priceText: jsonLd.priceText,
            currency: jsonLd.currency,
            conditionText: jsonLd.conditionText,
            availability: jsonLd.availability,
            partNumber: jsonLd.partNumber,
          }
        : undefined,
      images,
      fetchMethod: "http",
    },
  };
}
