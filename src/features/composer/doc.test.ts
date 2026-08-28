import { describe, expect, it } from "vitest";

import type { ActivityBlock } from "@/lib/activity-blocks";

import { blocksToDoc, docToBlocks } from "./doc";

const FULL_STORY: ActivityBlock[] = [
  { type: "text", style: "heading", text: "KW V3 installed" },
  { type: "text", style: "normal", text: "Finally.\nTwo lines of story." },
  { type: "mod", action: "installed", modItemId: "m1", label: "KW V3 Coilovers", detail: "over H&R" },
  { type: "images", urls: ["https://x/a.jpg", "https://x/b.jpg"] },
  { type: "before_after", beforeUrl: "https://x/b.jpg", afterUrl: "https://x/a.jpg", beforeLabel: "Stock" },
  { type: "divider" },
  {
    type: "performance",
    kind: "dyno",
    entries: [
      { label: "Power", value: "412 whp" },
      { label: "Torque", value: "391 lb-ft" },
    ],
    note: "93 octane",
  },
  { type: "mileage", value: 41842, unit: "mi" },
  { type: "embed", provider: "youtube", url: "https://youtu.be/dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ" },
];

describe("composer document boundary", () => {
  it("round-trips every block type exactly", () => {
    expect(docToBlocks(blocksToDoc(FULL_STORY))).toEqual(FULL_STORY);
  });

  it("an empty document serializes to an empty block list", () => {
    expect(docToBlocks(blocksToDoc([]))).toEqual([]);
  });

  it("drops contentless editor nodes on publish", () => {
    const doc = blocksToDoc([{ type: "text", style: "normal", text: "hello" }]);
    doc.content.push({ type: "paragraph" }, { type: "gallery", attrs: { urls: [] } });
    expect(docToBlocks(doc)).toEqual([{ type: "text", style: "normal", text: "hello" }]);
  });

  it("derives a missing embed id from the url and drops unresolvable embeds", () => {
    const blocks = docToBlocks({
      type: "doc",
      content: [
        { type: "youtube", attrs: { url: "https://youtu.be/dQw4w9WgXcQ", videoId: "" } },
        { type: "youtube", attrs: { url: "https://example.com/no" } },
      ],
    });
    expect(blocks).toEqual([
      {
        type: "embed",
        provider: "youtube",
        url: "https://youtu.be/dQw4w9WgXcQ",
        videoId: "dQw4w9WgXcQ",
      },
    ]);
  });
});
