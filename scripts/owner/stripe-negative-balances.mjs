#!/usr/bin/env node
/**
 * Makes sure Stripe may take a seller's negative balance from their bank.
 *
 * DRVN pays a seller soon after delivery (supabase/migrations/
 * 20261009100000_payout_release_risk_controls.sql), so a refund can come
 * after the seller has been paid. DRVN then reverses the transfer; if the
 * seller's Stripe balance can't cover it, the balance goes negative, and on
 * Express accounts the platform is liable for what Stripe can't recover.
 * With settings.payouts.debit_negative_balances on, Stripe tries the seller's
 * payout bank account first.
 *
 * New accounts get it at creation (src/lib/payments/connect.ts). Express
 * accounts already default to it; this script finds any connected account
 * where it is off and turns it on.
 *
 * Usage (from the repo root):
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/owner/stripe-negative-balances.mjs
 *   ... --apply   make the changes (default is a dry run)
 *   ... --live    allow an sk_live_/rk_live_ key (and require one)
 *
 * The key is read from the environment only, never from argv. Idempotent:
 * an account already on is left alone.
 */
import { fileURLToPath } from "node:url";

import { checkKey } from "./stripe-webhooks.mjs";

export function parseArgs(argv) {
  const options = { apply: false, live: false, help: false };
  for (const arg of argv) {
    if (arg === "--apply") options.apply = true;
    else if (arg === "--live") options.live = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

/**
 * Pure planning step over the connected accounts Stripe lists. An account
 * with the setting off is updated; one that doesn't report it is listed for
 * a manual look rather than guessed at.
 */
export function planAccounts(accounts) {
  const update = [];
  const unknown = [];
  let alreadyOn = 0;
  for (const account of accounts) {
    const value = account.settings?.payouts?.debit_negative_balances;
    if (value === true) alreadyOn += 1;
    else if (value === false) update.push(account.id);
    else unknown.push(account.id);
  }
  return { update, unknown, alreadyOn };
}

export function describePlan({ update, unknown, alreadyOn }, { apply }) {
  const lines = [`${alreadyOn} connected account(s) already let Stripe debit a negative balance.`];
  if (update.length) {
    lines.push(`${apply ? "Turning on" : "Would turn on"} debit_negative_balances for ${update.length}:`);
    for (const id of update) lines.push(`  ${id}`);
  } else {
    lines.push("Nothing to change.");
  }
  if (unknown.length) {
    lines.push(`${unknown.length} account(s) didn't report the setting; check them in the Dashboard:`);
    for (const id of unknown) lines.push(`  ${id}`);
  }
  return lines.join("\n");
}

const HELP = "Usage: STRIPE_SECRET_KEY=sk_test_... node scripts/owner/stripe-negative-balances.mjs [--apply] [--live]";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key) throw new Error("STRIPE_SECRET_KEY is required to list connected accounts");
  const { mode } = checkKey(key, options);

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(key, { timeout: 20_000, maxNetworkRetries: 2 });
  console.log(`Stripe ${mode} mode${options.apply ? "" : " · DRY RUN"}`);

  const accounts = [];
  for await (const account of stripe.accounts.list({ limit: 100 })) accounts.push(account);
  const plan = planAccounts(accounts);
  console.log(describePlan(plan, options));
  if (!options.apply) {
    if (plan.update.length) console.log("\nDry run: nothing changed. Re-run with --apply to make these changes.");
    return;
  }
  for (const id of plan.update) {
    await stripe.accounts.update(id, { settings: { payouts: { debit_negative_balances: true } } });
    console.log(`updated ${id}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  });
}
