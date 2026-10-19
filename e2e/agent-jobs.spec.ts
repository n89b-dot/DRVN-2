import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

/**
 * A3d's first jobs: "Paste your build" and "List the parts that came off".
 * CI has no model, so the agent's replies are stored as the chat action
 * stores them (agent_chat_append, as the server); the test drives what the
 * member does with each card. A parsed list is saved only on Confirm, under
 * the lines' own ids (a second Confirm adds nothing), with the parser's
 * confidence kept; a part that came off opens the sell form prefilled.
 */
test("a pasted build saves only on Confirm, and a part that came off opens the sell form", async ({ page }) => {
  test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Agent fixtures are restricted to the isolated local stack");
  test.setTimeout(120_000);

  const admin = fixtureAdmin();
  const password = `AgentJobs-${randomUUID()}!`;
  const email = `e2e-agent-jobs-${randomUUID()}@drvn.test`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("Missing jobs member");
  const memberId = created.data.user.id;
  const db = new Client({ host: "127.0.0.1", port: 54322, user: "supabase_admin", password: "postgres", database: "postgres" });
  await db.connect();

  try {
    await admin.from("profiles").update({ username: `jobs${randomUUID().replaceAll("-", "").slice(0, 16)}` }).eq("id", memberId);
    const invitationId = randomUUID();
    await admin.from("beta_invitations").insert({ id: invitationId, email_normalized: email, roles: ["buyer", "seller"], token_hash: createHash("sha256").update(randomUUID()).digest("hex"), expires_at: new Date(Date.now() + 3_600_000).toISOString(), consumed_at: new Date().toISOString(), consumed_by: memberId });
    await admin.from("beta_memberships").insert({ user_id: memberId, invitation_id: invitationId, email_normalized: email, roles: ["buyer", "seller"] });
    await db.query("update public.agent_beta_steps set open = true where step = 'chat'");

    const car = await admin.from("cars").insert({ owner_id: memberId, slug: `agent-jobs-${randomUUID()}`, name: "Jobs Civic", make: "Honda", is_public: true }).select("id").single().throwOnError();
    const carId = car.data!.id;
    const offMod = randomUUID();
    await admin.from("mod_items").insert({ id: offMod, car_id: carId, group_label: "Exhaust", brand: "Mugen", product: "Twin loop exhaust", category: "exhaust", raw_text: "Mugen Twin loop exhaust", position: 0, status: "removed", removed_at: new Date().toISOString() }).throwOnError();

    const listId = randomUUID();
    const lines = [
      { id: randomUUID(), group_label: "Suspension", brand: "KW", product: "V3 coilovers", part_number: null, category: "suspension", confidence: 0.9 },
      { id: randomUUID(), group_label: "Other", brand: null, product: "something odd", part_number: null, category: null, confidence: 0.3 },
    ];
    await db.query("select public.agent_chat_append($1, 'member', 'Paste my build')", [memberId]);
    await db.query("select public.agent_chat_append($1, 'agent', 'Here are your lines.', $2::jsonb)", [memberId, JSON.stringify([{ kind: "build_list", id: listId, car: carId, lines }])]);
    await db.query("select public.agent_chat_append($1, 'agent', 'This came off and isn''t listed.', $2::jsonb)", [memberId, JSON.stringify([{ kind: "list_part", id: offMod, car: carId }])]);
    // A4 "Ask about DRVN": a count of public listings, opening that search.
    await db.query("select public.agent_chat_append($1, 'agent', 'There are 3 for sale.', $2::jsonb)", [memberId, JSON.stringify([{ kind: "marketplace", id: randomUUID(), query: "Mugen exhaust", href: "/marketplace?q=Mugen+exhaust", count: 3, capped: false }])]);

    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);

    await page.goto("/agent");
    const chat = page.getByRole("region", { name: "Chat with your agent" });
    await expect(chat.getByText("2 lines for your Jobs Civic")).toBeVisible();
    await expect(chat.getByText("1 to check: Edit flags them in the editor")).toBeVisible();
    expect((await admin.from("mod_items").select("id").eq("car_id", carId)).data).toHaveLength(1);

    await expect(chat.getByRole("link", { name: /Mugen exhaust/ })).toHaveAttribute("href", "/marketplace?q=Mugen+exhaust");
    await expect(chat.getByText("3 for sale · see them in Marketplace")).toBeVisible();

    await chat.getByRole("button", { name: "Confirm" }).click();
    await expect(chat.getByText("Build updated")).toBeVisible();
    const saved = await admin.from("mod_items").select("id, confidence, status").eq("car_id", carId).order("position");
    expect(saved.data?.map((row) => [row.id, row.status])).toEqual([
      [offMod, "removed"],
      [lines[0].id, "installed"],
      [lines[1].id, "installed"],
    ]);
    expect(Number(saved.data?.[2].confidence)).toBeCloseTo(0.3);

    // The part that came off opens the sell form, prefilled from its line.
    await chat.getByRole("link", { name: /Mugen Twin loop exhaust/ }).click();
    await page.waitForURL(new RegExp(`/sell\\?car=${carId}&mod=${offMod}`));
    await expect(page.locator("#main").getByLabel("Title")).toHaveValue("Mugen Twin loop exhaust");
  } finally {
    await db.end();
    await cleanupFixtureUser(memberId);
  }
});
