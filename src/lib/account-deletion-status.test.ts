import { describe, expect, it } from "vitest";

import { deletionReferenceNotice, deletionStatusNotice } from "./account-deletion-status";

describe("N35 a member can see where their deletion stands", () => {
  it("says a held request is on hold, why, and that nothing was deleted", () => {
    const notice = deletionStatusNotice({ outcome: "temporary_financial_hold", next_action: "Finish outstanding orders, then request deletion again.", updated_at: "2026-11-07T00:00:00Z" });
    expect(notice?.title).toBe("Your deletion request is on hold");
    expect(notice?.body).toContain("Finish outstanding orders");
    expect(notice?.body).toContain("Nothing has been deleted yet");
  });

  it("says when an operator has to finish it, and how to ask", () => {
    expect(deletionStatusNotice({ outcome: "operator_attention", next_action: null, updated_at: "x" })?.body).toContain("hello@drvn.app");
  });

  it("says nothing when there is no request or it's done", () => {
    expect(deletionStatusNotice(null)).toBeNull();
    expect(deletionStatusNotice({ outcome: "completed", next_action: null, updated_at: "x" })).toBeNull();
  });
});

describe("OS-W11 follow-up: the same case for a member who can no longer sign in", () => {
  it("names every state the worker records, including completion", () => {
    for (const outcome of ["cleanup_pending", "temporary_financial_hold", "operator_attention", "completed"]) {
      expect(deletionReferenceNotice(outcome)?.title).toBeTruthy();
    }
    expect(deletionReferenceNotice("unknown")).toBeNull();
  });

  it("never tells a signed-out member to keep using the account", () => {
    for (const outcome of ["cleanup_pending", "temporary_financial_hold", "operator_attention", "completed"]) {
      expect(deletionReferenceNotice(outcome)?.body).not.toMatch(/keep using your account/i);
    }
  });
});

describe("OS-W11 follow-up: a held deletion names the order to settle", () => {
  it("says which order, and that sign-in still works", () => {
    const notice = deletionReferenceNotice("temporary_financial_hold", "a1b2c3d4-0000-4000-8000-000000000001");
    expect(notice?.title).toBe("Paused: settle order A1B2C3D4");
    expect(notice?.body).toContain("still sign in");
  });
});
