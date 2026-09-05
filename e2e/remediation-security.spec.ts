import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { assertAccessible } from "./accessibility";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = () => createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
async function fixture() {
  const email = `e2e-remediation-${randomUUID()}@drvn.test`;
  const password = `Test-${randomUUID()}!`;
  const client = admin();
  const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error || new Error("Missing test user");
  const profile = await client.from("profiles").update({ username: `test${randomUUID().replaceAll("-", "").slice(0, 18)}` }).eq("id", data.user.id);
  if (profile.error) throw profile.error;
  return { client, email, password, id: data.user.id };
}
function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase().replaceAll("=", "")].map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return ((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}

test("admin access requires TOTP and respects membership revocation", async ({ page }) => {
  const user = await fixture();
  const operator = await fixture();
  try {
    const operatorGrant = await operator.client.from("admin_users").insert({ user_id: operator.id }); if (operatorGrant.error) throw operatorGrant.error;
    const grant = await user.client.from("admin_users").insert({ user_id: user.id }); if (grant.error) throw grant.error;
    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(user.email);
    await page.getByLabel(/^password$/i).fill(user.password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin-verify/);
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    const key = page.locator("code"); await expect(key).toBeVisible();
    await page.getByLabel("Authenticator code").fill(totp((await key.textContent())!));
    await page.getByRole("button", { name: /Verify/ }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await assertAccessible(page, "admin overview");
    await page.goto("/admin/invitations");
    await expect(page.locator("main")).toBeVisible();
    await assertAccessible(page, "admin invitations");
    await page.goto("/docs/components");
    const opener = page.getByRole("button", { name: "Open nested dialog example" });
    await opener.focus(); await page.keyboard.press("Enter");
    const outer = page.getByRole("dialog", { name: "Outer example", exact: true }); await expect(outer).toBeVisible();
    await page.keyboard.press("Tab");
    const innerOpener = page.getByRole("button", { name: "Open inner example" }); await expect(innerOpener).toBeFocused();
    await page.keyboard.press("Enter");
    const inner = page.getByRole("dialog", { name: "Inner example", exact: true }); await expect(inner).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    expect(await inner.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape"); await expect(inner).not.toBeVisible(); await expect(outer).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden"); await expect(innerOpener).toBeFocused();
    await page.keyboard.press("Escape"); await expect(outer).not.toBeVisible(); await expect(opener).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
    await page.goto("/admin");

    // Technical lost-factor recovery: a separate synthetic operator revokes
    // old admin tokens before removing the lost factor and requiring reenrollment.
    const recovery = await operator.client.rpc("begin_admin_mfa_recovery", { p_actor: operator.id, p_target: user.id, p_reason: "Disposable recovery drill; synthetic identity verified" });
    if (recovery.error) throw recovery.error;
    expect((await page.goto("/admin"))?.status()).toBe(404);
    const factors = await user.client.auth.admin.mfa.listFactors({ userId: user.id }); if (factors.error) throw factors.error;
    for (const factor of factors.data.factors) {
      const removed = await user.client.auth.admin.mfa.deleteFactor({ userId: user.id, id: factor.id }); if (removed.error) throw removed.error;
    }
    const epoch = await user.client.from("admin_users").select("sessions_valid_after").eq("user_id", user.id).single(); if (epoch.error) throw epoch.error;
    // JWT iat is measured in whole seconds; the recovered login must be newer.
    await expect.poll(() => Math.floor(Date.now() / 1000) > Date.parse(epoch.data.sessions_valid_after) / 1000).toBe(true);
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(user.email); await page.getByLabel(/^password$/i).fill(user.password);
    await page.getByRole("button", { name: /log in|sign in/i }).click(); await page.waitForURL(/\/home/);
    await page.goto("/admin"); await expect(page).toHaveURL(/\/admin-verify/);
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    await expect(key).toBeVisible(); await page.getByLabel("Authenticator code").fill(totp((await key.textContent())!));
    await page.getByRole("button", { name: /Verify/ }).click(); await expect(page).toHaveURL(/\/admin$/);
    const journal = await operator.client.from("admin_audit_log").insert({ actor_id: operator.id, action: "admin.mfa_recovery", subject_type: "user", subject_id: user.id, reason: "Synthetic factor reenrolled and stale admin token rejected", metadata: { operationId: recovery.data, phase: "completed" } }); if (journal.error) throw journal.error;
    const revoked = await user.client.from("admin_users").delete().eq("user_id", user.id); if (revoked.error) throw revoked.error;
    expect((await page.goto("/admin"))?.status()).toBe(404);
  } finally {
    const removed = await user.client.auth.admin.deleteUser(user.id); if (removed.error) throw removed.error;
    // Immutable audit rows intentionally retain their actor. Remove all access
    // rather than silently ignoring the audit foreign key during fixture cleanup.
    const membership = await operator.client.from("admin_users").delete().eq("user_id", operator.id); if (membership.error) throw membership.error;
    const banned = await operator.client.auth.admin.updateUserById(operator.id, { ban_duration: "876000h" }); if (banned.error) throw banned.error;
    const scrubbed = await operator.client.from("profiles").update({ username: null, display_name: "Retained test audit actor" }).eq("id", operator.id); if (scrubbed.error) throw scrubbed.error;
    const jobs = await operator.client.from("remediation_jobs").delete().eq("kind", "search").in("payload->>id", [user.id, operator.id]); if (jobs.error) throw jobs.error;
  }
});

test("captured email link signs in a fresh browser and cannot be reused", async ({ page, request }) => {
  test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Captured mailbox belongs to the isolated local environment");
  const user = await fixture();
  try {
    const receiptKey = `access:${user.id}:/orders`;
    const queued = await user.client.rpc("enqueue_order_receipt", { p_buyer: user.id, p_destination: "/orders" });
    if (queued.error) throw queued.error;
    // Prioritize only this fixture; other suites may leave unrelated queued mail.
    const due = await user.client.from("remediation_jobs").update({ next_attempt_at: "2000-01-01T00:00:00Z" }).eq("dedup_key", receiptKey);
    if (due.error) throw due.error;
    const worker = await request.post("/api/jobs/transfers", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect([200, 503]).toContain(worker.status());
    const receipt = await user.client.from("remediation_jobs").select("status").eq("dedup_key", receiptKey).single();
    expect(receipt.error).toBeNull();
    expect(receipt.data?.status).toBe("completed");
    let messageId: string | undefined;
    await expect.poll(async () => {
      const inbox = await (await request.get("http://127.0.0.1:54324/api/v1/messages")).json();
      messageId = inbox.messages.find((m: { To: { Address: string }[] }) => m.To.some((recipient) => recipient.Address === user.email))?.ID;
      return Boolean(messageId);
    }).toBe(true);
    const message = await (await request.get(`http://127.0.0.1:54324/api/v1/message/${messageId}`)).json();
    const link = String(message.HTML).match(/href="([^"]+)"/)?.[1].replaceAll("&amp;", "&");
    expect(link).toContain("/confirm?token_hash=");
    await page.context().clearCookies();
    // Mail scanners may GET the link repeatedly without consuming it.
    expect((await request.get(link!)).status()).toBe(200);
    expect((await request.head(link!)).status()).toBe(200);
    await page.goto(link!);
    await page.getByRole("button", { name: "Continue to orders" }).click();
    await expect(page).toHaveURL(/\/orders$/);
    const token = new URL(link!).searchParams.get("token_hash")!;
    const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL!).origin;
    const crossOrigin = await request.post(`${origin}/confirm`, { headers: { origin: "https://invalid.example" }, form: { token_hash: token }, maxRedirects: 0 });
    expect(crossOrigin.status()).toBe(403);
    const reused = await request.post(`${origin}/confirm`, { headers: { origin }, form: { token_hash: token }, maxRedirects: 0 });
    expect(reused.headers().location).toContain("auth-error");
  } finally {
    await user.client.from("remediation_jobs").delete().eq("dedup_key", `access:${user.id}:/orders`);
    await user.client.auth.admin.deleteUser(user.id);
  }
});

test("account deletion drains more than one storage page and rejects stale writes", async ({ request }) => {
  test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Destructive fixtures require the local sandbox");
  test.setTimeout(120000);
  const user = await fixture();
  try {
    const { default: sharp } = await import("sharp");
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } }).webp().toBuffer();
    for (let start = 0; start < 105; start += 10) {
      await Promise.all(Array.from({ length: Math.min(10, 105 - start) }, async (_, offset) => {
        const upload = await user.client.storage.from("car-images").upload(`${user.id}/nested/photos/${start + offset}.webp`, bytes, { contentType: "image/webp" });
        if (upload.error) throw upload.error;
      }));
    }
    const member = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
    const signedIn = await member.auth.signInWithPassword({ email: user.email, password: user.password }); if (signedIn.error) throw signedIn.error;
    const queued = await member.rpc("request_account_deletion"); if (queued.error) throw queued.error;
    const stale = await member.from("profiles").update({ display_name: "should fail" }).eq("id", user.id);
    expect(stale.error?.code).toBe("42501");
    await expect.poll(async () => {
      const run = await request.post("/api/jobs/account-deletions", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
      expect(run.status()).toBe(200);
      return (await user.client.auth.admin.getUserById(user.id)).data.user === null;
    }, { timeout: 60000 }).toBe(true);
    const remaining = await user.client.storage.from("car-images").list(`${user.id}/nested/photos`, { limit: 1000 });
    expect(remaining.error).toBeNull(); expect(remaining.data).toHaveLength(0);
    const account = await user.client.auth.admin.getUserById(user.id); expect(account.data.user).toBeNull();
  } finally { await user.client.auth.admin.deleteUser(user.id); }
});

test("page CSP uses fresh nonces and blocks untrusted inline scripts", async ({ page }) => {
  // Inject into parsed HTML: CDP evaluate itself is privileged and is not an XSS simulation.
  await page.route("**/login", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace("</head>", "<script>window.__drvnUntrustedScript = true</script></head>");
    await route.fulfill({ response, body });
  });
  const first = await page.goto("/login");
  const policy = first?.headers()["content-security-policy"] || "";
  const scriptPolicy = policy.split(";").find((part) => part.trim().startsWith("script-src")) || "";
  expect(scriptPolicy).toContain("'nonce-");
  expect(scriptPolicy).not.toContain("'unsafe-inline'");
  expect(scriptPolicy).not.toContain("'unsafe-eval'");
  const firstNonce = await page.locator("script").first().evaluate((script) => (script as HTMLScriptElement).nonce);
  expect(firstNonce).toBeTruthy();
  expect(scriptPolicy).toContain(`'nonce-${firstNonce}'`);
  expect(await page.evaluate(() => "__drvnUntrustedScript" in window)).toBe(false);
  const second = await page.reload();
  expect(second?.headers()["content-security-policy"]).not.toBe(policy);
  await expect(page.getByRole("button", { name: /log in|sign in/i })).toBeVisible();
});
