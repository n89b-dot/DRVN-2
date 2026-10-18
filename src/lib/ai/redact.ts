/**
 * Redaction (docs/decisions/agent-data-rules.md §3), in one place, applied
 * before storing chat or event text and again before any model call.
 *
 * - Payment-card numbers (13–19 digits passing Luhn, with spaces or dashes)
 *   never get stored or sent. The database scrubs them too (agent_redact_cards).
 * - VIN-shaped strings (17 characters, no I, O or Q) are kept in the member's
 *   own stored chat but never sent to the model.
 * - Emails and phone numbers are stored, but sent as [email] / [phone].
 * - Postal addresses aren't pattern-matched: no tool ever reads one.
 */

export const CARD_REMOVED = "[card number removed]";
export const VIN_REMOVED = "[VIN removed]";

const DIGIT_RUN = /\d+(?:[ -]\d+)*/g;
const VIN = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
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
 * The database applies the same rule (agent_redact_cards).
 */
export function redactForStorage(text: string): { text: string; removedCard: boolean } {
  let removedCard = false;
  const out = text.replace(DIGIT_RUN, (run) => {
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
      if (hit >= 0) {
        removedCard = true;
        result += CARD_REMOVED;
      } else {
        result += groups[i];
      }
      i = end + 1;
    }
    return result;
  });
  return { text: out, removedCard };
}

/** Cards, VINs, emails and phones out, for anything sent to the model. */
export function redactForModel(text: string): string {
  // A VIN has letters and digits; a 17-digit run is a number, not a VIN.
  const withoutVins = redactForStorage(text).text.replace(VIN, (match) => (/[A-Z]/i.test(match) && /\d/.test(match) ? VIN_REMOVED : match));
  return withoutVins.replace(EMAIL, "[email]").replace(PHONE, (match) => (match.replace(/\D/g, "").length >= 7 ? "[phone]" : match));
}
