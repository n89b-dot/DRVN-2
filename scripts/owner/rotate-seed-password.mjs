#!/usr/bin/env node
/**
 * Sets a new shared password on the dev seed accounts (kaito@drvn.test and
 * the others the .seed-*.mjs scripts create). The old password is in git
 * history, so anyone with the repo can sign in as them until it changes.
 *
 * Usage (from the repo root, which holds .env.local):
 *   node scripts/owner/rotate-seed-password.mjs            dry run: finds the accounts
 *   node scripts/owner/rotate-seed-password.mjs --apply    sets the new password
 *   ... --project <ref>   required for any project other than the dev project
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or the legacy
 * SUPABASE_SERVICE_ROLE_KEY) from .env.local, and DRVN_SEED_PASSWORD from the
 * shell or .env.local. Never prints a password or a key.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The shared dev project. Any other project needs an explicit --project. */
export const DEV_PROJECT_REF = "grunnjojhdevhuckujmc";

/**
 * Every address the committed seed scripts sign in with. The test checks this
 * list against the .seed-*.mjs files so a new seed account isn't missed.
 */
export const SEED_EMAILS = Object.freeze([
  "dario@drvn.test",
  "felix@drvn.test",
  "imani@drvn.test",
  "jade@drvn.test",
  "kaito@drvn.test",
  "lena@drvn.test",
  "marcus@drvn.test",
  "marisol@drvn.test",
  "ryo@drvn.test",
  "tommy@drvn.test",
]);

export const MIN_PASSWORD_LENGTH = 16;

export function parseEnvFile(text) {
  return Object.fromEntries(
    text
      .split("\n")
      .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      })
  );
}

export function parseArgs(argv) {
  const options = { apply: false, project: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--project") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--project needs a project ref");
      options.project = value;
    } else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

/** `<ref>.supabase.co` → ref; a local stack → "local". */
export function projectRefFromUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing or not a URL");
  }
  if (["127.0.0.1", "localhost"].includes(url.hostname)) return "local";
  const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  if (!match) throw new Error(`Can't read a project ref from ${url.hostname}`);
  return match[1];
}

/**
 * The dev project runs without a flag. Anything else must be named with
 * --project, and the name must match what .env.local points at.
 */
export function checkTarget(ref, requested) {
  if (requested && requested !== ref) {
    throw new Error(`--project ${requested} does not match .env.local, which points at ${ref}`);
  }
  if (ref !== DEV_PROJECT_REF && !requested) {
    throw new Error(`.env.local points at ${ref}, not the dev project ${DEV_PROJECT_REF}. Pass --project ${ref} if that is really the target.`);
  }
  return ref;
}

export function checkPassword(password) {
  if (!password) throw new Error("Set DRVN_SEED_PASSWORD (shell or .env.local) to the new password. Generate one: openssl rand -base64 24");
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`DRVN_SEED_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
}

/** Splits lookup rows into found accounts and missing addresses. */
export function matchAccounts(rows, emails = SEED_EMAILS) {
  const byEmail = new Map(rows.map((row) => [row.email.toLowerCase(), row.user_id]));
  return {
    found: emails.filter((email) => byEmail.has(email)).map((email) => ({ email, id: byEmail.get(email) })),
    missing: emails.filter((email) => !byEmail.has(email)),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/owner/rotate-seed-password.mjs [--apply] [--project <ref>]");
    return;
  }
  if (!existsSync(".env.local")) throw new Error("Run from the repo root; .env.local not found");
  const env = parseEnvFile(readFileSync(".env.local", "utf8"));
  const ref = checkTarget(projectRefFromUrl(env.NEXT_PUBLIC_SUPABASE_URL), options.project);
  const serviceKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("SUPABASE_SECRET_KEY is not set in .env.local");
  const password = process.env.DRVN_SEED_PASSWORD ?? env.DRVN_SEED_PASSWORD;
  if (options.apply) checkPassword(password);

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Project ${ref}${options.apply ? "" : " · DRY RUN"}`);
  // account_emails (0036) is the service-role-only email → account index.
  const { data, error } = await admin.from("account_emails").select("email,user_id").in("email", [...SEED_EMAILS]);
  if (error) throw new Error(`Account lookup failed: ${error.code ?? error.message}`);
  const { found, missing } = matchAccounts(data ?? []);
  for (const account of found) console.log(`  found   ${account.email}`);
  for (const email of missing) console.log(`  absent  ${email} (never seeded here; nothing to rotate)`);

  if (!options.apply) {
    if (!password) console.log("\nDRVN_SEED_PASSWORD is not set yet. Set it before --apply.");
    else checkPassword(password);
    console.log(`\nDry run: ${found.length} account(s) would get the password in DRVN_SEED_PASSWORD. Re-run with --apply.`);
    return;
  }

  let failed = 0;
  for (const account of found) {
    const { error: updateError } = await admin.auth.admin.updateUserById(account.id, { password });
    if (updateError) {
      failed++;
      console.log(`  FAILED  ${account.email}: ${updateError.code ?? updateError.status ?? "error"}`);
    } else {
      console.log(`  updated ${account.email}`);
    }
  }
  console.log(`\n${found.length - failed} updated, ${failed} failed. Store the new password in the password manager entry for DRVN dev.`);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  });
}
