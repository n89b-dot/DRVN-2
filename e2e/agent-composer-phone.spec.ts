import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

/**
 * R-audit-composer: on a phone, /agent keeps the bottom bar (Explore ·
 * Marketplace · Home · Garage · Agent) and the chat composer has to sit
 * above it. It used to sit under the bar, so the field and Send were
 * covered whenever the chat section's top edge was near the bottom of the
 * screen. At 375×812 the whole composer must be on screen, clear of the bar,
 * and what's at the centre of the field and of Send must be the field and
 * Send themselves: on arrival, with the section starting just above the bar,
 * after scrolling to the end, and with a long thread.
 */

async function assertComposerClear(page: Page, when: string) {
  const viewport = page.viewportSize()!;
  const nav = page.getByRole("navigation", { name: "Main" }).last();
  const composer = page.locator("#main .agentchat .chatbox");
  const field = page.getByLabel("Message your agent");
  const send = page.locator("#main .agentchat .chatbox").getByRole("button", { name: /send/i });

  await expect(nav, `${when}: the bottom bar stays on /agent`).toBeVisible();
  await expect(composer, `${when}: composer`).toBeInViewport({ ratio: 1 });
  const bar = (await nav.boundingBox())!;
  const box = (await composer.boundingBox())!;
  expect(box.y, `${when}: composer top is on screen`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `${when}: composer ends above the bottom bar`).toBeLessThanOrEqual(bar.y + 0.5);
  expect(bar.y + bar.height, `${when}: the bar is at the bottom edge`).toBeLessThanOrEqual(viewport.height + 0.5);

  for (const [name, target] of [["field", field], ["Send", send]] as const) {
    const hit = await target.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return Boolean(top && (top === element || element.contains(top)));
    });
    expect(hit, `${when}: nothing covers the composer's ${name}`).toBe(true);
  }
}

test("on a phone the agent composer sits fully above the bottom bar", async ({ browser }) => {
  test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Agent fixtures are restricted to the isolated local stack");
  test.setTimeout(120_000);

  const admin = fixtureAdmin();
  const password = `Composer-${randomUUID()}!`;
  const email = `e2e-composer-${randomUUID()}@drvn.test`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("Missing composer member");
  const memberId = created.data.user.id;
  const db = new Client({ host: "127.0.0.1", port: 54322, user: "supabase_admin", password: "postgres", database: "postgres" });
  await db.connect();
  const before = await db.query<{ open: boolean }>("select open from public.agent_beta_steps where step = 'chat'");
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
  const page = await context.newPage();

  try {
    await admin.from("profiles").update({ username: `comp${randomUUID().replaceAll("-", "").slice(0, 16)}`, display_name: "Composer" }).eq("id", memberId);
    await db.query("update public.agent_beta_steps set open = true where step = 'chat'");

    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);

    await page.goto("/agent");
    await expect(page.getByRole("region", { name: "Chat with your agent" })).toBeVisible();
    await assertComposerClear(page, "on arrival");

    // The shape the audit caught: the chat section's top edge just above the
    // bar, where a composer pinned inside that section had nowhere to go but
    // under the bar.
    await page.evaluate(() => {
      const chat = document.querySelector("#main .agentchat")!.getBoundingClientRect();
      const bar = document.querySelector("nav.bnav")!.getBoundingClientRect();
      window.scrollBy(0, chat.top - (bar.top - 20));
    });
    await assertComposerClear(page, "chat section starting just above the bar");

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await assertComposerClear(page, "scrolled to the end");

    // A thread longer than the screen: the composer stays pinned above the bar.
    const rows = Array.from({ length: 12 }, (_, i) => [
      memberId,
      i % 2 ? "agent" : "member",
      `Line ${i + 1} of a long conversation about whether the K03 fits a B5 S4.`,
      new Date(Date.now() - (12 - i) * 60_000).toISOString(),
    ]);
    const conversation = await db.query<{ id: string }>(
      "insert into public.agent_conversations (owner_id) values ($1) returning id",
      [memberId]
    );
    for (const [owner, role, body, at] of rows) {
      await db.query(
        "insert into public.agent_messages (conversation_id, owner_id, role, body, created_at) values ($1, $2, $3, $4, $5)",
        [conversation.rows[0].id, owner, role, body, at]
      );
    }
    await page.reload();
    await expect(page.getByText("Line 12 of a long conversation", { exact: false })).toBeAttached();
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertComposerClear(page, "long thread, top of the page");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await assertComposerClear(page, "long thread, scrolled to the end");
    await page.screenshot({ path: "test-results/design/r-audit-composer-375.png" });
  } finally {
    await context.close();
    if (before.rows[0]) await db.query("update public.agent_beta_steps set open = $1 where step = 'chat'", [before.rows[0].open]);
    await db.end();
    await cleanupFixtureUser(memberId);
  }
});
