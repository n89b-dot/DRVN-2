import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { deliveryLabel } from "@/lib/marketplace/delivery";
import FeesPage from "./page";

/** What the page says, as a buyer reads it: entities decoded, tags dropped. */
function text(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;|“|”/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

it("explains item price versus shipping calculated at checkout (N81)", () => {
  const page = text(renderToStaticMarkup(<FeesPage />));
  // The old line contradicted DRVN Shipping, which prices at checkout.
  expect(page).not.toMatch(/nothing is added at checkout/i);
  expect(page).not.toMatch(/the number on the listing is the number you pay/i);
  // The words the listing itself shows for DRVN Shipping, so the two can't drift.
  expect(page).toContain(`"${deliveryLabel({ shipping_mode: "drvn" })}"`);
  expect(page).toMatch(/item price plus shipping/i);
  expect(page).toMatch(/checkout shows the rates once you've entered your address, before you pay/i);
  // The fee rule itself is unchanged: out of the seller's side, never added to the buyer's.
  expect(page).toMatch(/fee is never added on top — it comes out of the seller's side/i);
  expect(page).toMatch(/10% of the sale total — the item price plus any buyer-paid shipping — out of the seller's payout/i);
});
