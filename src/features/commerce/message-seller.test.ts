import { describe, expect, it } from "vitest";

import { BLOCKED_MESSAGE, isBlockedError } from "@/lib/blocks";
import { handBack } from "@/lib/agent/worker";

import { messageDealKey } from "./conversation-timeline";
import { enquiryDeal } from "./deals";

const ME = "buyer";
const SELLER = "seller";
const row = { listing_id: "part-1", seller_id: SELLER, title: "Garrett turbo", status: "active", price_cents: 120000, at: "2026-11-07T12:00:00Z" };

describe("R-directcontact: a listing enquiry is a deal in the conversation", () => {
  it("is the buyer's question and the seller's to answer, about that listing", () => {
    expect(enquiryDeal(row, ME)).toMatchObject({ key: "listing:part-1", kind: "listing", side: "buying", label: "You asked about it", active: true, href: "/listings/part-1" });
    expect(enquiryDeal(row, SELLER)).toMatchObject({ side: "selling", label: "Asked about your listing" });
    expect(enquiryDeal({ ...row, status: "sold" }, ME).active).toBe(false);
  });

  it("files a message about a listing under that listing, after an order or offer", () => {
    expect(messageDealKey({ order_id: null, offer_id: null, listing_id: "part-1" })).toBe("listing:part-1");
    expect(messageDealKey({ order_id: "o", offer_id: null, listing_id: "part-1" })).toBe("order:o");
    expect(messageDealKey({ order_id: null, offer_id: "f", listing_id: "part-1" })).toBe("offer:f");
    expect(messageDealKey({ order_id: null, offer_id: null })).toBeNull();
  });
});

describe("N54 a block, as the app hears it", () => {
  it("recognises the database's refusal and never says who blocked whom", () => {
    expect(isBlockedError({ code: "BL403" })).toBe(true);
    expect(isBlockedError({ code: "42501" })).toBe(false);
    expect(BLOCKED_MESSAGE).not.toMatch(/blocked you|you blocked/i);
  });

  it("ends an agent's negotiation instead of retrying it forever", () => {
    expect(handBack("BL403")).toEqual({ outcome: "failed", endTask: true });
  });
});
