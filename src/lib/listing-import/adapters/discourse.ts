import "server-only";

import { safeFetch } from "../fetch/safe-fetch";
import { loadHtml, elementText } from "../extract/html";
import type { NormalizedImportSource } from "../schema";
import { filterImageCandidates } from "./images";

/**
 * Discourse fast path — public topics serve clean JSON at `<topic-url>.json`,
 * so no scraping is needed at all: title + first post + its images, straight
 * from the API the forum itself uses.
 */

/** A Discourse topic URL: /t/<slug>/<id>[...]. */
export function discourseTopicJsonUrl(url: URL): string | null {
  const match = /^\/t\/([^/]+)\/(\d+)/.exec(url.pathname);
  if (!match) return null;
  return `${url.origin}/t/${match[1]}/${match[2]}.json`;
}

export function looksLikeDiscourse(html: string): boolean {
  return /<meta[^>]+name=["']generator["'][^>]+discourse/i.test(html) || /discourse-cdn|Discourse\.BaseUrl/i.test(html);
}

export async function fetchDiscourseTopic(
  url: URL,
  opts: { allowPrivate: boolean }
): Promise<
  | { ok: true; source: Omit<NormalizedImportSource, "sourceType" | "fetchMethod"> }
  | { ok: false; code: "source_parse_failed" | "source_fetch_failed" }
> {
  const jsonUrl = discourseTopicJsonUrl(url);
  if (!jsonUrl) return { ok: false, code: "source_parse_failed" };

  const result = await safeFetch(jsonUrl, {
    maxBytes: 3_000_000,
    accept: "application/json",
    allowPrivate: opts.allowPrivate,
  });
  if (!result.ok) return { ok: false, code: "source_fetch_failed" };

  try {
    const topic = JSON.parse(result.body.toString("utf8")) as {
      title?: string;
      post_stream?: { posts?: { cooked?: string; post_number?: number }[] };
    };
    const first = topic.post_stream?.posts?.find((p) => p.post_number === 1) ??
      topic.post_stream?.posts?.[0];
    if (!first?.cooked) return { ok: false, code: "source_parse_failed" };

    const $ = loadHtml(`<div id="op">${first.cooked}</div>`);
    $("#op blockquote, #op aside.quote").remove();
    const text = elementText($, "#op");
    if (!text) return { ok: false, code: "source_parse_failed" };

    const images = filterImageCandidates(
      $("#op img")
        .toArray()
        .map((el) => {
          const src = $(el).attr("src") ?? "";
          const href = $(el).parent("a").attr("href");
          const full = href && /\.(jpe?g|png|webp|avif)(\?|$)/i.test(href) ? href : src;
          try {
            return { url: new URL(full, url.origin).href };
          } catch {
            return { url: "" };
          }
        })
        .filter((c) => Boolean(c.url))
    );

    return { ok: true, source: { title: topic.title?.trim(), text, images } };
  } catch {
    return { ok: false, code: "source_parse_failed" };
  }
}
