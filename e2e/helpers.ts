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
  await page.getByRole("button", { name: /sign up|create account/i }).click();

  // With email confirmation off, signup lands on onboarding.
  await page.waitForURL(/\/onboarding/);
  await page.getByLabel(/handle|username/i).fill(user.username);
  await page.getByLabel(/display name|keeper name/i).fill(user.displayName);
  await page.getByRole("button", { name: /continue|finish|save|let.s go/i }).click();
  await page.waitForURL(/\/home/);
}

export async function signIn(page: Page, user: TestUser) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/^password$/i).fill(user.password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL(/\/home/);
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
  }
): Promise<string> {
  await page.goto("/sell");
  await page.getByLabel(/title/i).fill(opts.title);
  await page.getByLabel(/^category/i).selectOption({ index: 1 });
  if (opts.partNumber) await page.getByLabel(/part number/i).fill(opts.partNumber);
  await page.getByLabel(/asking price/i).fill(opts.price);
  if (opts.shipping !== undefined) {
    await page.locator('input[name="shipping"]').fill(opts.shipping);
  }
  if (opts.sourceCarLabel) {
    await page.locator('select[name="source_car_id"]').selectOption({ label: opts.sourceCarLabel });
  }
  await page.getByRole("button", { name: /publish/i }).click();
  await expect(page).toHaveURL(/\/listings\/[\w-]+/);
  return new URL(page.url()).pathname;
}

/**
 * Marks a test seller as payable. The dev server runs in Stripe mode, where
 * publishing a listing is gated on `profiles.payouts_enabled` — real accounts
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

/**
 * Deletes every e2e-*@drvn.test auth user. Same contract as golden-path's
 * afterAll: needs the service key, and skips loudly when it's absent so local
 * runs still report test results.
 */
export async function cleanupE2eUsers() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("[e2e] cleanup skipped: no service key configured — test users were NOT removed");
    return;
  }
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data } = await admin.auth.admin.listUsers();
  for (const user of data?.users ?? []) {
    if (user.email && ownedEmails.has(user.email)) {
      await admin.auth.admin.deleteUser(user.id);
    }
  }
}
