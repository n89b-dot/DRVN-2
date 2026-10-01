import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import { assertAccessible } from "./accessibility";
import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

// RR-13 and RR-14: a conversation renders the same tree on the server and in
// the reader's browser whatever their timezone, and a reader scrolled up into
// history keeps their place when a new message arrives.

async function seedConversation(messageCount: number, firstAt: Date) {
  const admin = fixtureAdmin();
  const users: string[] = [];
  const password = `Thread-${randomUUID()}!`;
  const buyerEmail = `e2e-thread-${randomUUID()}@drvn.test`;
  for (const address of [buyerEmail, `e2e-thread-seller-${randomUUID()}@drvn.test`]) {
    const result = await admin.auth.admin.createUser({ email: address, password, email_confirm: true });
    if (result.error) throw result.error;
    users.push(result.data.user.id);
    const named = await admin
      .from("profiles")
      .update({ username: `thr${randomUUID().replaceAll("-", "").slice(0, 18)}`, display_name: "Sam Seller" })
      .eq("id", result.data.user.id);
    if (named.error) throw named.error;
  }
  const [buyer, seller] = users;
  const listing = await admin
    .from("listings")
    .insert({ seller_id: seller, title: "Thread fixture", category: "performance", price_cents: 10000, shipping_cents: 0, currency: "USD", status: "active" })
    .select("id")
    .single();
  if (listing.error) throw listing.error;
  const offer = await admin.from("offers").insert({ listing_id: listing.data.id, buyer_id: buyer, amount_cents: 9000 }).select("id").single();
  if (offer.error) throw offer.error;
  const rows = Array.from({ length: messageCount }, (_, i) => ({
    offer_id: offer.data.id,
    listing_id: listing.data.id,
    sender_id: i % 2 ? buyer : seller,
    recipient_id: i % 2 ? seller : buyer,
    body: `Earlier message ${i + 1}`,
    created_at: new Date(firstAt.getTime() + i * 4 * 60_000).toISOString(),
  }));
  const inserted = await admin.from("messages").insert(rows);
  if (inserted.error) throw inserted.error;
  return { admin, users, buyer, seller, buyerEmail, password, offerId: offer.data.id, listingId: listing.data.id };
}

/** The open conversation — the inbox pane beside it repeats the latest line. */
const thread = (page: Page) => page.locator(".convthread");

/** Day dividers between "Earlier message 1" and "Earlier message 2", in
 *  document order — 0 when both sit under the same New York day. */
function dividersBetweenTheTwo(page: Page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll(".convthread .convthread__day, .convthread .msgrun"));
    const at = (text: string) => nodes.findIndex((n) => n.classList.contains("msgrun") && n.textContent?.includes(text));
    const [a, b] = [at("Earlier message 1"), at("Earlier message 2")];
    if (a < 0 || b < 0) return -1;
    return nodes.slice(a, b).filter((n) => n.classList.contains("convthread__day")).length;
  });
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/^email$/i).fill(email);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL(/\/home/);
}

test.describe("reading a conversation", () => {
  test.use({ timezoneId: "America/New_York" });

  test("day dividers follow the reader's zone with no hydration mismatch, first visit and after", async ({ page }) => {
    test.setTimeout(120_000);
    // 23:58 and 00:02 UTC: two UTC days, one New York evening.
    const fixture = await seedConversation(2, new Date("2026-09-30T23:58:00Z"));
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && /hydrat/i.test(m.text())) errors.push(m.text());
    });
    try {
      await signIn(page, fixture.buyerEmail, fixture.password);
      // First visit: the server doesn't know the zone yet and renders UTC; the
      // browser hydrates the same tree, then regroups in New York time.
      await page.goto(`/messages/${fixture.offerId}`);
      await expect(thread(page).getByText("Earlier message 2")).toBeVisible();
      await expect.poll(() => dividersBetweenTheTwo(page)).toBe(0);
      // Second visit: the server renders New York time from the start.
      await page.reload();
      await expect(thread(page).getByText("Earlier message 2")).toBeVisible();
      expect(await dividersBetweenTheTwo(page)).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      for (const id of fixture.users.reverse()) await cleanupFixtureUser(id);
    }
  });

  test("a new message doesn't pull a reader out of history, and follows a reader at the latest", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 700 });
    const fixture = await seedConversation(40, new Date(Date.now() - 3 * 60 * 60_000));
    try {
      await signIn(page, fixture.buyerEmail, fixture.password);
      await page.goto(`/messages/${fixture.offerId}`);
      await expect(thread(page).getByText("Earlier message 40")).toBeInViewport();

      // Scrolled up, reading.
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      const send = (body: string) =>
        fixture.admin.from("messages").insert({
          offer_id: fixture.offerId,
          listing_id: fixture.listingId,
          sender_id: fixture.seller,
          recipient_id: fixture.buyer,
          body,
        });
      const first = await send("Arrived while you were reading");
      if (first.error) throw first.error;
      const jump = page.getByRole("button", { name: /1 new message/ });
      // Live delivery, or the 20-second fallback refresh.
      await expect(jump).toBeInViewport({ timeout: 35_000 });
      expect(await page.evaluate(() => window.scrollY)).toBeLessThan(50);
      // RR-22: the thread with its new-messages control meets WCAG A/AA.
      await assertAccessible(page, "conversation with the new-messages control");

      await jump.click();
      await expect(thread(page).getByText("Arrived while you were reading")).toBeInViewport();
      await expect(jump).toHaveCount(0);

      // At the latest: the next one is followed, no button.
      const second = await send("Arrived while you were at the bottom");
      if (second.error) throw second.error;
      await expect(thread(page).getByText("Arrived while you were at the bottom")).toBeInViewport({ timeout: 35_000 });
      await expect(page.getByRole("button", { name: /new message/ })).toHaveCount(0);
    } finally {
      for (const id of fixture.users.reverse()) await cleanupFixtureUser(id);
    }
  });
});
