/**
 * DRVN's activity document model — the canonical content format for build
 * updates, stored in activity_posts.body as an ordered block array.
 *
 * Version history, all reconciled on read by normalizeBlocks (the shape is
 * self-describing; no stored version number needed):
 *   V0 — legacy [{heading, text|body}] sections (still written by the quick
 *        path pre-unification; upgraded to text blocks).
 *   V1 — text / images / embed blocks.
 *   V2 — adds the automotive storytelling set (brief §O): divider, mod
 *        change, before/after, performance result, mileage milestone.
 *
 * The composer runs on Tiptap (editor RUNTIME only — see
 * src/features/composer/); editor state is transformed to/from THIS model at
 * the boundary and is never stored. Old posts keep rendering because
 * normalizeBlocks keeps accepting every prior shape.
 */

export type TextBlock = { type: "text"; style: "normal" | "heading"; text: string };
export type ImagesBlock = { type: "images"; urls: string[] };
export type EmbedBlock = { type: "embed"; provider: "youtube"; url: string; videoId: string };
/** A quiet horizontal rule between chapters of a long update. */
export type DividerBlock = { type: "divider" };

/**
 * A build change this update is about. References the real mod_items row when
 * one exists (never duplicating its data); `label` is a display snapshot so
 * the story survives the mod being edited or deleted. action "removed" is
 * also the contextual bridge to "Sell this part" (brief §I/§O).
 */
export type ModBlock = {
  type: "mod";
  action: "installed" | "removed" | "replaced" | "updated";
  modItemId: string | null;
  label: string;
  /** Optional supporting line ("replacing the H&R springs"). */
  detail?: string;
};

/** Two-image comparison — suspension drops, wheels, wraps, detailing. */
export type BeforeAfterBlock = {
  type: "before_after";
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
};

export type PerformanceKind = "dyno" | "quarter_mile" | "lap" | "weight" | "other";

/** Owner-reported numbers — always labeled as such in the renderer. */
export type PerformanceBlock = {
  type: "performance";
  kind: PerformanceKind;
  /** Small structured rows: [{label: "Power", value: "412 whp"}, …] */
  entries: { label: string; value: string }[];
  note?: string;
};

/** Lightweight odometer context for the update. Not a maintenance tracker. */
export type MileageBlock = { type: "mileage"; value: number; unit: "mi" | "km" };

export type ActivityBlock =
  | TextBlock
  | ImagesBlock
  | EmbedBlock
  | DividerBlock
  | ModBlock
  | BeforeAfterBlock
  | PerformanceBlock
  | MileageBlock;

export const PERFORMANCE_KINDS: { value: PerformanceKind; label: string }[] = [
  { value: "dyno", label: "Dyno" },
  { value: "quarter_mile", label: "Quarter mile" },
  { value: "lap", label: "Lap time" },
  { value: "weight", label: "Weight" },
  { value: "other", label: "Result" },
];

export const MOD_ACTIONS: { value: ModBlock["action"]; label: string }[] = [
  { value: "installed", label: "Installed" },
  { value: "removed", label: "Removed" },
  { value: "replaced", label: "Replaced" },
  { value: "updated", label: "Updated" },
];

/** Extracts a YouTube video id from watch/short/embed/share URL forms. */
export function youtubeId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

type LegacySection = { heading?: string | null; text?: string; body?: string };

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

export function normalizeBlocks(body: unknown): ActivityBlock[] {
  if (!Array.isArray(body)) return [];
  const blocks: ActivityBlock[] = [];

  for (const raw of body) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;

    if (typeof entry.type === "string") {
      // Typed block formats (V1 + V2) — validate loosely, drop what can't
      // render rather than failing the post.
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
      } else if (entry.type === "divider") {
        blocks.push({ type: "divider" });
      } else if (entry.type === "mod" && str(entry.label)) {
        const action = ["installed", "removed", "replaced", "updated"].includes(
          entry.action as string
        )
          ? (entry.action as ModBlock["action"])
          : "installed";
        blocks.push({
          type: "mod",
          action,
          modItemId: typeof entry.modItemId === "string" ? entry.modItemId : null,
          label: entry.label as string,
          detail: str(entry.detail),
        });
      } else if (
        entry.type === "before_after" &&
        str(entry.beforeUrl) &&
        str(entry.afterUrl)
      ) {
        blocks.push({
          type: "before_after",
          beforeUrl: entry.beforeUrl as string,
          afterUrl: entry.afterUrl as string,
          beforeLabel: str(entry.beforeLabel),
          afterLabel: str(entry.afterLabel),
        });
      } else if (entry.type === "performance" && Array.isArray(entry.entries)) {
        const kind = PERFORMANCE_KINDS.some((k) => k.value === entry.kind)
          ? (entry.kind as PerformanceKind)
          : "other";
        const entries = entry.entries
          .filter(
            (row): row is { label: string; value: string } =>
              !!row &&
              typeof row === "object" &&
              typeof (row as Record<string, unknown>).label === "string" &&
              typeof (row as Record<string, unknown>).value === "string" &&
              Boolean((row as Record<string, unknown>).value)
          )
          .slice(0, 8);
        if (entries.length) blocks.push({ type: "performance", kind, entries, note: str(entry.note) });
      } else if (
        entry.type === "mileage" &&
        typeof entry.value === "number" &&
        Number.isFinite(entry.value) &&
        entry.value >= 0 &&
        entry.value < 10_000_000
      ) {
        blocks.push({
          type: "mileage",
          value: Math.round(entry.value),
          unit: entry.unit === "km" ? "km" : "mi",
        });
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

/**
 * Every storage URL a block set references — gallery images plus both sides
 * of before/after comparisons. Publishing finalizes these against the
 * staged-upload GC (0029); the activity_images mirror still takes only
 * gallery urls (feed covers stay gallery photos).
 */
export function blockMediaUrls(blocks: ActivityBlock[]): string[] {
  const urls: string[] = [];
  for (const block of blocks) {
    if (block.type === "images") urls.push(...block.urls);
    else if (block.type === "before_after") urls.push(block.beforeUrl, block.afterUrl);
  }
  return [...new Set(urls)];
}

/**
 * The before/after pair an update leads with, if it does — the card cover
 * for a post whose first *media* block is the comparison plate (prose may
 * come first; it doesn't decide the picture). Cards can't run the slider,
 * so they draw the pair as a static split (mosaic.tsx); no composite asset
 * is ever generated, the two originals are reused.
 */
export function leadingBeforeAfter(
  blocks: ActivityBlock[]
): { beforeUrl: string; afterUrl: string } | null {
  const lead = blocks.find(
    (block) => (block.type === "images" || block.type === "before_after") && blockHasContent(block)
  );
  return lead?.type === "before_after" ? { beforeUrl: lead.beforeUrl, afterUrl: lead.afterUrl } : null;
}

/** True when a block carries publishable content (used by serializers). */
export function blockHasContent(block: ActivityBlock): boolean {
  switch (block.type) {
    case "text":
      return block.text.trim().length > 0;
    case "images":
      return block.urls.length > 0;
    case "embed":
      return Boolean(block.videoId);
    case "divider":
      return true;
    case "mod":
      return block.label.trim().length > 0;
    case "before_after":
      return Boolean(block.beforeUrl && block.afterUrl);
    case "performance":
      return block.entries.length > 0;
    case "mileage":
      return block.value > 0;
  }
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * A post page shows a lead (intro line + photo gallery) and then the blocks.
 * The editor writes the same first paragraph and photos into both, so the
 * lead keeps only what the blocks don't already show — otherwise every post
 * reads paragraph, photo, paragraph, photo. Legacy posts with no blocks keep
 * their whole lead.
 */
export function postLead<T extends { url: string }>(
  intro: string | null | undefined,
  images: readonly T[],
  blocks: readonly ActivityBlock[]
): { intro: string | null; images: T[] } {
  const texts = new Set<string>();
  const urls = new Set<string>();
  for (const block of blocks) {
    if (block.type === "text") texts.add(squash(block.text));
    if (block.type === "images") block.urls.forEach((url) => urls.add(url));
    if (block.type === "before_after") [block.beforeUrl, block.afterUrl].forEach((url) => url && urls.add(url));
  }
  const lead = intro?.trim() ? intro : null;
  return {
    intro: lead && !texts.has(squash(lead)) ? lead : null,
    images: images.filter((image) => !urls.has(image.url)),
  };
}
