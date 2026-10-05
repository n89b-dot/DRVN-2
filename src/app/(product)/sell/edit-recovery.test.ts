import { describe, expect, it } from "vitest";

import { editFingerprint, settleEarlierEdits, type EditCheck } from "./edit-recovery";

/** A status check that answers from a table and records what it was asked. */
function checker(answers: Record<string, EditCheck>) {
  const asked: string[] = [];
  const check = async (requestId: string) => {
    asked.push(requestId);
    return answers[requestId];
  };
  return { asked, check };
}

describe("settleEarlierEdits", () => {
  it("hands back the version an earlier save produced", async () => {
    const { check } = checker({ a: { outcome: "saved", version: "2026-10-04T10:00:01.000Z" } });
    expect(await settleEarlierEdits(["a"], check)).toEqual({
      outcome: "saved",
      version: "2026-10-04T10:00:01.000Z",
    });
  });

  it("says none when the server has no record of any earlier save", async () => {
    const { asked, check } = checker({ a: { outcome: "not_found" }, b: { outcome: "not_found" } });
    expect(await settleEarlierEdits(["a", "b"], check)).toEqual({ outcome: "none" });
    expect(asked).toEqual(["a", "b"]);
  });

  // The case behind the false "another tab" message: a check that couldn't
  // be made must never be read as "it didn't save".
  it("stays unknown while any earlier save can't be checked", async () => {
    const { check } = checker({ a: { outcome: "unavailable" }, b: { outcome: "not_found" } });
    expect(await settleEarlierEdits(["a", "b"], check)).toEqual({ outcome: "unknown" });
  });

  it("a save found committed settles it, whatever the others answered", async () => {
    const { asked, check } = checker({
      a: { outcome: "unavailable" },
      b: { outcome: "saved", version: "v1" },
      c: { outcome: "not_found" },
    });
    expect(await settleEarlierEdits(["a", "b", "c"], check)).toEqual({ outcome: "saved", version: "v1" });
    // They all started from one version, so only one can have committed.
    expect(asked).toEqual(["a", "b"]);
  });

  it("asks nothing when there is nothing earlier", async () => {
    const { asked, check } = checker({});
    expect(await settleEarlierEdits([], check)).toEqual({ outcome: "none" });
    expect(asked).toEqual([]);
  });

  // The form's check rethrows a redirect (a signed-out session) for Next to
  // follow; it must not be swallowed into an answer here.
  it("lets a thrown check through", async () => {
    const check = async () => {
      throw new Error("NEXT_REDIRECT");
    };
    await expect(settleEarlierEdits(["a"], check)).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("editFingerprint", () => {
  const draft = (price: string, version: string, requestId?: string) => {
    const formData = new FormData();
    formData.set("id", "listing");
    formData.set("expected_updated_at", version);
    formData.set("price", price);
    if (requestId) formData.set("request_id", requestId);
    return formData;
  };

  it("is the same for the same draft, whichever request carries it", () => {
    expect(editFingerprint(draft("97.00", "v0", "one"))).toBe(editFingerprint(draft("97.00", "v0", "two")));
    expect(editFingerprint(draft("97.00", "v0", "one"))).toBe(editFingerprint(draft("97.00", "v0")));
  });

  it("changes with a field, and with the version the edit starts from", () => {
    expect(editFingerprint(draft("96.00", "v0"))).not.toBe(editFingerprint(draft("97.00", "v0")));
    expect(editFingerprint(draft("97.00", "v1"))).not.toBe(editFingerprint(draft("97.00", "v0")));
  });

  // After an earlier save's version is adopted, the next submit of the same
  // draft must recognise itself: set() keeps the field where it was.
  it("matches the form's own next submit after the expected version is replaced", () => {
    const sent = draft("96.00", "v0", "one");
    sent.set("expected_updated_at", "v1");
    expect(editFingerprint(sent)).toBe(editFingerprint(draft("96.00", "v1")));
  });
});
