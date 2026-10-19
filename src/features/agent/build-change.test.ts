import { describe, expect, it } from "vitest";

import { buildChangeItems, groupForCategory, type BuildDraft, type SheetRow } from "./build-change";

const car = "33333333-3333-4333-8333-333333333333";
const row = (id: string, position: number, extra: Partial<SheetRow> = {}): SheetRow => ({
  id,
  group_label: "Suspension",
  brand: "APR",
  product: "Roll-Control mount",
  part_number: null,
  category: "suspension",
  confidence: null,
  raw_text: "APR Roll-Control mount",
  position,
  status: "installed",
  product_url: null,
  image_url: null,
  source_domain: null,
  ref_price_cents: null,
  ref_price_currency: null,
  origin: "aftermarket",
  ...extra,
});
const draft = (extra: Partial<BuildDraft> = {}): BuildDraft => ({
  kind: "build_change",
  id: "55555555-5555-4555-8555-555555555555",
  car,
  replaces: null,
  brand: "KW",
  product: "V3 coilovers",
  part_number: "35210012",
  category: "suspension",
  product_url: null,
  image_url: null,
  ...extra,
});

describe("Update my build: what Confirm saves", () => {
  it("adds a new part at the end, in its category's group", () => {
    const plan = buildChangeItems([row("a", 0, { group_label: "Performance", category: "intake" })], draft());
    expect(plan.kind).toBe("save");
    if (plan.kind !== "save") return;
    expect(plan.items.map((item) => [item.id, item.status, item.position])).toEqual([
      ["a", "installed", 0],
      [draft().id, "installed", 1],
    ]);
    expect(plan.items[1]).toMatchObject({ group_label: "Suspension", brand: "KW", product: "V3 coilovers", part_number: "35210012", raw_text: "KW V3 coilovers" });
    expect(plan.sellHref).toBeNull();
  });

  it("replaces like the editor: the old line is kept and marked removed, the new one goes just above it", () => {
    const plan = buildChangeItems([row("a", 0), row("b", 1, { group_label: "Wheels & Tires" }), row("c", 2)], draft({ replaces: "b" }));
    if (plan.kind !== "save") throw new Error(plan.kind);
    expect(plan.items.map((item) => [item.id, item.status])).toEqual([
      ["a", "installed"],
      [draft().id, "installed"],
      ["b", "removed"],
      ["c", "installed"],
    ]);
    expect(plan.items[1].group_label).toBe("Wheels & Tires");
    expect(plan.items.map((item) => item.position)).toEqual([0, 1, 2, 3]);
    expect(plan.sellHref).toBe(`/sell?car=${car}&mod=b`);
  });

  it("does nothing twice: a draft already on the sheet is saved", () => {
    expect(buildChangeItems([row(draft().id, 0)], draft({ replaces: "b" }))).toEqual({ kind: "saved", sellHref: `/sell?car=${car}&mod=b` });
  });

  it("won't replace a part that's gone or already came off", () => {
    expect(buildChangeItems([row("a", 0)], draft({ replaces: "b" }))).toEqual({ kind: "stale" });
    expect(buildChangeItems([row("b", 0, { status: "removed" })], draft({ replaces: "b" }))).toEqual({ kind: "stale" });
  });

  it("keeps every other line's details as they were", () => {
    const linked = row("a", 0, { product_url: "https://shop.example.com/x", ref_price_cents: 12900, ref_price_currency: "USD", origin: "stock" });
    const plan = buildChangeItems([linked], draft());
    if (plan.kind !== "save") throw new Error(plan.kind);
    expect(plan.items[0]).toMatchObject({ product_url: "https://shop.example.com/x", ref_price_cents: 12900, ref_price_currency: "USD", origin: "stock" });
  });

  it("puts each category in a build-sheet group", () => {
    expect(groupForCategory("wheels")).toBe("Wheels & Tires");
    expect(groupForCategory("turbo")).toBe("Performance");
    expect(groupForCategory(null)).toBe("Other");
  });
});
