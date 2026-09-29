import { describe, expect, it } from "vitest";

import { dealEvents, defaultDealKey, effectiveOfferStatus, inboxDeals, offerDeal, orderDeal, shortTitle, sortDeals, type OfferDealRow, type OrderDealRow } from "./deals";

const ME = "me";
const THEM = "them";
const NOW = Date.parse("2026-09-28T12:00:00Z");

function order(patch: Partial<OrderDealRow> = {}): OrderDealRow {
  return {
    id: "o1",
    status: "paid",
    buyer_id: THEM,
    seller_id: ME,
    total_cents: 113000,
    is_collection: false,
    pickup_ready_at: null,
    created_at: "2026-09-24T05:00:00Z",
    shipped_at: null,
    delivered_at: null,
    completed_at: null,
    cancelled_at: null,
    refunded_at: null,
    updated_at: "2026-09-24T05:00:00Z",
    title: "E46 M3 front sport seats, black leather, pair",
    ...patch,
  };
}

function offer(patch: Partial<OfferDealRow> = {}): OfferDealRow {
  return {
    id: "f1",
    status: "open",
    buyer_id: THEM,
    seller_id: ME,
    listing_id: "l1",
    amount_cents: 120000,
    counter_amount_cents: null,
    created_at: "2026-09-27T10:00:00Z",
    countered_at: null,
    responded_at: null,
    updated_at: "2026-09-27T10:00:00Z",
    expires_at: "2026-09-30T10:00:00Z",
    title: "Big brake kit — 355mm rotors, 4-pot calipers, lines",
    ...patch,
  };
}

describe("orderDeal", () => {
  it("asks a seller with a paid, shipped-to order to ship it", () => {
    const deal = orderDeal(order(), ME);
    expect(deal).toMatchObject({ side: "selling", label: "Ship it", tone: "move", active: true, action: { label: "Mark shipped" } });
  });

  it("tells a buyer of the same paid order it's paid, not their move", () => {
    expect(orderDeal(order({ buyer_id: ME, seller_id: THEM }), ME)).toMatchObject({ side: "buying", label: "Paid", tone: "ok" });
  });

  it("sends a buyer with an unpaid order to checkout", () => {
    const deal = orderDeal(order({ status: "pending", buyer_id: ME, seller_id: THEM }), ME);
    expect(deal).toMatchObject({ label: "Pay now", tone: "move", action: { href: "/orders/o1/checkout" } });
  });

  it("handles collection: seller readies it, then the buyer collects", () => {
    expect(orderDeal(order({ is_collection: true }), ME)).toMatchObject({ label: "Get it ready", tone: "move" });
    const ready = order({ is_collection: true, pickup_ready_at: "2026-09-25T00:00:00Z", buyer_id: ME, seller_id: THEM });
    expect(orderDeal(ready, ME)).toMatchObject({ label: "Ready to collect", tone: "move" });
  });

  it("closes finished orders", () => {
    expect(orderDeal(order({ status: "completed" }), ME).active).toBe(false);
    expect(orderDeal(order({ status: "cancelled" }), ME)).toMatchObject({ active: false, tone: "quiet" });
  });
});

describe("offerDeal", () => {
  it("puts an open offer on the seller's move", () => {
    expect(offerDeal(offer(), ME, NOW)).toMatchObject({ side: "selling", label: "Offer $1,200", tone: "move", active: true });
  });

  it("puts a counter on the buyer's move, and the seller waits", () => {
    const countered = offer({ status: "countered", counter_amount_cents: 130000, countered_at: "2026-09-27T12:00:00Z" });
    expect(offerDeal(countered, ME, NOW)).toMatchObject({ label: "You countered $1,300", tone: "quiet" });
    expect(offerDeal({ ...countered, buyer_id: ME, seller_id: THEM }, ME, NOW)).toMatchObject({ label: "Countered $1,300", tone: "move" });
  });

  it("reads an overdue open offer as expired before the worker catches up", () => {
    const stale = offer({ expires_at: "2026-09-27T00:00:00Z" });
    expect(effectiveOfferStatus(stale, NOW)).toBe("expired");
    expect(offerDeal(stale, ME, NOW)).toMatchObject({ label: "Offer expired", active: false });
  });
});

describe("ordering and defaults", () => {
  const ship = orderDeal(order(), ME);
  const expired = offerDeal(offer({ id: "f0", status: "expired", created_at: "2026-09-01T00:00:00Z" }), ME, NOW);
  const going = orderDeal(order({ id: "o2", status: "shipped", buyer_id: ME, seller_id: THEM, shipped_at: "2026-09-26T00:00:00Z" }), ME);

  it("sorts your move, then in progress, then newest", () => {
    expect(sortDeals([expired, going, ship]).map((d) => d.key)).toEqual(["order:o1", "order:o2", "offer:f0"]);
  });

  it("shows active deals on an inbox row, or the latest one when nothing is open", () => {
    expect(inboxDeals([expired, ship, going]).map((d) => d.key)).toEqual(["order:o1", "order:o2"]);
    expect(inboxDeals([expired]).map((d) => d.key)).toEqual(["offer:f0"]);
  });

  it("defaults a reply to the last message's deal while it's still open", () => {
    expect(defaultDealKey([ship, going], "order:o2")).toBe("order:o2");
    expect(defaultDealKey([ship, expired], "offer:f0")).toBe("order:o1");
    expect(defaultDealKey([], null)).toBeNull();
  });

  it("shortens part titles at the first comma or dash", () => {
    expect(shortTitle("Big brake kit — 355mm rotors, 4-pot calipers")).toBe("Big brake kit");
    expect(shortTitle("E46 M3 front sport seats, black leather")).toBe("E46 M3 front sport seats");
  });
});

describe("dealEvents", () => {
  it("narrates an order and an accepted counter from the reader's side", () => {
    const events = dealEvents(
      [order({ shipped_at: "2026-09-25T00:00:00Z" })],
      [offer({ id: "f2", status: "accepted", buyer_id: ME, seller_id: THEM, counter_amount_cents: 620000, countered_at: "2026-09-22T14:00:00Z", responded_at: "2026-09-22T15:00:00Z", amount_cents: 590000, created_at: "2026-09-22T00:53:00Z", title: "Akrapovič exhaust" })],
      ME,
      "Kaito",
      NOW,
    );
    expect(events.map((e) => `${e.actor ?? ""} ${e.text}`.trim())).toEqual([
      "You offered $5,900 on the Akrapovič exhaust",
      "Kaito countered $6,200",
      "You accepted the $6,200 counter",
      "Kaito bought your E46 M3 front sport seats · $1,130",
      "You shipped the E46 M3 front sport seats",
    ]);
  });

  it("marks a counter waiting on the reader as live", () => {
    const events = dealEvents([], [offer({ status: "countered", buyer_id: ME, seller_id: THEM, counter_amount_cents: 130000, countered_at: "2026-09-27T12:00:00Z" })], ME, "Tommy", NOW);
    expect(events.find((e) => e.key.endsWith(":countered"))?.live).toBe(true);
  });
});
