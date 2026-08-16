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
  await page.getByLabel(/password/i).fill(seller.password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL(/\/home/);
}

test("activity composer: closed at rest, counted title, closes on publish", async ({ page }) => {
  await signInFresh(page);
  await page.goto(editPath);

  const section = page.locator("section", { has: page.getByText("Build updates") });

  // At rest: invitation button, no form, empty hint.
  await expect(section.getByRole("button", { name: /post an update/i })).toBeVisible();
  await expect(section.getByLabel(/^title$/i)).toHaveCount(0);
  await expect(section.getByText(/nothing posted yet/i)).toBeVisible();

  // Open: title focused, counter live.
  await section.getByRole("button", { name: /post an update/i }).click();
  const title = section.getByLabel(/^title$/i);
  await expect(title).toBeFocused();
  await expect(section.getByText("0 of 160")).toBeVisible();
  await title.fill("Coilovers fitted");
  await expect(section.getByText(`${"Coilovers fitted".length} of 160`)).toBeVisible();

  // Cancel collapses without residue, reopen is pristine.
  await section.getByRole("button", { name: /cancel/i }).click();
  await expect(section.getByLabel(/^title$/i)).toHaveCount(0);
  await section.getByRole("button", { name: /post an update/i }).click();
  await expect(section.getByText("0 of 160")).toBeVisible();

  // Publish: the composer closes itself; the list gaining the row is the receipt.
  await section.getByLabel(/^title$/i).fill("Downpipe + tune installed");
  await section.getByRole("button", { name: /publish update/i }).click();
  await expect(section.getByLabel(/^title$/i)).toHaveCount(0);
  await expect(section.getByRole("link", { name: /downpipe \+ tune installed/i })).toBeVisible();
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

test("sell publish: gated with an announced checklist until payouts enable", async ({ page }) => {
  await signInFresh(page);
  await page.goto("/sell");

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
