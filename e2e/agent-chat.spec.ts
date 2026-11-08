import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

/**
 * A3c: the agent chat on /agent. With the chat step open, a member sends a
 * starter; their message and the agent's reply are stored and come back on
 * reload. CI runs a production build with no model key, so the runner is
 * disabled and the reply is the plain "not switched on" line — the whole
 * path (step gate, rate limit, storage, reply) runs except the model call.
 * Members can't write chat rows themselves.
 */
test("a member's message and the agent's reply are stored and come back", async ({ page }) => {
  test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Agent fixtures are restricted to the isolated local stack");
  test.setTimeout(120_000);

  const admin = fixtureAdmin();
  const password = `AgentChat-${randomUUID()}!`;
  const email = `e2e-agent-chat-${randomUUID()}@drvn.test`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("Missing chat member");
  const memberId = created.data.user.id;
  const db = new Client({ host: "127.0.0.1", port: 54322, user: "supabase_admin", password: "postgres", database: "postgres" });
  await db.connect();

  try {
    await admin.from("profiles").update({ username: `chat${randomUUID().replaceAll("-", "").slice(0, 16)}` }).eq("id", memberId);
    const invitationId = randomUUID();
    await admin.from("beta_invitations").insert({ id: invitationId, email_normalized: email, roles: ["buyer"], token_hash: createHash("sha256").update(randomUUID()).digest("hex"), expires_at: new Date(Date.now() + 3_600_000).toISOString(), consumed_at: new Date().toISOString(), consumed_by: memberId });
    await admin.from("beta_memberships").insert({ user_id: memberId, invitation_id: invitationId, email_normalized: email, roles: ["buyer"] });
    await db.query("update public.agent_beta_steps set open = true where step = 'chat'");

    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);

    await page.goto("/agent");
    await expect(page.getByRole("region", { name: "What your agent does" })).toBeVisible();
    await page.getByRole("group", { name: "Starters" }).getByRole("button", { name: "Find parts for my car" }).click();
    await expect(page.getByLabel("Message your agent")).toHaveValue("Find parts for my car");
    const chat = page.getByRole("region", { name: "Chat with your agent" });
    await chat.getByRole("button", { name: /send/i }).click();
    await expect(chat.getByText("Find parts for my car").first()).toBeVisible();
    await expect(chat.getByText(/Chat isn't switched on here yet|can't reach the model/)).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(chat.getByRole("button", { name: "Find parts for my car" })).toBeInViewport();
    await page.screenshot({ path: "test-results/design/a3c-02-agent-chat-390.png" });
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.reload();
    await expect(page.getByRole("region", { name: "Chat with your agent" }).getByText("Find parts for my car").first()).toBeVisible();
    const rows = await db.query<{ role: string }>("select role from public.agent_messages where owner_id = $1 order by created_at", [memberId]);
    expect(rows.rows.map((row) => row.role)).toEqual(["member", "agent"]);

    // Members read their own chat but can't write it.
    const asMember = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
    await asMember.auth.signInWithPassword({ email, password });
    const conversation = await asMember.from("agent_conversations").select("id").single();
    expect(conversation.data?.id).toBeTruthy();
    const forged = await asMember.from("agent_messages").insert({ conversation_id: conversation.data!.id, owner_id: memberId, role: "agent", body: "forged" });
    expect(forged.error).not.toBeNull();
  } finally {
    await db.end();
    await cleanupFixtureUser(memberId);
  }
});

/**
 * A3c's desktop container: "Ask your agent" on your own car opens the agent
 * beside the page (non-modal: the page still works), about that car; Esc
 * closes it and focus goes back; the rail's Agent row toggles it. On a
 * phone the same button goes to /agent with the same context chip.
 */
test("the agent opens beside the page on desktop and as the full page on a phone", async ({ page }) => {
  test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Agent fixtures are restricted to the isolated local stack");
  test.setTimeout(120_000);

  const admin = fixtureAdmin();
  const password = `AgentPanel-${randomUUID()}!`;
  const email = `e2e-agent-panel-${randomUUID()}@drvn.test`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("Missing panel member");
  const memberId = created.data.user.id;
  const db = new Client({ host: "127.0.0.1", port: 54322, user: "supabase_admin", password: "postgres", database: "postgres" });
  await db.connect();

  try {
    await admin.from("profiles").update({ username: `panel${randomUUID().replaceAll("-", "").slice(0, 16)}` }).eq("id", memberId);
    const invitationId = randomUUID();
    await admin.from("beta_invitations").insert({ id: invitationId, email_normalized: email, roles: ["buyer"], token_hash: createHash("sha256").update(randomUUID()).digest("hex"), expires_at: new Date(Date.now() + 3_600_000).toISOString(), consumed_at: new Date().toISOString(), consumed_by: memberId });
    await admin.from("beta_memberships").insert({ user_id: memberId, invitation_id: invitationId, email_normalized: email, roles: ["buyer"] });
    await db.query("update public.agent_beta_steps set open = true where step = 'chat'");
    const slug = `agent-panel-${randomUUID()}`;
    const car = await admin.from("cars").insert({ owner_id: memberId, slug, name: "Panel E46", make: "BMW", is_public: true }).select("id").single().throwOnError();

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);

    await page.goto(`/cars/${slug}`);
    const ask = page.getByRole("link", { name: "Ask your agent" });
    await ask.click();
    const panel = page.getByRole("complementary", { name: "Your agent" });
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/cars/${slug}$`));
    await expect(panel.getByText("About:")).toContainText("Panel E46");
    await expect(panel.getByRole("button", { name: "Update my build" })).toBeVisible();
    // Non-modal: the page beside it still takes clicks.
    await expect(page.getByRole("link", { name: "Manage" })).toBeVisible();
    await page.screenshot({ path: "test-results/design/a3c-02-agent-panel-1440.png" });

    // A message from the panel is stored as typed; the car is context, not text.
    await panel.getByLabel("Message your agent").fill("What's on this car?");
    await panel.getByRole("button", { name: /send/i }).click();
    await expect(panel.getByText(/Chat isn't switched on here yet|can't reach the model/)).toBeVisible();
    const stored = await db.query<{ body: string }>("select body from public.agent_messages where owner_id = $1 and role = 'member'", [memberId]);
    expect(stored.rows.map((row) => row.body)).toEqual(["What's on this car?"]);

    // Esc from inside closes it, and focus goes back to the button.
    await panel.getByLabel("Message your agent").press("Escape");
    await expect(panel).toBeHidden();
    await expect(ask).toBeFocused();

    // The rail's Agent row toggles it, and it stays open across pages.
    const railAgent = page.getByRole("complementary", { name: "Sections" }).getByRole("link", { name: /^Agent/ });
    await railAgent.click();
    await expect(panel).toBeVisible();
    await page.goto("/garage");
    await expect(page.getByRole("complementary", { name: "Your agent" })).toBeVisible();

    // Still remembered as open, a phone builds no panel: no hidden thread to
    // confuse the page's own layout, and the bottom bar is there.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/garage");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.locator(".sidepanel .agentchat")).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/garage");
    await page.getByRole("complementary", { name: "Your agent" }).getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("complementary", { name: "Your agent" })).toBeHidden();

    // A phone has no panel: the button goes to /agent with the same chip.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/cars/${slug}`);
    await page.getByRole("link", { name: "Ask your agent" }).click();
    await page.waitForURL(new RegExp(`/agent\\?about=car:${car.data!.id}`));
    await expect(page.getByRole("region", { name: "Chat with your agent" }).getByText("About:")).toContainText("Panel E46");
  } finally {
    await db.end();
    await cleanupFixtureUser(memberId);
  }
});
