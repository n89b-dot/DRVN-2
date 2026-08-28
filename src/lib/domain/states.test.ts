import { describe, expect, it } from "vitest";

import { STATE_GROUPS } from "@/app/(product)/orders/next-action";

import {
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

  it("every domain has at least one terminal state", () => {
    for (const { domain, transitions } of DOMAIN_STATES) {
      const terminals = Object.values(transitions).filter((targets) => targets.length === 0);
      expect(terminals.length, `${domain} has no terminal state`).toBeGreaterThan(0);
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
    // A refunded or cancelled order never moves again.
    expect(ORDER_TRANSITIONS.refunded).toEqual([]);
    expect(ORDER_TRANSITIONS.cancelled).toEqual([]);
    // A transferred transfer never re-runs; blocked intents can recover.
    expect(TRANSFER_TRANSITIONS.transferred).toEqual([]);
    expect(canTransition(TRANSFER_TRANSITIONS, "blocked_unpayable", "ready")).toBe(true);
    // An accepted offer is final; sellers cannot un-sell.
    expect(OFFER_TRANSITIONS.accepted).toEqual([]);
    expect(canTransition(LISTING_TRANSITIONS, "sold", "active")).toBe(false);
    // Refund crashes land in recovery, never silently complete.
    expect(canTransition(REFUND_TRANSITIONS, "provider_pending", "recovery_required")).toBe(true);
    expect(REFUND_TRANSITIONS.recovery_required).toEqual([]);
  });

  it("only moderation clears a takedown", () => {
    expect(LISTING_TRANSITIONS.removed).toEqual(["paused"]);
  });
});
