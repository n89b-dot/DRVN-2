/**
 * Redaction (docs/decisions/agent-data-rules.md §3), in one place, applied
 * before storing chat or event text and again before any model call.
 *
 * - Payment-card numbers (13–19 digits passing Luhn, with spaces or dashes)
 *   never get stored or sent. The database scrubs them too (agent_redact_cards).
 * - VIN-shaped strings (17 characters, no I, O or Q) are kept in the member's
 *   own stored chat but never sent to the model.
 * - Emails and phone numbers are stored, but sent as [email] / [phone].
 * - UUID-shaped text (8-4-4-4-12 hex) is an id and is never touched: its
 *   digit groups can pass the card rule (about 0.3% of random UUIDs do) or
 *   look like a phone, and a mangled id breaks a stored event or a tool call.
 * - Postal addresses aren't pattern-matched, and nothing here is complete:
 *   these are patterns, and text can always slip past one. Addresses are
 *   kept from the model by what its tools read, not by this file: no tool
 *   reads checkout or shipping addresses, and read_listing_messages leaves
 *   out order threads, where buyers type them (OS-W04 N122).
 */

export const CARD_REMOVED = "[card number removed]";
export const VIN_REMOVED = "[VIN removed]";

const DIGIT_RUN = /\d+(?:[ -]\d+)*/g;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const VIN = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;
// Bounded runs (RFC 5321 lengths) so a long run of letters is not scanned once per position.
const EMAIL = /[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,63}/gi;
// A phone: 7+ digits with the usual separators, optionally with a + country
// code, and not one group of a longer digit run (an order or card number).
const PHONE = /(?<!\d[ .-]?)(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?)?\d{3,4}[ .-]\d{3,4}(?:[ .-]\d{2,4})?\b(?![ .-]?\d)/g;

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

/**
 * Card numbers out, for anything stored. A run of digit groups is tried group
 * by group, so digits after a card (an expiry, a CVC) can't hide it: any
 * 13–19 digits that start and end on a group boundary and pass Luhn go.
 * UUIDs are skipped. The database applies the same rule (agent_redact_cards).
 */
export function redactForStorage(text: string): { text: string; removedCard: boolean } {
  let removedCard = false;
  const out = outsideIds(text, (piece) => {
    const redacted = redactCardRuns(piece);
    if (redacted !== piece) removedCard = true;
    return redacted;
  });
  return { text: out, removedCard };
}

/** Applies `redact` to the text between UUIDs, keeping each UUID as it is.
 *  The database splits text the same way (agent_redact_cards, 20261108130500). */
function outsideIds(text: string, redact: (piece: string) => string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(UUID)) {
    out += redact(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + redact(text.slice(last));
}

function redactCardRuns(text: string): string {
  return text.replace(DIGIT_RUN, (run) => {
    const parts = run.split(/([ -])/);
    const groups = parts.filter((_, index) => index % 2 === 0);
    const separators = parts.filter((_, index) => index % 2 === 1);
    let result = "";
    let i = 0;
    while (i < groups.length) {
      let digits = "";
      let hit = -1;
      for (let j = i; j < groups.length; j++) {
        digits += groups[j];
        if (digits.length > 19) break;
        if (digits.length >= 13 && luhnValid(digits)) hit = j;
      }
      const end = hit >= 0 ? hit : i;
      if (result) result += separators[i - 1];
      result += hit >= 0 ? CARD_REMOVED : groups[i];
      i = end + 1;
    }
    return result;
  });
}

/** Cards, VINs, emails and phones out, for anything sent to the model. */
export function redactForModel(text: string): string {
  return outsideIds(text, (piece) => {
    // A VIN has letters and digits; a 17-digit run is a number, not a VIN.
    const withoutVins = redactCardRuns(piece).replace(VIN, (match) => (/[A-Z]/i.test(match) && /\d/.test(match) ? VIN_REMOVED : match));
    return withoutVins.replace(EMAIL, "[email]").replace(PHONE, (match) => (match.replace(/\D/g, "").length >= 7 ? "[phone]" : match));
  });
}
