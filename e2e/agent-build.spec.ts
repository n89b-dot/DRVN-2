import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

/**
 * A3c "Update my build": an agent reply's confirm card. CI has no model, so
 * the reply is stored as the chat action would store it (agent_chat_append,
 * as the server) and the test drives what the member does with it: Confirm
 * saves through the mods editor's own save, replacing the old part (kept,
 * marked removed) and offering to list it; Edit opens the editor with the
 * line filled in and unsaved.
 */
test("a build change from the agent is saved only when the member confirms it", async ({ page }) => {
  test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Agent fixtures are restricted to the isolated local stack");
  test.setTimeout(120_000);

  const admin = fixtureAdmin();
  const password = `AgentBuild-${randomUUID()}!`;
  const email = `e2e-agent-build-${randomUUID()}@drvn.test`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("Missing build member");
  const memberId = created.data.user.id;
  const db = new Client({ host: "127.0.0.1", port: 54322, user: "supabase_admin", password: "postgres", database: "postgres" });
  await db.connect();

  try {
    await admin.from("profiles").update({ username: `build${randomUUID().replaceAll("-", "").slice(0, 16)}` }).eq("id", memberId);
    const invitationId = randomUUID();
    await admin.from("beta_invitations").insert({ id: invitationId, email_normalized: email, roles: ["buyer"], token_hash: createHash("sha256").update(randomUUID()).digest("hex"), expires_at: new Date(Date.now() + 3_600_000).toISOString(), consumed_at: new Date().toISOString(), consumed_by: memberId });
    await admin.from("beta_memberships").insert({ user_id: memberId, invitation_id: invitationId, email_normalized: email, roles: ["buyer"] });
    await db.query("update public.agent_beta_steps set open = true where step = 'chat'");

    const car = await admin.from("cars").insert({ owner_id: memberId, slug: `agent-build-${randomUUID()}`, name: "Mk8 Golf R", make: "Volkswagen", is_public: true }).select("id").single().throwOnError();
    const carId = car.data!.id;
    const oldMod = randomUUID();
    await admin.from("mod_items").insert({ id: oldMod, car_id: carId, group_label: "Suspension", brand: "APR", product: "Roll-Control mount", category: "suspension", raw_text: "APR Roll-Control mount", position: 0, status: "installed" }).throwOnError();

    const confirmId = randomUUID();
    const editId = randomUUID();
    const card = (id: string, product: string, replaces: string | null) => ({ kind: "build_change", id, car: carId, replaces, brand: "KW", product, part_number: null, category: "suspension", product_url: null, image_url: null });
    await db.query("select public.agent_chat_append($1, 'member', 'Just fitted KW V3s in place of the APR mount')", [memberId]);
    await db.query("select public.agent_chat_append($1, 'agent', 'Here it is. Tap Confirm to save it.', $2::jsonb)", [memberId, JSON.stringify([card(confirmId, "V3 coilovers", oldMod)])]);
    await db.query("select public.agent_chat_append($1, 'agent', 'And the springs?', $2::jsonb)", [memberId, JSON.stringify([card(editId, "Clubsport springs", null)])]);

    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);

    // Nothing is saved before Confirm.
    await page.goto("/agent");
    const chat = page.getByRole("region", { name: "Chat with your agent" });
    await expect(chat.getByText("Add to your Mk8 Golf R; mark APR Roll-Control mount removed")).toBeVisible();
    expect((await admin.from("mod_items").select("id").eq("car_id", carId)).data).toHaveLength(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.screenshot({ path: "test-results/design/a3c-05-build-card-390.png" });
    await page.setViewportSize({ width: 1280, height: 720 });

    await chat.getByRole("button", { name: "Confirm" }).first().click();
    await expect(chat.getByText("Build updated")).toBeVisible();
    await expect(chat.getByRole("link", { name: "List the old one", exact: true })).toHaveAttribute("href", `/sell?car=${carId}&mod=${oldMod}`);
    const after = await admin.from("mod_items").select("id, status, position, brand, product").eq("car_id", carId).order("position");
    expect(after.data?.map((row) => [row.id, row.status])).toEqual([
      [confirmId, "installed"],
      [oldMod, "removed"],
    ]);

    // Confirming again (a reload, a second tap) changes nothing.
    await page.reload();
    await expect(page.getByRole("region", { name: "Chat with your agent" }).getByText("Build updated")).toBeVisible();

    // Edit opens the editor with the line filled in, unsaved until Save.
    await page.goto(`/garage/${carId}/edit?change=${editId}#mods`);
    await expect(page.locator("#main").getByText(/From your agent: check the new line/)).toBeVisible();
    await expect(page.locator(`input[value="Clubsport springs"]`).first()).toBeVisible();
    expect((await admin.from("mod_items").select("id").eq("car_id", carId)).data).toHaveLength(2);
    await page.locator("#mods").getByRole("button", { name: /save the build/i }).click();
    await expect.poll(async () => (await admin.from("mod_items").select("id").eq("id", editId)).data?.length).toBe(1);
  } finally {
    await db.end();
    await cleanupFixtureUser(memberId);
  }
});
