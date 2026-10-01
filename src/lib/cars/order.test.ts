import { describe, expect, it } from "vitest";

import { leadCar, orderCars, withMainCar } from "./order";

const cars = [
  { id: "old", created_at: "2026-01-01T00:00:00Z" },
  { id: "mid", created_at: "2026-05-01T00:00:00Z" },
  { id: "new", created_at: "2026-09-01T00:00:00Z" },
];

describe("car order (P-5)", () => {
  it("is newest-first when no main car is set — today's behaviour, unchanged", () => {
    expect(orderCars(cars, null).map((c) => c.id)).toEqual(["new", "mid", "old"]);
    expect(orderCars(cars, undefined).map((c) => c.id)).toEqual(["new", "mid", "old"]);
  });

  it("leads with the main car, then newest first", () => {
    expect(orderCars(cars, "old").map((c) => c.id)).toEqual(["old", "new", "mid"]);
  });

  it("ignores a main car that isn't in the list", () => {
    // A car can be deleted, or the list can be a filtered subset (public
    // cars only). Neither is a reason to render nothing.
    expect(orderCars(cars, "sold-last-year").map((c) => c.id)).toEqual(["new", "mid", "old"]);
  });

  it("breaks timestamp ties by id so repeated reads agree", () => {
    const same = [
      { id: "b", created_at: "2026-01-01T00:00:00Z" },
      { id: "a", created_at: "2026-01-01T00:00:00Z" },
    ];
    expect(orderCars(same, null).map((c) => c.id)).toEqual(["b", "a"]);
    expect(orderCars([...same].reverse(), null).map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("leadCar answers the same question in one value", () => {
    expect(leadCar(cars, "mid")?.id).toBe("mid");
    expect(leadCar(cars, null)?.id).toBe("new");
    expect(leadCar([], null)).toBeNull();
  });
});

describe("withMainCar (RR-12)", () => {
  // 25 cars, newest first, and the read was limited to the newest 24 — the
  // oldest car, which is the member's main car, didn't make the cut.
  const all = Array.from({ length: 25 }, (_, i) => ({
    id: `car-${i}`,
    created_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
  })).reverse();
  const newest24 = all.slice(0, 24);
  const oldest = { ...all[24], owner_id: "me" };

  it("leads with a main car older than the limited read", () => {
    const garage = orderCars(withMainCar(newest24, oldest, "me"), oldest.id);
    expect(garage[0].id).toBe("car-0");
    expect(garage).toHaveLength(25);
  });

  it("doesn't duplicate a main car the read already has", () => {
    const main = { ...newest24[3], owner_id: "me" };
    expect(withMainCar(newest24, main, "me")).toHaveLength(24);
  });

  it("ignores a missing or someone else's main car", () => {
    expect(withMainCar(newest24, null, "me")).toBe(newest24);
    expect(withMainCar(newest24, { ...oldest, owner_id: "them" }, "me")).toBe(newest24);
  });
});
