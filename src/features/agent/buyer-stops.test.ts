import { describe, expect, it } from "vitest";

import { buyerStops, type StopMandate, type StopTask } from "./buyer-stops";

const mandate = (id: string, status = "active", scope = "buyer"): StopMandate => ({ id, listing_id: `l-${id}`, scope, status });
const task = (id: string, mandateId: string, finished = false, scope = "buyer"): StopTask => ({
  id,
  scope,
  mandate_id: mandateId,
  listing_id: `l-${mandateId}`,
  finished_at: finished ? "2026-11-07T10:00:00Z" : null,
});

describe("buyerStops (readiness 64): Stop on every live buyer mandate, once", () => {
  it("puts it on the Working row of an open task", () => {
    const stops = buyerStops([mandate("m1")], [task("t1", "m1")], []);
    expect(stops.onTask.get("t1")).toBe("m1");
    expect(stops.onApproval.size).toBe(0);
    expect(stops.alone).toEqual([]);
  });

  it("puts it on the Needs you row when the agent waits on the buyer", () => {
    const stops = buyerStops([mandate("m1")], [task("t1", "m1")], [{ id: "a1", task_id: "t1" }]);
    expect(stops.onApproval.get("a1")).toBe("m1");
    expect(stops.onTask.size).toBe(0);
    expect(stops.alone).toEqual([]);
  });

  it("gives a live mandate whose task finished a row of its own, paused ones included", () => {
    const stops = buyerStops([mandate("m1"), mandate("m2", "paused")], [task("t1", "m1", true)], []);
    expect(stops.onTask.size).toBe(0);
    expect(stops.alone.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("never offers it for a seller mandate, an ended one, or twice", () => {
    const stops = buyerStops(
      [mandate("m1"), mandate("s1", "active", "seller"), mandate("m3", "revoked")],
      [task("t1", "m1"), task("t2", "m1"), task("t3", "s1", false, "seller"), task("t4", "m3")],
      [],
    );
    expect([...stops.onTask.entries()]).toEqual([["t1", "m1"]]);
    expect(stops.alone).toEqual([]);
  });
});
