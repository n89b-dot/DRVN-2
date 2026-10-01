import { describe, expect, it } from "vitest";

import { buildTimeline } from "@/features/commerce/conversation-timeline";

import { dayKeyIn, validTimeZone } from "./viewer-timezone";

describe("viewer timezone (RR-13)", () => {
  it("buckets a midnight-UTC crossing by the reader's zone, the same everywhere", () => {
    // 23:58 and 00:02 UTC: two UTC days, one New York evening.
    const a = "2026-10-01T23:58:00Z";
    const b = "2026-10-02T00:02:00Z";
    expect([dayKeyIn(a, "UTC"), dayKeyIn(b, "UTC")]).toEqual(["2026-10-01", "2026-10-02"]);
    expect([dayKeyIn(a, "America/New_York"), dayKeyIn(b, "America/New_York")]).toEqual(["2026-10-01", "2026-10-01"]);
    expect([dayKeyIn(a, "America/Los_Angeles"), dayKeyIn(b, "America/Los_Angeles")]).toEqual(["2026-10-01", "2026-10-01"]);
    expect([dayKeyIn(a, "Asia/Tokyo"), dayKeyIn(b, "Asia/Tokyo")]).toEqual(["2026-10-02", "2026-10-02"]);
  });

  it("follows a daylight-saving change", () => {
    // US clocks go back at 06:00 UTC on 1 Nov 2026. Before that New York is EDT (-4):
    // 03:30 UTC is 23:30 on 31 Oct, 04:30 UTC is 00:30 on 1 Nov.
    expect(dayKeyIn("2026-11-01T03:30:00Z", "America/New_York")).toBe("2026-10-31");
    expect(dayKeyIn("2026-11-01T04:30:00Z", "America/New_York")).toBe("2026-11-01");
    // After the change (EST, -5) 04:59 local on 1 Nov is 09:59 UTC.
    expect(dayKeyIn("2026-11-01T09:59:00Z", "America/New_York")).toBe("2026-11-01");
  });

  it("gives the server and the browser the same timeline when they share a zone", () => {
    const messages = [
      { id: "m1", sender_id: "me", body: "Still got it?", created_at: "2026-10-01T23:58:00Z", kind: "message" as const, dealKey: null, photos: [], read_at: null },
      { id: "m2", sender_id: "them", body: "Yes", created_at: "2026-10-02T00:02:00Z", kind: "message" as const, dealKey: null, photos: [], read_at: null },
    ];
    const build = (tz: string) =>
      buildTimeline({ messages, events: [], me: "me", otherName: "Sam", dayOf: (iso) => dayKeyIn(iso, tz) });
    const days = (tz: string) => build(tz).filter((i) => i.type === "day").length;
    expect(days("UTC")).toBe(2);
    expect(days("America/New_York")).toBe(1);
    expect(build("America/New_York")).toEqual(build("America/New_York"));
  });

  it("accepts real zones only", () => {
    expect(validTimeZone("Europe/London")).toBe("Europe/London");
    expect(validTimeZone("Not/AZone")).toBeNull();
    expect(validTimeZone("")).toBeNull();
    expect(validTimeZone(undefined)).toBeNull();
    expect(validTimeZone("x".repeat(65))).toBeNull();
  });
});
