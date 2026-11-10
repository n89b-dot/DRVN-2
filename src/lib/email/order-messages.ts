/**
 * The words of each order email (report five #116, OS-W41). Pure: the drain
 * (src/lib/order-emails.ts) loads the order and calls these.
 *
 * Each says what happened and links to the order. None carries a message, a
 * dispute's text or an address: anything a member wrote (a part's title, a
 * tracking number) is escaped in the HTML and kept to one line in the
 * subject. Each ends with one line saying why it was sent and where the
 * settings are. Guests get no link of ours: they are pointed to the order link
 * they were emailed when they paid (the existing guest access flow).
 */

export type OrderEmailKind =
  | "order_sold"
  | "order_paid"
  | "order_shipped"
  | "order_delivered"
  | "receipt_auto_confirmed"
  | "order_disputed"
  | "dispute_resolved"
  | "admin_action"
  | "order_refunded"
  | "payout_setup_reminder"
  | "order_cancelled"
  | "order_partially_refunded"
  | "dispatch_reminder";

export type OrderEmailFacts = {
  orderId: string;
  /** The first item's title, as the seller wrote it (escaped here). */
  title: string | null;
  itemCount: number;
  totalCents: number;
  /** The order's currency (ISO 4217). */
  currency: string;
  /** For a payout-setup reminder: how many unpaid sales it covers. */
  saleCount?: number;
  dispatchBy: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  /** True when the order was refunded because the seller's payouts weren't set up in 14 days. */
  payoutDeadlineRefund: boolean;
  /** True when this email goes to the order's buyer; false, to its seller. */
  buyer: boolean;
  /** True when the "refund" is a card dispute the buyer's bank decided against the sale: the bank returns the money, DRVN does not. */
  chargebackLost: boolean;
  /** True when the dispute on the order is a card dispute raised through the buyer's bank, not a problem reported on DRVN. */
  cardDispute: boolean;
  /** Everything refunded on the order so far. */
  refundedCents: number;
  /** Why DRVN itself cancelled the order, when it did; null when a person did, whose reason is never quoted. */
  cancelledBecause: "timeout" | "abandoned" | null;
};

export type RenderedEmail = { subject: string; text: string; html: string };

/** One line, no control characters, at most `max` characters. */
export function oneLine(value: string | null | undefined, max = 80): string {
  const flat = String(value ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function orderRef(orderId: string): string {
  return orderId.slice(0, 8).toUpperCase();
}

export function money(cents: number, currency: string): string {
  const code = /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "USD";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

const day = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(iso)) : null;

/** "Intake manifold" or "Intake manifold and 2 more". */
function what(facts: OrderEmailFacts): string {
  const title = oneLine(facts.title, 60) || "your part";
  return facts.itemCount > 1 ? `${title} and ${facts.itemCount - 1} more` : title;
}

type Body = { subject: string; lines: string[] };

function body(kind: OrderEmailKind, facts: OrderEmailFacts): Body {
  const ref = orderRef(facts.orderId);
  const item = what(facts);
  switch (kind) {
    case "order_sold": {
      const by = day(facts.dispatchBy);
      return {
        subject: `Sold: ${item}`,
        lines: [
          `${item} sold for ${money(facts.totalCents, facts.currency)} (order ${ref}).`,
          by ? `Dispatch it by ${by}, and add the tracking on the order.` : "Dispatch it within three business days, and add the tracking on the order.",
        ],
      };
    }
    case "order_paid":
      return {
        subject: `Your receipt for order ${ref}`,
        lines: [`You paid ${money(facts.totalCents, facts.currency)} for ${item} (order ${ref}).`, "The seller dispatches it next; we'll email you when they do."],
      };
    case "order_shipped": {
      const tracking = [oneLine(facts.carrier, 40), oneLine(facts.trackingNumber, 60)].filter(Boolean).join(" ");
      return {
        subject: `On its way: ${item}`,
        lines: [`${item} has been dispatched (order ${ref}).`, tracking ? `Tracking: ${tracking}.` : "The seller hasn't added tracking."],
      };
    }
    case "order_delivered":
      return {
        subject: `Delivered: ${item}`,
        lines: [`${item} has been delivered (order ${ref}).`, "Your payout follows the payout schedule shown on the order."],
      };
    case "receipt_auto_confirmed":
      return {
        subject: `Order ${ref} is confirmed as received`,
        lines: [`We've marked ${item} as received (order ${ref}), as the delivery window has passed.`, "If something is wrong with it, open the order and tell us."],
      };
    case "order_disputed":
      return facts.cardDispute
        ? {
            subject: `A card dispute was opened on order ${ref}`,
            lines: [`The buyer's bank opened a card dispute on ${item} (order ${ref}).`, "The bank decides it, and the payout for this order waits until it does. Open the order to see where it stands."],
          }
        : {
            subject: `A problem was reported with order ${ref}`,
            lines: [`The buyer reported a problem with ${item} (order ${ref}).`, "Open the order to see it and reply."],
          };
    case "dispute_resolved":
      return facts.cardDispute
        ? {
            subject: `The card dispute on order ${ref} is closed`,
            lines: [`The card dispute on ${item} (order ${ref}) has been closed by the bank.`, "Open the order to see the outcome."],
          }
        : {
            subject: `The problem with order ${ref} is resolved`,
            lines: [`The reported problem with ${item} (order ${ref}) has been resolved.`, "Open the order to see the outcome."],
          };
    case "admin_action":
      return {
        subject: `An update from DRVN on order ${ref}`,
        lines: [`DRVN support updated order ${ref} (${item}).`, "Open the order to see what changed."],
      };
    case "order_refunded":
      // A card dispute the bank decided for the buyer is recorded as a refund,
      // but DRVN sends no money: the bank already took it back (work review
      // #147). Nobody is told a refund is on its way.
      if (facts.chargebackLost) {
        return facts.buyer
          ? {
              subject: `Your card dispute on order ${ref} was decided`,
              lines: [`Your bank decided the card dispute on ${item} (order ${ref}) in your favour, and the order is closed.`, "The money comes back from your bank, on your bank's own timing. DRVN is not sending a separate refund."],
            }
          : {
              subject: `The card dispute on order ${ref} was decided for the buyer`,
              lines: [`The buyer's bank decided the card dispute on ${item} (order ${ref}) against the sale and took the payment back.`, "Open the order to see what this means for your payout."],
            };
      }
      return facts.payoutDeadlineRefund
        ? {
            subject: `Order ${ref} was refunded`,
            lines: [
              `Order ${ref} (${item}) was refunded in full because the seller's payouts weren't set up within 14 days of the sale.`,
              "The money goes back to the card it came from; banks usually show it within 5–10 business days.",
            ],
          }
        : {
            subject: `Order ${ref} was refunded`,
            lines: [`A refund was issued on order ${ref} (${item}).`, "The money goes back to the card it came from; banks usually show it within 5–10 business days."],
          };
    case "order_partially_refunded": {
      const sofar = `${money(facts.refundedCents, facts.currency)} of ${money(facts.totalCents, facts.currency)}`;
      return facts.buyer
        ? {
            subject: `Part of order ${ref} was refunded`,
            lines: [`A partial refund was issued on ${item} (order ${ref}): ${sofar} has been refunded so far.`, "The money goes back to the card it came from; banks usually show it within 5–10 business days."],
          }
        : {
            subject: `A partial refund was issued on order ${ref}`,
            lines: [`A partial refund was issued to the buyer on ${item} (order ${ref}): ${sofar} has been refunded so far.`, "Open the order to see what this means for your payout."],
          };
    }
    case "order_cancelled": {
      const why = facts.cancelledBecause === "timeout" ? " because checkout wasn't completed in time" : facts.cancelledBecause === "abandoned" ? " because checkout was left before paying" : "";
      return {
        subject: `Order ${ref} was cancelled`,
        lines: [
          `Order ${ref} (${item}) was cancelled${why}.`,
          facts.buyer ? "If a payment was taken, it is returned in full to the card it came from." : "Open the order to see where things stand.",
        ],
      };
    }
    case "dispatch_reminder": {
      const by = day(facts.dispatchBy);
      return {
        subject: `Due to be dispatched: ${item}`,
        lines: [
          by ? `${item} (order ${ref}) is due to be dispatched by ${by}.` : `${item} (order ${ref}) is due to be dispatched.`,
          "Once it's on its way, mark it dispatched on the order and add the tracking number.",
        ],
      };
    }
    case "payout_setup_reminder": {
      const others = Math.max((facts.saleCount ?? 1) - 1, 0);
      return {
        subject: others > 0 ? `Set up payouts to be paid for your ${others + 1} sales` : `Set up payouts to be paid for order ${ref}`,
        lines: [
          others > 0
            ? `You sold ${item} (order ${ref}) and ${others} other ${others === 1 ? "sale" : "sales"}, and your payouts aren't set up yet.`
            : `You sold ${item} (order ${ref}), and your payouts aren't set up yet.`,
          "Finish your payout setup within 14 days of each sale, or that sale is refunded to the buyer.",
        ],
      };
    }
  }
}

/**
 * The email for one outbox row. `origin` is the site's canonical origin;
 * `guest` is a buyer without an account, who gets no link from us.
 */
export function renderOrderEmail(kind: OrderEmailKind, facts: OrderEmailFacts, { origin, guest }: { origin: string; guest: boolean }): RenderedEmail {
  const { subject, lines } = body(kind, facts);
  const orderUrl = `${origin}/orders/${facts.orderId}`;
  const settingsUrl = `${origin}/settings#notifications`;
  const action = guest
    ? "To see your order, use the order link we emailed you when you paid."
    : `See the order: ${orderUrl}`;
  const why = guest
    ? "You're getting this because it's about an order you placed on DRVN."
    : `You're getting this because it's about an order of yours on DRVN. Notification settings: ${settingsUrl}`;
  const text = [...lines, "", action, "", "— DRVN", "", why].join("\n");
  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#15191d;max-width:560px">',
    ...lines.map((line) => `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`),
    guest
      ? `<p style="margin:0 0 12px">${escapeHtml(action)}</p>`
      : `<p style="margin:0 0 12px"><a href="${escapeHtml(orderUrl)}">See the order</a></p>`,
    '<p style="margin:16px 0 12px">— DRVN</p>',
    guest
      ? `<p style="margin:0;font-size:13px;color:#5d6670">${escapeHtml(why)}</p>`
      : `<p style="margin:0;font-size:13px;color:#5d6670">You're getting this because it's about an order of yours on DRVN. <a href="${escapeHtml(settingsUrl)}">Notification settings</a></p>`,
    "</div>",
  ].join("\n");
  return { subject: oneLine(subject, 120), text, html };
}
