import { beforeAll, describe, expect, it, vi } from "vitest";

// The module derives its signing key from the service key at call time, so the
// env has to be in place before it's imported.
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon-key-for-tests";
  process.env.SUPABASE_SECRET_KEY ??= "service-key-for-tests";
});

const load = async () => await import("./guest-checkout");

describe("guest order receipts", () => {
  it("round-trips the order ids it was given", async () => {
    const { encodeGuestOrders, decodeGuestOrders } = await load();
    const ids = ["3f7a1c9e-0000-4000-8000-000000000000", "aa11bb22-0000-4000-8000-000000000001"];
    expect(decodeGuestOrders(encodeGuestOrders(ids))).toEqual(ids);
  });

  it("rejects a copied receipt after its signed expiry", async () => {
    const { encodeGuestOrders, decodeGuestOrders } = await load();
    const now = Date.now();
    const signed = encodeGuestOrders(["3f7a1c9e-0000-4000-8000-000000000000"]);
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 6 * 60 * 60 * 1000);
    try { expect(decodeGuestOrders(signed)).toEqual([]); } finally { clock.mockRestore(); }
  });

  it("rejects a forged cookie — the whole point of signing it", async () => {
    const { decodeGuestOrders } = await load();
    // What an attacker would try: someone else's order id, base64'd, with a
    // made-up signature.
    const payload = Buffer.from(JSON.stringify(["victim-order-id"])).toString("base64url");
    expect(decodeGuestOrders(`${payload}.not-a-real-signature`)).toEqual([]);
    expect(decodeGuestOrders(payload)).toEqual([]);
  });

  it("rejects a tampered payload under a valid-looking signature", async () => {
    const { encodeGuestOrders, decodeGuestOrders } = await load();
    const signed = encodeGuestOrders(["mine"]);
    const [, signature] = signed.split(".");
    const swapped = Buffer.from(JSON.stringify(["theirs"])).toString("base64url");
    expect(decodeGuestOrders(`${swapped}.${signature}`)).toEqual([]);
  });

  it("treats absent, empty and malformed values as no claim at all", async () => {
    const { decodeGuestOrders } = await load();
    for (const value of [undefined, "", ".", "junk", "a.b.c"]) {
      expect(decodeGuestOrders(value)).toEqual([]);
    }
  });

  it("never returns non-string entries", async () => {
    const { decodeGuestOrders } = await load();
    const { createHmac } = await import("node:crypto");
    const payload = Buffer.from(JSON.stringify(["ok", 42, null, { id: "x" }])).toString(
      "base64url"
    );
    const signature = createHmac("sha256", process.env.SUPABASE_SECRET_KEY!)
      .update(payload)
      .digest("base64url");
    expect(decodeGuestOrders(`${payload}.${signature}`)).toEqual([]);
  });
});

describe("isPlausibleEmail", () => {
  it("accepts ordinary addresses", async () => {
    const { isPlausibleEmail } = await load();
    for (const email of [
      "you@somewhere.com",
      "first.last+tag@sub.domain.co.uk",
      "A@b.io",
    ]) {
      expect(isPlausibleEmail(email), email).toBe(true);
    }
  });

  it("rejects what can't receive a receipt", async () => {
    const { isPlausibleEmail } = await load();
    for (const email of [
      "",
      "nope",
      "no@domain",
      "two@at@signs.com",
      "spaces in@example.com",
      "@example.com",
      "trailing@dot.",
      `${"a".repeat(250)}@example.com`,
    ]) {
      expect(isPlausibleEmail(email), email).toBe(false);
    }
  });
});
