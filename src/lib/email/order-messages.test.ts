import { describe, expect, it } from "vitest";

import { escapeHtml, oneLine, renderOrderEmail, type OrderEmailFacts, type OrderEmailKind } from "./order-messages";

// Three days from now, at midnight UTC: no fixed calendar date to run past.
const DISPATCH_BY = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000 + 3 * 86_400_000).toISOString();
const DISPATCH_DAY = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(DISPATCH_BY));

const facts: OrderEmailFacts = {
  orderId: "a1b2c3d4-0000-4000-8000-000000000001",
  title: 'Turbo <script>alert(1)</script>\nCall 07123 "now"',
  itemCount: 1,
  totalCents: 45_000,
  currency: "USD",
  dispatchBy: DISPATCH_BY,
  carrier: "UPS",
  trackingNumber: "1Z<b>999",
  payoutDeadlineRefund: false,
  buyer: true,
  chargebackLost: false,
  cardDispute: false,
  refundedCents: 0,
  cancelledBecause: null,
};
const to = (kind: OrderEmailKind, over: Partial<OrderEmailFacts> = {}) => renderOrderEmail(kind, { ...facts, ...over }, { origin: "https://d.example", guest: false });
const KINDS: OrderEmailKind[] = ["order_sold", "order_paid", "order_shipped", "order_delivered", "receipt_auto_confirmed", "order_disputed", "dispute_resolved", "admin_action", "order_refunded", "payout_setup_reminder", "order_cancelled", "order_partially_refunded", "dispatch_reminder"];

describe("order emails say what happened, safely (OS-W41, report five #116)", () => {
  it.each(KINDS)("%s: one-line subject, escaped HTML, a link to the order and why it was sent", (kind) => {
    const email = renderOrderEmail(kind, facts, { origin: "https://drvn.example", guest: false });
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<b>999");
    expect(email.text).toContain("https://drvn.example/orders/a1b2c3d4-0000-4000-8000-000000000001");
    expect(email.text).toContain("Notification settings: https://drvn.example/settings#notifications");
    expect(email.html).toContain('href="https://drvn.example/settings#notifications"');
  });

  it("the sale email gives the dispatch deadline; the dispatch email the tracking", () => {
    expect(renderOrderEmail("order_sold", facts, { origin: "https://d.example", guest: false }).text).toContain(`Dispatch it by ${DISPATCH_DAY}`);
    expect(renderOrderEmail("order_shipped", facts, { origin: "https://d.example", guest: false }).text).toContain("Tracking: UPS 1Z<b>999.");
  });

  it("the day-14 refund says why; an ordinary refund doesn't", () => {
    expect(renderOrderEmail("order_refunded", { ...facts, payoutDeadlineRefund: true }, { origin: "https://d.example", guest: false }).text).toMatch(/payouts weren't set up within 14 days/);
    expect(renderOrderEmail("order_refunded", facts, { origin: "https://d.example", guest: false }).text).not.toMatch(/14 days/);
  });

  it("N1063: a card dispute the bank decided for the buyer tells nobody a refund is coming (work review #147)", () => {
    const buyer = to("order_refunded", { chargebackLost: true, buyer: true });
    const seller = to("order_refunded", { chargebackLost: true, buyer: false });
    for (const email of [buyer, seller]) {
      expect(email.text).not.toMatch(/refund was issued|5–10 business days|goes back to the card/);
      expect(email.subject).toMatch(/card dispute/);
    }
    expect(buyer.text).toMatch(/Your bank decided the card dispute .* in your favour/);
    expect(buyer.text).toContain("DRVN is not sending a separate refund");
    expect(seller.text).toMatch(/against the sale and took the payment back/);
    // An ordinary refund still says the money is on its way.
    expect(to("order_refunded").text).toContain("5–10 business days");
  });

  it("N1063: a partial refund gives the amount so far, to each side in its own words", () => {
    const buyer = to("order_partially_refunded", { refundedCents: 12_050, buyer: true });
    expect(buyer.subject).toMatch(/^Part of order A1B2C3D4 was refunded$/);
    expect(buyer.text).toContain("$120.50 of $450 has been refunded so far");
    expect(buyer.text).toContain("5–10 business days");
    const seller = to("order_partially_refunded", { refundedCents: 12_050, buyer: false });
    expect(seller.text).toContain("issued to the buyer");
    expect(seller.text).not.toContain("5–10 business days");
  });

  it("N1063: a cancelled order says so, with DRVN's own reason when DRVN cancelled it and never a person's", () => {
    expect(to("order_cancelled", { cancelledBecause: "timeout" }).text).toContain("was cancelled because checkout wasn't completed in time.");
    expect(to("order_cancelled", { cancelledBecause: "abandoned" }).text).toContain("was cancelled because checkout was left before paying.");
    const plain = to("order_cancelled");
    expect(plain.text).toMatch(/Order A1B2C3D4 \(.*\) was cancelled\.\n/);
    expect(plain.text).toContain("If a payment was taken, it is returned in full");
    expect(to("order_cancelled", { buyer: false }).text).not.toContain("If a payment was taken");
  });

  it("N1063: the dispatch reminder gives the date the order is due by", () => {
    const email = to("dispatch_reminder", { buyer: false });
    expect(email.subject).toMatch(/^Due to be dispatched: /);
    expect(email.text).toContain(`is due to be dispatched by ${DISPATCH_DAY}.`);
    expect(to("dispatch_reminder", { buyer: false, dispatchBy: null }).text).toContain("is due to be dispatched.");
  });

  it("N1063: a card dispute is not described as a problem the buyer reported on DRVN", () => {
    expect(to("order_disputed", { cardDispute: true, buyer: false }).text).toMatch(/The buyer's bank opened a card dispute/);
    expect(to("order_disputed", { cardDispute: true, buyer: false }).text).not.toMatch(/reply/);
    expect(to("dispute_resolved", { cardDispute: true }).subject).toMatch(/card dispute .* is closed/);
    expect(to("order_disputed", { buyer: false }).text).toContain("The buyer reported a problem");
  });

  it("a guest gets no link from us, only the way back through the order link they were sent", () => {
    const email = renderOrderEmail("order_paid", facts, { origin: "https://drvn.example", guest: true });
    expect(email.text).not.toContain("https://drvn.example");
    expect(email.html).not.toContain("href=");
    expect(email.text).toContain("use the order link we emailed you when you paid");
  });

  it("flattens and caps member text, and escapes every HTML special", () => {
    expect(oneLine("a\r\nb c\td", 80)).toBe("a b c d");
    expect(oneLine("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
