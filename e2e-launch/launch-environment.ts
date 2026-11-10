// Plan 2 item A4 (review finding #162, OS id R-unproven): the environment the
// launch-configuration browser lane builds and serves the app with.
//
// It is the recorded launch configuration
// (docs/release-evidence/launch-configuration.json): every variable the record
// says is absent is removed, whatever the shell or .env.test.local set, and
// every variable it says is present is supplied. The only values that differ
// from a real launch are the ones a loopback test stack cannot have: test
// Stripe keys in place of live ones, throwaway webhook secrets, placeholder
// monitoring endpoints, and the cache switched on explicitly because the
// isolated stack otherwise switches it off.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type LaunchRecord = { variables: Record<string, null | "present"> };
type Env = Record<string, string | undefined>;

export function readLaunchRecord(root: string): LaunchRecord {
  return JSON.parse(fs.readFileSync(path.join(root, "docs/release-evidence/launch-configuration.json"), "utf8")) as LaunchRecord;
}

const secret = () => randomBytes(32).toString("hex");

/**
 * What the lane itself supplies for a variable the record says is present.
 * The two Stripe keys are not here: they must come from the caller, and must
 * be test keys.
 */
function laneValues(): Record<string, string> {
  return {
    // The lane signs the Stripe events it forwards with these, so they need
    // only be unguessable for the length of one run.
    STRIPE_WEBHOOK_SECRET: `whsec_lane_${secret()}`,
    STRIPE_CONNECT_WEBHOOK_SECRET: `whsec_lane_connect_${secret()}`,
  };
}

/**
 * Stripe mode in a production build refuses to boot without monitoring and an
 * alert destination. `.invalid` never resolves (RFC 2606), so nothing leaves
 * the machine; the app's own failure handling for an unreachable destination
 * is what runs.
 */
const PLACEHOLDERS: Record<string, string> = {
  SENTRY_DSN: "https://lane@sentry.invalid/1",
  ADMIN_ALERT_WEBHOOK_URL: "https://alerts.invalid/drvn-launch-lane",
};

/**
 * The lane's environment as two lists: variables to set and variables to
 * remove. Pure over its inputs. Throws, naming the variable, when a Stripe
 * test key is missing or is not a test key.
 */
export function launchEnvironment(record: LaunchRecord, base: Env, options: { siteUrl: string }): { set: Record<string, string>; unset: string[] } {
  const set: Record<string, string> = {};
  const unset: string[] = [];
  const supplied = laneValues();

  const required: [name: string, prefix: string, source: string][] = [
    ["STRIPE_SECRET_KEY", "sk_test_", "the STRIPE_TEST_SECRET_KEY Actions secret"],
    ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_", "the STRIPE_TEST_PUBLISHABLE_KEY Actions variable"],
  ];
  for (const [name, prefix, source] of required) {
    const value = base[name];
    if (!value) throw new Error(`The launch-configuration lane needs ${name} (a Stripe test-mode key, ${prefix}…; in CI it comes from ${source}).`);
    if (!value.startsWith(prefix)) throw new Error(`The launch-configuration lane refuses ${name}: it must be a Stripe test-mode key (${prefix}…), never a live one.`);
  }

  for (const [name, setting] of Object.entries(record.variables)) {
    if (setting === null) unset.push(name);
    else if (base[name] && required.some(([key]) => key === name)) set[name] = base[name]!;
    else if (supplied[name]) set[name] = supplied[name];
    else throw new Error(`The launch record says ${name} is present, and the lane has no value for it. Add one to e2e-launch/launch-environment.ts.`);
  }

  // The one deliberate difference from the record: on the isolated stack the
  // cache is off unless asked for (src/lib/supabase/public-cache.ts), and the
  // launch has it on.
  if (record.variables.DRVN_PUBLIC_CACHE !== null) throw new Error("The launch record no longer leaves DRVN_PUBLIC_CACHE absent; decide what the lane should do.");
  unset.splice(unset.indexOf("DRVN_PUBLIC_CACHE"), 1);
  set.DRVN_PUBLIC_CACHE = "on";

  Object.assign(set, PLACEHOLDERS);
  set.NEXT_PUBLIC_SITE_URL = options.siteUrl;
  // Two jobs, two secrets, each at least 32 characters (the boot check).
  for (const name of ["CRON_SECRET", "GUEST_RECEIPT_SECRET"]) {
    set[name] = base[name] && base[name]!.length >= 32 ? base[name]! : secret();
  }
  if (set.CRON_SECRET === set.GUEST_RECEIPT_SECRET) set.GUEST_RECEIPT_SECRET = secret();
  return { set, unset };
}

/** Applies the lane's environment to a process environment, in place. */
export function applyLaunchEnvironment(target: Env, lane: { set: Record<string, string>; unset: string[] }): void {
  for (const name of lane.unset) delete target[name];
  Object.assign(target, lane.set);
}
