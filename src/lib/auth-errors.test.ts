import { beforeEach, describe, expect, it, vi } from "vitest";

const reportError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/monitoring", () => ({ reportError }));

import {
  AUTH_ERROR_COPY,
  LOGIN_NOTICES,
  authErrorCode,
  loginNotice,
  oauthReturnNotice,
  publicAuthError,
} from "./auth-errors";

beforeEach(() => reportError.mockClear());

// Readiness N49: provider wording never reaches a person; N43: a ban is
// durable, never "try again".
describe("public auth error copy", () => {
  it("maps Supabase codes and legacy messages to public codes", () => {
    expect(authErrorCode({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe("invalid_credentials");
    expect(authErrorCode({ message: "Invalid login credentials" })).toBe("invalid_credentials");
    expect(authErrorCode({ code: "email_exists" })).toBe("account_exists");
    expect(authErrorCode({ code: "over_email_send_rate_limit" })).toBe("rate_limited");
    expect(authErrorCode({ code: "same_password" })).toBe("same_password");
    expect(authErrorCode({ code: "reauthentication_needed" })).toBe("reauthentication_needed");
    expect(authErrorCode({ code: "session_not_found" })).toBe("session_expired");
    expect(authErrorCode({ code: "something_new", message: "AuthApiError: relation auth.x does not exist" })).toBe("unavailable");
    expect(authErrorCode(null)).toBe("unavailable");
    expect(authErrorCode("boom")).toBe("unavailable");
  });

  it("treats a banned account as blocked, with copy that never says try again", () => {
    expect(authErrorCode({ code: "user_banned", message: "User is banned" })).toBe("access_blocked");
    expect(authErrorCode({ message: "User is banned" })).toBe("access_blocked");
    expect(AUTH_ERROR_COPY.access_blocked).not.toMatch(/try again|moment/i);
    expect(AUTH_ERROR_COPY.access_blocked).toContain("hello@drvn.app");
  });

  it("never returns the provider's message, and reports only what wasn't expected", () => {
    const raw = { code: "unexpected_failure", message: "duplicate key value violates unique constraint \"users_pkey\"" };
    const copy = publicAuthError(raw, "sign-up", { userId: "u1" });
    expect(copy).toBe(AUTH_ERROR_COPY.unavailable);
    expect(copy).not.toContain("duplicate key");
    expect(reportError).toHaveBeenCalledWith("[auth] sign-up failed", expect.objectContaining({ userId: "u1", code: "unavailable", error: raw }));

    reportError.mockClear();
    expect(publicAuthError({ code: "invalid_credentials", message: "Invalid login credentials" }, "sign-in")).toBe(
      "That email and password don't match."
    );
    expect(reportError).not.toHaveBeenCalled();
  });

  it("every public copy string is a sentence, not an internal identifier", () => {
    for (const copy of Object.values(AUTH_ERROR_COPY)) {
      expect(copy).toMatch(/^[A-Z].*[.!]$/);
      expect(copy).not.toMatch(/supabase|AuthApiError|_/i);
    }
  });
});

// Readiness N44: a cancelled Google sign-in is not an expired email link.
describe("OAuth return notices", () => {
  const notice = (query: string) => oauthReturnNotice(new URLSearchParams(query));

  it("says cancelled when the person backed out at Google", () => {
    expect(notice("error=access_denied&error_description=The+user+denied+the+request")).toBe("oauth-cancelled");
    expect(notice("error_code=access_denied")).toBe("oauth-cancelled");
  });

  it("says blocked when the account is banned", () => {
    expect(notice("error=access_denied&error_code=user_banned&error_description=User+is+banned")).toBe("access-blocked");
    expect(notice("error=server_error&error_description=User+is+banned")).toBe("access-blocked");
  });

  it("says failed for any other provider refusal, and nothing without error params", () => {
    expect(notice("error=server_error&error_code=unexpected_failure")).toBe("oauth-failed");
    expect(notice("error=invalid_request")).toBe("oauth-failed");
    expect(notice("code=abc&next=%2Fgarage")).toBeNull();
    expect(notice("")).toBeNull();
  });

  it("keeps the expired-link copy for links, and only known notices render", () => {
    expect(LOGIN_NOTICES["auth-error"].body).toMatch(/expired/);
    expect(LOGIN_NOTICES["oauth-cancelled"].body).not.toMatch(/expired|invalid/i);
    expect(LOGIN_NOTICES["access-blocked"].body).not.toMatch(/try again/i);
    expect(loginNotice("oauth-cancelled")).toBe("oauth-cancelled");
    expect(loginNotice("<script>")).toBeNull();
    expect(loginNotice("toString")).toBeNull();
    expect(loginNotice(undefined)).toBeNull();
  });
});
