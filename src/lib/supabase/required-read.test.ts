import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

import { reportError } from "@/lib/monitoring";

import { requiredRead } from "./required-read";

describe("requiredRead", () => {
  it("returns the rows of a successful read, empty included", () => {
    expect(requiredRead({ data: [{ id: "a" }], error: null }, "your cars")).toEqual([{ id: "a" }]);
    expect(requiredRead({ data: [], error: null }, "your cars")).toEqual([]);
    expect(requiredRead({ data: null, error: null }, "this car")).toBeNull();
  });

  it("throws on a failed read rather than reading it as nothing there", () => {
    const failed = { data: null, error: { message: "connection reset", code: "08006" } };
    expect(() => requiredRead(failed, "the mod list")).toThrow("Could not load the mod list");
    expect(reportError).toHaveBeenCalledWith("[read] the mod list failed to load", failed.error);
  });
});
