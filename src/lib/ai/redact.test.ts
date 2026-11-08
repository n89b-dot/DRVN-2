import { describe, expect, it } from "vitest";

import { CARD_REMOVED, redactForModel, redactForStorage } from "./redact";

// Card-number redaction corrupted about 0.3% of random UUIDs: their digit
// groups joined by dashes can total 13–19 digits and pass Luhn. Each of these
// was mangled before the fix (e.g. the first became
// "70e95888-a[card number removed]b5e67f70ec"). The database redactor has the
// same fixtures (supabase/tests/agent_redact_ids_guard.sql).
const CORRUPTED_BEFORE = [
  "70e95888-a964-4164-9858-10b5e67f70ec",
  "30b5080e-7219-4087-9468-3708206fed76",
  "32988505-6787-409e-84cf-dcffdaa1db68",
  "511c533c-70a7-4567-a0f7-840220032488",
];

describe("card redaction and ids", () => {
  it("never changes a UUID, alone, in upper case, inside a longer string or in event JSON", () => {
    for (const id of CORRUPTED_BEFORE) {
      expect(redactForStorage(id)).toEqual({ text: id, removedCard: false });
      expect(redactForStorage(id.toUpperCase()).text).toBe(id.toUpperCase());
      expect(redactForStorage(`/listings/${id}?ref=agent`).text).toBe(`/listings/${id}?ref=agent`);
      const json = JSON.stringify({ approval_id: id, listing_ids: [id], note: `see ${id}` });
      expect(redactForStorage(json).text).toBe(json);
      expect(redactForModel(`Open listing ${id} for me`)).toBe(`Open listing ${id} for me`);
    }
  });

  it("still removes card numbers, with spaces or dashes, including one written next to an id", () => {
    const id = CORRUPTED_BEFORE[0];
    expect(redactForStorage("card 4242 4242 4242 4242 12/28")).toEqual({ text: `card ${CARD_REMOVED} 12/28`, removedCard: true });
    expect(redactForStorage("4242-4242-4242-4242 1234 ok").text).toBe(`${CARD_REMOVED} 1234 ok`);
    expect(redactForStorage("pay 4111111111111111 now").text).toBe(`pay ${CARD_REMOVED} now`);
    expect(redactForStorage("order 4242 4242 4242 4241").text).toBe("order 4242 4242 4242 4241");
    expect(redactForStorage(`order ${id}: card 4242 4242 4242 4242`).text).toBe(`order ${id}: card ${CARD_REMOVED}`);
    expect(redactForStorage(`4242-4242-4242-4242 ${id}`).text).toBe(`${CARD_REMOVED} ${id}`);
    const json = JSON.stringify({ approval_id: id, message: "my card is 4242-4242-4242-4242" });
    expect(redactForStorage(json).text).toBe(JSON.stringify({ approval_id: id, message: `my card is ${CARD_REMOVED}` }));
    expect(redactForModel(`listing ${id}, card 4242 4242 4242 4242`)).toBe(`listing ${id}, card ${CARD_REMOVED}`);
  });

  it("still sends an email as [email] when it contains a UUID, while a plain UUID survives", () => {
    const id = CORRUPTED_BEFORE[0];
    expect(redactForModel(`write to alice+${id}@example.com`)).toBe("write to [email]");
    expect(redactForModel(`write to alice+aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee@example.com today`)).toBe("write to [email] today");
    expect(redactForModel(`reply via seller@${id}.reply.example.com`)).toBe("reply via [email]");
    expect(redactForModel(`listing ${id}, email bob@example.com, phone 555-123-4567`)).toBe(
      `listing ${id}, email [email], phone [phone]`
    );
    expect(redactForModel(id)).toBe(id);
  });
});
