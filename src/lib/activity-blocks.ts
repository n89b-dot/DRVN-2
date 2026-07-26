/**
 * Block model for activity posts (read.cv-style composer). Stored in
 * activity_posts.body as an ordered array. Older posts stored
 * [{heading, text|body}] sections — normalizeBlocks upgrades those on read.
 */

export type TextBlock = { type: "text"; style: "normal" | "heading"; text: string };
export type ImagesBlock = { type: "images"; urls: string[] };
export type EmbedBlock = { type: "embed"; provider: "youtube"; url: string; videoId: string };

export type ActivityBlock = TextBlock | ImagesBlock | EmbedBlock;

/** Extracts a YouTube video id from watch/short/embed/share URL forms. */
export function youtubeId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

type LegacySection = { heading?: string | null; text?: string; body?: string };

export function normalizeBlocks(body: unknown): ActivityBlock[] {
  if (!Array.isArray(body)) return [];
  const blocks: ActivityBlock[] = [];

  for (const raw of body) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;

    if (typeof entry.type === "string") {
      // New block format — validate loosely.
      if (entry.type === "text" && typeof entry.text === "string") {
        blocks.push({
          type: "text",
          style: entry.style === "heading" ? "heading" : "normal",
          text: entry.text,
        });
      } else if (entry.type === "images" && Array.isArray(entry.urls)) {
        const urls = entry.urls.filter((u): u is string => typeof u === "string");
        if (urls.length) blocks.push({ type: "images", urls });
      } else if (entry.type === "embed" && typeof entry.url === "string") {
        const videoId = typeof entry.videoId === "string" ? entry.videoId : youtubeId(entry.url);
        if (videoId) blocks.push({ type: "embed", provider: "youtube", url: entry.url, videoId });
      }
      continue;
    }

    // Legacy {heading, text|body} section.
    const legacy = entry as LegacySection;
    if (legacy.heading) blocks.push({ type: "text", style: "heading", text: legacy.heading });
    const text = legacy.text ?? legacy.body;
    if (text) blocks.push({ type: "text", style: "normal", text });
  }

  return blocks;
}
