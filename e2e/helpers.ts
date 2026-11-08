import { expect, type Page } from "@playwright/test";

/**
 * Shared account/listing plumbing for the regression specs, mirroring the
 * conventions of golden-path.spec.ts (signup form, onboarding, /sell flow).
 * Kept separate so golden-path stays exactly as it is.
 */

const ownedEmails = new Set<string>();

export type TestUser = {
  email: string;
  password: string;
  username: string;
  displayName: string;
};

/** Throwaway user. Emails follow the e2e-*@drvn.test pattern the cleanup sweep looks for. */
export function makeUser(role: string, stamp: number): TestUser {
  return {
    email: `e2e-${role}-${stamp}@drvn.test`,
    password: "e2e-password-123",
    username: `e2e${role.replace(/[^a-z0-9]/gi, "")}${stamp}`.slice(0, 24),
    displayName: `E2E ${role}`,
  };
}

export async function signUp(page: Page, user: TestUser) {
  ownedEmails.add(user.email);
  await page.goto("/signup");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/^password$/i).fill(user.password);
  // R69-age: sign-up asks for the 18+ confirmation (and onboarding then doesn't).
  await page.getByLabel(/18 or over/i).check();
  await page.getByRole("button", { name: /sign up|create account/i }).click();

  // With email confirmation off, signup lands on onboarding.
  await page.waitForURL(/\/onboarding/);
  await page.getByLabel(/handle|username/i).fill(user.username);
  await page.getByLabel(/display name|keeper name/i).fill(user.displayName);
  // Onboarding's primary is now "Next: add your car"; "Skip — just browsing"
  // saves the same profile and lands on /home.
  await page.getByRole("button", { name: /continue|finish|save|let.s go|just browsing/i }).click();
  await page.waitForURL(/\/home/);
}

export async function signIn(page: Page, user: TestUser) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/^password$/i).fill(user.password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL(/\/home/);
}

/**
 * Records Server Action redirects that escaped to `window`. The router has
 * already followed an action's redirect when the action's promise rejects
 * with it; caught and rethrown outside a transition, the same error becomes
 * an unhandled rejection and Next follows it a second time, mid-navigation
 * (on Next 16.2 that left the page stuck). Chromium reports nothing, because
 * Next marks the event handled — so listen for it before Next does.
 */
export async function watchEscapedRedirects(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const escaped: string[] = [];
    (window as unknown as { __escapedRedirects: string[] }).__escapedRedirects = escaped;
    const record = (reason: unknown) => {
      const digest = (reason as { digest?: unknown } | null)?.digest;
      if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) escaped.push(digest);
    };
    window.addEventListener("unhandledrejection", (event) => record(event.reason));
    window.addEventListener("error", (event) => record(event.error));
  });
  return () =>
    page.evaluate(() => (window as unknown as { __escapedRedirects?: string[] }).__escapedRedirects ?? []);
}

/** Adds a car through the garage dialog. Leaves the page on the car's edit view. */
export async function addCar(page: Page, carName: string) {
  await page.goto("/garage");
  await page.getByRole("button", { name: /add a car|add car/i }).first().click();
  const dialog = page.getByRole("dialog");
  // The picker is the primary flow (0041); tests name their cars, so take the
  // manual fallback — always visible at the dialog's foot.
  await dialog.getByRole("button", { name: /enter it manually/i }).last().click();
  await dialog.getByLabel(/^name/i).first().fill(carName);
  await dialog.getByRole("button", { name: /add to garage/i }).click();
  await expect(page).toHaveURL(/\/garage\/[\w-]+\/edit/);
}

/**
 * Attaches one photo through /sell's own uploader and waits for it to land.
 *
 * Publishing needs a photo (M-5/W-2, sell/actions.ts PHOTO_REQUIRED); drafts
 * don't. The upload goes through the real path — never seed an image URL.
 */
export async function attachSellPhoto(page: Page) {
  await page.locator('#sell-photos input[type="file"]').setInputFiles({
    name: "part.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    ),
  });
  // The drop zone retitles itself once the form holds an uploaded URL.
  await expect(page.getByRole("button", { name: /add more photos/i })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * /sell's commit button. The form renders the same button twice — in its
 * in-flow footer (`.saverow`) and, below 981px, in the pinned MobileActionBar —
 * so at phone widths an unscoped /publish/i matches both. Target the in-flow
 * one, which exists at every width.
 */
export function sellCommitButton(page: Page) {
  return page.locator(".saverow").getByRole("button", { name: /publish/i });
}

/**
 * Publishes a listing via /sell and returns its /listings/<id> path.
 * `shipping` and `price` are dollar strings, as typed into the form.
 */
export async function publishListing(
  page: Page,
  opts: {
    title: string;
    price: string;
    shipping?: string;
    partNumber?: string;
    /** Full option label, e.g. `Off my sheet — My Car` */
    sourceCarLabel?: string;
    /** DRVN Shipping (integrated labels) with a packed size, instead of a flat rate. */
    drvn?: boolean;
    /** Also offer local pickup. */
    pickup?: boolean;
  }
): Promise<string> {
  await page.goto("/sell");
  await page.getByLabel(/title/i).fill(opts.title);
  await page.getByLabel(/^category/i).selectOption({ index: 1 });
  if (opts.partNumber) await page.getByLabel(/part number/i).fill(opts.partNumber);
  await page.getByLabel(/asking price/i).fill(opts.price);
  if (opts.drvn) {
    await page.getByLabel(/how it ships/i).selectOption("drvn");
    await page.getByLabel(/packed weight/i).fill("32");
    await page.getByLabel(/length \(in\)/i).fill("14");
    await page.getByLabel(/width \(in\)/i).fill("10");
    await page.getByLabel(/height \(in\)/i).fill("8");
  } else if (opts.shipping !== undefined) {
    await page.locator('input[name="shipping"]').fill(opts.shipping);
  }
  if (opts.pickup) {
    await page.locator('input[name="allows_collection"]').check();
  }
  if (opts.sourceCarLabel) {
    await page.locator('select[name="source_car_id"]').selectOption({ label: opts.sourceCarLabel });
  }
  await attachSellPhoto(page);
  await sellCommitButton(page).click();
  await expect(page).toHaveURL(/\/listings\/[\w-]+/, { timeout: 20_000 });
  return new URL(page.url()).pathname;
}

/**
 * Marks a test seller as payable. The dev server runs in Stripe mode, where
 * publishing a listing is gated on payout setup (`profiles.payouts_enabled`, or details submitted, 20261108100000) — real accounts
 * earn it through Connect onboarding; test accounts get it flipped directly
 * with the service role. Keyed by username (unique, set during onboarding).
 */
export async function enableSellerPayouts(username: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "enableSellerPayouts needs NEXT_PUBLIC_SUPABASE_URL and a service key " +
        "(SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY) — publishing is gated " +
        "on payouts when the app runs in Stripe mode."
    );
  }
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await admin
    .from("profiles")
    .update({ payouts_enabled: true })
    .eq("username", username)
    .select("id");
  if (error) throw new Error(`enableSellerPayouts failed: ${error.message}`);
  if (!data?.length) throw new Error(`enableSellerPayouts: no profile with username ${username}`);
}

/** Deletes only accounts registered by this suite, across all Auth pages. */
export async function cleanupE2eUsers() {
  const { fixtureAdmin, cleanupFixtureUser } = await import("./fixtures");
  const admin = fixtureAdmin();
  const users: { id: string; email?: string }[] = [];
  for (let page = 1; ; page++) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw result.error;
    users.push(...result.data.users.filter(user => user.email && ownedEmails.has(user.email)));
    if (result.data.users.length < 100) break;
  }
  for (const user of users) {
    await cleanupFixtureUser(user.id);
    if (user.email) ownedEmails.delete(user.email);
  }
}

/**
 * Puts one photo on the post open in the Build Story Composer.
 *
 * W-2 (2026-09): every NEW publish needs a photo, so a spec that publishes
 * has to attach one. The insert menu is used rather than the empty-composer
 * starter chips, because by the time a spec has typed a body the chips are
 * gone.
 */
export async function addComposerPhoto(page: Page) {
  await page.getByRole("button", { name: "+ Add something" }).click();
  // The menu commits on pointerdown (it preventDefaults so the editor keeps
  // its selection), and a real click lands on the popover instead.
  await page.getByRole("menuitem", { name: "Photos" }).dispatchEvent("pointerdown");
  await page.locator('input[type="file"]').last().setInputFiles({
    name: "update.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    ),
  });
  // The queue uploads before the block holds a URL; the figure stops saying
  // "Uploading…" when it has one.
  await expect(page.getByText("Uploading…")).toHaveCount(0, { timeout: 30_000 });
}
