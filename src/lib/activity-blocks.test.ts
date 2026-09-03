import { describe, expect, it } from "vitest";

import { blockHasContent, leadingBeforeAfter, normalizeBlocks, youtubeId } from "./activity-blocks";

describe("normalizeBlocks", () => {
  it("upgrades legacy V0 sections", () => {
    expect(
      normalizeBlocks([{ heading: "Wheels", text: "TE37s on." }, { body: "More soon." }]),
    ).toEqual([
      { type: "text", style: "heading", text: "Wheels" },
      { type: "text", style: "normal", text: "TE37s on." },
      { type: "text", style: "normal", text: "More soon." },
    ]);
  });

  it("keeps V1 blocks and derives missing embed ids", () => {
    const blocks = normalizeBlocks([
      { type: "text", style: "heading", text: "Dyno day" },
      { type: "images", urls: ["https://x/a.jpg", 42] },
      { type: "embed", url: "https://youtu.be/dQw4w9WgXcQ" },
    ]);
    expect(blocks).toEqual([
      { type: "text", style: "heading", text: "Dyno day" },
      { type: "images", urls: ["https://x/a.jpg"] },
      {
        type: "embed",
        provider: "youtube",
        url: "https://youtu.be/dQw4w9WgXcQ",
        videoId: "dQw4w9WgXcQ",
      },
    ]);
  });

  it("accepts the V2 automotive set and defends malformed fields", () => {
    const blocks = normalizeBlocks([
      { type: "divider" },
      { type: "mod", action: "removed", modItemId: "m1", label: "APR Intake", detail: "  " },
      { type: "mod", action: "explode", label: "KW V3" },
      { type: "mod", action: "installed", label: "" },
      {
        type: "before_after",
        beforeUrl: "https://x/b.jpg",
        afterUrl: "https://x/a.jpg",
        beforeLabel: "Stock",
      },
      { type: "before_after", beforeUrl: "https://x/b.jpg" },
      {
        type: "performance",
        kind: "dyno",
        entries: [
          { label: "Power", value: "412 whp" },
          { label: "Torque", value: "" },
          { bad: true },
        ],
        note: "93 octane",
      },
      { type: "performance", kind: "dyno", entries: [] },
      { type: "mileage", value: 41842.4, unit: "mi" },
      { type: "mileage", value: -5 },
      { type: "hologram", spin: true },
    ]);
    expect(blocks).toEqual([
      { type: "divider" },
      { type: "mod", action: "removed", modItemId: "m1", label: "APR Intake", detail: undefined },
      { type: "mod", action: "installed", modItemId: null, label: "KW V3", detail: undefined },
      {
        type: "before_after",
        beforeUrl: "https://x/b.jpg",
        afterUrl: "https://x/a.jpg",
        beforeLabel: "Stock",
        afterLabel: undefined,
      },
      {
        type: "performance",
        kind: "dyno",
        entries: [{ label: "Power", value: "412 whp" }],
        note: "93 octane",
      },
      { type: "mileage", value: 41842, unit: "mi" },
    ]);
  });

  it("returns [] for non-arrays", () => {
    expect(normalizeBlocks(null)).toEqual([]);
    expect(normalizeBlocks("hi")).toEqual([]);
  });
});

describe("blockHasContent", () => {
  it("judges every type", () => {
    expect(blockHasContent({ type: "text", style: "normal", text: "  " })).toBe(false);
    expect(blockHasContent({ type: "divider" })).toBe(true);
    expect(blockHasContent({ type: "mileage", value: 0, unit: "mi" })).toBe(false);
    expect(
      blockHasContent({ type: "mod", action: "installed", modItemId: null, label: "KW" }),
    ).toBe(true);
  });
});

describe("leadingBeforeAfter", () => {
  const ba = { type: "before_after" as const, beforeUrl: "https://x/b.jpg", afterUrl: "https://x/a.jpg" };
  const images = { type: "images" as const, urls: ["https://x/1.jpg"] };
  const text = { type: "text" as const, text: "Wheels and a drop." };

  it("returns the pair when the first media block is the plate", () => {
    expect(leadingBeforeAfter(normalizeBlocks([ba, images]))).toEqual({
      beforeUrl: ba.beforeUrl,
      afterUrl: ba.afterUrl,
    });
  });

  it("lets prose come first — text does not decide the cover", () => {
    expect(leadingBeforeAfter(normalizeBlocks([text, ba]))).toEqual({
      beforeUrl: ba.beforeUrl,
      afterUrl: ba.afterUrl,
    });
  });

  it("defers to a gallery that comes first", () => {
    expect(leadingBeforeAfter(normalizeBlocks([images, ba]))).toBeNull();
  });

  it("is null without a plate", () => {
    expect(leadingBeforeAfter(normalizeBlocks([text, images]))).toBeNull();
    expect(leadingBeforeAfter([])).toBeNull();
  });
});

describe("youtubeId", () => {
  it("parses common forms", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://example.com/nope")).toBeNull();
  });
});
