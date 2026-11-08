import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { deliveryLabel } from "@/lib/marketplace/delivery";

// The settings row the terms read (settlement_settings), as the owner set it
// on 4 October 2026 (20261009100000): fixed mode, 2 days after delivery.
const row = vi.hoisted(() => ({
  current: {
    payout_hold_days: 2,
    payout_hold_mode: "fixed",
    auto_confirm_after_days: 21,
    receipt_release_after_days: 3,
    auto_confirm_notice_days: 3,
    card_verification_on: true,
  } as Record<string, unknown>,
}));

// The terms read the public part of the row through settlement_hold_policy()
// (20261107210000).
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => ({
    rpc: async () => ({ data: [row.current], error: null }),
    from: () => ({ select: () => ({ limit: async () => ({ data: [row.current], error: null }) }) }),
  }),
}));

import TermsPage from "./page";

/** What the page says, as a member reads it: entities decoded, tags dropped. */
function text(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;|“|”/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

async function page() {
  return text(renderToStaticMarkup(await TermsPage()));
}

it("doesn't say nothing is added at checkout, which DRVN Shipping contradicts (N477)", async () => {
  const terms = await page();
  expect(terms).not.toMatch(/nothing is added at checkout/i);
  // The words the listing itself shows for DRVN Shipping, so the two can't drift.
  expect(terms).toContain(`"${deliveryLabel({ shipping_mode: "drvn" })}"`);
  expect(terms).toMatch(/checkout shows the rates once you've entered your address/i);
  expect(terms).toMatch(/you see the total before you pay, and DRVN's fee is never added to it/i);
});

it("states the owner's 2-day payout hold from the live setting (R-hold)", async () => {
  const terms = await page();
  expect(terms).toMatch(/A sale is paid out 2 days after the order/);
  expect(terms).not.toMatch(/paid out 7 days/);
});
