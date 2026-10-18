import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

/**
 * Negotiation v2 end to end (migrations 20261017150000–20261018100200): a
 * buyer offers from the listing, the seller counters, the buyer counters
 * back, the seller counters again and the buyer accepts — five moves, three
 * of them the buyer's (all 3 offers used) — and the agreed price becomes the
 * order. Each side acts in their own signed-in browser.
 */
test.describe("negotiation v2 three-round deal", () => {
  test.setTimeout(120_000);
  const password = `Negotiation-${randomUUID()}!`;
  const sellerEmail = `e2e-negotiation-seller-${randomUUID()}@drvn.test`;
  const buyerEmail = `e2e-negotiation-buyer-${randomUUID()}@drvn.test`;
  const users: string[] = [];
  let listingId = "";

  test.beforeAll(async () => {
    test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Negotiation fixtures are restricted to the isolated local stack");
    const admin = fixtureAdmin();
    for (const [email, role] of [[sellerEmail, "seller"], [buyerEmail, "buyer"]] as const) {
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw created.error ?? new Error("Missing negotiation user");
      users.push(created.data.user.id);
      const named = await admin.from("profiles").update({ username: `nego${randomUUID().replaceAll("-", "").slice(0, 16)}` }).eq("id", created.data.user.id);
      if (named.error) throw named.error;
      const invitationId = randomUUID();
      const invitation = await admin.from("beta_invitations").insert({ id: invitationId, email_normalized: email, roles: [role], token_hash: createHash("sha256").update(randomUUID()).digest("hex"), expires_at: new Date(Date.now() + 60 * 60_000).toISOString(), consumed_at: new Date().toISOString(), consumed_by: created.data.user.id });
      if (invitation.error) throw invitation.error;
      const membership = await admin.from("beta_memberships").insert({ user_id: created.data.user.id, invitation_id: invitationId, email_normalized: email, roles: [role] });
      if (membership.error) throw membership.error;
    }
    const listing = await admin.from("listings").insert({ seller_id: users[0], title: `Negotiation turbo ${randomUUID().slice(0, 8)}`, category: "performance", price_cents: 100000, shipping_cents: 0, currency: "USD", status: "active" }).select("id").single();
    if (listing.error) throw listing.error;
    listingId = listing.data.id;
    const image = await admin.from("listing_images").insert({ listing_id: listingId, url: "https://example.test/negotiation.webp", position: 0 });
    if (image.error) throw image.error;
  });

  test.afterAll(async () => {
    for (const id of users.reverse()) await cleanupFixtureUser(id);
  });

  async function signedIn(browser: Browser, email: string): Promise<Page> {
    const page = await (await browser.newContext()).newPage();
    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);
    return page;
  }

  async function counter(page: Page, offerId: string, field: RegExp, amount: string, send: RegExp) {
    await page.goto(`/offers/${offerId}`);
    await page.getByRole("button", { name: /^counter( back)?$/i }).click();
    await page.getByLabel(field).fill(amount);
    await page.getByRole("button", { name: send }).click();
    await expect(page.getByText(/Counter(-offer)? sent\./)).toBeVisible();
  }

  test("five moves, three buyer offers, one order at the agreed price", async ({ browser }) => {
    const buyer = await signedIn(browser, buyerEmail);
    const seller = await signedIn(browser, sellerEmail);

    // Round 1: the buyer's opening offer, from the listing.
    await buyer.goto(`/listings/${listingId}`);
    await buyer.getByRole("button", { name: "Make an offer" }).first().click();
    await buyer.getByLabel("Your offer").fill("700");
    await buyer.getByRole("button", { name: /send offer/i }).click();
    await expect(buyer.getByText(/Offer sent/)).toBeVisible();
    const admin = fixtureAdmin();
    const offer = await admin.from("offers").select("id").eq("listing_id", listingId).eq("buyer_id", users[1]).single();
    if (offer.error) throw offer.error;
    const offerId = offer.data.id;

    // Rounds 2–4: seller counters, buyer counters back, seller counters again.
    await counter(seller, offerId, /^Your counter$/, "900", /send counter(?!-offer)/i);
    await buyer.goto(`/offers/${offerId}`);
    await expect(buyer.getByText("2 of 3 offers left")).toBeVisible();
    await counter(buyer, offerId, /^Your counter-offer$/, "800", /send counter-offer/i);
    await counter(seller, offerId, /^Your counter$/, "850", /send counter(?!-offer)/i);

    // The buyer has used 2 of 3; the seller's last counter stands. Round 5: accept it.
    await buyer.goto(`/offers/${offerId}`);
    await expect(buyer.getByText("1 of 3 offers left")).toBeVisible();
    await buyer.getByRole("button", { name: /accept \$850/i }).click();
    await buyer.waitForURL(/\/orders\/[0-9a-f-]+\/checkout/);

    const rounds = await admin.from("offer_rounds").select("round_no, kind, actor_role, amount_cents").eq("offer_id", offerId).order("round_no");
    if (rounds.error) throw rounds.error;
    expect(rounds.data.map((r) => `${r.kind}:${r.actor_role}:${r.amount_cents ?? "-"}`)).toEqual([
      "offer:buyer:70000", "counter:seller:90000", "counter:buyer:80000", "counter:seller:85000", "accept:buyer:85000",
    ]);
    const order = await admin.from("orders").select("subtotal_cents, status").eq("origin_offer_id", offerId).single();
    if (order.error) throw order.error;
    expect(order.data).toEqual({ subtotal_cents: 85000, status: "pending" });

    // The offer page reads the whole negotiation back, in order.
    await seller.goto(`/offers/${offerId}`);
    for (const line of [/made an offer/, "You countered", /countered/, /accepted the counter/]) {
      await expect(seller.getByText(line).first()).toBeVisible();
    }
  });
});
