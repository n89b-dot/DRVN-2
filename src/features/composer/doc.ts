import {
  blockHasContent,
  youtubeId,
  type ActivityBlock,
  type ModBlock,
  type PerformanceBlock,
} from "@/lib/activity-blocks";

/**
 * The boundary between DRVN's activity document model and the composer's
 * editor runtime (Tiptap/ProseMirror). Editor state is NEVER stored — these
 * two pure functions transform in both directions, and the round trip is
 * unit-tested. If the editor engine ever changes, this file is the only seam
 * that moves.
 *
 * Mapping:
 *   text normal   ↔ paragraph (hardBreak ↔ "\n", round-trip exact)
 *   text heading  ↔ heading level 2
 *   divider       ↔ horizontalRule
 *   images        ↔ gallery atom          (attrs.urls)
 *   embed         ↔ youtube atom          (attrs.url/videoId)
 *   mod           ↔ modChange atom
 *   before_after  ↔ beforeAfter atom
 *   performance   ↔ performanceResult atom
 *   mileage       ↔ mileageMilestone atom
 */

type PmText = { type: "text"; text: string };
type PmHardBreak = { type: "hardBreak" };
export type PmNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: (PmNode | PmText | PmHardBreak)[];
};
export type PmDoc = { type: "doc"; content: PmNode[] };

function inline(text: string): (PmText | PmHardBreak)[] {
  const parts = text.split("\n");
  const out: (PmText | PmHardBreak)[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push({ type: "hardBreak" });
    if (part) out.push({ type: "text", text: part });
  });
  return out;
}

export function blocksToDoc(blocks: ActivityBlock[]): PmDoc {
  const content: PmNode[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        content.push(
          block.style === "heading"
            ? { type: "heading", attrs: { level: 2 }, content: inline(block.text) }
            : { type: "paragraph", content: inline(block.text) },
        );
        break;
      case "divider":
        content.push({ type: "horizontalRule" });
        break;
      case "images":
        content.push({ type: "gallery", attrs: { urls: block.urls } });
        break;
      case "embed":
        content.push({ type: "youtube", attrs: { url: block.url, videoId: block.videoId } });
        break;
      case "mod":
        content.push({
          type: "modChange",
          attrs: {
            action: block.action,
            modItemId: block.modItemId,
            label: block.label,
            detail: block.detail ?? null,
          },
        });
        break;
      case "before_after":
        content.push({
          type: "beforeAfter",
          attrs: {
            beforeUrl: block.beforeUrl,
            afterUrl: block.afterUrl,
            beforeLabel: block.beforeLabel ?? null,
            afterLabel: block.afterLabel ?? null,
          },
        });
        break;
      case "performance":
        content.push({
          type: "performanceResult",
          attrs: { kind: block.kind, entries: block.entries, note: block.note ?? null },
        });
        break;
      case "mileage":
        content.push({ type: "mileageMilestone", attrs: { value: block.value, unit: block.unit } });
        break;
    }
  }
  // An empty document still needs one paragraph to type into.
  if (content.length === 0) content.push({ type: "paragraph" });
  return { type: "doc", content };
}

function inlineText(content: (PmNode | PmText | PmHardBreak)[] | undefined): string {
  if (!content) return "";
  let out = "";
  for (const node of content) {
    if (node.type === "text") out += (node as PmText).text;
    else if (node.type === "hardBreak") out += "\n";
  }
  return out;
}

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

export function docToBlocks(doc: PmDoc | null | undefined): ActivityBlock[] {
  if (!doc?.content) return [];
  const blocks: ActivityBlock[] = [];
  for (const node of doc.content) {
    const attrs = node.attrs ?? {};
    switch (node.type) {
      case "paragraph": {
        const text = inlineText(node.content);
        blocks.push({ type: "text", style: "normal", text });
        break;
      }
      case "heading": {
        const text = inlineText(node.content);
        blocks.push({ type: "text", style: "heading", text });
        break;
      }
      case "horizontalRule":
        blocks.push({ type: "divider" });
        break;
      case "gallery": {
        const urls = Array.isArray(attrs.urls)
          ? (attrs.urls as unknown[]).filter((u): u is string => typeof u === "string")
          : [];
        blocks.push({ type: "images", urls });
        break;
      }
      case "youtube": {
        const url = typeof attrs.url === "string" ? attrs.url : "";
        const videoId =
          typeof attrs.videoId === "string" && attrs.videoId ? attrs.videoId : youtubeId(url);
        if (url && videoId) {
          blocks.push({ type: "embed", provider: "youtube", url, videoId });
        }
        break;
      }
      case "modChange": {
        const label = typeof attrs.label === "string" ? attrs.label : "";
        const action = (["installed", "removed", "replaced", "updated"] as const).includes(
          attrs.action as ModBlock["action"],
        )
          ? (attrs.action as ModBlock["action"])
          : "installed";
        blocks.push({
          type: "mod",
          action,
          modItemId: typeof attrs.modItemId === "string" ? attrs.modItemId : null,
          label,
          detail: str(attrs.detail),
        });
        break;
      }
      case "beforeAfter": {
        blocks.push({
          type: "before_after",
          beforeUrl: typeof attrs.beforeUrl === "string" ? attrs.beforeUrl : "",
          afterUrl: typeof attrs.afterUrl === "string" ? attrs.afterUrl : "",
          beforeLabel: str(attrs.beforeLabel),
          afterLabel: str(attrs.afterLabel),
        });
        break;
      }
      case "performanceResult": {
        const entries = Array.isArray(attrs.entries)
          ? (attrs.entries as { label?: unknown; value?: unknown }[])
              .filter(
                (row): row is { label: string; value: string } =>
                  typeof row?.label === "string" && typeof row?.value === "string" && Boolean(row.value),
              )
              .slice(0, 8)
          : [];
        blocks.push({
          type: "performance",
          kind: (attrs.kind as PerformanceBlock["kind"]) ?? "other",
          entries,
          note: str(attrs.note),
        });
        break;
      }
      case "mileageMilestone": {
        const value = typeof attrs.value === "number" ? Math.round(attrs.value) : 0;
        blocks.push({ type: "mileage", value, unit: attrs.unit === "km" ? "km" : "mi" });
        break;
      }
    }
  }
  // Publishing drops contentless blocks (blank paragraphs, empty galleries).
  return blocks.filter(blockHasContent);
}
