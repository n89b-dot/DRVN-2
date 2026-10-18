import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";

import { runAgentPass, type AgentDb } from "../src/lib/agent/worker";
import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";
import { attachSellPhoto } from "./helpers";

/**
 * A3a end to end: a person against the seller's agent.
 *
 * The seller turns on "Let DRVN handle offers" on the listing editor
 * ($250 asking, $230 minimum, $245 target). A buyer offers $232 from the
 * listing, counters back $236 and then $237 (each below the agent's last
 * counter, as a counter must be);
 * the agent counters within the limits, every turn marked "via agent"; the
 * buyer's third offer clears the minimum, so the agent asks rather than
 * accepting; the seller accepts from Needs you; and "Cancel before checkout"
 * shows only until the buyer starts checkout. Throughout, nothing the buyer
 * can load names the minimum.
 *
 * The worker runs here through the real runAgentPass, as the agent_worker
 * role (SET ROLE on the isolated local stack) — the same path the
 * scheduled job takes with its own login.
 */
test.describe("seller agent (A3a)", () => {
  test.setTimeout(240_000);
  const password = `SellerAgent-${randomUUID()}!`;
  const sellerEmail = `e2e-agent-seller-${randomUUID()}@drvn.test`;
  const buyerEmail = `e2e-agent-buyer-${randomUUID()}@drvn.test`;
  const users: string[] = [];
  let listingId = "";
  let db: Client;

  test.beforeAll(async () => {
    test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Agent fixtures are restricted to the isolated local stack");
    const admin = fixtureAdmin();
    for (const [email, role] of [[sellerEmail, "seller"], [buyerEmail, "buyer"]] as const) {
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw created.error ?? new Error("Missing agent user");
      users.push(created.data.user.id);
      const named = await admin.from("profiles").update({ username: `agent${randomUUID().replaceAll("-", "").slice(0, 16)}` }).eq("id", created.data.user.id);
      if (named.error) throw named.error;
      const invitationId = randomUUID();
      const invitation = await admin.from("beta_invitations").insert({ id: invitationId, email_normalized: email, roles: [role], token_hash: createHash("sha256").update(randomUUID()).digest("hex"), expires_at: new Date(Date.now() + 60 * 60_000).toISOString(), consumed_at: new Date().toISOString(), consumed_by: created.data.user.id });
      if (invitation.error) throw invitation.error;
      const membership = await admin.from("beta_memberships").insert({ user_id: created.data.user.id, invitation_id: invitationId, email_normalized: email, roles: [role] });
      if (membership.error) throw membership.error;
    }
    const listing = await admin.from("listings").insert({ seller_id: users[0], title: `Agent intake ${randomUUID().slice(0, 8)}`, category: "performance", subcategory: "intake", condition: "used", price_cents: 25000, shipping_cents: 0, currency: "USD", status: "active" }).select("id").single();
    if (listing.error) throw listing.error;
    listingId = listing.data.id;
    const image = await admin.from("listing_images").insert({ listing_id: listingId, url: "https://example.test/agent-intake.webp", position: 0 });
    if (image.error) throw image.error;

    db = new Client({ host: "127.0.0.1", port: 54322, user: "supabase_admin", password: "postgres", database: "postgres" });
    await db.connect();
    // Steps start closed (20261024100000); this stack opens the two the
    // agent specs drive. AGENTS_BETA=on is set in playwright.config.ts.
    await db.query("update public.agent_beta_steps set open = true where step in ('seller', 'buyer')");
  });

  test.afterAll(async () => {
    if (db) await db.end();
    for (const id of users.reverse()) await cleanupFixtureUser(id);
  });

  /**
   * One worker pass as agent_worker, in its own transaction. The agent ships
   * paused for everyone (A2's seeded "all" switch): it is lifted inside this
   * transaction and put back before it commits, so no other test — or a
   * parallel run — ever sees it off.
   */
  async function agentPass() {
    await db.query("begin");
    try {
      const live = await db.query<{ id: string }>("update public.agent_controls set cleared_at = now() where scope = 'all' and cleared_at is null returning id");
      await db.query("set local role agent_worker");
      const worker: AgentDb = { query: (text, values) => db.query(text, values as unknown[]) as never };
      const result = await runAgentPass(worker, { limit: 10 });
      await db.query("reset role");
      if (live.rows.length) await db.query("update public.agent_controls set cleared_at = null where id = any($1)", [live.rows.map((row) => row.id)]);
      await db.query("commit");
      return result;
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  }

  async function signedIn(browser: Browser, email: string): Promise<Page> {
    const page = await (await browser.newContext()).newPage();
    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);
    return page;
  }

  /** The screen at the design's two widths, for comparison with docs/design/agent-a3. */
  async function shoot(page: Page, name: string) {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.screenshot({ path: `test-results/design/a3a-${name}-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 720 });
  }

  async function rounds(offerId: string) {
    const { rows } = await db.query<{ round_no: number; kind: string; actor_role: string; amount_cents: number | null; by_agent: boolean }>(
      "select round_no, kind, actor_role, amount_cents, actor_task_id is not null as by_agent from public.offer_rounds where offer_id = $1 order by round_no",
      [offerId]
    );
    return rows;
  }

  test("counters within limits, asks before a sale, and never shows the buyer the minimum", async ({ browser }) => {
    const seller = await signedIn(browser, sellerEmail);
    const buyer = await signedIn(browser, buyerEmail);

    // The seller turns the agent on from the listing editor.
    await seller.goto(`/listings/${listingId}/edit`);
    // The form stays disabled until it hydrates; checking the box waits for that.
    await seller.getByLabel("Let DRVN handle offers").check();
    // A live listing needs a real photo of its own (M-5/W-2); the fixture's
    // placeholder URL isn't one, so attach one through the editor's uploader
    // and wait for the upload itself: a tile whose image comes from storage.
    await attachSellPhoto(seller);
    await expect(seller.locator('#sell-photos .thumb img[src*="storage"]').first()).toBeVisible({ timeout: 30_000 });
    await expect(seller.locator("#sell-photos").getByText("Uploading…")).toHaveCount(0, { timeout: 30_000 });
    await seller.getByLabel(/Minimum — your walk-away price/).fill("230");
    await seller.getByLabel(/^Target$/).fill("245");
    await seller.getByLabel(/I understand my agent's counters are binding/).check();
    await shoot(seller, "03-handle-offers");
    await seller.getByRole("button", { name: /save changes/i }).first().click();
    await expect(seller.getByText("Listing updated.")).toBeVisible();
    const mandate = await db.query("select minimum_cents, target_cents, style, status from public.agent_mandates where listing_id = $1", [listingId]);
    expect(mandate.rows).toEqual([{ minimum_cents: 23000, target_cents: 24500, style: "balanced", status: "active" }]);

    // Round 1: the buyer offers $232 from the listing; the agent counters.
    await buyer.goto(`/listings/${listingId}`);
    await buyer.getByRole("button", { name: "Make an offer" }).first().click();
    await buyer.getByLabel("Your offer").fill("232");
    await buyer.getByRole("button", { name: /send offer/i }).click();
    await expect(buyer.getByText(/Offer sent/)).toBeVisible();
    const offer = await db.query<{ id: string }>("select id from public.offers where listing_id = $1 and buyer_id = $2", [listingId, users[1]]);
    const offerId = offer.rows[0].id;
    await agentPass();
    let history = await rounds(offerId);
    const firstCounter = history.at(-1)!;
    expect(firstCounter).toMatchObject({ kind: "counter", actor_role: "seller", by_agent: true });
    expect(firstCounter.amount_cents).toBeGreaterThanOrEqual(23000);
    expect(firstCounter.amount_cents).toBeLessThanOrEqual(25000);

    // The buyer sees the agent's turn, marked, and nothing that names $230.
    await buyer.goto(`/offers/${offerId}`);
    await expect(buyer.getByText("Seller's agent countered")).toBeVisible();
    await expect(buyer.getByText("· via agent").first()).toBeVisible();
    expect(await buyer.content()).not.toContain("$230");
    await shoot(buyer, "04-offer-history-buyer");
    // Nor through the API, with the buyer's own session.
    const asBuyer = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    await asBuyer.auth.signInWithPassword({ email: buyerEmail, password });
    for (const table of ["listing_private_terms", "agent_mandates", "agent_mandate_versions", "agent_events"] as const) {
      const { data } = await asBuyer.from(table).select("*");
      expect(JSON.stringify(data ?? [])).not.toContain("23000");
    }
    const listingRow = await asBuyer.from("listings").select("*").eq("id", listingId).single();
    expect(JSON.stringify(listingRow.data)).not.toContain("23000");

    // Rounds 3–4: the buyer counters back; the agent gives ground, never below the minimum.
    await buyer.getByRole("button", { name: /^counter back$/i }).click();
    await buyer.getByLabel("Your counter-offer").fill("236");
    await buyer.getByRole("button", { name: /send counter-offer/i }).click();
    await expect(buyer.getByText(/Counter(-offer)? sent\./)).toBeVisible();
    await agentPass();
    history = await rounds(offerId);
    const secondCounter = history.at(-1)!;
    expect(secondCounter).toMatchObject({ kind: "counter", actor_role: "seller", by_agent: true });
    expect(secondCounter.amount_cents).toBeGreaterThanOrEqual(23000);
    expect(secondCounter.amount_cents).toBeLessThan(firstCounter.amount_cents!);

    // Round 5: the buyer's third and last offer clears the minimum. The agent never accepts; it asks.
    await buyer.goto(`/offers/${offerId}`);
    await buyer.getByRole("button", { name: /^counter back$/i }).click();
    // Below the agent's last counter (a counter must be), above the minimum.
    await buyer.getByLabel("Your counter-offer").fill("237");
    await buyer.getByRole("button", { name: /send counter-offer/i }).click();
    await expect(buyer.getByText(/Counter(-offer)? sent\./)).toBeVisible();
    await agentPass();
    expect((await rounds(offerId)).at(-1)).toMatchObject({ kind: "counter", actor_role: "buyer", amount_cents: 23700 });

    // The seller's offer history explains their own agent; Needs you asks for the tap.
    await seller.goto(`/offers/${offerId}`);
    await expect(seller.getByText("Your agent countered").first()).toBeVisible();
    await expect(seller.getByText(/Opened at|Gave ground|Final counter/).first()).toBeVisible();
    await shoot(seller, "04-offer-history-seller");
    await seller.goto("/agent");
    await expect(seller.getByRole("tab", { name: /Needs you/ })).toBeVisible();
    await shoot(seller, "02-agent-screen");
    await seller.getByRole("button", { name: "Accept $237" }).click();
    // Accepting from Needs you lands on the offer, accepted.
    await seller.waitForURL(new RegExp(`/offers/${offerId}$`));
    await expect(seller.getByText(/accepted/i).first()).toBeVisible();
    const order = await db.query<{ id: string; status: string; subtotal_cents: number }>("select id, status, subtotal_cents from public.orders where origin_offer_id = $1", [offerId]);
    expect(order.rows[0]).toMatchObject({ status: "pending", subtotal_cents: 23700 });
    const orderId = order.rows[0].id;
    const notice = await db.query("select kind from public.notifications where user_id = $1 and kind = 'offer_agent_recommends_accept'", [users[0]]);
    expect(notice.rows).toHaveLength(1);

    // Cancel before checkout: gone once the buyer's checkout is frozen, back when it isn't.
    await db.query("update public.orders set accepted_checkout_shipping = '{\"frozen\":true}'::jsonb where id = $1", [orderId]);
    await seller.goto(`/offers/${offerId}`);
    await expect(seller.getByRole("button", { name: "Cancel before checkout" })).toHaveCount(0);
    // The database refuses to un-freeze a started checkout (rightly); on this
    // isolated stack the test puts the order back with triggers bypassed for
    // that one statement, to check the other side of the rule.
    await db.query("begin");
    await db.query("set local session_replication_role = replica");
    await db.query("update public.orders set accepted_checkout_shipping = null where id = $1", [orderId]);
    await db.query("commit");
    await seller.goto(`/offers/${offerId}`);
    await shoot(seller, "04-offer-accepted-cancel");
    await seller.getByRole("button", { name: "Cancel before checkout" }).click();
    await seller.getByRole("button", { name: "Confirm cancellation" }).click();
    await expect.poll(async () => (await db.query<{ status: string }>("select status from public.orders where id = $1", [orderId])).rows[0].status).toBe("cancelled");
  });
});
