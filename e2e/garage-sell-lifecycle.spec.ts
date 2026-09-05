import { expect, test } from "@playwright/test";

import { addCar, cleanupE2eUsers, enableSellerPayouts, makeUser, signUp } from "./helpers";

/**
 * Phase 6 authed flows, end to end against a real server + Supabase:
 *
 * 1. The garage activity composer's empty → form → list lifecycle — closed at
 *    rest, live character counter, closes itself on publish, the list gaining
 *    the row as the receipt.
 * 2. The gallery DropZone — uploads through the picker path, rejects
 *    non-image files with a human message instead of the storage bucket's
 *    raw mime error (setInputFiles bypasses accept=, same as drag-and-drop).
 * 3. The sell form's payouts gate — checklist names the blocker up front,
 *    the publish CTA is aria-disabled but still focusable/announced, and the
 *    gate lifts once payouts are enabled.
 */

const stamp = Date.now();
const seller = makeUser("craft", stamp);
const carName = `E2E Craft Car ${stamp}`;

// One user, one car, three dependent tests — strictly in order.
test.describe.configure({ mode: "serial" });

let editPath: string;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signUp(page, seller);
  await addCar(page, carName);
  editPath = new URL(page.url()).pathname;
  await page.close();
});

test.afterAll(async () => {
  await cleanupE2eUsers();
});

async function signInFresh(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(seller.email);
  await page.getByLabel(/^password$/i).fill(seller.password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL(/\/home/);
}

test("build updates: link-only section, composer publishes to the public post", async ({
  page,
}) => {
  await signInFresh(page);
  await page.goto(editPath);

  const section = page.locator("section", { has: page.getByText("Build updates") });

  // At rest: no inline form — one link into the Build Story Composer (§M3),
  // plus the empty hint.
  await expect(section.getByRole("link", { name: /post an update/i })).toBeVisible();
  await expect(section.getByLabel(/^title$/i)).toHaveCount(0);
  await expect(section.getByText(/nothing posted yet/i)).toBeVisible();

  // The link opens the composer for this car.
  await section.getByRole("link", { name: /post an update/i }).click();
  await expect(page).toHaveURL(/\/garage\/[\w-]+\/update\/new/);

  // A one-liner stays a one-liner: title, a sentence, publish.
  const title = page.getByLabel(/^title$/i);
  await title.fill("Downpipe + tune installed");
  const body = page.getByLabel(/update body/i);
  await body.click();
  await page.keyboard.type("Cat-back on, tune flashed — pulls clean to redline.");
  await expect(page.getByRole("button", { name: /^\[?\s*publish\s*\]?$/i })).toBeEnabled();
  await page.getByRole("button", { name: /^\[?\s*publish\s*\]?$/i }).click();

  // Publishing lands on the public post.
  await expect(page).toHaveURL(/\/cars\/[\w-]+\/activity\/[\w-]+/);
  await expect(
    page.getByRole("heading", { name: /downpipe \+ tune installed/i })
  ).toBeVisible();

  // Back on the editor, the section filed the post — exactly once (a racing
  // autosave must not leave a duplicate draft) — and dropped the hint.
  await page.goto(editPath);
  const filed = section.getByRole("link", { name: /downpipe \+ tune installed/i });
  await expect(filed).toHaveCount(1);
  await expect(filed).toBeVisible();
  await expect(section.getByText(/nothing posted yet/i)).toHaveCount(0);
});

test("gallery drop zone: uploads images, refuses non-images with a human message", async ({
  page,
}) => {
  await signInFresh(page);
  await page.goto(editPath);

  const zone = page.getByRole("button", { name: /add the first photos/i });
  await expect(zone).toBeVisible();

  // Tiny valid PNG (1×1) through the picker path.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "wheel.png", mimeType: "image/png", buffer: png });

  // Upload lands: a thumb appears and the zone's copy flips to "more".
  await expect(page.getByRole("button", { name: /add more photos/i })).toBeVisible({
    timeout: 20_000,
  });

  // A non-image bypasses accept= (as drag-and-drop does) and must be refused
  // by the client filter, not the storage bucket.
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
  await expect(page.getByText(/photos only — notes\.txt isn't an image/i)).toBeVisible();
});

test("sell publish: respects the configured payment mode and payout readiness", async ({ page }) => {
  await signInFresh(page);
  await page.goto("/sell");

  if (process.env.PAYMENTS_MODE === "stub") {
    // Stub checkout intentionally does not require a real Connect account.
    await expect(page.getByRole("button", { name: /publish to market/i })).not.toHaveAttribute("aria-disabled", "true");
    await expect(page.locator("#publish-checklist")).not.toContainText(/payouts aren't set up/i);
    return;
  }

  // The blocker is named up front, and the CTA is aria-disabled — present,
  // focusable, described by the checklist — not vanished from the tab order.
  const checklist = page.locator("#publish-checklist");
  await expect(checklist).toContainText(/payouts aren't set up/i);
  const publish = page.getByRole("button", { name: /publish to market/i });
  await expect(publish).toHaveAttribute("aria-disabled", "true");
  await expect(publish).toHaveAttribute("aria-describedby", "publish-checklist");
  await publish.focus();
  await expect(publish).toBeFocused();

  // A gated activation goes nowhere — keyboard Enter on the focused button,
  // which is exactly the interaction a `disabled` button would make impossible.
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/sell/);

  // Flip payouts (what Connect onboarding earns) and the gate lifts.
  await enableSellerPayouts(seller.username);
  await page.reload();
  await expect(page.getByRole("button", { name: /publish to market/i })).not.toHaveAttribute(
    "aria-disabled",
    "true"
  );
  await expect(page.locator("#publish-checklist")).not.toContainText(/payouts aren't set up/i);
});
