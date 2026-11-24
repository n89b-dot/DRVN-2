import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getVehicleModels } = await import("./vpic");

describe("models for a make", () => {
  it("answers nothing, and asks nothing, for a name holding a wildcard", async () => {
    const from = vi.fn();
    for (const make of ["a%", "%", "b_w", "a*", "a\\"]) {
      expect(await getVehicleModels({ from } as never, make), make).toEqual([]);
    }
    expect(from).not.toHaveBeenCalled();
  });
});
