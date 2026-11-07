import { describe, expect, it } from "vitest";

import {
  REAUTH_WINDOW_SECONDS,
  RECOVERY_WINDOW_SECONDS,
  authenticatedRecently,
  hasRecoveryAuthorisation,
  oauthOnly,
  signsInWithPassword,
} from "./reauthentication";

const NOW = 1_800_000_000;
const claims = (...amr: { method: string; timestamp: number }[]) => ({ sub: "u1", amr });

// Readiness N20: only a session opened from an emailed link, recently, may
// set a password without the current one.
describe("recovery authorisation", () => {
  it("accepts a session opened from a reset link verified at /confirm (amr otp)", () => {
    expect(hasRecoveryAuthorisation(claims({ method: "otp", timestamp: NOW - 120 }), NOW)).toBe(true);
    expect(hasRecoveryAuthorisation(claims({ method: "recovery", timestamp: NOW - 120 }), NOW)).toBe(true);
    expect(hasRecoveryAuthorisation(claims({ method: "magiclink", timestamp: NOW - 120 }), NOW)).toBe(true);
  });

  it("refuses an ordinary signed-in session, however fresh", () => {
    expect(hasRecoveryAuthorisation(claims({ method: "password", timestamp: NOW - 5 }), NOW)).toBe(false);
    expect(hasRecoveryAuthorisation(claims({ method: "oauth", timestamp: NOW - 5 }), NOW)).toBe(false);
    expect(hasRecoveryAuthorisation({ sub: "u1" }, NOW)).toBe(false);
    expect(hasRecoveryAuthorisation(null, NOW)).toBe(false);
  });

  it("refuses a reset session once the window has passed", () => {
    expect(hasRecoveryAuthorisation(claims({ method: "otp", timestamp: NOW - RECOVERY_WINDOW_SECONDS - 1 }), NOW)).toBe(false);
  });

  it("ignores untimed and malformed amr entries and future timestamps", () => {
    expect(hasRecoveryAuthorisation({ sub: "u1", amr: ["otp"] }, NOW)).toBe(false);
    expect(hasRecoveryAuthorisation({ sub: "u1", amr: [{ method: "otp", timestamp: "now" }] }, NOW)).toBe(false);
    expect(hasRecoveryAuthorisation({ sub: "u1", amr: "otp" }, NOW)).toBe(false);
    expect(hasRecoveryAuthorisation(claims({ method: "otp", timestamp: NOW + 3600 }), NOW)).toBe(false);
  });
});

// Readiness N41: deletion and email change need a sign-in a moment ago.
describe("recent authentication", () => {
  it("counts any method inside the window and nothing outside it", () => {
    expect(authenticatedRecently(claims({ method: "oauth", timestamp: NOW - 60 }), NOW)).toBe(true);
    expect(authenticatedRecently(claims({ method: "password", timestamp: NOW - REAUTH_WINDOW_SECONDS + 1 }), NOW)).toBe(true);
    expect(authenticatedRecently(claims({ method: "oauth", timestamp: NOW - REAUTH_WINDOW_SECONDS - 1 }), NOW)).toBe(false);
    // An hour-old session that has refreshed since keeps its old timestamp.
    expect(authenticatedRecently(claims({ method: "password", timestamp: NOW - 3600 }), NOW)).toBe(false);
  });
});

// Readiness N45: Google-only members have no password to type.
describe("sign-in methods", () => {
  it("reads Auth's provider list", () => {
    expect(signsInWithPassword({ provider: "email", providers: ["email"] })).toBe(true);
    expect(signsInWithPassword({ provider: "google", providers: ["google", "email"] })).toBe(true);
    expect(signsInWithPassword({ provider: "google", providers: ["google"] })).toBe(false);
    expect(oauthOnly({ provider: "google", providers: ["google"] })).toBe(true);
    expect(signsInWithPassword({ provider: "google" })).toBe(false);
  });

  it("assumes a password when the metadata is missing, so nobody loses the password path", () => {
    expect(signsInWithPassword(undefined)).toBe(true);
    expect(signsInWithPassword({})).toBe(true);
  });
});
