import { describe, expect, it } from "vitest";

import { leadCar, orderCars } from "./order";

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
