import { describe, expect, it } from "vitest";
import { deletionOutcome } from "./account-deletion-policy";

describe("account deletion outcomes", () => {
  it("keeps a fresh financial hold distinct from permanent identity retention", () => {
    expect(deletionOutcome({ financial_hold: true, retained_identity: true })).toBe("temporary_financial_hold");
    expect(deletionOutcome({ retained_identity: true })).toBe("operator_attention");
    expect(deletionOutcome({})).toBe("hard_delete_eligible");
  });
});
