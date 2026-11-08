import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DISPUTE_WINDOW_DAYS } from "@/features/commerce/disputes";

import {
  DEFAULT_PAYOUT_HOLD,
  payoutAvailableAt,
  payoutClearsPhrase,
  payoutHoldDaysFor,
  payoutHoldPhrase,
  readAutoConfirmDays,
  readPayoutHoldPolicy,
  readPublicRiskControls,
  readSettlementRisk,
  returnWindowDays,
} from "./payout-hold";

const MIGRATION = readFileSync("supabase/migrations/20261006100000_payout_hold_setting.sql", "utf8");
// R-hold (20261107220900): the column default and payout_available_at()'s missing-row fallback.
const FALLBACK = readFileSync("supabase/migrations/20261107220900_payout_hold_fallback_two_days.sql", "utf8");
const BOUNDARY = readFileSync("supabase/migrations/20261107210000_listing_write_boundary.sql", "utf8");

function fakeClient(result: { data: unknown; error: unknown }) {
  return {
    from() {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "limit"]) builder[method] = () => builder;
      builder.then = (resolve: (value: typeof result) => unknown) => resolve(result);
      return builder;
    },
  } as never;
}

/** A client whose only answer is the public projection, settlement_hold_policy(). */
function projectionClient(result: { data: unknown; error: unknown }) {
  const calls: string[] = [];
  const client = {
    rpc: async (name: string) => {
      calls.push(name);
      return result;
    },
    from: () => {
      throw new Error("the public readers must not read settlement_settings directly");
    },
  } as never;
  return { client, calls };
}

const POLICY_ROW = {
  payout_hold_days: 14,
  payout_hold_mode: "fixed",
  receipt_release_after_days: 3,
  auto_confirm_after_days: 21,
  auto_confirm_notice_days: 3,
  card_verification_on: true,
};

describe("payout hold", () => {
  it("mirrors the SQL defaults and the problem window it hard-codes", () => {
    // payout_available_at() can't import a TS constant; these keep the two in step.
    expect(MIGRATION).toMatch(/payout_hold_mode text not null default 'fixed',/);
    expect(FALLBACK).toContain("alter table public.settlement_settings alter column payout_hold_days set default 2;");
    expect(FALLBACK).toContain("from public.settlement_settings s where s.id), 2) as days,");
    expect(FALLBACK).toContain("from public.settlement_settings s where s.id), 'fixed') as mode");
    expect(FALLBACK).toContain(`greatest(policy.days, ${DISPUTE_WINDOW_DAYS}, coalesce(shop.window_days, 0))`);
    // The app's fallback is the owner's rule, a fixed 2 days (R-hold, Neil 7 Nov 2026).
    expect(DEFAULT_PAYOUT_HOLD).toEqual({ mode: "fixed", holdDays: 2 });
  });

  it("counts a fixed hold from delivery", () => {
    expect(payoutAvailableAt("2026-10-01T12:00:00Z", { mode: "fixed", holdDays: 14 }, 60)).toBe(
      "2026-10-15T12:00:00.000Z"
    );
  });

  it("holds to the later of the hold, the problem window and the shop's return window", () => {
    const policy = { mode: "claim_window", holdDays: 7 } as const;
    expect(payoutHoldDaysFor(policy, null)).toBe(DISPUTE_WINDOW_DAYS);
    expect(payoutHoldDaysFor(policy, 14)).toBe(DISPUTE_WINDOW_DAYS);
    expect(payoutHoldDaysFor(policy, 60)).toBe(60);
  });

  it("reads a return window only from a policy that accepts returns, ignoring malformed days", () => {
    expect(returnWindowDays({ returns_accepted: true, window_days: 60 })).toBe(60);
    expect(returnWindowDays({ returns_accepted: true, window_days: "30" })).toBe(30);
    expect(returnWindowDays({ returns_accepted: false, window_days: 60 })).toBeNull();
    expect(returnWindowDays({ returns_accepted: true, window_days: "sixty" })).toBeNull();
    expect(returnWindowDays({ returns_accepted: true, window_days: 14.5 })).toBeNull();
    expect(returnWindowDays(null)).toBeNull();
  });

  it("says the rule in words", () => {
    expect(payoutHoldPhrase(DEFAULT_PAYOUT_HOLD)).toBe("2 days");
    expect(payoutHoldPhrase({ mode: "fixed", holdDays: 1 })).toBe("1 day");
    expect(payoutHoldPhrase({ mode: "claim_window", holdDays: 7 })).toBe(
      `${DISPUTE_WINDOW_DAYS} days (or once the shop's return window closes, if later)`
    );
  });

  it("says when the payouts tile's money clears", () => {
    expect(payoutClearsPhrase({ mode: "fixed", holdDays: 2 })).toBe(
      "2 days after delivery, or as soon as the buyer confirms it arrived"
    );
    expect(payoutClearsPhrase({ mode: "claim_window", holdDays: 7 })).toBe(
      `${DISPUTE_WINDOW_DAYS} days (or once the shop's return window closes, if later) after delivery`
    );
  });

  it("reads the risk settings, with the SQL's fallbacks for a missing row and null when unreadable", async () => {
    const row = { receipt_release_after_days: 3, card_verification_from_cents: null };
    await expect(readSettlementRisk(fakeClient({ data: [row], error: null }))).resolves.toEqual({
      receiptReleaseAfterDays: 3,
      cardVerificationFromCents: null,
    });
    await expect(readSettlementRisk(fakeClient({ data: [], error: null }))).resolves.toEqual({
      receiptReleaseAfterDays: 3,
      cardVerificationFromCents: null,
    });
    await expect(readSettlementRisk(fakeClient({ data: null, error: { message: "timeout" } }))).resolves.toBeNull();
    await expect(
      readSettlementRisk(fakeClient({ data: [{ ...row, card_verification_from_cents: -5 }], error: null }))
    ).resolves.toBeNull();
    // The SQL falls back to the same 3 days when the row is missing.
    expect(readFileSync("supabase/migrations/20261009100000_payout_release_risk_controls.sql", "utf8")).toContain(
      "(select s.receipt_release_after_days from public.settlement_settings s where s.id),3)"
    );
  });

  it("reads the owner's hold through the public projection, defaults when it is missing, and is null when unreadable", async () => {
    const read = projectionClient({ data: [POLICY_ROW], error: null });
    await expect(readPayoutHoldPolicy(read.client)).resolves.toEqual({ mode: "fixed", holdDays: 14 });
    expect(read.calls).toEqual(["settlement_hold_policy"]);
    await expect(readPayoutHoldPolicy(projectionClient({ data: [], error: null }).client)).resolves.toEqual(DEFAULT_PAYOUT_HOLD);
    await expect(
      readPayoutHoldPolicy(projectionClient({ data: null, error: { message: "timeout" } }).client)
    ).resolves.toBeNull();
    await expect(
      readPayoutHoldPolicy(projectionClient({ data: [{ ...POLICY_ROW, payout_hold_mode: "weekly" }], error: null }).client)
    ).resolves.toBeNull();
  });

  it("reads the auto-confirm period: a number when on, null when off, undefined when unreadable", async () => {
    const read = (result: { data: unknown; error: unknown }) => readAutoConfirmDays(projectionClient(result).client);
    expect(await read({ data: [POLICY_ROW], error: null })).toBe(21);
    expect(await read({ data: [{ ...POLICY_ROW, auto_confirm_after_days: null }], error: null })).toBeNull();
    expect(await read({ data: [], error: null })).toBeNull();
    expect(await read({ data: null, error: { message: "timeout" } })).toBeUndefined();
  });

  it("tells the public whether each fraud control is on, never its amount (N26)", async () => {
    await expect(readPublicRiskControls(projectionClient({ data: [POLICY_ROW], error: null }).client)).resolves.toEqual({
      receiptReleaseAfterDays: 3,
      cardVerificationOn: true,
    });
    await expect(readPublicRiskControls(projectionClient({ data: [], error: null }).client)).resolves.toEqual({
      receiptReleaseAfterDays: 3,
      cardVerificationOn: false,
    });
    await expect(
      readPublicRiskControls(projectionClient({ data: null, error: { message: "denied" } }).client)
    ).resolves.toBeNull();
    // The projection the public reads has no amount column, and the row
    // holding the amounts is closed to visitors and members.
    const projection = BOUNDARY.slice(BOUNDARY.indexOf("create or replace function public.settlement_hold_policy()"));
    const columns = projection.slice(projection.indexOf("returns table ("), projection.indexOf(")\nlanguage sql"));
    expect(columns).toContain("payout_hold_days");
    expect(columns).not.toMatch(/cents/);
    expect(BOUNDARY).toContain("revoke all on public.settlement_settings from anon, authenticated;");
    expect(BOUNDARY).toContain('drop policy if exists "settlement settings are public" on public.settlement_settings;');
  });
});
