import { describe, expect, it } from "vitest";

import { buttonClass } from "./button";

/**
 * The Button contract is a mapping from semantic variant to the Livesheet
 * class recipes — these assertions pin the mapping so a refactor can't
 * silently unhook a variant from its stylesheet contract (which the
 * responsive e2e suite selects on).
 */
describe("buttonClass", () => {
  it("maps every variant to its Livesheet recipe", () => {
    expect(buttonClass()).toBe("btn");
    expect(buttonClass("default")).toBe("btn");
    expect(buttonClass("live")).toBe("btn btn--live");
    expect(buttonClass("ghost")).toBe("btn btn--ghost");
    expect(buttonClass("destructive")).toBe("btn btn--destructive");
    expect(buttonClass("quiet")).toBe("relbtn !static");
  });

  it("appends layout-only classes after the recipe", () => {
    expect(buttonClass("live", "mt-4 w-full")).toBe("btn btn--live mt-4 w-full");
  });
});
