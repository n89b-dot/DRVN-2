import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

import { orderCarry, readSellerCarry, summariseCarry, type CarryEntry } from "./carry";

const entry = (
  kind: CarryEntry["kind"],
  amount: number,
  orderId: string | null,
  minute: number
): CarryEntry => ({
  kind,
  amount_cents: amount,
  order_id: orderId,
  created_at: new Date(Date.UTC(2026, 9, 1, 0, minute)).toISOString(),
});

describe("summariseCarry", () => {
  it("owes a refunded order's label until a later transfer collects it", () => {
    const owed = summariseCarry([entry("uncollected", -800, "refunded", 1)]);
    expect(owed.owedCents).toBe(800);
    expect(orderCarry(owed, "refunded")).toEqual({ carriedCents: -800, carriedInCents: 0, settled: false });

    const collected = summariseCarry([
      entry("uncollected", -800, "refunded", 1),
      entry("collected", 800, "payer", 2),
    ]);
    expect(collected.owedCents).toBe(0);
    expect(orderCarry(collected, "refunded").settled).toBe(true);
    expect(orderCarry(collected, "payer")).toEqual({ carriedCents: 0, carriedInCents: 800, settled: true });
  });

  it("pays off the oldest charge first when a collection is partial", () => {
    const carry = summariseCarry([
      entry("uncollected", -500, "first", 1),
      entry("late_adjustment", -400, "second", 2),
      entry("collected", 600, "payer", 3),
    ]);
    expect(carry.owedCents).toBe(300);
    expect(orderCarry(carry, "first").settled).toBe(true);
    expect(orderCarry(carry, "second").settled).toBe(false);
  });

  it("nets a voided late label and a reversed shortfall to nothing", () => {
    const carry = summariseCarry([
      entry("late_adjustment", -300, "a", 1),
      entry("adjustment_void", 300, "a", 2),
      entry("uncollected", -500, "b", 3),
      entry("uncollected_reversed", 500, "b", 4),
    ]);
    expect(carry.owedCents).toBe(0);
    expect(orderCarry(carry, "a").carriedCents).toBe(0);
    expect(orderCarry(carry, "b").carriedCents).toBe(0);
  });

  it("shows a credit beyond what's owed until its payout opens", () => {
    const carry = summariseCarry([entry("late_adjustment", 250, "a", 1)]);
    expect(carry).toMatchObject({ owedCents: 0, creditCents: 250 });
  });

  it("takes a paid-out credit off the balance, and puts a cancelled payout back", () => {
    const paid = summariseCarry([
      entry("late_adjustment", 250, "a", 1),
      entry("paid_out", -250, null, 2),
    ]);
    expect(paid).toMatchObject({ owedCents: 0, creditCents: 0 });
    // The credit was paid to the seller, not used up: a later charge is owed.
    const thenCharged = summariseCarry([
      entry("late_adjustment", 250, "a", 1),
      entry("paid_out", -250, null, 2),
      entry("late_adjustment", -100, "b", 4),
    ]);
    expect(thenCharged).toMatchObject({ owedCents: 100, creditCents: 0 });
    expect(orderCarry(thenCharged, "b").settled).toBe(false);
    const cancelled = summariseCarry([
      entry("late_adjustment", 250, "a", 1),
      entry("paid_out", -250, null, 2),
      entry("paid_out_reversed", 250, null, 3),
    ]);
    expect(cancelled).toMatchObject({ owedCents: 0, creditCents: 250 });
  });

  it("answers an order with no entries as settled and empty", () => {
    expect(orderCarry(summariseCarry([]), "none")).toEqual({ carriedCents: 0, carriedInCents: 0, settled: true });
  });
});

describe("readSellerCarry", () => {
  function client(result: { data: unknown; error: unknown }) {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order"]) builder[method] = () => builder;
    builder.limit = async () => result;
    return { from: () => builder } as never;
  }

  it("is null, not an empty balance, when the entries can't be read", async () => {
    await expect(readSellerCarry(client({ data: null, error: { message: "timeout" } }), "seller")).resolves.toBeNull();
  });

  it("summarises what it read", async () => {
    const carry = await readSellerCarry(
      client({ data: [entry("uncollected", -800, "refunded", 1)], error: null }),
      "seller"
    );
    expect(carry?.owedCents).toBe(800);
  });
});
