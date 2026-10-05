import { describe, expect, it } from "vitest";

import { setupAlreadySaved } from "./card-setup";

describe("setupAlreadySaved", () => {
  it("counts a retry that finds the card already saved as saved", () => {
    expect(
      setupAlreadySaved({ code: "setup_intent_unexpected_state", setup_intent: { status: "succeeded" } }),
    ).toBe(true);
  });

  it("does not count an unexpected state that saved nothing", () => {
    expect(
      setupAlreadySaved({ code: "setup_intent_unexpected_state", setup_intent: { status: "canceled" } }),
    ).toBe(false);
  });

  it("does not count a decline", () => {
    expect(setupAlreadySaved({ code: "card_declined" })).toBe(false);
  });
});
