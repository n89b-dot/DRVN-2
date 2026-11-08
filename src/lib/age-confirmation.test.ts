import { describe, expect, it } from "vitest";

import { AGE_CONFIRMATION_SINCE, ageConfirmationPath, joinedBeforeAgeConfirmation } from "./age-confirmation";

describe("who is asked the 18+ question at sign-in (N686)", () => {
  it("N686: accounts created before the confirmation shipped are asked; later ones are not", () => {
    expect(AGE_CONFIRMATION_SINCE).toBe("2026-11-08T02:03:15Z");
    expect(joinedBeforeAgeConfirmation("2026-09-05T10:00:00Z")).toBe(true);
    expect(joinedBeforeAgeConfirmation("2026-11-08T02:03:14.999Z")).toBe(true);
    expect(joinedBeforeAgeConfirmation("2026-11-08T02:03:15Z")).toBe(false);
    expect(joinedBeforeAgeConfirmation("2026-12-01T00:00:00Z")).toBe(false);
  });

  it("N686: an unknown creation date reads as earlier, because asking is harmless", () => {
    expect(joinedBeforeAgeConfirmation(undefined)).toBe(true);
    expect(joinedBeforeAgeConfirmation(null)).toBe(true);
    expect(joinedBeforeAgeConfirmation("not a date")).toBe(true);
  });

  it("N686: the confirmation page keeps the destination", () => {
    expect(ageConfirmationPath("/listings/abc?action=offer")).toBe("/confirm-age?next=%2Flistings%2Fabc%3Faction%3Doffer");
    expect(ageConfirmationPath()).toBe("/confirm-age");
  });
});
