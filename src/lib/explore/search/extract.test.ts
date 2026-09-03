import { describe, expect, it } from "vitest";

import { activitySearchText } from "./extract";

describe("activitySearchText", () => {
  it("extracts user-visible text: text blocks, mod labels/details, performance notes", () => {
    const body = [
      { type: "text", style: "heading", text: "Suspension day" },
      { type: "text", style: "normal", text: "Finally fitted the coilovers." },
      {
        type: "mod",
        action: "installed",
        modItemId: null,
        label: "Bilstein B16 coilovers",
        detail: "Full corner balance after",
      },
      { type: "performance", kind: "lap", entries: [{ label: "Lap", value: "1:42.1" }], note: "PB at the glen" },
      { type: "mileage", value: 42000, unit: "mi" },
    ];
    const text = activitySearchText(body);
    expect(text).toContain("Suspension day");
    expect(text).toContain("Finally fitted the coilovers.");
    expect(text).toContain("Bilstein B16 coilovers");
    expect(text).toContain("Full corner balance after");
    expect(text).toContain("PB at the glen");
  });

  it("never leaks internal structure — urls, ids, enum values", () => {
    const body = [
      { type: "images", urls: ["https://cdn.example/private-path/img.jpg"] },
      { type: "embed", provider: "youtube", url: "https://youtu.be/abc123xyz00", videoId: "abc123xyz00" },
      {
        type: "mod",
        action: "installed",
        modItemId: "11111111-2222-3333-4444-555555555555",
        label: "Intake",
      },
      { type: "divider" },
    ];
    const text = activitySearchText(body);
    expect(text).not.toContain("cdn.example");
    expect(text).not.toContain("abc123xyz00");
    expect(text).not.toContain("1111");
    expect(text).not.toContain("installed");
    expect(text).toBe("Intake");
  });

  it("tolerates junk", () => {
    expect(activitySearchText(null)).toBe("");
    expect(activitySearchText("nonsense")).toBe("");
    expect(activitySearchText([{ type: "unknown" }])).toBe("");
  });
});
