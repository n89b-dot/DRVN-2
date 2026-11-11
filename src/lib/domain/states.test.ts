import { describe, expect, it } from "vitest";

import { STATE_GROUPS } from "@/app/(product)/orders/next-action";

import {
  AGENT_JOB_TRANSITIONS,
  AGENT_MANDATE_TRANSITIONS,
  AGENT_TASK_TRANSITIONS,
  DOMAIN_STATES,
  LISTING_TRANSITIONS,
  OFFER_TRANSITIONS,
  ORDER_TRANSITIONS,
  REFUND_TRANSITIONS,
  TRANSFER_TRANSITIONS,
  canTransition,
} from "./states";

describe("domain state definitions", () => {
  it("every named target is itself a defined state (no dangling transitions)", () => {
    for (const { domain, transitions } of DOMAIN_STATES) {
      const states = new Set(Object.keys(transitions));
      for (const [from, targets] of Object.entries(transitions)) {
        for (const to of targets) {
          expect(states.has(to), `${domain}: ${from} → ${to} targets an unknown state`).toBe(true);
          expect(to, `${domain}: ${from} → ${from} self-loop`).not.toBe(from);
        }
      }
    }
  });

  it("every lifecycle domain has at least one terminal state", () => {
    for (const { domain, transitions, cyclic } of DOMAIN_STATES) {
      if (cyclic) continue;
      const terminals = Object.values(transitions).filter((targets) => targets.length === 0);
      expect(terminals.length, `${domain} has no terminal state`).toBeGreaterThan(0);
    }
  });

  /**
   * The escape hatch above is narrow on purpose: a ladder that quietly
   * declares itself cyclic would stop being checked for a dead end.
   */
  it("only a genuine toggle may declare itself cyclic", () => {
    const cyclic = DOMAIN_STATES.filter((entry) => entry.cyclic);
    expect(cyclic.map((entry) => entry.domain)).toEqual(["mod_item"]);
    for (const { domain, transitions } of cyclic) {
      expect(
        Object.values(transitions).every((targets) => targets.length > 0),
        `${domain} declares itself cyclic but has a dead end`,
      ).toBe(true);
    }
  });

  it("covers every order status the product's own grouping knows", () => {
    const known = new Set(Object.keys(ORDER_TRANSITIONS));
    for (const statuses of Object.values(STATE_GROUPS)) {
      for (const status of statuses) {
        expect(known.has(status), `order status ${status} missing from ORDER_TRANSITIONS`).toBe(
          true,
        );
      }
    }
  });

  it("encodes the load-bearing money rules", () => {
    // A refunded order never moves again; a cancelled one only when a payment
    // captured after the cancellation is refunded in full (20261111120000).
    expect(ORDER_TRANSITIONS.refunded).toEqual([]);
    expect(ORDER_TRANSITIONS.cancelled).toEqual(["refunded"]);
    // A transferred transfer never re-runs; blocked intents can recover.
    expect(TRANSFER_TRANSITIONS.transferred).toEqual([]);
    expect(canTransition(TRANSFER_TRANSITIONS, "blocked_unpayable", "ready")).toBe(true);
    // An accepted offer is final; sellers cannot un-sell.
    expect(OFFER_TRANSITIONS.accepted).toEqual([]);
    expect(canTransition(LISTING_TRANSITIONS, "sold", "active")).toBe(false);
    // Refund crashes land in recovery, never silently complete.
    expect(canTransition(REFUND_TRANSITIONS, "provider_pending", "recovery_required")).toBe(true);
    expect(REFUND_TRANSITIONS.recovery_required).toEqual([]);
    // A not-received case on an undispatched order resolves back to paid,
    // and a paid order can be in a case (20261107210300).
    expect(canTransition(ORDER_TRANSITIONS, "disputed", "paid")).toBe(true);
    expect(canTransition(ORDER_TRANSITIONS, "paid", "disputed")).toBe(true);
  });

  it("never reopens a finished agent task, mandate or job", () => {
    for (const state of ["completed", "failed", "cancelled"] as const) expect(AGENT_TASK_TRANSITIONS[state]).toEqual([]);
    expect(AGENT_MANDATE_TRANSITIONS.revoked).toEqual([]);
    expect(AGENT_MANDATE_TRANSITIONS.ended).toEqual([]);
    expect(canTransition(AGENT_JOB_TRANSITIONS, "done", "pending")).toBe(false);
    expect(canTransition(AGENT_JOB_TRANSITIONS, "leased", "pending")).toBe(true);
  });

  it("only moderation clears a takedown", () => {
    expect(LISTING_TRANSITIONS.removed).toEqual(["paused"]);
  });
});
