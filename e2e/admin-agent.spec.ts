import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { cleanupFixtureUser, confirmAdminAuthenticator, fixtureAdmin } from "./fixtures";

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase().replaceAll("=", "")]
    .map((character) => alphabet.indexOf(character).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return ((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}

// The agent's admin controls (plan: "admin controls"): an admin opens and
// closes a beta step and sets the spend caps, each audited; opens one
// member's agent page; and finds that member's chat refused without a case
// about them, then opened (and audited) for a report that is.
test("admin runs the agent's controls, each change audited", async ({ page }) => {
  test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Admin fixtures are restricted to the isolated local stack");
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);

  const admin = fixtureAdmin();
  const stamp = randomUUID();
  const tag = stamp.replaceAll("-", "").slice(0, 10);
  const password = `AgentAdmin-${randomUUID()}!`;
  const actor = await admin.auth.admin.createUser({ email: `e2e-agent-admin-${stamp}@drvn.test`, password, email_confirm: true });
  if (actor.error || !actor.data.user) throw actor.error ?? new Error("Missing agent admin fixture");
  const member = await admin.auth.admin.createUser({ email: `e2e-agent-member-${stamp}@drvn.test`, password, email_confirm: true });
  if (member.error || !member.data.user) throw member.error ?? new Error("Missing member fixture");
  const actorId = actor.data.user.id;
  const memberId = member.data.user.id;
  let reportId: string | undefined;

  try {
    await admin.from("profiles").update({ username: `agentadm${tag}` }).eq("id", actorId);
    await admin.from("profiles").update({ username: `agentmem${tag}` }).eq("id", memberId);
    const granted = await admin.from("admin_users").insert({ user_id: actorId, role: "admin" });
    if (granted.error) throw granted.error;
    const report = await admin.from("reports").insert({ reporter_id: actorId, subject_type: "user", subject_id: memberId, reason: "other", detail: "e2e" }).select("id").single();
    if (report.error) throw report.error;
    const caseId: string = report.data.id;
    reportId = caseId;

    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(actor.data.user.email!);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);
    await page.goto("/admin/agent");
    await expect(page).toHaveURL(/\/admin-verify/);
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    const secret = page.locator("code");
    await expect(secret).toBeVisible();
    await page.getByLabel("Authenticator code").fill(totp((await secret.textContent())!));
    await page.getByRole("button", { name: /verify/i }).click();
    await confirmAdminAuthenticator(page, admin, actorId, "/admin/agent");
    await expect(page).toHaveURL(/\/admin\/agent$/);

    // A beta step: "jobs" is one no member surface reads yet.
    const steps = page.getByRole("region", { name: "Beta steps" });
    const jobs = steps.locator(".order").filter({ hasText: "A3d · More jobs" });
    await jobs.getByLabel("Reason").fill(`e2e open ${stamp}`);
    await jobs.getByRole("button", { name: "Open" }).click();
    await expect(jobs).toContainText("open", { timeout: 15_000 });
    await expect.poll(async () => (await admin.from("agent_beta_steps").select("open").eq("step", "jobs").single()).data?.open).toBe(true);
    await jobs.getByLabel("Reason").fill(`e2e close ${stamp}`);
    await jobs.getByRole("button", { name: "Close" }).click();
    await expect.poll(async () => (await admin.from("agent_beta_steps").select("open").eq("step", "jobs").single()).data?.open).toBe(false);
    const stepAudit = await admin.from("admin_audit_log").select("action").eq("actor_id", actorId).like("action", "agent.beta_%").order("created_at");
    expect(stepAudit.data?.map((row) => row.action)).toEqual(["agent.beta_open", "agent.beta_close"]);

    // The spend caps.
    const spend = page.getByRole("region", { name: "Model spend" });
    await spend.getByLabel("Per member, $").fill("3");
    await spend.getByLabel("Everyone, $").fill("60");
    await spend.getByLabel("Reason").fill(`e2e caps ${stamp}`);
    await spend.getByRole("button", { name: "Save caps" }).click();
    await expect.poll(async () => (await admin.from("agent_spend_limits").select("per_member_daily_usd, global_daily_usd").single()).data).toEqual({ per_member_daily_usd: 3, global_daily_usd: 60 });
    await page.screenshot({ path: "test-results/design/admin-agent-1440.png", fullPage: true });

    // One member's agent, and the chat gate.
    await page.goto(`/admin/agent/members/${memberId}`);
    await expect(page.getByText("No agent limits set.")).toBeVisible();
    const chat = page.getByRole("region", { name: "Chat" });
    await chat.getByLabel("Case id").fill(randomUUID());
    await chat.getByLabel("Reason").fill(`e2e wrong case ${stamp}`);
    await chat.getByRole("button", { name: "Open the chat" }).click();
    await expect(chat.getByText("No such case for this member.")).toBeVisible();
    await chat.getByLabel("Case id").fill(caseId);
    await chat.getByLabel("Reason").fill(`e2e report ${stamp}`);
    await chat.getByRole("button", { name: "Open the chat" }).click();
    await expect(chat.getByText(/Opened and audited/)).toBeVisible();
    const opened = await admin.from("admin_audit_log").select("action, subject_id, metadata").eq("actor_id", actorId).eq("action", "agent.chat_opened").single();
    expect(opened.data).toMatchObject({ subject_id: memberId, metadata: { case_kind: "report", case_id: caseId } });
  } finally {
    await admin.from("agent_spend_limits").update({ per_member_daily_usd: 2, global_daily_usd: 50 }).eq("singleton", true);
    if (reportId) await admin.from("reports").delete().eq("id", reportId);
    await cleanupFixtureUser(memberId);
    await cleanupFixtureUser(actorId);
  }
});
