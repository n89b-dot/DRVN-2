import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ needs: vi.fn(), headers: new Map<string, string>() }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (name: string) => mocks.headers.get(name) ?? null }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`redirect ${to}`), { digest: `NEXT_REDIRECT;${to}` });
  },
}));
vi.mock("@/lib/age-confirmation-record", () => ({ needsReturningAgeConfirmation: mocks.needs }));

import { requireAgeConfirmed } from "./age-gate";

const member = { id: "member-1", created_at: "2026-10-01T00:00:00Z" };

beforeEach(() => {
  mocks.needs.mockReset();
  mocks.headers.clear();
  mocks.headers.set("host", "drvn.test");
});

describe("N662: the 18+ confirmation holds the actions that matter (work review #152)", () => {
  it("lets a member with nothing owed carry on", async () => {
    mocks.needs.mockResolvedValue(false);
    await expect(requireAgeConfirmed(member)).resolves.toBeUndefined();
    expect(mocks.needs).toHaveBeenCalledWith(member);
  });

  it("sends a member who still owes the answer to the question, and back to the page they were on", async () => {
    mocks.needs.mockResolvedValue(true);
    mocks.headers.set("referer", "https://drvn.test/orders/abc?view=sales");
    await expect(requireAgeConfirmed(member)).rejects.toThrow("redirect /confirm-age?next=%2Forders%2Fabc%3Fview%3Dsales");
  });

  it("carries no destination from another site, a missing page or an unsafe path", async () => {
    mocks.needs.mockResolvedValue(true);
    for (const referer of ["https://evil.example/messages", "not a url", "https://drvn.test//evil.example", ""]) {
      if (referer) mocks.headers.set("referer", referer);
      else mocks.headers.delete("referer");
      await expect(requireAgeConfirmed(member), referer).rejects.toThrow(/^redirect \/confirm-age$/);
    }
  });

  it("reads the public host behind a proxy", async () => {
    mocks.needs.mockResolvedValue(true);
    mocks.headers.set("host", "internal:3000");
    mocks.headers.set("x-forwarded-host", "drvn.test");
    mocks.headers.set("referer", "https://drvn.test/sell");
    await expect(requireAgeConfirmed(member)).rejects.toThrow("redirect /confirm-age?next=%2Fsell");
  });
});
