import { describe, expect, it } from "vitest";

import { addBusinessDays, isBusinessDay } from "./business-days";

const at = (iso: string) => new Date(iso);

describe("business days (Mon–Fri, UTC, no holidays)", () => {
  it("knows weekdays from weekends in UTC", () => {
    expect(isBusinessDay(at("2026-11-06T23:59:00Z"))).toBe(true); // Friday
    expect(isBusinessDay(at("2026-11-07T00:00:00Z"))).toBe(false); // Saturday
    expect(isBusinessDay(at("2026-11-08T12:00:00Z"))).toBe(false); // Sunday
    expect(isBusinessDay(at("2026-11-09T00:00:00Z"))).toBe(true); // Monday
  });

  it("skips the weekend and keeps the time of day", () => {
    // Thursday + 3 = Tuesday (Fri, Mon, Tue).
    expect(addBusinessDays(at("2026-11-05T10:00:00Z"), 3).toISOString()).toBe("2026-11-10T10:00:00.000Z");
    // Friday + 1 = Monday.
    expect(addBusinessDays(at("2026-11-06T16:30:00Z"), 1).toISOString()).toBe("2026-11-09T16:30:00.000Z");
    // Monday + 5 = next Monday.
    expect(addBusinessDays(at("2026-11-09T08:00:00Z"), 5).toISOString()).toBe("2026-11-16T08:00:00.000Z");
  });

  it("counts from a weekend start to the next weekdays", () => {
    // Saturday + 1 = Monday; Sunday + 3 = Wednesday.
    expect(addBusinessDays(at("2026-11-07T10:00:00Z"), 1).toISOString()).toBe("2026-11-09T10:00:00.000Z");
    expect(addBusinessDays(at("2026-11-08T10:00:00Z"), 3).toISOString()).toBe("2026-11-11T10:00:00.000Z");
  });

  it("matches the dispute windows: 3 and 21 business days", () => {
    const reported = at("2026-11-06T09:00:00Z"); // Friday
    expect(addBusinessDays(reported, 3).toISOString()).toBe("2026-11-11T09:00:00.000Z");
    // 21 business days = 4 full weeks and 1 day: Monday 7 Dec.
    expect(addBusinessDays(reported, 21).toISOString()).toBe("2026-12-07T09:00:00.000Z");
  });

  it("has no holiday calendar: Thanksgiving and Christmas count", () => {
    // Wed 25 Nov 2026 + 1 = Thu 26 Nov (Thanksgiving) — counted.
    expect(addBusinessDays(at("2026-11-25T12:00:00Z"), 1).toISOString()).toBe("2026-11-26T12:00:00.000Z");
    // Thu 24 Dec + 1 = Fri 25 Dec — counted.
    expect(addBusinessDays(at("2026-12-24T12:00:00Z"), 1).toISOString()).toBe("2026-12-25T12:00:00.000Z");
  });

  it("is the same instant for zero and refuses nonsense", () => {
    const sat = at("2026-11-07T10:00:00Z");
    expect(addBusinessDays(sat, 0).getTime()).toBe(sat.getTime());
    expect(() => addBusinessDays(sat, -1)).toThrow(RangeError);
    expect(() => addBusinessDays(sat, 1.5)).toThrow(RangeError);
  });
});
