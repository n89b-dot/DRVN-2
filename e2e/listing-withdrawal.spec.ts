import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

/**
 * OS-W33 follow-up (20261108110100). A seller withdraws a listing a buyer
 * has offered on: the buyer follows the notification to /offers/{id} and
 * still sees the offer, the listing it was on, and why it ended — the
 * archived listing used to be hidden from them, so the page 404'd. Both
 * sides read the ending as the seller withdrawing the listing, never as
 * the buyer withdrawing the offer.
 */
test.describe("listing withdrawal keeps the buyer's offer history", () => {
  test.setTimeout(90_000);
  const password = `Withdrawal-${randomUUID()}!`;
  const sellerEmail = `e2e-withdrawal-seller-${randomUUID()}@drvn.test`;
  const buyerEmail = `e2e-withdrawal-buyer-${randomUUID()}@drvn.test`;
  const title = `Withdrawn intercooler ${randomUUID().slice(0, 8)}`;
  const users: string[] = [];
  let listingId = "";
  let offerId = "";

  test.beforeAll(async () => {
    test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Withdrawal fixtures are restricted to the isolated local stack");
    const admin = fixtureAdmin();
    for (const [email, role] of [[sellerEmail, "seller"], [buyerEmail, "buyer"]] as const) {
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw created.error ?? new Error("Missing withdrawal user");
      users.push(created.data.user.id);
      const named = await admin.from("profiles").update({ username: `wdrl${randomUUID().replaceAll("-", "").slice(0, 16)}` }).eq("id", created.data.user.id);
      if (named.error) throw named.error;
      const invitationId = randomUUID();
      const invitation = await admin.from("beta_invitations").insert({ id: invitationId, email_normalized: email, roles: [role], token_hash: createHash("sha256").update(randomUUID()).digest("hex"), expires_at: new Date(Date.now() + 60 * 60_000).toISOString(), consumed_at: new Date().toISOString(), consumed_by: created.data.user.id });
      if (invitation.error) throw invitation.error;
      const membership = await admin.from("beta_memberships").insert({ user_id: created.data.user.id, invitation_id: invitationId, email_normalized: email, roles: [role] });
      if (membership.error) throw membership.error;
    }
    const listing = await admin.from("listings").insert({ seller_id: users[0], title, category: "performance", price_cents: 60000, shipping_cents: 0, currency: "USD", status: "active" }).select("id").single();
    if (listing.error) throw listing.error;
    listingId = listing.data.id;
    const image = await admin.from("listing_images").insert({ listing_id: listingId, url: "https://example.test/withdrawal.webp", position: 0 });
    if (image.error) throw image.error;
    const offer = await admin.from("offers").insert({ listing_id: listingId, buyer_id: users[1], amount_cents: 50000, status: "open" }).select("id").single();
    if (offer.error) throw offer.error;
    offerId = offer.data.id;
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

  test("the buyer's notification opens the ended offer; both sides read why", async ({ browser }) => {
    // The seller withdraws it, as the ledger's Withdraw does.
    const sellerClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
    const signedInSeller = await sellerClient.auth.signInWithPassword({ email: sellerEmail, password });
    if (signedInSeller.error) throw signedInSeller.error;
    const withdrawn = await sellerClient.rpc("withdraw_listing", { p_listing: listingId });
    if (withdrawn.error) throw withdrawn.error;
    expect(withdrawn.data).toMatchObject({ offers_ended: 1, replayed: false });

    // The buyer's notice links to the offer.
    const admin = fixtureAdmin();
    const notice = await admin.from("notifications").select("href").eq("user_id", users[1]).eq("kind", "offer_listing_withdrawn").single();
    if (notice.error) throw notice.error;
    expect(notice.data.href).toBe(`/offers/${offerId}`);

    const buyer = await signedIn(browser, buyerEmail);
    const response = await buyer.goto(notice.data.href!);
    expect(response?.status()).toBe(200);
    await expect(buyer.getByRole("heading", { name: /your offer/i })).toBeVisible();
    await expect(buyer.getByText(title).first()).toBeVisible();
    await expect(buyer.getByText("The seller withdrew this listing, so the offer ended")).toBeVisible();
    await expect(buyer.getByText(/withdrew the offer/)).toHaveCount(0);

    const seller = await signedIn(browser, sellerEmail);
    await seller.goto(`/offers/${offerId}`);
    await expect(seller.getByText("You withdrew the listing, so the offer ended")).toBeVisible();
    await expect(seller.getByText(/withdrew the offer/)).toHaveCount(0);
  });
});
