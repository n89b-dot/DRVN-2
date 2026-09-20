import { describe, expect, it } from "vitest";

import { hasTitle, postHeadline } from "./headline";

describe("what to call a post with no title (W-1)", () => {
  it("uses the author's title when there is one", () => {
    expect(postHeadline({ title: "The head is off" })).toBe("The head is off");
    expect(hasTitle({ title: "The head is off" })).toBe(true);
  });

  it("falls back to the author's own first line, not a generated one", () => {
    // "Update from the Silvia" would be DRVN's sentence, not theirs.
    const headline = postHeadline({
      title: null,
      body: [{ type: "text", style: "normal", text: "New wheels turned up this morning." }],
    });
    expect(headline).toBe("New wheels turned up this morning.");
    expect(hasTitle({ title: null })).toBe(false);
  });

  it("clamps a long first line at a word boundary", () => {
    const long = `${"a really long sentence ".repeat(10)}end`;
    const headline = postHeadline({ title: "", body: [{ type: "text", style: "normal", text: long }] });
    expect(headline.length).toBeLessThanOrEqual(91);
    expect(headline.endsWith("…")).toBe(true);
  });

  it("prefers the intro over the body", () => {
    expect(
      postHeadline({
        title: null,
        intro: "Coilovers in",
        body: [{ type: "text", style: "normal", text: "Body text" }],
      })
    ).toBe("Coilovers in");
  });

  it("says something plain rather than nothing", () => {
    expect(postHeadline({ title: null, body: [] })).toBe("Update");
    expect(postHeadline({ title: "   ", body: null })).toBe("Update");
    // A malformed body is not a reason to render nothing.
    expect(postHeadline({ title: null, body: "not blocks" as never })).toBe("Update");
  });

  it("reads a mod block's label when there is no prose", () => {
    expect(
      postHeadline({
        title: null,
        body: [{ type: "mod", action: "installed", modItemId: null, label: "HKS Hipermax" }],
      })
    ).toBe("HKS Hipermax");
  });
});
