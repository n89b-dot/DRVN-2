import { describe, expect, it } from "vitest";

import { escapeHtml, oneLine, renderOrderEmail, type OrderEmailFacts, type OrderEmailKind } from "./order-messages";

const facts: OrderEmailFacts = {
  orderId: "a1b2c3d4-0000-4000-8000-000000000001",
  title: 'Turbo <script>alert(1)</script>\nCall 07123 "now"',
  itemCount: 1,
  totalCents: 45_000,
  currency: "USD",
  dispatchBy: "2026-11-13T00:00:00Z",
  carrier: "UPS",
  trackingNumber: "1Z<b>999",
  payoutDeadlineRefund: false,
};
const KINDS: OrderEmailKind[] = ["order_sold", "order_paid", "order_shipped", "order_delivered", "receipt_auto_confirmed", "order_disputed", "dispute_resolved", "admin_action", "order_refunded", "payout_setup_reminder"];

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
    expect(renderOrderEmail("order_sold", facts, { origin: "https://d.example", guest: false }).text).toMatch(/Dispatch it by Friday, November 13/);
    expect(renderOrderEmail("order_shipped", facts, { origin: "https://d.example", guest: false }).text).toContain("Tracking: UPS 1Z<b>999.");
  });

  it("the day-14 refund says why; an ordinary refund doesn't", () => {
    expect(renderOrderEmail("order_refunded", { ...facts, payoutDeadlineRefund: true }, { origin: "https://d.example", guest: false }).text).toMatch(/payouts weren't set up within 14 days/);
    expect(renderOrderEmail("order_refunded", facts, { origin: "https://d.example", guest: false }).text).not.toMatch(/14 days/);
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
