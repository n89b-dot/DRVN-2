import { describe, expect, it } from "vitest";

import { UNPROVEN_BUYER_REVIEW_MESSAGE, isUnprovenBuyerRefusal, reviewRefusalMessage } from "./review-refusal";

// The trigger's refusal (20261005101000), as PostgREST hands it back.
const refusal = { code: "42501", message: "This buyer checked out as a guest, so they can't be reviewed on this order", details: null, hint: null };

describe("review refusal mapping", () => {
  it("names the unconfirmed-buyer refusal in the member's words", () => {
    expect(isUnprovenBuyerRefusal(refusal)).toBe(true);
    expect(reviewRefusalMessage(refusal)).toBe(UNPROVEN_BUYER_REVIEW_MESSAGE);
    expect(UNPROVEN_BUYER_REVIEW_MESSAGE).toBe("This buyer checked out as a guest without a confirmed email, so they can't be reviewed on this order.");
    // Snapshotted when the order is placed (20261005101000): a later
    // confirmation never opens the review, so the copy must not promise it.
    expect(UNPROVEN_BUYER_REVIEW_MESSAGE).not.toMatch(/\byet\b/i);
  });

  it("leaves every other error to the generic retry message", () => {
    expect(reviewRefusalMessage({ code: "42501", message: "new row violates row-level security policy" })).toBeNull();
    expect(reviewRefusalMessage({ code: "23505", message: "duplicate key value" })).toBeNull();
    expect(reviewRefusalMessage({ message: "checked out as a guest" })).toBeNull();
    expect(reviewRefusalMessage(null)).toBeNull();
    expect(reviewRefusalMessage("checked out as a guest")).toBeNull();
  });
});
