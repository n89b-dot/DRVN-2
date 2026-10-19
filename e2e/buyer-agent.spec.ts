import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";

import { runAgentPass, type AgentDb } from "../src/lib/agent/worker";
import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

/**
 * A3b end to end: the buyer's agent against a person selling.
 *
 * The buyer opens "Negotiate for me" on a $1,500 listing with a private
 * $1,300 max on the item. The agent opens; the seller counters $1,400 (over
 * the max) and the agent counters back; the seller comes down to $1,280 and
 * the agent accepts — inside the max — so the order exists and the buyer is
 * told to pay. The seller sees ordinary offers marked "via agent", never the
 * max.
 *
 * The worker runs here through the real runAgentPass, as the agent_worker
 * role (SET ROLE on the isolated local stack) — the same path the
 * scheduled job takes with its own login.
 */
test.describe("buyer agent (A3b)", () => {
  test.setTimeout(240_000);
  const password = `BuyerAgent-${randomUUID()}!`;
  const sellerEmail = `e2e-buyagent-seller-${randomUUID()}@drvn.test`;
  const buyerEmail = `e2e-buyagent-buyer-${randomUUID()}@drvn.test`;
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
    const listing = await admin.from("listings").insert({ seller_id: users[0], title: `Agent brakes ${randomUUID().slice(0, 8)}`, category: "brakes-suspension", subcategory: "big-brake-kits", condition: "used", price_cents: 150000, shipping_cents: 0, currency: "USD", status: "active" }).select("id").single();
    if (listing.error) throw listing.error;
    listingId = listing.data.id;
    const image = await admin.from("listing_images").insert({ listing_id: listingId, url: "https://example.test/agent-brakes.webp", position: 0 });
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

  async function sellerCounter(page: Page, offerId: string, amount: string) {
    await page.goto(`/offers/${offerId}`);
    await page.getByRole("button", { name: /^counter$/i }).click();
    await page.getByLabel(/^Your counter$/).fill(amount);
    await page.getByRole("button", { name: /send counter(?!-offer)/i }).click();
    await expect(page.getByText(/Counter(-offer)? sent\./)).toBeVisible();
  }

  test("negotiates within a private max, accepts inside it, and the seller never sees the max", async ({ browser }) => {
    const buyer = await signedIn(browser, buyerEmail);
    const seller = await signedIn(browser, sellerEmail);

    await buyer.goto(`/listings/${listingId}`);
    await buyer.getByRole("button", { name: "Make an offer" }).first().click();
    await buyer.getByRole("button", { name: "Negotiate for me" }).click();
    await buyer.getByLabel(/Your max — private/).fill("1300");
    await expect(buyer.getByText("A counter at $1,300 or less is accepted.")).toBeVisible();
    await buyer.getByLabel(/I understand an accepted counter is a purchase/).check();
    await shoot(buyer, "07-negotiate-for-me");
    await buyer.getByRole("button", { name: "Start negotiating" }).click();
    await expect(buyer.getByText(/Your agent is negotiating/)).toBeVisible();

    // The agent opens.
    await agentPass();
    const offer = await db.query<{ id: string; amount_cents: number }>("select id, amount_cents from public.offers where listing_id = $1 and buyer_id = $2", [listingId, users[1]]);
    const offerId = offer.rows[0].id;
    expect(offer.rows[0].amount_cents).toBeLessThanOrEqual(130000);
    expect((await rounds(offerId))[0]).toMatchObject({ kind: "offer", actor_role: "buyer", by_agent: true });

    // The seller counters over the max; the agent counters back, still inside it.
    await sellerCounter(seller, offerId, "1400");
    await agentPass();
    const back = (await rounds(offerId)).at(-1)!;
    expect(back).toMatchObject({ kind: "counter", actor_role: "buyer", by_agent: true });
    expect(back.amount_cents).toBeLessThanOrEqual(130000);

    // The seller sees "via agent", never the max.
    await seller.goto(`/offers/${offerId}`);
    // #main: until React reveals a streamed boundary, its copy also sits in a hidden segment.
    await expect(seller.locator("#main").getByText("Buyer's agent countered")).toBeVisible();
    expect(await seller.content()).not.toContain("$1,300");

    // The seller comes down inside the max; the agent accepts it.
    await sellerCounter(seller, offerId, "1280");
    await agentPass();
    expect((await rounds(offerId)).at(-1)).toMatchObject({ kind: "accept", actor_role: "buyer", by_agent: true });
    const order = await db.query<{ status: string; subtotal_cents: number }>("select status, subtotal_cents from public.orders where origin_offer_id = $1", [offerId]);
    expect(order.rows[0]).toMatchObject({ status: "pending", subtotal_cents: 128000 });
    const notice = await db.query<{ href: string }>("select href from public.notifications where user_id = $1 and kind = 'offer_agent_deal_reached'", [users[1]]);
    expect(notice.rows).toHaveLength(1);
    expect(notice.rows[0].href).toMatch(/\/orders\/[0-9a-f-]+\/checkout$/);
  });
});
