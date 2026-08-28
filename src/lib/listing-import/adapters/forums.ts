import "server-only";

import type { CheerioDoc } from "../extract/html";
import { absoluteUrl, elementText } from "../extract/html";
import type { ImportImageCandidate, NormalizedImportSource } from "../schema";
import { filterImageCandidates } from "./images";

/**
 * Deterministic first-post extraction for the three classic forum engines.
 * The OP is the sale post; replies are bumps and haggling — none of them is
 * ever fed to extraction. Detection reads engine markers from the document
 * itself, so unknown domains still resolve to the right extractor.
 */

type EngineExtraction = Omit<NormalizedImportSource, "sourceType" | "fetchMethod"> | null;

function collectImages(
  $: CheerioDoc,
  scope: string,
  baseUrl: string
): ImportImageCandidate[] {
  const candidates: ImportImageCandidate[] = [];
  // Full-size attachment links beat inline thumbnails.
  $(`${scope} a`).each((_i, el) => {
    const href = $(el).attr("href");
    const url = absoluteUrl(baseUrl, href ?? undefined);
    if (url && /\/attachments?\/|\.(jpe?g|png|webp|avif)(\?|$)/i.test(url)) {
      candidates.push({ url });
    }
  });
  $(`${scope} img`).each((_i, el) => {
    const src =
      $(el).attr("data-url") ?? $(el).attr("data-src") ?? $(el).attr("src") ?? undefined;
    const url = absoluteUrl(baseUrl, src);
    if (!url) return;
    const width = Number($(el).attr("width")) || undefined;
    const height = Number($(el).attr("height")) || undefined;
    candidates.push({ url, width, height, alt: $(el).attr("alt")?.trim() || undefined });
  });
  return filterImageCandidates(candidates);
}

export function isXenForo($: CheerioDoc): boolean {
  return (
    $("html#XF").length > 0 ||
    $("html[data-template]").length > 0 ||
    $('meta[property="og:site_name"]').length > 0 && $(".p-body article.message").length > 0
  );
}

export function extractXenForo($: CheerioDoc, url: string): EngineExtraction {
  const first = $("article.message").first();
  if (!first.length) return null;
  const title =
    $("h1.p-title-value").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim();
  // Quoted replies inside the OP are someone else's words.
  first.find("blockquote").remove();
  const scoped = "article.message:first .message-body .bbWrapper";
  const text =
    elementText($, scoped) || elementText($, "article.message:first .message-body");
  if (!text) return null;
  return {
    title,
    text,
    images: collectImages($, "article.message:first", url),
  };
}

export function isVBulletin($: CheerioDoc, html: string): boolean {
  return (
    /vbulletin/i.test($('meta[name="generator"]').attr("content") ?? "") ||
    $("#postlist").length > 0 ||
    /vbulletin_core|vBulletin_init/i.test(html)
  );
}

export function extractVBulletin($: CheerioDoc, url: string): EngineExtraction {
  const first = $('#postlist [id^="post_"], .postcontainer, li.postbit').first();
  if (!first.length) return null;
  const title =
    $(".threadtitle, #thread_title, h1").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim();
  first.find("blockquote, .bbcode_quote, .quote").remove();
  const bodySelectors = ['[id^="post_message_"]', ".postcontent", ".content"];
  let text = "";
  for (const selector of bodySelectors) {
    const scoped = first.find(selector).first();
    if (scoped.length) {
      const marked = scoped.attr("id") ? `#${scoped.attr("id")}` : null;
      text = marked ? elementText($, marked) : scoped.text().replace(/\s+/g, " ").trim();
      if (text) break;
    }
  }
  if (!text) return null;
  const scopeId = first.attr("id");
  return {
    title,
    text,
    images: collectImages($, scopeId ? `#${scopeId}` : "#postlist", url),
  };
}

export function isPhpBb($: CheerioDoc, html: string): boolean {
  return (
    /phpbb/i.test($("body").attr("id") ?? "") ||
    $(".post .content, .postbody .content").length > 0 && /phpbb/i.test(html)
  );
}

export function extractPhpBb($: CheerioDoc, url: string): EngineExtraction {
  const first = $(".post").first();
  if (!first.length) return null;
  const title =
    $("h2.topic-title a, h2.topic-title, h1").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim();
  first.find("blockquote").remove();
  const body = first.find(".content").first();
  if (!body.length) return null;
  const scopeId = first.attr("id");
  const text = scopeId
    ? elementText($, `#${scopeId} .content`)
    : body.text().replace(/\s+/g, " ").trim();
  if (!text) return null;
  return {
    title,
    text,
    images: collectImages($, scopeId ? `#${scopeId}` : ".post", url),
  };
}

/** Dispatch across the three engines; null when none matched. */
export function extractForumFirstPost(
  $: CheerioDoc,
  html: string,
  url: string
): { adapter: "xenforo" | "vbulletin" | "phpbb"; source: EngineExtraction } | null {
  if (isXenForo($)) return { adapter: "xenforo", source: extractXenForo($, url) };
  if (isVBulletin($, html)) return { adapter: "vbulletin", source: extractVBulletin($, url) };
  if (isPhpBb($, html)) return { adapter: "phpbb", source: extractPhpBb($, url) };
  return null;
}
