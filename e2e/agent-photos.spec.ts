import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

/** A one-pixel PNG. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * A3d's photo jobs. With the jobs step open a member can add photos to a
 * message: uploaded as their own (re-encoded), stored on their message, sent
 * with it. CI has no model, so the agent's photo drafts are stored as the
 * chat action stores them (agent_chat_append, as the server); the test opens
 * each card: "Listing from photos" fills in the sell form (title, brand,
 * part number, the photo; never a price), "Post an update" fills in the
 * update composer. Nothing is saved by either until the member does.
 */
test("photos go with a message, and the agent's photo drafts open the real pages filled in", async ({ page }) => {
  test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Agent fixtures are restricted to the isolated local stack");
  test.setTimeout(150_000);

  const admin = fixtureAdmin();
  const password = `AgentPhotos-${randomUUID()}!`;
  const email = `e2e-agent-photos-${randomUUID()}@drvn.test`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("Missing photos member");
  const memberId = created.data.user.id;
  const db = new Client({ host: "127.0.0.1", port: 54322, user: "supabase_admin", password: "postgres", database: "postgres" });
  await db.connect();

  try {
    await admin.from("profiles").update({ username: `photos${randomUUID().replaceAll("-", "").slice(0, 14)}` }).eq("id", memberId);
    const invitationId = randomUUID();
    await admin.from("beta_invitations").insert({ id: invitationId, email_normalized: email, roles: ["buyer", "seller"], token_hash: createHash("sha256").update(randomUUID()).digest("hex"), expires_at: new Date(Date.now() + 3_600_000).toISOString(), consumed_at: new Date().toISOString(), consumed_by: memberId });
    await admin.from("beta_memberships").insert({ user_id: memberId, invitation_id: invitationId, email_normalized: email, roles: ["buyer", "seller"] });
    await db.query("update public.agent_beta_steps set open = true where step in ('chat', 'jobs')");

    const car = await admin.from("cars").insert({ owner_id: memberId, slug: `agent-photos-${randomUUID()}`, name: "Photo S2000", make: "Honda", is_public: true }).select("id").single().throwOnError();
    const carId = car.data!.id;
    const modId = randomUUID();
    await admin.from("mod_items").insert({ id: modId, car_id: carId, group_label: "Performance", brand: "Garrett", product: "G25-660 turbo", category: "turbo", raw_text: "Garrett G25-660 turbo", position: 0, status: "installed" }).throwOnError();

    // A photo of the member's own, as the chat's upload leaves it.
    const path = `${memberId}/${randomUUID()}.png`;
    const upload = await admin.storage.from("listing-images").upload(path, PIXEL, { contentType: "image/png" });
    if (upload.error) throw upload.error;
    const photoUrl = admin.storage.from("listing-images").getPublicUrl(path).data.publicUrl;
    const listingDraft = randomUUID();
    const updateDraft = randomUUID();
    await db.query("select public.agent_chat_append($1, 'agent', 'Here''s a start on the listing.', $2::jsonb)", [
      memberId,
      JSON.stringify([{ kind: "listing_draft", id: listingDraft, title: "Garrett G25-660 turbo", brand: "Garrett", part_number: "G25-660", category: "turbo", images: [photoUrl] }]),
    ]);
    await db.query("select public.agent_chat_append($1, 'agent', 'And the update.', $2::jsonb)", [
      memberId,
      JSON.stringify([{ kind: "update_draft", id: updateDraft, car: carId, title: "Turbo day", body: "Fitted the G25 today.", images: [photoUrl], mods: [modId] }]),
    ]);

    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);

    // A photo goes with the message, stored on it as the member's own.
    await page.goto("/agent");
    const chat = page.getByRole("region", { name: "Chat with your agent" });
    await chat.locator('input[type="file"]').setInputFiles({ name: "part.png", mimeType: "image/png", buffer: PIXEL });
    await expect(chat.locator(".chatbox__thumb img")).toHaveCSS("opacity", "1");
    await chat.getByLabel("Message your agent").fill("What is this?");
    await chat.getByRole("button", { name: /send/i }).click();
    await expect(chat.getByText(/Chat isn't switched on here yet|can't reach the model/)).toBeVisible();
    const sent = await db.query<{ images: string[] }>("select images from public.agent_messages where owner_id = $1 and role = 'member'", [memberId]);
    expect(sent.rows[0].images).toHaveLength(1);
    expect(sent.rows[0].images[0]).toContain(`/listing-images/${memberId}/`);

    // Listing from photos: the sell form, filled in; no price.
    await chat.getByRole("link", { name: /Garrett G25-660 turbo/ }).first().click();
    await page.waitForURL(new RegExp(`/sell\\?agent=${listingDraft}`));
    await expect(page.locator("#main").getByLabel("Title")).toHaveValue("Garrett G25-660 turbo");
    await expect(page.locator("#main").getByLabel(/^Brand/)).toHaveValue("Garrett");
    await expect(page.locator(`#main img[src*="${path.split("/")[1]}"]`).first()).toBeAttached();
    await expect(page.locator("#main").getByLabel("Asking price")).toHaveValue("");

    // Post an update: the composer, filled in; nothing published.
    await page.goto(`/garage/${carId}/update/new?agent=${updateDraft}`);
    await expect(page.locator("#main").getByText("Fitted the G25 today.")).toBeVisible();
    const posts = await admin.from("activity_posts").select("id").eq("author_id", memberId).not("published_at", "is", null);
    expect(posts.data).toHaveLength(0);
  } finally {
    await db.query("update public.agent_beta_steps set open = false where step = 'jobs'");
    await db.end();
    await cleanupFixtureUser(memberId);
  }
});
