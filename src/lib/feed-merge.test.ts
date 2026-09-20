import { describe, expect, it } from "vitest";

import { followedFeedPage, mergeFollowedRows, spaceSellerRuns, type MergeRow } from "./feed-merge";

const row = (id: string, at: string, extra: Partial<MergeRow> = {}): MergeRow => ({
  kind: "part",
  id,
  happened_at: at,
  ...extra,
});

describe("followed feed ordering (B-1)", () => {
  it("shows a listing once when the seller AND the car are both followed", () => {
    // The same listing legitimately arrives from two queries: one because
    // the viewer follows the seller, one because they follow the car the
    // part came off. Following two things is not a reason to see two cards.
    const bySeller = [row("listing-a", "2026-09-10T10:00:00Z", { sellerId: "kaito" })];
    const byCar = [row("listing-a", "2026-09-10T10:00:00Z", { sellerId: "kaito" })];
    const merged = mergeFollowedRows([bySeller, byCar]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("listing-a");
  });

  it("keeps a car and a listing that happen to share an id", () => {
    // Ids are unique per table, not across them; dedupe is by kind AND id.
    const merged = mergeFollowedRows([
      [row("same", "2026-09-10T10:00:00Z", { kind: "car" })],
      [row("same", "2026-09-10T10:00:00Z", { kind: "part" })],
    ]);
    expect(merged).toHaveLength(2);
  });

  it("orders newest first and breaks ties by id, identically every time", () => {
    // A bulk insert stamps rows with the same timestamp. Without a total
    // order, page one and page two disagree about which came first, and a
    // card is either shown twice or skipped.
    const shared = "2026-09-10T10:00:00Z";
    const forward = mergeFollowedRows([
      [row("b", shared), row("a", shared), row("c", "2026-09-11T10:00:00Z")],
    ]);
    const reversed = mergeFollowedRows([
      [row("a", shared), row("c", "2026-09-11T10:00:00Z"), row("b", shared)],
    ]);
    expect(forward.map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(reversed.map((r) => r.id)).toEqual(forward.map((r) => r.id));
  });

  it("never repeats or skips a row across pages, as the real feed fetches them", () => {
    // Each request fetches a LONGER prefix than the last (page * size + 1 per
    // lane), so the test pages the same way: spacing a growing prefix before
    // cutting it is exactly what used to repeat one card and lose another.
    const at = (n: number) => `2026-09-10T10:${String(59 - n).padStart(2, "0")}:00Z`;
    const seller: MergeRow[] = [
      ...["k1", "k2", "k3", "k4", "k5"].map((id, i) => row(id, at(i), { sellerId: "kaito" })),
      row("j1", at(5), { sellerId: "jade" }),
      ...["k6", "k7", "k8"].map((id, i) => row(id, at(6 + i), { sellerId: "kaito" })),
    ];
    const posts: MergeRow[] = ["m1", "m2", "m3"].map((id, i) =>
      row(id, at(20 + i), { kind: "update" })
    );
    const pageSize = 4;
    const seen: string[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const limit = page * pageSize + 1;
      const { rows, hasMore } = followedFeedPage(
        [seller.slice(0, limit), posts.slice(0, limit)],
        page,
        pageSize
      );
      seen.push(...rows.map((r) => r.id));
      expect(hasMore).toBe(page < 3);
    }
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });

  it("holds a shared-timestamp boundary still", () => {
    const shared = "2026-09-10T10:00:00Z";
    // Newest first with the id tie-break, as the database lane returns them.
    const rows = ["f", "e", "d", "c", "b", "a"].map((id) => row(id, shared));
    const ids = [1, 2, 3].flatMap((page) =>
      followedFeedPage([rows.slice(0, page * 2 + 1)], page, 2).rows.map((r) => r.id)
    );
    expect(ids).toEqual(["f", "e", "d", "c", "b", "a"]);
  });
});

describe("per-seller fairness", () => {
  it("lets at most three of one seller's rows sit together", () => {
    const rows: MergeRow[] = [
      row("1", "2026-09-10T10:05:00Z", { sellerId: "kaito" }),
      row("2", "2026-09-10T10:04:00Z", { sellerId: "kaito" }),
      row("3", "2026-09-10T10:03:00Z", { sellerId: "kaito" }),
      row("4", "2026-09-10T10:02:00Z", { sellerId: "kaito" }),
      row("5", "2026-09-10T10:01:00Z", { sellerId: "marisol" }),
    ];
    const spaced = spaceSellerRuns(rows);
    // The fourth wheel waits for somebody else, then comes straight back.
    expect(spaced.map((r) => r.id)).toEqual(["1", "2", "3", "5", "4"]);
  });

  it("defers rather than drops — a seller alone in the feed keeps every row", () => {
    const rows = ["1", "2", "3", "4", "5"].map((id, i) =>
      row(id, `2026-09-10T10:0${5 - i}:00Z`, { sellerId: "kaito" })
    );
    const spaced = spaceSellerRuns(rows);
    expect(spaced).toHaveLength(5);
    expect(new Set(spaced.map((r) => r.id)).size).toBe(5);
  });

  it("keeps one seller's rows newest first when some were deferred", () => {
    const rows: MergeRow[] = [
      ...["1", "2", "3", "4", "5"].map((id, i) =>
        row(id, `2026-09-10T10:1${9 - i}:00Z`, { sellerId: "kaito" })
      ),
      row("j", "2026-09-10T10:09:00Z", { sellerId: "jade" }),
      row("6", "2026-09-10T10:08:00Z", { sellerId: "kaito" }),
    ];
    const kaito = spaceSellerRuns(rows)
      .filter((r) => r.sellerId === "kaito")
      .map((r) => r.id);
    expect(kaito).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("leaves cars and updates alone — they have no seller", () => {
    const rows: MergeRow[] = ["1", "2", "3", "4", "5"].map((id, i) =>
      row(id, `2026-09-10T10:0${5 - i}:00Z`, { kind: "update" })
    );
    expect(spaceSellerRuns(rows).map((r) => r.id)).toEqual(["1", "2", "3", "4", "5"]);
  });
});
