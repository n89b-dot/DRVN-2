import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  allow: vi.fn(),
  alert: vi.fn(),
  getUser: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/abuse-identity", () => ({ abuseIdentity: (_h: unknown, id?: string) => (id ? `user:${id}` : "network:abc") }));
vi.mock("@/lib/admin/alerts", () => ({ sendAdminAlert: mocks.alert }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/rate-limit", () => ({
  allowAction: mocks.allow,
  RATE_LIMITS: { copyrightNotice: { action: "copyright-notice", limit: 5, windowSeconds: 3600 } },
  rateLimitMessage: () => "Too many notices. Try again later.",
}));
vi.mock("@/lib/copyright/hosts", () => ({ copyrightHosts: () => ({ site: ["drvn.app"], storage: ["proj.supabase.co"] }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: (row: unknown) => ({ select: () => ({ single: async () => mocks.insert(table, row) }) }),
    }),
  }),
}));

const { submitCopyrightNotice } = await import("./copyright-actions");

const LISTING = "8f6c2a52-3d1e-4b8a-9c3f-2b1d4e5f6a7b";

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields = {
    claimant_name: "Pat Photographer",
    claimant_email: "pat@example.test",
    claimant_address: "1 High Street, Leeds",
    work_description: "My photograph of a K03 turbo.",
    content_urls: `https://drvn.app/listings/${LISTING}`,
    good_faith: "yes",
    accurate_and_authorised: "yes",
    signature: "Pat Photographer",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.allow.mockResolvedValue(true);
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  mocks.insert.mockResolvedValue({ data: { id: "0b1c2d3e-0000-4000-8000-000000000000" }, error: null });
});

// R69-dmca: the public notice route.
describe("submitting a copyright notice", () => {
  it("stores a complete notice from a visitor with no account, and alerts admins", async () => {
    const result = await submitCopyrightNotice(null, form());
    expect(result?.ok).toMatch(/Notice received \(reference 0b1c2d3e\)/);
    expect(mocks.insert).toHaveBeenCalledWith("copyright_notices", expect.objectContaining({
      claimant_name: "Pat Photographer",
      content_urls: [`https://drvn.app/listings/${LISTING}`],
      good_faith: true,
      accurate_and_authorised: true,
      submitted_by: null,
    }));
    expect(mocks.alert).toHaveBeenCalledWith(expect.objectContaining({ kind: "copyright_notice" }));
    expect(mocks.allow).toHaveBeenCalledWith(expect.objectContaining({ action: "copyright-notice" }), "network:abc");
  });

  it("stores nothing without the statements, and says which fields", async () => {
    const result = await submitCopyrightNotice(null, form({ good_faith: "", signature: "" }));
    expect(result?.errors).toMatchObject({ good_faith: expect.any(String), signature: expect.any(String) });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.allow).not.toHaveBeenCalled();
  });

  it("stores nothing past the rate limit", async () => {
    mocks.allow.mockResolvedValue(false);
    await expect(submitCopyrightNotice(null, form())).resolves.toEqual({ error: "Too many notices. Try again later." });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("records who sent it when they were signed in", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "member-1" } } });
    await submitCopyrightNotice(null, form());
    expect(mocks.insert).toHaveBeenCalledWith("copyright_notices", expect.objectContaining({ submitted_by: "member-1" }));
  });
});
