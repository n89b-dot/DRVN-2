import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
  profile: vi.fn(),
  needsAge: vi.fn(),
}));

vi.mock("@/lib/age-confirmation-record", () => ({ needsReturningAgeConfirmation: mocks.needsAge }));

vi.mock("@/lib/site", () => ({ siteUrl: () => "https://drvn.example" }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: mocks.exchangeCodeForSession, getUser: mocks.getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => mocks.profile() }) }) }),
  }),
}));

import { GET } from "./route";

const callback = async (query: string) => (await GET(new Request(`https://drvn.example/callback?${query}`))).headers.get("location");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  mocks.profile.mockReturnValue({ data: { username: "kaito" }, error: null });
  mocks.needsAge.mockResolvedValue(false);
});

// Readiness N44: an abandoned Google sign-in is not an expired emailed link.
describe("OAuth returns that carry no session", () => {
  it("says cancelled when the person backed out at Google, keeping the destination", async () => {
    expect(await callback("error=access_denied&error_description=The+user+denied&next=%2Flistings%2Fabc")).toBe(
      "https://drvn.example/login?message=oauth-cancelled&next=%2Flistings%2Fabc"
    );
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("gives a banned account the durable access notice (N43)", async () => {
    expect(await callback("error=access_denied&error_code=user_banned&error_description=User+is+banned")).toBe(
      "https://drvn.example/login?message=access-blocked"
    );
    mocks.exchangeCodeForSession.mockResolvedValue({ error: { code: "user_banned", message: "User is banned" } });
    expect(await callback("code=abc")).toBe("https://drvn.example/login?message=access-blocked");
  });

  it("says Google didn't finish for any other provider error", async () => {
    expect(await callback("error=server_error&error_code=unexpected_failure")).toBe("https://drvn.example/login?message=oauth-failed");
  });

  it("keeps the expired-link notice for a code that won't exchange", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: { code: "flow_state_expired", message: "expired" } });
    expect(await callback("code=abc")).toBe("https://drvn.example/login?message=auth-error");
    expect(await callback("")).toBe("https://drvn.example/login?message=auth-error");
  });
});

describe("successful OAuth returns", () => {
  it("sends a member with a handle to the validated destination", async () => {
    expect(await callback("code=abc&next=%2Fsettings%23danger")).toBe("https://drvn.example/settings#danger");
    expect(await callback("code=abc&next=%2F%09%2Fevil.com")).toBe("https://drvn.example/home");
  });

  it("sends an account with no profile row to onboarding, not round a loop (N40)", async () => {
    mocks.profile.mockReturnValue({ data: null, error: null });
    expect(await callback("code=abc&next=%2Fgarage")).toBe("https://drvn.example/onboarding?next=%2Fgarage");
  });
});

// N686: a member from before the 18+ confirmation answers it once on the way in.
describe("an earlier member signing in with Google (N686)", () => {
  it("N686: goes to /confirm-age first, keeping the destination", async () => {
    mocks.needsAge.mockResolvedValue(true);
    expect(await callback("code=abc&next=%2Flistings%2Fabc")).toBe("https://drvn.example/confirm-age?next=%2Flistings%2Fabc");
    expect(await callback("code=abc")).toBe("https://drvn.example/confirm-age");
    expect(mocks.needsAge).toHaveBeenCalledWith({ id: "u1" });
  });

  it("N686: an account with no handle still goes to onboarding, which asks there", async () => {
    mocks.needsAge.mockResolvedValue(true);
    mocks.profile.mockReturnValue({ data: { username: null }, error: null });
    expect(await callback("code=abc")).not.toMatch(/confirm-age/);
  });
});

