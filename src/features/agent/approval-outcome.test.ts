import { describe, expect, it } from "vitest";

import { approvalOutcomeNote, readApprovalOutcome } from "./approval-outcome";

describe("readApprovalOutcome (N128)", () => {
  it.each(["accepted", "expired", "refused", "noop", "dismissed"] as const)("reads %s from the RPC result", (outcome) => {
    expect(readApprovalOutcome({ approval_id: "a-1", status: "x", outcome, replayed: false })).toBe(outcome);
  });

  it.each([
    ["no result", null],
    ["no outcome (an old database)", { approval_id: "a-1", status: "approved" }],
    ["an unknown outcome", { outcome: "done" }],
    ["a string", "accepted"],
  ])("returns null for %s", (_label, data) => {
    expect(readApprovalOutcome(data)).toBeNull();
  });
});

describe("approvalOutcomeNote (N128)", () => {
  it("says accepted only for an accept", () => {
    expect(approvalOutcomeNote("accepted")).toEqual({ ok: "Accepted. The buyer has 24 hours to pay." });
    for (const outcome of ["expired", "refused", "noop", "dismissed", null] as const) {
      expect(JSON.stringify(approvalOutcomeNote(outcome))).not.toMatch(/Accepted|has 24 hours to pay/);
    }
  });

  it("tells an expired offer apart: nothing was sold", () => {
    expect(approvalOutcomeNote("expired")).toEqual({ error: "This offer expired before you accepted it, so nothing was sold." });
  });

  it("tells a refused accept apart, and points to the offer", () => {
    const note = approvalOutcomeNote("refused");
    expect(note.error).toMatch(/can't be accepted any more, so nothing was sold/);
    expect(note.ok).toBeUndefined();
  });

  it("tells a no-op apart: nothing changed", () => {
    expect(approvalOutcomeNote("noop").error).toMatch(/moved on before you answered, so nothing changed/);
  });

  it("keeps the dismissal copy", () => {
    expect(approvalOutcomeNote("dismissed")).toEqual({ ok: "Dismissed. Your agent waits for the next move on this offer." });
  });

  it("never treats an unknown outcome as a sale", () => {
    expect(approvalOutcomeNote(null)).toEqual({ error: "Couldn't confirm what happened. Open the offer to see where it stands." });
  });

  it("gives each outcome its own copy", () => {
    const notes = (["accepted", "expired", "refused", "noop", "dismissed", null] as const).map((o) => JSON.stringify(approvalOutcomeNote(o)));
    expect(new Set(notes).size).toBe(notes.length);
  });
});
