import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { reportError } from "@/lib/monitoring";

/**
 * Carried-forward seller charges (20261005110100, seller_carry_entries).
 *
 * A label cost DRVN paid for a seller normally comes off that order's own
 * transfer. When it can't — the order was refunded before its payout, or the
 * label was bought after the payout went — the database records it as owed
 * and the seller's next transfer keeps it back (at most down to 1¢; the rest
 * waits for the transfer after). This module reads those entries for display.
 * It never decides an amount: the transfer worker's freeze_transfer_carry
 * does that under a lock.
 *
 * Entries are signed: negative is owed by the seller, positive is collected
 * or credited back. Per order, a `collected` entry belongs to the order whose
 * transfer kept the money back; every other kind belongs to the order whose
 * charge it is.
 */
export type CarryEntry = {
  kind:
    | "uncollected"
    | "late_adjustment"
    | "adjustment_void"
    | "uncollected_reversed"
    | "collected"
    | "reversal_shortfall";
  amount_cents: number;
  order_id: string | null;
  created_at: string;
};

export type OrderCarry = {
  /** This order's own charges (≤ 0) or credits (≥ 0) settled through the
   *  carry-forward balance instead of this order's payout. */
  carriedCents: number;
  /** Charges from other orders this order's transfer kept back (≥ 0). */
  carriedInCents: number;
  /** True when every charge this order carried has been collected from (or
   *  offset by) a later payout. */
  settled: boolean;
};

export type SellerCarry = {
  byOrder: Map<string, OrderCarry>;
  /** What the seller still owes; comes off their next transfer. */
  owedCents: number;
  /** Credits beyond what's owed. Not paid out automatically; they offset
   *  future charges. */
  creditCents: number;
};

const EMPTY: OrderCarry = { carriedCents: 0, carriedInCents: 0, settled: true };

export function orderCarry(carry: SellerCarry, orderId: string): OrderCarry {
  return carry.byOrder.get(orderId) ?? EMPTY;
}

/**
 * Pure summary of a seller's entries. Charges are matched to collections
 * oldest first, so "settled" answers "has the money for this order's charge
 * come back yet?" the way a statement would.
 */
export function summariseCarry(entries: CarryEntry[]): SellerCarry {
  const byOrder = new Map<string, OrderCarry>();
  const at = (orderId: string) => {
    const current = byOrder.get(orderId) ?? { ...EMPTY };
    byOrder.set(orderId, current);
    return current;
  };

  let balance = 0;
  let offsets = 0;
  for (const entry of entries) {
    balance += entry.amount_cents;
    if (entry.amount_cents > 0) offsets += entry.amount_cents;
    if (!entry.order_id) continue;
    if (entry.kind === "collected") at(entry.order_id).carriedInCents += entry.amount_cents;
    else at(entry.order_id).carriedCents += entry.amount_cents;
  }

  // Oldest charges are paid off first. An order is settled once every one
  // of its charges has been covered by the offsets (collections and credits).
  const charges = entries
    .filter((entry) => entry.amount_cents < 0)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  let remaining = offsets;
  for (const charge of charges) {
    remaining += charge.amount_cents;
    if (remaining < 0 && charge.order_id) at(charge.order_id).settled = false;
  }

  return {
    byOrder,
    owedCents: Math.max(0, -balance),
    creditCents: Math.max(0, balance),
  };
}

/** The cap on the read; a seller's carried charges are few. */
const CARRY_FETCH_CAP = 1000;

/**
 * Reads the seller's carry-forward entries (RLS: a seller reads their own).
 * A failed read is null, never an empty summary — no carried charges would
 * show a payout higher than the seller will get.
 */
export async function readSellerCarry(
  client: Pick<SupabaseClient<Database>, "from">,
  sellerId: string
): Promise<SellerCarry | null> {
  const { data, error } = await client
    .from("seller_carry_entries")
    .select("kind, amount_cents, order_id, created_at")
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: true })
    .limit(CARRY_FETCH_CAP);
  if (error || !data) {
    reportError("[payouts] carry-forward read failed", { sellerId, error });
    return null;
  }
  if (data.length === CARRY_FETCH_CAP) {
    // Partial history would understate what is owed; say so rather than guess.
    reportError("[payouts] carry-forward read hit its cap", { sellerId });
    return null;
  }
  // The column is text with a check constraint; the kinds are the ones it allows.
  return summariseCarry(data as CarryEntry[]);
}
